# aicharts

See what the next point of coding score costs, at **[aicharts.io](https://aicharts.io)**.

aicharts plots every current Anthropic, OpenAI and Google model on one chart: how much of Terminal-Bench its coding agent passed, against what that run cost per task. The models that no other model beats for the money sit on the frontier and earn a star.

## How it works

```
  Terminal-Bench leaderboard ─┐ one agent run per model
  Epoch AI benchmarks ────────┼─▶ refresh-data.ts ─▶ data/releases.json ─▶ aicharts.io
  LiteLLM price list ─────────┘ scores and prices    checked, 5× a day      charts and pages
```

One model in the published data, from [`/api/releases`](https://aicharts.io/api/releases) (abridged):

```json
{
  "slug": "claude-opus-5-5",
  "terminalBench": {
    "version": "4.0", "agent": "Claude Code", "effort": "max",
    "accuracy": 64.85, "trials": 330, "costPerTaskUsd": 14.2989,
    "tokensPerTask": { "total": 24345704, "output": 269135 }, "minutesPerTask": 79.8
  },
  "epoch": [{ "benchmark": "mirrorCode", "effort": "max", "score": 95.6, "stderr": 2.6 }],
  "pricing": { "inputPer1M": 4, "outputPer1M": 20, "cachedInputPer1M": 0.2, "maxInputTokens": 1000000 }
}
```

## Quick start

```bash
bun install
bun run dev
```

## What you can read

- [`/`](https://aicharts.io): the explorer. Models by lineup or release date, each one dot on the chart, with a budget axis of cost per task or output tokens per task.
- [`/models`](https://aicharts.io/models) and `/models/<slug>`: a page per release with its Terminal-Bench run, Epoch AI scores, API prices, frontier stars and links to its comparisons.
- [`/compare`](https://aicharts.io/compare) and `/compare/<newer>-vs-<older>`: a head-to-head page for every two releases that were current at the same time, plus each release against the one it replaced. The reverse order redirects to the canonical page. Pairs with no result in common stay out of search results.
- [`/agents`](https://aicharts.io/agents) and `/agents/<a>-vs-<b>`: Codex, Claude Code and Antigravity CLI compared through the current models' runs inside each.
- [`/llms.txt`](https://aicharts.io/llms.txt), [`/sitemap.xml`](https://aicharts.io/sitemap.xml) and [`/api/releases`](https://aicharts.io/api/releases): entry points for agents and crawlers.

### The chart

- **Lineup** *(default)*: current and superseded models, grouped by tier so each lab's models at the same level sit together: Claude Fable, GPT Astra and Gemini Carbon; then Claude Opus, GPT Sol and Gemini Neon; and so on down to each lab's smallest models. Opens in **Live**. The tiers are listed in `lib/lineup.ts`; a new model line takes the tier of the current model nearest to it in output price until it is listed there.
- **Releases**: every model by release date. Opens in **At release**.
- **At release** compares a release with the models out on its launch day; **Live** compares it with today's models.
- **Frontier star**: a model on the cost frontier, where no other model scores higher for its cost per task or less, and within the top tier (at least 75% of the top frontier score). Stars follow the context and the lab filter. Model pages show both today's star and the release-day star.
- Every chart draws on one scale built from all releases, so switching the model, the order, the context or the lab filter never moves the axes.

## Where the data comes from

| Source | License | What aicharts takes |
| --- | --- | --- |
| [Terminal-Bench leaderboard](https://github.com/harbor-framework/terminal-bench/tree/main/leaderboard) | Apache-2.0 | One submitted run per model: trials passed, 95% interval, cost, tokens and minutes per trial, agent and setting |
| [Epoch AI, Capabilities & benchmarking](https://epoch.ai/benchmarks) | CC BY 4.0 | MirrorCode, GPQA Diamond and FrontierMath Tiers 1–3 scores with standard errors, and release dates |
| [LiteLLM model prices](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) | MIT | List API prices per million tokens and the longest input |

- **One run per model.** Leaderboard runs attempt all 66 tasks at least five times; errored trials count as failures, and maintainers disqualify trials an LLM judge flags for reward hacking. When a model has several runs, aicharts takes the newest dataset version (4.1 over 4.0), then the lab's own agent, then the newest submission. Cost per task is what the run reported, divided by its trials.
- **Epoch AI scores** test the model alone, without an agent. Each setting Epoch ran is kept; pages show the best one and the rest in a table. Fallback reruns and Pro modes are left out.
- **Attribution.** Epoch AI, ‘Capabilities & benchmarking’. Published online at epoch.ai. Retrieved from ‘https://epoch.ai/benchmarks’ [online resource]. Terminal-Bench leaderboard submissions, harbor-framework/terminal-bench. LiteLLM model_prices_and_context_window.json, Copyright (c) 2023 Berri AI. Every copy of `/api/releases` carries these in its `sources` list with each license; keep them when you reuse the data.

## Automated updates

[`.github/workflows/refresh.yml`](./.github/workflows/refresh.yml) runs 5× a day on GitHub Actions, timed around US Pacific lab announcement windows. Each run fetches the three sources, rebuilds `data/releases.json`, exits without a commit when nothing changed, and validates and merges the update when something did.

## Reference

- `bun run data:refresh`: fetch the three sources and write `data/releases.json` when a release, score or price changed. `--from-raw <dir>` reads saved copies instead, and `--force` writes regardless.
- `bun run data:check`: validate `data/releases.json`: schema, ordering, supersession and source records.
- `bun run check`: `data:check`, the TypeScript typecheck, the unit tests and a production build.
- `bun run check:journal:browser`: serve the production build and check the guide, changelog filters, model, comparison and agent pages, redirects and the site footer in Chromium at phone and desktop widths and with JavaScript off.

Every page is generated from `data/releases.json` at build time, so each data refresh updates them. Pairs and successors come from `lib/catalog.ts`; page copy comes from `lib/copy.ts`. Addresses from the earlier aicharts.io, and the retired effort pages, redirect to their nearest page (`next.config.ts`).

## License

Code: [MIT](./LICENSE). Data: each source's license above.

Read [Introducing aicharts](https://aicharts.io/blog/introducing-aicharts) to read the chart with a worked example. The [changelog](https://aicharts.io/changelog) covers updates to the explorer, website and API.
