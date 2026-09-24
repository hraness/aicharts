//! Private, per-execution parser state. This is deliberately separate from the
//! upstream cache: removed source observations must never be retained as live.
use crate::sessions::codex::{CodexParseState, ParsedCodexFile};
use crate::UnifiedMessage;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub const MAX_CHECKPOINT_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_CHECKPOINT_FILES: usize = 65_536;
pub const MAX_CHECKPOINT_OBSERVATIONS: usize = 2_000_000;
pub const CHECKPOINT_GENERATION: u32 = 2;

#[derive(Clone, Debug, Default)]
pub struct OfflineCheckpoint {
    pub(crate) entries: BTreeMap<PathBuf, Entry>,
}
#[derive(Clone, Debug)]
pub(crate) struct Entry {
    identity: (u64, u64),
    offset: u64,
    digest: [u8; 32],
    messages: Vec<Arc<Vec<UnifiedMessage>>>,
    fallback: Vec<usize>,
    state: CodexParseState,
    encoded_messages: Arc<Vec<u8>>,
}
impl Entry {
    fn rows(&self) -> usize {
        self.messages.iter().map(|chunk| chunk.len()).sum()
    }
    fn copied_messages(&self) -> Vec<UnifiedMessage> {
        self.messages
            .iter()
            .flat_map(|chunk| chunk.iter().cloned())
            .collect()
    }
}

