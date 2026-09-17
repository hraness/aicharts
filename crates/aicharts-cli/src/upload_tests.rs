//! Synthetic numeric ledgers and an in-memory authority. Reopening a ledger here
//! proves retry orchestration, not process-death, TLS or live service behavior.
use super::*;
use aicharts_core::Collection;
use aicharts_ledger::{LedgerIdentity, SourceScan, SourceStamp};
use aicharts_protocol::{AuthMode, Batch, Evidence, Provider, Tokens, Usage};
use std::{
    cell::RefCell,
    fs,
    os::unix::fs::DirBuilderExt,
    path::{Path, PathBuf},
    rc::Rc,
};

const CHECKPOINT: [u8; 32] = [7; 32];
const OCCURRENCE: [u8; 32] = [8; 32];
const BINDING: SenderBinding = SenderBinding {
    account_id: [0x11; 16],
    device_id: [0x22; 32],
    generation: [0x33; 32],
    namespace_version: 1,
};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut random = [0; 16];
        getrandom::fill(&mut random).unwrap();
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("aicharts-upload-test-{suffix}"));
        fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> PathBuf {
        self.0.join("state")
    }

    fn initialize(&self, count: u64, migrate: bool) -> Ledger {
        let mut ledger = Ledger::initialize_with_identity(&self.path(), &identity()).unwrap();
        ledger
            .commit_scans(
                0,
                vec![scan(100, (1..=count).map(|n| usage(n, 10)).collect())],
            )
            .unwrap();
        if migrate {
            drop(ledger);
            ledger = Ledger::migrate_sender_v2(&self.path(), &identity(), 1, &BINDING).unwrap();
        }
        ledger
    }

    fn reopen(&self) -> Ledger {
        Ledger::open_with_identity(&self.path(), &identity()).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Only this newly created synthetic fixture is removed.
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn identity() -> LedgerIdentity<'static> {
    LedgerIdentity::SplitKeys {
        checkpoint: &CHECKPOINT,
        occurrence: &OCCURRENCE,
        namespace_version: 1,
    }
}

fn id(n: u64) -> Id {
    let mut value = [0; 16];
    value[8..].copy_from_slice(&n.to_be_bytes());
    value
}

fn usage(n: u64, output: u64) -> Usage {
    Usage {
        id: id(n),
        execution_id: [9; 16],
        account_id: [0; 16],
        offset_ms: 1_000,
        provider: Provider::ClaudeCode,
        auth_mode: AuthMode::Unknown,
        evidence: Evidence::Imported,
        model_id: 0,
        context_tier: 0,
        tokens: Tokens {
            input_uncached: 100,
            cache_read: 20,
            output,
            ..Tokens::default()
        },
    }
}

fn scan(bytes: u64, usage: Vec<Usage>) -> SourceScan {
    SourceScan {
        source_id: [1; 32],
        stamp: SourceStamp {
            device: 1,
            inode: 2,
            bytes,
            modified_seconds: 100,
            modified_nanos: 0,
            changed_seconds: 100,
            changed_nanos: 0,
        },
        collection: Collection {
            batches: vec![Batch {
                utc_day: 20_000,
                registry_revision: 1,
                usage,
                prompts: vec![],
                intervals: vec![],
            }],
            warnings: vec![],
            lines_read: 1,
        },
        allows_rewrite: false,
    }
}

fn policy(registry: &Registry) -> Policy<'_> {
    Policy {
        first_day: 0,
        last_day: u32::MAX,
        registry,
    }
}

fn decoded(request: &UploadRequest) -> wire::Batch {
    wire::decode_batch(
        request.canonical_batch(),
        &policy(&Registry {
            revision: 1,
            models: vec![],
        }),
    )
    .unwrap()
}

fn journal(request: &UploadRequest, outcomes: &[wire::Outcome]) -> Vec<u8> {
    let batch = decoded(request);
    assert_eq!(batch.operations.len(), outcomes.len());
    let first_sequence = batch.operations[0].sequence;
    let registry = Registry {
        revision: 1,
        models: vec![],
    };
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
                wire::Outcome::Tombstoned => panic!("fixture sends only puts"),
            };
            wire::Receipt {
                descriptor: operation.descriptor(),
                operation_hash,
                head_operation_hash,
                account_journal_revision: first_sequence,
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
        first_sequence,
        batch_hash: *request.batch_hash(),
        account_journal_revision: first_sequence,
        committed_at_ms: 1_800_000_000_000,
        status,
        receipts,
    })
    .unwrap()
}

