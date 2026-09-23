# Detailed usage reports

The source includes a detailed dashboard at `/usage/details` for UTC trends,
client and model breakdowns, disjoint token categories, known costs, and source
coverage. You can explore synthetic data or open a numeric JSON
report locally. Opening a file does not upload it. Account reads and publishing
have separate activation requirements in [the activation runbook](usage-activation.md).
Source and synthetic browser checks do not establish that this version is deployed
or that a live account or scheduled publisher has been qualified.

## Create a local report

Use the native collector built from this repository. Select an absolute home
directory and the clients whose usage you want to inspect:

```sh
aicharts stats --home "$HOME" --client codex --client claude --client cursor --json > usage-report.json
```

The default period is the last 30 UTC days, including today. Select up to 366 days
with both dates included:

```sh
aicharts stats --home "$HOME" --all --since 2026-09-01 --until 2026-09-19 --json > usage-report.json
aicharts stats --list-clients
```

Open the report with **Open local report**. Use the client, provider, and model
filters to narrow the totals and chart. The breakdown can group rows by client,
provider, or model; select a row name to filter to that group. Select a chart bar
to inspect that day or week. **Download numeric CSV** exports the selected
records with exact integer counts.

The first view prioritizes the selected period, exact total, and trend. Open
**Recorded request duration** or **Daily data** for detailed values, and use
**Source coverage & freshness** to inspect collection status and source timestamps.
On mobile, **Filters** expands the client, provider, model, and token-basis controls.
**Supported clients** lists the complete parser roster and identifies entries
that are not included in the report. Collection status does not change when
you filter the chart; an absent source is not evidence of zero usage.

CSV includes a `time_basis` column. Ordinary dated observations use `observed`.
The latest Warp billing counter uses `refresh_snapshot`; its date records when
the cache was refreshed, not when the spending occurred.

The parser roster follows Tokscale 4.17.0 at commit
`d8fd670a46857e5290e71b10245dc522a344fc17`: 53 primary client families, plus the
Synthetic/Octofriend and 9Router selectors. **All clients** uses disjoint owners;
Gajae-Code already includes its 9Router channel. Copilot CLI, Desktop, and VS Code
share one family. Fugu uses the Codex parser. This roster describes known local
formats, not live verification of every application version or account.

Cursor, Antigravity IDE, Trae, Warp, and Hindsight need current acquired usage
data; MiniMax Code needs captured output. The native refresh and capture commands
are documented in the [scheduled publisher guide](usage-autosubmit.md).
`stats` reads existing stores and does not refresh them. Each live integration
still needs qualification with the selected account and application version.
Keep an existing acquisition job until its replacement has been verified.

## Select a source profile

Every listed client accepts explicit `--source-root` directories. This is useful
for alternate accounts, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, XDG locations, and native
AI Charts caches. These paths are exclusive: ambient environment variables and
default home stores are not added to the selected profile.

```sh
aicharts stats --home "$HOME" --client codex --source-root /absolute/codex-home/sessions --json
aicharts stats --home "$HOME" --client cursor --source-root /absolute/private/cursor-cache --json
```

Select usage-store directories, rather than an alternate home directory. Repeat
`--source-root` for required companion stores, or select their common application
data directory. Companion reads must remain inside those explicit roots. Multiple
copies of a single cumulative database are refused when their ownership is
ambiguous; they are not silently summed. Gajae-Code and 9Router overlap and cannot
be selected together. Default **All clients** includes their disjoint owner once.

A source failure keeps that client incomplete. The collector writes bounded,
fixed error codes to stderr to distinguish unreadable, changing, malformed or
over-limit sources. Numeric JSON remains on stdout and contains no paths or
source content. Resolve the source issue and rescan; do not treat incomplete
output as zero usage or delete retained published history.

Large histories remain bounded: an import admits at most 65,536 files and
128 GiB of source data. Streamed JSONL/NDJSON files may be up to 2 GiB, with a
64 MiB line limit; whole-file JSON reads remain limited to 256 MiB. On supported
macOS filesystems, private temporary clones share unchanged data blocks with
the source. Later source writes cannot alter the captured bytes. Changed
sources still require a complete prefix comparison; truncations and rewrites
refuse. A fallback copy requires space for the file plus a 2 GiB reserve.
Temporary captures are removed after a normal success or handled failure.

Stateful logs replay earlier history to preserve cumulative counters and fork
deduplication. Devin's independent database records can skip responses written
before the requested period. Later writes are still examined because a recorded
duration may place their start within the requested period. The final UTC
window is applied after that timestamp calculation.

## Read the numbers

- **Reported tokens** are token counters recorded by the source. **Estimated
  tokens** are kept separately and do not enter the reported-token leaderboard.
- **Input**, **cache read**, **cache write**, **output**, and **reasoning** are
  disjoint in the report. Output excludes separately identified reasoning.
  Some source formats do not measure every category; a partial breakdown cannot
  prove that a zero bucket had no usage.
- **Records** are source observations. A record can describe a request or a
  session aggregate. It is not necessarily a message, prompt, or human action.
- **Cache reads / whole input** divides cache-read tokens by uncached input,
  cache reads and cache writes together. It is available only when every selected
  record reports complete input categories and that denominator is nonzero.
