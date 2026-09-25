//! Request, tool, context and lineage-bearing usage facts from native transcripts.
//! Only bounded identifiers, timestamps, counters and enumerated stop/error flags
//! are read; prompts, tool arguments, results and paths are never retained.
//! Nothing is fabricated: streaming timings, dispatch clocks and retry links are
//! absent from these transcripts, so they are exported as explicit nulls.

use super::{
    keyed, Context, Coverage, ExportOptions, Fact, Owner, Payload, Provenance, Report, Request,
    Tokens, Tool, Usage, MAX_EXECUTIONS, MAX_FACTS, MAX_WINDOW_MS, PROFILE, TRANSCRIPT_PROFILE,
};
use crate::reader::{self, Next};
use aicharts_protocol::Provider;
use serde::{
    de::{self, IgnoredAny, MapAccess, SeqAccess, Visitor},
    Deserialize, Deserializer,
};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fmt,
    io::BufRead,
    marker::PhantomData,
};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

pub const MAX_LINES: u64 = 100_000;
const MAX_TIME_MS: u64 = 8_640_000_000_000_000;
const MAX_TOKENS: u64 = 1_000_000_000_000;
const MAX_BLOCKS: usize = 4_096;

/// Mirror of the session allowlist; `sessions::MODELS` is private to that module.
const CLAUDE_MODELS: &[&str] = &[
    "claude-opus-4-1-20250805",
    "claude-opus-4-5-20251101",
    "claude-opus-4-6",
    "claude-opus-4-7",
    "claude-sonnet-4-20250514",
    "claude-sonnet-4-5-20250929",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
];

/// A bounded scalar: absent, present-and-valid, or present-and-invalid. Invalid
/// values never fail the whole line; the record they qualify is skipped instead.
#[derive(Clone, Default)]
enum Field<T> {
    #[default]
    Missing,
    Value(T),
    Invalid,
}
impl<T> Field<T> {
    fn value(&self) -> Option<&T> {
        match self {
            Self::Value(value) => Some(value),
            _ => None,
        }
    }
}
trait Scalar: Sized {
    fn string(_: &str) -> Option<Self> {
        None
    }
    fn unsigned(_: u64) -> Option<Self> {
        None
    }
    fn boolean(_: bool) -> Option<Self> {
        None
    }
}
impl<'de, T: Scalar> Deserialize<'de> for Field<T> {
    fn deserialize<D: Deserializer<'de>>(decoder: D) -> Result<Self, D::Error> {
        struct ScalarVisitor<T>(PhantomData<T>);
        impl<'de, T: Scalar> Visitor<'de> for ScalarVisitor<T> {
            type Value = Field<T>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("bounded transcript scalar")
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(T::string(v).map_or(Field::Invalid, Field::Value))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(T::unsigned(v).map_or(Field::Invalid, Field::Value))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(u64::try_from(v)
                    .ok()
                    .and_then(T::unsigned)
                    .map_or(Field::Invalid, Field::Value))
            }
            fn visit_f64<E: de::Error>(self, _: f64) -> Result<Self::Value, E> {
                Ok(Field::Invalid)
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(T::boolean(v).map_or(Field::Invalid, Field::Value))
            }
            fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(Field::Missing)
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
                while seq.next_element::<IgnoredAny>()?.is_some() {}
                Ok(Field::Invalid)
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(Field::Invalid)
            }
        }
        decoder.deserialize_any(ScalarVisitor(PhantomData))
    }
}
#[derive(Clone, PartialEq, Eq, Hash)]
struct Id(String);
impl Scalar for Id {
    fn string(value: &str) -> Option<Self> {
        (!value.is_empty()
            && value.len() <= 256
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
        .then(|| Self(value.to_owned()))
    }
}
#[derive(Clone, Copy)]
struct Millis(u64);
impl Scalar for Millis {
    fn string(value: &str) -> Option<Self> {
        if value.len() > 64 {
            return None;
        }
        let nanos = OffsetDateTime::parse(value, &Rfc3339)
            .ok()?
            .unix_timestamp_nanos();
        let ms = u64::try_from(nanos.div_euclid(1_000_000)).ok()?;
        (ms <= MAX_TIME_MS).then_some(Self(ms))
    }
}
#[derive(Clone, Copy)]
struct Count(u64);
impl Scalar for Count {
    fn unsigned(value: u64) -> Option<Self> {
        (value <= MAX_TOKENS).then_some(Self(value))
    }
}
#[derive(Clone, Copy)]
struct Flag(bool);
impl Scalar for Flag {
    fn boolean(value: bool) -> Option<Self> {
        Some(Self(value))
    }
}
#[derive(Clone, Copy)]
struct Label(&'static str);
impl Scalar for Label {
    fn string(value: &str) -> Option<Self> {
        Some(Self(
            CLAUDE_MODELS
                .iter()
                .copied()
                .find(|model| *model == value)?,
        ))
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Stop {
    Success,
    Refusal,
}
impl Scalar for Stop {
    fn string(value: &str) -> Option<Self> {
        match value {
            "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "pause_turn" => {
                Some(Self::Success)
            }
            "refusal" => Some(Self::Refusal),
            _ => None,
        }
    }
}
#[derive(Clone, Copy)]
struct Text<const N: usize>([u8; N], usize);
impl<const N: usize> Text<N> {
    fn as_str(&self) -> &str {
        std::str::from_utf8(&self.0[..self.1]).unwrap_or("")
    }
}
impl<const N: usize> Scalar for Text<N> {
    fn string(value: &str) -> Option<Self> {
        let bytes = value.as_bytes();
        if bytes.is_empty() || bytes.len() > N {
            return None;
        }
        let mut result = [0u8; N];
        result[..bytes.len()].copy_from_slice(bytes);
        Some(Self(result, bytes.len()))
    }
}

/// A bounded array of typed elements; anything else is invalid, not fatal.
#[derive(Default)]
enum Blocks<T> {
    #[default]
    Missing,
    Value(Vec<T>),
    Invalid,
}
impl<'de, T: Deserialize<'de>> Deserialize<'de> for Blocks<T> {
    fn deserialize<D: Deserializer<'de>>(decoder: D) -> Result<Self, D::Error> {
        struct BlocksVisitor<T>(PhantomData<T>);
        impl<'de, T: Deserialize<'de>> Visitor<'de> for BlocksVisitor<T> {
            type Value = Blocks<T>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("bounded block array")
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
                let mut items = Vec::new();
                while let Some(item) = seq.next_element::<T>()? {
                    if items.len() >= MAX_BLOCKS {
                        while seq.next_element::<IgnoredAny>()?.is_some() {}
                        return Ok(Blocks::Invalid);
                    }
                    items.push(item);
                }
                Ok(Blocks::Value(items))
            }
            fn visit_str<E: de::Error>(self, _: &str) -> Result<Self::Value, E> {
                Ok(Blocks::Invalid)
            }
            fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(Blocks::Missing)
            }
            fn visit_bool<E: de::Error>(self, _: bool) -> Result<Self::Value, E> {
                Ok(Blocks::Invalid)
            }
            fn visit_u64<E: de::Error>(self, _: u64) -> Result<Self::Value, E> {
                Ok(Blocks::Invalid)
            }
            fn visit_i64<E: de::Error>(self, _: i64) -> Result<Self::Value, E> {
                Ok(Blocks::Invalid)
            }
            fn visit_f64<E: de::Error>(self, _: f64) -> Result<Self::Value, E> {
                Ok(Blocks::Invalid)
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(Blocks::Invalid)
            }
        }
        decoder.deserialize_any(BlocksVisitor(PhantomData))
    }
}
#[derive(Default)]
enum Object<T> {
    #[default]
    Missing,
    Value(T),
    Invalid,
}
impl<'de, T: Deserialize<'de>> Deserialize<'de> for Object<T> {
    fn deserialize<D: Deserializer<'de>>(decoder: D) -> Result<Self, D::Error> {
        struct ObjectVisitor<T>(PhantomData<T>);
        impl<'de, T: Deserialize<'de>> Visitor<'de> for ObjectVisitor<T> {
            type Value = Object<T>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("optional transcript object")
            }
            fn visit_map<M: MapAccess<'de>>(self, map: M) -> Result<Self::Value, M::Error> {
                T::deserialize(de::value::MapAccessDeserializer::new(map)).map(Object::Value)
            }
            fn visit_seq<S: SeqAccess<'de>>(self, mut seq: S) -> Result<Self::Value, S::Error> {
                while seq.next_element::<IgnoredAny>()?.is_some() {}
                Ok(Object::Invalid)
            }
            fn visit_str<E: de::Error>(self, _: &str) -> Result<Self::Value, E> {
                Ok(Object::Invalid)
            }
            fn visit_bool<E: de::Error>(self, _: bool) -> Result<Self::Value, E> {
                Ok(Object::Invalid)
            }
            fn visit_i64<E: de::Error>(self, _: i64) -> Result<Self::Value, E> {
                Ok(Object::Invalid)
            }
            fn visit_u64<E: de::Error>(self, _: u64) -> Result<Self::Value, E> {
                Ok(Object::Invalid)
            }
            fn visit_f64<E: de::Error>(self, _: f64) -> Result<Self::Value, E> {
                Ok(Object::Invalid)
            }
            fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(Object::Missing)
            }
        }
        decoder.deserialize_any(ObjectVisitor(PhantomData))
    }
}

