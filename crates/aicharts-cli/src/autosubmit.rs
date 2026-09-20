//! One configured publication cycle, suitable for launchd. Configuration holds
//! explicit paths and credential references, never secret values. A failed
//! acquisition cannot publish its old cache as if a fresh acquisition succeeded.
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    path::{Component, Path, PathBuf},
    time::{Duration, Instant},
};

const INVALID: &str = "autosubmit_config_invalid";
const BUDGET: Duration = Duration::from_secs(1800);
const HELP: &str = "AI Charts automatic publication — one configured cycle\n\n  aicharts autosubmit --config-file ABS [--check | --dry-run]\n\nA private mode0600 JSON configuration selects clients, explicit source roots,\nprovider refreshes, and an existing enrolled state/key. Each invocation performs\none cycle; launchd controls its schedule. --check validates configuration only.\n--dry-run scans local sources without refreshing providers, opening enrollment,\nor publishing. Neither option changes the existing scheduled publisher.\n\nA retained uncertain upload is resumed from its exact frozen bytes before new\nwork. Failed acquisition skips publication for that client. Other clients may\ncontinue; partial failure exits nonzero and reports only fixed error codes.\nNo paths, account identifiers, credentials, prompts or source content are logged.\nHistory-preserving publication refuses unexplained reductions; it never resets\nstate to resolve a failure. The whole cycle is bounded to 30 minutes between\nindividually bounded operations. See docs/usage-autosubmit.md for configuration.\n";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    schema_version: u8,
    state_dir: PathBuf,
    key_file: PathBuf,
    runtime_dir: PathBuf,
    home: PathBuf,
    days: u64,
    clients: Vec<Client>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Client {
    client: String,
    #[serde(default)]
    source_roots: Vec<PathBuf>,
    #[serde(default)]
    refresh: Option<Refresh>,
}
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Refresh {
    Cursor {
        cache_dir: PathBuf,
        #[serde(default)]
        session_token_file: Option<PathBuf>,
        #[serde(default)]
        cursor_state_db: Option<PathBuf>,
    },
    Trae {
        cache_dir: PathBuf,
        token_file: PathBuf,
        #[serde(default)]
        include_aux: bool,
    },
    Warp {
        cache_dir: PathBuf,
        #[serde(default)]
        token_file: Option<PathBuf>,
        #[serde(default)]
        cookie_file: Option<PathBuf>,
    },
    Hindsight {
        cache_dir: PathBuf,
        endpoint: String,
        tenant: String,
        #[serde(default)]
        token_file: Option<PathBuf>,
        #[serde(default)]
        allow_loopback_http: bool,
    },
    Antigravity {
        cache_dir: PathBuf,
        app: PathBuf,
        #[serde(default)]
        pid: Option<u32>,
        #[serde(default)]
        port: Option<u16>,
        #[serde(default)]
        allow_local_self_signed_tls: bool,
    },
}
fn path_valid(path: &Path) -> bool {
    path.to_str().is_some_and(|value| {
        value.len() <= 4096
            && value.starts_with('/')
            && value.len() > 1
            && !value.chars().any(char::is_control)
    }) && path
        .components()
        .all(|part| matches!(part, Component::RootDir | Component::Normal(_)))
}
fn argument(path: &Path) -> Result<String, &'static str> {
    if !path_valid(path) {
        return Err(INVALID);
    }
    path.to_str().map(str::to_owned).ok_or(INVALID)
}
impl Refresh {
    fn identity(&self) -> (&'static str, &Path) {
        match self {
            Self::Cursor { cache_dir, .. } => ("cursor", cache_dir),
            Self::Trae { cache_dir, .. } => ("trae", cache_dir),
            Self::Warp { cache_dir, .. } => ("warp", cache_dir),
            Self::Hindsight { cache_dir, .. } => ("hindsight", cache_dir),
            Self::Antigravity { cache_dir, .. } => ("antigravity", cache_dir),
        }
    }
    fn args(&self, days: u64) -> Result<Vec<String>, &'static str> {
        let (client, cache) = self.identity();
        let mut args = vec![client.to_owned(), "--cache-dir".into(), argument(cache)?];
        let mut file = |flag: &str, value: &Path| -> Result<(), &'static str> {
            args.push(flag.into());
            args.push(argument(value)?);
            Ok(())
        };
        match self {
            Self::Cursor {
                session_token_file,
                cursor_state_db,
                ..
            } => match (session_token_file, cursor_state_db) {
                (Some(value), None) => file("--session-token-file", value)?,
                (None, Some(value)) => file("--cursor-state-db", value)?,
                _ => return Err(INVALID),
            },
            Self::Warp {
                token_file,
                cookie_file,
                ..
            } => match (token_file, cookie_file) {
                (Some(value), None) => file("--token-file", value)?,
                (None, Some(value)) => file("--cookie-file", value)?,
                _ => return Err(INVALID),
            },
            Self::Trae {
                token_file,
                include_aux,
                ..
            } => {
                file("--token-file", token_file)?;
                args.extend(["--days".into(), days.to_string()]);
                if *include_aux {
                    args.push("--include-aux".into());
                }
            }
            Self::Hindsight {
                endpoint,
                tenant,
                token_file,
                allow_loopback_http,
                ..
            } => {
                if endpoint.len() > 2048
                    || endpoint.chars().any(char::is_control)
                    || tenant.is_empty()
                    || tenant.len() > 256
                    || tenant.chars().any(char::is_control)
                {
                    return Err(INVALID);
                }
                if let Some(token) = token_file {
                    file("--token-file", token)?;
                }
                args.extend([
                    "--api".into(),
                    endpoint.clone(),
                    "--tenant".into(),
                    tenant.clone(),
                ]);
                if *allow_loopback_http {
                    args.push("--allow-loopback-http".into());
                }
            }
            Self::Antigravity {
                app,
                pid,
                port,
                allow_local_self_signed_tls,
                ..
            } => {
                file("--app", app)?;
                if let Some(pid) = pid {
                    if *pid == 0 || *pid > i32::MAX as u32 {
                        return Err(INVALID);
                    }
                    args.extend(["--pid".into(), pid.to_string()]);
                }
                if let Some(port) = port {
                    if *port == 0 {
                        return Err(INVALID);
                    }
                    args.extend(["--port".into(), port.to_string()]);
                }
                if *allow_local_self_signed_tls {
                    args.push("--allow-local-self-signed-tls".into());
                }
            }
        }
        Ok(args)
    }
}
fn parse(bytes: &[u8], now: u64) -> Result<Config, &'static str> {
    if bytes.is_empty() || bytes.len() > 16 * 1024 {
        return Err(INVALID);
    }
    let config: Config = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    if config.schema_version != 1
        || !path_valid(&config.state_dir)
        || !path_valid(&config.key_file)
        || !path_valid(&config.runtime_dir)
        || config.runtime_dir == config.state_dir
        || config.runtime_dir == config.home
        || !path_valid(&config.home)
        || !(1..=366).contains(&config.days)
        || config.clients.is_empty()
        || config.clients.len() > 54
    {
        return Err(INVALID);
    }
    let mut clients = BTreeSet::new();
    let mut caches = BTreeSet::new();
    for client in &config.clients {
        if client.client == "9router"
            || !clients.insert(&client.client)
            || !aicharts_import::all_clients().contains(&client.client.as_str())
            || client.source_roots.len() > 128
            || client.source_roots.iter().any(|path| !path_valid(path))
        {
            return Err(INVALID);
        }
        crate::stats::options(&collection_args(&config, client, now)?, now).map_err(|_| INVALID)?;
        if let Some(refresh) = &client.refresh {
            let (kind, cache) = refresh.identity();
            if kind != client.client
                || !client.source_roots.iter().any(|root| root == cache)
                || cache == config.runtime_dir
                || cache == config.state_dir
                || !caches.insert(cache)
            {
                return Err(INVALID);
            }
            refresh.args(config.days)?;
        }
    }
    Ok(config)
}
fn collection_args(
    config: &Config,
    client: &Client,
    now: u64,
) -> Result<Vec<String>, &'static str> {
    let day = now / crate::stats::DAY_MS;
    let first = day
        .checked_add(1)
        .and_then(|value| value.checked_sub(config.days))
        .ok_or(INVALID)?;
    let date = |day: u64| -> Result<String, &'static str> {
        let seconds = day
            .checked_mul(86_400)
            .and_then(|value| i64::try_from(value).ok())
            .ok_or(INVALID)?;
        Ok(time::OffsetDateTime::from_unix_timestamp(seconds)
            .map_err(|_| INVALID)?
            .date()
            .to_string())
    };
    let mut args = vec![
        "--home".into(),
        argument(&config.home)?,
        "--client".into(),
        client.client.clone(),
        "--since".into(),
        date(first)?,
        "--until".into(),
        date(day)?,
    ];
    for root in &client.source_roots {
        args.extend(["--source-root".into(), argument(root)?]);
    }
    Ok(args)
}
pub(super) struct Outcome {
    pub summary: String,
    pub exit_code: i32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Step {
    client: Option<String>,
    action: &'static str,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}
fn outcome(steps: Vec<Step>, status: &'static str, dry_run: bool) -> Result<Outcome, &'static str> {
    let exit_code = i32::from(status != "complete" && status != "configuration_valid");
    let summary = serde_json::to_string(
        &serde_json::json!({"schemaVersion":1,"status":status,"dryRun":dry_run,"steps":steps}),
    )
    .map_err(|_| "autosubmit_encode_failed")?
        + "\n";
    if summary.len() > 32 * 1024 {
        return Err("autosubmit_summary_too_large");
    }
    Ok(Outcome { summary, exit_code })
}
trait Runner {
    fn resume(&mut self, config: &Config) -> Result<(), &'static str>;
    fn refresh(&mut self, source: &Refresh, days: u64) -> Result<(), &'static str>;
    fn publish(
        &mut self,
        config: &Config,
        client: &Client,
        now: u64,
        dry_run: bool,
    ) -> Result<(), &'static str>;
}
struct Native;
impl Runner for Native {
    fn resume(&mut self, config: &Config) -> Result<(), &'static str> {
        crate::stats_sync::run(&[
            "stats-sync".into(),
            "--state-dir".into(),
            argument(&config.state_dir)?,
            "--key-file".into(),
            argument(&config.key_file)?,
            "--resume".into(),
        ])
        .map(|_| ())
    }
    fn refresh(&mut self, source: &Refresh, days: u64) -> Result<(), &'static str> {
        crate::source_refresh::run(&source.args(days)?).map(|_| ())
    }
    fn publish(
        &mut self,
        config: &Config,
        client: &Client,
        now: u64,
        dry_run: bool,
    ) -> Result<(), &'static str> {
        let collection = collection_args(config, client, now)?;
        if dry_run {
            let options = crate::stats::options(&collection, now)?;
            let report = crate::stats::collect(&options, now)?;
            return crate::stats_sync::validate_publication(report);
        }
        let mut args = vec![
            "stats-sync".into(),
            "--state-dir".into(),
            argument(&config.state_dir)?,
            "--key-file".into(),
            argument(&config.key_file)?,
        ];
        args.extend(collection);
        crate::stats_sync::run(&args).map(|_| ())
    }
}
fn execute(
    config: &Config,
    runner: &mut impl Runner,
    mut clock: impl FnMut() -> Result<u64, &'static str>,
    dry_run: bool,
    mut elapsed: impl FnMut() -> Duration,
) -> Result<Outcome, &'static str> {
    let mut steps = Vec::new();
    let mut failed = false;
    if !dry_run {
        match runner.resume(config) {
            Ok(()) => steps.push(Step {
                client: None,
                action: "resume",
                status: "published",
                error: None,
            }),
            Err("stats_sync_no_retained_flight") => (),
            Err(code) => {
                return outcome(
                    vec![Step {
                        client: None,
                        action: "resume",
                        status: "failed",
                        error: Some(code),
                    }],
                    "resume_required",
                    false,
                );
            }
        }
    }
    for client in &config.clients {
        if elapsed() >= BUDGET {
            steps.push(Step {
                client: Some(client.client.clone()),
                action: "cycle",
                status: "not_started",
                error: Some("autosubmit_deadline"),
            });
            return outcome(steps, "partial_failure", dry_run);
        }
        if let Some(refresh) = client.refresh.as_ref().filter(|_| !dry_run) {
            match runner.refresh(refresh, config.days) {
                Ok(()) => steps.push(Step {
                    client: Some(client.client.clone()),
                    action: "refresh",
                    status: "complete",
                    error: None,
                }),
                Err(code) => {
                    failed = true;
                    steps.push(Step {
                        client: Some(client.client.clone()),
                        action: "refresh",
                        status: "failed",
                        error: Some(code),
                    });
                    continue;
                }
            }
        }
        let action = if dry_run { "local_scan" } else { "publish" };
        if elapsed() >= BUDGET {
            steps.push(Step {
                client: Some(client.client.clone()),
                action,
                status: "not_started",
                error: Some("autosubmit_deadline"),
            });
            return outcome(steps, "partial_failure", dry_run);
        }
        match runner.publish(config, client, clock()?, dry_run) {
            Ok(()) => steps.push(Step {
                client: Some(client.client.clone()),
                action,
                status: if dry_run { "complete" } else { "published" },
                error: None,
            }),
            Err("stats_sync_no_observations") => steps.push(Step {
                client: Some(client.client.clone()),
                action: "no_observations",
                status: "skipped",
                error: None,
            }),
            Err(code) => {
                failed = true;
                steps.push(Step {
                    client: Some(client.client.clone()),
                    action,
                    status: "failed",
                    error: Some(code),
                });
                // Once a send may have started, a retained flight can fence all
                // later clients. It is reconciled once at the next cycle start.
                if !dry_run
                    && (code.starts_with("stats_sync_")
                        && !matches!(
                            code,
                            "stats_sync_incomplete_source"
                                | "stats_sync_one_client_required"
                                | "stats_sync_legacy_takeover_required"
                                | "stats_sync_writer_conflict"
                                | "stats_sync_remote_progress_changed"
                        ))
                {
                    return outcome(steps, "resume_required", false);
                }
            }
        }
    }
    outcome(
        steps,
        if failed {
            "partial_failure"
        } else {
            "complete"
        },
        dry_run,
    )
}
pub(super) fn run(args: &[String]) -> Result<Outcome, &'static str> {
    if args == ["autosubmit", "--help"] || args == ["autosubmit", "-h"] {
        return Ok(Outcome {
            summary: HELP.into(),
            exit_code: 0,
        });
    }
    let (mut config, mut check, mut dry_run) = (None, false, false);
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--check" if !check && !dry_run => check = true,
            "--dry-run" if !check && !dry_run => dry_run = true,
            "--config-file" if config.is_none() => {
                index += 1;
                config = Some(PathBuf::from(
                    args.get(index).ok_or("missing_option_value")?,
                ));
            }
            _ => return Err("invalid_option"),
        }
        index += 1;
    }
    let path = config.ok_or("autosubmit_config_required")?;
    if !path_valid(&path) {
        return Err(INVALID);
    }
    #[cfg(not(unix))]
    {
        let _ = (path, check, dry_run);
        Err("autosubmit_requires_unix")
    }
    #[cfg(unix)]
    {
        let now = crate::stats::now_ms()?;
        let source = crate::source_refresh::disk::read_secret(&path)?;
        let config = parse(source.as_bytes(), now)?;
        if check {
            return outcome(Vec::new(), "configuration_valid", true);
        }
        let start = Instant::now();
        if dry_run {
            return execute(&config, &mut Native, crate::stats::now_ms, true, || {
                start.elapsed()
            });
        }
        // A stable private lock serializes the complete refresh/publish cycle,
        // including manual invocations. The enrollment directory stays separate.
        let runtime = crate::source_refresh::disk::Cache::open(&config.runtime_dir)?;
        runtime.require_entries(&["refresh.lock", "last-cycle.json"])?;
        let outcome = execute(&config, &mut Native, crate::stats::now_ms, false, || {
            start.elapsed()
        })?;
        runtime.replace("last-cycle.json", outcome.summary.as_bytes())?;
        Ok(outcome)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const NOW: u64 = 1_789_776_000_000;
    fn config_value() -> serde_json::Value {
        serde_json::json!({"schemaVersion":1,"stateDir":"/private/state","keyFile":"/private/key","runtimeDir":"/private/runtime","home":"/synthetic","days":30,"clients":[{"client":"cursor","sourceRoots":["/private/cursor"],"refresh":{"kind":"cursor","cacheDir":"/private/cursor","sessionTokenFile":"/private/token"}},{"client":"claude"}]})
    }
    fn configuration() -> Config {
        parse(&serde_json::to_vec(&config_value()).unwrap(), NOW).unwrap()
    }
    #[derive(Default)]
    struct Fake {
        calls: Vec<String>,
        publication_times: Vec<u64>,
        fail_refresh: bool,
        fail_resume: bool,
        fail_publish: bool,
        empty_client: Option<&'static str>,
    }
    impl Runner for Fake {
        fn resume(&mut self, _: &Config) -> Result<(), &'static str> {
            self.calls.push("resume".into());
            if self.fail_resume {
                Err("stats_sync_exchange_uncertain")
            } else {
                Err("stats_sync_no_retained_flight")
            }
        }
        fn refresh(&mut self, source: &Refresh, _: u64) -> Result<(), &'static str> {
            self.calls.push(format!("refresh:{}", source.identity().0));
            if self.fail_refresh {
                Err("cursor_refresh_unauthorized")
            } else {
                Ok(())
            }
        }
        fn publish(
            &mut self,
            _: &Config,
            client: &Client,
            now: u64,
            dry_run: bool,
        ) -> Result<(), &'static str> {
            self.publication_times.push(now);
            self.calls.push(format!(
                "{}:{}",
                if dry_run { "scan" } else { "publish" },
                client.client
            ));
            if self.empty_client == Some(client.client.as_str()) {
                Err("stats_sync_no_observations")
            } else if self.fail_publish {
                Err("stats_sync_exchange_uncertain")
            } else {
                Ok(())
            }
        }
    }
    #[test]
    fn failed_refresh_never_publishes_old_cache_but_other_clients_continue() {
        let mut fake = Fake {
            fail_refresh: true,
            ..Default::default()
        };
        let out = execute(
            &configuration(),
            &mut fake,
            || Ok(NOW),
            false,
            || Duration::ZERO,
        )
        .unwrap();
        assert_eq!(fake.calls, ["resume", "refresh:cursor", "publish:claude"]);
        assert_eq!(out.exit_code, 1);
        assert!(!out.summary.contains("/private"));
        assert!(!out.summary.contains("/synthetic"));
    }
    #[test]
    fn dry_run_never_resumes_or_refreshes_or_publishes() {
        let mut fake = Fake::default();
        assert_eq!(
            execute(
                &configuration(),
                &mut fake,
                || Ok(NOW),
                true,
                || Duration::ZERO
            )
            .unwrap()
            .exit_code,
            0
        );
        assert_eq!(fake.calls, ["scan:cursor", "scan:claude"]);
    }
    #[test]
    fn a_known_empty_period_is_skipped_successfully_and_other_clients_continue() {
        for dry_run in [false, true] {
            let mut fake = Fake {
                empty_client: Some("cursor"),
                ..Default::default()
            };
            let out = execute(
                &configuration(),
                &mut fake,
                || Ok(NOW),
                dry_run,
                || Duration::ZERO,
            )
            .unwrap();
            assert_eq!(out.exit_code, 0);
            let value: serde_json::Value = serde_json::from_str(&out.summary).unwrap();
            assert_eq!(value["status"], "complete");
            assert!(value["steps"].as_array().unwrap().iter().any(|step| {
                step == &serde_json::json!({"client":"cursor","action":"no_observations","status":"skipped"})
            }));
            assert_eq!(
                fake.calls.last().unwrap(),
                if dry_run {
                    "scan:claude"
                } else {
                    "publish:claude"
                }
            );
        }
    }
    #[test]
    fn unresolved_flight_stops_before_new_source_or_provider_io() {
        let mut fake = Fake {
            fail_resume: true,
            ..Default::default()
        };
        assert_eq!(
            execute(
                &configuration(),
                &mut fake,
                || Ok(NOW),
                false,
                || Duration::ZERO
            )
            .unwrap()
            .exit_code,
            1
        );
        assert_eq!(fake.calls, ["resume"]);
        let mut fake = Fake {
            fail_publish: true,
            ..Default::default()
        };
        execute(
            &configuration(),
            &mut fake,
            || Ok(NOW),
            false,
            || Duration::ZERO,
        )
        .unwrap();
        assert_eq!(fake.calls, ["resume", "refresh:cursor", "publish:cursor"]);
    }
    #[test]
    fn scope_and_credential_shape_are_validated_before_effects() {
        for pointer in ["/schemaVersion", "/days"] {
            let mut value = config_value();
            value[pointer.trim_start_matches('/')] = 0.into();
            assert!(parse(&serde_json::to_vec(&value).unwrap(), NOW).is_err());
        }
        let mut value = config_value();
        value["clients"][0]["sourceRoots"] = serde_json::json!(["/other/cache"]);
        assert!(parse(&serde_json::to_vec(&value).unwrap(), NOW).is_err());
        let mut value = config_value();
        value["clients"][0]["refresh"]["cursorStateDb"] = "/secret/db".into();
        assert!(parse(&serde_json::to_vec(&value).unwrap(), NOW).is_err());
        let mut value = config_value();
        value["clients"][1]["client"] = "cursor".into();
        assert!(parse(&serde_json::to_vec(&value).unwrap(), NOW).is_err());
        let mut value = config_value();
        value["keyFile"] = "relative/key".into();
        assert!(parse(&serde_json::to_vec(&value).unwrap(), NOW).is_err());
        let mut value = config_value();
        value["secretValue"] = "NEVER_ALLOWED".into();
        assert!(parse(&serde_json::to_vec(&value).unwrap(), NOW).is_err());
    }
    #[test]
    fn publication_range_uses_current_time_after_each_refresh() {
        let mut fake = Fake::default();
        let mut times = [NOW, NOW + crate::stats::DAY_MS].into_iter();
        execute(
            &configuration(),
            &mut fake,
            || Ok(times.next().unwrap()),
            false,
            || Duration::ZERO,
        )
        .unwrap();
        assert_eq!(fake.publication_times, [NOW, NOW + crate::stats::DAY_MS]);
        let config = configuration();
        let before = collection_args(&config, &config.clients[0], NOW).unwrap();
        let after =
            collection_args(&config, &config.clients[0], NOW + crate::stats::DAY_MS).unwrap();
        assert_ne!(before, after);
    }
    #[test]
    fn cycle_budget_does_not_start_another_scan() {
        let mut fake = Fake::default();
        let out = execute(&configuration(), &mut fake, || Ok(NOW), true, || BUDGET).unwrap();
        assert!(fake.calls.is_empty());
        assert_eq!(out.exit_code, 1);
    }
}
