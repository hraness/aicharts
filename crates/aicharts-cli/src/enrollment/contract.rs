//! Canonical terminal enrollment v1. Every entry point revalidates its inputs;
//! retained context is an observation supplied by the caller, never authority.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

pub(super) const URL: &str = "https://usage.aicharts.io/v1/enrollment";
pub(super) const MEDIA: &str = "application/json; charset=utf-8";
pub(super) const MAX_REQUEST_BYTES: usize = 1_024;
pub(super) const MAX_RESPONSE_BYTES: usize = 2_048;
pub(super) const MAX_TIME_MS: u64 = 8_640_000_000_000_000;
pub(super) const TTL_MS: u64 = 600_000;
pub(super) const POLL_MS: u64 = 5_000;
pub(super) type Id = [u8; 32];
pub(super) type AccountId = [u8; 16];

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(super) enum CodecError {
    InvalidRequest,
    InvalidResponse,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(super) enum Operation {
    Initialize,
    Poll,
    Confirm,
    Reserve,
    Enroll,
    Namespace,
}

impl Operation {
    pub(super) fn name(self) -> &'static str {
        match self {
            Self::Initialize => "initialize",
            Self::Poll => "poll",
            Self::Confirm => "confirm",
            Self::Reserve => "reserveEnrollment",
            Self::Enroll => "enroll",
            Self::Namespace => "namespaceForEnrollment",
        }
    }
    pub(super) fn parse(value: &Value) -> Option<Self> {
        match value.as_str()? {
            "initialize" => Some(Self::Initialize),
            "poll" => Some(Self::Poll),
            "confirm" => Some(Self::Confirm),
            "reserveEnrollment" => Some(Self::Reserve),
            "enroll" => Some(Self::Enroll),
            "namespaceForEnrollment" => Some(Self::Namespace),
            _ => None,
        }
    }
}

/// Explicitly borrowed bytes are the only projection. No Debug, Clone, Copy,
/// Display or general serialization implementation is provided for secrets.
#[derive(PartialEq, Eq)]
pub(super) struct Secret32(Id);
impl Secret32 {
    pub(super) fn from_bytes(bytes: Id) -> Option<Self> {
        nonzero(&bytes).then_some(Self(bytes))
    }
    pub(super) fn as_bytes(&self) -> &Id {
        &self.0
    }
}

#[derive(PartialEq, Eq)]
pub(super) struct PollProof {
    pub(super) intent_id: Id,
    pub(super) poll_secret: Secret32,
}
#[derive(PartialEq, Eq)]
pub(super) struct EnrollmentProof {
    pub(super) pairing: PollProof,
    pub(super) upload_secret: Secret32,
}
#[derive(PartialEq, Eq)]
pub(super) enum Request {
    Initialize {
        proof: PollProof,
        upload_commitment: Id,
    },
    Poll(PollProof),
    Confirm {
        proof: PollProof,
        account_id: AccountId,
    },
    Reserve(EnrollmentProof),
    Enroll(EnrollmentProof),
    Namespace(EnrollmentProof),
}
impl Request {
    pub(super) fn operation(&self) -> Operation {
        match self {
            Self::Initialize { .. } => Operation::Initialize,
            Self::Poll(_) => Operation::Poll,
            Self::Confirm { .. } => Operation::Confirm,
            Self::Reserve(_) => Operation::Reserve,
            Self::Enroll(_) => Operation::Enroll,
            Self::Namespace(_) => Operation::Namespace,
        }
    }
    fn proof(&self) -> &PollProof {
        match self {
            Self::Initialize { proof, .. } | Self::Poll(proof) | Self::Confirm { proof, .. } => {
                proof
            }
            Self::Reserve(proof) | Self::Enroll(proof) | Self::Namespace(proof) => &proof.pairing,
        }
    }
    fn upload_commitment(&self) -> Option<Id> {
        match self {
            Self::Initialize {
                upload_commitment, ..
            } => Some(*upload_commitment),
            Self::Reserve(proof) | Self::Enroll(proof) | Self::Namespace(proof) => Some(
                commitment(b"upload", &proof.pairing.intent_id, &proof.upload_secret),
            ),
            _ => None,
        }
    }
    fn valid(&self) -> bool {
        let proof = self.proof();
        if !nonzero(&proof.intent_id) || !nonzero(proof.poll_secret.as_bytes()) {
            return false;
        }
        match self {
            Self::Initialize {
                upload_commitment, ..
            } => {
                nonzero(upload_commitment)
                    && *upload_commitment
                        != commitment(b"poll", &proof.intent_id, &proof.poll_secret)
                    && *upload_commitment
                        != commitment(b"upload", &proof.intent_id, &proof.poll_secret)
            }
            Self::Confirm { account_id, .. } => nonzero(account_id),
            Self::Reserve(enrollment) | Self::Enroll(enrollment) | Self::Namespace(enrollment) => {
                nonzero(enrollment.upload_secret.as_bytes())
                    && enrollment.upload_secret != proof.poll_secret
            }
            Self::Poll(_) => true,
        }
    }
}

