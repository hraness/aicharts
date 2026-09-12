#![cfg(any(target_os = "macos", target_os = "linux"))]
//! Synthetic explicit-file CLI boundaries. Never discovers actual provider data.
use serde_json::{json, Value};
use std::os::unix::fs::{symlink, DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};

const PRIVATE: &str = "TURN_PRIVATE_CANARY_b093";
fn source() -> String {
    [json!({"type":"session_meta","payload":{"id":"native-thread-private","source":"cli","cwd":PRIVATE}}),
    json!({"type":"event_msg","timestamp":"1970-01-02T23:59:59.001Z","payload":{"type":"task_started","turn_id":"native-turn-private","root_turn_id":"native-turn-private","started_at":172799}}),
    json!({"type":"event_msg","payload":{"type":"task_complete","turn_id":"native-turn-private","started_at":172799,"completed_at":172800,"duration_ms":1537,"error":{"message":PRIVATE}}})]
    .iter().map(|v|format!("{v}\n")).collect()
}

fn json_lines(records: &[Value]) -> String {
    records.iter().map(|record| format!("{record}\n")).collect()
}

fn metadata() -> Value {
    json!({"type":"session_meta","payload":{
        "id":"native-thread-private","session_id":"native-thread-private","source":"cli",
        "cwd":PRIVATE,"instructions":PRIVATE
    }})
}

fn start(turn: &str, timestamp: &str) -> Value {
    json!({"type":"event_msg","timestamp":timestamp,"payload":{
        "type":"task_started","turn_id":turn,"root_turn_id":turn
    }})
}

fn terminal(turn: &str, outcome: &str, completed_at: Value, duration_ms: u64) -> Value {
    json!({"type":"event_msg","payload":{
        "type":outcome,"turn_id":turn,"completed_at":completed_at,"duration_ms":duration_ms,
        "error":{"message":PRIVATE}
    }})
}

fn usage(turn: &str, response: &str, total: Value) -> Value {
    json!({"type":"token_usage_record","timestamp":"1999-01-01T00:00:00Z","payload":{
        "thread_id":"native-thread-private","session_id":"native-thread-private",
        "turn_id":turn,"root_turn_id":turn,"response_id":response,
        "usage":{"total_tokens":total},"turn_token_usage":{"total_tokens":999999},
        "thread_token_usage":{"total_tokens":999999},"model":PRIVATE
    }})
}

fn call(turn: &str, id: &str, variant: &str) -> Value {
    let identity = if matches!(variant, "web_search_call" | "image_generation_call") {
        "id"
    } else {
        "call_id"
    };
    let mut record = json!({"type":"response_item","payload":{
        "type":variant,"internal_chat_message_metadata_passthrough":{"turn_id":turn},
        "name":PRIVATE,"arguments":PRIVATE,"input":PRIVATE,
        "action":{"query":PRIVATE},"output":PRIVATE
    }});
    record["payload"][identity] = json!(id);
    record
}

fn metric(basis: &str, sum: &str, turns: u64, observations: u64) -> Value {
    json!({
        "basis":basis,"sum":sum,"turnsWithEvidence":turns,"observations":observations,
        "subtotalMean":if turns == 0 { Value::Null } else { json!({"numerator":sum,"denominator":turns}) },
        "coverage":"partial","populationMean":null
    })
}

