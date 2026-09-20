use super::*;
use std::collections::VecDeque;
const NOW: u64 = 1_789_862_399_999;
fn metadata(time: Option<u64>) -> Value {
    let mut usage = json!({"inputTokens":10,"outputTokens":3,"cacheReadTokens":2,"thinkingOutputTokens":1,"responseId":"private-response","privateContent":"NEVER_CACHE"});
    if let Some(time) = time {
        usage["timestamp"] = time.into()
    }
    json!({"generatorMetadata":[{"chatModel":{"model":"gpt-5","retryInfos":[{"usage":usage}]}}]})
}
struct Fake {
    calls: VecDeque<(&'static str, Result<Value>)>,
    count: usize,
}
impl Fake {
    fn new(calls: Vec<(&'static str, Value)>) -> Self {
        Self {
            calls: calls.into_iter().map(|(m, v)| (m, Ok(v))).collect(),
            count: 0,
        }
    }
}
impl Transport for Fake {
    fn rpc(&mut self, _: usize, method: &str, _: Value, _: Duration, _: usize) -> Result<Vec<u8>> {
        let (expected, result) = self.calls.pop_front().expect("bounded fixture requests");
        assert_eq!(method, expected);
        self.count += 1;
        result.and_then(|value| serde_json::to_vec(&value).map_err(|_| INVALID))
    }
}
fn budget() -> Budget {
    Budget {
        started: Instant::now(),
        bytes: 0,
    }
}
#[test]
fn remote_hosts_and_methods_never_reach_local_relaxed_tls_transport() {
    for tls in [false, true] {
        assert!(rpc_url("127.0.0.1", 4444, tls, "Heartbeat").is_ok());
        for host in [
            "localhost",
            "127.0.0.1.evil",
            "192.0.2.1",
            "::1",
            "https://127.0.0.1",
        ] {
            assert!(rpc_url(host, 4444, tls, "Heartbeat").is_err())
        }
        assert!(rpc_url("127.0.0.1", 0, tls, "Heartbeat").is_err());
        assert!(rpc_url("127.0.0.1", 4444, tls, "../remote").is_err())
    }
}
#[test]
fn summaries_require_known_schema_and_all_ids_are_bounded() {
    assert!(summaries(&json!({"error":"challenge"})).is_err());
    assert!(summaries(&json!({"trajectorySummaries":[{}]})).is_err());
    assert_eq!(
        summaries(&json!({"trajectorySummaries":{"session":{"stepCount":1}}})).unwrap(),
        vec![("session".into(), 0)]
    );
    assert!(
        summaries(&json!({"trajectorySummaries":[{"cascadeId":"same"},{"cascadeId":"same"}]}))
            .is_err()
    );
}
#[test]
fn missing_timestamps_are_enriched_without_recording_private_trajectory_content() {
    let mut transport = Fake::new(vec![
        (
            "GetAllCascadeTrajectories",
            json!({"trajectorySummaries":[{"cascadeId":"session"}]}),
        ),
        ("GetCascadeTrajectoryGeneratorMetadata", metadata(None)),
        (
            "GetCascadeTrajectory",
            json!({"trajectory":{"steps":[{"metadata":{"createdAt":"2026-09-19T01:00:00Z","modelUsage":{"responseId":"private-response"}},"privateContent":"DO_NOT_STORE"}]}}),
        ),
    ]);
    let bytes = collect(&mut transport, 1, &BTreeMap::new(), &mut budget(), NOW).unwrap();
    let text = String::from_utf8(bytes.clone()).unwrap();
    for forbidden in [
        "DO_NOT_STORE",
        "NEVER_CACHE",
        "private-response",
        "\"session\"",
    ] {
        assert!(!text.contains(forbidden))
    }
    let rows = decode_cache(Some(&bytes), NOW).unwrap();
    assert_eq!(rows.len(), 1);
    let row = rows.values().next().unwrap();
    assert_eq!(row.timestamp, 1_789_779_600_000);
    assert_eq!(
        [row.input, row.output, row.cache_read, row.reasoning],
        [10, 3, 2, 1]
    );
}
#[test]
fn matching_cached_usage_keeps_its_original_time_when_metadata_has_none() {
    let meta = metadata(Some(1_789_779_600_000));
    let row = normalize(
        "session",
        meta["generatorMetadata"].as_array().unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        NOW,
    )
    .unwrap()
    .remove(0);
    let old = BTreeMap::from([(row.response_id.clone(), row.clone())]);
    let meta = metadata(None);
    let next = normalize(
        "session",
        meta["generatorMetadata"].as_array().unwrap(),
        &BTreeMap::new(),
        &old,
        NOW,
    )
    .unwrap();
    assert!(next == vec![row]);
}
#[test]
fn unqualified_timestamps_never_become_refresh_time() {
    let meta = metadata(None);
    assert_eq!(
        normalize(
            "session",
            meta["generatorMetadata"].as_array().unwrap(),
            &BTreeMap::new(),
            &BTreeMap::new(),
            NOW
        )
        .err(),
        Some("antigravity_refresh_timestamp_unavailable")
    );
    let mut bad = metadata(Some(NOW + 1));
    assert!(normalize(
        "session",
        bad["generatorMetadata"].as_array().unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        NOW
    )
    .is_err());
    bad["generatorMetadata"][0]["chatModel"]["retryInfos"][0]["usage"]["inputTokens"] = json!(-1);
    assert!(normalize(
        "session",
        bad["generatorMetadata"].as_array().unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        NOW
    )
    .is_err());
}
#[test]
fn expired_budget_fails_before_any_rpc() {
    let mut transport = Fake::new(vec![]);
    let mut budget = Budget {
        started: Instant::now() - BUDGET,
        bytes: 0,
    };
    assert_eq!(
        collect(&mut transport, 1, &BTreeMap::new(), &mut budget, NOW).err(),
        Some("antigravity_refresh_timeout")
    );
    assert_eq!(transport.count, 0);
}
#[test]
fn failed_or_empty_session_refresh_preserves_private_cache() {
    use std::{
        fs,
        os::unix::fs::PermissionsExt,
        sync::atomic::{AtomicU64, Ordering},
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let path = fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "aicharts-antigravity-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
    fs::create_dir(&path).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
    let cache = disk::Cache::open(&path).unwrap();
    let mut first = Fake::new(vec![
        (
            "GetAllCascadeTrajectories",
            json!({"trajectorySummaries":[{"cascadeId":"session"}]}),
        ),
        (
            "GetCascadeTrajectoryGeneratorMetadata",
            metadata(Some(1_789_779_600_000)),
        ),
    ]);
    refresh(
        &cache,
        "scope".into(),
        &mut first,
        1,
        Instant::now(),
        NOW,
        0,
    )
    .unwrap();
    let original = fs::read(path.join("usage.jsonl")).unwrap();
    let mut failed = Fake {
        calls: VecDeque::from([("GetAllCascadeTrajectories", Err("fixture_failure"))]),
        count: 0,
    };
    assert_eq!(
        refresh(
            &cache,
            "scope".into(),
            &mut failed,
            1,
            Instant::now(),
            NOW,
            0
        )
        .err(),
        Some("fixture_failure")
    );
    let mut empty = Fake::new(vec![
        (
            "GetAllCascadeTrajectories",
            json!({"trajectorySummaries":[{"cascadeId":"session"}]}),
        ),
        (
            "GetCascadeTrajectoryGeneratorMetadata",
            json!({"generatorMetadata":[]}),
        ),
    ]);
    assert_eq!(
        refresh(
            &cache,
            "scope".into(),
            &mut empty,
            1,
            Instant::now(),
            NOW,
            0
        )
        .err(),
        Some("antigravity_refresh_empty_preserved")
    );
    assert_eq!(fs::read(path.join("usage.jsonl")).unwrap(), original);
    drop(cache);
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn matching_response_ids_in_distinct_sessions_cannot_collide() {
    let meta = metadata(Some(1_789_779_600_000));
    let rows = meta["generatorMetadata"].as_array().unwrap();
    let first = normalize("session-1", rows, &BTreeMap::new(), &BTreeMap::new(), NOW)
        .unwrap()
        .remove(0);
    let second = normalize("session-2", rows, &BTreeMap::new(), &BTreeMap::new(), NOW)
        .unwrap()
        .remove(0);
    assert_ne!(first.response_id, second.response_id);
}
#[test]
fn omitted_history_remains_and_existing_session_replaces_without_double_counting() {
    let old_meta = metadata(Some(1_789_779_600_000));
    let old = normalize(
        "older",
        old_meta["generatorMetadata"].as_array().unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        NOW,
    )
    .unwrap()
    .remove(0);
    let current = normalize(
        "current",
        old_meta["generatorMetadata"].as_array().unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        NOW,
    )
    .unwrap()
    .remove(0);
    let previous = BTreeMap::from([
        (old.response_id.clone(), old.clone()),
        (current.response_id.clone(), current),
    ]);
    let mut updated = metadata(Some(1_789_779_600_000));
    updated["generatorMetadata"][0]["chatModel"]["retryInfos"][0]["usage"]["inputTokens"] =
        json!(25);
    let mut transport = Fake::new(vec![
        (
            "GetAllCascadeTrajectories",
            json!({"trajectorySummaries":[{"cascadeId":"current"}]}),
        ),
        ("GetCascadeTrajectoryGeneratorMetadata", updated),
    ]);
    let bytes = collect(&mut transport, 1, &previous, &mut budget(), NOW).unwrap();
    let rows = decode_cache(Some(&bytes), NOW).unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.get(&old.response_id) == Some(&old));
    assert_eq!(rows.values().map(|row| row.input).sum::<u64>(), 35);
}
