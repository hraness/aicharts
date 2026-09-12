//! Synthetic numeric state only; no HTTP, credentials or provider session files.
use super::*;
use aicharts_protocol::admission as wire;

#[path = "prefix_tests.rs"]
mod prefix_tests;

const OCCURRENCE_KEY: [u8; 32] = [0x43; 32];
const BINDING: SenderBinding = SenderBinding {
    account_id: [0x11; 16],
    device_id: [0x22; 32],
    generation: [0x33; 32],
    namespace_version: 1,
};

fn identity() -> LedgerIdentity<'static> {
    LedgerIdentity::SplitKeys {
        checkpoint: &KEY,
        occurrence: &OCCURRENCE_KEY,
        namespace_version: 1,
    }
}
fn id(n: u64) -> Id {
    let mut id = [0; 16];
    id[8..].copy_from_slice(&n.to_be_bytes());
    id
}
fn record(n: u64, output: u64) -> Usage {
    let mut value = usage(1, output);
    value.id = id(n);
    value
}
fn setup(count: u64, migrate: bool) -> (Fixture, Ledger) {
    let f = Fixture::new();
    let mut ledger = Ledger::initialize_with_identity(&f.dir(), &identity()).unwrap();
    ledger
        .commit_scans(
            0,
            vec![scan(1, 100, (1..=count).map(|n| record(n, 10)).collect())],
        )
        .unwrap();
    if migrate {
        drop(ledger);
        ledger = Ledger::migrate_sender_v2(&f.dir(), &identity(), 1, &BINDING).unwrap();
    }
    (f, ledger)
}
fn reopen(f: &Fixture) -> Ledger {
    Ledger::open_with_identity(&f.dir(), &identity()).unwrap()
}
fn decoded(frozen: &FrozenBatch) -> wire::Batch {
    let registry = Registry {
        revision: 1,
        models: vec![],
    };
    wire::decode_batch(&frozen.canonical_batch, &policy(&registry)).unwrap()
}
fn journal(frozen: &FrozenBatch, outcomes: &[wire::Outcome]) -> Vec<u8> {
    let batch = decoded(frozen);
    let registry = Registry {
        revision: 1,
        models: vec![],
    };
    assert_eq!(outcomes.len(), batch.operations.len());
    let receipts = batch
        .operations
        .iter()
        .zip(outcomes)
        .map(|(operation, outcome)| {
            let operation_hash = wire::operation_digest(operation, &policy(&registry)).unwrap();
            let head_operation_hash = match outcome {
                wire::Outcome::Inserted | wire::Outcome::Replaced => operation_hash,
                wire::Outcome::Duplicate => [0x77; 32],
                wire::Outcome::PredecessorConflict | wire::Outcome::SubjectDeleted => [0x66; 32],
                wire::Outcome::BatchAborted => operation.expected_head,
                wire::Outcome::DeviceRevoked => [0; 32],
                _ => panic!("native tests do not emit tombstones"),
            };
            wire::Receipt {
                descriptor: operation.descriptor(),
                operation_hash,
                head_operation_hash,
                account_journal_revision: frozen.first_sequence,
                committed_at_ms: 1_800_000_000_000,
                outcome: *outcome,
            }
        })
        .collect();
    let status = if outcomes.iter().all(|outcome| {
        matches!(
            outcome,
            wire::Outcome::Inserted | wire::Outcome::Replaced | wire::Outcome::Duplicate
        )
    }) {
        wire::JournalStatus::Accepted
    } else {
        wire::JournalStatus::Rejected
    };
    wire::encode_journal(&wire::Journal {
        binding: batch.binding,
        first_sequence: frozen.first_sequence,
        batch_hash: frozen.batch_hash,
        account_journal_revision: frozen.first_sequence,
        committed_at_ms: 1_800_000_000_000,
        status,
        receipts,
    })
    .unwrap()
}

#[test]
fn migration_is_explicit_split_only_additive_atomic_and_idempotent() {
    let (f, original) = setup(2, false);
    assert_eq!(
        original.sender_status().err(),
        Some(Error::SenderNotEnabled)
    );
    let old_snapshot = original.snapshot().unwrap();
    let old_frames: Vec<_> = original
        .pending(None, 256, None)
        .unwrap()
        .entries
        .into_iter()
        .map(|r| r.frame)
        .collect();
    drop(original);
    let before = directory_image(&f.dir());
    let inspection = ReadOnlyLedger::open(&f.dir(), &identity()).unwrap();
    assert_eq!(directory_image(&f.dir()), before);
    assert_eq!(
        f.raw()
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        Ledger::migrate_sender_v2(&f.dir(), &LedgerIdentity::Legacy(&KEY), 1, &BINDING).err(),
        Some(Error::SenderBindingMismatch)
    );
    assert_eq!(
        Ledger::migrate_sender_v2(&f.dir(), &identity(), 0, &BINDING).err(),
        Some(Error::StaleRevision)
    );
    assert_eq!(
        Ledger::migrate_sender_with(&f.dir(), &identity(), 1, &BINDING, || Err(Error::Storage))
            .err(),
        Some(Error::Storage)
    );
    assert_eq!(
        f.raw()
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .unwrap(),
        1
    );
    let ledger = Ledger::migrate_sender_v2(&f.dir(), &identity(), 1, &BINDING).unwrap();
    assert_eq!(ledger.snapshot().unwrap().revision, old_snapshot.revision);
    assert_eq!(
        ledger.snapshot().unwrap().checkpoints,
        old_snapshot.checkpoints
    );
    assert_eq!(
        ledger
            .pending(None, 256, None)
            .unwrap()
            .entries
            .into_iter()
            .map(|r| r.frame)
            .collect::<Vec<_>>(),
        old_frames
    );
    assert_eq!(ledger.sender_status().unwrap().allocated_sequence, 0);
    assert_eq!(inspection.ensure_unchanged(), Err(Error::StaleRevision));
    drop(ledger);
    let before = directory_image(&f.dir());
    drop(Ledger::migrate_sender_v2(&f.dir(), &identity(), 0, &BINDING).unwrap());
    assert_eq!(directory_image(&f.dir()), before);
    let wrong = SenderBinding {
        generation: [0x44; 32],
        ..BINDING
    };
    assert_eq!(
        Ledger::migrate_sender_v2(&f.dir(), &identity(), 1, &wrong).err(),
        Some(Error::SenderBindingMismatch)
    );
    assert_eq!(directory_image(&f.dir()), before);
    let inspected = ReadOnlyLedger::open(&f.dir(), &identity()).unwrap();
    assert_eq!(inspected.inventory().len(), 2);
    assert_eq!(directory_image(&f.dir()), before);
}

