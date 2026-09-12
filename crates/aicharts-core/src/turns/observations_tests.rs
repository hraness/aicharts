use super::*;
use serde_json::{json, Value};
use std::io::Cursor;

const KEY: [u8; 32] = [23; 32];
fn meta() -> Value {
    json!({"type":"session_meta","payload":{"id":"thread","source":"cli","history_mode":"legacy"}})
}
fn start(turn: &str) -> Value {
    json!({"type":"event_msg","timestamp":"1970-01-01T23:59:59.123Z","payload":{"type":"task_started","turn_id":turn,"root_turn_id":turn,"started_at":86399}})
}
fn end(turn: &str, aborted: bool) -> Value {
    json!({"type":"event_msg","payload":{"type":if aborted {"turn_aborted"} else {"task_complete"},"turn_id":turn,"started_at":86399,"completed_at":86400,"duration_ms":1234}})
}
fn token(turn: &str, id: &str, total: Value) -> Value {
    json!({"type":"token_usage_record","payload":{"thread_id":"thread","session_id":"thread","turn_id":turn,"root_turn_id":turn,"response_id":id,"usage":{"total_tokens":total}}})
}
fn call(turn: &str, id: &str) -> Value {
    json!({"type":"response_item","payload":{"type":"function_call","call_id":id,"internal_chat_message_metadata_passthrough":{"turn_id":turn},"name":"NEVER_COPY_NAME","arguments":"NEVER_COPY_ARGUMENTS"}})
}
fn lines(rows: &[Value]) -> String {
    rows.iter().map(|row| format!("{row}\n")).collect()
}
fn parse(rows: &[Value]) -> TurnCollection {
    parse_text(&lines(rows)).unwrap()
}
fn parse_text(text: &str) -> Result<TurnCollection, TurnError> {
    parse_codex_turns(Cursor::new(text.as_bytes()), &KEY)
}
fn error(rows: &[Value]) -> Option<TurnError> {
    parse_text(&lines(rows)).err()
}
fn completed(collection: &TurnCollection) -> ObservedSubtotals {
    collection.daily_summary().days[0]
        .completed
        .observed_subtotals
        .clone()
}
fn fixture() -> Vec<Value> {
    vec![
        meta(),
        start("t1"),
        token("t1", "r1", json!(110)),
        call("t1", "c1"),
        end("t1", false),
    ]
}

#[test]
fn observed_subtotals_are_root_direct_and_keep_complete_measurements_unknown() {
    let collection = parse(&fixture());
    let summary = collection.daily_summary();
    assert_eq!(PROFILE_VERSION, 2);
    assert_eq!(summary.raw_observations, 4);
    assert_eq!(summary.days[0].utc_day, 1);
    assert_eq!(summary.days[0].completed.runtime_ms_sum, 1234);
    assert_eq!(
        completed(&collection),
        ObservedSubtotals {
            response_tokens: ObservedMetric {
                sum: 110,
                turns_with_evidence: 1,
                observations: 1
            },
            requested_calls: ObservedMetric {
                sum: 1,
                turns_with_evidence: 1,
                observations: 1
            },
        }
    );
    assert_eq!(summary.tokens, None);
    assert_eq!(summary.tool_calls, None);
    assert!(!summary.coverage_complete);
    assert!(summary
        .diagnostics
        .contains(&TurnDiagnostic::PartialObservations));
    assert!(summary.diagnostics.contains(&TurnDiagnostic::UnknownOrigin));
}

#[test]
fn missing_and_zero_are_different_evidence_with_separate_metric_denominators() {
    let mut no_total = token("t3", "r3", Value::Null);
    no_total["payload"]["usage"]
        .as_object_mut()
        .unwrap()
        .remove("total_tokens");
    let rows = vec![
        meta(),
        start("t1"),
        token("t1", "r1", json!(0)),
        end("t1", false),
        start("t2"),
        call("t2", "c2"),
        end("t2", false),
        start("t3"),
        no_total,
        end("t3", false),
    ];
    let collection = parse(&rows);
    assert_eq!(
        completed(&collection).response_tokens,
        ObservedMetric {
            sum: 0,
            turns_with_evidence: 1,
            observations: 1
        }
    );
    assert_eq!(
        completed(&collection).requested_calls,
        ObservedMetric {
            sum: 1,
            turns_with_evidence: 1,
            observations: 1
        }
    );
    assert_eq!(
        collection.daily_summary().days[0].completed.observed_turns,
        3
    );
    assert!(collection
        .daily_summary()
        .diagnostics
        .contains(&TurnDiagnostic::MissingResponseTotal));
}

