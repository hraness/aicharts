//! Scheduled-publisher cases use only synthetic ledgers and sealed test authority.
use super::*;
use crate::state::CollectionReport;
use crate::sync::Report;

fn prepared(fixture: &Fixture, count: u64) -> Ledger {
    let ledger = fixture.initialize(count, true);
    let revision = ledger.snapshot().unwrap().revision;
    drop(ledger);
    Ledger::migrate_complete_prefix(&fixture.path(), &identity(), revision).unwrap()
}

fn collected(_: &mut Ledger) -> Result<CollectionReport, &'static str> {
    Ok(CollectionReport::default())
}

#[test]
fn preflight_requires_existing_sender_prefix_and_matching_binding_before_collection() {
    for sender in [false, true] {
        let fixture = Fixture::new();
        let mut ledger = fixture.initialize(1, sender);
        let revision = ledger.snapshot().unwrap().revision;
        let mut client = transport(|_, _| panic!("no exchange before qualification"));
        let mut report = Report::default();
        assert_eq!(
            sync_with(
                &mut ledger,
                &mut client,
                8,
                false,
                &mut report,
                |_| panic!("no source read before qualification"),
                |_| {}
            ),
            Err(if sender {
                "ledger_prefix_not_enabled"
            } else {
                "ledger_sender_not_enabled"
            })
        );
        assert_eq!(ledger.snapshot().unwrap().revision, revision);
        assert_eq!(report.exit_code(), 2);
        assert!(report.collection.is_none());
    }
    let fixture = Fixture::new();
    let mut ledger = prepared(&fixture, 1);
    let mut client = transport(|_, _| panic!("no exchange for wrong binding"));
    client.binding.device_id = [0x44; 32];
    let mut report = Report::default();
    assert_eq!(
        sync_with(
            &mut ledger,
            &mut client,
            8,
            false,
            &mut report,
            |_| panic!("no source read for wrong binding"),
            |_| {}
        ),
        Err("upload_binding_mismatch")
    );
}

#[test]
fn drains_exactly_the_batch_budget_then_a_later_pass_completes() {
    let fixture = Fixture::new();
    let mut ledger = prepared(&fixture, 258);
    let mut client = transport(|request, body| body.append(&accepted(request)));
    let mut report = Report::default();
    sync_with(
        &mut ledger,
        &mut client,
        1,
        false,
        &mut report,
        collected,
        |_| {},
    )
    .unwrap();
    assert_eq!(report.exit_code(), 3);
    assert_eq!(report.status, "pending");
    assert_eq!(report.pending_records, Some(2));
    assert_eq!(report.acknowledged_records, 256);
    assert_eq!(report.batches_attempted, 1);
    assert_eq!(client.calls.len(), 1);
    drop(ledger);
    let mut ledger = fixture.reopen();
    let mut report = Report::default();
    sync_with(
        &mut ledger,
        &mut client,
        1,
        false,
        &mut report,
        collected,
        |_| {},
    )
    .unwrap();
    assert_eq!(report.exit_code(), 0);
    assert_eq!(report.pending_records, Some(0));
    assert_eq!(report.acknowledged_records, 2);
    assert_eq!(client.calls.len(), 2);
}

#[test]
fn empty_prepared_queue_completes_without_an_exchange() {
    let fixture = Fixture::new();
    let mut ledger = prepared(&fixture, 0);
    let mut client = transport(|_, _| panic!("empty queue cannot send"));
    let mut report = Report::default();
    sync_with(
        &mut ledger,
        &mut client,
        8,
        false,
        &mut report,
        collected,
        |_| {},
    )
    .unwrap();
    assert_eq!(report.exit_code(), 0);
    assert_eq!(report.batches_attempted, 0);
    assert!(report.collection.is_some());
}

