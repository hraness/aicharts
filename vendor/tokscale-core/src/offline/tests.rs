use super::*;
use std::fs;
fn root() -> (tempfile::TempDir, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let path = fs::canonicalize(temp.path()).unwrap();
    (temp, path)
}
fn database(path: &Path, sql: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    rusqlite::Connection::open(path)
        .unwrap()
        .execute_batch(sql)
        .unwrap();
}
#[test]
fn hermes_profile_databases_parse_and_deduplicate_with_exact_cost() {
    let (_temp, home) = root();
    let profile = home.join("custom");
    let sql = "CREATE TABLE sessions(id TEXT,model TEXT,billing_provider TEXT,started_at REAL,message_count INTEGER,input_tokens INTEGER,output_tokens INTEGER,cache_read_tokens INTEGER,cache_write_tokens INTEGER,reasoning_tokens INTEGER,actual_cost_usd REAL,estimated_cost_usd REAL); INSERT INTO sessions VALUES('same','gpt-5','openai',1789776000,1,10,2,0,0,0,0,0.5);";
    database(&profile.join("a/state.db"), sql);
    database(&profile.join("b/state.db"), sql);
    fs::create_dir(home.join(".hermes")).unwrap();
    fs::write(home.join(".hermes/state.db"), b"bad-default-must-not-open").unwrap();
    let result = collect_profile(&home, "hermes", std::slice::from_ref(&home), &[profile]).unwrap();
    assert_eq!(result.messages.len(), 1);
    assert_eq!(result.messages[0].tokens.input, 10);
    assert_eq!(result.messages[0].cost, 0.0);
    assert_eq!(
        result.messages[0].cost_source,
        crate::sessions::CostSource::ProviderReported
    );
}
#[test]
fn kilo_profile_uses_sqlite_lane_and_preserves_source_model() {
    let (_temp, home) = root();
    let profile = home.join("custom");
    database(
        &profile.join("kilo.db"),
        r#"CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT); INSERT INTO message VALUES('row','s','{"id":"m","role":"assistant","modelID":"claude-sonnet-4","providerID":"anthropic","tokens":{"input":12,"output":3,"cache":{"read":4,"write":2}},"time":{"created":1789776000000},"cost":0.25}');"#,
    );
    let result = collect_profile(&home, "kilo", std::slice::from_ref(&home), &[profile]).unwrap();
    assert_eq!(result.messages.len(), 1);
    assert_eq!(result.messages[0].client, "kilo");
    assert_eq!(result.messages[0].tokens.input, 12);
    assert_eq!(result.messages[0].model_id, "claude-sonnet-4");
}
#[test]
fn synthetic_profiles_read_only_octofriend_and_collapse_repeated_source_ids() {
    let (_temp, home) = root();
    let profile = home.join("custom");
    let sql = "CREATE TABLE messages(id TEXT,model TEXT,input_tokens INTEGER,output_tokens INTEGER,cache_read_tokens INTEGER,cache_write_tokens INTEGER,reasoning_tokens INTEGER,cost REAL,timestamp REAL,session_id TEXT,provider TEXT); INSERT INTO messages VALUES('m','gpt-5',12,3,0,0,0,0,1789776000000,'s','synthetic');";
    database(&profile.join("a/sqlite.db"), sql);
    database(&profile.join("b/sqlite.db"), sql);
    fs::write(profile.join("unrelated.jsonl"), "{invalid\n").unwrap();
    let result =
        collect_profile(&home, "synthetic", std::slice::from_ref(&home), &[profile]).unwrap();
    assert_eq!(result.messages.len(), 1);
    assert_eq!(result.messages[0].tokens.input, 12);
    assert_eq!(result.messages[0].client, "synthetic");
    assert_eq!(
        result.messages[0].cost_source,
        crate::sessions::CostSource::ProviderReported
    );
}
#[test]
fn crush_registry_cannot_escape_exclusive_profile_even_with_broad_approval() {
    let (_temp, home) = root();
    let profile = home.join("registry");
    let external = home.join("external");
    fs::create_dir(&profile).unwrap();
    fs::create_dir(&external).unwrap();
    fs::write(external.join("crush.db"), b"not-opened").unwrap();
    fs::write(
        profile.join("projects.json"),
        serde_json::json!({"projects":[{"path":external,"data_dir":"."}]}).to_string(),
    )
    .unwrap();
    let errors = collect_profile(&home, "crush", std::slice::from_ref(&home), &[profile])
        .err()
        .unwrap();
    assert!(errors.contains(&"import_root_denied"));
}

