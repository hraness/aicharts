# Contribution rebuild evidence

[M11ContributionRebuild.tla](M11ContributionRebuild.tla) checks the private
diagnostic rebuild that reconstructs an account's canonical contribution index
from committed heads and compares it with the published projection. It keeps
the [M8 staged projection model](staged-projection-action-map.md) unchanged:
M8 owns ordinary revision application and publication, M11 owns the separate
job that reads committed heads, accumulates a private scratch index under the
shared immutable-byte quota and reports match or mismatch without touching the
published root.

This is bounded protocol evidence. It is not a proof that the JavaScript fold,
SQL schema, R2 objects or the BigInt arithmetic refine the model. M11
complements [M4](repaired-action-map.md), [M8](staged-projection-action-map.md)
and [M9](account-work-action-map.md); it does not replace their claims.

## Finite domains

One account and one generation own at most `JobCount` rebuild jobs. Every job
walks the same three committed heads, of which head 2 is deleted and charges
nothing, and the same two index cells. `Fold` gives the exact scratch contents
after each head; `Published` gives the published root, and `WrongPublished`
makes cell 2 disagree so that a comparison reaches `mismatch`. Immutable
objects are identity tokens; one token per live head per job. A charge is one
unit per live head, not production byte counts, and `Quota` is the shared
ceiling. Job versions run 0–7, one restart epoch exists, and every rebuild
request is one of begin, advance, abort or replay.

| Configuration | Domain and checked properties |
| --- | --- |
| `m11-single-safety` | `Sequential = FALSE`: one job with every fault and environment action (lost reservation reply, restart, failed right page, source advance, publication change, foreign source reservation, revoked authority, invalidated head evidence). 258,698 distinct states; checks `TypeOK` and `Safety` completely. |
| `m11-sequential-safety` | `Sequential = TRUE`, `JobCount = 2`, `Quota = 4`: two jobs in order, each begun only after the previous is inactive, sharing one cumulative charge. 221,596 distinct states; checks `TypeOK` and `Safety` completely. |
| `m11-nightly-sequential-safety` | The optional nightly profile widens the sequential domain to `JobCount = 3`, `Quota = 6` through numeric `CONSTANT` parameters. It must exceed the development state count and never replaces the development suite. |

`Sequential = FALSE` fixes `Jobs = {1}` so that the single-job graph enumerates
every fault interleaving; `Sequential = TRUE` disables the fault actions so
that the multi-job graph enumerates ordering and quota sharing. Neither
configuration models concurrent active jobs: `BeginJob` requires no active job,
and `Safety` requires at most one.

The model has no state constraint, symmetry reduction or fairness assumption.
`Quiescent` stutters an idle controller so that deliberately retained refusals
are not reported as deadlocks. Complete exploration establishes the listed
invariants over these finite domains only. Witnesses establish reachability.
Neither establishes eventual completion, a deadline, arbitrary head counts,
sixteen-item production envelopes or a TypeScript-to-TLA+ refinement theorem.

## Action and state correspondence

The mapping below is reviewed correspondence. The controller's workerd tests
and the M11 conformance schedule execute real SQL and immutable storage, but
they do not interpret the TLC trace as executable commands. One production RPC
covers several model actions.

