//! Fixed canonical local facts. No secret preimages, wire bodies, browser proof,
//! upload ledger sequence, mutable history or authority-bearing objects occur in
//! this schema. Even a coherent record can describe an unauthenticated history.

use super::{Error, Result, MAX_DISPATCHES, MAX_FLIGHTS, MAX_RECORD_BYTES, MAX_REVISION};
use crate::enrollment::contract::{
    self, AccountId, DeviceState, DomainError, Enrollment, Id, Operation, PairingState,
    PairingView, Reservation, MAX_TIME_MS, POLL_MS, TTL_MS,
};
use aicharts_custody::{
    references::RecordIntent, CredentialRef, NamespaceBinding, Purpose, RecordIdentity,
};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Commitment(Id);

impl Commitment {
    pub(super) fn new(bytes: Id) -> Result<Self> {
        nonzero(&bytes)
            .then_some(Self(bytes))
            .ok_or(Error::InvalidRecord)
    }

    pub(super) fn as_bytes(&self) -> &Id {
        &self.0
    }
}

/// This preserves the complete RecordIntent commitment without constructing a
/// new custody RecordIntent from decoded facts or requesting private records.
#[derive(Clone, PartialEq, Eq)]
pub(super) struct Pin {
    pub(super) identity: RecordIdentity,
    pub(super) commitment: Commitment,
}

