//! Local, metadata-only JSONL import. This crate opens no files and has no network API.
//!
//! Callers supply a reader and a private, stable namespace key. Source identities are
//! HMAC-derived from native metadata, never content, paths, device identity or line
//! position. See README.md for coverage limits; successful parsing is not attestation.

mod reader;
mod schema;

use aicharts_protocol::{AuthMode, Batch, Evidence, Id, Provider, Tokens, Usage};
use hmac::{Hmac, Mac};
use schema::*;
use sha2::Sha256;
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    io::BufRead,
};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

pub use reader::{MAX_DEPTH, MAX_LINE_BYTES};
pub const MAX_LINES: u64 = 100_000;
pub const MAX_MEASUREMENTS: usize = 100_000;
const TOKEN_LIMIT: u64 = 1_000_000_000_000;
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
                return Err(Error::ConflictingOccurrence);
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
            let new_dominates = new_values
                .iter()
                .zip(old_values)
                .all(|(new, old)| *new >= old);
            let old_dominates = old_values
                .iter()
                .zip(new_values)
                .all(|(old, new)| *old >= new);
            if !new_dominates && !old_dominates {
                return Err(Error::ConflictingOccurrence);
            }
            let final_time = (*old_day, old.offset_ms).max((day, usage.offset_ms));
            if new_dominates {
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
    a.execution_id == b.execution_id
        && a.account_id == b.account_id
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
fn bounded(tokens: Tokens) -> Result<Tokens, Error> {
    if values(&tokens).iter().any(|&v| v > TOKEN_LIMIT) || tokens.reasoning_output > tokens.output {
        return Err(Error::InvalidCounters);
    }
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
    let mut execution = None;
    let mut previous: Option<CodexCounters> = None;
    let mut stopped = false;
    let mut forked = false;
    while let Some(record) = reader::next_record::<_, CodexEntry>(reader)? {
        out.lines_read += 1;
        if out.lines_read > MAX_LINES {
            return Err(Error::RecordLimit);
        }
        let Some(record) = record else {
            continue;
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
        let id = keyed_id(
            key,
            b"codex-usage",
            &[&execution_id, &day_bytes, &offset_bytes],
        );
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
    while let Some(record) = reader::next_record::<_, ClaudeEntry>(reader)? {
        out.lines_read += 1;
        if out.lines_read > MAX_LINES {
            return Err(Error::RecordLimit);
        }
        let Some(record) = record else {
            continue;
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
            let total = five.checked_add(hour).ok_or(Error::InvalidCounters)?;
            if raw.cache_creation_input_tokens.is_some_and(|v| v != total) {
                return Err(Error::InvalidCounters);
            }
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
        let execution_id = match (record.session_id, record.agent_id, record.is_sidechain) {
            (Some(session), Some(agent), true) => keyed_id(
                key,
                b"claude-subagent",
                &[session.0.as_bytes(), agent.0.as_bytes()],
            ),
            (Some(session), _, false) => {
                keyed_id(key, b"claude-execution", &[session.0.as_bytes()])
            }
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

#[cfg(test)]
mod tests;
