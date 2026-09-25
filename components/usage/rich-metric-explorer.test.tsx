import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { richFact, richReport, richUsage } from "@/lib/usage/rich-fact-fixtures";
import type { RichFactsDocument } from "@/lib/usage/rich-metric-explorer-view";
import { createUsageStatsExample } from "@/lib/usage/stats-example";
import { createMetricSnapshot, evaluateMetricQuery, metricResultJson } from "@/lib/usage/metric-explorer";
import { RICH_ABSENCE_TEXT, RichMetricExplorer, formatRichValue } from "./rich-metric-explorer";
import { StatsMetricExplorer } from "./stats-metric-explorer";
import { metricPresentation } from "./stats-metric-presentation";

const facts = [1, 2, 3, 4, 5, 6].map(index => richFact(index, richUsage(index, String(100 * index), { model: index % 2 ? "gpt-5.5" : "gpt-5.3-codex", modelBasis: "response" }), { atMs: 100 * index }));
const document = (timeZone: string | null): RichFactsDocument => ({ report: richReport(facts), timeZone, origin: "rich-facts-v1", revision: "test:6:0" });

test("a loaded document renders exact percentiles, histogram, groups, drilldown and exports", () => {
  const html = renderToStaticMarkup(<RichMetricExplorer standalone source={{ document: document("Asia/Tokyo"), absence: null }} metricId="token-size-p95" onMetric={() => {}} />);
  expect(html).toContain("Session-fact metrics");
  expect(html).toContain('<option value="token-size-p95" selected="">Token size P95</option>');
  expect(html).toContain("<strong>600</strong>");
  expect(html).toContain("Exact percentiles of the measured values");
  expect(html).toContain("<td>100</td><td>300</td><td>600</td><td>600</td><td>600</td><td>600</td>");
  expect(html).toContain("<code>2100 / 6</code>");
  expect(html).toContain('class="usage-rich__histogram"');
  expect(html).toContain("Observations behind this value");
  expect(html).toContain("Export CSV");
  expect(html).toContain("Export JSON");
  expect(html).toContain("use Asia/Tokyo, declared by the report");
  expect(html).toContain('<option value="local-day">Local calendar day</option>');
  expect(html).toContain("(Asia/Tokyo)");
  expect(html).not.toContain("Unavailable</strong>");
});

test("a document without a declared zone refuses calendar grouping instead of guessing", () => {
  const html = renderToStaticMarkup(<RichMetricExplorer standalone source={{ document: document(null), absence: null }} metricId="mean-output-tokens-per-request" />);
  expect(html).toContain("declares no time zone");
  expect(html).toContain('<option value="local-day" disabled="">Local calendar day</option>');
  expect(html).toContain('<option value="hour-of-day" disabled="">Hour of day</option>');
  expect(html).toContain("(UTC)");
  expect(html).toContain("<code>2100 / 6</code>");
});

test("absent facts render their explicit reason; hosted mode offers no file picker", () => {
  const hosted = renderToStaticMarkup(<RichMetricExplorer source={{ document: null, absence: "hosted" }} metricId="token-size-median" />);
  expect(hosted).toContain(RICH_ABSENCE_TEXT.hosted);
  expect(hosted).not.toContain("Open session facts");
  expect(hosted).not.toContain("<select");
  const local = renderToStaticMarkup(<RichMetricExplorer source={{ document: null, absence: "not-loaded", onOpen: () => {} }} metricId="token-size-median" />);
  expect(local).toContain(RICH_ABSENCE_TEXT["not-loaded"]);
  expect(local).toContain("Open session facts");
  expect(renderToStaticMarkup(<RichMetricExplorer source={{ document: null, absence: "window" }} metricId="token-size-median" />)).toContain("at most 31 days");
});

test("the main explorer embeds session facts for rich metrics and keeps aggregate controls for aggregate metrics", () => {
  const report = createUsageStatsExample(20_700), snapshot = createMetricSnapshot(report)!;
  const render = (metricId: string, rich: Parameters<typeof RichMetricExplorer>[0]["source"] | undefined) => {
    const query = evaluateMetricQuery(snapshot, { schemaVersion: 1, firstUtcDay: report.firstUtcDay, dayCount: report.dayCount, filters: { client: "*", provider: "*", model: "*" },
      basis: "reported", costKind: "reported", groupBy: ["client"], metricIds: [...new Set(["accounted-tokens", metricId])], topK: 10, sortBy: "accounted-tokens", sortDirection: "desc" });
    if (!query.ok) throw new Error(query.code);
    return renderToStaticMarkup(<StatsMetricExplorer result={metricPresentation(query.value)} metricId={metricId} onMetric={() => {}} secondary={null} onSecondary={() => {}}
      onCostKind={() => {}} onMetricSort={() => {}} prepareExport={() => metricResultJson(query.value)} rich={rich} />);
  };
  const embedded = render("token-size-p95", { document: document("Asia/Tokyo"), absence: null });
  expect(embedded).toContain("<strong>600</strong>");
  expect(embedded).toContain("by the loaded session facts");
  expect(embedded).toContain("<small>Session facts</small>");
  expect(embedded).toContain('aria-selected="true" aria-controls="_R_0_-catalog" tabindex="0" data-view="4">Sessions &amp; agents</button>');
  expect(embedded).not.toContain("Rank by this metric");
  const hosted = render("token-size-p95", { document: null, absence: "hosted" });
  expect(hosted).toContain(RICH_ABSENCE_TEXT.hosted);
  expect(hosted).toContain("<small>Needs session facts</small>");
  expect(hosted).not.toContain("by the loaded session facts");
  const aggregate = render("accounted-tokens", { document: document(null), absence: null });
  expect(aggregate).toContain("Rank by this metric");
  expect(aggregate).not.toContain("Session facts</h3>");
  const legacy = render("token-size-p95", undefined);
  expect(legacy).toContain("Support remains planned");
});

test("rich values format exactly by unit", () => {
  expect(formatRichValue({ kind: "integer", amount: 1_234n }, "tokens")).toBe("1,234");
  expect(formatRichValue({ kind: "integer", amount: 90n }, "milliseconds")).toBe("90 ms");
  expect(formatRichValue({ kind: "ratio", numerator: 1n, denominator: 8n }, "error-rate")).toBe("12.50%");
  expect(formatRichValue({ kind: "ratio", numerator: 2_100n, denominator: 6n }, "tokens")).toBe("350.00");
  expect(formatRichValue(null, "tokens")).toBe("Unavailable");
});
