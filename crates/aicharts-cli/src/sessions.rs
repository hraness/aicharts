//! Explicit, local session snapshots. No account, ledger, provider config or network.
use aicharts_protocol::Provider;
use std::path::PathBuf;
const HELP: &str = "AI Charts sessions — local, read-only\n\n  aicharts sessions --occurrence-key-file KEY [--codex FILE ...] [--claude FILE ...] [--json]\n\nExplicit regular files only. Exports known session token observations and\nqualified response-model labels, without transcript content. Historical timing\nis unknown. An unfinished final JSONL record is deferred. Nothing is uploaded.\n";
struct Options {
    sources: Vec<(Provider, PathBuf)>,
    key: PathBuf,
    json: bool,
}
fn options(args: &[String]) -> Result<Options, &'static str> {
    if args.first().map(String::as_str) != Some("sessions") {
        return Err("invalid_command");
    }
    let mut sources = Vec::new();
    let mut key = None;
    let mut json = false;
    let mut args = args[1..].iter();
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--json" if !json => json = true,
            "--codex" | "--claude" | "--occurrence-key-file" => {
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
                        if flag == "--codex" {
                            Provider::Codex
                        } else {
                            Provider::ClaudeCode
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
    Ok(Options {
        sources,
        key: key.ok_or("occurrence_key_required")?,
        json,
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
        let Options { sources, key, json } = options;
        let _ = (sources, key, json);
        Err("sessions_unsupported_platform")
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod native {
    use super::*;
    use aicharts_core::sessions::{self, Metadata};
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
        fn complete_prefix(&mut self) -> Result<u64, &'static str> {
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
            let prefix = source.complete_prefix()?;
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
            let metadata = if *provider == Provider::ClaudeCode {
                source
                    .file
                    .seek(SeekFrom::Start(0))
                    .map_err(|_| "source_read_failed")?;
                sessions::scan_metadata(
                    BufReader::new((&mut source.file).take(prefix)),
                    *provider,
                    &key.value,
                )?
            } else {
                Metadata::default()
            };
            source.verify()?;
            parsed.push((tokens, metadata));
        }
        let report = sessions::join_sources(parsed)?;
        let output = if options.json {
            serde_json::to_string(&report).map_err(|_| "summary_encode_failed")?
        } else {
            format!("AI Charts sessions — local only; {} sessions with token observations; streaming and wait times unknown\n", report.sessions.len())
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
                Options {
                    key: self.path.join("key"),
                    sources: files
                        .iter()
                        .map(|f| (Provider::ClaudeCode, self.path.join(f)))
                        .collect(),
                    json: true,
                }
            }
        }
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.path);
            }
        }
        const ROW: &[u8] = b"{\"type\":\"assistant\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"sessionId\":\"s\",\"requestId\":\"r\",\"message\":{\"id\":\"m\",\"model\":\"claude-sonnet-4-6\",\"usage\":{\"input_tokens\":2,\"output_tokens\":3}}}\n";
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
