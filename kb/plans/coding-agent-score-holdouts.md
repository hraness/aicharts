---
title: Ship a holdout reading take
description: Publish one original /blog note on why a coding-agent high score still needs a holdout, sourced from Dan Luu and the live method pages.
type: plan
area: blog
status: in-progress
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

`/blog/coding-agent-score-holdouts` is a crawlable evidence page with an H1, dated primary sources, and only the internal links that help a reader inspect the dataset or continue a directly related analysis. It quotes fetched Dan Luu sentences, copies snapshot leaders instead of inventing ranks, and stays a different question from the live open-models comparison.

## Context

The live collection already has an open-models reading take and an AA Index versus cost note. Dan Luu’s original essay, [The benchmarkpocalypse](https://danluu.com/benchpocalypse/), reports an agent-built regex engine whose public-suite win failed a holdout. That evidence answers a distinct reader question from open-versus-closed catch-up; a digest of the same essay would not independently support it.

## Scope

### In scope

- One new blog article factory, slug, sources, and snapshot-derived tables.
- Tests that lock primary-source quotes, `/data` evidence links, and copied leaders.
- Discovery links only on existing surfaces where the holdout analysis directly helps the reader.

### Non-goals

- Refreshing `data/coding-agents.json`.
- Merging to `main`.
- Capturing the source URLs into `kb/articles/` in this pass.

## Constraints and decisions

- Quote only sentences visible in the fetched Luu essay.
- Highest stored scores come from `currentCodingAgentBenchmarkLeaders`.
- `relatedSlugs` contains only links that advance the article’s argument; it may be empty and has no exact-count requirement.
- Public contract change ships through a pull request, not a fast-forward to `main`.

## Plan

1. Fetch the Luu essay, the Artificial Analysis source, and the live method pages.
2. Add the article and wire the crawlable `/blog` path.
3. Update interlinks and repository checks.
4. Open a draft pull request and leave it unmerged.

## Verification

- The article answers the holdout question directly, cites the Luu essay and Artificial Analysis source, and avoids Hraness-digest or volume-based admission tests → `bun test app/blog/blog.test.tsx`.
- Snapshot leaders and primary-source quotes appear in rendered HTML → holdout derivation test.
- `bun run check` passes.
- Rendered `/blog/coding-agent-score-holdouts` has one H1, crawlable primary-source links, and no automatic sibling-link quota.

## Risks and recovery

- Overlap with the open-models note → keep this page on holdouts and named-suite scores only.
- Accidental rank language → copy stored scores and repeat the dataset page’s “not general ranks” limit.
