//! The account command must refuse incomplete local authority without repair.
#![cfg(any(target_os = "macos", target_os = "linux"))]
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    process::{Command, Output},
};

const PRIVATE: &str = "PRIVATE_ACCOUNT_SOURCE_CANARY_7832";
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut bytes = [0; 16];
        getrandom::fill(&mut bytes).unwrap();
        let suffix: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = std::env::temp_dir().join(format!("aicharts-account-{PRIVATE}-{suffix}"));
        fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
        Self(path)
    }
    fn write(&self, name: &str, bytes: &[u8]) {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(self.0.join(name))
            .unwrap()
            .write_all(bytes)
            .unwrap();
    }
    fn run(&self, directory: &Path, extra: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_aicharts"))
            .args(["account", "--state-dir"])
            .arg(directory)
            .args(extra)
            .env("HRANESS_SUPPORT", "off")
            .output()
            .unwrap()
    }
    fn unchanged(&self) -> BTreeMap<String, (u64, u32, Vec<u8>)> {
        fs::read_dir(&self.0)
            .unwrap()
            .map(|entry| {
                let entry = entry.unwrap();
                let metadata = fs::symlink_metadata(entry.path()).unwrap();
                assert!(metadata.is_file());
                (
                    entry.file_name().to_string_lossy().into_owned(),
                    (
                        metadata.ino(),
                        metadata.mode(),
                        fs::read(entry.path()).unwrap(),
                    ),
                )
            })
            .collect()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn fixed_refusal(output: &Output) {
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    let stderr = String::from_utf8(output.stderr.clone()).unwrap();
    assert!(stderr.len() < 160);
    assert!(!stderr.contains(PRIVATE));
    assert!(!stderr.contains("acct_"));
    assert!(!stderr.contains("http"));
}

#[test]
fn missing_account_directory_is_not_created_and_no_identity_is_guessed() {
    let fixture = Fixture::new();
    let missing = fixture.0.join("missing");
    fixed_refusal(&fixture.run(&missing, &["--json"]));
    assert!(!missing.exists());
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 0);
}

#[test]
fn account_incomplete_anchor_and_invalid_flags_preserve_all_existing_bytes() {
    let fixture = Fixture::new();
    fixture.write("usage.sqlite3", PRIVATE.as_bytes());
    fixture.write("checkpoint.key", &[0x6c; 32]);
    fixture.write("enrollment-attempt-v1", b"synthetic incomplete anchor");
    let before = fixture.unchanged();
    for extra in [
        vec!["--json"],
        vec!["--resume"],
        vec!["--json", "--json"],
        vec!["--key-file", "private.key"],
        vec!["--codex", PRIVATE],
    ] {
        fixed_refusal(&fixture.run(&fixture.0, &extra));
        assert_eq!(fixture.unchanged(), before);
    }
}

#[test]
fn account_help_explains_local_verification_without_opening_state() {
    let output = Command::new(env!("CARGO_BIN_EXE_aicharts"))
        .args(["account", "--help"])
        .env("HRANESS_SUPPORT", "off")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("aicharts account --state-dir ABSOLUTE_DIR [--json]"));
    assert!(
        text.contains("without advancing enrollment, opening the ledger or contacting a server")
    );
}
