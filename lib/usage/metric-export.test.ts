import { expect, test } from "bun:test";
import { createUsageStatsExample } from "./stats-example";
import { createMetricSnapshot, disposeMetricSnapshot, evaluateMetricQuery, metricResultJson, metricSnapshotDigest, type MetricQuery } from "./metric-explorer";
import { csvCell, METRIC_CSV_COLUMNS, metricCsv, parseCsv, RICH_METRIC_CSV_COLUMNS, richMetricCsv } from "./metric-export";
import { evaluateRichExplorerQuery, parseRichExplorerQuery, type RichFactsDocument } from "./rich-metric-explorer-view";
import { richFact, richReport, richUsage } from "./rich-fact-fixtures";

const report = createUsageStatsExample(20_700);
const query: MetricQuery = { schemaVersion: 1, firstUtcDay: report.firstUtcDay, dayCount: report.dayCount,
  filters: { client: "*", provider: "*", model: "*" }, basis: "reported", costKind: "reported", groupBy: ["client", "model"],
  metricIds: ["accounted-tokens", "cached-input-share"], topK: 3, sortBy: "accounted-tokens", sortDirection: "desc" };

test("per-metric CSV carries identity, filters and snapshot revision on every row and conserves the JSON values", async () => {
  const snapshot = createMetricSnapshot(report)!;
  try {
    const result = evaluateMetricQuery(snapshot, query); if (!result.ok) throw new Error(result.code);
    const digest = await metricSnapshotDigest(snapshot);
    const json = JSON.parse(await metricResultJson(result.value)) as { measures: { id: string; value: { amount?: string; numerator?: string; denominator?: string } | null }[];
      groups: { key: string; measures: { id: string; value: { amount?: string; numerator?: string; denominator?: string } | null }[] }[] };
    for (const metricId of query.metricIds) {
      const rows = parseCsv(await metricCsv(result.value, metricId));
      expect(rows[0]).toEqual([...METRIC_CSV_COLUMNS]);
      expect(rows.length).toBe(2 + result.value.groups.length);
      for (const row of rows.slice(1)) {
        expect(row.slice(0, 14)).toEqual([metricId, "1", row[2]!, "client-stats-v2", digest, String(snapshot.revision), String(query.firstUtcDay), String(query.dayCount), "reported", "reported", "*", "*", "*", "client+model"]);
      }
      const total = json.measures.find(measure => measure.id === metricId)!;
      const [totalRow] = rows.slice(1);
      expect(totalRow![14]).toBe("total");
      expect(totalRow![20]).toBe(total.value === null ? "" : total.value.amount ?? total.value.numerator!);
      expect(totalRow![21]).toBe(total.value?.denominator ?? "");
      for (const group of json.groups) {
        const row = rows.find(candidate => candidate[15] === group.key)!;
        const measure = group.measures.find(item => item.id === metricId)!;
        expect(row[20]).toBe(measure.value === null ? "" : measure.value.amount ?? measure.value.numerator!);
      }
    }
    await expect(metricCsv(result.value, "not-a-metric")).rejects.toThrow("metric_not_in_result");
  } finally { disposeMetricSnapshot(snapshot); }
});

test("rich metric CSV exports the total, every group and exact percentile rows", () => {
  const facts = [1, 2, 3, 4, 5, 6].map(index => richFact(index, richUsage(index, String(100 * index), { model: index % 2 ? "gpt-5.5" : "gpt-5.3-codex", modelBasis: "response" }), { atMs: 100 * index }));
  const document: RichFactsDocument = { report: richReport(facts), timeZone: null, origin: "rich-facts-v1", revision: "test:6:0" };
  const parsed = parseRichExplorerQuery({ schemaVersion: 1, metricId: "token-size-p95", quantity: "output",
    selection: { window: document.report.window, grain: "request", tokenScope: "direct", lineage: "all" },
    filters: { provider: "*", model: "*", session: "*" }, groupBy: ["model"], topK: 10, timeZone: null });
  expect(parsed).not.toBeNull();
  const result = evaluateRichExplorerQuery(document, parsed!); if (!result.ok) throw new Error(result.error);
  expect(result.value.distribution).not.toBeNull();
  const rows = parseCsv(richMetricCsv(result.value));
  expect(rows[0]).toEqual([...RICH_METRIC_CSV_COLUMNS]);
  const byScope = (scope: string) => rows.slice(1).filter(row => row[16] === scope);
  expect(byScope("total")).toHaveLength(1);
  expect(byScope("total")[0]![22]).toBe(String(result.value.measure.value!.kind === "integer" ? result.value.measure.value!.amount : ""));
  expect(byScope("group")).toHaveLength(2);
  expect(byScope("group").map(row => row[17])).toEqual(result.value.groups.map(group => group.key));
  const p50 = byScope("distribution").find(row => row[17] === "p50")!;
  expect(p50[22]).toBe(String(result.value.distribution!.p50));
  expect(byScope("distribution").find(row => row[17] === "sum")![22]).toBe("2100");
  expect(byScope("histogram")).toHaveLength(result.value.distribution!.bins.length);
  for (const row of rows.slice(1)) expect(row.slice(0, 5)).toEqual(["token-size-p95", "1", row[2]!, "rich-facts-v1", "test:6:0"]);
  for (const row of rows.slice(1)) expect(row.slice(12, 16)).toEqual(["*", "*", "*", "model"]);
});

test("CSV quoting round-trips commas, quotes and newlines", () => {
  expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  expect(parseCsv('x,y\r\n"a,""b""\nc",2\r\n')).toEqual([["x", "y"], ['a,"b"\nc', "2"]]);
});
