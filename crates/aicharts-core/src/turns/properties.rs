use super::*;
use serde_json::{json, Value};
use std::io::{self, BufRead, Cursor, Read};

const KEY: [u8; 32] = [7; 32];

fn header() -> Value {
    json!({"type":"session_meta","payload":{"id":"thread-1","source":"cli"}})
}
fn start() -> Value {
    json!({"type":"event_msg","timestamp":"1970-01-02T23:59:59.001Z","payload":{
    "type":"task_started","turn_id":"turn-1","root_turn_id":"turn-1","started_at":172799}})
}
fn end() -> Value {
    json!({"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1",
    "started_at":172799,"completed_at":172800,"duration_ms":1537}})
}
fn lines(records: &[Value]) -> String {
    records.iter().map(|v| format!("{v}\n")).collect()
}
fn parse(records: &[Value]) -> TurnCollection {
    parse_codex_turns(Cursor::new(lines(records)), &KEY).unwrap()
}
fn summary(start: Value, end: Value) -> DailyTurnSummary {
    parse(&[header(), start, end]).daily_summary()
}
fn error(input: &str) -> TurnError {
    parse_codex_turns(Cursor::new(input), &KEY).err().unwrap()
}
fn completed(summary: &DailyTurnSummary) -> &RuntimeCohort {
    &summary.days[0].completed
}

#[test]
fn zero_is_measured_but_missing_null_negative_and_oversized_runtime_are_not() {
    let mut terminal = end();
    terminal["payload"]["duration_ms"] = json!(0);
    let s = summary(start(), terminal);
    assert_eq!(completed(&s).runtime_eligible_turns, 1);
    assert_eq!(completed(&s).runtime_ms_sum, 0);
    for value in [
        Value::Null,
        json!(-1),
        json!(MAX_DURATION_MS + 1),
        json!(u64::MAX),
    ] {
        let mut terminal = end();
        terminal["payload"]["duration_ms"] = value;
        let s = summary(start(), terminal);
        assert_eq!(completed(&s).observed_turns, 1);
        assert_eq!(completed(&s).runtime_eligible_turns, 0);
        assert!(s.diagnostics.contains(&TurnDiagnostic::UnavailableRuntime));
    }
    let mut terminal = end();
    terminal["payload"]
        .as_object_mut()
        .unwrap()
        .remove("duration_ms");
    assert_eq!(
        completed(&summary(start(), terminal)).runtime_eligible_turns,
        0
    );
}

#[test]
fn absent_invalid_and_excess_precision_append_times_never_fall_back_to_seconds() {
    for value in [
        Value::Null,
        json!("bad"),
        json!("1970-01-02T23:59:59.1234567890Z"),
        json!("1970-01-02T23:59:60Z"),
        json!({"private":"skip"}),
        json!(123),
    ] {
        let mut initial = start();
        initial["timestamp"] = value;
        let s = summary(initial, end());
        assert_eq!(completed(&s).runtime_eligible_turns, 0);
        assert!(s
            .diagnostics
            .contains(&TurnDiagnostic::InvalidStartTimestamp));
    }
    let mut initial = start();
    initial.as_object_mut().unwrap().remove("timestamp");
    assert_eq!(
        completed(&summary(initial, end())).runtime_eligible_turns,
        0
    );
}

#[test]
fn full_nanosecond_precision_distinguishes_same_second_attempts() {
    let mut a = start();
    a["timestamp"] = json!("1970-01-02T23:59:59.000000001Z");
    let mut b = a.clone();
    b["timestamp"] = json!("1970-01-02T23:59:59.000000002Z");
    let s = parse(&[header(), a, b, end()]).daily_summary();
    assert_eq!(completed(&s).runtime_eligible_turns, 0);
    assert!(s
        .diagnostics
        .contains(&TurnDiagnostic::AmbiguousTurnAttempt));
}

#[test]
fn invalid_append_evidence_is_sticky_across_clean_source_merges() {
    let mut initial = start();
    initial.as_object_mut().unwrap().remove("timestamp");
    let a = parse(&[header(), initial, end()]);
    let b = parse(&[header(), start(), end()]);
    let s = merge_turn_collections(&[a, b]).unwrap().daily_summary();
    assert_eq!(completed(&s).runtime_eligible_turns, 0);
    assert!(s
        .diagnostics
        .contains(&TurnDiagnostic::InvalidStartTimestamp));
}

