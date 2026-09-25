# Usage correctness and metric contracts

The [implementation plan](../kb/plans/system-assurance-and-usage-analytics.md) maps the whole product to observable invariants, repairs, formal models and release qualification. The checked manifests in `verify/assurance/` are the execution contract:

- `obligations.json` maps each audited finding to its owner, phase, invariant and required regression. Open findings are reported explicitly; a passing inventory check does not mean they are repaired.
- `metrics.json` gives 241 catalog metrics their grain, units, population, aggregation, coverage, correction rule, exactness contract and delivery owner. Each has named acceptance obligations. `planned` metrics are future work, not advertised capabilities; qualification requires passing receipts covering every case, with source hashes, commands, toolchain and positive assertion counts.
- `profiles.json` records the disjoint token partitions. Imported v1 output includes reasoning; detailed v2 output excludes reasoning. Their totals cannot share a formula without an evidenced conversion.
- `capacities.json` binds named limits to actual Rust/TypeScript constants and checks compatible consumers. Known inconsistencies name an open finding; repairing one requires removing its exemption.
- `capabilities.json` accounts for every source selector. An unreviewed adapter is neither fixture-qualified nor live-qualified.
- `surfaces.json` inventories owned SQL schemas and immutable object families. The cost gate discovers SQL declarations and object writers, then requires matching `costs.json` ownership, retention and source-bound capacity references. F21 still tracks physical budget and recovery qualification.
- `retention.json` freezes future reclamation rules and recovery objectives. It performs no deletion. Existing retained history is preserved, and physical reclamation requires qualified recovery, current authority controls and closed references.

Run `bun run usage:assurance:check` to validate manifest structure, coverage, evidence paths, capacity arithmetic and schema discovery. The check prints open obligations separately. It refuses missing entries and stale exemptions; it is not a theorem prover.

The baseline corpus under `fixtures/usage/assurance/` contains only synthetic observations. Its runners deliberately reproduce known failures in the audited source. Their successful exit means the expected counterexample was reproduced, not that a production invariant passed. Preserve baseline source/binary identity and add separate repaired-code regressions. Never point the corpus at a real usage store or read a contributor's sessions.

The current portable gate includes Rust, local workerd, TypeScript, application and browser checks. The macOS companion, live Keychain, real provider acquisition and production restore each require their separately documented evidence. Do not combine these evidence classes or reuse a receipt from a different tree as a required delivery gate.

The first repair policy rejects conflicting known occurrence owners atomically, preserves unknown-to-known enrichment, and keeps the original ledger intact. Historical ledgers with ambiguous ownership need versioned read-only inspection and export, with mutations and uploads quarantined until an evidenced resolution is available. Their source frames and sender state must remain intact. Omitted selected sources must yield an explicit bounded refusal or incomplete-source diagnostic. A later authority migration needs a separately specified transition; resetting a ledger is never recovery.

Run `bun scripts/assurance-metric-baseline.ts` for the admitted high-cardinality diagnostic workload. The [historical receipt](../fixtures/usage/assurance/performance/admitted-baseline.json) records exact token conservation and measured parser, selector and CSV timings at 8,192 and 65,536 rows. These helper measurements do not qualify browser responsiveness, peak allocation, hosted queries or production SLOs.

## Protocol and implementation evidence

