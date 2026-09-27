//! Seeded command sequences through a real private SQLite ledger. Each command
//! (append, rewrite, stale commit, conflicting revision, sender migration,
//! freeze, settle, replayed settlement, reopen, backup, restore) is applied to
//! the ledger and to an independent in-memory model that replays the
//! documented rules; after every command the reopened or live ledger must
//! report exactly the model: conservation of token totals, monotone revisions,
//! no duplicate settlement, contiguous sequences, and restart equivalence.
//! Crash injection inside a transaction needs the ledger crate's private
//! hooks, so crash-before/after evidence stays in that crate's own tests,
//! which `usage:fault-matrix` aggregates. Every fixture is a fresh private
//! temporary directory holding only synthetic numbers; it is removed on drop.
use crate::{config_from_env, receipt_line, Context, Rng, Seed};
use aicharts_core::{Collection, Warning};
use aicharts_ledger::{
    BatchSettlement, Error, FrozenBatch, Ledger, LedgerIdentity, SenderBinding, SenderStatus,
    SettledBatch, SourceScan, SourceStamp,
};
use aicharts_protocol::admission as wire;
use aicharts_protocol::{
    decode, AuthMode, Batch, Evidence, Id, Policy, Provider, Registry, Tokens, Usage,
};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const CHECKPOINT_KEY: [u8; 32] = [0x5a; 32];
const OCCURRENCE_KEY: [u8; 32] = [0xa5; 32];
const BINDING: SenderBinding = SenderBinding {
    account_id: [0x11; 16],
    device_id: [0x22; 32],
    generation: [0x33; 32],
    namespace_version: 1,
};
/// Small pools force copies, rewrites and re-uploads of the same occurrences.
const ID_POOL: u64 = 64;
const MAX_SOURCES: u64 = 48;
const MAX_COUNTER: u64 = 1 << 12;
const UTC_DAY: u32 = 20_000;
const OFFSET_MS: u32 = 1_000;
const EXECUTION: Id = [9; 16];
const JOURNAL_EPOCH_MS: u64 = 1_800_000_000_000;

type Vector = [u64; 6];
type SourceId = [u8; 32];

static FIXTURES: AtomicU64 = AtomicU64::new(0);

fn identity() -> LedgerIdentity<'static> {
    LedgerIdentity::SplitKeys {
        checkpoint: &CHECKPOINT_KEY,
        occurrence: &OCCURRENCE_KEY,
        namespace_version: 1,
    }
}

struct Fixture(PathBuf);
impl Fixture {
    fn new(seed: &Seed) -> Self {
        let nonce = FIXTURES.fetch_add(1, Ordering::Relaxed);
        let path = fs::canonicalize(std::env::temp_dir())
            .expect("temporary directory")
            .join(format!(
                "aicharts-fuzz-ledger-{}-{:016x}-{nonce}",
                std::process::id(),
                seed.value
            ));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .expect("fresh fixture directory");
        Self(path)
    }
    fn dir(&self) -> PathBuf {
        self.0.join("state")
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // This exact newly created directory holds only this run's synthetic state.
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn id(n: u64) -> Id {
    let mut id = [0; 16];
    id[8..].copy_from_slice(&n.to_be_bytes());
    id
}

fn source_id(n: u64) -> SourceId {
    let mut id = [0; 32];
    id[24..].copy_from_slice(&n.to_be_bytes());
    id
}

fn registry() -> Registry {
    Registry {
        revision: 1,
        models: vec![],
    }
}

fn policy(registry: &Registry) -> Policy<'_> {
    Policy {
        first_day: 0,
        last_day: u32::MAX,
        registry,
    }
}

fn record(id: Id, vector: Vector) -> Usage {
    Usage {
        id,
        execution_id: EXECUTION,
        account_id: [0; 16],
        offset_ms: OFFSET_MS,
        provider: Provider::ClaudeCode,
        auth_mode: AuthMode::Unknown,
        evidence: Evidence::Imported,
        model_id: 0,
        context_tier: 0,
        tokens: Tokens {
            input_uncached: vector[0],
            cache_read: vector[1],
            cache_write_5m: vector[2],
            cache_write_1h: vector[3],
            output: vector[4],
            reasoning_output: vector[5],
        },
    }
}

fn vector_of(tokens: &Tokens) -> Vector {
    [
        tokens.input_uncached,
        tokens.cache_read,
        tokens.cache_write_5m,
        tokens.cache_write_1h,
        tokens.output,
        tokens.reasoning_output,
    ]
}

fn total(vector: Vector) -> u64 {
    vector[..5].iter().sum()
}

/// Componentwise dominance over the six counters; time is held constant so
/// this is the whole rule the ledger applies to one occurrence.
fn merge(old: Vector, new: Vector) -> Result<Vector, Error> {
    let greater = old.iter().zip(new).any(|(l, r)| *l > r);
    let smaller = old.iter().zip(new).any(|(l, r)| *l < r);
    match (greater, smaller) {
        (true, true) => Err(Error::InvalidMeasurement),
        (true, false) => Ok(old),
        _ => Ok(new),
    }
}

#[derive(Clone)]
struct ScanModel {
    source_id: SourceId,
    stamp: SourceStamp,
    rewrite: bool,
    records: BTreeMap<Id, Vector>,
}
impl ScanModel {
    fn scan(&self) -> SourceScan {
        let usage = self
            .records
            .iter()
            .map(|(id, vector)| record(*id, *vector))
            .collect::<Vec<_>>();
        SourceScan {
            source_id: self.source_id,
            stamp: self.stamp,
            collection: Collection {
                batches: if usage.is_empty() {
                    vec![]
                } else {
                    vec![Batch {
                        utc_day: UTC_DAY,
                        registry_revision: 1,
                        usage,
                        prompts: vec![],
                        intervals: vec![],
                    }]
                },
                warnings: vec![Warning::UnmeasuredPrompts, Warning::UnknownModels],
                lines_read: 1,
            },
            allows_rewrite: self.rewrite,
        }
    }
}

#[derive(Clone)]
struct SourceModel {
    rewrite: bool,
    stamp: SourceStamp,
    members: BTreeMap<Id, Vector>,
}

#[derive(Clone)]
struct Inflight {
    first_sequence: u64,
    selected_revision: u64,
    members: Vec<(Id, u64)>,
}

#[derive(Clone, Default)]
struct SenderModel {
    allocated: u64,
    settled: u64,
    inflight: Option<Inflight>,
    accepted: BTreeSet<Id>,
    gated: BTreeSet<Id>,
    revoked: bool,
    journal_revision: u64,
    last_journal: Option<Vec<u8>>,
    older_journal: Option<Vec<u8>>,
}

#[derive(Clone, Default)]
struct Model {
    revision: u64,
    measurements: BTreeMap<Id, (Vector, u64)>,
    sources: BTreeMap<SourceId, SourceModel>,
    pending: BTreeMap<Id, u64>,
    sender: Option<SenderModel>,
}

/// Why the model refuses a commit. The ledger reports both kinds as
/// `InvalidMeasurement`; the suite counts them separately.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Refusal {
    Rule(Error),
    /// The source-row fold disagrees with the dominant measurement although
    /// no single occurrence conflicted.
    Projection,
}
impl Refusal {
    fn error(self) -> Error {
        match self {
            Self::Rule(error) => error,
            Self::Projection => Error::InvalidMeasurement,
        }
    }
}
impl From<Error> for Refusal {
    fn from(error: Error) -> Self {
        Self::Rule(error)
    }
}

