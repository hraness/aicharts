//! Public synthetic vectors and local verified TLS only. Each server owns its
//! listener, accepted socket and join, including when a test assertion unwinds.
use super::*;
use contract::{DeviceState, Enrollment, Receipt, Reservation};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use rustls::{ServerConfig, ServerConnection, StreamOwned};
use serde_json::Value;
use std::io::{self, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use ureq::http::Uri;
use ureq::tls::Certificate;
use ureq::unversioned::resolver::{ResolvedSocketAddrs, Resolver};
use ureq::unversioned::transport::NextTimeout;

const CA: &[u8] = include_bytes!("../upload/fixtures/ca.der");
const CERT: &[u8] = include_bytes!("../upload/fixtures/server.der");
// Existing public synthetic key, never an account/provider credential.
const KEY: &[u8] = include_bytes!("../upload/fixtures/server-key.der");
const VECTORS: &str = include_str!("../../../../fixtures/usage/terminal-enrollment-v1.json");

#[derive(Clone, Debug)]
struct LocalResolver {
    addr: SocketAddr,
    calls: Arc<AtomicUsize>,
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
    wall_ms: Arc<AtomicU64>,
}

impl ClientFixture {
    pub(super) fn agent(&self, remaining: Duration) -> Agent {
        Agent::with_parts(
            configuration(remaining, self.roots.clone()),
            DefaultConnector::default(),
            self.resolver.clone(),
        )
    }

    pub(super) fn observe(&self) -> Result<Observation, TransportError> {
        Ok(Observation {
            wall_ms: self.wall_ms.load(Ordering::SeqCst),
            monotonic: Instant::now(),
        })
    }
}

fn transport(addr: SocketAddr, now_ms: u64) -> HttpsEnrollment {
    HttpsEnrollment {
        _construction: (),
        fixture: Some(ClientFixture {
            url: format!("https://usage.test:{}/v1/enrollment", addr.port()),
            budget: Duration::from_secs(2),
            roots: RootCerts::Specific(vec![Certificate::from_der(CA)].into()),
            resolver: LocalResolver {
                addr,
                calls: Arc::default(),
            },
            wall_ms: Arc::new(AtomicU64::new(now_ms)),
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
                        thread::sleep(Duration::from_millis(1));
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

fn header_values<'a>(headers: &'a str, name: &str) -> Vec<&'a str> {
    headers
        .lines()
        .filter_map(|line| {
            let (field, value) = line.split_once(':')?;
            field.eq_ignore_ascii_case(name).then_some(value.trim())
        })
        .collect()
}

fn read_request(stream: &mut TlsStream) -> io::Result<(String, Vec<u8>)> {
    let mut headers = Vec::new();
    let mut byte = [0];
    while !headers.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte)?;
        headers.push(byte[0]);
        if headers.len() > HEADER_BYTES {
            return Err(io::Error::other("synthetic request header limit"));
        }
    }
    let headers = String::from_utf8(headers).unwrap();
    let values = header_values(&headers, "content-length");
    assert_eq!(values.len(), 1);
    let length: usize = values[0].parse().unwrap();
    assert!((1..=contract::MAX_REQUEST_BYTES).contains(&length));
    let mut body = vec![0; length];
    stream.read_exact(&mut body)?;
    Ok((headers, body))
}

fn assert_request(headers: &str, body: &[u8], expected: &[u8]) {
    assert!(headers.starts_with("POST /v1/enrollment HTTP/1.1\r\n"));
    assert_eq!(header_values(headers, "content-type"), ["application/json"]);
    assert_eq!(header_values(headers, "accept"), ["application/json"]);
    assert_eq!(header_values(headers, "connection"), ["close"]);
    assert_eq!(
        header_values(headers, "content-length"),
        [expected.len().to_string()]
    );
    for name in [
        "authorization",
        "cookie",
        "origin",
        "content-encoding",
        "transfer-encoding",
        "trailer",
        "expect",
    ] {
        assert!(
            header_values(headers, name).is_empty(),
            "request header {name}"
        );
    }
    for secret in ["11", "22", "33", "77"] {
        assert!(!headers.contains(&secret.repeat(32)));
    }
    assert_eq!(body, expected);
}

fn vectors() -> &'static Vec<Value> {
    static FIXTURE: OnceLock<Value> = OnceLock::new();
    FIXTURE.get_or_init(|| serde_json::from_str(VECTORS).unwrap())["vectors"]
        .as_array()
        .unwrap()
}

