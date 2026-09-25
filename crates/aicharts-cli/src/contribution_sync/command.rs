//! Explicit enrolled command only. No daemon/default sync or activation join.
use std::path::{Path, PathBuf};

const HELP: &str = "AI Charts contribution sync: explicit V3 publication\n\n  aicharts contribution-sync --status --state-dir DIR --key-file KEY [--population-id HEX]\n  aicharts contribution-sync --migrate --state-dir DIR --key-file KEY\n  aicharts contribution-sync --activate --state-dir DIR --key-file KEY\n  aicharts contribution-sync --grant --state-dir DIR --key-file KEY [--population-id HEX]\n  aicharts contribution-sync --inspect --state-dir DIR --key-file KEY\n  aicharts contribution-sync --initialize --state-dir DIR --key-file KEY [--population-id HEX]\n  aicharts contribution-sync --send --state-dir DIR --key-file KEY [--population-id HEX] (--claude FILE | --codex FILE) [--max-batches N]\n  aicharts contribution-sync --resume --state-dir DIR --key-file KEY\n  aicharts contribution-sync --cancel --state-dir DIR --key-file KEY\n\nRequires existing macOS enrollment. V3 account setup is explicit and opt-in:\n--migrate carries retained V1/V2 history into V3; --activate covers accounts\nwith no retained history; --grant claims a population (default: this device's\nderived primary). Control intents persist exact request bytes before dispatch,\nso a retry always replays the identical idempotent operation and settles from\nthe retained terminal. This command never deletes account data or the journal.\nOnly one explicit Claude or Codex file is accepted, up to 64 MiB and 8,192\nobservations. Coverage remains partial; corrections, deletion and incomplete\nsource warnings require reconciliation. Codex observations whose identity is a\nsame-timestamp slot, or from a regressed or forked history, are quarantined and\nnever sent. A call checks at most 32 pages per batch and sends one batch unless\n--max-batches N (1-8) drains further pending batches, each re-checking the\nserver position. Run --send again for additional bounded batches. Account-wide activation remains\nunsuitable while aggregate-only clients need their existing publication path.\n\nExact bytes are retained before sending. --resume retries the persisted action\nwithout reading source files. --cancel persists a one-way cancellation decision\nand fresh server revision before dispatch; it can refresh a refused cancellation.\nUnknown status never clears a flight. Terminal replies are authenticated and\ncorrelated before retirement. Never delete checkpoint files to recover or restore\nan older valid directory as a reset; independent custody/device fencing is needed\nfor backup rollback recovery. No automatic retries or live activation occur.\n\n--inspect is local-only: it reports the MAC-checked local checkpoint, not current\nenrollment or remote authority. It creates nothing and performs no sync, repair,\nsource reading or network request. Paths must be absolute.\n";
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Command {
    Inspect,
    Initialize,
    Send,
    Resume,
    Cancel,
    Status,
    Activate,
    Migrate,
    Grant,
    Onboard,
}
struct Options {
    command: Command,
    directory: PathBuf,
    key: PathBuf,
    population: Option<String>,
    source: Option<(aicharts_protocol::Provider, PathBuf)>,
    max_batches: u8,
}
pub(super) const MAX_BATCHES: u8 = 8;
fn path(value: &str) -> Result<PathBuf, &'static str> {
    if value.len() < 2
        || value.len() > 1023
        || value.as_bytes().contains(&0)
        || !Path::new(value).is_absolute()
    {
        return Err("invalid_option");
    }
    let mut count = 0;
    for name in value.as_bytes()[1..].split(|byte| *byte == b'/') {
        count += 1;
        if count > 64 || name.is_empty() || name.len() > 255 || name == b"." || name == b".." {
            return Err("invalid_option");
        }
    }
    Ok(value.into())
}
fn options(args: &[String]) -> Result<Options, &'static str> {
    if args.first().map(String::as_str) != Some("contribution-sync") || args.len() > 12 {
        return Err("invalid_option");
    }
    let (mut command, mut directory, mut key, mut population, mut source, mut max_batches) =
        (None, None, None, None, None, None);
    let mut index = 1;
    while index < args.len() {
        let action = match args[index].as_str() {
            "--inspect" => Some(Command::Inspect),
            "--initialize" => Some(Command::Initialize),
            "--send" => Some(Command::Send),
            "--resume" => Some(Command::Resume),
            "--cancel" => Some(Command::Cancel),
            "--status" => Some(Command::Status),
            "--onboard" => Some(Command::Onboard),
            "--activate" => Some(Command::Activate),
            "--migrate" => Some(Command::Migrate),
            "--grant" => Some(Command::Grant),
            _ => None,
        };
        if let Some(action) = action {
            if command.replace(action).is_some() {
                return Err("invalid_option");
            }
            index += 1;
            continue;
        }
        let value = args.get(index + 1).ok_or("invalid_option")?;
        match args[index].as_str() {
            "--state-dir" if directory.is_none() => directory = Some(path(value)?),
            "--key-file" if key.is_none() => key = Some(path(value)?),
            "--population-id" if population.is_none() && super::wire::identity(value, 64) => {
                population = Some(value.clone())
            }
            "--claude" if source.is_none() => {
                source = Some((aicharts_protocol::Provider::ClaudeCode, path(value)?))
            }
            "--codex" if source.is_none() => {
                source = Some((aicharts_protocol::Provider::Codex, path(value)?))
            }
            "--max-batches" if max_batches.is_none() => {
                let count: u8 = value.parse().map_err(|_| "invalid_option")?;
                if !(1..=MAX_BATCHES).contains(&count) || *value != count.to_string() {
                    return Err("invalid_option");
                }
                max_batches = Some(count);
            }
            _ => return Err("invalid_option"),
        }
        index += 2;
    }
    let command = command.ok_or("invalid_option")?;
    if (command == Command::Send) != source.is_some()
        || (max_batches.is_some() && command != Command::Send)
        || matches!(
            command,
            Command::Activate
                | Command::Migrate
                | Command::Resume
                | Command::Cancel
                | Command::Inspect
        ) && (population.is_some() || source.is_some())
        || matches!(command, Command::Onboard) && source.is_some()
    {
        return Err("invalid_option");
    }
    Ok(Options {
        command,
        directory: directory.ok_or("state_directory_required")?,
        key: key.ok_or("key_required")?,
        population,
        source,
        max_batches: max_batches.unwrap_or(1),
    })
}
pub(super) fn run(args: &[String]) -> Result<String, &'static str> {
    if args == ["contribution-sync", "--help"] {
        return Ok(HELP.into());
    }
    let options = options(args)?;
    #[cfg(target_os = "macos")]
    {
        run_macos(options)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = options;
        Err("contribution_sync_requires_qualified_macos_custody")
    }
}

