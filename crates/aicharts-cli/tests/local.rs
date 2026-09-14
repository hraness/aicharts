//! These tests create only synthetic files in a fresh temporary directory.
#![cfg(unix)]

use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut id = [0u8; 16];
        getrandom::fill(&mut id).unwrap();
        let suffix: String = id.iter().map(|b| format!("{b:02x}")).collect();
        let path = std::env::temp_dir().join(format!("aicharts-cli-test-{suffix}"));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn run(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_aicharts"))
            .current_dir(&self.0)
            .args(args)
            .output()
            .unwrap()
    }
    fn key(&self) {
        assert!(self
            .run(&["keygen", "--output", "private.key"])
            .status
            .success());
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // Only this newly created, random exact test directory is removed.
        fs::remove_dir_all(&self.0).unwrap();
    }
}

const PRIVATE: &str = "PRIVATE_CONTENT_CANARY_599f3";
fn source(output: u64) -> String {
    serde_json::json!({
        "type": "assistant", "requestId": "req_a", "sessionId": "session_a",
        "timestamp": "2026-09-10T10:00:00Z", "cwd": PRIVATE,
        "message": { "id": "msg_a", "role": "assistant",
            "content": [{"type": "text", "text": PRIVATE}],
            "usage": { "input_tokens": 100, "output_tokens": output,
                "cache_read_input_tokens": 50, "cache_creation_input_tokens": 0 }
        }
    })
    .to_string()
        + "\n"
}

#[test]
fn local_summary_deduplicates_copies_and_streaming_revisions() {
    let f = Fixture::new();
    f.key();
    fs::write(f.0.join("a.jsonl"), source(20)).unwrap();
    fs::write(f.0.join("b.jsonl"), source(30)).unwrap();
    let result = f.run(&[
        "usage",
        "--key-file",
        "private.key",
        "--claude",
        "a.jsonl",
        "--claude",
        "b.jsonl",
        "--json",
    ]);
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let json: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(json["tokens"], "180");
    assert_eq!(json["outputTokens"], "30");
    assert_eq!(json["usageOccurrences"], 1);
    assert_eq!(json["uploaded"], false);
    assert_eq!(json["modelPricingAvailable"], false);
    assert_eq!(json["promptOccurrences"], serde_json::Value::Null);
    assert_eq!(json["measurementCoverage"], "partial");
    assert!(!String::from_utf8_lossy(&result.stdout).contains(PRIVATE));
    assert!(result.stderr.is_empty());
}

#[test]
fn dry_run_is_valid_wire_without_content_and_cannot_upload() {
    let f = Fixture::new();
    f.key();
    fs::write(f.0.join("a.jsonl"), source(20)).unwrap();
    let result = f.run(&[
        "upload",
        "--dry-run",
        "--key-file",
        "private.key",
        "--claude",
        "a.jsonl",
    ]);
    assert!(result.status.success());
    let json: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(json["uploaded"], false);
    let hex = json["frames"][0]["hex"].as_str().unwrap();
    let bytes: Vec<_> = hex
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect();
    let registry = aicharts_protocol::Registry {
        revision: 1,
        models: vec![],
    };
    let day = json["frames"][0]["utcDay"].as_u64().unwrap() as u32;
    let policy = aicharts_protocol::Policy {
        first_day: day,
        last_day: day,
        registry: &registry,
    };
    let batch = aicharts_protocol::decode(&bytes, &policy).unwrap();
    assert_eq!(batch.usage[0].tokens.total().unwrap(), 170);
    assert!(!bytes
        .windows(PRIVATE.len())
        .any(|w| w == PRIVATE.as_bytes()));
    let rejected = f.run(&["upload", "--key-file", "private.key", "--claude", "a.jsonl"]);
    assert_eq!(rejected.status.code(), Some(2));
    assert!(rejected.stdout.is_empty());
}

#[test]
fn keygen_is_private_and_never_overwrites_existing_key() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();
    f.key();
    let before = fs::read(f.0.join("private.key")).unwrap();
    assert_eq!(before.len(), 32);
    assert_eq!(
        fs::metadata(f.0.join("private.key"))
            .unwrap()
            .permissions()
            .mode()
            & 0o077,
        0
    );
    assert_eq!(
        f.run(&["keygen", "--output", "private.key"]).status.code(),
        Some(2)
    );
    assert_eq!(fs::read(f.0.join("private.key")).unwrap(), before);
}

#[test]
fn malformed_sources_and_symlinks_fail_without_reflecting_paths_or_content() {
    let f = Fixture::new();
    f.key();
    fs::write(f.0.join("bad.jsonl"), format!("{{\"{PRIVATE}\":")).unwrap();
    let bad = f.run(&[
        "usage",
        "--key-file",
        "private.key",
        "--claude",
        "bad.jsonl",
    ]);
    assert_eq!(bad.status.code(), Some(2));
    assert_eq!(
        String::from_utf8(bad.stderr).unwrap(),
        "aicharts: source_parse_failed\n"
    );
    assert!(bad.stdout.is_empty());
    std::os::unix::fs::symlink(f.0.join("bad.jsonl"), f.0.join("link.jsonl")).unwrap();
    let linked = f.run(&[
        "usage",
        "--key-file",
        "private.key",
        "--claude",
        "link.jsonl",
    ]);
    assert_eq!(
        String::from_utf8(linked.stderr).unwrap(),
        "aicharts: source_symlink_not_allowed\n"
    );
}

#[test]
fn non_utf8_arguments_fail_without_a_reflective_panic() {
    use std::os::unix::ffi::OsStringExt;
    let result = Command::new(env!("CARGO_BIN_EXE_aicharts"))
        .arg(std::ffi::OsString::from_vec(b"PRIVATE_\xff".to_vec()))
        .output()
        .unwrap();
    assert_eq!(result.status.code(), Some(2));
    assert!(result.stdout.is_empty());
    assert_eq!(result.stderr, b"aicharts: invalid_argument_encoding\n");
}
