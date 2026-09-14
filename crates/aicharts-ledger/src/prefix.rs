//! Local complete-prefix witnesses. This module neither reads sources nor
//! verifies a MAC: the collector owns full replay and keyed prefix comparison.

use std::collections::BTreeMap;
use std::path::Path;

use aicharts_core::Collection;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use crate::{
    Error, ImportReport, Ledger, LedgerIdentity, Result, SourceId, SourceScan, SourceStamp,
    MAX_SOURCES,
};

pub(super) const TABLES: [(&str, &str); 1] = [(
    "source_prefixes",
    "CREATE TABLE source_prefixes(source_id BLOB PRIMARY KEY REFERENCES sources(id) CHECK(length(source_id)=32), profile INTEGER, complete_bytes INTEGER, prefix_mac BLOB, CHECK((profile IS NULL AND complete_bytes IS NULL AND prefix_mac IS NULL) OR (profile IS NOT NULL AND profile=1 AND complete_bytes IS NOT NULL AND complete_bytes>=0 AND complete_bytes<=268435456 AND prefix_mac IS NOT NULL AND length(prefix_mac)=32))) STRICT",
)];

/// Keyed integrity metadata for a fully replayed, LF-terminated byte prefix.
/// A zero-byte prefix is valid; every 32-byte MAC, including zero, is representable.
/// This is local-only metadata, not upload data or provider attestation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CompletePrefix {
    pub profile: u16,
    pub bytes: u64,
    pub mac: [u8; 32],
}

