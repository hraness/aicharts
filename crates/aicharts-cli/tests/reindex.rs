//! Reindex commands operate only on synthetic, privately owned temporary fixtures.
#![cfg(any(target_os = "macos", target_os = "linux"))]

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Cursor, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{Command, Output},
};

use aicharts_ledger::{LedgerIdentity, ReadOnlyLedger};
use aicharts_protocol::{decode, Policy, Provider, Registry};
use serde_json::{json, Value};

const PRIVATE: &str = "PRIVATE_REINDEX_CONTENT_CANARY_29d7";
const CLAUDE: &str = "claude_PRIVATE_REINDEX_PATH_29d7.jsonl";
const CODEX: &str = "codex_PRIVATE_REINDEX_PATH_29d7.jsonl";
const LEGACY_KEY: [u8; 32] = [17; 32];
const ACCOUNT_KEY: [u8; 32] = [29; 32];

#[derive(Debug, PartialEq, Eq)]
struct Entry {
    mode: u32,
    inode: u64,
    modified: (i64, i64),
    bytes: Option<Vec<u8>>,
    link: Option<PathBuf>,
}

fn tree(root: &Path) -> BTreeMap<PathBuf, Entry> {
    fn visit(root: &Path, path: &Path, result: &mut BTreeMap<PathBuf, Entry>) {
        let metadata = fs::symlink_metadata(path).unwrap();
        result.insert(
            path.strip_prefix(root).unwrap().to_owned(),
            Entry {
                mode: metadata.mode(),
                inode: metadata.ino(),
                modified: (metadata.mtime(), metadata.mtime_nsec()),
                bytes: metadata.is_file().then(|| fs::read(path).unwrap()),
                link: metadata
                    .file_type()
                    .is_symlink()
                    .then(|| fs::read_link(path).unwrap()),
            },
        );
        if metadata.is_dir() {
            for child in fs::read_dir(path).unwrap() {
                visit(root, &child.unwrap().path(), result);
            }
        }
    }
    let mut result = BTreeMap::new();
    visit(root, root, &mut result);
    result
}

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let root = std::env::temp_dir().join(format!("aicharts-reindex-test-{suffix}"));
        fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
        let fixture = Self(root);
        fixture.key("legacy.key", &LEGACY_KEY);
        fixture.key("account.key", &ACCOUNT_KEY);
        fixture.success(&["init", "--state-dir", "legacy", "--key-file", "legacy.key"]);
        fixture
    }

    fn key(&self, name: &str, bytes: &[u8; 32]) {
        let path = self.0.join(name);
        fs::write(&path, bytes).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
    }

    fn write(&self, path: &str, text: &str) {
        fs::write(self.0.join(path), text).unwrap();
    }

    fn append(&self, path: &str, text: &str) {
        fs::OpenOptions::new()
            .append(true)
            .open(self.0.join(path))
            .unwrap()
            .write_all(text.as_bytes())
            .unwrap();
    }

    fn run(&self, args: &[&str]) -> Output {
        let output = Command::new(env!("CARGO_BIN_EXE_aicharts"))
            .current_dir(&self.0)
            .args(args)
            .output()
            .unwrap();
        for bytes in [&output.stdout, &output.stderr] {
            let text = String::from_utf8_lossy(bytes);
            for forbidden in [
                PRIVATE,
                CLAUDE,
                CODEX,
                "legacy.key",
                "account.key",
                self.0.to_str().unwrap(),
            ] {
                assert!(!text.contains(forbidden), "reflected private fixture data");
            }
            for key in [LEGACY_KEY, ACCOUNT_KEY] {
                let hex: String = key.iter().map(|byte| format!("{byte:02x}")).collect();
                assert!(!text.contains(&hex), "reflected private key bytes");
            }
        }
        output
    }

    fn success(&self, args: &[&str]) -> Output {
        let output = self.run(args);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(output.stderr.is_empty());
        output
    }

    fn failure(&self, args: &[&str], code: &str) {
        let before = tree(&self.0);
        let output = self.run(args);
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert_eq!(output.stderr, format!("aicharts: {code}\n").as_bytes());
        assert_eq!(
            tree(&self.0),
            before,
            "failure changed fixture bytes or entries"
        );
    }

    fn collect(&self, sources: &[&str]) -> Value {
        let mut args = vec![
            "collect",
            "--state-dir",
            "legacy",
            "--key-file",
            "legacy.key",
            "--json",
        ];
        args.extend_from_slice(sources);
        serde_json::from_slice(&self.success(&args).stdout).unwrap()
    }

    fn plan_args<'a>(&self, sources: &[&'a str]) -> Vec<&'a str> {
        let mut args = vec![
            "reindex-plan",
            "--dry-run",
            "--state-dir",
            "legacy",
            "--key-file",
            "legacy.key",
            "--json",
        ];
        args.extend_from_slice(sources);
        args
    }

    fn prepare_args<'a>(&self, sources: &[&'a str]) -> Vec<&'a str> {
        let mut args = vec![
            "reindex-prepare",
            "--state-dir",
            "legacy",
            "--key-file",
            "legacy.key",
            "--shadow-dir",
            "shadow",
            "--occurrence-key-file",
            "account.key",
            "--json",
        ];
        args.extend_from_slice(sources);
        args
    }

    fn plan(&self, sources: &[&str]) -> Value {
        let before = tree(&self.0);
        let result =
            serde_json::from_slice(&self.success(&self.plan_args(sources)).stdout).unwrap();
        assert_eq!(
            tree(&self.0),
            before,
            "dry-run changed fixture bytes or entries"
        );
        report(&result, "reindex-plan");
        result
    }

    fn prepare(&self, sources: &[&str]) -> Value {
        let before = tree(&self.0);
        let result =
            serde_json::from_slice(&self.success(&self.prepare_args(sources)).stdout).unwrap();
        let mut after = tree(&self.0);
        after.retain(|path, _| !path.starts_with("shadow"));
        // Creating a sibling changes only the fixture parent's directory timestamp.
        after.get_mut(Path::new("")).unwrap().modified = before[Path::new("")].modified;
        assert_eq!(after, before, "preparation changed existing fixture state");
        report(&result, "reindex-prepare");
        for entry in tree(&self.0.join("shadow")).values() {
            assert_eq!(entry.mode & 0o077, 0);
            if let Some(bytes) = &entry.bytes {
                assert!(!bytes
                    .windows(PRIVATE.len())
                    .any(|part| part == PRIVATE.as_bytes()));
                assert!(!bytes
                    .windows(CLAUDE.len())
                    .any(|part| part == CLAUDE.as_bytes()));
                assert!(!bytes
                    .windows(CODEX.len())
                    .any(|part| part == CODEX.as_bytes()));
                assert!(!bytes
                    .windows(32)
                    .any(|part| part == LEGACY_KEY || part == ACCOUNT_KEY));
            }
        }
        result
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // No other path is ever placed in this fixture's cleanup authority.
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn claude(request: &str, output: u64) -> String {
    json!({
        "type":"assistant", "requestId":request, "sessionId":"session_a",
        "timestamp":"2026-09-10T10:00:00Z", "cwd":PRIVATE,
        "message":{"id":"message_a", "content":[{"type":"text","text":PRIVATE}],
            "usage":{"input_tokens":100,"output_tokens":output,
                "cache_read_input_tokens":50,"cache_creation_input_tokens":0}}
    })
    .to_string()
        + "\n"
}

fn codex() -> String {
    json!({"type":"session_meta","payload":{"id":"codex_session","cwd":PRIVATE}}).to_string()
        + "\n"
        + &json!({"type":"event_msg","timestamp":"2026-09-10T11:00:00Z",
            "payload":{"type":"token_count","message":PRIVATE,"info":{
                "total_token_usage":{"input_tokens":10,"output_tokens":5},
                "last_token_usage":{"input_tokens":10,"output_tokens":5}}}})
        .to_string()
        + "\n"
}

fn report(value: &Value, operation: &str) {
    let expected: BTreeSet<&str> = [
        "schemaVersion",
        "operation",
        "localOnly",
        "uploaded",
        "acknowledged",
        "promoted",
        "legacyRevision",
        "pendingRecords",
        "matchedOccurrences",
        "missingOccurrences",
        "conflictingOccurrences",
        "newOccurrences",
        "readyToPrepare",
        "prepared",
        "shadowRevision",
        "namespaceVersion",
        "sourcesRead",
        "linesRead",
        "bytesScanned",
        "measurementCoverage",
    ]
    .into_iter()
    .collect();
    let actual: BTreeSet<&str> = value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        expected, actual,
        "report contains only the frozen bounded projection"
    );
    assert_eq!(value["schemaVersion"], 1);
    assert_eq!(value["operation"], operation);
    assert_eq!(value["localOnly"], true);
    assert_eq!(value["uploaded"], false);
    assert_eq!(value["acknowledged"], false);
    assert_eq!(value["promoted"], false);
    assert_eq!(value["namespaceVersion"], 1);
    assert_eq!(value["measurementCoverage"], "partial");
    assert!(value["legacyRevision"].as_u64().is_some());
    for field in ["pendingRecords", "sourcesRead", "linesRead", "bytesScanned"] {
        assert!(value[field].as_u64().is_some());
    }
    if operation == "reindex-plan" {
        assert_eq!(value["prepared"], false);
        assert!(value["shadowRevision"].is_null());
    } else {
        assert_eq!(value["prepared"], true);
        assert!(value["shadowRevision"].as_u64().is_some());
    }
}

