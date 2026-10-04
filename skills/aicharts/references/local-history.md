# Local usage history

Source reviewed on 2026-10-04: `crates/aicharts-cli/src/history.rs`, `src/history/schedule.rs`, `src/mcp.rs` and their tests. Availability in an installed binary depends on its version; check `aicharts history --help` before relying on a command. The skill does not include or install the native executable.

## What exists

- `aicharts history report [--days N | --since YYYY-MM-DD --until YYYY-MM-DD] [--client ID ...] [--json | --csv]` reads the local record only. It scans no session files, writes nothing and contacts no service. `--json` prints the `client-stats-v2` report (the `aicharts stats --json` format); `--csv` prints one line per UTC day, agent, provider, model and token basis with exact integers and empty unknowns.
- `aicharts history status --json` prints `{ok, schema: "aicharts.history-status/1", data}` with `collecting` (`on`, `off`, `outdated`, `not-ours`, `unsupported` or `unknown`), the record's row count and date range, and the last collection's outcome.
- `aicharts mcp` serves the same data to agents over MCP stdio with the read-only tools `usage_summary`, `usage_daily`, `usage_report`, `usage_clients` and `usage_history_status`.
- `aicharts history collect`, `enable` and `disable` change local state. Run them only when the user asks for collection or scheduling. None of them uploads.

## Answering a question

1. Prefer the MCP tools when the host has `aicharts mcp` registered; otherwise run `aicharts history report ... --json` or `--csv` with the period the user named. Default to the last 30 UTC days and say so.
2. If the record is empty (`history status` shows no rows), the MCP tools read session files for that one question and keep nothing; the CLI report prints nothing recorded. Tell the user that `aicharts history enable` keeps a record; do not enable it without their request.
3. Report the period, the agents read and their status. `incomplete` or `not_found` agents may have more usage than shown. Days without rows have no recorded usage, which is not proof of zero.
4. Keep token buckets separate where the question needs them: input, cache read, cache write, output and reasoning are disjoint, and total is their sum. Keep reported costs and estimated costs separate and say which one you cite. A null cost is unknown, never zero. Do not turn token totals into a bill.
5. Keep usage local. Never put usage numbers, agent lists or dates into a web request, a benchmark query, an issue, a commit or an upload unless the user explicitly asks for that destination.

## Drawing a chart

Use `usage_daily` (or `history report --csv`) as the data source:

- Daily trend: one point per `date`, `total` on the y-axis; with `group_by: "client"` draw one line or stacked area per agent.
- Model mix: `usage_summary` with `group_by: "model"`, a sorted horizontal bar chart of `tokens.total`.
- Token composition: stack `input`, `cacheRead`, `cacheWrite`, `output` and `reasoning` per day; label cache reads separately because they often dominate the total.

Write the chart as a self-contained local file (for example an HTML file with inline SVG, or a PNG from a local plotting library already available in the project). Label the period, the time zone (UTC) and the data source (`aicharts history`). Do not load the data into a hosted charting service. For the hosted dashboard view without uploading, the user can open a `--json` report at `https://aicharts.io/usage/details` with **Open local report**; the page reads the file in the browser.
