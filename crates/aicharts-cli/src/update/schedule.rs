//! Scheduled self-update: a launchd agent on macOS and a systemd user timer
//! on Linux. Both run `aicharts update --scheduled` once a day and at login:
//! often enough that a security fix reaches unattended installs, rarely
//! enough that the check costs one small request.
//! Each file carries an ownership line with the hash of its body, so a file
//! someone else wrote or edited is reported and left alone.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::history::schedule::{Manager, SystemManager};

const LAUNCHD_LABEL: &str = "io.aicharts.update";
const SYSTEMD_SERVICE: &str = "aicharts-update.service";
const SYSTEMD_TIMER: &str = "aicharts-update.timer";
const INTERVAL_SECONDS: u64 = 86_400;
const MAX_DEFINITION_BYTES: u64 = 64 * 1024;
const MAX_PROGRAM_BYTES: usize = 1_024;
const LAUNCHCTL: &str = "/bin/launchctl";
const SYSTEMCTL: [&str; 2] = ["/usr/bin/systemctl", "/bin/systemctl"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Launchd,
    Systemd,
    Unsupported,
}

impl Kind {
    fn current() -> Self {
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
            "<!-- aicharts update {name} sha256:{} -->\n",
            sha256_hex(body)
        ),
        _ => format!("# aicharts update {name} sha256:{}\n", sha256_hex(body)),
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
    let text = program.to_str().ok_or("update_program_path_unsupported")?;
    if !program.is_absolute()
        || text.is_empty()
        || text.len() > MAX_PROGRAM_BYTES
        || text.chars().any(char::is_control)
    {
        return Err("update_program_path_unsupported");
    }
    Ok(text.to_owned())
}

/// The macOS agent. Building it has no side effects.
fn launchd_plan(program: &Path, home: &Path, log_dir: &Path) -> Result<Plan, &'static str> {
    let program = program_text(program)?;
    if !home.is_absolute() || !log_dir.is_absolute() {
        return Err("home_required");
    }
    let arguments: String = [program.as_str(), "update", "--scheduled"]
        .iter()
        .map(|arg| format!("<string>{}</string>", xml(arg)))
        .collect();
    let body = format!(
        "<plist version=\"1.0\"><dict>\n<key>Label</key><string>{LAUNCHD_LABEL}</string>\n<key>ProgramArguments</key><array>{arguments}</array>\n<key>RunAtLoad</key><true/>\n<key>StartInterval</key><integer>{INTERVAL_SECONDS}</integer>\n<key>ProcessType</key><string>Background</string>\n<key>LowPriorityIO</key><true/>\n<key>StandardOutPath</key><string>{}</string>\n<key>StandardErrorPath</key><string>{}</string>\n</dict></plist>\n",
        xml(&log_dir.join("update.out.log").to_string_lossy()),
        xml(&log_dir.join("update.err.log").to_string_lossy()),
    );
    let name = "io.aicharts.update.plist";
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
fn systemd_plan(program: &Path, unit_dir: &Path) -> Result<Plan, &'static str> {
    let program = program_text(program)?;
    if !program
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"/._+-@".contains(&byte))
    {
        return Err("update_program_path_unsupported");
    }
    if !unit_dir.is_absolute() {
        return Err("home_required");
    }
    let service = format!(
        "[Unit]\nDescription=aicharts self-update (verified release download and install)\n\n[Service]\nType=oneshot\nExecStart={program} update --scheduled\nNice=10\nIOSchedulingClass=idle\n"
    );
    let timer = format!(
        "[Unit]\nDescription=Update aicharts daily\n\n[Timer]\nOnBootSec=30min\nOnUnitActiveSec={INTERVAL_SECONDS}s\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n"
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
/// absent, `Err("update_not_ours")` when its ownership line is missing or
/// does not match its body.
fn owned(kind: Kind, definition: &Definition) -> Result<Option<String>, &'static str> {
    let meta = match std::fs::symlink_metadata(&definition.path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("update_unwritable"),
    };
    if !meta.is_file() || meta.len() > MAX_DEFINITION_BYTES {
        return Err("update_not_ours");
    }
    let text = std::fs::read_to_string(&definition.path).map_err(|_| "update_unwritable")?;
    let (first, body) = text.split_once('\n').ok_or("update_not_ours")?;
    if format!("{first}\n") != header(kind, definition.name, body) {
        return Err("update_not_ours");
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
            Err("update_not_ours") => return "not-ours",
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
        Ok(_) => Err("update_unwritable"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut builder = std::fs::DirBuilder::new();
            builder.recursive(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder.create(path).map_err(|_| "update_unwritable")
        }
        Err(_) => Err("update_unwritable"),
    }
}

/// Writes one definition atomically. A new file is linked into place, which
/// fails if a file appeared meanwhile; an existing file is replaced only
/// while it still holds exactly what was read.
fn write(definition: &Definition, existing: Option<&str>, kind: Kind) -> Result<(), &'static str> {
    let parent = definition.path.parent().ok_or("update_unwritable")?;
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
        return Err("update_unwritable");
    }
    let published = (|| -> Result<(), &'static str> {
        if owned(kind, definition)?.as_deref() != existing {
            return Err("update_not_ours");
        }
        let result = match existing {
            None => std::fs::hard_link(&temp, &definition.path),
            Some(_) => std::fs::rename(&temp, &definition.path),
        };
        result.map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "update_not_ours"
            } else {
                "update_unwritable"
            }
        })
    })();
    let _ = std::fs::remove_file(&temp);
    published
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
    /// `running`, `next-login` (macOS loads it at the next login) or
    /// `inactive` (the scheduler refused; files are in place).
    pub(crate) activation: &'static str,
}

pub(crate) fn enable(
    plan: &Plan,
    manager: &dyn Manager,
    domain: &str,
    systemctl: Option<&str>,
) -> Result<Enabled, &'static str> {
    if plan.kind == Kind::Unsupported {
        return Err("update_scheduler_unavailable");
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

/// Stops scheduled updates and removes this command's files. Returns whether
/// anything was removed.
pub(crate) fn disable(
    plan: &Plan,
    manager: &dyn Manager,
    domain: &str,
    systemctl: Option<&str>,
) -> Result<bool, &'static str> {
    if plan.kind == Kind::Unsupported {
        return Err("update_scheduler_unavailable");
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
        std::fs::remove_file(&definition.path).map_err(|_| "update_unwritable")?;
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
            let log_dir = crate::history::directory(env)?;
            launchd_plan(program, &home, &log_dir)
        }
        Kind::Systemd => systemd_plan(program, &unit_dir(env)?),
        Kind::Unsupported => Ok(Plan {
            kind,
            definitions: Vec::new(),
        }),
    }
}

pub(crate) fn live_plan() -> Result<Plan, &'static str> {
    let program = std::env::current_exe().map_err(|_| "update_program_path_unsupported")?;
    plan_for(Kind::current(), &program, &|name| std::env::var(name).ok())
}

pub(crate) fn live_state() -> &'static str {
    live_plan().map_or("unknown", |plan| state(&plan))
}

pub(crate) fn enable_live() -> Result<(Enabled, &'static str), &'static str> {
    let plan = live_plan()?;
    let enabled = enable(&plan, &SystemManager, &launchd_domain(), systemctl())?;
    Ok((enabled, plan.kind.name()))
}

pub(crate) fn disable_live() -> Result<bool, &'static str> {
    let plan = live_plan()?;
    disable(&plan, &SystemManager, &launchd_domain(), systemctl())
}
