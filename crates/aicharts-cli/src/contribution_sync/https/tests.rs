//! Loopback TLS only, using checked-in synthetic credentials and certificates.
use super::*;
use crate::contribution_sync::{
    tests::{batch, committed_reply, direct_bytes, h, progress, reply, status_value},
    Outbox,
};
use rustls::{
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer},
    ServerConfig, ServerConnection, StreamOwned,
};
use std::{
    fs,
    io::{self, Write},
    net::{Shutdown, SocketAddr, TcpListener, TcpStream},
    os::unix::fs::PermissionsExt,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
};
use ureq::{
    http::Uri,
    tls::Certificate,
    unversioned::{
        resolver::{ResolvedSocketAddrs, Resolver},
        transport::NextTimeout,
    },
};
const CA: &[u8] = include_bytes!("../../upload/fixtures/ca.der");
const CERT: &[u8] = include_bytes!("../../upload/fixtures/server.der");
const TLS_KEY: &[u8] = include_bytes!("../../upload/fixtures/server-key.der");
const KEY: [u8; 32] = [0xa4; 32];
const SECRET: [u8; 32] = [0xb3; 32];

pub(super) struct SyntheticAuthority {
    pub(super) binding: Binding,
    allowed: Arc<AtomicBool>,
    checks: Arc<AtomicUsize>,
}
impl SyntheticAuthority {
    pub(super) fn bearer(&self) -> Result<HeaderValue, &'static str> {
        self.checks.fetch_add(1, Ordering::Relaxed);
        if !self.allowed.load(Ordering::Acquire) {
            return Err("attempt_custody");
        }
        super::bearer(&SECRET)
    }
}
#[derive(Debug)]
struct LocalResolver(SocketAddr);
impl Resolver for LocalResolver {
    fn resolve(
        &self,
        uri: &Uri,
        _: &Config,
        _: NextTimeout,
    ) -> Result<ResolvedSocketAddrs, ureq::Error> {
        assert_eq!(uri.scheme_str(), Some("https"));
        assert_eq!(uri.host(), Some("usage.test"));
        let mut result = self.empty();
        result.push(self.0);
        Ok(result)
    }
}
pub(super) struct ClientFixture {
    addr: SocketAddr,
}
impl ClientFixture {
    pub(super) fn agent(&self, remaining: Duration) -> Agent {
        Agent::with_parts(
            configuration(
                remaining,
                RootCerts::Specific(vec![Certificate::from_der(CA)].into()),
            ),
            DefaultConnector::default(),
            LocalResolver(self.addr),
        )
    }
    pub(super) fn url(&self, endpoint: Endpoint) -> String {
        endpoint.url().replace("usage.aicharts.io", "usage.test")
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
        let mut run = Some(run);
        Self::steps(1, move |_, stream| run.take().unwrap()(stream))
    }
    fn steps(count: usize, mut run: impl FnMut(usize, &mut TlsStream) + Send + 'static) -> Self {
        assert!((1..=35).contains(&count));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let socket = Arc::new(Mutex::new(None));
        let stopped = stop.clone();
        let captured = socket.clone();
        let worker = thread::spawn(move || {
            let until = Instant::now() + Duration::from_secs(10);
            for index in 0..count {
                let stream = loop {
                    if stopped.load(Ordering::Acquire) || Instant::now() >= until {
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
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                *captured.lock().unwrap() = Some(stream.try_clone().unwrap());
                let config = ServerConfig::builder_with_provider(Arc::new(
                    rustls::crypto::ring::default_provider(),
                ))
                .with_safe_default_protocol_versions()
                .unwrap()
                .with_no_client_auth()
                .with_single_cert(
                    vec![CertificateDer::from(CERT.to_vec())],
                    PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(TLS_KEY.to_vec())),
                )
                .unwrap();
                let mut stream =
                    StreamOwned::new(ServerConnection::new(Arc::new(config)).unwrap(), stream);
                run(index, &mut stream);
                captured.lock().unwrap().take();
            }
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
fn request(stream: &mut TlsStream) -> (String, Vec<u8>) {
    let mut headers = Vec::new();
    while !headers.ends_with(b"\r\n\r\n") {
        assert!(headers.len() < 16_384);
        let mut byte = [0];
        stream.read_exact(&mut byte).unwrap();
        headers.push(byte[0]);
    }
    let headers = String::from_utf8(headers).unwrap();
    let length: usize = headers
        .lines()
        .find_map(|line| {
            line.split_once(':')
                .filter(|(key, _)| key.eq_ignore_ascii_case("content-length"))
                .map(|(_, value)| value.trim().parse().unwrap())
        })
        .unwrap();
    assert!(length <= CANCEL_BYTES);
    let mut bytes = vec![0; length];
    stream.read_exact(&mut bytes).unwrap();
    (headers, bytes)
}
fn respond(stream: &mut TlsStream, bytes: &[u8]) {
    respond_status(stream, 200, bytes);
}
fn respond_status(stream: &mut TlsStream, status: u16, bytes: &[u8]) {
    let headers = format!("HTTP/1.1 {status} OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len());
    stream.write_all(headers.as_bytes()).unwrap();
    stream.write_all(bytes).unwrap();
    stream.flush().unwrap();
}
fn transport(addr: SocketAddr, batch: &PreparedBatch) -> Transport {
    Transport {
        authority: Authority::Synthetic(SyntheticAuthority {
            binding: Binding::from_scope(&batch.scope()),
            allowed: Arc::new(AtomicBool::new(true)),
            checks: Arc::new(AtomicUsize::new(0)),
        }),
        exchanges: Cell::new(0),
        fixture: Some(ClientFixture { addr }),
    }
}
static SERIAL: AtomicU64 = AtomicU64::new(0);
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn scratch() -> Scratch {
    let path = fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "aicharts-contribution-https-{}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        ));
    fs::create_dir(&path).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
    Scratch(path)
}
fn frozen(path: &Path, original: &PreparedBatch) -> Outbox {
    let binding = Binding::from_scope(&original.scope());
    let mut outbox = Outbox::initialize(path, &KEY, &binding, &progress(original)).unwrap();
    outbox
        .freeze(&binding, original, &progress(original))
        .unwrap();
    outbox
}

#[test]
fn framing_caps_and_request_routes_are_exact() {
    assert_eq!(CANCEL_BYTES, MAX_BATCH_BYTES + 512);
    assert_eq!(Endpoint::Heads.response_cap(), 524_288);
    assert_eq!(Endpoint::Upload.request_cap(), 1_048_576);
    let mut headers = HeaderMap::new();
    headers.insert(
        "content-type",
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
    for cap in [MAX_TERMINAL_BYTES, MAX_REPLY_BYTES] {
        headers.insert(
            "content-length",
            HeaderValue::from_str(&cap.to_string()).unwrap(),
        );
        assert_eq!(framing(&headers, cap), Ok(cap));
        headers.insert(
            "content-length",
            HeaderValue::from_str(&(cap + 1).to_string()).unwrap(),
        );
        assert!(framing(&headers, cap).is_err());
    }
    headers.insert("content-length", HeaderValue::from_static("128"));
    for forbidden in [
        "transfer-encoding",
        "content-encoding",
        "location",
        "set-cookie",
        "trailer",
        "upgrade",
    ] {
        let mut changed = headers.clone();
        changed.insert(forbidden, HeaderValue::from_static("x"));
        assert!(framing(&changed, MAX_TERMINAL_BYTES).is_err());
    }
    for length in ["0", "0128", "+128", "128 ", "1000000"] {
        let mut changed = headers.clone();
        changed.insert("content-length", HeaderValue::from_str(length).unwrap());
        assert!(framing(&changed, MAX_REPLY_BYTES).is_err());
    }
    headers.append("content-length", HeaderValue::from_static("128"));
    assert!(framing(&headers, MAX_REPLY_BYTES).is_err());
}
#[test]
fn fresh_authority_expiry_and_exchange_limit_refuse_before_network_or_state_mutation() {
    let batch = batch(1, 12, 4);
    let path = scratch();
    let mut outbox = frozen(&path.0, &batch);
    let transport = transport("127.0.0.1:9".parse().unwrap(), &batch);
    let Authority::Synthetic(authority) = &transport.authority else {
        unreachable!()
    };
    let before = fs::read(path.0.join("contribution-sync-v3.current")).unwrap();
    authority.allowed.store(false, Ordering::Release);
    let flight = outbox
        .flight(transport.binding(), &progress(&batch))
        .unwrap();
    assert_eq!(
        transport
            .dispatch(&flight, &Deadline::command().unwrap())
            .err(),
        Some("attempt_custody")
    );
    authority.allowed.store(true, Ordering::Release);
    assert_eq!(
        transport
            .dispatch(
                &flight,
                &Deadline {
                    end: Instant::now()
                }
            )
            .err(),
        Some(UNCERTAIN)
    );
    transport.exchanges.set(MAX_EXCHANGES);
    assert_eq!(
        transport
            .dispatch(&flight, &Deadline::command().unwrap())
            .err(),
        Some("contribution_sync_exchange_limit")
    );
    assert_eq!(authority.checks.load(Ordering::Relaxed), 1);
    assert_eq!(
        fs::read(path.0.join("contribution-sync-v3.current")).unwrap(),
        before
    );
}
#[test]
fn tls_upload_dispatches_only_exact_durable_bytes_and_correlates_original_direct_reply() {
    let original = batch(1, 12, 4);
    let expected = original.bytes().to_vec();
    let terminal = direct_bytes(&committed_reply(&original));
    let retained = terminal.clone();
    let server = Server::new(move |stream| {
        let (headers, body) = request(stream);
        assert!(headers.starts_with("POST /v3/contributions HTTP/1.1"));
        assert_eq!(body, expected);
        respond(stream, &terminal);
    });
    let path = scratch();
    let mut outbox = frozen(&path.0, &original);
    let transport = transport(server.addr, &original);
    let terminal = {
        let flight = outbox
            .flight(transport.binding(), &progress(&original))
            .unwrap();
        transport
            .dispatch(&flight, &Deadline::command().unwrap())
            .unwrap()
    };
    assert_eq!(
        terminal.proof,
        TerminalProof::Direct(STANDARD.encode(&retained))
    );
    outbox.settle(transport.binding(), &terminal).unwrap();
    assert_eq!(outbox.checkpoint.last_sequence, 1);
}
#[test]
fn persisted_cancellation_controls_the_endpoint_and_keeps_the_original_batch() {
    let original = batch(1, 12, 4);
    let expected = original.bytes().to_vec();
    let terminal = direct_bytes(&reply(&original, 14));
    let server = Server::new(move |stream| {
        let (headers, body) = request(stream);
        assert!(headers.starts_with("POST /v3/contributions/cancel HTTP/1.1"));
        assert!(body.ends_with(&[expected.as_slice(), b"}"].concat()));
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap()["expectedRevision"],
            13
        );
        respond(stream, &terminal);
    });
    let path = scratch();
    let mut outbox = frozen(&path.0, &original);
    let binding = Binding::from_scope(&original.scope());
    let mut observed = progress(&original);
    observed.revision = 13;
    outbox.cancel(&binding, &observed).unwrap();
    drop(outbox);
    let mut outbox = Outbox::recover(&path.0, &KEY, &binding).unwrap();
    let transport = transport(server.addr, &original);
    let terminal = {
        let flight = outbox.flight(&binding, &observed).unwrap();
        transport
            .dispatch(&flight, &Deadline::command().unwrap())
            .unwrap()
    };
    outbox.settle(&binding, &terminal).unwrap();
    assert_eq!(outbox.checkpoint.last_sequence, 1);
}
#[test]
fn lost_upload_reply_is_retained_then_exact_status_terminal_retires_without_writer_dispatch() {
    let original = batch(1, 12, 4);
    let expected = original.bytes().to_vec();
    let lost = Server::new(move |stream| {
        let (_, body) = request(stream);
        assert_eq!(body, expected);
    });
    let path = scratch();
    let mut outbox = frozen(&path.0, &original);
    let first = transport(lost.addr, &original);
    {
        let flight = outbox
            .flight(first.binding(), &progress(&original))
            .unwrap();
        assert!(first
            .dispatch(&flight, &Deadline::command().unwrap())
            .is_err());
    }
    assert!(outbox.checkpoint.flight.is_some());
    drop(outbox);
    drop(lost);
    let mut value = status_value(&original, Some("committed"), 14, 2);
    value["result"]["value"]["population"]["deviceId"] = serde_json::json!(h(99));
    value["result"]["value"]["population"]["writerRevision"] = serde_json::json!(2);
    let mut raw = serde_json::to_vec(&value).unwrap();
    raw.resize(MAX_TERMINAL_BYTES, b' ');
    let expected = raw.clone();
    let status = Server::new(move |stream| {
        let (headers, _) = request(stream);
        assert!(headers.starts_with("POST /v3/contributions/status HTTP/1.1"));
        respond(stream, &raw);
    });
    let transport = transport(status.addr, &original);
    let mut outbox = Outbox::recover(&path.0, &KEY, transport.binding()).unwrap();
    let result = crate::contribution_sync::command::recover_action(
        &mut outbox,
        &transport,
        &Deadline::command().unwrap(),
        false,
    )
    .unwrap();
    assert!(result.contains("settled"));
    assert_eq!(transport.exchanges.get(), 1);
    assert!(outbox.checkpoint.flight.is_none());
    assert_eq!(
        outbox.checkpoint.terminal.as_ref().unwrap().proof,
        TerminalProof::Status(STANDARD.encode(expected))
    );
    drop(outbox);
    let recovered = Outbox::recover(&path.0, &KEY, transport.binding()).unwrap();
    assert_eq!(recovered.checkpoint.last_sequence, 1);
}
#[test]
fn maximum_head_reply_uses_the_separate_bound_and_strict_core_correlation() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../fixtures/usage/contribution-producer-v3.json"
    ))
    .unwrap();
    let key_text = fixture["syntheticKeyHex"].as_str().unwrap();
    let mut key = [0u8; 32];
    for (i, byte) in key.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&key_text[i * 2..i * 2 + 2], 16).unwrap();
    }
    let source = fixture["sourceLines"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let original = batch(1, 12, 4);
    let observations =
        NativeObservations::read_claude(source.as_bytes(), original.scope().account_id(), &key)
            .unwrap();
    let query = observations
        .head_query(&original.scope(), 12, 0)
        .unwrap()
        .unwrap();
    let expected = query.bytes().to_vec();
    let mut bytes = fixture["headReplyText"]
        .as_str()
        .unwrap()
        .as_bytes()
        .to_vec();
    bytes.resize(MAX_REPLY_BYTES, b' ');
    let server = Server::new(move |stream| {
        let (headers, body) = request(stream);
        assert!(headers.starts_with("POST /v3/contributions/heads HTTP/1.1"));
        assert_eq!(body, expected);
        respond(stream, &bytes);
    });
    let transport = transport(server.addr, &original);
    assert!(transport
        .heads(&query, &Deadline::command().unwrap())
        .unwrap()
        .prepare(&h(400), 1)
        .unwrap()
        .is_some());
}
#[test]
fn malformed_redirected_truncated_and_oversized_tls_replies_keep_frozen_state() {
    let original = batch(1, 12, 4);
    let path = scratch();
    let mut outbox = frozen(&path.0, &original);
    let before = fs::read(path.0.join("contribution-sync-v3.current")).unwrap();
    for headers in [
        "HTTP/1.1 302 Found\r\nLocation: https://invalid.example/\r\nContent-Length: 1\r\n\r\nx",
        "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 4097\r\n\r\nx",
        "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 10\r\n\r\n{}",
        "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n",
    ] {
        let server = Server::new(move |stream| { request(stream); let _ = stream.write_all(headers.as_bytes()); let _ = stream.flush(); });
        let transport = transport(server.addr, &original); let flight = outbox.flight(transport.binding(), &progress(&original)).unwrap();
        assert!(transport.dispatch(&flight, &Deadline::command().unwrap()).is_err());
        assert_eq!(fs::read(path.0.join("contribution-sync-v3.current")).unwrap(), before);
    }
}

fn observations() -> (serde_json::Value, NativeObservations) {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../fixtures/usage/contribution-producer-v3.json"
    ))
    .unwrap();
    let source = fixture["sourceLines"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let observations = NativeObservations::read_claude(
        source.as_bytes(),
        batch(1, 12, 4).scope().account_id(),
        &[0x43; 32],
    )
    .unwrap();
    (fixture, observations)
}

#[test]
fn command_send_revalidates_position_and_persists_exact_bytes_before_single_upload() {
    use sha2::{Digest, Sha256};
    for drift in [false, true] {
        let original = batch(1, 12, 4);
        let (fixture, observations) = observations();
        let initial = serde_json::to_vec(&status_value(&original, None, 12, 1)).unwrap();
        let final_status = serde_json::to_vec(&status_value(
            &original,
            None,
            if drift { 13 } else { 12 },
            1,
        ))
        .unwrap();
        let heads = fixture["headReplyText"]
            .as_str()
            .unwrap()
            .as_bytes()
            .to_vec();
        let path = scratch();
        let checkpoint_path = path.0.join("contribution-sync-v3.current");
        let scope = original.scope();
        let server = Server::steps(if drift { 3 } else { 4 }, move |index, stream| {
            let (headers, body) = request(stream);
            match index {
                0 => {
                    assert!(headers.starts_with("POST /v3/contributions/status HTTP/1.1"));
                    respond(stream, &initial);
                }
                1 => {
                    assert!(headers.starts_with("POST /v3/contributions/heads HTTP/1.1"));
                    respond(stream, &heads);
                }
                2 => {
                    assert!(headers.starts_with("POST /v3/contributions/status HTTP/1.1"));
                    respond(stream, &final_status);
                }
                3 => {
                    assert!(headers.starts_with("POST /v3/contributions HTTP/1.1"));
                    let checkpoint: serde_json::Value =
                        serde_json::from_slice(&fs::read(&checkpoint_path).unwrap()).unwrap();
                    assert_eq!(
                        STANDARD
                            .decode(
                                checkpoint["payload"]["flight"]["body"]["bytes"]
                                    .as_str()
                                    .unwrap()
                            )
                            .unwrap(),
                        body
                    );
                    let frozen = PreparedBatch::reopen(
                        &scope,
                        &body,
                        &format!("{:x}", Sha256::digest(&body)),
                    )
                    .unwrap();
                    assert_eq!(frozen.sequence(), 1);
                    respond(stream, &direct_bytes(&committed_reply(&frozen)));
                }
                _ => unreachable!(),
            }
        });
        let transport = transport(server.addr, &original);
        let mut outbox =
            Outbox::initialize(&path.0, &KEY, transport.binding(), &progress(&original)).unwrap();
        let before = fs::read(path.0.join("contribution-sync-v3.current")).unwrap();
        let result = crate::contribution_sync::command::send(
            &mut outbox,
            &transport,
            &Deadline::command().unwrap(),
            original.scope().population_id(),
            &observations,
        );
        if drift {
            assert_eq!(result.err(), Some(crate::contribution_sync::CONFLICT));
            assert_eq!(
                fs::read(path.0.join("contribution-sync-v3.current")).unwrap(),
                before
            );
            assert_eq!(transport.exchanges.get(), 3);
        } else {
            assert!(result.unwrap().contains("settled"));
            assert_eq!(outbox.checkpoint.last_sequence, 1);
            assert_eq!(outbox.checkpoint.last_revision, 13);
            assert!(outbox.checkpoint.flight.is_none());
            assert_eq!(transport.exchanges.get(), 4);
        }
    }
}

#[test]
fn matching_selection_checks_final_snapshot_and_reports_its_revision_without_writing() {
    use serde_json::json;
    for drift in [false, true] {
        let original = batch(1, 12, 4);
        let (fixture, observations) = observations();
        let mut heads: serde_json::Value =
            serde_json::from_str(fixture["headReplyText"].as_str().unwrap()).unwrap();
        for (index, entry) in heads["result"]["value"]["entries"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .enumerate()
        {
            let id = entry["id"].clone();
            let payload = fixture["payloadHashes"][index].clone();
            *entry = json!({"id":id,"membershipHeadHash":h(50),"head":{"id":id,"headHash":h(50),"payloadHash":payload,
                "reference":{"kind":"batch-v3","bodyHash":h(51),"index":index,"payloadHash":payload},
                "deleted":false,"members":1,"legacySupport":false,"suppressedLegacy":false}});
        }
        heads["result"]["value"]["population"]["memberCount"] = json!(2);
        heads["result"]["value"]["population"]["revision"] = json!(1);
        heads["result"]["value"]["population"]["headHash"] = json!(h(52));
        let mut status = status_value(&original, None, 12, 1);
        status["result"]["value"]["population"] = heads["result"]["value"]["population"].clone();
        let initial = serde_json::to_vec(&status).unwrap();
        if drift {
            status["result"]["value"]["revision"] = json!(13);
        }
        let final_status = serde_json::to_vec(&status).unwrap();
        let heads = serde_json::to_vec(&heads).unwrap();
        let server = Server::steps(3, move |index, stream| {
            let (headers, _) = request(stream);
            match index {
                0 => {
                    assert!(headers.starts_with("POST /v3/contributions/status HTTP/1.1"));
                    respond(stream, &initial);
                }
                1 => {
                    assert!(headers.starts_with("POST /v3/contributions/heads HTTP/1.1"));
                    respond(stream, &heads);
                }
                2 => {
                    assert!(headers.starts_with("POST /v3/contributions/status HTTP/1.1"));
                    respond(stream, &final_status);
                }
                _ => unreachable!(),
            }
        });
        let path = scratch();
        let transport = transport(server.addr, &original);
        let mut outbox =
            Outbox::initialize(&path.0, &KEY, transport.binding(), &progress(&original)).unwrap();
        let before = fs::read(path.0.join("contribution-sync-v3.current")).unwrap();
        let result = crate::contribution_sync::command::send(
            &mut outbox,
            &transport,
            &Deadline::command().unwrap(),
            original.scope().population_id(),
            &observations,
        );
        if drift {
            assert_eq!(result.err(), Some(crate::contribution_sync::CONFLICT));
        } else {
            let result: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
            assert_eq!(result["status"], "selected_observations_match");
            assert_eq!(result["canonicalRevision"], 12);
            assert_eq!(result["coverage"], "partial");
            assert_eq!(result["observations"], 2);
        }
        assert_eq!(transport.exchanges.get(), 3);
        assert_eq!(
            fs::read(path.0.join("contribution-sync-v3.current")).unwrap(),
            before
        );
    }
}

#[test]
fn drain_continues_after_a_committed_batch_and_stops_on_match_abandonment_or_limit() {
    use serde_json::json;
    use sha2::{Digest, Sha256};
    for committed in [true, false] {
        let original = batch(1, 12, 4);
        let (fixture, observations) = observations();
        let initial = serde_json::to_vec(&status_value(&original, None, 12, 1)).unwrap();
        let first_heads = fixture["headReplyText"]
            .as_str()
            .unwrap()
            .as_bytes()
            .to_vec();
        let mut matched: serde_json::Value =
            serde_json::from_str(fixture["headReplyText"].as_str().unwrap()).unwrap();
        for (index, entry) in matched["result"]["value"]["entries"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .enumerate()
        {
            let id = entry["id"].clone();
            let payload = fixture["payloadHashes"][index].clone();
            *entry = json!({"id":id,"membershipHeadHash":h(50),"head":{"id":id,"headHash":h(50),"payloadHash":payload,
                "reference":{"kind":"batch-v3","bodyHash":h(51),"index":index,"payloadHash":payload},
                "deleted":false,"members":1,"legacySupport":false,"suppressedLegacy":false}});
        }
        matched["result"]["value"]["revision"] = json!(13);
        matched["result"]["value"]["population"]["memberCount"] = json!(2);
        matched["result"]["value"]["population"]["revision"] = json!(1);
        let committed_head = Arc::new(Mutex::new(String::new()));
        let head_slot = committed_head.clone();
        let scope = original.scope();
        let mut next_status = status_value(&original, None, 13, 2);
        next_status["result"]["value"]["population"]["revision"] = json!(1);
        next_status["result"]["value"]["population"]["memberCount"] = json!(2);
        let server = Server::steps(if committed { 7 } else { 4 }, move |index, stream| {
            let (headers, body) = request(stream);
            match index {
                0 | 2 => {
                    assert!(headers.starts_with("POST /v3/contributions/status HTTP/1.1"));
                    respond(stream, &initial);
                }
                1 => {
                    assert!(headers.starts_with("POST /v3/contributions/heads HTTP/1.1"));
                    respond(stream, &first_heads);
                }
                3 => {
                    assert!(headers.starts_with("POST /v3/contributions HTTP/1.1"));
                    let frozen = PreparedBatch::reopen(
                        &scope,
                        &body,
                        &format!("{:x}", Sha256::digest(&body)),
                    )
                    .unwrap();
                    assert_eq!(frozen.sequence(), 1);
                    if committed {
                        let terminal = committed_reply(&frozen);
                        let value: serde_json::Value =
                            serde_json::from_slice(&direct_bytes(&terminal)).unwrap();
                        *head_slot.lock().unwrap() = value["result"]["value"]["receipt"]
                            ["populationHead"]
                            .as_str()
                            .unwrap()
                            .to_owned();
                        respond(stream, &direct_bytes(&terminal));
                    } else {
                        respond(stream, &direct_bytes(&reply(&frozen, 13)));
                    }
                }
                4 | 6 => {
                    assert!(headers.starts_with("POST /v3/contributions/status HTTP/1.1"));
                    let mut status = next_status.clone();
                    status["result"]["value"]["population"]["headHash"] =
                        json!(head_slot.lock().unwrap().clone());
                    respond(stream, &serde_json::to_vec(&status).unwrap());
                }
                5 => {
                    assert!(headers.starts_with("POST /v3/contributions/heads HTTP/1.1"));
                    let mut heads = matched.clone();
                    heads["result"]["value"]["population"]["headHash"] =
                        json!(head_slot.lock().unwrap().clone());
                    respond(stream, &serde_json::to_vec(&heads).unwrap());
                }
                _ => unreachable!(),
            }
        });
        let path = scratch();
        let transport = transport(server.addr, &original);
        let mut outbox =
            Outbox::initialize(&path.0, &KEY, transport.binding(), &progress(&original)).unwrap();
        let result = crate::contribution_sync::command::drain(
            &mut outbox,
            &transport,
            &Deadline::command().unwrap(),
            original.scope().population_id(),
            &observations,
            3,
        )
        .unwrap();
        let result: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(result["quarantined"], 0);
        let batches = result["batches"].as_array().unwrap();
        assert_eq!(batches[0]["status"], "settled");
        assert_eq!(batches[0]["sequence"], 1);
        if committed {
            assert_eq!(result["status"], "drained");
            assert_eq!(batches.len(), 2);
            assert_eq!(batches[0]["outcome"], "committed");
            assert_eq!(batches[1]["status"], "selected_observations_match");
            assert_eq!(batches[1]["canonicalRevision"], 13);
            assert_eq!(transport.exchanges.get(), 7);
        } else {
            assert_eq!(result["status"], "stopped");
            assert_eq!(batches.len(), 1);
            assert_eq!(batches[0]["outcome"], "abandoned");
            assert_eq!(transport.exchanges.get(), 4);
        }
        assert_eq!(outbox.checkpoint.last_sequence, 1);
        assert_eq!(outbox.checkpoint.last_revision, 13);
        assert!(outbox.checkpoint.flight.is_none());
    }
    // Out-of-range draining refuses before any exchange or state read.
    let original = batch(1, 12, 4);
    let (_, observations) = observations();
    let path = scratch();
    let server = Server::new(|_| {});
    let transport = transport(server.addr, &original);
    let mut outbox =
        Outbox::initialize(&path.0, &KEY, transport.binding(), &progress(&original)).unwrap();
    for limit in [0, 9] {
        assert_eq!(
            crate::contribution_sync::command::drain(
                &mut outbox,
                &transport,
                &Deadline::command().unwrap(),
                original.scope().population_id(),
                &observations,
                limit,
            )
            .err(),
            Some("invalid_option")
        );
    }
    assert_eq!(transport.exchanges.get(), 0);
}

#[test]
fn failed_initial_cancel_status_remains_cancel_only_after_restart() {
    let original = batch(1, 12, 4);
    let expected = original.bytes().to_vec();
    let path = scratch();
    let mut outbox = frozen(&path.0, &original);
    let checkpoint_path = path.0.join("contribution-sync-v3.current");
    let lost = Server::new(move |stream| {
        let (headers, _) = request(stream);
        assert!(headers.starts_with("POST /v3/contributions/status HTTP/1.1"));
        let checkpoint: serde_json::Value =
            serde_json::from_slice(&fs::read(&checkpoint_path).unwrap()).unwrap();
        assert_eq!(checkpoint["payload"]["flight"]["action"]["kind"], "cancel");
        assert_eq!(
            checkpoint["payload"]["flight"]["action"]["expectedRevision"],
            12
        );
        assert_eq!(
            STANDARD
                .decode(
                    checkpoint["payload"]["flight"]["body"]["bytes"]
                        .as_str()
                        .unwrap()
                )
                .unwrap(),
            expected
        );
        // The connection closes after accepting status, without a response.
    });
    let first = transport(lost.addr, &original);
    assert!(crate::contribution_sync::command::recover_action(
        &mut outbox,
        &first,
        &Deadline::command().unwrap(),
        true,
    )
    .is_err());
    assert_eq!(first.exchanges.get(), 1);
    assert_eq!(
        outbox.checkpoint.flight.as_ref().unwrap().action,
        Action::Cancel {
            expected_revision: 12
        }
    );
    drop(outbox);
    drop(lost);

    let status = serde_json::to_vec(&status_value(&original, None, 12, 1)).unwrap();
    let terminal = direct_bytes(&reply(&original, 13));
    let expected = original.bytes().to_vec();
    let resumed = Server::steps(2, move |index, stream| {
        let (headers, body) = request(stream);
        if index == 0 {
            assert!(headers.starts_with("POST /v3/contributions/status HTTP/1.1"));
            respond(stream, &status);
        } else {
            assert!(headers.starts_with("POST /v3/contributions/cancel HTTP/1.1"));
            assert!(body.ends_with(&[expected.as_slice(), b"}"].concat()));
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&body).unwrap()["expectedRevision"],
                12
            );
            respond(stream, &terminal);
        }
    });
    let resumed_transport = transport(resumed.addr, &original);
    let mut outbox = Outbox::recover(&path.0, &KEY, resumed_transport.binding()).unwrap();
    let result = crate::contribution_sync::command::recover_action(
        &mut outbox,
        &resumed_transport,
        &Deadline::command().unwrap(),
        false,
    )
    .unwrap();
    let result: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(result["outcome"], "abandoned");
    assert_eq!(resumed_transport.exchanges.get(), 2);
    assert!(outbox.checkpoint.flight.is_none());
}

#[test]
fn cancellation_intent_publication_failures_prevent_every_network_exchange() {
    use crate::contribution_sync::disk::Step;
    for point in [
        Step::StageCreated,
        Step::StageWritten,
        Step::StageSynced,
        Step::StageRenamed,
        Step::DirectorySynced,
        Step::CurrentReadBack,
    ] {
        let original = batch(1, 12, 4);
        let path = scratch();
        let mut outbox = frozen(&path.0, &original);
        let transport = transport("127.0.0.1:9".parse().unwrap(), &original);
        outbox.disk.fail_at(point);
        assert!(crate::contribution_sync::command::recover_action(
            &mut outbox,
            &transport,
            &Deadline::command().unwrap(),
            true,
        )
        .is_err());
        assert_eq!(transport.exchanges.get(), 0, "{point:?}");
        let Authority::Synthetic(authority) = &transport.authority else {
            unreachable!()
        };
        assert_eq!(authority.checks.load(Ordering::Relaxed), 0, "{point:?}");
        assert!(outbox
            .flight(transport.binding(), &progress(&original))
            .is_err());
        drop(outbox);
        let recovered = Outbox::recover(&path.0, &KEY, transport.binding());
        if point == Step::StageCreated {
            assert!(recovered.is_err());
        } else {
            let recovered = recovered.unwrap();
            let retained = recovered.checkpoint.flight.as_ref().unwrap();
            assert_eq!(
                retained.action,
                Action::Cancel {
                    expected_revision: 12
                },
                "{point:?}"
            );
            assert_eq!(retained.body.reopen().unwrap().bytes(), original.bytes());
        }
    }
}

#[test]
fn cancellation_intent_still_settles_an_already_committed_status_without_dispatch() {
    let original = batch(1, 12, 4);
    let path = scratch();
    let mut outbox = frozen(&path.0, &original);
    let checkpoint_path = path.0.join("contribution-sync-v3.current");
    let terminal = serde_json::to_vec(&status_value(&original, Some("committed"), 13, 2)).unwrap();
    let server = Server::new(move |stream| {
        let (headers, _) = request(stream);
        assert!(headers.starts_with("POST /v3/contributions/status HTTP/1.1"));
        let checkpoint: serde_json::Value =
            serde_json::from_slice(&fs::read(&checkpoint_path).unwrap()).unwrap();
        assert_eq!(checkpoint["payload"]["flight"]["action"]["kind"], "cancel");
        respond(stream, &terminal);
    });
    let transport = transport(server.addr, &original);
    let result = crate::contribution_sync::command::recover_action(
        &mut outbox,
        &transport,
        &Deadline::command().unwrap(),
        true,
    )
    .unwrap();
    let result: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(result["outcome"], "committed");
    assert_eq!(result["terminalRevision"], 13);
    assert_eq!(transport.exchanges.get(), 1);
    assert!(outbox.checkpoint.flight.is_none());
    assert_eq!(
        outbox.checkpoint.terminal.as_ref().unwrap().flight.action,
        Action::Cancel {
            expected_revision: 12
        }
    );
    drop(outbox);
    let recovered = Outbox::recover(&path.0, &KEY, transport.binding()).unwrap();
    assert_eq!(recovered.checkpoint.last_sequence, 1);
    assert!(recovered.checkpoint.flight.is_none());
}

#[test]
fn command_resume_keeps_durable_cancel_when_status_has_no_terminal() {
    let original = batch(1, 12, 4);
    let status = serde_json::to_vec(&status_value(&original, None, 13, 1)).unwrap();
    let terminal = direct_bytes(&reply(&original, 14));
    let expected = original.bytes().to_vec();
    let server = Server::steps(2, move |index, stream| {
        let (headers, body) = request(stream);
        if index == 0 {
            assert!(headers.starts_with("POST /v3/contributions/status HTTP/1.1"));
            respond(stream, &status);
        } else {
            assert!(headers.starts_with("POST /v3/contributions/cancel HTTP/1.1"));
            assert!(body.ends_with(&[expected.as_slice(), b"}"].concat()));
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&body).unwrap()["expectedRevision"],
                13
            );
            respond(stream, &terminal);
        }
    });
    let path = scratch();
    let mut outbox = frozen(&path.0, &original);
    let transport = transport(server.addr, &original);
    let mut observed = progress(&original);
    observed.revision = 13;
    outbox.cancel(transport.binding(), &observed).unwrap();
    drop(outbox);
    let mut outbox = Outbox::recover(&path.0, &KEY, transport.binding()).unwrap();
    let result = crate::contribution_sync::command::recover_action(
        &mut outbox,
        &transport,
        &Deadline::command().unwrap(),
        false,
    )
    .unwrap();
    assert!(result.contains("settled"));
    assert!(outbox.checkpoint.flight.is_none());
    assert!(matches!(
        outbox.checkpoint.terminal.as_ref().unwrap().flight.action,
        Action::Cancel {
            expected_revision: 13
        }
    ));
    assert_eq!(transport.exchanges.get(), 2);
}