`bun run usage:formal:tla` checks the fifteen historical baseline expectations
and the repaired-model configurations with pinned TLC and Java. The repaired
manifest now contains seventy-six cases: sixteen complete finite safety
explorations, forty-two explicit success, refusal and recovery witnesses, and
eighteen guard-removal counterexamples, so every repaired model M1–M11 has at
least one deliberately broken guard that must violate its safety invariant. The
eight M11 contribution-rebuild cases have individual receipts, including complete
single-job and sequential-job graphs of 258,698 and 221,596 distinct states.
Every case runs under the required `development` bounds profile (one worker,
256 MiB heap, 60-second deadline, 300,000 distinct states); the optional
`nightly` profile (`bun scripts/assurance-tla.ts --profile nightly --suite nightly`)
widens the M1 and M11 domains through numeric `CONSTANT` parameters under four
workers, a 2 GiB heap, a 600-second deadline and 3,000,000 distinct states, and
never substitutes for the development suites. Each run writes its own receipt
under `target/assurance/tla/`, recording the profile, the captured model and
configuration bytes and the complete state counts; the required Formal
verification job is the standing execution evidence. The runner admits only the
expected invariants, state counts and complete structured output. A witness is
reachability evidence; no temporal liveness theorem follows from it. Conditional
progress and trusted abstractions are recorded in the
[action map](../verify/tla/repaired-action-map.md).
The [account-work model](../verify/tla/account-work-action-map.md) separately covers
independent consent/projection progress, held calls, watchdogs, late settlement,
restart and explicit resume. Its bounded safety and reachability results do not
prove eventual provider completion or implementation refinement.
The [native-flight model](../verify/tla/native-flight-action-map.md) checks retained
uploads, durable cancellation, lost replies, restart and stale-reply isolation.
Its two-device finite models abstract bytes and durable publication; syscall,
cryptographic and transport behavior require their own implementation evidence.
The [contribution-rebuild model](../verify/tla/contribution-rebuild-action-map.md)
maps the M11 diagnostic rebuild job to the controller's reservation, provider,
commit, comparison, abort and replay boundaries.

`bun run usage:conformance:check` executes generated commands against actual
Worker, SQLite ledger and browser-authority code. It retains forty-two traces
across three fixed seeds per group, compares each observed transition, and
requires the declared action/outcome coverage. The Worker suite now includes an
M11 schedule that drives a real diagnostic rebuild: repeated begin, head and
comparison steps must return byte-identical receipts with no second charge and
no new object, an eviction between retries must resume the retained receipt, and
older, future and differently anchored requests must conflict. Both the positive
control and a production-only restore-guard mutant run isolated source snapshots.
The unchanged adapter must catch the mutant in all three schedules. The runner
admits repaired model names M1–M11 only. Compiler/runtime failures, missing
tests, timeouts and truncated output do not count as counterexamples. These
bounded schedules connect selected model abstractions to implementation; they
are not an exhaustive refinement proof.

## Production arithmetic proofs

The dependency-free `aicharts-metrics` crate supplies checked arithmetic, token
partitions, missing-value aggregation, pricing and revision helpers used by the
production protocol, core merge and detailed CLI report. `usage:formal:kani`
checks the exact declared full-width scalar domains and fixed container bounds,
with default safety and unwinding checks, positive covers and production mutants.
Structured results must contain every required assertion and cover. An exit code
or timed-out solver summary alone cannot establish success.

The current Kani inventory has twenty production harnesses and fifty-three
reachable covers, with thirteen production mutations that each must fail their
named unchanged assertion. The manifest names the production functions behind
every harness, and a test requires each kernel `pub fn` to be covered by a
harness or a theorem replacement. On each supported platform, eighteen
unreachable checks have individually reviewed source or installed-library hash
bindings: five bound to the workspace source and thirteen bound to that
platform's own bundled standard-library and `kani_core` rlibs.
A new unreachable assertion refuses admission, and neither platform inherits
the other's exceptions. Those exceptions cannot replace a reachable assertion
in the actual harness. The Linux list was reviewed from the first ubuntu-24.04
CI execution receipt; the required Formal verification job is the standing
Linux execution evidence.