#[test]
fn invalid_binding_does_not_touch_or_create_state() {
    let f = Fixture::new();
    for bad in [
        SenderBinding {
            account_id: [0; 16],
            ..BINDING
        },
        SenderBinding {
            device_id: [0; 32],
            ..BINDING
        },
        SenderBinding {
            generation: [0; 32],
            ..BINDING
        },
        SenderBinding {
            namespace_version: 0,
            ..BINDING
        },
        SenderBinding {
            namespace_version: 2,
            ..BINDING
        },
    ] {
        assert_eq!(
            Ledger::migrate_sender_v2(&f.dir(), &identity(), 0, &bad).err(),
            Some(Error::SenderBindingMismatch)
        );
        assert!(!f.dir().exists());
    }
}

#[test]
fn freezes_one_bounded_batch_with_contiguous_sequences_before_transport() {
    let (f, mut ledger) = setup(256, true);
    let ids: Vec<_> = (1..=256).rev().map(id).collect();
    let frozen = ledger.freeze_upload_batch(1, &ids).unwrap();
    assert_eq!(frozen.first_sequence, 1);
    assert_eq!(frozen.operation_count, 256);
    assert_eq!(frozen.selected_revision, 1);
    assert_eq!(frozen.canonical_batch.len(), 82_024);
    let decoded = decoded(&frozen);
    assert_eq!(decoded.operations.len(), 256);
    for (index, operation) in decoded.operations.iter().enumerate() {
        assert_eq!(operation.sequence, index as u64 + 1);
        assert_eq!(operation.occurrence_id, id(index as u64 + 1));
        assert_eq!(operation.expected_head, [0; 32]);
    }
    assert_eq!(ledger.status().unwrap().pending_records, 256);
    assert_eq!(ledger.freeze_upload_batch(1, &ids).unwrap(), frozen);
    assert_eq!(
        ledger.freeze_upload_batch(2, &[id(1)]).err(),
        Some(Error::UploadInFlight)
    );
    let mut caller_copy = ledger.inflight_batch().unwrap().unwrap();
    caller_copy.canonical_batch.fill(0);
    drop(ledger);
    let ledger = reopen(&f);
    assert_eq!(ledger.inflight_batch().unwrap(), Some(frozen));
    let before = directory_image(&f.dir());
    let view = ReadOnlyLedger::open(&f.dir(), &identity()).unwrap();
    assert_eq!(view.inventory().len(), 256);
    assert_eq!(directory_image(&f.dir()), before);
}

#[test]
fn freeze_rejects_empty_oversized_duplicate_unknown_and_stale_selections() {
    let (f, mut ledger) = setup(2, true);
    let before = directory_image(&f.dir());
    for (ids, expected) in [
        (vec![], Error::Limit),
        ((1..=257).map(id).collect(), Error::Limit),
        (vec![id(1), id(1)], Error::InvalidMeasurement),
        (vec![[0; 16]], Error::InvalidMeasurement),
        (vec![id(3)], Error::InvalidMeasurement),
    ] {
        assert_eq!(ledger.freeze_upload_batch(1, &ids).err(), Some(expected));
    }
    assert_eq!(
        ledger.freeze_upload_batch(0, &[id(1)]).err(),
        Some(Error::StaleRevision)
    );
    assert_eq!(directory_image(&f.dir()), before);
    assert!(ledger.inflight_batch().unwrap().is_none());
    assert_eq!(ledger.sender_status().unwrap().allocated_sequence, 0);
}

#[test]
fn accepted_journal_atomically_acknowledges_exact_members_and_is_retry_safe() {
    let (f, mut ledger) = setup(3, true);
    let frozen = ledger.freeze_upload_batch(1, &[id(1), id(2)]).unwrap();
    let reply = journal(
        &frozen,
        &[wire::Outcome::Inserted, wire::Outcome::Duplicate],
    );
    assert_eq!(
        ledger.settle_upload_batch(&reply).unwrap(),
        BatchSettlement::Accepted {
            ledger_revision: 3,
            cleared_records: 2,
            retained_newer: 0
        }
    );
    assert_eq!(ledger.status().unwrap().pending_records, 1);
    assert_eq!(ledger.status().unwrap().usage_occurrences, 3);
    assert_eq!(ledger.sender_status().unwrap().accepted_occurrences, 2);
    assert!(ledger.inflight_batch().unwrap().is_none());
    let before = directory_image(&f.dir());
    assert_eq!(
        ledger.settle_upload_batch(&reply).unwrap(),
        BatchSettlement::AlreadySettled { ledger_revision: 3 }
    );
    assert_eq!(directory_image(&f.dir()), before);
    drop(ledger);
    let mut ledger = reopen(&f);
    assert_eq!(
        ledger.settle_upload_batch(&reply).unwrap(),
        BatchSettlement::AlreadySettled { ledger_revision: 3 }
    );
    let next = ledger.freeze_upload_batch(3, &[id(3)]).unwrap();
    assert_eq!(next.first_sequence, 3);
    assert_eq!(
        ledger.settle_upload_batch(&reply).unwrap(),
        BatchSettlement::AlreadySettled { ledger_revision: 4 }
    );
    assert_eq!(ledger.inflight_batch().unwrap(), Some(next));
    let before = directory_image(&f.dir());
    assert_eq!(
        ReadOnlyLedger::open(&f.dir(), &identity())
            .unwrap()
            .inventory()
            .len(),
        3
    );
    assert_eq!(directory_image(&f.dir()), before);
}

