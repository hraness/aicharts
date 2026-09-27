//! `aicharts menubar install | uninstall | status | start`: runs the same
//! command in the installed AI Charts menu bar, so the hints the menu bar
//! prints (`aicharts menubar start`) work from any terminal.
//!
//! The menu bar owns its login item through desktop-foundation's shared
//! helper; this command only finds the installed binary and hands over.

use std::path::{Path, PathBuf};

const SUBCOMMANDS: &[&str] = &["install", "uninstall", "status", "start"];

/// Where `bun run menubar:install` puts the menu bar.
pub(crate) fn installed_binary(home: &Path) -> PathBuf {
    home.join("Library")
        .join("Application Support")
        .join("AI Charts")
        .join("bin")
        .join("aicharts-menubar")
}

/// A regular executable file that only its owner can change.
#[cfg(unix)]
fn usable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::symlink_metadata(path).is_ok_and(|meta| {
        let mode = meta.permissions().mode();
        meta.is_file() && mode & 0o111 != 0 && mode & 0o022 == 0
    })
}

#[cfg(not(unix))]
fn usable(_path: &Path) -> bool {
    false
}

/// Checks the arguments and returns the binary and the arguments to pass.
pub(crate) fn plan(
    args: &[String],
    home: Option<&Path>,
) -> Result<(PathBuf, Vec<String>), &'static str> {
    let rest = &args[1..];
    let command = rest
        .first()
        .map(String::as_str)
        .ok_or("menubar_command_required")?;
    if !SUBCOMMANDS.contains(&command) {
        return Err("invalid_option");
    }
    let flags = &rest[1..];
    if flags.len() > 1
        || flags.iter().any(|flag| flag != "--json")
        || (command == "start" && !flags.is_empty())
    {
        return Err("invalid_option");
    }
    let home = home
        .filter(|home| home.is_absolute())
        .ok_or("home_required")?;
    let binary = installed_binary(home);
    if !usable(&binary) {
        return Err("menubar_not_installed");
    }
    Ok((binary, rest.to_vec()))
}

pub(crate) fn run(args: &[String]) -> Result<String, &'static str> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let (binary, forwarded) = plan(args, home.as_deref())?;
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Only returns on failure.
        let _ = std::process::Command::new(&binary).args(&forwarded).exec();
        Err("menubar_start_failed")
    }
    #[cfg(not(unix))]
    {
        let _ = (binary, forwarded);
        Err("menubar_not_installed")
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn forwards_known_commands_to_the_installed_binary() {
        let home =
            std::env::temp_dir().join(format!("aicharts-menubar-cli-{}", std::process::id()));
        let binary = installed_binary(&home);
        assert_eq!(
            plan(&args(&["menubar", "status"]), Some(&home)).unwrap_err(),
            "menubar_not_installed"
        );
        std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
        std::fs::write(&binary, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
        let (path, forwarded) = plan(&args(&["menubar", "status", "--json"]), Some(&home)).unwrap();
        assert_eq!(path, binary);
        assert_eq!(forwarded, args(&["status", "--json"]));
        assert_eq!(
            plan(&args(&["menubar", "install"]), Some(&home)).unwrap().1,
            args(&["install"])
        );
        // Group-writable binaries are refused.
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o775)).unwrap();
        assert_eq!(
            plan(&args(&["menubar", "start"]), Some(&home)).unwrap_err(),
            "menubar_not_installed"
        );
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn refuses_unknown_commands_and_flags() {
        let home = Path::new("/nonexistent-home");
        assert_eq!(
            plan(&args(&["menubar"]), Some(home)).unwrap_err(),
            "menubar_command_required"
        );
        assert_eq!(
            plan(&args(&["menubar", "run"]), Some(home)).unwrap_err(),
            "invalid_option"
        );
        assert_eq!(
            plan(&args(&["menubar", "status", "--verbose"]), Some(home)).unwrap_err(),
            "invalid_option"
        );
        assert_eq!(
            plan(&args(&["menubar", "start", "--json"]), Some(home)).unwrap_err(),
            "invalid_option"
        );
        assert_eq!(
            plan(&args(&["menubar", "status"]), None).unwrap_err(),
            "home_required"
        );
    }
}
