//! All persistence is in memory. No filesystem or native vault is opened.
use super::{
    codec,
    engine::{self, Candidate, Storage},
    *,
};
use crate::{
    store::{RawError, RawResult, RawStore},
    CredentialRef, NamespaceBinding, Purpose, Secret32,
};
use std::{cell::RefCell, collections::BTreeMap, rc::Rc};
use zeroize::Zeroizing;

const INSTALLATION: [u8; 32] = [11; 32];

fn record(item: u16, purpose: Purpose, secret: u8) -> SecretRecord {
    let mut id = [0; 32];
    id[..2].copy_from_slice(&item.to_be_bytes());
    let reference = CredentialRef::new(INSTALLATION, id, purpose).unwrap();
    match purpose {
        Purpose::Checkpoint => {
            SecretRecord::checkpoint(reference, Secret32::new([secret; 32]).unwrap())
        }
        Purpose::Pairing => SecretRecord::pairing(
            reference,
            [37; 32],
            Secret32::new([secret; 32]).unwrap(),
            Secret32::new([secret + 1; 32]).unwrap(),
        ),
        Purpose::Namespace => SecretRecord::namespace(
            reference,
            NamespaceBinding::new([13; 16], [19; 32], 1).unwrap(),
            Secret32::new([secret; 32]).unwrap(),
        ),
    }
    .unwrap()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Event {
    Lock,
    Read,
    SyncCommitted,
    Stage,
    SyncCandidate,
    Publish,
    SyncDirectory,
}
#[derive(Clone, Copy)]
enum Effect {
    Before,
    After,
    WrongRead,
}
struct Fault {
    event: Event,
    nth: usize,
    effect: Effect,
}
#[derive(Default)]
struct Disk {
    committed: Option<Vec<u8>>,
    candidate: Option<Candidate>,
    locked: bool,
    events: Vec<Event>,
    fault: Option<Fault>,
    on_sync: Option<Vec<u8>>,
    on_sync_committed: Option<Vec<u8>>,
}
#[derive(Clone, Default)]
struct FakeFs(Rc<RefCell<Disk>>);
impl FakeFs {
    fn fault(&self, event: Event, nth: usize, effect: Effect) {
        let mut disk = self.0.borrow_mut();
        disk.events.clear();
        disk.fault = Some(Fault { event, nth, effect });
    }
    fn hit(&self, event: Event) -> Option<Effect> {
        let mut disk = self.0.borrow_mut();
        disk.events.push(event);
        let count = disk.events.iter().filter(|e| **e == event).count();
        if disk
            .fault
            .as_ref()
            .is_some_and(|fault| fault.event == event && fault.nth == count)
        {
            disk.fault.take().map(|fault| fault.effect)
        } else {
            None
        }
    }
    fn bytes(&self) -> Option<Vec<u8>> {
        self.0.borrow().committed.clone()
    }
    fn release_ok(&self) {
        assert!(!self.0.borrow().locked);
    }
    fn initialize(&mut self) -> ManifestSnapshot {
        engine::initialize(self, INSTALLATION).unwrap()
    }
    fn prepared(&mut self, record: &SecretRecord) -> ManifestSnapshot {
        let empty = self.initialize();
        engine::prepare(self, &empty.token(), record).unwrap()
    }
}
impl Storage for FakeFs {
    fn lock(&mut self) -> Result<()> {
        if self.hit(Event::Lock).is_some() {
            return Err(Error::StorageUnavailable);
        }
        let mut disk = self.0.borrow_mut();
        if disk.locked {
            return Err(Error::Busy);
        }
        disk.locked = true;
        Ok(())
    }
    fn unlock(&mut self) {
        self.0.borrow_mut().locked = false;
    }
    fn read_committed(&mut self, max_bytes: usize) -> Result<Option<Vec<u8>>> {
        assert!(self.0.borrow().locked);
        match self.hit(Event::Read) {
            Some(Effect::WrongRead) => return Ok(Some(vec![99; 96])),
            Some(_) => return Err(Error::StorageUnavailable),
            None => {}
        }
        let value = self.bytes();
        if value.as_ref().is_some_and(|bytes| bytes.len() > max_bytes) {
            return Err(Error::InvalidManifest);
        }
        Ok(value)
    }
    fn stage(&mut self, candidate: &Candidate) -> Result<()> {
        let fault = self.hit(Event::Stage);
        if matches!(fault, Some(Effect::Before)) {
            return Err(Error::StorageUnavailable);
        }
        let mut disk = self.0.borrow_mut();
        if disk.candidate.as_ref().is_some_and(|old| old != candidate) {
            return Err(Error::RecoveryRequired);
        }
        disk.candidate = Some(candidate.clone());
        if fault.is_some() {
            Err(Error::StorageUnavailable)
        } else {
            Ok(())
        }
    }
    fn sync_committed(&mut self) -> Result<()> {
        if self.hit(Event::SyncCommitted).is_some() {
            Err(Error::StorageUnavailable)
        } else {
            let mut disk = self.0.borrow_mut();
            if let Some(changed) = disk.on_sync_committed.take() {
                disk.committed = Some(changed);
            }
            Ok(())
        }
    }
    fn sync_candidate(&mut self) -> Result<()> {
        if self.hit(Event::SyncCandidate).is_some() {
            return Err(Error::StorageUnavailable);
        }
        let mut disk = self.0.borrow_mut();
        if let Some(changed) = disk.on_sync.take() {
            disk.committed = Some(changed);
        }
        Ok(())
    }
    fn publish(&mut self, candidate: &Candidate) -> Result<()> {
        let fault = self.hit(Event::Publish);
        if matches!(fault, Some(Effect::Before)) {
            return Err(Error::StorageUnavailable);
        }
        let mut disk = self.0.borrow_mut();
        if disk.candidate.as_ref() != Some(candidate) {
            return Err(Error::RecoveryRequired);
        }
        let actual = disk
            .committed
            .as_deref()
            .map(codec::decode)
            .transpose()?
            .map(|value| value.token());
        if actual != candidate.expected {
            return Err(Error::StaleSnapshot);
        }
        disk.committed = Some(candidate.bytes.clone());
        disk.candidate = None;
        if fault.is_some() {
            Err(Error::StorageUnavailable)
        } else {
            Ok(())
        }
    }
    fn sync_directory(&mut self) -> Result<()> {
        if self.hit(Event::SyncDirectory).is_some() {
            Err(Error::StorageUnavailable)
        } else {
            Ok(())
        }
    }
}

#[derive(Default)]
struct FakeVault {
    values: BTreeMap<String, Zeroizing<Vec<u8>>>,
    reads: usize,
    adds: usize,
    fail_read: Option<(usize, RawError)>,
    fail_add: Option<(bool, RawError)>,
    mutate_disk: Option<(usize, FakeFs, Vec<u8>)>,
    mutate_after_add: Option<(FakeFs, Vec<u8>)>,
    replace_on_read: Option<(usize, Zeroizing<Vec<u8>>)>,
}
fn key(reference: &CredentialRef) -> String {
    format!("{}:{}", reference.service(), reference.account())
}
impl FakeVault {
    fn seed(&mut self, record: &SecretRecord) {
        self.values
            .insert(key(record.identity().reference()), record.encode());
    }
}
impl RawStore for FakeVault {
    fn read(&mut self, reference: &CredentialRef) -> RawResult<Zeroizing<Vec<u8>>> {
        self.reads += 1;
        if self
            .mutate_disk
            .as_ref()
            .is_some_and(|(nth, _, _)| *nth == self.reads)
        {
            let (_, disk, bytes) = self.mutate_disk.take().unwrap();
            disk.0.borrow_mut().committed = Some(bytes);
        }
        if self
            .replace_on_read
            .as_ref()
            .is_some_and(|(nth, _)| *nth == self.reads)
        {
            let (_, bytes) = self.replace_on_read.take().unwrap();
            self.values.insert(key(reference), bytes);
        }
        if self
            .fail_read
            .as_ref()
            .is_some_and(|(nth, _)| *nth == self.reads)
        {
            return Err(self.fail_read.take().unwrap().1);
        }
        self.values
            .get(&key(reference))
            .map(|bytes| Zeroizing::new(bytes.to_vec()))
            .ok_or(RawError::Missing)
    }
    fn add(&mut self, reference: &CredentialRef, bytes: &[u8]) -> RawResult<()> {
        self.adds += 1;
        if self.values.contains_key(&key(reference)) {
            return Err(RawError::Duplicate);
        }
        let fault = self.fail_add.take();
        if fault.is_none_or(|(persist, _)| persist) {
            self.values
                .insert(key(reference), Zeroizing::new(bytes.to_vec()));
        }
        if let Some((disk, bytes)) = self.mutate_after_add.take() {
            disk.0.borrow_mut().committed = Some(bytes);
        }
        match fault {
            Some((_, error)) => Err(error),
            None => Ok(()),
        }
    }
}

fn verified(fs: &mut FakeFs, vault: &mut FakeVault, record: &SecretRecord) -> ManifestSnapshot {
    let prepared = fs.prepared(record);
    engine::install(fs, &prepared.token(), record, vault).unwrap()
}
fn changed_snapshot(current: &ManifestSnapshot) -> Vec<u8> {
    let mut other = current.clone();
    other.installation = [83; 32];
    for entry in &mut other.entries {
        let old = entry.intent.identity.clone();
        let reference = CredentialRef::new(
            other.installation,
            *old.reference().item_id(),
            old.reference().purpose(),
        )
        .unwrap();
        entry.intent.identity = match old.reference().purpose() {
            Purpose::Checkpoint => RecordIdentity::checkpoint(reference),
            Purpose::Pairing => RecordIdentity::pairing(reference, *old.intent_id().unwrap()),
            Purpose::Namespace => {
                RecordIdentity::namespace(reference, old.namespace_binding().unwrap().clone())
            }
        }
        .unwrap();
    }
    codec::encode(&other)
}

#[test]
fn public_store_factories_are_closed_before_any_path_or_native_access() {
    let path = Path::new("/aicharts-synthetic-never-open/canary");
    assert_eq!(
        ReferenceStore::initialize_new(path, INSTALLATION).err(),
        Some(closed())
    );
    assert_eq!(ReferenceStore::open_existing(path).err(), Some(closed()));
    assert_eq!(ReferenceStore::inspect_existing(path).err(), Some(closed()));
    assert_eq!(
        ReferenceStore::reconcile_initialization(path, INSTALLATION).err(),
        Some(closed())
    );
    // Even a unit-constructed facade cannot bypass the factory fence.
    let mut store = ReferenceStore { _private: () };
    let mut disk = FakeFs::default();
    let snapshot = disk.initialize();
    let secret = record(1, Purpose::Checkpoint, 41);
    assert_eq!(store.snapshot().err(), Some(closed()));
    assert_eq!(
        store.prepare(&snapshot.token(), &secret).err(),
        Some(closed())
    );
    #[cfg(target_os = "macos")]
    {
        let mut vault = Vault::new().unwrap(); // Pure platform check.
        assert_eq!(
            store
                .install_prepared(&snapshot.token(), &secret, &mut vault)
                .err(),
            Some(closed())
        );
        assert_eq!(
            store
                .reconcile_prepared(&snapshot.token(), secret.identity(), &mut vault)
                .err(),
            Some(closed())
        );
        assert_eq!(
            store
                .resolve_verified(&snapshot.token(), secret.identity(), &mut vault)
                .err(),
            Some(closed())
        );
    }
}

#[test]
fn prepared_then_verified_roundtrips_all_three_roles_without_secret_bytes() {
    let mut fs = FakeFs::default();
    let mut vault = FakeVault::default();
    let mut snapshot = fs.initialize();
    for (index, purpose) in [Purpose::Checkpoint, Purpose::Pairing, Purpose::Namespace]
        .into_iter()
        .enumerate()
    {
        let record = record(index as u16 + 1, purpose, 211);
        snapshot = engine::prepare(&mut fs, &snapshot.token(), &record).unwrap();
        assert_eq!(vault.adds, index);
        assert_eq!(
            snapshot.entries.last().unwrap().state,
            ReferenceState::Prepared
        );
        snapshot = engine::install(&mut fs, &snapshot.token(), &record, &mut vault).unwrap();
        let resolved =
            engine::resolve(&mut fs, &snapshot.token(), record.identity(), &mut vault).unwrap();
        assert_eq!(
            RecordIntent::from_record(&resolved),
            RecordIntent::from_record(&record)
        );
        let bytes = fs.bytes().unwrap();
        assert_eq!(codec::decode(&bytes).unwrap(), snapshot);
        assert!(!bytes
            .windows(32)
            .any(|window| window == [211; 32] || window == [212; 32]));
    }
    assert_eq!(snapshot.token().revision(), 6);
    fs.release_ok();
}

#[test]
fn codec_rejects_every_truncation_extra_bytes_checksum_and_unknown_fields() {
    let mut fs = FakeFs::default();
    let snapshot = fs.prepared(&record(1, Purpose::Namespace, 41));
    let bytes = codec::encode(&snapshot);
    assert_eq!(bytes.len(), 256);
    for cut in 0..bytes.len() {
        assert_eq!(
            codec::decode(&bytes[..cut]).err(),
            Some(Error::InvalidManifest)
        );
    }
    let mut extra = bytes.clone();
    extra.push(0);
    assert_eq!(codec::decode(&extra).err(), Some(Error::InvalidManifest));
    for index in 0..bytes.len() {
        let mut changed = bytes.clone();
        changed[index] ^= 1;
        assert_eq!(codec::decode(&changed).err(), Some(Error::InvalidManifest));
    }
    assert_eq!(
        codec::decode(&vec![0; MAX_MANIFEST_BYTES + 1]).err(),
        Some(Error::InvalidManifest)
    );
}

fn repair_checksum(bytes: &mut [u8]) {
    let split = bytes.len() - 32;
    let mut hash = Sha256::new();
    hash.update(b"aicharts:credential-manifest:v1\0");
    hash.update(&bytes[..split]);
    bytes[split..].copy_from_slice(&hash.finalize());
}
#[test]
fn codec_rejects_valid_checksum_structural_corruption_and_noncanonical_order() {
    let mut fs = FakeFs::default();
    let snapshot = fs.prepared(&record(1, Purpose::Checkpoint, 41));
    let bytes = codec::encode(&snapshot);
    for (index, value) in [
        (4, 2),
        (6, 1),
        (40, 99),
        (50, 1),
        (64, 4),
        (65, 3),
        (66, 1),
        (104, 1),
        (136, 1),
        (186, 1),
    ] {
        let mut bad = bytes.clone();
        bad[index] = value;
        repair_checksum(&mut bad);
        assert_eq!(codec::decode(&bad).err(), Some(Error::InvalidManifest));
    }
    let mut bad = bytes.clone();
    bad[8..40].fill(0);
    repair_checksum(&mut bad);
    assert_eq!(codec::decode(&bad).err(), Some(Error::InvalidManifest));
    let mut bad = bytes.clone();
    bad[72..104].fill(0);
    repair_checksum(&mut bad);
    assert_eq!(codec::decode(&bad).err(), Some(Error::InvalidManifest));
    let mut bad = snapshot.clone();
    bad.entries.push(bad.entries[0].clone());
    bad.revision = 2;
    assert_eq!(
        codec::decode(&codec::encode(&bad)).err(),
        Some(Error::InvalidManifest)
    );
    let mut vault = FakeVault::default();
    let snapshot = engine::install(
        &mut fs,
        &snapshot.token(),
        &record(1, Purpose::Checkpoint, 41),
        &mut vault,
    )
    .unwrap();
    let mut next =
        engine::prepare(&mut fs, &snapshot.token(), &record(2, Purpose::Pairing, 51)).unwrap();
    next.entries.swap(0, 1);
    assert_eq!(
        codec::decode(&codec::encode(&next)).err(),
        Some(Error::InvalidManifest)
    );
}

#[test]
fn codec_admits_zero_digest_without_inventing_hash_semantics() {
    let mut fs = FakeFs::default();
    let mut snapshot = fs.prepared(&record(1, Purpose::Checkpoint, 41));
    snapshot.entries[0].intent.commitment = [0; 32];
    assert_eq!(codec::decode(&codec::encode(&snapshot)).unwrap(), snapshot);
    assert_eq!(
        engine::install(
            &mut fs,
            &snapshot.token(),
            &record(1, Purpose::Checkpoint, 41),
            &mut FakeVault::default()
        )
        .err(),
        Some(Error::StaleSnapshot)
    );
}

#[test]
fn every_secret_byte_and_identity_dimension_changes_whole_record_commitment() {
    for purpose in [Purpose::Checkpoint, Purpose::Pairing, Purpose::Namespace] {
        let record = record(1, purpose, 41);
        let original = RecordIntent::from_record(&record);
        let bytes = record.encode();
        for index in 0..bytes.len() {
            let mut changed = bytes.clone();
            changed[index] ^= 1;
            if let Ok(record) = SecretRecord::decode(&changed) {
                assert_ne!(
                    RecordIntent::from_record(&record).commitment(),
                    original.commitment()
                );
            }
        }
    }
}

#[test]
fn initialize_never_adopts_or_overwrites_existing_or_invalid_state() {
    let mut fs = FakeFs::default();
    assert_eq!(
        engine::initialize(&mut fs, [0; 32]).err(),
        Some(Error::InvalidInstallation)
    );
    assert!(fs.0.borrow().events.is_empty());
    fs.initialize();
    let original = fs.bytes();
    assert_eq!(
        engine::initialize(&mut fs, INSTALLATION).err(),
        Some(Error::Conflict)
    );
    assert_eq!(fs.bytes(), original);
    fs.0.borrow_mut().committed = Some(vec![13]);
    assert_eq!(
        engine::initialize(&mut fs, INSTALLATION).err(),
        Some(Error::Conflict)
    );
    assert_eq!(
        engine::snapshot(&mut fs).err(),
        Some(Error::InvalidManifest)
    );
    assert_eq!(fs.bytes(), Some(vec![13]));
}

#[test]
fn initialization_reconciliation_reestablishes_durability_without_republication() {
    let mut fs = FakeFs::default();
    let initial = fs.initialize();
    let bytes = fs.bytes();
    fs.0.borrow_mut().events.clear();
    assert_eq!(
        engine::reconcile_initialization(&mut fs, INSTALLATION).unwrap(),
        initial
    );
    assert_eq!(fs.bytes(), bytes);
    let disk = fs.0.borrow();
    assert!(disk.events.contains(&Event::SyncCommitted));
    assert!(disk.events.contains(&Event::SyncDirectory));
    assert!(!disk.events.contains(&Event::Stage));
    assert!(!disk.events.contains(&Event::Publish));
    assert!(disk.candidate.is_none());
    drop(disk);
    fs.release_ok();
}

#[test]
fn initialization_reconciliation_preserves_original_intent_across_uncertainty() {
    for (event, effect) in [
        (Event::SyncCandidate, Effect::Before),
        (Event::Publish, Effect::Before),
        (Event::Publish, Effect::After),
        (Event::SyncDirectory, Effect::Before),
    ] {
        let mut fs = FakeFs::default();
        fs.fault(event, 1, effect);
        assert!(engine::initialize(&mut fs, INSTALLATION).is_err());
        fs.release_ok();
        let prior_bytes = fs.bytes();
        let prior_candidate = fs.0.borrow().candidate.clone();
        let mut restart = fs.clone();
        assert!(engine::reconcile_initialization(&mut restart, [12; 32]).is_err());
        assert_eq!(restart.bytes(), prior_bytes);
        assert!(restart.0.borrow().candidate == prior_candidate);
        restart.release_ok();
        let recovered = engine::reconcile_initialization(&mut restart, INSTALLATION).unwrap();
        assert_eq!(recovered.installation, INSTALLATION);
        assert_eq!(recovered.revision, 0);
        assert!(recovered.entries.is_empty());
        if let Some(candidate) = prior_candidate {
            assert_eq!(restart.bytes().as_deref(), Some(candidate.bytes.as_slice()));
        } else {
            assert_eq!(restart.bytes(), prior_bytes);
        }
        restart.release_ok();
    }
}

#[test]
fn initialization_reconciliation_refuses_advanced_invalid_or_changed_state() {
    let mut fs = FakeFs::default();
    assert_eq!(
        engine::reconcile_initialization(&mut fs, [0; 32]).err(),
        Some(Error::InvalidInstallation)
    );
    assert!(fs.0.borrow().events.is_empty());
    let advanced = fs.prepared(&record(1, Purpose::Checkpoint, 41));
    let bytes = fs.bytes();
    assert_eq!(
        engine::reconcile_initialization(&mut fs, INSTALLATION).err(),
        Some(Error::Conflict)
    );
    assert_eq!(fs.bytes(), bytes);
    fs.release_ok();

    let mut initial = FakeFs::default();
    initial.initialize();
    let bytes = initial.bytes();
    initial.fault(Event::SyncCommitted, 1, Effect::Before);
    assert_eq!(
        engine::reconcile_initialization(&mut initial, INSTALLATION).err(),
        Some(Error::StorageUnavailable)
    );
    assert_eq!(initial.bytes(), bytes);
    initial.release_ok();
    initial.0.borrow_mut().on_sync_committed = Some(codec::encode(&advanced));
    assert_eq!(
        engine::reconcile_initialization(&mut initial, INSTALLATION).err(),
        Some(Error::StaleSnapshot)
    );
    assert_eq!(initial.bytes(), Some(codec::encode(&advanced)));
    initial.release_ok();

    initial.0.borrow_mut().committed = Some(vec![99; 96]);
    let corrupt = initial.bytes();
    assert!(engine::reconcile_initialization(&mut initial, INSTALLATION).is_err());
    assert_eq!(initial.bytes(), corrupt);
    initial.release_ok();
}

#[test]
fn stale_token_fails_before_stage_or_vault_effects_in_all_operations() {
    let mut fs = FakeFs::default();
    let empty = fs.initialize();
    let record = record(1, Purpose::Checkpoint, 41);
    let prepared = engine::prepare(&mut fs, &empty.token(), &record).unwrap();
    fs.0.borrow_mut().events.clear();
    let mut vault = FakeVault::default();
    assert_eq!(
        engine::prepare(&mut fs, &empty.token(), &record).err(),
        Some(Error::StaleSnapshot)
    );
    assert_eq!(
        engine::install(&mut fs, &empty.token(), &record, &mut vault).err(),
        Some(Error::StaleSnapshot)
    );
    assert_eq!(
        engine::reconcile(&mut fs, &empty.token(), record.identity(), &mut vault).err(),
        Some(Error::StaleSnapshot)
    );
    assert_eq!(
        engine::resolve(&mut fs, &empty.token(), record.identity(), &mut vault).err(),
        Some(Error::StaleSnapshot)
    );
    assert_eq!((vault.adds, vault.reads), (0, 0));
    assert!(!fs.0.borrow().events.contains(&Event::Stage));
    assert_eq!(engine::snapshot(&mut fs).unwrap(), prepared);
}

#[test]
fn exact_prepare_retry_is_read_only_but_conflicting_secret_role_or_installation_refuses() {
    let mut fs = FakeFs::default();
    let record = record(1, Purpose::Checkpoint, 41);
    let prepared = fs.prepared(&record);
    fs.0.borrow_mut().events.clear();
    assert_eq!(
        engine::prepare(&mut fs, &prepared.token(), &record).unwrap(),
        prepared
    );
    assert!(!fs.0.borrow().events.contains(&Event::Stage));
    for other in [
        self::record(1, Purpose::Checkpoint, 42),
        self::record(1, Purpose::Pairing, 41),
    ] {
        assert_eq!(
            engine::prepare(&mut fs, &prepared.token(), &other).err(),
            Some(Error::Conflict)
        );
    }
    let other = SecretRecord::checkpoint(
        CredentialRef::new([91; 32], [1; 32], Purpose::Checkpoint).unwrap(),
        Secret32::new([41; 32]).unwrap(),
    )
    .unwrap();
    assert_eq!(
        engine::prepare(&mut fs, &prepared.token(), &other).err(),
        Some(Error::InvalidInstallation)
    );
    assert_eq!(
        engine::prepare(
            &mut fs,
            &prepared.token(),
            &self::record(2, Purpose::Checkpoint, 43)
        )
        .err(),
        Some(Error::PendingOperation)
    );
}

#[test]
fn full_manifest_retains_all_256_references_and_rejects_257_without_eviction() {
    let mut fs = FakeFs::default();
    let mut vault = FakeVault::default();
    let mut state = fs.initialize();
    for id in 1..=256 {
        let record = record(id, Purpose::Checkpoint, 41);
        state = engine::prepare(&mut fs, &state.token(), &record).unwrap();
        state = engine::install(&mut fs, &state.token(), &record, &mut vault).unwrap();
    }
    assert_eq!(fs.bytes().unwrap().len(), MAX_MANIFEST_BYTES);
    assert_eq!(state.token().revision(), 512);
    let before = fs.bytes();
    assert_eq!(
        engine::prepare(
            &mut fs,
            &state.token(),
            &record(257, Purpose::Checkpoint, 41)
        )
        .err(),
        Some(Error::Limit)
    );
    assert_eq!(fs.bytes(), before);
    assert_eq!(state.entries().len(), 256);
}

#[test]
fn every_prepublication_fault_preserves_committed_state_and_original_candidate() {
    for (event, effect) in [
        (Event::Lock, Effect::Before),
        (Event::Read, Effect::Before),
        (Event::Stage, Effect::Before),
        (Event::Stage, Effect::After),
        (Event::SyncCandidate, Effect::Before),
    ] {
        let mut fs = FakeFs::default();
        let empty = fs.initialize();
        let before = fs.bytes();
        fs.fault(event, 1, effect);
        assert_eq!(
            engine::prepare(&mut fs, &empty.token(), &record(1, Purpose::Checkpoint, 41)).err(),
            Some(Error::StorageUnavailable)
        );
        assert_eq!(fs.bytes(), before);
        fs.release_ok();
        let mut restart = fs.clone();
        assert_eq!(engine::snapshot(&mut restart).unwrap(), empty);
        let prepared = engine::prepare(
            &mut restart,
            &empty.token(),
            &record(1, Purpose::Checkpoint, 41),
        )
        .unwrap();
        assert_eq!(prepared.entries[0].state, ReferenceState::Prepared);
    }
}

#[test]
fn every_postpublication_failure_is_unknown_and_restart_reads_only_committed_state() {
    for (event, effect) in [
        (Event::Publish, Effect::Before),
        (Event::Publish, Effect::After),
        (Event::SyncDirectory, Effect::Before),
    ] {
        let mut fs = FakeFs::default();
        let empty = fs.initialize();
        fs.fault(event, 1, effect);
        let record = record(1, Purpose::Checkpoint, 41);
        assert_eq!(
            engine::prepare(&mut fs, &empty.token(), &record).err(),
            Some(Error::OutcomeUnknown)
        );
        fs.release_ok();
        let mut restart = fs.clone();
        let observed = engine::snapshot(&mut restart).unwrap();
        if event == Event::Publish && matches!(effect, Effect::Before) {
            assert_eq!(observed, empty);
            assert!(restart.0.borrow().candidate.is_some());
            assert_eq!(
                engine::prepare(&mut restart, &observed.token(), &record)
                    .unwrap()
                    .entries[0]
                    .state,
                ReferenceState::Prepared
            );
        } else {
            assert_eq!(observed.entries[0].state, ReferenceState::Prepared);
            assert_eq!(
                observed.entries[0].intent,
                RecordIntent::from_record(&record)
            );
            assert_eq!(
                engine::prepare(&mut restart, &empty.token(), &record).err(),
                Some(Error::StaleSnapshot)
            );
        }
    }
}

#[test]
fn failed_or_wrong_committed_readback_never_reports_publication_success() {
    // prepare reads: initial expected, pre-stage expected, post-stage expected,
    // then exact post-publication bytes.
    for effect in [Effect::Before, Effect::WrongRead] {
        let mut fs = FakeFs::default();
        let empty = fs.initialize();
        fs.fault(Event::Read, 4, effect);
        assert_eq!(
            engine::prepare(&mut fs, &empty.token(), &record(1, Purpose::Checkpoint, 41)).err(),
            Some(Error::OutcomeUnknown)
        );
        assert_eq!(
            engine::snapshot(&mut fs).unwrap().entries[0].state,
            ReferenceState::Prepared
        );
    }
}

#[test]
fn retained_candidate_is_not_adopted_or_replaced_for_a_different_operation() {
    let mut fs = FakeFs::default();
    let empty = fs.initialize();
    fs.fault(Event::SyncCandidate, 1, Effect::Before);
    let first = record(1, Purpose::Checkpoint, 41);
    assert_eq!(
        engine::prepare(&mut fs, &empty.token(), &first).err(),
        Some(Error::StorageUnavailable)
    );
    let candidate = fs.0.borrow().candidate.clone().unwrap();
    let mut restart = fs.clone();
    assert_eq!(engine::snapshot(&mut restart).unwrap(), empty);
    assert_eq!(
        engine::prepare(
            &mut restart,
            &empty.token(),
            &record(2, Purpose::Checkpoint, 42)
        )
        .err(),
        Some(Error::RecoveryRequired)
    );
    assert!(restart.0.borrow().candidate.as_ref() == Some(&candidate));
    assert_eq!(
        engine::prepare(&mut restart, &empty.token(), &first)
            .unwrap()
            .entries[0]
            .intent,
        RecordIntent::from_record(&first)
    );
}

#[test]
fn stale_candidate_cannot_publish_after_committed_state_changed() {
    let mut fs = FakeFs::default();
    let empty = fs.initialize();
    fs.fault(Event::SyncCandidate, 1, Effect::Before);
    let record = record(1, Purpose::Checkpoint, 41);
    engine::prepare(&mut fs, &empty.token(), &record).unwrap_err();
    let different = changed_snapshot(&empty);
    fs.0.borrow_mut().committed = Some(different.clone());
    assert_eq!(
        engine::prepare(&mut fs, &empty.token(), &record).err(),
        Some(Error::StaleSnapshot)
    );
    assert_eq!(fs.bytes(), Some(different));
    assert!(fs.0.borrow().candidate.is_some());
}

#[test]
fn changed_committed_token_after_stage_stops_before_publication() {
    let mut fs = FakeFs::default();
    let empty = fs.initialize();
    let different = changed_snapshot(&empty);
    fs.0.borrow_mut().on_sync = Some(different.clone());
    fs.0.borrow_mut().events.clear();
    assert_eq!(
        engine::prepare(&mut fs, &empty.token(), &record(1, Purpose::Checkpoint, 41)).err(),
        Some(Error::StaleSnapshot)
    );
    assert!(!fs.0.borrow().events.contains(&Event::Publish));
    assert_eq!(fs.bytes(), Some(different));
    assert!(fs.0.borrow().candidate.is_some());
}

#[test]
fn install_requires_prepared_exact_commitment_before_any_vault_access() {
    let mut fs = FakeFs::default();
    let original = record(1, Purpose::Checkpoint, 41);
    let prepared = fs.prepared(&original);
    let mut vault = FakeVault::default();
    for other in [
        record(1, Purpose::Checkpoint, 42),
        record(2, Purpose::Checkpoint, 41),
    ] {
        assert_eq!(
            engine::install(&mut fs, &prepared.token(), &other, &mut vault).err(),
            Some(Error::Conflict)
        );
    }
    assert_eq!((vault.reads, vault.adds), (0, 0));
    assert_eq!(
        engine::resolve(&mut fs, &prepared.token(), original.identity(), &mut vault).err(),
        Some(Error::NotVerified)
    );
    assert_eq!((vault.reads, vault.adds), (0, 0));
}

#[test]
fn missing_or_inaccessible_reconcile_preserves_the_sole_prepared_record() {
    for error in [
        RawError::Missing,
        RawError::InteractionRequired,
        RawError::AccessDenied,
        RawError::Unavailable,
        RawError::Invalid,
        RawError::Unknown,
    ] {
        let mut fs = FakeFs::default();
        let record = record(1, Purpose::Pairing, 41);
        let prepared = fs.prepared(&record);
        let before = fs.bytes();
        let mut vault = FakeVault {
            fail_read: Some((1, error)),
            ..Default::default()
        };
        assert_eq!(
            engine::reconcile(&mut fs, &prepared.token(), record.identity(), &mut vault).err(),
            Some(Error::Custody(error.fixed()))
        );
        assert_eq!(fs.bytes(), before);
        assert_eq!(vault.adds, 0);
        fs.release_ok();
    }
}

#[test]
fn uncertain_vault_add_never_continues_and_exact_readback_recovers_only_committed_item() {
    for persisted in [false, true] {
        let mut fs = FakeFs::default();
        let record = record(1, Purpose::Pairing, 41);
        let prepared = fs.prepared(&record);
        let before = fs.bytes();
        let mut vault = FakeVault {
            fail_add: Some((persisted, RawError::Unknown)),
            ..Default::default()
        };
        assert_eq!(
            engine::install(&mut fs, &prepared.token(), &record, &mut vault).err(),
            Some(Error::Custody(crate::Error::OutcomeUnknown))
        );
        assert_eq!((vault.reads, vault.adds), (1, 1));
        assert_eq!(fs.bytes(), before);
        let mut restart = fs.clone();
        let result = engine::reconcile(
            &mut restart,
            &prepared.token(),
            record.identity(),
            &mut vault,
        );
        if persisted {
            assert_eq!(
                result.unwrap().entries[0].state,
                ReferenceState::CustodyVerified
            );
        } else {
            assert_eq!(result.err(), Some(Error::Custody(crate::Error::Missing)));
            assert_eq!(fs.bytes(), before);
            assert_eq!(
                engine::install(&mut restart, &prepared.token(), &record, &mut vault)
                    .unwrap()
                    .entries[0]
                    .state,
                ReferenceState::CustodyVerified
            );
        }
        assert_eq!(vault.adds, if persisted { 1 } else { 2 });
    }
}

#[test]
fn successful_add_requires_a_fresh_matching_readback_before_verified_publication() {
    let mut fs = FakeFs::default();
    let record = record(1, Purpose::Checkpoint, 41);
    let prepared = fs.prepared(&record);
    let before = fs.bytes();
    let replacement = self::record(1, Purpose::Checkpoint, 42);
    let mut vault = FakeVault {
        replace_on_read: Some((3, replacement.encode())),
        ..Default::default()
    };
    assert_eq!(
        engine::install(&mut fs, &prepared.token(), &record, &mut vault).err(),
        Some(Error::Conflict)
    );
    assert_eq!((vault.adds, vault.reads), (1, 3));
    assert_eq!(fs.bytes(), before);
}

#[test]
fn conflicting_or_malformed_vault_readback_is_never_replaced() {
    for value in [
        record(1, Purpose::Pairing, 42).encode(),
        Zeroizing::new(vec![99; 168]),
    ] {
        let mut fs = FakeFs::default();
        let record = record(1, Purpose::Pairing, 41);
        let prepared = fs.prepared(&record);
        let before = fs.bytes();
        let mut vault = FakeVault::default();
        vault
            .values
            .insert(key(record.identity().reference()), value);
        assert!(matches!(
            engine::reconcile(&mut fs, &prepared.token(), record.identity(), &mut vault),
            Err(Error::Conflict | Error::Custody(crate::Error::InvalidRecord))
        ));
        assert_eq!(vault.adds, 0);
        assert_eq!(fs.bytes(), before);
    }
}

#[test]
fn lost_verified_publication_reconciles_old_or_new_state_without_a_second_add() {
    for effect in [Effect::Before, Effect::After] {
        let mut fs = FakeFs::default();
        let record = record(1, Purpose::Namespace, 41);
        let prepared = fs.prepared(&record);
        let mut vault = FakeVault::default();
        fs.fault(Event::Publish, 1, effect);
        assert_eq!(
            engine::install(&mut fs, &prepared.token(), &record, &mut vault).err(),
            Some(Error::OutcomeUnknown)
        );
        assert_eq!(vault.adds, 1);
        let mut restart = fs.clone();
        let current = engine::snapshot(&mut restart).unwrap();
        let recovered = engine::reconcile(
            &mut restart,
            &current.token(),
            record.identity(),
            &mut vault,
        )
        .unwrap();
        assert_eq!(recovered.entries[0].state, ReferenceState::CustodyVerified);
        assert_eq!(vault.adds, 1);
    }
}

#[test]
fn current_token_is_rechecked_after_vault_add_before_further_vault_read() {
    let mut fs = FakeFs::default();
    let record = record(1, Purpose::Checkpoint, 41);
    let prepared = fs.prepared(&record);
    let changed = changed_snapshot(&prepared);
    let mut vault = FakeVault {
        mutate_after_add: Some((fs.clone(), changed.clone())),
        ..Default::default()
    };
    assert_eq!(
        engine::install(&mut fs, &prepared.token(), &record, &mut vault).err(),
        Some(Error::StaleSnapshot)
    );
    assert_eq!((vault.adds, vault.reads), (1, 2));
    assert_eq!(fs.bytes(), Some(changed));
}

#[test]
fn current_token_is_rechecked_after_reconcile_and_verified_resolve_reads() {
    for resolved in [false, true] {
        let mut fs = FakeFs::default();
        let record = record(1, Purpose::Checkpoint, 41);
        let mut vault = FakeVault::default();
        let current = if resolved {
            verified(&mut fs, &mut vault, &record)
        } else {
            let current = fs.prepared(&record);
            vault.seed(&record);
            current
        };
        let changed = changed_snapshot(&current);
        let before_adds = vault.adds;
        vault.mutate_disk = Some((vault.reads + 1, fs.clone(), changed.clone()));
        let error = if resolved {
            engine::resolve(&mut fs, &current.token(), record.identity(), &mut vault).err()
        } else {
            engine::reconcile(&mut fs, &current.token(), record.identity(), &mut vault).err()
        };
        assert_eq!(error, Some(Error::StaleSnapshot));
        assert_eq!(fs.bytes(), Some(changed));
        assert_eq!(vault.adds, before_adds);
    }
}

#[test]
fn every_resolve_rechecks_commitment_and_missing_never_becomes_a_new_installation() {
    let mut fs = FakeFs::default();
    let record = record(1, Purpose::Checkpoint, 41);
    let mut vault = FakeVault::default();
    let current = verified(&mut fs, &mut vault, &record);
    let before = fs.bytes();
    vault.seed(&self::record(1, Purpose::Checkpoint, 42));
    assert_eq!(
        engine::resolve(&mut fs, &current.token(), record.identity(), &mut vault).err(),
        Some(Error::Conflict)
    );
    vault.values.clear();
    assert_eq!(
        engine::resolve(&mut fs, &current.token(), record.identity(), &mut vault).err(),
        Some(Error::Custody(crate::Error::Missing))
    );
    assert_eq!(vault.adds, 1);
    assert_eq!(fs.bytes(), before);
}

#[test]
fn verified_install_retry_checks_custody_without_creating_missing_items() {
    let mut fs = FakeFs::default();
    let record = record(1, Purpose::Checkpoint, 41);
    let mut vault = FakeVault::default();
    let current = verified(&mut fs, &mut vault, &record);
    let before = fs.bytes();
    assert_eq!(
        engine::install(&mut fs, &current.token(), &record, &mut vault).unwrap(),
        current
    );
    vault.values.clear();
    assert_eq!(
        engine::install(&mut fs, &current.token(), &record, &mut vault).err(),
        Some(Error::Custody(crate::Error::Missing))
    );
    assert_eq!(vault.adds, 1);
    assert_eq!(fs.bytes(), before);
}

#[test]
fn storage_guard_is_released_on_failure_and_unwind_without_recovery_mutation() {
    let mut fs = FakeFs::default();
    fs.0.borrow_mut().locked = true;
    assert_eq!(engine::snapshot(&mut fs).err(), Some(Error::Busy));
    assert!(fs.0.borrow().locked);
    fs.0.borrow_mut().locked = false;
    assert_eq!(engine::snapshot(&mut fs).err(), Some(Error::Missing));
    fs.release_ok();
    struct PanicFs(FakeFs);
    impl Storage for PanicFs {
        fn lock(&mut self) -> Result<()> {
            self.0.lock()
        }
        fn unlock(&mut self) {
            self.0.unlock();
        }
        fn read_committed(&mut self, _: usize) -> Result<Option<Vec<u8>>> {
            panic!("synthetic fault")
        }
        fn stage(&mut self, _: &Candidate) -> Result<()> {
            unreachable!()
        }
        fn sync_committed(&mut self) -> Result<()> {
            unreachable!()
        }
        fn sync_candidate(&mut self) -> Result<()> {
            unreachable!()
        }
        fn publish(&mut self, _: &Candidate) -> Result<()> {
            unreachable!()
        }
        fn sync_directory(&mut self) -> Result<()> {
            unreachable!()
        }
    }
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        engine::snapshot(&mut PanicFs(fs.clone()))
    }));
    assert!(result.is_err());
    fs.release_ok();
    assert!(fs.bytes().is_none());
}