fn sample(name: &str) -> &'static Value {
    vectors()
        .iter()
        .find(|value| value["name"] == name)
        .unwrap()
}

fn hex<const N: usize>(value: &Value) -> [u8; N] {
    let text = value.as_str().unwrap();
    let text = text.strip_prefix("acct_").unwrap_or(text);
    assert_eq!(text.len(), N * 2);
    std::array::from_fn(|index| u8::from_str_radix(&text[index * 2..index * 2 + 2], 16).unwrap())
}

fn reservation(value: &Value) -> Reservation {
    Reservation {
        intent_id: hex(&value["intentId"]),
        account_id: hex(&value["accountId"]),
        reservation_id: hex(&value["reservationId"]),
        poll_commitment: hex(&value["pollCommitment"]),
        upload_commitment: hex(&value["uploadCommitment"]),
        recovery_generation: hex(&value["recoveryGeneration"]),
        reserved_at_ms: value["reservedAtMs"].as_u64().unwrap(),
        expires_at_ms: value["expiresAtMs"].as_u64().unwrap(),
    }
}

fn receipt(value: &Value) -> Receipt {
    Receipt {
        account_id: hex(&value["accountId"]),
        intent_id: hex(&value["intentId"]),
        reservation_id: hex(&value["reservationId"]),
        device_id: hex(&value["deviceId"]),
        enrolled_at_ms: value["enrolledAtMs"].as_u64().unwrap(),
    }
}

fn context(value: &Value) -> Context {
    Context {
        now_ms: value["nowMs"].as_u64().unwrap(),
        initialized_expires_at_ms: value["initializedExpiresAtMs"].as_u64(),
        confirmed_account_id: (!value["confirmedAccountId"].is_null())
            .then(|| hex(&value["confirmedAccountId"])),
        reservation: (!value["reservation"].is_null()).then(|| reservation(&value["reservation"])),
        enrollment: (!value["enrollment"].is_null()).then(|| Enrollment {
            receipt: receipt(&value["enrollment"]["receipt"]),
            device_state: match value["enrollment"]["deviceState"].as_str().unwrap() {
                "active" => DeviceState::Active,
                "revoked" => DeviceState::Revoked,
                _ => panic!("synthetic device state"),
            },
        }),
    }
}

fn parts(name: &str) -> (Request, Context, Vec<u8>) {
    let value = sample(name);
    (
        contract::decode_request(value["requestAscii"].as_str().unwrap().as_bytes()).unwrap(),
        context(&value["context"]),
        value["responseAscii"].as_str().unwrap().as_bytes().to_vec(),
    )
}

fn response(body: &[u8]) -> Vec<u8> {
    let mut result = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        contract::MEDIA,
        body.len()
    )
    .into_bytes();
    result.extend_from_slice(body);
    result
}

fn raw_exchange(raw: Vec<u8>) -> Result<AcceptedEnrollment, TransportError> {
    let (request, context, _) = parts("initialize-success");
    let server = Server::new(move |stream| {
        read_request(stream).unwrap();
        stream.write_all(&raw).unwrap();
        stream.flush().unwrap();
    });
    let result = transport(server.addr, context.now_ms).exchange_once(&request, &context);
    drop(server);
    result
}

