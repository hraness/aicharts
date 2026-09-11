//! Dormant persistence algorithm. Private ports are exercised by deterministic
//! fakes, not a production filesystem or Keychain adapter.
use super::{
    codec, Error, ManifestSnapshot, ManifestToken, RecordIntent, ReferenceEntry, ReferenceState,
    Result,
};
use crate::{record::bytes_equal, store::RawStore, RecordIdentity, SecretRecord};

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Candidate {
    pub(crate) expected: Option<ManifestToken>,
    pub(crate) bytes: Vec<u8>,
}

/// Future adapter contract: one pinned private directory and stable lock for the
/// complete guard lifetime; bounded nofollow reads; create-only immutable stage;
/// only exact identical stage reuse; one atomic publication. Existing state is
/// never repaired, deleted, or adopted. The adapter must validate native ACLs.
pub(crate) trait Storage {
    fn lock(&mut self) -> Result<()>;
    fn unlock(&mut self);
    fn read_committed(&mut self, max_bytes: usize) -> Result<Option<Vec<u8>>>;
    fn sync_committed(&mut self) -> Result<()>;
    fn stage(&mut self, candidate: &Candidate) -> Result<()>;
    fn sync_candidate(&mut self) -> Result<()>;
    fn publish(&mut self, candidate: &Candidate) -> Result<()>;
    fn sync_directory(&mut self) -> Result<()>;
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

fn read<S: Storage>(storage: &mut S) -> Result<ManifestSnapshot> {
    let bytes = storage
        .read_committed(super::MAX_MANIFEST_BYTES)?
        .ok_or(Error::Missing)?;
    codec::decode(&bytes)
}
fn checked<S: Storage>(storage: &mut S, expected: &ManifestToken) -> Result<ManifestSnapshot> {
    let current = read(storage)?;
    if current.token() != *expected {
        return Err(Error::StaleSnapshot);
    }
    Ok(current)
}

fn durable_checked<S: Storage>(storage: &mut S, expected: &ManifestToken) -> Result<()> {
    // A prior rename may have succeeded while its directory-sync reply failed.
    // Seeing those bytes after restart is insufficient custody for a vault write:
    // reestablish file + directory durability and then recheck exact identity.
    checked(storage, expected)?;
    storage.sync_committed()?;
    storage.sync_directory()?;
    checked(storage, expected)?;
    Ok(())
}

fn commit<S: Storage>(
    storage: &mut S,
    expected: Option<ManifestToken>,
    next: &ManifestSnapshot,
) -> Result<ManifestSnapshot> {
    let bytes = codec::encode(next);
    codec::decode(&bytes)?;
    match expected {
        Some(token) => {
            checked(storage, &token)?;
        }
        None => {
            if storage.read_committed(super::MAX_MANIFEST_BYTES)?.is_some() {
                return Err(Error::Conflict);
            }
        }
    }
    let candidate = Candidate { expected, bytes };
    storage.stage(&candidate)?;
    storage.sync_candidate()?;
    // Recheck after staging too. A real adapter owns this same lock; the extra
    // check prevents a stale publication when a port reports an intervening write.
    match expected {
        Some(token) => {
            checked(storage, &token)?;
        }
        None => {
            if storage.read_committed(super::MAX_MANIFEST_BYTES)?.is_some() {
                return Err(Error::Conflict);
            }
        }
    }
    // Every failure from dispatch through exact readback may follow publication.
    storage
        .publish(&candidate)
        .map_err(|_| Error::OutcomeUnknown)?;
    storage
        .sync_directory()
        .map_err(|_| Error::OutcomeUnknown)?;
    let actual = storage
        .read_committed(super::MAX_MANIFEST_BYTES)
        .map_err(|_| Error::OutcomeUnknown)?;
    if actual.as_deref() != Some(candidate.bytes.as_slice()) {
        return Err(Error::OutcomeUnknown);
    }
    Ok(next.clone())
}

pub(crate) fn initialize<S: Storage>(
    storage: &mut S,
    installation: [u8; 32],
) -> Result<ManifestSnapshot> {
    if installation == [0; 32] {
        return Err(Error::InvalidInstallation);
    }
    locked(storage, |storage| {
        commit(
            storage,
            None,
            &ManifestSnapshot {
                installation,
                revision: 0,
                entries: vec![],
            },
        )
    })
}
pub(crate) fn snapshot<S: Storage>(storage: &mut S) -> Result<ManifestSnapshot> {
    locked(storage, read)
}

pub(crate) fn prepare<S: Storage>(
    storage: &mut S,
    expected: &ManifestToken,
    record: &SecretRecord,
) -> Result<ManifestSnapshot> {
    locked(storage, |storage| {
        let mut current = checked(storage, expected)?;
        let intent = RecordIntent::from_record(record);
        if intent.identity.reference().installation_id() != &current.installation {
            return Err(Error::InvalidInstallation);
        }
        if let Some(existing) = current.entries.iter().find(|entry| {
            entry.intent.identity.reference().item_id() == intent.identity.reference().item_id()
        }) {
            return if existing.intent == intent {
                Ok(current)
            } else {
                Err(Error::Conflict)
            };
        }
        if current
            .entries
            .iter()
            .any(|entry| entry.state == ReferenceState::Prepared)
        {
            return Err(Error::PendingOperation);
        }
        if current.entries.len() == super::MAX_ENTRIES {
            return Err(Error::Limit);
        }
        current.entries.push(ReferenceEntry {
            intent,
            state: ReferenceState::Prepared,
        });
        current
            .entries
            .sort_by_key(|entry| *entry.intent.identity.reference().item_id());
        current.revision += 1;
        commit(storage, Some(*expected), &current)
    })
}

fn entry<'a>(
    current: &'a ManifestSnapshot,
    identity: &RecordIdentity,
) -> Result<&'a ReferenceEntry> {
    current
        .entries
        .iter()
        .find(|entry| &entry.intent.identity == identity)
        .ok_or(Error::Conflict)
}
fn verify(record: &SecretRecord, intent: &RecordIntent) -> Result<()> {
    let observed = RecordIntent::from_record(record);
    if observed.identity != intent.identity
        || !bytes_equal(&observed.commitment, &intent.commitment)
    {
        return Err(Error::Conflict);
    }
    Ok(())
}
fn verified<S: Storage>(
    storage: &mut S,
    expected: &ManifestToken,
    mut current: ManifestSnapshot,
    identity: &RecordIdentity,
) -> Result<ManifestSnapshot> {
    // Revalidate committed custody after each external vault call, even though
    // the storage serialization guard is still held. Do not bless a raced token.
    checked(storage, expected)?;
    let target = current
        .entries
        .iter_mut()
        .find(|entry| &entry.intent.identity == identity)
        .ok_or(Error::Conflict)?;
    if target.state == ReferenceState::CustodyVerified {
        return Ok(current);
    }
    target.state = ReferenceState::CustodyVerified;
    current.revision += 1;
    commit(storage, Some(*expected), &current)
}

