# Editorial images

AI Charts article art is a visible part of the benchmark note, not a detached
social card. It should make the article's evidence boundary easier to
recognize without depicting invented benchmark values.

## Visual system

Use a near-charcoal ground that matches the dark AI Charts theme (`#12100f`),
not cream or ivory paper. Keep the palette monochrome or duotone. Allowed
inks are the site’s dark-theme tokens only: warm ivory foreground (`#f5f2ed`),
raised charcoal (`#1d1a18`), the warm key (`#d0a77c`), and the cool highlight
(`#8fb0ff`). Give each image one accent at most. Prefer fewer, larger forms
and a calm composition that stays readable after a center-safe Open Graph crop.

When an article genuinely benefits from an image, give it a distinct silhouette
that remains legible at 320 px wide. The picture should make the article’s
evidence boundary easier to recognize. It is not a data plot and must not
depict invented scores.

Do not use text, numbers, axes, fake charts, UI screenshots, model or provider
logos, watermarks, robots, brains, or brand marks. Do not reuse the retired
cream isometric screenprint (cobalt, coral, and mint on warm paper).
Quantitative interstitials must be built from checked data with
repository-native chart code.

## Source of truth

`app/blog/editorial-images.ts` is a partial registry of the images that passed
editorial review. A registered image drives the visible article figure, blog
cards, the curated homepage module, Open Graph, Twitter, `BlogPosting.image`,
Atom enclosures, canonical Markdown, and the image sitemap. An article without
a registered image must remain image-free across all of those representations.

Keep the reviewed 1536×864 WebP at `public/images/blog/<slug>.webp`. Alt text
describes the visible composition. The caption explains the editorial
distinction without overstating evidence. Record dimensions, bytes, hashes,
prompt digest, and immutable generator receipt/job paths in
`editorial/images.manifest.json`.

The focused discovery tests must validate manifest metadata against the typed
registry and the exact binary. A registered image is optional per article.
When the live corpus still has an admitted image-free article, exercise that
route. When every live article is registered, prove the image-free path with
injected `undefined` records so rendering, Open Graph, Atom, sitemap, and
Markdown stay optional.

## Generation boundary

For new images, build Slopcamera from its [source-install guide](https://github.com/hraness/slopcamera/blob/main/docs/how-to/use-current-source.md) and retain the reviewed 40-character commit. Keep `SLOPCAMERA_SOURCE_ROOT` bound to that unchanged build, then run from this repository's linked Vercel workspace. Preserve the reviewed OpenAI settings by saving this non-secret JSON as `artifacts/slopcamera/provider-options.json`:

```json
{"openai":{"quality":"medium","outputFormat":"webp","outputCompression":88}}
```

```sh
vercel env run -- bun "$SLOPCAMERA_SOURCE_ROOT/apps/desktop/dist/cli/main.js" ai image generate \
  --model openai/gpt-image-2 --prompt-file <prompt-file> \
  --count 1 --max-per-call 1 --size 1536x864 \
  --provider-options artifacts/slopcamera/provider-options.json --timeout 300s --json
```

Vercel injects credentials only into that child. Do not use a global binary, automatically retry an ambiguous paid result, or overwrite a provider artifact. Keep new prompts and receipts in ignored `artifacts/slopcamera/`.

Existing credits, manifest generator `@hraness/atet@3.1.2`, and `artifacts/atet/` receipt paths describe the retired cream isometric batch. Live registered masters use Slopcamera at the reviewed source commit, with per-image package, version, receipt, and job paths. Do not insert new output under the historical Atet generator declaration.

Review each original at full size and together in a 384×216 contact sheet.
Reject accidental text, distorted forms, fake data, repeated compositions,
unintended logos, or a subject that disappears in a social crop.

## Interstitial gate

The site's checked charts, tables, and interactive explorers already explain
its numeric claims. Add an interstitial only when it clarifies a real process,
comparison, or evidence artifact that those components do not cover. Prefer a
code-native, sourced chart for numbers. Do not add decorative image breaks.

## Release check

Run `bun run check`, then inspect the homepage, blog index, and one article at
desktop and mobile widths. Confirm the visible image, canonical metadata,
JSON-LD, Atom enclosure, sitemap, canonical Markdown, and public image response
all agree.
