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
- Admit a new indexable article only when its authored record scores reader utility, original evidence, factual confidence, host fit, voice integrity, and maintenance value from 0–2, totals at least 9, has no zero, and names a reader task not already answered by an existing route, the primary or first-party evidence it adds, a net-new conclusion, why AI Charts is the right publisher, the closest overlapping URLs with distinctions, the merge or rejection rationale, evidence owner and type, source-check date, review provenance, lifecycle state, harm if wrong, and reassessment date. Compare the proposed headings and claims with every current article; consolidate or reject the page when roughly a third overlaps. A source summary plus a product analogy is not enough, and a Hraness reading digest is not independent corroboration of the source it summarizes. Disclose agent-assisted authorship in visible article text and structured data; never imply human review that did not occur.
- Keep internal links selective: link the primary source and at most the few pages a reader actually needs, never every sibling. Generate editorial imagery only after the copy passes the admission and overlap review. Homepage editorial modules are curated, capped at three cards, and must not preload below-fold card images.
- Keep `/data` and its JSON distribution crawlable, internally linked, and consistent with the checked snapshot. Structured data must describe visible page content. Set sitemap `lastmod` from the latest meaningful content or data change, never from an unchanged refresh attempt or build time.
- Keep individual evidence pages specific to what their sources evaluate. State primary sources, observation dates, configurations, analysis boundaries, and limitations close to the claims they support.
- Follow `editorial/IMAGES.md` for article banners, thumbnails, social images, image discovery, Atet generation, and interstitial decisions. `app/blog/editorial-images.ts` is an intentionally partial registry of accepted images, not an article quota. When a record exists, every visible and discovery surface, including canonical Markdown, must derive from it; when it does not, each surface remains image-free. Keep one admitted live image-free route in parity tests, and validate the manifest, registry, and binary together. Use one paid pinned-Atet call per prompt, never auto-retry an ambiguous result, and keep prompts and receipts in ignored `artifacts/atet/`.
- Keep the public GitHub repository discoverable with an accurate description, canonical homepage, focused topics, a self-contained README, license and data notice, and `CITATION.cff`.
- Keep the current chart a static-data Next.js product with a checked snapshot and no runtime dependency on the upstream benchmark page.
- Treat network, file, URL, and query-string values as `unknown` until an owned schema or predicate narrows them.
- Prefer explicit `Result` values for recoverable domain failures and reserve throwing for invalid checked-in invariants.
- Update `data/coding-agents.json` only through `bun run data:refresh`; preserve duplicate, retention, stable-key, metric-coverage, material-change, and bounded-history guards.
- Regenerate `lib/chart-colors.generated.ts` through the checked iWantHue script. Do not hand-edit generated files.
- Keep pointer, keyboard, focus, and touch behavior equivalent. Preserve semantic landmarks, accessible names, visible focus, and responsive horizontal chart panning.
- Give every ordinary themed page exactly one shared icon-menu appearance control as the final action in its header. Do not put appearance controls in footers, content, or fallback action rows.
- Keep analytics cookieless and production-only, and follow `docs/analytics-instrumentation.md`. Route capture through the typed `lib/analytics.ts` allowlist; do not import PostHog from feature code or send raw URLs, query strings, hashes, referrer paths, free-form text, visitor identities, or persistent identifiers. Bounded public content, provider, benchmark, model, profile, and source IDs are allowed.
- Bind the shared footer to the `aicharts` audience, require the checked public Turnstile widget key, and keep newsletter consent separate from product use and every other Hraness audience.
- Never expose `POSTHOG_API_KEY`, commit credentials, or provider secrets in browser variables, source, logs, fixtures, or documentation.
- Run narrow tests while iterating and `bun run check` before handoff.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- hra-local-efficiency:start -->
- Treat the user's request to change this repository as standing authorization for routine task-owned commits, pushes, pull requests, merges, releases, deployments, and production verification after the repository's required validation, review, identity, and rollout gates pass. Do not ask for another confirmation at each delivery step.
- Use the repository's documented delivery workflow and preserve every runtime-enforced approval, branch protection, environment rule, safety policy, and final gate. Ask for user input only when delivery needs a material product decision, missing credentials or authority, an irreversibly destructive action outside task scope, or resolution of a release failure that cannot be handled safely and autonomously.
- Prefer short-lived repository workload identities such as OIDC trusted publishing, GitHub Apps, and narrowly scoped machine identities. Do not add long-lived personal tokens, weaken two-factor authentication, or bypass provider controls to eliminate an interactive prompt. Batch unavoidable human-gated production promotions into intentional stable releases while agents publish validated prerelease or beta channels through workload identities when the repository supports them.
- Preserve useful reasoning fan-out, but avoid unnecessary checkout fan-out. Prefer subagents in the current task for bounded research, review, diagnosis, and focused checks when they can safely share one working tree; create a separate task or worktree only for independently deliverable divergent edits, an isolated verification tree, or a different execution environment.
- Give each expensive focused validation command and external wait one owner. The integration owner reviews that evidence and runs the repository-required aggregate or final gate once after convergence. Reuse evidence only for the exact Git tree, command, lockfiles, toolchain, relevant environment, and validity period, and never to skip a required final integration, merge, release, deployment, or production-verification gate.
- On Hraness development machines, use `$hra-local-efficiency` and the installed host scheduler for heavyweight top-level commands when available. Keep ordinary work in the compute lane; give authenticated browser/dev-server/Chromium work one `browser-auth` owner and Mac-only validation one `mac-native` owner.
- When a CI or policy gate scans complete Git history, check out the exact governed SHA and fetch only the fully qualified governed refs before scanning. Preserve the complete-history gate and reject unexpected refs instead of importing unrelated concurrent heads.
- At closeout, record applicable branch, PR, check, merge, release, deployment, and production evidence. Archive only conclusively finished tasks, never from silence alone, and reclaim only freshly revalidated clean merged worktrees through the guarded exact-path flow.
<!-- hra-local-efficiency:end -->
