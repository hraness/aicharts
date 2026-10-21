---
title: Publish the Muse Wonder Intelligence Index note
description: Ship /blog/muse-wonder-intelligence-index, a note that places Meta's Muse Wonder (Max) on the Intelligence Index against cost per task from the checked snapshot, names the four rows that keep it off the cost frontier, splits its $4.52 into five components and ranks each against the whole cohort, prices every other Meta row against it, keeps Meta's vendor table off the chart, and completes its Slopcamera figure through the documented generation path.
type: plan
area: blog
status: blocked
repository_scopes:
  - app/blog
  - lib/muse-wonder-placement.ts
  - editorial
tags:
  - editorial
  - intelligence-index
---

# Publish the Muse Wonder Intelligence Index note

## Outcome

`/blog/muse-wonder-intelligence-index` is live at `https://aicharts.io` with one registered Slopcamera figure. The note states where Muse Wonder (Max) lands on the Intelligence Index against cost per task, names the four rows that score at least as high for less, counts the cheaper and costlier rows, names the one row that prints the same score at one decimal and the five highest-scoring configurations after it, splits the $4.52 into cache writes, cache reads, non-cached input, reasoning, and answer tokens and ranks each against the 116-row cohort, compares its input share with every higher-ranked row, tabulates the dominating rows' input and output sides against it, prices every other Meta row against it with a Meta-only frontier, quotes Meta's prices and claims as vendor numbers, checks Meta's own Artificial Analysis Index row against the chart, and says that Muse Wonder Full is on no chart and that the coding-agent chart stores no Muse Wonder row.

## Context

The task asked for a chart-backed Muse Wonder note that prefers the checked snapshot over Meta's launch claims, with every number verified against repository data. The evidence is the two checked snapshots: `data/artificial-analysis-intelligence-v4-3.json` retrieved 2026-10-19T04:38:55.223Z (version 4.3.2, 116 comparable costed rows) stores one Muse Wonder row, Muse Wonder (Max) at 52.39 for $4.5157 per task; `data/coding-agents.json` retrieved 2026-10-05T14:10:36.287Z stores no Muse Wonder row and two Meta rows, Muse Code · Muse Spark 1.3 (max) at 54.3 for $3.98 and (xhigh) at 48.3 for $3.47. Meta's launch post of 2026-10-12 and model page, and Artificial Analysis's model page captured 2026-10-21, supply the quoted claims; Meta's vendor-run table is quoted only for its Artificial Analysis Index row (56, 52, 53, 53, 58), the one row whose label is unambiguous in the page markup, and is not charted.

Snapshot observations the note derives at render time: the row ranks ninth of 116, 110 rows cost less and five cost more, and four rows beat it on both axes, cheapest first Claude Opus 5.5 (High) at 53.6 for $1.82, Gemini 4 Argon (High) at 52.6 for $1.99, GPT-6 Astra (Max) at 52.7 for $3.26, and Claude Opus 5.5 (Xhigh) at 56.0 for $3.46. Seven rows score within one point. GPT-6 Astra (Xhigh) prints the same 52.4 at 0.5x the cost but scores 0.01 points lower at stored precision, so it is not a dominator and the note never calls it a tie. Of the $4.52, input-side cost is $3.43 (76%): cache writes $1.92 (first of 116), cache reads $1.44 (seventh), non-cached input $0.07 (18th); output is $1.08: reasoning $0.57 (ninth), answer $0.51 (eighth). The input side ranks fifth and the output side ninth; the highest input share among the eight rows above it is 69%. Among the seven Meta rows, Muse Spark 1.3 (Max) at 48.1 for $1.60 is 4.3 points lower for 0.4x the cost, so the last step up inside Meta's range costs 2.8x. The three vendor-column rows, Claude Fable 5.1 (Max) 53.4, GPT-6 Astra (Max) 52.7, and Claude Opus 5.5 (Max) 57.6, each round to the figure in Meta's Artificial Analysis Index row.

## Admission

