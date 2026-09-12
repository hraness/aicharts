use super::*;
use serde_json::{json, Value};
use std::io::Cursor;

const KEY: [u8; 32] = [29; 32];

fn meta(id: &str, session: Option<&str>, extra: Value) -> Value {
    let mut payload = json!({"id":id,"source":"cli","history_mode":"legacy"});
    if let Some(session) = session {
        payload["session_id"] = json!(session);
    }
    payload
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    json!({"type":"session_meta","payload":payload})
}
fn child() -> Value {
    meta(
        "child",
        Some("parent"),
        json!({"parent_thread_id":"middle"}),
    )
}
fn copy() -> Value {
    meta("copy", Some("copy"), json!({"forked_from_id":"parent"}))
}
fn start(turn: &str) -> Value {
    json!({"type":"event_msg","timestamp":"1970-01-01T23:59:59.123Z","payload":{"type":"task_started","turn_id":turn,"root_turn_id":turn,"started_at":86399}})
}
fn end(turn: &str, duration: u64) -> Value {
    json!({"type":"event_msg","payload":{"type":"task_complete","turn_id":turn,"started_at":86399,"completed_at":86400,"duration_ms":duration}})
}
fn token(thread: &str, total: u64) -> Value {
    json!({"type":"token_usage_record","payload":{"thread_id":thread,"session_id":thread,"turn_id":"turn","root_turn_id":"turn","response_id":"response","usage":{"total_tokens":total}}})
}
fn call(turn: &str) -> Value {
    json!({"type":"response_item","payload":{"type":"function_call","call_id":"call","internal_chat_message_metadata_passthrough":{"turn_id":turn}}})
}
fn lines(rows: &[Value]) -> String {
    rows.iter().map(|row| format!("{row}\n")).collect()
}
fn parse(rows: &[Value]) -> TurnCollection {
    parse_codex_turns(Cursor::new(lines(rows)), &KEY).unwrap()
}
fn root_rows() -> Vec<Value> {
    vec![
        meta("parent", Some("parent"), json!({})),
        start("turn"),
        token("parent", 110),
        call("turn"),
        end("turn", 1234),
    ]
}
fn error(rows: &[Value], expected: &str) {
    assert_eq!(
        parse_codex_turns(Cursor::new(lines(rows)), &KEY)
            .err()
            .map(TurnError::code),
        Some(expected)
    );
}

#[test]
fn shared_session_noncopy_child_is_excluded() {
    let rows = [
        child(),
        start("turn"),
        token("child", 110),
        call("turn"),
        end("turn", 1234),
    ];
    let collection = parse(&rows);
    let summary = collection.daily_summary();
    assert!(summary.days.is_empty());
    assert_eq!(summary.excluded_threads, 1);
    assert_eq!(summary.unclassified_terminal_turns, 1);
    assert_eq!(summary.raw_observations, 4);
    assert_eq!(collection.threads.len(), 1);
    assert_eq!(collection.turns.len(), 1);
    assert!(!summary.coverage_complete);
    assert_eq!((summary.tokens, summary.tool_calls), (None, None));
}

#[test]
fn declared_copy_metadata_only_does_not_taint_parent() {
    let copied = parse(&[
        copy(),
        meta(
            "parent",
            Some("parent"),
            json!({"parent_thread_id":"ancestor"}),
        ),
    ]);
    assert_eq!(copied.threads.len(), 1);
    assert!(copied.turns.is_empty());
    assert_eq!(copied.daily_summary().raw_observations, 0);
    let root = parse(&root_rows());
    for inputs in [
        [copied.clone(), root.clone()],
        [root.clone(), copied.clone()],
    ] {
        let summary = merge_turn_collections(&inputs).unwrap().daily_summary();
        assert_eq!(summary.days, root.daily_summary().days);
        assert_eq!(summary.excluded_threads, 1);
        assert_eq!(summary.unclassified_terminal_turns, 0);
    }
}

