#![cfg(unix)]
use std::{fs, os::unix::fs::OpenOptionsExt, path::PathBuf, process::Command};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut random = [0; 16];
        getrandom::fill(&mut random).unwrap();
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let root = std::env::temp_dir().join(format!("aicharts-support-{suffix}"));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_aicharts"));
        command
            .env_clear()
            .env("XDG_STATE_HOME", self.0.join("preferences"))
            .env("HRANESS_SUPPORT_EMAIL", "off")
            .current_dir(&self.0);
        command
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn actual_protocol_needs_no_product_state_and_replays_its_executable() {
    let f = Fixture::new();
    let result = f
        .command()
        .args(["support", "protocol", "--json"])
        .output()
        .unwrap();
    assert!(result.status.success());
    assert!(result.stderr.is_empty());
    assert_eq!(fs::read_dir(&f.0).unwrap().count(), 0);
    let protocol: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(protocol["offer"]["product"]["id"], "aicharts");
    let argv = protocol["commands"]["offer"].as_array().unwrap();
    assert_eq!(
        PathBuf::from(argv[0].as_str().unwrap()),
        fs::canonicalize(env!("CARGO_BIN_EXE_aicharts")).unwrap()
    );
    let mut replay = f.command();
    replay.args(argv[1..].iter().map(|value| value.as_str().unwrap()));
    let result = replay.output().unwrap();
    assert!(result.status.success());
    let offer: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(offer["kind"], "offer");
    assert!(offer["invitation"].get("emailSuggestion").is_none());
}

#[test]
fn completed_read_preserves_stdout_and_quiet_cases_create_no_preferences() {
    use std::io::Write;
    let f = Fixture::new();
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(f.0.join("key"))
        .unwrap()
        .write_all(&[7; 32])
        .unwrap();
    fs::write(f.0.join("source.jsonl"), serde_json::json!({
        "type":"assistant","requestId":"fixture-request","sessionId":"fixture-session",
        "timestamp":"2026-09-10T10:00:00Z", "cwd":"PRIVATE_SUPPORT_CANARY",
        "message":{"id":"fixture-message","role":"assistant","content":[],
        "usage":{"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}
    }).to_string()+"\n").unwrap();
    let args = [
        "usage",
        "--key-file",
        "key",
        "--claude",
        "source.jsonl",
        "--json",
    ];
    let baseline = f
        .command()
        .env("HRANESS_SUPPORT_AUDIENCE", "off")
        .args(args)
        .output()
        .unwrap();
    assert!(baseline.status.success());
    assert!(baseline.stderr.is_empty());
    assert!(!f.0.join("preferences").exists());
    for args in [
        &["--help"][..],
        &["--version", "--json"],
        &["inspect"],
        &["daemon"],
        &["enroll"],
        &["upload"],
    ] {
        let output = f.command().args(args).output().unwrap();
        assert!(!String::from_utf8_lossy(&output.stderr).contains("hraness-support"));
        assert!(!f.0.join("preferences").exists());
    }
    let ci = f.command().env("CI", "true").args(args).output().unwrap();
    assert_eq!(ci.stdout, baseline.stdout);
    assert!(ci.stderr.is_empty());
    assert!(!f.0.join("preferences").exists());
    let result = f.command().args(args).output().unwrap();
    assert!(result.status.success());
    assert_eq!(result.stdout, baseline.stdout);
    let notice: serde_json::Value = serde_json::from_slice(&result.stderr).unwrap();
    assert_eq!(notice["schemaVersion"], "hraness-support-discovery-v1");
    assert!(!String::from_utf8_lossy(&result.stderr).contains("PRIVATE_SUPPORT_CANARY"));
    assert!(f.command().args(args).output().unwrap().stderr.is_empty());
}
