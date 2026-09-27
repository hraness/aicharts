use super::*;
use aicharts_import::UnifiedMessage;

fn options_fixture() -> Options {
    Options {
        home: PathBuf::from("/synthetic"),
        clients: vec!["codex".to_owned()],
        source_roots: Vec::new(),
        first_utc_day: 20_715,
        day_count: 1,
        json: true,
        health_json: false,
    }
}
fn message() -> UnifiedMessage {
    serde_json::from_value(serde_json::json!({
        "client":"codex", "model_id":"gpt-5", "provider_id":"openai", "session_id":"PRIVATE_SESSION_CANARY",
        "workspace_key":"PRIVATE_WORKSPACE_CANARY", "workspace_label":"PRIVATE_TITLE_CANARY",
        "timestamp":20_715u64*DAY_MS, "date":"IGNORED_PRIVATE_DATE", "tokens":{"input":100,"output":20,"cache_read":30,"cache_write":10,"reasoning":5},
        "cost":0.0, "cost_source":"unknown", "duration_ms":null, "message_count":1,
        "agent":"PRIVATE_AGENT_CANARY", "dedup_key":"PRIVATE_DEDUP_CANARY", "session_title":"PRIVATE_TITLE_CANARY"
    })).unwrap()
}
fn imported(messages: Vec<UnifiedMessage>) -> LocalImport {
    LocalImport {
        messages,
        receipt: aicharts_import::ReadReceipt {
            files: 1,
            bytes: 512,
            observations: 1,
            ..Default::default()
        },
    }
}
fn projected(messages: Vec<UnifiedMessage>) -> Result<(Source, Vec<Row>), &'static str> {
    project(
        "codex",
        imported(messages),
        &options_fixture(),
        20_716 * DAY_MS - 1,
    )
}

