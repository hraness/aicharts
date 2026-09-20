#![forbid(unsafe_code)]

mod autosubmit;
mod capture;
mod daemon;
mod enroll;
#[cfg(unix)]
mod enrolled_ledger;
mod enrollment;
mod inspect;
mod intro;
#[cfg(unix)]
mod prefix;
mod reindex;
mod sessions;
mod source_refresh;
mod state;
mod stats;
mod stats_sync;
mod support;
mod sync;
mod transport_dns;
#[cfg(test)]
mod transport_test_log;
mod turns;
mod upload;
mod version;

use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};

use aicharts_core::{merge_collections, parse_reader, Collection, Warning};
use aicharts_protocol::{encode, Policy, Provider, Registry};

const MAX_FILES: usize = 2_048;
/// Files discovered under one explicit source tree, and the deduplicated
/// total a persistent collection admits across all trees. Deliberately larger
/// than the retained ledger source bound: bounded waves then commit every
/// discovered source until the retained cap refuses further growth.
const MAX_DISCOVERY_FILES: usize = 65_536;
/// Changed sources committed in one atomic wave: the 256 MiB byte bound and
/// this file bound both bound a single commit's work.
const MAX_WAVE_FILES: u64 = 2_048;
const MAX_DEPTH: usize = 16;
const MAX_ENTRIES: usize = 262_144;
const MAX_SOURCE_BYTES: u64 = 256 * 1_024 * 1_024;
/// Serializes test fixtures whose repository-path create/remove would race
/// another fixture's descriptor-pinned path readbacks.
#[cfg(test)]
pub(crate) static TEST_FIXTURE_PARENT: std::sync::Mutex<()> = std::sync::Mutex::new(());
/// Argument-shape errors point an interactive caller at the command contract;
/// state and data errors keep their single line so the cause stays unambiguous.
const USAGE_HINT_CODES: &[&str] = &[
    "invalid_command",
    "invalid_option",
    "missing_option_value",
    "explicit_key_and_source_required",
    "explicit_source_required",
    "state_directory_required",
    "key_required",
    "output_required",
    "occurrence_key_required",
    "invalid_interval",
    "invalid_retry_attempts",
    "upload_not_enabled_use_dry_run",
    "too_many_sources",
];
const HELP: &str = "AI Charts Usage — local reports and enrolled publication

  aicharts --version [--json]
  aicharts stats --home DIR (--all | --client ID ...) [--since YYYY-MM-DD --until YYYY-MM-DD] [--json]
  aicharts stats-sync --state-dir DIR --key-file PATH --home DIR --client ID [--since YYYY-MM-DD --until YYYY-MM-DD]
  aicharts refresh --help
  aicharts autosubmit --config-file PATH [--check | --dry-run]
  aicharts capture mcode --cache-dir DIR --executable PATH -- exec ...
  aicharts support protocol --json
  aicharts support --help
  aicharts turns --codex FILE [--codex FILE ...] --occurrence-key-file KEY [--json]
  aicharts sessions --occurrence-key-file KEY [--codex FILE ...] [--claude FILE ...] [--devin FILE ...] [--json]
  aicharts usage --key-file PATH [--codex FILE_OR_DIR] [--claude FILE_OR_DIR] [--devin FILE_OR_DIR] [--json]
  aicharts upload --state-dir DIR --key-file PATH [--resume]
  aicharts sync --complete-prefix --state-dir DIR --key-file PATH [--codex FILE_OR_DIR] [--claude FILE_OR_DIR] [--devin FILE_OR_DIR] [--max-batches N] [--reconcile-retained] [--json]
  aicharts upload --dry-run --key-file PATH [--codex FILE_OR_DIR] [--claude FILE_OR_DIR] [--devin FILE_OR_DIR]
  aicharts keygen --output PATH
  aicharts init --state-dir DIR --key-file PATH
  aicharts collect --state-dir DIR --key-file PATH [--codex FILE_OR_DIR] [--claude FILE_OR_DIR] [--devin FILE_OR_DIR] [--rescan] [--json]
  aicharts prefix-enable --state-dir DIR --key-file PATH --revision N
  aicharts collect-prefix --state-dir DIR --key-file PATH [--codex FILE_OR_DIR] [--claude FILE_OR_DIR] [--devin FILE_OR_DIR] [--rescan] [--json]
  aicharts status --state-dir DIR --key-file PATH [--json]
  aicharts inspect --state-dir DIR --key-file PATH [--occurrence-key-file PATH] [--json]
  aicharts daemon [--once] [--complete-prefix] --state-dir DIR --key-file PATH [--codex FILE_OR_DIR] [--claude FILE_OR_DIR] [--devin FILE_OR_DIR] [--interval-seconds N] [--retry-attempts N] [--json]
  aicharts enroll --state-dir DIR
  aicharts outbox --dry-run --state-dir DIR --key-file PATH [--limit 1..256] [--after ID --revision N]
  aicharts reindex-plan --dry-run --state-dir OLD --key-file PATH [--codex FILE_OR_DIR] [--claude FILE_OR_DIR] [--devin FILE_OR_DIR] [--json]
  aicharts reindex-prepare --state-dir OLD --key-file PATH --shadow-dir NEW --occurrence-key-file PATH [--codex FILE_OR_DIR] [--claude FILE_OR_DIR] [--devin FILE_OR_DIR] [--json]