impl Model {
    fn commit(&mut self, expected_revision: u64, scans: &[ScanModel]) -> Result<u64, Refusal> {
        if expected_revision != self.revision {
            return Err(Refusal::Rule(Error::StaleRevision));
        }
        if scans.is_empty() {
            return Ok(self.revision);
        }
        let mut next = self.clone();
        let revision = self.revision + 1;
        let mut changed = BTreeSet::new();
        let mut touched = BTreeSet::new();
        let mut sources_updated = 0u64;
        for scan in scans {
            let old = next.sources.get(&scan.source_id).cloned();
            if let Some(old) = &old {
                if !scan.rewrite
                    && (old.stamp.device != scan.stamp.device
                        || old.stamp.inode != scan.stamp.inode
                        || old.stamp.bytes > scan.stamp.bytes)
                {
                    return Err(Refusal::Rule(Error::SourceHistoryChanged));
                }
            }
            let mut records = scan.records.clone();
            if let Some(old) = &old {
                for (id, old_vector) in &old.members {
                    let Some(new) = records.get(id).copied() else {
                        if scan.rewrite {
                            continue;
                        }
                        return Err(Refusal::Rule(Error::SourceHistoryChanged));
                    };
                    let reconciled = merge(*old_vector, new)?;
                    if !scan.rewrite && reconciled != new {
                        return Err(Refusal::Rule(Error::SourceHistoryChanged));
                    }
                    records.insert(*id, reconciled);
                }
            }
            let source_changed = old.as_ref().is_none_or(|old| old.stamp != scan.stamp);
            let mut entry = old.unwrap_or(SourceModel {
                rewrite: scan.rewrite,
                stamp: scan.stamp,
                members: BTreeMap::new(),
            });
            entry.stamp = scan.stamp;
            let mut association_changed = false;
            for (id, vector) in records {
                touched.insert(id);
                let current = next.measurements.get(&id).map(|entry| entry.0);
                let merged = match current {
                    Some(current) => merge(current, vector)?,
                    None => vector,
                };
                if current != Some(merged) {
                    next.measurements.insert(id, (merged, revision));
                    next.pending.insert(id, revision);
                    changed.insert(id);
                }
                association_changed |= entry.members.get(&id) != Some(&vector);
                entry.members.insert(id, vector);
            }
            next.sources.insert(scan.source_id, entry);
            if source_changed || association_changed {
                sources_updated += 1;
            }
        }
        // The ledger re-derives every touched measurement by folding all of
        // its source rows in source order; a fold that conflicts or disagrees
        // is refused even when the dominant measurement itself is unchanged.
        for id in &touched {
            let mut folded: Option<Vector> = None;
            for source in next.sources.values() {
                if let Some(row) = source.members.get(id) {
                    folded = Some(match folded {
                        Some(current) => merge(current, *row).map_err(|_| Refusal::Projection)?,
                        None => *row,
                    });
                }
            }
            if folded != next.measurements.get(id).map(|entry| entry.0) {
                return Err(Refusal::Projection);
            }
        }
        next.revision = if sources_updated > 0 || !changed.is_empty() {
            revision
        } else {
            self.revision
        };
        *self = next;
        Ok(self.revision)
    }