#[test]
fn projects_disjoint_tokens_without_private_metadata_or_invented_cost() {
    let (source, rows) = projected(vec![message()]).unwrap();
    assert_eq!(source.records, 1);
    assert_eq!(
        rows[0].tokens,
        Tokens {
            input: "100".into(),
            output: "20".into(),
            cache_read: "30".into(),
            cache_write: "10".into(),
            reasoning: "5".into()
        }
    );
    assert_eq!(rows[0].reported_cost_microusd, None);
    assert_eq!(rows[0].estimated_cost_microusd, None);
    assert_eq!(rows[0].duration_ms, None);
    assert_eq!(rows[0].model.as_deref(), Some("gpt-5"));
    let json = serde_json::to_string(&(source, rows)).unwrap();
    assert!(!json.contains("PRIVATE"));
    assert!(!json.contains("IGNORED"));
}
#[test]
fn totals_above_javascript_integer_precision_remain_exact() {
    let mut a = message();
    a.tokens.input = 9_007_199_254_740_991;
    let (_, rows) = projected(vec![a.clone(), a]).unwrap();
    assert_eq!(rows[0].tokens.input, "18014398509481982");
    assert_eq!(rows[0].records, 2);
}
#[test]
fn unknown_model_names_and_conflicting_attribution_are_withheld() {
    let mut a = message();
    a.model_id = "PRIVATE_MODEL_ALIAS".into();
    a.provider_id = "PRIVATE_ENDPOINT".into();
    let (_, rows) = projected(vec![a]).unwrap();
    assert_eq!(rows[0].model, None);
    assert_eq!(rows[0].provider, None);
    let mut a = message();
    a.model_attribution_conflicted = true;
    assert_eq!(projected(vec![a]).unwrap().1[0].model, None);
}
#[test]
fn zero_reported_cost_is_known_while_reported_and_estimated_costs_stay_separate() {
    let mut a = message();
    a.cost_source = CostSource::ProviderReported;
    a.cost = 0.0;
    let mut b = message();
    b.cost_source = CostSource::Estimated;
    b.cost = 0.123456;
    let (_, rows) = projected(vec![a, b, message()]).unwrap();
    assert_eq!(rows[0].reported_cost_microusd.as_deref(), Some("0"));
    assert_eq!(rows[0].estimated_cost_microusd.as_deref(), Some("123456"));
    assert_eq!(
        (
            rows[0].reported_cost_records,
            rows[0].estimated_cost_records,
            rows[0].records
        ),
        (1, 1, 3)
    );
}
#[test]
fn timed_metrics_only_include_the_timed_population() {
    let mut a = message();
    a.duration_ms = Some(1000);
    let (_, rows) = projected(vec![a, message()]).unwrap();
    assert_eq!(rows[0].duration_ms.as_deref(), Some("1000"));
    assert_eq!(rows[0].timed_records, 1);
    assert_eq!(rows[0].timed_tokens, "165");
}
#[test]
fn utc_window_is_inclusive_at_start_exclusive_at_end() {
    let mut a = message();
    a.timestamp = (20_715 * DAY_MS - 1) as i64;
    let mut b = message();
    b.timestamp = (20_716 * DAY_MS) as i64;
    let (source, rows) = projected(vec![a, b, message()]).unwrap();
    assert_eq!(source.records, 1);
    assert_eq!(rows.len(), 1);
}
#[test]
fn invalid_counter_cost_and_future_observation_refuse_whole_client() {
    for a in [
        {
            let mut a = message();
            a.tokens.input = -1;
            a
        },
        {
            let mut a = message();
            a.tokens.output = i64::MAX;
            a
        },
        {
            let mut a = message();
            a.cost_source = CostSource::ProviderReported;
            a.cost = f64::NAN;
            a
        },
        {
            let mut a = message();
            a.message_count = -1;
            a
        },
    ] {
        assert!(projected(vec![message(), a]).is_err());
    }
    assert!(project(
        "codex",
        imported(vec![message()]),
        &options_fixture(),
        20_715 * DAY_MS - 1
    )
    .is_err());
}
#[test]
fn dates_and_selectors_are_explicit_bounded_and_deduplicated() {
    let now = 20_715 * DAY_MS;
    let parse = |args: &[&str]| {
        options(
            &args.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>(),
            now,
        )
    };
    assert_eq!(date_day("1970-01-01").unwrap(), 0);
    for value in ["1969-12-31", "2026-02-30", "2026-9-01", "2026-09-19extra"] {
        assert!(date_day(value).is_err());
    }
    assert!(parse(&["--home", "/synthetic", "--client", "codex"]).is_ok());
    for args in [
        vec!["--home", "/synthetic"],
        vec!["--home", "relative", "--client", "codex"],
        vec![
            "--home",
            "/synthetic",
            "--client",
            "codex",
            "--client",
            "codex",
        ],
        vec!["--home", "/synthetic", "--all", "--client", "codex"],
        vec!["--home", "/synthetic", "--client", "secret-model"],
    ] {
        assert!(parse(&args).is_err());
    }
}

fn report_fixture() -> Report {
    let (source, rows) = projected(vec![message()]).unwrap();
    Report {
        schema_version: 2,
        profile: "client-stats-v2".into(),
        registry_revision: 1,
        first_utc_day: 20_715,
        day_count: 1,
        generated_at_ms: 20_716 * DAY_MS - 1,
        revision: 0,
        updated_at_ms: None,
        sources: vec![source],
        rows,
    }
}

#[test]
fn persisted_reports_reject_invalid_coverage_and_private_identifiers() {
    let report = report_fixture();
    validate_report(&report).unwrap();
    for invalid in [
        {
            let mut r = report.clone();
            r.rows[0].model = Some("PRIVATE_ALIAS".into());
            r
        },
        {
            let mut r = report.clone();
            r.rows[0].tokens.input = "01".into();
            r
        },
        {
            let mut r = report.clone();
            r.rows.push(r.rows[0].clone());
            r
        },
        {
            let mut r = report.clone();
            r.sources[0].records = 2;
            r
        },
        {
            let mut r = report.clone();
            r.rows[0].token_basis = "unavailable".into();
            r
        },
        {
            let mut r = report.clone();
            r.revision = 1;
            r
        },
        {
            let mut r = report.clone();
            r.rows[0].reported_cost_records = 1;
            r
        },
        {
            let mut r = report.clone();
            r.rows[0].timed_records = 1;
            r.rows[0].duration_ms = Some("1000".into());
            r.rows[0].timed_tokens = "166".into();
            r
        },
        {
            // An inherited cumulative counter admitted as usage: the forked-
            // rollout failure mode. The wire bound is 2^23 tokens per record.
            let mut r = report.clone();
            r.rows[0].tokens.input = "8388609".into();
            r
        },
    ] {
        assert!(validate_report(&invalid).is_err());
    }
    let mut boundary = report.clone();
    boundary.rows[0].tokens.input =
        (8_388_608u128 - [30u128, 10, 20, 5].into_iter().sum::<u128>()).to_string();
    validate_report(&boundary).unwrap();
}

