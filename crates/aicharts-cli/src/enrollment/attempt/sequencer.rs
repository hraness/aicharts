//! Private, dormant attempt sequencing.
//!
//! This module is the only place that turns a checked request and retained
//! context into a persisted flight. It records a canonical digest before any
//! dispatch, records each explicit dispatch separately, and settles only a
//! checked domain result. Transport and ambiguous publication failures retain
//! the flight for explicit reconciliation. No constructor, network caller,
//! vault, reference store or CLI path reaches these functions yet.

use super::{
    record::{
        self, AccountChoice, Commitment, Flight, LastFailure, NamespacePin, Pin, Progress, Record,
        Token,
    },
    storage::{self, DurableSnapshot, Storage},
    Error, Result, MAX_DISPATCHES, MAX_FLIGHTS, MAX_REVISION,
};
use crate::enrollment::contract::{
    self, AccountId, Context, DeviceState, DomainResult, Operation, PairingState, PairingView,
    Request, Success,
};
use aicharts_custody::{
    references::RecordIntent, CredentialRef, NamespaceBinding, Purpose, Secret32, SecretRecord,
};
use sha2::{Digest, Sha256};

const REQUEST_DOMAIN: &[u8] = b"aicharts:enrollment-attempt-request:v1\0";
const CONTEXT_DOMAIN: &[u8] = b"aicharts:enrollment-attempt-context:v1\0";

fn request_digest(request: &Request) -> Result<Commitment> {
    let bytes = contract::encode_request(request).map_err(|_| Error::InvalidRecord)?;
    let mut digest = Sha256::new();
    digest.update(REQUEST_DOMAIN);
    digest.update(bytes.as_bytes());
    Commitment::new(digest.finalize().into())
}

fn push_bytes(output: &mut Vec<u8>, bytes: &[u8]) {
    output.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
    output.extend_from_slice(bytes);
}

fn push_id(output: &mut Vec<u8>, id: &[u8]) {
    push_bytes(output, id);
}

fn push_number(output: &mut Vec<u8>, value: u64) {
    output.extend_from_slice(&value.to_be_bytes());
}

fn push_reservation(output: &mut Vec<u8>, reservation: Option<&contract::Reservation>) {
    match reservation {
        Some(value) => {
            output.push(1);
            push_id(output, &value.intent_id);
            output.extend_from_slice(&value.account_id);
            push_id(output, &value.reservation_id);
            push_id(output, &value.poll_commitment);
            push_id(output, &value.upload_commitment);
            push_id(output, &value.recovery_generation);
            push_number(output, value.reserved_at_ms);
            push_number(output, value.expires_at_ms);
        }
        None => output.push(0),
    }
}

fn push_enrollment(output: &mut Vec<u8>, enrollment: Option<&contract::Enrollment>) {
    match enrollment {
        Some(value) => {
            output.push(1);
            let receipt = &value.receipt;
            output.extend_from_slice(&receipt.account_id);
            push_id(output, &receipt.intent_id);
            push_id(output, &receipt.reservation_id);
            push_id(output, &receipt.device_id);
            push_number(output, receipt.enrolled_at_ms);
            output.push(match value.device_state {
                DeviceState::Active => 1,
                DeviceState::Revoked => 2,
            });
        }
        None => output.push(0),
    }
}

fn context_digest(context: &Context) -> Result<Commitment> {
    // Context contains only retained observations and fixed response facts.
    // Keep this projection hand-written so a future serde change cannot admit
    // a secret-bearing request or map-order variation into the record.
    let mut bytes = Vec::with_capacity(320);
    bytes.extend_from_slice(CONTEXT_DOMAIN);
    push_number(&mut bytes, context.now_ms);
    if let Some(expires) = context.initialized_expires_at_ms {
        bytes.push(1);
        bytes.extend_from_slice(&expires.to_be_bytes());
    } else {
        bytes.push(0);
    }
    match context.confirmed_account_id {
        Some(account) => {
            bytes.push(1);
            bytes.extend_from_slice(&account);
        }
        None => bytes.push(0),
    }
    push_reservation(&mut bytes, context.reservation.as_ref());
    push_enrollment(&mut bytes, context.enrollment.as_ref());
    let mut digest = Sha256::new();
    digest.update(bytes);
    Commitment::new(digest.finalize().into())
}

