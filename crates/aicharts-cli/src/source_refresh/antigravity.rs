//! Antigravity's local language-server RPC, admitted only after process ownership
//! and its selected app executable/listening port have been established.
use super::{disk, hex, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::Read,
    path::PathBuf,
    time::{Duration, Instant},
};
mod process;
#[cfg(test)]
mod tests;
const INVALID: &str = "antigravity_refresh_response_invalid";
const LIMIT: &str = "antigravity_refresh_limit";
const CAP: usize = 64 * 1024 * 1024;
const MAX_ROWS: usize = 200_000;
const MAX_SESSIONS: usize = 4096;
const BUDGET: Duration = Duration::from_secs(120);
const HELP: &str = "AI Charts Antigravity refresh — local IDE usage\n\n  aicharts refresh antigravity --cache-dir DIR --app /Applications/Antigravity.app [--pid PID] [--port PORT] [--allow-local-self-signed-tls]\n\nmacOS: reads the selected running app's language-server process identity and\nCSRF argument, then uses only its proven listening ports at 127.0.0.1. No remote\naccount request is made. Every RPC rechecks the executable, UID, process start\ntime and port owner. The optional TLS mode substitutes local process identity\nfor certificate PKI only at that exact loopback endpoint; it never relaxes\nremote TLS verification. HTTP is tried first; TLS is tried only with that flag.\n\nOnly numeric usage, model identifiers and hashed source IDs enter the private\ncache. Trajectory bodies may be read in memory to recover original usage times;\nno prompt or response content is stored. A missing original timestamp, incomplete\nfetch, changed process or capacity limit preserves the last complete cache.\nAbsent historical sessions remain; present complete sessions are replaced.\nThe profile is bound to this local app installation path and OS user, not to a\nverified remote account. Nothing is published to AI Charts by this command.\n";
fn remaining(started: Instant) -> Result<Duration> {
    BUDGET
        .checked_sub(started.elapsed())
        .filter(|v| !v.is_zero())
        .ok_or("antigravity_refresh_timeout")
}
fn identifier(value: &Value) -> Result<String> {
    let value = value.as_str().ok_or(INVALID)?;
    if value.is_empty()
        || value.len() > 256
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(INVALID);
    }
    Ok(value.to_owned())
}
fn hashed(scope: &str, value: &str) -> String {
    hex(&Sha256::digest(format!(
        "aicharts:antigravity:{scope}:v1\0{value}"
    )))
}
fn timestamp(value: &Value) -> Result<u64> {
    let value = if let Some(n) = value.as_u64() {
        n
    } else if let Some(s) = value.as_str() {
        if let Ok(n) = s.parse::<u64>() {
            n
        } else {
            let t = time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339)
                .map_err(|_| INVALID)?;
            u64::try_from(t.unix_timestamp_nanos() / 1_000_000).map_err(|_| INVALID)?
        }
    } else {
        return Err(INVALID);
    };
    if !(946_684_800_000..=4_133_980_799_999).contains(&value) {
        return Err(INVALID);
    }
    Ok(value)
}
fn count(value: Option<&Value>) -> Result<u64> {
    match value {
        None | Some(Value::Null) => Ok(0),
        Some(value) => value
            .as_u64()
            .or_else(|| value.as_str().and_then(|v| v.parse().ok()))
            .filter(|v| *v <= 1_000_000_000_000_000)
            .ok_or(INVALID),
    }
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Row {
    #[serde(rename = "type")]
    kind: String,
    session_id: String,
    model_id: String,
    timestamp: u64,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    reasoning: u64,
    response_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message_id: Option<String>,
}
impl Row {
    fn valid(&self, now: u64) -> bool {
        self.kind == "usage"
            && [&self.session_id, &self.response_id]
                .iter()
                .all(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
            && self
                .message_id
                .as_ref()
                .is_none_or(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
            && identifier(&json!(self.model_id)).is_ok()
            && timestamp(&json!(self.timestamp)).is_ok()
            && self.timestamp <= now
            && [
                self.input,
                self.output,
                self.cache_read,
                self.cache_write,
                self.reasoning,
            ]
            .iter()
            .all(|v| *v <= 1_000_000_000_000_000)
    }
}
trait Transport {
    fn rpc(
        &mut self,
        endpoint: usize,
        method: &str,
        body: Value,
        remaining: Duration,
        cap: usize,
    ) -> Result<Vec<u8>>;
}
struct Connection {
    identity: process::Identity,
    port: u16,
    tls: bool,
}
struct Http {
    connections: Vec<Connection>,
}
fn rpc_url(host: &str, port: u16, tls: bool, method: &str) -> Result<String> {
    if host != "127.0.0.1"
        || port == 0
        || !matches!(
            method,
            "Heartbeat"
                | "GetAllCascadeTrajectories"
                | "GetCascadeTrajectoryGeneratorMetadata"
                | "GetCascadeTrajectory"
        )
    {
        return Err("antigravity_refresh_endpoint_invalid");
    }
    Ok(format!(
        "{}://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/{method}",
        if tls { "https" } else { "http" }
    ))
}
impl Transport for Http {
    fn rpc(
        &mut self,
        index: usize,
        method: &str,
        body: Value,
        remaining: Duration,
        cap: usize,
    ) -> Result<Vec<u8>> {
        let started = Instant::now();
        let left = || {
            remaining
                .checked_sub(started.elapsed())
                .filter(|v| !v.is_zero())
                .ok_or("antigravity_refresh_timeout")
        };
        let endpoint = self.connections.get(index).ok_or(INVALID)?;
        process::validate(&endpoint.identity, endpoint.port, left()?)?;
        let url = rpc_url("127.0.0.1", endpoint.port, endpoint.tls, method)?;
        let mut csrf =
            ureq::http::HeaderValue::from_str(&endpoint.identity.csrf).map_err(|_| INVALID)?;
        csrf.set_sensitive(true);
        let remaining = left()?;
        let config = ureq::Agent::config_builder()
            .https_only(endpoint.tls)
            .proxy(None)
            .max_redirects(0)
            .http_status_as_error(false)
            .max_idle_connections(0)
            .max_response_header_size(16 * 1024)
            .timeout_global(Some(remaining.min(Duration::from_secs(8))))
            .timeout_connect(Some(remaining.min(Duration::from_secs(2))))
            .timeout_recv_body(Some(remaining.min(Duration::from_secs(5))))
            .tls_config(
                ureq::tls::TlsConfig::builder()
                    .disable_verification(endpoint.tls)
                    .build(),
            )
            .build();
        // The relaxed TLS configuration exists only in an explicitly opted-in local
        // connection. URL and resolver cannot target any other host or port.
        let resolver = if endpoint.tls {
            crate::transport_dns::SourceResolver::https("127.0.0.1", endpoint.port)
        } else {
            crate::transport_dns::SourceResolver::loopback_http("127.0.0.1", endpoint.port)
        }
        .map_err(|_| INVALID)?;
        let agent = ureq::Agent::with_parts(
            config,
            ureq::unversioned::transport::DefaultConnector::default(),
            resolver,
        );
        let mut response = agent
            .post(&url)
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .header("connect-protocol-version", "1")
            .header("x-codeium-csrf-token", csrf)
            .header("connection", "close")
            .send(serde_json::to_vec(&body).map_err(|_| INVALID)?)
            .map_err(|_| "antigravity_refresh_transport_unavailable")?;
        if response.status().as_u16() != 200 {
            return Err("antigravity_refresh_rpc_rejected");
        }
        let mut media = response.headers().get_all("content-type").iter();
        if !media.next().and_then(|v| v.to_str().ok()).is_some_and(|v| {
            v.split(';')
                .next()
                .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json"))
        }) || media.next().is_some()
        {
            return Err(INVALID);
        }
        let mut bytes = Vec::new();
        response
            .body_mut()
            .as_reader()
            .take(cap as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "antigravity_refresh_read_failed")?;
        if bytes.len() > cap {
            return Err(LIMIT);
        }
        process::validate(&endpoint.identity, endpoint.port, left()?)?;
        left()?;
        Ok(bytes)
    }
}
struct Budget {
    started: Instant,
    bytes: usize,
}
impl Budget {
    fn call(
        &mut self,
        transport: &mut impl Transport,
        index: usize,
        method: &str,
        body: Value,
    ) -> Result<Value> {
        let bytes = transport.rpc(
            index,
            method,
            body,
            remaining(self.started)?,
            CAP - self.bytes,
        )?;
        remaining(self.started)?;
        self.bytes = self
            .bytes
            .checked_add(bytes.len())
            .filter(|n| *n <= CAP)
            .ok_or(LIMIT)?;
        serde_json::from_slice(&bytes).map_err(|_| INVALID)
    }
}
fn summaries(value: &Value) -> Result<Vec<(String, u64)>> {
    let source = value
        .get("trajectorySummaries")
        .or_else(|| value.get("cascadeTrajectories"))
        .ok_or(INVALID)?;
    let entries: Vec<(Option<&String>, &Value)> = if let Some(array) = source.as_array() {
        if array.len() > MAX_SESSIONS {
            return Err(LIMIT);
        }
        array.iter().map(|v| (None, v)).collect()
    } else if let Some(map) = source.as_object() {
        if map.len() > MAX_SESSIONS {
            return Err(LIMIT);
        }
        map.iter().map(|(k, v)| (Some(k), v)).collect()
    } else {
        return Err(INVALID);
    };
    let mut result = BTreeMap::new();
    for (key, value) in entries {
        let id = match ["cascadeId", "trajectoryId", "id", "sessionId"]
            .iter()
            .find_map(|k| value.get(*k))
        {
            Some(v) => identifier(v)?,
            None => key
                .cloned()
                .filter(|v| !v.is_empty() && v.len() <= 256)
                .ok_or(INVALID)?,
        };
        let modified = [
            "lastModifiedTime",
            "lastModified",
            "updatedAt",
            "modifiedAt",
        ]
        .iter()
        .find_map(|k| value.get(*k))
        .map(timestamp)
        .transpose()?
        .unwrap_or(0);
        if result.insert(id, modified).is_some() {
            return Err(INVALID);
        }
    }
    Ok(result.into_iter().collect())
}
fn usage_key(value: &Value, prefix: &str) -> Result<Option<String>> {
    value
        .get(prefix)
        .filter(|v| !v.is_null())
        .map(identifier)
        .transpose()
        .map(|v| v.map(|id| hashed(prefix, &id)))
}
fn trajectory_times(value: &Value) -> Result<BTreeMap<String, u64>> {
    let steps = value
        .get("trajectory")
        .unwrap_or(value)
        .get("steps")
        .and_then(Value::as_array)
        .ok_or(INVALID)?;
    if steps.len() > MAX_ROWS {
        return Err(LIMIT);
    }
    let mut times = BTreeMap::new();
    for step in steps {
        let Some(metadata) = step.get("metadata") else {
            continue;
        };
        let Some(usage) = metadata.get("modelUsage") else {
            continue;
        };
        let Some(value) = [
            "createdAt",
            "startedAt",
            "completedAt",
            "finishedGeneratingAt",
            "viewableAt",
        ]
        .iter()
        .find_map(|key| metadata.get(*key)) else {
            continue;
        };
        let time = timestamp(value)?;
        for key in ["responseId", "messageId"] {
            if let Some(key) = usage_key(usage, key)? {
                if times.insert(key, time).is_some_and(|old| old != time) {
                    return Err("antigravity_refresh_timestamp_conflict");
                }
            }
        }
    }
    Ok(times)
}
fn normalize(
    session: &str,
    metadata: &[Value],
    times: &BTreeMap<String, u64>,
    previous: &BTreeMap<String, Row>,
    now: u64,
) -> Result<Vec<Row>> {
    if metadata.len() > MAX_ROWS {
        return Err(LIMIT);
    }
    let session_id = hashed("session", session);
    let mut rows = BTreeMap::new();
    for (meta_index, meta) in metadata.iter().enumerate() {
        let chat = meta.get("chatModel").unwrap_or(meta);
        let model = chat
            .get("responseModel")
            .or_else(|| chat.get("model"))
            .map(identifier)
            .transpose()?
            .unwrap_or_else(|| "unknown".into());
        let created = chat
            .get("chatStartMetadata")
            .and_then(|v| v.get("createdAt"))
            .filter(|v| !v.is_null())
            .map(timestamp)
            .transpose()?;
        let Some(retries) = chat.get("retryInfos") else {
            continue;
        };
        let retries = retries.as_array().ok_or(INVALID)?;
        if retries.len() > MAX_ROWS {
            return Err(LIMIT);
        }
        for (retry_index, retry) in retries.iter().enumerate() {
            let usage = retry.get("usage").unwrap_or(retry);
            let input = count(usage.get("inputTokens"))?;
            let output = count(usage.get("outputTokens"))?;
            let cache_read = count(usage.get("cacheReadTokens"))?;
            let cache_write = count(usage.get("cacheWriteTokens"))?;
            let reasoning = count(usage.get("thinkingOutputTokens"))?;
            if input + output + cache_read + cache_write + reasoning == 0 {
                continue;
            }
            if rows.len() >= MAX_ROWS {
                return Err(LIMIT);
            }
            let response = usage_key(usage, "responseId")?;
            let message_id = usage_key(usage, "messageId")?;
            let raw_identity = response
                .clone()
                .or_else(|| message_id.clone())
                .unwrap_or_else(|| {
                    hashed(
                        "ordinal",
                        &format!("{session}\0{meta_index}\0{retry_index}"),
                    )
                });
            let identity = hashed("event", &format!("{session}\0{raw_identity}"));
            let recorded = usage
                .get("createdAt")
                .or_else(|| usage.get("timestamp"))
                .filter(|v| !v.is_null())
                .map(timestamp)
                .transpose()?;
            let matched = response
                .as_ref()
                .and_then(|id| times.get(id))
                .or_else(|| message_id.as_ref().and_then(|id| times.get(id)))
                .copied();
            let old = previous
                .get(&identity)
                .filter(|row| {
                    row.session_id == session_id
                        && row.model_id == model
                        && [
                            row.input,
                            row.output,
                            row.cache_read,
                            row.cache_write,
                            row.reasoning,
                        ] == [input, output, cache_read, cache_write, reasoning]
                        && (response.is_some() || message_id.is_some())
                })
                .map(|row| row.timestamp);
            let timestamp = recorded
                .or(matched)
                .or(old)
                .or(created)
                .ok_or("antigravity_refresh_timestamp_unavailable")?;
            let row = Row {
                kind: "usage".into(),
                session_id: session_id.clone(),
                model_id: model.clone(),
                timestamp,
                input,
                output,
                cache_read,
                cache_write,
                reasoning,
                response_id: identity.clone(),
                message_id,
            };
            if !row.valid(now) {
                return Err(INVALID);
            }
            if let Some(old) = rows.insert(identity, row.clone()) {
                if old != row {
                    return Err("antigravity_refresh_usage_conflict");
                }
            }
        }
    }
    Ok(rows.into_values().collect())
}
fn decode_cache(bytes: Option<&[u8]>, now: u64) -> Result<BTreeMap<String, Row>> {
    let mut rows = BTreeMap::new();
    if let Some(bytes) = bytes {
        if bytes.len() > CAP {
            return Err(LIMIT);
        }
        for line in bytes.split(|b| *b == b'\n').filter(|line| !line.is_empty()) {
            if line.len() > 8192 || rows.len() >= MAX_ROWS {
                return Err(LIMIT);
            }
            let row: Row =
                serde_json::from_slice(line).map_err(|_| "antigravity_refresh_cache_invalid")?;
            if !row.valid(now) || rows.insert(row.response_id.clone(), row).is_some() {
                return Err("antigravity_refresh_cache_invalid");
            }
        }
    }
    Ok(rows)
}
fn collect(
    transport: &mut impl Transport,
    endpoints: usize,
    previous: &BTreeMap<String, Row>,
    budget: &mut Budget,
    now: u64,
) -> Result<Vec<u8>> {
    let mut sessions = BTreeMap::new();
    for endpoint in 0..endpoints {
        let value = budget.call(transport, endpoint, "GetAllCascadeTrajectories", json!({}))?;
        for (id, modified) in summaries(&value)? {
            if !sessions.contains_key(&id) && sessions.len() >= MAX_SESSIONS {
                return Err(LIMIT);
            }
            let value = sessions.entry(id).or_insert((modified, endpoint));
            if modified > value.0 {
                *value = (modified, endpoint)
            }
        }
    }
    let mut retained = previous.clone();
    for (session, (_, endpoint)) in sessions {
        let response = budget.call(
            transport,
            endpoint,
            "GetCascadeTrajectoryGeneratorMetadata",
            json!({"cascadeId":session}),
        )?;
        let metadata = response
            .get("generatorMetadata")
            .and_then(Value::as_array)
            .ok_or(INVALID)?;
        let empty = BTreeMap::new();
        let first = normalize(&session, metadata, &empty, previous, now);
        let fresh = match first {
            Err("antigravity_refresh_timestamp_unavailable") => {
                let trajectory = budget.call(
                    transport,
                    endpoint,
                    "GetCascadeTrajectory",
                    json!({"cascadeId":session}),
                )?;
                normalize(
                    &session,
                    metadata,
                    &trajectory_times(&trajectory)?,
                    previous,
                    now,
                )?
            }
            other => other?,
        };
        let session_id = hashed("session", &session);
        if fresh.is_empty() && previous.values().any(|row| row.session_id == session_id) {
            return Err("antigravity_refresh_empty_preserved");
        }
        retained.retain(|_, row| row.session_id != session_id);
        for row in fresh {
            if retained.len() >= MAX_ROWS {
                return Err(LIMIT);
            }
            if retained.insert(row.response_id.clone(), row).is_some() {
                return Err("antigravity_refresh_usage_conflict");
            }
        }
    }
    let mut bytes = Vec::new();
    for row in retained.values() {
        let line = serde_json::to_vec(row).map_err(|_| INVALID)?;
        if bytes.len() + line.len() + 1 > CAP {
            return Err(LIMIT);
        }
        bytes.extend(line);
        bytes.push(b'\n')
    }
    if bytes.is_empty() {
        return Err("antigravity_refresh_empty_preserved");
    }
    Ok(bytes)
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    schema_version: u8,
    client: String,
    scope: String,
}
fn refresh(
    cache: &disk::Cache,
    scope: String,
    transport: &mut impl Transport,
    endpoints: usize,
    started: Instant,
    now: u64,
    consumed: usize,
) -> Result<usize> {
    cache.require_entries(&["profile.json", "usage.jsonl", "refresh.lock"])?;
    let expected = Binding {
        schema_version: 1,
        client: "antigravity".into(),
        scope,
    };
    let manifest = cache.read("profile.json", 4096)?;
    if let Some(bytes) = &manifest {
        let prior: Binding =
            serde_json::from_slice(bytes).map_err(|_| "antigravity_refresh_cache_invalid")?;
        if prior != expected {
            return Err("antigravity_refresh_profile_mismatch");
        }
    }
    let prior = cache.read("usage.jsonl", CAP)?;
    if manifest.is_none() && prior.is_some() {
        return Err("antigravity_refresh_cache_unbound");
    }
    let previous = decode_cache(prior.as_deref(), now)?;
    let mut budget = Budget {
        started,
        bytes: consumed,
    };
    let bytes = collect(transport, endpoints, &previous, &mut budget, now)?;
    remaining(started)?;
    let count = bytes.iter().filter(|b| **b == b'\n').count();
    if manifest.is_none() {
        cache.create_binding(&serde_json::to_vec(&expected).map_err(|_| INVALID)?)?
    }
    cache.replace("usage.jsonl", &bytes)?;
    Ok(count)
}
pub(super) fn run(args: &[String]) -> Result<String> {
    if args == ["--help"] || args == ["-h"] {
        return Ok(HELP.into());
    }
    let (mut cache, mut app, mut pid, mut port, mut tls) = (None, None, None, None, false);
    let mut index = 0;
    while index < args.len() {
        let flag = &args[index];
        index += 1;
        if flag == "--allow-local-self-signed-tls" && !tls {
            tls = true;
            continue;
        }
        let value = args.get(index).ok_or("source_refresh_usage")?;
        index += 1;
        match flag.as_str() {
            "--cache-dir" if cache.is_none() => cache = Some(PathBuf::from(value)),
            "--app" if app.is_none() => app = Some(PathBuf::from(value)),
            "--pid" if pid.is_none() => {
                pid = Some(
                    value
                        .parse::<u32>()
                        .ok()
                        .filter(|n| *n > 1)
                        .ok_or("source_refresh_usage")?,
                )
            }
            "--port" if port.is_none() => {
                port = Some(
                    value
                        .parse::<u16>()
                        .ok()
                        .filter(|n| *n > 0)
                        .ok_or("source_refresh_usage")?,
                )
            }
            _ => return Err("source_refresh_usage"),
        }
    }
    let app = app.ok_or("source_refresh_usage")?;
    let cache = disk::Cache::open(&cache.ok_or("source_refresh_usage")?)?;
    let started = Instant::now();
    let identities = process::discover(&app, pid, port, started)?;
    let scope = process::scope(&app)?;
    let mut transport = Http {
        connections: Vec::new(),
    };
    let mut consumed = 0usize;
    for (identity, ports) in identities {
        let mut selected = None;
        for port in ports {
            for tls in [false, true].into_iter().filter(|value| !*value || tls) {
                let index = transport.connections.len();
                transport.connections.push(Connection {
                    identity: identity.clone(),
                    port,
                    tls,
                });
                consumed = consumed
                    .checked_add(128 * 1024)
                    .filter(|n| *n <= CAP)
                    .ok_or(LIMIT)?;
                let response = transport.rpc(
                    index,
                    "Heartbeat",
                    json!({"uuid":"00000000-0000-0000-0000-000000000000"}),
                    remaining(started)?,
                    128 * 1024,
                );
                let success = response
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                    .is_some_and(|value| value.is_object());
                if success {
                    selected = Some(index);
                    break;
                }
                transport.connections.pop();
            }
            if selected.is_some() {
                break;
            }
        }
        if selected.is_none() {
            return Err("antigravity_refresh_service_unavailable");
        }
    }
    let count = transport.connections.len();
    let rows = refresh(
        &cache,
        scope,
        &mut transport,
        count,
        started,
        crate::stats::now_ms()?,
        consumed,
    )?;
    Ok(json!({"client":"antigravity","refreshedObservations":rows,"historyPolicy":"replace_present_complete_sessions_retain_absent_sessions"}).to_string())
}
