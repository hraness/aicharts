use super::*;
use crate::contribution_sync::{
    tests::{batch, h, status_value},
    TerminalProof,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
fn request(batch: &PreparedBatch) -> StatusRequest {
    StatusRequest::new(
        &Binding::from_scope(&batch.scope()),
        batch.scope().population_id(),
        Some(batch),
    )
    .unwrap()
}

#[test]
fn exact_status_proof_preserves_original_reply_and_never_masquerades_as_direct() {
    let batch = batch(1, 12, 4);
    let mut bytes = serde_json::to_vec(&status_value(&batch, Some("committed"), 13, 2)).unwrap();
    bytes.push(b'\n');
    let checked = status(200, &bytes, &request(&batch), Some(&batch)).unwrap();
    assert_eq!(checked.terminal.unwrap().revision(), 13);
    let proof = TerminalProof::Status(STANDARD.encode(&bytes));
    assert_eq!(proof.correlate(&batch), Ok(13));
    assert!(TerminalProof::Direct(STANDARD.encode(&bytes))
        .correlate(&batch)
        .is_err());
    assert_eq!(
        serde_json::to_value(&proof).unwrap()["reply"],
        STANDARD.encode(&bytes)
    );
}
#[test]
fn missing_and_pending_operation_never_authorize_retirement() {
    let batch = batch(1, 12, 4);
    for outcome in [None, Some("pending")] {
        let bytes = serde_json::to_vec(&status_value(&batch, outcome, 12, 1)).unwrap();
        let checked = status(200, &bytes, &request(&batch), Some(&batch)).unwrap();
        assert!(checked.terminal.is_none());
        assert!(checked.position.is_some());
        assert!(status_terminal(&bytes, &batch).is_err());
    }
}
#[test]
fn exact_terminal_remains_valid_when_population_writer_changed() {
    let batch = batch(1, 12, 4);
    let mut value = status_value(&batch, Some("committed"), 14, 2);
    value["result"]["value"]["population"]["deviceId"] = json!(h(333));
    value["result"]["value"]["population"]["writerRevision"] = json!(2);
    let checked = status(
        200,
        &serde_json::to_vec(&value).unwrap(),
        &request(&batch),
        Some(&batch),
    )
    .unwrap();
    assert!(checked.position.is_none());
    assert_eq!(checked.terminal.unwrap().revision(), 13);
}
#[test]
fn status_refuses_foreign_scope_body_history_and_contradictory_outcomes() {
    let batch = batch(1, 12, 4);
    for (path, replacement) in [
        ("/result/value/accountId", json!(format!("acct_{:032x}", 9))),
        ("/result/value/generation", json!(h(9))),
        ("/result/value/population/id", json!(h(9))),
        ("/result/value/population/revision", json!(0)),
        ("/result/value/population/headHash", json!(h(9))),
        ("/result/value/operation/bodyHash", json!(h(9))),
        ("/result/value/operation/operationId", json!(h(9))),
        ("/result/value/operation/outcome", json!("pending")),
        (
            "/result/value/operation/terminal/receipt/populationHead",
            json!(h(9)),
        ),
        (
            "/result/value/operation/terminal/receipt/deviceId",
            json!(h(9)),
        ),
        ("/result/value/revision", json!(12)),
        ("/result/value/nextSequence", json!(1)),
    ] {
        let mut value = status_value(&batch, Some("committed"), 13, 2);
        *value.pointer_mut(path).unwrap() = replacement;
        assert!(
            status(
                200,
                &serde_json::to_vec(&value).unwrap(),
                &request(&batch),
                Some(&batch)
            )
            .is_err(),
            "{path}"
        );
    }
    let bytes = serde_json::to_vec(&status_value(&batch, Some("committed"), 13, 2)).unwrap();
    let none = StatusRequest::new(
        &Binding::from_scope(&batch.scope()),
        batch.scope().population_id(),
        None,
    )
    .unwrap();
    assert!(status(200, &bytes, &none, None).is_err());
}

#[test]
fn current_population_may_advance_but_never_predate_a_committed_terminal() {
    let batch = batch(1, 12, 4);
    let mut value = status_value(&batch, Some("committed"), 15, 2);
    value["result"]["value"]["population"]["revision"] = json!(2);
    value["result"]["value"]["population"]["headHash"] = json!(h(99));
    assert!(status(
        200,
        &serde_json::to_vec(&value).unwrap(),
        &request(&batch),
        Some(&batch)
    )
    .unwrap()
    .terminal
    .is_some());
    value["result"]["value"]["population"]["revision"] = json!(0);
    value["result"]["value"]["population"]["headHash"] = json!(h(0));
    assert!(status(
        200,
        &serde_json::to_vec(&value).unwrap(),
        &request(&batch),
        Some(&batch)
    )
    .is_err());
}
#[test]
fn required_nulls_duplicate_fields_and_closed_error_status_mapping_are_strict() {
    let batch = batch(1, 12, 4);
    let mut value = status_value(&batch, None, 12, 1);
    value["result"]["value"]
        .as_object_mut()
        .unwrap()
        .remove("operation");
    assert!(status(
        200,
        &serde_json::to_vec(&value).unwrap(),
        &request(&batch),
        Some(&batch)
    )
    .is_err());
    let text = serde_json::to_string(&status_value(&batch, Some("committed"), 13, 2)).unwrap();
    let duplicate = text.replace(
        "\"committedAtMs\":1001",
        "\"committedAtMs\":1001,\"committedAtMs\":1001",
    );
    assert_ne!(duplicate, text);
    assert!(status(200, duplicate.as_bytes(), &request(&batch), Some(&batch)).is_err());
    for code in [
        "unauthorized",
        "not_enrolled",
        "revoked",
        "generation_conflict",
        "writer_conflict",
        "conflict",
        "population_conflict",
        "predecessor_conflict",
        "subject_deleted",
        "legacy_unresolved",
        "limit",
        "not_started",
        "clock_regressed",
        "storage_invalid",
        "storage_unavailable",
        "recovery_required",
        "invalid_input",
    ] {
        let (expected, fixed) = failure(code).unwrap();
        let bytes = serde_json::to_vec(
            &json!({ "schemaVersion":3, "result": { "ok":false, "error":code } }),
        )
        .unwrap();
        assert_eq!(success(expected, &bytes, MAX_TERMINAL_BYTES), Err(fixed));
        assert_eq!(success(200, &bytes, MAX_TERMINAL_BYTES), Err(INVALID));
        assert_eq!(
            success(
                if expected == 400 { 503 } else { 400 },
                &bytes,
                MAX_TERMINAL_BYTES
            ),
            Err(INVALID)
        );
    }
    assert_eq!(
        success(
            503,
            br#"{"schemaVersion":3,"result":{"ok":false,"error":"PRIVATE_CANARY"}}"#,
            MAX_TERMINAL_BYTES
        ),
        Err(INVALID)
    );
    assert_eq!(
        success(200, &vec![b' '; MAX_TERMINAL_BYTES + 1], MAX_TERMINAL_BYTES),
        Err(INVALID)
    );
    assert!(request(&batch).bytes().unwrap().len() <= STATUS_REQUEST_BYTES);
}
