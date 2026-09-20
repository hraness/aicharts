//! Explicit Warp aggregate acquisition. A refresh is a current account/workspace
//! counter snapshot at sync time, not daily event history or measured tokens.
use crate::transport_dns::SourceResolver;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    io::Read,
    path::PathBuf,
    time::{Duration, Instant},
};
use ureq::http::HeaderValue;
const URL: &str = "https://app.warp.dev/graphql/v2";
const MAX_BYTES: usize = 4 * 1024 * 1024;
const BUDGET: Duration = Duration::from_secs(30);
const INVALID: &str = "warp_refresh_response_invalid";
type Result<T> = std::result::Result<T, &'static str>;
const QUERIES: [(&str, &str); 2] = [
    ("GetRequestLimitInfo", "query GetRequestLimitInfo { requestLimitInfo { requestsUsedSinceLastRefresh bonusGrantsInfo { spendingInfo { currentMonthSpendCents } } } }"),
    ("GetWorkspacesMetadataForUser", "query GetWorkspacesMetadataForUser { workspacesMetadataForUser { id totalRequestsUsedSinceLastRefresh aiOverages { currentMonthlyRequestCostCents currentMonthlyRequestsUsed } usageInfo { requestsUsedSinceLastRefresh } } }"),
];
const HELP: &str = "AI Charts Warp refresh\n\n  aicharts refresh warp --cache-dir DIR (--token-file FILE | --cookie-file FILE)\n\nExplicit private credential file only (owned mode0600, no symlinks). Sends two\nbounded requests to app.warp.dev; never discovers desktop credentials. The cache\nis pinned to this credential scope. Another credential requires a new profile.\nOnly numeric aggregate requests/spend and hashed workspace identifiers persist.\nTokens are unavailable. Dates reflect refresh time; spend/request counters cover\nWarp's current billing/refresh interval, not daily events. Workspace totals take\nprecedence over duplicated account totals. Any failed request preserves the\nlast complete cache. Read it offline using stats --client warp --source-root DIR.\n";
struct Credential {
    header: HeaderValue,
    cookie: bool,
    fingerprint: String,
}
fn credential(raw: &str, cookie: bool) -> Result<Credential> {
    let raw = raw.trim();
    if raw.is_empty()
        || raw.len() > 16 * 1024
        || raw
            .bytes()
            .any(|b| !(b.is_ascii_graphic() || cookie && b == b' '))
    {
        return Err("warp_refresh_credential_invalid");
    }
    let fingerprint = super::hex(&Sha256::digest(
        format!(
            "aicharts:warp-scope:v1\0{}\0{raw}",
            if cookie { "cookie" } else { "bearer" }
        )
        .as_bytes(),
    ));
    let mut header = HeaderValue::from_str(&if cookie {
        raw.to_owned()
    } else {
        format!("Bearer {raw}")
    })
    .map_err(|_| "warp_refresh_credential_invalid")?;
    header.set_sensitive(true);
    Ok(Credential {
        header,
        cookie,
        fingerprint,
    })
}
trait Transport {
    fn query(
        &mut self,
        credential: &Credential,
        operation: &str,
        query: &str,
        remaining: Duration,
        cap: usize,
    ) -> Result<Vec<u8>>;
}
struct Https;
impl Transport for Https {
    fn query(
        &mut self,
        credential: &Credential,
        operation: &str,
        query: &str,
        remaining: Duration,
        cap: usize,
    ) -> Result<Vec<u8>> {
        let config = ureq::Agent::config_builder()
            .https_only(true)
            .proxy(None)
            .max_redirects(0)
            .http_status_as_error(false)
            .max_idle_connections(0)
            .max_response_header_size(16 * 1024)
            .timeout_global(Some(remaining))
            .timeout_resolve(Some(remaining.min(Duration::from_secs(3))))
            .timeout_connect(Some(remaining.min(Duration::from_secs(8))))
            .timeout_recv_body(Some(remaining.min(Duration::from_secs(8))))
            .build();
        let agent = ureq::Agent::with_parts(
            config,
            ureq::unversioned::transport::DefaultConnector::default(),
            SourceResolver::https("app.warp.dev", 443)
                .map_err(|_| "warp_refresh_transport_unavailable")?,
        );
        let body =
            serde_json::to_vec(&json!({"operationName":operation,"query":query,"variables":{}}))
                .map_err(|_| INVALID)?;
        let mut response = agent
            .post(URL)
            .header(
                if credential.cookie {
                    "cookie"
                } else {
                    "authorization"
                },
                credential.header.clone(),
            )
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .header("connection", "close")
            .send(body)
            .map_err(|_| "warp_refresh_transport_unavailable")?;
        match response.status().as_u16() {
            200 => (),
            401 | 403 => return Err("warp_refresh_unauthorized"),
            _ => return Err("warp_refresh_http_rejected"),
        }
        let mut bytes = Vec::new();
        response
            .body_mut()
            .as_reader()
            .take(cap as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "warp_refresh_read_failed")?;
        if bytes.len() > cap {
            return Err("warp_refresh_limit");
        }
        Ok(bytes)
    }
}
#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Usage {
    requests_used: Option<u64>,
    spend_cents: Option<u64>,
}
#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Workspace {
    id: String,
    requests_used: Option<u64>,
    spend_cents: Option<u64>,
}
#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Snapshot {
    version: u8,
    synced_at: String,
    usage: Usage,
    workspaces: Vec<Workspace>,
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    schema_version: u8,
    client: String,
    credential_scope: String,
}
fn number(value: Option<&Value>, maximum: u64) -> Result<Option<u64>> {
    value
        .filter(|v| !v.is_null())
        .map(|v| v.as_u64().filter(|n| *n <= maximum).ok_or(INVALID))
        .transpose()
}
fn data(bytes: &[u8]) -> Result<Value> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    if let Some(errors) = value.get("errors") {
        if !errors.as_array().is_some_and(|v| v.is_empty()) {
            return Err("warp_refresh_graphql_rejected");
        }
    }
    value
        .get("data")
        .filter(|v| v.is_object())
        .cloned()
        .ok_or(INVALID)
}
fn normalize(account: Value, workspaces: Value, now_ms: u64) -> Result<Snapshot> {
    let account = account
        .get("requestLimitInfo")
        .filter(|v| v.is_object())
        .ok_or(INVALID)?;
    let usage = Usage {
        requests_used: number(account.get("requestsUsedSinceLastRefresh"), i32::MAX as u64)?,
        spend_cents: number(
            account.pointer("/bonusGrantsInfo/spendingInfo/currentMonthSpendCents"),
            100_000_000_000,
        )?,
    };
    if usage.requests_used.is_none() && usage.spend_cents.is_none() {
        return Err(INVALID);
    }
    let workspace_rows = workspaces
        .get("workspacesMetadataForUser")
        .and_then(Value::as_array)
        .ok_or(INVALID)?;
    if workspace_rows.len() > 1024 {
        return Err("warp_refresh_limit");
    }
    let mut output = Vec::new();
    let mut ids = BTreeSet::new();
    for value in workspace_rows {
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control))
            .ok_or(INVALID)?;
        if !ids.insert(id) {
            return Err(INVALID);
        }
        let requests = value
            .get("totalRequestsUsedSinceLastRefresh")
            .filter(|v| !v.is_null())
            .or_else(|| value.pointer("/usageInfo/requestsUsedSinceLastRefresh"))
            .filter(|v| !v.is_null())
            .or_else(|| value.pointer("/aiOverages/currentMonthlyRequestsUsed"));
        let requests_used = number(requests, i32::MAX as u64)?;
        let spend_cents = number(
            value.pointer("/aiOverages/currentMonthlyRequestCostCents"),
            100_000_000_000,
        )?;
        if requests_used.is_none() && spend_cents.is_none() {
            return Err(INVALID);
        }
        output.push(Workspace {
            id: super::hex(&Sha256::digest(
                format!("aicharts:warp-workspace:v1\0{id}").as_bytes(),
            )),
            requests_used,
            spend_cents,
        });
    }
    output.sort_by(|a, b| a.id.cmp(&b.id));
    let synced_at = time::OffsetDateTime::from_unix_timestamp_nanos(i128::from(now_ms) * 1_000_000)
        .map_err(|_| INVALID)?
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|_| INVALID)?;
    Ok(Snapshot {
        version: 1,
        synced_at,
        usage,
        workspaces: output,
    })
}
fn fetch(transport: &mut impl Transport, credential: &Credential, now: u64) -> Result<Vec<u8>> {
    let started = Instant::now();
    let mut used = 0;
    let mut values = Vec::new();
    for (operation, query) in QUERIES {
        let remaining = BUDGET
            .checked_sub(started.elapsed())
            .filter(|d| !d.is_zero())
            .ok_or("warp_refresh_timeout")?;
        let body = transport.query(credential, operation, query, remaining, MAX_BYTES - used)?;
        used = used
            .checked_add(body.len())
            .filter(|n| *n <= MAX_BYTES)
            .ok_or("warp_refresh_limit")?;
        if started.elapsed() >= BUDGET {
            return Err("warp_refresh_timeout");
        }
        values.push(data(&body)?);
    }
    let output = serde_json::to_vec(&normalize(values.remove(0), values.remove(0), now)?)
        .map_err(|_| INVALID)?;
    if output.len() > MAX_BYTES {
        return Err("warp_refresh_limit");
    }
    Ok(output)
}
#[cfg(unix)]
fn refresh(
    cache: &super::disk::Cache,
    credential: &Credential,
    transport: &mut impl Transport,
    now: u64,
) -> Result<()> {
    cache.require_entries(&["refresh.lock", "profile.json", "usage.json"])?;
    let binding = Binding {
        schema_version: 1,
        client: "warp".to_owned(),
        credential_scope: credential.fingerprint.clone(),
    };
    if let Some(bytes) = cache.read("profile.json", 4096)? {
        let previous: Binding =
            serde_json::from_slice(&bytes).map_err(|_| "warp_refresh_profile_invalid")?;
        if previous != binding {
            return Err("warp_refresh_profile_mismatch");
        }
    } else {
        cache.create_binding(&serde_json::to_vec(&binding).map_err(|_| INVALID)?)?;
    }
    // Observe before network I/O so a concurrent out-of-band replacement is
    // refused by the shared descriptor-bound cache compare-and-swap.
    let _previous = cache.read("usage.json", MAX_BYTES)?;
    let bytes = fetch(transport, credential, now)?;
    cache.replace("usage.json", &bytes)?;
    Ok(())
}
pub(super) fn run(args: &[String]) -> Result<String> {
    if args.len() == 2 && args[1] == "--help" {
        return Ok(HELP.to_owned());
    }
    let (mut directory, mut secret, mut cookie) = (None, None, false);
    let mut index = 1;
    while index < args.len() {
        let flag = &args[index];
        index += 1;
        let value = args
            .get(index)
            .filter(|v| !v.is_empty() && !v.starts_with("--"))
            .ok_or("missing_option_value")?;
        match flag.as_str() {
            "--cache-dir" if directory.is_none() => directory = Some(PathBuf::from(value)),
            "--token-file" | "--cookie-file" if secret.is_none() => {
                secret = Some(PathBuf::from(value));
                cookie = flag == "--cookie-file";
            }
            _ => return Err("invalid_option"),
        }
        index += 1;
    }
    let directory = directory.ok_or("warp_refresh_cache_required")?;
    let secret = secret.ok_or("warp_refresh_credential_required")?;
    #[cfg(unix)]
    {
        let credential = credential(&super::disk::read_secret(&secret)?, cookie)?;
        let cache = super::disk::Cache::open(&directory)?;
        refresh(&cache, &credential, &mut Https, crate::stats::now_ms()?)?;
        Ok("{\"schemaVersion\":1,\"client\":\"warp\",\"status\":\"refreshed\",\"tokenBasis\":\"unavailable\",\"timeBasis\":\"refresh-time\"}".to_owned())
    }
    #[cfg(not(unix))]
    {
        let _ = (directory, secret, cookie);
        Err("source_refresh_requires_unix")
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    struct Fake(VecDeque<Result<Vec<u8>>>);
    impl Transport for Fake {
        fn query(
            &mut self,
            _: &Credential,
            _: &str,
            _: &str,
            _: Duration,
            _: usize,
        ) -> Result<Vec<u8>> {
            self.0.pop_front().unwrap()
        }
    }
    fn account() -> Vec<u8> {
        br#"{"data":{"requestLimitInfo":{"requestsUsedSinceLastRefresh":42,"bonusGrantsInfo":{"spendingInfo":{"currentMonthSpendCents":1234}}}}}"#.to_vec()
    }
    fn workspaces() -> Vec<u8> {
        br#"{"data":{"workspacesMetadataForUser":[{"id":"private-workspace","name":"PRIVATE_NAME","totalRequestsUsedSinceLastRefresh":12,"aiOverages":{"currentMonthlyRequestCostCents":250}}]}}"#.to_vec()
    }
    #[test]
    fn strict_numeric_projection_excludes_names_and_does_not_invent_tokens() {
        let raw = fetch(
            &mut Fake(VecDeque::from([Ok(account()), Ok(workspaces())])),
            &credential("synthetic", false).unwrap(),
            1_800_000_000_000,
        )
        .unwrap();
        let text = String::from_utf8(raw.clone()).unwrap();
        assert!(!text.contains("PRIVATE"));
        assert!(!text.contains("private-workspace"));
        assert!(!text.contains("tokens"));
        let projected: Snapshot = serde_json::from_slice(&raw).unwrap();
        assert_eq!(projected.usage.requests_used, Some(42));
        assert_eq!(projected.workspaces[0].spend_cents, Some(250));
    }
    #[test]
    fn any_failed_query_or_graphql_error_refuses_complete_snapshot() {
        for bad in [
            Err("synthetic_failure"),
            Ok(br#"{"errors":[{"message":"PRIVATE_CANARY"}],"data":{}}"#.to_vec()),
            Ok(br#"{"data":{"workspacesMetadataForUser":null}}"#.to_vec()),
        ] {
            assert!(fetch(
                &mut Fake(VecDeque::from([Ok(account()), bad])),
                &credential("synthetic", false).unwrap(),
                1_800_000_000_000
            )
            .is_err());
        }
    }
    #[test]
    fn scope_fingerprint_and_auth_header_are_bound_without_persisting_secret() {
        let a = credential("synthetic", false).unwrap();
        let b = credential("different", false).unwrap();
        assert_ne!(a.fingerprint, b.fingerprint);
        assert!(a.header.is_sensitive());
        assert!(credential("bad\r\nvalue", false).is_err());
    }
    #[test]
    fn invalid_duplicate_or_negative_workspace_counters_are_refused() {
        for value in [
            json!({"workspacesMetadataForUser":[{"id":"same","totalRequestsUsedSinceLastRefresh":1},{"id":"same","totalRequestsUsedSinceLastRefresh":2}]}),
            json!({"workspacesMetadataForUser":[{"id":"id","totalRequestsUsedSinceLastRefresh":-1}]}),
            json!({"workspacesMetadataForUser":[{"id":"id"}]}),
        ] {
            assert!(normalize(data(&account()).unwrap(), value, 1_800_000_000_000).is_err());
        }
    }
    #[cfg(unix)]
    #[test]
    fn failed_refresh_keeps_last_complete_snapshot_and_rejects_another_scope() {
        use std::os::unix::fs::PermissionsExt;
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).unwrap();
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "aicharts-warp-fixture-{}",
            super::super::hex(&nonce)
        ));
        std::fs::create_dir(&root).unwrap();
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
        let cache = super::super::disk::Cache::open(&root).unwrap();
        let auth = credential("synthetic", false).unwrap();
        refresh(
            &cache,
            &auth,
            &mut Fake(VecDeque::from([Ok(account()), Ok(workspaces())])),
            1_800_000_000_000,
        )
        .unwrap();
        let before = cache.read("usage.json", MAX_BYTES).unwrap().unwrap();
        assert_eq!(
            refresh(
                &cache,
                &auth,
                &mut Fake(VecDeque::from([Ok(account()), Err("synthetic_failure")])),
                1_800_000_000_000
            ),
            Err("synthetic_failure")
        );
        assert_eq!(
            cache.read("usage.json", MAX_BYTES).unwrap().unwrap(),
            before
        );
        assert_eq!(
            refresh(
                &cache,
                &credential("different", false).unwrap(),
                &mut Fake(VecDeque::new()),
                1_800_000_000_000
            ),
            Err("warp_refresh_profile_mismatch")
        );
        drop(cache);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
