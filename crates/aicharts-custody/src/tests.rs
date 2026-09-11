//! Deterministic in-memory tests only. No test constructs a native keychain.
use super::*;
use crate::record::{bytes_equal, MAX_RECORD_BYTES};
use crate::store::{insert_immutable, read_exact, RawError, RawResult, RawStore};
use std::cell::RefCell;
use std::collections::{BTreeMap, VecDeque};
use std::rc::Rc;
use zeroize::Zeroizing;

type Key = (String, String);
type Persisted = Rc<RefCell<BTreeMap<Key, Zeroizing<Vec<u8>>>>>;

enum AddAction {
    Store,
    Reject(RawError),
    StoreThenFail(RawError),
    Race(Zeroizing<Vec<u8>>),
    StoreAltered(Zeroizing<Vec<u8>>),
}

struct FakeStore {
    persisted: Persisted,
    reads: VecDeque<Option<RawError>>,
    add_action: AddAction,
    calls: Vec<&'static str>,
}

impl FakeStore {
    fn new() -> Self {
        Self::restart(Rc::new(RefCell::new(BTreeMap::new())))
    }
    fn restart(persisted: Persisted) -> Self {
        Self {
            persisted,
            reads: VecDeque::new(),
            add_action: AddAction::Store,
            calls: Vec::new(),
        }
    }
    fn key(reference: &CredentialRef) -> Key {
        (reference.service().into(), reference.account())
    }
    fn seed(&mut self, reference: &CredentialRef, bytes: &[u8]) {
        self.persisted
            .borrow_mut()
            .insert(Self::key(reference), Zeroizing::new(bytes.to_vec()));
    }
}

impl RawStore for FakeStore {
    fn read(&mut self, reference: &CredentialRef) -> RawResult<Zeroizing<Vec<u8>>> {
        self.calls.push("read");
        if let Some(Some(error)) = self.reads.pop_front() {
            return Err(error);
        }
        self.persisted
            .borrow()
            .get(&Self::key(reference))
            .map(|bytes| Zeroizing::new(bytes.to_vec()))
            .ok_or(RawError::Missing)
    }
    fn add(&mut self, reference: &CredentialRef, bytes: &[u8]) -> RawResult<()> {
        self.calls.push("add");
        let key = Self::key(reference);
        let action = std::mem::replace(&mut self.add_action, AddAction::Store);
        match action {
            AddAction::Reject(error) => Err(error),
            AddAction::Race(other) => {
                self.persisted.borrow_mut().insert(key, other);
                Err(RawError::Duplicate)
            }
            AddAction::StoreAltered(other) => {
                self.persisted.borrow_mut().insert(key, other);
                Ok(())
            }
            AddAction::Store | AddAction::StoreThenFail(_) => {
                if self.persisted.borrow().contains_key(&key) {
                    return Err(RawError::Duplicate);
                }
                self.persisted
                    .borrow_mut()
                    .insert(key, Zeroizing::new(bytes.to_vec()));
                if let AddAction::StoreThenFail(error) = action {
                    Err(error)
                } else {
                    Ok(())
                }
            }
        }
    }
}

fn reference(purpose: Purpose) -> CredentialRef {
    CredentialRef::new([11; 32], [12; 32], purpose).unwrap()
}
fn secret(byte: u8) -> Secret32 {
    Secret32::new([byte; 32]).ok().unwrap()
}
fn binding() -> NamespaceBinding {
    NamespaceBinding::new([13; 16], [14; 32], 1).unwrap()
}
fn checkpoint() -> SecretRecord {
    SecretRecord::checkpoint(reference(Purpose::Checkpoint), secret(201))
        .ok()
        .unwrap()
}
fn pairing() -> SecretRecord {
    SecretRecord::pairing(
        reference(Purpose::Pairing),
        [15; 32],
        secret(202),
        secret(203),
    )
    .ok()
    .unwrap()
}
fn namespace() -> SecretRecord {
    SecretRecord::namespace(reference(Purpose::Namespace), binding(), secret(204))
        .ok()
        .unwrap()
}
fn error<T>(result: Result<T>, expected: Error) {
    match result {
        Err(actual) => assert_eq!(actual, expected),
        Ok(_) => panic!("expected fixed custody refusal"),
    }
}
fn equal_record(left: &SecretRecord, right: &SecretRecord) {
    assert_eq!(left.identity(), right.identity());
    assert!(bytes_equal(&left.encode(), &right.encode()));
}

#[test]
fn public_constructor_has_no_native_side_effect_and_other_platforms_are_closed() {
    if cfg!(target_os = "macos") {
        assert!(Vault::new().is_ok());
    } else {
        error(Vault::new(), Error::UnsupportedPlatform);
    }
}