fn counts(value: &Value, matched: u64, missing: u64, conflicting: u64, new: u64) {
    assert_eq!(value["matchedOccurrences"], matched);
    assert_eq!(value["missingOccurrences"], missing);
    assert_eq!(value["conflictingOccurrences"], conflicting);
    assert_eq!(value["newOccurrences"], new);
    assert_eq!(value["readyToPrepare"], missing == 0 && conflicting == 0);
}

#[test]
fn plan_fully_rereads_unchanged_sources_and_preserves_every_existing_byte() {
    let f = Fixture::new();
    let text = claude("request_a", 20);
    f.write(CLAUDE, &text);
    let imported = f.collect(&["--claude", CLAUDE]);
    let first = f.plan(&["--claude", CLAUDE]);
    counts(&first, 1, 0, 0, 0);
    assert_eq!(first["legacyRevision"], imported["ledgerRevision"]);
    assert_eq!(first["pendingRecords"], 1);
    assert_eq!(first["sourcesRead"], 1);
    assert_eq!(first["linesRead"], 1);
    assert_eq!(first["bytesScanned"], text.len());
    assert_eq!(f.plan(&["--claude", CLAUDE]), first);
}

#[test]
fn copied_sources_match_once_without_creating_new_occurrences() {
    let f = Fixture::new();
    f.write(CLAUDE, &claude("request_a", 20));
    f.collect(&["--claude", CLAUDE]);
    fs::copy(f.0.join(CLAUDE), f.0.join("copy.jsonl")).unwrap();
    let sources = ["--claude", CLAUDE, "--claude", "copy.jsonl"];
    let planned = f.plan(&sources);
    counts(&planned, 1, 0, 0, 0);
    assert_eq!(planned["sourcesRead"], 2);
    assert_eq!(planned["linesRead"], 2);
    let prepared = f.prepare(&sources);
    counts(&prepared, 1, 0, 0, 0);
    assert_eq!(prepared["pendingRecords"], 1);
    let shadow = ReadOnlyLedger::open(
        &f.0.join("shadow"),
        &LedgerIdentity::SplitKeys {
            checkpoint: &LEGACY_KEY,
            occurrence: &ACCOUNT_KEY,
            namespace_version: 1,
        },
    )
    .unwrap();
    assert_eq!(shadow.status().sources, 2);
    assert_eq!(shadow.status().usage_occurrences, 1);
    assert_eq!(shadow.status().pending_records, 1);
    assert_eq!(shadow.status().tokens, 170);
}

