//! Sealed enrolled V3 transport. Fixed origin, no redirects/proxy/retries.
//! Deadlines bound acceptance and socket I/O, not OS preemption. DNS uses the
//! existing process-wide owner; no HTTP work is detached after a timeout.
use super::{
    wire, Action, AuthenticatedProgress, AuthenticatedTerminal, Binding, DurableFlight, FrozenBody,
    TerminalProof, MAX_BATCH_BYTES, MAX_TERMINAL_BYTES,
};
use aicharts_core::contribution_producer::{
    CorrelatedHeads, HeadQuery, NativeObservations, PreparedBatch, MAX_QUERY_BYTES, MAX_REPLY_BYTES,
};
use aicharts_custody::references::RecordIntent;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    cell::Cell,
    io::{BufRead, Read},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use ureq::{
    config::Config,
    http::{HeaderMap, HeaderValue},
    tls::{RootCerts, TlsConfig, TlsProvider},
    unversioned::transport::DefaultConnector,
    Agent,
};

const TOTAL: Duration = Duration::from_secs(120);
const EXCHANGE: Duration = Duration::from_secs(45);
const MAX_EXCHANGES: u8 = 35;
const CANCEL_BYTES: usize = 1_049_088;
const INVALID: &str = wire::INVALID;
const UNCERTAIN: &str = wire::UNCERTAIN;

