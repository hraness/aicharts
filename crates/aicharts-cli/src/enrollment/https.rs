//! Dormant, once-only terminal enrollment HTTPS. Construction remains sealed
//! inside the private coordinator; no product command or credential-custody
//! path can activate this adapter yet.
//!
//! Timeouts bound I/O and acceptance, not OS/TLS preemption. The shared resolver
//! may retain one blocked OS worker after timeout, holding its process-wide
//! permit until actual completion. No HTTP worker, redirect or retry is started.
//! Any failure after dispatch may follow a remote commit and grants no authority.
//!
//! Framing applies to the final HTTP message exposed by pinned ureq. It consumes
//! informational 1xx responses internally; Content-Length EOF is not socket EOF.
//! Chunked and close-delimited bodies are refused. Connections are closed without
//! draining rejected bodies or waiting for peer FIN, including on codec failure.

use super::contract::{self, Context, DomainResult, Request};
use crate::transport_dns::UsageResolver;
use std::io::Read;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use ureq::config::Config;
use ureq::http::{HeaderMap, HeaderValue, Version};
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use ureq::unversioned::transport::DefaultConnector;
use ureq::Agent;

// ureq-proto traces raw bodies; sensitive headers alone cannot protect secrets.
// Preserve Cargo's process-wide compile-time logging suppression in all profiles.
const _: () = assert!(matches!(log::STATIC_MAX_LEVEL, log::LevelFilter::Off));
const REQUEST_MEDIA: &str = "application/json";
const TOTAL: Duration = Duration::from_secs(20);
const RESOLVE: Duration = Duration::from_secs(3);
const CONNECT: Duration = Duration::from_secs(5);
const HEADERS: Duration = Duration::from_secs(15);
const BODY: Duration = Duration::from_secs(5);
const HEADER_BYTES: usize = 16 * 1024;
const HEADER_COUNT: usize = 64;
const IO_BYTES: usize = 8 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TransportError {
    InvalidRequest,
    ClockInvalid,
    Unavailable,
    Uncertain,
    InvalidResponse,
}

// No Debug, Display, Clone, general serialization or production constructor.
pub(super) struct HttpsEnrollment {
    _construction: (),
    #[cfg(test)]
    fixture: Option<tests::ClientFixture>,
}

pub(super) struct AcceptedEnrollment {
    pub(super) observed_at_ms: u64,
    pub(super) result: DomainResult,
}

#[derive(Clone, Copy)]
struct Observation {
    wall_ms: u64,
    monotonic: Instant,
}

fn actual_observation() -> Result<Observation, TransportError> {
    let wall_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| u64::try_from(elapsed.as_millis()).ok())
        .filter(|now| *now <= contract::MAX_TIME_MS)
        .ok_or(TransportError::ClockInvalid)?;
    Ok(Observation {
        wall_ms,
        monotonic: Instant::now(),
    })
}

struct Attempt {
    start: Observation,
    last: Observation,
    end: Instant,
}

impl Attempt {
    fn new(start: Observation, retained_ms: u64, budget: Duration) -> Result<Self, TransportError> {
        if start.wall_ms > contract::MAX_TIME_MS || start.wall_ms < retained_ms {
            return Err(TransportError::ClockInvalid);
        }
        if budget.is_zero() {
            return Err(TransportError::Unavailable);
        }
        Ok(Self {
            start,
            last: start,
            end: start
                .monotonic
                .checked_add(budget)
                .ok_or(TransportError::ClockInvalid)?,
        })
    }

    fn check(&mut self, now: Observation) -> Result<Duration, TransportError> {
        if now.wall_ms > contract::MAX_TIME_MS
            || now.wall_ms < self.last.wall_ms
            || now.monotonic < self.last.monotonic
        {
            return Err(TransportError::ClockInvalid);
        }
        self.last = now;
        self.end
            .checked_duration_since(now.monotonic)
            .filter(|left| !left.is_zero())
            .ok_or(TransportError::Uncertain)
    }

    fn accept_before(&self, expires_ms: u64) -> Result<(), TransportError> {
        let before = expires_ms
            .checked_sub(self.start.wall_ms)
            .and_then(|left| {
                self.start
                    .monotonic
                    .checked_add(Duration::from_millis(left))
            })
            .ok_or(TransportError::InvalidResponse)?;
        if self.last.wall_ms >= expires_ms || self.last.monotonic >= before {
            return Err(TransportError::InvalidResponse);
        }
        Ok(())
    }
}

