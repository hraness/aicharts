//! Read-only CLI tests use only newly created synthetic private ledgers.
#![cfg(any(target_os = "macos", target_os = "linux"))]
use aicharts_core::{Collection, Warning};
use aicharts_ledger::{Ledger, LedgerIdentity, SourceScan, SourceStamp};
use aicharts_protocol::{AuthMode, Batch, Evidence, Provider, Tokens, Usage};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{Command, Output},
};

const KEY: [u8; 32] = [7; 32];
const OCCURRENCE: [u8; 32] = [8; 32];
const PRIVATE: &str = "PRIVATE_INSPECTION_CANARY_472e";

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut random = [0; 16];
        getrandom::fill(&mut random).unwrap();
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = std::env::temp_dir().join(format!("aicharts-inspect-{PRIVATE}-{suffix}"));
        fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
        let fixture = Self(path);
        fixture.write("checkpoint.key", &KEY);
        fixture.write("occurrence.key", &OCCURRENCE);
        fixture.write("wrong.key", &[9; 32]);
        fixture
    }
    fn write(&self, name: &str, bytes: &[u8]) {
        fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(self.0.join(name))
            .unwrap()
            .write_all(bytes)
            .unwrap();
    }
    fn identity(split: bool) -> LedgerIdentity<'static> {
        if split {
            LedgerIdentity::SplitKeys {
                checkpoint: &KEY,
                occurrence: &OCCURRENCE,
                namespace_version: 1,
            }
        } else {
            LedgerIdentity::Legacy(&KEY)
        }
    }
    fn initialize(&self, split: bool, prefix: bool) {
        let identity = Self::identity(split);
        let mut ledger =
            Ledger::initialize_with_identity(&self.0.join("state"), &identity).unwrap();
        ledger
            .commit_scans(
                0,
                vec![SourceScan {
                    source_id: [31; 32],
                    stamp: SourceStamp {
                        device: 1,
                        inode: 2,
                        bytes: 100,
                        modified_seconds: 100,
                        modified_nanos: 0,
                        changed_seconds: 100,
                        changed_nanos: 0,
                    },
                    collection: Collection {
                        batches: vec![Batch {
                            utc_day: 20000,
                            registry_revision: 1,
                            prompts: vec![],
                            intervals: vec![],
                            usage: vec![Usage {
                                id: [41; 16],
                                execution_id: [42; 16],
                                account_id: [0; 16],
                                offset_ms: 1000,
                                provider: Provider::ClaudeCode,
                                auth_mode: AuthMode::Unknown,
                                evidence: Evidence::Imported,
                                model_id: 0,
                                context_tier: 0,
                                tokens: Tokens {
                                    input_uncached: 100,
                                    cache_read: 20,
                                    output: 20,
                                    ..Tokens::default()
                                },
                            }],
                        }],
                        warnings: vec![
                            Warning::UnmeasuredActivity,
                            Warning::UnmeasuredPrompts,
                            Warning::UnmeasuredReasoning,
                        ],
                        lines_read: 1,
                    },
                }],
            )
            .unwrap();
        drop(ledger);
        if prefix {
            drop(Ledger::migrate_complete_prefix(&self.0.join("state"), &identity, 1).unwrap());
        }
    }
    fn run(&self, args: &[&str]) -> Output {
        let result = Command::new(env!("CARGO_BIN_EXE_aicharts"))
            .current_dir(&self.0)
            .args(args)
            .output()
            .unwrap();
        for output in [&result.stdout, &result.stderr] {
            assert!(!String::from_utf8_lossy(output).contains(PRIVATE));
            for secret in [&KEY, &OCCURRENCE] {
                assert!(!output.windows(32).any(|window| window == secret));
            }
        }
        result
    }
    fn inspect(&self, split: bool, json: bool) -> Output {
        let mut args = vec![
            "inspect",
            "--state-dir",
            "state",
            "--key-file",
            "checkpoint.key",
        ];
        if split {
            args.extend(["--occurrence-key-file", "occurrence.key"]);
        }
        if json {
            args.push("--json");
        }
        self.run(&args)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

// atime can change through reads; bytes, named structure, identity, permissions,
// mtime and ctime must not. No fixture path is followed through a symlink.
#[derive(Debug, PartialEq, Eq)]
struct Entry {
    device: u64,
    inode: u64,
    mode: u32,
    modified: (i64, i64),
    changed: (i64, i64),
    bytes: Vec<u8>,
}
type Image = BTreeMap<PathBuf, Entry>;
fn image(path: &Path) -> Image {
    fn walk(root: &Path, path: &Path, result: &mut Image) {
        let metadata = fs::symlink_metadata(path).unwrap();
        let bytes = if metadata.is_file() {
            fs::read(path).unwrap()
        } else if metadata.file_type().is_symlink() {
            fs::read_link(path)
                .unwrap()
                .to_string_lossy()
                .as_bytes()
                .to_vec()
        } else {
            vec![]
        };
        result.insert(
            path.strip_prefix(root).unwrap().to_owned(),
            Entry {
                device: metadata.dev(),
                inode: metadata.ino(),
                mode: metadata.mode(),
                modified: (metadata.mtime(), metadata.mtime_nsec()),
                changed: (metadata.ctime(), metadata.ctime_nsec()),
                bytes,
            },
        );
        if metadata.is_dir() {
            for entry in fs::read_dir(path).unwrap() {
                walk(root, &entry.unwrap().path(), result);
            }
        }
    }
    let mut result = BTreeMap::new();
    walk(path, path, &mut result);
    result
}

#[test]
fn inspect_legacy_split_and_prefix_layouts_are_exact_and_read_only() {
    for split in [false, true] {
        for prefix in [false, true] {
            let fixture = Fixture::new();
            fixture.initialize(split, prefix);
            let before = image(&fixture.0);
            let result = fixture.inspect(split, true);
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            assert!(result.stderr.is_empty());
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&result.stdout).unwrap(),
                serde_json::json!({
                    "schemaVersion":1,"operation":"inspect","access":"read_only","coverage":"partial",
                    "revision":"1","sources":1,"usageOccurrences":1,"pendingRecords":1,"tokens":"140","outputTokens":"20",
                    "warnings":["unmeasured_activity","unmeasured_prompts","unmeasured_reasoning"],"unavailable":["prompts","activity","pricing"]
                })
            );
            let text = fixture.inspect(split, false);
            assert!(text.status.success());
            assert!(String::from_utf8(text.stdout)
                .unwrap()
                .contains("No sources scanned; nothing uploaded."));
            assert_eq!(image(&fixture.0), before);
        }
    }
}

