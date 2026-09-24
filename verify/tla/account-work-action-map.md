# Account maintenance scheduling evidence

[M9AccountWork.tla](M9AccountWork.tla) checks bounded scheduling histories for
the account-owned consent and canonical-projection work classes. Its state
separates the current work position, a persisted flight identity, a live local
callback, the single durable alarm wake and external restore custody. These
objects have different lifetimes. In particular, an actual provider result may
settle while a failed outcome write leaves a persisted flight requiring repair.

M9 complements [M8](staged-projection-action-map.md), which checks staged
projection and publication. It does not replace the restore-fence model or
prove that the TypeScript implementation refines this specification.

## Finite domains and atomic boundaries

| Complete configuration | Domain | Complete distinct states |
| --- | --- | ---: |
| `m9-held-safety` | Two work classes; consent has one position and projection has two. The first handler owns one job from each class, and the second owns the next projection job. All provider outcomes in this slice succeed; their ordering and settlement timing vary. | 637 |
| `m9-recovery-safety` | Both classes remain represented, with consent initially idle. Two projection executions share one work position. Includes a failed provider outcome, one restart, one explicit resume, a failed completion arm and replay of an old owned capability. | 921 |

These are two explicitly selected finite histories, not all ways of assigning
work to handlers. Each has at most two handler registrations and two attempts
at a position. Flight IDs are unique job IDs within that finite domain. They
represent the independently versioned production flight identity, not its
numeric encoding. A projection can advance its work position while retaining
the original flight ID. The watchdog can change flight status without changing
that ID. Explicit resume clears it; a replacement receives a distinct ID even
when its work key and attempt number repeat.

The time abstraction is `running` followed by a due watchdog and then
`awaiting`. It does not reproduce millisecond arithmetic. There is one Boolean
durable wake rather than a multiset of alarms. A handler consumes that wake;
claimed work creates a future wake; one watchdog consumes its deadline and
leaves an unresolved flight without repeated empty polling. Another runnable
class or future watchdog preserves the single wake.

`ClaimJobs`, `CommitProjection`, `CompleteJob` and `ExplicitResume` represent a
successful checked alarm arm followed by its synchronous durable transition.
The model treats that final no-external-await segment as one atomic action.
It does not model the internal asynchronous `getAlarm`/`setAlarm` queue, provider
input gates or every interruption inside alarm arming. Their ordering and
authority checks require the separate `AccountAlarm` and Worker regressions.
`FailCompletionArm` exposes the critical failure before completion: after the
watchdog consumes the last wake, failed arming cannot clear the persisted flight.

`Restart` requires a real pending provider call. It loses local callback
reachability while retaining the flight, wake and external holder. A subsequent
`LostProviderReturns` ends the remote effect but cannot manufacture a local
settlement acknowledgment. Those abandoned holders remain unresolved in this
model; there is no force-drain or operator reconciliation action.

`ReplayOldCapability` is a deliberate duplicate invocation of the state
helper's capability boundary after `FailCompletionArm` and explicit resume.
The original provider and callback have already settled. It does not resurrect
callbacks after `Restart`, bypass the outer account authority, or model a
publicly callable retry route. Production additionally requires a genuinely
owned attempt object and the checked account transaction.

There are no state constraints, symmetry reductions or fairness assumptions.
`Quiescent` permits a handler-free state to remain unchanged, including when the
finite registration budget is exhausted or explicit repair is required. Thus
the deadlock check is not evidence of eventual work service. The two safety
cases explore their complete reachable graphs; witnesses establish reachable
behavior. None establishes an unbounded liveness theorem, wall-clock service
deadline, arbitrary retry budget or runtime-code proof.

## State and action correspondence

