//! Production terminal enrollment driver. This is the activation seam the
//! dormant pieces deliberately withheld: it mints one pairing secret and its
//! genesis record, then drives the once-only handshake
//! `Initialize -> browser pairing -> Poll -> Confirm -> Reserve -> Enroll ->
//! Namespace`. The sequencing itself is a pure state machine over the
//! [`AttemptOps`] seam so it is exercised by scripted tests; `MacOps` backs that
//! seam with a freshly reopened macOS attempt, custody and once-only transport
//! per effect. The driver persists only nonsecret progress and holds the
//! pairing secret in caller-owned memory between operations; on a later
//! invocation it reloads the exact retained secret from custody by its pinned
//! identity. Crash and uncertain states refuse closed — a retained dispatched
//! mutating flight, an interrupted custody write or a lost secret is never
//! retried or reminted implicitly. A dispatched Poll flight is the single
//! explicit exception: the exchange is a server-side read, so an uncertain
//! outcome is durably abandoned and the paced poll loop prepares a fresh
//! flight instead of reconstructing one.

use super::coordinator::{self, NativeEnrollment};
use super::macos::MacStorage;
use super::record::{AccountChoice, Commitment, Pin, Progress, Record};
use super::session::SealedCustody;
use super::storage;
use super::{Error, Result};
use crate::enrollment::contract::{self, DomainResult, Operation, PairingState, Success};
use crate::enrollment::diagnostic::{Failure, Stage};
use crate::enrollment::https::AcceptedEnrollment;
use crate::enrollment::{EnrollIo, EnrollOutcome, EnrolledInstallation};
use aicharts_custody::{
    references::RecordIntent, CredentialRef, Purpose, Secret32 as CustodySecret32, SecretRecord,
};
use std::path::Path;

/// Bound on browser-approval polls so a stalled or abandoned pairing cannot
/// keep an attempt alive indefinitely. The server's `poll_after_ms` paces each
/// wait; this only caps the number of waits.
pub(super) const MAX_PAIRING_POLLS: u32 = 600;

type Io<'a> = &'a mut dyn EnrollIo;

/// The single operation seam the sequencer drives. Each method is a complete,
/// separately-locked effect — the caller never holds an attempt lock across a
/// browser or account wait. `MacOps` implements it with the real macOS
/// attempt/custody/transport; tests implement it with scripted durable states
/// and responses so the once-only sequencing is covered without custody or
/// HTTPS.
pub(super) trait AttemptOps {
    /// Current durable progress, reread each call.
    fn progress(&mut self) -> Result<Progress>;
    /// The pinned intent id used for the one-time pairing handoff URL.
    fn intent_id(&mut self) -> Result<[u8; 32]>;
    /// The recorded account choice, if one was already made.
    fn chosen_account(&mut self) -> Result<Option<[u8; 16]>>;
    /// One bounded once-only exchange; the settled domain result is returned.
    fn exchange(
        &mut self,
        operation: Operation,
        account_id: Option<[u8; 16]>,
        io: Io,
    ) -> Result<DomainResult>;
    /// Record the browser-approved account choice exactly once.
    fn choose(&mut self, account_id: [u8; 16], now_ms: u64) -> Result<()>;
    /// Verify the existing pairing custody entry after an interrupted install.
    fn reconcile_pairing(&mut self) -> Result<()>;
    /// Nonsecret outcome facts once the namespace is custody-verified.
    fn outcome(&mut self) -> Result<EnrollOutcome>;
}

/// Reopen the native attempt/custody view at the durable token. Exactly one
/// fresh attempt lock is held for the span of each effect; it is dropped before
/// any browser or account wait so a crash cannot leave a live lock.
fn reopen(dir: &Path) -> Result<NativeEnrollment> {
    reopen_observed(dir).map_err(|failure| failure.error)
}

fn reopen_observed(dir: &Path) -> std::result::Result<NativeEnrollment, Failure> {
    let token = {
        let mut storage = MacStorage::open_existing(dir)
            .map_err(|error| Failure::attempt(Stage::AttemptSnapshot, error))?;
        storage::inspect(&mut storage)
            .map_err(|error| Failure::attempt(Stage::AttemptSnapshot, error))?
            .token()
    };
    coordinator::reopen_native_observed(dir, token)
}

