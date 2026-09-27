use crate::{checkpoint, ImportCheckpoint, LocalImport};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const MAX_SOURCE_HEALTH_CODES: usize = 16;
pub const QUALIFICATION_ID: &str = "aicharts-adapters-v1";
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportOutcome {
    Complete,
    Partial,
    Failed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthCode {
    SourceFailed,
    ProjectionRefused,
    DeferredTail,
    CheckpointReplay,
    CheckpointUnsupported,
    CheckpointCapacity,
    Clamped,
    Fallback,
    Estimated,
    SchemaCoverageLimited,
}
/// Privacy-safe collection evidence. None means unmeasured, never zero. Event
/// range describes parsed observations, independent of filesystem timestamps.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportHealth {
    pub schema_version: u8,
    pub outcome: ImportOutcome,
    pub parser_generation: String,
    pub qualification_id: String,
    pub files: Option<u64>,
    pub logical_bytes: Option<u64>,
    pub parsed_bytes: Option<u64>,
    pub verified_bytes: u64,
    pub reused_files: u64,
    pub records: Option<u64>,
    pub deferred_tail_files: Option<u64>,
    pub schema_mismatch_records: Option<u64>,
    pub clamped_records: Option<u64>,
    pub fallback_records: Option<u64>,
    pub estimated_records: Option<u64>,
    pub event_min_ms: Option<i64>,
    pub event_max_ms: Option<i64>,
    pub codes: Vec<HealthCode>,
}
pub struct ObservedImport {
    pub result: Result<LocalImport, Vec<&'static str>>,
    pub health: ImportHealth,
}
impl ImportHealth {
    pub fn validate(&self) -> bool {
        let complete = self.outcome == ImportOutcome::Complete;
        let has = |code| self.codes.contains(&code);
        let safe = |value: u64| value <= 9_007_199_254_740_991;
        let all_numbers_safe = [
            self.files,
            self.logical_bytes,
            self.parsed_bytes,
            Some(self.verified_bytes),
            Some(self.reused_files),
            self.records,
            self.deferred_tail_files,
            self.schema_mismatch_records,
            self.clamped_records,
            self.fallback_records,
            self.estimated_records,
        ]
        .into_iter()
        .flatten()
        .all(safe);
        let observed = self.outcome != ImportOutcome::Failed;
        self.schema_version == 1 && self.qualification_id == QUALIFICATION_ID
            // Historical last-good evidence survives parser upgrades. Accept
            // only the owned generation spelling, never arbitrary source text.
            && self.parser_generation.strip_prefix("aicharts-").and_then(|value| value.split_once('-')).is_some_and(|(generation, parser)| {
                generation.parse::<u32>().is_ok_and(|n| n > 0 && n <= tokscale_core::offline::CHECKPOINT_GENERATION && n.to_string() == generation)
                    && parser.parse::<u64>().is_ok_and(|n| n.to_string() == parser)
            })
            && self.codes.len() <= MAX_SOURCE_HEALTH_CODES
            && all_numbers_safe
            && self.codes.iter().enumerate().all(|(index, code)| !self.codes[..index].contains(code))
            && self.files.is_none_or(|n| n <= crate::MAX_CHECKPOINT_FILES as u64)
            && self.records.is_none_or(|n| n <= crate::MAX_CHECKPOINT_OBSERVATIONS as u64)
            && self.files.is_none_or(|files| self.reused_files <= files && self.deferred_tail_files.is_none_or(|tails| tails <= files))
            && self.records.is_none_or(|records| self.estimated_records.is_none_or(|estimated| estimated <= records))
            && (!observed || (self.files.is_some() && self.records.is_some() && self.logical_bytes.is_some() && self.deferred_tail_files.is_some()))
            && (!complete || self.deferred_tail_files == Some(0))
            && (self.outcome != ImportOutcome::Partial || self.deferred_tail_files.is_some_and(|n| n > 0))
            && (has(HealthCode::DeferredTail) == self.deferred_tail_files.is_some_and(|n| n > 0))
            && (has(HealthCode::Clamped) == self.clamped_records.is_some_and(|n| n > 0))
            && (has(HealthCode::Fallback) == self.fallback_records.is_some_and(|n| n > 0))
            && (has(HealthCode::Estimated) == self.estimated_records.is_some_and(|n| n > 0))
            && (has(HealthCode::SchemaCoverageLimited) == self.schema_mismatch_records.is_none())
            && ((has(HealthCode::SourceFailed) || has(HealthCode::ProjectionRefused)) == (self.outcome == ImportOutcome::Failed))
            && match (self.event_min_ms, self.event_max_ms) {
                (None, None) => self.outcome == ImportOutcome::Failed || self.records.is_none_or(|n| n == 0),
                (Some(min), Some(max)) => min <= max && min >= -8_640_000_000_000_000 && max <= 8_640_000_000_000_000 && self.records.is_some_and(|n| n > 0),
                _ => false,
            }
    }
}
pub fn collect_observed(
    home: &Path,
    client: &str,
    approved_roots: &[PathBuf],
    source_roots: Option<&[PathBuf]>,
    first_ms: u64,
    checkpoint: Option<&mut ImportCheckpoint>,
) -> ObservedImport {
    let binding = checkpoint::scope(home, client, approved_roots, source_roots, first_ms);
    // Fixture-supported parsers measure their own schema mismatches, clamps
    // and fallbacks; every other selector's coverage stays unmeasured.
    let supported = tokscale_core::offline::CHECKPOINT_CLIENTS.contains(&client);
    let old = checkpoint.as_ref().and_then(|c| c.state.as_ref());
    let reuse = old.filter(|state| Some(state.scope) == binding.as_ref().ok().copied());
    let enabled = checkpoint.is_some() && supported && binding.is_ok();
    let previous = enabled.then(|| reuse.map(|state| state.source.clone()).unwrap_or_default());
    let replay = enabled && old.is_some() && reuse.is_none();
    let (result, work, candidate) = tokscale_core::offline::collect_observed_since(
        home,
        client,
        approved_roots,
        source_roots,
        first_ms,
        previous,
    );
    let mut health = ImportHealth {
        schema_version: 1,
        outcome: ImportOutcome::Failed,
        parser_generation: format!(
            "aicharts-{}-{}",
            tokscale_core::offline::CHECKPOINT_GENERATION,
            tokscale_core::parser_generation()
        ),
        qualification_id: QUALIFICATION_ID.to_owned(),
        files: None,
        logical_bytes: None,
        // The byte reader sees text parsing, not SQLite pager reads (devin-cli).
        // Do not present an incomplete I/O counter as a universal parser metric.
        parsed_bytes: matches!(client, "codex" | "claude" | "cursor" | "devin-desktop")
            .then_some(work.parsed_bytes),
        verified_bytes: work.verified_bytes,
        reused_files: work.reused_files,
        records: None,
        deferred_tail_files: None,
        // Only recognized malformed records of fixture-supported parsers are
        // measured; every other selector remains SchemaCoverageLimited.
        schema_mismatch_records: supported.then_some(work.schema_mismatch_records),
        clamped_records: supported.then_some(work.clamped_records),
        fallback_records: supported.then_some(work.fallback_records),
        estimated_records: None,
        event_min_ms: None,
        event_max_ms: None,
        codes: if supported {
            Vec::new()
        } else {
            vec![HealthCode::SchemaCoverageLimited]
        },
    };
    if replay {
        health.codes.push(HealthCode::CheckpointReplay);
    }
    if work.checkpoint_capacity {
        health.codes.push(HealthCode::CheckpointCapacity);
    }
    if checkpoint.is_some() && !enabled {
        health.codes.push(HealthCode::CheckpointUnsupported);
    }
    match &result {
        Ok(import) => {
            health.outcome = if import.receipt.deferred_tail_files == 0 {
                ImportOutcome::Complete
            } else {
                ImportOutcome::Partial
            };
            health.files = Some(import.receipt.files as u64);
            health.logical_bytes = Some(import.receipt.bytes);
            health.records = Some(import.messages.len() as u64);
            health.deferred_tail_files = Some(import.receipt.deferred_tail_files as u64);
            health.estimated_records = Some(
                import
                    .messages
                    .iter()
                    .filter(|row| row.tokens_estimated)
                    .count() as u64,
            );
            health.event_min_ms = import.messages.iter().map(|row| row.timestamp).min();
            health.event_max_ms = import.messages.iter().map(|row| row.timestamp).max();
            if health
                .event_min_ms
                .is_some_and(|n| n < -8_640_000_000_000_000)
                || health
                    .event_max_ms
                    .is_some_and(|n| n > 8_640_000_000_000_000)
            {
                health.event_min_ms = None;
                health.event_max_ms = None;
                health.outcome = ImportOutcome::Failed;
                health.codes.push(HealthCode::ProjectionRefused);
            }
            if import.receipt.deferred_tail_files > 0 {
                health.codes.push(HealthCode::DeferredTail);
            }
            if health.clamped_records.is_some_and(|n| n > 0) {
                health.codes.push(HealthCode::Clamped);
            }
            if health.fallback_records.is_some_and(|n| n > 0) {
                health.codes.push(HealthCode::Fallback);
            }
            if health.estimated_records.is_some_and(|n| n > 0) {
                health.codes.push(HealthCode::Estimated);
            }
            if enabled && health.outcome == ImportOutcome::Complete {
                if let (Some(target), Some(source), Ok(scope)) = (checkpoint, candidate, binding) {
                    let next = ImportCheckpoint::candidate(scope, source);
                    // Encode through the hard byte bound before installing any
                    // candidate. Overflow preserves the entire last-good state.
                    if target.same_sources(&next) {
                        // The verified immutable prefix and parser generation
                        // are identical. Keep the already bounded envelope.
                    } else if next.bounded_bytes().is_ok() {
                        *target = next;
                    } else {
                        health.codes.push(HealthCode::CheckpointCapacity);
                    }
                }
            }
        }
        Err(_) => {
            health.clamped_records = None;
            health.fallback_records = None;
            health.codes.push(HealthCode::SourceFailed);
        }
    }
    ObservedImport { result, health }
}