#[cfg(target_os = "macos")]
fn retained_terminal(
    checkpoint: &super::Checkpoint,
) -> Result<Option<serde_json::Value>, &'static str> {
    checkpoint.terminal.as_ref().map(|retained| {
        let batch = retained.flight.body.reopen()?;
        let terminal = retained.proof.terminal(&batch)?;
        let outcome = match terminal.outcome() {
            aicharts_core::contribution_producer::TerminalOutcome::Committed => "committed",
            aicharts_core::contribution_producer::TerminalOutcome::Abandoned => "abandoned",
        };
        Ok(serde_json::json!({ "outcome": outcome, "terminalRevision": terminal.revision(),
            "sequence": batch.sequence(), "operationId": batch.operation_id(), "bodyHash": batch.body_hash(),
            "populationId": batch.scope().population_id() }))
    }).transpose()
}
#[cfg(target_os = "macos")]
fn local_inspect(directory: &Path, key: &[u8; 32]) -> Result<String, &'static str> {
    let ops = super::ops::local_ops(directory, key)?;
    let checkpoint = match super::disk::Disk::reader(directory, key)?.inspect_local()? {
        Some(checkpoint) => checkpoint,
        None => {
            return ops
                .map(|ops| {
                    serde_json::to_string(&serde_json::json!({ "schemaVersion": 1,
                    "scope": "local-ops", "remoteState": "not_observed", "ops": ops["ops"] }))
                    .map_err(|_| super::INVALID)
                })
                .unwrap_or(Err("contribution_sync_checkpoint_missing"))
        }
    };
    let flight = checkpoint.flight.as_ref().map(|flight| {
        let batch = flight.body.reopen()?;
        let (action, cancellation_revision) = match flight.action {
            super::Action::Upload => ("upload", None), super::Action::Cancel { expected_revision } => ("cancel", Some(expected_revision)),
        };
        Ok::<_, &'static str>(serde_json::json!({ "action": action, "sequence": batch.sequence(), "operationId": batch.operation_id(),
            "bodyHash": batch.body_hash(), "populationId": batch.scope().population_id(), "writerRevision": batch.scope().writer_revision(),
            "cancellationRevision": cancellation_revision }))
    }).transpose()?;
    serde_json::to_string(&serde_json::json!({ "schemaVersion": 1, "scope": "local-checkpoint", "remoteState": "not_observed",
        "binding": checkpoint.binding, "lastSequence": checkpoint.last_sequence, "durableRevisionFloor": checkpoint.last_revision,
        "terminal": retained_terminal(&checkpoint)?, "flight": flight, "ops": ops }))
        .map_err(|_| super::INVALID)
}
#[cfg(target_os = "macos")]
fn read_source(
    transport: &super::https::Transport,
    provider: aicharts_protocol::Provider,
    path: &Path,
) -> Result<aicharts_core::contribution_producer::NativeObservations, &'static str> {
    use std::{io::BufReader, os::unix::fs::MetadataExt};
    let mut file = crate::open_regular(path).map_err(|_| "contribution_sync_source_unavailable")?;
    let before = file
        .metadata()
        .map_err(|_| "contribution_sync_source_unavailable")?;
    if before.len() > aicharts_core::contribution_producer::MAX_SOURCE_BYTES {
        return Err("source_byte_limit");
    }
    let observations = transport.read_native(provider, BufReader::new(&mut file))?;
    let after = file
        .metadata()
        .map_err(|_| "contribution_sync_source_unavailable")?;
    let named = std::fs::symlink_metadata(path).map_err(|_| "contribution_sync_source_changed")?;
    let same = |left: &std::fs::Metadata, right: &std::fs::Metadata| {
        left.is_file()
            && right.is_file()
            && left.dev() == right.dev()
            && left.ino() == right.ino()
            && left.len() == right.len()
            && left.mtime() == right.mtime()
            && left.mtime_nsec() == right.mtime_nsec()
            && left.ctime() == right.ctime()
            && left.ctime_nsec() == right.ctime_nsec()
    };
    if !same(&before, &after) || !same(&after, &named) {
        return Err("contribution_sync_source_changed");
    }
    if !observations.warnings().is_empty() {
        return Err("contribution_sync_source_warnings");
    }
    if observations.is_empty() {
        return Err("contribution_sync_no_observations");
    }
    Ok(observations)
}
#[cfg(target_os = "macos")]
fn settlement(
    outbox: &mut super::Outbox,
    binding: &super::Binding,
    terminal: super::AuthenticatedTerminal,
) -> Result<String, &'static str> {
    outbox.settle(binding, &terminal)?;
    let retained = retained_terminal(&outbox.checkpoint)?.ok_or(super::INVALID)?;
    serde_json::to_string(&serde_json::json!({ "schemaVersion": 3, "status": "settled",
        "sequence": outbox.checkpoint.last_sequence, "outcome": retained["outcome"],
        "terminalRevision": retained["terminalRevision"], "durableRevisionFloor": outbox.checkpoint.last_revision }))
        .map_err(|_| super::INVALID)
}
#[cfg(target_os = "macos")]
pub(super) fn recover_action(
    outbox: &mut super::Outbox,
    transport: &super::https::Transport,
    deadline: &super::https::Deadline,
    cancel: bool,
) -> Result<String, &'static str> {
    let binding = transport.binding();
    outbox.current(binding)?;
    if !cancel && outbox.checkpoint.flight.is_none() {
        return serde_json::to_string(&serde_json::json!({ "schemaVersion": 3, "status": "no_pending_flight", "remoteState": "not_observed",
            "lastSequence": outbox.checkpoint.last_sequence, "durableRevisionFloor": outbox.checkpoint.last_revision,
            "terminal": retained_terminal(&outbox.checkpoint)? })).map_err(|_| super::INVALID);
    }
    let batch = outbox
        .checkpoint
        .flight
        .as_ref()
        .ok_or("contribution_sync_no_retained_flight")?
        .body
        .reopen()?;
    if cancel {
        // A failed or lost status reply must never leave a requested cancellation
        // resumable as an upload. Fresh status still owns dispatch authority.
        outbox.request_cancel(binding)?;
    }
    let status = transport.status(batch.scope().population_id(), Some(&batch), deadline)?;
    // Exact immutable terminal evidence is independent of present population
    // ownership. No current-writer capability is needed to retire that same body.
    if let Some(terminal) = status.terminal {
        return settlement(outbox, binding, terminal);
    }
    let progress = status.progress.ok_or("contribution_sync_writer_conflict")?;
    if cancel {
        outbox.cancel(binding, &progress)?;
    }
    let terminal = {
        let flight = outbox.flight(binding, &progress)?;
        transport.dispatch(&flight, deadline)?
    };
    settlement(outbox, binding, terminal)
}
#[cfg(target_os = "macos")]
pub(super) fn send(
    outbox: &mut super::Outbox,
    transport: &super::https::Transport,
    deadline: &super::https::Deadline,
    population: &str,
    observations: &aicharts_core::contribution_producer::NativeObservations,
) -> Result<String, &'static str> {
    let binding = transport.binding();
    outbox.current(binding)?;
    if outbox.checkpoint.flight.is_some() {
        return Err("contribution_sync_resume_required");
    }
    let progress = transport
        .status(population, None, deadline)?
        .progress
        .ok_or("contribution_sync_writer_conflict")?;
    progress.checked(binding)?;
    if progress.next_sequence != outbox.checkpoint.last_sequence + 1
        || progress.revision < outbox.checkpoint.last_revision
    {
        return Err(super::CONFLICT);
    }
    let scope = progress.scope.reopen()?;
    let mut operation = [0u8; 32];
    getrandom::fill(&mut operation).map_err(|_| "contribution_sync_random_unavailable")?;
    let operation: String = operation.iter().map(|byte| format!("{byte:02x}")).collect();
    for page in 0..32 {
        deadline.remaining()?;
        if page * 256 >= observations.len() {
            break;
        }
        let Some(query) = observations
            .head_query(&scope, progress.revision, page * 256)
            .map_err(|e| e.code())?
        else {
            break;
        };
        let heads = transport.heads(&query, deadline)?;
        let Some(batch) = heads.prepare(&operation, progress.next_sequence)? else {
            continue;
        };
        let final_progress = transport
            .status(population, None, deadline)?
            .progress
            .ok_or("contribution_sync_writer_conflict")?;
        outbox.freeze(binding, &batch, &final_progress)?;
        let terminal = {
            let flight = outbox.flight(binding, &final_progress)?;
            transport.dispatch(&flight, deadline)?
        };
        return settlement(outbox, binding, terminal);
    }
    let final_progress = transport
        .status(population, None, deadline)?
        .progress
        .ok_or("contribution_sync_writer_conflict")?;
    final_progress.checked(binding)?;
    if final_progress.scope != progress.scope
        || final_progress.revision != progress.revision
        || final_progress.next_sequence != progress.next_sequence
        || final_progress.population_revision != progress.population_revision
        || final_progress.population_head != progress.population_head
    {
        return Err(super::CONFLICT);
    }
    Ok(format!("{{\"schemaVersion\":3,\"status\":\"selected_observations_match\",\"coverage\":\"partial\",\"canonicalRevision\":{},\"observations\":{},\"quarantined\":{}}}", progress.revision, observations.len(), observations.quarantine().total()))
}
/// Continuous draining: repeat bounded single-batch sends while each batch
/// settles committed and pages remain, at most `max_batches` times. Every
/// iteration re-reads the authenticated server position; an abandoned or
/// non-settled outcome, a matching selection, or the command deadline stops the
/// loop. A single batch returns the plain send result unchanged.
#[cfg(target_os = "macos")]
pub(super) fn drain(
    outbox: &mut super::Outbox,
    transport: &super::https::Transport,
    deadline: &super::https::Deadline,
    population: &str,
    observations: &aicharts_core::contribution_producer::NativeObservations,
    max_batches: u8,
) -> Result<String, &'static str> {
    if !(1..=MAX_BATCHES).contains(&max_batches) {
        return Err("invalid_option");
    }
    if max_batches == 1 {
        return send(outbox, transport, deadline, population, observations);
    }
    let mut batches = Vec::new();
    let mut status = "drained";
    for _ in 0..max_batches {
        let result = send(outbox, transport, deadline, population, observations)?;
        let parsed: serde_json::Value =
            serde_json::from_str(&result).map_err(|_| super::INVALID)?;
        let settled_committed = parsed["status"] == "settled" && parsed["outcome"] == "committed";
        let matched = parsed["status"] == "selected_observations_match";
        batches.push(parsed);
        if matched {
            status = "drained";
            break;
        }
        status = if settled_committed {
            "batch_limit"
        } else {
            "stopped"
        };
        if !settled_committed {
            break;
        }
    }
    serde_json::to_string(&serde_json::json!({ "schemaVersion": 3, "status": status,
        "batches": batches, "quarantined": observations.quarantine().total() }))
    .map_err(|_| super::INVALID)
}
#[cfg(target_os = "macos")]
fn run_macos(options: Options) -> Result<String, &'static str> {
    let key = crate::read_key(&options.key)?;
    if options.command == Command::Inspect {
        return local_inspect(&options.directory, &key);
    }
    let deadline = super::https::Deadline::command()?;
    let transport = super::https::Transport::enrolled(&options.directory)?;
    let binding = transport.binding();
    if options.command == Command::Initialize {
        let population = population_or_journal(
            options.population.as_deref(),
            &options.directory,
            &key,
            binding,
        )?;
        let status = transport.status(&population, None, &deadline)?;
        let progress = status.progress.ok_or("contribution_sync_writer_conflict")?;
        super::Outbox::initialize(&options.directory, &key, binding, &progress)?;
        return Ok("{\"schemaVersion\":3,\"status\":\"initialized\"}".into());
    }
    match options.command {
        Command::Status => {
            return super::ops::status(
                &options.directory,
                &key,
                options.population.as_deref(),
                &transport,
                &deadline,
            )
        }
        Command::Activate => {
            return super::ops::activate(&options.directory, &key, &transport, &deadline)
        }
        Command::Migrate => {
            return super::ops::migrate(
                &options.directory,
                &key,
                &transport,
                &deadline,
                crate::stats_sync::account_revisions,
            )
        }
        Command::Grant => {
            return super::ops::grant(
                &options.directory,
                &key,
                options.population.as_deref(),
                &transport,
                &deadline,
            )
        }
        Command::Onboard => {
            return super::ops::onboard(
                &options.directory,
                &key,
                options.population.as_deref(),
                &transport,
                &deadline,
                crate::stats_sync::account_revisions,
            )
        }
        _ => {}
    }
    let mut outbox = super::Outbox::recover(&options.directory, &key, binding)?;
    match options.command {
        Command::Resume | Command::Cancel => recover_action(
            &mut outbox,
            &transport,
            &deadline,
            options.command == Command::Cancel,
        ),
        Command::Send => {
            if outbox.checkpoint.flight.is_some() {
                return Err("contribution_sync_resume_required");
            }
            let (provider, path) = options.source.as_ref().ok_or("invalid_option")?;
            let observations = read_source(&transport, *provider, path)?;
            drain(
                &mut outbox,
                &transport,
                &deadline,
                &population_or_journal(
                    options.population.as_deref(),
                    &options.directory,
                    &key,
                    binding,
                )?,
                &observations,
                options.max_batches,
            )
        }
        _ => Err("invalid_option"),
    }
}
/// Send/initialize may omit --population-id only when the ops journal retains
/// exactly one settled grant; otherwise the flag stays required.
#[cfg(target_os = "macos")]
fn population_or_journal(
    explicit: Option<&str>,
    directory: &Path,
    key: &[u8; 32],
    binding: &super::Binding,
) -> Result<String, &'static str> {
    if let Some(population) = explicit {
        return Ok(population.into());
    }
    super::ops::journal_population(directory, key, binding).ok_or("invalid_option")
}

#[cfg(test)]
mod tests;
