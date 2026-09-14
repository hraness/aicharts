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
    references::{RecordIntent, ReferenceStore},
    CredentialRef, NamespaceBinding, Purpose, Secret32, SecretRecord, Vault,
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

fn secret_matches_pin(secret: &SecretRecord, pin: &Pin) -> bool {
    let intent = RecordIntent::from_record(secret);
    intent.identity() == &pin.identity && intent.commitment() == pin.commitment.as_bytes()
}

fn complete_custody<S: Storage>(
    storage: &mut S,
    expected: Token,
    current: &Record,
    next: &Record,
    install: impl FnOnce() -> Result<()>,
) -> Result<DurableSnapshot> {
    current_token(current, expected)?;
    if current.revision == MAX_REVISION {
        return Err(Error::Limit);
    }
    record::successor(current, next)?;
    // A caller-owned record is only an observation. Require the exact durable
    // predecessor before custody, then compare it again when publishing. A
    // concurrent change after this read cannot authorize a different secret.
    storage::read_durable(storage, expected)?;
    install()?;
    storage::compare_and_publish(storage, expected, next)
}

/// Persist the pairing secret's nonsecret custody state before enrollment can
/// dispatch. The secret is checked against the original typed identity and
/// commitment; its bytes never enter the attempt record.
pub(super) fn prepare_pairing_custody<S: Storage>(
    storage: &mut S,
    expected: Token,
    current: &Record,
    secret: &SecretRecord,
    prepared_at_ms: u64,
) -> Result<DurableSnapshot> {
    record::validate(current)?;
    current_token(current, expected)?;
    if current.progress != Progress::PairingPlanned
        || current.flight.is_some()
        || !secret_matches_pin(secret, &current.pairing)
    {
        return Err(Error::Conflict);
    }
    checked_time(prepared_at_ms, current.clock_floor_ms)?;
    let mut next = current.clone();
    next.revision = next.revision.checked_add(1).ok_or(Error::Limit)?;
    next.clock_floor_ms = prepared_at_ms;
    next.progress = Progress::PairingPrepared;
    next.last_failure = None;
    storage::compare_and_publish(storage, expected, &next)
}

/// Complete pairing custody through the sealed reference-store API. The
/// reference manifest and vault must both acknowledge the exact original
/// secret before the attempt becomes dispatchable. A stale attempt snapshot
/// is reported after custody work and is reconciled by repeating this same
/// identity-bound operation; the reference store itself is idempotent.
pub(super) fn complete_pairing_custody<S: Storage>(
    storage: &mut S,
    expected: Token,
    current: &Record,
    secret: &SecretRecord,
    references: &mut ReferenceStore,
    vault: &mut Vault,
) -> Result<DurableSnapshot> {
    record::validate(current)?;
    current_token(current, expected)?;
    if current.progress != Progress::PairingPrepared
        || current.flight.is_some()
        || !secret_matches_pin(secret, &current.pairing)
    {
        return Err(Error::Conflict);
    }
    let mut next = current.clone();
    next.revision = next.revision.checked_add(1).ok_or(Error::Limit)?;
    next.progress = Progress::PairingCustodyVerified;
    next.last_failure = None;
    complete_custody(storage, expected, current, &next, || {
        let manifest = references.snapshot().map_err(|_| Error::Custody)?;
        let prepared = references
            .prepare(&manifest.token(), secret)
            .map_err(|_| Error::Custody)?;
        references
            .install_prepared(&prepared.token(), secret, vault)
            .map_err(|_| Error::Custody)?;
        Ok(())
    })
}

/// Persist the namespace secret's nonsecret custody state after a checked
/// namespace response. The accepted namespace pin and retained flight remain
/// unchanged while the reference operation is prepared.
pub(super) fn prepare_namespace_custody<S: Storage>(
    storage: &mut S,
    expected: Token,
    current: &Record,
    secret: &SecretRecord,
    prepared_at_ms: u64,
) -> Result<DurableSnapshot> {
    record::validate(current)?;
    current_token(current, expected)?;
    let namespace = current.namespace.as_ref().ok_or(Error::Conflict)?;
    if current.progress != Progress::NamespacePlanned
        || current
            .flight
            .as_ref()
            .is_none_or(|flight| flight.operation != Operation::Namespace || flight.dispatches == 0)
        || !secret_matches_pin(secret, &namespace.pin)
    {
        return Err(Error::Conflict);
    }
    checked_time(prepared_at_ms, current.clock_floor_ms)?;
    let mut next = current.clone();
    next.revision = next.revision.checked_add(1).ok_or(Error::Limit)?;
    next.clock_floor_ms = prepared_at_ms;
    next.progress = Progress::NamespacePrepared;
    next.last_failure = None;
    storage::compare_and_publish(storage, expected, &next)
}

