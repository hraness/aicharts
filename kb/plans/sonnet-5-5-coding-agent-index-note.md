---
title: Publish the Claude Code · Sonnet 5.5 coding-agent note
description: Ship /blog/sonnet-5-5-coding-agent-index, a note that places Claude Code · Sonnet 5.5 (max) as the leading and costliest configuration on the coding-agent chart from the checked snapshot, tabulates its five Claude Code settings, walks the cost frontier down from it, compares it with Claude Code · Opus 5.5 in the same harness, splits the AA Index into its components, separates it from the Intelligence Index row, and completes its Slopcamera figure through the documented generation path.
type: plan
area: blog
status: blocked
repository_scopes:
  - app/blog
  - lib/claude-sonnet-5-5-placement.ts
  - editorial
tags:
  - editorial
  - coding-agents
  - intelligence-index
---

# Publish the Claude Code · Sonnet 5.5 coding-agent note

## Outcome

`/blog/sonnet-5-5-coding-agent-index` is live at `https://aicharts.io` with one registered Slopcamera figure. The note states where Claude Code · Sonnet 5.5 (max) lands on the coding-agent chart (first of 31 on AA Index and the highest cost per task), lists the five Claude Code settings cheapest first and what the last step buys, walks the cost frontier down from the row stating the points each cheaper vertex gives up and its share of the row’s cost, compares the row with Claude Code · Opus 5.5 (max) in the same harness, names the best other configuration on each of DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA with the signed gap, and sets the Intelligence Index row beside it without pooling the two.

## Context

PR #636 restored data refresh and published checked snapshots dated 2026-10-05. Production serves 31 coding-agent configurations (`retrievedAt` 2026-10-05T14:10:36.287Z). Claude Code · Sonnet 5.5 (max) is the new leader at AA Index 68.4 and $14.19 per task (id `a2c87c062f3cef73d8525e7578f14742`, added to the update log at the retrieval time), ahead of Claude Code · Opus 5.5 (max) at 66.0 and $13.04. The same snapshot stores low, medium, high, and xhigh Claude Code · Sonnet 5.5 rows. The last step, from xhigh at 62.9 and $3.33 to max at 68.4 and $14.19, adds 5.5 index points at 4.3x the cost of the setting below it. Intelligence Index v4.3.2 (`data/artificial-analysis-intelligence-v4-3.json`, 108 configurations, `retrievedAt` 2026-10-05T14:11:25.490Z) stores Claude Sonnet 5.5 (Max, Default Fallback) at 56.0 and $7.67, second behind Opus 5.5 max at 57.62. The Index row is a two-unit contrast only; the scores are not pooled.

Snapshot observations the note derives at render time: the frontier below the max row starts at Claude Code · Opus 5.5 (max), 2.4 points lower for 92% of the cost, then Antigravity CLI · Gemini 4 Argon and later Codex rows; the max row leads Terminal-Bench 4 and SWE-Atlas-QnA and is sixth of 31 on DeepSWE v1.1, where Antigravity CLI · Gemini 4 Argon (default) leads. There is no Sonnet predecessor generation on the coding-agent chart; the same-harness contrast is Claude Code · Opus 5.5 at the same setting.

## Admission

Scores 0–2, total 10, no zero: reader utility 2, original evidence 2, factual confidence 1, host fit 2, voice integrity 1, maintenance value 2, recorded in `app/blog/article-admissions.ts`. Reader task: what Claude Code · Sonnet 5.5’s leading coding-agent AA Index and $14.19 cost per task measure on the dated snapshot, what each Claude Code setting buys, what each step down the cost frontier gives up, how the row sits beside Claude Code · Opus 5.5, and why its cost is not the Intelligence Index cost. Closest live notes and distinctions are recorded in the admission: the Opus 5.5 coding-agent note (places Opus, compares Opus generations, uses Sonnet only as the first cheaper frontier contrast when the snapshot ranks Sonnet higher), the AA Index cost note (the whole frontier without a placed row), the GPT-6 Sol note (a Codex frontier row and its predecessor), and the Grok 4.7 note (both charts and Grok 4.6 in the same harness). Fewer than a third of the headings or claims overlap any of them; the component table is shared structure for other models, and the five-setting ladder is this note’s own subject. The Opus coding-agent admission gains this note as a nearest URL and drops the stale claim that Opus is the leading and costliest row.

Provenance: drafted by a Cursor cloud agent (Grok) on 2026-10-05 from the checked snapshots. The recorded reviewer is Codex (`reviewerType: "ai"`, reviewed 2026-10-05, reassess 2026-11-09). No human review is claimed; `humanReviewedOn` is `null`. The page shows the provenance sentence from the admission record and the Hraness byline. A Hraness digest is not used as corroboration.

## Scope

