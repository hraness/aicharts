//! Bounded synthetic benchmark; no user roots, network, or source text output.
//! cargo run --locked --offline --release -p aicharts-import --example checkpoint_bench
//! `--large` runs the multi-source large-account scenario (500,000 rows) and
//! reports latency plus the process peak resident set instead.
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
    measure_client("codex", home, source, checkpoint)
}
fn measure_client(
    client: &str,
    home: &Path,
    source: &Path,
    checkpoint: Option<&mut ImportCheckpoint>,
) -> (Vec<UnifiedMessage>, ImportHealth, u64) {
    let started = Instant::now();
    let observed = collect_observed(
        home,
        client,
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
    reopened_client("codex", home, source, encoded)
}
fn reopened_client(
    client: &str,
    home: &Path,
    source: &Path,
    encoded: &[u8],
) -> (Vec<UnifiedMessage>, ImportHealth, u64) {
    let started = Instant::now();
    let mut checkpoint = ImportCheckpoint::decode(encoded).unwrap();
    let mut result = measure_client(client, home, source, Some(&mut checkpoint));
    std::hint::black_box(checkpoint.encode().unwrap());
    result.2 = u64::try_from(started.elapsed().as_micros()).unwrap();
    result
}
fn main() {
    if std::env::args()
        .skip(1)
        .any(|argument| argument == "--large")
    {
        large();
        return;
    }
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

#[repr(C)]
struct Rusage {
    times: [i64; 4],
    maxrss: i64,
    rest: [i64; 24],
}
extern "C" {
    fn getrusage(who: i32, usage: *mut Rusage) -> i32;
}
/// Process high-water resident set in bytes (`ru_maxrss`: bytes on macOS,
/// kibibytes on Linux); `None` when the platform does not report it.
fn peak_rss_bytes() -> Option<u64> {
    if !cfg!(any(target_os = "macos", target_os = "linux")) {
        return None;
    }
    let mut usage = Rusage {
        times: [0; 4],
        maxrss: 0,
        rest: [0; 24],
    };
    // SAFETY: RUSAGE_SELF is 0 on macOS and Linux; the buffer is larger than
    // `struct rusage` (18 longs) on both, and the kernel writes only that much.
    let code = unsafe { getrusage(0, &mut usage) };
    if code != 0 {
        return None;
    }
    let raw = u64::try_from(usage.maxrss).ok()?;
    Some(if cfg!(target_os = "macos") {
        raw
    } else {
        raw.checked_mul(1024)?
    })
}
/// Wall-clock second `index` after 2026-09-20T00:00:00Z as an RFC 3339 stamp.
fn stamp(index: usize) -> String {
    format!(
        "2026-09-{:02}T{:02}:{:02}:{:02}.000Z",
        20 + index / 86_400,
        index / 3_600 % 24,
        index / 60 % 60,
        index % 60
    )
}
fn claude_row(index: usize) -> String {
    format!(
        "{{\"type\":\"assistant\",\"timestamp\":\"{}\",\"requestId\":\"req_{index}\",\"message\":{{\"id\":\"msg_{index}\",\"model\":\"claude-sonnet-4-5\",\"usage\":{{\"input_tokens\":{},\"output_tokens\":{},\"cache_read_input_tokens\":4}}}}}}\n",
        stamp(index),
        10 * index,
        3 * index
    )
}
fn cursor_row(index: usize) -> String {
    format!(
        "{{\"timestamp\":\"{}\",\"model\":\"gpt-5-codex\",\"kind\":\"USAGE_EVENT_KIND_USAGE_BASED\",\"chargedCents\":3,\"tokenUsage\":{{\"inputTokens\":{},\"outputTokens\":{},\"cacheReadTokens\":5,\"totalCents\":3}},\"conversationId\":\"b92fdbf1-36d4-4d78-bd5b-afcb939eab16\"}}",
        1_788_171_000_000u64 + 1_000 * index as u64,
        10 * index,
        3 * index
    )
}
fn devin_desktop_row(index: usize) -> String {
    format!(
        "{{\"notification\":{{\"sessionUpdate\":\"usage_update\",\"timestamp\":\"{}\",\"_meta\":{{\"cognition.ai/inputTokens\":{},\"cognition.ai/outputTokens\":{},\"cognition.ai/cachedReadTokens\":2}}}}}}\n",
        stamp(index),
        10 * index,
        3 * index
    )
}
/// One source family of the synthetic large account. Row generators mirror the
/// fixture-supported equivalence tests; indices are unique across files.
struct LargeSource {
    client: &'static str,
    files: usize,
    rows_per_file: usize,
    name: fn(file: usize) -> String,
    write: fn(rows: std::ops::Range<usize>) -> String,
    /// Appended observations for append-only stores; `None` rewrites the store.
    append: Option<fn(index: usize) -> String>,
}
const LARGE_SOURCES: [LargeSource; 4] = [
    LargeSource {
        client: "codex",
        files: 5,
        rows_per_file: 50_000,
        name: |file| {
            format!(
                "rollout-2026-09-20T10-00-0{file}-0192f3a4-5b6c-7d8e-9f01-23456789abc{file}.jsonl"
            )
        },
        write: |rows| {
            let mut text = "{\"timestamp\":\"2026-09-20T10:00:00Z\",\"type\":\"turn_context\",\"payload\":{\"model\":\"gpt-5.4\"}}\n".to_owned();
            for index in rows {
                text.push_str(&event(index, false));
            }
            text
        },
        append: Some(|index| event(index, false)),
    },
    LargeSource {
        client: "claude",
        files: 3,
        rows_per_file: 50_000,
        name: |file| format!("0192f3a4-5b6c-7d8e-9f01-23456789abc{file}.jsonl"),
        write: |rows| rows.map(claude_row).collect(),
        append: Some(claude_row),
    },
    LargeSource {
        client: "cursor",
        files: 1,
        rows_per_file: 50_000,
        name: |_| "usage.json".to_owned(),
        write: |rows| {
            format!(
                "{{\"totalUsageEventsCount\":{},\"usageEventsDisplay\":[{}]}}",
                rows.len(),
                rows.map(cursor_row).collect::<Vec<_>>().join(",")
            )
        },
        append: None,
    },
    LargeSource {
        client: "devin-desktop",
        files: 1,
        rows_per_file: 50_000,
        name: |_| "desktop-session.ndjson".to_owned(),
        write: |rows| {
            format!(
                "{{\"notification\":{{\"sessionUpdate\":\"session_info_update\",\"title\":\"Build\"}}}}\n{}",
                rows.map(devin_desktop_row).collect::<String>()
            )
        },
        append: Some(devin_desktop_row),
    },
];
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LargeSample {
    client: &'static str,
    files: usize,
    records: usize,
    source_bytes: u64,
    mode: &'static str,
    elapsed_us: u64,
    parsed_bytes: Option<u64>,
    verified_bytes: u64,
    reused_files: u64,
    /// Monotonic process high-water mark after this measurement.
    peak_rss_bytes: Option<u64>,
}
/// Writes every store of `source` for rows `[1, files * rows_per_file]`. With
/// `extra`, only the last store is rewritten, carrying 100 later observations;
/// the untouched stores keep their identity and modification time.
fn write_large(source: &LargeSource, root: &Path, extra: bool) -> u64 {
    let mut bytes = 0u64;
    for file in 0..source.files {
        let first = 1 + file * source.rows_per_file;
        let mut last = first + source.rows_per_file;
        let last_file = file + 1 == source.files;
        if extra && last_file && source.append.is_none() {
            last += 100;
        }
        let mut text = (source.write)(first..last);
        if extra && last_file {
            if let Some(append) = source.append {
                text.extend((last..last + 100).map(append));
            }
        }
        if !extra || last_file {
            fs::write(root.join((source.name)(file)), &text).unwrap();
        }
        bytes += text.len() as u64;
    }
    bytes
}
fn large() {
    let temp = tempfile::tempdir().unwrap();
    let home = fs::canonicalize(temp.path()).unwrap();
    let baseline_rss = peak_rss_bytes();
    let mut samples: Vec<LargeSample> = Vec::new();
    let mut account: Vec<serde_json::Value> = Vec::new();
    let repetitions = 4;
    for repetition in 0..repetitions {
        let sample_start = samples.len();
        let mut totals: Vec<(&'static str, u64)> = Vec::new();
        let mut total = |mode: &'static str, elapsed: u64| match totals
            .iter_mut()
            .find(|entry| entry.0 == mode)
        {
            Some(entry) => entry.1 += elapsed,
            None => totals.push((mode, elapsed)),
        };
        for source in &LARGE_SOURCES {
            let root = home.join(source.client);
            let _ = fs::remove_dir_all(&root);
            fs::create_dir(&root).unwrap();
            let records = source.files * source.rows_per_file;
            let source_bytes = write_large(source, &root, false);
            let mut push =
                |samples: &mut Vec<LargeSample>,
                 mode: &'static str,
                 bytes: u64,
                 measured: &(Vec<UnifiedMessage>, ImportHealth, u64)| {
                    total(mode, measured.2);
                    samples.push(LargeSample {
                        client: source.client,
                        files: source.files,
                        records,
                        source_bytes: bytes,
                        mode,
                        elapsed_us: measured.2,
                        parsed_bytes: measured.1.parsed_bytes,
                        verified_bytes: measured.1.verified_bytes,
                        reused_files: measured.1.reused_files,
                        peak_rss_bytes: peak_rss_bytes(),
                    });
                };
            let baseline = measure_client(source.client, &home, &root, None);
            assert!(!baseline.0.is_empty());
            push(&mut samples, "full", source_bytes, &baseline);
            let mut checkpoint = ImportCheckpoint::default();
            let cold = measure_client(source.client, &home, &root, Some(&mut checkpoint));
            assert_eq!(baseline.0, cold.0, "{}", source.client);
            push(&mut samples, "cold", source_bytes, &cold);
            drop(cold);
            let encoded = checkpoint.encode().unwrap();
            drop(checkpoint);
            let warm = reopened_client(source.client, &home, &root, &encoded);
            assert_eq!(baseline.0, warm.0, "{}", source.client);
            assert_eq!(warm.1.parsed_bytes, Some(0), "{}", source.client);
            push(&mut samples, "warm-reopen", source_bytes, &warm);
            drop(warm);
            drop(baseline);
            let changed_bytes = write_large(source, &root, true);
            let oracle = measure_client(source.client, &home, &root, None);
            push(&mut samples, "change-full", changed_bytes, &oracle);
            let changed = reopened_client(source.client, &home, &root, &encoded);
            assert_eq!(oracle.0, changed.0, "{}", source.client);
            // Codex reuses the appended file's verified prefix; whole-file
            // stores reparse the changed file and reuse only the others.
            if source.append.is_some() {
                assert!(
                    changed.1.reused_files >= source.files as u64 - 1,
                    "{}",
                    source.client
                );
                assert!(
                    changed.1.parsed_bytes <= oracle.1.parsed_bytes,
                    "{}",
                    source.client
                );
            } else {
                assert_eq!(changed.1.reused_files, 0);
            }
            push(&mut samples, "change-reopen", changed_bytes, &changed);
        }
        if repetition == 0 {
            samples.truncate(sample_start);
        } else {
            for (mode, elapsed) in totals {
                account.push(serde_json::json!({"repetition": repetition, "mode": mode, "elapsedUs": elapsed}));
            }
        }
    }
    let records: usize = LARGE_SOURCES
        .iter()
        .map(|source| source.files * source.rows_per_file)
        .sum();
    println!("{}", serde_json::to_string(&serde_json::json!({"schemaVersion":1,"profile":"synthetic-large-account-v1",
        "qualification":"local synthetic corpus; no live provider qualification", "platform":std::env::consts::OS,
        "architecture":std::env::consts::ARCH,"records":records,"warmup":1,"samplesPerMode":repetitions - 1,
        "baselinePeakRssBytes":baseline_rss,"finalPeakRssBytes":peak_rss_bytes(),"account":account,"samples":samples})).unwrap());
}
