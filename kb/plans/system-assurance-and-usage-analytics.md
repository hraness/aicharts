---
title: Whole-system assurance and usage analytics
description: Evidence-backed correctness audit, formal verification strategy, complete metric catalog, and dependency-ordered delivery plan for AI Charts.
type: plan
area: system-assurance
status: in-progress
tags:
  - usage
  - verification
  - performance
---

# Whole-system assurance and usage analytics

23 September 2026 · audit and proposed implementation plan

## Outcome and recommendation

Build a trustworthy, performant product for exploring AI usage across clients, devices, accounts, models, sessions and time. Every displayed number must have a defined meaning, traceable source, correct aggregation rule, explicit coverage and a tested correction/recovery path.

Start with the reproduced integrity defects below. Add TLA+/TLC for distributed state transitions, Kani for actual Rust kernels, and stateful property/fault tests through real storage. Run one bounded Lean/Aeneas versus direct-Verus pilot before choosing a production theorem route. Lean is well suited to unbounded metric algebra; a separate mathematical specification needs an explicit connection to the executable implementation.

The completion claim is an evidence-backed assurance case covering the whole product, with machine-checked guarantees for selected critical foundations. An unconditional claim that every deployed component is proved correct would exceed the available methods and evidence. Provider truth, OS behavior, cryptography, compilers and hosted infrastructure remain named assumptions with independent qualification obligations.

The initial audit and plan were delivered on 23 September 2026. The user then authorized implementation by asking to keep working. The implementation log records subsequent changes and evidence; audit findings retain their original governed baseline.

## Baseline, scope and evidence

The governed AI Charts source is main commit **a5bec6415ce640a61495db57bc9c2ce83fb83021**, fetched through only refs/heads/main. The initial user checkout was devin/pairing-auto-approve at 8d2a9978172bb375dfc575b6a5e933018d271ee4. All findings were rechecked against the newer isolated snapshot; the original checkout was preserved.

Three independent lanes audited the native CLI, cloud/account system and nearby verification precedents. The integration owner examined dashboard formulas, performance and product coverage. The audit mapped all major surfaces and deeply traced high-consequence seams. It did not inspect every line of every vendored parser, perform a penetration test, inspect private histories or qualify live providers.

| Evidence | Result and limits |
| --- | --- |
| Exact-main offline Rust CLI build | Passed; cargo build --locked --offline -p aicharts-cli, 57.16 seconds. A build is not a test-suite pass. |
| Four native CLI counterexamples | Reproduced ledger reopen failure, mtime omission, oversized-source omission and lost Devin diagnostic with disposable synthetic files only. |
| Cursor merge probe | Exact production pure-function bodies reproduced deletion outside the fetched range; authenticated acquisition was not exercised. |
| Actual cloud domain classes on Bun SQLite | Reproduced cross-device omission, revoked-writer lockout, write-on-read, old capacity refusals and same-flight ABA/accounting transitions. This is not workerd or production qualification. |
| Dashboard formulas and existing focused tests | 66 tests across 7 files passed, 3,253 assertions. A valid synthetic row still produces 100% cache share where the complete disjoint-input denominator yields 10%. |
| Query access plans | Local SQLite EXPLAIN showed full scans for selected day/revision predicates and temporary sorting. No production latency was inferred. |
| Selector microbenchmark | Six measured runs after two warmups: 8,192 rows median 16.34 ms, max 19.97 ms; 65,536 rows median 101.40 ms, max 106.54 ms. Bun helper-only, low-cardinality repeated synthetic rows, no contract admission or browser rendering. These are diagnostic timings, not SLO evidence. |
| Existing aggregate gate | Execution result is recorded in the audit closeout below. |
| Live services, disposable Keychain qualification and provider acquisition | Not exercised. Dated activation documents are historical evidence, not qualification of this source. Native synthetic process/custody checks are included in the aggregate gate. |

Read the existing [usage plan](usage-leaderboard.md) as history and the maintained [activation runbook](../../docs/usage-activation.md) for operations. Its September 21 evidence describes an earlier deployment and leaves detailed stats/public-read activation disabled at that inspection. Reinspect exact service identity and flags before future rollout.

Supporting audit reports and synthetic probes are retained with the delivered evidence bundle. All source paths and line numbers below refer to the governed commit, so later changes must be assessed against that baseline.

## Whole-system map

~~~mermaid
flowchart LR
  A["Provider stores / explicit refresh / numeric telemetry"] --> B["Capture, parser, identity and coverage"]
  B --> C["Local facts, checkpoints and durable outbox"]
  B --> D["Detailed daily snapshots"]
  B --> E["Session and turn observations"]
  C --> F["Authenticated admission and immutable receipts"]
  D --> F
  E -. "planned private numeric path" .-> F
  F --> G["Canonical account contributions"]
  G --> H["Rebuildable rollups and bounded queries"]
  H --> I["Private dashboard, CLI and exports"]
  G --> J["Consented public projection"]
  J --> K["Leaderboard"]
  L["Accounts / device authority / restore fence"] --> F
  L --> H
  M["Benchmark snapshots and pricing provenance"] --> I
~~~

These paths currently represent different contracts:

| Surface | Current foundation | Required whole-product assurance |
| --- | --- | --- |
| Historical occurrence tracking | Core Codex/Claude/Devin parsers, AICU wire, SQLite ledger, prefix witnesses and sender | Canonical identity, deterministic merge, no lost diagnostics, commit/reopen equivalence, corrections and crash recovery |
| Broad detailed imports | aicharts-import plus vendored Tokscale, client-stats-v2 daily aggregates | Explicit adapter semantics, qualified source versions, complete-range replacement, trustworthy missingness and affordable scanning |
| Sessions, turns and compaction | Separate numeric local profiles and pure projections | Reconcile compatible facts without overlap; private drilldown needs new retained information and consent boundaries |
| Accounts and enrollment | Pinned Suite Accounts, workload OIDC, browser/terminal pairing and native custody | Correct identity at every effect, expiry/replay/account-switch handling, lost-device recovery |
| Cloud admission | SQL reserve/freeze/publish, immutable R2 evidence, v1 heads and v2 writers | Exactly-once effects under retries; ownership and coverage preservation across migrations and devices |
| Restore and recovery | Separate fence authority and operator runbooks | No stale work after drain; complete effect inventory; tested recovery rather than assumed external reconciliation |
| Private reads and dashboard | Days/stats contracts, filters, trends, calendar, table, local file mode and export | Consistent snapshot, honest coverage, bounded queries, matching accessible/table/export numbers |
| Public rankings | Consent state, index, alarms, tombstones and cache limits | Current eligible population, no resurrection or private identity leakage, bounded withdrawal visibility |
| Benchmarks and calculator | Checked datasets, source-specific schemas, properties and guarded refresh | Preserve benchmark comparability, model/config identity, null values, source dates and scenario assumptions |
| Delivery and companion tools | Release archive/source/manifest checks, Linux qualification and macOS companion | Authenticated immutable artifacts, platform-specific support, safe install/update/recovery and exact deployed identity |
| Operating costs and observability | costs.json, fixed diagnostics and telemetry allowlist | Complete surface inventory, executable capacity arithmetic, real retention/deletion paths and actionable private health |

## Findings and repair priority

“Reproduced” means execution against the governed production code or, where explicitly stated, extracted pure bodies. “Source trace” means a concrete code path/counterexample requiring runtime confirmation. An assurance gap identifies missing evidence or product behavior; it is not a claim of an observed incident.

### Data integrity and lifecycle

| ID | Priority / evidence | Finding, consequence and required repair |
| --- | --- | --- |
| F01 | P0 · native reproduced | Claude copies with two distinct known execution attributions can both commit, then make the ledger fail reopen with ledger_invalid_state_do_not_reset. Core merge adopts arrival order; rebuild uses source-ID order. Reject unsupported conflicts or represent authorized migration explicitly; establish commit/rebuild equivalence before further collection changes. |
| F02 | P0 · cloud SQLite reproduced | V2 takeover ignores another device's v1 heads for coverage checks, then hides all legacy heads for the owned client/day. A 120-token record on B plus a distinct 15-token record on A becomes a 15-token hosted account result. Replace only a proven-owned population; retain disjoint contributions. |
| F03 | P0 · source trace | Restore lease deadlines are discarded by AccountEnrollment. Fence expiry removes the lease even if work can resume and mutate. TTL expiration does not imply termination. Define a real fenced commit/dispatch protocol and include late effects in drain semantics. |
| F04 | P0 · source trace | Status, constructor migration and audit-checkpoint writes can bypass the restore mutation lease; ordinary reads also lack one coherent restored-state visibility rule. Enumerate every RPC effect and bring maintenance, reads and writes under a defined restore lifecycle. |
| F05 | P1 · native reproduced | Changing only a Codex source file's mtime turns 13 in-window tokens into not_found with no warning. Skip decisions need authenticated event-range/index evidence, or an explicitly qualified observable fast-path assumption. |
| F06 | P1 · native reproduced | A 256 MiB + 1 byte legacy source is skipped with exit 0, sourcesSkipped=0 and no source-limit diagnostic. Report incomplete scans and retained partial progress explicitly; never describe queue drainage as collection completeness. |
| F07 | P1 · extracted-function reproduced | Cursor fetch starts at latest timestamp minus two days, while replacement deletes whole represented UTC days. Monday 09:00 disappears when fetching Monday 15:00 onward. Fetch complete replacement days or replace only the exact proven-complete interval. |
| F08 | P1 · native reproduced | DevinTotalsMismatch survives ephemeral measurement but disappears after persistence because the warning bitmap omits it. Make warning encoding exhaustive, versioned and migration-safe. |
| F09 | P1 · cloud SQLite reproduced | Revocation removes a pending stats flight but leaves its client writer slot occupied; another device receives writer_conflict. Provide account-authorized transfer with a new ownership generation and late-flight fencing. |
| F10 | P1 · parser probes reproduced | Storage permits 1,000,000 heads while private-day totals and stats takeover status still reject more than 100,000. Generate compatible capacity contracts and test cap-1/cap/cap+1 at each representation. A range limit must be a normal product refusal, not invalid storage. |
| F11 | P1 · state transitions reproduced; network ordering source-traced | Same-device automatic supersession permits A→B→A at unchanged revision/sequence and recharges reservation bytes. Establish durable supersession order, a terminal old-flight disposition and idempotent quota/object accounting. |
| F12 | P1 · cloud SQLite reproduced | Stats read/leaderboard can DELETE/INSERT derived rows while reading, conflicting with the repository's no-writes-on-read rule and complicating restore. Move persistent backfill to an explicit maintenance/mutation owner; provide a pure fallback. |
| F13 | P1 · source trace | Incremental audit migration trusts an old prefix without replay, and the checkpoint shares storage with the data it vouches for. State the trust model, preserve a from-zero scrub and independently rooted recovery evidence; do not label a migration-trusted prefix verified. |
| F14 | P1 · source trace | Autosubmit sink supervision can reap the leader and return while descendants remain, unlike capture's WNOWAIT custody. Share a tested owned-process abstraction; verify early exit, ECHILD, descendants and bounded cleanup on each supported OS. |

Source anchors for these findings:

- F01: [core merge](../../crates/aicharts-core/src/lib.rs), lines 124–170; [ledger commit and audit](../../crates/aicharts-ledger/src/lib.rs), 395–401 and 653–704; [one-order attribution test](../../crates/aicharts-core/src/tests.rs), 460–499.
- F02/F09/F11/F12: [stats state](../../services/usage-worker/src/stats-state.ts), respectively 215/313–315/475–476/538–539; 55–57/329–330; 237–241/365–369; 177–182/465/531–532. [Supersession caller](../../services/usage-worker/src/stats-admission.ts), 80–86.
- F03/F04: [enrollment](../../services/usage-worker/src/enrollment.ts), 211–235, 355–388, 438–453, 582–610, 875–913 and 1087; [restore fence](../../services/usage-worker/src/restore-fence.ts), 138–142 and 277–288.
- F05: [offline selector](../../vendor/tokscale-core/src/offline.rs), 151–162; [mtime pruning](../../vendor/tokscale-core/src/offline_io.rs), 381–403.
- F06: [collection](../../crates/aicharts-cli/src/state.rs), 471–481 and 739–757.
- F07: [refresh bounds and merge](../../crates/aicharts-cli/src/source_refresh.rs), 396–399 and 486–503.
- F08: [parser warning](../../crates/aicharts-core/src/lib.rs), 774–785; [warning encoding](../../crates/aicharts-ledger/src/lib.rs), 809–833.
- F10: [admission policy](../../services/usage-worker/src/admission-policy.ts), 12; [private-day contract](../../lib/usage/private-days-contract.ts), 8/113; [stats status contract](../../lib/usage/stats-http-contract.ts), 130.
- F13: [admission audit](../../services/usage-worker/src/admission-state.ts), 75–77, 281–315, 356–391.
- F14: [autosubmit](../../crates/aicharts-cli/src/autosubmit.rs), 370–404; [capture custody](../../crates/aicharts-cli/src/capture/process.rs), 165–216.

F01 does not justify resetting a user's ledger. Future repair must preserve the original file and establish a reviewed deterministic migration/recovery path on a synthetic and retained-schema copy.

### Metric, coverage, performance and product gaps

| ID | Evidence | Finding and plan implication |
| --- | --- | --- |
| F15 | Source plus accepted synthetic row | Cache share divides cache reads by input + cache reads, excluding disjoint cache-write input. Input=0, read=100, write=900 displays 100%; whole-input share is 10%. Use all known input categories and withhold complete shares when category coverage is missing. |
| F16 | Source plus accepted synthetic row | The UI subtracts reported cost from estimates even though they describe disjoint record populations. A row with one $1 reported observation and a different $3 estimated observation yields an apparent $2 gap. Compare matched observations under the same tariff scope; remove unsupported causal explanations. |
| F17 | Source-confirmed | Generic records mix request observations and session aggregates. Duration may mean time between log observations or provider-reported runtime. Total-token/source-duration ratios are not universally output-generation speed. Add record grain, duration basis and per-metric eligible populations. |
| F18 | Source-confirmed | Hosted upload rejects incomplete/missing/unavailable sources and nonzero warnings; reads synthesize observed/empty with zero warnings. Preserving older good measurements is useful, but users need a separate latest-attempt/health/coverage channel. |
| F19 | Source-confirmed | The 55 selectors are parser coverage, not live support certification. Vendored library tests are disabled and excluded from cargo test --workspace; 2,282 test attributes in source are not executed evidence. Establish a maintained adapter compatibility lane. |
| F20 | Local query plans | Day/revision queries scan full tables; some sort into temporary trees. Exploded rows reduce JSON work but leave per-client/day round trips, lifetime aggregate scans and cold audits. Add reviewed indexes, delta counters and bounded summary/drilldown queries with reference-fold equivalence. |
| F21 | Source plus passing cost gate | costs.json/checker misses owned SQLite tables and some R2/control surfaces. The documented 51,320,072-byte SQL binary bound cannot cover 320,000,000 bytes of allowed head operations alone, before journal/derived overhead. Generate budget arithmetic and complete discovery from actual schemas. Native read-only inspection also caps files at 256 MiB while the writer admits 512 MiB; Phase 1A fixes that recovery dependency. |
| F22 | Assurance/product gap | Account export/erase, account-authorized device inventory/revocation, writer transfer and sustainable retention are incomplete. Finite retained device, journal, immutable-byte and index caps need explicit user recovery. |
| F23 | Assurance gap | Report cache keys contain only date range. Normal sign-out and account switching clear data, but cross-tab identity changes, bfcache and late refresh need a verified account-generation boundary. No supported-flow data leak was demonstrated. |
| F24 | Product gap | Sessions, turns, waits and compactions remain local profiles. Daily aggregates cannot reconstruct request percentiles, lineage or context distributions that were not retained. Introduce the necessary numeric facts before adding those charts. |
| F25 | Assurance gap | Consent/index ordering, 128-member capacity, 256 withdrawal tombstones, six-hour freshness and public cache behavior need explicit safety/liveness models and truthful user-visible timing. Ranking measures self-reported usage, not provider-attested work. |
| F26 | Documentation/qualification gap | Existing broad engineering prose and older plan status can describe a smaller dormant product than current source. Generate proof/capability inventories and update current operating docs; retain dated evidence without treating it as current qualification. |

F15/F16 are in [stats report view](../../components/usage/stats-report-view.tsx), 119–124 and 279–289, [summary text](../../components/usage/stats-view.ts), 297–301, and [stats contract](../../lib/usage/stats-contract.ts), 83–102. Claude's documented total input includes uncached, cache creation and cache read fields; this supports the complete-input denominator. [Claude prompt-caching semantics](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

F17–F19 span [stats projection](../../crates/aicharts-cli/src/stats.rs), 419–537; [Codex adapter](../../vendor/tokscale-core/src/sessions/codex.rs), 723–805; [upload contract](../../lib/usage/stats-http-contract.ts), 110; [hosted coverage](../../services/usage-worker/src/stats-state.ts), 496–500; [workspace manifest](../../Cargo.toml), and [vendor manifest](../../vendor/tokscale-core/Cargo.toml).
F20–F22 span [schema](../../services/usage-worker/src/admission-schema.ts), [stats state](../../services/usage-worker/src/stats-state.ts), [cost registry](../../costs.json), [cost checker](../../scripts/check-cost-surfaces.mjs) and [worker capacity documentation](../../docs/usage-worker.md).
F23–F25 span [account generation boundary](../../lib/usage/account-generation.ts), [session contract](../../lib/usage/session-contract.ts) and [public index](../../services/usage-worker/src/leaderboard-index.ts).

## What to preserve and reuse

The existing foundation already has bounded foreign-input schemas, integer counters, independent occurrence namespaces, exact receipt matching, frozen uncertain flights, transactional local state, immutable cloud evidence, explicit null-versus-zero handling in several projections, real workerd tests and separate consent.

The existing rollup/turn/session properties are particularly useful. They test interval union against an independent discrete oracle, weighted means, duplicate/permutation invariance, independent denominators and partial coverage. Extend them into one shared semantic contract; do not replace them merely to introduce a new framework.

### Nearby precedents

These are inspected source precedents, not proofs rerun during this audit.

| Repository and exact inspected baseline | Reusable evidence | Limits and lesson |
| --- | --- | --- |
| Valhalla 28c2db2812ff82e989a95384dba4d9a3ac537d69 | vhalla-native/src/spent.rs:222–340 uses Kani 0.68.0 on production length/codec/admission functions; .github/workflows/rust.yml:375 requires the spent proof job. | Keep production capacity 1,024. Membership is an input assumption; codec byte proofs cover named short lengths, not full collection/storage/concurrency behavior. |
| Same Valhalla baseline | verify/ledger.rs proves a separate Verus ledger model; docs/verification.md records 13 verified, 0 errors with Verus 0.2026.09.13.671956e. | Historical recorded result; separate vector-based model has no inspected machine-checked refinement to the production BTreeMap implementation. |
| Same Valhalla baseline | vhalla-ledger/tests/recovery_hegel.rs and journal/src/tests.rs exercise command sequences, crash-before/after/I/O faults, actual files and reopen; witness tests use independent Python vectors. | Sampled/fault-injected evidence has stated bounds. Preserve minimized failures as named deterministic regressions. |
| Platonik 81a507807d5a52cec9322f03eee3868610b34d96 | platonik-core/src/check.rs:1617 verifies checked addition of 13 arbitrary u64 components against a u128 reference. | Excellent token/cost template. Presence of a harness is not a freshly passing required CI proof. |
| Retired session runtime e4f4afe2c45efa1eb71b12885f385f38696d3f1d | Seeded authority simulations assert action coverage and healthy reachability; retained SQLite migration tests compare complete snapshots after injected failure. | Existing unrelated work was present; selected source was inspected, not validated as a clean integration tree. Reachability is not a fairness/liveness proof. |
| Wordcell 7e50bb196ac4d8b376fdaf110b6218474d13a28d | Rust/Wasm/TypeScript parity and bounded resource-schedule properties. | Count actually compared cases; early returns can silently reduce effective property coverage. |

