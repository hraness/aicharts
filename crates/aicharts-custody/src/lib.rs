//! Offline credential custody primitives. Constructing a record establishes syntax,
//! not server provenance or permission to collect, enroll, upload, or start a daemon.
#![forbid(unsafe_code)]

mod record;
pub mod references;
mod store;

#[cfg(target_os = "macos")]
mod macos;

pub use record::{
    CredentialRef, NamespaceBinding, Purpose, RecordIdentity, Secret32, SecretRecord,
};
use std::fmt;

pub type Result<T> = std::result::Result<T, Error>;

/// Fixed errors never retain operating-system messages, identifiers, or secrets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    UnsupportedPlatform,
    InvalidReference,
    InvalidBinding,
    InvalidSecret,
    InvalidRecord,
    WrongPurpose,
    Missing,
    Conflict,
    InteractionRequired,
    AccessDenied,
    Unavailable,
    Busy,
    OutcomeUnknown,
}

impl Error {
    pub const fn code(self) -> &'static str {
        match self {
            Self::UnsupportedPlatform => "custody_unsupported_platform",
            Self::InvalidReference => "custody_invalid_reference",
            Self::InvalidBinding => "custody_invalid_binding",
            Self::InvalidSecret => "custody_invalid_secret",
            Self::InvalidRecord => "custody_invalid_record",
            Self::WrongPurpose => "custody_wrong_purpose",
            Self::Missing => "custody_missing",
            Self::Conflict => "custody_conflict",
            Self::InteractionRequired => "custody_interaction_required",
            Self::AccessDenied => "custody_access_denied",
            Self::Unavailable => "custody_unavailable",
            Self::Busy => "custody_busy",
            Self::OutcomeUnknown => "custody_outcome_unknown",
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for Error {}

/// Both outcomes require exact readback of the full immutable record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InsertOutcome {
    Inserted,
    AlreadyPresent,
}

/// Noninteractive, product-scoped vault. This type does not own local manifests,
/// enrollment receipts, source discovery, network transport, or upload sequences.
///
/// `new` performs no OS operation. Only explicit insert/read calls access a vault.
pub struct Vault {
    _private: (),
}

impl Vault {
    pub fn new() -> Result<Self> {
        if cfg!(target_os = "macos") {
            Ok(Self { _private: () })
        } else {
            Err(Error::UnsupportedPlatform)
        }
    }

    /// Inserts once; never overwrites, remints, or retries an uncertain write.
    /// Persist the nonsecret operation intent before calling this method.
    pub fn insert_immutable(&mut self, record: &SecretRecord) -> Result<InsertOutcome> {
        with_store(|store| store::insert_immutable(store, record))
    }

    /// Resolves exactly one expected identity, including its purpose and binding.
    /// Missing/inaccessible custody is never permission to generate replacement keys.
    pub fn read_exact(&mut self, expected: &RecordIdentity) -> Result<SecretRecord> {
        with_store(|store| store::read_exact(store, expected))
    }
}

#[cfg(target_os = "macos")]
fn with_store<T>(f: impl FnOnce(&mut dyn store::RawStore) -> Result<T>) -> Result<T> {
    macos::with_store(f)
}

#[cfg(not(target_os = "macos"))]
fn with_store<T>(_f: impl FnOnce(&mut dyn store::RawStore) -> Result<T>) -> Result<T> {
    Err(Error::UnsupportedPlatform)
}

#[cfg(test)]
mod tests;
