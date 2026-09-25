//! Local, metadata-only JSONL import. This crate opens no files and has no network API.
//!
//! Callers supply a reader and a private, stable namespace key. Source identities are
//! HMAC-derived from native metadata, never content, paths, device identity or line
//! position. See README.md for coverage limits; successful parsing is not attestation.

pub mod contribution_producer;
mod reader;
pub mod rich_facts;
mod schema;
pub mod sessions;
pub mod turns;

use aicharts_protocol::{AuthMode, Batch, Evidence, Id, Provider, Tokens, Usage};
use hmac::{Hmac, Mac};
use schema::*;
use sha2::Sha256;
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fmt,
    io::{BufRead, Read},
};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

pub use reader::{MAX_DEPTH, MAX_LINE_BYTES};
pub const MAX_LINES: u64 = 100_000;
pub const MAX_MEASUREMENTS: usize = 100_000;
/// One ATIF transcript is a whole JSON document; this bounds a single file,
/// not the multi-source byte total the CLI applies above it.
pub const MAX_DOC_BYTES: u64 = 64 * 1024 * 1024;
const TOKEN_LIMIT: u64 = aicharts_metrics::MAX_WIRE_TOKEN_COUNTER;
const DAY_MS: u64 = 86_400_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    ReadFailed,
    MalformedRecord,
    LineTooLarge,
    TooDeep,
    RecordLimit,
    InvalidCounters,
    ConflictingOccurrence,
    SessionIdentityChanged,
}
impl Error {
    pub const fn code(self) -> &'static str {
        match self {
            Self::ReadFailed => "read_failed",
            Self::MalformedRecord => "malformed_record",
            Self::LineTooLarge => "line_too_large",
            Self::TooDeep => "record_too_deep",
            Self::RecordLimit => "record_limit",
            Self::InvalidCounters => "invalid_counters",
            Self::ConflictingOccurrence => "conflicting_occurrence",
            Self::SessionIdentityChanged => "session_identity_changed",
        }
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for Error {}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Warning {
    MissingIdentity,
    MissingTimestamp,
    MissingUsageCounters,
    UnsupportedRecords,
    CodexInitialBaselineOmitted,
    CodexForkUnsupported,
    CodexCumulativeRegression,
    CodexMissingCumulative,
    ClaudeCacheTtlUnknown,
    DevinTotalsMismatch,
    UnknownExecution,
    UnknownModels,
    UnmeasuredActivity,
    UnmeasuredPrompts,
    UnmeasuredReasoning,
    NoUsageMeasurements,
}
impl Warning {
    pub const fn code(self) -> &'static str {
        match self {
            Self::MissingIdentity => "missing_identity",
            Self::MissingTimestamp => "missing_timestamp",
            Self::MissingUsageCounters => "missing_usage_counters",
            Self::UnsupportedRecords => "unsupported_records",
            Self::CodexInitialBaselineOmitted => "codex_initial_baseline_omitted",
            Self::CodexForkUnsupported => "codex_fork_unsupported",
            Self::CodexCumulativeRegression => "codex_cumulative_regression",
            Self::CodexMissingCumulative => "codex_missing_cumulative",
            Self::ClaudeCacheTtlUnknown => "claude_cache_ttl_unknown",
            Self::DevinTotalsMismatch => "devin_totals_mismatch",
            Self::UnknownExecution => "unknown_execution",
            Self::UnknownModels => "unknown_models",
            Self::UnmeasuredActivity => "unmeasured_activity",
            Self::UnmeasuredPrompts => "unmeasured_prompts",
            Self::UnmeasuredReasoning => "unmeasured_reasoning",
            Self::NoUsageMeasurements => "no_usage_measurements",
        }
    }
}

#[derive(Debug)]
pub struct Collection {
    pub batches: Vec<Batch>,
    pub warnings: Vec<Warning>,
    pub lines_read: u64,
}

#[derive(Default)]
struct Accumulator {
    usage: BTreeMap<Id, (u32, Usage)>,
    warnings: BTreeSet<Warning>,
    lines_read: u64,
}
impl Accumulator {
    fn warn(&mut self, warning: Warning) {
        self.warnings.insert(warning);
    }

