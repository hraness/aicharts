//! Bounded, owned inspection. A read snapshot is closed before a caller parses
//! sources; this is a revision guard, not a lock or authority to promote state.

use std::path::{Path, PathBuf};

use crate::{Error, InventoryRecord, LedgerIdentity, LedgerSnapshot, LedgerStatus, Result};

pub struct ReadOnlyLedger {
    guard: Guard,
    snapshot: LedgerSnapshot,
    prefix_snapshot: crate::PrefixSnapshot,
    status: LedgerStatus,
    inventory: Vec<InventoryRecord>,
    audit: crate::HistoryAudit,
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
        let audit = crate::audit_relations_in(&tx)?;
        let snapshot = crate::snapshot(&tx)?;
        let prefix_snapshot = crate::prefix::snapshot(&tx)?;
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
            prefix_snapshot,
            status,
            inventory,
            audit,
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

    pub fn history_audit(&self) -> crate::HistoryAudit {
        self.audit
    }

    pub fn snapshot(&self) -> &LedgerSnapshot {
        &self.snapshot
    }
    /// Local-only integrity metadata, never upload or status output.
    pub fn prefix_snapshot(&self) -> &crate::PrefixSnapshot {
        &self.prefix_snapshot
    }
    pub fn status(&self) -> &LedgerStatus {
        &self.status
    }
    pub fn inventory(&self) -> &[InventoryRecord] {
        &self.inventory
    }

    /// Explicit local recovery export, including quarantined facts and all
    /// sender tables. Never overwrites a directory. Does not export keys or
    /// enrollment anchors and grants no authority to upload the copy.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    pub fn export_to(&self, target: &Path, identity: &LedgerIdentity<'_>) -> Result<()> {
        use sha2::{Digest, Sha256};
        use std::io::{Read, Write};
        use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
        if crate::storage::namespace(identity)? != self.guard.namespace {
            return Err(Error::WrongNamespace);
        }
        self.ensure_unchanged()?;
        let mut connection = self.guard.connect()?;
        let tx = connection.transaction()?;
        crate::storage::validate_schema(&tx, &self.guard.namespace, true)?;
        if crate::revision(&tx)? != self.snapshot.revision {
            return Err(Error::StaleRevision);
        }
        self.guard.ensure_paths()?;
        let target = crate::storage::private_state_path(target)?;
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&target)
            .map_err(|_| Error::PrivateStateRequired)?;
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(target.join("usage.sqlite3"))
            .map_err(|_| Error::Storage)?;
        let open = |path: &Path| -> Result<std::fs::File> {
            use rustix::fs::{open, Mode, OFlags};
            Ok(open(
                path,
                OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| Error::PrivateStateRequired)?
            .into())
        };
        let mut input = open(&self.guard.resolved.join("usage.sqlite3"))?;
        let descriptor =
            || FileIdentity::from_metadata(&input.metadata().map_err(|_| Error::Storage)?, false);
        if descriptor()? != self.guard.database {
            return Err(Error::StaleRevision);
        }
        let mut digest = Sha256::new();
        let mut buffer = [0u8; 65536];
        let mut total = 0u64;
        loop {
            let n = input.read(&mut buffer).map_err(|_| Error::Storage)?;
            if n == 0 {
                break;
            }
            total = total
                .checked_add(n as u64)
                .filter(|n| *n <= crate::MAX_DATABASE_BYTES)
                .ok_or(Error::Limit)?;
            output.write_all(&buffer[..n]).map_err(|_| Error::Storage)?;
            digest.update(&buffer[..n]);
        }
        output.sync_all().map_err(|_| Error::Storage)?;
        if FileIdentity::from_metadata(&input.metadata().map_err(|_| Error::Storage)?, false)?
            != self.guard.database
        {
            return Err(Error::StaleRevision);
        }
        self.guard.ensure_paths()?;
        if total != self.guard.database.bytes {
            return Err(Error::StaleRevision);
        }
        let copy = Self::open(&target, identity)?;
        if copy.audit != self.audit || copy.snapshot.revision != self.snapshot.revision {
            return Err(Error::InvalidState);
        }
        let mut copy_file = open(&target.join("usage.sqlite3"))?;
        if FileIdentity::from_metadata(&copy_file.metadata().map_err(|_| Error::Storage)?, false)?
            != copy.guard.database
        {
            return Err(Error::StaleRevision);
        }
        let mut copied_digest = Sha256::new();
        let mut copied_bytes = 0u64;
        loop {
            let n = copy_file.read(&mut buffer).map_err(|_| Error::Storage)?;
            if n == 0 {
                break;
            }
            copied_bytes = copied_bytes
                .checked_add(n as u64)
                .filter(|n| *n <= total)
                .ok_or(Error::Limit)?;
            copied_digest.update(&buffer[..n]);
        }
        if copied_bytes != total || digest.finalize() != copied_digest.finalize() {
            return Err(Error::InvalidState);
        }
        copy.ensure_unchanged()?;
        for directory in [&target, target.parent().ok_or(Error::PrivateStateRequired)?] {
            std::fs::File::open(directory)
                .and_then(|f| f.sync_all())
                .map_err(|_| Error::Storage)?;
        }
        self.guard.ensure_paths()?;
        tx.rollback()?;
        Ok(())
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
        if crate::audit_relations_in(&tx)? != self.audit {
            return Err(Error::StaleRevision);
        }
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
    let mut statement = connection.prepare(&format!(
        "SELECT id,revision,frame FROM measurements ORDER BY id LIMIT {}",
        crate::MAX_OCCURRENCES + 1
    ))?;
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
        crate::storage::private_file(path, directory)?;
        let metadata = std::fs::symlink_metadata(path).map_err(|_| Error::PrivateStateRequired)?;
        Self::from_metadata(&metadata, directory)
    }
    fn from_metadata(metadata: &std::fs::Metadata, directory: bool) -> Result<Self> {
        use std::os::unix::fs::MetadataExt;
        // Check this metadata too, not only the preceding validation's sample.
        if metadata.file_type().is_symlink()
            || metadata.mode() & 0o077 != 0
            || (directory && !metadata.is_dir())
            || (!directory
                && (!metadata.is_file()
                    || metadata.nlink() != 1
                    || metadata.len() > crate::storage::MAX_DATABASE_BYTES))
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
        connection.set_limit(
            Limit::SQLITE_LIMIT_LENGTH,
            crate::storage::MAX_SQLITE_VALUE_BYTES,
        )?;
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

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod capacity_tests {
    use super::*;
    use std::os::unix::fs::OpenOptionsExt;
    #[test]
    fn reader_metadata_uses_the_same_sparse_file_capacity_as_writer() {
        let fixture = crate::tests::Fixture::new();
        let path = fixture.0.join("sparse-capacity");
        let file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&path)
            .unwrap();
        for bytes in [256 * 1024 * 1024 + 1, crate::MAX_DATABASE_BYTES] {
            file.set_len(bytes).unwrap();
            assert_eq!(FileIdentity::read(&path, false).unwrap().bytes, bytes);
        }
        file.set_len(crate::MAX_DATABASE_BYTES + 1).unwrap();
        assert!(matches!(
            FileIdentity::read(&path, false),
            Err(Error::PrivateStateRequired)
        ));
    }
}