#[test]
fn terminal_day_uses_only_its_seconds_coordinate() {
    for value in [Value::Null, json!(-1), json!(MAX_TIMESTAMP_SECONDS + 1)] {
        let mut terminal = end();
        terminal["payload"]["completed_at"] = value;
        terminal["timestamp"] = json!("1970-01-03T00:00:00.001Z");
        let s = summary(start(), terminal);
        assert!(s.days.is_empty());
        assert_eq!(s.undated_root_turns, 1);
    }
    let mut terminal = end();
    terminal["payload"]
        .as_object_mut()
        .unwrap()
        .remove("completed_at");
    assert!(summary(start(), terminal).days.is_empty());
    for (seconds, day) in [
        (0, 0),
        (86_399, 0),
        (86_400, 1),
        (MAX_TIMESTAMP_SECONDS, 100_000_000),
    ] {
        let mut terminal = end();
        terminal["payload"]["completed_at"] = json!(seconds);
        assert_eq!(summary(start(), terminal).days[0].utc_day, day);
    }
}

#[test]
fn aliases_are_canonical_and_terminal_error_text_does_not_imply_failure() {
    let base = parse(&[header(), start(), end()]);
    let mut initial = start();
    initial["payload"]["type"] = json!("turn_started");
    let mut terminal = end();
    terminal["payload"]["type"] = json!("turn_complete");
    terminal["payload"]["error"] =
        json!({"message":"PRIVATE_ERROR","nested":[{"prompt":"PRIVATE_PROMPT"}]});
    let other = parse(&[header(), initial, terminal]);
    let s = merge_turn_collections(&[base, other])
        .unwrap()
        .daily_summary();
    assert_eq!(completed(&s).observed_turns, 1);
    assert_eq!(completed(&s).runtime_ms_sum, 1537);
    assert!(!format!("{s:?}").contains("PRIVATE_"));
}

#[test]
fn aborted_is_separate_and_idless_abort_does_not_close_the_active_turn() {
    let mut terminal = end();
    terminal["payload"]["type"] = json!("turn_aborted");
    let s = summary(start(), terminal.clone());
    assert_eq!(s.days[0].completed.observed_turns, 0);
    assert_eq!(s.days[0].aborted.observed_turns, 1);
    terminal["payload"]["turn_id"] = Value::Null;
    let s = summary(start(), terminal);
    assert!(s.days.is_empty());
    assert!(s.diagnostics.contains(&TurnDiagnostic::MissingTurnIdentity));
    assert!(s.diagnostics.contains(&TurnDiagnostic::MissingTerminal));
}

#[test]
fn missing_start_and_unknown_or_child_root_are_not_guessed() {
    let s = parse(&[header(), end()]).daily_summary();
    assert!(s.days.is_empty());
    assert_eq!(s.unclassified_terminal_turns, 1);
    for value in [Value::Null, json!("parent-turn")] {
        let mut initial = start();
        initial["payload"]["root_turn_id"] = value;
        let s = summary(initial, end());
        assert!(s.days.is_empty());
        assert_eq!(s.unclassified_terminal_turns, 1);
    }
    let mut initial = start();
    initial["payload"]
        .as_object_mut()
        .unwrap()
        .remove("root_turn_id");
    assert!(summary(initial, end()).days.is_empty());
}

#[test]
fn partial_sources_join_only_after_each_source_binds_its_own_thread() {
    let a = parse(&[header(), start()]);
    let b = parse(&[header(), end()]);
    let s = merge_turn_collections(&[a, b]).unwrap().daily_summary();
    assert_eq!(completed(&s).runtime_ms_sum, 1537);
    assert_eq!(
        error(&lines(&[start(), header(), end()])),
        TurnError::MissingSession
    );
    let mut changed = header();
    changed["payload"]["id"] = json!("other-thread");
    assert_eq!(
        error(&lines(&[header(), start(), changed, end()])),
        TurnError::SessionIdentityChanged
    );
}

#[test]
fn optional_session_id_stays_unknown_and_present_id_is_checked() {
    let s = parse(&[header(), start(), end()]).daily_summary();
    assert!(s.diagnostics.contains(&TurnDiagnostic::UnknownSession));
    let mut known = header();
    known["payload"]["session_id"] = json!("thread-1");
    let s = parse(&[known.clone(), start(), end()]).daily_summary();
    assert!(!s.diagnostics.contains(&TurnDiagnostic::UnknownSession));
    known["payload"]["session_id"] = Value::Null;
    assert_eq!(error(&lines(&[known.clone()])), TurnError::MalformedRecord);
    known["payload"]["session_id"] = json!("other");
    assert_eq!(error(&lines(&[known])), TurnError::SessionIdentityChanged);
}