#[test]
fn inspect_never_guesses_namespace_or_uses_a_wrong_key() {
    for split in [false, true] {
        let fixture = Fixture::new();
        fixture.initialize(split, false);
        let before = image(&fixture.0);
        let wrong_mode = fixture.inspect(!split, true);
        assert_eq!(wrong_mode.status.code(), Some(2));
        assert!(wrong_mode.stdout.is_empty());
        assert_eq!(
            String::from_utf8(wrong_mode.stderr).unwrap(),
            "aicharts: ledger_namespace_mismatch\n"
        );
        for key_flag in ["--key-file", "--occurrence-key-file"] {
            let result = fixture.run(&[
                "inspect",
                "--state-dir",
                "state",
                "--key-file",
                if key_flag == "--key-file" {
                    "wrong.key"
                } else {
                    "checkpoint.key"
                },
                "--occurrence-key-file",
                if key_flag == "--occurrence-key-file" {
                    "wrong.key"
                } else {
                    "occurrence.key"
                },
            ]);
            assert_eq!(result.status.code(), Some(2));
            assert!(result.stdout.is_empty());
        }
        assert_eq!(image(&fixture.0), before);
    }
}

#[test]
fn inspect_rejects_unknown_duplicate_or_source_flags_before_key_io() {
    let fixture = Fixture::new();
    let before = image(&fixture.0);
    for extra in [
        vec!["--codex", PRIVATE],
        vec!["--claude", PRIVATE],
        vec!["--rescan"],
        vec!["--dry-run"],
        vec!["--revision", "0"],
        vec!["--json", "--json"],
        vec!["--key-file", PRIVATE],
        vec!["--unknown"],
    ] {
        let mut args = vec!["inspect", "--state-dir", PRIVATE, "--key-file", PRIVATE];
        args.extend(extra);
        let result = fixture.run(&args);
        assert_eq!(result.status.code(), Some(2));
        assert!(result.stdout.is_empty());
        assert_eq!(
            String::from_utf8(result.stderr).unwrap(),
            "aicharts: invalid_option\n"
        );
    }
    assert_eq!(image(&fixture.0), before);
}

