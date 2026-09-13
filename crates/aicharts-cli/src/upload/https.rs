//! Dormant HTTPS receipt custody. There is deliberately no production constructor:
//! parsing a token or a binding cannot attest enrollment. A later reviewed custody
//! join must own construction before any product command can use this adapter.
//!
//! ureq is pinned because its resolver API is unversioned. Timeouts are bounded
//! I/O budgets plus a monotonic acceptance deadline, not thread/OS preemption:
//! system DNS may remain blocked, write_all/TLS can outlive a socket timeout, and
//! TCP address attempts have a minimum timeout. No HTTP work is detached or retried.
//! Success requires one exact Content-Length. ureq tolerates incomplete chunked
//! terminators, so chunked and close-delimited replies are deliberately refused.

use super::{
    trusted, wire, AuthenticatedTransport, JournalBody, SenderBinding, TransportError,
    UploadRequest,
};
use std::io::{self, Read};
use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use ureq::config::Config;
use ureq::http::{HeaderMap, HeaderValue, Uri};
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use ureq::unversioned::resolver::{ResolvedSocketAddrs, Resolver};
use ureq::unversioned::transport::{DefaultConnector, NextTimeout};
use ureq::Agent;

const URL: &str = "https://usage.aicharts.io/v1/batches";
const HOST: &str = "usage.aicharts.io";
const BATCH_MEDIA: &str = "application/vnd.aicharts.usage-batch-v1";
const JOURNAL_MEDIA: &str = "application/vnd.aicharts.usage-journal-v1";
const TOTAL: Duration = Duration::from_secs(20);
const RESOLVE: Duration = Duration::from_secs(3);
const CONNECT: Duration = Duration::from_secs(5);
const HEADERS: Duration = Duration::from_secs(15);
const BODY: Duration = Duration::from_secs(5);
const HEADER_BYTES: usize = 16 * 1024;
const HEADER_COUNT: usize = 64;
const IO_BYTES: usize = 8 * 1024;
const ADDRESS_COUNT: usize = 16;

// Independent adapter instances must not accumulate timed-out OS resolver work.
static DNS_BUSY: AtomicBool = AtomicBool::new(false);

