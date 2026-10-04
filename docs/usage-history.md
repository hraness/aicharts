# Usage history and agent queries

aicharts can keep a daily record of your coding agents' token use on your
computer. It reads the same session files as `aicharts stats`, keeps one row
per day, agent, provider and model, and sends nothing anywhere. Your agents can
read the record through a read-only MCP server, so you can ask one for a chart
of your usage without uploading it.

## Turn it on

```sh
aicharts history enable
```

`aicharts setup` with no options does the same. On macOS this adds a login item
named `io.aicharts.history`, and macOS shows "Background Items Added" once. On
Linux it adds a systemd user timer named `aicharts-history.timer`. Either one
runs `aicharts history collect --scheduled` every six hours. The first run starts
right away and reads up to 366 days from the session files your agents still
keep; later runs re-read the last 7 days. A run takes seconds on most
computers. With years of large session files it can take several minutes, and
it runs at low priority so it stays out of your way.

```sh
aicharts history status     # whether collection runs, what the record holds
aicharts history disable    # stop collecting; the record stays
```

Disabling removes only the login item or timer that aicharts wrote. The record
stays in `~/.aicharts/history` until you delete that folder yourself.

## What the record keeps

Each row covers one UTC day, agent, provider, model and token basis. It holds
input, cache read, cache write, output and reasoning tokens, the number of
records, costs the agent reported, cost estimates from public prices, and
request time where the agent records it. Unknown costs stay unknown, never zero.
The record holds no prompts, file paths, project names, session IDs or account
details.

A day in the record never goes down. When an agent deletes or rotates old
session files, the record keeps the larger count it saw before, so your history
outlasts the agent's own files. When a later read sees more, the record takes
the new count.

The record is one file, `~/.aicharts/history/usage-history.json`, readable only
by you (`$AICHARTS_HOME/history` when `AICHARTS_HOME` is set). A busy
workstation adds a few thousand rows a year. At 131,072 rows collection stops
adding rows instead of dropping old days.

## See your usage

```sh
aicharts history report                         # last 30 days, per agent
aicharts history report --days 7 --client claude
aicharts history report --since 2026-09-01 --until 2026-09-30 --json > september.json
aicharts history report --days 90 --csv > usage.csv
```

`--json` prints the same report format as `aicharts stats --json`. Open that
file on [the detailed usage dashboard](https://aicharts.io/usage/details) with
**Open local report**; the page reads it in your browser and doesn't upload it.
`--csv` prints one line per day, agent, provider and model with exact integer
counts, and leaves unknown costs empty.

A report reads only the record. It never scans session files. Run
`aicharts history collect` to update the record now.

## Let your agents read it

`aicharts mcp` is a [Model Context Protocol](https://modelcontextprotocol.io)
server on standard input and output. Every tool is read-only.

| Tool | Answers |
| --- | --- |
| `usage_summary` | Totals for a period by agent, model or provider, with known costs |
| `usage_daily` | Token use per day, optionally split by agent, model or provider |
| `usage_report` | Every row as JSON in the dashboard format, or as CSV |
| `usage_clients` | The agents aicharts reads and the ones the record holds |
| `usage_history_status` | Whether scheduled collection runs and when it last ran |

Register it once with each agent you use:

```sh
claude mcp add aicharts -- aicharts mcp
devin mcp add -s user aicharts -- aicharts mcp
```

For Codex, add it to `~/.codex/config.toml`:

```toml
[mcp_servers.aicharts]
command = "aicharts"
args = ["mcp"]
```

Then ask in your own words, for example:

- "Chart my token use per day for the last 30 days, one line per agent."
- "Which model used the most output tokens this month, and what did it cost?"
- "Save my September usage as a CSV."

The tools answer from the record. Before the first collection they read the
session files for that one question and keep nothing. A request with
`fresh: true` combines the record with a new read in memory, and also keeps
nothing.

## Publishing is separate

Nothing in this guide sends data off your computer. Publishing daily totals to
an aicharts account, for the hosted dashboard and the leaderboard, is a
separate step that you choose: see `aicharts help publish` and
[scheduled publication](usage-autosubmit.md).

## Limits

- The record reads the same sources as `aicharts stats`, so the same parser
  limits apply. See [detailed usage reports](usage-details.md).
- Scheduled collection needs launchd on macOS or a systemd user session on Linux.
  Elsewhere, `aicharts history enable` says so, and `aicharts history collect`
  updates the record when you run it.
- An agent whose files could not be read completely shows as incomplete. A
  failed or partial read never lowers the record.
- Because days never go down, a parser fix that lowers a past count does not
  lower the record. To rebuild from the files that still exist, move
  `~/.aicharts/history` aside and run `aicharts history collect`. Days whose
  files are gone do not come back.
