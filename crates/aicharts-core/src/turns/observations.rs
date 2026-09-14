//! Observed reports and requested calls, never complete turn accounting.
use super::{
    keyed_id, BTreeMap, BTreeSet, Field, Id, Kind, Number, Object, ObservedMetric,
    ObservedSubtotals, Payload, TurnDiagnostic, TurnError, TurnEvidence,
};
use crate::schema::NativeId;

pub(super) const MAX_RESPONSE_TOTAL: u64 = 1_000_000_000_000;
type Owner = (Id, Id);

#[derive(Clone, PartialEq, Eq)]
struct TokenBinding {
    thread: Field<Id>,
    session: Field<Id>,
    turn: Field<Id>,
    root: Field<Id>,
    total: Field<u64>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CallKind {
    Function,
    Custom,
    Shell,
    Search,
    Web,
    Image,
}

fn call_kind(kind: Kind) -> Option<CallKind> {
    Some(match kind {
        Kind::FunctionCall => CallKind::Function,
        Kind::CustomToolCall => CallKind::Custom,
        Kind::LocalShellCall => CallKind::Shell,
        Kind::ToolSearchCall => CallKind::Search,
        Kind::WebSearchCall => CallKind::Web,
        Kind::ImageGenerationCall => CallKind::Image,
        _ => return None,
    })
}

pub(super) fn is_call(kind: Kind) -> bool {
    call_kind(kind).is_some()
}

#[derive(Clone, PartialEq, Eq)]
struct CallBinding {
    kind: CallKind,
    turn: Field<Id>,
}

#[derive(Clone, Default)]
pub(super) struct Observations {
    tokens: BTreeMap<(Id, Id), TokenBinding>,
    calls: BTreeMap<(Id, Id), CallBinding>,
}

fn native(field: &Field<NativeId>) -> Result<Option<&NativeId>, TurnError> {
    match field {
        Field::Invalid => Err(TurnError::MalformedRecord),
        Field::Value(value) => Ok(Some(value)),
        _ => Ok(None),
    }
}

fn hashed(field: &Field<NativeId>, key: &[u8; 32], thread: Option<Id>) -> Field<Id> {
    match field {
        Field::Value(value) => Field::Value(match thread {
            Some(thread) => keyed_id(
                key,
                b"codex-logical-turn-v1",
                &[&thread, value.0.as_bytes()],
            ),
            None => keyed_id(key, b"codex-turn-thread-v1", &[value.0.as_bytes()]),
        }),
        Field::Missing => Field::Missing,
        Field::Null => Field::Null,
        Field::Invalid => unreachable!("selected identifiers validated before hashing"),
    }
}

fn insert<T: Clone + PartialEq>(
    map: &mut BTreeMap<(Id, Id), T>,
    id: (Id, Id),
    value: T,
) -> Result<(), TurnError> {
    match map.get(&id) {
        Some(old) if old != &value => Err(TurnError::ConflictingEvidence),
        Some(_) => Ok(()),
        None => {
            map.insert(id, value);
            Ok(())
        }
    }
}

/// Validate selected values before container ownership can refuse a record.
/// Missing evidence stays distinct from malformed evidence; no owner is stored.
pub(super) fn validate_token(payload: &Payload) -> Result<Field<u64>, TurnError> {
    for field in [
        &payload.thread_id,
        &payload.session_id,
        &payload.turn_id,
        &payload.root_turn_id,
        &payload.response_id,
    ] {
        native(field)?;
    }
    match &payload.usage {
        Object::Value(usage) => match usage.total_tokens {
            Field::Value(Number::Unsigned(value)) if value <= MAX_RESPONSE_TOTAL => {
                Ok(Field::Value(value))
            }
            Field::Missing => Ok(Field::Missing),
            Field::Null => Ok(Field::Null),
            _ => Err(TurnError::MalformedRecord),
        },
        Object::Missing => Ok(Field::Missing),
        Object::Null => Ok(Field::Null),
        Object::Invalid => Err(TurnError::MalformedRecord),
    }
}

pub(super) fn validate_call(payload: &Payload) -> Result<(), TurnError> {
    let kind = call_kind(payload.kind).expect("caller selected a supported call");
    native(if matches!(kind, CallKind::Web | CallKind::Image) {
        &payload.id
    } else {
        &payload.call_id
    })?;
    match &payload.internal_chat_message_metadata_passthrough {
        Object::Value(stamp) => {
            native(&stamp.turn_id)?;
        }
        Object::Missing | Object::Null => {}
        Object::Invalid => return Err(TurnError::MalformedRecord),
    }
    Ok(())
}

impl Observations {
    pub(super) fn token(
        &mut self,
        payload: &Payload,
        source: Option<Id>,
        key: &[u8; 32],
        diagnostics: &mut BTreeSet<TurnDiagnostic>,
    ) -> Result<Option<Owner>, TurnError> {
        let total = validate_token(payload)?;
        if !matches!(total, Field::Value(_)) {
            diagnostics.insert(TurnDiagnostic::MissingResponseTotal);
        }
        let (Some(thread), Some(response)) = (source, native(&payload.response_id)?) else {
            diagnostics.insert(TurnDiagnostic::UnownedUsage);
            return Ok(None);
        };
        let binding = TokenBinding {
            thread: hashed(&payload.thread_id, key, None),
            session: hashed(&payload.session_id, key, None),
            turn: hashed(&payload.turn_id, key, Some(thread)),
            root: hashed(&payload.root_turn_id, key, Some(thread)),
            total,
        };
        if !binding.root_direct(thread) {
            diagnostics.insert(TurnDiagnostic::UnownedUsage);
        }
        let owner = match binding.turn {
            Field::Value(turn) => Some((thread, turn)),
            _ => None,
        };
        let response = keyed_id(
            key,
            b"codex-observed-response-v2",
            &[&thread, response.0.as_bytes()],
        );
        insert(&mut self.tokens, (thread, response), binding)?;
        Ok(owner)
    }

