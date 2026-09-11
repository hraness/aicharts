//! Private local numeric state and explicit numeric sender custody. No source opening or networking.
#![forbid(unsafe_code)]

mod inspection;
mod sender;
mod storage;

pub use inspection::ReadOnlyLedger;
pub use sender::{BatchSettlement, FrozenBatch, SenderBinding, SenderStatus, SettledBatch};

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use aicharts_core::{merge_collections, Collection, Warning};
use aicharts_protocol::{decode, encode, AuthMode, Batch, Evidence, Id, Policy, Registry};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

pub type SourceId = [u8; 32];
pub const MAX_SOURCES: usize = 2_048;
pub const MAX_OCCURRENCES: usize = 100_000;
pub const MAX_ASSOCIATIONS: usize = 200_000;
pub const MAX_PAGE: usize = 256;
const FRAME_BYTES: usize = 136;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Storage,
    Busy,
    PrivateStateRequired,
    UnsupportedPlatform,
    InvalidState,
    WrongNamespace,
    InvalidMeasurement,
    Limit,
    StaleRevision,
    SourceHistoryChanged,
    RecoveryRequired,
    SenderNotEnabled,
    SenderBindingMismatch,
    UploadInFlight,
    InvalidReceipt,
    ReconciliationRequired,
    DeviceRevoked,
}
impl Error {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Storage => "ledger_storage_failed",
            Self::Busy => "ledger_busy_retry",
            Self::PrivateStateRequired => "ledger_private_state_required",
            Self::UnsupportedPlatform => "ledger_platform_not_qualified",
            Self::InvalidState => "ledger_invalid_state_do_not_reset",
            Self::WrongNamespace => "ledger_namespace_mismatch",
            Self::InvalidMeasurement => "ledger_measurement_conflict",
            Self::Limit => "ledger_limit_reached",
            Self::StaleRevision => "ledger_changed_retry",
            Self::SourceHistoryChanged => "ledger_source_history_changed",
            Self::RecoveryRequired => "ledger_recovery_required",
            Self::SenderNotEnabled => "ledger_sender_not_enabled",
            Self::SenderBindingMismatch => "ledger_sender_binding_mismatch",
            Self::UploadInFlight => "ledger_upload_in_flight",
            Self::InvalidReceipt => "ledger_receipt_rejected",
            Self::ReconciliationRequired => "ledger_reconciliation_required",
            Self::DeviceRevoked => "ledger_device_revoked",
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for Error {}
impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        match error.sqlite_error_code() {
            Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked) => {
                Self::Busy
            }
            Some(rusqlite::ErrorCode::DiskFull | rusqlite::ErrorCode::TooBig) => Self::Limit,
            Some(rusqlite::ErrorCode::ReadOnly)
                if error.sqlite_extended_error_code()
                    == Some(rusqlite::ffi::SQLITE_READONLY_ROLLBACK) =>
            {
                Self::RecoveryRequired
            }
            _ => Self::Storage,
        }
    }
}
type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SourceStamp {
    pub device: u64,
    pub inode: u64,
    pub bytes: u64,
    pub modified_seconds: i64,
    pub modified_nanos: u32,
    pub changed_seconds: i64,
    pub changed_nanos: u32,
}
impl SourceStamp {
    fn encode(self) -> Result<Vec<u8>> {
        if self.modified_nanos >= 1_000_000_000
            || self.changed_nanos >= 1_000_000_000
            || self.bytes > 256 * 1024 * 1024
        {
            return Err(Error::Limit);
        }
        let mut out = Vec::with_capacity(48);
        out.extend(self.device.to_le_bytes());
        out.extend(self.inode.to_le_bytes());
        out.extend(self.bytes.to_le_bytes());
        out.extend(self.modified_seconds.to_le_bytes());
        out.extend(self.modified_nanos.to_le_bytes());
        out.extend(self.changed_seconds.to_le_bytes());
        out.extend(self.changed_nanos.to_le_bytes());
        Ok(out)
    }
    fn decode(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != 48 {
            return Err(Error::InvalidState);
        }
        let result = Self {
            device: u64::from_le_bytes(bytes[0..8].try_into().unwrap()),
            inode: u64::from_le_bytes(bytes[8..16].try_into().unwrap()),
            bytes: u64::from_le_bytes(bytes[16..24].try_into().unwrap()),
            modified_seconds: i64::from_le_bytes(bytes[24..32].try_into().unwrap()),
            modified_nanos: u32::from_le_bytes(bytes[32..36].try_into().unwrap()),
            changed_seconds: i64::from_le_bytes(bytes[36..44].try_into().unwrap()),
            changed_nanos: u32::from_le_bytes(bytes[44..48].try_into().unwrap()),
        };
        result.encode().map_err(|_| Error::InvalidState)?;
        Ok(result)
    }
}
pub struct SourceScan {
    pub source_id: SourceId,
    pub stamp: SourceStamp,
    pub collection: Collection,
}
pub struct LedgerSnapshot {
    pub revision: u64,
    pub checkpoints: BTreeMap<SourceId, SourceStamp>,
}
pub struct ImportReport {
    pub revision: u64,
    pub sources_updated: u64,
    pub occurrences_changed: u64,
}
pub struct LedgerStatus {
    pub revision: u64,
    pub sources: u64,
    pub usage_occurrences: u64,
    pub pending_records: u64,
    pub tokens: u64,
    pub output_tokens: u64,
    pub warnings: Vec<Warning>,
}
pub struct PendingRecord {
    pub id: Id,
    pub revision: u64,
    pub frame: Vec<u8>,
}
pub struct PendingPage {
    pub ledger_revision: u64,
    pub entries: Vec<PendingRecord>,
    pub next_after: Option<Id>,
}

