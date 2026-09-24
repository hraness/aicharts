# Checkpoint qualification evidence

The Codex checkpoint remains **unqualified for automatic use**. The current
implementation reduces parser work on stable files, but reopening a persisted
checkpoint and appending 100 rows is slower than an authoritative full scan in
this bounded synthetic workload. `QUALIFICATION.json` retains `unqualified` for
every selector. Autosubmit does not opt into checkpoint collection. The explicit
Codex-only `stats-sync --incremental` path remains an opt-in experiment; ordinary
`stats` performs no persistent writes.

## Workload and decision

The release-mode `aicharts-import` example `checkpoint_bench` creates one local
synthetic Codex JSONL file at 1,000, 10,000 and 50,000 numeric token records. It
compares a full scan, an empty checkpoint, unchanged history, a 100-row append,
and an earlier-prefix correction. Each mode must produce the exact full-scan
numeric observations. Every size has one discarded warm-up and five retained
samples. These are elapsed wall times on macOS arm64 with Rust 1.97.1; they are
observations on a shared development host, not latency guarantees.

The final run used the already built release binary after cooperative handoff
from the other owned compute lanes. The `*-reopen` modes include checkpoint
decode, collection and checkpoint encode CPU work. They exclude descriptor
custody checks for the persisted checkpoint, fsync/rename, CLI report projection
and transport. In-memory modes exclude checkpoint decode. All modes still
inventory and capture sources. The initial rows column excludes the extra 100
rows in append and correction modes.

At 50,000 rows, the source is 16,835,292 bytes; append produces 16,869,192 bytes.
The append path parses 33,900 bytes, while it verifies all 16,869,192 bytes of the
consumed source. The unchanged path parses zero source bytes, but verifies the
complete 16,835,292-byte prefix and reconstructs the numeric result. A correction
reparses the full history. Reopen cost and full result reconstruction erase the
parser savings in this corpus, so lower parsed-byte counts do not qualify the
path as faster.

## Baseline and measured repairs

The original envelope repeatedly serialized retained rows and reread the source
prefix. The first measurements established the regression before optimization.
The subsequent changes memoize the bounded envelope, verify the source prefix in
one pass, retain compact numeric row encodings inside versioned binary frames,
and share immutable decoded row chunks. Each change preserved the complete
cumulative/fork/model state and source witness; the full-scan oracle stayed in
place. The current benchmark also releases comparison outputs promptly rather
than retaining every output for an entire repetition, so comparisons across
historical runs include that harness and host variability.

Original implementation, from the retained historical log:

| Initial rows | Mode | Median ms | Minimum–maximum ms |
| ---: | --- | ---: | ---: |
| 1,000 | `full` | 4.60 | 4.33–12.14 |
| 1,000 | `cold` | 9.24 | 8.80–19.87 |
| 1,000 | `warm` | 11.76 | 7.71–16.05 |
| 1,000 | `append` | 15.71 | 8.36–19.31 |
| 1,000 | `append-full` | 8.70 | 4.70–13.31 |
| 1,000 | `correction` | 13.80 | 10.58–19.35 |
| 1,000 | `correction-full` | 5.13 | 5.00–6.30 |
| 10,000 | `full` | 32.64 | 30.66–34.95 |
| 10,000 | `cold` | 74.62 | 68.39–78.49 |
| 10,000 | `warm` | 65.50 | 57.96–66.43 |
| 10,000 | `append` | 65.64 | 60.34–67.84 |
| 10,000 | `append-full` | 33.10 | 33.08–34.73 |
| 10,000 | `correction` | 89.77 | 83.58–90.98 |
| 10,000 | `correction-full` | 33.00 | 29.89–34.87 |
| 50,000 | `full` | 169.05 | 160.12–198.14 |
| 50,000 | `cold` | 394.98 | 372.20–519.30 |
| 50,000 | `warm` | 347.11 | 322.27–378.56 |
| 50,000 | `append` | 352.26 | 327.70–373.39 |
| 50,000 | `append-full` | 158.93 | 147.14–168.56 |
| 50,000 | `correction` | 441.06 | 422.91–470.74 |
| 50,000 | `correction-full` | 160.73 | 154.42–172.79 |

Current implementation, including fresh-process reopen cost:

