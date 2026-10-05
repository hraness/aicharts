//! `aicharts update`: check GitHub for a newer `cli-v*` release and install it.
//!
//! `aicharts update` downloads the newest release's checksum file and archive,
//! verifies the archive's SHA-256, checks the macOS Developer ID signature on
//! that platform, runs the candidate's `--version`, and only then replaces the
//! running binary atomically. `aicharts update enable` installs a daily
//! launchd/systemd check and `aicharts update disable` removes it; the
//! installer turns the check on unless `AICHARTS_AUTO_UPDATE=no`.
//!
//! The released bytes carry the review weight: a wrong download cannot pass
//! the release's own digest, and on macOS it must also be the signed,
//! notarized build. Nothing uploads; the only requests are reads of the
//! public GitHub release.

use sha2::{Digest, Sha256};

mod apply;
mod fetch;
mod release;
mod schedule;

#[cfg(test)]
mod tests;

/// Compressed CLI archives are capped at 64 MiB by the release manifest.
const ARCHIVE_CAP: usize = 64 * 1024 * 1024;
/// `/releases?per_page=20` is far under this.
const LIST_CAP: usize = 1024 * 1024;
/// `SHA256SUMS` and the macOS sidecar are a few hundred bytes.
const SUMS_CAP: usize = 8 * 1024;

fn target_error() -> &'static str {
    match std::env::consts::OS {
        "macos" | "linux" => "update_platform_unsupported",
        _ => "update_requires_unix",
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Action {
    /// Report only.
    Check,
    /// Check, then install when newer.
    Apply,
    /// Same as Apply, invoked by the scheduler: plain output, no styling.
    Scheduled,
}

struct Latest {
    version: release::Version,
}

fn fetch_latest() -> Result<Latest, &'static str> {
    let body =
        fetch::get(release::RELEASES_URL, LIST_CAP).map_err(|_| "update_check_unavailable")?;
    let version = release::newest_release(&body)?.ok_or("update_release_not_found")?;
    Ok(Latest { version })
}

fn fetch_and_verify(version: &release::Version) -> Result<Vec<u8>, &'static str> {
    let target = release::target_asset(version).ok_or_else(target_error)?;
    let base = format!("{}/cli-v{}", release::DOWNLOAD_BASE, version.text());
    let checksum_name = target.checksum_asset();
    let sums = fetch::get(&format!("{base}/{checksum_name}"), SUMS_CAP)
        .map_err(|_| "update_check_unavailable")?;
    let expected = if target.macos {
        release::sidecar_digest(&sums, &target.archive)
    } else {
        release::checksum_for(&sums, &target.archive)
    }
    .ok_or("update_checksum_missing")?;
    let archive = fetch::get(&format!("{base}/{}", target.archive), ARCHIVE_CAP)
        .map_err(|_| "update_download_unavailable")?;
    let digest = Sha256::digest(&archive)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if digest != expected {
        return Err("update_checksum_mismatch");
    }
    Ok(archive)
}

fn apply(version: &release::Version, archive: &[u8]) -> Result<(), &'static str> {
    let target = release::target_asset(version).ok_or_else(target_error)?;
    let root = target.archive.trim_end_matches(".tar.gz");
    apply::install(archive, root, version)
}

fn render_check(
    current: &release::Version,
    latest: &release::Version,
    action: &'static str,
    json: bool,
) -> Result<String, &'static str> {
    let scheduler = schedule::live_state();
    if json {
        return serde_json::to_string(&serde_json::json!({
            "schemaVersion": 1,
            "operation": "update",
            "current": current.text(),
            "latest": latest.text(),
            "action": action,
            "scheduler": scheduler,
        }))
        .map(|text| format!("{text}\n"))
        .map_err(|_| "update_encode_failed");
    }
    Ok(match action {
        "up-to-date" => format!("aicharts {} is the latest release.\n", current.text()),
        "newer" => format!(
            "aicharts {} is newer than the latest release ({}).\n",
            current.text(),
            latest.text()
        ),
        "applied" => format!("Updated aicharts {} → {}.\n", current.text(), latest.text()),
        _ => format!(
            "aicharts {} is available (you have {}). Run: aicharts update\n",
            latest.text(),
            current.text()
        ),
    })
}

