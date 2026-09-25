//! One configured publication cycle, suitable for launchd. Configuration holds
//! explicit paths and credential references, never secret values. A failed
//! acquisition cannot publish its old cache as if a fresh acquisition succeeded.
use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::process::{Command, Stdio};
use std::{
    collections::BTreeSet,
    path::{Component, Path, PathBuf},
    time::{Duration, Instant},
};

const INVALID: &str = "autosubmit_config_invalid";
const BUDGET: Duration = Duration::from_secs(1800);
const SINK_BUDGET: Duration = Duration::from_secs(600);
const HELP: &str = "AI Charts automatic publication: one configured cycle\n\n  aicharts autosubmit --config-file ABS [--check | --dry-run] [--contribution-sync]\n\nA private mode0600 JSON configuration selects clients, explicit source roots,\nprovider refreshes, and an existing enrolled state/key. Each invocation performs\none cycle; launchd controls its schedule. --check validates configuration only.\n--dry-run scans local sources without refreshing providers, opening enrollment,\nor publishing. Neither option changes the existing scheduled publisher.\n\nA retained uncertain upload is resumed from its exact frozen bytes before new\nwork. Failed acquisition skips publication for that client. Other clients may\ncontinue; partial failure exits nonzero and reports only fixed error codes.\nNo paths, account identifiers, credentials, prompts or source content are logged.\nHistory-preserving publication refuses unexplained reductions; it never resets\nstate to resolve a failure. Configured sinks then attempt one delegated delivery\neach; they still run when publication needs reconciliation, their output is\ndiscarded, and a sink failure reports a fixed code without reordering\npublication. --contribution-sync (default off) additionally runs the explicit\ncontribution sender for each configured native source after every client\npublished cleanly, draining up to the configured batches; it needs the\ncontributionSync block, refuses outside qualified macOS custody with the\nsender's own code, and is skipped by --dry-run and after any publication\nfailure. The whole cycle is bounded to 30 minutes between individually\nbounded operations. See docs/usage-autosubmit.md for configuration.\n";

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
    #[serde(default)]
    sinks: Vec<Sink>,
    #[serde(default)]
    contribution_sync: Option<ContributionSync>,
}
/// Opt-in native contribution sending. Nothing here activates V3 or grants
/// ownership; the explicit sender rejects an account that is not already
/// active and enrolled on this device.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ContributionSync {
    state_dir: PathBuf,
    key_file: PathBuf,
    population_id: String,
    sources: Vec<ContributionSource>,
    #[serde(default = "one_batch")]
    max_batches: u8,
}
fn one_batch() -> u8 {
    1
}
const MAX_CONTRIBUTION_BATCHES: u8 = 8;
#[derive(Deserialize)]
#[serde(
    tag = "provider",
    rename_all = "lowercase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum ContributionSource {
    Claude { file: PathBuf },
    Codex { file: PathBuf },
}
impl ContributionSource {
    fn provider(&self) -> &'static str {
        match self {
            Self::Claude { .. } => "claude",
            Self::Codex { .. } => "codex",
        }
    }
    fn file(&self) -> &Path {
        match self {
            Self::Claude { file } | Self::Codex { file } => file,
        }
    }
}
impl ContributionSync {
    fn valid(&self, config: &Config) -> bool {
        path_valid(&self.state_dir)
            && path_valid(&self.key_file)
            && self.state_dir != config.runtime_dir
            && self.state_dir != config.home
            && self.population_id.len() == 64
            && self
                .population_id
                .bytes()
                .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
            && (1..=MAX_CONTRIBUTION_BATCHES).contains(&self.max_batches)
            && !self.sources.is_empty()
            && self.sources.len() <= 8
            && self.sources.iter().all(|source| path_valid(source.file()))
            && self
                .sources
                .iter()
                .map(ContributionSource::file)
                .collect::<BTreeSet<_>>()
                .len()
                == self.sources.len()
    }
    fn args(&self, source: &ContributionSource) -> Result<Vec<String>, &'static str> {
        Ok(vec![
            "contribution-sync".into(),
            "--send".into(),
            "--state-dir".into(),
            argument(&self.state_dir)?,
            "--key-file".into(),
            argument(&self.key_file)?,
            "--population-id".into(),
            self.population_id.clone(),
            format!("--{}", source.provider()),
            argument(source.file())?,
            "--max-batches".into(),
            self.max_batches.to_string(),
        ])
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Client {
    client: String,
    #[serde(default)]
    source_roots: Vec<PathBuf>,
    #[serde(default)]
    refresh: Option<Refresh>,
    #[serde(default)]
    days: Option<u64>,
}
impl Client {
    fn days<'a>(&'a self, config: &'a Config) -> u64 {
        self.days.unwrap_or(config.days)
    }
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
/// A downstream delivery target attempted once per cycle after every client
/// step, even when publication itself needs reconciliation. The delegate keeps
/// its own collection, credentials and submission semantics; this cycle never
/// sees its account, token or payload.
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Sink {
    Tokscale { binary: PathBuf },
}
impl Sink {
    fn action(&self) -> &'static str {
        match self {
            Self::Tokscale { .. } => "sink_tokscale",
        }
    }
    #[cfg(unix)]
    fn command(&self) -> Result<Command, &'static str> {
        match self {
            Self::Tokscale { binary } => {
                let mut command = Command::new(argument(binary)?);
                command.arg("submit");
                Ok(command)
            }
        }
    }
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
        || config.clients.len() > 57
        || config.sinks.len() > 8
    {
        return Err(INVALID);
    }
    if config
        .contribution_sync
        .as_ref()
        .is_some_and(|sync| !sync.valid(&config))
    {
        return Err(INVALID);
    }
    let mut sinks = BTreeSet::new();
    for sink in &config.sinks {
        let Sink::Tokscale { binary } = sink;
        if !path_valid(binary) || !sinks.insert(sink.action()) {
            return Err(INVALID);
        }
    }
    let mut clients = BTreeSet::new();
    let mut caches = BTreeSet::new();
    for client in &config.clients {
        if client.client == "9router"
            || !clients.insert(&client.client)
            || !aicharts_import::all_clients().contains(&client.client.as_str())
            || client.source_roots.len() > 128
            || client.source_roots.iter().any(|path| !path_valid(path))
            || client.days.is_some_and(|days| !(1..=366).contains(&days))
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
            refresh.args(client.days(&config))?;
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
        .and_then(|value| value.checked_sub(client.days(config)))
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
/// One delegated publish under a hard deadline, killed as a process group if it
/// overruns. Output is discarded rather than relayed: delegate text can carry
/// account identifiers and source paths, which this cycle never logs.
#[cfg(unix)]
fn run_delegate(command: &mut Command, budget: Duration) -> Result<(), &'static str> {
    let mut group = crate::owned_process::OwnedGroup::spawn(
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null()),
    )
    .map_err(delegate_error)?;
    let deadline = Instant::now() + budget;
    loop {
        if group.exited().map_err(delegate_error)? {
            let status = group.finish().map_err(delegate_error)?;
            return if status.success() {
                Ok(())
            } else {
                Err("sink_failed")
            };
        }
        if Instant::now() >= deadline {
            group.finish().map_err(delegate_error)?;
            return Err("sink_deadline");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[cfg(unix)]
fn delegate_error(error: &'static str) -> &'static str {
    match error {
        "capture_spawn_failed" => "sink_spawn_failed",
        "capture_process_custody_lost" => "sink_process_custody_lost",
        "capture_process_identity_invalid" => "sink_process_identity_invalid",
        "capture_child_wait_custody_unavailable" => "sink_child_wait_custody_unavailable",
        _ => "sink_process_cleanup_failed",
    }
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
    fn sink(&mut self, sink: &Sink, budget: Duration) -> Result<(), &'static str>;
    /// One explicit native send; the returned summary is the sender's own
    /// JSON status line, which carries no paths or identifiers.
    fn contribution_sync(
        &mut self,
        sync: &ContributionSync,
        source: &ContributionSource,
    ) -> Result<String, &'static str>;
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
    fn sink(&mut self, sink: &Sink, budget: Duration) -> Result<(), &'static str> {
        #[cfg(unix)]
        {
            run_delegate(&mut sink.command()?, budget)
        }
        #[cfg(not(unix))]
        {
            let _ = (sink, budget);
            Err("autosubmit_requires_unix")
        }
    }
    fn contribution_sync(
        &mut self,
        sync: &ContributionSync,
        source: &ContributionSource,
    ) -> Result<String, &'static str> {
        crate::contribution_sync::run(&sync.args(source)?)
    }
}
/// The bounded status a contribution send reports back into the cycle summary.
fn contribution_status(summary: &str) -> &'static str {
    let value: serde_json::Value = match serde_json::from_str(summary) {
        Ok(value) => value,
        Err(_) => return "sent",
    };
    match value["status"].as_str() {
        Some("settled") => "settled",
        Some("drained") => "drained",
        Some("batch_limit") => "batch_limit",
        Some("stopped") => "stopped",
        Some("selected_observations_match") => "selected_observations_match",
        _ => "sent",
    }
}
fn execute(
    config: &Config,
    runner: &mut impl Runner,
    mut clock: impl FnMut() -> Result<u64, &'static str>,
    dry_run: bool,
    contribution_sync: bool,
    mut elapsed: impl FnMut() -> Duration,
) -> Result<Outcome, &'static str> {
    let mut steps = Vec::new();
    let mut failed = false;
    let mut status = "complete";
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
                // The resume already disposed of any terminal refusal through
                // the service's proof; what remains is network uncertainty or a
                // broken enrollment, and no provider or source I/O is spent on
                // a cycle that cannot publish.
                steps.push(Step {
                    client: None,
                    action: "resume",
                    status: "failed",
                    error: Some(code),
                });
                status = "resume_required";
            }
        }
    }
    if status == "complete" {
        for client in &config.clients {
            if elapsed() >= BUDGET {
                failed = true;
                steps.push(Step {
                    client: Some(client.client.clone()),
                    action: "cycle",
                    status: "not_started",
                    error: Some("autosubmit_deadline"),
                });
                break;
            }
            if let Some(refresh) = client.refresh.as_ref().filter(|_| !dry_run) {
                match runner.refresh(refresh, client.days(config)) {
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
                failed = true;
                steps.push(Step {
                    client: Some(client.client.clone()),
                    action,
                    status: "not_started",
                    error: Some("autosubmit_deadline"),
                });
                break;
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
                    // A retained flight fences only this device's next
                    // publication, and the next client's run reconciles it
                    // before its own work; later clients still publish.
                    failed = true;
                    steps.push(Step {
                        client: Some(client.client.clone()),
                        action,
                        status: "failed",
                        error: Some(code),
                    });
                }
            }
        }
    }
    // The native sender runs only behind the explicit flag and only after every
    // client published cleanly: a retained aggregate flight or a failed step
    // must be reconciled before another write path starts. It never runs in a
    // dry run. A failed or uncertain send stops later sources; the sender's
    // own retained flight is resumed by the next explicit invocation.
    if let Some(sync) = config
        .contribution_sync
        .as_ref()
        .filter(|_| contribution_sync)
    {
        let clean = status == "complete" && !failed && !dry_run;
        for source in &sync.sources {
            let client = Some(source.provider().to_owned());
            if !clean {
                steps.push(Step {
                    client,
                    action: "contribution_sync",
                    status: "skipped",
                    error: None,
                });
                continue;
            }
            if elapsed() >= BUDGET {
                failed = true;
                steps.push(Step {
                    client,
                    action: "contribution_sync",
                    status: "not_started",
                    error: Some("autosubmit_deadline"),
                });
                break;
            }
            match runner.contribution_sync(sync, source) {
                Ok(summary) => steps.push(Step {
                    client,
                    action: "contribution_sync",
                    status: contribution_status(&summary),
                    error: None,
                }),
                Err(code) => {
                    failed = true;
                    steps.push(Step {
                        client,
                        action: "contribution_sync",
                        status: "failed",
                        error: Some(code),
                    });
                    break;
                }
            }
        }
    }
    // Delegated sinks are an independent delivery channel: they still run when
    // a retained flight or a failed step stopped publication above, bounded by
    // the same cycle deadline.
    for sink in &config.sinks {
        if dry_run {
            steps.push(Step {
                client: None,
                action: sink.action(),
                status: "skipped",
                error: None,
            });
            continue;
        }
        let remaining = BUDGET.saturating_sub(elapsed());
        if remaining.is_zero() {
            failed = true;
            steps.push(Step {
                client: None,
                action: sink.action(),
                status: "not_started",
                error: Some("autosubmit_deadline"),
            });
            break;
        }
        match runner.sink(sink, remaining.min(SINK_BUDGET)) {
            Ok(()) => steps.push(Step {
                client: None,
                action: sink.action(),
                status: "submitted",
                error: None,
            }),
            Err(code) => {
                failed = true;
                steps.push(Step {
                    client: None,
                    action: sink.action(),
                    status: "failed",
                    error: Some(code),
                });
            }
        }
    }
    outcome(
        steps,
        if status == "complete" && failed {
            "partial_failure"
        } else {
            status
        },
        dry_run,
    )
}
/// The flag is explicit and the block is explicit: one without the other is a
/// configuration error rather than a silent no-op or a silent send.
fn require_contribution_sync(config: &Config, flag: bool) -> Result<(), &'static str> {
    match (flag, config.contribution_sync.is_some()) {
        (true, false) => Err("autosubmit_contribution_sync_unconfigured"),
        (false, true) => Err("autosubmit_contribution_sync_flag_required"),
        _ => Ok(()),
    }
}
pub(super) fn run(args: &[String]) -> Result<Outcome, &'static str> {
    if args == ["autosubmit", "--help"] || args == ["autosubmit", "-h"] {
        return Ok(Outcome {
            summary: HELP.into(),
            exit_code: 0,
        });
    }
    let (mut config, mut check, mut dry_run, mut contribution_sync) = (None, false, false, false);
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--check" if !check && !dry_run => check = true,
            "--dry-run" if !check && !dry_run => dry_run = true,
            "--contribution-sync" if !contribution_sync => contribution_sync = true,
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
        let _ = (path, check, dry_run, contribution_sync);
        Err("autosubmit_requires_unix")
    }
    #[cfg(unix)]
    {
        let now = crate::stats::now_ms()?;
        let source = crate::source_refresh::disk::read_secret(&path)?;
        let config = parse(source.as_bytes(), now)?;
        require_contribution_sync(&config, contribution_sync)?;
        if check {
            return outcome(Vec::new(), "configuration_valid", true);
        }
        let start = Instant::now();
        if dry_run {
            return execute(
                &config,
                &mut Native,
                crate::stats::now_ms,
                true,
                contribution_sync,
                || start.elapsed(),
            );
        }
        // A stable private lock serializes the complete refresh/publish cycle,
        // including manual invocations. The enrollment directory stays separate.
        let runtime = crate::source_refresh::disk::Cache::open(&config.runtime_dir)?;
        runtime.require_entries(&["refresh.lock", "last-cycle.json"])?;
        let outcome = execute(
            &config,
            &mut Native,
            crate::stats::now_ms,
            false,
            contribution_sync,
            || start.elapsed(),
        )?;
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
        fail_sink: bool,
        empty_client: Option<&'static str>,
        contribution: Vec<Result<&'static str, &'static str>>,
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
        fn sink(&mut self, sink: &Sink, _: Duration) -> Result<(), &'static str> {
            self.calls.push(format!("sink:{}", sink.action()));
            if self.fail_sink {
                Err("sink_failed")
            } else {
                Ok(())
            }
        }
        fn contribution_sync(
            &mut self,
            sync: &ContributionSync,
            source: &ContributionSource,
        ) -> Result<String, &'static str> {
            self.calls.push(format!(
                "contribution:{}:{}",
                source.provider(),
                sync.max_batches
            ));
            let reply = if self.contribution.is_empty() {
                Ok("settled")
            } else {
                self.contribution.remove(0)
            };
            reply.map(|status| format!("{{\"schemaVersion\":3,\"status\":\"{status}\"}}"))
        }
    }
    fn contribution_value() -> serde_json::Value {
        serde_json::json!({"stateDir":"/private/contribution","keyFile":"/private/key","populationId":"ab".repeat(32),"sources":[{"provider":"claude","file":"/private/claude.jsonl"},{"provider":"codex","file":"/private/codex.jsonl"}],"maxBatches":3})
    }
    fn contribution_configuration() -> Config {
        let mut value = config_value();
        value["sinks"] = serde_json::json!([{"kind":"tokscale","binary":"/usr/bin/tokscale"}]);
        value["contributionSync"] = contribution_value();
        parse(&serde_json::to_vec(&value).unwrap(), NOW).unwrap()
    }
    fn steps(out: &Outcome) -> Vec<serde_json::Value> {
        let value: serde_json::Value = serde_json::from_str(&out.summary).unwrap();
        value["steps"].as_array().unwrap().clone()
    }
    #[test]
    fn contribution_sync_runs_only_behind_the_flag_after_clean_publication_and_before_sinks() {
        let mut fake = Fake::default();
        let out = execute(
            &contribution_configuration(),
            &mut fake,
            || Ok(NOW),
            false,
            false,
            || Duration::ZERO,
        )
        .unwrap();
        assert!(!fake
            .calls
            .iter()
            .any(|call| call.starts_with("contribution")));
        assert!(!out.summary.contains("contribution_sync"));
        let mut fake = Fake {
            contribution: vec![Ok("drained"), Ok("batch_limit")],
            ..Default::default()
        };
        let out = execute(
            &contribution_configuration(),
            &mut fake,
            || Ok(NOW),
            false,
            true,
            || Duration::ZERO,
        )
        .unwrap();
        assert_eq!(
            fake.calls,
            [
                "resume",
                "refresh:cursor",
                "publish:cursor",
                "publish:claude",
                "contribution:claude:3",
                "contribution:codex:3",
                "sink:sink_tokscale"
            ]
        );
        assert_eq!(out.exit_code, 0);
        let steps = steps(&out);
        assert!(steps.contains(
            &serde_json::json!({"client":"claude","action":"contribution_sync","status":"drained"})
        ));
        assert!(steps.contains(&serde_json::json!({"client":"codex","action":"contribution_sync","status":"batch_limit"})));
        assert!(!out.summary.contains("/private"));
        assert!(!out.summary.contains(&"ab".repeat(32)));
        // An unknown sender status is reported with a fixed word, never relayed.
        assert_eq!(contribution_status("{\"status\":\"/private/x\"}"), "sent");
        assert_eq!(contribution_status("not json"), "sent");
    }
    #[test]
    fn contribution_sync_is_skipped_after_any_publication_failure_and_in_dry_runs() {
        for (mut fake, dry_run, expected) in [
            (
                Fake {
                    fail_publish: true,
                    ..Default::default()
                },
                false,
                // A failed publication no longer stops the remaining clients,
                // but it still withholds every contribution send this cycle.
                vec![
                    "resume",
                    "refresh:cursor",
                    "publish:cursor",
                    "publish:claude",
                    "sink:sink_tokscale",
                ],
            ),
            (
                Fake {
                    fail_refresh: true,
                    ..Default::default()
                },
                false,
                vec![
                    "resume",
                    "refresh:cursor",
                    "publish:claude",
                    "sink:sink_tokscale",
                ],
            ),
            (
                Fake {
                    fail_resume: true,
                    ..Default::default()
                },
                false,
                vec!["resume", "sink:sink_tokscale"],
            ),
            (Fake::default(), true, vec!["scan:cursor", "scan:claude"]),
        ] {
            let out = execute(
                &contribution_configuration(),
                &mut fake,
                || Ok(NOW),
                dry_run,
                true,
                || Duration::ZERO,
            )
            .unwrap();
            assert_eq!(fake.calls, expected);
            let skipped = steps(&out)
                .iter()
                .filter(|step| step["action"] == "contribution_sync" && step["status"] == "skipped")
                .count();
            assert_eq!(skipped, 2);
        }
    }
    #[test]
    fn a_failed_contribution_send_stops_later_sources_but_not_sinks() {
        let mut fake = Fake {
            contribution: vec![Err("contribution_sync_exchange_uncertain")],
            ..Default::default()
        };
        let out = execute(
            &contribution_configuration(),
            &mut fake,
            || Ok(NOW),
            false,
            true,
            || Duration::ZERO,
        )
        .unwrap();
        assert_eq!(
            fake.calls,
            [
                "resume",
                "refresh:cursor",
                "publish:cursor",
                "publish:claude",
                "contribution:claude:3",
                "sink:sink_tokscale"
            ]
        );
        assert_eq!(out.exit_code, 1);
        let value: serde_json::Value = serde_json::from_str(&out.summary).unwrap();
        assert_eq!(value["status"], "partial_failure");
        assert!(steps(&out).contains(&serde_json::json!({"client":"claude","action":"contribution_sync","status":"failed","error":"contribution_sync_exchange_uncertain"})));
        // The cycle deadline is honoured before each send.
        let mut fake = Fake::default();
        let mut ticks = 0u32;
        let out = execute(
            &contribution_configuration(),
            &mut fake,
            || Ok(NOW),
            false,
            true,
            || {
                ticks += 1;
                if ticks > 4 {
                    BUDGET
                } else {
                    Duration::ZERO
                }
            },
        )
        .unwrap();
        assert!(!fake
            .calls
            .iter()
            .any(|call| call.starts_with("contribution")));
        assert!(steps(&out).contains(&serde_json::json!({"client":"claude","action":"contribution_sync","status":"not_started","error":"autosubmit_deadline"})));
        assert_eq!(out.exit_code, 1);
    }
    #[test]
    fn contribution_sync_configuration_and_flag_are_validated_together() {
        let config = contribution_configuration();
        let sync = config.contribution_sync.as_ref().unwrap();
        assert_eq!(
            sync.args(&sync.sources[1]).unwrap(),
            [
                "contribution-sync",
                "--send",
                "--state-dir",
                "/private/contribution",
                "--key-file",
                "/private/key",
                "--population-id",
                &"ab".repeat(32),
                "--codex",
                "/private/codex.jsonl",
                "--max-batches",
                "3"
            ]
        );
        assert_eq!(require_contribution_sync(&config, true), Ok(()));
        assert_eq!(
            require_contribution_sync(&config, false),
            Err("autosubmit_contribution_sync_flag_required")
        );
        let plain = configuration();
        assert_eq!(require_contribution_sync(&plain, false), Ok(()));
        assert_eq!(
            require_contribution_sync(&plain, true),
            Err("autosubmit_contribution_sync_unconfigured")
        );
        let mut default = config_value();
        default["contributionSync"] = contribution_value();
        default["contributionSync"]
            .as_object_mut()
            .unwrap()
            .remove("maxBatches");
        let parsed = parse(&serde_json::to_vec(&default).unwrap(), NOW).unwrap();
        assert_eq!(parsed.contribution_sync.unwrap().max_batches, 1);
        for mutate in [
            |value: &mut serde_json::Value| value["maxBatches"] = 0.into(),
            |value: &mut serde_json::Value| value["maxBatches"] = 9.into(),
            |value: &mut serde_json::Value| value["populationId"] = "AB".repeat(32).into(),
            |value: &mut serde_json::Value| value["populationId"] = "ab".repeat(31).into(),
            |value: &mut serde_json::Value| value["sources"] = serde_json::json!([]),
            |value: &mut serde_json::Value| {
                value["sources"] = serde_json::json!([{"provider":"devin","file":"/private/d"}])
            },
            |value: &mut serde_json::Value| value["sources"] = serde_json::json!([{"provider":"claude","file":"/private/a"},{"provider":"codex","file":"/private/a"}]),
            |value: &mut serde_json::Value| {
                value["sources"] = serde_json::json!([{"provider":"claude","file":"relative"}])
            },
            |value: &mut serde_json::Value| {
                value["sources"] = serde_json::Value::Array(
                    (0..9)
                        .map(|index| serde_json::json!({"provider":"claude","file":format!("/private/{index}")}))
                        .collect(),
                )
            },
            |value: &mut serde_json::Value| value["stateDir"] = "/private/runtime".into(),
            |value: &mut serde_json::Value| value["stateDir"] = "/synthetic".into(),
            |value: &mut serde_json::Value| value["keyFile"] = "key".into(),
            |value: &mut serde_json::Value| value["fenceDir"] = "/private/fence".into(),
        ] {
            let mut value = config_value();
            let mut sync = contribution_value();
            mutate(&mut sync);
            value["contributionSync"] = sync;
            assert_eq!(
                parse(&serde_json::to_vec(&value).unwrap(), NOW).err(),
                Some(INVALID)
            );
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
                false,
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
                false,
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
            false,
            || Duration::ZERO,
        )
        .unwrap();
        // A publication that stays uncertain no longer stops the remaining
        // clients: each one resends the retained flight first and fails fast
        // without source I/O when the network is still unavailable.
        assert_eq!(
            fake.calls,
            [
                "resume",
                "refresh:cursor",
                "publish:cursor",
                "publish:claude"
            ]
        );
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
    fn a_client_days_override_narrows_only_its_own_window() {
        let mut value = config_value();
        value["clients"][1]["days"] = 2.into();
        let config = parse(&serde_json::to_vec(&value).unwrap(), NOW).unwrap();
        let global = collection_args(&config, &config.clients[0], NOW).unwrap();
        let narrow = collection_args(&config, &config.clients[1], NOW).unwrap();
        let since =
            |args: &[String]| args[args.iter().position(|a| a == "--since").unwrap() + 1].clone();
        let until =
            |args: &[String]| args[args.iter().position(|a| a == "--until").unwrap() + 1].clone();
        assert_eq!(until(&global), until(&narrow));
        assert_ne!(since(&global), since(&narrow));
        let day = NOW / crate::stats::DAY_MS;
        let expected = time::OffsetDateTime::from_unix_timestamp(((day - 1) * 86_400) as i64)
            .unwrap()
            .date()
            .to_string();
        assert_eq!(since(&narrow), expected);
        let mut bad = config_value();
        bad["clients"][0]["days"] = 0.into();
        assert!(parse(&serde_json::to_vec(&bad).unwrap(), NOW).is_err());
        let mut bad = config_value();
        bad["clients"][0]["days"] = 367.into();
        assert!(parse(&serde_json::to_vec(&bad).unwrap(), NOW).is_err());
    }
    #[test]
    fn cycle_budget_does_not_start_another_scan() {
        let mut fake = Fake::default();
        let out = execute(
            &configuration(),
            &mut fake,
            || Ok(NOW),
            true,
            false,
            || BUDGET,
        )
        .unwrap();
        assert!(fake.calls.is_empty());
        assert_eq!(out.exit_code, 1);
    }
    fn sink_configuration() -> Config {
        let mut value = config_value();
        value["sinks"] = serde_json::json!([{"kind":"tokscale","binary":"/usr/bin/tokscale"}]);
        parse(&serde_json::to_vec(&value).unwrap(), NOW).unwrap()
    }
    #[test]
    fn sinks_run_once_after_every_client_attempt() {
        let mut fake = Fake::default();
        let out = execute(
            &sink_configuration(),
            &mut fake,
            || Ok(NOW),
            false,
            false,
            || Duration::ZERO,
        )
        .unwrap();
        assert_eq!(
            fake.calls,
            [
                "resume",
                "refresh:cursor",
                "publish:cursor",
                "publish:claude",
                "sink:sink_tokscale"
            ]
        );
        assert_eq!(out.exit_code, 0);
        let value: serde_json::Value = serde_json::from_str(&out.summary).unwrap();
        assert!(value["steps"].as_array().unwrap().iter().any(|step| {
            step == &serde_json::json!({"client":null,"action":"sink_tokscale","status":"submitted"})
        }));
    }
    #[test]
    fn a_failed_sink_reports_a_fixed_code_after_publication() {
        let mut fake = Fake {
            fail_sink: true,
            ..Default::default()
        };
        let out = execute(
            &sink_configuration(),
            &mut fake,
            || Ok(NOW),
            false,
            false,
            || Duration::ZERO,
        )
        .unwrap();
        assert_eq!(out.exit_code, 1);
        let value: serde_json::Value = serde_json::from_str(&out.summary).unwrap();
        assert_eq!(value["status"], "partial_failure");
        assert!(value["steps"].as_array().unwrap().iter().any(|step| {
            step == &serde_json::json!({"client":null,"action":"sink_tokscale","status":"failed","error":"sink_failed"})
        }));
        assert!(!out.summary.contains("/usr/bin"));
    }
    #[test]
    fn sinks_still_run_when_publication_needs_reconciliation() {
        // An uncertain resume ends the cycle before provider or source I/O;
        // an uncertain publication lets the remaining clients try. Sinks run
        // either way.
        for (mut fake, calls, status) in [
            (
                Fake {
                    fail_resume: true,
                    ..Default::default()
                },
                vec!["resume", "sink:sink_tokscale"],
                "resume_required",
            ),
            (
                Fake {
                    fail_publish: true,
                    ..Default::default()
                },
                vec![
                    "resume",
                    "refresh:cursor",
                    "publish:cursor",
                    "publish:claude",
                    "sink:sink_tokscale",
                ],
                "partial_failure",
            ),
        ] {
            let out = execute(
                &sink_configuration(),
                &mut fake,
                || Ok(NOW),
                false,
                false,
                || Duration::ZERO,
            )
            .unwrap();
            assert_eq!(fake.calls, calls);
            let value: serde_json::Value = serde_json::from_str(&out.summary).unwrap();
            assert_eq!(value["status"], status);
            assert_eq!(out.exit_code, 1);
            assert!(value["steps"].as_array().unwrap().iter().any(|step| {
                step
                    == &serde_json::json!({"client":null,"action":"sink_tokscale","status":"submitted"})
            }));
        }
    }
    #[test]
    fn dry_run_never_delegates() {
        let mut fake = Fake::default();
        let out = execute(
            &sink_configuration(),
            &mut fake,
            || Ok(NOW),
            true,
            false,
            || Duration::ZERO,
        )
        .unwrap();
        assert_eq!(fake.calls, ["scan:cursor", "scan:claude"]);
        assert_eq!(out.exit_code, 0);
        let value: serde_json::Value = serde_json::from_str(&out.summary).unwrap();
        assert!(value["steps"].as_array().unwrap().iter().any(|step| {
            step == &serde_json::json!({"client":null,"action":"sink_tokscale","status":"skipped"})
        }));
    }
    #[test]
    fn an_exhausted_cycle_never_delegates() {
        let mut fake = Fake::default();
        let out = execute(
            &sink_configuration(),
            &mut fake,
            || Ok(NOW),
            false,
            false,
            || BUDGET,
        )
        .unwrap();
        assert_eq!(fake.calls, ["resume"]);
        assert_eq!(out.exit_code, 1);
        let value: serde_json::Value = serde_json::from_str(&out.summary).unwrap();
        assert!(value["steps"].as_array().unwrap().iter().any(|step| {
            step == &serde_json::json!({"client":null,"action":"sink_tokscale","status":"not_started","error":"autosubmit_deadline"})
        }));
    }
    #[test]
    fn sink_shape_is_validated_before_effects() {
        for sinks in [
            serde_json::json!([{"kind":"tokscale","binary":"relative/tokscale"}]),
            serde_json::json!([{"kind":"tokscale"}]),
            serde_json::json!([{"kind":"tokscale","binary":"/usr/bin/tokscale","token":"NEVER"}]),
            serde_json::json!([{"kind":"unknown","binary":"/usr/bin/x"}]),
            serde_json::json!([
                {"kind":"tokscale","binary":"/usr/bin/tokscale"},
                {"kind":"tokscale","binary":"/usr/bin/other"}
            ]),
        ] {
            let mut value = config_value();
            value["sinks"] = sinks;
            assert!(parse(&serde_json::to_vec(&value).unwrap(), NOW).is_err());
        }
    }
}

#[cfg(all(test, unix))]
mod delegate_custody_tests {
    use super::*;
    #[test]
    fn delegate_deadline_settles_group_before_reporting_deadline() {
        let start = Instant::now();
        assert_eq!(
            run_delegate(
                Command::new("/bin/sh").args(["-c", "sleep 30 & wait"]),
                Duration::from_millis(25)
            ),
            Err("sink_deadline")
        );
        assert!(start.elapsed() < Duration::from_secs(6));
    }
}