#[derive(Default, Deserialize)]
struct ClaudeLine {
    #[serde(rename = "type", default)]
    kind: Field<Text<32>>,
    #[serde(default)]
    timestamp: Field<Millis>,
    #[serde(default)]
    uuid: Field<Id>,
    #[serde(rename = "parentUuid", default)]
    parent_uuid: Field<Id>,
    #[serde(rename = "sessionId", default)]
    session_id: Field<Id>,
    #[serde(rename = "requestId", default)]
    request_id: Field<Id>,
    #[serde(rename = "isSidechain", default)]
    is_sidechain: Field<Flag>,
    #[serde(rename = "agentId", default)]
    agent_id: Field<Id>,
    #[serde(rename = "isApiErrorMessage", default)]
    is_api_error: Field<Flag>,
    #[serde(default)]
    message: Object<ClaudeMessage>,
}
#[derive(Default, Deserialize)]
struct ClaudeMessage {
    #[serde(default)]
    id: Field<Id>,
    #[serde(default)]
    model: Field<Label>,
    #[serde(default)]
    stop_reason: Field<Stop>,
    #[serde(default)]
    content: Blocks<ClaudeBlock>,
    #[serde(default)]
    usage: Object<ClaudeUsage>,
}
#[derive(Default, Deserialize)]
struct ClaudeBlock {
    #[serde(rename = "type", default)]
    kind: Field<Text<32>>,
    #[serde(default)]
    id: Field<Id>,
    #[serde(default)]
    tool_use_id: Field<Id>,
    #[serde(default)]
    is_error: Field<Flag>,
}
#[derive(Default, Deserialize)]
struct ClaudeUsage {
    #[serde(default)]
    input_tokens: Field<Count>,
    #[serde(default)]
    output_tokens: Field<Count>,
    #[serde(default)]
    cache_read_input_tokens: Field<Count>,
    #[serde(default)]
    cache_creation_input_tokens: Field<Count>,
    #[serde(default)]
    cache_creation: Object<ClaudeCacheCreation>,
}
#[derive(Default, Deserialize)]
struct ClaudeCacheCreation {
    #[serde(default)]
    ephemeral_5m_input_tokens: Field<Count>,
    #[serde(default)]
    ephemeral_1h_input_tokens: Field<Count>,
}