/// Fixed projections used by the private attempt sequencer. These expose only
/// identifiers and commitments; the proof preimages remain borrow-only inside
/// the request codec.
pub(super) fn request_intent_id(request: &Request) -> Id {
    request.proof().intent_id
}
pub(super) fn request_poll_commitment(request: &Request) -> Id {
    commitment(
        b"poll",
        &request.proof().intent_id,
        &request.proof().poll_secret,
    )
}
pub(super) fn request_upload_commitment(request: &Request) -> Option<Id> {
    request.upload_commitment()
}

#[derive(PartialEq, Eq, Clone)]
pub(super) struct Reservation {
    pub(super) intent_id: Id,
    pub(super) account_id: AccountId,
    pub(super) reservation_id: Id,
    pub(super) poll_commitment: Id,
    pub(super) upload_commitment: Id,
    pub(super) recovery_generation: Id,
    pub(super) reserved_at_ms: u64,
    pub(super) expires_at_ms: u64,
}
#[derive(PartialEq, Eq, Clone)]
pub(super) struct Receipt {
    pub(super) account_id: AccountId,
    pub(super) intent_id: Id,
    pub(super) reservation_id: Id,
    pub(super) device_id: Id,
    pub(super) enrolled_at_ms: u64,
}
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(super) enum DeviceState {
    Active,
    Revoked,
}
#[derive(PartialEq, Eq, Clone)]
pub(super) struct Enrollment {
    pub(super) receipt: Receipt,
    pub(super) device_state: DeviceState,
}
#[derive(PartialEq, Eq)]
pub(super) struct Namespace {
    pub(super) namespace_key: Secret32,
    pub(super) receipt: Receipt,
}
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(super) enum PairingState {
    Pending,
    BrowserApproved,
    TerminalConfirmed,
    Denied,
    Expired,
}
impl PairingState {
    fn name(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::BrowserApproved => "browser-approved",
            Self::TerminalConfirmed => "terminal-confirmed",
            Self::Denied => "denied",
            Self::Expired => "expired",
        }
    }
}
#[derive(Clone, PartialEq, Eq)]
pub(super) struct PairingView {
    pub(super) state: PairingState,
    pub(super) expires_at_ms: u64,
    pub(super) poll_after_ms: u64,
    pub(super) approved_account_id: Option<AccountId>,
}
#[derive(Clone)]
pub(super) struct Context {
    pub(super) now_ms: u64,
    pub(super) initialized_expires_at_ms: Option<u64>,
    pub(super) confirmed_account_id: Option<AccountId>,
    pub(super) reservation: Option<Reservation>,
    pub(super) enrollment: Option<Enrollment>,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(super) enum DomainError {
    InvalidInput,
    StorageInvalid,
    ClockRegressed,
    Conflict,
    NotInitialized,
    Unauthorized,
    Expired,
    Throttled,
    InvalidTransition,
    AuthenticationNotFresh,
    RecoveryRequired,
    Unavailable,
    NotReserved,
    NotEnrolled,
    Revoked,
    StorageUnavailable,
    Limit,
}
impl DomainError {
    pub(super) fn name(self) -> &'static str {
        match self {
            Self::InvalidInput => "invalid_input",
            Self::StorageInvalid => "storage_invalid",
            Self::ClockRegressed => "clock_regressed",
            Self::Conflict => "conflict",
            Self::NotInitialized => "not_initialized",
            Self::Unauthorized => "unauthorized",
            Self::Expired => "expired",
            Self::Throttled => "throttled",
            Self::InvalidTransition => "invalid_transition",
            Self::AuthenticationNotFresh => "authentication_not_fresh",
            Self::RecoveryRequired => "recovery_required",
            Self::Unavailable => "unavailable",
            Self::NotReserved => "not_reserved",
            Self::NotEnrolled => "not_enrolled",
            Self::Revoked => "revoked",
            Self::StorageUnavailable => "storage_unavailable",
            Self::Limit => "limit",
        }
    }
    pub(super) fn parse(value: &Value) -> Option<Self> {
        Some(match value.as_str()? {
            "invalid_input" => Self::InvalidInput,
            "storage_invalid" => Self::StorageInvalid,
            "clock_regressed" => Self::ClockRegressed,
            "conflict" => Self::Conflict,
            "not_initialized" => Self::NotInitialized,
            "unauthorized" => Self::Unauthorized,
            "expired" => Self::Expired,
            "throttled" => Self::Throttled,
            "invalid_transition" => Self::InvalidTransition,
            "authentication_not_fresh" => Self::AuthenticationNotFresh,
            "recovery_required" => Self::RecoveryRequired,
            "unavailable" => Self::Unavailable,
            "not_reserved" => Self::NotReserved,
            "not_enrolled" => Self::NotEnrolled,
            "revoked" => Self::Revoked,
            "storage_unavailable" => Self::StorageUnavailable,
            "limit" => Self::Limit,
            _ => return None,
        })
    }
    pub(super) fn allowed(self, operation: Operation) -> bool {
        if matches!(
            self,
            Self::InvalidInput | Self::StorageInvalid | Self::ClockRegressed
        ) {
            return true;
        }
        match operation {
            Operation::Initialize => matches!(self, Self::Conflict),
            Operation::Poll => matches!(
                self,
                Self::NotInitialized | Self::Unauthorized | Self::Expired | Self::Throttled
            ),
            Operation::Confirm => matches!(
                self,
                Self::NotInitialized
                    | Self::Unauthorized
                    | Self::Expired
                    | Self::InvalidTransition
                    | Self::AuthenticationNotFresh
            ),
            Operation::Reserve => matches!(
                self,
                Self::NotInitialized
                    | Self::Unauthorized
                    | Self::Expired
                    | Self::InvalidTransition
                    | Self::RecoveryRequired
            ),
            Operation::Enroll | Operation::Namespace => matches!(
                self,
                Self::Unavailable
                    | Self::Unauthorized
                    | Self::NotReserved
                    | Self::NotEnrolled
                    | Self::Expired
                    | Self::Conflict
                    | Self::RecoveryRequired
                    | Self::Revoked
                    | Self::StorageUnavailable
                    | Self::Limit
            ),
        }
    }
}

