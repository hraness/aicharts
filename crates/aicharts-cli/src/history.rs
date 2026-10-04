//! `aicharts history`: daily token totals kept on this computer.
//!
//! Collection reads the same local sources as `aicharts stats` and merges
//! each day's client and model rows into one private file. A merge never
//! lowers a retained row, so usage outlives an agent's deleted session files.
//! Nothing here contacts a network service or reads a key: reports read the
//! retained file only, and collection reads local session files only.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::stats::{self, Report, Row, Source, DAY_MS};

pub(crate) mod schedule;
#[cfg(test)]
mod tests;

pub(crate) const SCHEMA_VERSION: u8 = 1;
pub(crate) const PROFILE: &str = "aicharts-history-v1";
pub(crate) const STATUS_SCHEMA: &str = "aicharts.history-status/1";
const STORE_FILE: &str = "usage-history.json";
const STATUS_FILE: &str = "last-collection.json";
#[cfg(unix)]
const LOCK_FILE: &str = "collect.lock";
/// About forty years of a heavy multi-agent workstation; growth past it
/// refuses instead of dropping retained days.
pub(crate) const MAX_HISTORY_ROWS: usize = 131_072;
pub(crate) const MAX_HISTORY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_STATUS_BYTES: u64 = 16 * 1024;
pub(crate) const MAX_HISTORY_CLIENTS: usize = 64;
/// The first collection reads everything the sources still hold; later ones
/// re-read a week so late appends and a missed run are both covered.
pub(crate) const FIRST_COLLECTION_DAYS: u64 = 366;
pub(crate) const ROUTINE_COLLECTION_DAYS: u64 = 7;
pub(crate) const DEFAULT_REPORT_DAYS: u64 = 30;
const MAX_TIME_MS: u64 = 8_640_000_000_000_000;
const MAX_SAFE: u64 = 9_007_199_254_740_991;

const HELP: &str = "Usage: aicharts history <command> [options]

Keep a daily record of your agents' token use on this computer. Collection
reads the same session files as aicharts stats and never uploads anything.
A day that an agent later deletes from its own files stays in the record.

Commands
  enable                    Collect four times a day, starting now
  disable                   Stop collecting; the record stays
  status                    Whether collection is on and what is kept
  report                    Token use from the record (no files are scanned)
  collect                   Read session files into the record once

Report options
  --days N                  The last N UTC days, including today (default 30)
  --since YYYY-MM-DD        First day (with --until; up to 366 days)
  --until YYYY-MM-DD        Last day
  --client ID               One agent (repeatable; aicharts stats --list-clients)
  --json                    The same report aicharts stats --json prints
  --csv                     One row per day, agent, provider and model

Collect options
  --days N                  Re-read the last N days (default 7; 366 the first time)
  --json                    Machine-readable result

The record lives in ~/.aicharts/history (or $AICHARTS_HOME/history). Agents can
query it through aicharts mcp. To publish to aicharts.io instead: aicharts help publish

Examples
  aicharts history enable
  aicharts history report --days 7
  aicharts history report --since 2026-09-01 --until 2026-09-30 --csv > september.csv
";

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClientHistory {
    pub client: String,
    pub latest_at_ms: Option<u64>,
}

/// The retained record. Rows use the shared `client-stats-v2` row contract
/// and stay sorted and unique by (day, client, provider, model, basis).
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Store {
    pub schema_version: u8,
    pub profile: String,
    pub registry_revision: u8,
    pub revision: u64,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub clients: Vec<ClientHistory>,
    pub rows: Vec<Row>,
}

impl Store {
    pub(crate) fn empty(now: u64) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            profile: PROFILE.to_owned(),
            registry_revision: 1,
            revision: 0,
            created_at_ms: now,
            updated_at_ms: now,
            clients: Vec::new(),
            rows: Vec::new(),
        }
    }

    pub(crate) fn first_day(&self) -> Option<u64> {
        self.rows.first().map(|row| row.utc_day)
    }

    pub(crate) fn last_day(&self) -> Option<u64> {
        self.rows.iter().map(|row| row.utc_day).max()
    }
}

/// What one collection did to the record.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MergeCounts {
    /// Rows the record did not have.
    pub added: u64,
    /// Rows where the fresh scan saw at least as much as the record.
    pub updated: u64,
    /// Rows where the record held more than the fresh scan, kept as they were.
    pub kept: u64,
    /// Rows identical in both.
    pub unchanged: u64,
}

/// The last collection's outcome, written beside the record so status reads
/// never parse the record itself.
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LastCollection {
    pub schema_version: u8,
    pub started_at_ms: u64,
    pub completed_at_ms: u64,
    /// `complete`, `partial` (some agents' files were incomplete) or `failed`.
    pub outcome: String,
    pub code: Option<String>,
    pub first_utc_day: Option<u64>,
    pub day_count: Option<u64>,
    pub observed_clients: u64,
    pub incomplete_clients: u64,
    pub counts: MergeCounts,
    pub retained_rows: u64,
    pub revision: u64,
}

