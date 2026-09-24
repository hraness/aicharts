# Repaired protocol evidence and implementation mapping

`repaired-cases.json` adds twelve safety configurations, 36 reachability
controls and seven deliberately broken guards. The
[M8 action map](staged-projection-action-map.md) records the staged index,
coalesced publication, recovery and retained-cursor abstractions. The
[M9 action map](account-work-action-map.md) records independent work-class
progress, durable watchdogs, late completion and restore custody. Each safety
configuration checks `TypeOK` and `Safety`, enables
deadlock detection, uses one TLC worker with the pinned toolchain, and explores
the entire declared finite reachable graph. Witness configurations add an
intentionally false `No…Witness` invariant: only its exact counterexample is a
successful witness result. An unrelated failure or incomplete exploration fails
the case. The baseline modules, fifteen baseline configurations and historical
counterexamples are unchanged.

These models describe selected repaired boundaries. Their state is an
abstraction, not a duplicate SQL schema. One completed production command can
correspond to several internal model actions; injected pauses expose additional
boundaries. The conformance adapters compare after every generated command and
selected injected boundary, not after every JavaScript instruction. No general
Rust/TypeScript-to-TLA+ refinement theorem is claimed.

## M1: restore registration and continuation custody

Two attempt identities, two execution kinds, diagnostic clock values 0/1, and
epochs 0/1 are explored. `disposition` maps durable `fence_attempt.terminal` and
`fence_lease` presence; attempt identity maps exactly to the acquiring execution's
stable random ID. `known` is caller possession of a usable reply. `stage`,
`captured`, `kind` and the canonical/immutable distinction are reviewed caller
continuation abstractions; they cannot be inferred from a lease count alone.

| Model actions | Production boundary and evidence |
| --- | --- |
| `Grant`, `ReadGrant` | `RestoreFence.assertOpen`; grant persistence precedes a response. The same attempt is reconciled after lost reply or close. M1 generated schedules check live rows after each RPC. |
| `CancelBeforeWork` | `cancelAcquire`; terminal registration before any canonical work prevents a reordered grant. The `M1-cancel` group checks pre-grant and granted cases, idempotency and conflicting committed release. |
| `Dispatch`, `ProviderReturns`, `CanonicalCommit` | Registered AccountEnrollment SQL/provider continuations, including account maintenance, consent publication/compensation and the fixed namespace anchor. M3/M6 adapters expose real immutable/source waits; Phase 1B enrollment tests retain the actual canonical namespace put through its outward deadline. |
| `TerminalTimeout`, `LateOrphan` | Admission/stats conditional immutable writes may outlive a terminal returned failure only when no callback can later publish SQL or visibility. The reserved charge remains. The real elapsed stats timeout regression closes/publishes then resolves the exact orphan and checks unchanged SQL. Fixed namespace anchors cannot take this branch. |
| `Release` | `release` and caller settlement; exact terminal disposition survives lost replies. Release is enabled only before dispatch or after canonical continuations are impossible. A hung/crashed real holder remains registered. |
| `AdvanceClock`, `Close`, `RefusePublish`, `PublishEpoch` | Diagnostic deadlines do not delete holders. Close refuses fresh admission, and publish requires actual drain. The generated M1 replay includes the old expiry/drain counterexample prefix and checks refusal before both executions settle. |
| `Terminal` | Quiescent completed recovery, with no canonical continuation or unresolved modeled immutable tail. |

Safety checks live custody of every modeled canonical continuation, no old-epoch
canonical effect, object/charge correspondence and no published orphan. The
recovery witness requires a refused publish followed by a successful committed
execution, release and epoch advance. The orphan witness specifically resolves
after publication. These are narrower than force-drain, crash termination or
external restore correctness: no such operation is implemented or qualified.

## M2: local ledger, source checkpoints and frozen outbox

Two source/occurrence pairs each advance through levels 0/1/2. This partition
tests independent sources; it does not assert associativity of conflicting
occurrence revisions. `facts` maps retained frame values, `cursor` maps complete
prefix/stamp bytes, `acked` maps accepted frames and `frozen` maps exact batch
members. Control revision counts scan, freeze and settlement transactions.

| Model actions | Production boundary and evidence |
| --- | --- |
| `CommitScan` | `Ledger.commit_prefix_scans`; source stamp, completed prefix, canonical facts and outbox update atomically. The actual SQLite adapter checks frames, prefix bytes, revision and totals after each generated commit. |
| `RefuseIncompleteScan` | The chosen adapter representative is an oversized source stamp refused without advancing facts or cursor. Parser-specific partial-line and source-cutoff refusal remains in the native ingestion regressions; the ledger API trusts its caller's complete-prefix evidence. |
| `Freeze`, `ExactRetry` | `freeze_upload_batch`; exact canonical bytes and selection survive reversed caller ordering and generated retry counts. |
| `SettleExactReceipt` | `settle_upload_batch`; exact old receipts acknowledge their frozen version and retain newer outbox records. Invalid receipt bytes are an unchanged-state refusal. A later current receipt clears exactly the selected records; exact terminal replay is idempotent. |
| `Reopen`, `Terminal` | Fresh `Ledger.open_with_identity` plus `ReadOnlyLedger` inspection after old acknowledgment; quiescent fully settled state. |

