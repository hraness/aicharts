use super::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub(super) fn h(value: u64) -> String {
    format!("{value:064x}")
}
pub(super) fn batch(sequence: u64, revision: u64, population: u64) -> PreparedBatch {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../fixtures/usage/contribution-producer-v3.json"
    ))
    .unwrap();
    let text = fixture["batchText"]
        .as_str()
        .unwrap()
        .replace(
            "\"sequence\":9007199254740991",
            &format!("\"sequence\":{sequence}"),
        )
        .replace(
            "\"expectedRevision\":12",
            &format!("\"expectedRevision\":{revision}"),
        )
        .replace(
            &format!("\"operationId\":\"{}\"", h(20)),
            &format!("\"operationId\":\"{}\"", h(20 + sequence)),
        )
        .replace(
            &format!("\"populationId\":\"{}\"", h(4)),
            &format!("\"populationId\":\"{}\"", h(population)),
        );
    let scope = Scope::new(&format!("acct_{:032x}", 1), &h(2), &h(3), &h(population), 1).unwrap();
    PreparedBatch::reopen(
        &scope,
        text.as_bytes(),
        &format!("{:x}", Sha256::digest(text.as_bytes())),
    )
    .unwrap()
}
pub(super) fn progress(batch: &PreparedBatch) -> AuthenticatedProgress {
    AuthenticatedProgress {
        scope: StoredScope::new(&batch.scope()),
        active: true,
        next_sequence: batch.sequence(),
        revision: batch.expected_revision(),
        population_revision: batch.expected_population_revision(),
        population_head: batch.expected_population_head().into(),
        expires_at: Instant::now() + std::time::Duration::from_secs(120),
    }
}
pub(super) fn reply(batch: &PreparedBatch, revision: u64) -> AuthenticatedTerminal {
    AuthenticatedTerminal { body: FrozenBody::new(batch), proof: TerminalProof::Direct(STANDARD.encode(serde_json::to_vec(&json!({ "schemaVersion": 3,
        "result": { "ok": true, "value": { "outcome": "abandoned", "operationId": batch.operation_id(), "bodyHash": batch.body_hash(), "revision": revision } } })).unwrap())) }
}
pub(super) fn committed_reply(batch: &PreparedBatch) -> AuthenticatedTerminal {
    let scope = batch.scope();
    let mut population_hash = Sha256::new();
    population_hash.update(b"aicharts:population-history:v3\0");
    population_hash.update(
        serde_json::to_vec(&[batch.expected_population_head(), batch.body_hash()]).unwrap(),
    );
    let population_head = format!("{:x}", population_hash.finalize());
    AuthenticatedTerminal {
        body: FrozenBody::new(batch),
        proof: TerminalProof::Direct(STANDARD.encode(serde_json::to_vec(&json!({ "schemaVersion": 3,
            "result": { "ok": true, "value": { "outcome": "committed", "receipt": {
                "schemaVersion": 3, "operationId": batch.operation_id(), "bodyHash": batch.body_hash(),
                "accountId": scope.account_id(), "generation": scope.generation(), "deviceId": scope.device_id(),
                "sequence": batch.sequence(), "revision": batch.expected_revision() + 1,
                "populationId": scope.population_id(), "populationRevision": batch.expected_population_revision() + 1,
                "populationHead": population_head, "committedAtMs": 1001
            } } } })).unwrap())),
    }
}
pub(super) fn direct_bytes(terminal: &AuthenticatedTerminal) -> Vec<u8> {
    match &terminal.proof {
        TerminalProof::Direct(value) => STANDARD.decode(value).unwrap(),
        _ => panic!("direct fixture"),
    }
}
pub(super) fn status_value(
    batch: &PreparedBatch,
    outcome: Option<&str>,
    revision: u64,
    next_sequence: u64,
) -> Value {
    let scope = batch.scope();
    let terminal = match outcome {
        Some("committed") => Some(
            serde_json::from_slice::<Value>(&direct_bytes(&committed_reply(batch))).unwrap()
                ["result"]["value"]
                .clone(),
        ),
        Some("abandoned") => Some(
            serde_json::from_slice::<Value>(&direct_bytes(&reply(batch, revision))).unwrap()
                ["result"]["value"]
                .clone(),
        ),
        _ => None,
    };
    let population_revision = terminal
        .as_ref()
        .and_then(|value| value["receipt"]["populationRevision"].as_u64())
        .unwrap_or(batch.expected_population_revision());
    let population_head = terminal
        .as_ref()
        .and_then(|value| value["receipt"]["populationHead"].as_str())
        .unwrap_or(batch.expected_population_head());
    json!({ "schemaVersion": 3, "result": { "ok": true, "value": {
        "schemaVersion": 3, "accountId": scope.account_id(), "generation": scope.generation(), "revision": revision,
        "nextSequence": next_sequence, "phase": "active", "activationHash": h(99), "migrationManifestHash": null,
        "population": { "id": scope.population_id(), "generation": scope.generation(), "deviceId": scope.device_id(),
            "writerRevision": scope.writer_revision(), "revision": population_revision, "headHash": population_head,
            "memberCount": if outcome == Some("committed") { batch.len() } else { 0 } },
        "operation": outcome.map(|outcome| json!({ "operationId": batch.operation_id(), "bodyHash": batch.body_hash(), "outcome": outcome, "terminal": terminal })),
        "legacyResolution": "not_evaluated"
    } } })
}
pub(super) fn empty() -> Checkpoint {
    Checkpoint {
        schema_version: 2,
        binding: Binding::from_scope(&batch(1, 12, 4).scope()),
        last_sequence: 0,
        last_revision: 12,
        flight: None,
        terminal: None,
    }
}
pub(super) fn frozen() -> Checkpoint {
    let mut value = empty();
    value.flight = Some(Flight {
        body: FrozenBody::new(&batch(1, 12, 4)),
        action: Action::Upload,
    });
    value
}