type Key = (u64, String, Option<String>, Option<String>, String);

fn key(row: &Row) -> Key {
    (
        row.utc_day,
        row.client.clone(),
        row.provider.clone(),
        row.model.clone(),
        row.token_basis.clone(),
    )
}

fn known_client(client: &str) -> bool {
    aicharts_import::clients().contains(&client)
}

/// Whether a fresh row replaces the retained one. A past day's observations
/// only grow while an agent appends to its files and only shrink when files
/// are deleted or rotated, so the row that saw more records (then more
/// tokens) is the better measurement. A tie takes the fresh row, which
/// carries current pricing estimates.
pub(crate) fn fresh_wins(retained: &Row, fresh: &Row) -> Result<bool, &'static str> {
    let retained_total = stats::row_token_total(&retained.tokens).ok_or("history_store_invalid")?;
    let fresh_total = stats::row_token_total(&fresh.tokens).ok_or("stats_report_invalid")?;
    Ok((fresh.records, fresh_total) >= (retained.records, retained_total))
}

/// Merges one validated fresh report into a copy of the record. Rows absent
/// from the scan stay; a retained row is replaced only when `fresh_wins`.
pub(crate) fn merge(
    store: &Store,
    fresh: &Report,
    now: u64,
) -> Result<(Store, MergeCounts), &'static str> {
    let mut rows: BTreeMap<Key, Row> = store
        .rows
        .iter()
        .map(|row| (key(row), row.clone()))
        .collect();
    let mut counts = MergeCounts::default();
    for row in &fresh.rows {
        let row_key = key(row);
        match rows.get(&row_key) {
            None => {
                rows.insert(row_key, row.clone());
                counts.added += 1;
            }
            Some(existing) if existing == row => counts.unchanged += 1,
            Some(existing) => {
                if fresh_wins(existing, row)? {
                    rows.insert(row_key, row.clone());
                    counts.updated += 1;
                } else {
                    counts.kept += 1;
                }
            }
        }
    }
    if rows.len() > MAX_HISTORY_ROWS {
        return Err("history_store_full");
    }
    let mut clients: BTreeMap<String, Option<u64>> = store
        .clients
        .iter()
        .map(|client| (client.client.clone(), client.latest_at_ms))
        .collect();
    for source in &fresh.sources {
        // A source that was never found says nothing about this computer.
        if matches!(source.status.as_str(), "observed" | "empty" | "incomplete") {
            let latest = clients.entry(source.client.clone()).or_insert(None);
            *latest = match (*latest, source.latest_at_ms) {
                (Some(retained), Some(seen)) => Some(retained.max(seen)),
                (retained, seen) => retained.or(seen),
            };
        }
    }
    if clients.len() > MAX_HISTORY_CLIENTS {
        return Err("history_store_full");
    }
    let clients: Vec<ClientHistory> = clients
        .into_iter()
        .map(|(client, latest_at_ms)| ClientHistory {
            client,
            latest_at_ms,
        })
        .collect();
    let rows: Vec<Row> = rows.into_values().collect();
    let mut next = store.clone();
    if rows != store.rows || clients != store.clients {
        next.rows = rows;
        next.clients = clients;
        next.revision = store
            .revision
            .checked_add(1)
            .filter(|revision| *revision <= MAX_SAFE)
            .ok_or("history_store_full")?;
        next.updated_at_ms = now.max(store.updated_at_ms);
    }
    Ok((next, counts))
}

/// Builds the shared `client-stats-v2` report for one UTC window of the
/// record. `selected` names the agents to report; an agent the record has
/// seen but with no rows in the window is `empty`, one it never saw is
/// `not_found`. The result passes the same validation as `aicharts stats`.
pub(crate) fn report(
    store: &Store,
    first_utc_day: u64,
    day_count: u64,
    selected: Option<&BTreeSet<String>>,
    generated_at_ms: u64,
) -> Result<Report, &'static str> {
    let selected: BTreeSet<String> = match selected {
        Some(selected) => selected.clone(),
        None => store
            .clients
            .iter()
            .map(|client| client.client.clone())
            .collect(),
    };
    let end = first_utc_day
        .checked_add(day_count)
        .ok_or("stats_range_invalid")?;
    let rows: Vec<Row> = store
        .rows
        .iter()
        .filter(|row| {
            row.utc_day >= first_utc_day && row.utc_day < end && selected.contains(&row.client)
        })
        .cloned()
        .collect();
    build_report(
        store,
        rows,
        first_utc_day,
        day_count,
        &selected,
        generated_at_ms,
    )
}

