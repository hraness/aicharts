---
title: Build AI Charts Usage
description: Deliver content-minimized local usage collection, shared Hraness identity, durable ingestion and opt-in rankings.
type: plan
area: usage-leaderboard
status: in-progress
---

# AI Charts Usage implementation plan

10 September 2026 · source implementation and remaining delivery work

## Outcome

Deliver an open-source Codex/Claude Code usage collector, opt-in background sync, Hraness-authenticated private analytics and public rankings on aicharts.io. Shared profiles support GitHub, X, LinkedIn, website and R2 avatars. Explicit subscription history and consenting usage cohorts can later supply reviewed calculator datasets. A skill queries both existing benchmarks and personal measurements efficiently.

Implementation began from AI Charts `f9ac128` on `codex/usage-foundation-20260910`. The first source slice implements a local-only numeric protocol, selective historical readers, CLI dry-run and TypeScript rollups. The earlier offline probe is exploratory evidence, not the v1 protocol. Authentication, network ingestion and background installation remain disabled. Current procedure and byte contracts live in `docs/usage-local.md` and `docs/usage-wire-v1.md`.

## Baseline and constraints

- Inspected AI Charts main: `b5ee7dbf38cef04a70166baaf49a42c237dd79d1`; Suite Accounts: `832e9d2364617b54b06872a81fab7a95791f4fd4`; Tokscale reference: `d9a45a65ddfaf21bea2fe9de692aca89f46e67bf`.
- Local `/Users/bg/Documents/aicharts` was older than production. Execute in a task-owned current worktree after checking current branch/base/status and all applicable `AGENTS.md`; do not build against or overwrite the stale checkout.
- Preserve the current static-data benchmark routes, refresh guards, public data contracts, calculator source history, privacy-constrained analytics, accessibility and canonical domain.
- Keep shared identity in the Accounts authority. AI Charts owns usage, publishing consent, provider-account attribution and ranking semantics. Publish immutable reviewed shared contracts before consuming them. No sibling-path dependencies or assumed coordinated `main` deployment.
- Root/integrator owns manifest/lockfile changes, protocol/registry convergence, public route contracts, root check scripts, rollout and final gates. Freeze these interfaces before parallel workers edit callers.
- Check and refresh the managed repository baseline within the same task-owned change, preserving unmanaged rules. Respect the currently installed host scheduler and repository guidance rather than substituting or bypassing either.
- Broad/final portable work: installed absolute host scheduler, `heavy` compute lane. Authenticated browser/dev-server flows: one `browser-auth` owner. Signing/Keychain/native package proof: `mac-native`. Focused pure tests normally need no host lease. Never hold a compute lease while waiting for CI or a deployment.
- AI Charts requires `bun run check`; its current command includes generated-data checks, typecheck, lint, tests, build and browser checks. Add new Rust/worker validation to the reviewed aggregate contract, never silently omit it. Suite Accounts requires its own current `bun run check` and documented package/browser/release evidence. Resolve the Accounts authority's current owning repository and exact gates before editing it; the SDK is not the authority service.
- Protected-main task-owned PRs, independent review, exact-head required CI, merge and production verification are mandatory. Continue routine authorized delivery without asking again, but do not bypass auth, branch protection, provider approval or unknown paid-resource scope.
- Before provisioning, inspect exact provider account/resource/region/plan and existing owner-controlled R2 capacity; check the documented Marketplace route first, then supported provider APIs/CLI if appropriate. No speculative paid resources or durable preview backends.

## Phase map

Paths below are proposed new module scopes, not claims that those modules exist today. Keep Rust and worker code product-owned in the AI Charts repository initially; a separate shared package requires demonstrated consumers.