impl Pin {
    pub(super) fn from_intent(intent: &RecordIntent) -> Result<Self> {
        Ok(Self {
            identity: intent.identity().clone(),
            commitment: Commitment::new(*intent.commitment())?,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Progress {
    PairingPlanned,
    PairingPrepared,
    PairingCustodyVerified,
    Initialized,
    Confirmed,
    Reserved,
    Enrolled,
    NamespacePlanned,
    NamespacePrepared,
    NamespaceCustodyVerified,
}

impl Progress {
    fn name(self) -> &'static str {
        match self {
            Self::PairingPlanned => "pairing-planned",
            Self::PairingPrepared => "pairing-prepared",
            Self::PairingCustodyVerified => "pairing-custody-verified",
            Self::Initialized => "initialized",
            Self::Confirmed => "confirmed",
            Self::Reserved => "reserved",
            Self::Enrolled => "enrolled",
            Self::NamespacePlanned => "namespace-planned",
            Self::NamespacePrepared => "namespace-prepared",
            Self::NamespaceCustodyVerified => "namespace-custody-verified",
        }
    }

    fn parse(value: &Value) -> Option<Self> {
        Some(match value.as_str()? {
            "pairing-planned" => Self::PairingPlanned,
            "pairing-prepared" => Self::PairingPrepared,
            "pairing-custody-verified" => Self::PairingCustodyVerified,
            "initialized" => Self::Initialized,
            "confirmed" => Self::Confirmed,
            "reserved" => Self::Reserved,
            "enrolled" => Self::Enrolled,
            "namespace-planned" => Self::NamespacePlanned,
            "namespace-prepared" => Self::NamespacePrepared,
            "namespace-custody-verified" => Self::NamespaceCustodyVerified,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum AccountChoice {
    Unchosen,
    Chosen {
        account_id: AccountId,
        chosen_at_ms: u64,
    },
    Confirmed {
        account_id: AccountId,
        chosen_at_ms: u64,
        confirmed_at_ms: u64,
    },
}

impl AccountChoice {
    fn account(self) -> Option<AccountId> {
        match self {
            Self::Unchosen => None,
            Self::Chosen { account_id, .. } | Self::Confirmed { account_id, .. } => {
                Some(account_id)
            }
        }
    }
    fn chosen_at(self) -> Option<u64> {
        match self {
            Self::Unchosen => None,
            Self::Chosen { chosen_at_ms, .. } | Self::Confirmed { chosen_at_ms, .. } => {
                Some(chosen_at_ms)
            }
        }
    }
    fn confirmed(self) -> Option<AccountId> {
        match self {
            Self::Confirmed { account_id, .. } => Some(account_id),
            _ => None,
        }
    }
}

#[derive(PartialEq, Eq)]
pub(super) struct PairingObservation {
    pub(super) observed_at_ms: u64,
    pub(super) view: PairingView,
}

#[derive(Clone, PartialEq, Eq)]
pub(super) struct NamespacePin {
    pub(super) pin: Pin,
    pub(super) accepted_at_ms: u64,
}

/// A frozen request/context digest is retained through every explicit retry.
/// The times are caller observations, not a monotonic clock implementation.
#[derive(Clone, PartialEq, Eq)]
pub(super) struct Flight {
    pub(super) operation: Operation,
    pub(super) ordinal: u16,
    pub(super) prepared_revision: u64,
    pub(super) prepared_at_ms: u64,
    pub(super) last_attempt_at_ms: Option<u64>,
    pub(super) dispatches: u8,
    pub(super) request_sha: Commitment,
    pub(super) context_sha: Commitment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LastFailure {
    Domain {
        operation: Operation,
        error: DomainError,
    },
    Transport,
    ClockRegressed,
    Storage,
    Custody,
    OutcomeUnknown,
}

#[derive(PartialEq, Eq)]
pub(super) struct Record {
    pub(super) revision: u64,
    pub(super) installation_id: Id,
    pub(super) intent_id: Id,
    pub(super) pairing: Pin,
    pub(super) namespace_item_id: Id,
    pub(super) poll_commitment: Commitment,
    pub(super) upload_commitment: Commitment,
    pub(super) progress: Progress,
    pub(super) initialized_expires_at_ms: Option<u64>,
    pub(super) last_pairing: Option<PairingObservation>,
    pub(super) account_choice: AccountChoice,
    pub(super) reservation: Option<Reservation>,
    pub(super) enrollment: Option<Enrollment>,
    pub(super) namespace: Option<NamespacePin>,
    pub(super) flight: Option<Flight>,
    pub(super) flights_started: u16,
    pub(super) last_failure: Option<LastFailure>,
    pub(super) clock_floor_ms: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Token {
    revision: u64,
    digest: Id,
}

impl Token {
    pub(super) fn revision(self) -> u64 {
        self.revision
    }
    pub(super) fn digest(&self) -> &Id {
        &self.digest
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(super) struct CanonicalBytes(Vec<u8>);
impl CanonicalBytes {
    pub(super) fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

fn nonzero(bytes: &[u8]) -> bool {
    bytes.iter().any(|byte| *byte != 0)
}
fn observed(time: u64, floor: u64) -> bool {
    time <= floor && floor <= MAX_TIME_MS
}

pub(super) fn validate(value: &Record) -> Result<()> {
    if value.revision > MAX_REVISION || value.flights_started > MAX_FLIGHTS {
        return Err(Error::Limit);
    }
    let pairing_ref = value.pairing.identity.reference();
    if !nonzero(&value.installation_id)
        || !nonzero(&value.intent_id)
        || !nonzero(&value.namespace_item_id)
        || pairing_ref.installation_id() != &value.installation_id
        || pairing_ref.purpose() != Purpose::Pairing
        || value.pairing.identity.intent_id() != Some(&value.intent_id)
        || pairing_ref.item_id() == &value.namespace_item_id
        || value.poll_commitment == value.upload_commitment
        || value.clock_floor_ms > MAX_TIME_MS
        || u64::from(value.flights_started) > value.revision
        || u64::from(value.progress as u8) > value.revision
    {
        return Err(Error::InvalidRecord);
    }
    let initialized = value.progress >= Progress::Initialized;
    let confirmed = value.progress >= Progress::Confirmed;
    if value.initialized_expires_at_ms.is_some() != initialized
        || value.reservation.is_some() != (value.progress >= Progress::Reserved)
        || value.enrollment.is_some() != (value.progress >= Progress::Enrolled)
        || value.namespace.is_some() != (value.progress >= Progress::NamespacePlanned)
        || value.account_choice.confirmed().is_some() != confirmed
        || (!initialized
            && (value.last_pairing.is_some() || value.account_choice != AccountChoice::Unchosen))
        || (value.progress < Progress::PairingCustodyVerified
            && (value.flights_started != 0 || value.flight.is_some()))
        || (initialized && value.flights_started == 0)
        || (value.progress == Progress::NamespaceCustodyVerified && value.flight.is_some())
        || (matches!(
            value.progress,
            Progress::NamespacePlanned | Progress::NamespacePrepared
        ) && value
            .flight
            .as_ref()
            .is_none_or(|flight| flight.operation != Operation::Namespace))
    {
        return Err(Error::InvalidRecord);
    }
    if let Some(expires) = value.initialized_expires_at_ms {
        let created = expires.checked_sub(TTL_MS).ok_or(Error::InvalidRecord)?;
        if expires > MAX_TIME_MS || !observed(created, value.clock_floor_ms) {
            return Err(Error::InvalidRecord);
        }
        if let Some(choice) = value.account_choice.account() {
            let chosen = value
                .account_choice
                .chosen_at()
                .ok_or(Error::InvalidRecord)?;
            if !nonzero(&choice) || chosen < created || !observed(chosen, value.clock_floor_ms) {
                return Err(Error::InvalidRecord);
            }
        }
        if let AccountChoice::Confirmed {
            chosen_at_ms,
            confirmed_at_ms,
            ..
        } = value.account_choice
        {
            if confirmed_at_ms < chosen_at_ms
                || confirmed_at_ms >= expires
                || !observed(confirmed_at_ms, value.clock_floor_ms)
                || value
                    .last_pairing
                    .as_ref()
                    .is_none_or(|last| last.observed_at_ms < confirmed_at_ms)
            {
                return Err(Error::InvalidRecord);
            }
        }
        if let Some(last) = &value.last_pairing {
            let approved = matches!(
                last.view.state,
                PairingState::BrowserApproved | PairingState::TerminalConfirmed
            );
            if last.view.expires_at_ms != expires
                || last.view.poll_after_ms > POLL_MS
                || last.observed_at_ms < created
                || !observed(last.observed_at_ms, value.clock_floor_ms)
                || approved != last.view.approved_account_id.is_some()
                || last.view.approved_account_id.is_some_and(|id| {
                    !nonzero(&id)
                        || value
                            .account_choice
                            .account()
                            .is_some_and(|choice| choice != id)
                })
            {
                return Err(Error::InvalidRecord);
            }
        }
        if let Some(reservation) = &value.reservation {
            if reservation.intent_id != value.intent_id
                || Some(reservation.account_id) != value.account_choice.confirmed()
                || !nonzero(&reservation.reservation_id)
                || !nonzero(&reservation.recovery_generation)
                || reservation.poll_commitment != *value.poll_commitment.as_bytes()
                || reservation.upload_commitment != *value.upload_commitment.as_bytes()
                || reservation.reserved_at_ms < created
                || !observed(reservation.reserved_at_ms, value.clock_floor_ms)
                || reservation.reserved_at_ms >= reservation.expires_at_ms
                || reservation.expires_at_ms > expires
                || reservation.expires_at_ms - reservation.reserved_at_ms > TTL_MS
            {
                return Err(Error::InvalidRecord);
            }
            if let Some(enrollment) = &value.enrollment {
                if !contract::valid_receipt(reservation, value.clock_floor_ms, &enrollment.receipt)
                {
                    return Err(Error::InvalidRecord);
                }
            }
            if let Some(namespace) = &value.namespace {
                let identity = &namespace.pin.identity;
                let reference = identity.reference();
                let binding = identity.namespace_binding().ok_or(Error::InvalidRecord)?;
                let enrollment = value.enrollment.as_ref().ok_or(Error::InvalidRecord)?;
                if reference.installation_id() != &value.installation_id
                    || reference.item_id() != &value.namespace_item_id
                    || reference.purpose() != Purpose::Namespace
                    || binding.account_id() != &reservation.account_id
                    || binding.recovery_generation() != &reservation.recovery_generation
                    || binding.namespace_version() != 1
                    || namespace.accepted_at_ms < enrollment.receipt.enrolled_at_ms
                    || namespace.accepted_at_ms >= reservation.expires_at_ms
                    || !observed(namespace.accepted_at_ms, value.clock_floor_ms)
                {
                    return Err(Error::InvalidRecord);
                }
            }
        }
    }
    if let Some(flight) = &value.flight {
        if flight.ordinal == 0
            || flight.ordinal != value.flights_started
            || flight.prepared_revision == 0
            || flight.prepared_revision > value.revision
            || u64::from(flight.ordinal) > flight.prepared_revision
            || !observed(flight.prepared_at_ms, value.clock_floor_ms)
            || flight.dispatches > MAX_DISPATCHES
            || value.revision - flight.prepared_revision < u64::from(flight.dispatches)
            || (flight.dispatches == 0) != flight.last_attempt_at_ms.is_none()
            || flight
                .last_attempt_at_ms
                .is_some_and(|at| at < flight.prepared_at_ms || !observed(at, value.clock_floor_ms))
            || value
                .initialized_expires_at_ms
                .is_some_and(|expires| flight.prepared_at_ms < expires - TTL_MS)
        {
            return Err(Error::InvalidRecord);
        }
        let eligible = match flight.operation {
            Operation::Initialize => value.progress >= Progress::PairingCustodyVerified,
            Operation::Poll => initialized,
            Operation::Confirm => initialized && value.account_choice.account().is_some(),
            Operation::Reserve => confirmed,
            Operation::Enroll => value.reservation.is_some(),
            Operation::Namespace => value
                .enrollment
                .as_ref()
                .is_some_and(|enrollment| enrollment.device_state == DeviceState::Active),
        };
        if !eligible {
            return Err(Error::InvalidRecord);
        }
        // Late inspection preserves an old flight, but cannot rewrite its
        // preparation/dispatch times into a fresh capability-bearing attempt.
        let live_until = match flight.operation {
            Operation::Confirm => value.initialized_expires_at_ms,
            Operation::Namespace => value
                .reservation
                .as_ref()
                .map(|reservation| reservation.expires_at_ms),
            _ => None,
        };
        if live_until.is_some_and(|expiry| {
            flight.prepared_at_ms >= expiry
                || flight.last_attempt_at_ms.is_some_and(|at| at >= expiry)
        }) {
            return Err(Error::InvalidRecord);
        }
        if value.namespace.as_ref().is_some_and(|namespace| {
            flight.dispatches == 0
                || flight
                    .last_attempt_at_ms
                    .is_none_or(|at| at > namespace.accepted_at_ms)
        }) {
            return Err(Error::InvalidRecord);
        }
    }
    if let Some(LastFailure::Domain { operation, error }) = value.last_failure {
        if !error.allowed(operation) {
            return Err(Error::InvalidRecord);
        }
    }
    Ok(())
}

/// Preserve prior facts and finite counters. This is not a transcript, a proof
/// that actions happened, or the operational sequencer that chooses new facts.
pub(super) fn successor(previous: &Record, next: &Record) -> Result<()> {
    validate(previous)?;
    validate(next)?;
    if next.clock_floor_ms < previous.clock_floor_ms {
        return Err(Error::ClockRegressed);
    }
    if previous.revision == MAX_REVISION {
        return Err(Error::Limit);
    }
    if next.revision != previous.revision + 1
        || next.installation_id != previous.installation_id
        || next.intent_id != previous.intent_id
        || next.pairing != previous.pairing
        || next.namespace_item_id != previous.namespace_item_id
        || next.poll_commitment != previous.poll_commitment
        || next.upload_commitment != previous.upload_commitment
        || next.progress < previous.progress
        || previous
            .initialized_expires_at_ms
            .is_some_and(|expiry| next.initialized_expires_at_ms != Some(expiry))
        || previous
            .reservation
            .as_ref()
            .is_some_and(|reservation| next.reservation.as_ref() != Some(reservation))
        || previous
            .namespace
            .as_ref()
            .is_some_and(|namespace| next.namespace.as_ref() != Some(namespace))
        || previous.enrollment.as_ref().is_some_and(|old| {
            next.enrollment.as_ref().is_none_or(|new| {
                old.receipt != new.receipt
                    || (old.device_state == DeviceState::Revoked
                        && new.device_state != DeviceState::Revoked)
            })
        })
        || (previous.namespace.is_none()
            && next.namespace.is_some()
            && (previous
                .enrollment
                .as_ref()
                .is_none_or(|old| old.device_state != DeviceState::Active)
                || next
                    .enrollment
                    .as_ref()
                    .is_none_or(|new| new.device_state != DeviceState::Active)))
        || previous
            .account_choice
            .account()
            .is_some_and(|account| next.account_choice.account() != Some(account))
        || previous
            .account_choice
            .chosen_at()
            .is_some_and(|at| next.account_choice.chosen_at() != Some(at))
        || matches!(previous.account_choice, AccountChoice::Confirmed { .. })
            && next.account_choice != previous.account_choice
        || matches!(previous.account_choice, AccountChoice::Unchosen)
            && matches!(next.account_choice, AccountChoice::Confirmed { .. })
        || previous.last_pairing.as_ref().is_some_and(|old| {
            next.last_pairing.as_ref().is_none_or(|new| {
                new.observed_at_ms < old.observed_at_ms
                    || (new.observed_at_ms == old.observed_at_ms && new != old)
            })
        })
    {
        return Err(Error::InvalidSuccessor);
    }
    match (&previous.flight, &next.flight) {
        (None, Some(new)) => {
            if next.flights_started != previous.flights_started + 1
                || new.prepared_revision != next.revision
                || new.prepared_at_ms != next.clock_floor_ms
                || new.dispatches != 0
                || !same_facts(previous, next)
            {
                return Err(Error::InvalidSuccessor);
            }
        }
        (Some(old), Some(new)) => {
            if next.flights_started != previous.flights_started
                || old.operation != new.operation
                || old.ordinal != new.ordinal
                || old.prepared_revision != new.prepared_revision
                || old.prepared_at_ms != new.prepared_at_ms
                || old.request_sha != new.request_sha
                || old.context_sha != new.context_sha
                || new.dispatches < old.dispatches
                || new.dispatches > old.dispatches + 1
                || !(same_facts(previous, next) || namespace_custody_step(previous, next))
                || (new.dispatches == old.dispatches
                    && new.last_attempt_at_ms != old.last_attempt_at_ms)
                || (new.dispatches > old.dispatches
                    && (new.last_attempt_at_ms != Some(next.clock_floor_ms)
                        || new.last_attempt_at_ms < old.last_attempt_at_ms))
                || ((previous.namespace.is_some() || next.namespace.is_some())
                    && (new.dispatches != old.dispatches
                        || new.last_attempt_at_ms != old.last_attempt_at_ms))
            {
                return Err(Error::InvalidSuccessor);
            }
        }
        (Some(old), None) => {
            if old.dispatches == 0
                || next.flights_started != previous.flights_started
                || (old.operation == Operation::Namespace
                    && (previous.progress != Progress::NamespacePrepared
                        || next.progress != Progress::NamespaceCustodyVerified
                        || !same_enrollment_facts(previous, next)))
            {
                return Err(Error::InvalidSuccessor);
            }
        }
        (None, None) => {
            if next.flights_started != previous.flights_started {
                return Err(Error::InvalidSuccessor);
            }
        }
    }
    Ok(())
}

fn same_facts(a: &Record, b: &Record) -> bool {
    a.progress == b.progress && same_enrollment_facts(a, b) && a.namespace == b.namespace
}
fn same_enrollment_facts(a: &Record, b: &Record) -> bool {
    a.initialized_expires_at_ms == b.initialized_expires_at_ms
        && a.last_pairing == b.last_pairing
        && a.account_choice == b.account_choice
        && a.reservation == b.reservation
        && a.enrollment == b.enrollment
}
fn namespace_custody_step(a: &Record, b: &Record) -> bool {
    if a.flight
        .as_ref()
        .is_none_or(|flight| flight.operation != Operation::Namespace)
        || !same_enrollment_facts(a, b)
    {
        return false;
    }
    // One accepted namespace observation is pinned durably before any future
    // reference/vault effect. These facts do not perform or prove those effects.
    match (a.progress, b.progress) {
        (Progress::Enrolled, Progress::NamespacePlanned) => {
            a.namespace.is_none() && b.namespace.is_some()
        }
        (Progress::NamespacePlanned, Progress::NamespacePrepared) => a.namespace == b.namespace,
        _ => false,
    }
}

pub(super) fn initial(value: &Record) -> Result<()> {
    validate(value)?;
    if value.revision != 0
        || value.progress != Progress::PairingPlanned
        || value.flights_started != 0
        || value.flight.is_some()
        || value.last_failure.is_some()
    {
        return Err(Error::InvalidRecord);
    }
    Ok(())
}

fn object<'a>(value: &'a Value, fields: &[&str]) -> Option<&'a Map<String, Value>> {
    let object = value.as_object()?;
    (object.len() == fields.len() && fields.iter().all(|field| object.contains_key(*field)))
        .then_some(object)
}
fn integer(value: &Value) -> Option<u64> {
    value.as_u64()
}
fn hex<const N: usize>(value: &str) -> Option<[u8; N]> {
    if value.len() != N * 2 {
        return None;
    }
    let mut bytes = [0; N];
    for (out, pair) in bytes.iter_mut().zip(value.as_bytes().chunks_exact(2)) {
        let nibble = |byte: u8| match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            _ => None,
        };
        *out = nibble(pair[0])? * 16 + nibble(pair[1])?;
    }
    nonzero(&bytes).then_some(bytes)
}
fn id(value: &Value) -> Option<Id> {
    hex(value.as_str()?)
}
fn account(value: &Value) -> Option<AccountId> {
    hex(value.as_str()?.strip_prefix("acct_")?)
}
fn commitment(value: &Value) -> Option<Commitment> {
    Some(Commitment(id(value)?))
}
fn optional<T>(value: &Value, parse: impl FnOnce(&Value) -> Option<T>) -> Option<Option<T>> {
    if value.is_null() {
        Some(None)
    } else {
        Some(Some(parse(value)?))
    }
}
fn parse_pin(value: &Value, purpose: Purpose) -> Option<Pin> {
    let pin = object(value, &["identity", "commitment"])?;
    Some(Pin {
        identity: parse_identity(&pin["identity"], purpose)?,
        commitment: commitment(&pin["commitment"])?,
    })
}
fn parse_identity(value: &Value, purpose: Purpose) -> Option<RecordIdentity> {
    let fields: &[&str] = match purpose {
        Purpose::Pairing => &["installationId", "itemId", "purpose", "intentId"],
        Purpose::Namespace => &[
            "installationId",
            "itemId",
            "purpose",
            "accountId",
            "recoveryGeneration",
            "namespaceVersion",
        ],
        _ => return None,
    };
    let value = object(value, fields)?;
    let reference = CredentialRef::new(
        id(&value["installationId"])?,
        id(&value["itemId"])?,
        purpose,
    )
    .ok()?;
    match purpose {
        Purpose::Pairing if value["purpose"].as_str()? == "pairing" => {
            RecordIdentity::pairing(reference, id(&value["intentId"])?).ok()
        }
        Purpose::Namespace
            if value["purpose"].as_str()? == "namespace"
                && integer(&value["namespaceVersion"])? == 1 =>
        {
            RecordIdentity::namespace(
                reference,
                NamespaceBinding::new(
                    account(&value["accountId"])?,
                    id(&value["recoveryGeneration"])?,
                    1,
                )
                .ok()?,
            )
            .ok()
        }
        _ => None,
    }
}
fn pairing_state(value: &Value) -> Option<PairingState> {
    Some(match value.as_str()? {
        "pending" => PairingState::Pending,
        "browser-approved" => PairingState::BrowserApproved,
        "terminal-confirmed" => PairingState::TerminalConfirmed,
        "denied" => PairingState::Denied,
        "expired" => PairingState::Expired,
        _ => return None,
    })
}
fn parse_pairing(value: &Value) -> Option<PairingObservation> {
    let value = object(value, &["observedAtMs", "view"])?;
    let view = object(
        &value["view"],
        &["state", "expiresAtMs", "pollAfterMs", "approvedAccountId"],
    )?;
    Some(PairingObservation {
        observed_at_ms: integer(&value["observedAtMs"])?,
        view: PairingView {
            state: pairing_state(&view["state"])?,
            expires_at_ms: integer(&view["expiresAtMs"])?,
            poll_after_ms: integer(&view["pollAfterMs"])?,
            approved_account_id: optional(&view["approvedAccountId"], account)?,
        },
    })
}
fn parse_choice(value: &Value) -> Option<AccountChoice> {
    match value.get("state")?.as_str()? {
        "unchosen" => {
            object(value, &["state"])?;
            Some(AccountChoice::Unchosen)
        }
        "chosen" => {
            let value = object(value, &["state", "accountId", "chosenAtMs"])?;
            Some(AccountChoice::Chosen {
                account_id: account(&value["accountId"])?,
                chosen_at_ms: integer(&value["chosenAtMs"])?,
            })
        }
        "confirmed" => {
            let value = object(
                value,
                &["state", "accountId", "chosenAtMs", "confirmedAtMs"],
            )?;
            Some(AccountChoice::Confirmed {
                account_id: account(&value["accountId"])?,
                chosen_at_ms: integer(&value["chosenAtMs"])?,
                confirmed_at_ms: integer(&value["confirmedAtMs"])?,
            })
        }
        _ => None,
    }
}
fn parse_namespace(value: &Value) -> Option<NamespacePin> {
    let value = object(value, &["pin", "acceptedAtMs"])?;
    Some(NamespacePin {
        pin: parse_pin(&value["pin"], Purpose::Namespace)?,
        accepted_at_ms: integer(&value["acceptedAtMs"])?,
    })
}
fn parse_flight(value: &Value) -> Option<Flight> {
    let value = object(
        value,
        &[
            "operation",
            "ordinal",
            "preparedRevision",
            "preparedAtMs",
            "lastAttemptAtMs",
            "dispatches",
            "requestSHA",
            "contextSHA",
        ],
    )?;
    Some(Flight {
        operation: Operation::parse(&value["operation"])?,
        ordinal: integer(&value["ordinal"])?.try_into().ok()?,
        prepared_revision: integer(&value["preparedRevision"])?,
        prepared_at_ms: integer(&value["preparedAtMs"])?,
        last_attempt_at_ms: optional(&value["lastAttemptAtMs"], integer)?,
        dispatches: integer(&value["dispatches"])?.try_into().ok()?,
        request_sha: commitment(&value["requestSHA"])?,
        context_sha: commitment(&value["contextSHA"])?,
    })
}
fn parse_failure(value: &Value) -> Option<LastFailure> {
    let kind = value.get("kind")?.as_str()?;
    if kind == "domain" {
        let value = object(value, &["kind", "operation", "error"])?;
        return Some(LastFailure::Domain {
            operation: Operation::parse(&value["operation"])?,
            error: DomainError::parse(&value["error"])?,
        });
    }
    object(value, &["kind"])?;
    Some(match kind {
        "transport" => LastFailure::Transport,
        "clock-regressed" => LastFailure::ClockRegressed,
        "storage" => LastFailure::Storage,
        "custody" => LastFailure::Custody,
        "outcome-unknown" => LastFailure::OutcomeUnknown,
        _ => return None,
    })
}
fn parse(value: &Value) -> Option<Record> {
    let value = object(
        value,
        &[
            "schemaVersion",
            "revision",
            "installationId",
            "intentId",
            "pairing",
            "namespaceItemId",
            "pollCommitment",
            "uploadCommitment",
            "progress",
            "initializedExpiresAtMs",
            "lastPairing",
            "accountChoice",
            "reservation",
            "enrollment",
            "namespace",
            "flight",
            "flightsStarted",
            "lastFailure",
            "clockFloorMs",
        ],
    )?;
    if integer(&value["schemaVersion"])? != 1 {
        return None;
    }
    Some(Record {
        revision: integer(&value["revision"])?,
        installation_id: id(&value["installationId"])?,
        intent_id: id(&value["intentId"])?,
        pairing: parse_pin(&value["pairing"], Purpose::Pairing)?,
        namespace_item_id: id(&value["namespaceItemId"])?,
        poll_commitment: commitment(&value["pollCommitment"])?,
        upload_commitment: commitment(&value["uploadCommitment"])?,
        progress: Progress::parse(&value["progress"])?,
        initialized_expires_at_ms: optional(&value["initializedExpiresAtMs"], integer)?,
        last_pairing: optional(&value["lastPairing"], parse_pairing)?,
        account_choice: parse_choice(&value["accountChoice"])?,
        reservation: optional(&value["reservation"], contract::parse_reservation)?,
        enrollment: optional(&value["enrollment"], contract::parse_enrollment)?,
        namespace: optional(&value["namespace"], parse_namespace)?,
        flight: optional(&value["flight"], parse_flight)?,
        flights_started: integer(&value["flightsStarted"])?.try_into().ok()?,
        last_failure: optional(&value["lastFailure"], parse_failure)?,
        clock_floor_ms: integer(&value["clockFloorMs"])?,
    })
}

struct Writer(Vec<u8>);
impl Writer {
    fn raw(&mut self, bytes: &[u8]) {
        self.0.extend_from_slice(bytes);
    }
    fn word(&mut self, word: &'static str) {
        self.raw(b"\"");
        self.raw(word.as_bytes());
        self.raw(b"\"");
    }
    fn number(&mut self, number: u64) {
        self.raw(number.to_string().as_bytes());
    }
    fn hex(&mut self, bytes: &[u8]) {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        for byte in bytes {
            self.0.push(HEX[usize::from(byte >> 4)]);
            self.0.push(HEX[usize::from(byte & 15)]);
        }
    }
    fn id(&mut self, bytes: &[u8]) {
        self.raw(b"\"");
        self.hex(bytes);
        self.raw(b"\"");
    }
    fn account(&mut self, account: &AccountId) {
        self.raw(b"\"acct_");
        self.hex(account);
        self.raw(b"\"");
    }
    fn optional<T>(&mut self, value: Option<&T>, write: impl FnOnce(&mut Self, &T)) {
        match value {
            Some(value) => write(self, value),
            None => self.raw(b"null"),
        }
    }
    fn identity(&mut self, identity: &RecordIdentity) {
        let reference = identity.reference();
        self.raw(b"{\"installationId\":");
        self.id(reference.installation_id());
        self.raw(b",\"itemId\":");
        self.id(reference.item_id());
        self.raw(b",\"purpose\":");
        if let Some(intent) = identity.intent_id() {
            self.word("pairing");
            self.raw(b",\"intentId\":");
            self.id(intent);
        } else if let Some(binding) = identity.namespace_binding() {
            self.word("namespace");
            self.raw(b",\"accountId\":");
            self.account(binding.account_id());
            self.raw(b",\"recoveryGeneration\":");
            self.id(binding.recovery_generation());
            self.raw(b",\"namespaceVersion\":1");
        }
        self.raw(b"}");
    }
    fn pin(&mut self, pin: &Pin) {
        self.raw(b"{\"identity\":");
        self.identity(&pin.identity);
        self.raw(b",\"commitment\":");
        self.id(pin.commitment.as_bytes());
        self.raw(b"}");
    }
    fn pairing(&mut self, pairing: &PairingObservation) {
        self.raw(b"{\"observedAtMs\":");
        self.number(pairing.observed_at_ms);
        self.raw(b",\"view\":{\"state\":");
        self.word(match pairing.view.state {
            PairingState::Pending => "pending",
            PairingState::BrowserApproved => "browser-approved",
            PairingState::TerminalConfirmed => "terminal-confirmed",
            PairingState::Denied => "denied",
            PairingState::Expired => "expired",
        });
        self.raw(b",\"expiresAtMs\":");
        self.number(pairing.view.expires_at_ms);
        self.raw(b",\"pollAfterMs\":");
        self.number(pairing.view.poll_after_ms);
        self.raw(b",\"approvedAccountId\":");
        self.optional(pairing.view.approved_account_id.as_ref(), Self::account);
        self.raw(b"}}");
    }
    fn choice(&mut self, choice: AccountChoice) {
        self.raw(b"{\"state\":");
        match choice {
            AccountChoice::Unchosen => self.word("unchosen"),
            AccountChoice::Chosen {
                account_id,
                chosen_at_ms,
            }
            | AccountChoice::Confirmed {
                account_id,
                chosen_at_ms,
                ..
            } => {
                self.word(if choice.confirmed().is_some() {
                    "confirmed"
                } else {
                    "chosen"
                });
                self.raw(b",\"accountId\":");
                self.account(&account_id);
                self.raw(b",\"chosenAtMs\":");
                self.number(chosen_at_ms);
                if let AccountChoice::Confirmed {
                    confirmed_at_ms, ..
                } = choice
                {
                    self.raw(b",\"confirmedAtMs\":");
                    self.number(confirmed_at_ms);
                }
            }
        }
        self.raw(b"}");
    }
    fn reservation(&mut self, reservation: &Reservation) {
        self.raw(b"{\"schemaVersion\":1,\"intentId\":");
        self.id(&reservation.intent_id);
        self.raw(b",\"accountId\":");
        self.account(&reservation.account_id);
        self.raw(b",\"reservationId\":");
        self.id(&reservation.reservation_id);
        self.raw(b",\"pollCommitment\":");
        self.id(&reservation.poll_commitment);
        self.raw(b",\"uploadCommitment\":");
        self.id(&reservation.upload_commitment);
        self.raw(b",\"recoveryGeneration\":");
        self.id(&reservation.recovery_generation);
        self.raw(b",\"reservedAtMs\":");
        self.number(reservation.reserved_at_ms);
        self.raw(b",\"expiresAtMs\":");
        self.number(reservation.expires_at_ms);
        self.raw(b"}");
    }
    fn enrollment(&mut self, enrollment: &Enrollment) {
        let receipt = &enrollment.receipt;
        self.raw(b"{\"receipt\":{\"schemaVersion\":1,\"accountId\":");
        self.account(&receipt.account_id);
        self.raw(b",\"intentId\":");
        self.id(&receipt.intent_id);
        self.raw(b",\"reservationId\":");
        self.id(&receipt.reservation_id);
        self.raw(b",\"deviceId\":");
        self.id(&receipt.device_id);
        self.raw(b",\"enrolledAtMs\":");
        self.number(receipt.enrolled_at_ms);
        self.raw(b",\"namespaceVersion\":1},\"deviceState\":");
        self.word(match enrollment.device_state {
            DeviceState::Active => "active",
            DeviceState::Revoked => "revoked",
        });
        self.raw(b"}");
    }
    fn namespace(&mut self, namespace: &NamespacePin) {
        self.raw(b"{\"pin\":");
        self.pin(&namespace.pin);
        self.raw(b",\"acceptedAtMs\":");
        self.number(namespace.accepted_at_ms);
        self.raw(b"}");
    }
    fn flight(&mut self, flight: &Flight) {
        self.raw(b"{\"operation\":");
        self.word(flight.operation.name());
        self.raw(b",\"ordinal\":");
        self.number(u64::from(flight.ordinal));
        self.raw(b",\"preparedRevision\":");
        self.number(flight.prepared_revision);
        self.raw(b",\"preparedAtMs\":");
        self.number(flight.prepared_at_ms);
        self.raw(b",\"lastAttemptAtMs\":");
        self.optional(flight.last_attempt_at_ms.as_ref(), |out, time| {
            out.number(*time)
        });
        self.raw(b",\"dispatches\":");
        self.number(u64::from(flight.dispatches));
        self.raw(b",\"requestSHA\":");
        self.id(flight.request_sha.as_bytes());
        self.raw(b",\"contextSHA\":");
        self.id(flight.context_sha.as_bytes());
        self.raw(b"}");
    }
    fn failure(&mut self, failure: &LastFailure) {
        self.raw(b"{\"kind\":");
        match failure {
            LastFailure::Domain { operation, error } => {
                self.word("domain");
                self.raw(b",\"operation\":");
                self.word(operation.name());
                self.raw(b",\"error\":");
                self.word(error.name());
            }
            LastFailure::Transport => self.word("transport"),
            LastFailure::ClockRegressed => self.word("clock-regressed"),
            LastFailure::Storage => self.word("storage"),
            LastFailure::Custody => self.word("custody"),
            LastFailure::OutcomeUnknown => self.word("outcome-unknown"),
        }
        self.raw(b"}");
    }
}

pub(super) fn encode(value: &Record) -> Result<CanonicalBytes> {
    validate(value)?;
    let mut out = Writer(Vec::with_capacity(MAX_RECORD_BYTES));
    out.raw(b"{\"schemaVersion\":1,\"revision\":");
    out.number(value.revision);
    out.raw(b",\"installationId\":");
    out.id(&value.installation_id);
    out.raw(b",\"intentId\":");
    out.id(&value.intent_id);
    out.raw(b",\"pairing\":");
    out.pin(&value.pairing);
    out.raw(b",\"namespaceItemId\":");
    out.id(&value.namespace_item_id);
    out.raw(b",\"pollCommitment\":");
    out.id(value.poll_commitment.as_bytes());
    out.raw(b",\"uploadCommitment\":");
    out.id(value.upload_commitment.as_bytes());
    out.raw(b",\"progress\":");
    out.word(value.progress.name());
    out.raw(b",\"initializedExpiresAtMs\":");
    out.optional(value.initialized_expires_at_ms.as_ref(), |out, time| {
        out.number(*time)
    });
    out.raw(b",\"lastPairing\":");
    out.optional(value.last_pairing.as_ref(), Writer::pairing);
    out.raw(b",\"accountChoice\":");
    out.choice(value.account_choice);
    out.raw(b",\"reservation\":");
    out.optional(value.reservation.as_ref(), Writer::reservation);
    out.raw(b",\"enrollment\":");
    out.optional(value.enrollment.as_ref(), Writer::enrollment);
    out.raw(b",\"namespace\":");
    out.optional(value.namespace.as_ref(), Writer::namespace);
    out.raw(b",\"flight\":");
    out.optional(value.flight.as_ref(), Writer::flight);
    out.raw(b",\"flightsStarted\":");
    out.number(u64::from(value.flights_started));
    out.raw(b",\"lastFailure\":");
    out.optional(value.last_failure.as_ref(), Writer::failure);
    out.raw(b",\"clockFloorMs\":");
    out.number(value.clock_floor_ms);
    out.raw(b"}");
    if out.0.len() > MAX_RECORD_BYTES {
        return Err(Error::Limit);
    }
    Ok(CanonicalBytes(out.0))
}

pub(super) fn decode(bytes: &[u8]) -> Result<Record> {
    if bytes.len() > MAX_RECORD_BYTES {
        return Err(Error::Limit);
    }
    if bytes.is_empty() || !bytes.is_ascii() {
        return Err(Error::InvalidRecord);
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| Error::InvalidRecord)?;
    let record = parse(&value).ok_or(Error::InvalidRecord)?;
    if encode(&record)?.as_bytes() != bytes {
        return Err(Error::InvalidRecord);
    }
    Ok(record)
}

pub(super) fn token(value: &Record) -> Result<Token> {
    let bytes = encode(value)?;
    let mut digest = Sha256::new();
    digest.update(b"aicharts:enrollment-attempt-token:v1\0");
    digest.update(bytes.as_bytes());
    Ok(Token {
        revision: value.revision,
        digest: digest.finalize().into(),
    })
}
