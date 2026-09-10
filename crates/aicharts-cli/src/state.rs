//! Explicit local ledger commands. Source paths exist only during this invocation.

use std::path::PathBuf;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Command {
    Init,
    Collect,
    Status,
    Outbox,
}

struct Options {
    command: Command,
    directory: PathBuf,
    key: PathBuf,
    sources: Vec<(aicharts_protocol::Provider, PathBuf)>,
    json: bool,
    rescan: bool,
    limit: usize,
    after: Option<aicharts_protocol::Id>,
    revision: Option<u64>,
}

fn parse_options(args: &[String]) -> Result<Options, &'static str> {
    let command = match args.first().map(String::as_str) {
        Some("init") => Command::Init,
        Some("collect") => Command::Collect,
        Some("status") => Command::Status,
        Some("outbox") => Command::Outbox,
        _ => return Err("invalid_command"),
    };
    let mut directory = None;
    let mut key = None;
    let mut sources = vec![];
    let mut json = false;
    let mut rescan = false;
    let mut dry_run = false;
    let mut limit = None;
    let mut after = None;
    let mut revision = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--json" if matches!(command, Command::Collect | Command::Status) && !json => {
                json = true
            }
            "--rescan" if command == Command::Collect && !rescan => rescan = true,
            "--dry-run" if command == Command::Outbox && !dry_run => dry_run = true,
            flag @ ("--state-dir" | "--key-file" | "--codex" | "--claude" | "--limit"
            | "--after" | "--revision") => {
                i += 1;
                let value = args
                    .get(i)
                    .filter(|value| !value.is_empty())
                    .ok_or("missing_option_value")?;
                match flag {
                    "--state-dir" if directory.is_none() => directory = Some(PathBuf::from(value)),
                    "--key-file" if key.is_none() => key = Some(PathBuf::from(value)),
                    "--codex" if command == Command::Collect => {
                        sources.push((aicharts_protocol::Provider::Codex, PathBuf::from(value)))
                    }
                    "--claude" if command == Command::Collect => sources.push((
                        aicharts_protocol::Provider::ClaudeCode,
                        PathBuf::from(value),
                    )),
                    "--limit" if command == Command::Outbox && limit.is_none() => {
                        let parsed = value.parse::<usize>().map_err(|_| "invalid_page_limit")?;
                        if !(1..=256).contains(&parsed) {
                            return Err("invalid_page_limit");
                        }
                        limit = Some(parsed);
                    }
                    "--after" if command == Command::Outbox && after.is_none() => {
                        after = Some(parse_id(value)?)
                    }
                    "--revision" if command == Command::Outbox && revision.is_none() => {
                        revision = Some(value.parse::<u64>().map_err(|_| "invalid_revision")?)
                    }
                    _ => return Err("invalid_option"),
                }
            }
            _ => return Err("invalid_option"),
        }
        i += 1;
    }
    if command == Command::Outbox && !dry_run {
        return Err("outbox_send_not_enabled_use_dry_run");
    }
    if after.is_some() && revision.is_none() {
        return Err("pagination_revision_required");
    }
    if command == Command::Collect && sources.is_empty() {
        return Err("explicit_source_required");
    }
    if sources.len() > super::MAX_FILES {
        return Err("too_many_sources");
    }
    Ok(Options {
        command,
        directory: directory.ok_or("state_directory_required")?,
        key: key.ok_or("key_required")?,
        sources,
        json,
        rescan,
        limit: limit.unwrap_or(64),
        after,
        revision,
    })
}

fn parse_id(value: &str) -> Result<aicharts_protocol::Id, &'static str> {
    if value.len() != 32 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("invalid_occurrence_cursor");
    }
    let mut id = [0; 16];
    for (target, pair) in id.iter_mut().zip(value.as_bytes().chunks_exact(2)) {
        *target = u8::from_str_radix(
            std::str::from_utf8(pair).map_err(|_| "invalid_occurrence_cursor")?,
            16,
        )
        .map_err(|_| "invalid_occurrence_cursor")?;
    }
    if id == [0; 16] {
        return Err("invalid_occurrence_cursor");
    }
    Ok(id)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    let options = parse_options(args)?;
    #[cfg(unix)]
    {
        unix::run(options)
    }
    #[cfg(not(unix))]
    {
        let _ = options;
        Err("persistent_state_requires_qualified_unix_storage")
    }
}

#[cfg(unix)]
mod unix {
    use super::{hex, Command, Options};
    use aicharts_core::parse_reader;
    use aicharts_ledger::{Ledger, LedgerStatus, SourceScan, SourceStamp};
    use aicharts_protocol::Provider;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    use std::{
        collections::BTreeSet,
        fs,
        io::{BufReader, Read, Seek, SeekFrom},
        os::unix::{ffi::OsStrExt, fs::MetadataExt},
        path::Path,
    };

    fn source_id(key: &[u8; 32], path: &Path, provider: Provider) -> [u8; 32] {
        let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts every key length");
        mac.update(b"aicharts-local-source-v1\0");
        mac.update(&[match provider {
            Provider::Codex => 1,
            Provider::ClaudeCode => 2,
        }]);
        let bytes = path.as_os_str().as_bytes();
        mac.update(&(bytes.len() as u64).to_le_bytes());
        mac.update(bytes);
        mac.finalize().into_bytes().into()
    }

