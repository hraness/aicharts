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
use crate::enrollment::https::{AcceptedEnrollment, TransportError};
use aicharts_custody::SecretRecord;

#[cfg(target_os = "macos")]
use super::macos::MacStorage;
#[cfg(target_os = "macos")]
use super::session::SealedCustody;
#[cfg(target_os = "macos")]
use super::storage;
#[cfg(target_os = "macos")]
use crate::enrollment::contract;
#[cfg(target_os = "macos")]
use crate::enrollment::https::HttpsEnrollment;
#[cfg(target_os = "macos")]
use aicharts_custody::{references::ReferenceStore, CredentialRef, Purpose, Secret32, Vault};
#[cfg(target_os = "macos")]
use std::path::Path;
#[cfg(target_os = "macos")]
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
    let storage = MacStorage::open_existing(path)?;
    let references = ReferenceStore::open_existing(path).map_err(native_custody_error)?;
    let vault = Vault::new().map_err(|_| Error::Custody)?;
    let attempt = HeldAttempt::open(storage, expected)?;
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
/// window before any custody or network effect. A retained dispatched flight
/// is rejected by `HeldAttempt::run_operation`; explicit reconstruction/retry
/// is a separate state-machine action and is never implicit here.
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

/// Terminal pairing outcomes contain no secret, request or provider material.
/// Denial and expiry are ordinary outcomes, not local errors.
#[cfg(target_os = "macos")]
pub(in crate::enrollment) enum PairingOutcome {
    Confirmed { account_id: [u8; 16] },
    Denied,
    Expired,
}

#[cfg(target_os = "macos")]
fn wall_now_ms() -> Result<u64, Error> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| Error::ClockRegressed)?;
    u64::try_from(elapsed.as_millis())
        .ok()
        .filter(|now| *now <= contract::MAX_TIME_MS)
        .ok_or(Error::ClockRegressed)
}

/// Mint one fresh pairing secret and its initial durable record. The minted
/// values stay inside this process until custody installation; nothing is
/// written to logs or the browser beyond the public intent identifier.
#[cfg(target_os = "macos")]
fn mint_record(now_ms: u64) -> Result<(super::record::Record, SecretRecord), Error> {
    let mut installation_id = [0; 32];
    let mut intent_id = [0; 32];
    let mut pairing_item = [0; 32];
    let mut namespace_item = [0; 32];
    let mut polling = [0; 32];
    let mut upload = [0; 32];
    for bytes in [
        &mut installation_id,
        &mut intent_id,
        &mut pairing_item,
        &mut namespace_item,
        &mut polling,
        &mut upload,
    ] {
        getrandom::fill(bytes).map_err(|_| Error::Custody)?;
    }
    let secret = SecretRecord::pairing(
        CredentialRef::new(installation_id, pairing_item, Purpose::Pairing)
            .map_err(|_| Error::Custody)?,
        intent_id,
        Secret32::new(polling).map_err(|_| Error::Custody)?,
        Secret32::new(upload).map_err(|_| Error::Custody)?,
    )
    .map_err(|_| Error::Custody)?;
    let commitments = secret
        .with_pairing_secrets(
            |polling, upload| -> Result<(contract::Id, contract::Id), Error> {
                let poll_commitment =
                    contract::request_poll_commitment(&Request::Poll(contract::PollProof {
                        intent_id,
                        poll_secret: contract::Secret32::from_bytes(*polling)
                            .ok_or(Error::Custody)?,
                    }));
                let upload_commitment = contract::request_upload_commitment(&Request::Reserve(
                    contract::EnrollmentProof {
                        pairing: contract::PollProof {
                            intent_id,
                            poll_secret: contract::Secret32::from_bytes(*polling)
                                .ok_or(Error::Custody)?,
                        },
                        upload_secret: contract::Secret32::from_bytes(*upload)
                            .ok_or(Error::Custody)?,
                    },
                ))
                .ok_or(Error::Custody)?;
                Ok((poll_commitment, upload_commitment))
            },
        )
        .map_err(|_| Error::Custody)??;
    let initial = super::record::Record {
        revision: 0,
        installation_id,
        intent_id,
        pairing: super::record::Pin::from_intent(
            &aicharts_custody::references::RecordIntent::from_record(&secret),
        )?,
        namespace_item_id: namespace_item,
        poll_commitment: super::record::Commitment::new(commitments.0)?,
        upload_commitment: super::record::Commitment::new(commitments.1)?,
        progress: super::record::Progress::PairingPlanned,
        initialized_expires_at_ms: None,
        last_pairing: None,
        account_choice: super::record::AccountChoice::Unchosen,
        reservation: None,
        enrollment: None,
        namespace: None,
        flight: None,
        flights_started: 0,
        last_failure: None,
        clock_floor_ms: now_ms,
    };
    super::record::initial(&initial)?;
    Ok((initial, secret))
}

