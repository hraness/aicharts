//! Local foreground daemon runner: collection every interval and, when a
//! publication configuration is given, one autosubmit cycle on its own slower
//! schedule, all in one process.
//!
//! This intentionally does not install an OS service, acquire credentials, or
//! contact a server on its own. A qualified service manager supervises this
//! process; it stays alive across fixed collection errors and failed
//! publication cycles and reports each pass, so a supervisor never has to
//! restart it into the same failure.

use std::path::PathBuf;
use std::time::Duration;

const DEFAULT_INTERVAL_SECONDS: u64 = 15 * 60;
const MIN_INTERVAL_SECONDS: u64 = 60;
const MAX_INTERVAL_SECONDS: u64 = 24 * 60 * 60;
const DEFAULT_RETRY_ATTEMPTS: u8 = 3;
const MAX_RETRY_ATTEMPTS: u8 = 8;
const DEFAULT_PUBLISH_INTERVAL_SECONDS: u64 = 60 * 60;
const MIN_PUBLISH_INTERVAL_SECONDS: u64 = 5 * 60;

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
    publish_config: Option<PathBuf>,
    publish_interval_seconds: u64,
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
    let mut publish_config = None;
    let mut publish_interval_seconds = DEFAULT_PUBLISH_INTERVAL_SECONDS;
    let mut publish_interval_set = false;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--complete-prefix" if !complete_prefix => complete_prefix = true,
            "--once" if !once => once = true,
            "--json" if once && !json => json = true,
            flag @ ("--state-dir"
            | "--key-file"
            | "--codex"
            | "--claude"
            | "--devin"
            | "--interval-seconds"
            | "--retry-attempts"
            | "--publish-config"
            | "--publish-interval-seconds") => {
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
                    "--publish-config" if publish_config.is_none() => {
                        let path = PathBuf::from(value);
                        if !path.is_absolute() {
                            return Err("invalid_publish_config");
                        }
                        publish_config = Some(path);
                    }
                    "--publish-interval-seconds" if !publish_interval_set => {
                        publish_interval_seconds =
                            value.parse().map_err(|_| "invalid_publish_interval")?;
                        if !(MIN_PUBLISH_INTERVAL_SECONDS..=MAX_INTERVAL_SECONDS)
                            .contains(&publish_interval_seconds)
                        {
                            return Err("invalid_publish_interval");
                        }
                        publish_interval_set = true;
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
    if publish_interval_set && publish_config.is_none() {
        return Err("invalid_option");
    }
    if publish_config.is_some() && (once || json) {
        return Err("invalid_option");
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
        publish_config,
        publish_interval_seconds,
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

/// Publication runs on the first pass and then once every `passes_per_cycle`
/// collection passes, so it shares the collector's single clock.
fn passes_per_cycle(options: &Options) -> u64 {
    (options.publish_interval_seconds / options.interval_seconds).max(1)
}

#[derive(Debug, PartialEq, Eq)]
enum Report {
    Collected(Result<String, &'static str>),
    Published(Result<String, &'static str>),
}

fn run_loop(
    options: &Options,
    mut run: impl FnMut() -> Result<String, &'static str>,
    mut publish: impl FnMut() -> Result<String, &'static str>,
    mut sleep: impl FnMut(Duration),
    mut report: impl FnMut(Report),
) -> Result<String, &'static str> {
    let cadence = passes_per_cycle(options);
    let mut pass = 0u64;
    loop {
        let result = collect(options.retry_attempts, &mut run, &mut sleep);
        if options.once {
            return result;
        }
        // Every pass result is reported and the daemon waits the normal
        // interval. A fixed error never ends the process: a supervisor would
        // only restart it into the same error, and a later pass can succeed
        // once the source or ledger condition clears.
        report(Report::Collected(result));
        if options.publish_config.is_some() && pass.is_multiple_of(cadence) {
            report(Report::Published(publish()));
        }
        pass = pass.wrapping_add(1);
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

fn publish_args(options: &Options) -> Option<Vec<String>> {
    options.publish_config.as_ref().map(|path| {
        vec![
            "autosubmit".to_owned(),
            "--config-file".to_owned(),
            path.to_string_lossy().into_owned(),
        ]
    })
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
        let publish_args = publish_args(&options);
        if !options.once {
            eprintln!(
                "aicharts: daemon starting; build {}; publication {}",
                super::version::SOURCE_COMMIT.unwrap_or("unknown"),
                if publish_args.is_some() {
                    "configured"
                } else {
                    "not configured"
                }
            );
        }
        run_loop(
            &options,
            || super::state::run(&collect_args),
            || match &publish_args {
                Some(args) => super::autosubmit::run(args).map(|outcome| outcome.summary),
                None => Err("publish_not_configured"),
            },
            std::thread::sleep,
            |result| match result {
                Report::Collected(Ok(output)) => println!("{output}"),
                Report::Collected(Err(error)) => eprintln!("aicharts: {error}"),
                Report::Published(Ok(summary)) => print!("{summary}"),
                Report::Published(Err(error)) => eprintln!("aicharts: publish {error}"),
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
        Publish,
        Sleep(u64),
        Report(Report),
    }

    fn base_options(publish: Option<(&str, &str)>) -> Options {
        let mut base = args(&[
            "daemon",
            "--state-dir",
            "state",
            "--key-file",
            "key",
            "--codex",
            "source",
            "--interval-seconds",
            "600",
        ]);
        if let Some((path, seconds)) = publish {
            base.extend(args(&[
                "--publish-config",
                path,
                "--publish-interval-seconds",
                seconds,
            ]));
        }
        parse_options(&base).unwrap()
    }

    /// Drives the loop from scripted results. In loop mode the loop never
    /// returns, so the script's exhaustion panics inside the collector and the
    /// panic is caught here; every event up to that point is retained.
    fn drive(
        options: &Options,
        results: Vec<Result<&str, &'static str>>,
        publications: Vec<Result<&str, &'static str>>,
    ) -> (Option<Result<String, &'static str>>, Vec<Event>) {
        let events = RefCell::new(Vec::new());
        let results = RefCell::new(results.into_iter());
        let publications = RefCell::new(publications.into_iter());
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_loop(
                options,
                || {
                    events.borrow_mut().push(Event::Collect);
                    let next = results.borrow_mut().next();
                    next.expect("scripted collections exhausted")
                        .map(str::to_owned)
                },
                || {
                    events.borrow_mut().push(Event::Publish);
                    let next = publications.borrow_mut().next();
                    next.expect("scripted publications exhausted")
                        .map(str::to_owned)
                },
                |duration| events.borrow_mut().push(Event::Sleep(duration.as_secs())),
                |result| events.borrow_mut().push(Event::Report(result)),
            )
        }));
        let result = match outcome {
            Ok(result) => Some(result),
            Err(_) => {
                assert!(!options.once, "the once mode must return, never panic");
                None
            }
        };
        assert!(
            options.once || results.borrow_mut().next().is_none(),
            "unconsumed collection result"
        );
        assert!(
            publications.borrow_mut().next().is_none(),
            "unconsumed publication result"
        );
        (result, events.into_inner())
    }

    fn run_once(
        retry_attempts: u8,
        results: Vec<Result<&str, &'static str>>,
    ) -> (Result<String, &'static str>, Vec<Event>) {
        let mut options = base_options(None);
        options.retry_attempts = retry_attempts;
        options.once = true;
        let (result, events) = drive(&options, results, Vec::new());
        (result.expect("once returns"), events)
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
        assert_eq!(publish_args(&options), None);
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
    fn publication_needs_an_absolute_configuration_and_a_bounded_interval() {
        let base = [
            "daemon",
            "--state-dir",
            "state",
            "--key-file",
            "key",
            "--codex",
            "source",
        ];
        let with = |extra: &[&str]| parse_options(&args(&[&base[..], extra].concat()));
        assert_eq!(
            with(&["--publish-config", "relative.json"]).unwrap_err(),
            "invalid_publish_config"
        );
        assert_eq!(
            with(&["--publish-interval-seconds", "3600"]).unwrap_err(),
            "invalid_option"
        );
        assert_eq!(
            with(&[
                "--publish-config",
                "/etc/aicharts/autosubmit.json",
                "--publish-interval-seconds",
                "299"
            ])
            .unwrap_err(),
            "invalid_publish_interval"
        );
        assert_eq!(
            with(&[
                "--publish-config",
                "/etc/aicharts/autosubmit.json",
                "--once"
            ])
            .unwrap_err(),
            "invalid_option"
        );
        let options = with(&["--publish-config", "/etc/aicharts/autosubmit.json"]).unwrap();
        assert_eq!(
            options.publish_interval_seconds,
            DEFAULT_PUBLISH_INTERVAL_SECONDS
        );
        assert_eq!(
            publish_args(&options),
            Some(args(&[
                "autosubmit",
                "--config-file",
                "/etc/aicharts/autosubmit.json"
            ]))
        );
        assert_eq!(passes_per_cycle(&options), 4);
        let faster = with(&[
            "--publish-config",
            "/etc/aicharts/autosubmit.json",
            "--publish-interval-seconds",
            "300",
        ])
        .unwrap();
        assert_eq!(passes_per_cycle(&faster), 1);
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
                let mut options = base_options(None);
                options.retry_attempts = retry_attempts;
                let mut results = vec![Err(error); usize::from(retry_attempts) + 1];
                results.push(Ok("collected"));
                let (result, events) = drive(&options, results, Vec::new());
                assert_eq!(result, None);
                let mut expected = vec![Event::Collect];
                for retry in 0..retry_attempts {
                    expected.push(Event::Sleep(1u64 << retry.min(3)));
                    expected.push(Event::Collect);
                }
                expected.extend([
                    Event::Report(Report::Collected(Err(error))),
                    Event::Sleep(600),
                    Event::Collect,
                    Event::Report(Report::Collected(Ok("collected".to_owned()))),
                    Event::Sleep(600),
                    Event::Collect,
                ]);
                assert_eq!(events, expected);
            }
        }
    }

    #[test]
    fn source_churn_and_fixed_errors_report_and_wait_for_the_normal_interval() {
        for error in [
            "source_changed_during_scan",
            "source_partial_tail",
            "ledger_invalid_state_do_not_reset",
            "ledger_write_failed",
            "unknown_failure",
        ] {
            let options = base_options(None);
            let (result, events) = drive(&options, vec![Err(error), Ok("collected")], Vec::new());
            assert_eq!(result, None);
            assert_eq!(
                events,
                vec![
                    Event::Collect,
                    Event::Report(Report::Collected(Err(error))),
                    Event::Sleep(600),
                    Event::Collect,
                    Event::Report(Report::Collected(Ok("collected".to_owned()))),
                    Event::Sleep(600),
                    Event::Collect,
                ]
            );
        }
    }

    #[test]
    fn publication_runs_on_the_first_pass_and_then_every_cadence_passes() {
        let options = base_options(Some(("/etc/aicharts/autosubmit.json", "1200")));
        let (result, events) = drive(
            &options,
            vec![Ok("one"), Ok("two"), Ok("three"), Ok("four"), Ok("five")],
            vec![
                Ok("{\"status\":\"complete\"}\n"),
                Err("autosubmit_deadline"),
                Ok("again"),
            ],
        );
        assert_eq!(result, None);
        assert_eq!(
            events,
            vec![
                Event::Collect,
                Event::Report(Report::Collected(Ok("one".to_owned()))),
                Event::Publish,
                Event::Report(Report::Published(Ok(
                    "{\"status\":\"complete\"}\n".to_owned()
                ))),
                Event::Sleep(600),
                Event::Collect,
                Event::Report(Report::Collected(Ok("two".to_owned()))),
                Event::Sleep(600),
                Event::Collect,
                Event::Report(Report::Collected(Ok("three".to_owned()))),
                Event::Publish,
                Event::Report(Report::Published(Err("autosubmit_deadline"))),
                Event::Sleep(600),
                Event::Collect,
                Event::Report(Report::Collected(Ok("four".to_owned()))),
                Event::Sleep(600),
                Event::Collect,
                Event::Report(Report::Collected(Ok("five".to_owned()))),
                Event::Publish,
                Event::Report(Report::Published(Ok("again".to_owned()))),
                Event::Sleep(600),
                Event::Collect,
            ]
        );
    }

    #[test]
    fn success_waits_for_the_normal_interval_and_resets_the_retry_budget() {
        let mut options = base_options(None);
        options.retry_attempts = 1;
        let (result, events) = drive(
            &options,
            vec![
                Err("ledger_busy_retry"),
                Ok("first"),
                Err("ledger_changed_retry"),
                Ok("second"),
            ],
            Vec::new(),
        );
        assert_eq!(result, None);
        assert_eq!(
            events,
            vec![
                Event::Collect,
                Event::Sleep(1),
                Event::Collect,
                Event::Report(Report::Collected(Ok("first".to_owned()))),
                Event::Sleep(600),
                Event::Collect,
                Event::Sleep(1),
                Event::Collect,
                Event::Report(Report::Collected(Ok("second".to_owned()))),
                Event::Sleep(600),
                Event::Collect,
            ]
        );
    }

    #[test]
    fn once_returns_the_underlying_result_without_reporting_or_interval_sleep() {
        for expected in [
            Ok("collected"),
            Err("source_changed_during_scan"),
            Err("source_partial_tail"),
            Err("ledger_invalid_state_do_not_reset"),
        ] {
            let (result, events) = run_once(MAX_RETRY_ATTEMPTS, vec![expected]);
            assert_eq!(result, expected.map(str::to_owned));
            assert_eq!(events, vec![Event::Collect]);
        }
        for error in ["ledger_busy_retry", "ledger_changed_retry"] {
            let (result, events) = run_once(2, vec![Err(error); 3]);
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
            let (result, events) = run_once(2, vec![Err(error), Ok("collected")]);
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
