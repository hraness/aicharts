# AI Charts

[AI Charts](https://aicharts.io) is an open-source home for sourced, interactive AI benchmark charts. It compares models and agents across performance, cost, speed, and token use without collapsing those trade-offs into one rank.

The homepage starts with a five-role benchmark portfolio spanning terminal engineering, scientific workflows, professional work, computer use, and broad expert reasoning. Checked score views are added source by source; Artificial Analysis Intelligence efficiency and coding-agent results remain separate source-specific comparisons.

## Current benchmark portfolio

The site is a static-data Next.js and TypeScript application. Its benchmark snapshots are committed to the repository, validated at build time, and refreshed automatically. Production never depends on an upstream data source being available during a request.

- Use the official, version-pinned Terminal-Bench 4.0 snapshot as the current coding standard, with exact model, agent, effort, trial, uncertainty, cost, token, duration, and source metadata.
- Keep a checked, version-pinned Terminal-Bench-Science 0.1 owner snapshot—with per-domain results, uncertainty, cost, and token use—separate from GDPval-AA v2, OSWorld 2.0, and Humanity's Last Exam rather than collapsing the families into one composite score.
- Treat CursorBench 3.2 as supplemental closed evidence for the model-plus-Cursor system, not an independently reproducible coding standard.
- Compare Artificial Analysis Intelligence Index v4.1.1 with output-only tokens and cost per Index task in a separate model-level efficiency view.
- Compare Artificial Analysis's AA Index, DeepSWE, Terminal-Bench v2.1, and SWE-Atlas-QnA results.
- Plot each result against cost, duration, or total token use.
- Pin a model to see its nearby performance cohort, or pin a provider to inspect its range.
- Explore the cost/performance Pareto frontier and per-provider score ranges.
- Follow a checked timeline of newly detected models, settings, and material benchmark changes.
- Share the current axes and selection as a link or export a full-resolution PNG.
- Open a profile-specific benchmark card for each model, then share its branded image through the native share sheet, download it, or post its URL from [`/models`](https://aicharts.io/models). Cataloged identities and settings use stable canonical routes; newly observed identities or profile settings use deterministic provisional routes until reviewed. Every curated model carries a checked first-party release date and source shared by all of its profiles.
- Read sourced analysis at [`/blog`](https://aicharts.io/blog), including the current [AA Index versus cost](https://aicharts.io/blog/aa-index-cost-coding-agents) snapshot analysis, [open models on coding-agent benchmarks](https://aicharts.io/blog/open-models-coding-agent-benchmarks), [how cheaper AI models can make everyday products viable](https://aicharts.io/blog/small-models-have-arrived), [Terminal-Bench-Science](https://aicharts.io/blog/terminal-bench-science), and [why a high score still needs a holdout](https://aicharts.io/blog/coding-agent-score-holdouts).
- Inspect the current snapshot, methodology, provenance, full configuration table, and machine-readable distribution at [`/data`](https://aicharts.io/data).

Each checked snapshot records its source, exact version or revision, and retrieval time. The `/data` page links the Artificial Analysis Intelligence, Artificial Analysis coding-agent, Terminal-Bench 4, and Terminal-Bench-Science JSON distributions so people, search engines, and answer engines can verify what the homepage shows. AI Charts is an independent visualization and is not affiliated with the benchmark owners or model providers represented in the data.

## Local development

AI Charts uses [Bun 1.3.14](https://bun.sh/) and Node.js 24.

```sh
bun install --frozen-lockfile
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). Analytics are disabled outside production on `aicharts.io`, so local development does not send PostHog events.

Run the complete local gate before opening a pull request:

```sh
bun run check
```

That validates generated files and the checked data contract, runs strict TypeScript and ESLint, executes example and property tests, and creates a production build.

## Data refresh

The [`data-refresh.yml`](.github/workflows/data-refresh.yml) workflow checks first-party release sources and OpenRouter discovery hourly, off the top of the hour. It refreshes Terminal-Bench 4, Terminal-Bench-Science 0.1, direct DeepSWE evidence, and the lightweight Artificial Analysis Intelligence model snapshot every four hours, then adds the heavier Artificial Analysis coding-agent import to one daily full run at 10:43 UTC. Manual runs can select release-only, benchmark-only, or full refreshes; the legacy `discovery` mode remains a combined non-AAI alias. Poll-metadata-only checks remain visible in Actions without creating a data pull request. It treats every source as a separate failure domain:

1. The registry has 28 lab-owned release sources from 23 active labs: Anthropic, OpenAI, Google DeepMind, Meta, xAI, Mistral AI, Cohere, DeepSeek, Z.ai, Moonshot AI/Kimi, Alibaba/Qwen, MiniMax, ByteDance Seed, Microsoft AI, NVIDIA Nemotron, Amazon Nova, Baidu ERNIE, Tencent Hunyuan, Xiaomi MiMo, AI21 Labs, IBM Granite, Ai2, and StepFun. Conservative URL parsing retains every parsed model in a multi-model release; unknown versioned model-family shapes enter the review queue as unresolved instead of disappearing, while reviewed irregular launches use exact route mappings. New canonical URLs drive discovery. Mutable source timestamps remain secondary evidence, and discovery never writes the reviewed official-date ledger.
2. OpenRouter's public models API supplies a bounded 90-day identity radar and the model-ID catalog used to identify direct benchmark observations. Its listing timestamp is discovery metadata, not a claimed release date.
3. Harbor Framework's official Terminal-Bench leaderboard repository supplies the current 4.0.0 snapshot. The importer pins one immutable commit, asserts the 4.0 leaderboard definition, and rejects duplicate configurations, incomplete trials, score arithmetic errors, version changes, or unsafe row loss.
4. Terminal-Bench-Science's official 0.1 owner API supplies a separate scientific-workflow snapshot pinned to release `v0.1.0`, its immutable commit, and exact Harbor dataset version. The importer retains five-domain results, validates resolution-rate and binomial-error arithmetic, records unpublished protocol fields as null, and preserves aggregate and domain costs without inventing reconciliation.
5. Artificial Analysis's public model-page Flight payload supplies a lightweight model-level Intelligence Index v4.1.1 efficiency snapshot, with the page's public Dataset JSON-LD serving as a source-shape cross-check. It retains weighted output-only token and cost components per Index task, remains separate from the five-role portfolio, and refreshes every four hours.
6. Artificial Analysis supplies the AA Index, DeepSWE, Terminal-Bench v2.1, and SWE-Atlas-QnA observations in the separate coding-agent interactive chart and cards. Terminal-Bench v2.1 remains labeled and separate from 4.0; this heavier import refreshes daily.
7. DataCurve's official DeepSWE v1.1 artifact supplies early harness-specific pass@1 evidence. Ambiguous model matches fail closed, unmatched models remain explicit, and every observation retains its harness, effort, run count, attempts, and source provenance.
8. The first-party and OpenRouter radars are discovery-only, and direct DeepSWE observations are early-evidence-only. Missing values remain missing. None of these sources can invent another source's score, chart point, model card, or official release date.
9. The workflow can atomically update only [`data/first-party-release-radar.json`](data/first-party-release-radar.json), [`data/model-release-radar.json`](data/model-release-radar.json), [`data/terminal-bench.json`](data/terminal-bench.json), [`data/terminal-bench-science.json`](data/terminal-bench-science.json), [`data/artificial-analysis-intelligence.json`](data/artificial-analysis-intelligence.json), [`data/coding-agents.json`](data/coding-agents.json), and [`data/deep-swe-evidence.json`](data/deep-swe-evidence.json). These seven automation-owned snapshots pass the full project check with the same public build key as CI before the workflow opens a dedicated pull request, dispatches required CI on its exact head, and verifies the protected squash merge. Failed sources leave the last-known-good production snapshots in place.
10. Official card dates live in the manually reviewed [`data/model-release-dates.json`](data/model-release-dates.json) ledger, keyed by stable canonical model ID. Marketplace and sitemap timestamps never populate it or appear as official release dates.

The repository keeps default workflow-token permissions read-only and grants write capabilities only inside this workflow. GitHub's repository-level “Allow GitHub Actions to create and approve pull requests” setting must remain enabled so that the scoped token can open its data PR; the workflow never submits reviews. First-party sources refresh independently, so one outage retains that source's last-known-good slice while healthy sources continue. A new candidate updates the durable release-review issue before benchmark refreshes run. Dependency installation is retried, and any unhealthy run creates or updates a separate automation-health issue. Source-shape changes, suspicious data loss, failed required CI, and unmerged update PRs still fail closed for publication, leaving the last-known-good production snapshot in place.

To refresh locally:

```sh
bun run releases:refresh
bun run first-party-releases:refresh
bun run terminal-bench:refresh
bun run terminal-bench-science:refresh
bun run aa-intelligence:refresh
bun run data:refresh
bun run releases:reconcile
bun run deepswe:refresh
bun run check
```

Review the resulting data diff before committing it. The corresponding `*:check` commands are network-free validations of the committed snapshots. `bun run releases:reconcile` updates only OpenRouter radar benchmark statuses from the checked Artificial Analysis snapshot. Official-date and first-party candidate review statuses remain reviewed edits; scheduled discovery preserves them.

## PostHog

PostHog is initialized only in production on the canonical AI Charts domains. The browser configuration is cookieless and privacy constrained:

- no person profiles, persistent identifiers, autocapture, session replay, surveys, heatmaps, or feature flags;
- memory-only persistence, Do Not Track support, masked text and element attributes;
- page-view, page-leave, Core Web Vitals, and typed allowlisted product events only.

Product events cover chart and model-card interaction, delegated public-link clicks, and footer signup requests. They contain controlled enum-like properties, never raw URLs, query strings, hashes, link text, visitor-entered values, or model-level user data. Every event receives a grouped page classification plus a bounded public article or model-card content ID. The complete event and privacy contract lives in [`docs/analytics-instrumentation.md`](docs/analytics-instrumentation.md).

The optional AI Charts mailing list is separate from product use and every
other Hraness audience. Its footer sends the entered email address, the
`aicharts` audience, the form source, and a short-lived Cloudflare Turnstile
proof to Hraness Accounts at `account.hraness.com`. Cloudflare verifies the
anti-abuse proof. Hraness Accounts records dated consent, and Resend sends the
confirmation and subscribed messages from `news.hraness.com`. The address is
not subscribed until its confirmation link is used. Every message includes an
AI Charts-specific unsubscribe link, which does not change subscriptions to
other Hraness products.

The durable positioning, search-intent map, technical invariants, event schema, baseline, and review cadence live in [`docs/seo-strategy.md`](docs/seo-strategy.md). Search Console measures impressions, queries, clicks, click-through rate, and search position. PostHog measures acquisition and qualified engagement after a visitor arrives.

Copy [`.env.example`](.env.example) to `.env.local` to exercise configuration. The public project token and ingest host are safe browser variables. `POSTHOG_API_KEY` is a private build credential used only to upload production source maps; never expose it through a `NEXT_PUBLIC_` variable.

## Deployment

The production site is deployed from `main` with Vercel. The repository-level [`vercel.json`](vercel.json) pins the Bun install and build commands. Configure these environment variables in Vercel:

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_POSTHOG_KEY` | Production, Preview | Public PostHog project token |
| `NEXT_PUBLIC_POSTHOG_HOST` | Production, Preview | Regional PostHog ingest host |
| `NEXT_PUBLIC_HRANESS_MAILING_TURNSTILE_SITEKEY` | Production, Preview | Public hostname-restricted Turnstile widget key for the `aicharts` audience |
| `POSTHOG_API_KEY` | Production | Private key for source-map upload |
| `POSTHOG_PROJECT_ID` | Production | Numeric PostHog project ID |
| `POSTHOG_UI_HOST` | Production | `https://us.posthog.com` or `https://eu.posthog.com` |

Production source maps are uploaded only when all private build settings and Vercel's commit SHA are present, then removed from the deployment output.

## Repository map

- `app/` contains the App Router chart, sourced benchmark notes, metadata, error states, and product styling.
- `components/` contains the interactive chart, model cards, update timeline, linked summaries, sharing, export, and local UI primitives.
- `lib/` contains strict data and model-card boundaries, chart math, deterministic layout, analytics events, and property tests.
- `data/` contains the checked benchmark, discovery radar, official model-release ledger, and model-card catalog snapshots.
- `scripts/` contains the guarded benchmark and release-radar refreshes and deterministic color generator.
- `styles/` contains the portable plain-publication styles used by the benchmark notes.
- `docs/` contains the current search, measurement, and engineering strategy.
- `.github/workflows/` contains CI and daily refresh automation.

## License and data notice

The application code is available under the [MIT License](LICENSE). The repository also contains normalized public facts sourced from [Harbor Framework's Terminal-Bench](https://github.com/harbor-framework/terminal-bench), [Terminal-Bench-Science](https://www.terminal-bench-science.ai/announcement), [Artificial Analysis model](https://artificialanalysis.ai/models) and [coding-agent](https://artificialanalysis.ai/agents/coding-agents/) leaderboards, the [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/get-models), the [DataCurve DeepSWE leaderboard](https://deepswe.datacurve.ai/), and provider-owned release sources. The MIT license does not grant rights to third-party data, names, logos, or trademarks; see [NOTICE.md](NOTICE.md).

## Citation

GitHub can generate a citation from [`CITATION.cff`](CITATION.cff). Cite AI Charts for this software or its visualization method and cite the named benchmark owner for measurements. Cite OpenRouter only for discovery and model-identity metadata, and cite the linked provider source for an official release date. Include the source URL, version, retrieval date, metric, harness, effort, and trial policy when a claim depends on a snapshot.

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and report security issues through the process in [SECURITY.md](SECURITY.md).
