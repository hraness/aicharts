import { expect, test } from "bun:test";
import fc from "fast-check";
import { createUsageStatsExample } from "@/lib/usage/stats-example";
import { parseUsageStatsReport, parseUsageStatsRow, type UsageStatsReport, type UsageStatsRow } from "@/lib/usage/stats-contract";
import { ALL_STATS, UNKNOWN_STATS, bucketStatsRows, filterStatsRows, filterStatsSnapshots, formatStatsMoney, groupStatsRows, previousStatsPeriod, statsBucketValue, statsCacheReadShare, statsDayGrid, statsInputRange, statsRowsCsv, statsSourceTokenRate, statsSplitBuckets, statsSummaryText, sumStatsRows, type StatsFilters } from "./stats-view";

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
  expect(total.timedTokenRecords).toBe(1);
  expect(statsRowsCsv([timed])).toContain('"9007199254740993","1","100"');
  expect(statsRowsCsv([row()])).toContain('"","0","","source-defined","unknown"\r\n');
});

test("unknown timed tokens withhold source rates without erasing recorded durations or inventing CSV zeros", () => {
  const known = row({ records: 1, durationMs: "1000", timedRecords: 1, timedTokens: "100",
    tokens: { input: "100", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } });
  const unknown = row({ client: "cursor", records: 1, durationMs: "1000", timedRecords: 1, timedTokens: "0",
    tokenBasis: "unavailable", breakdownCoverage: "partial",
    tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } });
  expect(parseUsageStatsRow(known)).toEqual(known);
  expect(parseUsageStatsRow(unknown)).toEqual(unknown);
  expect(statsSourceTokenRate(sumStatsRows([known]))).toBe(100n);
  for (const rows of [[unknown], [known, unknown], [unknown, known]]) {
    const totals = sumStatsRows(rows);
    expect(totals.durationMs).toBe(BigInt(rows.length) * 1000n);
    expect(totals.timedRecords).toBe(rows.length);
    expect(totals.timedTokenRecords).toBe(rows.length - 1);
    expect(statsSourceTokenRate(totals)).toBeNull();
    expect(statsBucketValue(totals, "speed")).toBeNull();
    expect(statsBucketValue(bucketStatsRows(rows, filters)[0]!.totals, "speed")).toBeNull();
    const summary = statsSummaryText("local", filters, totals, "one day", []);
    expect(summary).toContain("source-token rate unavailable: tokens missing from timed records");
    expect(summary).not.toContain("tokens per source-duration second");
  }
  const groups = groupStatsRows([known, unknown], "client", "tokens");
  expect(statsSourceTokenRate(groups.find(group => group.key === "codex")!.totals)).toBe(100n);
  expect(statsSourceTokenRate(groups.find(group => group.key === "cursor")!.totals)).toBeNull();
  expect(statsRowsCsv([unknown])).toContain('"1000","1","","source-defined","source-defined"\r\n');
  expect(statsRowsCsv([known])).toContain('"1000","1","100","source-defined","source-defined"\r\n');
});

test("source rates preserve observed zero and weight exact matched durations, while untimed unknown rows do not dilute them", () => {
  const zero = row({ records: 1, durationMs: "1000", timedRecords: 1, timedTokens: "0",
    tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } });
  expect(parseUsageStatsRow(zero)).toEqual(zero);
  expect(statsSourceTokenRate(sumStatsRows([zero]))).toBe(0n);
  expect(statsSourceTokenRate(sumStatsRows([{ ...zero, tokenBasis: "estimated" }]))).toBe(0n);
  expect(statsSourceTokenRate(sumStatsRows([{ ...zero, durationMs: "0" }]))).toBeNull();
  expect(statsSourceTokenRate(sumStatsRows([]))).toBeNull();
  const untimed = { ...zero, tokenBasis: "unavailable" as const, breakdownCoverage: "partial" as const,
    durationMs: null, timedRecords: 0 };
  expect(parseUsageStatsRow(untimed)).toEqual(untimed);
  const known = [row({ records: 1, durationMs: "1000", timedRecords: 1, timedTokens: "100" }),
    row({ records: 1, durationMs: "3000", timedRecords: 1, timedTokens: "900" })];
  expect(statsSourceTokenRate(sumStatsRows(known))).toBe(250n);
  expect(statsSourceTokenRate(sumStatsRows([...known, untimed]))).toBe(250n);
  expect(statsRowsCsv([zero])).toContain('"1000","1","0","source-defined","source-defined"\r\n');
});

