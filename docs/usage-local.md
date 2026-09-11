# Local Codex and Claude Code usage

The usage CLI is local-only. It reads explicitly selected JSONL files, projects metadata into numeric measurements, deduplicates supported copied records, and prints a summary or exact wire dry-run. Explicit initialization also enables a private numeric ledger with restart-safe checkpoints and a local pending queue. It has no networking code, login, public upload, background service or transcript cache. Public benchmark pages and the calculator do not require usage collection. The separate [browser identity boundary](usage-identity.md) is disabled by default and does not enroll devices or transmit measurements.

## Build and run

Install the Rust toolchain pinned in `rust-toolchain.toml` and a C compiler for the bundled SQLite dependency. From the repository:

```sh
cargo build --locked -p aicharts-cli
./target/debug/aicharts --help
```

On macOS/Linux, create a private namespace key at a new path outside the repository. Choose an existing private directory; the command does not create parent directories or overwrite an existing file:

```sh
./target/debug/aicharts keygen --output /absolute/private/directory/aicharts.key
```

Retain this key securely. It determines the opaque IDs used for deduplication; replacing it changes those IDs. It is not a provider token and is never included in a frame. The current CLI checks Unix permission bits and creates keys with mode 0600. The separate [credential custody library](../crates/aicharts-custody/README.md) is not connected to these commands: live vault access, shared-device recovery and namespace rotation remain unqualified. Windows key generation remains disabled until its credential-storage path is qualified; this is not a claim of a completed cross-platform installer.

Read one selected source or directory; repeat source flags to combine files. Neither key bytes nor source paths are printed:

```sh
./target/debug/aicharts usage --key-file /absolute/private/directory/aicharts.key --codex /absolute/path/to/session.jsonl --json
./target/debug/aicharts usage --key-file /absolute/private/directory/aicharts.key --claude /absolute/path/to/projects --json
./target/debug/aicharts upload --dry-run --key-file /absolute/private/directory/aicharts.key --codex /absolute/path/to/session.jsonl
```

`upload --dry-run` prints JSON containing hexadecimal canonical numeric frames. This JSON is a local inspection format, not an accepted HTTP request body. The actual [wire contract](usage-wire-v1.md) has no string fields. `upload` without `--dry-run` fails before reading any sources. No command searches a home directory automatically or modifies Codex/Claude configuration.

Directory traversal selects `.jsonl` files, skips observed symlink entries, and rejects a symlink supplied as a source. Unix final-file opens use no-follow/nonblocking flags and check file identity. This is not descriptor-rooted traversal or an OS sandbox: parent-directory replacement and malicious local processes are outside this initial confinement claim. The source reader and uploader have not been isolated into separately sandboxed processes; no uploader exists yet.

## Interpreting the result

Token totals are **observed, partial historical usage**, not provider billing statements. JSON token counters are decimal strings so clients do not lose integer precision. Model IDs, API-versus-subscription attribution and account ownership remain unknown; no estimated prices are invented. `promptOccurrences: null` and unavailable activity coverage are intentional, not a zero-prompt/idle-day claim.

- Codex uses cumulative deltas. A bounded first `last_token_usage` can count the last request while preceding unobserved cumulative history stays omitted. Missing baseline and counter regressions produce warnings. Declared fork history is unsupported, not newly earned usage. Copied complete records deduplicate; arbitrary partially overlapping/forked histories may conflict and require future lineage-aware reconciliation.
- Claude uses native request/message identities and compatible monotonic streaming revisions. Positive cache creation without an explicit 5-minute/1-hour split is omitted with `claude_cache_ttl_unknown`, rather than assigned an invented price category.
- Human prompt counts and activity/concurrency are not reconstructed from conversation text. The TypeScript rollup engine can calculate 15-minute activity and independent 16-minute concurrency from explicit interval/coverage inputs; historical token logs do not provide those inputs reliably.

All omissions are reported with fixed warning codes. The parser's detailed code and limits are documented in [`crates/aicharts-core/README.md`](../crates/aicharts-core/README.md). Source formats change; current evidence is synthetic compatibility tests, not a universal installed-version qualification.

## Save measurements locally

On macOS/Linux, initialize a new state directory outside the repository using your existing namespace key. Its parent must already exist. Keep it on a private local filesystem, not a network share or synchronized cloud folder:

```sh
./target/debug/aicharts init --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key
```

The new directory has mode 0700 and its database has mode 0600. Initialization refuses an existing directory. A failed initialization can leave an incomplete directory; it is never automatically overwritten. Keep the key: a different key cannot open this ledger, and a missing directory is not silently recreated by collection.

Collect explicit sources and inspect retained totals after a restart:

```sh
./target/debug/aicharts collect --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key --codex /absolute/path/to/sessions --claude /absolute/path/to/projects --json
./target/debug/aicharts status --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key --json
```

Unchanged file metadata skips source parsing. Changed sources are read again from the beginning; `--rescan` forces this for unchanged files too. `linesRead`, `bytesScanned` and `sourcesSkipped` describe that invocation. This is a source-snapshot checkpoint, not byte-tail resumption. Metadata skips are not tamper evidence. The ledger also validates its bounded numeric state on open, so a no-change scan still performs local integrity work.

