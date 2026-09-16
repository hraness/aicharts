use super::super::contract::{
    self, Context, EnrollmentProof, Operation, PairingState, PairingView, PollProof, Request,
    Success,
};
use super::super::https::{AcceptedEnrollment, TransportError};
use super::session::ExchangePort;
use super::{
    record,
    record_tests::{enrolled_record, initial_record, TIME},
    sequencer::tests::Memory,
    session::HeldAttempt,
    storage::{self, Candidate, Storage},
    Error, Result,
};
use aicharts_custody::{references::RecordIntent, CredentialRef, Purpose, Secret32, SecretRecord};
use std::collections::VecDeque;

struct FakeCustody;
impl super::session::CustodyPort for FakeCustody {
    fn install_pairing(
        &mut self,
        _record: &super::record::Record,
        _secret: &SecretRecord,
    ) -> Result<()> {
        Ok(())
    }
    fn verify_pairing(
        &mut self,
        _record: &super::record::Record,
        _secret: &SecretRecord,
    ) -> Result<()> {
        Ok(())
    }
    fn install_namespace(
        &mut self,
        _record: &super::record::Record,
        _secret: &SecretRecord,
    ) -> Result<()> {
        Ok(())
    }
    fn reconcile_namespace(
        &mut self,
        _record: &super::record::Record,
        _secret: &SecretRecord,
    ) -> Result<()> {
        Ok(())
    }
}

struct FailingCustody {
    calls: usize,
}
impl super::session::CustodyPort for FailingCustody {
    fn install_pairing(
        &mut self,
        _record: &super::record::Record,
        _secret: &SecretRecord,
    ) -> Result<()> {
        Ok(())
    }
    fn verify_pairing(
        &mut self,
        _record: &super::record::Record,
        _secret: &SecretRecord,
    ) -> Result<()> {
        Ok(())
    }
    fn install_namespace(
        &mut self,
        _record: &super::record::Record,
        _secret: &SecretRecord,
    ) -> Result<()> {
        Ok(())
    }
    fn reconcile_namespace(
        &mut self,
        _record: &super::record::Record,
        _secret: &SecretRecord,
    ) -> Result<()> {
        self.calls += 1;
        Err(Error::OutcomeUnknown)
    }
}
/// One scripted transport outcome per exchange call. The call count is the
/// dispatch evidence: a refused operation must leave it at exactly one.
struct StubExchange {
    outcomes: VecDeque<std::result::Result<AcceptedEnrollment, TransportError>>,
    calls: usize,
}
impl ExchangePort for StubExchange {
    fn exchange(
        &mut self,
        _request: &contract::Request,
        _context: &contract::Context,
        _floor_ms: u64,
    ) -> std::result::Result<AcceptedEnrollment, TransportError> {
        self.calls += 1;
        self.outcomes
            .pop_front()
            .expect("scripted exchange outcome")
    }
}

struct FakeExchange {
    competitor: Option<Memory>,
    token: Option<record::Token>,
    busy_seen: bool,
}
impl ExchangePort for FakeExchange {
    fn exchange(
        &mut self,
        _request: &contract::Request,
        _context: &contract::Context,
        _floor_ms: u64,
    ) -> std::result::Result<AcceptedEnrollment, super::super::https::TransportError> {
        if let (Some(memory), Some(token)) = (self.competitor.as_ref(), self.token) {
            self.busy_seen = matches!(HeldAttempt::open(memory.clone(), token), Err(Error::Busy));
        }
        Ok(AcceptedEnrollment {
            observed_at_ms: super::record_tests::TIME + 2,
            result: Ok(Success::Initialized {
                expires_at_ms: super::record_tests::TIME + 600,
            }),
        })
    }
}

struct FaultPort {
    memory: Memory,
    sync_fails: bool,
    publish_loses_reply: bool,
}

