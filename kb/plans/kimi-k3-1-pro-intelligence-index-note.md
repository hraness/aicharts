---
title: Publish the Kimi K3.1 Pro Intelligence Index note
description: Ship /blog/kimi-k3-1-pro-intelligence-index, a note that places Moonshot AI's Kimi K3.1 Pro on the Intelligence Index against cost per task from the checked snapshot, names the three Anthropic rows above it, walks the frontier step above and below it, measures the best row of each other creator against it, splits its $2.11 into five components and ranks each against the cohort, reads the closed weights flag beside the vendor's open-weights promise, keeps the vendor's Terminal-Bench figures off the chart, and completes its Slopcamera figure through the documented generation path.
type: plan
area: blog
status: done
repository_scopes:
  - app/blog
  - lib/kimi-k3-1-pro-placement.ts
  - editorial
tags:
  - editorial
  - intelligence-index
---

# Publish the Kimi K3.1 Pro Intelligence Index note

## Outcome

`/blog/kimi-k3-1-pro-intelligence-index` is live at `https://aicharts.io` with one registered Slopcamera figure. The note states where Kimi K3.1 Pro lands on the Intelligence Index against cost per task, names the three rows above it and the creator they share, prices each against it, walks the cost frontier one vertex up and one vertex down, counts the cheaper and costlier rows and the rows within one point, tabulates the highest-scoring row of each of the six other creators nearest the top, splits the $2.11 into cache reads, cache writes, non-cached input, reasoning, and answer tokens and ranks each against the 114-row cohort, tabulates the input and output sides of the rows above it, reads the snapshot's closed weights flag beside Moonshot AI's promise of weights by November 4, 2026 and OpenRouter's open-weight description, prices the one other Kimi row against it, quotes Moonshot AI's Terminal-Bench 4.0 figures as vendor numbers, and says that the coding-agent chart stores no Kimi K3.1 Pro row.

## Context

The task asked for a short chart-backed Kimi K3.1 Pro note with every number verified against repository data and the headline left to the data. The evidence is the two checked snapshots: `data/artificial-analysis-intelligence-v4-3.json` retrieved 2026-10-27T06:55:01.119Z (version 4.3.2, 119 records, 114 comparable costed rows) stores one Kimi K3.1 Pro row (slug `kimi-k3-1-pro`, creator `kimi`, no effort label, released 2026-10-23, `weights.open` false) at 55.09 for $2.115 per task; `data/coding-agents.json` retrieved 2026-10-27T07:14:48.057Z stores no Kimi K3.1 Pro row and one Moonshot AI row, Kimi Code CLI · Kimi K3 (default) at 41.4 for $5.17. Moonshot AI's release post and API guide, OpenRouter's listing, and Artificial Analysis's model page, all captured 2026-10-27, supply the quoted claims; Moonshot AI's vendor-run Terminal-Bench 4.0 figures are quoted once as vendor numbers and are not charted.

Snapshot observations the note derives at render time: the row ranks fourth of 114 and sits on the cost frontier; the three rows above it are all Anthropic's, Claude Opus 5.5 (Max) at 57.6 for $5.98 (2.8x), Claude Sonnet 5.5 (Max) at 56.0 for $5.46 (2.6x), and Claude Opus 5.5 (Xhigh) at 56.0 for $3.46 (1.6x), which makes Kimi K3.1 Pro the highest-scoring row from any other creator; the frontier vertex above it is Claude Opus 5.5 (Xhigh) and the vertex below is Claude Opus 5.5 (High) at 53.6 for $1.82, 1.5 points down at 0.9x; 95 rows cost less and 18 cost more; two rows sit within one point. Of the $2.11, input-side cost is $1.56 (74%): cache reads $1.06 (13th of 114), cache writes $0.462, non-cached input $0.044; output is $0.552: reasoning $0.349, answer $0.203, from 55,195 output tokens per task, 63% of them reasoning. The input side ranks 18th and the output side 17th. The other creators' best rows are GPT-6 Astra (Max) 52.7 for $3.26, Gemini 4 Argon (High) 52.6 for $1.62, Muse Wonder (Max) 52.4 for $3.27, Grok 4.7 (Xhigh) 46.4 for $3.24, and MiMo-V2.6-Pro 46.3 for $0.133. The cohort holds 49 open and 65 closed rows and no unclassified row; the highest open row is MiMo-V2.6-Pro, 8.8 points below. The one other Kimi row is Kimi K2.7 Code at 25.8 for $0.541, flagged open.