| Model boundary | Production correspondence and focused evidence |
| --- | --- |
| `position`, `capturedKey`, `flight` | `accountProjectionWork` hashes the actual apply/publish/stage position; source appends alone do not renew its budget. `AccountWorkState.claim` gives its attempt an independent flight version. Normal `reconcile` preserves that flight across position changes. State-helper tests exercise watchdog and position changes followed by late completion. |
| `StartHandler`, `ClaimJobs`, `Dispatch` | `AccountEnrollment.#accountWorkAlarm` acquires restore registration, arms before claiming, persists each flight and installs its process marker before provider work starts. Every production claim creates a durable flight. Explicit foreground projection uses the same flight/marker mechanism, with conflict checks after acquisition and arming. The model abstracts the handler wrapper; it does not enumerate the foreground-acquisition race. |
| `CommitProjection` | The projection controller's `beforeProgress` hook arms before durable progress. The current position changes while the dispatch's original flight and lease remain. Controller and integration tests inject an arm failure after awaited immutable I/O and check retained state. Numeric application, immutable objects and publication correctness remain M8/runtime obligations. |
| `YieldHandler`, `handlerDone`, `leases` | The bounded dispatch timer ends only the alarm handler. The shared settlement promise waits for every actual class continuation and the handler before calling `#fenceSettle`. A held consent call therefore retains the first holder while a later handler finishes another projection position. |
| `ProviderReturns`, `ProviderFails`, `CompleteJob` | `#runAccountWork` collects an outcome, arms again, then enters the checked transaction calling `AccountWorkState.complete`. Completion compares the original flight capability, clears only that flight and cannot acknowledge a newer work position. Each class clears its local marker and rearms independently of the other class. |
| `Tick`, `Watchdog`, `flightState` | `AccountWorkState.watch` makes one durable `awaiting_settlement` transition. `accountWorkRecordDeadline` chooses the flight watchdog while a flight exists, and no deadline for an awaiting flight. The held-consent integration test reaches both complete projection/publication progress and an idle alarm with the unresolved consent visible. |
| `FailCompletionArm` | The late-completion arm-failure regression consumes the watchdog, settles the held provider, fails the completion arm, and preserves the awaiting record. Actual provider settlement still permits external holder release. A persisted flight is therefore not a count of currently running provider calls. |
| `Restart`, `LostProviderReturns` | Constructor/status paths do not clear or rearm unresolved authority. Persisted flight tests recreate the helper/object, consume one watchdog and refuse automatic redispatch. The model additionally retains abandoned external registration; provider completion alone does not release it. Restore recovery remains separately governed. |
| `ExplicitResume`, `ReplayOldCapability` | Trusted maintenance may reconcile an unresolved flight when no process-live marker exists. `complete` checks the original flight version, key and attempt. The same-position resume tests reject both stale success and stale failure. The mutant checks the key/attempt ABA failure after a failed completion arm. |
| `Close`, `ReleaseLease`, `Drain` | Close refuses new handler/watchdog authority but permits already registered continuations to finish. Settlement requires all owned class callbacks and the handler to finish. The held-consent runtime test observes one outstanding holder at close, refused publish while held, and drain after actual late completion. |

The model assumes authenticated account/generation authority, valid persisted
records, successful atomic SQL transactions and correct provider reply parsing.
It does not model hashes, clocks/regression checks, schema migration, eight-attempt
retry exhaustion, backoff, direct consent compensation, publication retention,
alarm queue capacity, lost storage acknowledgments or remote-provider correctness.
Those boundaries retain their own source checks and focused runtime evidence.
Read purity is tested by actual SELECT-only/no-alarm fixtures, not inferred from
the absence of a mutating read action here.

## Witnesses and negative controls

| Case | Required mechanism | Trace states in the checked development run |
| --- | --- | ---: |
| `m9-independent-progress` | Two projection jobs complete while consent's first provider call stays pending and its shared holder remains live. | 15 |
| `m9-watchdog-stall` | Projection catches up; the held consent consumes its one watchdog and leaves no empty alarm polling. | 18 |
| `m9-late-settlement` | Consent completes after its watchdog; both handler registrations settle before close/drain completes. | 24 |
| `m9-restart-resume` | A pending call loses its local continuation, then finishes remotely; the durable flight requires explicit resume, while the old external holder remains unresolved. | 15 |
| `m9-completion-arm-refusal` | Actual provider settlement followed by a failed pre-completion arm preserves an awaiting flight even after the external holder safely releases. | 10 |
| `m9-negative-early-release` | Removing the actual-jobs-finished guard releases the shared holder after handler yield while provider calls remain live. | 7 |
| `m9-negative-missing-arm` | Removing the pre-completion arm clears the post-watchdog flight and strands eligible work without a wake. | 9 |
| `m9-negative-stale-aba` | Replacing flight identity with repeated key/attempt matching lets an old capability clear the replacement flight. | 13 |

Positive witnesses require their exact named `No…Witness` violation while
`TypeOK` and `Safety` hold. Guard mutants require `Safety` to fail through the
specified action sequence. Syntax errors, unrelated invariant failures,
resource limits and incomplete safety graphs do not qualify. Development used
the pinned TLC/JRE with one worker, a 256 MiB heap, 30-second per-case timeout and
the existing 100,000-state admission ceiling. The shared runner owns official
manifest admission, expected complete-state counts and captured-byte receipts.