#[test]
fn maximum_terminal_journal_and_last_settled_pair_fit_the_bounded_sqlite_row() {
    let (f, mut ledger) = setup(256, true);
    let frozen = ledger
        .freeze_upload_batch(1, &(1..=256).map(id).collect::<Vec<_>>())
        .unwrap();
    let reply = journal(&frozen, &vec![wire::Outcome::Inserted; 256]);
    assert_eq!(reply.len(), 67_744);
    assert_eq!(
        ledger.settle_upload_batch(&reply).unwrap(),
        BatchSettlement::Accepted {
            ledger_revision: 3,
            cleared_records: 256,
            retained_newer: 0
        }
    );
    drop(ledger);
    let ledger = reopen(&f);
    assert_eq!(ledger.status().unwrap().pending_records, 0);
    assert_eq!(ledger.sender_status().unwrap().settled_sequence, 256);
    assert_eq!(
        ReadOnlyLedger::open(&f.dir(), &identity())
            .unwrap()
            .inventory()
            .len(),
        256
    );
}

#[test]
fn accepted_old_flight_preserves_newer_correction_and_uses_receipt_head_next_time() {
    let (f, mut ledger) = setup(2, true);
    let frozen = ledger.freeze_upload_batch(1, &[id(1), id(2)]).unwrap();
    ledger
        .commit_scans(2, vec![scan(1, 200, vec![record(1, 20), record(2, 10)])])
        .unwrap();
    assert_eq!(
        ledger.freeze_upload_batch(1, &[id(1), id(2)]).unwrap(),
        frozen
    );
    let reply = journal(
        &frozen,
        &[wire::Outcome::Duplicate, wire::Outcome::Inserted],
    );
    assert_eq!(
        ledger.settle_upload_batch(&reply).unwrap(),
        BatchSettlement::Accepted {
            ledger_revision: 4,
            cleared_records: 1,
            retained_newer: 1
        }
    );
    let pending = ledger.pending(None, 256, None).unwrap();
    assert_eq!(pending.entries.len(), 1);
    assert_eq!(pending.entries[0].revision, 3);
    assert_eq!(pending.entries[0].frame, frame(record(1, 20)));
    let next = ledger.freeze_upload_batch(4, &[id(1)]).unwrap();
    assert_eq!(next.first_sequence, 3);
    assert_eq!(decoded(&next).operations[0].expected_head, [0x77; 32]);
    let next_reply = journal(&next, &[wire::Outcome::Replaced]);
    ledger.settle_upload_batch(&next_reply).unwrap();
    assert_eq!(ledger.status().unwrap().pending_records, 0);
    assert_eq!(ledger.sender_status().unwrap().accepted_occurrences, 2);
    assert_eq!(
        ledger.settle_upload_batch(&reply).err(),
        Some(Error::InvalidReceipt)
    );
    drop(ledger);
    assert_eq!(reopen(&f).status().unwrap().output_tokens, 30);
}

#[test]
fn one_malformed_mismatched_or_staged_reply_never_partially_acknowledges() {
    let (f, mut ledger) = setup(2, true);
    let frozen = ledger.freeze_upload_batch(1, &[id(1), id(2)]).unwrap();
    let valid = journal(&frozen, &[wire::Outcome::Inserted; 2]);
    let before = directory_image(&f.dir());
    for offset in [
        0,
        8,
        16,
        32,
        64,
        96,
        104,
        152,
        153,
        160 + 264 + 184,
        160 + 264 + 216,
    ] {
        let mut malformed = valid.clone();
        malformed[offset] ^= 1;
        assert_eq!(
            ledger.settle_upload_batch(&malformed).err(),
            Some(Error::InvalidReceipt),
            "offset {offset}"
        );
        assert_eq!(directory_image(&f.dir()), before);
    }
    for malformed in [
        vec![],
        valid[..valid.len() - 1].to_vec(),
        vec![0; 67_745],
        br#"{"status":"staged","accepted":false}"#.to_vec(),
    ] {
        assert_eq!(
            ledger.settle_upload_batch(&malformed).err(),
            Some(Error::InvalidReceipt)
        );
    }
    assert_eq!(ledger.status().unwrap().pending_records, 2);
    assert_eq!(ledger.inflight_batch().unwrap(), Some(frozen));
    assert_eq!(ledger.sender_status().unwrap().settled_sequence, 0);
    assert_eq!(directory_image(&f.dir()), before);
}

#[test]
fn terminal_rejection_keeps_usage_and_durable_gates_without_automatic_rebase() {
    let (f, mut ledger) = setup(4, true);
    let frozen = ledger
        .freeze_upload_batch(1, &[id(1), id(2), id(3)])
        .unwrap();
    let reply = journal(
        &frozen,
        &[
            wire::Outcome::PredecessorConflict,
            wire::Outcome::SubjectDeleted,
            wire::Outcome::BatchAborted,
        ],
    );
    assert_eq!(
        ledger.settle_upload_batch(&reply).unwrap(),
        BatchSettlement::Rejected {
            ledger_revision: 3,
            conflicted_records: 2,
            aborted_records: 1,
            device_revoked: false
        }
    );
    assert_eq!(ledger.status().unwrap().pending_records, 4);
    assert_eq!(ledger.sender_status().unwrap().reconciliation_required, 2);
    assert_eq!(ledger.sender_status().unwrap().settled_sequence, 3);
    assert_eq!(ledger.sender_status().unwrap().accepted_occurrences, 0);
    ledger
        .commit_scans(
            3,
            vec![scan(
                1,
                200,
                vec![record(1, 20), record(2, 30), record(3, 10), record(4, 10)],
            )],
        )
        .unwrap();
    drop(ledger);
    let mut ledger = reopen(&f);
    assert_eq!(
        ledger.freeze_upload_batch(4, &[id(1)]).err(),
        Some(Error::ReconciliationRequired)
    );
    assert_eq!(
        ledger.freeze_upload_batch(4, &[id(2)]).err(),
        Some(Error::ReconciliationRequired)
    );
    let next = ledger.freeze_upload_batch(4, &[id(3), id(4)]).unwrap();
    assert_eq!(next.first_sequence, 4);
    assert!(decoded(&next)
        .operations
        .iter()
        .all(|operation| operation.expected_head == [0; 32]));
    ledger
        .settle_upload_batch(&journal(&next, &[wire::Outcome::Inserted; 2]))
        .unwrap();
    assert_eq!(ledger.sender_status().unwrap().reconciliation_required, 2);
    assert_eq!(ledger.status().unwrap().pending_records, 2);
    assert_eq!(
        ReadOnlyLedger::open(&f.dir(), &identity())
            .unwrap()
            .inventory()
            .len(),
        4
    );
}

