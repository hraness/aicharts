# Local usage

Use the executable admitted through [Run the Linux CLI](usage-install.md). Commands below run from its archive root. Uppercase `KEY`, `SOURCE`, `FILE`, and `STATE` are syntax placeholders, not shell variables or ready-made paths. Replace them with your own explicitly selected paths, quoting each path as one argument.

## Keep a private key

Choose an existing private directory and a new file path outside the software directory:

```text
./bin/aicharts keygen --output KEY
```

This creates a 32-byte random key with mode 0600 and refuses to overwrite an existing file. It does not create parent directories. Retain the key securely: replacing it changes measurement identities, and losing it is not recoverable through this CLI. It is not a provider credential. Never paste its bytes into a conversation or report. The file permission check is not encryption, native vault custody, or an OS sandbox.

## Read selected provider usage

```text
./bin/aicharts usage --key-file KEY --codex SOURCE --json
./bin/aicharts usage --key-file KEY --claude SOURCE --json
```

Repeat the provider flags to combine selected files or directories. Directory scanning selects `.jsonl` files and skips observed symlink entries; explicitly supplied symlinks are refused. No home-directory discovery or provider configuration change occurs. The CLI scans source bytes to extract selected metadata. It does not copy session logs or retain conversation bodies.

Results describe partial observed history, not a bill or all activity in an account. Preserve JSON token counters as decimal strings. `outputTokens` is part of the total, not another amount to add. Warnings matter: missing baselines, unsupported history, or unmeasured token subdivisions are not zero usage. Supported copied records deduplicate; arbitrary overlaps and forks are not guaranteed to reconcile.

Model attribution, subscription type and cost, API-versus-subscription use, account ownership, human prompt counts, activity, concurrency, and cost per hour remain unavailable. Do not infer time worked or productivity from tokens. This guide does not claim compatibility with every provider version.

## Inspect daily turn observations

With the existing key, select Codex regular files explicitly:

```text
./bin/aicharts turns --codex FILE --occurrence-key-file KEY --json
```

Repeat `--codex FILE` to combine selected files. `turns` accepts neither directories nor Claude files, and it performs no automatic discovery. It creates no key, opens no ledger, and uploads nothing. Omit `--json` for a text summary with exact ratios. Use `./bin/aicharts turns --help` for its argument contract.

A root turn is one provider-defined turn of the primary agent, not a session, message, API request, or child-agent turn. The result uses `sourceProfile: 2` and `scope: "root_direct"`. Child tokens and calls are excluded. A root turn does not establish that a human sent a prompt; origin and account remain unknown.

The first valid file header fixes its thread. A declared child may share its parent's root-session ID and remains excluded. A declared copied-history file with foreign headers or a shared root-session ID is accepted only without selected observations, with `inherited_metadata_only` and `unsupported_ancestry` diagnostics. Mixed metadata containing selected observations is refused; a later header never switches ownership. Preserve refused sources. A failed requested file or merge produces no partial summary and does not modify logs.

Daily `completed` and `aborted` cohorts stay separate. Each whole turn belongs to its terminal’s UTC day, including turns crossing midnight. “Completed” means a provider-declared non-aborted terminal, which can include an error; it does not mean the task succeeded. Open or undated turns have no daily average.

Each metric has its own denominator:

| Observed metric | Sum | Denominator for its mean |
| --- | --- | --- |
| Runtime | `runtimeMsSum`, in milliseconds | `runtimeEligibleTurns` |
| Response-token subtotal | `observedSubtotals.responseTokens.sum` | That metric’s `turnsWithEvidence` |
| Requested-call subtotal | `observedSubtotals.requestedCalls.sum` | That metric’s `turnsWithEvidence` |

The explicit `averageTurnLength` object repeats these day/cohort ratios for machine consumers. Its `runtimeMs` is `{ numerator, denominator, basis: "provider_reported_runtime_ms", coverage: "partial" }` or `null`; `tokens` and `toolCalls` remain `null`, while nested `observedSubtotals` retain the partial response-token/requested-call evidence.

Runtime uses the provider’s reported elapsed milliseconds, not subtraction of log timestamps. Missing durations or ambiguous timing leave runtime unavailable for that turn. Divide `runtimeMsSum` by `runtimeEligibleTurns` only when the count is nonzero; a zero eligible count means unavailable, not a zero-length turn.

Response-token subtotals sum explicitly owned response usage reports. Requested-call subtotals count supported raw requests, including requests that may be denied, fail, or be interrupted. They do not establish dispatched or successful tool calls. Exact copies deduplicate; conflicting selected evidence refuses the result.

Each subtotal metric returns its decimal-string `sum`, `observations`, `turnsWithEvidence`, and `subtotalMean`. The mean is an exact `{ numerator, denominator }` pair over distinct turns with evidence for that metric, or `null` when no evidence exists. An explicit zero-token report contributes a measured turn; missing reports do not prove zero tokens. No call record does not prove zero calls. Do not divide by response/call count, reuse another metric’s denominator, or average file means. Preserve decimal strings until using exact integer arithmetic.

