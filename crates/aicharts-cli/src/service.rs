//! `aicharts service install | uninstall | status`: the background
//! collector's LaunchAgent, `io.aicharts.daemon`.
//!
//! The service runs `aicharts daemon` every login: it collects token counts
//! every 15 minutes and, with `--publish-config`, publishes on its own
//! schedule. Install writes `~/Library/LaunchAgents/io.aicharts.daemon.plist`
//! (owner-only, marked so we can tell it from a hand-written file) and never
//! runs `launchctl`: the agent takes effect at the next login, the same
//! contract desktop-foundation's shared login-item helper follows.
//!
//! Before writing, a person at a terminal sees the macOS pre-prompt: the
//! "Background Items Added" notification names `aicharts`, not "AI Charts".

use std::path::{Path, PathBuf};

use aicharts_protocol::Provider;
use sha2::{Digest, Sha256};

use hraness_cli_kit::{audience, Audience, Style, Symbol};

/// The launchd label. Predates the `app.hraness.*` companion scheme: existing
/// hand-written agents use it, and Login Items already knows it.
const LABEL: &str = "io.aicharts.daemon";
const MAX_PLIST_BYTES: u64 = 64 * 1024;
const MAX_ARGS: usize = 64;
const MAX_ARG_BYTES: usize = 1024;

/// The notice a person sees *before* the agent file is written, so the
/// "Background Items Added" notification that follows is expected.
const PRE_PROMPT: &str = "macOS will show \"Background Items Added\" for aicharts. It only collects token counts every 15 minutes. Turn it off any time in System Settings › General › Login Items.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ServicePlan {
    pub(crate) label: String,
    pub(crate) path: PathBuf,
    pub(crate) contents: String,
}

/// What is on disk for the plan (mirrors the shared login-item states).
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ServiceState {
    /// Our file, exactly as planned.
    On,
    /// No file.
    Off,
    /// Our file, but it starts an older program or arguments. Installing
    /// again updates it.
    Outdated,
    /// A file this product did not write, or one someone edited.
    NotOurs,
    /// The file could not be read.
    Unknown,
}

fn xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn sha256_hex(body: &str) -> String {
    let digest = Sha256::digest(body.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// What the human gate shows for an install: the planned file's hash, so
/// the confirmation is bound to exactly these arguments.
pub(crate) fn plan_digest(plan: &ServicePlan) -> String {
    sha256_hex(&plan.contents)
}

/// The ownership line: a file without it, or with a hash that does not match
/// its body, was not written by `aicharts service`.
fn header(body: &str) -> String {
    format!(
        "<!-- aicharts service {LABEL} sha256:{} -->\n",
        sha256_hex(body)
    )
}

fn safe_value(value: &str) -> bool {
    !value.is_empty() && !value.chars().any(|ch| ch.is_control())
}

fn agents_dir(home: &Path) -> PathBuf {
    home.join("Library").join("LaunchAgents")
}

pub(crate) fn plist_path(home: &Path) -> PathBuf {
    agents_dir(home).join(format!("{LABEL}.plist"))
}

/// Renders the LaunchAgent for `daemon` running under `exe` at `home`.
/// Building it has no side effects.
pub(crate) fn plan(
    program: &Path,
    home: &Path,
    state_dir: &Path,
    key_file: &Path,
    sources: &[(Provider, PathBuf)],
    publish_config: Option<&Path>,
    status_file: &Path,
) -> Result<ServicePlan, &'static str> {
    let mut argv: Vec<String> = vec![
        "daemon".to_owned(),
        "--state-dir".to_owned(),
        state_dir.to_string_lossy().into_owned(),
        "--key-file".to_owned(),
        key_file.to_string_lossy().into_owned(),
    ];
    for (provider, path) in sources {
        argv.push(match provider {
            Provider::Codex => "--codex".to_owned(),
            Provider::ClaudeCode => "--claude".to_owned(),
            Provider::Devin => "--devin".to_owned(),
        });
        argv.push(path.to_string_lossy().into_owned());
    }
    if let Some(config) = publish_config {
        argv.push("--publish-config".to_owned());
        argv.push(config.to_string_lossy().into_owned());
    }
    argv.push("--status-file".to_owned());
    argv.push(status_file.to_string_lossy().into_owned());
    if argv.len() > MAX_ARGS
        || argv
            .iter()
            .any(|arg| arg.len() > MAX_ARG_BYTES || !safe_value(arg))
        || !home.is_absolute()
        || !program.is_absolute()
        || !safe_value(&program.to_string_lossy())
    {
        return Err("invalid_option");
    }
    let arguments: String = std::iter::once(program.to_string_lossy().into_owned())
        .chain(argv.iter().cloned())
        .map(|arg| format!("<string>{}</string>", xml(&arg)))
        .collect();
    let logs = home.join(".aicharts");
    // Standard, not Background: Background QoS throttles CPU and disk, and a
    // scan that takes minutes at normal priority then overruns its import and
    // cycle deadlines on a busy machine.
    let body = format!(
        "<plist version=\"1.0\"><dict>\n<key>Label</key><string>{}</string>\n<key>ProgramArguments</key><array>{arguments}</array>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n<key>ProcessType</key><string>Standard</string>\n<key>StandardOutPath</key><string>{}</string>\n<key>StandardErrorPath</key><string>{}</string>\n</dict></plist>\n",
        xml(LABEL),
        xml(&logs.join("daemon.out.log").to_string_lossy()),
        xml(&logs.join("daemon.err.log").to_string_lossy()),
    );
    Ok(ServicePlan {
        path: plist_path(home),
        contents: header(&body) + &body,
        label: LABEL.to_owned(),
    })
}

/// Reads the file the plan points at. `Some` is only returned when the file
/// carries a valid ownership line for its own body.
fn owned(path: &Path) -> Result<Option<String>, &'static str> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("service_unwritable"),
    };
    if !meta.is_file() || meta.len() > MAX_PLIST_BYTES {
        return Err("service_not_ours");
    }
    let text = std::fs::read_to_string(path).map_err(|_| "service_unwritable")?;
    let (first, body) = text.split_once('\n').ok_or("service_not_ours")?;
    if format!("{first}\n") != header(body) {
        return Err("service_not_ours");
    }
    Ok(Some(text))
}