/// Mint the one-time pairing secret and its pinned genesis record. Random
/// installation, intent, item and secret material is produced here once; the
/// record stores only commitments and pins, never a secret preimage.
pub(super) fn mint(now_ms: u64) -> Result<(SecretRecord, Record)> {
    let mut installation_id = [0u8; 32];
    let mut intent_id = [0u8; 32];
    let mut pairing_item_id = [0u8; 32];
    let mut namespace_item_id = [0u8; 32];
    let mut poll_secret = [0u8; 32];
    let mut upload_secret = [0u8; 32];
    for bytes in [
        &mut installation_id,
        &mut intent_id,
        &mut pairing_item_id,
        &mut namespace_item_id,
        &mut poll_secret,
        &mut upload_secret,
    ] {
        getrandom::fill(bytes).map_err(|_| Error::StorageUnavailable)?;
    }
    let reference = CredentialRef::new(installation_id, pairing_item_id, Purpose::Pairing)
        .map_err(|_| Error::Custody)?;
    let secret = SecretRecord::pairing(
        reference,
        intent_id,
        CustodySecret32::new(poll_secret).map_err(|_| Error::Custody)?,
        CustodySecret32::new(upload_secret).map_err(|_| Error::Custody)?,
    )
    .map_err(|_| Error::Custody)?;
    let intent = RecordIntent::from_record(&secret);
    let pairing = Pin::from_intent(&intent)?;
    let (poll_secret32, upload_secret32) = secret
        .with_pairing_secrets(|poll, upload| {
            (
                contract::Secret32::from_bytes(*poll),
                contract::Secret32::from_bytes(*upload),
            )
        })
        .map_err(|_| Error::Custody)?;
    let (poll_commitment, upload_commitment) = contract::pairing_commitments(
        &intent_id,
        &poll_secret32.ok_or(Error::Custody)?,
        &upload_secret32.ok_or(Error::Custody)?,
    );
    Ok((
        secret,
        Record {
            revision: 0,
            installation_id,
            intent_id,
            pairing,
            namespace_item_id,
            poll_commitment: Commitment::new(poll_commitment)?,
            upload_commitment: Commitment::new(upload_commitment)?,
            progress: Progress::PairingPlanned,
            initialized_expires_at_ms: None,
            last_pairing: None,
            account_choice: AccountChoice::Unchosen,
            reservation: None,
            enrollment: None,
            namespace: None,
            flight: None,
            flights_started: 0,
            last_failure: None,
            clock_floor_ms: now_ms,
        },
    ))
}

/// Create the private anchor directory for a fresh enrollment. The mode is
/// user-only before any storage constructor sees the path; an existing or
/// non-directory path is left untouched and fails closed in the anchor check.
fn create_anchor_dir(dir: &Path) -> Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
        .map_err(|_| Error::StorageUnavailable)
}

/// Resolve the pairing secret for a fresh or resumed run. A pre-existing anchor
/// is only ever reopened and inspected — never recreated, adopted or repaired —
/// and the retained secret is reloaded from custody by its pinned identity.
/// When the anchor does not exist yet, this mints the genesis record, installs
/// the pairing secret into custody and returns the still-live secret.
fn begin(dir: &Path, io: Io) -> Result<SecretRecord> {
    if std::fs::symlink_metadata(dir).is_ok_and(|meta| meta.is_dir()) {
        let token = {
            let mut storage = MacStorage::open_existing(dir)?;
            storage::inspect(&mut storage)
                .map_err(|error| match error {
                    // An anchor without a committed record is an interrupted
                    // initialization; there is no retained secret to resume from.
                    Error::Missing => Error::RecoveryRequired,
                    other => other,
                })?
                .token()
        };
        let mut native = coordinator::reopen_native(dir, token)?;
        return native
            .vault
            .read_exact(&native.attempt.record().pairing.identity)
            .map_err(|_| Error::RecoveryRequired);
    }
    create_anchor_dir(dir)?;
    let (secret, record) = mint(io.now_ms())?;
    let mut native = coordinator::initialize_native(dir, &record)?;
    native.complete_pairing(&secret, io.now_ms())?;
    Ok(secret)
}

