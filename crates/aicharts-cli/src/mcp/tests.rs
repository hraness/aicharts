use super::*;
use crate::history::Store;
use crate::stats::{Source, Tokens, DAY_MS};
use std::cell::Cell;

const TODAY: u64 = 20_730;
const NOW: u64 = TODAY * DAY_MS + 7_200_000;

fn row(
    day: u64,
    client: &str,
    model: &str,
    records: u64,
    input: u64,
    reported_microusd: Option<u64>,
) -> Row {
    Row {
        utc_day: day,
        client: client.to_owned(),
        provider: Some(
            if client == "claude" {
                "anthropic"
            } else {
                "openai"
            }
            .to_owned(),
        ),
        model: Some(model.to_owned()),
        tokens: Tokens {
            input: input.to_string(),
            cache_read: "10".to_owned(),
            cache_write: "0".to_owned(),
            output: "5".to_owned(),
            reasoning: "0".to_owned(),
        },
        records,
        reported_cost_microusd: reported_microusd.map(|cost| cost.to_string()),
        reported_cost_records: if reported_microusd.is_some() {
            records
        } else {
            0
        },
        estimated_cost_microusd: None,
        estimated_cost_records: 0,
        duration_ms: None,
        timed_records: 0,
        timed_tokens: "0".to_owned(),
        token_basis: "reported".to_owned(),
        breakdown_coverage: "partial".to_owned(),
    }
}

fn scan_report(
    first: u64,
    count: u64,
    clients: &[&str],
    rows: Vec<Row>,
    generated_at_ms: u64,
) -> Report {
    let sources = clients
        .iter()
        .map(|client| {
            let records: u64 = rows
                .iter()
                .filter(|r| r.client == *client)
                .map(|r| r.records)
                .sum();
            Source {
                client: (*client).to_owned(),
                status: if records > 0 { "observed" } else { "not_found" }.to_owned(),
                token_basis: if records > 0 {
                    "reported"
                } else {
                    "unavailable"
                }
                .to_owned(),
                records,
                warnings: 0,
                latest_at_ms: (records > 0).then_some(generated_at_ms - 1),
            }
        })
        .collect();
    let report = Report {
        schema_version: 2,
        profile: "client-stats-v2".to_owned(),
        registry_revision: 1,
        first_utc_day: first,
        day_count: count,
        generated_at_ms,
        revision: 0,
        updated_at_ms: None,
        sources,
        rows,
    };
    stats::validate_report(&report).unwrap();
    report
}

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("aicharts-mcp-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn seeded(name: &str) -> PathBuf {
    let dir = temp(name);
    let fresh = scan_report(
        TODAY - 2,
        3,
        &["claude", "codex"],
        vec![
            row(
                TODAY - 2,
                "claude",
                "claude-sonnet-4-5",
                2,
                1_000,
                Some(1_500_000),
            ),
            row(TODAY - 1, "codex", "gpt-5", 3, 4_000, None),
            row(TODAY, "claude", "claude-sonnet-4-5", 1, 500, Some(250_000)),
        ],
        NOW,
    );
    let (store, _) = history::merge(&Store::empty(NOW), &fresh, NOW).unwrap();
    std::fs::write(
        dir.join("usage-history.json"),
        serde_json::to_vec(&store).unwrap(),
    )
    .unwrap();
    dir
}

fn exchange(ctx: &Context, lines: &[Value]) -> Vec<Value> {
    let mut input = Vec::new();
    for line in lines {
        input.extend(serde_json::to_vec(line).unwrap());
        input.push(b'\n');
    }
    let mut out = Vec::new();
    serve(ctx, &mut std::io::Cursor::new(input), &mut out).unwrap();
    String::from_utf8(out)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn call(name: &str, arguments: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": name, "arguments": arguments}})
}

fn payload(response: &Value) -> Value {
    assert_eq!(response["result"].get("isError"), None, "{response}");
    serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap()
}

fn context<'a>(
    dir: &Path,
    clock: &'a dyn Fn() -> Result<u64, &'static str>,
    scan: &'a dyn Fn(&stats::Options, u64) -> Result<Report, &'static str>,
) -> Context<'a> {
    Context {
        dir: dir.to_path_buf(),
        home: PathBuf::from("/synthetic-home"),
        clock,
        scan,
    }
}

use std::path::Path;

