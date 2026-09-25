//! Private, per-execution parser state. This is deliberately separate from the
//! upstream cache: removed source observations must never be retained as live.
//!
//! Framing v2 keeps retained rows as opaque row-framed bytes. Loading a
//! checkpoint only reads metadata; rows are decoded once, for the file that
//! reuses them, and handed to the caller without a second copy.
use crate::sessions::codex::{CodexParseState, ParsedCodexFile};
use crate::UnifiedMessage;
use bincode::Options as _;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub const MAX_CHECKPOINT_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_CHECKPOINT_FILES: usize = 65_536;
pub const MAX_CHECKPOINT_OBSERVATIONS: usize = 2_000_000;
// Generation 3: dedup keys are scoped by logical turn id when present, so a
// replayed parent turn collapses against the parent's own record at any fork
// depth. Retained generation-2 keys cannot match new emissions; bumping the
// generation discards them and forces a verified full reparse.
pub const CHECKPOINT_GENERATION: u32 = 3;
/// One retained numeric row never legitimately approaches this size.
const MAX_ROW_BYTES: usize = 1 << 20;

/// Clients whose local parsers have a qualified reuse path. Codex appends are
/// parsed from the verified prefix; the others reuse whole verified files and
/// reparse any changed file.
pub const CHECKPOINT_CLIENTS: [&str; 5] =
    ["codex", "claude", "cursor", "devin-cli", "devin-desktop"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum EntryKind {
    Codex,
    Whole,
}
/// Parser diagnostics measured while a file was parsed, re-emitted when its
/// retained rows are reused so health counters stay identical to a full scan.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct FileCounters {
    pub clamped_records: u64,
    pub fallback_records: u64,
    pub schema_mismatch_records: u64,
}
#[derive(Clone, Debug, Default)]
pub struct OfflineCheckpoint {
    pub(crate) entries: BTreeMap<PathBuf, Entry>,
}
#[derive(Clone, Debug)]
pub(crate) struct Entry {
    kind: EntryKind,
    identity: (u64, u64),
    modified: Option<(u64, u32)>,
    offset: u64,
    digest: [u8; 32],
    context: [u8; 32],
    rows: u64,
    fallback: Vec<usize>,
    counters: FileCounters,
    state: Option<CodexParseState>,
    encoded: Arc<Vec<u8>>,
}
type Metadata = (
    PathBuf,
    EntryKind,
    (u64, u64),
    Option<(u64, u32)>,
    u64,
    [u8; 32],
    [u8; 32],
    u64,
    Vec<usize>,
    FileCounters,
    Option<CodexParseState>,
);
impl Entry {
    fn same_source(&self, other: &Self) -> bool {
        self.kind == other.kind
            && self.identity == other.identity
            && self.modified == other.modified
            && self.offset == other.offset
            && self.digest == other.digest
            && self.context == other.context
    }
    fn structurally_valid(&self) -> bool {
        self.offset <= crate::offline_io::MAX_LOG_BYTES
            && self.rows <= MAX_CHECKPOINT_OBSERVATIONS as u64
            && (self.encoded.len() as u64) >= self.rows.saturating_mul(4)
            && self.encoded.len() <= MAX_CHECKPOINT_BYTES
            && self
                .fallback
                .iter()
                .all(|index| (*index as u64) < self.rows)
            && (self.kind == EntryKind::Codex) == self.state.is_some()
    }
    /// Decodes the retained rows exactly once for the consumer. Any framing or
    /// value defect refuses the entry instead of trusting a partial prefix.
    fn decoded_rows(&self) -> Result<Vec<UnifiedMessage>, &'static str> {
        decode_rows(&self.encoded, self.rows)
    }
}