fn current_token(record: &Record, expected: Token) -> Result<()> {
    if record::token(record)? != expected {
        return Err(Error::StaleSnapshot);
    }
    Ok(())
}

fn request_matches_record(record: &Record, request: &Request) -> bool {
    contract::request_intent_id(request) == record.intent_id
        && contract::request_poll_commitment(request) == *record.poll_commitment.as_bytes()
        && contract::request_upload_commitment(request)
            .is_none_or(|commitment| commitment == *record.upload_commitment.as_bytes())
        && match request {
            Request::Confirm { account_id, .. } => {
                record.account_choice.account() == Some(*account_id)
            }
            _ => true,
        }
}

fn context_matches_record(record: &Record, context: &Context) -> bool {
    context.initialized_expires_at_ms == record.initialized_expires_at_ms
        && context.confirmed_account_id == record.account_choice.confirmed()
        && context.reservation.as_ref() == record.reservation.as_ref()
        && context.enrollment.as_ref() == record.enrollment.as_ref()
}

fn eligible(record: &Record, operation: Operation) -> bool {
    match operation {
        Operation::Initialize => {
            record.progress >= Progress::PairingCustodyVerified
                && record.initialized_expires_at_ms.is_none()
        }
        Operation::Poll => record.progress >= Progress::Initialized,
        Operation::Confirm => {
            record.progress >= Progress::Initialized && record.account_choice.account().is_some()
        }
        Operation::Reserve => record.progress >= Progress::Confirmed,
        Operation::Enroll => record.reservation.is_some(),
        Operation::Namespace => {
            record.progress == Progress::Enrolled
                && record.namespace.is_none()
                && record
                    .enrollment
                    .as_ref()
                    .is_some_and(|enrollment| enrollment.device_state == DeviceState::Active)
        }
    }
}

fn check_call(
    record: &Record,
    expected: Token,
    request: &Request,
    context: &Context,
) -> Result<()> {
    record::validate(record)?;
    current_token(record, expected)?;
    if !contract::valid_context(request, context)
        || !request_matches_record(record, request)
        || !context_matches_record(record, context)
    {
        return Err(Error::InvalidRecord);
    }
    Ok(())
}

fn checked_time(value: u64, floor: u64) -> Result<()> {
    if value > contract::MAX_TIME_MS {
        return Err(Error::InvalidRecord);
    }
    if value < floor {
        return Err(Error::ClockRegressed);
    }
    Ok(())
}

fn check_flight(
    record: &Record,
    request: &Request,
    context: &Context,
) -> Result<(Commitment, Commitment)> {
    let request_sha = request_digest(request)?;
    let context_sha = context_digest(context)?;
    let flight = record.flight.as_ref().ok_or(Error::Missing)?;
    if flight.operation != request.operation()
        || flight.request_sha != request_sha
        || flight.context_sha != context_sha
    {
        return Err(Error::Conflict);
    }
    Ok((request_sha, context_sha))
}

/// Choose one account before confirmation. The account is fixed by the first
/// successful choice and cannot be replaced by a later request or response.
pub(super) fn choose_account<S: Storage>(
    storage: &mut S,
    expected: Token,
    current: &Record,
    account_id: AccountId,
    chosen_at_ms: u64,
) -> Result<DurableSnapshot> {
    record::validate(current)?;
    current_token(current, expected)?;
    if current.progress < Progress::Initialized
        || current.flight.is_some()
        || current.account_choice != AccountChoice::Unchosen
        || account_id.iter().all(|byte| *byte == 0)
    {
        return Err(Error::Conflict);
    }
    checked_time(chosen_at_ms, current.clock_floor_ms)?;
    let expires = current
        .initialized_expires_at_ms
        .ok_or(Error::InvalidRecord)?;
    if chosen_at_ms >= expires {
        return Err(Error::InvalidSuccessor);
    }
    let mut next = current.clone();
    next.revision = next.revision.checked_add(1).ok_or(Error::Limit)?;
    next.clock_floor_ms = chosen_at_ms;
    next.account_choice = AccountChoice::Chosen {
        account_id,
        chosen_at_ms,
    };
    next.last_failure = None;
    storage::compare_and_publish(storage, expected, &next)
}