#[derive(PartialEq, Eq)]
pub(super) enum Success {
    Initialized {
        expires_at_ms: u64,
    },
    Pairing(PairingView),
    Reserved(Reservation),
    Enrolled {
        reservation: Reservation,
        enrollment: Enrollment,
    },
    Namespace {
        reservation: Reservation,
        namespace: Namespace,
    },
}
pub(super) type DomainResult = Result<Success, DomainError>;

/// Both requests and responses can contain secrets; bytes require an explicit
/// borrow rather than Debug, Display, Clone or a general serializer.
pub(super) struct WireBytes(Vec<u8>);
impl WireBytes {
    pub(super) fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

fn nonzero(bytes: &[u8]) -> bool {
    bytes.iter().any(|byte| *byte != 0)
}
fn time(value: u64) -> bool {
    value <= MAX_TIME_MS
}
fn object<'a>(value: &'a Value, fields: &[&str]) -> Option<&'a Map<String, Value>> {
    let object = value.as_object()?;
    (object.len() == fields.len() && fields.iter().all(|field| object.contains_key(*field)))
        .then_some(object)
}
fn number(value: &Value) -> Option<u64> {
    value.as_u64().filter(|value| time(*value))
}
fn version(value: &Value) -> bool {
    value.as_u64() == Some(1)
}
fn hex<const N: usize>(value: &str) -> Option<[u8; N]> {
    if value.len() != N * 2 {
        return None;
    }
    let mut bytes = [0; N];
    for (output, input) in bytes.iter_mut().zip(value.as_bytes().chunks_exact(2)) {
        let nibble = |byte: u8| match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            _ => None,
        };
        *output = nibble(input[0])? * 16 + nibble(input[1])?;
    }
    nonzero(&bytes).then_some(bytes)
}
fn id(value: &Value) -> Option<Id> {
    hex(value.as_str()?)
}
fn account(value: &Value) -> Option<AccountId> {
    hex(value.as_str()?.strip_prefix("acct_")?)
}
fn ascii_hex(bytes: &[u8]) -> Vec<u8> {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = Vec::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize]);
        output.push(DIGITS[(byte & 15) as usize]);
    }
    output
}
fn commitment(role: &[u8], intent: &Id, secret: &Secret32) -> Id {
    let mut digest = Sha256::new();
    digest.update(b"aicharts:pairing:v1\0");
    digest.update(role);
    digest.update(b"\0");
    digest.update(ascii_hex(intent));
    digest.update(b"\0");
    digest.update(ascii_hex(secret.as_bytes()));
    digest.finalize().into()
}
fn device_id(reservation: &Reservation) -> Id {
    let mut digest = Sha256::new();
    digest.update(b"aicharts:enrollment:v1\0device\0acct_");
    digest.update(ascii_hex(&reservation.account_id));
    digest.update(b"\0");
    digest.update(ascii_hex(&reservation.intent_id));
    digest.update(b"\0");
    digest.update(ascii_hex(&reservation.reservation_id));
    digest.finalize().into()
}

