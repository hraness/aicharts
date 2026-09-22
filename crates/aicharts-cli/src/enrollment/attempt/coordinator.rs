//! Private enrollment coordinator join.
//!
//! This is the only operation-shaped join for the dormant enrollment pieces.
//! It deliberately accepts an already-open [`HeldAttempt`]: initialization,
//! reference-store construction and browser handoff remain explicit caller
//! work, so this module cannot mint a replacement secret or silently activate
//! the feature. Callers must drop all reference/vault guards before invoking
//! [`exchange_once`]; the attempt lock may span the bounded synchronous HTTP
//! exchange. Browser and account-choice waits happen after the guard is
//! dropped and are followed by a fresh `HeldAttempt::open`.

use super::session::{CustodyPort, ExchangePort, HeldAttempt, OperationFailure};
use super::storage::Storage;
use super::Error;
use crate::enrollment::contract::{Context, Operation, Request};
#[cfg(target_os = "macos")]
use crate::enrollment::diagnostic::{Failure, Stage};
use crate::enrollment::https::{AcceptedEnrollment, TransportError};
use aicharts_custody::SecretRecord;

#[cfg(target_os = "macos")]
use super::macos::MacStorage;
#[cfg(target_os = "macos")]
use super::storage;
#[cfg(target_os = "macos")]
use crate::enrollment::https::HttpsEnrollment;
#[cfg(target_os = "macos")]
use aicharts_custody::{references::ReferenceStore, Vault};
#[cfg(target_os = "macos")]
use std::path::Path;

#[cfg(target_os = "macos")]
fn native_custody_error(error: aicharts_custody::references::Error) -> Error {
    use aicharts_custody::references::Error as E;
    match error {
        E::OutcomeUnknown | E::StorageUnavailable => Error::OutcomeUnknown,
        E::RecoveryRequired => Error::RecoveryRequired,
        E::Busy => Error::Busy,
        _ => Error::Custody,
    }
}

/// Paced gap between same-flight redispatches of an idempotent account
/// mutation whose exchange outcome was unavailable or uncertain.
const REDISPATCH_DELAY: std::time::Duration = std::time::Duration::from_secs(4);

/// Stable browser handoff URL. The fragment contains only the public intent
/// identifier; pairing preimages and local paths never enter this string.
pub(super) fn pairing_url(intent_id: &[u8; 32]) -> String {
    let mut encoded = String::with_capacity(64);
    for byte in intent_id {
        use std::fmt::Write as _;
        let _ = write!(encoded, "{byte:02x}");
    }
    format!("https://aicharts.io/usage/pairing#intentId={encoded}")
}

/// Build one operation request and its frozen context from the retained
/// pairing material. This projection is borrow-only: secret preimages never
/// enter the attempt record or the browser URL. Callers supply an account only
/// for the explicit confirmation action.
pub(super) fn request_for_operation(
    record: &super::record::Record,
    secret: &SecretRecord,
    operation: Operation,
    account_id: Option<[u8; 16]>,
    now_ms: u64,
) -> Result<(Request, Context), Error> {
    super::record::validate(record)?;
    if now_ms < record.clock_floor_ms || now_ms > crate::enrollment::contract::MAX_TIME_MS {
        return Err(Error::ClockRegressed);
    }
    let intent = aicharts_custody::references::RecordIntent::from_record(secret);
    if intent.identity() != &record.pairing.identity
        || intent.commitment() != record.pairing.commitment.as_bytes()
    {
        return Err(Error::Custody);
    }
    if operation == Operation::Confirm {
        if account_id.is_none() || record.account_choice.account() != account_id {
            return Err(Error::Conflict);
        }
    } else if account_id.is_some() {
        return Err(Error::Conflict);
    }
    let proof = secret
        .with_pairing_secrets(|poll, upload| {
            Ok(crate::enrollment::contract::EnrollmentProof {
                pairing: crate::enrollment::contract::PollProof {
                    intent_id: record.intent_id,
                    poll_secret: crate::enrollment::contract::Secret32::from_bytes(*poll)
                        .ok_or(Error::Custody)?,
                },
                upload_secret: crate::enrollment::contract::Secret32::from_bytes(*upload)
                    .ok_or(Error::Custody)?,
            })
        })
        .map_err(|_| Error::Custody)??;
    let request = match operation {
        Operation::Initialize => Request::Initialize {
            proof: proof.pairing,
            upload_commitment: *record.upload_commitment.as_bytes(),
        },
        Operation::Poll => Request::Poll(proof.pairing),
        Operation::Confirm => Request::Confirm {
            proof: proof.pairing,
            account_id: account_id.ok_or(Error::Conflict)?,
        },
        Operation::Reserve => Request::Reserve(proof),
        Operation::Enroll => Request::Enroll(proof),
        Operation::Namespace => Request::Namespace(proof),
    };
    let context = Context {
        now_ms,
        initialized_expires_at_ms: record.initialized_expires_at_ms,
        confirmed_account_id: record.account_choice.confirmed(),
        reservation: record.reservation.clone(),
        enrollment: record.enrollment.clone(),
    };
    crate::enrollment::contract::valid_context(&request, &context)
        .then_some((request, context))
        .ok_or(Error::Conflict)
}