/// Map a settled domain refusal to a fixed local error. The durable record
/// already retains the exact failure fact; this only classifies the cause for
/// the caller without re-reading secret or wire material.
pub(super) fn domain_failure(error: contract::DomainError) -> Error {
    match error {
        contract::DomainError::Throttled | contract::DomainError::Unavailable => Error::Busy,
        contract::DomainError::ClockRegressed => Error::ClockRegressed,
        contract::DomainError::StorageUnavailable | contract::DomainError::StorageInvalid => {
            Error::StorageUnavailable
        }
        contract::DomainError::Unauthorized | contract::DomainError::AuthenticationNotFresh => {
            Error::Custody
        }
        contract::DomainError::Expired
        | contract::DomainError::Conflict
        | contract::DomainError::InvalidTransition
        | contract::DomainError::Revoked => Error::Conflict,
        contract::DomainError::RecoveryRequired => Error::RecoveryRequired,
        _ => Error::OutcomeUnknown,
    }
}

/// Unwrap a settled exchange into its success payload or map a domain refusal.
pub(super) fn domain(result: DomainResult) -> Result<Success> {
    result.map_err(domain_failure)
}

/// Require the settled response to carry the success shape for `operation`. The
/// transport/sequencer already binds the response to the request; this is a
/// final fixed-shape check before the driver advances its own state.
pub(super) fn expect(result: DomainResult, operation: Operation) -> Result<()> {
    let success = domain(result)?;
    let matches = matches!(
        (&success, operation),
        (Success::Initialized { .. }, Operation::Initialize)
            | (Success::Reserved(_), Operation::Reserve)
            | (Success::Enrolled { .. }, Operation::Enroll)
            | (Success::Namespace { .. }, Operation::Namespace)
            | (Success::Pairing(_), Operation::Poll | Operation::Confirm)
    );
    matches.then_some(()).ok_or(Error::OutcomeUnknown)
}

/// Present the pairing URL once, then poll until the browser approves, denies
/// or the intent expires. Each poll is a separate exchange paced by the
/// server's `poll_after_ms`; the approved account is then chosen once and the
/// single confirmation exchange runs. An uncertain poll transport outcome is
/// the one recoverable refusal: the attempt already durably abandoned that
/// read-only flight, so the loop waits the server's throttle interval and
/// polls again within the same `MAX_PAIRING_POLLS` bound — an explicit
/// recovery, never an implicit transport retry.
pub(super) fn handshake(ops: &mut impl AttemptOps, io: Io) -> Result<()> {
    let url = coordinator::pairing_url(&ops.intent_id()?);
    io.pairing_url(&url);
    let mut polls = 0u32;
    let account = loop {
        if let Some(account) = ops.chosen_account()? {
            break account;
        }
        polls = polls.checked_add(1).ok_or(Error::Limit)?;
        if polls > MAX_PAIRING_POLLS {
            return Err(Error::Limit);
        }
        let result = match ops.exchange(Operation::Poll, None, io) {
            Ok(result) => result,
            Err(Error::OutcomeUnknown) => {
                io.wait_ms(contract::POLL_MS);
                continue;
            }
            Err(error) => return Err(error),
        };
        match domain(result)? {
            Success::Pairing(view) => match view.state {
                PairingState::BrowserApproved | PairingState::TerminalConfirmed => {
                    break view.approved_account_id.ok_or(Error::OutcomeUnknown)?;
                }
                PairingState::Pending => io.wait_ms(view.poll_after_ms.max(1_000)),
                PairingState::Denied | PairingState::Expired => return Err(Error::Conflict),
            },
            _ => return Err(Error::OutcomeUnknown),
        }
    };
    if ops.chosen_account()?.is_none() {
        ops.choose(account, io.now_ms())?;
    }
    expect(
        ops.exchange(Operation::Confirm, Some(account), io)?,
        Operation::Confirm,
    )
}

