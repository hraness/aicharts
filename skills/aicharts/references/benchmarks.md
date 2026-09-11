# Public benchmark contract

Verified against AI Charts source and public responses on 2026-09-11. Discover each time; these snapshots can change independently of a skill release.

- Catalog: `GET https://aicharts.io/data/benchmark-atlas.json`.
- Charted cohort: `GET https://aicharts.io/data/benchmark-atlas/{id}`. There is no `.json` suffix after the ID. Get IDs from the catalog, not guessed routes.
- Human guide: `https://aicharts.io/data`; explorer links come from catalog entries.

Catalog schema version 1 has `name`, `description`, `contentModifiedAt`, `comparisonPolicy`, `reuseNotice`, and `entries`. Each entry retains `id`, `name`, `version`, `category`, `question`, `summary`, `source` (`name`, `url`, optional `methodologyUrl`), `measure`, `comparisonRule`, `limitations`, `coverage`, `tags`, and `explorationUrl`. Its `dataset` is either null or metadata containing `url`, `configurationCount`, `score`, `source`, and optional `observedAt`, `evidenceLabel`, `costLabel`. Source-only and watchlist entries have no charted observations. A missing dataset returns 404, not an empty measured leaderboard.

Dataset schema version 1 has `benchmark` (the catalog definition without distribution links) and `dataset`:

- Identity: `benchmarkId`, `version`.
- `score`: `label`, `unit`, `direction` (`higher` or `lower`), optional `minimum`/`maximum`. Never relabel a score as percent unless the unit says so.
- Provenance: `source.name`, `source.url`, `source.retrievedAt`, optional `source.revision`; optional `observedAt` and `evidenceLabel`.
- Interpretation: `configurationLabel`, `comparabilityNote`, optional `costLabel`.
- `points`: `id`, `label`, `model`, `provider`, nullable `harness`/`effort`, finite `score`, nullable `costUsd`, nullable `uncertainty` (`lower`, `upper`, `label`), `sourceUrl`, and optional `details` (`label`, `value` pairs).

Retain missing and null fields. `costUsd: null` means no supplied cost, not free; a numeric zero remains source-reported zero, not evidence that an account can use the model for free. The cost label can describe a full evaluation, per-task basis, or other cohort-specific measure. Uncertainty is source-defined and is not supplied for every point. A revision can be an upstream revision or fingerprint; do not claim cryptographic source authentication from its presence.

AI Charts software is MIT-licensed; third-party measurements and methodology retain their source terms. The JSON distribution does not relicense those measurements. Cite the source and named evaluation version.

## Helper contract

Run from the skill directory with an existing Node.js 22+ runtime:

```sh
node scripts/atlas.mjs catalog [--query "words"] [--offset 0] [--limit 20]
node scripts/atlas.mjs dataset ID [--offset 0] [--limit 20]
node --test scripts/atlas.check.mjs
```

Search uses case-insensitive AND terms over name, version, category, question, summary, measure and tags. It is not sent to the server. `limit` is 1–50. Catalog offsets are 0–255; dataset offsets are 0–2047. Output preserves catalog/source order and complete metadata. `page` explicitly reports matched/total counts and the next offset; a page is not a global ranking. Compare `evidence[].sha256` across pages before combining them. These are hashes of fetched response bytes for consistency, not signatures. `fetchedAt` is helper time, distinct from source retrieval and observation dates.

Cross-response checks cover the benchmark definition, named version, source metadata, score metadata, configuration count and optional observation/evidence/cost labels. The catalog has no dataset-content hash, so these checks cannot prove an atomic two-endpoint snapshot or detect changed points when all catalog metadata stayed identical. Keep the fetched dataset hash as the identity of the evidence actually used.

One command makes one catalog request and, only for a valid charted selection, one dataset request. Each response is at most 2 MiB; the whole command has a 20-second deadline, at most 256 catalog entries and 2,048 points. The helper rejects credentials in source links, redirects, non-JSON, unexpected schema, invalid numbers, duplicate IDs and catalog/dataset mismatches. It does not fetch source links, run content, read files, cache to disk, retry automatically or upload. Errors are fixed codes; response bodies and transport diagnostics are not printed. Bounds deliberately fail closed when the public distribution outgrows the reviewed contract.

The helper is not a sandbox: the agent's runtime, network policies, local installation and ambient process configuration remain outside it. No upstream freshness SLA, scientific validity, model-access or billing guarantee follows from a successful retrieval.
