use std::process::Command;

#[test]
fn sync_help_is_available_without_any_local_state() {
    let result = Command::new(env!("CARGO_BIN_EXE_aicharts"))
        .args(["sync", "--help"])
        .output()
        .unwrap();
    assert!(result.status.success());
    let output = String::from_utf8(result.stdout).unwrap();
    assert!(output.contains("--reconcile-retained"));
    assert!(output.contains("Exit 3:"));
    assert!(output.contains("never initializes, migrates, rekeys, resets"));
    assert!(result.stderr.is_empty());
}

#[test]
fn malformed_scheduled_invocation_emits_structured_failure_and_nonzero_status() {
    let result = Command::new(env!("CARGO_BIN_EXE_aicharts"))
        .args([
            "sync",
            "--json",
            "--complete-prefix",
            "--state-dir",
            "PRIVATE_STATE_CANARY",
            "--key-file",
            "PRIVATE_KEY_CANARY",
            "--codex",
            "PRIVATE_SOURCE_CANARY",
            "--max-batches",
            "0",
        ])
        .output()
        .unwrap();
    assert_eq!(result.status.code(), Some(2));
    let output = String::from_utf8(result.stdout).unwrap();
    let data: serde_json::Value = serde_json::from_str(&output).unwrap();
    assert_eq!(data["operation"], "sync");
    assert_eq!(data["status"], "failed");
    assert_eq!(data["error"], "invalid_batch_limit");
    assert!(!output.contains("PRIVATE"));
    assert_eq!(
        String::from_utf8(result.stderr).unwrap(),
        "aicharts: invalid_batch_limit\n"
    );
}
