//! Collector health: what `aicharts status` reads from the AI Charts folder.
//!
//! Two files, both optional and both read-only here:
//! - `collector-status.json`, written by `aicharts daemon --status-file` after
//!   every collection pass (time, result and the fixed error codes of recent
//!   passes);
//! - `autosubmit-runtime/last-cycle.json`, written by each publishing cycle
//!   (per-agent result and fixed error codes; its file time is the sync time).
//!
//! Neither holds account identifiers, paths or session content. Reads are
//! bounded, and anything unreadable counts as "not there".

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;

const MAX_STATUS_BYTES: u64 = 64 * 1024;
/// A collector that has not reported for this long counts as stopped.
const MIN_STALE: Duration = Duration::from_secs(60 * 60);

pub const COLLECTOR_STATUS: &str = "collector-status.json";
pub const LAST_CYCLE: &str = "autosubmit-runtime/last-cycle.json";
pub const ERROR_LOG: &str = "daemon.err.log";

/// The collector's own report, `collector-status.json` schema version 1.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectorStatus {
    pub schema_version: u32,
    /// Seconds since the Unix epoch.
    pub updated_at: u64,
    pub interval_seconds: u64,
    pub last_pass: Pass,
    pub last_success_at: Option<u64>,
    /// Failed passes among the retained recent passes, by fixed code.
    #[serde(default)]
    pub recent_failures: Vec<FailureCount>,
    #[serde(default)]
    pub recent_passes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Pass {
    pub at: u64,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct FailureCount {
    pub code: String,
    pub count: u32,
}

/// `last-cycle.json`, schema version 1.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCycle {
    pub schema_version: u32,
    pub status: String,
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default)]
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Step {
    pub action: String,
    pub client: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

/// Everything `aicharts status` shows about collection and publishing.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Health {
    pub collector: Option<CollectorStatus>,
    pub cycle: Option<(LastCycle, SystemTime)>,
    /// Whether the collector's error log exists.
    pub error_log: bool,
}

/// Where the collector keeps its files: `AICHARTS_HOME`, else `~/.aicharts`.
pub fn aicharts_home(env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    if let Some(value) = env("AICHARTS_HOME").filter(|value| !value.is_empty()) {
        let path = PathBuf::from(value);
        return path.is_absolute().then_some(path);
    }
    let home = PathBuf::from(env("HOME")?);
    home.is_absolute().then(|| home.join(".aicharts"))
}

fn read_small(path: &Path) -> Option<(Vec<u8>, SystemTime)> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_STATUS_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(MAX_STATUS_BYTES)
        .read_to_end(&mut bytes)
        .ok()?;
    Some((bytes, meta.modified().ok()?))
}

impl Health {
    pub fn read(home: &Path) -> Self {
        let collector = read_small(&home.join(COLLECTOR_STATUS))
            .and_then(|(bytes, _)| serde_json::from_slice::<CollectorStatus>(&bytes).ok())
            .filter(|status| status.schema_version == 1);
        let cycle = read_small(&home.join(LAST_CYCLE)).and_then(|(bytes, modified)| {
            serde_json::from_slice::<LastCycle>(&bytes)
                .ok()
                .filter(|cycle| cycle.schema_version == 1 && !cycle.dry_run)
                .map(|cycle| (cycle, modified))
        });
        let error_log = fs::symlink_metadata(home.join(ERROR_LOG)).is_ok_and(|meta| meta.is_file());
        Health {
            collector,
            cycle,
            error_log,
        }
    }
}

/// The agent's display name for a fixed client ID.
pub fn client_name(id: &str) -> String {
    match id {
        "codex" => "Codex".into(),
        "claude" => "Claude Code".into(),
        "devin" | "devin-cli" => "Devin".into(),
        "cursor" => "Cursor".into(),
        "warp" => "Warp".into(),
        "gemini" => "Gemini".into(),
        "opencode" => "OpenCode".into(),
        other => {
            let mut chars = other.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect(),
                None => "An agent".into(),
            }
        }
    }
}

/// A plain explanation for a fixed collector or publishing error code.
pub fn explain(code: &str) -> &'static str {
    match code {
        "ledger_source_history_changed" => {
            "A session file was rewritten. The next pass reads it again."
        }
        "ledger_measurement_conflict" => {
            "Two reads of a session disagreed. The next pass reads it again."
        }
        "source_changed_during_scan" => {
            "A session file changed while it was read. The next pass retries."
        }
        "source_byte_limit" => "A session file is too large to read.",
        "ledger_busy_retry" | "ledger_changed_retry" | "attempt_busy" => {
            "Another AI Charts command was using your usage data."
        }
        "attempt_recovery_required" => "An earlier upload has to finish first.",
        "import_time_limit" | "stats_import_incomplete" => "Reading your sessions took too long.",
        "custody_interaction_required" => "macOS needs you to approve AI Charts' saved keys again.",
        "stats_sync_request_refused" | "upload_refused" => {
            "The AI Charts service refused the upload."
        }
        "network_unavailable" | "stats_sync_transport_failed" | "upload_transport_failed" => {
            "AI Charts couldn't reach the internet."
        }
        _ => "Something went wrong. The error log has details.",
    }
}