/// Complete namespace custody through the sealed reference-store API. The
/// original accepted secret is read back by the store before this transition
/// clears the retained namespace flight.
pub(super) fn complete_namespace_custody<S: Storage>(
    storage: &mut S,
    expected: Token,
    current: &Record,
    secret: &SecretRecord,
    references: &mut ReferenceStore,
    vault: &mut Vault,
) -> Result<DurableSnapshot> {
    record::validate(current)?;
    current_token(current, expected)?;
    let namespace = current.namespace.as_ref().ok_or(Error::Conflict)?;
    if current.progress != Progress::NamespacePrepared
        || current
            .flight
            .as_ref()
            .is_none_or(|flight| flight.operation != Operation::Namespace || flight.dispatches == 0)
        || !secret_matches_pin(secret, &namespace.pin)
    {
        return Err(Error::Conflict);
    }
    let mut next = current.clone();
    next.revision = next.revision.checked_add(1).ok_or(Error::Limit)?;
    next.progress = Progress::NamespaceCustodyVerified;
    next.flight = None;
    next.last_failure = None;
    complete_custody(storage, expected, current, &next, || {
        let manifest = references.snapshot().map_err(|_| Error::Custody)?;
        let prepared = references
            .prepare(&manifest.token(), secret)
            .map_err(|_| Error::Custody)?;
        references
            .install_prepared(&prepared.token(), secret, vault)
            .map_err(|_| Error::Custody)?;
        Ok(())
    })
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
        || flight.context_now_ms != context.now_ms
        || flight.request_sha != request_sha
        || flight.context_sha != context_sha
    {
        return Err(Error::Conflict);
    }
    Ok((request_sha, context_sha))
}

