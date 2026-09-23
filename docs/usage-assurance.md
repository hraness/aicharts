# Usage correctness and metric contracts

The [implementation plan](../kb/plans/system-assurance-and-usage-analytics.md) maps the whole product to observable invariants, repairs, formal models and release qualification. The checked manifests in `verify/assurance/` are the execution contract:

- `obligations.json` maps each audited finding to its owner, phase, invariant and required regression. Open findings are reported explicitly; a passing inventory check does not mean they are repaired.
- `metrics.json` gives 241 catalog metrics their grain, units, population, aggregation, coverage, correction rule, exactness contract and delivery owner. Each has named acceptance obligations. `planned` metrics are future work, not advertised capabilities; qualification requires passing receipts covering every case, with source hashes, commands, toolchain and positive assertion counts.
- `profiles.json` records the disjoint token partitions. Imported v1 output includes reasoning; detailed v2 output excludes reasoning. Their totals cannot share a formula without an evidenced conversion.
- `capacities.json` binds named limits to actual Rust/TypeScript constants and checks compatible consumers. Known inconsistencies name an open finding; repairing one requires removing its exemption.
- `capabilities.json` accounts for every source selector. An unreviewed adapter is neither fixture-qualified nor live-qualified.
- `surfaces.json` inventories owned SQL schemas and immutable object families. `costs.json` remains the cost registry for all product surfaces; F21 tracks its incomplete coverage.
- `retention.json` freezes future reclamation rules and recovery objectives. It performs no deletion. Existing retained history is preserved, and physical reclamation requires qualified recovery, current authority controls and closed references.

Run `bun run usage:assurance:check` to validate manifest structure, coverage, evidence paths, capacity arithmetic and schema discovery. The check prints open obligations separately. It refuses missing entries and stale exemptions; it is not a theorem prover.

The baseline corpus under `fixtures/usage/assurance/` contains only synthetic observations. Its runners deliberately reproduce known failures in the audited source. Their successful exit means the expected counterexample was reproduced, not that a production invariant passed. Preserve baseline source/binary identity and add separate repaired-code regressions. Never point the corpus at a real usage store or read a contributor's sessions.

The current portable gate includes Rust, local workerd, TypeScript, application and browser checks. The macOS companion, live Keychain, real provider acquisition and production restore each require their separately documented evidence. Do not combine these evidence classes or reuse a receipt from a different tree as a required delivery gate.

The first repair policy rejects conflicting known occurrence owners atomically, preserves unknown-to-known enrichment, and keeps the original ledger intact. Historical ledgers with ambiguous ownership need versioned read-only inspection and export, with mutations and uploads quarantined until an evidenced resolution is available. Their source frames and sender state must remain intact. Omitted selected sources must yield an explicit bounded refusal or incomplete-source diagnostic. A later authority migration needs a separately specified transition; resetting a ledger is never recovery.

Run `bun scripts/assurance-metric-baseline.ts` for the admitted high-cardinality diagnostic workload. The [historical receipt](../fixtures/usage/assurance/performance/admitted-baseline.json) records exact token conservation and measured parser, selector and CSV timings at 8,192 and 65,536 rows. These helper measurements do not qualify browser responsiveness, peak allocation, hosted queries or production SLOs.