impl Storage for FaultPort {
    fn lock(&mut self) -> Result<()> {
        self.memory.lock()
    }
    fn unlock(&mut self) {
        self.memory.unlock();
    }
    fn read_committed(&mut self, max_bytes: usize) -> Result<Option<Vec<u8>>> {
        self.memory.read_committed(max_bytes)
    }
    fn sync_committed(&mut self) -> Result<()> {
        if self.sync_fails {
            Err(Error::StorageUnavailable)
        } else {
            self.memory.sync_committed()
        }
    }
    fn stage(&mut self, candidate: &Candidate) -> Result<()> {
        self.memory.stage(candidate)
    }
    fn sync_candidate(&mut self) -> Result<()> {
        self.memory.sync_candidate()
    }
    fn publish(&mut self, candidate: &Candidate) -> Result<()> {
        self.memory.publish(candidate)?;
        if self.publish_loses_reply {
            Err(Error::StorageUnavailable)
        } else {
            Ok(())
        }
    }
    fn sync_directory(&mut self) -> Result<()> {
        self.memory.sync_directory()
    }
}

#[test]
fn held_attempt_keeps_one_lock_until_drop_and_updates_token() {
    let record = initial_record();
    let token = record::token(&record).unwrap();
    let memory = Memory::with(&record);
    let shared = memory.clone();
    let held = HeldAttempt::open(memory, token).unwrap();
    assert!(held.is_valid());
    assert!(held.token() == token);
    assert!(matches!(
        HeldAttempt::open(shared.clone(), token),
        Err(Error::Busy)
    ));
    drop(held);
    // The same backing fixture is available again after RAII release.
    assert!(HeldAttempt::open(shared, token).is_ok());
}

#[test]
fn failed_durable_open_releases_lock_without_publication() {
    let record = initial_record();
    let token = record::token(&record).unwrap();
    let memory = Memory::with(&record);
    let port = FaultPort {
        memory: memory.clone(),
        sync_fails: true,
        publish_loses_reply: false,
    };
    assert!(matches!(
        HeldAttempt::open(port, token),
        Err(Error::StorageUnavailable)
    ));
    let reopened = HeldAttempt::open(memory, token).unwrap();
    assert!(reopened.token() == token);
}

#[test]
fn ambiguous_publication_invalidates_session_and_preserves_visible_successor() {
    let current = initial_record();
    let token = record::token(&current).unwrap();
    let memory = Memory::with(&current);
    let port = FaultPort {
        memory: memory.clone(),
        sync_fails: false,
        publish_loses_reply: true,
    };
    let mut held = HeldAttempt::open(port, token).unwrap();
    let mut next = current.clone();
    next.revision += 1;
    next.progress = record::Progress::PairingPrepared;
    assert_eq!(held.publish(&next), Err(Error::OutcomeUnknown));
    assert!(!held.is_valid());
    assert_eq!(held.publish(&next), Err(Error::RecoveryRequired));
    drop(held);
    let mut memory = memory;
    let observed = storage::inspect(&mut memory).unwrap();
    assert!(observed.token() == record::token(&next).unwrap());
}

#[test]
fn held_custody_rejects_invalid_successor_before_external_effect() {
    let current = initial_record();
    let token = record::token(&current).unwrap();
    let memory = Memory::with(&current);
    let mut held = HeldAttempt::open(memory, token).unwrap();
    let mut effects = 0;
    assert!(
        super::sequencer::complete_custody_held(&mut held, &current, || {
            effects += 1;
            Ok(())
        })
        .is_err()
    );
    assert_eq!(effects, 0);
}

