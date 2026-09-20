//! Explicit international Trae account usage. IDE and Solo share one account
//! cache; no desktop secret discovery, credential refresh, or response logging.
use super::{disk, hex, Result};
use crate::transport_dns::SourceResolver;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use ureq::{http::HeaderValue, unversioned::transport::DefaultConnector};

const HOST: &str = "api-sg-central.trae.ai";
const URL: &str =
    "https://api-sg-central.trae.ai/trae/api/v1/pay/query_user_usage_group_by_session";
const CAP: usize = 64 * 1024 * 1024;
const PAGE_SIZE: usize = 20;
const MAX_PAGES: usize = 500;
const MAX_ROWS: usize = PAGE_SIZE * MAX_PAGES;
const BUDGET: Duration = Duration::from_secs(120);
const INVALID: &str = "trae_refresh_response_invalid";
const LIMIT: &str = "trae_refresh_limit";
const HELP: &str = "AI Charts Trae refresh — explicit international account usage\n\n  aicharts refresh trae --cache-dir DIR --token-file FILE [--days 1..366] [--include-aux]\n\nReads one explicit private JWT file and fetches the international Trae usage API.\nIDE and Solo are credential sources for the same account; use one profile.\nThe default window is 30 days with chat usage types 5 and 6. --include-aux adds\nall eight upstream usage categories. China-backend session data is unavailable.\nThe complete numeric cache is published atomically after every page succeeds.\nPreviously stored sessions absent from a refresh remain; newer source versions\nreplace older versions of the same session. Prompts and response text are dropped.\nCredentials never leave the fixed Trae host or enter the cache. A profile binds\nthe supplied credential; a rotated credential requires a separate profile or\nreviewed reconciliation. Nothing is sent to AI Charts by this command.\n";

