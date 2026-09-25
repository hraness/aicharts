use super::*;
fn report() -> Report {
    let mut value: Report =
        serde_json::from_str(include_str!("../../../../fixtures/usage/stats-v2.json")).unwrap();
    value.revision = 0;
    value.updated_at_ms = None;
    let first = value.sources[0].client.clone();
    value.sources.retain(|s| s.client == first);
    value.rows.retain(|r| r.client == first);
    value
}
pub(super) fn upload() -> Upload {
    Upload {
        schema_version: 2,
        operation_id: "11".repeat(32),
        account_id: format!("acct_{}", "22".repeat(16)),
        device_id: "33".repeat(32),
        generation: "44".repeat(32),
        sequence: 1,
        expected_revision: 0,
        mode: "preserve-history".to_owned(),
        takeover: None,
        report: report(),
    }
}
#[test]
fn empty_incomplete_and_attribution_filter_cannot_publish() {
    let original = report();
    assert!(eligible(&original).is_ok());
    for status in ["empty", "not_found", "incomplete", "unavailable"] {
        let mut changed = original.clone();
        changed.sources[0].status = status.to_owned();
        assert!(eligible(&changed).is_err());
    }
    let mut changed = original.clone();
    changed.sources[0].warnings = 1;
    assert!(eligible(&changed).is_err());
    let mut changed = original.clone();
    changed.sources[0].client = "9router".to_owned();
    for row in &mut changed.rows {
        row.client = "9router".to_owned();
    }
    assert!(eligible(&changed).is_err());
}
#[test]
fn dry_run_refuses_unpublishable_reports_without_enrollment_or_transport() {
    let original = report();
    let output = dry_run_report(original.clone()).unwrap();
    assert_eq!(serde_json::from_str::<Report>(&output).unwrap(), original);
    let mut warning = original.clone();
    warning.sources[0].warnings = 1;
    stats::validate_report(&warning).unwrap();
    assert_eq!(dry_run_report(warning), Err("stats_sync_incomplete_source"));
    let mut incomplete = original;
    incomplete.rows.clear();
    incomplete.sources[0].status = "incomplete".into();
    incomplete.sources[0].records = 0;
    incomplete.sources[0].latest_at_ms = None;
    stats::validate_report(&incomplete).unwrap();
    assert_eq!(
        dry_run_report(incomplete),
        Err("stats_sync_incomplete_source")
    );
}
#[test]
fn known_empty_period_is_a_noop_while_missing_incomplete_and_warning_sources_fail() {
    let mut empty = report();
    empty.rows.clear();
    empty.sources[0].status = "empty".into();
    empty.sources[0].records = 0;
    empty.sources[0].latest_at_ms = None;
    for client in ["codex", "warp"] {
        empty.sources[0].client = client.into();
        assert_eq!(
            validate_publication(empty.clone()),
            Err("stats_sync_no_observations")
        );
    }
    for status in ["not_found", "incomplete", "unavailable"] {
        let mut invalid = empty.clone();
        invalid.sources[0].status = status.into();
        assert_eq!(
            validate_publication(invalid),
            Err("stats_sync_incomplete_source")
        );
    }
    empty.sources[0].warnings = 1;
    assert_eq!(
        validate_publication(empty),
        Err("stats_sync_incomplete_source")
    );
}
#[test]
fn local_readiness_checks_wire_size_and_warp_snapshot_semantics_without_state() {
    let original = report();
    validate_publication(original.clone()).unwrap();
    let mut warp = original.clone();
    warp.sources[0].client = "warp".into();
    warp.sources[0].token_basis = "unavailable".into();
    for row in &mut warp.rows {
        row.client = "warp".into();
        row.token_basis = "unavailable".into();
        row.tokens = stats::Tokens {
            input: "0".into(),
            cache_read: "0".into(),
            cache_write: "0".into(),
            output: "0".into(),
            reasoning: "0".into(),
        };
        row.timed_tokens = "0".into();
        row.breakdown_coverage = "partial".into();
    }
    validate_publication(warp.clone()).unwrap();
    warp.sources[0].token_basis = "reported".into();
    for row in &mut warp.rows {
        row.token_basis = "reported".into();
    }
    assert_eq!(
        validate_publication(warp),
        Err("stats_sync_snapshot_invalid")
    );

    // A valid local report below the hosted row cap can still exceed its wire
    // byte cap. Reserve room for the envelope, not merely the report itself.
    let registry: serde_json::Value =
        serde_json::from_str(include_str!("../../../../data/usage-registry.json")).unwrap();
    let mut models: Vec<String> = registry["models"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_owned())
        .collect();
    models.sort_by_key(|model| std::cmp::Reverse(model.len()));
    models.truncate(32);
    models.sort();
    assert!(models.len() >= 32);
    let mut large = original;
    large.day_count = 366;
    let template = large.rows[0].clone();
    large.rows.clear();
    for day in 0..256 {
        for model in models.iter() {
            let mut row = template.clone();
            row.utc_day = large.first_utc_day + day;
            row.model = Some(model.clone());
            // The per-record plausibility bound admits at most 8,388,608
            // tokens per record, so wire-size pressure must come from the
            // unbounded cost and duration fields instead.
            row.records = 1_000;
            row.tokens = stats::Tokens {
                input: "8388608000".to_owned(),
                cache_read: "0".to_owned(),
                cache_write: "0".to_owned(),
                output: "0".to_owned(),
                reasoning: "0".to_owned(),
            };
            row.reported_cost_microusd = Some("9".repeat(24));
            row.reported_cost_records = 1;
            row.estimated_cost_microusd = Some("9".repeat(24));
            row.estimated_cost_records = 1;
            row.duration_ms = Some("9".repeat(24));
            row.timed_records = 1;
            row.timed_tokens = "8388608000".to_owned();
            large.rows.push(row);
        }
    }
    large.sources[0].records = large.rows.len() as u64 * 1_000;
    stats::validate_report(&large).unwrap();
    let wire = serde_json::to_vec(&large).unwrap().len();
    assert!(wire > MAX_BYTES, "{wire} <= {MAX_BYTES}");
    assert_eq!(validate_publication(large), Err("stats_sync_limit"));
}
#[test]
fn flight_rejects_identity_bounds_arbitrary_registry_and_unknown_fields() {
    let value = upload();
    assert!(value.validate().is_ok());
    let mut changed = value.clone();
    changed.sequence = 0;
    assert!(changed.validate().is_err());
    let mut changed = value.clone();
    changed.mode = "replace-window".to_owned();
    assert!(changed.validate().is_err());
    let mut changed = value.clone();
    changed.report.rows[0].model = Some("PRIVATE_CANARY".to_owned());
    assert!(changed.validate().is_err());
    let mut raw = serde_json::to_value(&value).unwrap();
    raw["credential"] = serde_json::json!("PRIVATE_CANARY");
    assert!(serde_json::from_value::<Upload>(raw).is_err());
}
#[test]
fn receipt_must_correlate_exact_bytes_window_sequence_and_commit_clock() {
    let value = upload();
    let now = value.report.generated_at_ms;
    let receipt = Receipt {
        schema_version: 2,
        operation_id: value.operation_id.clone(),
        body_hash: body_hash(&value).unwrap(),
        sequence: 1,
        revision: 1,
        committed_at_ms: now,
        client: value.report.sources[0].client.clone(),
        first_utc_day: value.report.first_utc_day,
        day_count: value.report.day_count,
    };
    assert!(receipt.matches(&value, now).is_ok());
    for field in [
        "bodyHash",
        "sequence",
        "revision",
        "committedAtMs",
        "dayCount",
    ] {
        let mut changed = serde_json::to_value(&receipt).unwrap();
        changed[field] = if field == "bodyHash" {
            serde_json::json!("00".repeat(32))
        } else {
            serde_json::json!(SAFE)
        };
        assert!(serde_json::from_value::<Receipt>(changed)
            .unwrap()
            .matches(&value, now)
            .is_err());
    }
}
#[test]
fn status_pins_legacy_takeover_but_refuses_unknown_provenance_and_other_writers() {
    let value = upload();
    let mut status = Status {
        schema_version: 2,
        revision: 0,
        next_sequence: 1,
        writer_device_id: None,
        v1_revision: 0,
        head_digest: "00".repeat(32),
        legacy_records: 0,
        takeover_eligible: true,
    };
    assert!(status.validate(&value.device_id).is_ok());
    assert_eq!(status.takeover(&value.device_id).unwrap(), None);
    status.legacy_records = 1;
    status.v1_revision = 12;
    assert_eq!(
        status.takeover(&value.device_id).unwrap(),
        Some(Takeover {
            expected_v1_revision: 12,
            head_digest: "00".repeat(32)
        })
    );
    status.takeover_eligible = false;
    assert_eq!(
        status.takeover(&value.device_id),
        Err("stats_sync_legacy_takeover_required")
    );
    status.takeover_eligible = true;
    status.legacy_records = 0;
    status.writer_device_id = Some("55".repeat(32));
    assert_eq!(
        status.validate(&value.device_id),
        Err("stats_sync_writer_conflict")
    );
}
#[test]
fn typed_takeover_freezes_exact_predecessor_in_the_durable_request() {
    let mut request = upload();
    request.takeover = Some(Takeover {
        expected_v1_revision: 12,
        head_digest: "55".repeat(32),
    });
    request.validate().unwrap();
    let bytes = encoded(&request).unwrap();
    let decoded: Upload = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(request, decoded);
    assert_ne!(body_hash(&request).unwrap(), body_hash(&upload()).unwrap());
    request.takeover.as_mut().unwrap().expected_v1_revision = 4097;
    assert!(request.validate().is_err());
    request.takeover.as_mut().unwrap().expected_v1_revision = 12;
    request.takeover.as_mut().unwrap().head_digest = "arbitrary".to_owned();
    assert!(request.validate().is_err());
}
#[test]
fn abandonment_proof_must_fence_the_exact_flight_and_unknown_fields_refuse() {
    let request = upload();
    let proof = serde_json::json!({"schemaVersion":2,"outcome":"abandoned","operationId":request.operation_id,
        "bodyHash":body_hash(&request).unwrap(),"sequence":request.sequence,"expectedRevision":request.expected_revision,"fencedAtRevision":1});
    assert_eq!(
        serde_json::from_value::<Abandonment>(proof.clone())
            .unwrap()
            .validate(&request, 1_800_000_000_000)
            .unwrap(),
        None
    );
    for (name, value) in [
        ("bodyHash", serde_json::json!("00".repeat(32))),
        ("operationId", serde_json::json!("77".repeat(32))),
        ("fencedAtRevision", serde_json::json!(0)),
        ("fencedAtRevision", serde_json::json!(1_000_001)),
        ("sequence", serde_json::json!(2)),
        ("expectedRevision", serde_json::json!(1)),
    ] {
        let mut changed = proof.clone();
        changed[name] = value;
        assert!(serde_json::from_value::<Abandonment>(changed)
            .unwrap()
            .validate(&request, 1_800_000_000_000)
            .is_err());
    }
    let mut changed = proof;
    changed["receipt"] = serde_json::json!({});
    assert!(serde_json::from_value::<Abandonment>(changed).is_err());
    let args = |values: &[&str]| values.iter().map(|v| (*v).to_owned()).collect::<Vec<_>>();
    assert!(options(
        &args(&[
            "stats-sync",
            "--state-dir",
            "/s",
            "--key-file",
            "/k",
            "--abandon"
        ]),
        1_800_000_000_000
    )
    .is_ok());
    for flags in [
        vec!["--resume"],
        vec!["--dry-run"],
        vec!["--home", "/h"],
        vec!["--client", "codex"],
        vec!["--source-root", "/c"],
    ] {
        let mut values = vec![
            "stats-sync",
            "--state-dir",
            "/s",
            "--key-file",
            "/k",
            "--abandon",
        ];
        values.extend(flags);
        assert!(options(&args(&values), 1_800_000_000_000).is_err());
    }
}
#[test]
fn resume_never_accepts_source_flags_and_live_requires_one_explicit_client() {
    let args = |items: &[&str]| items.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
    assert!(options(
        &args(&[
            "stats-sync",
            "--state-dir",
            "/a",
            "--key-file",
            "/k",
            "--resume"
        ]),
        1_800_000_000_000
    )
    .is_ok());
    assert!(options(
        &args(&[
            "stats-sync",
            "--state-dir",
            "/a",
            "--key-file",
            "/k",
            "--resume",
            "--home",
            "/h"
        ]),
        1_800_000_000_000
    )
    .is_err());
    assert!(options(
        &args(&[
            "stats-sync",
            "--dry-run",
            "--home",
            "/h",
            "--client",
            "cursor"
        ]),
        1_800_000_000_000
    )
    .is_ok());
    assert!(options(
        &args(&[
            "stats-sync",
            "--dry-run",
            "--home",
            "/h",
            "--client",
            "cursor",
            "--client",
            "codex"
        ]),
        1_800_000_000_000
    )
    .is_err());
}

