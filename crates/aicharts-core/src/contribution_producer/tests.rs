use super::*;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{Cursor, Read};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    binding: Value,
    synthetic_key_hex: String,
    source_lines: Vec<String>,
    query_text: String,
    head_reply_text: String,
    batch_text: String,
    body_hash: String,
    payload_hashes: Vec<String>,
    terminal_reply_text: String,
}
fn fixture() -> Fixture {
    serde_json::from_str(include_str!(
        "../../../../fixtures/usage/contribution-producer-v3.json"
    ))
    .unwrap()
}
fn h(n: u64) -> String {
    format!("{n:064x}")
}
fn account_id(n: u64) -> String {
    format!("acct_{n:032x}")
}
fn scope() -> Scope {
    Scope::new(&account_id(1), &h(2), &h(3), &h(4), 1).unwrap()
}
fn observations(lines: &[String]) -> NativeObservations {
    NativeObservations::read_claude(Cursor::new(lines.join("\n")), &account_id(1), &[0x43; 32])
        .unwrap()
}
fn query() -> HeadQuery {
    observations(&fixture().source_lines)
        .head_query(&scope(), 12, 0)
        .unwrap()
        .unwrap()
}
fn reply() -> Value {
    serde_json::from_str(&fixture().head_reply_text).unwrap()
}
fn bytes(value: &Value) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}
fn prepared() -> PreparedBatch {
    query()
        .correlate(fixture().head_reply_text.as_bytes())
        .unwrap()
        .prepare(&h(20), MAX_SEQUENCE)
        .unwrap()
        .unwrap()
}

#[test]
fn retained_prepared_bytes_reopen_exactly_and_keep_original_terminal_correlation() {
    let original = prepared();
    let reopened = PreparedBatch::reopen(&scope(), original.bytes(), original.body_hash()).unwrap();
    assert_eq!(reopened.bytes(), original.bytes());
    assert_eq!(reopened.body_hash(), original.body_hash());
    assert_eq!(reopened.operation_id(), h(20));
    assert_eq!(reopened.sequence(), MAX_SEQUENCE);
    assert_eq!(reopened.expected_revision(), 12);
    assert_eq!(reopened.scope().account_id(), account_id(1));
    assert_eq!(reopened.scope().device_id(), h(3));
    assert_eq!(reopened.scope().generation(), h(2));
    assert_eq!(reopened.scope().population_id(), h(4));
    assert_eq!(reopened.scope().writer_revision(), 1);
    assert_eq!(
        reopened.expected_population_revision(),
        original.expected_population_revision()
    );
    assert_eq!(
        reopened.expected_population_head(),
        original.expected_population_head()
    );
    assert_eq!(
        reopened
            .correlate_terminal(fixture().terminal_reply_text.as_bytes())
            .unwrap()
            .outcome(),
        TerminalOutcome::Committed
    );
}

#[test]
fn prepared_reopening_refuses_foreign_scope_hash_and_noncanonical_bytes() {
    let original = prepared();
    for foreign in [
        Scope::new(&account_id(9), &h(2), &h(3), &h(4), 1).unwrap(),
        Scope::new(&account_id(1), &h(9), &h(3), &h(4), 1).unwrap(),
        Scope::new(&account_id(1), &h(2), &h(9), &h(4), 1).unwrap(),
        Scope::new(&account_id(1), &h(2), &h(3), &h(9), 1).unwrap(),
        Scope::new(&account_id(1), &h(2), &h(3), &h(4), 2).unwrap(),
    ] {
        refuses(
            PreparedBatch::reopen(&foreign, original.bytes(), original.body_hash()),
            Error::InvalidBatch,
        );
    }
    refuses(
        PreparedBatch::reopen(&scope(), original.bytes(), &h(999)),
        Error::InvalidBatch,
    );
    let mut spaced = original.bytes().to_vec();
    spaced.push(b' ');
    refuses(
        PreparedBatch::reopen(&scope(), &spaced, &hash_parts(&[&spaced])),
        Error::InvalidBatch,
    );
    let duplicate = String::from_utf8(original.bytes().to_vec())
        .unwrap()
        .replacen("{", "{\"schemaVersion\":3,", 1)
        .into_bytes();
    refuses(
        PreparedBatch::reopen(&scope(), &duplicate, &hash_parts(&[&duplicate])),
        Error::InvalidBatch,
    );
    let missing = String::from_utf8(original.bytes().to_vec())
        .unwrap()
        .replace("\"replacement\":null,", "")
        .into_bytes();
    refuses(
        PreparedBatch::reopen(&scope(), &missing, &hash_parts(&[&missing])),
        Error::InvalidBatch,
    );
    refuses(
        PreparedBatch::reopen(&scope(), &vec![b' '; MAX_BATCH_BYTES + 1], &h(1)),
        Error::InvalidBatch,
    );
}

