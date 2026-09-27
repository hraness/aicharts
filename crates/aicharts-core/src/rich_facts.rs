//! Opt-in local projection of owned session observations. No files, state or network.
//! The session producer has no lineage, request lifecycle, exact timing or
//! complete coverage. The transcript producer (`transcript`) adds request, tool,
//! context and lineage-bearing usage facts from native JSONL; `revision` assigns
//! durable revisions from a caller-persisted ledger.

pub mod revision;
pub mod transcript;

use crate::sessions::SessionReport;
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use std::io::{self, Write};

pub const PROFILE: &str = "rich-facts-v1";
/// Provenance profile of transcript-derived facts; identities are namespaced by it.
pub const TRANSCRIPT_PROFILE: &str = "numeric-producer-v1";
pub const MAX_REPORT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_FACTS: usize = 50_000;
pub const MAX_EXECUTIONS: usize = 2_000;
pub const MAX_WINDOW_MS: u64 = 31 * 86_400_000;
const MAX_EPOCH_MS: u64 = 8_640_000_000_000_000;

/// An explicit source generation and half-open observation window, validated before I/O.
pub struct ExportOptions {
    source_epoch: String,
    window: Window,
}
impl ExportOptions {
    pub fn source_epoch(&self) -> &str {
        &self.source_epoch
    }
    pub fn start_ms(&self) -> u64 {
        self.window.start_ms
    }
    pub fn end_ms(&self) -> u64 {
        self.window.end_ms
    }
    pub fn new(source_epoch: &str, start_ms: u64, end_ms: u64) -> Result<Self, &'static str> {
        if source_epoch.is_empty()
            || source_epoch.len() > 128
            || !source_epoch
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        {
            return Err("invalid_source_epoch");
        }
        if end_ms > MAX_EPOCH_MS || end_ms <= start_ms || end_ms - start_ms > MAX_WINDOW_MS {
            return Err("invalid_window");
        }
        Ok(Self {
            source_epoch: source_epoch.to_owned(),
            window: Window { start_ms, end_ms },
        })
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub(crate) start_ms: u64,
    pub(crate) end_ms: u64,
}
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    pub(crate) profile: &'static str,
    pub(crate) version: u8,
    pub(crate) source_id: String,
}
#[derive(Clone, Serialize)]
pub struct Coverage {
    pub(crate) usage: &'static str,
    pub(crate) span: &'static str,
    pub(crate) request: &'static str,
    pub(crate) turn: &'static str,
    pub(crate) tool: &'static str,
    pub(crate) context: &'static str,
    pub(crate) compaction: &'static str,
}
impl Coverage {
    pub fn usage(&self) -> &'static str {
        self.usage
    }
    pub fn request(&self) -> &'static str {
        self.request
    }
    pub fn tool(&self) -> &'static str {
        self.tool
    }
    pub fn context(&self) -> &'static str {
        self.context
    }
}
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Owner {
    pub(crate) provider: &'static str,
    pub(crate) account_id: Option<String>,
    pub(crate) execution_id: String,
    pub(crate) conversation_id: Option<String>,
    pub(crate) lineage: &'static str,
    pub(crate) parent_execution_id: Option<String>,
}
impl Owner {
    pub fn execution_id(&self) -> &str {
        &self.execution_id
    }
    pub fn lineage(&self) -> &'static str {
        self.lineage
    }
    pub fn parent_execution_id(&self) -> Option<&str> {
        self.parent_execution_id.as_deref()
    }
}
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub(crate) input_uncached: String,
    pub(crate) cache_read: String,
    pub(crate) cache_write5m: String,
    pub(crate) cache_write1h: String,
    pub(crate) cache_write_unknown: String,
    pub(crate) output: String,
    pub(crate) reasoning: Option<String>,
}
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub(crate) kind: &'static str,
    pub(crate) grain: &'static str,
    pub(crate) token_scope: &'static str,
    pub(crate) observation_id: String,
    pub(crate) model: Option<&'static str>,
    pub(crate) model_basis: &'static str,
    pub(crate) tokens: Tokens,
}
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub(crate) kind: &'static str,
    pub(crate) observation_id: String,
    pub(crate) stage: &'static str,
    pub(crate) outcome: &'static str,
    pub(crate) requested_at_ms: Option<u64>,
    pub(crate) dispatched_at_ms: Option<u64>,
    pub(crate) terminal_at_ms: Option<u64>,
    pub(crate) first_token_at_ms: Option<u64>,
    pub(crate) last_token_at_ms: Option<u64>,
    pub(crate) clock_uncertainty_ms: Option<u64>,
    pub(crate) retry_of: Option<String>,
}
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub(crate) kind: &'static str,
    pub(crate) observation_id: String,
    pub(crate) stage: &'static str,
    pub(crate) outcome: &'static str,
}
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub(crate) kind: &'static str,
    pub(crate) observation_id: String,
    pub(crate) tokens: String,
    pub(crate) limit_tokens: Option<String>,
}
/// Exactly one rich-facts-v1 payload kind; retractions carry no payload.
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum Payload {
    Usage(Usage),
    Request(Request),
    Tool(Tool),
    Context(Context),
}
impl Payload {
    pub fn usage(&self) -> Option<&Usage> {
        match self {
            Self::Usage(value) => Some(value),
            _ => None,
        }
    }
    pub fn request(&self) -> Option<&Request> {
        match self {
            Self::Request(value) => Some(value),
            _ => None,
        }
    }
    pub fn tool(&self) -> Option<&Tool> {
        match self {
            Self::Tool(value) => Some(value),
            _ => None,
        }
    }
    pub fn context(&self) -> Option<&Context> {
        match self {
            Self::Context(value) => Some(value),
            _ => None,
        }
    }
}
impl Usage {
    pub fn grain(&self) -> &'static str {
        self.grain
    }
    pub fn token_scope(&self) -> &'static str {
        self.token_scope
    }
    /// Exact input + cache read + cache write + output as a u128; never saturates.
    pub fn total(&self) -> u128 {
        [
            &self.tokens.input_uncached,
            &self.tokens.cache_read,
            &self.tokens.cache_write5m,
            &self.tokens.cache_write1h,
            &self.tokens.cache_write_unknown,
            &self.tokens.output,
        ]
        .iter()
        .map(|value| value.parse::<u128>().unwrap_or(0))
        .sum()
    }
}
impl Request {
    pub fn stage(&self) -> &'static str {
        self.stage
    }
    pub fn outcome(&self) -> &'static str {
        self.outcome
    }
    pub fn requested_at_ms(&self) -> Option<u64> {
        self.requested_at_ms
    }
    pub fn first_token_at_ms(&self) -> Option<u64> {
        self.first_token_at_ms
    }
}
impl Tool {
    pub fn stage(&self) -> &'static str {
        self.stage
    }
    pub fn outcome(&self) -> &'static str {
        self.outcome
    }
}
impl Context {
    pub fn tokens(&self) -> &str {
        &self.tokens
    }
    pub fn limit_tokens(&self) -> Option<&str> {
        self.limit_tokens.as_deref()
    }
}
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fact {
    pub(crate) id: String,
    pub(crate) revision: u32,
    pub(crate) provenance: Provenance,
    pub(crate) owner: Owner,
    pub(crate) kind: &'static str,
    pub(crate) at_ms: u64,
    pub(crate) value: Option<Payload>,
}
impl Fact {
    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn revision(&self) -> u32 {
        self.revision
    }
    pub fn owner(&self) -> &Owner {
        &self.owner
    }
    pub fn kind(&self) -> &'static str {
        self.kind
    }
    pub fn at_ms(&self) -> u64 {
        self.at_ms
    }
    pub fn value(&self) -> Option<&Payload> {
        self.value.as_ref()
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub(crate) schema_version: u8,
    pub(crate) profile: &'static str,
    pub(crate) provenance: Provenance,
    pub(crate) window: Window,
    pub(crate) coverage: Coverage,
    pub(crate) facts: Vec<Fact>,
}
impl Report {
    pub fn facts(&self) -> &[Fact] {
        &self.facts
    }
    pub fn coverage(&self) -> &Coverage {
        &self.coverage
    }
    pub fn source_id(&self) -> &str {
        &self.provenance.source_id
    }
}