#[test]
fn native_report_matches_shared_json_fixture() {
    let expected: Report =
        serde_json::from_str(include_str!("../../../../fixtures/usage/stats-v2.json")).unwrap();
    assert_eq!(report_fixture(), expected);
    validate_report(&expected).unwrap();
}

#[test]
fn a_cost_only_or_secondary_model_row_remains_an_observation() {
    let mut row = message();
    row.message_count = 0;
    row.tokens.input = 0;
    row.tokens.output = 0;
    row.tokens.cache_read = 0;
    row.tokens.cache_write = 0;
    row.tokens.reasoning = 0;
    row.cost_source = CostSource::ProviderReported;
    row.cost = 0.25;
    let (source, rows) = projected(vec![row.clone()]).unwrap();
    assert_eq!(source.records, 1);
    assert_eq!(rows[0].token_basis, "unavailable");
    assert_eq!(rows[0].reported_cost_microusd.as_deref(), Some("250000"));
    assert_eq!(rows[0].reported_cost_records, 1);
    row.message_count = -1;
    assert_eq!(projected(vec![row]).unwrap_err(), "stats_record_invalid");
}

#[test]
fn a_live_scan_uses_completion_time_and_refuses_clock_regression() {
    let base = std::fs::canonicalize(std::env::temp_dir()).unwrap();
    let root = base.join(format!(
        "aicharts-stats-clock-{}-{}",
        std::process::id(),
        now_ms().unwrap()
    ));
    let source = root.join(".reasonix/stats");
    std::fs::create_dir_all(&source).unwrap();
    std::fs::write(source.join("2026-09-19.jsonl"), "{\"ts\":\"2026-09-19T01:00:00Z\",\"model\":\"deepseek/deepseek-chat\",\"prompt\":100,\"completion\":20,\"total\":120}\n").unwrap();
    let mut options = options_fixture();
    options.home = root.clone();
    options.clients = vec!["reasonix".into()];
    let start = 20_715 * DAY_MS;
    let finish = start + 3_600_001;
    let report = collect_with_clock(&options, start, || Ok(finish)).unwrap();
    assert_eq!(report.generated_at_ms, finish);
    assert_eq!(report.sources[0].status, "observed");
    assert_eq!(report.sources[0].records, 1);
    assert_eq!(
        collect_with_clock(&options, start, || Ok(start - 1)).unwrap_err(),
        "stats_clock_regressed"
    );
    std::fs::remove_dir_all(root).unwrap();
}

