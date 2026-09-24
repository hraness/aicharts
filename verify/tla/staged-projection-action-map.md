# Staged canonical projection evidence

[M8StagedProjection.tla](M8StagedProjection.tla) checks the separation between
applying a complete canonical revision and granting a queryable snapshot. It
keeps the existing [M7 legacy projection model](M7Projection.tla) unchanged.

The production controller can apply successive canonical revisions while a
publication waits for its interval or an older cursor to expire. A publication
uses the last complete applied root. It preserves the next revision's stage,
pending immutable reservation and charge, including during an awaited put.

## Finite domains

The initial root represents an already admitted, complete canonical prefix.
Revision numbers are relative to that prefix; modeled revision zero contains
data and does not represent the empty production account revision zero.
Corrections move one or two observations between two cohorts. Retracting every
old observation precedes adding any replacement observation.

| Configuration | Domain and checked properties |
| --- | --- |
| `m8-staged-safety` | One correction, two chunks in each phase, four possible charged steps. Checks all `TypeOK` and `Safety` states. |
| `m8-coalesced-safety` | Two corrections, one chunk in each phase, separate worker and publisher registrations. Includes coalescing, publication during the next put, retained references and expiry. |
| `m8-quota-safety` | The two-chunk domain with capacity for three charged steps. Refusal preserves the stage and published root. |

Each domain includes a single lost put acknowledgment, explicit settlement,
ordinary controller reconstruction, retry and close/drain ordering. One repeated
reservation is exposed per registered invocation; further identical retries do
not change the abstract state. Provider dispatch requires that invocation's
validated reservation, including after reconstruction. A settled invocation has
no future canonical callback.
`Restart` changes only a volatile-cache witness after settlement. It does not
model force-draining an execution that crashed while registered.

The time domain is 0–3, with a one-unit publication interval, a two-unit
retirement horizon and two retained references. These deliberately small
limits expose retention pressure. They do not quantify the production values
of 16,000 ms, 930,000 ms and 64 references. The runtime fixture separately
checks the production limit with a dense preexisting inventory. Charges are
one unit per immutable step, rather than production byte counts; object bytes,
hashes, source pages and SQL schemas remain separate checked boundaries.

