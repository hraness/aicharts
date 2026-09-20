//! One process-wide, fixed-service DNS owner shared by dormant HTTPS adapters.
//! A timed-out caller cannot release the OS worker's permit or schedule a retry.

use std::io;
use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use ureq::config::Config;
use ureq::http::Uri;
use ureq::unversioned::resolver::{ResolvedSocketAddrs, Resolver};
use ureq::unversioned::transport::NextTimeout;

const HOST: &str = "usage.aicharts.io";
const RESOLVE: Duration = Duration::from_secs(3);
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
pub(super) struct UsageResolver;

/// A source refresh pins the exact explicitly selected authority before reading
/// credentials. HTTPS may target a configured service; cleartext is restricted
/// to literal loopback addresses for a local service.
#[derive(Clone, Debug)]
pub(super) struct SourceResolver {
    scheme: &'static str,
    host: Arc<str>,
    port: u16,
}

impl SourceResolver {
    pub(super) fn https(host: &str, port: u16) -> io::Result<Self> {
        let plain = host
            .strip_prefix('[')
            .and_then(|s| s.strip_suffix(']'))
            .unwrap_or(host);
        let literal = plain.parse::<std::net::IpAddr>().is_ok();
        let dns = !host.is_empty()
            && host.len() <= 253
            && host.split('.').all(|label| {
                !label.is_empty()
                    && label.len() <= 63
                    && label
                        .as_bytes()
                        .first()
                        .is_some_and(u8::is_ascii_alphanumeric)
                    && label
                        .as_bytes()
                        .last()
                        .is_some_and(u8::is_ascii_alphanumeric)
                    && label
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            });
        if port == 0 || (!literal && !dns) {
            return Err(io::Error::from(io::ErrorKind::InvalidInput));
        }
        Ok(Self {
            scheme: "https",
            host: Arc::from(plain),
            port,
        })
    }

    pub(super) fn loopback_http(host: &str, port: u16) -> io::Result<Self> {
        let mut resolver = Self::https(host, port)?;
        if !resolver
            .host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback())
        {
            return Err(io::Error::from(io::ErrorKind::InvalidInput));
        }
        resolver.scheme = "http";
        Ok(resolver)
    }
}

fn bounded_addresses(
    addresses: impl Iterator<Item = SocketAddr>,
) -> io::Result<ResolvedSocketAddrs> {
    let mut addrs = UsageResolver.empty();
    for addr in addresses.take(ADDRESS_COUNT) {
        addrs.push(addr);
    }
    if addrs.is_empty() {
        return Err(io::Error::from(io::ErrorKind::NotFound));
    }
    Ok(addrs)
}

impl Resolver for UsageResolver {
    fn resolve(
        &self,
        uri: &Uri,
        _: &Config,
        timeout: NextTimeout,
    ) -> Result<ResolvedSocketAddrs, ureq::Error> {
        resolve_authority(uri, timeout, "https", Arc::from(HOST), 443)
    }
}

impl Resolver for SourceResolver {
    fn resolve(
        &self,
        uri: &Uri,
        _: &Config,
        timeout: NextTimeout,
    ) -> Result<ResolvedSocketAddrs, ureq::Error> {
        resolve_authority(uri, timeout, self.scheme, self.host.clone(), self.port)
    }
}

