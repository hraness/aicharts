//! Bounded native V3 preparation, without files, credentials, storage or transport.
//!
//! Only the metadata-only Claude reader can construct this observation set. All
//! scans are partial: this kernel emits new observations and exact mirror joins,
//! never corrections, removals, replacements, activation or account tombstones.
//! Parsed source metadata is not attestation. The caller must obtain the account's
//! existing occurrence key from verified custody; reusing a key across accounts
//! is unsupported. Keeping the V1 HMAC domain preserves migrated occurrence IDs.
//!
//! A correlated reply is not authenticated authority or durable settlement. A
//! future sender must pin the exact scope, reserve its sequence and immutable
//! bytes in a durable outbox, use the sealed authenticated transport, and settle
//! only the matching retained flight. Rebuilding after an uncertain send is not
//! a retry. No public type in this module grants permission to activate V3.

#[cfg(test)]
mod tests;
mod wire;

use aicharts_protocol::Provider;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{self, BufRead, Write};
use wire::{Batch, HeadPage, NamedQuery, NativeRow, Put};

pub const MAX_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_OBSERVATIONS: usize = 8_192;
pub const MAX_MUTATIONS: usize = 256;
pub const MAX_QUERY_BYTES: usize = 16_384;
pub const MAX_REPLY_BYTES: usize = 524_288;
pub const MAX_BATCH_BYTES: usize = 1_048_576;
const MAX_REVISION: u64 = 1_000_000;
const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;
const MAX_TIME: u64 = 8_640_000_000_000_000;
const ZERO_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    InvalidScope,
    InvalidKey,
    Source(crate::Error),
    SourceLimit,
    ObservationLimit,
    InvalidSelection,
    InvalidReply,
    InvalidBatch,
    PopulationConflict,
    CorrectionRequiresReconciliation,
    SubjectDeleted,
    LegacyUnresolved,
    Limit,
}
impl Error {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidScope => "invalid_scope",
            Self::InvalidKey => "invalid_key",
            Self::Source(error) => error.code(),
            Self::SourceLimit => "source_byte_limit",
            Self::ObservationLimit => "observation_limit",
            Self::InvalidSelection => "invalid_selection",
            Self::InvalidReply => "invalid_reply",
            Self::InvalidBatch => "invalid_prepared_batch",
            Self::PopulationConflict => "population_conflict",
            Self::CorrectionRequiresReconciliation => "correction_requires_reconciliation",
            Self::SubjectDeleted => "subject_deleted",
            Self::LegacyUnresolved => "legacy_unresolved",
            Self::Limit => "limit",
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for Error {}

/// Syntactically checked routing, not enrollment, authentication or a writer grant.
#[derive(Clone, PartialEq, Eq)]
pub struct Scope {
    account_id: String,
    generation: String,
    device_id: String,
    population_id: String,
    writer_revision: u64,
}
impl Scope {
    pub fn new(
        account_id: &str,
        generation: &str,
        device_id: &str,
        population_id: &str,
        writer_revision: u64,
    ) -> Result<Self, Error> {
        if !account(account_id)
            || ![generation, device_id, population_id]
                .iter()
                .all(|value| identity(value, 64))
            || !(1..=MAX_REVISION).contains(&writer_revision)
        {
            return Err(Error::InvalidScope);
        }
        Ok(Self {
            account_id: account_id.to_owned(),
            generation: generation.to_owned(),
            device_id: device_id.to_owned(),
            population_id: population_id.to_owned(),
            writer_revision,
        })
    }
    pub fn account_id(&self) -> &str {
        &self.account_id
    }
    pub fn generation(&self) -> &str {
        &self.generation
    }
    pub fn device_id(&self) -> &str {
        &self.device_id
    }
    pub fn population_id(&self) -> &str {
        &self.population_id
    }
    pub fn writer_revision(&self) -> u64 {
        self.writer_revision
    }
}

#[derive(Clone)]
struct NativeFact {
    id: String,
    row: NativeRow,
    payload_hash: String,
}

/// Immutable native observations; an aggregate report has no conversion here.
/// Missing records, unknown cache TTL and reasoning remain partial coverage.
pub struct NativeObservations {
    account_id: String,
    facts: Vec<NativeFact>,
    warnings: Vec<crate::Warning>,
    lines_read: u64,
    quarantine: Quarantine,
}

/// Counts of source observations withheld under the exact-source rule: Codex
/// timestamp/slot identities never justify reordered-history corrections, so
/// ambiguous rewrites are quarantined instead of sent.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quarantine {
    /// Distinct deltas sharing one execution timestamp (slot ordinals).
    pub same_instant_slots: usize,
    /// Every observation of a source whose cumulative counters regressed or
    /// that forked from another thread.
    pub rewritten_history: usize,
}
impl Quarantine {
    pub fn total(&self) -> usize {
        self.same_instant_slots + self.rewritten_history
    }
}
impl NativeObservations {
    /// Reads at most MAX_SOURCE_BYTES + 1 consumed bytes. The existing reader also
    /// bounds physical lines, nesting and measurements before this projection.
    /// No source path, transcript text, native ID or key enters a request.
    pub fn read_claude<R: BufRead>(
        reader: R,
        account_id: &str,
        account_occurrence_key: &[u8; 32],
    ) -> Result<Self, Error> {
        Self::read(
            reader,
            Provider::ClaudeCode,
            account_id,
            account_occurrence_key,
        )
    }