| Phase | Deliverable | Depends on | Owned write scope | Parallel opportunity |
| --- | --- | --- | --- | --- |
| 0 | Accepted contracts and fixtures | None | Integrator: `crates/aicharts-protocol`, `lib/usage/contracts`, `kb/plans/usage-leaderboard.md` | None until frozen |
| 1 | Hraness web/device identity and shared media profile | 0 | Accounts-authority owner; Suite Accounts `src/identity`, profile/auth packages | 2 after shared schema freeze |
| 2 | Offline real-provider collector and numeric ledger | 0 | Collector owner: `crates/aicharts-core`, `crates/aicharts-cli` | 1 |
| 3 | Authenticated durable ingestion/query backend | 0, 1 | Backend owner: `services/usage`, `lib/usage/server` | 2 for non-shared integration work |
| 4 | Private dashboard and public leaderboard | 1, 2, 3 | UI owner: usage/profile/ranking routes and `components/usage` | 5 and 6 after API freeze |
| 5 | Benchmark/personal usage skill | 2, 3 | Skill owner: `skills/aicharts`; CLI query module assigned exclusively | 4 and 6; no shared CLI file edits |
| 6 | Background service and optional tray | 1, 2, 3 | Native owner: platform service modules, tray crate, packaging | 4 and 5 after CLI command contract freeze |
| 7 | Trust review, groups/sharing and calculator cohort | 4, 5, 6 | Assigned trust, sharing, study modules; integrator owns rollout | Sequential integration with disjoint focused lanes |

No phase may edit a convergence file simultaneously. Workers submit required manifest changes to the integrator rather than racing lockfiles. Every phase ends in independent review and its relevant gate; the integration owner runs final aggregate validation after convergence.

## Phase 0: Production contracts

- **Status:** Partial
- **Depends on:** none
- **Objective:** versioned measurement, identity, privacy and query contracts with representative fixtures.
- **Scope:** strict numeric occurrence/prompt/interval/account record types, registry/version strategy, time/price dimensions, device sequences/revisions, capability claims, retention/deletion contract and reference fixtures. Adopt or replace the offline v0 probe deliberately; it is not the v1 wire by default.
- **Out of scope:** real session scanning, auth enrollment, public uploads, production resources.
- **Acceptance:** no arbitrary content fields; unknown stays unknown; byte/record bounds enforced before allocation; exact token-subset rules; 15m activity and independent 16m concurrency definitions; idempotency/correction state machine and privacy threat model reviewed. Real model aliases and pricing tiers do not reuse the synthetic catalog.
- **Validation:** current focused commands are `cargo test --manifest-path crates/aicharts-protocol/Cargo.toml --locked` and `bun test lib/usage`. Maintain property/fuzz seeds for round-trip canonicality, overflow, malformed/trailing input, duplicate identity, interval union, half-open boundaries and partial coverage. Add the remaining account/correction contracts and civil-time presentation tests before completing this phase.

## Phase 1: Shared identity and profile authority

- **Status:** Not started
- **Depends on:** 0
- **Objective:** one Hraness identity works for web and device enrollment, with shared social/avatar profile.
- **Scope:** authority registration of AI Charts; supported CLI authorization flow; compatible SDK consumer/profile changes; GitHub normalization; avatar upload/finalize/delete; explicit public projection without email.
- **Out of scope:** private provider-token forwarding, independent AI Charts passwords, product-specific usage in shared profile package.
- **Acceptance:** issuer/audience/subject/scope checks fail closed; account rename preserves ownership; pairwise subjects map through canonical authority; old consumers remain compatible; profile revision conflicts are recoverable. Avatar dimension/byte/type/metadata protections and deletion races pass. CLI credentials are revocable and source-provider tokens never leave the machine.
- **Validation:** SDK focused `bun test src/identity/profiles.test.ts src/identity/consumers.test.ts`, existing auth tests and new media contract tests; full SDK `bun run check`, plus its required browser/release qualification. Authority owner records exact repository commands before implementation. Prove browser sign-in, native approval, revoked-device denial and wrong-user upload denial with isolated test identities. Publish the immutable shared release before application adoption.