/// Drive the durable progress forward until the namespace is custody-verified.
/// Every iteration rereads progress, so an interrupted run resumes at exactly
/// the step it reached. Progress states that cannot be driven forward fail
/// closed rather than guessing at a recovery.
pub(super) fn drive(ops: &mut impl AttemptOps, io: Io) -> Result<EnrollOutcome> {
    loop {
        match ops.progress()? {
            Progress::PairingCustodyVerified => {
                expect(
                    ops.exchange(Operation::Initialize, None, io)?,
                    Operation::Initialize,
                )?;
                io.step("initialized");
            }
            Progress::Initialized => {
                handshake(ops, io)?;
                io.step("confirmed");
            }
            Progress::Confirmed => {
                expect(
                    ops.exchange(Operation::Reserve, None, io)?,
                    Operation::Reserve,
                )?;
                io.step("reserved");
            }
            Progress::Reserved => {
                expect(
                    ops.exchange(Operation::Enroll, None, io)?,
                    Operation::Enroll,
                )?;
                io.step("enrolled");
            }
            Progress::Enrolled => {
                expect(
                    ops.exchange(Operation::Namespace, None, io)?,
                    Operation::Namespace,
                )?;
                io.step("namespace");
            }
            Progress::PairingPrepared => {
                ops.reconcile_pairing()?;
                io.step("pairing-reconciled");
            }
            Progress::NamespaceCustodyVerified => return ops.outcome(),
            // PairingPlanned means the original secret never reached custody and
            // cannot be resumed; a dispatched flight or an unfinished namespace
            // custody handoff needs an explicit named reconciliation, never an
            // implicit retry.
            Progress::PairingPlanned | Progress::NamespacePlanned | Progress::NamespacePrepared => {
                return Err(Error::RecoveryRequired);
            }
        }
    }
}

/// The real macOS backing for [`AttemptOps`]. Every method reopens the durable
/// attempt, performs exactly one locked effect and releases it; custody and the
/// once-only transport are owned inside `exchange_once`.
struct MacOps<'a> {
    dir: &'a Path,
    secret: &'a SecretRecord,
}

impl AttemptOps for MacOps<'_> {
    fn progress(&mut self) -> Result<Progress> {
        Ok(reopen(self.dir)?.attempt.record().progress)
    }
    fn intent_id(&mut self) -> Result<[u8; 32]> {
        Ok(reopen(self.dir)?.attempt.record().intent_id)
    }
    fn chosen_account(&mut self) -> Result<Option<[u8; 16]>> {
        Ok(reopen(self.dir)?.attempt.record().account_choice.account())
    }
    fn exchange(
        &mut self,
        operation: Operation,
        account_id: Option<[u8; 16]>,
        io: Io,
    ) -> Result<DomainResult> {
        let native = reopen(self.dir)?;
        let record = native.attempt.record().clone();
        let (request, context) = coordinator::request_for_operation(
            &record,
            self.secret,
            operation,
            account_id,
            io.now_ms(),
        )?;
        let accepted: AcceptedEnrollment = native
            .exchange_once(&request, &context, self.secret, io.now_ms(), io.now_ms())
            .map_err(|failure| failure.error)?;
        Ok(accepted.result)
    }
    fn choose(&mut self, account_id: [u8; 16], now_ms: u64) -> Result<()> {
        let native = reopen(self.dir)?;
        let NativeEnrollment {
            attempt,
            references,
            vault,
        } = native;
        let attempt = coordinator::choose_account(attempt, account_id, now_ms)?;
        drop(NativeEnrollment {
            attempt,
            references,
            vault,
        });
        Ok(())
    }
    fn reconcile_pairing(&mut self) -> Result<()> {
        let native = reopen(self.dir)?;
        let NativeEnrollment {
            attempt,
            mut references,
            mut vault,
        } = native;
        let mut custody = SealedCustody {
            references: &mut references,
            vault: &mut vault,
            pairing_token: None,
        };
        attempt.reconcile_pairing(self.secret, &mut custody)
    }
    fn outcome(&mut self) -> Result<EnrollOutcome> {
        let record = reopen(self.dir)?.attempt.record().clone();
        let enrollment = record.enrollment.as_ref().ok_or(Error::OutcomeUnknown)?;
        Ok(EnrollOutcome {
            account_id: enrollment.receipt.account_id,
            device_id: enrollment.receipt.device_id,
            namespace_item_id: record.namespace_item_id,
        })
    }
}