/// Fixed positional encoding avoids repeating the same twenty field labels in
/// every cached numeric row. It is local and generation-bound, not a wire DTO.
mod compact_messages {
    use super::*;
    use serde::ser::SerializeSeq;
    type Row = (
        (
            String,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            String,
        ),
        (
            i64,
            crate::TokenBreakdown,
            f64,
            crate::sessions::CostSource,
            Option<i64>,
            i32,
            Option<String>,
            Option<String>,
            Option<String>,
            bool,
            bool,
            bool,
        ),
    );
    pub(super) fn serialize<S: serde::Serializer>(
        rows: &[UnifiedMessage],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        let mut sequence = serializer.serialize_seq(Some(rows.len()))?;
        for row in rows.iter() {
            sequence.serialize_element(&(
                (
                    &row.client,
                    &row.model_id,
                    &row.provider_id,
                    &row.session_id,
                    &row.workspace_key,
                    &row.workspace_label,
                    &row.date,
                ),
                (
                    row.timestamp,
                    &row.tokens,
                    row.cost,
                    &row.cost_source,
                    row.duration_ms,
                    row.message_count,
                    &row.agent,
                    &row.dedup_key,
                    &row.session_title,
                    row.is_turn_start,
                    row.model_attribution_conflicted,
                    row.tokens_estimated,
                ),
            ))?;
        }
        sequence.end()
    }
    pub(super) fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Arc<Vec<UnifiedMessage>>, D::Error> {
        let rows: Vec<Row> = Vec::deserialize(deserializer)?;
        Ok(Arc::new(
            rows.into_iter()
                .map(
                    |(
                        (
                            client,
                            model_id,
                            provider_id,
                            session_id,
                            workspace_key,
                            workspace_label,
                            date,
                        ),
                        (
                            timestamp,
                            tokens,
                            cost,
                            cost_source,
                            duration_ms,
                            message_count,
                            agent,
                            dedup_key,
                            session_title,
                            is_turn_start,
                            model_attribution_conflicted,
                            tokens_estimated,
                        ),
                    )| UnifiedMessage {
                        client,
                        model_id,
                        provider_id,
                        session_id,
                        workspace_key,
                        workspace_label,
                        date,
                        timestamp,
                        tokens,
                        cost,
                        cost_source,
                        duration_ms,
                        message_count,
                        agent,
                        dedup_key,
                        session_title,
                        is_turn_start,
                        model_attribution_conflicted,
                        tokens_estimated,
                    },
                )
                .collect(),
        ))
    }
}
struct Rows<'a>(&'a [UnifiedMessage]);
impl Serialize for Rows<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        compact_messages::serialize(self.0, serializer)
    }
}
#[derive(Deserialize)]
struct DecodedRows(#[serde(with = "compact_messages")] Arc<Vec<UnifiedMessage>>);
struct Bounded(Vec<u8>);
impl Write for Bounded {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self
            .0
            .len()
            .checked_add(bytes.len())
            .is_none_or(|n| n > MAX_CHECKPOINT_BYTES)
        {
            return Err(std::io::Error::other("import_checkpoint_limit"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn encode_rows(rows: &[UnifiedMessage]) -> Result<Arc<Vec<u8>>, &'static str> {
    let mut bytes = Bounded(Vec::new());
    serde_json::to_writer(&mut bytes, &Rows(rows)).map_err(|_| "import_checkpoint_limit")?;
    Ok(Arc::new(bytes.0))
}
fn append_rows(
    previous: &Arc<Vec<u8>>,
    rows: &[UnifiedMessage],
) -> Result<Arc<Vec<u8>>, &'static str> {
    if rows.is_empty() {
        return Ok(Arc::clone(previous));
    }
    let delta = encode_rows(rows)?;
    if previous.len() == 2 {
        return Ok(delta);
    }
    let mut combined = Bounded(Vec::new());
    combined
        .write_all(&previous[..previous.len() - 1])
        .map_err(|_| "import_checkpoint_limit")?;
    combined
        .write_all(b",")
        .map_err(|_| "import_checkpoint_limit")?;
    combined
        .write_all(&delta[1..])
        .map_err(|_| "import_checkpoint_limit")?;
    Ok(Arc::new(combined.0))
}
impl OfflineCheckpoint {
    /// Framing v1: count, then length-prefixed metadata and compact rows. Rows
    /// are copied from the verified decoded/encoded pair, never reconstructed
    /// by trusting byte offsets supplied by a caller.
    pub fn encode_into(&self, output: &mut impl Write) -> Result<(), &'static str> {
        if !self.valid() {
            return Err("import_checkpoint_invalid");
        }
        output
            .write_all(&(self.entries.len() as u32).to_le_bytes())
            .map_err(|_| "import_checkpoint_limit")?;
        for (path, entry) in &self.entries {
            let metadata = serde_json::to_vec(&(
                path,
                entry.identity,
                entry.offset,
                entry.digest,
                &entry.fallback,
                &entry.state,
            ))
            .map_err(|_| "import_checkpoint_invalid")?;
            for bytes in [&metadata[..], &entry.encoded_messages[..]] {
                output
                    .write_all(&(bytes.len() as u64).to_le_bytes())
                    .map_err(|_| "import_checkpoint_limit")?;
                output
                    .write_all(bytes)
                    .map_err(|_| "import_checkpoint_limit")?;
            }
        }
        Ok(())
    }
    pub fn decode_from(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() > MAX_CHECKPOINT_BYTES {
            return Err("import_checkpoint_limit");
        }
        let mut input = std::io::Cursor::new(bytes);
        let mut count = [0; 4];
        input
            .read_exact(&mut count)
            .map_err(|_| "import_checkpoint_invalid")?;
        let count = u32::from_le_bytes(count) as usize;
        if count > MAX_CHECKPOINT_FILES {
            return Err("import_checkpoint_limit");
        }
        let part = |input: &mut std::io::Cursor<&[u8]>| -> Result<Vec<u8>, &'static str> {
            let mut size = [0; 8];
            input
                .read_exact(&mut size)
                .map_err(|_| "import_checkpoint_invalid")?;
            let size = u64::from_le_bytes(size);
            if size > (bytes.len() as u64).saturating_sub(input.position()) {
                return Err("import_checkpoint_invalid");
            }
            let mut value = vec![0; size as usize];
            input
                .read_exact(&mut value)
                .map_err(|_| "import_checkpoint_invalid")?;
            Ok(value)
        };
        let mut result = Self::default();
        let mut rows = 0usize;
        for _ in 0..count {
            let metadata = part(&mut input)?;
            let (path, identity, offset, digest, fallback, state) =
                serde_json::from_slice(&metadata).map_err(|_| "import_checkpoint_invalid")?;
            let encoded_messages = part(&mut input)?;
            let DecodedRows(messages) = serde_json::from_slice(&encoded_messages)
                .map_err(|_| "import_checkpoint_invalid")?;
            rows = rows
                .checked_add(messages.len())
                .ok_or("import_checkpoint_limit")?;
            if rows > MAX_CHECKPOINT_OBSERVATIONS {
                return Err("import_checkpoint_limit");
            }
            if result
                .entries
                .insert(
                    path,
                    Entry {
                        identity,
                        offset,
                        digest,
                        fallback,
                        state,
                        messages: vec![messages],
                        encoded_messages: Arc::new(encoded_messages),
                    },
                )
                .is_some()
            {
                return Err("import_checkpoint_invalid");
            }
        }
        if input.position() != bytes.len() as u64 || !result.valid() {
            return Err("import_checkpoint_invalid");
        }
        Ok(result)
    }
    pub fn same_sources(&self, other: &Self) -> bool {
        self.entries.len() == other.entries.len()
            && self.entries.iter().all(|(path, entry)| {
                other.entries.get(path).is_some_and(|other| {
                    entry.identity == other.identity
                        && entry.offset == other.offset
                        && entry.digest == other.digest
                })
            })
    }
    pub fn counts(&self) -> (usize, usize) {
        (
            self.entries.len(),
            self.entries.values().map(Entry::rows).sum(),
        )
    }
    pub fn valid(&self) -> bool {
        let (files, rows) = self.counts();
        files <= MAX_CHECKPOINT_FILES
            && rows <= MAX_CHECKPOINT_OBSERVATIONS
            && self.entries.values().all(|entry| {
                entry.offset <= crate::offline_io::MAX_LOG_BYTES
                    && entry.fallback.iter().all(|index| *index < entry.rows())
                    && entry
                        .messages
                        .iter()
                        .flat_map(|chunk| chunk.iter())
                        .all(|row| row.cost.is_finite())
            })
    }
}

pub(crate) fn parse_codex(path: &Path) -> ParsedCodexFile {
    let previous = crate::offline_io::checkpoint_entry(path);
    let witness = previous
        .as_ref()
        .and_then(|entry| crate::offline_io::log_witness(path, Some(entry.offset)).ok());
    let usable = previous.zip(witness.clone()).filter(|(entry, witness)| {
        entry.identity == witness.identity
            && entry.offset <= witness.bytes
            && entry.digest == witness.digest
    });
    let mut unchanged_entry = None;
    let mut encoded_messages = None;
    let mut retained_chunks = None;
    let mut parsed = if let Some((entry, witness)) = usable {
        crate::offline_io::reused_file();
        if entry.offset == witness.bytes {
            unchanged_entry = Some(entry.clone());
            ParsedCodexFile {
                messages: entry.copied_messages(),
                fallback_timestamp_indices: entry.fallback,
                consumed_offset: entry.offset,
                parse_succeeded: true,
                unresolved_model_events: false,
                state: entry.state,
            }
        } else {
            let mut messages = entry.copied_messages();
            let mut chunks = entry.messages.clone();
            let mut delta = crate::sessions::codex::parse_codex_file_incremental(
                path,
                entry.offset,
                entry.state,
            );
            encoded_messages = Some(append_rows(&entry.encoded_messages, &delta.messages));
            let mut fallback = entry.fallback;
            fallback.extend(
                delta
                    .fallback_timestamp_indices
                    .iter()
                    .map(|index| messages.len() + index),
            );
            if !delta.messages.is_empty() {
                let chunk = Arc::new(std::mem::take(&mut delta.messages));
                messages.extend(chunk.iter().cloned());
                chunks.push(chunk);
            }
            retained_chunks = Some(chunks);
            delta.messages = messages;
            delta.fallback_timestamp_indices = fallback;
            delta
        }
    } else {
        crate::sessions::codex::parse_codex_file_incremental(path, 0, CodexParseState::default())
    };
    // A previously unknown model can be resolved by a later record. Such a
    // prefix is always replayed rather than freezing its provisional rows.
    if let Some(entry) = unchanged_entry {
        crate::offline_io::save_checkpoint_entry(path, entry);
    } else if parsed.parse_succeeded && !parsed.unresolved_model_events {
        let final_witness = witness
            .filter(|witness| witness.bytes == parsed.consumed_offset)
            .map(Ok)
            .unwrap_or_else(|| crate::offline_io::log_witness(path, Some(parsed.consumed_offset)));
        if let Ok(witness) = final_witness {
            let encoded = encoded_messages.unwrap_or_else(|| encode_rows(&parsed.messages));
            if let Ok(encoded_messages) = encoded {
                crate::offline_io::save_checkpoint_entry(
                    path,
                    Entry {
                        identity: witness.identity,
                        offset: parsed.consumed_offset,
                        digest: witness.complete_digest,
                        messages: retained_chunks
                            .unwrap_or_else(|| vec![Arc::new(parsed.messages.clone())]),
                        fallback: parsed.fallback_timestamp_indices.clone(),
                        state: parsed.state.clone(),
                        encoded_messages,
                    },
                );
            } else {
                crate::offline_io::checkpoint_capacity();
            }
        } else {
            parsed.parse_succeeded = false;
        }
    }
    crate::offline_io::codex_diagnostics(&parsed.state);
    parsed
}
