import { expect, test } from "bun:test";
import { assertProperty, fc } from "../property-test";
import { metricPresentation } from "../../components/usage/stats-metric-presentation";
import { formatMetricValue } from "../../components/usage/stats-metric-explorer";
import { createMetricSnapshot, disposeMetricSnapshot, evaluateMetricQuery, metricResultJson, type MetricDimension, type MetricQuery } from "./metric-explorer";
import { METRIC_CSV_COLUMNS, metricCsv, parseCsv } from "./metric-export";
import { parseUsageStatsReport, statsRowKey, type UsageStatsReport, type UsageStatsRow } from "./stats-contract";

/** Three export surfaces read one evaluated selection: the JSON snapshot, the
 * per-metric CSV and the on-screen presentation (the explorer table renders
 * `formatMetricValue` over these same measures). This law holds for seeded
 * reports, filters and groupings: the total and every listed group carry the
 * same exact value on every surface, and additive integer metrics conserve
 * the total across listed groups plus Other. */
const clients = ["codex", "claude", "cline"] as const;
const models = ["gpt-5", "gpt-5-mini", "claude-opus-4-1", null] as const;
const column = (name: typeof METRIC_CSV_COLUMNS[number]) => METRIC_CSV_COLUMNS.indexOf(name);
const rowArbitrary = fc.record({
  day: fc.integer({ min: 0, max: 19 }), client: fc.constantFrom(...clients), model: fc.constantFrom(...models),
  input: fc.bigInt({ min: 0n, max: 10n ** 12n }), cacheRead: fc.bigInt({ min: 0n, max: 10n ** 9n }), output: fc.bigInt({ min: 0n, max: 10n ** 9n }),
  records: fc.integer({ min: 1, max: 40 }), estimated: fc.option(fc.bigInt({ min: 0n, max: 10n ** 9n }), { nil: null }),
});
const queryArbitrary = fc.record({
  firstOffset: fc.integer({ min: 0, max: 10 }), dayCount: fc.integer({ min: 1, max: 10 }),
  client: fc.constantFrom("*", ...clients), model: fc.constantFrom("*", "gpt-5", "claude-opus-4-1"),
  groupBy: fc.constantFrom<readonly MetricDimension[]>(["client"], ["model"], ["client", "model"], ["utc-day"], ["client", "utc-week"], ["model", "weekday"]),
  topK: fc.integer({ min: 1, max: 6 }), metricId: fc.constantFrom("accounted-tokens", "unpriced-records", "cached-input-share", "dated-retail-estimated-cost", "inclusive-output-tokens", "cache-read-tokens"),
});
type SeedRow = ReturnType<typeof rowArbitrary.generate>["value"];
function seededReport(values: readonly SeedRow[]): UsageStatsReport | null {
  const merged = new Map<string, UsageStatsRow>();
  for (const value of values) {
    const row: UsageStatsRow = { utcDay: 20_690 + value.day, client: value.client, provider: value.client === "claude" ? "anthropic" : "openai", model: value.model,
      tokens: { input: value.input.toString(), cacheRead: value.cacheRead.toString(), cacheWrite: "0", output: value.output.toString(), reasoning: "0" }, records: value.records,
      reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: value.estimated === null ? null : value.estimated.toString(), estimatedCostRecords: value.estimated === null ? 0 : value.records,
      durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete" };
    merged.set(statsRowKey(row), row);
  }
  const rows = [...merged.values()].sort((a, b) => statsRowKey(a) < statsRowKey(b) ? -1 : statsRowKey(a) > statsRowKey(b) ? 1 : 0);
  const present = [...new Set(rows.map(row => row.client))].sort();
  return parseUsageStatsReport({ schemaVersion: 2, profile: "client-stats-v2", registryRevision: 1, firstUtcDay: 20_690, dayCount: 20, generatedAtMs: 20_710 * 86_400_000, revision: 3, updatedAtMs: 20_709 * 86_400_000,
    sources: present.map(client => ({ client, status: "observed", tokenBasis: "reported", records: rows.filter(row => row.client === client).reduce((sum, row) => sum + row.records, 0), warnings: 0, latestAtMs: 20_709 * 86_400_000 })), rows });
}
const exact = (value: { kind: "integer"; amount: bigint } | { kind: "ratio"; numerator: bigint; denominator: bigint } | null) =>
  value === null ? null : value.kind === "integer" ? { kind: "integer", value: value.amount.toString(), denominator: "" } : { kind: "ratio", value: value.numerator.toString(), denominator: value.denominator.toString() };

test("JSON, per-metric CSV and the on-screen presentation carry identical exact values for seeded selections", async () => {
  await fc.assert(fc.asyncProperty(fc.array(rowArbitrary, { minLength: 1, maxLength: 24 }), queryArbitrary, async (values, choice) => {
    const report = seededReport(values); expect(report).not.toBeNull();
    const snapshot = createMetricSnapshot(report!); expect(snapshot).not.toBeNull();
    const query: MetricQuery = { schemaVersion: 1, firstUtcDay: 20_690 + choice.firstOffset, dayCount: choice.dayCount, filters: { client: choice.client, provider: "*", model: choice.model },
      basis: "reported", costKind: "estimated", groupBy: choice.groupBy, metricIds: [...new Set(["accounted-tokens", choice.metricId])], topK: choice.topK, sortBy: choice.metricId, sortDirection: "desc" };
    const evaluated = evaluateMetricQuery(snapshot!, query); if (!evaluated.ok) throw new Error(evaluated.code);
    const result = evaluated.value, view = metricPresentation(result);
    const json = JSON.parse(await metricResultJson(result)) as { snapshot: { sha256: string; revision: number }; measures: { id: string; unit: string; value: { amount?: string; numerator?: string; denominator?: string } | null; reason: string | null }[];
      groups: { key: string; other: boolean; measures: { id: string; value: { amount?: string; numerator?: string; denominator?: string } | null }[] }[] };
    const csv = parseCsv(await metricCsv(result, choice.metricId));
    expect(csv[0]).toEqual([...METRIC_CSV_COLUMNS]);
    const lines = csv.slice(1), total = lines[0];
    // Identity columns: every CSV row names the metric, filters and snapshot.
    for (const line of lines) {
      expect(line[column("metric_id")]).toBe(choice.metricId); expect(line[column("metric_version")]).toBe("1");
      expect(line[column("snapshot_sha256")]).toBe(json.snapshot.sha256); expect(line[column("snapshot_revision")]).toBe("3");
      expect(line[column("filter_client")]).toBe(choice.client); expect(line[column("filter_model")]).toBe(choice.model);
      expect(line[column("query_first_utc_day")]).toBe(String(query.firstUtcDay)); expect(line[column("query_day_count")]).toBe(String(query.dayCount));
      expect(line[column("group_by")]).toBe(choice.groupBy.join("+"));
    }
    // Total: presentation measure, JSON measure and CSV total row agree exactly.
    const measure = view.measures.find(value => value.id === choice.metricId)!, jsonMeasure = json.measures.find(value => value.id === choice.metricId)!;
    const shown = exact(measure.value);
    expect(total[column("scope")]).toBe("total"); expect(total[column("status")]).toBe(measure.status); expect(total[column("reason")]).toBe(measure.reason ?? "");
    expect(total[column("value")]).toBe(shown?.value ?? ""); expect(total[column("denominator")]).toBe(shown?.denominator ?? ""); expect(total[column("value_kind")]).toBe(shown?.kind ?? "");
    expect(jsonMeasure.value === null ? null : jsonMeasure.value.amount ?? jsonMeasure.value.numerator).toBe(shown?.value ?? null);
    expect(jsonMeasure.reason).toBe(measure.reason); expect(total[column("unit")]).toBe(jsonMeasure.unit);
    expect(formatMetricValue(measure.value, measure.unit, measure.id)).toBe(measure.value === null ? "Unavailable" : formatMetricValue(measure.value, measure.unit, measure.id));
    // Groups: same count, order, keys and exact values on all three surfaces.
    expect(lines.length).toBe(1 + view.groups.length); expect(json.groups.length).toBe(view.groups.length);
    view.groups.forEach((group, index) => {
      const line = lines[index + 1], jsonGroup = json.groups[index], value = exact(group.measures.find(item => item.id === choice.metricId)!.value);
      const jsonValue = jsonGroup.measures.find(item => item.id === choice.metricId)!.value;
      expect(line[column("scope")]).toBe(group.other ? "other" : "group"); expect(line[column("group_key")]).toBe(group.key); expect(jsonGroup.key).toBe(group.key);
      expect(line[column("dimension_1")]).toBe(group.dimensions[0] ?? ""); expect(line[column("dimension_2")]).toBe(group.dimensions[1] ?? "");
      expect(line[column("value")]).toBe(value?.value ?? ""); expect(line[column("denominator")]).toBe(value?.denominator ?? "");
      expect(jsonValue === null ? null : jsonValue.amount ?? jsonValue.numerator).toBe(value?.value ?? null);
    });
    // Additive integer metrics conserve the filtered total across listed groups plus Other on the CSV surface.
    if (measure.value?.kind === "integer" && ["accounted-tokens", "unpriced-records", "dated-retail-estimated-cost", "inclusive-output-tokens", "cache-read-tokens"].includes(choice.metricId) && measure.status === "available") {
      const groupSum = lines.slice(1).reduce((sum, line) => line[column("value")] === "" ? sum : sum + BigInt(line[column("value")]), 0n);
      if (lines.slice(1).every(line => line[column("value")] !== "")) expect(groupSum).toBe(measure.value.amount);
    }
    disposeMetricSnapshot(snapshot!);
  }), { numRuns: 60, seed: 0x5eed_c5f, interruptAfterTimeLimit: 20_000, markInterruptAsFailure: true });
});

test("an unavailable metric exports an empty value with its reason on every surface, never a zero", async () => {
  const report = seededReport([{ day: 1, client: "codex", model: "gpt-5", input: 10n, cacheRead: 0n, output: 5n, records: 1, estimated: null }])!;
  const snapshot = createMetricSnapshot(report)!;
  const query: MetricQuery = { schemaVersion: 1, firstUtcDay: 20_690, dayCount: 5, filters: { client: "*", provider: "*", model: "*" }, basis: "reported", costKind: "estimated",
    groupBy: ["client"], metricIds: ["accounted-tokens", "dated-retail-estimated-cost"], topK: 5, sortBy: "accounted-tokens", sortDirection: "desc" };
  const evaluated = evaluateMetricQuery(snapshot, query); if (!evaluated.ok) throw new Error(evaluated.code);
  const view = metricPresentation(evaluated.value), csv = parseCsv(await metricCsv(evaluated.value, "dated-retail-estimated-cost"));
  const measure = view.measures.find(value => value.id === "dated-retail-estimated-cost")!;
  expect(measure.value).toBeNull(); expect(measure.reason).not.toBeNull();
  expect(csv[1][column("status")]).toBe("unavailable"); expect(csv[1][column("value")]).toBe(""); expect(csv[1][column("reason")]).toBe(measure.reason!);
  expect(formatMetricValue(measure.value, measure.unit, measure.id)).toBe("Unavailable");
  const json = JSON.parse(await metricResultJson(evaluated.value)) as { measures: { id: string; value: unknown; reason: string }[] };
  expect(json.measures.find(value => value.id === "dated-retail-estimated-cost")).toMatchObject({ value: null, reason: measure.reason });
  assertProperty(fc.property(fc.constant(true), value => value), { numRuns: 1 });
  disposeMetricSnapshot(snapshot);
});
