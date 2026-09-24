# Native contribution flight and cancellation evidence

[M10ContributionFlight.tla](M10ContributionFlight.tla) checks finite histories
that join a retained native request with the canonical contribution protocol.
A native timeout, an absent status result, and a server cancellation are three
different outcomes. Only a correlated authenticated terminal result permits
settlement of the same durable native flight.

This is bounded protocol evidence. It is not a proof that the native filesystem,
HTTP transport or Worker implementation refines the model. M10 complements
[M4](repaired-action-map.md), [M8](staged-projection-action-map.md) and
[M9](account-work-action-map.md); it does not replace their separate claims.

## Finite state and assumptions

The model has one account, a fixed native device/generation owner, two device
identities, two population identities and at most two operation/body identities.
The first flight uses population 1; the second, when enabled, uses population 2.
Both have the same device sequence owner. Sequence values are 0–2 and canonical
revisions 0–3. Switching account/device/generation is not permission to rewrite
or reuse a retained flight. `ChangeEpoch` leaves it retained and incompatible.

One server pending slot is separate from one durable native current flight.
At most two asynchronous messages exist: one upload and one status or cancel
control call. Each flight has at most two upload attempts (the second sequential
flight has one), and one asynchronous control request. Provider completion,
canonical commitment, response arrival, response verification and local
settlement are separate actions. A verified result can remain held while another
result settles its old flight and a new flight is persisted.

`ReadCancellationPosition` represents one completed authenticated status-position
read. `PersistCancellation` then publishes a durable, one-way upload-to-cancel
decision without modifying the frozen batch. A stale position can be refused
after either boundary. This prerequisite read is atomic in the model: its
internal transport delay, failure, parsing and reply loss are not enumerated.
Restart discards that observed position unless the cancellation decision and
envelope have already been durably published. Crashes before `PersistFlight`
and disposal/rebuilding of an unpersisted prepared draft are outside this slice.
Refreshing a cancellation CAS requires another authenticated read and another
durable control-envelope update in the implementation; that second cycle is
outside the finite send budget. Ordinary delayed status replies have their own
`SendStatus`/`ReadStatus`/observation path.

The single-flight slice includes one restart and at most one environmental
interference: credential revocation, generation change, writer invalidation,
capacity exhaustion, or one unrelated canonical revision while the pending
slot is empty. `TransferWriter` deliberately over-approximates writer invalidation;
it is not a concrete grant trace. Real grants require predecessor revocation,
advance canonical revision and handle a named pending predecessor. The model
does not claim its unchanged-authentication writer state is reachable through
that complete RPC. The sequential slice isolates two flights, retained old
replies and sequence reuse under stable authority; it does not compose those
histories with the single-flight environmental faults.

Body IDs stand for injectively distinct complete canonical byte strings,
including account, generation, device, operation, sequence, population, writer
and predecessor anchors. The model does not calculate JSON encoding, digest
collisions, numeric row values or population history hashes. Receipt body/scope
correlation abstracts their checked parsers. Canonical SQL and successful native
durable transitions are atomic trusted boundaries. A server response cannot be
fabricated by the network in this model; TLS, endpoint authentication, secrets,
redirects and response-size/timeout controls need their own transport evidence.

Normalized metadata and immutable charges count admission events, not bytes or
actual storage capacity. A before-reservation cancellation charges metadata once
and no immutable bytes. Cancelling a reservation retains its prior charge.
`objects` may contain the harmless result of a provider operation dispatched
before cancellation; this does not create canonical heads.

There are no fairness assumptions, state constraints, symmetry reductions or
view reductions. Quiescence permits an empty message queue to remain unchanged,
including when a refused or exhausted finite request budget retains a flight.
Deadlock checking therefore makes no eventual-progress promise. Permanently
held calls, arbitrary concurrent duplicate uploads, more than two operations,
unbounded retries, arbitrary interference combinations, source completeness,
restore drain, syscall durability and full source refinement remain outside M10.
Only one upload slot exists: after restart an old queued/provider upload must
clear that slot before an exact retry can be dispatched.

## State and action correspondence

