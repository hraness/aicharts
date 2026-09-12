//! This is file-based macOS Keychain custody, not Data Protection Keychain,
//! Secure Enclave storage, app-group sharing, or a collector/uploader sandbox.
use crate::record::MAX_RECORD_BYTES;
use crate::store::{RawError, RawResult, RawStore};
use crate::{CredentialRef, Error, Result};
use core_foundation::data::CFData;
use security_framework::item::{
    CloudSync, ItemAddOptions, ItemAddValue, ItemClass, ItemSearchOptions, Limit, Location,
    SearchResult,
};
use security_framework::os::macos::keychain::{
    KeychainUserInteractionLock, SecKeychain, SecPreferencesDomain,
};
use std::sync::{Mutex, MutexGuard, TryLockError};
use zeroize::Zeroizing;

static VAULT_OPERATION: Mutex<()> = Mutex::new(());

pub(crate) fn with_store<T>(f: impl FnOnce(&mut dyn RawStore) -> Result<T>) -> Result<T> {
    // User-interaction policy is process-wide. The mutex owns its complete
    // lifetime, including guard drop, and also pins one keychain per operation.
    let _operation = match VAULT_OPERATION.try_lock() {
        Ok(guard) => guard,
        Err(TryLockError::WouldBlock) => return Err(Error::Busy),
        Err(TryLockError::Poisoned(_)) => return Err(Error::Unavailable),
    };
    suppress_for(&NativeUi, || {
        let keychain = SecKeychain::default_for_domain(SecPreferencesDomain::User)
            .map_err(|error| read_error(error.code()).fixed())?;
        f(&mut MacStore { keychain })
    })
}

trait UiControl {
    type Guard;
    fn allowed(&self) -> Result<bool>;
    fn suppress(&self) -> Result<Self::Guard>;
}

struct NativeUi;
impl UiControl for NativeUi {
    type Guard = KeychainUserInteractionLock;
    fn allowed(&self) -> Result<bool> {
        SecKeychain::user_interaction_allowed().map_err(|_| Error::Unavailable)
    }
    fn suppress(&self) -> Result<Self::Guard> {
        SecKeychain::disable_user_interaction().map_err(|_| Error::Unavailable)
    }
}

fn suppress_for<C: UiControl, T>(control: &C, f: impl FnOnce() -> Result<T>) -> Result<T> {
    let was_allowed = control.allowed()?;
    // This dependency's guard always enables UI on drop, rather than restoring
    // arbitrary prior state. Do not construct it when UI is already disabled.
    let _no_ui = if was_allowed {
        Some(control.suppress()?)
    } else {
        None
    };
    f()
}

struct MacStore {
    keychain: SecKeychain,
}

// Field order releases the concrete keychain, restores UI policy, and finally
// releases the process lock. No caller can select a different keychain mid-call.
pub(crate) struct NativeSession {
    store: MacStore,
    _no_ui: Option<KeychainUserInteractionLock>,
    _operation: MutexGuard<'static, ()>,
}

impl NativeSession {
    fn select() -> RawResult<Self> {
        Self::select_with(|| {
            SecKeychain::default_for_domain(SecPreferencesDomain::User)
                .map_err(|error| read_error(error.code()))
        })
    }

    fn select_with(select: impl FnOnce() -> RawResult<SecKeychain>) -> RawResult<Self> {
        let operation = match VAULT_OPERATION.try_lock() {
            Ok(value) => value,
            Err(TryLockError::WouldBlock) => return Err(RawError::Busy),
            Err(TryLockError::Poisoned(_)) => return Err(RawError::Unavailable),
        };
        let allowed = SecKeychain::user_interaction_allowed().map_err(|_| RawError::Unavailable)?;
        let no_ui = if allowed {
            Some(SecKeychain::disable_user_interaction().map_err(|_| RawError::Unavailable)?)
        } else {
            None
        };
        let keychain = select()?;
        Ok(Self {
            store: MacStore { keychain },
            _no_ui: no_ui,
            _operation: operation,
        })
    }

    #[cfg(test)]
    pub(crate) fn fixture(keychain: SecKeychain) -> RawResult<Self> {
        Self::select_with(|| Ok(keychain))
    }
}

