//! Persistent collection tests use synthetic data in private, disposable directories.
#![cfg(unix)]

use std::{
    fs,
    io::Write,
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    process::{Command, Output},
};

const PRIVATE: &str = "PRIVATE_LEDGER_SOURCE_CANARY_923c8";

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut id = [0u8; 16];
        getrandom::fill(&mut id).unwrap();
        let suffix: String = id.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = std::env::temp_dir().join(format!("aicharts-state-test-{suffix}"));
        fs::create_dir(&path).unwrap();
        let fixture = Self(path);
        assert!(fixture
            .run(&["keygen", "--output", "private.key"])
            .status
            .success());
        fixture
    }
    fn run(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_aicharts"))
            .current_dir(&self.0)
            .args(args)
            .output()
            .unwrap()
    }
    fn init(&self) {
        self.success(&["init", "--state-dir", "state", "--key-file", "private.key"]);
    }
    fn success(&self, args: &[&str]) -> Output {
        let result = self.run(args);
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(result.stderr.is_empty());
        assert!(!String::from_utf8_lossy(&result.stdout).contains(PRIVATE));
        result
    }
    fn collect(&self) -> serde_json::Value {
        self.json(&[
            "collect",
            "--state-dir",
            "state",
            "--key-file",
            "private.key",
            "--claude",
            "source.jsonl",
            "--json",
        ])
    }
    fn status(&self) -> serde_json::Value {
        self.json(&[
            "status",
            "--state-dir",
            "state",
            "--key-file",
            "private.key",
            "--json",
        ])
    }
    fn json(&self, args: &[&str]) -> serde_json::Value {
        serde_json::from_slice(&self.success(args).stdout).unwrap()
    }
    fn append(&self, text: &str) {
        fs::OpenOptions::new()
            .append(true)
            .open(self.0.join("source.jsonl"))
            .unwrap()
            .write_all(text.as_bytes())
            .unwrap();
    }
    fn failed(&self, args: &[&str]) -> String {
        let result = self.run(args);
        assert_eq!(result.status.code(), Some(2));
        assert!(result.stdout.is_empty());
        assert!(!String::from_utf8_lossy(&result.stderr).contains(PRIVATE));
        String::from_utf8(result.stderr).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // The fixture owns only this exact, randomly created temporary directory.
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn source(request: &str, output: u64) -> String {
    serde_json::json!({"type":"assistant","requestId":request,"sessionId":"session_a","timestamp":"2026-09-10T10:00:00Z",
        "cwd":PRIVATE,"message":{"id":"message_a","content":[{"type":"text","text":PRIVATE}],
            "usage":{"input_tokens":100,"output_tokens":output,"cache_read_input_tokens":50,"cache_creation_input_tokens":0}}}).to_string()+"\n"
}

#[test]
fn initialization_is_explicit_private_and_never_overwrites_state() {
    let f = Fixture::new();
    fs::write(f.0.join("source.jsonl"), source("request_a", 20)).unwrap();
    f.failed(&[
        "collect",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--claude",
        "source.jsonl",
    ]);
    assert!(!f.0.join("state").exists());
    f.init();
    assert_eq!(
        fs::metadata(f.0.join("state"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    let status = f.status();
    f.failed(&["init", "--state-dir", "state", "--key-file", "private.key"]);
    assert_eq!(f.status(), status);
    for entry in fs::read_dir(f.0.join("state")).unwrap() {
        let metadata = entry.unwrap().metadata().unwrap();
        if metadata.is_file() {
            assert_eq!(metadata.permissions().mode() & 0o077, 0);
        }
    }
}

#[test]
fn key_binding_and_private_key_permissions_are_checked_before_sources() {
    let f = Fixture::new();
    f.init();
    let before = f.status();
    f.success(&["keygen", "--output", "wrong.key"]);
    let wrong = f.failed(&[
        "collect",
        "--state-dir",
        "state",
        "--key-file",
        "wrong.key",
        "--claude",
        "nonexistent_PRIVATE_LEDGER_SOURCE_CANARY_923c8",
    ]);
    assert!(!wrong.contains("source_"), "{wrong}");
    assert_eq!(f.status(), before);
    fs::set_permissions(f.0.join("wrong.key"), fs::Permissions::from_mode(0o644)).unwrap();
    let permissions = f.failed(&["status", "--state-dir", "state", "--key-file", "wrong.key"]);
    assert_eq!(permissions, "aicharts: key_permissions_must_be_private\n");
}

#[test]
fn unchanged_sources_skip_parsing_and_append_rereads_the_complete_snapshot() {
    let f = Fixture::new();
    f.init();
    fs::write(f.0.join("source.jsonl"), source("request_a", 20)).unwrap();
    let first = f.collect();
    assert_eq!(first["tokens"], "170");
    assert_eq!(first["linesRead"], 1);
    assert_eq!(first["sourcesUpdated"], 1);
    let unchanged = f.collect();
    assert_eq!(unchanged["ledgerRevision"], first["ledgerRevision"]);
    assert_eq!(unchanged["linesRead"], 0);
    assert_eq!(unchanged["sourcesSkipped"], 1);
    assert_eq!(unchanged["sourcesUpdated"], 0);
    f.append(&source("request_b", 30));
    let appended = f.collect();
    assert_eq!(appended["tokens"], "350");
    assert_eq!(appended["linesRead"], 2);
    assert_eq!(appended["usageOccurrences"], 2);
    assert_eq!(appended["scanMode"], "full_changed_source_snapshot");
    let rescanned = f.json(&[
        "collect",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--claude",
        "source.jsonl",
        "--rescan",
        "--json",
    ]);
    assert_eq!(rescanned["linesRead"], 2);
    assert_eq!(rescanned["occurrencesChanged"], 0);
    assert_eq!(rescanned["ledgerRevision"], appended["ledgerRevision"]);
}

#[test]
fn streaming_revisions_replace_pending_usage_without_an_extra_occurrence() {
    let f = Fixture::new();
    f.init();
    fs::write(f.0.join("source.jsonl"), source("request_a", 20)).unwrap();
    let first = f.collect();
    f.append(&source("request_a", 30));
    let revised = f.collect();
    assert_eq!(revised["tokens"], "180");
    assert_eq!(revised["usageOccurrences"], 1);
    assert_eq!(revised["pendingRecords"], 1);
    assert_eq!(revised["occurrencesChanged"], 1);
    assert!(
        revised["ledgerRevision"].as_u64().unwrap() > first["ledgerRevision"].as_u64().unwrap()
    );
}

#[test]
fn codex_append_recomputes_deltas_without_recounting_the_initial_request() {
    let f = Fixture::new();
    f.init();
    let first = r#"{"type":"session_meta","payload":{"id":"codex_session"}}
{"type":"event_msg","timestamp":"2026-09-10T10:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"output_tokens":5},"last_token_usage":{"input_tokens":10,"output_tokens":5}}}}
"#;
    let second = r#"{"type":"event_msg","timestamp":"2026-09-10T10:00:01Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":30,"output_tokens":15},"last_token_usage":{"input_tokens":20,"output_tokens":10}}}}
"#;
    fs::write(f.0.join("source.jsonl"), first).unwrap();
    let args = [
        "collect",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--codex",
        "source.jsonl",
        "--json",
    ];
    let initial = f.json(&args);
    assert_eq!(initial["tokens"], "15");
    f.append(second);
    let appended = f.json(&args);
    assert_eq!(appended["tokens"], "45");
    assert_eq!(appended["usageOccurrences"], 2);
    assert_eq!(appended["linesRead"], 3);
}

#[test]
fn partial_tail_and_malformed_multisource_import_leave_all_state_unchanged() {
    let f = Fixture::new();
    f.init();
    fs::write(f.0.join("source.jsonl"), source("request_a", 20)).unwrap();
    f.collect();
    let before = f.status();
    f.append("{\"type\":\"assistant\"");
    let partial = f.failed(&[
        "collect",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--claude",
        "source.jsonl",
    ]);
    assert_eq!(partial, "aicharts: source_partial_tail\n");
    assert_eq!(f.status(), before);
    fs::write(f.0.join("new.jsonl"), source("request_b", 30)).unwrap();
    fs::write(f.0.join("bad.jsonl"), format!("{{\"{PRIVATE}\":\n")).unwrap();
    let malformed = f.failed(&[
        "collect",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--claude",
        "new.jsonl",
        "--claude",
        "bad.jsonl",
    ]);
    assert_eq!(malformed, "aicharts: source_parse_failed\n");
    assert_eq!(f.status(), before);
}

#[test]
fn restart_and_copied_sources_deduplicate_while_source_disappearance_retains_history() {
    let f = Fixture::new();
    f.init();
    fs::write(f.0.join("source.jsonl"), source("request_a", 20)).unwrap();
    f.collect();
    fs::copy(f.0.join("source.jsonl"), f.0.join("copy.jsonl")).unwrap();
    let duplicate = f.json(&[
        "collect",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--claude",
        "copy.jsonl",
        "--json",
    ]);
    assert_eq!(duplicate["sources"], 2);
    assert_eq!(duplicate["usageOccurrences"], 1);
    assert_eq!(duplicate["tokens"], "170");
    fs::remove_file(f.0.join("source.jsonl")).unwrap();
    let before = f.status();
    f.failed(&[
        "collect",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--claude",
        "source.jsonl",
    ]);
    assert_eq!(f.status(), before);
    let unchanged = f.json(&[
        "collect",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--claude",
        "copy.jsonl",
        "--json",
    ]);
    assert_eq!(unchanged["tokens"], "170");
    assert_eq!(unchanged["sources"], 2);
}

#[test]
fn source_rotation_and_truncation_do_not_reset_prior_usage() {
    for rotate in [false, true] {
        let f = Fixture::new();
        f.init();
        fs::write(
            f.0.join("source.jsonl"),
            source("request_a", 20) + &source("request_b", 30),
        )
        .unwrap();
        f.collect();
        let before = f.status();
        if rotate {
            fs::rename(f.0.join("source.jsonl"), f.0.join("old.jsonl")).unwrap();
            fs::write(
                f.0.join("source.jsonl"),
                source("request_a", 20) + &source("request_b", 30),
            )
            .unwrap();
        } else {
            fs::write(f.0.join("source.jsonl"), source("request_a", 20)).unwrap();
        }
        f.failed(&[
            "collect",
            "--state-dir",
            "state",
            "--key-file",
            "private.key",
            "--claude",
            "source.jsonl",
        ]);
        assert_eq!(f.status(), before);
    }
}

#[test]
fn rewritten_history_cannot_disappear_even_when_the_file_grows() {
    let f = Fixture::new();
    f.init();
    fs::write(f.0.join("source.jsonl"), source("request_a", 20)).unwrap();
    f.collect();
    let before = f.status();
    fs::write(
        f.0.join("source.jsonl"),
        source("request_b", 30) + &source("request_c", 40),
    )
    .unwrap();
    f.failed(&[
        "collect",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--claude",
        "source.jsonl",
    ]);
    assert_eq!(f.status(), before);
}

#[test]
fn outbox_preview_is_read_only_revision_pinned_and_has_no_source_content() {
    let f = Fixture::new();
    f.init();
    fs::write(
        f.0.join("source.jsonl"),
        source("request_a", 20) + &source("request_b", 30) + &source("request_c", 40),
    )
    .unwrap();
    f.collect();
    let before = f.status();
    let first = f.json(&[
        "outbox",
        "--dry-run",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--limit",
        "1",
    ]);
    assert_eq!(first["entries"].as_array().unwrap().len(), 1);
    assert_eq!(first["uploaded"], false);
    assert_eq!(first["acknowledged"], false);
    let cursor = first["nextAfter"].as_str().unwrap();
    let revision = first["ledgerRevision"].as_u64().unwrap().to_string();
    let second = f.json(&[
        "outbox",
        "--dry-run",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--limit",
        "1",
        "--after",
        cursor,
        "--revision",
        &revision,
    ]);
    assert_ne!(first["entries"][0]["id"], second["entries"][0]["id"]);
    assert_eq!(f.status(), before);
    let hex = first["entries"][0]["hex"].as_str().unwrap();
    let bytes: Vec<_> = hex
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect();
    assert_eq!(&bytes[..4], b"AICU");
    assert!(!bytes
        .windows(PRIVATE.len())
        .any(|window| window == PRIVATE.as_bytes()));
    f.append(&source("request_d", 50));
    f.collect();
    f.failed(&[
        "outbox",
        "--dry-run",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
        "--after",
        cursor,
        "--revision",
        &revision,
    ]);
    f.failed(&[
        "outbox",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
    ]);
    f.failed(&[
        "upload",
        "--state-dir",
        "state",
        "--key-file",
        "private.key",
    ]);
}

#[test]
fn database_files_contain_neither_source_paths_nor_content() {
    let f = Fixture::new();
    f.init();
    fs::write(f.0.join("source.jsonl"), source("request_a", 20)).unwrap();
    f.collect();
    let path = f.0.join("source.jsonl").to_string_lossy().into_owned();
    for entry in fs::read_dir(f.0.join("state")).unwrap() {
        let entry = entry.unwrap();
        if !entry.file_type().unwrap().is_file() {
            continue;
        }
        let bytes = fs::read(entry.path()).unwrap();
        assert!(!bytes
            .windows(PRIVATE.len())
            .any(|window| window == PRIVATE.as_bytes()));
        assert!(!bytes
            .windows(path.len())
            .any(|window| window == path.as_bytes()));
        assert!(!bytes
            .windows(b"source.jsonl".len())
            .any(|window| window == b"source.jsonl"));
    }
}
