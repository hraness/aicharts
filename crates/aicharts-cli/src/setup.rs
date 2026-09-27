//! `aicharts setup`: the guided first-run path for publishing.
//!
//! Steps, each idempotent so a re-run continues where a previous attempt
//! stopped:
//!
//! 1. Private key (`keygen`) at `--key-file` (default `~/.aicharts/key`)
//! 2. Local ledger (`init`) at `--state-dir` (default `~/.aicharts/state`)
//! 3. Account connection (`enroll`) — one browser approval
//! 4. Background collector (`service install`) — after the login-item
//!    pre-prompt, never before
//!
//! Nothing uploads during setup; the collector's first publish happens on
//! its own schedule after the next login. Enrollment and the agent are
//! macOS-only; on other systems setup stops after the local steps with the
//! report naming what remains.

use std::path::{Path, PathBuf};

use aicharts_protocol::Provider;

use crate::service;
use hraness_cli_kit::{audience, Audience, Style, Symbol};

const DEFAULTS_DIR: &str = ".aicharts";

#[derive(Debug)]
pub(crate) struct SetupOptions {
    pub(crate) state_dir: PathBuf,
    pub(crate) key_file: PathBuf,
    pub(crate) sources: Vec<(Provider, PathBuf)>,
    pub(crate) publish_config: Option<PathBuf>,
    pub(crate) json: bool,
}

fn default_key_file(home: &Path) -> PathBuf {
    home.join(DEFAULTS_DIR).join("checkpoint.key")
}

fn default_state_dir(home: &Path) -> PathBuf {
    home.join(DEFAULTS_DIR).join("state")
}

fn parse(args: &[String], home: &Path) -> Result<SetupOptions, &'static str> {
    let mut state_dir = None;
    let mut key_file = None;
    let mut publish_config = None;
    let mut sources: Vec<(Provider, PathBuf)> = vec![];
    let mut json = false;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--json" if !json => json = true,
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
    if sources.is_empty() {
        return Err("explicit_source_required");
    }
    if sources.len() > 128 {
        return Err("too_many_sources");
    }
    let state_dir = state_dir.unwrap_or_else(|| default_state_dir(home));
    let key_file = key_file.unwrap_or_else(|| default_key_file(home));
    if !state_dir.is_absolute()
        || !key_file.is_absolute()
        || sources.iter().any(|(_, path)| !path.is_absolute())
        || publish_config
            .as_ref()
            .is_some_and(|path| !path.is_absolute())
    {
        return Err("invalid_option");
    }
    Ok(SetupOptions {
        state_dir,
        key_file,
        sources,
        publish_config,
        json,
    })
}

/// A usable private key: our own file, exactly 32 bytes, owner-only.
fn key_ready(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::symlink_metadata(path).is_ok_and(|meta| {
            meta.is_file() && meta.len() == 32 && meta.permissions().mode() & 0o777 == 0o600
        })
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        false
    }
}

/// A ledger already exists when `init` wrote its database file.
fn ledger_ready(state_dir: &Path) -> bool {
    state_dir.join("usage.sqlite3").is_file()
}

/// Creates the key's parent folders owner-only on unix (`~/.aicharts`
/// holds private key material). Existing folders keep their modes.
fn create_private_dirs(path: &Path) -> Result<(), &'static str> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = std::fs::DirBuilder::new();
        builder.recursive(true).mode(0o700);
        builder.create(path).map_err(|_| "key_create_failed")
    }
    #[cfg(not(unix))]
    {
        std::fs::create_dir_all(path).map_err(|_| "key_create_failed")
    }
}

/// This Mac is already on an account when the enrolled join resolves.
#[cfg(target_os = "macos")]
fn enrolled(dir: &Path) -> bool {
    crate::enrollment::enrolled(dir).is_ok()
}

#[cfg(not(target_os = "macos"))]
fn enrolled(_dir: &Path) -> bool {
    false
}

fn step(style: Style, name: &str, detail: &str) -> String {
    format!("{} {name}\n     {detail}\n", style.symbol(Symbol::Ok))
}

fn run_command(args: Vec<String>) -> Result<String, &'static str> {
    crate::run(&args)
}

