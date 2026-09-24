//! Local session projection. Token arithmetic and copied-record resolution are
//! owned by the established usage collector; this module only joins metadata.
use crate::{Collection, Warning};
use aicharts_protocol::{Id, Provider};
use serde::{
    de::{self, IgnoredAny, Visitor},
    Deserialize, Deserializer, Serialize,
};
use std::{collections::BTreeMap, fmt, io::BufRead};

pub const PROFILE: &str = "session-observations-v1";
pub const MAX_SOURCE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_LINES: u64 = 100_000;
pub const MAX_SESSIONS: usize = 2_000;
pub const MAX_RECORDS: usize = 50_000;
const MAX_EPOCH_MS: u64 = 8_640_000_000_000_000;
const MAX_WINDOW_MS: u64 = 366 * 86_400_000;

#[derive(Deserialize)]
struct Entry {
    #[serde(rename = "type", default)]
    kind: crate::schema::Kind,
    #[serde(rename = "requestId")]
    request_id: Option<crate::schema::NativeId>,
    #[serde(rename = "sessionId")]
    session_id: Option<crate::schema::NativeId>,
    #[serde(default, deserialize_with = "crate::schema::metadata_object")]
    message: Option<Message>,
}
#[derive(Deserialize)]
struct Message {
    id: Option<crate::schema::NativeId>,
    model: Option<ModelLabel>,
    usage: Option<IgnoredAny>,
}

#[derive(Deserialize)]
struct CodexEntry {
    #[serde(rename = "type", default)]
    kind: crate::schema::Kind,
    timestamp: Option<crate::schema::Timestamp>,
    #[serde(default, deserialize_with = "crate::schema::metadata_object")]
    payload: Option<CodexPayload>,
}
#[derive(Deserialize)]
struct CodexPayload {
    #[serde(rename = "type", default)]
    kind: crate::schema::Kind,
    id: Option<crate::schema::NativeId>,
    /// Session metadata carries the requested model. It is never treated as
    /// proof of the effective response model.
    /// Outer `None` means the field was omitted (retain the prior setting);
    /// `Some(None)` is an explicit null and clears attribution.
    #[serde(default, deserialize_with = "request_model_update")]
    model: Option<Option<RequestModel>>,
}
fn request_model_update<'de, D: Deserializer<'de>>(
    decoder: D,
) -> Result<Option<Option<RequestModel>>, D::Error> {
    Option::<RequestModel>::deserialize(decoder).map(Some)
}
struct RequestModel(Option<&'static str>);
impl<'de> Deserialize<'de> for RequestModel {
    fn deserialize<D: Deserializer<'de>>(decoder: D) -> Result<Self, D::Error> {
        struct Label;
        impl Visitor<'_> for Label {
            type Value = RequestModel;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a model identifier")
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
                Ok(RequestModel(
                    MODELS
                        .iter()
                        .copied()
                        .find(|m| m.starts_with("gpt-") && *m == value),
                ))
            }
        }
        decoder.deserialize_str(Label)
    }
}
struct ModelLabel(Option<&'static str>);
impl<'de> Deserialize<'de> for ModelLabel {
    fn deserialize<D: Deserializer<'de>>(decoder: D) -> Result<Self, D::Error> {
        struct Label;
        impl Visitor<'_> for Label {
            type Value = ModelLabel;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a model identifier")
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
                // Unknown strings are never copied or retained as model labels.
                Ok(ModelLabel(
                    MODELS
                        .iter()
                        .copied()
                        .find(|m| m.starts_with("claude-") && *m == value),
                ))
            }
        }
        decoder.deserialize_str(Label)
    }
}

#[derive(Clone, PartialEq, Eq)]
struct OccurrenceMetadata {
    execution: Id,
    conversation: Option<Id>,
    model: Option<&'static str>,
    basis: &'static str,
}
#[derive(Default)]
pub struct Metadata {
    occurrences: BTreeMap<Id, OccurrenceMetadata>,
    request_models: BTreeMap<Id, Option<&'static str>>,
}

