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
#[derive(Clone, Deserialize)]
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
    pub(super) control: ControlView,
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
    let population_present = value.population.is_some();
    let position_owned = population_present
        && value.phase == Phase::Active
        && value
            .population
            .as_ref()
            .is_some_and(|p| p.device_id == request.device_id);
    let population_revision = value.population.as_ref().map_or(0, |p| p.revision);
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
    Ok(CheckedStatus {
        position,
        terminal,
        control: ControlView {
            revision: value.revision,
            prepared: value.phase == Phase::Prepared,
            activated: value.activation_hash.is_some(),
            migrated: value.migration_manifest_hash.is_some(),
            population_present,
            population_owned: position_owned,
            population_revision,
            next_sequence: value.next_sequence,
        },
    })
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

pub(super) const CONTROL_REQUEST_BYTES: usize = 2_048;
pub(super) const CONTROL_REPLY_BYTES: usize = 4_096;
const MAX_HEADS: u64 = 262_144;
const MAX_UNRESOLVED_BODIES: u64 = 65_536;
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ActivateRequest {
    schema_version: u8,
    operation_id: String,
    account_id: String,
    generation: String,
    device_id: String,
    expected_revision: u64,
    mode: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct MigrateRequest {
    schema_version: u8,
    pub(super) operation_id: String,
    account_id: String,
    generation: String,
    device_id: String,
    expected_revision: u64,
    expected_v1_revision: u64,
    expected_v2_revision: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct GrantRequest {
    schema_version: u8,
    operation_id: String,
    account_id: String,
    generation: String,
    device_id: String,
    population_id: String,
    expected_revision: u64,
    expected_writer_revision: u64,
    previous_device_id: Option<String>,
    abandon_operation_id: Option<String>,
}
pub(super) fn activate_request(
    binding: &Binding,
    operation: &str,
    expected_revision: u64,
) -> Result<ActivateRequest, &'static str> {
    binding.validate()?;
    if !identity(operation, 64) || expected_revision >= MAX_REVISION {
        return Err(INVALID);
    }
    Ok(ActivateRequest {
        schema_version: 3,
        operation_id: operation.into(),
        account_id: binding.account_id.clone(),
        generation: binding.generation.clone(),
        device_id: binding.device_id.clone(),
        expected_revision,
        mode: "fresh-empty".into(),
    })
}
pub(super) fn migrate_request(
    binding: &Binding,
    operation: &str,
    expected_revision: u64,
    expected_v1_revision: u64,
    expected_v2_revision: u64,
) -> Result<MigrateRequest, &'static str> {
    binding.validate()?;
    if !identity(operation, 64)
        || expected_revision >= MAX_REVISION
        || expected_v1_revision > 4_096
        || expected_v2_revision > MAX_REVISION
    {
        return Err(INVALID);
    }
    Ok(MigrateRequest {
        schema_version: 3,
        operation_id: operation.into(),
        account_id: binding.account_id.clone(),
        generation: binding.generation.clone(),
        device_id: binding.device_id.clone(),
        expected_revision,
        expected_v1_revision,
        expected_v2_revision,
    })
}
pub(super) fn grant_request(
    binding: &Binding,
    operation: &str,
    population: &str,
    expected_revision: u64,
) -> Result<GrantRequest, &'static str> {
    binding.validate()?;
    if !identity(operation, 64) || !identity(population, 64) || expected_revision >= MAX_REVISION {
        return Err(INVALID);
    }
    Ok(GrantRequest {
        schema_version: 3,
        operation_id: operation.into(),
        account_id: binding.account_id.clone(),
        generation: binding.generation.clone(),
        device_id: binding.device_id.clone(),
        population_id: population.into(),
        expected_revision,
        expected_writer_revision: 0,
        previous_device_id: None,
        abandon_operation_id: None,
    })
}
pub(super) fn control_body<T: Serialize>(request: &T) -> Result<Vec<u8>, &'static str> {
    let bytes = serde_json::to_vec(request).map_err(|_| INVALID)?;
    if bytes.is_empty() || bytes.len() > CONTROL_REQUEST_BYTES {
        return Err(INVALID);
    }
    Ok(bytes)
}
/// Activation replay preserves the request verbatim so the reserved body hash
/// matches; the receipt's revision must be exactly the admitted successor.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActivationReply {
    schema_version: u8,
    operation_id: String,
    account_id: String,
    generation: String,
    device_id: String,
    expected_revision: u64,
    mode: String,
    body_hash: String,
    revision: u64,
}
pub(super) fn activation_receipt(
    status_code: u16,
    bytes: &[u8],
    request: &ActivateRequest,
) -> Result<u64, &'static str> {
    let value: ActivationReply = response(status_code, bytes, CONTROL_REPLY_BYTES)?;
    if value.schema_version != 3
        || value.operation_id != request.operation_id
        || value.account_id != request.account_id
        || value.generation != request.generation
        || value.device_id != request.device_id
        || value.expected_revision != request.expected_revision
        || value.mode != request.mode
        || !identity(&value.body_hash, 64)
        || value.revision != request.expected_revision + 1
    {
        return Err(INVALID);
    }
    Ok(value.revision)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MigrationReply {
    schema_version: u8,
    operation_id: String,
    account_id: String,
    generation: String,
    device_id: String,
    expected_revision: u64,
    expected_v1_revision: u64,
    expected_v2_revision: u64,
    body_hash: String,
    revision: u64,
    manifest_hash: String,
    delta_manifest_hash: String,
    delta_count: u64,
    head_count: u64,
    suppressed_v1_heads: u64,
    unresolved_v2_bodies: u64,
}
pub(super) struct MigrationSettled {
    pub(super) revision: u64,
    pub(super) manifest_hash: String,
    pub(super) head_count: u64,
    pub(super) suppressed_v1_heads: u64,
    pub(super) unresolved_v2_bodies: u64,
}
pub(super) fn migration_receipt(
    status_code: u16,
    bytes: &[u8],
    request: &MigrateRequest,
) -> Result<MigrationSettled, &'static str> {
    let value: MigrationReply = response(status_code, bytes, CONTROL_REPLY_BYTES)?;
    if value.schema_version != 3
        || value.operation_id != request.operation_id
        || value.account_id != request.account_id
        || value.generation != request.generation
        || value.device_id != request.device_id
        || value.expected_revision != request.expected_revision
        || value.expected_v1_revision != request.expected_v1_revision
        || value.expected_v2_revision != request.expected_v2_revision
        || !identity(&value.body_hash, 64)
        || value.revision != request.expected_revision + 1
        || !identity(&value.manifest_hash, 64)
        || !identity(&value.delta_manifest_hash, 64)
        || value.delta_count > MAX_HEADS
        || !(value.delta_count..=MAX_HEADS).contains(&value.head_count)
        || value.suppressed_v1_heads > value.head_count
        || value.unresolved_v2_bodies > MAX_UNRESOLVED_BODIES
    {
        return Err(INVALID);
    }
    Ok(MigrationSettled {
        revision: value.revision,
        manifest_hash: value.manifest_hash,
        head_count: value.head_count,
        suppressed_v1_heads: value.suppressed_v1_heads,
        unresolved_v2_bodies: value.unresolved_v2_bodies,
    })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AbandonedReply {
    outcome: String,
    operation_id: String,
    body_hash: String,
    revision: u64,
}
/// The terminal for an explicit migration cancellation. Only an `abandoned`
/// outcome may close a pending migration; a committed batch-shaped terminal
/// or any mismatched operation refuses.
pub(super) fn migration_terminal(
    status_code: u16,
    bytes: &[u8],
    request: &MigrateRequest,
) -> Result<(String, u64), &'static str> {
    let value: AbandonedReply = response(status_code, bytes, CONTROL_REPLY_BYTES)?;
    if value.outcome != "abandoned"
        || value.operation_id != request.operation_id
        || !identity(&value.body_hash, 64)
        || !(1..=MAX_REVISION).contains(&value.revision)
    {
        return Err(INVALID);
    }
    Ok((value.body_hash, value.revision))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GrantedPopulation {
    id: String,
    generation: String,
    device_id: String,
    writer_revision: u64,
    revision: u64,
    head_hash: String,
    member_count: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GrantReply {
    schema_version: u8,
    operation_id: String,
    body_hash: String,
    revision: u64,
    population: GrantedPopulation,
}
pub(super) struct GrantSettled {
    pub(super) revision: u64,
    pub(super) population_revision: u64,
    pub(super) writer_revision: u64,
    pub(super) member_count: u64,
}
pub(super) fn grant_receipt(
    status_code: u16,
    bytes: &[u8],
    request: &GrantRequest,
) -> Result<GrantSettled, &'static str> {
    let value: GrantReply = response(status_code, bytes, CONTROL_REPLY_BYTES)?;
    if value.schema_version != 3
        || value.operation_id != request.operation_id
        || !identity(&value.body_hash, 64)
        || !(request.expected_revision + 1..=MAX_REVISION).contains(&value.revision)
        || value.population.id != request.population_id
        || value.population.generation != request.generation
        || value.population.device_id != request.device_id
        || !(1..=MAX_REVISION).contains(&value.population.writer_revision)
        || value.population.revision > value.revision
        || !hexadecimal(&value.population.head_hash, 64)
        || (value.population.revision == 0) != value.population.head_hash.bytes().all(|b| b == b'0')
        || value.population.member_count > 8_192
    {
        return Err(INVALID);
    }
    Ok(GrantSettled {
        revision: value.revision,
        population_revision: value.population.revision,
        writer_revision: value.population.writer_revision,
        member_count: value.population.member_count,
    })
}
/// Control-state view for the ops driver: only the fields an activation or
/// grant decision may consume, all validated by the shared status parse.
pub(super) struct ControlView {
    pub(super) revision: u64,
    pub(super) prepared: bool,
    pub(super) activated: bool,
    pub(super) migrated: bool,
    pub(super) population_present: bool,
    pub(super) population_owned: bool,
    pub(super) population_revision: u64,
    pub(super) next_sequence: u64,
}

#[cfg(test)]
mod tests;
