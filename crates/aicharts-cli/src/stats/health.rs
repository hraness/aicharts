//! Collection evidence is separate from the stable numeric report. Ordinary
//! stats collection never opens a persistent store or creates a lock file.
use super::{Options, Report};
#[cfg(unix)]
use crate::source_health::SourceHealthStore;
#[cfg(target_os = "macos")]
use crate::source_health::MAX_SOURCE_HEALTH_BYTES;
use crate::source_health::{Observation, MAX_SOURCE_HEALTH_CLIENTS, MAX_SOURCE_HEALTH_CODES};
#[cfg(unix)]
use aicharts_import::ImportCheckpoint;
use aicharts_import::{HealthCode, ImportHealth, ImportOutcome};
use serde::{Deserialize, Serialize};
#[cfg(unix)]
use sha2::{Digest, Sha256};
#[cfg(any(test, target_os = "macos"))]
use std::path::Path;

pub(super) const MAX_HEALTH_REPORT_BYTES: usize = 65_536;
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SourceObservation {
    pub client: String,
    #[serde(flatten)]
    pub observation: Observation,
    #[serde(skip_serializing)]
    pub binding: Option<[u8; 32]>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HealthReport {
    pub schema_version: u8,
    pub profile: String,
    pub registry_revision: u8,
    pub first_utc_day: u64,
    pub day_count: u64,
    pub started_at_ms: u64,
    pub completed_at_ms: u64,
    pub sources: Vec<SourceObservation>,
}
impl HealthReport {
    pub(super) fn validate(&self) -> Result<(), &'static str> {
        let invalid = "stats_source_health_invalid";
        if self.schema_version != 1
            || self.profile != "source-health-v1"
            || self.registry_revision != 1
            || self.first_utc_day > 99_999_999
            || !(1..=366).contains(&self.day_count)
            || self.first_utc_day + self.day_count - 1 > 99_999_999
            || self.started_at_ms > self.completed_at_ms
            || self.completed_at_ms > 8_640_000_000_000_000
            || self.sources.is_empty()
            || self.sources.len() > MAX_SOURCE_HEALTH_CLIENTS
        {
            return Err(invalid);
        }
        let mut previous = "";
        let mut completed = self.started_at_ms;
        let persisted = self.sources[0].binding.is_some();
        for source in &self.sources {
            let observation = &source.observation;
            if source.client.as_str() <= previous
                || !aicharts_import::clients().contains(&source.client.as_str())
                || observation.started_at_ms != completed
                || observation.started_at_ms > observation.completed_at_ms
                || observation.completed_at_ms > self.completed_at_ms
                || source.binding.is_some() != persisted
                || !observation.health.validate()
            {
                return Err(invalid);
            }
            previous = &source.client;
            completed = observation.completed_at_ms;
        }
        if completed != self.completed_at_ms
            || serde_json::to_vec(self).map_err(|_| invalid)?.len() > MAX_HEALTH_REPORT_BYTES
        {
            return Err(invalid);
        }
        Ok(())
    }
}
pub(crate) struct CollectedStats {
    pub(super) report: Report,
    pub(super) health: HealthReport,
}
impl CollectedStats {
    #[cfg(target_os = "macos")]
    pub(crate) fn into_report(self) -> Report {
        self.report
    }
    #[cfg(target_os = "macos")]
    pub(crate) fn observation_identity(
        &self,
        client: &str,
    ) -> Result<([u8; 32], u64), &'static str> {
        self.health
            .sources
            .iter()
            .find(|source| source.client == client)
            .and_then(|source| {
                source
                    .binding
                    .map(|binding| (binding, source.observation.completed_at_ms))
            })
            .ok_or("stats_source_health_invalid")
    }
}
pub(super) fn publication_warnings(health: &ImportHealth) -> u64 {
    health
        .codes
        .iter()
        .filter(|code| {
            matches!(
                code,
                HealthCode::DeferredTail
                    | HealthCode::Clamped
                    | HealthCode::Fallback
                    | HealthCode::SourceFailed
                    | HealthCode::ProjectionRefused
            )
        })
        .count() as u64
}
pub(super) fn projection_refused(health: &mut ImportHealth) {
    health.outcome = ImportOutcome::Failed;
    if !health.codes.contains(&HealthCode::ProjectionRefused) {
        health.codes.push(HealthCode::ProjectionRefused);
    }
}