    fn freeze(&mut self, expected_revision: u64, ids: &[Id]) -> Result<(u64, u16), Error> {
        if ids.is_empty() || ids.len() > 256 {
            return Err(Error::Limit);
        }
        let selected: BTreeSet<Id> = ids.iter().copied().collect();
        if selected.len() != ids.len() || selected.contains(&[0; 16]) {
            return Err(Error::InvalidMeasurement);
        }
        let sender = self.sender.as_mut().ok_or(Error::SenderNotEnabled)?;
        if sender.revoked {
            return Err(Error::DeviceRevoked);
        }
        if let Some(inflight) = &sender.inflight {
            if inflight.selected_revision == expected_revision
                && inflight
                    .members
                    .iter()
                    .map(|member| member.0)
                    .eq(selected.iter().copied())
            {
                return Ok((inflight.first_sequence, inflight.members.len() as u16));
            }
            return Err(Error::UploadInFlight);
        }
        if self.revision != expected_revision {
            return Err(Error::StaleRevision);
        }
        let mut members = Vec::new();
        for id in &selected {
            if sender.gated.contains(id) {
                return Err(Error::ReconciliationRequired);
            }
            let revision = *self.pending.get(id).ok_or(Error::InvalidMeasurement)?;
            members.push((*id, revision));
        }
        let first_sequence = sender.allocated + 1;
        sender.allocated += members.len() as u64;
        sender.inflight = Some(Inflight {
            first_sequence,
            selected_revision: expected_revision,
            members,
        });
        self.revision += 1;
        Ok((first_sequence, ids.len() as u16))
    }

    fn settle(&mut self, journal: &[u8], plan: &SettlePlan) -> Result<BatchSettlement, Error> {
        let sender = self.sender.as_mut().ok_or(Error::SenderNotEnabled)?;
        if sender.last_journal.as_deref() == Some(journal) {
            return Ok(BatchSettlement::AlreadySettled {
                ledger_revision: self.revision,
            });
        }
        let inflight = sender.inflight.take().ok_or(Error::InvalidReceipt)?;
        let (mut cleared, mut conflicts, mut aborted) = (0u16, 0u16, 0u16);
        let accepted = plan.status == wire::JournalStatus::Accepted;
        for ((id, revision), outcome) in inflight.members.iter().zip(&plan.outcomes) {
            if accepted {
                sender.accepted.insert(*id);
                if self.pending.get(id) == Some(revision) {
                    self.pending.remove(id);
                    cleared += 1;
                }
            } else if matches!(
                outcome,
                wire::Outcome::PredecessorConflict | wire::Outcome::SubjectDeleted
            ) {
                sender.gated.insert(*id);
                conflicts += 1;
            } else if *outcome == wire::Outcome::BatchAborted {
                aborted += 1;
            }
        }
        let revoked = plan
            .outcomes
            .iter()
            .all(|outcome| *outcome == wire::Outcome::DeviceRevoked);
        if revoked {
            sender.revoked = true;
        }
        sender.settled = sender.allocated;
        sender.journal_revision = plan.journal_revision;
        sender.older_journal = sender.last_journal.take();
        sender.last_journal = Some(journal.to_vec());
        self.revision += 1;
        Ok(if accepted {
            BatchSettlement::Accepted {
                ledger_revision: self.revision,
                cleared_records: cleared,
                retained_newer: inflight.members.len() as u16 - cleared,
            }
        } else {
            BatchSettlement::Rejected {
                ledger_revision: self.revision,
                conflicted_records: conflicts,
                aborted_records: aborted,
                device_revoked: revoked,
            }
        })
    }
}

struct SettlePlan {
    status: wire::JournalStatus,
    outcomes: Vec<wire::Outcome>,
    journal_revision: u64,
}

fn journal(frozen: &FrozenBatch, plan: &SettlePlan) -> Vec<u8> {
    let registry = registry();
    let policy = policy(&registry);
    let batch = wire::decode_batch(&frozen.canonical_batch, &policy).expect("frozen batch decodes");
    assert_eq!(plan.outcomes.len(), batch.operations.len());
    let committed_at_ms = JOURNAL_EPOCH_MS + plan.journal_revision;
    let receipts = batch
        .operations
        .iter()
        .zip(&plan.outcomes)
        .map(|(operation, outcome)| {
            let operation_hash = wire::operation_digest(operation, &policy).expect("digest");
            let head_operation_hash = match outcome {
                wire::Outcome::Inserted | wire::Outcome::Replaced => operation_hash,
                wire::Outcome::Duplicate => [0x77; 32],
                wire::Outcome::PredecessorConflict | wire::Outcome::SubjectDeleted => [0x66; 32],
                wire::Outcome::BatchAborted => operation.expected_head,
                wire::Outcome::DeviceRevoked => [0; 32],
                wire::Outcome::Tombstoned => unreachable!("put-only batches"),
            };
            wire::Receipt {
                descriptor: operation.descriptor(),
                operation_hash,
                head_operation_hash,
                account_journal_revision: plan.journal_revision,
                committed_at_ms,
                outcome: *outcome,
            }
        })
        .collect();
    wire::encode_journal(&wire::Journal {
        binding: batch.binding,
        first_sequence: frozen.first_sequence,
        batch_hash: frozen.batch_hash,
        account_journal_revision: plan.journal_revision,
        committed_at_ms,
        status: plan.status,
        receipts,
    })
    .expect("journal encodes")
}

