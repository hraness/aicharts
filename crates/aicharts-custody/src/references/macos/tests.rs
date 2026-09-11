//! Disposable APFS fixtures only. Native vault/provider/source data is never read.
use super::*;
use crate::store::{RawError, RawResult, RawStore};
use crate::{
    references::{engine, ManifestSnapshot, MAX_MANIFEST_BYTES},
    CredentialRef, Purpose, Secret32, SecretRecord,
};
use sha2::{Digest, Sha256};
use std::{
    fs::{self as stdfs, DirBuilder, File, OpenOptions},
    io::Write,
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use zeroize::Zeroizing;

static NEXT: AtomicU64 = AtomicU64::new(0);
const INSTALLATION: [u8; 32] = [31; 32];

struct Fixture {
    path: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        // Keep Unix-domain socket fixture paths below Darwin's sun_path limit.
        let path = Path::new("/private/tmp").join(format!(
            "aic-ref-{}-{stamp}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        DirBuilder::new().mode(0o700).create(&path).unwrap();
        Self { path }
    }
    fn anchor(&self) -> OwnedFd {
        File::open(&self.path).unwrap().into()
    }
    fn dir(&self) -> PathBuf {
        self.path.join(DIRECTORY)
    }
    fn at(&self, name: &str) -> PathBuf {
        self.dir().join(name)
    }
    fn create(&self) -> MacStorage {
        MacStorage::create_new_at(self.anchor()).unwrap()
    }
    fn open(&self) -> MacStorage {
        MacStorage::open_existing_at(self.anchor()).unwrap()
    }
    fn initialized(&self) -> (MacStorage, ManifestSnapshot) {
        let mut storage = self.create();
        let snapshot = engine::initialize(&mut storage, INSTALLATION).unwrap();
        (storage, snapshot)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        stdfs::remove_dir_all(&self.path).unwrap();
    }
}
fn write_new(path: &Path, bytes: &[u8]) {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .unwrap();
    file.write_all(bytes).unwrap();
}
fn record(item: u8) -> SecretRecord {
    SecretRecord::checkpoint(
        CredentialRef::new(INSTALLATION, [item; 32], Purpose::Checkpoint).unwrap(),
        Secret32::new([53; 32]).unwrap(),
    )
    .unwrap()
}
fn initial() -> Candidate {
    Candidate {
        expected: None,
        bytes: codec::encode(&ManifestSnapshot {
            installation: INSTALLATION,
            revision: 0,
            entries: vec![],
        }),
    }
}
fn prepare_candidate(snapshot: &ManifestSnapshot, item: u8) -> Candidate {
    let mut next = snapshot.clone();
    next.entries.push(crate::references::ReferenceEntry {
        intent: crate::references::RecordIntent::from_record(&record(item)),
        state: crate::references::ReferenceState::Prepared,
    });
    next.entries
        .sort_by_key(|entry| *entry.intent.identity.reference().item_id());
    next.revision += 1;
    Candidate {
        expected: Some(snapshot.token()),
        bytes: codec::encode(&next),
    }
}
fn fail_once(storage: &mut MacStorage, wanted: Phase) {
    let mut fired = false;
    storage.hook = Some(Box::new(move |phase| {
        if !fired && phase == wanted {
            fired = true;
            Err(Error::StorageUnavailable)
        } else {
            Ok(())
        }
    }));
}
fn checksum(bytes: &mut [u8]) {
    let n = bytes.len() - 32;
    let mut hash = Sha256::new();
    hash.update(b"aicharts:credential-reference-file:v1\0");
    hash.update(&bytes[..n]);
    bytes[n..].copy_from_slice(&hash.finalize());
}

#[derive(Default)]
struct FakeVault {
    value: Option<(CredentialRef, Zeroizing<Vec<u8>>)>,
    reads: usize,
    adds: usize,
}
impl RawStore for FakeVault {
    fn read(&mut self, reference: &CredentialRef) -> RawResult<Zeroizing<Vec<u8>>> {
        self.reads += 1;
        match self.value.as_ref() {
            Some((identity, bytes)) if identity == reference => Ok(Zeroizing::new(bytes.to_vec())),
            _ => Err(RawError::Missing),
        }
    }
    fn add(&mut self, reference: &CredentialRef, bytes: &[u8]) -> RawResult<()> {
        self.adds += 1;
        if self.value.is_some() {
            return Err(RawError::Duplicate);
        }
        self.value = Some((reference.clone(), Zeroizing::new(bytes.to_vec())));
        Ok(())
    }
}
fn acl(path: &Path, rule: &str) {
    let status = std::process::Command::new("/bin/chmod")
        .arg("+a")
        .arg(rule)
        .arg(path)
        .status()
        .unwrap();
    assert!(status.success());
}

#[test]
fn envelope_roundtrip_has_exact_frozen_header_and_owned_payload() {
    let value = initial();
    let bytes = envelope::encode(&value).unwrap();
    assert_eq!(bytes.len(), 192);
    assert_eq!(&bytes[..4], b"AICM");
    assert_eq!(&bytes[4..6], &1u16.to_le_bytes());
    assert_eq!(&bytes[6..56], &[0; 50]);
    assert_eq!(&bytes[56..60], &96u32.to_le_bytes());
    assert_eq!(&bytes[60..64], &[0; 4]);
    assert_eq!(envelope::decode(&bytes).unwrap().bytes, value.bytes);
    assert_eq!(envelope::decode(&bytes).unwrap().expected, None);
    let mut owned = envelope::decode(&bytes).unwrap();
    owned.bytes.fill(0);
    assert_eq!(envelope::decode(&bytes).unwrap().bytes, value.bytes);
}

#[test]
fn envelope_refuses_each_corruption_truncation_extension_and_reserved_field() {
    let bytes = envelope::encode(&initial()).unwrap();
    for end in 0..bytes.len() {
        assert!(envelope::decode(&bytes[..end]).is_err());
    }
    for offset in 0..bytes.len() {
        let mut bad = bytes.clone();
        bad[offset] ^= 1;
        assert!(envelope::decode(&bad).is_err(), "offset {offset}");
    }
    for offset in [0, 4, 6, 7, 8, 9, 15, 16, 23, 24, 55, 56, 59, 60, 63] {
        let mut bad = bytes.clone();
        bad[offset] = 9;
        checksum(&mut bad);
        assert!(
            envelope::decode(&bad).is_err(),
            "rechecksummed offset {offset}"
        );
    }
    let mut extra = bytes;
    extra.push(0);
    assert!(envelope::decode(&extra).is_err());
    assert!(envelope::decode(&vec![0; envelope::MAX_BYTES + 1]).is_err());
}

#[test]
fn envelope_requires_initial_or_exact_next_revision_and_retains_predecessor() {
    let snapshot = codec::decode(&initial().bytes).unwrap();
    let valid = prepare_candidate(&snapshot, 1);
    let decoded = envelope::decode(&envelope::encode(&valid).unwrap()).unwrap();
    assert_eq!(decoded.expected, valid.expected);
    assert_eq!(decoded.bytes, valid.bytes);
    let mut bad = valid.clone();
    bad.expected = None;
    assert!(envelope::encode(&bad).is_err());
    for revision in [1, 2, u64::MAX] {
        bad.expected = Some(crate::references::ManifestToken {
            revision,
            digest: [0; 32],
        });
        assert!(envelope::encode(&bad).is_err());
    }
    // Digests have no reserved zero sentinel when the presence flag is set.
    bad.expected = Some(crate::references::ManifestToken {
        revision: 0,
        digest: [0; 32],
    });
    assert!(envelope::encode(&bad).is_ok());
    bad = initial();
    bad.expected = Some(snapshot.token());
    assert!(envelope::encode(&bad).is_err());
}

#[test]
fn real_apfs_initialize_prepare_reopen_and_private_facade_stays_closed() {
    let f = Fixture::new();
    let (mut storage, initial) = f.initialized();
    assert!(storage.active_lock.is_none());
    assert!(io::fcntl_getfd(&storage.anchor)
        .unwrap()
        .contains(FdFlags::CLOEXEC));
    let first = engine::prepare(&mut storage, &initial.token(), &record(1)).unwrap();
    assert_eq!(first.token().revision(), 1);
    assert!(!f.at(PENDING).exists());
    assert_eq!(f.dir().metadata().unwrap().mode() & 0o7777, 0o700);
    for name in [LOCK, CURRENT] {
        let meta = f.at(name).metadata().unwrap();
        assert_eq!(meta.mode() & 0o7777, 0o600);
        assert_eq!(meta.nlink(), 1);
    }
    assert_eq!(f.at(LOCK).metadata().unwrap().len(), 0);
    drop(storage);
    let mut reopened = f.open();
    assert_eq!(engine::snapshot(&mut reopened).unwrap(), first);
    assert_eq!(
        engine::prepare(&mut reopened, &first.token(), &record(1)).unwrap(),
        first
    );
    assert_eq!(
        crate::references::ReferenceStore::open_existing(&f.dir()).err(),
        Some(Error::BackendUnqualified)
    );
    assert_eq!(
        crate::references::ReferenceStore::initialize_new(&f.dir(), INSTALLATION).err(),
        Some(Error::BackendUnqualified)
    );
}

#[test]
fn constructors_do_not_adopt_empty_partial_or_foreign_structures() {
    let f = Fixture::new();
    assert_eq!(
        MacStorage::open_existing_at(f.anchor()).err(),
        Some(Error::Missing)
    );
    DirBuilder::new().mode(0o700).create(f.dir()).unwrap();
    assert_eq!(
        MacStorage::create_new_at(f.anchor()).err(),
        Some(Error::Conflict)
    );
    assert_eq!(
        MacStorage::open_existing_at(f.anchor()).err(),
        Some(Error::RecoveryRequired)
    );
    write_new(&f.at(LOCK), &[]);
    assert_eq!(
        MacStorage::open_existing_at(f.anchor()).err(),
        Some(Error::RecoveryRequired)
    );
    write_new(&f.at(PENDING), &[1, 2, 3]);
    assert_eq!(
        MacStorage::open_existing_at(f.anchor()).err(),
        Some(Error::RecoveryRequired)
    );
    assert_eq!(stdfs::read(f.at(PENDING)).unwrap(), [1, 2, 3]);
}

#[test]
fn complete_initial_candidate_reopens_only_for_exact_original_retry() {
    let f = Fixture::new();
    let mut storage = f.create();
    fail_once(&mut storage, Phase::BeforeCandidateSync);
    assert_eq!(
        engine::initialize(&mut storage, INSTALLATION).err(),
        Some(Error::StorageUnavailable)
    );
    let retained = stdfs::read(f.at(PENDING)).unwrap();
    drop(storage);
    let mut storage = f.open();
    assert_eq!(
        engine::initialize(&mut storage, [92; 32]).err(),
        Some(Error::RecoveryRequired)
    );
    assert_eq!(stdfs::read(f.at(PENDING)).unwrap(), retained);
    let initial = engine::initialize(&mut storage, INSTALLATION).unwrap();
    assert_eq!(initial.token().revision(), 0);
    assert!(!f.at(PENDING).exists());
}

#[test]
fn independent_handles_serialize_and_accept_cooperative_current_inode_replacement() {
    let f = Fixture::new();
    let (mut first, initial) = f.initialized();
    let mut second = f.open();
    first.lock().unwrap();
    assert_eq!(second.lock().err(), Some(Error::Busy));
    assert_eq!(
        MacStorage::open_existing_at(f.anchor()).err(),
        Some(Error::Busy)
    );
    first.unlock();
    let next = engine::prepare(&mut first, &initial.token(), &record(1)).unwrap();
    assert_eq!(engine::snapshot(&mut second).unwrap(), next);
    assert_eq!(
        engine::prepare(&mut second, &initial.token(), &record(2)).err(),
        Some(Error::StaleSnapshot)
    );
}

#[test]
fn error_and_panic_after_flock_release_even_before_engine_guard_exists() {
    let f = Fixture::new();
    let (mut first, _) = f.initialized();
    let mut second = f.open();
    fail_once(&mut first, Phase::Locked);
    assert_eq!(
        engine::snapshot(&mut first).err(),
        Some(Error::StorageUnavailable)
    );
    second.lock().unwrap();
    second.unlock();
    first.hook = Some(Box::new(|phase| {
        if phase == Phase::Locked {
            panic!("synthetic lock panic");
        }
        Ok(())
    }));
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| engine::snapshot(
            &mut first
        )))
        .is_err()
    );
    assert!(first.active_lock.is_none());
    second.lock().unwrap();
    second.unlock();
    first.hook = Some(Box::new(|phase| {
        if phase == Phase::Read {
            panic!("synthetic read panic");
        }
        Ok(())
    }));
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| engine::snapshot(
            &mut first
        )))
        .is_err()
    );
    second.lock().unwrap();
    second.unlock();
}

