//! Scheduled history collection: a launchd agent on macOS and a systemd user
//! timer on Linux. Both run `aicharts history collect --scheduled` every six
//! hours: often enough to keep each day before an agent deletes old files,
//! rarely enough that a large set of session files costs little.
//! Each file carries an ownership line with the hash of its body, so a file
//! someone else wrote or edited is reported and left alone.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use sha2::{Digest, Sha256};

use hraness_cli_kit::{audience, Audience, Style, Symbol};

pub(crate) const LAUNCHD_LABEL: &str = "io.aicharts.history";
pub(crate) const SYSTEMD_SERVICE: &str = "aicharts-history.service";
pub(crate) const SYSTEMD_TIMER: &str = "aicharts-history.timer";
const INTERVAL_SECONDS: u64 = 21_600;
const MAX_DEFINITION_BYTES: u64 = 64 * 1024;
const MAX_PROGRAM_BYTES: usize = 1_024;
const LAUNCHCTL: &str = "/bin/launchctl";
const SYSTEMCTL: [&str; 2] = ["/usr/bin/systemctl", "/bin/systemctl"];

const PRE_PROMPT: &str = "macOS will show \"Background Items Added\" for aicharts. It reads your agents' session files four times a day and keeps daily token totals on this Mac. Turn it off with aicharts history disable.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Launchd,
    Systemd,
    Unsupported,
}

impl Kind {
    pub(crate) fn current() -> Self {
        if cfg!(target_os = "macos") {
            Self::Launchd
        } else if cfg!(target_os = "linux") {
            Self::Systemd
        } else {
            Self::Unsupported
        }
    }

    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Launchd => "launchd",
            Self::Systemd => "systemd",
            Self::Unsupported => "unsupported",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Definition {
    pub(crate) path: PathBuf,
    pub(crate) name: &'static str,
    pub(crate) contents: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Plan {
    pub(crate) kind: Kind,
    pub(crate) definitions: Vec<Definition>,
}

fn sha256_hex(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn header(kind: Kind, name: &str, body: &str) -> String {
    match kind {
        Kind::Launchd => format!(
            "<!-- aicharts history {name} sha256:{} -->\n",
            sha256_hex(body)
        ),
        _ => format!("# aicharts history {name} sha256:{}\n", sha256_hex(body)),
    }
}

fn xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn program_text(program: &Path) -> Result<String, &'static str> {
    let text = program.to_str().ok_or("history_program_path_unsupported")?;
    if !program.is_absolute()
        || text.is_empty()
        || text.len() > MAX_PROGRAM_BYTES
        || text.chars().any(char::is_control)
    {
        return Err("history_program_path_unsupported");
    }
    Ok(text.to_owned())
}

/// The macOS agent. Building it has no side effects.
pub(crate) fn launchd_plan(
    program: &Path,
    home: &Path,
    log_dir: &Path,
) -> Result<Plan, &'static str> {
    let program = program_text(program)?;
    if !home.is_absolute() || !log_dir.is_absolute() {
        return Err("home_required");
    }
    let arguments: String = [program.as_str(), "history", "collect", "--scheduled"]
        .iter()
        .map(|arg| format!("<string>{}</string>", xml(arg)))
        .collect();
    let body = format!(
        "<plist version=\"1.0\"><dict>\n<key>Label</key><string>{LAUNCHD_LABEL}</string>\n<key>ProgramArguments</key><array>{arguments}</array>\n<key>RunAtLoad</key><true/>\n<key>StartInterval</key><integer>{INTERVAL_SECONDS}</integer>\n<key>ProcessType</key><string>Background</string>\n<key>LowPriorityIO</key><true/>\n<key>StandardOutPath</key><string>{}</string>\n<key>StandardErrorPath</key><string>{}</string>\n</dict></plist>\n",
        xml(&log_dir.join("history.out.log").to_string_lossy()),
        xml(&log_dir.join("history.err.log").to_string_lossy()),
    );
    let name = "io.aicharts.history.plist";
    Ok(Plan {
        kind: Kind::Launchd,
        definitions: vec![Definition {
            path: home.join("Library").join("LaunchAgents").join(name),
            name,
            contents: header(Kind::Launchd, name, &body) + &body,
        }],
    })
}

/// The Linux service and timer. systemd splits `ExecStart` on whitespace and
/// expands `%` and `$`, so only plain absolute paths are accepted.
pub(crate) fn systemd_plan(program: &Path, unit_dir: &Path) -> Result<Plan, &'static str> {
    let program = program_text(program)?;
    if !program
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"/._+-@".contains(&byte))
    {
        return Err("history_program_path_unsupported");
    }
    if !unit_dir.is_absolute() {
        return Err("home_required");
    }
    let service = format!(
        "[Unit]\nDescription=aicharts usage history (local only; nothing is uploaded)\n\n[Service]\nType=oneshot\nExecStart={program} history collect --scheduled\nNice=10\nIOSchedulingClass=idle\n"
    );
    let timer = format!(
        "[Unit]\nDescription=Collect aicharts usage history four times a day\n\n[Timer]\nOnBootSec=5min\nOnUnitActiveSec={INTERVAL_SECONDS}s\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n"
    );
    Ok(Plan {
        kind: Kind::Systemd,
        definitions: vec![
            Definition {
                path: unit_dir.join(SYSTEMD_SERVICE),
                name: SYSTEMD_SERVICE,
                contents: header(Kind::Systemd, SYSTEMD_SERVICE, &service) + &service,
            },
            Definition {
                path: unit_dir.join(SYSTEMD_TIMER),
                name: SYSTEMD_TIMER,
                contents: header(Kind::Systemd, SYSTEMD_TIMER, &timer) + &timer,
            },
        ],
    })
}