`usage:formal:theorems` freshly extracts selected production bodies through
pinned Charon/Aeneas and checks the maintained Lean proofs. Separate unbounded
mathematical laws stay identified as specifications. Extraction failures, changed
function inventory, incomplete proof output and unreviewed axioms refuse evidence.
The maintained inventory contains twenty-six production proof declarations and
nine separate mathematical laws. Pricing covers five full-u128 token buckets and
five optional full-u128 rates: exact multiplication, ordered missing-rate/overflow
refusal, per-observation half-up rounding and the 24-digit profile limit. A
five-bucket non-unit example and success/refusal witnesses accompany the general
theorem. All four production mutants and the separate bounded-fold law control
listed in `verify/lean/mutations.json` must fail their named unchanged theorem.
The Kani gate binds its pricing theorem replacement to a theorem receipt for the
same kernel bytes and refuses without one. The Lean route has executed on
ubuntu-24.04 in the required Formal verification job (PR #422, run
36055796464) as well as on the macOS pilot host; each receipt records its own
platform.
These results do not validate tariff provenance or provider-reported quantities.
The proof toolchain, compiler, standard-library models and their installed runtime
remain trusted boundaries. See the [theorem route](../verify/lean/README.md) and
[Kani scope](../verify/kani/README.md) for exact obligations and platform qualification.
These commands require their pinned local tools; installing tools is a separate
step from executing or accepting a proof.

The production callers route their kernel arithmetic through the same
functions the proofs cover. The detailed CLI report converts a source's
floating-point cost through `scaled_decimal`, which scales the shortest
round-trip decimal literal and rounds half-up in integer arithmetic; the
retired `f64` product kept 124 micro-USD for the literal `0.0001245` and
fabricated a micro-USD near 2^53. Row totals, per-source summaries, the Claude
cache TTL partition, Devin transcript totals, the ledger status counters and the
CLI collection counters use `checked_sum`, `checked_add_bounded` and
`CacheWrites::with_ttl`; every u64 or 24-digit overflow is a refusal, never a
wrapped or silently absent number. A malformed checked-in tariff rate refuses
that client's projection, so the source reports `incomplete` with a warning and
its measured health records the refusal; the retired parser read such a rate
as an absent tariff and left the estimate silently unknown. Each report row's
reported-cost, estimated-cost and timed cohorts are paired through
`match_quantities` with the selection the shared explorer applies (a known
token basis, complete breakdown coverage and wholly covered records), and the
TypeScript explorer applies the same pairing before any ratio. These routings
are exercised by unit tests and by the differential vectors below; they are
not separately live-qualified against real client stores.

`bun run kernel-vectors:check` regenerates five seeded vector files under
`fixtures/usage/assurance/kernel-vectors/` (wire token totals, bounded checked
addition, cache TTL splits, exact-ratio rounding and micro-USD pricing, at least
2,000 cases each including the 10^12 wire limit, the 24-digit profile limit and
u64/u128 edges) from plain BigInt references and refuses any drift. The Rust
kernel evaluates every vector in `crates/aicharts-metrics/src/vectors_tests.rs`
and the shared TypeScript evaluates the same files in
`lib/usage/kernel-vectors.test.ts`; each law must witness every declared
outcome. The vectors are synthetic and check agreement of three
implementations, not tariff provenance or provider quantities.

Provision the pinned tools with `bun scripts/assurance-tools.ts`; use
`--verify --offline` to inspect an existing installation. The
[installation contract](../verify/tools/README.md) records platform, archive,
Rust component and Lean dependency admission. The required Formal verification
job runs the adapter and conformance gates, then the model suites, the fresh
Lean proofs and the Kani gate, alongside the existing application and companion
checks; theorem receipts precede Kani because every theorem replacement must
bind to a receipt for the same source bytes. A successful installation receipt
is not a successful proof receipt.

## Canonical account transition

The additive contribution protocol separates preparation from activation. Fresh
activation checks actual legacy heads, tombstones, journals, committed snapshots
and pending work inside the cutover transaction; empty totals do not prove an
empty account. Population grants retain writer revisions, predecessor checks and
operation receipts. Numeric bodies remain immutable objects, while transactional
metadata holds their hashes and references.

