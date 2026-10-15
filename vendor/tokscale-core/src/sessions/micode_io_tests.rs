use std::cell::{Cell, RefCell};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct IoCounts {
    opens: usize,
    sessions: usize,
    scans: usize,
    decodes: usize,
}
thread_local! {
    static COUNTS: Cell<IoCounts> = Cell::new(IoCounts::default());
    static AFTER_READ: RefCell<Option<Box<dyn FnOnce()>>> = RefCell::new(None);
}
fn update(f: impl FnOnce(&mut IoCounts)) {
    COUNTS.with(|counts| {
        let mut value = counts.get();
        f(&mut value);
        counts.set(value);
    });
}
pub(crate) fn record_open() {
    update(|c| c.opens += 1);
}
pub(crate) fn record_sessions() {
    update(|c| c.sessions += 1);
}
pub(crate) fn record_scan() {
    update(|c| c.scans += 1);
}
pub(crate) fn record_decode() {
    update(|c| c.decodes += 1);
}
pub(crate) fn run_after_read_hook() {
    let hook = AFTER_READ.with(|hook| hook.borrow_mut().take());
    if let Some(hook) = hook {
        hook();
    }
}

use super::*;
use crate::{parse_local_clients, parse_local_unified_messages_with_pricing, LocalParseOptions};
use rusqlite::{params, Connection};

fn reset() {
    COUNTS.with(|counts| counts.set(IoCounts::default()));
}
fn counts() -> IoCounts {
    COUNTS.with(Cell::get)
}
fn assert_single_read(decodes: usize) {
    assert_eq!(
        counts(),
        IoCounts {
            opens: 1,
            sessions: 1,
            scans: 1,
            decodes
        }
    );
}
fn fixture(home: &Path) -> std::path::PathBuf {
    let path = home.join(".local/share/mimocode/mimocode.db");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE session(id TEXT PRIMARY KEY, version TEXT, time_created INTEGER, directory TEXT); CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, data TEXT);").unwrap();
    conn.execute(
        "INSERT INTO session VALUES ('session','desktop-test',1779999999000,'/repo')",
        [],
    )
    .unwrap();
    for (id, created) in [("a", 1780000000000.125), ("b", 1780000000000.625)] {
        let data = serde_json::json!({"id":id,"role":"assistant","modelID":"mimo-test","providerID":"mimo","cost":0.0,"tokens":{"input":100,"output":20},"time":{"created":created,"completed":created + 50.0}});
        conn.execute(
            "INSERT INTO message VALUES (?1,'session',?2)",
            params![id, data.to_string()],
        )
        .unwrap();
    }
    path
}
fn options(home: &Path) -> LocalParseOptions {
    LocalParseOptions {
        home_dir: Some(home.to_string_lossy().into_owned()),
        use_env_roots: false,
        clients: Some(vec!["micode".into(), "micode-desktop".into()]),
        ..Default::default()
    }
}
fn cache_env(path: &Path) -> crate::paths::test_env::EnvGuard {
    let mut guard = crate::paths::test_env::EnvGuard::capture(&["TOKSCALE_CONFIG_DIR"]);
    guard.set("TOKSCALE_CONFIG_DIR", path);
    guard
}

#[test]
fn micode_single_reader_preserves_exact_timing_without_projection() {
    let home = tempfile::tempdir().unwrap();
    let path = fixture(home.path());
    reset();
    let source = parse_micode_source(&path);
    assert_single_read(2);
    assert!(source.complete);
    assert_eq!(source.messages.len(), source.metadata.len());
    assert_ne!(
        source.metadata[0].row.created_bits,
        source.metadata[1].row.created_bits
    );
    assert_eq!(source.messages[0].timestamp, source.messages[1].timestamp);
    assert!(source.metadata.iter().all(MiMoRowMetadata::is_valid));
    reset();
    assert_eq!(parse_micode_sqlite(&path).len(), 2);
    assert_single_read(2);
}