    fn stamp(metadata: &fs::Metadata) -> Result<SourceStamp, &'static str> {
        if !metadata.is_file() {
            return Err("source_not_regular");
        }
        Ok(SourceStamp {
            device: metadata.dev(),
            inode: metadata.ino(),
            bytes: metadata.len(),
            modified_seconds: metadata.mtime(),
            modified_nanos: u32::try_from(metadata.mtime_nsec())
                .map_err(|_| "source_metadata_failed")?,
            changed_seconds: metadata.ctime(),
            changed_nanos: u32::try_from(metadata.ctime_nsec())
                .map_err(|_| "source_metadata_failed")?,
        })
    }

    fn verify_path(
        path: &Path,
        canonical: &Path,
        expected: &SourceStamp,
    ) -> Result<(), &'static str> {
        if fs::canonicalize(path).map_err(|_| "source_changed_during_scan")? != canonical {
            return Err("source_changed_during_scan");
        }
        let observed =
            stamp(&fs::symlink_metadata(path).map_err(|_| "source_changed_during_scan")?)?;
        if &observed != expected {
            return Err("source_changed_during_scan");
        }
        Ok(())
    }

    fn collect(
        ledger: &mut Ledger,
        options: &Options,
        key: &[u8; 32],
    ) -> Result<(aicharts_ledger::ImportReport, u64, u64, u64), &'static str> {
        let snapshot = ledger.snapshot().map_err(|error| error.code())?;
        let mut visited = 0;
        let mut seen = BTreeSet::new();
        let mut total_files = 0u64;
        let mut skipped = 0u64;
        let mut bytes_scanned = 0u64;
        let mut lines_read = 0u64;
        let mut retained = 0usize;
        let mut scans = vec![];
        let mut verification = vec![];
        for (provider, path) in &options.sources {
            let mut files = vec![];
            crate::source_files(path, 0, &mut files, &mut visited)?;
            files.sort();
            for path in files {
                let canonical = fs::canonicalize(&path).map_err(|_| "source_metadata_failed")?;
                if !seen.insert((*provider, canonical.clone())) {
                    continue;
                }
                total_files += 1;
                if total_files > crate::MAX_FILES as u64 {
                    return Err("source_file_limit");
                }
                let source_id = source_id(key, &canonical, *provider);
                let mut file = crate::open_regular(&path).map_err(|_| "source_read_failed")?;
                let before = stamp(&file.metadata().map_err(|_| "source_metadata_failed")?)?;
                verify_path(&path, &canonical, &before)?;
                if !options.rescan && snapshot.checkpoints.get(&source_id) == Some(&before) {
                    skipped += 1;
                    verification.push((path, canonical, before));
                    continue;
                }
                bytes_scanned = bytes_scanned
                    .checked_add(before.bytes)
                    .ok_or("source_byte_limit")?;
                if bytes_scanned > crate::MAX_SOURCE_BYTES {
                    return Err("source_byte_limit");
                }
                // A physical snapshot ends at a newline. Accepting an unfinished
                // append can checkpoint an event before its final fields arrive.
                if before.bytes != 0 {
                    file.seek(SeekFrom::End(-1))
                        .map_err(|_| "source_read_failed")?;
                    let mut last = [0; 1];
                    file.read_exact(&mut last)
                        .map_err(|_| "source_read_failed")?;
                    if last[0] != b'\n' {
                        return Err("source_partial_tail");
                    }
                    file.seek(SeekFrom::Start(0))
                        .map_err(|_| "source_read_failed")?;
                }
                let collection = parse_reader(
                    BufReader::new((&mut file).take(before.bytes)),
                    *provider,
                    key,
                )
                .map_err(|_| "source_parse_failed")?;
                if stamp(&file.metadata().map_err(|_| "source_metadata_failed")?)? != before {
                    return Err("source_changed_during_scan");
                }
                verify_path(&path, &canonical, &before)?;
                lines_read = lines_read
                    .checked_add(collection.lines_read)
                    .ok_or("source_line_limit")?;
                let count: usize = collection
                    .batches
                    .iter()
                    .map(|batch| batch.usage.len())
                    .sum();
                retained = retained
                    .checked_add(count)
                    .ok_or("retained_measurement_limit")?;
                if retained > aicharts_core::MAX_MEASUREMENTS {
                    return Err("retained_measurement_limit");
                }
                scans.push(SourceScan {
                    source_id,
                    stamp: before,
                    collection,
                });
                verification.push((path, canonical, before));
            }
        }
        if total_files == 0 {
            return Err("no_source_files");
        }
        // Recheck every source after all parsing. Nothing durable changes until
        // the complete set is valid and the ledger's revision CAS succeeds.
        for (path, canonical, expected) in &verification {
            verify_path(path, canonical, expected)?;
        }
        let report = ledger
            .commit_scans(snapshot.revision, scans)
            .map_err(|error| error.code())?;
        Ok((report, skipped, lines_read, bytes_scanned))
    }

    fn status_json(status: &LedgerStatus) -> serde_json::Value {
        serde_json::json!({
            "schemaVersion":1,"localOnly":true,"uploaded":false,"ledgerRevision":status.revision,
            "sources":status.sources,"usageOccurrences":status.usage_occurrences,"pendingRecords":status.pending_records,
            "tokens":status.tokens.to_string(),"outputTokens":status.output_tokens.to_string(),
            "promptOccurrences":null,"measurementCoverage":"partial","activityCoverage":"unavailable",
            "humanOriginVerified":false,"modelPricingAvailable":false,
            "warnings":status.warnings.iter().map(|warning| warning.code()).collect::<Vec<_>>()
        })
    }

    fn json(value: &serde_json::Value) -> Result<String, &'static str> {
        serde_json::to_string_pretty(value).map_err(|_| "summary_encode_failed")
    }

    pub(super) fn run(options: Options) -> Result<String, &'static str> {
        // Authenticate the namespace before opening state or visiting sources.
        let key = crate::read_key(&options.key)?;
        if options.command == Command::Init {
            Ledger::initialize(&options.directory, &key).map_err(|error| error.code())?;
            return Ok(
                "Private local ledger initialized. No sources read; nothing uploaded.\n".to_owned(),
            );
        }
        let mut ledger = Ledger::open(&options.directory, &key).map_err(|error| error.code())?;
        match options.command {
            Command::Init => unreachable!(),
            Command::Collect => {
                let (report, skipped, lines_read, bytes_scanned) =
                    collect(&mut ledger, &options, &key)?;
                let status = ledger.status().map_err(|error| error.code())?;
                if options.json {
                    let mut output = status_json(&status);
                    output["committedRevision"] = report.revision.into();
                    output["sourcesUpdated"] = report.sources_updated.into();
                    output["occurrencesChanged"] = report.occurrences_changed.into();
                    output["sourcesSkipped"] = skipped.into();
                    output["linesRead"] = lines_read.into();
                    output["bytesScanned"] = bytes_scanned.into();
                    output["scanMode"] = "full_changed_source_snapshot".into();
                    json(&output)
                } else {
                    let warnings = status
                        .warnings
                        .iter()
                        .map(|warning| warning.code())
                        .collect::<Vec<_>>()
                        .join(", ");
                    Ok(format!("Import committed at revision {}; current ledger revision {}. Nothing uploaded.\nSources updated: {}; unchanged skipped: {skipped}\nPhysical lines read: {lines_read}; bytes scanned: {bytes_scanned}\nObserved tokens: {}; pending records: {}\nCoverage: partial; prompt counts, activity and model pricing unavailable.\nWarnings: {warnings}\n", report.revision,status.revision,report.sources_updated,status.tokens,status.pending_records))
                }
            }
            Command::Status => {
                let status = ledger.status().map_err(|error| error.code())?;
                if options.json {
                    json(&status_json(&status))
                } else {
                    let warnings = status
                        .warnings
                        .iter()
                        .map(|warning| warning.code())
                        .collect::<Vec<_>>()
                        .join(", ");
                    Ok(format!("AI Charts local ledger — revision {}\nSources: {}; usage occurrences: {}; pending records: {}\nObserved tokens: {}; output tokens: {}\nCoverage: partial; prompt counts, activity and model pricing unavailable.\nWarnings: {warnings}\nNothing uploaded.\n",status.revision,status.sources,status.usage_occurrences,status.pending_records,status.tokens,status.output_tokens))
                }
            }
            Command::Outbox => {
                let page = ledger
                    .pending(options.after, options.limit, options.revision)
                    .map_err(|error| error.code())?;
                let entries: Vec<_> = page.entries.iter().map(|entry| serde_json::json!({
                    "id":hex(&entry.id),"recordRevision":entry.revision,"bytes":entry.frame.len(),"hex":hex(&entry.frame)
                })).collect();
                json(
                    &serde_json::json!({"schemaVersion":1,"localOnly":true,"uploaded":false,"acknowledged":false,
                    "ledgerRevision":page.ledger_revision,"entries":entries,"nextAfter":page.next_after.map(|id|hex(&id)),
                    "measurementCoverage":"partial","modelPricingAvailable":false}),
                )
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(input: &[&str]) -> Vec<String> {
        input.iter().map(|value| value.to_string()).collect()
    }
    #[test]
    fn sending_and_unsafe_pagination_are_rejected_before_opening_files() {
        assert_eq!(
            run(&args(&["outbox"])),
            Err("outbox_send_not_enabled_use_dry_run")
        );
        assert_eq!(
            run(&args(&[
                "outbox",
                "--dry-run",
                "--after",
                "01010101010101010101010101010101"
            ])),
            Err("pagination_revision_required")
        );
        assert_eq!(
            run(&args(&["outbox", "--dry-run", "--limit", "257"])),
            Err("invalid_page_limit")
        );
        assert_eq!(run(&args(&["status", "--send"])), Err("invalid_option"));
    }
}