| Model action or state | Production boundary and focused evidence |
| --- | --- |
| `BeginJob`, `job.revision`, `job.publication` | `ContributionRebuildState.begin` admits one job identity per account, refuses while another job is active or the retained inventory is full, requires the anchored source revision, complete publication and committed boundary, and writes version 1. A repeated begin for an existing job replays its begin receipt; a different expected revision conflicts. The M11 conformance schedule replays begin before, during and after the job. |
| `StartStep`, `CheckStep`, `Admitted`, `Anchor` | `execute` runs `retry`, `checked` and `assertPosition` inside the admission transaction. `#base` requires active enrollment, the same generation, the job's exact source revision and head count, no pending source operation, a caught-up projection and the same published root. Any drift refuses before SQL writes or object I/O. |
| `ReadCommittedHead`, `evidence` | `headChunk` reads the next committed heads in identity order and `resolveHead` re-derives every head, body, operation and population hash from the loaded batch. `InvalidateHeadEvidence` stands for a body that no longer verifies; the controller refuses with `legacy_unresolved` or `storage_invalid` rather than inventing a cell. |
| `ReserveStage`, `PendingExact`, `pending`, `charged`, `sharedCharge`, `reservations` | `reserveHeadStep` persists one deterministic pending descriptor before object I/O and charges its byte reservation once to the job and to the projection's shared `immutable_bytes` quota in the same SQL transaction. An existing pending descriptor must equal the recomputed plan exactly; a different plan conflicts. The `UnsafeQuota` mutant omits only the shared quota update. The ceiling is `CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES`, refused as `limit`. |
| `LoseReservationReply`, `Restart`, `epoch` | The durable descriptor, charges and provider effects survive an eviction; checked plans, proofs and held replies do not. The conformance schedule evicts the Durable Object between retries and requires the same receipt without a second charge; the integration fixture resumes the retained reservation after a lost reply. |
| `DispatchPut`, `ProviderReturns`, `VerifyStoredStage`, `DiscardProviderTail`, `objects` | `ensureContributionIndexStage` conditionally stores and verifies the stage; its `reserved` guard re-checks the exact pending descriptor before every put. A provider write may finish after abort or retirement; its result is discarded and no object is fabricated. Content-addressed stages equal to the published index add no object but remain charged. |
| `EmptyStageProof` | A deleted or empty head folds nothing, writes no object and proves an unchanged scratch root. |
| `PresentUnverifiedProof`, `CommitHead`, `UnsafeProof` | `commitHeadStep` requires the owned plan, an `isVerifiedContributionIndex` capability whose stage hash, byte count and root equal the pending descriptor, and the exact budget. Removing the capability check is the `m11-negative-proof` counterexample. Commit advances the version, clears the pending descriptor and moves to `comparing` after the last head. |
| `ReadLeftPage`, `ReadRightPage`, `FailRightPage`, `CommitComparison`, `compared`, `paired` | `planComparison` reads one scratch page and one published page of at most sixteen cells, compares them cell by cell and records the first difference. A failed page read leaves both cursors untouched, so the retry rescans the same prefix. `commitComparison` requires the owned plan (`comparisonPlans.has(plan)`), advances the version and records `match`, `mismatch` or `comparing`; the `UnsafeComparison` mutant admits an invented plan. |
| `AbortJob`, `heldAbort` | `abort` moves an active job to `aborted` at the next version. It neither refunds the retained charge nor deletes any object; a retained pending descriptor records possibly orphaned immutable writes. |
| `ReplayLast`, `DeliverHeldReply`, `RejectOlderVersion`, `lastExpected`, `receipt` | `retry` returns the retained receipt when the request repeats the last completed action at `expectedVersion + 1`; any other version conflicts and starts no work. `readContributionRebuild` is a pure SQL read. The M11 conformance schedule requires byte-identical receipts for repeated head and comparison steps, a conflict for older and future versions and unchanged storage images after each replay. |
| `AdvanceSource`, `ChangePublication`, `ReserveForeignSource`, `RevokeAuthority` | Source progress, a new publication, a pending canonical operation or lost enrollment authority each make `#base` refuse (`conflict`, `not_caught_up`, `not_enrolled`). The job stays retained for abort or read. |
| `RetireCall`, `ResetRefusal`, `Quiescent` | One 30-second deadline retires each RPC; late continuations cannot enter SQL or start another object operation. A refused invocation changes no durable state. |

## Reachability and negative controls

| Case | Required behavior |
| --- | --- |
| `m11-pending-recovery` | Lose the reservation reply, restart, recompute the same plan, resume the retained reservation, commit the head and replay the committed receipt purely. |
| `m11-late-abort` | Abort while a put is held, then let the provider return; the late result is rejected and the job stays aborted at cursor 0 with the object retained. |
| `m11-comparison-retry` | Complete three heads, fail the second right page, retry from the same prefix and reach `mismatch` at cell 2 against a wrong published root. |
| `m11-negative-quota` | Omitting the shared quota update must violate `Safety`. |
| `m11-negative-proof` | Committing a stage without the verified capability must violate `Safety`. |
| `m11-negative-comparison` | Committing an unowned comparison plan must violate `Safety`. |
| `m11-nightly-negative-quota` | The nightly three-job domain must still expose the quota mutant. |

Every witness requires its exact named `No…Witness` violation while `TypeOK`
and `Safety` remain intact, together with the listed action sequence. Every
guard mutant requires the exact `Safety` violation. Syntax errors, another
invariant failure, deadlock, timeout or incomplete exploration fail
qualification. The shared runner records the captured model/configuration
bytes, pinned tool identity, action trace and complete-state counts; the
repaired and nightly manifests own the expected counts.

M11 never modifies the published root, refunds a charge, deletes an object or
repairs a mismatch. Legacy head resolution, repair cutover, physical
reclamation, recovery after a whole-directory rollback and production
qualification remain separate obligations.