#[test]
fn incremental_collection_requires_an_explicit_fresh_codex_profile() {
    let args = |items: &[&str]| items.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
    let base = [
        "stats-sync",
        "--state-dir",
        "/state",
        "--key-file",
        "/key",
        "--home",
        "/home",
        "--client",
        "codex",
        "--source-root",
        "/profile",
    ];
    let mut values = args(&base);
    values.push("--incremental".into());
    assert!(options(&values, 1_800_000_000_000).unwrap().incremental);
    for extra in ["--resume", "--abandon", "--dry-run", "--incremental"] {
        let mut invalid = values.clone();
        invalid.push(extra.into());
        assert!(options(&invalid, 1_800_000_000_000).is_err());
    }
    let mut no_profile = args(&base[..9]);
    no_profile.push("--incremental".into());
    assert_eq!(
        options(&no_profile, 1_800_000_000_000).err(),
        Some("stats_incremental_profile_required")
    );
    let mut other = values;
    other[8] = "claude".into();
    assert_eq!(
        options(&other, 1_800_000_000_000).err(),
        Some("stats_incremental_profile_required")
    );
}

#[test]
fn shared_wire_fixture_keeps_native_and_worker_hashes_identical() {
    for (text, expected) in [
        (
            include_str!("../../../../fixtures/usage/stats-upload-v2.json"),
            include_str!("../../../../fixtures/usage/stats-upload-v2.sha256"),
        ),
        (
            include_str!("../../../../fixtures/usage/stats-upload-v2-takeover.json"),
            include_str!("../../../../fixtures/usage/stats-upload-v2-takeover.sha256"),
        ),
    ] {
        let text = text.trim();
        let expected = expected.trim();
        let value: Upload = serde_json::from_str(text).unwrap();
        value.validate().unwrap();
        assert_eq!(serde_json::to_string(&value).unwrap(), text);
        assert_eq!(body_hash(&value).unwrap(), expected);
    }
}
#[test]
fn warp_counters_publish_as_one_snapshot_with_no_measured_tokens() {
    let mut report = report();
    report.sources[0].client = "warp".to_owned();
    report.sources[0].token_basis = "unavailable".to_owned();
    for row in &mut report.rows {
        row.client = "warp".to_owned();
        row.token_basis = "unavailable".to_owned();
        row.tokens.input = "0".to_owned();
        row.tokens.output = "0".to_owned();
        row.tokens.cache_read = "0".to_owned();
        row.tokens.cache_write = "0".to_owned();
        row.tokens.reasoning = "0".to_owned();
        row.timed_tokens = "0".to_owned();
        row.breakdown_coverage = "partial".to_owned();
    }
    report.first_utc_day -= 10;
    report.day_count = 11;
    let report = publication_report(report).unwrap();
    assert_eq!(report.day_count, 1);
    let mut request = upload();
    request.report = report;
    request.mode = "replace-snapshot".to_owned();
    assert!(request.validate().is_ok());
    request.mode = "preserve-history".to_owned();
    assert!(request.validate().is_err());
    request.mode = "replace-snapshot".to_owned();
    request.report.rows[0].token_basis = "reported".to_owned();
    assert!(request.validate().is_err());
}

