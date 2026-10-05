# Slopcamera handoff: GPT-6.1 Sol coding-agent note

The article factory, placement helpers, tests, and admission draft are on this
branch. The public slug is not registered. This environment has no Vercel
workspace and no Slopcamera source build, so the paid generate cannot run here.
Do not invent hashes, do not loosen `BLOG_EDITORIAL_IMAGES`, and do not add
`gpt-6-1-sol-coding-agent-index` to `PUBLIC_BLOG_SLUGS` until the reviewed
WebP exists.

## Figure

- Slug: `gpt-6-1-sol-coding-agent-index`
- Size: 1536×864 WebP
- Ground: `#12100f`
- Inks: ivory `#f5f2ed`, raised charcoal `#1d1a18`, one warm key `#d0a77c`
- Silhouette (must stay distinct from Sonnet/Opus/Sol/Grok notes): five ivory
  discs on one low charcoal rail. The fourth disc is the largest. The fifth is
  smaller than the third. No stairs, no two plinths, no two pools, no tall
  block on a long table.
- Forbidden: text, numbers, axes, fake charts, logos, robots, brains, cream
  isometric screenprint.

### Prompt

Save as `artifacts/slopcamera/gpt-6-1-sol-coding-agent-index.prompt.txt`
(ignored):

```
Dark editorial still life, 1536x864, near-charcoal ground #12100f. A single low horizontal charcoal rail holds five matte ivory discs in a calm left-to-right row. The first three discs are small and even. The fourth disc is clearly the largest. The fifth disc is smaller than the third. One thin warm brass edge #d0a77c runs along the rail only. No stairs, no separate plinths, no reflecting pools, no tall block, no text, no numbers, no axes, no charts, no logos, no robots, no brains. Center-safe composition that stays readable after an Open Graph crop. Photographed object, not a diagram.
```

### Copy

- Alt: `Five ivory discs rest on a short charcoal rail; the fourth is the largest, and the fifth is smaller than the third.`
- Caption: `Codex · GPT-6.1 Sol’s highest AA Index is not its max setting, and not every Codex setting sits on the coding-agent cost frontier.`

### Generate (owner box with linked Vercel workspace)

Follow `editorial/IMAGES.md`. Bind `SLOPCAMERA_SOURCE_ROOT` to the reviewed
Slopcamera commit `66b4322030f4de24f4d5b6d0c2515c109259f901` (3.2.5). One paid
call, no retry:

```sh
vercel env run -- bun "$SLOPCAMERA_SOURCE_ROOT/apps/desktop/dist/cli/main.js" ai image generate \
  --model openai/gpt-image-2 --prompt-file artifacts/slopcamera/gpt-6-1-sol-coding-agent-index.prompt.txt \
  --count 1 --max-per-call 1 --size 1536x864 \
  --provider-options artifacts/slopcamera/provider-options.json --timeout 300s --json
```

Keep the receipt and job under ignored `artifacts/slopcamera/`. Review the
original at full size and at 384×216. Reject accidental text or a repeated
silhouette.

## Wiring after the figure exists

1. Copy the reviewed WebP to `public/images/blog/gpt-6-1-sol-coding-agent-index.webp`.
2. Add the slug to `PUBLIC_BLOG_SLUGS` in `lib/public-analytics-routes.ts`.
3. Register `BLOG_EDITORIAL_IMAGES["gpt-6-1-sol-coding-agent-index"]` with the
   real `sha256`, `promptSha256`, receipt path, and `gateway_*.json` job.
4. Add the matching `editorial/images.manifest.json` entry.
5. Import `createGpt61SolArticle` in `app/blog/articles.ts` and append it to
   `blogArticles` / `BLOG_SOURCES` wiring.
6. Copy `GPT_6_1_SOL_ARTICLE_ADMISSION_DRAFT` into `BLOG_ARTICLE_ADMISSIONS`.
7. Change `Gpt61SolArticle.slug` to `BlogSlug` (or drop the draft type).
8. Add reciprocal `relatedSlugs` / `nearestUrls` on
   `gpt-6-sol-coding-agent-index`, `opus-5-5-coding-agent-index`, and
   `grok-4-7-coding-agent-index`.
9. Extend `app/blog/blog.test.tsx` date switch and image/manifest gates.
10. Run `bun run check:changed`.

Do not add this slug to `HOME_EDITORIAL_SLUGS`.