struct BoundedOutput {
    bytes: Vec<u8>,
}
impl Write for BoundedOutput {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > MAX_REPORT_BYTES.saturating_sub(self.bytes.len()) {
            return Err(io::Error::other("report_size_limit"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
impl Report {
    /// Serialization is bounded while writing; an oversized report never escapes as a prefix.
    pub fn to_json(&self) -> Result<String, &'static str> {
        let mut output = BoundedOutput { bytes: Vec::new() };
        serde_json::to_writer(&mut output, self).map_err(|_| "report_size_limit")?;
        String::from_utf8(output.bytes).map_err(|_| "summary_encode_failed")
    }
}

pub(crate) fn keyed(
    key: &[u8; 32],
    profile: &'static str,
    epoch: &str,
    domain: &str,
    values: &[&str],
) -> Result<String, &'static str> {
    // Exact JSON-array bytes match rich-fact-adapters.ts; all inputs are bounded ASCII.
    let mut parts = vec!["aicharts-rich-facts-v1", profile, epoch, domain];
    parts.extend_from_slice(values);
    let encoded = serde_json::to_vec(&parts).map_err(|_| "summary_encode_failed")?;
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|_| "invalid_key")?;
    mac.update(&encoded);
    let digest = mac.finalize().into_bytes();
    if digest[..16].iter().all(|byte| *byte == 0) {
        return Err("invalid_rich_identity");
    }
    Ok(digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

/// Only a SessionReport built by the established collector can enter this projection.
/// Every export is a revision-zero snapshot; conflicting rescans need explicit resolution.
pub fn project_sessions(
    report: &SessionReport,
    key: &[u8; 32],
    options: &ExportOptions,
) -> Result<Report, &'static str> {
    if key.iter().all(|byte| *byte == 0) {
        return Err("invalid_key");
    }
    if report.sessions.len() > MAX_EXECUTIONS {
        return Err("record_limit");
    }
    let hash = |domain, values: &[&str]| {
        keyed(
            key,
            crate::sessions::PROFILE,
            &options.source_epoch,
            domain,
            values,
        )
    };
    let provenance = Provenance {
        profile: crate::sessions::PROFILE,
        version: 1,
        source_id: hash("source", &[])?,
    };
    let mut facts = Vec::new();
    for session in &report.sessions {
        let owner = Owner {
            provider: session.provider,
            account_id: None,
            execution_id: hash("execution", &[session.provider, &session.session_id])?,
            conversation_id: session
                .conversation_id
                .as_ref()
                .map(|id| hash("conversation", &[session.provider, id]))
                .transpose()?,
            lineage: "unknown",
            parent_execution_id: None,
        };
        for usage in &session.usage {
            if usage.at_ms < options.window.start_ms || usage.at_ms >= options.window.end_ms {
                continue;
            }
            if facts.len() >= MAX_FACTS {
                return Err("record_limit");
            }
            let value = Usage {
                kind: "usage",
                grain: "usage_observation",
                token_scope: "unknown",
                observation_id: hash(
                    "observation",
                    &[session.provider, &session.session_id, &usage.id],
                )?,
                model: usage.model,
                model_basis: usage.model_basis,
                tokens: Tokens {
                    input_uncached: usage.input_tokens.to_string(),
                    cache_read: usage.cache_read_tokens.to_string(),
                    cache_write5m: "0".to_owned(),
                    cache_write1h: "0".to_owned(),
                    cache_write_unknown: usage.cache_write_tokens.to_string(),
                    output: usage.output_tokens.to_string(),
                    reasoning: usage.reasoning_tokens.map(|count| count.to_string()),
                },
            };
            facts.push(Fact {
                id: hash(
                    "fact",
                    &[session.provider, &owner.execution_id, "usage", &usage.id],
                )?,
                revision: 0,
                provenance: provenance.clone(),
                owner: owner.clone(),
                kind: "usage",
                at_ms: usage.at_ms,
                value: Some(Payload::Usage(value)),
            });
        }
    }
    Ok(Report {
        schema_version: 1,
        profile: PROFILE,
        provenance,
        window: options.window.clone(),
        coverage: Coverage {
            usage: "partial",
            span: "unsupported",
            request: "unsupported",
            turn: "unsupported",
            tool: "unsupported",
            context: "unsupported",
            compaction: "unsupported",
        },
        facts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions;
    use aicharts_protocol::Provider;
    use std::io::Cursor;

    const KEY: [u8; 32] = [9; 32];
    const START: u64 = 1_767_225_600_000;
    const ROW: &str = concat!(
        "{\"type\":\"assistant\",\"timestamp\":\"2026-01-01T00:00:02Z\",\"requestId\":\"req\",\"sessionId\":\"session\",",
        "\"message\":{\"id\":\"msg\",\"model\":\"claude-sonnet-4-6\",\"content\":\"PRIVATE_DO_NOT_RETAIN\",",
        "\"usage\":{\"input_tokens\":10,\"cache_read_input_tokens\":100,\"output_tokens\":4}}}\n",
    );
    fn report() -> SessionReport {
        let tokens = crate::parse_reader(Cursor::new(ROW), Provider::ClaudeCode, &KEY).unwrap();
        let metadata =
            sessions::scan_metadata(Cursor::new(ROW), Provider::ClaudeCode, &KEY).unwrap();
        sessions::join_sources(vec![(tokens, metadata)]).unwrap()
    }
    fn options() -> ExportOptions {
        ExportOptions::new("synthetic_source_v1", START, START + 10_000).unwrap()
    }

    #[test]
    fn native_projection_matches_the_independent_typescript_hmac_fixture() {
        let result = project_sessions(&report(), &KEY, &options())
            .unwrap()
            .to_json()
            .unwrap();
        let actual: serde_json::Value = serde_json::from_str(&result).unwrap();
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../../../fixtures/usage/rich-session-history-v1.json"
        ))
        .unwrap();
        assert_eq!(actual, expected);
        for forbidden in [
            "PRIVATE_DO_NOT_RETAIN",
            "synthetic_source_v1",
            "\"session\"",
            "\"req\"",
            "\"msg\"",
        ] {
            assert!(!result.contains(forbidden));
        }
        let tokens = &actual["facts"][0]["value"]["tokens"];
        assert_eq!(tokens["inputUncached"], "10");
        assert_eq!(tokens["cacheRead"], "100");
        assert_eq!(tokens["output"], "4");
        assert_eq!(tokens["reasoning"], serde_json::Value::Null);
    }
    #[test]
    fn epochs_are_explicit_namespaces_and_windows_are_half_open() {
        let report = report();
        let first = project_sessions(&report, &KEY, &options()).unwrap();
        let same = project_sessions(&report, &KEY, &options()).unwrap();
        assert_eq!(first.to_json(), same.to_json());
        let next = project_sessions(
            &report,
            &KEY,
            &ExportOptions::new("synthetic_source_v2", START, START + 10_000).unwrap(),
        )
        .unwrap();
        assert_ne!(first.provenance.source_id, next.provenance.source_id);
        assert_ne!(first.facts[0].id, next.facts[0].id);
        assert_ne!(
            first.facts[0].owner.execution_id,
            next.facts[0].owner.execution_id
        );
        let excluded = project_sessions(
            &report,
            &KEY,
            &ExportOptions::new("synthetic_source_v1", START, START + 2_000).unwrap(),
        )
        .unwrap();
        assert!(excluded.facts.is_empty());
        assert_eq!(excluded.coverage.usage, "partial");
        let included = project_sessions(
            &report,
            &KEY,
            &ExportOptions::new("synthetic_source_v1", START + 2_000, START + 2_001).unwrap(),
        )
        .unwrap();
        assert_eq!(included.facts.len(), 1);
    }
    #[test]
    fn exact_option_boundaries_and_zero_keys_refuse_before_projection() {
        assert!(
            ExportOptions::new(&"a".repeat(128), MAX_EPOCH_MS - MAX_WINDOW_MS, MAX_EPOCH_MS)
                .is_ok()
        );
        for epoch in ["", "with space", "private/path", "é", &"a".repeat(129)] {
            assert!(ExportOptions::new(epoch, 0, 1).is_err());
        }
        for (start, end) in [
            (0, 0),
            (2, 1),
            (0, MAX_WINDOW_MS + 1),
            (MAX_EPOCH_MS, MAX_EPOCH_MS + 1),
            (u64::MAX, 1),
        ] {
            assert!(ExportOptions::new("ok", start, end).is_err());
        }
        assert_eq!(
            project_sessions(&report(), &[0; 32], &options()).err(),
            Some("invalid_key")
        );
    }
    #[test]
    fn bounded_serialization_accepts_exact_capacity_and_never_emits_an_extra_byte() {
        let mut output = BoundedOutput { bytes: Vec::new() };
        output.write_all(&vec![0; MAX_REPORT_BYTES]).unwrap();
        assert!(output.write_all(&[0]).is_err());
        assert_eq!(output.bytes.len(), MAX_REPORT_BYTES);
        output.flush().unwrap();
    }
    #[test]
    fn a_valid_record_count_can_still_refuse_the_serialized_body_capacity() {
        let mut report = report();
        // Distinct, already-normalized observations: record capacity does not waive byte capacity.
        for index in 1..12_000 {
            report.sessions[0].usage.push(sessions::SessionUsage {
                id: format!("{index:032x}"),
                at_ms: START + 2_000,
                model: Some("claude-sonnet-4-6"),
                model_basis: "response",
                input_tokens: 10,
                cache_read_tokens: 100,
                cache_write_tokens: 0,
                output_tokens: 4,
                reasoning_tokens: None,
            });
        }
        let projected = project_sessions(&report, &KEY, &options()).unwrap();
        assert_eq!(projected.facts.len(), 12_000);
        assert_eq!(projected.to_json(), Err("report_size_limit"));
    }
}