    /// Codex rollouts carry cumulative `token_count` events whose native identity
    /// is the execution plus the event timestamp. Distinct deltas stamped with one
    /// timestamp receive slot ordinals in stream order, so their identity would
    /// move under a reordered or compacted history. Such same-instant groups, and
    /// every observation of a source whose cumulative counters regressed or that
    /// forked from another thread, are quarantined: counted, never sent, never
    /// corrected. Only stable single-timestamp observations become new facts.
    pub fn read_codex<R: BufRead>(
        reader: R,
        account_id: &str,
        account_occurrence_key: &[u8; 32],
    ) -> Result<Self, Error> {
        Self::read(reader, Provider::Codex, account_id, account_occurrence_key)
    }

    fn read<R: BufRead>(
        reader: R,
        provider: Provider,
        account_id: &str,
        account_occurrence_key: &[u8; 32],
    ) -> Result<Self, Error> {
        if !account(account_id) {
            return Err(Error::InvalidScope);
        }
        if account_occurrence_key.iter().all(|byte| *byte == 0) {
            return Err(Error::InvalidKey);
        }
        let client = match provider {
            Provider::ClaudeCode => "claude",
            Provider::Codex => "codex",
            Provider::Devin => return Err(Error::InvalidScope),
        };
        let mut bounded = reader.take(MAX_SOURCE_BYTES + 1);
        let parsed = crate::parse_reader(&mut bounded, provider, account_occurrence_key);
        // Check even if the artificial EOF produced a syntax error. Never accept
        // a valid prefix of an oversized stream as if it were the whole input.
        if bounded.limit() == 0 {
            return Err(Error::SourceLimit);
        }
        let collection = parsed.map_err(Error::Source)?;
        let count: usize = collection
            .batches
            .iter()
            .map(|batch| batch.usage.len())
            .sum();
        if count > MAX_OBSERVATIONS {
            return Err(Error::ObservationLimit);
        }
        let rewritten = provider == Provider::Codex
            && collection.warnings.iter().any(|warning| {
                matches!(
                    warning,
                    crate::Warning::CodexCumulativeRegression
                        | crate::Warning::CodexForkUnsupported
                )
            });
        let mut instants: std::collections::HashMap<(u32, [u8; 16], u32), usize> =
            std::collections::HashMap::new();
        if provider == Provider::Codex {
            for batch in &collection.batches {
                for usage in &batch.usage {
                    *instants
                        .entry((batch.utc_day, usage.execution_id, usage.offset_ms))
                        .or_insert(0) += 1;
                }
            }
        }
        let mut quarantine = Quarantine::default();
        let mut facts = Vec::with_capacity(count);
        for batch in collection.batches {
            for usage in batch.usage {
                if rewritten {
                    quarantine.rewritten_history += 1;
                    continue;
                }
                if instants
                    .get(&(batch.utc_day, usage.execution_id, usage.offset_ms))
                    .is_some_and(|members| *members > 1)
                {
                    quarantine.same_instant_slots += 1;
                    continue;
                }
                let row = NativeRow::native(client, batch.utc_day, &usage.tokens)?;
                let payload = encode(&row, MAX_BATCH_BYTES)?;
                let payload_hash = hash_parts(&[b"aicharts:contribution-payload:v3\0", &payload]);
                facts.push(NativeFact {
                    id: hex_bytes(&usage.id),
                    row,
                    payload_hash,
                });
            }
        }
        facts.sort_unstable_by(|left, right| left.id.cmp(&right.id));
        Ok(Self {
            account_id: account_id.to_owned(),
            facts,
            warnings: collection.warnings,
            lines_read: collection.lines_read,
            quarantine,
        })
    }

