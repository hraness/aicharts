//! Explicit, account-bound Cursor acquisition. Secrets and source events never
//! enter the AI Charts network protocol; the only remote destination is Cursor.
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    io::Read,
    path::PathBuf,
    time::{Duration, Instant},
};

#[cfg(unix)]
mod antigravity;
#[cfg(unix)]
pub(crate) mod disk;
#[cfg(unix)]
mod hindsight;
#[cfg(test)]
mod tests;
#[cfg(unix)]
mod trae;
#[cfg(unix)]
mod warp;

const ENDPOINT: &str = "https://cursor.com/api/dashboard/get-filtered-usage-events";
const SUMMARY_ENDPOINT: &str = "https://cursor.com/api/usage-summary";
const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_PAGES: usize = 500;
const PAGE_SIZE: usize = 500;
const BUDGET: Duration = Duration::from_secs(600);
// Incremental refreshes re-read the newest cached events so usage that Cursor
// posts late still lands in the cache; the merge replaces only days present in
// the fresh window and retains every absent day.
const OVERLAP_MS: u64 = 2 * 86_400_000;
// A first refresh without cache history is bounded to a rolling month; deeper
// history belongs to exported CSV/JSON source files, not the paging endpoint.
const FIRST_RUN_MS: u64 = 30 * 86_400_000;
// Events reposted with old timestamps shift page boundaries inside a pinned
// fetch window; only mass duplication beyond this bound is treated as damage.
const MAX_DRIFT_DUPLICATES: usize = 1024;
const INVALID: &str = "cursor_refresh_response_invalid";
const LIMIT: &str = "cursor_refresh_limit";
const CREDENTIAL: &str = "cursor_refresh_credential_invalid";
type Result<T> = std::result::Result<T, &'static str>;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
struct Credential {
    cookie: ureq::http::HeaderValue,
    account: String,
}
fn credential(raw: &str, desktop_access_token: bool) -> Result<Credential> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > 16 * 1024 || raw.bytes().any(|b| !b.is_ascii_graphic()) {
        return Err(CREDENTIAL);
    }
    let (prefix, jwt) = if desktop_access_token {
        (None, raw)
    } else {
        let (user, jwt) = raw
            .split_once("%3A%3A")
            .or_else(|| raw.split_once("::"))
            .ok_or(CREDENTIAL)?;
        (Some(user), jwt)
    };
    let parts: Vec<_> = jwt.split('.').collect();
    if parts.len() != 3
        || parts.iter().any(|part| {
            part.is_empty()
                || part
                    .bytes()
                    .any(|b| !(b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
        })
    {
        return Err(CREDENTIAL);
    }
    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|_| CREDENTIAL)?;
    let claims: Value = serde_json::from_slice(&payload).map_err(|_| CREDENTIAL)?;
    let subject = claims
        .get("sub")
        .and_then(Value::as_str)
        .ok_or(CREDENTIAL)?;
    // Subjects that embed the account id behind an identity-provider
    // connection (`auth0|user_…`, `workos|user_…`, `google-oauth2|user_…`)
    // prove the binding: the cookie prefix must equal that final segment.
    // IdP-backed subjects (`google-oauth2|<numeric>`, …) never carry the
    // account id; the cookie prefix is the only `user_` source and Cursor
    // still authenticates the JWT itself. Desktop access tokens have no
    // prefix, so they must provide a `user_` subject.
    let derived = subject.rsplit('|').next().unwrap_or(subject);
    let user = if derived.starts_with("user_") {
        derived
    } else {
        prefix.ok_or(CREDENTIAL)?
    };
    if !user.starts_with("user_")
        || !(6..=128).contains(&user.len())
        || user
            .bytes()
            .any(|b| !(b.is_ascii_alphanumeric() || b == b'_'))
        || prefix.is_some_and(|value| value != user)
    {
        return Err(CREDENTIAL);
    }
    // Decoding identifies the intended account; Cursor still authenticates the
    // signature. We do not claim this local decode proves token authenticity.
    let account = hex(&Sha256::digest(
        format!("aicharts:cursor-account:v1\0{user}").as_bytes(),
    ));
    let mut cookie =
        ureq::http::HeaderValue::from_str(&format!("WorkosCursorSessionToken={user}%3A%3A{jwt}"))
            .map_err(|_| CREDENTIAL)?;
    cookie.set_sensitive(true);
    Ok(Credential { cookie, account })
}

