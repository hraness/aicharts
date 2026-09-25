//! One-shot scheduled publishing. No service installation or state preparation.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use aicharts_protocol::Provider;
use std::io::Write;
use std::path::PathBuf;

const HELP: &str = "AI Charts sync: one supervised publishing pass

  aicharts sync --complete-prefix --state-dir DIR --key-file KEY
    [--codex FILE_OR_DIR ...] [--claude FILE_OR_DIR ...] [--devin FILE_OR_DIR ...]
    [--max-batches 1..64] [--reconcile-retained] [--json]

Requires macOS, a completed custody-verified enrollment, and an existing ledger
with both completed-prefix collection and sender custody already enabled for
that exact account, device and namespace. Explicit source paths are required.
Prepare and verify enrollment, init, prefix-enable and sender binding separately;
the existing upload command prepares sender binding on its first enrolled use.
sync never initializes, migrates, rekeys, resets or installs an OS service.

Checks state before source traversal. A retained uncertain batch refuses unless
--reconcile-retained explicitly permits one recovery of its exact bytes before
collection. New uncertainty stops this pass and retains the flight for a later
explicit recovery. Collection failure sends no new batch; previously committed
local collection waves remain durable. Stable unfinished source tails are deferred.

After collection, sends at most eight batches by default, each at most 256
records. --max-batches bounds the entire pass, including retained-flight recovery.
Each batch can replay an explicit 503 at most twice. Native I/O timeouts do not
provide a hard wall-clock deadline. No automatic account or credential recovery.

Exit 0: pending queue drained and sender healthy at the final observation.
Exit 3: bounded pass completed with pending records; schedule another pass.
Exit 2: refusal, rejection or failure; examine the fixed error code.
--json emits one structured result even on failure, without paths or secrets.
Complete here describes the pending queue, not complete provider coverage.
";

#[derive(Debug)]
pub(crate) struct Options {
    pub directory: PathBuf,
    pub key: PathBuf,
    pub sources: Vec<(Provider, PathBuf)>,
    pub max_batches: u8,
    pub reconcile_retained: bool,
    pub json: bool,
}

fn parse_options(args: &[String]) -> Result<Options, &'static str> {
    let mut directory = None;
    let mut key = None;
    let mut sources = Vec::new();
    let mut prefix = false;
    let mut reconcile_retained = false;
    let mut json = false;
    let mut batches = None;
    let mut args = args.iter().skip(1);
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--complete-prefix" if !prefix => prefix = true,
            "--reconcile-retained" if !reconcile_retained => reconcile_retained = true,
            "--json" if !json => json = true,
            "--state-dir" | "--key-file" | "--codex" | "--claude" | "--devin" | "--max-batches" => {
                let value = args
                    .next()
                    .filter(|value| !value.is_empty() && !value.starts_with("--"))
                    .ok_or("missing_option_value")?;
                match flag.as_str() {
                    "--state-dir" if directory.is_none() => directory = Some(PathBuf::from(value)),
                    "--key-file" if key.is_none() => key = Some(PathBuf::from(value)),
                    "--max-batches" if batches.is_none() => {
                        let count = value.parse::<u8>().map_err(|_| "invalid_batch_limit")?;
                        if !(1..=64).contains(&count) {
                            return Err("invalid_batch_limit");
                        }
                        batches = Some(count);
                    }
                    "--codex" | "--claude" | "--devin" => {
                        if sources.len() >= crate::MAX_FILES {
                            return Err("too_many_sources");
                        }
                        sources.push((
                            match flag.as_str() {
                                "--codex" => Provider::Codex,
                                "--claude" => Provider::ClaudeCode,
                                _ => Provider::Devin,
                            },
                            PathBuf::from(value),
                        ));
                    }
                    _ => return Err("invalid_option"),
                }
            }
            _ => return Err("invalid_option"),
        }
    }
    if !prefix {
        return Err("sync_complete_prefix_required");
    }
    if sources.is_empty() {
        return Err("explicit_source_required");
    }
    Ok(Options {
        directory: directory.ok_or("state_directory_required")?,
        key: key.ok_or("key_required")?,
        sources,
        max_batches: batches.unwrap_or(8),
        reconcile_retained,
        json,
    })
}

#[derive(Debug)]
pub(crate) struct Report {
    pub phase: &'static str,
    pub status: &'static str,
    pub error: Option<&'static str>,
    pub collection: Option<crate::state::CollectionReport>,
    pub batches_attempted: u8,
    pub batches_settled: u8,
    pub acknowledged_records: u64,
    pub retained_newer: u64,
    pub conflicted_records: u64,
    pub aborted_records: u64,
    pub pending_records: Option<u64>,
    pub inflight_operations: Option<u16>,
    pub reconciliation_required: Option<u64>,
    pub device_revoked: Option<bool>,
}

impl Default for Report {
    fn default() -> Self {
        Self {
            phase: "preflight",
            status: "failed",
            error: None,
            collection: None,
            batches_attempted: 0,
            batches_settled: 0,
            acknowledged_records: 0,
            retained_newer: 0,
            conflicted_records: 0,
            aborted_records: 0,
            pending_records: None,
            inflight_operations: None,
            reconciliation_required: None,
            device_revoked: None,
        }
    }
}

