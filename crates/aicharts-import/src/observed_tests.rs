use crate::*;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let home = fs::canonicalize(temp.path()).unwrap();
    let root = home.join("sessions");
    fs::create_dir(&root).unwrap();
    let file = root.join("rollout-2026-09-20T10-00-00-0192f3a4-5b6c-7d8e-9f01-23456789abcd.jsonl");
    (temp, home, root, file)
}
fn context() -> &'static str {
    "{\"timestamp\":\"2026-09-20T10:00:00Z\",\"type\":\"turn_context\",\"payload\":{\"model\":\"gpt-5.4\"}}\n"
}
fn event(index: u64, input: u64) -> String {
    format!("{{\"timestamp\":\"2026-09-20T10:{:02}:{:02}Z\",\"type\":\"event_msg\",\"payload\":{{\"type\":\"token_count\",\"info\":{{\"total_token_usage\":{{\"input_tokens\":{},\"cached_input_tokens\":{},\"output_tokens\":{},\"reasoning_output_tokens\":{}}},\"last_token_usage\":{{\"input_tokens\":{},\"cached_input_tokens\":2,\"output_tokens\":3,\"reasoning_output_tokens\":1}}}}}}}}\n", index / 60, index % 60, input * index, 2 * index, 3 * index, index, input)
}
fn observed(home: &Path, root: &Path, checkpoint: &mut ImportCheckpoint) -> ObservedImport {
    collect_observed(
        home,
        "codex",
        &[home.to_owned()],
        Some(&[root.to_owned()]),
        0,
        Some(checkpoint),
    )
}
fn oracle(home: &Path, root: &Path) -> LocalImport {
    collect_since(
        home,
        "codex",
        &[home.to_owned()],
        Some(&[root.to_owned()]),
        0,
    )
    .unwrap()
}
fn append(path: &Path, text: &str) {
    fs::OpenOptions::new()
        .append(true)
        .open(path)
        .unwrap()
        .write_all(text.as_bytes())
        .unwrap();
}

#[test]
fn observed_codex_append_and_warm_work_match_the_full_scan_oracle() {
    let (_temp, home, root, file) = fixture();
    fs::write(&file, format!("{}{}", context(), event(1, 10))).unwrap();
    let mut checkpoint = ImportCheckpoint::default();
    let cold = observed(&home, &root, &mut checkpoint);
    assert_eq!(cold.health.outcome, ImportOutcome::Complete);
    assert_eq!(cold.health.reused_files, 0);
    assert_eq!(cold.result.unwrap().messages, oracle(&home, &root).messages);
    let warm = observed(&home, &root, &mut checkpoint);
    assert_eq!(warm.health.parsed_bytes, Some(0));
    assert_eq!(warm.health.reused_files, 1);
    assert!(warm.health.verified_bytes > 0);
    assert_eq!(warm.result.unwrap().messages, oracle(&home, &root).messages);
    let delta = event(2, 10);
    append(&file, &delta);
    let incremental = observed(&home, &root, &mut checkpoint);
    assert_eq!(incremental.health.parsed_bytes, Some(delta.len() as u64));
    assert_eq!(incremental.health.reused_files, 1);
    assert_eq!(
        incremental.result.unwrap().messages,
        oracle(&home, &root).messages
    );
    assert_eq!(
        ImportCheckpoint::decode(&checkpoint.encode().unwrap())
            .unwrap()
            .encode()
            .unwrap(),
        checkpoint.encode().unwrap()
    );
}

#[test]
fn observed_checkpoint_replays_copy_rotation_truncation_and_old_mtime_corrections() {
    let (_temp, home, root, file) = fixture();
    let mut checkpoint = ImportCheckpoint::default();
    fs::write(
        &file,
        format!("{}{}{}", context(), event(1, 10), event(2, 10)),
    )
    .unwrap();
    observed(&home, &root, &mut checkpoint).result.unwrap();
    let old_time = fs::metadata(&file).unwrap().modified().unwrap();
    let copy = root.join("copy.pending");
    fs::copy(&file, &copy).unwrap();
    fs::rename(&copy, &file).unwrap();
    fs::File::options()
        .write(true)
        .open(&file)
        .unwrap()
        .set_modified(old_time)
        .unwrap();
    let copied = observed(&home, &root, &mut checkpoint);
    assert_eq!(copied.health.reused_files, 0);
    assert_eq!(
        copied.result.unwrap().messages,
        oracle(&home, &root).messages
    );
    for text in [
        format!("{}{}", context(), event(1, 10)),
        format!("{}{}", context(), event(1, 20)),
    ] {
        fs::write(&file, text).unwrap();
        fs::File::options()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(old_time)
            .unwrap();
        let corrected = observed(&home, &root, &mut checkpoint);
        assert_eq!(corrected.health.reused_files, 0);
        assert_eq!(
            corrected.result.unwrap().messages,
            oracle(&home, &root).messages
        );
    }
    fs::remove_file(&file).unwrap();
    let deleted = observed(&home, &root, &mut checkpoint);
    assert!(deleted.result.unwrap().messages.is_empty());
    assert_eq!(deleted.health.records, Some(0));
}