#[tokio::test]
#[serial_test::serial]
async fn micode_cold_local_and_warm_cache_have_bounded_io() {
    let home = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let _env = cache_env(cache.path());
    fixture(home.path());
    reset();
    let local = parse_local_clients(options(home.path())).unwrap();
    assert_eq!(local.messages.len(), 2);
    assert_single_read(2);
    reset();
    let cold = parse_local_unified_messages_with_pricing(options(home.path()), None)
        .await
        .unwrap();
    assert_eq!(cold.len(), 2);
    assert_single_read(2);
    reset();
    let warm = parse_local_unified_messages_with_pricing(options(home.path()), None)
        .await
        .unwrap();
    assert_eq!(warm.len(), 2);
    assert_eq!(
        counts(),
        IoCounts::default(),
        "warm hit must do no SQLite open or JSON decode"
    );
    assert_eq!(
        warm.iter()
            .map(|m| (&m.client, &m.dedup_key, m.cost))
            .collect::<Vec<_>>(),
        cold.iter()
            .map(|m| (&m.client, &m.dedup_key, m.cost))
            .collect::<Vec<_>>()
    );
}

#[tokio::test]
#[serial_test::serial]
async fn micode_wal_only_session_change_rebuilds_the_matched_pair_once() {
    let home = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let _env = cache_env(cache.path());
    let path = fixture(home.path());
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")
        .unwrap();
    parse_local_unified_messages_with_pricing(options(home.path()), None)
        .await
        .unwrap();
    conn.execute("UPDATE session SET version='1.0.0'", [])
        .unwrap();
    reset();
    let refreshed = parse_local_unified_messages_with_pricing(options(home.path()), None)
        .await
        .unwrap();
    assert_single_read(2);
    assert!(refreshed.iter().all(|m| m.client == "micode"));
    reset();
    parse_local_unified_messages_with_pricing(options(home.path()), None)
        .await
        .unwrap();
    assert_eq!(counts(), IoCounts::default());
}

#[tokio::test]
#[serial_test::serial]
async fn micode_changed_after_snapshot_is_not_cached_under_new_fingerprint() {
    let home = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let _env = cache_env(cache.path());
    let path = fixture(home.path());
    AFTER_READ.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move || {
            let conn = Connection::open(path).unwrap();
            conn.execute("UPDATE session SET version='1.0.0'", [])
                .unwrap();
        }))
    });
    let old = parse_local_unified_messages_with_pricing(options(home.path()), None)
        .await
        .unwrap();
    assert!(old.iter().all(|m| m.client == "micode-desktop"));
    reset();
    let new = parse_local_unified_messages_with_pricing(options(home.path()), None)
        .await
        .unwrap();
    assert_single_read(2);
    assert!(new.iter().all(|m| m.client == "micode"));
    reset();
    parse_local_unified_messages_with_pricing(options(home.path()), None)
        .await
        .unwrap();
    assert_eq!(counts(), IoCounts::default());
}

#[test]
fn micode_legacy_schema_and_malformed_rows_do_not_open_a_second_reader() {
    let home = tempfile::tempdir().unwrap();
    let path = fixture(home.path());
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("DROP TABLE session;").unwrap();
    reset();
    assert_eq!(parse_micode_sqlite(&path).len(), 2);
    assert_single_read(2);
    conn.execute("INSERT INTO message VALUES ('z','session','{')", [])
        .unwrap();
    reset();
    let malformed = parse_micode_source(&path);
    assert!(!malformed.complete);
    assert_eq!(malformed.messages.len(), malformed.metadata.len());
    assert_eq!(counts().opens, 1);
    assert_eq!(counts().scans, 1);
}

#[tokio::test]
#[serial_test::serial]
async fn micode_missing_or_invalid_cached_metadata_rebuilds_then_stays_warm() {
    use crate::message_cache::{
        CacheIdentity, CachedSourceEntry, SourceFingerprint, SourceMessageCache,
    };
    for bad_metadata in [None, Some(Vec::new())] {
        let home = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let _env = cache_env(cache.path());
        let path = fixture(home.path());
        let source = parse_micode_source(&path);
        let identity = CacheIdentity::for_client(crate::ClientId::MiMoCode);
        let mut entry = CachedSourceEntry::new(
            identity,
            &path,
            SourceFingerprint::from_sqlite_path(&path).unwrap(),
            source.messages,
            Vec::new(),
            None,
        );
        entry.micode_metadata = bad_metadata;
        let mut stored = SourceMessageCache::load();
        stored.insert(entry);
        stored.save_if_dirty();
        reset();
        assert_eq!(
            parse_local_unified_messages_with_pricing(options(home.path()), None)
                .await
                .unwrap()
                .len(),
            2
        );
        assert_single_read(2);
        reset();
        assert_eq!(
            parse_local_unified_messages_with_pricing(options(home.path()), None)
                .await
                .unwrap()
                .len(),
            2
        );
        assert_eq!(counts(), IoCounts::default());
    }
}