/// Persist a canonical request/context flight before sending any bytes.
pub(super) fn prepare_flight<S: Storage>(
    storage: &mut S,
    expected: Token,
    current: &Record,
    request: &Request,
    context: &Context,
    prepared_at_ms: u64,
) -> Result<DurableSnapshot> {
    check_call(current, expected, request, context)?;
    if current.flight.is_some() {
        return Err(Error::Busy);
    }
    if !eligible(current, request.operation()) {
        return Err(Error::InvalidSuccessor);
    }
    checked_time(prepared_at_ms, current.clock_floor_ms)?;
    if prepared_at_ms < context.now_ms {
        return Err(Error::ClockRegressed);
    }
    if current.flights_started >= MAX_FLIGHTS || current.revision >= MAX_REVISION {
        return Err(Error::Limit);
    }
    let request_sha = request_digest(request)?;
    let context_sha = context_digest(context)?;
    let mut next = current.clone();
    next.revision += 1;
    next.clock_floor_ms = prepared_at_ms;
    next.flights_started += 1;
    next.flight = Some(Flight {
        operation: request.operation(),
        ordinal: next.flights_started,
        prepared_revision: next.revision,
        prepared_at_ms,
        last_attempt_at_ms: None,
        dispatches: 0,
        request_sha,
        context_sha,
    });
    next.last_failure = None;
    storage::compare_and_publish(storage, expected, &next)
}

/// Record one explicit dispatch. Every network retry must pass the same
/// request/context digest and receive a new bounded dispatch count.
pub(super) fn dispatch_flight<S: Storage>(
    storage: &mut S,
    expected: Token,
    current: &Record,
    request: &Request,
    context: &Context,
    attempted_at_ms: u64,
) -> Result<DurableSnapshot> {
    check_call(current, expected, request, context)?;
    let (request_sha, context_sha) = check_flight(current, request, context)?;
    let old = current.flight.as_ref().ok_or(Error::Missing)?;
    if old.dispatches >= MAX_DISPATCHES {
        return Err(Error::Limit);
    }
    checked_time(attempted_at_ms, current.clock_floor_ms)?;
    if attempted_at_ms < context.now_ms {
        return Err(Error::ClockRegressed);
    }
    if matches!(
        request.operation(),
        Operation::Confirm | Operation::Namespace
    ) && (current
        .initialized_expires_at_ms
        .is_some_and(|expires| attempted_at_ms >= expires)
        || current.reservation.as_ref().is_some_and(|reservation| {
            request.operation() == Operation::Namespace
                && attempted_at_ms >= reservation.expires_at_ms
        }))
    {
        return Err(Error::InvalidSuccessor);
    }
    let mut next = current.clone();
    next.revision += 1;
    next.clock_floor_ms = attempted_at_ms;
    next.flight = Some(Flight {
        operation: old.operation,
        ordinal: old.ordinal,
        prepared_revision: old.prepared_revision,
        prepared_at_ms: old.prepared_at_ms,
        last_attempt_at_ms: Some(attempted_at_ms),
        dispatches: old.dispatches + 1,
        request_sha,
        context_sha,
    });
    next.last_failure = None;
    storage::compare_and_publish(storage, expected, &next)
}

fn failure<S: Storage>(
    storage: &mut S,
    expected: Token,
    current: &Record,
    request: &Request,
    context: &Context,
    observed_at_ms: u64,
    value: LastFailure,
) -> Result<DurableSnapshot> {
    check_call(current, expected, request, context)?;
    check_flight(current, request, context)?;
    if current
        .flight
        .as_ref()
        .is_none_or(|flight| flight.dispatches == 0)
    {
        return Err(Error::Conflict);
    }
    checked_time(observed_at_ms, current.clock_floor_ms)?;
    let mut next = current.clone();
    next.revision += 1;
    next.clock_floor_ms = observed_at_ms;
    next.last_failure = Some(value);
    storage::compare_and_publish(storage, expected, &next)
}