/// The file at `definition.path` when this command wrote it: `Ok(None)` when
/// absent, `Err("history_not_ours")` when its ownership line is missing or
/// does not match its body.
fn owned(kind: Kind, definition: &Definition) -> Result<Option<String>, &'static str> {
    let meta = match std::fs::symlink_metadata(&definition.path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("history_unwritable"),
    };
    if !meta.is_file() || meta.len() > MAX_DEFINITION_BYTES {
        return Err("history_not_ours");
    }
    let text = std::fs::read_to_string(&definition.path).map_err(|_| "history_unwritable")?;
    let (first, body) = text.split_once('\n').ok_or("history_not_ours")?;
    if format!("{first}\n") != header(kind, definition.name, body) {
        return Err("history_not_ours");
    }
    Ok(Some(text))
}

/// `on`, `off`, `outdated` (ours, but for another program or version),
/// `not-ours`, `unknown` or `unsupported`.
pub(crate) fn state(plan: &Plan) -> &'static str {
    if plan.kind == Kind::Unsupported {
        return "unsupported";
    }
    let mut present = 0;
    let mut current = 0;
    for definition in &plan.definitions {
        match owned(plan.kind, definition) {
            Ok(Some(text)) => {
                present += 1;
                if text == definition.contents {
                    current += 1;
                }
            }
            Ok(None) => {}
            Err("history_not_ours") => return "not-ours",
            Err(_) => return "unknown",
        }
    }
    match (present, current) {
        (0, _) => "off",
        (present, current) if present == plan.definitions.len() && current == present => "on",
        _ => "outdated",
    }
}

fn private_dir(path: &Path) -> Result<(), &'static str> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => Ok(()),
        Ok(_) => Err("history_unwritable"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut builder = std::fs::DirBuilder::new();
            builder.recursive(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder.create(path).map_err(|_| "history_unwritable")
        }
        Err(_) => Err("history_unwritable"),
    }
}

