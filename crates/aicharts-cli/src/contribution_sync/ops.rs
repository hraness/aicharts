//! Durable account control operations: activate, migrate, grant, status.
//! Every intent persists its exact request bytes under the state key before
//! dispatch; a retry always replays identical bytes, so the service's
//! idempotent operation table either resumes the same pending intent or
//! returns its retained terminal. The journal is append-only evidence and is
//! never deleted; a corrupt or foreign record fails closed and the service
//! status reconciles it.
use super::{
    https::{Deadline, Transport},
    wire, Binding,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use hmac::{Hmac, Mac};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::Sha256;
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
};

const FILE: &str = "contribution-ops-v3";
const PENDING: &str = "contribution-ops-v3.pending";
const LOCK: &str = "contribution-ops-v3.lock";
// Settled records are retained as evidence; a restartable operation retries
// under new intents after each decided refusal, so the bound must cover the
// churn of a long unblocked operation, not just a handful of attempts.
const MAX_OPS: usize = 256;
const MAX_JOURNAL_BYTES: usize = 262_144;
const MAX_REQUEST_BYTES: usize = wire::CONTROL_REQUEST_BYTES;
const MAX_TERMINAL_BYTES: usize = wire::CONTROL_REPLY_BYTES;
const IO: &str = "contribution_ops_unavailable";
const INVALID: &str = "contribution_ops_recovery_required";

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpRecord {
    key: String,
    operation_id: String,
    request: String,
    terminal: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Payload {
    binding: Binding,
    ops: Vec<OpRecord>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    schema_version: u8,
    payload: Payload,
    mac: String,
}

fn mac(key: &[u8; 32], payload: &Payload) -> Result<String, &'static str> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|_| INVALID)?;
    mac.update(b"aicharts:contribution-sync-v3:ops\0");
    mac.update(&serde_json::to_vec(payload).map_err(|_| INVALID)?);
    Ok(mac
        .finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}
fn encode(key: &[u8; 32], payload: &Payload) -> Result<Vec<u8>, &'static str> {
    let mac = mac(key, payload)?;
    let bytes = serde_json::to_vec(&Journal {
        schema_version: 1,
        payload: payload.clone(),
        mac,
    })
    .map_err(|_| INVALID)?;
    if bytes.is_empty() || bytes.len() > MAX_JOURNAL_BYTES {
        return Err(INVALID);
    }
    Ok(bytes)
}
fn decode(key: &[u8; 32], bytes: &[u8]) -> Result<Payload, &'static str> {
    if bytes.is_empty() || bytes.len() > MAX_JOURNAL_BYTES {
        return Err(INVALID);
    }
    let journal: Journal = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    if journal.schema_version != 1
        || journal.payload.ops.len() > MAX_OPS
        || journal.payload.ops.iter().any(|op| {
            !wire::identity(&op.operation_id, 64)
                || STANDARD
                    .decode(&op.request)
                    .map(|b| b.is_empty() || b.len() > MAX_REQUEST_BYTES)
                    .unwrap_or(true)
                || op.terminal.as_ref().is_some_and(|t| {
                    STANDARD
                        .decode(t)
                        .map(|b| b.is_empty() || b.len() > MAX_TERMINAL_BYTES)
                        .unwrap_or(true)
                })
        })
    {
        return Err(INVALID);
    }
    if mac(key, &journal.payload)? != journal.mac {
        return Err(INVALID);
    }
    if serde_json::to_vec(&journal).map_err(|_| INVALID)? != bytes {
        return Err(INVALID);
    }
    journal.payload.binding.validate()?;
    Ok(journal.payload)
}
fn stray(path: &Path) -> bool {
    // A present non-regular file (link, fifo, directory) is hostile evidence.
    fs::symlink_metadata(path)
        .map(|meta| !meta.is_file() || meta.file_type().is_symlink())
        .unwrap_or(false)
}
fn lock(dir: &Path) -> Result<File, &'static str> {
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(dir.join(LOCK))
        .map_err(|_| IO)?;
    rustix::fs::flock(&file, rustix::fs::FlockOperation::NonBlockingLockExclusive)
        .map_err(|_| IO)?;
    Ok(file)
}
fn read_file(dir: &Path, name: &str) -> Result<Option<Vec<u8>>, &'static str> {
    let path = dir.join(name);
    match fs::read(&path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !stray(&path) => Ok(None),
        // An existing-but-unreadable journal is retained evidence, not a
        // missing one; only a verified absent path reads as empty.
        Err(_) => Err(INVALID),
    }
}

