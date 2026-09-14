//! Prepare a new account namespace by rereading native identities, never rehashing
//! opaque legacy IDs. The old ledger is an owned read-only snapshot, not a writer.

use aicharts_protocol::Provider;
use std::path::PathBuf;

struct Options {
    prepare: bool,
    directory: PathBuf,
    key: PathBuf,
    shadow: Option<PathBuf>,
    occurrence_key: Option<PathBuf>,
    sources: Vec<(Provider, PathBuf)>,
    json: bool,
}

fn parse_options(args: &[String]) -> Result<Options, &'static str> {
    let prepare = match args.first().map(String::as_str) {
        Some("reindex-plan") => false,
        Some("reindex-prepare") => true,
        _ => return Err("invalid_command"),
    };
    let (mut directory, mut key, mut shadow, mut occurrence_key) = (None, None, None, None);
    let (mut sources, mut json, mut dry_run) = (vec![], false, false);
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--dry-run" if !prepare && !dry_run => dry_run = true,
            "--json" if !json => json = true,
            flag @ ("--state-dir"
            | "--key-file"
            | "--shadow-dir"
            | "--occurrence-key-file"
            | "--codex"
            | "--claude") => {
                i += 1;
                let value = args
                    .get(i)
                    .filter(|value| !value.is_empty())
                    .ok_or("missing_option_value")?;
                let path = PathBuf::from(value);
                match flag {
                    "--state-dir" if directory.is_none() => directory = Some(path),
                    "--key-file" if key.is_none() => key = Some(path),
                    "--shadow-dir" if prepare && shadow.is_none() => shadow = Some(path),
                    "--occurrence-key-file" if prepare && occurrence_key.is_none() => {
                        occurrence_key = Some(path)
                    }
                    "--codex" => sources.push((Provider::Codex, path)),
                    "--claude" => sources.push((Provider::ClaudeCode, path)),
                    _ => return Err("invalid_option"),
                }
            }
            _ => return Err("invalid_option"),
        }
        i += 1;
    }
    if !prepare && !dry_run {
        return Err("reindex_plan_requires_dry_run");
    }
    if sources.is_empty() {
        return Err("explicit_source_required");
    }
    if sources.len() > crate::MAX_FILES {
        return Err("too_many_sources");
    }
    if prepare && (shadow.is_none() || occurrence_key.is_none()) {
        return Err("reindex_target_and_occurrence_key_required");
    }
    Ok(Options {
        prepare,
        directory: directory.ok_or("state_directory_required")?,
        key: key.ok_or("key_required")?,
        shadow,
        occurrence_key,
        sources,
        json,
    })
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
    use super::Options;
    use crate::state::unix::{source_id, stamp, verify_path};
    use aicharts_core::{merge_collections, parse_reader};
    use aicharts_ledger::{Ledger, LedgerIdentity, ReadOnlyLedger, SourceScan, SourceStamp};
    use aicharts_protocol::{encode, Batch, Id, Policy, Registry};
    use std::{
        collections::{BTreeMap, BTreeSet},
        fs,
        io::{BufReader, Read, Seek, SeekFrom},
        path::{Path, PathBuf},
    };

    struct Scan {
        sources: Vec<SourceScan>,
        verification: Vec<(PathBuf, PathBuf, SourceStamp)>,
        lines: u64,
        bytes: u64,
    }
    impl Scan {
        fn verify(&self) -> Result<(), &'static str> {
            for (path, canonical, expected) in &self.verification {
                verify_path(path, canonical, expected)?;
            }
            Ok(())
        }
    }

    // This intentionally shares the collector's strict stable-snapshot contract.
    // Live complete-prefix collection must not weaken this reindex coverage gate.
    fn scan(
        options: &Options,
        checkpoint: &[u8; 32],
        occurrence: &[u8; 32],
    ) -> Result<Scan, &'static str> {
        let mut result = Scan {
            sources: vec![],
            verification: vec![],
            lines: 0,
            bytes: 0,
        };
        let (mut visited, mut retained) = (0, 0usize);
        let mut seen = BTreeSet::new();
        for (provider, root) in &options.sources {
            let mut files = vec![];
            crate::source_files(root, 0, &mut files, &mut visited)?;
            files.sort();
            for path in files {
                let canonical = fs::canonicalize(&path).map_err(|_| "source_metadata_failed")?;
                if !seen.insert((*provider, canonical.clone())) {
                    continue;
                }
                if seen.len() > crate::MAX_FILES {
                    return Err("source_file_limit");
                }
                let mut file = crate::open_regular(&path).map_err(|_| "source_read_failed")?;
                let before = stamp(&file.metadata().map_err(|_| "source_metadata_failed")?)?;
                verify_path(&path, &canonical, &before)?;
                result.bytes = result
                    .bytes
                    .checked_add(before.bytes)
                    .ok_or("source_byte_limit")?;
                if result.bytes > crate::MAX_SOURCE_BYTES {
                    return Err("source_byte_limit");
                }
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
                    occurrence,
                )
                .map_err(|_| "source_parse_failed")?;
                if stamp(&file.metadata().map_err(|_| "source_metadata_failed")?)? != before {
                    return Err("source_changed_during_scan");
                }
                verify_path(&path, &canonical, &before)?;
                result.lines = result
                    .lines
                    .checked_add(collection.lines_read)
                    .ok_or("source_line_limit")?;
                retained = retained
                    .checked_add(
                        collection
                            .batches
                            .iter()
                            .map(|batch| batch.usage.len())
                            .sum::<usize>(),
                    )
                    .ok_or("retained_measurement_limit")?;
                if retained > aicharts_core::MAX_MEASUREMENTS {
                    return Err("retained_measurement_limit");
                }
                result.sources.push(SourceScan {
                    source_id: source_id(checkpoint, &canonical, *provider),
                    stamp: before,
                    collection,
                });
                result.verification.push((path, canonical, before));
            }
        }
        if result.sources.is_empty() {
            return Err("no_source_files");
        }
        result.verify()?;
        Ok(result)
    }

    fn inventory(scans: Vec<SourceScan>) -> Result<BTreeMap<Id, Vec<u8>>, &'static str> {
        let collection = merge_collections(scans.into_iter().map(|scan| scan.collection).collect())
            .map_err(|_| "reindex_source_conflict")?;
        let registry = Registry {
            revision: 1,
            models: vec![],
        };
        let policy = Policy {
            first_day: 0,
            last_day: u32::MAX,
            registry: &registry,
        };
        let mut result = BTreeMap::new();
        for batch in collection.batches {
            for usage in batch.usage {
                let id = usage.id;
                let frame = encode(
                    &Batch {
                        utc_day: batch.utc_day,
                        registry_revision: 1,
                        usage: vec![usage],
                        prompts: vec![],
                        intervals: vec![],
                    },
                    &policy,
                )
                .map_err(|_| "frame_validation_failed")?;
                if result.insert(id, frame).is_some() {
                    return Err("reindex_source_conflict");
                }
            }
        }
        Ok(result)
    }

    fn target(options: &Options) -> Result<PathBuf, &'static str> {
        let path = options
            .shadow
            .as_ref()
            .ok_or("reindex_target_and_occurrence_key_required")?;
        let legacy = fs::canonicalize(&options.directory).map_err(|_| "reindex_target_invalid")?;
        if fs::canonicalize(path).is_ok_and(|resolved| resolved.starts_with(&legacy)) {
            return Err("reindex_target_invalid");
        }
        match fs::symlink_metadata(path) {
            Ok(_) => return Err("reindex_target_exists"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err("reindex_target_invalid"),
        }
        let name = path.file_name().ok_or("reindex_target_invalid")?;
        let parent = path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        let resolved = fs::canonicalize(parent)
            .map_err(|_| "reindex_target_invalid")?
            .join(name);
        if resolved.starts_with(legacy) {
            return Err("reindex_target_invalid");
        }
        Ok(resolved)
    }

    pub(super) fn run(options: Options) -> Result<String, &'static str> {
        let checkpoint = crate::read_key(&options.key)?;
        let legacy = ReadOnlyLedger::open(&options.directory, &LedgerIdentity::Legacy(&checkpoint))
            .map_err(|error| error.code())?;
        let shadow = if options.prepare {
            Some(target(&options)?)
        } else {
            None
        };
        let occurrence = options
            .occurrence_key
            .as_ref()
            .map(|path| crate::read_key(path))
            .transpose()?;
        let mut legacy_scan = scan(&options, &checkpoint, &checkpoint)?;
        let observed = inventory(std::mem::take(&mut legacy_scan.sources))?;
        let (mut matched, mut missing, mut conflicting) = (0usize, 0usize, 0usize);
        for entry in legacy.inventory() {
            match observed.get(&entry.id) {
                Some(frame) if frame == &entry.frame => matched += 1,
                Some(_) => conflicting += 1,
                None => missing += 1,
            }
        }
        let new = observed.len() - matched - conflicting;
        let ready = missing == 0 && conflicting == 0;
        let mut shadow_revision = None;
        let mut lines = legacy_scan.lines;
        let mut bytes = legacy_scan.bytes;
        if options.prepare {
            if conflicting != 0 {
                return Err("reindex_conflicting_history");
            }
            if missing != 0 {
                return Err("reindex_missing_history");
            }
            let occurrence = occurrence
                .as_ref()
                .ok_or("reindex_target_and_occurrence_key_required")?;
            let mut account_scan = scan(&options, &checkpoint, occurrence)?;
            // Both independent parses must have visited exactly the same physical
            // sources. Native identity derivation is the only intended difference.
            if legacy_scan.verification != account_scan.verification {
                return Err("source_changed_during_scan");
            }
            legacy_scan.verify()?;
            legacy.ensure_unchanged().map_err(|error| error.code())?;
            lines = lines
                .checked_add(account_scan.lines)
                .ok_or("source_line_limit")?;
            bytes = bytes
                .checked_add(account_scan.bytes)
                .ok_or("source_byte_limit")?;
            let identity = LedgerIdentity::SplitKeys {
                checkpoint: &checkpoint,
                occurrence,
                namespace_version: 1,
            };
            let mut ledger = Ledger::initialize_with_identity(
                shadow.as_ref().ok_or("reindex_target_invalid")?,
                &identity,
            )
            .map_err(|error| error.code())?;
            let imported = ledger
                .commit_scans(0, std::mem::take(&mut account_scan.sources))
                .map_err(|error| error.code())?;
            shadow_revision = Some(imported.revision);
            // No automatic cleanup or promotion on a late race. The new directory
            // is recoverable evidence, and a retry requires another explicit name.
            account_scan.verify()?;
        }
        legacy_scan.verify()?;
        legacy.ensure_unchanged().map_err(|error| error.code())?;
        if options.json {
            serde_json::to_string_pretty(&serde_json::json!({
                "schemaVersion":1,"operation":if options.prepare {"reindex-prepare"} else {"reindex-plan"},
                "localOnly":true,"uploaded":false,"acknowledged":false,"promoted":false,
                "legacyRevision":legacy.snapshot().revision,"pendingRecords":legacy.status().pending_records,
                "matchedOccurrences":matched,"missingOccurrences":missing,"conflictingOccurrences":conflicting,"newOccurrences":new,
                "readyToPrepare":ready,"prepared":options.prepare,"shadowRevision":shadow_revision,"namespaceVersion":1,
                "sourcesRead":legacy_scan.verification.len(),"linesRead":lines,"bytesScanned":bytes,"measurementCoverage":"partial"
            })).map_err(|_| "summary_encode_failed")
        } else {
            Ok(format!("AI Charts namespace reindex — local only\nLegacy revision: {}; pending records retained: {}\nExact matches: {matched}; missing: {missing}; conflicting: {conflicting}; new: {new}\n{}\nOld state and key retained. Nothing promoted, acknowledged or uploaded.\n",
                legacy.snapshot().revision, legacy.status().pending_records,
                if options.prepare { "New account-bound shadow prepared; active state is unchanged." }
                else if ready { "Explicit sources cover the legacy measurements; shadow preparation is available." }
                else { "Do not prepare: recover missing sources or collect the current source revisions into the old ledger first." }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }
    #[test]
    fn command_surface_is_closed_before_opening_files() {
        assert!(matches!(
            parse_options(&args(&["reindex-plan"])),
            Err("reindex_plan_requires_dry_run")
        ));
        for input in [
            vec!["reindex-plan", "--dry-run", "--promote"],
            vec!["reindex-prepare", "--dry-run"],
            vec!["reindex-plan", "--dry-run", "--shadow-dir", "new"],
        ] {
            assert!(matches!(
                parse_options(&args(&input)),
                Err("invalid_option")
            ));
        }
    }
}