#[test]
fn prepared_reopening_cannot_widen_the_native_profile_or_decimal_bounds() {
    let original = prepared();
    let raw: Value = serde_json::from_slice(original.bytes()).unwrap();
    let changes = [
        vec!["profile"],
        vec!["grain"],
        vec!["identityScheme"],
        vec!["mutations", "0", "kind"],
        vec!["mutations", "0", "row", "client"],
        vec!["mutations", "0", "row", "tokenBasis"],
        vec!["mutations", "0", "row", "breakdownCoverage"],
    ];
    for path in changes {
        let mut changed = raw.clone();
        let pointer = format!("/{}", path.join("/"));
        *changed.pointer_mut(&pointer).unwrap() = json!("PRIVATE_CANARY");
        let wire: wire::Batch = serde_json::from_value(changed).unwrap();
        let bytes = encode(&wire, MAX_BATCH_BYTES).unwrap();
        refuses(
            PreparedBatch::reopen(&scope(), &bytes, &hash_parts(&[&bytes])),
            Error::InvalidBatch,
        );
    }
    for amount in [
        "00",
        "01",
        "+1",
        "-1",
        "1.0",
        "18446744073709551616",
        "18446744073709551615",
    ] {
        let mut changed = raw.clone();
        changed["mutations"][0]["row"]["tokens"]["input"] = json!(amount);
        let wire: wire::Batch = serde_json::from_value(changed).unwrap();
        let bytes = encode(&wire, MAX_BATCH_BYTES).unwrap();
        refuses(
            PreparedBatch::reopen(&scope(), &bytes, &hash_parts(&[&bytes])),
            Error::InvalidBatch,
        );
    }
}
fn refuses<T>(result: Result<T, Error>, expected: Error) {
    match result {
        Err(error) => assert_eq!(error, expected),
        Ok(_) => panic!("expected {}", expected.code()),
    }
}
fn set_heads(value: &mut Value, facts: &[NativeFact], membership: Option<&str>) {
    let page = &mut value["result"]["value"];
    page["entries"] = Value::Array(facts.iter().map(|fact| json!({
        "id": fact.id, "membershipHeadHash": membership,
        "head": { "id": fact.id, "headHash": h(50), "payloadHash": fact.payload_hash,
            "reference": { "kind": "batch-v3", "bodyHash": h(51), "index": 0, "payloadHash": fact.payload_hash },
            "members": 1, "deleted": false, "legacySupport": false, "suppressedLegacy": false }
    })).collect());
    if membership.is_some() {
        page["population"]["revision"] = json!(1);
        page["population"]["headHash"] = json!(h(52));
        page["population"]["memberCount"] = json!(facts.len());
    }
}