/// Enroll this installation against `usage.aicharts.io`. Resolves or creates the
/// per-user anchor and the retained pairing secret, then drives the once-only
/// handshake to a custody-verified namespace. Returns only nonsecret outcome
/// facts; a refusal leaves durable recovery state and never remints or retries.
pub(crate) fn enroll(dir: &Path, io: Io) -> Result<EnrollOutcome> {
    let secret = begin(dir, io)?;
    let mut ops = MacOps {
        dir,
        secret: &secret,
    };
    drive(&mut ops, io)
}

/// Nonsecret sender binding facts from one completed enrollment record. The
/// durable decode only proves canonical shape, so semantic validation reruns
/// here: terminal progress with no retained flight, an active device receipt
/// and the full reservation/namespace chain are all required before any
/// custody read; anything else refuses closed.
pub(super) fn binding_facts(record: &Record) -> Result<([u8; 16], [u8; 32], [u8; 32])> {
    super::record::validate(record)?;
    if record.progress != Progress::NamespaceCustodyVerified || record.flight.is_some() {
        return Err(Error::RecoveryRequired);
    }
    let enrollment = record.enrollment.as_ref().ok_or(Error::RecoveryRequired)?;
    if enrollment.device_state != contract::DeviceState::Active {
        return Err(Error::Conflict);
    }
    let reservation = record.reservation.as_ref().ok_or(Error::RecoveryRequired)?;
    record.namespace.as_ref().ok_or(Error::RecoveryRequired)?;
    Ok((
        enrollment.receipt.account_id,
        enrollment.receipt.device_id,
        reservation.recovery_generation,
    ))
}

/// The resolved custody record must reproduce the pinned identity and
/// high-entropy commitment — the exact retained secret, never a substitute
/// that merely shares a keychain label.
fn exact_secret(
    secret: &SecretRecord,
    pin: &Pin,
    stage: Stage,
) -> std::result::Result<(), Failure> {
    let intent = RecordIntent::from_record(secret);
    if intent.identity() != &pin.identity {
        return Err(Failure::custody(
            stage,
            aicharts_custody::Error::Conflict,
            Error::Custody,
        ));
    }
    (intent.commitment() == pin.commitment.as_bytes())
        .then_some(())
        .ok_or_else(|| Failure::commitment(stage))
}

/// Reopen this installation's enrolled authority for one upload: durable
/// binding facts plus the exact retained pairing and namespace records.
/// Secret preimages stay borrow-only inside the returned records; nothing is
/// persisted, reminted, repaired or substituted. A missing, unfinished,
/// revoked or inconsistent anchor refuses before any secret is copied.
pub(crate) fn enrolled(dir: &Path) -> Result<EnrolledInstallation> {
    enrolled_observed(dir).map_err(|failure| failure.error)
}

pub(in crate::enrollment) fn enrolled_observed(
    dir: &Path,
) -> std::result::Result<EnrolledInstallation, Failure> {
    let mut native = reopen_observed(dir)?;
    enrolled_credentials(native.attempt.record(), |identity| {
        native.vault.read_exact(identity)
    })
}

/// The production read uses this exact sequence. Tests script only the two
/// existing vault reads; the seam cannot add, recover, enroll or dispatch.
pub(super) fn enrolled_credentials(
    record: &Record,
    mut read: impl FnMut(&aicharts_custody::RecordIdentity) -> aicharts_custody::Result<SecretRecord>,
) -> std::result::Result<EnrolledInstallation, Failure> {
    let (account_id, device_id, recovery_generation) =
        binding_facts(record).map_err(|error| Failure::attempt(Stage::Binding, error))?;
    let pairing = read(&record.pairing.identity)
        .map_err(|error| Failure::custody(Stage::PairingRead, error, Error::RecoveryRequired))?;
    exact_secret(&pairing, &record.pairing, Stage::PairingCommitment)?;
    let namespace_pin = &record
        .namespace
        .as_ref()
        .ok_or_else(|| Failure::attempt(Stage::Binding, Error::RecoveryRequired))?
        .pin;
    let namespace = read(&namespace_pin.identity)
        .map_err(|error| Failure::custody(Stage::NamespaceRead, error, Error::RecoveryRequired))?;
    exact_secret(&namespace, namespace_pin, Stage::NamespaceCommitment)?;
    Ok(EnrolledInstallation {
        account_id,
        device_id,
        recovery_generation,
        pairing,
        namespace,
    })
}