| Model action or invariant | Source contract and boundary |
| --- | --- |
| `PrepareFlight`, immutable `batch` | The checked [producer kernel](../../crates/aicharts-core/src/contribution_producer.rs) freezes the canonical bytes and original operation/body/sequence/population/predecessor identity. It is not by itself a send capability. |
| `PersistFlight`, `frozenBatch`, `SendOnlyDurable` | Native flight storage must return a scoped send capability only after durable publication. `frozenBatch` captures the complete request record at that boundary; `FrozenUntilTerminal` requires equality while retained. The model assumes durable publication succeeds; fault-injected filesystem tests must establish actual create/write/sync/rename/parent-sync behavior and restart recovery. No send action accepts a merely prepared value. |
| `ReadCancellationPosition`, `PersistCancellation`, `SendCancel` | [Cancellation request contract](../../lib/usage/contribution-cancel.ts) keeps the original batch intact and places a fresh expected revision in a separate envelope. The native owner must persist its cancel decision before sending and must not silently resume uploading after uncertain cancellation. Already dispatched upload messages remain possible. |
| `ReserveUpload` | `ContributionState.reserve` in [contributions-state.ts](../../services/usage-worker/src/contributions-state.ts) checks authenticated account/generation authority, then existing exact operation identity before next-sequence/current-plan checks. A retained terminal is returned without another charge or reservation. A first reservation charges metadata and immutable intent once. |
| `DispatchR2`, `ProviderReturns`, `CommitUpload` | [AccountContributions.admit](../../services/usage-worker/src/contributions-admission.ts) re-enters owned authority and calls `locate` around immutable body/journal awaits. `ContributionState.commit` returns an existing exact terminal before planning publication. A late R2 result may exist after cancellation but cannot turn abandonment into commitment. Multiple body/journal operations are collapsed into one bounded provider effect. |
| `CancelAbsent` | `ContributionState.cancelBatch` writes permanent `cancelled-before-reserve` metadata for the original batch ID/body/bytes/scope. It checks fresh cancellation CAS, original current writer and next device sequence, consumes one sequence and one empty canonical revision, and charges metadata once. It neither reserves immutable bytes nor touches R2. |
| `CancelPending` | `cancelBatch` delegates to `#abandon` for the exact pending operation. It retains the original immutable charge, consumes sequence once and prevents every later upload continuation from publishing that ID. |
| `CancelExistingOrRefused` | Existing exact terminals reconcile before current writer/CAS/sequence checks, but after current authenticated account/device/generation policy. Foreign pending work, stale CAS, unavailable capacity and authority changes can safely refuse new cancellation. There is no unconditional cancellation liveness claim. |
| `ReadStatus`, `ReadOnlyStatus` | `AccountContributions.status` reads retained SQL control/population/operation state. The model records and compares the complete modeled server state before/after each status-position read. A null operation is an observation of absence, not a permanent fence. Actual SELECT-only/no-alarm behavior remains a Worker-test obligation. |
| `ObserveNonterminal`, `FrozenUntilTerminal` | Native state retains the exact flight on absent/pending/refused status or lost replies. It never derives terminal authority from an operation-null response. |
| `VerifyTerminal`, `SettleTerminal`, `RejectStale` | The [producer wire contract](../../crates/aicharts-core/src/contribution_producer/wire.rs) and cancellation response parser check request/response correlation. Native durable settlement must additionally compare its current retained operation/body/owner identity with the verified capability. Checking correlation only before an intervening await is insufficient. |
| `LoseReply`, `Restart`, `SendExactRetry` | A committed server operation can lose its response. Restart preserves the durable body/decision and rejects old process response capabilities; exact retry returns the retained terminal with no second plan, sequence consumption or charge. |
| `TerminalConservation`, `ChargeOnce`, `CanonicalSafety` | Both committed and abandoned terminals consume one sequence and revision. An operation has one terminal and one admission charge. Heads contain exactly committed operations, never cancelled IDs. Canonical revision drift is distinguished from this device's terminal sequence. |

## Cases and qualification

| Case | Purpose | Checked development result |
| --- | --- | --- |
| `m10-single-safety` | Complete bounded single-flight graph including delay, retry, cancellation, restart, read purity and explicit refusal boundaries. | 11,685 distinct; 35,075 generated; queue empty |
| `m10-sequential-safety` | Complete bounded two-flight graph with device sequence progression and old verified replies retained across a new durable reservation. | 8,008 distinct; 16,097 generated; queue empty |
| `m10-cancel-before-reserve` | Cancellation commits before an already dispatched upload reaches reservation; that upload observes abandonment. | 9 trace states |
| `m10-held-cancellation` | Reserve and dispatch R2, cancel while held, then finish R2 and attempt commit; abandonment remains canonical. | 12 trace states |
| `m10-lost-reply-recovery` | Commit, lose reply, restart, read and verify terminal status, retry exact original bytes, settle once. | 17 trace states |
| `m10-negative-null-clear` | Clearing the native flight on operation-null status violates retained-until-terminal safety. | 6 trace states |
| `m10-negative-cancel-sequence` | Omitting cancellation's device-sequence update violates terminal/sequence conservation. | 7 trace states |
| `m10-negative-old-reply` | Removing the exact-current-flight comparison from final settlement lets an already verified old capability clear a new flight. | 15 trace states |

The sequence mutant replaces a proposed delayed-reserve terminal-short-circuit
mutation. Merely removing that short circuit is not enough to revive a cancelled
operation: consumed sequence, stale predecessor/CAS and durable operation identity
provide additional defenses. Calling a stronger terminal-reopen mutation one
removed source guard would misstate the evidence. The delayed-reserve case is
instead a passing reachability control. The old-reply mutant removes only the
final local current-flight comparison; prior request/response validation remains.

The null-clear trace first violates the stronger retained-until-terminal contract
before an upload has been dispatched. It is not an executed late-upload loss
trace. The old-reply trace verifies both replies for cancelled flight 1, settles
one, durably creates flight 2 with sequence 2 and then incorrectly retires it
using flight 1's held capability. The server still has only flight 1's abandoned
terminal: the mutant cannot claim that flight 2 acquired terminal authority.

All eight cases were requalified with the explicit `frozenBatch` snapshot and
equality invariant. The final model SHA-256 is
`73609d07397de3deb52d2fdb0e67db9b41a0149b74e6f2adbcf508eda113d556`.
Development uses the pinned TLC 2.19/JRE toolchain on Darwin arm64, one worker, a 256 MiB
heap, a 30-second deadline per case and a 1 MiB output bound. No Linux runtime
qualification is inferred. Both safety runs exhausted their graphs; the six
invariant counterexamples stopped at their required violations. Their partial
state counts are not complete graph counts.

Complete graph counts, pinned model/configuration hashes and witness/action
traces are admitted by the shared runner after bounded development qualification.
Expected witness/negative invariant failures are evidence only when their exact
required mechanisms appear. Syntax errors, unrelated invariant failures,
truncated output, resource exhaustion or unfinished safety graphs do not pass.
