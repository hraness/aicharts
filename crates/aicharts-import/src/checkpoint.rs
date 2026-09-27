//! Local-only derived state. The envelope's content checksum detects torn or
//! corrupt files; it is not an authentication claim. The CLI owns private
//! descriptor-bound I/O.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use tokscale_core::offline::{ContentChecksum, OfflineCheckpoint, CHECKPOINT_GENERATION};
pub use tokscale_core::offline::{
    MAX_CHECKPOINT_BYTES, MAX_CHECKPOINT_FILES, MAX_CHECKPOINT_OBSERVATIONS,
};

const MAGIC: &[u8; 8] = b"AICHCP03";
#[derive(Clone, Debug, Default)]
pub struct ImportCheckpoint {
    pub(crate) state: Option<State>,
    encoded: std::sync::OnceLock<Vec<u8>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct State {
    generation: u32,
    parser_generation: u64,
    upstream: String,
    pub(crate) scope: [u8; 32],
    #[serde(skip)]
    pub(crate) source: OfflineCheckpoint,
}
struct Bounded(Vec<u8>);
impl Write for Bounded {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self
            .0
            .len()
            .checked_add(bytes.len())
            .is_none_or(|n| n > MAX_CHECKPOINT_BYTES - 40)
        {
            return Err(io::Error::other("import_checkpoint_limit"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
impl ImportCheckpoint {
    pub fn encode(&self) -> Result<Vec<u8>, &'static str> {
        self.bounded_bytes().map(<[u8]>::to_vec)
    }
    pub(crate) fn bounded_bytes(&self) -> Result<&[u8], &'static str> {
        if let Some(encoded) = self.encoded.get() {
            return Ok(encoded);
        }
        let state = self.state.as_ref().ok_or("import_checkpoint_absent")?;
        if !state.source.valid() {
            return Err("import_checkpoint_invalid");
        }
        let mut body = Bounded(Vec::new());
        let header = serde_json::to_vec(state).map_err(|_| "import_checkpoint_invalid")?;
        body.write_all(&(header.len() as u32).to_le_bytes())
            .map_err(|_| "import_checkpoint_limit")?;
        body.write_all(&header)
            .map_err(|_| "import_checkpoint_limit")?;
        state.source.encode_into(&mut body)?;
        let mut bytes = Vec::with_capacity(body.0.len() + 40);
        bytes.extend_from_slice(MAGIC);
        bytes.extend_from_slice(&ContentChecksum::digest(&body.0));
        bytes.extend_from_slice(&body.0);
        let _ = self.encoded.set(bytes);
        Ok(self.encoded.get().expect("installed bounded encoding"))
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() > MAX_CHECKPOINT_BYTES
            || bytes.len() <= 44
            || &bytes[..8] != MAGIC
            || ContentChecksum::digest(&bytes[40..]) != bytes[8..40]
        {
            return Err("import_checkpoint_invalid");
        }
        let header_len = u32::from_le_bytes(
            bytes[40..44]
                .try_into()
                .map_err(|_| "import_checkpoint_invalid")?,
        ) as usize;
        let end = 44usize
            .checked_add(header_len)
            .filter(|end| *end < bytes.len())
            .ok_or("import_checkpoint_invalid")?;
        let mut state: State =
            serde_json::from_slice(&bytes[44..end]).map_err(|_| "import_checkpoint_invalid")?;
        state.source = OfflineCheckpoint::decode_from(&bytes[end..])?;
        if state.generation != CHECKPOINT_GENERATION
            || state.parser_generation != tokscale_core::parser_generation()
            || state.upstream != crate::UPSTREAM_COMMIT
            || !state.source.valid()
        {
            return Err("import_checkpoint_generation_mismatch");
        }
        Ok(Self {
            state: Some(state),
            encoded: std::sync::OnceLock::from(bytes.to_vec()),
        })
    }
    pub fn is_empty(&self) -> bool {
        self.state.is_none()
    }
    pub(crate) fn candidate(scope: [u8; 32], source: OfflineCheckpoint) -> Self {
        Self {
            encoded: std::sync::OnceLock::new(),
            state: Some(State {
                generation: CHECKPOINT_GENERATION,
                parser_generation: tokscale_core::parser_generation(),
                upstream: crate::UPSTREAM_COMMIT.to_owned(),
                scope,
                source,
            }),
        }
    }
    pub(crate) fn same_sources(&self, other: &Self) -> bool {
        match (&self.state, &other.state) {
            (Some(old), Some(new)) => {
                old.scope == new.scope && old.source.same_sources(&new.source)
            }
            _ => false,
        }
    }
}

pub(crate) fn scope(
    home: &Path,
    client: &str,
    approved: &[PathBuf],
    roots: Option<&[PathBuf]>,
    first_ms: u64,
) -> Result<[u8; 32], &'static str> {
    // PathBuf's serde representation rejects non-UTF8 names. No lossy spelling
    // may accidentally grant a checkpoint to a different local source.
    let binding = serde_json::to_vec(&(
        home,
        client,
        approved,
        roots,
        first_ms,
        CHECKPOINT_GENERATION,
        tokscale_core::parser_generation(),
    ))
    .map_err(|_| "import_checkpoint_scope_invalid")?;
    Ok(Sha256::digest(binding).into())
}