/// Retain a flight after a transport failure. No retry is implied or started.
pub(super) fn record_transport_failure<S: Storage>(
    storage: &mut S,
    expected: Token,
    current: &Record,
    request: &Request,
    context: &Context,
    observed_at_ms: u64,
) -> Result<DurableSnapshot> {
    failure(
        storage,
        expected,
        current,
        request,
        context,
        observed_at_ms,
        LastFailure::Transport,
    )
}

/// Retain a flight when publication or remote delivery has an ambiguous
/// outcome. Reconciliation must inspect the exact committed token first.
pub(super) fn record_unknown_outcome<S: Storage>(
    storage: &mut S,
    expected: Token,
    current: &Record,
    request: &Request,
    context: &Context,
    observed_at_ms: u64,
) -> Result<DurableSnapshot> {
    failure(
        storage,
        expected,
        current,
        request,
        context,
        observed_at_ms,
        LastFailure::OutcomeUnknown,
    )
}

fn pairing_view(view: &PairingView) -> PairingView {
    PairingView {
        state: view.state,
        expires_at_ms: view.expires_at_ms,
        poll_after_ms: view.poll_after_ms,
        approved_account_id: view.approved_account_id,
    }
}

fn namespace_pin(
    record: &Record,
    namespace: &contract::Namespace,
    accepted_at_ms: u64,
) -> Result<NamespacePin> {
    let reservation = record.reservation.as_ref().ok_or(Error::InvalidSuccessor)?;
    let reference = CredentialRef::new(
        record.installation_id,
        record.namespace_item_id,
        Purpose::Namespace,
    )
    .map_err(|_| Error::InvalidSuccessor)?;
    let binding = NamespaceBinding::new(reservation.account_id, reservation.recovery_generation, 1)
        .map_err(|_| Error::InvalidSuccessor)?;
    let secret = SecretRecord::namespace(
        reference,
        binding,
        Secret32::new(*namespace.namespace_key.as_bytes()).map_err(|_| Error::InvalidSuccessor)?,
    )
    .map_err(|_| Error::InvalidSuccessor)?;
    let intent = RecordIntent::from_record(&secret);
    Ok(NamespacePin {
        pin: Pin::from_intent(&intent)?,
        accepted_at_ms,
    })
}

