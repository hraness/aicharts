use super::super::contract::{self, Success};
use super::super::https::AcceptedEnrollment;
use super::session::ExchangePort;
use super::{
    record,
    record_tests::initial_record,
    sequencer::tests::Memory,
    session::HeldAttempt,
    storage::{self, Candidate, Storage},
    Error, Result,
};
use aicharts_custody::{references::RecordIntent, CredentialRef, Purpose, Secret32, SecretRecord};

struct FakeCustody;
impl super::session::CustodyPort for FakeCustody {
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
