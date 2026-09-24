import { expect, test } from "bun:test";
import { createUsageStatsExample } from "@/lib/usage/stats-example";
import { createMetricSnapshot, evaluateMetricQuery, metricResultJson, type MetricQuery } from "@/lib/usage/metric-explorer";
import { bucketStatsRows, filterStatsRows, sumStatsRows } from "./stats-view";
import { metricStatsProjection } from "./stats-metric-projection";
import { statsBoundRowsCsv } from "./stats-export";
import { formatMetricMeasure } from "./stats-metric-explorer";

test("one captured selection conserves overview, days, globally ranked composition, groups and exact exports", async () => {
  const report = createUsageStatsExample(20_700), snapshot = createMetricSnapshot(report)!;
  for (const basis of ["reported", "estimated"] as const) for (const client of ["*", "codex", "claude"] as const) {
    const query: MetricQuery = { schemaVersion: 1, firstUtcDay: 20_671, dayCount: 30, filters: { client, provider: "*", model: "*" },
      basis, costKind: "reported", groupBy: ["client", "model"], metricIds: ["accounted-tokens"], topK: 2, sortBy: "accounted-tokens", sortDirection: "desc" };
    const value = evaluateMetricQuery(snapshot, query); if (!value.ok) throw new Error(value.code);
    const projection = metricStatsProjection(value.value), selected = filterStatsRows(report, { ...query.filters, firstUtcDay: query.firstUtcDay, dayCount: query.dayCount, basis });
    const reference = sumStatsRows(selected);
    expect(projection.totals).toEqual(reference);
    expect(projection.buckets).toEqual(bucketStatsRows(selected, query));
    for (let i = 0; i < projection.buckets.length; i++) {
      expect(projection.split.buckets[i].segments.reduce((sum, segment) => sum + segment.tokens, 0n)).toBe(projection.buckets[i].totals.tokens);
      expect(projection.split.buckets[i].segments.reduce((sum, segment) => sum + segment.records, 0)).toBe(projection.buckets[i].totals.records);
    }
    expect(projection.groups.reduce((sum, group) => sum + group.totals.tokens, 0n)).toBe(reference.tokens);
    expect(projection.split.series.length).toBeLessThanOrEqual(6);
    const csv = await statsBoundRowsCsv(value.value), json = JSON.parse(await metricResultJson(value.value)) as { snapshot: { sha256: string }; measures: { value: { amount: string } | null }[] };
    const lines = csv.trimEnd().split("\r\n");
    expect(lines.length).toBe(selected.length + value.value.refreshSnapshot.rows.length + 1);
    expect(lines[0]).toContain("snapshot_sha256,snapshot_revision,source_profile");
    for (const line of lines.slice(1)) expect(line.startsWith(`"${json.snapshot.sha256}",`)).toBe(true);
    expect(json.measures[0].value?.amount ?? null).toBe(reference.tokenRecords > 0 ? reference.tokens.toString() : null);
    expect(() => statsBoundRowsCsv({ ...value.value, rows: [] })).toThrow("metric_result_invalid");
  }
});

test("display rounding happens after exact rational evaluation", () => {
  const base = { id: "cached-input-share", version: 1 as const, unit: "ratio", status: "available" as const, eligibleRecords: 1n,
    selectedRecords: 1n, excludedRecords: 0n, reason: null, evidence: "eligible-cohort" as const };
  expect(formatMetricMeasure({ ...base, value: { kind: "ratio", numerator: 1n, denominator: 3n } })).toBe("33.33%");
  expect(formatMetricMeasure({ ...base, value: { kind: "ratio", numerator: 1n, denominator: 32n } })).toBe("3.13%");
  expect(formatMetricMeasure({ ...base, value: null })).toBe("Unavailable");
});
