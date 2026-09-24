//! Explicit native V3 outbox and enrolled transport. No automatic activation.
//! Correlation and disk durability are separate from enrolled transport authority.
//! The MAC chain detects divergence from the opened checkpoint, not arbitrary
//! restoration of an older valid directory. Remote sequence/revision checks catch
//! observed rollback; an old checkpoint restored before an uncertain send reached
//! the server needs an independent device/custody fence before operational use.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

mod command;
#[cfg(target_os = "macos")]
mod disk;
#[cfg(target_os = "macos")]
mod https;
#[cfg(test)]
mod tests;
mod wire;

pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    command::run(args)
}

use aicharts_core::contribution_producer::{PreparedBatch, Scope, MAX_BATCH_BYTES};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::path::Path;
use std::time::Instant;

const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;
const MAX_REVISION: u64 = 1_000_000;
const MAX_BODY_BASE64: usize = 1_398_104;
const MAX_TERMINAL_BYTES: usize = 4_096;
const MAX_TERMINAL_BASE64: usize = 5_464;
const MAX_CHECKPOINT_BYTES: usize = 2_818_056;
const INVALID: &str = "contribution_sync_recovery_required";
const CONFLICT: &str = "contribution_sync_progress_conflict";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Binding {
    account_id: String,
    generation: String,
    device_id: String,
}
impl Binding {
    pub(crate) fn new(
        account_id: &str,
        generation: &str,
        device_id: &str,
    ) -> Result<Self, &'static str> {
        Scope::new(account_id, generation, device_id, &format!("{:064x}", 1), 1)
            .map_err(|_| INVALID)?;
        Ok(Self {
            account_id: account_id.into(),
            generation: generation.into(),
            device_id: device_id.into(),
        })
    }
    fn from_scope(scope: &Scope) -> Self {
        Self {
            account_id: scope.account_id().into(),
            generation: scope.generation().into(),
            device_id: scope.device_id().into(),
        }
    }
    fn validate(&self) -> Result<(), &'static str> {
        Self::new(&self.account_id, &self.generation, &self.device_id).map(|_| ())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredScope {
    binding: Binding,
    population_id: String,
    writer_revision: u64,
}
impl StoredScope {
    fn new(scope: &Scope) -> Self {
        Self {
            binding: Binding::from_scope(scope),
            population_id: scope.population_id().into(),
            writer_revision: scope.writer_revision(),
        }
    }
    fn reopen(&self) -> Result<Scope, &'static str> {
        Scope::new(
            &self.binding.account_id,
            &self.binding.generation,
            &self.binding.device_id,
            &self.population_id,
            self.writer_revision,
        )
        .map_err(|_| INVALID)
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrozenBody {
    scope: StoredScope,
    bytes: String,
    hash: String,
}
impl FrozenBody {
    fn new(batch: &PreparedBatch) -> Self {
        Self {
            scope: StoredScope::new(&batch.scope()),
            bytes: STANDARD.encode(batch.bytes()),
            hash: batch.body_hash().into(),
        }
    }
    fn reopen(&self) -> Result<PreparedBatch, &'static str> {
        let bytes = decode_base64(&self.bytes, MAX_BODY_BASE64, MAX_BATCH_BYTES)?;
        PreparedBatch::reopen(&self.scope.reopen()?, &bytes, &self.hash).map_err(|_| INVALID)
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Action {
    Upload,
    Cancel {
        #[serde(rename = "expectedRevision")]
        expected_revision: u64,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Flight {
    body: FrozenBody,
    action: Action,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RetainedTerminal {
    flight: Flight,
    proof: TerminalProof,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "source",
    content = "reply",
    rename_all = "lowercase",
    deny_unknown_fields
)]
enum TerminalProof {
    Direct(String),
    Status(String),
}
impl TerminalProof {
    fn terminal(
        &self,
        batch: &PreparedBatch,
    ) -> Result<aicharts_core::contribution_producer::CorrelatedTerminal, &'static str> {
        let encoded = match self {
            Self::Direct(reply) | Self::Status(reply) => reply,
        };
        let bytes = decode_base64(encoded, MAX_TERMINAL_BASE64, MAX_TERMINAL_BYTES)?;
        let terminal = match self {
            Self::Direct(_) => batch.correlate_terminal(&bytes).map_err(|_| INVALID)?,
            Self::Status(_) => wire::status_terminal(&bytes, batch).map_err(|_| INVALID)?,
        };
        Ok(terminal)
    }
    fn correlate(&self, batch: &PreparedBatch) -> Result<u64, &'static str> {
        Ok(self.terminal(batch)?.revision())
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Checkpoint {
    schema_version: u8,
    binding: Binding,
    last_sequence: u64,
    last_revision: u64,
    flight: Option<Flight>,
    terminal: Option<RetainedTerminal>,
}
/// Existing schema-1 checkpoints contained only exact direct terminal replies.
/// This decoder is observational; only a subsequent explicit mutation writes v2.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyCheckpoint {
    schema_version: u8,
    binding: Binding,
    last_sequence: u64,
    last_revision: u64,
    flight: Option<Flight>,
    terminal: Option<LegacyTerminal>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyTerminal {
    flight: Flight,
    reply: String,
}
impl LegacyCheckpoint {
    fn into_current(self) -> Result<Checkpoint, &'static str> {
        if self.schema_version != 1 {
            return Err(INVALID);
        }
        let checkpoint = Checkpoint {
            schema_version: 2,
            binding: self.binding,
            last_sequence: self.last_sequence,
            last_revision: self.last_revision,
            flight: self.flight,
            terminal: self.terminal.map(|terminal| RetainedTerminal {
                flight: terminal.flight,
                proof: TerminalProof::Direct(terminal.reply),
            }),
        };
        checkpoint.validate()?;
        Ok(checkpoint)
    }
}
fn decode_base64(
    value: &str,
    encoded_cap: usize,
    byte_cap: usize,
) -> Result<Vec<u8>, &'static str> {
    if value.len() > encoded_cap {
        return Err(INVALID);
    }
    let bytes = STANDARD.decode(value).map_err(|_| INVALID)?;
    if bytes.is_empty() || bytes.len() > byte_cap || STANDARD.encode(&bytes) != value {
        return Err(INVALID);
    }
    Ok(bytes)
}
impl Flight {
    fn validate(&self, binding: &Binding, floor: u64) -> Result<PreparedBatch, &'static str> {
        let batch = self.body.reopen()?;
        if &self.body.scope.binding != binding || batch.expected_revision() > floor {
            return Err(INVALID);
        }
        if let Action::Cancel { expected_revision } = self.action {
            if expected_revision < batch.expected_revision() || expected_revision > floor {
                return Err(INVALID);
            }
        }
        Ok(batch)
    }
}
impl Checkpoint {
    fn validate(&self) -> Result<(), &'static str> {
        self.binding.validate()?;
        if self.schema_version != 2
            || self.last_sequence > MAX_SEQUENCE
            || self.last_revision > MAX_REVISION
            || (self.last_sequence == 0) != self.terminal.is_none()
        {
            return Err(INVALID);
        }
        if let Some(flight) = &self.flight {
            let batch = flight.validate(&self.binding, self.last_revision)?;
            if self.last_sequence.checked_add(1) != Some(batch.sequence()) {
                return Err(INVALID);
            }
        }
        if let Some(terminal) = &self.terminal {
            let batch = terminal
                .flight
                .validate(&self.binding, self.last_revision)?;
            let revision = terminal.proof.correlate(&batch)?;
            if batch.sequence() != self.last_sequence || revision > self.last_revision {
                return Err(INVALID);
            }
        }
        Ok(())
    }
    /// Recovery admits only transitions the state owner could publish. A valid
    /// MAC never licenses replacing a frozen operation or reversing cancellation.
    fn follows(&self, previous: Option<&Self>) -> Result<(), &'static str> {
        self.validate()?;
        let Some(previous) = previous else {
            return if self.last_sequence == 0 && self.flight.is_none() && self.terminal.is_none() {
                Ok(())
            } else {
                Err(INVALID)
            };
        };
        previous.validate()?;
        if self.binding != previous.binding || self.last_revision < previous.last_revision {
            return Err(INVALID);
        }
        if self == previous {
            return Ok(());
        }
        match (&previous.flight, &self.flight) {
            (None, Some(next))
                if self.last_sequence == previous.last_sequence
                    && self.terminal == previous.terminal
                    && next.action == Action::Upload
                    && next.body.reopen()?.expected_revision() == self.last_revision =>
            {
                Ok(())
            }
            (Some(old), Some(next))
                if old.body == next.body
                    && self.last_sequence == previous.last_sequence
                    && self.terminal == previous.terminal =>
            {
                match (&old.action, &next.action) {
                    (Action::Upload, Action::Cancel { expected_revision })
                        if *expected_revision == self.last_revision =>
                    {
                        Ok(())
                    }
                    (
                        Action::Cancel {
                            expected_revision: before,
                        },
                        Action::Cancel {
                            expected_revision: after,
                        },
                    ) if after >= before && *after == self.last_revision => Ok(()),
                    _ => Err(INVALID),
                }
            }
            (Some(old), None)
                if self.last_sequence == previous.last_sequence + 1
                    && self
                        .terminal
                        .as_ref()
                        .is_some_and(|terminal| &terminal.flight == old) =>
            {
                Ok(())
            }
            _ => Err(INVALID),
        }
    }
}