#[test]
fn observed_failed_or_partial_scan_preserves_last_good_checkpoint_bytes() {
    let (_temp, home, root, file) = fixture();
    fs::write(&file, format!("{}{}", context(), event(1, 10))).unwrap();
    let mut checkpoint = ImportCheckpoint::default();
    observed(&home, &root, &mut checkpoint).result.unwrap();
    let before = checkpoint.encode().unwrap();
    append(&file, "{\"timestamp\":");
    let partial = observed(&home, &root, &mut checkpoint);
    assert_eq!(partial.health.outcome, ImportOutcome::Partial);
    assert_eq!(partial.health.deferred_tail_files, Some(1));
    assert_eq!(checkpoint.encode().unwrap(), before);
    fs::write(&file, "{malformed}\n").unwrap();
    let failed = observed(&home, &root, &mut checkpoint);
    assert!(failed.result.is_err());
    assert_eq!(failed.health.outcome, ImportOutcome::Failed);
    assert_eq!(checkpoint.encode().unwrap(), before);
    let mut corrupt = before.clone();
    *corrupt.last_mut().unwrap() ^= 1;
    assert!(ImportCheckpoint::decode(&corrupt).is_err());
}

#[test]
fn observed_health_measures_clamps_without_exposing_private_source_fields() {
    let (_temp, home, root, file) = fixture();
    let text = format!("{}{}", context(), event(1, 1)); // cache exceeds input
    fs::write(&file, text).unwrap();
    let mut checkpoint = ImportCheckpoint::default();
    let report = observed(&home, &root, &mut checkpoint);
    assert_eq!(report.health.clamped_records, Some(1));
    assert!(report.health.codes.contains(&HealthCode::Clamped));
    assert_eq!(report.health.schema_mismatch_records, Some(0));
    assert_eq!(report.health.estimated_records, Some(0));
    assert_eq!(report.health.event_min_ms, report.health.event_max_ms);
    let json = serde_json::to_string(&report.health).unwrap();
    for private in [home.to_str().unwrap(), "gpt-5.4", "0192f3a4", "openai"] {
        assert!(!json.contains(private));
    }
    let warm = observed(&home, &root, &mut checkpoint);
    assert_eq!(warm.health.clamped_records, Some(1));
    // An unqualified selector never fabricates measured counters.
    let other = collect_observed(
        &home,
        "gemini",
        std::slice::from_ref(&home),
        Some(&[root]),
        0,
        None,
    );
    assert_eq!(other.health.clamped_records, None);
    assert_eq!(other.health.fallback_records, None);
}

#[test]
fn observed_health_rejects_unsafe_inconsistent_dtos_and_accepts_bounded_stale_generation() {
    let (_temp, home, root, _file) = fixture();
    let base = collect_observed(
        &home,
        "codex",
        std::slice::from_ref(&home),
        Some(&[root]),
        0,
        None,
    )
    .health;
    assert!(base.validate());
    let mut unsafe_number = base.clone();
    unsafe_number.verified_bytes = u64::MAX;
    assert!(!unsafe_number.validate());
    let mut absent_tail = base.clone();
    absent_tail.codes.push(HealthCode::DeferredTail);
    assert!(!absent_tail.validate());
    let mut bad_range = base.clone();
    bad_range.event_min_ms = Some(i64::MIN);
    bad_range.event_max_ms = Some(0);
    assert!(!bad_range.validate());
    let mut stale = base.clone();
    stale.parser_generation = "aicharts-1-1".to_owned();
    assert!(stale.validate());
    stale.parser_generation = "private filename".to_owned();
    assert!(!stale.validate());
    let mut refused = base;
    refused.outcome = ImportOutcome::Failed;
    refused.codes.push(HealthCode::ProjectionRefused);
    assert!(refused.validate());
}

