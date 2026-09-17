# Local Codex and Claude Code usage

The available usage CLI commands operate locally. They read explicitly selected JSONL files, project metadata into numeric measurements, deduplicate supported copied records, and print a summary or exact wire dry-run. Explicit initialization also enables a private numeric ledger with restart-safe checkpoints and a local pending queue. On macOS, `enroll` pairs this installation with an AI Charts account through local credential custody and one explicit browser approval, and `upload --state-dir` can then send one bounded pending batch for that enrolled installation; service installation remains unavailable. These account paths are not qualified against a live service. No transcript cache is created. Public benchmark pages and the calculator do not require usage collection. The separate [browser identity boundary](usage-identity.md) and private daily reads are disabled by default and do not enroll devices or transmit local measurements.

## Build and run

Install the Rust toolchain pinned in `rust-toolchain.toml` and a C compiler for the bundled SQLite dependency. From the repository:

```sh
cargo build --locked -p aicharts-cli
./target/debug/aicharts --help
```

`aicharts --version` prints the Cargo package version. `aicharts --version --json` returns schema version 1, operation `version`, that version, compile-time OS/architecture, `sourceCommit: null`, and `provenance: "unverified"`. These commands do not read source files, keys, state, or runtime configuration. They do not establish release provenance or a signed installation. Only those exact argument orders are accepted; combining the literal `--version` token with another command fails before file access. To name a file literally `--version`, use an explicit path such as `./--version`.

On macOS/Linux, create a private namespace key at a new path outside the repository. Choose an existing private directory; the command does not create parent directories or overwrite an existing file:

```sh
./target/debug/aicharts keygen --output /absolute/private/directory/aicharts.key
```

Retain this key securely. It determines the opaque IDs used for deduplication; replacing it changes those IDs. It is not a provider token and is never included in a frame. The current CLI checks Unix permission bits and creates keys with mode 0600. The separate [credential custody library](../crates/aicharts-custody/README.md) has passed disposable macOS Keychain qualification, but it is not connected to these commands: live vault integration, shared-device recovery and namespace rotation remain unqualified. Windows key generation remains disabled until its credential-storage path is qualified; this is not a claim of a completed cross-platform installer.

Read one selected source or directory; repeat source flags to combine files. Neither key bytes nor source paths are printed:

```sh
./target/debug/aicharts usage --key-file /absolute/private/directory/aicharts.key --codex /absolute/path/to/session.jsonl --json
./target/debug/aicharts usage --key-file /absolute/private/directory/aicharts.key --claude /absolute/path/to/projects --json
./target/debug/aicharts usage --key-file /absolute/private/directory/aicharts.key --devin /absolute/path/to/atif-sessions --json
./target/debug/aicharts upload --dry-run --key-file /absolute/private/directory/aicharts.key --codex /absolute/path/to/session.jsonl
```

`upload --dry-run` prints JSON containing hexadecimal canonical numeric frames. This JSON is a local inspection format, not an accepted HTTP request body. The actual [wire contract](usage-wire-v1.md) has no string fields. `upload` without `--dry-run` is the enrolled send described below; it reads no provider sources. No command searches a home directory automatically or modifies provider configuration.

## Foreground daemon runner

For per-session model mix and time coverage, use the separate
[`sessions` report and local browser viewer](usage-sessions.md). Historical files provide bounded numeric token
observations only; they do not establish streaming, inference, or wait intervals. Copied complete records
are reconciled by their keyed native identities; partial tails remain deferred
until a terminating newline, and copied or forked subagent histories are not
reconstructed as new root usage.

`daemon` repeats the existing local `collect` command in one foreground process. It requires the same explicit state directory, private key and provider source paths; it does not discover paths, install a service, read provider credentials, or contact a server. The default interval is 15 minutes and is bounded to 60 seconds through 24 hours. Use `--once` for a single supervised pass or smoke test:

```sh
./target/debug/aicharts daemon --once --state-dir /absolute/private/aicharts-state \
  --key-file /absolute/private/aicharts.key --codex /absolute/path/to/codex-sessions --json
```

Without `--once`, the process prints each local collection result and sleeps between passes. A failed pass exits with a fixed error so an eventual qualified OS service can apply its own restart/backoff policy. This runner is local persistence only: its ledger remains `uploaded: false`, and the separate upload/authentication boundary remains disabled.

