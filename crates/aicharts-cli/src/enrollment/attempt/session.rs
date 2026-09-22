//! Private held-attempt session.
//!
//! A session owns one attempt storage value and its lock for the synchronous
//! portion of an operation.  It is intentionally not reachable from the CLI:
//! callers must drop it before browser/user waits; a synchronous bounded HTTP
//! exchange may use a session only when no reference/vault lock is held.

use super::{
    record::{Record, Token},
    storage::{self, Storage},
    Error, Result, MAX_DISPATCHES,
};
use crate::enrollment::{
    contract::{Context, DomainResult, Operation, Request},
    https::{AcceptedEnrollment, HttpsEnrollment, TransportError},
};
use aicharts_custody::{references::RecordIntent, SecretRecord};
#[cfg(target_os = "macos")]
use aicharts_custody::{
    references::{ReferenceState, ReferenceStore},
    Vault,
};

#[cfg(target_os = "macos")]
fn custody_error(error: aicharts_custody::references::Error) -> Error {
    use aicharts_custody::references::Error as E;
    match error {
        E::OutcomeUnknown | E::StorageUnavailable => Error::OutcomeUnknown,
        E::RecoveryRequired => Error::RecoveryRequired,
        E::Busy => Error::Busy,
        _ => Error::Custody,
    }
}

/// Sealed adapter for the real reference manifest and vault. Each call uses
/// the custody crate's own short lock/lazy-vault session and returns before
/// HTTPS; it never wraps those calls in an outer vault session.
#[cfg(target_os = "macos")]
pub(super) struct SealedCustody<'a> {
    pub(super) references: &'a mut ReferenceStore,
    pub(super) vault: &'a mut Vault,
    /// Token observed by the first proof. A second proof in one operation must
    /// see the same manifest after any explicit prepared-state reconciliation.
    pub(super) pairing_token: Option<aicharts_custody::references::ManifestToken>,
}

#[cfg(target_os = "macos")]
impl CustodyPort for SealedCustody<'_> {
    fn install_pairing(&mut self, _record: &Record, secret: &SecretRecord) -> Result<()> {
        let manifest = self.references.snapshot().map_err(custody_error)?;
        let prepared = self
            .references
            .prepare(&manifest.token(), secret)
            .map_err(custody_error)?;
        let installed = self
            .references
            .install_prepared(&prepared.token(), secret, self.vault)
            .map_err(custody_error)?;
        let resolved = self
            .references
            .resolve_verified(&installed.token(), secret.identity(), self.vault)
            .map_err(custody_error)?;
        (RecordIntent::from_record(&resolved) == RecordIntent::from_record(secret))
            .then_some(())
            .ok_or(Error::Custody)
    }

    fn verify_pairing(&mut self, record: &Record, secret: &SecretRecord) -> Result<()> {
        let intent = RecordIntent::from_record(secret);
        if intent.identity() != &record.pairing.identity
            || intent.commitment() != record.pairing.commitment.as_bytes()
        {
            return Err(Error::Custody);
        }
        let manifest = self.references.snapshot().map_err(custody_error)?;
        let entry = manifest
            .entries()
            .iter()
            .find(|entry| entry.intent().identity() == secret.identity())
            .ok_or(Error::RecoveryRequired)?;
        if entry.intent() != &intent {
            return Err(Error::Custody);
        }
        let mut token = manifest.token();
        if self.pairing_token.is_some_and(|expected| expected != token) {
            return Err(Error::Custody);
        }
        if entry.state() == ReferenceState::Prepared {
            let reconciled = self
                .references
                .reconcile_prepared(&token, secret.identity(), self.vault)
                .map_err(custody_error)?;
            token = reconciled.token();
        }
        let resolved = self
            .references
            .resolve_verified(&token, secret.identity(), self.vault)
            .map_err(custody_error)?;
        if RecordIntent::from_record(&resolved) != intent {
            return Err(Error::Custody);
        }
        self.pairing_token = Some(token);
        Ok(())
    }

    fn install_namespace(&mut self, _record: &Record, secret: &SecretRecord) -> Result<()> {
        let manifest = self.references.snapshot().map_err(custody_error)?;
        let prepared = self
            .references
            .prepare(&manifest.token(), secret)
            .map_err(custody_error)?;
        self.references
            .install_prepared(&prepared.token(), secret, self.vault)
            .map_err(custody_error)?;
        Ok(())
    }

    fn reconcile_namespace(&mut self, _record: &Record, secret: &SecretRecord) -> Result<()> {
        let expected_intent = RecordIntent::from_record(secret);
        let manifest = self.references.snapshot().map_err(custody_error)?;
        let entry = manifest
            .entries()
            .iter()
            .find(|entry| entry.intent().identity() == secret.identity())
            .ok_or(Error::RecoveryRequired)?;
        if entry.intent() != &expected_intent {
            return Err(Error::Custody);
        }
        let mut token = manifest.token();
        if entry.state() == ReferenceState::Prepared {
            token = self
                .references
                .reconcile_prepared(&token, secret.identity(), self.vault)
                .map_err(custody_error)?
                .token();
        }
        let resolved = self
            .references
            .resolve_verified(&token, secret.identity(), self.vault)
            .map_err(custody_error)?;
        (RecordIntent::from_record(&resolved) == expected_intent)
            .then_some(())
            .ok_or(Error::Custody)
    }
}