/// Read only provider occurrence ownership and allowlisted model metadata. A
/// Codex model is request attribution; it is never effective response proof.
pub fn scan_metadata<R: BufRead>(
    mut reader: R,
    provider: Provider,
    key: &[u8; 32],
) -> Result<Metadata, &'static str> {
    let mut out = Metadata::default();
    let mut lines = 0u64;
    if provider == Provider::Devin {
        let document = crate::read_atif(&mut reader).map_err(|e| e.code())?;
        if !document
            .schema_version
            .is_some_and(|version| version.0.starts_with("ATIF-v1."))
            || document
                .agent
                .and_then(|agent| agent.name)
                .is_none_or(|name| name.0 != "devin")
        {
            return Err("malformed_record");
        }
        let Some(session_id) = document.session_id else {
            return Ok(out);
        };
        let execution = crate::keyed_id(key, b"devin-execution", &[session_id.0.as_bytes()]);
        let conversation = crate::keyed_id(key, b"devin-conversation", &[session_id.0.as_bytes()]);
        for (index, step) in document.steps.iter().enumerate() {
            if step.source != crate::schema::StepSource::Agent || step.metrics.is_none() {
                continue;
            }
            let step_key = step
                .step_id
                .as_ref()
                .map_or_else(|| index.to_string(), |id| id.0.clone());
            let value = OccurrenceMetadata {
                execution,
                conversation: Some(conversation),
                model: step
                    .extra
                    .as_ref()
                    .and_then(|extra| extra.generation_model.as_ref())
                    .and_then(|model| DEVIN_MODELS.iter().copied().find(|m| *m == model.0)),
                basis: "response",
            };
            let id = crate::devin_usage_id(key, &execution, step_key.as_bytes());
            if out.occurrences.get(&id).is_some_and(|old| old != &value) {
                return Err("conflicting_occurrence");
            }
            out.occurrences.insert(id, value);
            if out.occurrences.len() > MAX_RECORDS {
                return Err("record_limit");
            }
        }
        return Ok(out);
    }
    if provider == Provider::Codex {
        let mut execution = None;
        let mut requested_model = None;
        let mut model_observed = false;
        loop {
            let next =
                crate::reader::next_record::<_, CodexEntry>(&mut reader).map_err(|e| e.code())?;
            if matches!(next, crate::reader::Next::End) {
                break;
            }
            lines += 1;
            if lines > MAX_LINES {
                return Err("record_limit");
            }
            let crate::reader::Next::Parsed(entry) = next else {
                continue;
            };
            let Some(payload) = entry.payload else {
                continue;
            };
            if entry.kind == crate::schema::Kind::SessionMeta {
                if let Some(id) = payload.id {
                    execution = Some(crate::keyed_id(key, b"codex-execution", &[id.0.as_bytes()]));
                }
                if let Some(model) = payload.model {
                    requested_model = model.and_then(|value| value.0);
                    model_observed = true;
                }
                continue;
            }
            if entry.kind != crate::schema::Kind::EventMsg
                || payload.kind != crate::schema::Kind::TokenCount
                || execution.is_none()
            {
                continue;
            }
            let Some((day, offset)) = crate::timestamp(entry.timestamp.as_ref()) else {
                continue;
            };
            let execution_id = execution.unwrap();
            let day_bytes = day.to_le_bytes();
            let offset_bytes = offset.to_le_bytes();
            let id = crate::keyed_id(
                key,
                b"codex-usage",
                &[&execution_id, &day_bytes, &offset_bytes],
            );
            if model_observed {
                match out.request_models.get(&id) {
                    Some(old) if old != &requested_model => return Err("conflicting_occurrence"),
                    _ => {
                        out.request_models.insert(id, requested_model);
                    }
                }
                if out.request_models.len() > MAX_RECORDS {
                    return Err("record_limit");
                }
            }
        }
        return Ok(out);
    }
    let mut lines = 0;
    loop {
        let next = crate::reader::next_record::<_, Entry>(&mut reader).map_err(|e| e.code())?;
        if matches!(next, crate::reader::Next::End) {
            break;
        }
        lines += 1;
        if lines > MAX_LINES {
            return Err("record_limit");
        }
        let crate::reader::Next::Parsed(entry) = next else {
            continue;
        };
        if entry.kind != crate::schema::Kind::Assistant {
            continue;
        }
        let Some(message) = entry.message else {
            continue;
        };
        let (Some(request), Some(message_id), Some(_)) =
            (entry.request_id, message.id, message.usage)
        else {
            continue;
        };
        let id = crate::keyed_id(
            key,
            b"claude-usage",
            &[request.0.as_bytes(), message_id.0.as_bytes()],
        );
        let Some(session) = entry.session_id else {
            continue;
        };
        // Sidechain markers are transcript-local (see the usage parser); the
        // session is the stable execution attribution for one occurrence.
        let execution = crate::keyed_id(key, b"claude-execution", &[session.0.as_bytes()]);
        let value = OccurrenceMetadata {
            execution,
            conversation: Some(crate::keyed_id(
                key,
                b"claude-conversation",
                &[session.0.as_bytes()],
            )),
            model: message.model.and_then(|m| m.0),
            basis: "response",
        };
        match out.occurrences.get(&id) {
            Some(old)
                if old.execution != value.execution || old.conversation != value.conversation =>
            {
                return Err("conflicting_occurrence");
            }
            Some(old)
                if old.model.is_some() && value.model.is_some() && old.model != value.model =>
            {
                return Err("conflicting_occurrence");
            }
            Some(old) => {
                if old.model.is_none() && value.model.is_some() {
                    out.occurrences.insert(id, value);
                }
            }
            None => {
                out.occurrences.insert(id, value);
            }
        }
        if out.occurrences.len() > MAX_RECORDS {
            return Err("record_limit");
        }
    }
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsage {
    pub(crate) id: String,
    pub(crate) at_ms: u64,
    pub(crate) model: Option<&'static str>,
    pub(crate) model_basis: &'static str,
    pub(crate) input_tokens: u64,
    pub(crate) cache_read_tokens: u64,
    pub(crate) cache_write_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) reasoning_tokens: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    start_ms: u64,
    end_ms: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionObservation {
    pub(crate) provider: &'static str,
    pub(crate) session_id: String,
    pub(crate) conversation_id: Option<String>,
    window: Window,
    source: &'static str,
    pub(crate) usage: Vec<SessionUsage>,
    spans: [(); 0],
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionReport {
    schema_version: u8,
    profile: &'static str,
    pub(crate) sessions: Vec<SessionObservation>,
}
impl SessionReport {
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }
}
fn hex(id: Id) -> String {
    id.iter().map(|b| format!("{b:02x}")).collect()
}