#[test]
fn literal_cross_language_bytes_hashes_and_terminal_match() {
    let fixture = fixture();
    assert_eq!(fixture.synthetic_key_hex, "43".repeat(32));
    assert_eq!(fixture.binding["accountId"], account_id(1));
    let source = observations(&fixture.source_lines);
    assert_eq!(source.len(), 2);
    assert_eq!(source.lines_read(), 3);
    assert_eq!(source.coverage(), "partial");
    assert!(source
        .warnings()
        .contains(&crate::Warning::UnmeasuredReasoning));
    assert_eq!(
        source
            .facts
            .iter()
            .map(|fact| fact.payload_hash.clone())
            .collect::<Vec<_>>(),
        fixture.payload_hashes
    );
    let request = source.head_query(&scope(), 12, 0).unwrap().unwrap();
    assert_eq!(request.bytes(), fixture.query_text.as_bytes());
    let batch = request
        .correlate(fixture.head_reply_text.as_bytes())
        .unwrap()
        .prepare(&h(20), MAX_SEQUENCE)
        .unwrap()
        .unwrap();
    assert_eq!(batch.bytes(), fixture.batch_text.as_bytes());
    assert_eq!(batch.body_hash(), fixture.body_hash);
    let terminal = batch
        .correlate_terminal(fixture.terminal_reply_text.as_bytes())
        .unwrap();
    assert_eq!(terminal.outcome(), TerminalOutcome::Committed);
    assert_eq!(terminal.revision(), 13);
    for private in [
        "PRIVATE_",
        "synthetic-request",
        "synthetic-message",
        "synthetic-session",
        &fixture.synthetic_key_hex,
    ] {
        assert!(!fixture.batch_text.contains(private));
        assert!(!fixture.query_text.contains(private));
    }
}

#[test]
fn native_copies_and_stream_order_deduplicate_without_inventing_complete_coverage() {
    let fixture = fixture();
    let expected = prepared();
    let permutations = [
        [0, 1, 2],
        [2, 1, 0],
        [1, 0, 2],
        [1, 2, 0],
        [0, 2, 1],
        [2, 0, 1],
    ];
    for order in permutations {
        let mut lines: Vec<_> = order
            .iter()
            .map(|index| fixture.source_lines[*index].clone())
            .collect();
        lines.extend(lines.clone());
        let source = observations(&lines);
        assert_eq!(source.len(), 2);
        let request = source.head_query(&scope(), 12, 0).unwrap().unwrap();
        let batch = request
            .correlate(fixture.head_reply_text.as_bytes())
            .unwrap()
            .prepare(&h(20), MAX_SEQUENCE)
            .unwrap()
            .unwrap();
        assert_eq!(batch.bytes(), expected.bytes());
    }
    let native = crate::parse_reader(
        Cursor::new(fixture.source_lines.join("\n")),
        Provider::ClaudeCode,
        &[0x43; 32],
    )
    .unwrap();
    let mut legacy_ids: Vec<_> = native
        .batches
        .iter()
        .flat_map(|batch| batch.usage.iter().map(|usage| hex_bytes(&usage.id)))
        .collect();
    legacy_ids.sort();
    assert_eq!(
        legacy_ids,
        query()
            .facts
            .iter()
            .map(|fact| fact.id.clone())
            .collect::<Vec<_>>()
    );
}

#[test]
fn account_binding_refuses_reuse_and_distinct_custody_keys_scope_native_ids() {
    let fixture = fixture();
    let source = observations(&fixture.source_lines);
    let foreign = Scope::new(&account_id(2), &h(2), &h(3), &h(4), 1).unwrap();
    refuses(source.head_query(&foreign, 12, 0), Error::InvalidScope);
    let other = NativeObservations::read_claude(
        Cursor::new(fixture.source_lines.join("\n")),
        &account_id(2),
        &[0x44; 32],
    )
    .unwrap();
    assert!(source
        .facts
        .iter()
        .all(|fact| other.facts.iter().all(|other| fact.id != other.id)));
    // This module cannot authenticate account/key custody. It never derives a
    // new namespace from an account ID, which would break migrated V1 identity.
    refuses(
        NativeObservations::read_claude(Cursor::new(""), &account_id(1), &[0; 32]),
        Error::InvalidKey,
    );
    refuses(
        NativeObservations::read_claude(Cursor::new(""), "PRIVATE_PATH_CANARY", &[1; 32]),
        Error::InvalidScope,
    );
}

