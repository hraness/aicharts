---
title: Publish the MiMo-V2.6-Pro cost-frontier note
description: Ship /blog/mimo-v2-6-pro-cost-frontier, a note that tests Xiaomi’s and Deedy Das’s MiMo-V2.6-Pro claims against the checked Intelligence Index snapshot, and complete its Slopcamera figure through the documented generation path.
type: plan
area: blog
status: ready
repository_scopes:
  - app/blog
  - lib/mimo-v2-6-pro-frontier.ts
  - editorial
tags:
  - editorial
  - intelligence-index
---

# Publish the MiMo-V2.6-Pro cost-frontier note

## Outcome

`/blog/mimo-v2-6-pro-cost-frontier` is live at `https://aicharts.io` with one registered Slopcamera figure. The note states where MiMo-V2.6-Pro sits on the Intelligence Index cost frontier from the checked snapshot, places Deedy Das’s stated price multiples beside measured cost per task, and reads Xiaomi’s cybersecurity table as a capability profile rather than a ranking.

## Context

Ben asked to save Das’s September 22, 2026 X post about MiMo-V2.6-Pro as an article. The post is the editorial lead, not the evidence: Xiaomi’s release note, model card, and technical report own the model facts and the vendor benchmark table; the Artificial Analysis model page owns the 46 score, prices, and $0.13 per task; the OpenRouter listing owns the UltraSpeed prices; and the checked `data/artificial-analysis-intelligence-v4-3.json` snapshot (Intelligence Index v4.3.2, admitted in PR #374) owns every frontier position and measured multiple.

## Scope

### In scope

- `app/blog/mimo-v2-6-pro-cost-frontier-article.ts` with a `createMimoV26Article(snapshot)` factory, seven new `BLOG_SOURCES`, the admission record, and the public slug.
- `lib/mimo-v2-6-pro-frontier.ts` for frontier position, same-name comparison rows, same-score neighbors, and closed references inside the homepage’s comparable cohort, with example and property tests.
- One registered Slopcamera figure: registry row, manifest entry, and `public/images/blog/mimo-v2-6-pro-cost-frontier.webp`.

### Non-goals

- Ranking open-weights models from the snapshot; it does not record weight availability.
- Testing refusal behavior, UltraSpeed throughput, or any MiMo output ourselves.
- Changing the editorial-image type contract so a live note can ship without a figure.

## Constraints and decisions

- Quote Das only in short attributed phrases. Paraphrase his one cybersecurity prompt as a category and do not reproduce it.
- Report his price multiples as his, with his stated assumptions, and derive the measured multiples from cost per Intelligence Index task in the snapshot.
- Report CyberGym as Xiaomi’s corrected-protocol measurement with blank frontier columns, beside the exploitation benchmarks where GPT-5.6 Sol leads.
- Every snapshot-derived sentence has an explicit fallback when the row, comparator, neighbor, or closed reference is absent, and when MiMo-V2.6-Pro is not on the frontier.
- The Slopcamera figure follows `editorial/IMAGES.md`: reviewed source build at commit `66b4322030f4de24f4d5b6d0c2515c109259f901`, credentials only through `vercel env run` in the linked Vercel workspace, one paid call per prompt, no automatic retry.

## Plan

1. Fetch the primary sources and the tweet text; verify prices against the Artificial Analysis page and the OpenRouter first-party endpoint. Done 2026-09-22.
2. Write the article factory, frontier helpers, registration, admission, and tests. Done 2026-09-22.
3. Generate, review, and register the Slopcamera figure from a machine with the reviewed source build and Vercel access. Blocked: the cloud agent VM has no Vercel workspace credentials, so no paid generation call could be made there.
4. Let CI pass, merge through the task-owned pull request, and verify the live URL.

## Figure handoff

The cloud agent could not run Slopcamera, so the registry, manifest, and binary for this slug are intentionally absent. Until they land, `bun run typecheck` fails on `app/blog/editorial-images.ts` (the registry type requires one row per public slug) and `app/blog/blog.test.tsx` fails its image gate. Both are the intended fail-closed behavior.

### Prompt

Write this text, with one trailing newline, to `artifacts/slopcamera/prompts/mimo-v2-6-pro-cost-frontier.txt`. Its SHA-256 is `22d5fe3788ce281525136d9b4137f6405a1c5c302e8fe14773e7bde8b74294bc`; record that value as `promptSha256`.

```text
Editorial illustration in a wide 16:9 frame on a near-charcoal ground (#12100f). Monochrome with one accent: matte warm-ivory (#f5f2ed) forms, raised charcoal (#1d1a18) shadows, and a single warm brass (#d0a77c) line as the only accent. A calm staircase of broad charcoal steps rises from the lower left to the upper right across the frame. On a low step near the left rests one small, smooth ivory sphere. On the same step and the next step up stand three tall, slender, dark charcoal pillars whose flat tops reach the height of the far higher steps. The small sphere sits exactly level with the front edge of the pillars’ step, so it shares their position on the stair while being a fraction of their height. One thin brass line traces the front edges of the steps as a single continuous stair profile. Soft key light from the upper left, matte materials, quiet studio shadows, shallow depth, generous negative space. No text, no numbers, no axes, no charts, no logos, no screens, no people, no robots, no brains, no brand marks. Keep the sphere and pillars centered so the subject stays legible when the image is cropped to the middle 60 percent of its width.
```

### Generation

Run from the repository root with `SLOPCAMERA_SOURCE_ROOT` bound to the reviewed build and `artifacts/slopcamera/provider-options.json` holding the reviewed provider options from `editorial/IMAGES.md`:

```sh
vercel env run -- bun "$SLOPCAMERA_SOURCE_ROOT/apps/desktop/dist/cli/main.js" ai image generate \
  --model openai/gpt-image-2 --prompt-file artifacts/slopcamera/prompts/mimo-v2-6-pro-cost-frontier.txt \
  --count 1 --max-per-call 1 --size 1536x864 \
  --provider-options artifacts/slopcamera/provider-options.json --timeout 300s --json
```

Review the original at 1536×864 and in a 384×216 contact sheet beside the nine live figures. Reject accidental text, distorted forms, fake data, a repeated composition, or a subject that disappears in the center crop. Do not retry an ambiguous paid result automatically.

### Registration

1. Copy the accepted WebP to `public/images/blog/mimo-v2-6-pro-cost-frontier.webp` and record `sha256sum` and byte size.
2. Add a row to `BLOG_EDITORIAL_IMAGES` in `app/blog/editorial-images.ts` using the `image(...)` helper: slug `mimo-v2-6-pro-cost-frontier`; alt text describing the visible composition (draft: “A small ivory sphere rests on a low charcoal step beside three tall dark pillars, on a staircase traced by one thin brass line.”); caption “A frontier position is a measured score at a measured cost per task. It is not a ranking of every open model or a verdict on every task.”; the binary SHA-256; the prompt SHA-256 above; and the receipt and job paths the CLI printed.
3. Add the matching entry to `editorial/images.manifest.json` with the same paths, bytes, hashes, the Slopcamera generator block, `"validation": "decode-passed"`, and `"review": "accepted"`.
4. Run `bun test app/blog/blog.test.tsx` and `bun run check`; both must pass before merge.

## Verification

- `bun test lib/mimo-v2-6-pro-frontier.test.ts lib/mimo-v2-6-pro-frontier.property.test.ts` passes: frontier membership equals the absence of a dominating configuration, counts partition the cohort, neighbors are exactly the rows inside the window, and formatters round to one decimal.
- `bun test app/blog/blog.test.tsx` passes once the figure is registered: the rendered note contains every derived score, cost, multiple, and neighbor from the checked snapshot, every quoted claim constant, and no em dash, backtick, “refresh,” or “schema.”
- `bun run check` passes on Node 24 and the pull request merges through the documented delivery path.
- The live page at `https://aicharts.io/blog/mimo-v2-6-pro-cost-frontier` shows the figure, the canonical metadata, JSON-LD image, Atom enclosure, and sitemap entry, and `/blog/mimo-v2-6-pro-cost-frontier` negotiates to Markdown with the figure line.

## Recovery

If the figure cannot be generated, do not stub bytes or hashes and do not loosen the registry type. Leave the pull request open and this plan `blocked`; the note stays unpublished because the slug is only reachable through the checked build.