#[test]
fn checkpoint_caps_cover_two_exact_maximum_bodies_and_one_terminal() {
    assert_eq!(MAX_BODY_BASE64, MAX_BATCH_BYTES.div_ceil(3) * 4);
    assert_eq!(MAX_TERMINAL_BASE64, MAX_TERMINAL_BYTES.div_ceil(3) * 4);
    assert_eq!(
        MAX_CHECKPOINT_BYTES,
        MAX_BODY_BASE64 * 2 + MAX_TERMINAL_BASE64 + 16_384
    );
}

#[test]
fn checkpoint_transitions_preserve_frozen_bytes_and_never_reverse_cancellation() {
    let initial = empty();
    let upload = frozen();
    initial.follows(None).unwrap();
    upload.follows(Some(&initial)).unwrap();
    assert!(upload.follows(None).is_err());
    let mut cancelled = upload.clone();
    cancelled.last_revision = 13;
    cancelled.flight.as_mut().unwrap().action = Action::Cancel {
        expected_revision: 13,
    };
    cancelled.follows(Some(&upload)).unwrap();
    let mut advanced = cancelled.clone();
    advanced.last_revision = 14;
    advanced.flight.as_mut().unwrap().action = Action::Cancel {
        expected_revision: 14,
    };
    advanced.follows(Some(&cancelled)).unwrap();
    assert!(cancelled.follows(Some(&advanced)).is_err());
    let mut reversed = cancelled.clone();
    reversed.flight.as_mut().unwrap().action = Action::Upload;
    assert!(reversed.follows(Some(&cancelled)).is_err());
    let mut replaced = cancelled.clone();
    replaced.flight.as_mut().unwrap().body = FrozenBody::new(&batch(1, 12, 5));
    assert!(replaced.follows(Some(&cancelled)).is_err());
    let mut cleared = upload.clone();
    cleared.flight = None;
    assert!(cleared.follows(Some(&upload)).is_err());
}

#[test]
fn exact_terminal_advances_sequence_for_abandonment_and_keeps_prior_body_for_revalidation() {
    let upload = frozen();
    let terminal = reply(&batch(1, 12, 4), 13);
    let mut settled = upload.clone();
    settled.last_sequence = 1;
    settled.last_revision = 13;
    settled.terminal = Some(RetainedTerminal {
        flight: settled.flight.take().unwrap(),
        proof: terminal.proof,
    });
    settled.follows(Some(&upload)).unwrap();
    let mut next = settled.clone();
    next.last_revision = 14;
    next.flight = Some(Flight {
        body: FrozenBody::new(&batch(2, 14, 5)),
        action: Action::Upload,
    });
    next.follows(Some(&settled)).unwrap();
    assert_eq!(next.terminal, settled.terminal);
    let mut corrupted = next.clone();
    corrupted.terminal.as_mut().unwrap().proof = reply(&batch(2, 14, 5), 15).proof;
    assert!(corrupted.validate().is_err());
    let mut reused = next.clone();
    reused.flight.as_mut().unwrap().body = FrozenBody::new(&batch(1, 14, 5));
    assert!(reused.validate().is_err());
}

#[test]
fn bounded_base64_and_remote_scope_refuse_malformed_or_inactive_evidence() {
    let mut value = frozen();
    value.flight.as_mut().unwrap().body.bytes.push('=');
    assert!(value.validate().is_err());
    assert!(decode_base64(
        &"a".repeat(MAX_BODY_BASE64 + 1),
        MAX_BODY_BASE64,
        MAX_BATCH_BYTES
    )
    .is_err());
    let batch = batch(1, 12, 4);
    let binding = Binding::from_scope(&batch.scope());
    let mut observed = progress(&batch);
    observed.active = false;
    assert!(observed.checked(&binding).is_err());
    observed.active = true;
    observed.scope.binding.generation = h(9);
    assert!(observed.checked(&binding).is_err());
}
