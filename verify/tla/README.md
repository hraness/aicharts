# Baseline protocol models

Phase 2A makes six known failure mechanisms executable before the cloud repairs are accepted. The suite has three finite TLA+ modules, six expected safety violations, four complete sanity configurations and five reachable success/refusal/orphan witnesses. A successful runner result means those evidence expectations matched. It does not mean the faulty baseline is safe.

Run from the repository root:

```sh
bun scripts/assurance-tla.ts
bun test scripts/assurance-tla.test.ts
```

Use `--case m1-late-sql-after-publish` for one case. `--java`, `--jar` and `--output` accept explicit paths; changing the Java version or TLC artifact requires changing the reviewed pin. The default tools are task-local under `target/assurance-tools/`. The runner performs no download, provider call or product mutation. TLC needs its local JVM/RMI setup permitted by the host; a denied socket, timeout, syntax error or deadlock is a failed run.

## Claims and tool identity

[toolchain.json](toolchain.json) pins the official [TLC 1.7.4 release](https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4) by SHA-256 and records the upstream SHA-1. That release reports TLC 2.19. Its installed CLI supports `-tool`; it does not support the newer `-dumpTrace` option. The runner preserves the actual structured trace messages, including verbatim TLA+ values, in JSON. These values are not production-adapter commands.

The provisioned Temurin JRE is 21.0.12.1+1. Its archive checksum was verified when provisioned on macOS/aarch64. Each run checks the reported runtime version, captures the launcher checksum before/after execution and records the observed host. The provisioning archive digest is recorded; the runner does not measure every installed JRE library. The JVM, TLC implementation, standard modules, filesystem and host remain trusted environmental boundaries. A Java override with the same version is not automatically an attestation of identical JRE libraries or platform qualification.

Every case uses one TLC worker, a 256 MiB Java heap, a 64 MiB direct-memory ceiling, a 30-second deadline and a 1 MiB output ceiling. There are at most 100,000 accepted distinct states and at most 100,000 elements in an enumerated set. These are model-run limits, not production capacities. The complete suite has at most 15 sequential cases, each with its own deadline. A resource limit never becomes a successful sanity result.

The runner snapshots each unique module/configuration before starting, stages those exact bytes and the checksum-checked JAR in a fresh run directory, and checks staged bytes after use. Receipts bind module/configuration/runner hashes, complete-state counts, tool identity, exact argv, exit status and logs. Four sanity counts are frozen in [cases.json](cases.json): M1 2,751; M4 disjoint structure 8; M4 proven overlap 8; M4 supersession 23. Changes to these counts require review. Only those listed invariants are checked. Baseline safety cases terminate on the first violation; their queue may be empty or nonempty. An empty queue alone never establishes successful exploration.

All configurations enable deadlock checking and use no state/action constraint, symmetry or view reduction. Explicit terminal stuttering is allowed only after the modeled work/recovery has completed. Reachability controls intentionally violate `No...Witness` invariants to establish that ordinary commits, retries, capacity refusal and harmless late orphan completion can occur. They are existential witnesses, not eventual-progress proofs. Focused negative tests reject a wrong invariant, a green run substituted for an expected failure, incomplete exploration, malformed/truncated tool output, missing mechanism steps, count drift and resource termination.

## M1: restore effects and lease settlement

[M1Restore.tla](M1Restore.tla) has two operation identities, one account/operator, epochs 0 and 1, a clock in 0..2, a common lease deadline of 1, one recovery and one unfenced maintenance effect. Operation stages distinguish provider dispatch, provider completion, a possible canonical SQL continuation, committed state, a detached provider tail and settlement. `leases` models registered holders; it deliberately differs from the operations that can still commit. `publications` models canonical authority/visibility, while `objects` models immutable provider bytes. This is a small failure abstraction, not a full provider protocol or persistent SQL representation.

| Configuration | Required mechanism |
| --- | --- |
| `m1-expired-live-lease` | Acquire, advance past TTL, expire registration, close, report drained while a holder can still commit. Violates `DrainIsQuiescent`. |
| `m1-late-sql-after-publish` | The old holder obtains immutable bytes; expiry permits close/drain/restore/new epoch publication; the old SQL continuation then commits. Violates `NoPostRestoreSQLCommit`. |
| `m1-unfenced-persistent-effect` | Close, start an unregistered maintenance path, persist a write. Violates `NoUnfencedPersistentEffect`. |
| `m1-structural-sanity` | Exhaustively checks declared types and that published/orphan objects are retained and disjoint. It does not check the three violated safety properties. |
| `m1-healthy-settlement-witness` | Acquire, provider completion, canonical commit, release. |
| `m1-permitted-orphan-witness` | Irreversibly remove canonical continuations, durably settle, close/drain/restore/publish, then allow the old immutable write to finish without publication. |

The last witness's `SettleWithoutContinuation` is an explicit environmental contract. There is no claim that the baseline exposes an API capable of doing it. It cannot stand for a deadline, an abandoned promise, an operator checkbox or a best-effort cancellation. Orphans remain unreferenced and charged; this model has no reclamation action. Later GC must prove terminal disposition, closed references and the retention conditions in [retention.json](../assurance/retention.json).

