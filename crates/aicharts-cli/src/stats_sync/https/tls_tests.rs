//! Actual synthetic TLS exchange; no external endpoints or real credentials.
use super::*;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use rustls::{ServerConfig, ServerConnection, StreamOwned};
use std::io::{self, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use ureq::http::Uri;
use ureq::tls::Certificate;
use ureq::unversioned::resolver::{ResolvedSocketAddrs, Resolver};
use ureq::unversioned::transport::NextTimeout;
const CA: &[u8] = include_bytes!("../../upload/fixtures/ca.der");
const CERT: &[u8] = include_bytes!("../../upload/fixtures/server.der");
const KEY: &[u8] = include_bytes!("../../upload/fixtures/server-key.der");
#[derive(Debug)]
struct LocalResolver(SocketAddr);
impl Resolver for LocalResolver {
    fn resolve(
        &self,
        uri: &Uri,
        _: &Config,
        _: NextTimeout,
    ) -> Result<ResolvedSocketAddrs, ureq::Error> {
        assert_eq!(uri.host(), Some("usage.test"));
        let mut result = self.empty();
        result.push(self.0);
        Ok(result)
    }
}
fn agent(addr: SocketAddr) -> Agent {
    Agent::with_parts(
        config(RootCerts::Specific(vec![Certificate::from_der(CA)].into())),
        DefaultConnector::default(),
        LocalResolver(addr),
    )
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
        if header.len() > 16 * 1024 {
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
    assert!(length <= super::super::MAX_BYTES);
    let mut body = vec![0; length];
    stream.read_exact(&mut body)?;
    Ok((header, body))
}

#[test]
fn actual_tls_sends_exact_numeric_body_and_sensitive_bearer_and_parses_receipt() {
    let request = super::super::tests::upload();
    let bytes = super::super::encoded(&request).unwrap();
    let expected = bytes.clone();
    let receipt = Receipt {
        schema_version: 2,
        operation_id: request.operation_id.clone(),
        body_hash: super::super::body_hash(&request).unwrap(),
        sequence: 1,
        revision: 1,
        committed_at_ms: 1_800_000_000_000,
        client: request.report.sources[0].client.clone(),
        first_utc_day: request.report.first_utc_day,
        day_count: request.report.day_count,
    };
    let reply = serde_json::to_vec(
        &serde_json::json!({"schemaVersion":2,"result":{"ok":true,"value":receipt}}),
    )
    .unwrap();
    let server = Server::new(move |stream| {
        let (headers, body) = read_request(stream).unwrap();
        assert_eq!(body, expected);
        assert!(headers.starts_with("POST /v2/snapshots HTTP/1.1"));
        assert!(headers
            .to_ascii_lowercase()
            .contains(&format!("authorization: bearer {}", "a5".repeat(32))));
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", reply.len()).unwrap();
        stream.write_all(&reply).unwrap();
        stream.flush().unwrap();
    });
    let mut transport = Transport::new(&[0xa5; 32]).unwrap();
    assert!(transport.bearer.is_sensitive());
    let result: Receipt = transport
        .exchange_with_agent(
            agent(server.addr),
            &format!("https://usage.test:{}/v2/snapshots", server.addr.port()),
            &bytes,
        )
        .unwrap();
    result.matches(&request, 1_800_000_000_000).unwrap();
}
#[test]
fn actual_tls_lost_reply_and_truncated_body_never_manufacture_receipt() {
    for reply in [None, Some(b"HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 20\r\nConnection: close\r\n\r\n{}".as_slice())] {
        let server = Server::new(move |stream| { read_request(stream).unwrap(); if let Some(reply) = reply { stream.write_all(reply).unwrap(); stream.flush().unwrap(); } });
        let mut transport = Transport::new(&[0xa5; 32]).unwrap();
        assert!(transport.exchange_with_agent::<Receipt>(agent(server.addr), &format!("https://usage.test:{}/v2/snapshots", server.addr.port()), b"{}").is_err());
    }
}
#[test]
fn actual_tls_abandonment_correlates_the_exact_flight_fence() {
    let request = super::super::tests::upload();
    let body_hash = super::super::body_hash(&request).unwrap();
    let wire = AbandonRequest {
        schema_version: 2,
        operation_id: &request.operation_id,
        account_id: &request.account_id,
        device_id: &request.device_id,
        generation: &request.generation,
        sequence: request.sequence,
        expected_revision: request.expected_revision,
        body_hash: body_hash.clone(),
    };
    let bytes = super::super::encoded(&wire).unwrap();
    assert!(bytes.len() <= 1024);
    let expected = bytes.clone();
    let reply=serde_json::to_vec(&serde_json::json!({"schemaVersion":2,"result":{"ok":true,"value":{
        "schemaVersion":2,"outcome":"abandoned","operationId":request.operation_id,"bodyHash":body_hash,
        "sequence":request.sequence,"expectedRevision":request.expected_revision,"fencedAtRevision":1}}})).unwrap();
    let server = Server::new(move |stream| {
        let (headers, body) = read_request(stream).unwrap();
        assert!(headers.starts_with("POST /v2/snapshots/abandon HTTP/1.1"));
        assert_eq!(body, expected);
        write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",reply.len()).unwrap();
        stream.write_all(&reply).unwrap();
        stream.flush().unwrap();
    });
    let proof: Abandonment = Transport::new(&[0xa5; 32])
        .unwrap()
        .exchange_with_agent(
            agent(server.addr),
            &format!(
                "https://usage.test:{}/v2/snapshots/abandon",
                server.addr.port()
            ),
            &bytes,
        )
        .unwrap();
    assert_eq!(proof.validate(&request, 1_800_000_000_000).unwrap(), None);
}
