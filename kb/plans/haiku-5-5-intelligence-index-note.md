---
title: Publish the Claude Haiku 5.5 Intelligence Index note
description: Ship /blog/haiku-5-5-intelligence-index, a note that places the five Claude Haiku 5.5 effort rows on the Intelligence Index against cost from the checked snapshot, states what each effort step buys, prices the max row against the Sonnet 5.5 and Opus 5.5 rows, keeps Anthropic's vendor numbers off the chart, and completes its Slopcamera figure through the documented generation path.
type: plan
area: blog
status: done
repository_scopes:
  - app/blog
  - lib/claude-haiku-5-5-placement.ts
  - editorial
tags:
  - editorial
  - intelligence-index
---

# Publish the Claude Haiku 5.5 Intelligence Index note

## Outcome

`/blog/haiku-5-5-intelligence-index` is live at `https://aicharts.io` with one registered Slopcamera figure. The note states where Claude Haiku 5.5 (Max) lands on the Intelligence Index against cost per task, names the one cheaper row that keeps it off the cost frontier, lists the five highest-scoring configurations after it, tabulates the five effort levels with what each step buys in points and cost and the reasoning share of output tokens, splits the max row's cost per task into its five components, measures every Sonnet 5.5 and Opus 5.5 row against the Haiku max row and draws the Anthropic-only frontier, quotes Anthropic's prices and claims as vendor numbers, places the GPT-6 Luna rows the chart does store, and says that the coding-agent chart stores no Haiku row.

## Context

The task asked for a chart-backed Haiku 5.5 note whose reader task is where the five effort rows land against cost and what each effort step buys, not a restatement of Anthropic's launch claims. The evidence is the two checked snapshots: `data/artificial-analysis-intelligence-v4-3.json` retrieved 2026-10-10T05:51:08.244Z (version 4.3.2, 113 records, 108 with a positive cost per task) stores the Haiku rows at max 43.4 for $0.213, xhigh 41.2 for $0.124, high 37.8 for $0.079, medium 34.5 for $0.047, and low 29.5 for $0.024 per task; `data/coding-agents.json` retrieved 2026-10-05T14:10:36.287Z (31 records) stores no Claude Haiku 5.5 row in any harness. Anthropic's announcement of 2026-10-07 and Artificial Analysis's model page captured 2026-10-12 supply the quoted claims; Anthropic's vendor-run table is described once and not charted.

Snapshot observations the note derives at render time: the max row ranks 32nd of 108 comparable configurations, 37 rows cost less, and MiMo-V2.6-Pro at 46.3 for $0.133 is the sole row that beats it on both axes, 2.9 points higher for 0.6x the cost, so the note never calls Haiku the cheapest frontier point (the MiMo note owns that frontier). Within one point sit Step 5 Preview at 43.7 for $1.03 and Kimi K3 (Max) at 43.6 for $2.00, 4.8x and 9.4x the cost. The xhigh row is the only Haiku vertex of the chart's cost frontier, below GPT-6.1 Sol (Low) and above GPT-6 Luna (Max). From low to max the ladder climbs 13.9 points for 8.7x the cost in steps of 1.9x, 1.7x, 1.6x, and 1.7x that buy 5.0, 3.4, 3.4, and 2.1 points while the reasoning share of output tokens rises from 53% to 80%. Cache reads are $0.095 of the $0.213 (45%). The Haiku max row beats Opus 5.5 (Low), Sonnet 5.5 (Medium), and Sonnet 5.5 (Low) on both axes, and below Sonnet 5.5 (High) at $0.884 every vertex of the Anthropic-only frontier is a Haiku row.

## Admission

Scores 0–2, total 11, no zero: reader utility 2, original evidence 2, factual confidence 2, host fit 2, voice integrity 2, maintenance value 1, as scored in the task brief and recorded in `app/blog/haiku-5-5-intelligence-index-admission.ts`. Reader task: where the five Claude Haiku 5.5 effort rows land on the Intelligence Index against cost, what each effort step buys, and how the rows price against the Sonnet 5.5 and Opus 5.5 rows on the same chart. Closest live notes and distinctions are recorded in the admission: the Opus 5.5 Index note (leader, frontier walked from the top), the Sonnet 5.5 coding-agent note (a harness row, never scored here), the MiMo note (the dominant frontier row; this note names MiMo as the one dominator and does not rewalk the frontier), and the small-models note (a daily news page cost, no chart placement). Fewer than a third of the headings or claims overlap any of them; the effort-ladder table and the cost-component split are shared structure, and every heading derives its own numbers.

