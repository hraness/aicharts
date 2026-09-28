---
title: Publish the Claude Code · Opus 5.5 coding-agent note
description: Ship /blog/opus-5-5-coding-agent-index, a note that places Claude Code · Opus 5.5 (max) as the leading and costliest configuration on the coding-agent chart from the checked snapshot, walks the cost frontier down from it, splits the AA Index into its components, compares it with Claude Code · Opus 5 in the same harness, separates it from the Intelligence Index row, and completes its Slopcamera figure through the documented generation path.
type: plan
area: blog
status: blocked
repository_scopes:
  - app/blog
  - lib/claude-opus-5-5-placement.ts
  - editorial
tags:
  - editorial
  - coding-agents
  - intelligence-index
---

# Publish the Claude Code · Opus 5.5 coding-agent note

## Outcome

`/blog/opus-5-5-coding-agent-index` is live at `https://aicharts.io` with one registered Slopcamera figure. The note states where Claude Code · Opus 5.5 (max) lands on the coding-agent chart (first of 20 on AA Index and the highest cost per task), lists the four highest-scoring configurations after it, walks the cost frontier down from the row stating the points each cheaper vertex gives up and its share of the row’s cost, names the best other configuration on each of DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA with the signed gap, compares the row with Claude Code · Opus 5 (max) in the same harness, sets the Intelligence Index row beside it without pooling the two, and keeps Anthropic’s vendor-run Terminal-Bench figure out of the evidence.

## Context

The weekday monitor asked for a chart-backed Opus 5.5 note with the coding-agent chart as the subject; the live Intelligence Index note (`/blog/opus-5-5-intelligence-index`) covers the Index placement and effort ladder and uses the coding chart only to keep the Claude Code rows apart from the Index subject. The evidence is `data/coding-agents.json` retrieved 2026-09-25T14:39:44.751Z (20 configurations, method `next-flight`, DeepSWE v1.1, Terminal-Bench v4, SWE-Atlas-QnA), which stores Claude Code · Opus 5.5 (max) at AA Index 65.99 for $13.04 per task (id `ab5074e404be48bbd4ac3c488ad9a3e2`, added to the update log at the retrieval time) with DeepSWE 68.44, Terminal-Bench 63.13, and SWE-Atlas 66.40, 15.55 million tokens and 3,867 seconds per task; Claude Code · Fable 5.1 (with fallback) (max) at 62.22 for $12.39; Devin Fusion CLI · Claude Fable 5.1 XHigh + SWE-2 Medium at 61.68 for $7.90; Codex · GPT-6 Astra (max) at 61.65 for $7.47; and Claude Code · Opus 5 (max) at 59.73 for $10.79. The Intelligence Index snapshot `data/artificial-analysis-intelligence-v4-3.json` retrieved 2026-09-23T13:38:04.121Z stores Claude Opus 5.5 (max) at 57.62 for $5.98 per task, first of 97 comparable rows. On 2026-09-28 the live Artificial Analysis coding-agents page still carried the same $13.036383418426828 cost for the row.

Snapshot observations the note derives at render time: the frontier below the row runs Fable 5.1 (with fallback), Devin Fusion CLI · Claude Fable 5.1 XHigh + SWE-2 Medium, Codex · GPT-6 Astra, Devin Fusion CLI · GPT-6 Astra XHigh + SWE-2 Medium, Codex · GPT-6 Sol, Codex · GPT-5.6 Luna, Codex · DeepSeek V4 Pro 0813, Codex · GPT-6 Luna, and Codex · DeepSeek V4 Flash 0731; the first step gives up 3.8 points for 95% of the cost, the first vertex at half the cost or less gives up 7.1 points for 35%, and the last gives up 27.2 points for 0.7%. The row leads Terminal-Bench 4 by 5.6 points over Fable 5.1 and SWE-Atlas-QnA by 0.3 points over Kimi Code CLI · Kimi K3, and is sixth of 20 on DeepSWE v1.1 behind Muse Code · Muse Spark 1.3 (xhigh). Against Opus 5 in Claude Code it adds 6.3 points at 1.2x the cost, 1.4x the tokens, and 1.5x the time, while Anthropic lists lower per-token prices for Opus 5.5.

## Admission

Scores 0–2, total 12, no zero: reader utility 2, original evidence 2, factual confidence 2, host fit 2, voice integrity 2, maintenance value 2, as scored by the weekday monitor and recorded in `app/blog/article-admissions.ts`. Reader task: what Claude Code · Opus 5.5’s leading coding-agent AA Index and $13.04 cost per task measure on the dated snapshot, what each step down the cost frontier gives up, where the index points come from, how the row moved from Claude Code · Opus 5, and why its cost is not the Intelligence Index cost. Closest live notes and distinctions are recorded in the admission: the Intelligence Index note (Index placement, frontier, and effort ladder; the new note links to it and uses the Index row only for the two-unit contrast), the GPT-6 Sol note (a sixth-place frontier row and its Codex predecessor), the Grok 4.7 note (both charts and Grok 4.6 in the same harness), and the AA Index cost note (the whole frontier without a placed row). Fewer than a third of the headings or claims overlap any of them; the component and predecessor tables are shared structure for other models, and every heading in this note derives its own numbers. The Index note’s admission record gains the new note as its nearest URL and drops its stale statement that the coding-agent snapshot stores no Opus 5.5 row.