These are partial subtotals. `coverage: "partial"`, `enumerationComplete: false`, and each subtotal’s `populationMean: null` are intentional. Complete `tokens` and dispatched `toolCalls` remain null. An observed subtotal mean is not an average across all your turns, and a runtime mean does not prove complete history. The results are not persisted or automatically supplied to a dashboard or upload format.

The command accepts at most 2,048 files, a combined 256 MiB snapshot, 100,000 physical records, and 65,536 combined raw lifecycle, response-usage, and supported-call observations. `rawObservations` counts work before deduplication, including selected complete records with missing fields. Lines are capped at 1 MiB and nesting at 64. Reads stop at each captured file length; an unfinished non-newline-terminated tail stays deferred and unclassified. Limits refuse the result rather than return silently truncated totals.

Key and source metadata are checked again before output. An observed change refuses the whole result without partial JSON. These checks are not an atomic snapshot or protection against malicious same-user changes. Reads can update access times. Output contains numeric measurements, fixed labels, and fixed diagnostics, but no paths, native identities, key bytes, source text, or frames. `uploaded: false` describes this invocation, not another process’s prior uploads.

## Save measurements, then inspect them

Local persistence is optional. Choose a new `STATE` directory whose private parent already exists, and use the same key:

```text
./bin/aicharts init --state-dir STATE --key-file KEY
./bin/aicharts collect --state-dir STATE --key-file KEY --codex SOURCE --json
./bin/aicharts inspect --state-dir STATE --key-file KEY --json
```

Use `--claude SOURCE` or both provider flags when collecting Claude Code data. Initialization creates a private numeric ledger and refuses an existing directory. Collection stores usage measurements, keyed source checkpoints, and pending records, not transcripts, raw paths, or the `turns` result. Changed sources are reread; unchanged metadata can skip parsing. `--rescan` forces rereading. Metadata checks are not proof against malicious local edits.

Ordinary `collect` requires complete newline-terminated sources. Failed parsing, changed history, or a concurrent update leaves that import uncommitted. Preserve existing state after an error. Do not delete journals, replace a lost key, or initialize over a failed directory to force progress.

`inspect` reads only the existing ledger and key, without scanning provider logs, changing state, or performing SQLite recovery. It refuses journal, WAL, and shared-memory sidecars rather than removing them. Reads may update access times. Its final identity/revision check is a bounded snapshot, not a continuing lock or rollback guarantee.

The inspection summary has decimal-string `revision`, `tokens`, and `outputTokens`; numeric `sources`, `usageOccurrences`, and `pendingRecords`; fixed `warnings`; and `unavailable: ["prompts", "activity", "pricing"]`. A pending count does not establish upload history. There are no upload receipts or remote account facts in this summary.

Only for an already known split-key ledger, add `--occurrence-key-file` with its existing occurrence-key path. Omitting it selects legacy identity; supplying it selects namespace version 1. Do not try keys or modes to discover the identity. No inspection option migrates or rekeys state.

## Other local commands

Use global `./bin/aicharts --help` for their exact syntax before choosing an advanced operation:

| Command | Effect and limit |
| --- | --- |
| `status` | Reads through the ordinary ledger opener, which can recover SQLite. Use `inspect` for no-recovery inspection. |
| `prefix-enable`, then `collect-prefix` | Explicitly adds local prefix checkpoints; collection can defer an unfinished tail. Use the observed revision for migration. Old `collect` refuses a prefix-enabled ledger. |
| `upload --dry-run` | Rereads selected sources and prints hexadecimal numeric frames locally. It contacts no service; ordinary `upload` is disabled. |
| `outbox --dry-run` | Pages pending frames without sending or acknowledging them. Its ordinary ledger opener can recover SQLite. |
| `reindex-plan --dry-run` | Inspects old state and rereads selected sources to compare complete history. |
| `reindex-prepare` | Creates a separate split-key shadow only after exact old-history coverage. It never promotes or overwrites old state; a failure can leave an incomplete shadow. |

Keep summaries and frames private if they reveal your usage. Source projections exclude prompt and response bodies, titles, tool arguments, and attachments, but the process still reads source bytes and runs with your user permissions. Numeric formats do not establish genuine provider usage or eliminate covert encoding. Nothing here enables a background service or uploads measurements. Sharing output with an agent or another application is a separate disclosure.

The foreground daemon retries only the fixed transient ledger results `ledger_busy_retry` and `ledger_changed_retry`, three times by default with bounded 1/2/4-second delays. Use `--retry-attempts 0..8` to select the retry count. Source changes, partial tails, malformed input, invalid state, and all other errors stop the process so a supervisor can surface them rather than loop over a permanent failure.