fn accepted(request: &UploadRequest) -> Vec<u8> {
    journal(
        request,
        &vec![wire::Outcome::Inserted; decoded(request).operations.len()],
    )
}

struct TestTransport<F> {
    binding: SenderBinding,
    calls: Vec<Vec<u8>>,
    respond: F,
}

impl<F> trusted::Sealed for TestTransport<F> {}

impl<F> AuthenticatedTransport for TestTransport<F>
where
    F: FnMut(&UploadRequest, &mut JournalBody) -> Result<(), TransportError>,
{
    fn binding(&self) -> SenderBinding {
        self.binding
    }

    fn exchange(
        &mut self,
        request: &UploadRequest,
        body: &mut JournalBody,
    ) -> Result<(), TransportError> {
        assert_eq!(request.binding(), self.binding);
        self.calls.push(request.canonical_batch().to_vec());
        (self.respond)(request, body)
    }
}

fn transport<F>(respond: F) -> TestTransport<F>
where
    F: FnMut(&UploadRequest, &mut JournalBody) -> Result<(), TransportError>,
{
    TestTransport {
        binding: BINDING,
        calls: vec![],
        respond,
    }
}

fn select(ids: &[Id]) -> Selection<'_> {
    Selection::Freeze {
        expected_revision: 1,
        occurrence_ids: ids,
    }
}

#[test]
fn no_implicit_migration_or_selection_and_wrong_binding_never_dispatch() {
    for migrate in [false, true] {
        let fixture = Fixture::new();
        let mut ledger = fixture.initialize(1, migrate);
        let mut client = transport(|_, _| panic!("must not dispatch"));
        assert_eq!(
            send_once(&mut ledger, &mut client, Selection::Resume),
            Err(if migrate {
                Error::NoRetainedBatch
            } else {
                Error::Ledger(aicharts_ledger::Error::SenderNotEnabled)
            })
        );
        assert_eq!(ledger.snapshot().unwrap().revision, 1);
        assert!(client.calls.is_empty());
    }
    for binding in [
        SenderBinding {
            account_id: [9; 16],
            ..BINDING
        },
        SenderBinding {
            device_id: [9; 32],
            ..BINDING
        },
        SenderBinding {
            generation: [9; 32],
            ..BINDING
        },
        SenderBinding {
            namespace_version: 2,
            ..BINDING
        },
    ] {
        let fixture = Fixture::new();
        let mut ledger = fixture.initialize(1, true);
        let mut client = transport(|_, _| panic!("must not dispatch"));
        client.binding = binding;
        let before = ledger.sender_status().unwrap();
        assert_eq!(
            send_once(&mut ledger, &mut client, select(&[id(1)])),
            Err(Error::BindingMismatch)
        );
        assert_eq!(ledger.sender_status().unwrap(), before);
        assert!(ledger.inflight_batch().unwrap().is_none());
        assert!(client.calls.is_empty());
    }
}

#[test]
fn invalid_and_different_flight_selections_preserve_ledger_authority() {
    let fixture = Fixture::new();
    let mut ledger = fixture.initialize(2, true);
    let mut client = transport(|_, _| panic!("must not dispatch"));
    for (revision, ids, error) in [
        (1, vec![], aicharts_ledger::Error::Limit),
        (
            1,
            (1..=257).map(id).collect(),
            aicharts_ledger::Error::Limit,
        ),
        (
            1,
            vec![id(1), id(1)],
            aicharts_ledger::Error::InvalidMeasurement,
        ),
        (1, vec![[0; 16]], aicharts_ledger::Error::InvalidMeasurement),
        (1, vec![id(3)], aicharts_ledger::Error::InvalidMeasurement),
        (0, vec![id(1)], aicharts_ledger::Error::StaleRevision),
    ] {
        assert_eq!(
            send_once(
                &mut ledger,
                &mut client,
                Selection::Freeze {
                    expected_revision: revision,
                    occurrence_ids: &ids,
                }
            ),
            Err(Error::Ledger(error))
        );
        assert_eq!(ledger.sender_status().unwrap().allocated_sequence, 0);
        assert!(ledger.inflight_batch().unwrap().is_none());
    }
    let retained = ledger.freeze_upload_batch(1, &[id(1)]).unwrap();
    let before = ledger.sender_status().unwrap();
    assert_eq!(
        send_once(&mut ledger, &mut client, select(&[id(2)])),
        Err(Error::Ledger(aicharts_ledger::Error::UploadInFlight))
    );
    assert_eq!(ledger.inflight_batch().unwrap(), Some(retained));
    assert_eq!(ledger.sender_status().unwrap(), before);
    assert!(client.calls.is_empty());
}