#[test]
fn aggregate_or_unsupported_source_does_not_become_native_eligibility() {
    let aggregate = observations(&[
        r#"{"schemaVersion":2,"profile":"client-stats-v2","rows":[{"tokens":{"input":"100"}}]}"#
            .into(),
    ]);
    assert!(aggregate.is_empty());
    assert!(aggregate.head_query(&scope(), 0, 0).unwrap().is_none());
    let codex = observations(&[r#"{"type":"event_msg","timestamp":"2026-01-01T12:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":5}}}}"#.into()]);
    assert!(codex.is_empty());
    let mut unknown_ttl: Value = serde_json::from_str(&fixture().source_lines[2]).unwrap();
    unknown_ttl["message"]["usage"]
        .as_object_mut()
        .unwrap()
        .remove("cache_creation");
    let skipped = observations(&[unknown_ttl.to_string()]);
    assert!(skipped.is_empty());
    assert!(skipped
        .warnings()
        .contains(&crate::Warning::ClaudeCacheTtlUnknown));
}

#[test]
fn exact_mirrors_join_and_stale_membership_never_replaces_current_head() {
    let request = query();
    let mut value = reply();
    set_heads(&mut value, &request.facts, None);
    let joined = request
        .correlate(&bytes(&value))
        .unwrap()
        .prepare(&h(20), 1)
        .unwrap()
        .unwrap();
    let decoded: Value = serde_json::from_slice(joined.bytes()).unwrap();
    assert_eq!(decoded["replacement"], Value::Null);
    assert!(decoded["mutations"]
        .as_array()
        .unwrap()
        .iter()
        .all(|mutation| mutation["expectedHeadHash"] == h(50)));
    set_heads(&mut value, &request.facts, Some(&h(49)));
    let reassertion = request
        .correlate(&bytes(&value))
        .unwrap()
        .prepare(&h(20), 1)
        .unwrap()
        .unwrap();
    let decoded: Value = serde_json::from_slice(reassertion.bytes()).unwrap();
    assert!(decoded["mutations"]
        .as_array()
        .unwrap()
        .iter()
        .all(|mutation| mutation["expectedHeadHash"] == h(50)));
    set_heads(&mut value, &request.facts, Some(&h(50)));
    assert!(request
        .correlate(&bytes(&value))
        .unwrap()
        .prepare(&h(20), 1)
        .unwrap()
        .is_none());
}

#[test]
fn matching_current_membership_does_not_authorize_partial_scan_correction() {
    let request = query();
    for (membership, expected) in [
        (None, Error::PopulationConflict),
        (Some(h(49)), Error::PopulationConflict),
        (Some(h(50)), Error::CorrectionRequiresReconciliation),
    ] {
        let mut value = reply();
        set_heads(&mut value, &request.facts, membership.as_deref());
        value["result"]["value"]["entries"][0]["head"]["payloadHash"] = json!(h(70));
        value["result"]["value"]["entries"][0]["head"]["reference"]["payloadHash"] = json!(h(70));
        refuses(
            request
                .correlate(&bytes(&value))
                .unwrap()
                .prepare(&h(20), 1),
            expected,
        );
    }
}

#[test]
fn tombstones_and_unresolved_legacy_cannot_be_resurrected() {
    let request = query();
    let mut value = reply();
    set_heads(&mut value, &request.facts, Some(&h(50)));
    value["result"]["value"]["entries"][0]["head"]["deleted"] = json!(true);
    value["result"]["value"]["entries"][0]["head"]["payloadHash"] = Value::Null;
    value["result"]["value"]["entries"][0]["head"]["reference"] = Value::Null;
    refuses(
        request
            .correlate(&bytes(&value))
            .unwrap()
            .prepare(&h(20), 1),
        Error::SubjectDeleted,
    );
    set_heads(&mut value, &request.facts, Some(&h(50)));
    value["result"]["value"]["entries"][0]["head"]["suppressedLegacy"] = json!(true);
    refuses(
        request
            .correlate(&bytes(&value))
            .unwrap()
            .prepare(&h(20), 1),
        Error::LegacyUnresolved,
    );
}

#[test]
fn migrated_reference_is_checked_before_an_exact_payload_join() {
    let request = query();
    let mut value = reply();
    set_heads(&mut value, &request.facts, None);
    for (entry, fact) in value["result"]["value"]["entries"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .zip(&request.facts)
    {
        entry["head"]["legacySupport"] = json!(true);
        entry["head"]["reference"] = json!({"kind":"admission-v1","generation":h(90),"bodyHash":h(51),"index":255,
            "payloadHash":fact.payload_hash,"operationHash":h(91)});
    }
    assert_eq!(
        request
            .correlate(&bytes(&value))
            .unwrap()
            .prepare(&h(20), 1)
            .unwrap()
            .unwrap()
            .len(),
        2
    );
    value["result"]["value"]["entries"][0]["head"]["reference"]["operationHash"] = json!(ZERO_HASH);
    refuses(request.correlate(&bytes(&value)), Error::InvalidReply);
}

#[test]
fn reply_scope_population_and_exact_entry_set_are_correlated() {
    let request = query();
    for (field, replacement) in [
        ("accountId", json!(account_id(9))),
        ("generation", json!(h(9))),
        ("deviceId", json!(h(9))),
        ("revision", json!(13)),
        ("mode", json!("members")),
        ("profile", json!("PRIVATE_PROMPT_CANARY")),
        ("observedAtMs", json!(MAX_TIME + 1)),
        ("next", json!({})),
    ] {
        let mut value = reply();
        value["result"]["value"][field] = replacement;
        refuses(request.correlate(&bytes(&value)), Error::InvalidReply);
    }
    for (field, replacement) in [
        ("id", json!(h(9))),
        ("generation", json!(h(9))),
        ("deviceId", json!(h(9))),
        ("writerRevision", json!(2)),
        ("revision", json!(13)),
        ("headHash", json!(h(1))),
        ("memberCount", json!(8_193)),
    ] {
        let mut value = reply();
        value["result"]["value"]["population"][field] = replacement;
        refuses(request.correlate(&bytes(&value)), Error::InvalidReply);
    }
    for kind in 0..4 {
        let mut value = reply();
        let entries = value["result"]["value"]["entries"].as_array_mut().unwrap();
        match kind {
            0 => entries.reverse(),
            1 => {
                entries.pop();
            }
            2 => entries.push(entries[0].clone()),
            _ => entries[0]["membershipHeadHash"] = json!(h(1)),
        }
        refuses(request.correlate(&bytes(&value)), Error::InvalidReply);
    }
}

#[test]
fn malformed_missing_duplicate_and_excess_reply_fields_are_refused() {
    let request = query();
    for field in ["head", "membershipHeadHash"] {
        let mut value = reply();
        value["result"]["value"]["entries"][0]
            .as_object_mut()
            .unwrap()
            .remove(field);
        refuses(request.correlate(&bytes(&value)), Error::InvalidReply);
    }
    let mut value = reply();
    value["result"]["value"]["extra"] = json!("PRIVATE_PROMPT_CANARY");
    refuses(request.correlate(&bytes(&value)), Error::InvalidReply);
    let duplicate = fixture().head_reply_text.replacen(
        "\"schemaVersion\":3",
        "\"schemaVersion\":3,\"schemaVersion\":3",
        1,
    );
    refuses(request.correlate(duplicate.as_bytes()), Error::InvalidReply);
    let negative_zero =
        fixture()
            .head_reply_text
            .replacen("\"observedAtMs\":1000", "\"observedAtMs\":-0", 1);
    refuses(
        request.correlate(negative_zero.as_bytes()),
        Error::InvalidReply,
    );
    for invalid_number in ["18446744073709551615", "18446744073709551616", "-1", "1.5"] {
        let changed = fixture().head_reply_text.replacen(
            "\"observedAtMs\":1000",
            &format!("\"observedAtMs\":{invalid_number}"),
            1,
        );
        refuses(request.correlate(changed.as_bytes()), Error::InvalidReply);
    }
    for malformed in ["{", "null", "{\"schemaVersion\":3}\n{}"] {
        refuses(request.correlate(malformed.as_bytes()), Error::InvalidReply);
    }
    let mut padded = fixture().head_reply_text.into_bytes();
    padded.resize(MAX_REPLY_BYTES, b' ');
    assert!(request.correlate(&padded).is_ok());
    padded.push(b' ');
    refuses(request.correlate(&padded), Error::InvalidReply);
    refuses(
        request.correlate(
            b"{\"schemaVersion\":3,\"result\":{\"ok\":false,\"error\":\"unauthorized\"}}",
        ),
        Error::InvalidReply,
    );
}

#[test]
fn every_head_reference_field_is_validated_even_when_payload_would_match() {
    let request = query();
    for (field, replacement) in [
        ("id", json!("0".repeat(32))),
        ("headHash", json!(ZERO_HASH)),
        ("members", json!(1_025)),
        ("payloadHash", Value::Null),
        ("reference", Value::Null),
        ("deleted", json!(true)),
    ] {
        let mut value = reply();
        set_heads(&mut value, &request.facts, Some(&h(50)));
        value["result"]["value"]["entries"][0]["head"][field] = replacement;
        refuses(request.correlate(&bytes(&value)), Error::InvalidReply);
    }
    for (field, replacement) in [
        ("bodyHash", json!(ZERO_HASH)),
        ("index", json!(256)),
        ("payloadHash", json!(h(99))),
        ("kind", json!("other")),
        ("extra", json!(true)),
    ] {
        let mut value = reply();
        set_heads(&mut value, &request.facts, None);
        value["result"]["value"]["entries"][0]["head"]["reference"][field] = replacement;
        refuses(request.correlate(&bytes(&value)), Error::InvalidReply);
    }
}

#[test]
fn exact_terminal_correlates_all_scope_and_history_fields_without_settling() {
    let batch = prepared();
    for (field, replacement) in [
        ("schemaVersion", json!(2)),
        ("operationId", json!(h(99))),
        ("bodyHash", json!(h(99))),
        ("accountId", json!(account_id(9))),
        ("generation", json!(h(9))),
        ("deviceId", json!(h(9))),
        ("sequence", json!(1)),
        ("revision", json!(14)),
        ("populationId", json!(h(9))),
        ("populationRevision", json!(2)),
        ("populationHead", json!(h(9))),
        ("committedAtMs", json!(MAX_TIME + 1)),
        ("extra", json!(true)),
    ] {
        let mut value: Value = serde_json::from_str(&fixture().terminal_reply_text).unwrap();
        value["result"]["value"]["receipt"][field] = replacement;
        refuses(
            batch.correlate_terminal(&bytes(&value)),
            Error::InvalidReply,
        );
    }
    let expected_bytes = batch.bytes().to_vec();
    assert!(batch
        .correlate_terminal(fixture().terminal_reply_text.as_bytes())
        .is_ok());
    assert!(batch
        .correlate_terminal(fixture().terminal_reply_text.as_bytes())
        .is_ok());
    assert_eq!(batch.bytes(), expected_bytes);
    let mut abandoned = json!({"schemaVersion":3,"result":{"ok":true,"value":{
        "outcome":"abandoned","operationId":h(20),"bodyHash":batch.body_hash(),"revision":13}}});
    assert_eq!(
        batch
            .correlate_terminal(&bytes(&abandoned))
            .unwrap()
            .outcome(),
        TerminalOutcome::Abandoned
    );
    abandoned["result"]["value"]["revision"] = json!(12);
    refuses(
        batch.correlate_terminal(&bytes(&abandoned)),
        Error::InvalidReply,
    );
    abandoned["result"]["value"]["revision"] = json!(13);
    abandoned["result"]["value"]["bodyHash"] = json!(h(99));
    refuses(
        batch.correlate_terminal(&bytes(&abandoned)),
        Error::InvalidReply,
    );
}

fn generated_source(count: usize) -> String {
    let record: Value = serde_json::from_str(&fixture().source_lines[2]).unwrap();
    let mut lines = Vec::with_capacity(count);
    for index in 0..count {
        let mut current = record.clone();
        current["requestId"] = json!(format!("synthetic-{index}"));
        lines.push(current.to_string());
    }
    lines.join("\n")
}

#[test]
fn named_pages_are_bounded_sorted_disjoint_and_all_puts_fit_the_wire() {
    let source = NativeObservations::read_claude(
        Cursor::new(generated_source(257)),
        &account_id(1),
        &[0x43; 32],
    )
    .unwrap();
    let first = source.head_query(&scope(), 12, 0).unwrap().unwrap();
    let second = source.head_query(&scope(), 12, 256).unwrap().unwrap();
    assert_eq!(first.len(), MAX_MUTATIONS);
    assert_eq!(second.len(), 1);
    assert!(first.bytes().len() <= MAX_QUERY_BYTES);
    assert!(first.facts.last().unwrap().id < second.facts[0].id);
    assert!(source.head_query(&scope(), 12, 257).unwrap().is_none());
    refuses(
        source.head_query(&scope(), 12, 258),
        Error::InvalidSelection,
    );
    let mut value = reply();
    value["result"]["value"]["entries"] = Value::Array(
        first
            .facts
            .iter()
            .map(|fact| json!({"id":fact.id,"head":null,"membershipHeadHash":null}))
            .collect(),
    );
    let batch = first
        .correlate(&bytes(&value))
        .unwrap()
        .prepare(&h(20), 1)
        .unwrap()
        .unwrap();
    assert_eq!(batch.len(), MAX_MUTATIONS);
    assert!(batch.bytes().len() <= MAX_BATCH_BYTES);
    assert_eq!(hash_parts(&[batch.bytes()]), batch.body_hash());
}

#[test]
fn source_bytes_and_retained_observation_count_are_bounded() {
    let oversized = io::BufReader::new(io::repeat(b' ').take(MAX_SOURCE_BYTES + 10));
    refuses(
        NativeObservations::read_claude(oversized, &account_id(1), &[0x43; 32]),
        Error::SourceLimit,
    );
    let exact = NativeObservations::read_claude(
        Cursor::new(generated_source(MAX_OBSERVATIONS)),
        &account_id(1),
        &[0x43; 32],
    )
    .unwrap();
    assert_eq!(exact.len(), MAX_OBSERVATIONS);
    refuses(
        NativeObservations::read_claude(
            Cursor::new(generated_source(MAX_OBSERVATIONS + 1)),
            &account_id(1),
            &[0x43; 32],
        ),
        Error::ObservationLimit,
    );
}

#[test]
fn capacity_and_sequence_exhaustion_refuse_without_emitting_a_prefix() {
    let request = query();
    let mut value = reply();
    value["result"]["value"]["population"]["memberCount"] = json!(MAX_OBSERVATIONS);
    refuses(
        request
            .correlate(&bytes(&value))
            .unwrap()
            .prepare(&h(20), 1),
        Error::Limit,
    );
    let heads = request
        .correlate(fixture().head_reply_text.as_bytes())
        .unwrap();
    for sequence in [0, MAX_SEQUENCE + 1, u64::MAX] {
        refuses(heads.prepare(&h(20), sequence), Error::InvalidScope);
    }
    for operation in [ZERO_HASH, "PRIVATE_PROMPT_CANARY", "A123"] {
        refuses(heads.prepare(operation, 1), Error::InvalidScope);
    }
    let exhausted = observations(&fixture().source_lines)
        .head_query(&scope(), MAX_REVISION, 0)
        .unwrap()
        .unwrap();
    value = reply();
    value["result"]["value"]["revision"] = json!(MAX_REVISION);
    refuses(
        exhausted
            .correlate(&bytes(&value))
            .unwrap()
            .prepare(&h(20), 1),
        Error::Limit,
    );
    refuses(encode(&"12345", 6), Error::Limit);
}