struct JournalFile {
    _lock: Option<File>,
    dir: PathBuf,
    key: [u8; 32],
    payload: Payload,
}
impl JournalFile {
    /// Open the journal under an advisory lock. A missing journal is a valid
    /// empty one; a valid staged write still pending rename counts as current;
    /// a present-but-invalid journal or stage refuses and is never removed.
    fn open(dir: &Path, key: &[u8; 32], binding: &Binding) -> Result<Self, &'static str> {
        let _lock = lock(dir)?;
        let payload = match read_file(dir, FILE)? {
            Some(bytes) => decode(key, &bytes)?,
            None => match read_file(dir, PENDING)? {
                Some(bytes) => decode(key, &bytes)?,
                None => Payload {
                    binding: binding.clone(),
                    ops: Vec::new(),
                },
            },
        };
        if payload.binding != *binding {
            return Err(INVALID);
        }
        Ok(Self {
            _lock: Some(_lock),
            dir: dir.into(),
            key: *key,
            payload,
        })
    }
    /// Journal-only open for local inspection: the MAC authenticates the
    /// claimed binding; no external authority is consulted.
    fn local(dir: &Path, key: &[u8; 32]) -> Result<Option<Self>, &'static str> {
        let payload = match read_file(dir, FILE)? {
            Some(bytes) => Some(decode(key, &bytes)?),
            None => read_file(dir, PENDING)?
                .map(|bytes| decode(key, &bytes))
                .transpose()?,
        };
        Ok(payload.map(|payload| Self {
            _lock: None,
            dir: dir.into(),
            key: *key,
            payload,
        }))
    }
    fn persist(&self) -> Result<(), &'static str> {
        let bytes = encode(&self.key, &self.payload)?;
        let pending = self.dir.join(PENDING);
        let target = self.dir.join(FILE);
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&pending)
            .map_err(|_| IO)?;
        file.write_all(&bytes).map_err(|_| IO)?;
        file.sync_all().map_err(|_| IO)?;
        drop(file);
        fs::rename(&pending, &target).map_err(|_| IO)?;
        File::open(&self.dir)
            .and_then(|dir| dir.sync_all())
            .map_err(|_| IO)
    }
}
/// The replayable intent: an op that persisted but has no terminal yet.
fn unsettled<'a>(payload: &'a Payload, key: &str) -> Option<&'a OpRecord> {
    payload
        .ops
        .iter()
        .find(|op| op.key == key && op.terminal.is_none())
}
/// The latest decided record for a key; settled records are evidence only.
fn settled<'a>(payload: &'a Payload, key: &str) -> Option<&'a OpRecord> {
    payload
        .ops
        .iter()
        .rev()
        .find(|op| op.key == key && op.terminal.is_some())
}
fn push(payload: &mut Payload, record: OpRecord) -> Result<(), &'static str> {
    if unsettled(payload, &record.key).is_some() || payload.ops.len() >= MAX_OPS {
        return Err(INVALID);
    }
    payload.ops.push(record);
    Ok(())
}
fn operation_id() -> Result<String, &'static str> {
    let mut value = [0u8; 32];
    getrandom::fill(&mut value).map_err(|_| "contribution_sync_random_unavailable")?;
    Ok(value.iter().map(|b| format!("{b:02x}")).collect())
}
fn operation_id_of(request: &[u8]) -> Result<String, &'static str> {
    let value: serde_json::Value = serde_json::from_slice(request).map_err(|_| INVALID)?;
    value
        .get("operationId")
        .and_then(serde_json::Value::as_str)
        .filter(|id| wire::identity(id, 64))
        .map(str::to_string)
        .ok_or(INVALID)
}
/// The per-device primary population: stable and derivable, so --grant may run
/// without naming an id, but never guessable for an outside party.
fn primary_population(key: &[u8; 32], binding: &Binding) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("hmac accepts any key");
    mac.update(b"aicharts:contribution:primary-population:v3\0");
    mac.update(binding.account_id.as_bytes());
    mac.update(b"\0");
    mac.update(binding.generation.as_bytes());
    mac.update(b"\0");
    mac.update(binding.device_id.as_bytes());
    mac.finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn retained_population(payload: &Payload) -> Option<String> {
    let granted: Vec<&str> = payload
        .ops
        .iter()
        // Only a grant the service actually settled owns a population; a
        // decided refusal is evidence, never authority.
        .filter(|op| {
            op.terminal.as_ref().is_some_and(|terminal| {
                STANDARD
                    .decode(terminal)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
                    .is_some_and(|value| value.get("refused").is_none())
            })
        })
        .filter_map(|op| op.key.strip_prefix("grant:"))
        .collect();
    (granted.len() == 1).then(|| granted[0].to_string())
}
/// Resolve the population an op applies to: the explicit flag, then the
/// journal's single settled grant, then the per-device primary id.
fn population(
    explicit: Option<&str>,
    payload: &Payload,
    key: &[u8; 32],
    binding: &Binding,
) -> String {
    explicit
        .map(str::to_string)
        .or_else(|| retained_population(payload))
        .unwrap_or_else(|| primary_population(key, binding))
}