The baseline M1 source correspondence is **source-mechanism mapping only**. No F03/F04 failure schedule has been executed against a real fence Durable Object. The hashes and exact baseline commit are in [source-provenance.json](source-provenance.json). The source locations below refer to that baseline, not a future edited working tree.

| Model action/state | Baseline production boundary and abstraction |
| --- | --- |
| `Acquire`, `leases`, `capturedEpoch` | [restore-fence.ts](../../services/usage-worker/src/restore-fence.ts), `assertOpen/#grant` (182–221), grants registration and captured epoch. [enrollment.ts](../../services/usage-worker/src/enrollment.ts), `#fenceAcquire` (434–463), obtains the reply. The model combines durable grant and holder knowledge atomically. |
| `AdvanceClock`, `Expire` | `RestoreFence.#transaction/#expireLeases` (138–142, 159–160) removes expired registrations; no action terminates the owning continuation. Clock ticks and the diagnostic deadline abstract real elapsed time. |
| `Dispatch`, `ProviderReturns`, `objects` | [stats-admission.ts](../../services/usage-worker/src/stats-admission.ts), `admit` (91–105), awaits immutable snapshot/receipt operations before canonical publish. Request bytes and multiple provider writes are collapsed into one immutable object. |
| `SQLCommit`, `publications` | `Enrollment.#transaction` (355–389) checks a captured observation/local epoch; `StatsState.publish` (382–404) changes canonical projections/control. A stale continuation is modeled independently of immutable byte presence. |
| `Release`, `settledGood` | `RestoreFence.release` (227–245), `Enrollment.#fenceSettle` (466–476). Only the modeled operation with no remaining canonical continuation settles. |
| `Close`, `ObserveDrain`, `Restore`, `PublishEpoch` | `RestoreFence.close/publish` (254–291) closes admission, observes registration count and publishes a higher epoch. `Restore` is the operator's restoration of account/store state between those calls, not a baseline RPC. |
| `StartUnfencedMaintenance`, `UnfencedPersistentWrite` | Enrollment constructor migrations (211–235), pre-lease `#auditHistory` (438), status transactions (875–913), and [admission-state.ts](../../services/usage-worker/src/admission-state.ts) checkpoint writes (303–304). One representative durable effect abstracts this class; it does not establish exhaustive path coverage. |
| `SettleWithoutContinuation`, `LateImmutableOrphan`, `orphans` | Environmental contract above. A completed conditional old-epoch object may exist after publication only without any possible canonical continuation/reference. |
| `Terminal` and ghost safety/witness flags | Model-only history observations and quiescent stuttering; no production fields or behavioral equality are claimed. |

### Frozen M1 repair obligations

1. Close atomically prevents new registration. Existing registered epoch holders may finish; close by itself does not invalidate their already-admitted work.
2. Keep each holder registered until all future canonical SQL, authority and visibility continuations are irreversibly impossible and settlement is durable/idempotent. TTL, heartbeat loss, caller timeout and lost replies do not establish drain. A remote `assertOpen` followed by a separate unregistered SQL write does not serialize close against commit.
3. Make grant acquisition idempotent under a stable operation identity, with authoritative readback/reconciliation. A durably created random token whose RPC reply is lost otherwise strands an unknown holder. Model grant/reply loss, release-reply loss, restart and recovery explicitly in Phase 2B; the present atomic `Acquire` does not prove those cases.
4. Keep restore/publication closed until every old canonical effect is settled. A crashed/hung holder needs proof of exact-execution termination or a cancellation fence checked at every possible effect. If that evidence cannot be obtained, remain closed and report the recovery limitation.
5. Bind committed revision, source scope, ownership generation, snapshot/body hash and terminal outcome atomically with canonical publication. Neither immutable object nor receipt existence alone proves commitment. A late conditional immutable tail can be allowed only when it cannot publish; retain its charge/reachability evidence until qualified reclamation.
6. Classify status, constructors, audit/checkpoint, migration, backfill and public/private read paths. Required maintenance has an explicit fenced mutation owner. Ordinary reads issue no persistent DML.

Safety checks assume atomic modeled SQL/registry transitions and arbitrary ordering/delay of enabled actions, with no fairness. Liveness is not checked. A future liveness statement requires eventual provider/storage availability, finite interference and actual holder settlement/reconciliation; no claim of progress through permanently hung holders follows here. Epoch spaces, provider faults, credential revocation, schema states, lost grant responses and multiple recoveries are intentionally incomplete until Phase 2B.

## M4: populations and supersession

[M4Contributions.tla](M4Contributions.tla) separates retained canonical history from a read projection. In the failing case a foreign device has a 120-token occurrence, and a detailed payload contains a disjoint 15-token local occurrence. The baseline projection hides the foreign occurrence even though it remains stored. `ForeignPopulationPreserved` fails after reserve/freeze/publish/read: the correct population totals 135, while the visible population totals 15.

