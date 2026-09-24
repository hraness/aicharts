//! Opt-in local projection of owned session observations. No files, state or network.
//! This producer has no lineage, request lifecycle, exact timing or complete coverage.

use crate::sessions::SessionReport;
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use std::io::{self, Write};

pub const PROFILE: &str = "rich-facts-v1";
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
struct Window {
    start_ms: u64,
    end_ms: u64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Provenance {
    profile: &'static str,
    version: u8,
    source_id: String,
}
#[derive(Serialize)]
struct Coverage {
    usage: &'static str,
    span: &'static str,
    request: &'static str,
    turn: &'static str,
    tool: &'static str,
    context: &'static str,
    compaction: &'static str,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Owner {
    provider: &'static str,
    account_id: Option<String>,
    execution_id: String,
    conversation_id: Option<String>,
    lineage: &'static str,
    parent_execution_id: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Tokens {
    input_uncached: String,
    cache_read: String,
    cache_write5m: String,
    cache_write1h: String,
    cache_write_unknown: String,
    output: String,
    reasoning: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Usage {
    kind: &'static str,
    grain: &'static str,
    token_scope: &'static str,
    observation_id: String,
    model: Option<&'static str>,
    model_basis: &'static str,
    tokens: Tokens,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Fact {
    id: String,
    revision: u32,
    provenance: Provenance,
    owner: Owner,
    kind: &'static str,
    at_ms: u64,
    value: Usage,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    schema_version: u8,
    profile: &'static str,
    provenance: Provenance,
    window: Window,
    coverage: Coverage,
    facts: Vec<Fact>,
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

fn keyed(
    key: &[u8; 32],
    epoch: &str,
    domain: &str,
    values: &[&str],
) -> Result<String, &'static str> {
    // Exact JSON-array bytes match rich-fact-adapters.ts; all inputs are bounded ASCII.
    let mut parts = vec![
        "aicharts-rich-facts-v1",
        crate::sessions::PROFILE,
        epoch,
        domain,
    ];
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
    let hash = |domain, values: &[&str]| keyed(key, &options.source_epoch, domain, values);
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
                value,
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
