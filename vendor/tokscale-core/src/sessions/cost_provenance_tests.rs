//! AI Charts regressions: missing cost is not zero; recorded values are not retail estimates.
use super::*;
use serde_json::{json, Value};
use std::{fs, path::Path};
use tempfile::TempDir;

fn json_source(value: &Value, parse: impl Fn(&Path) -> Vec<UnifiedMessage>) -> UnifiedMessage {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("usage.jsonl");
    fs::write(&path, serde_json::to_vec(value).unwrap()).unwrap();
    let mut rows = parse(&path);
    assert_eq!(rows.len(), 1);
    rows.remove(0)
}
#[test]
fn trae_records_valid_zero_and_positive_cost_but_not_absence_or_negative() {
    for (cost, basis) in [
        (json!(0), CostSource::ProviderReported),
        (json!(0.5), CostSource::ProviderReported),
        (Value::Null, CostSource::Unknown),
        (json!(-1), CostSource::Unknown),
    ] {
        let row = json_source(
            &json!([{"session_id":"test","model_name":"GPT-5.4","usage_time":1789776000,"dollar_float":cost,"extra_info":{"input_token":10}}]),
            |p| trae::parse_trae_file("trae", p),
        );
        assert_eq!(row.cost_source, basis);
    }
}
#[test]
fn warp_account_and_workspace_keep_spend_even_when_tokens_are_unavailable() {
    for spend in [Value::Null, json!(0), json!(50), json!(-1)] {
        let expected = if spend.as_i64().is_some_and(|n| n >= 0) {
            CostSource::ProviderReported
        } else {
            CostSource::Unknown
        };
        let usage = json!({"requestsUsed":2,"spendCents":spend,"id":"workspace"});
        for value in [
            json!({"syncedAt":"2026-09-19T01:00:00Z","usage":usage}),
            json!({"syncedAt":"2026-09-19T01:00:00Z","workspaces":[usage]}),
        ] {
            let row = json_source(&value, warp::parse_warp_file);
            assert_eq!(row.cost_source, expected);
            assert_eq!(row.tokens.total(), 0);
        }
    }
}
#[test]
fn mux_requires_cost_coverage_for_every_present_bucket() {
    for cost in [Value::Null, json!(0), json!(0.5)] {
        let row = json_source(
            &json!({"lastRequest":{"timestamp":1789776000000i64},"byModel":{"openai:gpt-5":{"input":{"tokens":10,"cost_usd":cost},"output":{"tokens":2,"cost_usd":0}}}}),
            mux::parse_mux_file,
        );
        assert_eq!(
            row.cost_source,
            if cost.is_null() {
                CostSource::Unknown
            } else {
                CostSource::ProviderReported
            }
        );
    }
}
#[test]
fn openclaw_preserves_present_cost_including_known_zero() {
    for cost in [Value::Null, json!(0), json!(0.5)] {
        let row = json_source(
            &json!({"type":"message","id":"r1","message":{"role":"assistant","model":"gpt-5","provider":"openai","timestamp":1789776000000i64,"usage":{"input":10,"output":2,"cost":{"total":cost}}}}),
            openclaw::parse_openclaw_transcript,
        );
        assert_eq!(
            row.cost_source,
            if cost.is_null() {
                CostSource::Unknown
            } else {
                CostSource::ProviderReported
            }
        );
    }
}
#[test]
fn hindsight_total_resolves_cache_overlap_without_double_counting() {
    for (input, total, expected) in [(100, 120, 70), (70, 120, 70)] {
        let row = json_source(
            &json!({"id":"request","model":"gpt-5","provider":"openai","started_at":"2026-09-19T01:00:00Z","input_tokens":input,"output_tokens":20,"cached_tokens":30,"total_tokens":total}),
            hindsight::parse_hindsight_file,
        );
        assert_eq!(row.tokens.input, expected);
        assert_eq!(row.tokens.cache_read, 30);
        assert_eq!(row.tokens.total(), 120);
        assert_eq!(row.cost_source, CostSource::Unknown);
    }
}
#[test]
fn crush_preserves_recorded_zero_and_missing_cost_separately() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("crush.db");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE sessions(id TEXT,parent_session_id TEXT,cost REAL,created_at INTEGER,updated_at INTEGER,message_count INTEGER); CREATE TABLE messages(session_id TEXT,created_at INTEGER,role TEXT); INSERT INTO sessions VALUES('zero',NULL,0,1789776000,1789776000,1),('missing',NULL,NULL,1789776000,1789776000,1),('positive',NULL,0.5,1789776000,1789776000,1); INSERT INTO messages VALUES('zero',1789776000,'assistant'),('missing',1789776000,'assistant'),('positive',1789776000,'assistant');").unwrap();
    drop(db);
    let rows = crush::parse_crush_sqlite(&path);
    assert_eq!(rows.len(), 3);
    for row in rows {
        assert_eq!(
            row.cost_source,
            if row.session_id.ends_with(":missing") {
                CostSource::Unknown
            } else {
                CostSource::ProviderReported
            }
        );
    }
}
#[test]
fn hermes_distinguishes_actual_estimate_and_missing_nullable_cost() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("state.db");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE sessions(id TEXT,model TEXT,billing_provider TEXT,started_at REAL,message_count INTEGER,input_tokens INTEGER,output_tokens INTEGER,cache_read_tokens INTEGER,cache_write_tokens INTEGER,reasoning_tokens INTEGER,actual_cost_usd REAL,estimated_cost_usd REAL); INSERT INTO sessions VALUES('actual','gpt-5','openai',1789776000,1,10,2,0,0,0,0,0.5),('estimate','gpt-5','openai',1789776000,1,10,2,0,0,0,NULL,0.5),('missing','gpt-5','openai',1789776000,1,10,2,0,0,0,NULL,NULL);").unwrap();
    drop(db);
    let rows = hermes::parse_hermes_sqlite(&path);
    assert_eq!(rows.len(), 3);
    for row in rows {
        assert_eq!(
            row.cost_source,
            match row.session_id.as_str() {
                "actual" => CostSource::ProviderReported,
                "estimate" => CostSource::Estimated,
                _ => CostSource::Unknown,
            }
        );
    }
}
#[test]
fn roocode_valid_zero_has_provenance_and_missing_cost_does_not() {
    for cost in [Value::Null, json!(0), json!(0.5)] {
        let row = json_source(
            &json!([{"type":"say","say":"api_req_started","ts":"2026-09-19T01:00:00Z","text":json!({"tokensIn":10,"tokensOut":2,"cost":cost}).to_string()}]),
            roocode::parse_roocode_file,
        );
        assert_eq!(
            row.cost_source,
            if cost.is_null() {
                CostSource::Unknown
            } else {
                CostSource::ProviderReported
            }
        );
    }
}

#[test]
fn amp_recorded_zero_is_not_overridden_by_positive_fallback() {
    let row = json_source(
        &json!({"id":"thread","created":1789776000000i64,"usageLedger":{"events":[{"timestamp":"2026-09-19T01:00:00Z","model":"gpt-5","credits":0,"toMessageId":1,"tokens":{"input":10,"output":2}}]},"messages":[{"role":"assistant","messageId":1,"usage":{"model":"gpt-5","inputTokens":10,"outputTokens":2,"credits":0.5}}]}),
        amp::parse_amp_file,
    );
    assert_eq!(row.cost, 0.0);
    assert_eq!(row.cost_source, CostSource::ProviderReported);
    let row = json_source(
        &json!({"id":"thread","created":1789776000000i64,"messages":[{"role":"assistant","messageId":1,"usage":{"model":"gpt-5","inputTokens":10,"outputTokens":2}}]}),
        amp::parse_amp_file,
    );
    assert_eq!(row.cost_source, CostSource::Unknown);
}
