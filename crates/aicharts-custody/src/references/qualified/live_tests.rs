//! Explicit ignored qualification. Only synthetic records and a fresh private
//! keychain are admitted; never select, unlock, enumerate or delete a user vault.
use super::*;
use crate::{
    macos::{fixture_ui, NativeSession},
    store::{self, RawError, RawResult, RawStore},
    CredentialRef, InsertOutcome, Purpose, Secret32,
};
use security_framework::os::macos::keychain::{CreateOptions, SecKeychain};
use std::{
    fs,
    os::unix::{
        ffi::OsStrExt,
        fs::{DirBuilderExt, MetadataExt},
        process::CommandExt,
    },
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const CHILD: &str = "references::qualified::live_tests::disposable_keychain_child";
const INPUT: &str = "AICHARTS_DISPOSABLE_KEYCHAIN_FIXTURE";
const PARENT: &str = "AICHARTS_DISPOSABLE_KEYCHAIN_PARENT";
const INSTALLATION: [u8; 32] = [67; 32];
const PASSWORD: &str = "aicharts-disposable-synthetic-keychain-only-v1";

fn private_fixture_path(path: &Path) -> bool {
    let bytes = path.as_os_str().as_bytes();
    !bytes
        .windows(b"/login.keychain".len())
        .any(|window| window.eq_ignore_ascii_case(b"/login.keychain"))
        && !bytes.eq_ignore_ascii_case(b"/Library/Keychains/System.keychain")
}

#[test]
fn private_keychain_guard_checks_the_entire_path_not_only_its_basename() {
    for path in ["/task/qualification.keychain", "/private/task/fixture"] {
        assert!(private_fixture_path(Path::new(path)));
    }
    for path in [
        "/task/login.keychain-fixtures/qualification.keychain",
        "/task/LOGIN.KEYCHAIN/child",
        "/Library/Keychains/System.keychain",
    ] {
        assert!(!private_fixture_path(Path::new(path)));
    }
}

fn wait_bounded(child: &mut Child, seconds: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

struct OwnedGroup {
    child: Child,
    pid: rustix::process::Pid,
    closed: bool,
}
impl OwnedGroup {
    fn spawn(command: &mut Command) -> std::result::Result<Self, ()> {
        let child = command.process_group(0).spawn().map_err(|_| ())?;
        let pid = i32::try_from(child.id())
            .ok()
            .filter(|value| *value > 1)
            .and_then(rustix::process::Pid::from_raw)
            .ok_or(())?;
        Ok(Self {
            child,
            pid,
            closed: false,
        })
    }
    fn wait(&mut self, duration: Duration) -> std::result::Result<bool, ()> {
        use rustix::process::{waitid, WaitId, WaitIdOptions};
        let deadline = Instant::now() + duration;
        loop {
            // NOWAIT retains the owned child identity until group cleanup. Never
            // signal a numeric PID that a prior try_wait has already reaped.
            match waitid(
                WaitId::Pid(self.pid),
                WaitIdOptions::EXITED | WaitIdOptions::NOHANG | WaitIdOptions::NOWAIT,
            ) {
                Ok(Some(status)) => return self.finish(status.exit_status() == Some(0)),
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20))
                }
                Ok(None) => return self.finish(false),
                Err(_) => {
                    self.closed = true;
                    return Err(());
                }
            }
        }
    }
    fn finish(&mut self, success: bool) -> std::result::Result<bool, ()> {
        use rustix::process::{kill_process_group, Signal};
        if !success {
            match kill_process_group(self.pid, Signal::KILL) {
                Ok(()) | Err(rustix::io::Errno::SRCH) => (),
                Err(_) => return Err(()),
            }
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match self.child.try_wait() {
                Ok(Some(status)) => {
                    self.closed = true;
                    // A forced group signal plus leader reap cannot prove that
                    // every descendant has terminated. Preserve the fixture on
                    // timeout or abnormal exit; only the successful fixture
                    // child contract proves it waited for its subprocess.
                    return if success && status.success() {
                        Ok(true)
                    } else {
                        Err(())
                    };
                }
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20))
                }
                _ => {
                    self.closed = true;
                    return Err(());
                }
            }
        }
    }
}
impl Drop for OwnedGroup {
    fn drop(&mut self) {
        if !self.closed {
            let _ = self.finish(false);
        }
    }
}

