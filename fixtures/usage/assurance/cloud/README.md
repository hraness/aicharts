# Historical cloud and formula counterexamples

This synthetic corpus preserves seven failures audited at
`a5bec6415ce640a61495db57bc9c2ce83fb83021` on 23 September 2026. The fixtures
contain invented identities, timestamps, occurrence populations and numeric
measurements. They never read user history, credentials, production storage or
network services.

Run from the repository root:

```sh
bun scripts/assurance-cloud-baseline.ts
bun scripts/assurance-cloud-baseline.ts --require-invariants
```

The first command exits **0 only when the expected historical counterexamples
match**. Its receipt explicitly reports `productionInvariantStatus:
"known-failures"`. The second command exits **1** for the same baseline because
the desired properties fail. Neither mode certifies production invariants.
Unexpected source bytes, rejected fixtures, exceptions or changed results also
exit 1. Output is deterministic JSONL without wall-clock timings, current dates
or workstation paths; runtime versions are included for attribution.

The runner resolves files from its own location, not the current working
directory. To rerun the original evidence after product repairs, supply a local
trusted checkout of the governed source:

```sh
bun scripts/assurance-cloud-baseline.ts --source-root /path/to/governed-checkout
```

`baseline.json` pins the governed SHA and SHA-256 of 17 files: the imported
production source/data dependencies, formula source and alias-resolution
configuration. The selected
checkout must match those bytes before the runner imports its domain classes.
The receipt attributes this dependency slice, not an arbitrary checkout's
entire tree. The script does not fetch or create a checkout. Do not refresh
these fingerprints or expected failures to make repaired code pass. Keep this
historical lane and add repair regressions against the new implementation.

Ordinary `bun test` validates the corpus metadata without requiring current
production code to preserve a failure. Runtime replay and its negative controls
are explicitly invoked against a selected, fingerprint-qualified baseline:

```sh
bun scripts/assurance-cloud-baseline.ts --source-bundle target/assurance-baseline/cloud-source
AICHARTS_CLOUD_BASELINE_SOURCE_BUNDLE=target/assurance-baseline/cloud-source bun test ./fixtures/usage/assurance/cloud/baseline.check.ts
```

The implementation workspace retains that source slice in the ignored target
directory. Every original relative path has a `.source` suffix, including
`tsconfig.json.source`, so application source discovery cannot ingest old
TypeScript. Bundle replay verifies all fingerprints before copying only those
17 known paths into a newly created OS temporary directory. It imports the
verified code there and removes that exact scratch directory in a `finally`
block. Production dependencies in this slice are relative modules and Bun/Node
built-ins; no install, symlink or network dependency is needed.

Recreate a bundle on a clean machine by reading every `sourceSha256` path from
the governed Git commit into an empty local directory at `<path>.source`.
Verify the fingerprints using the runner before use. A full checkout also
works with `--source-root`; select only one source option. Missing or changed
source is an error, never a skipped replay. The receipt's `sourceSetSha256`
hashes the ordered UTF-8 lines `<original-path>\t<sha256>\n` from `baseline.json`.
Individual file hashes remain in that fixture. The retained directory is
disposable synthetic verification input, not user data or product storage.

The frozen source-set SHA-256 is
`334826e6a5762c20620eddce8332d56bb5667217b729bb607dcae5e4286c1088`.

| Finding | Executed specimen | Historical failure and intended repair property |
| --- | --- | --- |
| F02 | Actual admission codecs, AdmissionState and StatsState on fresh Bun SQLite | A distinct legacy B record contributes 120 tokens; detailed A contributes 15. Hosted replacement returns 15 instead of 135 although legacy evidence remains. Only a proven-owned population may be replaced. |
| F09 | Actual StatsState publication, revocation and replacement check | Revocation retains the writer slot; a different enrolled device gets `writer_conflict`. Add account-authorized ownership transfer that retains history and fences old work. Enrollment alone is not transfer authorization. |
| F10 | Actual private-day and stats-status parsers at 99,999 / 100,000 / 100,001 | The last sample fits head, per-day, journal and byte limits, yet old 100,000-record parser caps reject it. This checks representations with tiny payloads, not maximum-capacity storage performance. |
| F11 | Actual reserve/supersede state transitions A → B → A | Earlier A returns at unchanged revision and sequence and charges reservation bytes again. Supersession must have a durable generation and idempotent charge identity. Delayed authentication/network ordering is source-traced, not executed here. |
| F12 | Actual private and leaderboard reads with synthetic missing derived rows | Both issue persistent DELETE/INSERT statements. Warm private read is a zero-write control. Backfill needs an explicit mutation owner and reads need a pure fallback. |
| F15 | Actual row parser, totals helper and AST-extracted UI initializers | Input=0, cache read=100, cache write=900 yields 100% rather than the complete whole-input 10%. Zero-input and no-cache-write controls exercise the formula boundary. |
| F16 | Actual row parser, totals helper and AST-extracted UI initializers | Reported $1 and estimated $3 describe different observations but yield a $2 difference. The matched-cohort comparison is unknown. An absent-estimate control remains unknown. |

Each database scenario is isolated and closes its in-memory database even on
failure. The adapter converts Bun SQLite byte arrays to the ArrayBuffer values
the domain classes receive in workerd. It supplies synchronous SQL operations;
it does not simulate Durable Object scheduling, enclosing transactions, R2,
restore fences, cryptographic authentication or real provider behavior.

The formula checks execute the exact `inputSide`, `cacheShare` and `costDelta`
initializers parsed from the fingerprinted `StatsReportView` source. They do
not render React or qualify a browser journey. The independent whole-input
oracle uses the fixture's complete disjoint categories. The two cost records
and two device observations are explicitly distinct in the synthetic ground
truth; device identity alone must never become a production deduplication rule.

The runner's narrow TypeScript domain ports are harness interfaces. They are
not an implementation refinement proof. Production parsers validate every
numeric upload/row specimen; source fingerprints bind the dynamic runtime
imports. Future formal/runtime conformance tests must close the scheduling,
transaction and provider gaps separately.
