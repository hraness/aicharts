//! Explicit Hindsight rolling trace acquisition. Only bounded numeric metadata
//! reaches the private, append-preserving ledger; response content is discarded.
use crate::transport_dns::SourceResolver;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
    path::PathBuf,
    time::{Duration, Instant},
};
use ureq::http::{HeaderValue, Uri};

const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_ROWS: usize = 200_000;
const MAX_BANKS: usize = 128;
const MAX_PAGES: usize = 512;
const PAGE_SIZE: usize = 500;
const BUDGET: Duration = Duration::from_secs(120);
const INVALID: &str = "hindsight_refresh_response_invalid";
const LIMIT: &str = "hindsight_refresh_limit";
type Result<T> = std::result::Result<T, &'static str>;
const HELP: &str = "AI Charts Hindsight refresh\n\n  aicharts refresh hindsight --cache-dir DIR --api HTTPS_URL --tenant TENANT\n      [--token-file FILE] [--allow-loopback-http]\n\nThe explicit endpoint is pinned to one authority; redirects and ambient proxies\nare disabled. HTTP requires --allow-loopback-http and a literal loopback address.\nA private profile binds endpoint, tenant and credential scope. Responses are\nprojected to token counts and timestamps; prompt, output and metadata content\nnever persist. All banks and pages must finish before one atomic publication.\nRows absent from the service's short retention window remain in the local ledger.\nRefresh regularly while Hindsight runs to retain its rolling trace history.\nRead the cache offline with stats --client hindsight --source-root DIR.\n";