#[test]
fn owned_process_group_timeout_and_normal_exit_reap_only_the_spawned_child() {
    let mut sleeper = OwnedGroup::spawn(
        Command::new("/bin/sleep")
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null()),
    )
    .unwrap();
    assert_eq!(sleeper.wait(Duration::from_millis(20)), Err(()));
    assert!(sleeper.closed);
    assert!(sleeper.child.try_wait().unwrap().is_some());
    let mut success = OwnedGroup::spawn(
        Command::new("/usr/bin/true")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null()),
    )
    .unwrap();
    assert_eq!(success.wait(Duration::from_secs(5)), Ok(true));
    assert!(success.closed);
}

#[test]
fn process_group_grandchild_probe() {
    if std::env::var("AICHARTS_SYNTHETIC_GROUP_CHILD").as_deref() != Ok("1") {
        return;
    }
    let mut child = Command::new("/bin/sleep")
        .arg("30")
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    // The parent waits for this fixed marker before exercising its timeout.
    use std::io::Write;
    std::io::stdout()
        .write_all(b"AICHARTS_GROUP_READY\n")
        .unwrap();
    std::io::stdout().flush().unwrap();
    let _ = child.wait();
}

#[test]
fn timeout_with_a_live_descendant_is_unknown_and_never_authorizes_cleanup() {
    use std::io::Read;
    let mut group = OwnedGroup::spawn(
        Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "references::qualified::live_tests::process_group_grandchild_probe",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("AICHARTS_SYNTHETIC_GROUP_CHILD", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null()),
    )
    .unwrap();
    let mut output = group.child.stdout.take().unwrap();
    let flags = rustix::fs::fcntl_getfl(&output).unwrap();
    rustix::fs::fcntl_setfl(&output, flags | rustix::fs::OFlags::NONBLOCK).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut bytes = Vec::new();
    let mut buffer = [0; 128];
    loop {
        match output.read(&mut buffer) {
            Ok(0) => panic!("synthetic_descendant_exited_before_timeout"),
            Ok(count) => bytes.extend_from_slice(&buffer[..count]),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => (),
            Err(_) => panic!("synthetic_descendant_signal_unavailable"),
        }
        assert!(
            bytes.len() <= 1024 && Instant::now() < deadline,
            "synthetic_descendant_ready_timeout"
        );
        if bytes
            .windows(b"AICHARTS_GROUP_READY".len())
            .any(|window| window == b"AICHARTS_GROUP_READY")
        {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(group.wait(Duration::ZERO), Err(()));
    assert!(group.closed);
    // Observe pipe EOF from both terminated processes as extra test evidence;
    // the production fixture still treats the earlier forced result as unknown.
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match output.read(&mut buffer) {
            Ok(0) => break,
            Ok(_) => (),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => (),
            Err(_) => panic!("synthetic_descendant_cleanup_unavailable"),
        }
        assert!(
            Instant::now() < deadline,
            "synthetic_descendant_did_not_exit"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
#[ignore = "requires an explicitly admitted disposable Keychain qualification"]
fn disposable_keychain_reference_roundtrip() {
    // A reviewed explicit candidate is still not authority: validate its entire
    // descriptor ancestry before creating anything. There is no TMPDIR fallback.
    let parent = PathBuf::from(std::env::var_os(PARENT).expect("qualification_parent_required"));
    assert!(
        private_fixture_path(&parent),
        "qualification_private_path_required"
    );
    MacStorage::validate_anchor(&parent)
        .map_err(|_| "qualification_parent_refused")
        .unwrap();
    let parent_fd = fs::File::open(&parent)
        .map_err(|_| "qualification_parent_open_failed")
        .unwrap();
    let parent_identity = parent_fd.metadata().unwrap();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = parent.join(format!(
        "aicharts-keychain-qualification-{}-{stamp}",
        std::process::id()
    ));
    assert!(
        private_fixture_path(&path.join("qualification.keychain")),
        "qualification_private_path_required"
    );
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&path)
        .map_err(|_| "qualification_create_refused")
        .unwrap();
    MacStorage::validate_anchor(&path)
        .map_err(|_| "qualification_fixture_refused")
        .unwrap();
    let fixture_fd = fs::File::open(&path)
        .map_err(|_| "qualification_fixture_open_failed")
        .unwrap();
    let fixture_identity = fixture_fd.metadata().unwrap();
    let outcome = (|| {
        let mut child = OwnedGroup::spawn(
            Command::new(std::env::current_exe().map_err(|_| ())?)
                .args(["--exact", CHILD, "--ignored", "--test-threads=1"])
                .env(INPUT, &path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null()),
        )?;
        child.wait(Duration::from_secs(45))
    })();
    assert!(
        outcome.is_ok(),
        "qualification_child_custody_unknown_fixture_retained"
    );
    // Child exit ends its session. Do not call SecKeychainDelete: that API also
    // writes keychain-search preferences. This exact directory was created above.
    MacStorage::validate_anchor(&path)
        .map_err(|_| "qualification_cleanup_identity_refused")
        .unwrap();
    for (named, pinned, fd) in [
        (&parent, &parent_identity, &parent_fd),
        (&path, &fixture_identity, &fixture_fd),
    ] {
        let current = fs::symlink_metadata(named)
            .map_err(|_| "qualification_cleanup_missing")
            .unwrap();
        let held = fd
            .metadata()
            .map_err(|_| "qualification_cleanup_descriptor_failed")
            .unwrap();
        assert!(
            current.is_dir()
                && current.dev() == pinned.dev()
                && current.ino() == pinned.ino()
                && held.dev() == pinned.dev()
                && held.ino() == pinned.ino()
                && current.uid() == pinned.uid()
                && current.mode() & 0o7777 == 0o700,
            "qualification_cleanup_identity_refused"
        );
    }
    fs::remove_dir_all(&path)
        .map_err(|_| "qualification_cleanup_refused")
        .unwrap();
    assert!(matches!(outcome, Ok(true)), "qualification_child_failed");
}

fn record(item: u8, secret: u8) -> SecretRecord {
    SecretRecord::checkpoint(
        CredentialRef::new(INSTALLATION, [item; 32], Purpose::Checkpoint).unwrap(),
        Secret32::new([secret; 32]).unwrap(),
    )
    .unwrap()
}

struct LostReply<'a> {
    store: &'a mut dyn RawStore,
    lose: bool,
}
impl RawStore for LostReply<'_> {
    fn read(&mut self, reference: &CredentialRef) -> RawResult<Zeroizing<Vec<u8>>> {
        self.store.read(reference)
    }
    fn add(&mut self, reference: &CredentialRef, bytes: &[u8]) -> RawResult<()> {
        self.store.add(reference, bytes)?;
        if self.lose {
            self.lose = false;
            Err(RawError::Unknown)
        } else {
            Ok(())
        }
    }
}

#[test]
#[ignore = "private child; launched only by the admitted disposable parent test"]
fn disposable_keychain_child() {
    let path = PathBuf::from(std::env::var_os(INPUT).expect("qualification_fixture_required"));
    assert!(
        private_fixture_path(&path.join("qualification.keychain")),
        "qualification_private_path_required"
    );
    assert!(path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("aicharts-keychain-qualification-")));
    MacStorage::validate_anchor(&path)
        .map_err(|_| "qualification_fixture_refused")
        .unwrap();
    assert!(fs::read_dir(&path)
        .map_err(|_| "qualification_directory_unreadable")
        .unwrap()
        .next()
        .is_none());
    let reference_path = path.join("references");
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&reference_path)
        .map_err(|_| "qualification_reference_create_failed")
        .unwrap();
    let mut refs = QualifiedStore::initialize_new(&reference_path, INSTALLATION).unwrap();
    let initial = refs.snapshot().unwrap();
    let original = record(1, 73);
    let prepared = refs.prepare(&initial.token(), &original).unwrap();
    let selections = std::cell::Cell::new(0);
    let mut no_native = LazyStore::new(|| -> RawResult<NativeSession> {
        selections.set(selections.get() + 1);
        Err(RawError::Unavailable)
    });
    assert_eq!(
        engine::install(
            &mut refs.storage,
            &initial.token(),
            &original,
            &mut no_native
        ),
        Err(Error::StaleSnapshot)
    );
    refs.storage.fail_next_committed_sync();
    assert_eq!(
        engine::install(
            &mut refs.storage,
            &prepared.token(),
            &original,
            &mut no_native
        ),
        Err(Error::StorageUnavailable)
    );
    assert_eq!(
        selections.get(),
        0,
        "qualification_refusal_opened_native_session"
    );
    drop(no_native);
    let keychain_path = path.join("qualification.keychain");
    let keychain = fixture_ui(|| {
        CreateOptions::new()
            .password(PASSWORD)
            .prompt_user(false)
            .create(&keychain_path)
            .map_err(|_| crate::Error::Unavailable)
    })
    .map_err(|_| "qualification_keychain_create_failed")
    .unwrap();
    let mut vault = LazyStore::new(|| NativeSession::fixture(keychain.clone()));
    let verified =
        engine::install(&mut refs.storage, &prepared.token(), &original, &mut vault).unwrap();
    assert_eq!(
        store::insert_immutable(&mut vault, &original),
        Ok(InsertOutcome::AlreadyPresent)
    );
    assert_eq!(
        store::insert_immutable(&mut vault, &record(1, 74)),
        Err(crate::Error::Conflict)
    );
    let wrong_purpose = RecordIdentity::pairing(
        CredentialRef::new(INSTALLATION, [1; 32], Purpose::Pairing).unwrap(),
        [91; 32],
    )
    .unwrap();
    assert!(store::read_exact(&mut vault, &wrong_purpose).err() == Some(crate::Error::Missing));
    assert!(engine::resolve(
        &mut refs.storage,
        &verified.token(),
        original.identity(),
        &mut vault
    )
    .is_ok());
    drop(vault);
    drop(refs);

    let reopened =
        fixture_ui(|| SecKeychain::open(&keychain_path).map_err(|_| crate::Error::Unavailable))
            .unwrap();
    let mut refs = QualifiedStore::open_existing(&reference_path).unwrap();
    let mut vault = LazyStore::new(|| NativeSession::fixture(reopened.clone()));
    assert!(engine::resolve(
        &mut refs.storage,
        &verified.token(),
        original.identity(),
        &mut vault
    )
    .is_ok());
    let pending = record(2, 79);
    let before_loss = refs.prepare(&verified.token(), &pending).unwrap();
    let mut lost = LostReply {
        store: &mut vault,
        lose: true,
    };
    assert_eq!(
        engine::install(&mut refs.storage, &before_loss.token(), &pending, &mut lost),
        Err(Error::Custody(crate::Error::OutcomeUnknown))
    );
    let recovered = engine::reconcile(
        &mut refs.storage,
        &before_loss.token(),
        pending.identity(),
        &mut vault,
    )
    .unwrap();
    assert!(engine::resolve(
        &mut refs.storage,
        &recovered.token(),
        pending.identity(),
        &mut vault
    )
    .is_ok());
    drop(vault);

    // The absolute explicit argument avoids security's name/search-list lookup.
    // No password is supplied in argv, and lock-all/default paths are absent.
    let mut lock = Command::new("/usr/bin/security")
        .arg("lock-keychain")
        .arg(&keychain_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    assert!(
        wait_bounded(&mut lock, 5),
        "qualification_fixture_lock_failed"
    );
    let mut locked = LazyStore::new(|| NativeSession::fixture(reopened.clone()));
    let error = engine::resolve(
        &mut refs.storage,
        &recovered.token(),
        original.identity(),
        &mut locked,
    )
    .err();
    assert!(
        matches!(
            error,
            Some(Error::Custody(
                crate::Error::InteractionRequired | crate::Error::AccessDenied
            ))
        ),
        "qualification_locked_access_did_not_refuse"
    );
    drop(locked);
    let mut unlocked = reopened.clone();
    fixture_ui(|| {
        unlocked
            .unlock(Some(PASSWORD))
            .map_err(|_| crate::Error::Unavailable)
    })
    .unwrap();
    let mut final_store = LazyStore::new(|| NativeSession::fixture(unlocked.clone()));
    assert!(engine::resolve(
        &mut refs.storage,
        &recovered.token(),
        original.identity(),
        &mut final_store
    )
    .is_ok());
    drop(final_store);
    // The nonsecret reference directory must never contain either raw record.
    for name in ["references.lock", "references.current"] {
        let bytes = fs::read(reference_path.join("references-v1").join(name)).unwrap();
        for secret in [[73; 32], [79; 32]] {
            assert!(!bytes.windows(32).any(|window| window == secret));
        }
    }
}