#[test]
fn projections_and_fixed_errors_never_contain_secret_canaries_or_paths() {
    let record = record(1, Purpose::Pairing, 211);
    let intent = RecordIntent::from_record(&record);
    let mut fs = FakeFs::default();
    let state = fs.prepared(&record);
    let projected = format!("{intent:?} {state:?} {:?}", state.token());
    assert!(!projected.contains(&"211, ".repeat(8)));
    assert!(!projected.contains(&"212, ".repeat(8)));
    for error in [
        Error::BackendUnqualified,
        Error::UnsupportedPlatform,
        Error::InvalidManifest,
        Error::InvalidInstallation,
        Error::Missing,
        Error::Conflict,
        Error::StaleSnapshot,
        Error::PendingOperation,
        Error::NotPrepared,
        Error::NotVerified,
        Error::Limit,
        Error::Busy,
        Error::StorageUnavailable,
        Error::RecoveryRequired,
        Error::OutcomeUnknown,
        Error::Custody(crate::Error::AccessDenied),
    ] {
        assert_eq!(error.to_string(), error.code());
        assert!(!error.to_string().contains("canary"));
        assert!(std::error::Error::source(&error).is_none());
    }
}

#[test]
fn restart_reestablishes_prepared_durability_before_any_vault_effect() {
    for (event, nth) in [
        (Event::SyncCommitted, 1),
        (Event::SyncDirectory, 1),
        (Event::Read, 3),
    ] {
        let mut fs = FakeFs::default();
        let empty = fs.initialize();
        let record = record(1, Purpose::Pairing, 41);
        fs.fault(Event::SyncDirectory, 1, Effect::Before);
        assert_eq!(
            engine::prepare(&mut fs, &empty.token(), &record).err(),
            Some(Error::OutcomeUnknown)
        );
        let mut restart = fs.clone();
        let observed = engine::snapshot(&mut restart).unwrap();
        assert_eq!(observed.entries[0].state, ReferenceState::Prepared);
        restart.fault(event, nth, Effect::Before);
        let mut vault = FakeVault::default();
        assert_eq!(
            engine::install(&mut restart, &observed.token(), &record, &mut vault).err(),
            Some(Error::StorageUnavailable)
        );
        assert_eq!((vault.reads, vault.adds), (0, 0));
        assert_eq!(engine::snapshot(&mut restart).unwrap(), observed);
        let result = engine::install(&mut restart, &observed.token(), &record, &mut vault).unwrap();
        assert_eq!(result.entries[0].state, ReferenceState::CustodyVerified);
        assert_eq!(vault.adds, 1);
    }
}