struct Endpoint {
    base: String,
    host: String,
    port: u16,
    cleartext: bool,
    tenant: String,
}
fn text(value: &str, cap: usize) -> Result<String> {
    if value.is_empty()
        || value.len() > cap
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(INVALID);
    }
    Ok(value.to_owned())
}
fn segment(value: &str) -> Result<String> {
    text(value, 256)?;
    if value == "." || value == ".." {
        return Err(INVALID);
    }
    Ok(value
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect())
}
impl Endpoint {
    fn new(base: &str, tenant: &str, allow_http: bool) -> Result<Self> {
        if base.len() > 2048
            || base.contains(['#', '?', '\\'])
            || base.bytes().any(|b| !b.is_ascii_graphic())
        {
            return Err("hindsight_refresh_endpoint_invalid");
        }
        let uri: Uri = base
            .parse()
            .map_err(|_| "hindsight_refresh_endpoint_invalid")?;
        let authority = uri
            .authority()
            .ok_or("hindsight_refresh_endpoint_invalid")?;
        if authority.as_str().contains('@') {
            return Err("hindsight_refresh_endpoint_invalid");
        }
        let cleartext = match uri.scheme_str() {
            Some("https") => false,
            Some("http") if allow_http => true,
            _ => return Err("hindsight_refresh_endpoint_invalid"),
        };
        let host = authority.host().to_owned();
        let port = authority
            .port_u16()
            .unwrap_or(if cleartext { 80 } else { 443 });
        if cleartext {
            SourceResolver::loopback_http(&host, port)
        } else {
            SourceResolver::https(&host, port)
        }
        .map_err(|_| "hindsight_refresh_endpoint_invalid")?;
        // A service may have a reverse-proxy prefix; admit only literal safe
        // segments, never encoded separators, dot segments or query fragments.
        let path = uri.path().trim_end_matches('/');
        if !path.is_empty()
            && (!path.starts_with('/')
                || path.split('/').skip(1).any(|s| {
                    s.is_empty()
                        || !s
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                }))
        {
            return Err("hindsight_refresh_endpoint_invalid");
        }
        let base = format!(
            "{}://{}{path}",
            if cleartext { "http" } else { "https" },
            authority
        );
        Ok(Self {
            base,
            host,
            port,
            cleartext,
            tenant: segment(tenant)?,
        })
    }
    fn banks(&self) -> String {
        format!("{}/v1/{}/banks", self.base, self.tenant)
    }
    fn rows(&self, bank: &str, offset: usize) -> Result<String> {
        Ok(format!(
            "{}/{}/llm-requests?status=success&limit={PAGE_SIZE}&offset={offset}",
            self.banks(),
            segment(bank)?
        ))
    }
}
struct Credential {
    header: Option<HeaderValue>,
    scope: String,
}
fn credential(raw: Option<&str>, endpoint: &Endpoint) -> Result<Credential> {
    let raw = raw.map(str::trim);
    let header = if let Some(raw) = raw {
        if raw.is_empty() || raw.len() > 16 * 1024 || raw.bytes().any(|b| !b.is_ascii_graphic()) {
            return Err("hindsight_refresh_credential_invalid");
        }
        let mut header = HeaderValue::from_str(&format!("Bearer {raw}"))
            .map_err(|_| "hindsight_refresh_credential_invalid")?;
        header.set_sensitive(true);
        Some(header)
    } else {
        None
    };
    let scope = super::hex(&Sha256::digest(
        format!(
            "aicharts:hindsight-scope:v1\0{}\0{}\0{}",
            endpoint.base,
            endpoint.tenant,
            raw.unwrap_or("")
        )
        .as_bytes(),
    ));
    Ok(Credential { header, scope })
}
trait Transport {
    fn get(
        &mut self,
        endpoint: &Endpoint,
        credential: &Credential,
        url: &str,
        remaining: Duration,
        cap: usize,
    ) -> Result<Vec<u8>>;
}
struct Http;
impl Transport for Http {
    fn get(
        &mut self,
        endpoint: &Endpoint,
        credential: &Credential,
        url: &str,
        remaining: Duration,
        cap: usize,
    ) -> Result<Vec<u8>> {
        let config = ureq::Agent::config_builder()
            .https_only(!endpoint.cleartext)
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
        let resolver = if endpoint.cleartext {
            SourceResolver::loopback_http(&endpoint.host, endpoint.port)
        } else {
            SourceResolver::https(&endpoint.host, endpoint.port)
        }
        .map_err(|_| "hindsight_refresh_endpoint_invalid")?;
        let agent = ureq::Agent::with_parts(
            config,
            ureq::unversioned::transport::DefaultConnector::default(),
            resolver,
        );
        let mut request = agent
            .get(url)
            .header("accept", "application/json")
            .header("connection", "close");
        if let Some(header) = &credential.header {
            request = request.header("authorization", header.clone());
        }
        let mut response = request
            .call()
            .map_err(|_| "hindsight_refresh_transport_unavailable")?;
        match response.status().as_u16() {
            200 => (),
            401 | 403 => return Err("hindsight_refresh_unauthorized"),
            _ => return Err("hindsight_refresh_http_rejected"),
        }
        let mut bytes = Vec::new();
        response
            .body_mut()
            .as_reader()
            .take(cap as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "hindsight_refresh_read_failed")?;
        if bytes.len() > cap {
            return Err(LIMIT);
        }
        Ok(bytes)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Row {
    id: String,
    provider: String,
    model: String,
    started_at: String,
    duration_ms: Option<u64>,
    input_tokens: u64,
    output_tokens: u64,
    cached_tokens: Option<u64>,
    total_tokens: u64,
    bank: String,
}
fn number(value: Option<&Value>) -> Result<Option<u64>> {
    value
        .filter(|v| !v.is_null())
        .map(|v| {
            v.as_u64()
                .filter(|n| *n <= 1_000_000_000_000_000)
                .ok_or(INVALID)
        })
        .transpose()
}
fn normalize(value: &Value, bank: &str, now: u64) -> Result<Option<Row>> {
    let id = text(value.get("id").and_then(Value::as_str).ok_or(INVALID)?, 256)?;
    let total = number(Some(value.get("total_tokens").ok_or(INVALID)?))?;
    // Explicit zero/null means this service trace carries no successful usage.
    // A missing counter is a schema failure, not permission to erase history.
    if total.is_none_or(|v| v == 0) {
        return Ok(None);
    }
    let started_at = text(
        value
            .get("started_at")
            .and_then(Value::as_str)
            .ok_or(INVALID)?,
        128,
    )?;
    let timestamp =
        time::OffsetDateTime::parse(&started_at, &time::format_description::well_known::Rfc3339)
            .map_err(|_| INVALID)?;
    let millis = timestamp.unix_timestamp_nanos() / 1_000_000;
    if millis <= 0 || millis > i128::from(now) {
        return Err(INVALID);
    }
    let input_tokens = number(value.get("input_tokens"))?.ok_or(INVALID)?;
    let output_tokens = number(value.get("output_tokens"))?.ok_or(INVALID)?;
    let cached_tokens = number(value.get("cached_tokens"))?;
    if !valid_totals(
        input_tokens,
        output_tokens,
        cached_tokens,
        total.ok_or(INVALID)?,
    ) {
        return Err(INVALID);
    }
    let duration_ms = number(value.get("duration_ms"))?;
    if duration_ms.is_some_and(|n| n > 366 * 86_400_000) {
        return Err(INVALID);
    }
    if value
        .get("bank_id")
        .filter(|v| !v.is_null())
        .is_some_and(|v| v.as_str() != Some(bank))
    {
        return Err(INVALID);
    }
    let label = |name: &str| -> Result<String> {
        match value.get(name).filter(|v| !v.is_null()) {
            Some(v) => text(v.as_str().ok_or(INVALID)?, 256),
            None => Ok("unknown".to_owned()),
        }
    };
    Ok(Some(Row {
        id: super::hex(&Sha256::digest(
            format!("aicharts:hindsight-row:v1\0{id}").as_bytes(),
        )),
        bank: super::hex(&Sha256::digest(
            format!("aicharts:hindsight-bank:v1\0{bank}").as_bytes(),
        )),
        provider: label("provider")?,
        model: label("model")?,
        started_at: timestamp
            .to_offset(time::UtcOffset::UTC)
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|_| INVALID)?,
        duration_ms,
        input_tokens,
        output_tokens,
        cached_tokens,
        total_tokens: total.ok_or(INVALID)?,
    }))
}
fn fetch(
    transport: &mut impl Transport,
    endpoint: &Endpoint,
    credential: &Credential,
    now: u64,
) -> Result<Vec<Row>> {
    let started = Instant::now();
    let mut used = 0usize;
    let mut request = |url: &str| -> Result<Value> {
        let remaining = BUDGET
            .checked_sub(started.elapsed())
            .filter(|d| !d.is_zero())
            .ok_or("hindsight_refresh_timeout")?;
        let bytes = transport.get(endpoint, credential, url, remaining, MAX_BYTES - used)?;
        used = used
            .checked_add(bytes.len())
            .filter(|v| *v <= MAX_BYTES)
            .ok_or(LIMIT)?;
        if started.elapsed() >= BUDGET {
            return Err("hindsight_refresh_timeout");
        }
        serde_json::from_slice(&bytes).map_err(|_| INVALID)
    };
    let response = request(&endpoint.banks())?;
    let banks = response
        .get("banks")
        .and_then(Value::as_array)
        .ok_or(INVALID)?;
    if banks.len() > MAX_BANKS {
        return Err(LIMIT);
    }
    let mut bank_ids = BTreeSet::new();
    for value in banks {
        if !bank_ids.insert(text(
            value
                .get("bank_id")
                .and_then(Value::as_str)
                .ok_or(INVALID)?,
            256,
        )?) {
            return Err(INVALID);
        }
    }
    let mut rows = Vec::new();
    let mut seen = BTreeSet::new();
    let mut pages = 0;
    let mut observed = 0usize;
    for bank in bank_ids {
        let mut offset = 0usize;
        let mut expected = None;
        loop {
            pages += 1;
            if pages > MAX_PAGES {
                return Err(LIMIT);
            }
            let response = request(&endpoint.rows(&bank, offset)?)?;
            let items = response
                .get("items")
                .and_then(Value::as_array)
                .ok_or(INVALID)?;
            if items.len() > PAGE_SIZE {
                return Err(LIMIT);
            }
            let total = number(response.get("total"))?
                .map(|v| usize::try_from(v).map_err(|_| LIMIT))
                .transpose()?;
            if total.is_some_and(|n| n > MAX_ROWS) {
                return Err(LIMIT);
            }
            if offset > 0 && total != expected {
                return Err("hindsight_refresh_changed_during_scan");
            }
            expected = total;
            observed = observed
                .checked_add(items.len())
                .filter(|v| *v <= MAX_ROWS)
                .ok_or(LIMIT)?;
            for item in items {
                let id = text(item.get("id").and_then(Value::as_str).ok_or(INVALID)?, 256)?;
                if !seen.insert(id) {
                    return Err("hindsight_refresh_repeated_page");
                }
                if let Some(row) = normalize(item, &bank, now)? {
                    rows.push(row);
                }
            }
            offset += items.len();
            if let Some(total) = total {
                if offset > total || (items.len() < PAGE_SIZE && offset != total) {
                    return Err(INVALID);
                }
                if offset == total {
                    break;
                }
            } else if items.len() < PAGE_SIZE {
                break;
            }
        }
    }
    Ok(rows)
}
fn merge(previous: Option<&[u8]>, rows: Vec<Row>) -> Result<Vec<u8>> {
    let mut merged = BTreeMap::new();
    if let Some(bytes) = previous {
        if bytes.len() > MAX_BYTES {
            return Err(LIMIT);
        }
        for line in bytes.split(|b| *b == b'\n').filter(|s| !s.is_empty()) {
            if line.len() > 4096 || merged.len() >= MAX_ROWS {
                return Err(LIMIT);
            }
            let row: Row =
                serde_json::from_slice(line).map_err(|_| "hindsight_refresh_cache_invalid")?;
            if !valid_cached(&row) || merged.insert(row.id.clone(), row).is_some() {
                return Err("hindsight_refresh_cache_invalid");
            }
        }
    }
    for row in rows {
        if let Some(old) = merged.get(&row.id) {
            if old != &row {
                return Err("hindsight_refresh_record_changed");
            }
        } else {
            if merged.len() >= MAX_ROWS {
                return Err(LIMIT);
            }
            merged.insert(row.id.clone(), row);
        }
    }
    let mut output = Vec::new();
    for row in merged.values() {
        let bytes = serde_json::to_vec(row).map_err(|_| INVALID)?;
        if output.len() + bytes.len() + 1 > MAX_BYTES {
            return Err(LIMIT);
        }
        output.extend_from_slice(&bytes);
        output.push(b'\n');
    }
    // A genuinely empty service is valid, but creates no parser-discoverable
    // ledger until the first observation. Existing history remains byte-stable.
    Ok(output)
}
fn valid_cached(row: &Row) -> bool {
    let hex = |v: &str| {
        v.len() == 64
            && v.bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    };
    hex(&row.id)
        && hex(&row.bank)
        && text(&row.provider, 256).is_ok()
        && text(&row.model, 256).is_ok()
        && row.total_tokens > 0
        && row.input_tokens <= 1_000_000_000_000_000
        && row.output_tokens <= 1_000_000_000_000_000
        && valid_totals(
            row.input_tokens,
            row.output_tokens,
            row.cached_tokens,
            row.total_tokens,
        )
        && row.duration_ms.is_none_or(|n| n <= 366 * 86_400_000)
        && row.started_at.len() <= 128
        && time::OffsetDateTime::parse(
            &row.started_at,
            &time::format_description::well_known::Rfc3339,
        )
        .is_ok_and(|v| v.unix_timestamp() > 0)
}
fn valid_totals(input: u64, output: u64, cached: Option<u64>, total: u64) -> bool {
    let cache = cached.unwrap_or(0);
    cache <= 1_000_000_000_000_000
        && (input.checked_add(output) == Some(total) && cache <= input
            || input.checked_add(output).and_then(|v| v.checked_add(cache)) == Some(total))
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    schema_version: u8,
    client: String,
    endpoint_scope: String,
}
#[cfg(unix)]
fn refresh(
    cache: &super::disk::Cache,
    endpoint: &Endpoint,
    credential: &Credential,
    transport: &mut impl Transport,
    now: u64,
) -> Result<usize> {
    cache.require_entries(&["refresh.lock", "profile.json", "usage.jsonl"])?;
    let binding = Binding {
        schema_version: 1,
        client: "hindsight".to_owned(),
        endpoint_scope: credential.scope.clone(),
    };
    if let Some(bytes) = cache.read("profile.json", 4096)? {
        if serde_json::from_slice::<Binding>(&bytes)
            .map_err(|_| "hindsight_refresh_profile_invalid")?
            != binding
        {
            return Err("hindsight_refresh_profile_mismatch");
        }
    } else {
        cache.create_binding(&serde_json::to_vec(&binding).map_err(|_| INVALID)?)?;
    }
    let previous = cache.read("usage.jsonl", MAX_BYTES)?;
    let incoming = fetch(transport, endpoint, credential, now)?;
    let count = incoming.len();
    let merged = merge(previous.as_deref(), incoming)?;
    if !merged.is_empty() && previous.as_deref() != Some(&merged) {
        cache.replace("usage.jsonl", &merged)?;
    }
    Ok(count)
}
pub(super) fn run(args: &[String]) -> Result<String> {
    if args.len() == 2 && args[1] == "--help" {
        return Ok(HELP.to_owned());
    }
    let (mut directory, mut api, mut tenant, mut token, mut allow_http) =
        (None, None, None, None, false);
    let mut index = 1;
    while index < args.len() {
        let flag = &args[index];
        index += 1;
        if flag == "--allow-loopback-http" && !allow_http {
            allow_http = true;
            continue;
        }
        let value = args
            .get(index)
            .filter(|v| !v.is_empty() && !v.starts_with("--"))
            .ok_or("missing_option_value")?;
        match flag.as_str() {
            "--cache-dir" if directory.is_none() => directory = Some(PathBuf::from(value)),
            "--api" if api.is_none() => api = Some(value.clone()),
            "--tenant" if tenant.is_none() => tenant = Some(value.clone()),
            "--token-file" if token.is_none() => token = Some(PathBuf::from(value)),
            _ => return Err("invalid_option"),
        }
        index += 1;
    }
    let directory = directory.ok_or("hindsight_refresh_cache_required")?;
    let endpoint = Endpoint::new(
        &api.ok_or("hindsight_refresh_endpoint_required")?,
        &tenant.ok_or("hindsight_refresh_tenant_required")?,
        allow_http,
    )?;
    #[cfg(unix)]
    {
        let raw = token
            .map(|path| super::disk::read_secret(&path))
            .transpose()?;
        let credential = credential(raw.as_deref(), &endpoint)?;
        let cache = super::disk::Cache::open(&directory)?;
        let count = refresh(
            &cache,
            &endpoint,
            &credential,
            &mut Http,
            crate::stats::now_ms()?,
        )?;
        Ok(format!("{{\"schemaVersion\":1,\"client\":\"hindsight\",\"status\":\"refreshed\",\"observations\":{count}}}"))
    }
    #[cfg(not(unix))]
    {
        let _ = (directory, endpoint, token);
        Err("source_refresh_requires_unix")
    }
}

#[cfg(test)]
mod tests;
