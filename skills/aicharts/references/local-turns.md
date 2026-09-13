# Local turn observations

Use this mode only when the user explicitly supplies the paths to an existing private occurrence key and one or more regular Codex JSONL files. Resolve an already-installed, reviewed `aicharts` binary first; the skill does not build or install one.

```sh
aicharts turns --codex /absolute/path/to/session.jsonl \
  --occurrence-key-file /absolute/private/aicharts.key --json
```

Repeat `--codex FILE` for additional explicit files. The command is macOS/Linux-only, rejects directories and implicit discovery, snapshots each file, and rechecks file/key identity before rendering. It does not read or return source paths, keys, native IDs, message text, or wire frames. It never opens the ledger, changes state, or makes a network request.

The JSON is `operation: "turns"`, `access: "read_only"`, `localOnly: true`, `uploaded: false`, `scope: "root_direct"`, and `coverage: "partial"`. Use the UTC-day `completed` and `aborted` cohorts. `averageTurnLength.runtimeMs` is an exact ratio over turns with provider-reported runtime; the nested observed response-token and requested-call subtotals have independent evidence denominators. Complete token totals, dispatched tool calls, population means, human origin, account attribution, pricing, and enumeration completeness remain unknown. A missing value is not zero.

This reader currently has a qualified lifecycle profile only for Codex records. Do not pass Claude files to `turns`, and do not approximate Claude turns by grouping assistant messages or usage records. The ordinary numeric collector supports Claude usage packets separately, but it does not establish turn starts, terminals, or human authorship. Preserve that distinction in any answer.

Treat malformed records, source changes, limit errors, and fixed diagnostics as a failed snapshot. Do not skip a requested file, repair it, or fall back to a broader scan. The command is an observation aid, not a billing statement, productivity proof, leaderboard submission, or upload mechanism.