#[test]
fn direct_root_numeric_debug_golden_unchanged() {
    let rows = root_rows();
    let summary = parse(&rows).daily_summary();
    assert_eq!(PROFILE_VERSION, 2);
    assert_eq!(format!("{:?}", summary.days), "[DailyRuntime { utc_day: 1, completed: RuntimeCohort { observed_turns: 1, runtime_eligible_turns: 1, runtime_ms_sum: 1234, observed_subtotals: ObservedSubtotals { response_tokens: ObservedMetric { sum: 110, turns_with_evidence: 1, observations: 1 }, requested_calls: ObservedMetric { sum: 1, turns_with_evidence: 1, observations: 1 } } }, aborted: RuntimeCohort { observed_turns: 0, runtime_eligible_turns: 0, runtime_ms_sum: 0, observed_subtotals: ObservedSubtotals { response_tokens: ObservedMetric { sum: 0, turns_with_evidence: 0, observations: 0 }, requested_calls: ObservedMetric { sum: 0, turns_with_evidence: 0, observations: 0 } } } }]");
    assert_eq!(
        format!("{:?}", summary.diagnostics),
        "[PartialHistory, UnknownOrigin, UnmeasuredTokens, UnmeasuredTools, PartialObservations]"
    );
    assert_eq!(
        (
            summary.sources_read,
            summary.lines_read,
            summary.raw_observations
        ),
        (1, 5, 4)
    );
    assert_eq!(summary.bytes_scanned, lines(&rows).len() as u64);
    assert_eq!(
        (
            summary.excluded_threads,
            summary.unclassified_terminal_turns,
            summary.undated_root_turns,
            summary.partial_sources
        ),
        (0, 0, 0, 0)
    );
    assert_eq!(
        (
            summary.coverage_complete,
            summary.tokens,
            summary.tool_calls
        ),
        (false, None, None)
    );
}

#[test]
fn individual_noncopy_markers_accept_shared_session_without_parent_equality() {
    for extra in [
        json!({"parent_thread_id":"middle"}),
        json!({"source":{"subagent":{"thread_spawn":{"parent_thread_id":"middle"}}}}),
        json!({"source":{"internal":"guardian"}}),
        json!({"thread_source":"subagent"}),
        json!({"thread_source":"guardian_review"}),
        json!({"thread_source":"memory_consolidation"}),
    ] {
        let summary = parse(&[
            meta("child", Some("parent"), extra),
            start("turn"),
            end("turn", 7),
        ])
        .daily_summary();
        assert!(summary.days.is_empty());
        assert_eq!(summary.excluded_threads, 1);
        assert_eq!(summary.unclassified_terminal_turns, 1);
    }
}

#[test]
fn unexplained_session_mismatch_cannot_be_repaired_by_later_metadata() {
    for extra in [
        json!({}),
        json!({"thread_source":"user"}),
        json!({"parent_thread_id":null}),
        json!({"forked_from_id":null}),
    ] {
        error(
            &[meta("child", Some("parent"), extra), child()],
            "turn_session_tree_mismatch",
        );
    }
    let mut unknown_source = meta("child", Some("parent"), json!({}));
    unknown_source["payload"]
        .as_object_mut()
        .unwrap()
        .remove("source");
    error(&[unknown_source], "turn_session_tree_mismatch");
}

#[test]
fn explicit_session_conflicts_are_checked_locally_and_across_files() {
    let a = child();
    let b = meta(
        "child",
        Some("other-root"),
        json!({"parent_thread_id":"middle"}),
    );
    for rows in [[a.clone(), b.clone()], [b.clone(), a.clone()]] {
        error(&rows, "turn_metadata_session_conflict");
        assert_eq!(
            merge_turn_collections(&[parse(&rows[..1]), parse(&rows[1..])])
                .err()
                .map(TurnError::code),
            Some("turn_metadata_session_conflict")
        );
    }
    let inherited = meta(
        "parent",
        Some("ancestor"),
        json!({"parent_thread_id":"middle"}),
    );
    error(
        &[copy(), meta("parent", Some("parent"), json!({})), inherited],
        "turn_metadata_session_conflict",
    );
    error(
        &[
            copy(),
            meta("parent", Some("parent"), json!({})),
            meta(
                "copy",
                Some("different"),
                json!({"forked_from_id":"parent"}),
            ),
        ],
        "turn_metadata_session_conflict",
    );
}

#[test]
fn absent_session_stays_unknown_when_explicit_evidence_arrives() {
    let unknown = meta("child", None, json!({"parent_thread_id":"middle"}));
    for rows in [[unknown.clone(), child()], [child(), unknown]] {
        for collection in [
            parse(&rows),
            merge_turn_collections(&[parse(&rows[..1]), parse(&rows[1..])]).unwrap(),
        ] {
            let summary = collection.daily_summary();
            assert_eq!(summary.excluded_threads, 1);
            assert!(summary
                .diagnostics
                .contains(&TurnDiagnostic::UnknownSession));
        }
    }
}

