//! Bounded, owned inspection. A read snapshot is closed before a caller parses
//! sources; this is a revision guard, not a lock or authority to promote state.

use std::path::{Path, PathBuf};

use crate::{Error, InventoryRecord, LedgerIdentity, LedgerSnapshot, LedgerStatus, Result};

pub struct ReadOnlyLedger {
    guard: Guard,
    snapshot: LedgerSnapshot,
    status: LedgerStatus,
    inventory: Vec<InventoryRecord>,
}

impl ReadOnlyLedger {
    /// Inspect an existing private ledger without creating files or recovering
    /// journals. Only qualified local macOS/Linux POSIX-locking filesystems are
    /// supported. Ordinary file access timestamps may change through reading.
    pub fn open(dir: &Path, identity: &LedgerIdentity<'_>) -> Result<Self> {
        Self::open_with(dir, identity, || Ok(()))
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    pub(super) fn open_with<F: FnOnce() -> Result<()>>(
        dir: &Path,
        identity: &LedgerIdentity<'_>,
        after_guard: F,
    ) -> Result<Self> {
        let guard = Guard::capture(dir, crate::storage::namespace(identity)?)?;
        after_guard()?;
        let mut connection = guard.connect()?;
        let tx = connection.transaction()?;
        crate::storage::validate_schema(&tx, &guard.namespace, true)?;
        crate::validate_relations_in(&tx)?;
        let snapshot = crate::snapshot(&tx)?;
        let status = crate::status(&tx)?;
        let inventory = inventory(&tx, snapshot.revision)?;
        guard.ensure_paths()?;
        // No connection or key survives the short read transaction.
        tx.rollback()?;
        connection
            .close()
            .map_err(|(_, error)| Error::from(error))?;
        guard.ensure_paths()?;
        Ok(Self {
            guard,
            snapshot,
            status,
            inventory,
        })
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    fn open_with<F: FnOnce() -> Result<()>>(
        _dir: &Path,
        _identity: &LedgerIdentity<'_>,
        _after_guard: F,
    ) -> Result<Self> {
        Err(Error::UnsupportedPlatform)
    }

    pub fn snapshot(&self) -> &LedgerSnapshot {
        &self.snapshot
    }
    pub fn status(&self) -> &LedgerStatus {
        &self.status
    }
    pub fn inventory(&self) -> &[InventoryRecord] {
        &self.inventory
    }

    /// Recheck identity, schema, namespace, integrity and revision. This does not
    /// reserve a future write or eliminate the need for writer coordination at
    /// activation. An intervening changed file is rejected even if its numeric
    /// revision was restored; malicious same-user ABA is not a security boundary.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    pub fn ensure_unchanged(&self) -> Result<()> {
        self.guard.ensure_paths()?;
        let mut connection = self.guard.connect()?;
        let tx = connection.transaction()?;
        crate::storage::validate_schema(&tx, &self.guard.namespace, true)?;
        crate::validate_relations_in(&tx)?;
        if crate::revision(&tx)? != self.snapshot.revision {
            return Err(Error::StaleRevision);
        }
        self.guard.ensure_paths()?;
        tx.rollback()?;
        connection
            .close()
            .map_err(|(_, error)| Error::from(error))?;
        self.guard.ensure_paths()
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    pub fn ensure_unchanged(&self) -> Result<()> {
        Err(Error::UnsupportedPlatform)
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn inventory(connection: &rusqlite::Connection, revision: u64) -> Result<Vec<InventoryRecord>> {
    // Explicit measurements inventory: do not substitute the current outbox
    // equality invariant for this API's history-coverage contract.
    let mut statement = connection
        .prepare("SELECT id,revision,frame FROM measurements ORDER BY id LIMIT 100001")?;
    let mut rows = statement.query([])?;
    let mut result = Vec::new();
    while let Some(row) = rows.next()? {
        let id: Vec<u8> = row.get(0)?;
        let id = id.try_into().map_err(|_| Error::InvalidState)?;
        let record_revision = crate::unsigned(row.get(1)?)?;
        let frame: Vec<u8> = row.get(2)?;
        if crate::checked_frame(&frame)?.usage[0].id != id
            || record_revision == 0
            || record_revision > revision
        {
            return Err(Error::InvalidState);
        }
        result.push(InventoryRecord {
            id,
            revision: record_revision,
            frame,
        });
        if result.len() > crate::MAX_OCCURRENCES {
            return Err(Error::Limit);
        }
    }
    Ok(result)
}

struct Guard {
    requested: PathBuf,
    resolved: PathBuf,
    namespace: [u8; 32],
    directory: FileIdentity,
    database: FileIdentity,
}

#[derive(PartialEq, Eq)]
struct FileIdentity {
    device: u64,
    inode: u64,
    bytes: u64,
    mode: u32,
    links: u64,
    modified: (i64, i64),
    changed: (i64, i64),
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
impl FileIdentity {
    fn read(path: &Path, directory: bool) -> Result<Self> {
        use std::os::unix::fs::MetadataExt;
        crate::storage::private_file(path, directory)?;
        let metadata = std::fs::symlink_metadata(path).map_err(|_| Error::PrivateStateRequired)?;
        // Check this metadata too, not only the preceding validation's sample.
        if metadata.file_type().is_symlink()
            || metadata.mode() & 0o077 != 0
            || (directory && !metadata.is_dir())
            || (!directory
                && (!metadata.is_file()
                    || metadata.nlink() != 1
                    || metadata.len() > 256 * 1024 * 1024))
        {
            return Err(Error::PrivateStateRequired);
        }
        Ok(Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            bytes: metadata.len(),
            mode: metadata.mode(),
            links: metadata.nlink(),
            modified: (metadata.mtime(), metadata.mtime_nsec()),
            changed: (metadata.ctime(), metadata.ctime_nsec()),
        })
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn no_sidecars(dir: &Path) -> Result<()> {
    for name in [
        "usage.sqlite3-journal",
        "usage.sqlite3-wal",
        "usage.sqlite3-shm",
    ] {
        match std::fs::symlink_metadata(dir.join(name)) {
            Ok(_) => return Err(Error::RecoveryRequired),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(Error::PrivateStateRequired),
        }
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
impl Guard {
    fn capture(dir: &Path, namespace: [u8; 32]) -> Result<Self> {
        let requested = if dir.is_absolute() {
            dir.to_owned()
        } else {
            std::env::current_dir()
                .map_err(|_| Error::PrivateStateRequired)?
                .join(dir)
        };
        let resolved = crate::storage::private_state_path(&requested)?;
        let directory = FileIdentity::read(&resolved, true)?;
        let database = FileIdentity::read(&resolved.join("usage.sqlite3"), false)?;
        no_sidecars(&resolved)?;
        let guard = Self {
            requested,
            resolved,
            namespace,
            directory,
            database,
        };
        guard.ensure_paths()?;
        Ok(guard)
    }

    fn ensure_paths(&self) -> Result<()> {
        if crate::storage::private_state_path(&self.requested)? != self.resolved {
            return Err(Error::StaleRevision);
        }
        no_sidecars(&self.resolved)?;
        if FileIdentity::read(&self.resolved, true)? != self.directory
            || FileIdentity::read(&self.resolved.join("usage.sqlite3"), false)? != self.database
        {
            return Err(Error::StaleRevision);
        }
        Ok(())
    }

    fn connect(&self) -> Result<rusqlite::Connection> {
        use rusqlite::{limits::Limit, OpenFlags};
        self.ensure_paths()?;
        let connection = rusqlite::Connection::open_with_flags_and_vfs(
            self.resolved.join("usage.sqlite3"),
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_NOFOLLOW
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE,
            // Bundled unix-excl always uses POSIX locks, including on macOS
            // where the default unix VFS may choose a different locking style.
            "unix-excl",
        )?;
        connection.busy_timeout(std::time::Duration::ZERO)?;
        connection.set_limit(Limit::SQLITE_LIMIT_LENGTH, 8192)?;
        connection.set_limit(Limit::SQLITE_LIMIT_SQL_LENGTH, 8192)?;
        connection.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0)?;
        // This is connection-local, not BEGIN EXCLUSIVE or a write. Setting it
        // before any DB access prevents even a raced WAL header from opening a
        // shared-memory file. WAL is still rejected; immutable/nolock are unsafe
        // alternatives because they disable change detection or SQLite locking.
        connection.execute_batch("PRAGMA locking_mode=EXCLUSIVE; PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; PRAGMA foreign_keys=ON;")?;
        if !connection.is_readonly("main")? {
            return Err(Error::InvalidState);
        }
        self.ensure_paths()?;
        Ok(connection)
    }
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
pub(super) fn readonly_connection_for_test(
    dir: &Path,
    identity: &LedgerIdentity<'_>,
) -> Result<rusqlite::Connection> {
    Guard::capture(dir, crate::storage::namespace(identity)?)?.connect()
}
