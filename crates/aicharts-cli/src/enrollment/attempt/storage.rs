//! Private compare-and-publish core. The macOS port implements this trait behind
//! private, uncalled constructors; no public backend injection or activation exists.

use super::{
    record::{self, CanonicalBytes, Record, Token},
    Error, Result, MAX_RECORD_BYTES,
};

#[derive(Clone, PartialEq, Eq)]
pub(super) struct Candidate {
    pub(super) expected: Option<Token>,
    pub(super) next: Token,
    pub(super) bytes: CanonicalBytes,
}

/// A native adapter owns one stable lock and pinned private directory; it must
/// reject symlinks, excess bytes and ACL changes; create an immutable stage;
/// reuse only an exactly identical stage; and perform one atomic publication.
/// A lock error owns no lock. Stage/sync errors never authorize stage deletion.
/// Successful sync_candidate covers the exact staged file. Successful publish
/// compares the predecessor and moves only that exact stage into committed state.
/// unlock releases custody only; it must never publish, adopt or repair state.
pub(super) trait Storage {
    fn lock(&mut self) -> Result<()>;
    fn unlock(&mut self);
    fn read_committed(&mut self, max_bytes: usize) -> Result<Option<Vec<u8>>>;
    fn sync_committed(&mut self) -> Result<()>;
    fn stage(&mut self, candidate: &Candidate) -> Result<()>;
    fn sync_candidate(&mut self) -> Result<()>;
    fn publish(&mut self, candidate: &Candidate) -> Result<()>;
    fn sync_directory(&mut self) -> Result<()>;
}

pub(super) struct Snapshot {
    record: Record,
    token: Token,
}
impl Snapshot {
    pub(super) fn record(&self) -> &Record {
        &self.record
    }
    pub(super) fn token(&self) -> Token {
        self.token
    }
}

/// Evidence of exact local file and directory durability at this observation,
/// not permission to dispatch, use a vault, enroll or upload. No byte decoder or
/// public constructor creates this wrapper, and it is not a long-lived lock.
pub(super) struct DurableSnapshot(Snapshot);
impl DurableSnapshot {
    pub(super) fn record(&self) -> &Record {
        self.0.record()
    }
    pub(super) fn token(&self) -> Token {
        self.0.token()
    }
}

struct Guard<'a, S: Storage>(&'a mut S);
impl<S: Storage> Drop for Guard<'_, S> {
    fn drop(&mut self) {
        self.0.unlock();
    }
}
fn locked<S: Storage, T>(storage: &mut S, f: impl FnOnce(&mut S) -> Result<T>) -> Result<T> {
    storage.lock()?;
    let guard = Guard(storage);
    f(guard.0)
}
fn decode(bytes: &[u8]) -> Result<Snapshot> {
    let record = record::decode(bytes)?;
    let token = record::token(&record)?;
    Ok(Snapshot { record, token })
}
fn read<S: Storage>(storage: &mut S) -> Result<Snapshot> {
    let bytes = storage
        .read_committed(MAX_RECORD_BYTES)?
        .ok_or(Error::Missing)?;
    decode(&bytes)
}
fn checked<S: Storage>(storage: &mut S, expected: Token) -> Result<Snapshot> {
    let current = read(storage)?;
    if current.token != expected {
        return Err(Error::StaleSnapshot);
    }
    Ok(current)
}
fn predecessor<S: Storage>(storage: &mut S, expected: Option<Token>) -> Result<Option<Snapshot>> {
    match expected {
        Some(token) => Ok(Some(checked(storage, token)?)),
        None => {
            if storage.read_committed(MAX_RECORD_BYTES)?.is_some() {
                return Err(Error::Conflict);
            }
            Ok(None)
        }
    }
}

fn commit<S: Storage>(
    storage: &mut S,
    candidate: &Candidate,
    next: &Record,
) -> Result<DurableSnapshot> {
    if let Some(previous) = predecessor(storage, candidate.expected)? {
        record::successor(&previous.record, next)?;
    }
    storage.stage(candidate)?;
    storage.sync_candidate()?;
    predecessor(storage, candidate.expected)?;
    // The publication call itself is the ambiguity boundary, even when a port
    // reports an error that claims the effect did not happen. Never retry here.
    storage
        .publish(candidate)
        .map_err(|_| Error::OutcomeUnknown)?;
    storage
        .sync_directory()
        .map_err(|_| Error::OutcomeUnknown)?;
    let actual = storage
        .read_committed(MAX_RECORD_BYTES)
        .map_err(|_| Error::OutcomeUnknown)?;
    if actual.as_deref() != Some(candidate.bytes.as_bytes()) {
        return Err(Error::OutcomeUnknown);
    }
    // The candidate file was synced before publication, its directory after it,
    // and the exact committed bytes were read back while the same lock is held.
    let snapshot = decode(candidate.bytes.as_bytes()).map_err(|_| Error::OutcomeUnknown)?;
    if snapshot.token != candidate.next {
        return Err(Error::OutcomeUnknown);
    }
    Ok(DurableSnapshot(snapshot))
}

pub(super) fn initialize<S: Storage>(storage: &mut S, initial: &Record) -> Result<DurableSnapshot> {
    record::initial(initial)?;
    let candidate = Candidate {
        expected: None,
        next: record::token(initial)?,
        bytes: record::encode(initial)?,
    };
    locked(storage, |storage| commit(storage, &candidate, initial))
}

/// Observational only, including after a crash or an ambiguous publication.
pub(super) fn inspect<S: Storage>(storage: &mut S) -> Result<Snapshot> {
    locked(storage, read)
}

/// Explicit reconciliation of one retained committed token. Missing state or a
/// pending stage is not adopted. Existing bytes alone never give durability.
pub(super) fn read_durable<S: Storage>(
    storage: &mut S,
    expected: Token,
) -> Result<DurableSnapshot> {
    locked(storage, |storage| {
        checked(storage, expected)?;
        storage.sync_committed()?;
        storage.sync_directory()?;
        let exact = checked(storage, expected)?;
        Ok(DurableSnapshot(exact))
    })
}

pub(super) fn compare_and_publish<S: Storage>(
    storage: &mut S,
    expected: Token,
    next: &Record,
) -> Result<DurableSnapshot> {
    record::validate(next)?;
    if expected.revision() == super::MAX_REVISION {
        return Err(Error::Limit);
    }
    if next.revision != expected.revision() + 1 {
        return Err(Error::InvalidSuccessor);
    }
    let candidate = Candidate {
        expected: Some(expected),
        next: record::token(next)?,
        bytes: record::encode(next)?,
    };
    locked(storage, |storage| commit(storage, &candidate, next))
}