The model has no state constraint, symmetry reduction or fairness assumption.
Successful complete exploration establishes the listed safety invariants over
these finite domains. The witness cases establish reachable behavior. They do
not establish eventual completion, a publication deadline, arbitrary revision
counts or a TypeScript-to-TLA+ refinement theorem. This distinction follows the
[TLA+ description of checking model properties](https://lamport.azurewebsites.net/tla/high-level-view.html).

## Action and state correspondence

The source mapping below is reviewed correspondence. The controller's workerd
tests execute real SQL and immutable storage boundaries, but they do not
interpret the TLC trace as executable commands. One controller invocation can
cover several model actions; fault injection exposes selected boundaries.

| Model action or state | Production boundary and focused evidence |
| --- | --- |
| `BeginRevision`, `stage`, `progress` | `ContributionProjectionState.begin` binds the exact verified next committed revision to `appliedRevision + 1`. `phase` and `cursor` represent the model's ordered progress. The chunked moving-correction test spans more than one 32-entry chunk per phase. |
| `AtProgress`, `CommitChunk` | `planContributionProjectionChunk` reads the exact touched cells, applies the verified retract/add chunk and stages the immutable index. `commit` checks the owned plan, exact pending intent, stage hash, root and byte count before moving the cursor. Copied capabilities and transaction rollback are covered by controller tests. |
| `Reserve`, `ReserveAgain`, `intentReady`, `charged`, `bytes` | `reserve` persists one deterministic step before object I/O and charges its exact immutable byte reservation once. A reconstructed invocation computes and validates its owned plan before it can resume the retained reservation. The lost-ack and rollback fixtures compare the retained charge after restart and exact retry. The capacity fixture verifies no `put` occurs when the byte ceiling is exhausted. |
| `DispatchPut`, `PutAndVerify`, `LosePutAcknowledgement`, `objects` | `ensureContributionIndexStage` conditionally stores and verifies the immutable stage. The lost-ack test lets the real put finish before rejecting its reply. Presence of an object supplies no publication grant. Object validation, hashes and namespace identity are assumed by the model and tested separately. |
| `SettleWorker`, `Restart` | The caller retains its execution registration until no later canonical continuation remains. The controller test reconstructs its state and resumes the same durable reservation. The real restore-registration protocol remains covered by M1 and its conformance evidence. |
| `ApplyRevision`, `applied`, `appliedRoot` | `ContributionProjectionState.apply` requires a complete add phase with no pending intent. The crash-before-publication test resumes using the applied root without another replay, read or charge. Intermediate applied revisions grant no query authority. |
| `Publish`, `published`, `references`, `roots` | `publish` grants the complete applied root in one SQL transaction, retires the previous grant and prunes expired metadata only. The more-than-64-revisions test independently folds accepted observations and verifies that the old snapshot remains unchanged. The held-put test publishes an earlier applied root without changing the successor's pending intent. |
| `AdvanceClock`, `LiveReferences`, `Authorized` | `status` computes interval and retention waits without mutation. `publication` requires the retained SQL reference and rejects it at the exact expiry boundary. The interval and 64-reference tests assert unchanged storage on waiting reads and expired queries. Immutable object existence cannot extend a cursor. |
| `RegisterWorker`, `RegisterPublisher`, `Close`, `Drain` | The enrollment caller and restore fence own execution registration. Close blocks new admission; existing registered continuations may finish before settlement. The model's distinct publisher can publish while the worker awaits I/O. Drain requires both registrations to settle. Controller tests that revoke an injected authority represent loss of usable execution authority, not close alone. |

The optional `beforeProgress` hook arms follow-up work before a durable
controller transition. Its two runtime cases reject failed arming or lost
authority after an awaited immutable put and retain the exact pending charge.
M8 does not model durable alarm scheduling, fair service between jobs or the
host's alarm-delivery semantics.

## Reachability and negative controls

| Case | Required behavior |
| --- | --- |
| `m8-staged-success` | Complete retraction, addition, application and publication. |
| `m8-staged-recovery` | Lose an actual put acknowledgment, settle, reconstruct, resume and finish the revision. |
| `m8-coalesced-publication` | Publish relative revision 2 without ever publishing relative revision 1. |
| `m8-retention-wait` | A complete applied root waits because all reference slots remain live. |
| `m8-retained-expiry` | A later publication prunes the expired oldest reference while retaining its immediate predecessor. |
| `m8-concurrent-publication` | Publish a completed root while the successor's put is waiting. |
| `m8-close-drain` | An already registered execution applies after close, settles, then permits drain. |
| `m8-capacity-refusal` | Refuse another reservation at the normalized byte limit before object dispatch. |
| `m8-negative-recharge` | Removing retry charge protection must violate `Safety`. |
| `m8-negative-partial-apply` | Applying a partial canonical revision must violate `Safety`. |
| `m8-negative-early-publish` | Bypassing the interval must violate `Safety`. |
| `m8-negative-early-drain` | Reporting drain with a live registered execution must violate `Safety`. |

Every positive witness requires the exact named `No…Witness` violation while
`TypeOK` and `Safety` remain intact. Every guard mutant requires the exact
`Safety` violation. Syntax errors, another invariant failure, deadlock, timeout
or incomplete exploration fail qualification. The shared runner records the
captured model/configuration bytes, pinned tool identity, action trace and
complete-state counts; its repaired manifest owns those expected counts.

M8 retains immutable objects and their charges after metadata expiry. There is
no object deletion, refund, storage compaction, account restoration or erasure
action. Those operations need separate reference and recovery evidence before
activation. Source authentication, full canonical-history validation, index
hash correctness, browser account binding and distributed provider durability
remain separate assurance obligations.
