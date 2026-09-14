//! Public constructors on owned APFS fixtures. Vault calls use only memory.
use super::*;
use crate::{
    references::{RecordIntent, ReferenceState, ReferenceStore},
    store::{RawError, RawResult, RawStore},
    CredentialRef, Purpose, Secret32,
};
use std::{
    cell::RefCell,
    fs::{self, DirBuilder, File, OpenOptions},
    io::Write,
    os::unix::fs::{symlink, DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::PathBuf,
    rc::Rc,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard,
    },
};
use zeroize::Zeroizing;

const INSTALLATION: [u8; 32] = [101; 32];
const CHILD: &str = "references-v1";
const CURRENT: &str = "references.current";
const PENDING: &str = "references.pending";
const LOCK: &str = "references.lock";

struct Fixture(PathBuf, MutexGuard<'static, ()>);
impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        static FIXTURE_PARENT: Mutex<()> = Mutex::new(());
        // Fixture creation/removal changes their common ancestor's metadata.
        // Keep that test-owned churn outside another fixture's path readbacks.
        let guard = FIXTURE_PARENT
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        // The compile-time repository path is explicit. No home discovery or
        // /private/tmp traversal bypass substitutes for the public path checks.
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
            ".reference-constructor-{}-{stamp}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        DirBuilder::new().mode(0o700).create(&path).unwrap();
        Self(path, guard)
    }
    fn child(&self, name: &str) -> PathBuf {
        let path = self.0.join(name);
        DirBuilder::new().mode(0o700).create(&path).unwrap();
        path
    }
    fn at(&self, name: &str) -> PathBuf {
        self.0.join(CHILD).join(name)
    }
    fn initialize(&self) -> ReferenceStore {
        ReferenceStore::initialize_new(&self.0, INSTALLATION).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn names(path: &Path) -> Vec<String> {
    let mut names: Vec<_> = fs::read_dir(path)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
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
#[derive(Debug, PartialEq, Eq)]
struct Observation {
    inode: u64,
    mode: u32,
    links: u64,
    modified: (i64, i64),
    changed: (i64, i64),
    bytes: Vec<u8>,
}
fn observe(path: &Path) -> Observation {
    let metadata = fs::symlink_metadata(path).unwrap();
    Observation {
        inode: metadata.ino(),
        mode: metadata.mode(),
        links: metadata.nlink(),
        modified: (metadata.mtime(), metadata.mtime_nsec()),
        changed: (metadata.ctime(), metadata.ctime_nsec()),
        bytes: fs::read(path).unwrap(),
    }
}
fn record(installation: [u8; 32], secret: u8) -> SecretRecord {
    SecretRecord::pairing(
        CredentialRef::new(installation, [103; 32], Purpose::Pairing).unwrap(),
        [107; 32],
        Secret32::new([secret; 32]).unwrap(),
        Secret32::new([secret + 1; 32]).unwrap(),
    )
    .unwrap()
}

#[derive(Default)]
struct VaultState {
    record: Option<(CredentialRef, Zeroizing<Vec<u8>>)>,
    events: Vec<&'static str>,
}
struct MemoryVault(Rc<RefCell<VaultState>>);
impl RawStore for MemoryVault {
    fn read(&mut self, reference: &CredentialRef) -> RawResult<Zeroizing<Vec<u8>>> {
        let mut state = self.0.borrow_mut();
        state.events.push("read");
        match &state.record {
            Some((expected, bytes)) if expected == reference => Ok(bytes.clone()),
            _ => Err(RawError::Missing),
        }
    }
    fn add(&mut self, reference: &CredentialRef, bytes: &[u8]) -> RawResult<()> {
        let mut state = self.0.borrow_mut();
        state.events.push("add");
        if state.record.is_some() {
            return Err(RawError::Duplicate);
        }
        state.record = Some((reference.clone(), Zeroizing::new(bytes.to_vec())));
        Ok(())
    }
}
fn vault(state: &Rc<RefCell<VaultState>>) -> Vault {
    let state = state.clone();
    Vault::fixture(move || {
        state.borrow_mut().events.push("select");
        Ok(MemoryVault(state.clone()))
    })
}
fn refuse_all(path: &Path, error: Error) {
    assert_eq!(
        ReferenceStore::initialize_new(path, INSTALLATION).err(),
        Some(error)
    );
    assert_eq!(ReferenceStore::open_existing(path).err(), Some(error));
    assert_eq!(ReferenceStore::inspect_existing(path).err(), Some(error));
    assert_eq!(
        ReferenceStore::reconcile_initialization(path, INSTALLATION).err(),
        Some(error)
    );
}

#[test]
fn public_constructors_preserve_fixed_layout_and_zero_vault_effects() {
    let fixture = Fixture::new();
    let state = Rc::new(RefCell::new(VaultState::default()));
    let mut vault = vault(&state);
    let mut store = fixture.initialize();
    let initial = store.snapshot().unwrap();
    assert_eq!(initial.installation_id(), &INSTALLATION);
    assert_eq!(initial.token().revision(), 0);
    assert!(initial.entries().is_empty());
    assert_eq!(names(&fixture.0), [CHILD]);
    assert_eq!(names(&fixture.0.join(CHILD)), [CURRENT, LOCK]);
    assert_eq!(
        fs::metadata(fixture.0.join(CHILD)).unwrap().mode() & 0o7777,
        0o700
    );
    for name in [LOCK, CURRENT] {
        let observation = observe(&fixture.at(name));
        assert_eq!(observation.mode & 0o7777, 0o600);
        assert_eq!(observation.links, 1);
    }
    assert_eq!(fs::metadata(fixture.at(LOCK)).unwrap().len(), 0);
    assert_eq!(
        ReferenceStore::initialize_new(&fixture.0, INSTALLATION).err(),
        Some(Error::Conflict)
    );
    let original = record(INSTALLATION, 109);
    let prepared = store.prepare(&initial.token(), &original).unwrap();
    assert_eq!(
        store
            .prepare(&prepared.token(), &record([113; 32], 109))
            .err(),
        Some(Error::InvalidInstallation)
    );
    assert_eq!(
        store
            .resolve_verified(&prepared.token(), original.identity(), &mut vault)
            .err(),
        Some(Error::NotVerified)
    );
    drop(store);
    let before = observe(&fixture.at(CURRENT));
    assert_eq!(
        ReferenceStore::inspect_existing(&fixture.0).unwrap(),
        prepared
    );
    let mut reopened = ReferenceStore::open_existing(&fixture.0).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), prepared);
    assert_eq!(observe(&fixture.at(CURRENT)), before);
    assert!(state.borrow().events.is_empty());
    for secret in [[109; 32], [110; 32]] {
        assert!(!before.bytes.windows(32).any(|window| window == secret));
    }
}

