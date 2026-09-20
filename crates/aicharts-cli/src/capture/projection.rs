use super::{Result, MAX_BYTES};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
const INVALID: &str = "capture_stream_invalid";
const MAX_RECORDS: usize = 100_000;
const MAX_TURNS: usize = 16_384;
const MAX_LINE: usize = 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Usage {
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Message {
    role: String,
    turn_id: String,
    timestamp: u64,
    usage: Usage,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Model {
    provider_id: String,
    model_id: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
enum Event {
    #[serde(rename = "message")]
    Message { message: Message },
    #[serde(rename = "exec.result", rename_all = "camelCase")]
    Result {
        turn_id: String,
        session_id: String,
        status: String,
        model: Model,
    },
}
#[derive(Default, Clone)]
struct Turn {
    messages: Vec<Message>,
    result: Option<Event>,
}
#[derive(Default)]
pub(super) struct Projection {
    turns: BTreeMap<String, Turn>,
    records: usize,
    line: Vec<u8>,
    complete: bool,
}
fn id(value: &Value) -> Result<String> {
    let value = value
        .as_str()
        .filter(|v| !v.is_empty() && v.len() <= 1024)
        .ok_or(INVALID)?;
    if value.chars().any(char::is_control) || value.trim() != value {
        return Err(INVALID);
    }
    Ok(Sha256::digest(format!("aicharts:mcode-id:v1\0{value}"))
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}
fn model_id(value: &Value) -> Result<String> {
    let value = value
        .as_str()
        .filter(|v| !v.is_empty() && v.len() <= 256)
        .ok_or(INVALID)?;
    if !value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'/' | b':' | b'@'))
    {
        return Err(INVALID);
    }
    Ok(value.into())
}
fn counter(value: Option<&Value>) -> Result<u64> {
    match value {
        None => Ok(0),
        Some(value) => value
            .as_u64()
            .filter(|v| *v < i64::MAX as u64)
            .ok_or(INVALID),
    }
}
impl Projection {
    pub(super) fn push(&mut self, bytes: &[u8], now_ms: u64) -> Result<()> {
        if self.complete {
            return Err(INVALID);
        }
        for byte in bytes {
            if *byte == b'\n' {
                let line = std::mem::take(&mut self.line);
                self.source_line(&line, now_ms)?;
            } else {
                if self.line.len() >= MAX_LINE {
                    return Err("capture_line_limit");
                }
                self.line.push(*byte);
            }
        }
        Ok(())
    }
    fn source_line(&mut self, line: &[u8], now_ms: u64) -> Result<()> {
        if line.iter().all(u8::is_ascii_whitespace) {
            return Ok(());
        }
        let value: Value = serde_json::from_slice(line).map_err(|_| INVALID)?;
        let kind = value.get("type").and_then(Value::as_str).ok_or(INVALID)?;
        match kind {
            "message" => {
                let message = value
                    .get("message")
                    .and_then(Value::as_object)
                    .ok_or(INVALID)?;
                if message.get("role").and_then(Value::as_str) != Some("assistant") {
                    return Ok(());
                }
                let Some(usage) = message.get("usage") else {
                    return Ok(());
                };
                if !usage.is_object() {
                    return Err(INVALID);
                }
                let turn_id = id(message.get("turnId").ok_or(INVALID)?)?;
                let raw_time = message
                    .get("timestamp")
                    .and_then(Value::as_u64)
                    .ok_or(INVALID)?;
                let timestamp = if raw_time < 10_000_000_000 {
                    raw_time.checked_mul(1000).ok_or(INVALID)?
                } else {
                    raw_time
                };
                if timestamp == 0 || timestamp > now_ms.saturating_add(60_000) {
                    return Err(INVALID);
                }
                let usage = Usage {
                    input_tokens: counter(usage.get("inputTokens"))?,
                    output_tokens: counter(usage.get("outputTokens"))?,
                    cache_read_tokens: counter(usage.get("cacheReadTokens"))?,
                    cache_write_tokens: counter(usage.get("cacheWriteTokens"))?,
                };
                let total = [
                    usage.input_tokens,
                    usage.output_tokens,
                    usage.cache_read_tokens,
                    usage.cache_write_tokens,
                ]
                .iter()
                .try_fold(0u64, |sum, n| sum.checked_add(*n))
                .ok_or(INVALID)?;
                if total == 0 {
                    return Ok(());
                }
                if total >= i64::MAX as u64 || self.records >= MAX_RECORDS {
                    return Err("capture_record_limit");
                }
                let turn = self.turn(&turn_id)?;
                if turn.result.is_some() {
                    return Err("capture_turn_already_complete");
                }
                turn.messages.push(Message {
                    role: "assistant".into(),
                    turn_id,
                    timestamp,
                    usage,
                });
                self.records += 1;
            }
            "exec.result" => {
                let turn_id = id(value.get("turnId").ok_or(INVALID)?)?;
                let session_id = id(value.get("sessionId").ok_or(INVALID)?)?;
                if value.get("status").and_then(Value::as_str) != Some("succeeded") {
                    return Err("capture_result_failed");
                }
                let model = value.get("model").ok_or(INVALID)?;
                let model = Model {
                    provider_id: model_id(model.get("providerId").ok_or(INVALID)?)?,
                    model_id: model_id(model.get("modelId").ok_or(INVALID)?)?,
                };
                let result = Event::Result {
                    turn_id: turn_id.clone(),
                    session_id,
                    status: "succeeded".into(),
                    model,
                };
                let turn = self.turn(&turn_id)?;
                if turn.result.is_some() {
                    return Err("capture_duplicate_result");
                }
                turn.result = Some(result);
            }
            _ => {} // Content-bearing event payloads are deliberately discarded.
        }
        Ok(())
    }
    fn turn(&mut self, id: &str) -> Result<&mut Turn> {
        if !self.turns.contains_key(id) && self.turns.len() >= MAX_TURNS {
            return Err("capture_turn_limit");
        }
        Ok(self.turns.entry(id.to_owned()).or_default())
    }
    pub(super) fn finish(&mut self, now_ms: u64) -> Result<()> {
        if self.complete {
            return Err(INVALID);
        }
        if !self.line.is_empty() {
            let line = std::mem::take(&mut self.line);
            self.source_line(&line, now_ms)?;
        }
        if self.records == 0 {
            return Err("capture_no_usage");
        }
        if self.turns.values().any(|turn| turn.result.is_none()) {
            return Err("capture_incomplete");
        }
        // Turn identifiers may only be unique within one session. Bind them
        // after the authoritative result arrives, before persisting history.
        let mut bound = BTreeMap::new();
        for (_, mut turn) in std::mem::take(&mut self.turns) {
            let Some(Event::Result {
                turn_id,
                session_id,
                ..
            }) = turn.result.as_mut()
            else {
                return Err("capture_incomplete");
            };
            let combined = Sha256::digest(format!(
                "aicharts:mcode-session-turn:v1\0{session_id}\0{turn_id}"
            ));
            let key: String = combined.iter().map(|byte| format!("{byte:02x}")).collect();
            *turn_id = key.clone();
            for message in &mut turn.messages {
                message.turn_id = key.clone();
            }
            if bound.insert(key, turn).is_some() {
                return Err("capture_conflicting_turn");
            }
        }
        self.turns = bound;
        self.complete = true;
        Ok(())
    }
    pub(super) fn records(&self) -> usize {
        self.records
    }
    pub(super) fn validate_cache(bytes: &[u8]) -> Result<()> {
        Self::cached(bytes).map(|_| ())
    }
    fn cached(bytes: &[u8]) -> Result<Self> {
        if bytes.is_empty() || bytes.len() > MAX_BYTES || bytes.last() != Some(&b'\n') {
            return Err("capture_cache_invalid");
        }
        let mut result = Self::default();
        for line in bytes.split(|b| *b == b'\n').filter(|line| !line.is_empty()) {
            if line.len() > MAX_LINE {
                return Err("capture_cache_invalid");
            }
            let event: Event = serde_json::from_slice(line).map_err(|_| "capture_cache_invalid")?;
            let (turn_id, message) = match &event {
                Event::Message { message } => (&message.turn_id, Some(message)),
                Event::Result { turn_id, .. } => (turn_id, None),
            };
            if turn_id.len() != 64
                || !turn_id
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            {
                return Err("capture_cache_invalid");
            }
            if let Some(message) = message {
                if result.records >= MAX_RECORDS
                    || message.role != "assistant"
                    || message.timestamp == 0
                    || message.timestamp > 8_640_000_000_000_000
                {
                    return Err("capture_cache_invalid");
                }
                let total = [
                    message.usage.input_tokens,
                    message.usage.output_tokens,
                    message.usage.cache_read_tokens,
                    message.usage.cache_write_tokens,
                ]
                .iter()
                .try_fold(0u64, |sum, n| sum.checked_add(*n))
                .ok_or("capture_cache_invalid")?;
                if total == 0 || total >= i64::MAX as u64 {
                    return Err("capture_cache_invalid");
                }
                let turn = result.turn(turn_id)?;
                if turn.result.is_some() {
                    return Err("capture_cache_invalid");
                }
                turn.messages.push(message.clone());
                result.records += 1;
            } else {
                if let Event::Result {
                    session_id,
                    status,
                    model,
                    ..
                } = &event
                {
                    if session_id.len() != 64
                        || !session_id
                            .bytes()
                            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
                        || status != "succeeded"
                        || model_id(&Value::String(model.provider_id.clone())).is_err()
                        || model_id(&Value::String(model.model_id.clone())).is_err()
                    {
                        return Err("capture_cache_invalid");
                    }
                }
                let turn = result.turn(turn_id)?;
                if turn.result.is_some() {
                    return Err("capture_cache_invalid");
                }
                turn.result = Some(event);
            }
        }
        if result.records == 0 || result.turns.values().any(|turn| turn.result.is_none()) {
            return Err("capture_cache_invalid");
        }
        result.complete = true;
        Ok(result)
    }
    pub(super) fn merge(&self, previous: Option<&[u8]>) -> Result<Vec<u8>> {
        if !self.complete {
            return Err("capture_incomplete");
        }
        let mut merged = previous.map(Self::cached).transpose()?.unwrap_or_default();
        for (id, turn) in &self.turns {
            if let Some(existing) = merged.turns.get(id) {
                if existing.messages != turn.messages || existing.result != turn.result {
                    return Err("capture_conflicting_turn");
                }
            } else {
                if merged.turns.len() >= MAX_TURNS
                    || merged.records + turn.messages.len() > MAX_RECORDS
                {
                    return Err("capture_history_limit");
                }
                merged.records += turn.messages.len();
                merged.turns.insert(id.clone(), turn.clone());
            }
        }
        let mut bytes = Vec::new();
        for turn in merged.turns.values() {
            for event in turn
                .messages
                .iter()
                .map(|message| Event::Message {
                    message: message.clone(),
                })
                .chain(turn.result.clone())
            {
                let line = serde_json::to_vec(&event).map_err(|_| INVALID)?;
                if line.len() + 1 > MAX_BYTES - bytes.len() {
                    return Err("capture_history_limit");
                }
                bytes.extend(line);
                bytes.push(b'\n');
            }
        }
        Ok(bytes)
    }
}