fn configuration(remaining: Duration, roots: RootCerts) -> Config {
    Agent::config_builder()
        .https_only(true)
        .proxy(None)
        .max_redirects(0)
        .http_status_as_error(false)
        .max_idle_connections(0)
        .max_idle_connections_per_host(0)
        .max_response_header_size(HEADER_BYTES)
        .input_buffer_size(IO_BYTES)
        .output_buffer_size(IO_BYTES)
        .timeout_global(Some(remaining))
        .timeout_resolve(Some(RESOLVE.min(remaining)))
        .timeout_connect(Some(CONNECT.min(remaining)))
        .timeout_send_request(Some(RESOLVE.min(remaining)))
        .timeout_send_body(Some(BODY.min(remaining)))
        .timeout_recv_response(Some(HEADERS.min(remaining)))
        .timeout_recv_body(Some(BODY.min(remaining)))
        .tls_config(
            TlsConfig::builder()
                .provider(TlsProvider::Rustls)
                .root_certs(roots)
                .use_sni(true)
                .build(),
        )
        .build()
}

impl HttpsEnrollment {
    /// Sealed construction for the private coordinator. No caller outside the
    /// dormant enrollment module can create a transport, and construction
    /// performs no network or credential operation.
    pub(super) fn sealed() -> Self {
        Self {
            _construction: (),
            #[cfg(test)]
            fixture: None,
        }
    }

    fn agent(&self, remaining: Duration) -> Agent {
        #[cfg(test)]
        if let Some(fixture) = &self.fixture {
            return fixture.agent(remaining);
        }
        Agent::with_parts(
            configuration(remaining, RootCerts::WebPki),
            DefaultConnector::default(),
            UsageResolver,
        )
    }

    fn url(&self) -> &str {
        #[cfg(test)]
        if let Some(fixture) = &self.fixture {
            return &fixture.url;
        }
        contract::URL
    }

    fn budget(&self) -> Duration {
        #[cfg(test)]
        if let Some(fixture) = &self.fixture {
            return fixture.budget;
        }
        TOTAL
    }

    fn observe(&self) -> Result<Observation, TransportError> {
        #[cfg(test)]
        if let Some(fixture) = &self.fixture {
            return fixture.observe();
        }
        actual_observation()
    }

    pub(super) fn exchange_once(
        &mut self,
        request: &Request,
        context: &Context,
    ) -> Result<AcceptedEnrollment, TransportError> {
        self.exchange_once_with_floor(request, context, context.now_ms)
    }

    /// Exchange using a fresh retained clock floor independent of the frozen
    /// request context timestamp. A rollback is rejected before agent creation
    /// (and therefore before DNS or any socket work); the floor is never
    /// clamped to the context timestamp.
    pub(super) fn exchange_once_with_floor(
        &mut self,
        request: &Request,
        context: &Context,
        clock_floor_ms: u64,
    ) -> Result<AcceptedEnrollment, TransportError> {
        // Invalid retained observations must never cause even DNS dispatch.
        if !contract::valid_context(request, context) {
            return Err(TransportError::InvalidRequest);
        }
        let mut attempt = Attempt::new(self.observe()?, clock_floor_ms, self.budget())?;
        let bytes =
            contract::encode_request(request).map_err(|_| TransportError::InvalidRequest)?;
        let agent = self.agent(attempt.check(self.observe()?)?);
        let response = self.response(&agent, bytes.as_bytes(), &mut attempt);
        // response() owns and drops its response on every path. A late cleanup
        // cannot turn received bytes into an accepted domain result.
        drop(agent);
        let cleanup = attempt.check(self.observe()?);
        let body = response?;
        cleanup?;
        let mut observed = context.clone();
        observed.now_ms = attempt.last.wall_ms;
        let result = contract::decode_response(&body, request, &observed)
            .map_err(|_| TransportError::InvalidResponse)?;
        attempt.check(self.observe()?)?;
        if result.is_ok() {
            // These successes convey current eligibility. Expired initialize,
            // reserve and enroll readbacks deliberately remain observational.
            if matches!(request, Request::Confirm { .. } | Request::Namespace(_)) {
                attempt.accept_before(
                    context
                        .initialized_expires_at_ms
                        .ok_or(TransportError::InvalidResponse)?,
                )?;
            }
            if matches!(request, Request::Namespace(_)) {
                attempt.accept_before(
                    context
                        .reservation
                        .as_ref()
                        .ok_or(TransportError::InvalidResponse)?
                        .expires_at_ms,
                )?;
            }
        }
        Ok(AcceptedEnrollment {
            observed_at_ms: attempt.last.wall_ms,
            result,
        })
    }

