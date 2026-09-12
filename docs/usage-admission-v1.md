# Usage admission bytes and sender custody

The Rust and server codecs implement bounded numeric operation, batch and terminal-receipt containers. The native ledger can explicitly retain and settle one batch. Internal R2 helpers conditionally persist and verify canonical batch/journal objects. These components do not expose an authenticated upload endpoint, activate a sender or establish who issued a receipt. The [Worker boundary](usage-worker.md) remains disabled.

## Common rules

All integers are unsigned little-endian. Account IDs are 16 bytes; device IDs, recovery generations and hashes are 32 bytes; occurrence IDs are 16 bytes. Identity fields are nonzero. Namespace version is exactly 1. Sequences and account-journal revisions are in `1..=9,007,199,254,740,991`; the entire batch sequence range must fit. Timestamps are in `0..=8,640,000,000,000,000` milliseconds. Reserved bytes are zero and trailing bytes are rejected.

The outer account ID identifies the Hraness owner. It is distinct from the provider account/subscription field inside a measurement. No upload secret, polling secret, namespace key, local ledger revision, source path or text-content field enters these containers. Structural limits do not prevent deliberate encoding of information in numeric values, or prove authentic usage.

## Operation and member receipt

An operation starts with a 184-byte descriptor:

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 4 | `AICO` |
| 4 | 2 | Version 1 |
| 6 | 2 | Reserved |
| 8 | 2 | Namespace version 1 |
| 10 | 1 | Action: 1 put, 2 tombstone |
| 11 | 1 | Reserved |
| 12 | 4 | Payload length: 136 for put, 0 for tombstone |
| 16 | 16 | Account |
| 32 | 32 | Device |
| 64 | 32 | Recovery generation |
| 96 | 8 | Device sequence |
| 104 | 16 | Occurrence |
| 120 | 32 | Expected predecessor operation hash; zero means absent |
| 152 | 32 | SHA-256 of exact payload; zero for tombstone |

A put appends exactly one canonical 136-byte [AICU measurement frame](usage-wire-v1.md), making 320 bytes. That frame contains one Usage record and no prompts or intervals; its occurrence must match the descriptor. A tombstone is exactly 184 bytes. Nested frame decoding takes an explicit trusted day/model policy. The generic codec does not manufacture measurement coverage; the native ledger separately enforces its narrower imported historical profile. Execution identity may be known even when provider account, model and authentication mode are unknown.

`operationHash = SHA256(UTF8("aicharts:usage-operation:v1\0") || exactOperationBytes)`. The `\0` notation means one NUL byte, not two printable characters.

A member receipt is exactly 264 bytes. It echoes the descriptor, except magic is `AICR` and byte 11 is the outcome. It then appends operation hash at 184, resulting head operation hash at 216, account-journal revision at 248 and commit timestamp at 256. The operation hash binds the original `AICO` bytes, not the modified receipt descriptor.

| Outcome | Meaning and constraint |
| --- | --- |
| 1 | Inserted put; absent predecessor required; resulting head equals operation hash |
| 2 | Replaced put; nonzero predecessor required; resulting head equals operation hash |
| 3 | Tombstoned; nonzero predecessor required; resulting head equals operation hash |
| 4 | Identical live payload; put only; existing nonzero head retained |
| 5 | Predecessor conflict; existing head or zero if absent |
| 6 | Batch aborted because another member failed; existing head or zero |
| 7 | Device revoked; resulting head zero; applies uniformly to the whole batch |
| 8 | Subject already tombstoned; retained tombstone head is nonzero |

These are consistency checks, not a proof that the server performed its required current-head and credential checks. Corrections may decrease counters when the exact predecessor matches. Tombstones prohibit resurrection. An identical payload may deduplicate across devices without creating a new subject head.

## Batch and terminal journal

An `AICB` batch has a 104-byte header followed by 1–256 canonical operations:

| Offset | Field |
| --- | --- |
| 0, 4, 6, 8 | Magic `AICB`, u16 version 1, u16 reserved, u16 namespace 1 |
| 10 | u16 operation count |
| 12 | u32 exact summed operation byte length |
| 16, 32, 64 | Account, device, generation |
| 96 | u64 first sequence |

Every operation shares the header binding, has a unique occurrence and uses the next contiguous sequence. The maximum is 82,024 bytes. `batchHash = SHA256(UTF8("aicharts:usage-batch:v1\0") || exactBatchBytes)`.

An `AICJ` terminal journal has a 160-byte header and the same number of ordered 264-byte receipts:

| Offset | Field |
| --- | --- |
| 0, 4, 6, 8 | Magic `AICJ`, u16 version 1, u16 reserved, u16 namespace 1 |
| 10 | u16 receipt count |
| 12 | u32 exact receipt bytes: count × 264 |
| 16, 32, 64, 96 | Exact batch account, device, generation, first sequence |
| 104 | 32-byte batch hash |
| 136 | u64 account-journal revision |
| 144 | u64 commit timestamp |
| 152 | Status: 1 accepted, 2 rejected |
| 153 | Seven reserved bytes |

Maximum length is 67,744 bytes. Every receipt must match its exact ordinal operation and the header revision/time. Accepted journals contain only outcomes 1–4. A rejected journal contains at least one conflict/deleted outcome, with otherwise-admissible members marked 6, or uniformly contains 7. A rejection with only outcome 6 is invalid. Any failed member rejects the whole batch; no subject heads change. Rejected terminal journals still consume the complete sequence range.

