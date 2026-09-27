import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createUsageStatsExample } from "@/lib/usage/stats-example";
import { parseUsageStatsReport, type UsageStatsRow } from "@/lib/usage/stats-contract";
import { STATS_CLIENTS } from "@/lib/usage/stats-registry";
import { StatsReportView } from "./stats-report-view";
import { StatsDashboard } from "./stats-dashboard";
import { DEFAULT_SAVED_VIEW } from "@/lib/usage/saved-views";

test("the detailed report prioritizes total and trend before explanation and offers exact accessible detail", () => {
  const html = renderToStaticMarkup(<StatsReportView report={createUsageStatsExample(20_700)} scope="example" todayUtcDay={20_700} />);
  expect(html.indexOf("Reported tokens")).toBeLessThan(html.indexOf("Daily activity"));
  expect(html.indexOf("Daily activity")).toBeLessThan(html.indexOf("Daily usage"));
  expect(html.indexOf("Daily usage")).toBeLessThan(html.indexOf("Where the tokens went"));
  expect(html.indexOf("Where the tokens went")).toBeLessThan(html.indexOf("Source coverage &amp; freshness"));
  for (const label of ["Clients", "Providers", "Models", "Download numeric CSV", "Token composition", "Reasoning", "Daily data", "Unknown"]) expect(html).toContain(label);
  expect(html).toContain("Synthetic example.");
  expect(html).toContain('aria-label="Period"');
  expect(html).toContain('aria-expanded="false" aria-controls="stats-filters"');
  expect(html).toContain("No records does not prove inactivity.");
  expect(html).toContain('aria-label="Usage breakdown, scroll horizontally for all columns" tabindex="0"');
  expect(html).toContain('aria-sort="descending"');
  expect(html).toContain("not subscription charges or a provider bill");
  expect(html).toContain("Recorded source duration");
  expect(html).toContain("not time spent working, GPU time");
  expect(html).toContain("models.dev pricing snapshot dated 2026-09-19");
});

test("the dashboard renders the activity calendar, metric and composition controls, and share actions", () => {
  const html = renderToStaticMarkup(<StatsReportView report={createUsageStatsExample(20_700)} scope="local" todayUtcDay={20_700} />);
  expect(html).toContain('aria-labelledby="stats-calendar-title"');
  expect(html).toContain('role="group" aria-label="Reported token density by UTC day');
  expect(html).toContain('data-tier="4"');
  expect(html).toContain('role="button" tabindex="0"');
  expect(html).toContain("Highest activity:");
  expect(html).toContain("Download image");
  expect(html).toContain("Copy summary");
  expect(html).toContain('aria-label="Chart metric"');
  expect(html).toContain('aria-pressed="true">Tokens<');
  expect(html).toContain('aria-label="Stack bars by"');
  expect(html).toContain('aria-pressed="true">Total<');
  expect(html).toContain("Records per active day");
  expect(html).toContain("Tokens per record");
  expect(html).not.toContain("not inference speed or time spent working");
});

test("local entry point labels its privacy boundary without claiming any account is connected", () => {
  const html = renderToStaticMarkup(<StatsDashboard todayUtcDay={20_700} />);
  expect(html).toContain("Local reports stay in this browser");
  expect(html).toContain("Open local report");
  expect(html).toContain("Explore a working example");
  expect(html).toContain("does not publish or upload anything");
  expect(html).not.toContain("Load account");
  expect(html).not.toContain("Private to your account");
});

test("Warp renders billing spend separately from unavailable daily usage", () => {
  const report = createUsageStatsExample(20_700);
  const html = renderToStaticMarkup(<StatsReportView report={report} scope="local" todayUtcDay={20_700}
    initialSelection={{ client: "warp", provider: "*", model: "*", basis: "reported" }} />);
  expect(html).toContain("No token observations");
  expect(html).toContain("$12.35");
  expect(html).toContain("Warp billing snapshot");
  expect(html).toContain("Separate from selected UTC dates");
  expect(html).toContain("No dated usage records");
  expect(html).toContain("refresh_snapshot");
  expect(html.split("$12.35")).toHaveLength(2);
  expect(html).toContain("<dt>Source records</dt><dd>Unavailable</dd>");
  expect(html).toContain("token usage unknown");
  expect(html).not.toContain("0 exact");
  expect(html).toContain("Warp dates identify when usage was synchronized");
  expect(html).toContain("Warp token counts are unavailable");
});

