//! Synthetic local TLS only. Every server owns its listener, accepted socket and
//! join handle; Drop interrupts sockets and joins even when an assertion fails.
use super::*;
use aicharts_ledger::FrozenBatch;
use aicharts_protocol::{Policy, Registry};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use rustls::{ServerConfig, ServerConnection, StreamOwned};
use std::io::Write;
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use ureq::tls::Certificate;

const CA: &[u8] = include_bytes!("fixtures/ca.der");
const CERT: &[u8] = include_bytes!("fixtures/server.der");
// Public synthetic fixture material, never an account/provider credential.
const KEY: &[u8] = include_bytes!("fixtures/server-key.der");
const BINDING: SenderBinding = SenderBinding {
    account_id: [0x11; 16],
    device_id: [0x22; 32],
    generation: [0x33; 32],
    namespace_version: 1,
};
const TEST_SECRET: [u8; 32] = [0xa5; 32];

#[derive(Debug, Clone)]
struct LocalResolver {
    addr: SocketAddr,
    calls: Arc<std::sync::atomic::AtomicUsize>,
}
impl Resolver for LocalResolver {
    fn resolve(
        &self,
        uri: &Uri,
        _: &Config,
        _: NextTimeout,
    ) -> Result<ResolvedSocketAddrs, ureq::Error> {
        assert!(matches!(uri.host(), Some("usage.test" | "wrong.test")));
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut result = self.empty();
        result.push(self.addr);
        Ok(result)
    }
}

pub(super) struct ClientFixture {
    pub(super) url: String,
    pub(super) budget: Duration,
    roots: RootCerts,
    resolver: LocalResolver,
}
impl ClientFixture {
    pub(super) fn agent(&self, remaining: Duration) -> Agent {
        Agent::with_parts(
            configuration(remaining, self.roots.clone()),
            DefaultConnector::default(),
            self.resolver.clone(),
        )
    }
}

fn transport(addr: SocketAddr) -> HttpsTransport {
    let mut bearer = HeaderValue::from_str(&format!(
        "Bearer {}",
        TEST_SECRET
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    ))
    .unwrap();
    bearer.set_sensitive(true);
    HttpsTransport {
        binding: BINDING,
        bearer,
        fixture: Some(ClientFixture {
            url: format!("https://usage.test:{}/v1/batches", addr.port()),
            budget: Duration::from_secs(2),
            roots: RootCerts::Specific(vec![Certificate::from_der(CA)].into()),
            resolver: LocalResolver {
                addr,
                calls: Arc::default(),
            },
        }),
    }
}

type TlsStream = StreamOwned<ServerConnection, TcpStream>;
struct Server {
    addr: SocketAddr,
    stop: Arc<AtomicBool>,
    socket: Arc<Mutex<Option<TcpStream>>>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Server {
    fn new(run: impl FnOnce(&mut TlsStream) + Send + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let socket = Arc::new(Mutex::new(None));
        let worker_stop = stop.clone();
        let worker_socket = socket.clone();
        let worker = thread::spawn(move || {
            let until = Instant::now() + Duration::from_secs(5);
            let stream = loop {
                if worker_stop.load(Ordering::Acquire) || Instant::now() >= until {
                    return;
                }
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(1))
                    }
                    Err(error) => panic!("synthetic accept: {error}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            *worker_socket.lock().unwrap() = Some(stream.try_clone().unwrap());
            let config = ServerConfig::builder_with_provider(Arc::new(
                rustls::crypto::ring::default_provider(),
            ))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(
                vec![CertificateDer::from(CERT.to_vec())],
                PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(KEY.to_vec())),
            )
            .unwrap();
            let mut tls =
                StreamOwned::new(ServerConnection::new(Arc::new(config)).unwrap(), stream);
            run(&mut tls);
            worker_socket.lock().unwrap().take();
        });
        Self {
            addr,
            stop,
            socket,
            worker: Some(worker),
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(socket) = self.socket.lock().unwrap().take() {
            let _ = socket.shutdown(Shutdown::Both);
        }
        if let Some(worker) = self.worker.take() {
            let result = worker.join();
            if !thread::panicking() {
                result.unwrap();
            }
        }
    }
}

fn read_request(stream: &mut TlsStream) -> io::Result<(String, Vec<u8>)> {
    let mut header = Vec::new();
    let mut byte = [0];
    while !header.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte)?;
        header.push(byte[0]);
        if header.len() > HEADER_BYTES {
            return Err(io::Error::other("synthetic request header limit"));
        }
    }
    let header = String::from_utf8(header).unwrap();
    let length: usize = header
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse().unwrap())
        })
        .unwrap();
    assert!(length <= wire::MAX_BATCH_BYTES);
    let mut body = vec![0; length];
    stream.read_exact(&mut body)?;
    Ok((header, body))
}

