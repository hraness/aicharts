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
            flag @ ("--state-dir" | "--key-file" | "--codex" | "--claude" | "--devin"
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
                    "--devin" => {
                        sources.push((aicharts_protocol::Provider::Devin, PathBuf::from(value)))
                    }
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

fn collect(
    retry_attempts: u8,
    run: &mut impl FnMut() -> Result<String, &'static str>,
    sleep: &mut impl FnMut(Duration),
) -> Result<String, &'static str> {
    let mut attempt = 0u8;
    loop {
        match run() {
            Ok(output) => return Ok(output),
            Err(error) if retryable(error) && attempt < retry_attempts => {
                let seconds = 1u64 << attempt.min(3);
                sleep(Duration::from_secs(seconds));
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

fn run_loop(
    options: &Options,
    mut run: impl FnMut() -> Result<String, &'static str>,
    mut sleep: impl FnMut(Duration),
    mut report: impl FnMut(Result<String, &'static str>),
) -> Result<String, &'static str> {
    loop {
        let result = collect(options.retry_attempts, &mut run, &mut sleep);
        if options.once {
            return result;
        }
        if let Err(error) = &result {
            if !retryable(error) && *error != "source_changed_during_scan" {
                return Err(*error);
            }
        }
        // Contention and live-source churn defer this cycle. Source changes
        // never consume the immediate ledger retry budget.
        report(result);
        sleep(Duration::from_secs(options.interval_seconds));
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
            aicharts_protocol::Provider::Devin => "--devin".to_owned(),
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
        run_loop(
            &options,
            || super::state::run(&collect_args),
            std::thread::sleep,
            |result| match result {
                Ok(output) => println!("{output}"),
                Err(error) => eprintln!("aicharts: {error}"),
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[derive(Debug, PartialEq, Eq)]
    enum Event {
        Collect,
        Sleep(u64),
        Report(Result<String, &'static str>),
    }

    fn run_script(
        retry_attempts: u8,
        once: bool,
        results: Vec<Result<&str, &'static str>>,
    ) -> (Result<String, &'static str>, Vec<Event>) {
        let mut options = parse_options(&args(&[
            "daemon",
            "--state-dir",
            "state",
            "--key-file",
            "key",
            "--codex",
            "source",
            "--interval-seconds",
            "600",
        ]))
        .unwrap();
        options.retry_attempts = retry_attempts;
        options.once = once;
        let events = RefCell::new(Vec::new());
        let mut results = results.into_iter();
        let result = run_loop(
            &options,
            || {
                events.borrow_mut().push(Event::Collect);
                results
                    .next()
                    .expect("unexpected collection")
                    .map(str::to_owned)
            },
            |duration| events.borrow_mut().push(Event::Sleep(duration.as_secs())),
            |result| events.borrow_mut().push(Event::Report(result)),
        );
        assert!(results.next().is_none(), "unconsumed collection result");
        (result, events.into_inner())
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
        assert!(!retryable("source_changed_during_scan"));
        assert!(!retryable("source_partial_tail"));
        assert!(!retryable("ledger_invalid_state_do_not_reset"));
    }

    #[test]
    fn exhausted_ledger_retries_wait_for_the_normal_interval() {
        for error in ["ledger_busy_retry", "ledger_changed_retry"] {
            for retry_attempts in 0..=MAX_RETRY_ATTEMPTS {
                let mut results = vec![Err(error); usize::from(retry_attempts) + 1];
                results.push(Err("stop_test"));
                let (result, events) = run_script(retry_attempts, false, results);
                assert_eq!(result, Err("stop_test"));
                let mut expected = vec![Event::Collect];
                for retry in 0..retry_attempts {
                    expected.push(Event::Sleep(1u64 << retry.min(3)));
                    expected.push(Event::Collect);
                }
                expected.extend([Event::Report(Err(error)), Event::Sleep(600), Event::Collect]);
                assert_eq!(events, expected);
            }
        }
    }

    #[test]
    fn source_churn_waits_for_the_normal_interval_without_immediate_retries() {
        let (result, events) = run_script(
            MAX_RETRY_ATTEMPTS,
            false,
            vec![
                Err("source_changed_during_scan"),
                Err("source_changed_during_scan"),
                Ok("collected"),
                Err("stop_test"),
            ],
        );
        assert_eq!(result, Err("stop_test"));
        assert_eq!(
            events,
            vec![
                Event::Collect,
                Event::Report(Err("source_changed_during_scan")),
                Event::Sleep(600),
                Event::Collect,
                Event::Report(Err("source_changed_during_scan")),
                Event::Sleep(600),
                Event::Collect,
                Event::Report(Ok("collected".to_owned())),
                Event::Sleep(600),
                Event::Collect,
            ]
        );
    }

    #[test]
    fn success_waits_for_the_normal_interval_and_resets_the_retry_budget() {
        let (result, events) = run_script(
            1,
            false,
            vec![
                Err("ledger_busy_retry"),
                Ok("first"),
                Err("ledger_changed_retry"),
                Ok("second"),
                Err("stop_test"),
            ],
        );
        assert_eq!(result, Err("stop_test"));
        assert_eq!(
            events,
            vec![
                Event::Collect,
                Event::Sleep(1),
                Event::Collect,
                Event::Report(Ok("first".to_owned())),
                Event::Sleep(600),
                Event::Collect,
                Event::Sleep(1),
                Event::Collect,
                Event::Report(Ok("second".to_owned())),
                Event::Sleep(600),
                Event::Collect,
            ]
        );
    }

    #[test]
    fn fixed_and_fatal_errors_stop_without_sleeping() {
        for error in [
            "source_partial_tail",
            "ledger_invalid_state_do_not_reset",
            "ledger_write_failed",
            "unknown_failure",
        ] {
            let (result, events) = run_script(MAX_RETRY_ATTEMPTS, false, vec![Err(error)]);
            assert_eq!(result, Err(error));
            assert_eq!(events, vec![Event::Collect]);
        }
    }

    #[test]
    fn once_returns_the_underlying_result_without_reporting_or_interval_sleep() {
        for expected in [
            Ok("collected"),
            Err("source_changed_during_scan"),
            Err("source_partial_tail"),
            Err("ledger_invalid_state_do_not_reset"),
        ] {
            let (result, events) = run_script(MAX_RETRY_ATTEMPTS, true, vec![expected]);
            assert_eq!(result, expected.map(str::to_owned));
            assert_eq!(events, vec![Event::Collect]);
        }
        for error in ["ledger_busy_retry", "ledger_changed_retry"] {
            let (result, events) = run_script(2, true, vec![Err(error); 3]);
            assert_eq!(result, Err(error));
            assert_eq!(
                events,
                vec![
                    Event::Collect,
                    Event::Sleep(1),
                    Event::Collect,
                    Event::Sleep(2),
                    Event::Collect,
                ]
            );
            let (result, events) = run_script(2, true, vec![Err(error), Ok("collected")]);
            assert_eq!(result, Ok("collected".to_owned()));
            assert_eq!(
                events,
                vec![Event::Collect, Event::Sleep(1), Event::Collect]
            );
        }
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