## Phase 2: Local collector

- **Status:** Partial
- **Depends on:** 0
- **Objective:** `aicharts usage` and `upload --dry-run` produce correct content-free measurements for Codex/Claude locally.
- **Scope:** selective readers, installed-version capability probes, incremental cursors, native identity/lineage normalization, numeric local ledger, account observations and exact dry-run projection. Live hooks/OTel ingestion remain local and opt-in.
- **Out of scope:** network publishing, desktop service installation, other providers, guessed historical human authorship/concurrency.
- **Acceptance:** no session files copied, no transcript objects persisted, no unnecessary token refresh; unrelated hooks/exporters preserved. Copied supported requests dedup across source paths; fork ambiguity is visible; streaming records count once; truncation/rotation/partial writes recover. Current plan is never retroactively assigned to unidentified history. Reader/uploader restrictions have a testable platform capability status, not an unconditional security claim.
- **Validation:** proposed `cargo test --manifest-path crates/aicharts-core/Cargo.toml --locked` and CLI fixture tests. Synthetic forbidden-field substitutions preserve measurement outputs and never retain forbidden content; bounded local cursor/transport bookkeeping may change. Malformed/oversized values fail boundedly without reflection. Test crash between cursor/ledger steps, resource bounds, deep nesting and unknown schemas. Provider compatibility fixtures record versions; actual installed-provider qualification reports only sanitized counts/capability results, never log content. Measure bounded CPU/RSS and incremental rescan work rather than asserting “fast” from language choice.

## Phase 3: Ingestion and storage

- **Status:** Not started
- **Depends on:** 0, 1
- **Objective:** one authenticated enrolled user can upload/retry/query/delete measurements with correct durable recovery.
- **Scope:** Worker admission, per-user DO index, private R2 ledger/receipts, compaction, pricing snapshots, query authorization, queue/outbox, server materialization and deletion.
- **Out of scope:** public rankings, billing-provider credentials, live upstream benchmark dependency, unbounded query scans.
- **Acceptance:** raw request bodies never enter persistence/logging; only canonical records reach storage. Same sequence/hash commits once, conflicting retry fails. Copies on a second device dedup by user-scoped upstream identity, not device ID. Reinstall recovers the existing versioned dedup namespace; revocation/key rotation cannot remint ranked history. Correction can decrease totals. Explicit reserved/receipt-pending/accepted states fence concurrent revisions until their predecessor is durable. Accepted R2 receipts and tombstones reconcile after DO restore; orphan staging is excluded; delayed messages cannot resurrect deleted data. Gateway pricing is versioned, decimal-safe and coverage-aware; client money ignored.
- **Validation:** proposed `bun test services/usage` and `bun test lib/usage/server`; worker runtime integration tests for DO/R2/queue behavior. Inject failures before/after reserve, object write, finalize, receipt, acknowledgment and publication. Test weeks offline, retry exhaustion, simultaneous uploads, oversized body, unauthorized account, price gaps, compaction and restored-state replay. Run a bounded real upload and readback with explicit test identity; separately prove persistence and recovery. No production user-history import until the round trip and deletion tests pass.

## Phase 4: Dashboard and leaderboard

- **Status:** Not started
- **Depends on:** 1, 2, 3
- **Objective:** useful private analytics and explicit opt-in public rankings within existing AI Charts design/navigation.
- **Scope:** `/usage`, `/usage/me`, `/usage/settings`, `/leaderboard`, `/u/[username]`; daily contribution view, period/client/model filters, breakdowns, accounts/subscriptions, evidence/freshness/coverage states. Reuse immutable design primitives; preserve ordinary appearance control and accessible keyboard/touch behavior.
- **Out of scope:** public minute-by-minute schedules by default, “verified human” claims from role labels, calculator population claims.
- **Acceptance:** private routes cannot be cached or returned to another user; public projection excludes email/device/account aliases; ranking uses materialized bounded queries. No activity over 100%; two devices peaking at different times do not get summed peaks. Actual charges, API-equivalent value and fees have distinct labels. Empty/partial/stale/unknown-price/revoked/publishing-disabled states are usable.
- **Validation:** proposed `bun test lib/usage components/usage app/usage app/leaderboard app/u`; extend the repository's real app-verifier/browser harness with auth-separated fixture contexts and mobile/keyboard checks. Read installed Next.js docs before route implementation. Full `bun run check` after integration, including existing chart/calculator regressions.