/// Fixed positional encoding avoids repeating the same twenty field labels in
/// every cached numeric row. It is local and generation-bound, not a wire DTO.
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
fn row_options() -> impl bincode::Options {
    bincode::DefaultOptions::new()
        .with_fixint_encoding()
        .with_limit(MAX_ROW_BYTES as u64)
}
fn encode_rows(rows: &[UnifiedMessage]) -> Result<Vec<u8>, &'static str> {
    let mut bytes = Vec::with_capacity(rows.len().saturating_mul(112).min(MAX_CHECKPOINT_BYTES));
    for row in rows {
        append_row(&mut bytes, row)?;
    }
    Ok(bytes)
}
fn append_row(bytes: &mut Vec<u8>, row: &UnifiedMessage) -> Result<(), &'static str> {
    let start = bytes.len();
    bytes.extend_from_slice(&[0; 4]);
    row_options()
        .serialize_into(
            &mut *bytes,
            &(
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
            ),
        )
        .map_err(|_| "import_checkpoint_limit")?;
    let length = bytes.len() - start - 4;
    if length > MAX_ROW_BYTES || bytes.len() > MAX_CHECKPOINT_BYTES {
        return Err("import_checkpoint_limit");
    }
    bytes[start..start + 4].copy_from_slice(&(length as u32).to_le_bytes());
    Ok(())
}
fn decode_rows(bytes: &[u8], count: u64) -> Result<Vec<UnifiedMessage>, &'static str> {
    if count > MAX_CHECKPOINT_OBSERVATIONS as u64 {
        return Err("import_checkpoint_limit");
    }
    let mut rows = Vec::with_capacity(count as usize);
    let mut at = 0usize;
    for _ in 0..count {
        let length = bytes
            .get(at..at + 4)
            .and_then(|prefix| <[u8; 4]>::try_from(prefix).ok())
            .map(u32::from_le_bytes)
            .ok_or("import_checkpoint_invalid")? as usize;
        if length > MAX_ROW_BYTES {
            return Err("import_checkpoint_invalid");
        }
        let body = bytes
            .get(at + 4..at + 4 + length)
            .ok_or("import_checkpoint_invalid")?;
        let (
            (client, model_id, provider_id, session_id, workspace_key, workspace_label, date),
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
        ): Row = row_options()
            .deserialize(body)
            .map_err(|_| "import_checkpoint_invalid")?;
        if !cost.is_finite() {
            return Err("import_checkpoint_invalid");
        }
        rows.push(UnifiedMessage {
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
        });
        at += 4 + length;
    }
    if at != bytes.len() {
        return Err("import_checkpoint_invalid");
    }
    Ok(rows)
}
struct Bounded<'a>(&'a mut dyn Write, usize);
impl Write for Bounded<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.1 = self
            .1
            .checked_add(bytes.len())
            .filter(|n| *n <= MAX_CHECKPOINT_BYTES)
            .ok_or_else(|| io::Error::other("import_checkpoint_limit"))?;
        self.0.write_all(bytes)?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        self.0.flush()
    }
}
impl OfflineCheckpoint {
    /// Framing v2: count, then length-prefixed metadata and row-framed bytes
    /// per entry. Rows are copied verbatim from the retained encoding.
    pub fn encode_into(&self, output: &mut impl Write) -> Result<(), &'static str> {
        if !self.valid() {
            return Err("import_checkpoint_invalid");
        }
        let mut output = Bounded(output, 0);
        output
            .write_all(&(self.entries.len() as u32).to_le_bytes())
            .map_err(|_| "import_checkpoint_limit")?;
        for (path, entry) in &self.entries {
            let metadata: Metadata = (
                path.clone(),
                entry.kind,
                entry.identity,
                entry.modified,
                entry.offset,
                entry.digest,
                entry.context,
                entry.rows,
                entry.fallback.clone(),
                entry.counters,
                entry.state.clone(),
            );
            let metadata =
                serde_json::to_vec(&metadata).map_err(|_| "import_checkpoint_invalid")?;
            for bytes in [&metadata[..], &entry.encoded[..]] {
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
        let mut input = io::Cursor::new(bytes);
        let mut count = [0; 4];
        input
            .read_exact(&mut count)
            .map_err(|_| "import_checkpoint_invalid")?;
        let count = u32::from_le_bytes(count) as usize;
        if count > MAX_CHECKPOINT_FILES {
            return Err("import_checkpoint_limit");
        }
        let part = |input: &mut io::Cursor<&[u8]>| -> Result<Vec<u8>, &'static str> {
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
        let mut rows = 0u64;
        for _ in 0..count {
            let metadata = part(&mut input)?;
            let (
                path,
                kind,
                identity,
                modified,
                offset,
                digest,
                context,
                entry_rows,
                fallback,
                counters,
                state,
            ): Metadata =
                serde_json::from_slice(&metadata).map_err(|_| "import_checkpoint_invalid")?;
            let encoded = part(&mut input)?;
            rows = rows
                .checked_add(entry_rows)
                .ok_or("import_checkpoint_limit")?;
            if rows > MAX_CHECKPOINT_OBSERVATIONS as u64 {
                return Err("import_checkpoint_limit");
            }
            let entry = Entry {
                kind,
                identity,
                modified,
                offset,
                digest,
                context,
                rows: entry_rows,
                fallback,
                counters,
                state,
                encoded: Arc::new(encoded),
            };
            if !entry.structurally_valid() || result.entries.insert(path, entry).is_some() {
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
                other
                    .entries
                    .get(path)
                    .is_some_and(|other| entry.same_source(other))
            })
    }
    pub fn counts(&self) -> (usize, usize) {
        (
            self.entries.len(),
            self.entries.values().map(|entry| entry.rows as usize).sum(),
        )
    }
    pub fn valid(&self) -> bool {
        let (files, rows) = self.counts();
        files <= MAX_CHECKPOINT_FILES
            && rows <= MAX_CHECKPOINT_OBSERVATIONS
            && self.entries.values().all(Entry::structurally_valid)
    }
}

fn save_entry(path: &Path, entry: Entry) {
    if entry.structurally_valid() {
        crate::offline_io::save_checkpoint_entry(path, entry);
    } else {
        crate::offline_io::checkpoint_capacity();
    }
}

pub(crate) fn parse_codex(path: &Path) -> ParsedCodexFile {
    let previous =
        crate::offline_io::checkpoint_entry(path).filter(|entry| entry.kind == EntryKind::Codex);
    let witness = previous
        .as_ref()
        .and_then(|entry| crate::offline_io::log_witness(path, Some(entry.offset)).ok());
    let usable = previous
        .zip(witness.clone())
        .filter(|(entry, witness)| {
            entry.identity == witness.identity
                && entry.offset <= witness.bytes
                && entry.digest == witness.digest
        })
        .and_then(|(entry, witness)| {
            let rows = entry.decoded_rows().ok()?;
            Some((entry, witness, rows))
        });
    let mut unchanged_entry = None;
    let mut encoded = None;
    let mut parsed = if let Some((entry, witness, rows)) = usable {
        crate::offline_io::reused_file();
        let state = entry.state.clone().unwrap_or_default();
        if entry.offset == witness.bytes {
            let fallback = entry.fallback.clone();
            let offset = entry.offset;
            unchanged_entry = Some(entry);
            ParsedCodexFile {
                messages: rows,
                fallback_timestamp_indices: fallback,
                consumed_offset: offset,
                parse_succeeded: true,
                unresolved_model_events: false,
                state,
            }
        } else {
            let mut messages = rows;
            let mut delta =
                crate::sessions::codex::parse_codex_file_incremental(path, entry.offset, state);
            let mut combined = Vec::clone(&entry.encoded);
            let mut appended = Ok(());
            for row in &delta.messages {
                appended = append_row(&mut combined, row);
                if appended.is_err() {
                    break;
                }
            }
            encoded = Some(appended.map(|()| combined));
            let mut fallback = entry.fallback;
            fallback.extend(
                delta
                    .fallback_timestamp_indices
                    .iter()
                    .map(|index| messages.len() + index),
            );
            messages.append(&mut delta.messages);
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
        save_entry(path, entry);
    } else if parsed.parse_succeeded && !parsed.unresolved_model_events {
        let final_witness = witness
            .filter(|witness| witness.bytes == parsed.consumed_offset)
            .map(Ok)
            .unwrap_or_else(|| crate::offline_io::log_witness(path, Some(parsed.consumed_offset)));
        if let Ok(witness) = final_witness {
            match encoded.unwrap_or_else(|| encode_rows(&parsed.messages)) {
                Ok(encoded) => save_entry(
                    path,
                    Entry {
                        kind: EntryKind::Codex,
                        identity: witness.identity,
                        modified: None,
                        offset: parsed.consumed_offset,
                        digest: witness.complete_digest,
                        context: [0; 32],
                        rows: parsed.messages.len() as u64,
                        fallback: parsed.fallback_timestamp_indices.clone(),
                        counters: FileCounters::default(),
                        state: Some(parsed.state.clone()),
                        encoded: Arc::new(encoded),
                    },
                ),
                Err(_) => crate::offline_io::checkpoint_capacity(),
            }
        } else {
            parsed.parse_succeeded = false;
        }
    }
    crate::offline_io::codex_diagnostics(&parsed.state);
    parsed
}

/// Whole-file reuse for parsers without an incremental state machine. The
/// retained rows are returned only for a file whose identity, modification
/// time, complete content digest and parser context are all unchanged; any
/// other file is parsed again in full and its rows replace the entry. A
/// context that cannot be witnessed disables reuse for that file.
pub(crate) fn parse_whole(
    path: &Path,
    witness: fn(&Path) -> io::Result<crate::offline_io::WholeWitness>,
    context: impl FnOnce() -> Option<[u8; 32]>,
    parse: impl FnOnce() -> Vec<UnifiedMessage>,
) -> Vec<UnifiedMessage> {
    if !crate::offline_io::checkpoint_enabled() {
        return parse();
    }
    let previous =
        crate::offline_io::checkpoint_entry(path).filter(|entry| entry.kind == EntryKind::Whole);
    let Some(context) = context() else {
        return parse();
    };
    let witness = witness(path).ok();
    if let (Some(entry), Some(witness)) = (&previous, &witness) {
        if entry.context == context
            && entry.identity == witness.identity
            && entry.modified == witness.modified
            && entry.offset == witness.bytes
            && entry.digest == witness.digest
        {
            if let Ok(messages) = entry.decoded_rows() {
                crate::offline_io::reused_file();
                crate::offline_io::file_diagnostics(entry.counters);
                save_entry(path, entry.clone());
                return messages;
            }
        }
    }
    crate::offline_io::begin_file_counters();
    let messages = parse();
    let counters = crate::offline_io::take_file_counters();
    let witness = witness.filter(|before| {
        !before.volatile || crate::offline_io::sqlite_witness(path).ok().as_ref() == Some(before)
    });
    if let Some(witness) = witness {
        match encode_rows(&messages) {
            Ok(encoded) => save_entry(
                path,
                Entry {
                    kind: EntryKind::Whole,
                    identity: witness.identity,
                    modified: witness.modified,
                    offset: witness.bytes,
                    digest: witness.digest,
                    context,
                    rows: messages.len() as u64,
                    fallback: Vec::new(),
                    counters,
                    state: None,
                    encoded: Arc::new(encoded),
                },
            ),
            Err(_) => crate::offline_io::checkpoint_capacity(),
        }
    }
    messages
}

/// Related inputs that change a Claude Code transcript's rows without
/// changing the transcript itself: its agent metadata sidecar, cc-mirror
/// variant metadata and the parent sessions a sidechain resolves through.
pub(crate) fn claude_context(path: &Path, home_dir: Option<&Path>) -> Option<[u8; 32]> {
    let mut related = Vec::new();
    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
        related.push(path.with_file_name(format!("{stem}.meta.json")));
    }
    if let Some(variant) = crate::cc_mirror::variant_file_for_session_path(path, home_dir) {
        related.push(variant);
    }
    related.extend(crate::sessions::claudecode::parent_session_paths_for_cache(
        path,
    ));
    crate::offline_io::related_context(&related)
}
pub(crate) fn parse_claude(path: &Path, home_dir: &Path) -> Vec<UnifiedMessage> {
    parse_whole(
        path,
        crate::offline_io::whole_witness,
        || claude_context(path, Some(home_dir)),
        || crate::sessions::claudecode::parse_claude_file_with_home(path, Some(home_dir)),
    )
}
pub(crate) fn parse_cursor(path: &Path) -> Vec<UnifiedMessage> {
    parse_whole(
        path,
        crate::offline_io::whole_witness,
        || Some([0; 32]),
        || crate::sessions::cursor::parse_cursor_file(path),
    )
}
pub(crate) fn parse_devin_cli(path: &Path) -> Vec<UnifiedMessage> {
    parse_whole(
        path,
        crate::offline_io::sqlite_witness,
        || Some([0; 32]),
        || crate::sessions::devin::parse_devin_cli_sqlite(path),
    )
}
pub(crate) fn parse_devin_desktop(
    path: &Path,
    lookup: &crate::sessions::devin::DevinDesktopSessionLookup,
) -> Vec<UnifiedMessage> {
    parse_whole(
        path,
        crate::offline_io::whole_witness,
        || Some(lookup.digest()),
        || crate::sessions::devin::parse_devin_desktop_ndjson_with_lookup(path, lookup),
    )
}