    fn add(&mut self, day: u32, usage: Usage) -> Result<(), Error> {
        if let Some((old_day, old)) = self.usage.get_mut(&usage.id) {
            if !same_source(old, &usage) {
                // Missing attribution may be enriched; two known owners are
                // conflicting evidence. Arrival order is never owner authority.
                if !same_context(old, &usage) {
                    return Err(Error::ConflictingOccurrence);
                }
                old.execution_id = aicharts_metrics::merge_owner(
                    old.execution_id,
                    usage.execution_id,
                    usage.provider == Provider::ClaudeCode,
                )
                .map_err(|_| Error::ConflictingOccurrence)?;
            }
            if usage.provider == Provider::Codex {
                if *old_day != day
                    || old.offset_ms != usage.offset_ms
                    || values(&old.tokens) != values(&usage.tokens)
                {
                    return Err(Error::ConflictingOccurrence);
                }
                return Ok(());
            }
            let old_values = values(&old.tokens);
            let new_values = values(&usage.tokens);
            let dominance = aicharts_metrics::component_dominance(old_values, new_values);
            if dominance == aicharts_metrics::Dominance::Conflict {
                return Err(Error::ConflictingOccurrence);
            }
            let final_time = (*old_day, old.offset_ms).max((day, usage.offset_ms));
            if matches!(
                dominance,
                aicharts_metrics::Dominance::Equal | aicharts_metrics::Dominance::Right
            ) {
                old.tokens = usage.tokens;
            }
            *old_day = final_time.0;
            old.offset_ms = final_time.1;
            return Ok(());
        }
        if self.usage.len() >= MAX_MEASUREMENTS {
            return Err(Error::RecordLimit);
        }
        self.usage.insert(usage.id, (day, usage));
        Ok(())
    }

    fn finish(mut self) -> Collection {
        let mut days = BTreeMap::<u32, Vec<Usage>>::new();
        for (_, (day, usage)) in self.usage {
            days.entry(day).or_default().push(usage);
        }
        let mut batches = Vec::new();
        for (utc_day, records) in days {
            let mut records = records.into_iter();
            loop {
                let usage: Vec<_> = records.by_ref().take(4096).collect();
                if usage.is_empty() {
                    break;
                }
                batches.push(Batch {
                    utc_day,
                    registry_revision: 1,
                    usage,
                    prompts: vec![],
                    intervals: vec![],
                });
            }
        }
        self.warnings.insert(Warning::UnmeasuredActivity);
        self.warnings.insert(Warning::UnmeasuredPrompts);
        if batches.is_empty() {
            self.warnings.insert(Warning::NoUsageMeasurements);
        } else {
            self.warnings.insert(Warning::UnknownModels);
        }
        Collection {
            batches,
            warnings: self.warnings.into_iter().collect(),
            lines_read: self.lines_read,
        }
    }
}

fn same_source(a: &Usage, b: &Usage) -> bool {
    a.execution_id == b.execution_id && same_context(a, b)
}

fn same_context(a: &Usage, b: &Usage) -> bool {
    a.account_id == b.account_id
        && a.provider == b.provider
        && a.auth_mode == b.auth_mode
        && a.evidence == b.evidence
        && a.model_id == b.model_id
        && a.context_tier == b.context_tier
}

/// Import a single physical stream; never searches home directories or opens a path.
/// Errors disclose neither the malformed value nor the caller's source location.
pub fn parse_reader<R: BufRead>(
    mut reader: R,
    provider: Provider,
    namespace_key: &[u8; 32],
) -> Result<Collection, Error> {
    let mut out = Accumulator::default();
    match provider {
        Provider::Codex => parse_codex(&mut reader, namespace_key, &mut out)?,
        Provider::ClaudeCode => parse_claude(&mut reader, namespace_key, &mut out)?,
        Provider::Devin => parse_devin(&mut reader, namespace_key, &mut out)?,
    }
    Ok(out.finish())
}

/// Deduplicate copied files and Claude streaming revisions before making totals.
/// This accepts collections produced by these readers, not arbitrary wire batches.
pub fn merge_collections(collections: Vec<Collection>) -> Result<Collection, Error> {
    let mut out = Accumulator::default();
    for collection in collections {
        out.lines_read = out
            .lines_read
            .checked_add(collection.lines_read)
            .ok_or(Error::RecordLimit)?;
        out.warnings.extend(
            collection
                .warnings
                .into_iter()
                .filter(|warning| *warning != Warning::NoUsageMeasurements),
        );
        for batch in collection.batches {
            if batch.registry_revision != 1
                || !batch.prompts.is_empty()
                || !batch.intervals.is_empty()
            {
                return Err(Error::ConflictingOccurrence);
            }
            for usage in batch.usage {
                out.add(batch.utc_day, usage)?;
            }
        }
    }
    Ok(out.finish())
}

