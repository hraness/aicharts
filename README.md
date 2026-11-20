# aicharts

See what the next point of coding score costs, at **[aicharts.io](https://aicharts.io)**.

aicharts compares Anthropic, OpenAI and Google models by benchmark score, reasoning effort and cost. GameBench 2 opens on the home page with curves across tested settings. The benchmark picker also offers Terminal-Bench agent runs and three Epoch AI score views.

## How it works

```
  DuelLab GameBench 2 ────────┐ score and cost per setting
  Terminal-Bench leaderboard ─┤ one agent run per model
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

- [`/`](https://aicharts.io): the explorer. Compare a model with today's lineup or the models available on its release day. Pick the benchmark above the chart.
- [`/models`](https://aicharts.io/models) and `/models/<slug>`: a page per release with its Terminal-Bench run, Epoch AI scores, API prices, frontier stars and links to its comparisons.
- [`/compare`](https://aicharts.io/compare) and `/compare/<newer>-vs-<older>`: a head-to-head page for every two releases that were current at the same time, plus each release against the one it replaced. The reverse order redirects to the canonical page. Pairs with no result in common stay out of search results.
- [`/agents`](https://aicharts.io/agents) and `/agents/<a>-vs-<b>`: Codex, Claude Code and Antigravity CLI compared through the current models' runs inside each.
- [`/api`](https://aicharts.io/api): the free JSON API, [`/api/releases`](https://aicharts.io/api/releases), field by field, with examples, caching and each source's license. It needs no key and any website may call it.
- [`/llms.txt`](https://aicharts.io/llms.txt) and [`/sitemap.xml`](https://aicharts.io/sitemap.xml): entry points for agents and crawlers.

### The chart

| Benchmark | What it measures | Explorer view |
| --- | --- | --- |
| **GameBench 2** *(default)* | Code generation across eight strategy games. Generated players compete against a shared reference field. | 0–100 score against cost per generated program. Each dot is a setting and each line connects a model's settings. |
| **Terminal-Bench** | Coding agents completing real terminal tasks. | Percent of passed trials against cost or output tokens per task. |
| **MirrorCode** | Reimplementing complete software packages against tests. | Best published score and measured effort levels. |
| **GPQA Diamond** | Graduate-level science questions with verifiable answers. | Best published score and measured effort levels. |
| **FrontierMath Tiers 1–3** | Private problems written by expert mathematicians. | Best published score and measured effort levels. |

- **Lineup** *(default)*: current and superseded models, grouped by tier so each lab's models at the same level sit together: Claude Fable, GPT Astra and Gemini Carbon; then Claude Opus, GPT Sol and Gemini Neon; and so on down to each lab's smallest models. Opens in **Live**. The tiers are listed in `lib/lineup.ts`; a new model line takes the tier of the current model nearest to it in output price until it is listed there.
- **Releases**: every model by release date. Opens in **At release**.
- **At release** compares a release with the models out on its launch day; **Live** compares it with today's models.
- **Frontier star** marks a setting where no other point scores higher at the same budget or less and the setting reaches at least 75% of the top frontier score. Explorer stars follow the benchmark, model cohort and lab filter. Model and agent pages show Terminal-Bench stars.
- Each budget chart draws on a fixed scale for its benchmark and budget metric. Switching the model, order, cohort or lab filter keeps the axes in place.

## Where the data comes from

| Source | License | What aicharts takes |
| --- | --- | --- |
| [DuelLab GameBench 2](https://huggingface.co/datasets/DuelLab/gamebench-2-results) | CC BY 4.0 | Ranked effort settings with complete scores and costs across all eight games |
| [Terminal-Bench leaderboard](https://github.com/harbor-framework/terminal-bench/tree/main/leaderboard) | Apache-2.0 | One submitted run per model: trials passed, 95% interval, cost, tokens and minutes per trial, agent and setting |
| [Epoch AI, Capabilities & benchmarking](https://epoch.ai/benchmarks) | CC BY 4.0 | MirrorCode, GPQA Diamond and FrontierMath Tiers 1–3 scores with standard errors, and release dates |
| [LiteLLM model prices](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) | MIT | List API prices per million tokens and the longest input |

- **GameBench 2.** The public release supplies the score and cost for each setting. aicharts matches models and normalizes effort labels. The cost includes repair attempts. Each setting must have complete costs and scored results for all eight games. The API cites the exact DuelLab release used.
- **One Terminal-Bench run per model.** Leaderboard runs attempt all 66 tasks at least five times; errored trials count as failures, and maintainers disqualify trials an LLM judge flags for reward hacking. When a model has several runs, aicharts takes the newest dataset version (4.1 over 4.0), then the lab's own agent, then the newest submission. Cost per task is what the run reported, divided by its trials.
- **Epoch AI scores.** The export provides scores and standard errors. Fallback reruns and Pro modes are left out.
- **Attribution.** Epoch AI, ‘Capabilities & benchmarking’. Published online at epoch.ai. Retrieved from ‘https://epoch.ai/benchmarks’ [online resource]. Terminal-Bench leaderboard submissions, harbor-framework/terminal-bench. LiteLLM model_prices_and_context_window.json, Copyright (c) 2023 Berri AI. Every copy of `/api/releases` carries these in its `sources` list with each license; keep them when you reuse the data.

## Automated updates

[`.github/workflows/refresh.yml`](./.github/workflows/refresh.yml) runs 5× a day on GitHub Actions, timed around US Pacific lab announcement windows. Each run fetches the sources, rebuilds `data/releases.json`, exits without a commit when nothing changed, and validates and merges the update when something did.

## Reference

- `bun run data:refresh`: fetch the sources and write `data/releases.json` when a release, score or price changed. `--from-raw <dir>` reads saved copies instead, and `--force` writes regardless.
- `bun run data:check`: validate `data/releases.json`: schema, ordering, supersession and source records.
- `bun run check`: `data:check`, the TypeScript typecheck, the unit tests and a production build.
- `bun run check:journal:browser`: serve the production build and check the guide, changelog filters, model, comparison, agent and API pages, the API's CORS header, redirects and the site footer in Chromium at phone and desktop widths and with JavaScript off.

Every page is generated from `data/releases.json` at build time, so each data refresh updates them. Pairs and successors come from `lib/catalog.ts`; page copy comes from `lib/copy.ts`. Addresses from the earlier aicharts.io, and the retired effort pages, redirect to their nearest page (`next.config.ts`).

## License

Code: [MIT](./LICENSE). Data: each source's license above.

Read [Introducing aicharts](https://aicharts.io/blog/introducing-aicharts) to read the chart with a worked example. The [changelog](https://aicharts.io/changelog) covers updates to the explorer, website and API.