#[test]
fn revocation_terminal_globally_blocks_the_bound_device_across_restart() {
    let (f, mut ledger) = setup(2, true);
    let frozen = ledger.freeze_upload_batch(1, &[id(1)]).unwrap();
    let reply = journal(&frozen, &[wire::Outcome::DeviceRevoked]);
    assert_eq!(
        ledger.settle_upload_batch(&reply).unwrap(),
        BatchSettlement::Rejected {
            ledger_revision: 3,
            conflicted_records: 0,
            aborted_records: 0,
            device_revoked: true
        }
    );
    drop(ledger);
    let mut ledger = reopen(&f);
    assert!(ledger.sender_status().unwrap().device_revoked);
    assert_eq!(
        ledger.freeze_upload_batch(3, &[id(2)]).err(),
        Some(Error::DeviceRevoked)
    );
    assert_eq!(ledger.status().unwrap().pending_records, 2);
    assert_eq!(
        ledger.settle_upload_batch(&reply).unwrap(),
        BatchSettlement::AlreadySettled { ledger_revision: 3 }
    );
}

#[test]
fn transaction_failures_preserve_sequence_flight_receipts_and_pending_values() {
    let (f, mut ledger) = setup(2, true);
    assert_eq!(
        ledger
            .freeze_with(1, &[id(1), id(2)], || Err(Error::Storage))
            .err(),
        Some(Error::Storage)
    );
    assert_eq!(ledger.sender_status().unwrap().allocated_sequence, 0);
    assert!(ledger.inflight_batch().unwrap().is_none());
    assert_eq!(ledger.status().unwrap().revision, 1);
    let frozen = ledger.freeze_upload_batch(1, &[id(1), id(2)]).unwrap();
    let reply = journal(&frozen, &[wire::Outcome::Inserted; 2]);
    assert_eq!(
        ledger.settle_with(&reply, || Err(Error::Storage)).err(),
        Some(Error::Storage)
    );
    drop(ledger);
    let mut ledger = reopen(&f);
    assert_eq!(ledger.inflight_batch().unwrap(), Some(frozen));
    assert_eq!(ledger.sender_status().unwrap().settled_sequence, 0);
    assert_eq!(ledger.sender_status().unwrap().accepted_occurrences, 0);
    assert_eq!(ledger.status().unwrap().pending_records, 2);
    ledger.settle_upload_batch(&reply).unwrap();
}

#[test]
fn last_settled_readback_is_exact_owned_and_never_rebases_or_mutates() {
    let (f, mut ledger) = setup(2, true);
    assert!(ledger.last_settled_batch().unwrap().is_none());
    let frozen = ledger.freeze_upload_batch(1, &[id(1)]).unwrap();
    let reply = journal(&frozen, &[wire::Outcome::PredecessorConflict]);
    ledger.settle_upload_batch(&reply).unwrap();
    let expected = SettledBatch {
        canonical_batch: frozen.canonical_batch,
        batch_hash: frozen.batch_hash,
        terminal_journal: reply,
    };
    assert_eq!(ledger.last_settled_batch().unwrap(), Some(expected.clone()));
    let mut copy = ledger.last_settled_batch().unwrap().unwrap();
    copy.terminal_journal.fill(0);
    drop(ledger);
    let before = directory_image(&f.dir());
    assert_eq!(reopen(&f).last_settled_batch().unwrap(), Some(expected));
    assert_eq!(directory_image(&f.dir()), before);
}

#[test]
fn repeated_corrections_bound_acceptance_and_terminal_history_by_occurrence() {
    let (f, mut ledger) = setup(1, true);
    let mut revision = 1;
    for sequence in 1..=24 {
        let frozen = ledger.freeze_upload_batch(revision, &[id(1)]).unwrap();
        assert_eq!(frozen.first_sequence, sequence);
        let outcome = if sequence == 1 {
            wire::Outcome::Inserted
        } else {
            wire::Outcome::Replaced
        };
        ledger
            .settle_upload_batch(&journal(&frozen, &[outcome]))
            .unwrap();
        revision += 2;
        assert_eq!(ledger.sender_status().unwrap().accepted_occurrences, 1);
        assert_eq!(
            crate::table_count(&ledger.connection, "sender_settled").unwrap(),
            1
        );
        assert_eq!(
            crate::table_count(&ledger.connection, "sender_batch_members").unwrap(),
            0
        );
        if sequence < 24 {
            ledger
                .commit_scans(
                    revision,
                    vec![scan(1, 100 + sequence, vec![record(1, 10 + sequence)])],
                )
                .unwrap();
            revision += 1;
        }
    }
    drop(ledger);
    assert_eq!(reopen(&f).sender_status().unwrap().settled_sequence, 24);
}

#[test]
fn concurrent_connections_share_one_frozen_range_and_ack_invalidates_pages() {
    let (f, mut first) = setup(3, true);
    let mut other = reopen(&f);
    let frozen = first.freeze_upload_batch(1, &[id(1), id(2)]).unwrap();
    assert_eq!(
        other.freeze_upload_batch(1, &[id(2), id(1)]).unwrap(),
        frozen
    );
    assert_eq!(
        other.freeze_upload_batch(1, &[id(3)]).err(),
        Some(Error::UploadInFlight)
    );
    assert_eq!(
        other.commit_scans(1, vec![]).err(),
        Some(Error::StaleRevision)
    );
    let page = first.pending(None, 1, None).unwrap();
    let reply = journal(&frozen, &[wire::Outcome::Inserted; 2]);
    other.settle_upload_batch(&reply).unwrap();
    assert_eq!(
        first
            .pending(page.next_after, 1, Some(page.ledger_revision))
            .err(),
        Some(Error::StaleRevision)
    );
    assert_eq!(first.sender_status().unwrap().settled_sequence, 2);
    assert_eq!(
        first
            .freeze_upload_batch(3, &[id(3)])
            .unwrap()
            .first_sequence,
        3
    );
}