#[cfg(target_os = "macos")]
/// Native private state assembled from one explicit anchor. Attempt storage is
/// initialized before the reference manifest, so a crash leaves durable
/// evidence that recovery must inspect instead of silently reminting secrets.
pub(super) struct NativeEnrollment {
    pub(super) attempt: HeldAttempt<MacStorage>,
    pub(super) references: ReferenceStore,
    pub(super) vault: Vault,
}

#[cfg(target_os = "macos")]
pub(super) fn initialize_native(
    path: &Path,
    initial: &super::record::Record,
) -> Result<NativeEnrollment, Error> {
    let mut storage = MacStorage::create_new(path, initial)?;
    let durable = storage::initialize(&mut storage, initial)?;
    let references = ReferenceStore::initialize_new(path, initial.installation_id)
        .map_err(native_custody_error)?;
    let vault = Vault::new().map_err(|_| Error::Custody)?;
    let attempt = HeldAttempt::open(storage, durable.token())?;
    Ok(NativeEnrollment {
        attempt,
        references,
        vault,
    })
}

#[cfg(target_os = "macos")]
pub(super) fn reopen_native(
    path: &Path,
    expected: super::record::Token,
) -> Result<NativeEnrollment, Error> {
    reopen_native_observed(path, expected).map_err(|failure| failure.error)
}

#[cfg(target_os = "macos")]
pub(super) fn reopen_native_observed(
    path: &Path,
    expected: super::record::Token,
) -> Result<NativeEnrollment, Failure> {
    let storage = MacStorage::open_existing(path)
        .map_err(|error| Failure::attempt(Stage::AttemptReopen, error))?;
    let references = ReferenceStore::open_existing(path).map_err(|error| {
        Failure::references(Stage::ReferencesOpen, error, native_custody_error(error))
    })?;
    let vault = Vault::new()
        .map_err(|error| Failure::custody(Stage::CustodyConstruct, error, Error::Custody))?;
    let attempt = HeldAttempt::open(storage, expected)
        .map_err(|error| Failure::attempt(Stage::AttemptDurability, error))?;
    Ok(NativeEnrollment {
        attempt,
        references,
        vault,
    })
}

#[cfg(target_os = "macos")]
impl NativeEnrollment {
    /// Pairing custody is the only transition allowed before browser handoff.
    /// Callers should drop this state before waiting for the browser, then use
    /// `reopen_native` and a fresh proof for each subsequent action.
    pub(super) fn complete_pairing(
        &mut self,
        secret: &SecretRecord,
        observed_at_ms: u64,
    ) -> Result<(), Error> {
        let mut custody = super::session::SealedCustody {
            references: &mut self.references,
            vault: &mut self.vault,
            pairing_token: None,
        };
        self.attempt
            .complete_pairing(secret, &mut custody, observed_at_ms)
    }

    /// Consume the native state for one synchronous exchange. Reference and
    /// vault values are borrowed only for the sealed proof calls; those calls
    /// release their internal locks before the transport runs. Consuming the
    /// state prevents browser-wait callers from accidentally reusing a stale
    /// held session.
    #[allow(clippy::result_large_err, clippy::too_many_arguments)]
    pub(super) fn exchange_once(
        self,
        request: &Request,
        context: &Context,
        pairing_secret: &SecretRecord,
        prepared_at_ms: u64,
        attempted_at_ms: u64,
    ) -> std::result::Result<AcceptedEnrollment, OperationFailure> {
        let Self {
            attempt,
            mut references,
            mut vault,
        } = self;
        let mut custody = super::session::SealedCustody {
            references: &mut references,
            vault: &mut vault,
            pairing_token: None,
        };
        let mut transport = HttpsEnrollment::sealed();
        exchange_once(
            attempt,
            request,
            context,
            pairing_secret,
            &mut custody,
            &mut transport,
            prepared_at_ms,
            attempted_at_ms,
        )
    }
}