#[test]
fn ancestry_markers_including_late_and_cross_source_markers_are_sticky() {
    for (field, value) in [
        ("parent_thread_id", json!("parent")),
        ("forked_from_id", json!("parent")),
        ("forked_from_ordinal_exclusive", json!(0)),
        ("subagent_history_start_ordinal", json!(0)),
        ("history_base", json!({"path":"DO_NOT_FOLLOW"})),
        (
            "source",
            json!({"subagent":{"thread_spawn":{"parent_thread_id":"parent","depth":1,"agent_path":"DO_NOT_KEEP"}}}),
        ),
        ("source", json!({"internal":"guardian"})),
        ("thread_source", json!("subagent")),
        ("thread_source", json!("guardian_review")),
        ("thread_source", json!("memory_consolidation")),
    ] {
        let mut excluded = header();
        excluded["payload"][field] = value;
        let s = parse(&[header(), start(), end(), excluded.clone()]).daily_summary();
        assert!(s.days.is_empty(), "{field}");
        assert_eq!(s.excluded_threads, 1);
        let s = merge_turn_collections(&[parse(&[header(), start(), end()]), parse(&[excluded])])
            .unwrap()
            .daily_summary();
        assert!(s.days.is_empty(), "{field}");
        assert_eq!(s.excluded_threads, 1);
    }
}

#[test]
fn custom_and_unknown_source_never_claim_human_origin() {
    for source in [json!("unknown"), json!({"custom":"PRIVATE_CUSTOM"})] {
        let mut h = header();
        h["payload"]["source"] = source;
        let s = parse(&[h, start(), end()]).daily_summary();
        assert_eq!(completed(&s).runtime_eligible_turns, 1);
        assert!(s.diagnostics.contains(&TurnDiagnostic::UnknownOrigin));
        assert!(!format!("{s:?}").contains("PRIVATE_CUSTOM"));
    }
}

#[test]
fn malformed_selected_metadata_and_unsupported_history_refuse_with_fixed_errors() {
    for source in [
        json!({"custom":"x","subagent":"review"}),
        json!({}),
        json!("future-source"),
    ] {
        let mut h = header();
        h["payload"]["source"] = source;
        assert_eq!(error(&lines(&[h])), TurnError::MalformedRecord);
    }
    let mut h = header();
    h["payload"]["history_mode"] = json!("future-mode");
    assert_eq!(error(&lines(&[h])), TurnError::UnsupportedHistory);
    for value in [
        json!("SECRET_BAD_ID!"),
        json!("x".repeat(257)),
        json!({"secret":"x"}),
    ] {
        let mut h = header();
        h["payload"]["id"] = value;
        assert_eq!(error(&lines(&[h])), TurnError::MalformedRecord);
    }
    assert_eq!(
        error(
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"thread-1\",\"id\":\"thread-1\"}}\n"
        ),
        TurnError::MalformedRecord
    );
}

#[test]
fn terminal_conflicts_precede_exclusion_and_never_enrich_null_evidence() {
    for (field, value) in [
        ("duration_ms", Value::Null),
        ("completed_at", json!(172801)),
        ("started_at", json!(172798)),
        ("type", json!("turn_aborted")),
    ] {
        let mut terminal = end();
        terminal["payload"][field] = value;
        let mut excluded = header();
        excluded["payload"]["parent_thread_id"] = json!("parent");
        let a = parse(&[header(), start(), end()]);
        let b = parse(&[excluded, start(), terminal]);
        assert_eq!(
            merge_turn_collections(&[a, b]).err(),
            Some(TurnError::ConflictingEvidence)
        );
    }
    let mut child = start();
    child["payload"]["root_turn_id"] = json!("parent-turn");
    assert_eq!(
        error(&lines(&[header(), start(), child, end()])),
        TurnError::ConflictingEvidence
    );
}