#[test]
fn reference_is_fixed_scope_nonzero_and_role_separated() {
    for purpose in [Purpose::Checkpoint, Purpose::Pairing, Purpose::Namespace] {
        error(
            CredentialRef::new([0; 32], [1; 32], purpose),
            Error::InvalidReference,
        );
        error(
            CredentialRef::new([1; 32], [0; 32], purpose),
            Error::InvalidReference,
        );
        let value = reference(purpose);
        assert_eq!(value.installation_id(), &[11; 32]);
        assert_eq!(value.item_id(), &[12; 32]);
        assert_eq!(value.purpose(), purpose);
        assert!(value.service().starts_with("io.aicharts.usage.production."));
        assert_eq!(value.account().len(), 132);
        assert!(value
            .account()
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'v' || byte == b'-'));
    }
    let keys: Vec<_> = [Purpose::Checkpoint, Purpose::Pairing, Purpose::Namespace]
        .map(|purpose| FakeStore::key(&reference(purpose)))
        .into();
    assert!(keys[0] != keys[1] && keys[0] != keys[2] && keys[1] != keys[2]);
}

#[test]
fn namespace_and_pairing_metadata_validate_syntax_without_claiming_provenance() {
    for (account, generation, version) in [
        ([0; 16], [1; 32], 1),
        ([1; 16], [0; 32], 1),
        ([1; 16], [1; 32], 0),
        ([1; 16], [1; 32], 2),
        ([1; 16], [1; 32], u16::MAX),
    ] {
        error(
            NamespaceBinding::new(account, generation, version),
            Error::InvalidBinding,
        );
    }
    let value = binding();
    assert_eq!(value.account_id(), &[13; 16]);
    assert_eq!(value.recovery_generation(), &[14; 32]);
    assert_eq!(value.namespace_version(), 1);
    error(
        RecordIdentity::pairing(reference(Purpose::Pairing), [0; 32]),
        Error::InvalidBinding,
    );
    assert_eq!(pairing().identity().intent_id(), Some(&[15; 32]));
    assert_eq!(namespace().identity().namespace_binding(), Some(&value));
    assert!(checkpoint().identity().intent_id().is_none());
    assert!(checkpoint().identity().namespace_binding().is_none());
}

#[test]
fn zero_and_equal_pairing_secrets_are_refused() {
    error(Secret32::new([0; 32]), Error::InvalidSecret);
    error(
        SecretRecord::pairing(reference(Purpose::Pairing), [1; 32], secret(5), secret(5)),
        Error::InvalidSecret,
    );
    let mut sparse = [0; 32];
    sparse[31] = 1;
    let value = Secret32::new(sparse).ok().unwrap();
    assert!(value.with_bytes(|bytes| bytes == &sparse));
}

#[test]
fn wrong_role_is_rejected_by_identity_record_and_secret_accessors() {
    error(
        RecordIdentity::checkpoint(reference(Purpose::Pairing)),
        Error::WrongPurpose,
    );
    error(
        RecordIdentity::pairing(reference(Purpose::Namespace), [1; 32]),
        Error::WrongPurpose,
    );
    error(
        RecordIdentity::namespace(reference(Purpose::Checkpoint), binding()),
        Error::WrongPurpose,
    );
    error(
        SecretRecord::checkpoint(reference(Purpose::Pairing), secret(1)),
        Error::WrongPurpose,
    );
    error(
        SecretRecord::pairing(reference(Purpose::Namespace), [1; 32], secret(1), secret(2)),
        Error::WrongPurpose,
    );
    error(
        SecretRecord::namespace(reference(Purpose::Checkpoint), binding(), secret(1)),
        Error::WrongPurpose,
    );
    let records = [checkpoint(), pairing(), namespace()];
    for (index, record) in records.iter().enumerate() {
        let mut invoked = false;
        if index != 0 {
            error(
                record.with_checkpoint_key(|_| invoked = true),
                Error::WrongPurpose,
            );
        }
        if index != 1 {
            error(
                record.with_pairing_secrets(|_, _| invoked = true),
                Error::WrongPurpose,
            );
        }
        if index != 2 {
            error(
                record.with_namespace_key(|_| invoked = true),
                Error::WrongPurpose,
            );
        }
        assert!(!invoked);
    }
    assert!(records[0]
        .with_checkpoint_key(|key| key == &[201; 32])
        .unwrap());
    assert!(records[1]
        .with_pairing_secrets(|poll, upload| poll == &[202; 32] && upload == &[203; 32])
        .unwrap());
    assert!(records[2]
        .with_namespace_key(|key| key == &[204; 32])
        .unwrap());
}