/// Ports are private and intentionally operation-scoped. Implementations must
/// release reference/vault locks before returning so HTTP never nests custody.
pub(super) trait CustodyPort {
    fn install_pairing(&mut self, record: &Record, secret: &SecretRecord) -> Result<()>;
    fn verify_pairing(&mut self, record: &Record, secret: &SecretRecord) -> Result<()>;
    fn install_namespace(&mut self, record: &Record, secret: &SecretRecord) -> Result<()>;
    fn reconcile_namespace(&mut self, record: &Record, secret: &SecretRecord) -> Result<()>;
}

pub(super) trait ExchangePort {
    fn exchange(
        &mut self,
        request: &Request,
        context: &Context,
        floor_ms: u64,
    ) -> std::result::Result<AcceptedEnrollment, TransportError>;
}

impl ExchangePort for HttpsEnrollment {
    fn exchange(
        &mut self,
        request: &Request,
        context: &Context,
        floor_ms: u64,
    ) -> std::result::Result<AcceptedEnrollment, TransportError> {
        self.exchange_once_with_floor(request, context, floor_ms)
    }
}

pub(super) struct OperationFailure {
    pub(super) error: Error,
    pub(super) namespace_secret: Option<SecretRecord>,
    pub(super) transport: Option<TransportError>,
}

/// One durable attempt observation held under one storage lock.
pub(super) struct HeldAttempt<S: Storage> {
    storage: S,
    current: Record,
    token: Token,
    valid: bool,
}

impl<S: Storage> HeldAttempt<S> {
    /// Lock and durably reconcile the expected predecessor before any caller
    /// can perform a subsequent effect. A failed open releases the lock.
    pub(super) fn open(mut storage: S, expected: Token) -> Result<Self> {
        storage.lock()?;
        match storage::read_durable_unlocked(&mut storage, expected) {
            Ok(snapshot) => Ok(Self {
                storage,
                current: snapshot.record().clone(),
                token: snapshot.token(),
                valid: true,
            }),
            Err(error) => {
                storage.unlock();
                Err(error)
            }
        }
    }

    pub(super) fn record(&self) -> &Record {
        &self.current
    }

    pub(super) fn token(&self) -> Token {
        self.token
    }

    pub(super) fn is_valid(&self) -> bool {
        self.valid
    }

    /// Mark the session unusable after an uncertain storage boundary. The
    /// lock remains held until `Drop`; no further effects are permitted.
    pub(super) fn invalidate(&mut self) {
        self.valid = false;
    }

    fn usable(&self) -> Result<()> {
        self.valid.then_some(()).ok_or(Error::RecoveryRequired)
    }

    /// Reestablish durability and replace the held observation while retaining
    /// the same lock. This is the only refresh operation available to callers.
    pub(super) fn refresh_durable(&mut self) -> Result<()> {
        self.usable()?;
        let result = storage::read_durable_unlocked(&mut self.storage, self.token);
        match result {
            Ok(snapshot) => {
                self.current = snapshot.record().clone();
                self.token = snapshot.token();
                Ok(())
            }
            Err(error) => {
                self.invalidate();
                Err(error)
            }
        }
    }

