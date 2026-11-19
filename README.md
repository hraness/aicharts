# aicharts

Minimal AI coding model release monitor and effort-level Pareto frontier explorer at **[aicharts.io](https://aicharts.io)**.

## Focus

`aicharts` tracks coding and frontier LLM releases across **Anthropic** (orange), **OpenAI** (blue), and **Google** (green), normalizing every model's thinking/effort curve (`Low` → `Max`) onto consistent cost-vs-performance and token-vs-performance Pareto frontiers.

### Benchmarks

- **Coding** *(default)* — Equal-weight composite of **FrontierCode 2.0** (multi-file repository SWE) and **Terminal-Bench 4.0** (autonomous CLI task execution), `0–100%`.
- **Terminal-Bench** — Autonomous command-line engineering pass rate (`0–100%`), paired with official 330-trial Harbor Terminal-Bench submissions where published.
- **FrontierCode** — Multi-file software engineering benchmark pass rate (`0–100%`).
- **Intelligence** — Full 9-evaluation Artificial Analysis Intelligence Index v5.0.1 (`0–100`).

### Comparison Context & Frontier Badge

- **At release** — Compares the selected release against the frontier of models active on its launch date, showing how the release moved the Pareto curve when announced.
- **Live** — Compares the selected release against all currently active models.
- **✦ Frontier** — Awarded only to releases that sit on the current **live** Pareto frontier within the upper capability tier (`>= 75%` of peak frontier score).

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
- `bun run check` — Runs `data:check`, TypeScript typecheck, Pareto & refresh unit tests, and a production Next.js build.

## Data & Attribution

Benchmark measurements and per-task token/cost accounting are normalized from [Artificial Analysis](https://artificialanalysis.ai/models) (v5.0.1 & Coding Agents) and [Harbor Terminal-Bench](https://tbench.ai). Public JSON feed is served at [`/api/releases`](https://aicharts.io/api/releases).

## License

[MIT](./LICENSE)

Read [Introducing aicharts](https://aicharts.io/blog/introducing-aicharts) to try an effort comparison. The [changelog](https://aicharts.io/changelog) covers updates to the explorer, website and API.