#[test]
fn local_binary_layout_is_exact_and_has_no_free_form_fields() {
    for (record, size, tag) in [
        (checkpoint(), 104, 1),
        (pairing(), 168, 2),
        (namespace(), 160, 3),
    ] {
        let bytes = record.encode();
        assert_eq!(bytes.len(), size);
        assert!(bytes[..8] == [65, 73, 67, 86, 1, 0, tag, 0]);
        assert!(bytes[8..40] == [11; 32] && bytes[40..72] == [12; 32]);
        equal_record(&record, &SecretRecord::decode(&bytes).ok().unwrap());
    }
    let pair = pairing().encode();
    assert!(
        pair[72..104] == [15; 32] && pair[104..136] == [202; 32] && pair[136..168] == [203; 32]
    );
    let account = namespace().encode();
    assert!(account[72..88] == [13; 16] && account[88..120] == [14; 32]);
    assert!(account[120..128] == [1, 0, 0, 0, 0, 0, 0, 0] && account[128..160] == [204; 32]);
}

#[test]
fn every_truncation_trailing_byte_and_unknown_header_is_refused() {
    for record in [checkpoint(), pairing(), namespace()] {
        let bytes = record.encode();
        for length in 0..bytes.len() {
            error(SecretRecord::decode(&bytes[..length]), Error::InvalidRecord);
        }
        let mut extra = Zeroizing::new(bytes.to_vec());
        extra.push(0);
        error(SecretRecord::decode(&extra), Error::InvalidRecord);
        for offset in 0..8 {
            let mut altered = Zeroizing::new(bytes.to_vec());
            altered[offset] = 255;
            error(SecretRecord::decode(&altered), Error::InvalidRecord);
        }
    }
    error(
        SecretRecord::decode(&[0; MAX_RECORD_BYTES + 1]),
        Error::InvalidRecord,
    );
}

#[test]
fn malformed_binary_identity_key_and_reserved_fields_are_refused() {
    for record in [checkpoint(), pairing(), namespace()] {
        let bytes = record.encode();
        for range in [8..40, 40..72, bytes.len() - 32..bytes.len()] {
            let mut altered = Zeroizing::new(bytes.to_vec());
            altered[range].fill(0);
            error(SecretRecord::decode(&altered), Error::InvalidRecord);
        }
    }
    for range in [72..88, 88..120, 120..122] {
        let mut bytes = namespace().encode();
        bytes[range].fill(0);
        error(SecretRecord::decode(&bytes), Error::InvalidRecord);
    }
    for offset in 122..128 {
        let mut bytes = namespace().encode();
        bytes[offset] = 1;
        error(SecretRecord::decode(&bytes), Error::InvalidRecord);
    }
    for range in [72..104, 104..136] {
        let mut bytes = pairing().encode();
        bytes[range].fill(0);
        error(SecretRecord::decode(&bytes), Error::InvalidRecord);
    }
    let mut bytes = pairing().encode();
    bytes[136..168].fill(202);
    error(SecretRecord::decode(&bytes), Error::InvalidRecord);
}

#[test]
fn generated_record_laws_roundtrip_and_compare_every_secret_position() {
    for seed in 1..=128u8 {
        let reference =
            CredentialRef::new([seed; 32], [seed.wrapping_add(1); 32], Purpose::Checkpoint)
                .unwrap();
        let record = SecretRecord::checkpoint(reference, secret(seed))
            .ok()
            .unwrap();
        let encoded = record.encode();
        equal_record(&record, &SecretRecord::decode(&encoded).ok().unwrap());
        for offset in 72..104 {
            let mut altered = Zeroizing::new(encoded.to_vec());
            altered[offset] ^= 1;
            assert!(!bytes_equal(&encoded, &altered));
        }
    }
    assert!(!bytes_equal(&[1], &[1, 0]));
}

#[test]
fn immutable_insert_reads_back_and_repeated_insert_never_writes() {
    for record in [checkpoint(), pairing(), namespace()] {
        let mut store = FakeStore::new();
        assert_eq!(
            insert_immutable(&mut store, &record).unwrap(),
            InsertOutcome::Inserted
        );
        assert_eq!(store.calls, ["read", "add", "read"]);
        store.calls.clear();
        assert_eq!(
            insert_immutable(&mut store, &record).unwrap(),
            InsertOutcome::AlreadyPresent
        );
        assert_eq!(store.calls, ["read"]);
        equal_record(
            &record,
            &read_exact(&mut store, record.identity()).ok().unwrap(),
        );
        assert_eq!(store.persisted.borrow().len(), 1);
    }
}