#[test]
fn idle_resume_is_observational_and_missing_terminal_after_writer_change_keeps_flight() {
    let original = batch(1, 12, 4);
    let path = scratch();
    let idle = transport("127.0.0.1:9".parse().unwrap(), &original);
    let mut outbox =
        Outbox::initialize(&path.0, &KEY, idle.binding(), &progress(&original)).unwrap();
    let before = fs::read(path.0.join("contribution-sync-v3.current")).unwrap();
    let result = crate::contribution_sync::command::recover_action(
        &mut outbox,
        &idle,
        &Deadline::command().unwrap(),
        false,
    )
    .unwrap();
    assert!(result.contains("no_pending_flight"));
    assert!(result.contains("not_observed"));
    assert_eq!(idle.exchanges.get(), 0);
    assert_eq!(
        fs::read(path.0.join("contribution-sync-v3.current")).unwrap(),
        before
    );
    outbox
        .freeze(idle.binding(), &original, &progress(&original))
        .unwrap();
    let before = fs::read(path.0.join("contribution-sync-v3.current")).unwrap();
    let mut status = status_value(&original, None, 13, 1);
    status["result"]["value"]["population"]["deviceId"] = serde_json::json!(h(100));
    let server = Server::new(move |stream| {
        request(stream);
        respond(stream, &serde_json::to_vec(&status).unwrap());
    });
    let transport = transport(server.addr, &original);
    assert_eq!(
        crate::contribution_sync::command::recover_action(
            &mut outbox,
            &transport,
            &Deadline::command().unwrap(),
            false
        )
        .err(),
        Some("contribution_sync_writer_conflict")
    );
    assert_eq!(transport.exchanges.get(), 1);
    assert_eq!(
        fs::read(path.0.join("contribution-sync-v3.current")).unwrap(),
        before
    );
}