#[test]
fn all_frozen_vectors_cross_verified_tls_with_exact_borrowed_request_bytes() {
    assert_eq!(vectors().len(), 25);
    for vector in vectors() {
        let name = vector["name"].as_str().unwrap();
        let (request, context, body) = parts(name);
        let saved_request = contract::encode_request(&request).unwrap();
        let expected = saved_request.as_bytes().to_vec();
        let raw = response(&body);
        let server = Server::new(move |stream| {
            let (headers, received) = read_request(stream).unwrap();
            assert_request(&headers, &received, &expected);
            stream.write_all(&raw).unwrap();
            stream.flush().unwrap();
        });
        let mut adapter = transport(server.addr, context.now_ms);
        let result = adapter.exchange_once(&request, &context);
        assert_eq!(
            result.is_ok(),
            vector["acceptResponse"].as_bool().unwrap(),
            "vector {name}"
        );
        if let Ok(accepted) = result {
            assert_eq!(accepted.observed_at_ms, context.now_ms);
            assert_eq!(
                contract::encode_response(&request, &context, &accepted.result)
                    .unwrap()
                    .as_bytes(),
                body
            );
        }
        assert_eq!(
            contract::encode_request(&request).unwrap().as_bytes(),
            saved_request.as_bytes()
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
        drop(server);
    }
}

#[test]
fn invalid_request_context_and_clock_are_rejected_before_dns() {
    let (mut request, mut context, _) = parts("namespaceForEnrollment-success");
    let mut adapter = transport("127.0.0.1:1".parse().unwrap(), context.now_ms);
    context.reservation = None;
    assert_eq!(
        adapter.exchange_once(&request, &context).err(),
        Some(TransportError::InvalidRequest)
    );
    let (_, valid_context, _) = parts("namespaceForEnrollment-success");
    context = valid_context;
    if let Request::Namespace(proof) = &mut request {
        proof.pairing.intent_id = [0; 32];
    }
    assert_eq!(
        adapter.exchange_once(&request, &context).err(),
        Some(TransportError::InvalidRequest)
    );
    let (request, context, _) = parts("namespaceForEnrollment-success");
    for wall in [context.now_ms - 1, contract::MAX_TIME_MS + 1] {
        adapter
            .fixture
            .as_ref()
            .unwrap()
            .wall_ms
            .store(wall, Ordering::SeqCst);
        assert_eq!(
            adapter.exchange_once(&request, &context).err(),
            Some(TransportError::ClockInvalid)
        );
    }
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
fn request_and_response_secrets_never_reach_the_enabled_global_logger() {
    // Capture is declared first and remains held until server cleanup joins.
    let capture = crate::transport_test_log::capture();
    let (request, context, body) = parts("namespaceForEnrollment-success");
    let expected = contract::encode_request(&request)
        .unwrap()
        .as_bytes()
        .to_vec();
    let raw = response(&body);
    let server = Server::new(move |stream| {
        let (headers, received) = read_request(stream).unwrap();
        assert_request(&headers, &received, &expected);
        stream.write_all(&raw).unwrap();
        stream.flush().unwrap();
    });
    let accepted = transport(server.addr, context.now_ms)
        .exchange_once(&request, &context)
        .unwrap();
    assert!(matches!(
        accepted.result,
        Ok(contract::Success::Namespace { .. })
    ));
    drop(server);
    capture.assert_empty();
}

#[test]
fn trust_roots_and_hostname_are_verified_before_any_http_request() {
    for wrong_hostname in [false, true] {
        let (send, received) = mpsc::sync_channel(1);
        let server = Server::new(move |stream| {
            send.send(read_request(stream).is_ok()).unwrap();
        });
        let (request, context, _) = parts("initialize-success");
        let mut adapter = transport(server.addr, context.now_ms);
        if wrong_hostname {
            adapter.fixture.as_mut().unwrap().url =
                format!("https://wrong.test:{}/v1/enrollment", server.addr.port());
        } else {
            adapter.fixture.as_mut().unwrap().roots = RootCerts::WebPki;
        }
        assert_eq!(
            adapter.exchange_once(&request, &context).err(),
            Some(TransportError::Uncertain)
        );
        assert!(!received.recv_timeout(Duration::from_secs(2)).unwrap());
        drop(server);
    }
}

#[test]
fn malformed_media_length_version_and_transfer_framing_are_refused() {
    let media = contract::MEDIA;
    let (_, _, body) = parts("initialize-success");
    let body = String::from_utf8(body).unwrap();
    let length = body.len();
    assert!(raw_exchange(response(body.as_bytes())).is_ok());
    let mut cases = vec![
        format!("HTTP/1.0 200 OK\r\nContent-Type: {media}\r\nContent-Length: {length}\r\n\r\n{body}"),
        format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {length}\r\n\r\n{body}"),
        format!("HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Type: {media}\r\nContent-Length: {length}\r\n\r\n{body}"),
        format!("HTTP/1.1 200 OK\r\nContent-Type: {media}\r\n\r\n{body}"),
        format!("HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Length: {length}\r\nContent-Length: {length}\r\n\r\n{body}"),
    ];
    for length in [
        String::new(),
        "0".into(),
        format!("0{length}"),
        format!("+{length}"),
        format!("{length}, {length}"),
        "2049".into(),
        "99999".into(),
    ] {
        cases.push(format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Length: {length}\r\n\r\n{body}"
        ));
    }
    for header in [
        "Content-Encoding: gzip",
        "Transfer-Encoding: chunked",
        "Location: https://wrong.test/",
        "Set-Cookie: ignored=1",
        "Trailer: X-Receipt",
        "Upgrade: websocket",
    ] {
        cases.push(format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Length: {length}\r\n{header}\r\n\r\n{body}"
        ));
    }
    for (index, raw) in cases.into_iter().enumerate() {
        assert!(
            raw_exchange(raw.into_bytes()).is_err(),
            "framing case {index}"
        );
    }
}