/// Reads the current service state against a fully rendered plan. Only the
/// test suite renders a plan without installing, so this is test-only.
#[cfg(test)]
fn state(plan: &ServicePlan) -> Result<ServiceState, &'static str> {
    match owned(&plan.path) {
        Ok(Some(text)) if text == plan.contents => Ok(ServiceState::On),
        Ok(Some(_)) => Ok(ServiceState::Outdated),
        Ok(None) => Ok(ServiceState::Off),
        Err("service_not_ours") => Ok(ServiceState::NotOurs),
        _ => Ok(ServiceState::Unknown),
    }
}

/// Writes the agent (atomically, owner-only) and refuses to replace a file
/// this command did not write. Takes effect at the next login.
pub(crate) fn install(plan: &ServicePlan) -> Result<&'static str, &'static str> {
    if !cfg!(target_os = "macos") {
        return Err("service_requires_macos");
    }
    let parent = plan.path.parent().ok_or("invalid_option")?;
    if let Some(library) = parent.parent() {
        real_directory(library)?;
    }
    real_directory(parent)?;
    let existing = owned(&plan.path)?;
    if existing.as_deref() == Some(plan.contents.as_str()) {
        return Ok("unchanged");
    }
    #[cfg(unix)]
    let write = |temp: &Path| -> std::io::Result<()> {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(temp)?;
        file.write_all(plan.contents.as_bytes())?;
        file.sync_all()
    };
    #[cfg(not(unix))]
    let write = |_temp: &Path| -> std::io::Result<()> { Err(std::io::Error::other("unsupported")) };
    let temp = parent.join(format!(".{}.{}.tmp", plan.label, std::process::id()));
    if write(&temp).is_err() {
        let _ = std::fs::remove_file(&temp);
        return Err("service_unwritable");
    }
    // Re-check right before publishing, and create with a hard link (which
    // fails if a file appeared), so a file someone else wrote meanwhile is
    // never overwritten.
    let publish = || -> Result<(), &'static str> {
        if owned(&plan.path)? != existing {
            return Err("service_not_ours");
        }
        let result = if existing.is_none() {
            std::fs::hard_link(&temp, &plan.path)
        } else {
            std::fs::rename(&temp, &plan.path)
        };
        result.map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "service_not_ours"
            } else {
                "service_unwritable"
            }
        })
    };
    let published = publish();
    let _ = std::fs::remove_file(&temp);
    published?;
    Ok(if existing.is_some() {
        "updated"
    } else {
        "created"
    })
}

