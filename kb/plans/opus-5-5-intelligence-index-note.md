---
title: Publish the Claude Opus 5.5 Intelligence Index note
description: Ship /blog/opus-5-5-intelligence-index, a note that places Claude Opus 5.5 (max) as the leading configuration on the Intelligence Index from the checked snapshot, tabulates its effort ladder and cost components, and separates it from the Claude Code · Opus 5 coding-agent row, and complete its Slopcamera figure through the documented generation path.
type: plan
area: blog
status: in-progress
repository_scopes:
  - app/blog
  - lib/snapshot-placement.ts
  - lib/claude-opus-5-5-placement.ts
  - editorial
tags:
  - editorial
  - intelligence-index
  - coding-agents
---

# Publish the Claude Opus 5.5 Intelligence Index note

## Outcome

`/blog/opus-5-5-intelligence-index` is live at `https://aicharts.io` with one registered Slopcamera figure. The note states where Claude Opus 5.5 (Adaptive Reasoning, Max Effort, Default Fallback) lands on the Intelligence Index, lists the five highest-scoring configurations after it, walks the cost frontier down from the top and names the first point from another model, tabulates the five effort levels with what each step buys and the reasoning share of output tokens, splits the cost per task into cache reads, cache writes, non-cached input, reasoning, and answer tokens across the levels, quotes Anthropic’s prices and claims, and separates the Index row from the Claude Code · Opus 5 (max) coding-agent row.

## Context

The weekday monitor asked for a chart-backed Opus 5.5 note with the Index as the subject and the coding-agent chart used only to keep Opus 5 and Opus 5.5 apart. The evidence is the two checked snapshots: `data/artificial-analysis-intelligence-v4-3.json` retrieved 2026-09-23T13:38:04.121Z (101 measured records, 97 comparable) stores the max row at 57.62 for $5.98 per task (id `2f3c4dc9-a450-4303-8697-0237257cf08f`, release date 2026-09-22) and the xhigh, high, medium, and low rows at 55.99/$3.46, 53.58/$1.82, 51.24/$1.34, and 42.31/$0.55 (release date 2026-09-17); `data/coding-agents.json` retrieved 2026-09-23T03:44:34.316Z stores Claude Code · Opus 5 (max) at AA Index 59.73 for $10.79 per task, fourth of 19, and no Opus 5.5 row in any harness. The Intelligence Index snapshot stores no Claude Opus 5 row. Artificial Analysis’s model page captured 2026-09-25 and Anthropic’s announcement of 2026-09-22 supply the quoted claims; Anthropic’s vendor-run table is described once and not charted.

Snapshot observations the note derives at render time: the top four cost-frontier points are Opus 5.5 at max, xhigh, high, and medium, and the first frontier point from another model is GPT-6 Sol (max) at 47.53 for $1.06; no configuration scores within one index point of the max row; the last effort step from xhigh to max buys 1.64 points at 1.73x the cost; input-side cost stays between 60% and 63% of the total across the five levels while the reasoning share of output tokens rises from 33% to 70%.

## Admission

Scores 0–2, total 12, no zero: reader utility 2, original evidence 2, factual confidence 2, host fit 2, voice integrity 2, maintenance value 2, as scored by the weekday monitor and recorded in `app/blog/article-admissions.ts`. Reader task: what Claude Opus 5.5’s leading Intelligence Index configuration measures (score, cost, effort ladder, neighbors) and how that placement differs from the separate Claude Code · Opus 5 row. Closest live notes and distinctions are recorded in the admission: the AA Index cost note (coding-agent frontier, not the Index), the GPT-6 Sol note (both charts and Sol’s ladder; Sol appears here only as the first frontier point from another model), the Grok 4.7 note (both charts and a same-harness predecessor; never placed here), and the MiMo note (Index frontier for an open-weights model and investor claims). Fewer than a third of the headings or claims overlap any of them; the effort-ladder table and the two-chart frame are shared structure, and every heading derives its own numbers.

Provenance: drafted by a Cursor cloud agent (Claude) on 2026-09-25 from the checked snapshots and the fetched primary pages. The recorded reviewer is the weekday monitor’s AI admission scoring (`weekday-monitor AI editorial review`, `reviewerType: "ai"`, reviewed 2026-09-25, reassess 2026-10-30). No human review is claimed; `humanReviewedOn` is `null`. The page shows the provenance sentence from the admission record and the Hraness byline.

