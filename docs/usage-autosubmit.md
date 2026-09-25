# Scheduled usage publication

`aicharts autosubmit` runs one refresh-and-publish cycle: it refreshes each
configured client and uploads the latest totals to your AI Charts account. It
does not install a schedule; on macOS, a launchd job that you set up runs it.
Publishing works only on a Mac enrolled with `aicharts enroll`, and the command
keeps provider credentials separate from your AI Charts credentials.

If another publisher already uploads your usage, complete the
[activation checks](usage-activation.md) before replacing it. Keep the previous
job and its configuration until the first AI Charts scheduled cycle has
succeeded and your account shows its data.

The refresh adapters, capture wrapper, and cycle logic are tested with synthetic
data. This guide describes what the code does. It does not record a completed
test against live providers, a deployment, or a switch to a scheduled launchd job.

## Configuration

Store configuration in a private regular file with mode `0600`. Paths are
absolute; shell variables in JSON are not expanded. `days` accepts 1–366; select
up to 54 disjoint clients, with at most 128 source roots per client. A client
entry may carry its own `days` (same 1–366 bound) to narrow or widen only that
client's collection and refresh window. For example, a source whose underlying
store can drop committed rows benefits from a short window, so a legitimately
reduced stored day leaves the published range sooner. Up to 8 sinks, one per
kind, may delegate delivery to other installed publishers. This example
uses placeholder paths and must be changed to the existing enrollment and source locations:

```json
{
  "schemaVersion": 1,
  "stateDir": "/Users/example/.aicharts/state",
  "keyFile": "/Users/example/.aicharts/checkpoint.key",
  "runtimeDir": "/Users/example/.aicharts/autosubmit-runtime",
  "home": "/Users/example",
  "days": 30,
  "clients": [
    { "client": "codex" },
    { "client": "claude" },
    { "client": "devin-cli" },
    {
      "client": "cursor",
      "sourceRoots": ["/Users/example/.aicharts/cursor"],
      "refresh": {
        "kind": "cursor",
        "cacheDir": "/Users/example/.aicharts/cursor",
        "cursorStateDb": "/Users/example/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
      }
    }
  ],
  "sinks": [
    { "kind": "tokscale", "binary": "/Users/example/.config/tokscale/autosubmit/tokscale" }
  ]
}
```

The runtime directory is separate from the enrollment and provider caches. It
holds a stable cycle lock and the latest bounded `last-cycle.json` result. An
overlapping invocation refuses without starting another cycle. The status file
contains public client IDs, actions and fixed error codes; it excludes account
identifiers, paths, credentials and source content.

Use `sourceRoots` for a configured client profile. A refresh cache must be one
of that client's explicit roots. Clients without roots use discovery beneath
the selected home. Roots never enable a provider login or refresh implicitly.
One client entry owns all its configured roots; duplicate clients and overlapping
9Router publication are refused. A profile with several accounts must preserve
their separate acquisition bindings before combining numeric observations.

## Check and run

```sh
aicharts autosubmit --config-file /absolute/path/autosubmit.json --check
aicharts autosubmit --config-file /absolute/path/autosubmit.json --dry-run
aicharts autosubmit --config-file /absolute/path/autosubmit.json
```

`--check` validates configuration without creating runtime state. `--dry-run`
reads local usage without opening enrollment, refreshing providers or sending
data. Neither proves live authentication or publication. The ordinary invocation
first reconciles any retained upload using its exact frozen bytes, then refreshes
and publishes each configured client. Failed refreshes skip that client's
publication; another client may continue. An uncertain upload stops later writes
and remains retained for the next cycle. Partial failures return a nonzero exit
status. A successfully parsed source with no observations in the selected
period is a successful `no_observations` skip; it does not upload an empty
replacement. Missing or incomplete sources still fail. The cycle has a
30-minute budget checked between individually bounded operations.

Historical daily observations use history-preserving publication: absent days
remain, and unexplained reductions in existing counters or coverage are refused.
Warp uses a separate latest-counter snapshot because its billing-period counters
are not daily events. See [detailed report semantics](usage-details.md).

