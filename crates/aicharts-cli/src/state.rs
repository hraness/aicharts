//! Explicit local ledger commands. Source paths exist only during this invocation.

use std::path::PathBuf;

#[derive(Debug, Default)]
pub(crate) struct CollectionReport {
    pub revision: u64,
    pub sources_updated: u64,
    pub occurrences_changed: u64,
    pub sources_skipped: u64,
    pub deferred_tails: u64,
    pub sources_conflicted: u64,
    pub lines_read: u64,
    pub bytes_scanned: u64,
}

/// Collect into an already opened ledger without initializing or migrating it.
/// This shares the complete-prefix collector and its per-wave durability rules.
#[cfg(all(unix, any(target_os = "macos", test)))]
pub(crate) fn collect_existing_prefix(
    ledger: &mut aicharts_ledger::Ledger,
    directory: &std::path::Path,
    key_file: &std::path::Path,
    sources: &[(aicharts_protocol::Provider, PathBuf)],
    checkpoint: &[u8; 32],
    occurrence: &[u8; 32],
) -> Result<CollectionReport, &'static str> {
    let options = Options {
        command: Command::CollectPrefix,
        directory: directory.to_owned(),
        key: key_file.to_owned(),
        sources: sources.to_vec(),
        json: false,
        rescan: false,
        limit: 0,
        after: None,
        revision: None,
        backup: None,
        occurrence_key: None,
    };
    let outcome = unix::collect(ledger, &options, checkpoint, occurrence)?;
    Ok(CollectionReport {
        revision: outcome.report.revision,
        sources_updated: outcome.report.sources_updated,
        occurrences_changed: outcome.report.occurrences_changed,
        sources_skipped: outcome.sources_skipped,
        deferred_tails: outcome.deferred_tails,
        sources_conflicted: outcome.sources_conflicted,
        lines_read: outcome.lines_read,
        bytes_scanned: outcome.bytes_scanned,
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Command {
    Init,
    Collect,
    CollectPrefix,
    PrefixEnable,
    Upgrade,
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
    backup: Option<PathBuf>,
    occurrence_key: Option<PathBuf>,
}

fn parse_options(args: &[String]) -> Result<Options, &'static str> {
    let command = match args.first().map(String::as_str) {
        Some("init") => Command::Init,
        Some("collect") => Command::Collect,
        Some("collect-prefix") => Command::CollectPrefix,
        Some("prefix-enable") => Command::PrefixEnable,
        Some("upgrade") => Command::Upgrade,
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
    let mut backup = None;
    let mut occurrence_key = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--json"
                if matches!(
                    command,
                    Command::Collect | Command::CollectPrefix | Command::Status
                ) && !json =>
            {
                json = true
            }
            "--rescan"
                if matches!(command, Command::Collect | Command::CollectPrefix) && !rescan =>
            {
                rescan = true
            }
            "--dry-run" if command == Command::Outbox && !dry_run => dry_run = true,
            flag @ ("--state-dir"
            | "--key-file"
            | "--codex"
            | "--claude"
            | "--devin"
            | "--limit"
            | "--after"
            | "--revision"
            | "--backup-dir"
            | "--occurrence-key-file") => {
                i += 1;
                let value = args
                    .get(i)
                    .filter(|value| !value.is_empty())
                    .ok_or("missing_option_value")?;
                match flag {
                    "--state-dir" if directory.is_none() => directory = Some(PathBuf::from(value)),
                    "--occurrence-key-file"
                        if command == Command::Upgrade && occurrence_key.is_none() =>
                    {
                        occurrence_key = Some(PathBuf::from(value))
                    }
                    "--backup-dir" if command == Command::Upgrade && backup.is_none() => {
                        backup = Some(PathBuf::from(value))
                    }
                    "--key-file" if key.is_none() => key = Some(PathBuf::from(value)),
                    "--codex" if matches!(command, Command::Collect | Command::CollectPrefix) => {
                        sources.push((aicharts_protocol::Provider::Codex, PathBuf::from(value)))
                    }
                    "--claude" if matches!(command, Command::Collect | Command::CollectPrefix) => {
                        sources.push((
                            aicharts_protocol::Provider::ClaudeCode,
                            PathBuf::from(value),
                        ))
                    }
                    "--devin" if matches!(command, Command::Collect | Command::CollectPrefix) => {
                        sources.push((aicharts_protocol::Provider::Devin, PathBuf::from(value)))
                    }
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
                    "--revision"
                        if matches!(
                            command,
                            Command::Outbox | Command::PrefixEnable | Command::Upgrade
                        ) && revision.is_none() =>
                    {
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
    if matches!(command, Command::PrefixEnable | Command::Upgrade) && revision.is_none() {
        return Err("migration_revision_required");
    }
    if command == Command::Upgrade && backup.is_none() {
        return Err("migration_backup_required");
    }
    if matches!(command, Command::Collect | Command::CollectPrefix) && sources.is_empty() {
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
        backup,
        occurrence_key,
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
pub(crate) mod unix {
    use super::{hex, Command, Options};
    use aicharts_core::parse_reader;
    use aicharts_ledger::{
        Ledger, LedgerIdentity, LedgerStatus, PrefixScan, SourceScan, SourceStamp,
    };
    use aicharts_protocol::Provider;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    use std::{
        collections::BTreeSet,
        fs,
        io::{BufReader, IsTerminal, Read, Seek, SeekFrom},
        os::unix::{ffi::OsStrExt, fs::MetadataExt},
        path::{Path, PathBuf},
    };

    pub(crate) fn source_id(key: &[u8; 32], path: &Path, provider: Provider) -> [u8; 32] {
        let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts every key length");
        mac.update(b"aicharts-local-source-v1\0");
        mac.update(&[match provider {
            Provider::Codex => 1,
            Provider::ClaudeCode => 2,
            Provider::Devin => 3,
        }]);
        let bytes = path.as_os_str().as_bytes();
        mac.update(&(bytes.len() as u64).to_le_bytes());
        mac.update(bytes);
        mac.finalize().into_bytes().into()
    }

    pub(crate) fn stamp(metadata: &fs::Metadata) -> Result<SourceStamp, &'static str> {
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

    pub(crate) fn verify_path(
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

    fn verify_snapshot(
        file: &fs::File,
        path: &Path,
        canonical: &Path,
        expected: &SourceStamp,
    ) -> Result<(), &'static str> {
        if stamp(&file.metadata().map_err(|_| "source_metadata_failed")?)? != *expected {
            return Err("source_changed_during_scan");
        }
        verify_path(path, canonical, expected)
    }

    struct SourceVerification {
        source_id: [u8; 32],
        path: PathBuf,
        canonical: PathBuf,
        stamp: SourceStamp,
        skipped: bool,
    }

    #[cfg(test)]
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(super) enum ScanStage {
        AfterOpen,
        BeforeRead,
        BeforeParse,
        AfterRead,
        BeforeCommit,
    }

    #[cfg(test)]
    type ScanHook = Box<dyn FnMut(ScanStage, &Path)>;
    #[cfg(test)]
    thread_local! {
        static SCAN_HOOK: std::cell::RefCell<Option<ScanHook>> = const { std::cell::RefCell::new(None) };
    }

    /// Per-thread synthetic fault injection, absent from production builds.
    #[cfg(test)]
    pub(super) fn with_scan_hook<T>(
        hook: impl FnMut(ScanStage, &Path) + 'static,
        run: impl FnOnce() -> T,
    ) -> T {
        struct Reset;
        impl Drop for Reset {
            fn drop(&mut self) {
                SCAN_HOOK.with(|hook| *hook.borrow_mut() = None);
            }
        }
        SCAN_HOOK.with(|slot| {
            let mut slot = slot.borrow_mut();
            assert!(slot.is_none());
            *slot = Some(Box::new(hook));
        });
        let _reset = Reset;
        run()
    }

    #[cfg(test)]
    fn scan_hook(stage: ScanStage, path: &Path) {
        SCAN_HOOK.with(|hook| {
            if let Some(hook) = hook.borrow_mut().as_mut() {
                hook(stage, path);
            }
        });
    }

    /// Legacy collection admits only a stable, complete file. Revalidate even
    /// after read/parse failure: a concurrent truncate can look malformed, but
    /// a stable malformed file must keep its original fatal error.
    fn collect_snapshot(
        file: &mut fs::File,
        verification: &SourceVerification,
        provider: Provider,
        occurrence_key: &[u8; 32],
    ) -> Result<aicharts_core::Collection, &'static str> {
        #[cfg(test)]
        scan_hook(ScanStage::BeforeRead, &verification.path);
        let result = (|| {
            if verification.stamp.bytes != 0 && provider != Provider::Devin {
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
            #[cfg(test)]
            scan_hook(ScanStage::BeforeParse, &verification.path);
            parse_reader(
                BufReader::new((&mut *file).take(verification.stamp.bytes)),
                provider,
                occurrence_key,
            )
            .map_err(|_| "source_parse_failed")
        })();
        #[cfg(test)]
        scan_hook(ScanStage::AfterRead, &verification.path);
        verify_snapshot(
            file,
            &verification.path,
            &verification.canonical,
            &verification.stamp,
        )?;
        result
    }

    /// The changed-source count staged for the current wave across the two
    /// mode-exclusive scan vectors.
    fn wave_len(scans: &[SourceScan], prefix_scans: &[PrefixScan]) -> u64 {
        (scans.len() + prefix_scans.len()) as u64
    }

    /// Rate-limited, single-line stderr progress for long collections. Emits
    /// only on an interactive terminal; piped stderr keeps its exact contract.
    /// Dropping clears the line so errors and results start on a fresh row.
    struct Progress {
        enabled: bool,
        last: std::time::Instant,
    }
    impl Progress {
        fn new() -> Self {
            Self {
                enabled: std::io::stderr().is_terminal(),
                // First note writes immediately so a long run shows life at once.
                last: std::time::Instant::now() - std::time::Duration::from_secs(1),
            }
        }
        fn note(&mut self, line: &str) {
            if self.enabled && self.last.elapsed() >= std::time::Duration::from_millis(200) {
                eprint!("\raicharts: {line}\x1b[K");
                self.last = std::time::Instant::now();
            }
        }
    }
    impl Drop for Progress {
        fn drop(&mut self) {
            if self.enabled {
                eprint!("\r\x1b[K");
            }
        }
    }

    /// Fold one committed wave's outcome into the invocation's aggregate report.
    fn absorb(
        report: &mut aicharts_ledger::ImportReport,
        committed: aicharts_ledger::ImportReport,
    ) -> Result<(), &'static str> {
        report.sources_updated = report
            .sources_updated
            .checked_add(committed.sources_updated)
            .ok_or("source_file_limit")?;
        report.occurrences_changed = report
            .occurrences_changed
            .checked_add(committed.occurrences_changed)
            .ok_or("retained_measurement_limit")?;
        report.revision = committed.revision;
        Ok(())
    }

    /// Verify every source in the wave, commit it atomically at the current
    /// revision, then refresh the snapshot for the next wave. A wave rejected
    /// for a single source's irreconcilable rewrite retries per source so one
    /// conflicting file cannot stall every source ordered after it; the second
    /// return counts conflicts, whole-source deferrals and deferred metadata
    /// skips. A changing legacy source leaves its retained state untouched.
    fn commit_wave(
        ledger: &mut Ledger,
        snapshot: &mut aicharts_ledger::PrefixSnapshot,
        prefix_mode: bool,
        scans: &mut Vec<SourceScan>,
        prefix_scans: &mut Vec<PrefixScan>,
        verification: &[SourceVerification],
        progress: &mut Progress,
    ) -> Result<(aicharts_ledger::ImportReport, u64, u64, u64), &'static str> {
        // Nothing durable changes until the complete wave is valid and the
        // ledger's revision CAS succeeds.
        let mut deferred = 0;
        let mut deferred_skips = 0;
        let mut unstable = BTreeSet::new();
        for source in verification {
            #[cfg(test)]
            scan_hook(ScanStage::BeforeCommit, &source.path);
            match verify_path(&source.path, &source.canonical, &source.stamp) {
                Err("source_changed_during_scan") if !prefix_mode => {
                    unstable.insert(source.source_id);
                    deferred += 1;
                    deferred_skips += u64::from(source.skipped);
                }
                result => result?,
            }
        }
        scans.retain(|scan| !unstable.contains(&scan.source_id));
        let mut conflicted = 0;
        let report = if prefix_mode {
            ledger
                .commit_prefix_scans(snapshot.revision, std::mem::take(prefix_scans))
                .map_err(|error| error.code())?
        } else {
            let wave = std::mem::take(scans);
            match ledger.commit_scans_ref(snapshot.revision, &wave) {
                Ok(report) => report,
                Err(
                    aicharts_ledger::Error::SourceHistoryChanged
                    | aicharts_ledger::Error::InvalidMeasurement,
                ) => {
                    let mut report = aicharts_ledger::ImportReport {
                        revision: snapshot.revision,
                        sources_updated: 0,
                        occurrences_changed: 0,
                    };
                    for scan in &wave {
                        match ledger.commit_scans_ref(report.revision, std::slice::from_ref(scan)) {
                            Ok(committed) => absorb(&mut report, committed)?,
                            Err(
                                aicharts_ledger::Error::SourceHistoryChanged
                                | aicharts_ledger::Error::InvalidMeasurement,
                            ) => {
                                conflicted += 1;
                                progress
                                    .note("skipping a source with irreconcilable retained history");
                            }
                            Err(error) => return Err(error.code()),
                        }
                    }
                    report
                }
                Err(error) => return Err(error.code()),
            }
        };
        *snapshot = ledger.prefix_snapshot().map_err(|error| error.code())?;
        Ok((report, conflicted, deferred, deferred_skips))
    }

    pub(super) struct CollectionOutcome {
        pub(super) report: aicharts_ledger::ImportReport,
        pub(super) sources_skipped: u64,
        pub(super) deferred_tails: u64,
        pub(super) lines_read: u64,
        pub(super) bytes_scanned: u64,
        pub(super) sources_conflicted: u64,
        pub(super) sources_deferred: u64,
    }

    pub(super) fn collect(
        ledger: &mut Ledger,
        options: &Options,
        checkpoint_key: &[u8; 32],
        occurrence_key: &[u8; 32],
    ) -> Result<CollectionOutcome, &'static str> {
        collect_with_limit(
            ledger,
            options,
            checkpoint_key,
            occurrence_key,
            crate::MAX_SOURCE_BYTES,
            crate::MAX_WAVE_FILES,
            aicharts_core::MAX_MEASUREMENTS,
        )
    }

    /// `wave_limit` bounds the bytes committed in one atomic wave,
    /// `wave_file_limit` bounds its changed-source count and
    /// `wave_measurement_limit` bounds its merged measurement count; callers
    /// use `crate::MAX_SOURCE_BYTES`/`crate::MAX_WAVE_FILES`/
    /// `aicharts_core::MAX_MEASUREMENTS` and tests use small values to
    /// exercise partitioning deterministically.
    pub(super) fn collect_with_limit(
        ledger: &mut Ledger,
        options: &Options,
        checkpoint_key: &[u8; 32],
        occurrence_key: &[u8; 32],
        wave_limit: u64,
        wave_file_limit: u64,
        wave_measurement_limit: usize,
    ) -> Result<CollectionOutcome, &'static str> {
        let prefix_mode = options.command == Command::CollectPrefix;
        let mut snapshot = ledger.prefix_snapshot().map_err(|error| error.code())?;
        // Validate the explicit mode before visiting any source. Empty commits
        // validate layout/revision without advancing state or migrating it.
        if prefix_mode {
            ledger.commit_prefix_scans(snapshot.revision, vec![])
        } else {
            ledger.commit_scans(snapshot.revision, vec![])
        }
        .map_err(|error| error.code())?;
        let mut visited = 0;
        let mut seen = BTreeSet::new();
        let mut total_files = 0u64;
        let mut skipped = 0u64;
        let mut deferred = 0u64;
        let mut sources_deferred = 0u64;
        let mut conflicted = 0u64;
        let mut bytes_scanned = 0u64;
        let mut lines_read = 0u64;
        // Each commit wave stays inside the per-commit byte, file-count and
        // measurement budgets; a source tree larger than any bound completes
        // across consecutive atomic waves instead of failing the entire collect.
        let mut wave_bytes = 0u64;
        let mut retained = 0usize;
        let mut scans = vec![];
        let mut prefix_scans = vec![];
        let mut verification = vec![];
        let mut report = aicharts_ledger::ImportReport {
            revision: snapshot.revision,
            sources_updated: 0,
            occurrences_changed: 0,
        };
        let mut progress = Progress::new();
        let trees = options.sources.len();
        for (tree, (provider, path)) in options.sources.iter().enumerate() {
            let mut files = vec![];
            progress.note("discovering source files");
            crate::source_files(
                path,
                *provider,
                0,
                &mut files,
                &mut visited,
                crate::MAX_DISCOVERY_FILES,
            )?;
            files.sort();
            let tree_files = files.len();
            for (index, path) in files.into_iter().enumerate() {
                let canonical = fs::canonicalize(&path).map_err(|_| "source_metadata_failed")?;
                if !seen.insert((*provider, canonical.clone())) {
                    continue;
                }
                total_files += 1;
                if total_files > crate::MAX_DISCOVERY_FILES as u64 {
                    return Err("source_file_limit");
                }
                progress.note(&format!(
                    "collecting — source set {}/{trees}, file {}/{tree_files}, {total_files} visited",
                    tree + 1,
                    index + 1
                ));
                let source_id = source_id(checkpoint_key, &canonical, *provider);
                let mut file = crate::open_regular(&path).map_err(|_| "source_read_failed")?;
                let before = stamp(&file.metadata().map_err(|_| "source_metadata_failed")?)?;
                #[cfg(test)]
                scan_hook(ScanStage::AfterOpen, &path);
                match verify_path(&path, &canonical, &before) {
                    Err("source_changed_during_scan") if !prefix_mode => {
                        sources_deferred += 1;
                        continue;
                    }
                    result => result?,
                }
                let mut source_verification = SourceVerification {
                    source_id,
                    path,
                    canonical,
                    stamp: before,
                    skipped: false,
                };
                let checkpoint = snapshot.checkpoints.get(&source_id).copied();
                if !options.rescan
                    && checkpoint.is_some_and(|old| {
                        old.stamp == before && (!prefix_mode || old.prefix.is_some())
                    })
                {
                    skipped += 1;
                    if prefix_mode
                        && checkpoint
                            .and_then(|old| old.prefix)
                            .is_some_and(|prefix| prefix.bytes < before.bytes)
                    {
                        deferred += 1;
                    }
                    source_verification.skipped = true;
                    verification.push(source_verification);
                    continue;
                }
                if before.bytes > wave_limit {
                    // A selected source cannot be silently omitted. Earlier
                    // completed waves remain durable; this invocation fails.
                    return Err("source_byte_limit");
                }
                if (wave_bytes > 0 || wave_len(&scans, &prefix_scans) > 0)
                    && (wave_len(&scans, &prefix_scans) >= wave_file_limit
                        || wave_bytes
                            .checked_add(before.bytes)
                            .ok_or("source_byte_limit")?
                            > wave_limit)
                {
                    progress.note("committing a bounded wave");
                    let (committed, delta, deferred_sources, deferred_skips) = commit_wave(
                        ledger,
                        &mut snapshot,
                        prefix_mode,
                        &mut scans,
                        &mut prefix_scans,
                        &verification,
                        &mut progress,
                    )?;
                    conflicted += delta;
                    sources_deferred += deferred_sources;
                    skipped -= deferred_skips;
                    absorb(&mut report, committed)?;
                    wave_bytes = 0;
                    retained = 0;
                    verification.clear();
                }
                bytes_scanned = bytes_scanned
                    .checked_add(before.bytes)
                    .ok_or("source_byte_limit")?;
                wave_bytes = wave_bytes
                    .checked_add(before.bytes)
                    .ok_or("source_byte_limit")?;
                let previous = checkpoint.and_then(|old| old.prefix);
                let (collection, complete) = if prefix_mode {
                    if checkpoint.is_some_and(|old| {
                        old.stamp.device != before.device
                            || old.stamp.inode != before.inode
                            || before.bytes
                                < old.prefix.map_or(old.stamp.bytes, |prefix| prefix.bytes)
                    }) {
                        return Err("ledger_source_history_changed");
                    }
                    let (collection, prefix) = crate::prefix::collect_prefix(
                        &mut file,
                        &source_id,
                        checkpoint_key,
                        occurrence_key,
                        before.bytes,
                        previous,
                        *provider,
                    )?;
                    verify_snapshot(
                        &file,
                        &source_verification.path,
                        &source_verification.canonical,
                        &before,
                    )?;
                    (collection, Some(prefix))
                } else {
                    match collect_snapshot(
                        &mut file,
                        &source_verification,
                        *provider,
                        occurrence_key,
                    ) {
                        Ok(collection) => (collection, None),
                        Err("source_changed_during_scan" | "source_partial_tail") => {
                            sources_deferred += 1;
                            continue;
                        }
                        Err(error) => return Err(error),
                    }
                };
                lines_read = lines_read
                    .checked_add(collection.lines_read)
                    .ok_or("source_line_limit")?;
                let count: usize = collection
                    .batches
                    .iter()
                    .map(|batch| batch.usage.len())
                    .sum();
                // The measurement budget bounds a commit the same way the byte
                // and file budgets do: a denser wave commits first and this
                // source opens the next one.
                if wave_len(&scans, &prefix_scans) > 0
                    && retained
                        .checked_add(count)
                        .ok_or("retained_measurement_limit")?
                        > wave_measurement_limit
                {
                    progress.note("committing a bounded wave");
                    let (committed, delta, deferred_sources, deferred_skips) = commit_wave(
                        ledger,
                        &mut snapshot,
                        prefix_mode,
                        &mut scans,
                        &mut prefix_scans,
                        &verification,
                        &mut progress,
                    )?;
                    conflicted += delta;
                    sources_deferred += deferred_sources;
                    skipped -= deferred_skips;
                    absorb(&mut report, committed)?;
                    wave_bytes = before.bytes;
                    retained = 0;
                    verification.clear();
                }
                retained = retained
                    .checked_add(count)
                    .ok_or("retained_measurement_limit")?;
                if retained > wave_measurement_limit {
                    return Err("retained_measurement_limit");
                }
                if let Some(complete) = complete {
                    if complete.bytes < before.bytes {
                        deferred += 1;
                    }
                    // A nonempty historical baseline must reach conservation
                    // validation, never silently disappear behind tail deferral.
                    if complete.bytes == 0
                        && previous.is_none()
                        && checkpoint.is_some_and(|old| old.stamp.bytes != 0)
                    {
                        return Err("source_partial_tail");
                    }
                    // New and previously empty unwitnessed sources wait for
                    // their first complete line before establishing a witness.
                    if complete.bytes != 0 || previous.is_some() {
                        // An unfinished append cannot advance the durable stamp.
                        // Still submit the replay so unchanged bytes must yield
                        // exactly the prior canonical numeric frame set.
                        let stamp = checkpoint
                            .filter(|old| old.prefix == Some(complete))
                            .map_or(before, |old| old.stamp);
                        prefix_scans.push(PrefixScan {
                            source_id,
                            stamp,
                            previous,
                            complete,
                            collection,
                        });
                    }
                } else {
                    scans.push(SourceScan {
                        source_id,
                        stamp: before,
                        collection,
                        // Tools replace session files wholesale on upgrades and
                        // forks; every provider merges retained history by
                        // dominance instead of failing the wave.
                        allows_rewrite: true,
                    });
                }
                verification.push(source_verification);
            }
        }
        if total_files == 0 {
            return Err("no_source_files");
        }
        progress.note("committing a bounded wave");
        let (committed, delta, deferred_sources, deferred_skips) = commit_wave(
            ledger,
            &mut snapshot,
            prefix_mode,
            &mut scans,
            &mut prefix_scans,
            &verification,
            &mut progress,
        )?;
        conflicted += delta;
        sources_deferred += deferred_sources;
        skipped -= deferred_skips;
        absorb(&mut report, committed)?;
        Ok(CollectionOutcome {
            report,
            sources_skipped: skipped,
            deferred_tails: deferred,
            lines_read,
            bytes_scanned,
            sources_conflicted: conflicted,
            sources_deferred,
        })
    }

    fn status_json(status: &LedgerStatus) -> serde_json::Value {
        serde_json::json!({
            "schemaVersion":1,"localOnly":true,"uploaded":false,"ledgerRevision":status.revision,
            "sources":status.sources,"usageOccurrences":status.usage_occurrences,"associations":status.associations,
            "pendingRecords":status.pending_records,
            "tokens":status.tokens.to_string(),"outputTokens":status.output_tokens.to_string(),
            "capacity":{"sources":aicharts_ledger::MAX_SOURCES,"usageOccurrences":aicharts_ledger::MAX_OCCURRENCES,
                "associations":aicharts_ledger::MAX_ASSOCIATIONS,"databaseBytes":aicharts_ledger::MAX_DATABASE_BYTES.to_string()},
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
        let checkpoint = crate::read_key(&options.key)?;
        // A custody-verified enrollment at the state directory resolves the
        // account occurrence key; anything else keeps the legacy identity.
        let occurrence =
            crate::enrolled_ledger::resolve(&options.directory, options.occurrence_key.as_deref())?;
        run_with_occurrence(options, &checkpoint, occurrence)
    }

    /// `occurrence` is the resolved account namespace key — custody-held for an
    /// enrolled directory — or `None` for the legacy single-key identity.
    /// Split-key state derives source checkpoints from `checkpoint` and
    /// occurrence identities from `occurrence`; it never mixes them.
    pub(super) fn run_with_occurrence(
        options: Options,
        checkpoint: &[u8; 32],
        occurrence: Option<[u8; 32]>,
    ) -> Result<String, &'static str> {
        let identity = match &occurrence {
            Some(occurrence) => LedgerIdentity::SplitKeys {
                checkpoint,
                occurrence,
                namespace_version: 1,
            },
            None => LedgerIdentity::Legacy(checkpoint),
        };
        if options.command == Command::Init {
            match &occurrence {
                // `enroll` already owns the verified anchor directory; the
                // split-key database is provisioned inside it without
                // adopting or overwriting anything.
                Some(_) => {
                    crate::enrolled_ledger::initialize_in_anchor(&options.directory, &identity)?;
                }
                None => {
                    Ledger::initialize_with_identity(&options.directory, &identity)
                        .map_err(|error| error.code())?;
                }
            }
            return Ok(
                "Private local ledger initialized. No sources read; nothing uploaded.\n".to_owned(),
            );
        }
        if options.command == Command::Upgrade {
            let outcome = Ledger::upgrade(
                &options.directory,
                &identity,
                options.revision.ok_or("migration_revision_required")?,
                options
                    .backup
                    .as_deref()
                    .ok_or("migration_backup_required")?,
            )
            .map_err(|error| error.code())?;
            if !outcome.changed {
                return Ok("Ledger schema is already current. No schema change or backup creation performed. Use inspect --export-dir NEW_PRIVATE_DIRECTORY to create an exact numeric recovery copy. Nothing uploaded.\n".into());
            }
            return Ok("Ledger schema upgraded after validating an exact private numeric backup. Sources, frames, warnings, revision and sender records preserved. Retain the original keys and enrollment anchors; the backup grants no upload authority. No sources read; nothing uploaded.\n".into());
        }
        if options.command == Command::PrefixEnable {
            Ledger::migrate_complete_prefix(
                &options.directory,
                &identity,
                options.revision.ok_or("migration_revision_required")?,
            )
            .map_err(|error| error.code())?;
            return Ok("Completed-prefix collection enabled locally. No sources read; nothing uploaded. Use collect-prefix for this ledger.\n".to_owned());
        }
        let mut ledger = Ledger::open_with_identity(&options.directory, &identity)
            .map_err(|error| error.code())?;
        let occurrence_key = occurrence.as_ref().unwrap_or(checkpoint);
        match options.command {
            Command::Init | Command::PrefixEnable | Command::Upgrade => unreachable!(),
            Command::Collect | Command::CollectPrefix => {
                let CollectionOutcome {
                    report,
                    sources_skipped: skipped,
                    deferred_tails: deferred,
                    lines_read,
                    bytes_scanned,
                    sources_conflicted: conflicted,
                    sources_deferred,
                } = collect(&mut ledger, &options, checkpoint, occurrence_key)?;
                let status = ledger.status().map_err(|error| error.code())?;
                if options.json {
                    let mut output = status_json(&status);
                    output["committedRevision"] = report.revision.into();
                    output["sourcesUpdated"] = report.sources_updated.into();
                    output["occurrencesChanged"] = report.occurrences_changed.into();
                    output["sourcesSkipped"] = skipped.into();
                    output["sourcesConflicted"] = conflicted.into();
                    output["sourcesDeferred"] = sources_deferred.into();
                    if options.command == Command::CollectPrefix {
                        output["sourcesWithDeferredTail"] = deferred.into();
                    }
                    output["linesRead"] = lines_read.into();
                    output["bytesScanned"] = bytes_scanned.into();
                    output["scanMode"] = if options.command == Command::CollectPrefix {
                        "full_changed_source_complete_prefix"
                    } else {
                        "full_changed_source_snapshot"
                    }
                    .into();
                    json(&output)
                } else {
                    let warnings = status
                        .warnings
                        .iter()
                        .map(|warning| warning.code())
                        .collect::<Vec<_>>()
                        .join(", ");
                    let deferred_note = if options.command == Command::CollectPrefix {
                        format!("Sources with unfinished tails deferred: {deferred}\n")
                    } else {
                        format!("Unstable or unfinished sources deferred: {sources_deferred}\n")
                    };
                    Ok(format!("Collection completed at revision {}; current ledger revision {}. Nothing uploaded.\nSources updated: {}; unchanged skipped: {skipped}; conflicting history skipped: {conflicted}\n{deferred_note}Physical lines read: {lines_read}; bytes scanned: {bytes_scanned}\nObserved tokens: {}; pending records: {}\nCoverage: partial; prompt counts, activity and model pricing unavailable.\nWarnings: {warnings}\n", report.revision,status.revision,report.sources_updated,status.tokens,status.pending_records))
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
                    Ok(format!("AI Charts local ledger — revision {}\nSources: {}; usage occurrences: {}; pending records: {}\nObserved tokens: {}; output tokens: {}\nCapacity: {} of {} sources, {} of {} occurrences, {} of {} source associations\nCoverage: partial; prompt counts, activity and model pricing unavailable.\nWarnings: {warnings}\nNothing uploaded.\n",status.revision,status.sources,status.usage_occurrences,status.pending_records,status.tokens,status.output_tokens,status.sources,aicharts_ledger::MAX_SOURCES,status.usage_occurrences,aicharts_ledger::MAX_OCCURRENCES,status.associations,aicharts_ledger::MAX_ASSOCIATIONS))
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
    #[cfg(test)]
    mod snapshot_tests {
        use super::*;

        #[test]
        fn persistent_read_failure_remains_fatal_when_snapshot_is_stable() {
            let mut random = [0; 16];
            getrandom::fill(&mut random).unwrap();
            let path = std::env::temp_dir().join(format!("aicharts-read-failure-{}", hex(&random)));
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .unwrap();
            std::io::Write::write_all(&mut file, b"{}\n").unwrap();
            let verification = SourceVerification {
                source_id: [1; 32],
                canonical: fs::canonicalize(&path).unwrap(),
                path: path.clone(),
                stamp: stamp(&file.metadata().unwrap()).unwrap(),
                skipped: false,
            };
            let result = collect_snapshot(&mut file, &verification, Provider::ClaudeCode, &[7; 32]);
            drop(file);
            fs::remove_file(path).unwrap();
            assert_eq!(result.err(), Some("source_read_failed"));
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

    /// End-to-end command flow for both ledger identities. A custody-verified
    /// enrollment resolves to `Some(occurrence)` inside `unix::run`; here the
    /// resolved key arrives directly, the same shape `run` produces on macOS.
    #[cfg(unix)]
    mod identity {
        use super::super::unix;
        use super::{args, parse_options};
        use std::fs;
        use std::os::unix::fs::DirBuilderExt;
        use std::path::{Path, PathBuf};

        const CHECKPOINT: [u8; 32] = [7; 32];
        const NAMESPACE: [u8; 32] = [0x5a; 32];

        struct Fixture(PathBuf);
        impl Fixture {
            fn new() -> Self {
                let mut random = [0; 16];
                getrandom::fill(&mut random).unwrap();
                let suffix: String = random.iter().map(|b| format!("{b:02x}")).collect();
                let path = fs::canonicalize(std::env::temp_dir())
                    .unwrap()
                    .join(format!("aicharts-state-test-{suffix}"));
                std::fs::DirBuilder::new()
                    .mode(0o700)
                    .create(&path)
                    .unwrap();
                Self(path)
            }
            /// `enroll` pre-creates the anchor for enrolled state; legacy
            /// `init` still creates the directory itself.
            fn state(&self) -> PathBuf {
                self.0.join("state")
            }
            fn create_state(&self) -> PathBuf {
                let dir = self.state();
                std::fs::DirBuilder::new().mode(0o700).create(&dir).unwrap();
                dir
            }
            /// One Claude source under a sibling directory.
            fn write_source(&self) -> PathBuf {
                let dir = self.0.join("src");
                std::fs::DirBuilder::new().mode(0o700).create(&dir).unwrap();
                let file = dir.join("session.jsonl");
                fs::write(
                    &file,
                    concat!(
                        r#"{"type":"assistant","timestamp":"2026-09-10T10:00:01Z","sessionId":"session-1","requestId":"r1","message":{"id":"message-1","usage":{"input_tokens":10,"output_tokens":2,"cache_read_input_tokens":3,"cache_creation_input_tokens":0}}}"#,
                        "\n"
                    ),
                )
                .unwrap();
                dir
            }
            /// One Devin ATIF document under a sibling directory; no LF tail.
            fn write_devin_source(&self) -> PathBuf {
                let dir = self.0.join("devin-src");
                std::fs::DirBuilder::new().mode(0o700).create(&dir).unwrap();
                let file = dir.join("session.json");
                fs::write(
                    &file,
                    r#"{"schema_version":"ATIF-v1.7","session_id":"atif-1","agent":{"name":"devin"},"steps":[{"step_id":1,"source":"agent","timestamp":"2026-09-15T10:00:05Z","metrics":{"prompt_tokens":10,"completion_tokens":2,"cached_tokens":3}}]}"#,
                )
                .unwrap();
                dir
            }
        }
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }

        fn options(dir: &Path, src: Option<&Path>, rest: &[&str]) -> super::Options {
            options_as(dir, "--claude", src, rest)
        }

        fn options_as(dir: &Path, flag: &str, src: Option<&Path>, rest: &[&str]) -> super::Options {
            let mut all: Vec<String> = rest.iter().map(|s| s.to_string()).collect();
            all.extend([
                "--state-dir".to_string(),
                dir.to_string_lossy().into_owned(),
                "--key-file".to_string(),
                "unused".to_string(),
            ]);
            if let Some(src) = src {
                all.push(flag.to_string());
                all.push(src.to_string_lossy().into_owned());
            }
            parse_options(&all).unwrap()
        }

        fn hex_id(dir: &Path, occurrence: Option<&[u8; 32]>) -> String {
            // The committed occurrence id derives under the ledger's own
            // namespace key, so recompute it the way the parser does.
            let src = dir.join("src").join("session.jsonl");
            let bytes = fs::read(&src).unwrap();
            let key = occurrence.unwrap_or(&CHECKPOINT);
            let collection = aicharts_core::parse_reader(
                std::io::BufReader::new(&bytes[..]),
                aicharts_protocol::Provider::ClaudeCode,
                key,
            )
            .unwrap();
            let id = collection.batches[0].usage[0].id;
            id.iter().map(|b| format!("{b:02x}")).collect()
        }

        fn canary() -> String {
            NAMESPACE.iter().map(|b| format!("{b:02x}")).collect()
        }

        fn live_line(request: u8, output: u64) -> String {
            serde_json::json!({"type":"assistant","timestamp":"2026-09-10T10:00:00Z",
                "sessionId":"session","requestId":format!("r{request}"),
                "message":{"id":format!("m{request}"),"usage":{"input_tokens":10,"output_tokens":output}}})
                .to_string() + "\n"
        }

        fn pending(ledger: &aicharts_ledger::Ledger) -> Vec<(aicharts_protocol::Id, u64, Vec<u8>)> {
            ledger
                .pending(None, 256, None)
                .unwrap()
                .entries
                .into_iter()
                .map(|entry| (entry.id, entry.revision, entry.frame))
                .collect()
        }

        #[test]
        fn empty_sources_still_obey_wave_file_limit() {
            let fixture = Fixture::new();
            let dir = fixture.state();
            let mut ledger = aicharts_ledger::Ledger::initialize(&dir, &CHECKPOINT).unwrap();
            let src = fixture.0.join("src");
            fs::create_dir(&src).unwrap();
            for i in 0..3 {
                fs::write(src.join(format!("{i}.jsonl")), "").unwrap();
            }
            let result = unix::collect_with_limit(
                &mut ledger,
                &options(&dir, Some(&src), &["collect"]),
                &CHECKPOINT,
                &CHECKPOINT,
                crate::MAX_SOURCE_BYTES,
                1,
                usize::MAX,
            )
            .unwrap();
            assert_eq!(
                (
                    result.report.sources_updated,
                    result.report.revision,
                    result.bytes_scanned,
                    result.sources_deferred
                ),
                (3, 3, 0, 0)
            );
        }

        #[test]
        fn fatal_input_preserves_earlier_waves_and_nonregular_replacement_is_not_deferred() {
            for nonregular in [false, true] {
                let fixture = Fixture::new();
                let dir = fixture.state();
                let mut ledger = aicharts_ledger::Ledger::initialize(&dir, &CHECKPOINT).unwrap();
                let src = fixture.0.join("src");
                fs::create_dir(&src).unwrap();
                fs::write(src.join("a.jsonl"), live_line(1, 2)).unwrap();
                let second = src.join("b.jsonl");
                fs::write(
                    &second,
                    if nonregular {
                        live_line(2, 2)
                    } else {
                        "{invalid\n".to_owned()
                    },
                )
                .unwrap();
                let selected = options(&dir, Some(&src), &["collect"]);
                let result = unix::with_scan_hook(
                    move |stage, path| {
                        if nonregular && stage == unix::ScanStage::BeforeCommit && path == second {
                            fs::remove_file(path).unwrap();
                            fs::create_dir(path).unwrap();
                        }
                    },
                    || {
                        unix::collect_with_limit(
                            &mut ledger,
                            &selected,
                            &CHECKPOINT,
                            &CHECKPOINT,
                            crate::MAX_SOURCE_BYTES,
                            1,
                            usize::MAX,
                        )
                    },
                );
                assert_eq!(
                    result.err(),
                    Some(if nonregular {
                        "source_not_regular"
                    } else {
                        "source_parse_failed"
                    })
                );
                let status = ledger.status().unwrap();
                assert_eq!((status.revision, status.sources, status.tokens), (1, 1, 12));
            }
        }

        #[test]
        fn observed_churn_defers_only_that_source_and_retains_its_checkpoint_and_frames() {
            use unix::ScanStage::*;
            for stage in [AfterOpen, BeforeRead, BeforeParse, AfterRead, BeforeCommit] {
                for replacement in [String::new(), "{invalid\n".to_owned(), live_line(2, 99)] {
                    let fixture = Fixture::new();
                    let dir = fixture.state();
                    let mut ledger =
                        aicharts_ledger::Ledger::initialize(&dir, &CHECKPOINT).unwrap();
                    let src = fixture.0.join("src");
                    fs::create_dir(&src).unwrap();
                    let unstable = src.join("b.jsonl");
                    fs::write(&unstable, live_line(2, 2)).unwrap();
                    let selected = options(&dir, Some(&src), &["collect"]);
                    unix::collect(&mut ledger, &selected, &CHECKPOINT, &CHECKPOINT).unwrap();
                    let old = ledger.snapshot().unwrap();
                    let old_pending = pending(&ledger);
                    fs::write(&unstable, live_line(2, 3)).unwrap();
                    fs::write(src.join("a.jsonl"), live_line(1, 2)).unwrap();
                    fs::write(src.join("c.jsonl"), live_line(3, 2)).unwrap();
                    let attempted: u64 = fs::read_dir(&src)
                        .unwrap()
                        .map(|file| file.unwrap().metadata().unwrap().len())
                        .sum();
                    let target = unstable.clone();
                    let result = unix::with_scan_hook(
                        move |point, path| {
                            if point == stage && path == target {
                                fs::write(path, &replacement).unwrap();
                            }
                        },
                        || unix::collect(&mut ledger, &selected, &CHECKPOINT, &CHECKPOINT),
                    )
                    .unwrap();
                    let unix::CollectionOutcome {
                        report,
                        sources_skipped: skipped,
                        deferred_tails: tails,
                        bytes_scanned: bytes,
                        sources_conflicted: conflicts,
                        sources_deferred: deferred,
                        ..
                    } = result;
                    assert_eq!(
                        (report.sources_updated, skipped, tails, conflicts, deferred),
                        (2, 0, 0, 0, 1),
                        "{stage:?}"
                    );
                    // Work attempted before detecting a changed source is still charged.
                    assert_eq!(
                        bytes,
                        attempted
                            - if stage == AfterOpen {
                                live_line(2, 3).len() as u64
                            } else {
                                0
                            }
                    );
                    let current = ledger.snapshot().unwrap();
                    for (id, stamp) in old.checkpoints {
                        assert_eq!(current.checkpoints.get(&id), Some(&stamp), "{stage:?}");
                    }
                    let current_pending = pending(&ledger);
                    assert!(
                        old_pending
                            .iter()
                            .all(|entry| current_pending.contains(entry)),
                        "{stage:?}"
                    );
                    let status = ledger.status().unwrap();
                    assert_eq!(
                        (
                            status.sources,
                            status.usage_occurrences,
                            status.associations,
                            status.tokens
                        ),
                        (3, 3, 3, 36)
                    );
                    // No inner rescan: the changed source is admitted only on a later pass.
                    fs::write(&unstable, live_line(2, 3)).unwrap();
                    let next =
                        unix::collect(&mut ledger, &selected, &CHECKPOINT, &CHECKPOINT).unwrap();
                    assert_eq!(
                        (
                            next.report.sources_updated,
                            next.sources_skipped,
                            next.sources_deferred
                        ),
                        (1, 2, 0)
                    );
                    assert_eq!(ledger.status().unwrap().tokens, 37);
                }
            }
        }

        #[test]
        fn late_change_to_metadata_skip_does_not_block_stable_sibling() {
            let fixture = Fixture::new();
            let dir = fixture.state();
            let mut ledger = aicharts_ledger::Ledger::initialize(&dir, &CHECKPOINT).unwrap();
            let src = fixture.write_source();
            let selected = options(&dir, Some(&src), &["collect"]);
            unix::collect(&mut ledger, &selected, &CHECKPOINT, &CHECKPOINT).unwrap();
            let old = ledger.snapshot().unwrap();
            let old_pending = pending(&ledger);
            fs::write(src.join("new.jsonl"), live_line(2, 2)).unwrap();
            let target = src.join("session.jsonl");
            let result = unix::with_scan_hook(
                move |stage, path| {
                    if stage == unix::ScanStage::BeforeCommit && path == target {
                        fs::write(path, "{invalid\n").unwrap();
                    }
                },
                || unix::collect(&mut ledger, &selected, &CHECKPOINT, &CHECKPOINT),
            )
            .unwrap();
            assert_eq!(
                (
                    result.report.sources_updated,
                    result.sources_skipped,
                    result.sources_conflicted,
                    result.sources_deferred
                ),
                (1, 0, 0, 1)
            );
            let current = ledger.snapshot().unwrap();
            for (id, stamp) in old.checkpoints {
                assert_eq!(current.checkpoints.get(&id), Some(&stamp));
            }
            assert!(old_pending
                .iter()
                .all(|entry| pending(&ledger).contains(entry)));
            assert_eq!(ledger.status().unwrap().tokens, 27);
        }

        #[test]
        fn all_deferred_sources_leave_revision_checkpoints_and_pending_frames_unchanged() {
            for retained in [false, true] {
                let fixture = Fixture::new();
                let dir = fixture.state();
                let mut ledger = aicharts_ledger::Ledger::initialize(&dir, &CHECKPOINT).unwrap();
                let src = fixture.write_source();
                let selected = options(&dir, Some(&src), &["collect"]);
                if retained {
                    unix::collect(&mut ledger, &selected, &CHECKPOINT, &CHECKPOINT).unwrap();
                }
                let old = ledger.snapshot().unwrap();
                let old_pending = pending(&ledger);
                let result = unix::with_scan_hook(
                    |stage, path| {
                        if stage == unix::ScanStage::BeforeCommit {
                            fs::write(path, "{invalid\n").unwrap();
                        }
                    },
                    || unix::collect(&mut ledger, &selected, &CHECKPOINT, &CHECKPOINT),
                )
                .unwrap();
                assert_eq!(
                    (
                        result.report.sources_updated,
                        result.sources_skipped,
                        result.sources_conflicted,
                        result.sources_deferred
                    ),
                    (0, 0, 0, 1)
                );
                assert_eq!(result.report.revision, old.revision);
                assert_eq!(ledger.snapshot().unwrap().checkpoints, old.checkpoints);
                assert_eq!(pending(&ledger), old_pending);
            }
        }

        #[test]
        fn stable_unfinished_sources_wait_without_advancing_new_or_retained_state() {
            for retained in [false, true] {
                let fixture = Fixture::new();
                let dir = fixture.state();
                let mut ledger = aicharts_ledger::Ledger::initialize(&dir, &CHECKPOINT).unwrap();
                let src = fixture.write_source();
                let selected = options(&dir, Some(&src), &["collect"]);
                if retained {
                    unix::collect(&mut ledger, &selected, &CHECKPOINT, &CHECKPOINT).unwrap();
                }
                let old = ledger.snapshot().unwrap();
                let old_pending = pending(&ledger);
                let source = src.join("session.jsonl");
                let complete = fs::read_to_string(&source).unwrap() + &live_line(2, 5);
                fs::write(&source, complete.trim_end_matches('\n')).unwrap();
                for _ in 0..2 {
                    let result =
                        unix::collect(&mut ledger, &selected, &CHECKPOINT, &CHECKPOINT).unwrap();
                    assert_eq!(
                        (
                            result.report.sources_updated,
                            result.sources_skipped,
                            result.sources_conflicted,
                            result.sources_deferred
                        ),
                        (0, 0, 0, 1)
                    );
                    assert_eq!(result.report.revision, old.revision);
                    assert_eq!(ledger.snapshot().unwrap().checkpoints, old.checkpoints);
                    assert_eq!(pending(&ledger), old_pending);
                }
                fs::write(&source, complete).unwrap();
                let result =
                    unix::collect(&mut ledger, &selected, &CHECKPOINT, &CHECKPOINT).unwrap();
                assert_eq!(
                    (result.report.sources_updated, result.sources_deferred),
                    (1, 0)
                );
                assert_eq!(ledger.status().unwrap().tokens, 30);
            }
        }

        #[test]
        fn prefix_churn_still_fails_and_legacy_does_not_follow_replaced_paths() {
            for prefix in [false, true] {
                for symlink in [false, true] {
                    if !prefix && !symlink {
                        continue;
                    }
                    let fixture = Fixture::new();
                    let dir = fixture.state();
                    let mut ledger =
                        aicharts_ledger::Ledger::initialize(&dir, &CHECKPOINT).unwrap();
                    if prefix {
                        drop(ledger);
                        ledger = aicharts_ledger::Ledger::migrate_complete_prefix(
                            &dir,
                            &aicharts_ledger::LedgerIdentity::Legacy(&CHECKPOINT),
                            0,
                        )
                        .unwrap();
                    }
                    let src = fixture.write_source();
                    let selected = options(
                        &dir,
                        Some(&src),
                        &[if prefix { "collect-prefix" } else { "collect" }],
                    );
                    let old = ledger.snapshot().unwrap();
                    let result = unix::with_scan_hook(
                        move |stage, path| {
                            if stage == unix::ScanStage::BeforeCommit {
                                if symlink {
                                    let retained = path.with_extension("saved");
                                    fs::rename(path, &retained).unwrap();
                                    std::os::unix::fs::symlink(&retained, path).unwrap();
                                } else {
                                    fs::write(path, "{invalid\n").unwrap();
                                }
                            }
                        },
                        || unix::collect(&mut ledger, &selected, &CHECKPOINT, &CHECKPOINT),
                    );
                    // Replaced paths never contribute the parsed snapshot.
                    if prefix {
                        assert_eq!(result.err(), Some("source_changed_during_scan"));
                    } else {
                        assert_eq!(result.unwrap().sources_deferred, 1);
                    }
                    assert_eq!(ledger.snapshot().unwrap().revision, old.revision);
                    assert!(ledger.snapshot().unwrap().checkpoints.is_empty());
                    assert!(pending(&ledger).is_empty());
                }
            }
        }

        #[test]
        fn enrolled_dir_initializes_collects_and_reports_split_state() {
            let fixture = Fixture::new();
            let dir = fixture.create_state();
            let out = unix::run_with_occurrence(
                options(&dir, None, &["init"]),
                &CHECKPOINT,
                Some(NAMESPACE),
            );
            assert_eq!(
                out.unwrap(),
                "Private local ledger initialized. No sources read; nothing uploaded.\n"
            );
            fixture.write_source();
            let out = unix::run_with_occurrence(
                options(&dir, Some(&fixture.0.join("src")), &["collect"]),
                &CHECKPOINT,
                Some(NAMESPACE),
            )
            .unwrap();
            assert!(out.contains("pending records: 1"), "{out}");
            // Secret canary: the custody namespace key never reaches output.
            assert!(!out.contains(&canary()));
            let out = unix::run_with_occurrence(
                options(&dir, None, &["status", "--json"]),
                &CHECKPOINT,
                Some(NAMESPACE),
            )
            .unwrap();
            assert!(out.contains("\"usageOccurrences\": 1"), "{out}");
            assert!(!out.contains(&canary()));
            let out = unix::run_with_occurrence(
                options(&dir, None, &["outbox", "--dry-run"]),
                &CHECKPOINT,
                Some(NAMESPACE),
            )
            .unwrap();
            // The pending record's id is account-derived, not checkpoint-derived.
            assert!(out.contains(&hex_id(&fixture.0, Some(&NAMESPACE))), "{out}");
            assert!(!out.contains(&hex_id(&fixture.0, None)), "{out}");
            assert!(!out.contains(&canary()));
            // The same directory under the legacy identity refuses, as does
            // the account namespace under a different checkpoint key.
            assert_eq!(
                unix::run_with_occurrence(options(&dir, None, &["status"]), &CHECKPOINT, None,)
                    .err(),
                Some("ledger_namespace_mismatch")
            );
            assert_eq!(
                unix::run_with_occurrence(
                    options(&dir, None, &["status"]),
                    &[9; 32],
                    Some(NAMESPACE),
                )
                .err(),
                Some("ledger_namespace_mismatch")
            );
        }

        #[test]
        fn enrolled_dir_collect_prefix_and_migrate_run_under_split_identity() {
            let fixture = Fixture::new();
            let dir = fixture.create_state();
            unix::run_with_occurrence(options(&dir, None, &["init"]), &CHECKPOINT, Some(NAMESPACE))
                .unwrap();
            let out = unix::run_with_occurrence(
                options(&dir, None, &["prefix-enable", "--revision", "0"]),
                &CHECKPOINT,
                Some(NAMESPACE),
            )
            .unwrap();
            assert!(out.contains("Completed-prefix collection enabled"), "{out}");
            fixture.write_source();
            let out = unix::run_with_occurrence(
                options(&dir, Some(&fixture.0.join("src")), &["collect-prefix"]),
                &CHECKPOINT,
                Some(NAMESPACE),
            )
            .unwrap();
            assert!(out.contains("pending records: 1"), "{out}");
            // The migration refused under the legacy identity too.
            assert_eq!(
                unix::run_with_occurrence(
                    options(&dir, None, &["prefix-enable", "--revision", "2"]),
                    &CHECKPOINT,
                    None,
                )
                .err(),
                Some("ledger_namespace_mismatch")
            );
        }

        #[test]
        fn collect_partitions_sources_across_bounded_commit_waves() {
            let fixture = Fixture::new();
            let dir = fixture.create_state();
            unix::run_with_occurrence(options(&dir, None, &["init"]), &CHECKPOINT, Some(NAMESPACE))
                .unwrap();
            let src = fixture.0.join("src");
            std::fs::DirBuilder::new().mode(0o700).create(&src).unwrap();
            for index in 0..3u8 {
                fs::write(
                    src.join(format!("session-{index}.jsonl")),
                    format!(
                        concat!(
                            r#"{{"type":"assistant","timestamp":"2026-09-10T10:00:0{i}Z","sessionId":"session-{i}","requestId":"r{i}","message":{{"id":"message-{i}","usage":{{"input_tokens":10,"output_tokens":2,"cache_read_input_tokens":3,"cache_creation_input_tokens":0}}}}}}"#,
                            "\n"
                        ),
                        i = index
                    ),
                )
                .unwrap();
            }
            // One file fits a wave, but two never do: three files must
            // complete across three atomic commits instead of failing.
            let size = fs::metadata(src.join("session-0.jsonl")).unwrap().len();
            let options = options(&dir, Some(&src), &["collect"]);
            let mut ledger = aicharts_ledger::Ledger::open_with_identity(
                &dir,
                &aicharts_ledger::LedgerIdentity::SplitKeys {
                    checkpoint: &CHECKPOINT,
                    occurrence: &NAMESPACE,
                    namespace_version: 1,
                },
            )
            .unwrap();
            let before = ledger.status().unwrap().revision;
            let unix::CollectionOutcome {
                report,
                sources_skipped: skipped,
                bytes_scanned: bytes,
                ..
            } = unix::collect_with_limit(
                &mut ledger,
                &options,
                &CHECKPOINT,
                &NAMESPACE,
                size * 2 - 1,
                u64::MAX,
                usize::MAX,
            )
            .unwrap();
            assert_eq!(report.sources_updated, 3);
            assert_eq!(skipped, 0);
            assert_eq!(bytes, size * 3);
            assert_eq!(ledger.status().unwrap().revision - before, 3);
            // An idempotent re-collect skips every source and commits nothing.
            let unix::CollectionOutcome {
                report,
                sources_skipped: skipped,
                bytes_scanned: bytes,
                ..
            } = unix::collect_with_limit(
                &mut ledger,
                &options,
                &CHECKPOINT,
                &NAMESPACE,
                size * 2 - 1,
                u64::MAX,
                usize::MAX,
            )
            .unwrap();
            assert_eq!((report.sources_updated, skipped), (0, 3));
            assert_eq!(bytes, 0);
            assert_eq!(ledger.status().unwrap().revision - before, 3);
        }

        #[test]
        fn selected_oversized_source_is_explicit_failure_with_reopenable_state() {
            let fixture = Fixture::new();
            let dir = fixture.create_state();
            unix::run_with_occurrence(options(&dir, None, &["init"]), &CHECKPOINT, Some(NAMESPACE))
                .unwrap();
            fixture.write_source();
            let identity = aicharts_ledger::LedgerIdentity::SplitKeys {
                checkpoint: &CHECKPOINT,
                occurrence: &NAMESPACE,
                namespace_version: 1,
            };
            let mut ledger = aicharts_ledger::Ledger::open_with_identity(&dir, &identity).unwrap();
            let selected = options(&dir, Some(&fixture.0.join("src")), &["collect"]);
            assert_eq!(
                unix::collect_with_limit(
                    &mut ledger,
                    &selected,
                    &CHECKPOINT,
                    &NAMESPACE,
                    1,
                    u64::MAX,
                    usize::MAX
                )
                .err(),
                Some("source_byte_limit")
            );
            assert_eq!(ledger.status().unwrap().sources, 0);
            drop(ledger);
            let reopened = aicharts_ledger::Ledger::open_with_identity(&dir, &identity).unwrap();
            assert_eq!(reopened.status().unwrap().revision, 0);
        }

        #[test]
        fn collect_partitions_sources_across_bounded_wave_file_counts() {
            let fixture = Fixture::new();
            let dir = fixture.create_state();
            unix::run_with_occurrence(options(&dir, None, &["init"]), &CHECKPOINT, Some(NAMESPACE))
                .unwrap();
            let src = fixture.0.join("src");
            std::fs::DirBuilder::new().mode(0o700).create(&src).unwrap();
            for index in 0..5u8 {
                fs::write(
                    src.join(format!("session-{index}.jsonl")),
                    format!(
                        concat!(
                            r#"{{"type":"assistant","timestamp":"2026-09-10T10:00:0{i}Z","sessionId":"session-{i}","requestId":"r{i}","message":{{"id":"message-{i}","usage":{{"input_tokens":10,"output_tokens":2,"cache_read_input_tokens":3,"cache_creation_input_tokens":0}}}}}}"#,
                            "\n"
                        ),
                        i = index
                    ),
                )
                .unwrap();
            }
            // An unbounded byte budget with two files per wave commits five
            // sources as three atomic waves (2 + 2 + 1), not one commit.
            let options = options(&dir, Some(&src), &["collect"]);
            let mut ledger = aicharts_ledger::Ledger::open_with_identity(
                &dir,
                &aicharts_ledger::LedgerIdentity::SplitKeys {
                    checkpoint: &CHECKPOINT,
                    occurrence: &NAMESPACE,
                    namespace_version: 1,
                },
            )
            .unwrap();
            let before = ledger.status().unwrap().revision;
            let unix::CollectionOutcome {
                report,
                sources_skipped: skipped,
                ..
            } = unix::collect_with_limit(
                &mut ledger,
                &options,
                &CHECKPOINT,
                &NAMESPACE,
                u64::MAX,
                2,
                usize::MAX,
            )
            .unwrap();
            assert_eq!(report.sources_updated, 5);
            assert_eq!(skipped, 0);
            assert_eq!(ledger.status().unwrap().revision - before, 3);
        }

        #[test]
        fn collect_partitions_sources_across_bounded_wave_measurements() {
            let fixture = Fixture::new();
            let dir = fixture.create_state();
            unix::run_with_occurrence(options(&dir, None, &["init"]), &CHECKPOINT, Some(NAMESPACE))
                .unwrap();
            let src = fixture.0.join("src");
            std::fs::DirBuilder::new().mode(0o700).create(&src).unwrap();
            // Two assistant measurements per file; a four-measurement wave
            // budget commits five files as three atomic waves (2 + 2 + 1).
            for index in 0..5u8 {
                fs::write(
                    src.join(format!("session-{index}.jsonl")),
                    (0..2)
                        .map(|line| {
                            format!(
                                r#"{{"type":"assistant","timestamp":"2026-09-10T10:00:0{index}Z","sessionId":"session-{index}","requestId":"r{index}-{line}","message":{{"id":"message-{index}-{line}","usage":{{"input_tokens":10,"output_tokens":2,"cache_read_input_tokens":3,"cache_creation_input_tokens":0}}}}}}"#,
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                        + "\n",
                )
                .unwrap();
            }
            let collect_options = options(&dir, Some(&src), &["collect"]);
            let mut ledger = aicharts_ledger::Ledger::open_with_identity(
                &dir,
                &aicharts_ledger::LedgerIdentity::SplitKeys {
                    checkpoint: &CHECKPOINT,
                    occurrence: &NAMESPACE,
                    namespace_version: 1,
                },
            )
            .unwrap();
            let before = ledger.status().unwrap().revision;
            let unix::CollectionOutcome {
                report,
                sources_skipped: skipped,
                ..
            } = unix::collect_with_limit(
                &mut ledger,
                &collect_options,
                &CHECKPOINT,
                &NAMESPACE,
                u64::MAX,
                u64::MAX,
                4,
            )
            .unwrap();
            assert_eq!(report.sources_updated, 5);
            assert_eq!(skipped, 0);
            assert_eq!(ledger.status().unwrap().revision - before, 3);
            // A single source denser than the whole budget still refuses
            // explicitly instead of partitioning mid-source.
            let dense = fixture.0.join("dense");
            std::fs::DirBuilder::new()
                .mode(0o700)
                .create(&dense)
                .unwrap();
            fs::write(
                dense.join("dense.jsonl"),
                (0..5)
                    .map(|line| {
                        format!(
                            r#"{{"type":"assistant","timestamp":"2026-09-10T11:00:0{line}Z","sessionId":"dense","requestId":"d{line}","message":{{"id":"dm{line}","usage":{{"input_tokens":1,"output_tokens":1,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}}}}"#,
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
                    + "\n",
            )
            .unwrap();
            let dense_options = options(&dir, Some(&dense), &["collect"]);
            assert_eq!(
                unix::collect_with_limit(
                    &mut ledger,
                    &dense_options,
                    &CHECKPOINT,
                    &NAMESPACE,
                    u64::MAX,
                    u64::MAX,
                    4,
                )
                .err(),
                Some("retained_measurement_limit")
            );
        }

        #[test]
        fn collect_discovers_sources_beyond_the_ephemeral_scan_bound() {
            let fixture = Fixture::new();
            let dir = fixture.create_state();
            unix::run_with_occurrence(options(&dir, None, &["init"]), &CHECKPOINT, Some(NAMESPACE))
                .unwrap();
            let src = fixture.0.join("src");
            std::fs::DirBuilder::new().mode(0o700).create(&src).unwrap();
            // Persistent collection must admit trees larger than the
            // ephemeral `usage` scan bound of 2,048 files; the wave file
            // bound then commits them across two atomic revisions.
            let count = crate::MAX_WAVE_FILES as usize + 2;
            for index in 0..count {
                fs::write(
                    src.join(format!("session-{index}.jsonl")),
                    format!(
                        r#"{{"type":"assistant","timestamp":"2026-09-10T10:00:00Z","sessionId":"session-{index}","requestId":"r{index}","message":{{"id":"message-{index}","usage":{{"input_tokens":10,"output_tokens":2,"cache_read_input_tokens":3,"cache_creation_input_tokens":0}}}}}}"#
                    ) + "\n",
                )
                .unwrap();
            }
            let collect_options = options(&dir, Some(&src), &["collect"]);
            let mut ledger = aicharts_ledger::Ledger::open_with_identity(
                &dir,
                &aicharts_ledger::LedgerIdentity::SplitKeys {
                    checkpoint: &CHECKPOINT,
                    occurrence: &NAMESPACE,
                    namespace_version: 1,
                },
            )
            .unwrap();
            let before = ledger.status().unwrap().revision;
            let unix::CollectionOutcome {
                report,
                sources_skipped: skipped,
                ..
            } = unix::collect_with_limit(
                &mut ledger,
                &collect_options,
                &CHECKPOINT,
                &NAMESPACE,
                u64::MAX,
                crate::MAX_WAVE_FILES,
                usize::MAX,
            )
            .unwrap();
            assert_eq!(report.sources_updated, count as u64);
            assert_eq!(skipped, 0);
            assert_eq!(ledger.status().unwrap().revision - before, 2);
        }

        #[test]
        fn devin_whole_documents_collect_in_both_modes_without_a_tail_marker() {
            let fixture = Fixture::new();
            let source = fixture.write_devin_source();
            // Snapshot mode.
            let dir = fixture.create_state();
            unix::run_with_occurrence(options(&dir, None, &["init"]), &CHECKPOINT, Some(NAMESPACE))
                .unwrap();
            let out = unix::run_with_occurrence(
                options_as(&dir, "--devin", Some(&source), &["collect"]),
                &CHECKPOINT,
                Some(NAMESPACE),
            )
            .unwrap();
            assert!(out.contains("pending records: 1"), "{out}");
            // Completed-prefix mode needs its own ledger generation.
            let fixture = Fixture::new();
            let source = fixture.write_devin_source();
            let dir = fixture.create_state();
            unix::run_with_occurrence(options(&dir, None, &["init"]), &CHECKPOINT, Some(NAMESPACE))
                .unwrap();
            let out = unix::run_with_occurrence(
                options(&dir, None, &["prefix-enable", "--revision", "0"]),
                &CHECKPOINT,
                Some(NAMESPACE),
            )
            .unwrap();
            assert!(out.contains("Completed-prefix collection enabled"), "{out}");
            let out = unix::run_with_occurrence(
                options_as(&dir, "--devin", Some(&source), &["collect-prefix"]),
                &CHECKPOINT,
                Some(NAMESPACE),
            )
            .unwrap();
            assert!(out.contains("pending records: 1"), "{out}");
            // A replaced document is new history, never an append: the
            // unchanged witness replays; an edited one refuses.
            let edited = source.join("session.json");
            let original = fs::read_to_string(&edited).unwrap();
            fs::write(&edited, original.replace("atif-1", "atif-2")).unwrap();
            assert_eq!(
                unix::run_with_occurrence(
                    options_as(&dir, "--devin", Some(&source), &["collect-prefix"]),
                    &CHECKPOINT,
                    Some(NAMESPACE),
                )
                .err(),
                Some("source_history_changed")
            );
        }

        #[test]
        fn unenrolled_dir_keeps_legacy_flow_and_rejects_split_identity() {
            let fixture = Fixture::new();
            let dir = fixture.state();
            let out = unix::run_with_occurrence(options(&dir, None, &["init"]), &CHECKPOINT, None);
            assert_eq!(
                out.unwrap(),
                "Private local ledger initialized. No sources read; nothing uploaded.\n"
            );
            fixture.write_source();
            let out = unix::run_with_occurrence(
                options(&dir, Some(&fixture.0.join("src")), &["collect"]),
                &CHECKPOINT,
                None,
            )
            .unwrap();
            assert!(out.contains("pending records: 1"), "{out}");
            let out = unix::run_with_occurrence(
                options(&dir, None, &["outbox", "--dry-run"]),
                &CHECKPOINT,
                None,
            )
            .unwrap();
            // Legacy ids derive under the checkpoint key itself.
            assert!(out.contains(&hex_id(&fixture.0, None)), "{out}");
            // A split identity on the legacy ledger refuses closed.
            assert_eq!(
                unix::run_with_occurrence(
                    options(&dir, None, &["status"]),
                    &CHECKPOINT,
                    Some(NAMESPACE),
                )
                .err(),
                Some("ledger_namespace_mismatch")
            );
        }

        #[test]
        fn interrupted_enrollment_layout_refuses_through_the_full_run_path() {
            let fixture = Fixture::new();
            let dir = fixture.create_state();
            std::fs::DirBuilder::new()
                .mode(0o700)
                .create(dir.join("enrollment-attempt-v1"))
                .unwrap();
            // `run` reads the real key file before resolution.
            let key = fixture.0.join("key");
            {
                use std::io::Write;
                use std::os::unix::fs::OpenOptionsExt;
                fs::OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .mode(0o600)
                    .open(&key)
                    .unwrap()
                    .write_all(&CHECKPOINT)
                    .unwrap();
            }
            let result = unix::run(
                parse_options(&args(&[
                    "status",
                    "--state-dir",
                    &dir.to_string_lossy(),
                    "--key-file",
                    &key.to_string_lossy(),
                ]))
                .unwrap(),
            );
            #[cfg(target_os = "macos")]
            assert_eq!(result.err(), Some("attempt_recovery_required"));
            #[cfg(not(target_os = "macos"))]
            assert_eq!(
                result.err(),
                Some("persistent_state_requires_qualified_macos_custody")
            );
        }
    }
}
