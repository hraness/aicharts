use super::*;
use aicharts_protocol::{encode, Policy, Registry};
use std::io::{self, BufReader, Cursor, Read};

const KEY: [u8; 32] = [7; 32];

fn parse(source: &str, provider: Provider) -> Collection {
    parse_reader(Cursor::new(source.as_bytes()), provider, &KEY).unwrap()
}

fn packets(collection: &Collection) -> Vec<Vec<u8>> {
    let registry = Registry {
        revision: 1,
        models: vec![],
    };
    let policy = Policy {
        first_day: 0,
        last_day: u32::MAX,
        registry: &registry,
    };
    collection
        .batches
        .iter()
        .map(|batch| encode(batch, &policy).unwrap())
        .collect()
}

fn codex_row(
    second: u32,
    input: u64,
    cached: u64,
    output: u64,
    reasoning: u64,
    last: bool,
) -> String {
    let usage = format!(
        r#"{{"input_tokens":{input},"cached_input_tokens":{cached},"output_tokens":{output},"reasoning_output_tokens":{reasoning}}}"#
    );
    let last = if last {
        format!(r#", "last_token_usage":{usage}"#)
    } else {
        String::new()
    };
    format!(
        r#"{{"type":"event_msg","timestamp":"2026-09-10T10:00:{second:02}Z","payload":{{"type":"token_count","turn_id":"turn-1","info":{{"total_token_usage":{usage}{last}}}}}}}"#
    )
}

fn codex_source(rows: &[String]) -> String {
    format!(
        "{}\n{}\n",
        r#"{"type":"session_meta","payload":{"id":"session-1"}}"#,
        rows.join("\n")
    )
}

fn claude_row(request: &str, input: u64, output: u64, seconds: u32) -> String {
    format!(
        r#"{{"type":"assistant","timestamp":"2026-09-10T10:00:{seconds:02}Z","sessionId":"session-1","requestId":"{request}","message":{{"id":"message-1","usage":{{"input_tokens":{input},"output_tokens":{output},"cache_read_input_tokens":3,"cache_creation_input_tokens":0}}}}}}"#
    )
}

#[test]
fn codex_uses_first_last_usage_then_disjoint_cumulative_deltas() {
    let collection = parse(
        &codex_source(&[
            codex_row(1, 10, 5, 4, 2, true),
            codex_row(2, 30, 9, 12, 3, false),
            codex_row(3, 30, 9, 12, 3, false),
        ]),
        Provider::Codex,
    );
    assert_eq!(collection.batches.len(), 1);
    let usage = &collection.batches[0].usage;
    assert_eq!(usage.len(), 2);
    assert_eq!(
        usage.iter().map(|v| v.tokens.input_uncached).sum::<u64>(),
        21
    );
    assert_eq!(usage.iter().map(|v| v.tokens.cache_read).sum::<u64>(), 9);
    assert_eq!(usage.iter().map(|v| v.tokens.output).sum::<u64>(), 12);
    assert_eq!(
        usage.iter().map(|v| v.tokens.reasoning_output).sum::<u64>(),
        3
    );
    assert!(!collection
        .warnings
        .contains(&Warning::CodexInitialBaselineOmitted));
    assert!(collection.warnings.contains(&Warning::UnknownModels));
    assert!(collection
        .batches
        .iter()
        .all(|v| v.intervals.is_empty() && v.prompts.is_empty()));
    packets(&collection);
}

#[test]
fn first_cumulative_without_last_is_a_baseline_not_a_request() {
    let source = codex_source(&[
        codex_row(1, 50, 5, 10, 0, false),
        codex_row(2, 60, 5, 15, 0, false),
    ]);
    let collection = parse(&source, Provider::Codex);
    assert_eq!(collection.batches[0].usage.len(), 1);
    assert_eq!(collection.batches[0].usage[0].tokens.input_uncached, 10);
    assert!(collection
        .warnings
        .contains(&Warning::CodexInitialBaselineOmitted));
}

#[test]
fn first_last_usage_does_not_claim_unobserved_cumulative_history() {
    let source = r#"{"type":"session_meta","payload":{"id":"session-1"}}
{"type":"event_msg","timestamp":"2026-09-10T10:00:01Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"output_tokens":500},"last_token_usage":{"input_tokens":10,"output_tokens":5}}}}
"#;
    let collection = parse(source, Provider::Codex);
    assert_eq!(collection.batches[0].usage[0].tokens.input_uncached, 10);
    assert!(collection
        .warnings
        .contains(&Warning::CodexInitialBaselineOmitted));
}

#[test]
fn regressed_codex_counters_stop_the_chain_without_guessing_a_reset() {
    let collection = parse(
        &codex_source(&[
            codex_row(1, 50, 5, 10, 0, true),
            codex_row(2, 40, 4, 9, 0, true),
            codex_row(3, 80, 8, 20, 0, true),
        ]),
        Provider::Codex,
    );
    assert_eq!(collection.batches[0].usage.len(), 1);
    assert!(collection
        .warnings
        .contains(&Warning::CodexCumulativeRegression));
}

#[test]
fn declared_fork_discards_replayed_usage_even_if_metadata_arrives_late() {
    let source = format!(
        "{}{}\n{}",
        codex_source(&[codex_row(1, 10, 0, 5, 0, true)]),
        r#"{"type":"session_meta","payload":{"id":"child-1","forked_from_id":"parent-1"}}"#,
        codex_row(2, 20, 0, 10, 0, true)
    );
    let collection = parse(&source, Provider::Codex);
    assert!(collection.batches.is_empty());
    assert!(collection.warnings.contains(&Warning::CodexForkUnsupported));
}

#[test]
fn changed_session_identity_fails_with_fixed_code() {
    let source = r#"{"type":"session_meta","payload":{"id":"session-1"}}
{"type":"session_meta","payload":{"id":"session-2"}}"#;
    assert_eq!(
        parse_reader(Cursor::new(source), Provider::Codex, &KEY).unwrap_err(),
        Error::SessionIdentityChanged
    );
}

#[test]
fn missing_session_identity_is_explicit_and_not_path_derived() {
    let collection = parse(&codex_row(1, 10, 0, 5, 0, true), Provider::Codex);
    assert!(collection.batches.is_empty());
    assert!(collection.warnings.contains(&Warning::MissingIdentity));
}

#[test]
fn malformed_counters_are_rejected_instead_of_clamped() {
    for source in [
        codex_source(&[codex_row(1, 3, 9, 2, 0, true)]),
        codex_source(&[codex_row(1, 3, 0, 2, 9, true)]),
        codex_source(&[codex_row(1, TOKEN_LIMIT + 1, 0, 2, 0, true)]),
    ] {
        assert_eq!(
            parse_reader(Cursor::new(source), Provider::Codex, &KEY).unwrap_err(),
            Error::InvalidCounters
        );
    }
}

#[test]
fn claude_streaming_revisions_and_reversed_duplicates_keep_one_final_usage() {
    for rows in [
        vec![
            claude_row("request-1", 10, 2, 1),
            claude_row("request-1", 10, 8, 3),
        ],
        vec![
            claude_row("request-1", 10, 8, 3),
            claude_row("request-1", 10, 2, 1),
        ],
    ] {
        let collection = parse(&rows.join("\n"), Provider::ClaudeCode);
        assert_eq!(collection.batches[0].usage.len(), 1);
        assert_eq!(collection.batches[0].usage[0].tokens.output, 8);
        assert_eq!(collection.batches[0].usage[0].offset_ms, 36_003_000);
        packets(&collection);
    }
}

#[test]
fn incomparable_claude_revisions_require_an_explicit_correction() {
    let source = [
        claude_row("request-1", 10, 2, 1),
        claude_row("request-1", 5, 8, 3),
    ]
    .join("\n");
    assert_eq!(
        parse_reader(Cursor::new(source), Provider::ClaudeCode, &KEY).unwrap_err(),
        Error::ConflictingOccurrence
    );
}

#[test]
fn distinct_requests_are_not_collapsed_by_equal_message_ids() {
    let collection = parse(
        &[
            claude_row("request-1", 10, 2, 1),
            claude_row("request-2", 10, 2, 2),
        ]
        .join("\n"),
        Provider::ClaudeCode,
    );
    assert_eq!(collection.batches[0].usage.len(), 2);
}

#[test]
fn non_target_message_and_payload_shapes_are_skipped_without_retaining_content() {
    for metadata in [
        "\"private-text\"",
        "[\"private-text\",{\"content\":\"private-text\"}]",
        "null",
        "42",
        "true",
    ] {
        let claude = format!(
            "{{\"type\":\"system\",\"message\":{metadata}}}\n{}",
            claude_row("request-1", 10, 2, 1)
        );
        assert_eq!(
            packets(&parse(&claude, Provider::ClaudeCode)),
            packets(&parse(
                &claude_row("request-1", 10, 2, 1),
                Provider::ClaudeCode
            ))
        );
        let codex = format!(
            "{{\"type\":\"unsupported\",\"payload\":{metadata}}}\n{}",
            codex_source(&[codex_row(1, 10, 0, 5, 0, true)])
        );
        assert_eq!(parse(&codex, Provider::Codex).batches[0].usage.len(), 1);
    }
}

#[test]
fn codex_optional_turn_metadata_does_not_change_occurrence_identity() {
    let source = codex_source(&[codex_row(1, 10, 0, 5, 0, true)]);
    let alternate = source.replace("\"turn_id\":\"turn-1\",", "");
    let merged = merge_collections(vec![
        parse(&source, Provider::Codex),
        parse(&alternate, Provider::Codex),
    ])
    .unwrap();
    assert_eq!(merged.batches[0].usage.len(), 1);
}

#[test]
fn ambiguous_same_timestamp_codex_deltas_fail_instead_of_double_counting() {
    let source = codex_source(&[
        codex_row(1, 10, 0, 5, 0, true),
        codex_row(1, 30, 0, 15, 0, false),
    ]);
    assert_eq!(
        parse_reader(Cursor::new(source), Provider::Codex, &KEY).unwrap_err(),
        Error::ConflictingOccurrence
    );
}

#[test]
fn copied_files_and_cross_file_claude_revisions_merge_once() {
    let source = codex_source(&[
        codex_row(1, 10, 0, 5, 0, true),
        codex_row(2, 20, 0, 10, 0, false),
    ]);
    let original = parse(&source, Provider::Codex);
    let expected = packets(&original);
    let merged = merge_collections(vec![original, parse(&source, Provider::Codex)]).unwrap();
    assert_eq!(packets(&merged), expected);
    assert_eq!(merged.lines_read, 6);
    let merged = merge_collections(vec![
        parse(&claude_row("request-1", 10, 2, 1), Provider::ClaudeCode),
        parse(&claude_row("request-1", 10, 8, 3), Provider::ClaudeCode),
    ])
    .unwrap();
    assert_eq!(merged.batches[0].usage.len(), 1);
    assert_eq!(merged.batches[0].usage[0].tokens.output, 8);
}

#[test]
fn claude_cache_creation_preserves_ttl_and_refuses_unknown_split() {
    let source = r#"{"type":"assistant","timestamp":"2026-09-10T10:00:01Z","requestId":"request-1","message":{"id":"message-1","usage":{"input_tokens":10,"output_tokens":2,"cache_read_input_tokens":3,"cache_creation_input_tokens":12,"cache_creation":{"ephemeral_5m_input_tokens":7,"ephemeral_1h_input_tokens":5}}}}"#;
    let collection = parse(source, Provider::ClaudeCode);
    assert_eq!(
        values(&collection.batches[0].usage[0].tokens),
        [10, 3, 7, 5, 2, 0]
    );
    assert!(collection.warnings.contains(&Warning::UnknownExecution));
    let mut value: serde_json::Value = serde_json::from_str(source).unwrap();
    value["message"]["usage"]
        .as_object_mut()
        .unwrap()
        .remove("cache_creation");
    let collection = parse(&value.to_string(), Provider::ClaudeCode);
    assert!(collection.batches.is_empty());
    assert!(collection
        .warnings
        .contains(&Warning::ClaudeCacheTtlUnknown));
}

#[test]
fn unidentifiable_claude_usage_is_classified_and_never_content_hashed() {
    let source = r#"{"type":"assistant","timestamp":"2026-09-10T10:00:01Z","message":{"content":"private-placeholder","usage":{"input_tokens":10,"output_tokens":2}}}"#;
    let collection = parse(source, Provider::ClaudeCode);
    assert!(collection.batches.is_empty());
    assert!(collection.warnings.contains(&Warning::MissingIdentity));
}

#[test]
fn content_and_model_substitutions_do_not_change_wire_bytes() {
    let source = claude_row("request-1", 10, 2, 1);
    let mut value: serde_json::Value = serde_json::from_str(&source).unwrap();
    let expected = packets(&parse(&source, Provider::ClaudeCode));
    for content in [
        "",
        "private-marker-do-not-export",
        "秘密\n\"quoted\"",
        &"long-content".repeat(4096),
    ] {
        value["message"]["content"] = serde_json::json!([{"type":"text","text":content},{"type":"tool_use","name":content,"input":{"args":content}}]);
        value["message"]["model"] = content.into();
        value["cwd"] = content.into();
        value["title"] = content.into();
        value["prompt"] = content.into();
        value["system"] = content.into();
        let collection = parse(&value.to_string(), Provider::ClaudeCode);
        assert_eq!(packets(&collection), expected);
    }
    let codex = codex_source(&[codex_row(1, 10, 0, 5, 0, true)]);
    let expected = packets(&parse(&codex, Provider::Codex));
    let modified = codex.replace("\"id\":\"session-1\"", "\"id\":\"session-1\",\"cwd\":\"private-path\",\"source\":{\"prompt\":\"private-prompt\"}")
        .replace("\"type\":\"token_count\"", "\"type\":\"token_count\",\"message\":\"private-message\",\"model\":\"secret-model\"");
    assert_eq!(packets(&parse(&modified, Provider::Codex)), expected);
}

#[test]
fn namespace_key_changes_ids_but_not_numeric_measurements() {
    let source = claude_row("request-1", 10, 2, 1);
    let first = parse(&source, Provider::ClaudeCode);
    let second = parse_reader(Cursor::new(source), Provider::ClaudeCode, &[8; 32]).unwrap();
    assert_ne!(first.batches[0].usage[0].id, second.batches[0].usage[0].id);
    assert_ne!(
        first.batches[0].usage[0].execution_id,
        second.batches[0].usage[0].execution_id
    );
    assert_eq!(
        values(&first.batches[0].usage[0].tokens),
        values(&second.batches[0].usage[0].tokens)
    );
}

#[test]
fn unknown_strings_with_brackets_and_escapes_do_not_affect_depth() {
    let mut value: serde_json::Value =
        serde_json::from_str(&claude_row("request-1", 10, 2, 1)).unwrap();
    value["content"] = "[\\\"{}]".repeat(256).into();
    assert_eq!(
        parse(&value.to_string(), Provider::ClaudeCode)
            .batches
            .len(),
        1
    );
}

#[test]
fn deep_unknown_values_fail_before_recursion_or_reflection() {
    let source = format!(
        "{{\"secret\":{}{}}}",
        "[".repeat(MAX_DEPTH),
        "]".repeat(MAX_DEPTH)
    );
    let error = parse_reader(Cursor::new(source), Provider::ClaudeCode, &KEY).unwrap_err();
    assert_eq!(error, Error::TooDeep);
    assert_eq!(error.to_string(), "record_too_deep");
}

#[test]
fn oversized_unknown_string_fails_without_a_line_sized_copy() {
    let source = format!("{{\"private\":\"{}\"}}", "x".repeat(MAX_LINE_BYTES));
    assert_eq!(
        parse_reader(Cursor::new(source), Provider::ClaudeCode, &KEY).unwrap_err(),
        Error::LineTooLarge
    );
}

#[test]
fn malformed_input_and_reader_failures_never_reflect_private_values() {
    for source in [
        "{\"private-marker\":",
        "{\"requestId\":\"not a valid native id\"}",
        "{} {}",
        "{\"type\":true}",
    ] {
        assert_eq!(
            parse_reader(Cursor::new(source), Provider::ClaudeCode, &KEY)
                .unwrap_err()
                .to_string(),
            "malformed_record"
        );
    }
    struct Broken;
    impl Read for Broken {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::other("private-path"))
        }
    }
    assert_eq!(
        parse_reader(BufReader::new(Broken), Provider::ClaudeCode, &KEY)
            .unwrap_err()
            .to_string(),
        "read_failed"
    );
}