Every command also answers `aicharts COMMAND --help` with its contract.
Sources may be repeated. Directories scan .jsonl files (.json ATIF transcripts
for --devin) and skip symlink entries.
turns requires explicit regular files instead; it never scans directories. It
reports runtime and partial response-token/requested-call subtotals.
Complete token totals and dispatched tool calls remain unknown. Nothing is uploaded.
Version reports compiler metadata only, with no verified release provenance.
Final source files must be regular files; this is not an OS source sandbox.
usage prints numeric summaries. upload --dry-run prints canonical frames as hex JSON;
it does not contact any service. On an enrolled macOS installation, upload
--state-dir sends at most one bounded pending batch to the fixed usage service
and settles the local ledger only on a validated terminal journal; an uncertain
reply retains the frozen flight for explicit recovery, never a speculative
replay. upload --resume re-exchanges that exact retained batch and settles only
on its validated journal; it refuses when no flight is retained. Key files
contain exactly 32 private random bytes.
keygen creates a new mode-0600 file on Unix and never overwrites an existing file.
Persistent commands are Unix-only and require explicit initialization. collect
rescans changed sources from the beginning; unchanged metadata skips parsing.
prefix-enable explicitly adds local completed-prefix integrity metadata. Then use
collect-prefix: it fully replays completed lines and defers an unfinished tail.
A --devin source is one whole ATIF document, so its completed prefix is the
entire file; a changed transcript is a new source, never an append.
Metadata skipping is a reliability optimization, not tamper attestation; --rescan
rehashes every retained prefix. Neither command uploads content or enables sending.
outbox never acknowledges or sends; ordinary state opening can recover SQLite.
inspect reads only an existing ledger without source scanning, recovery or writes.
An explicit occurrence key selects the existing split-key namespace version 1;
omitting it selects legacy identity. Neither option migrates or rekeys state.
reindex-plan inspects existing state without recovery or writes and rereads explicit
sources. reindex-prepare creates a new account-key-bound shadow only when every old
measurement is exactly covered. Neither command changes or promotes the old state.
daemon runs the existing local collector in the foreground; --once performs one
pass for smoke/tests. --json requires a preceding --once. The default waits 15
minutes after each pass. --complete-prefix selects collect-prefix for an already
prefix-enabled ledger; it defers stable unfinished tails and never migrates state.
Omitting it retains collect. A ledger mode mismatch fails before reading sources.
It retries only bounded transient ledger busy/change results (three retries by default;
--retry-attempts accepts 0..8) before returning a fixed error. It never
uploads or installs an OS service.
sync performs one supervised collection and bounded upload pass on an already
enrolled macOS installation. It requires an existing prefix-enabled sender ledger;
it never initializes, migrates, enrolls or installs a service. See sync --help.
enroll pairs this installation with an AI Charts account through local macOS
credential custody and one explicit browser approval; it never uploads and only
prepares the option to upload later. Enrollment does not install a scheduled
publisher or recover an unavailable key. See autosubmit --help for scheduling.
Keep your key private and retain it: changing it changes occurrence identities.
";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Usage,
    DryRun,
    Keygen,
}

#[derive(Debug)]
struct Options {
    mode: Mode,
    key: Option<PathBuf>,
    sources: Vec<(Provider, PathBuf)>,
    json: bool,
    output: Option<PathBuf>,
}

