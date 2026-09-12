use super::*;
use std::io::Cursor;

const KEY: [u8; 32] = [7; 32];

fn meta() -> &'static str {
    "{\"type\":\"session_meta\",\"payload\":{\"id\":\"thread-1\",\"source\":\"cli\"}}\n"
}

fn start(timestamp: &str) -> String {
    format!("{{\"type\":\"event_msg\",\"timestamp\":\"{timestamp}\",\"payload\":{{\"type\":\"task_started\",\"turn_id\":\"turn-1\",\"root_turn_id\":\"turn-1\",\"started_at\":172799}}}}\n")
}

fn terminal(duration: u64) -> String {
    format!("{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_complete\",\"turn_id\":\"turn-1\",\"started_at\":172799,\"completed_at\":172800,\"duration_ms\":{duration},\"error\":{{\"message\":\"NEVER_RETAIN_ERROR\"}}}}}}\n")
}

fn source() -> String {
    format!(
        "{}{}{}",
        meta(),
        start("1970-01-02T23:59:59.001Z"),
        terminal(1537)
    )
}

fn parse(source: &str) -> TurnCollection {
    parse_codex_turns(Cursor::new(source.as_bytes()), &KEY).unwrap()
}

#[test]
fn reported_runtime_is_not_coarse_timestamp_subtraction_or_task_success() {
    let summary = parse(&source()).daily_summary();
    assert_eq!(summary.days.len(), 1);
    assert_eq!(summary.days[0].utc_day, 2);
    assert_eq!(
        summary.days[0].completed,
        RuntimeCohort {
            observed_turns: 1,
            runtime_eligible_turns: 1,
            runtime_ms_sum: 1537,
            observed_subtotals: ObservedSubtotals::default(),
        }
    );
    assert!(!summary.coverage_complete);
    assert_eq!(summary.tokens, None);
    assert_eq!(summary.tool_calls, None);
}

#[test]
fn exact_copies_are_inert_but_a_second_start_makes_runtime_unavailable() {
    let a = parse(&source());
    let b = parse(&source());
    let merged = merge_turn_collections(&[a, b]).unwrap();
    assert_eq!(
        merged.daily_summary().days[0].completed.runtime_ms_sum,
        1537
    );
    let recovered = parse(&format!(
        "{}{}{}{}",
        meta(),
        start("1970-01-02T23:59:59.001Z"),
        start("1970-01-02T23:59:59.002Z"),
        terminal(1537)
    ));
    assert_eq!(
        recovered.daily_summary().days[0]
            .completed
            .runtime_eligible_turns,
        0
    );
}

#[test]
fn terminal_without_completed_lf_is_deferred() {
    let input = source();
    let without_lf = input.trim_end_matches('\n');
    assert!(parse(without_lf).daily_summary().days.is_empty());
}

#[test]
fn different_occurrence_keys_cannot_be_merged_even_for_empty_inputs() {
    let a = parse_codex_turns(Cursor::new(b""), &KEY).unwrap();
    let b = parse_codex_turns(Cursor::new(b""), &[8; 32]).unwrap();
    assert!(merge_turn_collections(&[a, b]).is_err());
}

#[test]
fn conflicting_terminal_evidence_is_refused_across_sources() {
    let a = parse(&source());
    let b = parse(&format!(
        "{}{}{}",
        meta(),
        start("1970-01-02T23:59:59.001Z"),
        terminal(1538)
    ));
    assert!(merge_turn_collections(&[a, b]).is_err());
}

#[test]
fn legacy_parser_still_accepts_its_existing_unterminated_record_contract() {
    let input = "{\"type\":\"session_meta\",\"payload\":{\"id\":\"thread-1\"}}";
    let result =
        crate::parse_reader(Cursor::new(input), aicharts_protocol::Provider::Codex, &KEY).unwrap();
    assert_eq!(result.lines_read, 1);
}