#[test]
fn physical_lines_are_bounded_and_blank_lines_are_counted() {
    let source = format!("\n  \r\n{}\r\n\n", claude_row("request-1", 10, 2, 1));
    let collection = parse(&source, Provider::ClaudeCode);
    assert_eq!(collection.lines_read, 4);
    assert_eq!(collection.batches[0].usage.len(), 1);
    assert_eq!(
        parse_reader(
            Cursor::new("\n".repeat(MAX_LINES as usize + 1)),
            Provider::ClaudeCode,
            &KEY
        )
        .unwrap_err(),
        Error::RecordLimit
    );
}

#[test]
fn utc_timestamps_and_midnight_streaming_revision_choose_one_day() {
    let source = [
        claude_row("request-1", 10, 2, 1).replace("2026-09-10T10:00:01Z", "2026-09-10T23:59:59Z"),
        claude_row("request-1", 10, 8, 3).replace("2026-09-10T10:00:03Z", "2026-09-11T00:00:01Z"),
    ]
    .join("\n");
    let collection = parse(&source, Provider::ClaudeCode);
    assert_eq!(collection.batches.len(), 1);
    assert_eq!(collection.batches[0].usage[0].offset_ms, 1000);
    assert_eq!(collection.batches[0].usage[0].tokens.output, 8);
}