## Phase 5: AI Charts skill

- **Status:** Not started
- **Depends on:** 2, 3
- **Objective:** an agent efficiently gets sourced benchmark answers and private usage summaries without touching raw sessions.
- **Scope:** portable skill instructions, bounded JSON CLI query commands, public snapshot cache/ETags and read-only personal query authorization. Use the skill-creator workflow when authoring the actual skill.
- **Out of scope:** implicit publishing, background enablement, credentials in prompts, full transcript analysis.
- **Acceptance:** benchmark response includes units/configuration/source/date/version; projections and pagination are bounded. Incompatible benchmarks are not collapsed into one score; stale/offline cache is labeled. Personal queries use numeric local data or authorized remote metrics. Ordinary analysis never changes upload/consent settings. External source text is treated as data, not instructions.
- **Validation:** proposed focused CLI skill integration tests and skill validation from its creator workflow. Scenarios: latest benchmark lookup, precise model filter, missing model, stale cache, incompatible score scales, personal hourly cost with missing prices, no login, expired read scope, malicious model/source text. Record response-byte savings versus full dataset without inventing a target before measurement.

## Phase 6: Background worker and menu app

- **Status:** Not started
- **Depends on:** 1, 2, 3
- **Objective:** explicit installation enables reliable low-overhead sync and a clear optional tray UI.
- **Scope:** absolute pinned binaries; LaunchAgent/systemd-user/Windows task integrations; lock/outbox/backoff/status/doctor; optional vector ai-circle tray; signed packaging/update rollback.
- **Out of scope:** always-on privileged system daemon, replacing the user's Tokscale automation, enabling disabled collection after repair.
- **Acceptance:** enable is idempotent and reversible; no overlapping manual/daemon readers; service status reports stale/errors without secret content. Offline/auth expiry preserves counters; sleep/wake/reboot/log rotation recover; pause/disable persists. Closing the tray and stopping collection are distinct. Updates verify publisher/artifact, replace atomically and recover interruptions. Each platform advertises only qualified collection/isolation capabilities.
- **Validation:** Rust platform fixture/unit tests plus actual macOS, Linux and Windows install/upgrade/uninstall/service restart smoke tests. Use the native/browser lanes for corresponding real application checks. Kill at each persistence/upgrade boundary, start simultaneous uploads, advance clocks, interrupt network and revoke auth. Measure idle CPU, RSS, wakeups and upload bytes on representative fixtures. Do not present Mac-only success as cross-platform verification.

## Phase 7: Trust, parity and calculator study

- **Status:** Not started
- **Depends on:** 4, 5, 6
- **Objective:** reviewed public launch with transparent moderation, group/sharing parity and useful optional utilization evidence.
- **Scope:** anomaly/review/appeal workflow; public/private groups; badges/embeds/yearly recap; study consent, billing-period coverage, privacy-preserving cohorts; separately reviewed Claude calculator dataset/scenarios.
- **Out of scope:** proof of productivity, universal anti-fraud, provider-cost/subsidy assertions from retail-equivalent counters, automatically replacing curated calculator anchors.
- **Acceptance:** quarantined/deleted/private data cannot leak through cohorts, badges or cached groups. No provider-verified badge without independently checkable evidence. Same subscription on two devices counts once; real separate subscriptions remain separate; plan changes are dated. Cohorts show sample size, selection bias, coverage and suppression. New calculator inputs retain old snapshots/source history and publish only after review.
- **Validation:** focused trust/cohort/share regression/property tests; cross-user copy attack, forged counts, clock changes, replay, re-enrollment, unknown prices, deletion-cache invalidation and sparse cohort privacy scenarios. Full current repository gates, independent security/privacy review and staged live release checks. Production verify canonical origin/commit, sign-in, known upload/readback, ranking freshness and deletion without altering unrelated production records.