## Provider refreshes

Every refresh is explicit, bounded, and publishes its local numeric cache only
after its complete required fetch succeeds. A failed fetch preserves the last
complete cache. Credential files are private owned regular files; credentials
are never stored in configuration or emitted in status output.
Use `aicharts refresh --help` for standalone refresh commands. A refresh writes
the local cache; `stats-sync` or an ordinary `autosubmit` cycle publishes the
numeric snapshot to the enrolled AI Charts account.

| Kind | Required refresh fields | Optional fields |
| --- | --- | --- |
| `cursor` | `cacheDir`, exactly one of `cursorStateDb` or `sessionTokenFile` | — |
| `trae` | `cacheDir`, `tokenFile` | `includeAux` (default false); the configured `days` selects the fetch window |
| `warp` | `cacheDir`, exactly one of `tokenFile` or `cookieFile` | — |
| `hindsight` | `cacheDir`, `endpoint`, `tenant` | `tokenFile`, `allowLoopbackHttp` (default false) |
| `antigravity` | `cacheDir`, `app` | `pid`, `port`, `allowLocalSelfSignedTls` (default false) |

Trae IDE and Solo share account-level international usage, so configure one
profile. The upstream China backend has no supported session-usage endpoint.
Warp retains its latest billing/refresh counters, with tokens unavailable.
Hindsight's source may retain traces briefly; choose a cadence that captures
the configured service's retention window. Antigravity requires the selected
local macOS application and verifies process ownership and the loopback listener.
Its optional local TLS mode is restricted to that verified local process.
MiniMax capture is an explicit command around a user-requested invocation; a
scheduled publisher reads completed captures and never starts new model work.

## Sinks

A sink delegates one delivery to another installed publisher at the end of the
cycle. It runs after every client attempt — including when publication itself
needs reconciliation — because it is an independent delivery channel, not a
second write on the AI Charts pipeline. Each delegate keeps its own collection,
credentials, identity and submission semantics; the cycle never sees the
delegate's account, token or payload, and discards delegate output because it
can carry account identifiers and source paths.

```json
"sinks": [
  { "kind": "tokscale", "binary": "/Users/example/.config/tokscale/autosubmit/tokscale" }
]
```

`kind` selects the delegate; `binary` is an absolute path invoked without a
shell, extra arguments or configured environment. `tokscale` runs
`tokscale submit`, the same full-history submission its own scheduled job
performs; the delegate's service remains responsible for deduplication and
history handling on its side. Each attempt is bounded to the lesser of 10
minutes and the remaining cycle budget, and the delegate's process group is
killed on deadline. A nonzero exit reports `sink_failed`; spawn and deadline
failures report `sink_spawn_failed` and `sink_deadline`. A sink failure never
reorders, repeats or suppresses client publication, and a publication failure
never suppresses a sink. `--dry-run` records each sink as `skipped` without
delegating.

Keep the delegate's own schedule disabled or interval-compatible once the
delegated path is verified: two active schedules invoking the same publisher
duplicate work. Until a completed cycle proves the delegated delivery, leave the
previous publisher's own job enabled exactly as the cutover section requires.

## Native contribution sending (opt-in)

`--contribution-sync` is off by default. With the flag, the cycle runs the
explicit contribution sender (`aicharts contribution-sync --send`) once per
configured native source after every configured client published cleanly and
before sinks. It never runs in `--dry-run`, after a failed refresh, publish or
resume, or once the cycle budget is spent. The flag and the `contributionSync`
block must appear together: the flag without the block reports
`autosubmit_contribution_sync_unconfigured`, and the block without the flag
reports `autosubmit_contribution_sync_flag_required`, so a configuration edit
alone never starts a new write path.

```json
"contributionSync": {
  "stateDir": "/Users/example/Library/Application Support/aicharts/contribution",
  "keyFile": "/Users/example/Library/Application Support/aicharts/key",
  "populationId": "<64 lowercase hex characters>",
  "sources": [
    { "provider": "claude", "file": "/Users/example/.claude/projects/example/session.jsonl" },
    { "provider": "codex", "file": "/Users/example/.codex/sessions/example.jsonl" }
  ],
  "maxBatches": 3
}
```