/// Keep daily token normalization authoritative, including cumulative baselines,
/// older copied Claude revisions, session-level execution attribution and
/// unknown cache TTLs.
pub fn join_sources(sources: Vec<(Collection, Metadata)>) -> Result<SessionReport, &'static str> {
    let mut metadata = BTreeMap::new();
    let mut reasoning_known = BTreeMap::new();
    let mut collections = Vec::new();
    let mut rows = 0usize;
    let mut lines = 0u64;
    for (collection, projection) in sources {
        lines = lines
            .checked_add(collection.lines_read)
            .filter(|n| *n <= MAX_LINES)
            .ok_or("record_limit")?;
        let known = !collection.warnings.contains(&Warning::UnmeasuredReasoning);
        for batch in &collection.batches {
            for usage in &batch.usage {
                rows += 1;
                if rows > MAX_RECORDS {
                    return Err("record_limit");
                }
                reasoning_known
                    .entry(usage.id)
                    .and_modify(|value| *value = *value && known)
                    .or_insert(known);
                if let Some(value) = projection.occurrences.get(&usage.id) {
                    if value.execution != usage.execution_id
                        || metadata.get(&usage.id).is_some_and(|old| old != value)
                    {
                        return Err("conflicting_occurrence");
                    }
                    metadata.insert(usage.id, value.clone());
                }
                if let Some(model) = projection.request_models.get(&usage.id) {
                    let value = OccurrenceMetadata {
                        execution: usage.execution_id,
                        conversation: None,
                        model: *model,
                        basis: "request",
                    };
                    if metadata.get(&usage.id).is_some_and(|old| old != &value) {
                        return Err("conflicting_occurrence");
                    }
                    metadata.insert(usage.id, value);
                }
            }
        }
        collections.push(collection);
    }
    let collected = crate::merge_collections(collections).map_err(|e| e.code())?;
    let mut sessions: BTreeMap<(u8, Id), SessionObservation> = BTreeMap::new();
    for batch in collected.batches {
        for usage in batch.usage {
            if usage.execution_id == [0; 16] {
                continue;
            }
            let at_ms = batch.utc_day as u64 * 86_400_000 + usage.offset_ms as u64;
            if at_ms > MAX_EPOCH_MS {
                return Err("invalid_window");
            }
            let meta = metadata.get(&usage.id);
            let model = meta.and_then(|m| m.model);
            let model_basis = meta
                .filter(|metadata| metadata.model.is_some())
                .map(|metadata| metadata.basis)
                .unwrap_or("unknown");
            let conversation = meta.and_then(|m| m.conversation).map(hex);
            let record = SessionUsage {
                id: hex(usage.id),
                at_ms,
                model,
                model_basis,
                input_tokens: usage.tokens.input_uncached,
                cache_read_tokens: usage.tokens.cache_read,
                cache_write_tokens: usage.tokens.cache_write_5m + usage.tokens.cache_write_1h,
                output_tokens: usage.tokens.output,
                reasoning_tokens: reasoning_known
                    .get(&usage.id)
                    .copied()
                    .unwrap_or(false)
                    .then_some(usage.tokens.reasoning_output),
            };
            let session = sessions
                .entry((usage.provider as u8, usage.execution_id))
                .or_insert_with(|| SessionObservation {
                    provider: match usage.provider {
                        Provider::Codex => "codex",
                        Provider::ClaudeCode => "claude_code",
                        Provider::Devin => "devin",
                    },
                    session_id: hex(usage.execution_id),
                    conversation_id: conversation.clone(),
                    window: Window {
                        start_ms: at_ms,
                        end_ms: at_ms,
                    },
                    source: "history",
                    usage: Vec::new(),
                    spans: [],
                });
            if session.conversation_id != conversation {
                return Err("conflicting_occurrence");
            }
            session.window.start_ms = session.window.start_ms.min(at_ms);
            session.window.end_ms = session.window.end_ms.max(at_ms);
            if session.window.end_ms - session.window.start_ms > MAX_WINDOW_MS {
                return Err("invalid_window");
            }
            session.usage.push(record);
            if sessions.len() > MAX_SESSIONS {
                return Err("session_limit");
            }
        }
    }
    Ok(SessionReport {
        schema_version: 1,
        profile: PROFILE,
        sessions: sessions.into_values().collect(),
    })
}