/// The journal's sole settled grant, for defaulting the population flag.
pub(super) fn journal_population(dir: &Path, key: &[u8; 32], binding: &Binding) -> Option<String> {
    let journal = JournalFile::open(dir, key, binding).ok()?;
    retained_population(&journal.payload)
}
pub(super) fn status(
    dir: &Path,
    key: &[u8; 32],
    explicit: Option<&str>,
    transport: &Transport,
    deadline: &Deadline,
) -> Result<String, &'static str> {
    // Pure observation: read any retained journal without the writer lock.
    let payload = JournalFile::local(dir, key)?
        .map(|journal| journal.payload)
        .unwrap_or_else(|| Payload {
            binding: transport.binding().clone(),
            ops: Vec::new(),
        });
    let population = population(explicit, &payload, key, transport.binding());
    match transport.control(&population, deadline) {
        Ok(view) => serde_json::to_string(&serde_json::json!({
            "schemaVersion": 3, "status": "observed",
            "revision": view.revision, "phase": if view.prepared { "prepared" } else { "active" },
            "activated": view.activated, "migrated": view.migrated,
            "populationPresent": view.population_present, "populationOwned": view.population_owned,
            "populationRevision": view.population_revision, "nextSequence": view.next_sequence,
            "populationId": population,
        }))
        .map_err(|_| super::INVALID),
        Err("contribution_sync_not_started") => serde_json::to_string(&serde_json::json!({
            "schemaVersion": 3, "status": "not_started",
        }))
        .map_err(|_| super::INVALID),
        Err(code) => Err(code),
    }
}

