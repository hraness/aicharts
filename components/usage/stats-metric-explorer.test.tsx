import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createUsageStatsExample } from "@/lib/usage/stats-example";
import { createMetricSnapshot, evaluateMetricQuery, metricResultJson } from "@/lib/usage/metric-explorer";
import { StatsMetricExplorer } from "./stats-metric-explorer";
import { metricPresentation } from "./stats-metric-presentation";

function renderMetric(id: string) {
  const report = createUsageStatsExample(20_700), snapshot = createMetricSnapshot(report)!;
  const query = evaluateMetricQuery(snapshot, { schemaVersion: 1, firstUtcDay: report.firstUtcDay, dayCount: report.dayCount,
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
  expect(html).toContain("Support remains planned");
});

test("known rate units are readable while exact fractions and answer focus semantics remain available", () => {
  const html = renderMetric("tokens-per-source-duration-second");
  expect(html).toContain("<span>tokens per source second</span>");
  expect(html).toContain("Exact fraction");
  expect(html).toContain('class="usage-metrics__detail" tabindex="-1" aria-labelledby=');
  expect(html).toContain("matching definitions");
  expect(html).toContain("supported by this aggregate profile");
});