fn subtotals(tokens: (&str, u64, u64), calls: (&str, u64, u64)) -> Value {
    json!({
        "responseTokens":metric("observed_response_total",tokens.0,tokens.1,tokens.2),
        "requestedCalls":metric("observed_requested_calls",calls.0,calls.1,calls.2)
    })
}

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut random = [0; 16];
        getrandom::fill(&mut random).unwrap();
        let suffix: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let path = std::env::temp_dir().join(format!("aicharts-turns-{suffix}"));
        fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
        let fixture = Self(path);
        fixture.write("key", &[7; 32]);
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
    fn run(&self, args: &[&str]) -> Output {
        let output = Command::new(env!("CARGO_BIN_EXE_aicharts"))
            .current_dir(&self.0)
            .env_clear()
            .args(args)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        for bytes in [&output.stdout, &output.stderr] {
            let text = String::from_utf8_lossy(bytes);
            for canary in [
                PRIVATE,
                "native-thread-private",
                "native-turn-private",
                "native-response-private",
                "native-call-private",
                self.0.to_str().unwrap(),
            ] {
                assert!(!text.contains(canary));
            }
        }
        output
    }
    fn json(&self, args: &[&str]) -> Value {
        let output = self.run(args);
        assert_eq!(
            output.status.code(),
            Some(0),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(output.stderr.is_empty());
        serde_json::from_slice(&output.stdout).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Image {
    bytes: Vec<u8>,
    metadata: [u64; 8],
}
fn image(path: &Path) -> Image {
    let m = fs::metadata(path).unwrap();
    Image {
        bytes: fs::read(path).unwrap(),
        metadata: [
            m.dev(),
            m.ino(),
            u64::from(m.mode()),
            m.len(),
            m.mtime() as u64,
            m.mtime_nsec() as u64,
            m.ctime() as u64,
            m.ctime_nsec() as u64,
        ],
    }
}

#[test]
fn observed_runtime_json_is_exact_numeric_only_and_inputs_unchanged() {
    let f = Fixture::new();
    f.write("source", source().as_bytes());
    let key = image(&f.0.join("key"));
    let original = image(&f.0.join("source"));
    let result = f.json(&[
        "turns",
        "--codex",
        "source",
        "--occurrence-key-file",
        "key",
        "--json",
    ]);
    assert_eq!(
        result,
        json!({
            "schemaVersion":1,"operation":"turns","access":"read_only","localOnly":true,"uploaded":false,
            "provider":"codex","sourceProfile":2,"scope":"root_direct","coverage":"partial",
            "enumerationComplete":false,"origin":"unknown","account":"unknown","runtimeBasis":"provider_reported",
            "terminalTimePrecisionMs":1000,"sourcesRead":1,"linesRead":3,"bytesScanned":source().len(),
            "rawObservations":2,"partialSources":0,"unclassifiedTerminalTurns":0,"undatedRootTurns":0,"excludedThreads":0,
            "days":[{"utcDay":2,"completed":{"observedTurns":1,"runtimeEligibleTurns":1,"runtimeMsSum":"1537",
                    "observedSubtotals":subtotals(("0",0,0),("0",0,0))},
                "aborted":{"observedTurns":0,"runtimeEligibleTurns":0,"runtimeMsSum":"0",
                    "observedSubtotals":subtotals(("0",0,0),("0",0,0))}}],
            "tokens":null,"toolCalls":null,"diagnostics":["partial_history","unknown_session","unknown_origin","unmeasured_tokens","unmeasured_tools","partial_observations"],
            "unavailable":["tokens","tool_calls","pricing"]
        })
    );
    assert_eq!(image(&f.0.join("key")), key);
    assert_eq!(image(&f.0.join("source")), original);
}

#[test]
fn exact_copies_count_raw_sources_but_one_logical_turn() {
    let f = Fixture::new();
    f.write("a", source().as_bytes());
    f.write("b", source().as_bytes());
    let result = f.json(&[
        "turns",
        "--codex",
        "a",
        "--codex",
        "b",
        "--codex",
        "a",
        "--occurrence-key-file",
        "key",
        "--json",
    ]);
    assert_eq!(result["sourcesRead"], 3);
    assert_eq!(result["rawObservations"], 6);
    assert_eq!(result["days"][0]["completed"]["observedTurns"], 1);
}

#[test]
fn merged_subtotal_means_use_metric_specific_distinct_turn_denominators() {
    let f = Fixture::new();
    let a = "native-turn-private-a";
    let b = "native-turn-private-b";
    let c = "native-turn-private-c";
    let d = "native-turn-private-d";
    let first = json_lines(&[
        metadata(),
        start(a, "1970-01-01T00:00:00Z"),
        usage(a, "native-response-private-a1", json!(900)),
        usage(a, "native-response-private-a2", json!(100)),
        call(a, "native-call-private-a1", "function_call"),
        call(a, "native-call-private-a2", "web_search_call"),
        call(a, "native-call-private-a1", "function_call"),
        terminal(a, "task_complete", json!(10), 1001),
    ]);
    let second = json_lines(&[
        metadata(),
        start(b, "1970-01-01T00:00:20Z"),
        usage(b, "native-response-private-b", json!(0)),
        call(b, "native-call-private-b", "custom_tool_call"),
        terminal(b, "task_complete", json!(30), 2002),
        start(c, "1970-01-01T00:00:40Z"),
        usage(c, "native-response-private-c", Value::Null),
        terminal(c, "task_complete", json!(50), 3003),
        start(d, "1970-01-01T00:01:00Z"),
        usage(d, "native-response-private-d", json!(300)),
        terminal(d, "task_complete", json!(70), 4004),
    ]);
    f.write("a", first.as_bytes());
    f.write("b", second.as_bytes());
    let snapshots = ["key", "a", "b"].map(|name| image(&f.0.join(name)));
    let result = f.json(&[
        "turns",
        "--codex",
        "a",
        "--codex",
        "b",
        "--codex",
        "a",
        "--occurrence-key-file",
        "key",
        "--json",
    ]);
    let cohort = &result["days"][0]["completed"];
    assert_eq!(cohort["observedTurns"], 4);
    assert_eq!(cohort["runtimeEligibleTurns"], 4);
    assert_eq!(cohort["runtimeMsSum"], "10010");
    assert_eq!(
        cohort["observedSubtotals"],
        subtotals(("1300", 3, 4), ("3", 2, 3))
    );
    assert_eq!(result["tokens"], Value::Null);
    assert_eq!(result["toolCalls"], Value::Null);
    assert_eq!(result["origin"], "unknown");
    assert_eq!(result["enumerationComplete"], false);
    let reordered = f.json(&[
        "turns",
        "--codex",
        "b",
        "--codex",
        "a",
        "--codex",
        "a",
        "--occurrence-key-file",
        "key",
        "--json",
    ]);
    assert_eq!(reordered, result);
    for (name, snapshot) in ["key", "a", "b"].into_iter().zip(snapshots) {
        assert_eq!(image(&f.0.join(name)), snapshot);
    }
    let output = f.run(&[
        "turns",
        "--codex",
        "a",
        "--codex",
        "b",
        "--occurrence-key-file",
        "key",
    ]);
    assert_eq!(output.status.code(), Some(0));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("subtotal mean 1300/3"));
    assert!(text.contains("subtotal mean 3/2"));
    assert!(text.contains("partial, not population mean"));
    assert!(text.contains("Observed root turns are not necessarily human prompts"));
}

#[test]
fn abort_open_and_undated_turns_do_not_enter_completed_subtotal_means() {
    let f = Fixture::new();
    let complete = "native-turn-private-complete";
    let abort = "native-turn-private-abort";
    let open = "native-turn-private-open";
    let undated = "native-turn-private-undated";
    f.write(
        "source",
        json_lines(&[
            metadata(),
            start(complete, "1970-01-01T23:59:59Z"),
            usage(complete, "native-response-private-complete", json!(7)),
            call(complete, "native-call-private-complete", "function_call"),
            terminal(complete, "task_complete", json!(86400), 1001),
            start(abort, "1970-01-02T00:00:01Z"),
            usage(abort, "native-response-private-abort", json!(90)),
            call(abort, "native-call-private-abort", "local_shell_call"),
            terminal(abort, "turn_aborted", json!(86402), 999),
            start(open, "1970-01-02T00:00:03Z"),
            usage(open, "native-response-private-open", json!(400)),
            call(open, "native-call-private-open", "function_call"),
            start(undated, "1970-01-02T00:00:04Z"),
            usage(undated, "native-response-private-undated", json!(500)),
            terminal(undated, "task_complete", Value::Null, 10),
            usage(complete, "native-response-private-late", json!(3)),
        ])
        .as_bytes(),
    );
    let result = f.json(&[
        "turns",
        "--codex",
        "source",
        "--occurrence-key-file",
        "key",
        "--json",
    ]);
    assert_eq!(result["days"].as_array().unwrap().len(), 1);
    assert_eq!(result["days"][0]["utcDay"], 1);
    assert_eq!(result["days"][0]["completed"]["observedTurns"], 1);
    assert_eq!(
        result["days"][0]["completed"]["observedSubtotals"],
        subtotals(("10", 1, 2), ("1", 1, 1))
    );
    assert_eq!(result["days"][0]["aborted"]["observedTurns"], 1);
    assert_eq!(
        result["days"][0]["aborted"]["observedSubtotals"],
        subtotals(("90", 1, 1), ("1", 1, 1))
    );
    assert_eq!(result["undatedRootTurns"], 1);
}

#[test]
fn requested_call_projection_ignores_outputs_nested_calls_and_private_content() {
    let f = Fixture::new();
    let turn = "native-turn-private";
    let mut function = call(turn, "native-call-private-function", "function_call");
    function["payload"]["id"] = json!("native-call-private-item-not-an-extra-call");
    let mut unstamped = call(turn, "native-call-private-unstamped", "function_call");
    unstamped["payload"]
        .as_object_mut()
        .unwrap()
        .remove("internal_chat_message_metadata_passthrough");
    let mut missing_id = call(turn, "native-call-private-no-fallback", "local_shell_call");
    missing_id["payload"]
        .as_object_mut()
        .unwrap()
        .remove("call_id");
    missing_id["payload"]["id"] = json!("native-call-private-no-fallback");
    let content = json_lines(&[
        metadata(),
        start(turn, "1970-01-01T00:00:00Z"),
        usage(turn, "native-response-private", json!(42)),
        function.clone(),
        function,
        call(turn, "native-call-private-custom", "custom_tool_call"),
        call(turn, "native-call-private-shell", "local_shell_call"),
        call(turn, "native-call-private-search", "tool_search_call"),
        call(turn, "native-call-private-web", "web_search_call"),
        call(turn, "native-call-private-image", "image_generation_call"),
        unstamped,
        missing_id,
        json!({"type":"response_item","payload":{"type":"function_call_output",
            "call_id":"native-call-private-function","output":PRIVATE,
            "internal_chat_message_metadata_passthrough":{"turn_id":turn,
                "executed_tool_calls":[{"name":PRIVATE,"arguments":PRIVATE}],"tool_calls_complete":true}}}),
        json!({"type":"event_msg","payload":{"type":"item_completed","thread_id":"native-thread-private",
            "turn_id":turn,"item":{"type":"CommandExecution","id":"native-call-private-function",
                "source":"user_shell","command":PRIVATE}}}),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":PRIVATE}}),
        json!({"type":"compacted","payload":{"message":PRIVATE,
            "replacement_history":[usage(turn,"native-response-private-nested",json!(99999))]}}),
        terminal(turn, "task_complete", json!(1), 1),
    ]);
    f.write("source", content.as_bytes());
    let replacement = "x".repeat(PRIVATE.len());
    f.write(
        "redacted",
        content.replace(PRIVATE, &replacement).as_bytes(),
    );
    let original = image(&f.0.join("source"));
    let key = image(&f.0.join("key"));
    let result = f.json(&[
        "turns",
        "--codex",
        "source",
        "--occurrence-key-file",
        "key",
        "--json",
    ]);
    let redacted = f.json(&[
        "turns",
        "--codex",
        "redacted",
        "--occurrence-key-file",
        "key",
        "--json",
    ]);
    assert_eq!(redacted, result);
    assert!(!serde_json::to_string(&result)
        .unwrap()
        .contains(&replacement));
    assert_eq!(
        result["days"][0]["completed"]["observedSubtotals"],
        subtotals(("42", 1, 1), ("6", 1, 6))
    );
    assert_eq!(image(&f.0.join("source")), original);
    assert_eq!(image(&f.0.join("key")), key);
    let mut names: Vec<_> = fs::read_dir(&f.0)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    assert_eq!(names, ["key", "redacted", "source"]);
}

#[test]
fn partial_tail_is_deferred_and_plain_text_names_observed_average() {
    let f = Fixture::new();
    f.write("source", source().trim_end_matches('\n').as_bytes());
    let result = f.json(&[
        "turns",
        "--codex",
        "source",
        "--occurrence-key-file",
        "key",
        "--json",
    ]);
    assert_eq!(result["days"], json!([]));
    assert_eq!(result["partialSources"], 1);
    f.write("complete", source().as_bytes());
    let output = f.run(&[
        "turns",
        "--codex",
        "complete",
        "--occurrence-key-file",
        "key",
    ]);
    assert_eq!(output.status.code(), Some(0));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("observed average"));
    assert!(text.contains("1537/1 ms"));
}

