# Local Codex and Claude Code usage

The usage CLI is a local-only foundation. It reads explicitly selected JSONL files, projects metadata into numeric measurements, deduplicates supported copied records, and prints a summary or exact wire dry-run. It has no networking code, login, public upload, background service or persistent session cache. AI Charts' live website is unchanged.

## Build and run

Install the Rust toolchain pinned in `rust-toolchain.toml`. From the repository:

```sh
cargo build --locked -p aicharts-cli
./target/debug/aicharts --help
```

On macOS/Linux, create a private namespace key at a new path outside the repository. Choose an existing private directory; the command does not create parent directories or overwrite an existing file:

```sh
./target/debug/aicharts keygen --output /absolute/private/directory/aicharts.key
```

Retain this key securely. It determines the opaque IDs used for deduplication; replacing it changes those IDs. It is not a provider token and is never included in a frame. The current CLI checks Unix permission bits and creates keys with mode 0600. Credential-vault storage, shared-device recovery and namespace rotation are not implemented. Windows key generation remains disabled until its credential-storage path is qualified; this is not a claim of a completed cross-platform installer.

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

## Limits and failure behavior

The CLI accepts at most 2,048 source files, visits at most 20,000 directory entries to depth 16, and reads at most a 256 MiB source snapshot per invocation. Each file is bounded to its observed initial size, so newly appended data waits for another scan. Readers cap physical lines at 1 MiB, nesting at 64, source lines at 100,000 and merged unique measurements at 100,000. The CLI additionally caps retained per-file measurements at 100,000 before merging; copied records count against this work budget even when subsequently deduplicated. Limits fail explicitly, not by returning silently truncated totals. Narrow the selected source range when a limit is reached; automatic incremental cursors and a durable numeric outbox are future work.

A malformed or partially written trailing record fails the scan with a fixed error. Retry after the source writer completes; no cursor has been advanced and no server state has changed. Standard error never includes source content or paths. Internal bugs are still possible; a passed test suite is not a security audit.

## Privacy and validation

The source projections contain no prompt/response bodies, titles, paths, model names, tool arguments or attachments. Skipping fields still requires scanning their bytes. Numeric IDs use a private keyed hash of bounded native identity metadata, not of conversation content. Numeric protocols do not prevent a malicious client from encoding arbitrary information in numbers, and valid counters are not provider-attested counters.

Run focused checks during development:

```sh
cargo test --locked -p aicharts-protocol
cargo test --locked -p aicharts-core
cargo test --locked -p aicharts-cli
bun test lib/usage
```

The checked 240-byte synthetic fixture must round-trip identically through Rust and TypeScript. Parser tests substitute forbidden content, exercise cumulative counters and streaming revisions, and reject malformed/oversized inputs. CLI tests create only disposable synthetic files and keys, assert dry-run behavior, and check fixed-error boundaries. No test reads real sessions or credentials.

`bun run usage:check` runs Rust formatting, Clippy and workspace tests. `bun run check` includes it alongside all existing website gates. Ordinary `bun run dev`/`build` does not run the collector or require provider data. No production measurement ingestion is enabled by publishing this source.