#[test]
fn synthetic_commit_with_lost_reply_replays_exact_bytes_after_local_reopen() {
    let fixture = Fixture::new();
    let mut ledger = fixture.initialize(2, true);
    let committed = Rc::new(RefCell::new(None));
    let remote = Rc::clone(&committed);
    let mut first = transport(move |request, _| {
        assert!(remote.borrow().is_none());
        *remote.borrow_mut() = Some((request.canonical_batch().to_vec(), accepted(request)));
        Err(TransportError::Uncertain)
    });
    assert_eq!(
        send_once(&mut ledger, &mut first, select(&[id(2), id(1)])),
        Err(Error::Transport(TransportError::Uncertain))
    );
    let retained = ledger.inflight_batch().unwrap().unwrap();
    assert_eq!(retained.first_sequence, 1);
    assert_eq!(ledger.sender_status().unwrap().settled_sequence, 0);
    assert_eq!(ledger.status().unwrap().pending_records, 2);
    assert_eq!(first.calls.len(), 1);
    drop(first);
    drop(ledger);

    let mut ledger = fixture.reopen();
    let mut retry = transport(|request, body| {
        let committed = committed.borrow();
        let (bytes, receipt) = committed.as_ref().unwrap();
        assert_eq!(request.canonical_batch(), bytes);
        body.append(receipt)
    });
    // The original revision and normalized membership select the retained flight.
    assert_eq!(
        send_once(&mut ledger, &mut retry, select(&[id(1), id(2)])),
        Ok(BatchSettlement::Accepted {
            ledger_revision: 3,
            cleared_records: 2,
            retained_newer: 0
        })
    );
    assert_eq!(retry.calls, vec![retained.canonical_batch.clone()]);
    assert_eq!(ledger.sender_status().unwrap().allocated_sequence, 2);
    assert_eq!(ledger.sender_status().unwrap().settled_sequence, 2);
    assert_eq!(ledger.status().unwrap().pending_records, 0);
    assert!(ledger.inflight_batch().unwrap().is_none());
    assert_eq!(
        ledger
            .last_settled_batch()
            .unwrap()
            .unwrap()
            .canonical_batch,
        retained.canonical_batch
    );
    assert_eq!(
        send_once(&mut ledger, &mut retry, Selection::Resume),
        Err(Error::NoRetainedBatch)
    );
    assert_eq!(retry.calls.len(), 1);
}

#[test]
fn every_transport_error_preserves_a_valid_but_unauthenticated_body() {
    for failure in [
        TransportError::Unavailable,
        TransportError::Unauthorized,
        TransportError::Blocked,
        TransportError::Uncertain,
        TransportError::InvalidResponse,
    ] {
        let fixture = Fixture::new();
        let mut ledger = fixture.initialize(1, true);
        let mut client = transport(|request, body| {
            body.append(&accepted(request))?;
            Err(failure)
        });
        assert_eq!(
            send_once(&mut ledger, &mut client, select(&[id(1)])),
            Err(Error::Transport(failure))
        );
        let retained = ledger.inflight_batch().unwrap().unwrap();
        assert_eq!(client.calls, vec![retained.canonical_batch.clone()]);
        drop(ledger);
        let ledger = fixture.reopen();
        assert_eq!(ledger.inflight_batch().unwrap(), Some(retained));
        assert_eq!(ledger.sender_status().unwrap().settled_sequence, 0);
        assert!(!ledger.sender_status().unwrap().device_revoked);
        assert_eq!(ledger.status().unwrap().pending_records, 1);
        assert!(ledger.last_settled_batch().unwrap().is_none());
    }
}

