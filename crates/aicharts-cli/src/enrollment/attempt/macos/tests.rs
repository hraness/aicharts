use super::MacStorage;
use crate::enrollment::attempt::{
    record_tests::{copy, initial_record},
    storage, Error,
};
use std::{
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

fn with_anchor(test: impl FnOnce(&Path)) {
    let path = anchor_path();
    fs::create_dir(&path).expect("create disposable anchor");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).expect("set anchor mode");
    test(&path);
    fs::remove_dir_all(path).expect("remove disposable anchor");
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
fn explicit_path_constructor_retains_the_anchor_chain() {
    with_anchor(|path| {
        let initial = initial_record();
        MacStorage::validate_anchor(path).expect("validate explicit anchor");
        let mut storage = MacStorage::create_new(path, &initial).expect("create by path");
        let durable = storage::initialize(&mut storage, &initial).expect("initialize");
        let token = durable.token();
        assert!(token == storage::inspect(&mut storage).expect("inspect").token());
        drop(storage);
        let mut reopened = MacStorage::open_existing(path).expect("reopen by path");
        assert!(
            token
                == storage::read_durable(&mut reopened, token)
                    .expect("durable read")
                    .token()
        );
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