fn request() -> UploadRequest {
    let binding = wire::Binding {
        account_id: BINDING.account_id,
        namespace_version: 1,
        device_id: BINDING.device_id,
        recovery_generation: BINDING.generation,
    };
    let batch = wire::Batch {
        binding,
        operations: vec![wire::Operation {
            binding,
            sequence: 1,
            occurrence_id: [7; 16],
            expected_head: [9; 32],
            kind: wire::OperationKind::Tombstone,
        }],
    };
    let registry = Registry {
        revision: 1,
        models: vec![],
    };
    let policy = Policy {
        first_day: 0,
        last_day: u32::MAX,
        registry: &registry,
    };
    UploadRequest {
        binding: BINDING,
        frozen: FrozenBatch {
            first_sequence: 1,
            operation_count: 1,
            selected_revision: 1,
            canonical_batch: wire::encode_batch(&batch, &policy).unwrap(),
            batch_hash: wire::batch_digest(&batch, &policy).unwrap(),
        },
    }
}

fn journal(request: &UploadRequest) -> Vec<u8> {
    let registry = Registry {
        revision: 1,
        models: vec![],
    };
    let policy = Policy {
        first_day: 0,
        last_day: u32::MAX,
        registry: &registry,
    };
    let batch = wire::decode_batch(request.canonical_batch(), &policy).unwrap();
    let operation = &batch.operations[0];
    wire::encode_journal(&wire::Journal {
        binding: batch.binding,
        first_sequence: 1,
        batch_hash: *request.batch_hash(),
        account_journal_revision: 1,
        committed_at_ms: 1_800_000_000_000,
        status: wire::JournalStatus::Accepted,
        receipts: vec![wire::Receipt {
            descriptor: operation.descriptor(),
            operation_hash: wire::operation_digest(operation, &policy).unwrap(),
            head_operation_hash: wire::operation_digest(operation, &policy).unwrap(),
            account_journal_revision: 1,
            committed_at_ms: 1_800_000_000_000,
            outcome: wire::Outcome::Tombstoned,
        }],
    })
    .unwrap()
}

fn response(body: &[u8]) -> Vec<u8> {
    let mut value = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        JOURNAL_MEDIA,
        body.len()
    )
    .into_bytes();
    value.extend_from_slice(body);
    value
}

fn raw_exchange(raw: Vec<u8>) -> (Result<(), TransportError>, JournalBody) {
    let server = Server::new(move |stream| {
        read_request(stream).unwrap();
        // Refusals may close before the whole malformed response is written.
        let _ = stream.write_all(&raw);
        let _ = stream.flush();
    });
    let mut body = JournalBody::new();
    let result = transport(server.addr).exchange(&request(), &mut body);
    (result, body)
}

#[test]
fn verified_tls_sends_one_exact_bounded_request_and_receives_correlated_journal() {
    let request = request();
    let expected = journal(&request);
    let reply = response(&expected);
    let (send, receive) = mpsc::sync_channel(1);
    let server = Server::new(move |stream| {
        send.send(read_request(stream).unwrap()).unwrap();
        stream.write_all(&reply).unwrap();
        stream.flush().unwrap();
    });
    let mut adapter = transport(server.addr);
    assert_eq!(adapter.binding(), BINDING);
    assert!(adapter.bearer.is_sensitive());
    assert_eq!(format!("{:?}", adapter.bearer), "Sensitive");
    let mut body = JournalBody::new();
    adapter.exchange(&request, &mut body).unwrap();
    let (headers, sent) = receive.recv_timeout(Duration::from_secs(2)).unwrap();
    let headers = headers.to_ascii_lowercase();
    assert!(headers.starts_with("post /v1/batches http/1.1\r\n"));
    assert!(headers.contains(&format!("authorization: bearer {}\r\n", "a5".repeat(32))));
    assert!(headers.contains(&format!("content-type: {BATCH_MEDIA}\r\n")));
    assert!(headers.contains("connection: close\r\n"));
    assert!(
        !headers.contains("cookie:")
            && !headers.contains("accept-encoding:")
            && !headers.contains("transfer-encoding:")
    );
    assert_eq!(sent, request.canonical_batch());
    assert_eq!(body.bytes, expected);
    let registry = Registry {
        revision: 1,
        models: vec![],
    };
    let policy = Policy {
        first_day: 0,
        last_day: u32::MAX,
        registry: &registry,
    };
    wire::validate_journal_for_batch(
        &wire::decode_journal(&body.bytes).unwrap(),
        &wire::decode_batch(&sent, &policy).unwrap(),
        &policy,
    )
    .unwrap();
    assert_eq!(
        adapter
            .fixture
            .as_ref()
            .unwrap()
            .resolver
            .calls
            .load(Ordering::SeqCst),
        1
    );
}