#[test]
fn child_process_lock_probe() {
    let Some(path) = std::env::var_os("AICHARTS_REFERENCE_TEST_ANCHOR") else {
        return;
    };
    let anchor: OwnedFd = File::open(path).unwrap().into();
    assert_eq!(
        MacStorage::open_existing_at(anchor).err(),
        Some(Error::Busy)
    );
}

#[test]
fn lock_contention_crosses_process_boundary_without_inherited_fd() {
    let f = Fixture::new();
    let (mut storage, _) = f.initialized();
    storage.lock().unwrap();
    assert!(io::fcntl_getfd(storage.active_lock.as_ref().unwrap())
        .unwrap()
        .contains(FdFlags::CLOEXEC));
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .arg("--exact")
        .arg("references::macos::tests::child_process_lock_probe")
        .env("AICHARTS_REFERENCE_TEST_ANCHOR", &f.path)
        .status()
        .unwrap();
    assert!(status.success());
    storage.unlock();
}

#[test]
fn interrupted_stages_preserve_current_and_only_exact_retry_can_finish() {
    for phase in [
        Phase::BeforeCandidateSync,
        Phase::CandidateFileSynced,
        Phase::CandidateDirectorySynced,
        Phase::CandidateFullySynced,
    ] {
        let f = Fixture::new();
        let (mut storage, initial) = f.initialized();
        let before = stdfs::read(f.at(CURRENT)).unwrap();
        fail_once(&mut storage, phase);
        assert_eq!(
            engine::prepare(&mut storage, &initial.token(), &record(1)).err(),
            Some(Error::StorageUnavailable)
        );
        assert_eq!(stdfs::read(f.at(CURRENT)).unwrap(), before);
        let pending = stdfs::read(f.at(PENDING)).unwrap();
        drop(storage);
        let mut reopened = f.open();
        assert_eq!(engine::snapshot(&mut reopened).unwrap(), initial);
        assert_eq!(
            engine::prepare(&mut reopened, &initial.token(), &record(2)).err(),
            Some(Error::RecoveryRequired)
        );
        assert_eq!(stdfs::read(f.at(PENDING)).unwrap(), pending);
        let next = engine::prepare(&mut reopened, &initial.token(), &record(1)).unwrap();
        assert_eq!(next.token().revision(), 1);
    }
}

