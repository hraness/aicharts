//! Fixed-service, no-redirect/no-proxy JSON transport. No retry or credential
//! logging. Response framing is intentionally as strict as the v1 transport.
use super::{AbandonRequest, Abandonment, Receipt, Status, StatusRequest, Upload};
use crate::transport_dns::UsageResolver;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use std::{
    io::Read,
    time::{Duration, Instant},
};
use ureq::{
    config::Config,
    http::{HeaderMap, HeaderValue},
    tls::{RootCerts, TlsConfig, TlsProvider},
    unversioned::transport::DefaultConnector,
    Agent,
};
const STATUS: &str = "https://usage.aicharts.io/v2/snapshots/status";
const UPLOAD: &str = "https://usage.aicharts.io/v2/snapshots";
const ABANDON: &str = "https://usage.aicharts.io/v2/snapshots/abandon";
const TOTALS: &str = "https://usage.aicharts.io/v2/snapshots/totals";
const CAP: usize = 2048;
/// The totals reply enumerates every device and client on the account, so it
/// carries the contract's 256 KiB bound instead of the fixed 2 KiB receipts.
const TOTALS_CAP: usize = 256 * 1024;
const UNAVAILABLE: &str = "stats_sync_exchange_uncertain";
const INVALID: &str = "stats_sync_invalid_response";
const TOTAL: Duration = Duration::from_secs(45);
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope<T> {
    schema_version: u8,
    result: ResultDto<T>,
}
#[derive(Deserialize)]
#[serde(untagged)]
enum ResultDto<T> {
    Success(Success<T>),
    Failure(Failure),
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Success<T> {
    ok: bool,
    value: T,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Failure {
    ok: bool,
    error: String,
}
fn result<T: DeserializeOwned>(status: u16, bytes: &[u8]) -> Result<T, &'static str> {
    let reply: Envelope<T> = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    if reply.schema_version != 2 {
        return Err(INVALID);
    }
    match reply.result {
        ResultDto::Success(value) if value.ok && status == 200 => Ok(value.value),
        ResultDto::Failure(value) if !value.ok && status != 200 => {
            Err(match value.error.as_str() {
                "unauthorized" => "stats_sync_unauthorized",
                "not_enrolled" => "stats_sync_not_enrolled",
                "revoked" => "stats_sync_revoked",
                "conflict" => "stats_sync_conflict",
                "takeover_required" => "stats_sync_legacy_takeover_required",
                "writer_conflict" => "stats_sync_writer_conflict",
                "replacement_required" => "stats_sync_replacement_required",
                "limit" => "stats_sync_limit",
                "recovery_required" => "stats_sync_recovery_required",
                "clock_regressed" => "stats_sync_clock_regressed",
                "storage_invalid" => "stats_sync_storage_invalid",
                "storage_unavailable" => UNAVAILABLE,
                "invalid_input" => "stats_sync_request_refused",
                "expired" => "stats_sync_expired",
                "profile_superseded" => "stats_sync_profile_superseded",
                "not_started" => "stats_sync_not_started",
                _ => INVALID,
            })
        }
        _ => Err(INVALID),
    }
}
fn config(roots: RootCerts) -> Config {
    Agent::config_builder()
        .https_only(true)
        .proxy(None)
        .max_redirects(0)
        .http_status_as_error(false)
        .max_idle_connections(0)
        .max_idle_connections_per_host(0)
        .max_response_header_size(16 * 1024)
        .input_buffer_size(8192)
        .output_buffer_size(8192)
        .timeout_global(Some(TOTAL))
        .timeout_resolve(Some(Duration::from_secs(3)))
        .timeout_connect(Some(Duration::from_secs(5)))
        .timeout_send_request(Some(Duration::from_secs(3)))
        .timeout_send_body(Some(Duration::from_secs(5)))
        .timeout_recv_response(Some(Duration::from_secs(40)))
        .timeout_recv_body(Some(Duration::from_secs(5)))
        .tls_config(
            TlsConfig::builder()
                .provider(TlsProvider::Rustls)
                .root_certs(roots)
                .use_sni(true)
                .build(),
        )
        .build()
}
fn single<'a>(headers: &'a HeaderMap, name: &str) -> Result<Option<&'a [u8]>, &'static str> {
    let mut values = headers.get_all(name).iter();
    let first = values.next().map(HeaderValue::as_bytes);
    if values.next().is_some() {
        return Err(INVALID);
    }
    Ok(first)
}
fn framing(headers: &HeaderMap, digits: usize, cap: usize) -> Result<usize, &'static str> {
    if headers.iter().count() > 64
        || single(headers, "content-type")? != Some(b"application/json; charset=utf-8")
        || [
            "transfer-encoding",
            "content-encoding",
            "location",
            "set-cookie",
            "trailer",
            "upgrade",
        ]
        .iter()
        .any(|name| headers.contains_key(*name))
    {
        return Err(INVALID);
    }
    let bytes = single(headers, "content-length")?.ok_or(INVALID)?;
    if bytes.is_empty()
        || bytes.len() > digits
        || bytes[0] == b'0'
        || !bytes.iter().all(u8::is_ascii_digit)
    {
        return Err(INVALID);
    }
    let length = bytes
        .iter()
        .fold(0usize, |v, b| v * 10 + (b - b'0') as usize);
    if length > cap {
        return Err(INVALID);
    }
    Ok(length)
}
pub(super) struct Transport {
    bearer: HeaderValue,
}
impl Transport {
    pub(super) fn new(secret: &[u8; 32]) -> Result<Self, &'static str> {
        if secret == &[0; 32] {
            return Err("attempt_custody");
        }
        let mut bearer = HeaderValue::from_str(&format!("Bearer {}", super::hex(secret)))
            .map_err(|_| "attempt_custody")?;
        bearer.set_sensitive(true);
        Ok(Self { bearer })
    }
    fn exchange<T: DeserializeOwned>(
        &mut self,
        url: &'static str,
        bytes: &[u8],
    ) -> Result<T, &'static str> {
        self.exchange_bounded(url, bytes, 4, CAP)
    }
    fn exchange_bounded<T: DeserializeOwned>(
        &mut self,
        url: &'static str,
        bytes: &[u8],
        digits: usize,
        cap: usize,
    ) -> Result<T, &'static str> {
        let agent = Agent::with_parts(
            config(RootCerts::WebPki),
            DefaultConnector::default(),
            UsageResolver,
        );
        self.exchange_with_agent(agent, url, bytes, digits, cap)
    }
    fn exchange_with_agent<T: DeserializeOwned>(
        &mut self,
        agent: Agent,
        url: &str,
        bytes: &[u8],
        digits: usize,
        cap: usize,
    ) -> Result<T, &'static str> {
        let started = Instant::now();
        let mut response = agent
            .post(url)
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .header("authorization", self.bearer.clone())
            .header("connection", "close")
            .send(bytes)
            .map_err(|_| UNAVAILABLE)?;
        if started.elapsed() >= TOTAL {
            return Err(UNAVAILABLE);
        }
        let status = response.status().as_u16();
        if ![200, 400, 401, 409, 503].contains(&status) {
            return Err(INVALID);
        }
        let expected = framing(response.headers(), digits, cap)?;
        let mut body = Vec::with_capacity(expected);
        response
            .body_mut()
            .with_config()
            .limit((cap + 1) as u64)
            .reader()
            .read_to_end(&mut body)
            .map_err(|_| INVALID)?;
        if started.elapsed() >= TOTAL {
            return Err(UNAVAILABLE);
        }
        if body.len() != expected {
            return Err(INVALID);
        }
        result(status, &body)
    }
    pub(super) fn status(&mut self, request: &StatusRequest<'_>) -> Result<Status, &'static str> {
        self.exchange(STATUS, &super::encoded(request)?)
    }
    pub(super) fn totals(
        &mut self,
        request: &super::totals::TotalsRequest<'_>,
    ) -> Result<super::totals::Totals, &'static str> {
        self.exchange_bounded(TOTALS, &super::encoded(request)?, 6, TOTALS_CAP)
    }
    pub(super) fn upload(&mut self, request: &Upload) -> Result<Receipt, &'static str> {
        request.validate()?;
        self.exchange(UPLOAD, &super::encoded(request)?)
    }
    pub(super) fn abandon(&mut self, request: &Upload) -> Result<Abandonment, &'static str> {
        request.validate()?;
        let request = AbandonRequest {
            schema_version: 2,
            operation_id: &request.operation_id,
            account_id: &request.account_id,
            device_id: &request.device_id,
            generation: &request.generation,
            sequence: request.sequence,
            expected_revision: request.expected_revision,
            body_hash: super::body_hash(request)?,
        };
        self.exchange(ABANDON, &super::encoded(&request)?)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn framing_refuses_ambiguous_or_redirecting_reply() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "content-type",
            HeaderValue::from_static("application/json; charset=utf-8"),
        );
        headers.insert("content-length", HeaderValue::from_static("128"));
        assert_eq!(framing(&headers, 4, CAP), Ok(128));
        for name in [
            "transfer-encoding",
            "content-encoding",
            "location",
            "set-cookie",
            "trailer",
            "upgrade",
        ] {
            let mut changed = headers.clone();
            changed.insert(name, HeaderValue::from_static("x"));
            assert!(framing(&changed, 4, CAP).is_err());
        }
        headers.append("content-length", HeaderValue::from_static("128"));
        assert!(framing(&headers, 4, CAP).is_err());
    }
    #[test]
    fn failure_dto_is_exact_and_never_exposes_server_strings() {
        assert_eq!(
            result::<Status>(
                409,
                br#"{"schemaVersion":2,"result":{"ok":false,"error":"writer_conflict"}}"#
            )
            .unwrap_err(),
            "stats_sync_writer_conflict"
        );
        assert_eq!(
            result::<Status>(
                503,
                br#"{"schemaVersion":2,"result":{"ok":false,"error":"PRIVATE_CANARY"}}"#
            )
            .unwrap_err(),
            INVALID
        );
        assert_eq!(
            result::<Status>(
                200,
                br#"{"schemaVersion":2,"result":{"ok":false,"error":"conflict"}}"#
            )
            .unwrap_err(),
            INVALID
        );
    }
}

#[cfg(test)]
mod tls_tests;