#[test]
fn enabled_logger_cannot_observe_synthetic_bearer_or_batch_during_tls_exchange() {
    struct CaptureLogger(Mutex<Vec<String>>);
    impl log::Log for CaptureLogger {
        fn enabled(&self, _: &log::Metadata<'_>) -> bool {
            true
        }

        fn log(&self, record: &log::Record<'_>) {
            self.0.lock().unwrap().push(record.args().to_string());
        }

        fn flush(&self) {}
    }
    static CAPTURE: CaptureLogger = CaptureLogger(Mutex::new(Vec::new()));

    log::set_logger(&CAPTURE).expect("synthetic logger must be installed once");
    log::set_max_level(log::LevelFilter::Trace);
    assert_eq!(log::max_level(), log::LevelFilter::Trace);
    let probe = log::Record::builder()
        .args(format_args!("synthetic-log-sink-probe"))
        .level(log::Level::Trace)
        .target("aicharts.upload.synthetic")
        .build();
    assert!(log::logger().enabled(probe.metadata()));
    // Direct delivery bypasses the compile-time macro filter, proving this is a
    // live capture sink before exercising the dependencies' real logging paths.
    log::logger().log(&probe);
    assert_eq!(
        CAPTURE.0.lock().unwrap().as_slice(),
        ["synthetic-log-sink-probe"]
    );
    CAPTURE.0.lock().unwrap().clear();

    let request = request();
    let sent_bytes = request.canonical_batch().to_vec();
    let expected = journal(&request);
    let reply = response(&expected);
    let server = Server::new(move |stream| {
        let (headers, body) = read_request(stream).unwrap();
        assert!(headers
            .to_ascii_lowercase()
            .contains(&format!("authorization: bearer {}\r\n", "a5".repeat(32))));
        assert_eq!(body, sent_bytes);
        stream.write_all(&reply).unwrap();
        stream.flush().unwrap();
    });
    let mut body = JournalBody::new();
    transport(server.addr)
        .exchange(&request, &mut body)
        .unwrap();
    assert_eq!(body.bytes, expected);
    drop(server);
    assert!(
        CAPTURE.0.lock().unwrap().is_empty(),
        "dependency logging must remain disabled through TLS exchange and cleanup"
    );
}

#[test]
fn exact_maximum_content_length_body_reaches_framed_eof() {
    // This tests the HTTP ceiling; canonical journal validation remains owned by send_once.
    let maximum = vec![0x41; wire::MAX_JOURNAL_BYTES];
    let (result, body) = raw_exchange(response(&maximum));
    assert_eq!(result, Ok(()));
    assert_eq!(body.bytes, maximum);
}

#[test]
fn malformed_status_media_and_framing_never_supply_receipt_authority() {
    let media = JOURNAL_MEDIA;
    let cases = [
        "HTTP/1.1 302 Found\r\nLocation: https://usage.test/other\r\nContent-Length: 1\r\n\r\nx".into(),
        format!("HTTP/1.1 201 Created\r\nContent-Type: {media}\r\nContent-Length: 1\r\n\r\nx"),
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 1\r\n\r\nx".into(),
        format!("HTTP/1.1 200 OK\r\nContent-Type: {media}; charset=utf-8\r\nContent-Length: 1\r\n\r\nx"),
        format!("HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Type: {media}\r\nContent-Length: 1\r\n\r\nx"),
        format!("HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\nx"),
        format!("HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\n1\r\nx\r\n0\r\n\r\n"),
        format!("HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Length: 01\r\n\r\nx"),
        format!("HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Length: 67745\r\n\r\nx"),
        format!("HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Length: 0\r\n\r\n"),
        format!("HTTP/1.1 200 OK\r\nContent-Type: {media}\r\n\r\nx"),
        format!("HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Length: 1\r\nContent-Encoding: gzip\r\n\r\nx"),
        format!("HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Length: 1\r\nSet-Cookie: ignored=1\r\n\r\nx"),
        format!("HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Length: 1\r\nTrailer: X-Receipt\r\n\r\nx"),
        format!("HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nTransfer-Encoding: chunked\r\nTransfer-Encoding: chunked\r\n\r\n1\r\nx\r\n0\r\n\r\n"),
    ];
    for (index, raw) in cases.into_iter().enumerate() {
        let (result, body) = raw_exchange(raw.into_bytes());
        assert!(result.is_err(), "response case {index}");
        assert!(body.bytes.is_empty(), "response case {index}");
    }
}