#[test]
fn one_operation_keeps_attempt_lock_through_http_and_settlement() {
    let mut record = super::sequencer::tests::initialized_record();
    let secret = SecretRecord::pairing(
        CredentialRef::new(record.installation_id, [0xb2; 32], Purpose::Pairing).unwrap(),
        record.intent_id,
        Secret32::new([0x22; 32]).unwrap(),
        Secret32::new([0x33; 32]).unwrap(),
    )
    .unwrap();
    record.pairing = super::record::Pin::from_intent(&RecordIntent::from_record(&secret)).unwrap();
    let token = record::token(&record).unwrap();
    let memory = Memory::with(&record);
    let competitor = memory.clone();
    let held = HeldAttempt::open(memory, token).unwrap();
    let mut exchange = FakeExchange {
        competitor: Some(competitor.clone()),
        token: Some(token),
        busy_seen: false,
    };
    let mut custody = FakeCustody;
    let result = held
        .run_operation(
            &super::sequencer::tests::initialize_request(),
            &super::sequencer::tests::empty_context(),
            &secret,
            &mut custody,
            &mut exchange,
            super::record_tests::TIME + 1,
            super::record_tests::TIME + 2,
        )
        .ok()
        .expect("synthetic operation should settle");
    assert!(matches!(result.result, Ok(Success::Initialized { .. })));
    assert!(exchange.busy_seen);
    assert!(matches!(
        HeldAttempt::open(competitor, token),
        Err(Error::StaleSnapshot)
    ));
}

#[test]
fn persisted_namespace_pin_is_recovery_only_and_cannot_redispatch() {
    let record = super::record_tests::namespace_flow()
        .last()
        .unwrap()
        .clone();
    let token = record::token(&record).unwrap();
    let memory = Memory::with(&record);
    let mut exchange = FakeExchange {
        competitor: None,
        token: None,
        busy_seen: false,
    };
    let mut custody = FakeCustody;
    let secret = SecretRecord::pairing(
        CredentialRef::new(record.installation_id, [0xb2; 32], Purpose::Pairing).unwrap(),
        record.intent_id,
        Secret32::new([0x22; 32]).unwrap(),
        Secret32::new([0x33; 32]).unwrap(),
    )
    .unwrap();
    let result = HeldAttempt::open(memory, token).unwrap().run_operation(
        &super::sequencer::tests::initialize_request(),
        &super::sequencer::tests::empty_context(),
        &secret,
        &mut custody,
        &mut exchange,
        super::record_tests::TIME + 1,
        super::record_tests::TIME + 2,
    );
    assert!(matches!(
        result,
        Err(super::session::OperationFailure {
            error: Error::RecoveryRequired,
            ..
        })
    ));
    assert!(!exchange.busy_seen);
}

#[test]
fn retained_dispatched_flight_requires_explicit_reconstruction() {
    let record = super::record_tests::namespace_flow()[2].clone();
    let token = record::token(&record).unwrap();
    let memory = Memory::with(&record);
    let mut exchange = FakeExchange {
        competitor: None,
        token: None,
        busy_seen: false,
    };
    let mut custody = FakeCustody;
    let secret = SecretRecord::pairing(
        CredentialRef::new(record.installation_id, [0xb2; 32], Purpose::Pairing).unwrap(),
        record.intent_id,
        Secret32::new([0x22; 32]).unwrap(),
        Secret32::new([0x33; 32]).unwrap(),
    )
    .unwrap();
    let result = HeldAttempt::open(memory, token).unwrap().run_operation(
        &super::sequencer::tests::initialize_request(),
        &super::sequencer::tests::empty_context(),
        &secret,
        &mut custody,
        &mut exchange,
        super::record_tests::TIME + 1,
        super::record_tests::TIME + 2,
    );
    assert!(matches!(
        result,
        Err(super::session::OperationFailure {
            error: Error::RecoveryRequired,
            ..
        })
    ));
    assert!(!exchange.busy_seen);
}