fn options(args: &[String]) -> Result<Options, &'static str> {
    let mode = match args.first().map(String::as_str) {
        Some("usage") => Mode::Usage,
        Some("upload") => Mode::DryRun,
        Some("keygen") => Mode::Keygen,
        _ => return Err("invalid_command"),
    };
    let mut result = Options {
        mode,
        key: None,
        sources: vec![],
        json: false,
        output: None,
    };
    let mut dry_run = false;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--dry-run" if mode == Mode::DryRun && !dry_run => dry_run = true,
            "--json" if mode == Mode::Usage && !result.json => result.json = true,
            flag @ ("--key-file" | "--codex" | "--claude" | "--devin" | "--output") => {
                i += 1;
                let value = args
                    .get(i)
                    .filter(|s| !s.is_empty())
                    .ok_or("missing_option_value")?;
                let path = PathBuf::from(value);
                match flag {
                    "--key-file" if mode != Mode::Keygen && result.key.is_none() => {
                        result.key = Some(path)
                    }
                    "--output" if mode == Mode::Keygen && result.output.is_none() => {
                        result.output = Some(path)
                    }
                    "--codex" if mode != Mode::Keygen => {
                        result.sources.push((Provider::Codex, path))
                    }
                    "--claude" if mode != Mode::Keygen => {
                        result.sources.push((Provider::ClaudeCode, path))
                    }
                    "--devin" if mode != Mode::Keygen => {
                        result.sources.push((Provider::Devin, path))
                    }
                    _ => return Err("invalid_option"),
                }
            }
            _ => return Err("invalid_option"),
        }
        i += 1;
    }
    if mode == Mode::DryRun && !dry_run {
        return Err("upload_not_enabled_use_dry_run");
    }
    if mode == Mode::Keygen {
        if result.output.is_none() {
            return Err("output_required");
        }
    } else if result.key.is_none() || result.sources.is_empty() {
        return Err("explicit_key_and_source_required");
    }
    if result.sources.len() > MAX_FILES {
        return Err("too_many_sources");
    }
    Ok(result)
}

fn open_regular(path: &Path) -> Result<File, &'static str> {
    let before = fs::symlink_metadata(path).map_err(|_| "file_open_failed")?;
    if !before.is_file() {
        return Err("file_not_regular");
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(|_| "file_open_failed")?;
    let after = file.metadata().map_err(|_| "file_open_failed")?;
    if !after.is_file() {
        return Err("file_not_regular");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != after.dev() || before.ino() != after.ino() {
            return Err("file_changed_during_open");
        }
    }
    Ok(file)
}

fn read_key(path: &Path) -> Result<[u8; 32], &'static str> {
    let mut file = open_regular(path).map_err(|_| "key_read_failed")?;
    let meta = file.metadata().map_err(|_| "key_read_failed")?;
    if !meta.is_file() || meta.len() != 32 {
        return Err("invalid_key_file");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o077 != 0 {
            return Err("key_permissions_must_be_private");
        }
    }
    let mut key = [0u8; 32];
    file.read_exact(&mut key).map_err(|_| "key_read_failed")?;
    let mut extra = [0u8; 1];
    if file.read(&mut extra).map_err(|_| "key_read_failed")? != 0 || key == [0; 32] {
        return Err("invalid_key_file");
    }
    Ok(key)
}

#[cfg(unix)]
fn keygen(path: &Path) -> Result<(), &'static str> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut key = [0u8; 32];
    getrandom::fill(&mut key).map_err(|_| "randomness_unavailable")?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .map_err(|_| "key_create_failed")?;
    file.write_all(&key).map_err(|_| "key_write_failed")?;
    file.sync_all().map_err(|_| "key_write_failed")?;
    Ok(())
}

#[cfg(not(unix))]
fn keygen(_path: &Path) -> Result<(), &'static str> {
    Err("keygen_requires_qualified_credential_storage")
}