#[test]
fn invalid_installation_paths_and_missing_anchors_have_no_creation_effects() {
    let fixture = Fixture::new();
    for path in [fixture.0.as_path(), Path::new("relative")] {
        assert_eq!(
            ReferenceStore::initialize_new(path, [0; 32]).err(),
            Some(Error::InvalidInstallation)
        );
        assert_eq!(
            ReferenceStore::reconcile_initialization(path, [0; 32]).err(),
            Some(Error::InvalidInstallation)
        );
    }
    for path in [
        "", "/", "relative", "~/state", "/a/", "//a", "/a//b", "/a/./b", "/a/../b", "/a\0b",
    ] {
        refuse_all(Path::new(path), Error::RecoveryRequired);
    }
    let missing = fixture.0.join("missing/anchor");
    refuse_all(&missing, Error::Missing);
    assert_eq!(
        ReferenceStore::open_existing(&fixture.0).err(),
        Some(Error::Missing)
    );
    assert_eq!(
        ReferenceStore::inspect_existing(&fixture.0).err(),
        Some(Error::Missing)
    );
    assert_eq!(
        ReferenceStore::reconcile_initialization(&fixture.0, INSTALLATION).err(),
        Some(Error::Missing)
    );
    assert!(names(&fixture.0).is_empty());
}

#[test]
fn public_paths_refuse_symlinks_unsafe_ancestors_and_anchor_mode_changes() {
    let fixture = Fixture::new();
    let target = fixture.child("target");
    let link = fixture.0.join("link");
    symlink(&target, &link).unwrap();
    refuse_all(&link, Error::RecoveryRequired);
    assert!(names(&target).is_empty());

    let parent = fixture.child("parent");
    let anchor = fixture.child("parent/anchor");
    fs::set_permissions(&parent, fs::Permissions::from_mode(0o777)).unwrap();
    refuse_all(&anchor, Error::RecoveryRequired);
    assert_eq!(fs::metadata(&parent).unwrap().mode() & 0o7777, 0o777);
    assert!(names(&anchor).is_empty());

    fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
    refuse_all(&target, Error::RecoveryRequired);
    assert_eq!(fs::metadata(&target).unwrap().mode() & 0o7777, 0o755);
    assert!(names(&target).is_empty());
}