#[test]
fn new_usage_is_reported_separately_and_included_only_in_the_shadow() {
    let f = Fixture::new();
    f.write(CLAUDE, &claude("request_a", 20));
    f.collect(&["--claude", CLAUDE]);
    f.append(CLAUDE, &claude("request_b", 30));
    counts(&f.plan(&["--claude", CLAUDE]), 1, 0, 0, 1);
    counts(&f.prepare(&["--claude", CLAUDE]), 1, 0, 0, 1);
}

#[test]
fn missing_history_reports_not_ready_and_refuses_before_creating_shadow() {
    let f = Fixture::new();
    f.write(CLAUDE, &claude("request_a", 20));
    f.write("other.jsonl", &claude("request_b", 30));
    f.collect(&["--claude", CLAUDE, "--claude", "other.jsonl"]);
    counts(&f.plan(&["--claude", CLAUDE]), 1, 1, 0, 0);
    f.failure(
        &f.prepare_args(&["--claude", CLAUDE]),
        "reindex_missing_history",
    );
    assert!(!f.0.join("shadow").exists());
}

#[test]
fn changed_counters_are_conflicts_even_when_occurrence_identity_is_unchanged() {
    for output in [0, 19, 21, 2_000_000] {
        let f = Fixture::new();
        f.write(CLAUDE, &claude("request_a", 20));
        f.collect(&["--claude", CLAUDE]);
        f.write(CLAUDE, &claude("request_a", output));
        counts(&f.plan(&["--claude", CLAUDE]), 0, 0, 1, 0);
        f.failure(
            &f.prepare_args(&["--claude", CLAUDE]),
            "reindex_conflicting_history",
        );
        assert!(!f.0.join("shadow").exists());
    }
}