#[test]
fn namespace_reconciliation_clears_retained_flight_without_exchange() {
    let mut record = super::record_tests::namespace_flow()[3].clone();
    let identity = record.namespace.as_ref().unwrap().pin.identity.clone();
    let secret = SecretRecord::namespace(
        identity.reference().clone(),
        identity.namespace_binding().unwrap().clone(),
        Secret32::new([0x77; 32]).unwrap(),
    )
    .unwrap();
    record.namespace.as_mut().unwrap().pin =
        super::record::Pin::from_intent(&RecordIntent::from_record(&secret)).unwrap();
    let token = record::token(&record).unwrap();
    let memory = Memory::with(&record);
    let retained = memory.clone();
    let mut custody = FakeCustody;
    HeldAttempt::open(memory, token)
        .unwrap()
        .reconcile_namespace(&secret, &mut custody, super::record_tests::TIME + 6_000)
        .ok()
        .expect("namespace custody should reconcile");
    let mut observed = retained;
    let final_state = storage::inspect(&mut observed).unwrap();
    assert_eq!(
        final_state.record().progress,
        super::record::Progress::NamespaceCustodyVerified
    );
    assert!(final_state.record().flight.is_none());
}

#[test]
fn namespace_custody_failure_leaves_prepared_flight_for_recovery() {
    let mut record = super::record_tests::namespace_flow()[3].clone();
    let identity = record.namespace.as_ref().unwrap().pin.identity.clone();
    let secret = SecretRecord::namespace(
        identity.reference().clone(),
        identity.namespace_binding().unwrap().clone(),
        Secret32::new([0x77; 32]).unwrap(),
    )
    .unwrap();
    record.namespace.as_mut().unwrap().pin =
        super::record::Pin::from_intent(&RecordIntent::from_record(&secret)).unwrap();
    let token = record::token(&record).unwrap();
    let memory = Memory::with(&record);
    let retained = memory.clone();
    let mut custody = FailingCustody { calls: 0 };
    let result = HeldAttempt::open(memory, token)
        .unwrap()
        .reconcile_namespace(&secret, &mut custody, super::record_tests::TIME + 6_000);
    assert!(matches!(
        result,
        Err(super::session::OperationFailure {
            error: Error::OutcomeUnknown,
            ..
        })
    ));
    assert_eq!(custody.calls, 1);
    let mut observed = retained;
    let state = storage::inspect(&mut observed).unwrap();
    assert_eq!(
        state.record().progress,
        super::record::Progress::NamespacePrepared
    );
    assert!(state.record().flight.is_some());
}

#[test]
fn already_verified_namespace_still_requires_fresh_custody_proof() {
    let mut record = super::record_tests::namespace_flow()[5].clone();
    let identity = record.namespace.as_ref().unwrap().pin.identity.clone();
    let secret = SecretRecord::namespace(
        identity.reference().clone(),
        identity.namespace_binding().unwrap().clone(),
        Secret32::new([0x77; 32]).unwrap(),
    )
    .unwrap();
    record.namespace.as_mut().unwrap().pin =
        super::record::Pin::from_intent(&RecordIntent::from_record(&secret)).unwrap();
    let token = record::token(&record).unwrap();
    let memory = Memory::with(&record);
    let mut custody = FailingCustody { calls: 0 };
    let result = HeldAttempt::open(memory, token)
        .unwrap()
        .reconcile_namespace(&secret, &mut custody, super::record_tests::TIME + 8_000);
    assert!(matches!(
        result,
        Err(super::session::OperationFailure {
            error: Error::OutcomeUnknown,
            ..
        })
    ));
    assert_eq!(custody.calls, 1);
}

#[test]
fn wrong_namespace_secret_refuses_before_custody_and_preserves_record() {
    let record = super::record_tests::namespace_flow()[3].clone();
    let token = record::token(&record).unwrap();
    let memory = Memory::with(&record);
    let retained = memory.clone();
    let identity = record.namespace.as_ref().unwrap().pin.identity.clone();
    let wrong = SecretRecord::namespace(
        identity.reference().clone(),
        identity.namespace_binding().unwrap().clone(),
        Secret32::new([0x78; 32]).unwrap(),
    )
    .unwrap();
    let mut custody = FailingCustody { calls: 0 };
    let result = HeldAttempt::open(memory, token)
        .unwrap()
        .reconcile_namespace(&wrong, &mut custody, super::record_tests::TIME + 6_000);
    assert!(matches!(
        result,
        Err(super::session::OperationFailure {
            error: Error::Custody,
            ..
        })
    ));
    assert_eq!(custody.calls, 0);
    let mut observed = retained;
    assert!(storage::inspect(&mut observed).unwrap().token() == token);
}