## Delivery and recovery

Keep install/upgrade defaults local-only until the relevant online behavior passes qualification. Deploy additive protocols and backward-compatible readers before enabling new writers. New infrastructure stays disabled until owner identity, capacity, authorization, recovery and costs are verified. Use feature controls for public publishing/cohorts separately from private collection.

Before each merge, review task-owned diff, exact base/head, independent review findings and required CI. After merge, verify Vercel/Worker release identity and scoped live health; record commits, PRs, checks, immutable package/binary releases and production evidence in this plan. Roll back code/configuration to a compatible release without discarding acknowledged measurements. Reconcile pending operations rather than replaying blindly. No database reset, bucket purge or destructive migration is authorized by normal delivery.

## Resolvers before operational activation

| Question | Resolver and safe default |
| --- | --- |
| Which existing Cloudflare account/resources and cost envelope? | Integrator inspects authorized resources/current plans; reuse suitable owner-controlled resources, otherwise request only the missing budget/authority decision. |
| Which native authorization flow is supported? | Accounts owner verifies current authority; add reviewed support, never improvise credential extraction. |
| Can each platform enforce reader/uploader isolation? | Native owner provides capability tests; mark unavailable capabilities explicitly and keep stronger claims disabled. |
| Are historical prices/occurrence identities/plan periods available? | Collector/data owner tests versions and sources; preserve unknown/partial evidence rather than guess. |
| Is 16m intentional? | Preserve the explicit requested 16m view; optional later UX standardization is the product owner's choice, not a blocker. |

## Implementation log

### 2026-09-10 — local-only foundation, source validation passed

Added three Rust crates and matching TypeScript wire/rollup modules. A shared independently assembled golden frame establishes byte parity. Historical readers use metadata-only projections and keyed occurrence identities, retain unknown model/account/origin information, and do not fabricate intervals. The CLI requires explicit sources and a private namespace key; it can inspect or produce a local dry-run but cannot upload.

Independent review corrected non-object source metadata handling, optional Codex identity drift, pre-epoch timestamps, argument-encoding error reflection and Buffer aliasing. Coverage must be supplied authoritatively and exclude adjacent-day uncertainty. Per-request interval IDs are distinct from parent-agent IDs.

Integration review confirmed that both complete-gate CI callers install the pinned Rust toolchain and that data refresh remains fail-closed on setup or validation failure. The Next.js managed instructions remain intact in `CLAUDE.md`, with the mandatory installed-documentation rule retained in `AGENTS.md`; a regression checks that the pinned generator preserves both files and the KB guide format.

Remaining phase 0 work includes account-observation/correction/enrollment contracts, production registry/pricing dimensions and recovery state-machine implementation. Remaining phase 2 work includes local transactional cursors/outbox, credential-vault/recovery integration, live lifecycle telemetry and OS-enforced reader isolation. Current explicit limits and unsupported imports remain visible. No personal logs or credentials were used for tests; no live uploads or resources were activated.

The root integration owner passed `bun run check` with the pinned Rust toolchain: 57 Rust tests, 878 Bun tests, strict TypeScript, lint, generated-data checks, the 244-page production build and the real browser contracts. `bun run kb:refresh` and `bun run kb:check` also passed. Independent protocol, collector, server-contract and integration review findings are resolved. Exact-head Linux CI, merge and production verification remain delivery gates; the pull request will retain their immutable evidence.