`ProvenOverlap=TRUE` is a different payload: the detailed snapshot reports the **same occurrence and all 120 tokens**. Its population and token payload are declared separately and checked by `SnapshotPayloadMatches`. It is a positive control for valid overlap, not evidence that 15 tokens can replace 120, nor a method of inferring overlap from equal totals or device identity. Disjoint structure and proven overlap each exhaust eight states. A separate read/retry witness checks reachable nontrivial behavior.

[M4Supersession.tla](M4Supersession.tla) fixes one source/device/predecessor/sequence and two operation identities A and B, with at most three reservations. `superseded` is ghost history recording the required terminal decision absent from baseline SQL. The model deliberately explores the bounded A→B→A scenario, ordinary completion, same-current-intent retry and capacity refusal. It is not an exhaustive model of every device/source/migration combination.

Both `SupersededCannotReturn` and `ChargeEachIntentOnce` fail at the third reservation. Charge units are normalized per retained snapshot intent: A/B/A has three charges for two identities. Supersession clears retry evidence, so the healthy retry witness refers to the same intent that freezes and publishes. The structural sanity checks types and frozen-before-commit over 23 states; those properties do not repair the ABA failures.

This M4 subset supersedes only unfrozen intents. The baseline `AccountStats.admit` and `StatsState.supersedePending` can also replace a different same-device pending body after its receipt is frozen. That behavior is not checked here and must be included in Phase 2B. The model's restricted `Supersede` action does not give v2 the declared v1 freeze/revocation semantics.

| Model action/state | Baseline production boundary and evidence |
| --- | --- |
| `SeedForeignLegacy`, `legacyStored` | [cloud baseline corpus](../../fixtures/usage/assurance/cloud/baseline.json), F02 and its explicitly disjoint identities; [baseline runner](../../scripts/assurance-cloud-baseline.ts), `seedLegacy/probeOwnership`. |
| `ReserveDetailed`, `FreezeDetailed`, `PublishDetailed`, `snapshotTokens` | [stats-state.ts](../../services/usage-worker/src/stats-state.ts), `reserve/freeze/publish` (355–404), and the incoming report's source-scoped population. |
| `ReadProjection`, `visible` | `StatsState.read` (432–480), client/day ownership filters hide legacy rows. F02 executed 120+15 becoming visible 15 while legacy storage retains 120. |
| `ReserveFirstA`, `ReserveB`, `ReplayA`, `charges` | `StatsState.reserve` (355–369) charges bytes+1,024; [stats-admission.ts](../../services/usage-worker/src/stats-admission.ts) `admit` (72–87) chooses reserve after same-device pending replacement. |
| `Supersede`, `superseded`, `lastSuperseded` | `StatsState.supersedePending` (240–242) deletes pending state without a durable supersession generation; ghost history states the missing obligation. |
| `Freeze`, `Publish`, `RetrySame` | `StatsState.freeze/publish` and `AccountStats.admit/locate`; exact pending retry avoids another reservation, and terminal reply checks identity. Model retries abstract successful exact identity checks, not network/auth transport. |
| `RefuseAtCapacity`, `capacityRefused` | `reserve` immutable-byte refusal, abstracted to three charge units. The witness proves an enabled bounded refusal, not usable product recovery from lifetime exhaustion. |
| `Terminal` and witness flags | Model-only complete-work stuttering and non-vacuity observations. |

F02 and F11 production-state methods were executed in Phase 0 against the fingerprinted baseline with synthetic SQLite. Their network schedules remain source-traced; this phase adds no workerd, authentication, provider or browser qualification. Preserved source bundles and counterexamples are separate from these abstract TLC traces. Generated production action/fault schedules, per-action/outcome coverage, abstraction comparisons and a production-only mutant remain Phase 2B obligations.

### Frozen M4 repair obligations

As of 24 September 2026 the implementation partitions snapshot days by device
(see `kb/plans/system-assurance-and-usage-analytics.md`, implementation log).
The writer-transfer actions modelled below are retained as historical
evidence of the earlier design; the worker conformance traces `M4-devices`
and `M4-overlap` now exercise device partitions and same-device shadowing.

- Ownership/replacement belongs to an immutable source scope with proved overlap and interval coverage. Preserve every foreign contribution. Shared client names, dates, totals or same/different device IDs cannot establish overlap. Account-authorized writer transfer preserves committed history and fences the old generation.
- Supersession is a durable terminal decision/generation change. Delayed A cannot regain its old authority after B, and the same retained intent cannot be charged twice. Every callback/readback uses the exact operation identity, predecessor and generation.
- Publish only through the authoritative committed-publication record. Preserve v1's declared revocation boundary: revocation before freeze rejects, while an already-frozen terminal decision remains reconcilable. A revoked v2 writer cannot newly publish; its authorized successor needs a real transition.
- M1 settlement protects all of these canonical effects. Independently safe fragments do not establish their join. Phase 2B must check joined recovery/ownership/commit behavior and correspondence after Phase 1B implements it.

The baseline modules, properties and fixtures remain historical negative controls when repaired models are added. Do not weaken their invariants, silently reinterpret a sanity run as whole-system safety, or accept a timed-out exploration as complete.