/// Writes one definition atomically. A new file is linked into place, which
/// fails if a file appeared meanwhile; an existing file is replaced only
/// while it still holds exactly what was read.
fn write(definition: &Definition, existing: Option<&str>, kind: Kind) -> Result<(), &'static str> {
    let parent = definition.path.parent().ok_or("history_unwritable")?;
    private_dir(parent)?;
    let temp = parent.join(format!(".{}.{}.tmp", definition.name, std::process::id()));
    let staged = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        file.write_all(definition.contents.as_bytes())?;
        file.sync_all()
    })();
    if staged.is_err() {
        let _ = std::fs::remove_file(&temp);
        return Err("history_unwritable");
    }
    let published = (|| -> Result<(), &'static str> {
        if owned(kind, definition)?.as_deref() != existing {
            return Err("history_not_ours");
        }
        let result = match existing {
            None => std::fs::hard_link(&temp, &definition.path),
            Some(_) => std::fs::rename(&temp, &definition.path),
        };
        result.map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "history_not_ours"
            } else {
                "history_unwritable"
            }
        })
    })();
    let _ = std::fs::remove_file(&temp);
    published
}

/// Runs the platform scheduler. Tests substitute a recorder.
pub(crate) trait Manager {
    fn run(&self, program: &str, args: &[String]) -> bool;
}

pub(crate) struct SystemManager;

impl Manager for SystemManager {
    fn run(&self, program: &str, args: &[String]) -> bool {
        Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }
}

fn systemctl() -> Option<&'static str> {
    SYSTEMCTL.into_iter().find(|path| Path::new(path).is_file())
}

#[cfg(unix)]
fn launchd_domain() -> String {
    format!("gui/{}", rustix::process::getuid().as_raw())
}

#[cfg(not(unix))]
fn launchd_domain() -> String {
    String::new()
}

fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Enabled {
    pub(crate) changes: Vec<&'static str>,
    /// `running` (started now), `next-login` (macOS starts it at the next
    /// login) or `inactive` (the scheduler refused; files are in place).
    pub(crate) activation: &'static str,
}

pub(crate) fn enable(
    plan: &Plan,
    manager: &dyn Manager,
    domain: &str,
    systemctl: Option<&str>,
) -> Result<Enabled, &'static str> {
    if plan.kind == Kind::Unsupported {
        return Err("history_scheduler_unavailable");
    }
    let mut existing = Vec::with_capacity(plan.definitions.len());
    for definition in &plan.definitions {
        existing.push(owned(plan.kind, definition)?);
    }
    let mut changes = Vec::with_capacity(plan.definitions.len());
    for (definition, current) in plan.definitions.iter().zip(&existing) {
        if current.as_deref() == Some(definition.contents.as_str()) {
            changes.push("unchanged");
            continue;
        }
        write(definition, current.as_deref(), plan.kind)?;
        changes.push(if current.is_some() {
            "updated"
        } else {
            "created"
        });
    }
    let changed = changes.iter().any(|change| *change != "unchanged");
    let activation = match plan.kind {
        Kind::Launchd => {
            let target = format!("{domain}/{LAUNCHD_LABEL}");
            let loaded = manager.run(LAUNCHCTL, &args(&["print", &target]));
            if loaded && !changed {
                "running"
            } else {
                if loaded {
                    manager.run(LAUNCHCTL, &args(&["bootout", &target]));
                }
                let path = plan.definitions[0].path.to_string_lossy().into_owned();
                if manager.run(LAUNCHCTL, &args(&["bootstrap", domain, &path])) {
                    "running"
                } else {
                    // Outside a login session (for example over SSH) launchd
                    // loads the agent at the next login instead.
                    "next-login"
                }
            }
        }
        Kind::Systemd => match systemctl {
            Some(systemctl) => {
                let reloaded = manager.run(systemctl, &args(&["--user", "daemon-reload"]));
                if reloaded
                    && manager.run(
                        systemctl,
                        &args(&["--user", "enable", "--now", SYSTEMD_TIMER]),
                    )
                {
                    // The first collection starts now rather than at the
                    // timer's first interval.
                    manager.run(
                        systemctl,
                        &args(&["--user", "start", "--no-block", SYSTEMD_SERVICE]),
                    );
                    "running"
                } else {
                    "inactive"
                }
            }
            None => "inactive",
        },
        Kind::Unsupported => unreachable!("refused above"),
    };
    Ok(Enabled {
        changes,
        activation,
    })
}