#[test]
fn refresh_failure_refuses_custody_and_preserves_flight() {
    let mut record = super::record_tests::namespace_flow()[3].clone();
    let identity = record.namespace.as_ref().unwrap().pin.identity.clone();
    let secret = SecretRecord::namespace(
        identity.reference().clone(),
        identity.namespace_binding().unwrap().clone(),
        Secret32::new([0x77; 32]).unwrap(),
    )
    .unwrap();
    record.namespace.as_mut().unwrap().pin =
        super::record::Pin::from_intent(&RecordIntent::from_record(&secret)).unwrap();
    let token = record::token(&record).unwrap();
    let memory = Memory::with(&record);
    let retained = memory.clone();
    let held = HeldAttempt::open(memory, token).unwrap();
    retained.fail_next_sync();
    let mut custody = FailingCustody { calls: 0 };
    let result = held.reconcile_namespace(&secret, &mut custody, super::record_tests::TIME + 6_000);
    assert!(matches!(
        result,
        Err(super::session::OperationFailure {
            error: Error::StorageUnavailable,
            ..
        })
    ));
    assert_eq!(custody.calls, 0);
    let mut observed = retained;
    let state = storage::inspect(&mut observed).unwrap();
    assert_eq!(
        state.record().progress,
        super::record::Progress::NamespacePlanned
    );
    assert!(state.record().flight.is_some());
}

/// One durable state, checked request and retained context per operation, all
/// bound to the same synthetic pairing secret. Mirrors the reconstruction
/// fixture: only the exact original secret satisfies the custody intent.
fn operation_fixture(operation: Operation) -> (record::Record, Request, Context, SecretRecord) {
    let mut current = if operation == Operation::Initialize {
        let mut value = initial_record();
        value.revision = 2;
        value.progress = record::Progress::PairingCustodyVerified;
        value
    } else {
        enrolled_record()
    };
    match operation {
        Operation::Initialize | Operation::Namespace => (),
        Operation::Poll | Operation::Confirm => {
            current.progress = record::Progress::Initialized;
            current.reservation = None;
            current.enrollment = None;
            current.last_pairing = None;
            current.account_choice = if operation == Operation::Poll {
                record::AccountChoice::Unchosen
            } else {
                record::AccountChoice::Chosen {
                    account_id: [0x66; 16],
                    chosen_at_ms: TIME + 1_000,
                }
            };
        }
        Operation::Reserve => {
            current.progress = record::Progress::Confirmed;
            current.reservation = None;
            current.enrollment = None;
        }
        Operation::Enroll => {
            current.progress = record::Progress::Reserved;
            current.enrollment = None;
        }
    }
    let secret = SecretRecord::pairing(
        current.pairing.identity.reference().clone(),
        current.intent_id,
        Secret32::new([0x22; 32]).unwrap(),
        Secret32::new([0x33; 32]).unwrap(),
    )
    .unwrap();
    current.pairing = record::Pin::from_intent(&RecordIntent::from_record(&secret)).unwrap();
    let proof = PollProof {
        intent_id: current.intent_id,
        poll_secret: contract::Secret32::from_bytes([0x22; 32]).unwrap(),
    };
    let request = match operation {
        Operation::Initialize => Request::Initialize {
            proof,
            upload_commitment: *current.upload_commitment.as_bytes(),
        },
        Operation::Poll => Request::Poll(proof),
        Operation::Confirm => Request::Confirm {
            proof,
            account_id: [0x66; 16],
        },
        operation => {
            let proof = EnrollmentProof {
                pairing: proof,
                upload_secret: contract::Secret32::from_bytes([0x33; 32]).unwrap(),
            };
            match operation {
                Operation::Reserve => Request::Reserve(proof),
                Operation::Enroll => Request::Enroll(proof),
                Operation::Namespace => Request::Namespace(proof),
                _ => unreachable!(),
            }
        }
    };
    let context = Context {
        now_ms: current.clock_floor_ms,
        initialized_expires_at_ms: current.initialized_expires_at_ms,
        confirmed_account_id: current.account_choice.confirmed(),
        reservation: current.reservation.clone(),
        enrollment: current.enrollment.clone(),
    };
    record::validate(&current).unwrap();
    assert!(contract::valid_context(&request, &context));
    (current, request, context, secret)
}