/// Read the pairing secret back out of sealed custody for a resumed attempt.
/// Resolution re-verifies the exact manifest entry and vault record.
#[cfg(target_os = "macos")]
fn resolve_pairing_secret(
    native: &mut NativeEnrollment,
    record: &super::record::Record,
) -> Result<SecretRecord, Error> {
    let manifest = native.references.snapshot().map_err(native_custody_error)?;
    native
        .references
        .resolve_verified(
            &manifest.token(),
            &record.pairing.identity,
            &mut native.vault,
        )
        .map_err(native_custody_error)
}

/// Reopen the attempt under its observed committed token. Inspection performs
/// no effect; the reopen revalidates durability before any caller effect.
#[cfg(target_os = "macos")]
fn reopen(path: &Path) -> Result<NativeEnrollment, Error> {
    let mut storage = MacStorage::open_existing(path)?;
    let token = storage::inspect(&mut storage)?.token();
    drop(storage);
    reopen_native(path, token)
}

/// Classify one explicit retained-flight retry. A transient transport outcome
/// leaves the flight dispatched; the caller may try again while the retained
/// dispatch budget lasts. Anything else is fatal to this attempt.
#[cfg(target_os = "macos")]
enum RetryFailure {
    Transient,
    Fatal(Error),
}

/// Complete one retained dispatched flight with fresh custody proof and exactly
/// one new dispatch. This is the explicit caller-side retry the sequencer
/// requires; it never auto-retries and never remints secrets.
#[cfg(target_os = "macos")]
fn retry_retained(
    native: NativeEnrollment,
    secret: &SecretRecord,
    dispatches: u8,
) -> std::result::Result<AcceptedEnrollment, RetryFailure> {
    let NativeEnrollment {
        attempt,
        mut references,
        mut vault,
    } = native;
    let (mut held, request, context) =
        reconstruct_retained(attempt, secret, dispatches).map_err(RetryFailure::Fatal)?;
    let mut custody = SealedCustody {
        references: &mut references,
        vault: &mut vault,
        pairing_token: None,
    };
    custody
        .verify_pairing(held.record(), secret)
        .map_err(RetryFailure::Fatal)?;
    held.dispatch_flight(
        &request,
        &context,
        wall_now_ms().map_err(RetryFailure::Fatal)?,
    )
    .map_err(RetryFailure::Fatal)?;
    let mut transport = HttpsEnrollment::sealed();
    let accepted = match held.exchange_once(&mut transport, &request, &context) {
        Ok(accepted) => accepted,
        Err(TransportError::Uncertain | TransportError::Unavailable) => {
            return Err(RetryFailure::Transient);
        }
        Err(_) => return Err(RetryFailure::Fatal(Error::OutcomeUnknown)),
    };
    custody
        .verify_pairing(held.record(), secret)
        .map_err(RetryFailure::Fatal)?;
    held.settle_response(
        &request,
        &context,
        accepted.observed_at_ms,
        &accepted.result,
    )
    .map_err(RetryFailure::Fatal)?;
    Ok(accepted)
}

