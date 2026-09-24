//! Collection evidence is separate from the stable numeric report. Ordinary
//! stats collection never opens a persistent store or creates a lock file.
use super::{Options, Report};
#[cfg(unix)]
use crate::source_health::SourceHealthStore;
#[cfg(target_os = "macos")]
use crate::source_health::MAX_SOURCE_HEALTH_BYTES;
use crate::source_health::{Observation, MAX_SOURCE_HEALTH_CLIENTS};
#[cfg(unix)]
use aicharts_import::ImportCheckpoint;
use aicharts_import::{HealthCode, ImportHealth, ImportOutcome};
use serde::Serialize;
#[cfg(unix)]
use sha2::{Digest, Sha256};
#[cfg(unix)]
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
    #[cfg(unix)]
    health: SourceHealthStore,
    #[cfg(unix)]
    checkpoint: Option<(crate::source_checkpoint::SourceCheckpoint, ImportCheckpoint)>,
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
        if incremental && (options.clients[0] != "codex" || options.source_roots.is_empty()) {
            return Err("stats_incremental_profile_required");
        }
        let health = SourceHealthStore::open(&state.join("source-health-v1"))?;
        let mut replayed = false;
        let checkpoint = if incremental {
            let store = crate::source_checkpoint::SourceCheckpoint::open(
                &state.join("source-checkpoint-codex-v1"),
            )?;
            let value = match store.load() {
                Ok(value) => value,
                Err("import_checkpoint_invalid" | "import_checkpoint_generation_mismatch") => {
                    replayed = true;
                    ImportCheckpoint::default()
                }
                Err(code) => return Err(code),
            };
            Some((store, value))
        } else {
            None
        };
        Ok(Self {
            health,
            checkpoint,
            replayed,
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
        let binding = self.health.record_attempt(
            client,
            observation_scope(client, options),
            observation.clone(),
        )?;
        if observation.health.outcome == ImportOutcome::Complete {
            if let Some((store, value)) = &self.checkpoint {
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
#[cfg(target_os = "macos")]
pub(crate) fn collect_persisted(
    options: &Options,
    now: u64,
    state: &Path,
    incremental: bool,
) -> Result<CollectedStats, &'static str> {
    // The persistent and exported forms have independent fixed ceilings.
    const {
        assert!(MAX_HEALTH_REPORT_BYTES <= MAX_SOURCE_HEALTH_BYTES);
    }
    let mut persistence = Persistence::open(options, state, incremental)?;
    super::collect_detailed_with_clock(options, now, super::now_ms, Some(&mut persistence))
}

const HEALTH_HELP: &str = "AI Charts source health — local, read-only\n\n  aicharts stats-health --state-dir DIR --home DIR --client ID [--source-root DIR ...] [--since YYYY-MM-DD --until YYYY-MM-DD]\n\nReads the last collection attempt, last complete good observation and independent\npublication outcome for this exact profile and UTC range. It does not scan source\nfiles, open a write lock, create state, refresh providers or upload anything.\nUse the same home, exclusive roots and dates as the collection. A missing or\ndifferent profile has null evidence; it is never reported as a successful scan.\nOutput contains fixed codes, bounded numbers and times, with no source paths.\n";
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
