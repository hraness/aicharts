//! Kernel routing at the detailed-stats boundary.
use super::*;
use aicharts_import::UnifiedMessage;

fn message(cost: f64, cost_source: CostSource) -> UnifiedMessage {
    let mut message: UnifiedMessage = serde_json::from_value(serde_json::json!({
        "client":"codex", "model_id":"gpt-5", "provider_id":"openai", "session_id":"PRIVATE_SESSION_CANARY",
        "workspace_key":"PRIVATE_WORKSPACE_CANARY", "workspace_label":"PRIVATE_TITLE_CANARY",
        "timestamp":20_715u64*DAY_MS, "date":"IGNORED_PRIVATE_DATE", "tokens":{"input":100,"output":20,"cache_read":30,"cache_write":10,"reasoning":5},
        "cost":0.0, "cost_source":"unknown", "duration_ms":null, "message_count":1,
        "agent":"PRIVATE_AGENT_CANARY", "dedup_key":"PRIVATE_DEDUP_CANARY", "session_title":"PRIVATE_TITLE_CANARY"
    }))
    .unwrap();
    message.cost = cost;
    message.cost_source = cost_source;
    message
}
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
fn reported_cost(cost: f64) -> String {
    let import = LocalImport {
        messages: vec![message(cost, CostSource::ProviderReported)],
        receipt: aicharts_import::ReadReceipt {
            files: 1,
            bytes: 512,
            observations: 1,
            ..Default::default()
        },
    };
    let (_, rows) = project("codex", import, &options_fixture(), 20_716 * DAY_MS - 1).unwrap();
    rows[0].reported_cost_microusd.clone().unwrap()
}
/// The retired projection, kept only as the divergence witness.
fn retired_float_cost(value: f64) -> u128 {
    (value * 1_000_000.0).round() as u128
}

#[test]
fn source_costs_round_half_up_from_the_written_decimal_not_a_binary_product() {
    // 124.5 micro-dollars: the binary product 0.0001245 * 1e6 is
    // 124.49999999999999 and the retired projection kept 124.
    assert_eq!(retired_float_cost(0.000_124_5), 124);
    assert_eq!(cost_microusd(0.000_124_5), Ok(125));
    assert_eq!(reported_cost(0.000_124_5), "125");
    // Near 2^53 micro-dollars the binary product cannot carry the last digit
    // and the retired projection fabricated a micro-dollar.
    assert_eq!(
        retired_float_cost(9_007_199_253.999_98),
        9_007_199_253_999_981
    );
    assert_eq!(
        cost_microusd(9_007_199_253.999_98),
        Ok(9_007_199_253_999_980)
    );
    assert_eq!(reported_cost(9_007_199_253.999_98), "9007199253999980");
    // Unchanged cases keep their exact values.
    for (value, expected) in [
        (0.0, 0),
        (-0.0, 0),
        (0.123_456, 123_456),
        (0.25, 250_000),
        (0.000_003_5, 4),
        (1.0, 1_000_000),
        (9_007_199_254.0, 9_007_199_254_000_000),
    ] {
        assert_eq!(cost_microusd(value), Ok(expected), "{value}");
        assert_eq!(retired_float_cost(value), expected, "{value}");
    }
    for invalid in [
        f64::NAN,
        f64::INFINITY,
        -0.000_001,
        9_007_199_254.000_01,
        1e300,
    ] {
        assert_eq!(cost_microusd(invalid), Err("stats_cost_invalid"));
    }
}