Scores 0–2, total 11, no zero: reader utility 2, original evidence 2, factual confidence 2, host fit 2, voice integrity 2, maintenance value 1, as scored in the task brief, re-run against the rendered copy, and recorded in `app/blog/muse-wonder-intelligence-index-admission.ts`. Reader task: where Muse Wonder lands on the Intelligence Index against cost, which rows keep it off the frontier, why a $4 and $20 per million token model costs $4.52 a task and which component drives that, how it prices against the other Meta rows, which Meta numbers are vendor numbers, and why neither Muse Wonder Full nor a Muse Wonder coding-agent score appears on any chart. Closest live notes and distinctions are recorded in the admission: the Opus 5.5 and Haiku 5.5 Index notes (each tabulates an effort ladder and places a different row; this note has a single row and adds component ranks, the input-share comparison, the dominating rows' side split, and the Meta-only frontier) and the MiMo note (a frontier vertex this note does not name). Fewer than a third of the headings or claims overlap any of them; the rank, nearest-score, and cost-component structure is shared, and every heading derives its own numbers.

Provenance: drafted by a Cursor cloud agent (Claude Fable 5.1) on 2026-10-21 from the checked snapshots and the fetched primary pages. The recorded reviewer is AI (`reviewedBy: "Claude Fable 5.1"`, `reviewerType: "ai"`, reviewed 2026-10-21, reassess 2026-11-25). No human review is claimed; `humanReviewedOn` is `null`. The page shows the provenance sentence from the admission record and the Hraness byline.

## Scope

### In scope

- `lib/muse-wonder-placement.ts`: the Muse Wonder Index binding on top of `releaseIntelligencePlacement`, with the cheaper and costlier counts, the same-rounded-score rows, the closest rows below, the per-component and per-side cost ranks against the cohort, the cost-side rows of a set against a reference, the Meta rows and Meta-only frontier, and the vendor-column rows, with example and property tests.
- `app/blog/muse-wonder-intelligence-index-article.ts` with a `createMuseWonderArticle(intelligenceSnapshot, codingSnapshot)` factory, three new `BLOG_SOURCES`, the admission record, the public slug, and tests.
- One registered Slopcamera figure: registry row, manifest entry, and `public/images/blog/muse-wonder-intelligence-index.webp`.

### Non-goals

- Charting or restating Meta's vendor-run per-benchmark figures beyond quoting the one unambiguous Artificial Analysis Index row and naming the table once as vendor numbers.
- Placing Muse Wonder or Muse Wonder Full on any chart; neither snapshot stores such a row and the note invents no score. If a coding-agent row appears, the note lists it and stops denying it.
- Calling GPT-6 Astra (Xhigh) a tie or a dominator, or rewalking the cost frontier the MiMo note owns.
- Refreshing either snapshot or changing unrelated product code.
- Changing the editorial-image type contract so a live note can ship without a figure.

## Constraints and decisions

- The title leads with the chart fact and the input-side finding ("Muse Wonder: 52.4 at $4.52, with $3.43 of it on the input side"), falls back to "Muse Wonder scores 52.4 on the Intelligence Index" when the derived title would exceed 64 characters, and to a placement-free title when the row is absent.
- The rank, cost, and coding headings derive their words ("Ranked ninth of 116, off the cost frontier", "Where the $4.52 goes", "No Muse Wonder row on the coding-agent chart").
- Every snapshot-derived sentence has an explicit fallback for an absent row, no dominating rows, no same-rounded-score row, an exact tie, a Meta-only cohort, missing vendor-column rows, a coding-agent row appearing, and a later retrieval date. Each table renders only with at least two rows.
- Artificial Analysis's "#9 / 214" and its speed, cost, and verbosity ranks are reported as ranks within the page's own comparison group and set beside the chart's ninth of 116 without letting either correct the other.
- The cache-write line is reported as a snapshot component, never as derived from a Meta price, because Meta publishes no cache-write price and Artificial Analysis notes that cache writes vary by provider.
- No sentence or heading starts with a numeral, counts under ten are spelled, cost comparisons say "N× the cost" and never "less than", near-ties under 0.05 points are printed to two decimals, and the delivery vocabulary stays out of the public copy.
- The Slopcamera figure follows `editorial/IMAGES.md`: reviewed source build, credentials only in the child process, one paid call per prompt, no automatic retry, dark monochrome with one brass accent, a silhouette distinct from the Haiku rods on a plinth, the Opus staircase of spheres, the Opus coding block on a table, the Sol sphere over two pools, and the Grok stone on two plinths.

## Plan

1. Verify the snapshot rows, fetch Artificial Analysis's model page and Meta's launch post and model page, and record the quoted claims. Done 2026-10-21.
2. Write the placement binding, the article factory, registration, admission, and tests. Done 2026-10-21.
3. Generate, review, and register the Slopcamera figure. Blocked 2026-10-21: the cloud agent VM has no Vercel CLI authentication, no linked aicharts Vercel workspace, and no reviewed Slopcamera source build, so `vercel env run` cannot inject the gateway credential into the generation child. Reading the credential through the Vercel MCP connection would decrypt a project secret into the agent context, which the task did not authorize. The handoff below is complete for a box that has both.
4. Let CI pass, enable auto-merge on the task-owned pull request, and verify the live URL, figure, Open Graph image, Markdown twin, sitemap, and `llms.txt` entry. Waits on step 3.

## Figure handoff

### Prompt

Write this text, with one trailing newline, to `artifacts/slopcamera/prompts/muse-wonder-intelligence-index.txt`. Its SHA-256 is `b26fd8c38b73675c33dad953d900f00da5462d4c94b5df5e5c27e32b3f78a18f`; record that value as `promptSha256`.

```text
Editorial illustration in a wide 16:9 frame on a near-charcoal ground (#12100f). Monochrome with one accent: matte warm-ivory (#f5f2ed) forms, raised charcoal (#1d1a18) surfaces, and a single warm brass (#d0a77c) line as the only accent. A shallow, wide charcoal basin sits in the lower half of the frame, filled with still, dark liquid. Standing upright in the center of the basin is one tall, slender matte ivory column with a softly rounded top; the liquid reaches about three quarters of the way up the column, so only its upper quarter rises clear of the surface. One thin brass line traces the waterline where the liquid meets the column, flush with the surface, and nothing else is brass. Soft key light from the upper left, matte materials, quiet studio shadows, a faint reflection of the column in the liquid, shallow depth, generous negative space. No text, no numbers, no axes, no charts, no logos, no screens, no people, no robots, no brains, no brand marks. Keep the basin and the column centered so the subject stays legible when the image is cropped to the middle 60 percent of its width.
```

The column is the Muse Wonder cost per task; the liquid that covers three quarters of it is the input-side share of the bill. The image carries no number.

### Generation

Run from the repository root on a box with the linked aicharts Vercel project, `SLOPCAMERA_SOURCE_ROOT` bound to the reviewed build (commit `66b4322030f4de24f4d5b6d0c2515c109259f901`, version 3.2.5), and `artifacts/slopcamera/provider-options.json` holding the reviewed provider options from `editorial/IMAGES.md` (unset an ambient expired `VERCEL_OIDC_TOKEN` first so the CLI mints a fresh one):

```sh
env -u VERCEL_OIDC_TOKEN vercel env run -- bun "$SLOPCAMERA_SOURCE_ROOT/apps/desktop/dist/cli/main.js" ai image generate \
  --model openai/gpt-image-2 --prompt-file artifacts/slopcamera/prompts/muse-wonder-intelligence-index.txt \
  --count 1 --max-per-call 1 --size 1536x864 \
  --provider-options artifacts/slopcamera/provider-options.json --timeout 300s --json
```

Review the original at 1536×864 and in a 384×216 contact sheet beside the live figures. Reject accidental text, distorted forms, fake data, a repeated composition, or a subject that disappears in the center crop. Do not retry an ambiguous paid result automatically.

### Registration

1. Copy the accepted WebP to `public/images/blog/muse-wonder-intelligence-index.webp` and record `sha256sum` and byte size.
2. Add a row to `BLOG_EDITORIAL_IMAGES` in `app/blog/editorial-images.ts` using the `image(...)` helper, placed after the `haiku-5-5-intelligence-index` row: slug `muse-wonder-intelligence-index`; alt text describing the visible composition (draft: "A tall matte ivory column stands in a shallow charcoal basin of dark liquid that reaches most of the way up it, with a thin brass line at the surface."); caption "Three quarters of what a Muse Wonder (Max) task costs on the Intelligence Index is input-side cost, and its cache-write line is the largest of any row on the chart."; the binary SHA-256; the prompt SHA-256 above; and the receipt and job paths the CLI printed.
3. Add the matching entry to `editorial/images.manifest.json` with the same paths, bytes, hashes, the Slopcamera generator block with the reviewed commit and version, `"validation": "decode-passed"`, and `"review": "accepted"`.
4. Run `bun test app/blog/blog.test.tsx app/blog/muse-wonder-intelligence-index-article.test.ts` and `bun run check`; both must pass before the pull request leaves draft.

## Verification

- `bun test lib/muse-wonder-placement.test.ts lib/muse-wonder-placement.property.test.ts` passes (53 tests on 2026-10-21): the same-rounded-score rows print the placed score at the given precision and exclude exact ties, the closest rows below are the highest-scoring other rows at or under the placed score capped at the count, the cheaper and costlier counts match direct filters and sum with the row to the cohort, each component rank counts the rows whose component is at least as large, cost-side rows carry the signed point gap and cost multiple against the reference, the creator-only frontier equals Pareto membership over that creator's rows, vendor-column rows resolve by release and effort, and the checked snapshot agrees with the fixture laws.
- `bun test app/blog/muse-wonder-intelligence-index-article.test.ts` passes except the image assertion until the figure is registered (on 2026-10-21 every other assertion passed): the rendered note contains every derived score, cost, rank, dominator, neighbor, same-score, closest-below, component, component-rank, input-share, side-split, family-table, Meta-frontier, vendor-column, and coding-absence value from the checked snapshots and every quoted claim constant; no vendor per-benchmark figure on a chart, no "tie", no "less than", no em dash, backtick, or internal delivery word; no line or sentence starting with a numeral; a title under 64 characters, a dek under 200, and an SEO description between 110 and 160; and the absent-row, no-dominator, no-family, Meta-only, no-same-score, exact-tie, coding-row-present, later-retrieval, long-title, and rescored fallbacks.
- `bun test app/blog/blog.test.tsx` passes once the figure is registered; on 2026-10-21 only the two registry equality assertions failed, both on the missing Muse Wonder figure row.
- `bun run check` passes and the pull request merges through the documented delivery path.
- The live page at `https://aicharts.io/blog/muse-wonder-intelligence-index` shows the figure, the canonical metadata, JSON-LD image, Atom enclosure, and sitemap entry, negotiates to Markdown with the figure line, and appears in `llms.txt`.

## Recovery

If the figure cannot be generated, do not stub bytes or hashes and do not loosen the registry type. Leave the pull request open as a draft and this plan `blocked`; the note stays unpublished because the typecheck and the image tests fail closed on the missing row, so no image-free live note can ship.