#[test]
fn malformed_and_mismatched_journals_cannot_acknowledge_any_member() {
    let fixture = Fixture::new();
    let mut ledger = fixture.initialize(2, true);
    let retained = ledger.freeze_upload_batch(1, &[id(1), id(2)]).unwrap();
    let request = UploadRequest {
        binding: BINDING,
        frozen: retained.clone(),
    };
    let valid = accepted(&request);
    let mut changed_member = wire::decode_journal(&valid).unwrap();
    changed_member.receipts[1].descriptor.occurrence_id = id(3);
    let mut changed_hash = wire::decode_journal(&valid).unwrap();
    changed_hash.batch_hash = [9; 32];
    let mut changed_account = wire::decode_journal(&valid).unwrap();
    changed_account.binding.account_id = [9; 16];
    for receipt in &mut changed_account.receipts {
        receipt.descriptor.binding = changed_account.binding;
    }
    let mut trailing = valid.clone();
    trailing.push(0);
    for bad in [
        vec![],
        valid[..valid.len() - 1].to_vec(),
        trailing,
        b"{\"staged\":true}".to_vec(),
        wire::encode_journal(&changed_member).unwrap(),
        wire::encode_journal(&changed_hash).unwrap(),
        wire::encode_journal(&changed_account).unwrap(),
    ] {
        let before = ledger.sender_status().unwrap();
        let mut client = transport(|_, body| body.append(&bad));
        assert_eq!(
            send_once(&mut ledger, &mut client, Selection::Resume),
            Err(Error::InvalidResponse)
        );
        assert_eq!(ledger.inflight_batch().unwrap(), Some(retained.clone()));
        assert_eq!(ledger.sender_status().unwrap(), before);
        assert_eq!(ledger.status().unwrap().pending_records, 2);
        assert!(ledger.last_settled_batch().unwrap().is_none());
    }
}

#[test]
fn journal_append_owns_bytes_and_overflow_is_sticky_even_if_ignored() {
    for oversized_first in [false, true] {
        let fixture = Fixture::new();
        let mut ledger = fixture.initialize(1, true);
        let mut client = transport(|request, body| {
            if !oversized_first {
                body.append(&accepted(request))?;
            }
            assert_eq!(
                body.append(&vec![0; wire::MAX_JOURNAL_BYTES + 1]),
                Err(TransportError::InvalidResponse)
            );
            assert_eq!(
                body.append(&accepted(request)),
                Err(TransportError::InvalidResponse)
            );
            assert!(body.bytes.len() <= wire::MAX_JOURNAL_BYTES);
            Ok(()) // An adapter cannot bless a truncated valid prefix after overflow.
        });
        assert_eq!(
            send_once(&mut ledger, &mut client, select(&[id(1)])),
            Err(Error::InvalidResponse)
        );
        assert_eq!(ledger.sender_status().unwrap().settled_sequence, 0);
        assert!(ledger.inflight_batch().unwrap().is_some());
    }
    let fixture = Fixture::new();
    let mut ledger = fixture.initialize(1, true);
    let mut client = transport(|request, body| {
        let mut bytes = accepted(request);
        body.append(&bytes)?;
        bytes.fill(0);
        Ok(())
    });
    assert!(matches!(
        send_once(&mut ledger, &mut client, select(&[id(1)])),
        Ok(BatchSettlement::Accepted { .. })
    ));
}

#[test]
fn maximum_batch_and_chunked_terminal_fit_the_protocol_limits() {
    let fixture = Fixture::new();
    let mut ledger = fixture.initialize(256, true);
    let ids: Vec<_> = (1..=256).map(id).collect();
    let mut client = transport(|request, body| {
        assert_eq!(request.canonical_batch().len(), wire::MAX_BATCH_BYTES);
        let bytes = accepted(request);
        assert_eq!(bytes.len(), wire::MAX_JOURNAL_BYTES);
        for chunk in bytes.chunks(17) {
            body.append(chunk)?;
        }
        Ok(())
    });
    assert_eq!(
        send_once(&mut ledger, &mut client, select(&ids)),
        Ok(BatchSettlement::Accepted {
            ledger_revision: 3,
            cleared_records: 256,
            retained_newer: 0,
        })
    );
    assert_eq!(client.calls.len(), 1);
    assert_eq!(ledger.sender_status().unwrap().settled_sequence, 256);
    assert_eq!(ledger.status().unwrap().pending_records, 0);
}