Provenance: drafted by a Cursor cloud agent (Claude Fable 5.1) on 2026-10-12 from the checked snapshots and the fetched primary pages. The recorded reviewer is AI (`reviewedBy: "Claude Fable 5.1"`, `reviewerType: "ai"`, reviewed 2026-10-12, reassess 2026-11-16). No human review is claimed; `humanReviewedOn` is `null`. The page shows the provenance sentence from the admission record and the Hraness byline.

## Scope

### In scope

- `lib/claude-haiku-5-5-placement.ts`: the Haiku Index binding on top of `releaseIntelligencePlacement`, with the count of cheaper rows, the closest rows below, the Haiku vertices of the frontier with their neighbors, the Anthropic rows and Anthropic-only frontier, the sibling-release rows against a reference, the family rows a Haiku row dominates, and the rows of one release against a reference, with example and property tests.
- `app/blog/haiku-5-5-intelligence-index-article.ts` with a `createHaiku55Article(intelligenceSnapshot, codingSnapshot)` factory, two new `BLOG_SOURCES`, the admission record, the public slug, and tests.
- One registered Slopcamera figure: registry row, manifest entry, and `public/images/blog/haiku-5-5-intelligence-index.webp`.

### Non-goals

- Charting or restating Anthropic's vendor-run GDPval-AA, OSWorld, Humanity's Last Exam, Terminal-Bench 4.0, FrontierCode, or Chartography figures beyond naming them once as vendor numbers.
- Placing Haiku 5.5 on the coding-agent chart; the snapshot stores no such row and the note invents no score. If a row appears, the note lists it and stops denying it.
- Calling Haiku the cheapest frontier point or rewalking the cost frontier the MiMo note owns.
- Refreshing either snapshot or changing unrelated product code.
- Changing the editorial-image type contract so a live note can ship without a figure.

## Constraints and decisions

- The title leads with the chart fact and the frontier state ("Haiku 5.5 scores 43.4 at $0.213, one row off the cost frontier"), drops the frontier phrase when the derived title would exceed 64 characters, and falls back to a placement-free title when the row is absent.
- The rank, cost, and coding headings derive their words ("Ranked 32nd of 108, one row off the cost frontier", "What the $0.213 pays for", "No Haiku row on the coding-agent chart yet").
- Every snapshot-derived sentence has an explicit fallback for an absent row, a single effort row, no Luna rows, no sibling rows, a Haiku-only cohort, a coding-agent row appearing, and a later retrieval date. Each table renders only with at least two rows.
- Artificial Analysis's "#2 / 180" rank is reported as a rank among the page's price class and set beside the chart's 32nd of 108 without letting either correct the other.
- No sentence or heading starts with a numeral, counts under ten are spelled, cost comparisons say "N× the cost" and never "less than", and the delivery vocabulary stays out of the public copy.
- The Slopcamera figure follows `editorial/IMAGES.md`: reviewed source build, credentials only in the child process, one paid call per prompt, no automatic retry, dark monochrome with one brass accent, a silhouette distinct from the Opus staircase of spheres, the Opus coding block on a table, the Sol sphere over two pools, and the Grok stone on two plinths.

## Plan

1. Verify the snapshot rows, fetch Artificial Analysis's model page and Anthropic's announcement, and record the quoted claims. Done 2026-10-12.
2. Write the placement binding, the article factory, registration, admission, and tests. Done 2026-10-12.
3. Generate, review, and register the Slopcamera figure. Done 2026-10-12: one paid call on the box at Slopcamera 66b4322030f4 (job `gateway_b7636b139acf430ca7c8980d7ac30b96`, receipt `20261012T150152962Z-image-84bc717a-676/receipt.json`), decode passed, reviewed and accepted; 1536×864 WebP, 44654 bytes, SHA-256 `6e41e769a4e3c402d08ab51b8b0c9325cb69333434102dd289f92c96bb87a27e`.
4. Let CI pass, enable auto-merge on the task-owned pull request, and verify the live URL, figure, Open Graph image, Markdown twin, sitemap, and `llms.txt` entry. Waits on step 3.

## Figure handoff

### Prompt

Write this text, with one trailing newline, to `artifacts/slopcamera/prompts/haiku-5-5-intelligence-index.txt`. Its SHA-256 is `e0c171fdbb677ac7b2a70d520f3cc1031225fd7fa018f506f03119ca26d002c2`; record that value as `promptSha256`.

```text
Editorial illustration in a wide 16:9 frame on a near-charcoal ground (#12100f). Monochrome with one accent: matte warm-ivory (#f5f2ed) forms, raised charcoal (#1d1a18) surfaces, and a single warm brass (#d0a77c) line as the only accent. A long, low charcoal plinth runs across the lower third of the frame. Standing upright on it in one evenly spaced row are five slim matte ivory rods, each a little taller than the one to its left, the shortest at the left end and the tallest at the right end; all five are the same slender width and have softly rounded tops. One thin brass ring encircles the base of the tallest rod only, flush with the plinth. Soft key light from the upper left, matte materials, quiet studio shadows, shallow depth, generous negative space. No text, no numbers, no axes, no charts, no logos, no screens, no people, no robots, no brains, no brand marks. Keep the plinth and all five rods centered so the subject stays legible when the image is cropped to the middle 60 percent of its width.
```