/// Everything a caller can observe through the public API, in one value so a
/// reopened handle is compared field by field with the handle it replaced.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Observation {
    revision: u64,
    sources: u64,
    occurrences: u64,
    associations: u64,
    tokens: u64,
    output_tokens: u64,
    pending: Vec<(Id, u64, Vec<u8>)>,
    sender: Option<(SenderStatus, Option<FrozenBatch>, Option<SettledBatch>)>,
}

fn observe(context: Context<'_>, ledger: &Ledger, sender_enabled: bool) -> Observation {
    let status = ledger.status().expect("status");
    let mut pending = Vec::new();
    let mut after = None;
    loop {
        let page = ledger
            .pending(after, 256, Some(status.revision))
            .expect("pending page");
        crate::check!(
            context,
            page.ledger_revision == status.revision,
            "pending pages pin the status revision"
        );
        pending.extend(
            page.entries
                .into_iter()
                .map(|entry| (entry.id, entry.revision, entry.frame)),
        );
        match page.next_after {
            Some(next) => after = Some(next),
            None => break,
        }
    }
    let sender = if sender_enabled {
        Some((
            ledger.sender_status().expect("sender status"),
            ledger.inflight_batch().expect("inflight batch"),
            ledger.last_settled_batch().expect("settled batch"),
        ))
    } else {
        crate::check!(
            context,
            ledger.sender_status().err() == Some(Error::SenderNotEnabled),
            "sender is explicit"
        );
        None
    };
    Observation {
        revision: status.revision,
        sources: status.sources,
        occurrences: status.usage_occurrences,
        associations: status.associations,
        tokens: status.tokens,
        output_tokens: status.output_tokens,
        pending,
        sender,
    }
}

fn check_model(context: Context<'_>, ledger: &Ledger, model: &Model) -> Observation {
    let observed = observe(context, ledger, model.sender.is_some());
    crate::check!(
        context,
        observed.revision == model.revision,
        "revision {} matches the model {}",
        observed.revision,
        model.revision
    );
    crate::check!(
        context,
        observed.sources == model.sources.len() as u64,
        "source count is conserved"
    );
    crate::check!(
        context,
        observed.occurrences == model.measurements.len() as u64,
        "occurrence count is conserved"
    );
    let associations: usize = model.sources.values().map(|s| s.members.len()).sum();
    crate::check!(
        context,
        observed.associations == associations as u64,
        "association count is conserved"
    );
    let tokens: u64 = model.measurements.values().map(|(v, _)| total(*v)).sum();
    let output: u64 = model.measurements.values().map(|(v, _)| v[4]).sum();
    crate::check!(
        context,
        observed.tokens == tokens && observed.output_tokens == output,
        "token totals equal the sum of dominant measurements"
    );
    let pending: Vec<(Id, u64)> = observed
        .pending
        .iter()
        .map(|(id, revision, _)| (*id, *revision))
        .collect();
    let expected: Vec<(Id, u64)> = model.pending.iter().map(|(id, r)| (*id, *r)).collect();
    crate::check!(
        context,
        pending == expected,
        "outbox ids and revisions match the model"
    );
    let registry = registry();
    for (id, _, frame) in &observed.pending {
        let batch = decode(frame, &policy(&registry)).expect("pending frame decodes");
        crate::check!(
            context,
            batch.usage.len() == 1
                && batch.usage[0].id == *id
                && vector_of(&batch.usage[0].tokens) == model.measurements[id].0,
            "pending frames carry the dominant measurement"
        );
    }
    match (&observed.sender, &model.sender) {
        (None, None) => {}
        (Some((status, inflight, settled)), Some(sender)) => {
            crate::check!(context, status.binding == BINDING, "binding is stable");
            crate::check!(
                context,
                status.allocated_sequence == sender.allocated
                    && status.settled_sequence == sender.settled
                    && status.settled_sequence <= status.allocated_sequence,
                "sequences are contiguous and never settle beyond allocation"
            );
            crate::check!(
                context,
                status.inflight_operations
                    == sender
                        .inflight
                        .as_ref()
                        .map_or(0, |i| i.members.len() as u16),
                "inflight operation count matches"
            );
            crate::check!(
                context,
                status.accepted_occurrences == sender.accepted.len() as u64
                    && status.reconciliation_required == sender.gated.len() as u64
                    && status.device_revoked == sender.revoked,
                "acceptance, reconciliation and revocation counters match"
            );
            match (inflight, &sender.inflight) {
                (None, None) => {}
                (Some(frozen), Some(expected)) => crate::check!(
                    context,
                    frozen.first_sequence == expected.first_sequence
                        && frozen.operation_count == expected.members.len() as u16
                        && frozen.selected_revision == expected.selected_revision
                        && frozen.first_sequence + u64::from(frozen.operation_count) - 1
                            == sender.allocated,
                    "the frozen batch is the model's flight"
                ),
                _ => crate::check!(context, false, "flight presence differs from the model"),
            }
            crate::check!(
                context,
                settled.as_ref().map(|s| s.terminal_journal.as_slice())
                    == sender.last_journal.as_deref(),
                "the last settled journal is the model's"
            );
        }
        _ => crate::check!(context, false, "sender presence differs from the model"),
    }
    observed
}