    /// Observations withheld from every query and batch because their native
    /// identity is not stable under a rewritten history.
    pub fn quarantine(&self) -> &Quarantine {
        &self.quarantine
    }

    pub fn len(&self) -> usize {
        self.facts.len()
    }
    pub fn is_empty(&self) -> bool {
        self.facts.is_empty()
    }
    pub fn warnings(&self) -> &[crate::Warning] {
        &self.warnings
    }
    pub fn lines_read(&self) -> u64 {
        self.lines_read
    }
    pub fn coverage(&self) -> &'static str {
        "partial"
    }

    /// Selects up to 256 stable IDs at an explicit canonical revision. Offset is
    /// into this immutable set, not a cursor proving complete remote membership.
    pub fn head_query(
        &self,
        scope: &Scope,
        expected_revision: u64,
        offset: usize,
    ) -> Result<Option<HeadQuery>, Error> {
        if self.account_id != scope.account_id || expected_revision > MAX_REVISION {
            return Err(Error::InvalidScope);
        }
        if offset > self.len() {
            return Err(Error::InvalidSelection);
        }
        let facts =
            self.facts[offset..self.len().min(offset.saturating_add(MAX_MUTATIONS))].to_vec();
        if facts.is_empty() {
            return Ok(None);
        }
        let query = NamedQuery::new(
            scope,
            expected_revision,
            facts.iter().map(|fact| fact.id.clone()).collect(),
        );
        let bytes = encode(&query, MAX_QUERY_BYTES)?;
        Ok(Some(HeadQuery {
            scope: scope.clone(),
            query,
            facts,
            bytes,
        }))
    }
}

/// Frozen named-head read; its native rows and requested IDs cannot be replaced.
pub struct HeadQuery {
    scope: Scope,
    query: NamedQuery,
    facts: Vec<NativeFact>,
    bytes: Vec<u8>,
}
impl HeadQuery {
    pub fn scope(&self) -> &Scope {
        &self.scope
    }
    pub fn expected_revision(&self) -> u64 {
        self.query.expected_revision
    }
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    pub fn len(&self) -> usize {
        self.facts.len()
    }
    pub fn is_empty(&self) -> bool {
        self.facts.is_empty()
    }

    /// Strict shape/scope correlation only; no untrusted reply becomes a grant.
    pub fn correlate(&self, bytes: &[u8]) -> Result<CorrelatedHeads, Error> {
        let page: HeadPage = wire::success(bytes)?;
        page.check(&self.query)?;
        Ok(CorrelatedHeads {
            scope: self.scope.clone(),
            facts: self.facts.clone(),
            page,
        })
    }
}

