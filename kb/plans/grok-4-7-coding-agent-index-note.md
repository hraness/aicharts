---
title: Publish the Grok 4.7 coding-agent placement note
description: Ship /blog/grok-4-7-coding-agent-index, a note that places Grok Build · Grok 4.7 on the coding-agent chart and Grok 4.7 (xhigh) on the Intelligence Index from the checked snapshots, and complete its Slopcamera figure through the documented generation path.
type: plan
area: blog
status: in-progress
repository_scopes:
  - app/blog
  - lib/grok-4-7-placement.ts
  - editorial
tags:
  - editorial
  - coding-agents
  - intelligence-index
---

# Publish the Grok 4.7 coding-agent placement note

## Outcome

`/blog/grok-4-7-coding-agent-index` is live at `https://aicharts.io` with one registered Slopcamera figure. The note states where Grok Build · Grok 4.7 (xhigh) lands on the coding-agent chart and where Grok 4.7 (xhigh) lands on the Intelligence Index, splits the AA Index into its three components, compares the row with Grok Build · Grok 4.6 (xhigh) in the same harness, separates the two per-task costs, and keeps xAI’s vendor-run table out of the evidence.

## Context

Ben asked for a chart-backed Grok 4.7 note once Artificial Analysis had measured rows on both the Intelligence Index and the coding-agents chart. The evidence is the two checked snapshots: `data/coding-agents.json` retrieved 2026-09-23T03:44:34.316Z stores Grok Build · Grok 4.7 (xhigh) at AA Index 56.27 for $8.82 per task, and `data/artificial-analysis-intelligence-v4-3.json` retrieved 2026-09-23T13:38:04.121Z stores Grok 4.7 (xhigh) at 46.45 for $3.74 per task. Artificial Analysis’s launch note and model page own the quoted launch-day claims; xAI’s launch page is linked once as context and its CursorBench figures are not restated.

## Admission

Scores 0–2, total 12, no zero: reader utility 2, original evidence 2, factual confidence 2, host fit 2, voice integrity 2, maintenance value 2. Reader task: where Grok 4.7 lands on the two AI Charts charts, what each score and cost measures, and where independent evidence stops. Closest live notes and distinctions are recorded in `app/blog/article-admissions.ts`: the MiMo cost-frontier note (same Intelligence Index neighborhood, but a cost-frontier and vendor-claim story about an open-weights model), the AA Index cost note (whole frontier, not one new row), the open-models note (era claim and weight access), and the small-models note (product adoption rule). Fewer than a third of the headings or claims overlap any of them.

## Scope

### In scope

- `app/blog/grok-4-7-coding-agent-index-article.ts` with a `createGrok47Article(codingSnapshot, intelligenceSnapshot)` factory, three new `BLOG_SOURCES`, the admission record, and the public slug.
- `lib/grok-4-7-placement.ts` for coding-agent rank, dominators, component ranks, the terminal split, the same-harness predecessor, and Intelligence Index rank, dominators, cheapest-higher, and one-point neighbors, with example and property tests.
- One registered Slopcamera figure: registry row, manifest entry, and `public/images/blog/grok-4-7-coding-agent-index.webp`.

### Non-goals

- Charting or restating xAI’s vendor-run CursorBench, EEBench, Harvey, or HealthBench figures.
- Ranking Grok 4.7 in Cursor or any harness other than Grok Build; the snapshot stores one configuration.
- Changing the editorial-image type contract so a live note can ship without a figure.

## Constraints and decisions

- The title, dek, and description derive their rounded scores from the snapshots, so a rescored row changes the copy instead of leaving a stale number. A missing coding-agent row falls back to a placement-free title.
- Every snapshot-derived sentence has an explicit fallback for an absent row, an empty dominator list, a single dominator, an absent predecessor, an absent high-effort sibling, and fewer than two neighbors, and each table renders only with at least two rows.
- The launch-note rank claim is quoted as Artificial Analysis’s and set beside the rows the bounded update log shows entering the snapshot after that note.
- The Slopcamera figure follows `editorial/IMAGES.md`: reviewed source build at commit `66b4322030f4de24f4d5b6d0c2515c109259f901`, credentials only in the child process, one paid call per prompt, no automatic retry, dark monochrome with one brass accent.

## Plan

1. Verify the two snapshot rows, fetch the Artificial Analysis launch note and model page and xAI’s launch page, and record the quoted claims. Done 2026-09-23.
2. Write the placement helpers, the article factory, registration, admission, and tests. Done 2026-09-23.
3. Generate, review, and register the Slopcamera figure. Blocked on 2026-09-23: the cloud agent VM has no Vercel workspace credentials, no `AI_GATEWAY_API_KEY`, and the connected Vercel MCP identity may neither mint a project OIDC token nor create a scoped AI Gateway key (both requests returned 403), so no paid generation call could be made.
4. Let CI pass, merge through the task-owned pull request, and verify the live URL, figure, and Open Graph image.