struct HealthFixture(PathBuf);
impl HealthFixture {
    fn new() -> Self {
        static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let base = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let path = base.join(format!(
            "aicharts-health-{}-{}-{}",
            std::process::id(),
            now_ms().unwrap(),
            SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir(&path).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        std::fs::create_dir_all(path.join("sessions")).unwrap();
        Self(path)
    }
    fn source(&self) -> PathBuf {
        self.0
            .join("sessions/rollout-2026-09-19T10-00-00-0192f3a4-5b6c-7d8e-9f01-23456789abcd.jsonl")
    }
    fn options(&self) -> Options {
        Options {
            home: self.0.clone(),
            source_roots: vec![self.0.join("sessions")],
            ..options_fixture()
        }
    }
    fn write(&self, input: u64) {
        let context = "{\"timestamp\":\"2026-09-19T10:00:00Z\",\"type\":\"turn_context\",\"payload\":{\"model\":\"gpt-5.4\",\"title\":\"PRIVATE_HEALTH_CANARY\"}}\n";
        let row = format!("{{\"timestamp\":\"2026-09-19T10:00:01Z\",\"type\":\"event_msg\",\"payload\":{{\"type\":\"token_count\",\"info\":{{\"total_token_usage\":{{\"input_tokens\":{input},\"cached_input_tokens\":2,\"output_tokens\":3,\"reasoning_output_tokens\":1}},\"last_token_usage\":{{\"input_tokens\":{input},\"cached_input_tokens\":2,\"output_tokens\":3,\"reasoning_output_tokens\":1}}}}}}}}\n");
        std::fs::write(self.source(), context.to_owned() + &row).unwrap();
    }
}
impl Drop for HealthFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn source_health_distinguishes_complete_partial_failed_and_clamped_without_writes() {
    use aicharts_import::{HealthCode, ImportOutcome};
    let fixture = HealthFixture::new();
    let options = fixture.options();
    let now = options.first_utc_day * DAY_MS;
    let collect =
        || collect_detailed_with_clock(&options, now, || Ok(now + DAY_MS - 1), None).unwrap();
    let absent = collect();
    assert_eq!(absent.report.sources[0].status, "not_found");
    assert_eq!(
        absent.health.sources[0].observation.health.outcome,
        ImportOutcome::Failed
    );
    assert_eq!(absent.health.sources[0].observation.health.records, Some(0));
    fixture.write(10);
    let good = collect();
    assert_eq!(good.report.sources[0].status, "observed");
    assert_eq!(good.report.sources[0].warnings, 0);
    assert_eq!(
        good.health.sources[0]
            .observation
            .health
            .schema_mismatch_records,
        Some(0)
    );
    let before = std::fs::read(fixture.source()).unwrap();
    let output = serde_json::to_string(&good.health).unwrap();
    assert!(!output.contains(fixture.0.to_str().unwrap()));
    assert!(!output.contains("PRIVATE_HEALTH_CANARY"));
    assert!(!output.contains("scope"));
    assert_eq!(std::fs::read_dir(&fixture.0).unwrap().count(), 1);
    assert_eq!(std::fs::read(fixture.source()).unwrap(), before);
    let mut partial = before;
    partial.extend_from_slice(b"{\"timestamp\":");
    std::fs::write(fixture.source(), partial).unwrap();
    let incomplete = collect();
    assert_eq!(incomplete.report.sources[0].status, "incomplete");
    assert!(incomplete.report.sources[0].records > 0);
    assert!(incomplete.report.sources[0].warnings > 0);
    assert_eq!(
        incomplete.health.sources[0].observation.health.outcome,
        ImportOutcome::Partial
    );
    std::fs::write(fixture.source(), b"{malformed}\n").unwrap();
    let failed = collect();
    assert_eq!(failed.report.sources[0].records, 0);
    assert_eq!(failed.report.sources[0].status, "incomplete");
    assert_eq!(
        failed.health.sources[0].observation.health.outcome,
        ImportOutcome::Failed
    );
    fixture.write(1); // The parser can normalize this invalid cache/input pair.
    let clamped = collect();
    assert_eq!(clamped.report.sources[0].status, "incomplete");
    let evidence = &clamped.health.sources[0].observation.health;
    assert_eq!(evidence.clamped_records, Some(1));
    assert_eq!(evidence.outcome, ImportOutcome::Failed);
    assert!(evidence.codes.contains(&HealthCode::Clamped));
    assert!(evidence.codes.contains(&HealthCode::ProjectionRefused));
}

#[test]
fn health_and_numeric_exports_have_distinct_explicit_profiles() {
    let now = 20_716 * DAY_MS;
    let args = |values: &[&str]| values.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let base = ["--home", "/synthetic", "--client", "codex"];
    let mut flags = args(&base);
    flags.push("--health-json".into());
    let value = options(&flags, now).unwrap();
    assert!(value.health_json);
    assert!(!value.json);
    flags.push("--json".into());
    assert!(options(&flags, now).is_err());
    flags.pop();
    flags.push("--health-json".into());
    assert!(options(&flags, now).is_err());
}

#[cfg(unix)]
#[test]
fn incomplete_collection_preserves_persisted_good_observation_and_checkpoint() {
    let fixture = HealthFixture::new();
    let options = fixture.options();
    fixture.write(10);
    let state = fixture.0.join("state");
    std::fs::create_dir(&state).unwrap();
    let now = options.first_utc_day * DAY_MS;
    let mut persistence = health::Persistence::open(&options, &state, true).unwrap();
    let first = collect_detailed_with_clock(
        &options,
        now,
        || Ok(now + DAY_MS - 2),
        Some(&mut persistence),
    )
    .unwrap();
    assert_eq!(first.report.sources[0].status, "observed");
    let first_binding = first.health.sources[0].binding.unwrap();
    let exported = serde_json::to_string(&first.health).unwrap();
    assert!(!exported.contains("binding"));
    assert!(!exported.contains("scope"));
    let stored = state.join("source-checkpoint-codex-v1/checkpoint.bin");
    let bytes = std::fs::read(&stored).unwrap();
    drop(persistence);
    let mut text = std::fs::read(fixture.source()).unwrap();
    text.extend_from_slice(b"{\"timestamp\":");
    std::fs::write(fixture.source(), text).unwrap();
    let mut reopened = health::Persistence::open(&options, &state, true).unwrap();
    let second = collect_detailed_with_clock(
        &options,
        now + DAY_MS - 2,
        || Ok(now + DAY_MS - 1),
        Some(&mut reopened),
    )
    .unwrap();
    assert_eq!(second.report.sources[0].status, "incomplete");
    assert_ne!(second.health.sources[0].binding.unwrap(), first_binding);
    assert_eq!(std::fs::read(&stored).unwrap(), bytes);
    drop(reopened);
    let health =
        crate::source_health::SourceHealthStore::open(&state.join("source-health-v1")).unwrap();
    let status = health.status("codex", health::observation_scope("codex", &options));
    assert_eq!(status.last_good.unwrap().completed_at_ms, now + DAY_MS - 2);
    assert_eq!(
        status.last_attempt.unwrap().health.outcome,
        aicharts_import::ImportOutcome::Partial
    );
    assert!(status.last_publication.is_none());
    drop(health);
    std::fs::remove_file(fixture.source()).unwrap();
    let mut missing = health::Persistence::open(&options, &state, true).unwrap();
    let third = collect_detailed_with_clock(
        &options,
        now + DAY_MS - 1,
        || Ok(now + DAY_MS - 1),
        Some(&mut missing),
    )
    .unwrap();
    assert_eq!(third.report.sources[0].status, "not_found");
    assert_eq!(
        third.health.sources[0].observation.health.outcome,
        aicharts_import::ImportOutcome::Failed
    );
    assert_ne!(
        third.health.sources[0].binding,
        second.health.sources[0].binding
    );
    assert_eq!(std::fs::read(&stored).unwrap(), bytes);
    drop(missing);
    let status = crate::source_health::SourceHealthStore::read_status(
        &state.join("source-health-v1"),
        "codex",
        health::observation_scope("codex", &options),
    )
    .unwrap()
    .unwrap();
    assert_eq!(status.last_good.unwrap().completed_at_ms, now + DAY_MS - 2);
    assert_eq!(
        status.last_attempt.unwrap().health.outcome,
        aicharts_import::ImportOutcome::Failed
    );
    assert!(status.last_publication.is_none());
}

#[cfg(unix)]
#[test]
fn retained_health_inspection_does_not_create_an_absent_store_or_reveal_paths() {
    let fixture = HealthFixture::new();
    let state = fixture.0.join("missing-state");
    let args = vec![
        "stats-health".into(),
        "--state-dir".into(),
        state.to_str().unwrap().into(),
        "--home".into(),
        fixture.0.to_str().unwrap().into(),
        "--client".into(),
        "codex".into(),
    ];
    let text = run_retained_health(&args).unwrap();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["profile"], "retained-source-health-v1");
    for name in ["lastAttempt", "lastGood", "lastPublication"] {
        assert!(value[name].is_null());
    }
    assert!(!state.exists());
    assert!(!text.contains(fixture.0.to_str().unwrap()));
}