/// Removes the agent when it is ours. Does not stop a running pass.
pub(crate) fn uninstall(plan: &ServicePlan) -> Result<bool, &'static str> {
    if !cfg!(target_os = "macos") {
        return Err("service_requires_macos");
    }
    let current = owned(&plan.path)?;
    if current.is_some() {
        std::fs::remove_file(&plan.path).map_err(|_| "service_unwritable")?;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn real_directory(path: &Path) -> Result<(), &'static str> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => Ok(()),
        Ok(_) => Err("service_unwritable"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut builder = std::fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder.create(path).map_err(|_| "service_unwritable")
        }
        Err(_) => Err("service_unwritable"),
    }
}

/// The pre-install line for the current audience. Agents keep the fixed
/// `aicharts:` prefix; people get the same words as a notice.
pub(crate) fn pre_prompt(audience: Audience, style: Style) -> String {
    match audience {
        Audience::Human => format!("{} {PRE_PROMPT}\n", style.symbol(Symbol::Next)),
        Audience::Agent | Audience::Quiet => format!("aicharts: {PRE_PROMPT}\n"),
    }
}

struct InstallOptions {
    state_dir: PathBuf,
    key_file: PathBuf,
    sources: Vec<(Provider, PathBuf)>,
    publish_config: Option<PathBuf>,
}

fn parse_sources(args: &[String], json: &mut bool) -> Result<InstallOptions, &'static str> {
    let mut state_dir = None;
    let mut key_file = None;
    let mut publish_config = None;
    let mut sources: Vec<(Provider, PathBuf)> = vec![];
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--json" => *json = true,
            flag @ ("--state-dir" | "--key-file" | "--codex" | "--claude" | "--devin"
            | "--publish-config") => {
                let value = args
                    .get(i + 1)
                    .filter(|value| !value.is_empty())
                    .ok_or("missing_option_value")?;
                match flag {
                    "--state-dir" if state_dir.is_none() => state_dir = Some(PathBuf::from(value)),
                    "--key-file" if key_file.is_none() => key_file = Some(PathBuf::from(value)),
                    "--codex" => sources.push((Provider::Codex, PathBuf::from(value))),
                    "--claude" => sources.push((Provider::ClaudeCode, PathBuf::from(value))),
                    "--devin" => sources.push((Provider::Devin, PathBuf::from(value))),
                    "--publish-config" if publish_config.is_none() => {
                        publish_config = Some(PathBuf::from(value))
                    }
                    _ => return Err("invalid_option"),
                }
                i += 1;
            }
            _ => return Err("invalid_option"),
        }
        i += 1;
    }
    Ok(InstallOptions {
        state_dir: state_dir.ok_or("state_directory_required")?,
        key_file: key_file.ok_or("key_required")?,
        publish_config,
        sources,
    })
}

fn plan_for(args: &[String], home: &Path) -> Result<(ServicePlan, bool), &'static str> {
    // args = ["service", "install", ...options]
    let mut json = false;
    let options = parse_sources(&args[2..], &mut json)?;
    if options.sources.is_empty() {
        return Err("explicit_source_required");
    }
    if !options.state_dir.is_absolute() || !options.key_file.is_absolute() {
        return Err("invalid_option");
    }
    if options
        .publish_config
        .as_ref()
        .is_some_and(|path| !path.is_absolute())
        || options.sources.iter().any(|(_, path)| !path.is_absolute())
    {
        return Err("invalid_option");
    }
    let program = std::env::current_exe().map_err(|_| "service_unwritable")?;
    let status_file = home.join(".aicharts").join("collector-status.json");
    let plan = plan(
        &program,
        home,
        &options.state_dir,
        &options.key_file,
        &options.sources,
        options.publish_config.as_deref(),
        &status_file,
    )?;
    Ok((plan, json))
}

/// Runs the human gate for a `decide` verb and exits with its status (3)
/// when no person confirmed. Nothing has been written at that point.
pub(crate) fn gate_or_exit(
    path: &[&str],
    args: &[String],
    json: bool,
    title: &str,
    digest: &str,
    before_prompt: impl FnOnce(),
) {
    if let Err(code) =
        crate::control::require_decision(path, args, json, title, digest, before_prompt)
    {
        std::process::exit(code);
    }
}

