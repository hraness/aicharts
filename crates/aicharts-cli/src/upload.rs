//! One-flight orchestration and the enrolled `aicharts upload` command. The
//! command joins durable enrollment facts, custody-held secrets and the
//! split-key ledger, then sends at most one bounded frozen batch. The ledger
//! alone owns sequence, retry and receipt state; this module never rebases or
//! clears an uncertain flight and never replays a retained one speculatively.
//! A definitely-refused exchange (an explicit 503 reply) may replay the
//! identical retained bytes in place, bounded by `MAX_UNAVAILABLE_REPLAYS`.
#![cfg_attr(not(all(test, unix)), allow(dead_code))]

use aicharts_ledger::{BatchSettlement, FrozenBatch, Ledger, SenderBinding};
use aicharts_protocol::{admission as wire, Id, Policy, Registry};
use std::fmt;
use std::path::{Path, PathBuf};

mod https;

/// Only a reviewed adapter inside this module may implement the port. An
/// injected ordinary callback or a file containing valid bytes is not receipt
/// authority. The HTTPS implementation's sole production constructor is the
/// enrolled custody join in this module's command path.
mod trusted {
    pub trait Sealed {}
}

/// The adapter owns an enrolled upload capability for this exact binding. It
/// receives numeric bytes only, with no ledger, source path, namespace key or
/// polling secret. A successful return attests the entire response came from the
/// fixed authenticated service and passed transport status/framing/EOF checks.
///
/// This synchronous seam makes one HTTP exchange, without an HTTP worker or retry.
/// The HTTPS adapter separately bounds DNS, connection, TLS, reads and cleanup;
/// its sole possible background task is one process-wide OS DNS lookup, whose
/// permit remains held until the OS returns even after the caller times out.
/// Its monotonic deadline refuses late success; blocking OS/TLS operations are
/// not preemptible and may return later than their configured timeout.
/// Neither a borrowed buffer nor an error can cancel an already committed remote
/// decision, and this module makes no wall-clock or generic cancellation claim.
pub(super) trait AuthenticatedTransport: trusted::Sealed {
    fn binding(&self) -> SenderBinding;

    fn exchange(
        &mut self,
        request: &UploadRequest,
        journal: &mut JournalBody,
    ) -> Result<(), TransportError>;
}

/// Owned ledger bytes, constructed only after the durable freeze/read completes.
/// No Debug or serialization projection accidentally exposes payloads.
pub(super) struct UploadRequest {
    binding: SenderBinding,
    frozen: FrozenBatch,
}

impl UploadRequest {
    pub(super) fn binding(&self) -> SenderBinding {
        self.binding
    }

    pub(super) fn canonical_batch(&self) -> &[u8] {
        &self.frozen.canonical_batch
    }

    pub(super) fn batch_hash(&self) -> &[u8; 32] {
        &self.frozen.batch_hash
    }
}

/// The transport can append at most the protocol ceiling, including when it
/// ignores an earlier append error. Ownership ends with this exchange; only the
/// ledger may retain an authenticated, validated terminal result.
pub(super) struct JournalBody {
    bytes: Vec<u8>,
    refused: bool,
}

impl JournalBody {
    fn new() -> Self {
        Self {
            bytes: Vec::with_capacity(wire::MAX_JOURNAL_BYTES),
            refused: false,
        }
    }

