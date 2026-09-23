//! AI Charts' only admitted entry point into the pinned local parsers.
pub use crate::offline_io::{
    ReadReceipt, MAX_BYTES, MAX_FILES, MAX_FILE_BYTES, MAX_LOG_BYTES, MAX_ROWS, MAX_SQLITE_BYTES,
};
use crate::{LocalParseOptions, ScannerSettings, UnifiedMessage};
use std::path::{Path, PathBuf};
#[cfg(test)]
mod tests;

pub const UPSTREAM_COMMIT: &str = "d8fd670a46857e5290e71b10245dc522a344fc17";

pub struct LocalImport {
    pub messages: Vec<UnifiedMessage>,
    pub receipt: ReadReceipt,
}

/// Local source formats, not authenticated acquisition integrations. Additional
/// channels belong to their primary parser; Synthetic and 9Router are explicit
/// cross-client attribution lanes. An empty selector never means scan all.
pub fn clients() -> Vec<&'static str> {
    let mut ids = crate::ClientId::iter()
        .map(|c| c.as_str())
        .collect::<Vec<_>>();
    ids.extend(["synthetic", "9router"]);
    ids
}

/// Disjoint source owners for a complete scan. GJC owns its 9Router channel;
/// the Synthetic lane owns only Octofriend/native Synthetic rows.
pub fn all_clients() -> Vec<&'static str> {
    let mut ids = crate::ClientId::iter()
        .map(|c| c.as_str())
        .collect::<Vec<_>>();
    ids.push("synthetic");
    ids
}

pub fn token_basis(message: &UnifiedMessage) -> &'static str {
    if matches!(message.client.as_str(), "crush" | "warp")
        || [
            message.tokens.input,
            message.tokens.output,
            message.tokens.cache_read,
            message.tokens.cache_write,
            message.tokens.reasoning,
        ]
        .iter()
        .all(|value| *value == 0)
    {
        "unavailable"
    } else if message.tokens_estimated {
        "estimated"
    } else {
        "reported"
    }
}

/// Read one client with source caches, automatic pricing, environment-root
/// discovery, and every HTTP constructor disabled. No source row is publishable
/// when a detected read, syntax, boundary, stability, or resource check fails.
/// Unknown schema variants remain an explicit qualification limitation: upstream
/// parsers intentionally ignore records that do not describe measured usage.
pub fn collect(
    home: &Path,
    client: &str,
    approved_roots: &[PathBuf],
) -> Result<LocalImport, Vec<&'static str>> {
    collect_inner(home, client, approved_roots, None, None)
}

/// Exclusive usage-store roots. No default or environment roots are searched.
/// Roots are leaf stores (for example a Cursor cache directory or Codex sessions
/// directory), not alternate home directories. Include companion directories
/// explicitly, or select their common application data root. Ambiguous copies
/// of a single cumulative database fail rather than silently selecting one.
pub fn collect_profile(
    home: &Path,
    client: &str,
    approved_roots: &[PathBuf],
    source_roots: &[PathBuf],
) -> Result<LocalImport, Vec<&'static str>> {
    if source_roots.is_empty() || source_roots.len() > 128 {
        return Err(vec!["import_profile_roots_invalid"]);
    }
    if !profile_clients().contains(&client) {
        return Err(vec!["import_profile_client_unsupported"]);
    }
    collect_inner(home, client, approved_roots, Some(source_roots), None)
}

pub fn profile_clients() -> &'static [&'static str] {
    static CLIENTS: std::sync::OnceLock<Vec<&'static str>> = std::sync::OnceLock::new();
    CLIENTS.get_or_init(clients)
}

/// A report lower bound for parsers whose records are independent. Stateful
/// transcripts still replay their complete history. Devin excludes only rows
/// definitely written before this bound; later writes can back-anchor into it.
/// The caller must still apply the exact final report window after parsing.
pub fn collect_since(
    home: &Path,
    client: &str,
    approved_roots: &[PathBuf],
    source_roots: Option<&[PathBuf]>,
    first_ms: u64,
) -> Result<LocalImport, Vec<&'static str>> {
    if first_ms > i64::MAX as u64 {
        return Err(vec!["import_request_invalid"]);
    }
    if source_roots.is_some_and(|roots| roots.is_empty() || roots.len() > 128)
        || (source_roots.is_some() && !profile_clients().contains(&client))
    {
        return Err(vec!["import_profile_roots_invalid"]);
    }
    collect_inner(home, client, approved_roots, source_roots, Some(first_ms))
}