Valhalla's inspected proof files were unchanged relative to its locally known origin/main ba00721c07078f5e5aca3bd879941287a417c0b7. These nearby repositories were not freshly fetched. No tracked TLA+/Lean project was found in the five bounded baselines inspected; this says nothing about uninspected branches or repositories.

## Correctness contract

Assign stable claim IDs to requirements before implementation. Each claim records its owner, exact scope, assumptions, source/representation versions, production functions, proof/model/test artifacts, bounds, trusted components, mutation negative controls and last exact-tree result.

| Claim family | Required invariant |
| --- | --- |
| S01 source admission | A successfully complete scan accounts for every selected supported observation or explicitly reports exclusion/incompleteness. Limits and unknown schemas cannot silently prove absence. |
| S02 identity and ownership | One logical observation has one declared canonical owner. Copies deduplicate only with evidence; independent devices/accounts never lose disjoint usage. |
| S03 merge and correction | Accepted state is deterministic under the declared order. Rebuild equals committed state. A correction removes precisely its prior contribution, including changed day/model/coverage/denominator. |
| S04 exact quantities | No overflow, rounding ambiguity, subset double-counting or integer precision loss. Unknown, estimated and measured zero remain distinct across all representations. |
| S05 coverage | Coverage is scoped to source, interval, metric and population; merging evidence cannot invent completeness. A parser's success or a record's presence is not enumeration proof. |
| S06 durability | Cursor, facts, associations, revision and outbox commit consistently. Success survives qualified restart; uncertain outcome retains enough evidence for reconciliation. |
| S07 network effects | Retried delivery has at-most-once accounting effect. Acknowledgment refers to exact identity/sequence/hash/revision. A stale response cannot clear newer work. |
| S08 authority | Every sensitive effect uses current account/device/generation authority. Revocation, transfer and restore fence stale actors at declared linearization points. |
| S09 read semantics | Reads do not mutate persistent state; pagination and projection reads represent a declared snapshot and detect stale cursors. |
| S10 projection equivalence | Optimized rollups and queries equal an independent fold of canonical contributions, including correction, migration, deletion and reindex. |
| S11 privacy | Only explicitly allowed numeric facts/public identities cross each boundary. No prompts, paths, tool arguments, credentials or private labels leak through errors, exports, caches or telemetry. |
| S12 deletion and consent | Withdrawal/erasure cannot be undone by delayed work or restored backups beyond the explicitly retained control evidence and documented public cache bound. |
| S13 resources and liveness | Every allocation/I/O/query/retry/retention path is bounded. Under stated recovery/fairness assumptions valid work can progress; refusal has a usable recovery path. |
| S14 product fidelity | Dashboard, CLI, CSV, charts and accessible tables express the same selected facts, units, cohort and coverage. |
| S15 supply chain and deployment | Qualified artifact identity, source, toolchains and deployed service identity agree. Feature flags reflect current qualification, not historical source-test success. |
| S16 benchmark integrity | Comparisons preserve benchmark/config/version distinctions and dated evidence; missing measurements are not zeros, and personal usage is not benchmark capability. |

### Measurement representation

Use one semantic specification with versioned profile mappings; do not force every existing format into a breaking replacement at once.

A numeric fact needs:

- Stable observation identity and revision, source/account/device ownership and an explicit overlap/replacement domain.
- Client, provider, model/version and public catalog revision; preserve unknown identity. Account or project labels stay local unless a separately reviewed private numeric/pseudonymous feature requires them.
- Grain: request, response, turn, session, aggregate interval, cumulative counter or billing snapshot. Grain is not interchangeable with a generic record count.
- Event time, measurement/terminal time, acquisition time, publication time, clock basis and uncertainty. Coverage uses half-open intervals with an explicit timezone/calendar policy.
- Exact quantities with units and evidence: observed, derived from measured facts, estimated, unknown, unsupported or invalid. Valid zero is a value, not a fallback.
- Numerator and denominator eligibility for each derived metric; completeness belongs to that population, not the report as a whole.
- Token inclusion/subset rules; cost kind/currency/tariff/effective dates; timing kind; outcome/lineage/origin only when explicitly observed.
- Parser/schema version, qualification status, exclusions and diagnostics, with fixed bounded reason codes.
- Correction/tombstone predecessor and idempotency identity; a normalized row never silently repairs malformed provider evidence.

Keep canonical exact counts in checked integer types and decimal strings at JSON boundaries. Use rational pairs for rates and means; round only for display or at a declared monetary boundary. Prove representability across Rust, TypeScript and SQL encodings.

The existing wire profile keeps reasoning inside output. Its total is uncached input + cache read + 5m write + 1h write + inclusive output. Detailed stats splits reasoning from output; its total includes both disjoint output and reasoning. A conversion must prove the partition relation, retain unknown TTL/subset evidence and never add reasoning twice.

Preserve existing independent measurements until a qualified mapping establishes equivalence. Historical/live views of overlapping usage cannot simply be concatenated. A daily aggregate cannot establish a request distribution or be honestly rebucketed into arbitrary local days.

## Metric catalog and dashboard product

The product should support a finite, versioned catalog of trustworthy metrics and a bounded explorer over compatible dimensions. “Everything interesting” means broad coverage with extension rules, not arbitrary formulas that bypass units, ownership or missingness.

Every metric registry entry must define ID/version, question, unit, required source capabilities, grain, numerator/denominator, aggregation state, rounding, dimensions, correction/deletion rule, exactness/error contract, coverage display and validation reference. A metric without its required evidence renders unavailable with the reason and supported collection path.

Status codes below: **A** = current detailed aggregates largely support it after semantic repairs; **L** = an existing local profile supplies partial evidence, integration required; **N** = new instrumentation or retained numeric facts required; **E** = explicit user/provider billing evidence required. Status is potential data availability, not a claim of current UI or live qualification.

| Family / user question | Catalog entries | Basis and implementation requirements |
| --- | --- | --- |
| Token volume — what was consumed? | Total accounted tokens; uncached input; cache read; cache write by TTL when known; inclusive output; visible/non-reasoning output when known; reasoning subset; billed versus model-consumed tokens; text/audio/image token categories when explicitly reported | A/N. Preserve disjoint versus subset roles. Do not estimate modality tokens from bytes or durations without a labeled estimator. |
| Mix — where does usage go? | Client/provider/model shares; input/output ratio; reasoning share of output; cached-input share; write-input share; direct/root/descendant shares; unknown-model share | A/L/N. Shares need the same known population; total input includes write categories. Root-inclusive and descendant rows cannot both be added. |
| Trends — how is usage changing? | UTC day/week/month totals; local-calendar totals where event time exists; rolling 7/30/90-day volume; cumulative usage; matched previous-period absolute/percent change; weekday/hour heatmaps; active days; observed streaks; daily peaks | A/N. Mark incomplete days and partial current periods. Zero prior denominator yields an explicit new/no-baseline state. Streaks are observed presence, not proof of inactivity elsewhere. |
| Typical sizes — what is normal? | Mean input/output/total per request/response/turn/session; median/p90/p95/p99 sizes; min/max; histograms; long-tail share; distinct sessions/turns/requests | L/N. Need typed grain and per-observation facts or sufficient histogram state; cannot derive percentiles from daily sums. |
| Costs — what did it cost? | Source-reported charge; dated retail estimate; matched estimate-versus-charge difference; unpriced tokens/records; price coverage; effective dollars per million input/output/total tokens; cost by client/model/time/tier; historical repricing view | A/N/E. Keep reported/estimated/allocated/cash-paid amounts distinct. Preserve currency and rate version; match cohorts before differences. |
| Cache economics — what did caching change? | Token-weighted read/write share; requests with any cache hit; per-TTL write volume; reuse-to-write ratio over labeled windows; modeled cache savings; write-premium break-even | A/N. Token hit share and request hit rate are different. Savings are a counterfactual under the same tariff, not an invoice refund or causal latency claim. |
| Billing and limits — what remains? | Subscription period and paid amount; metered overage; credits/refunds; included-unit usage if provider-reported; remaining quota; utilization; effective allocated cost; budget consumed/remaining | E. No quota or subscription inference from model token counts. Keep native unit types such as requests/credits separate from tokens. |
| Latency and generation — how responsive was it? | Request latency p50/p95/p99; provider runtime; time to first chunk/token when actually measured; inter-token delay; output tokens per measured decode second; total tokens per source-duration second; timeout/cancel latency | L/N. Separate client wall time, provider time, request windows and inference spans. Streaming chunk is not necessarily a token. |
| Activity and concurrency — when was work happening? | Union active time; request-busy time; measured inference time; human/approval/tool waits; idle/unclassified exposure; peak and time-weighted concurrency; utilization; wall-time versus agent-time | L/N. Use half-open interval unions and explicit denominator coverage; never sum overlapping time into human work hours. |
| Sessions, turns and agents — what happened within a run? | Session/turn counts and observed durations; completed/aborted/open cohorts; direct versus inclusive descendant usage; tool requested/dispatched/completed/failed counts; tokens/cost/runtime per measured turn; agent fan-out and critical path when observable | L/N. Completion is not task success; requested is not dispatched; origin unknown is not human. Every mean has its own measured count. |
| Context and compaction — what drives repeated work? | Explicit context occupancy/max/percentiles; measured context limit fraction; compaction count/duration/token cost; pre/post context size; replay/retry token overhead; accumulated input across turns | L/N. Context capacity depends on model/config/version. Cumulative input is not unique information or context size; no prompt-content inspection is required. |
| Reliability — what work failed? | Error/refusal/cancel/timeout rates; retry counts; retry-associated tokens/cost; successful/failed request cohorts; late/missing final usage; parser schema refusals; rate-limit events | N. Denominator requires enumeration of attempts/outcomes; usage-only logs cannot establish zero failures. Do not call failed-task spend waste without user-defined outcome evidence. |
| Coverage and freshness — can I trust this chart? | Last attempt/success; acquisition/publication lag; data-through watermark; detected/selected/missing sources; warning/excluded/deferred counts; pricing/model attribution coverage; measured-denominator ratio; stale partitions; sync backlog/oldest age | A/N. Retain bounded health facts separately from immutable good usage; freshness cannot be copied blindly to every historical day. |
| Comparisons — what changed between tools or setups? | Side-by-side periods/models/clients/accounts/devices; matched-cohort rate/cost/size distributions; normalized per-request/per-turn comparisons; composition changes; counterfactual model pricing | A/L/N/E. Pin coverage, grain, region/tier, source version and time basis. Selection effects and counterfactual assumptions remain visible. |
| Budgets and forecasts — what should I watch? | User-defined token/spend budgets; pacing and burn rate; projected end-of-period usage; range forecast; coverage/staleness anomaly; spike/dip alert; threshold history and acknowledgments | N/E. Opt-in, deduplicated, rate-limited notifications; no message sending without explicit channel authorization. Forecasts are estimates with a baseline window and uncertainty. |
| Operations — is the collector healthy? | Scan duration/bytes/files; no-change work; incremental lag; queue depth; retry/rejection reasons; local DB/WAL size; cloud retained bytes and query work; version/qualification status | A/N. Fixed numeric diagnostics only; no private paths or account identities in general telemetry. |
| Benchmark context — how does this compare to published evaluations? | Sourced model capability/cost/speed context; calculator scenarios using explicitly selected personal usage aggregates; links to model/config evidence | A/N. Keep benchmark datasets and personal observation populations distinct. Never convert token volume into a productivity or intelligence score. |

### Required formula and aggregation laws

1. Sum only canonical disjoint contributions. Exact duplicate observations are inert; inconsistent duplicates refuse or follow an explicitly authorized revision rule.
2. Cache-read token share = read / (uncached + read + write5m + write1h + other proven-disjoint input). Require known category coverage or label a narrower observed-subtotal share.
3. Reasoning share = reasoning subset / inclusive output on the same measured population. Output/input ratios need compatible known buckets.
4. Aggregate mean/rate = sum eligible numerators / sum corresponding denominators. Never average device/day means or percentile values. Keep zero-denominator unavailable.
5. A request-throughput ratio uses the tokens belonging to the measured duration cohort. Wall-clock throughput uses interval exposure; output-generation speed needs actual decode timing.
6. Cost uses exact integer/rational rates keyed by model/provider/effective date/tier/region/currency. Preserve per-observation rounding policy; splitting one priced observation can legitimately change rounded microdollars, so do not assert false partition invariance.
7. Matched savings/deltas compare the same observation set and pricing scope. A mixed unpriced population cannot establish a complete cost difference.
8. Distinct counts require globally compatible identities or exact bounded sets. Approximate sketches have named error/confidence and merge rules.
9. Quantiles require retained samples or mergeable distribution state. Deletions/corrections rebuild an affected bounded partition when the chosen sketch cannot retract. Never merge only displayed p95 values.
10. Time union/concurrency use endpoint order and half-open spans. Corrections crossing midnight update both partitions. DST/local calendar queries require sufficiently fine timestamps; old UTC-only daily totals stay UTC.
11. Query grouping, chart buckets, tables, exports and “Other” categories conserve the same selected totals. Top-K is selected after global aggregation, not by summing incompatible local Top-K lists.
12. Cumulative counters require a proven compatible baseline/reset generation. Telescoping differences apply only to a monotone chain; an initial total is not automatically a new event.
13. Cross-source replacement needs complete coverage of the replaced scope. Neither larger totals nor matching file names prove overlap.
14. Every optimized result must equal an independent full fold under the same corrections, source ownership, coverage and pricing version.

### Shipping scope and capability ownership

Phase 0 expands each catalog entry into an individual registry row with one of required-to-ship, conditional-on-named-source-capability, or intrinsically-unobservable-for-this-profile. Planned work is never relabeled unsupported merely to close a phase. Every row names its producer, implementation phase, UI owner and acceptance fixture.

| Product slice | Delivery obligation and owner |
| --- | --- |
| Exact tokens, cache, dated costs, trends, comparisons and coverage | Required to ship through 3/4/6/7/7B; kernel, ingestion, query and UI owners respectively. |
| Request/session/turn/context/latency/reliability distributions | Required for qualified sources that expose the facts through 8 and 7B. Each missing historical field has a source-specific limitation; new supported live collection must have a working view. |
| Manual billing/subscription evidence | Phase 10 owns bounded account-private numeric amount/currency/period/credit/limit records with explicit user attribution and revisions; 7B owns their views. Provider-connected import is conditional on a supported authorized interface and its qualification. Never require a paid integration or upload an invoice document to provide manual entry. |
| Budgets and forecasts | Phase 10 owns private per-currency/token budgets, versioned threshold decisions, in-app history and bounded idempotent evaluation; 7B owns setup/pacing/forecast views. Start with a transparent trailing-window forecast, suppress invalid/insufficient-coverage estimates, and validate calibration on held-out synthetic histories. Currency conversion and subscription-limit inference are excluded unless separately evidenced. |
| Alerts | Phase 10 provides opt-in in-product threshold/staleness alerts, deduplication, cooldown, acknowledgment and correction/retraction behavior. External email/chat delivery is conditional on explicit channel authorization and separately qualified transport; it is not a prerequisite to the in-product capability. |
| Saved views, drilldown and exports | 7/7B own bounded saved public-filter definitions, snapshot-pinned private export and qualified shared summaries. Private custom labels default to local-only; account persistence requires an explicit reviewed data surface and privacy contract. |
| Device/account lifecycle | 5/10 own durable transfer/revocation/export/erasure and recovery; 7B owns complete user journeys. |
| Benchmark/calculator integration | 9 owns provenance/comparability and explicitly selected numeric scenario inputs; 7B checks navigation and private/public separation. |

The kernel lead resolves the theorem-route choice using Phase 3's measured acceptance. The integration owner resolves compatible schema/capacity and scheduling choices. The product/lifecycle owner freezes retention defaults and any irreversible erasure horizon in Phase 0 against existing promises and recovery needs; an unavoidable material policy conflict goes to the user before dependent reclamation. No other metric-catalog decision requires renewed permission within the authorized implementation scope.

### Dashboard experience

Use one account overview with concise tokens, costs, freshness and missing-source status. Provide focused tabs for Tokens, Costs, Performance, Sessions & agents, Reliability and Coverage, with common date/cohort filters and a persistent definition/coverage disclosure for each metric.

The explorer should support bounded group-by combinations, sortable tables, distribution views, period comparisons and drilldown from a chart to its numeric contributions. Keep source/client/model/provider filters globally coherent. Device and private project/workspace dimensions require explicit private/local policy; do not upload filesystem names by default.

Preserve the local-file mode, offline inspection and readable CLI JSON. Saved views can retain only public filter IDs by default; no private report data in URLs. Pin exports to a snapshot and include metric version, units, basis, coverage and precision. Shared images/text must carry qualifiers in the artifact itself, with an explicit preview of disclosed dimensions.

Provide keyboard-equivalent navigation, accessible tabular values, screen-reader summaries, touch targets, color-independent encoding, loading/cancellation states, and truthful empty/partial/stale/error states. A large report should remain usable on modest hardware. Account switch, sign-out, tab restoration and late response handling must prevent stale private render.

## Formal verification design

### Method selection

| Tool | Initial use | Evidence boundary |
| --- | --- | --- |
| TLA+ and TLC | State machines for fences, outbox/ack, multi-device contributions, supersession, pairing, consent, deletion and migrations | Exhaustive exploration of the declared finite configuration. Larger-state or unbounded claims need a separate argument/proof; implementation correspondence is explicit. |
| Kani | Production Rust normalization, checked sums/prices, codecs, prefix/range decisions, receipt predicates and small transition kernels | Symbolic coverage of represented inputs with successful safety/unwind/reachability checks. Keep collection bounds and external stubs visible. |
| Lean with Aeneas pilot | Exact aggregation/coverage/rounding laws and one extracted production reducer | Kernel-checked theorems over the actual translated definitions and declared assumptions; extraction/compiler/FFI remain trusted boundaries. |
| Direct Verus pilot alternative | Same pure Rust kernels with executable specifications in production source | Select if it provides a more maintainable direct implementation connection than the Lean route. Do not maintain two unproved handwritten mirrors indefinitely. |
| Hegel and fast-check | Stateful generated commands through real storage and adapters, independent oracles and counterexample shrinking | Sampled conformance with action coverage and replay seeds; retain named regressions. |
| Fuzz/crash/differential/native/browser tests | Foreign bytes, DB/OS/provider/browser boundaries outside proofs | Tested runtime behavior on named versions/platforms; retain existing integration gates. |