fn build_report(
    store: &Store,
    rows: Vec<Row>,
    first_utc_day: u64,
    day_count: u64,
    selected: &BTreeSet<String>,
    generated_at_ms: u64,
) -> Result<Report, &'static str> {
    if selected.len() > MAX_HISTORY_CLIENTS || !selected.iter().all(|client| known_client(client)) {
        return Err("invalid_option");
    }
    let window_start = first_utc_day
        .checked_mul(DAY_MS)
        .ok_or("stats_range_invalid")?;
    let window_end = first_utc_day
        .checked_add(day_count)
        .and_then(|day| day.checked_mul(DAY_MS))
        .ok_or("stats_range_invalid")?;
    let retained: BTreeMap<&str, Option<u64>> = store
        .clients
        .iter()
        .map(|client| (client.client.as_str(), client.latest_at_ms))
        .collect();
    let mut sources = Vec::with_capacity(selected.len());
    for client in selected {
        let mut records = 0u64;
        let mut bases = BTreeSet::new();
        for row in rows.iter().filter(|row| &row.client == client) {
            records = records
                .checked_add(row.records)
                .ok_or("history_window_too_large")?;
            bases.insert(row.token_basis.as_str());
        }
        let status = if records > 0 {
            "observed"
        } else if retained.contains_key(client.as_str()) {
            "empty"
        } else {
            "not_found"
        };
        // The record keeps each agent's newest observation time only. Report
        // it when it falls inside this window; otherwise it is unknown here.
        let latest_at_ms = retained
            .get(client.as_str())
            .copied()
            .flatten()
            .filter(|latest| {
                records > 0
                    && *latest >= window_start
                    && *latest < window_end
                    && *latest <= generated_at_ms
            });
        sources.push(Source {
            client: client.clone(),
            status: status.to_owned(),
            token_basis: if bases.len() > 1 {
                "mixed"
            } else {
                bases.first().copied().unwrap_or("unavailable")
            }
            .to_owned(),
            records,
            warnings: 0,
            latest_at_ms,
        });
    }
    let (revision, updated_at_ms) = if store.revision > 0 {
        (store.revision, Some(store.updated_at_ms))
    } else {
        (0, None)
    };
    let report = Report {
        schema_version: 2,
        profile: "client-stats-v2".to_owned(),
        registry_revision: 1,
        first_utc_day,
        day_count,
        generated_at_ms,
        revision,
        updated_at_ms,
        sources,
        rows,
    };
    if report.rows.len() > stats::MAX_ROWS {
        return Err("history_window_too_large");
    }
    stats::validate_report(&report).map_err(|code| {
        if code == "stats_report_invalid" {
            "history_store_invalid"
        } else {
            code
        }
    })?;
    Ok(report)
}

/// Checks a parsed record completely before anything reads or extends it.
pub(crate) fn validate_store(store: &Store, now: u64) -> Result<(), &'static str> {
    let invalid = "history_store_invalid";
    if store.schema_version != SCHEMA_VERSION
        || store.profile != PROFILE
        || store.registry_revision != 1
        || store.revision > MAX_SAFE
        || store.created_at_ms > store.updated_at_ms
        || store.updated_at_ms > MAX_TIME_MS
        || store.rows.len() > MAX_HISTORY_ROWS
        || store.clients.len() > MAX_HISTORY_CLIENTS
        || (store.revision == 0 && (!store.rows.is_empty() || !store.clients.is_empty()))
    {
        return Err(invalid);
    }
    let mut previous: Option<&str> = None;
    for client in &store.clients {
        if previous.is_some_and(|before| client.client.as_str() <= before)
            || !known_client(&client.client)
            || client
                .latest_at_ms
                .is_some_and(|latest| latest > store.updated_at_ms)
        {
            return Err(invalid);
        }
        previous = Some(&client.client);
    }
    let clients: BTreeSet<String> = store
        .clients
        .iter()
        .map(|client| client.client.clone())
        .collect();
    let today = now / DAY_MS;
    let mut previous: Option<Key> = None;
    for row in &store.rows {
        let row_key = key(row);
        if previous.as_ref().is_some_and(|before| &row_key <= before)
            || !clients.contains(&row.client)
            || row.utc_day > today
        {
            return Err(invalid);
        }
        previous = Some(row_key);
    }
    // Every row passes the shared report validation, one 366-day window at a
    // time, with each window's sources derived from its own rows.
    let mut start = 0;
    while start < store.rows.len() {
        let first_day = store.rows[start].utc_day;
        let end = store.rows[start..]
            .iter()
            .position(|row| row.utc_day >= first_day + 366)
            .map_or(store.rows.len(), |offset| start + offset);
        let rows = store.rows[start..end].to_vec();
        build_report(store, rows, first_day, 366, &clients, MAX_TIME_MS).map_err(|_| invalid)?;
        start = end;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Files

/// `$AICHARTS_HOME/history`, else `~/.aicharts/history`.
pub(crate) fn directory(env: &dyn Fn(&str) -> Option<String>) -> Result<PathBuf, &'static str> {
    crate::health::aicharts_home(env)
        .map(|home| home.join("history"))
        .ok_or("home_required")
}