#[test]
fn weighted_turn_denominator_is_not_response_count_or_average_of_file_means() {
    let a = parse(&[
        meta(),
        start("t1"),
        token("t1", "r1", json!(80)),
        token("t1", "r2", json!(20)),
        end("t1", false),
    ]);
    let b = parse(&[
        meta(),
        start("t2"),
        token("t2", "r3", json!(5)),
        end("t2", false),
        start("t3"),
        token("t3", "r4", json!(5)),
        end("t3", false),
    ]);
    let joined = merge_turn_collections(&[a, b]).unwrap();
    assert_eq!(
        completed(&joined).response_tokens,
        ObservedMetric {
            sum: 110,
            turns_with_evidence: 3,
            observations: 4
        }
    );
}

#[test]
fn aborted_open_and_undated_work_never_enters_completed_subtotal_mean() {
    let mut undated = end("undated", false);
    undated["payload"]
        .as_object_mut()
        .unwrap()
        .remove("completed_at");
    let rows = vec![
        meta(),
        start("done"),
        token("done", "r1", json!(3)),
        end("done", false),
        start("aborted"),
        token("aborted", "r2", json!(7)),
        call("aborted", "c2"),
        end("aborted", true),
        start("open"),
        token("open", "r3", json!(11)),
        start("undated"),
        token("undated", "r4", json!(13)),
        undated,
    ];
    let result = parse(&rows).daily_summary();
    assert_eq!(
        result.days[0]
            .completed
            .observed_subtotals
            .response_tokens
            .sum,
        3
    );
    assert_eq!(
        result.days[0]
            .aborted
            .observed_subtotals
            .response_tokens
            .sum,
        7
    );
    assert_eq!(
        result.days[0]
            .aborted
            .observed_subtotals
            .requested_calls
            .sum,
        1
    );
    assert_eq!(result.undated_root_turns, 1);
}

#[test]
fn exact_copies_deduplicate_but_consume_the_combined_raw_budget() {
    let a = parse(&fixture());
    let joined = merge_turn_collections(&[a.clone(), a]).unwrap();
    assert_eq!(completed(&joined).response_tokens.sum, 110);
    assert_eq!(completed(&joined).requested_calls.sum, 1);
    assert_eq!(joined.daily_summary().raw_observations, 8);
}

#[test]
fn same_response_identity_cannot_change_any_selected_binding_even_when_filtered() {
    for field in ["thread_id", "session_id", "turn_id", "root_turn_id"] {
        let mut second = token("t1", "r1", json!(110));
        second["payload"][field] = json!("different");
        let first = parse(&fixture());
        let mut excluded = meta();
        excluded["payload"]["source"] = json!({"subagent":"review"});
        let later = parse(&[meta(), second, excluded]);
        assert_eq!(
            merge_turn_collections(&[first, later]).err(),
            Some(TurnError::ConflictingEvidence),
            "{field}"
        );
    }
    for total in [Value::Null, json!(111)] {
        assert_eq!(
            error(&[
                meta(),
                token("t1", "r1", json!(110)),
                token("t1", "r1", total)
            ]),
            Some(TurnError::ConflictingEvidence)
        );
    }
}

#[test]
fn missing_binding_cannot_be_repaired_by_a_better_duplicate() {
    for field in ["thread_id", "session_id", "turn_id", "root_turn_id"] {
        let mut incomplete = token("t1", "r1", json!(110));
        incomplete["payload"].as_object_mut().unwrap().remove(field);
        let a = parse(&[meta(), incomplete]);
        let b = parse(&[meta(), token("t1", "r1", json!(110))]);
        assert_eq!(
            merge_turn_collections(&[a, b]).err(),
            Some(TurnError::ConflictingEvidence)
        );
    }
    let mut no_owner = call("t1", "c1");
    no_owner["payload"]
        .as_object_mut()
        .unwrap()
        .remove("internal_chat_message_metadata_passthrough");
    assert_eq!(
        error(&[meta(), no_owner, call("t1", "c1")]),
        Some(TurnError::ConflictingEvidence)
    );
}

#[test]
fn usage_and_lifecycle_root_conflicts_are_checked_after_cross_file_join() {
    let a = parse(&[meta(), start("t1"), end("t1", false)]);
    let mut other = token("t1", "r1", json!(1));
    other["payload"]["root_turn_id"] = json!("other-root");
    let b = parse(&[meta(), other]);
    assert_eq!(
        merge_turn_collections(&[a, b]).err(),
        Some(TurnError::ConflictingEvidence)
    );
}

