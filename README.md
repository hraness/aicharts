# AI Charts

[AI Charts](https://aicharts.io) is an open-source home for sourced, interactive AI benchmark charts. It compares models and agents across performance, cost, speed, and token use without collapsing those trade-offs into one rank.

The current chart focuses on coding agents. That is the first published comparison in a broader product for AI model and agent benchmarks, not the limit of the AI Charts brand.

## Current chart: coding agents

The site is a static-data Next.js and TypeScript application. Its coding-agent snapshot is committed to the repository, validated at build time, and refreshed automatically every day. Production never depends on the upstream data source being available during a request.

- Compare Artificial Analysis's AA Index, DeepSWE, Terminal-Bench v2.1, and SWE-Atlas-QnA results.
- Plot each result against cost, duration, or total token use.
- Pin a model to see its nearby performance cohort, or pin a provider to inspect its range.
- Explore the cost/performance Pareto frontier and per-provider score ranges.
- Follow a checked timeline of newly detected models, settings, and material benchmark changes.
- Share the current axes and selection as a link or export a full-resolution PNG.
- Open a profile-specific benchmark card for each model, then share its branded image through the native share sheet, download it, or post its URL from [`/models`](https://aicharts.io/models). Cataloged identities and settings use stable canonical routes; newly observed identities or profile settings use deterministic provisional routes until reviewed.
- Read sourced benchmark notes at [`/blog`](https://aicharts.io/blog), including the current [AA Index versus cost](https://aicharts.io/blog/aa-index-cost-coding-agents) snapshot analysis, [open models on coding-agent benchmarks](https://aicharts.io/blog/open-models-coding-agent-benchmarks), [why a catch-up composite is not an open-won headline](https://aicharts.io/blog/are-open-models-catching-up), [why a cheap model can close a bill and still lose the scoreboard](https://aicharts.io/blog/small-models-have-arrived), [why a high score still needs a holdout](https://aicharts.io/blog/coding-agent-score-holdouts), and [why coding-agent scores still need expertise](https://aicharts.io/blog/coding-agent-scores-still-need-expertise).
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

The [`data-refresh.yml`](.github/workflows/data-refresh.yml) workflow runs daily at 10:43 UTC and can also be started manually. It treats benchmark ingestion and release discovery as separate failure domains:

1. Artificial Analysis supplies the comparable AA Index, DeepSWE, Terminal-Bench v2.1, and SWE-Atlas-QnA observations used by the chart and cards. The importer parses the public Next.js Flight payload, reconciles upstream slug changes against stable model semantics, and rejects duplicates, suspicious row loss, and metric-coverage regressions.
2. OpenRouter's public models API supplies a bounded 90-day release radar for the providers already represented by the site. It keeps text-output models with tool support, filters aliases and hosted variants, and records OpenRouter's listing timestamp as discovery metadata—not as a claimed release date.
3. The radar is discovery-only. An unbenchmarked release can appear in the small “Release radar” notice on `/models`, but it cannot acquire a score, chart point, or model card until a comparable Artificial Analysis coding-agent observation exists.
4. The workflow atomically updates only [`data/coding-agents.json`](data/coding-agents.json) and [`data/model-release-radar.json`](data/model-release-radar.json), runs the full project check, opens a dedicated automation pull request, explicitly dispatches required CI on its head commit, waits for that exact run, and verifies the protected squash auto-merge completed. Data-only pull requests are excluded from the redundant `pull_request` CI event because GitHub holds workflows opened by `GITHUB_TOKEN` for manual approval. After exact-head CI succeeds, the trusted publisher records the required GitHub Actions commit status linked to that run because `workflow_dispatch` check runs are not included in the pull request's merge rollup. The publisher never bypasses the repository's protected-branch rules.

The repository keeps default workflow-token permissions read-only and grants write capabilities only inside this workflow. GitHub's repository-level “Allow GitHub Actions to create and approve pull requests” setting must remain enabled so that the scoped token can open its data PR; the workflow never submits reviews. The sources refresh independently, so one outage does not discard a valid update from the other. Dependency installation is retried, and any unhealthy run creates or updates one durable GitHub issue that closes automatically after recovery. Source-shape changes, suspicious data loss, failed required CI, and unmerged update PRs all fail closed, leaving the last-known-good snapshot in production.

To refresh locally:

```sh
bun run data:refresh
bun run releases:refresh
bun run check
```

Review the resulting data diff before committing it. `bun run data:check` and `bun run releases:check` are network-free validations of the committed snapshots. `bun run releases:reconcile` updates only radar benchmark statuses from the checked Artificial Analysis snapshot and is the offline fallback when OpenRouter is temporarily unavailable.

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
- `components/` contains the interactive chart, model cards, update timeline, linked summaries, sharing, export, and local UI primitives.
- `lib/` contains strict data and model-card boundaries, chart math, deterministic layout, analytics events, and property tests.
- `data/` contains the checked benchmark, release-radar, model-card catalog, subsidy-history, and pricing snapshots.
- `scripts/` contains the guarded benchmark and release-radar refreshes, local subsidy collector and publisher, and deterministic color generator.
- `styles/` contains the portable plain-publication styles used by the benchmark notes.
- `docs/` contains the current search, measurement, and engineering strategy.
- `.github/workflows/` contains CI and daily refresh automation.

## License and data notice

The application code is available under the [MIT License](LICENSE). The repository also contains normalized public facts sourced from [Artificial Analysis](https://artificialanalysis.ai/agents/coding-agents/) and the [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/get-models). The MIT license does not grant rights to third-party data, names, logos, or trademarks; see [NOTICE.md](NOTICE.md).

## Citation

GitHub can generate a citation from [`CITATION.cff`](CITATION.cff). Cite AI Charts when referring to this software or its visualization method, Artificial Analysis or the relevant primary benchmark source for measurements, and OpenRouter for release-radar metadata. Include the source URL, retrieval date, selected metrics, and configuration when a claim depends on a particular snapshot.

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and report security issues through the process in [SECURITY.md](SECURITY.md).