/// A local opaque binding, never exported. Length prefixes preserve distinct
/// profile roots and ranges even when path bytes contain separators or NULs.
#[cfg(unix)]
pub(crate) fn observation_scope(client: &str, options: &Options) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"aicharts:source-observation-v1\0");
    for bytes in std::iter::once(client.as_bytes())
        .chain(std::iter::once(options.home.as_os_str().as_encoded_bytes()))
        .chain(
            options
                .source_roots
                .iter()
                .map(|path| path.as_os_str().as_encoded_bytes()),
        )
    {
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
    }
    hash.update((options.source_roots.len() as u64).to_le_bytes());
    hash.update(options.first_utc_day.to_le_bytes());
    hash.update(options.day_count.to_le_bytes());
    hash.finalize().into()
}

pub(super) struct Persistence {
    /// None is an ephemeral dry run: nothing is retained on disk.
    #[cfg(unix)]
    health: Option<SourceHealthStore>,
    /// A checkpoint without a store is discarded with the run.
    #[cfg(unix)]
    checkpoint: Option<(
        Option<crate::source_checkpoint::SourceCheckpoint>,
        ImportCheckpoint,
    )>,
    #[cfg(unix)]
    replayed: bool,
}
#[cfg(unix)]
impl Persistence {
    #[cfg(any(test, target_os = "macos"))]
    pub(super) fn open(
        options: &Options,
        state: &Path,
        incremental: bool,
    ) -> Result<Self, &'static str> {
        if options.clients.len() != 1 {
            return Err("stats_sync_one_client_required");
        }
        let client = incremental
            .then(|| crate::source_health::incremental_profile(options))
            .transpose()?;
        let health = SourceHealthStore::open(&state.join("source-health-v1"))?;
        let mut replayed = false;
        let checkpoint = if let Some(client) = client {
            let store = crate::source_checkpoint::SourceCheckpoint::open(
                &state.join(format!("source-checkpoint-{client}-v1")),
            )?;
            let value = match store.load() {
                Ok(value) => value,
                Err("import_checkpoint_invalid" | "import_checkpoint_generation_mismatch") => {
                    replayed = true;
                    ImportCheckpoint::default()
                }
                Err(code) => return Err(code),
            };
            Some((Some(store), value))
        } else {
            None
        };
        Ok(Self {
            health: Some(health),
            checkpoint,
            replayed,
        })
    }
    /// An incremental dry run: the checkpoint path runs from a fresh, unsaved
    /// checkpoint and no health evidence is retained.
    #[cfg(target_os = "macos")]
    pub(super) fn ephemeral(options: &Options) -> Result<Self, &'static str> {
        crate::source_health::incremental_profile(options)?;
        Ok(Self {
            health: None,
            checkpoint: Some((None, ImportCheckpoint::default())),
            replayed: false,
        })
    }
    pub(super) fn checkpoint(&mut self) -> Option<&mut ImportCheckpoint> {
        self.checkpoint.as_mut().map(|(_, value)| value)
    }
    pub(super) fn record(
        &mut self,
        client: &str,
        options: &Options,
        observation: &Observation,
    ) -> Result<[u8; 32], &'static str> {
        let mut observation = observation.clone();
        if self.replayed
            && !observation
                .health
                .codes
                .contains(&HealthCode::CheckpointReplay)
        {
            observation.health.codes.push(HealthCode::CheckpointReplay);
        }
        // Persist the attempt before replacing the derived cache. Any failure
        // preserves earlier complete evidence; no publication has begun yet.
        let binding = match &mut self.health {
            Some(health) => health.record_attempt(
                client,
                observation_scope(client, options),
                observation.clone(),
            )?,
            None => {
                // An ephemeral attempt has an identity but leaves no evidence.
                let mut attempt = [0u8; 32];
                getrandom::fill(&mut attempt).map_err(|_| "source_health_random_unavailable")?;
                attempt
            }
        };
        if observation.health.outcome == ImportOutcome::Complete {
            if let Some((Some(store), value)) = &self.checkpoint {
                store.save(value)?;
            }
        }
        Ok(binding)
    }
}
#[cfg(not(unix))]
impl Persistence {
    pub(super) fn checkpoint(&mut self) -> Option<&mut aicharts_import::ImportCheckpoint> {
        None
    }
    pub(super) fn record(
        &mut self,
        _: &str,
        _: &Options,
        _: &Observation,
    ) -> Result<[u8; 32], &'static str> {
        Err("stats_persistence_unavailable")
    }
}
/// `state` None is an incremental dry run that retains nothing.
#[cfg(target_os = "macos")]
pub(crate) fn collect_persisted(
    options: &Options,
    now: u64,
    state: Option<&Path>,
    incremental: bool,
) -> Result<CollectedStats, &'static str> {
    // The persistent and exported forms have independent fixed ceilings.
    const {
        assert!(MAX_HEALTH_REPORT_BYTES <= MAX_SOURCE_HEALTH_BYTES);
    }
    let mut persistence = match state {
        Some(state) => Persistence::open(options, state, incremental)?,
        None if incremental => Persistence::ephemeral(options)?,
        None => return Err("invalid_option"),
    };
    super::collect_detailed_with_clock(options, now, super::now_ms, Some(&mut persistence))
}