Provenance: drafted by a Cursor cloud agent (Claude) on 2026-09-28 from the checked snapshots and the primary pages already cited by the Index note. The recorded reviewer is the weekday monitor’s AI admission scoring (`weekday-monitor AI editorial review`, `reviewerType: "ai"`, reviewed 2026-09-28, reassess 2026-11-02). No human review is claimed; `humanReviewedOn` is `null`. The page shows the provenance sentence from the admission record and the Hraness byline.

## Scope

### In scope

- `lib/claude-opus-5-5-placement.ts`: the Claude Code · Opus 5.5 binding of the shared coding-agent placement (`opus55CodingAgentPlacement`) with Claude Code · Opus 5 as predecessor, the cost rank among costed rows, the closest costed rows below, the frontier descent from the row, and per-component contrasts against the best other row, with example and property tests.
- `app/blog/opus-5-5-coding-agent-index-article.ts` with a `createOpus55CodingArticle(codingSnapshot, intelligenceSnapshot)` factory, the admission record, the public slug, and a related link from the Index note.
- One registered Slopcamera figure: registry row, manifest entry, and `public/images/blog/opus-5-5-coding-agent-index.webp`.

### Non-goals

- Charting or restating Anthropic’s vendor-run Terminal-Bench 4.0, FrontierCode, CursorBench, GDPval-AA, AutomationBench, Humanity’s Last Exam, Terminal-Bench-Science, OSWorld, or Chartography figures.
- Placing Opus 5.5 in any harness other than Claude Code or at any setting other than max; the snapshot stores one configuration. If another appears, the note lists it.
- Restating the Intelligence Index note’s frontier walk, effort ladder, or cost components.
- Changing the editorial-image type contract so a live note can ship without a figure.

## Constraints and decisions

- The title states the finding with its number and cost (“Opus 5.5 tops the coding-agent chart at 66.0 and $13.04 a task”), drops the cost when the derived title would exceed 64 characters, switches to “Claude Code · Opus 5.5 scores N on the coding-agent chart” when the row is not first, and falls back to a placement-free title when the row is absent. It does not reuse the Index note’s “leads the Intelligence Index at N for $C” formula or the “What X’s N measures” formula.
- The rank heading derives its numbers and its cost clause (“First of 20 configurations, at the chart’s highest cost”), the frontier heading names the question (“What stepping down the cost frontier gives up”), and the component heading names the components the row leads (“Terminal-Bench 4 and SWE-Atlas-QnA carry the lead”), falling back to “Where the index points come from” when it leads none or all.
- Cost below the row prints as a share of the row’s cost (“95%”, “0.7%”) rather than a one-decimal multiple, because 0.95x would round to 1.0x; multiples above one print as “1.2x”.
- Every snapshot-derived sentence has an explicit fallback for an absent row, a non-leading row with dominators, a row that is not the costliest, zero or one rows beneath it, an empty frontier descent, a component tie, an absent predecessor, a predecessor that costs more, a second Opus 5.5 harness, and an absent Intelligence Index row. Each table renders only with at least two rows.
- Anthropic’s “costs 40% less to run than Opus 5” is quoted beside the measured 1.2x cost step and stated as a per-token price claim that the harness token volume outran; the note does not call the two a contradiction.
- The Slopcamera figure follows `editorial/IMAGES.md`: reviewed source build at commit `66b4322030f4de24f4d5b6d0c2515c109259f901`, credentials only in the child process, one paid call per prompt, no automatic retry, dark monochrome with one brass accent, a silhouette distinct from the Index note’s five spheres on a staircase, the Grok stone on two plinths, and the Sol sphere over two pools.

## Plan

1. Verify the snapshot rows against the live Artificial Analysis page and reuse the quoted claims the Index note already fetched from Anthropic and the model page. Done 2026-09-28.
2. Write the coding-agent binding, the article factory, registration, admission, and tests. Done 2026-09-28.
3. Generate, review, and register the Slopcamera figure. Blocked 2026-09-28: the agent VM has no Vercel CLI credentials (`vercel whoami` reports logged out, no `VERCEL_TOKEN`), so `vercel env run` cannot inject the gateway credential. The prompt and provider options are written to ignored `artifacts/slopcamera/`; only the credentialed call, review, and registration are outstanding.
4. Let CI pass, enable auto-merge on the task-owned pull request, and verify the live URL, figure, and Open Graph image.

## Figure handoff

Until the figure lands, `bun run typecheck` fails on `app/blog/editorial-images.ts` (the registry type requires a row for every public slug) and `bun test app/blog/blog.test.tsx` fails its image gate and the new note’s `blogEditorialImage` assertion; both are the intended fail-closed behavior. Every other assertion for the note passed on 2026-09-28.

