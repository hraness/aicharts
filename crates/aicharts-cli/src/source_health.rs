//! Durable numeric collection evidence, separate from publication and from
//! derived checkpoints. Private profile bindings never leave this store.
use aicharts_import::ImportHealth;
#[cfg(unix)]
use aicharts_import::ImportOutcome;
use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::{collections::BTreeMap, path::Path};

#[cfg_attr(not(unix), allow(dead_code))]
pub(crate) const MAX_SOURCE_HEALTH_BYTES: usize = 131_072;
pub(crate) const MAX_SOURCE_HEALTH_CLIENTS: usize = 55;
#[cfg_attr(not(unix), allow(dead_code))]
pub(crate) const MAX_SOURCE_HEALTH_CODES: usize = aicharts_import::MAX_SOURCE_HEALTH_CODES;
/// Incremental collection needs a fixture-supported checkpoint parser and an
/// exclusive source profile; every other selector replays its stores.
pub(crate) fn incremental_profile(options: &crate::stats::Options) -> Result<&str, &'static str> {
    if options.clients.len() != 1 {
        return Err("stats_sync_one_client_required");
    }
    let client = options.clients[0].as_str();
    if !aicharts_import::CHECKPOINT_CLIENTS.contains(&client) || options.source_roots.is_empty() {
        return Err("stats_incremental_profile_required");
    }
    Ok(client)
}
#[cfg(unix)]
const INVALID: &str = "source_health_invalid";
#[cfg(unix)]
const MAX_TIME_MS: u64 = 8_640_000_000_000_000;

#[cfg(all(test, unix))]
pub(crate) fn fixture_root() -> FixtureRoot {
    use std::os::unix::fs::DirBuilderExt;
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).unwrap();
    let name = nonce
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let path = std::env::temp_dir().join(format!(
        "aicharts-source-health-{}-{name}",
        std::process::id()
    ));
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&path)
        .unwrap();
    FixtureRoot(std::fs::canonicalize(path).unwrap())
}
#[cfg(all(test, unix))]
pub(crate) struct FixtureRoot(std::path::PathBuf);
#[cfg(all(test, unix))]
impl FixtureRoot {
    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}
#[cfg(all(test, unix))]
impl Drop for FixtureRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Observation {
    pub started_at_ms: u64,
    pub completed_at_ms: u64,
    pub health: ImportHealth,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(not(unix), allow(dead_code))]
pub(crate) enum PublicationOutcome {
    Pending,
    Uncertain,
    Succeeded,
    Failed,
    Abandoned,
}
#[cfg(all(unix, any(test, target_os = "macos")))]
impl PublicationOutcome {
    fn terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Abandoned)
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(not(unix), allow(dead_code))]
pub(crate) struct Publication {
    pub observed_completed_at_ms: u64,
    pub at_ms: u64,
    pub outcome: PublicationOutcome,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg(unix)]
struct BoundPublication {
    #[serde(with = "binding_codec")]
    scope: [u8; 32],
    #[serde(with = "binding_codec")]
    attempt: [u8; 32],
    #[serde(with = "binding_codec")]
    flight: [u8; 32],
    value: Publication,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg(unix)]
struct Bound<T> {
    #[serde(with = "binding_codec")]
    scope: [u8; 32],
    #[serde(with = "binding_codec")]
    attempt: [u8; 32],
    value: T,
}
#[cfg(unix)]
mod binding_codec {
    use serde::{de::Error, Deserialize};
    pub(super) fn serialize<S: serde::Serializer>(
        value: &[u8; 32],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(
            &value
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
        )
    }
    pub(super) fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<[u8; 32], D::Error> {
        let value = String::deserialize(deserializer)?;
        if value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(D::Error::custom("source_health_binding_invalid"));
        }
        let mut output = [0; 32];
        for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
            let nibble = |byte| {
                if byte <= b'9' {
                    byte - b'0'
                } else {
                    byte - b'a' + 10
                }
            };
            output[index] = (nibble(chunk[0]) << 4) | nibble(chunk[1]);
        }
        Ok(output)
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg(unix)]
struct Entry {
    last_attempt: Option<Bound<Observation>>,
    last_good: Option<Bound<Observation>>,
    last_publication: Option<BoundPublication>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg(unix)]
