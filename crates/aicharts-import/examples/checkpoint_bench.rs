//! Bounded synthetic benchmark; no user roots, network, or source text output.
//! cargo run --locked --offline --release -p aicharts-import --example checkpoint_bench
use aicharts_import::{collect_observed, ImportCheckpoint, ImportHealth, UnifiedMessage};
use serde::Serialize;
use std::{fs, io::Write, path::Path, time::Instant};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Sample {
    records: usize,
    source_bytes: u64,
    mode: &'static str,
    elapsed_us: u64,
    parsed_bytes: Option<u64>,
    verified_bytes: u64,
    reused_files: u64,
}
fn measure(
    home: &Path,
    source: &Path,
    checkpoint: Option<&mut ImportCheckpoint>,
) -> (Vec<UnifiedMessage>, ImportHealth, u64) {
    let started = Instant::now();
    let observed = collect_observed(
        home,
        "codex",
        &[home.to_owned()],
        Some(&[source.to_owned()]),
        0,
        checkpoint,
    );
    let elapsed = u64::try_from(started.elapsed().as_micros()).unwrap();
    assert!(observed.health.validate());
    (observed.result.unwrap().messages, observed.health, elapsed)
}
fn event(index: usize, changed: bool) -> String {
    let last_input = if changed { 11 } else { 10 };
    format!("{{\"timestamp\":\"2026-09-20T10:{:02}:{:02}.{:03}Z\",\"type\":\"event_msg\",\"payload\":{{\"type\":\"token_count\",\"info\":{{\"total_token_usage\":{{\"input_tokens\":{},\"cached_input_tokens\":{},\"output_tokens\":{},\"reasoning_output_tokens\":{}}},\"last_token_usage\":{{\"input_tokens\":{last_input},\"cached_input_tokens\":2,\"output_tokens\":3,\"reasoning_output_tokens\":1}}}}}}}}\n", index / 60_000 % 60, index / 1000 % 60, index % 1000, index * 10, index * 2, index * 3, index)
}
fn push(
    samples: &mut Vec<Sample>,
    rows: usize,
    bytes: u64,
    mode: &'static str,
    measured: &(Vec<UnifiedMessage>, ImportHealth, u64),
) {
    samples.push(Sample {
        records: rows,
        source_bytes: bytes,
        mode,
        elapsed_us: measured.2,
        parsed_bytes: measured.1.parsed_bytes,
        verified_bytes: measured.1.verified_bytes,
        reused_files: measured.1.reused_files,
    });
}
// Includes checkpoint decode/encode CPU work as a fresh CLI process must pay.
// File-custody validation, fsync and CLI report projection remain separate.
fn reopened(
    home: &Path,
    source: &Path,
    encoded: &[u8],
) -> (Vec<UnifiedMessage>, ImportHealth, u64) {
    let started = Instant::now();
    let mut checkpoint = ImportCheckpoint::decode(encoded).unwrap();
    let mut result = measure(home, source, Some(&mut checkpoint));
    std::hint::black_box(checkpoint.encode().unwrap());
    result.2 = u64::try_from(started.elapsed().as_micros()).unwrap();
    result
}
fn main() {
    let temp = tempfile::tempdir().unwrap();
    let home = fs::canonicalize(temp.path()).unwrap();
    let source = home.join("sessions");
    fs::create_dir(&source).unwrap();
    let path =
        source.join("rollout-2026-09-20T10-00-00-0192f3a4-5b6c-7d8e-9f01-23456789abcd.jsonl");
    let mut samples = Vec::new();
    for rows in [1_000, 10_000, 50_000] {
        let context = "{\"timestamp\":\"2026-09-20T10:00:00Z\",\"type\":\"turn_context\",\"payload\":{\"model\":\"gpt-5.4\"}}\n";
        let mut source_bytes = context.to_owned();
        for index in 1..=rows {
            source_bytes.push_str(&event(index, false));
        }
        let append = (rows + 1..=rows + 100)
            .map(|index| event(index, false))
            .collect::<String>();
        for repetition in 0..6 {
            let sample_start = samples.len();
            fs::write(&path, &source_bytes).unwrap();
            let baseline = measure(&home, &source, None);
            push(
                &mut samples,
                rows,
                source_bytes.len() as u64,
                "full",
                &baseline,
            );
            let mut checkpoint = ImportCheckpoint::default();
            let cold = measure(&home, &source, Some(&mut checkpoint));
            assert_eq!(baseline.0, cold.0);
            push(&mut samples, rows, source_bytes.len() as u64, "cold", &cold);
            drop(cold);
            let warm = measure(&home, &source, Some(&mut checkpoint));
            assert_eq!(baseline.0, warm.0);
            assert_eq!(warm.1.parsed_bytes, Some(0));
            push(&mut samples, rows, source_bytes.len() as u64, "warm", &warm);
            drop(warm);
            let before_append = checkpoint.encode().unwrap();
            let restarted = reopened(&home, &source, &before_append);
            assert_eq!(baseline.0, restarted.0);
            push(
                &mut samples,
                rows,
                source_bytes.len() as u64,
                "warm-reopen",
                &restarted,
            );
            drop(restarted);
            drop(baseline);
            fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap()
                .write_all(append.as_bytes())
                .unwrap();
            let append_oracle = measure(&home, &source, None);
            push(
                &mut samples,
                rows,
                (source_bytes.len() + append.len()) as u64,
                "append-full",
                &append_oracle,
            );
            let incremental = measure(&home, &source, Some(&mut checkpoint));
            assert_eq!(incremental.0, append_oracle.0);
            assert_eq!(incremental.1.parsed_bytes, Some(append.len() as u64));
            push(
                &mut samples,
                rows,
                (source_bytes.len() + append.len()) as u64,
                "append",
                &incremental,
            );
            drop(incremental);
            let restarted = reopened(&home, &source, &before_append);
            assert_eq!(restarted.0, append_oracle.0);
            push(
                &mut samples,
                rows,
                (source_bytes.len() + append.len()) as u64,
                "append-reopen",
                &restarted,
            );
            drop(restarted);
            drop(append_oracle);
            let before_correction = checkpoint.encode().unwrap();
            let correction = format!(
                "{}{}",
                source_bytes.replacen(&event(1, false), &event(1, true), 1),
                append
            );
            fs::write(&path, &correction).unwrap();
            let correction_oracle = measure(&home, &source, None);
            push(
                &mut samples,
                rows,
                correction.len() as u64,
                "correction-full",
                &correction_oracle,
            );
            let corrected = measure(&home, &source, Some(&mut checkpoint));
            assert_eq!(corrected.0, correction_oracle.0);
            assert_eq!(corrected.1.reused_files, 0);
            push(
                &mut samples,
                rows,
                correction.len() as u64,
                "correction",
                &corrected,
            );
            drop(corrected);
            let restarted = reopened(&home, &source, &before_correction);
            assert_eq!(restarted.0, correction_oracle.0);
            push(
                &mut samples,
                rows,
                correction.len() as u64,
                "correction-reopen",
                &restarted,
            );
            if repetition == 0 {
                samples.truncate(sample_start);
            }
        }
    }
    println!("{}", serde_json::to_string(&serde_json::json!({"schemaVersion":1,"profile":"synthetic-checkpoint-work-v1",
        "qualification":"local synthetic corpus; no live provider qualification", "platform":std::env::consts::OS,
        "architecture":std::env::consts::ARCH,"warmupPerSize":1,"samplesPerMode":5,"samples":samples})).unwrap());
}