After activation, every legacy mutation continuation checks the cutover inside
its owning transaction. Exact retained terminal receipts remain reconcilable;
delayed writes cannot resume through an old profile. Device credentials do not
authorize account-wide tombstones. The nine `/v3/contributions` endpoints require
the separate `AICHARTS_USAGE_CONTRIBUTIONS_ENABLED` flag in addition to the existing
master, stats and admission flags. No deployment configuration enables it: on
2026-09-24 the Worker that would serve these endpoints had not been redeployed
for the merged source, and the activation runbook records the recovery-artifact
requirement that precedes that deployment; reverify flag names on both services
before any activation. A names-only read of the Vercel production environment on 2026-09-24 listed `AICHARTS_USAGE_AUTH_ENABLED`, `AICHARTS_USAGE_PAIRING_ENABLED`, `AICHARTS_USAGE_PRIVATE_READ_ENABLED`, `AICHARTS_USAGE_STATS_ENABLED` and `NEXT_PUBLIC_SITE_URL`; no `AICHARTS_USAGE_CONTRIBUTIONS_ENABLED` or `AICHARTS_USAGE_PUBLIC_READ_ENABLED` name existed, and no value was read.
Retained-data migration seals a bounded, independently replayed legacy inventory.
Original objects remain intact; unresolved aggregate populations remain explicit
and are not added to overlapping canonical observations. Migration cancellation
retains the exact terminal intent. This is a bounded transition, not qualification
of every possible historical account size or coordinated storage corruption.

`/v3/contributions/heads` reads at most 256 exact observation heads or one indexed
population-membership page. Its 16 KiB request and 512 KiB response ceilings are
separate from mutation receipts. Responses bind the account, generation, device,
writer revision, population and canonical revision. A continuation refuses after
any canonical revision change. Current head hashes and potentially stale
membership hashes remain distinct; membership alone does not prove a current
value or source completeness. Reads perform no repair, DML or alarm scheduling.

`/v3/contributions/cancel` carries the exact original batch and a fresh account
revision. It can permanently cancel an upload that never reached reservation.
An already committed or abandoned result remains stable on retry; otherwise the
current device, generation, population writer, next sequence and cancellation
revision must pass their guards. Cancellation consumes the sequence and one empty
canonical revision. An absent reservation adds one 8 KiB metadata allowance and
no immutable-byte charge or content-store write. Its tagged terminal upgrades the
account to schema 12 in the same SQL transaction, so older readers refuse it.
The older abandon route still requires a retained operation. An absent status
alone never authorizes a sender to discard a frozen upload; lost authority or
capacity can leave a flight needing recovery.

The native `contribution_producer` kernel freezes canonical request bytes from
bounded Claude observations and correlates head replies and terminal receipts.
Its account occurrence key preserves migrated V1 identities. Only new facts and
exact-payload mirror assertions are eligible; a differing value from a partial
scan refuses even when that population still owns the current head. Aggregate
reports and unsupported source identities cannot become native observations.
Rust/TypeScript fixtures check literal bytes, hashes and the server reference
transition. Checked scope and reply correlation do not establish authentication.
The native V3 sidecar retains one exact upload or cancellation across all
populations for an account/device/generation. It advances the device sequence
only after a correlated authenticated terminal, including abandonment. Durable
cancellation cannot revert to upload. Private descriptor-pinned files, a stable
lock, authenticated checkpoints and explicit staged recovery protect the local
transition; inspection opens existing state without reconciliation or writes.
The current/staged file ceiling is 2,834,440 bytes each, including the envelope;
each checkpoint retains at most the current flight and latest terminal body.
Restoring an entire older, internally valid directory before an uncertain send
reaches the server still needs an independent recovery fence. The explicit
`contribution-sync` uploader is available to enrolled macOS clients for an
already-active population they own. It has no CLI activation, grant or migration
command. Complete-source correction/removal authority and production activation
remain separate qualification requirements. HTTP activation and grant routes
require the stats, contributions and admission flags together.