    fn response(
        &self,
        agent: &Agent,
        bytes: &[u8],
        attempt: &mut Attempt,
    ) -> Result<Vec<u8>, TransportError> {
        attempt.check(self.observe()?)?;
        let mut response = agent
            .post(self.url())
            .header("Content-Type", REQUEST_MEDIA)
            .header("Accept", REQUEST_MEDIA)
            .header("Content-Length", bytes.len().to_string())
            .header("Connection", "close")
            .send(bytes)
            .map_err(|_| TransportError::Uncertain)?;
        attempt.check(self.observe()?)?;
        match response.status().as_u16() {
            200 => (),
            503 => return Err(TransportError::Unavailable),
            _ => return Err(TransportError::InvalidResponse),
        }
        if response.version() != Version::HTTP_11 {
            return Err(TransportError::InvalidResponse);
        }
        let expected = framing(response.headers())?;
        // ureq's limit reader errors at zero before checking EOF. The sentinel
        // admits an exact maximum Content-Length while retaining our own ceiling.
        let mut reader = response
            .body_mut()
            .with_config()
            .limit((contract::MAX_RESPONSE_BYTES + 1) as u64)
            .reader();
        self.read_body(&mut reader, expected, attempt)
    }

    fn read_body(
        &self,
        reader: &mut impl Read,
        expected: usize,
        attempt: &mut Attempt,
    ) -> Result<Vec<u8>, TransportError> {
        if expected == 0 || expected > contract::MAX_RESPONSE_BYTES {
            return Err(TransportError::InvalidResponse);
        }
        let mut body = Vec::with_capacity(expected);
        let mut buffer = [0u8; 512];
        loop {
            attempt.check(self.observe()?)?;
            let count = reader
                .read(&mut buffer)
                .map_err(|_| TransportError::Uncertain)?;
            attempt.check(self.observe()?)?;
            if count == 0 {
                break;
            }
            if count > expected - body.len() {
                return Err(TransportError::InvalidResponse);
            }
            body.extend_from_slice(&buffer[..count]);
        }
        if body.len() != expected {
            return Err(TransportError::InvalidResponse);
        }
        Ok(body)
    }
}

fn single<'a>(headers: &'a HeaderMap, name: &str) -> Result<Option<&'a [u8]>, TransportError> {
    let mut values = headers.get_all(name).iter();
    let value = values.next().map(HeaderValue::as_bytes);
    if values.next().is_some() {
        return Err(TransportError::InvalidResponse);
    }
    Ok(value)
}

fn framing(headers: &HeaderMap) -> Result<usize, TransportError> {
    if headers.iter().count() > HEADER_COUNT
        || single(headers, "content-type")? != Some(contract::MEDIA.as_bytes())
        || [
            "content-encoding",
            "transfer-encoding",
            "location",
            "set-cookie",
            "trailer",
            "upgrade",
        ]
        .iter()
        .any(|name| headers.contains_key(*name))
    {
        return Err(TransportError::InvalidResponse);
    }
    let length = single(headers, "content-length")?.ok_or(TransportError::InvalidResponse)?;
    if length.is_empty()
        || length.len() > 4
        || length[0] == b'0'
        || !length.iter().all(u8::is_ascii_digit)
    {
        return Err(TransportError::InvalidResponse);
    }
    let count = length
        .iter()
        .fold(0usize, |value, byte| value * 10 + (byte - b'0') as usize);
    if count > contract::MAX_RESPONSE_BYTES {
        return Err(TransportError::InvalidResponse);
    }
    Ok(count)
}

#[cfg(test)]
#[path = "https_tests.rs"]
mod tests;
