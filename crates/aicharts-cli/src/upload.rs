//! Dormant one-flight orchestration. There is no enabled CLI upload command or
//! enrolled transport constructor. The ledger alone owns sequence, retry and receipt
//! state; this module never migrates, rebases or clears an uncertain flight.
#![cfg_attr(not(all(test, unix)), allow(dead_code))]

use aicharts_ledger::{BatchSettlement, FrozenBatch, Ledger, SenderBinding};
use aicharts_protocol::{admission as wire, Id, Policy, Registry};
use std::fmt;

mod https;

/// Only a future reviewed adapter inside this module may implement the port.
/// An injected ordinary callback or a file containing valid bytes is not receipt
/// authority. The HTTPS implementation has no enrolled production constructor.
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

#[cfg(all(test, unix))]
#[path = "upload_tests.rs"]
mod tests;
