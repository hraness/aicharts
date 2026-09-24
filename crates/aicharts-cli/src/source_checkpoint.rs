//! Explicit opt-in checkpoint custody. Opening this store is a mutation and
//! must never occur on the ordinary read-only `stats` command path.
use aicharts_import::{ImportCheckpoint, MAX_CHECKPOINT_BYTES};
#[cfg(any(test, target_os = "macos"))]
use std::path::Path;

pub(crate) struct SourceCheckpoint {
    cache: crate::source_refresh::disk::Cache,
}
impl SourceCheckpoint {
    #[cfg(any(test, target_os = "macos"))]
    pub(crate) fn open(directory: &Path) -> Result<Self, &'static str> {
        let cache =
            crate::source_refresh::disk::Cache::open_snapshot(directory, MAX_CHECKPOINT_BYTES)?;
        cache.require_entries(&["refresh.lock", "checkpoint.bin"])?;
        Ok(Self { cache })
    }
    #[cfg(any(test, target_os = "macos"))]
    pub(crate) fn load(&self) -> Result<ImportCheckpoint, &'static str> {
        match self.cache.read("checkpoint.bin", MAX_CHECKPOINT_BYTES)? {
            Some(bytes) => ImportCheckpoint::decode(&bytes),
            None => Ok(ImportCheckpoint::default()),
        }
    }
    /// The importer changes the in-memory value only after complete success.
    /// Preserve an identical prior checkpoint without a redundant fsync/rename.
    pub(crate) fn save(&self, checkpoint: &ImportCheckpoint) -> Result<(), &'static str> {
        if checkpoint.is_empty() {
            return Ok(());
        }
        let bytes = checkpoint.encode()?;
        if self
            .cache
            .read("checkpoint.bin", MAX_CHECKPOINT_BYTES)?
            .as_deref()
            == Some(bytes.as_slice())
        {
            return Ok(());
        }
        self.cache.replace("checkpoint.bin", &bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn private_checkpoint_reopen_and_busy_owner_are_explicit() {
        let temp = crate::source_health::fixture_root();
        let root = fs::canonicalize(temp.path()).unwrap();
        let directory = root.join("checkpoint");
        let store = SourceCheckpoint::open(&directory).unwrap();
        assert!(store.load().unwrap().is_empty());
        assert!(SourceCheckpoint::open(&directory).is_err());
        let source = root.join("source");
        fs::create_dir(&source).unwrap();
        let mut checkpoint = ImportCheckpoint::default();
        aicharts_import::collect_observed(
            &root,
            "codex",
            std::slice::from_ref(&root),
            Some(&[source]),
            0,
            Some(&mut checkpoint),
        )
        .result
        .unwrap();
        store.save(&checkpoint).unwrap();
        let bytes = fs::read(directory.join("checkpoint.bin")).unwrap();
        drop(store);
        let reopened = SourceCheckpoint::open(&directory).unwrap();
        assert_eq!(reopened.load().unwrap().encode().unwrap(), bytes);
        let stage = directory.join(".refresh-interrupted.pending");
        fs::write(&stage, b"checkpoint stage").unwrap();
        let replacement = root.join("replacement");
        fs::create_dir(&replacement).unwrap();
        let mut next = ImportCheckpoint::default();
        aicharts_import::collect_observed(
            &root,
            "codex",
            std::slice::from_ref(&root),
            Some(&[replacement]),
            0,
            Some(&mut next),
        )
        .result
        .unwrap();
        assert_eq!(
            reopened.save(&next),
            Err("source_snapshot_recovery_required")
        );
        assert_eq!(fs::read(directory.join("checkpoint.bin")).unwrap(), bytes);
        assert_eq!(fs::read(&stage).unwrap(), b"checkpoint stage");
        drop(reopened);
        fs::write(directory.join("checkpoint.bin"), b"corrupt").unwrap();
        assert!(SourceCheckpoint::open(&directory).unwrap().load().is_err());
    }
}