#[test]
fn malformed_partial_tail_is_deferred_but_completed_malformed_line_is_refused() {
    let prefix = lines(&[header(), start()]);
    for tail in ["{", "not-json", "{\"type\":\"event_msg\",\"payload\":"] {
        let s = parse_codex_turns(Cursor::new(format!("{prefix}{tail}")), &KEY)
            .unwrap()
            .daily_summary();
        assert!(s.days.is_empty());
        assert_eq!(s.partial_sources, 1);
        assert_eq!(
            error(&format!("{prefix}{tail}\n")),
            TurnError::MalformedRecord
        );
    }
    let input = lines(&[header(), start(), end()]);
    let s = parse_codex_turns(Cursor::new(input.replace('\n', "\r\n")), &KEY)
        .unwrap()
        .daily_summary();
    assert_eq!(completed(&s).runtime_ms_sum, 1537);
}

#[test]
fn bounded_depth_line_and_numeric_types_fail_without_error_text() {
    assert_eq!(
        error(&format!(
            "{}0{}\n",
            "[".repeat(crate::MAX_DEPTH + 1),
            "]".repeat(crate::MAX_DEPTH + 1)
        )),
        TurnError::TooDeep
    );
    assert_eq!(
        error(&format!("{}\n", " ".repeat(crate::MAX_LINE_BYTES))),
        TurnError::LineTooLarge
    );
    for value in [json!(1.5), json!("PRIVATE_COUNTER"), json!({"private":"x"})] {
        let mut terminal = end();
        terminal["payload"]["duration_ms"] = value;
        let error = error(&lines(&[header(), start(), terminal]));
        assert_eq!(error, TurnError::MalformedRecord);
        assert_eq!(error.to_string(), "turn_malformed_record");
    }
}

#[test]
fn raw_line_and_lifecycle_caps_apply_before_duplicate_collapse() {
    assert_eq!(
        error(&"\n".repeat(crate::MAX_LINES as usize + 1)),
        TurnError::RecordLimit
    );
    let repeated = format!(
        "{}{}",
        lines(&[header()]),
        lines(&[start()]).repeat(MAX_OBSERVATIONS as usize + 1)
    );
    assert_eq!(error(&repeated), TurnError::ObservationLimit);
    let a = parse_codex_turns(Cursor::new("\n".repeat(50_001)), &KEY).unwrap();
    assert_eq!(
        merge_turn_collections(&[a.clone(), a]).err(),
        Some(TurnError::RecordLimit)
    );
    let a = parse(&[header()]);
    assert_eq!(
        merge_turn_collections(&vec![a; MAX_SOURCES as usize + 1]).err(),
        Some(TurnError::SourceLimit)
    );
}

#[test]
fn merged_bytes_and_lifecycle_capacity_use_raw_budget_not_unique_measurements() {
    // The private bounds helper lets this test hit arithmetic edges without a
    // 256MiB allocation; the streaming reader boundary is exercised separately.
    let mut a = parse(&[header(), start(), end()]);
    a.budget.bytes = MAX_SOURCE_BYTES / 2 + 1;
    assert_eq!(
        merge_turn_collections(&[a.clone(), a]).err(),
        Some(TurnError::ByteLimit)
    );
    let mut a = parse(&[header(), start(), end()]);
    a.budget.observations = MAX_OBSERVATIONS / 2 + 1;
    assert_eq!(
        merge_turn_collections(&[a.clone(), a]).err(),
        Some(TurnError::ObservationLimit)
    );
    let mut budget = Budget {
        lines: u64::MAX,
        ..Budget::default()
    };
    assert_eq!(
        budget.add(Budget {
            lines: 1,
            ..Budget::default()
        }),
        Err(TurnError::RecordLimit)
    );
}

#[test]
fn stream_byte_cap_checks_exact_end_and_never_consumes_the_extra_byte() {
    let mut exact = reader::Budget::new(Cursor::new(b"{}\n"), 3);
    assert!(matches!(
        reader::next::<_, Entry>(&mut exact),
        Ok(reader::Record::Complete(_))
    ));
    assert!(matches!(
        reader::next::<_, Entry>(&mut exact),
        Ok(reader::Record::End)
    ));
    let mut extra = reader::Budget::new(Cursor::new(b"{}\nX"), 3);
    assert!(matches!(
        reader::next::<_, Entry>(&mut extra),
        Ok(reader::Record::Complete(_))
    ));
    assert_eq!(
        reader::next::<_, Entry>(&mut extra).err(),
        Some(TurnError::ByteLimit)
    );
    assert_eq!(extra.bytes, 3);
}

struct Failing;
impl Read for Failing {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::other("PRIVATE_READ_ERROR"))
    }
}
impl BufRead for Failing {
    fn fill_buf(&mut self) -> io::Result<&[u8]> {
        Err(io::Error::other("PRIVATE_READ_ERROR"))
    }
    fn consume(&mut self, _: usize) {}
}