pub(crate) fn live_directory() -> Result<PathBuf, &'static str> {
    directory(&|name| std::env::var(name).ok())
}

fn read_bounded(path: &Path, limit: u64) -> Result<Option<Vec<u8>>, &'static str> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("history_unreadable"),
    };
    if !meta.is_file() {
        return Err("history_store_invalid");
    }
    if meta.len() > limit {
        return Err("history_store_full");
    }
    let file = std::fs::File::open(path).map_err(|_| "history_unreadable")?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "history_unreadable")?;
    if bytes.len() as u64 > limit {
        return Err("history_store_full");
    }
    Ok(Some(bytes))
}

/// Reads and validates the record. `None` means collection has not run yet.
pub(crate) fn read_store(dir: &Path, now: u64) -> Result<Option<Store>, &'static str> {
    let Some(bytes) = read_bounded(&dir.join(STORE_FILE), MAX_HISTORY_BYTES)? else {
        return Ok(None);
    };
    let store: Store = serde_json::from_slice(&bytes).map_err(|_| "history_store_invalid")?;
    validate_store(&store, now)?;
    Ok(Some(store))
}

pub(crate) fn read_last_collection(dir: &Path) -> Option<LastCollection> {
    let bytes = read_bounded(&dir.join(STATUS_FILE), MAX_STATUS_BYTES).ok()??;
    let status: LastCollection = serde_json::from_slice(&bytes).ok()?;
    (status.schema_version == 1
        && status.started_at_ms <= status.completed_at_ms
        && status.completed_at_ms <= MAX_TIME_MS
        && matches!(status.outcome.as_str(), "complete" | "partial" | "failed"))
    .then_some(status)
}

/// Creates the record folder owner-only, refusing a symbolic link.
fn private_directory(dir: &Path) -> Result<(), &'static str> {
    if let Some(parent) = dir.parent() {
        match std::fs::symlink_metadata(parent) {
            Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {}
            Ok(_) => return Err("history_unwritable"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                create_private(parent)?;
            }
            Err(_) => return Err("history_unwritable"),
        }
    }
    match std::fs::symlink_metadata(dir) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => Ok(()),
        Ok(_) => Err("history_unwritable"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => create_private(dir),
        Err(_) => Err("history_unwritable"),
    }
}

fn create_private(dir: &Path) -> Result<(), &'static str> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir).map_err(|_| "history_unwritable")
}

/// Writes `bytes` beside `name` and renames it into place, so a reader sees
/// the old file or the new one, never a partial write.
fn write_atomic(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), &'static str> {
    let temp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
    let written = (|| -> std::io::Result<()> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&temp, dir.join(name))?;
        #[cfg(unix)]
        std::fs::File::open(dir)?.sync_all()?;
        Ok(())
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&temp);
        return Err("history_unwritable");
    }
    Ok(())
}

/// One exclusive collector at a time. The lock is advisory and released
/// when the process exits, so a crash never leaves the record locked.
#[cfg(unix)]
struct CollectLock {
    _file: std::fs::File,
}

#[cfg(unix)]
fn lock(dir: &Path) -> Result<CollectLock, &'static str> {
    use std::os::unix::fs::OpenOptionsExt;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(dir.join(LOCK_FILE))
        .map_err(|_| "history_unwritable")?;
    rustix::fs::flock(&file, rustix::fs::FlockOperation::NonBlockingLockExclusive)
        .map_err(|_| "history_busy")?;
    Ok(CollectLock { _file: file })
}

// ---------------------------------------------------------------------------
// Collection

/// The UTC window one collection re-reads.
pub(crate) fn collection_window(
    store: Option<&Store>,
    days: Option<u64>,
    now: u64,
) -> Result<(u64, u64), &'static str> {
    let today = now / DAY_MS;
    let days = match days {
        Some(days) if (1..=366).contains(&days) => days,
        Some(_) => return Err("invalid_option"),
        None if store.is_some_and(|store| !store.rows.is_empty()) => ROUTINE_COLLECTION_DAYS,
        None => FIRST_COLLECTION_DAYS,
    };
    let first = today.saturating_sub(days - 1);
    Ok((first, today - first + 1))
}

/// Everything one collection needs from the outside world, so tests can run
/// the whole path against synthetic scans and folders.
pub(crate) struct Environment<'a> {
    pub dir: PathBuf,
    pub home: PathBuf,
    pub clock: &'a dyn Fn() -> Result<u64, &'static str>,
    pub scan: &'a dyn Fn(&stats::Options, u64) -> Result<Report, &'static str>,
}

