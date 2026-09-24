//! Exact JSON field order is part of the cross-language immutable-body contract.
use super::{
    hex, identity, Error, Scope, MAX_MUTATIONS, MAX_OBSERVATIONS, MAX_REPLY_BYTES, MAX_REVISION,
    MAX_SEQUENCE, MAX_TIME, ZERO_HASH,
};
use serde::{de::DeserializeOwned, Deserialize, Deserializer, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct NativeTokens {
    input: String,
    cache_read: String,
    cache_write: String,
    output: String,
    reasoning: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct NativeRow {
    utc_day: u32,
    client: String,
    provider: Option<()>,
    model: Option<()>,
    tokens: NativeTokens,
    records: u8,
    reported_cost_microusd: Option<()>,
    reported_cost_records: u8,
    estimated_cost_microusd: Option<()>,
    estimated_cost_records: u8,
    duration_ms: Option<()>,
    timed_records: u8,
    timed_tokens: String,
    token_basis: String,
    breakdown_coverage: String,
}
impl NativeRow {
    pub(super) fn from_claude(
        utc_day: u32,
        tokens: &aicharts_protocol::Tokens,
    ) -> Result<Self, Error> {
        if utc_day > 99_999_999 {
            return Err(Error::Source(crate::Error::InvalidCounters));
        }
        let cache_write = tokens
            .cache_write_5m
            .checked_add(tokens.cache_write_1h)
            .ok_or(Error::Limit)?;
        let output = tokens
            .output
            .checked_sub(tokens.reasoning_output)
            .ok_or(Error::Limit)?;
        Ok(Self {
            utc_day,
            client: "claude".into(),
            provider: None,
            model: None,
            tokens: NativeTokens {
                input: tokens.input_uncached.to_string(),
                cache_read: tokens.cache_read.to_string(),
                cache_write: cache_write.to_string(),
                output: output.to_string(),
                reasoning: tokens.reasoning_output.to_string(),
            },
            records: 1,
            reported_cost_microusd: None,
            reported_cost_records: 0,
            estimated_cost_microusd: None,
            estimated_cost_records: 0,
            duration_ms: None,
            timed_records: 0,
            timed_tokens: "0".into(),
            token_basis: "reported".into(),
            breakdown_coverage: "partial".into(),
        })
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NamedQuery {
    schema_version: u8,
    account_id: String,
    generation: String,
    device_id: String,
    population_id: String,
    writer_revision: u64,
    pub(super) expected_revision: u64,
    mode: &'static str,
    ids: Vec<String>,
}
impl NamedQuery {
    pub(super) fn new(scope: &Scope, expected_revision: u64, ids: Vec<String>) -> Self {
        Self {
            schema_version: 3,
            account_id: scope.account_id.clone(),
            generation: scope.generation.clone(),
            device_id: scope.device_id.clone(),
            population_id: scope.population_id.clone(),
            writer_revision: scope.writer_revision,
            expected_revision,
            mode: "heads",
            ids,
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Put {
    pub kind: String,
    pub id: String,
    pub expected_head_hash: Option<String>,
    pub row: NativeRow,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Batch {
    schema_version: u8,
    profile: String,
    identity_scheme: String,
    grain: String,
    pub account_id: String,
    pub generation: String,
    pub device_id: String,
    pub operation_id: String,
    pub sequence: u64,
    pub expected_revision: u64,
    pub population_id: String,
    writer_revision: u64,
    pub expected_population_revision: u64,
    pub expected_population_head: String,
    replacement: Option<()>,
    pub mutations: Vec<Put>,
}
impl Batch {
    pub(super) fn new(
        scope: &Scope,
        page: &HeadPage,
        operation_id: &str,
        sequence: u64,
        mutations: Vec<Put>,
    ) -> Self {
        Self {
            schema_version: 3,
            profile: "canonical-contributions-v3".into(),
            identity_scheme: "aicharts-occurrence-v1".into(),
            grain: "observation".into(),
            account_id: scope.account_id.clone(),
            generation: scope.generation.clone(),
            device_id: scope.device_id.clone(),
            operation_id: operation_id.to_owned(),
            sequence,
            expected_revision: page.revision,
            population_id: scope.population_id.clone(),
            writer_revision: scope.writer_revision,
            expected_population_revision: page.population.revision,
            expected_population_head: page.population.head_hash.clone(),
            replacement: None,
            mutations,
        }
    }
    pub(super) fn scope(&self) -> Scope {
        Scope {
            account_id: self.account_id.clone(),
            generation: self.generation.clone(),
            device_id: self.device_id.clone(),
            population_id: self.population_id.clone(),
            writer_revision: self.writer_revision,
        }
    }
    pub(super) fn check_native(&self, scope: &Scope) -> Result<(), Error> {
        if self.schema_version != 3
            || self.profile != "canonical-contributions-v3"
            || self.identity_scheme != "aicharts-occurrence-v1"
            || self.grain != "observation"
            || self.scope() != *scope
            || !identity(&self.operation_id, 64)
            || !(1..=MAX_SEQUENCE).contains(&self.sequence)
            || self.expected_revision >= MAX_REVISION
            || self.expected_population_revision > self.expected_revision
            || !hex(&self.expected_population_head, 64)
            || (self.expected_population_revision == 0)
                != (self.expected_population_head == ZERO_HASH)
            || self.replacement.is_some()
            || self.mutations.is_empty()
            || self.mutations.len() > MAX_MUTATIONS
        {
            return Err(Error::InvalidBatch);
        }
        let mut previous = "";
        for mutation in &self.mutations {
            if mutation.kind != "put"
                || !identity(&mutation.id, 32)
                || mutation.id.as_str() <= previous
                || mutation
                    .expected_head_hash
                    .as_ref()
                    .is_some_and(|value| !identity(value, 64))
            {
                return Err(Error::InvalidBatch);
            }
            mutation.row.check_native()?;
            previous = &mutation.id;
        }
        Ok(())
    }
}

impl NativeRow {
    fn check_native(&self) -> Result<(), Error> {
        if self.utc_day > 99_999_999
            || self.client != "claude"
            || self.provider.is_some()
            || self.model.is_some()
            || self.records != 1
            || self.reported_cost_microusd.is_some()
            || self.reported_cost_records != 0
            || self.estimated_cost_microusd.is_some()
            || self.estimated_cost_records != 0
            || self.duration_ms.is_some()
            || self.timed_records != 0
            || self.timed_tokens != "0"
            || self.token_basis != "reported"
            || self.breakdown_coverage != "partial"
        {
            return Err(Error::InvalidBatch);
        }
        let mut total = 0u64;
        for token in [
            &self.tokens.input,
            &self.tokens.cache_read,
            &self.tokens.cache_write,
            &self.tokens.output,
            &self.tokens.reasoning,
        ] {
            if token.is_empty()
                || token.len() > 20
                || !token.bytes().all(|byte| byte.is_ascii_digit())
                || (token.len() > 1 && token.starts_with('0'))
            {
                return Err(Error::InvalidBatch);
            }
            total = total
                .checked_add(token.parse::<u64>().map_err(|_| Error::InvalidBatch)?)
                .ok_or(Error::InvalidBatch)?;
        }
        Ok(())
    }
}

// deserialize_with makes nullable fields required. Plain Option<T> would silently
// admit missing fields, unlike statsOwnRecord on the TypeScript boundary.
fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(de: D) -> Result<Option<T>, D::Error> {
    Option::deserialize(de)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Envelope<T> {
    schema_version: u8,
    result: Success<T>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Success<T> {
    ok: bool,
    value: T,
}
pub(super) fn success<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, Error> {
    if bytes.len() > MAX_REPLY_BYTES {
        return Err(Error::InvalidReply);
    }
    let value: Envelope<T> = serde_json::from_slice(bytes).map_err(|_| Error::InvalidReply)?;
    if value.schema_version != 3 || !value.result.ok {
        return Err(Error::InvalidReply);
    }
    Ok(value.result.value)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct HeadPage {
    schema_version: u8,
    profile: String,
    mode: String,
    account_id: String,
    generation: String,
    device_id: String,
    pub revision: u64,
    observed_at_ms: u64,
    pub population: Population,
    pub entries: Vec<Entry>,
    #[serde(rename = "next")]
    _next: (),
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Population {
    id: String,
    generation: String,
    device_id: String,
    writer_revision: u64,
    pub revision: u64,
    pub head_hash: String,
    pub member_count: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Entry {
    id: String,
    #[serde(deserialize_with = "nullable")]
    pub head: Option<Head>,
    #[serde(deserialize_with = "nullable")]
    pub membership_head_hash: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Head {
    id: String,
    pub head_hash: String,
    #[serde(deserialize_with = "nullable")]
    pub payload_hash: Option<String>,
    #[serde(deserialize_with = "nullable")]
    reference: Option<Reference>,
    members: u64,
    pub deleted: bool,
    #[serde(rename = "legacySupport")]
    _legacy_support: bool,
    pub suppressed_legacy: bool,
}
#[derive(Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
enum Reference {
    #[serde(rename = "batch-v3", rename_all = "camelCase")]
    Batch {
        body_hash: String,
        index: u64,
        payload_hash: String,
    },
    #[serde(rename = "admission-v1", rename_all = "camelCase")]
    Admission {
        generation: String,
        body_hash: String,
        index: u64,
        payload_hash: String,
        operation_hash: String,
    },
}
impl Reference {
    fn check(&self, payload: &str) -> bool {
        let (body_hash, index, payload_hash) = match self {
            Self::Batch {
                body_hash,
                index,
                payload_hash,
            } => (body_hash, index, payload_hash),
            Self::Admission {
                generation,
                body_hash,
                index,
                payload_hash,
                operation_hash,
            } => {
                if !identity(generation, 64) || !identity(operation_hash, 64) {
                    return false;
                }
                (body_hash, index, payload_hash)
            }
        };
        identity(body_hash, 64) && *index < 256 && payload_hash == payload
    }
}
impl Head {
    fn check(&self, id: &str) -> bool {
        if self.id != id || !identity(&self.head_hash, 64) || self.members > 1_024 {
            return false;
        }
        if self.deleted {
            return self.payload_hash.is_none() && self.reference.is_none();
        }
        self.payload_hash.as_deref().is_some_and(|payload| {
            identity(payload, 64)
                && self
                    .reference
                    .as_ref()
                    .is_some_and(|source| source.check(payload))
        })
    }
}
impl HeadPage {
    pub(super) fn check(&self, query: &NamedQuery) -> Result<(), Error> {
        let pop = &self.population;
        if self.schema_version != 3
            || self.profile != "contribution-heads-v3"
            || self.mode != "heads"
            || self.account_id != query.account_id
            || self.generation != query.generation
            || self.device_id != query.device_id
            || self.revision != query.expected_revision
            || self.revision > MAX_REVISION
            || self.observed_at_ms > MAX_TIME
            || pop.id != query.population_id
            || pop.generation != query.generation
            || pop.device_id != query.device_id
            || pop.writer_revision != query.writer_revision
            || pop.revision > self.revision
            || !hex(&pop.head_hash, 64)
            || (pop.revision == 0) != (pop.head_hash == ZERO_HASH)
            || pop.member_count > MAX_OBSERVATIONS as u64
            || self.entries.len() != query.ids.len()
        {
            return Err(Error::InvalidReply);
        }
        let mut memberships = 0;
        for (entry, id) in self.entries.iter().zip(&query.ids) {
            if entry.id != *id || entry.head.as_ref().is_some_and(|head| !head.check(id)) {
                return Err(Error::InvalidReply);
            }
            if let Some(membership) = &entry.membership_head_hash {
                if !identity(membership, 64)
                    || !entry.head.as_ref().is_some_and(|head| head.members > 0)
                {
                    return Err(Error::InvalidReply);
                }
                memberships += 1;
            }
        }
        if memberships > pop.member_count {
            return Err(Error::InvalidReply);
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(tag = "outcome", deny_unknown_fields)]
pub(super) enum Terminal {
    #[serde(rename = "committed")]
    Committed { receipt: Receipt },
    #[serde(rename = "abandoned", rename_all = "camelCase")]
    Abandoned {
        operation_id: String,
        body_hash: String,
        revision: u64,
    },
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Receipt {
    pub schema_version: u8,
    pub operation_id: String,
    pub body_hash: String,
    pub account_id: String,
    pub generation: String,
    pub device_id: String,
    pub sequence: u64,
    pub revision: u64,
    pub population_id: String,
    pub population_revision: u64,
    pub population_head: String,
    pub committed_at_ms: u64,
}
