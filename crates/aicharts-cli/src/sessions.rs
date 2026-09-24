//! Explicit, local session snapshots. No account, ledger, provider config or network.
use aicharts_core::rich_facts;
use aicharts_protocol::Provider;
use std::path::PathBuf;
const HELP: &str = "AI Charts sessions — local, read-only\n\n  aicharts sessions --occurrence-key-file KEY [--codex FILE ...] [--claude FILE ...] [--devin FILE ...] [--json]\n  aicharts sessions --occurrence-key-file KEY --codex FILE --profile rich-facts-v1 --source-epoch EPOCH --window-start-ms N --window-end-ms N --json\n\nExplicit regular files only. Exports known session token observations and\nqualified model labels, without transcript content. Historical timing\nis unknown. An unfinished final JSONL record is deferred; a Devin ATIF source\nis one whole document and parses completely or not at all. Nothing is uploaded.\n\nThe rich profile requires JSON, a stable nonsecret source generation (1..128\nASCII letters/digits/_/-), and an explicit half-open window of at most 31 days.\nIts revision-zero snapshot retains unknown lineage, token scope and cache TTL.\nA new generation is a separate namespace, not a deduplication mechanism.\n";
struct Options {
    sources: Vec<(Provider, PathBuf)>,
    key: PathBuf,
    json: bool,
    rich: Option<rich_facts::ExportOptions>,
}
fn options(args: &[String]) -> Result<Options, &'static str> {
    if args.first().map(String::as_str) != Some("sessions") {
        return Err("invalid_command");
    }
    let mut sources = Vec::new();
    let mut key = None;
    let mut json = false;
    let mut profile = None;
    let mut epoch = None;
    let mut start = None;
    let mut end = None;
    let mut args = args[1..].iter();
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--json" if !json => json = true,
            "--profile" | "--source-epoch" | "--window-start-ms" | "--window-end-ms" => {
                let value = args
                    .next()
                    .filter(|value| !value.is_empty() && !value.starts_with("--"))
                    .ok_or("missing_option_value")?;
                let slot = match flag.as_str() {
                    "--profile" => &mut profile,
                    "--source-epoch" => &mut epoch,
                    "--window-start-ms" => &mut start,
                    _ => &mut end,
                };
                if slot.replace(value.as_str()).is_some() {
                    return Err("invalid_option");
                }
            }
            "--codex" | "--claude" | "--devin" | "--occurrence-key-file" => {
                let value = args
                    .next()
                    .filter(|s| !s.is_empty() && !s.starts_with("--"))
                    .ok_or("missing_option_value")?;
                if flag == "--occurrence-key-file" {
                    if key.is_some() {
                        return Err("invalid_option");
                    }
                    key = Some(PathBuf::from(value));
                } else {
                    if sources.len() >= aicharts_core::sessions::MAX_SESSIONS {
                        return Err("too_many_sources");
                    }
                    sources.push((
                        match flag.as_str() {
                            "--codex" => Provider::Codex,
                            "--claude" => Provider::ClaudeCode,
                            _ => Provider::Devin,
                        },
                        PathBuf::from(value),
                    ));
                }
            }
            _ => return Err("invalid_option"),
        }
    }
    if sources.is_empty() {
        return Err("explicit_source_required");
    }
    let rich = match profile {
        Some(rich_facts::PROFILE) => {
            if !json {
                return Err("rich_profile_requires_json");
            }
            let integer = |value: Option<&str>| -> Result<u64, &'static str> {
                let value = value.ok_or("rich_profile_window_required")?;
                if value.len() > 16
                    || !value.bytes().all(|byte| byte.is_ascii_digit())
                    || (value.len() > 1 && value.starts_with('0'))
                {
                    return Err("invalid_window");
                }
                value.parse().map_err(|_| "invalid_window")
            };
            Some(rich_facts::ExportOptions::new(
                epoch.ok_or("source_epoch_required")?,
                integer(start)?,
                integer(end)?,
            )?)
        }
        None | Some(aicharts_core::sessions::PROFILE) => {
            if epoch.is_some() || start.is_some() || end.is_some() {
                return Err("invalid_option");
            }
            None
        }
        Some(_) => return Err("invalid_profile"),
    };
    Ok(Options {
        sources,
        key: key.ok_or("occurrence_key_required")?,
        json,
        rich,
    })
}
pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    if args == ["sessions", "--help"] || args == ["sessions", "-h"] {
        return Ok(HELP.to_owned());
    }
    let options = options(args)?;
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        native::capture(options)?.finish()
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let Options {
            sources,
            key,
            json,
            rich,
        } = options;
        let _ = (sources, key, json, rich);
        Err("sessions_unsupported_platform")
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod native {
    use super::*;
    use aicharts_core::sessions;
    use aicharts_ledger::SourceStamp;
    use std::{
        fs::{self, File},
        io::{BufReader, Read, Seek, SeekFrom},
        path::Path,
    };
    struct Snapshot {
        file: File,
        original: PathBuf,
        canonical: PathBuf,
        stamp: SourceStamp,
    }
    impl Snapshot {
        fn open(path: &Path) -> Result<Self, &'static str> {
            let file = crate::open_regular(path)?;
            let stamp =
                crate::state::unix::stamp(&file.metadata().map_err(|_| "source_metadata_failed")?)?;
            let canonical = fs::canonicalize(path).map_err(|_| "source_metadata_failed")?;
            let value = Self {
                file,
                original: path.to_owned(),
                canonical,
                stamp,
            };
            value.verify()?;
            Ok(value)
        }
        fn verify(&self) -> Result<(), &'static str> {
            let stamp = crate::state::unix::stamp(
                &self
                    .file
                    .metadata()
                    .map_err(|_| "source_changed_during_scan")?,
            )
            .map_err(|_| "source_changed_during_scan")?;
            if stamp != self.stamp {
                return Err("source_changed_during_scan");
            }
            crate::state::unix::verify_path(&self.original, &self.canonical, &self.stamp)
                .map_err(|_| "source_changed_during_scan")
        }
        fn complete_prefix(&mut self, provider: Provider) -> Result<u64, &'static str> {
            // A whole-document source has no line boundary; completeness is the
            // document's own parse, not an LF-terminated prefix.
            if provider == Provider::Devin {
                return Ok(self.stamp.bytes);
            }
            // Fixed scratch only for the unfinished suffix, not a retained line.
            let mut end = self.stamp.bytes;
            let mut scanned = 0usize;
            let mut scratch = [0u8; 4096];
            while end > 0 {
                let size = usize::try_from(end.min(scratch.len() as u64)).unwrap();
                self.file
                    .seek(SeekFrom::Start(end - size as u64))
                    .map_err(|_| "source_read_failed")?;
                self.file
                    .read_exact(&mut scratch[..size])
                    .map_err(|_| "source_changed_during_scan")?;
                if let Some(index) = scratch[..size].iter().rposition(|b| *b == b'\n') {
                    if scanned + size - index - 1 > aicharts_core::MAX_LINE_BYTES {
                        return Err("line_too_large");
                    }
                    return Ok(end - size as u64 + index as u64 + 1);
                }
                scanned += size;
                if scanned > aicharts_core::MAX_LINE_BYTES {
                    return Err("line_too_large");
                }
                end -= size as u64;
            }
            Ok(0)
        }
    }
    struct Key {
        snapshot: Snapshot,
        value: [u8; 32],
    }
    impl Key {
        fn open(path: &Path) -> Result<Self, &'static str> {
            let mut snapshot = Snapshot::open(path).map_err(|_| "key_read_failed")?;
            if snapshot.stamp.bytes != 32 {
                return Err("invalid_key_file");
            }
            let value = crate::read_key(path)?;
            let mut retained = [0u8; 32];
            snapshot
                .file
                .read_exact(&mut retained)
                .map_err(|_| "key_read_failed")?;
            if retained != value {
                return Err("key_changed_during_scan");
            }
            snapshot.verify().map_err(|_| "key_changed_during_scan")?;
            Ok(Self { snapshot, value })
        }
    }
    pub(super) struct Captured {
        key: Key,
        sources: Vec<(Provider, Snapshot)>,
        output: String,
    }
    impl Captured {
        pub(super) fn finish(self) -> Result<String, &'static str> {
            self.key
                .snapshot
                .verify()
                .map_err(|_| "key_changed_during_scan")?;
            for (_, source) in &self.sources {
                source.verify()?;
            }
            Ok(self.output)
        }
    }
    pub(super) fn capture(options: Options) -> Result<Captured, &'static str> {
        let key = Key::open(&options.key)?;
        let mut sources = Vec::new();
        let mut bytes = 0;
        for (provider, path) in options.sources {
            let snapshot = Snapshot::open(&path)?;
            bytes += snapshot.stamp.bytes;
            if bytes > sessions::MAX_SOURCE_BYTES {
                return Err("source_byte_limit");
            }
            sources.push((provider, snapshot));
        }
        let mut parsed = Vec::new();
        let mut lines = 0;
        let mut records = 0;
        for (provider, source) in &mut sources {
            let prefix = source.complete_prefix(*provider)?;
            source
                .file
                .seek(SeekFrom::Start(0))
                .map_err(|_| "source_read_failed")?;
            let tokens = aicharts_core::parse_reader(
                BufReader::new((&mut source.file).take(prefix)),
                *provider,
                &key.value,
            )
            .map_err(|e| e.code())?;
            lines += tokens.lines_read;
            records += tokens.batches.iter().map(|b| b.usage.len()).sum::<usize>();
            if lines > sessions::MAX_LINES || records > sessions::MAX_RECORDS {
                return Err("record_limit");
            }
            let metadata = {
                source
                    .file
                    .seek(SeekFrom::Start(0))
                    .map_err(|_| "source_read_failed")?;
                sessions::scan_metadata(
                    BufReader::new((&mut source.file).take(prefix)),
                    *provider,
                    &key.value,
                )?
            };
            source.verify()?;
            parsed.push((tokens, metadata));
        }
        let report = sessions::join_sources(parsed)?;
        let output = if let Some(rich) = options.rich {
            rich_facts::project_sessions(&report, &key.value, &rich)?.to_json()?
        } else if options.json {
            serde_json::to_string(&report).map_err(|_| "summary_encode_failed")?
        } else {
            format!("AI Charts sessions — local only; {} sessions with token observations; streaming and wait times unknown\n", report.session_count())
        };
        if output.len() > 8 * 1024 * 1024 {
            return Err("report_size_limit");
        }
        Ok(Captured {
            key,
            sources,
            output,
        })
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{
            io::Write,
            os::unix::fs::{symlink, DirBuilderExt, OpenOptionsExt},
            sync::atomic::{AtomicU64, Ordering},
        };
        static NEXT: AtomicU64 = AtomicU64::new(0);
        struct Fixture {
            path: PathBuf,
        }
        impl Fixture {
            fn new() -> Self {
                let path = std::env::temp_dir().join(format!(
                    "aicharts-sessions-{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::Relaxed)
                ));
                fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
                let value = Self { path };
                value.write("key", &[9u8; 32]);
                value
            }
            fn write(&self, name: &str, bytes: &[u8]) {
                fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(self.path.join(name))
                    .unwrap()
                    .write_all(bytes)
                    .unwrap();
            }
            fn options(&self, files: &[&str]) -> Options {
                self.options_as(Provider::ClaudeCode, files)
            }
            fn options_as(&self, provider: Provider, files: &[&str]) -> Options {
                Options {
                    key: self.path.join("key"),
                    sources: files
                        .iter()
                        .map(|f| (provider, self.path.join(f)))
                        .collect(),
                    json: true,
                    rich: None,
                }
            }
        }
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.path);
            }
        }
        const ROW: &[u8] = b"{\"type\":\"assistant\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"sessionId\":\"s\",\"requestId\":\"r\",\"message\":{\"id\":\"m\",\"model\":\"claude-sonnet-4-6\",\"usage\":{\"input_tokens\":2,\"output_tokens\":3}}}\n";
        const ATIF: &[u8] = br#"{"schema_version":"ATIF-v1.7","session_id":"atif-native","agent":{"name":"devin"},"steps":[{"step_id":1,"source":"agent","timestamp":"2026-01-01T00:00:00Z","extra":{"generation_model":"swe-2-max"},"metrics":{"prompt_tokens":10,"completion_tokens":3,"cached_tokens":2}}],"final_metrics":{"total_prompt_tokens":10,"total_completion_tokens":3,"total_cached_tokens":2,"total_steps":1}}"#;
        const CODEX: &[u8] = concat!(
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"native-model-canary\",\"model\":\"gpt-5.5\"}}\n",
            "{\"type\":\"event_msg\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":100,\"output_tokens\":0},\"last_token_usage\":{\"input_tokens\":100,\"output_tokens\":0}}}}\n",
        ).as_bytes();
        #[test]
        fn codex_metadata_scanner_is_reached_by_the_real_session_capture() {
            let f = Fixture::new();
            f.write("codex", CODEX);
            let output = capture(f.options_as(Provider::Codex, &["codex"]))
                .unwrap()
                .finish()
                .unwrap();
            let report: serde_json::Value = serde_json::from_str(&output).unwrap();
            assert_eq!(report["sessions"][0]["usage"][0]["model"], "gpt-5.5");
            assert_eq!(report["sessions"][0]["usage"][0]["modelBasis"], "request");
            assert!(!output.contains("native-model-canary"));
        }
        #[test]
        fn opt_in_rich_capture_preserves_key_source_guards_and_default_profile() {
            let f = Fixture::new();
            f.write("a", ROW);
            let legacy = capture(f.options(&["a"])).unwrap().finish().unwrap();
            let legacy: serde_json::Value = serde_json::from_str(&legacy).unwrap();
            assert_eq!(legacy["profile"], "session-observations-v1");
            let mut selected = f.options(&["a"]);
            selected.rich = Some(
                rich_facts::ExportOptions::new(
                    "synthetic_source_v1",
                    1_767_225_600_000,
                    1_767_225_610_000,
                )
                .unwrap(),
            );
            let captured = capture(selected).unwrap();
            let report: serde_json::Value = serde_json::from_str(&captured.output).unwrap();
            assert_eq!(report["profile"], "rich-facts-v1");
            assert_eq!(report["facts"].as_array().unwrap().len(), 1);
            assert_eq!(report["facts"][0]["owner"]["lineage"], "unknown");
            assert_eq!(report["facts"][0]["value"]["tokenScope"], "unknown");
            assert_eq!(report["coverage"]["usage"], "partial");
            fs::rename(f.path.join("a"), f.path.join("saved")).unwrap();
            f.write("a", ROW);
            assert_eq!(captured.finish(), Err("source_changed_during_scan"));
            let mut selected = f.options(&["a"]);
            selected.rich = Some(
                rich_facts::ExportOptions::new(
                    "synthetic_source_v1",
                    1_767_225_600_000,
                    1_767_225_610_000,
                )
                .unwrap(),
            );
            let captured = capture(selected).unwrap();
            fs::rename(f.path.join("key"), f.path.join("saved-key")).unwrap();
            f.write("key", &[9; 32]);
            assert_eq!(captured.finish(), Err("key_changed_during_scan"));
        }
        #[test]
        fn rich_profile_options_validate_before_opening_any_file() {
            let base = [
                "sessions",
                "--codex",
                "/missing/source",
                "--occurrence-key-file",
                "/missing/key",
            ];
            let rich = [
                "--profile",
                "rich-facts-v1",
                "--source-epoch",
                "synthetic_source_v1",
                "--window-start-ms",
                "0",
                "--window-end-ms",
                "1",
                "--json",
            ];
            let args = base
                .into_iter()
                .chain(rich)
                .map(str::to_owned)
                .collect::<Vec<_>>();
            assert!(super::super::options(&args).unwrap().rich.is_some());
            for (from, to) in [
                ("rich-facts-v1", "future-profile"),
                ("synthetic_source_v1", "private/path"),
                ("0", "+0"),
                ("0", "00"),
                ("1", "8640000000000001"),
            ] {
                let invalid = args
                    .iter()
                    .map(|value| {
                        if value == from {
                            to.to_owned()
                        } else {
                            value.clone()
                        }
                    })
                    .collect::<Vec<_>>();
                let error = super::super::run(&invalid).unwrap_err();
                assert!(!error.contains("read"));
            }
            assert_eq!(
                super::super::run(&args[..args.len() - 1]),
                Err("rich_profile_requires_json")
            );
            for extra in [
                vec!["--profile", "rich-facts-v1", "--json"],
                vec!["--source-epoch", "unused"],
                vec!["--window-start-ms", "0"],
            ] {
                let invalid = base
                    .into_iter()
                    .chain(extra)
                    .map(str::to_owned)
                    .collect::<Vec<_>>();
                assert!(super::super::options(&invalid).is_err());
            }
            let mut duplicate = args.clone();
            duplicate.extend(["--window-end-ms".to_owned(), "1".to_owned()]);
            assert!(super::super::options(&duplicate).is_err());
            assert!(
                super::super::run(&["sessions".to_owned(), "--help".to_owned()])
                    .unwrap()
                    .contains("rich-facts-v1")
            );
        }
        #[test]
        fn copies_and_unfinished_tail_export_one_complete_usage() {
            let f = Fixture::new();
            f.write("a", ROW);
            let mut tail = ROW.to_vec();
            tail.extend(b"{\"type\":\"assistant\",\"content\":\"INCOMPLETE");
            f.write("b", &tail);
            let result = capture(f.options(&["a", "b"])).unwrap().finish().unwrap();
            let json: serde_json::Value = serde_json::from_str(&result).unwrap();
            assert_eq!(json["sessions"].as_array().unwrap().len(), 1);
            assert_eq!(json["sessions"][0]["usage"].as_array().unwrap().len(), 1);
            assert_eq!(json["sessions"][0]["usage"][0]["modelBasis"], "response");
            assert!(!result.contains("INCOMPLETE"));
        }
        #[test]
        fn devin_whole_document_exports_without_a_newline_tail() {
            let f = Fixture::new();
            f.write("a.json", ATIF);
            let result = capture(f.options_as(Provider::Devin, &["a.json"]))
                .unwrap()
                .finish()
                .unwrap();
            let json: serde_json::Value = serde_json::from_str(&result).unwrap();
            assert_eq!(json["sessions"].as_array().unwrap().len(), 1);
            assert_eq!(json["sessions"][0]["provider"], "devin");
            let usage = &json["sessions"][0]["usage"];
            assert_eq!(usage.as_array().unwrap().len(), 1);
            assert_eq!(usage[0]["model"], "swe-2-max");
            assert_eq!(usage[0]["inputTokens"], 8);
            assert_eq!(usage[0]["cacheReadTokens"], 2);
            assert_eq!(usage[0]["outputTokens"], 3);
            assert!(!result.contains("atif-native"));
        }
        #[test]
        fn devin_partial_document_refuses_instead_of_deferring() {
            let f = Fixture::new();
            f.write("a.json", &ATIF[..ATIF.len() - 2]);
            assert!(capture(f.options_as(Provider::Devin, &["a.json"])).is_err());
        }
        #[test]
        fn a_previous_source_replaced_after_capture_prevents_all_output() {
            let f = Fixture::new();
            f.write("a", ROW);
            f.write("b", ROW);
            let capture = capture(f.options(&["a", "b"])).unwrap();
            fs::rename(f.path.join("a"), f.path.join("saved")).unwrap();
            f.write("a", ROW);
            assert_eq!(capture.finish(), Err("source_changed_during_scan"));
        }
        #[test]
        fn key_replacement_and_source_symlink_are_refused() {
            let f = Fixture::new();
            f.write("a", ROW);
            let capture = capture(f.options(&["a"])).unwrap();
            fs::rename(f.path.join("key"), f.path.join("old-key")).unwrap();
            f.write("key", &[9u8; 32]);
            assert_eq!(capture.finish(), Err("key_changed_during_scan"));
            symlink(f.path.join("a"), f.path.join("alias")).unwrap();
            assert!(super::capture(f.options(&["alias"])).is_err());
        }
        #[test]
        fn options_refuse_missing_flag_values_before_files() {
            let args = [
                "sessions",
                "--codex",
                "--json",
                "--occurrence-key-file",
                "key",
            ]
            .map(String::from);
            assert!(super::super::options(&args).is_err());
        }
    }
}
