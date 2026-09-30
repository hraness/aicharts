import { BrowserFrame, SampleText, TerminalFrame, type TerminalLine } from "@hraness/design-kit/mockups";

import { statsTokenTotal } from "@/lib/usage/stats-contract";
import { createUsageStatsExample } from "@/lib/usage/stats-example";

import {
  LIBRARY_CATEGORY_LABELS,
  LIBRARY_COVERAGE_LABELS,
  LIBRARY_ENTRIES,
} from "./data";

type Themed = Readonly<{ theme?: "light" | "dark" }>;

function themeProps(theme: Themed["theme"]) {
  return theme === undefined ? {} : { theme };
}

/* ------------------------------------------------------------------ */
/* Benchmarks library                                                  */
/* ------------------------------------------------------------------ */

/** Categories in the order the library lists them, with how many entries each holds. */
function libraryCategories() {
  const counts = new Map<string, number>();
  for (const entry of LIBRARY_ENTRIES) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  return [...counts.entries()];
}

/** One entry of each coverage level, so the card grid shows all three labels. */
function libraryCards() {
  const picks = [
    LIBRARY_ENTRIES.find((entry) => entry.coverage === "charted" && entry.category === "coding"),
    LIBRARY_ENTRIES.find((entry) => entry.coverage === "charted" && entry.category === "reasoning"),
    LIBRARY_ENTRIES.find((entry) => entry.coverage === "source-only"),
    LIBRARY_ENTRIES.find((entry) => entry.coverage === "watchlist"),
  ];
  return picks.filter((entry) => entry !== undefined);
}