pub(crate) fn live_scan(options: &stats::Options, now: u64) -> Result<Report, &'static str> {
    stats::collect(options, now)
}

pub(crate) fn scan_options(
    home: &Path,
    clients: Vec<String>,
    first_utc_day: u64,
    day_count: u64,
) -> stats::Options {
    stats::Options {
        home: home.to_path_buf(),
        clients,
        source_roots: Vec::new(),
        first_utc_day,
        day_count,
        json: false,
        health_json: false,
    }
}

pub(crate) fn all_clients() -> Vec<String> {
    aicharts_import::all_clients()
        .iter()
        .map(|client| (*client).to_owned())
        .collect()
}

#[cfg(unix)]
pub(crate) fn collect(
    env: &Environment,
    days: Option<u64>,
) -> Result<LastCollection, &'static str> {
    private_directory(&env.dir)?;
    let _lock = lock(&env.dir)?;
    let started_at_ms = (env.clock)()?;
    let outcome = collect_locked(env, days, started_at_ms);
    let status = match &outcome {
        Ok(status) => status.clone(),
        Err(code) => LastCollection {
            schema_version: 1,
            started_at_ms,
            completed_at_ms: (env.clock)().unwrap_or(started_at_ms).max(started_at_ms),
            outcome: "failed".to_owned(),
            code: Some((*code).to_owned()),
            first_utc_day: None,
            day_count: None,
            observed_clients: 0,
            incomplete_clients: 0,
            counts: MergeCounts::default(),
            retained_rows: 0,
            revision: 0,
        },
    };
    // The status file is advisory; a failure to write it never hides the
    // collection's own result.
    if let Ok(bytes) = serde_json::to_vec(&status) {
        let _ = write_atomic(&env.dir, STATUS_FILE, &bytes);
    }
    outcome
}

#[cfg(not(unix))]
pub(crate) fn collect(
    _env: &Environment,
    _days: Option<u64>,
) -> Result<LastCollection, &'static str> {
    Err("history_requires_unix")
}

/// Reads each agent separately, so one agent whose files cannot be read, or
/// whose report fails validation, never blocks the others. A failed agent
/// counts as incomplete and leaves its retained rows as they were.
#[cfg(unix)]
fn collect_locked(
    env: &Environment,
    days: Option<u64>,
    started_at_ms: u64,
) -> Result<LastCollection, &'static str> {
    let store = read_store(&env.dir, started_at_ms)?;
    let (first_utc_day, day_count) = collection_window(store.as_ref(), days, started_at_ms)?;
    let base = store.unwrap_or_else(|| Store::empty(started_at_ms));
    let mut next = base.clone();
    let mut counts = MergeCounts::default();
    let (mut observed, mut incomplete) = (0u64, 0u64);
    for client in all_clients() {
        let options = scan_options(&env.home, vec![client.clone()], first_utc_day, day_count);
        let now = (env.clock)()?.max(started_at_ms);
        let fresh = match (env.scan)(&options, now)
            .and_then(|report| stats::validate_report(&report).map(|()| report))
        {
            Ok(report) => report,
            Err(code) => {
                incomplete += 1;
                diagnostic(&client, code);
                continue;
            }
        };
        for source in &fresh.sources {
            match source.status.as_str() {
                "observed" => observed += 1,
                "incomplete" => incomplete += 1,
                _ => {}
            }
        }
        let merged_at = (env.clock)()?.max(now);
        let (merged, added) = merge(&next, &fresh, merged_at)?;
        counts.added += added.added;
        counts.updated += added.updated;
        counts.kept += added.kept;
        counts.unchanged += added.unchanged;
        next = merged;
    }
    let completed_at_ms = (env.clock)()?.max(started_at_ms);
    validate_store(&next, completed_at_ms)?;
    if next != base || !env.dir.join(STORE_FILE).exists() {
        let bytes = serde_json::to_vec(&next).map_err(|_| "history_unwritable")?;
        if bytes.len() as u64 > MAX_HISTORY_BYTES {
            return Err("history_store_full");
        }
        write_atomic(&env.dir, STORE_FILE, &bytes)?;
    }
    Ok(LastCollection {
        schema_version: 1,
        started_at_ms,
        completed_at_ms,
        outcome: if incomplete > 0 {
            "partial"
        } else {
            "complete"
        }
        .to_owned(),
        code: None,
        first_utc_day: Some(first_utc_day),
        day_count: Some(day_count),
        observed_clients: observed,
        incomplete_clients: incomplete,
        counts,
        retained_rows: next.rows.len() as u64,
        revision: next.revision,
    })
}

/// The fixed code for one agent on stderr, never a path or source text.
fn diagnostic(client: &str, code: &str) {
    if known_client(client)
        && code.len() <= 100
        && code
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
    {
        eprintln!("aicharts: source={client} code={code}");
    }
}