/// Current canonical heads and this population's last assertions stay distinct.
pub struct CorrelatedHeads {
    scope: Scope,
    facts: Vec<NativeFact>,
    page: HeadPage,
}
impl CorrelatedHeads {
    /// Emits only absent observations or exact-payload membership assertions.
    /// The caller must durably allocate operation ID and sequence before sending.
    /// None means this selected page already matches; it proves no completeness.
    pub fn prepare(
        &self,
        operation_id: &str,
        sequence: u64,
    ) -> Result<Option<PreparedBatch>, Error> {
        if !identity(operation_id, 64) || !(1..=MAX_SEQUENCE).contains(&sequence) {
            return Err(Error::InvalidScope);
        }
        let mut mutations = Vec::new();
        let mut new_members = 0;
        for (fact, entry) in self.facts.iter().zip(&self.page.entries) {
            if let Some(head) = &entry.head {
                if head.deleted {
                    return Err(Error::SubjectDeleted);
                }
                if head.suppressed_legacy {
                    return Err(Error::LegacyUnresolved);
                }
                if head.payload_hash.as_deref() != Some(fact.payload_hash.as_str()) {
                    return Err(
                        if entry.membership_head_hash.as_deref() == Some(head.head_hash.as_str()) {
                            Error::CorrectionRequiresReconciliation
                        } else {
                            Error::PopulationConflict
                        },
                    );
                }
                if entry.membership_head_hash.as_deref() == Some(head.head_hash.as_str()) {
                    continue;
                }
            }
            if entry.membership_head_hash.is_none() {
                new_members += 1;
            }
            mutations.push(Put {
                kind: "put".into(),
                id: fact.id.clone(),
                expected_head_hash: entry.head.as_ref().map(|head| head.head_hash.clone()),
                row: fact.row.clone(),
            });
        }
        if mutations.is_empty() {
            return Ok(None);
        }
        if self.page.revision >= MAX_REVISION
            || self.page.population.revision >= MAX_REVISION
            || self.page.population.member_count + new_members > MAX_OBSERVATIONS as u64
        {
            return Err(Error::Limit);
        }
        let batch = Batch::new(&self.scope, &self.page, operation_id, sequence, mutations);
        let bytes = encode(&batch, MAX_BATCH_BYTES)?;
        let body_hash = hash_parts(&[&bytes]);
        Ok(Some(PreparedBatch {
            batch,
            bytes,
            body_hash,
        }))
    }
}

/// Immutable canonical bytes. This value is neither a durable flight nor a send.
pub struct PreparedBatch {
    batch: Batch,
    bytes: Vec<u8>,
    body_hash: String,
}
impl PreparedBatch {
    /// Reopen only exact canonical bytes emitted by the narrow native profile.
    /// This checks retained data, not its source provenance, authentication or
    /// durability. A sender still owns the enrolled binding and durable flight.
    pub fn reopen(scope: &Scope, bytes: &[u8], expected_hash: &str) -> Result<Self, Error> {
        if bytes.is_empty()
            || bytes.len() > MAX_BATCH_BYTES
            || !identity(expected_hash, 64)
            || hash_parts(&[bytes]) != expected_hash
        {
            return Err(Error::InvalidBatch);
        }
        let batch: Batch = serde_json::from_slice(bytes).map_err(|_| Error::InvalidBatch)?;
        batch.check_native(scope)?;
        if encode(&batch, MAX_BATCH_BYTES)? != bytes {
            return Err(Error::InvalidBatch);
        }
        Ok(Self {
            batch,
            bytes: bytes.to_vec(),
            body_hash: expected_hash.to_owned(),
        })
    }
    pub fn scope(&self) -> Scope {
        self.batch.scope()
    }
    pub fn operation_id(&self) -> &str {
        &self.batch.operation_id
    }
    pub fn sequence(&self) -> u64 {
        self.batch.sequence
    }
    pub fn expected_revision(&self) -> u64 {
        self.batch.expected_revision
    }
    pub fn expected_population_revision(&self) -> u64 {
        self.batch.expected_population_revision
    }
    pub fn expected_population_head(&self) -> &str {
        &self.batch.expected_population_head
    }
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    pub fn body_hash(&self) -> &str {
        &self.body_hash
    }
    pub fn len(&self) -> usize {
        self.batch.mutations.len()
    }
    pub fn is_empty(&self) -> bool {
        self.batch.mutations.is_empty()
    }

    /// Correlates a terminal to this exact frozen body. It performs no local
    /// acknowledgment and cannot authenticate the supplied response bytes.
    pub fn correlate_terminal(&self, bytes: &[u8]) -> Result<CorrelatedTerminal, Error> {
        let terminal: wire::Terminal = wire::success(bytes)?;
        self.correlate_record(&TerminalRecord(terminal))
    }