#[test]
fn public_constructors_never_adopt_partial_or_foreign_storage() {
    for shape in ["empty", "lock_only", "malformed", "extra"] {
        let fixture = Fixture::new();
        if shape == "extra" {
            drop(fixture.initialize());
            write_new(&fixture.at("foreign"), b"synthetic foreign entry");
        } else {
            fixture.child(CHILD);
            if shape != "empty" {
                write_new(&fixture.at(LOCK), b"");
            }
            if shape == "malformed" {
                write_new(&fixture.at(CURRENT), b"synthetic malformed manifest");
            }
        }
        let before: Vec<_> = names(&fixture.0.join(CHILD))
            .into_iter()
            .map(|name| {
                let observation = observe(&fixture.at(&name));
                (name, observation)
            })
            .collect();
        assert_eq!(
            ReferenceStore::initialize_new(&fixture.0, INSTALLATION).err(),
            Some(Error::Conflict)
        );
        assert_eq!(
            ReferenceStore::open_existing(&fixture.0).err(),
            Some(Error::RecoveryRequired)
        );
        assert_eq!(
            ReferenceStore::inspect_existing(&fixture.0).err(),
            Some(Error::RecoveryRequired)
        );
        assert_eq!(
            ReferenceStore::reconcile_initialization(&fixture.0, INSTALLATION).err(),
            Some(Error::RecoveryRequired)
        );
        assert_eq!(
            names(&fixture.0.join(CHILD)),
            before
                .iter()
                .map(|(name, _)| name.clone())
                .collect::<Vec<_>>()
        );
        for (name, observation) in before {
            assert_eq!(observe(&fixture.at(&name)), observation);
        }
    }
}

#[test]
fn public_initialization_recovery_requires_the_original_exact_pending_record() {
    let fixture = Fixture::new();
    let initial = fixture.initialize().snapshot().unwrap();
    // Preserve the original envelope and inode in the interrupted pre-rename
    // shape. No production fault hook or recovery shortcut is involved.
    fs::rename(fixture.at(CURRENT), fixture.at(PENDING)).unwrap();
    let pending = observe(&fixture.at(PENDING));
    assert_eq!(
        ReferenceStore::open_existing(&fixture.0).err(),
        Some(Error::Missing)
    );
    assert_eq!(
        ReferenceStore::inspect_existing(&fixture.0).err(),
        Some(Error::Missing)
    );
    assert_eq!(
        ReferenceStore::initialize_new(&fixture.0, INSTALLATION).err(),
        Some(Error::Conflict)
    );
    assert_eq!(
        ReferenceStore::reconcile_initialization(&fixture.0, [127; 32]).err(),
        Some(Error::RecoveryRequired)
    );
    assert_eq!(observe(&fixture.at(PENDING)), pending);
    assert!(!fixture.at(CURRENT).exists());

    let mut recovered = ReferenceStore::reconcile_initialization(&fixture.0, INSTALLATION).unwrap();
    assert_eq!(recovered.snapshot().unwrap(), initial);
    let current = observe(&fixture.at(CURRENT));
    assert_eq!(current.inode, pending.inode);
    assert_eq!(current.bytes, pending.bytes);
    assert!(!fixture.at(PENDING).exists());
    assert_eq!(
        ReferenceStore::reconcile_initialization(&fixture.0, INSTALLATION)
            .unwrap()
            .snapshot()
            .unwrap(),
        initial
    );
    assert_eq!(
        ReferenceStore::reconcile_initialization(&fixture.0, [127; 32]).err(),
        Some(Error::InvalidInstallation)
    );
    let prepared = recovered
        .prepare(&initial.token(), &record(INSTALLATION, 109))
        .unwrap();
    assert_eq!(
        ReferenceStore::reconcile_initialization(&fixture.0, INSTALLATION).err(),
        Some(Error::Conflict)
    );
    assert_eq!(
        ReferenceStore::inspect_existing(&fixture.0).unwrap(),
        prepared
    );
}

#[test]
fn inspection_preserves_pending_state_and_never_recovers_it() {
    let fixture = Fixture::new();
    let mut store = fixture.initialize();
    let initial = store.snapshot().unwrap();
    let initial_bytes = fs::read(fixture.at(CURRENT)).unwrap();
    store
        .prepare(&initial.token(), &record(INSTALLATION, 109))
        .unwrap();
    drop(store);
    fs::rename(fixture.at(CURRENT), fixture.at(PENDING)).unwrap();
    let pending = observe(&fixture.at(PENDING));
    // A non-initial pending candidate cannot substitute for missing current.
    assert_eq!(
        ReferenceStore::open_existing(&fixture.0).err(),
        Some(Error::RecoveryRequired)
    );
    assert_eq!(
        ReferenceStore::inspect_existing(&fixture.0).err(),
        Some(Error::RecoveryRequired)
    );
    assert_eq!(
        ReferenceStore::reconcile_initialization(&fixture.0, INSTALLATION).err(),
        Some(Error::RecoveryRequired)
    );
    assert_eq!(observe(&fixture.at(PENDING)), pending);
    write_new(&fixture.at(CURRENT), &initial_bytes);
    let current = observe(&fixture.at(CURRENT));
    assert_eq!(
        ReferenceStore::inspect_existing(&fixture.0).unwrap(),
        initial
    );
    assert_eq!(
        ReferenceStore::open_existing(&fixture.0)
            .unwrap()
            .snapshot()
            .unwrap(),
        initial
    );
    assert_eq!(observe(&fixture.at(CURRENT)), current);
    assert_eq!(observe(&fixture.at(PENDING)), pending);
}