#[test]
fn foreign_metadata_requires_prior_canonical_inheritance_declaration() {
    let foreign = meta(
        "parent",
        Some("parent"),
        json!({"forked_from_id":"ancestor"}),
    );
    error(
        &[child(), foreign.clone()],
        "turn_container_identity_ambiguous",
    );
    error(
        &[meta("copy", Some("copy"), json!({})), foreign, copy()],
        "turn_container_identity_ambiguous",
    );
    let collection = parse(&[copy(), meta("parent", Some("parent"), json!({})), copy()]);
    assert_eq!(collection.threads.len(), 1);
    assert_eq!(collection.daily_summary().excluded_threads, 1);
}

#[test]
fn foreign_metadata_still_undergoes_structural_validation() {
    for (field, value, expected) in [
        ("id", json!(7), "turn_malformed_record"),
        ("session_id", Value::Null, "turn_malformed_record"),
        (
            "session_id",
            json!({"secret":"CANARY"}),
            "turn_malformed_record",
        ),
        ("parent_thread_id", json!(true), "turn_malformed_record"),
        ("source", json!("future-source"), "turn_malformed_record"),
        (
            "history_mode",
            json!("future-mode"),
            "turn_unsupported_history",
        ),
    ] {
        let mut foreign = meta("parent", Some("parent"), json!({}));
        foreign["payload"][field] = value;
        error(&[copy(), foreign], expected);
    }
    let text = format!(
        "{}{}\n",
        lines(&[copy()]),
        r#"{"type":"session_meta","payload":{"id":"parent","id":"parent"}}"#
    );
    assert_eq!(
        parse_codex_turns(Cursor::new(text), &KEY)
            .err()
            .map(TurnError::code),
        Some("turn_malformed_record")
    );
}

fn selected_rows() -> Vec<Value> {
    vec![
        start("turn"),
        end("turn", 7),
        token("copy", 0),
        call("turn"),
        json!({"type":"event_msg","payload":{"type":"task_started"}}),
        json!({"type":"event_msg","payload":{"type":"turn_aborted"}}),
        json!({"type":"token_usage_record"}),
        json!({"type":"response_item","payload":{"type":"function_call"}}),
    ]
}

#[test]
fn copied_observations_refuse_before_after_and_between_foreign_headers() {
    let foreign = meta("parent", Some("parent"), json!({}));
    for selected in selected_rows() {
        for rows in [
            vec![copy(), selected.clone(), foreign.clone()],
            vec![copy(), foreign.clone(), selected.clone()],
            vec![copy(), selected.clone(), foreign.clone(), selected.clone()],
            vec![copy(), foreign.clone(), copy(), selected],
        ] {
            error(&rows, "turn_inherited_observation_ownership");
        }
    }
}

#[test]
fn malformed_selected_fields_precede_copied_ownership_refusal() {
    let mut bad_start = start("turn");
    bad_start["payload"]["started_at"] = json!({"invalid":"CANARY"});
    let mut bad_token_id = token("copy", 0);
    bad_token_id["payload"]["thread_id"] = json!({"invalid":"CANARY"});
    let mut bad_total = token("copy", 0);
    bad_total["payload"]["usage"]["total_tokens"] = json!("CANARY");
    let mut bad_call_id = call("turn");
    bad_call_id["payload"]["call_id"] = json!({"invalid":"CANARY"});
    let mut bad_stamp = call("turn");
    bad_stamp["payload"]["internal_chat_message_metadata_passthrough"] = json!(true);
    for bad in [bad_start, bad_token_id, bad_total, bad_call_id, bad_stamp] {
        let foreign = meta("parent", Some("parent"), json!({}));
        error(
            &[copy(), bad.clone(), foreign.clone()],
            "turn_malformed_record",
        );
        error(&[copy(), foreign, bad.clone()], "turn_malformed_record");
        let inherited = meta("child", Some("parent"), json!({"forked_from_id":"parent"}));
        error(&[inherited, bad], "turn_malformed_record");
    }
}

#[test]
fn shared_session_inheritance_is_ambiguous_even_without_foreign_headers() {
    for (field, value) in [
        ("forked_from_id", json!("parent")),
        ("forked_from_ordinal_exclusive", json!(0)),
        ("subagent_history_start_ordinal", json!(0)),
        ("history_base", json!({"path":"DO_NOT_FOLLOW"})),
    ] {
        let mut inherited = child();
        inherited["payload"][field] = value;
        assert_eq!(
            parse(&[inherited.clone()]).daily_summary().excluded_threads,
            1
        );
        for selected in selected_rows() {
            error(
                &[inherited.clone(), selected.clone()],
                "turn_inherited_observation_ownership",
            );
            error(
                &[child(), selected, inherited.clone()],
                "turn_inherited_observation_ownership",
            );
        }
    }
    // Equal-ID, single-header fork behavior is retained, not generalized to mixed history.
    assert_eq!(
        parse(&[copy(), start("turn"), end("turn", 7)])
            .daily_summary()
            .unclassified_terminal_turns,
        1
    );
}

