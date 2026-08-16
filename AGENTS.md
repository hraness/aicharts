# Contents

- `app/` – Next.js App Router comparison chart, sourced benchmark analysis, metadata, error states, and product stylesheet.
- `components/` – interactive scatter chart, update timeline, linked summaries, sharing, export, and UI primitives.
- `lib/` – strict data and update boundaries, chart math, layout, analytics, and property tests.
- `data/` – deterministic checked-in benchmark snapshot.
- `scripts/` – guarded snapshot refresh and generated color workflows.
- `styles/` – portable plain-site and publication styling for the benchmark notes.
- `docs/` – current product search, measurement, and engineering strategy.
- `.github/workflows/` – continuous integration and daily data refresh automation.
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `NOTICE.md` – public project documentation.

# Guidelines

- Keep AI Charts the general product for sourced AI model and agent comparison charts. Describe coding agents as the first published chart, not the limit of the brand or a claim of broader current coverage.
- Treat `https://aicharts.io` as the only canonical public origin. Keep retired `codingchart.com` URLs on matching permanent redirects and follow `docs/seo-strategy.md` for migration, discovery, page roles, internal links, analytics properties, and review cadence.
- Build answer-engine visibility through people-first technical SEO and source-backed, citable content. Keep important copy, provenance, dates, and links in server-rendered or static HTML. Do not add `llms.txt`, duplicate answer pages, keyword variants, or unsupported schema as search shortcuts.
- Keep `/data` and its JSON distribution crawlable, internally linked, and consistent with the checked snapshot. Structured data must describe visible page content. Set sitemap `lastmod` from the latest meaningful content or data change, never from an unchanged refresh attempt or build time.
- Keep individual evidence pages specific to what their sources evaluate. State primary sources, observation dates, configurations, analysis boundaries, and limitations close to the claims they support.
- Keep the public GitHub repository discoverable with an accurate description, canonical homepage, focused topics, a self-contained README, license and data notice, and `CITATION.cff`.
- Keep the current chart a static-data Next.js product with a checked snapshot and no runtime dependency on the upstream benchmark page.
- Treat network, file, URL, and query-string values as `unknown` until an owned schema or predicate narrows them.
- Prefer explicit `Result` values for recoverable domain failures and reserve throwing for invalid checked-in invariants.
- Update `data/coding-agents.json` only through `bun run data:refresh`; preserve duplicate, retention, stable-key, metric-coverage, material-change, and bounded-history guards.
- Regenerate `lib/chart-colors.generated.ts` through the checked iWantHue script. Do not hand-edit generated files.
- Keep pointer, keyboard, focus, and touch behavior equivalent. Preserve semantic landmarks, accessible names, visible focus, and responsive horizontal chart panning.
- Keep analytics cookieless and production-only. Add only allowlisted events with controlled properties; do not send URLs, query strings, free-form text, identities, or persistent identifiers.
- Never expose `POSTHOG_API_KEY`, commit credentials, or provider secrets in browser variables, source, logs, fixtures, or documentation.
- Run narrow tests while iterating and `bun run check` before handoff.