struct Credential {
    header: HeaderValue,
    scope: String,
}
fn credential(raw: &str) -> Result<Credential> {
    let token = raw.trim();
    let parts: Vec<_> = token.split('.').collect();
    if token.len() > 16 * 1024
        || parts.len() != 3
        || parts.iter().any(|part| {
            part.is_empty()
                || part
                    .bytes()
                    .any(|b| !(b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
        })
    {
        return Err("trae_refresh_credential_invalid");
    }
    let mut header = HeaderValue::from_str(&format!("Cloud-IDE-JWT {token}"))
        .map_err(|_| "trae_refresh_credential_invalid")?;
    header.set_sensitive(true);
    Ok(Credential {
        header,
        scope: hex(&Sha256::digest(format!(
            "aicharts:trae-credential:v1\0{token}"
        ))),
    })
}
#[derive(Clone, Copy)]
struct Window {
    start: u64,
    end: u64,
    auxiliary: bool,
}
trait Transport {
    fn page(
        &mut self,
        credential: &Credential,
        window: Window,
        page: usize,
        remaining: Duration,
        cap: usize,
    ) -> Result<Vec<u8>>;
}
struct Https;
impl Transport for Https {
    fn page(
        &mut self,
        credential: &Credential,
        window: Window,
        page: usize,
        remaining: Duration,
        cap: usize,
    ) -> Result<Vec<u8>> {
        let config = ureq::Agent::config_builder()
            .https_only(true)
            .proxy(None)
            .max_redirects(0)
            .http_status_as_error(false)
            .max_idle_connections(0)
            .max_idle_connections_per_host(0)
            .max_response_header_size(16 * 1024)
            .timeout_global(Some(remaining))
            .timeout_resolve(Some(remaining.min(Duration::from_secs(3))))
            .timeout_connect(Some(remaining.min(Duration::from_secs(10))))
            .timeout_recv_body(Some(remaining.min(Duration::from_secs(30))))
            .build();
        let agent = ureq::Agent::with_parts(
            config,
            DefaultConnector::default(),
            SourceResolver::https(HOST, 443).map_err(|_| INVALID)?,
        );
        let kinds: &[u8] = if window.auxiliary {
            &[1, 2, 3, 4, 5, 6, 7, 8]
        } else {
            &[5, 6]
        };
        let body = serde_json::to_vec(&json!({"start_time":window.start,"end_time":window.end,"page_size":PAGE_SIZE,"page_num":page,"usage_type":kinds})).map_err(|_| INVALID)?;
        let mut response = agent
            .post(URL)
            .header("authorization", credential.header.clone())
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .header("connection", "close")
            .send(body)
            .map_err(|_| "trae_refresh_transport_unavailable")?;
        match response.status().as_u16() {
            200 => {}
            401 | 403 => return Err("trae_refresh_unauthorized"),
            _ => return Err("trae_refresh_http_rejected"),
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
            .map_err(|_| "trae_refresh_read_failed")?;
        if bytes.len() > cap {
            return Err(LIMIT);
        }
        Ok(bytes)
    }
}
fn remaining(started: Instant) -> Result<Duration> {
    BUDGET
        .checked_sub(started.elapsed())
        .filter(|value| !value.is_zero())
        .ok_or("trae_refresh_timeout")
}
fn bounded_text(value: &Value, cap: usize, empty: bool) -> Result<String> {
    let value = value.as_str().ok_or(INVALID)?;
    if (!empty && value.is_empty())
        || value.len() > cap
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(INVALID);
    }
    Ok(value.to_owned())
}
fn project(value: &Value) -> Result<Value> {
    let value = value.as_object().ok_or(INVALID)?;
    let mut row = Map::new();
    row.insert(
        "session_id".into(),
        bounded_text(value.get("session_id").ok_or(INVALID)?, 256, false)?.into(),
    );
    let timestamp = value
        .get("usage_time")
        .and_then(Value::as_u64)
        .filter(|time| (946_684_800..=4_133_980_799).contains(time))
        .ok_or(INVALID)?;
    row.insert("usage_time".into(), timestamp.into());
    row.insert(
        "model_name".into(),
        bounded_text(value.get("model_name").ok_or(INVALID)?, 256, true)?.into(),
    );
    if let Some(mode) = value.get("mode") {
        row.insert("mode".into(), bounded_text(mode, 64, true)?.into());
    }
    if let Some(cost) = value.get("dollar_float") {
        let cost = cost
            .as_f64()
            .filter(|value| value.is_finite() && (0.0..=100_000_000.0).contains(value))
            .ok_or(INVALID)?;
        row.insert("dollar_float".into(), json!(cost));
    }
    let usage = value
        .get("extra_info")
        .and_then(Value::as_object)
        .ok_or(INVALID)?;
    let mut projected = Map::new();
    for key in [
        "input_token",
        "output_token",
        "cache_read_token",
        "cache_write_token",
    ] {
        let count = usage
            .get(key)
            .and_then(Value::as_u64)
            .filter(|count| *count <= 1_000_000_000_000_000)
            .ok_or(INVALID)?;
        projected.insert(key.into(), count.into());
    }
    row.insert("extra_info".into(), projected.into());
    Ok(row.into())
}
fn fetch(
    transport: &mut impl Transport,
    credential: &Credential,
    window: Window,
    started: Instant,
) -> Result<Vec<Value>> {
    let mut rows = Vec::new();
    let mut bytes = 0usize;
    let mut total: Option<Option<usize>> = None;
    let mut pages = BTreeSet::new();
    let mut seen = BTreeSet::new();
    for page in 1..=MAX_PAGES {
        let body = transport.page(credential, window, page, remaining(started)?, CAP - bytes)?;
        remaining(started)?;
        bytes = bytes
            .checked_add(body.len())
            .filter(|v| *v <= CAP)
            .ok_or(LIMIT)?;
        let data: Value = serde_json::from_slice(&body).map_err(|_| INVALID)?;
        let data = data.as_object().ok_or(INVALID)?;
        let advertised = match data.get("total") {
            None | Some(Value::Null) => None,
            Some(value) => Some(
                value
                    .as_u64()
                    .filter(|n| *n <= MAX_ROWS as u64)
                    .ok_or(INVALID)? as usize,
            ),
        };
        if total.is_some_and(|prior| prior != advertised) {
            return Err("trae_refresh_history_changed");
        }
        total = Some(advertised);
        let batch = data
            .get("user_usage_group_by_sessions")
            .and_then(Value::as_array)
            .ok_or(INVALID)?;
        if batch.len() > PAGE_SIZE {
            return Err(LIMIT);
        }
        if batch.is_empty() {
            if advertised.is_some_and(|value| value != rows.len()) {
                return Err("trae_refresh_incomplete");
            }
            return Ok(rows);
        }
        if !pages.insert(Sha256::digest(serde_json::to_vec(batch).map_err(|_| INVALID)?).to_vec()) {
            return Err("trae_refresh_repeated_page");
        }
        for value in batch {
            let row = project(value)?;
            let time = row["usage_time"].as_u64().ok_or(INVALID)?;
            if time < window.start || time > window.end {
                return Err("trae_refresh_history_changed");
            }
            if !seen.insert(Sha256::digest(serde_json::to_vec(&row).map_err(|_| INVALID)?).to_vec())
            {
                return Err("trae_refresh_duplicate_session");
            }
            rows.push(row);
        }
        if rows.len() > MAX_ROWS || advertised.is_some_and(|value| rows.len() > value) {
            return Err(LIMIT);
        }
        if advertised == Some(rows.len()) {
            return Ok(rows);
        }
        if bytes == CAP {
            return Err(LIMIT);
        }
    }
    Err(LIMIT)
}
fn merge(previous: Option<&[u8]>, fresh: Vec<Value>) -> Result<Vec<u8>> {
    let mut sessions: BTreeMap<String, Value> = BTreeMap::new();
    if let Some(bytes) = previous {
        if bytes.len() > CAP {
            return Err(LIMIT);
        }
        let rows: Vec<Value> =
            serde_json::from_slice(bytes).map_err(|_| "trae_refresh_cache_invalid")?;
        if rows.len() > MAX_ROWS {
            return Err(LIMIT);
        }
        for value in rows {
            let row = project(&value)?;
            let id = row["session_id"].as_str().ok_or(INVALID)?.to_owned();
            if sessions.insert(id, row).is_some() {
                return Err("trae_refresh_cache_invalid");
            }
        }
    }
    for value in fresh {
        let row = project(&value)?;
        let id = row["session_id"].as_str().ok_or(INVALID)?.to_owned();
        if !sessions.contains_key(&id) && sessions.len() >= MAX_ROWS {
            return Err(LIMIT);
        }
        if sessions
            .get(&id)
            .is_none_or(|old| row["usage_time"].as_u64() >= old["usage_time"].as_u64())
        {
            sessions.insert(id, row);
        }
    }
    let bytes =
        serde_json::to_vec(&sessions.into_values().collect::<Vec<_>>()).map_err(|_| INVALID)?;
    if bytes.len() > CAP {
        return Err(LIMIT);
    }
    Ok(bytes)
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    schema_version: u8,
    client: String,
    scope: String,
    auxiliary: bool,
}
fn refresh(
    path: &Path,
    credential: &Credential,
    window: Window,
    transport: &mut impl Transport,
    started: Instant,
) -> Result<String> {
    let cache = disk::Cache::open(path)?;
    cache.require_entries(&["profile.json", "usage.json", "refresh.lock"])?;
    let binding = Binding {
        schema_version: 1,
        client: "trae".into(),
        scope: credential.scope.clone(),
        auxiliary: window.auxiliary,
    };
    let manifest = cache.read("profile.json", 4096)?;
    if let Some(bytes) = &manifest {
        let before: Binding =
            serde_json::from_slice(bytes).map_err(|_| "trae_refresh_cache_invalid")?;
        if before != binding {
            return Err("trae_refresh_profile_mismatch");
        }
    }
    let previous = cache.read("usage.json", CAP)?;
    if manifest.is_none() && previous.is_some() {
        return Err("trae_refresh_cache_unbound");
    }
    let fresh = fetch(transport, credential, window, started)?;
    let count = fresh.len();
    let bytes = merge(previous.as_deref(), fresh)?;
    remaining(started)?;
    if manifest.is_none() {
        cache.create_binding(&serde_json::to_vec(&binding).map_err(|_| INVALID)?)?;
    }
    cache.replace("usage.json", &bytes)?;
    Ok(json!({"client":"trae","refreshedSessions":count,"cacheBytes":bytes.len(),"historyPolicy":"newest_session_version_retain_absent_sessions"}).to_string())
}
pub(super) fn run(args: &[String]) -> Result<String> {
    if args == ["--help"] || args == ["-h"] {
        return Ok(HELP.into());
    }
    let (mut cache, mut token, mut days, mut auxiliary) = (None, None, None, false);
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--include-aux" if !auxiliary => {
                auxiliary = true;
                index += 1;
                continue;
            }
            "--cache-dir" | "--token-file" => {
                let value = args.get(index + 1).ok_or("source_refresh_usage")?;
                let slot = if args[index] == "--cache-dir" {
                    &mut cache
                } else {
                    &mut token
                };
                if slot.replace(PathBuf::from(value)).is_some() {
                    return Err("source_refresh_usage");
                }
            }
            "--days" if days.is_none() => {
                days = Some(
                    args.get(index + 1)
                        .and_then(|v| v.parse::<u64>().ok())
                        .filter(|v| (1..=366).contains(v))
                        .ok_or("source_refresh_usage")?,
                );
            }
            _ => return Err("source_refresh_usage"),
        }
        index += 2;
    }
    let cache = cache
        .filter(|path| path.is_absolute())
        .ok_or("source_refresh_usage")?;
    let token = token
        .filter(|path| path.is_absolute())
        .ok_or("source_refresh_usage")?;
    let end = crate::stats::now_ms()? / 1000;
    let window = Window {
        start: end
            .checked_sub(days.unwrap_or(30) * 86_400)
            .ok_or("source_refresh_usage")?,
        end,
        auxiliary,
    };
    let started = Instant::now();
    let credential = credential(&disk::read_secret(&token)?)?;
    refresh(&cache, &credential, window, &mut Https, started)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    const NOW: u64 = 1_789_776_000;
    fn window() -> Window {
        Window {
            start: NOW - 86_400,
            end: NOW,
            auxiliary: false,
        }
    }
    fn event(id: &str, at: u64) -> Value {
        json!({"session_id":id,"usage_time":at,"model_name":"GPT-5.4","dollar_float":0.0,"extra_info":{"input_token":100,"output_token":20,"cache_read_token":30,"cache_write_token":0},"prompt":"PRIVATE_CANARY","response":"PRIVATE_CANARY"})
    }
    fn response(rows: Vec<Value>, total: Option<usize>) -> Vec<u8> {
        json!({"user_usage_group_by_sessions":rows,"total":total})
            .to_string()
            .into_bytes()
    }
    struct Fake {
        pages: VecDeque<Result<Vec<u8>>>,
        calls: usize,
    }
    impl Transport for Fake {
        fn page(
            &mut self,
            _: &Credential,
            _: Window,
            page: usize,
            remaining: Duration,
            _: usize,
        ) -> Result<Vec<u8>> {
            assert_eq!(page, self.calls + 1);
            assert!(remaining <= BUDGET);
            self.calls += 1;
            self.pages.pop_front().expect("unexpected provider call")
        }
    }
    fn fake(pages: Vec<Result<Vec<u8>>>) -> Fake {
        Fake {
            pages: pages.into(),
            calls: 0,
        }
    }
    #[test]
    fn missing_total_continues_to_a_recognized_empty_page_and_drops_content() {
        let mut transport = fake(vec![
            Ok(response(vec![event("a", NOW)], None)),
            Ok(response(vec![event("b", NOW)], None)),
            Ok(response(vec![], None)),
        ]);
        let rows = fetch(
            &mut transport,
            &credential("aaa.bbb.ccc").unwrap(),
            window(),
            Instant::now(),
        )
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(transport.calls, 3);
        let bytes = merge(None, rows).unwrap();
        assert!(!String::from_utf8(bytes).unwrap().contains("PRIVATE_CANARY"));
    }
    #[test]
    fn invalid_success_short_total_repeated_pages_and_changed_totals_refuse() {
        let cases = vec![
            vec![Ok(br#"{"total":0}"#.to_vec())],
            vec![
                Ok(response(vec![event("a", NOW)], Some(2))),
                Ok(response(vec![], Some(2))),
            ],
            vec![
                Ok(response(vec![event("a", NOW)], None)),
                Ok(response(vec![event("a", NOW)], None)),
            ],
            vec![
                Ok(response(vec![event("a", NOW)], Some(2))),
                Ok(response(vec![event("b", NOW)], Some(3))),
            ],
            vec![Ok(response(vec![event("a", NOW + 1)], Some(1)))],
        ];
        for pages in cases {
            assert!(fetch(
                &mut fake(pages),
                &credential("aaa.bbb.ccc").unwrap(),
                window(),
                Instant::now()
            )
            .is_err());
        }
    }
    #[test]
    fn merge_retains_absent_sessions_and_ignores_older_versions() {
        let previous = merge(None, vec![event("a", NOW), event("b", NOW)]).unwrap();
        let merged: Vec<Value> = serde_json::from_slice(
            &merge(Some(&previous), vec![event("a", NOW - 1), event("c", NOW)]).unwrap(),
        )
        .unwrap();
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0]["usage_time"], NOW);
        assert_eq!(merge(Some(&previous), vec![]).unwrap(), previous);
    }
    #[test]
    fn counters_costs_and_credentials_have_strict_bounds() {
        for bad in [
            json!(-1),
            json!(1_000_000_000_000_001u64),
            json!("100"),
            Value::Null,
        ] {
            let mut row = event("a", NOW);
            row["extra_info"]["input_token"] = bad;
            assert!(project(&row).is_err());
        }
        let mut row = event("a", NOW);
        row["dollar_float"] = json!(-0.1);
        assert!(project(&row).is_err());
        assert!(credential("aaa.bbb.ccc\r\nCookie: secret").is_err());
        assert!(credential("not-a-jwt").is_err());
        assert!(credential("aaa.bbb.ccc").unwrap().header.is_sensitive());
    }
    #[test]
    fn deadline_refuses_before_transport() {
        let mut transport = fake(vec![]);
        assert_eq!(
            fetch(
                &mut transport,
                &credential("aaa.bbb.ccc").unwrap(),
                window(),
                Instant::now() - BUDGET
            )
            .unwrap_err(),
            "trae_refresh_timeout"
        );
        assert_eq!(transport.calls, 0);
    }
    #[test]
    fn failed_page_and_changed_credential_preserve_last_complete_cache() {
        let parent = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).unwrap();
        let path = parent.join(format!("aicharts-trae-test-{}", hex(&nonce)));
        let first = credential("aaa.bbb.ccc").unwrap();
        refresh(
            &path,
            &first,
            window(),
            &mut fake(vec![Ok(response(vec![event("a", NOW)], Some(1)))]),
            Instant::now(),
        )
        .unwrap();
        let before = std::fs::read(path.join("usage.json")).unwrap();
        assert!(refresh(
            &path,
            &first,
            window(),
            &mut fake(vec![
                Ok(response(vec![event("b", NOW)], Some(2))),
                Err("synthetic_failure")
            ]),
            Instant::now()
        )
        .is_err());
        assert_eq!(std::fs::read(path.join("usage.json")).unwrap(), before);
        let mut transport = fake(vec![]);
        assert_eq!(
            refresh(
                &path,
                &credential("aaa.bbb.ddd").unwrap(),
                window(),
                &mut transport,
                Instant::now()
            )
            .unwrap_err(),
            "trae_refresh_profile_mismatch"
        );
        assert_eq!(transport.calls, 0);
        assert_eq!(std::fs::read(path.join("usage.json")).unwrap(), before);
        std::fs::remove_dir_all(path).unwrap();
    }
}