#[test]
fn uncertainty_stops_and_retained_recovery_is_explicit_and_byte_identical() {
    let fixture = Fixture::new();
    let mut ledger = prepared(&fixture, 2);
    let mut uncertain = transport(|_, _| Err(TransportError::Uncertain));
    let mut report = Report::default();
    // The flag does not authorize an in-place speculative replay of new uncertainty.
    assert_eq!(
        sync_with(
            &mut ledger,
            &mut uncertain,
            8,
            true,
            &mut report,
            collected,
            |_| {}
        ),
        Err("upload_transport_uncertain")
    );
    assert_eq!(uncertain.calls.len(), 1);
    assert_eq!(report.exit_code(), 2);
    assert_eq!(report.inflight_operations, Some(2));
    drop(ledger);
    let mut ledger = fixture.reopen();
    let mut client = transport(|request, body| body.append(&accepted(request)));
    let mut report = Report::default();
    assert_eq!(
        sync_with(
            &mut ledger,
            &mut client,
            8,
            false,
            &mut report,
            |_| panic!("unapproved recovery must not collect"),
            |_| {}
        ),
        Err("upload_recovery_required")
    );
    assert!(client.calls.is_empty());
    assert_eq!(report.status, "recovery_required");
    let mut report = Report::default();
    sync_with(
        &mut ledger,
        &mut client,
        1,
        true,
        &mut report,
        collected,
        |_| {},
    )
    .unwrap();
    assert_eq!(client.calls, uncertain.calls);
    assert_eq!(report.batches_attempted, 1);
    assert_eq!(report.exit_code(), 0);
}

#[test]
fn recovery_consumes_the_pass_budget_and_new_work_remains_pending() {
    let fixture = Fixture::new();
    let mut ledger = prepared(&fixture, 258);
    let page = ledger.pending(None, 256, None).unwrap();
    let ids: Vec<_> = page.entries.iter().map(|entry| entry.id).collect();
    ledger
        .freeze_upload_batch(page.ledger_revision, &ids)
        .unwrap();
    let mut client = transport(|request, body| body.append(&accepted(request)));
    let mut report = Report::default();
    sync_with(
        &mut ledger,
        &mut client,
        1,
        true,
        &mut report,
        collected,
        |_| {},
    )
    .unwrap();
    assert_eq!(report.exit_code(), 3);
    assert_eq!(report.pending_records, Some(2));
    assert_eq!(client.calls.len(), 1);
}

#[test]
fn rejected_and_revoked_journals_settle_durably_but_never_report_success() {
    for revoked in [false, true] {
        let fixture = Fixture::new();
        let mut ledger = prepared(&fixture, 2);
        let mut client = transport(|request, body| {
            body.append(&journal(
                request,
                if revoked {
                    &[wire::Outcome::DeviceRevoked, wire::Outcome::DeviceRevoked]
                } else {
                    &[
                        wire::Outcome::PredecessorConflict,
                        wire::Outcome::BatchAborted,
                    ]
                },
            ))
        });
        let mut report = Report::default();
        let error = if revoked {
            "upload_device_revoked"
        } else {
            "upload_reconciliation_required"
        };
        assert_eq!(
            sync_with(
                &mut ledger,
                &mut client,
                8,
                false,
                &mut report,
                collected,
                |_| {}
            ),
            Err(error)
        );
        assert_eq!(report.exit_code(), 2);
        assert_eq!(report.status, "rejected");
        assert_eq!(report.batches_settled, 1);
        assert_eq!(report.inflight_operations, Some(0));
        drop(ledger);
        let mut ledger = fixture.reopen();
        let mut report = Report::default();
        assert_eq!(
            sync_with(
                &mut ledger,
                &mut client,
                8,
                true,
                &mut report,
                |_| panic!("rejected state cannot collect"),
                |_| {}
            ),
            Err(error)
        );
        assert_eq!(client.calls.len(), 1);
    }
    assert_eq!(
        require_accepted(&BatchSettlement::Rejected {
            ledger_revision: 1,
            conflicted_records: 1,
            aborted_records: 0,
            device_revoked: false,
        }),
        Err("upload_reconciliation_required")
    );
}