test("hosted reports retain their requested long range and selected client", () => {
  const html = renderToStaticMarkup(<StatsReportView report={createUsageStatsExample(20_700)} scope="account" todayUtcDay={20_700}
    initialSelection={{ client: "codex", provider: "*", model: "*", basis: "reported" }} />);
  expect(html).toContain("Weekly usage");
  expect(html).toContain('aria-pressed="true">90 days');
  expect(html).toContain('value="codex" selected=""');
  expect(html).toContain("Filters · 1 active");
});

test("coverage distinguishes an absent client from a checked source with no observations", () => {
  const report = createUsageStatsExample(20_700);
  const html = renderToStaticMarkup(<StatsReportView report={report} scope="local" todayUtcDay={20_700} />);
  expect(html).toContain(`${report.sources.length} of ${STATS_CLIENTS.length} included in this report`);
  expect(html).toContain('<th scope="row">Amp</th><td>Not included</td>');
  expect(html).toContain('<th scope="row">OpenCode</th><td>Not found</td>');
  expect(html).toContain('<option value="opencode">OpenCode</option>');
  expect(html).toContain("it does not mean zero usage");
  expect(html).toContain("public leaderboard visibility requires separate consent");
});

test("provider filters retain unknown attribution and a selected value without records", () => {
  const report = createUsageStatsExample(20_700);
  const html = renderToStaticMarkup(<StatsReportView report={report} scope="account" todayUtcDay={20_700}
    initialSelection={{ client: "cursor", provider: "openai", model: "*", basis: "reported" }} />);
  expect(html).toContain('aria-label="Provider"');
  expect(html).toContain('<option value="~">Unknown</option>');
  expect(html).toContain('<option value="openai" selected="">OpenAI · no records</option>');
  expect(html).not.toContain('<option value="anthropic">');
  expect(html).toContain("No matching reported records");
});


test("cache write tokens belong to whole input and incomplete buckets withhold a percentage", () => {
  const example = createUsageStatsExample(20_700);
  for (const breakdownCoverage of ["complete", "partial"] as const) {
    const row: UsageStatsRow = { ...example.rows[0]!, utcDay: 20_700, client: "codex", provider: null, model: null,
      records: 1, tokens: { input: "0", cacheRead: "100", cacheWrite: "900", output: "0", reasoning: "0" },
      reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
      durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage };
    const report = parseUsageStatsReport({ ...example, firstUtcDay: 20_700, dayCount: 1, rows: [row],
      sources: [{ client: "codex", status: "observed", tokenBasis: "reported", records: 1, warnings: 0, latestAtMs: example.generatedAtMs }] });
    expect(report).not.toBeNull();
    const html = renderToStaticMarkup(<StatsReportView report={report!} scope="local" todayUtcDay={20_700} />);
    expect(html).toContain(breakdownCoverage === "complete" ? "<dt>Cache reads / whole input</dt><dd>10%" : "<dt>Cache reads / whole input</dt><dd>Unknown");
    expect(html).not.toContain("<dt>Cache reads / whole input</dt><dd>100%");
  }
});