/// Stops scheduled collection and removes this command's files. The record
/// itself is never touched. Returns whether anything was removed.
pub(crate) fn disable(
    plan: &Plan,
    manager: &dyn Manager,
    domain: &str,
    systemctl: Option<&str>,
) -> Result<bool, &'static str> {
    if plan.kind == Kind::Unsupported {
        return Err("history_scheduler_unavailable");
    }
    let mut ours = Vec::new();
    for definition in &plan.definitions {
        match owned(plan.kind, definition) {
            Ok(Some(_)) => ours.push(definition),
            Ok(None) => {}
            Err(code) => return Err(code),
        }
    }
    if ours.is_empty() {
        return Ok(false);
    }
    match plan.kind {
        Kind::Launchd => {
            manager.run(
                LAUNCHCTL,
                &args(&["bootout", &format!("{domain}/{LAUNCHD_LABEL}")]),
            );
        }
        Kind::Systemd => {
            if let Some(systemctl) = systemctl {
                manager.run(
                    systemctl,
                    &args(&["--user", "disable", "--now", SYSTEMD_TIMER]),
                );
            }
        }
        Kind::Unsupported => {}
    }
    for definition in ours {
        std::fs::remove_file(&definition.path).map_err(|_| "history_unwritable")?;
    }
    if plan.kind == Kind::Systemd {
        if let Some(systemctl) = systemctl {
            manager.run(systemctl, &args(&["--user", "daemon-reload"]));
        }
    }
    Ok(true)
}

fn unit_dir(env: &dyn Fn(&str) -> Option<String>) -> Result<PathBuf, &'static str> {
    if let Some(config) = env("XDG_CONFIG_HOME").filter(|value| !value.is_empty()) {
        let config = PathBuf::from(config);
        if config.is_absolute() {
            return Ok(config.join("systemd").join("user"));
        }
    }
    let home = PathBuf::from(env("HOME").ok_or("home_required")?);
    if !home.is_absolute() {
        return Err("home_required");
    }
    Ok(home.join(".config").join("systemd").join("user"))
}

pub(crate) fn plan_for(
    kind: Kind,
    program: &Path,
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<Plan, &'static str> {
    match kind {
        Kind::Launchd => {
            let home = PathBuf::from(env("HOME").ok_or("home_required")?);
            let log_dir = super::directory(env)?;
            launchd_plan(program, &home, &log_dir)
        }
        Kind::Systemd => systemd_plan(program, &unit_dir(env)?),
        Kind::Unsupported => Ok(Plan {
            kind,
            definitions: Vec::new(),
        }),
    }
}

fn live_plan() -> Result<Plan, &'static str> {
    let program = std::env::current_exe().map_err(|_| "history_program_path_unsupported")?;
    plan_for(Kind::current(), &program, &|name| std::env::var(name).ok())
}

pub(crate) struct LiveState {
    pub(crate) state: &'static str,
    pub(crate) kind: &'static str,
}

pub(crate) fn live_state() -> LiveState {
    let kind = Kind::current();
    LiveState {
        state: live_plan().map_or("unknown", |plan| state(&plan)),
        kind: kind.name(),
    }
}

fn json_flag(args: &[String]) -> Result<bool, &'static str> {
    match args {
        [] => Ok(false),
        [flag] if flag == "--json" => Ok(true),
        _ => Err("invalid_option"),
    }
}

pub(crate) fn run_enable(args: &[String]) -> Result<String, &'static str> {
    let json = json_flag(args)?;
    let plan = live_plan()?;
    if plan.kind == Kind::Unsupported {
        return Err("history_scheduler_unavailable");
    }
    let dir = super::live_directory()?;
    super::private_directory(&dir)?;
    if plan.kind == Kind::Launchd
        && !json
        && audience::detect_current() == Audience::Human
        && state(&plan) != "on"
    {
        eprintln!("{} {PRE_PROMPT}", Style::stderr().symbol(Symbol::Next));
    }
    let enabled = enable(&plan, &SystemManager, &launchd_domain(), systemctl())?;
    if json {
        return serde_json::to_string(&serde_json::json!({
            "schemaVersion": 1,
            "operation": "history-enable",
            "scheduler": plan.kind.name(),
            "changes": enabled.changes,
            "activation": enabled.activation,
            "directory": dir,
            "uploaded": false,
        }))
        .map(|json| json + "\n")
        .map_err(|_| "stats_encode_failed");
    }
    let start = match enabled.activation {
        "running" => "The first collection is running now; later ones run four times a day.",
        "next-login" => "Collection starts at your next login. Run aicharts history collect to start now.",
        _ => "The system scheduler didn't start it. Run aicharts history collect when you want to update the record.",
    };
    Ok(format!(
        "Usage history is on. aicharts reads your agents' session files and keeps daily token totals in {}. Nothing is uploaded.\n{start}\nSee it: aicharts history report · Turn it off: aicharts history disable\n",
        dir.display()
    ))
}

