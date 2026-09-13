//! One process-wide, fixed-service DNS owner shared by dormant HTTPS adapters.
//! A timed-out caller cannot release the OS worker's permit or schedule a retry.

use std::io;
use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

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
