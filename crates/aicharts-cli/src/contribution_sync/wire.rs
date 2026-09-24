//! Pure strict DTO validation. Parsing here never creates authenticated authority.
use super::{Binding, StoredScope, MAX_REVISION, MAX_SEQUENCE, MAX_TERMINAL_BYTES};
use aicharts_core::contribution_producer::{
    CorrelatedTerminal, PreparedBatch, TerminalOutcome, TerminalRecord,
};
use serde::{
    de::{DeserializeOwned, IgnoredAny},
    Deserialize, Deserializer, Serialize,
};

pub(super) const STATUS_REQUEST_BYTES: usize = 2_048;
pub(super) const INVALID: &str = "contribution_sync_invalid_response";
pub(super) const UNCERTAIN: &str = "contribution_sync_exchange_uncertain";
fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(de: D) -> Result<Option<T>, D::Error> {
    Option::deserialize(de)
}
pub(super) fn identity(value: &str, width: usize) -> bool {
    hexadecimal(value, width) && value.bytes().any(|b| b != b'0')
}
fn hexadecimal(value: &str, width: usize) -> bool {
    value.len() == width
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope<T> {
    schema_version: u8,
    result: ResultDto<T>,
}
#[derive(Deserialize)]
#[serde(untagged)]
enum ResultDto<T> {
    Success(Success<T>),
    Failure(Failure),
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Success<T> {
    ok: bool,
    value: T,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Failure {
    ok: bool,
    error: String,
}

fn failure(error: &str) -> Option<(u16, &'static str)> {
    Some(match error {
        "invalid_input" => (400, "contribution_sync_request_refused"),
        "unauthorized" => (401, "contribution_sync_unauthorized"),
        "not_enrolled" => (401, "contribution_sync_not_enrolled"),
        "revoked" => (409, "contribution_sync_revoked"),
        "generation_conflict" => (409, "contribution_sync_generation_conflict"),
        "writer_conflict" => (409, "contribution_sync_writer_conflict"),
        "conflict" => (409, "contribution_sync_conflict"),
        "population_conflict" => (409, "contribution_sync_population_conflict"),
        "predecessor_conflict" => (409, "contribution_sync_predecessor_conflict"),
        "subject_deleted" => (409, "contribution_sync_subject_deleted"),
        "legacy_unresolved" => (409, "contribution_sync_legacy_unresolved"),
        "limit" => (409, "contribution_sync_limit"),
        "not_started" => (409, "contribution_sync_not_started"),
        "clock_regressed" => (503, "contribution_sync_clock_regressed"),
        "storage_invalid" => (503, "contribution_sync_storage_invalid"),
        "storage_unavailable" => (503, UNCERTAIN),
        "recovery_required" => (503, "contribution_sync_recovery_required"),
        _ => return None,
    })
}
fn response<T: DeserializeOwned>(status: u16, bytes: &[u8], cap: usize) -> Result<T, &'static str> {
    if bytes.is_empty() || bytes.len() > cap {
        return Err(INVALID);
    }
    let reply: Envelope<T> = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    if reply.schema_version != 3 {
        return Err(INVALID);
    }
    match reply.result {
        ResultDto::Success(value) if value.ok && status == 200 => Ok(value.value),
        ResultDto::Failure(value) if !value.ok => {
            let (expected, code) = failure(&value.error).ok_or(INVALID)?;
            Err(if status == expected { code } else { INVALID })
        }
        _ => Err(INVALID),
    }
}
pub(super) fn success(status: u16, bytes: &[u8], cap: usize) -> Result<(), &'static str> {
    response::<IgnoredAny>(status, bytes, cap).map(|_| ())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StatusRequest {
    schema_version: u8,
    account_id: String,
    generation: String,
    device_id: String,
    population_id: String,
    operation_id: Option<String>,
}
impl StatusRequest {
    pub(super) fn new(
        binding: &Binding,
        population: &str,
        batch: Option<&PreparedBatch>,
    ) -> Result<Self, &'static str> {
        binding.validate()?;
        if !identity(population, 64)
            || batch.is_some_and(|batch| {
                Binding::from_scope(&batch.scope()) != *binding
                    || batch.scope().population_id() != population
            })
        {
            return Err(INVALID);
        }
        Ok(Self {
            schema_version: 3,
            account_id: binding.account_id.clone(),
            generation: binding.generation.clone(),
            device_id: binding.device_id.clone(),
            population_id: population.into(),
            operation_id: batch.map(|value| value.operation_id().into()),
        })
    }
    pub(super) fn bytes(&self) -> Result<Vec<u8>, &'static str> {
        let bytes = serde_json::to_vec(self).map_err(|_| INVALID)?;
        if bytes.len() > STATUS_REQUEST_BYTES {
            return Err(INVALID);
        }
        Ok(bytes)
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Population {
    id: String,
    generation: String,
    device_id: String,
    writer_revision: u64,
    revision: u64,
    head_hash: String,
    member_count: u64,
}
impl Population {
    fn checked(&self, request: &StatusRequest, revision: u64) -> Result<(), &'static str> {
        if self.id != request.population_id
            || self.generation != request.generation
            || !identity(&self.device_id, 64)
            || !(1..=MAX_REVISION).contains(&self.writer_revision)
            || self.revision > revision
            || !hexadecimal(&self.head_hash, 64)
            || (self.revision == 0) != self.head_hash.bytes().all(|b| b == b'0')
            || self.member_count > 8_192
        {
            return Err(INVALID);
        }
        Ok(())
    }
}
#[derive(Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Prepared,
    Active,
}
#[derive(Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Outcome {
    Pending,
    Committed,
    Abandoned,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Operation {
    operation_id: String,
    body_hash: String,
    outcome: Outcome,
    #[serde(deserialize_with = "nullable")]
    terminal: Option<TerminalRecord>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Status {
    schema_version: u8,
    account_id: String,
    generation: String,
    revision: u64,
    next_sequence: u64,
    phase: Phase,
    #[serde(deserialize_with = "nullable")]
    activation_hash: Option<String>,
    #[serde(deserialize_with = "nullable")]
    migration_manifest_hash: Option<String>,
    #[serde(deserialize_with = "nullable")]
    population: Option<Population>,
    #[serde(deserialize_with = "nullable")]
    operation: Option<Operation>,
    legacy_resolution: String,
}
pub(super) struct Position {
    pub(super) scope: StoredScope,
    pub(super) next_sequence: u64,
    pub(super) revision: u64,
    pub(super) population_revision: u64,
    pub(super) population_head: String,
}
pub(super) struct CheckedStatus {
    pub(super) position: Option<Position>,
    pub(super) terminal: Option<CorrelatedTerminal>,
}
pub(super) fn status(
    status_code: u16,
    bytes: &[u8],
    request: &StatusRequest,
    batch: Option<&PreparedBatch>,
) -> Result<CheckedStatus, &'static str> {
    let value: Status = response(status_code, bytes, MAX_TERMINAL_BYTES)?;
    if value.schema_version != 3
        || value.account_id != request.account_id
        || value.generation != request.generation
        || value.revision > MAX_REVISION
        || !(1..=MAX_SEQUENCE).contains(&value.next_sequence)
        || value.legacy_resolution != "not_evaluated"
        || match value.phase {
            Phase::Prepared => {
                value.activation_hash.is_some() || value.migration_manifest_hash.is_some()
            }
            Phase::Active => {
                value
                    .activation_hash
                    .as_ref()
                    .is_none_or(|v| !identity(v, 64))
                    || value
                        .migration_manifest_hash
                        .as_ref()
                        .is_some_and(|v| !identity(v, 64))
            }
        }
    {
        return Err(INVALID);
    }
    if let Some(population) = &value.population {
        population.checked(request, value.revision)?;
    }
    let terminal = if let Some(operation) = &value.operation {
        let batch = batch.ok_or(INVALID)?;
        if request.operation_id.as_deref() != Some(batch.operation_id())
            || operation.operation_id != batch.operation_id()
            || operation.body_hash != batch.body_hash()
        {
            return Err(INVALID);
        }
        match (&operation.outcome, &operation.terminal) {
            (Outcome::Pending, None) => None,
            (Outcome::Committed | Outcome::Abandoned, Some(record)) => {
                let correlated = batch.correlate_record(record).map_err(|_| INVALID)?;
                if let Some((revision, head)) = correlated.committed_population() {
                    if value.population.as_ref().is_none_or(|population| {
                        population.revision < revision
                            || (population.revision == revision && population.head_hash != head)
                    }) {
                        return Err(INVALID);
                    }
                }
                if (operation.outcome == Outcome::Committed)
                    != (correlated.outcome() == TerminalOutcome::Committed)
                    || correlated.revision() > value.revision
                    || value.next_sequence <= batch.sequence()
                    || (correlated.outcome() == TerminalOutcome::Committed
                        && value.population.is_none())
                {
                    return Err(INVALID);
                }
                Some(correlated)
            }
            _ => return Err(INVALID),
        }
    } else {
        None
    };
    let position = value
        .population
        .filter(|p| value.phase == Phase::Active && p.device_id == request.device_id)
        .map(|p| Position {
            scope: StoredScope {
                binding: Binding {
                    account_id: request.account_id.clone(),
                    generation: request.generation.clone(),
                    device_id: request.device_id.clone(),
                },
                population_id: p.id,
                writer_revision: p.writer_revision,
            },
            next_sequence: value.next_sequence,
            revision: value.revision,
            population_revision: p.revision,
            population_head: p.head_hash,
        });
    Ok(CheckedStatus { position, terminal })
}
pub(super) fn status_terminal(
    bytes: &[u8],
    batch: &PreparedBatch,
) -> Result<CorrelatedTerminal, &'static str> {
    let scope = batch.scope();
    let request = StatusRequest::new(
        &Binding::from_scope(&scope),
        scope.population_id(),
        Some(batch),
    )?;
    status(200, bytes, &request, Some(batch))?
        .terminal
        .ok_or(INVALID)
}

#[cfg(test)]
mod tests;
