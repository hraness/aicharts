//! AI Charts' fail-closed, local-only import boundary. This is an application
//! guard, not an operating-system sandbox. A single call owns this context;
//! Rayon workers share it so a thread-local diagnostic cannot miss failures.
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, Metadata};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime};

pub const MAX_FILES: usize = 65_536;
pub const MAX_BYTES: u64 = 128 * 1024 * 1024 * 1024;
pub const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub(crate) const MAX_LINE_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_SQLITE_BYTES: u64 = 64 * 1024 * 1024 * 1024;
pub const MAX_ROWS: usize = 2_000_000;
const MAX_ENTRIES: usize = 262_144;
const AUDIT_BASE_SECS: u64 = 120;
const AUDIT_MAX_SECS: u64 = 1800;
const SQLITE_SCAN_MIN_SECS: u64 = 60;
const SQLITE_SCAN_MAX_SECS: u64 = 600;
// A leaf-page scan over an unindexed column costs in proportion to the store's
// admitted size; 32 MiB/s is a conservative sequential-read floor so ordinary
// disk contention still fits inside the bounded deadline.
const SQLITE_SCAN_BYTES_PER_SEC: u64 = 32 * 1024 * 1024;
static SERIAL: Mutex<()> = Mutex::new(());
static ACTIVE: Mutex<Option<Audit>> = Mutex::new(None);
static CAPTURE: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, PartialEq, Eq)]
struct Stamp {
    bytes: u64,
    modified: Option<SystemTime>,
    directory: bool,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}
impl Stamp {
    fn of(m: &Metadata) -> Self {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        Self {
            bytes: m.len(),
            modified: m.modified().ok(),
            directory: m.is_dir(),
            #[cfg(unix)]
            identity: (m.dev(), m.ino(), m.ctime(), m.ctime_nsec()),
        }
    }
}
struct Snapshot {
    path: tempfile::TempPath,
    source: Stamp,
    source_bytes: u64,
    parsed_bytes: u64,
    digest: Option<[u8; 32]>,
    deferred_tail: Vec<u8>,
}
fn same_identity(left: &Stamp, right: &Stamp) -> bool {
    #[cfg(unix)]
    {
        left.directory == right.directory
            && left.identity.0 == right.identity.0
            && left.identity.1 == right.identity.1
    }
    #[cfg(not(unix))]
    {
        left == right
    }
}
fn sqlite_like(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    name.ends_with(".db")
        || name.ends_with(".sqlite")
        || name.ends_with(".sqlite3")
        || name.ends_with("-wal")
        || name.ends_with("-shm")
        || name.ends_with("-journal")
}
fn append_log(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|s| s.to_str()),
        Some("jsonl" | "ndjson")
    )
}
struct Audit {
    work: ImportWork,
    checkpoint: Option<crate::offline_checkpoint::OfflineCheckpoint>,
    next_checkpoint: crate::offline_checkpoint::OfflineCheckpoint,
    roots: Vec<PathBuf>,
    first_observed_ms: Option<u64>,
    profile: Option<(String, Vec<PathBuf>)>,
    files: BTreeMap<PathBuf, Stamp>,
    missing: BTreeSet<PathBuf>,
    snapshots: BTreeMap<PathBuf, Arc<Snapshot>>,
    capture_directory: Option<tempfile::TempDir>,
    sqlite_sources: BTreeMap<PathBuf, PathBuf>,
    deferred_tail_files: usize,
    errors: BTreeSet<&'static str>,
    bytes: u64,
    rows: usize,
    entries: usize,
    sqlite_opened: BTreeSet<PathBuf>,
    sqlite_completed: BTreeSet<PathBuf>,
    sqlite_budget_secs: u64,
    started: std::time::Instant,
}

fn sqlite_scan_budget(bytes: u64) -> Duration {
    Duration::from_secs(
        (bytes / SQLITE_SCAN_BYTES_PER_SEC).clamp(SQLITE_SCAN_MIN_SECS, SQLITE_SCAN_MAX_SECS),
    )
}
/// The overall deadline is the fixed base plus headroom for every admitted
/// SQLite source's scaled scan budget, never exceeding AUDIT_MAX_SECS.
fn audit_time_limit(a: &Audit) -> Duration {
    Duration::from_secs(AUDIT_BASE_SECS)
        .max(Duration::from_secs(a.sqlite_budget_secs.saturating_add(60)))
        .min(Duration::from_secs(AUDIT_MAX_SECS))
}

/// Counts and static reason codes only: source paths and contents stay local.
#[derive(Debug, Clone, Default)]
pub struct ReadReceipt {
    pub files: usize,
    pub bytes: u64,
    pub observations: usize,
    /// Files whose captured final line is not yet a complete JSON value.
    pub deferred_tail_files: usize,
}

/// Observed work, separate from logical source size. SQLite page I/O is not
/// included in parsed_bytes; callers must preserve that qualification limit.
#[derive(Clone, Debug, Default)]
pub struct ImportWork {
    pub parsed_bytes: u64,
    pub verified_bytes: u64,
    pub reused_files: u64,
    pub clamped_records: u64,
    pub fallback_records: u64,
    pub schema_mismatch_records: u64,
    pub checkpoint_capacity: bool,
}