trait Transport {
    fn summary(&mut self, credential: &Credential, remaining: Duration) -> Result<Vec<u8>>;
    fn page(
        &mut self,
        credential: &Credential,
        page: usize,
        range_ms: (u64, u64),
        remaining: Duration,
        max_bytes: usize,
    ) -> Result<Vec<u8>>;
}
struct Https;
impl Transport for Https {
    fn summary(&mut self, credential: &Credential, remaining: Duration) -> Result<Vec<u8>> {
        self.request(credential, None, remaining, 128 * 1024)
    }
    fn page(
        &mut self,
        credential: &Credential,
        page: usize,
        range_ms: (u64, u64),
        remaining: Duration,
        max_bytes: usize,
    ) -> Result<Vec<u8>> {
        self.request(credential, Some((page, range_ms)), remaining, max_bytes)
    }
}
impl Https {
    fn request(
        &mut self,
        credential: &Credential,
        page: Option<(usize, (u64, u64))>,
        remaining: Duration,
        max_bytes: usize,
    ) -> Result<Vec<u8>> {
        // Fixed host, no ambient proxy, redirects, retries, or response-body logs.
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
            ureq::unversioned::transport::DefaultConnector::default(),
            crate::transport_dns::SourceResolver::https("cursor.com", 443)
                .map_err(|_| "cursor_refresh_transport_unavailable")?,
        );
        let mut response = if let Some((page, range)) = page {
            let body = serde_json::to_vec(&json!({
                "teamId": 0,
                "page": page,
                "pageSize": PAGE_SIZE,
                "startDate": range.0,
                "endDate": range.1,
            }))
            .map_err(|_| INVALID)?;
            agent
                .post(ENDPOINT)
                .header("Cookie", credential.cookie.clone())
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("Origin", "https://cursor.com")
                .header("Referer", "https://cursor.com/settings")
                .header("Connection", "close")
                .send(body)
        } else {
            agent
                .get(SUMMARY_ENDPOINT)
                .header("Cookie", credential.cookie.clone())
                .header("Accept", "application/json")
                .header("Referer", "https://cursor.com/settings")
                .header("Connection", "close")
                .call()
        }
        .map_err(|_| "cursor_refresh_transport_unavailable")?;
        match response.status().as_u16() {
            200 => {}
            401 | 403 => return Err("cursor_refresh_unauthorized"),
            _ => return Err("cursor_refresh_http_rejected"),
        }
        let mut media = response.headers().get_all("content-type").iter();
        if !media
            .next()
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| {
                value
                    .split(';')
                    .next()
                    .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
            })
            || media.next().is_some()
        {
            return Err(INVALID);
        }
        let mut bytes = Vec::new();
        response
            .body_mut()
            .as_reader()
            .take(max_bytes as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "cursor_refresh_read_failed")?;
        if bytes.len() > max_bytes {
            return Err(LIMIT);
        }
        Ok(bytes)
    }
}
fn remaining(started: Instant) -> Result<Duration> {
    BUDGET
        .checked_sub(started.elapsed())
        .filter(|v| !v.is_zero())
        .ok_or("cursor_refresh_timeout")
}
fn integer(value: &Value) -> Result<u64> {
    if let Some(value) = value
        .as_u64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
    {
        return (value <= 1_000_000_000_000_000)
            .then_some(value)
            .ok_or(INVALID);
    }
    // Some provider responses encode counts as 10.0 or "10.0". Only exact,
    // nonnegative integers below the f64 exact-integer range are admitted.
    let value = value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
        .ok_or(INVALID)?;
    if value.is_finite() && (0.0..=1_000_000_000_000_000.0).contains(&value) && value.fract() == 0.0
    {
        Ok(value as u64)
    } else {
        Err(INVALID)
    }
}