#[test]
fn malformed_sender_state_is_retained_without_reset_or_silent_schema_fallback() {
    for sql in [
        "UPDATE sender_binding SET generation=zeroblob(32)",
        "UPDATE sender_binding SET generation=x'4444444444444444444444444444444444444444444444444444444444444444'",
        "UPDATE sender_binding SET allocated_sequence=3",
        "UPDATE sender_binding SET settled_sequence=1",
        "DELETE FROM sender_binding", "DELETE FROM sender_batch",
        "UPDATE sender_batch SET selected_revision=100",
        "UPDATE sender_batch SET first_sequence=2",
        "UPDATE sender_batch SET operation_count=1",
        "UPDATE sender_batch SET batch_hash=zeroblob(32)",
        "UPDATE sender_batch SET canonical_batch=zeroblob(length(canonical_batch))",
        "DELETE FROM sender_batch_members WHERE ordinal=1",
        "UPDATE sender_batch_members SET measurement_revision=2 WHERE ordinal=1",
        "UPDATE sender_batch_members SET ordinal=2 WHERE ordinal=1",
        "DELETE FROM outbox WHERE id=x'00000000000000000000000000000001'",
        "PRAGMA user_version=1", "PRAGMA user_version=3",
        "CREATE TABLE unexpected_sender(data TEXT)",
    ] {
        let (f, mut ledger) = setup(2, true);
        ledger.freeze_upload_batch(1, &[id(1), id(2)]).unwrap();
        drop(ledger);
        f.raw().execute_batch(&format!("PRAGMA ignore_check_constraints=ON; {sql}")).unwrap();
        let before = directory_image(&f.dir());
        assert!(Ledger::open_with_identity(&f.dir(), &identity()).is_err(), "accepted {sql}");
        assert!(ReadOnlyLedger::open(&f.dir(), &identity()).is_err(), "readonly accepted {sql}");
        assert_eq!(directory_image(&f.dir()), before, "changed {sql}");
    }
}

#[test]
fn accepted_and_terminal_receipt_corruption_cannot_manufacture_coverage() {
    for sql in [
        "DELETE FROM sender_accepted WHERE sequence=1",
        "UPDATE sender_accepted SET local_revision=2",
        "UPDATE sender_accepted SET receipt=zeroblob(264)",
        "UPDATE sender_accepted SET operation=zeroblob(320)",
        "DELETE FROM sender_settled",
        "UPDATE sender_settled SET batch_hash=zeroblob(32)",
        "UPDATE sender_settled SET canonical_terminal_journal=zeroblob(length(canonical_terminal_journal))",
        "UPDATE sender_binding SET settled_sequence=1,allocated_sequence=1",
        "INSERT INTO outbox SELECT id,revision,frame FROM measurements WHERE id=x'00000000000000000000000000000001'",
    ] {
        let (f, mut ledger) = setup(2, true);
        let frozen = ledger.freeze_upload_batch(1, &[id(1), id(2)]).unwrap();
        ledger.settle_upload_batch(&journal(&frozen, &[wire::Outcome::Inserted; 2])).unwrap();
        drop(ledger);
        f.raw().execute_batch(&format!("PRAGMA ignore_check_constraints=ON; {sql}")).unwrap();
        let before = directory_image(&f.dir());
        assert!(Ledger::open_with_identity(&f.dir(), &identity()).is_err(), "accepted {sql}");
        assert!(ReadOnlyLedger::open(&f.dir(), &identity()).is_err());
        assert_eq!(directory_image(&f.dir()), before);
    }
}

fn with_authority_clock(bytes: &[u8], revision: u64, time: u64) -> Vec<u8> {
    let mut value = wire::decode_journal(bytes).unwrap();
    value.account_journal_revision = revision;
    value.committed_at_ms = time;
    for receipt in &mut value.receipts {
        receipt.account_journal_revision = revision;
        receipt.committed_at_ms = time;
    }
    wire::encode_journal(&value).unwrap()
}

#[test]
fn terminal_authority_revision_and_time_cannot_regress_or_clear_custody() {
    let (f, mut ledger) = setup(2, true);
    let first = ledger.freeze_upload_batch(1, &[id(1)]).unwrap();
    let first_reply = with_authority_clock(
        &journal(&first, &[wire::Outcome::Inserted]),
        10,
        1_800_000_000_100,
    );
    ledger.settle_upload_batch(&first_reply).unwrap();
    let next = ledger.freeze_upload_batch(3, &[id(2)]).unwrap();
    let next_reply = journal(&next, &[wire::Outcome::Inserted]);
    let before = directory_image(&f.dir());
    for (revision, time) in [
        (9, 1_800_000_000_101),
        (10, 1_800_000_000_101),
        (11, 1_800_000_000_099),
    ] {
        assert_eq!(
            ledger.settle_upload_batch(&with_authority_clock(&next_reply, revision, time)),
            Err(Error::InvalidReceipt)
        );
        assert_eq!(ledger.inflight_batch().unwrap(), Some(next.clone()));
        assert_eq!(directory_image(&f.dir()), before);
    }
    assert!(matches!(
        ledger.settle_upload_batch(&first_reply).unwrap(),
        BatchSettlement::AlreadySettled { .. }
    ));
    assert_eq!(directory_image(&f.dir()), before);
    // Other devices may advance the global account journal between this device's
    // batches. Gaps are valid, and equal timestamps are not clock regression.
    ledger
        .settle_upload_batch(&with_authority_clock(&next_reply, 30, 1_800_000_000_100))
        .unwrap();
    assert_eq!(ledger.status().unwrap().pending_records, 0);
}

#[test]
fn retained_accepted_and_conflict_evidence_cannot_postdate_latest_terminal() {
    for outcome in [wire::Outcome::Inserted, wire::Outcome::PredecessorConflict] {
        for corrupt_time in [false, true] {
            let (f, mut ledger) = setup(2, true);
            let first = ledger.freeze_upload_batch(1, &[id(1)]).unwrap();
            ledger
                .settle_upload_batch(&journal(&first, &[outcome]))
                .unwrap();
            let next = ledger.freeze_upload_batch(3, &[id(2)]).unwrap();
            ledger
                .settle_upload_batch(&journal(&next, &[wire::Outcome::Inserted]))
                .unwrap();
            drop(ledger);
            let table = if outcome == wire::Outcome::Inserted {
                "sender_accepted"
            } else {
                "sender_reconciliation"
            };
            let raw = f.raw();
            let bytes: Vec<u8> = raw
                .query_row(
                    &format!("SELECT receipt FROM {table} WHERE id=?1"),
                    [id(1).as_slice()],
                    |row| row.get(0),
                )
                .unwrap();
            let mut receipt = wire::decode_receipt(&bytes).unwrap();
            if corrupt_time {
                receipt.committed_at_ms += 1;
            } else {
                receipt.account_journal_revision = 3;
            }
            raw.execute(
                &format!("UPDATE {table} SET receipt=?1 WHERE id=?2"),
                params![wire::encode_receipt(&receipt).unwrap(), id(1).as_slice()],
            )
            .unwrap();
            drop(raw);
            let before = directory_image(&f.dir());
            assert!(Ledger::open_with_identity(&f.dir(), &identity()).is_err());
            assert!(ReadOnlyLedger::open(&f.dir(), &identity()).is_err());
            assert_eq!(directory_image(&f.dir()), before);
        }
    }
}

