//! Local-only foreground daemon runner.
//!
//! This intentionally does not install an OS service, acquire credentials, or
//! contact a server. A qualified service manager can supervise this process
//! later without changing the collector's source or ledger boundaries.

use std::path::PathBuf;
use std::time::Duration;

const DEFAULT_INTERVAL_SECONDS: u64 = 15 * 60;
const MIN_INTERVAL_SECONDS: u64 = 60;
const MAX_INTERVAL_SECONDS: u64 = 24 * 60 * 60;
const DEFAULT_RETRY_ATTEMPTS: u8 = 3;
const MAX_RETRY_ATTEMPTS: u8 = 8;

#[derive(Debug)]
struct Options {
    state_dir: PathBuf,
    key_file: PathBuf,
    sources: Vec<(aicharts_protocol::Provider, PathBuf)>,
    interval_seconds: u64,
    retry_attempts: u8,
    complete_prefix: bool,
    once: bool,
    json: bool,
}

fn parse_options(args: &[String]) -> Result<Options, &'static str> {
    if args.first().map(String::as_str) != Some("daemon") {
        return Err("invalid_command");
    }
    let mut state_dir = None;
    let mut key_file = None;
    let mut sources = Vec::new();
    let mut interval_seconds = DEFAULT_INTERVAL_SECONDS;
    let mut interval_set = false;
    let mut retry_attempts = DEFAULT_RETRY_ATTEMPTS;
    let mut retry_set = false;
    let mut complete_prefix = false;
    let mut once = false;
    let mut json = false;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--complete-prefix" if !complete_prefix => complete_prefix = true,
            "--once" if !once => once = true,
            "--json" if once && !json => json = true,
            flag @ ("--state-dir" | "--key-file" | "--codex" | "--claude"
            | "--interval-seconds" | "--retry-attempts") => {
                i += 1;
                let value = args
                    .get(i)
                    .filter(|value| !value.is_empty())
                    .ok_or("missing_option_value")?;
                match flag {
                    "--state-dir" if state_dir.is_none() => state_dir = Some(PathBuf::from(value)),
                    "--key-file" if key_file.is_none() => key_file = Some(PathBuf::from(value)),
                    "--codex" => {
                        sources.push((aicharts_protocol::Provider::Codex, PathBuf::from(value)))
                    }
                    "--claude" => sources.push((
                        aicharts_protocol::Provider::ClaudeCode,
                        PathBuf::from(value),
                    )),
                    "--interval-seconds" if !interval_set => {
                        interval_seconds = value.parse().map_err(|_| "invalid_interval")?;
                        if !(MIN_INTERVAL_SECONDS..=MAX_INTERVAL_SECONDS)
                            .contains(&interval_seconds)
                        {
                            return Err("invalid_interval");
                        }
                        interval_set = true;
                    }
                    "--retry-attempts" if !retry_set => {
                        retry_attempts = value.parse().map_err(|_| "invalid_retry_attempts")?;
                        if retry_attempts > MAX_RETRY_ATTEMPTS {
                            return Err("invalid_retry_attempts");
                        }
                        retry_set = true;
                    }
                    _ => return Err("invalid_option"),
                }
            }
            "--help" | "-h" if args.len() == 2 => return Err("help"),
            _ => return Err("invalid_option"),
        }
        i += 1;
    }
    if sources.is_empty() {
        return Err("explicit_source_required");
    }
    if sources.len() > super::MAX_FILES {
        return Err("too_many_sources");
    }
    Ok(Options {
        state_dir: state_dir.ok_or("state_directory_required")?,
        key_file: key_file.ok_or("key_required")?,
        sources,
        interval_seconds,
        retry_attempts,
        complete_prefix,
        once,
        json,
    })
}

fn retryable(error: &'static str) -> bool {
    matches!(error, "ledger_busy_retry" | "ledger_changed_retry")
}