#[test]
fn complete_and_incomplete_chunked_bodies_never_supply_a_domain_result() {
    let (_, _, body) = parts("initialize-success");
    for ending in [b"\r\n0\r\n".as_slice(), b"\r\n0\r\n\r\n".as_slice()] {
        let mut raw = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n",
            contract::MEDIA,
            body.len()
        )
        .into_bytes();
        raw.extend_from_slice(&body);
        raw.extend_from_slice(ending);
        assert_eq!(
            raw_exchange(raw).err(),
            Some(TransportError::InvalidResponse)
        );
    }
}

#[test]
fn exact_ceiling_reaches_framed_eof_and_a_truncated_body_is_uncertain() {
    let maximum = vec![b'x'; contract::MAX_RESPONSE_BYTES];
    let raw = response(&maximum);
    let (request, context, _) = parts("initialize-success");
    let server = Server::new(move |stream| {
        read_request(stream).unwrap();
        stream.write_all(&raw).unwrap();
        stream.flush().unwrap();
    });
    let adapter = transport(server.addr, context.now_ms);
    let mut attempt =
        Attempt::new(adapter.observe().unwrap(), context.now_ms, adapter.budget()).unwrap();
    let agent = adapter.agent(attempt.check(adapter.observe().unwrap()).unwrap());
    let encoded = contract::encode_request(&request).unwrap();
    assert_eq!(
        adapter
            .response(&agent, encoded.as_bytes(), &mut attempt)
            .unwrap(),
        maximum
    );
    drop(agent);
    drop(server);
    // The HTTP ceiling does not relax the separate canonical JSON contract.
    assert_eq!(
        raw_exchange(response(&maximum)).err(),
        Some(TransportError::InvalidResponse)
    );
    let (_, _, body) = parts("initialize-success");
    let mut raw = response(&body);
    raw.pop();
    assert_eq!(raw_exchange(raw).err(), Some(TransportError::Uncertain));
}

#[test]
fn wrong_correlation_and_noncanonical_json_are_rejected_after_valid_framing() {
    let (_, _, body) = parts("initialize-success");
    let text = String::from_utf8(body).unwrap();
    let cases = [
        format!("{text}\n"),
        text.replacen(
            "\"schemaVersion\":1",
            "\"schemaVersion\":1,\"schemaVersion\":1",
            1,
        ),
        text.replacen("\"initialize\"", "\"poll\"", 1),
        text.replacen(&"11".repeat(32), &"99".repeat(32), 1),
    ];
    for raw in cases {
        assert_eq!(
            raw_exchange(response(raw.as_bytes())).err(),
            Some(TransportError::InvalidResponse)
        );
    }
    let (request, context, body) = parts("namespaceForEnrollment-success");
    let altered = String::from_utf8(body)
        .unwrap()
        .replace(&"44".repeat(32), &"88".repeat(32));
    let raw = response(altered.as_bytes());
    let server = Server::new(move |stream| {
        read_request(stream).unwrap();
        stream.write_all(&raw).unwrap();
        stream.flush().unwrap();
    });
    assert_eq!(
        transport(server.addr, context.now_ms)
            .exchange_once(&request, &context)
            .err(),
        Some(TransportError::InvalidResponse)
    );
    drop(server);
}