// ---------------------------------------------------------------------------
// Output

pub(crate) fn utc_date(day: u64) -> Result<String, &'static str> {
    let seconds = i64::try_from(day)
        .ok()
        .and_then(|day| day.checked_mul(86_400))
        .ok_or("stats_range_invalid")?;
    let date = time::OffsetDateTime::from_unix_timestamp(seconds)
        .map_err(|_| "stats_range_invalid")?
        .date();
    Ok(format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        u8::from(date.month()),
        date.day()
    ))
}

fn csv_field(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

pub(crate) const CSV_HEADER: &str = "date,client,provider,model,token_basis,input_tokens,cache_read_tokens,cache_write_tokens,output_tokens,reasoning_tokens,total_tokens,records,reported_cost_microusd,estimated_cost_microusd,duration_ms\n";

/// Exact integers, one line per report row. Unknown costs and durations stay
/// empty, never zero.
pub(crate) fn csv(report: &Report) -> Result<String, &'static str> {
    let mut out = String::from(CSV_HEADER);
    for row in &report.rows {
        let total = stats::row_token_total(&row.tokens).ok_or("stats_report_invalid")?;
        let fields = [
            utc_date(row.utc_day)?,
            row.client.clone(),
            row.provider.clone().unwrap_or_default(),
            row.model.clone().unwrap_or_default(),
            row.token_basis.clone(),
            row.tokens.input.clone(),
            row.tokens.cache_read.clone(),
            row.tokens.cache_write.clone(),
            row.tokens.output.clone(),
            row.tokens.reasoning.clone(),
            total.to_string(),
            row.records.to_string(),
            row.reported_cost_microusd.clone().unwrap_or_default(),
            row.estimated_cost_microusd.clone().unwrap_or_default(),
            row.duration_ms.clone().unwrap_or_default(),
        ];
        let line: Vec<String> = fields.iter().map(|field| csv_field(field)).collect();
        out.push_str(&line.join(","));
        out.push('\n');
    }
    Ok(out)
}

fn grouped(value: u128) -> String {
    let digits = value.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

fn text_report(report: &Report) -> Result<String, &'static str> {
    use std::fmt::Write;
    let first = utc_date(report.first_utc_day)?;
    let last = utc_date(report.first_utc_day + report.day_count - 1)?;
    let mut out =
        format!("aicharts usage history, {first} to {last} (UTC). Kept on this computer.\n");
    if report.sources.is_empty() {
        out.push_str("Nothing is recorded yet. Run aicharts history collect, or aicharts history enable to collect on a schedule.\n");
        return Ok(out);
    }
    for source in &report.sources {
        let mut total = 0u128;
        for row in report.rows.iter().filter(|row| row.client == source.client) {
            total = aicharts_metrics::checked_add(
                total,
                stats::row_token_total(&row.tokens).ok_or("stats_report_invalid")?,
            )
            .map_err(|_| "stats_value_limit")?;
        }
        let _ = writeln!(
            out,
            "{}: {} tokens · {} records{}",
            source.client,
            grouped(total),
            grouped(u128::from(source.records)),
            if source.status == "empty" {
                " · nothing in this period"
            } else {
                ""
            }
        );
    }
    out.push_str("Breakdowns: --json (open it at aicharts.io/usage/details; the file stays in your browser) or --csv.\n");
    Ok(out)
}

// ---------------------------------------------------------------------------
// Commands

struct ReportOptions {
    first_utc_day: u64,
    day_count: u64,
    clients: Option<BTreeSet<String>>,
    format: Format,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Format {
    Text,
    Json,
    Csv,
}

/// The UTC window from `--days`, or `--since`/`--until`, ending no later
/// than today and spanning at most 366 days.
pub(crate) fn window(
    days: Option<u64>,
    since: Option<&str>,
    until: Option<&str>,
    now: u64,
) -> Result<(u64, u64), &'static str> {
    let today = now / DAY_MS;
    if days.is_some() && (since.is_some() || until.is_some()) {
        return Err("invalid_option");
    }
    let end = until.map(stats::date_day).transpose()?.unwrap_or(today);
    let start = match (days, since) {
        (Some(days), _) if (1..=366).contains(&days) => end.saturating_sub(days - 1),
        (Some(_), _) => return Err("stats_range_invalid"),
        (None, Some(since)) => stats::date_day(since)?,
        (None, None) => end.saturating_sub(DEFAULT_REPORT_DAYS - 1),
    };
    let day_count = end
        .checked_sub(start)
        .and_then(|span| span.checked_add(1))
        .filter(|count| *count <= 366)
        .ok_or("stats_range_invalid")?;
    if end > today {
        return Err("stats_range_invalid");
    }
    Ok((start, day_count))
}