pub struct Guard {
    _serial: MutexGuard<'static, ()>,
}
pub fn begin(roots: &[PathBuf]) -> Result<Guard, &'static str> {
    let serial = SERIAL.lock().map_err(|_| "import_guard_poisoned")?;
    if roots.is_empty() || roots.len() > 128 {
        return Err("import_roots_invalid");
    }
    let mut checked = Vec::new();
    for root in roots {
        check_components(root).map_err(|_| "import_root_not_regular")?;
        if !fs::metadata(root)
            .map_err(|_| "import_root_unavailable")?
            .is_dir()
        {
            return Err("import_root_not_directory");
        }
        checked.push(root.clone());
    }
    *ACTIVE.lock().map_err(|_| "import_guard_poisoned")? = Some(Audit {
        work: ImportWork::default(),
        checkpoint: None,
        next_checkpoint: crate::offline_checkpoint::OfflineCheckpoint::default(),
        roots: checked,
        first_observed_ms: None,
        profile: None,
        files: BTreeMap::new(),
        missing: BTreeSet::new(),
        snapshots: BTreeMap::new(),
        capture_directory: None,
        sqlite_sources: BTreeMap::new(),
        deferred_tail_files: 0,
        errors: BTreeSet::new(),
        bytes: 0,
        rows: 0,
        entries: 0,
        sqlite_opened: BTreeSet::new(),
        sqlite_completed: BTreeSet::new(),
        sqlite_budget_secs: 0,
        started: std::time::Instant::now(),
    });
    Ok(Guard { _serial: serial })
}
impl Guard {
    #[cfg(test)]
    pub fn finish(self) -> Result<ReadReceipt, Vec<&'static str>> {
        self.finish_observed().0
    }
    pub(crate) fn finish_observed(
        self,
    ) -> (
        Result<ReadReceipt, Vec<&'static str>>,
        ImportWork,
        crate::offline_checkpoint::OfflineCheckpoint,
    ) {
        let mut active = ACTIVE.lock().unwrap_or_else(|p| p.into_inner());
        let mut audit = active.take().expect("owned import guard");
        let limit = audit_time_limit(&audit);
        if audit.started.elapsed() > limit {
            audit.errors.insert("import_time_limit");
        }
        // Captures are per-file snapshots, not a global filesystem transaction.
        // Verify every consumed log prefix in full; later appends are harmless.
        for (path, before) in &audit.files {
            if let Some(snapshot) = audit.snapshots.get(path) {
                match verify_snapshot(path, snapshot, audit.started, limit) {
                    Ok(bytes) => audit.work.verified_bytes += bytes,
                    Err(code) => {
                        audit.errors.insert(code);
                    }
                }
                continue;
            }
            let sqlite = audit.sqlite_sources.get(path);
            match fs::symlink_metadata(path) {
                Ok(m)
                    if !m.file_type().is_symlink()
                        && ((before.directory || sqlite.is_some())
                            && same_identity(before, &Stamp::of(&m))
                            || Stamp::of(&m) == *before) => {}
                // SQLite owns WAL/journal lifetimes. A completed read transaction
                // remains valid after the writer checkpoints/deletes its sidecar.
                Err(e)
                    if e.kind() == io::ErrorKind::NotFound
                        && sqlite.is_some_and(|db| {
                            db != path && audit.sqlite_completed.contains(db)
                        }) => {}
                _ => {
                    audit.errors.insert("import_source_changed");
                }
            }
        }
        for path in &audit.missing {
            if !audit.sqlite_sources.contains_key(path) && fs::symlink_metadata(path).is_ok() {
                audit.errors.insert("import_source_changed");
            }
        }
        if audit.started.elapsed() > limit {
            audit.errors.insert("import_time_limit");
        }
        if !audit.sqlite_opened.is_subset(&audit.sqlite_completed) {
            audit.errors.insert("import_sqlite_schema_unreadable");
        }
        let result = if audit.errors.is_empty() {
            Ok(ReadReceipt {
                files: audit.files.values().filter(|s| !s.directory).count(),
                bytes: audit.bytes,
                observations: audit.rows,
                deferred_tail_files: audit.deferred_tail_files,
            })
        } else {
            Err(audit.errors.into_iter().collect())
        };
        (result, audit.work, audit.next_checkpoint)
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        *ACTIVE.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }
}
pub(crate) fn set_first_observed_ms(value: Option<u64>) {
    if let Some(a) = ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        a.first_observed_ms = value;
    }
}
pub(crate) fn first_observed_ms() -> Option<u64> {
    ACTIVE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_ref()
        .and_then(|a| a.first_observed_ms)
}