#[test]
fn conflicting_history_takes_precedence_over_missing_history() {
    let f = Fixture::new();
    f.write(
        CLAUDE,
        &(claude("request_a", 20) + &claude("request_b", 30)),
    );
    f.collect(&["--claude", CLAUDE]);
    f.write(CLAUDE, &claude("request_a", 21));
    counts(&f.plan(&["--claude", CLAUDE]), 0, 1, 1, 0);
    f.failure(
        &f.prepare_args(&["--claude", CLAUDE]),
        "reindex_conflicting_history",
    );
}

#[test]
fn equal_totals_with_different_native_identity_do_not_establish_history_coverage() {
    let f = Fixture::new();
    f.write(CLAUDE, &claude("request_a", 20));
    f.collect(&["--claude", CLAUDE]);
    f.write(CLAUDE, &claude("request_b", 20));
    counts(&f.plan(&["--claude", CLAUDE]), 0, 1, 0, 1);
    f.failure(
        &f.prepare_args(&["--claude", CLAUDE]),
        "reindex_missing_history",
    );
}

#[test]
fn wrong_legacy_key_is_rejected_before_an_unreadable_source() {
    let f = Fixture::new();
    f.key("wrong.key", &[41; 32]);
    for mut args in [
        f.plan_args(&["--claude", "absent.jsonl"]),
        f.prepare_args(&["--claude", "absent.jsonl"]),
    ] {
        let key = args
            .iter()
            .position(|argument| *argument == "--key-file")
            .unwrap()
            + 1;
        args[key] = "wrong.key";
        f.failure(&args, aicharts_ledger::Error::WrongNamespace.code());
    }
}

#[test]
fn partial_tail_cannot_advance_state_or_create_a_shadow() {
    let f = Fixture::new();
    f.write(CLAUDE, &claude("request_a", 20));
    f.collect(&["--claude", CLAUDE]);
    f.append(CLAUDE, "{\"type\":\"assistant\"");
    f.failure(&f.plan_args(&["--claude", CLAUDE]), "source_partial_tail");
    f.failure(
        &f.prepare_args(&["--claude", CLAUDE]),
        "source_partial_tail",
    );
    assert!(!f.0.join("shadow").exists());
}

#[test]
fn existing_shadow_directory_or_file_is_never_adopted_or_overwritten() {
    for directory in [false, true] {
        let f = Fixture::new();
        f.write(CLAUDE, &claude("request_a", 20));
        f.collect(&["--claude", CLAUDE]);
        if directory {
            fs::create_dir(f.0.join("shadow")).unwrap();
            f.write("shadow/preserve.txt", PRIVATE);
        } else {
            f.write("shadow", PRIVATE);
        }
        f.failure(
            &f.prepare_args(&["--claude", CLAUDE]),
            "reindex_target_exists",
        );
    }
}