struct Document {
    schema_version: u8,
    clients: BTreeMap<String, Entry>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(unix), allow(dead_code))]
pub(crate) struct SourceHealth {
    pub last_attempt: Option<Observation>,
    pub last_good: Option<Observation>,
    pub last_publication: Option<Publication>,
}
#[cfg(unix)]
pub(crate) struct SourceHealthStore {
    cache: crate::source_refresh::disk::Cache,
    document: Document,
}
#[cfg(unix)]
impl SourceHealthStore {
    pub(crate) fn read_status(
        directory: &Path,
        client: &str,
        scope: [u8; 32],
    ) -> Result<Option<SourceHealth>, &'static str> {
        if !aicharts_import::clients().contains(&client) {
            return Err(INVALID);
        }
        let Some(bytes) = crate::source_refresh::disk::Cache::read_existing(
            directory,
            "health.json",
            MAX_SOURCE_HEALTH_BYTES,
        )?
        else {
            return Ok(None);
        };
        let document: Document = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
        validate(&document)?;
        Ok(Some(status(&document, client, scope)))
    }
    #[cfg(any(test, target_os = "macos"))]
    pub(crate) fn open(directory: &Path) -> Result<Self, &'static str> {
        let cache =
            crate::source_refresh::disk::Cache::open_snapshot(directory, MAX_SOURCE_HEALTH_BYTES)?;
        cache.require_entries(&["refresh.lock", "health.json"])?;
        let document = match cache.read("health.json", MAX_SOURCE_HEALTH_BYTES)? {
            Some(bytes) => serde_json::from_slice::<Document>(&bytes).map_err(|_| INVALID)?,
            None => Document {
                schema_version: 1,
                clients: BTreeMap::new(),
            },
        };
        validate(&document)?;
        Ok(Self { cache, document })
    }
    pub(crate) fn record_attempt(
        &mut self,
        client: &str,
        scope: [u8; 32],
        observation: Observation,
    ) -> Result<[u8; 32], &'static str> {
        let mut next = self.document.clone();
        let mut attempt = [0u8; 32];
        getrandom::fill(&mut attempt).map_err(|_| "source_health_random_unavailable")?;
        if next.clients.values().any(|entry| {
            entry
                .last_attempt
                .as_ref()
                .is_some_and(|a| a.attempt == attempt)
                || entry
                    .last_good
                    .as_ref()
                    .is_some_and(|a| a.attempt == attempt)
                || entry
                    .last_publication
                    .as_ref()
                    .is_some_and(|p| p.attempt == attempt)
        }) {
            return Err("source_health_attempt_collision");
        }
        let entry = next.clients.entry(client.to_owned()).or_default();
        if entry
            .last_attempt
            .as_ref()
            .is_some_and(|last| observation.started_at_ms < last.value.completed_at_ms)
            || entry
                .last_publication
                .as_ref()
                .is_some_and(|last| observation.started_at_ms < last.value.at_ms)
        {
            return Err("source_health_clock_regressed");
        }
        let complete = observation.health.outcome == ImportOutcome::Complete;
        let bound = Bound {
            scope,
            attempt,
            value: observation,
        };
        entry.last_attempt = Some(bound.clone());
        if complete {
            entry.last_good = Some(bound);
        }
        self.install(next)?;
        Ok(attempt)
    }
    /// Called after the native flight is durable and before transport. The
    /// digest covers the entire frozen Upload, including operation identity.
    #[cfg(any(test, target_os = "macos"))]
    pub(crate) fn begin_publication(
        &mut self,
        client: &str,
        scope: [u8; 32],
        attempt: [u8; 32],
        flight: [u8; 32],
        observed_completed_at_ms: u64,
        at_ms: u64,
    ) -> Result<(), &'static str> {
        if at_ms > MAX_TIME_MS || observed_completed_at_ms > at_ms {
            return Err(INVALID);
        }
        let mut next = self.document.clone();
        if next.clients.iter().any(|(other, entry)| {
            other != client
                && entry
                    .last_publication
                    .as_ref()
                    .is_some_and(|p| p.flight == flight)
        }) {
            return Err("source_health_publication_conflict");
        }
        let entry = next.clients.get_mut(client).ok_or(INVALID)?;
        let good = entry
            .last_good
            .as_ref()
            .filter(|good| good.scope == scope)
            .ok_or(INVALID)?;
        if good.value.completed_at_ms != observed_completed_at_ms || good.attempt != attempt {
            return Err("source_health_observation_changed");
        }
        if let Some(previous) = &entry.last_publication {
            if previous.flight == flight {
                return if previous.scope == scope
                    && previous.attempt == attempt
                    && previous.value.observed_completed_at_ms == observed_completed_at_ms
                {
                    Ok(())
                } else {
                    Err("source_health_publication_conflict")
                };
            }
            if !previous.value.outcome.terminal() {
                return Err("source_health_publication_pending");
            }
        }
        if at_ms < good.value.completed_at_ms
            || entry
                .last_publication
                .as_ref()
                .is_some_and(|last| at_ms < last.value.at_ms)
        {
            return Err("source_health_clock_regressed");
        }
        entry.last_publication = Some(BoundPublication {
            scope,
            attempt,
            flight,
            value: Publication {
                observed_completed_at_ms,
                at_ms,
                outcome: PublicationOutcome::Pending,
            },
        });
        self.install(next)
    }
    /// A pre-upgrade retained flight may have no source-health binding. False
    /// is explicit unknown evidence, not a failed native publication and not a
    /// reason to reread source files or invent an observation.
    #[cfg(any(test, target_os = "macos"))]
    pub(crate) fn reconcile_publication(
        &mut self,
        flight: [u8; 32],
        at_ms: u64,
        outcome: PublicationOutcome,
    ) -> Result<bool, &'static str> {
        if outcome == PublicationOutcome::Pending || at_ms > MAX_TIME_MS {
            return Err(INVALID);
        }
        let mut next = self.document.clone();
        let Some(publication) = next
            .clients
            .values_mut()
            .filter_map(|entry| entry.last_publication.as_mut())
            .find(|p| p.flight == flight)
        else {
            return Ok(false);
        };
        if publication.value.outcome.terminal() {
            return if publication.value.outcome == outcome {
                Ok(true)
            } else {
                Err("source_health_publication_conflict")
            };
        }
        if at_ms < publication.value.at_ms {
            return Err("source_health_clock_regressed");
        }
        publication.value.at_ms = at_ms;
        publication.value.outcome = outcome;
        self.install(next)?;
        Ok(true)
    }
    #[cfg(test)]
    pub(crate) fn status(&self, client: &str, scope: [u8; 32]) -> SourceHealth {
        status(&self.document, client, scope)
    }
    fn install(&mut self, next: Document) -> Result<(), &'static str> {
        validate(&next)?;
        let bytes = serde_json::to_vec(&next).map_err(|_| INVALID)?;
        if bytes.len() > MAX_SOURCE_HEALTH_BYTES {
            return Err("source_health_capacity");
        }
        self.cache.replace("health.json", &bytes)?;
        self.document = next;
        Ok(())
    }
}
#[cfg(unix)]
fn status(document: &Document, client: &str, scope: [u8; 32]) -> SourceHealth {
    let entry = document.clients.get(client);
    SourceHealth {
        last_attempt: entry
            .and_then(|e| e.last_attempt.as_ref())
            .filter(|b| b.scope == scope)
            .map(|b| b.value.clone()),
        last_good: entry
            .and_then(|e| e.last_good.as_ref())
            .filter(|b| b.scope == scope)
            .map(|b| b.value.clone()),
        last_publication: entry
            .and_then(|e| e.last_publication.as_ref())
            .filter(|b| b.scope == scope)
            .map(|b| b.value.clone()),
    }
}
#[cfg(unix)]
fn valid_observation(value: &Observation) -> bool {
    value.started_at_ms <= value.completed_at_ms
        && value.completed_at_ms <= MAX_TIME_MS
        && value.health.validate()
        && value.health.codes.len() <= MAX_SOURCE_HEALTH_CODES
}
#[cfg(unix)]
fn validate(document: &Document) -> Result<(), &'static str> {
    if document.schema_version != 1 || document.clients.len() > MAX_SOURCE_HEALTH_CLIENTS {
        return Err(INVALID);
    }
    let mut flights = std::collections::BTreeSet::new();
    let mut attempts = BTreeMap::new();
    for (client, entry) in &document.clients {
        if !aicharts_import::clients().contains(&client.as_str())
            || entry
                .last_attempt
                .as_ref()
                .is_none_or(|b| !valid_observation(&b.value))
            || entry.last_good.as_ref().is_some_and(|b| {
                !valid_observation(&b.value)
                    || b.value.health.outcome != ImportOutcome::Complete
                    || entry
                        .last_attempt
                        .as_ref()
                        .is_none_or(|a| b.value.completed_at_ms > a.value.completed_at_ms)
                    || entry.last_attempt.as_ref().is_some_and(|a| {
                        (a.attempt == b.attempt
                            || a.value.health.outcome == ImportOutcome::Complete)
                            && a != b
                    })
            })
            || entry.last_attempt.as_ref().is_some_and(|a| {
                a.value.health.outcome == ImportOutcome::Complete
                    && entry.last_good.as_ref() != Some(a)
            })
            || entry.last_publication.as_ref().is_some_and(|b| {
                b.value.at_ms > MAX_TIME_MS
                    || b.value.observed_completed_at_ms > b.value.at_ms
                    || entry.last_good.as_ref().is_none_or(|good| {
                        b.value.observed_completed_at_ms > good.value.completed_at_ms
                    })
                    || !flights.insert(b.flight)
            })
        {
            return Err(INVALID);
        }
        // An attempt can be retained in several roles, but all references must
        // bind the same client, profile and completed source observation. Old
        // publication bindings remain valid after a later lastGood replaces it.
        for (attempt, scope, completed_at_ms) in entry
            .last_attempt
            .iter()
            .chain(entry.last_good.iter())
            .map(|bound| (bound.attempt, bound.scope, bound.value.completed_at_ms))
            .chain(entry.last_publication.iter().map(|bound| {
                (
                    bound.attempt,
                    bound.scope,
                    bound.value.observed_completed_at_ms,
                )
            }))
        {
            let binding = (client, scope, completed_at_ms);
            if attempts
                .insert(attempt, binding)
                .is_some_and(|old| old != binding)
            {
                return Err(INVALID);
            }
        }
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn identical_same_millisecond_scans_have_distinct_private_publication_bindings() {
        let temp = crate::source_health::fixture_root();
        let root = temp.path();
        let directory = root.join("health");
        let health =
            aicharts_import::collect_observed(root, "codex", &[root.to_owned()], None, 0, None)
                .health;
        let observation = Observation {
            started_at_ms: 1,
            completed_at_ms: 1,
            health,
        };
        let mut store = SourceHealthStore::open(&directory).unwrap();
        let earlier = store
            .record_attempt("codex", [1; 32], observation.clone())
            .unwrap();
        let later = store.record_attempt("codex", [1; 32], observation).unwrap();
        assert_ne!(earlier, later);
        let before = fs::read(directory.join("health.json")).unwrap();
        assert_eq!(
            store.begin_publication("codex", [1; 32], earlier, [7; 32], 1, 2),
            Err("source_health_observation_changed")
        );
        assert_eq!(fs::read(directory.join("health.json")).unwrap(), before);
        drop(store);
        let mut store = SourceHealthStore::open(&directory).unwrap();
        store
            .begin_publication("codex", [1; 32], later, [7; 32], 1, 2)
            .unwrap();
        let json = serde_json::to_value(store.status("codex", [1; 32])).unwrap();
        assert!(json["lastAttempt"].get("attempt").is_none());
        assert!(json["lastGood"].get("attempt").is_none());
        assert!(json["lastPublication"].get("attempt").is_none());
        assert!(json["lastPublication"].get("flight").is_none());
        assert!(json["lastPublication"].get("scope").is_none());
    }

    #[test]
    fn stored_attempt_aliases_and_noncanonical_ids_are_rejected_without_replacement() {
        let temp = crate::source_health::fixture_root();
        let root = temp.path();
        let directory = root.join("health");
        let health =
            aicharts_import::collect_observed(root, "codex", &[root.to_owned()], None, 0, None)
                .health;
        let mut store = SourceHealthStore::open(&directory).unwrap();
        let attempt = store
            .record_attempt(
                "codex",
                [1; 32],
                Observation {
                    started_at_ms: 1,
                    completed_at_ms: 2,
                    health,
                },
            )
            .unwrap();
        store
            .begin_publication("codex", [1; 32], attempt, [7; 32], 2, 3)
            .unwrap();
        let before = fs::read(directory.join("health.json")).unwrap();
        let mut duplicate = store.document.clone();
        let mut alias = duplicate.clients["codex"].clone();
        alias.last_publication = None;
        duplicate.clients.insert("claude".to_owned(), alias);
        assert_eq!(store.install(duplicate), Err(INVALID));
        let mut changed_scope = store.document.clone();
        changed_scope
            .clients
            .get_mut("codex")
            .unwrap()
            .last_publication
            .as_mut()
            .unwrap()
            .scope = [2; 32];
        assert_eq!(store.install(changed_scope), Err(INVALID));
        let mut changed_good = store.document.clone();
        changed_good
            .clients
            .get_mut("codex")
            .unwrap()
            .last_good
            .as_mut()
            .unwrap()
            .value
            .started_at_ms = 0;
        assert_eq!(store.install(changed_good), Err(INVALID));
        assert_eq!(fs::read(directory.join("health.json")).unwrap(), before);
        let value = serde_json::to_value(&store.document).unwrap();
        for (role, field) in [
            ("lastAttempt", "attempt"),
            ("lastGood", "scope"),
            ("lastPublication", "flight"),
        ] {
            for malformed in ["A".repeat(64), "0".repeat(63), "g".repeat(64)] {
                let mut value = value.clone();
                value["clients"]["codex"][role][field] = malformed.into();
                assert!(serde_json::from_value::<Document>(value).is_err());
            }
        }
    }

    #[test]
    fn retained_stage_refuses_new_mutation_but_preserves_readonly_current_health() {
        let temp = crate::source_health::fixture_root();
        let root = temp.path();
        let directory = root.join("health");
        let health =
            aicharts_import::collect_observed(root, "codex", &[root.to_owned()], None, 0, None)
                .health;
        let mut store = SourceHealthStore::open(&directory).unwrap();
        store
            .record_attempt(
                "codex",
                [1; 32],
                Observation {
                    started_at_ms: 1,
                    completed_at_ms: 2,
                    health: health.clone(),
                },
            )
            .unwrap();
        let before = fs::read(directory.join("health.json")).unwrap();
        let retained = directory.join(".refresh-interrupted.pending");
        fs::write(&retained, b"retained stage evidence").unwrap();
        assert_eq!(
            store.record_attempt(
                "codex",
                [1; 32],
                Observation {
                    started_at_ms: 3,
                    completed_at_ms: 4,
                    health
                }
            ),
            Err("source_snapshot_recovery_required")
        );
        assert_eq!(fs::read(directory.join("health.json")).unwrap(), before);
        assert_eq!(fs::read(&retained).unwrap(), b"retained stage evidence");
        assert_eq!(
            SourceHealthStore::read_status(&directory, "codex", [1; 32])
                .unwrap()
                .unwrap()
                .last_good
                .unwrap()
                .completed_at_ms,
            2
        );
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 3);
    }
    #[test]
    fn readonly_health_status_creates_nothing_and_reads_atomic_prior_or_new_snapshots() {
        let temp = crate::source_health::fixture_root();
        let root = temp.path();
        let directory = root.join("health");
        assert!(SourceHealthStore::read_status(&directory, "codex", [1; 32])
            .unwrap()
            .is_none());
        assert!(!directory.exists());
        let health =
            aicharts_import::collect_observed(root, "codex", &[root.to_owned()], None, 0, None)
                .health;
        let mut store = SourceHealthStore::open(&directory).unwrap();
        store
            .record_attempt(
                "codex",
                [1; 32],
                Observation {
                    started_at_ms: 1,
                    completed_at_ms: 1,
                    health: health.clone(),
                },
            )
            .unwrap();
        assert!(SourceHealthStore::read_status(&directory, "codex", [1; 32])
            .unwrap()
            .unwrap()
            .last_good
            .is_some());
        drop(store);
        // Read-only inspection must work even when no lock file exists.
        fs::remove_file(directory.join("refresh.lock")).unwrap();
        let bytes = fs::read(directory.join("health.json")).unwrap();
        SourceHealthStore::read_status(&directory, "codex", [1; 32]).unwrap();
        assert!(!directory.join("refresh.lock").exists());
        assert_eq!(fs::read(directory.join("health.json")).unwrap(), bytes);
        std::thread::scope(|scope| {
            let writer = scope.spawn(|| {
                let mut store = SourceHealthStore::open(&directory).unwrap();
                for time in 2..=50 {
                    store
                        .record_attempt(
                            "codex",
                            [1; 32],
                            Observation {
                                started_at_ms: time,
                                completed_at_ms: time,
                                health: health.clone(),
                            },
                        )
                        .unwrap();
                }
            });
            for _ in 0..100 {
                let status = SourceHealthStore::read_status(&directory, "codex", [1; 32])
                    .unwrap()
                    .unwrap();
                assert!((1..=50).contains(&status.last_good.unwrap().completed_at_ms));
            }
            writer.join().unwrap();
        });
    }
    #[test]
    fn health_all_roster_worst_case_bytes_are_measured_and_capacity_refuses_atomically() {
        use aicharts_import::HealthCode;
        let temp = crate::source_health::fixture_root();
        let root = temp.path().to_owned();
        let mut health = aicharts_import::collect_observed(
            &root,
            "codex",
            std::slice::from_ref(&root),
            None,
            0,
            None,
        )
        .health;
        health.parser_generation = "aicharts-1-18446744073709551615".to_owned();
        health.files = Some(65_536);
        health.records = Some(2_000_000);
        health.logical_bytes = Some(9_007_199_254_740_991);
        health.parsed_bytes = Some(9_007_199_254_740_991);
        health.verified_bytes = 9_007_199_254_740_991;
        health.reused_files = 65_536;
        // Unmeasured coverage carries the longest code list, the worst case.
        health.schema_mismatch_records = None;
        health.clamped_records = Some(9_007_199_254_740_991);
        health.fallback_records = Some(9_007_199_254_740_991);
        health.estimated_records = Some(2_000_000);
        health.event_min_ms = Some(-8_640_000_000_000_000);
        health.event_max_ms = Some(8_640_000_000_000_000);
        health.codes = vec![
            HealthCode::SchemaCoverageLimited,
            HealthCode::CheckpointReplay,
            HealthCode::CheckpointUnsupported,
            HealthCode::CheckpointCapacity,
            HealthCode::Clamped,
            HealthCode::Fallback,
            HealthCode::Estimated,
        ];
        assert!(health.validate());
        let observation = Observation {
            started_at_ms: 8_640_000_000_000_000,
            completed_at_ms: 8_640_000_000_000_000,
            health,
        };
        let mut failed = observation.clone();
        failed.health.outcome = ImportOutcome::Failed;
        failed.health.deferred_tail_files = Some(65_536);
        failed.health.codes.extend([
            HealthCode::SourceFailed,
            HealthCode::ProjectionRefused,
            HealthCode::DeferredTail,
        ]);
        assert_eq!(failed.health.codes.len(), 10);
        assert!(failed.health.validate());
        let mut document = Document {
            schema_version: 1,
            clients: BTreeMap::new(),
        };
        for (index, client) in aicharts_import::clients().into_iter().enumerate() {
            let mut flight = [255; 32];
            flight[0] = index as u8;
            let mut failed_attempt = [254; 32];
            failed_attempt[0] = index as u8;
            document.clients.insert(
                client.to_owned(),
                Entry {
                    last_attempt: Some(Bound {
                        scope: [255; 32],
                        attempt: failed_attempt,
                        value: failed.clone(),
                    }),
                    last_good: Some(Bound {
                        scope: [255; 32],
                        attempt: flight,
                        value: observation.clone(),
                    }),
                    last_publication: Some(BoundPublication {
                        scope: [255; 32],
                        attempt: flight,
                        flight,
                        value: Publication {
                            at_ms: 8_640_000_000_000_000,
                            observed_completed_at_ms: 8_640_000_000_000_000,
                            outcome: PublicationOutcome::Succeeded,
                        },
                    }),
                },
            );
        }
        validate(&document).unwrap();
        let size = serde_json::to_vec(&document).unwrap().len();
        println!("all_roster_worst_case_health_bytes={size}");
        assert!(size <= MAX_SOURCE_HEALTH_BYTES);
        let directory = root.join("health");
        let mut store = SourceHealthStore::open(&directory).unwrap();
        store
            .record_attempt("codex", [255; 32], observation)
            .unwrap();
        store.install(document).unwrap();
        let before = fs::read(directory.join("health.json")).unwrap();
        assert_eq!(store.document.clients.len(), 55);
        assert!(store
            .cache
            .replace("health.json", &vec![b' '; MAX_SOURCE_HEALTH_BYTES + 1])
            .is_err());
        assert_eq!(fs::read(directory.join("health.json")).unwrap(), before);
    }
    #[test]
    fn failed_scan_and_failed_publication_preserve_good_health_across_restart() {
        let temp = crate::source_health::fixture_root();
        let root = fs::canonicalize(temp.path()).unwrap();
        let good = aicharts_import::collect_observed(
            &root,
            "codex",
            std::slice::from_ref(&root),
            None,
            0,
            None,
        )
        .health;
        let directory = root.join("health");
        let mut store = SourceHealthStore::open(&directory).unwrap();
        store
            .record_attempt(
                "codex",
                [1; 32],
                Observation {
                    started_at_ms: 1,
                    completed_at_ms: 2,
                    health: good.clone(),
                },
            )
            .unwrap();
        let attempt = store.document.clients["codex"]
            .last_good
            .as_ref()
            .unwrap()
            .attempt;
        store
            .begin_publication("codex", [1; 32], attempt, [7; 32], 2, 2)
            .unwrap();
        store
            .reconcile_publication([7; 32], 3, PublicationOutcome::Failed)
            .unwrap();
        let before = store.status("codex", [1; 32]).last_good;
        let failed = aicharts_import::collect_observed(&root, "codex", &[], None, 0, None).health;
        store
            .record_attempt(
                "codex",
                [1; 32],
                Observation {
                    started_at_ms: 4,
                    completed_at_ms: 5,
                    health: failed,
                },
            )
            .unwrap();
        assert_eq!(store.status("codex", [1; 32]).last_good, before);
        assert!(store.status("codex", [2; 32]).last_good.is_none());
        assert!(store
            .record_attempt(
                "codex",
                [1; 32],
                Observation {
                    started_at_ms: 4,
                    completed_at_ms: 6,
                    health: good
                }
            )
            .is_err());
        drop(store);
        let reopened = SourceHealthStore::open(&directory).unwrap();
        let status = reopened.status("codex", [1; 32]);
        assert_eq!(status.last_good, before);
        assert_eq!(
            status.last_attempt.unwrap().health.outcome,
            ImportOutcome::Failed
        );
        assert_eq!(
            status.last_publication.unwrap().outcome,
            PublicationOutcome::Failed
        );
        let json = serde_json::to_string(&reopened.status("codex", [1; 32])).unwrap();
        assert!(!json.contains("scope"));
        assert!(!json.contains(root.to_str().unwrap()));
    }

    #[test]
    fn publication_pending_uncertain_recovery_and_late_reply_keep_exact_flight_identity() {
        let temp = crate::source_health::fixture_root();
        let root = fs::canonicalize(temp.path()).unwrap();
        let health = aicharts_import::collect_observed(
            &root,
            "codex",
            std::slice::from_ref(&root),
            None,
            0,
            None,
        )
        .health;
        let directory = root.join("health");
        let mut store = SourceHealthStore::open(&directory).unwrap();
        assert!(!store
            .reconcile_publication([9; 32], 1, PublicationOutcome::Succeeded)
            .unwrap());
        assert!(
            !directory.join("health.json").exists(),
            "unknown pre-upgrade flight creates no evidence"
        );
        store
            .record_attempt(
                "codex",
                [1; 32],
                Observation {
                    started_at_ms: 1,
                    completed_at_ms: 2,
                    health,
                },
            )
            .unwrap();
        let attempt = store.document.clients["codex"]
            .last_good
            .as_ref()
            .unwrap()
            .attempt;
        store
            .begin_publication("codex", [1; 32], attempt, [2; 32], 2, 3)
            .unwrap();
        assert_eq!(
            store
                .status("codex", [1; 32])
                .last_publication
                .unwrap()
                .outcome,
            PublicationOutcome::Pending
        );
        drop(store); // Crash before send retains pending, never success.
        let mut store = SourceHealthStore::open(&directory).unwrap();
        assert!(store
            .begin_publication("codex", [1; 32], attempt, [3; 32], 2, 4)
            .is_err());
        store
            .reconcile_publication([2; 32], 4, PublicationOutcome::Uncertain)
            .unwrap();
        assert!(store
            .begin_publication("codex", [1; 32], attempt, [3; 32], 2, 5)
            .is_err());
        store
            .reconcile_publication([2; 32], 5, PublicationOutcome::Succeeded)
            .unwrap();
        store
            .begin_publication("codex", [1; 32], attempt, [3; 32], 2, 6)
            .unwrap();
        let before = fs::read(directory.join("health.json")).unwrap();
        assert!(!store
            .reconcile_publication([2; 32], 7, PublicationOutcome::Failed)
            .unwrap());
        assert_eq!(fs::read(directory.join("health.json")).unwrap(), before);
        store
            .reconcile_publication([3; 32], 7, PublicationOutcome::Abandoned)
            .unwrap();
        assert!(store
            .reconcile_publication([3; 32], 8, PublicationOutcome::Succeeded)
            .is_err());
        assert_eq!(
            store
                .status("codex", [1; 32])
                .last_publication
                .unwrap()
                .outcome,
            PublicationOutcome::Abandoned
        );
    }

    #[test]
    fn health_refuses_symlink_targets_and_invalid_relations_without_replacing_good_bytes() {
        let temp = crate::source_health::fixture_root();
        let root = fs::canonicalize(temp.path()).unwrap();
        let health = aicharts_import::collect_observed(
            &root,
            "codex",
            std::slice::from_ref(&root),
            None,
            0,
            None,
        )
        .health;
        let directory = root.join("health");
        let mut store = SourceHealthStore::open(&directory).unwrap();
        store
            .record_attempt(
                "codex",
                [1; 32],
                Observation {
                    started_at_ms: 1,
                    completed_at_ms: 2,
                    health: health.clone(),
                },
            )
            .unwrap();
        let before = fs::read(directory.join("health.json")).unwrap();
        let mut invalid = health;
        invalid.verified_bytes = u64::MAX;
        assert!(store
            .record_attempt(
                "codex",
                [1; 32],
                Observation {
                    started_at_ms: 3,
                    completed_at_ms: 4,
                    health: invalid
                }
            )
            .is_err());
        assert_eq!(fs::read(directory.join("health.json")).unwrap(), before);
        drop(store);
        fs::rename(directory.join("health.json"), root.join("retained.json")).unwrap();
        std::os::unix::fs::symlink(root.join("retained.json"), directory.join("health.json"))
            .unwrap();
        assert!(SourceHealthStore::open(&directory).is_err());
        assert_eq!(fs::read(root.join("retained.json")).unwrap(), before);
    }
}