fn pending_pairing(observed_at_ms: u64) -> AcceptedEnrollment {
    AcceptedEnrollment {
        observed_at_ms,
        result: Ok(Success::Pairing(PairingView {
            state: PairingState::Pending,
            expires_at_ms: TIME + contract::TTL_MS,
            poll_after_ms: contract::POLL_MS,
            approved_account_id: None,
        })),
    }
}

#[test]
fn uncertain_poll_exchange_abandons_only_the_read_and_the_next_poll_settles() {
    let (record, request, context, secret) = operation_fixture(Operation::Poll);
    let token = record::token(&record).unwrap();
    let memory = Memory::with(&record);
    let retained = memory.clone();
    let mut exchange = StubExchange {
        outcomes: VecDeque::from([Err(TransportError::Uncertain)]),
        calls: 0,
    };
    let mut custody = FakeCustody;
    let failure = HeldAttempt::open(memory, token)
        .unwrap()
        .run_operation(
            &request,
            &context,
            &secret,
            &mut custody,
            &mut exchange,
            TIME + 8_000,
            TIME + 8_001,
        )
        .err()
        .expect("uncertain poll exchange fails the operation");
    assert!(matches!(
        failure,
        super::session::OperationFailure {
            error: Error::OutcomeUnknown,
            transport: Some(TransportError::Uncertain),
            ..
        }
    ));
    assert_eq!(exchange.calls, 1);
    // The dead read is durably recorded and abandoned; nothing stays retained
    // and no secret material enters the failure evidence.
    let mut observed = retained.clone();
    let state = storage::inspect(&mut observed).unwrap();
    assert!(state.record().flight.is_none());
    assert_eq!(
        state.record().last_failure,
        Some(record::LastFailure::OutcomeUnknown)
    );
    let bytes = record::encode(state.record()).unwrap();
    for canary in [[0x22; 32], [0x33; 32]] {
        assert!(!bytes.as_bytes().windows(32).any(|part| part == canary));
    }
    // The next paced poll prepares a fresh flight and completes normally.
    let later = Context {
        now_ms: TIME + 12_000,
        ..context.clone()
    };
    let mut exchange = StubExchange {
        outcomes: VecDeque::from([Ok(pending_pairing(TIME + 12_001))]),
        calls: 0,
    };
    let accepted = HeldAttempt::open(retained, state.token())
        .unwrap()
        .run_operation(
            &request,
            &later,
            &secret,
            &mut custody,
            &mut exchange,
            TIME + 12_000,
            TIME + 12_001,
        )
        .ok()
        .expect("poll after abandon settles");
    assert!(matches!(accepted.result, Ok(Success::Pairing(_))));
    assert_eq!(exchange.calls, 1);
    let settled = storage::inspect(&mut observed).unwrap();
    assert!(settled.record().flight.is_none());
    assert_eq!(settled.record().last_failure, None);
    assert_eq!(
        settled
            .record()
            .last_pairing
            .as_ref()
            .unwrap()
            .observed_at_ms,
        TIME + 12_001
    );
}