fn parse_request(value: &Value) -> Option<Request> {
    let envelope = object(value, &["schemaVersion", "operation", "input"])?;
    if !version(&envelope["schemaVersion"]) {
        return None;
    }
    let operation = Operation::parse(&envelope["operation"])?;
    let extra = match operation {
        Operation::Initialize => Some("uploadCommitment"),
        Operation::Poll => None,
        Operation::Confirm => Some("accountId"),
        _ => Some("uploadSecret"),
    };
    let mut fields = vec!["intentId", "pollSecret"];
    if let Some(field) = extra {
        fields.push(field);
    }
    let input = object(&envelope["input"], &fields)?;
    let proof = PollProof {
        intent_id: id(&input["intentId"])?,
        poll_secret: Secret32(id(&input["pollSecret"])?),
    };
    let request = match operation {
        Operation::Initialize => Request::Initialize {
            proof,
            upload_commitment: id(&input["uploadCommitment"])?,
        },
        Operation::Poll => Request::Poll(proof),
        Operation::Confirm => Request::Confirm {
            proof,
            account_id: account(&input["accountId"])?,
        },
        operation => {
            let proof = EnrollmentProof {
                pairing: proof,
                upload_secret: Secret32(id(&input["uploadSecret"])?),
            };
            match operation {
                Operation::Reserve => Request::Reserve(proof),
                Operation::Enroll => Request::Enroll(proof),
                Operation::Namespace => Request::Namespace(proof),
                _ => return None,
            }
        }
    };
    request.valid().then_some(request)
}
pub(super) fn parse_reservation(value: &Value) -> Option<Reservation> {
    let item = object(
        value,
        &[
            "schemaVersion",
            "intentId",
            "accountId",
            "reservationId",
            "pollCommitment",
            "uploadCommitment",
            "recoveryGeneration",
            "reservedAtMs",
            "expiresAtMs",
        ],
    )?;
    if !version(&item["schemaVersion"]) {
        return None;
    }
    Some(Reservation {
        intent_id: id(&item["intentId"])?,
        account_id: account(&item["accountId"])?,
        reservation_id: id(&item["reservationId"])?,
        poll_commitment: id(&item["pollCommitment"])?,
        upload_commitment: id(&item["uploadCommitment"])?,
        recovery_generation: id(&item["recoveryGeneration"])?,
        reserved_at_ms: number(&item["reservedAtMs"])?,
        expires_at_ms: number(&item["expiresAtMs"])?,
    })
}
fn parse_receipt(value: &Value) -> Option<Receipt> {
    let item = object(
        value,
        &[
            "schemaVersion",
            "accountId",
            "intentId",
            "reservationId",
            "deviceId",
            "enrolledAtMs",
            "namespaceVersion",
        ],
    )?;
    if !version(&item["schemaVersion"]) || !version(&item["namespaceVersion"]) {
        return None;
    }
    Some(Receipt {
        account_id: account(&item["accountId"])?,
        intent_id: id(&item["intentId"])?,
        reservation_id: id(&item["reservationId"])?,
        device_id: id(&item["deviceId"])?,
        enrolled_at_ms: number(&item["enrolledAtMs"])?,
    })
}
pub(super) fn parse_enrollment(value: &Value) -> Option<Enrollment> {
    let item = object(value, &["receipt", "deviceState"])?;
    let device_state = match item["deviceState"].as_str()? {
        "active" => DeviceState::Active,
        "revoked" => DeviceState::Revoked,
        _ => return None,
    };
    Some(Enrollment {
        receipt: parse_receipt(&item["receipt"])?,
        device_state,
    })
}
fn parse_domain(operation: Operation, value: &Value) -> Option<DomainResult> {
    if let Some(failure) = object(value, &["ok", "error"]) {
        return (failure["ok"].as_bool() == Some(false))
            .then(|| DomainError::parse(&failure["error"]).map(Err))
            .flatten();
    }
    let success = object(value, &["ok", "value"])?;
    if success["ok"].as_bool() != Some(true) {
        return None;
    }
    let value = &success["value"];
    Some(Ok(match operation {
        Operation::Initialize => Success::Initialized {
            expires_at_ms: number(&object(value, &["expiresAtMs"])?["expiresAtMs"])?,
        },
        Operation::Poll | Operation::Confirm => {
            let item = object(
                value,
                &["state", "expiresAtMs", "pollAfterMs", "approvedAccountId"],
            )?;
            let state = match item["state"].as_str()? {
                "pending" => PairingState::Pending,
                "browser-approved" => PairingState::BrowserApproved,
                "terminal-confirmed" => PairingState::TerminalConfirmed,
                "denied" => PairingState::Denied,
                "expired" => PairingState::Expired,
                _ => return None,
            };
            Success::Pairing(PairingView {
                state,
                expires_at_ms: number(&item["expiresAtMs"])?,
                poll_after_ms: number(&item["pollAfterMs"])?,
                approved_account_id: if item["approvedAccountId"].is_null() {
                    None
                } else {
                    Some(account(&item["approvedAccountId"])?)
                },
            })
        }
        Operation::Reserve => Success::Reserved(parse_reservation(value)?),
        Operation::Enroll => {
            let item = object(value, &["reservation", "enrollment"])?;
            Success::Enrolled {
                reservation: parse_reservation(&item["reservation"])?,
                enrollment: parse_enrollment(&item["enrollment"])?,
            }
        }
        Operation::Namespace => {
            let item = object(value, &["reservation", "namespace"])?;
            let namespace = object(
                &item["namespace"],
                &[
                    "schemaVersion",
                    "namespaceVersion",
                    "namespaceKey",
                    "receipt",
                ],
            )?;
            if !version(&namespace["schemaVersion"]) || !version(&namespace["namespaceVersion"]) {
                return None;
            }
            Success::Namespace {
                reservation: parse_reservation(&item["reservation"])?,
                namespace: Namespace {
                    namespace_key: Secret32(id(&namespace["namespaceKey"])?),
                    receipt: parse_receipt(&namespace["receipt"])?,
                },
            }
        }
    }))
}