pub(super) struct Deadline {
    end: Instant,
}
impl Deadline {
    pub(super) fn command() -> Result<Self, &'static str> {
        Ok(Self {
            end: Instant::now().checked_add(TOTAL).ok_or(UNCERTAIN)?,
        })
    }
    fn exchange(&self) -> Result<Self, &'static str> {
        let end = Instant::now()
            .checked_add(EXCHANGE)
            .ok_or(UNCERTAIN)?
            .min(self.end);
        let value = Self { end };
        value.remaining()?;
        Ok(value)
    }
    pub(super) fn remaining(&self) -> Result<Duration, &'static str> {
        self.end
            .checked_duration_since(Instant::now())
            .filter(|v| !v.is_zero())
            .ok_or(UNCERTAIN)
    }
}
#[derive(Clone, Copy)]
enum Endpoint {
    Status,
    Heads,
    Upload,
    Cancel,
    Activate,
    Migrate,
    MigrateCancel,
    Grant,
}
impl Endpoint {
    fn url(self) -> &'static str {
        match self {
            Self::Status => "https://usage.aicharts.io/v3/contributions/status",
            Self::Heads => "https://usage.aicharts.io/v3/contributions/heads",
            Self::Upload => "https://usage.aicharts.io/v3/contributions",
            Self::Cancel => "https://usage.aicharts.io/v3/contributions/cancel",
            Self::Activate => "https://usage.aicharts.io/v3/contributions/activate",
            Self::Migrate => "https://usage.aicharts.io/v3/contributions/migrate",
            Self::MigrateCancel => "https://usage.aicharts.io/v3/contributions/migrate/cancel",
            Self::Grant => "https://usage.aicharts.io/v3/contributions/populations",
        }
    }
    fn request_cap(self) -> usize {
        match self {
            Self::Status => wire::STATUS_REQUEST_BYTES,
            Self::Heads => MAX_QUERY_BYTES,
            Self::Upload => MAX_BATCH_BYTES,
            Self::Cancel => CANCEL_BYTES,
            Self::Activate | Self::Migrate | Self::MigrateCancel | Self::Grant => {
                wire::CONTROL_REQUEST_BYTES
            }
        }
    }
    fn response_cap(self) -> usize {
        match self {
            Self::Heads => MAX_REPLY_BYTES,
            Self::Activate | Self::Migrate | Self::MigrateCancel | Self::Grant => {
                wire::CONTROL_REPLY_BYTES
            }
            _ => MAX_TERMINAL_BYTES,
        }
    }
}
struct EnrolledAuthority {
    directory: PathBuf,
    binding: Binding,
    pairing: RecordIntent,
    namespace: RecordIntent,
}
enum Authority {
    Enrolled(Box<EnrolledAuthority>),
    #[cfg(test)]
    Synthetic(tests::SyntheticAuthority),
}
pub(super) struct Transport {
    authority: Authority,
    exchanges: Cell<u8>,
    #[cfg(test)]
    fixture: Option<tests::ClientFixture>,
}
pub(super) struct AuthenticatedStatus {
    pub(super) progress: Option<AuthenticatedProgress>,
    pub(super) terminal: Option<AuthenticatedTerminal>,
}
pub(super) struct AuthenticatedHeads {
    heads: CorrelatedHeads,
    expires_at: Instant,
}
impl AuthenticatedHeads {
    pub(super) fn prepare(
        &self,
        operation: &str,
        sequence: u64,
    ) -> Result<Option<PreparedBatch>, &'static str> {
        if Instant::now() >= self.expires_at {
            return Err(UNCERTAIN);
        }
        self.heads
            .prepare(operation, sequence)
            .map_err(|error| error.code())
    }
}
fn binding(enrolled: &crate::enrollment::EnrolledInstallation) -> Result<Binding, &'static str> {
    fn hex(value: &[u8]) -> String {
        value.iter().map(|b| format!("{b:02x}")).collect()
    }
    Binding::new(
        &format!("acct_{}", hex(&enrolled.account_id)),
        &hex(&enrolled.recovery_generation),
        &hex(&enrolled.device_id),
    )
}
fn bearer(secret: &[u8; 32]) -> Result<HeaderValue, &'static str> {
    if secret == &[0; 32] {
        return Err("attempt_custody");
    }
    let mut text = String::with_capacity(71);
    text.push_str("Bearer ");
    for byte in secret {
        use std::fmt::Write;
        let _ = write!(text, "{byte:02x}");
    }
    let mut header = HeaderValue::from_str(&text).map_err(|_| "attempt_custody")?;
    header.set_sensitive(true);
    Ok(header)
}
fn configuration(remaining: Duration, roots: RootCerts) -> Config {
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
        .timeout_global(Some(remaining))
        .timeout_resolve(Some(Duration::from_secs(3).min(remaining)))
        .timeout_connect(Some(Duration::from_secs(5).min(remaining)))
        .timeout_send_request(Some(Duration::from_secs(3).min(remaining)))
        .timeout_send_body(Some(Duration::from_secs(5).min(remaining)))
        .timeout_recv_response(Some(Duration::from_secs(40).min(remaining)))
        .timeout_recv_body(Some(Duration::from_secs(5).min(remaining)))
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
fn framing(headers: &HeaderMap, cap: usize) -> Result<usize, &'static str> {
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
        || bytes.len() > 6
        || bytes[0] == b'0'
        || !bytes.iter().all(u8::is_ascii_digit)
    {
        return Err(INVALID);
    }
    let length = bytes
        .iter()
        .fold(0usize, |value, byte| value * 10 + (byte - b'0') as usize);
    if length > cap {
        return Err(INVALID);
    }
    Ok(length)
}
struct Reply {
    bytes: Vec<u8>,
    expires_at: Instant,
}
impl Transport {
    /// The only production constructor accepts an existing enrollment path;
    /// no caller may import a token or assert an enrolled binding.
    pub(super) fn enrolled(directory: &Path) -> Result<Self, &'static str> {
        let enrolled = crate::enrollment::enrolled(directory)?;
        let authority = Authority::Enrolled(Box::new(EnrolledAuthority {
            directory: directory.into(),
            binding: binding(&enrolled)?,
            pairing: RecordIntent::from_record(&enrolled.pairing),
            namespace: RecordIntent::from_record(&enrolled.namespace),
        }));
        Ok(Self {
            authority,
            exchanges: Cell::new(0),
            #[cfg(test)]
            fixture: None,
        })
    }
    pub(super) fn binding(&self) -> &Binding {
        match &self.authority {
            Authority::Enrolled(value) => &value.binding,
            #[cfg(test)]
            Authority::Synthetic(value) => &value.binding,
        }
    }
    fn current_enrollment(&self) -> Result<crate::enrollment::EnrolledInstallation, &'static str> {
        let (directory, expected, pairing, namespace) = match &self.authority {
            Authority::Enrolled(value) => (
                &value.directory,
                &value.binding,
                &value.pairing,
                &value.namespace,
            ),
            #[cfg(test)]
            Authority::Synthetic(_) => return Err("attempt_custody"),
        };
        let actual = crate::enrollment::enrolled(directory)?;
        if binding(&actual)? != *expected
            || RecordIntent::from_record(&actual.pairing) != *pairing
            || RecordIntent::from_record(&actual.namespace) != *namespace
        {
            return Err("contribution_sync_identity_changed");
        }
        Ok(actual)
    }
    fn current_bearer(&self) -> Result<HeaderValue, &'static str> {
        #[cfg(test)]
        if let Authority::Synthetic(value) = &self.authority {
            return value.bearer();
        }
        self.current_enrollment()?
            .pairing
            .with_pairing_secrets(|_, secret| bearer(secret))
            .map_err(|_| "attempt_custody")?
    }
    pub(super) fn read_native<R: BufRead>(
        &self,
        provider: aicharts_protocol::Provider,
        reader: R,
    ) -> Result<NativeObservations, &'static str> {
        self.current_enrollment()?
            .namespace
            .with_namespace_key(|key| {
                let account = &self.binding().account_id;
                match provider {
                    aicharts_protocol::Provider::ClaudeCode => {
                        NativeObservations::read_claude(reader, account, key)
                    }
                    aicharts_protocol::Provider::Codex => {
                        NativeObservations::read_codex(reader, account, key)
                    }
                    aicharts_protocol::Provider::Devin => {
                        return Err("contribution_sync_unsupported_provider")
                    }
                }
                .map_err(|error| error.code())
            })
            .map_err(|_| "attempt_custody")?
    }
    fn agent(&self, remaining: Duration) -> Agent {
        #[cfg(test)]
        if let Some(fixture) = &self.fixture {
            return fixture.agent(remaining);
        }
        Agent::with_parts(
            configuration(remaining, RootCerts::WebPki),
            DefaultConnector::default(),
            crate::transport_dns::UsageResolver,
        )
    }
    fn url(&self, endpoint: Endpoint) -> String {
        #[cfg(test)]
        if let Some(fixture) = &self.fixture {
            return fixture.url(endpoint);
        }
        endpoint.url().into()
    }
    fn exchange(
        &self,
        endpoint: Endpoint,
        command: &Deadline,
        request: impl FnOnce() -> Result<Vec<u8>, &'static str>,
    ) -> Result<Reply, &'static str> {
        let deadline = command.exchange()?;
        if self.exchanges.get() >= MAX_EXCHANGES {
            return Err("contribution_sync_exchange_limit");
        }
        let bearer = self.current_bearer()?;
        let agent = self.agent(deadline.remaining()?);
        // For mutations this is the final descriptor/action check, after fresh
        // custody resolution and before the one synchronous HTTP dispatch.
        let bytes = request()?;
        if bytes.is_empty() || bytes.len() > endpoint.request_cap() {
            return Err(INVALID);
        }
        deadline.remaining()?;
        self.exchanges.set(self.exchanges.get() + 1);
        let url = self.url(endpoint);
        let mut response = agent
            .post(&url)
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .header("authorization", bearer)
            .header("connection", "close")
            .send(bytes.as_slice())
            .map_err(|_| UNCERTAIN)?;
        deadline.remaining()?;
        let status = response.status().as_u16();
        if ![200, 400, 401, 409, 503].contains(&status) {
            return Err(INVALID);
        }
        let cap = endpoint.response_cap();
        let expected = framing(response.headers(), cap)?;
        let mut body = Vec::with_capacity(expected);
        let mut reader = response
            .body_mut()
            .with_config()
            .limit((cap + 1) as u64)
            .reader();
        let mut chunk = [0u8; 4096];
        loop {
            deadline.remaining()?;
            let count = reader.read(&mut chunk).map_err(|_| INVALID)?;
            deadline.remaining()?;
            if count == 0 {
                break;
            }
            if body.len() + count > expected {
                return Err(INVALID);
            }
            body.extend_from_slice(&chunk[..count]);
        }
        if body.len() != expected {
            return Err(INVALID);
        }
        wire::success(status, &body, cap)?;
        deadline.remaining()?;
        Ok(Reply {
            bytes: body,
            expires_at: deadline.end,
        })
    }
    pub(super) fn status(
        &self,
        population: &str,
        batch: Option<&PreparedBatch>,
        deadline: &Deadline,
    ) -> Result<AuthenticatedStatus, &'static str> {
        let request = wire::StatusRequest::new(self.binding(), population, batch)?;
        let reply = self.exchange(Endpoint::Status, deadline, || request.bytes())?;
        let checked = wire::status(200, &reply.bytes, &request, batch)?;
        if Instant::now() >= reply.expires_at {
            return Err(UNCERTAIN);
        }
        let progress = checked.position.map(|position| AuthenticatedProgress {
            scope: position.scope,
            active: true,
            next_sequence: position.next_sequence,
            revision: position.revision,
            population_revision: position.population_revision,
            population_head: position.population_head,
            expires_at: reply.expires_at,
        });
        let terminal = if checked.terminal.is_some() {
            Some(AuthenticatedTerminal {
                body: FrozenBody::new(batch.ok_or(INVALID)?),
                proof: TerminalProof::Status(STANDARD.encode(&reply.bytes)),
            })
        } else {
            None
        };
        Ok(AuthenticatedStatus { progress, terminal })
    }
    pub(super) fn heads(
        &self,
        query: &HeadQuery,
        deadline: &Deadline,
    ) -> Result<AuthenticatedHeads, &'static str> {
        if Binding::from_scope(query.scope()) != *self.binding() {
            return Err("contribution_sync_identity_changed");
        }
        let reply = self.exchange(Endpoint::Heads, deadline, || Ok(query.bytes().to_vec()))?;
        let heads = query.correlate(&reply.bytes).map_err(|_| INVALID)?;
        if Instant::now() >= reply.expires_at {
            return Err(UNCERTAIN);
        }
        Ok(AuthenticatedHeads {
            heads,
            expires_at: reply.expires_at,
        })
    }
    /// Read-only control view for the ops driver: a status exchange whose
    /// population probe may be absent; only validated control fields return.
    pub(super) fn control(
        &self,
        population: &str,
        deadline: &Deadline,
    ) -> Result<wire::ControlView, &'static str> {
        let request = wire::StatusRequest::new(self.binding(), population, None)?;
        let reply = self.exchange(Endpoint::Status, deadline, || request.bytes())?;
        let checked = wire::status(200, &reply.bytes, &request, None)?;
        if Instant::now() >= reply.expires_at {
            return Err(UNCERTAIN);
        }
        Ok(checked.control)
    }
    fn control_op<R>(
        &self,
        endpoint: Endpoint,
        deadline: &Deadline,
        body: &[u8],
        correlate: impl FnOnce(u16, &[u8]) -> Result<R, &'static str>,
    ) -> Result<R, &'static str> {
        let reply = self.exchange(endpoint, deadline, || Ok(body.to_vec()))?;
        let result = correlate(200, &reply.bytes)?;
        if Instant::now() >= reply.expires_at {
            return Err(UNCERTAIN);
        }
        Ok(result)
    }
    pub(super) fn activate(
        &self,
        request: &wire::ActivateRequest,
        deadline: &Deadline,
    ) -> Result<u64, &'static str> {
        let body = wire::control_body(request)?;
        self.control_op(Endpoint::Activate, deadline, &body, |code, bytes| {
            wire::activation_receipt(code, bytes, request)
        })
    }
    pub(super) fn migrate(
        &self,
        request: &wire::MigrateRequest,
        deadline: &Deadline,
    ) -> Result<wire::MigrationSettled, &'static str> {
        let body = wire::control_body(request)?;
        self.control_op(Endpoint::Migrate, deadline, &body, |code, bytes| {
            wire::migration_receipt(code, bytes, request)
        })
    }
    /// Explicit cancellation of a pending migration, replaying the retained
    /// request to the cancel route; the reply is the abandoned terminal.
    pub(super) fn cancel_migration(
        &self,
        request: &wire::MigrateRequest,
        deadline: &Deadline,
    ) -> Result<(String, u64), &'static str> {
        let body = wire::control_body(request)?;
        self.control_op(Endpoint::MigrateCancel, deadline, &body, |code, bytes| {
            wire::migration_terminal(code, bytes, request)
        })
    }
    pub(super) fn grant(
        &self,
        request: &wire::GrantRequest,
        deadline: &Deadline,
    ) -> Result<wire::GrantSettled, &'static str> {
        let body = wire::control_body(request)?;
        self.control_op(Endpoint::Grant, deadline, &body, |code, bytes| {
            wire::grant_receipt(code, bytes, request)
        })
    }
    pub(super) fn dispatch(
        &self,
        flight: &DurableFlight<'_>,
        deadline: &Deadline,
    ) -> Result<AuthenticatedTerminal, &'static str> {
        let retained = flight.owner.checkpoint.flight.as_ref().ok_or(INVALID)?;
        let endpoint = match retained.action {
            Action::Upload => Endpoint::Upload,
            Action::Cancel { .. } => Endpoint::Cancel,
        };
        let reply = self.exchange(endpoint, deadline, || flight.request_bytes(self.binding()))?;
        flight
            .batch
            .correlate_terminal(&reply.bytes)
            .map_err(|_| INVALID)?;
        if Instant::now() >= reply.expires_at {
            return Err(UNCERTAIN);
        }
        Ok(AuthenticatedTerminal {
            body: FrozenBody::new(&flight.batch),
            proof: TerminalProof::Direct(STANDARD.encode(reply.bytes)),
        })
    }
}

#[cfg(test)]
mod tests;
