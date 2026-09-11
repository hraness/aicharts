use std::path::{Path, PathBuf};
use std::time::Duration;

use hmac::{Hmac, Mac};
use rusqlite::{limits::Limit, Connection, OpenFlags};
use sha2::Sha256;

use crate::{Error, Result};

const APPLICATION_ID: i32 = 0x4149434c;
const MAX_DATABASE_BYTES: u64 = 256 * 1024 * 1024;
const TABLES: [(&str, &str); 5] = [
    ("meta", "CREATE TABLE meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1), namespace BLOB NOT NULL CHECK(length(namespace)=32), revision INTEGER NOT NULL CHECK(revision>=0)) STRICT"),
    ("sources", "CREATE TABLE sources(id BLOB PRIMARY KEY CHECK(length(id)=32), stamp BLOB NOT NULL CHECK(length(stamp)=48), warnings INTEGER NOT NULL CHECK(warnings>=0 AND warnings<16384)) STRICT"),
    ("measurements", "CREATE TABLE measurements(id BLOB PRIMARY KEY CHECK(length(id)=16), frame BLOB NOT NULL CHECK(length(frame)=136), revision INTEGER NOT NULL CHECK(revision>0)) STRICT"),
    ("source_usage", "CREATE TABLE source_usage(source_id BLOB NOT NULL REFERENCES sources(id), id BLOB NOT NULL REFERENCES measurements(id), frame BLOB NOT NULL CHECK(length(frame)=136), PRIMARY KEY(source_id,id)) STRICT"),
    ("outbox", "CREATE TABLE outbox(id BLOB PRIMARY KEY REFERENCES measurements(id), revision INTEGER NOT NULL CHECK(revision>0), frame BLOB NOT NULL CHECK(length(frame)=136)) STRICT"),
];

fn namespace(key: &[u8; 32]) -> Result<[u8; 32]> {
    if *key == [0; 32] {
        return Err(Error::WrongNamespace);
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|_| Error::WrongNamespace)?;
    mac.update(b"aicharts-local-ledger-namespace-v1\0");
    Ok(mac.finalize().into_bytes().into())
}

#[cfg(unix)]
fn private_state_path(dir: &Path) -> Result<PathBuf> {
    // Resolve only the existing parent. SQLite's NOFOLLOW also rejects ancestor
    // links (including macOS /tmp); the final state directory remains unfollowed.
    let name = dir.file_name().ok_or(Error::PrivateStateRequired)?;
    let parent = dir
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let parent = std::fs::canonicalize(parent).map_err(|_| Error::PrivateStateRequired)?;
    Ok(parent.join(name))
}

#[cfg(unix)]
fn private_file(path: &Path, directory: bool) -> Result<()> {
    use std::os::unix::fs::MetadataExt;
    let meta = std::fs::symlink_metadata(path).map_err(|_| Error::PrivateStateRequired)?;
    if meta.file_type().is_symlink()
        || meta.mode() & 0o077 != 0
        || (directory && !meta.is_dir())
        || (!directory && (!meta.is_file() || meta.nlink() != 1 || meta.len() > MAX_DATABASE_BYTES))
    {
        return Err(Error::PrivateStateRequired);
    }
    Ok(())
}

#[cfg(unix)]
fn validate_paths(dir: &Path) -> Result<()> {
    private_file(dir, true)?;
    private_file(&dir.join("usage.sqlite3"), false)?;
    for name in [
        "usage.sqlite3-journal",
        "usage.sqlite3-wal",
        "usage.sqlite3-shm",
    ] {
        match std::fs::symlink_metadata(dir.join(name)) {
            Ok(_) => private_file(&dir.join(name), false)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(Error::PrivateStateRequired),
        }
    }
    Ok(())
}

fn connect(path: &Path) -> Result<Connection> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NOFOLLOW
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    connection.busy_timeout(Duration::ZERO)?;
    connection.set_limit(Limit::SQLITE_LIMIT_LENGTH, 8192)?;
    connection.set_limit(Limit::SQLITE_LIMIT_SQL_LENGTH, 8192)?;
    connection.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0)?;
    connection.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY; PRAGMA synchronous=EXTRA; PRAGMA fullfsync=ON;")?;
    Ok(connection)
}