// -- account control ops (activate / migrate / grant / status) ---------------
fn ops_binding() -> Binding {
    Binding::new(
        &format!("acct_{}", "a".repeat(32)),
        &"b".repeat(64),
        &"c".repeat(64),
    )
    .unwrap()
}
fn ops_transport(addr: SocketAddr) -> Transport {
    Transport {
        authority: Authority::Synthetic(SyntheticAuthority {
            binding: ops_binding(),
            allowed: Arc::new(AtomicBool::new(true)),
            checks: Arc::new(AtomicUsize::new(0)),
        }),
        exchanges: Cell::new(0),
        fixture: Some(ClientFixture { addr }),
    }
}
fn envelope(value: serde_json::Value) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "schemaVersion": 3, "result": { "ok": true, "value": value } }))
    .unwrap()
}
fn status_reply(
    revision: u64,
    phase: &str,
    migrated: bool,
    population: Option<serde_json::Value>,
) -> Vec<u8> {
    let binding = ops_binding();
    envelope(serde_json::json!({
        "schemaVersion": 3, "accountId": binding.account_id, "generation": binding.generation,
        "revision": revision, "nextSequence": 1, "phase": phase,
        "activationHash": if phase == "active" { serde_json::Value::String("5".repeat(64)) } else { serde_json::Value::Null },
        "migrationManifestHash": if migrated { serde_json::Value::String("6".repeat(64)) } else { serde_json::Value::Null },
        "population": population, "operation": null, "legacyResolution": "not_evaluated" }))
}
fn population_view(population: &str, revision: u64) -> serde_json::Value {
    let binding = ops_binding();
    serde_json::json!({ "id": population, "generation": binding.generation,
        "deviceId": binding.device_id, "writerRevision": 1, "revision": revision,
        "headHash": if revision == 0 { "0".repeat(64) } else { "7".repeat(64) }, "memberCount": 0 })
}
#[test]
fn activate_on_unstarted_account_persists_then_dispatches_exact_bytes() {
    let dir = scratch();
    let first = Arc::new(Mutex::new(Vec::new()));
    let captured = first.clone();
    let _server = Server::steps(2, move |index, stream| {
        let (_headers, body) = request(stream);
        captured.lock().unwrap().push(body.clone());
        if index == 0 {
            // Status: no contribution control yet.
            respond_status(
                stream,
                409,
                &serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 3, "result": { "ok": false, "error": "not_started" } }))
                .unwrap(),
            );
        } else {
            // Activate: reply the exact receipt for the received request.
            let request: serde_json::Value = serde_json::from_slice(&body).unwrap();
            let mut receipt = request.clone();
            receipt
                .as_object_mut()
                .unwrap()
                .insert("bodyHash".into(), "8".repeat(64).into());
            receipt
                .as_object_mut()
                .unwrap()
                .insert("revision".into(), 1.into());
            respond(stream, &envelope(receipt));
        }
    });
    let transport = ops_transport(_server.addr);
    let deadline = Deadline::command().unwrap();
    let out = super::super::ops::activate(&dir.0, &KEY, &transport, &deadline).unwrap();
    assert!(out.contains("\"activated\":true"));
    let sent = first.lock().unwrap();
    assert_eq!(sent.len(), 2);
    let second: serde_json::Value = serde_json::from_slice(&sent[1]).unwrap();
    assert!(second["operationId"]
        .as_str()
        .is_some_and(|id| id.len() == 64));
    assert_eq!(second["mode"], "fresh-empty");
    assert_eq!(second["expectedRevision"], 0);
    assert_eq!(second["schemaVersion"], 3);
    assert_eq!(
        second["accountId"],
        format!("acct_{}", "a".repeat(32)).as_str()
    );
    drop(transport);
    let transport = ops_transport(_server.addr);
    let deadline = Deadline::command().unwrap();
    // The journal already settled; no exchange may occur at all.
    let out = super::super::ops::activate(&dir.0, &KEY, &transport, &deadline).unwrap();
    assert!(out.contains("\"activated\":true"));
    assert_eq!(transport.exchanges.get(), 0);
    drop(dir);
}
#[test]
fn lost_activate_reply_resumes_the_same_operation() {
    let dir = scratch();
    let bodies = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
    let captured = bodies.clone();
    let _server = Server::steps(3, move |index, stream| {
        let (_h, body) = request(stream);
        captured.lock().unwrap().push(body.clone());
        match index {
            0 => respond_status(
                stream,
                409,
                &serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 3, "result": { "ok": false, "error": "not_started" } }))
                .unwrap(),
            ),
            // Read the activate request, then drop the connection without
            // answering: the exchange outcome is genuinely uncertain.
            1 => {}
            _ => {
                let request: serde_json::Value = serde_json::from_slice(&body).unwrap();
                let mut receipt = request.clone();
                receipt
                    .as_object_mut()
                    .unwrap()
                    .insert("bodyHash".into(), "8".repeat(64).into());
                receipt
                    .as_object_mut()
                    .unwrap()
                    .insert("revision".into(), 1.into());
                respond(stream, &envelope(receipt));
            }
        }
    });
    let transport = ops_transport(_server.addr);
    assert_eq!(
        super::super::ops::activate(&dir.0, &KEY, &transport, &Deadline::command().unwrap())
            .unwrap_err(),
        super::UNCERTAIN
    );
    let transport = ops_transport(_server.addr);
    let out = super::super::ops::activate(&dir.0, &KEY, &transport, &Deadline::command().unwrap())
        .unwrap();
    assert!(out.contains("\"activated\":true"));
    let sent = bodies.lock().unwrap();
    assert_eq!(sent.len(), 3);
    // The resumed dispatch sends the byte-identical retained request.
    assert_eq!(sent[1], sent[2]);
    drop(dir);
}
#[test]
fn migrate_reports_seal_counts_and_deduplicates() {
    let dir = scratch();
    let binding = ops_binding();
    let _server = Server::steps(2, move |index, stream| {
        let (_h, body) = request(stream);
        if index == 0 {
            respond_status(
                stream,
                409,
                &serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 3, "result": { "ok": false, "error": "not_started" } }))
                .unwrap(),
            );
        } else {
            let request: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(request["expectedV1Revision"], 7);
            assert_eq!(request["expectedV2Revision"], 11);
            let mut receipt = request.clone();
            let map = receipt.as_object_mut().unwrap();
            map.insert("bodyHash".into(), "9".repeat(64).into());
            map.insert("revision".into(), 1.into());
            map.insert("manifestHash".into(), "d".repeat(64).into());
            map.insert("deltaManifestHash".into(), "e".repeat(64).into());
            map.insert("deltaCount".into(), 3.into());
            map.insert("headCount".into(), 5.into());
            map.insert("suppressedV1Heads".into(), 2.into());
            map.insert("unresolvedV2Bodies".into(), 0.into());
            respond(stream, &envelope(receipt));
        }
    });
    let transport = ops_transport(_server.addr);
    let out = super::super::ops::migrate(
        &dir.0,
        &KEY,
        &transport,
        &Deadline::command().unwrap(),
        |_| Ok((7, 11)),
    )
    .unwrap();
    assert!(out.contains("\"migrated\":true"), "{out}");
    assert!(out.contains("\"headCount\":5"));
    let _ = binding;
    drop(dir);
}
#[test]
fn grant_reconciles_population_state_before_writing() {
    let dir = scratch();
    let population = "f".repeat(64);
    let inside = population.clone();
    let _server = Server::steps(2, move |index, stream| {
        let (_h, body) = request(stream);
        if index == 0 {
            respond(stream, &status_reply(1, "active", true, None));
        } else {
            let request: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(request["populationId"], inside);
            assert_eq!(request["expectedRevision"], 1);
            assert_eq!(request["expectedWriterRevision"], 0);
            assert!(request["previousDeviceId"].is_null());
            respond(
                stream,
                &envelope(serde_json::json!({
                "schemaVersion": 3, "operationId": request["operationId"], "bodyHash": "a".repeat(64),
                "revision": 2, "population": population_view(&inside, 0) })),
            );
        }
    });
    let transport = ops_transport(_server.addr);
    let out = super::super::ops::grant(
        &dir.0,
        &KEY,
        Some(&population),
        &transport,
        &Deadline::command().unwrap(),
    )
    .unwrap();
    assert!(out.contains("\"granted\":true"), "{out}");
    drop(dir);
}
#[test]
fn status_reports_unstarted_and_control_views() {
    let dir = scratch();
    let _server = Server::new(move |stream| {
        request(stream);
        respond_status(
            stream,
            409,
            &serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 3, "result": { "ok": false, "error": "not_started" } }))
            .unwrap(),
        );
    });
    let transport = ops_transport(_server.addr);
    let out = super::super::ops::status(
        &dir.0,
        &KEY,
        None,
        &transport,
        &Deadline::command().unwrap(),
    )
    .unwrap();
    assert!(out.contains("\"not_started\""), "{out}");
    drop(dir);
    let dir = scratch();
    let _server = Server::new(move |stream| {
        request(stream);
        respond(stream, &status_reply(4, "active", true, None));
    });
    let transport = ops_transport(_server.addr);
    let out = super::super::ops::status(
        &dir.0,
        &KEY,
        None,
        &transport,
        &Deadline::command().unwrap(),
    )
    .unwrap();
    assert!(
        out.contains("\"migrated\":true") && out.contains("\"revision\":4"),
        "{out}"
    );
    drop(dir);
}

