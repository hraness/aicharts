---
title: Publish the GPT-6 Sol coding-agent placement note
description: Ship /blog/gpt-6-sol-coding-agent-index, a note that places Codex · GPT-6 Sol (max) on the coding-agent chart and GPT-6 Sol (max) on the Intelligence Index from the checked snapshots, and complete its Slopcamera figure through the documented generation path.
type: plan
area: blog
status: blocked
repository_scopes:
  - app/blog
  - lib/snapshot-placement.ts
  - lib/gpt-6-sol-placement.ts
  - editorial
tags:
  - editorial
  - coding-agents
  - intelligence-index
---

# Publish the GPT-6 Sol coding-agent placement note

## Outcome

`/blog/gpt-6-sol-coding-agent-index` is live at `https://aicharts.io` with one registered Slopcamera figure. The note states where Codex · GPT-6 Sol (max) lands on the coding-agent chart and where GPT-6 Sol (max) lands on the Intelligence Index, compares the row with Codex · GPT-5.6 Sol (max) in the same harness, splits the AA Index into its three components, tabulates the six comparable GPT-6 Sol reasoning settings on the Intelligence Index, separates the two per-task costs behind one list price, and keeps OpenAI’s vendor-run figures out of the evidence.

## Context

Ben asked for a chart-backed GPT-6 Sol note that owns Sol as the subject. The live Grok 4.7 note already names Codex · GPT-6 Sol as a cheaper row that scores higher than Grok Build · Grok 4.7; this note places Sol itself and never places Grok. The evidence is the two checked snapshots: `data/coding-agents.json` retrieved 2026-09-23T03:44:34.316Z stores Codex · GPT-6 Sol (max) at AA Index 56.66 for $2.99 per task (sixth of 19, on the cost frontier) beside Codex · GPT-5.6 Sol (max) at 54.56 for $6.35, and `data/artificial-analysis-intelligence-v4-3.json` retrieved 2026-09-23T13:38:04.121Z stores GPT-6 Sol (max) at 47.53 for $1.06 per task (14th of 97 comparable rows, on the cost frontier) with five lower reasoning settings of the same release. Artificial Analysis’s launch note of 2026-09-22 and its model page captured 2026-09-24 supply the quoted claims; OpenAI’s launch page supplies the release date, availability, and the $4 to $2 and $20 to $10 price change. OpenAI’s vendor-run table is described once and not charted.

## Admission

Scores 0–2, total 12, no zero: reader utility 2, original evidence 2, factual confidence 2, host fit 2, voice integrity 2, maintenance value 2. Reader task: what Codex · GPT-6 Sol’s AA Index on the coding-agent chart measures, where the row lands, how it moved from GPT-5.6 Sol in the same harness, how the Intelligence Index GPT-6 Sol (max) row and its lower reasoning settings differ from it, and why the two costs per task are not one unit. Closest live notes and distinctions are recorded in `app/blog/article-admissions.ts`: the Grok 4.7 note (same two-chart frame, Sol named in one dominator sentence, Grok as subject), the AA Index cost note (whole frontier, not one new row), the small-models note (product adoption rule with a GPT-5.6 Luna cost anecdote), and the MiMo note (open-weights frontier and investor claims). Fewer than a third of the headings or claims overlap any of them; the shared two-chart frame is a structure, and every heading in this note derives its own numbers.

Provenance: drafted by a Cursor cloud agent (Claude) on 2026-09-24 from the checked snapshots and the fetched primary pages; reviewed by an independent agent review against `STYLE.md` and `WRITING.md` on the same day, recorded in the pull request. No human review is claimed; `humanReviewedOn` is `null`. The public page carries no AI-drafting label, per the shared `STYLE.md`.

## Scope

### In scope

