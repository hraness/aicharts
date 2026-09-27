import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createUsageStatsExample } from "@/lib/usage/stats-example";
import { createMetricSnapshot, evaluateMetricQuery, metricResultJson } from "@/lib/usage/metric-explorer";
import { StatsMetricExplorer } from "./stats-metric-explorer";
import { metricPresentation } from "./stats-metric-presentation";

function renderMetric(id: string, range: { firstUtcDay: number; dayCount: number } | null = null) {
  const report = createUsageStatsExample(20_700), snapshot = createMetricSnapshot(report)!;
  const query = evaluateMetricQuery(snapshot, { schemaVersion: 1, firstUtcDay: range?.firstUtcDay ?? report.firstUtcDay, dayCount: range?.dayCount ?? report.dayCount,
    filters: { client: "*", provider: "*", model: "*" }, basis: "reported", costKind: "reported", groupBy: ["client"],
    metricIds: [id], topK: 10, sortBy: id, sortDirection: "desc" });
  if (!query.ok) throw new Error(query.code);
  return renderToStaticMarkup(<StatsMetricExplorer result={metricPresentation(query.value)} metricId={id} onMetric={() => {}} secondary={null}
    onSecondary={() => {}} onCostKind={() => {}} onMetricSort={() => {}} prepareExport={() => metricResultJson(query.value)} />);
}

test("unavailable metric values omit internal unit placeholders without hiding their missing-evidence reason", () => {
  const html = renderMetric("compare-periods");
  expect(html).toContain('<div class="usage-metrics__value"><strong>Unavailable</strong></div>');
  expect(html).not.toContain("selected-metric-unit");
  expect(html).toContain("matched source populations, versions and exposure");
  expect(html).not.toContain("Support remains planned");
  expect(html).toContain("same-length range immediately before it");
  expect(html).toContain("<label>Compare<select");
});

test("known rate units are readable while exact fractions and answer focus semantics remain available", () => {
  const html = renderMetric("tokens-per-source-duration-second");
  expect(html).toContain("<span>tokens per source second</span>");
  expect(html).toContain("Exact fraction");
  expect(html).toContain('class="usage-metrics__detail" tabindex="-1" aria-labelledby=');
  expect(html).toContain("matching definitions");
  expect(html).toContain("supported by this aggregate profile");
});

test("a matched previous period renders exact previous values, signed changes and the comparison selector", () => {
  // Example indices 72–77 and 66–71 are complete (every 13th day is omitted).
  const report = createUsageStatsExample(20_700), range = { firstUtcDay: report.firstUtcDay + 72, dayCount: 6 };
  const level = renderMetric("accounted-tokens", range);
  expect(level).toContain('class="usage-stats__hint usage-metrics__comparison" data-matched="true"');
  expect(level).toContain("Both periods observe the same groups.");
  expect(level).toMatch(/· change [+−-]?[0-9,]+ \([+−-]?[0-9.]+%\)/u);
  expect(level).toContain('<th scope="col">Previous</th><th scope="col">Change</th>');
  expect(level).toContain('<label>Compare<select><option value="none" selected="">None</option>');
  const compared = renderMetric("compare-periods", range);
  expect(compared).toMatch(/<div class="usage-metrics__value"><strong>[+−-]?[0-9,]+<\/strong><span>tokens<\/span><\/div>/u);
  expect(compared).toContain("matched, so this value is the exact signed change");
  expect(compared).not.toContain('<th scope="col">Previous</th>');
  expect(compared).toContain('<option value="compare-periods" selected="">Previous period</option>');
  const unmatched = renderMetric("accounted-tokens", { firstUtcDay: report.firstUtcDay + 70, dayCount: 6 });
  expect(unmatched).toContain('data-matched="false"');
  expect(unmatched).toContain("5 of 6 days observed");
  expect(unmatched).toContain("Change is refused, not shown as zero.");
  expect(unmatched).not.toContain('<th scope="col">Change</th>');
  expect(renderMetric("accounted-tokens", { firstUtcDay: report.firstUtcDay + 2, dayCount: 6 })).toContain("No same-length range lies immediately before this one inside the report");
});