#[test]
fn complete_json_observation_without_final_lf_is_not_zero_evidence() {
    let f = Fixture::new();
    let trailing = usage("native-turn-private", "native-response-private", json!(0));
    let content = format!("{}{trailing}", source());
    f.write("source", content.as_bytes());
    let result = f.json(&[
        "turns",
        "--codex",
        "source",
        "--occurrence-key-file",
        "key",
        "--json",
    ]);
    assert_eq!(result["partialSources"], 1);
    assert_eq!(result["rawObservations"], 2);
    assert_eq!(
        result["days"][0]["completed"]["observedSubtotals"],
        subtotals(("0", 0, 0), ("0", 0, 0))
    );
}

#[test]
fn conflicting_response_binding_refuses_all_stdout_without_echoing_ids() {
    let f = Fixture::new();
    let turn = "native-turn-private";
    f.write(
        "source",
        json_lines(&[
            metadata(),
            start(turn, "1970-01-01T00:00:00Z"),
            usage(turn, "native-response-private", json!(1)),
            terminal(turn, "task_complete", json!(1), 1),
            usage(turn, "native-response-private", json!(2)),
        ])
        .as_bytes(),
    );
    let original = image(&f.0.join("source"));
    let output = f.run(&[
        "turns",
        "--codex",
        "source",
        "--occurrence-key-file",
        "key",
        "--json",
    ]);
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert_eq!(output.stderr, b"aicharts: turn_conflicting_evidence\n");
    assert_eq!(image(&f.0.join("source")), original);
}

