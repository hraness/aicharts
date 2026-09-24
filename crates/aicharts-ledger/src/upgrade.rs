//! Explicit, revision-guarded upgrades. Historical ambiguity is never resolved
//! by choosing an owner, changing frames, or resetting sender custody.
use crate::{Error, Ledger, LedgerIdentity, ReadOnlyLedger, Result};
use std::path::Path;

pub struct UpgradeOutcome {
    pub ledger: Ledger,
    /// False means no migration and no backup creation were performed.
    pub changed: bool,
}

impl Ledger {
    /// Upgrade only an unambiguous v1–v4 history to its corresponding v5–v8
    /// layout. Retain an exact private, independently validated database copy
    /// before the transaction changes any bytes. Keys/anchor files stay with the
    /// original state and must be retained separately; this is a numeric backup.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    pub fn upgrade(
        dir: &Path,
        identity: &LedgerIdentity<'_>,
        expected_revision: u64,
        backup: &Path,
    ) -> Result<UpgradeOutcome> {
        Self::upgrade_with(dir, identity, expected_revision, backup, || Ok(()))
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    pub(super) fn upgrade_with<F: FnOnce() -> Result<()>>(
        dir: &Path,
        identity: &LedgerIdentity<'_>,
        expected_revision: u64,
        backup: &Path,
        before_commit: F,
    ) -> Result<UpgradeOutcome> {
        let view = ReadOnlyLedger::open(dir, identity)?;
        view.history_audit().require_unambiguous()?;
        if view.snapshot().revision != expected_revision {
            return Err(Error::StaleRevision);
        }
        if view.history_audit().schema_version >= 5 {
            return Ok(UpgradeOutcome {
                ledger: Self::open_with_identity(dir, identity)?,
                changed: false,
            });
        }
        let namespace = crate::storage::namespace(identity)?;
        let mut connection = crate::storage::open_existing(dir, identity)?;
        // Rebuild the sources CHECK constraint using SQLite's table-rebuild
        // protocol. All referencing rows remain in place; validate foreign keys
        // and the complete projection before commit. Only this connection's
        // enforcement changes, outside the transaction as SQLite requires.
        connection.pragma_update(None, "foreign_keys", false)?;
        let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        crate::storage::validate_schema(&tx, &namespace, false)?;
        let audit = crate::audit_relations_in(&tx)?;
        audit.require_unambiguous()?;
        if crate::revision(&tx)? != expected_revision || audit != view.history_audit() {
            return Err(Error::StaleRevision);
        }
        view.export_to(backup, identity)?;
        let sources = {
            let mut statement =
                tx.prepare("SELECT id,stamp,warnings FROM sources ORDER BY id LIMIT 32769")?;
            let values = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, Vec<u8>>(0)?,
                        row.get::<_, Vec<u8>>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            if values.len() > crate::MAX_SOURCES {
                return Err(Error::Limit);
            }
            values
        };
        tx.execute_batch("DROP TABLE sources")?;
        tx.execute_batch(crate::storage::SOURCES_V5)?;
        for (id, stamp, warnings) in sources {
            tx.execute(
                "INSERT INTO sources(id,stamp,warnings) VALUES(?1,?2,?3)",
                rusqlite::params![id, stamp, warnings],
            )?;
        }
        tx.pragma_update(None, "user_version", audit.schema_version + 4)?;
        crate::storage::validate_schema(&tx, &namespace, false)?;
        crate::validate_relations_in(&tx)?;
        before_commit()?;
        tx.commit()?;
        connection.pragma_update(None, "foreign_keys", true)?;
        drop(connection);
        Ok(UpgradeOutcome {
            ledger: Self::open_with_identity(dir, identity)?,
            changed: true,
        })
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    pub fn upgrade(_: &Path, _: &LedgerIdentity<'_>, _: u64, _: &Path) -> Result<UpgradeOutcome> {
        Err(Error::UnsupportedPlatform)
    }
}