#[test]
fn inspect_does_not_create_missing_state_or_recover_sidecars() {
    let fixture = Fixture::new();
    let before = image(&fixture.0);
    assert_eq!(fixture.inspect(false, true).status.code(), Some(2));
    assert_eq!(image(&fixture.0), before);
    fixture.initialize(false, false);
    for name in [
        "usage.sqlite3-journal",
        "usage.sqlite3-wal",
        "usage.sqlite3-shm",
    ] {
        fixture.write(&format!("state/{name}"), PRIVATE.as_bytes());
        let before = image(&fixture.0);
        let result = fixture.inspect(false, true);
        assert_eq!(result.status.code(), Some(2));
        assert!(result.stdout.is_empty());
        assert!(String::from_utf8(result.stderr)
            .unwrap()
            .contains("recovery_required"));
        assert_eq!(image(&fixture.0), before);
        fs::remove_file(fixture.0.join("state").join(name)).unwrap();
    }
}

#[test]
fn inspect_refuses_unsafe_state_and_key_paths_without_repair() {
    let fixture = Fixture::new();
    fixture.initialize(false, false);
    fs::set_permissions(
        fixture.0.join("checkpoint.key"),
        fs::Permissions::from_mode(0o644),
    )
    .unwrap();
    let before = image(&fixture.0);
    assert_eq!(fixture.inspect(false, true).status.code(), Some(2));
    assert_eq!(image(&fixture.0), before);
    fs::set_permissions(
        fixture.0.join("checkpoint.key"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    std::os::unix::fs::symlink("state", fixture.0.join("state-link")).unwrap();
    std::os::unix::fs::symlink("checkpoint.key", fixture.0.join("key-link")).unwrap();
    for (state, key) in [("state-link", "checkpoint.key"), ("state", "key-link")] {
        let before = image(&fixture.0);
        let result = fixture.run(&["inspect", "--state-dir", state, "--key-file", key]);
        assert_eq!(result.status.code(), Some(2));
        assert!(result.stdout.is_empty());
        assert_eq!(image(&fixture.0), before);
    }
    fs::set_permissions(fixture.0.join("state"), fs::Permissions::from_mode(0o755)).unwrap();
    let before = image(&fixture.0);
    assert_eq!(fixture.inspect(false, true).status.code(), Some(2));
    assert_eq!(image(&fixture.0), before);
}

#[test]
fn inspect_sender_layouts_preserve_existing_frozen_uploads() {
    let binding = aicharts_ledger::SenderBinding {
        account_id: [51; 16],
        device_id: [52; 32],
        generation: [53; 32],
        namespace_version: 1,
    };
    for prefix in [false, true] {
        let fixture = Fixture::new();
        fixture.initialize(true, prefix);
        let mut ledger = Ledger::migrate_sender_v2(
            &fixture.0.join("state"),
            &Fixture::identity(true),
            1,
            &binding,
        )
        .unwrap();
        ledger.freeze_upload_batch(1, &[[41; 16]]).unwrap();
        drop(ledger);
        let before = image(&fixture.0);
        let result = fixture.inspect(true, true);
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let value: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
        // Freezing the upload batch advances the ledger's existing revision.
        assert_eq!(value["revision"], "2");
        assert_eq!(value["pendingRecords"], 1);
        assert_eq!(image(&fixture.0), before);
    }
}