impl Report {
    pub(crate) fn fail(&mut self, code: &'static str) {
        self.error = Some(code);
        self.status = if code == "upload_recovery_required" {
            "recovery_required"
        } else if matches!(
            code,
            "upload_reconciliation_required" | "upload_device_revoked"
        ) {
            "rejected"
        } else {
            "failed"
        };
    }

    pub(crate) fn exit_code(&self) -> i32 {
        match self.status {
            "complete" => 0,
            "pending" => 3,
            _ => 2,
        }
    }

    fn output(&self, json: bool) -> String {
        if json {
            let collection = self.collection.as_ref().map(|c| {
                serde_json::json!({
                    "revision":c.revision.to_string(), "sourcesUpdated":c.sources_updated,
                    "occurrencesChanged":c.occurrences_changed,"sourcesSkipped":c.sources_skipped,
                    "sourcesWithDeferredTail":c.deferred_tails,"sourcesConflicted":c.sources_conflicted,"linesRead":c.lines_read,
                    "bytesScanned":c.bytes_scanned,
                })
            });
            format!(
                "{}\n",
                serde_json::json!({
                    "schemaVersion":1,"operation":"sync","status":self.status,"phase":self.phase,
                    "error":self.error,"collection":collection,"batchesAttempted":self.batches_attempted,
                    "batchesSettled":self.batches_settled,"acknowledgedRecords":self.acknowledged_records,
                    "retainedNewer":self.retained_newer,"conflictedRecords":self.conflicted_records,
                    "abortedRecords":self.aborted_records,"pendingRecords":self.pending_records,
                    "inflightOperations":self.inflight_operations,
                    "reconciliationRequired":self.reconciliation_required,"deviceRevoked":self.device_revoked,
                    "measurementCoverage":"partial"
                })
            )
        } else {
            format!(
                "AI Charts sync: {}\nPhase: {}\nBatches settled: {}\nRecords acknowledged: {}\nPending records: {}\n{}",
                self.status, self.phase, self.batches_settled, self.acknowledged_records,
                self.pending_records.map_or_else(|| "unknown".to_owned(), |n| n.to_string()),
                self.error.map_or_else(String::new, |code| format!("Error: {code}\n")),
            )
        }
    }
}

fn response(args: &[String]) -> (String, i32, Option<&'static str>) {
    if args == ["sync", "--help"] || args == ["sync", "-h"] {
        return (HELP.to_owned(), 0, None);
    }
    let mut report = Report::default();
    let json = match parse_options(args) {
        Ok(options) => {
            #[cfg(target_os = "macos")]
            if let Err(code) = crate::upload::sync_existing(&options, &mut report) {
                report.fail(code);
            }
            #[cfg(not(target_os = "macos"))]
            report.fail("sync_requires_qualified_macos_custody");
            options.json
        }
        Err(code) => {
            report.fail(code);
            args.iter().any(|arg| arg == "--json")
        }
    };
    (report.output(json), report.exit_code(), report.error)
}

pub(super) fn execute(args: &[String]) -> i32 {
    let (output, code, error) = response(args);
    let stdout = std::io::stdout();
    let mut writer = stdout.lock();
    if writer
        .write_all(output.as_bytes())
        .and_then(|()| writer.flush())
        .is_err()
    {
        return 1;
    }
    if let Some(error) = error {
        eprintln!("aicharts: {error}");
    }
    code
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(extra: &[&str]) -> Vec<String> {
        [
            "sync",
            "--complete-prefix",
            "--state-dir",
            "PRIVATE_STATE",
            "--key-file",
            "PRIVATE_KEY",
            "--codex",
            "PRIVATE_SOURCE",
        ]
        .into_iter()
        .chain(extra.iter().copied())
        .map(str::to_owned)
        .collect()
    }
    #[test]
    fn options_are_explicit_bounded_and_order_independent() {
        let options = parse_options(&args(&[
            "--json",
            "--max-batches",
            "1",
            "--reconcile-retained",
        ]))
        .unwrap();
        assert_eq!(options.max_batches, 1);
        assert!(options.reconcile_retained && options.json);
        assert_eq!(parse_options(&args(&[])).unwrap().max_batches, 8);
        for limit in ["0", "65", "256", "-1", "PRIVATE"] {
            assert_eq!(
                parse_options(&args(&["--max-batches", limit])).unwrap_err(),
                "invalid_batch_limit"
            );
        }
        for extra in [
            &["--json", "--json"][..],
            &["--reconcile-retained", "--reconcile-retained"],
            &["--rescan"],
        ] {
            assert_eq!(parse_options(&args(extra)).unwrap_err(), "invalid_option");
        }
        assert_eq!(
            parse_options(&["sync".to_owned()]).unwrap_err(),
            "sync_complete_prefix_required"
        );
        assert_eq!(
            parse_options(&args(&["--max-batches", "--json"])).unwrap_err(),
            "missing_option_value"
        );
    }
    #[test]
    fn failure_json_and_help_never_access_or_echo_source_arguments() {
        let (output, exit, code) = response(&args(&["--json", "--unknown"]));
        let parsed: serde_json::Value = serde_json::from_str(&output).unwrap();
        assert_eq!(exit, 2);
        assert_eq!(code, Some("invalid_option"));
        assert_eq!(parsed["error"], "invalid_option");
        assert_eq!(parsed["collection"], serde_json::Value::Null);
        assert!(!output.contains("PRIVATE"));
        assert_eq!(response(&["sync".to_owned(), "--help".to_owned()]).1, 0);
    }
}
