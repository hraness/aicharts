use super::MacStorage;
use crate::enrollment::attempt::{
    record_tests::{copy, initial_record},
    session::HeldAttempt,
    storage, Error,
};
use std::{
    ffi::OsString,
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static NEXT: AtomicU64 = AtomicU64::new(0);

fn anchor_path() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before epoch")
        .as_nanos();
    // `temp_dir` is commonly exposed through `/var`, which is a symlink on
    // macOS. Resolve that alias before the descriptor-pinned path API walks it.
    fs::canonicalize(std::env::temp_dir())
        .expect("canonicalize disposable temp parent")
        .join(format!(
            "aicharts-attempt-{}-{stamp}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ))
}

struct Anchor(PathBuf);

impl Drop for Anchor {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn with_anchor(test: impl FnOnce(&Path)) {
    let path = anchor_path();
    fs::create_dir(&path).expect("create disposable anchor");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).expect("set anchor mode");
    let anchor = Anchor(path);
    test(&anchor.0);
}

fn create(path: &Path, initial: &crate::enrollment::attempt::record::Record) -> MacStorage {
    MacStorage::create_new_at(fs::File::open(path).expect("open anchor").into(), initial)
        .expect("create storage")
}

fn open(path: &Path) -> MacStorage {
    MacStorage::open_existing_at(fs::File::open(path).expect("open anchor").into())
        .expect("reopen storage")
}

#[test]
fn create_initialize_reopen_and_read_durable_on_real_apfs() {
    with_anchor(|path| {
        let initial = initial_record();
        let mut storage = create(path, &initial);
        let durable = storage::initialize(&mut storage, &initial).expect("initialize");
        let token = durable.token();
        drop(storage);

        let mut reopened = open(path);
        let observed = storage::inspect(&mut reopened).expect("inspect");
        assert!(observed.token() == token);
        let durable = storage::read_durable(&mut reopened, token).expect("durable read");
        assert!(durable.token() == token);
        assert!(path.join("enrollment-attempt-v1/attempt.current").is_file());
        assert!(!path.join("enrollment-attempt-v1/attempt.pending").exists());
    });
}

#[test]
fn explicit_path_constructor_rejects_untrusted_syntax_before_effects() {
    with_anchor(|path| {
        let initial = initial_record();
        let invalid = path.join("nested/../anchor");
        assert_eq!(
            MacStorage::create_new(&invalid, &initial).err(),
            Some(Error::RecoveryRequired)
        );
        assert!(!path.join("enrollment-attempt-v1").exists());
    });
}

#[test]
fn invalid_initial_is_rejected_before_any_store_creation() {
    with_anchor(|path| {
        let mut invalid = initial_record();
        invalid.revision = 1;
        assert_eq!(
            MacStorage::create_new_at(fs::File::open(path).unwrap().into(), &invalid).err(),
            Some(Error::InvalidRecord)
        );
        assert!(!path.join("enrollment-attempt-v1").exists());
    });
}

#[test]
fn descriptor_path_chain_rejects_replacement_after_construction() {
    with_anchor(|path| {
        let parent = path.join("parent");
        let anchor = parent.join("anchor");
        fs::create_dir(&parent).expect("create parent");
        fs::set_permissions(&parent, fs::Permissions::from_mode(0o700)).expect("set parent mode");
        fs::create_dir(&anchor).expect("create nested anchor");
        fs::set_permissions(&anchor, fs::Permissions::from_mode(0o700)).expect("set anchor mode");
        let chain = super::anchor::TrustedAnchor::walk(
            fs::File::open(path).expect("open fixture root").into(),
            vec![OsString::from("parent"), OsString::from("anchor")],
            rustix::process::geteuid().as_raw(),
        )
        .expect("walk retained chain");
        let mut storage = MacStorage::construct(
            chain.descriptor().expect("anchor descriptor"),
            true,
            Some(chain),
        )
        .expect("construct storage");
        storage::initialize(&mut storage, &initial_record()).expect("initialize");
        fs::rename(&parent, path.join("moved-parent")).expect("replace parent path");
        assert_eq!(
            storage::inspect(&mut storage).err(),
            Some(Error::RecoveryRequired)
        );
    });
}

#[test]
fn exact_successor_and_stale_token_remain_conditional_after_restart() {
    with_anchor(|path| {
        let initial = initial_record();
        let mut storage = create(path, &initial);
        let first = storage::initialize(&mut storage, &initial).expect("initialize");
        let token = first.token();
        let mut next = copy(&initial);
        next.revision = 1;
        next.progress = super::super::record::Progress::PairingPrepared;
        let second = storage::compare_and_publish(&mut storage, token, &next).expect("successor");
        assert!(second.token() != token);
        drop(storage);

        let mut reopened = open(path);
        assert_eq!(
            storage::compare_and_publish(&mut reopened, token, &initial).err(),
            Some(Error::InvalidSuccessor)
        );
        assert_eq!(
            storage::read_durable(&mut reopened, token).err(),
            Some(Error::StaleSnapshot)
        );
    });
}

#[test]
fn durability_failure_does_not_claim_a_durable_snapshot() {
    with_anchor(|path| {
        let initial = initial_record();
        let mut storage = create(path, &initial);
        let durable = storage::initialize(&mut storage, &initial).expect("initialize");
        storage.fail_next_committed_sync();
        assert_eq!(
            storage::read_durable(&mut storage, durable.token()).err(),
            Some(Error::StorageUnavailable)
        );
    });
}

#[test]
fn held_attempt_uses_real_apfs_lock_across_reopen() {
    with_anchor(|path| {
        let initial = initial_record();
        let mut storage = create(path, &initial);
        let durable = storage::initialize(&mut storage, &initial).expect("initialize");
        let token = durable.token();
        drop(storage);

        let competitor = open(path);
        let held = HeldAttempt::open(open(path), token).expect("held open");
        assert_eq!(
            HeldAttempt::open(competitor, token).err(),
            Some(Error::Busy)
        );
        drop(held);
        let mut reopened = open(path);
        assert!(storage::read_durable(&mut reopened, token).unwrap().token() == token);
    });
}