## Figure handoff

The Slopcamera source build at the reviewed commit was cloned and built on the agent VM (`bun install --frozen-lockfile --ignore-scripts`, `bun run build:sdk`, `bun run build:desktop:cli`), and the prompt and provider options were written to ignored `artifacts/slopcamera/`. Only the credentialed call is outstanding. Until the figure lands, `bun run typecheck` fails on `app/blog/editorial-images.ts` and `app/blog/blog.test.tsx` fails its image gate; both are the intended fail-closed behavior.

### Prompt

Write this text, with one trailing newline, to `artifacts/slopcamera/prompts/grok-4-7-coding-agent-index.txt`. Its SHA-256 is `ffba129024de00345b0c1f48b93cc1e89ecdd0cb48e3af88f5db5a2b095e89d8`; record that value as `promptSha256`.

```text
Editorial illustration in a wide 16:9 frame on a near-charcoal ground (#12100f). Monochrome with one accent: matte warm-ivory (#f5f2ed) forms, raised charcoal (#1d1a18) shadows, and a single warm brass (#d0a77c) line as the only accent. One large, smooth, matte ivory ovoid stone lies horizontally at the center of the frame. Beneath it stand two separate low charcoal plinths of clearly different heights with an open gap between them; the stone bridges the gap and rests on both flat tops. One thin brass line runs along the front edge of the left plinth, and a second, separate brass segment runs along the front edge of the right plinth at its own different height; the two segments stop short of each other and never meet across the gap. Soft key light from the upper left, matte materials, quiet studio shadows, shallow depth, generous negative space. No text, no numbers, no axes, no charts, no logos, no screens, no people, no robots, no brains, no brand marks. Keep the stone and both plinths centered so the subject stays legible when the image is cropped to the middle 60 percent of its width.
```

### Generation

Run from the repository root with `SLOPCAMERA_SOURCE_ROOT` bound to the reviewed build and `artifacts/slopcamera/provider-options.json` holding the reviewed provider options from `editorial/IMAGES.md`:

```sh
vercel env run -- bun "$SLOPCAMERA_SOURCE_ROOT/apps/desktop/dist/cli/main.js" ai image generate \
  --model openai/gpt-image-2 --prompt-file artifacts/slopcamera/prompts/grok-4-7-coding-agent-index.txt \
  --count 1 --max-per-call 1 --size 1536x864 \
  --provider-options artifacts/slopcamera/provider-options.json --timeout 300s --json
```

Review the original at 1536×864 and in a 384×216 contact sheet beside the 11 live figures. Reject accidental text, distorted forms, fake data, a repeated composition, or a subject that disappears in the center crop. Do not retry an ambiguous paid result automatically.

### Registration

1. Copy the accepted WebP to `public/images/blog/grok-4-7-coding-agent-index.webp` and record `sha256sum` and byte size.
2. Add a row to `BLOG_EDITORIAL_IMAGES` in `app/blog/editorial-images.ts` using the `image(...)` helper: slug `grok-4-7-coding-agent-index`; alt text describing the visible composition (draft: “A large matte ivory stone rests across two separate charcoal plinths of different heights, each edged by its own short brass line.”); caption “One model, two measurements: a coding-agent row inside one harness and an Intelligence Index row under another. The two scales do not meet, and this illustration is not a data plot.”; the binary SHA-256; the prompt SHA-256 above; and the receipt and job paths the CLI printed.
3. Add the matching entry to `editorial/images.manifest.json` with the same paths, bytes, hashes, the Slopcamera generator block, `"validation": "decode-passed"`, and `"review": "accepted"`.
4. Run `bun test app/blog/blog.test.tsx` and `bun run check`; both must pass before merge.

## Verification

- `bun test lib/grok-4-7-placement.test.ts lib/grok-4-7-placement.property.test.ts` passes: rank equals one plus the count of higher rows, a dominator removes the row from the chart frontier, component ranks stay inside the rows that carry the component, Intelligence Index frontier membership equals the absence of a dominator, and neighbors are exactly the rows inside the window.
- `bun test app/blog/blog.test.tsx` passes once the figure is registered: the rendered note contains every derived score, cost, rank, dominator, neighbor, and generation value from the checked snapshots, every quoted claim constant, one link to xAI’s launch page, no CursorBench percentage, and no em dash, backtick, “refresh,” or “schema.”
- `bun run check` passes on Node 24 and the pull request merges through the documented delivery path.
- The live page at `https://aicharts.io/blog/grok-4-7-coding-agent-index` shows the figure, the canonical metadata, JSON-LD image, Atom enclosure, and sitemap entry, and `/blog/grok-4-7-coding-agent-index` negotiates to Markdown with the figure line.

## Recovery

If the figure cannot be generated, do not stub bytes or hashes and do not loosen the registry type. Leave the pull request open and this plan `blocked`; the note stays unpublished because the slug is only reachable through the checked build.