const MODELS: &[&str] = &[
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-5-codex",
    "gpt-5.1",
    "gpt-5.1-codex",
    "gpt-5.1-codex-mini",
    "gpt-5.1-codex-max",
    "gpt-5.2",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.5",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-6-astra",
    "claude-opus-4-1-20250805",
    "claude-opus-4-5-20251101",
    "claude-opus-4-6",
    "claude-opus-4-7",
    "claude-sonnet-4-20250514",
    "claude-sonnet-4-5-20250929",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
];

/// Response-model slugs Devin steps report under `extra.generation_model`.
const DEVIN_MODELS: &[&str] = &["gpt-6-astra-high", "gpt-6-astra-max", "swe-2-max"];

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    const KEY: [u8; 32] = [9; 32];
    fn source(text: &str, provider: Provider) -> (Collection, Metadata) {
        (
            crate::parse_reader(Cursor::new(text), provider, &KEY).unwrap(),
            scan_metadata(Cursor::new(text), provider, &KEY).unwrap(),
        )
    }
    fn claude(output: u64, model: &str, suffix: &str) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"2026-01-01T00:00:0{suffix}Z","requestId":"req","sessionId":"session","message":{{"id":"msg","model":"{model}","content":"PRIVATE_DO_NOT_RETAIN","usage":{{"input_tokens":10,"cache_read_input_tokens":100,"output_tokens":{output}}}}}}}