/// Run one control op under its record key: a settled retained record reports
/// its stored terminal, a pending one replays identical bytes, and a new intent
/// persists before its single dispatch per call.
fn run_op<B: Serialize + DeserializeOwned, T>(
    journal: &mut JournalFile,
    transport: &Transport,
    deadline: &Deadline,
    record_key: &str,
    build: impl FnOnce(&Payload, &Transport, &Deadline) -> Result<B, &'static str>,
    dispatch: impl FnOnce(&Transport, &Deadline, &B) -> Result<T, &'static str>,
    describe: impl FnOnce(&T) -> serde_json::Value,
) -> Result<String, &'static str> {
    let request: B = match unsettled(&journal.payload, record_key) {
        Some(op) => {
            let bytes = STANDARD.decode(&op.request).map_err(|_| INVALID)?;
            serde_json::from_slice(&bytes).map_err(|_| INVALID)?
        }
        None => {
            // A successful terminal is authoritative and reports without a new
            // exchange; a refused or abandoned intent was decided and retries
            // fresh.
            if let Some(op) = settled(&journal.payload, record_key) {
                let terminal = op.terminal.as_ref().ok_or(INVALID)?;
                let result: serde_json::Value =
                    serde_json::from_slice(&STANDARD.decode(terminal).map_err(|_| INVALID)?)
                        .map_err(|_| INVALID)?;
                if result.get("refused").is_none() && result.get("abandoned").is_none() {
                    return serde_json::to_string(
                        &serde_json::json!({ "schemaVersion": 3, "status": "settled",
                        "operationId": op.operation_id, "result": result }),
                    )
                    .map_err(|_| super::INVALID);
                }
            }
            let request = build(&journal.payload, transport, deadline)?;
            let bytes = serde_json::to_vec(&request).map_err(|_| INVALID)?;
            if bytes.is_empty() || bytes.len() > MAX_REQUEST_BYTES {
                return Err(INVALID);
            }
            push(
                &mut journal.payload,
                OpRecord {
                    key: record_key.into(),
                    operation_id: operation_id_of(&bytes)?,
                    request: STANDARD.encode(&bytes),
                    terminal: None,
                },
            )?;
            journal.persist()?;
            request
        }
    };
    let outcome = match dispatch(transport, deadline, &request) {
        Ok(settled) => Ok(describe(&settled)),
        // An uncertain exchange reached no service decision: the pending
        // record persists so the identical request replays on the next call.
        Err(code) if code == wire::UNCERTAIN => return Err(code),
        // A decided refusal also settles the intent durably; a later retry
        // reads fresh state and opens a new operation rather than replaying
        // bytes the service already refused.
        Err(code) => Err(code),
    };
    let result = match &outcome {
        Ok(result) => result.clone(),
        Err(code) => serde_json::json!({ "refused": code }),
    };
    let reply = serde_json::to_vec(&result).map_err(|_| INVALID)?;
    let index = journal
        .payload
        .ops
        .iter()
        .position(|op| op.key == record_key && op.terminal.is_none())
        .ok_or(INVALID)?;
    let operation_id = journal.payload.ops[index].operation_id.clone();
    journal.payload.ops[index].terminal = Some(STANDARD.encode(&reply));
    journal.persist()?;
    match outcome {
        Ok(result) => serde_json::to_string(
            &serde_json::json!({ "schemaVersion": 3, "status": "settled",
            "operationId": operation_id, "result": result }),
        )
        .map_err(|_| super::INVALID),
        Err(code) => Err(code),
    }
}

pub(super) fn activate(
    dir: &Path,
    key: &[u8; 32],
    transport: &Transport,
    deadline: &Deadline,
) -> Result<String, &'static str> {
    let mut journal = JournalFile::open(dir, key, transport.binding())?;
    run_op(
        &mut journal,
        transport,
        deadline,
        "activate",
        |_, transport, deadline| {
            let population = primary_population(key, transport.binding());
            let expected = match transport.control(&population, deadline) {
                Ok(view) if view.prepared && !view.activated && !view.migrated => view.revision,
                Ok(view) if !view.prepared && view.activated => {
                    return Err("contribution_sync_already_active")
                }
                Ok(_) => return Err("contribution_sync_migration_pending"),
                Err("contribution_sync_not_started") => 0,
                Err(code) => return Err(code),
            };
            wire::activate_request(transport.binding(), &operation_id()?, expected)
        },
        |transport, deadline, request| transport.activate(request, deadline),
        |revision| serde_json::json!({ "activated": true, "revision": revision }),
    )
}

pub(super) fn migrate(
    dir: &Path,
    key: &[u8; 32],
    transport: &Transport,
    deadline: &Deadline,
    revisions: impl FnOnce(&Path) -> Result<(u64, u64), &'static str>,
) -> Result<String, &'static str> {
    let mut journal = JournalFile::open(dir, key, transport.binding())?;
    run_op(
        &mut journal,
        transport,
        deadline,
        "migrate",
        |_, transport, deadline| {
            let population = primary_population(key, transport.binding());
            let expected = match transport.control(&population, deadline) {
                Ok(view) if view.migrated => return Err("contribution_sync_already_migrated"),
                Ok(view) if !view.prepared && view.activated => {
                    return Err("contribution_sync_already_active")
                }
                // A settled-but-unpublished intent (an abandoned migration)
                // already consumed a control revision; the pin must observe
                // the current one, not insist the account is untouched.
                Ok(view) if !view.prepared => return Err(super::CONFLICT),
                Ok(view) => view.revision,
                Err("contribution_sync_not_started") => 0,
                Err(code) => return Err(code),
            };
            let (v1, v2) = revisions(dir)?;
            wire::migrate_request(transport.binding(), &operation_id()?, expected, v1, v2)
        },
        |transport, deadline, request| transport.migrate(request, deadline),
        |settled| {
            serde_json::json!({ "migrated": true, "revision": settled.revision,
                "manifestHash": settled.manifest_hash, "headCount": settled.head_count,
                "suppressedV1Heads": settled.suppressed_v1_heads,
                "unresolvedV2Bodies": settled.unresolved_v2_bodies })
        },
    )
}