Synthetic receipt construction does not authenticate a server. Historical
numeric/owner quarantine, arbitrary merge histories and actual filesystem crash
durability retain their separate Phase 1A/runtime evidence.

## M3: immutable admission and terminal publication

Two devices each propose one distinct value for one initially absent occurrence,
with expected predecessor zero. Account revision is bounded by two terminal
decisions. An accepted head has the same owner as the last accepted journal
decision; rejection does not replace it.

| Model actions | Production boundary and evidence |
| --- | --- |
| `Reserve` | `AccountAdmission.admit` and `AdmissionState.reserve`; durable pending identity before provider work. |
| `PutImmutable`, `FreezeDecision` | Actual conditional STAGING batch object, then `AdmissionState.freeze`. Revocation and predecessor decisions bind only at freeze; the model preserves this order. |
| `PutJournal`, `Publish` | Exact CONTROL journal followed by atomic `AdmissionState.publish`: account revision, heads, device sequence and retained journal advance together. |
| `Revoke` | Account device revocation during an in-flight request; existing admission regression covers both sides of decision freeze. |
| `ReplayTerminal`, `Terminal` | Exact completed batch returns its retained terminal journal without another sequence, revision or immutable object. |

The generated M3 adapter injects a lost STAGING or CONTROL reply after the real
put, reopens, resumes, retries, then exercises cross-device predecessor conflict
and invalid-secret refusal. It compares pending phase, journal outcomes, head,
device sequences and both object counts after each command. Multi-operation
atomic rejection, tombstones, helper takeover and sequence exhaustion remain
required adjacent admission regressions, not a claim that this two-request model
has quantified all those domains.

## M4: ambiguous overlap, abandonment and writer recovery

Two snapshot bodies, one predecessor/successor writer pair and revisions 0–2
are modeled. The old legacy amount remains visible because an ambiguous overlap
is refused. This is the safe intermediate contract, not exact population merge.

| Model actions | Production boundary and evidence |
| --- | --- |
| `Reserve`, `RefuseSupersede` | `StatsState.reserve` and `AccountStats.admit`; a second body cannot silently replace retained pending authority. The adapter verifies the exact byte reservation and pending hash. |
| `Abandon`, `Commit` | `abandonStatsSnapshot` advances the predecessor revision; subsequent B commits and delayed A cannot reserve, recharge or publish. A/B replay order and quantities vary by seed. |
| `RefuseAmbiguousOverlap` | `StatsState.check` refuses unproved legacy takeover. `M4-overlap` retains a different device's actual V1 amount and verifies that all V2 retries leave it visible and uncharged. |
| `RevokePredecessor`, `TransferWriter`, `RefusePredecessorReplacement` | Trusted `recoverStatsWriter` requires a revoked predecessor, advances writer authority and preserves predecessor day-source rows. Its successor cannot replace those days; stale predecessor uploads refuse. |
| `Terminal` | No pending body and either exhausted local revision bound or completed transfer. |

Phase 5 must extend this model with exact source population proof, overlapping
V1/V2 deduplication, copied-ledger identity and replacement coverage. Existing
schema-corruption fixtures separately refuse missing current provenance instead
of deriving it from the successor writer.

## M5: pairing and browser response identity

Two accounts, two sealed attempts and two account-generation changes are
modeled. Fresh authentication recorded for the exact current attempt is itself
the atomic browser approval. A new attempt can replace only a pending attempt.

| Model actions | Production boundary and evidence |
| --- | --- |
| `NewAttempt`, `Authenticate` | `beginBrowserAttempt`, then `recordVerifiedAuthentication`; the latter commits authentication plus browser-approved account in one transaction. The adapter rejects stale old authentication and replacement after approval. |
| `ApprovalReadback`, `Confirm`, `RefuseForeignDecision` | Internal exact live approval readback, terminal same-account confirmation and foreign-account refusal. Reservation is additionally checked after terminal confirmation. |
| `StartRead`, `AcceptRead` | Capture account generation before dispatch; bind response account to the same authenticated response; only a current ticket/scope can be accepted. First identity adoption requires a fresh read. |
| `SwitchAccount`, `RefuseLateRead`, `Expire` | Generation invalidation and caller lifetime closure; generated browser-contract schedules test old A replies after B adoption, signout and delayed authenticated negative replies. Pairing expiry is checked separately by existing runtime fixtures. |
| `Terminal` | Closed lifetime/expiry; no private visible scope. |

The model's `Expire` combines a closed response lifetime with expired pairing
authority for the selected safety claim. It is not an implementation of the
OAuth provider, clock synchronization, React rendering or automatic session
refresh. Source SDK identity/signature validation and actual browser tests remain
separate required evidence.

## M6: source-confirmed consent delivery

One member's decisions 0/1/2 mean absent/grant/withdraw, with one delayed delivery
and an independently completing current refresh. The adapter uses two accounts
to exercise account-specific index stamps during interleaving. A cached member
can temporarily lag the source: instantaneous withdrawal visibility is not the
invariant. A delivered withdrawal must defeat every older grant.