struct DnsPermit(&'static AtomicBool);

impl Drop for DnsPermit {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

struct Lookup {
    result: mpsc::Receiver<io::Result<ResolvedSocketAddrs>>,
    worker: thread::JoinHandle<()>,
}

fn start_lookup(
    busy: &'static AtomicBool,
    lookup: impl FnOnce() -> io::Result<ResolvedSocketAddrs> + Send + 'static,
) -> io::Result<Lookup> {
    busy.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .map_err(|_| io::Error::from(io::ErrorKind::WouldBlock))?;
    let permit = DnsPermit(busy);
    let (send, result) = mpsc::sync_channel(1);
    let worker = thread::Builder::new()
        .name("aicharts-upload-dns".into())
        .spawn(move || {
            let _permit = permit;
            let _ = send.send(lookup());
        })?;
    Ok(Lookup { result, worker })
}

#[derive(Debug)]
struct BoundedResolver;

fn bounded_addresses(
    addresses: impl Iterator<Item = SocketAddr>,
) -> io::Result<ResolvedSocketAddrs> {
    let mut addrs = BoundedResolver.empty();
    for addr in addresses.take(ADDRESS_COUNT) {
        addrs.push(addr);
    }
    if addrs.is_empty() {
        return Err(io::Error::from(io::ErrorKind::NotFound));
    }
    Ok(addrs)
}

impl Resolver for BoundedResolver {
    fn resolve(
        &self,
        uri: &Uri,
        _: &Config,
        timeout: NextTimeout,
    ) -> Result<ResolvedSocketAddrs, ureq::Error> {
        if uri.scheme_str() != Some("https")
            || uri.host() != Some(HOST)
            || uri.port_u16().unwrap_or(443) != 443
        {
            return Err(io::Error::from(io::ErrorKind::InvalidInput).into());
        }
        let budget = (*timeout.after).min(RESOLVE);
        if budget.is_zero() {
            return Err(ureq::Error::Timeout(timeout.reason));
        }
        let pending = start_lookup(&DNS_BUSY, || {
            // The OS resolver receives only this literal public hostname. It has
            // no token, binding, request bytes or HTTP callback to run after timeout.
            bounded_addresses((HOST, 443).to_socket_addrs()?)
        })?;
        match pending.result.recv_timeout(budget) {
            Ok(result) => {
                // The result is available only after lookup returns. Join this
                // completed work before permitting an ordinary successful return.
                pending
                    .worker
                    .join()
                    .map_err(|_| io::Error::other("upload_dns_failed"))?;
                result.map_err(Into::into)
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Dropping the handle does not cancel DNS. The worker still owns
                // the global permit until actual completion; no retry is queued.
                Err(ureq::Error::Timeout(timeout.reason))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = pending.worker.join();
                Err(io::Error::other("upload_dns_failed").into())
            }
        }
    }
}

struct Deadline {
    end: Instant,
}

impl Deadline {
    fn new(budget: Duration) -> Result<Self, TransportError> {
        Ok(Self {
            end: Instant::now()
                .checked_add(budget)
                .ok_or(TransportError::Unavailable)?,
        })
    }

    fn remaining(&self) -> Result<Duration, TransportError> {
        self.end
            .checked_duration_since(Instant::now())
            .filter(|left| !left.is_zero())
            .ok_or(TransportError::Uncertain)
    }
}

// Neither Debug/Clone nor a public arbitrary-token constructor is provided.
struct HttpsTransport {
    binding: SenderBinding,
    bearer: HeaderValue,
    #[cfg(test)]
    fixture: Option<tests::ClientFixture>,
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

impl HttpsTransport {
    fn agent(&self, remaining: Duration) -> Agent {
        #[cfg(test)]
        if let Some(fixture) = &self.fixture {
            return fixture.agent(remaining);
        }
        Agent::with_parts(
            configuration(remaining, RootCerts::WebPki),
            DefaultConnector::default(),
            BoundedResolver,
        )
    }

    fn url(&self) -> &str {
        #[cfg(test)]
        if let Some(fixture) = &self.fixture {
            return &fixture.url;
        }
        URL
    }

    fn budget(&self) -> Duration {
        #[cfg(test)]
        if let Some(fixture) = &self.fixture {
            return fixture.budget;
        }
        TOTAL
    }
}

impl trusted::Sealed for HttpsTransport {}

impl AuthenticatedTransport for HttpsTransport {
    fn binding(&self) -> SenderBinding {
        self.binding
    }

    fn exchange(
        &mut self,
        request: &UploadRequest,
        journal: &mut JournalBody,
    ) -> Result<(), TransportError> {
        let deadline = Deadline::new(self.budget())?;
        if request.binding() != self.binding {
            return Err(TransportError::Blocked);
        }
        if request.canonical_batch().is_empty()
            || request.canonical_batch().len() > wire::MAX_BATCH_BYTES
            || journal.refused
            || !journal.bytes.is_empty()
        {
            return Err(TransportError::InvalidResponse);
        }
        let agent = self.agent(deadline.remaining()?);
        deadline.remaining()?;
        self.bearer.set_sensitive(true);
        let mut response = agent
            .post(self.url())
            .header("Content-Type", BATCH_MEDIA)
            .header("Accept", JOURNAL_MEDIA)
            .header("Authorization", self.bearer.clone())
            .header("Connection", "close")
            .send(request.canonical_batch())
            // Any failure here might follow a remote commit. Neither an HTTP
            // status nor a transport error changes the frozen ledger flight.
            .map_err(|_| TransportError::Uncertain)?;
        deadline.remaining()?;
        match response.status().as_u16() {
            200 => (),
            401 => return Err(TransportError::Unauthorized),
            409 => return Err(TransportError::Blocked),
            503 => return Err(TransportError::Unavailable),
            _ => return Err(TransportError::InvalidResponse),
        }
        let expected = framing(response.headers())?;
        {
            // ureq's limit reader errors at exactly zero remaining before it
            // tests EOF. Reserve a sentinel byte so a valid maximum body passes.
            let mut reader = response
                .body_mut()
                .with_config()
                .limit((wire::MAX_JOURNAL_BYTES + 1) as u64)
                .reader();
            read_journal(&mut reader, journal, expected, &deadline)?;
        }
        // EOF above is the Content-Length message boundary, not peer socket EOF.
        // Request close + zero idle capacity prevents connection reuse. Rejections
        // drop the connection, never drain an arbitrary body or wait for peer FIN.
        drop(response);
        drop(agent);
        deadline.remaining()?;
        Ok(())
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
        || single(headers, "content-type")? != Some(JOURNAL_MEDIA.as_bytes())
        || [
            "content-encoding",
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
    match (
        single(headers, "content-length")?,
        single(headers, "transfer-encoding")?,
    ) {
        (Some(length), None)
            if !length.is_empty()
                && length.len() <= 5
                && length[0] != b'0'
                && length.iter().all(u8::is_ascii_digit) =>
        {
            let count = length
                .iter()
                .fold(0usize, |value, byte| value * 10 + (byte - b'0') as usize);
            if count > wire::MAX_JOURNAL_BYTES {
                return Err(TransportError::InvalidResponse);
            }
            Ok(count)
        }
        _ => Err(TransportError::InvalidResponse),
    }
}

fn read_journal(
    reader: &mut impl Read,
    journal: &mut JournalBody,
    expected: usize,
    deadline: &Deadline,
) -> Result<(), TransportError> {
    let mut buffer = [0u8; 4096];
    loop {
        deadline.remaining()?;
        let count = reader
            .read(&mut buffer)
            .map_err(|_| TransportError::InvalidResponse)?;
        deadline.remaining()?;
        if count == 0 {
            break;
        }
        journal.append(&buffer[..count])?;
    }
    if journal.bytes.is_empty() || expected != journal.bytes.len() {
        return Err(TransportError::InvalidResponse);
    }
    Ok(())
}

#[cfg(test)]
#[path = "https_tests.rs"]
mod tests;