#[test]
fn already_present_different_secret_is_never_overwritten() {
    let original = checkpoint();
    let mut store = FakeStore::new();
    store.seed(original.identity().reference(), &original.encode());
    let different = SecretRecord::checkpoint(reference(Purpose::Checkpoint), secret(5))
        .ok()
        .unwrap();
    error(insert_immutable(&mut store, &different), Error::Conflict);
    assert_eq!(store.calls, ["read"]);
    equal_record(
        &original,
        &read_exact(&mut store, original.identity()).ok().unwrap(),
    );
}

#[test]
fn all_expected_identity_dimensions_are_checked_before_secret_release() {
    let mut cases = Vec::new();
    let cp = checkpoint();
    for reference in [
        CredentialRef::new([21; 32], [12; 32], Purpose::Checkpoint).unwrap(),
        CredentialRef::new([11; 32], [22; 32], Purpose::Checkpoint).unwrap(),
    ] {
        cases.push((checkpoint(), RecordIdentity::checkpoint(reference).unwrap()));
    }
    cases.push((
        pairing(),
        RecordIdentity::pairing(reference(Purpose::Pairing), [99; 32]).unwrap(),
    ));
    for binding in [
        NamespaceBinding::new([99; 16], [14; 32], 1).unwrap(),
        NamespaceBinding::new([13; 16], [99; 32], 1).unwrap(),
    ] {
        cases.push((
            namespace(),
            RecordIdentity::namespace(reference(Purpose::Namespace), binding).unwrap(),
        ));
    }
    cases.push((pairing(), cp.identity().clone()));
    for (stored, expected) in cases {
        let mut store = FakeStore::new();
        store.seed(expected.reference(), &stored.encode());
        error(read_exact(&mut store, &expected), Error::Conflict);
        assert_eq!(store.calls, ["read"]);
    }
}

#[test]
fn inaccessible_or_invalid_existing_custody_never_triggers_add() {
    for (raw, fixed) in [
        (RawError::InteractionRequired, Error::InteractionRequired),
        (RawError::AccessDenied, Error::AccessDenied),
        (RawError::Unavailable, Error::Unavailable),
        (RawError::Invalid, Error::InvalidRecord),
        (RawError::Unknown, Error::OutcomeUnknown),
        (RawError::Duplicate, Error::Conflict),
    ] {
        let mut store = FakeStore::new();
        store.reads.push_back(Some(raw));
        error(insert_immutable(&mut store, &checkpoint()), fixed);
        assert_eq!(store.calls, ["read"]);
        assert!(store.persisted.borrow().is_empty());
    }
    for bytes in [vec![], vec![1; 169], b"private-chat-log-canary".to_vec()] {
        let mut store = FakeStore::new();
        store.seed(&reference(Purpose::Checkpoint), &bytes);
        error(
            insert_immutable(&mut store, &checkpoint()),
            Error::InvalidRecord,
        );
        assert_eq!(store.calls, ["read"]);
    }
}

#[test]
fn missing_read_is_not_creation_permission() {
    let mut store = FakeStore::new();
    error(
        read_exact(&mut store, checkpoint().identity()),
        Error::Missing,
    );
    assert_eq!(store.calls, ["read"]);
    assert!(store.persisted.borrow().is_empty());
}

#[test]
fn racing_exact_duplicate_is_reconciled_once_and_conflicting_duplicate_is_preserved() {
    for conflicting in [false, true] {
        let original = checkpoint();
        let other = if conflicting {
            SecretRecord::checkpoint(reference(Purpose::Checkpoint), secret(7))
                .ok()
                .unwrap()
        } else {
            checkpoint()
        };
        let mut store = FakeStore::new();
        store.add_action = AddAction::Race(other.encode());
        if conflicting {
            error(insert_immutable(&mut store, &original), Error::Conflict);
        } else {
            assert_eq!(
                insert_immutable(&mut store, &original).unwrap(),
                InsertOutcome::AlreadyPresent
            );
        }
        assert_eq!(store.calls, ["read", "add", "read"]);
        equal_record(
            &other,
            &read_exact(&mut store, other.identity()).ok().unwrap(),
        );
    }
}