fn keyed_id(key: &[u8; 32], domain: &[u8], parts: &[&[u8]]) -> Id {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts every key length");
    mac.update(b"aicharts-usage-v1\0");
    mac.update(&(domain.len() as u64).to_le_bytes());
    mac.update(domain);
    for part in parts {
        mac.update(&(part.len() as u64).to_le_bytes());
        mac.update(part);
    }
    let mut id = [0; 16];
    id.copy_from_slice(&mac.finalize().into_bytes()[..16]);
    // Zero is reserved by the wire; avoid emitting the sentinel even in this
    // astronomically unlikely case. These are scoped pseudonyms, not proof.
    if id == [0; 16] {
        id[0] = 1;
    }
    id
}

fn timestamp(value: Option<&Timestamp>) -> Option<(u32, u32)> {
    let nanos = OffsetDateTime::parse(&value?.0, &Rfc3339)
        .ok()?
        .unix_timestamp_nanos();
    if nanos < 0 {
        return None;
    }
    let ms = nanos / 1_000_000;
    let ms = u64::try_from(ms).ok()?;
    Some((u32::try_from(ms / DAY_MS).ok()?, (ms % DAY_MS) as u32))
}

fn values(t: &Tokens) -> [u64; 6] {
    [
        t.input_uncached,
        t.cache_read,
        t.cache_write_5m,
        t.cache_write_1h,
        t.output,
        t.reasoning_output,
    ]
}
/// Checked u64 counter addition through the kernel: a sum beyond u64 is an
/// invalid counter, never a wrapped or saturated one.
fn add_counter(total: u64, value: u64) -> Result<u64, Error> {
    let sum = aicharts_metrics::checked_add_bounded(
        u128::from(total),
        u128::from(value),
        u128::from(u64::MAX),
    )
    .map_err(|_| Error::InvalidCounters)?;
    u64::try_from(sum).map_err(|_| Error::InvalidCounters)
}
fn bounded(tokens: Tokens) -> Result<Tokens, Error> {
    tokens.total().map_err(|_| Error::InvalidCounters)?;
    Ok(tokens)
}
fn any_tokens(tokens: &Tokens) -> bool {
    values(tokens)[..5].iter().any(|&v| v != 0)
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct CodexCounters {
    input: u64,
    cached: u64,
    output: u64,
    reasoning: u64,
}
impl CodexCounters {
    fn from_usage(raw: &CodexUsage) -> Result<Option<Self>, Error> {
        let (Some(input), Some(output)) = (raw.input_tokens, raw.output_tokens) else {
            return Ok(None);
        };
        let cached = match (raw.cached_input_tokens, raw.cache_read_input_tokens) {
            (Some(a), Some(b)) if a != b => return Err(Error::InvalidCounters),
            (Some(a), _) | (_, Some(a)) => a,
            _ => 0,
        };
        let result = Self {
            input,
            cached,
            output,
            reasoning: raw.reasoning_output_tokens.unwrap_or(0),
        };
        if input > TOKEN_LIMIT
            || cached > input
            || result.reasoning > output
            || output > TOKEN_LIMIT
        {
            return Err(Error::InvalidCounters);
        }
        Ok(Some(result))
    }
    fn subtract(self, baseline: Self) -> Option<Self> {
        Some(Self {
            input: self.input.checked_sub(baseline.input)?,
            cached: self.cached.checked_sub(baseline.cached)?,
            output: self.output.checked_sub(baseline.output)?,
            reasoning: self.reasoning.checked_sub(baseline.reasoning)?,
        })
    }
    fn normalized(self) -> Result<Tokens, Error> {
        bounded(Tokens {
            input_uncached: self
                .input
                .checked_sub(self.cached)
                .ok_or(Error::InvalidCounters)?,
            cache_read: self.cached,
            cache_write_5m: 0,
            cache_write_1h: 0,
            output: self.output,
            reasoning_output: self.reasoning,
        })
    }
}

fn make_usage(
    id: Id,
    execution_id: Id,
    offset_ms: u32,
    provider: Provider,
    tokens: Tokens,
) -> Usage {
    Usage {
        id,
        execution_id,
        account_id: [0; 16],
        offset_ms,
        provider,
        auth_mode: AuthMode::Unknown,
        evidence: Evidence::Imported,
        model_id: 0,
        context_tier: 0,
        tokens,
    }
}

fn parse_codex<R: BufRead>(
    reader: &mut R,
    key: &[u8; 32],
    out: &mut Accumulator,
) -> Result<(), Error> {
    // Each distinct delta owns a stable slot and its next repeat ordinal.
    type DeltaSlots = HashMap<[u64; 6], (u64, u64)>;
    let mut execution = None;
    let mut previous: Option<CodexCounters> = None;
    let mut same_instant: HashMap<(u32, u32), DeltaSlots> = HashMap::new();
    let mut stopped = false;
    let mut forked = false;
    loop {
        let next = reader::next_record::<_, CodexEntry>(reader)?;
        if matches!(next, reader::Next::End) {
            break;
        }
        out.lines_read += 1;
        if out.lines_read > MAX_LINES {
            return Err(Error::RecordLimit);
        }
        let record = match next {
            reader::Next::Parsed(record) => record,
            reader::Next::Oversized => {
                out.warn(Warning::UnsupportedRecords);
                continue;
            }
            _ => continue,
        };
        let Some(payload) = record.payload else {
            out.warn(Warning::UnsupportedRecords);
            continue;
        };
        if record.kind == Kind::SessionMeta {
            if payload.forked_from_id.is_some() {
                forked = true;
                out.usage.clear();
                out.warn(Warning::CodexForkUnsupported);
            }
            if let Some(id) = payload.id {
                let id = keyed_id(key, b"codex-execution", &[id.0.as_bytes()]);
                if execution.is_some_and(|old| old != id) && !forked {
                    return Err(Error::SessionIdentityChanged);
                }
                execution = Some(id);
            } else {
                out.warn(Warning::MissingIdentity);
            }
            continue;
        }
        if forked || stopped {
            continue;
        }
        if record.kind != Kind::EventMsg || payload.kind != Kind::TokenCount {
            continue;
        }
        let Some(execution_id) = execution else {
            out.warn(Warning::MissingIdentity);
            continue;
        };
        let Some(info) = payload.info else {
            out.warn(Warning::MissingUsageCounters);
            continue;
        };
        let Some(total) = info.total_token_usage else {
            out.warn(Warning::CodexMissingCumulative);
            continue;
        };
        if total.reasoning_output_tokens.is_none() {
            out.warn(Warning::UnmeasuredReasoning);
        }
        let Some(total) = CodexCounters::from_usage(&total)? else {
            out.warn(Warning::MissingUsageCounters);
            continue;
        };
        let delta = if let Some(baseline) = previous {
            if total == baseline {
                continue;
            }
            let Some(delta) = total.subtract(baseline) else {
                out.warn(Warning::CodexCumulativeRegression);
                stopped = true;
                continue;
            };
            delta
        } else {
            previous = Some(total);
            if info
                .last_token_usage
                .as_ref()
                .is_some_and(|usage| usage.reasoning_output_tokens.is_none())
            {
                out.warn(Warning::UnmeasuredReasoning);
            }
            let last = info
                .last_token_usage
                .as_ref()
                .map(CodexCounters::from_usage)
                .transpose()?
                .flatten();
            let Some(last) = last else {
                out.warn(Warning::CodexInitialBaselineOmitted);
                continue;
            };
            if total.subtract(last).is_none() {
                return Err(Error::InvalidCounters);
            }
            if total != last {
                out.warn(Warning::CodexInitialBaselineOmitted);
            }
            last
        };
        previous = Some(total);
        let tokens = delta.normalized()?;
        if !any_tokens(&tokens) {
            continue;
        }
        let Some((day, offset)) = timestamp(record.timestamp.as_ref()) else {
            out.warn(Warning::MissingTimestamp);
            continue;
        };
        let day_bytes = day.to_le_bytes();
        let offset_bytes = offset.to_le_bytes();
        // Compaction can stamp several distinct token_count deltas with one
        // timestamp. Unchanged cumulative copies were already skipped above;
        // even an equal delta now represents newly measured usage. Retain the
        // original identity for the first occurrence of each distinct delta,
        // and give repeats a separate ordinal without shifting later slots.
        let (slot, repeat) = {
            let slots = same_instant.entry((day, offset)).or_default();
            let next = slots.len() as u64;
            let entry = slots.entry(values(&tokens)).or_insert((next, 0));
            let result = *entry;
            entry.1 += 1;
            result
        };
        let id = if repeat != 0 {
            keyed_id(
                key,
                b"codex-usage-repeat",
                &[
                    &execution_id,
                    &day_bytes,
                    &offset_bytes,
                    &slot.to_le_bytes(),
                    &repeat.to_le_bytes(),
                ],
            )
        } else if slot == 0 {
            keyed_id(
                key,
                b"codex-usage",
                &[&execution_id, &day_bytes, &offset_bytes],
            )
        } else {
            keyed_id(
                key,
                b"codex-usage",
                &[
                    &execution_id,
                    &day_bytes,
                    &offset_bytes,
                    &slot.to_le_bytes(),
                ],
            )
        };
        out.add(
            day,
            make_usage(id, execution_id, offset, Provider::Codex, tokens),
        )?;
    }
    Ok(())
}

fn parse_claude<R: BufRead>(
    reader: &mut R,
    key: &[u8; 32],
    out: &mut Accumulator,
) -> Result<(), Error> {
    out.warn(Warning::UnmeasuredReasoning);
    loop {
        let next = reader::next_record::<_, ClaudeEntry>(reader)?;
        if matches!(next, reader::Next::End) {
            break;
        }
        out.lines_read += 1;
        if out.lines_read > MAX_LINES {
            return Err(Error::RecordLimit);
        }
        let record = match next {
            reader::Next::Parsed(record) => record,
            reader::Next::Oversized => {
                out.warn(Warning::UnsupportedRecords);
                continue;
            }
            _ => continue,
        };
        if record.kind != Kind::Assistant {
            continue;
        }
        let Some(message) = record.message else {
            out.warn(Warning::MissingUsageCounters);
            continue;
        };
        let (Some(request), Some(message_id)) = (record.request_id, message.id) else {
            out.warn(Warning::MissingIdentity);
            continue;
        };
        let Some(raw) = message.usage else {
            out.warn(Warning::MissingUsageCounters);
            continue;
        };
        let (Some(input), Some(output)) = (raw.input_tokens, raw.output_tokens) else {
            out.warn(Warning::MissingUsageCounters);
            continue;
        };
        let (cache_write_5m, cache_write_1h) = if let Some(creation) = raw.cache_creation {
            let five = creation.ephemeral_5m_input_tokens.unwrap_or(0);
            let hour = creation.ephemeral_1h_input_tokens.unwrap_or(0);
            // A declared total must equal the TTL split; an absent total is the
            // split's checked sum. The kernel refuses any other partition.
            let total = match raw.cache_creation_input_tokens {
                Some(total) => u128::from(total),
                None => aicharts_metrics::checked_add(u128::from(five), u128::from(hour))
                    .map_err(|_| Error::InvalidCounters)?,
            };
            aicharts_metrics::CacheWrites::with_ttl(total, u128::from(five), u128::from(hour))
                .map_err(|_| Error::InvalidCounters)?;
            (five, hour)
        } else if raw.cache_creation_input_tokens.unwrap_or(0) != 0 {
            out.warn(Warning::ClaudeCacheTtlUnknown);
            continue;
        } else {
            (0, 0)
        };
        let tokens = bounded(Tokens {
            input_uncached: input,
            cache_read: raw.cache_read_input_tokens.unwrap_or(0),
            cache_write_5m,
            cache_write_1h,
            output,
            reasoning_output: 0,
        })?;
        if !any_tokens(&tokens) {
            continue;
        }
        let Some((day, offset)) = timestamp(record.timestamp.as_ref()) else {
            out.warn(Warning::MissingTimestamp);
            continue;
        };
        let id = keyed_id(
            key,
            b"claude-usage",
            &[request.0.as_bytes(), message_id.0.as_bytes()],
        );
        // Sidechain markers are transcript-local: a parent transcript logs a
        // delegated call without them while the subagent file marks it. Only
        // `sessionId` is stable across copies, so executions are sessions.
        let execution_id = match record.session_id {
            Some(session) => keyed_id(key, b"claude-execution", &[session.0.as_bytes()]),
            _ => {
                out.warn(Warning::UnknownExecution);
                [0; 16]
            }
        };
        out.add(
            day,
            make_usage(id, execution_id, offset, Provider::ClaudeCode, tokens),
        )?;
    }
    Ok(())
}

/// Read one bounded ATIF document. The transcript is a single pretty-printed
/// JSON object, so the JSONL line machinery does not apply; serde's recursion
/// limit bounds nesting and the byte cap bounds size.
pub(crate) fn read_atif<R: BufRead>(reader: &mut R) -> Result<AtifDocument, Error> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take(MAX_DOC_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::ReadFailed)?;
    if bytes.len() as u64 > MAX_DOC_BYTES {
        return Err(Error::LineTooLarge);
    }
    serde_json::from_slice(&bytes).map_err(|_| Error::MalformedRecord)
}