/// Key binding for a ledger, not an account credential or upload authorization.
/// Split identities are explicit new-ledger bindings; they never rekey old state.
pub enum LedgerIdentity<'a> {
    Legacy(&'a [u8; 32]),
    SplitKeys {
        checkpoint: &'a [u8; 32],
        occurrence: &'a [u8; 32],
        namespace_version: u32,
    },
}

/// Exact normalized occurrence data, independent of pending-upload membership.
pub struct InventoryRecord {
    pub id: Id,
    pub revision: u64,
    pub frame: Vec<u8>,
}

pub struct Ledger {
    connection: Connection,
    namespace: [u8; 32],
    sender_audit: std::cell::Cell<Option<sender::AuditStamp>>,
}
impl Ledger {
    pub fn initialize(dir: &Path, key: &[u8; 32]) -> Result<Self> {
        Self::initialize_with_identity(dir, &LedgerIdentity::Legacy(key))
    }
    pub fn initialize_with_identity(dir: &Path, identity: &LedgerIdentity<'_>) -> Result<Self> {
        Ok(Self {
            connection: storage::initialize(dir, identity)?,
            namespace: storage::namespace(identity)?,
            sender_audit: std::cell::Cell::new(None),
        })
    }
    pub fn open(dir: &Path, key: &[u8; 32]) -> Result<Self> {
        Self::open_with_identity(dir, &LedgerIdentity::Legacy(key))
    }
    pub fn open_with_identity(dir: &Path, identity: &LedgerIdentity<'_>) -> Result<Self> {
        Ok(Self {
            connection: storage::open(dir, identity)?,
            namespace: storage::namespace(identity)?,
            sender_audit: std::cell::Cell::new(None),
        })
    }
    pub fn snapshot(&self) -> Result<LedgerSnapshot> {
        let tx = self.connection.unchecked_transaction()?;
        snapshot(&tx)
    }
    /// Admit complete source snapshots atomically. Missing sources are retained.
    /// This is not a byte-tail parser or the server's future correction protocol.
    pub fn commit_scans(
        &mut self,
        expected_revision: u64,
        scans: Vec<SourceScan>,
    ) -> Result<ImportReport> {
        self.commit_with(expected_revision, scans, || Ok(()))
    }
    fn commit_with<F: FnOnce() -> Result<()>>(
        &mut self,
        expected_revision: u64,
        scans: Vec<SourceScan>,
        before_commit: F,
    ) -> Result<ImportReport> {
        self.sender_audit.set(None);
        if scans.len() > MAX_SOURCES {
            return Err(Error::Limit);
        }
        let mut seen = BTreeSet::new();
        let mut count = 0usize;
        for scan in &scans {
            if scan.source_id == [0; 32] || !seen.insert(scan.source_id) {
                return Err(Error::InvalidMeasurement);
            }
            count = count
                .checked_add(
                    scan.collection
                        .batches
                        .iter()
                        .map(|b| b.usage.len())
                        .sum::<usize>(),
                )
                .ok_or(Error::Limit)?;
            if count > MAX_OCCURRENCES {
                return Err(Error::Limit);
            }
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if storage::schema_version(&tx)? == 2 {
            storage::validate_schema(&tx, &self.namespace, false)?;
            validate_relations_in(&tx)?;
        }
        let current = revision(&tx)?;
        if current != expected_revision {
            return Err(Error::StaleRevision);
        }
        if scans.is_empty() {
            return Ok(ImportReport {
                revision: current,
                sources_updated: 0,
                occurrences_changed: 0,
            });
        }
        let next = current
            .checked_add(1)
            .filter(|n| *n <= i64::MAX as u64)
            .ok_or(Error::Limit)?;
        let mut changed = BTreeSet::new();
        let mut sources_updated = 0;
        for scan in scans {
            let stamp = scan.stamp.encode()?;
            let mask = warning_mask(&scan.collection.warnings);
            let old_source: Option<(Vec<u8>, i64)> = tx
                .query_row(
                    "SELECT stamp,warnings FROM sources WHERE id=?1",
                    [scan.source_id.as_slice()],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            if let Some((old, _)) = &old_source {
                let old = SourceStamp::decode(old)?;
                if old.device != scan.stamp.device
                    || old.inode != scan.stamp.inode
                    || old.bytes > scan.stamp.bytes
                {
                    return Err(Error::SourceHistoryChanged);
                }
            }
            let records = collection_frames(scan.collection)?;
            let mut old_statement =
                tx.prepare("SELECT id,frame FROM source_usage WHERE source_id=?1 LIMIT 100001")?;
            let mut old_rows = old_statement.query([scan.source_id.as_slice()])?;
            let mut previous_count = 0;
            while let Some(row) = old_rows.next()? {
                previous_count += 1;
                if previous_count > MAX_OCCURRENCES {
                    return Err(Error::InvalidState);
                }
                let id: Vec<u8> = row.get(0)?;
                let id: Id = id.try_into().map_err(|_| Error::InvalidState)?;
                let old: Vec<u8> = row.get(1)?;
                let new = records.get(&id).ok_or(Error::SourceHistoryChanged)?;
                if merge_frames(&old, new)? != *new {
                    return Err(Error::SourceHistoryChanged);
                }
            }
            drop(old_rows);
            drop(old_statement);
            let source_changed = old_source
                .as_ref()
                .is_none_or(|(old, warnings)| old != &stamp || *warnings != mask as i64);
            tx.execute("INSERT INTO sources(id,stamp,warnings) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET stamp=excluded.stamp,warnings=excluded.warnings", params![scan.source_id.as_slice(), stamp, mask as i64])?;
            let mut association_changed = false;
            for (id, frame) in records {
                let old: Option<Vec<u8>> = tx
                    .query_row(
                        "SELECT frame FROM measurements WHERE id=?1",
                        [id.as_slice()],
                        |row| row.get(0),
                    )
                    .optional()?;
                let final_frame = match &old {
                    Some(old) => merge_frames(old, &frame)?,
                    None => frame.clone(),
                };
                if old.as_ref() != Some(&final_frame) {
                    tx.execute("INSERT INTO measurements(id,frame,revision) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET frame=excluded.frame,revision=excluded.revision", params![id.as_slice(), final_frame, next as i64])?;
                    tx.execute("INSERT INTO outbox(id,frame,revision) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET frame=excluded.frame,revision=excluded.revision", params![id.as_slice(), final_frame, next as i64])?;
                    changed.insert(id);
                }
                let old_association: Option<Vec<u8>> = tx
                    .query_row(
                        "SELECT frame FROM source_usage WHERE source_id=?1 AND id=?2",
                        params![scan.source_id.as_slice(), id.as_slice()],
                        |row| row.get(0),
                    )
                    .optional()?;
                association_changed |= old_association.as_ref() != Some(&frame);
                tx.execute("INSERT INTO source_usage(source_id,id,frame) VALUES(?1,?2,?3) ON CONFLICT(source_id,id) DO UPDATE SET frame=excluded.frame", params![scan.source_id.as_slice(), id.as_slice(), frame])?;
            }
            if source_changed || association_changed {
                sources_updated += 1;
            }
        }
        enforce_counts(&tx)?;
        let result_revision = if sources_updated > 0 || !changed.is_empty() {
            next
        } else {
            current
        };
        tx.execute(
            "UPDATE meta SET revision=?1 WHERE singleton=1",
            [result_revision as i64],
        )?;
        before_commit()?;
        tx.commit()?;
        Ok(ImportReport {
            revision: result_revision,
            sources_updated,
            occurrences_changed: changed.len() as u64,
        })
    }
    pub fn status(&self) -> Result<LedgerStatus> {
        let tx = self.connection.unchecked_transaction()?;
        status(&tx)
    }
    pub fn pending(
        &self,
        after: Option<Id>,
        limit: usize,
        expected_revision: Option<u64>,
    ) -> Result<PendingPage> {
        if !(1..=MAX_PAGE).contains(&limit) || (after.is_some() && expected_revision.is_none()) {
            return Err(Error::Limit);
        }
        let tx = self.connection.unchecked_transaction()?;
        let ledger_revision = revision(&tx)?;
        if expected_revision.is_some_and(|r| r != ledger_revision) {
            return Err(Error::StaleRevision);
        }
        pending_page(&tx, after, limit, ledger_revision)
    }
}

fn snapshot(connection: &Connection) -> Result<LedgerSnapshot> {
    let revision = revision(connection)?;
    let mut checkpoints = BTreeMap::new();
    let mut statement =
        connection.prepare("SELECT id,stamp FROM sources ORDER BY id LIMIT 2049")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let id: Vec<u8> = row.get(0)?;
        checkpoints.insert(
            id.try_into().map_err(|_| Error::InvalidState)?,
            SourceStamp::decode(&row.get::<_, Vec<u8>>(1)?)?,
        );
    }
    if checkpoints.len() > MAX_SOURCES {
        return Err(Error::InvalidState);
    }
    Ok(LedgerSnapshot {
        revision,
        checkpoints,
    })
}

fn status(tx: &Connection) -> Result<LedgerStatus> {
    enforce_counts(tx)?;
    let mut tokens = 0u64;
    let mut output_tokens = 0u64;
    let current_revision = revision(tx)?;
    let mut statement =
        tx.prepare("SELECT id,frame,revision FROM measurements ORDER BY id LIMIT 100001")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let id: Vec<u8> = row.get(0)?;
        let batch = checked_frame(&row.get::<_, Vec<u8>>(1)?)?;
        let usage = &batch.usage[0];
        let record_revision = unsigned(row.get::<_, i64>(2)?)?;
        if usage.id.as_slice() != id || record_revision == 0 || record_revision > current_revision {
            return Err(Error::InvalidState);
        }
        tokens = tokens
            .checked_add(usage.tokens.total().map_err(|_| Error::InvalidState)?)
            .ok_or(Error::Limit)?;
        output_tokens = output_tokens
            .checked_add(usage.tokens.output)
            .ok_or(Error::Limit)?;
    }
    let mut mask = 0;
    let mut statement = tx.prepare("SELECT warnings FROM sources LIMIT 2049")?;
    for row in statement.query_map([], |row| row.get::<_, i64>(0))? {
        mask |= unsigned(row?)?;
    }
    let usage_occurrences = table_count(tx, "measurements")?;
    let mut warnings = warnings(mask)?;
    if usage_occurrences == 0 {
        warnings.push(Warning::NoUsageMeasurements);
    }
    Ok(LedgerStatus {
        revision: revision(tx)?,
        sources: table_count(tx, "sources")?,
        usage_occurrences,
        pending_records: table_count(tx, "outbox")?,
        tokens,
        output_tokens,
        warnings,
    })
}
fn pending_page(
    tx: &Connection,
    after: Option<Id>,
    limit: usize,
    ledger_revision: u64,
) -> Result<PendingPage> {
    let mut statement = tx.prepare("SELECT o.id,o.revision,o.frame,m.frame,m.revision FROM outbox o LEFT JOIN measurements m ON m.id=o.id WHERE o.id>?1 ORDER BY o.id LIMIT ?2")?;
    let mut rows = statement.query(params![
        after.unwrap_or([0; 16]).as_slice(),
        (limit + 1) as i64
    ])?;
    let mut entries = Vec::new();
    while let Some(row) = rows.next()? {
        let id: Vec<u8> = row.get(0)?;
        let id: Id = id.try_into().map_err(|_| Error::InvalidState)?;
        let record_revision = unsigned(row.get::<_, i64>(1)?)?;
        let frame: Vec<u8> = row.get(2)?;
        let batch = checked_frame(&frame)?;
        let measured_frame: Option<Vec<u8>> = row.get(3)?;
        let measured_revision: Option<i64> = row.get(4)?;
        if batch.usage[0].id != id
            || record_revision == 0
            || record_revision > ledger_revision
            || measured_frame.as_ref() != Some(&frame)
            || measured_revision != Some(record_revision as i64)
        {
            return Err(Error::InvalidState);
        }
        entries.push(PendingRecord {
            id,
            revision: record_revision,
            frame,
        });
    }
    let next_after = if entries.len() > limit {
        entries.truncate(limit);
        entries.last().map(|e| e.id)
    } else {
        None
    };
    Ok(PendingPage {
        ledger_revision,
        entries,
        next_after,
    })
}