    pub(super) fn call(
        &mut self,
        payload: &Payload,
        source: Option<Id>,
        key: &[u8; 32],
        diagnostics: &mut BTreeSet<TurnDiagnostic>,
    ) -> Result<Option<Owner>, TurnError> {
        validate_call(payload)?;
        let kind = call_kind(payload.kind).expect("caller selected a supported call");
        let hosted = matches!(kind, CallKind::Web | CallKind::Image);
        // The optional response-item ID of a function/custom call is not its
        // call identity and remains irrelevant to this projection.
        let identity = if hosted {
            &payload.id
        } else {
            &payload.call_id
        };
        let id = native(identity)?;
        let missing = Field::Missing;
        let turn = match &payload.internal_chat_message_metadata_passthrough {
            Object::Value(stamp) => &stamp.turn_id,
            Object::Missing | Object::Null => &missing,
            Object::Invalid => return Err(TurnError::MalformedRecord),
        };
        native(turn)?;
        let (Some(thread), Some(id)) = (source, id) else {
            diagnostics.insert(TurnDiagnostic::UnownedCall);
            return Ok(None);
        };
        let turn = hashed(turn, key, Some(thread));
        let owner = match turn {
            Field::Value(turn) => Some((thread, turn)),
            _ => {
                diagnostics.insert(TurnDiagnostic::UnownedCall);
                None
            }
        };
        let domain: &[u8] = if hosted {
            b"codex-observed-hosted-item-v2"
        } else {
            b"codex-observed-call-v2"
        };
        let id = keyed_id(key, domain, &[&thread, id.0.as_bytes()]);
        insert(&mut self.calls, (thread, id), CallBinding { kind, turn })?;
        Ok(owner)
    }

    pub(super) fn merge(&mut self, other: &Self) -> Result<(), TurnError> {
        for (id, value) in &other.tokens {
            insert(&mut self.tokens, *id, value.clone())?;
        }
        for (id, value) in &other.calls {
            insert(&mut self.calls, *id, value.clone())?;
        }
        Ok(())
    }

    pub(super) fn validate_roots(
        &self,
        turns: &BTreeMap<Owner, TurnEvidence>,
    ) -> Result<(), TurnError> {
        for ((thread, _), binding) in &self.tokens {
            if let (Field::Value(turn), Field::Value(root)) = (binding.turn, binding.root) {
                if let Some(evidence) = turns.get(&(*thread, turn)) {
                    if evidence
                        .starts
                        .iter()
                        .any(|start| matches!(start.root, Field::Value(value) if value != root))
                    {
                        return Err(TurnError::ConflictingEvidence);
                    }
                }
            }
        }
        Ok(())
    }

    pub(super) fn by_turn(&self) -> BTreeMap<Owner, ObservedSubtotals> {
        let mut totals = BTreeMap::<Owner, ObservedSubtotals>::new();
        for ((thread, _), binding) in &self.tokens {
            if binding.root_direct(*thread) {
                if let (Field::Value(turn), Field::Value(total)) = (binding.turn, binding.total) {
                    totals
                        .entry((*thread, turn))
                        .or_default()
                        .response_tokens
                        .observe(total);
                }
            }
        }
        for ((thread, _), binding) in &self.calls {
            if let Field::Value(turn) = binding.turn {
                totals
                    .entry((*thread, turn))
                    .or_default()
                    .requested_calls
                    .observe(1);
            }
        }
        totals
    }
}

impl TokenBinding {
    fn root_direct(&self, thread: Id) -> bool {
        self.thread == Field::Value(thread)
            && self.session == Field::Value(thread)
            && matches!(self.turn, Field::Value(_))
            && self.root == self.turn
    }
}

impl ObservedMetric {
    fn observe(&mut self, value: u64) {
        self.sum = self
            .sum
            .checked_add(value)
            .expect("bounded private observation total");
        self.observations += 1;
        self.turns_with_evidence = 1;
    }
    fn add(&mut self, other: &Self) {
        self.sum = self
            .sum
            .checked_add(other.sum)
            .expect("bounded private cohort total");
        self.observations += other.observations;
        self.turns_with_evidence += other.turns_with_evidence;
    }
}

impl ObservedSubtotals {
    pub(super) fn add(&mut self, other: &Self) {
        self.response_tokens.add(&other.response_tokens);
        self.requested_calls.add(&other.requested_calls);
    }
}
