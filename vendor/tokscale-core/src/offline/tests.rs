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
