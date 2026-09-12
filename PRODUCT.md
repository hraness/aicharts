# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers who use Codex and Claude Code and want a trustworthy, privacy-preserving view of their own AI work, plus an optional public comparison with other consenting users.

## Product Purpose

AI Charts Usage turns local numeric usage measurements into personal analytics and, only with explicit consent, public leaderboard measurements. The product must make it easy to understand activity, throughput, turn shape, subscriptions, and coverage without uploading chat logs or transcripts.

## Positioning

Trust is a product feature: collection is open source, numeric-only by construction, bounded before allocation, and visibly separated into local collection, account enrollment, remote admission, and public publishing. Unknown or partial measurements stay unknown instead of becoming confident-looking guesses.

## Operating Context

The primary workflow begins on a developer machine with Codex and Claude Code session stores. A reviewed CLI/daemon may read only the provider fields needed for numeric metrics, maintain a local ledger, and optionally synchronize accepted measurements. The web app presents personal analytics first; the public leaderboard is a separate consented projection.

## Capabilities and Constraints

- Initial providers are Codex and Claude Code only.
- Metrics include tokens, prompts, activity at 15-minute granularity, throughput, hourly message counts, concurrent agents, and daily average turn runtime, tokens, and tool calls.
- No transcript, prompt, tool input, model response, path, credential, or raw session object may enter remote storage.
- Hraness Accounts are the intended sign-in authority; profile projection may include X, GitHub, LinkedIn, website, and an R2-backed avatar.
- Subscription/account observations remain explicit, dated, and coverage-aware; retail-equivalent API pricing is not a bill.
- Public usage, authentication, enrollment, upload, daemon installation, and leaderboard routes remain disabled until their live qualification gates pass.

## Brand Commitments

The product is AI Charts, on aicharts.io, and should extend the existing AI Charts visual system rather than introduce a separate brand.

## Evidence on Hand

The repository contains reviewed local numeric collectors, turn rollups, bounded wire/admission contracts, dormant Hraness/Worker coordination, release-source custody, and public benchmark data. Live authenticated ingestion and public usage pages are not yet qualified.

## Product Principles

1. Never trade privacy for a prettier metric.
2. Show coverage, evidence, freshness, and unknowns alongside every number.
3. Make local-only use useful before account enrollment.
4. Separate personal analytics from public consent and moderation.
5. Prefer reversible, additive, inspectable delivery over hidden activation.

## Accessibility & Inclusion

Usage analytics must work with keyboard and screen-reader navigation, preserve readable tabular numerals, expose empty/partial/stale/error states, and remain usable on narrow mobile viewports.

## Open Decisions

- Inferred default: personal analytics is the first signed-in screen; the user has not explicitly confirmed this choice.
- The live Cloudflare resources, authenticated Hraness production binding, and public publishing rollout remain unprovisioned.