#[test]
fn an_old_terminal_is_rejected_before_the_ledgers_already_settled_fast_path() {
    let fixture = Fixture::new();
    let mut ledger = fixture.initialize(2, true);
    let mut old = vec![];
    let mut first = transport(|request, body| {
        old = accepted(request);
        body.append(&old)
    });
    send_once(&mut ledger, &mut first, select(&[id(1)])).unwrap();
    let mut wrong = transport(|_, body| body.append(&old));
    assert_eq!(
        send_once(
            &mut ledger,
            &mut wrong,
            Selection::Freeze {
                expected_revision: 3,
                occurrence_ids: &[id(2)],
            }
        ),
        Err(Error::InvalidResponse)
    );
    let retained = ledger.inflight_batch().unwrap().unwrap();
    assert_eq!(retained.first_sequence, 2);
    // The low-level API intentionally permits exact existing-only readback.
    assert!(matches!(
        ledger.settle_upload_batch(&old),
        Ok(BatchSettlement::AlreadySettled { .. })
    ));
    assert_eq!(ledger.inflight_batch().unwrap(), Some(retained));
    let mut correct = transport(|request, body| body.append(&accepted(request)));
    send_once(&mut ledger, &mut correct, Selection::Resume).unwrap();
    assert_eq!(ledger.sender_status().unwrap().settled_sequence, 2);
    assert_eq!(ledger.status().unwrap().pending_records, 0);
}

#[test]
fn rejected_terminal_consumes_sequences_and_keeps_conflict_and_pending_work() {
    let fixture = Fixture::new();
    let mut ledger = fixture.initialize(2, true);
    let mut client = transport(|request, body| {
        body.append(&journal(
            request,
            &[
                wire::Outcome::PredecessorConflict,
                wire::Outcome::BatchAborted,
            ],
        ))
    });
    assert_eq!(
        send_once(&mut ledger, &mut client, select(&[id(1), id(2)])),
        Ok(BatchSettlement::Rejected {
            ledger_revision: 3,
            conflicted_records: 1,
            aborted_records: 1,
            device_revoked: false
        })
    );
    drop(ledger);
    let mut ledger = fixture.reopen();
    assert_eq!(ledger.sender_status().unwrap().settled_sequence, 2);
    assert_eq!(ledger.sender_status().unwrap().reconciliation_required, 1);
    assert_eq!(ledger.status().unwrap().pending_records, 2);
    assert!(ledger.inflight_batch().unwrap().is_none());
    assert_eq!(
        send_once(
            &mut ledger,
            &mut client,
            Selection::Freeze {
                expected_revision: 3,
                occurrence_ids: &[id(1)],
            }
        ),
        Err(Error::Ledger(
            aicharts_ledger::Error::ReconciliationRequired
        ))
    );
    assert_eq!(client.calls.len(), 1);
    let mut next = transport(|request, body| {
        assert_eq!(decoded(request).operations[0].sequence, 3);
        body.append(&accepted(request))
    });
    send_once(
        &mut ledger,
        &mut next,
        Selection::Freeze {
            expected_revision: 3,
            occurrence_ids: &[id(2)],
        },
    )
    .unwrap();
    assert_eq!(ledger.sender_status().unwrap().settled_sequence, 3);
    assert_eq!(ledger.status().unwrap().pending_records, 1);
}

#[test]
fn authenticated_revocation_settles_the_range_and_closes_future_dispatch() {
    let fixture = Fixture::new();
    let mut ledger = fixture.initialize(2, true);
    let mut client = transport(|request, body| {
        body.append(&journal(request, &[wire::Outcome::DeviceRevoked; 2]))
    });
    assert_eq!(
        send_once(&mut ledger, &mut client, select(&[id(1), id(2)])),
        Ok(BatchSettlement::Rejected {
            ledger_revision: 3,
            conflicted_records: 0,
            aborted_records: 0,
            device_revoked: true
        })
    );
    drop(ledger);
    let mut ledger = fixture.reopen();
    assert_eq!(ledger.sender_status().unwrap().settled_sequence, 2);
    assert!(ledger.sender_status().unwrap().device_revoked);
    assert_eq!(ledger.status().unwrap().pending_records, 2);
    for selection in [
        Selection::Resume,
        Selection::Freeze {
            expected_revision: 3,
            occurrence_ids: &[id(1)],
        },
    ] {
        assert_eq!(
            send_once(&mut ledger, &mut client, selection),
            Err(Error::Ledger(aicharts_ledger::Error::DeviceRevoked))
        );
    }
    assert_eq!(client.calls.len(), 1);
}

