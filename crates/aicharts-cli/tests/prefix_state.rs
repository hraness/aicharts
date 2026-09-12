//! Command-level prefix custody tests use only owned synthetic files.
#![cfg(unix)]

use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    os::unix::fs::{DirBuilderExt, PermissionsExt},
    path::PathBuf,
    process::{Command, Output},
};

use aicharts_ledger::{LedgerIdentity, ReadOnlyLedger, SourceCheckpoint};
use serde_json::Value;

const PRIVATE: &str = "PRIVATE_PREFIX_STATE_CANARY_71ac9";
const SOURCE: &str = "source.jsonl";

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut id = [0; 16];
        getrandom::fill(&mut id).unwrap();
        let suffix: String = id.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("aicharts-prefix-state-test-{suffix}"));
        fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
        let fixture = Self(path);
        fixture.success(&["keygen", "--output", "private.key"]);
        fixture.success(&["init", "--state-dir", "state", "--key-file", "private.key"]);
        fixture
    }
    fn run(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_aicharts"))
            .current_dir(&self.0)
            .args(args)
            .output()
            .unwrap()
    }
    fn success(&self, args: &[&str]) -> Output {
        let output = self.run(args);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(output.stderr.is_empty());
        assert!(!String::from_utf8_lossy(&output.stdout).contains(PRIVATE));
        output
    }
    fn fail(&self, args: &[&str], code: &str) {
        let output = self.run(args);
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert_eq!(
            String::from_utf8(output.stderr).unwrap(),
            format!("aicharts: {code}\n")
        );
    }
    fn json(&self, args: &[&str]) -> Value {
        serde_json::from_slice(&self.success(args).stdout).unwrap()
    }
    fn enable(&self, revision: u64) {
        self.success(&[
            "prefix-enable",
            "--state-dir",
            "state",
            "--key-file",
            "private.key",
            "--revision",
            &revision.to_string(),
        ]);
    }
    fn collect(&self, command: &str, extra: &[&str]) -> Value {
        let mut args = vec![
            command,
            "--state-dir",
            "state",
            "--key-file",
            "private.key",
            "--claude",
            SOURCE,
            "--json",
        ];
        args.extend_from_slice(extra);
        self.json(&args)
    }
    fn status(&self) -> Value {
        self.json(&[
            "status",
            "--state-dir",
            "state",
            "--key-file",
            "private.key",
            "--json",
        ])
    }
    fn outbox(&self) -> Value {
        self.json(&[
            "outbox",
            "--dry-run",
            "--state-dir",
            "state",
            "--key-file",
            "private.key",
        ])
    }
    fn dry_run(&self) -> Value {
        self.json(&[
            "upload",
            "--dry-run",
            "--key-file",
            "private.key",
            "--claude",
            SOURCE,
        ])
    }
    fn write(&self, bytes: impl AsRef<[u8]>) {
        fs::write(self.0.join(SOURCE), bytes).unwrap();
    }
    fn append(&self, bytes: &[u8]) {
        fs::OpenOptions::new()
            .append(true)
            .open(self.0.join(SOURCE))
            .unwrap()
            .write_all(bytes)
            .unwrap();
    }
    fn state_bytes(&self) -> BTreeMap<String, Vec<u8>> {
        fs::read_dir(self.0.join("state"))
            .unwrap()
            .map(|entry| {
                let entry = entry.unwrap();
                assert!(entry.file_type().unwrap().is_file());
                (
                    entry.file_name().into_string().unwrap(),
                    fs::read(entry.path()).unwrap(),
                )
            })
            .collect()
    }
    fn checkpoints(&self) -> BTreeMap<[u8; 32], SourceCheckpoint> {
        let key: [u8; 32] = fs::read(self.0.join("private.key"))
            .unwrap()
            .try_into()
            .unwrap();
        ReadOnlyLedger::open(&self.0.join("state"), &LedgerIdentity::Legacy(&key))
            .unwrap()
            .prefix_snapshot()
            .checkpoints
            .clone()
    }
    fn checkpoint(&self) -> SourceCheckpoint {
        let checkpoints = self.checkpoints();
        assert_eq!(checkpoints.len(), 1);
        *checkpoints.values().next().unwrap()
    }
    fn fail_collect(&self, command: &str, code: &str) {
        self.fail(
            &[
                command,
                "--state-dir",
                "state",
                "--key-file",
                "private.key",
                "--claude",
                SOURCE,
            ],
            code,
        );
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // This exact randomly-created directory contains only this fixture's synthetic state.
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn source(request: &str, output: u64) -> Vec<u8> {
    (serde_json::json!({"type":"assistant","requestId":request,"sessionId":"session_a","timestamp":"2026-09-10T10:00:00Z",
        "cwd":PRIVATE,"message":{"id":"message_a","content":[{"type":"text","text":PRIVATE}],
            "usage":{"input_tokens":100,"output_tokens":output,"cache_read_input_tokens":50,"cache_creation_input_tokens":0}}}).to_string()+"\n").into_bytes()
}

#[test]
fn migration_is_explicit_revision_guarded_private_and_does_not_visit_sources() {
    let f = Fixture::new();
    f.write(source("request_a", 20));
    f.collect("collect", &[]);
    let before = f.state_bytes();
    let status = f.status();
    let outbox = f.outbox();
    let checkpoint = f.checkpoint();
    f.fail(
        &[
            "prefix-enable",
            "--state-dir",
            "state",
            "--key-file",
            "private.key",
        ],
        "migration_revision_required",
    );
    f.fail(
        &[
            "prefix-enable",
            "--state-dir",
            "state",
            "--key-file",
            "private.key",
            "--revision",
            "0",
        ],
        "ledger_changed_retry",
    );
    f.success(&["keygen", "--output", "wrong.key"]);
    f.fail(
        &[
            "prefix-enable",
            "--state-dir",
            "state",
            "--key-file",
            "wrong.key",
            "--revision",
            "1",
        ],
        "ledger_namespace_mismatch",
    );
    assert_eq!(f.state_bytes(), before);
    fs::rename(f.0.join(SOURCE), f.0.join("unavailable.jsonl")).unwrap();
    f.enable(1);
    assert_eq!(f.status(), status);
    assert_eq!(f.outbox(), outbox);
    assert_eq!(f.checkpoint(), checkpoint);
    assert!(f.checkpoint().prefix.is_none());
    let enabled = f.state_bytes();
    f.enable(0); // Existing-only exact migration readback does not require a fresh revision.
    assert_eq!(f.state_bytes(), enabled);
    for entry in fs::read_dir(f.0.join("state")).unwrap() {
        assert_eq!(
            entry.unwrap().metadata().unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

#[test]
fn command_mode_and_option_guards_run_before_source_reads_without_changing_legacy_json() {
    let f = Fixture::new();
    let missing = "nonexistent_PRIVATE_PREFIX_STATE_CANARY_71ac9";
    let before = f.state_bytes();
    f.fail(
        &[
            "collect-prefix",
            "--state-dir",
            "state",
            "--key-file",
            "private.key",
            "--claude",
            missing,
        ],
        "ledger_prefix_not_enabled",
    );
    assert_eq!(f.state_bytes(), before);
    for args in [
        vec!["prefix-enable", "--revision", "0", "--codex", missing],
        vec!["prefix-enable", "--revision", "0", "--json"],
        vec!["prefix-enable", "--revision", "0", "--revision", "1"],
        vec!["collect-prefix", "--revision", "0"],
        vec!["collect-prefix", "--send"],
        vec!["status", "--rescan"],
    ] {
        f.fail(&args, "invalid_option");
    }
    f.write(source("request_a", 20));
    let legacy = f.collect("collect", &[]);
    assert_eq!(legacy["scanMode"], "full_changed_source_snapshot");
    assert!(legacy.get("sourcesWithDeferredTail").is_none());
    f.append(b"{");
    f.fail_collect("collect", "source_partial_tail");
    f.enable(1);
    let before = f.state_bytes();
    f.fail(
        &[
            "collect",
            "--state-dir",
            "state",
            "--key-file",
            "private.key",
            "--claude",
            missing,
        ],
        "ledger_complete_prefix_required",
    );
    assert_eq!(f.state_bytes(), before);
}

#[test]
fn migrated_same_stamp_source_is_replayed_once_before_metadata_skip() {
    let f = Fixture::new();
    let bytes = source("request_a", 20);
    f.write(&bytes);
    f.collect("collect", &[]);
    let previous = f.checkpoint();
    let entries = f.outbox()["entries"].clone();
    f.enable(1);
    let baseline = f.collect("collect-prefix", &[]);
    assert_eq!(baseline["ledgerRevision"], 2);
    assert_eq!(baseline["sourcesUpdated"], 1);
    assert_eq!(baseline["occurrencesChanged"], 0);
    assert_eq!(baseline["sourcesSkipped"], 0);
    assert_eq!(baseline["linesRead"], 1);
    assert_eq!(baseline["bytesScanned"], bytes.len());
    assert_eq!(f.checkpoint().stamp, previous.stamp);
    assert_eq!(f.checkpoint().prefix.unwrap().bytes, bytes.len() as u64);
    assert_eq!(f.outbox()["entries"], entries);
    let before = f.state_bytes();
    let idle = f.collect("collect-prefix", &[]);
    assert_eq!(idle["ledgerRevision"], 2);
    assert_eq!(idle["sourcesSkipped"], 1);
    assert_eq!(idle["sourcesUpdated"], 0);
    assert_eq!(idle["linesRead"], 0);
    assert_eq!(idle["bytesScanned"], 0);
    assert_eq!(f.state_bytes(), before);
    let replay = f.collect("collect-prefix", &["--rescan"]);
    assert_eq!(replay["linesRead"], 1);
    assert_eq!(replay["sourcesSkipped"], 0);
    assert_eq!(replay["sourcesUpdated"], 0);
    assert_eq!(replay["occurrencesChanged"], 0);
    assert_eq!(f.state_bytes(), before);
}

#[test]
fn partial_json_utf8_and_valid_unterminated_records_are_deferred_without_storing_tail() {
    let next = source("request_b", 30);
    for tail in [
        b"{".as_slice(),
        b"\xff\xf0\x9f",
        br#"{"text":"unfinished\"#,
        &next[..next.len() - 1],
    ] {
        let f = Fixture::new();
        f.enable(0);
        let prefix = source("request_a", 20);
        let mut bytes = prefix.clone();
        bytes.extend_from_slice(tail);
        f.write(&bytes);
        let result = f.collect("collect-prefix", &[]);
        assert_eq!(result["tokens"], "170");
        assert_eq!(result["usageOccurrences"], 1);
        assert_eq!(result["linesRead"], 1);
        assert_eq!(result["sourcesWithDeferredTail"], 1);
        assert_eq!(f.checkpoint().prefix.unwrap().bytes, prefix.len() as u64);
        assert_eq!(f.checkpoint().stamp.bytes, bytes.len() as u64);
        let before = f.state_bytes();
        let idle = f.collect("collect-prefix", &[]);
        assert_eq!(idle["sourcesSkipped"], 1);
        assert_eq!(idle["sourcesWithDeferredTail"], 1);
        assert_eq!(f.state_bytes(), before);
        let replay = f.collect("collect-prefix", &["--rescan"]);
        assert_eq!(replay["linesRead"], 1);
        assert_eq!(replay["ledgerRevision"], result["ledgerRevision"]);
        assert_eq!(f.state_bytes(), before);
    }
}

#[test]
fn no_newline_never_registers_source_or_fabricates_first_baseline() {
    for legacy_empty in [false, true] {
        let f = Fixture::new();
        f.write([]);
        if legacy_empty {
            f.collect("collect", &[]);
        }
        let revision = if legacy_empty { 1 } else { 0 };
        f.enable(revision);
        let before = f.state_bytes();
        for bytes in [
            vec![],
            b"not JSON yet".to_vec(),
            source("request_a", 20)[..source("request_a", 20).len() - 1].to_vec(),
        ] {
            f.write(bytes);
            let result = f.collect("collect-prefix", &[]);
            assert_eq!(result["ledgerRevision"], revision);
            assert_eq!(result["sources"], if legacy_empty { 1 } else { 0 });
            assert_eq!(result["usageOccurrences"], 0);
            assert_eq!(result["linesRead"], 0);
            assert_eq!(result["sourcesUpdated"], 0);
            assert_eq!(result["sourcesSkipped"], 0);
            assert!(f
                .checkpoints()
                .values()
                .all(|source| source.prefix.is_none()));
            assert_eq!(f.state_bytes(), before);
        }
        f.append(b"\n");
        let complete = f.collect("collect-prefix", &[]);
        assert_eq!(complete["ledgerRevision"], revision + 1);
        assert_eq!(complete["usageOccurrences"], 1);
        assert_eq!(complete["tokens"], "170");
    }
}

#[test]
fn nonempty_legacy_baseline_rewritten_without_lf_rejects_all_source_changes() {
    for growth in [0, 31] {
        let f = Fixture::new();
        let original = source("request_a", 20);
        f.write(&original);
        f.collect("collect", &[]);
        f.enable(1);
        let before = f.state_bytes();
        let checkpoint = f.checkpoint();
        // Same inode and non-shrinking physical size cannot excuse loss of every
        // completed line from a previously measured, not-yet-witnessed source.
        f.write(vec![b'x'; original.len() + growth]);
        fs::write(f.0.join("new.jsonl"), source("request_b", 30)).unwrap();
        f.fail(
            &[
                "collect-prefix",
                "--state-dir",
                "state",
                "--key-file",
                "private.key",
                "--claude",
                "new.jsonl",
                "--claude",
                SOURCE,
            ],
            "source_partial_tail",
        );
        assert_eq!(f.state_bytes(), before);
        assert_eq!(f.checkpoint(), checkpoint);
        assert!(f.checkpoint().prefix.is_none());
        assert_eq!(f.status()["usageOccurrences"], 1);
        assert_eq!(f.status()["tokens"], "170");
    }
}

#[test]
fn unfinished_append_never_advances_stamp_and_tail_completion_counts_once() {
    let f = Fixture::new();
    f.enable(0);
    f.write(source("request_a", 20));
    f.collect("collect-prefix", &[]);
    let checkpoint = f.checkpoint();
    let before = f.state_bytes();
    let second = source("request_b", 30);
    let split = second.len() / 2;
    f.append(&second[..split]);
    for _ in 0..2 {
        let partial = f.collect("collect-prefix", &[]);
        assert_eq!(partial["ledgerRevision"], 1);
        assert_eq!(partial["sourcesSkipped"], 0);
        assert_eq!(partial["linesRead"], 1);
        assert_eq!(partial["sourcesWithDeferredTail"], 1);
        assert_eq!(f.checkpoint(), checkpoint);
        assert_eq!(f.state_bytes(), before);
    }
    f.append(&second[split..]);
    let complete = f.collect("collect-prefix", &[]);
    assert_eq!(complete["tokens"], "350");
    assert_eq!(complete["usageOccurrences"], 2);
    assert_eq!(complete["occurrencesChanged"], 1);
    assert_eq!(complete["linesRead"], 2);
    assert_eq!(complete["ledgerRevision"], 2);
    assert_eq!(complete["sourcesWithDeferredTail"], 0);
    let before = f.state_bytes();
    let repeat = f.collect("collect-prefix", &["--rescan"]);
    assert_eq!(repeat["tokens"], "350");
    assert_eq!(repeat["occurrencesChanged"], 0);
    assert_eq!(f.state_bytes(), before);
}

#[test]
fn crlf_and_split_carriage_return_preserve_exact_lf_boundary() {
    let f = Fixture::new();
    f.enable(0);
    let line = source("request_a", 20);
    let mut bytes = line[..line.len() - 1].to_vec();
    bytes.push(b'\r');
    f.write(&bytes);
    let partial = f.collect("collect-prefix", &[]);
    assert_eq!(partial["sources"], 0);
    f.append(b"\n");
    let first = f.collect("collect-prefix", &[]);
    assert_eq!(first["tokens"], "170");
    assert_eq!(first["linesRead"], 1);
    assert_eq!(f.checkpoint().prefix.unwrap().bytes, line.len() as u64 + 1);
    f.append(b"\r\n");
    let second = f.collect("collect-prefix", &[]);
    assert_eq!(second["tokens"], "170");
    assert_eq!(second["linesRead"], 2);
    assert_eq!(second["occurrencesChanged"], 0);
    assert_eq!(second["sourcesUpdated"], 1);
}

#[test]
fn ignored_content_rewrite_and_reordered_equal_numeric_history_fail_prefix_verification() {
    for reorder in [false, true] {
        let f = Fixture::new();
        f.enable(0);
        let first = source("request_a", 20);
        let second = source("request_b", 30);
        let original = [first.clone(), second.clone()].concat();
        f.write(&original);
        f.collect("collect-prefix", &[]);
        let numeric = f.dry_run();
        let before = f.state_bytes();
        let changed = if reorder {
            [second, first].concat()
        } else {
            String::from_utf8(original.clone())
                .unwrap()
                .replace(PRIVATE, "PRIVATE_PREFIX_STATE_CANARY_71ad0")
                .into_bytes()
        };
        assert_eq!(changed.len(), original.len());
        f.write(changed);
        assert_eq!(f.dry_run(), numeric);
        f.fail_collect("collect-prefix", "source_history_changed");
        assert_eq!(f.state_bytes(), before);
        f.fail(
            &[
                "collect-prefix",
                "--state-dir",
                "state",
                "--key-file",
                "private.key",
                "--claude",
                SOURCE,
                "--rescan",
            ],
            "source_history_changed",
        );
        assert_eq!(f.state_bytes(), before);
    }
}

#[test]
fn witnessed_suffix_can_shrink_but_rotation_and_committed_truncation_keep_all_state() {
    let f = Fixture::new();
    f.enable(0);
    let complete = [source("request_a", 20), source("request_b", 30)].concat();
    let mut observed = complete.clone();
    observed.extend_from_slice(b"{ unfinished tail");
    f.write(observed);
    f.collect("collect-prefix", &[]);
    let before = f.state_bytes();
    let old = f.checkpoint();
    fs::OpenOptions::new()
        .write(true)
        .open(f.0.join(SOURCE))
        .unwrap()
        .set_len(complete.len() as u64)
        .unwrap();
    let shrunk = f.collect("collect-prefix", &[]);
    assert_eq!(shrunk["tokens"], "350");
    assert_eq!(shrunk["sourcesUpdated"], 0);
    assert_eq!(shrunk["sourcesWithDeferredTail"], 0);
    assert_eq!(f.checkpoint(), old);
    assert_eq!(f.state_bytes(), before);
    f.write(source("request_a", 20));
    f.fail_collect("collect-prefix", "ledger_source_history_changed");
    assert_eq!(f.state_bytes(), before);
    f.write(&complete);
    fs::rename(f.0.join(SOURCE), f.0.join("old.jsonl")).unwrap();
    f.write(&complete);
    f.fail_collect("collect-prefix", "ledger_source_history_changed");
    assert_eq!(f.state_bytes(), before);
}

#[test]
fn legacy_baseline_never_forgives_prior_physical_shrink_or_missing_occurrence() {
    for lose_history in [false, true] {
        let f = Fixture::new();
        let original = [source("request_a", 20), source("request_b", 30)].concat();
        f.write(&original);
        f.collect("collect", &[]);
        f.enable(1);
        let before = f.state_bytes();
        if lose_history {
            let mut replacement = source("request_a", 20);
            replacement.extend(std::iter::repeat_n(b' ', original.len()));
            replacement.push(b'\n');
            f.write(replacement);
        } else {
            f.write(source("request_a", 20));
        }
        f.fail_collect("collect-prefix", "ledger_source_history_changed");
        assert_eq!(f.state_bytes(), before);
        assert!(f.checkpoint().prefix.is_none());
    }
}

#[test]
fn malformed_completed_line_aborts_all_selected_sources_and_keeps_previous_witness() {
    let f = Fixture::new();
    f.enable(0);
    f.write(source("request_a", 20));
    f.collect("collect-prefix", &[]);
    let before = f.state_bytes();
    f.append(format!("{{\"{PRIVATE}\":\n").as_bytes());
    fs::write(f.0.join("new.jsonl"), source("request_b", 30)).unwrap();
    f.fail(
        &[
            "collect-prefix",
            "--state-dir",
            "state",
            "--key-file",
            "private.key",
            "--claude",
            "new.jsonl",
            "--claude",
            SOURCE,
        ],
        "source_parse_failed",
    );
    assert_eq!(f.state_bytes(), before);
    assert_eq!(f.status()["usageOccurrences"], 1);
}

#[test]
fn prefix_migration_and_baseline_leave_wire_identical_and_witnesses_out_of_outputs() {
    let f = Fixture::new();
    f.write(source("request_a", 20));
    f.collect("collect", &[]);
    let before_entries = f.outbox()["entries"].clone();
    let dry = f.dry_run();
    f.enable(1);
    f.collect("collect-prefix", &[]);
    assert_eq!(f.outbox()["entries"], before_entries);
    assert_eq!(f.dry_run(), dry);
    let checkpoint = f.checkpoint();
    let mac = checkpoint.prefix.unwrap().mac;
    let hex: String = mac.iter().map(|byte| format!("{byte:02x}")).collect();
    let key = fs::read(f.0.join("private.key")).unwrap();
    let path = f.0.join(SOURCE).to_string_lossy().into_owned();
    for output in [
        f.status(),
        f.outbox(),
        f.collect("collect-prefix", &["--rescan"]),
    ] {
        let text = output.to_string();
        for forbidden in [
            PRIVATE,
            &path,
            &hex,
            "prefix_mac",
            "source_id",
            "checkpointKey",
        ] {
            assert!(!text.contains(forbidden));
        }
        assert_eq!(output["uploaded"], false);
    }
    for bytes in f.state_bytes().values() {
        for forbidden in [
            PRIVATE.as_bytes(),
            path.as_bytes(),
            SOURCE.as_bytes(),
            key.as_slice(),
        ] {
            assert!(!bytes
                .windows(forbidden.len())
                .any(|window| window == forbidden));
        }
    }
    for entry in before_entries.as_array().unwrap() {
        assert_eq!(entry["bytes"], 136);
        let hex = entry["hex"].as_str().unwrap();
        assert_eq!(hex.len(), 272);
        assert!(hex.starts_with("41494355"));
    }
}

#[test]
fn reindex_stays_strict_and_old_prefix_state_remains_read_only() {
    let f = Fixture::new();
    f.enable(0);
    let prefix = source("request_a", 20);
    let mut bytes = prefix.clone();
    bytes.extend_from_slice(b"{");
    f.write(bytes);
    f.collect("collect-prefix", &[]);
    let before = f.state_bytes();
    f.fail(
        &[
            "reindex-plan",
            "--dry-run",
            "--state-dir",
            "state",
            "--key-file",
            "private.key",
            "--claude",
            SOURCE,
        ],
        "source_partial_tail",
    );
    assert_eq!(f.state_bytes(), before);
    f.success(&["keygen", "--output", "occurrence.key"]);
    f.fail(
        &[
            "reindex-prepare",
            "--state-dir",
            "state",
            "--key-file",
            "private.key",
            "--shadow-dir",
            "shadow",
            "--occurrence-key-file",
            "occurrence.key",
            "--claude",
            SOURCE,
        ],
        "source_partial_tail",
    );
    assert!(!f.0.join("shadow").exists());
    assert_eq!(f.state_bytes(), before);
    f.write(prefix);
    let plan = f.json(&[
        "reindex-plan",
        "--dry-run",
        "--json",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--claude",
        SOURCE,
    ]);
    assert_eq!(plan["readyToPrepare"], true);
    assert_eq!(plan["matchedOccurrences"], 1);
    assert_eq!(plan["promoted"], false);
    assert_eq!(f.state_bytes(), before);
}

#[test]
fn copied_sources_deduplicate_and_omitted_or_missing_sources_never_remove_history() {
    let f = Fixture::new();
    f.enable(0);
    f.write(source("request_a", 20));
    f.collect("collect-prefix", &[]);
    fs::copy(f.0.join(SOURCE), f.0.join("copy.jsonl")).unwrap();
    let copy = f.json(&[
        "collect-prefix",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--claude",
        "copy.jsonl",
        "--json",
    ]);
    assert_eq!(copy["sources"], 2);
    assert_eq!(copy["usageOccurrences"], 1);
    assert_eq!(copy["tokens"], "170");
    let witnesses: Vec<_> = f
        .checkpoints()
        .values()
        .map(|c| c.prefix.unwrap().mac)
        .collect();
    assert_ne!(witnesses[0], witnesses[1]);
    fs::remove_file(f.0.join(SOURCE)).unwrap();
    let before = f.state_bytes();
    f.fail_collect("collect-prefix", "source_metadata_failed");
    assert_eq!(f.state_bytes(), before);
    let idle = f.json(&[
        "collect-prefix",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--claude",
        "copy.jsonl",
        "--json",
    ]);
    assert_eq!(idle["sources"], 2);
    assert_eq!(idle["sourcesSkipped"], 1);
    assert_eq!(f.state_bytes(), before);
}

#[test]
fn codex_tail_completion_replays_cumulative_chain_and_late_fork_cannot_delete_history() {
    let f = Fixture::new();
    f.enable(0);
    f.write(concat!(
        "{\"type\":\"session_meta\",\"payload\":{\"id\":\"session_a\"}}\n",
        "{\"type\":\"event_msg\",\"timestamp\":\"2026-09-10T10:00:00Z\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":10,\"output_tokens\":5},\"last_token_usage\":{\"input_tokens\":10,\"output_tokens\":5}}}}\n"
    ));
    let args = [
        "collect-prefix",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--codex",
        SOURCE,
        "--json",
    ];
    let first = f.json(&args);
    assert_eq!(first["tokens"], "15");
    assert_eq!(first["usageOccurrences"], 1);
    let next = b"{\"type\":\"event_msg\",\"timestamp\":\"2026-09-10T10:00:01Z\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":30,\"output_tokens\":15},\"last_token_usage\":{\"input_tokens\":20,\"output_tokens\":10}}}}\n";
    f.append(&next[..next.len() - 1]);
    let before = f.state_bytes();
    let partial = f.json(&args);
    assert_eq!(partial["tokens"], "15");
    assert_eq!(partial["linesRead"], 2);
    assert_eq!(f.state_bytes(), before);
    f.append(b"\n");
    let complete = f.json(&args);
    assert_eq!(complete["tokens"], "45");
    assert_eq!(complete["usageOccurrences"], 2);
    assert_eq!(complete["linesRead"], 3);
    let before = f.state_bytes();
    f.append(b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"session_a\",\"forked_from_id\":\"parent_a\"}}\n");
    f.fail(&args, "ledger_source_history_changed");
    assert_eq!(f.state_bytes(), before);
    assert_eq!(f.status()["tokens"], "45");
}