fn collect(options: &Options, args: &[String]) -> Result<String, &'static str> {
    let mut attempt = 0u8;
    loop {
        match super::state::run(args) {
            Ok(output) => return Ok(output),
            Err(error) if retryable(error) && attempt < options.retry_attempts => {
                let seconds = 1u64 << attempt.min(3);
                std::thread::sleep(Duration::from_secs(seconds));
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

fn collect_args(options: &Options) -> Vec<String> {
    let mut args = vec![
        if options.complete_prefix {
            "collect-prefix"
        } else {
            "collect"
        }
        .to_owned(),
        "--state-dir".to_owned(),
        options.state_dir.to_string_lossy().into_owned(),
        "--key-file".to_owned(),
        options.key_file.to_string_lossy().into_owned(),
    ];
    for (provider, path) in &options.sources {
        args.push(match provider {
            aicharts_protocol::Provider::Codex => "--codex".to_owned(),
            aicharts_protocol::Provider::ClaudeCode => "--claude".to_owned(),
        });
        args.push(path.to_string_lossy().into_owned());
    }
    if options.json {
        args.push("--json".to_owned());
    }
    args
}

pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    if args == ["daemon", "--help"] || args == ["daemon", "-h"] {
        return Ok(super::HELP.to_owned());
    }
    let options = parse_options(args)?;
    #[cfg(not(unix))]
    {
        let _ = options;
        return Err("daemon_requires_qualified_unix_storage");
    }
    #[cfg(unix)]
    {
        let collect_args = collect_args(&options);
        if options.once {
            return collect(&options, &collect_args);
        }
        loop {
            let output = collect(&options, &collect_args)?;
            println!("{output}");
            std::thread::sleep(Duration::from_secs(options.interval_seconds));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn requires_explicit_state_key_and_source() {
        assert_eq!(
            parse_options(&args(&["daemon"])).unwrap_err(),
            "explicit_source_required"
        );
        assert_eq!(
            parse_options(&args(&["daemon", "--codex", "sessions"])).unwrap_err(),
            "state_directory_required"
        );
    }

    #[test]
    fn accepts_one_shot_json_and_builds_only_collect_arguments() {
        let options = parse_options(&args(&[
            "daemon",
            "--once",
            "--json",
            "--state-dir",
            "state",
            "--key-file",
            "key",
            "--codex",
            "codex.jsonl",
            "--claude",
            "claude",
            "--interval-seconds",
            "60",
        ]))
        .expect("valid daemon options");
        assert!(options.once);
        assert!(options.json);
        assert_eq!(options.interval_seconds, 60);
        assert_eq!(options.retry_attempts, DEFAULT_RETRY_ATTEMPTS);
        assert_eq!(collect_args(&options)[0], "collect");
        assert!(!collect_args(&options).contains(&"--once".to_owned()));
    }

    #[test]
    fn rejects_unsafe_intervals_and_json_without_once() {
        assert_eq!(
            parse_options(&args(&[
                "daemon",
                "--state-dir",
                "state",
                "--key-file",
                "key",
                "--codex",
                "source",
                "--interval-seconds",
                "1",
            ]))
            .unwrap_err(),
            "invalid_interval"
        );
        assert_eq!(
            parse_options(&args(&[
                "daemon",
                "--json",
                "--state-dir",
                "state",
                "--key-file",
                "key",
                "--codex",
                "source",
            ]))
            .unwrap_err(),
            "invalid_option"
        );
        assert_eq!(
            parse_options(&args(&[
                "daemon",
                "--state-dir",
                "state",
                "--key-file",
                "key",
                "--codex",
                "source",
                "--retry-attempts",
                "9"
            ]))
            .unwrap_err(),
            "invalid_retry_attempts"
        );
    }

    #[test]
    fn retries_only_bounded_transient_ledger_results() {
        assert!(retryable("ledger_busy_retry"));
        assert!(retryable("ledger_changed_retry"));
        assert!(!retryable("source_partial_tail"));
        assert!(!retryable("ledger_invalid_state_do_not_reset"));
    }

    #[test]
    fn complete_prefix_is_explicit_and_projects_only_the_selected_collector() {
        let base = args(&[
            "daemon",
            "--once",
            "--state-dir",
            "state",
            "--key-file",
            "key",
            "--codex",
            "codex.jsonl",
            "--claude",
            "claude",
            "--json",
        ]);
        let legacy = collect_args(&parse_options(&base).unwrap());
        assert_eq!(legacy[0], "collect");
        let mut selected = base.clone();
        selected.push("--complete-prefix".to_owned());
        let prefix = collect_args(&parse_options(&selected).unwrap());
        assert_eq!(prefix[0], "collect-prefix");
        assert_eq!(prefix[1..], legacy[1..]);
        let mut prefix_first = base;
        prefix_first.insert(1, "--complete-prefix".to_owned());
        assert_eq!(collect_args(&parse_options(&prefix_first).unwrap()), prefix);
        selected.push("--complete-prefix".to_owned());
        assert_eq!(parse_options(&selected).unwrap_err(), "invalid_option");
    }
}
