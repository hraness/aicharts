//! Explicit, bounded custody of canonical numeric batches. This module performs
//! no transport and cannot authenticate the source of a receipt. Only an owned
//! authenticated transport may supply terminal journals; staging is insufficient.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use aicharts_protocol::admission as wire;
use aicharts_protocol::{Id, Policy, Registry};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use crate::{Error, Ledger, LedgerIdentity, Result, FRAME_BYTES, MAX_OCCURRENCES};

const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;
const MAX_BATCH: usize = 256;

pub(super) const TABLES: [(&str, &str); 6] = [
    ("sender_binding", "CREATE TABLE sender_binding(singleton INTEGER PRIMARY KEY CHECK(singleton=1), account_id BLOB NOT NULL CHECK(length(account_id)=16), device_id BLOB NOT NULL CHECK(length(device_id)=32), generation BLOB NOT NULL CHECK(length(generation)=32), namespace_version INTEGER NOT NULL CHECK(namespace_version=1), allocated_sequence INTEGER NOT NULL CHECK(allocated_sequence>=0 AND allocated_sequence<=9007199254740991), settled_sequence INTEGER NOT NULL CHECK(settled_sequence>=0 AND settled_sequence<=allocated_sequence)) STRICT"),
    ("sender_batch", "CREATE TABLE sender_batch(singleton INTEGER PRIMARY KEY CHECK(singleton=1), first_sequence INTEGER NOT NULL CHECK(first_sequence>0 AND first_sequence<=9007199254740991), operation_count INTEGER NOT NULL CHECK(operation_count>0 AND operation_count<=256), selected_revision INTEGER NOT NULL CHECK(selected_revision>=0), canonical_batch BLOB NOT NULL CHECK(length(canonical_batch)=104+320*operation_count), batch_hash BLOB NOT NULL CHECK(length(batch_hash)=32)) STRICT"),
    ("sender_batch_members", "CREATE TABLE sender_batch_members(batch_singleton INTEGER NOT NULL REFERENCES sender_batch(singleton) CHECK(batch_singleton=1), ordinal INTEGER PRIMARY KEY CHECK(ordinal>=0 AND ordinal<256), occurrence_id BLOB NOT NULL UNIQUE REFERENCES measurements(id) CHECK(length(occurrence_id)=16), measurement_revision INTEGER NOT NULL CHECK(measurement_revision>0)) STRICT"),
    ("sender_accepted", "CREATE TABLE sender_accepted(id BLOB PRIMARY KEY REFERENCES measurements(id) CHECK(length(id)=16), local_revision INTEGER NOT NULL CHECK(local_revision>0), sequence INTEGER NOT NULL UNIQUE CHECK(sequence>0 AND sequence<=9007199254740991), operation BLOB NOT NULL CHECK(length(operation)=320), receipt BLOB NOT NULL CHECK(length(receipt)=264)) STRICT"),
    ("sender_settled", "CREATE TABLE sender_settled(singleton INTEGER PRIMARY KEY CHECK(singleton=1), canonical_batch BLOB NOT NULL CHECK(length(canonical_batch)>=424 AND length(canonical_batch)<=82024), batch_hash BLOB NOT NULL CHECK(length(batch_hash)=32), canonical_terminal_journal BLOB NOT NULL CHECK(length(canonical_terminal_journal)>=424 AND length(canonical_terminal_journal)<=67744)) STRICT"),
    ("sender_reconciliation", "CREATE TABLE sender_reconciliation(id BLOB PRIMARY KEY REFERENCES measurements(id) CHECK(length(id)=16), local_revision INTEGER NOT NULL CHECK(local_revision>0), operation BLOB NOT NULL CHECK(length(operation)=320), receipt BLOB NOT NULL CHECK(length(receipt)=264)) STRICT"),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SenderBinding {
    pub account_id: [u8; 16],
    pub device_id: [u8; 32],
    pub generation: [u8; 32],
    pub namespace_version: u32,
}
impl SenderBinding {
    fn checked(self) -> Result<Self> {
        if self.account_id == [0; 16]
            || self.device_id == [0; 32]
            || self.generation == [0; 32]
            || self.namespace_version != 1
        {
            return Err(Error::SenderBindingMismatch);
        }
        Ok(self)
    }
    fn wire(self) -> wire::Binding {
        wire::Binding {
            account_id: self.account_id,
            device_id: self.device_id,
            recovery_generation: self.generation,
            namespace_version: 1,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FrozenBatch {
    pub first_sequence: u64,
    pub operation_count: u16,
    pub selected_revision: u64,
    pub canonical_batch: Vec<u8>,
    pub batch_hash: [u8; 32],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SettledBatch {
    pub canonical_batch: Vec<u8>,
    pub batch_hash: [u8; 32],
    pub terminal_journal: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SenderStatus {
    pub binding: SenderBinding,
    pub allocated_sequence: u64,
    pub settled_sequence: u64,
    pub inflight_operations: u16,
    pub accepted_occurrences: u64,
    pub reconciliation_required: u64,
    pub device_revoked: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BatchSettlement {
    Accepted {
        ledger_revision: u64,
        cleared_records: u16,
        retained_newer: u16,
    },
    Rejected {
        ledger_revision: u64,
        conflicted_records: u16,
        aborted_records: u16,
        device_revoked: bool,
    },
    AlreadySettled {
        ledger_revision: u64,
    },
}

pub(super) struct Accepted {
    pub(super) local_revision: u64,
    pub(super) frame: [u8; FRAME_BYTES],
    receipt: wire::Receipt,
}
struct Member {
    id: Id,
    local_revision: u64,
}
struct StoredBatch {
    frozen: FrozenBatch,
    decoded: wire::Batch,
    members: Vec<Member>,
}
struct Settled {
    batch_bytes: Vec<u8>,
    batch: wire::Batch,
    journal_bytes: Vec<u8>,
    journal: wire::Journal,
}
pub(super) struct State {
    binding: SenderBinding,
    allocated: u64,
    settled: u64,
    inflight: Option<StoredBatch>,
    last: Option<Settled>,
    pub(super) accepted: BTreeMap<Id, Accepted>,
    gated: BTreeSet<Id>,
    revoked: bool,
    accepted_count: u64,
    gated_count: u64,
}

/// A connection-local optimization, never persisted or shared between handles.
/// Captured only while a transaction pins the corresponding main DB snapshot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct AuditStamp {
    schema_cookie: i64,
    schema_version: u32,
    data_version: i64,
    total_changes: u64,
    revision: u64,
}
impl AuditStamp {
    fn read(connection: &Connection) -> Result<Self> {
        if connection.is_autocommit() {
            return Err(Error::InvalidState);
        }
        // BEGIN alone does not establish a deferred read snapshot. This main
        // table read must precede observing data_version, including read APIs.
        let revision = crate::revision(connection)?;
        Ok(Self {
            schema_cookie: connection.pragma_query_value(None, "schema_version", |r| r.get(0))?,
            schema_version: crate::storage::schema_version(connection)?,
            data_version: connection.pragma_query_value(None, "data_version", |r| r.get(0))?,
            total_changes: connection.total_changes(),
            revision,
        })
    }
}

impl Ledger {
    /// Explicit additive migration. No ordinary open, inspection or collection
    /// migrates state. A retry with the same binding is existing-only readback.
    pub fn migrate_sender_v2(
        dir: &Path,
        identity: &LedgerIdentity<'_>,
        expected_revision: u64,
        binding: &SenderBinding,
    ) -> Result<Self> {
        Self::migrate_sender_with(dir, identity, expected_revision, binding, || Ok(()))
    }

    pub(super) fn migrate_sender_with<F: FnOnce() -> Result<()>>(
        dir: &Path,
        identity: &LedgerIdentity<'_>,
        expected_revision: u64,
        binding: &SenderBinding,
        before_commit: F,
    ) -> Result<Self> {
        binding.checked()?;
        if !matches!(
            identity,
            LedgerIdentity::SplitKeys {
                namespace_version: 1,
                ..
            }
        ) {
            return Err(Error::SenderBindingMismatch);
        }
        let mut ledger = Self::open_with_identity(dir, identity)?;
        let tx = ledger
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        crate::storage::validate_schema(&tx, &ledger.namespace, false)?;
        crate::validate_relations_in(&tx)?;
        let version = crate::storage::schema_version(&tx)?;
        if crate::storage::has_sender(version) {
            if validate(&tx)?.binding != *binding {
                return Err(Error::SenderBindingMismatch);
            }
            tx.rollback()?;
            return Ok(ledger);
        }
        if crate::revision(&tx)? != expected_revision {
            return Err(Error::StaleRevision);
        }
        for (_, sql) in TABLES {
            tx.execute_batch(sql)?;
        }
        tx.execute("INSERT INTO sender_binding(singleton,account_id,device_id,generation,namespace_version,allocated_sequence,settled_sequence) VALUES(1,?1,?2,?3,1,0,0)",
            params![binding.account_id.as_slice(), binding.device_id.as_slice(), binding.generation.as_slice()])?;
        tx.pragma_update(
            None,
            "user_version",
            if crate::storage::has_prefix(version) {
                4
            } else {
                2
            },
        )?;
        crate::storage::validate_schema(&tx, &ledger.namespace, false)?;
        crate::validate_relations_in(&tx)?;
        before_commit()?;
        tx.commit()?;
        Ok(ledger)
    }

    pub fn sender_status(&self) -> Result<SenderStatus> {
        let previous = self.sender_audit.take();
        let tx = self.connection.unchecked_transaction()?;
        let (state, stamp) = checked_state(&tx, &self.namespace, previous, &BTreeSet::new())?;
        let result = SenderStatus {
            binding: state.binding,
            allocated_sequence: state.allocated,
            settled_sequence: state.settled,
            inflight_operations: state
                .inflight
                .as_ref()
                .map_or(0, |batch| batch.frozen.operation_count),
            accepted_occurrences: state.accepted_count,
            reconciliation_required: state.gated_count,
            device_revoked: state.revoked,
        };
        tx.rollback()?;
        self.sender_audit.set(Some(stamp));
        Ok(result)
    }

    pub fn inflight_batch(&self) -> Result<Option<FrozenBatch>> {
        let previous = self.sender_audit.take();
        let tx = self.connection.unchecked_transaction()?;
        let (state, stamp) = checked_state(&tx, &self.namespace, previous, &BTreeSet::new())?;
        let result = state.inflight.map(|batch| batch.frozen);
        tx.rollback()?;
        self.sender_audit.set(Some(stamp));
        Ok(result)
    }

    /// Existing-only owned readback of the latest terminal pair, including a
    /// rejected range. Reading this evidence never grants a rebase or new send.
    pub fn last_settled_batch(&self) -> Result<Option<SettledBatch>> {
        let previous = self.sender_audit.take();
        let tx = self.connection.unchecked_transaction()?;
        let (state, stamp) = checked_state(&tx, &self.namespace, previous, &BTreeSet::new())?;
        let result = state
            .last
            .map(|last| -> Result<SettledBatch> {
                Ok(SettledBatch {
                    batch_hash: batch_hash(&last.batch)?,
                    canonical_batch: last.batch_bytes,
                    terminal_journal: last.journal_bytes,
                })
            })
            .transpose()?;
        tx.rollback()?;
        self.sender_audit.set(Some(stamp));
        Ok(result)
    }

    /// Freeze an entire contiguous sequence range before transport. Input order
    /// is normalized by occurrence ID; no caller-supplied head can rebase history.
    pub fn freeze_upload_batch(
        &mut self,
        expected_revision: u64,
        occurrence_ids: &[Id],
    ) -> Result<FrozenBatch> {
        self.freeze_with(expected_revision, occurrence_ids, || Ok(()))
    }

    pub(super) fn freeze_with<F: FnOnce() -> Result<()>>(
        &mut self,
        expected_revision: u64,
        occurrence_ids: &[Id],
        before_commit: F,
    ) -> Result<FrozenBatch> {
        let previous = self.sender_audit.take();
        if occurrence_ids.is_empty() || occurrence_ids.len() > MAX_BATCH {
            return Err(Error::Limit);
        }
        let ids: BTreeSet<Id> = occurrence_ids.iter().copied().collect();
        if ids.len() != occurrence_ids.len() || ids.contains(&[0; 16]) {
            return Err(Error::InvalidMeasurement);
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (state, stamp) = checked_state(&tx, &self.namespace, previous, &ids)?;
        if state.revoked {
            return Err(Error::DeviceRevoked);
        }
        if let Some(existing) = state.inflight {
            if existing.frozen.selected_revision == expected_revision
                && existing
                    .members
                    .iter()
                    .map(|member| member.id)
                    .eq(ids.iter().copied())
            {
                tx.rollback()?;
                self.sender_audit.set(Some(stamp));
                return Ok(existing.frozen);
            }
            return Err(Error::UploadInFlight);
        }
        if crate::revision(&tx)? != expected_revision {
            return Err(Error::StaleRevision);
        }
        let last_sequence = state
            .allocated
            .checked_add(ids.len() as u64)
            .filter(|sequence| *sequence <= MAX_SEQUENCE)
            .ok_or(Error::Limit)?;
        let mut operations = Vec::new();
        let mut members = Vec::new();
        for &id in &ids {
            if state.gated.contains(&id) {
                return Err(Error::ReconciliationRequired);
            }
            let row: Option<(Vec<u8>, i64)> = tx
                .query_row(
                    "SELECT frame,revision FROM outbox WHERE id=?1",
                    [id.as_slice()],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let (bytes, local_revision) = row.ok_or(Error::InvalidMeasurement)?;
            let local_revision = crate::unsigned(local_revision)?;
            let frame: [u8; FRAME_BYTES] = bytes.try_into().map_err(|_| Error::InvalidState)?;
            let expected_head = state
                .accepted
                .get(&id)
                .map_or([0; 32], |entry| entry.receipt.head_operation_hash);
            operations.push(wire::Operation {
                binding: state.binding.wire(),
                sequence: state.allocated + 1 + operations.len() as u64,
                occurrence_id: id,
                expected_head,
                kind: wire::OperationKind::Put { frame },
            });
            members.push(Member { id, local_revision });
        }
        let batch = wire::Batch {
            binding: state.binding.wire(),
            operations,
        };
        let bytes = encode_batch(&batch)?;
        let hash = batch_hash(&batch)?;
        let frozen = FrozenBatch {
            first_sequence: state.allocated + 1,
            operation_count: members.len() as u16,
            selected_revision: expected_revision,
            canonical_batch: bytes,
            batch_hash: hash,
        };
        tx.execute("INSERT INTO sender_batch(singleton,first_sequence,operation_count,selected_revision,canonical_batch,batch_hash) VALUES(1,?1,?2,?3,?4,?5)",
            params![frozen.first_sequence as i64, i64::from(frozen.operation_count), expected_revision as i64, &frozen.canonical_batch, hash.as_slice()])?;
        for (ordinal, member) in members.iter().enumerate() {
            tx.execute("INSERT INTO sender_batch_members(batch_singleton,ordinal,occurrence_id,measurement_revision) VALUES(1,?1,?2,?3)",
                params![ordinal as i64, member.id.as_slice(), member.local_revision as i64])?;
        }
        tx.execute(
            "UPDATE sender_binding SET allocated_sequence=?1 WHERE singleton=1",
            [last_sequence as i64],
        )?;
        let revision = next_revision(&tx)?;
        set_revision(&tx, revision)?;
        validate_selected(&tx, &ids)?;
        before_commit()?;
        let stamp = AuditStamp::read(&tx)?;
        tx.commit()?;
        self.sender_audit.set(Some(stamp));
        Ok(frozen)
    }

    /// Settle only an exact authenticated terminal journal. Invalid, staged and
    /// uncertain replies cannot clear custody or acknowledge any queued value.
    /// Canonical parsing is not a proof of who supplied these bytes.
    pub fn settle_upload_batch(&mut self, terminal_journal: &[u8]) -> Result<BatchSettlement> {
        self.settle_with(terminal_journal, || Ok(()))
    }

    pub(super) fn settle_with<F: FnOnce() -> Result<()>>(
        &mut self,
        terminal_journal: &[u8],
        before_commit: F,
    ) -> Result<BatchSettlement> {
        let previous = self.sender_audit.take();
        if !(424..=67_744).contains(&terminal_journal.len()) {
            return Err(Error::InvalidReceipt);
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (state, stamp) = checked_state(&tx, &self.namespace, previous, &BTreeSet::new())?;
        if state
            .last
            .as_ref()
            .is_some_and(|last| last.journal_bytes == terminal_journal)
        {
            let result = BatchSettlement::AlreadySettled {
                ledger_revision: crate::revision(&tx)?,
            };
            tx.rollback()?;
            self.sender_audit.set(Some(stamp));
            return Ok(result);
        }
        let inflight = state.inflight.ok_or(Error::InvalidReceipt)?;
        let journal = decode_journal(terminal_journal, &inflight.decoded)
            .map_err(|_| Error::InvalidReceipt)?;
        if state.last.as_ref().is_some_and(|last| {
            journal.account_journal_revision <= last.journal.account_journal_revision
                || journal.committed_at_ms < last.journal.committed_at_ms
        }) {
            return Err(Error::InvalidReceipt);
        }
        let mut cleared = 0u16;
        let mut conflicts = 0u16;
        let mut aborted = 0u16;
        let revoked = journal
            .receipts
            .iter()
            .all(|receipt| receipt.outcome == wire::Outcome::DeviceRevoked);
        // All member receipts have been validated before the first mutation.
        for ((operation, receipt), member) in inflight
            .decoded
            .operations
            .iter()
            .zip(&journal.receipts)
            .zip(&inflight.members)
        {
            let bytes = encode_operation(operation)?;
            let receipt_bytes = receipt_bytes(receipt)?;
            if journal.status == wire::JournalStatus::Accepted {
                if !accepted_outcome(receipt.outcome) {
                    return Err(Error::InvalidReceipt);
                }
                tx.execute("INSERT INTO sender_accepted(id,local_revision,sequence,operation,receipt) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET local_revision=excluded.local_revision,sequence=excluded.sequence,operation=excluded.operation,receipt=excluded.receipt",
                    params![member.id.as_slice(), member.local_revision as i64, operation.sequence as i64, bytes, receipt_bytes])?;
                cleared += tx.execute(
                    "DELETE FROM outbox WHERE id=?1 AND revision=?2 AND frame=?3",
                    params![
                        member.id.as_slice(),
                        member.local_revision as i64,
                        frame(operation)?.as_slice()
                    ],
                )? as u16;
            } else if matches!(
                receipt.outcome,
                wire::Outcome::PredecessorConflict | wire::Outcome::SubjectDeleted
            ) {
                conflicts += 1;
                tx.execute("INSERT INTO sender_reconciliation(id,local_revision,operation,receipt) VALUES(?1,?2,?3,?4)",
                    params![member.id.as_slice(), member.local_revision as i64, bytes, receipt_bytes])?;
            } else if receipt.outcome == wire::Outcome::BatchAborted {
                aborted += 1;
            } else if receipt.outcome != wire::Outcome::DeviceRevoked {
                return Err(Error::InvalidReceipt);
            }
        }
        tx.execute("INSERT INTO sender_settled(singleton,canonical_batch,batch_hash,canonical_terminal_journal) VALUES(1,?1,?2,?3) ON CONFLICT(singleton) DO UPDATE SET canonical_batch=excluded.canonical_batch,batch_hash=excluded.batch_hash,canonical_terminal_journal=excluded.canonical_terminal_journal",
            params![&inflight.frozen.canonical_batch, inflight.frozen.batch_hash.as_slice(), terminal_journal])?;
        tx.execute(
            "UPDATE sender_binding SET settled_sequence=allocated_sequence WHERE singleton=1",
            [],
        )?;
        tx.execute(
            "DELETE FROM sender_batch_members WHERE batch_singleton=1",
            [],
        )?;
        tx.execute("DELETE FROM sender_batch WHERE singleton=1", [])?;
        let revision = next_revision(&tx)?;
        set_revision(&tx, revision)?;
        validate_selected(
            &tx,
            &inflight.members.iter().map(|member| member.id).collect(),
        )?;
        before_commit()?;
        let stamp = AuditStamp::read(&tx)?;
        tx.commit()?;
        self.sender_audit.set(Some(stamp));
        Ok(if journal.status == wire::JournalStatus::Accepted {
            BatchSettlement::Accepted {
                ledger_revision: revision,
                cleared_records: cleared,
                retained_newer: inflight.frozen.operation_count - cleared,
            }
        } else {
            BatchSettlement::Rejected {
                ledger_revision: revision,
                conflicted_records: conflicts,
                aborted_records: aborted,
                device_revoked: revoked,
            }
        })
    }
}

fn checked_state(
    connection: &Connection,
    namespace: &[u8; 32],
    previous: Option<AuditStamp>,
    selected: &BTreeSet<Id>,
) -> Result<(State, AuditStamp)> {
    let stamp = AuditStamp::read(connection)?;
    crate::storage::validate_schema(connection, namespace, false)?;
    if !crate::storage::has_sender(crate::storage::schema_version(connection)?) {
        return Err(Error::SenderNotEnabled);
    }
    let state = if previous == Some(stamp) {
        validate_selected(connection, selected)?
    } else {
        let state = validate(connection)?;
        crate::validate_relations_with(connection, Some(&state.accepted))?;
        state
    };
    Ok((state, stamp))
}

fn next_revision(connection: &Connection) -> Result<u64> {
    crate::revision(connection)?
        .checked_add(1)
        .filter(|n| *n <= i64::MAX as u64)
        .ok_or(Error::Limit)
}

fn set_revision(connection: &Connection, revision: u64) -> Result<()> {
    connection.execute(
        "UPDATE meta SET revision=?1 WHERE singleton=1",
        [revision as i64],
    )?;
    Ok(())
}

fn policy() -> (Registry, u32, u32) {
    (
        Registry {
            revision: 1,
            models: vec![],
        },
        0,
        u32::MAX,
    )
}

fn frame(operation: &wire::Operation) -> Result<[u8; FRAME_BYTES]> {
    match &operation.kind {
        wire::OperationKind::Put { frame } => {
            crate::checked_frame(frame)?;
            Ok(*frame)
        }
        wire::OperationKind::Tombstone => Err(Error::InvalidState),
    }
}

fn measure(connection: &Connection, id: &Id) -> Result<(Vec<u8>, u64)> {
    let row: Option<(Vec<u8>, i64)> = connection
        .query_row(
            "SELECT frame,revision FROM measurements WHERE id=?1",
            [id.as_slice()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (frame, revision) = row.ok_or(Error::InvalidState)?;
    Ok((frame, crate::unsigned(revision)?))
}

fn retained_compatible(
    connection: &Connection,
    id: &Id,
    revision: u64,
    retained: &[u8],
) -> Result<()> {
    let (current, current_revision) = measure(connection, id)?;
    if revision == 0
        || revision > current_revision
        || crate::checked_frame(retained)?.usage[0].id != *id
        || (revision == current_revision && retained != current)
        || crate::merge_frames(retained, &current).map_err(|_| Error::InvalidState)? != current
    {
        return Err(Error::InvalidState);
    }
    Ok(())
}

fn decode_operation(bytes: &[u8]) -> Result<wire::Operation> {
    let (registry, first_day, last_day) = policy();
    wire::decode_operation(
        bytes,
        &Policy {
            first_day,
            last_day,
            registry: &registry,
        },
    )
    .map_err(|_| Error::InvalidState)
}
fn encode_operation(operation: &wire::Operation) -> Result<Vec<u8>> {
    let (registry, first_day, last_day) = policy();
    wire::encode_operation(
        operation,
        &Policy {
            first_day,
            last_day,
            registry: &registry,
        },
    )
    .map_err(|_| Error::InvalidState)
}
fn decode_batch(bytes: &[u8]) -> Result<wire::Batch> {
    let (registry, first_day, last_day) = policy();
    let batch = wire::decode_batch(
        bytes,
        &Policy {
            first_day,
            last_day,
            registry: &registry,
        },
    )
    .map_err(|_| Error::InvalidState)?;
    for operation in &batch.operations {
        frame(operation)?;
    }
    Ok(batch)
}
fn encode_batch(batch: &wire::Batch) -> Result<Vec<u8>> {
    let (registry, first_day, last_day) = policy();
    wire::encode_batch(
        batch,
        &Policy {
            first_day,
            last_day,
            registry: &registry,
        },
    )
    .map_err(|_| Error::InvalidState)
}
fn operation_hash(operation: &wire::Operation) -> Result<[u8; 32]> {
    let (registry, first_day, last_day) = policy();
    wire::operation_digest(
        operation,
        &Policy {
            first_day,
            last_day,
            registry: &registry,
        },
    )
    .map_err(|_| Error::InvalidState)
}
fn batch_hash(batch: &wire::Batch) -> Result<[u8; 32]> {
    let (registry, first_day, last_day) = policy();
    wire::batch_digest(
        batch,
        &Policy {
            first_day,
            last_day,
            registry: &registry,
        },
    )
    .map_err(|_| Error::InvalidState)
}
fn receipt_bytes(receipt: &wire::Receipt) -> Result<Vec<u8>> {
    wire::encode_receipt(receipt).map_err(|_| Error::InvalidState)
}
fn decode_receipt(bytes: &[u8]) -> Result<wire::Receipt> {
    wire::decode_receipt(bytes).map_err(|_| Error::InvalidState)
}
fn decode_journal(bytes: &[u8], batch: &wire::Batch) -> Result<wire::Journal> {
    let journal = wire::decode_journal(bytes).map_err(|_| Error::InvalidState)?;
    let (registry, first_day, last_day) = policy();
    wire::validate_journal_for_batch(
        &journal,
        batch,
        &Policy {
            first_day,
            last_day,
            registry: &registry,
        },
    )
    .map_err(|_| Error::InvalidState)?;
    Ok(journal)
}
fn matches_receipt(operation: &wire::Operation, receipt: &wire::Receipt) -> Result<()> {
    if receipt.descriptor != operation.descriptor()
        || receipt.operation_hash != operation_hash(operation)?
    {
        return Err(Error::InvalidState);
    }
    Ok(())
}
fn accepted_outcome(outcome: wire::Outcome) -> bool {
    matches!(
        outcome,
        wire::Outcome::Inserted | wire::Outcome::Replaced | wire::Outcome::Duplicate
    )
}
fn receipt_not_after_last(receipt: &wire::Receipt, last: &Option<Settled>) -> bool {
    last.as_ref().is_some_and(|last| {
        receipt.account_journal_revision <= last.journal.account_journal_revision
            && receipt.committed_at_ms <= last.journal.committed_at_ms
    })
}
fn end_sequence(batch: &wire::Batch) -> Result<u64> {
    batch
        .operations
        .last()
        .map(|op| op.sequence)
        .ok_or(Error::InvalidState)
}

pub(super) fn validate(connection: &Connection) -> Result<State> {
    validate_inner(connection, None)
}

/// Induction from a full audited snapshot: sender SQL changes only this bounded
/// occurrence union and its custody/control rows. It never changes source or
/// measurement projections. New sequence ranges exceed every retained sequence;
/// advancing terminal authority clocks preserve every unselected receipt bound.
/// A collector, another connection or direct SQL invalidates the audit stamp.
fn validate_selected(connection: &Connection, selected: &BTreeSet<Id>) -> Result<State> {
    crate::enforce_counts(connection)?;
    validate_inner(connection, Some(selected))
}

fn validate_inner(connection: &Connection, selected: Option<&BTreeSet<Id>>) -> Result<State> {
    if !crate::storage::has_sender(crate::storage::schema_version(connection)?) {
        return Err(Error::SenderNotEnabled);
    }
    for (name, cap) in [
        ("sender_binding", 1),
        ("sender_batch", 1),
        ("sender_settled", 1),
        ("sender_batch_members", MAX_BATCH),
        ("sender_accepted", MAX_OCCURRENCES),
        ("sender_reconciliation", MAX_OCCURRENCES),
    ] {
        if crate::table_count(connection, name)? > cap as u64 {
            return Err(Error::Limit);
        }
    }
    let row = connection.query_row(
        "SELECT account_id,device_id,generation,namespace_version,allocated_sequence,settled_sequence FROM sender_binding WHERE singleton=1", [],
        |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Vec<u8>>(1)?, row.get::<_, Vec<u8>>(2)?, row.get::<_, u32>(3)?, row.get::<_, i64>(4)?, row.get::<_, i64>(5)?)),
    ).optional()?.ok_or(Error::InvalidState)?;
    let binding = SenderBinding {
        account_id: row.0.try_into().map_err(|_| Error::InvalidState)?,
        device_id: row.1.try_into().map_err(|_| Error::InvalidState)?,
        generation: row.2.try_into().map_err(|_| Error::InvalidState)?,
        namespace_version: row.3,
    }
    .checked()
    .map_err(|_| Error::InvalidState)?;
    let allocated = crate::unsigned(row.4)?;
    let settled = crate::unsigned(row.5)?;
    if settled > allocated || allocated > MAX_SEQUENCE {
        return Err(Error::InvalidState);
    }
    let current_revision = crate::revision(connection)?;
    let last = connection.query_row(
        "SELECT canonical_batch,batch_hash,canonical_terminal_journal FROM sender_settled WHERE singleton=1", [],
        |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Vec<u8>>(1)?, row.get::<_, Vec<u8>>(2)?)),
    ).optional()?.map(|(batch_bytes, hash, journal_bytes)| {
        let batch = decode_batch(&batch_bytes)?;
        let journal = decode_journal(&journal_bytes, &batch)?;
        if hash.as_slice() != batch_hash(&batch)? || batch.binding != binding.wire()
            || end_sequence(&batch)? != settled { return Err(Error::InvalidState); }
        Ok(Settled { batch_bytes, batch, journal_bytes, journal })
    }).transpose()?;
    if (settled == 0) != last.is_none() {
        return Err(Error::InvalidState);
    }
    let mut selected = selected.cloned();
    if let Some(ids) = &mut selected {
        if ids.len() > MAX_BATCH {
            return Err(Error::Limit);
        }
        if let Some(last) = &last {
            ids.extend(
                last.batch
                    .operations
                    .iter()
                    .map(|operation| operation.occurrence_id),
            );
        }
        let bytes: Option<Vec<u8>> = connection
            .query_row(
                "SELECT canonical_batch FROM sender_batch WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(bytes) = bytes {
            ids.extend(
                decode_batch(&bytes)?
                    .operations
                    .iter()
                    .map(|operation| operation.occurrence_id),
            );
        }
        if ids.len() > MAX_BATCH * 3 {
            return Err(Error::Limit);
        }
    }
    // Only this bounded placeholder count shapes SQL; identifiers and values
    // never come from paths, provider content or caller-supplied SQL.
    let filter = selected.as_ref().map_or(String::new(), |ids| {
        if ids.is_empty() {
            " WHERE 0".to_owned()
        } else {
            format!(" WHERE id IN ({})", vec!["?"; ids.len()].join(","))
        }
    });
    let parameters: Vec<&[u8]> = selected
        .as_ref()
        .into_iter()
        .flatten()
        .map(|id| id.as_slice())
        .collect();
    let accepted_count = crate::table_count(connection, "sender_accepted")?;
    let gated_count = crate::table_count(connection, "sender_reconciliation")?;
    let revoked = last.as_ref().is_some_and(|last| {
        last.journal
            .receipts
            .iter()
            .all(|receipt| receipt.outcome == wire::Outcome::DeviceRevoked)
    });

    let mut accepted = BTreeMap::new();
    let mut statement = connection.prepare(&format!("SELECT id,local_revision,sequence,operation,receipt FROM sender_accepted{filter} ORDER BY id LIMIT 100001"))?;
    let mut rows = statement.query(rusqlite::params_from_iter(parameters.iter().copied()))?;
    let mut accepted_sequences = BTreeSet::new();
    while let Some(row) = rows.next()? {
        let id: Id = row
            .get::<_, Vec<u8>>(0)?
            .try_into()
            .map_err(|_| Error::InvalidState)?;
        let local_revision = crate::unsigned(row.get(1)?)?;
        let sequence = crate::unsigned(row.get(2)?)?;
        let operation = decode_operation(&row.get::<_, Vec<u8>>(3)?)?;
        let receipt = decode_receipt(&row.get::<_, Vec<u8>>(4)?)?;
        matches_receipt(&operation, &receipt)?;
        let frame = frame(&operation)?;
        if operation.binding != binding.wire()
            || operation.occurrence_id != id
            || operation.sequence != sequence
            || sequence > settled
            || !accepted_sequences.insert(sequence)
            || !accepted_outcome(receipt.outcome)
            || !receipt_not_after_last(&receipt, &last)
            || local_revision > current_revision
        {
            return Err(Error::InvalidState);
        }
        retained_compatible(connection, &id, local_revision, &frame)?;
        accepted.insert(
            id,
            Accepted {
                local_revision,
                frame,
                receipt,
            },
        );
    }
    let mut gated = BTreeSet::new();
    let mut gate_receipts = BTreeMap::new();
    let mut statement = connection.prepare(&format!("SELECT id,local_revision,operation,receipt FROM sender_reconciliation{filter} ORDER BY id LIMIT 100001"))?;
    let mut rows = statement.query(rusqlite::params_from_iter(parameters.iter().copied()))?;
    while let Some(row) = rows.next()? {
        let id: Id = row
            .get::<_, Vec<u8>>(0)?
            .try_into()
            .map_err(|_| Error::InvalidState)?;
        let local_revision = crate::unsigned(row.get(1)?)?;
        let operation = decode_operation(&row.get::<_, Vec<u8>>(2)?)?;
        let receipt = decode_receipt(&row.get::<_, Vec<u8>>(3)?)?;
        matches_receipt(&operation, &receipt)?;
        if operation.binding != binding.wire()
            || operation.occurrence_id != id
            || operation.sequence > settled
            || !accepted_sequences.insert(operation.sequence)
            || local_revision > current_revision
            || !receipt_not_after_last(&receipt, &last)
            || !matches!(
                receipt.outcome,
                wire::Outcome::PredecessorConflict | wire::Outcome::SubjectDeleted
            )
            || accepted
                .get(&id)
                .is_some_and(|entry| entry.receipt.descriptor.sequence >= operation.sequence)
        {
            return Err(Error::InvalidState);
        }
        retained_compatible(connection, &id, local_revision, &frame(&operation)?)?;
        gated.insert(id);
        gate_receipts.insert(id, receipt);
    }
    if let Some(last) = &last {
        for receipt in &last.journal.receipts {
            let id = receipt.descriptor.occurrence_id;
            if accepted_outcome(receipt.outcome) {
                if accepted
                    .get(&id)
                    .is_none_or(|entry| entry.receipt != *receipt)
                    || gated.contains(&id)
                {
                    return Err(Error::InvalidState);
                }
            } else if matches!(
                receipt.outcome,
                wire::Outcome::PredecessorConflict | wire::Outcome::SubjectDeleted
            ) && gate_receipts.get(&id) != Some(receipt)
            {
                return Err(Error::InvalidState);
            }
        }
    }
    let inflight = connection.query_row(
        "SELECT first_sequence,operation_count,selected_revision,canonical_batch,batch_hash FROM sender_batch WHERE singleton=1", [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, u16>(1)?, row.get::<_, i64>(2)?, row.get::<_, Vec<u8>>(3)?, row.get::<_, Vec<u8>>(4)?)),
    ).optional()?.map(|(first, count, selected, bytes, hash)| {
        let decoded = decode_batch(&bytes)?;
        let first = crate::unsigned(first)?;
        let selected = crate::unsigned(selected)?;
        let hash: [u8; 32] = hash.try_into().map_err(|_| Error::InvalidState)?;
        if decoded.binding != binding.wire() || decoded.operations.len() != usize::from(count)
            || decoded.operations[0].sequence != first || first != settled + 1
            || end_sequence(&decoded)? != allocated || hash != batch_hash(&decoded)?
            || selected >= current_revision || revoked
        { return Err(Error::InvalidState); }
        let mut statement = connection.prepare("SELECT ordinal,occurrence_id,measurement_revision FROM sender_batch_members WHERE batch_singleton=1 ORDER BY ordinal LIMIT 257")?;
        let mut rows = statement.query([])?;
        let mut members = Vec::new();
        while let Some(row) = rows.next()? {
            let ordinal = crate::unsigned(row.get(0)?)?;
            let id: Id = row.get::<_, Vec<u8>>(1)?.try_into().map_err(|_| Error::InvalidState)?;
            let local_revision = crate::unsigned(row.get(2)?)?;
            let operation = decoded.operations.get(members.len()).ok_or(Error::InvalidState)?;
            let expected = accepted.get(&id).map_or([0; 32], |entry| entry.receipt.head_operation_hash);
            if ordinal != members.len() as u64 || id != operation.occurrence_id
                || local_revision > selected || operation.expected_head != expected
                || gated.contains(&id) || members.last().is_some_and(|last: &Member| last.id >= id)
                || !connection.query_row("SELECT EXISTS(SELECT 1 FROM outbox WHERE id=?1)", [id.as_slice()], |row| row.get::<_, bool>(0))?
            { return Err(Error::InvalidState); }
            retained_compatible(connection, &id, local_revision, &frame(operation)?)?;
            members.push(Member { id, local_revision });
        }
        if members.len() != decoded.operations.len() { return Err(Error::InvalidState); }
        Ok(StoredBatch { frozen: FrozenBatch { first_sequence: first, operation_count: count,
            selected_revision: selected, canonical_batch: bytes, batch_hash: hash }, decoded, members })
    }).transpose()?;
    if inflight.is_none()
        && (allocated != settled || crate::table_count(connection, "sender_batch_members")? != 0)
    {
        return Err(Error::InvalidState);
    }
    if let Some(ids) = selected {
        for id in ids {
            let row = connection.query_row(
                "SELECT m.frame,m.revision,o.frame,o.revision FROM measurements m LEFT JOIN outbox o ON m.id=o.id WHERE m.id=?1", [id.as_slice()],
                |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, i64>(1)?, row.get::<_, Option<Vec<u8>>>(2)?, row.get::<_, Option<i64>>(3)?)),
            ).optional()?;
            // Unknown caller selections are rejected by freeze before any write.
            // Missing referenced custody/evidence rows already failed above.
            let Some((frame, revision, pending_frame, pending_revision)) = row else {
                continue;
            };
            let revision = crate::unsigned(revision)?;
            let pending =
                pending_frame.as_ref() == Some(&frame) && pending_revision == Some(revision as i64);
            let acknowledged = accepted.get(&id).is_some_and(|entry| {
                entry.local_revision == revision && entry.frame.as_slice() == frame
            });
            if revision == 0
                || revision > current_revision
                || crate::checked_frame(&frame)?.usage[0].id != id
                || pending == acknowledged
                || (!pending && (pending_frame.is_some() || pending_revision.is_some()))
            {
                return Err(Error::InvalidState);
            }
        }
    }
    Ok(State {
        binding,
        allocated,
        settled,
        inflight,
        last,
        accepted,
        gated,
        revoked,
        accepted_count,
        gated_count,
    })
}