/// Whether a failure needs the person ("needs you" in `status`) or
/// clears on its own at the next pass (a ⚠︎ row only).
pub fn needs_person(code: &str) -> bool {
    !matches!(
        code,
        "ledger_source_history_changed"
            | "ledger_measurement_conflict"
            | "source_changed_during_scan"
            | "ledger_busy_retry"
            | "ledger_changed_retry"
            | "attempt_busy"
            | "network_unavailable"
            | "stats_sync_transport_failed"
            | "upload_transport_failed"
    )
}

/// "just now", "4 min ago", "3 hours ago", "2 days ago".
pub fn ago(then: SystemTime, now: SystemTime) -> String {
    let seconds = now.duration_since(then).unwrap_or_default().as_secs();
    match seconds {
        0..=59 => "just now".into(),
        60..=3_599 => format!("{} min ago", seconds / 60),
        3_600..=7_199 => "1 hour ago".into(),
        7_200..=86_399 => format!("{} hours ago", seconds / 3_600),
        86_400..=172_799 => "yesterday".into(),
        _ => format!("{} days ago", seconds / 86_400),
    }
}

pub fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(seconds)
}

/// The collector's state, for the first status row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Collector {
    /// Neither file exists: publishing was never set up on this Mac.
    NotSetUp,
    /// Only publishing results exist (an older collector without a status file).
    Unknown,
    Collecting {
        last: SystemTime,
    },
    /// The last pass failed with this code.
    Failing {
        code: String,
        last: SystemTime,
    },
    /// No report for more than three intervals.
    Stopped {
        last: SystemTime,
    },
}

/// One problem worth a ⚠︎ row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Problem {
    pub label: String,
    pub detail: String,
    pub code: String,
}

impl Health {
    pub fn collector_state(&self, now: SystemTime) -> Collector {
        let Some(status) = &self.collector else {
            return if self.cycle.is_some() {
                Collector::Unknown
            } else {
                Collector::NotSetUp
            };
        };
        let updated = at(status.updated_at);
        let stale = Duration::from_secs(status.interval_seconds.saturating_mul(3)).max(MIN_STALE);
        if now.duration_since(updated).unwrap_or_default() > stale {
            return Collector::Stopped { last: updated };
        }
        let last = at(status.last_pass.at);
        match (&status.last_pass.error, status.last_pass.ok) {
            (Some(code), false) => Collector::Failing {
                code: code.clone(),
                last,
            },
            (None, false) => Collector::Failing {
                code: "unknown".into(),
                last,
            },
            _ => Collector::Collecting { last },
        }
    }

    /// The publishing problem, if the last cycle did not publish everything.
    pub fn sync_problem(&self, now: SystemTime) -> Option<Problem> {
        let (cycle, when) = self.cycle.as_ref()?;
        if cycle.status == "complete" {
            return None;
        }
        let failed: Vec<&Step> = cycle
            .steps
            .iter()
            .filter(|step| step.status == "failed")
            .collect();
        let when = ago(*when, now);
        let first = failed.first();
        let code = first
            .and_then(|step| step.error.clone())
            .unwrap_or_else(|| cycle.status.clone());
        let label = match (failed.len(), first.and_then(|step| step.client.as_deref())) {
            (1, Some(client)) => format!("{} didn't publish", client_name(client)),
            (0 | 1, _) => "Last publish didn't finish".to_owned(),
            (count, _) => format!("{count} agents didn't publish"),
        };
        Some(Problem {
            detail: format!("{} · {when}", explain(&code).trim_end_matches('.')),
            label,
            code,
        })
    }

    /// Passes that failed recently while the last one succeeded.
    pub fn recent_failures(&self) -> Option<Problem> {
        let status = self.collector.as_ref()?;
        let total: u32 = status
            .recent_failures
            .iter()
            .map(|failure| failure.count)
            .sum();
        if total == 0 || !status.last_pass.ok {
            return None;
        }
        let top = status
            .recent_failures
            .iter()
            .max_by_key(|failure| failure.count)?;
        let label = if total == 1 {
            "1 recent pass didn't finish".to_owned()
        } else {
            format!("{total} recent passes didn't finish")
        };
        Some(Problem {
            label,
            detail: explain(&top.code).trim_end_matches('.').to_owned(),
            code: top.code.clone(),
        })
    }