| Model actions | Production boundary and evidence |
| --- | --- |
| `GrantConsent`, `WithdrawConsent` | `AccountEnrollment.setLeaderboardConsent`; durable source decision and decision time. |
| `DispatchHint`, `SourceReply` | `LeaderboardIndex.applyConsent` retains its own execution registration and re-reads `readLeaderboardDelivery`. A caller's v1 timestamp is only a hint, never restored-epoch authority. |
| `ApplyDelivery`, `RefuseStaleDelivery` | Exact source decision and account stamp guard the final index transaction. The adapter pauses a real old source reply, completes withdrawal, then checks late continuation and stale hint retries. |
| `RefreshCurrent` | A separately registered alarm/current withdrawal wins while a prior source await is suspended; projection/decision publication uses its authoritative source snapshot. |
| `Terminal` | Withdrawn current index with no pending delivery. |

Safety checks decision ordering and tombstone exclusion. The adapter checks
members/tombstones after every step, live registration during the await and
settlement afterward, plus unchanged storage on public read. Existing alarm
regressions cover delayed clocks and skipping closed accounts across the actual
eight-refresh bound. Phase 10 owns full public freshness/withdrawal deadlines,
deletion, backups, erasure and tombstone-retention horizons.

## M7: pure reads, explicit rebuild and full scrub

Legacy/current schemas 7/8, two canonical revisions and one coherent projection
are modeled. The test adapter uses the current exact schema and real exploded
day projection; it compares authority and ownership across missing derived rows,
fresh instance reconstruction, pure fallback reads and explicit rebuilding.

| Model actions | Production boundary and evidence |
| --- | --- |
| `Read` | Read-only constructors and private report queries; no schema creation, audit checkpoint or backfill publication. The adapter snapshots SQL before/after every read. |
| `RegisterMaintenance`, `Prepare`, `Release` | `maintainAccount` acquires a registration, performs guarded preparation/audit/backfill and settles. Exact pre-transfer schema permits initial provenance migration; current missing authority does not. |
| `CommitCorrection` | Stats canonical and exploded day revisions publish in the same SQL transaction. This finite model contains no staged multi-transaction publication. |
| `CorruptDerived`, `CorruptAuthority` | Explicit synthetic fault injection, never product operations. Derived absence permits pure fallback; retained authoritative corruption must not be accepted by full scrub. |
| `ScrubRefuses` | `maintainAccount(operation: scrub)` explicitly calls from-zero history verification, bypassing the cached audit stamp. Generated schedules first establish the stamp, corrupt an older journal, observe checkpoint-extension behavior, then require scrub refusal. |
| `Close`, `RefuseClosedMaintenance`, `Terminal` | External close blocks new maintenance; a closed object without live maintenance is an intentional terminal/refusal state. |

Phase 6 must add staged backfill watermarks, old/new reader compatibility,
compaction, cursor publication and GC reference safety. Current same-storage
audit checkpoints are an optimization, not independently authenticated evidence
of the old prefix or backup completeness.

## Safety, assumptions and conditional progress

All checked safety configurations are `Init`/`Next` specifications without
fairness. They do not gain safety from eventual provider response. SQL actions
are atomic and serialized; immutable conditional puts either retain their exact
bytes or refuse; cryptographic identities and authenticated source facts are
assumed valid; the runtime preserves durable state across ordinary awaits.
Provider, database, compiler, OS and cryptographic implementations are trusted
boundaries and separately tested operationally.

Conditional progress has the following explicit obligations. These are named
environmental contracts, not liveness theorems established by the safety runs:

| Model | Progress requires |
| --- | --- |
| M1 | Every registered execution eventually settles or an independently proved effect fence terminates its authority; close/drain/publish is scheduled; providers recover. A permanently hung holder may keep the generation closed indefinitely. |
| M2 | Complete readable source input, no permanent storage refusal, finite competing revisions and retry/receipt delivery; prefix provenance must be supplied by the collector. |
| M3 | Eventual immutable storage/readback availability, valid unchanged request authority, fair retry/help and finite competing work. Frozen terminal rejection also counts as completion. |
| M4 | An explicit authorized abandonment or completed pending body; for transfer, trusted live account plus revoked predecessor; capacity remains. Ambiguous populations may permanently refuse until Phase 5 supplies proof. |
| M5 | Fresh correctly scoped authentication, same-account terminal confirmation and a caller lifetime that remains current long enough for a reply. Signout/expiry is intentional refusal, not a progress failure. |
| M6 | Eventual source/index availability, retained alarms, finite competing decisions and fair service of bounded members. No claimed deadline follows from fairness alone. |
| M7 | Valid retained canonical authority, open generation, registered maintenance and sufficient capacity. Corrupt authority intentionally blocks rebuild rather than inventing facts. |

A later temporal model may add checked weak/strong fairness once its exact
operational scheduler obligations are chosen. Until then, use the success,
refusal and recovery witnesses as reachability evidence only. Do not describe
them as termination proofs or treat a timeout/deadlock as an acceptable run.
