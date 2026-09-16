//! Resolution and provisioning tests. The custody-verified join itself is a
//! macOS-only live path covered by the enrollment suite; these cases fix the
//! unenrolled answer, the fail-closed refusals, the explicit-key precedence
//! and the atomic in-anchor provisioning a resolved identity drives.

use super::*;
use std::os::unix::fs::DirBuilderExt;

const CHECKPOINT: [u8; 32] = [7; 32];
const NAMESPACE_CANARY: [u8; 32] = [0x5a; 32];

struct Fixture(std::path::PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut random = [0; 16];
        getrandom::fill(&mut random).unwrap();
        let suffix: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let path = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("aicharts-enrolled-ledger-test-{suffix}"));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .unwrap();
        Self(path)
    }

    /// `enroll` pre-creates the state anchor; the ledger never adopts a dir it
    /// did not make, so the fixture mirrors that split.
    fn state(&self) -> std::path::PathBuf {
        self.0.join("state")
    }

    fn create_state(&self) -> std::path::PathBuf {
        let path = self.state();
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .unwrap();
        path
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn write_key(path: &Path, key: &[u8; 32]) {
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .expect("create key file");
    use std::io::Write;
    file.write_all(key).expect("write key file");
}

#[test]
fn unenrolled_dir_resolves_legacy_or_explicit_key() {
    let fixture = Fixture::new();
    let dir = fixture.state();
    assert_eq!(resolve(&dir, None), Ok(None));
    let key = fixture.0.join("key");
    write_key(&key, &CHECKPOINT);
    assert_eq!(resolve(&dir, Some(&key)), Ok(Some(CHECKPOINT)));
}

#[test]
fn explicit_key_file_is_refused_only_for_an_enrolled_dir() {
    let key_path = Path::new("unused-key-file");
    assert_eq!(
        choose(Some(NAMESPACE_CANARY), Some(key_path)).err(),
        Some("occurrence_key_file_conflicts_with_enrollment")
    );
    assert_eq!(
        choose(Some(NAMESPACE_CANARY), None),
        Ok(Some(NAMESPACE_CANARY))
    );
    assert_eq!(choose(None, None), Ok(None));
}

#[test]
fn committed_attempt_layout_refuses_closed_on_every_platform() {
    let fixture = Fixture::new();
    let dir = fixture.create_state();
    // An interrupted anchor leaves the attempt layout without a committed
    // record; presence alone must refuse, never fall back to legacy.
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(dir.join(ATTEMPT_LAYOUT))
        .expect("create attempt layout");
    #[cfg(target_os = "macos")]
    {
        assert_eq!(resolve(&dir, None).err(), Some("attempt_recovery_required"));
        // The refusal wins over an explicit file too: custody state decides
        // before the file is ever read.
        assert_eq!(
            resolve(&dir, Some(Path::new("key"))).err(),
            Some("attempt_recovery_required")
        );
    }
    #[cfg(not(target_os = "macos"))]
    assert_eq!(
        resolve(&dir, None).err(),
        Some("persistent_state_requires_qualified_macos_custody")
    );
}

#[test]
fn initialize_in_anchor_installs_database_without_adopting_state() {
    let fixture = Fixture::new();
    let dir = fixture.create_state();
    let identity = LedgerIdentity::SplitKeys {
        checkpoint: &CHECKPOINT,
        occurrence: &NAMESPACE_CANARY,
        namespace_version: 1,
    };
    let ledger = initialize_in_anchor(&dir, &identity).expect("initialize in anchor");
    drop(ledger);
    // The database lives inside the pre-existing anchor; the staging sibling
    // is gone and the namespace binds both keys, so a legacy open refuses.
    assert!(dir.join(LEDGER_MAIN).is_file());
    let staging = dir.parent().unwrap().join("state.aicharts-ledger-staging");
    assert!(!staging.exists());
    assert_eq!(
        Ledger::open(&dir, &CHECKPOINT).err(),
        Some(aicharts_ledger::Error::WrongNamespace)
    );
    let reopened = Ledger::open_with_identity(&dir, &identity).expect("reopen split");
    assert_eq!(reopened.status().unwrap().revision, 0);
    // A second initialization never overwrites the installed ledger.
    assert_eq!(
        initialize_in_anchor(&dir, &identity).err(),
        Some("ledger_private_state_required")
    );
}

#[test]
fn initialize_in_anchor_refuses_any_existing_ledger_artifact() {
    let fixture = Fixture::new();
    let dir = fixture.create_state();
    let identity = LedgerIdentity::SplitKeys {
        checkpoint: &CHECKPOINT,
        occurrence: &NAMESPACE_CANARY,
        namespace_version: 1,
    };
    fs::write(dir.join("usage.sqlite3-wal"), b"partial").expect("plant leftover");
    assert_eq!(
        initialize_in_anchor(&dir, &identity).err(),
        Some("ledger_private_state_required")
    );
    // No staging directory was created for a refused initialization.
    assert!(!dir
        .parent()
        .unwrap()
        .join("state.aicharts-ledger-staging")
        .exists());
}