pub(crate) fn run_disable(args: &[String]) -> Result<String, &'static str> {
    let json = json_flag(args)?;
    let plan = live_plan()?;
    let removed = disable(&plan, &SystemManager, &launchd_domain(), systemctl())?;
    let dir = super::live_directory()?;
    if json {
        return serde_json::to_string(&serde_json::json!({
            "schemaVersion": 1,
            "operation": "history-disable",
            "scheduler": plan.kind.name(),
            "removed": removed,
            "directory": dir,
        }))
        .map(|json| json + "\n")
        .map_err(|_| "stats_encode_failed");
    }
    Ok(if removed {
        format!(
            "Usage history is off. The record in {} stays; delete that folder yourself if you no longer want it.\n",
            dir.display()
        )
    } else {
        "Usage history was not on.\n".to_owned()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Recorder {
        calls: RefCell<Vec<String>>,
        loaded: bool,
        succeed: bool,
    }

    impl Manager for Recorder {
        fn run(&self, program: &str, args: &[String]) -> bool {
            self.calls
                .borrow_mut()
                .push(format!("{program} {}", args.join(" ")));
            if args.first().map(String::as_str) == Some("print") {
                return self.loaded;
            }
            self.succeed
        }
    }

    fn recorder(loaded: bool, succeed: bool) -> Recorder {
        Recorder {
            calls: RefCell::new(Vec::new()),
            loaded,
            succeed,
        }
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "aicharts-history-schedule-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn launchd_plan_runs_scheduled_collection_and_escapes_paths() {
        let plan = launchd_plan(
            Path::new("/Users/me/.local/bin/aicharts & co"),
            Path::new("/Users/me"),
            Path::new("/Users/me/.aicharts/history"),
        )
        .unwrap();
        let contents = &plan.definitions[0].contents;
        assert!(contents.starts_with("<!-- aicharts history io.aicharts.history.plist sha256:"));
        assert!(contents.contains("<string>/Users/me/.local/bin/aicharts &amp; co</string><string>history</string><string>collect</string><string>--scheduled</string>"));
        assert!(contents.contains("<key>StartInterval</key><integer>21600</integer>"));
        assert!(contents.contains("<key>RunAtLoad</key><true/>"));
        assert!(!contents.contains("KeepAlive"));
        assert_eq!(
            plan.definitions[0].path,
            PathBuf::from("/Users/me/Library/LaunchAgents/io.aicharts.history.plist")
        );
        assert_eq!(
            launchd_plan(
                Path::new("relative/aicharts"),
                Path::new("/Users/me"),
                Path::new("/x")
            ),
            Err("history_program_path_unsupported")
        );
    }

    #[test]
    fn systemd_plan_refuses_paths_systemd_would_split_or_expand() {
        let plan = systemd_plan(
            Path::new("/home/me/.local/bin/aicharts"),
            Path::new("/home/me/.config/systemd/user"),
        )
        .unwrap();
        assert_eq!(plan.definitions.len(), 2);
        assert!(plan.definitions[0]
            .contents
            .contains("ExecStart=/home/me/.local/bin/aicharts history collect --scheduled"));
        assert!(plan.definitions[1]
            .contents
            .contains("OnUnitActiveSec=21600s"));
        for unsafe_path in [
            "/home/me/my tools/aicharts",
            "/home/me/100%/aicharts",
            "/home/$USER/aicharts",
        ] {
            assert_eq!(
                systemd_plan(
                    Path::new(unsafe_path),
                    Path::new("/home/me/.config/systemd/user")
                ),
                Err("history_program_path_unsupported")
            );
        }
    }

    #[test]
    fn enable_writes_once_starts_now_and_reports_unchanged_on_repeat() {
        let dir = temp("enable");
        let plan =
            systemd_plan(Path::new("/opt/aicharts/bin/aicharts"), &dir.join("units")).unwrap();
        let manager = recorder(false, true);
        let first = enable(&plan, &manager, "", Some("/usr/bin/systemctl")).unwrap();
        assert_eq!(first.changes, vec!["created", "created"]);
        assert_eq!(first.activation, "running");
        assert!(manager
            .calls
            .borrow()
            .iter()
            .any(|call| call.ends_with("--user enable --now aicharts-history.timer")));
        assert_eq!(state(&plan), "on");
        let second = enable(
            &plan,
            &recorder(false, true),
            "",
            Some("/usr/bin/systemctl"),
        )
        .unwrap();
        assert_eq!(second.changes, vec!["unchanged", "unchanged"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_someone_else_wrote_is_left_alone() {
        let dir = temp("not-ours");
        let plan = launchd_plan(Path::new("/opt/aicharts"), &dir, &dir.join("history")).unwrap();
        let path = &plan.definitions[0].path;
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "<plist>hand written</plist>\n").unwrap();
        assert_eq!(state(&plan), "not-ours");
        assert_eq!(
            enable(&plan, &recorder(false, true), "gui/501", None),
            Err("history_not_ours")
        );
        assert_eq!(
            disable(&plan, &recorder(true, true), "gui/501", None),
            Err("history_not_ours")
        );
        assert_eq!(
            std::fs::read_to_string(path).unwrap(),
            "<plist>hand written</plist>\n"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn launchd_falls_back_to_next_login_and_reloads_a_changed_agent() {
        let dir = temp("launchd");
        let plan = launchd_plan(Path::new("/opt/a/aicharts"), &dir, &dir.join("h")).unwrap();
        let refused = enable(&plan, &recorder(false, false), "gui/501", None).unwrap();
        assert_eq!(refused.activation, "next-login");
        let moved = launchd_plan(Path::new("/opt/b/aicharts"), &dir, &dir.join("h")).unwrap();
        assert_eq!(state(&moved), "outdated");
        let manager = recorder(true, true);
        let updated = enable(&moved, &manager, "gui/501", None).unwrap();
        assert_eq!(updated.changes, vec!["updated"]);
        assert_eq!(updated.activation, "running");
        let calls = manager.calls.borrow();
        let bootout = calls
            .iter()
            .position(|call| call.contains(" bootout "))
            .unwrap();
        let bootstrap = calls
            .iter()
            .position(|call| call.contains(" bootstrap "))
            .unwrap();
        assert!(bootout < bootstrap);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn disable_removes_only_our_files_and_never_the_record() {
        let dir = temp("disable");
        let record = dir.join("history");
        std::fs::create_dir_all(&record).unwrap();
        std::fs::write(record.join("usage-history.json"), "{}").unwrap();
        let plan = systemd_plan(Path::new("/opt/aicharts"), &dir.join("units")).unwrap();
        enable(
            &plan,
            &recorder(false, true),
            "",
            Some("/usr/bin/systemctl"),
        )
        .unwrap();
        assert!(disable(
            &plan,
            &recorder(false, true),
            "",
            Some("/usr/bin/systemctl")
        )
        .unwrap());
        assert_eq!(state(&plan), "off");
        assert!(record.join("usage-history.json").is_file());
        assert!(!disable(
            &plan,
            &recorder(false, true),
            "",
            Some("/usr/bin/systemctl")
        )
        .unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unsupported_systems_refuse_without_writing() {
        let plan = Plan {
            kind: Kind::Unsupported,
            definitions: Vec::new(),
        };
        assert_eq!(state(&plan), "unsupported");
        assert_eq!(
            enable(&plan, &recorder(false, true), "", None),
            Err("history_scheduler_unavailable")
        );
    }
}