fn resolve_authority(
    uri: &Uri,
    timeout: NextTimeout,
    scheme: &'static str,
    host: Arc<str>,
    port: u16,
) -> Result<ResolvedSocketAddrs, ureq::Error> {
    let uri_host = uri.host().map(|v| {
        v.strip_prefix('[')
            .and_then(|s| s.strip_suffix(']'))
            .unwrap_or(v)
    });
    if uri.scheme_str() != Some(scheme)
        || uri_host != Some(host.as_ref())
        || uri
            .port_u16()
            .unwrap_or(if scheme == "https" { 443 } else { 80 })
            != port
    {
        return Err(io::Error::from(io::ErrorKind::InvalidInput).into());
    }
    let budget = (*timeout.after).min(RESOLVE);
    if budget.is_zero() {
        return Err(ureq::Error::Timeout(timeout.reason));
    }
    let pending = start_lookup(&DNS_BUSY, move || {
        // The OS resolver receives only the pinned hostname and port. It has
        // no token, binding, request bytes or HTTP callback to run after timeout.
        bounded_addresses((host.as_ref(), port).to_socket_addrs()?)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn source_resolver_pins_authority_and_cleartext_is_literal_loopback_only() {
        let resolver = SourceResolver::https("cursor.com", 443).unwrap();
        let config = ureq::Agent::config_builder().build();
        let timeout = NextTimeout {
            after: Duration::ZERO.into(),
            reason: ureq::Timeout::Resolve,
        };
        for uri in [
            "http://cursor.com/api",
            "https://other.test/api",
            "https://cursor.com:444/api",
        ] {
            assert!(resolver
                .resolve(&uri.parse().unwrap(), &config, timeout)
                .is_err());
        }
        for host in ["", "cursor.com@evil.test", "bad/name", "-bad.test", "a..b"] {
            assert!(SourceResolver::https(host, 443).is_err());
        }
        assert!(SourceResolver::https("service.example", 0).is_err());
        for host in ["service.example", "localhost", "192.168.1.1", "8.8.8.8"] {
            assert!(SourceResolver::loopback_http(host, 8888).is_err());
        }
        assert!(SourceResolver::loopback_http("127.0.0.1", 8888).is_ok());
        assert!(SourceResolver::loopback_http("[::1]", 8888).is_ok());
    }

    #[test]
    fn fixed_service_authority_is_rejected_before_dns_work() {
        let config = ureq::Agent::config_builder().build();
        let timeout = NextTimeout {
            after: Duration::from_millis(10).into(),
            reason: ureq::Timeout::Resolve,
        };
        for uri in [
            "http://usage.aicharts.io/v1/batches",
            "https://other.test/v1/batches",
            "https://usage.aicharts.io:444/v1/batches",
        ] {
            assert!(UsageResolver
                .resolve(&uri.parse().unwrap(), &config, timeout)
                .is_err());
        }
        assert!(!DNS_BUSY.load(Ordering::Acquire));
    }

    #[test]
    fn timed_out_dns_retains_its_permit_until_actual_worker_completion() {
        static BUSY: AtomicBool = AtomicBool::new(false);
        let (release, hold) = mpsc::sync_channel(1);
        let pending = start_lookup(&BUSY, move || {
            hold.recv_timeout(Duration::from_secs(2)).unwrap();
            Err(io::Error::from(io::ErrorKind::NotFound))
        })
        .unwrap();
        assert!(matches!(
            pending.result.recv_timeout(Duration::from_millis(10)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        assert!(BUSY.load(Ordering::Acquire));
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = calls.clone();
        assert!(start_lookup(&BUSY, move || {
            count.fetch_add(1, Ordering::SeqCst);
            Ok(UsageResolver.empty())
        })
        .is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        // Discarded caller delivery cannot release the worker-owned permit early.
        drop(pending.result);
        assert!(BUSY.load(Ordering::Acquire));
        release.send(()).unwrap();
        pending.worker.join().unwrap();
        assert!(!BUSY.load(Ordering::Acquire));
        let next = start_lookup(&BUSY, || Err(io::Error::from(io::ErrorKind::NotFound))).unwrap();
        assert!(next
            .result
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .is_err());
        next.worker.join().unwrap();
        assert!(!BUSY.load(Ordering::Acquire));
    }

    #[test]
    fn address_limit_does_not_consume_or_schedule_more_than_sixteen_results() {
        let count = std::cell::Cell::new(0);
        let addresses = std::iter::repeat_with(|| {
            count.set(count.get() + 1);
            "127.0.0.1:443".parse().unwrap()
        });
        let result = bounded_addresses(addresses).unwrap();
        assert_eq!(result.len(), 16);
        assert_eq!(count.get(), 16);
        assert!(bounded_addresses(std::iter::empty()).is_err());
    }
}
