import { expect, test } from "bun:test";
import { assertProperty, fc } from "../property-test";
import { addMetricRow, decodeMetricRow, finishMetricFold, mergeMetricAccumulatorInto, metricAccumulator, subtractMetricAccumulatorInto } from "./metric-explorer-fold";
import { parseUsageStatsRow, type UsageStatsRow } from "./stats-contract";

const row = (extra: Partial<UsageStatsRow> = {}): UsageStatsRow => {
  const value = parseUsageStatsRow({ utcDay: 20_700, client: "codex", provider: null, model: null, records: 1,
    tokens: { input: "12", cacheRead: "8", cacheWrite: "5", output: "20", reasoning: "5" },
    reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete", ...extra });
  if (!value) throw new Error("invalid_test_row"); return value;
};
const accumulate = (rows: readonly UsageStatsRow[]) => {
  const value = metricAccumulator(); for (const row of rows) addMetricRow(value, decodeMetricRow(row)); return value;
};
const direct = (rows: readonly UsageStatsRow[]) => finishMetricFold(accumulate(rows));

test("complement preserves measured zero, unknown tokens, cohort support and zero-token day presence", () => {
  const zero = { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" };
  const keep = row({ reportedCostMicrousd: "900", reportedCostRecords: 1, durationMs: "500", timedRecords: 1, timedTokens: "50" });
  const free = row({ tokens: zero, reportedCostMicrousd: "0", reportedCostRecords: 1, durationMs: "0", timedRecords: 1 });
  const unknown = row({ utcDay: 20_701, tokens: zero, tokenBasis: "unavailable", breakdownCoverage: "partial", durationMs: "1000", timedRecords: 1 });
  const value = accumulate([keep, free, unknown]); subtractMetricAccumulatorInto(value, accumulate([keep]));
  const remaining = finishMetricFold(value);
  expect(remaining).toEqual(direct([free, unknown]));
  expect(remaining.reportedCost).toBe(0n); expect(remaining.reportedCostRecords).toBe(1n);
  expect(remaining.reportedCohort).toMatchObject({ records: 1n, microusd: 0n, total: 0n });
  expect(remaining.durationMs).toBe(1000n); expect(remaining.rateCohort).toEqual({ records: 1n, durationMs: 0n, tokens: 0n });
  expect(remaining.days.map(day => day.utcDay)).toEqual([20_700, 20_701]);
  subtractMetricAccumulatorInto(value, accumulate([free]));
  expect(finishMetricFold(value)).toEqual(direct([unknown])); expect(value.totals.reportedCost).toBeNull();
  subtractMetricAccumulatorInto(value, accumulate([unknown]));
  expect(finishMetricFold(value)).toEqual(direct([])); expect(value.days.size).toBe(0);
});

test("complement refuses underflow, absent days, duplicate removal and incompatible support", () => {
  const value = row(), zero = row({ tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } });
  expect(() => subtractMetricAccumulatorInto(accumulate([zero]), accumulate([value]))).toThrow("metric_complement_invalid");
  expect(() => subtractMetricAccumulatorInto(accumulate([value]), accumulate([row({ utcDay: 20_701 })]))).toThrow("metric_complement_invalid");
  const repeated = accumulate([value]); subtractMetricAccumulatorInto(repeated, accumulate([value]));
  expect(() => subtractMetricAccumulatorInto(repeated, accumulate([value]))).toThrow("metric_complement_invalid");
  expect(() => subtractMetricAccumulatorInto(accumulate([row({ reportedCostMicrousd: "1", reportedCostRecords: 1 })]),
    accumulate([row({ reportedCostMicrousd: "0", reportedCostRecords: 1 })]))).toThrow("metric_complement_invalid");
  expect(() => subtractMetricAccumulatorInto(accumulate([row({ reportedCostMicrousd: "0", reportedCostRecords: 1 })]),
    accumulate([value]))).toThrow("metric_complement_invalid");
});

test("property: subtracting disjoint partitions equals a direct fold of every remaining row without mutating inputs", () => {
  const scalar = fc.bigInt({ min: 0n, max: 999_999_999_999_999_999_999_999n });
  const values = fc.array(fc.record({ group: fc.integer({ min: 0, max: 7 }), day: fc.integer({ min: 0, max: 6 }),
    tokens: fc.tuple(scalar, scalar, scalar, scalar, scalar), cost: scalar, duration: scalar,
    known: fc.boolean(), complete: fc.boolean(), priced: fc.integer({ min: 0, max: 2 }), fullyPriced: fc.boolean(), timed: fc.boolean() }), { maxLength: 48 });
  assertProperty(fc.property(values, fc.uniqueArray(fc.integer({ min: 0, max: 7 }), { maxLength: 8 }), (values, remove) => {
    const source = values.map(value => {
      const tokens = value.known ? value.tokens : [0n, 0n, 0n, 0n, 0n];
      return { group: value.group, row: row({ utcDay: 20_700 + value.day, records: 2,
        tokens: { input: String(tokens[0]), cacheRead: String(tokens[1]), cacheWrite: String(tokens[2]), output: String(tokens[3]), reasoning: String(tokens[4]) },
        tokenBasis: value.known ? "reported" : "unavailable", breakdownCoverage: value.known && value.complete ? "complete" : "partial",
        reportedCostMicrousd: value.priced === 1 ? String(value.cost) : null, reportedCostRecords: value.priced === 1 ? value.fullyPriced ? 2 : 1 : 0,
        estimatedCostMicrousd: value.priced === 2 ? String(value.cost) : null, estimatedCostRecords: value.priced === 2 ? value.fullyPriced ? 2 : 1 : 0,
        durationMs: value.timed ? String(value.duration) : null, timedRecords: value.timed ? 1 : 0, timedTokens: value.timed ? String(tokens[0]) : "0" }) };
    });
    const population = accumulate(source.map(value => value.row)), original = finishMetricFold(population), temporary = metricAccumulator();
    mergeMetricAccumulatorInto(temporary, population); const removed = new Set<number>();
    for (const group of remove) {
      const partition = accumulate(source.filter(value => value.group === group).map(value => value.row)), before = finishMetricFold(partition);
      subtractMetricAccumulatorInto(temporary, partition); removed.add(group);
      expect(finishMetricFold(temporary)).toEqual(direct(source.filter(value => !removed.has(value.group)).map(value => value.row)));
      expect(finishMetricFold(partition)).toEqual(before);
    }
    expect(finishMetricFold(population)).toEqual(original);
  }), { seed: 0x7142cafe });
});