fn report_options(args: &[String], now: u64) -> Result<ReportOptions, &'static str> {
    let mut days = None;
    let (mut since, mut until) = (None, None);
    let mut clients = BTreeSet::new();
    let mut format = Format::Text;
    let mut args = args.iter();
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--json" if format == Format::Text => format = Format::Json,
            "--csv" if format == Format::Text => format = Format::Csv,
            "--days" | "--since" | "--until" | "--client" => {
                let value = args
                    .next()
                    .filter(|value| !value.is_empty() && !value.starts_with("--"))
                    .ok_or("missing_option_value")?;
                match flag.as_str() {
                    "--days" if days.is_none() => {
                        days = Some(value.parse::<u64>().map_err(|_| "invalid_option")?)
                    }
                    "--since" if since.is_none() => since = Some(value.clone()),
                    "--until" if until.is_none() => until = Some(value.clone()),
                    "--client" if known_client(value) && clients.len() < MAX_HISTORY_CLIENTS => {
                        if !clients.insert(value.clone()) {
                            return Err("invalid_option");
                        }
                    }
                    _ => return Err("invalid_option"),
                }
            }
            _ => return Err("invalid_option"),
        }
    }
    let (first_utc_day, day_count) = window(days, since.as_deref(), until.as_deref(), now)?;
    Ok(ReportOptions {
        first_utc_day,
        day_count,
        clients: (!clients.is_empty()).then_some(clients),
        format,
    })
}

fn run_report(args: &[String], dir: &Path, now: u64) -> Result<String, &'static str> {
    let options = report_options(args, now)?;
    let store = read_store(dir, now)?.unwrap_or_else(|| Store::empty(now));
    let report = report(
        &store,
        options.first_utc_day,
        options.day_count,
        options.clients.as_ref(),
        now,
    )?;
    match options.format {
        Format::Json => serde_json::to_string(&report)
            .map(|json| json + "\n")
            .map_err(|_| "stats_encode_failed"),
        Format::Csv => csv(&report),
        Format::Text => text_report(&report),
    }
}

fn collect_options(args: &[String]) -> Result<(Option<u64>, bool, bool), &'static str> {
    let (mut days, mut json, mut scheduled) = (None, false, false);
    let mut args = args.iter();
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--json" if !json => json = true,
            "--scheduled" if !scheduled => scheduled = true,
            "--days" if days.is_none() => {
                let value = args.next().ok_or("missing_option_value")?;
                days = Some(value.parse::<u64>().map_err(|_| "invalid_option")?);
            }
            _ => return Err("invalid_option"),
        }
    }
    Ok((days, json, scheduled))
}

fn live_home() -> Result<PathBuf, &'static str> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|home| home.is_absolute())
        .ok_or("home_required")
}

fn collection_text(status: &LastCollection) -> Result<String, &'static str> {
    let range = match (status.first_utc_day, status.day_count) {
        (Some(first), Some(count)) => format!(
            "{} to {}",
            utc_date(first)?,
            utc_date(first + count.saturating_sub(1))?
        ),
        _ => "no days".to_owned(),
    };
    Ok(format!(
        "Read {range} from {} agents' session files{}. Added {} rows, raised {}, kept {} that the files no longer hold. The record now has {} rows. Nothing was uploaded.\n",
        status.observed_clients,
        if status.incomplete_clients > 0 {
            format!(" ({} could not be read completely)", status.incomplete_clients)
        } else {
            String::new()
        },
        status.counts.added,
        status.counts.updated,
        status.counts.kept,
        status.retained_rows,
    ))
}

fn run_collect(args: &[String]) -> Result<String, &'static str> {
    let (days, json, scheduled) = collect_options(args)?;
    let env = Environment {
        dir: live_directory()?,
        home: live_home()?,
        clock: &stats::now_ms,
        scan: &live_scan,
    };
    let status = collect(&env, days)?;
    if json {
        return serde_json::to_string(&serde_json::json!({
            "schemaVersion": 1,
            "operation": "history-collect",
            "uploaded": false,
            "collection": status,
        }))
        .map(|json| json + "\n")
        .map_err(|_| "stats_encode_failed");
    }
    if scheduled {
        // One line per scheduled pass in the collector log.
        return Ok(format!(
            "history collect: {} rows={} added={} raised={} kept={}\n",
            status.outcome,
            status.retained_rows,
            status.counts.added,
            status.counts.updated,
            status.counts.kept
        ));
    }
    collection_text(&status)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StatusData {
    pub collecting: &'static str,
    pub scheduler: &'static str,
    pub directory: String,
    pub record: Option<RecordSummary>,
    pub last_collection: Option<LastCollection>,
    pub uploaded: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecordSummary {
    pub rows: u64,
    pub first_date: Option<String>,
    pub last_date: Option<String>,
    pub clients: Vec<String>,
    pub revision: u64,
    pub updated_at_ms: u64,
}

pub(crate) fn status_data(dir: &Path, now: u64) -> Result<StatusData, &'static str> {
    let record = match read_store(dir, now)? {
        Some(store) => Some(RecordSummary {
            rows: store.rows.len() as u64,
            first_date: store.first_day().map(utc_date).transpose()?,
            last_date: store.last_day().map(utc_date).transpose()?,
            clients: store
                .clients
                .iter()
                .map(|client| client.client.clone())
                .collect(),
            revision: store.revision,
            updated_at_ms: store.updated_at_ms,
        }),
        None => None,
    };
    let scheduler = schedule::live_state();
    Ok(StatusData {
        collecting: scheduler.state,
        scheduler: scheduler.kind,
        directory: dir.display().to_string(),
        record,
        last_collection: read_last_collection(dir),
        uploaded: false,
    })
}

