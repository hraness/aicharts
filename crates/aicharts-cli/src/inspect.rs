//! Explicit source-free inspection, without opening the ledger's writer path.
use std::path::PathBuf;

struct Options {
    directory: PathBuf,
    key: PathBuf,
    occurrence_key: Option<PathBuf>,
    json: bool,
}

fn options(args: &[String]) -> Result<Options, &'static str> {
    if args.first().map(String::as_str) != Some("inspect") {
        return Err("invalid_command");
    }
    let (mut directory, mut key, mut occurrence_key) = (None, None, None);
    let mut json = false;
    let mut args = args[1..].iter();
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--json" if !json => json = true,
            "--state-dir" | "--key-file" | "--occurrence-key-file" => {
                let slot = match flag.as_str() {
                    "--state-dir" => &mut directory,
                    "--key-file" => &mut key,
                    _ => &mut occurrence_key,
                };
                if slot.is_some() {
                    return Err("invalid_option");
                }
                let value = args
                    .next()
                    .filter(|value| !value.is_empty() && !value.starts_with("--"))
                    .ok_or("missing_option_value")?;
                *slot = Some(PathBuf::from(value));
            }
            _ => return Err("invalid_option"),
        }
    }
    Ok(Options {
        directory: directory.ok_or("state_directory_required")?,
        key: key.ok_or("key_required")?,
        occurrence_key,
        json,
    })
}

pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    let options = options(args)?;
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use aicharts_ledger::{LedgerIdentity, ReadOnlyLedger};
        let checkpoint = crate::read_key(&options.key)?;
        let occurrence = options
            .occurrence_key
            .as_ref()
            .map(|path| crate::read_key(path))
            .transpose()?;
        let identity = match &occurrence {
            Some(occurrence) => LedgerIdentity::SplitKeys {
                checkpoint: &checkpoint,
                occurrence,
                namespace_version: 1,
            },
            None => LedgerIdentity::Legacy(&checkpoint),
        };
        let ledger =
            ReadOnlyLedger::open(&options.directory, &identity).map_err(|error| error.code())?;
        // No source, path, opaque identity, prefix witness or frame is projected.
        let status = ledger.status();
        let warnings: Vec<_> = status
            .warnings
            .iter()
            .map(|warning| warning.code())
            .collect();
        ledger.ensure_unchanged().map_err(|error| error.code())?;
        if options.json {
            serde_json::to_string_pretty(&serde_json::json!({
                "schemaVersion": 1, "operation": "inspect", "access": "read_only", "coverage": "partial",
                "revision": status.revision.to_string(), "sources": status.sources,
                "usageOccurrences": status.usage_occurrences, "pendingRecords": status.pending_records,
                "tokens": status.tokens.to_string(), "outputTokens": status.output_tokens.to_string(),
                "warnings": warnings, "unavailable": ["prompts", "activity", "pricing"]
            })).map_err(|_| "summary_encode_failed")
        } else {
            Ok(format!("AI Charts local ledger — read-only inspection\nRevision: {}\nSources: {}; usage occurrences: {}; pending records: {}\nObserved tokens: {}; output tokens: {}\nCoverage: partial; prompt counts, activity and pricing unavailable.\nWarnings: {}\nNo sources scanned; nothing uploaded.\n",
                status.revision, status.sources, status.usage_occurrences, status.pending_records,
                status.tokens, status.output_tokens, warnings.join(", ")))
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = options;
        Err(aicharts_ledger::Error::UnsupportedPlatform.code())
    }
}
