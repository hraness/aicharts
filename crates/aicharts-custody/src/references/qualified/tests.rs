//! Real disposable APFS references and a private in-memory vault factory.
//! These ordinary tests never select a native keychain.
use super::*;
use crate::{
    references::{RecordIntent, ReferenceState, ReferenceStore},
    store::{RawError, RawResult, RawStore},
    CredentialRef, NamespaceBinding, Purpose, Secret32,
};
use std::{
    cell::RefCell,
    collections::BTreeMap,
    fs::{self, DirBuilder, File},
    os::unix::fs::DirBuilderExt,
    path::PathBuf,
    rc::Rc,
};
use zeroize::Zeroizing;

const INSTALLATION: [u8; 32] = [67; 32];

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = PathBuf::from(format!(
            "/private/tmp/aic-facade-{}-{stamp}",
            std::process::id()
        ));
        DirBuilder::new().mode(0o700).create(&path).unwrap();
        Self(path)
    }
    fn initialize(&self) -> ReferenceStore {
        let mut storage = MacStorage::create_new_at(File::open(&self.0).unwrap().into()).unwrap();
        engine::initialize(&mut storage, INSTALLATION).unwrap();
        ReferenceStore::fixture(QualifiedStore { storage })
    }
    fn reopen(&self) -> ReferenceStore {
        let storage = MacStorage::open_existing_at(File::open(&self.0).unwrap().into()).unwrap();
        ReferenceStore::fixture(QualifiedStore { storage })
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn pairing(secret: u8) -> SecretRecord {
    SecretRecord::pairing(
        CredentialRef::new(INSTALLATION, [1; 32], Purpose::Pairing).unwrap(),
        [91; 32],
        Secret32::new([secret; 32]).unwrap(),
        Secret32::new([secret + 1; 32]).unwrap(),
    )
    .unwrap()
}
fn namespace() -> SecretRecord {
    SecretRecord::namespace(
        CredentialRef::new(INSTALLATION, [2; 32], Purpose::Namespace).unwrap(),
        NamespaceBinding::new([83; 16], [89; 32], 1).unwrap(),
        Secret32::new([79; 32]).unwrap(),
    )
    .unwrap()
}

#[derive(Default)]
struct VaultState {
    records: BTreeMap<String, Zeroizing<Vec<u8>>>,
    events: Vec<&'static str>,
    adds: usize,
    lose_add: bool,
}
struct Session(Rc<RefCell<VaultState>>);
fn key(reference: &CredentialRef) -> String {
    format!("{}:{}", reference.service(), reference.account())
}
impl RawStore for Session {
    fn read(&mut self, reference: &CredentialRef) -> RawResult<Zeroizing<Vec<u8>>> {
        let mut state = self.0.borrow_mut();
        state.events.push("read");
        state
            .records
            .get(&key(reference))
            .cloned()
            .ok_or(RawError::Missing)
    }
    fn add(&mut self, reference: &CredentialRef, bytes: &[u8]) -> RawResult<()> {
        let mut state = self.0.borrow_mut();
        state.events.push("add");
        state.adds += 1;
        let key = key(reference);
        if state.records.contains_key(&key) {
            return Err(RawError::Duplicate);
        }
        state.records.insert(key, Zeroizing::new(bytes.to_vec()));
        if std::mem::take(&mut state.lose_add) {
            return Err(RawError::Unknown);
        }
        Ok(())
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.0.borrow_mut().events.push("drop");
    }
}
fn vault(state: &Rc<RefCell<VaultState>>) -> Vault {
    let state = state.clone();
    Vault::fixture(move || {
        state.borrow_mut().events.push("select");
        Ok(Session(state.clone()))
    })
}

#[test]
fn facade_refusals_never_select_a_vault_session() {
    let fixture = Fixture::new();
    let mut refs = fixture.initialize();
    let initial = refs.snapshot().unwrap();
    let original = pairing(73);
    let prepared = refs.prepare(&initial.token(), &original).unwrap();
    let state = Rc::new(RefCell::new(VaultState::default()));
    let mut vault = vault(&state);

    let mut closed = ReferenceStore { qualified: None };
    assert_eq!(closed.snapshot().err(), Some(Error::BackendUnqualified));
    assert_eq!(
        closed.prepare(&prepared.token(), &original).err(),
        Some(Error::BackendUnqualified)
    );
    assert_eq!(
        closed
            .install_prepared(&prepared.token(), &original, &mut vault)
            .err(),
        Some(Error::BackendUnqualified)
    );
    assert_eq!(
        closed
            .reconcile_prepared(&prepared.token(), original.identity(), &mut vault)
            .err(),
        Some(Error::BackendUnqualified)
    );
    assert_eq!(
        closed
            .resolve_verified(&prepared.token(), original.identity(), &mut vault)
            .err(),
        Some(Error::BackendUnqualified)
    );

    assert_eq!(
        refs.install_prepared(&initial.token(), &original, &mut vault)
            .err(),
        Some(Error::StaleSnapshot)
    );
    assert_eq!(
        refs.install_prepared(&prepared.token(), &pairing(75), &mut vault)
            .err(),
        Some(Error::Conflict)
    );
    assert_eq!(
        refs.resolve_verified(&prepared.token(), original.identity(), &mut vault)
            .err(),
        Some(Error::NotVerified)
    );
    refs.backend().unwrap().storage.fail_next_committed_sync();
    assert_eq!(
        refs.install_prepared(&prepared.token(), &original, &mut vault)
            .err(),
        Some(Error::StorageUnavailable)
    );
    assert!(state.borrow().events.is_empty());
    assert_eq!(refs.snapshot().unwrap(), prepared);
}

#[test]
fn facade_pairing_and_namespace_roundtrip_pin_one_session_per_operation() {
    let fixture = Fixture::new();
    let mut refs = fixture.initialize();
    let mut snapshot = refs.snapshot().unwrap();
    let state = Rc::new(RefCell::new(VaultState::default()));
    let mut vault = vault(&state);
    for original in [pairing(73), namespace()] {
        let prepared = refs.prepare(&snapshot.token(), &original).unwrap();
        assert!(state.borrow().events.is_empty());
        snapshot = refs
            .install_prepared(&prepared.token(), &original, &mut vault)
            .unwrap();
        assert_eq!(
            state.borrow().events,
            ["select", "read", "add", "read", "read", "drop"]
        );
        assert!(snapshot.entries().iter().any(|entry| entry.intent()
            == &RecordIntent::from_record(&original)
            && entry.state() == ReferenceState::CustodyVerified));

        state.borrow_mut().events.clear();
        let resolved = refs
            .resolve_verified(&snapshot.token(), original.identity(), &mut vault)
            .unwrap();
        assert_eq!(
            RecordIntent::from_record(&resolved),
            RecordIntent::from_record(&original)
        );
        assert_eq!(state.borrow().events, ["select", "read", "drop"]);
        state.borrow_mut().events.clear();
    }
    drop(refs);
    let mut reopened = fixture.reopen();
    let original = namespace();
    let resolved = reopened
        .resolve_verified(&snapshot.token(), original.identity(), &mut vault)
        .unwrap();
    assert_eq!(
        RecordIntent::from_record(&resolved),
        RecordIntent::from_record(&original)
    );
    assert_eq!(state.borrow().events, ["select", "read", "drop"]);
    for name in ["references.lock", "references.current"] {
        let bytes = fs::read(fixture.0.join("references-v1").join(name)).unwrap();
        for secret in [[73; 32], [74; 32], [79; 32]] {
            assert!(!bytes.windows(32).any(|window| window == secret));
        }
    }
}

#[test]
fn facade_uncertain_install_reconciles_without_retry_or_verified_remint() {
    let fixture = Fixture::new();
    let mut refs = fixture.initialize();
    let initial = refs.snapshot().unwrap();
    let original = namespace();
    let prepared = refs.prepare(&initial.token(), &original).unwrap();
    let state = Rc::new(RefCell::new(VaultState {
        lose_add: true,
        ..VaultState::default()
    }));
    let mut vault = vault(&state);
    assert_eq!(
        refs.install_prepared(&prepared.token(), &original, &mut vault)
            .err(),
        Some(Error::Custody(crate::Error::OutcomeUnknown))
    );
    assert_eq!(state.borrow().events, ["select", "read", "add", "drop"]);
    assert_eq!(state.borrow().adds, 1);
    assert_eq!(refs.snapshot().unwrap(), prepared);

    state.borrow_mut().events.clear();
    let recovered = refs
        .reconcile_prepared(&prepared.token(), original.identity(), &mut vault)
        .unwrap();
    assert_eq!(state.borrow().events, ["select", "read", "drop"]);
    assert_eq!(state.borrow().adds, 1);
    assert_eq!(
        recovered.entries()[0].state(),
        ReferenceState::CustodyVerified
    );

    state.borrow_mut().records.clear();
    state.borrow_mut().events.clear();
    assert_eq!(
        refs.resolve_verified(&recovered.token(), original.identity(), &mut vault)
            .err(),
        Some(Error::Custody(crate::Error::Missing))
    );
    assert_eq!(
        refs.install_prepared(&recovered.token(), &original, &mut vault)
            .err(),
        Some(Error::Custody(crate::Error::Missing))
    );
    assert_eq!(state.borrow().adds, 1);
    assert_eq!(
        state.borrow().events,
        ["select", "read", "drop", "select", "read", "drop"]
    );
    assert_eq!(refs.snapshot().unwrap(), recovered);
}
