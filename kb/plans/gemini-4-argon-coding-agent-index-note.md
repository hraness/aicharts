---
title: Publish the Antigravity CLI · Gemini 4 Argon coding-agent note
description: Ship /blog/gemini-4-argon-coding-agent-index, a note that places Antigravity CLI · Gemini 4 Argon (default) third on the coding-agent chart from the checked snapshot, prices the two rows above it as multiples of its cost, walks the cost frontier down from it, names the component that carries the composite, separates the Intelligence Index row from it, reads Google's limited-access statements, and completes its Slopcamera figure through the documented generation path.
type: plan
area: blog
status: in-progress
repository_scopes:
  - app/blog
  - lib/gemini-4-argon-placement.ts
  - data/model-release-dates.json
  - editorial
tags:
  - editorial
  - coding-agents
  - intelligence-index
---

# Publish the Antigravity CLI · Gemini 4 Argon coding-agent note

## Outcome

`/blog/gemini-4-argon-coding-agent-index` is live at `https://aicharts.io` with one registered Slopcamera figure. The note states where Antigravity CLI · Gemini 4 Argon (default) lands on the coding-agent chart (third of 31 on AA Index at $5.84 per task, the ninth highest cost), what the two Claude Code rows above it charge for their extra points (each at least 2.2x the Argon row's cost), what the frontier row beneath it gives up (0.8 points for 18% of the cost), which component carries the composite (DeepSWE v1.1, which the row leads; it is fifth on Terminal-Bench 4 and 21st on SWE-Atlas-QnA), why the Intelligence Index row at 52.6 and $1.99 is a different unit, and who can run the model today at what price according to Google's announcement.

## Context

The checked coding-agent snapshot (`data/coding-agents.json`, `retrievedAt` 2026-10-05T14:10:36.287Z, 31 costed configurations) stores one Gemini 4 Argon row: Antigravity CLI · Gemini 4 Argon (default) at AA Index 63.76, DeepSWE v1.1 78.76, Terminal-Bench 4 56.06, SWE-Atlas-QnA 56.45, $5.84 per task, 2,070 seconds, and 13,733,794 tokens per task; the update log records it on 2026-10-05. Claude Code · Sonnet 5.5 (max) at 68.36 and $14.19 and Claude Code · Opus 5.5 (max) at 65.99 and $13.04 are the only rows above it, so the Argon row's cost is 41% and 45% of theirs. The row is on the cost frontier; the first vertex below it is Codex · GPT-6.1 Sol (xhigh) at 62.9 and $1.04. The row leads DeepSWE v1.1 by 5.6 points over Muse Code · Muse Spark 1.3 (xhigh) and Codex · GPT-6.1 Sol (xhigh), which tie at 73.1563421828909. Its Terminal-Bench 4 value ties Devin Fusion CLI · Claude Fable 5.1 XHigh + SWE-2 Medium (default) exactly at 56.0606, and its SWE-Atlas-QnA value ties Claude Code · Sonnet 5.5 (high). The only other costed Google row is Antigravity SDK · Gemini 3.8 Flash (high) at 41.9 and $2.47, a different model in a different harness.

Intelligence Index v4.3.2 (`data/artificial-analysis-intelligence-v4-3.json`, `retrievedAt` 2026-10-06T11:15Z) stores Gemini 4 Argon (High) at 52.56 and $1.99 per task, eighth of 103 configurations with a measured cost. `AutomationBench-AA` is one of the ten Index evaluations, so the note says Google's AutomationBench figure has an Artificial Analysis variant in the Index row rather than claiming the family appears on no aicharts chart.

Primary sources read on 2026-10-06: Google's announcement of 2026-09-30 (rollout to trusted cyber defenders through the Fairwind Program, phased release, the U.S. government's voluntary pre-release process, introductory $2 and $10 per million tokens with a 95% cached-input discount, later $4 and $20, 1M output tokens, the no-guardrails statement for trusted defenders, the vendor-run DeepSWE v1.1 77.9% and the Vals Index, AutomationBench, CWE-bench v1, and LVBench figures) and Artificial Analysis's `gemini-4-argon` model page (release date September 30, 2026, "Not publicly available" on its chart blocks, FAQ "available via API through 1 provider", rounded index 53 at #8 of 225, $1.99 per index task, 110M output tokens across the index, 1M context). Every quotation lives in the `GEMINI_4_ARGON` constant and the tests check each one is present verbatim.