#[cfg(unix)]
pub(super) fn initialize(dir: &Path, key: &[u8; 32]) -> Result<Connection> {
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    let fingerprint = namespace(key)?;
    let resolved = private_state_path(dir)?;
    let dir = resolved.as_path();
    // Explicit initialization never adopts a pre-existing directory or database.
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(dir)
        .map_err(|_| Error::PrivateStateRequired)?;
    let file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(dir.join("usage.sqlite3"))
        .map_err(|_| Error::Storage)?;
    file.sync_all().map_err(|_| Error::Storage)?;
    validate_paths(dir)?;
    let mut connection = connect(&dir.join("usage.sqlite3"))?;
    connection.execute_batch(
        "PRAGMA page_size=4096; PRAGMA max_page_count=65536; PRAGMA journal_mode=DELETE;",
    )?;
    let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    tx.pragma_update(None, "application_id", APPLICATION_ID)?;
    tx.pragma_update(None, "user_version", 1)?;
    for (_, sql) in TABLES {
        tx.execute_batch(sql)?;
    }
    tx.execute(
        "INSERT INTO meta(singleton,namespace,revision) VALUES(1,?1,0)",
        [fingerprint.as_slice()],
    )?;
    tx.commit()?;
    // SQLite's EXTRA mode synchronizes the journal directory; explicitly retain
    // the newly created state directory itself through its parent's directory entry.
    std::fs::File::open(dir)
        .and_then(|f| f.sync_all())
        .map_err(|_| Error::Storage)?;
    let parent = dir
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    std::fs::File::open(parent)
        .and_then(|f| f.sync_all())
        .map_err(|_| Error::Storage)?;
    Ok(connection)
}

#[cfg(unix)]
pub(super) fn open(dir: &Path, key: &[u8; 32]) -> Result<Connection> {
    let expected = namespace(key)?;
    let resolved = private_state_path(dir)?;
    let dir = resolved.as_path();
    validate_paths(dir)?;
    let connection = connect(&dir.join("usage.sqlite3"))?;
    let application_id: i32 =
        connection.pragma_query_value(None, "application_id", |r| r.get(0))?;
    let version: i32 = connection.pragma_query_value(None, "user_version", |r| r.get(0))?;
    let mode: String = connection.pragma_query_value(None, "journal_mode", |r| r.get(0))?;
    let page_size: i64 = connection.pragma_query_value(None, "page_size", |r| r.get(0))?;
    if application_id != APPLICATION_ID || version != 1 || mode != "delete" || page_size != 4096 {
        return Err(Error::InvalidState);
    }
    let mut count = 0;
    let mut statement = connection
        .prepare("SELECT name,sql,type FROM sqlite_schema WHERE sql IS NOT NULL LIMIT 7")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        count += 1;
        let name: String = row.get(0)?;
        let sql: String = row.get(1)?;
        let kind: String = row.get(2)?;
        if kind != "table" || !TABLES.iter().any(|(n, s)| name == *n && sql == *s) {
            return Err(Error::InvalidState);
        }
    }
    if count != TABLES.len() {
        return Err(Error::InvalidState);
    }
    drop(rows);
    drop(statement);
    let fingerprint: Vec<u8> =
        connection.query_row("SELECT namespace FROM meta WHERE singleton=1", [], |row| {
            row.get(0)
        })?;
    if fingerprint.as_slice() != expected {
        return Err(Error::WrongNamespace);
    }
    // The cap is a connection-local setting. Reapply only after validating this
    // owned schema and namespace; it does not migrate or delete existing data.
    let cap: i64 = connection.query_row("PRAGMA max_page_count=65536", [], |row| row.get(0))?;
    if cap != 65536 {
        return Err(Error::Limit);
    }
    validate_paths(dir)?;
    crate::validate_relations(&connection)?;
    Ok(connection)
}

#[cfg(not(unix))]
pub(super) fn initialize(_dir: &Path, _key: &[u8; 32]) -> Result<Connection> {
    Err(Error::UnsupportedPlatform)
}
#[cfg(not(unix))]
pub(super) fn open(_dir: &Path, _key: &[u8; 32]) -> Result<Connection> {
    Err(Error::UnsupportedPlatform)
}