pub(crate) fn active() -> bool {
    ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).is_some()
}
pub(crate) fn set_checkpoint(checkpoint: crate::offline_checkpoint::OfflineCheckpoint) {
    if let Some(audit) = ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        audit.checkpoint = Some(checkpoint);
    }
}
pub(crate) fn checkpoint_enabled() -> bool {
    ACTIVE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_ref()
        .is_some_and(|a| a.checkpoint.is_some())
}
pub(crate) fn checkpoint_entry(path: &Path) -> Option<crate::offline_checkpoint::Entry> {
    ACTIVE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_mut()?
        .checkpoint
        .as_mut()?
        .entries
        .remove(path)
}
pub(crate) fn save_checkpoint_entry(path: &Path, entry: crate::offline_checkpoint::Entry) {
    if let Some(audit) = ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        audit
            .next_checkpoint
            .entries
            .insert(path.to_path_buf(), entry);
    }
}
pub(crate) fn reused_file() {
    if let Some(audit) = ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        audit.work.reused_files += 1;
    }
}
pub(crate) fn checkpoint_capacity() {
    if let Some(audit) = ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        audit.work.checkpoint_capacity = true;
    }
}
pub(crate) fn codex_diagnostics(state: &crate::sessions::codex::CodexParseState) {
    if let Some(audit) = ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        audit.work.clamped_records += state.audit_clamped_records;
        audit.work.fallback_records += state.audit_fallback_records;
        audit.work.schema_mismatch_records += state.audit_schema_mismatch_records;
    }
}
#[derive(Clone)]
pub(crate) struct LogWitness {
    pub identity: (u64, u64),
    pub bytes: u64,
    pub digest: [u8; 32],
    pub complete_digest: [u8; 32],
}
/// Hash the complete consumed prefix of the same immutable capture used by
/// the parser. Source identity and hash are never assembled from a later path
/// reopen. Guard::finish still validates that capture against the source.
pub(crate) fn log_witness(path: &Path, prefix: Option<u64>) -> io::Result<LogWitness> {
    let captured = snapshot(path).inspect_err(snapshot_failure)?;
    let amount = prefix.unwrap_or(captured.parsed_bytes);
    if amount > captured.parsed_bytes {
        // Truncation is an ordinary replay trigger, not a poisoned import.
        return Err(io::Error::other("import_checkpoint_prefix_changed"));
    }
    let mut file = open_regular(&captured.path)?;
    let mut digest = Sha256::new();
    let mut remaining = captured.parsed_bytes;
    let mut at = 0u64;
    let mut prefix_digest = if amount == 0 {
        Some(<[u8; 32]>::from(Sha256::digest([])))
    } else {
        None
    };
    let mut buffer = [0u8; 65_536];
    while remaining > 0 {
        let until_prefix = if at < amount { amount - at } else { remaining };
        let count = buffer.len().min(remaining.min(until_prefix) as usize);
        file.read_exact(&mut buffer[..count])?;
        digest.update(&buffer[..count]);
        remaining -= count as u64;
        at += count as u64;
        if at == amount {
            prefix_digest = Some(digest.clone().finalize().into());
        }
        let mut active = ACTIVE.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(audit) = active.as_mut() {
            audit.work.verified_bytes += count as u64;
            if audit.started.elapsed() > audit_time_limit(audit) {
                audit.errors.insert("import_time_limit");
                return Err(io::Error::other("import_time_limit"));
            }
        }
    }
    #[cfg(unix)]
    let identity = (captured.source.identity.0, captured.source.identity.1);
    #[cfg(not(unix))]
    let identity = (0, 0);
    Ok(LogWitness {
        identity,
        bytes: captured.parsed_bytes,
        digest: prefix_digest.expect("hashed requested prefix"),
        complete_digest: digest.finalize().into(),
    })
}
pub(crate) fn fault(code: &'static str) {
    if let Some(a) = ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        a.errors.insert(code);
    }
}
fn error(code: &'static str) -> io::Error {
    fault(code);
    io::Error::other(code)
}
fn check_components(path: &Path) -> io::Result<()> {
    if !path.is_absolute() {
        return Err(io::Error::other("relative_source_path"));
    }
    let mut cursor = PathBuf::new();
    for part in path.components() {
        if matches!(part, Component::ParentDir | Component::CurDir) {
            return Err(io::Error::other("ambiguous_source_path"));
        }
        cursor.push(part.as_os_str());
        match fs::symlink_metadata(&cursor) {
            Ok(m) if m.file_type().is_symlink() => {
                return Err(io::Error::other("symlink_source_path"))
            }
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => break,
            Err(e) => return Err(e),
        }
    }
    Ok(())
}
/// Admit a source or directory before opening it. Missing optional companions
/// are recorded so their appearance during a scan cannot change its meaning.
pub(crate) fn admit(path: &Path) -> io::Result<()> {
    let mut state = ACTIVE.lock().unwrap_or_else(|p| p.into_inner());
    let Some(a) = state.as_mut() else {
        return Ok(());
    };
    let fail = |a: &mut Audit, code| {
        a.errors.insert(code);
        io::Error::other(code)
    };
    if a.started.elapsed() > audit_time_limit(a) {
        return Err(fail(a, "import_time_limit"));
    }
    if !a.roots.iter().any(|root| path.starts_with(root)) {
        // Uninstalled default roots are not source reads. Existing paths outside
        // the explicit allowlist remain a hard failure, including project links.
        if fs::symlink_metadata(path).is_err_and(|e| e.kind() == io::ErrorKind::NotFound) {
            return Err(io::Error::from(io::ErrorKind::NotFound));
        }
        return Err(fail(a, "import_root_denied"));
    }
    if check_components(path).is_err() {
        return Err(fail(a, "import_symlink_or_path_invalid"));
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            if a.missing.len() >= MAX_ENTRIES {
                return Err(fail(a, "import_entry_limit"));
            }
            a.missing.insert(path.to_path_buf());
            return Err(e);
        }
        Err(_) => return Err(fail(a, "import_source_unreadable")),
    };
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(fail(a, "import_special_file_denied"));
    }
    if metadata.is_file() {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let sqlite = name.ends_with(".db")
            || name.ends_with(".sqlite")
            || name.ends_with(".sqlite3")
            || name.ends_with("-wal")
            || name.ends_with("-shm");
        let limit = if sqlite {
            MAX_SQLITE_BYTES
        } else if append_log(path) {
            MAX_LOG_BYTES
        } else {
            MAX_FILE_BYTES
        };
        if metadata.len() > limit {
            return Err(fail(a, "import_file_limit"));
        }
    }
    let stamp = Stamp::of(&metadata);
    if let Some(before) = a.files.get(path) {
        let allowed_live_change = same_identity(before, &stamp)
            && (stamp.directory
                || a.sqlite_sources.contains_key(path)
                || sqlite_like(path)
                || (append_log(path) && stamp.bytes >= before.bytes));
        if *before != stamp && !allowed_live_change {
            return Err(fail(a, "import_source_changed"));
        }
    } else {
        if a.files.len() >= MAX_FILES {
            return Err(fail(a, "import_file_count_limit"));
        }
        if metadata.is_file() {
            a.bytes = a.bytes.saturating_add(metadata.len());
            if a.bytes > MAX_BYTES {
                return Err(fail(a, "import_total_byte_limit"));
            }
        }
        a.files.insert(path.to_path_buf(), stamp);
    }
    Ok(())
}
pub(crate) fn entry(path: &Path) -> bool {
    {
        let mut state = ACTIVE.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(a) = state.as_mut() {
            a.entries += 1;
            if a.entries > MAX_ENTRIES {
                a.errors.insert("import_entry_limit");
                return false;
            }
        }
    }
    admit(path).is_ok()
}
pub(crate) fn observe_row() {
    let exceeded = {
        let mut state = ACTIVE.lock().unwrap_or_else(|p| p.into_inner());
        state.as_mut().is_some_and(|a| {
            a.rows += 1;
            if a.started.elapsed() > audit_time_limit(a) {
                a.errors.insert("import_time_limit");
                true
            } else if a.rows > MAX_ROWS {
                a.errors.insert("import_row_limit");
                true
            } else {
                false
            }
        })
    };
    // Cancel a parser before it can allocate additional output. resume_unwind
    // skips the process panic hook, keeping private records out of diagnostics.
    if exceeded {
        std::panic::resume_unwind(Box::new("import_row_limit"));
    }
}
pub(crate) struct ReadFile {
    file: File,
    // Keep the private file alive while this descriptor is being consumed.
    _snapshot: Option<Arc<Snapshot>>,
    read_bytes: u64,
    limit: u64,
}
impl ReadFile {
    pub(crate) fn metadata(&self) -> io::Result<Metadata> {
        self.file.metadata()
    }
}
impl Read for ReadFile {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.read_bytes > self.limit {
            return Err(error("import_file_limit"));
        }
        let amount = buf.len().min((self.limit + 1 - self.read_bytes) as usize);
        let read = self
            .file
            .read(&mut buf[..amount])
            .map_err(|_| error("import_read_failed"))?;
        self.read_bytes += read as u64;
        if let Some(audit) = ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
            audit.work.parsed_bytes += read as u64;
        }
        if self.read_bytes > self.limit {
            return Err(error("import_file_limit"));
        }
        Ok(read)
    }
}
impl Seek for ReadFile {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.file
            .seek(position)
            .map_err(|_| error("import_read_failed"))
    }
}
fn open_regular(path: &Path) -> io::Result<File> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(io::Error::other("import_special_file_denied"));
    }
    check_components(path)?;
    if !same_identity(
        &Stamp::of(&metadata),
        &Stamp::of(&fs::symlink_metadata(path)?),
    ) {
        return Err(io::Error::other("import_source_changed"));
    }
    Ok(file)
}
fn verify_snapshot(
    path: &Path,
    snapshot: &Snapshot,
    started: std::time::Instant,
    limit: Duration,
) -> Result<u64, &'static str> {
    let mut source = open_regular(path).map_err(|_| "import_source_changed")?;
    let before = Stamp::of(&source.metadata().map_err(|_| "import_source_changed")?);
    if !same_identity(&before, &snapshot.source) || before.bytes < snapshot.source_bytes {
        return Err("import_source_changed");
    }
    if snapshot.digest.is_none()
        && before == snapshot.source
        && before.bytes == snapshot.source_bytes
    {
        return Ok(0);
    }
    let mut hash = Sha256::new();
    let mut remaining = snapshot.source_bytes;
    let mut buffer = [0u8; 65536];
    while remaining > 0 {
        if started.elapsed() > limit {
            return Err("import_time_limit");
        }
        let amount = buffer.len().min(remaining as usize);
        source
            .read_exact(&mut buffer[..amount])
            .map_err(|_| "import_source_changed")?;
        hash.update(&buffer[..amount]);
        remaining -= amount as u64;
    }
    let expected = if let Some(digest) = snapshot.digest {
        digest
    } else {
        let mut captured = open_regular(&snapshot.path).map_err(|_| "import_snapshot_changed")?;
        let mut expected = Sha256::new();
        let mut remaining = snapshot.parsed_bytes;
        while remaining > 0 {
            if started.elapsed() > limit {
                return Err("import_time_limit");
            }
            let amount = buffer.len().min(remaining as usize);
            captured
                .read_exact(&mut buffer[..amount])
                .map_err(|_| "import_snapshot_changed")?;
            expected.update(&buffer[..amount]);
            remaining -= amount as u64;
        }
        expected.update(&snapshot.deferred_tail);
        expected.finalize().into()
    };
    let after = Stamp::of(&source.metadata().map_err(|_| "import_source_changed")?);
    if !same_identity(&after, &snapshot.source)
        || after.bytes < snapshot.source_bytes
        || <[u8; 32]>::from(hash.finalize()) != expected
    {
        return Err("import_source_changed");
    }
    Ok(snapshot.source_bytes
        + if snapshot.digest.is_none() {
            snapshot.parsed_bytes
        } else {
            0
        })
}
fn snapshot(path: &Path) -> io::Result<Arc<Snapshot>> {
    // Serialize creation, not parsing. Every subsequent open shares exactly the
    // same immutable bytes even when two parser lanes request the same source.
    let _capture = CAPTURE.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(snapshot) = ACTIVE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_ref()
        .and_then(|a| a.snapshots.get(path).cloned())
    {
        return Ok(snapshot);
    }
    admit(path)?;
    let (started, limit) = ACTIVE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_ref()
        .map(|a| (a.started, audit_time_limit(a)))
        .expect("active snapshot");
    let mut source = open_regular(path).map_err(|_| error("import_source_unreadable"))?;
    let source_metadata = source.metadata()?;
    let stamp = Stamp::of(&source_metadata);
    if stamp.bytes > MAX_LOG_BYTES {
        return Err(error("import_file_limit"));
    }
    // tempfile creates a private, automatically removed file; no source cache,
    // auth material, or reusable transcript copy is written under Tokscale.
    let directory = {
        let mut state = ACTIVE.lock().unwrap_or_else(|p| p.into_inner());
        let audit = state.as_mut().expect("active snapshot");
        if audit.capture_directory.is_none() {
            // Builder defaults are restrictive; set mode explicitly on Unix.
            let mut builder = tempfile::Builder::new();
            builder.prefix("aicharts-import-");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                builder.permissions(fs::Permissions::from_mode(0o700));
            }
            audit.capture_directory = Some(
                builder
                    .tempdir()
                    .map_err(|_| io::Error::other("import_snapshot_unavailable"))?,
            );
        }
        fs::canonicalize(
            audit
                .capture_directory
                .as_ref()
                .expect("capture directory")
                .path(),
        )?
    };
    let cloned = crate::offline_clone::capture(&source, &directory)
        .map_err(|_| error("import_snapshot_unavailable"))?;
    let (mut captured, digest, source_bytes) = if let Some(captured) = cloned {
        let bytes = captured
            .as_file()
            .metadata()
            .map_err(|_| error("import_snapshot_unavailable"))?
            .len();
        if bytes > MAX_LOG_BYTES {
            return Err(error("import_file_limit"));
        }
        if bytes < stamp.bytes {
            return Err(error("import_source_changed"));
        }
        (captured, None, bytes)
    } else {
        // Leave room for the operating system and concurrent writers. Refuse
        // before allocating a full fallback copy when space is insufficient.
        if fs2::available_space(&directory).map_err(|_| error("import_snapshot_unavailable"))?
            < stamp.bytes.saturating_add(2 * 1024 * 1024 * 1024)
        {
            return Err(error("import_snapshot_space_limit"));
        }
        let mut captured = tempfile::NamedTempFile::new_in(&directory)
            .map_err(|_| error("import_snapshot_unavailable"))?;
        let mut hash = Sha256::new();
        let mut remaining = stamp.bytes;
        let mut buffer = [0u8; 65536];
        while remaining > 0 {
            if started.elapsed() > limit {
                return Err(error("import_time_limit"));
            }
            let amount = buffer.len().min(remaining as usize);
            source
                .read_exact(&mut buffer[..amount])
                .map_err(|_| error("import_source_changed"))?;
            hash.update(&buffer[..amount]);
            captured
                .write_all(&buffer[..amount])
                .map_err(|_| error("import_snapshot_unavailable"))?;
            remaining -= amount as u64;
        }
        (captured, Some(hash.finalize().into()), stamp.bytes)
    };
    // Find only the final line. A cloned 2 GiB log must not be read in full
    // merely to decide whether its writer has completed the last JSON value.
    let mut last_newline = source_bytes;
    let mut block = [0u8; 65536];
    while last_newline > 0 {
        let amount = last_newline.min(block.len() as u64) as usize;
        let start = last_newline - amount as u64;
        captured
            .seek(SeekFrom::Start(start))
            .map_err(|_| error("import_snapshot_unavailable"))?;
        captured
            .read_exact(&mut block[..amount])
            .map_err(|_| error("import_snapshot_unavailable"))?;
        if let Some(index) = block[..amount].iter().rposition(|b| *b == b'\n') {
            last_newline = start + index as u64 + 1;
            break;
        }
        last_newline = start;
        if source_bytes - last_newline > MAX_LINE_BYTES as u64 {
            return Err(error("import_line_limit"));
        }
    }
    if source_bytes - last_newline > MAX_LINE_BYTES as u64 {
        return Err(error("import_line_limit"));
    }
    captured
        .seek(SeekFrom::Start(last_newline))
        .map_err(|_| error("import_snapshot_unavailable"))?;
    let mut tail = Vec::new();
    captured
        .read_to_end(&mut tail)
        .map_err(|_| error("import_snapshot_unavailable"))?;
    let tail_offset = 0;
    let mut parsed_bytes = source_bytes;
    let mut deferred_tail = Vec::new();
    if source_bytes - last_newline > MAX_LINE_BYTES as u64 {
        return Err(error("import_line_limit"));
    }
    if !tail[tail_offset..].iter().all(u8::is_ascii_whitespace) {
        match serde_json::from_slice::<serde::de::IgnoredAny>(&tail[tail_offset..]) {
            Ok(_) => {}
            Err(failure) if failure.is_eof() => {
                parsed_bytes = last_newline;
                deferred_tail.extend_from_slice(&tail[tail_offset..]);
            }
            Err(_) => return Err(error("import_json_invalid")),
        }
    }
    captured
        .as_file()
        .set_len(parsed_bytes)
        .map_err(|_| error("import_snapshot_unavailable"))?;
    if let Some(modified) = stamp.modified {
        captured
            .as_file()
            .set_times(fs::FileTimes::new().set_modified(modified))?;
    }
    let snapshot = Arc::new(Snapshot {
        path: captured.into_temp_path(),
        source: stamp.clone(),
        source_bytes,
        parsed_bytes,
        digest,
        deferred_tail,
    });
    if let Some(a) = ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        let observed = a.files.get(path).map_or(0, |s| s.bytes);
        a.bytes = a
            .bytes
            .saturating_add(source_bytes.saturating_sub(observed));
        if a.bytes > MAX_BYTES {
            a.errors.insert("import_total_byte_limit");
            return Err(io::Error::other("import_total_byte_limit"));
        }
        if parsed_bytes < source_bytes {
            a.deferred_tail_files += 1;
        }
        a.snapshots
            .insert(path.to_path_buf(), Arc::clone(&snapshot));
    }
    Ok(snapshot)
}
fn snapshot_failure(failure: &io::Error) {
    // Missing optional parents are recorded by admit(). If a previously read
    // source disappears, finish() still refuses the changed source.
    if failure.kind() != io::ErrorKind::NotFound {
        fault("import_snapshot_failed");
    }
}
pub(crate) fn metadata(path: &Path) -> io::Result<Metadata> {
    if active() && append_log(path) {
        return fs::metadata(&snapshot(path).inspect_err(snapshot_failure)?.path);
    }
    fs::metadata(path)
}
pub(crate) fn open(path: impl AsRef<Path>) -> io::Result<ReadFile> {
    let path = path.as_ref();
    if active() && append_log(path) {
        let snapshot = snapshot(path).inspect_err(snapshot_failure)?;
        let file = open_regular(&snapshot.path).map_err(|_| error("import_snapshot_failed"))?;
        if file.metadata()?.len() != snapshot.parsed_bytes {
            return Err(error("import_snapshot_changed"));
        }
        return Ok(ReadFile {
            file,
            _snapshot: Some(snapshot),
            read_bytes: 0,
            limit: MAX_LOG_BYTES,
        });
    }
    let file = if active() {
        admit(path)?;
        open_regular(path).map_err(|_| error("import_source_unreadable"))?
    } else {
        File::open(path)?
    };
    Ok(ReadFile {
        file,
        _snapshot: None,
        read_bytes: 0,
        limit: if append_log(path) {
            MAX_LOG_BYTES
        } else {
            MAX_FILE_BYTES
        },
    })
}
pub(crate) fn read(path: impl AsRef<Path>) -> io::Result<Vec<u8>> {
    let mut data = Vec::new();
    open(path)?
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|_| error("import_read_failed"))?;
    if data.len() as u64 > MAX_FILE_BYTES {
        return Err(error("import_file_limit"));
    }
    Ok(data)
}
pub(crate) fn read_to_string(path: impl AsRef<Path>) -> io::Result<String> {
    String::from_utf8(read(path)?).map_err(|_| error("import_invalid_utf8"))
}
pub(crate) fn read_dir(
    path: impl AsRef<Path>,
) -> io::Result<std::vec::IntoIter<io::Result<fs::DirEntry>>> {
    admit(path.as_ref())?;
    let mut entries = Vec::new();
    for item in fs::read_dir(path).map_err(|_| error("import_directory_unreadable"))? {
        match item {
            Ok(item) if entry(&item.path()) => entries.push(Ok(item)),
            Ok(_) => break,
            Err(_) => return Err(error("import_directory_unreadable")),
        }
    }
    Ok(entries.into_iter())
}
pub(crate) fn json_str<'a, T: serde::Deserialize<'a>>(s: &'a str) -> serde_json::Result<T> {
    let result = serde_json::from_str(s);
    if let Err(e) = &result {
        if !e.is_data() {
            fault("import_json_invalid");
        }
    }
    result
}
pub(crate) fn json_slice<'a, T: serde::Deserialize<'a>>(s: &'a [u8]) -> serde_json::Result<T> {
    let result = serde_json::from_slice(s);
    if let Err(e) = &result {
        if !e.is_data() {
            fault("import_json_invalid");
        }
    }
    result
}
pub(crate) fn simd_slice<'a, T: serde::Deserialize<'a>>(
    s: &'a mut [u8],
) -> Result<T, simd_json::Error> {
    let mut deserializer =
        simd_json::Deserializer::from_slice(s).inspect_err(|_| fault("import_json_invalid"))?;
    T::deserialize(&mut deserializer)
}
pub(crate) fn sqlite(path: &Path) -> rusqlite::Result<rusqlite::Connection> {
    if let Some(a) = ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        a.sqlite_sources
            .insert(path.to_path_buf(), path.to_path_buf());
        for suffix in ["-wal", "-shm", "-journal"] {
            let mut sidecar = path.as_os_str().to_os_string();
            sidecar.push(suffix);
            a.sqlite_sources
                .insert(PathBuf::from(sidecar), path.to_path_buf());
        }
    }
    admit(path).map_err(|_| rusqlite::Error::InvalidPath(PathBuf::new()))?;
    let mut source_bytes = fs::symlink_metadata(path).map(|m| m.len()).unwrap_or(0);
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut sidecar = path.as_os_str().to_os_string();
        sidecar.push(suffix);
        let sidecar = PathBuf::from(sidecar);
        match admit(&sidecar) {
            Ok(()) => {
                source_bytes = source_bytes
                    .saturating_add(fs::symlink_metadata(&sidecar).map(|m| m.len()).unwrap_or(0));
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err(rusqlite::Error::InvalidPath(PathBuf::new())),
        }
    }
    // An unindexed column filter must leaf-scan the whole store, so the
    // cooperative deadline scales with admitted size instead of a fixed 60 s.
    let scan_budget = sqlite_scan_budget(source_bytes);
    if let Some(a) = ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        a.sqlite_budget_secs = a
            .sqlite_budget_secs
            .saturating_add(scan_budget.as_secs())
            .min(AUDIT_MAX_SECS.saturating_sub(60));
    }
    let conn = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .inspect_err(|_| fault("import_sqlite_open_failed"))?;
    if let Some(a) = ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        a.sqlite_opened.insert(path.to_path_buf());
    }
    conn.busy_timeout(Duration::from_millis(100))?;
    conn.set_limit(
        rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH,
        256 * 1024 * 1024,
    )?;
    conn.pragma_update(None, "query_only", true)?;
    let started = std::time::Instant::now();
    conn.progress_handler(
        10_000,
        Some(move || {
            let stop = started.elapsed() > scan_budget;
            if stop {
                fault("import_sqlite_time_limit");
            }
            stop
        }),
    )?;
    if active() {
        conn.execute_batch("BEGIN DEFERRED; SELECT count(*) FROM sqlite_schema;")
            .inspect_err(|_| fault("import_sqlite_snapshot_failed"))?;
        admit(path).map_err(|_| rusqlite::Error::InvalidPath(PathBuf::new()))?;
    }
    Ok(conn)
}
pub(crate) fn sqlite_completed(path: &Path) {
    if let Some(a) = ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        a.sqlite_completed.insert(path.to_path_buf());
    }
}