### In scope

- `lib/claude-sonnet-5-5-placement.ts`: the Claude Code · Sonnet 5.5 binding of the shared coding-agent placement (`sonnet55CodingAgentPlacement`) with the five-setting effort ladder, Claude Code · Opus 5.5 at the same setting as a same-harness contrast, the cost rank among costed rows, the closest costed rows below, the frontier descent from the row, and per-component contrasts against the best other row, with example and property tests.
- `app/blog/sonnet-5-5-coding-agent-index-article.ts` with a `createSonnet55CodingArticle(codingSnapshot, intelligenceSnapshot)` factory, the admission record, the public slug, and a related link from the Opus coding-agent note.
- One registered Slopcamera figure: registry row, manifest entry, and `public/images/blog/sonnet-5-5-coding-agent-index.webp`.

### Non-goals

- Charting or quoting Anthropic launch copy, vendor-run tables, or a Hraness reading digest as independent evidence.
- Placing Sonnet 5.5 in any harness other than Claude Code as the headline row; if another harness appears, the note lists it.
- Restating the Opus coding-agent note’s predecessor walk or the Intelligence Index note’s effort ladder.
- Widening `PUBLIC_MODEL_CARD_PATHS`; the `/models/anthropic/claude-sonnet-5.5/{low,medium,high,xhigh,max}` pages already exist.
- Changing the editorial-image type contract so a live note can ship without a figure.

## Constraints and decisions

- The title states the finding with its number and cost (“Sonnet 5.5 is first on the coding-agent chart at 68.4, $14.19”), drops the cost when the derived title would exceed 64 characters, switches to “Claude Code · Sonnet 5.5 scores N on the coding-agent chart” when the row is not first, and falls back to a placement-free title when the row is absent. It does not reuse the Opus note’s “tops the coding-agent chart” formula, the Index note’s “leads the Intelligence Index” formula, or the “What X’s N measures” formula. “First” is the snapshot rank, not an unverifiable superlative.
- The rank heading derives its numbers and its cost clause (“First of 31 configurations, at the chart’s highest cost”), the effort heading names the setting count (“What each of the five Claude Code settings buys”), the frontier heading names the first cheaper vertex when it is Opus 5.5 (“The first cheaper frontier row is Opus 5.5”), and the component heading names the component the row does not lead (“DeepSWE v1.1 is the component it does not lead”).
- Cost below the row prints as a share of the row’s cost (“92%”) rather than a one-decimal multiple; multiples above one print as “4.3x”.
- Every snapshot-derived sentence has an explicit fallback for an absent row, a non-leading row with dominators, a row that is not the costliest, one Claude Code setting, zero or one rows beneath it, an empty frontier descent, a component tie, an absent same-harness Opus row, a second Sonnet 5.5 harness, and an absent Intelligence Index row. Each table renders only with at least two rows.
- The Intelligence Index snapshot is used only for the two-unit callout. The note never averages, ranks, or otherwise pools the two scores.
- The Slopcamera figure follows `editorial/IMAGES.md`: reviewed source build at commit `66b4322030f4de24f4d5b6d0c2515c109259f901`, credentials only in the child process, one paid call per prompt, no automatic retry, dark monochrome with one brass accent, a silhouette distinct from the Opus coding-agent tall block on a table, the Index note’s five spheres on a staircase, the Grok stone on two plinths, and the Sol sphere over two pools.

## Plan

1. Verify the snapshot rows against `data/coding-agents.json` and `data/artificial-analysis-intelligence-v4-3.json` after PR #636. Done 2026-10-05. Live vendor pages were not fetched (Exa rate-limited); the note stays chart-backed.
2. Write the coding-agent binding, the article factory, registration, admission, Opus nearest-URL update, and tests. Done 2026-10-05.
3. Generate, review, and register the Slopcamera figure. Blocked 2026-10-05: the cloud VM has no Vercel CLI (`vercel: command not found`), no `VERCEL_TOKEN`, and no `SLOPCAMERA_SOURCE_ROOT`, so `vercel env run` cannot inject the gateway credential. The prompt and provider options are written to ignored `artifacts/slopcamera/`; only the credentialed call, review, and registration are outstanding.
4. Let CI pass, enable auto-merge on the task-owned pull request, and verify the live URL, figure, and Open Graph image.

## Figure handoff

Until the figure lands, `bun run typecheck` fails on `app/blog/editorial-images.ts` (the registry type requires a row for every public slug) and `bun test app/blog/blog.test.tsx` fails its image gate and the new note’s `blogEditorialImage` assertion; both are the intended fail-closed behavior.

### Prompt