#[test]
fn refused_intent_settles_durably_and_retry_uses_a_fresh_operation() {
    let dir = scratch();
    let bodies = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
    let captured = bodies.clone();
    // Four exchanges: status, activate (refused), status, activate (receipt).
    let _server = Server::steps(4, move |index, stream| {
        let (_h, body) = request(stream);
        captured.lock().unwrap().push(body.clone());
        match index {
            0 | 2 => respond_status(
                stream,
                409,
                &serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 3, "result": { "ok": false, "error": "not_started" } }))
                .unwrap(),
            ),
            1 => respond_status(
                stream,
                409,
                &serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 3, "result": { "ok": false, "error": "conflict" } }))
                .unwrap(),
            ),
            _ => {
                let request: serde_json::Value = serde_json::from_slice(&body).unwrap();
                let mut receipt = request.clone();
                let map = receipt.as_object_mut().unwrap();
                map.insert("bodyHash".into(), "8".repeat(64).into());
                map.insert("revision".into(), 1.into());
                respond(stream, &envelope(receipt));
            }
        }
    });
    let transport = ops_transport(_server.addr);
    let deadline = Deadline::command().unwrap();
    let err = super::super::ops::activate(&dir.0, &KEY, &transport, &deadline).unwrap_err();
    assert_eq!(err, "contribution_sync_conflict");
    let transport = ops_transport(_server.addr);
    let out = super::super::ops::activate(&dir.0, &KEY, &transport, &Deadline::command().unwrap())
        .unwrap();
    assert!(out.contains("\"activated\":true"), "{out}");
    let sent = bodies.lock().unwrap();
    assert_eq!(sent.len(), 4);
    let first: serde_json::Value = serde_json::from_slice(&sent[1]).unwrap();
    let second: serde_json::Value = serde_json::from_slice(&sent[3]).unwrap();
    assert_ne!(first["operationId"], second["operationId"]);
    drop(dir);
}