#[test]
fn observed_recognized_schema_mismatch_is_not_a_successful_empty_import() {
    let (_temp, home, root, file) = fixture();
    let mut checkpoint = ImportCheckpoint::default();
    for text in [
        "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\"}}\n",
        "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{}}}\n",
        "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"last_token_usage\":{\"input_tokens\":\"not-numeric\"}}}}\n",
    ] {
        fs::write(&file, text).unwrap();
        let observed = observed(&home, &root, &mut checkpoint);
        assert!(observed.result.err().unwrap().contains(&"import_schema_mismatch"));
        assert_eq!(observed.health.schema_mismatch_records, Some(1));
        assert_eq!(observed.health.outcome, ImportOutcome::Failed);
        assert!(observed.health.validate());
        assert!(checkpoint.is_empty());
    }
}

#[test]
fn observed_pending_human_turn_and_unknown_model_replay_equal_full_history() {
    let (_temp, home, root, file) = fixture();
    let mut checkpoint = ImportCheckpoint::default();
    fs::write(&file, format!("{}{{\"timestamp\":\"2026-09-20T10:00:00Z\",\"type\":\"event_msg\",\"payload\":{{\"type\":\"user_message\",\"message\":\"synthetic fixture\"}}}}\n", context())).unwrap();
    observed(&home, &root, &mut checkpoint).result.unwrap();
    append(&file, &event(1, 10));
    let resumed = observed(&home, &root, &mut checkpoint).result.unwrap();
    assert!(resumed.messages[0].is_turn_start);
    assert_eq!(resumed.messages, oracle(&home, &root).messages);
    fs::write(&file, event(1, 10)).unwrap();
    observed(&home, &root, &mut checkpoint).result.unwrap();
    append(&file, context());
    let resolved = observed(&home, &root, &mut checkpoint);
    assert_eq!(resolved.health.reused_files, 0);
    assert_eq!(
        resolved.result.unwrap().messages,
        oracle(&home, &root).messages
    );
}

#[test]
fn observed_checkpoint_fork_baseline_and_mirrored_file_dedup_survive_restart() {
    let (_temp, home, root, file) = fixture();
    let prefix = concat!(
        "{\"timestamp\":\"2026-05-05T21:51:57.991Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"child-session\",\"forked_from_id\":\"parent-session\",\"source\":{\"subagent\":{\"thread_spawn\":{\"parent_thread_id\":\"parent-session\",\"depth\":1}}},\"model_provider\":\"openai\"}}\n",
        "{\"timestamp\":\"2026-05-05T21:51:57.992Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"parent-session\",\"source\":\"interactive\",\"model_provider\":\"azure\"}}\n",
        "{\"timestamp\":\"2026-05-05T21:51:57.994Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":116000,\"cached_input_tokens\":114000,\"output_tokens\":1000,\"total_tokens\":117000},\"last_token_usage\":{\"input_tokens\":73000,\"cached_input_tokens\":72000,\"output_tokens\":500,\"total_tokens\":73500}}}}\n",
    );
    fs::write(&file, prefix).unwrap();
    let mut checkpoint = ImportCheckpoint::default();
    assert!(observed(&home, &root, &mut checkpoint)
        .result
        .unwrap()
        .messages
        .is_empty());
    checkpoint = ImportCheckpoint::decode(&checkpoint.encode().unwrap()).unwrap();
    append(&file, concat!(
        "{\"timestamp\":\"2026-05-05T21:51:58.947Z\",\"type\":\"turn_context\",\"payload\":{\"model\":\"gpt-5.5\"}}\n",
        "{\"timestamp\":\"2026-05-05T21:51:58.948Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":116000,\"cached_input_tokens\":114000,\"output_tokens\":1000,\"total_tokens\":117000},\"last_token_usage\":{\"input_tokens\":73000,\"cached_input_tokens\":72000,\"output_tokens\":500,\"total_tokens\":73500}}}}\n",
        "{\"timestamp\":\"2026-05-05T21:51:59.253Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":117500,\"cached_input_tokens\":115000,\"output_tokens\":1200,\"reasoning_output_tokens\":50,\"total_tokens\":118700},\"last_token_usage\":{\"input_tokens\":1500,\"cached_input_tokens\":1000,\"output_tokens\":200,\"reasoning_output_tokens\":50,\"total_tokens\":1700}}}}\n",
    ));
    let imported = observed(&home, &root, &mut checkpoint).result.unwrap();
    assert_eq!(imported.messages, oracle(&home, &root).messages);
    assert_eq!(imported.messages.len(), 1);
    assert_eq!(imported.messages[0].tokens.input, 500);
    fs::copy(
        &file,
        root.join("rollout-2026-09-20T10-00-00-0192f3a4-5b6c-7d8e-9f01-23456789abce.jsonl"),
    )
    .unwrap();
    let mirrored = observed(&home, &root, &mut checkpoint).result.unwrap();
    assert_eq!(mirrored.messages, oracle(&home, &root).messages);
    assert_eq!(mirrored.messages.len(), 1);
}

