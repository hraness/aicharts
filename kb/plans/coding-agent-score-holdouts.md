---
title: Ship a holdout reading take
description: Publish one original /blog note on why a coding-agent high score still needs a holdout, sourced from Dan Luu and the live method pages.
type: plan
area: blog
status: completed
repository_scopes:
  - app/blog
  - app/data/page.tsx
  - lib/site-markdown.ts
  - docs/seo-strategy.md
tags:
  - editorial
  - seo
---

# Ship a holdout reading take

## Outcome

`/blog/coding-agent-score-holdouts` is a crawlable evidence page with an H1, dated sources, and internal links to `/data`, the AA Index versus cost note, the open-models note, and the Hraness reading note. It quotes only fetched Dan Luu and Hraness sentences, copies snapshot leaders instead of inventing ranks, and stays a different question from the live open-models comparison.

## Context

The live collection already has an open-models reading take and an AA Index versus cost note. Dan Luu’s [The benchmarkpocalypse](https://danluu.com/benchpocalypse/) and the [Hraness digest](https://hraness.com/reading/the-benchmarkpocalypse) argue that a public-suite win can fail a holdout. That is a distinct search intent from open-versus-closed catch-up.

## Scope

### In scope

- One new blog article factory, slug, sources, and snapshot-derived tables.
- Tests that lock fetched quotes, `/data` interlinks, and copied leaders.
- Internal links from `/data`, homepage markdown, README, and related notes.

### Non-goals

- Refreshing `data/coding-agents.json`.
- Merging to `main`.
- Capturing the source URLs into `kb/articles/` in this pass.

## Constraints and decisions

- Quote only sentences visible in the fetched Luu essay and Hraness note.
- Highest stored scores come from `currentCodingAgentBenchmarkLeaders`.
- `relatedSlugs` stays one item: the AA Index versus cost note.
- Public contract change ships through a pull request, not a fast-forward to `main`.

## Plan

1. Fetch both source pages and the live method pages.
2. Add the article and wire the crawlable `/blog` path.
3. Update interlinks and repository checks.
4. Open a draft pull request and leave it unmerged.

## Verification

- Article title ≤ 64 characters, SEO description 120–160, body ≥ 800 words → `bun test app/blog/blog.test.tsx`.
- Snapshot leaders and fetched quotes appear in rendered HTML → holdout derivation test.
- `bun run check` passes.
- Rendered `/blog/coding-agent-score-holdouts` has an H1 and the required crawlable links.

## Risks and recovery

- Overlap with the open-models note → keep this page on holdouts and named-suite scores only.
- Accidental rank language → copy stored scores and repeat the dataset page’s “not general ranks” limit.

## Execution evidence

- 2026-08-26 — Fetched https://danluu.com/benchpocalypse/ and https://hraness.com/reading/the-benchmarkpocalypse, plus the live `/data`, AA Index versus cost, and open-models pages.
- 2026-08-26 — `bun test app/blog/blog.test.tsx` passed, including the holdout derivation test.
- 2026-08-26 — `bun run check` passed. The production build emitted `/blog/coding-agent-score-holdouts`.
- 2026-08-26 — `bun run kb:refresh` and `bun run kb:check` passed. The new plan is an expected orphan until a maintained note needs it.

## Result

`/blog/coding-agent-score-holdouts` is a crawlable evidence page with an H1, fetched Luu and Hraness quotations, snapshot-derived leader tables, and links to `/data`, AA Index versus cost, the open-models note, and the Hraness reading note. Pull request #32 is open and unmerged.

## Durable memory

No new maintained concept was needed. The article owns the public reading. [[notes/documentation-ownership]] still owns the split between guides, docs, tests, and KB plans. The SEO query map in `docs/seo-strategy.md` now names this holdout intent beside the existing cost and open-models notes.
