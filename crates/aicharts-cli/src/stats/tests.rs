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
    ] {
        assert!(validate_report(&invalid).is_err());
    }
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