fn run_check(action: Action, json: bool) -> Result<String, &'static str> {
    let current =
        release::Version::parse(env!("CARGO_PKG_VERSION")).ok_or("update_version_internal")?;
    let latest = fetch_latest()?;
    if latest.version < current {
        return render_check(&current, &latest.version, "newer", json);
    }
    if latest.version == current {
        return render_check(&current, &latest.version, "up-to-date", json);
    }
    if action == Action::Check {
        return render_check(&current, &latest.version, "available", json);
    }
    let archive = fetch_and_verify(&latest.version)?;
    apply(&latest.version, &archive)?;
    render_check(&current, &latest.version, "applied", json)
}

fn run(args: &[String]) -> Result<String, &'static str> {
    match args[1..].first().map(String::as_str) {
        Some("enable") => return run_toggle(&args[2..], true),
        Some("disable") => return run_toggle(&args[2..], false),
        Some("status") => return run_status(&args[2..]),
        _ => {}
    }
    let mut action = Action::Apply;
    let mut json = false;
    for flag in &args[1..] {
        match flag.as_str() {
            "--check" if action == Action::Apply => action = Action::Check,
            "--scheduled" if action == Action::Apply => action = Action::Scheduled,
            "--json" if !json => json = true,
            _ => return Err("invalid_option"),
        }
    }
    run_check(action, json)
}

fn run_toggle(args: &[String], enable: bool) -> Result<String, &'static str> {
    let json = match args {
        [] => false,
        [flag] if flag == "--json" => true,
        _ => return Err("invalid_option"),
    };
    if enable {
        let (enabled, kind) = schedule::enable_live()?;
        if json {
            return serde_json::to_string(&serde_json::json!({
                "schemaVersion": 1,
                "operation": "update-enable",
                "scheduler": kind,
                "activation": enabled.activation,
            }))
            .map(|text| format!("{text}\n"))
            .map_err(|_| "update_encode_failed");
        }
        return Ok(format!(
            "Daily aicharts updates are on ({kind}). Turn them off with: aicharts update disable\n"
        ));
    }
    let removed = schedule::disable_live()?;
    if json {
        return serde_json::to_string(&serde_json::json!({
            "schemaVersion": 1,
            "operation": "update-disable",
            "removed": removed,
        }))
        .map(|text| format!("{text}\n"))
        .map_err(|_| "update_encode_failed");
    }
    Ok(if removed {
        "Daily aicharts updates are off. Turn them back on with: aicharts update enable\n"
            .to_owned()
    } else {
        "Daily aicharts updates were already off.\n".to_owned()
    })
}

fn run_status(args: &[String]) -> Result<String, &'static str> {
    let json = match args {
        [] => false,
        [flag] if flag == "--json" => true,
        _ => return Err("invalid_option"),
    };
    let state = schedule::live_state();
    if json {
        return serde_json::to_string(&serde_json::json!({
            "schemaVersion": 1,
            "operation": "update-status",
            "scheduler": state,
            "current": env!("CARGO_PKG_VERSION"),
        }))
        .map(|text| format!("{text}\n"))
        .map_err(|_| "update_encode_failed");
    }
    Ok(match state {
        "on" => "Daily aicharts updates are on. Each check is verified before it installs.\n",
        "off" => "Daily aicharts updates are off. Turn them on with: aicharts update enable\n",
        other => {
            return Err(match other {
                "unsupported" => "update_scheduler_unavailable",
                "not-ours" => "update_not_ours",
                _ => "update_state_unknown",
            })
        }
    }
    .to_owned())
}

pub(crate) fn dispatch(args: &[String]) -> Result<String, &'static str> {
    run(args)
}

pub(crate) fn help() -> &'static str {
    "Usage: aicharts update [--check | --scheduled] [--json]
       aicharts update enable | disable | status [--json]

Check GitHub for a newer aicharts release and install it: the archive's
SHA-256 must match the digest the release itself published, the macOS build
must carry the Hraness Developer ID signature, and the new binary must
report the release's version before it replaces this one.

Options
  --check      Report without installing
  --scheduled  Quiet check-and-install for the daily scheduler
  --json       Machine-readable result

aicharts update enable installs a launchd agent (macOS) or systemd user
timer (Linux) that runs aicharts update --scheduled once a day and at
login. The installer turns this on; AICHARTS_AUTO_UPDATE=no opts out.
Each scheduled check is verified the same way before it installs."
}