#[test]
fn missing_and_invalid_timestamps_remain_unmeasured() {
    for source in [
        claude_row("request-1", 10, 2, 1)
            .replace("2026-09-10T10:00:01Z", "1969-12-31T23:59:59.999999999Z"),
        claude_row("request-1", 10, 2, 1).replace("2026-09-10T10:00:01Z", "invalid"),
        claude_row("request-1", 10, 2, 1).replace("\"timestamp\":\"2026-09-10T10:00:01Z\",", ""),
    ] {
        let collection = parse(&source, Provider::ClaudeCode);
        assert!(collection.batches.is_empty());
        assert!(collection.warnings.contains(&Warning::MissingTimestamp));
    }
}

#[test]
fn per_day_batches_split_at_protocol_limit_and_remain_sorted() {
    let source = (0..4097)
        .map(|index| claude_row(&format!("request-{index}"), 10, 2, 1))
        .collect::<Vec<_>>()
        .join("\n");
    let collection = parse(&source, Provider::ClaudeCode);
    assert_eq!(collection.batches.len(), 2);
    assert_eq!(collection.batches[0].usage.len(), 4096);
    assert_eq!(collection.batches[1].usage.len(), 1);
    let ids = collection
        .batches
        .iter()
        .flat_map(|batch| batch.usage.iter().map(|usage| usage.id))
        .collect::<Vec<_>>();
    assert!(ids.windows(2).all(|pair| pair[0] < pair[1]));
    packets(&collection);
}