#[test]
fn key_preflight_precedes_reader_and_io_failures_stay_fixed() {
    assert_eq!(
        parse_codex_turns(Failing, &[0; 32]).err(),
        Some(TurnError::InvalidKey)
    );
    let error = parse_codex_turns(Failing, &KEY).err().unwrap();
    assert_eq!(error.to_string(), "turn_read_failed");
    assert_eq!(
        merge_turn_collections(&[]).err(),
        Some(TurnError::NoSources)
    );
}

#[test]
fn forbidden_content_substitution_does_not_change_evidence_or_summary() {
    let original = parse(&[header(), start(), end()]);
    for n in 0..100 {
        let mut h = header();
        h["payload"]["cwd"] = json!(format!("/private/canary/{n}"));
        h["payload"]["instructions"] = json!({"content": "PRIVATE_CONTENT"});
        let mut initial = start();
        initial["payload"]["model"] = json!(format!("PRIVATE_MODEL_{n}"));
        let mut terminal = end();
        terminal["payload"]["error"] = json!({"message":format!("PRIVATE_ERROR_{n}")});
        let ignored = json!({"type":"response_item","payload":{"type":"function_call","name":"PRIVATE_TOOL","arguments":"PRIVATE_ARGUMENTS","output":"PRIVATE_OUTPUT"}});
        let changed = parse(&[h, initial, ignored, terminal]);
        assert!(original.threads == changed.threads && original.turns == changed.turns);
        assert_eq!(original.daily_summary().days, changed.daily_summary().days);
        assert!(!format!("{:?}", changed.daily_summary()).contains("PRIVATE_"));
    }
}

#[test]
fn deterministic_merge_permutation_association_and_copy_laws() {
    for n in 0..200u64 {
        let mut terminal = end();
        terminal["payload"]["duration_ms"] = json!(n * 97);
        let a = parse(&[header(), start()]);
        let b = parse(&[header(), terminal.clone()]);
        let c = parse(&[header(), start(), terminal]);
        let ab_c = merge_turn_collections(&[
            merge_turn_collections(&[a.clone(), b.clone()]).unwrap(),
            c.clone(),
        ])
        .unwrap();
        let a_bc = merge_turn_collections(&[
            a.clone(),
            merge_turn_collections(&[c.clone(), b.clone()]).unwrap(),
        ])
        .unwrap();
        let reverse = merge_turn_collections(&[c.clone(), b, a]).unwrap();
        assert_eq!(ab_c.daily_summary(), a_bc.daily_summary());
        assert_eq!(ab_c.daily_summary(), reverse.daily_summary());
        assert!(ab_c.turns == c.turns && ab_c.threads == c.threads);
        assert_eq!(completed(&ab_c.daily_summary()).runtime_ms_sum, n * 97);
        assert!(ab_c.budget.bytes > c.budget.bytes);
    }
}

#[test]
fn keys_namespace_turns_but_never_leak_as_output() {
    let input = lines(&[header(), start(), end()]);
    for n in 1..=100u8 {
        let key = [n; 32];
        let a = parse_codex_turns(Cursor::new(&input), &key).unwrap();
        let b = parse_codex_turns(Cursor::new(&input), &[n + 1; 32]).unwrap();
        assert!(a.turns.keys().ne(b.turns.keys()));
        assert_eq!(a.daily_summary(), b.daily_summary());
        assert_eq!(
            merge_turn_collections(&[a, b]).err(),
            Some(TurnError::KeyNamespaceMismatch)
        );
    }
}

#[test]
fn mismatching_start_coordinate_is_unavailable_without_changing_terminal_day_or_count() {
    let mut terminal = end();
    terminal["payload"]["started_at"] = json!(172798);
    let s = summary(start(), terminal);
    assert_eq!(s.days[0].utc_day, 2);
    assert_eq!(completed(&s).observed_turns, 1);
    assert_eq!(completed(&s).runtime_eligible_turns, 0);
    assert!(s.diagnostics.contains(&TurnDiagnostic::StartTimingMismatch));
    let mut terminal = end();
    terminal["payload"]["completed_at"] = json!(172798);
    let s = summary(start(), terminal);
    assert_eq!(completed(&s).runtime_ms_sum, 1537);
    assert!(s
        .diagnostics
        .contains(&TurnDiagnostic::SourceClockRegression));
}