### Generation

Run from the repository root on a box with the linked aicharts Vercel project, `SLOPCAMERA_SOURCE_ROOT` bound to the reviewed build, and `artifacts/slopcamera/provider-options.json` holding the reviewed provider options from `editorial/IMAGES.md` (unset an ambient expired `VERCEL_OIDC_TOKEN` first so the CLI mints a fresh one):

```sh
env -u VERCEL_OIDC_TOKEN vercel env run -- bun "$SLOPCAMERA_SOURCE_ROOT/apps/desktop/dist/cli/main.js" ai image generate \
  --model openai/gpt-image-2 --prompt-file artifacts/slopcamera/prompts/haiku-5-5-intelligence-index.txt \
  --count 1 --max-per-call 1 --size 1536x864 \
  --provider-options artifacts/slopcamera/provider-options.json --timeout 300s --json
```

Review the original at 1536×864 and in a 384×216 contact sheet beside the live figures. Reject accidental text, distorted forms, fake data, a repeated composition, or a subject that disappears in the center crop. Do not retry an ambiguous paid result automatically.

### Registration

1. Copy the accepted WebP to `public/images/blog/haiku-5-5-intelligence-index.webp` and record `sha256sum` and byte size.
2. Add a row to `BLOG_EDITORIAL_IMAGES` in `app/blog/editorial-images.ts` using the `image(...)` helper, placed after the `opus-5-5-intelligence-index` row: slug `haiku-5-5-intelligence-index`; alt text describing the visible composition (draft: "Five slim matte ivory rods of rising height stand in a row on a low charcoal plinth, with a brass ring around the base of the tallest."); caption "Each effort level of Claude Haiku 5.5 is its own row on the Intelligence Index, and the step from low to max buys 13.9 points for 8.7x the cost per task."; the binary SHA-256; the prompt SHA-256 above; and the receipt and job paths the CLI printed.
3. Add the matching entry to `editorial/images.manifest.json` with the same paths, bytes, hashes, the Slopcamera generator block with the reviewed commit and version, `"validation": "decode-passed"`, and `"review": "accepted"`.
4. Run `bun test app/blog/blog.test.tsx app/blog/haiku-5-5-intelligence-index-article.test.ts` and `bun run check`; both must pass before the pull request leaves draft.

## Verification

- `bun test lib/claude-haiku-5-5-placement.test.ts lib/claude-haiku-5-5-placement.property.test.ts` passes (23 tests on 2026-10-12): the closest rows below are the highest-scoring other rows at or under the placed score capped at the count, the cheaper count matches a direct filter, the Haiku frontier vertices are exactly the Haiku members of the Pareto path with their path neighbors, the Anthropic-only frontier equals Pareto membership over Anthropic rows, sibling rows carry the signed point gap and cost multiple against the reference, dominated family rows are beaten by a Haiku row on both axes with the highest-scoring dominator named, and the checked snapshot agrees with the fixture laws.
- `bun test app/blog/haiku-5-5-intelligence-index-article.test.ts` passes except the image assertion until the figure is registered (on 2026-10-12 every other assertion passed): the rendered note contains every derived score, cost, rank, dominator, neighbor, closest-below, frontier-vertex, effort-ladder, cost-component, family-table, Anthropic-frontier, Luna, and coding-absence value from the checked snapshots and every quoted claim constant; no vendor table percentage on a chart, no "cheapest frontier", no "less than", no em dash, backtick, or internal delivery word; no line or sentence starting with a numeral; a title under 64 characters, a dek under 200, and an SEO description between 110 and 160; and the absent-row, max-only, no-Luna, no-sibling, Haiku-only, coding-row-present, later-retrieval, and long-title fallbacks.
- `bun test app/blog/blog.test.tsx` passes once the figure is registered; on 2026-10-12 only the two registry equality assertions failed, both on the missing Haiku figure row.
- `bun run check` passes and the pull request merges through the documented delivery path.
- The live page at `https://aicharts.io/blog/haiku-5-5-intelligence-index` shows the figure, the canonical metadata, JSON-LD image, Atom enclosure, and sitemap entry, negotiates to Markdown with the figure line, and appears in `llms.txt`.

## Recovery

If the figure cannot be generated, do not stub bytes or hashes and do not loosen the registry type. Leave the pull request open as a draft and this plan `blocked`; the note stays unpublished because the typecheck and the image tests fail closed on the missing row, so no image-free live note can ship.