#[test]
fn checkpoint_framing_refuses_truncation_lengths_duplicates_and_old_generation() {
    use sha2::{Digest, Sha256};
    let (_temp, home, root, file) = fixture();
    fs::write(&file, format!("{}{}", context(), event(1, 10))).unwrap();
    let mut checkpoint = ImportCheckpoint::default();
    observed(&home, &root, &mut checkpoint).result.unwrap();
    let bytes = checkpoint.encode().unwrap();
    let resign = |mut bytes: Vec<u8>| {
        let digest = Sha256::digest(&bytes[40..]);
        bytes[8..40].copy_from_slice(&digest);
        bytes
    };
    for length in [0, 8, 40, 44, bytes.len() - 1] {
        assert!(ImportCheckpoint::decode(&bytes[..length]).is_err());
    }
    let mut bad_header = bytes.clone();
    bad_header[40..44].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(ImportCheckpoint::decode(&resign(bad_header)).is_err());
    let end = 44 + u32::from_le_bytes(bytes[40..44].try_into().unwrap()) as usize;
    let mut bad_count = bytes.clone();
    bad_count[end..end + 4].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(ImportCheckpoint::decode(&resign(bad_count)).is_err());
    let mut bad_size = bytes.clone();
    bad_size[end + 4..end + 12].copy_from_slice(&u64::MAX.to_le_bytes());
    assert!(ImportCheckpoint::decode(&resign(bad_size)).is_err());
    let mut duplicate = bytes.clone();
    duplicate[end..end + 4].copy_from_slice(&2u32.to_le_bytes());
    duplicate.extend_from_slice(&bytes[end + 4..]);
    assert!(ImportCheckpoint::decode(&resign(duplicate)).is_err());
    let mut old = bytes.clone();
    old[7] = b'1';
    assert!(ImportCheckpoint::decode(&old).is_err());
    let mut extra = bytes;
    extra.push(0);
    assert!(ImportCheckpoint::decode(&resign(extra)).is_err());
}

/// Seed 0xa1c4_2026: bounded 64-step histories with duplicates, cumulative
/// resets, appended complete records, correction replay, and checkpoint codec
/// roundtrips. The independent oracle never receives a checkpoint.
#[test]
fn observed_incremental_equivalence_seed_a1c42026() {
    let (_temp, home, root, file) = fixture();
    let mut seed = 0xa1c4_2026_u64;
    let mut checkpoint = ImportCheckpoint::default();
    let mut records = vec![context().to_owned()];
    for step in 1..=64 {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        if seed.is_multiple_of(7) && records.len() > 1 {
            records[1] = event(1, 10 + seed % 17);
            fs::write(&file, records.concat()).unwrap();
        } else {
            records.push(event(step, 10 + seed % 17));
            fs::write(&file, records.concat()).unwrap();
        }
        let report = observed(&home, &root, &mut checkpoint);
        assert_eq!(
            report.result.unwrap().messages,
            oracle(&home, &root).messages,
            "seed a1c42026 step {step}"
        );
        checkpoint = ImportCheckpoint::decode(&checkpoint.encode().unwrap()).unwrap();
    }
}

