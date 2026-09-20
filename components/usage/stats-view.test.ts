import { expect, test } from "bun:test";
import fc from "fast-check";
import { createUsageStatsExample } from "@/lib/usage/stats-example";
import { parseUsageStatsReport, type UsageStatsReport, type UsageStatsRow } from "@/lib/usage/stats-contract";
import { ALL_STATS, UNKNOWN_STATS, bucketStatsRows, filterStatsRows, filterStatsSnapshots, formatStatsMoney, groupStatsRows, previousStatsPeriod, statsInputRange, statsRowsCsv, sumStatsRows, type StatsFilters } from "./stats-view";

const example = createUsageStatsExample(20_700);
const row = (patch: Partial<UsageStatsRow> = {}): UsageStatsRow => ({ utcDay: 20_700, client: "codex", provider: "openai", model: "gpt-5",
  tokens: { input: "9007199254740993", cacheRead: "4", cacheWrite: "5", output: "6", reasoning: "7" }, records: 2,
  reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
  durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete", ...patch });
const filters: StatsFilters = { firstUtcDay: 20_700, dayCount: 1, client: ALL_STATS, provider: ALL_STATS, model: ALL_STATS, basis: "reported" };

test("the synthetic example satisfies the production numeric-only registry and report boundary", () => {
  expect(parseUsageStatsReport(example)).toEqual(example);
  expect(example.sources.map(source => source.client)).toEqual(["claude", "codex", "cursor", "devin-cli", "freebuff", "opencode", "warp"]);
  expect(example.revision).toBe(0);
  expect(example.updatedAtMs).toBeNull();
});

test("aggregation keeps all five disjoint token buckets exact without double-counting reasoning", () => {
  const total = sumStatsRows([row()]);
  expect(total.tokens).toBe(9_007_199_254_741_015n);
  expect(total.output + total.reasoning).toBe(13n);
  expect(total.reportedCost).toBeNull();
  expect(total.estimatedCost).toBeNull();
});

test("reported tokens never include estimated rows and unknown attribution remains filterable", () => {
  const reported = row({ model: null, breakdownCoverage: "partial" });
  const estimated = row({ tokenBasis: "estimated", tokens: { input: "100", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } });
  const report: UsageStatsReport = { ...example, rows: [reported, estimated] };
  expect(filterStatsRows(report, filters)).toEqual([reported]);
  expect(filterStatsRows(report, { ...filters, model: UNKNOWN_STATS })).toEqual([reported]);
  expect(filterStatsRows(report, { ...filters, basis: "estimated" })).toEqual([estimated]);
  expect(sumStatsRows([reported]).partialRecords).toBe(2);
});

test("cost-only records remain useful without becoming measured zero tokens", () => {
  const costOnly = row({ client: "crush", provider: null, model: null, tokenBasis: "unavailable", breakdownCoverage: "partial",
    tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, reportedCostMicrousd: "3000000", reportedCostRecords: 2 });
  const report: UsageStatsReport = { ...example, rows: [costOnly] };
  expect(filterStatsRows(report, filters)).toEqual([costOnly]);
  expect(filterStatsRows(report, { ...filters, basis: "estimated" })).toEqual([]);
  const total = sumStatsRows([costOnly]);
  expect(total.tokenRecords).toBe(0);
  expect(total.reportedCost).toBe(3_000_000n);
  expect(statsRowsCsv([costOnly])).toContain('"unavailable","","","","","","","2"');
});

test("Warp refresh snapshots never contribute to period usage and export their time basis", () => {
  const latest = example.rows.find(row => row.client === "warp")!;
  const older = { ...latest, utcDay: latest.utcDay - 1, reportedCostMicrousd: "99000000" };
  const report: UsageStatsReport = { ...example, rows: [...example.rows, older] };
  const ordinary = filterStatsRows(report, filters);
  const expected = sumStatsRows(example.rows.filter(row => row.utcDay === filters.firstUtcDay && row.client !== "warp" && row.tokenBasis === "reported"));
  expect(sumStatsRows(ordinary)).toEqual(expected);
  expect(filterStatsRows(report, { ...filters, client: "warp" })).toEqual([]);
  expect(filterStatsSnapshots(report, filters)).toEqual([latest]);
  expect(filterStatsSnapshots(report, { ...filters, firstUtcDay: latest.utcDay - 30 })).toEqual([latest]);
  expect(filterStatsSnapshots(report, { ...filters, client: "codex" })).toEqual([]);
  const csv = statsRowsCsv([...ordinary, ...filterStatsSnapshots(report, filters)]);
  expect(csv).toContain("utc_day,time_basis,client");
  expect(csv).toContain('"refresh_snapshot","warp"');
  expect(csv).toContain('"observed","codex"');
  expect(csv).not.toContain('"99000000"');
});

test("cost preserves a measured zero, missing value, independent bases and record coverage", () => {
  const rows = [row({ reportedCostMicrousd: "0", reportedCostRecords: 1 }), row({ estimatedCostMicrousd: "2000000", estimatedCostRecords: 2 })];
  const totals = sumStatsRows(rows);
  expect(totals.reportedCost).toBe(0n);
  expect(totals.reportedCostRecords).toBe(1);
  expect(totals.estimatedCost).toBe(2_000_000n);
  expect(totals.estimatedCostRecords).toBe(2);
  expect(formatStatsMoney(null)).toBe("Unavailable");
  expect(formatStatsMoney(0n)).toBe("$0.00");
  expect(formatStatsMoney(1n)).toBe("< $0.01");
  expect(formatStatsMoney(9_007_199_254_740_993n)).toBe("$9,007,199,254.74");
});

test("recorded duration stays exact and carries its own record and token coverage", () => {
  const timed = row({ durationMs: "9007199254740993", timedRecords: 1, timedTokens: "100" });
  const total = sumStatsRows([timed, row()]);
  expect(total.durationMs).toBe(9_007_199_254_740_993n);
  expect(total.timedRecords).toBe(1);
  expect(total.timedTokens).toBe(100n);
  expect(statsRowsCsv([timed])).toContain('"9007199254740993","1","100"');
  expect(statsRowsCsv([row()])).toContain('"","0",""\r\n');
});

test("model grouping preserves unknown rows, stable exact sorting, and complete shares", () => {
  const groups = groupStatsRows([row(), row({ model: null }), row({ model: "gpt-5", tokens: { input: "1", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } })], "model", "tokens");
  expect(groups.map(group => group.name)).toEqual(["gpt-5", "Unknown"]);
  expect(groups[0]!.totals.tokens).toBe(groups[1]!.totals.tokens + 1n);
});

test("custom UTC ranges reject normalized dates and overlarge ranges", () => {
  expect(statsInputRange("2024-02-29", "2024-03-01")?.dayCount).toBe(2);
  expect(statsInputRange("2025-02-29", "2025-03-01")).toBeNull();
  expect(statsInputRange("2024-01-01", "2024-12-31")?.dayCount).toBe(366);
  expect(statsInputRange("2024-01-01", "2025-01-01")).toBeNull();
  expect(statsInputRange("2024-03-01", "2024-02-29")).toBeNull();
});

test("comparison requires the entire equal-length prior window inside the declared report", () => {
  expect(previousStatsPeriod(example, { ...filters, firstUtcDay: example.firstUtcDay, dayCount: 30 })).toBeNull();
  expect(previousStatsPeriod(example, { ...filters, firstUtcDay: example.firstUtcDay + 30, dayCount: 30 })).not.toBeNull();
  expect(previousStatsPeriod(example, { ...filters, firstUtcDay: example.firstUtcDay + 89, dayCount: 2 })).toBeNull();
});

test("CSV keeps exact disjoint numeric fields and blank unknown costs", () => {
  const csv = statsRowsCsv([row({ model: null })]);
  expect(csv).toContain('"9007199254740993"');
  expect(csv).toContain('"9007199254741015"');
  expect(csv).toContain('"unknown"');
  expect(csv).toContain('"complete","","0","","0"');
  expect(csv).not.toContain("[object");
});

test("group and bucket totals reconcile for arbitrary exact numeric records, including partial final weeks", () => {
  fc.assert(fc.property(fc.array(fc.record({ day: fc.integer({ min: 0, max: 89 }), count: fc.integer({ min: 0, max: 1_000_000 }), unknown: fc.boolean() }), { maxLength: 100 }), samples => {
    const rows = samples.map(sample => row({ utcDay: 20_611 + sample.day, model: sample.unknown ? null : "gpt-5",
      tokens: { input: String(sample.count), cacheRead: "10", cacheWrite: "20", output: "30", reasoning: "40" } }));
    const total = sumStatsRows(rows).tokens;
    expect(groupStatsRows(rows, "model", "tokens").reduce((sum, group) => sum + group.totals.tokens, 0n)).toBe(total);
    const buckets = bucketStatsRows(rows, { firstUtcDay: 20_611, dayCount: 90 });
    expect(buckets.reduce((sum, bucket) => sum + bucket.totals.tokens, 0n)).toBe(total);
    expect(buckets.at(-1)?.dayCount).toBe(6);
  }), { numRuns: 100, seed: 741 });
});