## Admission

Scores 0–2, total 11, no zero: reader utility 2, original evidence 2, factual confidence 2, host fit 2, voice integrity 2, maintenance value 1, scored against the rendered copy and recorded in `app/blog/kimi-k3-1-pro-intelligence-index-admission.ts`. Reader task: where Kimi K3.1 Pro lands on the Intelligence Index against cost, who outranks it and at what price, whether it is on the frontier and what the steps either side cost, how it compares with the best row of every other creator, where the $2.11 goes at $2.00 and $10.00 per million tokens, what the chart's weights flag says beside the vendor's open-weights promise, and why no coding-agent score exists. Closest live notes and distinctions are recorded in the admission: the Muse Wonder Index note (an off-frontier Meta row with an input-share headline and a Meta-only frontier; this note places an on-frontier row, adds the other-creator table and the weights reading, and has no family ladder), the Opus 5.5 Index note (the effort ladder of the row that leads the chart; this note cites those rows only as the rows above), and the MiMo note (the cheap end of the frontier; this note names MiMo only as the highest open row and the cheapest other-creator best). The row-specific claims are new; the independent review measured the shared series templates (index definition, cost-split run, model-page paragraph, coding-chart definition, limits) at roughly a third of the draft’s sentences, so those passages were shortened and reworded before admission, and every heading derives its own numbers.

Provenance: drafted by a Cursor cloud agent (Claude Fable 5.1) on 2026-10-27 from the checked snapshots and the fetched primary pages. The recorded reviewer is AI (`reviewedBy: "Claude Fable 5.1"`, `reviewerType: "ai"`, reviewed 2026-10-27, reassess 2026-12-01), an independent review run in a separate agent session from the drafting run; it recomputed every figure from the snapshots, checked every quotation against the captures, and returned twelve should-fix and six nit findings (a forecast sentence about a future flag, a misstated competitor-score footnote, an ambiguous title, a four-part fragment description, a Limits bullet that contradicted the flag bullet, an off-by-one frontier count in the admission, and series-template repetition), all applied before the pull request left its first revision. No human review is claimed; `humanReviewedOn` is `null`. The page shows the provenance sentence from the admission record and the Hraness byline.

## Scope

### In scope

- `lib/kimi-k3-1-pro-placement.ts`: the Kimi K3.1 Pro Index binding on top of `releaseIntelligencePlacement`, with the rows above and the creators they belong to, the cheaper and costlier counts, the closest rows below, the per-component and per-side cost ranks against the cohort, the frontier step above and below, the best row of each other creator, and the weights summary, with example and property tests.
- `app/blog/kimi-k3-1-pro-intelligence-index-article.ts` with a `createKimiK31ProArticle(intelligenceSnapshot, codingSnapshot)` factory, four new `BLOG_SOURCES`, the admission record, the public slug, and tests.
- One registered Slopcamera figure: registry row, manifest entry, and `public/images/blog/kimi-k3-1-pro-intelligence-index.webp`.

### Non-goals

- Charting or restating Moonshot AI's vendor-run Terminal-Bench 4.0 figures beyond quoting the one sentence and its harness and effort footnotes as vendor numbers.
- Reflagging the row as open-weights before Artificial Analysis does, or crediting the November 4, 2026 promise as kept.
- Placing Kimi K3.1 Pro Highspeed, Kimi K3, or a Kimi K3.1 Pro coding-agent row on any chart; neither snapshot stores such a row and the note invents no score. If a coding-agent row appears, the note lists it and stops denying it.
- Refreshing either snapshot or changing unrelated product code.
- Changing the editorial-image type contract so a live note can ship without a figure.

## Constraints and decisions

