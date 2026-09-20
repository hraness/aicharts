//! Exclusive, explicitly selected usage stores. Every companion directory must
//! be supplied by the caller; neither environment nor default-home discovery runs.
use super::*;

fn files(roots: &[PathBuf], pattern: &str) -> Vec<PathBuf> {
    dedup_dbs_by_canonical_path(roots.iter().flat_map(|root| match root.to_str() {
        Some(root) => scan_directory(root, pattern),
        None => {
            crate::offline_io::fault("import_profile_path_encoding_invalid");
            Vec::new()
        }
    }))
}
fn named(roots: &[PathBuf], name: &str) -> Vec<PathBuf> {
    files(roots, "profile-store")
        .into_iter()
        .filter(|path| path.file_name().is_some_and(|value| value == name))
        .collect()
}
/// These upstream stores have one authoritative database, with no defined
/// merge rule across independent accounts. Refuse ambiguity instead of picking
/// the first root or adding cumulative counters from potentially copied stores.
fn single(paths: Vec<PathBuf>) -> Option<PathBuf> {
    if paths.len() > 1 {
        crate::offline_io::fault("import_profile_store_ambiguous");
        None
    } else {
        paths.into_iter().next()
    }
}
pub(crate) fn synthetic_dbs(roots: &[PathBuf]) -> Vec<PathBuf> {
    named(roots, "sqlite.db")
}

pub(super) fn scan(client: &str, roots: &[PathBuf]) -> ScanResult {
    let mut result = ScanResult::default();
    let Some(id) =
        ClientId::from_str(client).or_else(|| (client == "9router").then_some(ClientId::Gjc))
    else {
        crate::offline_io::fault("import_profile_client_unsupported");
        return result;
    };
    let bucket = if id == ClientId::Freebuff {
        ClientId::Codebuff
    } else {
        id
    };
    match id {
        ClientId::OpenCode => {
            result.opencode_dbs = files(roots, "*.db")
                .into_iter()
                .filter(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(is_opencode_db_filename)
                })
                .collect();
            result.get_mut(id).extend(files(roots, "*.json"));
        }
        ClientId::MiMoCode => {
            result.micode_dbs = files(roots, "*.db")
                .into_iter()
                .filter(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(is_micode_db_filename)
                })
                .collect();
        }
        ClientId::Kilo => result.kilo_db = single(named(roots, "kilo.db")),
        ClientId::Goose => result.goose_db = single(named(roots, "sessions.db")),
        ClientId::Crush => {
            let mut sources = BTreeMap::new();
            for registry in named(roots, "projects.json") {
                for source in scan_crush_registry(&registry) {
                    if crate::offline_io::admit(&source.db_path).is_ok() {
                        sources.insert(source.db_path.clone(), source);
                    }
                }
            }
            for db_path in named(roots, "crush.db") {
                sources.entry(db_path.clone()).or_insert(CrushDbSource {
                    db_path,
                    workspace_key: None,
                    workspace_label: None,
                });
            }
            result.crush_dbs = sources.into_values().collect();
        }
        ClientId::OpenClaw => {
            result.openclaw_dbs = named(roots, "openclaw-agent.sqlite");
            for path in files(roots, id.file_pattern()) {
                // An explicitly included user Codex store is only a contextual
                // lookup: the Codex parser must verify its OpenClaw originator.
                // Agent-owned Codex homes keep upstream location ownership.
                let owned = crate::sessions::openclaw::classify_openclaw_jsonl(&path)
                    != crate::sessions::openclaw::OpenClawJsonlKind::Transcript;
                let rollout = path
                    .file_name()
                    .and_then(|v| v.to_str())
                    .is_some_and(|v| v.starts_with("rollout-") && v.ends_with(".jsonl"));
                result
                    .get_mut(if rollout && !owned {
                        ClientId::Codex
                    } else {
                        id
                    })
                    .push(path);
            }
        }
        ClientId::Copilot => {
            for path in files(roots, "*.jsonl") {
                if path
                    .parent()
                    .and_then(Path::file_name)
                    .is_some_and(|name| name == "chatSessions")
                {
                    result.copilot_vscode_sessions.push(path);
                } else {
                    result.get_mut(id).push(path);
                }
            }
            result.copilot_desktop_db = single(named(roots, "data.db"));
            result.copilot_session_store_db = single(named(roots, "session-store.db"));
        }
        ClientId::DevinCli | ClientId::DevinDesktop => {
            result.devin_dbs = named(roots, "sessions.db");
            if id == ClientId::DevinDesktop {
                result.get_mut(id).extend(files(roots, "*.ndjson"));
            }
        }
        ClientId::Grok => {
            result.get_mut(id).extend(files(roots, "updates.jsonl"));
            result.get_mut(id).extend(files(roots, "unified.jsonl"));
        }
        ClientId::Cline => {
            result.get_mut(id).extend(files(roots, id.file_pattern()));
            result
                .get_mut(id)
                .extend(files(roots, "cline-cli-messages"));
        }
        ClientId::Kiro => {
            result
                .get_mut(id)
                .extend(
                    files(roots, "kiro-globalstorage")
                        .into_iter()
                        .filter(|path| {
                            path.extension().is_some()
                                || (path
                                    .components()
                                    .any(|part| part.as_os_str() == "globalStorage")
                                    && path
                                        .components()
                                        .any(|part| part.as_os_str() == "kiro.kiroagent"))
                        }),
                );
            result.kiro_db = single(named(roots, "data.sqlite3"));
        }
        ClientId::Zcode => {
            result.get_mut(id).extend(files(roots, id.file_pattern()));
            result.zcode_db = single(named(roots, "db.sqlite"));
        }
        ClientId::CodeBuddy => {
            result.get_mut(id).extend(files(roots, "*.jsonl"));
            result.get_mut(id).extend(files(roots, "*.log"));
        }
        ClientId::WorkBuddy => {
            result.get_mut(id).extend(files(roots, "*.jsonl"));
            result.get_mut(id).extend(files(roots, "workbuddy.db"));
        }
        ClientId::CherryStudio => {
            let mut candidates = Vec::new();
            for root in roots {
                for path in files(std::slice::from_ref(root), "*.jsonl") {
                    // Common app roots contain both migrations. Their logical
                    // relative key starts at the actual .claude/projects root,
                    // independently of how the caller partitioned scan roots.
                    let projects = path
                        .ancestors()
                        .find(|ancestor| {
                            ancestor.file_name().is_some_and(|name| name == "projects")
                                && ancestor
                                    .parent()
                                    .and_then(Path::file_name)
                                    .is_some_and(|name| name == ".claude")
                        })
                        .unwrap_or(root);
                    candidates.push((
                        is_cherrystudio_v2_root(projects),
                        path.strip_prefix(projects)
                            .unwrap_or(&path)
                            .to_string_lossy()
                            .into_owned(),
                        path,
                    ));
                }
            }
            result
                .get_mut(id)
                .extend(dedupe_cherrystudio_transcripts(candidates));
        }
        ClientId::PrimeAgent => result
            .get_mut(id)
            .extend(files(roots, "prime-agent-session")),
        _ => result
            .get_mut(bucket)
            .extend(files(roots, id.file_pattern())),
    }
    for bucket in &mut result.files {
        *bucket = dedup_dbs_by_canonical_path(std::mem::take(bucket));
    }
    prefer_cursor_json_over_csv(result.get_mut(ClientId::Cursor));
    result
}

#[cfg(test)]
mod tests;