#[test]
fn legacy_directory_and_descendants_cannot_be_shadow_targets() {
    let f = Fixture::new();
    f.write(CLAUDE, &claude("request_a", 20));
    f.collect(&["--claude", CLAUDE]);
    for target in ["legacy", "legacy/shadow"] {
        let mut args = f.prepare_args(&["--claude", CLAUDE]);
        let index = args
            .iter()
            .position(|argument| *argument == "--shadow-dir")
            .unwrap()
            + 1;
        args[index] = target;
        f.failure(&args, "reindex_target_invalid");
    }
}

#[test]
fn target_symlink_and_symlinked_legacy_parent_are_not_followed_into_old_state() {
    let f = Fixture::new();
    f.write(CLAUDE, &claude("request_a", 20));
    f.collect(&["--claude", CLAUDE]);
    std::os::unix::fs::symlink("legacy", f.0.join("old-alias")).unwrap();
    fs::create_dir(f.0.join("outside")).unwrap();
    std::os::unix::fs::symlink("outside", f.0.join("shadow-alias")).unwrap();
    for (target, code) in [
        ("old-alias", "reindex_target_invalid"),
        ("old-alias/shadow", "reindex_target_invalid"),
        ("shadow-alias", "reindex_target_exists"),
    ] {
        let mut args = f.prepare_args(&["--claude", CLAUDE]);
        let index = args
            .iter()
            .position(|argument| *argument == "--shadow-dir")
            .unwrap()
            + 1;
        args[index] = target;
        f.failure(&args, code);
    }
}

#[test]
fn mixed_provider_plan_has_exact_counts_and_bounded_redacted_output() {
    let f = Fixture::new();
    f.write(CLAUDE, &claude("request_a", 20));
    f.write(CODEX, &codex());
    let sources = ["--claude", CLAUDE, "--codex", CODEX];
    let imported = f.collect(&sources);
    assert_eq!(imported["tokens"], "185");
    let planned = f.plan(&sources);
    counts(&planned, 2, 0, 0, 0);
    assert_eq!(planned["sourcesRead"], 2);
    assert_eq!(planned["linesRead"], 3);
    counts(&f.prepare(&sources), 2, 0, 0, 0);
}

#[test]
fn shadow_rekeys_occurrences_but_preserves_metrics_and_legacy_checkpoint_ids() {
    let f = Fixture::new();
    f.write(CLAUDE, &claude("request_a", 20));
    f.write(CODEX, &codex());
    let sources = ["--claude", CLAUDE, "--codex", CODEX];
    f.collect(&sources);
    let old =
        ReadOnlyLedger::open(&f.0.join("legacy"), &LedgerIdentity::Legacy(&LEGACY_KEY)).unwrap();
    let prepared = f.prepare(&sources);
    let shadow = ReadOnlyLedger::open(
        &f.0.join("shadow"),
        &LedgerIdentity::SplitKeys {
            checkpoint: &LEGACY_KEY,
            occurrence: &ACCOUNT_KEY,
            namespace_version: 1,
        },
    )
    .unwrap();
    assert_eq!(prepared["shadowRevision"], shadow.snapshot().revision);
    assert_eq!(shadow.status().tokens, 185);
    assert_eq!(shadow.status().output_tokens, 25);
    assert_eq!(shadow.status().usage_occurrences, 2);
    assert_eq!(shadow.status().pending_records, 2);
    assert_eq!(old.snapshot().checkpoints, shadow.snapshot().checkpoints);
    assert_eq!(old.status().warnings, shadow.status().warnings);

    let old_ids: BTreeSet<_> = old.inventory().iter().map(|entry| entry.id).collect();
    let new_ids: BTreeSet<_> = shadow.inventory().iter().map(|entry| entry.id).collect();
    assert_eq!(old_ids.len(), 2);
    assert_eq!(new_ids.len(), 2);
    assert!(old_ids.is_disjoint(&new_ids));

    let registry = Registry {
        revision: 1,
        models: vec![],
    };
    let policy = Policy {
        first_day: 0,
        last_day: u32::MAX,
        registry: &registry,
    };
    let actual: BTreeMap<_, _> = shadow
        .inventory()
        .iter()
        .map(|entry| {
            let batch = decode(&entry.frame, &policy).unwrap();
            assert_eq!(batch.usage.len(), 1);
            let usage = batch.usage.into_iter().next().unwrap();
            assert_eq!(entry.id, usage.id);
            (usage.id, (batch.utc_day, usage))
        })
        .collect();
    let expected: BTreeMap<_, _> = [(Provider::ClaudeCode, CLAUDE), (Provider::Codex, CODEX)]
        .into_iter()
        .flat_map(|(provider, source)| {
            aicharts_core::parse_reader(
                Cursor::new(fs::read(f.0.join(source)).unwrap()),
                provider,
                &ACCOUNT_KEY,
            )
            .unwrap()
            .batches
            .into_iter()
            .flat_map(|batch| {
                batch
                    .usage
                    .into_iter()
                    .map(move |usage| (usage.id, (batch.utc_day, usage)))
            })
        })
        .collect();
    assert_eq!(
        actual, expected,
        "shadow uses native identities with the account key"
    );

    for identity in [
        LedgerIdentity::Legacy(&LEGACY_KEY),
        LedgerIdentity::SplitKeys {
            checkpoint: &ACCOUNT_KEY,
            occurrence: &ACCOUNT_KEY,
            namespace_version: 1,
        },
        LedgerIdentity::SplitKeys {
            checkpoint: &LEGACY_KEY,
            occurrence: &LEGACY_KEY,
            namespace_version: 1,
        },
        LedgerIdentity::SplitKeys {
            checkpoint: &LEGACY_KEY,
            occurrence: &ACCOUNT_KEY,
            namespace_version: 2,
        },
    ] {
        assert!(ReadOnlyLedger::open(&f.0.join("shadow"), &identity).is_err());
    }
    old.ensure_unchanged().unwrap();
    shadow.ensure_unchanged().unwrap();
    f.failure(&f.prepare_args(&sources), "reindex_target_exists");
}

