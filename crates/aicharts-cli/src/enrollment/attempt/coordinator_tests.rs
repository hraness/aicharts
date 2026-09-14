use super::coordinator;
use super::record;
use super::sequencer::tests::Memory;
use super::session::{CustodyPort, ExchangePort, HeldAttempt};
use super::{Error, Result};
use crate::enrollment::contract;
use crate::enrollment::https::{AcceptedEnrollment, TransportError};
use aicharts_custody::{references::RecordIntent, CredentialRef, Purpose, Secret32, SecretRecord};

struct CountingCustody {
    calls: usize,
    installs: usize,
}
impl CustodyPort for CountingCustody {
    fn install_pairing(&mut self, _record: &record::Record, _secret: &SecretRecord) -> Result<()> {
        self.installs += 1;
        Ok(())
    }
    fn verify_pairing(&mut self, _record: &record::Record, _secret: &SecretRecord) -> Result<()> {
        self.calls += 1;
        Ok(())
    }
    fn install_namespace(
        &mut self,
        _record: &record::Record,
        _secret: &SecretRecord,
    ) -> Result<()> {
        self.installs += 1;
        Ok(())
    }
    fn reconcile_namespace(
        &mut self,
        _record: &record::Record,
        _secret: &SecretRecord,
    ) -> Result<()> {
        self.calls += 1;
        Ok(())
    }
}

struct CountingExchange {
    calls: usize,
}
impl ExchangePort for CountingExchange {
    fn exchange(
        &mut self,
        _request: &contract::Request,
        _context: &contract::Context,
        _floor_ms: u64,
    ) -> std::result::Result<AcceptedEnrollment, TransportError> {
        self.calls += 1;
        Err(TransportError::Unavailable)
    }
}

fn pairing_secret(record: &record::Record) -> SecretRecord {
    SecretRecord::pairing(
        CredentialRef::new(record.installation_id, [0xb2; 32], Purpose::Pairing).unwrap(),
        record.intent_id,
        Secret32::new([0x22; 32]).unwrap(),
        Secret32::new([0x33; 32]).unwrap(),
    )
    .unwrap()
}

#[test]
fn coordinator_refreshes_before_effects_and_consumes_session_on_failure() {
    let mut current = super::sequencer::tests::initialized_record();
    let secret = pairing_secret(&current);
    current.pairing = record::Pin::from_intent(&RecordIntent::from_record(&secret)).unwrap();
    let token = record::token(&current).unwrap();
    let memory = Memory::with(&current);
    let held = HeldAttempt::open(memory.clone(), token).unwrap();
    memory.fail_next_sync();
    let mut custody = CountingCustody {
        calls: 0,
        installs: 0,
    };
    let mut exchange = CountingExchange { calls: 0 };
    let result = coordinator::exchange_once(
        held,
        &super::sequencer::tests::initialize_request(),
        &super::sequencer::tests::empty_context(),
        &secret,
        &mut custody,
        &mut exchange,
        super::record_tests::TIME + 1,
        super::record_tests::TIME + 2,
    );
    assert!(matches!(result, Err(failure) if failure.error == Error::StorageUnavailable));
    assert_eq!(custody.calls, 0);
    assert_eq!(exchange.calls, 0);
    let mut reopened = memory.clone();
    let observed = super::storage::inspect(&mut reopened).unwrap();
    assert_eq!(observed.token().revision(), token.revision());
    assert_eq!(observed.token().digest(), token.digest());
}

#[test]
fn pairing_completion_installs_once_before_any_exchange() {
    let mut current = super::record_tests::initial_record();
    let secret = pairing_secret(&current);
    current.pairing = record::Pin::from_intent(&RecordIntent::from_record(&secret)).unwrap();
    let token = record::token(&current).unwrap();
    let memory = Memory::with(&current);
    let held = HeldAttempt::open(memory.clone(), token).unwrap();
    let mut custody = CountingCustody {
        calls: 0,
        installs: 0,
    };
    let mut held = held;
    held.complete_pairing(&secret, &mut custody, super::record_tests::TIME + 1)
        .unwrap();
    assert_eq!(custody.installs, 1);
    assert_eq!(custody.calls, 0);
    assert_eq!(
        held.record().progress,
        super::record::Progress::PairingCustodyVerified
    );
}

#[test]
fn coordinator_request_projection_binds_operation_and_frozen_context() {
    let mut current = super::sequencer::tests::initialized_record();
    let secret = pairing_secret(&current);
    current.pairing = record::Pin::from_intent(&RecordIntent::from_record(&secret)).unwrap();
    let (request, context) = coordinator::request_for_operation(
        &current,
        &secret,
        contract::Operation::Initialize,
        None,
        super::record_tests::TIME + 1,
    )
    .unwrap();
    assert_eq!(request.operation(), contract::Operation::Initialize);
    assert_eq!(context.now_ms, super::record_tests::TIME + 1);
    assert_eq!(
        coordinator::pairing_url(&current.intent_id),
        "https://aicharts.io/usage/pairing#intentId=1111111111111111111111111111111111111111111111111111111111111111"
    );
}

#[test]
fn coordinator_request_projection_rejects_wrong_secret_and_clock() {
    let current = super::sequencer::tests::initialized_record();
    let wrong = SecretRecord::pairing(
        CredentialRef::new(current.installation_id, [0xb2; 32], Purpose::Pairing).unwrap(),
        [0x99; 32],
        Secret32::new([0x22; 32]).unwrap(),
        Secret32::new([0x33; 32]).unwrap(),
    )
    .unwrap();
    assert!(matches!(
        coordinator::request_for_operation(
            &current,
            &wrong,
            contract::Operation::Initialize,
            None,
            super::record_tests::TIME + 1,
        ),
        Err(Error::Custody)
    ));
}