#[test]
fn retained_dispatched_poll_flight_is_abandoned_before_the_next_operation() {
    let (record, request, context, secret) = operation_fixture(Operation::Poll);
    let token = record::token(&record).unwrap();
    let mut storage = Memory::with(&record);
    let prepared = super::sequencer::prepare_flight(
        &mut storage,
        token,
        &record,
        &request,
        &context,
        TIME + 8_000,
    )
    .unwrap();
    let dispatched = super::sequencer::dispatch_flight(
        &mut storage,
        prepared.token(),
        prepared.record(),
        &request,
        &context,
        TIME + 8_001,
    )
    .unwrap();
    let retained = storage.clone();
    // A dispatched poll flight left by a crash or a lost reply is abandoned
    // durably inside the next operation; the caller's own flight is prepared
    // only after the loss is recorded.
    let later = Context {
        now_ms: TIME + 12_000,
        ..context.clone()
    };
    let mut exchange = StubExchange {
        outcomes: VecDeque::from([Ok(pending_pairing(TIME + 12_001))]),
        calls: 0,
    };
    let mut custody = FakeCustody;
    let accepted = HeldAttempt::open(storage, dispatched.token())
        .unwrap()
        .run_operation(
            &request,
            &later,
            &secret,
            &mut custody,
            &mut exchange,
            TIME + 12_000,
            TIME + 12_001,
        )
        .ok()
        .expect("operation after abandoned poll settles");
    assert!(matches!(accepted.result, Ok(Success::Pairing(_))));
    assert_eq!(exchange.calls, 1, "no implicit redispatch of the dead read");
    let mut observed = retained;
    let settled = storage::inspect(&mut observed).unwrap();
    assert!(settled.record().flight.is_none());
    // The abandoned flight stays counted; only the fresh poll is a new flight.
    // Six revisions: dispatch, abandon, prepare, dispatch, settle — plus the
    // original prepare.
    assert_eq!(settled.record().flights_started, record.flights_started + 2);
    assert_eq!(settled.record().revision, record.revision + 6);
}

#[test]
fn uncertain_mutating_exchange_retains_the_flight_for_reconstruction() {
    for operation in [
        Operation::Initialize,
        Operation::Confirm,
        Operation::Reserve,
        Operation::Enroll,
        Operation::Namespace,
    ] {
        let (record, request, context, secret) = operation_fixture(operation);
        let token = record::token(&record).unwrap();
        let memory = Memory::with(&record);
        let retained = memory.clone();
        let mut exchange = StubExchange {
            outcomes: VecDeque::from([Err(TransportError::Uncertain)]),
            calls: 0,
        };
        let mut custody = FakeCustody;
        let failure = HeldAttempt::open(memory, token)
            .unwrap()
            .run_operation(
                &request,
                &context,
                &secret,
                &mut custody,
                &mut exchange,
                TIME + 8_000,
                TIME + 8_001,
            )
            .err()
            .expect("uncertain exchange fails the operation");
        assert!(matches!(
            failure,
            super::session::OperationFailure {
                error: Error::OutcomeUnknown,
                transport: Some(TransportError::Uncertain),
                ..
            }
        ));
        assert_eq!(exchange.calls, 1);
        let mut observed = retained.clone();
        let state = storage::inspect(&mut observed).unwrap();
        let flight = state.record().flight.as_ref().unwrap();
        assert_eq!(flight.operation, operation);
        assert_eq!(flight.dispatches, 1);
        // A dispatched mutating flight still refuses every later operation.
        let mut retry = StubExchange {
            outcomes: VecDeque::new(),
            calls: 0,
        };
        let failure = HeldAttempt::open(retained, state.token())
            .unwrap()
            .run_operation(
                &request,
                &context,
                &secret,
                &mut custody,
                &mut retry,
                TIME + 8_002,
                TIME + 8_003,
            )
            .err()
            .expect("retained mutating flight refuses closed");
        assert!(matches!(
            failure,
            super::session::OperationFailure {
                error: Error::RecoveryRequired,
                transport: None,
                ..
            }
        ));
        assert_eq!(retry.calls, 0, "no redispatch of a mutating operation");
        assert_eq!(
            storage::inspect(&mut observed)
                .unwrap()
                .record()
                .flight
                .as_ref()
                .unwrap()
                .dispatches,
            1,
            "operation {operation:?} keeps its retained flight"
        );
    }
}