fn ago(now: u64, then: u64) -> String {
    let minutes = now.saturating_sub(then) / 60_000;
    match minutes {
        0 => "just now".to_owned(),
        1 => "1 minute ago".to_owned(),
        2..=119 => format!("{minutes} minutes ago"),
        _ if minutes < 48 * 60 => format!("{} hours ago", minutes / 60),
        _ => format!("{} days ago", minutes / (24 * 60)),
    }
}

fn status_text(data: &StatusData, now: u64) -> String {
    let mut out = match data.collecting {
        "on" => "Usage history: on. aicharts collects four times a day on this computer.\n".to_owned(),
        "outdated" => "Usage history: on, but it points at an older aicharts. Run aicharts history enable to update it.\n".to_owned(),
        "not-ours" => "Usage history: a scheduler entry with aicharts' name exists that aicharts did not write; it is left alone.\n".to_owned(),
        "unsupported" => "Usage history: scheduled collection isn't available on this system. Run aicharts history collect when you want to update the record.\n".to_owned(),
        _ => "Usage history: off. Turn it on with aicharts history enable.\n".to_owned(),
    };
    match &data.record {
        Some(record) if record.rows > 0 => out.push_str(&format!(
            "Kept: {} to {}, {} rows from {}.\n",
            record.first_date.as_deref().unwrap_or("?"),
            record.last_date.as_deref().unwrap_or("?"),
            grouped(u128::from(record.rows)),
            record.clients.join(", ")
        )),
        _ => out.push_str("Nothing is recorded yet.\n"),
    }
    if let Some(last) = &data.last_collection {
        out.push_str(&match last.outcome.as_str() {
            "failed" => format!(
                "The last collection failed {} ({}).\n",
                ago(now, last.completed_at_ms),
                last.code.as_deref().unwrap_or("unknown")
            ),
            "partial" => format!(
                "Last collected {}; {} agents' files could not be read completely.\n",
                ago(now, last.completed_at_ms),
                last.incomplete_clients
            ),
            _ => format!("Last collected {}.\n", ago(now, last.completed_at_ms)),
        });
    }
    out.push_str(&format!(
        "Folder: {}\nNothing is uploaded.\n",
        data.directory
    ));
    out
}

fn run_status(args: &[String]) -> Result<String, &'static str> {
    let json = match args {
        [] => false,
        [flag] if flag == "--json" => true,
        _ => return Err("invalid_option"),
    };
    let now = stats::now_ms()?;
    let data = status_data(&live_directory()?, now)?;
    if json {
        serde_json::to_string(&serde_json::json!({
            "ok": true,
            "schema": STATUS_SCHEMA,
            "data": data,
        }))
        .map(|json| json + "\n")
        .map_err(|_| "stats_encode_failed")
    } else {
        Ok(status_text(&data, now))
    }
}

/// `aicharts setup` with no publishing options: keep usage history locally.
pub(crate) fn setup_local(json: bool) -> Result<String, &'static str> {
    let mut args = vec!["history".to_owned(), "enable".to_owned()];
    if json {
        args.push("--json".to_owned());
    }
    let enabled = schedule::run_enable(&args[2..])?;
    if json {
        return Ok(enabled);
    }
    Ok(format!(
        "{enabled}\nTo publish your usage to aicharts.io as well, run aicharts help publish.\n"
    ))
}

pub(crate) fn run(args: &[String]) -> Result<String, &'static str> {
    if let Some(crate::help::Help::Page(page)) = crate::help::resolve(args) {
        return Ok(page);
    }
    match args.get(1).map(String::as_str) {
        None => Ok(HELP.to_owned()),
        Some("report") => run_report(&args[2..], &live_directory()?, stats::now_ms()?),
        Some("collect") => run_collect(&args[2..]),
        Some("status") => run_status(&args[2..]),
        Some("enable") => schedule::run_enable(&args[2..]),
        Some("disable") => schedule::run_disable(&args[2..]),
        Some(_) => Err("history_command_required"),
    }
}

pub(crate) fn help() -> &'static str {
    HELP
}