fn source_files(
    path: &Path,
    provider: Provider,
    depth: usize,
    files: &mut Vec<PathBuf>,
    visited: &mut usize,
    file_limit: usize,
) -> Result<(), &'static str> {
    *visited += 1;
    if *visited > MAX_ENTRIES {
        return Err("source_entry_limit");
    }
    if depth > MAX_DEPTH {
        return Err("source_depth_limit");
    }
    let meta = fs::symlink_metadata(path).map_err(|_| "source_metadata_failed")?;
    if meta.file_type().is_symlink() {
        return Err("source_symlink_not_allowed");
    }
    if meta.is_file() {
        // ATIF transcripts are .json documents; provider JSONL stays .jsonl.
        let extension = if provider == Provider::Devin {
            "json"
        } else {
            "jsonl"
        };
        if depth == 0 || path.extension().is_some_and(|s| s == extension) {
            if files.len() >= file_limit {
                return Err("source_file_limit");
            }
            files.push(path.to_path_buf());
        }
    } else if meta.is_dir() {
        let entries = fs::read_dir(path).map_err(|_| "source_directory_failed")?;
        for entry in entries {
            let entry = entry.map_err(|_| "source_directory_failed")?;
            if entry
                .file_type()
                .map_err(|_| "source_metadata_failed")?
                .is_symlink()
            {
                *visited += 1;
                if *visited > MAX_ENTRIES {
                    return Err("source_entry_limit");
                }
                continue;
            }
            source_files(
                &entry.path(),
                provider,
                depth + 1,
                files,
                visited,
                file_limit,
            )?;
        }
    } else {
        return Err("source_not_regular");
    }
    Ok(())
}

fn collect(options: &Options) -> Result<Collection, &'static str> {
    let key = read_key(options.key.as_ref().ok_or("key_required")?)?;
    let mut collections = vec![];
    let mut seen = std::collections::BTreeSet::new();
    let mut total_files = 0;
    let mut visited = 0;
    let mut total_bytes = 0u64;
    let mut retained_measurements = 0usize;
    for (provider, source) in &options.sources {
        let mut files = vec![];
        source_files(source, *provider, 0, &mut files, &mut visited, MAX_FILES)?;
        files.sort();
        for file in files {
            let canonical = fs::canonicalize(&file).map_err(|_| "source_metadata_failed")?;
            if !seen.insert((*provider, canonical)) {
                continue;
            }
            total_files += 1;
            if total_files > MAX_FILES {
                return Err("source_file_limit");
            }
            let input = open_regular(&file).map_err(|_| "source_read_failed")?;
            let source_size = input
                .metadata()
                .map_err(|_| "source_metadata_failed")?
                .len();
            total_bytes = total_bytes
                .checked_add(source_size)
                .ok_or("source_byte_limit")?;
            if total_bytes > MAX_SOURCE_BYTES {
                return Err("source_byte_limit");
            }
            // Do not absorb unbounded appends while scanning a live file. Appends
            // require another explicit scan; cursor-based incremental reading is future work.
            let collection = parse_reader(BufReader::new(input.take(source_size)), *provider, &key)
                .map_err(|_| "source_parse_failed")?;
            let new_measurements: usize = collection
                .batches
                .iter()
                .map(|batch| batch.usage.len())
                .sum();
            retained_measurements = retained_measurements
                .checked_add(new_measurements)
                .ok_or("retained_measurement_limit")?;
            if retained_measurements > aicharts_core::MAX_MEASUREMENTS {
                return Err("retained_measurement_limit");
            }
            collections.push(collection);
        }
    }
    if total_files == 0 {
        return Err("no_source_files");
    }
    merge_collections(collections).map_err(|_| "source_merge_failed")
}

fn render(collection: &Collection, mode: Mode, json: bool) -> Result<String, &'static str> {
    let registry = Registry {
        revision: 1,
        models: vec![],
    };
    let mut token_total = 0u64;
    let mut output_total = 0u64;
    let mut prompt_total = 0usize;
    let mut usage_total = 0usize;
    let mut frames = vec![];
    for batch in &collection.batches {
        for usage in &batch.usage {
            token_total = token_total
                .checked_add(usage.tokens.total().map_err(|_| "counter_overflow")?)
                .ok_or("counter_overflow")?;
            output_total = output_total
                .checked_add(usage.tokens.output)
                .ok_or("counter_overflow")?;
        }
        prompt_total += batch.prompts.len();
        usage_total += batch.usage.len();
        if mode == Mode::DryRun {
            let policy = Policy {
                first_day: batch.utc_day,
                last_day: batch.utc_day,
                registry: &registry,
            };
            let bytes = encode(batch, &policy).map_err(|_| "frame_validation_failed")?;
            let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
            frames.push(
                serde_json::json!({ "utcDay": batch.utc_day, "bytes": bytes.len(), "hex": hex }),
            );
        }
    }
    let warnings: Vec<_> = collection.warnings.iter().map(|w| w.code()).collect();
    let measured_prompts = if collection.warnings.contains(&Warning::UnmeasuredPrompts) {
        None
    } else {
        Some(prompt_total)
    };
    if json || mode == Mode::DryRun {
        let mut result = serde_json::json!({
            "schemaVersion": 1, "localOnly": true, "uploaded": false,
            "tokens": token_total.to_string(), "outputTokens": output_total.to_string(),
            "usageOccurrences": usage_total, "promptOccurrences": measured_prompts,
            "measurementCoverage": "partial", "activityCoverage": "unavailable",
            "humanOriginVerified": false, "modelPricingAvailable": false,
            "linesRead": collection.lines_read, "warnings": warnings,
        });
        if mode == Mode::DryRun {
            result["frames"] = serde_json::Value::Array(frames);
        }
        serde_json::to_string_pretty(&result).map_err(|_| "summary_encode_failed")
    } else {
        Ok(format!(
            "AI Charts Usage — local only; nothing uploaded\nObserved tokens: {token_total}\nObserved output tokens: {output_total}\nUsage occurrences: {usage_total}\nPrompt counts and activity: unavailable\nCoverage: partial historical import\nPricing: unavailable; models remain unknown\nWarnings: {}\n",
            warnings.join(", ")
        ))
    }
}