export function LibraryMockup({ theme }: Themed) {
  return (
    <BrowserFrame
      {...themeProps(theme)}
      className="acm"
      describe="Illustration of the aicharts benchmarks library: topics down the side, and entries tagged charted, source guide or emerging."
      url="aicharts.example/benchmarks"
    >
      <div className="acm-library">
        <ul aria-hidden="true" className="acm-library__topics">
          {libraryCategories().map(([category, count], index) => (
            <li data-acm-active={index === 0 ? "" : undefined} key={category}>
              <span>{LIBRARY_CATEGORY_LABELS[category] ?? category}</span>
              <b>{count}</b>
            </li>
          ))}
        </ul>
        <div aria-hidden="true" className="acm-library__cards">
          {libraryCards().map((entry) => (
            <article className="acm-card" data-acm-coverage={entry.coverage} key={entry.id}>
              <span className="acm-badge">{LIBRARY_COVERAGE_LABELS[entry.coverage]}</span>
              <strong>{entry.name}</strong>
              <p>{entry.question}</p>
              <small>{entry.source.name} · v{entry.version}</small>
            </article>
          ))}
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Data page entry                                                      */
/* ------------------------------------------------------------------ */

export function DataEntryMockup({ theme }: Themed) {
  const entry = LIBRARY_ENTRIES.find((candidate) => candidate.coverage === "charted" && candidate.category === "coding") ?? LIBRARY_ENTRIES[0];
  if (entry === undefined) throw new Error("The benchmarks library is empty.");
  const rows: readonly (readonly [string, string])[] = [
    ["Question", entry.question],
    ["Measures", entry.measure],
    ["Source", entry.source.name],
    ["Version", entry.version],
    ["Compare", entry.comparisonRule],
    ["Limits", entry.limitations[0] ?? ""],
  ];
  return (
    <BrowserFrame
      {...themeProps(theme)}
      className="acm"
      describe="Illustration of one entry on the aicharts data page: the question it answers, what it measures, source, version, valid comparisons and limits."
      url="aicharts.example/data"
    >
      <div aria-hidden="true" className="acm-entry">
        <div className="acm-entry__head">
          <span className="acm-badge" data-acm-coverage={entry.coverage}>{LIBRARY_COVERAGE_LABELS[entry.coverage]}</span>
          <strong>{entry.name}</strong>
          <span className="acm-entry__download">JSON ↓</span>
        </div>
        <dl>
          {rows.map(([term, value]) => (
            <div key={term}><dt>{term}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      </div>
    </BrowserFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Usage dashboard                                                      */
/* ------------------------------------------------------------------ */

/** A fixed day, so the made-up report renders the same everywhere. */
const EXAMPLE_TODAY_UTC_DAY = Math.floor(Date.UTC(2026, 8, 29) / 86_400_000);
const EXAMPLE_DAYS = 14;

const CLIENT_LABELS: Readonly<Record<string, string>> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  "devin-cli": "Devin",
  freebuff: "Freebuff",
  warp: "Warp",
};

/**
 * Daily totals per client from the site's own synthetic stats example (the
 * report /usage/details renders as its sample). Every figure is made up.
 */
export function usageExample() {
  const report = createUsageStatsExample(EXAMPLE_TODAY_UTC_DAY);
  const clients = [...new Set(report.rows.map((row) => row.client))];
  const days = Array.from({ length: EXAMPLE_DAYS }, (_, index) => EXAMPLE_TODAY_UTC_DAY - EXAMPLE_DAYS + 1 + index);
  const byDay = days.map((day) => {
    const perClient = new Map<string, number>();
    for (const row of report.rows) {
      if (row.utcDay !== day) continue;
      perClient.set(row.client, (perClient.get(row.client) ?? 0) + Number(statsTokenTotal(row.tokens)));
    }
    return { day, perClient };
  });
  const total = byDay.reduce((sum, { perClient }) => sum + [...perClient.values()].reduce((a, b) => a + b, 0), 0);
  const models = new Set(report.rows.filter((row) => days.includes(row.utcDay)).map((row) => row.model)).size;
  return { byDay, clients, total, models };
}

function short(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return String(Math.round(value));
}

export function UsageMockup({ theme }: Themed) {
  const { byDay, clients, models, total } = usageExample();
  const peak = Math.max(1, ...byDay.map(({ perClient }) => [...perClient.values()].reduce((a, b) => a + b, 0)));
  const barWidth = 640 / byDay.length;
  return (
    <BrowserFrame
      {...themeProps(theme)}
      className="acm"
      describe="Illustration of the aicharts usage dashboard with made-up numbers: tokens per day for two weeks, stacked by coding agent, with totals."
      url="aicharts.example/dashboard"
    >
      <div aria-hidden="true" className="acm-usage">
        <div className="acm-usage__stats">
          <div><span>Tokens, 14 days</span><strong>{short(total)}</strong></div>
          <div><span>Agents</span><strong>{clients.length}</strong></div>
          <div><span>Models</span><strong>{models}</strong></div>
        </div>
        <svg className="acm-usage__bars" viewBox="0 0 660 220">
          {byDay.map(({ day, perClient }, index) => {
            let y = 200;
            return (
              <g key={day}>
                {clients.map((client, slot) => {
                  const value = perClient.get(client) ?? 0;
                  const height = (value / peak) * 180;
                  y -= height;
                  return height <= 0 ? null : (
                    <rect data-acm-series={slot % 6} height={height} key={client} rx={2} width={barWidth - 8} x={10 + index * barWidth} y={y} />
                  );
                })}
              </g>
            );
          })}
          <line className="acm-grid" x1={6} x2={654} y1={200.5} y2={200.5} />
        </svg>
        <ul className="acm-legend">
          {clients.map((client, slot) => (
            <li data-acm-series={slot % 6} key={client}><i /><SampleText>{CLIENT_LABELS[client] ?? client}</SampleText></li>
          ))}
        </ul>
      </div>
    </BrowserFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Collector in a terminal                                              */
/* ------------------------------------------------------------------ */

/** Commands exactly as /usage prints them. */
export const COLLECTOR_REPORT_COMMAND = 'aicharts stats --home "$HOME" --all --json > usage-report.json';
export const COLLECTOR_ENROLL_COMMAND = 'aicharts enroll --state-dir "$HOME/.aicharts/state"';

const COLLECTOR_LINES: readonly TerminalLine[] = [
  { kind: "comment", text: "A local report: a file on your machine, opened in your browser", beat: "local" },
  { kind: "input", text: COLLECTOR_REPORT_COMMAND, beat: "local" },
  { kind: "comment", text: "Optional sync on a Mac: approve once in the browser", beat: "sync" },
  { kind: "input", text: COLLECTOR_ENROLL_COMMAND, beat: "sync" },
  { kind: "comment", text: "Sent: daily token, cost and time totals per agent and model", beat: "sent" },
  { kind: "comment", text: "Stays on your machine: prompts, transcripts, file paths, keys", beat: "sent" },
];

export function CollectorMockup({ theme }: Themed) {
  return (
    <TerminalFrame
      {...themeProps(theme)}
      className="acm acm-terminal"
      describe="Illustration of a terminal: the aicharts collector writes a local report file, then, only if you enroll a Mac for sync, sends daily number totals."
      lines={COLLECTOR_LINES}
      title="aicharts collector"
    />
  );
}

/**
 * `aicharts tui --snapshot` for a running collector, copied from the CLI's
 * golden (crates/aicharts-cli/tests/fixtures/status/running.w80.txt). The
 * launch test fails when the golden changes and this copy does not.
 */
export const STATUS_SNAPSHOT_LINES = [
  "== Status ==",
  "aicharts",
  "● Collecting · Last pass 4 min ago · last sync 50 min ago",
  "",
  "Usage dashboard  aicharts open dashboard",
  "Error log        aicharts open error-log",
  "Outputs (3)      aicharts outputs",
  "Support          aicharts open support",
] as const;

export function StatusMockup({ theme }: Themed) {
  const lines: TerminalLine[] = [
    { kind: "input", text: "aicharts tui --snapshot" },
    ...STATUS_SNAPSHOT_LINES.filter((line) => line !== "").map((text): TerminalLine => (
      text.startsWith("●") ? { kind: "output", text, tone: "ok" } : text.startsWith("==") ? { kind: "output", text, tone: "muted" } : { kind: "output", text }
    )),
  ];
  return (
    <TerminalFrame
      {...themeProps(theme)}
      className="acm acm-terminal"
      describe="Illustration of the aicharts collector's terminal status view: collecting, when it last read and last synced, and the commands to open the dashboard and error log."
      lines={lines}
      title="aicharts tui"
    />
  );
}