Use official references when qualifying tools: [TLA+](https://lamport.azurewebsites.net/tla/tla.html), [TLC](https://github.com/tlaplus/tlaplus), [Kani](https://model-checking.github.io/kani/), [Lean reference](https://lean-lang.org/doc/reference/latest/), [Aeneas](https://github.com/AeneasVerif/aeneas), [Verus](https://github.com/verus-lang/verus). Pin artifacts and hashes chosen by the pilot; Valhalla's tool versions are precedents, not automatically compatible with AI Charts Rust 1.97.1.

### TLA+ portfolio

Begin with small composable models and then check their critical joins. Initial finite configurations use two devices, two sources/days/observations, a small revision space, one operator and bounded queues. These cardinalities are model exploration limits, never substituted production capacities.

| Model | State/actions to include | Safety and conditional liveness |
| --- | --- | --- |
| M1 Restore lifecycle | Epoch, fence phase, lease identity/deadline, real operation stage, SQL/provider effects, status/audit/migration, clocks, close/drain/restore/publish, delayed completion | Drained means no old work can change canonical authority or visibility. Distinguish late unreferenced immutable writes from committed effects and account for their eventual cleanup. Model an operation remaining alive after TTL. Recovery terminates only under named availability/fairness assumptions. |
| M2 Local ledger and outbox | Source version/prefix, parser state, waves, canonical facts, associations, pending/frozen bytes, receipt, crash/reopen/reindex | Cursor never outruns committed evidence; successful state reopens; exact retry has one accounting effect; old ack cannot clear a newer contribution. Include F01 and source-size/partial-scan states. |
| M3 Cloud admission | Device sequence, account revision, reserve/freeze/immutable bytes/journal/publish, reject, help, revoke, lost reply | One terminal decision per revision; atomic rejection; heads equal accepted-history fold; exact receipt/sequence and idempotent charging. |
| M4 Contributions and ownership | V1/v2 scope, overlapping versus disjoint populations, writer generation, complete replacement intervals, transfer, A→B→A, correction, abandonment | No foreign contribution loss or duplicated overlap; superseded work stays superseded; transfer preserves history and fences the old writer. |
| M5 Pairing and private reads | Browser/terminal intent, account match, freshness, expiry, request abort, auth generation, refresh, caches, late reply | Every effect belongs to the correct current account and exact attempt; sign-in never approves an unrelated pairing; private data cannot render after authority closes. |
| M6 Consent and deletion | Ordered decisions, index delivery, compensation, tombstones, cache deadlines, erasure, delayed grant/upload, backup restore | No unauthorized publication or resurrection; bounded documented withdrawal visibility; one unresponsive source cannot starve index maintenance. |
| M7 Query and migration publication | Projection version, staged backfill, old/new readers, watermark, cursor, correction, compaction, GC | No mixed revision; pure reads; rebuild equivalence; no deletion of authoritative evidence still needed by readers or recovery. |

For every action, record the actual function/effect boundaries and the abstraction from persisted state into model state. Replay model counterexamples against Rust/Worker adapters. Also generate valid/adversarial commands and injected fault schedules through real production boundaries, compare abstracted implementation state and observations after every step, and assert per-action/per-outcome coverage. Include a production-only mutant that the unchanged specification and conformance harness reject. Known traces alone cannot establish ongoing model correspondence. A passing model plus conformance tests remains model verification and tested correspondence unless an actual refinement proof is supplied.

Safety must survive arbitrary modeled loss/reordering/delay without fairness. Liveness requires explicit eventual storage/network recovery, valid authority, finite interference and appropriate weak/strong fairness. Include non-vacuity witnesses, overflow/capacity refusal, deadlock checks and mutants that restore each known bug. A timeout or empty reachable success set is not a pass.

### Production proof kernels and theorem pilot

Prioritize these small extracted kernels with stable interfaces:

- Checked token partition/normalization and warning-code completeness.
- Conflict-aware occurrence/revision merge and deterministic materialization.
- Canonical frame length, offset, count, reserved-field and round-trip predicates.
- Prefix completeness and source-range replacement predicates.
- Exact price multiplication, summation and rounding/refusal.
- Receipt equality, revision/sequence advancement and pending-successor preservation.
- Coverage/eligible-population folds, rational mean laws, interval union and correction conservation.

For Kani, exercise actual production functions with independent wider-integer/math predicates. Keep overflow, memory safety, undefined functions, unwinding assertions and success/rejection covers enabled. Report each quantified scalar domain and bounded container length. Split tractable byte-length partitions without pretending a selected small codec proof covers all production lengths.

The Lean/Verus pilot owns two real kernels: token normalization/checked aggregation and conflict-aware revision/replacement reduction. It must also prove an unbounded finite-history aggregation law. Compare exact extraction/same-source execution, admitted assumptions, change cost, proof/runtime size, solver reproducibility and clean Linux CI. Mutating checked addition into wrapping addition or weakening ownership must fail the appropriate proof.

Choose one main theorem route after the pilot. If production extraction is unsupported, retain any Lean result as a labeled mathematical specification and use production Kani plus differential tests, or choose direct Verus. Do not weaken the semantics, lower production capacity or rewrite large I/O subsystems just to obtain a proof badge.

### Trusted computing base and proof hygiene

List rather than hide trust in source/provider identity and schema semantics, cryptographic collision resistance/RNG/TLS, SQLite transactions, OS file/process identity and durability, runtime cancellation, cloud storage guarantees, compilers, theorem kernel, extractors and solvers. Differentiate ordinary corruption, accidental rollback, malicious provider data and same-user/root tampering.

Each proof receipt includes exact Git tree, tool/solver/extractor hashes, lockfiles, flags, assumptions, model configuration, property/harness/theorem counts, elapsed time and result. Refuse zero obligations, missing covers, unsupported operations, timeout or unknown outcomes for a claimed proof gate. Audit every assumption, trusted external, admitted axiom and skipped branch. Lean builds must reject sorry/admit and audit theorem axioms; equivalent Verus external/trusted bodies need the same review.

A proof inventory should generate the coverage documentation. Changes to a registered implementation, invariant or assumption trigger the affected evidence. Specifications and invariant weakening require independent review. Performance claims and live qualification receipts use separate categories.

## Storage, performance and operating design

### Canonical contributions and scalable derived state

Keep authoritative facts and control decisions separate from rebuildable projections. Reuse current SQLite/Durable Object/R2 ownership where it remains appropriate. This plan does not authorize a database migration to a new provider or unlimited raw event uploads.

Locally, persist enough numeric source identity, revision and parser checkpoint state to make incremental import equivalent to a full scan. Include the cumulative baseline, fork/dedup state, source content witness, parser version and partial tail. A file mtime can be a hint; it is not the sole proof that no relevant content exists.

In the cloud, use source/device ownership partitions with proven overlap/replacement domains and immutable control history for transfer, revocation, supersession and erasure. A device is an acquisition actor, not automatically an independent usage population. Prove whether a mirrored source is a copy or a distinct provider account before combining it.

Retain an authoritative committed-publication manifest/journal binding revision, snapshot/body hash, scope, ownership generation and terminal outcome. Its commitment must be atomic with canonical publication and independently checkable during recovery. R2 object or receipt presence alone cannot establish commitment: bytes can precede SQL publication or survive an abandoned intent. A rebuild includes exactly committed contributions; GC distinguishes committed, pending, superseded and orphaned objects under the frozen retention policy.

Update daily/hourly and bounded dimension rollups from canonical contribution deltas in the same publication transaction, or publish them under a versioned staged watermark. Maintain exact sums/counts and coverage state. Store distribution summaries only where their merge/correction semantics are defined. Keep immutable bytes in the content tier and references/control metadata in transactional storage, subject to recovery requirements.

Give summaries a compact endpoint and drilldown snapshot cursors. Server filters use allowlisted dimensions, explicit row/byte/time/cardinality limits and indexed plans. Never respond with a truncated “total.” A rejected large range should offer pagination/coarser resolution without erasing detail. Queries must not run persistent backfills.

Current 8,192-row/4 MiB hosted and 65,536-row/32 MiB local report limits remain explicit until measurement justifies change. Lifetime storage caps need warnings, recoverable compaction and retention rules before refusal. GC uses reachability, active readers/pending flights and tombstone/recovery horizons; never delete old evidence merely to reset a budget.

### Performance qualification matrix

The following are proposed engineering budgets to ratify against representative query/storage workloads in Phase 6. Phase 0 records the diagnostic baseline. They are targets, not current performance claims. Keep operation-count budgets mandatory even when wall-clock tests are noisy.

| Workload | Proposed target / deterministic contract |
| --- | --- |
| No-change import | Avoid parsing unchanged verified sources; retained metadata/index work is bounded and observable. Typical warm no-change interaction target ≤1 second. |
| Incremental append | Parsing proportional to appended bytes plus bounded checkpoint verification; no repeated lifetime replay for qualified adapters. Retain full-scan audit mode. |
| Large cold import | Stream within documented limits; demonstrate many-small-file, 2 GiB JSONL and large aggregate stores. Aim for ≤256 MiB incremental parser RSS excluding explicitly bounded external buffers; ratify throughput per machine. |
| Hosted summary | Query work proportional to selected indexed partitions, not lifetime head/journal count. Initial target warm p95 ≤300 ms, cold p95 ≤1 second at the declared deployment/load. |
| Snapshot drilldown | Bounded pages and stable cursors; cancel expensive superseded reads. No account-wide JSON assembly for a small chart. |
| Browser load/filter | Typical summary usable ≤1 second after data arrival; filter/render p95 ≤100 ms on reference modest hardware. Move heavy parsing/folds off the main thread when needed; no long task >50 ms in the representative interactive flow. |
| Local max report | Qualify 32 MiB/65,536 rows including high cardinality, import memory, cancellation, table virtualization and exports; low-cardinality helper timings alone do not qualify it. |
| Background maintenance | Bounded batch/cursor with restart and backpressure; no synchronous full-history audit on every cold request. Maintain explicit scrub/recovery evidence. |
| Sustained service | Measure p50/p95/p99 with adequate independent samples, burst concurrency, slow R2, restore, rejections and retries. No unbounded queues, leaked permits, unowned child processes or hidden write amplification. |

Use synthetic fixtures at small, typical and maximum admitted capacities: empty data, 1/30/366 days, 8,192/65,536 rows, 100k/1m retained heads, high model/device cardinality, duplicate mirrors, late corrections, long spans, huge sparse/partial files and adversarial small-file counts. Do not silently lower the production cap in tests that claim max-capacity coverage.

Record hardware/OS/runtime/source tree, warm/cold state, fixture seed, samples, wall/CPU time, peak RSS, rows/bytes scanned, DB/WAL/R2 growth, read/write amplification, response bytes and provider unit cost. Compare optimized output to a slow independent oracle. Repeat performance measurements after correctness changes that affect the measured path.

Index additions require reviewed schema/version/exact-object-manifest changes: the current enrollment checker rejects non-table schema objects. Adding an index without fixing that contract would fail admission.

## Verification matrix beyond formal tools

| Boundary | Required independent evidence |
| --- | --- |
| Provider adapters | Versioned sanitized fixtures, provenance and capability manifest; malformed/unknown schema behavior; late records/corrections/forks; independent provider totals for explicitly qualified samples |
| Pure metric code | Named examples, property laws, independent reference fold, exact integer boundaries, mutations, Kani/theorems where selected |
| Rust ↔ TypeScript ↔ SQL ↔ browser | Canonical valid and invalid vectors, >2^53 counts, timestamp/decimal limits, profile mappings, warnings, null/zero/estimated preservation |
| Local persistence | Hegel command sequences through real SQLite/files; crash before/after each effect; fresh-handle reopen; fsync/rename/disk-full/permissions; retained historical migration fixtures |
| Cloud persistence | Real workerd tests plus domain simulation; R2 success with lost reply, SQL failure, delayed continuations, revocation/restore/transfer races; committed-head/reference-fold agreement |
| Source acquisition and process custody | Read-only explicit roots; symlink/path replacement; concurrent rewrite/truncation; content redaction; descendant lifecycle and ECHILD; deadline and permit settlement |
| Identity and privacy | Tenant/device separation, replay, wrong issuer/audience/origin/attempt, key rotation, expiry/refresh, sign-out/account-switch/bfcache; negative transcript/path/secret canaries |
| Query and UI | Snapshot pagination, drilldown/table/chart/CSV consistency, filter algebra, compare eligibility, stale/partial/zero states, accessible keyboard/touch/browser journeys |
| Retention/recovery | Export/erase/revoke/transfer, interrupted migration/backfill/GC, backup restore, tombstone non-resurrection, recovery-time/data-loss targets and data-preserving rollback |
| Benchmarks/calculator | Frozen source/schema/config identity, units/nulls/frontier/tie laws, refresh retention/material-change guards, dates, scenario assumptions, share/export parity |
| Supply chain/platform | Dependency/provenance/security checks, source-to-artifact identity, archive refusal, reproducible components, install/upgrade/uninstall/recovery and separately qualified macOS/Linux capabilities |
| Operations | Complete cost surfaces, no writes on reads, bounded telemetry, capacity forecasting, health/freshness, fault/soak load and deployed identity |

Source qualification should start with Codex, Claude, Cursor and Devin because they exercise cumulative/incremental counters, cache semantics, forks, refresh replacement and provider duration. Then expand to active high-value clients, explicitly credential-refreshed clients, and the remaining parser roster. Every advertised adapter must be classified as fixture-supported, live-qualified for a named version, limited, or unsupported; no unqualified family inherits another adapter's status.

Map incoming OTel numeric observations through a pinned translation contract. Current [OpenTelemetry GenAI metrics](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md) distinguish operation duration and first-chunk timing. The conventions are evolving; record the accepted revision and evidence instead of silently adopting renamed fields.

## Dependency-ordered execution plan

Implementation is authorized. Phase status and the implementation log below are authoritative; audit evidence remains tied to its original baseline.

The integration owner controls manifests/lockfiles, shared schemas/capacity/metric registries, generated vectors, root scripts/workflows, costs.json, AGENTS changes and this plan. Workers propose edits to those surfaces for one converging owner. No parallel lane may independently edit a shared convergence file.

| Phase | Observable deliverable | Depends on | Write ownership | Safe parallel work |
| --- | --- | --- | --- | --- |
| 0 | Frozen assurance/metric/capacity/retention contracts and baseline corpus | None | Integrator: registries, fixtures manifest, plan, commands | Read-only sizing/research |
| 2A | Failing baseline restore/ownership models and frozen safety properties | 0 | Formal owner: verify/tla and audit trace corpus | 1A, 1C |
| 1A | Reopenable, honest local collection | 0 | Native owner: core/ledger/CLI source-range and warning paths | 1B, 1C, 2A |
| 1B | Safe cloud ownership, supersession and restore repair | 0, 2A | Cloud owner: usage-worker admission/enrollment/stats/fence | 1A, 1C |
| 1C | Correct dashboard metric populations and account cache lifetime | 0 | UI owner: components/usage stats/cache/account views | 1A, 1B, 2A |
| 2B | Checked repaired protocols and generated implementation conformance | 2A, 1A, 1B, 1C | Formal owner: verify/tla and conformance harnesses; integration owner wires production adapters | 3/4 in disjoint files |
| 3 | Verified numeric kernel and theorem-route decision | 0, 1A | Kernel owner: new owned metric kernel and verify/kani/lean-or-verus | 4 source qualification; model-only extensions |
| 4 | Qualified, incremental source facts and health | 1A, 0 | Ingestion owner: imports/adapters/checkpoints/refresh and tests | 3 in new kernel paths; 5 after shared contract frozen |
| 5 | Multi-device canonical account data and safe schema migration | 1B, 2B, 3 | Cloud owner: explicit contribution/control schema and authority adapters | 4; 7 UI fixtures/contracts before server integration |
| 6 | Fast exact rollups, bounded queries and long-term retention | 5, 3 | Storage/query owner: rollup/query/backfill/GC paths | 7 UI consumes frozen API |
| 7 | Complete private explorer with truthful metric catalog | 1C, 3; 6 for hosted completion | UI owner: usage dashboard, typed query clients and browser tests | 6 under frozen API; 9 benchmark-only code |
| 8 | Request/session/turn/latency/context evidence and private drilldown | 4, 5, 6, 3 | Instrumentation owner: numeric session/turn adapters and hosted joins after query/storage convergence | UI fixture development in 7; 9 |
| 9 | Whole-site benchmark/calculator/companion assurance | 0, 3 | Product owner: benchmark/calculator/companion paths; separate native lane if needed | 4–8 where files disjoint |
| 10 | Complete account privacy, recovery and operational lifecycle | 5, 6, 8 | Lifecycle owner: authority/erasure/export/control/operations; shared cloud files now exclusive | UI accessibility finishing outside account-state files |
| 7B | Integrated rich metrics and complete account journeys | 6, 7, 8, 10 | UI owner: explorer/account views and full browser journeys | Independent read-only review |
| 11 | Converged proof, fault, performance and security gates | 1A, 1B, 1C, 2A, 2B, 3–10, 7B | Integrator plus independent reviewers; no divergent edits during final gate | Disjoint bounded check shards with one owner each |
| 12 | Protected delivery and qualified production product | 11 | Release/integration owner | External waits release host lanes; independent evidence review |

### Phase 0 — Contracts and executable assurance inventory

- **Status:** Complete
- **Depends on:** None
- **Objective:** Every surface, metric and claim has an owner, an exact meaning and an evidence requirement.
- **Scope:** New proof/metric/capacity/capability manifests, audited synthetic regression corpus, compatible profile mappings, current architecture and SLO baseline; retention, deletion, backup, replay/tombstone horizons and recovery objectives.
- **Out of scope:** Large parser rewrites, feature activation or new infrastructure.
- **Approach:** Preserve v1/v2 public contracts; model canonical source ownership before designing multi-device merge. Record the current measured baseline and proposed SLOs without claiming qualification. Phase 6 ratifies workload-specific SLOs before performance-dependent feature acceptance. Record all data surfaces and current runtime/platform support.
- **Acceptance:** Every F01–F26 maps to a phase and regression/proof obligation; no unknown source field becomes zero; all existing caps agree or have explicit distinct names; corpus contains the native/cloud/formula traces; every metric catalog row has an implementation/evidence status. Retention and recovery policy is frozen before Phase 6 can reclaim any physical data; unresolved material retention decisions block reclamation, not unrelated work.
- **Validation:** Existing bun run check:cost-surfaces plus new registry/capacity/link checks created by this phase. Run the retained synthetic probes against the original baseline and confirm they detect the expected failures before using them as repair tests.
- **Recovery:** Additive metadata and fixtures only; retain original payload/schema fixtures and baseline receipts.

### Phase 2A — Baseline protocol counterexamples

- **Status:** Complete
- **Depends on:** 0
- **Objective:** Restore and contribution/supersession defects have executable counterexamples and frozen safety properties before their protocol repairs are accepted.
- **Scope:** Initial M1/M4 specifications, finite TLC configurations and baseline trace fixtures in verify/tla.
- **Out of scope:** Calling an abstract model a proof of the existing implementation.
- **Approach:** Reproduce lease expiry with live continuations, unfenced effects, foreign-device replacement and A→B→A. Agree with the cloud owner on commit/authority/visibility boundaries and permitted immutable orphan effects.
- **Acceptance:** Faulty baseline models fail the intended invariants with reachable nontrivial states; production traces match the failure mechanism; repaired design constraints and environmental assumptions are reviewed independently. Phase 1B may then implement against this frozen contract.
- **Validation:** Introduce pinned usage:formal:tla with explicit expected-failure baseline tests and successful sanity configurations; a negative-control failure is required evidence, not a green safety claim.
- **Recovery:** Additive models/fixtures only; do not weaken a safety property to admit the current implementation.

### Phase 1A — Native correctness repairs

- **Status:** Complete
- **Depends on:** 0
- **Objective:** Successful collection always produces a reopenable ledger and truthful scan/coverage evidence.
- **Scope:** F01, F05–F08, initial F14 custody regression; core merge, ledger warning/migration, CLI collection/refresh.
- **Out of scope:** New hosted metric schema or automatic repair of private user files.
- **Approach:** Decide explicit attribution conflict/migration rules; replace unsafe mtime proof with validated metadata or a conservative fallback; align range replacement; persist all diagnostics; reuse owned-process custody.
- **Acceptance:** All native counterexamples become deterministic regressions; successful commits reopen to the same canonical projection; undefined partial-dominance histories refuse, with retained legacy conflicts inspectable/exportable; every omitted selected source has a fixed machine-readable reason; Cursor preserves outside-range data; warning encoding is exhaustive and old databases upgrade without lost facts; subprocess completion includes bounded descendant settlement.
- **Validation:** cargo test --locked -p aicharts-core -p aicharts-ledger -p aicharts-cli -p aicharts-import; cargo clippy --workspace --all-targets --locked -- -D warnings; cargo fmt --all -- --check. Add focused named tests for each trace and platform-qualified process fixtures.
- **Recovery:** Back up exact affected ledger/schema and verify recovery on copies before any live migration. No reset/truncate or forced checkpoint acceptance.

### Phase 1B — Cloud safety and ownership repairs

- **Status:** Complete
- **Depends on:** 0, 2A
- **Objective:** Restore, retry, migration and revocation preserve authority and every distinct contribution.
- **Scope:** F02–F04, F09–F13; admission/enrollment/stats/fence effect boundaries and capacity parser compatibility.
- **Out of scope:** Raising provider spend or exposing new public rankings.
- **Approach:** Use Phase 2A's failing baseline traces to define safe commits and late-effect handling. Remove implicit whole-account replacement and automatic ABA; add a reviewed writer recovery transition. Route persistent maintenance through an explicit fenced owner.
- **Acceptance:** Ambiguous v1/v2 overlap is refused while retained legacy measurements remain readable; Phase 5 must qualify exact population proofs so disjoint 120+15 remains 135 and proven copies count once; delayed old A cannot replace B or charge again; a revoked v2 writer cannot publish a new operation but a verified successor can. Preserve v1's declared linearization: pre-freeze revocation rejects; an already-frozen terminal decision remains reconcilable. Status/read/constructor effects are classified and covered; lease expiry cannot stand in for drain; 100,001 admitted records do not corrupt response handling; ordinary reads issue no persistent DML.
- **Validation:** bun run usage:worker:check; bun test lib/usage/admission.test.ts lib/usage/private-days-contract.test.ts lib/usage/stats-http-contract.test.ts. Add real-workerd concurrent-delay/restore tests and replay model traces through actual adapters.
- **Recovery:** Additive schema/epoch migration, immutable intent/receipt, bounded dry run, compatible recovery artifact and explicit reconciliation. No ad hoc fence bypass.

### Phase 1C — Metric truth and private browser lifetime

- **Status:** Complete
- **Depends on:** 0
- **Objective:** Existing UI summaries express valid populations and never optimistically reuse another identity's report.
- **Scope:** F15–F17/F23 and shared-image qualifiers.
- **Out of scope:** Pretending daily aggregates contain request distributions.
- **Approach:** Correct cache denominator/coverage; suppress unmatched cost deltas and causal explanations; label record/duration basis; bind ephemeral reports to an authenticated generation and clear late reads consistently.
- **Acceptance:** Synthetic 100/900 cache example displays 10% only with complete input evidence; missing buckets withhold complete share; disjoint $1/$3 observations have no savings claim; account-switch/bfcache/late-response cases preserve isolation; local files survive account cleanup; image/text/CSV include applicable basis and coverage.
- **Validation:** bun test components/usage/stats-view.test.ts components/usage/stats-report-view.test.tsx lib/usage/account-generation-read.test.ts components/usage/stats-dashboard.test.tsx lib/usage/account-session-events.test.ts; bun run test:browser through the repository's browser procedure.
- **Recovery:** Reversible UI change with schema-compatible display; preserve available reports and explicit unavailable states.

### Phase 2B — Repaired protocols and implementation conformance

- **Status:** Complete
- **Depends on:** 2A, 1A, 1B, 1C
- **Objective:** M1–M7 have checked safety properties, explicit conditional liveness and replayable counterexamples.
- **Scope:** verify/tla, model/action maps, trace format and CI evidence.
- **Out of scope:** Unqualified claims that TLC establishes arbitrary-size production correctness.
- **Approach:** After 1A/1B/1C converge, complete repaired M1/M4 and the remaining local ledger/admission, authority/consent and query/migration specifications. Later feature phases extend their relevant model and conformance cases as they implement new transitions; this phase establishes the maintained framework.
- **Acceptance:** Known faulty designs fail named invariants; repaired designs pass nontrivial finite configurations; every success/rejection/recovery branch has a witness; expected model count/configuration and assumptions are recorded; no hidden deadlock or fairness-dependent safety claim. Generated commands/faults compare actual Rust/Worker state through the abstraction mapping after every step; action/outcome coverage and a production-only mutation demonstrate that correspondence is being checked.
- **Validation:** Extend usage:formal:tla from 2A to repaired configurations with expected properties/counters and failure on timeout/incomplete exploration. Introduce usage:conformance:check for generated production/model schedules plus trace replay. Retain the unchanged aggregate gate.
- **Recovery:** Models are additive; a failed proof blocks the affected correctness claim, never forces acceptance by weakening an invariant.

### Phase 3 — Exact metric kernel and theorem pilot

- **Status:** In progress — production Kani/Lean gates admitted on macOS and, from PR #422, executed on the required ubuntu-24.04 Formal verification job with reviewed Linux Kani exceptions; rounding harness bounded to a deterministic domain, conformance through M12 and the nightly suite landed; source refinement and unbounded claims remain open
- **Depends on:** 0, 1A
- **Objective:** Production arithmetic/normalization and core aggregation laws have appropriate proof evidence.
- **Scope:** A new I/O-free owned metric kernel (proposed crates/aicharts-metrics), Kani harnesses, profile mappings and one theorem-route pilot. The integrator owns changes to existing callers shared with ingestion lanes.
- **Out of scope:** Reimplementing SQLite, TLS, JOSE, arbitrary vendor parsers or the whole UI in Lean.
- **Approach:** Use the same-source/extracted two-kernel comparison described above; preserve integers, missingness, compatible identities and explicit rounding.
- **Acceptance:** Overflow/refusal and partition laws hold over declared domains; full scalar bounds remain production-sized; checked profile conversion never duplicates reasoning or fabricates TTL; mutants fail; selected theorem route has a maintained production connection or honestly labeled specification-only status.
- **Validation:** Define usage:formal:kani and usage:formal:theorems with pinned toolchains and nonzero obligation checks. Run affected cargo tests and cross-language vectors plus bun test lib/usage/wire.test.ts lib/usage/rollups.test.ts lib/usage/turns.test.ts.
- **Recovery:** Keep executable interfaces compatible; reject an unsupported extraction route without forcing a broad runtime rewrite.

### Phase 4 — Source qualification, incremental ingestion and health

- **Status:** In progress — checkpoint generation 3, incremental ingestion across all advertised local sources and a per-publication source-health-v1 summary landed; private provider qualification and hosted publication remain open
- **Depends on:** 0, 1A
- **Objective:** Advertised source support has evidence, collection scales with changes, and failed refreshes remain visible.
- **Scope:** F18/F19; vendor compatibility target, source/version manifest, numeric health channel, checkpoints and refresh acquisition.
- **Out of scope:** Prompts/content uploads or blanket “all versions supported” claims.
- **Approach:** Qualify the first four clients, then the roster. Carry cumulative baseline/fork/dedup/parser state and content witness together. Retain a full-scan oracle and independent event-range evidence.
- **Acceptance:** Full/incremental equivalence under append/copy/mtime/rotation/truncation/late corrections; partial tails and malformed schemas are explicit; stable no-change scans avoid reparsing; successful stats do not hide clamp/fallback provenance; every advertised adapter is classified; health survives publication failure without replacing good history.
- **Validation:** cargo test --locked -p aicharts-import -p aicharts-cli -p aicharts-core; a newly maintained usage:adapters:check that actually compiles/runs relevant vendor tests; fuzz/properties with named seeds and bounded work. Private provider qualification uses explicit test accounts/roots and records only sanitized numeric evidence.
- **Recovery:** Preserve current working acquisition until replacement qualifies; replay from retained source/checkpoint without deleting published history.

### Phase 5 — Canonical account contributions and migration

- **Status:** In progress — durable contributions, bounded retained-data migration, exact head/query RPC/HTTP joins, native rich-fact producers with revision-ledger sync and the reviewed rebuild cutover CAS landed; full recovery and live contribution qualification remain open
- **Depends on:** 1B, 2B, 3
- **Objective:** Multi-device reporting, corrections and v1/v2 transitions have one lossless ownership model.
- **Scope:** Contribution/control schemas, source overlap/replacement proofs, writer transfer (retired with the writer concept in PR #427), generation/capacity contract and numeric private facts.
- **Out of scope:** Treating device totals as automatically disjoint or buying a new data platform.
- **Approach:** Prefer independent contributions with stable observation/provenance identity; use complete snapshots only within explicitly owned scopes. Retain v1 compatibility until a verified takeover covers its facts. Separate canonical controls from derived stats.
- **Acceptance:** Mirrored histories deduplicate, disjoint histories sum, incomplete scans never erase, moving corrections update old/new cells, old writer callbacks refuse, and retry/rejection uses capacity once. Genuine old database fixtures migrate atomically or recover with original bytes intact.
- **Validation:** bun run usage:worker:check; cargo test --locked -p aicharts-ledger -p aicharts-cli; model M3/M4/M7 checks; generated Rust/TS/SQL vectors and migration crash matrix.
- **Recovery:** Additive dual-compatible migration with dry-run conservation digest/counts, staged activation and compatible recovery binary; never roll back committed authority by restoring old application code alone.

### Phase 6 — Derived storage, queries and retention

- **Status:** In progress — exact correction cells, indexed queries, coalesced publication, bounded automatic work, the reviewed rebuild cutover CAS and the flag-off reclamation ledger (M12) landed; legacy resolution, live reclamation activation and operational qualification remain open
- **Depends on:** 3, 5
- **Objective:** Dashboard queries are bounded and fast while every result remains rebuildable from canonical facts.
- **Scope:** F20/F21; indexes/exact manifests, sufficient statistics, partition rebuilds, snapshot cursors, resource accounting and GC.
- **Out of scope:** Arbitrary-dimensional cubes or unbounded raw-cloud history by default.
- **Approach:** Indexed day/revision access, atomic delta counters, compact summaries, paginated drilldown, explicit staged backfill and retained-version cutover. Rebuild non-invertible distributions after correction.
- **Acceptance:** Query plans use expected indexes; cost registry discovers every SQL/R2 surface; logical and physical budgets agree; reads perform no DML; every optimized/rebuilt result equals the reference fold from authoritative committed-publication evidence, never object existence alone. Interrupted backfill/GC resumes safely; no pending/current/recovery-referenced object is reclaimed. Physical reclamation is gated by Phase 0's retention/deletion/replay/backup horizons and recovery objectives.
- **Validation:** bun run usage:worker:check; bun run check:cost-surfaces; new usage:query:check and usage:perf commands with deterministic rows/bytes budgets and named hardware latency runs; M7 trace replay.
- **Recovery:** Derived state can be discarded/rebuilt by its owned maintenance path; authoritative data and deletion/ownership controls remain intact.

The next scalable verifier must retain a durable job identity, source revision,
head count, exact published reference, last canonical head ID and private scratch
root. Each bounded step independently resolves committed head bodies, accumulates
their sufficient statistics from zero, reserves possible scratch writes before
I/O, and conditionally advances its cursor only after verified storage. Exact
step retry must neither add a row twice nor charge twice. Source revision or
authority changes refuse the step; they cannot splice two account histories.
The first scalable envelope may explicitly refuse legacy data until a separate
sealed-legacy resolver is qualified.

Final comparison must stream every cell in key order from both roots with a
bounded internal cursor, without the public query's 366-day restriction. Compare
semantic cells and total traversal counts: B+tree hashes can differ solely
because insertion histories differ. A diagnostic job grants no publication
authority. Repair cutover needs a separately reviewed CAS over the original
source revision, both projection frontiers, pending state and current root,
while preserving cursor-retention and cumulative quota rules. Interrupted or
abandoned scratch work remains charged and retained until qualified reclamation
can prove that no recovery or query reference needs it. The resumable diagnostic
is implemented with focused qualification in progress. Repair cutover, legacy
resolution, physical reclamation and live recovery remain open.

### Phase 7 — Metric explorer and dashboard completeness

- **Status:** In progress — bounded worker-backed local/hosted explorer and catalog plus rich metric explorer, saved views, CSV export and per-metric coverage states; production qualification and canonical/rich integration remain open
- **Depends on:** 1C, 3; 6 before hosted completion
- **Objective:** A cohesive private product answers all catalog questions supported by available evidence.
- **Scope:** Overview and explorer, definition/coverage disclosure, comparisons, filters, distributions, table/export/share, local mode and accessibility.
- **Out of scope:** Filling unsupported metrics with inferred zeros, unqualified productivity scores or private filter values in public URLs.
- **Approach:** Build against the frozen metric/query contracts with synthetic examples first; integrate supported account metrics after Phase 6. Advanced Phase 8 metrics stay capability-gated until their facts exist.
- **Acceptance:** Every catalog metric has a working supported view or explicit unavailable reason; all surfaces conserve the same filtered totals; unmatched comparisons refuse; correction/snapshot refresh invalidates caches; max-size reports meet ratified interaction budgets; keyboard/touch/screen-reader and reduced-motion journeys work.
- **Validation:** Existing component/contract tests, property-generated query/filter/export equivalence, bun run test:browser, and user journeys for local→enroll→sync→drilldown→export→switch-account.
- **Recovery:** Saved view/schema versions migrate compatibly; service unavailability retains clearly stale data/local mode without claiming fresh completeness.

### Phase 8 — Rich numeric instrumentation and drilldown

- **Status:** In progress — additive local numeric fact contract, qualified-profile adapters and bounded rich-fact producers with lineage; hosted joins await canonical publication
- **Depends on:** 3, 4, 5, 6
- **Objective:** Session, turn, request, context, timing and reliability metrics have real attributable evidence.
- **Scope:** F24; bounded local numeric OTel/producer adapters and opted-in private numeric facts; per-observation histograms/lineage and coverage.
- **Out of scope:** Content capture, inferred human authorship, treating tool requests as dispatch, or fabricating historical streaming timing.
- **Approach:** Preserve source-specific capability and timing semantics; connect existing local profiles through explicit overlap rules. Capture only facts required by catalog entries; expire fine-grained data under an explicit retention policy while retaining valid aggregates.
- **Acceptance:** Direct/inclusive lineage never double-counts; each mean/distribution has its own measured cohort; requested/dispatched/completed and root/child outcomes remain separate; unavailable historical metrics stay unavailable; health/coverage persists; privacy canaries never cross allowed boundaries.
- **Validation:** cargo test --locked -p aicharts-core -p aicharts-cli; bun test lib/usage/sessions.test.ts lib/usage/turns.test.ts lib/usage/session-telemetry.test.ts lib/usage/compaction.test.ts; worker/differential checks after hosted joins, plus qualified telemetry fixtures.
- **Recovery:** Keep local mode and numeric schema compatibility; instrumentation failures cannot interrupt the user's AI client or overwrite a managed telemetry destination.

### Phase 9 — Benchmark, calculator and companion assurance

- **Status:** Complete — bounded product-domain repairs and independent review; integrated browser and delivery gates remain Phases 11–12
- **Depends on:** 0, 3
- **Objective:** The rest of AI Charts shares the correctness discipline while retaining source-specific product semantics.
- **Scope:** Snapshot admission/refresh, benchmark model/config identity, chart math/layout, calculator assumptions/rates, content provenance, discovery/export and companion boundaries.
- **Out of scope:** Proving the scientific validity of an external benchmark or treating private usage as comparable benchmark scores.
- **Approach:** Extend existing independent laws and dated source checks; reuse exact metric/cost kernels only where semantics match. Keep local companion privilege-free and secrets out of labels/argv.
- **Acceptance:** Missing/duplicate/regressed source records fail the correct guard; rankings/frontiers/ties are stable under valid permutation; model/config/version distinctions survive joins; calculator dimensions/rounding and monotonic laws hold; snapshots/HTML/JSON/CSV/social exports agree; no private metrics enter analytics/search surfaces.
- **Validation:** bun run check:generated; bun run test:property; bun test lib/calculator-math.test.ts lib/benchmark-atlas.test.ts lib/benchmark-atlas-view.test.ts; existing browser checks; documented macOS companion build in its native lane.
- **Recovery:** Preserve the last validated snapshot, current canonical URLs and managed refresh path; never admit a changed benchmark schema solely to make CI green.

### Phase 10 — Privacy, account lifecycle and recovery operations

- **Status:** In progress — account lifecycle RPC (status, export, device list/revoke, two-step erase; the writer transfer was retired with the per-client writer in PR #427) with erasure tombstone, resumable steps and restore-fence sealing landed; manual billing/budgets/alerts and live recovery drills remain open
- **Depends on:** 5, 6, 8
- **Objective:** Users can inspect, export, move and remove their data, and operators can recover without resurrecting revoked authority.
- **Scope:** F22/F25/F26; account-controlled devices/transfer, export/erase, retention/tombstones, consent/index liveness, health, backup/restore and incident procedures; numeric manual billing, budgets, transparent forecasts and opt-in in-product alerts per the shipping matrix.
- **Out of scope:** Unbounded fraud claims or deleting private user data during qualification.
- **Approach:** Durable ordered control decisions, bounded idempotent workflows, recovery fences and data-preserving rollback; define public withdrawal and backup-erasure horizons. Keep budgets/alerts opt-in and channel authorization explicit.
- **Acceptance:** Interrupted erase/export/transfer resumes; late uploads and restored backups cannot revive erased/public data; device revocation preserves historical facts until requested erasure; index capacity/slow peers have a usable refusal/progress path; all registered deletion owners are real reachable implementations; runbooks match current source/flags. Billing keeps reported/entered/estimated amounts distinct by currency/period; budget events are idempotent across replay/correction; forecasts expose their baseline/coverage/uncertainty; in-product alerts have cooldown and acknowledgment tests.
- **Validation:** Real-runtime lifecycle fault matrix, M1/M5/M6 checks, privacy canaries and authorization tests, cost-surface checks and a synthetic restore drill with declared recovery-time/data-loss objectives.
- **Recovery:** Reconcile uncertain effects before retry; preserve evidence and exact target identity. Never reset, truncate or change provider identity to bypass a failed recovery guard.

### Phase 7B — Final metric and account-journey integration

- **Status:** In progress — local account journeys, saved views, exports and coverage states landed on the merged branch; canonical/lifecycle browser journeys await hosted qualification
- **Depends on:** 6, 7, 8, 10
- **Objective:** Newly supported rich metrics and lifecycle operations work throughout the complete product.
- **Scope:** Dashboard/explorer/account views, private drilldown, exports, accessibility and end-to-end browser journeys after Phases 6, 7, 8 and 10.
- **Out of scope:** Leaving a planned observable metric permanently unavailable merely because the initial UI preceded its instrumentation.
- **Approach:** Maintain per-metric states: implemented and qualified, implemented but activation-gated, planned and incomplete, or intrinsically unobservable for a stated source/profile. Tie each to capability fixtures and its public support claim.
- **Acceptance:** Every newly supported fact has its corresponding working view/filter/drilldown/export and coverage; no planned observable catalog item is marked complete as unavailable. Source-specific unobservable metrics explain the limitation without inventing values. Users can collect, sync, compare, inspect sessions, export, change device/account, revoke, transfer and request erasure through coherent authenticated journeys.
- **Validation:** Full metric-to-view coverage check, generated chart/table/export equivalence, real browser account/lifecycle and accessibility fixtures, max-size report interaction measurements. Run bun run test:browser and affected component/contract suites.
- **Recovery:** Preserve last compatible local/account reports; gate unsupported server features without misrepresenting implementation completeness.

### Phase 11 — Independent review and converged assurance gate

- **Status:** In progress — fuzz, fault-matrix, security and nightly suites landed with their receipts; the converged gate and independent review run on the merged integration candidate
- **Depends on:** 1A, 1B, 1C, 2A, 2B, 3–10, 7B
- **Objective:** The exact integration candidate meets the claimed correctness, performance and support envelope.
- **Scope:** Full claim/metric/capability coverage, independent specification and implementation review, required CI, security/fuzz/fault/performance/native/browser evidence.
- **Out of scope:** Counting tests or proof lines as a correctness score.
- **Approach:** One owner per expensive command/wait; reviewers challenge assumptions and attempt counterexamples. Changed source invalidates affected evidence; no receipt substitutes for final integration gates.
- **Acceptance:** Every catalog/claim row has current evidence or a visible unsupported state; all critical defects closed; negative controls fail as expected; no proof timeout/admission/zero-harness gap; all performance budgets measured under declared workloads; cross-platform/live support claims match qualification.
- **Validation:** Unchanged bun run check; bun run kb:refresh and bun run kb:check; the new formal, adapter, query/performance and lifecycle commands introduced earlier. Preserve Required CI and macOS companion checks. Larger nightly models/fuzz/soaks supplement mandatory tractable PR gates.
- **Recovery:** Keep the candidate unpromoted on failure; repair and rerun only affected focused checks plus required final gates.

### Phase 12 — Delivery and production qualification

- **Status:** In progress — completion PR #441 merged as `2356eff` and the site production-verified; after the notice-policy fixes (#444, #446) the Linux CLI qualification passed at `40874b2`; Worker redeploy, usage flags, immutable publication and live drills stay owner-gated
- **Depends on:** 11
- **Objective:** Deliver the verified artifact and the fully working supported product, with exact production evidence.
- **Scope:** Task-owned protected-main PRs, required independent review/CI, immutable distribution, deployment, account/provider/native acceptance and scheduled cutover.
- **Out of scope:** Automatic paid upgrades, new persistent Preview services, unqualified behavior activation or user-data reset.
- **Approach:** Follow current repository delivery docs and standing authorization. Verify account/project/namespace/generation/deployment identity before writes, staged artifact provenance, migration dry run and recovery artifact. Artifact admission and live qualification remain separate.
- **Acceptance:** Record branch/PR/checks/merge/release/deployment/source tree; preserve all platform gates; new user can install, collect, enroll, sync, inspect derived metrics, export, revoke/transfer and recover; repeated sync is inert; fresh current supported provider samples reconcile; public publish/refresh/withdraw works only after its own qualification.
- **Validation:** Current release archive/source/manifest/build/assembly checks, documented Linux qualification, native custody/process tests, exact-deployment health and authenticated product journeys in docs/usage-activation.md. Verify authoritative data invariants after migration and rollout; inspect telemetry for bounded errors/costs.
- **Recovery:** Keep working acquisition until replacement is qualified; retain compatible flags-off recovery artifact. Rollback does not undo committed ownership/schema/control history. Stop only for missing authority/authentication, unsafe irreversible action or an unresolvable gate requiring user input.

## Delivery constraints and scheduling

Use protected main through task-owned PRs, independent review, exact-head required checks, merge and documented production verification. Routine task-owned delivery is already authorized; do not request duplicate approval. Preserve unrelated work and immutable shared dependencies. No new scheduler, global baseline installer or sibling-path coupling belongs in this change.

Resolve any installed required host scheduler to its absolute path and preserve its child command. Heavy builds/final portable checks use compute; authenticated browser work has one browser-auth owner; native custody/process/package work has one mac-native owner. Finish and collect browser work before releasing its lane. This audit found no host scheduler at the checked standard locations; future execution must reinspect the then-current host rules.

Freeze shared interfaces before write fan-out. Parallel lanes above have disjoint owned paths; joins in manifests, schema files, enrollment routing, registries and workflows go through the integration owner. Do not let a formal worker silently repair the implementation while another worker owns it.

## Completion criteria

The product is ready only when all of the following are true:

- All reproduced defects have implementation-boundary regressions and safe data-preserving repairs.
- Every catalog metric has correct source/grain/units/coverage/aggregation/correction rules. Every planned observable capability is implemented with a functional supported view; unsupported states are reserved for documented source limitations, not unfinished product work.
- Critical asynchronous safety invariants are model-checked with trace replay and explicit refinement limits; selected Rust kernels are proved over documented domains.
- Full recomputation, incremental collection, cloud materialization, dashboard and export agree on generated histories including corrections, copies, transfer, deletion and restore.
- Retention, CPU/memory, query cost and UI latency stay within ratified budgets on representative and admitted-limit workloads.
- Security/privacy and account lifecycle are tested across late responses, account changes, native/remote failures and recovery.
- Provider/platform/support claims have dated evidence; source proofs do not masquerade as provider truth or live readiness.
- The exact delivered artifact/deployment passes repository gates and current production acceptance.

## Audit evidence bundle

The retained [evidence index](../../outputs/assurance-audit-2026-09-23/README.md) links the three detailed audit reports, original synthetic probes and receipts, independent review and SHA-256 manifest. These local artifacts are ignored by Git and contain synthetic evidence only. They are separate from future committed regression fixtures.

- [Native CLI/source audit](../../outputs/assurance-audit-2026-09-23/aicharts-cli-audit-20260923.md)
- [Cloud/account audit](../../outputs/assurance-audit-2026-09-23/aicharts-cloud-audit-20260923.md)
- [Valhalla and nearby verification precedents](../../outputs/assurance-audit-2026-09-23/aicharts-verification-precedents-20260923.md)
- [Independent plan review](../../outputs/assurance-audit-2026-09-23/aicharts-plan-review-20260923.md)

## Audit closeout

Audit and planning completed on 23 September 2026 against a5bec6415ce640a61495db57bc9c2ce83fb83021, on local branch codex/system-assurance-plan-20260923. The original user checkout remains clean and unchanged. At that initial audit closeout, the only repository deliverable was the proposed plan; detailed receipts remain in the ignored local evidence bundle. That audit changed no product source, production data or provider configuration and attempted no implementation commit, PR, merge, release or deployment. Subsequent implementation is recorded below.

The integration-owner aggregate gate passed with exit 0:

~~~sh
CARGO_TARGET_DIR=/Users/bg/Documents/aicharts-worktrees/system-assurance-20260923/target/trusted-path-audit /Users/bg/.bun/bin/system-one-skills check --timeout-ms 900000 -- bun run check
~~~

The gate passed Rust formatting, Clippy and workspace tests; all 459 Worker tests in 20 files; skill and release-tool checks; TypeScript and lint; 1,767 Bun tests in 194 files with 266,264 assertions; the production build; and pairing, usage dashboard, desktop/mobile stats, benchmark, export and model-card browser contracts. Four existing Rust ignore entries remain: two subprocess/disposable fixtures, the admitted live Keychain roundtrip, and the explicit 100k sender-cost probe. The vendor's excluded tests, separate macOS companion gate and live provider qualification were not run. Existing lint/build warnings were retained; no gate was weakened.

Earlier attempts stopped on sandbox socket restrictions and untrusted temporary-directory ancestry, stale compiled executable paths after relocation, then archival TypeScript probes included by the application compiler. The worktree was moved to a trusted ancestor, a fresh task-owned Cargo target was used with approved host access, and archival probes were renamed to .ts.txt. The final passing run includes all required stages. [Validation receipt](../../outputs/assurance-audit-2026-09-23/validation-receipt.json), [full passing log](../../outputs/assurance-audit-2026-09-23/check-final.log.txt) and prior attempt logs preserve that distinction.

Focused metric tests also passed (66 tests, 3,253 assertions). The synthetic audit probes nevertheless reproduced the findings recorded above; passing the existing suite is not evidence that those defects are repaired. No TLA+, Kani, Lean or Verus proof was created or executed for AI Charts during this audit.

Two independent reviewers accepted the integrated plan changes, including the final product/UI join, baseline-versus-repaired model split, implementation conformance and mutation obligations, committed-publication recovery evidence, retention prerequisites and revocation semantics. Their [disposition](../../outputs/assurance-audit-2026-09-23/review-disposition.md) is plan review, not production-code approval. Local links, phase status and evidence hashes were checked. Knowledge-base validation is recorded in the validation receipt.

## Implementation log

### Execution started — 23 September 2026

The user authorized continued implementation. The task worktree fast-forwarded to main 696400d, whose only change since the audited baseline is the automated first-party release-radar snapshot. Product source and audit counterexamples are unchanged. Phase 0 begins with disjoint metric-registry and synthetic-corpus lanes; the integrator owns shared schemas, commands, retention/capacity policy and plan state. No live provider or user data is used. Existing audit receipts remain historical and will not substitute for the required final gate on changed code.

The performance ratification work moves to Phase 6, where representative query/storage workloads exist. Phase 0 retains current measurements and freezes proposed budgets, avoiding a false performance claim or an unnecessary dependency between measurement work and integrity repairs. A task-local Temurin 21 runtime and official TLC 1.7.4 artifact were downloaded and checksum-checked; no global configuration was changed.

### Phase 0 — Admitted performance baseline

The synthetic benchmark admits 8,192 and 65,536 distinct rows through the production local-report parser, using 1,024 models and up to 54 dated clients (Warp is an undated billing source). On Apple M5 Max / macOS arm64 / Bun 1.3.14, five runs after two warmups measured median parse/fold/CSV times of 63.56/16.69/23.22 ms for 8,192 rows and 544.49/149.45/196.82 ms for 65,536 rows. The latter report was 27,256,456 bytes; process RSS after repeated runs was 1,166,934,016 bytes, not isolated peak allocation. Exact independent token totals matched filtered, grouped and daily folds. The [portable receipt](../../fixtures/usage/assurance/performance/admitted-baseline.json) binds the measured source hashes. This qualifies neither browser rendering nor hosted query latency.

### Phase 0 — Accepted contracts and corpus

Independent native/cloud/formal-owner reviews converged after repairs to source-observability classifications, cash rounding, manual plan allowances, gauge correction, retention controls, recursive schema discovery and bounded corpus execution. The checked inventory contains 241 planned metric rows across 17 families, 723 named acceptance obligations, 26 findings, 16 invariants, 35 named capacities, 35 SQL/object surfaces and all 55 source selectors. Qualification requires attributed current-source execution receipts; no metric is marked implemented or qualified. The native corpus reproduced five historical failures; the cloud/formula corpus reproduced seven. Historical replay and repaired-code checks are separate. Focused validation passed: registry plus 11 negative-control tests (51 assertions), native seven tests, cloud ordinary and explicit historical tests, cost-surface check, typecheck, ESLint and diff check. The root will run the unchanged aggregate/final gate after implementation converges; historical audit receipts are not reused for that gate.

### Parallel repair wave

Phase 0 committed as db10d74. Native owner began Phase 1A; formal owner began Phase 2A. The integration owner began Phase 1C formulas, private transport binding and UI lifetime, with a disjoint cloud-owner lane for the pure account-generation coordinator. Phase 1B awaits the reviewed Phase 2A safety contract. No live data or activation changes are involved.

### Phase 2A — Accepted historical protocol evidence

Completed 15 pinned TLC expectations: six intended safety counterexamples, four complete sanity checks (2,751 / 8 / 8 / 23 distinct states), and five reachability controls. The runner stages exact input bytes, rejects incomplete or unexpected outcomes, and binds receipts to source/configuration/tool hashes. Eight focused tests (87 assertions), ESLint and strict targeted TypeScript passed. Independent cloud-owner review verified final receipt `target/assurance/tla/run-nUXdGt/receipt.json`, all source provenance, traces and frozen repair obligations without edits. Root reviewed the obligations and wired `usage:formal:tla`; Phase 1B opened. These baseline results establish failure mechanisms, not production refinement or unbounded correctness; M1 still needs actual Durable Object fault replay in Phase 2B.

Phase 1C applies the same response-bound generation rule to the daily and consent views as well as stats/account controls. A consent mutation additionally conditions the intended account against the live trusted session before dispatch; it never derives authority from the browser or retries a mutation. This adjacent scope closes the same F23 identity-lifetime boundary across all private views.

Phase 1C removes the range cache entirely: a fresh authenticated response is already required before rendering, so retaining eight old report bodies offered no usable cache hit and consumed memory. Only the displayed account report is held in component state, with an account/generation scope checked again by React before commit. Local/example data remains independent.

Phase 1B preserves source populations by refusing ambiguous legacy takeover: the current v2 aggregate contract cannot prove occurrence overlap or disjointness. Exact population evidence (stable source/occurrence identity, predecessor operation hash and attributed numeric payload) remains a required Phase 5 acceptance dependency for combined 135-token and deduplication cases. F02 stays open; refusal is a containment repair, not deduplication qualification.

### Phase 1A — Accepted native repairs

Independent source review accepted the attribution and numeric replay quarantine, exact read-only export, guarded schema upgrade, conservative source scanning, exact Cursor range replacement, complete warning persistence and owned-process settlement. A successful write now checks the affected occurrence's canonical replay; undefined partial-dominance histories refuse before commit. Historical conflicts remain inspectable and exportable with their original bytes. No associativity or order-independence claim is made for arbitrary occurrence merges.

Current focused evidence: ledger 92 tests passed (one intentional fixture ignored), inspect integration 8 passed, CLI 377 unit and 87 integration tests passed (one intentional fixture ignored), workspace Clippy with all targets and `-D warnings` passed, and formatting passed. Unchanged-source core 135, import 16 and platform-process 5 test results were inspected rather than repeated. CLI fixtures required approved local socket access. Seven old/new-binary history scenarios passed with exact original-byte export and refusal before backup or mutation for quarantined upgrades. Retained receipts are `target/assurance-repaired/historical.json` (SHA-256 `9cae270272772be2ffebd84d919aedc16546b61bc97213cb3cd997907921b7f4`) and `target/assurance-repaired/native-cli.json` (SHA-256 `73ce13a20c318fb389540d5ec3791209fbb4488a9e2a6a0ba49fdbf0806915ae`); repaired binary SHA-256 is `f4ca6c09deb02d7d66def7a88b53cd8fa86897d79063c27fa16c8bad45add95e`. This qualifies the local macOS evidence; Linux process behavior still needs its platform CI gate. No private user ledger was migrated.

### Phase 1C — Accepted metric and browser repairs

Independent source review accepted complete-input cache shares, matched source-duration rates, separate cost cohorts, and response-bound private identity generations. Authenticated absence and conflict replies retain the same captured identity as successful replies, so account B's empty result also invalidates account A's views. Consent intent is conditional on the live trusted account; uncertain mutations are not replayed. Clearing account state preserves local and example reports. Pending image export checks current report authority before download and releases its job independently so a retained local report can retry after a failed import.

The production build, TypeScript and focused ESLint passed. Focused client/formula/export tests passed 134 cases with 4,203 assertions; coordinator/lifecycle/transport/rendering tests passed 28 cases with 10,741 assertions. The expanded real-browser synthetic suite passed desktop and mobile with distinct A/B measurements, held old replies, bfcache/visibility/focus boundaries, local reports, CSV/PNG, and a paused real canvas callback completed after report closure or failed replacement. The canceled image did not download and a subsequent local export succeeded. Final screenshots in `outputs/assurance-audit-2026-09-23/ui-final` were inspected; the mobile chart scale no longer overlaps its heading. These are synthetic local qualification results, not live account/provider evidence. The converged repository gate remains Phase 11's responsibility.


### 2026-09-23 — Phase 1B accepted; repaired protocol and source lanes opened

Independent review accepted retained restore registrations, same-attempt lost-reply recovery, pure account/pairing/index reads, explicit fenced maintenance/scrub, explicit pending-snapshot abandonment, and retained per-day writer provenance. Invalid upload secrets refuse before consuming fence capacity; authorization is rechecked after asynchronous work. A canonical namespace write that outlives its outward deadline keeps its registration until the actual provider promise settles. Conditional immutable object tails are permitted only after terminal caller return with retained intent/charge and no remaining canonical continuation. Current schema cannot reconstruct lost authority from a successor writer; only the exact pre-transfer legacy schema/layout can initialize provenance.

The integration owner ran `bun run usage:worker:check` through the installed compact-output wrapper on the converged source: 20 files, 488 tests passed in 131.13 seconds. Independent index review also covered fresh post-await clocks and exact source decision matching. No live-provider qualification was performed. These results do not establish exact legacy overlap reconciliation, arbitrary distributed schedules, eventual settlement after permanent process/provider loss, deletion, or global instantaneous withdrawal. Phases 2B, 5 and 10 retain those obligations. Phase 2B now owns maintained finite repaired models plus generated real-runtime correspondence; Phase 4 has begun its source/checkpoint/health inventory.

### 2026-09-23 — Phase 2B accepted; arithmetic and ingestion qualification continue

The maintained TLC runner passed the unchanged fifteen-case baseline and all
thirty repaired configurations. The seven complete finite safety explorations
visited 2,554 / 1,572 / 200 / 138 / 544 / 162 / 122 distinct states; twenty-three
mechanism-specific reachability witnesses produced their exact named invariant
violations. Receipts are `target/assurance/tla/run-9AMAwY/receipt.json` and
`target/assurance/tla/run-3ADicM/receipt.json`. No fairness or checked temporal
liveness is claimed; the action map names conditional progress assumptions and
the transitions deferred to phases 5, 6 and 10.

The integration owner accepted `target/assurance/conformance/run-LwEcWQ/receipt.json`:
thirty Worker tests, six browser-authority tests and one actual SQLite-ledger test
emitted all thirty-nine declared model/seed traces. Each seed exercises both lost
immutable batch and lost journal replies. Exact action/outcome coverage, full
observed state, original/staged source hashes and tool identity are checked.
The production-only live-registration drain mutant fails the unchanged M1 adapter
at the expected publication assertion for each of the three seeds. The staged
positive controls all pass. Independent review repaired runner admission and
staging gaps; its eleven parser/staging/environment tests pass with 84 assertions,
along with strict targeted TypeScript and ESLint. Root reviewed the action mapping
and retained evidence. The repository-wide integration gate remains Phase 11.

The production arithmetic pilot chose fresh Charon/Aeneas extraction into Lean.
The maintained route passed seventeen production declarations, nine separate
mathematical laws and three production mutants in
`target/assurance/theorems/run-TdYv2E/receipt.json`. This pricing result covers the
complete u128 unit-rate domain; a broader arbitrary-rate proof is in progress.
Verus also proved six extracted-body pilot functions, but that snapshot is not
the maintained production translation. Seventeen Kani harnesses executed with
44 satisfied covers; admission still awaits independent review of nineteen
unreachable harness/runtime assertions. The former pricing timeout is explicitly
mapped to the accepted production Lean theorem rather than treated as success.
Linux tool qualification and stricter runner review remain open for Phase 3.

Phase 4 now has an executed first-four-family vendor target, fixed-code numeric
health and guarded local stores. Default detailed reports remain compatible and
read-only; fresh enrolled collection records attempt/good/publication evidence
separately. Actual workload measurements rejected the first Codex checkpoint
optimization because serialization made append slower than full replay. Revised
measurements include reload/codec costs; automatic checkpoint use remains off.
Other source families retain authoritative full replay and explicit qualification
limits. No source, provider or production account data was used in these checks.

### 2026-09-23 — General pricing proof admitted; canonical and explorer lanes opened

The maintained macOS Lean gate passed all 26 production declarations, nine
separate mathematical laws and four isolated production mutants in
`target/assurance/theorems/run-HBlRpk/receipt.json`. It freshly translated the
unchanged Rust pricing loop and proves all five full-u128 token/rate buckets,
ordered refusal, termination and the exact success formula. A constructive
five-bucket non-unit witness yields 55 microdollars. Four optional exploratory
witnesses remain ignored pilot material, not admitted proof obligations. The
rate-erasure mutant preserves unit rates and fails the general body theorem.
Independent review accepted the exact tactic-diagnostic admission; unrelated
errors, timeout, changed inputs and additional axioms still refuse.

The repository-local official Kani driver passed 17 harnesses, 44 covers and both
production mutants in `target/assurance/kani/run-DZ1OJ3/receipt.json`. All nineteen
unreachable assertions have exact reviewed hash/location bindings. One prior
run correctly refused changed proof inputs and a Cargo-rewritten staged lockfile;
the isolated workspace now starts with canonical Cargo headers, preserving the
unchanged-stage check. The focused metric/core/protocol gate passed 179 Rust tests;
wire/rollup/turn tests passed 99 tests and 8,019 assertions. These receipts are
source-bound development evidence, not final integration or Linux qualification.

Phase 4's actual vendor gate passed 193 compiled tests in
`target/assurance/adapters/run-bTPw8e/receipt.json`. Import tests passed 26, source
refresh 46, health 8 and checkpoint 1; owned all-targets Clippy passed. Root's
stats/publication join passed 46 tests, including local synthetic TLS transport,
missing-source preservation and distinct private same-millisecond attempts.
The strongest 55-client retained-health fixture is 120,400 bytes within 131,072.
Default JSON remains unchanged; collection, retained good evidence and publication
are independent. Read-only health creates no file or lock. The checkpoint's
measured persisted reload still regresses, so automatic use stays disabled;
other adapters retain full replay. Performance and wider incremental qualification
are not complete.

Phase 5 now owns the exact canonical identity/membership/revision contract,
reference fold and additive bounded transactional storage. Its explicit activation
must fence legacy writers and bind retained migration evidence; schema creation
alone cannot imply takeover. Phase 7 builds a bounded local metric engine and
compact 241-metric catalog in parallel. Missing comparison exposure or rich facts
stay explicit pending their producer integration. The cost gate now discovers
owned SQL and checks every registered usage object family against matching cost,
retention and actual capacity references. Logical limits do not establish physical
storage overhead or authorize reclamation; F21 remains open.


### 2026-09-23 — Canonical boundary and reproducible proof infrastructure

The canonical store passed fourteen focused actual workerd tests, including an
account RPC projection failure that rolls back nested SQL and succeeds on exact
retry without another reservation. Fresh activation refuses a real retained V1
120-token frame. Root integrated authenticated, restore-fenced contribution RPC
and five bounded HTTP endpoints, all dormant behind a separate exact flag.
Sixteen focused tests across contribution HTTP, existing stats HTTP and production
routing passed. An independent reviewer found that the existing v2 HTTP handler
accepted a shaped receipt without binding it to the submitted operation. The
repair checks hash, operation, sequence, revision and applicable client/range;
the six-test stats HTTP gate, including eleven foreign-receipt cases, passed.

Every old write continuation now checks canonical activation inside its owner
transaction. Independent review accepted the retained-terminal reconciliation
branches and the unconditional cutover check. The expanded delayed-write fixture
initially crashed workerd due to test-owned promise custody; this is recorded as
a failed test attempt, not product evidence. Its corrected schedule and the
retained-data migration remain under qualification.

Migration will seal verified V1 identity history and keep bounded V3 overlays.
It must bind retained journal/body/head commitments, preserve tombstones and
suppress V1 facts already superseded by V2. Aggregate-only V2 populations remain
explicitly unresolved; equal totals do not establish overlap. Original bytes
stay retained. Canonical admission is not yet a complete producer/query product.

All forty-five finite model cases passed with platform-pinned Java in
`target/assurance/tla/run-ZaVeYV/receipt.json` and
`target/assurance/tla/run-vWZNID/receipt.json`. The separate tool installer now
admits official bounded archives, task-local dated Rust components, exact Lean
Git dependencies and unchanged locks. Independent review accepted its installed
path and archive guards and the required CI job. Eight Mac/Linux archives were
freshly extracted and hashed; a fresh isolated Mac installation with exact
source fetches and Lake hydration passed. This is artifact/installation evidence;
Linux execution and its distinct unreachable-assertion review remain open.

Cost discovery now also refuses a new unregistered object writer. Duplicate
legacy registry aliases were consolidated into the exact schema-owned surfaces;
sixty-six cost entries, sixty-nine capacity constants and forty-six assurance
surfaces pass their consistency gate. Eighteen focused runner/cost tests passed
with 105 assertions. Generated proof trees are excluded from TypeScript and Bun
source-suite discovery; conformance stages its own configuration and explicitly
selects its adapter path. Product-domain assurance opened in parallel with the
migration and explorer lanes. Required final integration has not run yet.

### 2026-09-23 — Replayable correction evidence and indexed snapshots

The current macOS proof gates passed again after runner/environment changes:
`target/assurance/kani/run-xvVjFe/receipt.json` admits seventeen harnesses and both
negative controls; `target/assurance/theorems/run-7GvrqK/receipt.json` admits
twenty-six production theorems, nine mathematical laws and four mutants. These
are refreshed source-bound checks, not a whole-system proof or Linux receipt.

Phase 5 now retains immutable correction-reference pages and a root bound to the
account, generation, operation, body and predecessor/current revisions. The SQL
journal commits the root; object existence never establishes acceptance. Every
possible page/root byte is reserved before I/O. The sealed migration retains
original V1/V2 objects, binds journal/head/source and numeric conservation
commitments, preserves tombstones and keeps superseded V1 cells suppressed.
Actual workerd tests passed 22 cases, including 120 plus a distinct 15 producing
135, copied-source deduplication, unresolved V2 preservation, missing-object
retry, staged source drift with explicit cancellation, and a moved correction
whose predecessor resolves through the retained V1 body. Additional corruption
and crash-edge review continues. Migration and exact cancellation have dormant
fenced RPC/HTTP routes; producer/query and full migration qualification remain
open.

The pure rollup reducer keeps five disjoint token sums, exact u128 aggregates,
and separate cost/category/timing cohorts. It retracts predecessors before
adding replacements and returns no writable patch on failure. Independent
review found that the delta array boundary could run custom iteration or
getters; dense own-data admission now rejects those before any fold callback.
The joined rollup/index tests passed fifteen cases and 33,786 assertions before
the additional root-integrity repair below.

The derived-index decision is an immutable, content-addressed B+tree. Whole
account JSON would make small queries scan lifetime metadata; storing numeric
cells in transactional SQL would duplicate rebuildable content in the expensive
tier. Bounded leaves and branches permit path-copy updates and range pagination
while a later control-plane transaction will publish one root/revision. The
tree core bounds changes, reads, writes, bytes, depth and page size. An 8,400-cell
multi-level test reads and replaces only the selected path. Old-root pagination
remains exact during corrections and deletions.

Independent index review found that disjoint pruning and no-op leaf reuse could
trust unauthenticated root metadata. Every non-null root is now authenticated
before pruning or reuse; seven tests and 4,557 assertions passed, including
foreign account/generation and forged-bound regressions. Four actual R2 adapter
tests passed for exact retry, read purity, copied-plan refusal, immutable
conflicts and closed-continuation orphan reconciliation. Durable reservation,
publication commitment, hosted cursor admission, maintenance and reclamation
are still required before activation. Per-operation limits do not establish
cumulative physical storage qualification.

### 2026-09-23 — Explorer qualification and product-domain repairs

The local explorer exposes all 241 definitions with exact supported values or
specific missing-evidence reasons. Its shared query drives calendar, chart,
group table, drilldown, CSV and digest-bound JSON. Global grouping precedes
top-K; Other retains omitted contributions. Focused checks passed 53 tests and
2,431 assertions, plus TypeScript and owned ESLint. The stable-source synthetic
desktop/mobile browser journey passed in 125.612 seconds with retained captures
and a source-bound receipt in `.impeccable/review/receipt.json`; its owned server
closed cleanly. Earlier development runs were not passes: sibling-route cold
compilation caused HMR reloads, and a process probe obscured cleanup evidence.
Finite route prewarming and explicit child/port reconciliation repaired that
harness. Fresh visual review and documentation handoffs remain in progress.

Maximum-report responsiveness is explicitly unqualified. On the M5 Max/Bun
1.3.14 helper workload, 65,536 admitted model/day rows (27,129,286 bytes) took
median 584.63 ms to admit and 727.71 ms to query after two warmups and five
samples. Repeated-run RSS reached about 2.016 GB, not an isolated peak or proof
of a leak. Exact totals conserved, but this evidence does not meet the proposed
interactive budget. Heap isolation and cancellable off-main-thread or indexed
execution remain required; a small browser fixture cannot substitute for them.

Phase 9 reproduced and repaired calculator calendar/month admission, duplicate
subsidy labels, missing discovery dates, regressed retrieval/reporting periods,
and automated source/policy drift. Exact identity now breaks collation-equivalent
ranking ties, including stable provider aliases. Companion installation rejects
symlinked/writable managed parents and uses private exclusive staging; the
explicit native build preserves the lockfile. Root independent review accepted
the bounded changes and their stated filesystem/float limitations. The focused
gate passed 124 tests and 25,186 assertions; all 98 property tests passed with
130,691 assertions; publication/privacy checks passed 58 tests and 1,380
assertions. Offline generated checks, targeted types/lint and the locked macOS
release build passed. No snapshot was refreshed and no real companion was
launched. The aggregate integrated browser/build and delivery gates remain open.

Phase 8 begins with an additive local fact profile and adapters for existing
session, turn, telemetry and compaction evidence. Missing lineage, dispatch,
streaming timing and outcomes remain unknown. Corrections and retractions keep
source identity; inclusive/direct scopes and independently keyed histories do
not acquire an overlap proof merely by being combined.

### Committed replay, retained query snapshots and independent product review

The canonical migration review added three concrete repairs before its final
30-test workerd pass: actual bounded SQL row counts precede full replay; retained
device batch/receipt copies contribute to metadata admission; and every migration
receipt request-identity field matches its retained request. The original data
remains intact on refusal. The sealed legacy point-read limitation remains:
coordinated post-activation SQL corruption needs an independent full scrub, not
a claimed per-read Merkle membership proof.

The immutable index writer now binds an owned stage hash to context, root,
ordered emitted object references and reserved bytes. Replay accepts only the
next committed SQL revision, verifies every delta page and the complete ordered
inventory hash, and resolves at most 32 identities per phase-separated chunk.
The root's HTTP/index/replay gate passed 17 tests in 4.97 seconds. Pure query and
rollup checks passed 15 tests with 29,298 assertions. An initial regression caught
a new lookup helper admitting aggregate rows; it now requires one observation,
as does the correction planner.

The new projection controller passed 10 real-runtime tests, including a genuine
enrolled RPC/schema-10 path, lost write acknowledgments and restart, old callback
closure, rollback after stage movement, exact reservation retry, physical-write
budget refusal and 64-live-reference pressure. Its first integration run found
a missed schema-10 case in legacy stats ownership admission; the integrator
repaired that compatibility branch without weakening the exact schema checks.
The three projection tables contain control metadata; immutable cells remain in
R2. All possible writes share a cumulative 4 GiB reservation bound. Retiring a
current publication starts a 930-second cursor horizon; expired SQL references
are pruned only by explicit publication, and no R2 reclamation is enabled.

The query contract binds account, generation, committed revision, root, range,
page limit and continuation key. It reports source and selected snapshot lag and
unresolved legacy populations. Every provider await rechecks pure account
snapshots; object presence grants no query authority. Four initial query-runtime
tests passed; a subsequent first-page interleaving regression covers a newer
publication completing during the read. Current HTTP/schema joins and the new
interleaving still await the combined root gate and independent review. Automatic
projection scheduling, full rebuild/scrub, query performance qualification,
retention/recovery and staged-publication formal conformance remain open.

Fresh dashboard review found four material local explorer issues, all repaired
in one batch: the mobile jump link, answer reveal/focus, unavailable-unit wording,
and singular/filtered catalog counts. A stable-source desktop/mobile journey
passed in 99.541 seconds, all seven captures were inspected, and the owned process,
pipes and port closed. The same independent reviewer gave a ship verdict on the
four fixes. A fresh documenter confirmed the incumbent system and made no files;
this ordinary extension did not warrant invented design-system records. Maximum
report performance and hosted/rich integration remain open. Isolated unprofiled
heap diagnostics returned live heap to roughly 20 MB after report release; high
RSS represented retained allocator capacity in that run, while the profiler
itself retained snapshots. This is not evidence of a product leak or a browser
performance pass. The subsequent quiet maximum-report browser baseline measured
1,997 ms admission, 1,852 ms first query, 1,271–1,396 ms repeated-query, 926 ms CSV
and 153 ms JSON main-thread tasks. Its final combined privacy/runtime assertion
failed; the diagnostic artifact is retained under
`target/assurance/metric-explorer/browser-baseline/failed-performance.json`.
That is a reproduced performance blocker, not qualification. The bounded worker
and report-session join is now the owned repair lane.

Phase 8's additive local contract now has seven kinds (usage, span, request,
turn, tool, context and compaction). Root review caught source mutation during
asynchronous hashing and inclusive ancestor/child double counting. Both were
reproduced by failing regressions and repaired: all candidates are owned before
await, and ambiguous token aggregation returns an explicit ineligibility reason
with no usable total while independent timing/outcome metrics remain available.
The focused joined gate passed 81 tests with 6,410 assertions, plus strict types
and lint. The native session producer now exposes opt-in `rich-facts-v1` with an
explicit source generation and half-open window. Four failing compatibility
regressions established unknown-model attribution and an unreachable Codex
metadata scanner; both paths are repaired. Native validation passed 394 CLI
unit, 87 CLI integration and 141 core tests, plus strict all-targets Clippy;
one existing ignored test was not counted. The synthetic socket test rerun used
approved local loopback access. The joined TypeScript suite passed 82 tests,
including independently derived cross-runtime HMAC fixtures. Root independently
reviewed the native producer, retained descriptor/key checks, options and exact
mapping. This remains a local revision-zero snapshot: continuous revision
assignment, hosted consumption and rich dashboard joins remain open.

The last collected registry checks passed with 163 source-bound capacities, 54 assurance
surfaces and 77 total cost surfaces. These are inventory-consistency results,
not physical storage, live deployment or whole-system correctness certification.

The new native-producer audit found two prerequisites. A new device needs bounded
named observation-head reads and revision-bound population-member pagination;
the existing aggregate query cannot reconstruct those identities. Account-wide
V3 activation also supersedes V1/V2 writes, so aggregate-only source accounts
cannot be silently upgraded. Initial exact-source eligibility must be based on
stable native identity or verified immutable/append-only prefix continuity:
Codex timestamp/slot identities and Devin's position fallback do not justify
arbitrary reordered-history corrections. Ambiguous rewrites must quarantine.

The controller extension separates complete applied revisions from published
snapshots. A hard 16-second minimum interval, including caught-up bursts, keeps
930-second cursor retention below the defensive 64-reference cap while backlog
application proceeds. Query watermarks now report source, latest applied,
latest published and selected snapshot revisions with independently checked
lags. The browser-safe query contract built successfully; 38 focused contract,
rollup and index tests passed with 34,401 assertions before the new lag fields,
and the lag contract's affected tests passed afterward. Five query runtime
tests and seven initial work-control tests passed together; later attempt-version
and alarm-ordering additions await their next gate.

Automatic work is now joined under additive account schema 11. Consent and
projection have independent identities, acknowledgment, eight attempts and
versioned dispatch flights. A 2-second alarm yield leaves actual provider calls
and restore custody intact. The 30-second durable watchdog moves unresolved
work to visible `awaiting_settlement` once; the other class continues without
an empty polling loop. Ordinary position changes preserve the flight identity;
explicit resume invalidates old capabilities. A late completion persists its
next wake before clearing a flight. Source commits also re-arm after immutable
I/O and before the canonical SQL commit. The failed-arm regression preserves
one pending reservation and exact immutable charge, then commits once on retry.

Independent review found and repaired held-consent starvation and the late
completion lost-wake window. The joined 35-case runtime gate passed work-state,
automatic integration and projection tests, including multi-revision catch-up
while consent is held, watchdog eviction, retry exhaustion, read-only work
status and close/drain custody. Explicit foreground projection uses the same
flight exclusion. The final focused 21-case gate also passed the held fence
acquisition/alarm interleaving and unified durable-flight claim API; Worker
TypeScript and owned-file lint passed. These later repairs are covered by the
final integration gate again when the whole tree converges.
The design accounts for Cloudflare's single replaceable, at-least-once alarm and
null `getAlarm()` inside a handler ([alarm API](https://developers.cloudflare.com/durable-objects/api/alarms/)).
Durable Objects' `waitUntil` does not extend execution lifetime; pending I/O is
not proof against eviction ([state API](https://developers.cloudflare.com/durable-objects/api/state/#waituntil)).
The legacy consent-only alarm remains separately scoped. No feature is activated.

M8 covers bounded staged apply, charge conservation, coalesced publication,
retained cursor references and actual completion before drain. M9 adds independent
consent/projection progress, durable flights, one-shot watchdogs, late completion,
shared custody, restart and explicit resume. Its two complete safety graphs have
637 and 921 states; five witnesses and three guard-removal mutants qualify the
declared finite transitions. The shared pinned runner passed all 70 configurations
on macOS: 15 historical baseline expectations and 55 repaired cases, including
12 complete safety explorations, 36 witnesses and seven guard-removal counterexamples.
Eight runner tests passed with 87 assertions. The receipts are
`target/assurance/tla/run-rezgFC/receipt.json` and
`target/assurance/tla/run-3n7OhY/receipt.json`; the exact-byte audit at
`target/assurance/m9-dev/official-hash-audit.json` matched all 70 captured cases,
current/staged inputs, tool pins, logs and traces. This does not qualify Linux,
prove source refinement or establish unbounded liveness. M9's atomic alarm-arm
abstraction and excluded runtime queue are explicit in its action map.

The exact-head HTTP join passed 11 tests, and two genuine retained-V1 migration
regressions passed with exact payload/head references and tombstones preserved.
Its pure contract passed seven tests with 344 assertions; six indexed Worker
cases include all 8,192 population members. The endpoint never substitutes a
membership assertion for the current head. The native producer kernel now
prepares new observations and exact mirror assertions only. Fifteen Rust tests
passed, including byte/hash parity, identity deduplication, partial-scan
correction refusal, malformed correlated replies and limits; the later explicit
u64-overflow case passed its focused test. Strict core Clippy, formatting, four
TypeScript fixture tests with 33 assertions, owned lint and the narrow typecheck
passed. Root independently reviewed the opaque inputs, partial eligibility,
separate current/membership heads and frozen request/receipt correlations.
Differing values remain refused pending durable correction authority, verified
transport and frozen-flight settlement. This is not a V3 CLI upload or activation
path.

The worker-backed local dashboard passed 45 tests with 950 assertions and joined
desktop/mobile browser journeys. File admission, queries and CSV/JSON exports
run in a bounded worker session; only complete presentation values cross to the
page. Closing, replacing or invalidating an account drops stale results and
exports. Daily tables render only when opened and page at 31 days. In the final
maximum development run, repeated-query main-thread tasks fell to 127–132 ms,
but still exceeded the 50 ms target and 92–140 ms input frames missed the 100 ms
target in some samples. Exact 65,536-row exports, privacy and worker cleanup
passed. This is measured progress, not production responsiveness qualification.
The hosted join now transfers bounded immutable response bytes into the same
private worker for UTF-8 decoding, schema/range/status admission and snapshot
capture. One monotonic 20-second deadline spans identity adoption, SDK recovery
and retries. Invalidated attempts cancel and dispose their private session;
account identity never enters report metadata or exports. The focused gate passed
103 tests with 929 assertions across transport, generation, recovery, worker
session and dashboard behavior, with owned lint clean. Root independently reviewed
the hosted boundary and cancellation custody. Synthetic hosted-worker signout is
qualified by the later production functional run below; live provider authority
and maximum-workload performance remain separate obligations.

The first fresh production diagnostic passed exact 65,536-row totals/groups,
complete CSV, snapshot digest, privacy and worker cleanup. Five maximum-query
samples had no page Long Tasks and 11.9–19.4 ms input-to-next-frame, but completion
took 1,373.0–1,460.7 ms. This establishes responsiveness for those samples, not
the modest-hardware completed-query p95 target. The 27 MB file-injection long task
does not isolate native picker admission. Main heap excludes worker allocations.
The later desktop/mobile journey failed a driver synchronization assumption;
its account-report wait was repaired. An intervening build correctly refused
unrelated cancellation test literal typing; those fixtures were repaired before
further qualification. A later ready dashboard timed out on the driver's
network-idle assumption; explicit readiness and exact-value assertions now
establish the relevant application state.

The next fresh production run passed desktop/light 1440×900 and mobile/dark
390×900 journeys, including a held hosted worker response followed by sign-out,
account switching, failures, local examples and exact daily totals. Both
viewports had zero runtime errors and local provider effects; worker counts
peaked at two and returned to zero. Root inspected the final desktop/mobile
captures. Receipt
`target/assurance/metric-explorer/browser-worker-production-functional-ready/receipt.json`
binds build `WmXNu0ForKZftBPJDixse`, all 37 frontend/driver inputs and four build
artifacts. Its source/artifact readback matched; owned processes were collected
and the port refused connections afterward. This is production-build behavior
against synthetic service responses, not live provider or maximum-latency
qualification. Worker CPU, full memory and maximum hosted admission profiling
continue in a separate bounded diagnostic.

The current explorer implements 42 of the 241 catalog metrics for `client-stats-v2`.
Rich observations, source health, canonical account/device views, matched-period
comparisons and billing still need their actual capability joins. Phase 7B must
check metric-to-view/filter/drilldown/export coverage; an unavailable explanation
cannot complete an observable planned metric. Physical worker peak, simultaneous
maximum last-good/candidate reports, the 32-metric/2 MiB presentation envelope,
hosted maximum admission and complete account lifecycle journeys remain explicit
qualification work.

The independent single-cell scrub now has a trusted read-only RPC join. Its
temporary envelope permits fresh V3 accounts with at most 16 retained canonical
heads, 23 source/index object reads and 18 MiB of verified content. A separate
zero-based fold checks the cell against canonical body/terminal evidence, without
using projection deltas as its oracle. Both backend and outer RPC retire after a
nonrenewable 30-second deadline; the RPC includes external namespace/fence checks
and rechecks canonical revision/root afterward. Five pure tests passed with 534
assertions. The combined runtime gate passed all 17 cases: eleven backend and
six RPC integration cases, including the final-await full-reference race even
when its hash is unchanged. Worker TypeScript, all owned-file lint and the
registry/cost gates passed. Independent RPC review confirmed that late external
replies cannot dispatch more SQL or object gets after retirement; already-started
bounded stream parsing may still complete. Larger-account pagination,
whole-index comparison, durable repair and recovery remain open.

The next native-producer design audit reproduced a missing cancellation boundary:
the existing abandon operation requires a server reservation. A frozen upload
refused before reserve can remain stale indefinitely, while an absent status
cannot exclude a delayed prior send. The sender must retain that uncertain flight
until a correlated terminal result or a durable server cancellation excludes all
late effects. V3 abandonment also consumes a device sequence, unlike the existing
V2 sender's accounting. A full frozen-batch cancellation contract and recovery
model must qualify before any CLI transport join; no local flight is cleared
on an absent status.

The full-batch cancellation now preserves an authenticated terminal even when
the original upload never reserved server storage. It charges one metadata
operation, advances the device sequence once and leaves immutable-byte capacity
unchanged. An upload already paused in an R2 call later observes the same terminal
and cannot publish heads or issue its next journal write. Creating this new
terminal advances account schema 11 to 12 in the same transaction. Independent
join review and runtime testing caught a stats ownership reader that still
accepted only schema 11; it now validates the same unchanged ownership layout
for schema 12.

Five pure contract tests passed with 50 assertions. The final affected Worker
run passed all 15 cancellation cases; its separate HTTP fixture failure reused
a stub invalidated by the simulated Durable Object restart. After reacquiring
the stub, the HTTP-only run passed all 13 cases, including schema 12 restart,
delayed upload and correlated retry. The earlier 30 contribution cases passed
without changes to their inputs. Worker types and owned-file lint passed. These
are separate focused receipts, not a claim that all 58 cases ran together on the
final tree. The HTTP receipt is
`target/assurance/cancel-runtime-http-receipt.json`; the preceding cancellation
pass is retained in `target/assurance/cancel-runtime-affected-receipt.json` and
its captured test output.

The native durable sender must also publish cancellation intent locally before
its first network call. It retains the original immutable batch and switches
the checkpoint action from upload to cancel; an uncertain reply cannot switch
it back. A fresh cancellation revision requires another authenticated read and
durable checkpoint publication. Read-only inspection uses an existing lock and
never invokes the current V2 checkpoint constructor, which creates a lock, or
its read path, which may publish a staged successor. The new V3 sidecar and
strict exact-byte batch reopening are implemented; transport and CLI activation
remain unjoined.

The whole-index comparison foundation now scans the entire retained day/key
space, with 16 cells per page and continuations bound to an actual cell and its
ordinal. Its worst-case bound is 126 checked objects and less than 32 MiB per
root page; a comparison step can read two such pages. The comparison owns its
continuation, begins at zero, retains the same prefix on failed reads and checks
semantic cells even when root hashes match. Different insertion histories may
produce different hashes while comparing equal. This is an in-memory comparison
session: process loss restarts comparison at zero, and a match grants no source
or publication authority.

All seven new scan/comparison tests passed, including maximum-height sparse
trees, fabricated cursor ordinals, different insertion histories, boundary
omissions, failed-read retry and concurrent-step exclusion. Existing index
regressions also passed; the seeded correction property exceeded Bun's default
five-second timeout under local concurrent work and passed unchanged assertions
with an explicit 30-second test bound. Narrow strict types and owned lint passed.
Independent source review accepted the traversal and prefix preservation, and
the registry/cost gates passed with 147 capacities and 74 cost surfaces. Durable
from-zero source accumulation and resumable scratch publication remain open.

M10 now checks durable native upload/cancel decisions, cancellation before server
reservation, a held object write, lost terminal replies, restart and stale-reply
isolation. Its two complete finite safety graphs contain 11,685 and 8,008 states;
three reachability traces and three guard-removal counterexamples qualify the
declared abstraction. The expanded official run passed all 78 configurations:
15 historical baseline expectations and 63 repaired cases, comprising 14 safety
explorations, 39 witnesses and ten guard-removal counterexamples. The receipts are
`target/assurance/tla/run-laiTQJ/receipt.json` and
`target/assurance/tla/run-jXQ2eE/receipt.json`.
The audit at `target/assurance/m10-dev/official-hash-audit.json` independently
rechecked every current/staged input, case evaluation, tool pin, log and trace.
Eight runner tests passed with 87 assertions and owned lint passed. This remains
macOS finite-model evidence; Linux qualification, source refinement and unbounded
liveness remain separate obligations.

The native outbox passed 16 focused state/disk tests and the core producer passed
18 tests. Strict all-target core/CLI Clippy and owned formatting also passed.
Independent review found a missing population/writer guard in authenticated
progress; the repaired guard and regression are included in those results. Tests
exercise six durable-publication failure boundaries, retained cancellation,
terminal acknowledgement loss, account/generation/scope refusal, path replacement,
read-only inspection and late replies after a newer flight. Exact file hashes,
commands and collected sessions are retained in
`target/assurance/contribution-sync-native-summary.json`; the hashes were captured
after the gates, not continuously attested across execution. The sidecar retains
uncertain flights, and whole-directory rollback remains a recovery obligation.

The next native join preserves original authenticated direct or status terminal
responses, binds each fixed-origin exchange to current enrollment custody and
keeps one durable flight across populations. Inspection stays local and
observational. Existing `enrollment::enrolled()` calls durability reconciliation,
including fsync, despite its read-only description; the new inspection command
must not use it. No public V3 activation, grant or migration command is planned
in this join. The narrow Claude partial-observation profile remains explicit.

The independent rebuild fold now starts from empty scratch state, preserves
unknown versus zero and separates cost, timing and token-basis cohorts. Five tests
passed with 385 assertions, including 97 observations split across different
chunk sizes, correction equivalence, overflow, invalid seeds and caller mutation.
Narrow strict types and lint passed. A durable diagnostic rebuild will pin the
source and publication, process 16 retained heads per step and compare complete
semantic cells. It will reserve scratch bytes from the existing derived budget
before object writes; it will not repair or publish the diagnostic root.

The schema13/trusted-RPC join passed six real-workerd integration cases in
13.12 seconds. They cover SELECT-only missing/status reads, restart and exact
step replay, fresh-result refusal after final-await source/reference drift,
late fence acquisition without further SQL, and retained restore custody after
a storage timeout until the actual put settles. The last case also verifies
that retry completes the same pending reservation without charging twice.
The receipt is `target/assurance/rebuild-integration-runtime-receipt.json` with
unchanged captured sources. An earlier five-pass run exposed a synthetic RPC
mock missing its required disposal field; its refusal receipt is retained.
Worker types, owned lint and registry/cost checks passed. Independent root-join
review accepted the retirement, replay, authority and custody boundaries. The
backend owner is extending focused source-state regressions and will rerun the
joined cases after its final controller changes; this is not the aggregate gate.

The native contribution-sync lane then completed its next join. `CorrelatedTerminal`
now carries the committed population revision/head, and authenticated status
refuses a committed terminal when the current population is absent, predates the
receipt or contradicts its equal-revision head. The CLI exposes retained-terminal
and durable-floor evidence and distinguishes committed from abandoned settlement
outcomes. Its path parser rejects empty, dot and parent components; local
inspection remains observational and the schema-1 checkpoint conversion is
read-only until the first authenticated mutation. The focused Rust contribution
sync suite passed 41 tests, the core producer 18 tests, strict all-target Clippy
and explicit native formatting passed, and the TypeScript status contract passed
19 tests with 552 assertions. Loopback transport, synthetic changed-writer
history and exact-byte fixtures are covered; live enrollment, production
transport, rollback fencing and V3 activation remain open.

The rich local metric evaluator is now covered by 28 tests with 4,070 assertions,
its source adapters by nine tests with 50 assertions, and the existing metric,
fold and rebuild suites by 23 tests with 2,348 assertions. A shared-fixture
mutation in the rich explorer test was repaired by cloning the nested selection;
the combined run now passes. Rich support remains an explicit local capability:
request, response and hosted account joins, billing/plan evidence and the
unimplemented catalog rows still require Phase 7B/8 work.

The dashboard profiling lane completed its remaining production-build episodes.
The fresh build and 40 source plus four artifact hashes matched. The 65,536-group
protocol preserved the exact 2,215,018,496-token total in a 699,922-byte view and
405,287-byte bound export with a 1,060.2 ms wire path. Hosted 8,192-row and
maximum-row worker admission measured 206.4 ms and 174.4 ms, query measured
44.8 ms and 47.4 ms, no page Long Tasks occurred, and owned workers returned to
zero. The renderer diagnostic reached 1,079.7 MB private footprint while holding
two full reports; page V8 reached 322.60 MB and the worker reached 252.03 MB in
the maximum-group episode. Playwright injection and renderer tracing contribute
to those process figures, so this is a bounded diagnostic rather than a product
memory budget or p95 qualification. Maximum-report optimization and hosted/rich
joins remain open.

M11 now extends the repaired TLA manifest with eight contribution-rebuild cases:
single-job and sequential-job complete safety graphs, three recovery/comparison
witnesses and three guard-removal counterexamples. Individual pinned receipts
pass for all eight; the complete graphs contain 258,698 and 221,596 distinct
states. The expanded manifest is 71 repaired cases (16 safety, 42 witnesses and
13 mutants). The converged aggregate runs now pass all 15 baseline and 71
repaired cases. Receipts are
`target/assurance/tla/run-baseline-final-escalated/run-lz8Ip3/receipt.json` and
`target/assurance/tla/run-m11-official-final-escalated/run-XWgJ9I/receipt.json`.
The aggregate remains finite model evidence for the declared abstractions; it
does not establish unbounded liveness or implementation refinement.

### 2026-09-24 — Convergence review and integration boundaries

Independent review found that `--cancel` requested status before recording local
cancellation. A lost status response could therefore leave an upload resumable.
The repaired command durably records its one-way cancellation decision first,
then obtains fresh dispatch authority. All six injected publication failures
stop before network access; restart preserves cancellation and an already
committed terminal can still settle the exact flight. The focused native suite
passes 45 tests, strict core/CLI Clippy and owned formatting pass, and
`target/assurance/native-cancel-review/receipt.json` retains commands and hashes.

The first aggregate attempt exposed a stale custody test binary whose embedded
manifest path pointed to a removed disposable checkout. Rebuilding only that
package cleared the failure. The subsequent run passed Rust, workerd, release
checks, TypeScript and lint, then passed 2,065 Bun tests and failed three. The
formal CI action inventory, analytics scan of generated proof trees, and stale
private-days fixture expectation are corrected; all seven focused checks pass.
The private-days fixture now verifies captured account identity for both
authenticated `not_enrolled` responses. This is intermediate evidence; current
review fixes and incoming main still require the converged aggregate gate.

Generated proof trees are excluded from source lint and the analytics source
scan. Synthetic browser captures under `.impeccable/review/` remain local
evidence, excluded from version control alongside other generated receipts.
The activation runbook now distinguishes the explicit uploader for existing
owned populations from activation/grant authority, preserves disabled V3 flags,
and requires a schema-compatible recovery artifact before production promotion.
The dated schema-6 recovery artifact does not qualify rollback after newer
schema transitions. No production state or feature flag changed.

### 2026-09-24 — Integration with main, Linux proof execution and harness repairs

The joined branch was committed, merged with current `main` (through #419) and
opened as PR #422. Integration needed one help-text conflict in the CLI entry
point and one semantic repair: the ledger's diagnostic path now borrows the
collection because `collection_frames` takes a reference on `main`.

The first CI run exposed three Linux-only gaps that macOS evidence could not
show. Clippy on Linux rejected a platform-process test module declared before
the Linux `contains_only_leader` implementation; the module now closes the
file on every target. The Formal verification job provisioned all pinned tools,
passed the fourteen model suites and the fresh Lean extraction, and refused
Kani because the Linux bundle reports thirteen unreachable standard-library and
`kani_core` assertions that the macOS allowlist deliberately did not cover.
The retained receipt shows the same thirteen entries as macOS: `core::fmt`
panic-message shifts and `kani_core` pointer-offset division. They are now
admitted for `linux-x64` only, bound to the SHA-256 of the Linux bundle's own
`libcore` and `libkani_core` rlibs (hashed from the pinned archive), with the
same reviewed rationale and source hashes. A new test requires the Linux and
macOS lists to mirror each other exactly and to bind only to their own bundle.

The browser contracts were stale relative to the account-generation binding.
The dashboard harness now serves the account header on every state reply and
expects the product's real refusal behavior: an authentication-required reply
clears the private daily report and the account dashboard itself asks for
sign-in, so only a new document restores private reads. The session token-size
control gained an explicit label association so its accessible name is the
label text alone. No production state, feature flag or user data changed.

Gate evidence: the complete `bun run check` passed on the joined tree before
the final one-line Rust import gate. Two reruns on the final tree passed every
stage except one main-inherited data-refresh workflow test that times out at
its five-second budget when the host load average exceeds fifteen; it passes
in isolation and the standalone Bun suite passes with 2,102 tests. The required
Linux CI run (Check, Menubar, Formal verification, Required) passed on the
final commit.

### 2026-09-24 — Device-partitioned snapshots, constant-cost status and lifetime totals

Live use on two Macs exposed the seam this plan had recorded as F02 without
serving the person using the product. Snapshot status decoded every retained v1
head in the requested range on each call (about 20 seconds for a 205k-head
account against a five-second stage budget), every legacy client with any v1
history was refused with `takeover_required`, one device owned each client, and
one pending intent per account let one Mac park the other. The account's own
number (25.2 billion tokens from v1 occurrences) also disagreed with the
tokscale-compatible `stats` parse of the same files (176 billion) because v1
counts a strict subset of records.

Repairs landed together: `usage_stats_days`, `_day_meta` and `_day_rows` are
keyed by (client, day, device); the writer and day-source tables are retired
through a fenced `migratePartition` that keeps every retained day under its
recorded source device; `status` is O(1) and keeps its schema-2 shape; the
expected revision only has to be one the account reached; pending intents are
per device and a newer same-device body retires its uncertain predecessor,
whose bytes are then refused (`usage_stats_retired`); preserve-history keeps
the per-row envelope instead of refusing reductions; reads sum devices and add
retained heads only where the same device has no snapshot for that client/day
(F02's 120 + 15 = 135 holds); `usage_admission_day_totals` is a rebuildable v1
day projection maintained at admission, backfilled one span per fenced
mutation and recomputed by scrub; `readUsageTotals` and `/api/usage/totals`
serve lifetime totals per client and device to a new dashboard panel. The
collector's `stats-sync` reconciles a retained flight itself, `autosubmit`
cycles no longer stop at the first failure, and `daemon --publish-config` runs
collection and publication in one supervised process that never exits on a
pass result. Conformance traces M4-abandon, M4-devices and M4-overlap and the
stats suite encode the new semantics; F09's writer transfer is retired with the
writer concept. Open: the M4 TLA+ modules still describe the retired writer
transfer as historical evidence, and the v1 uploader remains a manual path.

### 2026-09-25 — Enrolled-device totals read and the Tokscale reconciliation

The account totals projection shipped behind the coordinator's workload
token, so a custody install could publish snapshots but could not ask what
the account sums to without a browser session. A device read on the
upload-secret family now closes that: `v2/snapshots/totals` accepts only
the exact schema-2 identity body (account, device, generation), reuses the
status path's fenced read, secret-commitment and namespace-anchor checks,
answers through the same totals projection the dashboard renders, and sits
under the same production admission gate as upload and status. The CLI
exposes it as `stats-totals`, which opens custody and the strict transport
only — never the ledger, sources, or enrollment state — and validates the
full wire projection before rendering.

Reconciling this Mac against the Tokscale public profile separated three
phenomena that look identical in a single number. Cursor reconciles almost
exactly: days where only cursor data existed aggregate to 1.02× between
the server and the immutable CSV, and Tokscale's extra ~2.4B is June–
September 2025 CSV rows outside the 366-day publishable window, not a
counting difference. Devin and Claude local totals are newer and larger
than Tokscale's own cached parse of the same surviving files because its
parsers skip `adaptive`-mode sessions and rows without a generation model
(24.6B of real DB tokens versus its 3.8B) — those are Tokscale
undercounts, not gaps here.

The material discrepancy is Codex and it is a server-side overcount. The
local corpus still holds the rollout files for every disputed July–August
day; raw per-turn `last_token_usage` deltas sum to ~123.4B and the
fork-aware local total is ~104.5B, while the server carries ~230B
attributable to codex. 2,037 Codex Desktop/VS Code forked rollouts each
report a final cumulative `total_token_usage` near 12B — an inherited
shared counter, not per-session usage — and summing those values as
session totals would project ~14.3TB. Upstream history shows the
submitting build straddled parser corrections (reasoning tokens counted
twice, legacy replay turns escaping the child boundary); the server's
monotonic per-day merge then preserved the inflated values permanently,
since submitted days can only rise. The remaining ~118B device gap is
consistent with roughly double-counted codex history plus days whose
files were deleted before either tool could re-audit them; it is not
explained by missing local sources alone.

### 2026-09-24 — PR #422 merged and production-verified; completion program opened

PR #422 was squash-merged to main as `fc95b51` at 20:45Z with the required
Check, Menubar, Formal verification and Required jobs green (CI run
36055796464). GitHub Production deployment 6647776777 resolved to Vercel
deployment `dpl_3TA2bNgxfeQzY7Cf67XF6scjyUrm` on project
`prj_0ppMfRRMDfiVsQ1JaekoxSZ7Mwgn`; the canonical origin served `/`,
`/dashboard` and `/usage/sessions` with status 200 and an
`X-Hraness-Delivery-Proof` header equal to the token recomputed from that
identity. No feature flag, Worker deployment or user data changed.

The remaining phases (3 source refinement, 4, 5, 6, 7, 8, 10, 7B, 11, 12)
were split into nine disjoint-ownership lanes on the completion branch
`codex/system-assurance-completion-20260924`: formal, kernel, cloud lifecycle,
cloud storage, UI, native ingestion, native facts, delivery gates and delivery
docs. The integrator owns this plan, the `check` chain, CI wiring and every
registry not assigned to a lane; lanes propose edits to shared files. Lane
paragraphs below record what each lane implemented, validated and left open.

### 2026-09-24 — Kernel lane: production arithmetic routed through the kernel

Phase 3 source refinement (SR-4 to SR-7) routed the remaining production
arithmetic through `aicharts-metrics`. A new `decimal` module supplies
canonical integer parsing and exact scaled half-up rounding; the detailed CLI
cost conversion moved from an `f64` product to it, which corrected
`0.0001245` USD (124 to 125 micro-USD) and a fabricated micro-dollar near
2^53, both pinned as regressions. Row totals, summaries, the Claude cache TTL
partition, Devin totals, ledger status counters and CLI collection counters
now use `checked_sum`, `checked_add_bounded` and `CacheWrites::with_ttl` with
unchanged results on valid input. A malformed checked-in tariff rate refuses
the client's projection (incomplete source, warning, `ProjectionRefused` in
measured health) rather than reading as an absent tariff; a test-only catalog
seam exercises this end to end. Each report row's cost and timed cohorts are
paired through `match_quantities` with the explorer's selection, and the
TypeScript explorer applies the same pairing. `scripts/generate-kernel-vectors.ts`
emits five seeded vector files (at least 2,064 cases each, production edges
included) with a `--check` drift gate now wired into `check:generated`,
evaluated by both the Rust kernel and the shared TypeScript. Focused cargo,
clippy, fmt, bun, tsc and eslint gates passed. Kani/Lean coverage of the
decimal functions and any live qualification remain open.

### 2026-09-24 — Delivery docs lane: recorded evidence, publication path, claims

Phase 12 delivery evidence and release path. The lane recorded PR #422's
merge, deployment and proof facts in `docs/usage-activation.md` and added
`usage:deployment:verify`, which recomputes the delivery-proof token from the
inspected deployment identity and requires it on the three fixed pages; it
passed for `fc95b51` at 22:33:45Z and for the next merge `1cf93bd` at
22:53:14Z, and failed closed for `fc95b51` once the alias moved. The
Cloudflare Worker was not redeployed; the runbook and worker guide state the
schema-13 recovery-artifact prerequisite. The nonpublishing Linux
qualification run 36066135869 at `fc95b51` failed at `read-link-map`
(33,690,505 bytes over the 32 MiB bound); the shared bound was raised to
64 MiB with boundary tests, and the tree remains Linux-unqualified until a new
dispatch passes. A tag-triggered `cli-publish.yml` republishes a retained
qualification as an immutable GitHub Release with OIDC provenance and
post-publish digest and attestation verification; it is tested and unexecuted,
with the macOS notarized release left to the owner. A claim inventory
(`docs/usage-claims.md`, 67 rows) with `usage:claims:check` closed F26 and
corrected two overclaims; the check runs inside `usage:assurance:check` and
`release:publish:check` runs inside `check`.

### 2026-09-24 — Delivery gates lane: fuzz, fault matrix, security and nightly

Phase 11 gates. `bun run usage:fuzz` runs the new `crates/aicharts-fuzz`
crate: seeded xorshift stateful and property suites for ledger command
sequences over real SQLite (commit, freeze, settle, reopen, backup, restore),
usage and admission wire round trips with byte corruption and single-violation
injection, and metrics arithmetic, token-partition and dominance laws, across
four named seeds, admitting one receipt per suite and seed at the configured
workload; 28 receipts passed at 1,000 iterations in 4 m 14 s.
`bun run usage:fault-matrix` inventories eleven existing injected-failure
suites (six worker files, five cargo groups) by exact test name, fails when
any is missing, and passed all eleven in 53 s; it covers crash-before,
crash-after, lost-reply, restore-race and capacity exhaustion and records
disk-full as an uncovered gap. `bun run security:check` audits both Cargo
locks and bun.lock, verifies every dependency, crate, action and bunx target
is pinned and hashed, scans tracked files for credential shapes, and
re-applies the PostHog boundary plus a privacy canary over analytics and
discovery surfaces; its first run found the real RUSTSEC-2026-0285 advisory
against the exact `rustls = 0.23.44` pin, which the integrator raised to
0.23.45. `test:property` now reaches nested `lib/**` property files (108
tests). A daily 09:00 UTC nightly workflow runs the TLA nightly profile,
200,000-iteration fuzz, the fault matrix, the security gate and an optional
perf baseline; a non-required security workflow runs on every pull request.
All implemented and locally passing; none live-qualified.

### 2026-09-24 — Completion integration: all six remaining lanes merged

All outstanding lanes landed on `codex/system-assurance-completion-20260924`
with `--no-ff` merges: formal assurance (conformance M8–M11, Lean route, Kani
coverage, nightly TLA), cloud account lifecycle (lifecycle RPC, erasure
tombstone, restore fence), cloud storage (rebuild cutover CAS, reclamation
ledger, M12 model), native ingestion (checkpoint generation 3, incremental
sources, source-health-v1), native facts (rich-fact producers, revision
ledger, contribution sync) and the UI lane (rich metric explorer, saved
views, CSV export, coverage states). Three merge seams needed repair, none
semantic: the M11 cutover configs predated the JobCount/Quota
parameterization and now pin the development bounds their cases measured;
the lifecycle lane's worker files carried latent type errors its validation
never reached (missing `schemaVersion` on the erase withdrawal view, an
`account_erased` fence refusal now carried by a dedicated `FenceRefusal`
sentinel outside `AdmissionFault`'s domain, and a test RPC call whose mapped
stub type exceeded the instantiation budget); and the conformance schedule's
status expectation gained the rebuild contract's `readiness` field
(`unobserved` without supplied authority). The nightly manifest gained the
measured 1,511,899-state M12 wide-reclamation case. Integrated evidence so
far: adapters 195/195, conformance 42 traces 0 failures, theorems 26+9,
TLA baseline+repaired complete suite 87/87 including all cutover cases.
The contributions flag remains off in every deployment; the reclamation
ledger is implemented but not live-qualified.

### 2026-09-25 — Main integrated: writer transfer retired, browser contracts repaired, full gate

The completion branch absorbed `origin/main` at `b8c013b` (device-partitioned
snapshots and lifetime totals from PR #427 through the 25 September rollout
evidence). Six textual conflicts resolved mechanically: the path-filtered CI
keeps main's shape with the branch's publication check, protocol adapter and
conformance gates and Lean-before-Kani ordering; the collector's help text is
main's with the branch's `--incremental` paragraph; both evidence logs keep
both entries; `surfaces.json` carries main's six stats surfaces plus the
reclamation ledger; the workflow action-pin multiset was regenerated. Four
joins were semantic. First, the lifecycle lane's writer transfer
(`transfer_request`, `transfer_grant`, `transfer_complete`) had nothing left
to move once snapshots became per (client, day, device), so the operations,
their views, RPCs and traces are retired from the lifecycle contract and the
enrollment object; device revocation and the two-step erase stay. Second,
main's four new account-scoped tables (`usage_stats_retired`,
`usage_stats_day_totals`, `usage_admission_day_totals` and its cursor) join
the export sections, and the erase step also drops the retired
(client, day) tables so an unmigrated store erases completely; the coverage
test that pins every `costs.json` surface to a section or a reason caught the
gap. Third, a failed publication no longer stops later clients, so the
contribution-sync test expects the remaining `publish` calls while every
contribution send stays withheld for that cycle. Fourth, the UI lane's
browser contracts had only ever run against a stale build: wrapping
`<label>` selects need role queries, leaving a rich metric must re-select a
classic one, the matched trend hint excludes the comparison paragraph,
per-group changes may be negative, saved views keep their query string, and
hour-of-day is refused in both grouping controls. The rich explorer remounts
per facts revision. Evidence on the merged tree at host load 50–73 on 18 cores from concurrent
sessions: typecheck, lint, Rust fmt, clippy and 470 CLI tests (19 autosubmit
tests after the expectation fix), skill and eleven release checks, generated
data, the assurance registry with claims and metric coverage (48 explorer and
50 rich metrics exported), 83 cost surfaces, conformance 42 traces with 0
failures, build, browser run 11 (pairing, stats desktop and mobile, sessions,
dashboard, atlas), Bun 2221 of 2223 and vitest 716 of 721 tests. The seven
misses are timeouts in tests byte-identical to main, which main's CI run
36090166125 finishes in 20–50 % of their budgets, and the adapter gate's
180 s cold build bound could not be met at this load (the bound is checked,
not widened); the pull request's `Required` check on GitHub runners is the
binding aggregate for those. Not activated: the contributions flag stays off
in every deployment, the Worker is not redeployed, and no live drill ran.

Main moved again before the pull request had a check. GitHub creates no
`pull_request` run while it cannot build the merge ref, and the branch
conflicted with the canonical product messaging (#438), the enrolled-device
totals read (#439) and its plan record (#440); the workflow file itself was
sound. The second absorption (`f796696`) resolved four CLI help strings,
keeping the branch's extended text under main's colon heads, and the plan
log kept both entries; the branch adds no em-dash copy of its own. An
independent read-only review of the four joins and the browser repairs
confirmed each of them (no transfer symbol left anywhere, every
`CREATE TABLE` name in an export section or a stated exclusion, autosubmit
continuing past a failed publication while withholding every contribution
send, each browser assertion at least as strong as before) and found one
test-only weakening: the three sign-out checks in the stats contract had
started comparing the URL without its query string, which would have
accepted a sign-out that rewrote the saved view. They now capture the URL
before the click and require it unchanged and still on `/usage/details`.
The review's missing case is added: a store rewritten into the retired
(client, day) ownership shape erases down to the admission tables. Two
review notes are recorded, not acted on, because no build of this branch's
Worker has run anywhere: the persisted lifecycle object is exact-keyed to
`{ erasure }`, and the export cursor is positional over the section list;
both would need a tolerance only for state that does not exist.

The first CI run for the pull request (36099527593) passed every job except
Worker: the protocol adapter and conformance gates, moved into that
unfiltered job by the first integration, need the pinned Rust toolchain
(`rustup which --toolchain 1.97.1`) and warm dependency artifacts under
their checked 180 s bounds, which the lane branches' formal job had
provided implicitly and a bare Bun job does not. The adapter gate takes
3 s on a warm build directory and fails its bound cold, so the job now
installs the toolchain, restores a cache of the two gate build directories
and the crate registry, builds the gate dependencies without a bound
(the conformance pre-build with `CARGO_INCREMENTAL` unset, as the gate
strips it), then runs the bounded gates and saves the cache even on
failure; the bounds themselves are unchanged. Focused evidence on the
re-merged tree at host load 47–50: typecheck, lint, Rust fmt, clippy and
123 focused CLI tests, 114 focused Bun tests, worker tsc with 105 focused
worker tests and the 5 erase tests, generated data, the assurance
registry, the pin audit, build and browser run 12 (pairing, stats desktop
and mobile, dashboard, atlas) with the restored sign-out checks.

The second run (36101030837) carried that wiring. With a cold cache the
unbounded pre-build took 78 s for the adapter dependencies and crate and
14 s for the conformance test binary, and the bounded gates then ran on
Linux for the first time in this repository's CI: the adapter gate reached
discovery 34 s after starting against its 180 s build bound, and the
conformance gate passed in 28 s. Discovery failed on
`adapter_test_count_drift:codex`. Main's PR #434 added three Codex parser
tests (a null-`info` token count as a rate-limit heartbeat, a missing
`info` key as a schema mismatch, an unresolvable model refusing the
measurement fallback) without qualifying them in
`vendor/tokscale-core/QUALIFICATION.json`; main's CI does not run the
adapter gate, so the manifest still expected 74 Codex tests where the
compiled crate lists 77. The manifest now expects 77. Discovery of the
test executable built from the merged vendor tree lists 2287 tests: 77
Codex, 77 Claude Code, 24 Cursor, 14 Devin and 6 offline, a qualified
selection of 198. The same run's receipt retention followed the
conformance stages' `node_modules` symlink and their tool symlinks into a
1.01 GB artifact of 213,348 files; the upload now excludes both and keeps
the receipts, logs, traces and staged sources.

### 2026-09-25 — PR #441 merged and production-verified; Linux notices attribution

The completion branch merged to protected `main` as squash commit
`2356eff8e3113bf7cdb94d691c086d640e2ea022`
([PR 441](https://github.com/hraness/aicharts/pull/441)) at 06:49:29Z after
CI run 36102541354 on head `f4ecca3` (Changes, Checks, Build, Worker with
the adapter and conformance gates, Rust, Menubar, Formal verification and
`Required` all passed, plus the supply-chain workflow and CodeQL). Main had
moved by one unrelated commit (#442); the merge was clean. GitHub
deployment 6655372605 (Production, success, 06:51:07Z) resolved to Vercel
`dpl_H4hVYpFsJ9VqwfexFHSNDZWBah8D` (project `prj_0ppMfRRMDfiVsQ1JaekoxSZ7Mwgn`,
Ready, URL `https://aicharts-cki4omw9r-hraness.vercel.app`), and at
06:51:37Z `bun run usage:deployment:verify --sha 2356eff…` found `/`,
`/dashboard` and `/usage/sessions` at HTTP 200 with
`X-Hraness-Delivery-Proof: v1.b8d6279f57266c1cfc729f38fe834b9bfa28a554d0526343abbcff0eb9bdfbde`,
the recomputed token. The Cloudflare Worker was not redeployed.

Linux CLI qualification run 36104682547 on `2356eff` passed the stages that
had stopped run 36066135869: `read-link-map` (the 64 MiB bound), the ELF and
runtime-library checks against glibc 2.34, and all fourteen installed smoke
tests. It then refused at `notices` with `notices_unmapped_crate`: the
reviewed attribution list of workspace crates predated the kernel lane,
whose `aicharts-metrics` crate is now in the CLI graph. The crate has no
dependencies and inherits the workspace MIT license, so the closeout adds it
to the list and a regression that each of the seven workspace crates in the
CLI graph passes attribution; that regression fails with exactly the CI
error when the list omits the crate. The tree stays Linux-unqualified until
a dispatch on the merged fix passes.

The fix merged as `f495d9f` ([PR 444](https://github.com/hraness/aicharts/pull/444)),
which also qualified the Devin row-bound test that #442 added without a
manifest update (the adapter manifest now expects 15 Devin tests, matching
discovery); its first Build attempt hit the homepage browser flake that main
also shows (a transient duplicate `#model-updates` or `#chart` section during
a bookmark redirect), and the rerun passed. The site was production-verified
again at `f495d9f` (`dpl_2wBgHwhjCaiPZiLqJZrjoJrpuFG4`, three pages, recomputed
token). Qualification run 36108512661 on `f495d9f` again stopped at `notices`
with `notices_unmapped_crate`, now for a registry crate: the delivery-gates
integrator raised `rustls` to 0.23.45 for RUSTSEC-2026-0285 without moving its
notice-policy entry off 0.23.44. The 0.23.45 archive digest equals the
`Cargo.lock` checksum and its three license texts are byte-identical to
0.23.44's, so only the version and checksum change. A diff of the CLI's Linux
dependency graph against the policy found no other unmapped crate. A new
regression requires every policy entry to be a locked registry package with
the same archive checksum; it fails naming `rustls@0.23.44` without the fix.

The rustls policy fix merged as `40874b2` ([PR 446](https://github.com/hraness/aicharts/pull/446))
and the site was production-verified at that commit
(`dpl_o6HJWcj3qVrBecbBwQqQ3X9uQ8TX`, three pages, recomputed token). Linux CLI
qualification run [36109602971](https://github.com/hraness/aicharts/actions/runs/36109602971)
on `40874b2` passed (`checksPassed: true`) through all smoke stages and
`persist-assets`, retaining the qualification artifact. This is the first
Linux qualification of the system-assurance tree. It is artifact admission
only: no `cli-v` tag or immutable release was published, and the macOS
notarized release, Worker redeploy, usage flags and live drills remain
owner-gated.

### 2026-09-25 — Parser-semantics hardening: admission bound, fork-tree properties, formal coverage

The Tokscale reconciliation's root cause (replayed inherited cumulative
counters counted as own turns) closed as a permanent assurance layer rather
than a one-off fix. The work merged as `7743848`
([PR 449](https://github.com/hraness/aicharts/pull/449)) after a semantic
merge with main's assurance manifests.

- Admission plausibility bound: `MAX_TOKENS_PER_RECORD = 8_388_608` enforced in
  both the shared report contract (`STATS_MAX_TOKENS_PER_RECORD`) and the
  CLI's `validate_report`, so an impossible per-record token total can never
  commit under the monotonic server merge. Every registered client is
  event-granular and `replace-snapshot` clients are `tokenBasis: unavailable`,
  so no legitimate row approaches the bound.
- Codex nested-fork dedup fix: generated fork-tree metamorphic tests (own
  turns, replay prefixes, shared cumulative counters, UUIDv7/v4 id modes)
  caught that replayed turns at depth ≥ 2 emitted dedup keys scoped to the
  immediate parent rather than the logical turn, inflating ~2×. Dedup keys
  are now scoped by `current_turn_id`; `CHECKPOINT_GENERATION` moved to 3 so
  retained generation-2 keys cannot survive the format change.
- Golden fixture: `codex_inherited_cumulative_replay.jsonl` pins the shared
  12.9M-counter miniature to expected disjoint per-day totals.
- Differential oracle: the generated suite asserts dedup-level sums equal the
  generator's ground truth even when per-file parses intentionally overcount
  under non-v7 ids.
- TLA+: `M12MonotonicMerge` proves the unguarded merge commits a replayed
  overcount (`m12-unguarded-overcount-commits`) and that a committed overcount
  persists under retry (`m12-committed-overcount-persists`), with
  `m12-guarded-merge-sanity` covering the admitted bounded merge; frozen
  traces bind module and config hashes.
- Kani: 21st harness `cumulative_baseline_delta_conserves_the_counter` proves
  `baseline + delta = snapshot` on `checked_replace` with underflow refused;
  mutation `baseline-delta-clamps-underflow` fails when the kernel clamps.
  Manifests: 56 covers, 14 mutations, repinned unreachable-assertion bindings
  on the merged `proofs.rs`.
- Lean: eight dedup/lineage laws (`dedupSeen_retains`, `dedupSeen_absorbs`,
  `dedupSeen_all_seen`, `dedupSeen_append`, `dedupSum_all_seen`,
  `dedupSum_append`, `dedup_replay_neutral`, `dedupSum_distinct`) verified on
  the pinned toolchain; 17 mathematical theorems total on allowed axioms.
- Wide-arithmetic tests were reframed: admission generators now produce
  physically plausible rows (tokens ≤ records × bound), and layers that fold
  admitted rows exercise >2^53 sums through accumulated max-bound rows
  (`records: 1` for contribution deltas).

Evidence: `bun run check` green on the merged tree (2225 test files' worth
across unit, worker, browser and script suites); full TLA+ suite (17
baseline + 88 repaired cases) green; Kani receipt binds 21 harnesses and 14
mutations; theorems receipt binds 26 production + 17 mathematical theorems
with 5 negative controls; adapter qualification binds 204 tests including
the raised codex group (81) and the merged devin group (16).

### 2026-09-25 — Worker redeployed on the completion tree

With owner authorization, the production Worker `aicharts-usage-local-only`
was redeployed from `1831da3` through wrangler `versions upload` and
`versions deploy`. Version `a9bf7b17-dbaa-4147-a233-c954eb110c6b` reached 100%
traffic at 16:41:49Z with `bd2bac95` retained as the rollback version.
Pre-promotion, `wrangler versions view` on the uploaded build showed every
binding, var, namespace id, compatibility flag and export identical to the
live version — same generation and worker-version pins, public read `0`, no
contributions or reclamation var, so no new storage write is reachable and
the rollback stays compatible. A pre-deploy review of `2e593f7..main` found
every new write path unreachable under the deployed flag set except one real
defect: #449's per-record token bound had been placed in the shared row
parser, so committed pre-bound history would have failed stored-day re-reads
once deployed. #456 moved enforcement to `parseStatsUpload` (upload admission
only) with tests before the deploy. Post-deploy, the consent, stats and
totals routes return their structured refusals; authenticated readback rides
the device's own collector cycle.
