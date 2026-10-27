use super::*;
use std::fs;
fn write(root: &Path, relative: &str) -> PathBuf {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, b"").unwrap();
    path
}
fn count(scan: &ScanResult) -> usize {
    scan.total_files()
        + scan.opencode_dbs.len()
        + scan.micode_dbs.len()
        + scan.openclaw_dbs.len()
        + scan.devin_dbs.len()
        + scan.crush_dbs.len()
        + scan.copilot_vscode_sessions.len()
        + [
            &scan.kilo_db,
            &scan.goose_db,
            &scan.kiro_db,
            &scan.zcode_db,
            &scan.copilot_desktop_db,
            &scan.copilot_session_store_db,
        ]
        .iter()
        .filter(|v| v.is_some())
        .count()
}
#[test]
fn every_primary_profile_discovers_its_canonical_store() {
    let examples = [
        ("opencode", "opencode.db"),
        ("claude", "p/s.jsonl"),
        ("codex", "sessions/s.jsonl"),
        ("cursor", "usage.json"),
        ("gemini", "session.json"),
        ("amp", "T-s.json"),
        ("droid", "s.settings.json"),
        ("openclaw", "main/agent/openclaw-agent.sqlite"),
        ("pi", "s.jsonl"),
        ("kimi", "p/wire.jsonl"),
        ("qwen", "p/s.jsonl"),
        ("roocode", "p/ui_messages.json"),
        ("kilocode", "p/ui_messages.json"),
        ("mux", "p/session-usage.json"),
        ("kilo", "kilo.db"),
        ("crush", "crush.db"),
        ("hermes", "state.db"),
        ("copilot", "session-store.db"),
        ("goose", "sessions.db"),
        ("codebuff", "projects/p/chats/c/chat-messages.json"),
        ("antigravity", "s.jsonl"),
        ("zed", "threads.db"),
        ("kiro", "data.sqlite3"),
        ("trae", "sessions.json"),
        ("warp", "usage.json"),
        ("cline", "s.messages.json"),
        ("gjc", "s.jsonl"),
        ("grok", "unified.jsonl"),
        ("jcode", "session_s.json"),
        ("commandcode", "s.jsonl"),
        ("micode", "mimocode-stable.db"),
        ("micode-desktop", "mimocode.db"),
        ("muse", "2026/09/18/s/session.jsonl"),
        ("antigravity-cli", "s.db"),
        ("antigravity-extension", "x.db"),
        ("junie", "events.jsonl"),
        ("zcode", "db.sqlite"),
        ("opencodereview", "s.jsonl"),
        ("codebuddy", "extension.log"),
        ("workbuddy", "workbuddy.db"),
        ("devin-cli", "sessions.db"),
        ("devin-desktop", "s.ndjson"),
        ("senpi", "s.jsonl"),
        ("augment", "s.json"),
        ("kimchi", "s.jsonl"),
        ("reasonix", "day.jsonl"),
        ("prime-agent", "session-artifacts/s.jsonl"),
        ("freebuff", "projects/p/chats/c/chat-messages.json"),
        ("cherrystudio", "p/s.jsonl"),
        ("dsh", "session.v1.jsonl.zstd"),
        ("mcode", "s.jsonl"),
        ("fx", "s/usage-v2.json"),
        ("omp", "s.jsonl"),
        ("lmstudio", "nested/server.log"),
        ("unsloth", "studio.db"),
        ("hindsight", "month.jsonl"),
    ];
    assert_eq!(examples.len(), ClientId::COUNT);
    let mut ids = HashSet::new();
    for (client, path) in examples {
        assert!(ids.insert(client));
        let temp = tempfile::tempdir().unwrap();
        write(temp.path(), path);
        assert_eq!(
            count(&scan(client, &[temp.path().to_path_buf()])),
            1,
            "{client}"
        );
    }
}
#[test]
fn companion_stores_retain_upstream_lanes_without_default_discovery() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let files = [
        "opencode.db",
        "opencode-beta.db",
        "opencode.db-wal",
        "storage/message/s/m.json",
    ];
    for file in files {
        write(root, file);
    }
    let result = scan("opencode", &[root.to_path_buf(), root.join("storage")]);
    assert_eq!(result.opencode_dbs.len(), 2);
    assert_eq!(result.get(ClientId::OpenCode).len(), 1);
    assert!(result.micode_dbs.is_empty());
}
#[test]
fn copilot_splits_otel_desktop_cli_and_vscode_sources() {
    let temp = tempfile::tempdir().unwrap();
    for file in [
        "otel/export.jsonl",
        "data.db",
        "session-store.db",
        "workspaceStorage/hash/chatSessions/s.jsonl",
    ] {
        write(temp.path(), file);
    }
    let result = scan("copilot", &[temp.path().to_path_buf()]);
    assert_eq!(result.get(ClientId::Copilot).len(), 1);
    assert_eq!(result.copilot_vscode_sessions.len(), 1);
    assert!(result.copilot_desktop_db.is_some() && result.copilot_session_store_db.is_some());
}
#[test]
fn openclaw_user_codex_context_and_agent_owned_rollouts_stay_distinct() {
    let temp = tempfile::tempdir().unwrap();
    for file in [
        "user/sessions/rollout-user.jsonl",
        "agents/main/agent/codex-home/sessions/rollout-owned.jsonl",
        "agents/main/agent/openclaw-agent.sqlite",
        "agents/main/sessions/a.jsonl",
    ] {
        write(temp.path(), file);
    }
    let result = scan("openclaw", &[temp.path().to_path_buf()]);
    assert_eq!(result.get(ClientId::Codex).len(), 1);
    assert_eq!(result.get(ClientId::OpenClaw).len(), 2);
    assert_eq!(result.openclaw_dbs.len(), 1);
}
#[test]
fn devin_desktop_keeps_cli_lookup_and_freebuff_uses_shared_bucket() {
    let temp = tempfile::tempdir().unwrap();
    for file in [
        "acp/s.ndjson",
        "cli/sessions.db",
        "projects/p/chats/c/chat-messages.json",
    ] {
        write(temp.path(), file);
    }
    let result = scan("devin-desktop", &[temp.path().to_path_buf()]);
    assert_eq!(result.get(ClientId::DevinDesktop).len(), 1);
    assert_eq!(result.devin_dbs.len(), 1);
    let result = scan("freebuff", &[temp.path().to_path_buf()]);
    assert_eq!(result.get(ClientId::Codebuff).len(), 1);
    assert!(result.get(ClientId::Freebuff).is_empty());
}
#[test]
fn mixed_file_formats_and_rlm_exclusion_survive_profiles() {
    let temp = tempfile::tempdir().unwrap();
    for file in [
        "s/ui_messages.json",
        "cli/s.messages.json",
        "sessions/s/updates.jsonl",
        "logs/unified.jsonl",
        "projects/a.jsonl",
        "workbuddy.db",
        "session-artifacts/child.jsonl",
        "session-artifacts/rlm-subagents.jsonl",
    ] {
        write(temp.path(), file);
    }
    let roots = [temp.path().to_path_buf()];
    assert_eq!(scan("cline", &roots).get(ClientId::Cline).len(), 2);
    assert_eq!(scan("grok", &roots).get(ClientId::Grok).len(), 2);
    assert_eq!(scan("workbuddy", &roots).get(ClientId::WorkBuddy).len(), 6);
    assert_eq!(
        scan("prime-agent", &roots).get(ClientId::PrimeAgent).len(),
        4
    );
}
#[test]
fn cherry_v2_precedence_and_cursor_json_precedence_are_retained() {
    let temp = tempfile::tempdir().unwrap();
    let old = temp.path().join("CherryStudio/.claude/projects");
    let new = temp
        .path()
        .join("CherryStudio/Data/Agents/.claude/projects");
    write(&old, "p/s.jsonl");
    let winner = write(&new, "p/s.jsonl");
    write(&old, "p/old.jsonl");
    let result = scan("cherrystudio", &[old, new]);
    assert_eq!(result.get(ClientId::CherryStudio).len(), 2);
    assert!(result.get(ClientId::CherryStudio).contains(&winner));
    let common = scan("cherrystudio", &[temp.path().join("CherryStudio")]);
    assert_eq!(
        common.get(ClientId::CherryStudio),
        result.get(ClientId::CherryStudio)
    );
    write(temp.path(), "usage.json");
    write(temp.path(), "usage.csv");
    assert_eq!(
        scan("cursor", &[temp.path().to_path_buf()])
            .get(ClientId::Cursor)
            .len(),
        1
    );
}

#[test]
fn kiro_extensionless_files_require_the_native_global_storage_role() {
    let temp = tempfile::tempdir().unwrap();
    for file in [
        "README",
        "lock",
        "globalStorage/kiro.kiroagent/session",
        "snapshots/session.chat",
        "sessions/sess_id/session.json",
        "sessions/sess_id/messages.jsonl",
    ] {
        write(temp.path(), file);
    }
    let result = scan("kiro", &[temp.path().to_path_buf()]);
    assert_eq!(result.get(ClientId::Kiro).len(), 3);
    assert!(!result.get(ClientId::Kiro).iter().any(|path| path
        .file_name()
        .is_some_and(|name| name == "README" || name == "lock")));
}
#[test]
fn alias_and_synthetic_stores_do_not_expand_other_clients() {
    let temp = tempfile::tempdir().unwrap();
    write(temp.path(), "s.jsonl");
    write(temp.path(), "sqlite.db");
    assert_eq!(
        scan("9router", &[temp.path().to_path_buf()])
            .get(ClientId::Gjc)
            .len(),
        1
    );
    assert_eq!(synthetic_dbs(&[temp.path().to_path_buf()]).len(), 1);
}