#[test]
fn post_dispatch_failures_are_unknown_and_committed_result_survives_reopen() {
    for phase in [
        Phase::Published,
        Phase::BeforeDirectorySync,
        Phase::DirectorySynced,
        Phase::AnchorSynced,
        Phase::DirectoryFullySynced,
    ] {
        let f = Fixture::new();
        let (mut storage, initial) = f.initialized();
        fail_once(&mut storage, phase);
        assert_eq!(
            engine::prepare(&mut storage, &initial.token(), &record(1)).err(),
            Some(Error::OutcomeUnknown)
        );
        drop(storage);
        let mut reopened = f.open();
        let next = engine::snapshot(&mut reopened).unwrap();
        assert_eq!(next.token().revision(), 1);
        assert_eq!(
            engine::prepare(&mut reopened, &next.token(), &record(1)).unwrap(),
            next
        );
        assert!(!f.at(PENDING).exists());
    }
}

#[test]
fn created_but_unwritten_stage_is_preserved_and_not_repaired() {
    let f = Fixture::new();
    let (mut storage, initial) = f.initialized();
    let before = stdfs::read(f.at(CURRENT)).unwrap();
    fail_once(&mut storage, Phase::StageCreated);
    assert_eq!(
        engine::prepare(&mut storage, &initial.token(), &record(1)).err(),
        Some(Error::StorageUnavailable)
    );
    assert_eq!(f.at(PENDING).metadata().unwrap().len(), 0);
    drop(storage);
    assert_eq!(
        MacStorage::open_existing_at(f.anchor()).err(),
        Some(Error::RecoveryRequired)
    );
    assert_eq!(stdfs::read(f.at(CURRENT)).unwrap(), before);
}