/// `aicharts service status` reads any state; install and uninstall are
/// macOS-only because launchd is the only qualified scheduler here.
pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    if let Some(crate::help::Help::Page(page)) = crate::help::resolve(args) {
        return Ok(page);
    }
    let rest = &args[1..];
    let command = rest
        .first()
        .map(String::as_str)
        .ok_or("service_command_required")?;
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|home| home.is_absolute())
        .ok_or("home_required")?;
    let json = rest.iter().skip(1).any(|arg| arg == "--json");
    let audience = audience::detect_current();
    let style = Style::stderr();
    match command {
        "install" => {
            let (service_plan, install_json) = plan_for(args, &home)?;
            // A `decide` verb: a login item is persistent configuration,
            // so a person confirms it at their own terminal (plan D-5).
            gate_or_exit(
                &["service", "install"],
                args,
                install_json,
                &format!(
                    "Run the aicharts collector at login ({}).",
                    service_plan.path.display()
                ),
                &plan_digest(&service_plan),
                || eprint!("{}", pre_prompt(audience, style)),
            );
            let change = install(&service_plan)?;
            Ok(if install_json {
                format!(
                    "{{\"schemaVersion\":1,\"operation\":\"service-install\",\"label\":\"{LABEL}\",\"change\":\"{change}\"}}\n"
                )
            } else {
                match change {
                    "unchanged" => String::from(
                        "The background collector is already set up exactly as planned. It takes effect at the next login.\n",
                    ),
                    "updated" => String::from(
                        "Updated the background collector's login entry. It takes effect at the next login.\n",
                    ),
                    _ => String::from(
                        "Set up the background collector. It starts at your next login and collects every 15 minutes.\n",
                    ),
                }
            })
        }
        "uninstall" => {
            if rest.len() > 2 || (rest.len() == 2 && !json) {
                return Err("invalid_option");
            }
            let service_plan = ServicePlan {
                label: LABEL.to_owned(),
                path: plist_path(&home),
                contents: String::new(),
            };
            // Nothing to remove needs no decision.
            if std::fs::symlink_metadata(&service_plan.path).is_ok() {
                gate_or_exit(
                    &["service", "uninstall"],
                    args,
                    json,
                    &format!(
                        "Stop running the aicharts collector at login ({}).",
                        service_plan.path.display()
                    ),
                    &sha256_hex(&service_plan.path.to_string_lossy()),
                    || {},
                );
            }
            match uninstall(&service_plan)? {
                true => Ok(String::from(
                    "Removed the background collector. The agent stops at the next login; nothing was deleted.\n",
                )),
                false => Ok(String::from("No background collector was set up.\n")),
            }
        }
        "status" => {
            if rest.len() > 2 || (rest.len() == 2 && !json) {
                return Err("invalid_option");
            }
            // Status does not need the daemon arguments: reading the file
            // alone cannot prove it matches a plan, so report presence and
            // ownership instead.
            let path = plist_path(&home);
            let observed = match owned(&path) {
                Ok(Some(_)) => ServiceState::On,
                Ok(None) => ServiceState::Off,
                Err("service_not_ours") => ServiceState::NotOurs,
                Err(_) => ServiceState::Unknown,
            };
            let name = match observed {
                ServiceState::On => "on",
                ServiceState::Off => "off",
                ServiceState::NotOurs => "not-ours",
                ServiceState::Outdated | ServiceState::Unknown => "unknown",
            };
            if json {
                Ok(format!(
                    "{{\"schemaVersion\":1,\"operation\":\"service-status\",\"label\":\"{LABEL}\",\"state\":\"{name}\"}}\n"
                ))
            } else {
                Ok(match observed {
                    ServiceState::On => "The background collector is set up for login.\n".to_owned(),
                    ServiceState::Off => "No background collector is set up.\n".to_owned(),
                    ServiceState::NotOurs => format!(
                        "A file named {LABEL}.plist exists that aicharts did not write; it is left alone.\n"
                    ),
                    _ => "Couldn't read the background collector's login entry.\n".to_owned(),
                })
            }
        }
        _ => Err("invalid_option"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    fn temp_home(name: &str) -> PathBuf {
        let home =
            std::env::temp_dir().join(format!("aicharts-service-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        home
    }

    fn sample_plan(home: &Path) -> ServicePlan {
        plan(
            Path::new("/usr/local/bin/aicharts"),
            home,
            Path::new("/private/state"),
            Path::new("/private/key"),
            &[(Provider::ClaudeCode, PathBuf::from("/private/claude"))],
            None,
            Path::new("/private/status.json"),
        )
        .unwrap()
    }

    #[test]
    fn plan_renders_the_daemon_agent() {
        let home = temp_home("render");
        let service_plan = sample_plan(&home);
        assert_eq!(service_plan.label, "io.aicharts.daemon");
        assert_eq!(
            service_plan.path,
            home.join("Library/LaunchAgents/io.aicharts.daemon.plist")
        );
        for needle in [
            "<key>Label</key><string>io.aicharts.daemon</string>",
            "<string>daemon</string>",
            "<string>--claude</string>",
            "<key>RunAtLoad</key><true/>",
            "<key>KeepAlive</key><true/>",
            "<key>ProcessType</key><string>Standard</string>",
            "daemon.err.log",
            "<!-- aicharts service io.aicharts.daemon sha256:",
        ] {
            assert!(service_plan.contents.contains(needle), "{needle}");
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn plan_refuses_relative_and_control_values() {
        assert_eq!(
            plan(
                Path::new("aicharts"),
                Path::new("/h"),
                Path::new("/s"),
                Path::new("/k"),
                &[(Provider::Codex, PathBuf::from("/c"))],
                None,
                Path::new("/st"),
            )
            .unwrap_err(),
            "invalid_option"
        );
        assert_eq!(
            plan(
                Path::new("/bin/aicharts"),
                Path::new("home"),
                Path::new("/s"),
                Path::new("/k"),
                &[(Provider::Codex, PathBuf::from("/c"))],
                None,
                Path::new("/st"),
            )
            .unwrap_err(),
            "invalid_option"
        );
        assert_eq!(
            plan(
                Path::new("/bin/aicharts"),
                Path::new("/h"),
                Path::new("/s"),
                Path::new("/k"),
                &[(Provider::Codex, PathBuf::from("/c\nnewline"))],
                None,
                Path::new("/st"),
            )
            .unwrap_err(),
            "invalid_option"
        );
    }

    #[test]
    fn state_distinguishes_on_off_outdated_and_foreign() {
        let home = temp_home("state");
        let service_plan = sample_plan(&home);
        assert_eq!(state(&service_plan).unwrap(), ServiceState::Off);
        std::fs::create_dir_all(service_plan.path.parent().unwrap()).unwrap();
        // Hand-written agents (like the docs' old recipes) are not ours.
        std::fs::write(
            &service_plan.path,
            "<plist><dict>handwritten</dict></plist>\n",
        )
        .unwrap();
        assert_eq!(state(&service_plan).unwrap(), ServiceState::NotOurs);
        // Ours, but older than this plan.
        std::fs::write(
            &service_plan.path,
            header("<plist><dict>older</dict></plist>\n") + "<plist><dict>older</dict></plist>\n",
        )
        .unwrap();
        assert_eq!(state(&service_plan).unwrap(), ServiceState::Outdated);
        // Exactly ours.
        std::fs::write(&service_plan.path, &service_plan.contents).unwrap();
        assert_eq!(state(&service_plan).unwrap(), ServiceState::On);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn pre_prompt_matches_the_audience() {
        let human = pre_prompt(
            Audience::Human,
            Style {
                color: false,
                ascii: false,
            },
        );
        assert!(human.contains("Background Items Added"), "{human}");
        assert!(
            human.contains("System Settings › General › Login Items"),
            "{human}"
        );
        assert!(human.contains("every 15 minutes"), "{human}");
        let agent = pre_prompt(
            Audience::Agent,
            Style {
                color: false,
                ascii: false,
            },
        );
        assert!(agent.starts_with("aicharts: "), "{agent}");
    }

    #[test]
    fn parse_for_args_checks_sources() {
        let home = Path::new("/h");
        assert_eq!(
            plan_for(
                &args(&[
                    "service",
                    "install",
                    "--state-dir",
                    "/s",
                    "--key-file",
                    "/k"
                ]),
                home
            )
            .unwrap_err(),
            "explicit_source_required"
        );
        assert_eq!(
            plan_for(
                &args(&["service", "install", "--key-file", "/k", "--claude", "/c"]),
                home
            )
            .unwrap_err(),
            "state_directory_required"
        );
        assert_eq!(
            plan_for(
                &args(&[
                    "service",
                    "install",
                    "--state-dir",
                    "/s",
                    "--key-file",
                    "/k",
                    "--claude",
                    "rel"
                ]),
                home,
            )
            .unwrap_err(),
            "invalid_option"
        );
    }

    #[test]
    fn json_status_reports_fixed_fields() {
        let home = temp_home("status");
        std::fs::create_dir_all(&home).unwrap();
        let path = plist_path(&home);
        assert_eq!(owned(&path).unwrap(), None);
        let _ = std::fs::remove_dir_all(&home);
    }
}