## Scope

### In scope

- `lib/snapshot-placement.ts`: the effort ladder and `releaseIntelligencePlacement` move here from the Sol bindings so the Sol and Opus notes share them. `lib/gpt-6-sol-placement.ts` keeps its exports and delegates.
- `lib/claude-opus-5-5-placement.ts`: the Opus 5.5 Index binding with the closest rows below, the frontier run from the top, cost and token shares, the Claude Opus 5 Index rows, the Opus 5.5 coding-agent rows, and the Claude Code · Opus 5 coding placement, with example and property tests.
- `app/blog/opus-5-5-intelligence-index-article.ts` with a `createOpus55Article(intelligenceSnapshot, codingSnapshot)` factory, two new `BLOG_SOURCES`, the admission record, and the public slug.
- One registered Slopcamera figure: registry row, manifest entry, and `public/images/blog/opus-5-5-intelligence-index.webp`.

### Non-goals

- Charting or restating Anthropic’s vendor-run Terminal-Bench 4.0, FrontierCode, CursorBench, GDPval-AA, AutomationBench, Humanity’s Last Exam, Terminal-Bench-Science, OSWorld, or Chartography figures.
- Placing Opus 5.5 on the coding-agent chart; the snapshot stores no such row. If one appears, the note lists it and stops denying it.
- Restating the GPT-6 Sol or Grok 4.7 coding-agent notes.
- Changing the editorial-image type contract so a live note can ship without a figure.

## Constraints and decisions

- The title states the finding with its number and cost (“Claude Opus 5.5 leads the Intelligence Index at 57.6 for $5.98”), drops the cost when the derived title would exceed 64 characters, switches to “scores N on the Intelligence Index” when the row is not first, and falls back to a placement-free title when the row is absent.
- The rank, ladder, and cost headings derive their numbers (“First of 97 comparable configurations”, “Five effort levels of one model”, “Where the $5.98 goes”).
- Every snapshot-derived sentence has an explicit fallback for an absent row, a non-leading row with dominators, zero or many one-point neighbors, an empty frontier run, a whole-release frontier, a single effort row, a missing default-effort row, an Opus 5.5 coding-agent row appearing, and a Claude Opus 5 Index row appearing. Each table renders only with at least two rows.
- The Adaptive Reasoning and Default Fallback phrases in the row names are reported as Artificial Analysis’s and not interpreted; Anthropic’s safeguard fallback sentence is quoted beside them with an explicit statement that neither source connects the two.
- The Slopcamera figure follows `editorial/IMAGES.md`: reviewed source build at commit `66b4322030f4de24f4d5b6d0c2515c109259f901`, credentials only in the child process, one paid call per prompt, no automatic retry, dark monochrome with one brass accent, a silhouette distinct from the Sol sphere-over-two-pools and Grok stone-on-two-plinths figures.

## Plan

1. Verify the snapshot rows, fetch Artificial Analysis’s model page and Anthropic’s announcement, and record the quoted claims. Done 2026-09-25.
2. Write the shared placement helpers, the Opus bindings, the article factory, registration, admission, and tests. Done 2026-09-25.
3. Generate, review, and register the Slopcamera figure. See the figure handoff below for state.
4. Let CI pass, enable auto-merge on the task-owned pull request, and verify the live URL, figure, and Open Graph image.

## Figure handoff

Until the figure lands, `bun run typecheck` fails on `app/blog/editorial-images.ts` and `app/blog/blog.test.tsx` fails its image gate; both are the intended fail-closed behavior, and the pull request stays a draft.

### Prompt

Write this text, with one trailing newline, to `artifacts/slopcamera/prompts/opus-5-5-intelligence-index.txt` and record its SHA-256 as `promptSha256`.

