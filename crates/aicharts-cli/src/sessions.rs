//! Explicit, local session snapshots. No account, ledger, provider config or network.
use aicharts_core::rich_facts;
use aicharts_protocol::Provider;
use std::path::{Path, PathBuf};
const HELP: &str = "AI Charts sessions: local, read-only\n\n  aicharts sessions --occurrence-key-file KEY [--codex FILE ...] [--claude FILE ...] [--devin FILE ...] [--json]\n  aicharts sessions --occurrence-key-file KEY --codex FILE --profile rich-facts-v1 --source-epoch EPOCH --window-start-ms N --window-end-ms N --json [--producer sessions|transcript] [--state-dir DIR]\n\nExplicit regular files only. Exports known session token observations and\nqualified model labels, without transcript content. Historical timing\nis unknown. An unfinished final JSONL record is deferred; a Devin ATIF source\nis one whole document and parses completely or not at all. Nothing is uploaded.\n\nThe rich profile requires JSON, a stable nonsecret source generation (1..128\nASCII letters/digits/_/-), and an explicit half-open window of at most 31 days.\nThe default sessions producer retains unknown lineage, token scope and cache TTL.\nThe transcript producer reads Claude Code and Codex JSONL for request, tool,\ncontext and per-request usage facts with exact source timestamps; streaming\ntimings it cannot observe stay null. Without --state-dir every fact is revision\nzero. With --state-dir a private per-generation revision ledger in that directory\nassigns durable revisions: unchanged facts keep theirs, changed values get a\ncorrective revision and facts missing from a later export of the same window are\nemitted as retractions. A new generation is a separate namespace, not a\ndeduplication mechanism.\n";
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Producer {
    Sessions,
    Transcript,
}
struct Options {
    sources: Vec<(Provider, PathBuf)>,
    key: PathBuf,
    json: bool,
    rich: Option<rich_facts::ExportOptions>,
    producer: Producer,
    state_dir: Option<PathBuf>,
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
    let mut producer = None;
    let mut state_dir = None;
    let mut args = args[1..].iter();
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--json" if !json => json = true,
            "--profile" | "--source-epoch" | "--window-start-ms" | "--window-end-ms"
            | "--producer" | "--state-dir" => {
                let value = args
                    .next()
                    .filter(|value| !value.is_empty() && !value.starts_with("--"))
                    .ok_or("missing_option_value")?;
                let slot = match flag.as_str() {
                    "--profile" => &mut profile,
                    "--source-epoch" => &mut epoch,
                    "--window-start-ms" => &mut start,
                    "--window-end-ms" => &mut end,
                    "--producer" => &mut producer,
                    _ => &mut state_dir,
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
            if let Some(dir) = state_dir {
                if dir.len() > 1023 || dir.as_bytes().contains(&0) || !Path::new(dir).is_absolute()
                {
                    return Err("invalid_state_dir");
                }
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
            if epoch.is_some()
                || start.is_some()
                || end.is_some()
                || producer.is_some()
                || state_dir.is_some()
            {
                return Err("invalid_option");
            }
            None
        }
        Some(_) => return Err("invalid_profile"),
    };
    let producer = match producer {
        None | Some("sessions") => Producer::Sessions,
        Some("transcript") => Producer::Transcript,
        Some(_) => return Err("invalid_producer"),
    };
    if producer == Producer::Transcript
        && sources
            .iter()
            .any(|(provider, _)| !matches!(provider, Provider::ClaudeCode | Provider::Codex))
    {
        return Err("unsupported_provider");
    }
    Ok(Options {
        sources,
        key: key.ok_or("occurrence_key_required")?,
        json,
        rich,
        producer,
        state_dir: state_dir.map(PathBuf::from),
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
            producer,
            state_dir,
        } = options;
        let _ = (sources, key, json, rich, producer, state_dir);
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
        ledger: Option<ledger::Pending>,
    }
    impl Captured {
        /// Output is released only after every source is re-verified and, when a
        /// state directory was named, the advanced revision ledger is durable.
        pub(super) fn finish(self) -> Result<String, &'static str> {
            self.key
                .snapshot
                .verify()
                .map_err(|_| "key_changed_during_scan")?;
            for (_, source) in &self.sources {
                source.verify()?;
            }
            if let Some(pending) = self.ledger {
                pending.persist()?;
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
        if let (Some(rich), Producer::Transcript) = (&options.rich, options.producer) {
            let mut prefixes = Vec::new();
            for (provider, source) in &mut sources {
                prefixes.push(source.complete_prefix(*provider)?);
            }
            let mut readers = Vec::new();
            for ((provider, source), prefix) in sources.iter_mut().zip(prefixes) {
                source
                    .file
                    .seek(SeekFrom::Start(0))
                    .map_err(|_| "source_read_failed")?;
                readers.push((*provider, BufReader::new((&mut source.file).take(prefix))));
            }
            let (mut report, _measured) =
                rich_facts::transcript::project_transcripts(readers, &key.value, rich)?;
            for (_, source) in &sources {
                source.verify()?;
            }
            let ledger =
                ledger::advance(options.state_dir.as_deref(), &key.value, rich, &mut report)?;
            let output = report.to_json()?;
            return Ok(Captured {
                key,
                sources,
                output,
                ledger,
            });
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
        let mut ledger = None;
        let output = if let Some(rich) = options.rich {
            let mut projected = rich_facts::project_sessions(&report, &key.value, &rich)?;
            ledger = ledger::advance(
                options.state_dir.as_deref(),
                &key.value,
                &rich,
                &mut projected,
            )?;
            projected.to_json()?
        } else if options.json {
            serde_json::to_string(&report).map_err(|_| "summary_encode_failed")?
        } else {
            format!("AI Charts sessions: local only; {} sessions with token observations; streaming and wait times unknown\n", report.session_count())
        };
        if output.len() > 8 * 1024 * 1024 {
            return Err("report_size_limit");
        }
        Ok(Captured {
            key,
            sources,
            output,
            ledger,
        })
    }
    /// Durable per-generation revision ledger beside the native state. The file
    /// is private, MAC-bound to the occurrence key, replaced atomically, and
    /// named by the keyed source identity so each generation has its own
    /// counter. Nothing here is uploaded or shared.
    mod ledger {
        use super::*;
        use aicharts_core::rich_facts::revision::{Ledger, MAX_LEDGER_BYTES};
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        use std::{
            io::Write,
            os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
        };
        const DOMAIN: &[u8] = b"aicharts:rich-facts-ledger-v1\0";
        const MAX_FILE_BYTES: u64 = MAX_LEDGER_BYTES as u64 + 65;
        pub(super) struct Pending {
            directory: PathBuf,
            name: String,
            bytes: Vec<u8>,
        }
        fn mac(key: &[u8; 32], bytes: &[u8]) -> Result<String, &'static str> {
            let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|_| "invalid_key")?;
            mac.update(DOMAIN);
            mac.update(bytes);
            Ok(mac
                .finalize()
                .into_bytes()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect())
        }
        fn directory(path: &Path) -> Result<(), &'static str> {
            let metadata = fs::symlink_metadata(path).map_err(|_| "state_dir_unavailable")?;
            if !metadata.is_dir() {
                return Err("state_dir_unavailable");
            }
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err("state_dir_permissions_must_be_private");
            }
            Ok(())
        }
        fn read(path: &Path, key: &[u8; 32]) -> Result<Option<Ledger>, &'static str> {
            if fs::symlink_metadata(path).is_err() {
                return Ok(None);
            }
            let mut file = crate::open_regular(path).map_err(|_| "ledger_unavailable")?;
            let metadata = file.metadata().map_err(|_| "ledger_unavailable")?;
            if metadata.len() > MAX_FILE_BYTES {
                return Err("ledger_size_limit");
            }
            if metadata.mode() & 0o077 != 0 {
                return Err("ledger_permissions_must_be_private");
            }
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)
                .map_err(|_| "ledger_unavailable")?;
            let Some((tag, body)) = bytes.split_at_checked(65) else {
                return Err("invalid_ledger");
            };
            if tag[64] != b'\n' || tag[..64] != *mac(key, body)?.as_bytes() {
                return Err("ledger_authentication_failed");
            }
            Ledger::decode(body).map(Some)
        }
        /// Apply the persisted ledger (or a fresh one) to `report` in place and
        /// return the bytes to persist once the caller's sources are verified.
        pub(super) fn advance(
            state_dir: Option<&Path>,
            key: &[u8; 32],
            options: &rich_facts::ExportOptions,
            report: &mut rich_facts::Report,
        ) -> Result<Option<Pending>, &'static str> {
            let Some(state_dir) = state_dir else {
                return Ok(None);
            };
            directory(state_dir)?;
            let name = format!("rich-facts-ledger-{}.v1", report.source_id());
            let mut ledger = match read(&state_dir.join(&name), key)? {
                Some(ledger) => {
                    if ledger.source_epoch() != options.source_epoch() {
                        return Err("ledger_source_mismatch");
                    }
                    ledger
                }
                None => Ledger::new(options.source_epoch(), report.source_id()),
            };
            let before = ledger.encode()?;
            ledger.apply(report)?;
            let body = ledger.encode()?;
            if body == before {
                // An identical repeat leaves the durable file untouched.
                return Ok(None);
            }
            let mut bytes = mac(key, &body)?.into_bytes();
            bytes.push(b'\n');
            bytes.extend_from_slice(&body);
            Ok(Some(Pending {
                directory: state_dir.to_owned(),
                name,
                bytes,
            }))
        }
        impl Pending {
            pub(super) fn persist(self) -> Result<(), &'static str> {
                directory(&self.directory)?;
                let mut nonce = [0u8; 16];
                getrandom::fill(&mut nonce).map_err(|_| "ledger_write_failed")?;
                let staged = self.directory.join(format!(
                    ".{}-{}.pending",
                    self.name,
                    nonce.iter().map(|b| format!("{b:02x}")).collect::<String>()
                ));
                let result = (|| {
                    let mut file = fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .mode(0o600)
                        .custom_flags(libc::O_NOFOLLOW)
                        .open(&staged)
                        .map_err(|_| "ledger_write_failed")?;
                    file.write_all(&self.bytes)
                        .map_err(|_| "ledger_write_failed")?;
                    file.sync_all().map_err(|_| "ledger_write_failed")?;
                    let target = self.directory.join(&self.name);
                    if fs::symlink_metadata(&target).is_ok_and(|m| !m.is_file()) {
                        return Err("ledger_unavailable");
                    }
                    fs::rename(&staged, &target).map_err(|_| "ledger_write_failed")?;
                    File::open(&self.directory)
                        .and_then(|dir| dir.sync_all())
                        .map_err(|_| "ledger_write_failed")
                })();
                let _ = fs::remove_file(&staged);
                result
            }
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{
            io::Write,
            os::unix::fs::{symlink, DirBuilderExt, OpenOptionsExt, PermissionsExt},
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
                    producer: Producer::Sessions,
                    state_dir: None,
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
        const CLAUDE_TRANSCRIPT: &str =
            include_str!("../../../fixtures/usage/rich-claude-transcript-v1.jsonl");
        const CODEX_TRANSCRIPT: &str =
            include_str!("../../../fixtures/usage/rich-codex-transcript-v1.jsonl");
        fn rich_options(f: &Fixture, files: &[(Provider, &str)], state: bool) -> Options {
            Options {
                key: f.path.join("key"),
                sources: files
                    .iter()
                    .map(|(provider, file)| (*provider, f.path.join(file)))
                    .collect(),
                json: true,
                rich: Some(
                    rich_facts::ExportOptions::new(
                        "synthetic_source_v1",
                        1_767_225_600_000,
                        1_767_225_660_000,
                    )
                    .unwrap(),
                ),
                producer: Producer::Transcript,
                state_dir: state.then(|| f.path.join("state")),
            }
        }
        fn revisions(output: &str) -> Vec<(String, u64, bool)> {
            let report: serde_json::Value = serde_json::from_str(output).unwrap();
            let mut rows: Vec<_> = report["facts"]
                .as_array()
                .unwrap()
                .iter()
                .map(|fact| {
                    (
                        fact["id"].as_str().unwrap().to_owned(),
                        fact["revision"].as_u64().unwrap(),
                        fact["value"].is_null(),
                    )
                })
                .collect();
            rows.sort();
            rows
        }
        #[test]
        fn transcript_producer_exports_request_tool_and_context_facts_without_content() {
            let f = Fixture::new();
            f.write("claude", CLAUDE_TRANSCRIPT.as_bytes());
            f.write("codex", CODEX_TRANSCRIPT.as_bytes());
            let output = capture(rich_options(
                &f,
                &[(Provider::ClaudeCode, "claude"), (Provider::Codex, "codex")],
                false,
            ))
            .unwrap()
            .finish()
            .unwrap();
            let report: serde_json::Value = serde_json::from_str(&output).unwrap();
            assert_eq!(report["profile"], "rich-facts-v1");
            assert_eq!(report["provenance"]["profile"], "numeric-producer-v1");
            assert_eq!(report["coverage"]["request"], "partial");
            assert_eq!(report["coverage"]["tool"], "partial");
            assert_eq!(report["coverage"]["context"], "partial");
            assert_eq!(report["coverage"]["span"], "unsupported");
            let facts = report["facts"].as_array().unwrap();
            for kind in ["usage", "request", "tool", "context"] {
                assert!(facts.iter().any(|fact| fact["kind"] == kind), "{kind}");
            }
            assert!(facts.iter().all(|fact| fact["revision"] == 0));
            assert!(!output.contains("CANARY"));
            assert!(!output.contains("req_synthetic"));
            assert!(!output.contains("11111111-2222"));
            let mut devin = rich_options(&f, &[(Provider::Devin, "claude")], false);
            devin.producer = Producer::Transcript;
            assert_eq!(capture(devin).err(), Some("unsupported_provider"));
        }
        #[test]
        fn revision_ledger_survives_restart_is_idempotent_and_records_corrections_and_retractions()
        {
            let f = Fixture::new();
            fs::DirBuilder::new()
                .mode(0o700)
                .create(f.path.join("state"))
                .unwrap();
            f.write("claude", CLAUDE_TRANSCRIPT.as_bytes());
            let first = capture(rich_options(&f, &[(Provider::ClaudeCode, "claude")], true))
                .unwrap()
                .finish()
                .unwrap();
            let first = revisions(&first);
            assert!(!first.is_empty());
            assert!(first
                .iter()
                .all(|(_, revision, retracted)| *revision == 1 && !retracted));
            let ledger_name = fs::read_dir(f.path.join("state"))
                .unwrap()
                .map(|entry| entry.unwrap().file_name().into_string().unwrap())
                .find(|name| name.starts_with("rich-facts-ledger-"))
                .unwrap();
            let ledger_path = f.path.join("state").join(&ledger_name);
            let stored = fs::read(&ledger_path).unwrap();
            assert_eq!(
                fs::metadata(&ledger_path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert!(!String::from_utf8_lossy(&stored).contains("CANARY"));
            // Restart with the same source: identical revisions and an untouched file.
            let second = capture(rich_options(&f, &[(Provider::ClaudeCode, "claude")], true))
                .unwrap()
                .finish()
                .unwrap();
            assert_eq!(revisions(&second), first);
            assert_eq!(fs::read(&ledger_path).unwrap(), stored);
            // Drop one request: its facts retract; the rest keep revision one.
            let trimmed: String = CLAUDE_TRANSCRIPT
                .lines()
                .filter(|line| !line.contains("req_synthetic_c"))
                .map(|line| format!("{line}\n"))
                .collect();
            fs::rename(f.path.join("claude"), f.path.join("claude-full")).unwrap();
            f.write("claude", trimmed.as_bytes());
            let third = capture(rich_options(&f, &[(Provider::ClaudeCode, "claude")], true))
                .unwrap()
                .finish()
                .unwrap();
            let third = revisions(&third);
            assert_eq!(third.len(), first.len());
            let retracted: Vec<_> = third.iter().filter(|(_, _, r)| *r).collect();
            assert_eq!(retracted.len(), 1);
            assert!(retracted.iter().all(|(_, revision, _)| *revision == 2));
            assert!(third
                .iter()
                .filter(|(_, _, r)| !r)
                .all(|(_, revision, _)| *revision == 1));
            // Restore the record with a changed value: a corrective revision three.
            let corrected = CLAUDE_TRANSCRIPT.replace(
                "\"requestId\":\"req_synthetic_c\",\"isApiErrorMessage\":true",
                "\"requestId\":\"req_synthetic_c\",\"isApiErrorMessage\":false",
            );
            assert_ne!(corrected, CLAUDE_TRANSCRIPT);
            fs::remove_file(f.path.join("claude")).unwrap();
            f.write("claude", corrected.as_bytes());
            let fourth = capture(rich_options(&f, &[(Provider::ClaudeCode, "claude")], true))
                .unwrap()
                .finish()
                .unwrap();
            let fourth = revisions(&fourth);
            assert!(fourth.iter().all(|(_, _, r)| !r));
            assert_eq!(fourth.iter().filter(|(_, rev, _)| *rev == 3).count(), 1);
            assert_eq!(
                fourth.iter().filter(|(_, rev, _)| *rev == 1).count(),
                first.len() - 1
            );
            // A tampered or foreign-key ledger refuses before any output.
            let mut tampered = fs::read(&ledger_path).unwrap();
            let last = tampered.len() - 2;
            tampered[last] ^= 1;
            fs::remove_file(&ledger_path).unwrap();
            f.write(&format!("state/{ledger_name}"), &tampered);
            assert_eq!(
                capture(rich_options(&f, &[(Provider::ClaudeCode, "claude")], true)).err(),
                Some("ledger_authentication_failed")
            );
            // A different generation never reads this ledger; a shared directory
            // with open permissions is refused.
            fs::set_permissions(f.path.join("state"), fs::Permissions::from_mode(0o755)).unwrap();
            assert_eq!(
                capture(rich_options(&f, &[(Provider::ClaudeCode, "claude")], true)).err(),
                Some("state_dir_permissions_must_be_private")
            );
            assert_eq!(
                capture(rich_options(&f, &[(Provider::ClaudeCode, "claude")], false))
                    .unwrap()
                    .finish()
                    .map(|output| revisions(&output).iter().all(|(_, rev, _)| *rev == 0)),
                Ok(true)
            );
        }
        #[test]
        fn a_changed_source_after_capture_leaves_the_ledger_untouched() {
            let f = Fixture::new();
            fs::DirBuilder::new()
                .mode(0o700)
                .create(f.path.join("state"))
                .unwrap();
            f.write("claude", CLAUDE_TRANSCRIPT.as_bytes());
            let captured =
                capture(rich_options(&f, &[(Provider::ClaudeCode, "claude")], true)).unwrap();
            fs::rename(f.path.join("claude"), f.path.join("saved")).unwrap();
            f.write("claude", CLAUDE_TRANSCRIPT.as_bytes());
            assert_eq!(captured.finish(), Err("source_changed_during_scan"));
            assert_eq!(fs::read_dir(f.path.join("state")).unwrap().count(), 0);
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
            for (extra, expected) in [
                (vec!["--producer", "transcript"], Ok(())),
                (vec!["--producer", "sessions"], Ok(())),
                (vec!["--producer", "future"], Err("invalid_producer")),
                (vec!["--state-dir", "/private/synthetic/state"], Ok(())),
                (
                    vec!["--state-dir", "relative/state"],
                    Err("invalid_state_dir"),
                ),
            ] {
                let mut extended = args.clone();
                extended.extend(extra.into_iter().map(str::to_owned));
                assert_eq!(
                    super::super::options(&extended).map(|options| {
                        assert_eq!(
                            options.producer == Producer::Transcript,
                            extended.contains(&"transcript".to_owned())
                        );
                    }),
                    expected
                );
            }
            let mut devin = args.clone();
            devin[1] = "--devin".to_owned();
            devin.extend(["--producer".to_owned(), "transcript".to_owned()]);
            assert_eq!(
                super::super::options(&devin).err(),
                Some("unsupported_provider")
            );
            for extra in [
                vec!["--producer", "transcript"],
                vec!["--state-dir", "/x/y"],
            ] {
                let invalid = base
                    .into_iter()
                    .chain(extra)
                    .map(str::to_owned)
                    .collect::<Vec<_>>();
                assert_eq!(
                    super::super::options(&invalid).err(),
                    Some("invalid_option")
                );
            }
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