#[test]
fn observed_manifests_still_require_fresh_durability_before_vault_effects() {
    let fixture = Fixture::new();
    let mut store = fixture.initialize();
    let initial = store.snapshot().unwrap();
    let original = record(INSTALLATION, 109);
    let prepared = store.prepare(&initial.token(), &original).unwrap();
    drop(store);
    assert_eq!(
        ReferenceStore::inspect_existing(&fixture.0).unwrap(),
        prepared
    );
    let mut reopened = ReferenceStore::open_existing(&fixture.0).unwrap();
    let state = Rc::new(RefCell::new(VaultState::default()));
    let mut vault = vault(&state);
    reopened
        .backend()
        .unwrap()
        .storage
        .fail_next_committed_sync();
    assert_eq!(
        reopened
            .install_prepared(&prepared.token(), &original, &mut vault)
            .err(),
        Some(Error::StorageUnavailable)
    );
    assert!(state.borrow().events.is_empty());
    assert_eq!(
        ReferenceStore::inspect_existing(&fixture.0).unwrap(),
        prepared
    );
}

#[test]
fn observed_verified_state_still_requires_a_current_exact_vault_read() {
    let fixture = Fixture::new();
    let mut store = fixture.initialize();
    let initial = store.snapshot().unwrap();
    let original = record(INSTALLATION, 109);
    let prepared = store.prepare(&initial.token(), &original).unwrap();
    let state = Rc::new(RefCell::new(VaultState::default()));
    let mut vault = vault(&state);
    let verified = store
        .install_prepared(&prepared.token(), &original, &mut vault)
        .unwrap();
    assert_eq!(
        verified.entries()[0].state(),
        ReferenceState::CustodyVerified
    );
    assert_eq!(
        verified.entries()[0].intent(),
        &RecordIntent::from_record(&original)
    );
    drop(store);
    state.borrow_mut().record = None;
    state.borrow_mut().events.clear();
    assert_eq!(
        ReferenceStore::inspect_existing(&fixture.0).unwrap(),
        verified
    );
    let mut reopened = ReferenceStore::open_existing(&fixture.0).unwrap();
    assert!(state.borrow().events.is_empty());
    assert_eq!(
        reopened
            .resolve_verified(&verified.token(), original.identity(), &mut vault)
            .err(),
        Some(Error::Custody(crate::Error::Missing))
    );
    assert_eq!(state.borrow().events, ["select", "read"]);
    assert_eq!(
        ReferenceStore::inspect_existing(&fixture.0).unwrap(),
        verified
    );
}

#[test]
fn publicly_opened_facades_keep_the_anchor_name_pinned() {
    let fixture = Fixture::new();
    let anchor = fixture.child("anchor");
    let mut store = ReferenceStore::initialize_new(&anchor, INSTALLATION).unwrap();
    let initial = store.snapshot().unwrap();
    let retained = fixture.0.join("retained");
    fs::rename(&anchor, &retained).unwrap();
    fixture.child("anchor");
    let before = observe(&retained.join(CHILD).join(CURRENT));
    assert_eq!(store.snapshot().err(), Some(Error::RecoveryRequired));
    assert_eq!(
        store
            .prepare(&initial.token(), &record(INSTALLATION, 109))
            .err(),
        Some(Error::RecoveryRequired)
    );
    assert_eq!(
        ReferenceStore::open_existing(&anchor).err(),
        Some(Error::Missing)
    );
    assert_eq!(observe(&retained.join(CHILD).join(CURRENT)), before);
    assert!(names(&anchor).is_empty());
}

#[test]
fn public_observation_and_recovery_obey_the_existing_nonblocking_lock() {
    let fixture = Fixture::new();
    let mut store = fixture.initialize();
    let initial = store.snapshot().unwrap();
    let lock = File::open(fixture.at(LOCK)).unwrap();
    rustix::fs::flock(&lock, rustix::fs::FlockOperation::NonBlockingLockExclusive).unwrap();
    assert_eq!(
        ReferenceStore::open_existing(&fixture.0).err(),
        Some(Error::Busy)
    );
    assert_eq!(
        ReferenceStore::inspect_existing(&fixture.0).err(),
        Some(Error::Busy)
    );
    assert_eq!(
        ReferenceStore::reconcile_initialization(&fixture.0, INSTALLATION).err(),
        Some(Error::Busy)
    );
    assert_eq!(store.snapshot().err(), Some(Error::Busy));
    drop(lock);
    assert_eq!(store.snapshot().unwrap(), initial);
}