    /// Durably transition a newly initialized attempt through pairing custody
    /// while retaining the same attempt lock. The sealed verifier performs
    /// its own short reference/vault session; no outer vault guard is held.
    pub(super) fn complete_pairing<C: CustodyPort>(
        &mut self,
        secret: &SecretRecord,
        custody: &mut C,
        observed_at_ms: u64,
    ) -> Result<()> {
        self.usable()?;
        if self.current.progress != super::record::Progress::PairingPlanned
            || self.current.flight.is_some()
        {
            return Err(Error::Conflict);
        }
        if observed_at_ms < self.current.clock_floor_ms
            || observed_at_ms > crate::enrollment::contract::MAX_TIME_MS
        {
            return Err(Error::ClockRegressed);
        }
        let intent = aicharts_custody::references::RecordIntent::from_record(secret);
        if intent.identity() != &self.current.pairing.identity
            || intent.commitment() != self.current.pairing.commitment.as_bytes()
        {
            return Err(Error::Custody);
        }
        let mut prepared = self.current.clone();
        prepared.revision = prepared.revision.checked_add(1).ok_or(Error::Limit)?;
        prepared.clock_floor_ms = observed_at_ms;
        prepared.progress = super::record::Progress::PairingPrepared;
        prepared.last_failure = None;
        self.publish(&prepared)?;
        let mut verified = self.current.clone();
        verified.revision = verified.revision.checked_add(1).ok_or(Error::Limit)?;
        verified.progress = super::record::Progress::PairingCustodyVerified;
        verified.last_failure = None;
        // Validate the complete successor before crossing the external
        // custody boundary; malformed state must produce zero vault effects.
        super::record::successor(&prepared, &verified)?;
        if let Err(error) = custody.install_pairing(self.record(), secret) {
            self.invalidate();
            return Err(error);
        }
        self.publish(&verified)
    }

    /// Recover a pairing whose durable state is already PairingPrepared after
    /// an interrupted custody write. The original secret is required; no
    /// insertion or reminting is attempted, and the verifier must prove the
    /// exact existing entry before the final transition.
    pub(super) fn reconcile_pairing<C: CustodyPort>(
        mut self,
        secret: &SecretRecord,
        custody: &mut C,
    ) -> Result<()> {
        self.usable()?;
        if self.current.progress != super::record::Progress::PairingPrepared
            || self.current.flight.is_some()
        {
            return Err(Error::RecoveryRequired);
        }
        let intent = aicharts_custody::references::RecordIntent::from_record(secret);
        if intent.identity() != &self.current.pairing.identity
            || intent.commitment() != self.current.pairing.commitment.as_bytes()
        {
            return Err(Error::Custody);
        }
        let mut verified = self.current.clone();
        verified.revision = verified.revision.checked_add(1).ok_or(Error::Limit)?;
        verified.progress = super::record::Progress::PairingCustodyVerified;
        verified.last_failure = None;
        super::record::successor(&self.current, &verified)?;
        if let Err(error) = custody.verify_pairing(self.record(), secret) {
            self.invalidate();
            return Err(error);
        }
        self.publish(&verified)
    }

    /// Record one explicit account choice under the held lock. The caller
    /// must provide the fresh browser-approved account; choices are sticky and
    /// cannot be replaced while a flight or confirmation is in progress.
    pub(super) fn choose_account(&mut self, account_id: [u8; 16], chosen_at_ms: u64) -> Result<()> {
        self.usable()?;
        if self.current.progress != super::record::Progress::Initialized
            || self.current.flight.is_some()
            || self.current.account_choice != super::record::AccountChoice::Unchosen
            || account_id.iter().all(|byte| *byte == 0)
        {
            return Err(Error::Conflict);
        }
        if chosen_at_ms < self.current.clock_floor_ms
            || chosen_at_ms > crate::enrollment::contract::MAX_TIME_MS
        {
            return Err(Error::ClockRegressed);
        }
        if chosen_at_ms
            >= self
                .current
                .initialized_expires_at_ms
                .ok_or(Error::Conflict)?
        {
            return Err(Error::InvalidSuccessor);
        }
        let mut next = self.current.clone();
        next.revision = next.revision.checked_add(1).ok_or(Error::Limit)?;
        next.clock_floor_ms = chosen_at_ms;
        next.account_choice = super::record::AccountChoice::Chosen {
            account_id,
            chosen_at_ms,
        };
        next.last_failure = None;
        super::record::successor(&self.current, &next)?;
        self.publish(&next)
    }