#[test]
fn source_directories_and_symlinks_are_refused_without_partial_stdout() {
    let f = Fixture::new();
    f.write("source", source().as_bytes());
    fs::DirBuilder::new()
        .mode(0o700)
        .create(f.0.join("directory"))
        .unwrap();
    symlink("source", f.0.join("link")).unwrap();
    for name in ["directory", "link"] {
        let output = f.run(&[
            "turns",
            "--codex",
            name,
            "--occurrence-key-file",
            "key",
            "--json",
        ]);
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert_eq!(output.stderr, b"aicharts: file_not_regular\n");
    }
}

#[test]
fn malformed_options_and_version_reservation_precede_any_file_read() {
    let f = Fixture::new();
    for args in [
        vec![
            "turns",
            "--codex",
            "missing",
            "--occurrence-key-file",
            "missing-key",
            "--claude",
            "x",
        ],
        vec![
            "turns",
            "--codex",
            "missing",
            "--occurrence-key-file",
            "missing-key",
            "--json",
            "--json",
        ],
        vec!["turns", "--codex", "--occurrence-key-file", "key"],
    ] {
        let output = f.run(&args);
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert!(!String::from_utf8_lossy(&output.stderr).contains("key_read_failed"));
    }
    let output = f.run(&[
        "turns",
        "--codex",
        "--version",
        "--occurrence-key-file",
        "missing",
    ]);
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(output.stderr, b"aicharts: invalid_version_arguments\n");
}

#[test]
fn help_is_source_free_and_excess_source_arguments_fail_before_key_access() {
    let f = Fixture::new();
    let output = f.run(&["turns", "--help"]);
    assert_eq!(output.status.code(), Some(0));
    let help = String::from_utf8_lossy(&output.stdout);
    assert!(help.contains("Explicit regular files only"));
    assert!(help.contains("partial response-token/requested-call subtotals"));
    assert!(help.contains("only turns with evidence for that metric"));
    assert!(help.contains("dispatched tool calls, population means, human origin"));
    let mut args = vec!["turns", "--occurrence-key-file", "missing-key"];
    for _ in 0..2049 {
        args.extend(["--codex", "missing-source"]);
    }
    let output = f.run(&args);
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert_eq!(output.stderr, b"aicharts: too_many_sources\n");
}

#[test]
fn malformed_source_error_never_includes_native_text_or_source_path() {
    let f = Fixture::new();
    f.write("source", format!("{PRIVATE}\n").as_bytes());
    let output = f.run(&[
        "turns",
        "--codex",
        "source",
        "--occurrence-key-file",
        "key",
        "--json",
    ]);
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert_eq!(output.stderr, b"aicharts: turn_malformed_record\n");
}