/// One fixture-supported whole-file source: the client selector, its store
/// file name, and content generators for the equivalence scenarios.
struct WholeSource {
    client: &'static str,
    file: &'static str,
    /// Complete store content for `rows` observations (1-based indices).
    write: fn(rows: &[u64]) -> String,
    /// One appended observation, only for append-only stores.
    append: Option<fn(index: u64) -> String>,
    /// Observations the oracle reports for `rows`; ACP streams aggregate.
    rows: fn(count: usize) -> usize,
}
fn claude_row(index: u64) -> String {
    format!(
        "{{\"type\":\"assistant\",\"timestamp\":\"2026-09-20T10:{:02}:{:02}.000Z\",\"requestId\":\"req_{index}\",\"message\":{{\"id\":\"msg_{index}\",\"model\":\"claude-sonnet-4-5\",\"usage\":{{\"input_tokens\":{},\"output_tokens\":{},\"cache_read_input_tokens\":4}}}}}}\n",
        index / 60,
        index % 60,
        10 * index,
        3 * index
    )
}
fn cursor_row(index: u64) -> String {
    format!(
        "{{\"timestamp\":\"{}\",\"model\":\"gpt-5-codex\",\"kind\":\"USAGE_EVENT_KIND_USAGE_BASED\",\"chargedCents\":3,\"tokenUsage\":{{\"inputTokens\":{},\"outputTokens\":{},\"cacheReadTokens\":5,\"totalCents\":3}},\"conversationId\":\"b92fdbf1-36d4-4d78-bd5b-afcb939eab16\"}}",
        1_788_171_000_000u64 + 1_000 * index,
        10 * index,
        3 * index
    )
}
fn devin_desktop_row(index: u64) -> String {
    format!(
        "{{\"notification\":{{\"sessionUpdate\":\"usage_update\",\"timestamp\":\"2026-09-20T10:{:02}:{:02}.000Z\",\"_meta\":{{\"cognition.ai/inputTokens\":{},\"cognition.ai/outputTokens\":{},\"cognition.ai/cachedReadTokens\":2}}}}}}\n",
        index / 60,
        index % 60,
        10 * index,
        3 * index
    )
}
const WHOLE_SOURCES: [WholeSource; 3] = [
    WholeSource {
        client: "claude",
        file: "0192f3a4-5b6c-7d8e-9f01-23456789abcd.jsonl",
        write: |rows| rows.iter().map(|row| claude_row(*row)).collect(),
        append: Some(claude_row),
        rows: |count| count,
    },
    WholeSource {
        client: "cursor",
        file: "usage.json",
        write: |rows| {
            format!(
                "{{\"totalUsageEventsCount\":{},\"usageEventsDisplay\":[{}]}}",
                rows.len(),
                rows.iter()
                    .map(|row| cursor_row(*row))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        },
        append: None,
        rows: |count| count,
    },
    WholeSource {
        client: "devin-desktop",
        file: "desktop-session.ndjson",
        write: |rows| {
            format!(
                "{{\"notification\":{{\"sessionUpdate\":\"session_info_update\",\"title\":\"Build\"}}}}\n{}",
                rows.iter()
                    .map(|row| devin_desktop_row(*row))
                    .collect::<String>()
            )
        },
        append: Some(devin_desktop_row),
        rows: |_| 1,
    },
];
fn observed_client(
    client: &str,
    home: &Path,
    root: &Path,
    checkpoint: &mut ImportCheckpoint,
) -> ObservedImport {
    collect_observed(
        home,
        client,
        &[home.to_owned()],
        Some(&[root.to_owned()]),
        0,
        Some(checkpoint),
    )
}
fn oracle_client(client: &str, home: &Path, root: &Path) -> LocalImport {
    collect_since(
        home,
        client,
        &[home.to_owned()],
        Some(&[root.to_owned()]),
        0,
    )
    .unwrap()
}
fn keep_mtime(file: &Path, at: std::time::SystemTime) {
    fs::File::options()
        .write(true)
        .open(file)
        .unwrap()
        .set_modified(at)
        .unwrap();
}

#[test]
fn observed_whole_file_sources_reuse_warm_work_and_replay_every_correction_like_the_oracle() {
    for source in &WHOLE_SOURCES {
        let (_temp, home, root, _codex) = fixture();
        let file = root.join(source.file);
        let mut checkpoint = ImportCheckpoint::default();
        fs::write(&file, (source.write)(&[1, 2])).unwrap();
        let cold = observed_client(source.client, &home, &root, &mut checkpoint);
        assert_eq!(
            cold.health.outcome,
            ImportOutcome::Complete,
            "{}",
            source.client
        );
        assert_eq!(cold.health.reused_files, 0);
        assert!(!cold
            .health
            .codes
            .contains(&HealthCode::CheckpointUnsupported));
        assert!(!cold
            .health
            .codes
            .contains(&HealthCode::SchemaCoverageLimited));
        assert_eq!(cold.health.schema_mismatch_records, Some(0));
        assert_eq!(cold.health.clamped_records, Some(0));
        assert_eq!(cold.health.fallback_records, Some(0));
        let expected = oracle_client(source.client, &home, &root).messages;
        assert_eq!(expected.len(), (source.rows)(2), "{}", source.client);
        assert_eq!(cold.result.unwrap().messages, expected);
        assert!(checkpoint.state.is_some(), "{}", source.client);

        let cold_max = cold.health.event_max_ms;
        let warm = observed_client(source.client, &home, &root, &mut checkpoint);
        assert_eq!(warm.health.reused_files, 1, "{}", source.client);
        assert_eq!(warm.health.parsed_bytes, Some(0), "{}", source.client);
        assert_eq!(warm.health.event_max_ms, cold_max, "{}", source.client);
        assert!(warm.health.verified_bytes > 0);
        assert_eq!(warm.result.unwrap().messages, expected);

        // Append: the whole store is parsed again and matches the oracle.
        if let Some(append_row) = source.append {
            append(&file, &append_row(3));
        } else {
            fs::write(&file, (source.write)(&[1, 2, 3])).unwrap();
        }
        let appended = observed_client(source.client, &home, &root, &mut checkpoint);
        assert_eq!(appended.health.reused_files, 0, "{}", source.client);
        let expected = oracle_client(source.client, &home, &root).messages;
        assert_eq!(expected.len(), (source.rows)(3), "{}", source.client);
        assert!(appended.health.event_max_ms > cold_max, "{}", source.client);
        assert_eq!(appended.result.unwrap().messages, expected);

        // Copy with a preserved mtime changes the file identity only.
        let old_time = fs::metadata(&file).unwrap().modified().unwrap();
        let copy = root.join("copy.pending");
        fs::copy(&file, &copy).unwrap();
        fs::rename(&copy, &file).unwrap();
        keep_mtime(&file, old_time);
        let copied = observed_client(source.client, &home, &root, &mut checkpoint);
        assert_eq!(copied.health.reused_files, 0, "{}", source.client);
        assert_eq!(copied.result.unwrap().messages, expected);
        let warm = observed_client(source.client, &home, &root, &mut checkpoint);
        assert_eq!(warm.health.reused_files, 1, "{}", source.client);

        // Late corrections under an unchanged mtime: truncation and a
        // same-length in-place edit both change the content digest.
        for rows in [&[1u64, 2][..], &[1, 5][..]] {
            fs::write(&file, (source.write)(rows)).unwrap();
            keep_mtime(&file, old_time);
            let corrected = observed_client(source.client, &home, &root, &mut checkpoint);
            assert_eq!(corrected.health.reused_files, 0, "{}", source.client);
            assert_eq!(
                corrected.result.unwrap().messages,
                oracle_client(source.client, &home, &root).messages
            );
        }

        // Rotation: the store moves aside and a new one starts.
        let rotated = root.join(format!("rotated-{}", source.file));
        fs::rename(&file, &rotated).unwrap();
        fs::write(&file, (source.write)(&[7])).unwrap();
        let after = observed_client(source.client, &home, &root, &mut checkpoint);
        let expected = oracle_client(source.client, &home, &root).messages;
        assert_eq!(after.result.unwrap().messages, expected);
        fs::remove_file(&rotated).unwrap();
        fs::remove_file(&file).unwrap();
        let deleted = observed_client(source.client, &home, &root, &mut checkpoint);
        assert!(deleted.result.unwrap().messages.is_empty());
        assert_eq!(deleted.health.records, Some(0));
    }
}

#[test]
fn observed_whole_file_sources_measure_schema_mismatch_fallback_and_clamp_counters() {
    let cases: [(&str, &str, &str, (u64, u64, u64)); 3] = [
        (
            "claude",
            "0192f3a4-5b6c-7d8e-9f01-23456789abcd.jsonl",
            // recognized row; unknown line; usage without a model; negative
            // output and no timestamp on one assistant row
            "{\"type\":\"assistant\",\"timestamp\":\"2026-09-20T10:00:01.000Z\",\"requestId\":\"req_1\",\"message\":{\"id\":\"msg_1\",\"model\":\"claude-sonnet-4-5\",\"usage\":{\"input_tokens\":10,\"output_tokens\":3}}}\n\
             {\"unknown\":true}\n\
             {\"type\":\"assistant\",\"timestamp\":\"2026-09-20T10:00:02.000Z\",\"requestId\":\"req_2\",\"message\":{\"id\":\"msg_2\",\"usage\":{\"input_tokens\":10,\"output_tokens\":3}}}\n\
             {\"type\":\"assistant\",\"requestId\":\"req_3\",\"message\":{\"id\":\"msg_3\",\"model\":\"claude-sonnet-4-5\",\"usage\":{\"input_tokens\":10,\"output_tokens\":-3}}}\n",
            (2, 1, 1),
        ),
        (
            "cursor",
            "usage.json",
            "{\"usageEventsDisplay\":[\
             {\"timestamp\":\"1788171000000\",\"model\":\"gpt-5-codex\",\"tokenUsage\":{\"inputTokens\":10,\"outputTokens\":3}},\
             {\"timestamp\":\"1788171001000\",\"model\":\"\",\"tokenUsage\":{\"inputTokens\":10}},\
             {\"timestamp\":\"1788171002000\",\"model\":\"gpt-5-codex\",\"tokenUsage\":{\"inputTokens\":-10,\"outputTokens\":3}}]}",
            (1, 0, 1),
        ),
        (
            "devin-desktop",
            "desktop-session.ndjson",
            "{\"notification\":{\"sessionUpdate\":\"usage_update\",\"_meta\":{\"cognition.ai/inputTokens\":10,\"cognition.ai/outputTokens\":3}}}\n\
             42\n\
             {\"notification\":{\"sessionUpdate\":\"usage_update\",\"_meta\":{\"cognition.ai/inputTokens\":-10,\"cognition.ai/outputTokens\":3}}}\n",
            // ACP usage events without timestamps aggregate to one record
            // whose time comes from the file, a measured fallback.
            (1, 1, 1),
        ),
    ];
    for (client, name, text, (mismatch, fallback, clamped)) in cases {
        let (_temp, home, root, _codex) = fixture();
        fs::write(root.join(name), text).unwrap();
        let mut checkpoint = ImportCheckpoint::default();
        let report = observed_client(client, &home, &root, &mut checkpoint);
        assert_eq!(report.health.outcome, ImportOutcome::Complete, "{client}");
        assert_eq!(
            report.health.schema_mismatch_records,
            Some(mismatch),
            "{client}"
        );
        assert_eq!(report.health.fallback_records, Some(fallback), "{client}");
        assert_eq!(report.health.clamped_records, Some(clamped), "{client}");
        assert_eq!(
            report.health.codes.contains(&HealthCode::Clamped),
            clamped > 0
        );
        assert_eq!(
            report.health.codes.contains(&HealthCode::Fallback),
            fallback > 0
        );
        assert!(report.health.validate());
        // Reused files re-emit the same counters without reparsing.
        let warm = observed_client(client, &home, &root, &mut checkpoint);
        assert_eq!(warm.health.reused_files, 1, "{client}");
        assert_eq!(
            warm.health.schema_mismatch_records,
            Some(mismatch),
            "{client}"
        );
        assert_eq!(warm.health.fallback_records, Some(fallback), "{client}");
        assert_eq!(warm.health.clamped_records, Some(clamped), "{client}");
        let json = serde_json::to_string(&warm.health).unwrap();
        assert!(!json.contains(home.to_str().unwrap()));
    }
}

#[test]
fn observed_unqualified_selector_reports_unmeasured_coverage_and_unsupported_checkpoint() {
    let (_temp, home, root, _codex) = fixture();
    let mut checkpoint = ImportCheckpoint::default();
    let report = collect_observed(
        &home,
        "gemini",
        &[home.clone()],
        Some(&[root]),
        0,
        Some(&mut checkpoint),
    );
    assert_eq!(report.health.schema_mismatch_records, None);
    assert_eq!(report.health.clamped_records, None);
    assert_eq!(report.health.fallback_records, None);
    assert_eq!(report.health.parsed_bytes, None);
    assert!(report
        .health
        .codes
        .contains(&HealthCode::SchemaCoverageLimited));
    assert!(report
        .health
        .codes
        .contains(&HealthCode::CheckpointUnsupported));
    assert!(report.health.validate());
    assert!(checkpoint.state.is_none());
}
