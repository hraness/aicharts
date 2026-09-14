//! Explicit snapshot-only turn observations. No discovery, state, or upload.
use std::path::PathBuf;

const HELP: &str = "AI Charts observed turns — local, read-only\n\n  aicharts turns --codex FILE [--codex FILE ...] --occurrence-key-file KEY [--json]\n\nExplicit regular files only; no directories or automatic discovery.\nReports provider-reported runtime and partial response-token/requested-call subtotals.\nSubtotal means include only turns with evidence for that metric, not all turns.\nComplete token totals, dispatched tool calls, population means, human origin, account attribution, and pricing remain unknown.\nObserved root turns are not necessarily human prompts, complete history, or task success.\nNo data is uploaded and no local ledger is opened or changed.\n";

struct Options {
    sources: Vec<PathBuf>,
    key: PathBuf,
    json: bool,
}

fn options(args: &[String]) -> Result<Options, &'static str> {
    if args.first().map(String::as_str) != Some("turns") {
        return Err("invalid_command");
    }
    let mut sources = Vec::new();
    let mut key = None;
    let mut json = false;
    let mut arguments = args[1..].iter();
    while let Some(flag) = arguments.next() {
        match flag.as_str() {
            "--json" if !json => json = true,
            "--codex" | "--occurrence-key-file" => {
                if flag == "--occurrence-key-file" && key.is_some() {
                    return Err("invalid_option");
                }
                let value = arguments
                    .next()
                    .filter(|value| !value.is_empty() && !value.starts_with("--"))
                    .ok_or("missing_option_value")?;
                if flag == "--codex" {
                    if sources.len() == crate::MAX_FILES {
                        return Err("too_many_sources");
                    }
                    sources.push(PathBuf::from(value));
                } else {
                    key = Some(PathBuf::from(value));
                }
            }
            _ => return Err("invalid_option"),
        }
    }
    if sources.is_empty() {
        return Err("explicit_source_required");
    }
    Ok(Options {
        sources,
        key: key.ok_or("occurrence_key_required")?,
        json,
    })
}

pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    if args == ["turns", "--help"] || args == ["turns", "-h"] {
        return Ok(HELP.to_owned());
    }
    let options = options(args)?;
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        native::capture(options)?.finish()
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let Options { sources, key, json } = options;
        let _ = (sources, key, json);
        Err("turns_unsupported_platform")
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod native {
    use super::Options;
    use crate::state::unix::{stamp, verify_path};
    use aicharts_core::turns::{
        self, DailyTurnSummary, ObservedMetric, RuntimeCohort, TurnCollection, TurnReadLimits,
    };
    use aicharts_ledger::SourceStamp;
    use std::{
        fs::{self, File},
        io::{BufReader, Read},
        path::{Path, PathBuf},
    };

    struct Snapshot {
        file: File,
        original: PathBuf,
        canonical: PathBuf,
        stamp: SourceStamp,
    }
    impl Snapshot {
        fn open(path: &Path) -> Result<Self, &'static str> {
            let file = crate::open_regular(path)?;
            let stamp = stamp(&file.metadata().map_err(|_| "source_metadata_failed")?)?;
            let canonical = fs::canonicalize(path).map_err(|_| "source_metadata_failed")?;
            let snapshot = Self {
                file,
                original: path.to_owned(),
                canonical,
                stamp,
            };
            snapshot.verify()?;
            Ok(snapshot)
        }
        fn verify(&self) -> Result<(), &'static str> {
            let current = stamp(
                &self
                    .file
                    .metadata()
                    .map_err(|_| "source_changed_during_scan")?,
            )
            .map_err(|_| "source_changed_during_scan")?;
            if current != self.stamp {
                return Err("source_changed_during_scan");
            }
            verify_path(&self.original, &self.canonical, &self.stamp)
                .map_err(|_| "source_changed_during_scan")
        }
    }

    struct Key {
        snapshot: Snapshot,
        value: [u8; 32],
    }
    impl Key {
        fn open(path: &Path) -> Result<Self, &'static str> {
            let mut snapshot = Snapshot::open(path).map_err(|_| "key_read_failed")?;
            if snapshot.stamp.bytes != 32 {
                return Err("invalid_key_file");
            }
            // Preserve the established key format/permission check. Compare with
            // the retained descriptor so its separate path open cannot select a
            // different key unnoticed; do not change legacy read_key behavior.
            let value = crate::read_key(path)?;
            let mut retained = [0; 32];
            snapshot
                .file
                .read_exact(&mut retained)
                .map_err(|_| "key_read_failed")?;
            if retained != value {
                return Err("key_changed_during_scan");
            }
            snapshot.verify().map_err(|_| "key_changed_during_scan")?;
            Ok(Self { snapshot, value })
        }
        fn verify(&self) -> Result<(), &'static str> {
            self.snapshot
                .verify()
                .map_err(|_| "key_changed_during_scan")
        }
    }

    pub(super) struct Captured {
        key: Key,
        sources: Vec<Snapshot>,
        summary: DailyTurnSummary,
        json: bool,
    }

    pub(super) fn capture(options: Options) -> Result<Captured, &'static str> {
        // Validate arguments/platform and key before opening any source. Keep all
        // descriptors until final revalidation; no output can escape on failure.
        let key = Key::open(&options.key)?;
        let mut sources = Vec::with_capacity(options.sources.len());
        let mut total_bytes = 0u64;
        for path in options.sources {
            let source = Snapshot::open(&path)?;
            total_bytes = total_bytes
                .checked_add(source.stamp.bytes)
                .filter(|total| *total <= turns::MAX_SOURCE_BYTES)
                .ok_or("source_byte_limit")?;
            sources.push(source);
        }
        let mut merged: Option<TurnCollection> = None;
        let mut remaining = TurnReadLimits::full();
        for source in &mut sources {
            // Take sits below BufReader, preventing its prefetch from reading
            // bytes appended after the captured snapshot length.
            let reader = BufReader::new((&mut source.file).take(source.stamp.bytes));
            let next = turns::parse_codex_turns_with_limits(reader, &key.value, remaining)
                .map_err(|error| error.code())?;
            if next.daily_summary().bytes_scanned != source.stamp.bytes {
                return Err("source_changed_during_scan");
            }
            source.verify()?;
            let joined = match merged.take() {
                Some(old) => {
                    turns::merge_turn_collections(&[old, next]).map_err(|error| error.code())?
                }
                None => next,
            };
            let summary = joined.daily_summary();
            remaining = TurnReadLimits::new(
                turns::MAX_SOURCE_BYTES
                    .checked_sub(summary.bytes_scanned)
                    .ok_or("turn_invalid_limits")?,
                aicharts_core::MAX_LINES
                    .checked_sub(summary.lines_read)
                    .ok_or("turn_invalid_limits")?,
                turns::MAX_OBSERVATIONS
                    .checked_sub(summary.raw_observations)
                    .ok_or("turn_invalid_limits")?,
            )
            .map_err(|error| error.code())?;
            merged = Some(joined);
        }
        let summary = merged.ok_or("explicit_source_required")?.daily_summary();
        Ok(Captured {
            key,
            sources,
            summary,
            json: options.json,
        })
    }

    impl Captured {
        pub(super) fn finish(self) -> Result<String, &'static str> {
            self.key.verify()?;
            for source in &self.sources {
                source.verify()?;
            }
            render(&self.summary, self.json)
        }
    }

    fn observed_metric_json(metric: &ObservedMetric, basis: &'static str) -> serde_json::Value {
        let mean = (metric.turns_with_evidence != 0).then(|| {
            serde_json::json!({
                "numerator":metric.sum.to_string(),"denominator":metric.turns_with_evidence
            })
        });
        serde_json::json!({
            "basis":basis,"sum":metric.sum.to_string(),
            "turnsWithEvidence":metric.turns_with_evidence,"observations":metric.observations,
            "subtotalMean":mean,"coverage":"partial","populationMean":null
        })
    }

    fn cohort_json(cohort: &RuntimeCohort) -> serde_json::Value {
        let runtime_average = (cohort.runtime_eligible_turns != 0).then(|| {
            serde_json::json!({
                "numerator":cohort.runtime_ms_sum.to_string(),
                "denominator":cohort.runtime_eligible_turns,
                "basis":"provider_reported_runtime_ms",
                "coverage":"partial"
            })
        });
        serde_json::json!({ "observedTurns":cohort.observed_turns,
            "runtimeEligibleTurns":cohort.runtime_eligible_turns,
            "runtimeMsSum":cohort.runtime_ms_sum.to_string(),
            "averageTurnLength":{
                "runtimeMs":runtime_average,
                "tokens":null,
                "toolCalls":null,
                "observedSubtotals":{
                    "responseTokens":observed_metric_json(&cohort.observed_subtotals.response_tokens,"observed_response_total"),
                    "requestedCalls":observed_metric_json(&cohort.observed_subtotals.requested_calls,"observed_requested_calls")
                },
                "coverage":"partial"
            },
            "observedSubtotals":{
                "responseTokens":observed_metric_json(&cohort.observed_subtotals.response_tokens,"observed_response_total"),
                "requestedCalls":observed_metric_json(&cohort.observed_subtotals.requested_calls,"observed_requested_calls")
            } })
    }

    fn observed_metric_text(metric: &ObservedMetric, label: &str) -> String {
        let mean = if metric.turns_with_evidence == 0 {
            "unavailable (0 turns with evidence)".to_owned()
        } else {
            format!("{}/{}", metric.sum, metric.turns_with_evidence)
        };
        format!(
            "{label}: {} observed subtotal; {} observations across {} turns with evidence; subtotal mean {mean} (partial, not population mean).",
            metric.sum, metric.observations, metric.turns_with_evidence
        )
    }

    fn render(summary: &DailyTurnSummary, json: bool) -> Result<String, &'static str> {
        let diagnostics: Vec<_> = summary
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.code())
            .collect();
        if json {
            let days:Vec<_> = summary.days.iter().map(|day|serde_json::json!({
                "utcDay":day.utc_day,"completed":cohort_json(&day.completed),"aborted":cohort_json(&day.aborted)
            })).collect();
            serde_json::to_string_pretty(&serde_json::json!({
                "schemaVersion":1,"operation":"turns","access":"read_only","localOnly":true,
                "uploaded":false,"provider":"codex","sourceProfile":turns::PROFILE_VERSION,
                "scope":"root_direct","coverage":"partial","enumerationComplete":false,
                "origin":"unknown","account":"unknown","runtimeBasis":"provider_reported",
                "terminalTimePrecisionMs":1000,"sourcesRead":summary.sources_read,
                "linesRead":summary.lines_read,"bytesScanned":summary.bytes_scanned,
                "rawObservations":summary.raw_observations,"partialSources":summary.partial_sources,
                "unclassifiedTerminalTurns":summary.unclassified_terminal_turns,
                "undatedRootTurns":summary.undated_root_turns,"excludedThreads":summary.excluded_threads,
                "days":days,"tokens":null,"toolCalls":null,"diagnostics":diagnostics,
                "unavailable":["tokens","tool_calls","pricing"]
            })).map_err(|_| "summary_encode_failed")
        } else {
            let mut text = format!("AI Charts observed turns — local, read-only\nCoverage: partial; provider-reported runtime and observed subtotals, not complete history or task success.\nSources: {}; lines: {}; partial tails: {}\n",
                summary.sources_read,summary.lines_read,summary.partial_sources);
            for day in &summary.days {
                for (label, cohort) in [("completed", &day.completed), ("aborted", &day.aborted)] {
                    let average = if cohort.runtime_eligible_turns == 0 {
                        "unavailable (0 eligible turns)".to_owned()
                    } else {
                        format!(
                            "{}/{} ms",
                            cohort.runtime_ms_sum, cohort.runtime_eligible_turns
                        )
                    };
                    text.push_str(&format!("UTC day {} {label}: {} observed turns; {} runtime-eligible; observed average {average}.\n",
                        day.utc_day,cohort.observed_turns,cohort.runtime_eligible_turns));
                    text.push_str("Average turn length: runtime uses provider-reported milliseconds; complete tokens and dispatched tool calls are unavailable; observed response-token/requested-call subtotals are partial.\n");
                    for (label, metric) in [
                        (
                            "Response tokens",
                            &cohort.observed_subtotals.response_tokens,
                        ),
                        (
                            "Requested calls",
                            &cohort.observed_subtotals.requested_calls,
                        ),
                    ] {
                        text.push_str(&observed_metric_text(metric, label));
                        text.push('\n');
                    }
                }
            }
            text.push_str(&format!("Complete token totals, dispatched tool calls, population means, human origin, account attribution, and pricing: unknown.\nObserved root turns are not necessarily human prompts.\nDiagnostics: {}\nNothing uploaded; no ledger opened or changed.\n",diagnostics.join(", ")));
            Ok(text)
        }
    }

    #[cfg(test)]
    mod tests;
}
