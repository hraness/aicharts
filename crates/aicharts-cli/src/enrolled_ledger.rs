//! Resolve the account-bound occurrence key for a `--state-dir` ledger and
//! provision the split-key database inside an existing enrollment anchor.
//!
//! A custody-verified enrollment supplies the namespace key from macOS
//! credential custody, never a file; an unenrolled directory keeps the legacy
//! single-key identity or an explicit `--occurrence-key-file`. An unfinished,
//! revoked or inconsistent enrollment record refuses closed and never falls
//! back to the legacy identity silently. Secret preimages stay borrow-only:
//! the returned bytes feed the ledger identity and source parser, never logs,
//! output or durable records.

use aicharts_ledger::{Ledger, LedgerIdentity};
use std::fs::{self, File};
use std::path::Path;

/// The durable attempt layout name committed by the enrollment store. This
/// probe only chooses between resolution paths; it never grants identity.
const ATTEMPT_LAYOUT: &str = "enrollment-attempt-v1";

/// The ledger's private durable file names inside one state directory. An
/// enrolled initialization may not proceed while any of them exists.
const LEDGER_FILES: [&str; 4] = [
    "usage.sqlite3",
    "usage.sqlite3-journal",
    "usage.sqlite3-wal",
    "usage.sqlite3-shm",
];
const LEDGER_MAIN: &str = "usage.sqlite3";

/// Resolve the occurrence half of the ledger identity for `dir`. `Some` bytes
/// are the split-key namespace key — custody-held for an enrolled directory or
/// file-held for an explicit unenrolled choice. `None` selects the legacy
/// single-key identity.
pub(crate) fn resolve(
    dir: &Path,
    explicit_occurrence_key: Option<&Path>,
) -> Result<Option<[u8; 32]>, &'static str> {
    choose(enrolled_occurrence(dir)?, explicit_occurrence_key)
}

/// An explicit occurrence key file is valid only when the directory is not
/// enrolled; the enrolled account key lives in custody and is never a file.
/// Reading the file happens only after the enrollment check clears it.
fn choose(
    enrolled: Option<[u8; 32]>,
    explicit: Option<&Path>,
) -> Result<Option<[u8; 32]>, &'static str> {
    match (enrolled, explicit) {
        (Some(_), Some(_)) => Err("occurrence_key_file_conflicts_with_enrollment"),
        (Some(key), None) => Ok(Some(key)),
        (None, Some(path)) => crate::read_key(path).map(Some),
        (None, None) => Ok(None),
    }
}

/// macOS resolves the completed, custody-verified enrollment join and copies
/// the exact namespace record's key bytes into caller scope. A missing attempt
/// layout is the only unenrolled answer; every committed-but-unverified or
/// inconsistent state refuses with the enrollment seam's own fixed code.
#[cfg(target_os = "macos")]
fn enrolled_occurrence(dir: &Path) -> Result<Option<[u8; 32]>, &'static str> {
    if !attempt_layout_present(dir) {
        return Ok(None);
    }
    // The anchor contract is absolute: canonicalize the same way the ledger
    // resolves its parent before any custody effect.
    let dir = fs::canonicalize(dir).map_err(|_| "attempt_recovery_required")?;
    match crate::enrollment::enrolled(&dir) {
        Ok(enrolled) => enrolled
            .namespace
            .with_namespace_key(|key| *key)
            .map(Some)
            .map_err(|_| "attempt_custody"),
        // The attempt layout exists but committed no record: an interrupted
        // anchor is recovery state, not an unenrolled directory.
        Err("attempt_missing") => Err("attempt_recovery_required"),
        Err(code) => Err(code),
    }
}

/// Non-macOS platforms have no qualified credential custody, so an enrollment
/// layout can never resolve to a namespace key; it refuses rather than
/// silently downgrading the directory to the legacy identity.
#[cfg(not(target_os = "macos"))]
fn enrolled_occurrence(dir: &Path) -> Result<Option<[u8; 32]>, &'static str> {
    if attempt_layout_present(dir) {
        Err("persistent_state_requires_qualified_macos_custody")
    } else {
        Ok(None)
    }
}

/// Observational presence probe for the durable attempt layout. A directory,
/// a stray file or any other node all count; verification itself stays inside
/// the enrollment seam.
fn attempt_layout_present(dir: &Path) -> bool {
    fs::symlink_metadata(dir.join(ATTEMPT_LAYOUT)).is_ok()
}

/// Initialize the split-key ledger inside an existing custody-verified anchor.
/// `enroll` owns and pre-creates the state directory while the ledger
/// initializer rightly refuses to adopt any existing directory, so the
/// database is built in a private sibling staging directory and installed by
/// one atomic hard link. Nothing existing is overwritten, adopted or repaired.
pub(crate) fn initialize_in_anchor(
    dir: &Path,
    identity: &LedgerIdentity<'_>,
) -> Result<Ledger, &'static str> {
    for name in LEDGER_FILES {
        match fs::symlink_metadata(dir.join(name)) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err("ledger_private_state_required"),
        }
    }
    let mut staging_name = dir
        .file_name()
        .ok_or("ledger_private_state_required")?
        .to_os_string();
    staging_name.push(".aicharts-ledger-staging");
    let staging = dir
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
        .join(staging_name);
    // The ledger initializer itself refuses an existing staging directory, so
    // a foreign or leftover path fails closed and is never removed here.
    let created =
        Ledger::initialize_with_identity(&staging, identity).map_err(|error| error.code())?;
    drop(created);
    // From here the staging directory is provably this invocation's own.
    let installed = fs::hard_link(staging.join(LEDGER_MAIN), dir.join(LEDGER_MAIN))
        .map_err(|error| {
            // The link is atomic and never overwrites; an existing target is
            // already-initialized state, not something to replace.
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "ledger_private_state_required"
            } else {
                "ledger_storage_failed"
            }
        })
        .and_then(|()| {
            // Drop the staging copy so the installed file is single-link: the
            // ledger's private-file check refuses any alias.
            fs::remove_dir_all(&staging).map_err(|_| "ledger_storage_failed")
        })
        .and_then(|()| {
            // Persist the anchor's new directory entry before reporting success.
            File::open(dir)
                .and_then(|file| file.sync_all())
                .map_err(|_| "ledger_storage_failed")
        })
        .and_then(|()| Ledger::open_with_identity(dir, identity).map_err(|error| error.code()));
    // Best-effort removal of this invocation's own staging artifact. A remnant
    // still fails closed on the next attempt and is never adopted as state.
    let _ = fs::remove_dir_all(&staging);
    installed
}

#[cfg(test)]
#[path = "enrolled_ledger_tests.rs"]
mod tests;