pub(super) fn grant(
    dir: &Path,
    key: &[u8; 32],
    explicit: Option<&str>,
    transport: &Transport,
    deadline: &Deadline,
) -> Result<String, &'static str> {
    let mut journal = JournalFile::open(dir, key, transport.binding())?;
    let population = population(explicit, &journal.payload, key, transport.binding());
    run_op(
        &mut journal,
        transport,
        deadline,
        &format!("grant:{population}"),
        |_, transport, deadline| {
            let view = transport.control(&population, deadline)?;
            if !view.activated {
                return Err("contribution_sync_not_started");
            }
            if view.population_present {
                return Err(if view.population_owned {
                    "contribution_sync_already_granted"
                } else {
                    "contribution_sync_writer_conflict"
                });
            }
            wire::grant_request(
                transport.binding(),
                &operation_id()?,
                &population,
                view.revision,
            )
        },
        |transport, deadline, request| transport.grant(request, deadline),
        |settled| {
            serde_json::json!({ "granted": true, "revision": settled.revision,
                "populationRevision": settled.population_revision,
                "writerRevision": settled.writer_revision, "memberCount": settled.member_count })
        },
    )
}

/// Abandon a retained pending migration: replays its exact request bytes to
/// the cancel route and, once the service records the abandoned terminal,
/// marks the local intent decided so a later `--migrate` opens fresh.
///
/// A locally refused verdict never proves the server settled the operation —
/// a refusal mid-flight can leave the intent pending and holding
/// `pendingOperation`, which refuses every later migration until it is
/// explicitly abandoned. When no intent is unsettled, the latest settled one
/// is replayed so the cancel route reconciles that server-side residue; a
/// server outcome of `migrated` still refuses to abandon.
pub(super) fn cancel_migration(
    dir: &Path,
    key: &[u8; 32],
    transport: &Transport,
    deadline: &Deadline,
) -> Result<String, &'static str> {
    let mut journal = JournalFile::open(dir, key, transport.binding())?;
    let indices: Vec<usize> = journal
        .payload
        .ops
        .iter()
        .enumerate()
        .filter(|(_, op)| op.key == "migrate")
        .map(|(index, _)| index)
        .collect();
    if indices.is_empty() {
        return Err("contribution_sync_not_pending");
    }
    let mut last: Option<(String, u64)> = None;
    let mut settled = 0usize;
    for index in indices.iter().rev().copied() {
        let bytes = STANDARD
            .decode(&journal.payload.ops[index].request)
            .map_err(|_| INVALID)?;
        let request: wire::MigrateRequest = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
        match transport.cancel_migration(&request, deadline) {
            // Idempotent on an already-abandoned row — the reply cannot prove
            // this call abandoned it, so every retained intent must be replayed;
            // only that guarantees no pending row keeps holding the slot.
            Ok((body_hash, revision)) => {
                let evidence = serde_json::to_vec(&serde_json::json!({ "abandoned": true,
                    "operationId": request.operation_id, "bodyHash": body_hash, "revision": revision }))
                .map_err(|_| INVALID)?;
                journal.payload.ops[index].terminal = Some(STANDARD.encode(evidence));
                journal.persist()?;
                settled += 1;
                last = Some((request.operation_id.clone(), revision));
            }
            // A server-settled or unknown intent does not hold the pending
            // slot; keep replaying retained intents until the live one does.
            Err("contribution_sync_not_started" | "contribution_sync_conflict") => continue,
            Err(code) => return Err(code),
        }
    }
    match last {
        Some((operation_id, revision)) => serde_json::to_string(
            &serde_json::json!({ "schemaVersion": 3, "status": "abandoned",
            "operationId": operation_id, "revision": revision, "abandonedCount": settled }),
        )
        .map_err(|_| super::INVALID),
        None => Err("contribution_sync_not_pending"),
    }
}