#[test]
fn exchange_holds_no_transaction_and_preserves_newer_and_unselected_pending_work() {
    let fixture = Fixture::new();
    let mut ledger = fixture.initialize(2, true);
    let mut first_head = [0; 32];
    let mut client = transport(|request, body| {
        let mut collector = fixture.reopen();
        assert_eq!(
            collector.inflight_batch().unwrap().unwrap().canonical_batch,
            request.canonical_batch()
        );
        collector
            .commit_scans(
                2,
                vec![scan(200, vec![usage(1, 20), usage(2, 10), usage(3, 30)])],
            )
            .unwrap();
        let reply = accepted(request);
        first_head = wire::decode_journal(&reply).unwrap().receipts[0].head_operation_hash;
        body.append(&reply)
    });
    assert_eq!(
        send_once(&mut ledger, &mut client, select(&[id(1), id(2)])),
        Ok(BatchSettlement::Accepted {
            ledger_revision: 4,
            cleared_records: 1,
            retained_newer: 1
        })
    );
    let pending = ledger.pending(None, 256, None).unwrap();
    assert_eq!(
        pending
            .entries
            .iter()
            .map(|entry| entry.id)
            .collect::<Vec<_>>(),
        vec![id(1), id(3)]
    );
    assert!(pending.entries.iter().all(|entry| entry.revision == 3));
    assert_eq!(ledger.status().unwrap().output_tokens, 60);
    let mut next = transport(|request, body| {
        let batch = decoded(request);
        assert_eq!(batch.operations[0].sequence, 3);
        assert_eq!(batch.operations[0].expected_head, first_head);
        assert_eq!(batch.operations[1].expected_head, [0; 32]);
        body.append(&journal(
            request,
            &[wire::Outcome::Replaced, wire::Outcome::Inserted],
        ))
    });
    send_once(
        &mut ledger,
        &mut next,
        Selection::Freeze {
            expected_revision: 4,
            occurrence_ids: &[id(1), id(3)],
        },
    )
    .unwrap();
    assert_eq!(ledger.status().unwrap().pending_records, 0);
    assert_eq!(ledger.status().unwrap().output_tokens, 60);
}

#[test]
fn concurrent_exact_settlement_does_not_clear_a_new_successor_flight() {
    let fixture = Fixture::new();
    let mut ledger = fixture.initialize(3, true);
    let mut successor = None;
    let mut client = transport(|request, body| {
        let reply = accepted(request);
        let mut other = fixture.reopen();
        other.settle_upload_batch(&reply).unwrap();
        successor = Some(other.freeze_upload_batch(3, &[id(3)]).unwrap());
        body.append(&reply)
    });
    assert_eq!(
        send_once(&mut ledger, &mut client, select(&[id(1), id(2)])),
        Ok(BatchSettlement::AlreadySettled { ledger_revision: 4 })
    );
    assert_eq!(ledger.inflight_batch().unwrap(), successor);
    assert_eq!(ledger.sender_status().unwrap().settled_sequence, 2);
    assert_eq!(ledger.sender_status().unwrap().allocated_sequence, 3);
    assert_eq!(ledger.status().unwrap().pending_records, 1);
}

#[test]
fn errors_have_only_fixed_non_reflective_codes() {
    for (error, code) in [
        (Error::BindingMismatch, "upload_binding_mismatch"),
        (Error::NoRetainedBatch, "upload_no_retained_batch"),
        (Error::InvalidResponse, "upload_response_rejected"),
        (
            Error::Transport(TransportError::Unavailable),
            "upload_transport_unavailable",
        ),
        (
            Error::Transport(TransportError::Unauthorized),
            "upload_transport_unauthorized",
        ),
        (
            Error::Transport(TransportError::Blocked),
            "upload_transport_blocked",
        ),
        (
            Error::Transport(TransportError::Uncertain),
            "upload_transport_uncertain",
        ),
        (
            Error::Transport(TransportError::InvalidResponse),
            "upload_response_rejected",
        ),
        (
            Error::Ledger(aicharts_ledger::Error::InvalidState),
            "ledger_invalid_state_do_not_reset",
        ),
    ] {
        assert_eq!(error.code(), code);
        assert_eq!(error.to_string(), code);
    }
}

fn command_args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