- **Source tok/s** divides the tokens from timed records by their summed source
  duration. Every timed record must have known tokens and the duration must be
  positive. Concurrent durations may overlap; this is not model decode speed.
- **Reported cost** comes from source data. **Retail estimates** use available
  rates or a source estimate. Neither represents a subscription bill. A known
  zero amount is different from an unavailable amount. The two amounts can cover
  different records; their difference does not establish savings or an overcharge.
- **Unknown** model or provider names have no admitted public identity. Private
  aliases, endpoint names, session titles, prompts, paths, and workspace names
  are excluded from the numeric report.
- **No observations** means the selected scan produced no usage for the period.
  A missing or incomplete source cannot establish zero usage.
  Failed scans retain an incomplete status and must not replace account data.

Warp and Crush can report spending without token counts. Their tokens remain
unavailable. Timing is supplied by the source, may overlap across concurrent
work, and does not measure productivity or elapsed human work time.

When the loaded report contains a Warp billing snapshot, its latest counters
appear separately from period totals. They do not contribute to daily usage,
period spending, or period record totals. The section shows its sync date;
changing the displayed dates does not allocate those counters across days.
A hosted query can omit the snapshot when its sync date is outside the requested
range. Publishing a refreshed snapshot replaces the previous counter instead
of summing both.

Use the [scheduled publisher guide](usage-autosubmit.md) to configure explicit
native refreshes and one publication cycle, then qualify the schedule before
disabling an existing publisher.

The bundled local estimator uses the dated
[models.dev catalog](https://models.dev/api.json) retrieved on 2026-09-19. It
requires an exact admitted provider/model and rates for every nonzero token
category. Unsupported tiers, ambiguous aliases, and missing rates remain
unpriced. Arithmetic uses integer picodollars and rounds each observation once
to microdollars. Historical estimates use this catalog's rates, not historical
invoices. Other imported estimates may use different source rates.

## Coverage and limits

Local reports accept up to 366 days, 64 source entries, 65,536 aggregate rows,
and 32 MiB. Account reads have a smaller 8,192-row and 4 MiB response budget;
choose a shorter period if the server refuses a large range. A refused query
does not return a truncated total.

Imports are read-only and use explicit approved roots. They reject detected
syntax, I/O, path, source-stability, and resource-limit failures for the whole
client. The parser can ignore well-formed records from unknown schema versions,
so a successful parse is not proof of complete coverage. Check the source and
period against an independent report before using it to replace existing
publication.

## Account reports and rankings

With detailed account reads enabled, `/dashboard` loads the accepted account
snapshot. An account that has not published a detailed snapshot keeps its
existing daily overview. Local files and synthetic examples stay separate from
account publication; opening either does not change saved account measurements.

When an account read requires authentication, the dashboard tries to renew the
existing Hraness session once, then repeats the read once. A missing or invalid
session still requires sign-in. Renewal stays within the current request's
deadline and does not repeat a publishing change. Previously loaded account
details are cleared when authentication is required; local reports and examples
remain available.

Private reports are bound to the account identified by the same authenticated
response. A changed identity, suspended/restored page or renewed tab focus
requires a fresh private read. A late reply cannot restore a retired report,
including when the new account has no observations. Only the displayed private
report is retained in memory; there is no previous-range report cache.

CSV exports state the record grain and source-duration basis. Copied summaries
and images state their scope and partial coverage. If a report closes or changes
while its image is being prepared, the old image download is canceled. A failed
replacement keeps the local report available for another export.

The **Hraness account** disclosure on the overview and detailed reports verifies
your current account and shows its full ID for comparison with
`aicharts account --state-dir /absolute/private/state --json` on the collector.
The account check uses a live Hraness read; it does not establish that the
collector has published or that the usage service is available. If the check
fails, retry before comparing accounts.

Use **Sign out** to end the AI Charts browser session, or **Switch account** to
sign out and start a fresh sign-in. A confirmed sign-out clears pending account
reads and remote account displays in the current tab and other tabs that receive
the sign-out notification. Local reports and examples remain available. If
sign-out cannot be confirmed, the interface asks you to retry before switching.

Manage public consent and the public handle from the account overview. The
leaderboard ranks consenting accounts by reported tokens over 30 UTC days and
shows each entry's exact total, record count, coverage dates, and last refresh.
Estimated and unavailable tokens are excluded. It does not publish private
model breakdowns, costs, email addresses, or device identifiers.

The interface distinguishes an empty leaderboard, paused publishing, and a
failed read. A public read failure does not change saved consent. Withdrawal
removes the account from the public index; an already cached public response can
remain visible for up to 60 seconds. These controls still require the live
acceptance checks in the activation runbook before rankings are opened.

## Maintain the public catalog

Download the public models.dev JSON to a local file, then run the explicit
catalog update with its retrieval date:

```sh
bun scripts/usage-catalog.ts --source /absolute/path/models-dev.json --retrieved-at 2026-09-19
```

Review both `data/usage-registry.json` and `data/usage-prices.json`. They retain the
source URL, date, and SHA-256. The command does not download data during builds.
The vendored parser's license, exact source revision, original hashes, and local
changes are recorded in [`vendor/tokscale-core/UPSTREAM.md`](../vendor/tokscale-core/UPSTREAM.md).