#[tokio::test]
#[serial_test::serial]
async fn micode_warm_pair_survives_changed_sibling_namespace_save() {
    let home = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let _env = cache_env(cache.path());
    let first = fixture(home.path());
    let second = first.with_file_name("mimocode-sibling.db");
    std::fs::copy(&first, &second).unwrap();
    parse_local_unified_messages_with_pricing(options(home.path()), None)
        .await
        .unwrap();
    let conn = Connection::open(&second).unwrap();
    conn.execute("UPDATE session SET version='1.0.0'", [])
        .unwrap();
    drop(conn);
    reset();
    parse_local_unified_messages_with_pricing(options(home.path()), None)
        .await
        .unwrap();
    assert_single_read(2);
    reset();
    parse_local_unified_messages_with_pricing(options(home.path()), None)
        .await
        .unwrap();
    assert_eq!(
        counts(),
        IoCounts::default(),
        "a namespace save must not lose the untouched source's paired provenance"
    );
}

#[tokio::test]
#[serial_test::serial]
async fn micode_metadata_read_failure_stays_cold_until_successfully_repaired() {
    for seed_valid_cache in [false, true] {
        let home = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let _env = cache_env(cache.path());
        let path = fixture(home.path());
        if seed_valid_cache {
            parse_local_unified_messages_with_pricing(options(home.path()), None)
                .await
                .unwrap();
            reset();
            parse_local_unified_messages_with_pricing(options(home.path()), None)
                .await
                .unwrap();
            assert_eq!(counts(), IoCounts::default());
        }
        let conn = Connection::open(&path).unwrap();
        // BLOB cannot be read as an optional text version. This is an actual
        // query iterator row-conversion error, not simulated missing metadata.
        conn.execute("UPDATE session SET version=X'00'", [])
            .unwrap();
        drop(conn);
        assert!(!parse_micode_source(&path).complete);
        for _ in 0..2 {
            reset();
            let degraded = parse_local_unified_messages_with_pricing(options(home.path()), None)
                .await
                .unwrap();
            assert_single_read(2);
            assert_eq!(degraded.len(), 2);
            assert!(degraded.iter().all(|message| message.client == "micode"));
        }
        let conn = Connection::open(&path).unwrap();
        conn.execute("UPDATE session SET version='desktop-repaired'", [])
            .unwrap();
        drop(conn);
        reset();
        let repaired = parse_local_unified_messages_with_pricing(options(home.path()), None)
            .await
            .unwrap();
        assert_single_read(2);
        assert!(repaired
            .iter()
            .all(|message| message.client == "micode-desktop"));
        let source = parse_micode_source(&path);
        assert!(source.complete);
        assert!(source
            .metadata
            .iter()
            .all(|metadata| metadata.session_created_bits.is_some()));
        reset();
        parse_local_unified_messages_with_pricing(options(home.path()), None)
            .await
            .unwrap();
        assert_eq!(counts(), IoCounts::default());
    }
}

#[tokio::test]
#[serial_test::serial]
async fn micode_structurally_legacy_session_metadata_remains_cacheable() {
    for schema in [
        "DROP TABLE session;",
        "ALTER TABLE session DROP COLUMN version;",
        "ALTER TABLE session DROP COLUMN time_created;",
        "ALTER TABLE session DROP COLUMN version; ALTER TABLE session DROP COLUMN time_created;",
    ] {
        let home = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let _env = cache_env(cache.path());
        let path = fixture(home.path());
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(schema).unwrap();
        drop(conn);
        assert!(
            parse_micode_source(&path).complete,
            "structural absence is not an IO failure: {schema}"
        );
        reset();
        let cold = parse_local_unified_messages_with_pricing(options(home.path()), None)
            .await
            .unwrap();
        assert_single_read(2);
        assert_eq!(cold.len(), 2);
        let expected = if schema == "ALTER TABLE session DROP COLUMN time_created;" {
            "micode-desktop"
        } else {
            "micode"
        };
        assert!(cold.iter().all(|message| message.client == expected));
        reset();
        let warm = parse_local_unified_messages_with_pricing(options(home.path()), None)
            .await
            .unwrap();
        assert_eq!(
            counts(),
            IoCounts::default(),
            "legacy metadata should be cached: {schema}"
        );
        assert!(warm.iter().all(|message| message.client == expected));
    }
}
