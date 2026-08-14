# AI Charts

[AI Charts](https://aicharts.io) is an interactive AI coding benchmark comparing models and agents across performance, API cost, task time, and token use. It puts those trade-offs on one chart so you can inspect the option space instead of relying on a single leaderboard.

The site is a static-data Next.js and TypeScript application. Its benchmark snapshot is committed to the repository, validated at build time, and refreshed automatically every day. Production never depends on the upstream data source being available during a request.

## What the chart shows

- Compare Artificial Analysis's AA Index, DeepSWE, Terminal-Bench 2.0, and SWE-Atlas-QnA results.
- Plot each result against cost, duration, or total token use.
- Pin a model to see its nearby performance cohort, or pin a provider to inspect its range.
- Explore the cost/performance Pareto frontier and per-provider score ranges.
- Follow a checked timeline of newly detected models, settings, and material benchmark changes.
- Share the current axes and selection as a link or export a full-resolution PNG.
- Read sourced benchmark notes at [`/blog`](https://aicharts.io/blog).

The checked snapshot records its source URL and retrieval time. AI Charts is an independent visualization and is not affiliated with Artificial Analysis or the model providers represented in the data.

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
- page-view, page-leave, Core Web Vitals, and three explicit product event families only.

The product events are `chart metric selected`, `chart selection pinned`, and `chart shared`. They contain controlled enum-like properties, never chart URLs, query strings, free-form text, or model-level user data.

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
- `data/` contains the checked production snapshot.
- `scripts/` contains the guarded data refresh and deterministic color generator.
- `styles/` contains the portable plain-publication styles used by the benchmark notes.
- `.github/workflows/` contains CI and daily refresh automation.

## License and data notice

The application code is available under the [MIT License](LICENSE). The repository also contains a normalized snapshot of facts sourced from [Artificial Analysis](https://artificialanalysis.ai/agents/coding-agents/). The MIT license does not grant rights to third-party data, names, logos, or trademarks; see [NOTICE.md](NOTICE.md).

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and report security issues through the process in [SECURITY.md](SECURITY.md).