/// Execute one first-attempt exchange using the exact caller-owned pairing
/// secret. Refreshing while the attempt lock is held closes the startup crash
/// window before any custody or network effect. A retained dispatched
/// mutating flight is rejected by `HeldAttempt::run_operation`; explicit
/// reconstruction/retry is a separate state-machine action and is never
/// implicit here. A retained dispatched Poll flight is the one exception the
/// session durably abandons, because the exchange is a server-side read with
/// nothing to reconcile.
#[allow(clippy::result_large_err, clippy::too_many_arguments)]
pub(super) fn exchange_once<S, C, X>(
    mut held: HeldAttempt<S>,
    request: &Request,
    context: &Context,
    pairing_secret: &SecretRecord,
    custody: &mut C,
    exchange: &mut X,
    prepared_at_ms: u64,
    attempted_at_ms: u64,
) -> std::result::Result<AcceptedEnrollment, OperationFailure>
where
    S: Storage,
    C: CustodyPort,
    X: ExchangePort,
{
    if let Err(error) = held.refresh_durable() {
        return Err(OperationFailure {
            error,
            namespace_secret: None,
            transport: None,
        });
    }
    held.run_operation(
        request,
        context,
        pairing_secret,
        custody,
        exchange,
        prepared_at_ms,
        attempted_at_ms,
        // Idempotent account mutations settle remotely while an unavailable
        // reply is in flight; the paced gap lets that commit land before the
        // same-flight redispatch reconciles it.
        REDISPATCH_DELAY,
    )
}

/// Reconcile a persisted namespace pin without HTTPS. The caller must retain
/// the original non-Clone namespace `SecretRecord`; missing material is a
/// recovery failure and never causes reminting or redispatch. All reference
/// and vault work is delegated to the sealed custody port's short sessions.
#[allow(clippy::result_large_err)]
pub(super) fn reconcile_namespace<S, C>(
    held: HeldAttempt<S>,
    namespace_secret: &SecretRecord,
    custody: &mut C,
    prepared_at_ms: u64,
) -> std::result::Result<(), OperationFailure>
where
    S: Storage,
    C: CustodyPort,
{
    held.reconcile_namespace(namespace_secret, custody, prepared_at_ms)
}

/// Stable mapping for callers that need to classify a failed exchange while
/// retaining its original typed material. Transport failures are represented
/// in `OperationFailure::transport`; this helper intentionally does not
/// expose request or response preimages.
pub(super) fn transport_failure(error: TransportError) -> OperationFailure {
    OperationFailure {
        error: Error::OutcomeUnknown,
        namespace_secret: None,
        transport: Some(error),
    }
}

/// Apply an explicit account choice and return the still-held session for the
/// subsequent confirmation request. A fresh durable read precedes the update;
/// callers drop it before any browser/user wait and reopen with its token.
pub(super) fn choose_account<S: Storage>(
    mut held: HeldAttempt<S>,
    account_id: [u8; 16],
    chosen_at_ms: u64,
) -> Result<HeldAttempt<S>, Error> {
    held.refresh_durable()?;
    held.choose_account(account_id, chosen_at_ms)?;
    Ok(held)
}

/// Reconstruct a retained flight only when the caller names the exact
/// dispatch count observed on disk. This is an explicit recovery action; it
/// never sends bytes or increments the counter by itself.
pub(super) fn reconstruct_retained<S: Storage>(
    mut held: HeldAttempt<S>,
    pairing_secret: &SecretRecord,
    expected_dispatches: u8,
) -> Result<(HeldAttempt<S>, Request, Context), Error> {
    held.refresh_durable()?;
    let flight = held.record().flight.as_ref().ok_or(Error::Missing)?;
    if expected_dispatches == 0 || flight.dispatches != expected_dispatches {
        return Err(Error::Conflict);
    }
    let (request, context) =
        super::sequencer::reconstruct_flight(held.record(), held.token(), pairing_secret)?;
    Ok((held, request, context))
}
