//! Selective metadata only. No content, names, paths, arguments, or errors are
//! retained. Invalid selected values are checked only for the target record kind.

use crate::schema::NativeId;
use serde::{
    de::{self, IgnoredAny, MapAccess, SeqAccess, Visitor},
    Deserialize, Deserializer,
};
use std::{fmt, marker::PhantomData};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Field<T> {
    #[default]
    Missing,
    Null,
    Value(T),
    Invalid,
}

pub(super) trait Scalar: Sized {
    fn string(_: &str) -> Option<Self> {
        None
    }
    fn unsigned(_: u64) -> Option<Self> {
        None
    }
    fn signed(_: i64) -> Option<Self> {
        None
    }
}

impl<'de, T: Scalar> Deserialize<'de> for Field<T> {
    fn deserialize<D: Deserializer<'de>>(decoder: D) -> Result<Self, D::Error> {
        struct ScalarVisitor<T>(PhantomData<T>);
        impl<'de, T: Scalar> Visitor<'de> for ScalarVisitor<T> {
            type Value = Field<T>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("bounded metadata scalar")
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(T::string(v).map_or(Field::Invalid, Field::Value))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(T::unsigned(v).map_or(Field::Invalid, Field::Value))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(T::signed(v).map_or(Field::Invalid, Field::Value))
            }
            fn visit_f64<E: de::Error>(self, _: f64) -> Result<Self::Value, E> {
                Ok(Field::Invalid)
            }
            fn visit_bool<E: de::Error>(self, _: bool) -> Result<Self::Value, E> {
                Ok(Field::Invalid)
            }
            fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(Field::Null)
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

impl Scalar for NativeId {
    fn string(value: &str) -> Option<Self> {
        (!value.is_empty()
            && value.len() <= 256
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
        .then(|| Self(value.to_owned()))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Number {
    Unsigned(u64),
    Negative(i64),
}
impl Scalar for Number {
    fn unsigned(value: u64) -> Option<Self> {
        Some(Self::Unsigned(value))
    }
    fn signed(value: i64) -> Option<Self> {
        Some(if value < 0 {
            Self::Negative(value)
        } else {
            Self::Unsigned(value as u64)
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct AppendTime(pub i128);
impl Scalar for AppendTime {
    fn string(value: &str) -> Option<Self> {
        if value.len() > 64 || value.as_bytes().get(17..19) == Some(b"60") {
            return None;
        }
        // The time parser accepts excess digits by truncation. This profile does
        // not: full supplied fractional precision participates in start evidence.
        if let Some((_, fraction)) = value.split_once('.') {
            if fraction.bytes().take_while(u8::is_ascii_digit).count() > 9 {
                return None;
            }
        }
        OffsetDateTime::parse(value, &Rfc3339)
            .ok()
            .map(|value| Self(value.unix_timestamp_nanos()))
    }
}

#[derive(Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Kind {
    SessionMeta,
    EventMsg,
    TokenUsageRecord,
    ResponseItem,
    FunctionCall,
    CustomToolCall,
    LocalShellCall,
    ToolSearchCall,
    WebSearchCall,
    ImageGenerationCall,
    Message,
    AgentMessage,
    Reasoning,
    FunctionCallOutput,
    CustomToolCallOutput,
    ToolSearchOutput,
    ConfigurationUpdate,
    #[serde(alias = "compaction_summary")]
    Compaction,
    ContextCompaction,
    AdditionalTools,
    CompactionTrigger,
    #[serde(rename = "task_started", alias = "turn_started")]
    Started,
    #[serde(rename = "task_complete", alias = "turn_complete")]
    Complete,
    TurnAborted,
    #[default]
    #[serde(other)]
    Other,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Source {
    RootCapable,
    Unknown,
    Excluded,
    Invalid,
}

impl<'de> Deserialize<'de> for Source {
    fn deserialize<D: Deserializer<'de>>(decoder: D) -> Result<Self, D::Error> {
        struct SourceVisitor;
        impl<'de> Visitor<'de> for SourceVisitor {
            type Value = Source;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("session source tag")
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<Source, E> {
                Ok(match value {
                    "cli" | "vscode" | "exec" | "mcp" => Source::RootCapable,
                    "unknown" => Source::Unknown,
                    _ => Source::Invalid,
                })
            }
            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Source, M::Error> {
                #[derive(Deserialize)]
                #[serde(rename_all = "lowercase")]
                enum Tag {
                    Subagent,
                    Internal,
                    Custom,
                    #[serde(other)]
                    Other,
                }
                let result = match map.next_key::<Tag>()? {
                    Some(Tag::Subagent | Tag::Internal) => {
                        map.next_value::<IgnoredAny>()?;
                        Source::Excluded
                    }
                    Some(Tag::Custom) => {
                        let value = map.next_value::<Field<AnyString>>()?;
                        if matches!(value, Field::Value(_)) {
                            Source::Unknown
                        } else {
                            Source::Invalid
                        }
                    }
                    Some(Tag::Other) => {
                        map.next_value::<IgnoredAny>()?;
                        Source::Invalid
                    }
                    None => Source::Invalid,
                };
                if map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {
                    while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                    return Ok(Source::Invalid);
                }
                Ok(result)
            }
            fn visit_unit<E: de::Error>(self) -> Result<Source, E> {
                Ok(Source::Invalid)
            }
            fn visit_bool<E: de::Error>(self, _: bool) -> Result<Source, E> {
                Ok(Source::Invalid)
            }
            fn visit_i64<E: de::Error>(self, _: i64) -> Result<Source, E> {
                Ok(Source::Invalid)
            }
            fn visit_u64<E: de::Error>(self, _: u64) -> Result<Source, E> {
                Ok(Source::Invalid)
            }
            fn visit_f64<E: de::Error>(self, _: f64) -> Result<Source, E> {
                Ok(Source::Invalid)
            }
            fn visit_seq<S: SeqAccess<'de>>(self, mut seq: S) -> Result<Source, S::Error> {
                while seq.next_element::<IgnoredAny>()?.is_some() {}
                Ok(Source::Invalid)
            }
        }
        decoder.deserialize_any(SourceVisitor)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct AnyString;
impl Scalar for AnyString {
    fn string(_: &str) -> Option<Self> {
        Some(Self)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum ThreadSource {
    User,
    Excluded,
    Unknown,
}
impl Scalar for ThreadSource {
    fn string(value: &str) -> Option<Self> {
        Some(match value {
            "user" => Self::User,
            "subagent" | "guardian_review" | "memory_consolidation" => Self::Excluded,
            _ => Self::Unknown,
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum HistoryMode {
    Supported,
    Unknown,
}
impl Scalar for HistoryMode {
    fn string(value: &str) -> Option<Self> {
        Some(match value {
            "legacy" | "paginated" => Self::Supported,
            _ => Self::Unknown,
        })
    }
}

#[derive(Default, Deserialize)]
pub(super) struct Entry {
    #[serde(rename = "type", default)]
    pub kind: Kind,
    #[serde(default)]
    pub timestamp: Field<AppendTime>,
    #[serde(default)]
    pub payload: Object<Payload>,
}

#[derive(Default, Deserialize)]
pub(super) struct Payload {
    #[serde(rename = "type", default)]
    pub kind: Kind,
    #[serde(default)]
    pub id: Field<NativeId>,
    #[serde(default)]
    pub thread_id: Field<NativeId>,
    #[serde(default)]
    pub response_id: Field<NativeId>,
    #[serde(default)]
    pub call_id: Field<NativeId>,
    #[serde(default)]
    pub usage: Object<Usage>,
    #[serde(default)]
    pub internal_chat_message_metadata_passthrough: Object<Stamp>,
    #[serde(default)]
    pub session_id: Field<NativeId>,
    #[serde(default)]
    pub parent_thread_id: Field<NativeId>,
    #[serde(default)]
    pub forked_from_id: Field<NativeId>,
    #[serde(default)]
    pub forked_from_ordinal_exclusive: Option<IgnoredAny>,
    #[serde(default)]
    pub subagent_history_start_ordinal: Option<IgnoredAny>,
    #[serde(default)]
    pub history_base: Option<IgnoredAny>,
    #[serde(default)]
    pub source: Option<Source>,
    #[serde(default)]
    pub thread_source: Field<ThreadSource>,
    #[serde(default)]
    pub history_mode: Field<HistoryMode>,
    #[serde(default)]
    pub turn_id: Field<NativeId>,
    #[serde(default)]
    pub root_turn_id: Field<NativeId>,
    #[serde(default)]
    pub started_at: Field<Number>,
    #[serde(default)]
    pub completed_at: Field<Number>,
    #[serde(default)]
    pub duration_ms: Field<Number>,
}

#[derive(Default, Deserialize)]
pub(super) struct Usage {
    #[serde(default)]
    pub total_tokens: Field<Number>,
}

#[derive(Default, Deserialize)]
pub(super) struct Stamp {
    #[serde(default)]
    pub turn_id: Field<NativeId>,
}

#[derive(Default)]
pub(super) enum Object<T> {
    #[default]
    Missing,
    Null,
    Value(T),
    Invalid,
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Object<T> {
    fn deserialize<D: Deserializer<'de>>(decoder: D) -> Result<Self, D::Error> {
        struct ObjectVisitor<T>(PhantomData<T>);
        impl<'de, T: Deserialize<'de>> Visitor<'de> for ObjectVisitor<T> {
            type Value = Object<T>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("optional metadata object")
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
                Ok(Object::Null)
            }
        }
        decoder.deserialize_any(ObjectVisitor(PhantomData))
    }
}