/// Command weights per named seed, in permille of the command draw.
struct Weights {
    rewrite_source: u64,
    conflict: u64,
    stale: u64,
    sender: u64,
    reopen: u64,
    reject: u64,
}
fn weights(seed: &Seed) -> Weights {
    match seed.name.as_str() {
        "rewrite-heavy" => Weights {
            rewrite_source: 800,
            conflict: 60,
            stale: 40,
            sender: 250,
            reopen: 80,
            reject: 100,
        },
        "conflict-heavy" => Weights {
            rewrite_source: 400,
            conflict: 250,
            stale: 150,
            sender: 300,
            reopen: 80,
            reject: 300,
        },
        "settlement-race" => Weights {
            rewrite_source: 300,
            conflict: 40,
            stale: 60,
            sender: 650,
            reopen: 250,
            reject: 200,
        },
        _ => Weights {
            rewrite_source: 400,
            conflict: 100,
            stale: 80,
            sender: 400,
            reopen: 120,
            reject: 150,
        },
    }
}

#[derive(Default)]
struct Counters {
    commits: u64,
    refused_commits: u64,
    conflicts: u64,
    projection_refusals: u64,
    freezes: u64,
    refused_freezes: u64,
    settlements: u64,
    rejected_settlements: u64,
    replayed_settlements: u64,
    reopens: u64,
    restores: u64,
}

struct Run<'a> {
    context: Context<'a>,
    rng: Rng,
    weights: Weights,
    fixture: Fixture,
    ledger: Option<Ledger>,
    model: Model,
    backup: Option<(Model, BTreeMap<String, Vec<u8>>)>,
    next_source: u64,
    counters: Counters,
}