#[test]
fn appended_new_usage_is_pending_in_shadow_and_old_pending_records_remain() {
    let f = Fixture::new();
    f.write(CLAUDE, &claude("request_a", 20));
    f.collect(&["--claude", CLAUDE]);
    f.append(CLAUDE, &claude("request_b", 30));
    f.prepare(&["--claude", CLAUDE]);
    let old =
        ReadOnlyLedger::open(&f.0.join("legacy"), &LedgerIdentity::Legacy(&LEGACY_KEY)).unwrap();
    let shadow = ReadOnlyLedger::open(
        &f.0.join("shadow"),
        &LedgerIdentity::SplitKeys {
            checkpoint: &LEGACY_KEY,
            occurrence: &ACCOUNT_KEY,
            namespace_version: 1,
        },
    )
    .unwrap();
    assert_eq!(old.status().tokens, 170);
    assert_eq!(old.status().usage_occurrences, 1);
    assert_eq!(old.status().pending_records, 1);
    assert_eq!(shadow.status().tokens, 350);
    assert_eq!(shadow.status().usage_occurrences, 2);
    assert_eq!(shadow.status().pending_records, 2);
}

#[test]
fn text_plan_reports_local_only_without_paths_frames_or_state_changes() {
    let f = Fixture::new();
    f.write(CLAUDE, &claude("request_a", 20));
    f.collect(&["--claude", CLAUDE]);
    let old =
        ReadOnlyLedger::open(&f.0.join("legacy"), &LedgerIdentity::Legacy(&LEGACY_KEY)).unwrap();
    let mut args = f.plan_args(&["--claude", CLAUDE]);
    args.retain(|argument| *argument != "--json");
    let before = tree(&f.0);
    let output = f.success(&args);
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("local only"));
    assert!(text.contains("Nothing promoted, acknowledged or uploaded."));
    for entry in old.inventory() {
        let frame: String = entry
            .frame
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        assert!(!text.contains(&frame));
    }
    assert_eq!(tree(&f.0), before);
}

#[test]
fn dry_run_and_explicit_sources_are_required_before_any_file_access() {
    let f = Fixture::new();
    f.failure(&["reindex-plan"], "reindex_plan_requires_dry_run");
    f.failure(&["reindex-plan", "--dry-run"], "explicit_source_required");
    f.failure(&["reindex-prepare", "--dry-run"], "invalid_option");
}