`data/model-release-dates.json` keeps `google/gemini-4-argon` pending. The ledger's verified stages are `general-availability`, `public-preview`, and `public-release`; a rollout to trusted testers with no general release date matches none of them, so the record's reason now cites the announcement and the date it was researched (2026-10-06) and the model card stays on "release date pending" until Google publishes a public or preview release.

## Admission

Scores 0–2, total 10, no zero: reader utility 2, original evidence 2, factual confidence 1, host fit 2, voice integrity 1, maintenance value 2, recorded in `app/blog/gemini-4-argon-coding-agent-index-admission.ts` and registered in `app/blog/article-admissions.ts`. Factual confidence is 1 because the snapshot advances daily and Google has announced a price change that moves the row horizontally; voice integrity is 1 because the note shares the series' section templates. Reader task: what the row's third place and $5.84 measure, what the two rows above it charge, what the frontier row beneath it gives up, which component carries the composite, why the Index row is a different unit, and who can run the model today. Closest live notes and distinctions are recorded in the admission: the Sonnet 5.5 coding-agent note (places the leader and names Argon only as the DeepSWE v1.1 leader in the component table; it gains this note as a nearest URL), the Opus 5.5 coding-agent note (places Opus and its generation step), the GPT-6.1 Sol note (a Codex effort ladder and frontier membership), and the AA Index cost note (the whole frontier without a placed row). The independent review compared the headings and claims against every live note and found fewer than a third overlapping; the shared structure is the series' section order, and the cost-share framing, the limited-access reading, and the two-unit Index contrast for this model are this note's own.