#[test]
fn truncated_content_length_and_oversize_chunked_bodies_are_rejected() {
    let payload = journal(&request());
    let mut truncated = response(&payload);
    truncated.pop();
    assert!(raw_exchange(truncated).0.is_err());
    let media = JOURNAL_MEDIA;
    let mut oversized = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n",
        wire::MAX_JOURNAL_BYTES + 1
    )
    .into_bytes();
    oversized.extend(std::iter::repeat_n(b'x', wire::MAX_JOURNAL_BYTES + 1));
    oversized.extend_from_slice(b"\r\n0\r\n\r\n");
    let (result, body) = raw_exchange(oversized);
    assert_eq!(result, Err(TransportError::InvalidResponse));
    assert!(body.bytes.len() <= wire::MAX_JOURNAL_BYTES);
    assert!(body.bytes.is_empty());
    let unterminated = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nTransfer-Encoding: chunked\r\n\r\n1\r\nx\r\n"
    );
    assert!(raw_exchange(unterminated.into_bytes()).0.is_err());
}

#[test]
fn complete_and_missing_final_crlf_chunked_journals_are_refused() {
    let payload = journal(&request());
    for ending in [b"\r\n0\r\n".as_slice(), b"\r\n0\r\n\r\n".as_slice()] {
        let mut raw = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n",
            JOURNAL_MEDIA,
            payload.len()
        )
        .into_bytes();
        raw.extend_from_slice(&payload);
        raw.extend_from_slice(ending);
        let (result, body) = raw_exchange(raw);
        assert_eq!(result, Err(TransportError::InvalidResponse));
        assert!(body.bytes.is_empty());
    }
}

#[test]
fn certificate_roots_and_hostname_are_verified_before_credentials_are_sent() {
    for wrong_hostname in [false, true] {
        let (send, received) = mpsc::sync_channel(1);
        let server = Server::new(move |stream| {
            send.send(read_request(stream).is_ok()).unwrap();
        });
        let mut adapter = transport(server.addr);
        if wrong_hostname {
            adapter.fixture.as_mut().unwrap().url =
                format!("https://wrong.test:{}/v1/batches", server.addr.port());
        } else {
            adapter.fixture.as_mut().unwrap().roots = RootCerts::WebPki;
        }
        assert!(adapter
            .exchange(&request(), &mut JournalBody::new())
            .is_err());
        assert!(!received.recv_timeout(Duration::from_secs(2)).unwrap());
    }
}

#[test]
fn mismatched_binding_and_invalid_local_limits_never_connect() {
    let server = Server::new(|_| panic!("local refusal must not connect"));
    let mut adapter = transport(server.addr);
    let mut wrong = request();
    wrong.binding.generation[0] ^= 1;
    assert_eq!(
        adapter.exchange(&wrong, &mut JournalBody::new()),
        Err(TransportError::Blocked)
    );
    wrong = request();
    wrong.frozen.canonical_batch = vec![0; wire::MAX_BATCH_BYTES + 1];
    assert_eq!(
        adapter.exchange(&wrong, &mut JournalBody::new()),
        Err(TransportError::InvalidResponse)
    );
    let mut body = JournalBody::new();
    body.append(b"untrusted existing bytes").unwrap();
    assert_eq!(
        adapter.exchange(&request(), &mut body),
        Err(TransportError::InvalidResponse)
    );
    assert_eq!(
        adapter
            .fixture
            .as_ref()
            .unwrap()
            .resolver
            .calls
            .load(Ordering::SeqCst),
        0
    );
}