`stateDir` is the sender's own checkpoint directory (it must differ from
`runtimeDir` and `home`), `keyFile` its checkpoint key, `populationId` the
already owned population, and `sources` one to eight distinct absolute Claude
or Codex files. `maxBatches` (1–8, default 1) is passed to the sender as
`--max-batches`, so one cycle drains up to that many settled, committed
batches for each source and stops when the selection already matches the
server. Each source is reported as a `contribution_sync` step whose status is
the sender's own fixed word (`settled`, `drained`, `batch_limit`, `stopped`,
`selected_observations_match`, or `sent` for anything else); output paths,
identifiers and payloads are never relayed. A failed or uncertain send reports
the sender's fixed error code, marks the cycle `partial_failure`, stops later
sources for that cycle and leaves the sender's retained flight for the next
explicit `--resume`; sinks still run. Outside qualified macOS custody the
sender refuses with its existing
`contribution_sync_requires_qualified_macos_custody` code. This hook is
implemented and tested with a fake runner; it is not live-qualified, and it
never activates V3 or grants ownership.

## MiniMax Code capture

Capture an invocation you intend to run with your existing MiniMax installation:

```sh
aicharts capture mcode --cache-dir /absolute/private/mcode-cache --executable /absolute/path/mcode -- exec "your task"
```

The wrapper supplies `--output-format stream-json`. It consumes stdout and stderr
privately, discards content, and retains only complete numeric usage matched to
an authoritative final result. Success prints a numeric summary. A failed child
returns its nonzero exit status and preserves prior captured history. Run your
own `mcode` installation directly when you need its provider diagnostics.

The default timeout is one hour; `--timeout-seconds` accepts 1–7,200. Output is
bounded at 64 MiB stdout, 4 MiB stderr, and 1 MiB per line. Cancellation and timeout
clean up the owned process group. The numeric cache is bounded at 64 MiB, bound
to the selected executable identity, and merges completed turns without repeating
identical captures. A conflicting replay refuses rather than rewriting history.
Configure client `mcode` with this cache as an explicit source root. Scheduling
reads these completed captures; it never runs a new model task.

## macOS scheduling and cutover

