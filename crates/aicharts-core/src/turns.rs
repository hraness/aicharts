//! Metadata-only Codex lifecycle evidence and observed daily runtime. This module
//! opens no files and has no network API. It does not extend AICU or the ledger.
//!
//! `completed` means a provider-declared non-aborted terminal, including terminal
//! errors. Runtime is the provider's independent elapsed milliseconds, not epoch
//! subtraction, active work, task success, or a complete population measurement.

mod container;
mod observations;
mod reader;
mod schema;

use crate::{keyed_id, MAX_LINES};
use aicharts_protocol::Id;
use hmac::{Hmac, Mac};
use schema::{AppendTime, Entry, Field, Kind, Number, Object, Payload};
use sha2::Sha256;
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    io::BufRead,
};

pub const PROFILE_VERSION: u16 = 2;
pub const MAX_SOURCE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_SOURCES: u32 = 2048;
pub const MAX_OBSERVATIONS: u64 = 65_536;
pub const MAX_DURATION_MS: u64 = 31 * 86_400_000;
pub const MAX_TIMESTAMP_SECONDS: u64 = 8_640_000_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TurnError {
    ReadFailed,
    MalformedRecord,
    LineTooLarge,
    TooDeep,
    RecordLimit,
    ByteLimit,
    SourceLimit,
    ObservationLimit,
    MissingSession,
    SessionTreeMismatch,
    MetadataSessionConflict,
    ContainerIdentityAmbiguous,
    InheritedObservationOwnership,
    UnsupportedHistory,
    ConflictingEvidence,
    KeyNamespaceMismatch,
    InvalidKey,
    NoSources,
    InvalidLimits,
}
impl TurnError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::ReadFailed => "turn_read_failed",
            Self::MalformedRecord => "turn_malformed_record",
            Self::LineTooLarge => "turn_line_too_large",
            Self::TooDeep => "turn_record_too_deep",
            Self::RecordLimit => "turn_record_limit",
            Self::ByteLimit => "turn_byte_limit",
            Self::SourceLimit => "turn_source_limit",
            Self::ObservationLimit => "turn_observation_limit",
            Self::MissingSession => "turn_missing_session",
            Self::SessionTreeMismatch => "turn_session_tree_mismatch",
            Self::MetadataSessionConflict => "turn_metadata_session_conflict",
            Self::ContainerIdentityAmbiguous => "turn_container_identity_ambiguous",
            Self::InheritedObservationOwnership => "turn_inherited_observation_ownership",
            Self::UnsupportedHistory => "turn_unsupported_history",
            Self::ConflictingEvidence => "turn_conflicting_evidence",
            Self::KeyNamespaceMismatch => "turn_key_namespace_mismatch",
            Self::InvalidKey => "turn_invalid_key",
            Self::NoSources => "turn_no_sources",
            Self::InvalidLimits => "turn_invalid_limits",
        }
    }
}
impl fmt::Display for TurnError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for TurnError {}

/// Caller-selected remaining budgets, bounded by profile2's hard ceilings.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TurnReadLimits {
    bytes: u64,
    physical_records: u64,
    raw_observations: u64,
}