#[test]
fn audit_stamp_never_blesses_unselected_same_or_other_connection_corruption() {
    for other_connection in [false, true] {
        for replace in [false, true] {
            let (f, mut ledger) = setup(3, true);
            ledger.sender_status().unwrap();
            let captured = ledger.sender_audit.get().unwrap();
            let external = f.raw();
            let connection = if other_connection {
                &external
            } else {
                &ledger.connection
            };
            let bytes = frame(record(3, 20));
            if replace {
                connection
                    .execute(
                        "INSERT OR REPLACE INTO source_usage(source_id,id,frame) VALUES(?1,?2,?3)",
                        params![[1u8; 32].as_slice(), id(3).as_slice(), bytes],
                    )
                    .unwrap();
            } else {
                connection
                    .execute(
                        "UPDATE source_usage SET frame=?1 WHERE id=?2",
                        params![bytes, id(3).as_slice()],
                    )
                    .unwrap();
            }
            drop(external);
            // Model a writer committing in the tiny interval after a protected
            // stamp was captured but before it was published. Only republishing
            // the old captured stamp is safe; refreshing here would bless it.
            ledger.sender_audit.set(Some(captured));
            assert_eq!(
                ledger.freeze_upload_batch(1, &[id(1)]).err(),
                Some(Error::InvalidState)
            );
            assert!(ledger.sender_audit.get().is_none());
            assert_eq!(
                f.raw()
                    .query_row("SELECT COUNT(*) FROM sender_batch", [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
    }
}

#[test]
fn external_valid_update_without_revision_change_and_collector_invalidate_stamp() {
    let (f, mut ledger) = setup(3, true);
    ledger.sender_status().unwrap();
    let old = ledger.sender_audit.get().unwrap();
    let mut external = f.raw();
    let tx = external.transaction().unwrap();
    let bytes = frame(record(3, 20));
    for table in ["source_usage", "measurements", "outbox"] {
        tx.execute(
            &format!("UPDATE {table} SET frame=?1 WHERE id=?2"),
            params![&bytes, id(3).as_slice()],
        )
        .unwrap();
    }
    tx.commit().unwrap();
    drop(external);
    assert_eq!(ledger.snapshot().unwrap().revision, 1);
    assert_eq!(ledger.sender_status().unwrap().allocated_sequence, 0);
    assert_ne!(ledger.sender_audit.get().unwrap(), old);
    ledger
        .commit_scans(
            1,
            vec![scan(
                1,
                200,
                vec![record(1, 10), record(2, 10), record(3, 30)],
            )],
        )
        .unwrap();
    assert!(ledger.sender_audit.get().is_none());
    let batch = ledger.freeze_upload_batch(2, &[id(3)]).unwrap();
    assert_eq!(
        decoded(&batch).operations[0].kind,
        wire::OperationKind::Put {
            frame: frame(record(3, 30)).try_into().unwrap()
        }
    );
}

#[test]
fn schema_cookie_user_version_revision_and_errors_cannot_reuse_audit_stamp() {
    let (_f, mut ledger) = setup(2, true);
    ledger.sender_status().unwrap();
    let old = ledger.sender_audit.get().unwrap();
    ledger
        .connection
        .execute_batch("PRAGMA schema_version=777")
        .unwrap();
    ledger.sender_status().unwrap();
    assert_ne!(ledger.sender_audit.get().unwrap(), old);
    let old = ledger.sender_audit.get().unwrap();
    ledger
        .connection
        .execute_batch("UPDATE meta SET revision=2")
        .unwrap();
    ledger.sender_status().unwrap();
    assert_ne!(ledger.sender_audit.get().unwrap(), old);
    assert_eq!(ledger.freeze_upload_batch(2, &[]).err(), Some(Error::Limit));
    assert!(ledger.sender_audit.get().is_none());
    ledger.sender_status().unwrap();
    ledger
        .connection
        .execute_batch("PRAGMA user_version=1")
        .unwrap();
    assert!(ledger.sender_status().is_err());
    assert!(ledger.sender_audit.get().is_none());

    let (_f, ledger) = setup(1, true);
    ledger.sender_status().unwrap();
    ledger
        .connection
        .execute_batch("CREATE TABLE alien(value INTEGER)")
        .unwrap();
    assert!(ledger.last_settled_batch().is_err());
    assert!(ledger.sender_audit.get().is_none());
}

#[test]
fn failed_commit_or_callback_never_publishes_postwrite_audit_stamp() {
    for settlement in [false, true] {
        let (f, mut ledger) = setup(2, true);
        let frozen = if settlement {
            Some(ledger.freeze_upload_batch(1, &[id(1)]).unwrap())
        } else {
            None
        };
        ledger.sender_status().unwrap();
        let blocker = f.raw();
        blocker.execute_batch("BEGIN").unwrap();
        assert_eq!(
            blocker
                .query_row("SELECT COUNT(*) FROM measurements", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            2
        );
        let reached = std::cell::Cell::new(false);
        let result = if let Some(frozen) = &frozen {
            ledger
                .settle_with(&journal(frozen, &[wire::Outcome::Inserted]), || {
                    reached.set(true);
                    Ok(())
                })
                .map(|_| ())
        } else {
            ledger
                .freeze_with(1, &[id(1)], || {
                    reached.set(true);
                    Ok(())
                })
                .map(|_| ())
        };
        assert!(
            reached.get(),
            "must reach COMMIT, not fail during earlier SQL"
        );
        assert_eq!(result, Err(Error::Busy));
        assert!(ledger.sender_audit.get().is_none());
        blocker.execute_batch("ROLLBACK").unwrap();
        drop(blocker);
        assert_eq!(ledger.inflight_batch().unwrap(), frozen);
        assert_eq!(ledger.status().unwrap().pending_records, 2);
        if let Some(frozen) = frozen {
            assert_eq!(
                ledger.settle_with(&journal(&frozen, &[wire::Outcome::Inserted]), || Err(
                    Error::Storage
                )),
                Err(Error::Storage)
            );
        } else {
            assert_eq!(
                ledger
                    .freeze_with(1, &[id(1)], || Err(Error::Storage))
                    .err(),
                Some(Error::Storage)
            );
        }
        assert!(ledger.sender_audit.get().is_none());
    }
}

/// Explicit release-mode cost probe, not part of the ordinary test gate. The
/// fixture contains only generated numeric frames. Seeding accepted rows avoids
/// spending the experiment on 387 earlier uploads; a full writer-open audit
/// proves the seeded relational state before timing actual sender operations.
#[test]
#[ignore = "explicit synthetic 100k retained-occurrence cost probe"]
fn sender_100k_cost_probe() {
    use std::time::Instant;
    let start = Instant::now();
    let (f, ledger) = setup(100_000, true);
    drop(ledger);
    let registry = Registry {
        revision: 1,
        models: vec![],
    };
    let mut raw = f.raw();
    let tx = raw.transaction().unwrap();
    let binding = wire::Binding {
        account_id: BINDING.account_id,
        namespace_version: 1,
        device_id: BINDING.device_id,
        recovery_generation: BINDING.generation,
    };
    let ids: Vec<_> = (1..=99_000).collect();
    let mut last_pair = None;
    {
        let mut insert = tx.prepare("INSERT INTO sender_accepted(id,local_revision,sequence,operation,receipt) VALUES(?1,1,?2,?3,?4)").unwrap();
        let mut remove = tx.prepare("DELETE FROM outbox WHERE id=?1").unwrap();
        for chunk in ids.chunks(256) {
            let batch = wire::Batch {
                binding,
                operations: chunk
                    .iter()
                    .map(|n| wire::Operation {
                        binding,
                        sequence: *n,
                        occurrence_id: id(*n),
                        expected_head: [0; 32],
                        kind: wire::OperationKind::Put {
                            frame: frame(record(*n, 10)).try_into().unwrap(),
                        },
                    })
                    .collect(),
            };
            let frozen = FrozenBatch {
                first_sequence: chunk[0],
                operation_count: chunk.len() as u16,
                selected_revision: 1,
                canonical_batch: wire::encode_batch(&batch, &policy(&registry)).unwrap(),
                batch_hash: wire::batch_digest(&batch, &policy(&registry)).unwrap(),
            };
            let bytes = journal(&frozen, &vec![wire::Outcome::Inserted; chunk.len()]);
            let terminal = wire::decode_journal(&bytes).unwrap();
            for (operation, receipt) in batch.operations.iter().zip(&terminal.receipts) {
                insert
                    .execute(params![
                        operation.occurrence_id.as_slice(),
                        operation.sequence as i64,
                        wire::encode_operation(operation, &policy(&registry)).unwrap(),
                        wire::encode_receipt(receipt).unwrap()
                    ])
                    .unwrap();
                remove
                    .execute([operation.occurrence_id.as_slice()])
                    .unwrap();
            }
            last_pair = Some((frozen, bytes));
        }
    }
    let (last, bytes) = last_pair.unwrap();
    tx.execute(
        "UPDATE sender_binding SET allocated_sequence=99000,settled_sequence=99000",
        [],
    )
    .unwrap();
    tx.execute(
        "INSERT INTO sender_settled VALUES(1,?1,?2,?3)",
        params![last.canonical_batch, last.batch_hash.as_slice(), bytes],
    )
    .unwrap();
    tx.execute("UPDATE meta SET revision=2", []).unwrap();
    tx.commit().unwrap();
    drop(raw);
    println!("sender_100k setup_ms={}", start.elapsed().as_millis());
    let start = Instant::now();
    let mut ledger = reopen(&f);
    println!("sender_100k full_open_ms={}", start.elapsed().as_millis());
    for sample in 0..3 {
        let start = Instant::now();
        let frozen = ledger
            .freeze_upload_batch(
                2 + sample * 2,
                &(99_001 + sample * 256..=99_256 + sample * 256)
                    .map(id)
                    .collect::<Vec<_>>(),
            )
            .unwrap();
        let freeze_ms = start.elapsed().as_millis();
        let bytes = journal(&frozen, &[wire::Outcome::Inserted; 256]);
        let start = Instant::now();
        assert!(matches!(
            ledger.settle_upload_batch(&bytes).unwrap(),
            BatchSettlement::Accepted {
                cleared_records: 256,
                retained_newer: 0,
                ..
            }
        ));
        println!(
            "sender_100k sample={sample} freeze_ms={freeze_ms} settle_ms={}",
            start.elapsed().as_millis()
        );
    }
    let status = ledger.sender_status().unwrap();
    assert_eq!(status.accepted_occurrences, 99_768);
    assert_eq!(status.settled_sequence, 99_768);
    assert_eq!(ledger.status().unwrap().pending_records, 232);
    println!(
        "sender_100k database_bytes={}",
        fs::metadata(f.database()).unwrap().len()
    );
}

#[test]
fn terminal_conflict_gate_removal_is_rejected_by_retained_batch_evidence() {
    let (f, mut ledger) = setup(2, true);
    let frozen = ledger.freeze_upload_batch(1, &[id(1), id(2)]).unwrap();
    ledger
        .settle_upload_batch(&journal(
            &frozen,
            &[
                wire::Outcome::PredecessorConflict,
                wire::Outcome::SubjectDeleted,
            ],
        ))
        .unwrap();
    drop(ledger);
    f.raw()
        .execute(
            "DELETE FROM sender_reconciliation WHERE id=?1",
            [id(1).as_slice()],
        )
        .unwrap();
    let before = directory_image(&f.dir());
    assert!(Ledger::open_with_identity(&f.dir(), &identity()).is_err());
    assert_eq!(directory_image(&f.dir()), before);
}

#[test]
fn sender_tables_and_receipts_never_retain_namespace_keys_or_content_canaries() {
    let (f, mut ledger) = setup(2, true);
    let frozen = ledger.freeze_upload_batch(1, &[id(1), id(2)]).unwrap();
    ledger
        .settle_upload_batch(&journal(&frozen, &[wire::Outcome::Inserted; 2]))
        .unwrap();
    drop(ledger);
    for (_, (bytes, _)) in directory_image(&f.dir()) {
        for forbidden in [
            KEY.as_slice(),
            OCCURRENCE_KEY.as_slice(),
            PRIVATE.as_bytes(),
        ] {
            assert!(!bytes
                .windows(forbidden.len())
                .any(|window| window == forbidden));
        }
    }
}

#[test]
fn sequence_range_exhaustion_is_checked_without_recycling_or_partial_allocation() {
    for settled in [9_007_199_254_740_990u64, 9_007_199_254_740_991] {
        let (f, mut ledger) = setup(2, true);
        let original = ledger.freeze_upload_batch(1, &[id(1)]).unwrap();
        ledger
            .settle_upload_batch(&journal(&original, &[wire::Outcome::Inserted]))
            .unwrap();
        drop(ledger);
        // A bounded fixture represents the latest retained receipt after a long
        // device history, without allocating billions of synthetic operations.
        let mut batch = decoded(&original);
        batch.operations[0].sequence = settled;
        let registry = Registry {
            revision: 1,
            models: vec![],
        };
        let canonical_batch = wire::encode_batch(&batch, &policy(&registry)).unwrap();
        let batch_hash = wire::batch_digest(&batch, &policy(&registry)).unwrap();
        let frozen = FrozenBatch {
            first_sequence: settled,
            operation_count: 1,
            selected_revision: 1,
            canonical_batch,
            batch_hash,
        };
        let terminal = journal(&frozen, &[wire::Outcome::Inserted]);
        let decoded_journal = wire::decode_journal(&terminal).unwrap();
        let operation = wire::encode_operation(&batch.operations[0], &policy(&registry)).unwrap();
        let receipt = wire::encode_receipt(&decoded_journal.receipts[0]).unwrap();
        let mut raw = f.raw();
        let tx = raw.transaction().unwrap();
        tx.execute(
            "UPDATE sender_binding SET allocated_sequence=?1,settled_sequence=?1",
            [settled as i64],
        )
        .unwrap();
        tx.execute(
            "UPDATE sender_accepted SET sequence=?1,operation=?2,receipt=?3",
            params![settled as i64, operation, receipt],
        )
        .unwrap();
        tx.execute("UPDATE sender_settled SET canonical_batch=?1,batch_hash=?2,canonical_terminal_journal=?3", params![&frozen.canonical_batch, batch_hash.as_slice(), terminal]).unwrap();
        tx.commit().unwrap();
        drop(raw);
        let mut ledger = reopen(&f);
        ledger
            .commit_scans(3, vec![scan(1, 200, vec![record(1, 20), record(2, 10)])])
            .unwrap();
        let before = directory_image(&f.dir());
        assert_eq!(
            ledger.freeze_upload_batch(4, &[id(1), id(2)]).err(),
            Some(Error::Limit)
        );
        assert_eq!(directory_image(&f.dir()), before);
        assert_eq!(ledger.sender_status().unwrap().allocated_sequence, settled);
        if settled == 9_007_199_254_740_990 {
            assert_eq!(
                ledger
                    .freeze_upload_batch(4, &[id(1)])
                    .unwrap()
                    .first_sequence,
                settled + 1
            );
        } else {
            assert_eq!(
                ledger.freeze_upload_batch(4, &[id(1)]).err(),
                Some(Error::Limit)
            );
            assert!(ledger.inflight_batch().unwrap().is_none());
        }
    }
}

#[test]
fn sender_process_death_child() {
    let Some(directory) = std::env::var_os("AICHARTS_SENDER_TEST_CRASH_DIR") else {
        return;
    };
    let directory = PathBuf::from(directory);
    let phase = std::env::var("AICHARTS_SENDER_TEST_CRASH_PHASE").unwrap();
    if phase == "migrate" {
        Ledger::migrate_sender_with(&directory, &identity(), 1, &BINDING, || {
            std::process::exit(73)
        })
        .unwrap();
    } else {
        let mut ledger = Ledger::open_with_identity(&directory, &identity()).unwrap();
        ledger
            .connection
            .execute_batch("PRAGMA cache_size=1; PRAGMA cache_spill=ON;")
            .unwrap();
        if phase == "freeze" {
            ledger
                .freeze_with(1, &(1..=256).map(id).collect::<Vec<_>>(), || {
                    std::process::exit(73)
                })
                .unwrap();
        } else {
            let frozen = ledger.inflight_batch().unwrap().unwrap();
            let reply = journal(&frozen, &vec![wire::Outcome::Inserted; 256]);
            ledger
                .settle_with(&reply, || std::process::exit(73))
                .unwrap();
        }
    }
    panic!("crash injection returned");
}

#[test]
fn process_death_never_partially_migrates_allocates_or_acknowledges_a_batch() {
    for phase in ["migrate", "freeze", "settle"] {
        let (f, mut ledger) = setup(256, phase != "migrate");
        let frozen = if phase == "settle" {
            Some(
                ledger
                    .freeze_upload_batch(1, &(1..=256).map(id).collect::<Vec<_>>())
                    .unwrap(),
            )
        } else {
            None
        };
        drop(ledger);
        let child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tests::sender_tests::sender_process_death_child",
                "--nocapture",
            ])
            .env("AICHARTS_SENDER_TEST_CRASH_DIR", f.dir())
            .env("AICHARTS_SENDER_TEST_CRASH_PHASE", phase)
            .output()
            .unwrap();
        assert_eq!(
            child.status.code(),
            Some(73),
            "{}",
            String::from_utf8_lossy(&child.stderr)
        );
        let recovered = reopen(&f);
        assert_eq!(recovered.status().unwrap().pending_records, 256);
        assert_eq!(recovered.status().unwrap().usage_occurrences, 256);
        if phase == "migrate" {
            assert_eq!(
                recovered.sender_status().err(),
                Some(Error::SenderNotEnabled)
            );
        } else {
            assert_eq!(recovered.inflight_batch().unwrap(), frozen);
            assert_eq!(
                recovered.sender_status().unwrap().allocated_sequence,
                if phase == "settle" { 256 } else { 0 }
            );
            assert_eq!(recovered.sender_status().unwrap().settled_sequence, 0);
            assert_eq!(recovered.sender_status().unwrap().accepted_occurrences, 0);
        }
    }
}
