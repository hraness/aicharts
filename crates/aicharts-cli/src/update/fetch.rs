//! Bounded HTTPS GET for `aicharts update`.
//!
//! One request, at most one redirect, no retries. Redirects may only name an
//! absolute `https://` URL on `github.com`, `api.github.com`, or a
//! `githubusercontent.com` host owned by the release pipeline; the Location
//! value is length-capped and cannot carry credentials. Chunked and
//! close-delimited bodies are read to EOF under the byte cap; a declared
//! Content-Length must match exactly. Connections close without draining
//! rejected bodies.

use crate::transport_dns::UsageResolver;
use std::io::Read;
use std::time::Duration;
use ureq::config::Config;
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use ureq::unversioned::transport::DefaultConnector;
use ureq::Agent;

const _: () = assert!(matches!(log::STATIC_MAX_LEVEL, log::LevelFilter::Off));

const TOTAL: Duration = Duration::from_secs(120);
const RESOLVE: Duration = Duration::from_secs(5);
const CONNECT: Duration = Duration::from_secs(10);
const BODY: Duration = Duration::from_secs(60);
const HEADER_BYTES: usize = 16 * 1024;
const HEADER_COUNT: usize = 64;
const IO_BYTES: usize = 16 * 1024;
const LOCATION_BYTES: usize = 4 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FetchError {
    InvalidUrl,
    Redirect,
    Unavailable,
    InvalidResponse,
    TooLarge,
}

/// Hosts an update request may start on, and where a single redirect may land.
fn host_allowed(url: &str, initial: bool) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() || host.len() > 253 || host.contains(['@', ':', '\\']) {
        return false;
    }
    if initial {
        matches!(host, "api.github.com" | "github.com")
    } else {
        matches!(
            host,
            "github.com"
                | "api.github.com"
                | "objects.githubusercontent.com"
                | "release-assets.githubusercontent.com"
        )
    }
}

fn configuration(remaining: Duration) -> Config {
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
        .timeout_recv_response(Some(remaining.min(BODY)))
        .timeout_recv_body(Some(BODY.min(remaining)))
        .tls_config(
            TlsConfig::builder()
                .provider(TlsProvider::Rustls)
                .root_certs(RootCerts::WebPki)
                .use_sni(true)
                .build(),
        )
        .build()
}

/// GET `url` into memory, following at most one validated redirect.
/// `cap` is the maximum accepted body size in bytes.
pub(crate) fn get(url: &str, cap: usize) -> Result<Vec<u8>, FetchError> {
    if !host_allowed(url, true) {
        return Err(FetchError::InvalidUrl);
    }
    let agent = Agent::with_parts(
        configuration(TOTAL),
        DefaultConnector::default(),
        UsageResolver,
    );
    get_once(&agent, url, cap, true)
}

fn get_once(
    agent: &Agent,
    url: &str,
    cap: usize,
    redirect_ok: bool,
) -> Result<Vec<u8>, FetchError> {
    let mut response = agent
        .get(url)
        .header("Accept", "*/*")
        .header("Connection", "close")
        .call()
        .map_err(|_| FetchError::Unavailable)?;
    let status = response.status().as_u16();
    if matches!(status, 301 | 302 | 303 | 307 | 308) {
        if !redirect_ok {
            return Err(FetchError::Redirect);
        }
        if response.headers().iter().count() > HEADER_COUNT {
            return Err(FetchError::InvalidResponse);
        }
        let mut values = response.headers().get_all("location").iter();
        let location = values
            .next()
            .and_then(|v| v.to_str().ok().map(str::to_owned));
        if values.next().is_some() {
            return Err(FetchError::InvalidResponse);
        }
        let Some(location) = location else {
            return Err(FetchError::InvalidResponse);
        };
        drop(response);
        if location.len() > LOCATION_BYTES || !host_allowed(&location, false) {
            return Err(FetchError::Redirect);
        }
        return get_once(agent, &location, cap, false);
    }
    if status != 200 {
        return Err(match status {
            403 | 404 | 410 | 451 => FetchError::InvalidResponse,
            _ => FetchError::Unavailable,
        });
    }
    if response.headers().iter().count() > HEADER_COUNT {
        return Err(FetchError::InvalidResponse);
    }
    let declared = content_length(&response)?;
    if let Some(length) = declared {
        if length > cap {
            return Err(FetchError::TooLarge);
        }
    }
    let mut reader = response
        .body_mut()
        .with_config()
        .limit(cap as u64 + 1)
        .reader();
    let mut body = Vec::with_capacity(declared.unwrap_or(0).min(cap));
    let mut buffer = [0u8; 8192];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|_| FetchError::Unavailable)?;
        if count == 0 {
            break;
        }
        if count > cap - body.len() {
            return Err(FetchError::TooLarge);
        }
        body.extend_from_slice(&buffer[..count]);
    }
    if let Some(length) = declared {
        if body.len() != length {
            return Err(FetchError::InvalidResponse);
        }
    }
    Ok(body)
}

fn content_length(
    response: &ureq::http::Response<ureq::Body>,
) -> Result<Option<usize>, FetchError> {
    let mut values = response.headers().get_all("content-length").iter();
    let value = values.next().and_then(|v| v.to_str().ok());
    if values.next().is_some() {
        return Err(FetchError::InvalidResponse);
    }
    let Some(text) = value else {
        return Ok(None);
    };
    if text.is_empty() || text.len() > 12 || !text.bytes().all(|b| b.is_ascii_digit()) {
        return Err(FetchError::InvalidResponse);
    }
    text.parse::<usize>()
        .map(Some)
        .map_err(|_| FetchError::InvalidResponse)
}