fn run(args: &[String]) -> Result<String, &'static str> {
    // Reserve the identity flag before any command can interpret it as a path.
    if args.iter().any(|arg| arg == "--version") {
        return version::run(args);
    }
    if args.is_empty() || args == ["--help"] || args == ["-h"] {
        return Ok(HELP.to_owned());
    }
    // turns, sessions, daemon and support answer their own help inside their
    // runners; every other known command gets the top-level contract.
    if args.len() == 2
        && matches!(args[1].as_str(), "--help" | "-h")
        && matches!(
            args[0].as_str(),
            "usage"
                | "keygen"
                | "init"
                | "collect"
                | "prefix-enable"
                | "collect-prefix"
                | "status"
                | "outbox"
                | "inspect"
                | "enroll"
                | "reindex-plan"
                | "reindex-prepare"
                | "upload"
        )
    {
        return Ok(HELP.to_owned());
    }
    if args.first().map(String::as_str) == Some("turns") {
        return turns::run(args);
    }
    if args.first().map(String::as_str) == Some("sessions") {
        return sessions::run(args);
    }
    if args.first().map(String::as_str) == Some("stats") {
        return stats::run(args);
    }
    if args.first().map(String::as_str) == Some("stats-sync") {
        return stats_sync::run(args);
    }
    if args.first().map(String::as_str) == Some("refresh") {
        return source_refresh::run(&args[1..]);
    }
    if args.first().map(String::as_str) == Some("inspect") {
        return inspect::run(args);
    }
    if args.first().map(String::as_str) == Some("daemon") {
        return daemon::run(args);
    }
    if args.first().map(String::as_str) == Some("enroll") {
        return enroll::run(args);
    }
    if matches!(
        args.first().map(String::as_str),
        Some("reindex-plan" | "reindex-prepare")
    ) {
        return reindex::run(args);
    }
    if matches!(
        args.first().map(String::as_str),
        Some("init" | "collect" | "prefix-enable" | "collect-prefix" | "status" | "outbox")
    ) {
        return state::run(args);
    }
    // The enrolled send owns `upload` unless `--dry-run` selects the separate
    // fresh-source preview below.
    if args.first().map(String::as_str) == Some("upload")
        && !args[1..].iter().any(|arg| arg == "--dry-run")
    {
        return upload::run(args);
    }
    let options = options(args)?;
    if options.mode == Mode::Keygen {
        keygen(options.output.as_ref().ok_or("output_required")?)?;
        return Ok(
            "Private namespace key created. Keep it safe; no data was read or uploaded.\n"
                .to_owned(),
        );
    }
    render(&collect(&options)?, options.mode, options.json)
}