fn revision(connection: &Connection) -> Result<u64> {
    unsigned(
        connection.query_row("SELECT revision FROM meta WHERE singleton=1", [], |row| {
            row.get::<_, i64>(0)
        })?,
    )
}
fn unsigned(value: i64) -> Result<u64> {
    value.try_into().map_err(|_| Error::InvalidState)
}
fn table_count(connection: &Connection, table: &str) -> Result<u64> {
    // Table names are private constants, never caller/source text.
    unsigned(
        connection.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get::<_, i64>(0)
        })?,
    )
}
fn enforce_counts(connection: &Connection) -> Result<()> {
    for (table, cap) in [
        ("sources", MAX_SOURCES),
        ("measurements", MAX_OCCURRENCES),
        ("outbox", MAX_OCCURRENCES),
        ("source_usage", MAX_ASSOCIATIONS),
    ] {
        if table_count(connection, table)? > cap as u64 {
            return Err(Error::Limit);
        }
    }
    Ok(())
}
/// Rebuild the bounded numeric projection on open. Checksums alone cannot detect
/// a valid frame stored under the wrong ID or a queue inconsistent with the ledger.
fn validate_relations(connection: &Connection) -> Result<()> {
    let tx = connection.unchecked_transaction()?;
    validate_relations_in(&tx)
}
fn validate_relations_in(tx: &Connection) -> Result<()> {
    let sender = if storage::schema_version(tx)? == 2 {
        Some(sender::validate(tx)?)
    } else {
        None
    };
    validate_relations_with(tx, sender.as_ref().map(|state| &state.accepted))
}
fn validate_relations_with(
    tx: &Connection,
    accepted: Option<&BTreeMap<Id, sender::Accepted>>,
) -> Result<()> {
    let quick: String = tx.query_row("PRAGMA quick_check(1)", [], |row| row.get(0))?;
    if quick != "ok" {
        return Err(Error::InvalidState);
    }
    let mut check = tx.prepare("PRAGMA foreign_key_check")?;
    if check.query([])?.next()?.is_some() {
        return Err(Error::InvalidState);
    }
    enforce_counts(tx)?;
    let current = revision(tx)?;
    let mut statement = tx.prepare("SELECT id,stamp,warnings FROM sources LIMIT 2049")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let id: Vec<u8> = row.get(0)?;
        if id.len() != 32 || id.iter().all(|b| *b == 0) {
            return Err(Error::InvalidState);
        }
        SourceStamp::decode(&row.get::<_, Vec<u8>>(1)?)?;
        warnings(unsigned(row.get(2)?)?)?;
    }
    let mut merged = BTreeMap::<Id, Vec<u8>>::new();
    let mut statement =
        tx.prepare("SELECT id,frame FROM source_usage ORDER BY source_id,id LIMIT 200001")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let id: Vec<u8> = row.get(0)?;
        let id: Id = id.try_into().map_err(|_| Error::InvalidState)?;
        let frame: Vec<u8> = row.get(1)?;
        if checked_frame(&frame)?.usage[0].id != id {
            return Err(Error::InvalidState);
        }
        let result = match merged.get(&id) {
            Some(old) => merge_frames(old, &frame).map_err(|_| Error::InvalidState)?,
            None => frame,
        };
        merged.insert(id, result);
        if merged.len() > MAX_OCCURRENCES {
            return Err(Error::Limit);
        }
    }
    let mut statement = tx.prepare("SELECT m.id,m.frame,m.revision,o.frame,o.revision FROM measurements m LEFT JOIN outbox o ON m.id=o.id ORDER BY m.id LIMIT 100001")?;
    let mut rows = statement.query([])?;
    let mut count = 0;
    let mut pending_count = 0;
    while let Some(row) = rows.next()? {
        count += 1;
        let id: Vec<u8> = row.get(0)?;
        let id: Id = id.try_into().map_err(|_| Error::InvalidState)?;
        let frame: Vec<u8> = row.get(1)?;
        let row_revision = unsigned(row.get(2)?)?;
        let pending_frame: Option<Vec<u8>> = row.get(3)?;
        let pending_revision: Option<i64> = row.get(4)?;
        let pending =
            pending_frame.as_ref() == Some(&frame) && pending_revision == Some(row_revision as i64);
        let acknowledged = accepted
            .as_ref()
            .and_then(|entries| entries.get(&id))
            .is_some_and(|entry| {
                entry.local_revision == row_revision && entry.frame.as_slice() == frame
            });
        if pending {
            pending_count += 1;
        }
        if row_revision == 0
            || row_revision > current
            || merged.remove(&id).as_ref() != Some(&frame)
            || if accepted.is_some() {
                pending == acknowledged
            } else {
                !pending
            }
            || (!pending && (pending_frame.is_some() || pending_revision.is_some()))
        {
            return Err(Error::InvalidState);
        }
    }
    if !merged.is_empty()
        || pending_count != table_count(tx, "outbox")?
        || count != table_count(tx, "measurements")?
    {
        return Err(Error::InvalidState);
    }
    Ok(())
}
fn policy(registry: &Registry) -> Policy<'_> {
    Policy {
        first_day: 0,
        last_day: u32::MAX,
        registry,
    }
}
fn checked_frame(frame: &[u8]) -> Result<Batch> {
    if frame.len() != FRAME_BYTES {
        return Err(Error::InvalidState);
    }
    let registry = Registry {
        revision: 1,
        models: vec![],
    };
    let batch = decode(frame, &policy(&registry)).map_err(|_| Error::InvalidState)?;
    if batch.usage.len() != 1 || !batch.prompts.is_empty() || !batch.intervals.is_empty() {
        return Err(Error::InvalidState);
    }
    let usage = &batch.usage[0];
    if usage.model_id != 0
        || usage.context_tier != 0
        || usage.account_id != [0; 16]
        || usage.auth_mode != AuthMode::Unknown
        || usage.evidence != Evidence::Imported
    {
        return Err(Error::InvalidState);
    }
    Ok(batch)
}
fn collection_frames(collection: Collection) -> Result<BTreeMap<Id, Vec<u8>>> {
    let mut result = BTreeMap::new();
    let registry = Registry {
        revision: 1,
        models: vec![],
    };
    for batch in collection.batches {
        if batch.registry_revision != 1 || !batch.prompts.is_empty() || !batch.intervals.is_empty()
        {
            return Err(Error::InvalidMeasurement);
        }
        for usage in batch.usage {
            let id = usage.id;
            let frame = encode(
                &Batch {
                    utc_day: batch.utc_day,
                    registry_revision: 1,
                    usage: vec![usage],
                    prompts: vec![],
                    intervals: vec![],
                },
                &policy(&registry),
            )
            .map_err(|_| Error::InvalidMeasurement)?;
            checked_frame(&frame).map_err(|_| Error::InvalidMeasurement)?;
            if result.insert(id, frame).is_some() {
                return Err(Error::InvalidMeasurement);
            }
        }
    }
    Ok(result)
}
fn merge_frames(old: &[u8], new: &[u8]) -> Result<Vec<u8>> {
    let old = checked_frame(old)?;
    let new = checked_frame(new)?;
    if old.usage[0].id != new.usage[0].id {
        return Err(Error::InvalidMeasurement);
    }
    let merged = merge_collections(vec![
        Collection {
            batches: vec![old],
            warnings: vec![],
            lines_read: 0,
        },
        Collection {
            batches: vec![new],
            warnings: vec![],
            lines_read: 0,
        },
    ])
    .map_err(|_| Error::InvalidMeasurement)?;
    collection_frames(merged)?
        .into_values()
        .next()
        .ok_or(Error::InvalidMeasurement)
}

