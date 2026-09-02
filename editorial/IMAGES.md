# Editorial images

AI Charts article art is a visible part of the benchmark note, not a detached
social card. It should make the article's evidence boundary easier to
recognize without depicting invented benchmark values.

## Visual system

Use warm ivory paper, charcoal ink, cobalt blue, coral red, pale mint, fine
screenprint grain, and crisp modular forms. When an article genuinely benefits
from an image, give it a distinct, center-safe silhouette that remains legible
at 320 px wide.

Do not use text, numbers, axes, fake charts, UI screenshots, model or provider
logos, watermarks, robots, brains, or brand marks. A conceptual banner is not
a data visualization. Quantitative interstitials must be built from checked
data with repository-native chart code.

## Source of truth

`app/blog/editorial-images.ts` is a partial registry of the images that passed
editorial review. A registered image drives the visible article figure, blog
cards, the curated homepage module, Open Graph, Twitter, `BlogPosting.image`,
Atom enclosures, canonical Markdown, and the image sitemap. An article without
a registered image must remain image-free across all of those representations.

Keep the reviewed 1536×864 WebP at `public/images/blog/<slug>.webp`. Alt text
describes the visible composition. The caption explains the editorial
distinction without overstating evidence. Record dimensions, bytes, hashes,
prompt digest, and immutable Atet receipt/job paths in
`editorial/images.manifest.json`.

The focused discovery tests must validate manifest metadata against the typed
registry and the exact binary, and exercise both a registered article and a
real admitted image-free article. Injected `undefined` records are useful unit
checks, but they do not prove that the live corpus remains optional.

## Generation boundary

Use the installed `editorial-image-seo` skill and the repository's linked
Vercel project. Paid calls use the skill's pinned
`@hraness/atet@3.1.2` helper, one image per prompt. Never use a global Atet
checkout, never auto-retry an ambiguous paid result, and never overwrite the
provider artifact. Prompts and receipts stay in ignored `artifacts/atet/`.

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