Use a stable signed collector path qualified against the retained enrollment.
Before the first publish, compare the full account ID from
`aicharts account --state-dir /absolute/private/state --json` with the account
disclosure on the signed-in usage dashboard. The command verifies both retained
local credentials without advancing enrollment or uploading data. This identity
match does not replace live publication, numeric readback or unattended custody
qualification; see [enrolled state](usage-local.md#enrolled-state-directory).

Prefer one long-lived job: `aicharts daemon ... --publish-config
/absolute/private/autosubmit.json` collects every 15 minutes and runs this
cycle on its own schedule (`--publish-interval-seconds`, default one hour) in
the same process, with `RunAtLoad` and `KeepAlive` so it survives crashes and
logins. A separate `io.aicharts.autosubmit` LaunchAgent whose
`ProgramArguments` are the absolute binary path, `autosubmit`, `--config-file`
and the absolute private configuration path, with `RunAtLoad`,
`ProcessType=Background` and a deliberate `StartInterval`, still works. Do not
enable a new schedule until a manual live cycle and account totals have been
checked. An interval is a scheduling request, not guaranteed daily delivery:
firings while the Mac sleeps or the job is already running are missed. Verify
the actual completion timestamp and result in `last-cycle.json`.

Every device publishes its own snapshots; the account sums devices per client
and day, so a second Mac needs no ownership transfer and its cycles never
conflict with the first. Each publication first resends a retained uncertain
flight; a refusal that names those exact bytes is settled through the
service's authenticated abandonment proof before fresh work, so a stuck cycle
recovers on its own at the next run. Only network uncertainty keeps a flight.

Record the old job's label, file, arguments, user GUI domain and enabled state.
After the first AI Charts scheduled cycle succeeds, persistently disable the
old Tokscale service in that same domain with `launchctl disable`, then unload
it with `launchctl bootout`. Verify `launchctl print-disabled` and the unloaded
service state; unloading alone permits the retained LaunchAgent to return at
the next login. Keep its plist, executable, credentials and local history.
Read back AI Charts again after the old job is disabled. Rollback disables and
unloads the new service, then uses `launchctl enable` and `launchctl bootstrap`
for the retained old job in its original domain. It never resets either
service's data or credentials.

Use the fixed error code in `last-cycle.json` to investigate a completed cycle.
Configuration, lock, or runtime-storage failures can occur before this file is
updated; also inspect the command's exit status and fixed error output. Never
remove enrollment, key, checkpoint or pending-upload files to make a retry run.
Account/generation mismatches and revoked devices require explicit
reconciliation. A fresh scan that is smaller than retained history never
lowers it: the service keeps the larger of each retained cell and the new
observation. A terminally refused frozen request is settled automatically by
the next cycle through the authenticated `stats-sync --abandon` proof, which
fences a late retry before clearing that flight; never delete the checkpoint
manually. A credential rotation that changes a profile's bound scope requires a
separate profile or a reviewed migration.

## Local retention

Provider caches can retain numeric history that is no longer available from the
provider, so treat them as historical records. Each profile is bounded at
64 MiB (Warp's current snapshot is bounded at 4 MiB); reaching a limit refuses
growth instead of deleting older records. Completed source capture caches have
their own documented bounds. The sync checkpoint retains the exact pending
numeric request and validated receipt in private authenticated files.

Fresh enrolled detailed collection also retains private source health, bounded
to 128 KiB and 55 client entries. The last attempt, last complete good observation
and publication state are independent. Each collection receives a private random
attempt identity, so even two scans completed in the same millisecond remain
distinct. Each publication binds that observation and the entire frozen
request identity; a delayed reply cannot settle another flight. Legacy flights
with no health binding stay unknown. `stats-health` inspects existing evidence
without a write lock or new files; see [source health](usage-details.md#select-a-source-profile).

The explicit `stats-sync --incremental` option applies only to an exclusive
Codex source profile. Its derived local checkpoint has a 256 MiB payload ceiling,
65,536-file ceiling and two-million-observation ceiling. It binds source identity,
consumed content, parser generation and cumulative/fork state together. Copy,
rotation, truncation, changed prefix or incompatible generation requires full
replay; failed, partial or rejected projection attempts preserve the prior
checkpoint. Ordinary `stats` and dry runs never persist a checkpoint. Automatic
use remains disabled until the complete cold/warm/append/correction workload
passes performance qualification. Avoid interpreting zero parsed bytes as zero
I/O: reused source prefixes still require content verification.

The measured 50,000-observation fixture confirmed exact results but did not
qualify persisted reuse: median full collection was 185 ms, warm reload 237 ms,
and append with reload 295 ms versus 182 ms for an append full scan. These are
diagnostic timings on one host, not service guarantees. Smaller parser work does
not yet offset checkpoint verification, decoding and reconstruction costs.

Both new stores retain at most one staged replacement beside their current
payload and stable lock. An interrupted replacement that leaves a stage refuses
another write with `source_snapshot_recovery_required`; existing valid health
remains readable. Preserve the retained files for recovery rather than removing
them to force a retry.

On an explicit uninstall or profile-retirement request, stop the owned schedule,
verify the exact profile identity, preserve a private backup/export if history
is still needed, and remove only that profile's owned cache/runtime files.
Removing a local profile does not withdraw public consent or delete server data.
Those account actions have separate authenticated controls. Source transcripts
and another tool's credentials or caches are never part of profile cleanup.

Importer snapshot files are private temporary copies and are removed after a
normal scan or handled error. Supported macOS filesystems use temporary clones
that share unchanged data blocks; fallback copies require a 2 GiB free-space
reserve. An abrupt process kill can leave a private
`aicharts-import-*` directory; inspect ownership and active-process status before
removing an abandoned exact directory. Do not sweep unrelated temporary data.