pub(crate) fn install<S: Storage>(
    storage: &mut S,
    expected: &ManifestToken,
    record: &SecretRecord,
    vault: &mut dyn RawStore,
) -> Result<ManifestSnapshot> {
    locked(storage, |storage| {
        let current = checked(storage, expected)?;
        let retained = entry(&current, record.identity())?;
        verify(record, &retained.intent)?;
        durable_checked(storage, expected)?;
        if retained.state == ReferenceState::Prepared {
            crate::store::insert_immutable(vault, record).map_err(Error::Custody)?;
            checked(storage, expected)?;
        }
        let readback =
            crate::store::read_exact(vault, record.identity()).map_err(Error::Custody)?;
        verify(&readback, &retained.intent)?;
        verified(storage, expected, current, record.identity())
    })
}

pub(crate) fn reconcile<S: Storage>(
    storage: &mut S,
    expected: &ManifestToken,
    identity: &RecordIdentity,
    vault: &mut dyn RawStore,
) -> Result<ManifestSnapshot> {
    locked(storage, |storage| {
        let current = checked(storage, expected)?;
        let retained = entry(&current, identity)?;
        durable_checked(storage, expected)?;
        let readback = crate::store::read_exact(vault, identity).map_err(Error::Custody)?;
        verify(&readback, &retained.intent)?;
        verified(storage, expected, current, identity)
    })
}

pub(crate) fn resolve<S: Storage>(
    storage: &mut S,
    expected: &ManifestToken,
    identity: &RecordIdentity,
    vault: &mut dyn RawStore,
) -> Result<SecretRecord> {
    locked(storage, |storage| {
        let current = checked(storage, expected)?;
        let retained = entry(&current, identity)?;
        if retained.state != ReferenceState::CustodyVerified {
            return Err(Error::NotVerified);
        }
        durable_checked(storage, expected)?;
        let record = crate::store::read_exact(vault, identity).map_err(Error::Custody)?;
        verify(&record, &retained.intent)?;
        checked(storage, expected)?;
        Ok(record)
    })
}
