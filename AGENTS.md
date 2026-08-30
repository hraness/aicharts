<!-- kb:context scopes/repository--cdb4ee2aea69 -->
# Contents

- `app/` – Next.js App Router comparison chart, sourced benchmark analysis, metadata, error states, product stylesheet, and fail-closed product-scoped mailing footer configuration.
- `components/` – interactive scatter chart, update timeline, linked summaries, sharing, export, and UI primitives.
- `lib/` – strict data and update boundaries, chart math, layout, analytics, and property tests.
- `data/` – deterministic checked-in benchmark snapshot.
- `scripts/` – guarded snapshot refresh and generated color workflows.
- `styles/` – portable plain-site and publication styling for the benchmark notes.
- `docs/` – current product search, measurement, and engineering strategy.
- `.agents/skills/` – reusable cross-repository KB and phased-execution workflows.
- `kb/` – authored repository rationale, evidence, synthesis, and plans.
- `WRITING.md` and `STYLE.md` – internal and public prose contracts.
- `.github/workflows/` – continuous integration and daily data refresh automation.
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `NOTICE.md` – public project documentation.

# Guidelines

- Follow `WRITING.md` for internal prose and `STYLE.md` for public prose.
- Apply unreasonably robust programming when agent work is cheap. Model invalid states out of existence and pair readable regression examples with property tests for general laws.
- Deliver changes to protected `main` through task-owned pull requests. Autonomously carry every task-owned pull request through required reviews and checks, merge only after every gate passes, and verify the documented production deployment without asking for renewed confirmation. Preserve unrelated work, never bypass a gate, and stop only for missing authority or credentials, a material product decision, or a failed gate that cannot be resolved safely. Repository-owned bounded automation may keep its documented delivery path. Never force-push.
- Pin Hraness dependencies to reviewed immutable releases or full commits. Never connect repositories with sibling paths, Git submodules, or coordinated `main` assumptions.
- Use immutable `@hraness/web-discovery` exports for generic metadata, JSON-LD serialization, and social-image rendering, and `@hraness/vercel-delivery` for the generic Vercel proof and Preview response contract. Keep chart semantics, public copy, redirects, and analytics policy product-owned.
- Extract a shared package only after two concrete consumers need the same stable interface. Keep shared packages product-neutral.
- Use a shared design kit or `@hraness/ui` only for stable, portable primitives and tokens at an immutable version. Keep chart geometry, evidence presentation, page composition, and the local visual contract product-owned.
- Keep Nebula Sans from the immutable design-kit release as the ordinary proportional face across the chart, publication, exports, and social images. Preserve the explicit monospace role for code and compact benchmark data.
- Freeze shared interfaces before parallel lanes begin. Give checked data, generated colors, manifests, lockfiles, and other convergence surfaces one owner while lanes edit disjoint paths.
- Keep mandatory rules in the closest `AGENTS.md`, current procedures in `docs/`, executable contracts in types and tests, and pull-based rationale, evidence, synthesis, and plans in `kb/`.
- Keep AI Charts the general product for sourced AI model and agent comparison charts. Describe coding agents as the first published chart, not the limit of the brand or a claim of broader current coverage.
- Treat `https://aicharts.io` as the only canonical public origin. Keep retired `codingchart.com` URLs on matching permanent redirects and follow `docs/seo-strategy.md` for migration, discovery, page roles, internal links, analytics properties, and review cadence.
- Treat Production as the only durable Vercel environment. Pull requests may use Vercel's built-in disposable Preview target, but do not create a custom environment, persistent Preview domain, provider-authoritative Preview branch, or separate Preview backend.
- Build answer-engine visibility through people-first technical SEO and source-backed, citable content. Make every public article self-contained for a first-time reader, cite primary sources directly, define necessary terms, and organize the explanation around one reader question. Keep repository structures, data plumbing, editorial reasoning, citation mechanics, and search strategy out of public copy. Keep important copy, provenance, dates, and links in server-rendered or static HTML. Do not add `llms.txt`, duplicate answer pages, keyword variants, or unsupported schema as search shortcuts. A truthful `/llms.txt` agent guide may describe existing public pages and Markdown negotiation.
- Keep `/data` and its JSON distribution crawlable, internally linked, and consistent with the checked snapshot. Structured data must describe visible page content. Set sitemap `lastmod` from the latest meaningful content or data change, never from an unchanged refresh attempt or build time.
- Keep individual evidence pages specific to what their sources evaluate. State primary sources, observation dates, configurations, analysis boundaries, and limitations close to the claims they support.
- Follow `editorial/IMAGES.md` for article banners, thumbnails, social images, image discovery, Atet generation, and interstitial decisions. Keep `app/blog/editorial-images.ts` exhaustive with `BLOG_SLUGS`; every visible and discovery surface must derive from that registry. Use one paid pinned-Atet call per prompt, never auto-retry an ambiguous result, and keep prompts and receipts in ignored `artifacts/atet/`.
- Keep the public GitHub repository discoverable with an accurate description, canonical homepage, focused topics, a self-contained README, license and data notice, and `CITATION.cff`.
- Keep the current chart a static-data Next.js product with a checked snapshot and no runtime dependency on the upstream benchmark page.
- Treat network, file, URL, and query-string values as `unknown` until an owned schema or predicate narrows them.
- Prefer explicit `Result` values for recoverable domain failures and reserve throwing for invalid checked-in invariants.
- Update `data/coding-agents.json` only through `bun run data:refresh`; preserve duplicate, retention, stable-key, metric-coverage, material-change, and bounded-history guards.
- Regenerate `lib/chart-colors.generated.ts` through the checked iWantHue script. Do not hand-edit generated files.
- Keep pointer, keyboard, focus, and touch behavior equivalent. Preserve semantic landmarks, accessible names, visible focus, and responsive horizontal chart panning.
- Give every ordinary themed page exactly one shared icon-menu appearance control as the final action in its header. Do not put appearance controls in footers, content, or fallback action rows.
- Keep analytics cookieless and production-only. Add only allowlisted events with controlled properties; do not send URLs, query strings, free-form text, identities, or persistent identifiers.
- Bind the shared footer to the `aicharts` audience, require the checked public Turnstile widget key, and keep newsletter consent separate from product use and every other Hraness audience.
- Never expose `POSTHOG_API_KEY`, commit credentials, or provider secrets in browser variables, source, logs, fixtures, or documentation.
- Run narrow tests while iterating and `bun run check` before handoff.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