### Prompt

Write this text, with one trailing newline, to `artifacts/slopcamera/prompts/opus-5-5-coding-agent-index.txt`. Its SHA-256 is `89bf0ca0420013ffe9078b787fb535bd633bdd214f074bca7751872cd248d0af`; record that value as `promptSha256`.

```text
Editorial illustration in a wide 16:9 frame on a near-charcoal ground (#12100f). Monochrome with one accent: matte warm-ivory (#f5f2ed) forms, raised charcoal (#1d1a18) surfaces, and a single warm brass (#d0a77c) line as the only accent. A long, low charcoal table runs horizontally across the frame a little below center, its top surface one shade lighter than the ground. One tall, heavy, matte ivory rectangular block stands upright on the table about two thirds of the way across the frame from the left, and it is the only object on the table. From the base of the block, one thin brass line runs left along the front edge of the table, growing thinner and fainter until it fades out well before the left edge of the frame. The table to the right of the block is empty and short. Soft key light from the upper left, matte materials, quiet studio shadows, shallow depth, generous negative space. No text, no numbers, no axes, no charts, no logos, no screens, no people, no robots, no brains, no brand marks. Keep the block and the whole brass line inside the middle 60 percent of the frame width so the subject stays legible when the image is cropped to the center.
```

### Generation

Run from the repository root with `SLOPCAMERA_SOURCE_ROOT` bound to the reviewed build and `artifacts/slopcamera/provider-options.json` holding the reviewed provider options from `editorial/IMAGES.md`:

```sh
vercel env run -- bun "$SLOPCAMERA_SOURCE_ROOT/apps/desktop/dist/cli/main.js" ai image generate \
  --model openai/gpt-image-2 --prompt-file artifacts/slopcamera/prompts/opus-5-5-coding-agent-index.txt \
  --count 1 --max-per-call 1 --size 1536x864 \
  --provider-options artifacts/slopcamera/provider-options.json --timeout 300s --json
```

Review the original at 1536×864 and in a 384×216 contact sheet beside the 15 live figures. Reject accidental text, distorted forms, fake data, a repeated composition, or a subject that disappears in the center crop. Do not retry an ambiguous paid result automatically.

### Registration

1. Copy the accepted WebP to `public/images/blog/opus-5-5-coding-agent-index.webp` and record `sha256sum` and byte size.
2. Add a row to `BLOG_EDITORIAL_IMAGES` in `app/blog/editorial-images.ts` using the `image(...)` helper: slug `opus-5-5-coding-agent-index`; alt text describing the visible composition (draft: “A tall matte ivory block stands near the right end of a long low charcoal table, with one thin brass line running left along the table’s edge.”); caption “Claude Code · Opus 5.5 holds the coding-agent chart’s top score and its highest cost per task at once, and every cheaper configuration on the frontier gives up index points.”; the binary SHA-256; the prompt SHA-256 above; and the receipt and job paths the CLI printed.
3. Add the matching entry to `editorial/images.manifest.json` with the same paths, bytes, hashes, the Slopcamera generator block, `"validation": "decode-passed"`, and `"review": "accepted"`.
4. Run `bun test app/blog/blog.test.tsx` and `bun run check`; both must pass before merge.

## Verification

- `bun test lib/claude-opus-5-5-placement.test.ts lib/claude-opus-5-5-placement.property.test.ts` passes (43 tests on 2026-09-28): the frontier below the row is exactly the frontier’s lower-scoring vertices with cost falling along it, each component contrast names the best other row and the signed gap, the closest rows below are the highest-scoring other costed rows at or under the placed score capped at the count, the cost rank counts the costed rows that cost strictly more, a strict leader with a cost is always on the frontier, and the Intelligence Index bindings are unchanged.
- `bun test app/blog/blog.test.tsx` passes once the figure is registered: the rendered note contains every derived score, cost, rank, cost rank, frontier step, component contrast, predecessor multiple, and Intelligence Index value from the checked snapshots and every quoted claim constant; no vendor table percentage, em dash, backtick, “refresh,” “schema,” “checked snapshot,” or internal delivery word; a title under 64 characters that matches neither formula; a dek of at most 200 characters; and the absent-row, absent-Index-row, lone-row, demoted, outspent, tied, two-harness, cheaper-predecessor, later-retrieval, and long-title fallbacks. On 2026-09-28 every assertion except the image gate passed.
- `bun run check` passes on Node 24 and the pull request merges through the documented delivery path.
- The live page at `https://aicharts.io/blog/opus-5-5-coding-agent-index` shows the figure, the canonical metadata, JSON-LD image, Atom enclosure, and sitemap entry, and negotiates to Markdown with the figure line.

## Recovery

If the figure cannot be generated, do not stub bytes or hashes and do not loosen the registry type. Leave the pull request open as a draft and this plan `blocked`; the note stays unpublished because the slug is only reachable through the checked build.