## Native ledger behavior

Schema 2 is an explicit, atomic migration of a split-key ledger with an exact expected revision and nonzero sender binding. Ordinary open, inspection and legacy commands do not migrate or acquire sender authority. Existing measurements, checkpoints, source associations, revisions and pending frames are preserved. Six bounded sender tables retain binding/high-water marks, one immutable batch, its local member revisions, accepted coverage, the latest settled request/journal pair and reconciliation gates. SQLite's connection-local row-length cap is 262,144 bytes; the database cap remains 256 MiB.

Freezing selects 1–256 unique pending occurrences and durably allocates a contiguous sequence range before any transport. Expected predecessor hashes come only from retained accepted receipts, or zero for no locally accepted predecessor. Neither a newly observed remote head nor a collection update automatically rebases a conflict. An existing flight cannot be rewritten.

Settlement validates the entire exact terminal journal before mutating rows. Accepted members retain their operation/receipt and remove only the pending entry with the same occurrence, local revision and frame. A newer local correction stays queued. Rejected members never acknowledge a measurement: 5/8 persist per-occurrence reconciliation gates, 6 remains pending, and uniform 7 gates the device. Collection does not clear those gates. Both terminal outcomes retain the latest complete request/journal pair and advance the settled sequence atomically. Exact repeated settlement is a readback, not another mutation. Timeouts, HTTP failures, staging replies and malformed journals retain the flight.

New terminal journals must advance the last observed account-journal revision and cannot regress its commit timestamp. Retained accepted/reconciliation evidence cannot postdate the latest settled journal. Exact repeated settlement remains harmless even when a later batch is in flight; it does not clear that later batch.

Opening and read-only inspection retain full integrity reconstruction. The first sender call and calls after a changed database stamp also perform a full audit. Repeated transactions on one live handle can reuse a private scalar audit stamp while checking the exact schema, control state and at most 768 selected/current/last occurrence IDs. The stamp is captured inside the transaction and published unchanged only after successful completion; rollback, commit failure, collection and intervening same- or external-connection writes invalidate it. No receipt map is retained in memory. This detects changes through SQLite's connection semantics, not arbitrary raw-file replacement, rollback or a malicious same-user process. Keep the ledger handle open between batches without holding a transaction during network waits.

There is no public receipt-import command. The future owned authenticated transport must supply terminal bytes; parsing a file or caller-supplied receipt cannot establish acceptance. Explicit conflict reconciliation, ungating, operational device replacement and CLI transport are not implemented by this ledger API.

## Immutable object helpers and remaining authority

Batch objects are account/generation-scoped and content-addressed. Journal objects use the account/generation and a fixed-width journal revision, so two competing terminal decisions at the same revision conflict. Helpers own canonical bytes before asynchronous work, use conditional creation and check exact bytes, size, checksum and metadata during bounded readback. A lost write or readback returns a fixed failure; an identical later call reconciles the existing immutable object. These helpers do not decide or publish acceptance.

The dormant authenticated account Durable Object implements this ordering internally:

```text
reserve exact batch → verify immutable batch → final device/CAS check
→ freeze irreversible terminal journal → verify immutable journal
→ atomically publish all subject heads and settle the sequence range
```

Keep prior accepted heads visible until publication. A device revoked before the irreversible decision must be rejected. Revocation after that decision must not alter or strand its terminal journal. The journal-persistence fence therefore checks recovery availability, not whether the device remains active. Later decisions must wait behind any unpublished predecessor.

Account-journal revisions are separate from enrollment's ordinary observation revision. Its schema-3 SQL index and immutable policy enforce the narrower imported profile, account/day/revision capacities, exact retries and bounded startup integrity audit documented in [Usage Worker boundaries](usage-worker.md). This does not change the generic codec or native sender wire semantics.

Enrollment, device revocation and account deletion still need immutable ordered control events for recovery; batch receipts alone cannot restore those facts. General restore remains globally closed until an externally known high-water mark, contiguous journal prefix and all pending predecessors reconcile. Object absence or unchanged generation is not permission to reopen. No public upload, live backend acceptance or restore qualification is claimed here.

## Evidence

Rust tests and TypeScript tests consume one independently assembled synthetic hex fixture, including both operation actions and accepted/conflict/deleted/revoked journals. They test exact framing, hashes, ranges, impossible outcomes, malformed/truncated input and ownership. TypeScript additionally rejects accessor/custom-iterator arrays and uses intrinsic bounded byte snapshots, including Buffer subviews; shared buffers are rejected. This is not an in-process hostile-JavaScript sandbox.

Local workerd tests exercise maximum-size R2 objects, immutable retries, lost replies/readback, journal forks, canonical ownership and closed fences. Native tests exercise migration, restart, crashes, exact acknowledgment and retained conflict/revocation state. None of these tests reads personal sessions, authenticates provider counters or establishes cross-platform OS isolation.

A controlled release-mode synthetic probe retained 100,000 occurrences, with 99,000 already accepted. Before the audit-stamp optimization, three 256-member freeze/settlement samples took 3,246–3,394 ms per pair. Warm pairs after the change took 61 ms; the first freeze still audited the full ledger and took 638 ms. Full open took 622 ms, and the database remained 119,730,176 bytes. These are local same-handle measurements from one machine, not network throughput, a full-history upload or a cross-platform performance guarantee. The explicit ignored probe in the native sender tests reproduces this workload.
