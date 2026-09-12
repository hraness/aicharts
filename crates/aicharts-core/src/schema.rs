//! Metadata-only projections. Unknown fields are skipped by Serde's IgnoredAny.
//! No struct contains content, prompt text, model names, paths, titles or tool args.

use serde::{
    de::{self, IgnoredAny, MapAccess, SeqAccess, Visitor},
    Deserialize, Deserializer,
};
use std::{fmt, marker::PhantomData};

// Non-target records can use the same field name for a string, array or null.
// Skip those values rather than buffering an untagged serde_json::Value tree.
fn metadata_object<'de, D, T>(decoder: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct ObjectVisitor<T>(PhantomData<T>);
    impl<'de, T: Deserialize<'de>> Visitor<'de> for ObjectVisitor<T> {
        type Value = Option<T>;
        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str("optional metadata")
        }
        fn visit_map<M: MapAccess<'de>>(self, map: M) -> Result<Self::Value, M::Error> {
            T::deserialize(de::value::MapAccessDeserializer::new(map)).map(Some)
        }
        fn visit_seq<S: SeqAccess<'de>>(self, mut seq: S) -> Result<Self::Value, S::Error> {
            while seq.next_element::<IgnoredAny>()?.is_some() {}
            Ok(None)
        }
        fn visit_str<E: de::Error>(self, _: &str) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_bool<E: de::Error>(self, _: bool) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_i64<E: de::Error>(self, _: i64) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_u64<E: de::Error>(self, _: u64) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_f64<E: de::Error>(self, _: f64) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
    }
    decoder.deserialize_any(ObjectVisitor(PhantomData))
}

/// Bounded native identifiers. Kept only until their keyed identity is derived.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct NativeId(pub String);

impl<'de> Deserialize<'de> for NativeId {
    fn deserialize<D: Deserializer<'de>>(decoder: D) -> Result<Self, D::Error> {
        struct IdVisitor;
        impl Visitor<'_> for IdVisitor {
            type Value = NativeId;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a bounded native identifier")
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<NativeId, E> {
                if value.is_empty()
                    || value.len() > 256
                    || !value
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                {
                    return Err(E::custom("invalid_identifier"));
                }
                Ok(NativeId(value.to_owned()))
            }
        }
        decoder.deserialize_str(IdVisitor)
    }
}

pub(crate) struct Timestamp(pub String);
impl<'de> Deserialize<'de> for Timestamp {
    fn deserialize<D: Deserializer<'de>>(decoder: D) -> Result<Self, D::Error> {
        struct TimeVisitor;
        impl Visitor<'_> for TimeVisitor {
            type Value = Timestamp;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a timestamp")
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<Timestamp, E> {
                if value.len() > 64 {
                    return Err(E::custom("invalid_timestamp"));
                }
                Ok(Timestamp(value.to_owned()))
            }
        }
        decoder.deserialize_str(TimeVisitor)
    }
}

#[derive(Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Kind {
    SessionMeta,
    EventMsg,
    TokenCount,
    UserMessage,
    Assistant,
    User,
    #[default]
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
pub(crate) struct CodexEntry {
    #[serde(rename = "type", default)]
    pub kind: Kind,
    pub timestamp: Option<Timestamp>,
    #[serde(default, deserialize_with = "metadata_object")]
    pub payload: Option<CodexPayload>,
}
#[derive(Deserialize)]
pub(crate) struct CodexPayload {
    #[serde(rename = "type", default)]
    pub kind: Kind,
    pub id: Option<NativeId>,
    pub forked_from_id: Option<NativeId>,
    pub info: Option<CodexInfo>,
}
#[derive(Deserialize)]
pub(crate) struct CodexInfo {
    pub total_token_usage: Option<CodexUsage>,
    pub last_token_usage: Option<CodexUsage>,
}
#[derive(Deserialize)]
pub(crate) struct CodexUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
    pub reasoning_output_tokens: Option<u64>,
}
#[derive(Deserialize)]
pub(crate) struct ClaudeEntry {
    #[serde(rename = "type", default)]
    pub kind: Kind,
    pub timestamp: Option<Timestamp>,
    #[serde(rename = "requestId")]
    pub request_id: Option<NativeId>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<NativeId>,
    #[serde(rename = "agentId")]
    pub agent_id: Option<NativeId>,
    #[serde(rename = "isSidechain", default)]
    pub is_sidechain: bool,
    #[serde(default, deserialize_with = "metadata_object")]
    pub message: Option<ClaudeMessage>,
}
#[derive(Deserialize)]
pub(crate) struct ClaudeMessage {
    pub id: Option<NativeId>,
    pub usage: Option<ClaudeUsage>,
}
#[derive(Deserialize)]
pub(crate) struct ClaudeUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
    pub cache_creation_input_tokens: Option<u64>,
    pub cache_creation: Option<ClaudeCacheCreation>,
}
#[derive(Deserialize)]
pub(crate) struct ClaudeCacheCreation {
    pub ephemeral_5m_input_tokens: Option<u64>,
    pub ephemeral_1h_input_tokens: Option<u64>,
}