    pub(super) fn append(&mut self, bytes: &[u8]) -> Result<(), TransportError> {
        if self.refused || bytes.len() > wire::MAX_JOURNAL_BYTES - self.bytes.len() {
            self.refused = true;
            return Err(TransportError::InvalidResponse);
        }
        self.bytes.extend_from_slice(bytes);
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TransportError {
    Unavailable,
    Unauthorized,
    Blocked,
    Uncertain,
    InvalidResponse,
}

impl TransportError {
    pub(super) const fn code(self) -> &'static str {
        match self {
            Self::Unavailable => "upload_transport_unavailable",
            Self::Unauthorized => "upload_transport_unauthorized",
            Self::Blocked => "upload_transport_blocked",
            Self::Uncertain => "upload_transport_uncertain",
            Self::InvalidResponse => "upload_response_rejected",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Error {
    Ledger(aicharts_ledger::Error),
    BindingMismatch,
    NoRetainedBatch,
    Transport(TransportError),
    InvalidResponse,
}

impl Error {
    pub(super) const fn code(self) -> &'static str {
        match self {
            Self::Ledger(error) => error.code(),
            Self::BindingMismatch => "upload_binding_mismatch",
            Self::NoRetainedBatch => "upload_no_retained_batch",
            Self::Transport(error) => error.code(),
            Self::InvalidResponse => "upload_response_rejected",
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for Error {}

impl From<aicharts_ledger::Error> for Error {
    fn from(error: aicharts_ledger::Error) -> Self {
        Self::Ledger(error)
    }
}

pub(super) enum Selection<'a> {
    /// Existing-only replay; an absent flight never selects pending work.
    Resume,
    /// Explicit selection. The ledger admits only its exact retained retry or a
    /// new selection at the expected revision. It never substitutes another flight.
    Freeze {
        expected_revision: u64,
        occurrence_ids: &'a [Id],
    },
}

pub(super) fn send_once(
    ledger: &mut Ledger,
    transport: &mut impl AuthenticatedTransport,
    selection: Selection<'_>,
) -> Result<BatchSettlement, Error> {
    let status = ledger.sender_status()?;
    if status.binding != transport.binding() {
        return Err(Error::BindingMismatch);
    }
    if status.device_revoked {
        return Err(aicharts_ledger::Error::DeviceRevoked.into());
    }
    let frozen = match selection {
        Selection::Resume => ledger.inflight_batch()?.ok_or(Error::NoRetainedBatch)?,
        Selection::Freeze {
            expected_revision,
            occurrence_ids,
        } => ledger.freeze_upload_batch(expected_revision, occurrence_ids)?,
    };
    let request = UploadRequest {
        binding: status.binding,
        frozen,
    };
    // This is the existing local numeric v1 ledger policy, not a caller-supplied
    // registry or an enrollment assertion. The ledger already audited these bytes.
    let registry = Registry {
        revision: 1,
        models: vec![],
    };
    let policy = Policy {
        first_day: 0,
        last_day: u32::MAX,
        registry: &registry,
    };
    let batch = wire::decode_batch(request.canonical_batch(), &policy)
        .map_err(|_| Error::Ledger(aicharts_ledger::Error::InvalidState))?;
    let binding = wire::Binding {
        account_id: request.binding.account_id,
        device_id: request.binding.device_id,
        recovery_generation: request.binding.generation,
        namespace_version: 1,
    };
    if batch.binding != binding
        || batch.operations.len() != usize::from(request.frozen.operation_count)
        || batch.operations[0].sequence != request.frozen.first_sequence
        || wire::batch_digest(&batch, &policy).ok().as_ref() != Some(request.batch_hash())
    {
        return Err(Error::Ledger(aicharts_ledger::Error::InvalidState));
    }
    let mut body = JournalBody::new();
    transport
        .exchange(&request, &mut body)
        .map_err(Error::Transport)?;
    if body.refused {
        return Err(Error::InvalidResponse);
    }
    let journal = wire::decode_journal(&body.bytes).map_err(|_| Error::InvalidResponse)?;
    // Correlate to this exchange before calling the ledger: its existing-only
    // AlreadySettled path must not turn an unrelated old reply into send success.
    wire::validate_journal_for_batch(&journal, &batch, &policy)
        .map_err(|_| Error::InvalidResponse)?;
    ledger
        .settle_upload_batch(&body.bytes)
        .map_err(Error::Ledger)
}

/// At most this many in-place replays follow the first exchange, so one
/// command never exceeds `1 + MAX_UNAVAILABLE_REPLAYS` exchanges.
const MAX_UNAVAILABLE_REPLAYS: u8 = 2;
/// Escalating pause multiplier between replays, in seconds.
#[cfg(target_os = "macos")]
const REPLAY_PAUSE: std::time::Duration = std::time::Duration::from_secs(1);

/// One command-level send. The first exchange uses the caller's selection —
/// a fresh `Freeze` or the explicit `Resume` recovery. A `Unavailable` failure
/// means the remote definitely refused or never received the exchange (an
/// explicit 503 reply, or an impossible local budget), so the retained flight
/// may be replayed in place — a `Resume` replay carries byte-identical bytes
/// and can never present a second distinct batch. Every other outcome,
/// including `Uncertain`, returns at once and still demands the explicit
/// recovery step. `pause` receives the 1-based replay ordinal before each
/// replay so tests inject no delay.
fn send_with_replay(
    ledger: &mut Ledger,
    transport: &mut impl AuthenticatedTransport,
    first: Selection<'_>,
    mut pause: impl FnMut(u32),
) -> Result<BatchSettlement, Error> {
    let mut first = Some(first);
    let mut replays = 0u8;
    loop {
        // A transport failure after the freeze leaves the flight retained;
        // every replay selects those exact bytes rather than a fresh selection.
        let selection = first.take().unwrap_or(Selection::Resume);
        match send_once(ledger, transport, selection) {
            Err(Error::Transport(TransportError::Unavailable))
                if replays < MAX_UNAVAILABLE_REPLAYS =>
            {
                replays += 1;
                pause(u32::from(replays));
            }
            result => return result,
        }
    }
}

/// `aicharts upload --state-dir DIR --key-file PATH` options. `--key-file` is
/// the retained local checkpoint key the split-key ledger was bound to; the
/// account occurrence key and upload credential come from custody, never from
/// files or flags.
struct CommandOptions {
    directory: PathBuf,
    key: PathBuf,
    resume: bool,
}

fn parse_options(args: &[String]) -> Result<CommandOptions, &'static str> {
    let (mut directory, mut key, mut resume) = (None, None, false);
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--resume" && !resume {
            resume = true;
            i += 1;
            continue;
        }
        let slot = match args[i].as_str() {
            "--state-dir" if directory.is_none() => &mut directory,
            "--key-file" if key.is_none() => &mut key,
            _ => return Err("invalid_option"),
        };
        i += 1;
        let value = args
            .get(i)
            .filter(|value| !value.is_empty())
            .ok_or("missing_option_value")?;
        *slot = Some(PathBuf::from(value));
        i += 1;
    }
    Ok(CommandOptions {
        directory: directory.ok_or("state_directory_required")?,
        key: key.ok_or("key_required")?,
        resume,
    })
}

/// A retained flight means an earlier exchange had an uncertain outcome. It is
/// never replayed speculatively; an explicit recovery step owns what happens
/// next, so this invocation refuses with a fixed code.
fn refuse_inflight(ledger: &Ledger) -> Result<(), &'static str> {
    if ledger
        .inflight_batch()
        .map_err(|error| error.code())?
        .is_some()
    {
        return Err("upload_recovery_required");
    }
    Ok(())
}

/// Send one bounded batch for this enrolled installation: reopen the completed
/// enrollment facts and custody records, bind the split-key ledger, freeze a
/// pending selection at the wire ceiling, exchange once and settle only on a
/// validated terminal journal. With `resume`, the sole exchange replays the
/// retained flight instead of freezing new work.
#[cfg(target_os = "macos")]
fn send(directory: &Path, key: &Path, resume: bool) -> Result<String, &'static str> {
    let enrolled = crate::enrollment::enrolled(directory).map_err(|code| match code {
        "attempt_missing" => "upload_not_enrolled",
        other => other,
    })?;
    let binding = SenderBinding {
        account_id: enrolled.account_id,
        device_id: enrolled.device_id,
        generation: enrolled.recovery_generation,
        namespace_version: 1,
    };
    let checkpoint = crate::read_key(key)?;
    let upload_secret = enrolled
        .pairing
        .with_pairing_secrets(|_poll, upload| *upload)
        .map_err(|_| "attempt_custody")?;
    let occurrence = enrolled
        .namespace
        .with_namespace_key(|key| *key)
        .map_err(|_| "attempt_custody")?;
    let mut transport =
        https::HttpsTransport::enrolled(binding, &upload_secret).map_err(TransportError::code)?;
    let identity = aicharts_ledger::LedgerIdentity::SplitKeys {
        checkpoint: &checkpoint,
        occurrence: &occurrence,
        namespace_version: 1,
    };
    let revision = Ledger::open_with_identity(directory, &identity)
        .and_then(|ledger| ledger.snapshot().map(|snapshot| snapshot.revision))
        .map_err(|error| error.code())?;
    // The explicit additive migration binds the ledger to this exact enrolled
    // sender on first use; an already-bound different sender refuses.
    let mut ledger = Ledger::migrate_sender_v2(directory, &identity, revision, &binding)
        .map_err(|error| error.code())?;
    let pause = |replay| std::thread::sleep(REPLAY_PAUSE * replay);
    let settlement = if resume {
        // Explicit recovery: re-exchange the exact retained flight. The service
        // admits only its identical bytes, so replay can settle or reconcile but
        // never double-apply.
        send_with_replay(&mut ledger, &mut transport, Selection::Resume, pause)
    } else {
        refuse_inflight(&ledger)?;
        let page = ledger
            .pending(None, aicharts_ledger::MAX_PAGE, None)
            .map_err(|error| error.code())?;
        if page.entries.is_empty() {
            return Ok("No pending usage records; nothing was uploaded.\n".to_owned());
        }
        let ids: Vec<Id> = page.entries.iter().map(|entry| entry.id).collect();
        send_with_replay(
            &mut ledger,
            &mut transport,
            Selection::Freeze {
                expected_revision: page.ledger_revision,
                occurrence_ids: &ids,
            },
            pause,
        )
    }
    .map_err(|error| error.code())?;
    let status = ledger.sender_status().map_err(|error| error.code())?;
    let pending = ledger
        .status()
        .map_err(|error| error.code())?
        .pending_records;
    let batch = ledger
        .last_settled_batch()
        .map_err(|error| error.code())?
        .map(|settled| settled.batch_hash);
    Ok(report(&settlement, &status, pending, batch))
}

