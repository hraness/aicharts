use super::*;
use std::{
    io::Write,
    os::unix::{
        fs::{symlink, DirBuilderExt, OpenOptionsExt},
        net::UnixListener,
    },
};

const CONTENT:&str = "{\"type\":\"session_meta\",\"payload\":{\"id\":\"thread\"}}\n{\"type\":\"event_msg\",\"timestamp\":\"1970-01-01T00:00:00.001Z\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn\",\"root_turn_id\":\"turn\"}}\n{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn\",\"completed_at\":0,\"duration_ms\":0}}\n";

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        Self::new_at(&std::env::temp_dir())
    }
    fn new_at(parent: &Path) -> Self {
        let mut random = [0; 16];
        getrandom::fill(&mut random).unwrap();
        let suffix: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let path = parent.join(format!("aicharts-turns-capture-{suffix}"));
        fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
        let f = Self(path);
        f.write("key", &[7; 32]);
        f.write("source", CONTENT.as_bytes());
        f
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
    fn options(&self) -> Options {
        Options {
            sources: vec![self.0.join("source")],
            key: self.0.join("key"),
            json: true,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn stable_captured_file_and_key_finish_without_writes() {
    let f = Fixture::new();
    let result = capture(f.options()).unwrap().finish().unwrap();
    let value: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(value["days"][0]["completed"]["runtimeEligibleTurns"], 1);
    assert_eq!(value["days"][0]["completed"]["runtimeMsSum"], "0");
    assert_eq!(fs::read(f.0.join("source")).unwrap(), CONTENT.as_bytes());
    assert_eq!(fs::read(f.0.join("key")).unwrap(), [7; 32]);
}

#[test]
fn final_key_path_replacement_refuses_even_identical_key_bytes() {
    let f = Fixture::new();
    let captured = capture(f.options()).unwrap();
    f.write("replacement", &[7; 32]);
    fs::rename(f.0.join("replacement"), f.0.join("key")).unwrap();
    assert_eq!(captured.finish(), Err("key_changed_during_scan"));
}

#[test]
fn final_key_in_place_change_refuses_the_saved_namespace() {
    let f = Fixture::new();
    let captured = capture(f.options()).unwrap();
    fs::OpenOptions::new()
        .append(true)
        .open(f.0.join("key"))
        .unwrap()
        .write_all(&[8])
        .unwrap();
    assert_eq!(captured.finish(), Err("key_changed_during_scan"));
}

#[test]
fn final_source_replacement_refuses_even_identical_json_bytes() {
    let f = Fixture::new();
    let captured = capture(f.options()).unwrap();
    f.write("replacement", CONTENT.as_bytes());
    fs::rename(f.0.join("replacement"), f.0.join("source")).unwrap();
    assert_eq!(captured.finish(), Err("source_changed_during_scan"));
}

#[test]
fn final_source_append_and_deletion_refuse_instead_of_printing_partial_results() {
    for delete in [false, true] {
        let f = Fixture::new();
        let captured = capture(f.options()).unwrap();
        if delete {
            fs::remove_file(f.0.join("source")).unwrap();
        } else {
            fs::OpenOptions::new()
                .append(true)
                .open(f.0.join("source"))
                .unwrap()
                .write_all(b"\n")
                .unwrap();
        }
        assert_eq!(captured.finish(), Err("source_changed_during_scan"));
    }
}

#[test]
fn final_path_symlink_substitution_is_not_allowed() {
    let f = Fixture::new();
    let captured = capture(f.options()).unwrap();
    fs::rename(f.0.join("source"), f.0.join("moved")).unwrap();
    symlink(f.0.join("moved"), f.0.join("source")).unwrap();
    assert_eq!(captured.finish(), Err("source_changed_during_scan"));
}

#[test]
fn every_earlier_source_is_revalidated_after_the_last_parse() {
    let f = Fixture::new();
    f.write("second", CONTENT.as_bytes());
    let mut options = f.options();
    options.sources.push(f.0.join("second"));
    let captured = capture(options).unwrap();
    f.write("replacement", CONTENT.as_bytes());
    fs::rename(f.0.join("replacement"), f.0.join("source")).unwrap();
    assert_eq!(captured.finish(), Err("source_changed_during_scan"));
}

#[test]
fn aggregate_byte_preflight_happens_before_parsing_any_source() {
    let f = Fixture::new();
    for name in ["large-a", "large-b"] {
        f.write(name, b"");
        fs::OpenOptions::new()
            .write(true)
            .open(f.0.join(name))
            .unwrap()
            .set_len(turns::MAX_SOURCE_BYTES / 2 + 1)
            .unwrap();
    }
    let mut options = f.options();
    options.sources = vec![f.0.join("large-a"), f.0.join("large-b")];
    assert_eq!(capture(options).err(), Some("source_byte_limit"));
}

#[test]
fn source_socket_is_refused_before_opening_or_waiting() {
    // Darwin's per-user temp directory can exceed sockaddr_un's path ceiling.
    // This exclusively created mode-0700 fixture uses a short temp parent only.
    let f = Fixture::new_at(Path::new("/tmp"));
    let path = f.0.join("socket");
    let _socket = UnixListener::bind(&path).unwrap();
    let mut options = f.options();
    options.sources = vec![path];
    assert_eq!(capture(options).err(), Some("file_not_regular"));
}

#[test]
fn wrong_key_preflight_precedes_unreadable_sources() {
    let f = Fixture::new();
    f.write("wrong-key", &[0; 32]);
    let mut options = f.options();
    options.key = f.0.join("wrong-key");
    options.sources = vec![f.0.join("missing")];
    assert_eq!(capture(options).err(), Some("invalid_key_file"));
}

#[test]
fn global_physical_record_exhaustion_refuses_the_next_source() {
    let f = Fixture::new();
    f.write("full", &vec![b'\n'; aicharts_core::MAX_LINES as usize]);
    f.write("extra", b"\n");
    let mut options = f.options();
    options.sources = vec![f.0.join("full"), f.0.join("extra")];
    assert_eq!(capture(options).err(), Some("turn_record_limit"));
}

#[test]
fn zero_remaining_records_allow_a_truly_empty_source() {
    let f = Fixture::new();
    f.write("full", &vec![b'\n'; aicharts_core::MAX_LINES as usize]);
    f.write("empty", b"");
    let mut options = f.options();
    options.sources = vec![f.0.join("full"), f.0.join("empty")];
    let value: serde_json::Value =
        serde_json::from_str(&capture(options).unwrap().finish().unwrap()).unwrap();
    assert_eq!(value["sourcesRead"], 2);
    assert_eq!(value["linesRead"], aicharts_core::MAX_LINES);
    assert_eq!(value["days"], serde_json::json!([]));
}

#[test]
fn global_observation_exhaustion_does_not_parse_the_rest_of_next_source() {
    let f = Fixture::new();
    let mut lines = CONTENT.lines();
    let meta = lines.next().unwrap();
    let initial = lines.next().unwrap();
    let first = format!(
        "{meta}\n{}",
        format!("{initial}\n").repeat(turns::MAX_OBSERVATIONS as usize)
    );
    f.write("full", first.as_bytes());
    f.write(
        "extra",
        format!("{meta}\n{initial}\nMALFORMED_PRIVATE_REST\n").as_bytes(),
    );
    let mut options = f.options();
    options.sources = vec![f.0.join("full"), f.0.join("extra")];
    assert_eq!(capture(options).err(), Some("turn_observation_limit"));
}

#[test]
fn observed_metric_json_uses_exact_decimal_sum_and_distinct_turn_denominator() {
    let metric = ObservedMetric {
        sum: 9_007_199_254_740_993,
        turns_with_evidence: 3,
        observations: 10_000,
    };
    assert_eq!(
        observed_metric_json(&metric, "observed_response_total"),
        serde_json::json!({
            "basis":"observed_response_total","sum":"9007199254740993",
            "turnsWithEvidence":3,"observations":10000,
            "subtotalMean":{"numerator":"9007199254740993","denominator":3},
            "coverage":"partial","populationMean":null
        })
    );
}

#[test]
fn explicit_zero_and_missing_metric_have_different_subtotal_means() {
    let zero = ObservedMetric {
        sum: 0,
        turns_with_evidence: 1,
        observations: 1,
    };
    let missing = ObservedMetric {
        sum: 0,
        turns_with_evidence: 0,
        observations: 0,
    };
    assert_eq!(
        observed_metric_json(&zero, "observed_response_total")["subtotalMean"],
        serde_json::json!({"numerator":"0","denominator":1})
    );
    assert_eq!(
        observed_metric_json(&missing, "observed_requested_calls")["subtotalMean"],
        serde_json::Value::Null
    );
    assert!(observed_metric_text(&zero, "Response tokens").contains("subtotal mean 0/1"));
    assert!(observed_metric_text(&missing, "Requested calls")
        .contains("subtotal mean unavailable (0 turns with evidence)"));
    for metric in [&zero, &missing] {
        assert!(observed_metric_text(metric, "Response tokens")
            .contains("partial, not population mean"));
    }
}

#[test]
fn captured_observations_still_refuse_late_source_and_key_changes() {
    const OBSERVATION: &str = "{\"type\":\"token_usage_record\",\"payload\":{\"thread_id\":\"thread\",\"session_id\":\"thread\",\"turn_id\":\"turn\",\"root_turn_id\":\"turn\",\"response_id\":\"response\",\"usage\":{\"total_tokens\":0}}}\n";
    for changed in ["source", "key"] {
        let f = Fixture::new();
        fs::OpenOptions::new()
            .append(true)
            .open(f.0.join("source"))
            .unwrap()
            .write_all(OBSERVATION.as_bytes())
            .unwrap();
        let captured = capture(f.options()).unwrap();
        assert_eq!(
            captured.summary.days[0]
                .completed
                .observed_subtotals
                .response_tokens
                .turns_with_evidence,
            1
        );
        fs::OpenOptions::new()
            .append(true)
            .open(f.0.join(changed))
            .unwrap()
            .write_all(b"\n")
            .unwrap();
        assert_eq!(
            captured.finish(),
            Err(if changed == "source" {
                "source_changed_during_scan"
            } else {
                "key_changed_during_scan"
            })
        );
    }
}