fn refuse_scan(_: &stats::Options, _: u64) -> Result<Report, &'static str> {
    panic!("the record answers without reading session files")
}

#[test]
fn handshake_lists_only_read_only_tools() {
    let dir = temp("handshake");
    let clock = || -> Result<u64, &'static str> { Ok(NOW) };
    let ctx = context(&dir, &clock, &refuse_scan);
    let replies = exchange(
        &ctx,
        &[
            json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test"}}}),
            json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
            json!({"jsonrpc": "2.0", "id": 3, "method": "initialize", "params": {"protocolVersion": "2099-01-01", "capabilities": {}}}),
            json!({"jsonrpc": "2.0", "id": 4, "method": "initialize", "params": {"protocolVersion": "latest"}}),
        ],
    );
    assert_eq!(replies.len(), 4, "the notification gets no reply");
    assert_eq!(replies[0]["result"]["protocolVersion"], "2025-06-18");
    assert_eq!(replies[0]["result"]["serverInfo"]["name"], "aicharts");
    let names: Vec<&str> = replies[1]["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "usage_summary",
            "usage_daily",
            "usage_report",
            "usage_clients",
            "usage_history_status"
        ]
    );
    for tool in replies[1]["result"]["tools"].as_array().unwrap() {
        assert_eq!(tool["annotations"]["readOnlyHint"], true);
        assert_eq!(tool["inputSchema"]["additionalProperties"], false);
    }
    assert_eq!(replies[2]["result"]["protocolVersion"], PROTOCOL_VERSION);
    assert_eq!(replies[3]["error"]["code"], -32602);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn summaries_and_daily_series_come_from_the_record_without_scanning() {
    let dir = seeded("summary");
    let clock = || -> Result<u64, &'static str> { Ok(NOW) };
    let ctx = context(&dir, &clock, &refuse_scan);
    let replies = exchange(
        &ctx,
        &[
            call("usage_summary", json!({"days": 7})),
            call(
                "usage_summary",
                json!({"days": 7, "group_by": "model", "clients": ["claude"]}),
            ),
            call("usage_daily", json!({"days": 7, "group_by": "client"})),
        ],
    );
    let by_client = payload(&replies[0]);
    assert_eq!(by_client["source"], "history");
    assert_eq!(by_client["uploaded"], false);
    assert_eq!(by_client["groups"][0]["client"], "codex", "largest first");
    assert_eq!(by_client["groups"][0]["tokens"]["total"], 4_015);
    assert_eq!(by_client["groups"][1]["reportedCostUsd"], "1.750000");
    assert_eq!(
        by_client["groups"][0]["reportedCostUsd"],
        Value::Null,
        "unknown, not zero"
    );
    assert_eq!(by_client["total"]["records"], 6);
    let by_model = payload(&replies[1]);
    assert_eq!(by_model["groups"].as_array().unwrap().len(), 1);
    assert_eq!(by_model["groups"][0]["model"], "claude-sonnet-4-5");
    let daily = payload(&replies[2]);
    let series = daily["series"].as_array().unwrap();
    assert_eq!(series.len(), 3);
    assert_eq!(series[0]["date"], history::utc_date(TODAY - 2).unwrap());
    assert_eq!(series[0]["client"], "claude");
    assert_eq!(series[1]["total"], 4_015);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn reports_open_in_the_dashboard_format_or_as_csv() {
    let dir = seeded("report");
    let clock = || -> Result<u64, &'static str> { Ok(NOW) };
    let ctx = context(&dir, &clock, &refuse_scan);
    let replies = exchange(
        &ctx,
        &[
            call("usage_report", json!({"days": 3})),
            call("usage_report", json!({"days": 3, "format": "csv"})),
        ],
    );
    let report: Report = serde_json::from_value(payload(&replies[0])).unwrap();
    stats::validate_report(&report).unwrap();
    assert_eq!(report.rows.len(), 3);
    let csv = replies[1]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(csv.starts_with(history::CSV_HEADER));
    assert_eq!(csv.lines().count(), 4);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn without_a_record_the_tools_read_session_files_and_write_nothing() {
    let dir = temp("fresh");
    let scans = Cell::new(0);
    let scan = |options: &stats::Options, now: u64| -> Result<Report, &'static str> {
        scans.set(scans.get() + 1);
        assert_eq!(options.clients.len(), aicharts_import::all_clients().len());
        Ok(scan_report(
            options.first_utc_day,
            options.day_count,
            &["codex"],
            vec![row(TODAY, "codex", "gpt-5", 1, 100, None)],
            now,
        ))
    };
    let clock = || -> Result<u64, &'static str> { Ok(NOW) };
    let ctx = context(&dir, &clock, &scan);
    let replies = exchange(&ctx, &[call("usage_summary", json!({}))]);
    let summary = payload(&replies[0]);
    assert_eq!(summary["source"], "files");
    assert_eq!(summary["total"]["tokens"]["total"], 115);
    assert_eq!(scans.get(), 1);
    assert_eq!(
        std::fs::read_dir(&dir).unwrap().count(),
        0,
        "read-only: no record appears"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fresh_reads_merge_in_memory_without_lowering_the_record() {
    let dir = seeded("merge");
    let before = std::fs::read(dir.join("usage-history.json")).unwrap();
    let scan = |options: &stats::Options, now: u64| -> Result<Report, &'static str> {
        // The codex day shrank on disk (rotated files) and a new day appeared.
        Ok(scan_report(
            options.first_utc_day,
            options.day_count,
            &["codex"],
            vec![
                row(TODAY - 1, "codex", "gpt-5", 1, 10, None),
                row(TODAY, "codex", "gpt-5", 2, 20, None),
            ],
            now,
        ))
    };
    let clock = || -> Result<u64, &'static str> { Ok(NOW) };
    let ctx = context(&dir, &clock, &scan);
    let replies = exchange(
        &ctx,
        &[call(
            "usage_daily",
            json!({"days": 3, "fresh": true, "clients": ["codex"]}),
        )],
    );
    let daily = payload(&replies[0]);
    assert_eq!(daily["source"], "history+files");
    let series = daily["series"].as_array().unwrap();
    assert_eq!(series.len(), 2);
    assert_eq!(series[0]["records"], 3, "the record's larger day is kept");
    assert_eq!(series[1]["records"], 2);
    assert_eq!(
        std::fs::read(dir.join("usage-history.json")).unwrap(),
        before
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn bad_arguments_and_envelopes_are_refused_without_detail() {
    let dir = seeded("refuse");
    let clock = || -> Result<u64, &'static str> { Ok(NOW) };
    let ctx = context(&dir, &clock, &refuse_scan);
    let replies = exchange(
        &ctx,
        &[
            call("usage_summary", json!({"days": 400})),
            call("usage_summary", json!({"days": 7, "since": "2026-01-01"})),
            call("usage_summary", json!({"clients": ["../etc"]})),
            call("usage_summary", json!({"group_by": "session"})),
            call("usage_summary", json!({"path": "/etc/passwd"})),
            call("usage_clients", json!({"x": 1})),
            call("collect", json!({})),
            json!({"jsonrpc": "1.0", "id": 9, "method": "ping"}),
            json!({"jsonrpc": "2.0", "id": 10, "method": "tools/destroy"}),
        ],
    );
    for reply in &replies[..6] {
        assert_eq!(reply["result"]["isError"], true, "{reply}");
        let text = reply["result"]["content"][0]["text"].as_str().unwrap();
        assert!(!text.contains('/'), "no paths in errors: {text}");
    }
    assert_eq!(replies[6]["error"]["message"], "unknown tool");
    assert_eq!(replies[7]["error"]["code"], -32600);
    assert_eq!(replies[8]["error"]["code"], -32601);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn duplicate_keys_and_oversized_frames_end_the_exchange_safely() {
    let dir = temp("frames");
    let clock = || -> Result<u64, &'static str> { Ok(NOW) };
    let ctx = context(&dir, &clock, &refuse_scan);
    let mut out = Vec::new();
    let duplicate = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"id\":2,\"method\":\"ping\"}\n".to_vec();
    serve(&ctx, &mut std::io::Cursor::new(duplicate), &mut out).unwrap();
    let reply: Value = serde_json::from_slice(out.trim_ascii_end()).unwrap();
    assert_eq!(reply["error"]["code"], -32700);
    let mut out = Vec::new();
    let oversized = vec![b'x'; MAX_FRAME_BYTES + 10];
    serve(&ctx, &mut std::io::Cursor::new(oversized), &mut out).unwrap();
    let reply: Value = serde_json::from_slice(out.trim_ascii_end()).unwrap();
    assert_eq!(reply["error"]["code"], -32600);
    let _ = std::fs::remove_dir_all(&dir);
}