/// Read-only view of the retained ops journal for --inspect: the local
/// evidence of control intents, without any network authority.
pub(super) fn local_ops(
    dir: &Path,
    key: &[u8; 32],
) -> Result<Option<serde_json::Value>, &'static str> {
    let Some(journal) = JournalFile::local(dir, key)? else {
        return Ok(None);
    };
    Ok(Some(serde_json::json!({
        "binding": { "accountId": journal.payload.binding.account_id,
            "generation": journal.payload.binding.generation, "deviceId": journal.payload.binding.device_id },
        "ops": journal.payload.ops.iter().map(|op| serde_json::json!({
            "key": op.key, "operationId": op.operation_id, "settled": op.terminal.is_some(),
        })).collect::<Vec<_>>(),
    })))
}
/// One bounded provision pass for new accounts: observe, then activate or
/// migrate as legacy state requires, grant the population, and report where
/// the sequence stopped. Every step replays its retained intent on rerun.
pub(super) fn onboard(
    dir: &Path,
    key: &[u8; 32],
    explicit: Option<&str>,
    transport: &Transport,
    deadline: &Deadline,
    revisions: impl FnOnce(&Path) -> Result<(u64, u64), &'static str>,
) -> Result<String, &'static str> {
    let mut steps = Vec::new();
    let population = {
        let journal = JournalFile::open(dir, key, transport.binding())?;
        population(explicit, &journal.payload, key, transport.binding())
    };
    let view = match transport.control(&population, deadline) {
        Ok(view) => Some(view),
        Err("contribution_sync_not_started") => None,
        Err(code) => return Err(code),
    };
    // A control record is either absent or still prepared before activation:
    // the stats journal decides whether legacy history exists to carry over —
    // migrate for populated accounts, fresh-empty activate for empty ones.
    if view
        .as_ref()
        .is_none_or(|v| v.prepared && !v.activated && !v.migrated)
    {
        let (v1, v2) = revisions(dir)?;
        let result = if v1 != 0 || v2 != 0 {
            migrate(dir, key, transport, deadline, |_| Ok((v1, v2)))?
        } else {
            activate(dir, key, transport, deadline)?
        };
        steps.push(serde_json::json!({
            "step": if v1 != 0 || v2 != 0 { "migrate" } else { "activate" },
            "result": serde_json::from_str::<serde_json::Value>(&result).map_err(|_| super::INVALID)?,
        }));
    } else if view.as_ref().is_some_and(|v| v.prepared) {
        return Err("contribution_sync_migration_pending");
    }
    if !matches!(view, Some(ref view) if view.population_owned) {
        steps.push(serde_json::json!({ "step": "grant", "result": serde_json::from_str::<serde_json::Value>(
            &grant(dir, key, Some(&population), transport, deadline)?).map_err(|_| super::INVALID)? }));
    }
    serde_json::to_string(
        &serde_json::json!({ "schemaVersion": 3, "status": "provisioned",
        "populationId": population, "steps": steps }),
    )
    .map_err(|_| super::INVALID)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    const KEY: [u8; 32] = [0xa4; 32];
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    fn scratch() -> PathBuf {
        let path = std::fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!(
                "aicharts-contribution-ops-{}-{}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            ));
        fs::create_dir(&path).unwrap();
        path
    }
    fn binding() -> Binding {
        Binding::new(
            &format!("acct_{}", "1".repeat(32)),
            &"2".repeat(64),
            &"3".repeat(64),
        )
        .unwrap()
    }
    fn request(binding: &Binding, operation: &str) -> Vec<u8> {
        serde_json::to_vec(&wire::activate_request(binding, operation, 0).unwrap()).unwrap()
    }
    fn staged(dir: &Path, name: &str, bytes: &[u8]) {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(dir.join(name))
            .unwrap();
        file.write_all(bytes).unwrap();
    }
    fn opened(dir: &Path, bytes: Vec<u8>) {
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(dir.join(FILE))
            .unwrap();
        file.write_all(&bytes).unwrap();
    }
    #[test]
    fn journal_round_trips_and_refuses_tampering() {
        let dir = scratch();
        let binding = binding();
        let mut journal = JournalFile::open(&dir, &KEY, &binding).unwrap();
        let req = request(&binding, &"4".repeat(64));
        push(
            &mut journal.payload,
            OpRecord {
                key: "activate".into(),
                operation_id: "4".repeat(64),
                request: STANDARD.encode(&req),
                terminal: None,
            },
        )
        .unwrap();
        journal.persist().unwrap();
        drop(journal);
        let reopened = JournalFile::open(&dir, &KEY, &binding).unwrap();
        assert_eq!(reopened.payload.ops.len(), 1);
        assert_eq!(reopened.payload.ops[0].operation_id, "4".repeat(64));
        drop(reopened);
        // Bit flip in the stored body fails the MAC; nothing is rewritten.
        let mut bytes = fs::read(dir.join(FILE)).unwrap();
        let at = bytes.len() - 40;
        bytes[at] ^= 1;
        opened(&dir, bytes);
        assert!(JournalFile::open(&dir, &KEY, &binding).is_err());
        assert!(JournalFile::open(
            &dir,
            &KEY,
            &Binding::new(
                &format!("acct_{}", "9".repeat(32)),
                &"2".repeat(64),
                &"3".repeat(64)
            )
            .unwrap()
        )
        .is_err());
        // A different key cannot authenticate the journal either.
        let foreign = [0x55; 32];
        assert!(JournalFile::open(&dir, &foreign, &binding).is_err());
        fs::remove_dir_all(&dir).ok();
    }
    #[test]
    fn valid_staged_write_survives_a_crash_before_rename() {
        let dir = scratch();
        let binding = binding();
        let mut journal = JournalFile::open(&dir, &KEY, &binding).unwrap();
        journal.payload.ops.push(OpRecord {
            key: "migrate".into(),
            operation_id: "5".repeat(64),
            request: STANDARD.encode(b"{}"),
            terminal: None,
        });
        journal.persist().unwrap();
        drop(journal);
        // Move the durable file back to pending: the crash window between the
        // fsynced stage and the rename. The staged bytes remain authoritative.
        fs::rename(dir.join(FILE), dir.join(PENDING)).unwrap();
        let reopened = JournalFile::open(&dir, &KEY, &binding).unwrap();
        assert_eq!(reopened.payload.ops[0].key, "migrate");
        fs::remove_dir_all(&dir).ok();
    }
    #[test]
    fn corrupt_stage_and_stray_files_refuse_without_deletion() {
        let dir = scratch();
        let binding = binding();
        staged(&dir, PENDING, b"not-json");
        assert!(JournalFile::open(&dir, &KEY, &binding).is_err());
        fs::remove_file(dir.join(PENDING)).unwrap();
        staged(&dir, FILE, b"not-json");
        assert!(JournalFile::open(&dir, &KEY, &binding).is_err());
        assert!(dir.join(FILE).exists());
        fs::remove_dir_all(&dir).ok();
    }
    #[test]
    fn refused_and_ambiguous_grants_never_own_the_population() {
        let dir = scratch();
        let binding = binding();
        let mut journal = JournalFile::open(&dir, &KEY, &binding).unwrap();
        let grant = |pop: &str, terminal: Option<&str>| OpRecord {
            key: format!("grant:{pop}"),
            operation_id: "6".repeat(64),
            request: STANDARD.encode(b"{}"),
            terminal: terminal.map(|t| {
                STANDARD.encode(serde_json::to_vec(&serde_json::json!({"refused": t})).unwrap())
            }),
        };
        journal
            .payload
            .ops
            .push(grant(&"a".repeat(64), Some("contribution_sync_conflict")));
        assert_eq!(retained_population(&journal.payload), None);
        journal.payload.ops.push(OpRecord {
            key: format!("grant:{}", "b".repeat(64)),
            operation_id: "7".repeat(64),
            request: STANDARD.encode(b"{}"),
            terminal: Some(
                STANDARD.encode(serde_json::to_vec(&serde_json::json!({"granted": true})).unwrap()),
            ),
        });
        assert_eq!(retained_population(&journal.payload), Some("b".repeat(64)));
        journal.payload.ops.push(OpRecord {
            key: format!("grant:{}", "c".repeat(64)),
            operation_id: "8".repeat(64),
            request: STANDARD.encode(b"{}"),
            terminal: Some(
                STANDARD.encode(serde_json::to_vec(&serde_json::json!({"granted": true})).unwrap()),
            ),
        });
        assert_eq!(retained_population(&journal.payload), None);
        fs::remove_dir_all(&dir).ok();
    }
}