The current native contribution-sync join passes 45 focused Rust tests, including
the command orchestrator, schema-1-to-schema-2 read-only migration, exact-byte
send and status/cancel/resume flows, multi-exchange TLS transport, changed-writer
history refusal and output that distinguishes committed from abandoned outcomes.
Cancellation intent is durably recorded before the first status request. A failed
status response leaves a cancel-only flight; each injected local publication
failure stops before any network exchange. An already committed terminal can
still settle that retained flight. The focused receipt is
`target/assurance/native-cancel-review/receipt.json`.
The core producer remains at 18 focused tests with strict all-target Clippy and
formatting clean. The TypeScript status contract adds 19 tests with 552
assertions: committed terminals now refuse a missing, predating or contradictory
population status, and every population status is bound to the same account
generation. These are source and loopback fixtures; live enrollment, transport
qualification, rollback fencing and V3 activation remain separate obligations.

## Indexed canonical views

Canonical numeric corrections retain immutable before/after references and a
committed SQL revision. A bounded background or explicit maintenance step validates
that inventory, retracts all predecessors, then adds successors in chunks of at most
32 identities. A durable intent reserves every possible index write before
provider I/O. Exact retry reconciles the same intent without charging twice.
Only a complete revision advances the applied root; a partially rebuilt root stays
private. Publication coalesces completed applied revisions with a minimum
16-second interval, including caught-up bursts. Applying backlog can continue
while the last published snapshot remains readable.

The account stores three bounded projection control tables and one two-class
work-control row under additive schema 11 (schema 12 after an absent-batch
cancellation, schema 13 after an explicit diagnostic rebuild); immutable index nodes remain in the
content store. The derived write budget is
4 GiB of cumulative possible writes, including uncertain outcomes. It is
separate from canonical source budgets and is not a claim about total provider
storage overhead. No physical node deletion is implemented or enabled.

`/v3/private/contributions` returns bounded pages from an authorized committed
publication. It requires the master, stats, contributions, authentication and
private-read flags, plus verified workload identity and a live account assertion.
Pages disclose source, latest applied, latest published and selected snapshot
revisions, with separately checked applied, published and snapshot lag,
observed-only coverage and unresolved legacy populations. They contain complete
cells; summing one page does not produce a complete-range total. Read paths do
not initialize, backfill, prune or repair storage.

At most 64 SQL publication references remain authorized. Replacing a current
root starts a 930-second retirement horizon, preserving cursors opened just
before replacement. Reads reject expired references even when their objects
still exist. Only explicit publication prunes expired references. If all slots
remain live, publication waits while retaining the last published root and
completed applied work. Physical reclamation and operational activation still
need separate recovery and live qualification. M7 covers legacy derived rebuilds;
M8 adds bounded staged apply, immutable charge, coalesced publication, retained
cursors and actual completion before drain. Its finite model does not prove
implementation refinement or the background scheduler.

The trusted `scrubContributionCell` RPC checks one published cell with an
independent fold of current canonical heads. It verifies each live head's exact
immutable body and committed operation before counting it once. A validly encoded
but incorrect, missing or phantom index cell yields an explicit mismatch. The
source, applied and published revisions must agree, and the pinned root must
survive the final authority checks.

This temporary diagnostic accepts fresh V3 accounts with at most 16 retained
heads. Legacy, larger and lagging accounts refuse explicitly. It reads at most
16 source bodies and seven index nodes under an 18 MiB decoded-content allowance;
those counters exclude the two namespace and two restore-fence checks. One
30-second deadline bounds the entire RPC, and retirement prevents late replies
from starting further private reads. It has no public route and performs no
repair, SQL mutation, object write or alarm operation. Its receipt is relative
to canonical SQL authority, not a source-truth, from-genesis or whole-account
certificate.

The trusted `executeContributionRebuild` RPC supports a resumable, whole-index
diagnostic for fresh V3 accounts. It pins the canonical revision, retained head
count and complete published reference, then independently rebuilds a private
scratch index from zero. A step visits at most 16 retained heads and verifies
each live head's committed body and terminal before folding it. Comparison reads
both trees in key order with 16-cell pages across the entire retained day range;
different tree shapes may still compare equal. A job never publishes its root.