    /// When publishing last completed, from the cycle file's time.
    pub fn last_sync(&self) -> Option<SystemTime> {
        self.cycle.as_ref().map(|(_, when)| *when)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(
        updated: u64,
        ok: bool,
        error: Option<&str>,
        failures: &[(&str, u32)],
    ) -> CollectorStatus {
        CollectorStatus {
            schema_version: 1,
            updated_at: updated,
            interval_seconds: 900,
            last_pass: Pass {
                at: updated,
                ok,
                error: error.map(str::to_owned),
            },
            last_success_at: ok.then_some(updated),
            recent_failures: failures
                .iter()
                .map(|(code, count)| FailureCount {
                    code: (*code).into(),
                    count: *count,
                })
                .collect(),
            recent_passes: 96,
        }
    }

    #[test]
    fn reads_both_files_and_ignores_unknown_schemas() {
        let dir = std::env::temp_dir().join(format!("aicharts-health-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("autosubmit-runtime")).unwrap();
        std::fs::write(
            dir.join(COLLECTOR_STATUS),
            r#"{"schemaVersion":1,"updatedAt":100,"intervalSeconds":900,"lastPass":{"at":100,"ok":true,"error":null},"lastSuccessAt":100,"recentFailures":[{"code":"source_byte_limit","count":2}],"recentPasses":10}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join(LAST_CYCLE),
            r#"{"dryRun":false,"schemaVersion":1,"status":"partial_failure","steps":[{"action":"publish","client":"cursor","error":"stats_sync_request_refused","status":"failed"}]}"#,
        )
        .unwrap();
        let health = Health::read(&dir);
        assert_eq!(
            health.collector.as_ref().unwrap().recent_failures[0].count,
            2
        );
        assert_eq!(health.cycle.as_ref().unwrap().0.status, "partial_failure");
        assert!(!health.error_log);
        std::fs::write(dir.join(COLLECTOR_STATUS), r#"{"schemaVersion":2}"#).unwrap();
        assert_eq!(Health::read(&dir).collector, None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_complete_cycle_is_not_a_problem() {
        let cycle = LastCycle {
            schema_version: 1,
            status: "complete".into(),
            dry_run: false,
            steps: vec![Step {
                action: "publish".into(),
                client: Some("codex".into()),
                status: "published".into(),
                error: None,
            }],
        };
        let health = Health {
            cycle: Some((cycle, at(100))),
            ..Health::default()
        };
        assert_eq!(health.sync_problem(at(200)), None);
        let mut resume = health.clone();
        resume.cycle.as_mut().unwrap().0.status = "resume_required".into();
        assert_eq!(
            resume.sync_problem(at(200)).map(|problem| problem.label),
            Some("Last publish didn't finish".to_owned())
        );
    }

    #[test]
    fn collector_states() {
        let now = at(10_000);
        let health = Health {
            collector: Some(status(9_800, true, None, &[])),
            ..Health::default()
        };
        assert_eq!(
            health.collector_state(now),
            Collector::Collecting { last: at(9_800) }
        );
        let failing = Health {
            collector: Some(status(9_800, false, Some("source_byte_limit"), &[])),
            ..Health::default()
        };
        assert!(
            matches!(failing.collector_state(now), Collector::Failing { ref code, .. } if code == "source_byte_limit")
        );
        let stale = Health {
            collector: Some(status(1_000, true, None, &[])),
            ..Health::default()
        };
        assert_eq!(
            stale.collector_state(now),
            Collector::Stopped { last: at(1_000) }
        );
        assert_eq!(Health::default().collector_state(now), Collector::NotSetUp);
    }

    #[test]
    fn explanations_are_plain_and_cover_the_observed_codes() {
        for code in [
            "ledger_source_history_changed",
            "ledger_measurement_conflict",
            "source_byte_limit",
            "source_changed_during_scan",
            "ledger_busy_retry",
            "attempt_recovery_required",
            "stats_sync_request_refused",
            "anything_else",
        ] {
            let text = explain(code);
            assert!(!text.contains('_'), "{text}");
            assert!(text.ends_with('.'));
        }
    }

    #[test]
    fn transient_failures_need_no_one() {
        assert!(!needs_person("ledger_source_history_changed"));
        assert!(!needs_person("ledger_busy_retry"));
        assert!(needs_person("custody_interaction_required"));
        assert!(needs_person("stats_sync_request_refused"));
        assert!(needs_person("something_new"));
    }

    #[test]
    fn ages_read_naturally() {
        let now = at(1_000_000);
        assert_eq!(ago(at(1_000_000 - 30), now), "just now");
        assert_eq!(ago(at(1_000_000 - 240), now), "4 min ago");
        assert_eq!(ago(at(1_000_000 - 3_700), now), "1 hour ago");
        assert_eq!(ago(at(1_000_000 - 3 * 3_600), now), "3 hours ago");
        assert_eq!(ago(at(1_000_000 - 90_000), now), "yesterday");
        assert_eq!(ago(at(1_000_000 - 3 * 86_400), now), "3 days ago");
    }
}
