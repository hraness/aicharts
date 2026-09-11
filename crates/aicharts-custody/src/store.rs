use crate::record::{bytes_equal, MAX_RECORD_BYTES};
use crate::{CredentialRef, Error, InsertOutcome, RecordIdentity, Result, SecretRecord};
use zeroize::Zeroizing;

/// This boundary is private: callers cannot install plaintext or mock backends.
/// A backend must report an ambiguous insertion as Unknown, never Missing.
pub(crate) trait RawStore {
    fn read(&mut self, reference: &CredentialRef) -> RawResult<Zeroizing<Vec<u8>>>;
    fn add(&mut self, reference: &CredentialRef, bytes: &[u8]) -> RawResult<()>;
}

pub(crate) type RawResult<T> = std::result::Result<T, RawError>;

#[derive(Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) enum RawError {
    Missing,
    Duplicate,
    InteractionRequired,
    AccessDenied,
    Unavailable,
    Invalid,
    Unknown,
}

impl RawError {
    pub(crate) fn fixed(self) -> Error {
        match self {
            Self::Missing => Error::Missing,
            Self::Duplicate => Error::Conflict,
            Self::InteractionRequired => Error::InteractionRequired,
            Self::AccessDenied => Error::AccessDenied,
            Self::Unavailable => Error::Unavailable,
            Self::Invalid => Error::InvalidRecord,
            Self::Unknown => Error::OutcomeUnknown,
        }
    }
}

pub(crate) fn read_exact(
    store: &mut dyn RawStore,
    expected: &RecordIdentity,
) -> Result<SecretRecord> {
    let bytes = store.read(expected.reference()).map_err(RawError::fixed)?;
    parse_exact(&bytes, expected)
}

fn parse_exact(bytes: &[u8], expected: &RecordIdentity) -> Result<SecretRecord> {
    if bytes.len() > MAX_RECORD_BYTES {
        return Err(Error::InvalidRecord);
    }
    let record = SecretRecord::decode(bytes)?;
    if record.identity() != expected {
        return Err(Error::Conflict);
    }
    Ok(record)
}

pub(crate) fn insert_immutable(
    store: &mut dyn RawStore,
    record: &SecretRecord,
) -> Result<InsertOutcome> {
    let encoded = record.encode();
    let reference = record.identity().reference();
    match store.read(reference) {
        Ok(existing) => {
            check_readback(&existing, record, &encoded)?;
            return Ok(InsertOutcome::AlreadyPresent);
        }
        Err(RawError::Missing) => {}
        Err(error) => return Err(error.fixed()),
    }
    let outcome = match store.add(reference, &encoded) {
        Ok(()) => InsertOutcome::Inserted,
        Err(RawError::Duplicate) => InsertOutcome::AlreadyPresent,
        // Conservatively treat every other post-dispatch error as uncertain,
        // including an unexpected Missing/availability result from a backend.
        Err(_) => return Err(Error::OutcomeUnknown),
    };
    // A successful OS call is not a readback receipt. After this point any read
    // failure is uncertain custody; callers retain the same operation intent.
    let readback = store.read(reference).map_err(|_| Error::OutcomeUnknown)?;
    check_readback(&readback, record, &encoded)?;
    Ok(outcome)
}

fn check_readback(bytes: &[u8], record: &SecretRecord, encoded: &[u8]) -> Result<()> {
    let _owned = parse_exact(bytes, record.identity())?;
    if !bytes_equal(bytes, encoded) {
        return Err(Error::Conflict);
    }
    Ok(())
}