const HEALTH_HELP: &str = "AI Charts source health: local, read-only\n\n  aicharts stats-health --state-dir DIR --home DIR --client ID [--source-root DIR ...] [--since YYYY-MM-DD --until YYYY-MM-DD]\n\nReads the last collection attempt, last complete good observation and independent\npublication outcome for this exact profile and UTC range. It does not scan source\nfiles, open a write lock, create state, refresh providers or upload anything.\nUse the same home, exclusive roots and dates as the collection. A missing or\ndifferent profile has null evidence; it is never reported as a successful scan.\nOutput contains fixed codes, bounded numbers and times, with no source paths.\n";
pub(crate) fn run_retained_health(args: &[String]) -> Result<String, &'static str> {
    if args == ["stats-health", "--help"] || args == ["stats-health", "-h"] {
        return Ok(HEALTH_HELP.to_owned());
    }
    let mut directory = None;
    let mut collection = Vec::new();
    let mut index = 1;
    while index < args.len() {
        if args[index] == "--state-dir" {
            if directory.is_some() {
                return Err("invalid_option");
            }
            index += 1;
            let value = args
                .get(index)
                .filter(|s| !s.is_empty() && !s.starts_with("--"))
                .ok_or("missing_option_value")?;
            directory = Some(std::path::PathBuf::from(value));
        } else {
            collection.push(args[index].clone());
        }
        index += 1;
    }
    let directory = directory
        .filter(|p| p.is_absolute())
        .ok_or("state_directory_required")?;
    let options = super::options(&collection, super::now_ms()?)?;
    if options.clients.len() != 1 || options.json || options.health_json {
        return Err("invalid_option");
    }
    #[cfg(unix)]
    {
        let client = &options.clients[0];
        let evidence = SourceHealthStore::read_status(
            &directory.join("source-health-v1"),
            client,
            observation_scope(client, &options),
        )?;
        let response = serde_json::json!({ "schemaVersion": 1, "profile": "retained-source-health-v1", "registryRevision": 1,
            "client": client, "firstUtcDay": options.first_utc_day, "dayCount": options.day_count,
            "lastAttempt": evidence.as_ref().and_then(|value| value.last_attempt.as_ref()),
            "lastGood": evidence.as_ref().and_then(|value| value.last_good.as_ref()),
            "lastPublication": evidence.as_ref().and_then(|value| value.last_publication.as_ref()) });
        let encoded =
            serde_json::to_string(&response).map_err(|_| "stats_source_health_invalid")?;
        if encoded.len() > MAX_HEALTH_REPORT_BYTES {
            return Err("stats_source_health_limit");
        }
        Ok(encoded)
    }
    #[cfg(not(unix))]
    {
        let _ = (directory, options);
        Err("stats_persistence_unavailable")
    }
}