#[test]
fn separate_history_evidence_cannot_bypass_missing_id_observation_flags() {
    let inherited = meta("child", None, json!({"forked_from_id":"parent"}));
    for selected in selected_rows() {
        let observed = parse(&[child(), selected]);
        let ancestry = parse(std::slice::from_ref(&inherited));
        for inputs in [[observed.clone(), ancestry.clone()], [ancestry, observed]] {
            assert_eq!(
                merge_turn_collections(&inputs).err().map(TurnError::code),
                Some("turn_inherited_observation_ownership")
            );
        }
    }
    // Shared-session knowledge itself may also arrive after the observations.
    let observations = parse(&[
        meta("child", None, json!({})),
        json!({"type":"token_usage_record"}),
    ]);
    let history = parse(&[inherited]);
    let shared = parse(&[child()]);
    for inputs in [
        [observations.clone(), history.clone(), shared.clone()],
        [observations.clone(), shared.clone(), history.clone()],
        [history.clone(), observations.clone(), shared.clone()],
        [history.clone(), shared.clone(), observations.clone()],
        [shared.clone(), history.clone(), observations.clone()],
        [shared, observations, history],
    ] {
        assert_eq!(
            merge_turn_collections(&inputs).err().map(TurnError::code),
            Some("turn_inherited_observation_ownership")
        );
    }
}

#[test]
fn excluded_child_retains_terminal_root_response_and_call_conflicts() {
    let mut cases = vec![(end("turn", 7), end("turn", 8))];
    let mut changed_root = start("turn");
    changed_root["payload"]["root_turn_id"] = json!("other");
    cases.push((start("turn"), changed_root));
    for field in ["thread_id", "session_id", "turn_id", "root_turn_id"] {
        let mut changed = token("child", 7);
        changed["payload"][field] = json!("other");
        cases.push((token("child", 7), changed));
    }
    cases.push((token("child", 7), token("child", 8)));
    cases.push((call("turn"), call("other")));
    let mut custom = call("turn");
    custom["payload"]["type"] = json!("custom_tool_call");
    cases.push((call("turn"), custom));
    for (a, b) in cases {
        error(
            &[child(), a.clone(), b.clone()],
            "turn_conflicting_evidence",
        );
        let a = parse(&[child(), a]);
        let b = parse(&[child(), b]);
        for inputs in [[a.clone(), b.clone()], [b, a]] {
            assert_eq!(
                merge_turn_collections(&inputs).err().map(TurnError::code),
                Some("turn_conflicting_evidence")
            );
        }
    }
    let mut disagree = token("child", 7);
    disagree["payload"]["root_turn_id"] = json!("other");
    error(
        &[child(), start("turn"), disagree],
        "turn_conflicting_evidence",
    );
}

#[test]
fn root_looking_copies_do_not_undo_sticky_child_exclusion() {
    let excluded = parse(&[child()]);
    let unknown = parse(&[
        meta("child", None, json!({})),
        start("turn"),
        end("turn", 7),
    ]);
    for inputs in [[excluded.clone(), unknown.clone()], [unknown, excluded]] {
        let summary = merge_turn_collections(&inputs).unwrap().daily_summary();
        assert!(summary.days.is_empty());
        assert_eq!(summary.excluded_threads, 1);
        assert_eq!(summary.unclassified_terminal_turns, 1);
    }
}

#[test]
fn exact_child_copies_deduplicate_evidence_without_resetting_raw_budgets() {
    let rows = [child(), start("turn"), end("turn", 7), call("turn")];
    let a = parse(&rows);
    let joined = merge_turn_collections(&[a.clone(), a.clone()]).unwrap();
    assert_eq!(joined.turns.len(), 1);
    let summary = joined.daily_summary();
    assert_eq!(
        (
            summary.sources_read,
            summary.lines_read,
            summary.raw_observations
        ),
        (2, 8, 6)
    );
    assert_eq!(summary.bytes_scanned, 2 * lines(&rows).len() as u64);
    assert_eq!(summary.excluded_threads, 1);
    assert_eq!(summary.unclassified_terminal_turns, 1);
}

