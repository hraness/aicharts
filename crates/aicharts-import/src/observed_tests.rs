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
    let other = collect_observed(
        &home,
        "cursor",
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