#[cfg(test)]
pub(crate) fn fixture_ui<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    let _operation = VAULT_OPERATION.try_lock().map_err(|_| Error::Busy)?;
    suppress_for(&NativeUi, f)
}

impl RawStore for NativeSession {
    fn read(&mut self, reference: &CredentialRef) -> RawResult<Zeroizing<Vec<u8>>> {
        self.store.read(reference)
    }
    fn add(&mut self, reference: &CredentialRef, bytes: &[u8]) -> RawResult<()> {
        self.store.add(reference, bytes)
    }
}

pub(crate) struct LazyStore<F, S> {
    factory: F,
    session: Option<S>,
    failed: Option<RawError>,
}
impl LazyStore<fn() -> RawResult<NativeSession>, NativeSession> {
    pub(crate) fn native() -> Self {
        Self::new(NativeSession::select)
    }
}
impl<F: FnMut() -> RawResult<S>, S: RawStore> LazyStore<F, S> {
    pub(crate) fn new(factory: F) -> Self {
        Self {
            factory,
            session: None,
            failed: None,
        }
    }
    fn session(&mut self) -> RawResult<&mut S> {
        if let Some(error) = self.failed {
            return Err(error);
        }
        if self.session.is_none() {
            match (self.factory)() {
                Ok(value) => self.session = Some(value),
                Err(error) => {
                    self.failed = Some(error);
                    return Err(error);
                }
            }
        }
        self.session.as_mut().ok_or(RawError::Unavailable)
    }
}
impl<F: FnMut() -> RawResult<S>, S: RawStore> RawStore for LazyStore<F, S> {
    fn read(&mut self, reference: &CredentialRef) -> RawResult<Zeroizing<Vec<u8>>> {
        self.session()?.read(reference)
    }
    fn add(&mut self, reference: &CredentialRef, bytes: &[u8]) -> RawResult<()> {
        self.session()?.add(reference, bytes)
    }
}

impl RawStore for MacStore {
    fn read(&mut self, reference: &CredentialRef) -> RawResult<Zeroizing<Vec<u8>>> {
        let mut query = ItemSearchOptions::new();
        query
            .keychains(std::slice::from_ref(&self.keychain))
            .class(ItemClass::generic_password())
            .service(reference.service())
            .account(&reference.account())
            .case_insensitive(Some(false))
            .cloud_sync(CloudSync::MatchSyncNo)
            .limit(Limit::Max(2))
            .load_data(true);
        // Never skip authenticated items: doing so could turn inaccessible
        // existing custody into a misleading Missing result.
        let results = query.search().map_err(|error| read_error(error.code()))?;
        take_data(results)
    }

    fn add(&mut self, reference: &CredentialRef, bytes: &[u8]) -> RawResult<()> {
        if bytes.len() > MAX_RECORD_BYTES {
            return Err(RawError::Invalid);
        }
        let mut options = ItemAddOptions::new(ItemAddValue::Data {
            class: ItemClass::generic_password(),
            data: CFData::from_buffer(bytes),
        });
        options
            .set_location(Location::FileKeychain(self.keychain.clone()))
            .set_service(reference.service())
            .set_account_name(reference.account());
        // add() maps only to SecItemAdd. No set/update/delete fallback exists.
        options.add().map_err(|error| add_error(error.code()))
    }
}

// SearchResult::Data has a secret-bearing Debug implementation. Consume it
// without formatting, and wipe every owned Vec, including unexpected extras.
fn take_data(results: Vec<SearchResult>) -> RawResult<Zeroizing<Vec<u8>>> {
    let count = results.len();
    let mut value = None;
    let mut invalid = count != 1;
    for result in results {
        match result {
            SearchResult::Data(bytes) => {
                let bytes = Zeroizing::new(bytes);
                if count == 1 && bytes.len() <= MAX_RECORD_BYTES {
                    value = Some(bytes);
                } else {
                    invalid = true;
                }
            }
            _ => invalid = true,
        }
    }
    if invalid {
        return Err(RawError::Invalid);
    }
    value.ok_or(RawError::Invalid)
}

