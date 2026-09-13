# Local turn observations

Interpret an explicitly supplied numeric turn summary as supplied evidence; this needs no file paths, keys, or CLI invocation and does not establish a fresh snapshot.

For a fresh snapshot, require authorization and explicitly selected paths to an existing private occurrence key and one or more regular Codex JSONL files. Resolve an already-installed `aicharts` binary with reviewed provenance and confirm `turns --help` supports the syntax below; source availability alone is not an installed capability. The skill does not build or install the CLI. Pass paths as individual arguments and keep key bytes inside the native command, never in agent tools or a prompt.

```sh
aicharts turns --codex /absolute/path/to/session.jsonl \
  --occurrence-key-file /absolute/private/aicharts.key --json
```

Repeat `--codex FILE` for additional explicit files. The command is macOS/Linux-only, rejects directories and implicit discovery, bounds reads to captured file lengths, and rechecks file/key metadata before rendering. It reads the selected key and JSONL bytes, extracting lifecycle and usage metadata while discarding unselected fields. Its output contains no source paths, key bytes, native IDs, message text, or wire frames. It never opens the ledger, persists measurements, or makes a network request. These metadata checks are not an atomic snapshot or a defense against a hostile same-user process; reads can update access times. Sharing numeric output in this task is a separate disclosure, not an offline guarantee.

The JSON is `operation: "turns"`, `access: "read_only"`, `localOnly: true`, `uploaded: false`, `scope: "root_direct"`, and `coverage: "partial"`. Use the UTC-day `completed` and `aborted` cohorts. `averageTurnLength.runtimeMs` is an exact ratio over turns with provider-reported runtime; the nested observed response-token and requested-call subtotals have independent evidence denominators. Complete token totals, dispatched tool calls, population means, human origin, account attribution, pricing, and enumeration completeness remain unknown. A missing value is not zero.

Preserve decimal-string sums and ratio numerators with exact integer arithmetic. Combine disjoint sums and their eligible counts before division; never average daily or file averages. Requested calls do not establish dispatch or success. A completed terminal can include an error and is not proof of task success.

This reader currently implements a Codex-only lifecycle profile, covered by synthetic compatibility tests rather than universal provider-version qualification. Do not pass Claude files to `turns`, and do not approximate Claude turns by grouping assistant messages or usage records. The ordinary numeric collector supports Claude usage packets separately, but it does not establish turn starts, terminals, or human authorship. Preserve that distinction in any answer.

A nonzero exit, malformed or partial JSON, completed malformed records, observed source changes, or a limit failure means no successful snapshot. Fixed `diagnostics` in a successful response instead describe its partial coverage; preserve them when interpreting the measurements. A deferred non-newline-terminated tail can accompany a successful partial summary. Do not skip a requested file, repair it, or fall back to a broader scan. The command is an observation aid, not a billing statement, productivity proof, leaderboard submission, or upload mechanism. Do not send its output, paths, or key material to benchmark endpoints or other services.
