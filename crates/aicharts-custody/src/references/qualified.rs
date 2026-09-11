//! Private integration candidate. The public facade stays guarded until the
//! exact source and disposable native mechanism have been admitted.
use super::{engine, macos::MacStorage, Error, ManifestSnapshot, ManifestToken, Result};
use crate::{macos::LazyStore, RecordIdentity, SecretRecord};
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
    pub(super) fn install(
        &mut self,
        expected: &ManifestToken,
        record: &SecretRecord,
    ) -> Result<ManifestSnapshot> {
        // Construction is pure. The first native call happens only when the
        // engine reaches its vault port after durable_checked under the FS lock.
        let mut vault = LazyStore::native();
        engine::install(&mut self.storage, expected, record, &mut vault)
    }
    pub(super) fn reconcile(
        &mut self,
        expected: &ManifestToken,
        identity: &RecordIdentity,
    ) -> Result<ManifestSnapshot> {
        let mut vault = LazyStore::native();
        engine::reconcile(&mut self.storage, expected, identity, &mut vault)
    }
    pub(super) fn resolve(
        &mut self,
        expected: &ManifestToken,
        identity: &RecordIdentity,
    ) -> Result<SecretRecord> {
        let mut vault = LazyStore::native();
        engine::resolve(&mut self.storage, expected, identity, &mut vault)
    }
}

#[cfg(test)]
mod live_tests;