fn valid_reservation(request: &Request, context: &Context, reservation: &Reservation) -> bool {
    let Some(expires) = context.initialized_expires_at_ms else {
        return false;
    };
    let Some(created) = expires.checked_sub(TTL_MS) else {
        return false;
    };
    let proof = request.proof();
    reservation.intent_id == proof.intent_id
        && Some(reservation.account_id) == context.confirmed_account_id
        && nonzero(&reservation.reservation_id)
        && nonzero(&reservation.recovery_generation)
        && reservation.poll_commitment == commitment(b"poll", &proof.intent_id, &proof.poll_secret)
        && nonzero(&reservation.upload_commitment)
        && reservation.upload_commitment != reservation.poll_commitment
        && request
            .upload_commitment()
            .is_none_or(|expected| expected == reservation.upload_commitment)
        && time(reservation.reserved_at_ms)
        && time(reservation.expires_at_ms)
        && reservation.reserved_at_ms < reservation.expires_at_ms
        && reservation.expires_at_ms - reservation.reserved_at_ms <= TTL_MS
        && reservation.reserved_at_ms >= created
        && reservation.reserved_at_ms <= context.now_ms
        && reservation.expires_at_ms <= expires
}
pub(super) fn valid_receipt(reservation: &Reservation, now: u64, receipt: &Receipt) -> bool {
    receipt.account_id == reservation.account_id
        && receipt.intent_id == reservation.intent_id
        && receipt.reservation_id == reservation.reservation_id
        && receipt.device_id == device_id(reservation)
        && time(receipt.enrolled_at_ms)
        && receipt.enrolled_at_ms >= reservation.reserved_at_ms
        && receipt.enrolled_at_ms < reservation.expires_at_ms
        && receipt.enrolled_at_ms <= now
}
pub(super) fn valid_context(request: &Request, context: &Context) -> bool {
    if !request.valid()
        || !time(context.now_ms)
        || context.confirmed_account_id.is_some_and(|id| !nonzero(&id))
    {
        return false;
    }
    match context.initialized_expires_at_ms {
        Some(expires)
            if !time(expires) || expires < TTL_MS || context.now_ms < expires - TTL_MS =>
        {
            return false
        }
        None if request.operation() != Operation::Initialize
            || context.confirmed_account_id.is_some()
            || context.reservation.is_some()
            || context.enrollment.is_some() =>
        {
            return false
        }
        _ => (),
    }
    if let Request::Confirm { account_id, .. } = request {
        if context
            .confirmed_account_id
            .is_some_and(|confirmed| confirmed != *account_id)
        {
            return false;
        }
    }
    if matches!(
        request.operation(),
        Operation::Reserve | Operation::Enroll | Operation::Namespace
    ) && context.confirmed_account_id.is_none()
    {
        return false;
    }
    if let Some(reservation) = &context.reservation {
        if !valid_reservation(request, context, reservation) {
            return false;
        }
    } else if matches!(
        request.operation(),
        Operation::Enroll | Operation::Namespace
    ) || context.enrollment.is_some()
    {
        return false;
    }
    if let Some(enrollment) = &context.enrollment {
        if !context.reservation.as_ref().is_some_and(|reservation| {
            valid_receipt(reservation, context.now_ms, &enrollment.receipt)
        }) {
            return false;
        }
    } else if request.operation() == Operation::Namespace {
        return false;
    }
    true
}
fn valid_domain(request: &Request, context: &Context, result: &DomainResult) -> bool {
    if !valid_context(request, context) {
        return false;
    }
    let success = match result {
        Err(error) => return error.allowed(request.operation()),
        Ok(success) => success,
    };
    match (request, success) {
        (Request::Initialize { .. }, Success::Initialized { expires_at_ms }) => {
            time(*expires_at_ms)
                && *expires_at_ms >= TTL_MS
                && *expires_at_ms - TTL_MS <= context.now_ms
                && context
                    .initialized_expires_at_ms
                    .is_none_or(|known| known == *expires_at_ms)
        }
        (Request::Poll(_) | Request::Confirm { .. }, Success::Pairing(view)) => {
            if Some(view.expires_at_ms) != context.initialized_expires_at_ms
                || view.poll_after_ms > POLL_MS
            {
                return false;
            }
            let approved = matches!(
                view.state,
                PairingState::BrowserApproved | PairingState::TerminalConfirmed
            );
            if approved {
                if !view.approved_account_id.is_some_and(|id| {
                    nonzero(&id) && context.confirmed_account_id.is_none_or(|known| id == known)
                }) {
                    return false;
                }
            } else if view.approved_account_id.is_some() {
                return false;
            }
            match request {
                Request::Poll(_) => view.poll_after_ms == POLL_MS,
                Request::Confirm { account_id, .. } => {
                    view.state == PairingState::TerminalConfirmed
                        && view.approved_account_id == Some(*account_id)
                        && context.now_ms < view.expires_at_ms
                }
                _ => false,
            }
        }
        (Request::Reserve(_), Success::Reserved(reservation)) => {
            valid_reservation(request, context, reservation)
                && context
                    .reservation
                    .as_ref()
                    .is_none_or(|retained| retained == reservation)
        }
        (
            Request::Enroll(_),
            Success::Enrolled {
                reservation,
                enrollment,
            },
        ) => {
            valid_reservation(request, context, reservation)
                && context.reservation.as_ref() == Some(reservation)
                && valid_receipt(reservation, context.now_ms, &enrollment.receipt)
                && context.enrollment.as_ref().is_none_or(|retained| {
                    retained.receipt == enrollment.receipt
                        && (retained.device_state != DeviceState::Revoked
                            || enrollment.device_state == DeviceState::Revoked)
                })
        }
        (
            Request::Namespace(_),
            Success::Namespace {
                reservation,
                namespace,
            },
        ) => {
            valid_reservation(request, context, reservation)
                && context.reservation.as_ref() == Some(reservation)
                && nonzero(namespace.namespace_key.as_bytes())
                && context.now_ms < reservation.expires_at_ms
                && context
                    .initialized_expires_at_ms
                    .is_some_and(|expires| context.now_ms < expires)
                && valid_receipt(reservation, context.now_ms, &namespace.receipt)
                && context.enrollment.as_ref().is_some_and(|retained| {
                    retained.device_state == DeviceState::Active
                        && retained.receipt == namespace.receipt
                })
        }
        _ => false,
    }
}

