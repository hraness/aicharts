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
    #[cfg(all(test, target_os = "macos"))]
    fixture: Option<FixtureFactory>,
}

#[cfg(all(test, target_os = "macos"))]
type FixtureFactory = Box<dyn FnMut() -> store::RawResult<FixtureSession>>;

#[cfg(all(test, target_os = "macos"))]
struct FixtureSession(Box<dyn store::RawStore>);

#[cfg(all(test, target_os = "macos"))]
impl store::RawStore for FixtureSession {
    fn read(&mut self, reference: &CredentialRef) -> store::RawResult<zeroize::Zeroizing<Vec<u8>>> {
        self.0.read(reference)
    }
    fn add(&mut self, reference: &CredentialRef, bytes: &[u8]) -> store::RawResult<()> {
        self.0.add(reference, bytes)
    }
}

impl Vault {
    pub fn new() -> Result<Self> {
        if cfg!(target_os = "macos") {
            Ok(Self {
                _private: (),
                #[cfg(all(test, target_os = "macos"))]
                fixture: None,
            })
        } else {
            Err(Error::UnsupportedPlatform)
        }
    }

    /// Inserts once; never overwrites, remints, or retries an uncertain write.
    /// Persist the nonsecret operation intent before calling this method.
    pub fn insert_immutable(&mut self, record: &SecretRecord) -> Result<InsertOutcome> {
        #[cfg(all(test, target_os = "macos"))]
        if self.fixture.is_some() {
            return self.with_lazy_store(|store| store::insert_immutable(store, record));
        }
        with_store(|store| store::insert_immutable(store, record))
    }

    /// Resolves exactly one expected identity, including its purpose and binding.
    /// Missing/inaccessible custody is never permission to generate replacement keys.
    pub fn read_exact(&mut self, expected: &RecordIdentity) -> Result<SecretRecord> {
        #[cfg(all(test, target_os = "macos"))]
        if self.fixture.is_some() {
            return self.with_lazy_store(|store| store::read_exact(store, expected));
        }
        with_store(|store| store::read_exact(store, expected))
    }

    /// The callback must establish its filesystem guards before first I/O.
    /// Construction is pure; one lazy session spans the complete callback and
    /// is released before this method returns. No public backend injection exists.
    #[cfg(target_os = "macos")]
    pub(crate) fn with_lazy_store<T>(
        &mut self,
        operation: impl FnOnce(&mut dyn store::RawStore) -> T,
    ) -> T {
        #[cfg(test)]
        if let Some(factory) = self.fixture.as_mut() {
            let mut session = macos::LazyStore::new(factory);
            return operation(&mut session);
        }
        let mut session = macos::LazyStore::native();
        operation(&mut session)
    }

    #[cfg(all(test, target_os = "macos"))]
    pub(crate) fn fixture<S: store::RawStore + 'static>(
        mut factory: impl FnMut() -> store::RawResult<S> + 'static,
    ) -> Self {
        Self {
            _private: (),
            fixture: Some(Box::new(move || {
                factory().map(|session| FixtureSession(Box::new(session)))
            })),
        }
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