Schema 13 retains at most 16 job identities, including terminal jobs, with one
active job and 16 KiB of metadata per job. Every step supplies its expected
version. An exact retained step returns its original receipt without repeating
work. Scratch writes reserve the existing cumulative 4 GiB budget before I/O;
uncertain and aborted writes keep their charge. Source or publication changes
refuse new progress; an explicit abort and already retained receipts remain
available under current account authority. `readContributionRebuild` uses only
SQL reads and cannot initialize, resume or abort a job.

One 30-second deadline bounds each RPC, including external authority checks.
Late continuations cannot enter SQL or start another object operation. An actual
provider write retains its external restore-fence registration until it settles,
even after its caller receives a timeout. Build steps admit at most 1,040 source
and index reads within 80 MiB; comparison admits at most 252 reads within 64 MiB.
These logical content counters exclude namespace and restore-fence traffic.
Legacy resolution, repair cutover, physical reclamation and production recovery
still require separate qualification.

The M11 finite rebuild model now covers private scratch accumulation, exact
reservation replay after a lost reply, late provider completion after abort,
whole-index comparison retry and proof/comparison/quota capability guards. Its
two complete safety explorations contain 258,698 and 221,596 distinct states;
three reachability witnesses and three guard-removal counterexamples each have
fresh pinned-runner receipts. This is bounded model evidence for the rebuild
controller, not a proof of the JavaScript fold, SQL/R2 refinement, liveness or
recovery after an entire local directory rollback.

## Bounded background work

Canonical mutations persist an alarm before committing source progress. Consent
and projection have separate work identities and at most eight attempts per
position. Appending unrelated canonical work does not renew a failed position's
allowance. Explicit maintenance may resume a blocked position.

An alarm dispatches at most one operation per class. A 2-second handler yield
does not complete a provider call or release its restore registration. Each
dispatch has its own persisted identity and 30-second watchdog. The watchdog
marks unresolved work `awaiting_settlement` once and stops polling that class;
the other class can continue. Eviction retains that visible repair state rather
than inferring that the provider stopped. A late callback can clear only its
exact flight, and it saves the next wake before exposing retryable work. Each
class completes independently; the shared restore holder releases only after
all actual continuations and the handler finish. A timer never proves drain.

The trusted `readContributionWork` RPC reports work, retry and unresolved-flight
state without mutation. It has no public HTTP route. Explicit foreground
projection maintenance uses the same dispatch exclusion and durable flight
identity. The legacy consent-only alarm remains a separate lifecycle scope;
this scheduler is installed only by registered canonical mutations. No feature
flag or deployment activation changes with this implementation.

## Rich local observations and dashboard qualification

The opt-in `rich-facts-v1` profile turns numeric session, terminal-turn and
compaction inputs into keyed, revisioned observations with explicit grain,
lineage, token scope, timing uncertainty and source coverage. The local evaluator
currently derives exact token means and nearest-rank quantiles, request outcome
rates, retry counts, request latency, time to first token, turn counts/runtime,
context occupancy and compaction outcomes. It refuses unsupported or mixed-grain
metrics with a machine-readable reason; request facts are never inferred from a
token subtotal, and inclusive totals require disjoint verified lineage.

The rich fact and adapter suites pass 28 tests with 4,070 assertions and nine
adapter tests with 50 assertions. They cover keyed-source immutability, tombstone
and owner conflicts, unknown-versus-zero values, lineage overlap, exact ratios,
quantiles and source-window bounds. The evaluator is a local capability today;
hosted ingestion, account joins, complete catalog coverage and billing/plan
evidence remain planned and are not represented as observed metrics.

