//! Bounded nonsecret reference custody. The persistence backend is not qualified;
//! every public store operation fails before filesystem or Keychain access.
//! These records establish neither enrollment nor upload authorization.

mod codec;
#[cfg(test)]
#[path = "../references_tests.rs"]
mod tests;
// The reviewed state machine is compiled but deliberately has no production
// adapter until descriptor-bound permission/ACL persistence is qualified.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) mod engine;

// Real descriptor I/O is privately qualified; anchor discovery and the public
// Path facade remain closed. No caller can inject this backend through the API.
#[cfg(target_os = "macos")]
#[cfg_attr(not(test), allow(dead_code))]
mod macos;

use crate::{RecordIdentity, SecretRecord, Vault};
use sha2::{Digest, Sha256};
use std::{fmt, path::Path};

pub const MAX_ENTRIES: usize = 256;
pub const MAX_MANIFEST_BYTES: usize = 64 + MAX_ENTRIES * 160 + 32;
pub type Result<T> = std::result::Result<T, Error>;

/// Fixed failures contain no filesystem paths, item references, or native text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    BackendUnqualified,
    UnsupportedPlatform,
    InvalidManifest,
    InvalidInstallation,
    Missing,
    Conflict,
    StaleSnapshot,
    PendingOperation,
    NotPrepared,
    NotVerified,
    Limit,
    Busy,
    StorageUnavailable,
    RecoveryRequired,
    OutcomeUnknown,
    Custody(crate::Error),
}

impl Error {
    pub const fn code(self) -> &'static str {
        match self {
            Self::BackendUnqualified => "references_backend_unqualified",
            Self::UnsupportedPlatform => "references_unsupported_platform",
            Self::InvalidManifest => "references_invalid_manifest",
            Self::InvalidInstallation => "references_invalid_installation",
            Self::Missing => "references_missing",
            Self::Conflict => "references_conflict",
            Self::StaleSnapshot => "references_stale_snapshot",
            Self::PendingOperation => "references_pending_operation",
            Self::NotPrepared => "references_not_prepared",
            Self::NotVerified => "references_not_verified",
            Self::Limit => "references_limit",
            Self::Busy => "references_busy",
            Self::StorageUnavailable => "references_storage_unavailable",
            Self::RecoveryRequired => "references_recovery_required",
            Self::OutcomeUnknown => "references_outcome_unknown",
            Self::Custody(error) => error.code(),
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for Error {}

/// Local observation only. Neither state is a server grant or current vault proof.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReferenceState {
    Prepared,
    CustodyVerified,
}

/// Nonsecret original intent. Construction hashes the complete private record;
/// it does not retain or serialize secret material.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordIntent {
    identity: RecordIdentity,
    commitment: [u8; 32],
}

impl RecordIntent {
    pub fn from_record(record: &SecretRecord) -> Self {
        let bytes = record.encode();
        let mut digest = Sha256::new();
        digest.update(b"aicharts:custody-record:v1\0");
        digest.update(bytes.as_slice());
        Self {
            identity: record.identity().clone(),
            commitment: digest.finalize().into(),
        }
    }

    pub fn identity(&self) -> &RecordIdentity {
        &self.identity
    }

    /// This is a high-entropy-secret commitment, not an authentication signature.
    pub fn commitment(&self) -> &[u8; 32] {
        &self.commitment
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReferenceEntry {
    intent: RecordIntent,
    state: ReferenceState,
}
impl ReferenceEntry {
    pub fn intent(&self) -> &RecordIntent {
        &self.intent
    }
    pub fn state(&self) -> ReferenceState {
        self.state
    }
}

/// Compare-and-publish guard for one exact canonical committed manifest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ManifestToken {
    revision: u64,
    digest: [u8; 32],
}
impl ManifestToken {
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn digest(&self) -> &[u8; 32] {
        &self.digest
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestSnapshot {
    installation: [u8; 32],
    revision: u64,
    entries: Vec<ReferenceEntry>,
}
impl ManifestSnapshot {
    pub fn installation_id(&self) -> &[u8; 32] {
        &self.installation
    }
    pub fn entries(&self) -> &[ReferenceEntry] {
        &self.entries
    }
    pub fn token(&self) -> ManifestToken {
        let bytes = codec::encode(self);
        let mut digest = Sha256::new();
        digest.update(b"aicharts:credential-manifest-token:v1\0");
        digest.update(bytes);
        ManifestToken {
            revision: self.revision,
            digest: digest.finalize().into(),
        }
    }
}

/// Reserved facade for a future qualified private filesystem adapter.
/// No constructor succeeds in this source slice, including on macOS. There is
/// no public backend injection, byte import, verification setter, or fallback.
pub struct ReferenceStore {
    _private: (),
}

fn closed() -> Error {
    if cfg!(target_os = "macos") {
        Error::BackendUnqualified
    } else {
        Error::UnsupportedPlatform
    }
}

impl ReferenceStore {
    pub fn initialize_new(_path: &Path, _installation: [u8; 32]) -> Result<Self> {
        Err(closed())
    }
    pub fn open_existing(_path: &Path) -> Result<Self> {
        Err(closed())
    }
    pub fn inspect_existing(_path: &Path) -> Result<ManifestSnapshot> {
        Err(closed())
    }
    pub fn snapshot(&mut self) -> Result<ManifestSnapshot> {
        Err(closed())
    }
    pub fn prepare(
        &mut self,
        _expected: &ManifestToken,
        _record: &SecretRecord,
    ) -> Result<ManifestSnapshot> {
        Err(closed())
    }
    pub fn install_prepared(
        &mut self,
        _expected: &ManifestToken,
        _record: &SecretRecord,
        _vault: &mut Vault,
    ) -> Result<ManifestSnapshot> {
        Err(closed())
    }
    pub fn reconcile_prepared(
        &mut self,
        _expected: &ManifestToken,
        _identity: &RecordIdentity,
        _vault: &mut Vault,
    ) -> Result<ManifestSnapshot> {
        Err(closed())
    }
    pub fn resolve_verified(
        &mut self,
        _expected: &ManifestToken,
        _identity: &RecordIdentity,
        _vault: &mut Vault,
    ) -> Result<SecretRecord> {
        Err(closed())
    }
}