#[test]
fn supported_call_identity_table_has_no_double_id_or_legacy_fallback() {
    let mut rows = vec![meta(), start("t1")];
    for (n, kind) in [
        "function_call",
        "custom_tool_call",
        "local_shell_call",
        "tool_search_call",
        "web_search_call",
        "image_generation_call",
    ]
    .iter()
    .enumerate()
    {
        let mut row = call("t1", &format!("c{n}"));
        row["payload"]["type"] = json!(kind);
        row["payload"]["id"] = json!(format!("item{n}"));
        rows.push(row.clone());
        rows.push(row);
    }
    for kind in ["local_shell_call", "tool_search_call"] {
        let mut row = call("t1", "unused");
        row["payload"]["type"] = json!(kind);
        row["payload"]["id"] = json!("legacy-id");
        row["payload"].as_object_mut().unwrap().remove("call_id");
        rows.push(row);
    }
    rows.push(end("t1", false));
    let result = parse(&rows);
    assert_eq!(
        completed(&result).requested_calls,
        ObservedMetric {
            sum: 6,
            turns_with_evidence: 1,
            observations: 6
        }
    );
    assert!(result
        .daily_summary()
        .diagnostics
        .contains(&TurnDiagnostic::UnownedCall));
}

#[test]
fn cross_kind_or_cross_turn_call_identity_is_a_conflict_not_an_extra_call() {
    for (field, value) in [("type", "custom_tool_call"), ("turn", "t2")] {
        let mut second = call("t1", "c1");
        if field == "type" {
            second["payload"][field] = json!(value);
        } else {
            second["payload"]["internal_chat_message_metadata_passthrough"]["turn_id"] =
                json!(value);
        }
        assert_eq!(
            error(&[meta(), call("t1", "c1"), second]),
            Some(TurnError::ConflictingEvidence)
        );
    }
}