    /// Correlation of a strictly decoded embedded terminal, such as one inside
    /// a status response. The caller still retains and authenticates the entire
    /// original response; this value does not grant settlement authority.
    pub fn correlate_record(&self, record: &TerminalRecord) -> Result<CorrelatedTerminal, Error> {
        match &record.0 {
            wire::Terminal::Committed { receipt } => {
                let history = encode(
                    &[
                        self.batch.expected_population_head.as_str(),
                        self.body_hash.as_str(),
                    ],
                    MAX_REPLY_BYTES,
                )?;
                let expected_head = hash_parts(&[b"aicharts:population-history:v3\0", &history]);
                if receipt.schema_version != 3
                    || receipt.operation_id != self.batch.operation_id
                    || receipt.body_hash != self.body_hash
                    || receipt.account_id != self.batch.account_id
                    || receipt.generation != self.batch.generation
                    || receipt.device_id != self.batch.device_id
                    || receipt.sequence != self.batch.sequence
                    || receipt.revision != self.batch.expected_revision + 1
                    || receipt.population_id != self.batch.population_id
                    || receipt.population_revision != self.batch.expected_population_revision + 1
                    || receipt.population_head != expected_head
                    || receipt.committed_at_ms > MAX_TIME
                {
                    return Err(Error::InvalidReply);
                }
                Ok(CorrelatedTerminal {
                    outcome: TerminalOutcome::Committed,
                    revision: receipt.revision,
                    committed_population: Some((
                        receipt.population_revision,
                        receipt.population_head.clone(),
                    )),
                })
            }
            wire::Terminal::Abandoned {
                operation_id,
                body_hash,
                revision,
            } => {
                if operation_id != &self.batch.operation_id
                    || body_hash != &self.body_hash
                    || *revision <= self.batch.expected_revision
                    || *revision > MAX_REVISION
                {
                    return Err(Error::InvalidReply);
                }
                Ok(CorrelatedTerminal {
                    outcome: TerminalOutcome::Abandoned,
                    revision: *revision,
                    committed_population: None,
                })
            }
        }
    }
}

/// Strict wire syntax only. A record is meaningful only when correlated to a
/// prepared body, and is never an authenticated or durable capability.
#[derive(serde::Deserialize)]
#[serde(transparent)]
pub struct TerminalRecord(wire::Terminal);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerminalOutcome {
    Committed,
    Abandoned,
}
/// Correlation evidence only. No constructor, deserializer or settlement API.
pub struct CorrelatedTerminal {
    outcome: TerminalOutcome,
    revision: u64,
    committed_population: Option<(u64, String)>,
}
impl CorrelatedTerminal {
    pub fn outcome(&self) -> TerminalOutcome {
        self.outcome
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    /// Exact population history proven by a committed receipt. Current status
    /// may be later, but cannot precede or contradict this same revision.
    pub fn committed_population(&self) -> Option<(u64, &str)> {
        self.committed_population
            .as_ref()
            .map(|(revision, head)| (*revision, head.as_str()))
    }
}

fn hex(value: &str, width: usize) -> bool {
    value.len() == width
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn identity(value: &str, width: usize) -> bool {
    hex(value, width) && value.bytes().any(|byte| byte != b'0')
}
fn account(value: &str) -> bool {
    value.strip_prefix("acct_").is_some_and(|id| hex(id, 32))
}
fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn hash_parts(parts: &[&[u8]]) -> String {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update(part);
    }
    hex_bytes(&hash.finalize())
}
struct BoundedOutput {
    bytes: Vec<u8>,
    limit: usize,
}
impl Write for BoundedOutput {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.bytes.len()) {
            return Err(io::Error::other("output_limit"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn encode<T: Serialize>(value: &T, limit: usize) -> Result<Vec<u8>, Error> {
    let mut output = BoundedOutput {
        bytes: Vec::new(),
        limit,
    };
    serde_json::to_writer(&mut output, value).map_err(|_| Error::Limit)?;
    Ok(output.bytes)
}