/// Runs setup. Steps that touch macOS-only authority (enrollment, the
/// LaunchAgent) return the platform's fixed refusal on other systems.
pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    if let Some(crate::help::Help::Page(page)) = crate::help::resolve(args) {
        return Ok(page);
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|home| home.is_absolute())
        .ok_or("home_required")?;
    let options = parse(args, &home)?;
    let audience = audience::detect_current();
    let style = Style::stderr();
    let mut steps: Vec<(&'static str, &'static str)> = vec![];

    // 1. Key. `keygen` never overwrites, so a reused key is reported, not
    // re-created.
    if key_ready(&options.key_file) {
        steps.push(("key", "present"));
    } else {
        if let Some(parent) = options.key_file.parent() {
            create_private_dirs(parent)?;
        }
        run_command(vec![
            "keygen".to_owned(),
            "--output".to_owned(),
            options.key_file.to_string_lossy().into_owned(),
        ])?;
        steps.push(("key", "created"));
    }

    // 2. Ledger. `init` is a one-time write; a present database is kept.
    if ledger_ready(&options.state_dir) {
        steps.push(("ledger", "present"));
    } else {
        run_command(vec![
            "init".to_owned(),
            "--state-dir".to_owned(),
            options.state_dir.to_string_lossy().into_owned(),
            "--key-file".to_owned(),
            options.key_file.to_string_lossy().into_owned(),
        ])?;
        steps.push(("ledger", "created"));
    }

    // 3. Enrollment. `enroll` runs the sealed pairing flow itself; when the
    // Mac is already on the account, the step is a no-op.
    if enrolled(&options.state_dir) {
        steps.push(("account", "connected"));
    } else {
        run_command(vec![
            "enroll".to_owned(),
            "--state-dir".to_owned(),
            options.state_dir.to_string_lossy().into_owned(),
        ])?;
        steps.push(("account", "connected"));
    }

    // 4. Collector. The pre-prompt comes before the file, never after.
    let program = std::env::current_exe().map_err(|_| "service_unwritable")?;
    let status_file = home.join(DEFAULTS_DIR).join("collector-status.json");
    let plan = service::plan(
        &program,
        &home,
        &options.state_dir,
        &options.key_file,
        &options.sources,
        options.publish_config.as_deref(),
        &status_file,
    )?;
    if audience == Audience::Human && !options.json {
        eprint!("{}", service::pre_prompt(audience, style));
    }
    let change = service::install(&plan)?;
    steps.push(("collector", change));

    if options.json {
        let rows: Vec<serde_json::Value> = steps
            .iter()
            .map(|(name, result)| serde_json::json!({ "step": name, "result": result }))
            .collect();
        Ok(format!(
            "{}\n",
            serde_json::json!({
                "schemaVersion": 1,
                "operation": "setup",
                "stateDir": options.state_dir,
                "steps": rows,
            })
        ))
    } else {
        let detail = |name: &str, result: &str| -> &'static str {
            match (name, result) {
                ("key", "present") => "your private key is ready (already done)",
                ("key", _) => "your private key is ready",
                ("ledger", "present") => "your local usage ledger is ready (already done)",
                ("ledger", _) => "your local usage ledger is ready",
                ("account", _) => "this Mac is connected to your AI Charts account",
                ("collector", "unchanged") => {
                    "the collector runs every 15 minutes at login (already done)"
                }
                ("collector", "updated") => {
                    "the collector runs every 15 minutes at login (updated)"
                }
                ("collector", _) => "the collector runs every 15 minutes at login",
                _ => "done",
            }
        };
        let mut text = String::from("AI Charts is set up.\n");
        for (name, result) in &steps {
            text.push_str(&step(style, name, detail(name, result)));
        }
        text.push_str(
            "\nNothing was uploaded during setup. The collector publishes on its own schedule after your next login.\nSee what runs: aicharts service status · What it sends: aicharts outbox --help\n",
        );
        Ok(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn parse_uses_private_defaults() {
        let options = parse(
            &args(&["setup", "--claude", "/claude/projects"]),
            Path::new("/home/me"),
        )
        .unwrap();
        assert_eq!(options.state_dir, PathBuf::from("/home/me/.aicharts/state"));
        assert_eq!(
            options.key_file,
            PathBuf::from("/home/me/.aicharts/checkpoint.key")
        );
        assert_eq!(options.sources.len(), 1);
    }

    #[test]
    fn parse_requires_a_source_and_absolute_paths() {
        assert_eq!(
            parse(&args(&["setup"]), Path::new("/home/me")).unwrap_err(),
            "explicit_source_required"
        );
        assert_eq!(
            parse(
                &args(&["setup", "--state-dir", "relative", "--claude", "/c"]),
                Path::new("/home/me"),
            )
            .unwrap_err(),
            "invalid_option"
        );
    }

    #[cfg(unix)]
    #[test]
    fn key_readiness_needs_an_owner_only_32_byte_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("aicharts-setup-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let key = dir.join("key");
        assert!(!key_ready(&key));
        std::fs::write(&key, vec![7u8; 32]).unwrap();
        std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!key_ready(&key));
        std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(key_ready(&key));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