```text
Editorial illustration in a wide 16:9 frame on a near-charcoal ground (#12100f). Monochrome with one accent: matte warm-ivory (#f5f2ed) forms, raised charcoal (#1d1a18) surfaces, and a single warm brass (#d0a77c) line as the only accent. A staircase of five low charcoal steps rises from the lower left toward the upper right across the center of the frame, each step a little taller and a little deeper than the one below it. One large, smooth, matte ivory sphere rests on the topmost step; four progressively smaller matte ivory spheres rest one per lower step, so the spheres shrink as the steps descend. One thin brass line runs along the front lip of the topmost step only and stops before the frame edges. Soft key light from the upper left, matte materials, quiet studio shadows, shallow depth, generous negative space. No text, no numbers, no axes, no charts, no logos, no screens, no people, no robots, no brains, no brand marks. Keep the staircase and all five spheres centered so the subject stays legible when the image is cropped to the middle 60 percent of its width.
```

### Generation

Run from the repository root with `SLOPCAMERA_SOURCE_ROOT` bound to the reviewed build and `artifacts/slopcamera/provider-options.json` holding the reviewed provider options from `editorial/IMAGES.md`:

```sh
vercel env run -- bun "$SLOPCAMERA_SOURCE_ROOT/apps/desktop/dist/cli/main.js" ai image generate \
  --model openai/gpt-image-2 --prompt-file artifacts/slopcamera/prompts/opus-5-5-intelligence-index.txt \
  --count 1 --max-per-call 1 --size 1536x864 \
  --provider-options artifacts/slopcamera/provider-options.json --timeout 300s --json
```

Review the original at 1536×864 and in a 384×216 contact sheet beside the 14 live figures. Reject accidental text, distorted forms, fake data, a repeated composition, or a subject that disappears in the center crop. Do not retry an ambiguous paid result automatically.

### Registration

1. Copy the accepted WebP to `public/images/blog/opus-5-5-intelligence-index.webp` and record `sha256sum` and byte size.
2. Add a row to `BLOG_EDITORIAL_IMAGES` in `app/blog/editorial-images.ts` using the `image(...)` helper: slug `opus-5-5-intelligence-index`; alt text describing the visible composition (draft: “Five matte ivory spheres of decreasing size rest one per step on a rising charcoal staircase, with a brass line along the top step.”); caption “Each effort level of Claude Opus 5.5 is its own row on the Intelligence Index, and the top four steps of the cost frontier belong to the same model.”; the binary SHA-256; the prompt SHA-256; and the receipt and job paths the CLI printed.
3. Add the matching entry to `editorial/images.manifest.json` with the same paths, bytes, hashes, the Slopcamera generator block, `"validation": "decode-passed"`, and `"review": "accepted"`.
4. Run `bun test app/blog/blog.test.tsx` and `bun run check`; both must pass before merge.

## Verification

- `bun test lib/claude-opus-5-5-placement.test.ts lib/claude-opus-5-5-placement.property.test.ts lib/gpt-6-sol-placement.test.ts lib/gpt-6-sol-placement.property.test.ts lib/grok-4-7-placement.test.ts lib/grok-4-7-placement.property.test.ts` passes (56 tests on 2026-09-25): the closest rows below are the highest-scoring other rows at or under the placed score capped at the count, the frontier run is the longest same-release prefix of the frontier walked from the top and is non-empty exactly when the top vertex belongs to the release, shares stay in the unit interval and agree with the row’s components, and the Sol and Grok bindings are unchanged.
- `bun test app/blog/blog.test.tsx` passes once the figure is registered: the rendered note contains every derived score, cost, rank, closest-below, frontier-run, effort-ladder, cost-component, and coding-contrast value from the checked snapshots and every quoted claim constant; no vendor table percentage, em dash, backtick, “refresh,” “schema,” or internal delivery word; a title that never matches the “What X’s N measures” formula; a dek of at most 200 characters; and the absent-row, non-leading, max-only, coding-row-present, Opus-5-Index-row-present, later-retrieval, and long-title fallbacks. On 2026-09-25 every assertion except the image gate passed.
- `bun run check` passes on Node 24 and the pull request merges through the documented delivery path.
- The live page at `https://aicharts.io/blog/opus-5-5-intelligence-index` shows the figure, the canonical metadata, JSON-LD image, Atom enclosure, and sitemap entry, and negotiates to Markdown with the figure line.

## Recovery

If the figure cannot be generated, do not stub bytes or hashes and do not loosen the registry type. Leave the pull request open as a draft and this plan `blocked`; the note stays unpublished because the slug is only reachable through the checked build.