#[test]
fn anchor_edge_replacement_does_not_redirect_a_pinned_store() {
    let f = Fixture::new();
    let (mut storage, _) = f.initialized();
    let original = f.path.join("retained-original");
    stdfs::rename(f.dir(), &original).unwrap();
    DirBuilder::new().mode(0o700).create(f.dir()).unwrap();
    assert_eq!(
        engine::snapshot(&mut storage).err(),
        Some(Error::RecoveryRequired)
    );
    assert_eq!(stdfs::read_dir(f.dir()).unwrap().count(), 0);
    assert!(original.join(CURRENT).exists());
}

#[test]
fn replaced_nonempty_or_hardlinked_lock_is_never_adopted() {
    for kind in 0..3 {
        let f = Fixture::new();
        let (mut storage, _) = f.initialized();
        match kind {
            0 => {
                stdfs::rename(f.at(LOCK), f.path.join("retained-lock")).unwrap();
                write_new(&f.at(LOCK), &[]);
            }
            1 => {
                OpenOptions::new()
                    .write(true)
                    .open(f.at(LOCK))
                    .unwrap()
                    .write_all(&[1])
                    .unwrap();
            }
            _ => stdfs::hard_link(f.at(LOCK), f.path.join("extra-link")).unwrap(),
        }
        assert_eq!(
            engine::snapshot(&mut storage).err(),
            Some(Error::RecoveryRequired)
        );
    }
}

#[test]
fn unsafe_leaf_shapes_and_unknown_entries_fail_without_reading_or_deleting_them() {
    for kind in 0..5 {
        let f = Fixture::new();
        let (storage, _) = f.initialized();
        drop(storage);
        let original = f.path.join("original-current");
        stdfs::rename(f.at(CURRENT), &original).unwrap();
        match kind {
            0 => std::os::unix::fs::symlink(&original, f.at(CURRENT)).unwrap(),
            1 => DirBuilder::new().mode(0o700).create(f.at(CURRENT)).unwrap(),
            2 => stdfs::hard_link(&original, f.at(CURRENT)).unwrap(),
            3 => {
                write_new(&f.at(CURRENT), &stdfs::read(&original).unwrap());
                stdfs::set_permissions(f.at(CURRENT), stdfs::Permissions::from_mode(0o640))
                    .unwrap();
            }
            _ => {
                stdfs::rename(&original, f.at(CURRENT)).unwrap();
                write_new(&f.at("foreign-file"), &[3, 7]);
            }
        }
        assert_eq!(
            MacStorage::open_existing_at(f.anchor()).err(),
            Some(Error::RecoveryRequired)
        );
        assert!(stdfs::symlink_metadata(f.at(CURRENT)).is_ok());
    }
}

#[test]
fn symlink_directory_and_unsafe_anchor_modes_are_refused_before_creation() {
    let f = Fixture::new();
    let target = f.path.join("target");
    DirBuilder::new().mode(0o700).create(&target).unwrap();
    std::os::unix::fs::symlink(&target, f.dir()).unwrap();
    assert_eq!(
        MacStorage::open_existing_at(f.anchor()).err(),
        Some(Error::RecoveryRequired)
    );
    assert_eq!(stdfs::read_dir(target).unwrap().count(), 0);
    let other = Fixture::new();
    stdfs::set_permissions(&other.path, stdfs::Permissions::from_mode(0o750)).unwrap();
    assert_eq!(
        MacStorage::create_new_at(other.anchor()).err(),
        Some(Error::RecoveryRequired)
    );
    assert!(!other.dir().exists());
}

#[test]
fn current_file_replacement_during_read_is_refused_and_guard_releases() {
    let f = Fixture::new();
    let (mut storage, _) = f.initialized();
    let current = f.at(CURRENT);
    let replacement = f.path.join("replacement");
    write_new(&replacement, &stdfs::read(&current).unwrap());
    let mut once = false;
    storage.hook = Some(Box::new(move |phase| {
        if phase == Phase::Read && !once {
            once = true;
            stdfs::rename(&replacement, &current).unwrap();
        }
        Ok(())
    }));
    assert_eq!(
        engine::snapshot(&mut storage).err(),
        Some(Error::RecoveryRequired)
    );
    assert!(storage.active_lock.is_none());
    assert!(MacStorage::open_existing_at(f.anchor()).is_ok());
}