fn collect_inner(
    home: &Path,
    client: &str,
    approved_roots: &[PathBuf],
    source_roots: Option<&[PathBuf]>,
    first_ms: Option<u64>,
) -> Result<LocalImport, Vec<&'static str>> {
    if !home.is_absolute() || !clients().contains(&client) {
        return Err(vec!["import_request_invalid"]);
    }
    let home = home
        .to_str()
        .ok_or_else(|| vec!["import_home_encoding_invalid"])?;
    let guard = crate::offline_io::begin(approved_roots).map_err(|e| vec![e])?;
    // Desktop overlap resolution still needs all CLI session identities.
    if client == "devin-cli" {
        crate::offline_io::set_first_observed_ms(first_ms);
    }
    if let Some(roots) = source_roots {
        for root in roots {
            crate::offline_io::admit(root).map_err(|_| vec!["import_profile_root_unavailable"])?;
            if !root.is_dir() {
                return Err(vec!["import_profile_root_not_directory"]);
            }
        }
        crate::offline_io::set_profile(client, roots);
    }
    // These ownership decisions require both stores in the same parse call.
    let context_clients = match client {
        "devin-desktop" => vec!["devin-cli".to_owned(), "devin-desktop".to_owned()],
        "openclaw" => vec!["codex".to_owned(), "openclaw".to_owned()],
        _ => vec![client.to_owned()],
    };
    // Transcript-log clients (Codex, Claude Code) keep one self-contained
    // record stream per file, so a file last written before the report
    // window cannot hold an in-window record. Bounding their enumeration by
    // mtime keeps huge historical trees inside the audit deadline without
    // changing what the windowed report admits. Counter-style and
    // cross-source clients are deliberately out: their baselines or
    // identity lanes can live in older files.
    if let (Some(floor), [single]) = (first_ms, context_clients.as_slice()) {
        if matches!(single.as_str(), "codex" | "claude") {
            crate::offline_io::set_file_floor_ms(Some(floor));
        }
    }
    let options = LocalParseOptions {
        home_dir: Some(home.to_owned()),
        use_env_roots: false,
        clients: Some(context_clients.clone()),
        scanner_settings: ScannerSettings {
            bucket_timezone: Some("UTC".to_owned()),
            ..Default::default()
        },
        ..Default::default()
    };
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(2)
        .build()
        .map_err(|_| vec!["import_worker_unavailable"])?;
    let parsed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        pool.install(|| {
            if client == "synthetic" {
                // Synthetic gateway observations already belong to their
                // originating primary client. Its only disjoint source is
                // Octofriend; scanning every other client again is unnecessary.
                let paths = match source_roots {
                    Some(roots) => crate::scanner::profile_synthetic_dbs(roots),
                    None => vec![Path::new(home).join(".local/share/octofriend/sqlite.db")],
                };
                let mut messages = Vec::new();
                let mut seen = std::collections::HashSet::new();
                for path in paths {
                    match crate::offline_io::admit(&path) {
                        Ok(()) => {
                            messages.extend(
                                crate::sessions::synthetic::parse_octofriend_sqlite(&path)
                                    .into_iter()
                                    .filter(|row| {
                                        row.dedup_key
                                            .as_ref()
                                            .is_none_or(|key| seen.insert(key.clone()))
                                    }),
                            );
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                        Err(_) => return Err("import_source_unreadable".to_owned()),
                    }
                }
                let zone = crate::BucketTimezone::from_scanner_settings(&options.scanner_settings);
                for message in &mut messages {
                    message.rebucket_date(&zone);
                }
                return Ok(messages);
            }
            crate::parse_local_unified_messages_resolved(
                options,
                home,
                &context_clients,
                None,
                crate::SourceCachePolicy::InMemory,
            )
        })
    }));
    let receipt = guard.finish()?;
    let mut messages = parsed
        .map_err(|_| vec!["import_parser_aborted"])?
        .map_err(|_| vec!["import_parser_failed"])?;
    if messages.len() > MAX_ROWS {
        return Err(vec!["import_row_limit"]);
    }
    match client {
        "devin-desktop" | "openclaw" | "synthetic" => messages.retain(|row| row.client == client),
        _ => {}
    }
    for message in &mut messages {
        crate::sessions::synthetic::normalize_synthetic_gateway_fields(
            &mut message.model_id,
            &mut message.provider_id,
        );
    }
    Ok(LocalImport { messages, receipt })
}