#[test]
fn operational_statuses_and_redirects_do_not_read_bodies_or_retry() {
    for status in [201, 204, 301, 302, 303, 307, 308, 400, 401, 409, 503] {
        let (send, received) = mpsc::sync_channel(1);
        let server = Server::new(move |stream| {
            read_request(stream).unwrap();
            write!(stream, "HTTP/1.1 {status} Synthetic\r\nContent-Type: {}\r\nContent-Length: 2000\r\nLocation: https://wrong.test/\r\n\r\n", contract::MEDIA).unwrap();
            stream.flush().unwrap();
            // No declared body is sent; the adapter must close instead of drain.
            let closed = match stream.read(&mut [0]) {
                Ok(0) => true,
                Err(error) => !matches!(
                    error.kind(),
                    io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
                ),
                _ => false,
            };
            send.send(closed).unwrap();
        });
        let (request, context, _) = parts("initialize-success");
        let mut adapter = transport(server.addr, context.now_ms);
        let result = adapter.exchange_once(&request, &context);
        let expected = if status == 503 {
            TransportError::Unavailable
        } else {
            TransportError::InvalidResponse
        };
        assert_eq!(result.err(), Some(expected), "status {status}");
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
        assert!(received.recv_timeout(Duration::from_secs(2)).unwrap());
        drop(server);
    }
}

#[test]
fn response_header_bytes_and_final_header_count_are_bounded() {
    let (_, _, body) = parts("initialize-success");
    let body = String::from_utf8(body).unwrap();
    assert!(raw_exchange(response(body.as_bytes())).is_ok());
    for extra in [
        format!("X-Large: {}\r\n", "x".repeat(HEADER_BYTES)),
        (0..HEADER_COUNT)
            .map(|index| format!("X-{index}: x\r\n"))
            .collect::<String>(),
    ] {
        let raw = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\n{extra}\r\n{body}",
            contract::MEDIA,
            body.len()
        );
        assert!(raw_exchange(raw.into_bytes()).is_err());
    }
}