test("source-rate eligibility is order independent across generated known and unknown timed populations", () => {
  fc.assert(fc.property(fc.array(fc.record({
    tokens: fc.bigInt({ min: 0n, max: 10n ** 24n - 1n }), duration: fc.bigInt({ min: 1n, max: 10n ** 20n }),
    unknown: fc.boolean(), records: fc.integer({ min: 1, max: 1000 }),
  }), { minLength: 1, maxLength: 30 }), samples => {
    const rows = samples.map(sample => row({ records: sample.records, timedRecords: sample.records,
      timedTokens: sample.unknown ? "0" : String(sample.tokens), durationMs: String(sample.duration),
      tokenBasis: sample.unknown ? "unavailable" : "reported", breakdownCoverage: sample.unknown ? "partial" : "complete",
      tokens: { input: sample.unknown ? "0" : String(sample.tokens), cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } }));
    for (const value of rows) expect(parseUsageStatsRow(value)).toEqual(value);
    const expected = samples.some(sample => sample.unknown) ? null
      : samples.reduce((sum, sample) => sum + sample.tokens, 0n) * 1000n / samples.reduce((sum, sample) => sum + sample.duration, 0n);
    expect(statsSourceTokenRate(sumStatsRows(rows))).toBe(expected);
    expect(statsSourceTokenRate(sumStatsRows([...rows].reverse()))).toBe(expected);
  }), { numRuns: 100, seed: 23092026 });
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

test("metric bucket values keep unobserved gaps honest instead of fabricating zero", () => {
  const totals = sumStatsRows([row()]);
  expect(statsBucketValue(totals, "tokens")).toBe(9_007_199_254_741_015n);
  expect(statsBucketValue(totals, "records")).toBe(2n);
  expect(statsBucketValue(totals, "speed")).toBeNull();
  const timed = sumStatsRows([row({ durationMs: "2000", timedRecords: 2, timedTokens: "300" })]);
  expect(statsBucketValue(timed, "speed")).toBe(150n);
  const unobserved = sumStatsRows([row({ tokenBasis: "unavailable", breakdownCoverage: "partial",
    tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, timedTokens: "0" })]);
  expect(statsBucketValue(unobserved, "tokens")).toBeNull();
  expect(statsBucketValue(unobserved, "records")).toBe(2n);
});

test("calendar cells sit column-major with quartile tiers, a peak, and month marks", () => {
  const weekday = new Date(20_700 * 86_400_000).getUTCDay();
  const rows = [row({ utcDay: 20_700 }), row({ utcDay: 20_701, tokens: { input: "10", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } }),
    row({ utcDay: 20_705, tokens: { input: "9999", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } }),
    row({ utcDay: 20_702, client: "warp", tokenBasis: "unavailable", breakdownCoverage: "partial",
      tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, timedTokens: "0" })];
  const grid = statsDayGrid(rows, { firstUtcDay: 20_700, dayCount: 10 });
  expect(grid.weeks).toBe(Math.ceil((weekday + 10) / 7));
  expect(grid.cells[weekday]?.utcDay).toBe(20_700);
  expect(grid.cells[weekday + 1]?.utcDay).toBe(20_701);
  expect(grid.cells[7]?.utcDay).toBe(20_700 + (7 - weekday));
  expect(grid.cells[weekday]?.tier).toBe(4);
  expect(grid.cells[weekday + 1]?.tier).toBe(1);
  expect(grid.cells[(Math.floor((weekday + 5) / 7)) * 7 + new Date(20_705 * 86_400_000).getUTCDay()]?.tier).toBe(2);
  const unknownCell = grid.cells.find(cell => cell?.utcDay === 20_702);
  expect(unknownCell?.records).toBe(2);
  expect(unknownCell?.tokenRecords).toBe(0);
  expect(unknownCell?.tier).toBe(0);
  expect(grid.activeDays).toBe(4);
  expect(grid.peak?.utcDay).toBe(20_700);
  const september = statsInputRange("2026-08-15", "2026-09-15");
  expect(september).not.toBeNull();
  const marked = statsDayGrid(rows, september ?? { firstUtcDay: 0, dayCount: 0 }).monthMarks.map(mark => mark.label);
  expect(marked).toContain("Sep");
  expect(marked).not.toContain("Aug");
});

test("stacked buckets reconcile with plain totals and fold beyond five series into Other", () => {
  const range = { firstUtcDay: example.firstUtcDay, dayCount: example.dayCount };
  const filtered = filterStatsRows(example, { ...filters, ...range });
  const split = statsSplitBuckets(filtered, range, "client");
  const plain = bucketStatsRows(filtered, range);
  split.buckets.forEach((bucket, index) => {
    expect(bucket.segments.reduce((sum, segment) => sum + segment.tokens, 0n)).toBe(plain[index]?.totals.tokens);
    expect(bucket.segments.reduce((sum, segment) => sum + segment.records, 0)).toBe(plain[index]?.totals.records);
  });
  expect(split.series.map(item => item.key).sort()).toEqual(["claude", "codex", "cursor", "devin-cli"]);
  const wide = [0, 1, 2, 3, 4, 5, 6].map(index => row({ utcDay: 20_700 + index, model: `m-${index}`,
    tokens: { input: String(100 - index), cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } }));
  const stacked = statsSplitBuckets(wide, { firstUtcDay: 20_700, dayCount: 7 }, "model");
  expect(stacked.series.map(item => item.name)).toEqual(["m-0", "m-1", "m-2", "m-3", "m-4", "Other"]);
  expect(stacked.series.at(-1)?.slot).toBe(5);
  expect(stacked.buckets[0]?.segments.every(segment => segment.slot >= 0)).toBe(true);
  const onlyRecords = statsSplitBuckets([row({ tokenBasis: "unavailable", breakdownCoverage: "partial",
    tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, timedTokens: "0" })], { firstUtcDay: 20_700, dayCount: 1 }, "client");
  expect(onlyRecords.buckets[0]?.segments[0]?.tokens).toBe(0n);
  expect(onlyRecords.buckets[0]?.segments[0]?.records).toBe(2);
});

test("the shareable summary states basis, scope, velocity, and partial coverage honestly", () => {
  const range = { firstUtcDay: example.firstUtcDay + 30, dayCount: 30 };
  const filtered = filterStatsRows(example, { ...filters, ...range });
  const totals = sumStatsRows(filtered);
  const text = statsSummaryText("local", { ...filters, ...range }, totals, "Jul 20–Aug 18, 2026", groupStatsRows(filtered, "model", "tokens"));
  expect(text).toContain("reported token basis");
  expect(text).toContain("usage records");
  expect(text).toContain("active days");
  expect(text).toContain("Reported cost");
  expect(text).toContain("tokens per source-duration second");
  expect(text).toContain("not decode speed");
  expect(text).toContain("Top by tokens");
  expect(text).toContain("local report");
  expect(text).toContain("coverage may be partial");
  const empty = statsSummaryText("example", filters, sumStatsRows([]), "Sep 22, 2026", []);
  expect(empty).toContain("tokens unobserved");
  expect(empty).toContain("synthetic example");
  expect(empty).not.toContain("Reported cost");
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


test("cache-read share includes write tokens and refuses incomplete categories", () => {
  const complete = row({ tokens: { input: "0", cacheRead: "100", cacheWrite: "900", output: "0", reasoning: "0" } });
  expect(statsCacheReadShare(sumStatsRows([complete]))).toBe(10);
  expect(statsCacheReadShare(sumStatsRows([{ ...complete, breakdownCoverage: "partial" }]))).toBeNull();
  expect(statsCacheReadShare(sumStatsRows([]))).toBeNull();
  expect(statsCacheReadShare(sumStatsRows([row({ tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "10", reasoning: "0" } })]))).toBeNull();
  const text = statsSummaryText("local", filters, sumStatsRows([complete]), "one day", []);
  expect(text).toContain("cache reads 10% of whole input (uncached + read + write)");
});

test("complete cache shares obey exact token-weighted arithmetic at integer boundaries", () => {
  fc.assert(fc.property(fc.bigInt({ min: 0n, max: 10n ** 25n }), fc.bigInt({ min: 0n, max: 10n ** 25n }), fc.bigInt({ min: 0n, max: 10n ** 25n }), (input, read, write) => {
    const total = sumStatsRows([row({ tokens: { input: String(input), cacheRead: String(read), cacheWrite: String(write), output: "0", reasoning: "0" } })]);
    const share = statsCacheReadShare(total), denominator = input + read + write;
    expect(share).toBe(denominator === 0n ? null : Number(10000n * read / denominator) / 100);
    if (share !== null) { expect(share).toBeGreaterThanOrEqual(0); expect(share).toBeLessThanOrEqual(100); }
  }));
});