pub(crate) fn set_profile(client: &str, roots: &[PathBuf]) {
    if let Some(a) = ACTIVE.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        // The caller admitted every root against the original allowlist first.
        // Companion metadata must remain inside these exclusive source stores.
        a.roots = roots.to_vec();
        a.profile = Some((client.to_owned(), roots.to_vec()));
    }
}
pub(crate) fn profile() -> Option<(String, Vec<PathBuf>)> {
    ACTIVE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_ref()?
        .profile
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> (tempfile::TempDir, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let path = fs::canonicalize(temp.path()).unwrap();
        (temp, path)
    }
    fn append(path: &Path, bytes: &[u8]) {
        fs::OpenOptions::new()
            .append(true)
            .open(path)
            .unwrap()
            .write_all(bytes)
            .unwrap();
    }
    #[test]
    fn missing_optional_log_metadata_is_not_a_failed_snapshot() {
        let (_temp, root) = root();
        let path = root.join("absent-parent.jsonl");
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        assert_eq!(metadata(&path).unwrap_err().kind(), io::ErrorKind::NotFound);
        guard.finish().unwrap();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        assert_eq!(metadata(&path).unwrap_err().kind(), io::ErrorKind::NotFound);
        fs::write(&path, b"{}\n").unwrap();
        assert!(guard
            .finish()
            .unwrap_err()
            .contains(&"import_source_changed"));
    }
    #[test]
    fn simd_syntax_is_checked_even_after_an_early_schema_mismatch() {
        #[derive(serde::Deserialize)]
        struct Numeric {
            #[allow(dead_code)]
            n: u64,
        }
        let (_temp, root) = root();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        assert!(
            simd_slice::<Numeric>(&mut br#"{"n":"different schema","ignored":[1,]}"#.to_vec())
                .is_err()
        );
        assert!(guard.finish().unwrap_err().contains(&"import_json_invalid"));
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        assert!(
            simd_slice::<Numeric>(&mut br#"{"n":"different schema","ignored":[1]}"#.to_vec())
                .is_err()
        );
        guard.finish().unwrap();
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn large_log_capture_is_private_and_does_not_duplicate_data_blocks() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let (_temp, root) = root();
        let path = root.join("large-archive.jsonl");
        let mut source = File::create(&path).unwrap();
        source.set_len(300 * 1024 * 1024).unwrap();
        source.seek(SeekFrom::End(-1)).unwrap();
        source.write_all(b"\n").unwrap();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        let captured = snapshot(&path).unwrap();
        assert!(
            captured.digest.is_none(),
            "macOS qualification requires clone support"
        );
        let info = fs::metadata(&captured.path).unwrap();
        assert_eq!(info.len(), 300 * 1024 * 1024);
        assert_eq!(info.permissions().mode() & 0o777, 0o600);
        assert!(info.blocks() <= source.metadata().unwrap().blocks() + 2048);
        guard.finish().unwrap();
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn read_only_archive_clones_without_changing_source_permissions() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let (_temp, root) = root();
        let path = root.join("read-only-archive.jsonl");
        fs::write(&path, b"{\"a\":1}\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).unwrap();
        let before = fs::metadata(&path).unwrap();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        let captured = snapshot(&path).unwrap();
        assert!(captured.digest.is_none(), "exercise the clone path");
        assert_eq!(fs::metadata(&captured.path).unwrap().mode() & 0o777, 0o600);
        assert_eq!(read(&path).unwrap(), b"{\"a\":1}\n");
        guard.finish().unwrap();
        let after = fs::metadata(&path).unwrap();
        assert_eq!(after.mode() & 0o777, 0o400);
        assert_eq!((before.dev(), before.ino()), (after.dev(), after.ino()));
        assert_eq!(fs::read(&path).unwrap(), b"{\"a\":1}\n");
    }
    #[test]
    fn captured_log_stays_immutable_while_writer_appends() {
        let (_temp, root) = root();
        let path = root.join("active.jsonl");
        fs::write(&path, b"{\"a\":1}\n").unwrap();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        assert_eq!(read(&path).unwrap(), b"{\"a\":1}\n");
        append(&path, b"{\"a\":2}\n");
        assert_eq!(read(&path).unwrap(), b"{\"a\":1}\n");
        assert_eq!(metadata(&path).unwrap().len(), 8);
        guard.finish().unwrap();
        let next = begin(std::slice::from_ref(&root)).unwrap();
        assert_eq!(read(&path).unwrap(), b"{\"a\":1}\n{\"a\":2}\n");
        next.finish().unwrap();
    }
    #[test]
    fn incomplete_tail_is_not_parsed_and_can_complete_after_capture() {
        let (_temp, root) = root();
        let path = root.join("active.jsonl");
        fs::write(&path, b"{\"a\":1}\n{\"a\":").unwrap();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        assert_eq!(read(&path).unwrap(), b"{\"a\":1}\n");
        append(&path, b"2}\n");
        assert_eq!(guard.finish().unwrap().deferred_tail_files, 1);
        let next = begin(std::slice::from_ref(&root)).unwrap();
        assert_eq!(read(&path).unwrap(), b"{\"a\":1}\n{\"a\":2}\n");
        assert_eq!(next.finish().unwrap().deferred_tail_files, 0);
    }
    #[test]
    fn malformed_unterminated_tail_is_not_a_successful_partial_snapshot() {
        let (_temp, root) = root();
        let path = root.join("active.jsonl");
        fs::write(&path, b"{}\n{invalid").unwrap();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        assert!(read(&path).is_err());
        assert!(guard.finish().unwrap_err().contains(&"import_json_invalid"));
    }
    #[test]
    fn oversized_tail_is_rejected_before_allocation() {
        let (_temp, root) = root();
        let path = root.join("active.jsonl");
        File::create(&path)
            .unwrap()
            .set_len(MAX_LINE_BYTES as u64 + 1)
            .unwrap();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        assert!(read(&path).is_err());
        assert!(guard.finish().unwrap_err().contains(&"import_line_limit"));
    }
    #[test]
    fn prefix_rewrite_is_rejected_even_when_length_does_not_change() {
        let (_temp, root) = root();
        let path = root.join("active.jsonl");
        fs::write(&path, b"{\"a\":1}\n").unwrap();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        read(&path).unwrap();
        fs::write(&path, b"{\"a\":2}\n").unwrap();
        assert!(guard
            .finish()
            .unwrap_err()
            .contains(&"import_source_changed"));
    }
    #[test]
    fn expired_verification_is_not_reported_as_source_change() {
        let (_temp, root) = root();
        let path = root.join("active.jsonl");
        fs::write(&path, b"{}\n").unwrap();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        read(&path).unwrap();
        ACTIVE.lock().unwrap().as_mut().unwrap().started =
            std::time::Instant::now() - Duration::from_secs(121);
        assert_eq!(guard.finish().unwrap_err(), vec!["import_time_limit"]);
    }
    #[test]
    fn source_disappearance_remains_distinct_from_expired_verification() {
        let (_temp, root) = root();
        let path = root.join("active.jsonl");
        fs::write(&path, b"{}\n").unwrap();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        ACTIVE.lock().unwrap().as_mut().unwrap().started =
            std::time::Instant::now() - Duration::from_secs(121);
        assert_eq!(
            guard.finish().unwrap_err(),
            vec!["import_source_changed", "import_time_limit"]
        );
    }
    #[test]
    fn prefix_shrink_is_rejected() {
        let (_temp, root) = root();
        let path = root.join("active.jsonl");
        fs::write(&path, b"{\"a\":1}\n{\"a\":2}\n").unwrap();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        read(&path).unwrap();
        fs::write(&path, b"{\"a\":1}\n").unwrap();
        assert!(guard
            .finish()
            .unwrap_err()
            .contains(&"import_source_changed"));
    }
    #[cfg(unix)]
    #[test]
    fn replaced_file_with_identical_bytes_is_rejected() {
        let (_temp, root) = root();
        let path = root.join("active.jsonl");
        fs::write(&path, b"{}\n").unwrap();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        read(&path).unwrap();
        fs::rename(&path, root.join("old.jsonl")).unwrap();
        fs::write(&path, b"{}\n").unwrap();
        assert!(guard
            .finish()
            .unwrap_err()
            .contains(&"import_source_changed"));
    }
    #[test]
    fn sqlite_snapshot_survives_concurrent_wal_writes() {
        let (_temp, root) = root();
        let path = root.join("usage.db");
        let writer = rusqlite::Connection::open(&path).unwrap();
        writer.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE usage(tokens INTEGER); INSERT INTO usage VALUES(1);").unwrap();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        let reader = sqlite(&path).unwrap();
        let count = || {
            reader
                .query_row("SELECT sum(tokens) FROM usage", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap()
        };
        assert_eq!(count(), 1);
        writer.execute("INSERT INTO usage VALUES(2)", []).unwrap();
        assert_eq!(count(), 1);
        assert!(reader.execute("INSERT INTO usage VALUES(3)", []).is_err());
        sqlite_completed(&path);
        drop(reader);
        guard.finish().unwrap();
        let next = begin(std::slice::from_ref(&root)).unwrap();
        let reader = sqlite(&path).unwrap();
        assert_eq!(
            reader
                .query_row("SELECT sum(tokens) FROM usage", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            3
        );
        sqlite_completed(&path);
        drop(reader);
        next.finish().unwrap();
    }
    #[test]
    fn sqlite_scan_budget_scales_with_admitted_size() {
        assert_eq!(sqlite_scan_budget(0), Duration::from_secs(60));
        assert_eq!(sqlite_scan_budget(1024), Duration::from_secs(60));
        assert_eq!(
            sqlite_scan_budget(3 * 1024 * 1024 * 1024),
            Duration::from_secs(96)
        );
        assert_eq!(sqlite_scan_budget(13_556_932_608), Duration::from_secs(404));
        assert_eq!(sqlite_scan_budget(u64::MAX), Duration::from_secs(600));
    }
    #[test]
    fn large_sqlite_source_extends_the_bounded_audit_deadline() {
        let (_temp, root) = root();
        let path = root.join("usage.db");
        let writer = rusqlite::Connection::open(&path).unwrap();
        writer
            .execute_batch("CREATE TABLE usage(tokens INTEGER); INSERT INTO usage VALUES(1);")
            .unwrap();
        drop(writer);
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        let reader = sqlite(&path).unwrap();
        sqlite_completed(&path);
        drop(reader);
        // A source whose scaled scan budget is 500 s must survive past the
        // 120 s base limit without relaxing any other audit check.
        ACTIVE.lock().unwrap().as_mut().unwrap().sqlite_budget_secs = 500;
        ACTIVE.lock().unwrap().as_mut().unwrap().started =
            std::time::Instant::now() - Duration::from_secs(200);
        guard.finish().unwrap();
    }
    #[test]
    fn scaled_audit_deadline_stays_bounded() {
        let (_temp, root) = root();
        let path = root.join("usage.db");
        let writer = rusqlite::Connection::open(&path).unwrap();
        writer
            .execute_batch("CREATE TABLE usage(tokens INTEGER); INSERT INTO usage VALUES(1);")
            .unwrap();
        drop(writer);
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        let reader = sqlite(&path).unwrap();
        sqlite_completed(&path);
        drop(reader);
        ACTIVE.lock().unwrap().as_mut().unwrap().sqlite_budget_secs = u64::MAX;
        ACTIVE.lock().unwrap().as_mut().unwrap().started =
            std::time::Instant::now() - Duration::from_secs(AUDIT_MAX_SECS + 1);
        assert_eq!(guard.finish().unwrap_err(), vec!["import_time_limit"]);
    }
    #[test]
    fn small_sqlite_source_keeps_the_base_audit_deadline() {
        let (_temp, root) = root();
        let path = root.join("usage.db");
        let writer = rusqlite::Connection::open(&path).unwrap();
        writer
            .execute_batch("CREATE TABLE usage(tokens INTEGER); INSERT INTO usage VALUES(1);")
            .unwrap();
        drop(writer);
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        let reader = sqlite(&path).unwrap();
        sqlite_completed(&path);
        drop(reader);
        ACTIVE.lock().unwrap().as_mut().unwrap().started =
            std::time::Instant::now() - Duration::from_secs(121);
        assert_eq!(guard.finish().unwrap_err(), vec!["import_time_limit"]);
    }
    #[test]
    fn captures_are_private_closed_files_and_removed_on_finish() {
        let (_temp, root) = root();
        let source = root.join("active.jsonl");
        fs::write(&source, b"{}\n").unwrap();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        read(&source).unwrap();
        let (directory, path) = {
            let state = ACTIVE.lock().unwrap();
            let audit = state.as_ref().unwrap();
            (
                audit
                    .capture_directory
                    .as_ref()
                    .unwrap()
                    .path()
                    .to_path_buf(),
                audit.snapshots.get(&source).unwrap().path.to_path_buf(),
            )
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        guard.finish().unwrap();
        assert!(!directory.exists());
        assert!(!path.exists());
    }
    #[test]
    fn new_directory_entries_do_not_change_captured_inventory() {
        let (_temp, root) = root();
        let path = root.join("active.jsonl");
        fs::write(&path, b"{}\n").unwrap();
        let guard = begin(std::slice::from_ref(&root)).unwrap();
        admit(&root).unwrap();
        read(&path).unwrap();
        fs::write(root.join("new.jsonl"), b"{}\n").unwrap();
        guard.finish().unwrap();
    }
}
