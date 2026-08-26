# AI Charts

[AI Charts](https://aicharts.io) is an open-source home for sourced, interactive AI benchmark charts. It compares models and agents across performance, cost, speed, and token use without collapsing those trade-offs into one rank.

The current chart focuses on coding agents. That is the first published comparison in a broader product for AI model and agent benchmarks, not the limit of the AI Charts brand.

## Current chart: coding agents

The site is a static-data Next.js and TypeScript application. Its coding-agent snapshot is committed to the repository, validated at build time, and refreshed automatically every day. Production never depends on the upstream data source being available during a request.

- Compare Artificial Analysis's AA Index, DeepSWE, Terminal-Bench 2.0, and SWE-Atlas-QnA results.
- Plot each result against cost, duration, or total token use.
- Pin a model to see its nearby performance cohort, or pin a provider to inspect its range.
- Explore the cost/performance Pareto frontier and per-provider score ranges.
- Follow a checked timeline of newly detected models, settings, and material benchmark changes.
- Share the current axes and selection as a link or export a full-resolution PNG.
- Read sourced benchmark notes at [`/blog`](https://aicharts.io/blog), including the current [AA Index versus cost](https://aicharts.io/blog/aa-index-cost-coding-agents) snapshot analysis.
- Inspect the current snapshot, methodology, provenance, full configuration table, and machine-readable distribution at [`/data`](https://aicharts.io/data).

The checked snapshot records its source URL, retrieval time, and material update history. The `/data` page exposes the same checked facts and links to a JSON distribution so people, search engines, and answer engines can verify what the chart shows. AI Charts is an independent visualization and is not affiliated with Artificial Analysis or the model providers represented in the data.

## GPT subsidy history

[`/gpt-subsidy`](https://aicharts.io/gpt-subsidy) tracks the measured API-retail-equivalent value of one user’s available local Codex logs. Each daily point covers seven complete UTC days. The collector globally deduplicates parent, child-agent, active, and archived session events, values each recorded model with the checked [`gpt-subsidy-pricing.json`](data/gpt-subsidy-pricing.json) rate manifest, and publishes only aggregate token and dollar totals. The checked [`gpt-subsidy-measurement.json`](data/gpt-subsidy-measurement.json) manifest pins the parser, adapter, updater, and rolling-window constants so a methodology change cannot silently mix unlike historical points.

This is a personal usage trace, not a platform-wide estimate or a representative sample of ChatGPT Pro usage. Historical logs span account switches without durable account attribution. The public history therefore leaves the subscription-adjusted multiple null instead of dividing all usage by one $200 subscription. It does not publish a monthly projection or one-plan normalization. API-key or otherwise API-billed usage, purchased credits, free resets, and temporary promotions still cannot be separated. The page keeps those limits beside the chart and publishes the calculation and source links in static HTML.

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

The [`data-refresh.yml`](.github/workflows/data-refresh.yml) workflow runs daily at 10:43 UTC and can also be started manually. It:

1. downloads the public Artificial Analysis coding-agent page;
2. parses its Next.js Flight payload into the owned schema;
3. rejects duplicate records, large row-count drops, low stable-key overlap, and major metric-coverage regressions;
4. records new models, new settings, and benchmark changes of at least half a point in a bounded 48-event history;
5. atomically updates only [`data/coding-agents.json`](data/coding-agents.json);
6. runs the full project check before committing the new snapshot to `main`.

That commit triggers the normal Vercel production deployment. A source-shape change or suspicious data loss fails closed and leaves the published snapshot untouched.

To refresh locally:

```sh
bun run data:refresh
bun run check
```

Review the resulting data diff before committing it. `bun run data:check` is network-free and only validates the committed snapshot.

## PostHog

PostHog is initialized only in production on the canonical AI Charts domains. The browser configuration is cookieless and privacy constrained:

- no person profiles, persistent identifiers, autocapture, session replay, surveys, heatmaps, or feature flags;
- memory-only persistence, Do Not Track support, masked text and element attributes;
- page-view, page-leave, Core Web Vitals, and four explicit product event families only.

The product events are `chart metric selected`, `chart selection pinned`, `chart shared`, and `content chart opened`. They contain controlled enum-like properties, never chart URLs, query strings, free-form text, or model-level user data. Every event also receives a bounded page classification so acquisition and engagement can be compared without storing article slugs or query strings.

The durable positioning, search-intent map, technical invariants, event schema, baseline, and review cadence live in [`docs/seo-strategy.md`](docs/seo-strategy.md). Search Console measures impressions, queries, clicks, click-through rate, and search position. PostHog measures acquisition and qualified engagement after a visitor arrives.

Copy [`.env.example`](.env.example) to `.env.local` to exercise configuration. The public project token and ingest host are safe browser variables. `POSTHOG_API_KEY` is a private build credential used only to upload production source maps; never expose it through a `NEXT_PUBLIC_` variable.

## Deployment

The production site is deployed from `main` with Vercel. The repository-level [`vercel.json`](vercel.json) pins the Bun install and build commands. Configure these environment variables in Vercel:

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_POSTHOG_KEY` | Production, Preview | Public PostHog project token |
| `NEXT_PUBLIC_POSTHOG_HOST` | Production, Preview | Regional PostHog ingest host |
| `POSTHOG_API_KEY` | Production | Private key for source-map upload |
| `POSTHOG_PROJECT_ID` | Production | Numeric PostHog project ID |
| `POSTHOG_UI_HOST` | Production | `https://us.posthog.com` or `https://eu.posthog.com` |

Production source maps are uploaded only when all private build settings and Vercel's commit SHA are present, then removed from the deployment output.

## Repository map

- `app/` contains the App Router chart, sourced benchmark notes, metadata, error states, and product styling.
- `components/` contains the interactive chart, update timeline, linked summaries, sharing, export, and local UI primitives.
- `lib/` contains strict data and update boundaries, chart math, deterministic layout, analytics events, and property tests.
- `data/` contains the checked benchmark, subsidy-history, and pricing snapshots.
- `scripts/` contains the guarded benchmark refresh, local subsidy collector and publisher, and deterministic color generator.
- `styles/` contains the portable plain-publication styles used by the benchmark notes.
- `docs/` contains the current search, measurement, and engineering strategy.
- `.github/workflows/` contains CI and daily refresh automation.

## License and data notice

The application code is available under the [MIT License](LICENSE). The repository also contains a normalized snapshot of facts sourced from [Artificial Analysis](https://artificialanalysis.ai/agents/coding-agents/). The MIT license does not grant rights to third-party data, names, logos, or trademarks; see [NOTICE.md](NOTICE.md).

## Citation

GitHub can generate a citation from [`CITATION.cff`](CITATION.cff). Cite AI Charts when referring to this software or its visualization method, and cite Artificial Analysis or the relevant primary benchmark source for the underlying measurements. Include the source URL, retrieval date, selected metrics, and configuration when a claim depends on a particular snapshot.

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and report security issues through the process in [SECURITY.md](SECURITY.md).