impl TurnReadLimits {
    pub fn new(
        bytes: u64,
        physical_records: u64,
        raw_observations: u64,
    ) -> Result<Self, TurnError> {
        let limits = Self {
            bytes,
            physical_records,
            raw_observations,
        };
        limits.validate()?;
        Ok(limits)
    }
    pub const fn full() -> Self {
        Self {
            bytes: MAX_SOURCE_BYTES,
            physical_records: MAX_LINES,
            raw_observations: MAX_OBSERVATIONS,
        }
    }
    fn validate(self) -> Result<(), TurnError> {
        if self.bytes > MAX_SOURCE_BYTES
            || self.physical_records > MAX_LINES
            || self.raw_observations > MAX_OBSERVATIONS
        {
            Err(TurnError::InvalidLimits)
        } else {
            Ok(())
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum TurnDiagnostic {
    PartialHistory,
    PartialTail,
    UnknownSession,
    UnknownOrigin,
    UnsupportedAncestry,
    UnknownRoot,
    NonRootTurn,
    MissingTurnIdentity,
    MissingTerminal,
    MissingStart,
    InvalidStartTimestamp,
    AmbiguousTurnAttempt,
    MissingCompletionTime,
    UnavailableRuntime,
    StartTimingMismatch,
    SourceClockRegression,
    UnmeasuredTokens,
    UnmeasuredTools,
    PartialObservations,
    UnownedUsage,
    MissingResponseTotal,
    UnownedCall,
    UnsupportedResponseItem,
    InheritedMetadataOnly,
}
impl TurnDiagnostic {
    pub const fn code(self) -> &'static str {
        match self {
            Self::PartialHistory => "partial_history",
            Self::PartialTail => "partial_tail",
            Self::UnknownSession => "unknown_session",
            Self::UnknownOrigin => "unknown_origin",
            Self::UnsupportedAncestry => "unsupported_ancestry",
            Self::UnknownRoot => "unknown_root",
            Self::NonRootTurn => "non_root_turn",
            Self::MissingTurnIdentity => "missing_turn_identity",
            Self::MissingTerminal => "missing_terminal",
            Self::MissingStart => "missing_start",
            Self::InvalidStartTimestamp => "invalid_start_timestamp",
            Self::AmbiguousTurnAttempt => "ambiguous_turn_attempt",
            Self::MissingCompletionTime => "missing_completion_time",
            Self::UnavailableRuntime => "unavailable_runtime",
            Self::StartTimingMismatch => "start_timing_mismatch",
            Self::SourceClockRegression => "source_clock_regression",
            Self::UnmeasuredTokens => "unmeasured_tokens",
            Self::UnmeasuredTools => "unmeasured_tools",
            Self::PartialObservations => "partial_observations",
            Self::UnownedUsage => "unowned_usage",
            Self::MissingResponseTotal => "missing_response_total",
            Self::UnownedCall => "unowned_call",
            Self::UnsupportedResponseItem => "unsupported_response_item",
            Self::InheritedMetadataOnly => "inherited_metadata_only",
        }
    }
}

#[derive(Clone, Default, PartialEq, Eq)]
struct ThreadEvidence {
    excluded: bool,
    unknown_session: bool,
    session: Option<Id>,
    shared_session_shape: bool,
    inherited_history: bool,
    has_selected_observations: bool,
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Start {
    append: Field<AppendTime>,
    started_at: Field<Number>,
    root: Field<Id>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Completed,
    Aborted,
}

#[derive(Clone, PartialEq, Eq)]
struct Terminal {
    outcome: Outcome,
    started_at: Field<Number>,
    completed_at: Field<Number>,
    duration_ms: Field<Number>,
}

#[derive(Clone, Default, PartialEq, Eq)]
struct TurnEvidence {
    starts: BTreeSet<Start>,
    terminal: Option<Terminal>,
}

impl TurnEvidence {
    fn merge(&mut self, incoming: &Self) -> Result<(), TurnError> {
        if let Some(incoming) = &incoming.terminal {
            if self.terminal.as_ref().is_some_and(|old| old != incoming) {
                return Err(TurnError::ConflictingEvidence);
            }
            self.terminal = Some(incoming.clone());
        }
        // Conflicts are checked before ancestry or root-cohort filtering.
        let mut explicit_root = None;
        for start in self.starts.iter().chain(&incoming.starts) {
            if let Field::Value(root) = start.root {
                if explicit_root.is_some_and(|old| old != root) {
                    return Err(TurnError::ConflictingEvidence);
                }
                explicit_root = Some(root);
            }
        }
        self.starts.extend(incoming.starts.iter().cloned());
        Ok(())
    }
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Budget {
    sources: u32,
    lines: u64,
    bytes: u64,
    observations: u64,
    partial_sources: u32,
}
impl Budget {
    fn add(&mut self, other: Self) -> Result<(), TurnError> {
        fn sum(a: u64, b: u64, limit: u64, error: TurnError) -> Result<u64, TurnError> {
            a.checked_add(b)
                .filter(|value| *value <= limit)
                .ok_or(error)
        }
        let next = Self {
            sources: sum(
                self.sources.into(),
                other.sources.into(),
                MAX_SOURCES.into(),
                TurnError::SourceLimit,
            )? as u32,
            lines: sum(self.lines, other.lines, MAX_LINES, TurnError::RecordLimit)?,
            bytes: sum(
                self.bytes,
                other.bytes,
                MAX_SOURCE_BYTES,
                TurnError::ByteLimit,
            )?,
            observations: sum(
                self.observations,
                other.observations,
                MAX_OBSERVATIONS,
                TurnError::ObservationLimit,
            )?,
            partial_sources: sum(
                self.partial_sources.into(),
                other.partial_sources.into(),
                MAX_SOURCES.into(),
                TurnError::SourceLimit,
            )? as u32,
        };
        *self = next;
        Ok(())
    }
}

/// Reader-owned evidence, not a caller-constructible ingestion DTO. It retains
/// keyed identities and bounded start/terminal evidence for safe cross-file joins.
/// No raw identifiers, content, occurrence key, or serialization API are retained.
#[derive(Clone)]
pub struct TurnCollection {
    key_namespace: [u8; 32],
    budget: Budget,
    threads: BTreeMap<Id, ThreadEvidence>,
    turns: BTreeMap<(Id, Id), TurnEvidence>,
    diagnostics: BTreeSet<TurnDiagnostic>,
    observations: observations::Observations,
}

/// A partial source subtotal. Presence of one zero report is evidence; absence
/// of reports is not evidence for zero work. `observations` counts distinct
/// response/call identities; `turns_with_evidence` counts their distinct owners.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ObservedMetric {
    pub sum: u64,
    pub turns_with_evidence: u64,
    pub observations: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ObservedSubtotals {
    pub response_tokens: ObservedMetric,
    pub requested_calls: ObservedMetric,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RuntimeCohort {
    pub observed_turns: u64,
    pub runtime_eligible_turns: u64,
    pub runtime_ms_sum: u64,
    pub observed_subtotals: ObservedSubtotals,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DailyRuntime {
    pub utc_day: u32,
    pub completed: RuntimeCohort,
    pub aborted: RuntimeCohort,
}

/// Exact sums and counts; mean is unavailable when eligible count is zero.
/// Origin and provider-account attribution remain unknown. Tokens and tools are
/// always None in profile2; no field claims an enumerated terminal population.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DailyTurnSummary {
    pub days: Vec<DailyRuntime>,
    pub coverage_complete: bool,
    pub tokens: Option<u64>,
    pub tool_calls: Option<u64>,
    pub sources_read: u32,
    /// Includes each observed partial tail as one physical record.
    pub lines_read: u64,
    pub bytes_scanned: u64,
    pub raw_observations: u64,
    pub partial_sources: u32,
    pub unclassified_terminal_turns: u64,
    pub undated_root_turns: u64,
    pub excluded_threads: u32,
    pub diagnostics: Vec<TurnDiagnostic>,
}

fn key_namespace(key: &[u8; 32]) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts every key length");
    mac.update(b"aicharts:codex-turn-key-namespace:v1\0");
    mac.finalize().into_bytes().into()
}

fn empty(key_namespace: [u8; 32]) -> TurnCollection {
    TurnCollection {
        key_namespace,
        budget: Budget::default(),
        threads: BTreeMap::new(),
        turns: BTreeMap::new(),
        diagnostics: BTreeSet::new(),
        observations: observations::Observations::default(),
    }
}

/// Read one caller-owned stream. Only completed-LF records can contribute
/// evidence; an incomplete tail is deferred without inferring a terminal event.
/// Fixed errors contain no source values or locations.
pub fn parse_codex_turns<R: BufRead>(
    reader: R,
    occurrence_key: &[u8; 32],
) -> Result<TurnCollection, TurnError> {
    parse_codex_turns_with_limits(reader, occurrence_key, TurnReadLimits::full())
}

/// Apply the caller's remaining global budget during parsing. The first excess
/// selected observation must be read to identify its kind, but is never contributed;
/// at most that one bounded physical record is consumed before refusal. An
/// exhausted physical-record budget only peeks for EOF and consumes no next row.
pub fn parse_codex_turns_with_limits<R: BufRead>(
    reader: R,
    occurrence_key: &[u8; 32],
    limits: TurnReadLimits,
) -> Result<TurnCollection, TurnError> {
    limits.validate()?;
    if occurrence_key == &[0; 32] {
        return Err(TurnError::InvalidKey);
    }
    let mut out = empty(key_namespace(occurrence_key));
    out.budget.sources = 1;
    let mut source = reader::Budget::new(reader, limits.bytes);
    let mut container = container::Container::default();
    loop {
        if out.budget.lines == limits.physical_records {
            if reader::has_bytes(&mut source)? {
                return Err(TurnError::RecordLimit);
            }
            break;
        }
        let record = reader::next::<_, Entry>(&mut source)?;
        if matches!(record, reader::Record::End) {
            break;
        }
        out.budget.add(Budget {
            lines: 1,
            ..Budget::default()
        })?;
        match record {
            reader::Record::End => unreachable!("checked before counting"),
            reader::Record::Partial => {
                out.budget.partial_sources = 1;
                out.diagnostics.insert(TurnDiagnostic::PartialTail);
                break;
            }
            reader::Record::Complete(None) => {}
            reader::Record::Complete(Some(entry)) => match entry.kind {
                Kind::SessionMeta => {
                    let Object::Value(payload) = entry.payload else {
                        return Err(TurnError::MalformedRecord);
                    };
                    container.metadata(&payload, occurrence_key, &mut out)?;
                }
                Kind::EventMsg => {
                    if let Object::Value(payload) = entry.payload {
                        if matches!(
                            payload.kind,
                            Kind::Started | Kind::Complete | Kind::TurnAborted
                        ) {
                            charge_observation(&mut out, limits)?;
                            validate_lifecycle(&payload)?;
                            let thread = container
                                .observe(&mut out)?
                                .ok_or(TurnError::MissingSession)?;
                            lifecycle(payload, entry.timestamp, thread, occurrence_key, &mut out)?;
                        }
                    }
                }
                Kind::TokenUsageRecord => {
                    charge_observation(&mut out, limits)?;
                    let payload = match entry.payload {
                        Object::Value(payload) => payload,
                        Object::Missing | Object::Null => Payload::default(),
                        Object::Invalid => return Err(TurnError::MalformedRecord),
                    };
                    observations::validate_token(&payload)?;
                    let session = container.observe(&mut out)?;
                    let turn = out.observations.token(
                        &payload,
                        session,
                        occurrence_key,
                        &mut out.diagnostics,
                    )?;
                    if let Some(owner) = turn {
                        out.turns.entry(owner).or_default();
                    }
                }
                Kind::ResponseItem => match entry.payload {
                    Object::Invalid => return Err(TurnError::MalformedRecord),
                    Object::Missing | Object::Null => {
                        out.diagnostics
                            .insert(TurnDiagnostic::UnsupportedResponseItem);
                    }
                    Object::Value(payload) => {
                        if observations::is_call(payload.kind) {
                            charge_observation(&mut out, limits)?;
                            observations::validate_call(&payload)?;
                            let session = container.observe(&mut out)?;
                            let turn = out.observations.call(
                                &payload,
                                session,
                                occurrence_key,
                                &mut out.diagnostics,
                            )?;
                            if let Some(owner) = turn {
                                out.turns.entry(owner).or_default();
                            }
                        } else if payload.kind == Kind::Other {
                            out.diagnostics
                                .insert(TurnDiagnostic::UnsupportedResponseItem);
                        }
                    }
                },
                _ => {}
            },
        }
    }
    out.budget.bytes = source.bytes;
    out.observations.validate_roots(&out.turns)?;
    container.finish(&mut out)?;
    Ok(out)
}

fn charge_observation(out: &mut TurnCollection, limits: TurnReadLimits) -> Result<(), TurnError> {
    if out.budget.observations == limits.raw_observations {
        return Err(TurnError::ObservationLimit);
    }
    out.budget.add(Budget {
        observations: 1,
        ..Budget::default()
    })
}

fn validate_lifecycle(payload: &Payload) -> Result<(), TurnError> {
    if matches!(payload.turn_id, Field::Invalid)
        || matches!(payload.root_turn_id, Field::Invalid)
        || matches!(payload.started_at, Field::Invalid)
        || matches!(payload.completed_at, Field::Invalid)
        || matches!(payload.duration_ms, Field::Invalid)
    {
        return Err(TurnError::MalformedRecord);
    }
    Ok(())
}

fn lifecycle(
    payload: Payload,
    append: Field<AppendTime>,
    thread: Id,
    key: &[u8; 32],
    out: &mut TurnCollection,
) -> Result<(), TurnError> {
    validate_lifecycle(&payload)?;
    let Field::Value(native) = payload.turn_id else {
        out.diagnostics.insert(TurnDiagnostic::MissingTurnIdentity);
        return Ok(());
    };
    let turn = keyed_id(
        key,
        b"codex-logical-turn-v1",
        &[&thread, native.0.as_bytes()],
    );
    let mut incoming = TurnEvidence::default();
    if payload.kind == Kind::Started {
        let root = match payload.root_turn_id {
            Field::Value(root) => Field::Value(keyed_id(
                key,
                b"codex-logical-turn-v1",
                &[&thread, root.0.as_bytes()],
            )),
            Field::Missing => Field::Missing,
            Field::Null => Field::Null,
            Field::Invalid => return Err(TurnError::MalformedRecord),
        };
        incoming.starts.insert(Start {
            append,
            started_at: payload.started_at,
            root,
        });
    } else {
        incoming.terminal = Some(Terminal {
            outcome: if payload.kind == Kind::Complete {
                Outcome::Completed
            } else {
                Outcome::Aborted
            },
            started_at: payload.started_at,
            completed_at: payload.completed_at,
            duration_ms: payload.duration_ms,
        });
    }
    out.turns
        .entry((thread, turn))
        .or_default()
        .merge(&incoming)
}

/// Merge all selected sources before publishing a day. Every source still
/// consumes its raw byte/line/selected-observation budget before deduplication. Collections
/// made with different occurrence keys cannot be merged, including empty inputs.
pub fn merge_turn_collections(collections: &[TurnCollection]) -> Result<TurnCollection, TurnError> {
    let first = collections.first().ok_or(TurnError::NoSources)?;
    let mut budget = Budget::default();
    for collection in collections {
        if collection.key_namespace != first.key_namespace {
            return Err(TurnError::KeyNamespaceMismatch);
        }
        budget.add(collection.budget)?;
    }
    let mut out = empty(first.key_namespace);
    out.budget = budget;
    for collection in collections {
        out.observations.merge(&collection.observations)?;
        out.diagnostics.extend(&collection.diagnostics);
        for (id, incoming) in &collection.threads {
            out.threads.entry(*id).or_default().merge(incoming)?;
        }
        for (id, incoming) in &collection.turns {
            out.turns.entry(*id).or_default().merge(incoming)?;
        }
    }
    out.observations.validate_roots(&out.turns)?;
    for thread in out.threads.values() {
        thread.validate_ownership()?;
    }
    Ok(out)
}

fn bounded_number(value: &Field<Number>, max: u64) -> Option<u64> {
    match value {
        Field::Value(Number::Unsigned(value)) if *value <= max => Some(*value),
        _ => None,
    }
}

impl TurnCollection {
    /// Infallible because private evidence is bounded by 65,536 raw observations
    /// and each eligible duration by 2,678,400,000 ms. Runtime sum is at most
    /// 175,531,622,400,000 ms; reported token sum is at most 65,536 * 10^12,
    /// both below u64::MAX. The terminal UTC day is at most 100,000,000.
    pub fn daily_summary(&self) -> DailyTurnSummary {
        let mut diagnostics = self.diagnostics.clone();
        diagnostics.extend([
            TurnDiagnostic::PartialHistory,
            TurnDiagnostic::UnknownOrigin,
            TurnDiagnostic::UnmeasuredTokens,
            TurnDiagnostic::UnmeasuredTools,
            TurnDiagnostic::PartialObservations,
        ]);
        let subtotals = self.observations.by_turn();
        let mut days = BTreeMap::<u32, DailyRuntime>::new();
        let mut unclassified_terminal_turns = 0;
        let mut undated_root_turns = 0;
        let mut excluded_threads = 0;
        for thread in self.threads.values() {
            if thread.excluded {
                excluded_threads += 1;
                diagnostics.insert(TurnDiagnostic::UnsupportedAncestry);
            }
            if thread.unknown_session {
                diagnostics.insert(TurnDiagnostic::UnknownSession);
            }
        }
        for ((thread, turn), evidence) in &self.turns {
            if evidence.starts.is_empty() {
                diagnostics.insert(TurnDiagnostic::MissingStart);
            }
            if evidence.starts.len() > 1 {
                diagnostics.insert(TurnDiagnostic::AmbiguousTurnAttempt);
            }
            let invalid_append = evidence
                .starts
                .iter()
                .any(|start| !matches!(start.append, Field::Value(_)));
            if invalid_append {
                diagnostics.insert(TurnDiagnostic::InvalidStartTimestamp);
            }
            let child = evidence
                .starts
                .iter()
                .any(|start| matches!(start.root, Field::Value(root) if root != *turn));
            let root = !evidence.starts.is_empty()
                && evidence
                    .starts
                    .iter()
                    .all(|start| start.root == Field::Value(*turn));
            if child {
                diagnostics.insert(TurnDiagnostic::NonRootTurn);
            } else if !root {
                diagnostics.insert(TurnDiagnostic::UnknownRoot);
            }
            let Some(terminal) = &evidence.terminal else {
                diagnostics.insert(TurnDiagnostic::MissingTerminal);
                continue;
            };
            if self.threads.get(thread).is_none_or(|meta| meta.excluded) || !root {
                unclassified_terminal_turns += 1;
                continue;
            }
            let Some(end) = bounded_number(&terminal.completed_at, MAX_TIMESTAMP_SECONDS) else {
                undated_root_turns += 1;
                diagnostics.insert(TurnDiagnostic::MissingCompletionTime);
                continue;
            };
            if bounded_number(&terminal.started_at, MAX_TIMESTAMP_SECONDS)
                .is_some_and(|start| start > end)
            {
                diagnostics.insert(TurnDiagnostic::SourceClockRegression);
            }
            let utc_day = (end / 86_400) as u32;
            let day = days.entry(utc_day).or_insert_with(|| DailyRuntime {
                utc_day,
                ..DailyRuntime::default()
            });
            let cohort = match terminal.outcome {
                Outcome::Completed => &mut day.completed,
                Outcome::Aborted => &mut day.aborted,
            };
            cohort.observed_turns += 1;
            if let Some(observed) = subtotals.get(&(*thread, *turn)) {
                cohort.observed_subtotals.add(observed);
            }
            let start_mismatch = evidence.starts.len() == 1
                && evidence.starts.iter().any(|start| {
                    match (
                        bounded_number(&start.started_at, MAX_TIMESTAMP_SECONDS),
                        bounded_number(&terminal.started_at, MAX_TIMESTAMP_SECONDS),
                    ) {
                        (Some(a), Some(b)) => a != b,
                        _ => false,
                    }
                });
            if start_mismatch {
                diagnostics.insert(TurnDiagnostic::StartTimingMismatch);
            }
            let duration = bounded_number(&terminal.duration_ms, MAX_DURATION_MS)
                .filter(|_| evidence.starts.len() == 1 && !invalid_append && !start_mismatch);
            if let Some(duration) = duration {
                cohort.runtime_eligible_turns += 1;
                cohort.runtime_ms_sum += duration;
            } else {
                diagnostics.insert(TurnDiagnostic::UnavailableRuntime);
            }
        }
        DailyTurnSummary {
            days: days.into_values().collect(),
            coverage_complete: false,
            tokens: None,
            tool_calls: None,
            sources_read: self.budget.sources,
            lines_read: self.budget.lines,
            bytes_scanned: self.budget.bytes,
            raw_observations: self.budget.observations,
            partial_sources: self.budget.partial_sources,
            unclassified_terminal_turns,
            undated_root_turns,
            excluded_threads,
            diagnostics: diagnostics.into_iter().collect(),
        }
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod properties;

#[cfg(test)]
mod limits_tests;

#[cfg(test)]
mod observations_tests;

#[cfg(test)]
mod container_tests;