#[test]
fn explicit_source_roots_pass_to_offline_collection_and_resume_rejects_them() {
    let args = |items: &[&str]| items.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
    let options = options(
        &args(&[
            "stats-sync",
            "--dry-run",
            "--home",
            "/h",
            "--client",
            "cursor",
            "--source-root",
            "/c",
            "--source-root",
            "/d",
        ]),
        1_800_000_000_000,
    )
    .unwrap();
    assert_eq!(
        options.collection.unwrap().source_roots,
        vec![PathBuf::from("/c"), PathBuf::from("/d")]
    );
    assert!(super::options(
        &args(&[
            "stats-sync",
            "--state-dir",
            "/a",
            "--key-file",
            "/k",
            "--resume",
            "--source-root",
            "/c"
        ]),
        1_800_000_000_000
    )
    .is_err());
}

#[test]
fn legacy_status_parser_accepts_admitted_million_record_population_and_refuses_excess() {
    let device = upload().device_id;
    for records in [100_001, MAX_LEGACY_RECORDS, MAX_LEGACY_RECORDS + 1] {
        let bytes = serde_json::to_vec(
            &serde_json::json!({"schemaVersion":2,"revision":0,"nextSequence":1,
            "writerDeviceId":null,"v1Revision":12,"headDigest":"00".repeat(32),
            "legacyRecords":records,"takeoverEligible":true}),
        )
        .unwrap();
        let status: Status = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            status.validate(&device),
            if records <= MAX_LEGACY_RECORDS {
                Ok(())
            } else {
                Err("stats_sync_invalid_response")
            }
        );
        if records <= MAX_LEGACY_RECORDS {
            assert!(status.takeover(&device).unwrap().is_some());
        }
    }
}