/// Hosted `source-health-v1` summary carried with a publication: one
/// selector's latest local evidence and the Phase 4 catalog metric values it
/// supports. Exact integers only; `null` means unmeasured, never zero.
pub(crate) const MAX_HEALTH_SUMMARY_BYTES: usize = 8_192;
const SUMMARY_TEXT_BYTES: usize = 128;
#[derive(Clone, Copy, PartialEq, Eq)]
enum MetricKind {
    /// Unsigned safe integer.
    Count,
    /// Signed millisecond timestamp within the wire time bound.
    Timestamp,
    /// Exact `{denominator, numerator}` integers, denominator positive.
    Ratio,
    /// Bounded ASCII status text.
    Status,
    /// `{files, parsedBytes, reusedFiles, verifiedBytes}` work vector.
    Work,
}
/// Every Phase 4 catalog metric, sorted; the wire object carries exactly
/// these keys in this order.
const SUMMARY_METRICS: [(&str, MetricKind); 30] = [
    ("acquisition-lag", MetricKind::Count),
    ("collector-qualification-status", MetricKind::Status),
    ("collector-queue-depth", MetricKind::Count),
    ("collector-rejection-reason-count", MetricKind::Count),
    ("collector-retry-reason-count", MetricKind::Count),
    ("collector-version-status", MetricKind::Status),
    ("data-through-watermark", MetricKind::Timestamp),
    ("deferred-observation-count", MetricKind::Count),
    ("detected-source-count", MetricKind::Count),
    ("excluded-observation-count", MetricKind::Count),
    ("incremental-catch-up-lag", MetricKind::Count),
    ("last-collection-attempt", MetricKind::Timestamp),
    ("last-collection-success", MetricKind::Timestamp),
    ("local-database-bytes", MetricKind::Count),
    ("local-wal-bytes", MetricKind::Count),
    ("measured-denominator-ratio", MetricKind::Ratio),
    ("missing-source-count", MetricKind::Count),
    ("model-attribution-coverage", MetricKind::Ratio),
    ("no-change-work", MetricKind::Work),
    ("oldest-sync-backlog-age", MetricKind::Count),
    ("parser-schema-refusal-count", MetricKind::Count),
    ("pricing-record-coverage", MetricKind::Ratio),
    ("publication-lag", MetricKind::Count),
    ("scan-bytes", MetricKind::Count),
    ("scan-duration", MetricKind::Count),
    ("scan-files", MetricKind::Count),
    ("selected-source-count", MetricKind::Count),
    ("stale-partition-count", MetricKind::Count),
    ("sync-backlog-count", MetricKind::Count),
    ("warning-observation-count", MetricKind::Count),
];
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceHealthSummary {
    pub schema_version: u8,
    pub profile: String,
    pub client: String,
    pub last_attempt: Option<Observation>,
    pub last_good: Option<Observation>,
    pub last_publication: Option<crate::source_health::Publication>,
    pub metrics: std::collections::BTreeMap<String, serde_json::Value>,
}
impl SourceHealthSummary {
    /// Derives the summary from the retained local status. `now_ms` dates a
    /// publication backlog; nothing else depends on the clock.
    #[cfg(any(test, target_os = "macos"))]
    pub(crate) fn from_status(
        client: &str,
        status: &crate::source_health::SourceHealth,
        now_ms: u64,
    ) -> Result<Self, &'static str> {
        use crate::source_health::PublicationOutcome;
        use serde_json::Value;
        let attempt = status.last_attempt.as_ref();
        let good = status.last_good.as_ref();
        let publication = status.last_publication.as_ref();
        let health = attempt.map(|value| &value.health);
        let count = |value: Option<u64>| value.map_or(Value::Null, Value::from);
        let published = |good: &Observation| {
            publication.is_some_and(|value| {
                value.outcome == PublicationOutcome::Succeeded
                    && value.observed_completed_at_ms >= good.completed_at_ms
            })
        };
        let backlog = good.map(|good| !published(good));
        let acquisition_lag = attempt.and_then(|value| {
            let latest = u64::try_from(value.health.event_max_ms?).ok()?;
            value.completed_at_ms.checked_sub(latest)
        });
        let publication_lag = publication
            .filter(|value| value.outcome == PublicationOutcome::Succeeded)
            .and_then(|value| value.at_ms.checked_sub(value.observed_completed_at_ms));
        let warnings = health.and_then(|health| {
            health
                .clamped_records?
                .checked_add(health.fallback_records?)?
                .checked_add(health.estimated_records?)
        });
        let rejections = health.map(|health| {
            if health.outcome == ImportOutcome::Failed {
                health
                    .codes
                    .iter()
                    .filter(|code| {
                        matches!(
                            code,
                            HealthCode::SourceFailed | HealthCode::ProjectionRefused
                        )
                    })
                    .count() as u64
            } else {
                0
            }
        });
        let work = health.map(|health| {
            let mut work = serde_json::Map::new();
            work.insert("files".into(), count(health.files));
            work.insert("parsedBytes".into(), count(health.parsed_bytes));
            work.insert("reusedFiles".into(), Value::from(health.reused_files));
            work.insert("verifiedBytes".into(), Value::from(health.verified_bytes));
            Value::Object(work)
        });
        let version = health.map(|health| {
            Value::from(format!(
                "{}/{}/health-v{}",
                health.parser_generation, health.qualification_id, health.schema_version
            ))
        });
        let qualification = health.map(|health| {
            Value::from(
                if health.codes.contains(&HealthCode::SchemaCoverageLimited)
                    || health.codes.contains(&HealthCode::CheckpointUnsupported)
                {
                    "limited"
                } else {
                    "fixture-supported"
                },
            )
        });
        let values = [
            ("acquisition-lag", count(acquisition_lag)),
            (
                "collector-qualification-status",
                qualification.unwrap_or(Value::Null),
            ),
            ("collector-queue-depth", Value::Null),
            ("collector-rejection-reason-count", count(rejections)),
            ("collector-retry-reason-count", Value::Null),
            ("collector-version-status", version.unwrap_or(Value::Null)),
            (
                "data-through-watermark",
                good.and_then(|good| good.health.event_max_ms)
                    .map_or(Value::Null, Value::from),
            ),
            (
                "deferred-observation-count",
                count(health.and_then(|health| health.deferred_tail_files)),
            ),
            ("detected-source-count", Value::Null),
            (
                "excluded-observation-count",
                count(health.and_then(|health| health.schema_mismatch_records)),
            ),
            ("incremental-catch-up-lag", Value::Null),
            (
                "last-collection-attempt",
                count(attempt.map(|value| value.completed_at_ms)),
            ),
            (
                "last-collection-success",
                count(good.map(|value| value.completed_at_ms)),
            ),
            ("local-database-bytes", Value::Null),
            ("local-wal-bytes", Value::Null),
            ("measured-denominator-ratio", Value::Null),
            ("missing-source-count", Value::Null),
            ("model-attribution-coverage", Value::Null),
            ("no-change-work", work.unwrap_or(Value::Null)),
            (
                "oldest-sync-backlog-age",
                count(
                    good.filter(|_| backlog == Some(true))
                        .and_then(|good| now_ms.checked_sub(good.completed_at_ms)),
                ),
            ),
            (
                "parser-schema-refusal-count",
                count(health.and_then(|health| health.schema_mismatch_records)),
            ),
            ("pricing-record-coverage", Value::Null),
            ("publication-lag", count(publication_lag)),
            (
                "scan-bytes",
                count(
                    health
                        .and_then(|health| health.verified_bytes.checked_add(health.parsed_bytes?)),
                ),
            ),
            (
                "scan-duration",
                count(
                    attempt
                        .and_then(|value| value.completed_at_ms.checked_sub(value.started_at_ms)),
                ),
            ),
            ("scan-files", count(health.and_then(|health| health.files))),
            (
                "selected-source-count",
                count(health.and_then(|health| health.files)),
            ),
            ("stale-partition-count", Value::Null),
            ("sync-backlog-count", count(backlog.map(u64::from))),
            ("warning-observation-count", count(warnings)),
        ];
        let summary = Self {
            schema_version: 1,
            profile: "source-health-v1".to_owned(),
            client: client.to_owned(),
            last_attempt: status.last_attempt.clone(),
            last_good: status.last_good.clone(),
            last_publication: status.last_publication.clone(),
            metrics: values
                .into_iter()
                .map(|(id, value)| (id.to_owned(), value))
                .collect(),
        };
        summary.validate(client)?;
        Ok(summary)
    }
    pub(crate) fn validate(&self, client: &str) -> Result<(), &'static str> {
        use serde_json::Value;
        let invalid = "stats_source_health_invalid";
        const MAX_TIME_MS: u64 = 8_640_000_000_000_000;
        let safe = |value: &Value| value.as_u64().is_some_and(|n| n <= 9_007_199_254_740_991);
        let observation = |value: &Observation| {
            value.started_at_ms <= value.completed_at_ms
                && value.completed_at_ms <= MAX_TIME_MS
                && value.health.validate()
                && value.health.codes.len() <= MAX_SOURCE_HEALTH_CODES
        };
        let text = |value: &Value| {
            value.as_str().is_some_and(|text| {
                !text.is_empty()
                    && text.len() <= SUMMARY_TEXT_BYTES
                    && text
                        .bytes()
                        .all(|byte| byte.is_ascii_graphic() || byte == b' ')
            })
        };
        let fields = |value: &Value, expected: &[(&str, bool)]| {
            value.as_object().is_some_and(|object| {
                object.len() == expected.len()
                    && expected.iter().all(|(key, nullable)| {
                        object
                            .get(*key)
                            .is_some_and(|value| safe(value) || (*nullable && value.is_null()))
                    })
            })
        };
        if self.schema_version != 1
            || self.profile != "source-health-v1"
            || self.client != client
            || !aicharts_import::clients().contains(&client)
            || !self.last_attempt.as_ref().is_none_or(observation)
            || !self.last_good.as_ref().is_none_or(|value| {
                observation(value) && value.health.outcome != ImportOutcome::Failed
            })
            || !self.last_publication.as_ref().is_none_or(|value| {
                value.observed_completed_at_ms <= value.at_ms && value.at_ms <= MAX_TIME_MS
            })
            || self.metrics.len() != SUMMARY_METRICS.len()
        {
            return Err(invalid);
        }
        for (id, kind) in SUMMARY_METRICS {
            let value = self.metrics.get(id).ok_or(invalid)?;
            let valid = value.is_null()
                || match kind {
                    MetricKind::Count => safe(value),
                    MetricKind::Timestamp => value
                        .as_i64()
                        .is_some_and(|n| n.unsigned_abs() <= MAX_TIME_MS),
                    MetricKind::Ratio => {
                        fields(value, &[("denominator", false), ("numerator", false)])
                            && value["denominator"].as_u64() != Some(0)
                    }
                    MetricKind::Status => text(value),
                    MetricKind::Work => fields(
                        value,
                        &[
                            ("files", true),
                            ("parsedBytes", true),
                            ("reusedFiles", false),
                            ("verifiedBytes", false),
                        ],
                    ),
                };
            if !valid {
                return Err(invalid);
            }
        }
        if serde_json::to_vec(self).map_err(|_| invalid)?.len() > MAX_HEALTH_SUMMARY_BYTES {
            return Err(invalid);
        }
        Ok(())
    }
}