fn cents(value: &Value) -> Result<f64> {
    let value = value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
        .ok_or(INVALID)?;
    if value.is_finite() && (0.0..=100_000_000.0).contains(&value) {
        Ok(value)
    } else {
        Err(INVALID)
    }
}
fn text(value: &Value, cap: usize) -> Result<String> {
    let value = value.as_str().ok_or(INVALID)?;
    if value.is_empty()
        || value.len() > cap
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(INVALID);
    }
    Ok(value.to_owned())
}
fn day(event: &Value) -> Result<String> {
    let timestamp = integer(event.get("timestamp").ok_or(INVALID)?)?;
    let time = time::OffsetDateTime::from_unix_timestamp_nanos(i128::from(timestamp) * 1_000_000)
        .map_err(|_| INVALID)?;
    if !(2000..=2100).contains(&time.year()) {
        return Err(INVALID);
    }
    Ok(time.date().to_string())
}
fn project(event: &Value) -> Result<Value> {
    let object = event.as_object().ok_or(INVALID)?;
    let mut result = Map::new();
    result.insert(
        "timestamp".into(),
        integer(object.get("timestamp").ok_or(INVALID)?)?.into(),
    );
    result.insert(
        "model".into(),
        text(object.get("model").ok_or(INVALID)?, 256)?.into(),
    );
    if let Some(value) = object.get("conversationId").filter(|v| !v.is_null()) {
        let id = value.as_str().ok_or(INVALID)?;
        if !id.trim().is_empty() {
            result.insert("conversationId".into(), text(value, 256)?.into());
        }
    }
    let mut evidence = false;
    if let Some(value) = object.get("chargedCents").filter(|v| !v.is_null()) {
        result.insert("chargedCents".into(), json!(cents(value)?));
        evidence = true;
    }
    if let Some(value) = object.get("tokenUsage").filter(|v| !v.is_null()) {
        let usage = value.as_object().ok_or(INVALID)?;
        let mut projected = Map::new();
        for key in [
            "inputTokens",
            "outputTokens",
            "cacheReadTokens",
            "cacheWriteTokens",
        ] {
            if let Some(value) = usage.get(key).filter(|v| !v.is_null()) {
                projected.insert(key.into(), integer(value)?.into());
                evidence = true;
            }
        }
        if let Some(value) = usage.get("totalCents").filter(|v| !v.is_null()) {
            projected.insert("totalCents".into(), json!(cents(value)?));
            evidence = true;
        }
        result.insert("tokenUsage".into(), projected.into());
    }
    if !evidence {
        return Err(INVALID);
    }
    let result = Value::Object(result);
    day(&result)?;
    Ok(result)
}
fn validate_summary(bytes: &[u8]) -> Result<u64> {
    if bytes.len() > 128 * 1024 {
        return Err(LIMIT);
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    let date = |key| -> Result<time::OffsetDateTime> {
        let value = value.get(key).and_then(Value::as_str).ok_or(INVALID)?;
        time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
            .map_err(|_| INVALID)
    };
    let start = date("billingCycleStart")?;
    let end = date("billingCycleEnd")?;
    if start >= end
        || end - start > time::Duration::days(400)
        || !(2000..=2100).contains(&start.year())
        || !(2000..=2100).contains(&end.year())
    {
        return Err(INVALID);
    }
    u64::try_from(start.unix_timestamp_nanos() / 1_000_000).map_err(|_| INVALID)
}

/// Newest cached event timestamp, used to bound the next fetch window. A
/// malformed cache degrades to the bounded first-run window; merge() still
/// rejects it outright afterwards.
fn latest_event_ms(previous: &[u8]) -> Option<u64> {
    serde_json::from_slice::<Value>(previous)
        .ok()?
        .get("usageEventsDisplay")?
        .as_array()?
        .iter()
        .filter_map(|event| event.get("timestamp")?.as_u64())
        .max()
}

fn fetch(
    transport: &mut impl Transport,
    credential: &Credential,
    started: Instant,
    cache_latest_ms: Option<u64>,
) -> Result<Vec<Value>> {
    let summary = transport.summary(credential, remaining(started)?)?;
    remaining(started)?;
    let billing_start_ms = validate_summary(&summary)?;
    let until_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .map_err(|_| INVALID)?;
    // Pinning both bounds freezes the page range: events arriving while paging
    // cannot shift rows between pages or extend an already-sized total.
    let since_ms = match cache_latest_ms {
        Some(latest) => latest.saturating_sub(OVERLAP_MS).min(until_ms),
        None => billing_start_ms.min(until_ms.saturating_sub(FIRST_RUN_MS)),
    };
    let range = (since_ms, until_ms);
    let mut rows = Vec::new();
    let mut bytes = summary.len();
    let mut total = None;
    let mut duplicates = 0usize;
    let mut page_hashes = BTreeSet::new();
    let mut event_hashes = BTreeSet::new();
    for page in 1..=MAX_PAGES {
        let body = transport.page(
            credential,
            page,
            range,
            remaining(started)?,
            MAX_BYTES - bytes,
        )?;
        remaining(started)?;
        bytes = bytes
            .checked_add(body.len())
            .filter(|n| *n <= MAX_BYTES)
            .ok_or(LIMIT)?;
        let value: Value = serde_json::from_slice(&body).map_err(|_| INVALID)?;
        let advertised = value
            .get("totalUsageEventsCount")
            .and_then(Value::as_u64)
            .filter(|n| *n <= (MAX_PAGES * PAGE_SIZE) as u64)
            .ok_or(INVALID)? as usize;
        // Usage events arrive append-only but can be posted with past
        // timestamps, so a growing advertised total is expected mid-pagination;
        // a shrinking one means the basis moved and the refresh cannot settle.
        if total.is_some_and(|previous| advertised < previous) {
            return Err("cursor_refresh_history_changed");
        }
        total = Some(advertised);
        let events = value
            .get("usageEventsDisplay")
            .and_then(Value::as_array)
            .ok_or(INVALID)?;
        if events.len() > PAGE_SIZE
            || !page_hashes
                .insert(Sha256::digest(serde_json::to_vec(events).map_err(|_| INVALID)?).to_vec())
        {
            return Err("cursor_refresh_repeated_page");
        }
        for event in events {
            let projected = project(event)?;
            let fingerprint =
                Sha256::digest(serde_json::to_vec(&projected).map_err(|_| INVALID)?).to_vec();
            // Inserts inside the pinned window shift page boundaries, so the
            // same event can be observed twice on adjacent pages; identical
            // projections are one event, not two. Mass duplication still fails.
            if !event_hashes.insert(fingerprint) {
                duplicates += 1;
                if duplicates > MAX_DRIFT_DUPLICATES {
                    return Err("cursor_refresh_duplicate_event");
                }
                continue;
            }
            rows.push(projected);
        }
        if rows.len() > advertised {
            return Err(INVALID);
        }
        if rows.len() == advertised {
            return Ok(rows);
        }
        if events.is_empty() {
            return Err("cursor_refresh_incomplete");
        }
        if bytes == MAX_BYTES {
            return Err(LIMIT);
        }
    }
    Err(LIMIT)
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    schema_version: u8,
    client: String,
    account: String,
}
fn merge(previous: Option<&[u8]>, fresh: Vec<Value>) -> Result<Vec<u8>> {
    if fresh.is_empty() {
        return Err("cursor_refresh_empty_preserved");
    }
    let fresh = fresh.iter().map(project).collect::<Result<Vec<_>>>()?;
    let days: BTreeSet<_> = fresh.iter().map(day).collect::<Result<_>>()?;
    // Cursor both posts past-dated events late and ages old events out of the
    // endpoint, so a refetched day can report fewer events than were observed
    // before. Publication preserves history and never accepts a decline, so a
    // covered day unions: cached events absent from the fresh page stay, and
    // identical projections still count once.
    let fresh_fingerprints: BTreeSet<Vec<u8>> = fresh
        .iter()
        .map(|event| {
            serde_json::to_vec(event)
                .map(|bytes| Sha256::digest(&bytes).to_vec())
                .map_err(|_| INVALID)
        })
        .collect::<Result<_>>()?;
    let mut rows = Vec::new();
    if let Some(previous) = previous {
        let previous: Value =
            serde_json::from_slice(previous).map_err(|_| "cursor_refresh_cache_invalid")?;
        let events = previous
            .get("usageEventsDisplay")
            .and_then(Value::as_array)
            .ok_or("cursor_refresh_cache_invalid")?;
        for event in events {
            let event = project(event).map_err(|_| "cursor_refresh_cache_invalid")?;
            let covered = days.contains(&day(&event)?);
            let identical = serde_json::to_vec(&event)
                .map(|bytes| fresh_fingerprints.contains(&Sha256::digest(&bytes).to_vec()))
                .map_err(|_| INVALID)?;
            if !covered || !identical {
                rows.push(event);
            }
        }
    }
    rows.extend(fresh);
    if rows.len() > 2_000_000 {
        return Err(LIMIT);
    }
    rows.sort_by_key(|row| row.get("timestamp").and_then(Value::as_u64).unwrap_or(0));
    let bytes = serde_json::to_vec(&json!({"usageEventsDisplay":rows})).map_err(|_| INVALID)?;
    if bytes.len() > MAX_BYTES {
        return Err(LIMIT);
    }
    Ok(bytes)
}

pub(super) fn run(args: &[String]) -> Result<String> {
    if args == ["--help"] || args == ["-h"] {
        return Ok("AI Charts provider refresh — explicit numeric cache acquisition\n\n  aicharts refresh cursor --help\n  aicharts refresh trae --help\n  aicharts refresh warp --help\n  aicharts refresh hindsight --help\n  aicharts refresh antigravity --help\n\nA refresh reads one explicitly selected provider account into a private numeric\ncache. It does not publish to AI Charts. Failed refreshes preserve the last\ncomplete cache. Use stats --source-root to inspect it and autosubmit --help\nfor scheduled refresh and publication. See docs/usage-autosubmit.md.\n".into());
    }
    if args == ["cursor", "--help"] || args == ["cursor", "-h"] {
        return Ok("AI Charts Cursor refresh\n\n  aicharts refresh cursor --cache-dir ABS (--session-token-file ABS | --cursor-state-db ABS)\n\nSelect exactly one credential source. The private token file contains an existing\nWorkos session token; --cursor-state-db explicitly reads the signed-in desktop\ncredential. No login or credential discovery occurs implicitly. The fixed Cursor\nservice authenticates the account. Complete numeric pages merge into a private,\naccount-bound cache; prompts and response text are discarded. The refresh is\nbounded to 500 pages, 64 MiB and 600 seconds. Fetches are windowed to the\naccount's newest cached events plus overlap, or a bounded first-run lookback.\nFailure preserves prior history. Nothing is published to AI Charts by this command.\n".into());
    }
    #[cfg(unix)]
    match args.first().map(String::as_str) {
        Some("warp") => return warp::run(args),
        Some("hindsight") => return hindsight::run(args),
        Some("antigravity") => return antigravity::run(&args[1..]),
        _ => {}
    }
    #[cfg(unix)]
    if args.first().is_some_and(|value| value == "trae") {
        return trae::run(&args[1..]);
    }
    log::set_max_level(log::LevelFilter::Off);
    #[cfg(not(unix))]
    {
        let _ = args;
        Err("cursor_refresh_platform_unsupported")
    }
    #[cfg(unix)]
    {
        if args.first().map(String::as_str) != Some("cursor") {
            return Err("source_refresh_usage");
        }
        let mut cache = None;
        let mut token_file = None;
        let mut state_db = None;
        let mut index = 1;
        while index < args.len() {
            let value = args.get(index + 1).ok_or("source_refresh_usage")?;
            let destination = match args[index].as_str() {
                "--cache-dir" => &mut cache,
                "--session-token-file" => &mut token_file,
                "--cursor-state-db" => &mut state_db,
                _ => return Err("source_refresh_usage"),
            };
            if destination.replace(PathBuf::from(value)).is_some() {
                return Err("source_refresh_usage");
            }
            index += 2;
        }
        let cache = cache.ok_or("source_refresh_usage")?;
        if token_file.is_some() == state_db.is_some() {
            return Err("source_refresh_usage");
        }
        let started = Instant::now();
        let token = if let Some(path) = &token_file {
            disk::read_secret(path)?
        } else {
            disk::read_desktop_token(state_db.as_ref().ok_or(CREDENTIAL)?)?
        };
        let credential = credential(&token, state_db.is_some())?;
        refresh(&cache, &credential, &mut Https, started)
    }
}
#[cfg(unix)]
fn refresh(
    path: &std::path::Path,
    credential: &Credential,
    transport: &mut impl Transport,
    started: Instant,
) -> Result<String> {
    let cache = disk::Cache::open(path)?;
    let expected = Binding {
        schema_version: 1,
        client: "cursor".into(),
        account: credential.account.clone(),
    };
    let manifest = cache.read("profile.json", 4096)?;
    if let Some(bytes) = &manifest {
        let binding: Binding =
            serde_json::from_slice(bytes).map_err(|_| "cursor_refresh_cache_invalid")?;
        if binding.schema_version != 1
            || binding.client != "cursor"
            || binding.account != credential.account
        {
            return Err("cursor_refresh_account_mismatch");
        }
    }
    let name = format!("usage.{}.json", &credential.account[..32]);
    cache.require_entries(&["refresh.lock", "profile.json", &name])?;
    let previous = cache.read(&name, MAX_BYTES)?;
    if manifest.is_none() && previous.is_some() {
        return Err("cursor_refresh_cache_unbound");
    }
    let fresh = fetch(
        transport,
        credential,
        started,
        previous.as_deref().and_then(latest_event_ms),
    )?;
    let received = fresh.len();
    // A completely empty window is a successful no-change refresh: the retained
    // cache still holds the account's history. Only a cache-less first refresh
    // that finds nothing keeps the existing refusal.
    let bytes = if fresh.is_empty() {
        previous.clone().ok_or("cursor_refresh_empty_preserved")?
    } else {
        merge(previous.as_deref(), fresh)?
    };
    remaining(started)?;
    if manifest.is_none() {
        cache.create_binding(&serde_json::to_vec(&expected).map_err(|_| INVALID)?)?;
    }
    cache.replace(&name, &bytes)?;
    serde_json::to_string(&json!({"client":"cursor","refreshedEvents":received,"cacheBytes":bytes.len(),"historyPolicy":"union_present_utc_days_retain_absent_days"})).map_err(|_| INVALID)
}