#[test]
fn reconcile_and_resolve_fail_before_vault_reads_when_committed_sync_fails() {
    for resolved in [false, true] {
        let mut fs = FakeFs::default();
        let record = record(1, Purpose::Checkpoint, 41);
        let mut vault = FakeVault::default();
        let current = if resolved {
            verified(&mut fs, &mut vault, &record)
        } else {
            let prepared = fs.prepared(&record);
            vault.seed(&record);
            prepared
        };
        let counts = (vault.reads, vault.adds);
        let before = fs.bytes();
        fs.fault(Event::SyncCommitted, 1, Effect::Before);
        let error = if resolved {
            engine::resolve(&mut fs, &current.token(), record.identity(), &mut vault).err()
        } else {
            engine::reconcile(&mut fs, &current.token(), record.identity(), &mut vault).err()
        };
        assert_eq!(error, Some(Error::StorageUnavailable));
        assert_eq!((vault.reads, vault.adds), counts);
        assert_eq!(fs.bytes(), before);
    }
}

#[test]
fn durability_recheck_refuses_concurrent_token_change_before_vault_effects() {
    let mut fs = FakeFs::default();
    let record = record(1, Purpose::Checkpoint, 41);
    let prepared = fs.prepared(&record);
    let changed = changed_snapshot(&prepared);
    fs.0.borrow_mut().on_sync_committed = Some(changed.clone());
    let mut vault = FakeVault::default();
    assert_eq!(
        engine::install(&mut fs, &prepared.token(), &record, &mut vault).err(),
        Some(Error::StaleSnapshot)
    );
    assert_eq!((vault.reads, vault.adds), (0, 0));
    assert_eq!(fs.bytes(), Some(changed));
}