/// Run one operation to a settled outcome, transparently completing a retained
/// dispatched flight left by an earlier process. Each loop iteration reopens
/// the attempt under its current token; a fresh run also adopts a retained
/// prepared-only flight without a new dispatch.
#[cfg(target_os = "macos")]
fn attempt_op(
    path: &Path,
    secret: &SecretRecord,
    operation: Operation,
    account_id: Option<[u8; 16]>,
    notice: &mut dyn FnMut(&'static str),
) -> Result<AcceptedEnrollment, Error> {
    loop {
        let now_ms = wall_now_ms()?;
        let native = reopen(path)?;
        if let Some(flight) = native
            .attempt
            .record()
            .flight
            .clone()
            .filter(|flight| flight.dispatches > 0)
        {
            if flight.operation != operation || flight.dispatches >= super::MAX_DISPATCHES {
                return Err(Error::OutcomeUnknown);
            }
            match retry_retained(native, secret, flight.dispatches) {
                Ok(accepted) => return Ok(accepted),
                Err(RetryFailure::Transient) => {
                    notice("pairing_exchange_retrying");
                    continue;
                }
                Err(RetryFailure::Fatal(error)) => return Err(error),
            }
        }
        let (request, context) = request_for_operation(
            native.attempt.record(),
            secret,
            operation,
            account_id,
            now_ms,
        )?;
        match native.exchange_once(&request, &context, secret, now_ms, now_ms) {
            Ok(accepted) => return Ok(accepted),
            Err(failure) => match failure.transport {
                Some(TransportError::Uncertain | TransportError::Unavailable) => {
                    notice("pairing_exchange_retrying");
                }
                Some(_) => return Err(failure.error),
                None => return Err(failure.error),
            },
        }
    }
}

/// The shared attempt body once pairing custody exists: initialize or resume,
/// present the handoff link, poll until the browser approves or the attempt
/// ends, then confirm the observed account once. Every operation reopens the
/// attempt directory; no held lock survives a browser or sleep wait.
#[cfg(target_os = "macos")]
fn run_pairing_attempt(
    path: &Path,
    secret: &SecretRecord,
    notice: &mut dyn FnMut(&'static str),
    present_url: impl FnOnce(&str) -> bool,
) -> Result<PairingOutcome, Error> {
    let intent_id = {
        let native = reopen(path)?;
        let record = native.attempt.record();
        let initialized = record.progress >= super::record::Progress::Initialized;
        let intent_id = record.intent_id;
        drop(native);
        if !initialized {
            let accepted = attempt_op(path, secret, Operation::Initialize, None, notice)?;
            match accepted.result {
                Ok(contract::Success::Initialized { .. }) => notice("pairing_initialized"),
                Ok(_) => return Err(Error::OutcomeUnknown),
                Err(contract::DomainError::Expired) => return Ok(PairingOutcome::Expired),
                Err(_) => return Err(Error::OutcomeUnknown),
            }
        }
        intent_id
    };
    notice("pairing_link_ready");
    if !present_url(&pairing_url(&intent_id)) {
        notice("pairing_browser_open_failed");
    }
    let account_id = loop {
        std::thread::sleep(Duration::from_millis(contract::POLL_MS));
        let accepted = attempt_op(path, secret, Operation::Poll, None, notice)?;
        let view = match accepted.result {
            Ok(contract::Success::Pairing(view)) => view,
            Ok(_) => return Err(Error::OutcomeUnknown),
            Err(contract::DomainError::Throttled) => continue,
            Err(contract::DomainError::Expired) => return Ok(PairingOutcome::Expired),
            Err(_) => return Err(Error::OutcomeUnknown),
        };
        match view.state {
            contract::PairingState::Pending => notice("pairing_waiting_for_browser"),
            contract::PairingState::BrowserApproved => {
                break view.approved_account_id.ok_or(Error::OutcomeUnknown)?;
            }
            contract::PairingState::TerminalConfirmed => {
                return Ok(PairingOutcome::Confirmed {
                    account_id: view.approved_account_id.ok_or(Error::OutcomeUnknown)?,
                });
            }
            contract::PairingState::Denied => return Ok(PairingOutcome::Denied),
            contract::PairingState::Expired => return Ok(PairingOutcome::Expired),
        }
    };
    notice("pairing_browser_approved");
    let native = reopen(path)?;
    let NativeEnrollment { attempt, .. } = native;
    let held = choose_account(attempt, account_id, wall_now_ms()?)?;
    drop(held);
    let accepted = attempt_op(path, secret, Operation::Confirm, Some(account_id), notice)?;
    match accepted.result {
        Ok(contract::Success::Pairing(view)) => match view.state {
            contract::PairingState::TerminalConfirmed => {
                Ok(PairingOutcome::Confirmed { account_id })
            }
            contract::PairingState::Denied => Ok(PairingOutcome::Denied),
            contract::PairingState::Expired => Ok(PairingOutcome::Expired),
            _ => Err(Error::OutcomeUnknown),
        },
        Ok(_) => Err(Error::OutcomeUnknown),
        Err(contract::DomainError::Expired) => Ok(PairingOutcome::Expired),
        Err(_) => Err(Error::OutcomeUnknown),
    }
}

/// Drive one native pairing attempt to a terminal outcome. An existing attempt
/// directory resumes at its recorded phase; a missing directory mints one
/// fresh intent. `present_url` performs the browser handoff (typically `open`)
/// and returns whether the browser accepted the URL. `notice` receives fixed
/// progress keys; neither callback ever sees secrets, proofs or account data.
#[cfg(target_os = "macos")]
pub(in crate::enrollment) fn run_pairing(
    path: &Path,
    notice: &mut dyn FnMut(&'static str),
    present_url: impl FnOnce(&str) -> bool,
) -> Result<PairingOutcome, Error> {
    match MacStorage::open_existing(path) {
        Ok(mut storage) => {
            let token = storage::inspect(&mut storage)?.token();
            drop(storage);
            let mut native = reopen_native(path, token)?;
            let record = native.attempt.record().clone();
            match record.progress {
                // Custody was never durably installed, or the custody boundary
                // outcome is unknown. Neither state can mint its way forward.
                super::record::Progress::PairingPlanned
                | super::record::Progress::PairingPrepared => Err(Error::RecoveryRequired),
                super::record::Progress::PairingCustodyVerified
                | super::record::Progress::Initialized => {
                    let secret = resolve_pairing_secret(&mut native, &record)?;
                    drop(native);
                    run_pairing_attempt(path, &secret, notice, present_url)
                }
                super::record::Progress::Confirmed => Ok(PairingOutcome::Confirmed {
                    account_id: record
                        .account_choice
                        .confirmed()
                        .ok_or(Error::InvalidRecord)?,
                }),
                _ => Err(Error::RecoveryRequired),
            }
        }
        Err(Error::Missing) => {
            std::fs::create_dir_all(path).map_err(|_| Error::StorageUnavailable)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
                    .map_err(|_| Error::StorageUnavailable)?;
            }
            let now_ms = wall_now_ms()?;
            let (initial, secret) = mint_record(now_ms)?;
            let mut native = initialize_native(path, &initial)?;
            native.complete_pairing(&secret, now_ms)?;
            drop(native);
            run_pairing_attempt(path, &secret, notice, present_url)
        }
        Err(error) => Err(error),
    }
}