const DEVIN_CLI_SCHEMA: &str = "CREATE TABLE sessions (id TEXT PRIMARY KEY, working_directory TEXT NOT NULL, backend_type TEXT NOT NULL, model TEXT NOT NULL, title TEXT, agent_mode TEXT NOT NULL, created_at INTEGER NOT NULL, last_activity_at INTEGER NOT NULL); CREATE TABLE message_nodes (row_id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, node_id INTEGER NOT NULL, parent_node_id INTEGER, chat_message TEXT NOT NULL, created_at INTEGER NOT NULL, metadata TEXT); INSERT INTO sessions VALUES ('one', '/synthetic', 'windsurf', 'claude-sonnet-4', NULL, 'accept-edits', 1, 1);";
fn devin_cli_insert(db: &Path, chat_message: &str, created_at: i64) {
    rusqlite::Connection::open(db)
        .unwrap()
        .execute(
            "INSERT INTO message_nodes (session_id, node_id, chat_message, metadata, created_at) VALUES ('one', 1, ?1, NULL, ?2)",
            rusqlite::params![chat_message, created_at],
        )
        .unwrap();
}
fn devin_cli_observed(
    home: &PathBuf,
    profile: &PathBuf,
    checkpoint: Option<OfflineCheckpoint>,
) -> (
    LocalImport,
    crate::offline_io::ImportWork,
    OfflineCheckpoint,
) {
    let (result, work, next) = collect_observed_since(
        home,
        "devin-cli",
        std::slice::from_ref(home),
        Some(std::slice::from_ref(profile)),
        0,
        checkpoint.or_else(|| Some(OfflineCheckpoint::default())),
    );
    (result.unwrap(), work, next.unwrap())
}
#[test]
fn devin_cli_checkpoint_reuses_an_unchanged_database_and_replays_every_change() {
    let (_temp, home) = root();
    let profile = home.join("custom");
    let db = profile.join("sessions.db");
    database(&db, DEVIN_CLI_SCHEMA);
    let row = |input: i64| {
        format!(
            "{{\"role\":\"assistant\",\"metadata\":{{\"metrics\":{{\"input_tokens\":{input},\"output_tokens\":2,\"total_time_ms\":5000}}}}}}"
        )
    };
    devin_cli_insert(&db, &row(10), 1_700_000_000);
    let oracle = |home: &PathBuf, profile: &PathBuf| {
        collect_profile(
            home,
            "devin-cli",
            std::slice::from_ref(home),
            std::slice::from_ref(profile),
        )
        .unwrap()
        .messages
    };
    let (cold, work, checkpoint) = devin_cli_observed(&home, &profile, None);
    assert_eq!(work.reused_files, 0);
    assert_eq!(cold.messages.len(), 1);
    assert_eq!(cold.messages, oracle(&home, &profile));
    let (warm, work, checkpoint) = devin_cli_observed(&home, &profile, Some(checkpoint));
    assert_eq!(work.reused_files, 1);
    assert_eq!(work.parsed_bytes, 0);
    assert!(work.verified_bytes > 0);
    assert_eq!(warm.messages, oracle(&home, &profile));
    // A new row changes the database (and possibly leaves a WAL sidecar).
    devin_cli_insert(&db, &row(20), 1_700_000_010);
    let (grown, work, checkpoint) = devin_cli_observed(&home, &profile, Some(checkpoint));
    assert_eq!(work.reused_files, 0);
    assert_eq!(grown.messages.len(), 2);
    assert_eq!(grown.messages, oracle(&home, &profile));
    // A late correction under the same mtime and size still replays.
    let old_time = fs::metadata(&db).unwrap().modified().unwrap();
    rusqlite::Connection::open(&db)
        .unwrap()
        .execute(
            "UPDATE message_nodes SET chat_message = ?1 WHERE created_at = 1700000010",
            rusqlite::params![row(30)],
        )
        .unwrap();
    fs::File::options()
        .write(true)
        .open(&db)
        .unwrap()
        .set_modified(old_time)
        .unwrap();
    let (corrected, work, checkpoint) = devin_cli_observed(&home, &profile, Some(checkpoint));
    assert_eq!(work.reused_files, 0);
    assert_eq!(corrected.messages[1].tokens.input, 30);
    assert_eq!(corrected.messages, oracle(&home, &profile));
    // Copy with a preserved mtime changes only the file identity.
    let copy = profile.join("copy.pending");
    fs::copy(&db, &copy).unwrap();
    fs::rename(&copy, &db).unwrap();
    for sidecar in ["sessions.db-wal", "sessions.db-shm", "sessions.db-journal"] {
        let _ = fs::remove_file(profile.join(sidecar));
    }
    fs::File::options()
        .write(true)
        .open(&db)
        .unwrap()
        .set_modified(old_time)
        .unwrap();
    let (copied, work, checkpoint) = devin_cli_observed(&home, &profile, Some(checkpoint));
    assert_eq!(work.reused_files, 0);
    assert_eq!(copied.messages, oracle(&home, &profile));
    let (_, work, _) = devin_cli_observed(&home, &profile, Some(checkpoint));
    assert_eq!(work.reused_files, 1);
}
#[test]
fn devin_cli_health_counters_measure_mismatch_and_clamps() {
    let (_temp, home) = root();
    let profile = home.join("custom");
    let db = profile.join("sessions.db");
    database(&db, DEVIN_CLI_SCHEMA);
    devin_cli_insert(
        &db,
        "{\"role\":\"assistant\",\"metadata\":{\"metrics\":{\"input_tokens\":10,\"output_tokens\":2}}}",
        1_700_000_000,
    );
    devin_cli_insert(&db, "{\"role\":[1]}", 1_700_000_001);
    devin_cli_insert(
        &db,
        "{\"role\":\"assistant\",\"metadata\":{\"metrics\":{\"input_tokens\":-10,\"output_tokens\":2}}}",
        1_700_000_002,
    );
    let (first, work, checkpoint) = devin_cli_observed(&home, &profile, None);
    assert_eq!(first.messages.len(), 2);
    assert_eq!(work.schema_mismatch_records, 1);
    assert_eq!(work.clamped_records, 1);
    assert_eq!(work.fallback_records, 0);
    let (_, warm, _) = devin_cli_observed(&home, &profile, Some(checkpoint));
    assert_eq!(warm.reused_files, 1);
    assert_eq!(warm.schema_mismatch_records, 1);
    assert_eq!(warm.clamped_records, 1);
}