- The title lets the data decide: "Only Anthropic rows outrank Kimi K3.1 Pro’s 55.1 at $2.11 a task" when exactly one creator holds every row above it; "Kimi K3.1 Pro tops the Intelligence Index at 55.1 for $2.11" at rank one; "Kimi K3.1 Pro ranks fourth of 114 at 55.1 for $2.11 a task" otherwise; a cost-free rank title when the derived title would exceed 64 characters; and a placement-free title when the row is absent.
- The rank, creator, and cost headings derive their words ("Fourth of 114, behind three Anthropic rows", "The highest row from outside Anthropic", "Inside the $2.11 per task").
- Every snapshot-derived sentence has an explicit fallback for an absent row, rank one, mixed creators above, an off-frontier row, an open or unclassified flag, no other Kimi row, no Moonshot AI coding row, a coding-agent row appearing, a later retrieval date, and a long-cost title. Each table renders only with at least two rows.
- Artificial Analysis's "#4 / 221" and its speed, cost, and verbosity ranks are reported as ranks within the page's own comparison group and set beside the chart's fourth of 114 without letting either correct the other.
- The weights flag stays the snapshot's: the note quotes the promise and the OpenRouter description and says what would follow if the flag changed, without counting the row as open.
- No sentence or heading starts with a numeral, counts under ten are spelled, cost comparisons say "N× the cost" and never "less than", and the delivery vocabulary stays out of the public copy.
- The Slopcamera figure follows `editorial/IMAGES.md`: reviewed source build, credentials only in the child process, one paid call per prompt, no automatic retry, dark monochrome with one brass accent, no scores or numbers in the image, and a silhouette distinct from the Haiku rods on a plinth, the Opus staircase of spheres, the Muse Wonder column in a basin, the Sol sphere over two pools, and the Grok stone on two plinths.

## Plan

1. Verify the snapshot rows, fetch Artificial Analysis's model page, Moonshot AI's release post and API guide, and OpenRouter's listing, and record the quoted claims. Done 2026-10-27.
2. Write the placement binding, the article factory, registration, admission, and tests, have an independent AI session review the rendered copy, and apply its findings. Done 2026-10-27.
3. Generate, review, and register the Slopcamera figure. Blocked 2026-10-27: the cloud agent environment has no Vercel login (`vercel whoami` reports "Logged out."), no linked aicharts project, no `SLOPCAMERA_SOURCE_ROOT` build, and no provider credential, so the paid call cannot run there. The handoff below is complete for an owner box.
4. Let CI pass, merge the task-owned pull request, and verify the live URL, figure, Open Graph image, Markdown twin, sitemap, and `llms.txt` entry. Waits on step 3.

## Figure handoff

### Prompt

Write this text, with one trailing newline, to `artifacts/slopcamera/prompts/kimi-k3-1-pro-intelligence-index.txt`. Its SHA-256 is `25197b4cfa4d4361a7c9d1d94150610e2d5a5473f9c65ffcec22216c3a33e48d`; record that value as `promptSha256`.

```text
Editorial illustration in a wide 16:9 frame on a near-charcoal ground (#12100f). Monochrome with one accent: matte warm-ivory (#f5f2ed) forms, raised charcoal (#1d1a18) surfaces, and a single warm brass (#d0a77c) line as the only accent. A long, low charcoal plinth runs across the lower half of the frame. Standing on it are four matte ivory blocks with softly rounded edges, their heights stepping down from left to right. The three taller blocks stand close together as a group on the left half of the plinth; the fourth block, only a little shorter than the third, stands apart on the right half with a clear gap of open plinth between it and the group. One thin brass line runs along the front edge of the plinth only beneath the fourth block, starting at the gap and ending at the block's far side, and nothing else is brass. Soft key light from the upper left, matte materials, quiet studio shadows, shallow depth, generous negative space above the blocks. No text, no numbers, no axes, no charts, no logos, no screens, no people, no robots, no brains, no brand marks. Keep the plinth and all four blocks inside the middle 60 percent of the frame width so the subject stays legible when the image is cropped to its center.
```

The three grouped blocks are the Anthropic rows above Kimi K3.1 Pro; the fourth block, apart and only a little lower, is the Kimi K3.1 Pro row; the brass line beneath it alone marks the row the note is about. The image carries no number.

### Generation

Run from the repository root on a box with the linked aicharts Vercel project, `SLOPCAMERA_SOURCE_ROOT` bound to the reviewed build (commit `66b4322030f4de24f4d5b6d0c2515c109259f901`, version 3.2.5), and `artifacts/slopcamera/provider-options.json` holding the reviewed provider options from `editorial/IMAGES.md` (unset an ambient expired `VERCEL_OIDC_TOKEN` first so the CLI mints a fresh one):