The worker-backed metric explorer has a fresh production-build functional receipt
for desktop/light and mobile/dark journeys, exact 65,536-row protocol totals,
bounded presentation/export bytes and worker cleanup. The final profiling run
measured 1,060.2 ms for the 65,536-group protocol wire path and page worker
admission of 206.4 ms for 8,192 rows and 174.4 ms for the 65,536-row report;
there were no page Long Tasks and workers returned to zero. Renderer private
footprint reached 1,079.7 MB while holding two full reports in the diagnostic
episode, so physical memory budgeting and maximum-report optimization remain
open. These measurements are bounded synthetic workload evidence, not a hosted
SLO or modest-hardware p95 claim.

## Verification matrix

Each evidence class has one command, one receipt location and one stated
limit. Everything below is implemented and passes locally on the recorded tree;
none of it is live-qualified, and no receipt from one class substitutes for
another.

| Command | Evidence | Receipt | What a pass means |
| --- | --- | --- | --- |
| `bun run test:property` | fast-check laws in `lib/*.property.test.ts` and `lib/*/*.property.test.ts` (108 tests, 16 files) | test output only | Sampled laws hold for the generated inputs. Bun does not expand globs, so the script lists both depths; `scripts/assurance-fuzz.test.ts` fails when a property file sits outside them. |
| `bun run usage:fuzz` | seeded stateful runs in `crates/aicharts-fuzz`: ledger command sequences against real SQLite, usage and admission wire round trips with byte corruption and single-violation injection, metrics arithmetic, token-partition and dominance laws | `target/assurance/fuzz/run-*/receipt.json` | Four named seeds (`baseline`, `rewrite-heavy`, `conflict-heavy`, `settlement-race`) ran the configured iterations (default 1,000; ledger commands capped at 5,000) with one receipt line per suite and seed and no counterexample. `--iterations`, `--seed <name\|decimal>`, `--ledger-commands` and `--timeout-minutes` replay a failure exactly. Sampled evidence, not a proof. |
| `bun run usage:fault-matrix` | eleven existing injected-failure suites listed in `verify/assurance/fault-matrix.json` | `target/assurance/fault-matrix/run-*/receipt.json` | Every listed test still exists under its exact name, every suite ran through the worker tool command or exact cargo filters, and every summary is complete and passing. Failure classes covered by passing suites: crash before effect, crash after effect, lost reply, restore race and capacity exhaustion. `disk-full` is a declared gap: no existing test injects a full disk, and capacity exhaustion is recorded as the nearest analog, not as disk-full evidence. macOS-only suites are `skipped-platform` elsewhere, never passed. |
| `bun run security:check` | `cargo audit` on both Cargo locks, `bun audit`, dependency pins (release tags or full commits for `github:` packages, exact hashed lockfile entries, checksummed registry crates, pinned git crates, full-commit action pins, pinned `bunx` targets), a shape-based secret scan, and a privacy canary over the PostHog import boundary and the analytics and discovery surfaces | `target/assurance/security/run-*/receipt.json` | No published advisory, no unpinned dependency, no credential-shaped literal outside a value that names itself synthetic or a fixture directory whose README documents synthetic data, and no raw location, referrer, storage or private identifier on the canary surfaces. Findings carry a path and rule, never the matched bytes. A missing tool fails the run unless `--allow-missing-tools` is stated; the workflows never state it. |
| `bun run usage:formal:tla`, `usage:formal:kani`, `usage:formal:theorems`, `usage:conformance:check` | see the sections above | `target/assurance/{tla,kani,theorems,conformance}/` | Unchanged; the nightly workflow runs the TLA suite with `--profile nightly`. |

`.github/workflows/nightly-assurance.yml` runs daily at 09:00 UTC and on
dispatch with a three-hour budget: it provisions the formal tools and
`cargo-audit` 0.22.2, then runs the nightly TLA profile, `usage:fuzz` at 200,000
iterations, `usage:fault-matrix`, `security:check` and, when
`scripts/usage-perf.ts` exists, `usage:perf`, and retains every receipt for
thirty days. `.github/workflows/security.yml` runs only `security:check` on pull
requests and pushes to `main`; it is informational and not a required check.
A green nightly run is evidence for that day's tree and advisory database; it
does not qualify a deployment.