#[test]
fn collection_error_preserves_committed_local_work_without_uploading_it() {
    let fixture = Fixture::new();
    let mut ledger = prepared(&fixture, 0);
    let mut client = transport(|_, _| panic!("collection failure cannot send"));
    let mut report = Report::default();
    let result = sync_with(
        &mut ledger,
        &mut client,
        8,
        false,
        &mut report,
        |ledger| {
            let source = scan(100, vec![usage(1, 10)]);
            let revision = ledger.snapshot().unwrap().revision;
            ledger
                .commit_prefix_scans(
                    revision,
                    vec![aicharts_ledger::PrefixScan {
                        source_id: source.source_id,
                        stamp: source.stamp,
                        previous: None,
                        complete: aicharts_ledger::CompletePrefix {
                            profile: 1,
                            bytes: 100,
                            mac: [6; 32],
                        },
                        collection: source.collection,
                    }],
                )
                .unwrap();
            Err("malformed_record")
        },
        |_| {},
    );
    assert_eq!(result, Err("malformed_record"));
    assert_eq!(report.pending_records, Some(1));
    assert!(report.collection.is_none());
    assert_eq!(report.batches_attempted, 0);
    drop(ledger);
    assert_eq!(fixture.reopen().status().unwrap().pending_records, 1);
}

