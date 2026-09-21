import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createUsageStatsExample } from "@/lib/usage/stats-example";
import { STATS_CLIENTS } from "@/lib/usage/stats-registry";
import { StatsReportView } from "./stats-report-view";
import { StatsDashboard } from "./stats-dashboard";

test("the detailed report prioritizes total and trend before explanation and offers exact accessible detail", () => {
  const html = renderToStaticMarkup(<StatsReportView report={createUsageStatsExample(20_700)} scope="example" todayUtcDay={20_700} />);
  expect(html.indexOf("Reported tokens")).toBeLessThan(html.indexOf("Daily usage"));
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
  expect(html).toContain("Recorded request duration");
  expect(html).toContain("not time spent working, GPU time");
  expect(html).toContain("models.dev pricing snapshot dated 2026-09-19");
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
  expect(html).toContain("<dt>Usage records</dt><dd>Unavailable</dd>");
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