All selected changed sources must parse and remain stable before one transaction saves checkpoints, deduplicated measurements and pending candidates together. A partial final line, malformed source, conflicting occurrence, stale concurrent writer or exceeded limit leaves that import uncommitted. Persistent collection requires a final newline. Retry after the source writer completes. An omitted source remains retained; truncation, replacement at the same canonical path or disappearing previously observed occurrences fail with a fixed error instead of deleting history. Automatic rotation migration, explicit deletion and decreasing corrections are not implemented.

Compatible Claude streaming updates replace the local pending value rather than add another occurrence. An older separate copy cannot lower the latest observed value. A successful result is still partial historical measurement, not a billing statement or proof against forged usage. If another collector commits before the summary is read, `committedRevision` identifies this import and `ledgerRevision` identifies the later summary snapshot.

Preview the local pending queue without acknowledging or transmitting anything:

```sh
./target/debug/aicharts outbox --dry-run --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key --limit 64
```

If `nextAfter` is non-null, use it as `--after` together with the returned `ledgerRevision` as `--revision` on the next invocation. The page limit is 1 through 256. A changed ledger invalidates pagination; restart from the first page. Entries contain canonical numeric frames and local revisions only. This queue is not the remote upload protocol or a provider attestation. There is no sending or acknowledgment command.

The [ledger contract](../crates/aicharts-ledger/README.md) describes atomicity, source-history checks and recovery boundaries. Do not delete a journal, reset a corrupt database or replace a lost namespace key as an automatic repair. Preserve the private state for diagnosis. Shadow preparation changes identity only in a new ledger; it cannot recover a corrupt database or missing native history.

The library's explicit split-key sender migration adds [bounded sender custody](usage-admission-v1.md): one immutable 1–256-operation batch, exact terminal receipts, conditional acknowledgment that preserves newer corrections, and persistent conflict/revocation gates. It performs no networking and is not exposed by a CLI sending or receipt-import command. Ordinary opens and inspection never perform that migration. Accepted receipt bytes must eventually come from the owned authenticated transport, not a local file or an arbitrary caller.

Use `inspect` when you need a source-free summary without recovery. `status` and `outbox --dry-run` use the ordinary ledger opener, which can recover a SQLite rollback journal; neither is the dedicated no-recovery inspector.

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
./target/debug/aicharts collect-prefix --state-dir /absolute/private/directory/aicharts-state --key-file /absolute/private/directory/aicharts.key --codex /absolute/path/to/sessions --claude /absolute/path/to/projects --json
```

Replace `0` with the observed revision. Migration preserves measurements, pending
records and revisions; a stale first migration fails. It is additive, not an
automatic repair. The old `collect` command refuses a prefix-enabled ledger
before reading sources. `status`, `outbox` and read-only reindex inspection do
not migrate it. Reindex still requires complete newline-terminated sources.

`collect-prefix` replays the full LF-terminated prefix, not just appended bytes.
An unfinished JSON or UTF-8 suffix waits for its terminating newline. The CLI
reports `sourcesWithDeferredTail`; no numeric measurement or checkpoint is
created from that suffix. New and historically empty sources wait for their
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

Production enrollment and native credential custody remain unfinished. Do not generate a replacement namespace for ranked history or treat a supplied key as authenticated account ownership. Preparation binds the new ledger to both the retained local checkpoint key and the occurrence key at namespace version 1. Existing legacy commands deliberately cannot open that split-key ledger. There is no active-ledger promotion or live upload command yet.

Preparation validates old coverage, rereads the same physical sources under the new occurrence key and writes only to the new directory. It rechecks source stability and the old ledger after writing. Neither command changes old database content, its outbox, key or application state; ordinary reads can update filesystem access times. A late race or interrupted initialization can leave a separate incomplete shadow. Preserve it for inspection and choose a different explicit target for a retry; the command never overwrites, cleans up or promotes it automatically. Read-only revision checks are not an atomic promotion fence.

## Limits and failure behavior

The CLI accepts at most 2,048 source files, visits at most 20,000 directory entries to depth 16, and reads at most a 256 MiB source snapshot per pass. Shadow preparation makes two passes, one per occurrence key. Each file is bounded to its observed initial size, so newly appended data waits for another scan. Readers cap physical lines at 1 MiB, nesting at 64, source lines at 100,000 and merged unique measurements at 100,000. The CLI additionally caps retained per-file measurements at 100,000 before merging; copied records count against this work budget even when subsequently deduplicated. Limits fail explicitly, not by returning silently truncated totals. Narrow the selected source range when a scan limit is reached.

Persistent state additionally caps 2,048 retained sources, 100,000 unique occurrences and 200,000 source-to-occurrence associations. Its main SQLite file is capped at 256 MiB; journal space is additional. Hitting a retained-state cap requires a future reviewed retention/export path, not deleting state or silently reminting a namespace. No unbounded history claim is made.

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