impl CompletePrefix {
    fn check(self, stamp: SourceStamp) -> Result<()> {
        if self.profile != 1 {
            return Err(Error::InvalidMeasurement);
        }
        stamp.encode()?;
        if self.bytes > stamp.bytes {
            return Err(Error::Limit);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SourceCheckpoint {
    pub stamp: SourceStamp,
    /// None means an explicit migrated baseline, not permission to discard history.
    pub prefix: Option<CompletePrefix>,
}

pub struct PrefixSnapshot {
    pub revision: u64,
    pub checkpoints: BTreeMap<SourceId, SourceCheckpoint>,
}

pub struct PrefixScan {
    pub source_id: SourceId,
    pub stamp: SourceStamp,
    /// Exact prior witness from the snapshot, independently verified by the collector.
    pub previous: Option<CompletePrefix>,
    pub complete: CompletePrefix,
    /// Full completed-prefix replay, never an append-only collection delta.
    pub collection: Collection,
}

pub(super) struct Update {
    pub(super) previous: Option<CompletePrefix>,
    pub(super) complete: CompletePrefix,
}

impl Update {
    pub(super) fn check(&self, previous: Option<CompletePrefix>, stamp: SourceStamp) -> Result<()> {
        if self.previous != previous {
            return Err(Error::StaleRevision);
        }
        self.complete.check(stamp)?;
        if previous.is_some_and(|old| {
            old.bytes > self.complete.bytes
                || (old.bytes == self.complete.bytes && old.mac != self.complete.mac)
        }) {
            return Err(Error::SourceHistoryChanged);
        }
        Ok(())
    }
}

impl Ledger {
    /// Explicit additive migration: 1 -> 3, 2 -> 4. Existing 3/4 is validated
    /// readback only. No namespace, numeric record, sender row or revision changes.
    pub fn migrate_complete_prefix(
        dir: &Path,
        identity: &LedgerIdentity<'_>,
        expected_revision: u64,
    ) -> Result<Self> {
        Self::migrate_prefix_with(dir, identity, expected_revision, || Ok(()))
    }

    pub(super) fn migrate_prefix_with<F: FnOnce() -> Result<()>>(
        dir: &Path,
        identity: &LedgerIdentity<'_>,
        expected_revision: u64,
        before_commit: F,
    ) -> Result<Self> {
        let mut ledger = Self::open_with_identity(dir, identity)?;
        let tx = ledger
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        crate::storage::validate_schema(&tx, &ledger.namespace, false)?;
        crate::validate_relations_in(&tx)?;
        let version = crate::storage::schema_version(&tx)?;
        if crate::storage::has_prefix(version) {
            tx.rollback()?;
            return Ok(ledger);
        }
        if crate::revision(&tx)? != expected_revision {
            return Err(Error::StaleRevision);
        }
        for (_, sql) in TABLES {
            tx.execute_batch(sql)?;
        }
        // The explicit NULL row distinguishes a legacy baseline from corruption
        // that removes a previously committed witness. No digest is fabricated.
        tx.execute("INSERT INTO source_prefixes(source_id,profile,complete_bytes,prefix_mac) SELECT id,NULL,NULL,NULL FROM sources", [])?;
        tx.pragma_update(
            None,
            "user_version",
            if crate::storage::has_sender(version) {
                4
            } else {
                3
            },
        )?;
        crate::storage::validate_schema(&tx, &ledger.namespace, false)?;
        crate::validate_relations_in(&tx)?;
        before_commit()?;
        tx.commit()?;
        Ok(ledger)
    }

    /// An owned, bounded local snapshot. Legacy layouts expose no witnesses and
    /// are never migrated by inspection. Do not include MACs in output or uploads.
    pub fn prefix_snapshot(&self) -> Result<PrefixSnapshot> {
        let tx = self.connection.unchecked_transaction()?;
        crate::storage::validate_schema(&tx, &self.namespace, false)?;
        snapshot(&tx)
    }

    /// Atomically admit full numeric replay and a collector-verified prefix.
    pub fn commit_prefix_scans(
        &mut self,
        expected_revision: u64,
        scans: Vec<PrefixScan>,
    ) -> Result<ImportReport> {
        self.commit_prefix_with(expected_revision, scans, || Ok(()))
    }

    pub(super) fn commit_prefix_with<F: FnOnce() -> Result<()>>(
        &mut self,
        expected_revision: u64,
        scans: Vec<PrefixScan>,
        before_commit: F,
    ) -> Result<ImportReport> {
        self.sender_audit.set(None);
        if scans.len() > MAX_SOURCES {
            return Err(Error::Limit);
        }
        let mut prefixes = BTreeMap::new();
        let mut sources = Vec::with_capacity(scans.len());
        for scan in scans {
            if prefixes
                .insert(
                    scan.source_id,
                    Update {
                        previous: scan.previous,
                        complete: scan.complete,
                    },
                )
                .is_some()
            {
                return Err(Error::InvalidMeasurement);
            }
            sources.push(SourceScan {
                source_id: scan.source_id,
                stamp: scan.stamp,
                collection: scan.collection,
            });
        }
        self.commit_mode_with(expected_revision, sources, Some(prefixes), before_commit)
    }
}

pub(super) fn read(
    connection: &Connection,
    source_id: &SourceId,
) -> Result<Option<CompletePrefix>> {
    let row = connection
        .query_row(
            "SELECT profile,complete_bytes,prefix_mac FROM source_prefixes WHERE source_id=?1",
            [source_id.as_slice()],
            |row| {
                Ok((
                    row.get::<_, Option<i64>>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<Vec<u8>>>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or(Error::InvalidState)?;
    match row {
        (None, None, None) => Ok(None),
        (Some(1), Some(bytes), Some(mac)) => Ok(Some(CompletePrefix {
            profile: 1,
            bytes: crate::unsigned(bytes)?,
            mac: mac.try_into().map_err(|_| Error::InvalidState)?,
        })),
        _ => Err(Error::InvalidState),
    }
}

pub(super) fn write(
    connection: &Connection,
    source_id: &SourceId,
    prefix: CompletePrefix,
) -> Result<()> {
    connection.execute("INSERT INTO source_prefixes(source_id,profile,complete_bytes,prefix_mac) VALUES(?1,?2,?3,?4) ON CONFLICT(source_id) DO UPDATE SET profile=excluded.profile,complete_bytes=excluded.complete_bytes,prefix_mac=excluded.prefix_mac",
        params![source_id.as_slice(), prefix.profile, prefix.bytes as i64, prefix.mac.as_slice()])?;
    Ok(())
}

pub(super) fn snapshot(connection: &Connection) -> Result<PrefixSnapshot> {
    let legacy = crate::snapshot(connection)?;
    let enabled = crate::storage::has_prefix(crate::storage::schema_version(connection)?);
    if enabled
        && crate::table_count(connection, "source_prefixes")? != legacy.checkpoints.len() as u64
    {
        return Err(Error::InvalidState);
    }
    let mut checkpoints = BTreeMap::new();
    for (id, stamp) in legacy.checkpoints {
        let prefix = if enabled {
            read(connection, &id)?
        } else {
            None
        };
        if let Some(prefix) = prefix {
            prefix.check(stamp).map_err(|_| Error::InvalidState)?;
        }
        checkpoints.insert(id, SourceCheckpoint { stamp, prefix });
    }
    Ok(PrefixSnapshot {
        revision: legacy.revision,
        checkpoints,
    })
}

pub(super) fn validate(connection: &Connection) -> Result<()> {
    snapshot(connection)?;
    Ok(())
}