Write this text, with one trailing newline, to `artifacts/slopcamera/prompts/sonnet-5-5-coding-agent-index.txt`. Its SHA-256 is `0524b64194f689215505550a74f45fa8e080a97ea7b9da9f6e1f2bb8d955cf50`; record that value as `promptSha256`.

```text
Editorial illustration in a wide 16:9 frame on a near-charcoal ground (#12100f). Monochrome with one accent: matte warm-ivory (#f5f2ed) forms, raised charcoal (#1d1a18) surfaces, and a single warm brass (#d0a77c) line as the only accent. A single low charcoal rail runs left to right across the middle of the frame, carrying five shallow ivory terraces that rise in small even steps toward the right. The first four terraces are empty. On the highest terrace sits one matte ivory wedge, its long face toward the left and its thin edge toward the right, the only object on the rail. A short brass line traces only the leading edge of that top terrace and stops at the wedge. Soft key light from the upper left, matte materials, quiet studio shadows, shallow depth, generous negative space. No text, no numbers, no axes, no charts, no logos, no screens, no people, no robots, no brains, no brand marks. Keep the rail, the five terraces, and the wedge inside the middle 60 percent of the frame width so the subject stays legible when the image is cropped to the center.
```

### Generation

Run from the repository root with `SLOPCAMERA_SOURCE_ROOT` bound to the reviewed build and `artifacts/slopcamera/provider-options.json` holding the reviewed provider options from `editorial/IMAGES.md`:

```sh
vercel env run -- bun "$SLOPCAMERA_SOURCE_ROOT/apps/desktop/dist/cli/main.js" ai image generate \
  --model openai/gpt-image-2 --prompt-file artifacts/slopcamera/prompts/sonnet-5-5-coding-agent-index.txt \
  --count 1 --max-per-call 1 --size 1536x864 \
  --provider-options artifacts/slopcamera/provider-options.json --timeout 300s --json
```

Review the original at 1536×864 and in a 384×216 contact sheet beside the live figures, especially the Opus coding-agent tall block, the Index five spheres on stairs, the Grok stone on two plinths, and the Sol sphere over two pools. Reject accidental text, distorted forms, fake data, a repeated composition, or a subject that disappears in the center crop. Do not retry an ambiguous paid result automatically.

### Registration

1. Copy the accepted WebP to `public/images/blog/sonnet-5-5-coding-agent-index.webp` and record `sha256sum` and byte size.
2. Add a row to `BLOG_EDITORIAL_IMAGES` in `app/blog/editorial-images.ts` using the `image(...)` helper: slug `sonnet-5-5-coding-agent-index`; alt text describing the visible composition (draft: “Five shallow ivory terraces rise along one low charcoal rail; a matte ivory wedge sits on the highest terrace, with a short brass line on that terrace’s leading edge.”); caption “Claude Code · Sonnet 5.5 holds the coding-agent chart’s top score and its highest cost per task at once, and the same harness stores four cheaper settings below it.”; the binary SHA-256; the prompt SHA-256 above; and the receipt and job paths the CLI printed.
3. Add the matching entry to `editorial/images.manifest.json` with the same paths, bytes, hashes, the Slopcamera generator block, `"validation": "decode-passed"`, and `"review": "accepted"`.
4. Run `bun test app/blog/blog.test.tsx` and `bun run check`; both must pass before merge.

## Verification

- `bun test lib/claude-sonnet-5-5-placement.test.ts lib/claude-sonnet-5-5-placement.property.test.ts` passes: the frontier below the row is the frontier’s lower-scoring vertices with cost falling along it, each component contrast names the best other row and the signed gap, the closest rows below are the highest-scoring other costed rows at or under the placed score capped at the count, the cost rank counts the costed rows that cost strictly more, the effort ladder is cheapest-first with step math, and same-harness Opus matches the placed setting.
- `bun test app/blog/blog.test.tsx` passes once the figure is registered: the rendered note contains every derived score, cost, rank, cost rank, effort-ladder step, frontier step, component contrast, same-harness multiple, and Intelligence Index value from the checked snapshots; no em dash, backtick, “refresh,” “schema,” “checked snapshot,” or internal delivery word; a title under 64 characters that matches neither reused formula; a dek of at most 200 characters; and the absent-row, absent-Index-row, lone-setting, demoted, outspent, tied, two-harness, later-retrieval, and long-title fallbacks.
- `bun run check` passes on Node 24 and the pull request merges through the documented delivery path.
- The live page at `https://aicharts.io/blog/sonnet-5-5-coding-agent-index` shows the figure, the canonical metadata, JSON-LD image, Atom enclosure, and sitemap entry, and negotiates to Markdown with the figure line.

## Recovery

If the figure cannot be generated, do not stub bytes or hashes and do not loosen the registry type. Leave the pull request open as a draft and this plan `blocked`; the note stays unpublished because the slug is only reachable through the checked build.
