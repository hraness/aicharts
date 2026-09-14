//! Private integration candidate. The public facade stays guarded until the
//! exact source and disposable native mechanism have been admitted.
use super::{engine, macos::MacStorage, Error, ManifestSnapshot, ManifestToken, Result};
use crate::{RecordIdentity, SecretRecord, Vault};
use std::path::Path;

pub(super) struct QualifiedStore {
    storage: MacStorage,
}

impl QualifiedStore {
    pub(super) fn initialize_new(path: &Path, installation: [u8; 32]) -> Result<Self> {
        if installation == [0; 32] {
            return Err(Error::InvalidInstallation);
        }
        let mut storage = MacStorage::from_path(path, true)?;
        engine::initialize(&mut storage, installation)?;
        Ok(Self { storage })
    }

    pub(super) fn open_existing(path: &Path) -> Result<Self> {
        let mut storage = MacStorage::from_path(path, false)?;
        engine::snapshot(&mut storage)?;
        Ok(Self { storage })
    }

    pub(super) fn reconcile_initialization(path: &Path, installation: [u8; 32]) -> Result<Self> {
        if installation == [0; 32] {
            return Err(Error::InvalidInstallation);
        }
        let mut storage = MacStorage::from_path(path, false)?;
        engine::reconcile_initialization(&mut storage, installation)?;
        Ok(Self { storage })
    }

    pub(super) fn snapshot(&mut self) -> Result<ManifestSnapshot> {
        engine::snapshot(&mut self.storage)
    }
    pub(super) fn prepare(
        &mut self,
        expected: &ManifestToken,
        record: &SecretRecord,
    ) -> Result<ManifestSnapshot> {
        engine::prepare(&mut self.storage, expected, record)
    }
    pub(super) fn install_prepared(
        &mut self,
        expected: &ManifestToken,
        record: &SecretRecord,
        vault: &mut Vault,
    ) -> Result<ManifestSnapshot> {
        // Construction is pure. The first native call happens only when the
        // engine reaches its vault port after durable_checked under the FS lock.
        vault.with_lazy_store(|session| {
            engine::install(&mut self.storage, expected, record, session)
        })
    }
    pub(super) fn reconcile_prepared(
        &mut self,
        expected: &ManifestToken,
        identity: &RecordIdentity,
        vault: &mut Vault,
    ) -> Result<ManifestSnapshot> {
        vault.with_lazy_store(|session| {
            engine::reconcile(&mut self.storage, expected, identity, session)
        })
    }
    pub(super) fn resolve_verified(
        &mut self,
        expected: &ManifestToken,
        identity: &RecordIdentity,
        vault: &mut Vault,
    ) -> Result<SecretRecord> {
        vault.with_lazy_store(|session| {
            engine::resolve(&mut self.storage, expected, identity, session)
        })
    }
}

#[cfg(test)]
mod live_tests;

#[cfg(test)]
mod tests;