#[derive(Default, Deserialize)]
struct CodexLine {
    #[serde(rename = "type", default)]
    kind: Field<Text<32>>,
    #[serde(default)]
    timestamp: Field<Millis>,
    #[serde(default)]
    payload: Object<CodexPayload>,
}
#[derive(Default, Deserialize)]
struct CodexPayload {
    #[serde(rename = "type", default)]
    kind: Field<Text<32>>,
    #[serde(default)]
    id: Field<Id>,
    #[serde(default)]
    parent_thread_id: Field<Id>,
    #[serde(default)]
    source: Field<Text<16>>,
    #[serde(default)]
    call_id: Field<Id>,
    #[serde(default)]
    info: Object<CodexInfo>,
}
#[derive(Default, Deserialize)]
struct CodexInfo {
    #[serde(default)]
    last_token_usage: Object<CodexUsage>,
    #[serde(default)]
    model_context_window: Field<Count>,
}
#[derive(Default, Deserialize)]
struct CodexUsage {
    #[serde(default)]
    input_tokens: Field<Count>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct ClaudeTokens {
    input: u64,
    cache_read: u64,
    cache_write: u64,
    write_5m: Option<u64>,
    write_1h: Option<u64>,
    output: u64,
}
struct RequestState {
    owner: Owner,
    session: String,
    first_parent: Option<Id>,
    first_at: u64,
    last_at: u64,
    message_id: Option<Id>,
    tokens: Option<ClaudeTokens>,
    model: Option<&'static str>,
    stop: Option<Stop>,
    error: bool,
    order: usize,
}

/// Per-kind evidence: whether any scanned provider can carry the kind at all,
/// and how many candidate records were skipped for missing or invalid metadata.
#[derive(Default)]
pub struct Measured {
    supported: HashSet<&'static str>,
    pub skipped_records: u64,
    pub lines_read: u64,
}
impl Measured {
    fn coverage(&self) -> Coverage {
        let of = |kind| {
            if self.supported.contains(kind) {
                "partial"
            } else {
                "unsupported"
            }
        };
        Coverage {
            usage: of("usage"),
            span: "unsupported",
            request: of("request"),
            turn: "unsupported",
            tool: of("tool"),
            context: of("context"),
            compaction: "unsupported",
        }
    }
}

struct Producer<'a> {
    key: &'a [u8; 32],
    options: &'a ExportOptions,
    provenance: Provenance,
    facts: Vec<Fact>,
    owners: BTreeMap<String, Owner>,
    measured: Measured,
}
impl Producer<'_> {
    fn hash(&self, domain: &str, values: &[&str]) -> Result<String, &'static str> {
        keyed(
            self.key,
            TRANSCRIPT_PROFILE,
            self.options.source_epoch(),
            domain,
            values,
        )
    }
    fn in_window(&self, at_ms: u64) -> bool {
        at_ms >= self.options.start_ms() && at_ms < self.options.end_ms()
    }
    fn owner(
        &mut self,
        provider: &'static str,
        session: &str,
        child: Option<&str>,
        parent: Option<&str>,
        root_capable: bool,
    ) -> Result<Owner, &'static str> {
        let root = self.hash("execution", &[provider, session])?;
        let owner = match (child, parent) {
            (Some(child), _) => Owner {
                provider,
                account_id: None,
                execution_id: self.hash("execution", &[provider, session, child])?,
                conversation_id: Some(self.hash("conversation", &[provider, session])?),
                lineage: "child",
                parent_execution_id: Some(root.clone()),
            },
            (None, Some(parent)) => Owner {
                provider,
                account_id: None,
                execution_id: root,
                conversation_id: Some(self.hash("conversation", &[provider, parent])?),
                lineage: "child",
                parent_execution_id: Some(self.hash("execution", &[provider, parent])?),
            },
            (None, None) => Owner {
                provider,
                account_id: None,
                execution_id: root,
                conversation_id: Some(self.hash("conversation", &[provider, session])?),
                lineage: if root_capable { "root" } else { "unknown" },
                parent_execution_id: None,
            },
        };
        if let Some(existing) = self.owners.get(&owner.execution_id) {
            if *existing != owner {
                return Err("conflicting_owner");
            }
        } else {
            if self.owners.len() >= MAX_EXECUTIONS {
                return Err("record_limit");
            }
            self.owners
                .insert(owner.execution_id.clone(), owner.clone());
        }
        Ok(owner)
    }
    fn put(
        &mut self,
        owner: &Owner,
        native: &str,
        at_ms: u64,
        value: Payload,
    ) -> Result<(), &'static str> {
        if !self.in_window(at_ms) {
            return Ok(());
        }
        if self.facts.len() >= MAX_FACTS {
            return Err("record_limit");
        }
        let kind = match &value {
            Payload::Usage(_) => "usage",
            Payload::Request(_) => "request",
            Payload::Tool(_) => "tool",
            Payload::Context(_) => "context",
        };
        self.facts.push(Fact {
            id: self.hash("fact", &[owner.provider, &owner.execution_id, kind, native])?,
            revision: 0,
            provenance: self.provenance.clone(),
            owner: owner.clone(),
            kind,
            at_ms,
            value: Some(value),
        });
        Ok(())
    }
    fn tool(
        &mut self,
        owner: &Owner,
        session: &str,
        native: &str,
        stage: &'static str,
        outcome: &'static str,
        at_ms: u64,
    ) -> Result<(), &'static str> {
        let observation_id = self.hash(
            "observation",
            &[owner.provider, session, "tool", native, stage],
        )?;
        self.put(
            owner,
            &format!("{native}:{stage}"),
            at_ms,
            Payload::Tool(Tool {
                kind: "tool",
                observation_id,
                stage,
                outcome,
            }),
        )
    }

    fn scan_claude<R: BufRead>(&mut self, reader: &mut R) -> Result<(), &'static str> {
        for kind in ["usage", "request", "tool", "context"] {
            self.measured.supported.insert(kind);
        }
        let mut users: HashMap<Id, u64> = HashMap::new();
        let mut requests: HashMap<Id, RequestState> = HashMap::new();
        let mut lines = 0u64;
        loop {
            let next = reader::next_record::<_, ClaudeLine>(reader).map_err(|e| e.code())?;
            let line = match next {
                Next::End => break,
                Next::Parsed(line) => line,
                Next::Oversized => {
                    self.measured.skipped_records += 1;
                    continue;
                }
                Next::Blank => continue,
            };
            lines += 1;
            if lines > MAX_LINES {
                return Err("record_limit");
            }
            let kind = line.kind.value().map(Text::as_str).unwrap_or("");
            if kind != "user" && kind != "assistant" {
                continue;
            }
            let (Some(at), Some(session)) = (line.timestamp.value(), line.session_id.value())
            else {
                self.measured.skipped_records += 1;
                continue;
            };
            let at = at.0;
            let child = match (line.agent_id.value(), line.is_sidechain.value()) {
                (Some(agent), _) => Some(agent.0.as_str()),
                (None, Some(Flag(true))) => Some("sidechain"),
                _ => None,
            };
            let owner = self.owner("claude_code", &session.0, child, None, true)?;
            let message = match &line.message {
                Object::Value(message) => Some(message),
                Object::Missing => None,
                Object::Invalid => {
                    self.measured.skipped_records += 1;
                    continue;
                }
            };
            if kind == "user" {
                if let Some(uuid) = line.uuid.value() {
                    if users.len() < MAX_FACTS {
                        users.entry(uuid.clone()).or_insert(at);
                    }
                }
                if let Some(Blocks::Value(blocks)) = message.map(|m| &m.content) {
                    for block in blocks {
                        if block.kind.value().map(Text::as_str) != Some("tool_result") {
                            continue;
                        }
                        let Some(id) = block.tool_use_id.value() else {
                            self.measured.skipped_records += 1;
                            continue;
                        };
                        let outcome = match block.is_error.value() {
                            Some(Flag(true)) => "error",
                            _ => "success",
                        };
                        self.tool(&owner, &session.0, &id.0, "terminal", outcome, at)?;
                    }
                }
                continue;
            }
            let Some(message) = message else {
                self.measured.skipped_records += 1;
                continue;
            };
            if let Blocks::Value(blocks) = &message.content {
                for block in blocks {
                    if block.kind.value().map(Text::as_str) != Some("tool_use") {
                        continue;
                    }
                    let Some(id) = block.id.value() else {
                        self.measured.skipped_records += 1;
                        continue;
                    };
                    self.tool(&owner, &session.0, &id.0, "requested", "unknown", at)?;
                }
            }
            let Some(request) = line.request_id.value() else {
                // API error lines and content-only lines carry no request identity.
                self.measured.skipped_records += 1;
                continue;
            };
            let tokens = match &message.usage {
                Object::Value(usage) => {
                    match (usage.input_tokens.value(), usage.output_tokens.value()) {
                        (Some(input), Some(output)) => {
                            let (write_5m, write_1h) = match &usage.cache_creation {
                                Object::Value(creation) => (
                                    creation.ephemeral_5m_input_tokens.value().map(|c| c.0),
                                    creation.ephemeral_1h_input_tokens.value().map(|c| c.0),
                                ),
                                _ => (None, None),
                            };
                            Some(ClaudeTokens {
                                input: input.0,
                                cache_read: usage
                                    .cache_read_input_tokens
                                    .value()
                                    .map_or(0, |c| c.0),
                                cache_write: usage
                                    .cache_creation_input_tokens
                                    .value()
                                    .map_or(0, |c| c.0),
                                write_5m,
                                write_1h,
                                output: output.0,
                            })
                        }
                        _ => None,
                    }
                }
                _ => None,
            };
            let error = matches!(line.is_api_error.value(), Some(Flag(true)));
            let order = requests.len();
            if !requests.contains_key(request) && order >= MAX_FACTS {
                return Err("record_limit");
            }
            let state = requests
                .entry(request.clone())
                .or_insert_with(|| RequestState {
                    owner: owner.clone(),
                    session: session.0.clone(),
                    first_parent: line.parent_uuid.value().cloned(),
                    first_at: at,
                    last_at: at,
                    message_id: None,
                    tokens: None,
                    model: None,
                    stop: None,
                    error: false,
                    order,
                });
            if state.owner != owner {
                return Err("conflicting_owner");
            }
            state.first_at = state.first_at.min(at);
            if at >= state.last_at {
                state.last_at = at;
                if tokens.is_some() {
                    state.tokens = tokens;
                }
            }
            if let Some(id) = message.id.value() {
                state.message_id.get_or_insert_with(|| id.clone());
            }
            if let Some(label) = message.model.value() {
                state.model.get_or_insert(label.0);
            }
            if let Some(stop) = message.stop_reason.value() {
                state.stop = Some(*stop);
            }
            state.error |= error;
        }
        self.measured.lines_read += lines;
        let mut ordered: Vec<(Id, RequestState)> = requests.into_iter().collect();
        ordered.sort_by_key(|(_, state)| state.order);
        let mut responses: HashSet<Id> = HashSet::new();
        for (request, state) in ordered {
            let owner = state.owner.clone();
            let native_session = state.session.clone();
            let requested_at = state
                .first_parent
                .as_ref()
                .and_then(|parent| users.get(parent).copied())
                .filter(|requested| {
                    // The consumer contract bounds a request's span by one window.
                    *requested <= state.last_at && state.last_at - *requested <= MAX_WINDOW_MS
                });
            let outcome = if state.error {
                "error"
            } else {
                match state.stop {
                    Some(Stop::Refusal) => "refusal",
                    Some(Stop::Success) => "success",
                    None => "unknown",
                }
            };
            let observation_id = self.hash(
                "observation",
                &[owner.provider, &native_session, "request", &request.0],
            )?;
            self.put(
                &owner,
                &request.0,
                state.last_at,
                Payload::Request(Request {
                    kind: "request",
                    observation_id: observation_id.clone(),
                    stage: "terminal",
                    outcome,
                    requested_at_ms: requested_at,
                    dispatched_at_ms: None,
                    terminal_at_ms: Some(state.last_at),
                    first_token_at_ms: None,
                    last_token_at_ms: None,
                    clock_uncertainty_ms: None,
                    retry_of: None,
                }),
            )?;
            let Some(tokens) = state.tokens else {
                self.measured.skipped_records += 1;
                continue;
            };
            let (write_5m, write_1h, unknown) = match (tokens.write_5m, tokens.write_1h) {
                (Some(five), Some(hour)) if five.checked_add(hour) == Some(tokens.cache_write) => {
                    (five, hour, 0)
                }
                _ => (0, 0, tokens.cache_write),
            };
            let usage = |grain: &'static str, observation_id: String| {
                Payload::Usage(Usage {
                    kind: "usage",
                    grain,
                    token_scope: "direct",
                    observation_id,
                    model: state.model,
                    model_basis: if state.model.is_some() {
                        "response"
                    } else {
                        "unknown"
                    },
                    tokens: Tokens {
                        input_uncached: tokens.input.to_string(),
                        cache_read: tokens.cache_read.to_string(),
                        cache_write5m: write_5m.to_string(),
                        cache_write1h: write_1h.to_string(),
                        cache_write_unknown: unknown.to_string(),
                        output: tokens.output.to_string(),
                        reasoning: None,
                    },
                })
            };
            self.put(
                &owner,
                &format!("{}:request", request.0),
                state.last_at,
                usage("request", observation_id.clone()),
            )?;
            if let Some(message) = &state.message_id {
                if responses.insert(message.clone()) {
                    let response_id = self.hash(
                        "observation",
                        &[owner.provider, &native_session, "response", &message.0],
                    )?;
                    self.put(
                        &owner,
                        &format!("{}:response", message.0),
                        state.last_at,
                        usage("response", response_id),
                    )?;
                }
            }
            let occupancy = u128::from(tokens.input)
                + u128::from(tokens.cache_read)
                + u128::from(tokens.cache_write);
            let context_id = self.hash(
                "observation",
                &[owner.provider, &native_session, "context", &request.0],
            )?;
            self.put(
                &owner,
                &format!("{}:context", request.0),
                state.last_at,
                Payload::Context(Context {
                    kind: "context",
                    observation_id: context_id,
                    tokens: occupancy.to_string(),
                    limit_tokens: None,
                }),
            )?;
        }
        Ok(())
    }

    fn scan_codex<R: BufRead>(&mut self, reader: &mut R) -> Result<(), &'static str> {
        for kind in ["request", "tool", "context"] {
            self.measured.supported.insert(kind);
        }
        let mut session: Option<(Id, Option<Id>, bool)> = None;
        let mut same_instant: HashMap<u64, u64> = HashMap::new();
        let mut lines = 0u64;
        loop {
            let next = reader::next_record::<_, CodexLine>(reader).map_err(|e| e.code())?;
            let line = match next {
                Next::End => break,
                Next::Parsed(line) => line,
                Next::Oversized => {
                    self.measured.skipped_records += 1;
                    continue;
                }
                Next::Blank => continue,
            };
            lines += 1;
            if lines > MAX_LINES {
                return Err("record_limit");
            }
            let kind = line.kind.value().map(Text::as_str).unwrap_or("");
            let payload = match &line.payload {
                Object::Value(payload) => payload,
                _ => continue,
            };
            let payload_kind = payload.kind.value().map(Text::as_str).unwrap_or("");
            if kind == "session_meta" {
                let Some(id) = payload.id.value() else {
                    self.measured.skipped_records += 1;
                    continue;
                };
                if session
                    .as_ref()
                    .is_some_and(|(existing, _, _)| existing != id)
                {
                    return Err("session_identity_changed");
                }
                let root_capable = matches!(
                    payload.source.value().map(Text::as_str),
                    Some("cli" | "vscode" | "exec" | "mcp")
                );
                session = Some((
                    id.clone(),
                    payload.parent_thread_id.value().cloned(),
                    root_capable,
                ));
                continue;
            }
            let Some((session_id, parent, root_capable)) = session.as_ref() else {
                self.measured.skipped_records += 1;
                continue;
            };
            let Some(at) = line.timestamp.value() else {
                if kind == "event_msg" || kind == "response_item" {
                    self.measured.skipped_records += 1;
                }
                continue;
            };
            let at = at.0;
            let owner = self.owner(
                "codex",
                &session_id.0,
                None,
                parent.as_ref().map(|parent| parent.0.as_str()),
                *root_capable,
            )?;
            match (kind, payload_kind) {
                ("event_msg", "token_count") => {
                    let Object::Value(info) = &payload.info else {
                        self.measured.skipped_records += 1;
                        continue;
                    };
                    let Object::Value(last) = &info.last_token_usage else {
                        self.measured.skipped_records += 1;
                        continue;
                    };
                    let Some(input) = last.input_tokens.value() else {
                        self.measured.skipped_records += 1;
                        continue;
                    };
                    let slot = same_instant.entry(at).or_insert(0);
                    let native = format!("{at}:{slot}");
                    *slot += 1;
                    let request_id = self.hash(
                        "observation",
                        &[owner.provider, &session_id.0, "request", &native],
                    )?;
                    self.put(
                        &owner,
                        &native,
                        at,
                        Payload::Request(Request {
                            kind: "request",
                            observation_id: request_id,
                            stage: "terminal",
                            outcome: "unknown",
                            requested_at_ms: None,
                            dispatched_at_ms: None,
                            terminal_at_ms: Some(at),
                            first_token_at_ms: None,
                            last_token_at_ms: None,
                            clock_uncertainty_ms: None,
                            retry_of: None,
                        }),
                    )?;
                    let context_id = self.hash(
                        "observation",
                        &[owner.provider, &session_id.0, "context", &native],
                    )?;
                    self.put(
                        &owner,
                        &format!("{native}:context"),
                        at,
                        Payload::Context(Context {
                            kind: "context",
                            observation_id: context_id,
                            tokens: input.0.to_string(),
                            limit_tokens: info
                                .model_context_window
                                .value()
                                .map(|c| c.0.to_string()),
                        }),
                    )?;
                }
                ("response_item", "function_call" | "custom_tool_call" | "local_shell_call") => {
                    let Some(call) = payload.call_id.value() else {
                        self.measured.skipped_records += 1;
                        continue;
                    };
                    self.tool(&owner, &session_id.0, &call.0, "requested", "unknown", at)?;
                }
                ("response_item", "function_call_output" | "custom_tool_call_output") => {
                    let Some(call) = payload.call_id.value() else {
                        self.measured.skipped_records += 1;
                        continue;
                    };
                    // Codex outputs carry no status field; success is not inferred.
                    self.tool(&owner, &session_id.0, &call.0, "terminal", "unknown", at)?;
                }
                _ => {}
            }
        }
        self.measured.lines_read += lines;
        Ok(())
    }
}

