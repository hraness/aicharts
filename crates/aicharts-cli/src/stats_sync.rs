//! Numeric snapshots use the existing custody enrollment. Local flight bytes are
//! authenticated and durable before network I/O; uncertainty never rescans or
//! silently replaces that intent. Legacy ownership transfers only through the
//! service's pinned-predecessor, per-day numeric-preservation guard.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]
use crate::stats::{self, Report};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
#[cfg(target_os = "macos")]
mod disk;
#[cfg(target_os = "macos")]
mod https;
const MAX_BYTES: usize = 4 * 1024 * 1024;
/// Shared admitted legacy population, not a response-body allocation bound.
pub(crate) const MAX_LEGACY_RECORDS: u64 = 1_000_000;
const SAFE: u64 = 9_007_199_254_740_991;
const HELP: &str = "AI Charts stats sync — explicit enrolled numeric publication\n\n  aicharts stats-sync --state-dir DIR --key-file KEY --home DIR --client ID [--since YYYY-MM-DD --until YYYY-MM-DD] [--source-root DIR ...]\n  aicharts stats-sync --state-dir DIR --key-file KEY --resume\n  aicharts stats-sync --state-dir DIR --key-file KEY --abandon\n  aicharts stats-sync --dry-run --home DIR --client ID [--since YYYY-MM-DD --until YYYY-MM-DD] [--source-root DIR ...]\n\nSends one client's nonempty numeric snapshot to the fixed AI Charts service.\nRequires an existing custody-verified macOS enrollment and its local state key.\nEach client belongs to one installation. Incomplete, warning-bearing, empty,\nor missing-source scans refuse; no automatic clearing is available. A legacy\nownership transfer pins its exact predecessor and must pass the service's\nper-day reported-token and record-preservation guard. Provider exports must already exist locally. No provider credentials\nare read or refreshed by this command. Ordinary sync retains absent days and\nrefuses declining counters or lost known coverage. Explicit reconciliation is\nrequired; no replacement override is available. Warp publishes one latest\nbilling-counter snapshot and replaces its prior derived snapshot, so repeated\nrefreshes cannot add the same monthly spend. Immutable history is retained.\nCosts and unknown coverage remain separate from reported tokens.\n\nA frozen request is durably retained before sending. An uncertain result requires\n--resume, which retries those exact bytes without reading source files.\nFor a refused request that needs a fresh scan, --abandon obtains an authenticated\nserver fence before clearing only that pending flight. If already committed, it\nsettles the matching receipt instead. Uncertain abandonment keeps the flight.\nPublished data and immutable recovery evidence remain retained. Never remove\ncheckpoint files to recover: reconcile identity, generation or a revoked\nwriter through the service. --dry-run reads local sources and prints the report;\nit does not enroll, create state or send.\n";
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Upload {
    schema_version: u8,
    operation_id: String,
    account_id: String,
    device_id: String,
    generation: String,
    sequence: u64,
    expected_revision: u64,
    mode: String,
    takeover: Option<Takeover>,
    report: Report,
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Takeover {
    expected_v1_revision: u64,
    head_digest: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AbandonRequest<'a> {
    schema_version: u8,
    operation_id: &'a str,
    account_id: &'a str,
    device_id: &'a str,
    generation: &'a str,
    sequence: u64,
    expected_revision: u64,
    body_hash: String,
}
#[derive(Clone, Deserialize, Debug, PartialEq)]
#[serde(
    tag = "outcome",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Abandonment {
    Committed {
        schema_version: u8,
        receipt: Receipt,
    },
    Abandoned {
        schema_version: u8,
        operation_id: String,
        body_hash: String,
        sequence: u64,
        expected_revision: u64,
        fenced_at_revision: u64,
    },
}
impl Abandonment {
    fn validate(&self, request: &Upload, now: u64) -> Result<Option<Receipt>, &'static str> {
        match self {
            Self::Committed {
                schema_version: 2,
                receipt,
            } => {
                receipt.matches(request, now)?;
                Ok(Some(receipt.clone()))
            }
            Self::Abandoned {
                schema_version: 2,
                operation_id,
                body_hash: hash,
                sequence,
                expected_revision,
                fenced_at_revision,
            } if operation_id == &request.operation_id
                && hash == &body_hash(request)?
                && *sequence == request.sequence
                && *expected_revision == request.expected_revision
                && *fenced_at_revision > *expected_revision
                && *fenced_at_revision <= 1_000_000 =>
            {
                Ok(None)
            }
            _ => Err("stats_sync_invalid_abandonment_proof"),
        }
    }
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    schema_version: u8,
    operation_id: String,
    body_hash: String,
    sequence: u64,
    revision: u64,
    committed_at_ms: u64,
    client: String,
    first_utc_day: u64,
    day_count: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusRequest<'a> {
    schema_version: u8,
    account_id: &'a str,
    device_id: &'a str,
    generation: &'a str,
    client: &'a str,
    first_utc_day: u64,
    day_count: u64,
}
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Status {
    schema_version: u8,
    revision: u64,
    next_sequence: u64,
    writer_device_id: Option<String>,
    v1_revision: u64,
    head_digest: String,
    legacy_records: u64,
    takeover_eligible: bool,
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Checkpoint {
    schema_version: u8,
    account_id: String,
    device_id: String,
    generation: String,
    last_sequence: u64,
    last_revision: u64,
    flight: Option<Upload>,
    receipt: Option<Receipt>,
}
fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(output, "{byte:02x}");
    }
    output
}
fn is_hex(value: &str, width: usize) -> bool {
    value.len() == width
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn identity(value: &str) -> bool {
    is_hex(value, 64) && value.bytes().any(|b| b != b'0')
}
fn account(value: &str) -> bool {
    value.strip_prefix("acct_").is_some_and(|v| is_hex(v, 32))
}
fn encoded<T: Serialize>(value: &T) -> Result<Vec<u8>, &'static str> {
    let bytes = serde_json::to_vec(value).map_err(|_| "stats_sync_state_invalid")?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("stats_sync_limit");
    }
    Ok(bytes)
}
fn body_hash(value: &Upload) -> Result<String, &'static str> {
    Ok(hex(&Sha256::digest(encoded(value)?)))
}
fn eligible(report: &Report) -> Result<(), &'static str> {
    stats::validate_report(report)?;
    if report.revision == 0
        && report.updated_at_ms.is_none()
        && report.sources.len() == 1
        && report.sources[0].client != "9router"
        && report.sources[0].status == "empty"
        && report.sources[0].warnings == 0
        && report.sources[0].records == 0
        && report.rows.is_empty()
    {
        return Err("stats_sync_no_observations");
    }
    if report.revision != 0
        || report.updated_at_ms.is_some()
        || report.sources.len() != 1
        || report.rows.is_empty()
        || report.rows.len() > 8192
        || report.sources[0].status != "observed"
        || report.sources[0].client == "9router"
        || report.sources[0].warnings != 0
        || report.sources[0].records == 0
    {
        return Err("stats_sync_incomplete_source");
    }
    if report.sources[0].client == "warp"
        && (report.day_count != 1
            || report.sources[0]
                .latest_at_ms
                .is_none_or(|time| time / 86_400_000 != report.first_utc_day)
            || report
                .rows
                .iter()
                .any(|row| row.token_basis != "unavailable"))
    {
        return Err("stats_sync_snapshot_invalid");
    }
    Ok(())
}
fn publication_report(mut report: Report) -> Result<Report, &'static str> {
    if report.sources.len() == 1 && report.sources[0].client == "warp" && !report.rows.is_empty() {
        let day = report
            .rows
            .first()
            .ok_or("stats_sync_incomplete_source")?
            .utc_day;
        if report.rows.iter().any(|row| row.utc_day != day) {
            return Err("stats_sync_snapshot_invalid");
        }
        report.first_utc_day = day;
        report.day_count = 1;
    }
    eligible(&report)?;
    Ok(report)
}
/// Read-only admission check with conservative wire-size headroom for every
/// identity/progress field, including a possible guarded legacy takeover.
/// It never opens enrollment state or contacts the service.
pub(super) fn validate_publication(report: Report) -> Result<(), &'static str> {
    let report = publication_report(report)?;
    let mode = if report.sources[0].client == "warp" {
        "replace-snapshot"
    } else {
        "preserve-history"
    };
    Upload {
        schema_version: 2,
        operation_id: "1".repeat(64),
        account_id: format!("acct_{}", "1".repeat(32)),
        device_id: "1".repeat(64),
        generation: "1".repeat(64),
        sequence: SAFE,
        expected_revision: SAFE - 1,
        mode: mode.into(),
        takeover: Some(Takeover {
            expected_v1_revision: 4096,
            head_digest: "1".repeat(64),
        }),
        report,
    }
    .validate()
}
impl Upload {
    fn validate(&self) -> Result<(), &'static str> {
        if self.schema_version != 2
            || !identity(&self.operation_id)
            || !account(&self.account_id)
            || !identity(&self.device_id)
            || !identity(&self.generation)
            || !(1..=SAFE).contains(&self.sequence)
            || self.expected_revision >= SAFE
            || self.mode
                != if self
                    .report
                    .sources
                    .first()
                    .is_some_and(|s| s.client == "warp")
                {
                    "replace-snapshot"
                } else {
                    "preserve-history"
                }
            || self.takeover.as_ref().is_some_and(|value| {
                value.expected_v1_revision > 4096 || !is_hex(&value.head_digest, 64)
            })
        {
            return Err("stats_sync_state_invalid");
        }
        eligible(&self.report)?;
        encoded(self)?;
        Ok(())
    }
}
impl Receipt {
    fn matches(&self, request: &Upload, now: u64) -> Result<(), &'static str> {
        if self.schema_version != 2
            || self.operation_id != request.operation_id
            || self.body_hash != body_hash(request)?
            || self.sequence != request.sequence
            || self.revision != request.expected_revision + 1
            || self.committed_at_ms < request.report.generated_at_ms
            || self.committed_at_ms > now
            || self.client != request.report.sources[0].client
            || self.first_utc_day != request.report.first_utc_day
            || self.day_count != request.report.day_count
        {
            return Err("stats_sync_invalid_response");
        }
        Ok(())
    }
}
impl Status {
    fn validate(&self, device: &str) -> Result<(), &'static str> {
        if self.schema_version != 2
            || self.revision > SAFE
            || !(1..=SAFE).contains(&self.next_sequence)
            || self
                .writer_device_id
                .as_ref()
                .is_some_and(|id| !identity(id))
            || self.v1_revision > 4096
            || !is_hex(&self.head_digest, 64)
            || self.legacy_records > MAX_LEGACY_RECORDS
        {
            return Err("stats_sync_invalid_response");
        }
        if self
            .writer_device_id
            .as_ref()
            .is_some_and(|id| id != device)
        {
            return Err("stats_sync_writer_conflict");
        }
        if !self.takeover_eligible {
            return Err("stats_sync_legacy_takeover_required");
        }
        Ok(())
    }
    fn takeover(&self, device: &str) -> Result<Option<Takeover>, &'static str> {
        self.validate(device)?;
        Ok((self.legacy_records > 0).then(|| Takeover {
            expected_v1_revision: self.v1_revision,
            head_digest: self.head_digest.clone(),
        }))
    }
}
impl Checkpoint {
    fn validate(&self) -> Result<(), &'static str> {
        if self.schema_version != 1
            || !account(&self.account_id)
            || !identity(&self.device_id)
            || !identity(&self.generation)
            || self.last_sequence > SAFE
            || self.last_revision > SAFE
            || (self.last_sequence == 0) != self.receipt.is_none()
        {
            return Err("stats_sync_state_invalid");
        }
        if let Some(receipt) = &self.receipt {
            if receipt.schema_version != 2
                || receipt.sequence != self.last_sequence
                || receipt.revision != self.last_revision
                || receipt.revision == 0
                || receipt.revision < receipt.sequence
                || !identity(&receipt.operation_id)
                || !is_hex(&receipt.body_hash, 64)
                || receipt.committed_at_ms > 8_640_000_000_000_000
                || !aicharts_import::clients().contains(&receipt.client.as_str())
                || receipt.first_utc_day > 99_999_999
                || !(1..=366).contains(&receipt.day_count)
                || receipt.first_utc_day + receipt.day_count - 1 > 99_999_999
            {
                return Err("stats_sync_state_invalid");
            }
        }
        if let Some(flight) = &self.flight {
            flight.validate()?;
            if flight.account_id != self.account_id
                || flight.device_id != self.device_id
                || flight.generation != self.generation
                || flight.sequence != self.last_sequence + 1
                || flight.expected_revision < self.last_revision
            {
                return Err("stats_sync_state_invalid");
            }
        }
        Ok(())
    }
}
struct Options {
    directory: Option<PathBuf>,
    key: Option<PathBuf>,
    resume: bool,
    abandon: bool,
    dry_run: bool,
    collection: Option<stats::Options>,
}
fn options(args: &[String], now: u64) -> Result<Options, &'static str> {
    let (mut directory, mut key, mut resume, mut abandon, mut dry_run) =
        (None, None, false, false, false);
    let mut collect = Vec::new();
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--resume" if !resume => resume = true,
            "--abandon" if !abandon => abandon = true,
            "--dry-run" if !dry_run => dry_run = true,
            "--state-dir" | "--key-file" => {
                let flag = &args[index];
                index += 1;
                let value = args
                    .get(index)
                    .filter(|value| !value.is_empty() && !value.starts_with("--"))
                    .ok_or("missing_option_value")?;
                let slot = if flag == "--state-dir" {
                    &mut directory
                } else {
                    &mut key
                };
                if slot.is_some() {
                    return Err("invalid_option");
                }
                *slot = Some(PathBuf::from(value));
            }
            "--home" | "--client" | "--since" | "--until" | "--source-root" => {
                collect.push(args[index].clone());
                index += 1;
                collect.push(args.get(index).ok_or("missing_option_value")?.clone());
            }
            _ => return Err("invalid_option"),
        }
        index += 1;
    }
    if ((resume || abandon) && (dry_run || !collect.is_empty()))
        || (resume && abandon)
        || (dry_run && (directory.is_some() || key.is_some()))
    {
        return Err("invalid_option");
    }
    if !dry_run && (directory.is_none() || key.is_none()) {
        return Err("explicit_key_and_source_required");
    }
    let collection = if resume || abandon {
        None
    } else {
        let options = stats::options(&collect, now)?;
        if options.clients.len() != 1 {
            return Err("stats_sync_one_client_required");
        }
        Some(options)
    };
    Ok(Options {
        directory,
        key,
        resume,
        abandon,
        dry_run,
        collection,
    })
}
fn dry_run_report(report: Report) -> Result<String, &'static str> {
    validate_publication(report.clone())?;
    serde_json::to_string(&report).map_err(|_| "stats_json_invalid")
}
pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    if args.len() == 2 && args[1] == "--help" {
        return Ok(HELP.to_owned());
    }
    let now = stats::now_ms()?;
    let options = options(args, now)?;
    if options.dry_run {
        let report = stats::collect(options.collection.as_ref().ok_or("invalid_option")?, now)?;
        return dry_run_report(report);
    }
    #[cfg(target_os = "macos")]
    {
        send(options, now)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = options;
        Err("stats_sync_requires_qualified_macos_custody")
    }
}
#[cfg(target_os = "macos")]
fn send(options: Options, now: u64) -> Result<String, &'static str> {
    let directory = options
        .directory
        .as_ref()
        .ok_or("state_directory_required")?;
    let enrolled = crate::enrollment::enrolled(directory)?;
    let key = crate::read_key(options.key.as_ref().ok_or("key_required")?)?;
    let account = format!("acct_{}", hex(&enrolled.account_id));
    let device = hex(&enrolled.device_id);
    let generation = hex(&enrolled.recovery_generation);
    let mut disk = disk::Disk::open(directory, &key)?;
    let mut checkpoint = disk.read()?.unwrap_or(Checkpoint {
        schema_version: 1,
        account_id: account.clone(),
        device_id: device.clone(),
        generation: generation.clone(),
        last_sequence: 0,
        last_revision: 0,
        flight: None,
        receipt: None,
    });
    checkpoint.validate()?;
    if checkpoint.account_id != account
        || checkpoint.device_id != device
        || checkpoint.generation != generation
    {
        return Err("stats_sync_identity_changed");
    }
    let mut transport = enrolled
        .pairing
        .with_pairing_secrets(|_, secret| https::Transport::new(secret))
        .map_err(|_| "attempt_custody")??;
    if options.abandon {
        let receipt = abandon_retained(
            &mut checkpoint,
            &mut disk,
            |flight| transport.abandon(flight),
            stats::now_ms,
        )?;
        return Ok(if let Some(receipt) = receipt {
            format!(
                "{{\"schemaVersion\":2,\"status\":\"published\",\"revision\":{}}}",
                receipt.revision
            )
        } else {
            "{\"schemaVersion\":2,\"status\":\"abandoned\"}".to_owned()
        });
    }
    if options.resume {
        if checkpoint.flight.is_none() {
            return Err("stats_sync_no_retained_flight");
        }
    } else {
        if checkpoint.flight.is_some() {
            return Err("stats_sync_resume_required");
        }
        let report = publication_report(stats::collect(
            options.collection.as_ref().ok_or("invalid_option")?,
            now,
        )?)?;
        let status = transport.status(&StatusRequest {
            schema_version: 2,
            account_id: &account,
            device_id: &device,
            generation: &generation,
            client: &report.sources[0].client,
            first_utc_day: report.first_utc_day,
            day_count: report.day_count,
        })?;
        let takeover = status.takeover(&device)?;
        if status.next_sequence != checkpoint.last_sequence + 1
            || status.revision < checkpoint.last_revision
        {
            return Err("stats_sync_remote_progress_changed");
        }
        let mut id = [0u8; 32];
        getrandom::fill(&mut id).map_err(|_| "stats_sync_random_unavailable")?;
        let upload = Upload {
            schema_version: 2,
            operation_id: hex(&id),
            account_id: account,
            device_id: device,
            generation,
            sequence: status.next_sequence,
            expected_revision: status.revision,
            mode: if report.sources[0].client == "warp" {
                "replace-snapshot"
            } else {
                "preserve-history"
            }
            .to_owned(),
            takeover,
            report,
        };
        upload.validate()?;
        checkpoint.flight = Some(upload);
        disk.write(&checkpoint)?;
    }
    let receipt = exchange_retained(
        &mut checkpoint,
        &mut disk,
        |flight| transport.upload(flight),
        stats::now_ms,
    )?;
    Ok(format!("{{\"schemaVersion\":2,\"status\":\"published\",\"client\":{},\"revision\":{},\"firstUtcDay\":{},\"dayCount\":{}}}",
        serde_json::to_string(&receipt.client).map_err(|_| "stats_json_invalid")?, receipt.revision, receipt.first_utc_day, receipt.day_count))
}
#[cfg(target_os = "macos")]
fn exchange_retained(
    checkpoint: &mut Checkpoint,
    disk: &mut disk::Disk,
    exchange: impl FnOnce(&Upload) -> Result<Receipt, &'static str>,
    now: impl FnOnce() -> Result<u64, &'static str>,
) -> Result<Receipt, &'static str> {
    checkpoint.validate()?;
    disk.revalidate()?;
    let flight = checkpoint
        .flight
        .as_ref()
        .ok_or("stats_sync_state_invalid")?;
    let receipt = exchange(flight)?;
    receipt.matches(flight, now()?)?;
    disk.revalidate()?;
    let mut settled = checkpoint.clone();
    settled.last_sequence = receipt.sequence;
    settled.last_revision = receipt.revision;
    settled.receipt = Some(receipt.clone());
    settled.flight = None;
    disk.write(&settled)?;
    *checkpoint = settled;
    Ok(receipt)
}
#[cfg(target_os = "macos")]
fn abandon_retained(
    checkpoint: &mut Checkpoint,
    disk: &mut disk::Disk,
    exchange: impl FnOnce(&Upload) -> Result<Abandonment, &'static str>,
    now: impl FnOnce() -> Result<u64, &'static str>,
) -> Result<Option<Receipt>, &'static str> {
    checkpoint.validate()?;
    disk.revalidate()?;
    let flight = checkpoint
        .flight
        .as_ref()
        .ok_or("stats_sync_no_retained_flight")?;
    let proof = exchange(flight)?;
    let receipt = proof.validate(flight, now()?)?;
    disk.revalidate()?;
    let mut settled = checkpoint.clone();
    if let Some(receipt) = &receipt {
        settled.last_sequence = receipt.sequence;
        settled.last_revision = receipt.revision;
        settled.receipt = Some(receipt.clone());
    }
    settled.flight = None;
    disk.write(&settled)?;
    *checkpoint = settled;
    Ok(receipt)
}
#[cfg(test)]
mod tests;