"#
        )
    }
    #[test]
    fn copied_and_older_claude_revisions_keep_cache_and_unknown_reasoning() {
        let newer = claude(4, "claude-sonnet-4-6", "2");
        let older = claude(2, "claude-sonnet-4-6", "1");
        let report = join_sources(vec![
            source(&newer, Provider::ClaudeCode),
            source(&older, Provider::ClaudeCode),
            source(&newer, Provider::ClaudeCode),
        ])
        .unwrap();
        let s = &report.sessions[0];
        assert_eq!(report.sessions.len(), 1);
        assert_eq!(s.usage.len(), 1);
        assert_eq!(s.usage[0].input_tokens, 10);
        assert_eq!(s.usage[0].cache_read_tokens, 100);
        assert_eq!(s.usage[0].output_tokens, 4);
        assert_eq!(s.usage[0].reasoning_tokens, None);
        assert_eq!(s.usage[0].model_basis, "response");
        assert!(s.conversation_id.is_some());
        let bytes = serde_json::to_string(&report).unwrap();
        assert_eq!(
            bytes,
            include_str!("../../../fixtures/usage/session-history-v1.json").trim()
        );
        assert!(!bytes.contains("PRIVATE_DO_NOT_RETAIN"));
        assert!(!bytes.contains("\"req\"") && !bytes.contains("\"session\""));
    }
    #[test]
    fn unknown_claude_model_has_unknown_basis_in_the_cross_runtime_fixture() {
        let report = join_sources(vec![source(
            &claude(4, "PRIVATE_MODEL", "2"),
            Provider::ClaudeCode,
        )])
        .unwrap();
        assert_eq!(report.sessions[0].usage[0].model, None);
        assert_eq!(report.sessions[0].usage[0].model_basis, "unknown");
        assert_eq!(
            serde_json::to_string(&report).unwrap(),
            include_str!("../../../fixtures/usage/session-unknown-model-v1.json").trim()
        );
    }
    #[test]
    fn codex_cumulative_snapshots_are_increments_not_repeated_totals() {
        let mut text =
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"native\",\"model\":\"gpt-5.5\"}}\n"
                .to_owned();
        for (i, total) in [100, 200, 300].iter().enumerate() {
            text.push_str(&format!(r#"{{"type":"event_msg","timestamp":"2026-01-01T00:00:0{i}Z","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":{total},"output_tokens":0}},"last_token_usage":{{"input_tokens":100,"output_tokens":0}}}}}}}}
"#));
        }
        let report = join_sources(vec![
            source(&text, Provider::Codex),
            source(&text, Provider::Codex),
        ])
        .unwrap();
        assert_eq!(
            report.sessions[0]
                .usage
                .iter()
                .map(|u| u.input_tokens)
                .sum::<u64>(),
            300
        );
        assert!(report.sessions[0]
            .usage
            .iter()
            .all(|u| u.model == Some("gpt-5.5")
                && u.model_basis == "request"
                && u.reasoning_tokens.is_none()));
        assert_eq!(
            report.sessions[0].window.end_ms - report.sessions[0].window.start_ms,
            2_000
        );
    }
    #[test]
    fn no_clock_or_unknown_execution_creates_no_invented_session() {
        let text = "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s\"}}\n";
        assert!(join_sources(vec![source(text, Provider::Codex)])
            .unwrap()
            .sessions
            .is_empty());
        let text = claude(4, "claude-sonnet-4-6", "1").replace(",\"sessionId\":\"session\"", "");
        assert!(join_sources(vec![source(&text, Provider::ClaudeCode)])
            .unwrap()
            .sessions
            .is_empty());
    }
    #[test]
    fn response_model_conflicts_fail_and_custom_labels_are_discarded() {
        let first = claude(2, "claude-sonnet-4-6", "1");
        let second = claude(4, "claude-opus-4-6", "2");
        assert!(join_sources(vec![
            source(&first, Provider::ClaudeCode),
            source(&second, Provider::ClaudeCode)
        ])
        .is_err());
        let report = join_sources(vec![source(
            &claude(4, "PRIVATE_MODEL", "1"),
            Provider::ClaudeCode,
        )])
        .unwrap();
        assert!(report.sessions[0].usage[0].model.is_none());
        assert!(!serde_json::to_string(&report)
            .unwrap()
            .contains("PRIVATE_MODEL"));
    }
    #[test]
    fn subagent_usage_joins_the_parent_session() {
        // A delegated call logged unmarked in the parent transcript and
        // marked isSidechain/agentId in the subagent file is one occurrence;
        // the session is the only attribution stable across both copies.
        let root = claude(2, "claude-sonnet-4-6", "1");
        let child = claude(4, "claude-opus-4-6", "2")
            .replace("\"req\"", "\"child-req\"")
            .replace(
                "\"sessionId\":\"session\"",
                "\"sessionId\":\"session\",\"agentId\":\"agent\",\"isSidechain\":true",
            );
        let report = join_sources(vec![
            source(&root, Provider::ClaudeCode),
            source(&child, Provider::ClaudeCode),
        ])
        .unwrap();
        assert_eq!(report.sessions.len(), 1);
        assert_eq!(report.sessions[0].usage.len(), 2);
    }
    #[test]
    fn subagent_marked_copy_of_one_call_does_not_conflict() {
        let parent = claude(2, "claude-sonnet-4-6", "1");
        let child = parent.replace(
            "\"sessionId\":\"session\"",
            "\"sessionId\":\"session\",\"agentId\":\"agent\",\"isSidechain\":true",
        );
        let report = join_sources(vec![
            source(&parent, Provider::ClaudeCode),
            source(&child, Provider::ClaudeCode),
        ])
        .unwrap();
        assert_eq!(report.sessions.len(), 1);
        assert_eq!(report.sessions[0].usage.len(), 1);
        assert_eq!(report.sessions[0].usage[0].output_tokens, 2);
    }
    #[test]
    fn metadata_clock_and_unrelated_payload_cannot_expand_token_window() {
        let text = format!(
            "{}{}",
            claude(2, "claude-sonnet-4-6", "1"),
            "{\"type\":\"user\",\"timestamp\":\"2099-01-01T00:00:00Z\",\"content\":\"private\"}\n"
        );
        let report = join_sources(vec![source(&text, Provider::ClaudeCode)]).unwrap();
        assert_eq!(
            report.sessions[0].window.start_ms,
            report.sessions[0].window.end_ms
        );
    }
    #[test]
    fn codex_request_model_changes_bind_to_following_occurrences() {
        let text = concat!(
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"native\",\"model\":\"gpt-5.5\"}}\n",
            "{\"type\":\"event_msg\",\"timestamp\":\"2026-01-01T00:00:01Z\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":100,\"output_tokens\":0},\"last_token_usage\":{\"input_tokens\":100,\"output_tokens\":0}}}}\n",
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"native\",\"model\":\"gpt-5.6-sol\"}}\n",
            "{\"type\":\"event_msg\",\"timestamp\":\"2026-01-01T00:00:02Z\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":200,\"output_tokens\":0},\"last_token_usage\":{\"input_tokens\":100,\"output_tokens\":0}}}}\n",
        );
        let report = join_sources(vec![source(text, Provider::Codex)]).unwrap();
        assert_eq!(report.sessions[0].usage.len(), 2);
        assert_eq!(report.sessions[0].usage[0].model, Some("gpt-5.5"));
        assert_eq!(report.sessions[0].usage[1].model, Some("gpt-5.6-sol"));
        assert!(report.sessions[0]
            .usage
            .iter()
            .all(|u| u.model_basis == "request"));
    }
    #[test]
    fn codex_missing_request_model_stays_unknown() {
        let text = concat!(
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"native\"}}\n",
            "{\"type\":\"event_msg\",\"timestamp\":\"2026-01-01T00:00:01Z\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":100,\"output_tokens\":0},\"last_token_usage\":{\"input_tokens\":100,\"output_tokens\":0}}}}\n",
        );
        let report = join_sources(vec![source(text, Provider::Codex)]).unwrap();
        assert_eq!(report.sessions[0].usage[0].model, None);
        assert_eq!(report.sessions[0].usage[0].model_basis, "unknown");
    }
    #[test]
    fn codex_explicit_null_clears_request_model_but_omission_preserves_it() {
        for (update, expected) in [
            ("", Some("gpt-5.5")),
            (",\"model\":null", None),
            (",\"model\":\"PRIVATE_MODEL\"", None),
        ] {
            let text = format!(
                concat!(
                    "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"native\",\"model\":\"gpt-5.5\"}}}}\n",
                    "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"native\"{update}}}}}\n",
                    "{{\"type\":\"event_msg\",\"timestamp\":\"2026-01-01T00:00:01Z\",\"payload\":{{\"type\":\"token_count\",\"info\":{{\"total_token_usage\":{{\"input_tokens\":100,\"output_tokens\":0}},\"last_token_usage\":{{\"input_tokens\":100,\"output_tokens\":0}}}}}}}}\n",
                ),
                update = update,
            );
            let report = join_sources(vec![source(&text, Provider::Codex)]).unwrap();
            assert_eq!(report.sessions[0].usage[0].model, expected);
            assert_eq!(
                report.sessions[0].usage[0].model_basis,
                if expected.is_some() {
                    "request"
                } else {
                    "unknown"
                }
            );
            assert!(!serde_json::to_string(&report)
                .unwrap()
                .contains("PRIVATE_MODEL"));
        }
    }
    fn atif(session: &str, generation_model: &str) -> String {
        format!(
            "{{\"schema_version\":\"ATIF-v1.7\",\"session_id\":\"{session}\",\"agent\":{{\"name\":\"devin\"}},\"steps\":[{{\"step_id\":1,\"source\":\"agent\",\"timestamp\":\"2026-09-15T10:00:05Z\",\"extra\":{{\"generation_model\":\"{generation_model}\"}},\"message\":{{\"content\":\"PRIVATE_DO_NOT_RETAIN\"}},\"metrics\":{{\"prompt_tokens\":100,\"completion_tokens\":20,\"cached_tokens\":10}}}}]}}"
        )
    }
    #[test]
    fn devin_allowlisted_response_models_and_identity_join_without_content() {
        let known = atif("atif-native", "swe-2-max");
        let unknown = atif("atif-other", "PRIVATE_MODEL");
        let report = join_sources(vec![
            source(&known, Provider::Devin),
            source(&unknown, Provider::Devin),
            source(&known, Provider::Devin),
        ])
        .unwrap();
        assert_eq!(report.sessions.len(), 2);
        let attributed = report
            .sessions
            .iter()
            .find(|s| s.usage[0].model.is_some())
            .unwrap();
        let unattributed = report
            .sessions
            .iter()
            .find(|s| s.usage[0].model.is_none())
            .unwrap();
        assert_eq!(attributed.provider, "devin");
        assert_eq!(attributed.usage.len(), 1);
        assert_eq!(attributed.usage[0].model, Some("swe-2-max"));
        assert_eq!(attributed.usage[0].model_basis, "response");
        assert_eq!(attributed.usage[0].input_tokens, 90);
        assert_eq!(attributed.usage[0].cache_read_tokens, 10);
        assert_eq!(attributed.usage[0].output_tokens, 20);
        assert_eq!(attributed.usage[0].reasoning_tokens, None);
        assert!(attributed.conversation_id.is_some());
        assert_eq!(unattributed.usage[0].model_basis, "unknown");
        let bytes = serde_json::to_string(&report).unwrap();
        assert!(!bytes.contains("PRIVATE_DO_NOT_RETAIN"));
        assert!(!bytes.contains("PRIVATE_MODEL"));
        assert!(!bytes.contains("atif-native") && !bytes.contains("atif-other"));
    }
    #[test]
    fn devin_foreign_or_unsupported_documents_fail_before_metadata() {
        for text in [
            atif("atif-native", "swe-2-max").replace("\"devin\"", "\"other-agent\""),
            atif("atif-native", "swe-2-max").replace("ATIF-v1.7", "ATIF-v2.0"),
            "{not json".to_owned(),
        ] {
            assert!(scan_metadata(Cursor::new(&text), Provider::Devin, &KEY).is_err());
        }
    }
}