// Apple OSStatus constants. Do not retain or format native error messages.
fn read_error(code: i32) -> RawError {
    match code {
        -25300 => RawError::Missing, // errSecItemNotFound
        -25308 | -25315 => RawError::InteractionRequired,
        -25293 | -128 => RawError::AccessDenied, // errSecAuthFailed / userCanceledErr
        -26275 => RawError::Invalid,             // errSecDecode
        _ => RawError::Unavailable,
    }
}

fn add_error(code: i32) -> RawError {
    if code == -25299 {
        RawError::Duplicate
    } else {
        RawError::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    struct FakeSession(Rc<RefCell<Vec<&'static str>>>);
    impl RawStore for FakeSession {
        fn read(&mut self, _: &CredentialRef) -> RawResult<Zeroizing<Vec<u8>>> {
            self.0.borrow_mut().push("read");
            Err(RawError::Missing)
        }
        fn add(&mut self, _: &CredentialRef, _: &[u8]) -> RawResult<()> {
            self.0.borrow_mut().push("add");
            Ok(())
        }
    }
    impl Drop for FakeSession {
        fn drop(&mut self) {
            self.0.borrow_mut().push("drop");
        }
    }

    #[test]
    fn lazy_session_is_pure_until_first_io_and_stays_pinned_until_drop() {
        let events = Rc::new(RefCell::new(Vec::new()));
        let observed = events.clone();
        let mut lazy = LazyStore::new(move || {
            observed.borrow_mut().push("select");
            Ok(FakeSession(observed.clone()))
        });
        assert!(events.borrow().is_empty());
        let reference = CredentialRef::new([1; 32], [2; 32], crate::Purpose::Checkpoint).unwrap();
        assert!(matches!(lazy.read(&reference), Err(RawError::Missing)));
        assert!(lazy.add(&reference, &[1]).is_ok());
        assert!(matches!(lazy.read(&reference), Err(RawError::Missing)));
        assert_eq!(*events.borrow(), ["select", "read", "add", "read"]);
        drop(lazy);
        assert_eq!(*events.borrow(), ["select", "read", "add", "read", "drop"]);
    }

    #[test]
    fn failed_lazy_selection_is_not_retried_or_remapped_to_missing() {
        for error in [
            RawError::Busy,
            RawError::InteractionRequired,
            RawError::AccessDenied,
            RawError::Unavailable,
        ] {
            let calls = std::cell::Cell::new(0);
            let mut lazy = LazyStore::new(|| -> RawResult<FakeSession> {
                calls.set(calls.get() + 1);
                Err(error)
            });
            let reference =
                CredentialRef::new([1; 32], [2; 32], crate::Purpose::Checkpoint).unwrap();
            assert!(lazy.read(&reference).err() == Some(error));
            assert!(lazy.add(&reference, &[1]).err() == Some(error));
            assert_eq!(calls.get(), 1);
        }
        assert_eq!(RawError::Busy.fixed(), Error::Busy);
    }

    #[derive(Default)]
    struct UiState {
        allowed: bool,
        calls: Vec<&'static str>,
        fail_allowed: bool,
        fail_suppress: bool,
    }
    struct FakeUi(Rc<RefCell<UiState>>);
    struct FakeGuard(Rc<RefCell<UiState>>);
    impl Drop for FakeGuard {
        fn drop(&mut self) {
            let mut state = self.0.borrow_mut();
            state.calls.push("enable");
            state.allowed = true;
        }
    }
    impl UiControl for FakeUi {
        type Guard = FakeGuard;
        fn allowed(&self) -> Result<bool> {
            let mut state = self.0.borrow_mut();
            state.calls.push("sample");
            if state.fail_allowed {
                Err(Error::Unavailable)
            } else {
                Ok(state.allowed)
            }
        }
        fn suppress(&self) -> Result<Self::Guard> {
            let mut state = self.0.borrow_mut();
            state.calls.push("disable");
            if state.fail_suppress {
                return Err(Error::Unavailable);
            }
            state.allowed = false;
            Ok(FakeGuard(self.0.clone()))
        }
    }

    #[test]
    fn suppression_does_not_enable_a_previously_disabled_policy() {
        for allowed in [false, true] {
            let state = Rc::new(RefCell::new(UiState {
                allowed,
                ..UiState::default()
            }));
            let result = suppress_for(&FakeUi(state.clone()), || {
                assert!(!state.borrow().allowed);
                state.borrow_mut().calls.push("operation");
                Ok(())
            });
            assert_eq!(result, Ok(()));
            let state = state.borrow();
            assert_eq!(state.allowed, allowed);
            assert_eq!(
                state.calls,
                if allowed {
                    vec!["sample", "disable", "operation", "enable"]
                } else {
                    vec!["sample", "operation"]
                }
            );
        }
    }

    #[test]
    fn policy_failure_prevents_operation_and_operation_failure_drops_guard() {
        for fail_allowed in [false, true] {
            let state = Rc::new(RefCell::new(UiState {
                allowed: true,
                fail_allowed,
                fail_suppress: !fail_allowed,
                ..UiState::default()
            }));
            let result = suppress_for(&FakeUi(state.clone()), || -> Result<()> {
                panic!("operation must not run")
            });
            assert_eq!(result, Err(Error::Unavailable));
            assert!(state.borrow().allowed);
            assert_eq!(
                state.borrow().calls,
                if fail_allowed {
                    vec!["sample"]
                } else {
                    vec!["sample", "disable"]
                }
            );
        }
        let state = Rc::new(RefCell::new(UiState {
            allowed: true,
            ..UiState::default()
        }));
        let result: Result<()> =
            suppress_for(&FakeUi(state.clone()), || Err(Error::OutcomeUnknown));
        assert_eq!(result, Err(Error::OutcomeUnknown));
        assert_eq!(state.borrow().calls, ["sample", "disable", "enable"]);
        assert!(state.borrow().allowed);
    }

    #[test]
    fn unwind_drops_suppression_guard_without_a_native_call() {
        let state = Rc::new(RefCell::new(UiState {
            allowed: true,
            ..UiState::default()
        }));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            suppress_for(&FakeUi(state.clone()), || -> Result<()> {
                panic!("synthetic operation panic")
            })
        }));
        assert!(result.is_err());
        assert!(state.borrow().allowed);
        assert_eq!(state.borrow().calls, ["sample", "disable", "enable"]);
    }

    #[test]
    fn contended_facade_stops_before_any_native_call() {
        let _held = VAULT_OPERATION.lock().unwrap();
        let result = with_store(|_| -> Result<()> { panic!("native operation must not run") });
        assert_eq!(result, Err(Error::Busy));
    }

    #[test]
    fn native_error_mapping_is_fixed_and_addition_is_conservative() {
        assert!(read_error(-25300) == RawError::Missing);
        for code in [-25308, -25315] {
            assert!(read_error(code) == RawError::InteractionRequired);
        }
        for code in [-25293, -128] {
            assert!(read_error(code) == RawError::AccessDenied);
        }
        assert!(read_error(-26275) == RawError::Invalid);
        for code in [-25299, -25291, -25294, -25295, 1, i32::MAX, i32::MIN] {
            assert!(read_error(code) == RawError::Unavailable);
        }
        assert!(add_error(-25299) == RawError::Duplicate);
        for code in [-25300, -25308, -25315, -25293, -128, -26275, -25291, 1] {
            assert!(add_error(code) == RawError::Unknown);
        }
    }

    #[test]
    fn native_search_projection_requires_one_bounded_data_result() {
        let good = take_data(vec![SearchResult::Data(vec![7; 104])])
            .ok()
            .unwrap();
        assert!(good.as_slice() == [7; 104]);
        for results in [
            vec![],
            vec![SearchResult::Other],
            vec![SearchResult::Data(vec![7; 169])],
            vec![
                SearchResult::Data(vec![7; 104]),
                SearchResult::Data(vec![8; 104]),
            ],
            vec![SearchResult::Data(vec![7; 104]), SearchResult::Other],
        ] {
            assert!(matches!(take_data(results), Err(RawError::Invalid)));
        }
    }
}