#[test]
fn domain_statuses_map_to_fixed_codes_without_reading_error_bodies() {
    for (status, expected) in [
        (401, TransportError::Unauthorized),
        (409, TransportError::Blocked),
        (503, TransportError::Unavailable),
    ] {
        let raw = format!("HTTP/1.1 {status} Error\r\nContent-Length: 999999999999\r\n\r\nprivate-provider-error-must-not-escape");
        let (result, body) = raw_exchange(raw.into_bytes());
        assert_eq!(result, Err(expected));
        assert!(body.bytes.is_empty());
        assert!(!expected.code().contains("private"));
    }
}

#[test]
fn response_header_bytes_and_count_are_bounded() {
    let media = JOURNAL_MEDIA;
    let huge = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Length: 1\r\nX-Large: {}\r\n\r\nx",
        "x".repeat(HEADER_BYTES)
    );
    assert!(raw_exchange(huge.into_bytes()).0.is_err());
    let many = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Length: 1\r\n{}\r\nx",
        (0..HEADER_COUNT)
            .map(|n| format!("X-{n}: x\r\n"))
            .collect::<String>()
    );
    assert!(raw_exchange(many.into_bytes()).0.is_err());
}

#[test]
fn header_and_body_stalls_expire_and_close_the_owned_socket() {
    for send_headers in [false, true] {
        let (send, received) = mpsc::sync_channel(1);
        let server = Server::new(move |stream| {
            read_request(stream).unwrap();
            if send_headers {
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: 1\r\n\r\n",
                    JOURNAL_MEDIA
                )
                .unwrap();
                stream.flush().unwrap();
            }
            let mut byte = [0];
            let closed = match stream.sock.read(&mut byte) {
                Ok(0) => true,
                Err(e) => !matches!(
                    e.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ),
                _ => false,
            };
            send.send(closed).unwrap();
        });
        let mut adapter = transport(server.addr);
        adapter.fixture.as_mut().unwrap().budget = Duration::from_millis(100);
        assert!(adapter
            .exchange(&request(), &mut JournalBody::new())
            .is_err());
        assert!(received.recv_timeout(Duration::from_secs(2)).unwrap());
    }
}

#[test]
fn dropped_reply_does_not_retry_and_explicit_replay_sends_identical_bytes() {
    let frozen = request();
    let expected = frozen.canonical_batch().to_vec();
    let (send, received) = mpsc::sync_channel(1);
    let first = Server::new(move |stream| {
        send.send(read_request(stream).unwrap().1).unwrap();
    });
    let mut adapter = transport(first.addr);
    assert!(adapter.exchange(&frozen, &mut JournalBody::new()).is_err());
    assert_eq!(
        received.recv_timeout(Duration::from_secs(2)).unwrap(),
        expected
    );
    assert_eq!(
        adapter
            .fixture
            .as_ref()
            .unwrap()
            .resolver
            .calls
            .load(Ordering::SeqCst),
        1
    );
    drop(first);
    let reply = response(&journal(&frozen));
    let (send, received) = mpsc::sync_channel(1);
    let second = Server::new(move |stream| {
        send.send(read_request(stream).unwrap().1).unwrap();
        stream.write_all(&reply).unwrap();
        stream.flush().unwrap();
    });
    let mut body = JournalBody::new();
    transport(second.addr).exchange(&frozen, &mut body).unwrap();
    assert_eq!(
        received.recv_timeout(Duration::from_secs(2)).unwrap(),
        expected
    );
    assert_eq!(body.bytes, journal(&frozen));
}