fn main() {
    let args: Result<Vec<String>, _> = std::env::args_os()
        .skip(1)
        .map(|arg| arg.into_string())
        .collect();
    let Ok(args) = args else {
        eprintln!("aicharts: invalid_argument_encoding");
        std::process::exit(2);
    };
    let support_options = support::options();
    if matches!(
        args.first().map(String::as_str),
        Some("autosubmit" | "capture")
    ) && !args.iter().any(|arg| arg == "--version")
    {
        let outcome = if args[0] == "capture" {
            capture::run(&args[1..]).map(|outcome| (outcome.summary, outcome.exit_code))
        } else {
            autosubmit::run(&args).map(|outcome| (outcome.summary, outcome.exit_code))
        };
        match outcome {
            Ok((summary, exit_code)) => {
                let stdout = io::stdout();
                let mut writer = stdout.lock();
                if writer
                    .write_all(summary.as_bytes())
                    .and_then(|()| writer.flush())
                    .is_err()
                {
                    std::process::exit(1);
                }
                std::process::exit(exit_code);
            }
            Err(code) => {
                eprintln!("aicharts: {code}");
                std::process::exit(2);
            }
        }
    }
    if args.first().map(String::as_str) == Some("support") {
        std::process::exit(support::execute(&args[1..], &support_options));
    }
    if args.first().map(String::as_str) == Some("sync")
        && !args.iter().any(|arg| arg == "--version")
    {
        std::process::exit(sync::execute(&args));
    }
    match run(&args) {
        Ok(output) => {
            let stdout = io::stdout();
            let intro = if args.is_empty() || args == ["--help"] || args == ["-h"] {
                let term = std::env::var("TERM").ok();
                let columns = std::env::var("COLUMNS")
                    .ok()
                    .and_then(|value| value.parse().ok());
                intro::terminal_intro(stdout.is_terminal(), term.as_deref(), columns)
            } else {
                ""
            };
            let mut writer = stdout.lock();
            if writer
                .write_all(intro.as_bytes())
                .and_then(|()| writer.write_all(output.as_bytes()))
                .and_then(|()| writer.flush())
                .is_err()
            {
                std::process::exit(1);
            }
            drop(writer);
            if support::useful_read(&args) {
                support::completed(&support_options);
            }
        }
        Err(code) => {
            eprintln!("aicharts: {code}");
            // Piped output keeps the exact one-line contract; an interactive
            // caller gets a pointer to the command contract for usage errors.
            if io::stderr().is_terminal() && USAGE_HINT_CODES.contains(&code) {
                eprintln!("aicharts: run 'aicharts --help' for the command contract");
            }
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn upload_requires_state_dir_and_key_before_any_source_read() {
        assert_eq!(run(&args(&["upload"])), Err("state_directory_required"));
        assert_eq!(
            run(&args(&["upload", "--state-dir", "d"])),
            Err("key_required")
        );
        // `--dry-run` still routes to the fresh-source preview options.
        assert_eq!(
            run(&args(&["upload", "--dry-run"])),
            Err("explicit_key_and_source_required")
        );
    }

    #[test]
    fn sources_and_key_are_explicit_and_options_closed() {
        assert_eq!(
            options(&args(&["usage"])).unwrap_err(),
            "explicit_key_and_source_required"
        );
        assert!(options(&args(&[
            "usage",
            "--key-file",
            "k",
            "--codex",
            "c",
            "--devin",
            "d",
            "--json"
        ]))
        .is_ok());
        assert_eq!(
            options(&args(&["usage", "--unknown", "PRIVATE_CANARY"])).unwrap_err(),
            "invalid_option"
        );
        assert_eq!(
            options(&args(&["keygen", "--output", "k", "--codex", "c"])).unwrap_err(),
            "invalid_option"
        );
    }

    #[test]
    fn provider_extension_rules_partition_discovered_sources() {
        let dir = std::env::temp_dir().join(format!("aicharts-src-{}", std::process::id()));
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("a.json"), b"{}").unwrap();
        std::fs::write(dir.join("b.jsonl"), b"").unwrap();
        let mut files = vec![];
        let mut visited = 0;
        source_files(
            &dir,
            Provider::Devin,
            0,
            &mut files,
            &mut visited,
            MAX_FILES,
        )
        .unwrap();
        assert_eq!(files, vec![dir.join("a.json")]);
        files.clear();
        source_files(
            &dir,
            Provider::ClaudeCode,
            0,
            &mut files,
            &mut visited,
            MAX_FILES,
        )
        .unwrap();
        assert_eq!(files, vec![dir.join("b.jsonl")]);
        // A source named explicitly is the caller's choice, whatever its name.
        files.clear();
        source_files(
            &dir.join("b.jsonl"),
            Provider::Devin,
            0,
            &mut files,
            &mut visited,
            MAX_FILES,
        )
        .unwrap();
        assert_eq!(files, vec![dir.join("b.jsonl")]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn help_does_not_read_source_data() {
        let help = run(&args(&["--help"])).unwrap();
        assert!(help.contains("local reports and enrolled publication"));
        assert!(help.contains("partial response-token/requested-call subtotals"));
        assert!(help.contains("Complete token totals and dispatched tool calls remain unknown"));
        assert!(!help.contains("partial observed runtime with unknown tokens/tools"));
    }
}