```sh
env -u VERCEL_OIDC_TOKEN vercel env run -- bun "$SLOPCAMERA_SOURCE_ROOT/apps/desktop/dist/cli/main.js" ai image generate \
  --model openai/gpt-image-2 --prompt-file artifacts/slopcamera/prompts/kimi-k3-1-pro-intelligence-index.txt \
  --count 1 --max-per-call 1 --size 1536x864 \
  --provider-options artifacts/slopcamera/provider-options.json --timeout 300s --json
```

Review the original at 1536×864 and in a 384×216 contact sheet beside the live figures. Reject accidental text, distorted forms, fake data, a repeated composition, or a subject that disappears in the center crop. Do not retry an ambiguous paid result automatically.

### Registration

1. Copy the accepted WebP to `public/images/blog/kimi-k3-1-pro-intelligence-index.webp` and record `sha256sum` and byte size.
2. Add a row to `BLOG_EDITORIAL_IMAGES` in `app/blog/editorial-images.ts` using the `image(...)` helper, placed after the `muse-wonder-intelligence-index` row: slug `kimi-k3-1-pro-intelligence-index`; alt text describing the visible composition (draft: "Four matte ivory blocks step down on a charcoal plinth, three grouped left and one apart on the right above a thin brass line."); caption "Kimi K3.1 Pro sits fourth on the Intelligence Index behind three Anthropic rows, the highest-scoring configuration from any other creator."; the binary SHA-256; the prompt SHA-256 above; and the receipt and job paths the CLI printed.
3. Add the matching entry to `editorial/images.manifest.json` with the same paths, bytes, hashes, the Slopcamera generator block with the reviewed commit and version, `"validation": "decode-passed"`, and `"review": "accepted"`.
4. Run `bun test app/blog/blog.test.tsx app/blog/kimi-k3-1-pro-intelligence-index-article.test.ts` and `bun run check:changed`; both must pass before the pull request leaves draft.

## Verification

- `bun test lib/kimi-k3-1-pro-placement.test.ts` passes (53 tests on 2026-10-27): the rows above are every comparable row with a strictly higher score, highest first, with signed gaps and cost multiples; the creators above are their distinct creator slugs; the other-creator bests are the highest row of each other creator, highest first, capped at the count and rejecting a non-positive count; the frontier steps follow the Pareto path and are empty off the frontier; the cheaper and costlier counts match direct filters and sum with the row to the cohort; each component rank counts the rows whose component is at least as large; the weights summary counts open, closed, and unflagged rows and names the highest open row; and the checked snapshot agrees with the fixture laws.
- `bun test app/blog/kimi-k3-1-pro-intelligence-index-article.test.ts` passes except the image assertion until the figure is registered (on 2026-10-27 every other assertion passed): the rendered note contains every derived score, cost, rank, row-above, frontier-step, neighbor, other-creator, component, component-rank, side-split, weights, Kimi-family, and coding-absence value from the checked snapshots and every quoted claim constant; no vendor benchmark figure on a chart, no "less than", no em dash, backtick, or internal delivery word; no line or sentence starting with a numeral; a title under 64 characters, a dek under 200, and an SEO description between 110 and 160; and the absent-row, rank-one, mixed-creator, off-frontier, open-flag, no-flag, coding-row-present, no-Moonshot-coding-row, later-retrieval, and long-cost fallbacks.
- `bun test app/blog/blog.test.tsx` passes once the figure is registered; on 2026-10-27 only the two registry equality assertions failed, both on the missing Kimi K3.1 Pro figure row, and `tsc` reports only the missing `kimi-k3-1-pro-intelligence-index` key in `BLOG_EDITORIAL_IMAGES`.
- `bun run check:changed` passes and the pull request merges through the documented delivery path.
- The live page at `https://aicharts.io/blog/kimi-k3-1-pro-intelligence-index` shows the figure, the canonical metadata, JSON-LD image, Atom enclosure, and sitemap entry, negotiates to Markdown with the figure line, and appears in `llms.txt`.

## Recovery

If the figure cannot be generated, do not stub bytes or hashes and do not loosen the registry type. Leave the pull request open as a draft and this plan `blocked`; the note stays unpublished because the typecheck and the image tests fail closed on the missing row, so no image-free live note can ship.