    /// Publish one exact successor under the already-held lock. Successful
    /// publication advances the session token; uncertain publication poisons
    /// the session so the caller cannot dispatch again.
    pub(super) fn publish(&mut self, next: &Record) -> Result<()> {
        self.usable()?;
        let result = storage::compare_and_publish_unlocked(&mut self.storage, self.token, next);
        match result {
            Ok(snapshot) => {
                self.current = snapshot.record().clone();
                self.token = snapshot.token();
                Ok(())
            }
            Err(error) => {
                if matches!(
                    error,
                    Error::OutcomeUnknown
                        | Error::StorageUnavailable
                        | Error::RecoveryRequired
                        | Error::StaleSnapshot
                ) {
                    self.invalidate();
                }
                Err(error)
            }
        }
    }

    /// Run one bounded HTTPS exchange while retaining the attempt lock. The
    /// caller must have released all reference/vault locks first; browser and
    /// user waits are never performed through this method.
    pub(super) fn exchange_once(
        &mut self,
        transport: &mut HttpsEnrollment,
        request: &Request,
        context: &Context,
    ) -> std::result::Result<AcceptedEnrollment, TransportError> {
        if !self.valid {
            return Err(TransportError::Unavailable);
        }
        transport.exchange_once_with_floor(request, context, self.current.clock_floor_ms)
    }

    pub(super) fn prepare_flight(
        &mut self,
        request: &Request,
        context: &Context,
        prepared_at_ms: u64,
    ) -> Result<()> {
        self.usable()?;
        let next = super::sequencer::prepare_flight_record(
            self.token,
            &self.current,
            request,
            context,
            prepared_at_ms,
        )?;
        self.publish(&next)
    }

    pub(super) fn dispatch_flight(
        &mut self,
        request: &Request,
        context: &Context,
        attempted_at_ms: u64,
    ) -> Result<()> {
        self.usable()?;
        let next = super::sequencer::dispatch_flight_record(
            self.token,
            &self.current,
            request,
            context,
            attempted_at_ms,
        )?;
        self.publish(&next)
    }

    pub(super) fn settle_response(
        &mut self,
        request: &Request,
        context: &Context,
        observed_at_ms: u64,
        result: &DomainResult,
    ) -> Result<()> {
        self.usable()?;
        let next = super::sequencer::settle_response_record(
            self.token,
            &self.current,
            request,
            context,
            observed_at_ms,
            result,
        )?;
        self.publish(&next)
    }

    /// Durably abandon a retained dispatched Poll flight under the held lock.
    /// The exchange is a server-side read, so an uncertain outcome has nothing
    /// to reconcile; the loss is a fixed durable fact. Mutating flights are
    /// never abandoned here and still require explicit reconstruction.
    pub(super) fn abandon_poll_flight(&mut self, observed_at_ms: u64) -> Result<()> {
        self.usable()?;
        let next = super::sequencer::abandon_poll_flight_record(
            self.token,
            &self.current,
            observed_at_ms,
        )?;
        self.publish(&next)
    }

