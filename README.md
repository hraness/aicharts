# aicharts

Minimal AI coding model release monitor and effort-level Pareto frontier explorer at **[aicharts.io](https://aicharts.io)**.

## Focus

`aicharts` tracks coding and frontier LLM releases across **Anthropic** (orange), **OpenAI** (blue), and **Google** (green), normalizing every model's thinking/effort curve (`Low` → `Max`) onto consistent cost-vs-performance and token-vs-performance Pareto frontiers.

### Benchmarks

- **Coding** *(default)* — Equal-weight composite of **FrontierCode 2.0** (multi-file repository SWE) and **Terminal-Bench 4.0** (autonomous CLI task execution), `0–100%`.
- **Terminal-Bench** — Autonomous command-line engineering pass rate (`0–100%`), paired with official 330-trial Harbor Terminal-Bench submissions where published.
- **FrontierCode** — Multi-file software engineering benchmark pass rate (`0–100%`).
- **Intelligence** — Full 9-evaluation Artificial Analysis Intelligence Index v5.0.1 (`0–100`).

### Model list

- **Lineup** *(default)* — Current and superseded models, each grouped by tier so each lab's models at the same level sit together: Claude Fable, GPT Astra and Gemini Carbon; then Claude Opus, GPT Sol and Gemini Neon; and so on down to each lab's smallest models. Opens in **Live**. The tiers are listed in `lib/lineup.ts`; a new model line takes the tier of the current model nearest to it in output price until it is listed there.
- **Releases** — Every model by release date. Opens in **At release**.
- Every chart draws on one scale built from all releases, so switching the model, the order, the comparison context or the lab filter never moves the axes. The coding agent pages share one scale across the three agents.

### Comparison Context & Frontier Stars

- **At release** — Compares the selected release against the frontier of models active on its launch date, showing how the release moved the Pareto curve when announced.
- **Live** — Compares the selected release against all currently active models.
- **✦ Frontier stars** — One star for each effort setting on the cost Pareto frontier within the upper capability tier (`>= 75%` of peak frontier score). A release on the frontier at Medium, High and Max shows three stars. Stars follow the context: in **At release** each release is measured against the models out on its own release day, in **Live** against today's models, and both respect the lab filter. A release's stars in the feed always match the stars in its effort table. Model pages show both counts.

## Pages

- [`/`](https://aicharts.io) — The explorer: models by lineup or release date, effort curves and frontier stars.
- [`/models`](https://aicharts.io/models) and `/models/<slug>` — A page per release with scores, cost per task and output tokens at every effort setting, frontier stars by benchmark, results inside the lab's own coding agent, pricing and links to its comparisons.
- [`/compare`](https://aicharts.io/compare) and `/compare/<newer>-vs-<older>` — A head-to-head page for every two releases that were current at the same time, plus each release against the one it replaced. The reverse order redirects to the canonical page.
- [`/effort`](https://aicharts.io/effort) and `/effort/<higher>-vs-<lower>` — What each step up in effort adds and costs, model by model. A step gets a page once three releases are measured at both settings.
- [`/llms.txt`](https://aicharts.io/llms.txt), [`/sitemap.xml`](https://aicharts.io/sitemap.xml) and [`/api/releases`](https://aicharts.io/api/releases) — Entry points for agents and crawlers.

Every page is generated from `data/releases.json` at build time, so each data refresh updates them. Pairs, successors and effort steps come from `lib/catalog.ts`; page copy comes from `lib/copy.ts`. Addresses from the earlier aicharts.io redirect to their nearest page (`next.config.ts`).

## Automated Updates

[`.github/workflows/refresh.yml`](./.github/workflows/refresh.yml) runs **5× daily** on GitHub Actions (free on public repos), timed around US Pacific AI lab announcement and benchmark update windows. Each run re-fetches both newly launched models and updated/regraded benchmark scores on existing releases, exits in ~15s with zero commits when unchanged, and validates + merges updates automatically when changes are detected.

## Quick Start

```bash
bun install
bun run dev
```

### Scripts

- `bun run data:refresh` — Pulls the latest public upstream benchmark snapshots, normalizes effort curves, and updates `data/releases.json` only when releases or scores change.
- `bun run data:check` — Validates `data/releases.json` schema, ordering, and score/cost invariants.
- `bun run check` — Runs `data:check`, TypeScript typecheck, Pareto, catalog & refresh unit tests, and a production Next.js build.
- `bun run check:journal:browser` — Serves the production build and checks the guide, changelog filters, model, comparison and effort pages, redirects and the site footer in Chromium at phone and desktop widths and with JavaScript off.

## Data & Attribution

Benchmark measurements and per-task token/cost accounting are normalized from [Artificial Analysis](https://artificialanalysis.ai/models) (v5.0.1 & Coding Agents) and [Harbor Terminal-Bench](https://tbench.ai). Public JSON feed is served at [`/api/releases`](https://aicharts.io/api/releases).

## License

[MIT](./LICENSE)

Read [Introducing aicharts](https://aicharts.io/blog/introducing-aicharts) to try an effort comparison. The [changelog](https://aicharts.io/changelog) covers updates to the explorer, website and API.