#[test]
fn cumulative_counts_outputs_and_compaction_snapshots_do_not_duplicate_observations() {
    let usage = token("t1", "r1", json!(110));
    let mut rows = fixture();
    rows.push(json!({"type":"compacted","payload":{"latest_token_usage_record":usage["payload"],"replacement_history":[call("t1","other")["payload"]]}}));
    rows.push(json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":99999}}}}));
    rows.push(json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":0}}}}));
    rows.push(json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":"NEVER_COPY_OUTPUT"}}));
    rows.push(json!({"type":"event_msg","payload":{"type":"item_completed","thread_id":"thread","turn_id":"t1","item":{"type":"CommandExecution","id":"c1","source":"user_shell","status":"completed"}}}));
    rows.push(json!({"type":"event_msg","payload":{"type":"thread_rolled_back","num_turns":1}}));
    assert_eq!(completed(&parse(&rows)), completed(&parse(&fixture())));
}

#[test]
fn recovery_and_compaction_response_ids_stay_on_one_logical_turn() {
    let mut rows = fixture();
    let mut resumed = start("t1");
    resumed["timestamp"] = json!("1970-01-02T00:00:00.456Z");
    rows.push(resumed);
    rows.push(token("t1", "compaction-response", json!(5)));
    let result = parse(&rows).daily_summary();
    assert_eq!(result.days[0].completed.observed_turns, 1);
    assert_eq!(result.days[0].completed.runtime_eligible_turns, 0);
    assert_eq!(
        result.days[0].completed.observed_subtotals.response_tokens,
        ObservedMetric {
            sum: 115,
            turns_with_evidence: 1,
            observations: 2
        }
    );
}

#[test]
fn source_and_root_exclusions_remain_after_observation_merge() {
    for field in ["forked_from_id", "parent_thread_id"] {
        let first = parse(&fixture());
        let mut marker = meta();
        marker["payload"][field] = json!("parent");
        let joined = merge_turn_collections(&[first, parse(&[marker])]).unwrap();
        assert!(joined.daily_summary().days.is_empty());
    }
    let mut rows = fixture();
    rows[1]["payload"]["root_turn_id"] = json!("parent-turn");
    rows[2]["payload"]["root_turn_id"] = json!("parent-turn");
    assert!(parse(&rows).daily_summary().days.is_empty());
}

#[test]
fn missing_ownership_does_not_use_order_role_or_current_turn() {
    let mut usage = token("t1", "r1", json!(3));
    usage["payload"].as_object_mut().unwrap().remove("turn_id");
    let mut request = call("t1", "c1");
    request["payload"]
        .as_object_mut()
        .unwrap()
        .remove("internal_chat_message_metadata_passthrough");
    let result = parse(&[
        meta(),
        start("t1"),
        usage,
        request,
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":"NEVER_COPY_USER"}}),
        end("t1", false),
    ]);
    assert_eq!(completed(&result), ObservedSubtotals::default());
    for d in [
        TurnDiagnostic::UnownedUsage,
        TurnDiagnostic::UnownedCall,
        TurnDiagnostic::UnknownOrigin,
    ] {
        assert!(result.daily_summary().diagnostics.contains(&d));
    }
}

#[test]
fn explicit_wrong_thread_or_session_is_unowned_not_implicitly_rebound() {
    for field in ["thread_id", "session_id"] {
        let mut usage = token("t1", "r1", json!(3));
        usage["payload"][field] = json!("different");
        let result = parse(&[meta(), start("t1"), usage, end("t1", false)]);
        assert_eq!(completed(&result), ObservedSubtotals::default());
        assert!(result
            .daily_summary()
            .diagnostics
            .contains(&TurnDiagnostic::UnownedUsage));
    }
}

#[test]
fn response_and_call_identity_namespaces_are_scoped_to_the_file_thread() {
    let a = parse(&fixture());
    let mut rows = fixture();
    rows[0]["payload"]["id"] = json!("second-thread");
    rows[2]["payload"]["thread_id"] = json!("second-thread");
    rows[2]["payload"]["session_id"] = json!("second-thread");
    rows[2]["payload"]["usage"]["total_tokens"] = json!(7);
    let joined = merge_turn_collections(&[a, parse(&rows)]).unwrap();
    assert_eq!(
        completed(&joined).response_tokens,
        ObservedMetric {
            sum: 117,
            turns_with_evidence: 2,
            observations: 2
        }
    );
    assert_eq!(
        completed(&joined).requested_calls,
        ObservedMetric {
            sum: 2,
            turns_with_evidence: 2,
            observations: 2
        }
    );
}

#[test]
fn missing_null_and_unknown_shapes_never_invent_zero_evidence() {
    let mut rows = vec![meta(), start("t1")];
    for (index, value) in [Value::Null, json!({}), json!({"total_tokens":null})]
        .into_iter()
        .enumerate()
    {
        let mut row = token("t1", &format!("r{index}"), json!(0));
        row["payload"]["usage"] = value;
        rows.push(row);
    }
    let mut no_usage = token("t1", "missing", json!(0));
    no_usage["payload"].as_object_mut().unwrap().remove("usage");
    rows.push(no_usage);
    rows.push(
        json!({"type":"response_item","payload":{"type":"future_private_variant","body":"CANARY"}}),
    );
    rows.push(json!({"type":"response_item","payload":null}));
    rows.push(end("t1", false));
    let result = parse(&rows);
    assert_eq!(completed(&result), ObservedSubtotals::default());
    assert_eq!(result.daily_summary().raw_observations, 6);
    assert!(result
        .daily_summary()
        .diagnostics
        .contains(&TurnDiagnostic::MissingResponseTotal));
    assert!(result
        .daily_summary()
        .diagnostics
        .contains(&TurnDiagnostic::UnsupportedResponseItem));
}

#[test]
fn all_selected_numeric_and_object_shapes_fail_closed_without_echoes() {
    for value in [
        json!(-1),
        json!(1.5),
        json!("1"),
        json!(true),
        json!([]),
        json!({}),
        json!(1_000_000_000_001u64),
    ] {
        assert_eq!(
            error(&[meta(), token("t1", "r1", value)]),
            Some(TurnError::MalformedRecord)
        );
    }
    for value in [json!("PRIVATE_CANARY"), json!(true), json!(1), json!([])] {
        let mut row = token("t1", "r1", json!(0));
        row["payload"]["usage"] = value.clone();
        assert_eq!(error(&[meta(), row]), Some(TurnError::MalformedRecord));
        let mut row = call("t1", "c1");
        row["payload"]["internal_chat_message_metadata_passthrough"] = value;
        assert_eq!(error(&[meta(), row]), Some(TurnError::MalformedRecord));
    }
    for field in [
        "thread_id",
        "session_id",
        "turn_id",
        "root_turn_id",
        "response_id",
    ] {
        for value in [
            json!(5),
            json!({}),
            json!("CANARY/invalid"),
            json!("x".repeat(257)),
        ] {
            let mut row = token("t1", "r1", json!(0));
            row["payload"][field] = value;
            assert_eq!(error(&[meta(), row]), Some(TurnError::MalformedRecord));
        }
    }
    for value in [json!(true), json!(2), json!("CANARY"), json!([])] {
        assert_eq!(
            error(&[json!({"type":"response_item","payload":value})]),
            Some(TurnError::MalformedRecord)
        );
    }
    for row in [
        r#"{"type":"token_usage_record","payload":{"usage":{"total_tokens":1,"total_tokens":1}}}"#,
        r#"{"type":"token_usage_record","payload":{"response_id":"r","response_id":"r"}}"#,
        r#"{"type":"response_item","payload":{"type":"function_call","call_id":"c","call_id":"c"}}"#,
        r#"{"type":"response_item","payload":{"type":"function_call","internal_chat_message_metadata_passthrough":{"turn_id":"t1","turn_id":"t1"}}}"#,
    ] {
        assert_eq!(
            parse_text(&format!("{}\n{row}\n", meta())).err(),
            Some(TurnError::MalformedRecord)
        );
    }
}

#[test]
fn no_lf_observations_are_deferred_and_malformed_completed_rows_fail() {
    let mut text = lines(&[meta(), start("t1"), end("t1", false)]);
    text.push_str(&token("t1", "r1", json!(3)).to_string());
    let result = parse_text(&text).unwrap();
    assert_eq!(completed(&result), ObservedSubtotals::default());
    assert_eq!(result.daily_summary().partial_sources, 1);
    text.push('\n');
    assert_eq!(
        completed(&parse_text(&text).unwrap()).response_tokens.sum,
        3
    );
    text.push_str("{bad}\n");
    assert_eq!(parse_text(&text).err(), Some(TurnError::MalformedRecord));
}

#[test]
fn combined_remaining_budget_charges_incomplete_known_observations_before_dedup() {
    let rows = vec![
        meta(),
        json!({"type":"token_usage_record"}),
        json!({"type":"response_item","payload":{"type":"function_call"}}),
        start("t1"),
        end("t1", false),
    ];
    let exact = parse_codex_turns_with_limits(
        Cursor::new(lines(&rows)),
        &KEY,
        TurnReadLimits::new(MAX_SOURCE_BYTES, MAX_LINES, 4).unwrap(),
    )
    .unwrap();
    assert_eq!(exact.daily_summary().raw_observations, 4);
    let error = parse_codex_turns_with_limits(
        Cursor::new(lines(&rows)),
        &KEY,
        TurnReadLimits::new(MAX_SOURCE_BYTES, MAX_LINES, 3).unwrap(),
    )
    .err();
    assert_eq!(error, Some(TurnError::ObservationLimit));
}

#[test]
fn full_raw_boundary_and_large_exact_sum_do_not_overflow_or_round() {
    let mut rows = vec![meta(), start("t1"), end("t1", false)];
    for i in 0..MAX_OBSERVATIONS - 2 {
        rows.push(token("t1", &format!("r{i}"), json!(1_000_000_000_000u64)));
    }
    let result = parse(&rows);
    assert_eq!(result.daily_summary().raw_observations, MAX_OBSERVATIONS);
    assert_eq!(
        completed(&result).response_tokens.sum,
        (MAX_OBSERVATIONS - 2) * 1_000_000_000_000
    );
    rows.push(token("t1", "excess", json!(0)));
    assert_eq!(error(&rows), Some(TurnError::ObservationLimit));
}

#[test]
fn seeded_privacy_and_merge_laws_preserve_only_selected_evidence() {
    for seed in 0..128u64 {
        let a = parse(&fixture());
        let mut rows = fixture();
        rows[2]["payload"]["turn_token_usage"] =
            json!({"total_tokens":seed,"private":"CANARY_CUMULATIVE"});
        rows[3]["payload"]["arguments"] =
            json!({"prompt":format!("CANARY_{seed}"),"nested":[seed,{"path":"/PRIVATE_CANARY"}]});
        rows[3]["payload"]["name"] = json!(format!("CANARY_TOOL_{seed}"));
        rows[3]["payload"]["internal_chat_message_metadata_passthrough"]["executed_tool_calls"] =
            json!([{"name":"CANARY_NESTED","arguments":"secret"}]);
        rows[3]["payload"]["internal_chat_message_metadata_passthrough"]["tool_calls_complete"] =
            json!(true);
        let b = parse(&rows);
        let c = parse(&[
            meta(),
            start("t2"),
            token("t2", "r2", json!(seed)),
            end("t2", false),
        ]);
        assert_eq!(completed(&a), completed(&b));
        let left = merge_turn_collections(&[
            merge_turn_collections(&[a.clone(), b.clone()]).unwrap(),
            c.clone(),
        ])
        .unwrap();
        let right = merge_turn_collections(&[a, merge_turn_collections(&[c, b]).unwrap()]).unwrap();
        assert_eq!(left.daily_summary(), right.daily_summary());
        assert!(!format!("{:?}", left.daily_summary()).contains("CANARY"));
    }
}