    /// Run one complete synchronous operation. Custody verification happens
    /// before flight preparation, custody locks are released, then one bounded
    /// exchange and settlement run under this attempt lock. Namespace key
    /// material is owned before any settlement/publication can fail. A
    /// retained dispatched Poll flight is the single explicit exception: it is
    /// durably abandoned as a server-side read before this call prepares its
    /// own flight, and an uncertain poll exchange abandons its flight the same
    /// way. Every other retained dispatched flight refuses closed.
    #[allow(clippy::result_large_err, clippy::too_many_arguments)]
    pub(super) fn run_operation<C: CustodyPort, X: ExchangePort>(
        mut self,
        request: &Request,
        context: &Context,
        pairing_secret: &SecretRecord,
        custody: &mut C,
        exchange: &mut X,
        prepared_at_ms: u64,
        attempted_at_ms: u64,
        redispatch_delay: std::time::Duration,
    ) -> std::result::Result<AcceptedEnrollment, OperationFailure> {
        let fail = |error| OperationFailure {
            error,
            namespace_secret: None,
            transport: None,
        };
        if !self.valid {
            return Err(fail(Error::RecoveryRequired));
        }
        if self.current.namespace.is_some() {
            return Err(fail(Error::RecoveryRequired));
        }
        let retained = self
            .current
            .flight
            .as_ref()
            .filter(|flight| flight.dispatches > 0)
            .map(|flight| flight.operation);
        if let Some(operation) = retained {
            // A retained dispatched flight requires explicit reconstruction and
            // caller-selected retry policy; this operation never auto-retries.
            // A Poll flight is the sole abandonable case: the exchange is a
            // server-side read, so an outcome lost between dispatch and
            // settlement has nothing to reconcile. The loss is durably
            // recorded before this call prepares its own flight, stamped at
            // prepare time so the new flight's own floor is never regressed.
            if operation != Operation::Poll {
                return Err(fail(Error::RecoveryRequired));
            }
            self.abandon_poll_flight(prepared_at_ms).map_err(fail)?;
        }
        let intent = RecordIntent::from_record(pairing_secret);
        if intent.identity() != &self.current.pairing.identity
            || intent.commitment() != self.current.pairing.commitment.as_bytes()
        {
            return Err(fail(Error::Custody));
        }
        if let Err(error) = custody.verify_pairing(&self.current, pairing_secret) {
            // The sealed adapter may have reconciled a prepared entry or
            // crossed an uncertain vault boundary before returning its generic
            // custody error. Require drop/reopen and explicit reconciliation.
            self.invalidate();
            return Err(fail(error));
        }
        if self.current.flight.is_none() {
            self.prepare_flight(request, context, prepared_at_ms)
                .map_err(fail)?;
        }
        self.dispatch_flight(request, context, attempted_at_ms)
            .map_err(fail)?;
        let accepted = loop {
            match exchange.exchange(request, context, self.current.clock_floor_ms) {
                Ok(accepted) => break accepted,
                Err(transport) => {
                    // An uncertain poll dispatch has nothing to reconcile: the
                    // exchange is a server-side read. Record the loss durably and
                    // abandon the flight so the next paced poll prepares a fresh
                    // one. Mutating operations and other transport failures keep
                    // the retained dispatched flight for explicit reconciliation.
                    if request.operation() == Operation::Poll
                        && transport == TransportError::Uncertain
                    {
                        if let Err(error) = self.abandon_poll_flight(attempted_at_ms) {
                            return Err(OperationFailure {
                                error,
                                namespace_secret: None,
                                transport: Some(transport),
                            });
                        }
                    }
                    // The account mutations commit idempotently by pairing
                    // intent, so an unavailable or uncertain exchange can still
                    // be settling remotely while this retained flight's
                    // request/context digest stays fixed. An explicit
                    // same-flight redispatch inside the bounded dispatch count
                    // is the designed reconciliation — never a retry of new
                    // work.
                    if matches!(
                        request.operation(),
                        Operation::Enroll | Operation::Namespace
                    ) && matches!(
                        transport,
                        TransportError::Uncertain | TransportError::Unavailable
                    ) && self
                        .current
                        .flight
                        .as_ref()
                        .is_some_and(|flight| flight.dispatches < MAX_DISPATCHES)
                    {
                        std::thread::sleep(redispatch_delay);
                        if let Err(error) = self.dispatch_flight(request, context, attempted_at_ms)
                        {
                            return Err(OperationFailure {
                                error,
                                namespace_secret: None,
                                transport: Some(transport),
                            });
                        }
                        continue;
                    }
                    return Err(OperationFailure {
                        error: Error::OutcomeUnknown,
                        namespace_secret: None,
                        transport: Some(transport),
                    });
                }
            }
        };
        let owned_namespace = match &accepted.result {
            Ok(crate::enrollment::contract::Success::Namespace { namespace, .. }) => Some(
                super::sequencer::namespace_secret_record(&self.current, namespace)
                    .map_err(fail)?,
            ),
            _ => None,
        };
        // Revalidate the exact pairing intent after HTTP before accepting any
        // response; the custody port owns and releases its short vault session.
        if let Err(error) = custody.verify_pairing(self.record(), pairing_secret) {
            self.invalidate();
            return Err(OperationFailure {
                error,
                namespace_secret: owned_namespace,
                transport: None,
            });
        }
        if let Err(error) =
            self.settle_response(request, context, accepted.observed_at_ms, &accepted.result)
        {
            return Err(OperationFailure {
                error,
                namespace_secret: owned_namespace,
                transport: None,
            });
        }
        if let Some(secret) = owned_namespace {
            let prepared = match super::sequencer::prepare_namespace_custody_record(
                self.token,
                self.record(),
                &secret,
                accepted.observed_at_ms,
            ) {
                Ok(next) => next,
                Err(error) => {
                    return Err(OperationFailure {
                        error,
                        namespace_secret: Some(secret),
                        transport: None,
                    })
                }
            };
            if let Err(error) = self.publish(&prepared) {
                return Err(OperationFailure {
                    error,
                    namespace_secret: Some(secret),
                    transport: None,
                });
            }
            let verified = match super::sequencer::complete_namespace_custody_record(
                self.token,
                self.record(),
                &secret,
            ) {
                Ok(next) => next,
                Err(error) => {
                    return Err(OperationFailure {
                        error,
                        namespace_secret: Some(secret),
                        transport: None,
                    })
                }
            };
            if let Err(error) = custody.install_namespace(self.record(), &secret) {
                self.invalidate();
                return Err(OperationFailure {
                    error,
                    namespace_secret: Some(secret),
                    transport: None,
                });
            }
            if let Err(error) = self.publish(&verified) {
                return Err(OperationFailure {
                    error,
                    namespace_secret: Some(secret),
                    transport: None,
                });
            }
        }
        Ok(accepted)
    }