#[test]
fn successful_or_duplicate_add_with_invalid_or_wrong_readback_never_succeeds() {
    for duplicate in [false, true] {
        let wrong = SecretRecord::checkpoint(reference(Purpose::Checkpoint), secret(33))
            .ok()
            .unwrap();
        for (bytes, expected) in [
            (Zeroizing::new(vec![1; 104]), Error::InvalidRecord),
            (pairing().encode(), Error::Conflict),
            (wrong.encode(), Error::Conflict),
        ] {
            let mut store = FakeStore::new();
            store.add_action = if duplicate {
                AddAction::Race(bytes)
            } else {
                AddAction::StoreAltered(bytes)
            };
            error(insert_immutable(&mut store, &checkpoint()), expected);
            assert_eq!(store.calls, ["read", "add", "read"]);
            assert_eq!(store.persisted.borrow().len(), 1);
        }
    }
}

#[test]
fn every_nonduplicate_write_error_is_uncertain_without_automatic_continuation() {
    for raw in [
        RawError::Missing,
        RawError::InteractionRequired,
        RawError::AccessDenied,
        RawError::Unavailable,
        RawError::Invalid,
        RawError::Unknown,
    ] {
        for committed in [false, true] {
            let mut store = FakeStore::new();
            store.add_action = if committed {
                AddAction::StoreThenFail(raw)
            } else {
                AddAction::Reject(raw)
            };
            error(
                insert_immutable(&mut store, &pairing()),
                Error::OutcomeUnknown,
            );
            assert_eq!(store.calls, ["read", "add"]);
            assert_eq!(store.persisted.borrow().len(), usize::from(committed));
        }
    }
}

#[test]
fn failed_postwrite_readback_keeps_original_proof_for_explicit_restart_read() {
    for raw in [
        RawError::Missing,
        RawError::Duplicate,
        RawError::InteractionRequired,
        RawError::AccessDenied,
        RawError::Unavailable,
        RawError::Invalid,
        RawError::Unknown,
    ] {
        let record = pairing();
        let mut store = FakeStore::new();
        store.reads.extend([None, Some(raw)]);
        error(insert_immutable(&mut store, &record), Error::OutcomeUnknown);
        assert_eq!(store.calls, ["read", "add", "read"]);
        let mut restarted = FakeStore::restart(store.persisted.clone());
        drop(store);
        equal_record(
            &record,
            &read_exact(&mut restarted, record.identity()).ok().unwrap(),
        );
        assert_eq!(restarted.calls, ["read"]);
    }
}

#[test]
fn uncertain_committed_reply_restarts_with_same_record_and_no_second_insert() {
    let record = pairing();
    let mut store = FakeStore::new();
    store.add_action = AddAction::StoreThenFail(RawError::Unknown);
    error(insert_immutable(&mut store, &record), Error::OutcomeUnknown);
    let mut restarted = FakeStore::restart(store.persisted.clone());
    drop(store);
    assert_eq!(
        insert_immutable(&mut restarted, &record).unwrap(),
        InsertOutcome::AlreadyPresent
    );
    assert_eq!(restarted.calls, ["read"]);
    equal_record(
        &record,
        &read_exact(&mut restarted, record.identity()).ok().unwrap(),
    );
}

#[test]
fn uncommitted_uncertainty_requires_explicit_reinsert_of_retained_record() {
    let record = namespace();
    let mut store = FakeStore::new();
    store.add_action = AddAction::Reject(RawError::Unknown);
    error(insert_immutable(&mut store, &record), Error::OutcomeUnknown);
    let mut restarted = FakeStore::restart(store.persisted.clone());
    drop(store);
    error(
        read_exact(&mut restarted, record.identity()),
        Error::Missing,
    );
    assert_eq!(restarted.calls, ["read"]);
    assert_eq!(
        insert_immutable(&mut restarted, &record).unwrap(),
        InsertOutcome::Inserted
    );
    equal_record(
        &record,
        &read_exact(&mut restarted, record.identity()).ok().unwrap(),
    );
}

#[test]
fn errors_and_metadata_do_not_project_secret_canaries() {
    let records = [checkpoint(), pairing(), namespace()];
    for record in records {
        let metadata = format!("{:?}", record.identity());
        for byte in 201..=204 {
            assert!(!metadata.contains(&format!("[{byte}, {byte}")));
        }
    }
    for error in [
        Error::UnsupportedPlatform,
        Error::InvalidReference,
        Error::InvalidBinding,
        Error::InvalidSecret,
        Error::InvalidRecord,
        Error::WrongPurpose,
        Error::Missing,
        Error::Conflict,
        Error::InteractionRequired,
        Error::AccessDenied,
        Error::Unavailable,
        Error::Busy,
        Error::OutcomeUnknown,
    ] {
        assert_eq!(error.to_string(), error.code());
        assert!(error.code().starts_with("custody_"));
        assert!(error
            .code()
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'_'));
        assert!(std::error::Error::source(&error).is_none());
    }
}