const WARNINGS: [Warning; 15] = [
    Warning::MissingIdentity,
    Warning::MissingTimestamp,
    Warning::MissingUsageCounters,
    Warning::UnsupportedRecords,
    Warning::CodexInitialBaselineOmitted,
    Warning::CodexForkUnsupported,
    Warning::CodexCumulativeRegression,
    Warning::CodexMissingCumulative,
    Warning::ClaudeCacheTtlUnknown,
    Warning::UnknownExecution,
    Warning::UnknownModels,
    Warning::UnmeasuredActivity,
    Warning::UnmeasuredPrompts,
    Warning::UnmeasuredReasoning,
    Warning::NoUsageMeasurements,
];
fn warning_mask(warnings: &[Warning]) -> u64 {
    WARNINGS
        .iter()
        .enumerate()
        .filter(|(_, warning)| {
            **warning != Warning::NoUsageMeasurements && warnings.contains(warning)
        })
        .fold(0, |mask, (i, _)| mask | (1 << i))
}
fn warnings(mask: u64) -> Result<Vec<Warning>> {
    if mask >= 1 << WARNINGS.len() {
        return Err(Error::InvalidState);
    }
    Ok(WARNINGS
        .iter()
        .enumerate()
        .filter(|(i, _)| mask & (1 << i) != 0)
        .map(|(_, w)| *w)
        .collect())
}

#[cfg(test)]
mod tests;