/// No public constructor: only the enrolled transport child may create
/// authenticated observations. Tests construct synthetic authority explicitly.
pub(crate) struct AuthenticatedProgress {
    scope: StoredScope,
    active: bool,
    next_sequence: u64,
    revision: u64,
    population_revision: u64,
    population_head: String,
    expires_at: Instant,
}
impl AuthenticatedProgress {
    fn checked(&self, binding: &Binding) -> Result<(), &'static str> {
        self.scope.reopen()?;
        if !self.active
            || Instant::now() >= self.expires_at
            || &self.scope.binding != binding
            || self.next_sequence == 0
            || self.next_sequence > MAX_SEQUENCE
            || self.revision > MAX_REVISION
            || self.population_revision > self.revision
            || self.population_head.len() != 64
            || !self
                .population_head
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || (self.population_revision == 0) != self.population_head.bytes().all(|b| b == b'0')
        {
            return Err(CONFLICT);
        }
        Ok(())
    }
}
/// An authenticated exchange binds its bytes to the exact original flight.
/// There is deliberately no constructor taking arbitrary response bytes.
pub(crate) struct AuthenticatedTerminal {
    body: FrozenBody,
    proof: TerminalProof,
}

#[cfg(target_os = "macos")]
pub(crate) struct Outbox {
    disk: disk::Disk,
    checkpoint: Checkpoint,
}
#[cfg(target_os = "macos")]
pub(crate) struct DurableFlight<'a> {
    owner: &'a mut Outbox,
    batch: PreparedBatch,
    expires_at: Instant,
}
#[cfg(target_os = "macos")]
impl Outbox {
    pub(crate) fn initialize(
        path: &Path,
        key: &[u8; 32],
        binding: &Binding,
        progress: &AuthenticatedProgress,
    ) -> Result<Self, &'static str> {
        progress.checked(binding)?;
        if progress.next_sequence != 1 {
            return Err(CONFLICT);
        }
        let checkpoint = Checkpoint {
            schema_version: 2,
            binding: binding.clone(),
            last_sequence: 0,
            last_revision: progress.revision,
            flight: None,
            terminal: None,
        };
        let mut disk = disk::Disk::create(path, key)?;
        disk.write(&checkpoint)?;
        Ok(Self { disk, checkpoint })
    }
    pub(crate) fn recover(
        path: &Path,
        key: &[u8; 32],
        binding: &Binding,
    ) -> Result<Self, &'static str> {
        binding.validate()?;
        let mut disk = disk::Disk::writer(path, key)?;
        let checkpoint = disk.recover(binding)?.ok_or(INVALID)?;
        Ok(Self { disk, checkpoint })
    }
    fn persist(&mut self, next: Checkpoint) -> Result<(), &'static str> {
        next.follows(Some(&self.checkpoint))?;
        self.disk.write(&next)?;
        self.checkpoint = next;
        Ok(())
    }
    fn current(&self, binding: &Binding) -> Result<(), &'static str> {
        if &self.checkpoint.binding != binding {
            return Err(CONFLICT);
        }
        self.disk.matches(&self.checkpoint)
    }
    pub(crate) fn freeze(
        &mut self,
        binding: &Binding,
        batch: &PreparedBatch,
        progress: &AuthenticatedProgress,
    ) -> Result<(), &'static str> {
        self.current(binding)?;
        progress.checked(binding)?;
        if self.checkpoint.flight.is_some()
            || progress.next_sequence != self.checkpoint.last_sequence + 1
            || progress.next_sequence != batch.sequence()
            || progress.revision < self.checkpoint.last_revision
            || progress.revision != batch.expected_revision()
            || progress.population_revision != batch.expected_population_revision()
            || progress.population_head != batch.expected_population_head()
            || progress.scope != StoredScope::new(&batch.scope())
        {
            return Err(CONFLICT);
        }
        let mut next = self.checkpoint.clone();
        next.last_revision = progress.revision;
        next.flight = Some(Flight {
            body: FrozenBody::new(batch),
            action: Action::Upload,
        });
        self.persist(next)
    }
    /// Record the user's one-way cancellation intent before any remote read.
    /// The retained floor is not fresh authority: dispatch still requires an
    /// authenticated progress observation, and a later explicit cancel may
    /// durably refresh the cancellation revision before its request.
    pub(crate) fn request_cancel(&mut self, binding: &Binding) -> Result<(), &'static str> {
        self.current(binding)?;
        let mut next = self.checkpoint.clone();
        let flight = next.flight.as_mut().ok_or(INVALID)?;
        if matches!(flight.action, Action::Cancel { .. }) {
            return Ok(());
        }
        flight.action = Action::Cancel {
            expected_revision: next.last_revision,
        };
        self.persist(next)
    }
    pub(crate) fn cancel(
        &mut self,
        binding: &Binding,
        progress: &AuthenticatedProgress,
    ) -> Result<(), &'static str> {
        self.current(binding)?;
        progress.checked(binding)?;
        let mut next = self.checkpoint.clone();
        let flight = next.flight.as_mut().ok_or(INVALID)?;
        if progress.scope != flight.body.scope
            || progress.revision < next.last_revision
            || progress.next_sequence != flight.body.reopen()?.sequence()
        {
            return Err(CONFLICT);
        }
        flight.action = Action::Cancel {
            expected_revision: progress.revision,
        };
        next.last_revision = progress.revision;
        self.persist(next)
    }
    pub(crate) fn settle(
        &mut self,
        binding: &Binding,
        terminal: &AuthenticatedTerminal,
    ) -> Result<(), &'static str> {
        self.current(binding)?;
        let flight = self.checkpoint.flight.as_ref().ok_or(INVALID)?;
        if flight.body != terminal.body {
            return Err(CONFLICT);
        }
        let batch = flight.body.reopen()?;
        let revision = terminal.proof.correlate(&batch).map_err(|_| CONFLICT)?;
        let mut next = self.checkpoint.clone();
        next.last_sequence = batch.sequence();
        next.last_revision = next.last_revision.max(revision);
        next.terminal = Some(RetainedTerminal {
            flight: flight.clone(),
            proof: terminal.proof.clone(),
        });
        next.flight = None;
        self.persist(next)
    }
    pub(crate) fn flight<'a>(
        &'a mut self,
        binding: &Binding,
        progress: &AuthenticatedProgress,
    ) -> Result<DurableFlight<'a>, &'static str> {
        self.current(binding)?;
        progress.checked(binding)?;
        let retained = self.checkpoint.flight.as_ref().ok_or(INVALID)?;
        let batch = retained.body.reopen()?;
        if progress.scope != retained.body.scope
            || progress.revision < self.checkpoint.last_revision
            || (progress.next_sequence != batch.sequence()
                && progress.next_sequence != batch.sequence() + 1)
        {
            return Err(CONFLICT);
        }
        Ok(DurableFlight {
            owner: self,
            batch,
            expires_at: progress.expires_at,
        })
    }
}
#[cfg(target_os = "macos")]
impl DurableFlight<'_> {
    /// The sealed transport calls this immediately before dispatch and
    /// independently revalidate enrollment custody. Borrowing prevents an old
    /// upload capability surviving an owner mutation into cancellation/settlement.
    pub(crate) fn request_bytes(&self, binding: &Binding) -> Result<Vec<u8>, &'static str> {
        if Instant::now() >= self.expires_at {
            return Err(CONFLICT);
        }
        self.owner.current(binding)?;
        let retained = self.owner.checkpoint.flight.as_ref().ok_or(INVALID)?;
        if retained.body.hash != self.batch.body_hash() {
            return Err(CONFLICT);
        }
        let bytes = match retained.action {
            Action::Upload => self.batch.bytes().to_vec(),
            Action::Cancel { expected_revision } => {
                let mut bytes = format!("{{\"schemaVersion\":3,\"accountId\":\"{}\",\"generation\":\"{}\",\"deviceId\":\"{}\",\"expectedRevision\":{},\"batch\":",
                    binding.account_id, binding.generation, binding.device_id, expected_revision).into_bytes();
                bytes.extend_from_slice(self.batch.bytes());
                bytes.push(b'}');
                if bytes.len() > MAX_BATCH_BYTES + 512 {
                    return Err(INVALID);
                }
                bytes
            }
        };
        if Instant::now() >= self.expires_at {
            return Err(CONFLICT);
        }
        Ok(bytes)
    }
}

/// Existing-only shared read. No lock creation, directory sync, stage promotion,
/// migration or checkpoint update occurs on this path.
#[cfg(all(test, target_os = "macos"))]
pub(crate) fn inspect(
    path: &Path,
    key: &[u8; 32],
    binding: &Binding,
) -> Result<Option<Checkpoint>, &'static str> {
    disk::Disk::reader(path, key)?.inspect(binding)
}
