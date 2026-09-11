#![forbid(unsafe_code)]

mod reindex;
mod state;

use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, Read, Write};
use std::path::{Path, PathBuf};

use aicharts_core::{merge_collections, parse_reader, Collection, Warning};
use aicharts_protocol::{encode, Policy, Provider, Registry};

const MAX_FILES: usize = 2_048;
const MAX_DEPTH: usize = 16;
const MAX_ENTRIES: usize = 20_000;
const MAX_SOURCE_BYTES: u64 = 256 * 1_024 * 1_024;
const HELP: &str = "AI Charts Usage — local-only foundation

  aicharts usage --key-file PATH [--codex FILE_OR_DIR] [--claude FILE_OR_DIR] [--json]
  aicharts upload --dry-run --key-file PATH [--codex FILE_OR_DIR] [--claude FILE_OR_DIR]
  aicharts keygen --output PATH
  aicharts init --state-dir DIR --key-file PATH
  aicharts collect --state-dir DIR --key-file PATH [--codex FILE_OR_DIR] [--claude FILE_OR_DIR] [--rescan] [--json]
  aicharts status --state-dir DIR --key-file PATH [--json]
  aicharts outbox --dry-run --state-dir DIR --key-file PATH [--limit 1..256] [--after ID --revision N]
  aicharts reindex-plan --dry-run --state-dir OLD --key-file PATH [--codex FILE_OR_DIR] [--claude FILE_OR_DIR] [--json]
  aicharts reindex-prepare --state-dir OLD --key-file PATH --shadow-dir NEW --occurrence-key-file PATH [--codex FILE_OR_DIR] [--claude FILE_OR_DIR] [--json]

Sources may be repeated. Directories scan .jsonl files and skip symlink entries.
Final source files must be regular files; this is not an OS source sandbox.
usage prints numeric summaries. upload --dry-run prints canonical frames as hex JSON;
it does not contact any service. Key files contain exactly 32 private random bytes.
keygen creates a new mode-0600 file on Unix and never overwrites an existing file.
Persistent commands are Unix-only and require explicit initialization. collect
rescans changed sources from the beginning; unchanged metadata skips parsing.
outbox is a read-only preview. No acknowledgement or sending is enabled.
reindex-plan inspects existing state without recovery or writes and rereads explicit
sources. reindex-prepare creates a new account-key-bound shadow only when every old
measurement is exactly covered. Neither command changes or promotes the old state.
No account sign-in, upload, daemon, key recovery or OS sandbox is implemented yet.
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
            flag @ ("--key-file" | "--codex" | "--claude" | "--output") => {
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
    depth: usize,
    files: &mut Vec<PathBuf>,
    visited: &mut usize,
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
        if depth == 0 || path.extension().is_some_and(|s| s == "jsonl") {
            if files.len() >= MAX_FILES {
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
            source_files(&entry.path(), depth + 1, files, visited)?;
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
        source_files(source, 0, &mut files, &mut visited)?;
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
        Ok(format!("AI Charts Usage — local only; nothing uploaded\nObserved tokens: {token_total}\nObserved output tokens: {output_total}\nUsage occurrences: {usage_total}\nPrompt counts and activity: unavailable\nCoverage: partial historical import\nPricing: unavailable; models remain unknown\nWarnings: {}\n", warnings.join(", ")))
    }
}

fn run(args: &[String]) -> Result<String, &'static str> {
    if args.is_empty() || args == ["--help"] || args == ["-h"] {
        return Ok(HELP.to_owned());
    }
    if matches!(
        args.first().map(String::as_str),
        Some("reindex-plan" | "reindex-prepare")
    ) {
        return reindex::run(args);
    }
    if matches!(
        args.first().map(String::as_str),
        Some("init" | "collect" | "status" | "outbox")
    ) {
        return state::run(args);
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
    match run(&args) {
        Ok(output) => {
            if io::stdout().lock().write_all(output.as_bytes()).is_err() {
                std::process::exit(1);
            }
        }
        Err(code) => {
            eprintln!("aicharts: {code}");
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
    fn real_upload_is_rejected_before_reading_any_sources() {
        assert_eq!(
            run(&args(&["upload"])),
            Err("upload_not_enabled_use_dry_run")
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
    fn help_does_not_read_source_data() {
        assert!(run(&args(&["--help"])).unwrap().contains("local-only"));
    }
}
