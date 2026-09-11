# Private local usage ledger

This crate persists only canonical numeric usage, local source checkpoints and pending measurement candidates. It opens its own explicitly selected state directory, never provider sources. It has no network, acknowledgment, account sign-in or daemon API.

## Persistence choice

| Option | Atomicity and recovery | Decision |
| --- | --- | --- |
| Separate cursor and frame files | Requires a new journal, locking and recovery protocol across files. | Not selected. |
| One rewritten numeric snapshot | Atomic replacement is possible, but every admission rewrites all retained data and still needs writer/recovery coordination. | Not selected for the ledger. |
| Embedded SQLite with rollback journal | Measurements, source checkpoints and pending candidates commit in one transaction. | Selected for local state only. |

R2 remains the proposed durable server measurement store. This local choice does not provision Turso or add a website database. `rusqlite` and its bundled SQLite are pinned by Cargo.lock. SQLite's [atomic-commit](https://www.sqlite.org/atomiccommit.html) and [synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous) guarantees depend on working filesystem locking and durable flushes; tests do not prove every filesystem or storage device honors them.

## Current contract

- `initialize` creates a new mode-0700 directory and mode-0600 `usage.sqlite3`, never adopting an existing directory. An interrupted initialization can leave that exact directory incomplete; it is not automatically reset or overwritten.
- `open` requires the existing private directory and regular single-link files, checks the database application ID, schema version, exact schema and keyed namespace fingerprint, and rebuilds the bounded numeric projection to detect inconsistent rows. It never silently migrates or repairs unknown state. SQLite can recover its own valid hot rollback journal.
- All source snapshots in `commit_scans` share one IMMEDIATE transaction and compare the caller's expected ledger revision. Errors, conflicts, bounds and interrupted pre-commit work leave the previous checkpoint, measurements and outbox together. Concurrent writers either wait outside the API and retry, or receive a fixed busy/stale-revision error; no best-effort partial import is returned.
- A source checkpoint consists of a 32-byte keyed local source ID plus numeric file identity, length and timestamps. The CLI derives that ID from provider and canonical path, but neither the path nor any source content is stored. Metadata reuse is an optimization, not tamper evidence. Changed files are fully reparsed; the checkpoint is not resumable parser state or a byte-tail cursor.
- A rescanned source must retain its observed occurrence IDs, preserve native file identity and not shrink. Compatible Claude streaming revisions may advance; contradictions, disappeared prior observations, truncation and replacement stop admission without deleting old measurements. Sources omitted from a command remain retained. Source migration, explicit deletion and legitimate decreasing corrections require a later reviewed contract.
- Supported copied occurrences deduplicate globally. Source-specific last observations remain available for regression checks. Global Claude measurements use the existing compatible monotonic merge; an older independent copy cannot replace a later observation.
- The outbox coalesces the latest local candidate per occurrence. Its local revision is not a remote upload sequence, acknowledgment or finalized server event. `pending` is bounded and read-only; subsequent pages must name the same ledger revision and fail if it changed. Nothing drains or uploads this queue.

Stored measurement frames are canonical single-usage v1 frames of exactly 136 bytes. Only the current imported, unknown-model, unknown-account/auth historical reader profile is admitted. Prompt and interval records, live evidence, actual account/plan ownership and pricing dimensions remain unsupported. Tokens are still self-reported observations, not billing or provider attestations.

## Limits and confinement

The ledger caps 2,048 sources, 100,000 global occurrences, 200,000 source-to-occurrence associations, 100,000 input measurements per admission and 256 records per pending page. Multiple copies count toward association/work limits. The SQLite main file is capped at 256 MiB with 4 KiB pages; rollback journal space is additional. Open-time integrity reconstruction reads bounded numeric state, so unchanged source scanning does not imply constant-time startup.

Connections use DELETE rollback journaling, EXTRA synchronous mode, full fsync where supported, in-memory temporary storage and SQL/blob size limits. No dynamic source-derived SQL, free-form fields, debug body logging or raw SQLite error text is exposed. Namespace keys are not stored. Fixed errors never include paths, source bytes or SQL details.

Persistent storage is enabled only on Unix in this source version. The existing parent is canonicalized before initialization or opening, supporting ancestor aliases such as macOS `/tmp`; the final state directory and database still reject symlinks. Private directory/file permissions are checked, and extra schema objects are rejected. This is not a descriptor-rooted sandbox, protection against a same-user malicious process or ancestor replacement races, an encrypted store, or proof of Windows ACL behavior. Keep state and its key in private directories on a local filesystem; do not place it on a network share or synchronize a live SQLite file through a cloud folder.

## Verification

`cargo test --locked -p aicharts-ledger` uses fresh synthetic state, including failed and abruptly terminated transactions. `cargo test --locked -p aicharts-cli` covers the actual command boundary, metadata skips, rescan/restart behavior, malformed tails and local outbox inspection. `bun run check` remains the full repository gate. Source privacy, logical recovery and live installation qualification are different claims; no real provider session is needed by these tests.
