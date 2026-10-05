//! Verified binary replacement for `aicharts update`.
//!
//! The pipeline is: digest-check the downloaded archive, extract only
//! `bin/aicharts` through the system `tar`, require the macOS Developer ID
//! signature on that platform, run the candidate's own `--version` against
//! the released version, then rename the staged file over the running
//! executable. Every step precedes the swap, so a failure leaves the
//! installed binary untouched.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::release::Version;

const MACOS_REQUIREMENT: &str = "anchor apple generic and identifier \"dev.hraness.aicharts\" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"8AAP53VTW3\"";

struct Scratch(PathBuf);

impl Scratch {
    fn create() -> Result<Self, &'static str> {
        let base = std::env::temp_dir().join(format!("aicharts-update-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir(&base).map_err(|_| "update_scratch_unwritable")?;
        Ok(Self(base))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn tar_extract(archive: &Path, member: &str, into: &Path) -> Result<(), &'static str> {
    let status = Command::new("tar")
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(into)
        .arg("--")
        .arg(member)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|_| "update_extract_failed")?;
    if !status.success() {
        return Err("update_extract_failed");
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn require_signature(candidate: &Path) -> Result<(), &'static str> {
    let status = Command::new("/usr/bin/codesign")
        .arg("--verify")
        .arg("--strict")
        .arg("--all-architectures")
        .arg("--test-requirement")
        .arg(format!("={MACOS_REQUIREMENT}"))
        .arg(candidate)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|_| "update_signature_unavailable")?;
    if !status.success() {
        return Err("update_signature_invalid");
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn require_signature(_candidate: &Path) -> Result<(), &'static str> {
    Ok(())
}

/// The downloaded candidate must answer `--version` with the released version.
fn require_reports(candidate: &Path, version: &Version) -> Result<(), &'static str> {
    let output = Command::new(candidate)
        .arg("--version")
        .env("HRANESS_SUPPORT_AUDIENCE", "off")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .map_err(|_| "update_candidate_failed")?;
    if !output.status.success() {
        return Err("update_candidate_failed");
    }
    let expected = format!("aicharts {}", version.text());
    let first = output
        .stdout
        .split(|b| *b == b'\n')
        .next()
        .unwrap_or_default();
    let text = std::str::from_utf8(first).map_err(|_| "update_version_mismatch")?;
    if text != expected && !text.starts_with(&format!("{expected} ")) {
        return Err("update_version_mismatch");
    }
    Ok(())
}

/// Stage the verified `binary` next to `exe` and rename it over. The staged
/// file lives on the same filesystem, so the rename is atomic.
fn swap(candidate: &Path, exe: &Path) -> Result<(), &'static str> {
    let staged = exe.with_file_name(format!(".aicharts-update-{}", std::process::id()));
    fs::copy(candidate, &staged).map_err(|_| "update_replace_failed")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&staged, fs::Permissions::from_mode(0o755))
            .map_err(|_| "update_replace_failed")?;
    }
    if fs::rename(&staged, exe).is_err() {
        let _ = fs::remove_file(&staged);
        return Err("update_replace_failed");
    }
    Ok(())
}

/// Install `archive` (already digest-checked) over the current executable.
pub(crate) fn install(
    archive: &[u8],
    archive_root: &str,
    version: &Version,
) -> Result<(), &'static str> {
    let exe = std::env::current_exe().map_err(|_| "update_replace_failed")?;
    let exe_meta = fs::metadata(&exe).map_err(|_| "update_replace_failed")?;
    if !exe_meta.is_file() {
        return Err("update_replace_failed");
    }
    let scratch = Scratch::create()?;
    let archive_path = scratch.0.join("release.tar.gz");
    fs::File::create(&archive_path)
        .and_then(|mut file| file.write_all(archive))
        .map_err(|_| "update_scratch_unwritable")?;
    let member = format!("{archive_root}/bin/aicharts");
    tar_extract(&archive_path, &member, &scratch.0)?;
    let candidate = scratch.0.join(&member);
    let meta = fs::symlink_metadata(&candidate).map_err(|_| "update_extract_failed")?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err("update_extract_failed");
    }
    require_signature(&candidate)?;
    require_reports(&candidate, version)?;
    swap(&candidate, &exe)
}