For live logs and an already [prefix-enabled ledger](#collect-completed-lines-from-a-live-source), add `--complete-prefix`:

```sh
./target/debug/aicharts daemon --once --complete-prefix \
  --state-dir /absolute/private/aicharts-state --key-file /absolute/private/aicharts.key \
  --codex /absolute/path/to/codex-sessions --claude /absolute/path/to/claude-projects \
  --devin /absolute/path/to/atif-sessions --json
```

This selects `collect-prefix` on every pass and retry. Complete JSONL lines are imported; a stable unfinished suffix waits for its newline. Devin ATIF documents are complete JSON documents: only a source that parses end to end is imported; a partial or truncated document fails closed. JSON reports `scanMode: "full_changed_source_complete_prefix"` and `sourcesWithDeferredTail`. Prefix replay, history checks, atomic imports and metadata skips are unchanged. This is full-prefix replay, not byte-tail resumption. A file changing during the scan can still fail; prefix mode does not make every live-source race recoverable.

Choose the mode explicitly. Without `--complete-prefix`, the daemon retains legacy collection and refuses a prefix-enabled ledger with `ledger_complete_prefix_required`. With it, a legacy ledger refuses with `ledger_prefix_not_enabled`. Both mode checks occur before source traversal. The daemon never initializes, migrates, resets, or automatically switches a ledger; migration remains the separate revision-guarded `prefix-enable` command.

Directory traversal selects `.jsonl` files for Codex and Claude sources and `.json` files for Devin sources; an explicit file argument is accepted regardless of extension. Traversal skips observed symlink entries and rejects a symlink supplied as a source. Unix final-file opens use no-follow/nonblocking flags and check file identity. This is not descriptor-rooted traversal or an OS sandbox: parent-directory replacement and malicious local processes are outside this initial confinement claim. The source reader and uploader have not been isolated into separately sandboxed processes; no uploader exists yet.

## Interpreting the result

Token totals are **observed, partial historical usage**, not provider billing statements. JSON token counters are decimal strings so clients do not lose integer precision. Model IDs, API-versus-subscription attribution and account ownership remain unknown; no estimated prices are invented. `promptOccurrences: null` and unavailable activity coverage are intentional, not a zero-prompt/idle-day claim.

- Codex uses cumulative deltas. A bounded first `last_token_usage` can count the last request while preceding unobserved cumulative history stays omitted. Missing baseline and counter regressions produce warnings. Declared fork history is unsupported, not newly earned usage. Copied complete records deduplicate; arbitrary partially overlapping/forked histories may conflict and require future lineage-aware reconciliation. Partial tails remain deferred until a complete newline; no incomplete suffix contributes numeric usage.
- Claude uses native request/message identities and compatible monotonic streaming revisions. Positive cache creation without an explicit 5-minute/1-hour split is omitted with `claude_cache_ttl_unknown`, rather than assigned an invented price category.
- Devin ATIF documents require `ATIF-v1.*` schema, a `devin` agent name, and a session identity. Only `agent` steps with prompt and completion metrics contribute; cached tokens count as cache-read and the uncached remainder is `prompt_tokens - cached_tokens`. A `final_metrics` block that disagrees with the summed agent steps produces `devin_totals_mismatch`. A document missing a session identity yields no measurements rather than unattributed usage.
- Human prompt counts and activity/concurrency are not reconstructed from conversation text. The TypeScript rollup engine can calculate 15-minute activity and independent 16-minute concurrency from explicit interval/coverage inputs; historical token logs do not provide those inputs reliably.

All omissions are reported with fixed warning codes. The parser's detailed code and limits are documented in [`crates/aicharts-core/README.md`](../crates/aicharts-core/README.md). Source formats change; current evidence is synthetic compatibility tests, not a universal installed-version qualification.

## Inspect observed daily turn runtime

With an existing private namespace key and explicitly selected Codex files, run:

```sh
./target/debug/aicharts turns --codex /absolute/path/to/session.jsonl --occurrence-key-file /absolute/private/directory/aicharts.key --json
```

Repeat `--codex FILE` to combine selected files. This macOS/Linux command accepts regular files only, not directories, default paths, or Claude files. It creates no key, opens no ledger, and uploads nothing. Use `aicharts turns --help` for the argument contract. Malformed options fail before file access.

Daily output identifies `sourceProfile: 2` and separates completed and aborted root turns. Each cohort contains `observedTurns`, `runtimeEligibleTurns`, and decimal-string `runtimeMsSum`; divide the sum by the eligible count for the observed runtime mean. A zero eligible count means unavailable, not a zero-length turn. Text output preserves the exact ratio. Completed means a provider-declared non-aborted terminal, including terminal errors; it does not establish task success.

Each cohort also contains `observedSubtotals.responseTokens` and `observedSubtotals.requestedCalls`. These sum explicitly owned response-token reports and supported raw call requests. Each metric has its own decimal-string `sum`, `observations`, `turnsWithEvidence`, and exact `subtotalMean` ratio. The denominator counts distinct turns with evidence for that metric. An explicit zero-token report contributes evidence; no call record does not prove zero calls. With no evidence, the metric has zero sum/counts and a null mean. Requested calls can include denied, failed, or interrupted requests and do not establish execution. Complete `tokens` and dispatched `toolCalls` remain null, as do population means; human origin, account, pricing, and complete coverage stay unknown.

Each cohort also contains `averageTurnLength`. `runtimeMs` is the exact provider-reported runtime ratio when eligible turns exist; `tokens` and `toolCalls` are intentionally null because this command does not claim complete token totals or dispatched tool calls. Its nested `observedSubtotals` preserve the partial evidence and independent denominators described above.

Runtime uses the provider's reported elapsed milliseconds, not subtraction of log timestamps. The terminal's UTC day receives the whole turn. Old records without explicit root attribution, ambiguous starts, missing durations, and declared fork/subagent history do not produce a fabricated average. See [Daily turn measurements](usage-turns.md) for the independent generic rollup and Codex reader contracts.

The first valid header fixes each file's thread; a shared root-session ID does not make a declared child a measured root. Declared copied metadata without selected observations is excluded with fixed diagnostics. Mixed metadata containing selected observations is refused because the reader cannot establish ownership. [Container identity and refusals](usage-turns.md#container-identity-and-refusals) lists the four fixed errors. A failed requested file or merge produces no summary; source logs remain unchanged.

The command preopens at most 2,048 selected files and refuses a combined snapshot larger than 256 MiB before parsing. Across those inputs it admits at most 100,000 physical records and 65,536 combined raw observations: lifecycle events, response-usage records, and supported call requests. Copies and complete selected records with missing fields consume the observation budget before deduplication. `rawObservations` reports that work count. Reads stop at each captured file length; unfinished non-LF tails remain deferred and unclassified. Key/file identity and metadata are checked again before any output. Observed changes refuse the whole result without partial JSON. These are metadata checks, not an atomic snapshot or protection against a same-user attacker; a rewrite without an observable metadata change may evade them. Ordinary reads can update access timestamps.

JSON identifies this as operation `turns`, access `read_only`, `localOnly: true`, `uploaded: false`, scope `root_direct`, coverage `partial`, and `enumerationComplete: false`. It contains bounded counters, numeric UTC days, exact runtime sums, qualified observed subtotals, and fixed diagnostics. It contains no paths, native identities, keys, source text, or frames. The unpublished reader's `profileVersion` and `rawLifecycleRecords` keys are replaced by `sourceProfile` and `rawObservations`; ordinary usage, inspect, and ledger JSON are unchanged. `uploaded: false` describes this invocation only; it says nothing about another process's prior uploads. The results are not persisted or automatically supplied to the TypeScript rollup, wire protocol, or a dashboard.

## Save measurements locally

On macOS/Linux, initialize a new state directory outside the repository using your existing namespace key. Its parent must already exist. Keep it on a private local filesystem, not a network share or synchronized cloud folder:

```sh
./target/debug/aicharts init --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key
```

The new directory has mode 0700 and its database has mode 0600. Initialization refuses an existing directory. A failed initialization can leave an incomplete directory; it is never automatically overwritten. Keep the key: a different key cannot open this ledger, and a missing directory is not silently recreated by collection.

The foreground `daemon` runner uses the same collector and ledger. It retries only transient `ledger_busy_retry` and `ledger_changed_retry` results, three times by default with bounded 1/2/4-second delays; `--retry-attempts 0..8` changes that bound. Source changes, malformed input, invalid state, and other fixed errors stop the process for supervisor-visible recovery. Legacy mode also stops on a partial tail; explicit complete-prefix mode defers a stable unfinished suffix without treating it as an error.

Collect explicit sources and inspect retained totals after a restart:

```sh
./target/debug/aicharts collect --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key --codex /absolute/path/to/sessions --claude /absolute/path/to/projects --devin /absolute/path/to/atif-sessions --json
./target/debug/aicharts status --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key --json
```

The providers' conventional trees are `~/.codex/sessions` for Codex JSONL transcripts, `~/.claude/projects` for Claude Code JSONL sessions and `~/.local/share/devin/cli/transcripts` for Devin ATIF JSON. Sources are always explicit: nothing discovers or reads these paths without the matching flag, and each supplied tree is bounded to depth 16, 262,144 visited entries and 65,536 files. On an interactive terminal a single stderr line reports scan progress; piped stderr keeps its exact contract. A first import of a multi-gigabyte history completes in minutes from a `cargo build --release` binary; a debug build can take tens of times longer on the same tree.

Unchanged file metadata skips source parsing. Changed sources are read again from the beginning; `--rescan` forces this for unchanged files too. `linesRead`, `bytesScanned` and `sourcesSkipped` describe that invocation. This is a source-snapshot checkpoint, not byte-tail resumption. Metadata skips are not tamper evidence. The ledger also validates its bounded numeric state on open, so a no-change scan still performs local integrity work.

All selected changed sources must parse and remain stable before one transaction saves checkpoints, deduplicated measurements and pending candidates together. A source tree larger than one commit's bounded wave — at most 2,048 changed sources, 256 MiB of new content or 100,000 measurements — completes across consecutive atomic waves, each verified and committed at the refreshed ledger revision. A partial final line, malformed source, conflicting occurrence, stale concurrent writer or exceeded limit leaves that wave's import uncommitted. Persistent JSONL collection requires a final newline; a Devin ATIF source must parse as one complete JSON document instead. Retry after the source writer completes. An omitted source remains retained. A JSONL source's truncation, replacement at the same canonical path or disappearance of previously observed occurrences fails with a fixed error instead of deleting history. A Devin transcript is rewritten wholesale, so its replacement is the expected case: a revision must merge with retained step measurements by dominance — regressions are absorbed, contradictions fail — and a rewrite that drops a previously measured step still fails rather than erasing it. Automatic rotation migration, explicit deletion and decreasing corrections are not implemented.

Compatible Claude streaming updates replace the local pending value rather than add another occurrence. An older separate copy cannot lower the latest observed value. A successful result is still partial historical measurement, not a billing statement or proof against forged usage. If another collector commits before the summary is read, `committedRevision` identifies this import and `ledgerRevision` identifies the later summary snapshot.

Preview the local pending queue without acknowledging or transmitting anything:

```sh
./target/debug/aicharts outbox --dry-run --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key --limit 64
```

If `nextAfter` is non-null, use it as `--after` together with the returned `ledgerRevision` as `--revision` on the next invocation. The page limit is 1 through 256. A changed ledger invalidates pagination; restart from the first page. Entries contain canonical numeric frames and local revisions only. This queue is not the remote upload protocol or a provider attestation. There is no sending or acknowledgment command.

The [ledger contract](../crates/aicharts-ledger/README.md) describes atomicity, source-history checks and recovery boundaries. Do not delete a journal, reset a corrupt database or replace a lost namespace key as an automatic repair. Preserve the private state for diagnosis. Shadow preparation changes identity only in a new ledger; it cannot recover a corrupt database or missing native history.

### Enrolled state directory

On macOS, `enroll --state-dir DIR` changes how the local commands choose the ledger identity for that directory. `init` then provisions the account-bound split-key ledger inside the existing enrollment anchor instead of creating a new directory: the checkpoint half is the retained `--key-file` key and the occurrence half is the enrolled account namespace key, which lives in credential custody and is never a file, at namespace version 1. The anchor is never adopted or overwritten; the database installs atomically and any pre-existing ledger artifact refuses with `ledger_private_state_required`:

```sh
./target/debug/aicharts enroll --state-dir /absolute/private/directory/aicharts-state
./target/debug/aicharts init --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key
./target/debug/aicharts collect --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key --codex /absolute/path/to/sessions --claude /absolute/path/to/projects --devin /absolute/path/to/atif-sessions
```

`collect`, `collect-prefix`, `prefix-enable`, `status` and `outbox` reopen the same completed, custody-verified enrollment and operate on that account-bound ledger, so collection populates the pending queue `upload` later sends from. `inspect` resolves the same identity; `--occurrence-key-file` is refused on an enrolled directory (`occurrence_key_file_conflicts_with_enrollment`) because the account key is never a file. A directory holding only an unfinished, revoked or inconsistent enrollment record refuses closed with the enrollment seam's own fixed errors rather than silently using the legacy single-key identity; on non-macOS the same record refuses with `persistent_state_requires_qualified_macos_custody`. Unenrolled directories keep the legacy single-key behavior unchanged.

## Enrolled native sender

The library's explicit split-key sender migration adds [bounded sender custody](usage-admission-v1.md): one immutable 1–256-operation batch, exact terminal receipts, conditional acknowledgment that preserves newer corrections, and persistent conflict/revocation gates. Ordinary opens and inspection never perform that migration; the `upload` command applies it explicitly on the first enrolled send, binding the existing ledger to the enrolled account, device, recovery generation and namespace version 1. A different already-bound sender refuses. Accepted receipt bytes must come from the owned authenticated transport, not a local file or an arbitrary caller.

On macOS, `upload --state-dir DIR --key-file PATH` sends at most one bounded pending batch. The state directory must hold both the completed enrollment anchor (`enroll --state-dir DIR`) and the split-key ledger bound to the retained `--key-file` checkpoint key and the enrolled account occurrence key, which lives in credential custody and is never a file. The command reopens the enrollment record, refuses unless the attempt is terminal and custody-verified with no retained flight, and resolves the exact pairing and namespace custody records by their pinned identities and commitments. An unenrolled, unfinished, revoked or inconsistent state refuses before any network effect: `upload_not_enrolled`, `attempt_recovery_required`, `attempt_conflict` or `attempt_custody`. Non-macOS platforms refuse with `upload_requires_qualified_macos_custody`.

The CLI `upload::send_once` composes that sender state with one sealed authenticated transport port. The command first refuses a retained in-flight batch with `upload_recovery_required`; an uncertain earlier exchange is never replayed speculatively and requires an explicit recovery step. It then freezes the explicitly selected pending set at its expected ledger revision and releases transaction ownership before the exchange. It checks the transport binding and exact batch/journal correlation before the existing ledger settlement. Lost responses and transport failures retain the same flight; HTTP status alone cannot acknowledge records or persist device revocation. A terminal rejection still consumes its sequence range, and successful settlement preserves newer local corrections and a concurrently created successor flight. The report prints only nonsecret settlement facts: outcome, counts, the settled sequence, remaining pending records and the settled batch hash.

One narrow in-command exception exists: a definitely-refused exchange — an explicit `503` reply, never an ambiguous outcome — replays the identical retained bytes at most twice more before reporting `upload_transport_unavailable`. The replay selects the existing retained flight rather than a fresh batch, so the remote can never observe a second distinct selection.

The port's [native HTTPS implementation](usage-admission-v1.md#native-https-transport) has a fixed service origin, verified TLS and one synchronous exchange; its sole constructor is the enrolled custody join, which derives the bearer from the retained pairing upload secret. Its request contains owned numeric bytes, never a source path, ledger handle, polling secret or namespace key. A sticky journal byte limit rejects overflow even if an adapter ignores an append error. The implementation accepts only bounded Content-Length responses and refuses late success against a monotonic deadline; blocking OS/TLS work is not preemptible. Its exact dependency policy disables the `log` facade's macros in every build profile because a sensitive header marker alone does not suppress raw protocol traces.

The sender orchestration cases establish local retry/settlement behavior with synthetic authority and ledger reopen. The HTTPS cases use local synthetic TLS and cover certificate/hostname rejection, framing, deadlines, lost replies, cleanup and a live test logger that receives no exchange records. A shared DNS module retains the single process-wide permit until the operating-system lookup finishes, including after the caller times out. It keeps the fixed service host and port, three-second budget and 16-address limit. Run these cases with `cargo test --locked -p aicharts-cli --bin aicharts -- upload:: transport_dns::`. These results do not qualify live enrollment, actual edge framing or process-death recovery.

The Rust [terminal enrollment boundary](usage-terminal-enrollment.md) combines the shared canonical codec with a private HTTPS adapter. The codec checks original pairing lifetime, explicit account choice and the full reservation and receipt. The adapter borrows that request/context for one fixed-origin exchange, returns a fresh checked observation, and enforces a 20-second monotonic deadline plus success expiry after cleanup. It accepts only bounded final HTTP/1.1 Content-Length replies; ureq consumes informational responses internally, and decoded message EOF is not socket EOF. On macOS, `aicharts enroll --state-dir DIR` drives this boundary once per installation; `upload`'s enrolled read reopens the same completed join without rerunning the handshake. Run the enrollment cases with `cargo test --locked -p aicharts-cli --bin aicharts -- enrollment::`.

Its private attempt schema records original credential identities and commitments, accepted enrollment facts, explicit account choice and one bounded retained flight without secret preimages. The private sequencer now validates that request and retained context, persists request/context digests before dispatch, records each bounded dispatch, settles checked domain results and preserves transport or ambiguous flights for reconciliation. A compare-and-publish core checks the exact predecessor, stages immutable bytes and requires synchronization and exact readback for a durable snapshot. Inspection stays observational, and ambiguous publication requires explicit reconciliation. The same namespace flight remains retained while its original credential pin advances through local custody states. Its immutable original context timestamp is retained separately from preparation and dispatch times. A private pure reconstruction function checks the exact record token and original pairing secret, then reproduces all six request/context variants and both stored digests. Missing timestamps in old retained-flight records are refused without inference; reconstruction alone neither proves current custody nor authorizes dispatch.

Typed pairing and namespace handoff functions verify the original secret against its persisted `RecordIntent` before recording nonsecret custody progress. Completion calls the sealed reference-store API after reestablishing attempt durability. Its macOS instance methods now reach the private persistence backend with one lazy vault session per custody operation. Explicit macOS library constructors now use the existing absolute-anchor, descriptor, ACL and APFS checks. Opening and inspection only observe committed bytes; they do not synchronize, recover state or select a vault. The [disposable Keychain qualification](../crates/aicharts-custody/README.md#validation-and-qualification) passed through those facade methods with pairing and namespace records, including lost-reply reconciliation and locked-access refusal; the owned parent was empty after cleanup. Default User-domain keychain selection, the combined enrollment owner and live enrollment remain unqualified. On macOS the `enroll` command uses this custody to retain the pairing and namespace records; non-macOS enrollment stays refused.

Use `inspect` when you need a source-free summary without recovery. `status` and `outbox --dry-run` use the ordinary ledger opener, which can recover a SQLite rollback journal; neither is the dedicated no-recovery inspector.

## Stable macOS signing for credential custody

The file-based macOS Keychain binds each custody item's access list to the creating program's code signature. An ad hoc signed build designates its own code hash, so every recompile loses access to items an earlier build created. Sign each build with one persistent local identity so the binding is certificate-bound and survives rebuilds:

```sh
bun run custody:signing status
bun run custody:signing sign --binary ./target/debug/aicharts
```

`custody:signing` creates the self-signed `AI Charts Custody (Local)` certificate in the login keychain once, proves it can sign a scratch binary, signs the target with the fixed identifier `io.aicharts.cli`, then verifies the signature and its certificate-bound designated requirement. `sign` must run before `enroll` so the new custody items record the stable identity; sign again after every rebuild. The identity is a local custody anchor only — it is not release signing, notarization, or a distribution claim.

Items created before the first stable-signed build still refuse the new signature. Grant access once per item by permitting the OS consent dialog for a single command:

```sh
AICHARTS_CUSTODY_INTERACTION=allow ./target/debug/aicharts status --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key
```

Choose "Always Allow" in the dialog. The exact value `allow` is required; any other value keeps prompts suppressed, and the grant persists under the stable designated requirement so later rebuilds need no consent.

## Inspect retained totals without writes

With an existing private ledger and its original key, run:

```sh
./target/debug/aicharts inspect --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key --json
```

For an existing account-bound split-key ledger, also supply `--occurrence-key-file` with the corresponding private key path. Omitting this option selects legacy identity; supplying it selects namespace version 1. The command does not guess keys, migrate a ledger or change identity. Never paste key bytes into an agent conversation.

`inspect` uses `ReadOnlyLedger` on supported macOS/Linux local filesystems. It validates the existing ledger, closes its read-only transaction, and checks identity and revision again immediately before rendering. It reads no Codex/Claude sources, makes no network calls, creates no state, and refuses any journal, WAL or shared-memory sidecar instead of repairing it. Preserve state on an error; do not remove a sidecar or substitute a writer. Ordinary reads can update access timestamps. This bounded snapshot is not a continuing lock, rollback proof or defense against hostile same-user modification.

JSON contains exactly `schemaVersion: 1`, `operation: "inspect"`, `access: "read_only"`, `coverage: "partial"`, decimal-string `revision`, `tokens` and `outputTokens`, numeric `sources`, `usageOccurrences` and `pendingRecords`, fixed-code `warnings`, and `unavailable: ["prompts", "activity", "pricing"]`. It contains no paths, keys, occurrence IDs, source witnesses or frames. These totals describe persisted partial observations, not fresh source collection, a bill or accepted remote uploads. Missing coverage warnings are not retroactively added to an old ledger by inspection.

The [AI Charts skill](../skills/aicharts/SKILL.md) can interpret this summary separately from its public benchmark lookup. The native command must already be available in a reviewed local binary; the skill does not build or install it automatically.

## Collect completed lines from a live source

First inspect the current local revision with `status`. Explicitly enable prefix
checkpoints using that revision, without reading sources or changing identities:

```sh
./target/debug/aicharts prefix-enable --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key --revision 0
./target/debug/aicharts collect-prefix --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key --codex /absolute/path/to/sessions --claude /absolute/path/to/projects --devin /absolute/path/to/atif-sessions --json
```

Replace `0` with the observed revision. Migration preserves measurements, pending
records and revisions; a stale first migration fails. It is additive, not an
automatic repair. The old `collect` command refuses a prefix-enabled ledger
before reading sources. `status`, `outbox` and read-only reindex inspection do
not migrate it. Reindex still requires complete newline-terminated JSONL sources
and complete Devin ATIF documents.

`collect-prefix` replays the full LF-terminated prefix of each JSONL source, not
just appended bytes. An unfinished JSON or UTF-8 suffix waits for its
terminating newline. For a Devin source the observed file is itself the complete
prefix: there is no partial tail, and a document that does not parse end to end
fails rather than deferring. The CLI
reports `sourcesWithDeferredTail`; no numeric measurement or checkpoint is
created from a deferred suffix. New and historically empty sources wait for their
first complete line. A nonempty migrated source with no complete line fails
instead of bypassing history conservation. Existing unwitnessed sources must
replay even when their metadata matches a legacy checkpoint.

Each witness is a local HMAC-SHA256 over a fixed domain, keyed source ID,
completed-byte length and exact completed bytes. The old witness is verified
over the same bytes delivered to the parser before admitting an extension.
Rewriting ignored content or reordering retained records therefore fails on
rescan even when numeric totals are unchanged. The HMAC and source IDs never
enter summaries, outbox frames or network formats; internal hash state is not
serialized. This local content-derived integrity metadata is not a transcript
copy, provider attestation, or proof against a user who controls their key/state.

An unchanged witnessed source may use the metadata fast path. `--rescan` forces
rehashing; metadata equality alone is not cryptographic integrity evidence. A
changed suffix without another complete line is verified but cannot advance its
durable stamp. Uncommitted suffix shrink is allowed only on the same file and
never below the previous completed prefix. Complete-prefix rewrites, rotation,
removed measurements and continuously changing source snapshots fail closed.
The entire multi-source import remains atomic. Recovery from a corrupt ledger
or intentionally corrected history still requires a separate reviewed workflow.

The existing 256 MiB snapshot limit bounds reverse newline discovery as well as
the replay; `bytesScanned` reports the selected observed snapshot sizes, not
physical I/O amplification. Prefix mode can read part of a snapshot twice while
finding its last newline and replaying it. No daemon is activated by migration.

## Prepare an account-bound shadow

Keep the existing ledger, its key and all pending records. Account occurrence IDs must be derived again from native metadata with the account namespace; hashing old opaque IDs would not deduplicate another machine's copies.

Inspect coverage with the legacy key and explicit sources:

```sh
./target/debug/aicharts reindex-plan --dry-run --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key --codex /absolute/path/to/sessions --claude /absolute/path/to/projects --json
```

This command uses a separate read-only inspection API. It refuses journal, WAL and shared-memory sidecars rather than recovering or modifying them, and closes the database before parsing sources. It rereads every selected source regardless of unchanged checkpoints and compares exact normalized frames against the legacy measurement inventory. `matchedOccurrences`, `missingOccurrences`, `conflictingOccurrences` and `newOccurrences` describe coverage; equal totals alone do not establish a match. The output contains no source paths, keys or measurement frames.

Missing native history cannot be recovered from opaque IDs. Recover the missing sources before preparing a shadow. If current streaming records differ from the retained legacy values, collect those supported updates into the old ledger and rerun the plan. Conflicting or missing measurements block preparation before a target is created. Source logs must be stable and newline-terminated for both commands.

For development with an explicitly supplied private account-namespace key, choose a new shadow directory whose parent exists:

```sh
./target/debug/aicharts reindex-prepare --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key --shadow-dir /absolute/private/directory/aicharts-shadow --occurrence-key-file /absolute/private/directory/account-namespace.key --codex /absolute/path/to/sessions --claude /absolute/path/to/projects --json
```

Production enrollment uses macOS credential custody; the enrolled account occurrence key lives there and is not a file this command can accept. Do not generate a replacement namespace for ranked history or treat a supplied key as authenticated account ownership. Preparation binds the new ledger to both the retained local checkpoint key and the supplied occurrence key at namespace version 1. Existing legacy commands deliberately cannot open that split-key ledger. There is no active-ledger promotion command; an enrolled `upload` requires a state directory that already holds both the completed enrollment anchor and the matching split-key ledger.

Preparation validates old coverage, rereads the same physical sources under the new occurrence key and writes only to the new directory. It rechecks source stability and the old ledger after writing. Neither command changes old database content, its outbox, key or application state; ordinary reads can update filesystem access times. A late race or interrupted initialization can leave a separate incomplete shadow. Preserve it for inspection and choose a different explicit target for a retry; the command never overwrites, cleans up or promotes it automatically. Read-only revision checks are not an atomic promotion fence.

## Limits and failure behavior

The ephemeral `usage` command accepts at most 2,048 source files. Persistent collection and reindex discover at most 65,536 files across the selected trees and visit at most 262,144 directory entries to depth 16. Collection commits one bounded wave at a time — 256 MiB of new content, 2,048 changed sources and 100,000 measurements each — so a large history completes across consecutive waves without a total-size ceiling. Reindex instead builds one atomic plan: all selected sources together stay within 256 MiB and 100,000 merged measurements, so a larger history plans or prepares in narrower subtrees. Shadow preparation makes two passes, one per occurrence key. Each file is bounded to its observed initial size, so newly appended data waits for another scan. Readers cap physical lines at 1 MiB, nesting at 64, source lines at 100,000 and merged unique measurements at 100,000. The CLI additionally caps retained per-file measurements at 100,000 before merging; copied records count against this work budget even when subsequently deduplicated. Limits fail explicitly, not by returning silently truncated totals. Narrow the selected source range when a scan limit is reached.

Persistent state additionally caps 32,768 retained sources, 500,000 unique occurrences and 1,000,000 source-to-occurrence associations. Its main SQLite file is capped at 512 MiB; journal space is additional. Hitting a retained-state cap requires a future reviewed retention/export path, not deleting state or silently reminting a namespace. No unbounded history claim is made.

A malformed complete record fails the scan with a fixed error. Legacy persistent collection and reindex also reject unfinished tails; explicitly enabled prefix collection defers them as described above. Retry after the source writer completes; rejected imports advance no checkpoint or server state. Standard error never includes source content or paths. Internal bugs are still possible; a passed test suite is not a security audit.

## Privacy and validation

The source projections contain no prompt/response bodies, titles, paths, model names, tool arguments or attachments. Skipping fields still requires scanning their bytes. Occurrence IDs use a private keyed hash of bounded native identity metadata, not of conversation content. Persistent local source checkpoint IDs additionally use a separate keyed hash of canonical path and provider; they are not included in pending frames. Neither raw paths nor keys are persisted. Numeric protocols do not prevent a malicious client from encoding arbitrary information in numbers, and valid counters are not provider-attested counters. The local ledger is private by filesystem permissions, not encrypted or OS-sandboxed.

Run focused checks during development:

```sh
cargo test --locked -p aicharts-protocol
cargo test --locked -p aicharts-core
cargo test --locked -p aicharts-ledger
cargo test --locked -p aicharts-custody
cargo test --locked -p aicharts-cli
bun test lib/usage
```

The checked 240-byte synthetic fixture must round-trip identically through Rust and TypeScript. Parser tests substitute forbidden content, exercise cumulative counters and streaming revisions, and reject malformed/oversized inputs. CLI tests create only disposable synthetic files and keys, assert dry-run behavior, and check fixed-error boundaries. No test reads real sessions or credentials.

`bun run usage:check` runs Rust formatting, Clippy and workspace tests. `bun run check` includes it alongside all existing website gates. Ordinary `bun run dev`/`build` does not run the collector or require provider data. No production measurement ingestion is enabled by publishing this source.