Provenance: drafted by a Cursor cloud agent (Claude Fable 5.1) on 2026-10-06 from the checked snapshots and the two primary pages. The independent review ran in a fresh-context subagent on Claude Fable 5.1 with no access to the drafting transcript; it reproduced every number from the data files, found the overlap under a third, and returned five required changes (remove the cross-chart "standing is higher" reading of the rank gap; replace the unsupported claim that Google's DeepSWE run differs in harness, sample, and date with what Google does and does not disclose; correct "none of which appears on an aicharts chart" because `AutomationBench-AA` is an Index evaluation; correct the "speed and price charts" attribution and address the FAQ's "available via API through 1 provider" line; change the title so it does not reuse the Sonnet note's formula), all applied before this plan was written. The admission records `reviewedBy: "Claude Fable 5.1"` with `reviewerType: "ai"`, which widened the type-locked reviewer name from the single `"Codex"` constant to a closed union of named AI reviewers; the provenance sentence renders as "Drafted with AI and reviewed by Claude Fable 5.1." No human review is claimed; `humanReviewedOn` is `null`. Reviewed 2026-10-06, reassess 2026-11-10.

## Scope

### In scope

- `lib/gemini-4-argon-placement.ts`: the Antigravity CLI · Gemini 4 Argon binding of the shared coding-agent placement with the cost rank among costed rows, the higher-cost shares of every row above it, the closest costed rows below, the frontier descent, per-component contrasts against the best other row, and the other costed Google rows, with example and property tests.
- `app/blog/gemini-4-argon-coding-agent-index-article.ts` with a `createGemini4ArgonCodingArticle(codingSnapshot, intelligenceSnapshot)` factory, the admission record, the public slug, the `googleGemini4Argon` and `artificialAnalysisGemini4ArgonModel` sources, and a nearest-URL entry on the Sonnet 5.5 coding-agent admission.
- The pending-reason update in `data/model-release-dates.json`.
- One registered Slopcamera figure: registry row, manifest entry, and `public/images/blog/gemini-4-argon-coding-agent-index.webp`.

### Non-goals

- Restating Google's benchmark table as findings; the note quotes the vendor figures and reads the chart.
- Changing the release-date ledger's verified stages so a trusted-tester rollout counts as a release.
- Placing Gemini 4 Argon in any harness other than Antigravity CLI; if another row appears, the note lists it.
- Changing the editorial-image type contract so a live note can ship without a figure.

## Constraints and decisions

- The title states the chart-backed finding without reusing the Sonnet ("X is first on the coding-agent chart at N, $C"), Opus ("X tops the coding-agent chart"), or GPT-6.1 Sol ("X's best Codex row is N") formulas: "Gemini 4 Argon at 63.8: every higher row costs at least 2.2x" when every higher row costs more, "Antigravity CLI · Gemini 4 Argon: N at $C a task" otherwise or when the multiple form exceeds 64 characters, and "Antigravity CLI · Gemini 4 Argon on the coding-agent chart" when the row is absent.
- Rank and cost rank derive from the snapshot; the cost-rank sentence counts the lower-scoring rows that cost more per task. The share heading and the closing sentence of the share section appear only when every higher row costs at least twice as much.
- Component ranks name exact ties on the placed row's own value and on the best other row's value, so the DeepSWE v1.1 lead names both tied runners-up and the Terminal-Bench 4 fifth place names its tied peer.
- The Index section states the two ranks and that they come from different task sets, cohorts, and cost definitions, and stops there. It does not read the gap between the ranks as a property of the model.
- Google's DeepSWE v1.1 figure is quoted and set beside the chart's score with the statement that Google does not disclose the harness, task sample, or date; the note does not assert that those differ.
- Access statements are quoted from Google and Artificial Analysis and attributed to them; the note says the row measures a model most readers cannot yet buy and that a reader outside the named groups cannot reproduce the row today.
- The Slopcamera figure follows `editorial/IMAGES.md`: reviewed source build at commit `66b4322030f4de24f4d5b6d0c2515c109259f901`, credentials only in the child process, one paid call per prompt, no automatic retry, dark monochrome with one brass accent, a silhouette distinct from the Opus tall block, the Sonnet five terraces and wedge, the Sol five discs, the Grok stone on two plinths, and the Index five spheres on a staircase.

## Plan

1. Verify the snapshot rows and every quotation against `data/coding-agents.json`, `data/artificial-analysis-intelligence-v4-3.json`, and the two primary pages. Done 2026-10-06.
2. Write the placement binding, the article factory, registration, admission, Sonnet nearest-URL update, ledger reason, and tests; run the admission gate and the independent review; apply the review's required changes. Done 2026-10-06.
3. Generate, review, and register the Slopcamera figure. Done 2026-10-06. Generation was blocked in the cloud VM (no Vercel CLI, no `~/.vercel` link, no `VERCEL_TOKEN`, no `SLOPCAMERA_SOURCE_ROOT`, no provider credential), so the owner ran the documented command on a credentialed machine: one paid call, gateway directory `20261006T151140770Z-image-06130a7c-4ac`, job `gateway_c84e8a377e0a4b8b83606d2ba2042e94`, output `image-01.webp` at 81,450 bytes, SHA-256 `94b3560d9765c5d19613bc330b30ef5b1c2b2d8806e1f9802e77ad0962bf9941`, prompt SHA-256 matching the prompt below, `localValidation` `decode-passed`, reviewed at 1536×864 and in the 384×216 contact sheet and accepted. The registry row, manifest entry, and `public/images/blog/gemini-4-argon-coding-agent-index.webp` were added from those values; `bun test app/blog/blog.test.tsx app/blog/gemini-4-argon-coding-agent-index-article.test.ts` and `bun run typecheck` pass.
4. Let CI pass, enable auto-merge on the task-owned pull request, and verify the live URL, figure, Open Graph image, `/blog` listing, and `/llms.txt` entry.

## Figure handoff

The figure landed on 2026-10-06 through the steps below. Until it did, `bun run typecheck` fails on `app/blog/editorial-images.ts` (the registry type requires a row for every public slug) and on the blog image-gate assertion that compares registered slugs to `BLOG_SLUGS`, and `bun test app/blog/gemini-4-argon-coding-agent-index-article.test.ts` fails only the `blogEditorialImage` assertion. All three are the intended fail-closed behavior.

### Prompt

Write this text, with one trailing newline, to `artifacts/slopcamera/prompts/gemini-4-argon-coding-agent-index.txt`. Its SHA-256 is `c0dfd0bc86d88d7918aa81627db4ed68e2f3155b82ac927fe72b8e9d09e15d16`; record that value as `promptSha256`.

```text
A calm still-life illustration on a near-charcoal ground (#12100f), 16:9, matte studio lighting, no text, no numbers, no axes, no charts, no logos, no watermarks, no people, no robots, no brains.

Composition: one long, low charcoal shelf (#1d1a18) runs across the lower third of the frame. Near the left end of the shelf stands a single medium-height matte ivory column (#f5f2ed), smooth and rounded at the top. A sheer, dark translucent gauze screen hangs in front of the ivory column, so the column is clearly visible but softened, as if behind a veil. Far to the right end of the shelf stand two taller dark charcoal pillars, close together, both taller than the ivory column, lit by a faint warm rim light. One thin warm brass line (#d0a77c) runs along the front edge of the shelf under all three forms. Wide empty space between the ivory column and the two dark pillars.

Palette: monochrome charcoal and warm ivory with one warm brass accent only; no blue, no saturated colour, no cream or ivory paper background. Soft grain, flat matte surfaces, subtle shadows, center-safe composition that stays legible when cropped to a square around the middle. Minimal, large forms, nothing else in the scene.
```

The veil stands for limited access, the two taller dark pillars for the two costlier rows above, and the gap along the shelf for the cost distance; none of that is written into the image.

### Generation

Run from the repository root with `SLOPCAMERA_SOURCE_ROOT` bound to the reviewed build and `artifacts/slopcamera/provider-options.json` holding `{"openai":{"quality":"medium","outputFormat":"webp","outputCompression":88}}`:

```sh
vercel env run -- bun "$SLOPCAMERA_SOURCE_ROOT/apps/desktop/dist/cli/main.js" ai image generate \
  --model openai/gpt-image-2 --prompt-file artifacts/slopcamera/prompts/gemini-4-argon-coding-agent-index.txt \
  --count 1 --max-per-call 1 --size 1536x864 \
  --provider-options artifacts/slopcamera/provider-options.json --timeout 300s --json
```

Review the original at 1536×864 and in a 384×216 contact sheet beside the live figures. Reject accidental text, distorted forms, fake data, a repeated composition, or a subject that disappears in the center crop. Do not retry an ambiguous paid result automatically.

### Registration

1. Copy the accepted WebP to `public/images/blog/gemini-4-argon-coding-agent-index.webp` and record `sha256sum` and byte size.
2. Add a row to `BLOG_EDITORIAL_IMAGES` in `app/blog/editorial-images.ts` using the `image(...)` helper: slug `gemini-4-argon-coding-agent-index`; alt text describing the visible composition (draft: "A matte ivory column stands behind a sheer dark veil near the left end of a long low charcoal shelf; two taller dark pillars stand together at the right end, with one brass line along the shelf's front edge."); caption "Antigravity CLI · Gemini 4 Argon is third on the coding-agent chart, and every row above it costs at least twice as much per task; Google has limited access to the model to named groups."; the binary SHA-256; the prompt SHA-256 above; and the receipt and job paths the CLI printed.
3. Add the matching entry to `editorial/images.manifest.json` with the same paths, bytes, hashes, the Slopcamera generator block (`@hraness/slopcamera` 3.2.5, source commit `66b4322030f4de24f4d5b6d0c2515c109259f901`), `"validation": "decode-passed"`, and `"review": "accepted"`.
4. Run `bun test app/blog/blog.test.tsx app/blog/gemini-4-argon-coding-agent-index-article.test.ts` and `bun run check`; both must pass before merge.

## Verification

- `bun test lib/gemini-4-argon-placement.test.ts lib/gemini-4-argon-placement.property.test.ts` passes: the frontier below the row is the frontier's lower-scoring vertices, each component contrast names the best other row and the signed gap, the closest rows below are the highest-scoring other costed rows at or under the placed score capped at the count, the cost rank counts the costed rows that cost strictly more, the higher-cost shares cover exactly the costed rows above the placed row highest first, and the other provider rows are every other costed Google row.
- `bun test app/blog/gemini-4-argon-coding-agent-index-article.test.ts` passes once the figure is registered: the rendered note contains every verbatim quotation, every derived score, cost, rank, cost rank, cost share, frontier step, component rank and tie, and Intelligence Index value from the checked snapshots; no em dash, backtick, "refresh," "schema," "checked snapshot," or internal delivery word; a title of at most 64 characters that matches no sibling formula; a dek of at most 200 characters; a description of 110 to 160 characters; and the absent-row, absent-Index-row, lone-row, demoted, later-retrieval, and long-cost fallbacks.
- `bun run check` passes and the pull request merges through the documented delivery path.
- The live page at `https://aicharts.io/blog/gemini-4-argon-coding-agent-index` returns 200, shows the figure, points its Open Graph and Twitter image tags at the figure, appears in `/blog` and `/llms.txt`, and negotiates to Markdown with the figure line.

## Recovery

If the figure cannot be generated, do not stub bytes or hashes and do not loosen the registry type. Leave the pull request open as a draft and this plan `blocked`; the note stays unpublished because the slug is only reachable through the checked build.
