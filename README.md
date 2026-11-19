# aicharts

Minimal AI coding model release monitor and effort-level Pareto frontier explorer at **[aicharts.io](https://aicharts.io)**.

## Focus

`aicharts` tracks coding and frontier LLM releases across **Anthropic**, **OpenAI**, and **Google**, normalizing every model's thinking/effort curve (`low`, `medium`, `high`, `xhigh`, `max`) onto consistent cost-vs-performance and token-vs-performance Pareto frontiers.

### Benchmarks

- **Coding** *(default)* — Equal-weight composite of **FrontierCode 2.0** (multi-file repository SWE) and **Terminal-Bench 4.0** (autonomous CLI task execution), `0–100%`.
- **Terminal-Bench 4.0** — Autonomous command-line engineering pass rate (`0–100%`), paired with official 330-trial Harbor Terminal-Bench submissions where published.
- **FrontierCode 2.0** — Multi-file software engineering benchmark pass rate (`0–100%`).
- **Intelligence v5.0** — Full 9-evaluation Artificial Analysis Intelligence Index v5.0.1 (`0–100`).

### Comparison Context

- **At release** — Compares the selected release against the frontier of models that were active on its launch date, showing how the release moved the Pareto curve when announced.
- **Live** — Compares the selected release against all currently active models.

## Quick Start

```bash
bun install
bun run dev
```

### Scripts

- `bun run data:refresh` — Pulls the latest public upstream benchmark snapshots, normalizes effort curves, and updates `data/releases.json`.
- `bun run data:check` — Validates `data/releases.json` schema, ordering, and score/cost invariants.
- `bun run check` — Runs `data:check`, TypeScript typecheck, Pareto frontier unit tests, and a production Next.js build.

## Data & Attribution

Benchmark measurements and per-task token/cost accounting are normalized from [Artificial Analysis](https://artificialanalysis.ai/models) (v5.0.1 & Coding Agents) and [Harbor Terminal-Bench](https://tbench.ai). Public JSON feed is served at [`/api/releases`](https://aicharts.io/api/releases).

## License

[MIT](./LICENSE)