/// The writer sees only validated fixed fields. It never serializes caller maps
/// (whose key ordering differs between serde_json and JavaScript).
struct Writer(Vec<u8>);
impl Writer {
    fn raw(&mut self, value: &[u8]) {
        self.0.extend_from_slice(value);
    }
    fn word(&mut self, value: &'static str) {
        self.raw(b"\"");
        self.raw(value.as_bytes());
        self.raw(b"\"");
    }
    fn id(&mut self, value: &[u8]) {
        self.raw(b"\"");
        self.raw(&ascii_hex(value));
        self.raw(b"\"");
    }
    fn account(&mut self, value: &AccountId) {
        self.raw(b"\"acct_");
        self.raw(&ascii_hex(value));
        self.raw(b"\"");
    }
    fn number(&mut self, value: u64) {
        self.raw(value.to_string().as_bytes());
    }
    fn reservation(&mut self, value: &Reservation) {
        self.raw(b"{\"schemaVersion\":1,\"intentId\":");
        self.id(&value.intent_id);
        self.raw(b",\"accountId\":");
        self.account(&value.account_id);
        self.raw(b",\"reservationId\":");
        self.id(&value.reservation_id);
        self.raw(b",\"pollCommitment\":");
        self.id(&value.poll_commitment);
        self.raw(b",\"uploadCommitment\":");
        self.id(&value.upload_commitment);
        self.raw(b",\"recoveryGeneration\":");
        self.id(&value.recovery_generation);
        self.raw(b",\"reservedAtMs\":");
        self.number(value.reserved_at_ms);
        self.raw(b",\"expiresAtMs\":");
        self.number(value.expires_at_ms);
        self.raw(b"}");
    }
    fn receipt(&mut self, value: &Receipt) {
        self.raw(b"{\"schemaVersion\":1,\"accountId\":");
        self.account(&value.account_id);
        self.raw(b",\"intentId\":");
        self.id(&value.intent_id);
        self.raw(b",\"reservationId\":");
        self.id(&value.reservation_id);
        self.raw(b",\"deviceId\":");
        self.id(&value.device_id);
        self.raw(b",\"enrolledAtMs\":");
        self.number(value.enrolled_at_ms);
        self.raw(b",\"namespaceVersion\":1}");
    }
    fn enrollment(&mut self, value: &Enrollment) {
        self.raw(b"{\"receipt\":");
        self.receipt(&value.receipt);
        self.raw(b",\"deviceState\":");
        self.word(match value.device_state {
            DeviceState::Active => "active",
            DeviceState::Revoked => "revoked",
        });
        self.raw(b"}");
    }
    fn success(&mut self, value: &Success) {
        match value {
            Success::Initialized { expires_at_ms } => {
                self.raw(b"{\"expiresAtMs\":");
                self.number(*expires_at_ms);
                self.raw(b"}");
            }
            Success::Pairing(view) => {
                self.raw(b"{\"state\":");
                self.word(view.state.name());
                self.raw(b",\"expiresAtMs\":");
                self.number(view.expires_at_ms);
                self.raw(b",\"pollAfterMs\":");
                self.number(view.poll_after_ms);
                self.raw(b",\"approvedAccountId\":");
                match view.approved_account_id {
                    Some(id) => self.account(&id),
                    None => self.raw(b"null"),
                }
                self.raw(b"}");
            }
            Success::Reserved(value) => self.reservation(value),
            Success::Enrolled {
                reservation,
                enrollment,
            } => {
                self.raw(b"{\"reservation\":");
                self.reservation(reservation);
                self.raw(b",\"enrollment\":");
                self.enrollment(enrollment);
                self.raw(b"}");
            }
            Success::Namespace {
                reservation,
                namespace,
            } => {
                self.raw(b"{\"reservation\":");
                self.reservation(reservation);
                self.raw(
                    b",\"namespace\":{\"schemaVersion\":1,\"namespaceVersion\":1,\"namespaceKey\":",
                );
                self.id(namespace.namespace_key.as_bytes());
                self.raw(b",\"receipt\":");
                self.receipt(&namespace.receipt);
                self.raw(b"}}");
            }
        }
    }
    fn finish(self, cap: usize) -> Option<WireBytes> {
        (!self.0.is_empty() && self.0.len() <= cap).then_some(WireBytes(self.0))
    }
}