/// Key one measured request. `step` is the transcript's own step identifier
/// when present, otherwise the step's position inside the document.
pub(crate) fn devin_usage_id(key: &[u8; 32], execution: &Id, step: &[u8]) -> Id {
    keyed_id(key, b"devin-usage", &[&execution[..], step])
}

fn parse_devin<R: BufRead>(
    reader: &mut R,
    key: &[u8; 32],
    out: &mut Accumulator,
) -> Result<(), Error> {
    out.warn(Warning::UnmeasuredReasoning);
    let document = read_atif(reader)?;
    out.lines_read += 1;
    if !document
        .schema_version
        .is_some_and(|version| version.0.starts_with("ATIF-v1."))
    {
        return Err(Error::MalformedRecord);
    }
    if document
        .agent
        .and_then(|agent| agent.name)
        .is_none_or(|name| name.0 != "devin")
    {
        // A missing or foreign agent name under the Devin source flag is a
        // pointed-at-wrong-source error, never provider usage.
        return Err(Error::MalformedRecord);
    }
    let Some(session_id) = document.session_id else {
        out.warn(Warning::MissingIdentity);
        return Ok(());
    };
    let execution_id = keyed_id(key, b"devin-execution", &[session_id.0.as_bytes()]);
    let mut totals = [0u64; 3];
    for (index, step) in document.steps.iter().enumerate() {
        if step.source != StepSource::Agent {
            continue;
        }
        let Some(metrics) = &step.metrics else {
            out.warn(Warning::MissingUsageCounters);
            continue;
        };
        let (Some(prompt), Some(output)) = (metrics.prompt_tokens, metrics.completion_tokens)
        else {
            out.warn(Warning::MissingUsageCounters);
            continue;
        };
        let cached = metrics.cached_tokens.unwrap_or(0);
        let tokens = bounded(Tokens {
            input_uncached: prompt.checked_sub(cached).ok_or(Error::InvalidCounters)?,
            cache_read: cached,
            cache_write_5m: 0,
            cache_write_1h: 0,
            output,
            reasoning_output: 0,
        })?;
        for (total, value) in totals.iter_mut().zip([prompt, output, cached]) {
            *total = add_counter(*total, value)?;
        }
        if !any_tokens(&tokens) {
            continue;
        }
        let Some((day, offset)) = timestamp(step.timestamp.as_ref()) else {
            out.warn(Warning::MissingTimestamp);
            continue;
        };
        let step_key = step
            .step_id
            .as_ref()
            .map_or_else(|| index.to_string(), |id| id.0.clone());
        out.add(
            day,
            make_usage(
                devin_usage_id(key, &execution_id, step_key.as_bytes()),
                execution_id,
                offset,
                Provider::Devin,
                tokens,
            ),
        )?;
    }
    if let Some(final_metrics) = &document.final_metrics {
        let declared = [
            final_metrics.total_prompt_tokens.unwrap_or(0),
            final_metrics.total_completion_tokens.unwrap_or(0),
            final_metrics.total_cached_tokens.unwrap_or(0),
        ];
        if declared != totals
            || final_metrics
                .total_steps
                .is_some_and(|steps| steps != document.steps.len() as u64)
        {
            out.warn(Warning::DevinTotalsMismatch);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