#[test]
fn current_content_change_during_read_is_refused_without_accepting_old_bytes() {
    let f = Fixture::new();
    let (mut storage, _) = f.initialized();
    let current = f.at(CURRENT);
    storage.hook = Some(Box::new(move |phase| {
        if phase == Phase::Read {
            OpenOptions::new()
                .append(true)
                .open(&current)
                .unwrap()
                .write_all(&[8])
                .unwrap();
        }
        Ok(())
    }));
    assert_eq!(
        engine::snapshot(&mut storage).err(),
        Some(Error::RecoveryRequired)
    );
}

#[test]
fn filesystem_policy_rejects_remote_readonly_ignored_ownership_and_other_types() {
    assert!(filesystem_valid(MNT_LOCAL, b"apfs\0"));
    for flags in [0, MNT_LOCAL | MNT_RDONLY, MNT_LOCAL | MNT_IGNORE_OWNERSHIP] {
        assert!(!filesystem_valid(flags, b"apfs\0"));
    }
    for name in [
        b"apfs".as_slice(),
        b"hfs\0",
        b"smbfs\0",
        b"apfsX\0",
        b"msdos\0",
    ] {
        assert!(!filesystem_valid(MNT_LOCAL, name));
    }
}

#[test]
fn read_and_write_work_and_interrupt_budgets_are_finite() {
    let input = vec![4; 32];
    let mut calls = 0;
    let bytes = bounded_read(
        |out, offset| {
            calls += 1;
            if calls <= 2 {
                return Err(Errno::INTR);
            }
            if offset == 32 {
                return Ok(0);
            }
            out[0] = 4;
            Ok(1)
        },
        32,
    )
    .unwrap();
    assert_eq!(bytes, input);
    assert_eq!(
        bounded_read(|_, _| Err(Errno::INTR), 32).err(),
        Some(Error::StorageUnavailable)
    );
    assert_eq!(
        bounded_read(
            |out, _| {
                out[0] = 1;
                Ok(1)
            },
            512
        )
        .err(),
        Some(Error::StorageUnavailable)
    );
    assert_eq!(
        bounded_read(
            |out, _| {
                out.fill(1);
                Ok(out.len())
            },
            32
        )
        .err(),
        Some(Error::RecoveryRequired)
    );
    let mut written = vec![];
    bounded_write(
        |bytes, offset| {
            assert_eq!(offset as usize, written.len());
            written.push(bytes[0]);
            Ok(1)
        },
        &input,
    )
    .unwrap();
    assert_eq!(written, input);
    assert_eq!(
        bounded_write(|_, _| Ok(0), &input).err(),
        Some(Error::StorageUnavailable)
    );
    assert_eq!(
        bounded_write(|_, _| Err(Errno::INTR), &input).err(),
        Some(Error::StorageUnavailable)
    );
    assert_eq!(
        bounded_write(|_, _| Ok(1), &[0; 512]).err(),
        Some(Error::StorageUnavailable)
    );
}

#[test]
fn read_committed_applies_caller_limit_to_payload_not_envelope() {
    let f = Fixture::new();
    let (mut storage, initial) = f.initialized();
    storage.lock().unwrap();
    assert_eq!(
        storage.read_committed(95).err(),
        Some(Error::InvalidManifest)
    );
    assert_eq!(
        storage.read_committed(96).unwrap().unwrap(),
        codec::encode(&initial)
    );
    storage.unlock();
    assert_eq!(envelope::MAX_BYTES, 41_152);
    assert_eq!(MAX_MANIFEST_BYTES, 41_056);
}

#[test]
fn real_acl_refusal_precedes_child_creation_and_payload_write() {
    let f = Fixture::new();
    acl(
        &f.path,
        "everyone allow read,file_inherit,directory_inherit",
    );
    assert_eq!(
        MacStorage::create_new_at(f.anchor()).err(),
        Some(Error::RecoveryRequired)
    );
    assert!(!f.dir().exists());
    for name in [DIRECTORY, CURRENT, LOCK] {
        let f = Fixture::new();
        let (mut storage, initial) = f.initialized();
        let path = if name == DIRECTORY {
            f.dir()
        } else {
            f.at(name)
        };
        acl(&path, "everyone allow read");
        assert_eq!(
            engine::prepare(&mut storage, &initial.token(), &record(1)).err(),
            Some(Error::RecoveryRequired)
        );
        assert!(!f.at(PENDING).exists());
    }
    let f = Fixture::new();
    let (mut storage, initial) = f.initialized();
    let pending = f.at(PENDING);
    storage.hook = Some(Box::new(move |phase| {
        if phase == Phase::StageCreated {
            acl(&pending, "everyone allow read");
        }
        Ok(())
    }));
    assert_eq!(
        engine::prepare(&mut storage, &initial.token(), &record(1)).err(),
        Some(Error::RecoveryRequired)
    );
    assert_eq!(f.at(PENDING).metadata().unwrap().len(), 0);
}