pub(super) fn encode_request(request: &Request) -> Result<WireBytes, CodecError> {
    if !request.valid() {
        return Err(CodecError::InvalidRequest);
    }
    let proof = request.proof();
    let mut writer = Writer(Vec::with_capacity(320));
    writer.raw(b"{\"schemaVersion\":1,\"operation\":");
    writer.word(request.operation().name());
    writer.raw(b",\"input\":{\"intentId\":");
    writer.id(&proof.intent_id);
    writer.raw(b",\"pollSecret\":");
    writer.id(proof.poll_secret.as_bytes());
    match request {
        Request::Initialize {
            upload_commitment, ..
        } => {
            writer.raw(b",\"uploadCommitment\":");
            writer.id(upload_commitment);
        }
        Request::Confirm { account_id, .. } => {
            writer.raw(b",\"accountId\":");
            writer.account(account_id);
        }
        Request::Reserve(proof) | Request::Enroll(proof) | Request::Namespace(proof) => {
            writer.raw(b",\"uploadSecret\":");
            writer.id(proof.upload_secret.as_bytes());
        }
        Request::Poll(_) => (),
    }
    writer.raw(b"}}");
    writer
        .finish(MAX_REQUEST_BYTES)
        .ok_or(CodecError::InvalidRequest)
}
pub(super) fn decode_request(bytes: &[u8]) -> Result<Request, CodecError> {
    let checked = || {
        if bytes.is_empty() || bytes.len() > MAX_REQUEST_BYTES || !bytes.is_ascii() {
            return None;
        }
        let request = parse_request(&serde_json::from_slice::<Value>(bytes).ok()?)?;
        (encode_request(&request).ok()?.as_bytes() == bytes).then_some(request)
    };
    checked().ok_or(CodecError::InvalidRequest)
}
pub(super) fn encode_response(
    request: &Request,
    context: &Context,
    result: &DomainResult,
) -> Result<WireBytes, CodecError> {
    if !valid_domain(request, context, result) {
        return Err(CodecError::InvalidResponse);
    }
    let mut writer = Writer(Vec::with_capacity(1_280));
    writer.raw(b"{\"schemaVersion\":1,\"operation\":");
    writer.word(request.operation().name());
    writer.raw(b",\"intentId\":");
    writer.id(&request.proof().intent_id);
    writer.raw(b",\"result\":");
    match result {
        Ok(success) => {
            writer.raw(b"{\"ok\":true,\"value\":");
            writer.success(success);
        }
        Err(error) => {
            writer.raw(b"{\"ok\":false,\"error\":");
            writer.word(error.name());
        }
    }
    writer.raw(b"}}");
    writer
        .finish(MAX_RESPONSE_BYTES)
        .ok_or(CodecError::InvalidResponse)
}
pub(super) fn decode_response(
    bytes: &[u8],
    request: &Request,
    context: &Context,
) -> Result<DomainResult, CodecError> {
    let checked = || {
        if bytes.is_empty()
            || bytes.len() > MAX_RESPONSE_BYTES
            || !bytes.is_ascii()
            || !valid_context(request, context)
        {
            return None;
        }
        let value = serde_json::from_slice::<Value>(bytes).ok()?;
        let envelope = object(
            &value,
            &["schemaVersion", "operation", "intentId", "result"],
        )?;
        if !version(&envelope["schemaVersion"])
            || Operation::parse(&envelope["operation"])? != request.operation()
            || id(&envelope["intentId"])? != request.proof().intent_id
        {
            return None;
        }
        let result = parse_domain(request.operation(), &envelope["result"])?;
        (encode_response(request, context, &result).ok()?.as_bytes() == bytes).then_some(result)
    };
    checked().ok_or(CodecError::InvalidResponse)
}

#[cfg(test)]
#[path = "contract.tests.rs"]
mod tests;