#[test]
fn complete_prefix_adapter_collects_synthetic_source_and_defers_its_tail() {
    let fixture = Fixture::new();
    let mut ledger = prepared(&fixture, 0);
    let source = fixture.0.join("synthetic.jsonl");
    fs::write(&source, concat!(
        "{\"type\":\"session_meta\",\"payload\":{\"id\":\"synthetic\"}}\n",
        "{\"type\":\"event_msg\",\"timestamp\":\"2026-09-10T10:00:00Z\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":10,\"output_tokens\":2},\"last_token_usage\":{\"input_tokens\":10,\"output_tokens\":2}}}}\n",
        "{\"PRIVATE_UNFINISHED_CANARY\":"
    )).unwrap();
    let mut client = transport(|request, body| body.append(&accepted(request)));
    let mut report = Report::default();
    sync_with(
        &mut ledger,
        &mut client,
        8,
        false,
        &mut report,
        |ledger| {
            crate::state::collect_existing_prefix(
                ledger,
                &fixture.path(),
                Path::new("unused-key-path"),
                &[(Provider::Codex, source)],
                &CHECKPOINT,
                &OCCURRENCE,
            )
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(report.exit_code(), 0);
    let collection = report.collection.unwrap();
    assert_eq!(collection.sources_updated, 1);
    assert_eq!(collection.deferred_tails, 1);
    assert_eq!(report.acknowledged_records, 1);
    assert!(!client.calls[0]
        .windows(b"PRIVATE".len())
        .any(|v| v == b"PRIVATE"));
}

#[test]
fn definitely_unavailable_replays_are_bounded_and_preserve_one_flight() {
    let fixture = Fixture::new();
    let mut ledger = prepared(&fixture, 2);
    let mut client = transport(|_, _| Err(TransportError::Unavailable));
    let mut report = Report::default();
    let mut pauses = Vec::new();
    assert_eq!(
        sync_with(
            &mut ledger,
            &mut client,
            8,
            true,
            &mut report,
            collected,
            |n| pauses.push(n)
        ),
        Err("upload_transport_unavailable")
    );
    assert_eq!(pauses, vec![1, 2]);
    assert_eq!(client.calls.len(), 3);
    assert!(client.calls.iter().all(|bytes| bytes == &client.calls[0]));
    assert_eq!(report.batches_attempted, 1);
    assert_eq!(report.inflight_operations, Some(2));
}

#[test]
fn fresh_freeze_cannot_adopt_even_an_identical_existing_flight() {
    let fixture = Fixture::new();
    let mut ledger = prepared(&fixture, 2);
    let revision = ledger.snapshot().unwrap().revision;
    let frozen = ledger
        .freeze_upload_batch(revision, &[id(1), id(2)])
        .unwrap();
    let mut client = transport(|_, _| panic!("fresh selection cannot replay"));
    assert_eq!(
        send_once(
            &mut ledger,
            &mut client,
            Selection::FreezeNew {
                expected_revision: revision,
                occurrence_ids: &[id(1), id(2)],
            }
        ),
        Err(Error::Ledger(aicharts_ledger::Error::UploadInFlight))
    );
    assert_eq!(ledger.inflight_batch().unwrap(), Some(frozen));
}

#[test]
fn a_flight_created_during_collection_requires_another_explicit_recovery_pass() {
    let fixture = Fixture::new();
    let mut ledger = prepared(&fixture, 2);
    let mut client = transport(|_, _| panic!("newly observed flight cannot replay"));
    let mut report = Report::default();
    assert_eq!(
        sync_with(
            &mut ledger,
            &mut client,
            8,
            true,
            &mut report,
            |ledger| {
                let revision = ledger.snapshot().unwrap().revision;
                ledger
                    .freeze_upload_batch(revision, &[id(1), id(2)])
                    .unwrap();
                collected(ledger)
            },
            |_| {}
        ),
        Err("upload_recovery_required")
    );
    assert_eq!(report.batches_attempted, 0);
}

#[test]
fn unavailable_replay_never_adopts_a_concurrent_successor_flight() {
    let fixture = Fixture::new();
    let mut ledger = prepared(&fixture, 3);
    let revision = ledger.snapshot().unwrap().revision;
    let mut client = transport(|_, _| Err(TransportError::Unavailable));
    let mut successor = None;
    let result = send_with_replay(
        &mut ledger,
        &mut client,
        Selection::FreezeNew {
            expected_revision: revision,
            occurrence_ids: &[id(1), id(2)],
        },
        |_| {
            let mut other = fixture.reopen();
            let request = UploadRequest {
                binding: BINDING,
                frozen: other.inflight_batch().unwrap().unwrap(),
            };
            other.settle_upload_batch(&accepted(&request)).unwrap();
            let revision = other.snapshot().unwrap().revision;
            successor = Some(other.freeze_upload_batch(revision, &[id(3)]).unwrap());
        },
    );
    assert_eq!(result, Err(Error::RetainedBatchChanged));
    assert_eq!(client.calls.len(), 1);
    assert_eq!(ledger.inflight_batch().unwrap(), successor);
    assert_eq!(ledger.status().unwrap().pending_records, 1);
}

#[test]
fn concurrent_rejected_settlement_remains_unhealthy_when_result_is_already_settled() {
    for revoked in [false, true] {
        let fixture = Fixture::new();
        let mut ledger = prepared(&fixture, 1);
        let revision = ledger.snapshot().unwrap().revision;
        let mut client = transport(|request, body| {
            let reply = journal(
                request,
                &[if revoked {
                    wire::Outcome::DeviceRevoked
                } else {
                    wire::Outcome::PredecessorConflict
                }],
            );
            let mut other = fixture.reopen();
            other.settle_upload_batch(&reply).unwrap();
            body.append(&reply)
        });
        let settlement = send_once(
            &mut ledger,
            &mut client,
            Selection::FreezeNew {
                expected_revision: revision,
                occurrence_ids: &[id(1)],
            },
        )
        .unwrap();
        assert!(matches!(settlement, BatchSettlement::AlreadySettled { .. }));
        assert_eq!(require_accepted(&settlement), Ok(()));
        assert_eq!(
            require_healthy(&ledger.sender_status().unwrap()),
            Err(if revoked {
                "upload_device_revoked"
            } else {
                "upload_reconciliation_required"
            })
        );
    }
}