#[test]
fn production_configuration_has_fixed_authority_and_no_ambient_transport_policy() {
    let mut adapter = transport("127.0.0.1:1".parse().unwrap());
    adapter.fixture = None;
    assert_eq!(adapter.url(), URL);
    assert_eq!(adapter.budget(), TOTAL);
    let agent = adapter.agent(TOTAL);
    let config = agent.config();
    assert!(config.https_only());
    assert!(config.proxy().is_none());
    assert_eq!(config.max_redirects(), 0);
    assert_eq!(config.max_idle_connections(), 0);
    assert_eq!(config.max_idle_connections_per_host(), 0);
    assert!(!config.http_status_as_error());
    assert!(!config.tls_config().disable_verification());
    assert!(config.tls_config().use_sni());
    assert!(matches!(
        config.tls_config().root_certs(),
        RootCerts::WebPki
    ));
    let timeout = NextTimeout {
        after: Duration::from_millis(10).into(),
        reason: ureq::Timeout::Resolve,
    };
    for uri in [
        "http://usage.aicharts.io/v1/batches",
        "https://other.test/v1/batches",
        "https://usage.aicharts.io:444/v1/batches",
    ] {
        assert!(BoundedResolver
            .resolve(&uri.parse().unwrap(), config, timeout)
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
        Ok(BoundedResolver.empty())
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
fn no_body_bytes_or_success_are_admitted_after_a_blocking_read_exceeds_deadline() {
    struct LateRead;
    impl Read for LateRead {
        fn read(&mut self, into: &mut [u8]) -> io::Result<usize> {
            thread::sleep(Duration::from_millis(20));
            into[0] = b'x';
            Ok(1)
        }
    }
    let mut body = JournalBody::new();
    assert_eq!(
        read_journal(
            &mut LateRead,
            &mut body,
            1,
            &Deadline::new(Duration::from_millis(5)).unwrap()
        ),
        Err(TransportError::Uncertain)
    );
    assert!(body.bytes.is_empty());
}

#[test]
fn late_framed_eof_cannot_turn_received_bytes_into_success() {
    struct LateEof(bool);
    impl Read for LateEof {
        fn read(&mut self, into: &mut [u8]) -> io::Result<usize> {
            if self.0 {
                thread::sleep(Duration::from_millis(20));
                return Ok(0);
            }
            self.0 = true;
            into[0] = b'x';
            Ok(1)
        }
    }
    let mut body = JournalBody::new();
    assert_eq!(
        read_journal(
            &mut LateEof(false),
            &mut body,
            1,
            &Deadline::new(Duration::from_millis(5)).unwrap()
        ),
        Err(TransportError::Uncertain)
    );
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

#[test]
fn redirect_statuses_never_make_a_second_request() {
    for status in [301, 302, 303, 307, 308] {
        let server = Server::new(move |stream| {
            read_request(stream).unwrap();
            write!(stream, "HTTP/1.1 {status} Redirect\r\nLocation: https://wrong.test/redirect\r\nContent-Length: 0\r\n\r\n").unwrap();
            stream.flush().unwrap();
        });
        let mut adapter = transport(server.addr);
        assert_eq!(
            adapter.exchange(&request(), &mut JournalBody::new()),
            Err(TransportError::InvalidResponse)
        );
        assert_eq!(
            adapter
                .fixture
                .as_ref()
                .unwrap()
                .resolver
                .calls
                .load(Ordering::SeqCst),
            1
        );
    }
}

#[test]
fn completed_and_rejected_replies_close_without_waiting_for_a_peer_fin_or_drain() {
    for accepted in [true, false] {
        let reply = if accepted {
            response(&journal(&request()))
        } else {
            b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 60000\r\n\r\n".to_vec()
        };
        let (send, received) = mpsc::sync_channel(1);
        let server = Server::new(move |stream| {
            read_request(stream).unwrap();
            stream.write_all(&reply).unwrap();
            stream.flush().unwrap();
            let mut byte = [0];
            let closed = match stream.sock.read(&mut byte) {
                Ok(0) => true,
                Err(error) => !matches!(
                    error.kind(),
                    io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
                ),
                _ => false,
            };
            send.send(closed).unwrap();
        });
        let mut adapter = transport(server.addr);
        let result = adapter.exchange(&request(), &mut JournalBody::new());
        assert_eq!(result.is_ok(), accepted);
        assert!(received.recv_timeout(Duration::from_secs(2)).unwrap());
    }
}

#[test]
fn a_dribbling_response_cannot_restart_the_global_acceptance_budget() {
    let payload = journal(&request());
    let server = Server::new(move |stream| {
        read_request(stream).unwrap();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: {JOURNAL_MEDIA}\r\nContent-Length: {}\r\n\r\n",
            payload.len()
        )
        .unwrap();
        stream.flush().unwrap();
        for byte in payload {
            thread::sleep(Duration::from_millis(2));
            if stream
                .write_all(&[byte])
                .and_then(|()| stream.flush())
                .is_err()
            {
                break;
            }
        }
    });
    let mut adapter = transport(server.addr);
    adapter.fixture.as_mut().unwrap().budget = Duration::from_millis(100);
    assert!(adapter
        .exchange(&request(), &mut JournalBody::new())
        .is_err());
}