impl Run<'_> {
    fn ledger(&mut self) -> &mut Ledger {
        self.ledger.as_mut().expect("ledger is open")
    }
    fn open(&self) -> &Ledger {
        self.ledger.as_ref().expect("ledger is open")
    }

    fn grown(&mut self, base: Vector) -> Vector {
        let mut vector = base;
        for component in vector.iter_mut().take(5) {
            if self.rng.chance(1, 2) {
                *component += self.rng.below(MAX_COUNTER);
            }
        }
        vector[0] = vector[0].max(1);
        if self.rng.chance(1, 2) {
            vector[5] = self.rng.range(vector[5].min(vector[4]), vector[4]);
        }
        vector[5] = vector[5].min(vector[4]);
        vector
    }

    /// A vector that neither dominates nor is dominated by `base`.
    fn conflicting(&mut self, base: Vector) -> Option<Vector> {
        let mut vector = base;
        vector[0] += 1;
        let lowered = (1..5).find(|index| base[*index] > 0)?;
        vector[lowered] -= 1;
        vector[5] = vector[5].min(vector[4]);
        Some(vector)
    }

    fn command_commit(&mut self) {
        let weights_rewrite = self.weights.rewrite_source;
        let existing: Vec<SourceId> = self.model.sources.keys().copied().collect();
        let new_source = existing.is_empty()
            || (self.model.sources.len() < MAX_SOURCES as usize && self.rng.chance(1, 4));
        let (source_id, rewrite, old) = if new_source {
            self.next_source += 1;
            (
                source_id(self.next_source),
                self.rng.chance(weights_rewrite, 1_000),
                None,
            )
        } else {
            let id = *self.rng.pick(&existing);
            let old = self.model.sources[&id].clone();
            (id, old.rewrite, Some(old))
        };
        let mut stamp = old.as_ref().map_or(
            SourceStamp {
                device: 1,
                inode: self.next_source,
                bytes: self.rng.range(1, 1_000),
                modified_seconds: 100,
                modified_nanos: 0,
                changed_seconds: 100,
                changed_nanos: 0,
            },
            |old| old.stamp,
        );
        if old.is_some() && self.rng.chance(3, 4) {
            stamp.bytes += self.rng.below(1_000);
            stamp.modified_seconds += 1;
        }
        let mut records: BTreeMap<Id, Vector> = old
            .as_ref()
            .map(|old| old.members.clone())
            .unwrap_or_default();
        // Existing members grow from the dominant measurement so the only
        // conflicts are the injected ones.
        for (id, vector) in records.iter_mut() {
            let dominant = self.model.measurements[id].0;
            let base = std::array::from_fn(|i| vector[i].max(dominant[i]));
            *vector = if self.rng.chance(1, 3) {
                self.grown(base)
            } else {
                base
            };
        }
        for _ in 0..self.rng.below(4) {
            let id = id(self.rng.range(1, ID_POOL));
            let base = self.model.measurements.get(&id).map_or([0; 6], |m| m.0);
            let vector = if self.rng.chance(1, 2) {
                self.grown(base)
            } else {
                let mut copy = base;
                copy[0] = copy[0].max(1);
                copy
            };
            records.insert(id, vector);
        }
        if rewrite && !records.is_empty() && self.rng.chance(1, 4) {
            // Rewrites may drop or regress occurrences; both are absorbed.
            let victim = *self.rng.pick(&records.keys().copied().collect::<Vec<_>>());
            if self.rng.chance(1, 2) {
                records.remove(&victim);
            } else if let Some(vector) = records.get_mut(&victim) {
                let mut regressed = *vector;
                for component in regressed.iter_mut().take(5) {
                    *component /= 2;
                }
                regressed[0] = regressed[0].max(1);
                regressed[5] = regressed[5].min(regressed[4]);
                *vector = regressed;
            }
        }
        let inject_conflict = self.rng.chance(self.weights.conflict, 1_000);
        if inject_conflict {
            let candidates: Vec<Id> = records
                .keys()
                .filter(|id| self.model.measurements.contains_key(*id))
                .copied()
                .collect();
            if !candidates.is_empty() {
                let victim = *self.rng.pick(&candidates);
                if let Some(vector) = self.conflicting(self.model.measurements[&victim].0) {
                    records.insert(victim, vector);
                }
            }
        } else if let Some(old) = &old {
            if !old.rewrite && self.rng.chance(1, 12) {
                // Append-only history violations: identity change, shrink or a
                // missing occurrence.
                match self.rng.below(3) {
                    0 => stamp.inode += 1,
                    1 => stamp.bytes = old.stamp.bytes.saturating_sub(1),
                    _ => {
                        if let Some(first) = old.members.keys().next().copied() {
                            records.remove(&first);
                        }
                    }
                }
            }
        }
        let stale = self.rng.chance(self.weights.stale, 1_000);
        let expected_revision = if stale {
            self.model.revision + 1 + self.rng.below(3)
        } else {
            self.model.revision
        };
        let scan = ScanModel {
            source_id,
            stamp,
            rewrite,
            records,
        };
        let expected = self
            .model
            .commit(expected_revision, std::slice::from_ref(&scan));
        let projection_refusal = expected == Err(Refusal::Projection);
        let expected = expected.map_err(Refusal::error);
        let actual = self
            .ledger()
            .commit_scans(expected_revision, vec![scan.scan()])
            .map(|report| report.revision);
        crate::check!(
            self.context,
            actual == expected,
            "commit outcome {actual:?} matches the model {expected:?}"
        );
        match expected {
            Ok(_) => self.counters.commits += 1,
            Err(Error::InvalidMeasurement) if projection_refusal => {
                self.counters.projection_refusals += 1;
                self.counters.refused_commits += 1;
            }
            Err(Error::InvalidMeasurement) => {
                self.counters.conflicts += 1;
                self.counters.refused_commits += 1;
            }
            Err(_) => self.counters.refused_commits += 1,
        }
    }

    fn command_migrate(&mut self) {
        let revision = self.model.revision;
        let stale = self.rng.chance(1, 8);
        drop(self.ledger.take());
        let expected = if stale { revision + 1 } else { revision };
        match Ledger::migrate_sender_v2(&self.fixture.dir(), &identity(), expected, &BINDING) {
            Ok(ledger) => {
                crate::check!(self.context, !stale, "stale migration must refuse");
                self.ledger = Some(ledger);
                self.model.sender = Some(SenderModel::default());
            }
            Err(error) => {
                crate::check!(
                    self.context,
                    stale && error == Error::StaleRevision,
                    "migration refused with {error:?}"
                );
                self.ledger = Some(
                    Ledger::open_with_identity(&self.fixture.dir(), &identity()).expect("reopen"),
                );
            }
        }
    }

    fn command_freeze(&mut self) {
        let Some(sender) = self.model.sender.clone() else {
            return;
        };
        let pending: Vec<Id> = self.model.pending.keys().copied().collect();
        let free: Vec<Id> = pending
            .iter()
            .filter(|id| !sender.gated.contains(*id))
            .copied()
            .collect();
        let mut ids: Vec<Id> = Vec::new();
        let mut expected_revision = self.model.revision;
        let choice = self.rng.below(16);
        match (&sender.inflight, choice) {
            (Some(inflight), 0..=5) => {
                // Replay the identical selection at its selected revision.
                ids = inflight.members.iter().map(|m| m.0).collect();
                expected_revision = inflight.selected_revision;
            }
            (_, 6) => {}
            (_, 7) if !sender.gated.is_empty() => {
                let gated = *self
                    .rng
                    .pick(&sender.gated.iter().copied().collect::<Vec<_>>());
                ids = pending
                    .iter()
                    .filter(|id| **id != gated)
                    .take(3)
                    .copied()
                    .collect();
                ids.push(gated);
            }
            (_, 8) => {
                ids = pending.iter().take(2).copied().collect();
                ids.push(id(ID_POOL + 1));
            }
            (_, 9) => {
                ids = pending.iter().take(2).copied().collect();
                expected_revision += 1;
            }
            _ => {
                let count = self.rng.range(1, free.len().max(1) as u64) as usize;
                let mut pool = free.clone();
                for _ in 0..count.min(pool.len()) {
                    let index = self.rng.below(pool.len() as u64) as usize;
                    ids.push(pool.swap_remove(index));
                }
            }
        }
        let expected = self.model.freeze(expected_revision, &ids);
        let actual = self
            .ledger()
            .freeze_upload_batch(expected_revision, &ids)
            .map(|frozen| (frozen.first_sequence, frozen.operation_count));
        crate::check!(
            self.context,
            actual == expected,
            "freeze outcome {actual:?} matches the model {expected:?}"
        );
        if expected.is_ok() {
            self.counters.freezes += 1;
        } else {
            self.counters.refused_freezes += 1;
        }
    }

    fn command_settle(&mut self) {
        let Some(sender) = self.model.sender.clone() else {
            return;
        };
        let choice = self.rng.below(12);
        if choice == 0 {
            if let Some(last) = sender.last_journal.clone() {
                let expected = self.model.settle(
                    &last,
                    &SettlePlan {
                        status: wire::JournalStatus::Rejected,
                        outcomes: vec![],
                        journal_revision: 0,
                    },
                );
                let actual = self.ledger().settle_upload_batch(&last);
                crate::check!(
                    self.context,
                    actual == expected
                        && matches!(actual, Ok(BatchSettlement::AlreadySettled { .. })),
                    "replayed journal is already settled: {actual:?}"
                );
                self.counters.replayed_settlements += 1;
                return;
            }
        }
        if choice == 1 {
            if let Some(older) = sender.older_journal.clone() {
                let actual = self.ledger().settle_upload_batch(&older);
                crate::check!(
                    self.context,
                    actual == Err(Error::InvalidReceipt),
                    "an older journal never settles a later flight: {actual:?}"
                );
                return;
            }
        }
        let Some(frozen) = self.ledger().inflight_batch().expect("inflight") else {
            crate::check!(
                self.context,
                sender.inflight.is_none(),
                "no flight in either view"
            );
            return;
        };
        let count = usize::from(frozen.operation_count);
        let members: Vec<Id> = sender
            .inflight
            .as_ref()
            .expect("model flight")
            .members
            .iter()
            .map(|m| m.0)
            .collect();
        let reject = self.rng.chance(self.weights.reject, 1_000);
        let (status, outcomes) = if !reject {
            let outcomes = members
                .iter()
                .map(
                    |id| match (sender.accepted.contains(id), self.rng.below(4)) {
                        (_, 0) => wire::Outcome::Duplicate,
                        (true, _) => wire::Outcome::Replaced,
                        (false, _) => wire::Outcome::Inserted,
                    },
                )
                .collect();
            (wire::JournalStatus::Accepted, outcomes)
        } else if self.rng.chance(1, 16) {
            (
                wire::JournalStatus::Rejected,
                vec![wire::Outcome::DeviceRevoked; count],
            )
        } else {
            let mut outcomes: Vec<wire::Outcome> = (0..count)
                .map(|_| match self.rng.below(8) {
                    0 => wire::Outcome::PredecessorConflict,
                    1 => wire::Outcome::SubjectDeleted,
                    _ => wire::Outcome::BatchAborted,
                })
                .collect();
            let anchor = self.rng.below(count as u64) as usize;
            outcomes[anchor] = wire::Outcome::PredecessorConflict;
            (wire::JournalStatus::Rejected, outcomes)
        };
        let plan = SettlePlan {
            status,
            outcomes,
            journal_revision: sender.journal_revision + 1 + self.rng.below(3),
        };
        let bytes = journal(&frozen, &plan);
        let expected = self.model.settle(&bytes, &plan);
        let actual = self.ledger().settle_upload_batch(&bytes);
        crate::check!(
            self.context,
            actual == expected,
            "settlement {actual:?} matches the model {expected:?}"
        );
        match actual {
            Ok(BatchSettlement::Accepted { .. }) => self.counters.settlements += 1,
            Ok(BatchSettlement::Rejected { .. }) => self.counters.rejected_settlements += 1,
            _ => {}
        }
        // The same terminal journal settles at most once.
        let replay = self.ledger().settle_upload_batch(&bytes);
        let before = self.model.revision;
        crate::check!(
            self.context,
            replay
                == Ok(BatchSettlement::AlreadySettled {
                    ledger_revision: before
                }),
            "duplicate settlement is idempotent: {replay:?}"
        );
        self.counters.replayed_settlements += 1;
    }

    fn command_reopen(&mut self) {
        let sender_enabled = self.model.sender.is_some();
        let before = observe(self.context, self.open(), sender_enabled);
        drop(self.ledger.take());
        let reopened =
            Ledger::open_with_identity(&self.fixture.dir(), &identity()).expect("reopen");
        let after = observe(self.context, &reopened, self.model.sender.is_some());
        crate::check!(
            self.context,
            before == after,
            "a reopened ledger observes identical state"
        );
        self.ledger = Some(reopened);
        self.counters.reopens += 1;
    }

    fn files(&self) -> BTreeMap<String, Vec<u8>> {
        let mut files = BTreeMap::new();
        for entry in fs::read_dir(self.fixture.dir()).expect("state directory") {
            let entry = entry.expect("entry");
            let name = entry.file_name().to_string_lossy().into_owned();
            let kind = entry.file_type().expect("file type");
            crate::check!(
                self.context,
                kind.is_file(),
                "state holds only regular files"
            );
            files.insert(name, fs::read(entry.path()).expect("state file"));
        }
        files
    }

    fn command_backup(&mut self) {
        drop(self.ledger.take());
        let files = self.files();
        crate::check!(
            self.context,
            files.contains_key("usage.sqlite3"),
            "a closed ledger is one database file"
        );
        self.backup = Some((self.model.clone(), files));
        self.ledger =
            Some(Ledger::open_with_identity(&self.fixture.dir(), &identity()).expect("reopen"));
    }

    fn command_restore(&mut self) {
        let Some((model, files)) = self.backup.clone() else {
            return;
        };
        drop(self.ledger.take());
        let dir = self.fixture.dir();
        for name in self.files().keys() {
            if !files.contains_key(name) {
                fs::remove_file(dir.join(name)).expect("remove sidecar");
            }
        }
        for (name, bytes) in &files {
            write_private(&dir.join(name), bytes);
        }
        self.model = model;
        self.ledger =
            Some(Ledger::open_with_identity(&dir, &identity()).expect("restored ledger opens"));
        self.counters.restores += 1;
    }
}