/// A private Codex session root, as the shared health fixture builds one.
struct SessionFixture(PathBuf);
impl SessionFixture {
    fn new() -> Self {
        static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let base = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let path = base.join(format!(
            "aicharts-kernel-{}-{}-{}",
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
        let context = "{\"timestamp\":\"2026-09-19T10:00:00Z\",\"type\":\"turn_context\",\"payload\":{\"model\":\"gpt-5.4\",\"title\":\"PRIVATE_KERNEL_CANARY\"}}\n";
        let row = "{\"timestamp\":\"2026-09-19T10:00:01Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":10,\"cached_input_tokens\":2,\"output_tokens\":3,\"reasoning_output_tokens\":1},\"last_token_usage\":{\"input_tokens\":10,\"cached_input_tokens\":2,\"output_tokens\":3,\"reasoning_output_tokens\":1}}}}\n";
        std::fs::write(
            path.join(
                "sessions/rollout-2026-09-19T10-00-00-0192f3a4-5b6c-7d8e-9f01-23456789abcd.jsonl",
            ),
            context.to_owned() + row,
        )
        .unwrap();
        Self(path)
    }
    fn options(&self) -> Options {
        Options {
            home: self.0.clone(),
            source_roots: vec![self.0.join("sessions")],
            ..options_fixture()
        }
    }
}
impl Drop for SessionFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn a_malformed_tariff_refuses_the_client_and_surfaces_in_measured_health() {
    use aicharts_import::{HealthCode, ImportOutcome};
    let fixture = SessionFixture::new();
    let options = fixture.options();
    let now = options.first_utc_day * DAY_MS;
    let collect =
        || collect_detailed_with_clock(&options, now, || Ok(now + DAY_MS - 1), None).unwrap();
    let observed = collect();
    assert_eq!(observed.report.sources[0].status, "observed");
    let row = &observed.report.rows[0];
    // The estimate is consulted only for an identified provider and model.
    let key = format!(
        "{}\\u0000{}",
        row.provider.as_deref().unwrap(),
        row.model.as_deref().unwrap()
    );
    let catalog = |input: &str| {
        format!(
            "{{\"rates\":{{\"{key}\":{{\"input\":\"{input}\",\"cacheRead\":\"1\",\"cacheWrite\":null,\"output\":\"2\"}}}}}}"
        )
    };
    // The seam feeds the ordinary estimate: the row's normalized buckets at
    // one million pico-USD per uncached input token, one per cached read and
    // two per output token price exactly as the kernel prices them.
    let priced = pricing::with_catalog(&catalog("1000000"), collect);
    assert_eq!(priced.report.sources[0].status, "observed");
    let tokens = &priced.report.rows[0].tokens;
    let buckets = [
        &tokens.input,
        &tokens.cache_read,
        &tokens.cache_write,
        &tokens.output,
        &tokens.reasoning,
    ]
    .map(|text| decimal(text).unwrap());
    assert!(buckets[0] > 0 && buckets[3] > 0);
    let expected = aicharts_metrics::price_microusd(
        buckets,
        [Some(1_000_000), Some(1), None, Some(2), Some(2)],
    )
    .unwrap();
    assert!(expected > 0);
    assert_eq!(
        priced.report.rows[0].estimated_cost_microusd,
        Some(expected.to_string())
    );
    assert_eq!(priced.report.rows[0].estimated_cost_records, 1);
    // The retired projection read a malformed rate as an absent tariff and
    // left the estimate silently unknown. A checked-in fault now refuses the
    // client's projection: the source is incomplete with a warning and its
    // measured health records the refusal, so the fault is visible in
    // `--json` and `--health-json` instead of hidden in a missing number.
    for malformed in ["2.5e6", "", "1_000_000", "-1"] {
        let refused = pricing::with_catalog(&catalog(malformed), collect);
        let source = &refused.report.sources[0];
        assert_eq!(
            (source.status.as_str(), source.records, source.warnings),
            ("incomplete", 0, 1),
            "{malformed:?}"
        );
        assert!(refused.report.rows.is_empty());
        let health = &refused.health.sources[0].observation.health;
        assert_eq!(health.outcome, ImportOutcome::Failed);
        assert!(health.codes.contains(&HealthCode::ProjectionRefused));
    }
    // Without a tariff the estimate stays unknown and the row is complete.
    let unpriced = pricing::with_catalog("{\"rates\":{}}", collect);
    assert_eq!(unpriced.report.sources[0].status, "observed");
    assert_eq!(unpriced.report.rows[0].estimated_cost_microusd, None);
}

fn row(records: u64) -> Row {
    Row {
        utc_day: 20_715,
        client: "codex".to_owned(),
        provider: Some("openai".to_owned()),
        model: Some("gpt-5".to_owned()),
        tokens: Tokens {
            input: "100".to_owned(),
            cache_read: "30".to_owned(),
            cache_write: "10".to_owned(),
            output: "20".to_owned(),
            reasoning: "5".to_owned(),
        },
        records,
        reported_cost_microusd: Some("250000".to_owned()),
        reported_cost_records: 2,
        estimated_cost_microusd: None,
        estimated_cost_records: 0,
        duration_ms: Some("4000".to_owned()),
        timed_records: 1,
        timed_tokens: "165".to_owned(),
        token_basis: "reported".to_owned(),
        breakdown_coverage: "complete".to_owned(),
    }
}

#[test]
fn cost_cohorts_select_exactly_the_rows_the_shared_explorer_selects() {
    // Wholly covered, known tokens, complete breakdown: cost over row tokens.
    let cohorts = row_cohorts(&row(2), 165).unwrap();
    let reported = cohorts.reported.unwrap();
    assert_eq!((reported.left, reported.right), (250_000, 165));
    assert_eq!(
        (reported.left_basis, reported.right_basis),
        (Basis::Reported, Basis::Reported)
    );
    assert_eq!(
        reported.ratio().unwrap().rounded(Rounding::HalfUp),
        Ok(1_515)
    );
    assert!(cohorts.estimated.is_none());
    let timed = cohorts.timed.unwrap();
    assert_eq!((timed.left, timed.right), (165, 4_000));
    // Partial price coverage has no attributable token denominator.
    assert!(row_cohorts(&row(3), 165).unwrap().reported.is_none());
    // Partial breakdown coverage (every native row) is excluded as in TS.
    let partial = Row {
        breakdown_coverage: "partial".to_owned(),
        ..row(2)
    };
    assert!(row_cohorts(&partial, 165).unwrap().reported.is_none());
    assert!(row_cohorts(&partial, 165).unwrap().timed.is_some());
    // Unavailable token basis never enters a cohort, even a cost-only row.
    let unavailable = Row {
        token_basis: "unavailable".to_owned(),
        tokens: Tokens {
            input: "0".to_owned(),
            cache_read: "0".to_owned(),
            cache_write: "0".to_owned(),
            output: "0".to_owned(),
            reasoning: "0".to_owned(),
        },
        duration_ms: None,
        timed_records: 0,
        timed_tokens: "0".to_owned(),
        breakdown_coverage: "partial".to_owned(),
        ..row(2)
    };
    let cohorts = row_cohorts(&unavailable, 0).unwrap();
    assert!(cohorts.reported.is_none() && cohorts.timed.is_none());
    // A zero-token cohort keeps its cost but has no ratio, never a zero.
    let zero_tokens = Row {
        tokens: unavailable.tokens.clone(),
        timed_tokens: "0".to_owned(),
        ..row(2)
    };
    let reported = row_cohorts(&zero_tokens, 0).unwrap().reported.unwrap();
    assert_eq!(
        reported.ratio(),
        Err(aicharts_metrics::Error::ZeroDenominator)
    );
    // Amounts without records, or records without amounts, are refused.
    for broken in [
        Row {
            reported_cost_records: 0,
            ..row(2)
        },
        Row {
            reported_cost_microusd: None,
            ..row(2)
        },
        Row {
            duration_ms: None,
            ..row(2)
        },
        Row {
            timed_records: 0,
            ..row(2)
        },
        Row {
            reported_cost_microusd: Some("01".to_owned()),
            ..row(2)
        },
    ] {
        assert_eq!(row_cohorts(&broken, 165), Err("stats_report_invalid"));
    }
    // Populations differ by row identity and cohort grain.
    assert_ne!(
        row_population(&row(2), GRAIN_REPORTED_COST),
        row_population(&row(2), GRAIN_TIMED)
    );
    assert_ne!(
        row_population(&row(2), GRAIN_REPORTED_COST),
        row_population(
            &Row {
                provider: None,
                ..row(2)
            },
            GRAIN_REPORTED_COST
        )
    );
    assert_ne!(
        row_population(&row(2), GRAIN_REPORTED_COST),
        row_population(
            &Row {
                provider: Some(String::new()),
                ..row(2)
            },
            GRAIN_REPORTED_COST
        )
    );
}

#[test]
fn row_totals_and_summaries_add_in_full_width() {
    let tokens = Tokens {
        input: "9".repeat(24),
        cache_read: "9".repeat(24),
        cache_write: "9".repeat(24),
        output: "9".repeat(24),
        reasoning: "9".repeat(24),
    };
    assert_eq!(row_token_total(&tokens), Some(5 * (10u128.pow(24) - 1)));
    assert_eq!(
        row_token_total(&Tokens {
            input: "1e3".to_owned(),
            ..tokens
        }),
        None
    );
    assert_eq!(
        evidence_text(cost_evidence(0, 1, Basis::Reported)).as_deref(),
        Some("0")
    );
    assert_eq!(evidence_text(cost_evidence(7, 0, Basis::Estimated)), None);
}