#[test]
fn upload_command_requires_state_dir_key_and_closed_options() {
    assert_eq!(
        run(&command_args(&["upload"])),
        Err("state_directory_required")
    );
    assert_eq!(
        run(&command_args(&["upload", "--state-dir"])),
        Err("missing_option_value")
    );
    assert_eq!(
        run(&command_args(&["upload", "--state-dir", "d"])),
        Err("key_required")
    );
    assert_eq!(
        run(&command_args(&["upload", "--state-dir", "d", "--bogus"])),
        Err("invalid_option")
    );
    // `--dry-run` is the separate preview flag, not an option of the send.
    assert_eq!(
        run(&command_args(&[
            "upload",
            "--state-dir",
            "d",
            "--key-file",
            "k",
            "--dry-run"
        ])),
        Err("invalid_option")
    );
    assert_eq!(
        run(&command_args(&[
            "upload",
            "--state-dir",
            "d",
            "--key-file",
            "k",
            "--state-dir",
            "e"
        ])),
        Err("invalid_option")
    );
    // `--resume` is a flag, not an option value, and may appear at most once.
    let options = parse_options(&command_args(&[
        "upload",
        "--state-dir",
        "d",
        "--key-file",
        "k",
        "--resume",
    ]))
    .unwrap();
    assert!(options.resume);
    assert_eq!(
        run(&command_args(&[
            "upload",
            "--state-dir",
            "d",
            "--key-file",
            "k",
            "--resume",
            "--resume"
        ])),
        Err("invalid_option")
    );
    assert_eq!(
        run(&command_args(&[
            "upload",
            "--state-dir",
            "d",
            "--key-file",
            "k",
            "--resume",
            "extra"
        ])),
        Err("invalid_option")
    );
    assert_eq!(
        run(&command_args(&["upload", "--resume"])),
        Err("state_directory_required")
    );
}

#[test]
fn upload_command_refuses_before_any_send_when_not_enrolled() {
    // A repository path whose ancestors stay quiet during the enrolled read;
    // the shared fixture lock keeps sibling anchor create/remove churn out of
    // this descriptor-pinned walk.
    let _guard = crate::TEST_FIXTURE_PARENT
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!(".upload-no-anchor-{}", std::process::id()));
    let args = command_args(&[
        "upload",
        "--state-dir",
        &dir.display().to_string(),
        "--key-file",
        "unused",
    ]);
    #[cfg(target_os = "macos")]
    assert_eq!(run(&args), Err("upload_not_enrolled"));
    #[cfg(not(target_os = "macos"))]
    assert_eq!(run(&args), Err("upload_requires_qualified_macos_custody"));
}

#[test]
fn uncertain_exchange_retains_flight_and_invocation_refuses_replay() {
    let fixture = Fixture::new();
    let mut ledger = fixture.initialize(1, true);
    assert_eq!(refuse_inflight(&ledger), Ok(()));
    let mut client = transport(|_, _| Err(TransportError::Uncertain));
    assert_eq!(
        send_once(
            &mut ledger,
            &mut client,
            Selection::Freeze {
                expected_revision: 1,
                occurrence_ids: &[id(1)],
            },
        ),
        Err(Error::Transport(TransportError::Uncertain))
    );
    // The uncertain flight is retained; a later invocation refuses instead of
    // speculatively replaying it.
    assert!(ledger.inflight_batch().unwrap().is_some());
    assert_eq!(refuse_inflight(&ledger), Err("upload_recovery_required"));
}

#[test]
fn settled_batch_clears_flight_and_pending_work_is_not_reselected() {
    let fixture = Fixture::new();
    let mut ledger = fixture.initialize(2, true);
    let mut client = transport(|request, body| body.append(&accepted(request)));
    let settlement = send_once(
        &mut ledger,
        &mut client,
        Selection::Freeze {
            expected_revision: 1,
            occurrence_ids: &[id(1), id(2)],
        },
    )
    .unwrap();
    assert!(matches!(
        settlement,
        BatchSettlement::Accepted {
            cleared_records: 2,
            ..
        }
    ));
    // Settlement consumed the exact frozen range: nothing inflight and no
    // settled occurrence is ever reselected for a new send.
    assert!(ledger.inflight_batch().unwrap().is_none());
    assert_eq!(refuse_inflight(&ledger), Ok(()));
    assert_eq!(ledger.sender_status().unwrap().settled_sequence, 2);
    assert!(ledger.pending(None, 256, None).unwrap().entries.is_empty());
}