test("disjoint one-dollar reported and three-dollar estimated records do not invent savings", () => {
  const example = createUsageStatsExample(20_700);
  const base: UsageStatsRow = { ...example.rows[0]!, utcDay: 20_700, client: "codex", provider: null, model: null,
    records: 1, tokens: { input: "1", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" },
    reportedCostMicrousd: "1000000", reportedCostRecords: 1, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete" };
  const report = parseUsageStatsReport({ ...example, firstUtcDay: 20_700, dayCount: 1,
    rows: [base, { ...base, client: "cursor", reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: "3000000", estimatedCostRecords: 1 }],
    sources: ["codex", "cursor"].map(client => ({ client, status: "observed", tokenBasis: "reported", records: 1, warnings: 0, latestAtMs: example.generatedAtMs })) });
  expect(report).not.toBeNull();
  const html = renderToStaticMarkup(<StatsReportView report={report!} scope="local" todayUtcDay={20_700} />);
  expect(html).toContain("$1.00"); expect(html).toContain("$3.00");
  expect(html).toContain("These amounts can cover different records.");
  expect(html).toContain("1 of 2 records");
  expect(html).not.toContain("$2.00"); expect(html).not.toContain("savings");
});


test("a timed unknown-token record withholds the combined rate without treating missing tokens as zero", () => {
  const example = createUsageStatsExample(20_700);
  const known: UsageStatsRow = { ...example.rows[0]!, utcDay: 20_700, client: "codex", provider: null, model: null,
    records: 1, tokens: { input: "100", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" },
    reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: "1000", timedRecords: 1, timedTokens: "100", tokenBasis: "reported", breakdownCoverage: "complete" };
  const report = parseUsageStatsReport({ ...example, firstUtcDay: 20_700, dayCount: 1,
    rows: [known, { ...known, client: "cursor", tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" },
      timedTokens: "0", tokenBasis: "unavailable", breakdownCoverage: "partial" }],
    sources: ["codex", "cursor"].map(client => ({ client, status: "observed", tokenBasis: client === "codex" ? "reported" : "unavailable", records: 1, warnings: 0, latestAtMs: example.generatedAtMs })) });
  expect(report).not.toBeNull();
  const html = renderToStaticMarkup(<StatsReportView report={report!} scope="local" todayUtcDay={20_700} />);
  expect(html).toContain("<dt>Tokens / source second</dt><dd>Unknown</dd>");
  expect(html).toContain("<dt>Tokens in timed records</dt><dd>Unknown</dd>");
  expect(html).toContain("<dt>Sum of source durations</dt><dd>2,000 ms</dd>");
  expect(html).not.toContain("<td>50</td>");
});

test("the coverage section states freshness from report facts and explicit absence of collector health", () => {
  const example = createUsageStatsExample(20_700);
  const fresh = renderToStaticMarkup(<StatsReportView report={example} scope="local" todayUtcDay={20_700} />);
  expect(fresh).toContain('aria-label="Freshness and missing sources"');
  expect(fresh).toContain("<strong>No health facts.</strong>");
  expect(fresh).toContain("hosted source health is not collected yet");
  expect(fresh).toContain("Generated on the current UTC day.");
  expect(fresh).toContain(`${STATS_CLIENTS.length - example.sources.length} of ${STATS_CLIENTS.length} supported clients are not included; absence is not zero usage.`);
  const stale = renderToStaticMarkup(<StatsReportView report={example} scope="local" todayUtcDay={20_703} />);
  expect(stale).toContain("Generated 3 UTC days before the current day.");
  const future = renderToStaticMarkup(<StatsReportView report={example} scope="local" todayUtcDay={20_699} />);
  expect(future).toContain("Unknown: the report is generated after the current UTC day.");
  const missing = parseUsageStatsReport({ ...example, sources: [...example.sources, { client: "cline", status: "not_found", tokenBasis: "unavailable", records: 0, warnings: 0, latestAtMs: null }].toSorted((a, b) => a.client < b.client ? -1 : 1) });
  expect(missing).not.toBeNull();
  const html = renderToStaticMarkup(<StatsReportView report={missing!} scope="local" todayUtcDay={20_700} />);
  expect(html).toContain("2 included sources report no observations: Cline (not found), OpenCode (not found).");
  expect(fresh).toContain("1 included source reports no observations: OpenCode (not found).");
});

test("a saved view seeds period, filters, grouping, chart and explorer selection; a range outside the report is refused alone", () => {
  const example = createUsageStatsExample(20_700);
  const html = renderToStaticMarkup(<StatsReportView report={example} scope="local" todayUtcDay={20_700} savedView={{ ...DEFAULT_SAVED_VIEW, range: { kind: "preset", days: 7 }, client: "codex",
    grouping: "model", secondGrouping: "utc-day", metric: "cached-input-share", costKind: "estimated", chart: "records", split: "provider" }} />);
  expect(html).toContain('aria-pressed="true">7 days</button>');
  expect(html).toContain('<option value="codex" selected="">');
  expect(html).toContain('aria-pressed="true">Models</button>');
  expect(html).toContain('<option value="utc-day" selected="">');
  expect(html).toContain('<option value="estimated" selected="">Dated retail estimate</option>');
  expect(html).toContain('aria-pressed="true">Records</button>');
  expect(html).toContain('aria-pressed="true">Providers</button>');
  expect(html).toContain("<dt>Definition</dt><dd>cached-input-share · version 1</dd>");
  const outside = renderToStaticMarkup(<StatsReportView report={example} scope="local" todayUtcDay={20_700} savedView={{ ...DEFAULT_SAVED_VIEW, range: { kind: "dates", firstUtcDay: 10, dayCount: 3 }, grouping: "model" }} />);
  expect(outside).toContain('aria-pressed="true">30 days</button>');
  expect(outside).toContain('aria-pressed="true">Models</button>');
  expect(html).toContain("Copy view link");
});