#[test]
fn pending_migration_abandons_through_exact_replay_and_retries_fresh() {
    let dir = scratch();
    let bodies = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
    let captured = bodies.clone();
    // Steps: status (not_started), migrate dispatch drops (uncertain),
    // status (not_started), cancel-migration (abandoned terminal),
    // status (not_started), migrate (refused conflict — the account moved on).
    let _server = Server::steps(5, move |index, stream| {
        let (_h, body) = request(stream);
        captured.lock().unwrap().push(body.clone());
        match index {
            0 | 3 => respond_status(
                stream,
                409,
                &serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 3, "result": { "ok": false, "error": "not_started" } }))
                .unwrap(),
            ),
            1 => {}
            2 => {
                let request: serde_json::Value = serde_json::from_slice(&body).unwrap();
                respond(
                    stream,
                    &serde_json::to_vec(&serde_json::json!({
                    "schemaVersion": 3, "result": { "ok": true, "value": {
                        "outcome": "abandoned", "operationId": request["operationId"],
                        "bodyHash": "9".repeat(64), "revision": 1 } } }))
                    .unwrap(),
                );
            }
            _ => respond_status(
                stream,
                409,
                &serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 3, "result": { "ok": false, "error": "conflict" } }))
                .unwrap(),
            ),
        }
    });
    let transport = ops_transport(_server.addr);
    let deadline = Deadline::command().unwrap();
    let revisions = |_: &std::path::Path| -> Result<(u64, u64), &'static str> { Ok((0, 0)) };
    // Dispatch is lost: the intent persists pending and the op reports uncertain.
    assert_eq!(
        super::super::ops::migrate(&dir.0, &KEY, &transport, &deadline, revisions).unwrap_err(),
        super::UNCERTAIN
    );
    // Cancel replays the retained request bytes byte-for-byte.
    let out = super::super::ops::cancel_migration(&dir.0, &KEY, &transport, &deadline).unwrap();
    assert!(out.contains("\"abandoned\""), "{out}");
    let sent: Vec<Vec<u8>> = bodies.lock().unwrap().clone();
    assert_eq!(
        sent.len(),
        3,
        "{}",
        sent.iter()
            .map(|b| String::from_utf8_lossy(b).to_string())
            .collect::<Vec<_>>()
            .join(
                "
"
            )
    );
    assert_eq!(sent[1], sent[2]);
    // The abandoned intent is decided: a later migrate builds a fresh request
    // and the server's conflict settles it as a refusal.
    assert_eq!(
        super::super::ops::migrate(&dir.0, &KEY, &transport, &deadline, revisions).unwrap_err(),
        "contribution_sync_conflict"
    );
    drop(dir);
}