/// Non-macOS platforms have no qualified credential custody, so no enrolled
/// upload authority can exist there.
#[cfg(not(target_os = "macos"))]
fn send(_directory: &Path, _key: &Path, _resume: bool) -> Result<String, &'static str> {
    Err("upload_requires_qualified_macos_custody")
}

/// Nonsecret settlement facts only: a fixed outcome word, counts, the settled
/// sequence, remaining pending records and the journal's own batch hash. No
/// secret, path, receipt or response body is projected.
#[cfg(target_os = "macos")]
fn report(
    settlement: &BatchSettlement,
    status: &aicharts_ledger::SenderStatus,
    pending: u64,
    batch: Option<[u8; 32]>,
) -> String {
    let outcome = match *settlement {
        BatchSettlement::Accepted {
            cleared_records,
            retained_newer,
            ..
        } => format!("accepted ({cleared_records} acknowledged, {retained_newer} retained newer)"),
        BatchSettlement::Rejected {
            conflicted_records,
            aborted_records,
            device_revoked,
            ..
        } => format!(
            "rejected ({conflicted_records} conflicted, {aborted_records} aborted, device revoked: {})",
            if device_revoked { "yes" } else { "no" }
        ),
        BatchSettlement::AlreadySettled { .. } => "already settled".to_owned(),
    };
    let mut hash = String::new();
    if let Some(batch) = batch {
        use std::fmt::Write;
        for byte in batch {
            let _ = write!(hash, "{byte:02x}");
        }
    }
    format!(
        "Usage upload completed.\nOutcome: {outcome}\nSettled sequence: {}\nPending records: {pending}\nBatch: {}\n",
        status.settled_sequence,
        if hash.is_empty() { "unavailable" } else { &hash }
    )
}

/// `aicharts upload --state-dir DIR --key-file PATH [--resume]` — one bounded
/// enrolled send; `--resume` performs the explicit retained-flight recovery.
/// `upload --dry-run` remains the separate fresh-source preview and never
/// reaches this command.
pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    let options = parse_options(args)?;
    send(&options.directory, &options.key, options.resume)
}

#[cfg(all(test, unix))]
#[path = "upload_tests.rs"]
mod tests;