/// Settle one checked domain response. Domain errors remain fixed failure
/// facts; completed non-namespace flights clear, while a namespace flight is
/// retained until local custody has separately verified or reconciled it.
pub(super) fn settle_response<S: Storage>(
    storage: &mut S,
    expected: Token,
    current: &Record,
    request: &Request,
    context: &Context,
    observed_at_ms: u64,
    result: &DomainResult,
) -> Result<DurableSnapshot> {
    check_call(current, expected, request, context)?;
    check_flight(current, request, context)?;
    if current
        .flight
        .as_ref()
        .is_none_or(|flight| flight.dispatches == 0)
    {
        return Err(Error::Conflict);
    }
    checked_time(observed_at_ms, current.clock_floor_ms)?;
    if observed_at_ms < context.now_ms {
        return Err(Error::ClockRegressed);
    }
    let mut observed = context.clone();
    observed.now_ms = observed_at_ms;
    contract::encode_response(request, &observed, result).map_err(|_| Error::InvalidSuccessor)?;
    let mut next = current.clone();
    next.revision += 1;
    next.clock_floor_ms = observed_at_ms;
    next.last_failure = None;
    match result {
        Err(error) => {
            next.last_failure = Some(LastFailure::Domain {
                operation: request.operation(),
                error: *error,
            });
            if request.operation() != Operation::Namespace {
                next.flight = None;
            }
        }
        Ok(success) => match (request.operation(), success) {
            (Operation::Initialize, Success::Initialized { expires_at_ms }) => {
                next.progress = Progress::Initialized;
                next.initialized_expires_at_ms = Some(*expires_at_ms);
                next.flight = None;
            }
            (Operation::Poll, Success::Pairing(view)) => {
                next.last_pairing = Some(record::PairingObservation {
                    observed_at_ms,
                    view: pairing_view(view),
                });
                next.flight = None;
            }
            (Operation::Confirm, Success::Pairing(view)) => {
                let account_id = match request {
                    Request::Confirm { account_id, .. } => *account_id,
                    _ => return Err(Error::InvalidSuccessor),
                };
                let chosen_at_ms = match current.account_choice {
                    AccountChoice::Chosen {
                        account_id: chosen,
                        chosen_at_ms,
                    } if chosen == account_id => chosen_at_ms,
                    AccountChoice::Confirmed {
                        account_id: confirmed,
                        chosen_at_ms,
                        ..
                    } if confirmed == account_id => chosen_at_ms,
                    _ => return Err(Error::Conflict),
                };
                if view.state != PairingState::TerminalConfirmed
                    || view.approved_account_id != Some(account_id)
                {
                    return Err(Error::InvalidSuccessor);
                }
                next.progress = Progress::Confirmed;
                next.account_choice = match current.account_choice {
                    AccountChoice::Confirmed { .. } => current.account_choice,
                    AccountChoice::Chosen { .. } => AccountChoice::Confirmed {
                        account_id,
                        chosen_at_ms,
                        confirmed_at_ms: observed_at_ms,
                    },
                    AccountChoice::Unchosen => return Err(Error::Conflict),
                };
                next.last_pairing = Some(record::PairingObservation {
                    observed_at_ms,
                    view: pairing_view(view),
                });
                next.flight = None;
            }
            (Operation::Reserve, Success::Reserved(reservation)) => {
                next.progress = Progress::Reserved;
                next.reservation = Some(reservation.clone());
                next.flight = None;
            }
            (
                Operation::Enroll,
                Success::Enrolled {
                    reservation,
                    enrollment,
                },
            ) => {
                next.progress = Progress::Enrolled;
                next.reservation = Some(reservation.clone());
                next.enrollment = Some(enrollment.clone());
                next.flight = None;
            }
            (
                Operation::Namespace,
                Success::Namespace {
                    reservation: _,
                    namespace,
                },
            ) => {
                next.progress = Progress::NamespacePlanned;
                next.namespace = Some(namespace_pin(current, namespace, observed_at_ms)?);
                // The namespace flight is intentionally retained for the
                // later private custody/reference transition.
            }
            _ => return Err(Error::InvalidSuccessor),
        },
    }
    storage::compare_and_publish(storage, expected, &next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::enrollment::attempt::record_tests::{copy, enrolled_record, initial_record, TIME};
    use crate::enrollment::contract::Id;
    use std::cell::RefCell;
    use std::rc::Rc;

    #[derive(Default)]
    struct Disk {
        committed: Option<Vec<u8>>,
        candidate: Option<storage::Candidate>,
        locked: bool,
    }
    #[derive(Clone, Default)]
    struct Memory(Rc<RefCell<Disk>>);

    impl Memory {
        fn with(record: &Record) -> Self {
            Self(Rc::new(RefCell::new(Disk {
                committed: Some(record::encode(record).unwrap().as_bytes().to_vec()),
                ..Disk::default()
            })))
        }
    }

    impl Storage for Memory {
        fn lock(&mut self) -> Result<()> {
            let mut disk = self.0.borrow_mut();
            if disk.locked {
                return Err(Error::Busy);
            }
            disk.locked = true;
            Ok(())
        }
        fn unlock(&mut self) {
            self.0.borrow_mut().locked = false;
        }
        fn read_committed(&mut self, max_bytes: usize) -> Result<Option<Vec<u8>>> {
            assert_eq!(max_bytes, super::super::MAX_RECORD_BYTES);
            Ok(self.0.borrow().committed.clone())
        }
        fn sync_committed(&mut self) -> Result<()> {
            Ok(())
        }
        fn stage(&mut self, candidate: &storage::Candidate) -> Result<()> {
            self.0.borrow_mut().candidate = Some(candidate.clone());
            Ok(())
        }
        fn sync_candidate(&mut self) -> Result<()> {
            Ok(())
        }
        fn publish(&mut self, candidate: &storage::Candidate) -> Result<()> {
            let mut disk = self.0.borrow_mut();
            let current = disk.committed.as_deref().map(record::decode).transpose()?;
            let token = current.as_ref().map(record::token).transpose()?;
            if token != candidate.expected || disk.candidate.as_ref() != Some(candidate) {
                return Err(Error::Conflict);
            }
            disk.committed = Some(candidate.bytes.as_bytes().to_vec());
            disk.candidate = None;
            Ok(())
        }
        fn sync_directory(&mut self) -> Result<()> {
            Ok(())
        }
    }

    fn proof() -> contract::PollProof {
        contract::PollProof {
            intent_id: [0x11; 32],
            poll_secret: contract::Secret32::from_bytes([0x22; 32]).unwrap(),
        }
    }
    fn fixed_id(text: &str) -> Id {
        let mut id = [0; 32];
        for (byte, pair) in id.iter_mut().zip(text.as_bytes().chunks_exact(2)) {
            *byte = u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap();
        }
        id
    }
    fn initialize_request() -> Request {
        Request::Initialize {
            proof: proof(),
            upload_commitment: fixed_id(
                "497cbafd9fe88f7295283d30ec0d8a812545be8a0bf812d879bb31cec40421e0",
            ),
        }
    }
    fn initialized_record() -> Record {
        let mut record = initial_record();
        record.revision = 2;
        record.progress = Progress::PairingCustodyVerified;
        record
    }
    fn empty_context() -> Context {
        Context {
            now_ms: TIME,
            initialized_expires_at_ms: None,
            confirmed_account_id: None,
            reservation: None,
            enrollment: None,
        }
    }

    #[test]
    fn prepare_and_dispatch_persist_only_digests_and_bound_retries() {
        let record = initialized_record();
        let request = initialize_request();
        let context = empty_context();
        let mut storage = Memory::with(&record);
        let token = record::token(&record).unwrap();
        let prepared =
            prepare_flight(&mut storage, token, &record, &request, &context, TIME + 1).unwrap();
        let next = prepared.record();
        assert_eq!(next.progress, Progress::PairingCustodyVerified);
        assert_eq!(next.flight.as_ref().unwrap().dispatches, 0);
        let bytes = record::encode(next).unwrap();
        assert!(!bytes
            .as_bytes()
            .windows(64)
            .any(|window| window == [0x22; 32]));
        let dispatched = dispatch_flight(
            &mut storage,
            prepared.token(),
            next,
            &request,
            &context,
            TIME + 2,
        )
        .unwrap();
        assert_eq!(dispatched.record().flight.as_ref().unwrap().dispatches, 1);
        assert!(dispatch_flight(
            &mut storage,
            dispatched.token(),
            dispatched.record(),
            &request,
            &context,
            TIME + 3,
        )
        .is_ok());
    }

    #[test]
    fn transport_failure_retains_flight_and_changed_context_cannot_retry_it() {
        let record = initialized_record();
        let request = initialize_request();
        let context = empty_context();
        let mut storage = Memory::with(&record);
        let prepared = prepare_flight(
            &mut storage,
            record::token(&record).unwrap(),
            &record,
            &request,
            &context,
            TIME + 1,
        )
        .unwrap();
        let dispatched = dispatch_flight(
            &mut storage,
            prepared.token(),
            prepared.record(),
            &request,
            &context,
            TIME + 2,
        )
        .unwrap();
        let failed = record_transport_failure(
            &mut storage,
            dispatched.token(),
            dispatched.record(),
            &request,
            &context,
            TIME + 3,
        )
        .unwrap();
        assert_eq!(failed.record().last_failure, Some(LastFailure::Transport));
        assert!(failed.record().flight.is_some());
        let mut changed = context.clone();
        changed.now_ms += 1;
        assert!(dispatch_flight(
            &mut storage,
            failed.token(),
            failed.record(),
            &request,
            &changed,
            TIME + 4,
        )
        .is_err());
    }

    #[test]
    fn initialize_success_settles_and_account_choice_is_single_use() {
        let record = initialized_record();
        let request = initialize_request();
        let context = empty_context();
        let mut storage = Memory::with(&record);
        let prepared = prepare_flight(
            &mut storage,
            record::token(&record).unwrap(),
            &record,
            &request,
            &context,
            TIME + 1,
        )
        .unwrap();
        let dispatched = dispatch_flight(
            &mut storage,
            prepared.token(),
            prepared.record(),
            &request,
            &context,
            TIME + 2,
        )
        .unwrap();
        let result = Ok(Success::Initialized {
            expires_at_ms: TIME + contract::TTL_MS,
        });
        let settled = settle_response(
            &mut storage,
            dispatched.token(),
            dispatched.record(),
            &request,
            &context,
            TIME + 3,
            &result,
        )
        .unwrap();
        assert_eq!(settled.record().progress, Progress::Initialized);
        assert!(settled.record().flight.is_none());
        let mut current = copy(settled.record());
        let token = settled.token();
        let chosen = choose_account(&mut storage, token, &current, [0x66; 16], TIME + 4).unwrap();
        current = copy(chosen.record());
        let confirm_context = Context {
            now_ms: TIME + 4,
            initialized_expires_at_ms: current.initialized_expires_at_ms,
            confirmed_account_id: None,
            reservation: None,
            enrollment: None,
        };
        let wrong_account = Request::Confirm {
            proof: proof(),
            account_id: [0x77; 16],
        };
        assert!(prepare_flight(
            &mut storage,
            chosen.token(),
            &current,
            &wrong_account,
            &confirm_context,
            TIME + 5,
        )
        .is_err());
        assert!(
            choose_account(&mut storage, chosen.token(), &current, [0x77; 16], TIME + 5,).is_err()
        );
    }

    #[test]
    fn namespace_success_pins_secret_commitment_and_keeps_flight() {
        let record = enrolled_record();
        let request = Request::Namespace(contract::EnrollmentProof {
            pairing: proof(),
            upload_secret: contract::Secret32::from_bytes([0x33; 32]).unwrap(),
        });
        let context = Context {
            now_ms: TIME + 7_000,
            initialized_expires_at_ms: record.initialized_expires_at_ms,
            confirmed_account_id: Some([0x66; 16]),
            reservation: record.reservation.clone(),
            enrollment: record.enrollment.clone(),
        };
        let mut storage = Memory::with(&record);
        let prepared = prepare_flight(
            &mut storage,
            record::token(&record).unwrap(),
            &record,
            &request,
            &context,
            TIME + 8_000,
        )
        .unwrap();
        let dispatched = dispatch_flight(
            &mut storage,
            prepared.token(),
            prepared.record(),
            &request,
            &context,
            TIME + 8_001,
        )
        .unwrap();
        let namespace = contract::Namespace {
            namespace_key: contract::Secret32::from_bytes([0x77; 32]).unwrap(),
            receipt: record.enrollment.as_ref().unwrap().receipt.clone(),
        };
        let result = Ok(Success::Namespace {
            reservation: record.reservation.clone().unwrap(),
            namespace,
        });
        let settled = settle_response(
            &mut storage,
            dispatched.token(),
            dispatched.record(),
            &request,
            &context,
            TIME + 8_002,
            &result,
        )
        .unwrap();
        assert_eq!(settled.record().progress, Progress::NamespacePlanned);
        assert!(settled.record().flight.is_some());
        assert_ne!(
            settled
                .record()
                .namespace
                .as_ref()
                .unwrap()
                .pin
                .commitment
                .as_bytes(),
            &[0x77; 32]
        );
    }
}