#[test]
fn refused_migration_still_pending_server_side_cancels_through_retained_replay() {
    let dir = scratch();
    let bodies = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
    let captured = bodies.clone();
    // A refused intent never proves the server settled: the operation may
    // still hold pendingOperation and refuse every later reservation. Cancel
    // must reconcile it by replaying the retained request anyway.
    // Steps: status (not_started), migrate (refused conflict — settles
    // locally), cancel-migration (abandoned terminal).
    let _server = Server::steps(3, move |index, stream| {
        let (_h, body) = request(stream);
        captured.lock().unwrap().push(body.clone());
        match index {
            0 => respond_status(
                stream,
                409,
                &serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 3, "result": { "ok": false, "error": "not_started" } }))
                .unwrap(),
            ),
            1 => respond_status(
                stream,
                409,
                &serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 3, "result": { "ok": false, "error": "conflict" } }))
                .unwrap(),
            ),
            _ => {
                let request: serde_json::Value = serde_json::from_slice(&body).unwrap();
                respond(
                    stream,
                    &serde_json::to_vec(&serde_json::json!({
                    "schemaVersion": 3, "result": { "ok": true, "value": {
                        "outcome": "abandoned", "operationId": request["operationId"],
                        "bodyHash": "9".repeat(64), "revision": 1 } } }))
                    .unwrap(),
                );
            }
        }
    });
    let transport = ops_transport(_server.addr);
    let deadline = Deadline::command().unwrap();
    let revisions = |_: &std::path::Path| -> Result<(u64, u64), &'static str> { Ok((0, 0)) };
    assert_eq!(
        super::super::ops::migrate(&dir.0, &KEY, &transport, &deadline, revisions).unwrap_err(),
        "contribution_sync_conflict"
    );
    let out = super::super::ops::cancel_migration(&dir.0, &KEY, &transport, &deadline).unwrap();
    assert!(out.contains("\"abandoned\""), "{out}");
    let sent = bodies.lock().unwrap();
    assert_eq!(sent.len(), 3);
    assert_eq!(
        sent[1], sent[2],
        "cancel must replay the identical retained request"
    );
    drop(dir);
}