#[test]
fn inherit_only_acl_is_rejected_even_when_mode_bits_are_private() {
    let f = Fixture::new();
    let (mut storage, initial) = f.initialized();
    acl(
        &f.dir(),
        "everyone allow read,file_inherit,directory_inherit,only_inherit",
    );
    assert_eq!(f.dir().metadata().unwrap().mode() & 0o7777, 0o700);
    assert_eq!(
        engine::prepare(&mut storage, &initial.token(), &record(1)).err(),
        Some(Error::RecoveryRequired)
    );
    assert!(!f.at(PENDING).exists());
}

#[test]
fn fifo_and_socket_named_as_current_are_refused_without_blocking() {
    for socket in [false, true] {
        let f = Fixture::new();
        let (storage, _) = f.initialized();
        drop(storage);
        stdfs::rename(f.at(CURRENT), f.path.join("retained-current")).unwrap();
        let _listener = if socket {
            Some(std::os::unix::net::UnixListener::bind(f.at(CURRENT)).unwrap())
        } else {
            assert!(std::process::Command::new("/usr/bin/mkfifo")
                .arg("-m")
                .arg("600")
                .arg(f.at(CURRENT))
                .status()
                .unwrap()
                .success());
            None
        };
        assert_eq!(
            MacStorage::open_existing_at(f.anchor()).err(),
            Some(Error::RecoveryRequired)
        );
        assert!(stdfs::symlink_metadata(f.at(CURRENT)).is_ok());
    }
}

#[test]
fn wrong_owner_mode_and_link_metadata_are_closed_without_changing_ownership() {
    let f = Fixture::new();
    let (storage, _) = f.initialized();
    let fd = File::open(f.at(CURRENT)).unwrap();
    let mut stat = fs::fstat(&fd).unwrap();
    stat.st_uid = storage.uid.wrapping_add(1);
    assert_eq!(
        role(&stat, storage.uid, false),
        Err(Error::RecoveryRequired)
    );
    stat.st_uid = storage.uid;
    stat.st_mode |= 0o4000;
    assert_eq!(
        role(&stat, storage.uid, false),
        Err(Error::RecoveryRequired)
    );
    stat.st_mode &= !0o4000;
    stat.st_nlink = 2;
    assert_eq!(
        role(&stat, storage.uid, false),
        Err(Error::RecoveryRequired)
    );
}

#[test]
fn lock_replacement_after_flock_fails_and_releases_old_description() {
    let f = Fixture::new();
    let (mut storage, _) = f.initialized();
    let lock = f.at(LOCK);
    let old = f.path.join("old-lock");
    let old_for_hook = old.clone();
    storage.hook = Some(Box::new(move |phase| {
        if phase == Phase::Locked {
            stdfs::rename(&lock, &old_for_hook).unwrap();
            write_new(&lock, &[]);
        }
        Ok(())
    }));
    assert_eq!(
        engine::snapshot(&mut storage).err(),
        Some(Error::RecoveryRequired)
    );
    assert!(storage.active_lock.is_none());
    let fd = OpenOptions::new().read(true).write(true).open(old).unwrap();
    fs::flock(&fd, FlockOperation::NonBlockingLockExclusive).unwrap();
    fs::flock(&fd, FlockOperation::Unlock).unwrap();
}

#[test]
fn initial_noreplace_cannot_overwrite_a_target_created_after_absence_check() {
    let f = Fixture::new();
    let mut storage = f.create();
    let current = f.at(CURRENT);
    storage.hook = Some(Box::new(move |phase| {
        if phase == Phase::RenameDispatch {
            write_new(&current, b"synthetic competing target");
        }
        Ok(())
    }));
    assert_eq!(
        engine::initialize(&mut storage, INSTALLATION).err(),
        Some(Error::OutcomeUnknown)
    );
    assert_eq!(
        stdfs::read(f.at(CURRENT)).unwrap(),
        b"synthetic competing target"
    );
    assert_eq!(
        envelope::decode(&stdfs::read(f.at(PENDING)).unwrap())
            .unwrap()
            .bytes,
        initial().bytes
    );
}

#[test]
fn changed_current_before_publish_and_post_publish_read_loss_are_not_success() {
    let f = Fixture::new();
    let (mut storage, initial) = f.initialized();
    let current = f.at(CURRENT);
    let mut different = initial.clone();
    different.installation = [71; 32];
    let alternative = envelope::encode(&Candidate {
        expected: None,
        bytes: codec::encode(&different),
    })
    .unwrap();
    let replacement = f.path.join("replacement");
    write_new(&replacement, &alternative);
    storage.hook = Some(Box::new(move |phase| {
        if phase == Phase::BeforePublish {
            stdfs::rename(&replacement, &current).unwrap();
        }
        Ok(())
    }));
    assert_eq!(
        engine::prepare(&mut storage, &initial.token(), &record(1)).err(),
        Some(Error::OutcomeUnknown)
    );
    assert_eq!(stdfs::read(f.at(CURRENT)).unwrap(), alternative);
    assert!(f.at(PENDING).exists());

    let f = Fixture::new();
    let (mut storage, initial) = f.initialized();
    let mut published = false;
    storage.hook = Some(Box::new(move |phase| {
        if phase == Phase::Published {
            published = true;
        }
        if phase == Phase::Read && published {
            return Err(Error::StorageUnavailable);
        }
        Ok(())
    }));
    assert_eq!(
        engine::prepare(&mut storage, &initial.token(), &record(1)).err(),
        Some(Error::OutcomeUnknown)
    );
    drop(storage);
    assert_eq!(
        engine::snapshot(&mut f.open()).unwrap().token().revision(),
        1
    );
}