| Initial rows | Mode | Median ms | Minimum–maximum ms |
| ---: | --- | ---: | ---: |
| 1,000 | `full` | 31.28 | 19.05–44.40 |
| 1,000 | `cold` | 25.38 | 23.36–47.66 |
| 1,000 | `warm` | 31.14 | 29.30–31.95 |
| 1,000 | `warm-reopen` | 29.94 | 21.54–42.34 |
| 1,000 | `append-full` | 33.92 | 28.80–59.60 |
| 1,000 | `append` | 31.53 | 20.56–48.72 |
| 1,000 | `append-reopen` | 36.56 | 23.73–44.52 |
| 1,000 | `correction-full` | 35.01 | 24.32–45.30 |
| 1,000 | `correction` | 35.52 | 30.00–37.31 |
| 1,000 | `correction-reopen` | 30.69 | 26.56–44.16 |
| 10,000 | `full` | 50.91 | 42.68–67.94 |
| 10,000 | `cold` | 88.37 | 85.36–97.99 |
| 10,000 | `warm` | 46.07 | 43.16–52.70 |
| 10,000 | `warm-reopen` | 64.60 | 53.93–66.19 |
| 10,000 | `append-full` | 56.08 | 53.35–69.73 |
| 10,000 | `append` | 54.65 | 46.96–57.65 |
| 10,000 | `append-reopen` | 77.12 | 69.82–80.42 |
| 10,000 | `correction-full` | 55.88 | 47.45–78.37 |
| 10,000 | `correction` | 87.33 | 82.47–89.34 |
| 10,000 | `correction-reopen` | 106.28 | 99.02–118.00 |
| 50,000 | `full` | 185.40 | 175.69–217.86 |
| 50,000 | `cold` | 350.36 | 317.18–360.24 |
| 50,000 | `warm` | 127.02 | 115.62–144.97 |
| 50,000 | `warm-reopen` | 236.96 | 215.12–247.98 |
| 50,000 | `append-full` | 182.47 | 173.80–186.71 |
| 50,000 | `append` | 202.38 | 182.23–208.67 |
| 50,000 | `append-reopen` | 294.66 | 279.69–305.67 |
| 50,000 | `correction-full` | 182.75 | 167.11–191.90 |
| 50,000 | `correction` | 346.87 | 322.60–366.86 |
| 50,000 | `correction-reopen` | 447.07 | 408.77–510.77 |

The 50,000-row in-memory warm median fell from 347.11 ms in the original run to
127.02 ms in the final run. This is an observed improvement within the stated
harness differences. The current persisted append median is 294.66 ms versus
182.47 ms for its paired full scan; the persisted correction median is 447.07 ms
versus 182.75 ms. These results do not satisfy an append-speed qualification.
No further representation change is justified as an accepted improvement
without another controlled measurement and the same equivalence gates.

## Reproduce and inspect

Run these from the repository root, through the host's required command wrapper
when applicable:

```sh
cargo build --locked --offline --release -p aicharts-import --example checkpoint_bench
target/release/examples/checkpoint_bench
cargo test --locked --offline -p aicharts-import
bun scripts/assurance-adapters.ts
```

The executable prints bounded numeric samples and asserts exact output equality.
The local evidence bundle is
`target/assurance/checkpoint-measurements/measurements.json`. It retains all raw
samples from the original, intermediate and final runs, the log digests, observed
final source/toolchain inputs and final executable digest. Original source
identity was not captured with the first historical measurement; that log is
performance evidence, not a reusable current-tree validation receipt.

- original log: `system-one-vZTjpM/check.log`, SHA-256 `58ac315eff9826302f531d4993b97b8b2febc2ad2770135d9cb5d8ba86999b18`.
- final log: `system-one-SG8GWv/check.log`, SHA-256 `792c6016bd4970c0133ea42a297bf3443d2d5c605cd99fdfa51bd1040f97566d`.

## Correctness and recovery boundaries

The checkpoint envelope binds parser generation, selected profile/range, file
identity, a complete-prefix content hash, cumulative/fork/turn/model state,
fallback indices and retained numeric rows. Copy, replacement, truncation,
rotation or prefix correction forces replay. Failed or partial scans preserve
the last complete checkpoint. Unknown-model prefixes are replayed. The current
codec refuses malformed framing, duplicate entries, extra bytes and incompatible
generation before reuse. A checksum detects corruption; it is not an authenticity
claim. The seeded equivalence fixture uses `0xa1c42026` for 64 bounded operations.

The local checkpoint ceiling is 268,435,456 bytes, 65,536 files and 2,000,000
observations. Retained health is independently capped at 131,072 bytes and 55
selectors. The accepted-DTO maximum fixture occupies 120,400 bytes: all 55 actual
selector names, maximum safe counters and times, all ten codes on failed
lastAttempt, the maximum complete lastGood, publication state, and fixed-width
private hex bindings. Exported one-attempt health stays capped at 65,536 bytes.
Unknown anomaly counts remain null. A new unique private attempt ID distinguishes
even identical same-millisecond observations; publication also binds the full
frozen upload digest. These bindings never appear in health output.

Each store owns a current payload, at most one active or retained staging payload,
and a stable lock. A retained interrupted stage refuses another mutation instead
of accumulating files or deleting recovery evidence. Read-only health inspection
still reads a complete prior/current payload without creating a directory, file
or lock. Explicit recovery of a retained stage remains a Phase 10 obligation.
The byte ceilings bound individual payloads and this managed retention shape;
they are not physical filesystem quotas.

Claude, Cursor and Devin retain authoritative reparsing. Their selected vendor
fixtures qualify named synthetic formats, not incremental behavior. The remaining
selectors are classified as limited in the maintained manifest. No private
provider roots, live provider versions, complete provider schema coverage,
large-account maximum-size latency, memory peak, or all-source incremental
qualification follows from this evidence.