    /// Finish a retained namespace flight after restart. This path performs no
    /// HTTPS and never dispatches again: the caller supplies the original
    /// namespace `SecretRecord`, custody is freshly reconciled, and only then
    /// is the retained attempt flight cleared. The caller retains ownership of
    /// that non-Clone secret across every error for explicit retry/recovery.
    #[allow(clippy::result_large_err)]
    pub(super) fn reconcile_namespace<C: CustodyPort>(
        mut self,
        secret: &SecretRecord,
        custody: &mut C,
        prepared_at_ms: u64,
    ) -> std::result::Result<(), OperationFailure> {
        let fail = |error| OperationFailure {
            error,
            namespace_secret: None,
            transport: None,
        };
        let Some(namespace) = self.current.namespace.as_ref() else {
            return Err(fail(Error::RecoveryRequired));
        };
        let intent = RecordIntent::from_record(secret);
        if intent.identity() != &namespace.pin.identity
            || intent.commitment() != namespace.pin.commitment.as_bytes()
        {
            return Err(OperationFailure {
                error: Error::Custody,
                namespace_secret: None,
                transport: None,
            });
        }
        if let Err(error) = self.refresh_durable() {
            return Err(fail(error));
        }
        if self.current.progress == super::record::Progress::NamespaceCustodyVerified {
            if let Err(error) = custody.reconcile_namespace(self.record(), secret) {
                self.invalidate();
                return Err(OperationFailure {
                    error,
                    namespace_secret: None,
                    transport: None,
                });
            }
            if let Err(error) = self.refresh_durable() {
                return Err(OperationFailure {
                    error,
                    namespace_secret: None,
                    transport: None,
                });
            }
            return Ok(());
        }
        if self.current.progress == super::record::Progress::NamespacePlanned {
            let next = match super::sequencer::prepare_namespace_custody_record(
                self.token,
                self.record(),
                secret,
                prepared_at_ms,
            ) {
                Ok(next) => next,
                Err(error) => {
                    return Err(OperationFailure {
                        error,
                        namespace_secret: None,
                        transport: None,
                    })
                }
            };
            if let Err(error) = self.publish(&next) {
                return Err(OperationFailure {
                    error,
                    namespace_secret: None,
                    transport: None,
                });
            }
        }
        let next = match super::sequencer::complete_namespace_custody_record(
            self.token,
            self.record(),
            secret,
        ) {
            Ok(next) => next,
            Err(error) => {
                return Err(OperationFailure {
                    error,
                    namespace_secret: None,
                    transport: None,
                })
            }
        };
        if let Err(error) = custody.reconcile_namespace(self.record(), secret) {
            self.invalidate();
            return Err(OperationFailure {
                error,
                namespace_secret: None,
                transport: None,
            });
        }
        self.publish(&next).map_err(fail)
    }
}

impl<S: Storage> Drop for HeldAttempt<S> {
    fn drop(&mut self) {
        self.storage.unlock();
    }
}