/// Reconstruct only one retained flight from its exact local observation and
/// original typed pairing custody. This does no I/O and establishes neither
/// current vault contents nor permission to dispatch. The original context time
/// remains frozen; dispatch and acceptance still require fresh observations.
pub(super) fn reconstruct_flight(
    current: &Record,
    expected: Token,
    secret: &SecretRecord,
) -> Result<(Request, Context)> {
    record::validate(current)?;
    current_token(current, expected)?;
    let flight = current.flight.as_ref().ok_or(Error::Missing)?;
    if !secret_matches_pin(secret, &current.pairing) {
        return Err(Error::Custody);
    }
    let proof = secret
        .with_pairing_secrets(|poll, upload| -> Result<_> {
            Ok(contract::EnrollmentProof {
                pairing: contract::PollProof {
                    intent_id: current.intent_id,
                    poll_secret: contract::Secret32::from_bytes(*poll).ok_or(Error::Custody)?,
                },
                upload_secret: contract::Secret32::from_bytes(*upload).ok_or(Error::Custody)?,
            })
        })
        .map_err(|_| Error::Custody)??;
    // Check both commitments even when the retained operation sends only the
    // polling proof. Reuse the canonical codec's commitment projections.
    let both = Request::Reserve(proof);
    if !request_matches_record(current, &both) {
        return Err(Error::Custody);
    }
    let Request::Reserve(proof) = both else {
        return Err(Error::InvalidRecord);
    };
    let request = match flight.operation {
        Operation::Initialize => Request::Initialize {
            proof: proof.pairing,
            upload_commitment: *current.upload_commitment.as_bytes(),
        },
        Operation::Poll => Request::Poll(proof.pairing),
        Operation::Confirm => Request::Confirm {
            proof: proof.pairing,
            account_id: current
                .account_choice
                .account()
                .ok_or(Error::InvalidRecord)?,
        },
        Operation::Reserve => Request::Reserve(proof),
        Operation::Enroll => Request::Enroll(proof),
        Operation::Namespace => Request::Namespace(proof),
    };
    let context = Context {
        now_ms: flight.context_now_ms,
        initialized_expires_at_ms: current.initialized_expires_at_ms,
        confirmed_account_id: current.account_choice.confirmed(),
        reservation: current.reservation.clone(),
        enrollment: current.enrollment.clone(),
    };
    check_call(current, expected, &request, &context)?;
    check_flight(current, &request, &context)?;
    Ok((request, context))
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
        context_now_ms: context.now_ms,
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
        context_now_ms: old.context_now_ms,
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
    use crate::enrollment::attempt::record_tests;
    use crate::enrollment::attempt::record_tests::{copy, enrolled_record, initial_record, TIME};
    use crate::enrollment::contract::Id;
    use std::cell::RefCell;
    use std::rc::Rc;

    #[derive(Default)]
    struct Disk {
        committed: Option<Vec<u8>>,
        candidate: Option<storage::Candidate>,
        locked: bool,
        sync_error: Option<Error>,
        file_synced: bool,
        directory_synced: bool,
    }
    #[derive(Clone, Default)]
    pub(super) struct Memory(Rc<RefCell<Disk>>);

    impl Memory {
        pub(super) fn with(record: &Record) -> Self {
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
            let mut disk = self.0.borrow_mut();
            if let Some(error) = disk.sync_error {
                return Err(error);
            }
            disk.file_synced = true;
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
            self.0.borrow_mut().directory_synced = true;
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
    fn prepared_flight_retains_original_context_time_after_serialization() {
        let current = initialized_record();
        let mut storage = Memory::with(&current);
        let original = empty_context();
        let prepared = prepare_flight(
            &mut storage,
            record::token(&current).unwrap(),
            &current,
            &initialize_request(),
            &original,
            TIME + 1,
        )
        .unwrap();
        let bytes = record::encode(prepared.record()).unwrap();
        let text = std::str::from_utf8(bytes.as_bytes()).unwrap();
        assert!(text.contains("\"contextNowMs\":1789300800000"));
        assert!(text.contains("\"preparedAtMs\":1789300800001"));
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
    fn pairing_custody_preparation_binds_the_original_typed_secret() {
        let mut record = record_tests::initial_record();
        let secret = SecretRecord::pairing(
            record.pairing.identity.reference().clone(),
            record.intent_id,
            Secret32::new([0x22; 32]).unwrap(),
            Secret32::new([0x33; 32]).unwrap(),
        )
        .unwrap();
        record.pairing = Pin::from_intent(&RecordIntent::from_record(&secret)).unwrap();
        let mut storage = Memory::with(&record);
        let prepared = prepare_pairing_custody(
            &mut storage,
            record::token(&record).unwrap(),
            &record,
            &secret,
            TIME + 1,
        )
        .unwrap();
        assert_eq!(prepared.record().progress, Progress::PairingPrepared);
        assert!(prepared.record().flight.is_none());
        let bytes = record::encode(prepared.record()).unwrap();
        assert!(!bytes
            .as_bytes()
            .windows(32)
            .any(|window| window == [0x22; 32]));
        assert!(!bytes
            .as_bytes()
            .windows(32)
            .any(|window| window == [0x33; 32]));
        for preimage in ["22".repeat(32), "33".repeat(32)] {
            assert!(!bytes
                .as_bytes()
                .windows(preimage.len())
                .any(|window| window == preimage.as_bytes()));
        }

        let wrong = SecretRecord::pairing(
            prepared.record().pairing.identity.reference().clone(),
            prepared.record().intent_id,
            Secret32::new([0x22; 32]).unwrap(),
            Secret32::new([0x34; 32]).unwrap(),
        )
        .unwrap();
        let mut storage = Memory::with(&record);
        let original = storage.0.borrow().committed.clone();
        assert_eq!(
            prepare_pairing_custody(
                &mut storage,
                record::token(&record).unwrap(),
                &record,
                &wrong,
                TIME + 2,
            )
            .err(),
            Some(Error::Conflict)
        );
        assert_eq!(storage.0.borrow().committed, original);
        assert!(storage.0.borrow().candidate.is_none());
        assert_eq!(
            prepare_pairing_custody(
                &mut storage,
                record::token(&record).unwrap(),
                &record,
                &secret,
                TIME - 1,
            )
            .err(),
            Some(Error::ClockRegressed)
        );
    }

    #[test]
    fn namespace_custody_preparation_retains_the_flight_and_pin() {
        let mut record = record_tests::namespace_flow()[3].clone();
        let identity = record.namespace.as_ref().unwrap().pin.identity.clone();
        let secret = SecretRecord::namespace(
            identity.reference().clone(),
            identity.namespace_binding().unwrap().clone(),
            Secret32::new([0x77; 32]).unwrap(),
        )
        .unwrap();
        record.namespace.as_mut().unwrap().pin =
            Pin::from_intent(&RecordIntent::from_record(&secret)).unwrap();
        let original_pin = record.namespace.clone().unwrap();
        let original_flight = record.flight.clone().unwrap();
        let mut storage = Memory::with(&record);
        let prepared = prepare_namespace_custody(
            &mut storage,
            record::token(&record).unwrap(),
            &record,
            &secret,
            TIME + 6_000,
        )
        .unwrap();
        assert_eq!(prepared.record().progress, Progress::NamespacePrepared);
        assert!(prepared.record().namespace == Some(original_pin));
        assert!(prepared.record().flight == Some(original_flight));
        assert!(prepared.record().flight.as_ref().unwrap().dispatches > 0);

        let wrong = SecretRecord::namespace(
            identity.reference().clone(),
            identity.namespace_binding().unwrap().clone(),
            Secret32::new([0x78; 32]).unwrap(),
        )
        .unwrap();
        let mut storage = Memory::with(&record);
        let original = storage.0.borrow().committed.clone();
        assert_eq!(
            prepare_namespace_custody(
                &mut storage,
                record::token(&record).unwrap(),
                &record,
                &wrong,
                TIME + 6_000,
            )
            .err(),
            Some(Error::Conflict)
        );
        assert_eq!(storage.0.borrow().committed, original);
        assert!(storage.0.borrow().candidate.is_none());
    }

    fn custody_steps() -> [(Record, Record); 2] {
        let mut pairing = initial_record();
        pairing.revision = 1;
        pairing.progress = Progress::PairingPrepared;
        let mut verified = pairing.clone();
        verified.revision = 2;
        verified.progress = Progress::PairingCustodyVerified;
        let namespace = record_tests::namespace_flow();
        [
            (pairing, verified),
            (namespace[4].clone(), namespace[5].clone()),
        ]
    }

    #[test]
    fn custody_completion_requires_durable_current_state_before_the_effect() {
        for (current, next) in custody_steps() {
            let token = record::token(&current).unwrap();
            let mut stale = Memory::with(&next);
            assert_eq!(
                complete_custody(&mut stale, token, &current, &next, || {
                    panic!("stale attempt reached custody")
                })
                .err(),
                Some(Error::StaleSnapshot)
            );
            let mut unsynced = Memory::with(&current);
            unsynced.0.borrow_mut().sync_error = Some(Error::StorageUnavailable);
            assert_eq!(
                complete_custody(&mut unsynced, token, &current, &next, || {
                    panic!("undurable attempt reached custody")
                })
                .err(),
                Some(Error::StorageUnavailable)
            );
            let mut exhausted = current.clone();
            exhausted.revision = MAX_REVISION;
            let mut impossible = next.clone();
            impossible.revision = MAX_REVISION + 1;
            let mut storage = Memory::with(&exhausted);
            assert_eq!(
                complete_custody(
                    &mut storage,
                    record::token(&exhausted).unwrap(),
                    &exhausted,
                    &impossible,
                    || panic!("exhausted attempt reached custody"),
                )
                .err(),
                Some(Error::Limit)
            );
        }
    }

    #[test]
    fn custody_failure_retains_progress_and_success_publishes_after_durability() {
        for (current, next) in custody_steps() {
            let mut storage = Memory::with(&current);
            let original = storage.0.borrow().committed.clone();
            let token = record::token(&current).unwrap();
            assert_eq!(
                complete_custody(&mut storage, token, &current, &next, || Err(Error::Custody))
                    .err(),
                Some(Error::Custody)
            );
            assert_eq!(storage.0.borrow().committed, original);
            assert!(storage.0.borrow().candidate.is_none());
            let observed = storage.clone();
            let completed = complete_custody(&mut storage, token, &current, &next, || {
                let disk = observed.0.borrow();
                assert!(disk.file_synced && disk.directory_synced);
                assert_eq!(disk.committed, original);
                Ok(())
            })
            .unwrap();
            assert!(completed.record() == &next);
            assert!(completed.record().flight.is_none());
        }
    }

    #[test]
    fn custody_completion_detects_a_post_effect_race_and_allows_explicit_reconciliation() {
        for (current, next) in custody_steps() {
            let mut storage = Memory::with(&current);
            let raced_storage = storage.clone();
            let mut raced = current.clone();
            raced.revision += 1;
            record::successor(&current, &raced).unwrap();
            let raced_bytes = record::encode(&raced).unwrap().as_bytes().to_vec();
            assert_eq!(
                complete_custody(
                    &mut storage,
                    record::token(&current).unwrap(),
                    &current,
                    &next,
                    || {
                        raced_storage.0.borrow_mut().committed = Some(raced_bytes.clone());
                        Ok(())
                    },
                )
                .err(),
                Some(Error::StaleSnapshot)
            );
            assert_eq!(storage.0.borrow().committed, Some(raced_bytes));
            assert!(storage.0.borrow().candidate.is_none());
            let mut reconciled = next;
            reconciled.revision = raced.revision + 1;
            assert!(complete_custody(
                &mut storage,
                record::token(&raced).unwrap(),
                &raced,
                &reconciled,
                || Ok(()),
            )
            .is_ok());
        }
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

#[cfg(test)]
#[path = "reconstruction_tests.rs"]
mod reconstruction_tests;