#[test]
fn a_dropped_reply_does_not_retry_or_mutate_borrowed_context_or_bytes() {
    let (request, context, _) = parts("enroll-success");
    let expected = contract::encode_request(&request).unwrap();
    let (send, received) = mpsc::sync_channel(1);
    let server = Server::new(move |stream| {
        let (_, body) = read_request(stream).unwrap();
        send.send(body).unwrap();
        stream.sock.shutdown(Shutdown::Both).unwrap();
    });
    let mut adapter = transport(server.addr, context.now_ms);
    assert_eq!(
        adapter.exchange_once(&request, &context).err(),
        Some(TransportError::Uncertain)
    );
    assert_eq!(
        received.recv_timeout(Duration::from_secs(2)).unwrap(),
        expected.as_bytes()
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
    assert_eq!(
        contract::encode_request(&request).unwrap().as_bytes(),
        expected.as_bytes()
    );
    assert!(contract::valid_context(&request, &context));
    drop(server);
}

#[test]
fn acceptance_uses_fresh_wall_time_and_observed_rollback_refuses() {
    for rollback in [false, true] {
        let (request, context, body) = parts("initialize-success");
        let wall = Arc::new(AtomicU64::new(context.now_ms));
        let server_wall = wall.clone();
        let later = if rollback {
            context.now_ms - 1
        } else {
            context.now_ms + 7
        };
        let raw = response(&body);
        let server = Server::new(move |stream| {
            read_request(stream).unwrap();
            server_wall.store(later, Ordering::SeqCst);
            stream.write_all(&raw).unwrap();
            stream.flush().unwrap();
        });
        let mut adapter = transport(server.addr, context.now_ms);
        adapter.fixture.as_mut().unwrap().wall_ms = wall;
        let result = adapter.exchange_once(&request, &context);
        if rollback {
            assert_eq!(result.err(), Some(TransportError::ClockInvalid));
        } else {
            assert_eq!(result.unwrap().observed_at_ms, later);
            assert_eq!(context.now_ms, later - 7);
        }
        drop(server);
    }
}

#[test]
fn confirm_and_namespace_success_expire_by_wall_or_monotonic_time() {
    for (name, earlier_reservation) in [
        ("confirm-success", false),
        ("namespaceForEnrollment-success", false),
        ("namespaceForEnrollment-success", true),
    ] {
        for advance_wall in [false, true] {
            let (request, mut context, mut body) = parts(name);
            let mut expires = context.initialized_expires_at_ms.unwrap();
            if earlier_reservation {
                let mut result = contract::decode_response(&body, &request, &context).unwrap();
                expires -= 10_000;
                context.reservation.as_mut().unwrap().expires_at_ms = expires;
                let Ok(contract::Success::Namespace { reservation, .. }) = &mut result else {
                    panic!("synthetic namespace result");
                };
                reservation.expires_at_ms = expires;
                body = contract::encode_response(&request, &context, &result)
                    .unwrap()
                    .as_bytes()
                    .to_vec();
            }
            context.now_ms = expires - 30;
            let wall = Arc::new(AtomicU64::new(context.now_ms));
            let server_wall = wall.clone();
            let raw = response(&body);
            let server = Server::new(move |stream| {
                read_request(stream).unwrap();
                if advance_wall {
                    server_wall.store(expires, Ordering::SeqCst);
                } else {
                    // Frozen wall time cannot extend eligibility through a read.
                    thread::sleep(Duration::from_millis(60));
                }
                stream.write_all(&raw).unwrap();
                stream.flush().unwrap();
            });
            let mut adapter = transport(server.addr, context.now_ms);
            adapter.fixture.as_mut().unwrap().wall_ms = wall;
            assert_eq!(
                adapter.exchange_once(&request, &context).err(),
                Some(TransportError::InvalidResponse)
            );
            drop(server);
        }
    }
}

#[test]
fn expired_domain_readbacks_remain_observations_after_an_attempt_crosses_expiry() {
    for name in ["confirm-success", "namespaceForEnrollment-success"] {
        let (request, mut context, _) = parts(name);
        let expires = context.initialized_expires_at_ms.unwrap();
        context.now_ms = expires - 30;
        let body =
            contract::encode_response(&request, &context, &Err(contract::DomainError::Expired))
                .unwrap();
        let raw = response(body.as_bytes());
        let wall = Arc::new(AtomicU64::new(context.now_ms));
        let server_wall = wall.clone();
        let server = Server::new(move |stream| {
            read_request(stream).unwrap();
            server_wall.store(expires, Ordering::SeqCst);
            stream.write_all(&raw).unwrap();
            stream.flush().unwrap();
        });
        let mut adapter = transport(server.addr, context.now_ms);
        adapter.fixture.as_mut().unwrap().wall_ms = wall;
        let accepted = adapter.exchange_once(&request, &context).unwrap();
        assert_eq!(accepted.observed_at_ms, expires);
        assert!(matches!(
            accepted.result,
            Err(contract::DomainError::Expired)
        ));
        drop(server);
    }
}

#[test]
fn a_monotonic_regression_or_deadline_cannot_be_clamped_into_acceptance() {
    let start = Observation {
        wall_ms: 100,
        monotonic: Instant::now(),
    };
    let mut attempt = Attempt::new(start, 100, Duration::from_millis(10)).unwrap();
    assert_eq!(
        attempt
            .check(Observation {
                wall_ms: 100,
                monotonic: start
                    .monotonic
                    .checked_sub(Duration::from_millis(1))
                    .unwrap()
            })
            .err(),
        Some(TransportError::ClockInvalid)
    );
    assert_eq!(
        attempt
            .check(Observation {
                wall_ms: 100,
                monotonic: start.monotonic + Duration::from_millis(10)
            })
            .err(),
        Some(TransportError::Uncertain)
    );
    assert!(Attempt::new(start, 101, TOTAL).is_err());
    assert!(Attempt::new(start, 100, Duration::ZERO).is_err());
}

#[test]
fn blocking_body_or_framed_eof_cannot_return_success_after_the_deadline() {
    struct LateRead {
        body_first: bool,
        emitted: bool,
    }
    impl Read for LateRead {
        fn read(&mut self, into: &mut [u8]) -> io::Result<usize> {
            if self.body_first && !self.emitted {
                self.emitted = true;
                into[0] = b'x';
                return Ok(1);
            }
            thread::sleep(Duration::from_millis(30));
            into[0] = b'x';
            Ok(if self.body_first { 0 } else { 1 })
        }
    }
    let (_, context, _) = parts("initialize-success");
    let adapter = transport("127.0.0.1:1".parse().unwrap(), context.now_ms);
    for body_first in [false, true] {
        let mut attempt = Attempt::new(
            adapter.observe().unwrap(),
            context.now_ms,
            Duration::from_millis(10),
        )
        .unwrap();
        assert_eq!(
            adapter
                .read_body(
                    &mut LateRead {
                        body_first,
                        emitted: false
                    },
                    1,
                    &mut attempt
                )
                .err(),
            Some(TransportError::Uncertain)
        );
    }
}

#[test]
fn header_body_and_dribbling_stalls_cannot_restart_the_attempt_budget() {
    for phase in ["header", "body", "dribble"] {
        let (request, context, body) = parts("initialize-success");
        let server = Server::new(move |stream| {
            read_request(stream).unwrap();
            if phase == "header" {
                thread::sleep(Duration::from_millis(250));
                return;
            }
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\n\r\n",
                contract::MEDIA,
                body.len()
            )
            .unwrap();
            stream.flush().unwrap();
            if phase == "body" {
                thread::sleep(Duration::from_millis(250));
                return;
            }
            for byte in body {
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
        let mut adapter = transport(server.addr, context.now_ms);
        adapter.fixture.as_mut().unwrap().budget = Duration::from_millis(100);
        assert_eq!(
            adapter.exchange_once(&request, &context).err(),
            Some(TransportError::Uncertain),
            "phase {phase}"
        );
        drop(server);
    }
}

#[test]
fn complete_message_boundary_closes_without_waiting_for_peer_fin() {
    let (request, context, body) = parts("initialize-success");
    let raw = response(&body);
    let (send, received) = mpsc::sync_channel(1);
    let server = Server::new(move |stream| {
        read_request(stream).unwrap();
        stream.write_all(&raw).unwrap();
        stream.flush().unwrap();
        let closed = match stream.read(&mut [0]) {
            Ok(0) => true,
            Err(error) => !matches!(
                error.kind(),
                io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
            ),
            _ => false,
        };
        send.send(closed).unwrap();
    });
    assert!(transport(server.addr, context.now_ms)
        .exchange_once(&request, &context)
        .is_ok());
    assert!(received.recv_timeout(Duration::from_secs(2)).unwrap());
    drop(server);
}

#[test]
fn production_policy_has_fixed_authority_verified_tls_and_no_ambient_routing() {
    let mut adapter = transport("127.0.0.1:1".parse().unwrap(), 0);
    adapter.fixture = None;
    assert_eq!(adapter.url(), "https://usage.aicharts.io/v1/enrollment");
    assert_eq!(adapter.budget(), TOTAL);
    assert!(adapter.observe().is_ok());
    let agent = adapter.agent(TOTAL);
    let config = agent.config();
    assert!(config.https_only());
    assert!(config.proxy().is_none());
    assert_eq!(config.max_redirects(), 0);
    assert_eq!(config.max_idle_connections(), 0);
    assert_eq!(config.max_idle_connections_per_host(), 0);
    assert_eq!(config.max_response_header_size(), HEADER_BYTES);
    assert!(!config.http_status_as_error());
    assert!(!config.tls_config().disable_verification());
    assert!(config.tls_config().use_sni());
    assert!(matches!(
        config.tls_config().root_certs(),
        RootCerts::WebPki
    ));
}