#[test]
fn exclusion_preserves_selected_and_metadata_record_budgets() {
    let rows = [
        child(),
        json!({"type":"token_usage_record"}),
        child(),
        json!({"type":"token_usage_record"}),
    ];
    let limits = TurnReadLimits::new(MAX_SOURCE_BYTES, MAX_LINES, 1).unwrap();
    assert_eq!(
        parse_codex_turns_with_limits(Cursor::new(lines(&rows)), &KEY, limits)
            .err()
            .map(TurnError::code),
        Some("turn_observation_limit")
    );
    let metadata = [
        copy(),
        meta("ancestor-1", None, json!({})),
        meta("ancestor-2", None, json!({})),
    ];
    let text = lines(&metadata);
    let exact = TurnReadLimits::new(text.len() as u64, 3, 0).unwrap();
    assert_eq!(
        parse_codex_turns_with_limits(Cursor::new(&text), &KEY, exact)
            .unwrap()
            .daily_summary()
            .lines_read,
        3
    );
    for (bytes, records, expected) in [
        (text.len() as u64, 2, "turn_record_limit"),
        (text.len() as u64 - 1, 3, "turn_byte_limit"),
    ] {
        let limits = TurnReadLimits::new(bytes, records, 0).unwrap();
        assert_eq!(
            parse_codex_turns_with_limits(Cursor::new(&text), &KEY, limits)
                .err()
                .map(TurnError::code),
            Some(expected)
        );
    }
}

#[test]
fn excluded_child_keeps_the_full_raw_observation_ceiling() {
    let observation = "{\"type\":\"token_usage_record\"}\n";
    let mut text = lines(&[child()]);
    text.push_str(&observation.repeat(MAX_OBSERVATIONS as usize));
    let summary = parse_codex_turns(Cursor::new(&text), &KEY)
        .unwrap()
        .daily_summary();
    assert_eq!(summary.raw_observations, MAX_OBSERVATIONS);
    assert_eq!(summary.lines_read, MAX_OBSERVATIONS + 1);
    assert_eq!(summary.excluded_threads, 1);
    assert!(summary.days.is_empty());
    text.push_str(&lines(&[child()]));
    text.push_str(observation);
    assert_eq!(
        parse_codex_turns(Cursor::new(text), &KEY)
            .err()
            .map(TurnError::code),
        Some("turn_observation_limit")
    );
}

#[test]
fn partial_copied_observation_is_deferred_until_completed_lf() {
    let prefix = lines(&[copy(), meta("parent", Some("parent"), json!({}))]);
    let selected = start("turn").to_string();
    let text = format!("{prefix}{selected}");
    let summary = parse_codex_turns(Cursor::new(&text), &KEY)
        .unwrap()
        .daily_summary();
    assert!(summary.days.is_empty());
    assert_eq!(
        (
            summary.raw_observations,
            summary.partial_sources,
            summary.lines_read
        ),
        (0, 1, 3)
    );
    assert_eq!(
        parse_codex_turns(Cursor::new(format!("{text}\n")), &KEY)
            .err()
            .map(TurnError::code),
        Some("turn_inherited_observation_ownership")
    );
    let mut invalid_tail = prefix.into_bytes();
    invalid_tail.extend_from_slice(&[b'{', 0xff]);
    assert_eq!(
        parse_codex_turns(Cursor::new(invalid_tail), &KEY)
            .unwrap()
            .daily_summary()
            .partial_sources,
        1
    );
}

#[test]
fn ignored_nested_content_never_enters_summary_or_fixed_refusal() {
    let mut base = vec![child(), start("turn"), call("turn"), end("turn", 7)];
    let clean = parse(&base).daily_summary();
    base[0]["payload"]["cwd"] = json!("/PRIVATE_CANARY/path");
    base[0]["payload"]["source"] = json!({"subagent":{"nested":{"prompt":"PRIVATE_CANARY"}}});
    base[2]["payload"]["arguments"] =
        json!({"prompt":"PRIVATE_CANARY","result":["PRIVATE_CANARY"]});
    let summary = parse(&base).daily_summary();
    assert_eq!(summary.days, clean.days);
    assert_eq!(summary.diagnostics, clean.diagnostics);
    assert_eq!(summary.raw_observations, clean.raw_observations);
    assert!(!format!("{summary:?}").contains("PRIVATE_CANARY"));
    base[0]["payload"]["history_base"] =
        json!({"path":"/PRIVATE_CANARY/history","nested":[{"prompt":"PRIVATE_CANARY"}]});
    error(&base, "turn_inherited_observation_ownership");
}