- `lib/snapshot-placement.ts`: the configuration-parameterized coding-agent and Intelligence Index placement helpers shared by the Grok 4.7 and GPT-6 Sol notes, plus one-point coding neighbors, the cheapest higher-scoring row, same-release siblings, and an effort ladder. `lib/grok-4-7-placement.ts` keeps its exports and delegates.
- `lib/gpt-6-sol-placement.ts` binding those helpers to Codex · GPT-6 Sol, its Codex · GPT-5.6 Sol predecessor, and the `gpt-6-sol` release, with example and property tests.
- `app/blog/gpt-6-sol-coding-agent-index-article.ts` with a `createGpt6SolArticle(codingSnapshot, intelligenceSnapshot)` factory, three new `BLOG_SOURCES`, the admission record, and the public slug.
- One registered Slopcamera figure: registry row, manifest entry, and `public/images/blog/gpt-6-sol-coding-agent-index.webp`.

### Non-goals

- Charting or restating OpenAI’s vendor-run FrontierCode, AutomationBench, Agents’ Last Exam, OSWorld, or DeepSWE figures.
- Ranking GPT-6 Sol in Cursor or any harness other than Codex, or at any coding-chart setting other than max; the snapshot stores one configuration.
- Placing Grok 4.7; the live Grok note owns that subject.
- Changing the editorial-image type contract so a live note can ship without a figure.

## Constraints and decisions

- The title states the finding with its number and cost (“GPT-6 Sol scores 56.7 on the coding-agent chart at $2.99 a task”) and drops the cost when the derived title would exceed 64 characters. A missing coding-agent row falls back to a placement-free title. The note does not reuse the “What X’s N measures” formula or a question-list opener.
- The two placement headings derive their rank and count from the snapshots (“On the coding-agent chart, sixth of 19 rows”; “On the Intelligence Index, 14th of 97 comparable rows”).
- Every snapshot-derived sentence has an explicit fallback for an absent row, an empty dominator list, one or many dominators, zero, one, or many neighbors, an absent predecessor, and a single effort row, and each table renders only with at least two rows.
- The generation section states which components rose and which fell from the snapshot; the DeepSWE v1.1 fall is a snapshot fact beside Artificial Analysis’s quoted Terminal-Bench 4.0 and SWE-Atlas-QnA gains.
- The Intelligence Index snapshot stores no GPT-5.6 Sol row, so the index-side generation step is quoted from Artificial Analysis alone and labeled as such.
- The Slopcamera figure follows `editorial/IMAGES.md`: reviewed source build at commit `66b4322030f4de24f4d5b6d0c2515c109259f901`, credentials only in the child process, one paid call per prompt, no automatic retry, dark monochrome with one brass accent, a silhouette distinct from the Grok stone-on-two-plinths figure.

## Plan

1. Verify the two snapshot rows, fetch the Artificial Analysis launch note and model page and OpenAI’s launch page, and record the quoted claims. Done 2026-09-24.
2. Write the shared placement helpers, the Sol bindings, the article factory, registration, admission, and tests. Done 2026-09-24.
3. Generate, review, and register the Slopcamera figure. Blocked 2026-09-24: the agent VM has no Vercel CLI credentials and no gateway credential, and `vercel env run` starts an interactive device login. Prompt, provider options, and build are prepared; only the credentialed call is outstanding.
4. Let CI pass, merge through the task-owned pull request, and verify the live URL, figure, and Open Graph image.

## Figure handoff

The Slopcamera source build at the reviewed commit was cloned and built on the agent VM (`bun install --frozen-lockfile --ignore-scripts`, `bun run build:sdk`, `bun run build:desktop:cli`; `slopcamera doctor --json` reports version 3.2.5 and `gatewayCredential.configured: false`), and the prompt and provider options were written to ignored `artifacts/slopcamera/`. `vercel env run` printed “No existing credentials found. Starting login flow...” and waited on a device code. Until the figure lands, `bun run typecheck` fails on `app/blog/editorial-images.ts` and `app/blog/blog.test.tsx` fails its image gate; both are the intended fail-closed behavior.

### Prompt

Write this text, with one trailing newline, to `artifacts/slopcamera/prompts/gpt-6-sol-coding-agent-index.txt`. Its SHA-256 is `4e71b7f4f5783ea67e43acee8a19528645daddf74c4168abe787fd577c9a0a85`; record that value as `promptSha256`.