fn write_private(path: &Path, bytes: &[u8]) {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .expect("restore target");
    file.write_all(bytes).expect("restore bytes");
    file.sync_all().expect("restore sync");
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).expect("restore mode");
}

#[test]
fn ledger_command_sequences_conserve_totals_revisions_settlement_and_restart_state() {
    const SUITE: &str = "ledger-commands";
    let config = config_from_env();
    for seed in &config.seeds {
        let fixture = Fixture::new(seed);
        let ledger = Ledger::initialize_with_identity(&fixture.dir(), &identity())
            .expect("fresh private ledger");
        let mut run = Run {
            context: Context {
                suite: SUITE,
                seed,
                iteration: 0,
            },
            rng: Rng::new(seed.value),
            weights: weights(seed),
            fixture,
            ledger: Some(ledger),
            model: Model::default(),
            backup: None,
            next_source: 0,
            counters: Counters::default(),
        };
        let mut last_revision = 0;
        for iteration in 0..config.ledger_commands {
            run.context.iteration = iteration;
            let restores_before = run.counters.restores;
            let draw = run.rng.below(1_000);
            let sender_share = run.weights.sender;
            let reopen_share = run.weights.reopen;
            if draw < reopen_share {
                match run.rng.below(4) {
                    0 => run.command_backup(),
                    1 => run.command_restore(),
                    _ => run.command_reopen(),
                }
            } else if draw < reopen_share + sender_share {
                if run.model.sender.is_none() {
                    if run.model.pending.is_empty() {
                        run.command_commit();
                    } else {
                        run.command_migrate();
                    }
                } else if run.rng.chance(1, 2) {
                    run.command_freeze();
                } else {
                    run.command_settle();
                }
            } else {
                run.command_commit();
            }
            let observed = check_model(run.context, run.open(), &run.model);
            if run.counters.restores == restores_before {
                crate::check!(
                    run.context,
                    observed.revision >= last_revision,
                    "revisions never regress without an explicit restore"
                );
            }
            last_revision = observed.revision;
        }
        let closing = observe(run.context, run.open(), run.model.sender.is_some());
        drop(run.ledger.take());
        let reopened =
            Ledger::open_with_identity(&run.fixture.dir(), &identity()).expect("final reopen");
        crate::check!(
            run.context,
            observe(run.context, &reopened, run.model.sender.is_some()) == closing,
            "final restart equivalence"
        );
        drop(reopened);
        let counters = &run.counters;
        println!(
            "{}",
            receipt_line(
                SUITE,
                seed,
                config.ledger_commands,
                &[
                    ("commits", counters.commits),
                    ("refused_commits", counters.refused_commits),
                    ("conflicts", counters.conflicts),
                    ("projection_refusals", counters.projection_refusals),
                    ("freezes", counters.freezes),
                    ("refused_freezes", counters.refused_freezes),
                    ("accepted_settlements", counters.settlements),
                    ("rejected_settlements", counters.rejected_settlements),
                    ("replayed_settlements", counters.replayed_settlements),
                    ("reopens", counters.reopens),
                    ("restores", counters.restores),
                    ("final_revision", run.model.revision),
                    ("final_occurrences", run.model.measurements.len() as u64),
                ]
            )
        );
    }
}