#[test]
fn install_reconcile_and_resolve_use_only_fake_vault_after_durable_readback() {
    let f = Fixture::new();
    let (mut storage, initial) = f.initialized();
    let secret = record(1);
    let prepared = engine::prepare(&mut storage, &initial.token(), &secret).unwrap();
    let mut vault = FakeVault::default();
    let verified = engine::install(&mut storage, &prepared.token(), &secret, &mut vault).unwrap();
    assert_eq!(vault.adds, 1);
    drop(storage);
    let mut storage = f.open();
    assert_eq!(
        engine::reconcile(
            &mut storage,
            &verified.token(),
            secret.identity(),
            &mut vault
        )
        .unwrap(),
        verified
    );
    assert_eq!(
        engine::resolve(
            &mut storage,
            &verified.token(),
            secret.identity(),
            &mut vault
        )
        .unwrap()
        .encode()
        .as_slice(),
        secret.encode().as_slice()
    );
    assert_eq!(
        engine::install(&mut storage, &verified.token(), &secret, &mut vault).unwrap(),
        verified
    );
    assert_eq!(vault.adds, 1);
    let disk = stdfs::read(f.at(CURRENT)).unwrap();
    assert!(!disk.windows(32).any(|bytes| bytes == [53; 32]));
}

#[test]
fn every_committed_durability_failure_precedes_fake_vault_calls() {
    for phase in [
        Phase::BeforeCommittedSync,
        Phase::CommittedFileSynced,
        Phase::CommittedFullySynced,
        Phase::BeforeDirectorySync,
        Phase::DirectorySynced,
        Phase::AnchorSynced,
        Phase::DirectoryFullySynced,
    ] {
        let f = Fixture::new();
        let (mut storage, initial) = f.initialized();
        let secret = record(1);
        let prepared = engine::prepare(&mut storage, &initial.token(), &secret).unwrap();
        let bytes = stdfs::read(f.at(CURRENT)).unwrap();
        fail_once(&mut storage, phase);
        let mut vault = FakeVault::default();
        assert_eq!(
            engine::install(&mut storage, &prepared.token(), &secret, &mut vault).err(),
            Some(Error::StorageUnavailable)
        );
        assert_eq!((vault.reads, vault.adds), (0, 0));
        assert_eq!(stdfs::read(f.at(CURRENT)).unwrap(), bytes);
        assert!(!f.at(PENDING).exists());
    }
}

#[test]
fn complete_verified_candidate_retries_after_reopen_without_duplicate_secret_insert() {
    let f = Fixture::new();
    let (mut storage, initial) = f.initialized();
    let secret = record(1);
    let prepared = engine::prepare(&mut storage, &initial.token(), &secret).unwrap();
    fail_once(&mut storage, Phase::BeforeCandidateSync);
    let mut vault = FakeVault::default();
    assert_eq!(
        engine::install(&mut storage, &prepared.token(), &secret, &mut vault).err(),
        Some(Error::StorageUnavailable)
    );
    assert_eq!(vault.adds, 1);
    drop(storage);
    let mut storage = f.open();
    let verified = engine::install(&mut storage, &prepared.token(), &secret, &mut vault).unwrap();
    assert_eq!(verified.token().revision(), 2);
    assert_eq!(vault.adds, 1);
}

#[test]
fn maximum_envelope_reads_and_oversized_disk_files_are_bounded() {
    let f = Fixture::new();
    let mut storage = f.create();
    let entries = (0u16..256)
        .map(|index| {
            let mut item = [7; 32];
            item[..2].copy_from_slice(&index.to_be_bytes());
            let reference = CredentialRef::new(INSTALLATION, item, Purpose::Checkpoint).unwrap();
            let secret =
                SecretRecord::checkpoint(reference, Secret32::new([53; 32]).unwrap()).unwrap();
            crate::references::ReferenceEntry {
                intent: crate::references::RecordIntent::from_record(&secret),
                state: crate::references::ReferenceState::CustodyVerified,
            }
        })
        .collect();
    let snapshot = ManifestSnapshot {
        installation: INSTALLATION,
        revision: 512,
        entries,
    };
    let candidate = Candidate {
        expected: Some(crate::references::ManifestToken {
            revision: 511,
            digest: [1; 32],
        }),
        bytes: codec::encode(&snapshot),
    };
    let bytes = envelope::encode(&candidate).unwrap();
    assert_eq!(bytes.len(), envelope::MAX_BYTES);
    write_new(&f.at(CURRENT), &bytes);
    assert_eq!(engine::snapshot(&mut storage).unwrap(), snapshot);
    drop(storage);
    assert_eq!(engine::snapshot(&mut f.open()).unwrap(), snapshot);
    OpenOptions::new()
        .append(true)
        .open(f.at(CURRENT))
        .unwrap()
        .write_all(&[0])
        .unwrap();
    assert_eq!(
        MacStorage::open_existing_at(f.anchor()).err(),
        Some(Error::RecoveryRequired)
    );
}

