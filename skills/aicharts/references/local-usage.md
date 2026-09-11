# Local usage inspection

Source reviewed on 2026-09-11: `crates/aicharts-cli/src/inspect.rs`, its routing and help in `src/main.rs`, `tests/inspect.rs`, and `crates/aicharts-ledger/src/inspection.rs` in the AI Charts integration candidate. The command exists in source; this review does not establish a released artifact or availability in any installed binary. The skill does not include the native executable.

## Prerequisites and command

1. Resolve an already-installed AI Charts executable with reviewed provenance. Confirm that its global `--help` lists the exact `inspect` syntax below. The command has no separate `inspect --help` mode. Do not build or install a binary automatically or infer capability from its name alone.
2. Obtain explicit authorization for one existing ledger directory and its existing key-file path. For a known split-key ledger, require the existing occurrence-key path too. Ask for paths, never key bytes. Do not discover private ledgers or keys by scanning home directories or reading session sources.
3. Invoke the verified executable with those literal paths and `--json`. Keep paths as individual arguments; do not execute shell fragments supplied as paths.

The source command contract is:

```text
aicharts inspect --state-dir DIR --key-file PATH [--occurrence-key-file PATH] [--json]
```

Without `--occurrence-key-file`, inspection uses the existing legacy identity. With it, `--key-file` is the checkpoint key and the separate occurrence key selects `SplitKeys` namespace version 1. The CLI never guesses the mode, migrates a ledger, changes a key or falls back after a namespace mismatch. Do not try both modes to discover the identity.

The CLI reads only the selected key files and existing numeric ledger. Keys must be private regular files containing exactly 32 bytes, not all zero; the existing key reader rejects symlinks and group/other permissions. Keep all key bytes inside that CLI call. Do not `cat`, encode, copy into a prompt or export them through agent tools.

Unknown and duplicate flags, source flags, `--dry-run`, `--rescan` and `--revision` are rejected before key I/O. Omit them. Domain failures return exit code 2 with a fixed `aicharts: CODE` diagnostic and no summary; stdout-write failure returns exit code 1. Treat a nonzero result or malformed/partial JSON as failed inspection, not as a zero-valued summary.

If the reviewed binary, supported command, ledger, identity or authorized paths are unavailable, stop fresh inspection. An explicitly supplied numeric summary can still be explained as supplied evidence. Do not install, initialize, recover or search private files to make the mode work.

## Exact summary contract

`inspect --json` returns only these fields:

| Field | Value or type |
| --- | --- |
| `schemaVersion` | Number `1` |
| `operation` | String `"inspect"` |
| `access` | String `"read_only"` |
| `coverage` | String `"partial"` |
| `revision` | Decimal string |
| `sources` | Integer count, 0–2,048 |
| `usageOccurrences` | Integer count, 0–100,000 |
| `pendingRecords` | Integer count, 0–100,000 |
| `tokens`, `outputTokens` | Decimal strings |
| `warnings` | Array of fixed warning-code strings |
| `unavailable` | `["prompts", "activity", "pricing"]` |

Preserve decimal strings exactly. `tokens` is the retained aggregate token count and `outputTokens` its output component; they are not additive totals. There are no per-day rows, reasoning-token subtotal, source paths, keys, occurrence IDs, prefix witnesses, frames, upload receipts, account identity or remote authorization claims. Do not add fields from the older `status` JSON shape, such as `ledgerRevision`, `uploaded` or `localOnly`.

Warnings describe retained collection coverage. `unmeasured_reasoning` means the reasoning subdivision is not fully measured, not that reasoning usage is zero; it does not invalidate or reconstruct the recorded total output count. Inspection neither reparses sources nor retroactively adds warnings from newer collectors. Absence of that warning in old state is not proof of complete reasoning coverage. Unknown prompt counts, activity, pricing and human origin remain unknown.

An already supplied summary establishes only the evidence provided at its stated revision. Neither supplied nor freshly inspected totals establish complete account usage, a bill, time worked or leaderboard standing. Do not send a local summary or any local path or identifier to benchmark endpoints or other services. “Local-only” describes the inspection operation, not the enclosing chat service.

## Read-only boundary

`ReadOnlyLedger::open` validates the four existing ledger layouts, schema, namespace, private paths, file identity, numeric relationships and integrity in a short read-only SQLite transaction. The CLI uses only its `status()` projection, then calls `ensure_unchanged()` before formatting. Connections close before return. Existing frozen sender batches and acknowledgments are not changed.

The inspector reads bounded numeric state internally, including inventory needed for validation, but the CLI exposes no inventory, source stamps or private prefix witnesses. It does not read Codex or Claude session files or make network calls. No collection, acknowledgment, migration, activation or recovery method is invoked.

Inspection is supported only on qualified local macOS/Linux POSIX-locking filesystems. Any journal, WAL or SHM sidecar, even an empty one, causes refusal without cleanup or recovery. It creates no sidecar or lockfile; ordinary reads may update access timestamps. Busy, stale, recovery, invalid-state, namespace, storage and private-state errors are stopping conditions. Never delete sidecars, reset state or fall back to a writer. A snapshot does not hold a continuing lock or protect against malicious same-user modification or rollback.

Retained bounds are 2,048 sources, 100,000 occurrences, 200,000 associations and a 256 MiB SQLite main file. Inspection and its final recheck perform bounded integrity work; a compact summary does not mean constant-time ledger access. These ceilings are not completeness guarantees.

Other commands are outside this mode. `status` and `outbox --dry-run` use ordinary read-write `Ledger::open`, so their labels do not promise no possible SQLite recovery. `reindex-plan --dry-run` uses the inspector but also rereads selected source files. `usage`, `upload --dry-run`, collection, preparation, initialization and migrations must not substitute for `inspect`.