/// Produce transcript facts for explicit Claude Code and Codex JSONL sources.
/// Every fact is revision zero; `revision::Ledger` assigns durable revisions.
pub fn project_transcripts<R: BufRead>(
    sources: Vec<(Provider, R)>,
    key: &[u8; 32],
    options: &ExportOptions,
) -> Result<(Report, Measured), &'static str> {
    if key.iter().all(|byte| *byte == 0) {
        return Err("invalid_key");
    }
    if sources.len() > MAX_EXECUTIONS {
        return Err("record_limit");
    }
    let provenance = Provenance {
        profile: TRANSCRIPT_PROFILE,
        version: 1,
        source_id: keyed(
            key,
            TRANSCRIPT_PROFILE,
            options.source_epoch(),
            "source",
            &[],
        )?,
    };
    let mut producer = Producer {
        key,
        options,
        provenance,
        facts: Vec::new(),
        owners: BTreeMap::new(),
        measured: Measured::default(),
    };
    for (provider, mut reader) in sources {
        match provider {
            Provider::ClaudeCode => producer.scan_claude(&mut reader)?,
            Provider::Codex => producer.scan_codex(&mut reader)?,
            _ => return Err("unsupported_provider"),
        }
    }
    let mut seen = HashSet::new();
    for fact in &producer.facts {
        if !seen.insert(fact.id.clone()) {
            return Err("conflicting_fact");
        }
    }
    let coverage = producer.measured.coverage();
    Ok((
        Report {
            schema_version: 1,
            profile: PROFILE,
            provenance: producer.provenance,
            window: super::Window {
                start_ms: options.start_ms(),
                end_ms: options.end_ms(),
            },
            coverage,
            facts: producer.facts,
        },
        producer.measured,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const KEY: [u8; 32] = [9; 32];
    const START: u64 = 1_767_225_600_000;
    const CLAUDE_V1: &str =
        include_str!("../../../../fixtures/usage/rich-claude-transcript-v1.jsonl");
    const CLAUDE_V2: &str =
        include_str!("../../../../fixtures/usage/rich-claude-transcript-v2.jsonl");
    const CODEX_V1: &str =
        include_str!("../../../../fixtures/usage/rich-codex-transcript-v1.jsonl");
    const CODEX_CHILD_V1: &str =
        include_str!("../../../../fixtures/usage/rich-codex-transcript-child-v1.jsonl");
    const EXPECTED: &str = include_str!("../../../../fixtures/usage/rich-transcript-v1.json");

    fn options() -> ExportOptions {
        ExportOptions::new("synthetic_source_v1", START, START + 60_000).unwrap()
    }
    fn sources() -> Vec<(Provider, Cursor<&'static str>)> {
        vec![
            (Provider::ClaudeCode, Cursor::new(CLAUDE_V1)),
            (Provider::Codex, Cursor::new(CODEX_V1)),
            (Provider::Codex, Cursor::new(CODEX_CHILD_V1)),
            (Provider::ClaudeCode, Cursor::new(CLAUDE_V2)),
        ]
    }
    fn fixture() -> (Report, Measured) {
        project_transcripts(sources(), &KEY, &options()).unwrap()
    }
    fn by_kind<'a>(report: &'a Report, kind: &str) -> Vec<&'a Fact> {
        report.facts.iter().filter(|f| f.kind == kind).collect()
    }
    fn hash(domain: &str, values: &[&str]) -> String {
        keyed(
            &KEY,
            TRANSCRIPT_PROFILE,
            "synthetic_source_v1",
            domain,
            values,
        )
        .unwrap()
    }

    #[test]
    fn transcript_projection_matches_the_shared_typescript_fixture() {
        let (report, measured) = fixture();
        let json = report.to_json().unwrap();
        let actual: serde_json::Value = serde_json::from_str(&json).unwrap();
        let expected: serde_json::Value = serde_json::from_str(EXPECTED).unwrap();
        assert_eq!(actual, expected);
        assert_eq!(measured.lines_read, 28);
        // Claude v1: no-timestamp line, error request without usage; Codex v1: null info.
        assert_eq!(measured.skipped_records, 3);
        let coverage = report.coverage();
        assert_eq!(coverage.usage(), "partial");
        assert_eq!(coverage.request(), "partial");
        assert_eq!(coverage.tool(), "partial");
        assert_eq!(coverage.context(), "partial");
        assert_eq!(coverage.span, "unsupported");
        assert_eq!(coverage.turn, "unsupported");
        assert_eq!(coverage.compaction, "unsupported");
        for canary in [
            "PRIVATE_",
            "synthetic_source_v1",
            "11111111-2222",
            "22222222-3333",
            "req_synthetic",
            "msg_synthetic",
            "toolu_synthetic",
            "call_synthetic",
            "agent_synthetic",
            "/private/synthetic",
            "2.1.281",
            "0.156.1",
        ] {
            assert!(!json.contains(canary), "{canary} leaked");
        }
    }

    #[test]
    fn claude_requests_carry_exact_terminal_and_user_prompt_timestamps_only() {
        let (report, _) = fixture();
        let root = hash(
            "execution",
            &["claude_code", "11111111-2222-4333-8444-555555555555"],
        );
        let requests: Vec<&Request> = by_kind(&report, "request")
            .into_iter()
            .filter(|f| f.owner.execution_id == root)
            .map(|f| f.value.as_ref().unwrap().request().unwrap())
            .collect();
        assert_eq!(requests.len(), 3);
        let first = requests[0];
        assert_eq!(first.stage, "terminal");
        assert_eq!(first.outcome, "success");
        assert_eq!(first.requested_at_ms, Some(START + 1_000));
        assert_eq!(first.terminal_at_ms, Some(START + 3_500));
        assert_eq!(first.dispatched_at_ms, None);
        assert_eq!(first.first_token_at_ms, None);
        assert_eq!(first.last_token_at_ms, None);
        assert_eq!(first.retry_of, None);
        assert_eq!(requests[1].outcome, "success");
        assert_eq!(requests[1].requested_at_ms, Some(START + 4_000));
        assert_eq!(requests[2].outcome, "error");
        assert_eq!(requests[2].terminal_at_ms, Some(START + 6_000));
        let usage: Vec<&Usage> = by_kind(&report, "usage")
            .into_iter()
            .filter(|f| f.owner.execution_id == root)
            .map(|f| f.value.as_ref().unwrap().usage().unwrap())
            .collect();
        // Two requests with usage, each with a request grain and one response grain.
        assert_eq!(usage.len(), 4);
        assert_eq!(usage[0].grain, "request");
        assert_eq!(usage[0].observation_id, first.observation_id);
        assert_eq!(usage[0].tokens.output, "4");
        assert_eq!(usage[0].tokens.cache_write5m, "20");
        assert_eq!(usage[0].tokens.cache_write1h, "10");
        assert_eq!(usage[0].tokens.cache_write_unknown, "0");
        assert_eq!(usage[0].model, Some("claude-sonnet-4-6"));
        assert_eq!(usage[0].model_basis, "response");
        assert_eq!(usage[1].grain, "response");
        assert_ne!(usage[1].observation_id, usage[0].observation_id);
        assert!(usage[1].tokens == usage[0].tokens);
        let context: Vec<&Context> = by_kind(&report, "context")
            .into_iter()
            .filter(|f| f.owner.execution_id == root)
            .map(|f| f.value.as_ref().unwrap().context().unwrap())
            .collect();
        assert_eq!(context.len(), 2);
        assert_eq!(context[0].tokens, "140");
        assert_eq!(context[0].limit_tokens, None);
        assert_eq!(context[1].tokens, "205");
    }

    #[test]
    fn claude_cache_split_that_does_not_sum_falls_back_to_the_unknown_bucket() {
        let (report, _) = fixture();
        let root = hash(
            "execution",
            &["claude_code", "44444444-5555-4666-8777-888888888888"],
        );
        let usage: Vec<&Usage> = by_kind(&report, "usage")
            .into_iter()
            .filter(|f| f.owner.execution_id == root && f.owner.lineage == "root")
            .map(|f| f.value.as_ref().unwrap().usage().unwrap())
            .collect();
        assert_eq!(usage.len(), 4);
        assert_eq!(usage[0].tokens.cache_write5m, "0");
        assert_eq!(usage[0].tokens.cache_write1h, "0");
        assert_eq!(usage[0].tokens.cache_write_unknown, "40");
        assert_eq!(usage[0].model, Some("claude-opus-4-5-20251101"));
        let refusal = by_kind(&report, "request")
            .into_iter()
            .filter(|f| f.owner.execution_id == root)
            .nth(1)
            .unwrap();
        assert_eq!(
            refusal.value.as_ref().unwrap().request().unwrap().outcome,
            "refusal"
        );
    }

    #[test]
    fn claude_tools_split_requested_and_terminal_observations() {
        let (report, _) = fixture();
        let session = "11111111-2222-4333-8444-555555555555";
        let tools: Vec<&Fact> = by_kind(&report, "tool")
            .into_iter()
            .filter(|f| f.owner.provider == "claude_code")
            .collect();
        assert_eq!(tools.len(), 2);
        let requested = tools[0].value.as_ref().unwrap().tool().unwrap();
        let terminal = tools[1].value.as_ref().unwrap().tool().unwrap();
        assert_eq!(
            (requested.stage, requested.outcome),
            ("requested", "unknown")
        );
        assert_eq!((terminal.stage, terminal.outcome), ("terminal", "success"));
        assert_eq!(
            requested.observation_id,
            hash(
                "observation",
                &[
                    "claude_code",
                    session,
                    "tool",
                    "toolu_synthetic_1",
                    "requested"
                ]
            )
        );
        assert_ne!(requested.observation_id, terminal.observation_id);
        assert_eq!(tools[0].at_ms, START + 3_500);
        assert_eq!(tools[1].at_ms, START + 4_000);
    }

    #[test]
    fn claude_sidechain_agents_are_children_of_the_session_root() {
        let (report, _) = fixture();
        let session = "11111111-2222-4333-8444-555555555555";
        let root = hash("execution", &["claude_code", session]);
        let child = hash("execution", &["claude_code", session, "agent_synthetic_1"]);
        let facts: Vec<&Fact> = report
            .facts
            .iter()
            .filter(|f| f.owner.execution_id == child)
            .collect();
        assert_eq!(facts.len(), 4);
        let owner = &facts[0].owner;
        assert_eq!(owner.lineage, "child");
        assert_eq!(owner.parent_execution_id.as_deref(), Some(root.as_str()));
        assert_eq!(
            owner.conversation_id.as_deref(),
            Some(hash("conversation", &["claude_code", session]).as_str())
        );
        let root_owner = &report
            .facts
            .iter()
            .find(|f| f.owner.execution_id == root)
            .unwrap()
            .owner;
        assert_eq!(root_owner.lineage, "root");
        assert_eq!(root_owner.parent_execution_id, None);
        assert_eq!(root_owner.conversation_id, owner.conversation_id);
        let usage = facts
            .iter()
            .find_map(|f| f.value.as_ref().unwrap().usage())
            .unwrap();
        assert_eq!(usage.model, Some("claude-haiku-4-5-20251001"));
        assert_eq!(usage.tokens.cache_write5m, "8");
    }

    #[test]
    fn codex_token_counts_become_slot_identified_requests_with_context_limits() {
        let (report, _) = fixture();
        let session = "22222222-3333-4444-8555-666666666666";
        let root = hash("execution", &["codex", session]);
        let owned: Vec<&Fact> = report
            .facts
            .iter()
            .filter(|f| f.owner.execution_id == root)
            .collect();
        // Two token counts (request + context each) and one tool call (two stages).
        assert_eq!(owned.len(), 6);
        assert_eq!(owned[0].owner.lineage, "root");
        let at = START + 12_000;
        let first = owned[0].value.as_ref().unwrap().request().unwrap();
        assert_eq!(first.outcome, "unknown");
        assert_eq!(first.requested_at_ms, None);
        assert_eq!(first.terminal_at_ms, Some(at));
        assert_eq!(
            first.observation_id,
            hash(
                "observation",
                &["codex", session, "request", &format!("{at}:0")]
            )
        );
        let second = owned[2].value.as_ref().unwrap().request().unwrap();
        assert_eq!(
            second.observation_id,
            hash(
                "observation",
                &["codex", session, "request", &format!("{at}:1")]
            )
        );
        let context = owned[1].value.as_ref().unwrap().context().unwrap();
        assert_eq!(context.tokens, "1200");
        assert_eq!(context.limit_tokens.as_deref(), Some("272000"));
        assert_eq!(
            owned[3].value.as_ref().unwrap().context().unwrap().tokens,
            "1300"
        );
        let requested = owned[4].value.as_ref().unwrap().tool().unwrap();
        let terminal = owned[5].value.as_ref().unwrap().tool().unwrap();
        assert_eq!(
            (requested.stage, requested.outcome),
            ("requested", "unknown")
        );
        assert_eq!((terminal.stage, terminal.outcome), ("terminal", "unknown"));
        assert!(by_kind(&report, "usage")
            .iter()
            .all(|f| f.owner.provider != "codex"));
    }

    #[test]
    fn codex_child_threads_point_at_their_parent_thread() {
        let (report, _) = fixture();
        let parent = "22222222-3333-4444-8555-666666666666";
        let child = "33333333-4444-4555-8666-777777777777";
        let execution = hash("execution", &["codex", child]);
        let facts: Vec<&Fact> = report
            .facts
            .iter()
            .filter(|f| f.owner.execution_id == execution)
            .collect();
        assert_eq!(facts.len(), 4);
        let owner = &facts[0].owner;
        assert_eq!(owner.lineage, "child");
        assert_eq!(
            owner.parent_execution_id.as_deref(),
            Some(hash("execution", &["codex", parent]).as_str())
        );
        assert_eq!(
            owner.conversation_id.as_deref(),
            Some(hash("conversation", &["codex", parent]).as_str())
        );
    }

    #[test]
    fn codex_sources_without_root_capable_origin_are_unknown_lineage() {
        let source = concat!(
            "{\"timestamp\":\"2026-01-01T00:00:10Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"source\":\"unknown_origin\"}}\n",
            "{\"timestamp\":\"2026-01-01T00:00:11Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"last_token_usage\":{\"input_tokens\":5}}}}\n",
        );
        let (report, measured) = project_transcripts(
            vec![(Provider::Codex, Cursor::new(source))],
            &KEY,
            &options(),
        )
        .unwrap();
        assert_eq!(report.facts.len(), 2);
        assert_eq!(report.facts[0].owner.lineage, "unknown");
        assert_eq!(report.facts[0].owner.parent_execution_id, None);
        assert_eq!(
            report.facts[1]
                .value
                .as_ref()
                .unwrap()
                .context()
                .unwrap()
                .limit_tokens,
            None
        );
        assert_eq!(measured.skipped_records, 0);
        assert_eq!(report.coverage().usage(), "unsupported");
    }

    #[test]
    fn window_bounds_exclude_facts_outside_the_half_open_interval() {
        let options =
            ExportOptions::new("synthetic_source_v1", START + 4_000, START + 5_000).unwrap();
        let (report, _) = project_transcripts(
            vec![(Provider::ClaudeCode, Cursor::new(CLAUDE_V1))],
            &KEY,
            &options,
        )
        .unwrap();
        // Only the tool terminal at +4000; the +5000 request is excluded.
        assert_eq!(report.facts.len(), 1);
        assert_eq!(report.facts[0].kind, "tool");
        assert_eq!(report.facts[0].at_ms, START + 4_000);
    }

    #[test]
    fn stale_user_prompts_beyond_the_window_bound_are_not_requested_timestamps() {
        let source = concat!(
            "{\"type\":\"user\",\"timestamp\":\"2025-11-01T00:00:00Z\",\"uuid\":\"u1\",\"sessionId\":\"s\",\"message\":{\"role\":\"user\",\"content\":\"x\"}}\n",
            "{\"type\":\"assistant\",\"timestamp\":\"2026-01-01T00:00:02Z\",\"uuid\":\"a1\",\"parentUuid\":\"u1\",\"requestId\":\"r\",\"sessionId\":\"s\",",
            "\"message\":{\"id\":\"m\",\"model\":\"claude-sonnet-4-6\",\"stop_reason\":\"end_turn\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}\n",
        );
        let (report, _) = project_transcripts(
            vec![(Provider::ClaudeCode, Cursor::new(source))],
            &KEY,
            &options(),
        )
        .unwrap();
        let request = report.facts[0].value.as_ref().unwrap().request().unwrap();
        assert_eq!(request.requested_at_ms, None);
        assert_eq!(request.terminal_at_ms, Some(START + 2_000));
    }

    #[test]
    fn refuses_unusable_keys_providers_and_identity_changes() {
        assert_eq!(
            project_transcripts(sources(), &[0; 32], &options()).err(),
            Some("invalid_key")
        );
        assert_eq!(
            project_transcripts(
                vec![(Provider::Devin, Cursor::new(CLAUDE_V1))],
                &KEY,
                &options()
            )
            .err(),
            Some("unsupported_provider")
        );
        let changed = concat!(
            "{\"timestamp\":\"2026-01-01T00:00:10Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"source\":\"cli\"}}\n",
            "{\"timestamp\":\"2026-01-01T00:00:10Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"s2\",\"source\":\"cli\"}}\n",
        );
        assert_eq!(
            project_transcripts(
                vec![(Provider::Codex, Cursor::new(changed))],
                &KEY,
                &options()
            )
            .err(),
            Some("session_identity_changed")
        );
    }

    #[test]
    fn the_same_execution_cannot_claim_two_lineages() {
        let orphan = concat!(
            "{\"timestamp\":\"2026-01-01T00:00:10Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"source\":\"cli\"}}\n",
            "{\"timestamp\":\"2026-01-01T00:00:11Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"last_token_usage\":{\"input_tokens\":5}}}}\n",
        );
        let child = concat!(
            "{\"timestamp\":\"2026-01-01T00:00:10Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"parent_thread_id\":\"p\"}}\n",
            "{\"timestamp\":\"2026-01-01T00:00:12Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"last_token_usage\":{\"input_tokens\":5}}}}\n",
        );
        assert_eq!(
            project_transcripts(
                vec![
                    (Provider::Codex, Cursor::new(orphan)),
                    (Provider::Codex, Cursor::new(child))
                ],
                &KEY,
                &options()
            )
            .err(),
            Some("conflicting_owner")
        );
    }

    #[test]
    fn the_same_transcript_scanned_twice_is_a_conflict_not_a_duplicate() {
        assert_eq!(
            project_transcripts(
                vec![
                    (Provider::ClaudeCode, Cursor::new(CLAUDE_V1)),
                    (Provider::ClaudeCode, Cursor::new(CLAUDE_V1))
                ],
                &KEY,
                &options()
            )
            .err(),
            Some("conflicting_fact")
        );
    }

    #[test]
    fn direct_and_inclusive_token_lineage_never_double_count() {
        let (report, _) = fixture();
        let mut direct: BTreeMap<&str, u128> = BTreeMap::new();
        let mut parents: BTreeMap<&str, &str> = BTreeMap::new();
        for fact in &report.facts {
            let Some(usage) = fact.value.as_ref().and_then(Payload::usage) else {
                continue;
            };
            if usage.grain != "request" {
                continue;
            }
            *direct.entry(&fact.owner.execution_id).or_default() += usage.total();
            if let Some(parent) = &fact.owner.parent_execution_id {
                parents.insert(&fact.owner.execution_id, parent);
            }
        }
        let inclusive = |root: &str| -> u128 {
            direct
                .iter()
                .filter(|(execution, _)| {
                    let mut current = **execution;
                    loop {
                        if current == root {
                            return true;
                        }
                        match parents.get(current) {
                            Some(parent) => current = parent,
                            None => return false,
                        }
                    }
                })
                .map(|(_, total)| total)
                .sum()
        };
        let session = "11111111-2222-4333-8444-555555555555";
        let root = hash("execution", &["claude_code", session]);
        let child = hash("execution", &["claude_code", session, "agent_synthetic_1"]);
        assert_eq!(direct[root.as_str()], 140 + 4 + 205 + 7);
        assert_eq!(direct[child.as_str()], 3 + 8 + 2);
        assert_eq!(
            inclusive(&root),
            direct[root.as_str()] + direct[child.as_str()]
        );
        assert_eq!(inclusive(&child), direct[child.as_str()]);
        let all: u128 = direct.values().sum();
        let roots: u128 = direct
            .keys()
            .filter(|execution| !parents.contains_key(*execution))
            .map(|root| inclusive(root))
            .sum();
        assert_eq!(all, roots);
    }
}