```text
Editorial illustration in a wide 16:9 frame on a near-charcoal ground (#12100f). Monochrome with one accent: matte warm-ivory (#f5f2ed) forms, raised charcoal (#1d1a18) surfaces, and a single warm brass (#d0a77c) line as the only accent. One large, smooth, matte ivory sphere rests at the center of the frame on a low, wide charcoal ledge. In front of and below the ledge lie two separate shallow rectangular pools of still black water, side by side, of clearly different widths, with a strip of charcoal floor between them; each pool holds its own calm reflection of the sphere, and the two reflections never touch. One thin brass line runs along the front lip of the ledge and stops before the frame edges. Soft key light from the upper left, matte materials, quiet studio shadows, shallow depth, generous negative space. No text, no numbers, no axes, no charts, no logos, no screens, no people, no robots, no brains, no brand marks. Keep the sphere, the ledge, and both pools centered so the subject stays legible when the image is cropped to the middle 60 percent of its width.
```

### Generation

Run from the repository root with `SLOPCAMERA_SOURCE_ROOT` bound to the reviewed build and `artifacts/slopcamera/provider-options.json` holding the reviewed provider options from `editorial/IMAGES.md`:

```sh
vercel env run -- bun "$SLOPCAMERA_SOURCE_ROOT/apps/desktop/dist/cli/main.js" ai image generate \
  --model openai/gpt-image-2 --prompt-file artifacts/slopcamera/prompts/gpt-6-sol-coding-agent-index.txt \
  --count 1 --max-per-call 1 --size 1536x864 \
  --provider-options artifacts/slopcamera/provider-options.json --timeout 300s --json
```

Review the original at 1536×864 and in a 384×216 contact sheet beside the 12 live figures. Reject accidental text, distorted forms, fake data, a repeated composition, or a subject that disappears in the center crop. Do not retry an ambiguous paid result automatically.

### Registration

1. Copy the accepted WebP to `public/images/blog/gpt-6-sol-coding-agent-index.webp` and record `sha256sum` and byte size.
2. Add a row to `BLOG_EDITORIAL_IMAGES` in `app/blog/editorial-images.ts` using the `image(...)` helper: slug `gpt-6-sol-coding-agent-index`; alt text describing the visible composition (draft: “A matte ivory sphere rests on a charcoal ledge above two separate dark pools, each holding its own reflection of it.”); caption “One model measured twice: the coding-agent row in Codex and the Intelligence Index row are two readings of GPT-6 Sol, each on its own scale.”; the binary SHA-256; the prompt SHA-256 above; and the receipt and job paths the CLI printed.
3. Add the matching entry to `editorial/images.manifest.json` with the same paths, bytes, hashes, the Slopcamera generator block, `"validation": "decode-passed"`, and `"review": "accepted"`.
4. Run `bun test app/blog/blog.test.tsx` and `bun run check`; both must pass before merge.

## Verification

- `bun test lib/gpt-6-sol-placement.test.ts lib/gpt-6-sol-placement.property.test.ts lib/grok-4-7-placement.test.ts lib/grok-4-7-placement.property.test.ts` passes: rank equals one plus the count of higher rows, a dominator removes the row from the chart frontier, coding neighbors are exactly the costed rows inside the window, the cheapest higher row is the minimum-cost higher row, siblings are exactly the other comparable rows of the release, the effort ladder is a cost-ordered partition whose steps sum to the top-minus-bottom gap, and the Grok 4.7 bindings are unchanged.
- `bun test app/blog/blog.test.tsx` passes once the figure is registered: the rendered note contains every derived score, cost, rank, neighbor, component, generation, and effort-ladder value from the checked snapshots, every quoted claim constant, no CursorBench or vendor table percentages, no em dash, backtick, “refresh,” or “schema,” a title that never matches the “What X’s N measures” formula, and no question-list opener.
- `bun run check` passes on Node 24 and the pull request merges through the documented delivery path.
- The live page at `https://aicharts.io/blog/gpt-6-sol-coding-agent-index` shows the figure, the canonical metadata, JSON-LD image, Atom enclosure, and sitemap entry, and `/blog/gpt-6-sol-coding-agent-index` negotiates to Markdown with the figure line.

## Recovery

If the figure cannot be generated, do not stub bytes or hashes and do not loosen the registry type. Leave the pull request open as a draft and this plan `blocked`; the note stays unpublished because the slug is only reachable through the checked build.