#[test]
fn pending_with_wrong_predecessor_or_installation_is_preserved_and_refused() {
    for wrong_installation in [false, true] {
        let f = Fixture::new();
        let (storage, initial) = f.initialized();
        drop(storage);
        let mut candidate = prepare_candidate(&initial, 1);
        if wrong_installation {
            let mut value = codec::decode(&candidate.bytes).unwrap();
            value.installation = [82; 32];
            // Rebuild the record too so the AICF itself remains canonical.
            let reference =
                CredentialRef::new(value.installation, [1; 32], Purpose::Checkpoint).unwrap();
            let secret =
                SecretRecord::checkpoint(reference, Secret32::new([53; 32]).unwrap()).unwrap();
            value.entries[0].intent = crate::references::RecordIntent::from_record(&secret);
            candidate.bytes = codec::encode(&value);
        } else {
            candidate.expected.as_mut().unwrap().digest = [82; 32];
        }
        let bytes = envelope::encode(&candidate).unwrap();
        write_new(&f.at(PENDING), &bytes);
        assert_eq!(
            MacStorage::open_existing_at(f.anchor()).err(),
            Some(Error::RecoveryRequired)
        );
        assert_eq!(stdfs::read(f.at(PENDING)).unwrap(), bytes);
    }
}

#[test]
fn byte_identical_inode_replacement_cannot_cross_the_directory_durability_barrier() {
    for phase in [Phase::BeforeDirectorySync, Phase::DirectoryFullySynced] {
        for before_vault in [false, true] {
            let f = Fixture::new();
            let (mut storage, initial) = f.initialized();
            let secret = record(1);
            let prepared = if before_vault {
                Some(engine::prepare(&mut storage, &initial.token(), &secret).unwrap())
            } else {
                None
            };
            let current = f.at(CURRENT);
            let replacement = f.path.join("equal-bytes-new-inode");
            storage.hook = Some(Box::new(move |event| {
                if event == phase {
                    write_new(&replacement, &stdfs::read(&current).unwrap());
                    stdfs::rename(&replacement, &current).unwrap();
                }
                Ok(())
            }));
            let mut vault = FakeVault::default();
            if let Some(prepared) = prepared {
                assert_eq!(
                    engine::install(&mut storage, &prepared.token(), &secret, &mut vault).err(),
                    Some(Error::RecoveryRequired)
                );
            } else {
                assert_eq!(
                    engine::prepare(&mut storage, &initial.token(), &secret).err(),
                    Some(Error::OutcomeUnknown)
                );
            }
            assert_eq!((vault.adds, vault.reads), (0, 0));
            assert!(storage.active_lock.is_none());
        }
    }
}

#[test]
fn final_pending_read_cannot_hide_current_replacement_or_mutation_before_vault() {
    for same_inode in [false, true] {
        let f = Fixture::new();
        let (mut storage, initial) = f.initialized();
        let secret = record(1);
        let prepared = engine::prepare(&mut storage, &initial.token(), &secret).unwrap();
        let mut next = prepared.clone();
        next.revision += 1;
        next.entries[0].state = crate::references::ReferenceState::CustodyVerified;
        let pending = Candidate {
            expected: Some(prepared.token()),
            bytes: codec::encode(&next),
        };
        write_new(&f.at(PENDING), &envelope::encode(&pending).unwrap());
        let current = f.at(CURRENT);
        let replacement = f.path.join("equal-new-current");
        let mut barrier = false;
        storage.hook = Some(Box::new(move |phase| {
            if phase == Phase::DirectoryFullySynced {
                barrier = true;
            }
            if phase == Phase::ReadPending && barrier {
                if same_inode {
                    OpenOptions::new()
                        .append(true)
                        .open(&current)
                        .unwrap()
                        .write_all(&[0])
                        .unwrap();
                } else {
                    write_new(&replacement, &stdfs::read(&current).unwrap());
                    stdfs::rename(&replacement, &current).unwrap();
                }
            }
            Ok(())
        }));
        let mut vault = FakeVault::default();
        assert_eq!(
            engine::install(&mut storage, &prepared.token(), &secret, &mut vault).err(),
            Some(Error::RecoveryRequired)
        );
        assert_eq!((vault.reads, vault.adds), (0, 0));
        assert!(storage.active_lock.is_none());
    }
}

#[test]
fn early_stage_and_complete_stage_reply_loss_preserve_the_exact_recovery_state() {
    for phase in [
        Phase::BeforeStage,
        Phase::StageWritten,
        Phase::BeforePublish,
    ] {
        let f = Fixture::new();
        let (mut storage, initial) = f.initialized();
        let committed = stdfs::read(f.at(CURRENT)).unwrap();
        fail_once(&mut storage, phase);
        let error = engine::prepare(&mut storage, &initial.token(), &record(1)).err();
        assert_eq!(
            error,
            Some(if phase == Phase::BeforePublish {
                Error::OutcomeUnknown
            } else {
                Error::StorageUnavailable
            })
        );
        assert_eq!(stdfs::read(f.at(CURRENT)).unwrap(), committed);
        if phase == Phase::BeforeStage {
            assert!(!f.at(PENDING).exists());
        } else {
            let original = prepare_candidate(&initial, 1);
            assert_eq!(
                stdfs::read(f.at(PENDING)).unwrap(),
                envelope::encode(&original).unwrap()
            );
        }
        drop(storage);
        let mut reopened = f.open();
        assert_eq!(
            engine::prepare(&mut reopened, &initial.token(), &record(1))
                .unwrap()
                .token()
                .revision(),
            1
        );
    }
}
