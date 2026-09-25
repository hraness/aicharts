import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { METRIC_CATALOG, MAX_METRIC_CATALOG_BYTES } from "./metric-explorer-catalog";
import { createMetricSnapshot, evaluateMetricQuery, MAX_METRIC_QUERY_IDS, metricResultJson, metricSnapshotDigest, parseMetricQuery, SUPPORTED_METRIC_IDS, type MetricQuery, type MetricResult } from "./metric-explorer";
import { parseUsageStatsReport, statsRowKey, type UsageStatsReport, type UsageStatsRow } from "./stats-contract";
import { projectMetricCatalog, generateMetricCatalog } from "../../scripts/generate-metric-catalog";
import { addMetricRow, decodeMetricRow, finishMetricFold, metricAccumulator } from "./metric-explorer-fold";

const row = (values: Partial<UsageStatsRow> = {}): UsageStatsRow => ({ utcDay: 20_700, client: "codex", provider: "openai", model: null,
  tokens: { input: "12", cacheRead: "8", cacheWrite: "5", output: "20", reasoning: "5" }, records: 1,
  reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
  durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete", ...values });
function report(rows: readonly UsageStatsRow[], extra: Partial<UsageStatsReport> = {}): UsageStatsReport {
  const clients = [...new Set(rows.map(row => row.client))].sort();
  const value = { schemaVersion: 2, profile: "client-stats-v2", registryRevision: 1, firstUtcDay: 20_690, dayCount: 20,
    generatedAtMs: 20_710 * 86_400_000, revision: 0, updatedAtMs: null,
    sources: clients.map(client => { const values = rows.filter(row => row.client === client), bases = new Set(values.map(row => row.tokenBasis));
      return { client, status: "observed", tokenBasis: bases.size === 1 ? [...bases][0] : "mixed", records: values.reduce((sum, row) => sum + row.records, 0), warnings: 0, latestAtMs: 20_709 * 86_400_000 }; }),
    rows: [...rows].sort((a, b) => statsRowKey(a).localeCompare(statsRowKey(b), "en")), ...extra };
  const parsed = parseUsageStatsReport(value); expect(parsed).not.toBeNull(); return parsed!;
}
const query = (extra: Partial<MetricQuery> = {}): MetricQuery => ({ schemaVersion: 1, firstUtcDay: 20_700, dayCount: 10,
  filters: { client: "*", provider: "*", model: "*" }, basis: "reported", costKind: "estimated", groupBy: ["client"],
  metricIds: ["accounted-tokens"], topK: 10, sortBy: "accounted-tokens", sortDirection: "desc", ...extra,
  ...(!extra.sortBy && extra.metricIds ? { sortBy: extra.metricIds[0] } : {}) });
function run(value: UsageStatsReport, request = query()): MetricResult {
  const snapshot = createMetricSnapshot(value); expect(snapshot).not.toBeNull();
  const result = evaluateMetricQuery(snapshot!, request); if (!result.ok) throw new Error(result.code); return result.value;
}

test("compact catalog is an exhaustive bounded projection of all241 registry definitions", async () => {
  const full = JSON.parse(await readFile("verify/assurance/metrics.json", "utf8")) as unknown;
  expect(projectMetricCatalog(full)).toEqual([...METRIC_CATALOG]);
  expect(METRIC_CATALOG).toHaveLength(241);
  expect((await generateMetricCatalog(true)).bytes).toBeLessThanOrEqual(MAX_METRIC_CATALOG_BYTES);
  expect(new Set(METRIC_CATALOG.map(entry => entry.id)).size).toBe(241);
  for (const id of SUPPORTED_METRIC_IDS) expect(METRIC_CATALOG.some(metric => metric.id === id)).toBe(true);
});

test("exact token roles, cache denominators and reasoning subsets retain integer arithmetic", () => {
  const result = run(report([row()]), query({ metricIds: ["accounted-tokens", "inclusive-output-tokens", "reasoning-output-share", "cached-input-share", "input-output-token-ratio"] }));
  expect(result.measures.map(value => value.value)).toEqual([
    { kind: "integer", amount: 50n }, { kind: "integer", amount: 25n },
    { kind: "ratio", numerator: 5n, denominator: 25n }, { kind: "ratio", numerator: 8n, denominator: 25n },
    { kind: "ratio", numerator: 25n, denominator: 25n },
  ]);
  const huge = "16777216000000";
  const large = run(report([row({ records: 10_000_000, tokens: { input: huge, cacheRead: huge, cacheWrite: huge, output: huge, reasoning: huge } })]));
  expect(large.fold.total).toBe(BigInt(huge) * 5n);
});

test("partial categories stay outside exact ratio cohorts and unknown never supplies zero", () => {
  const partial = row({ utcDay: 20_701, tokens: { input: "100", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, breakdownCoverage: "partial" });
  const value = run(report([row(), partial]), query({ metricIds: ["accounted-tokens", "cached-input-share"] }));
  expect(value.measures[1]).toMatchObject({ value: { numerator: 8n, denominator: 25n }, status: "partial", eligibleRecords: 1n, excludedRecords: 1n });
  const missing = run(report([partial]), query({ metricIds: ["accounted-tokens", "cache-read-tokens"] }));
  expect(missing.measures[1]).toMatchObject({ value: null, reason: "missing-categories" });
  const zero = row({ tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } });
  expect(run(report([zero])).measures[0].value).toEqual({ kind: "integer", amount: 0n });
  const absent = row({ ...zero, tokenBasis: "unavailable", breakdownCoverage: "partial" });
  expect(run(report([absent])).measures[0]).toMatchObject({ value: null, reason: "no-observations" });
  expect(run(report([zero]), query({ metricIds: ["accounted-tokens", "cached-input-share"] })).measures[1]).toMatchObject({ value: null, reason: "zero-denominator" });
});

test("each cost kind has its own wholly priced token denominator and zero charge is observed", () => {
  const input = report([
    row({ estimatedCostMicrousd: "200", estimatedCostRecords: 1 }),
    row({ utcDay: 20_701, reportedCostMicrousd: "1000", reportedCostRecords: 1 }),
    row({ utcDay: 20_702, records: 2, estimatedCostMicrousd: "999", estimatedCostRecords: 1 }),
  ]);
  const metricIds = ["source-reported-charge", "dated-retail-estimated-cost", "effective-usd-per-million-total-tokens", "pricing-record-coverage", "unpriced-records"];
  const estimate = run(input, query({ metricIds, sortBy: metricIds[0] }));
  expect(estimate.measures[2]).toMatchObject({ value: { numerator: 200n, denominator: 50n }, eligibleRecords: 1n, excludedRecords: 3n });
  expect(estimate.measures[3].value).toEqual({ kind: "ratio", numerator: 3n, denominator: 4n });
  expect(estimate.measures[4].value).toEqual({ kind: "integer", amount: 1n });
  expect(run(input, query({ metricIds, sortBy: metricIds[0], costKind: "reported" })).measures[2].value).toEqual({ kind: "ratio", numerator: 1000n, denominator: 50n });
  const free = run(report([row({ reportedCostMicrousd: "0", reportedCostRecords: 1 })]), query({ metricIds: ["source-reported-charge"], sortBy: "source-reported-charge" }));
  expect(free.measures[0].value).toEqual({ kind: "integer", amount: 0n });
});

test("source-duration rates exclude unknown-token durations instead of diluting a mismatched rate", () => {
  const result = run(report([
    row({ durationMs: "100", timedTokens: "50", timedRecords: 1 }),
    row({ utcDay: 20_701, tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, tokenBasis: "unavailable", breakdownCoverage: "partial", durationMs: "900", timedRecords: 1 }),
  ]), query({ metricIds: ["tokens-per-source-duration-second"], sortBy: "tokens-per-source-duration-second" }));
  expect(result.fold.durationMs).toBe(1000n);
  expect(result.measures[0]).toMatchObject({ value: { numerator: 50_000n, denominator: 100n }, eligibleRecords: 1n, excludedRecords: 1n });
});

test("global topK plus Other conserves the independent selected fold for seeded two-dimension queries", () => {
  let seed = 0x7142cafe;
  const rows: UsageStatsRow[] = [];
  for (let day = 20_690; day < 20_710; day++) for (const client of ["codex", "claude", "cursor"] as const) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    rows.push(row({ utcDay: day, client, provider: client === "claude" ? "anthropic" : "openai", tokens: { input: String((seed >>> 0) % 8_000_000), cacheRead: "2", cacheWrite: "3", output: "5", reasoning: "7" } }));
  }
  const input = report(rows), snapshot = createMetricSnapshot(input)!;
  for (const first of [20_690, 20_695, 20_700]) for (const client of ["*", "codex", "claude"]) {
    const result = evaluateMetricQuery(snapshot, query({ firstUtcDay: first, dayCount: 5, filters: { client, provider: "*", model: "*" }, groupBy: ["client", "utc-day"], topK: 2 }));
    if (!result.ok) throw new Error(result.code);
    const eligible = rows.filter(row => row.utcDay >= first && row.utcDay < first + 5 && (client === "*" || row.client === client));
    const expected = eligible.reduce((sum, row) => sum + Object.values(row.tokens).reduce((sum, value) => sum + BigInt(value), 0n), 0n);
    expect(result.value.fold.total).toBe(expected);
    expect(result.value.groups.reduce((sum, group) => sum + group.fold.total, 0n)).toBe(expected);
    expect(result.value.groups.reduce((sum, group) => sum + group.fold.records, 0n)).toBe(BigInt(eligible.length));
    expect(result.value.groups).toHaveLength(3);
    expect(result.value.groups.at(-1)?.other).toBe(true);
    expect(result.value.rows).toHaveLength(eligible.length);
  }
});

test("table and composition Other each equal direct omitted-row folds across complement and addition paths", () => {
  const rows = Array.from({ length: 54 }, (_, index) => row({ utcDay: 20_690 + Math.floor(index / 3), client: ["codex", "claude", "cursor"][index % 3] as UsageStatsRow["client"],
    records: 2, tokens: { input: String(index * 11), cacheRead: "2", cacheWrite: "3", output: "5", reasoning: "7" },
    reportedCostMicrousd: index % 3 === 0 ? "0" : null, reportedCostRecords: index % 3 === 0 ? 2 : 0,
    estimatedCostMicrousd: index % 3 === 1 ? String(1000 - index) : null, estimatedCostRecords: index % 3 === 1 ? index % 2 + 1 : 0,
    durationMs: index % 2 === 0 ? String(index * 100) : null, timedRecords: index % 2 === 0 ? 1 : 0,
    timedTokens: index % 2 === 0 ? String(index) : "0", breakdownCoverage: index % 5 === 0 ? "partial" : "complete" }));
  const input = report(rows);
  for (const topK of [1, 2, 50]) for (const sortBy of ["accounted-tokens", "dated-retail-estimated-cost", "label"]) {
    const result = run(input, query({ firstUtcDay: 20_690, dayCount: 20, groupBy: ["client", "utc-day"], topK, sortBy,
      metricIds: ["accounted-tokens", "dated-retail-estimated-cost", "source-reported-charge", "cached-input-share", "tokens-per-source-duration-second"] }));
    for (const groups of [result.groups, result.composition]) {
      const selected = new Set(groups.filter(group => !group.other).map(group => group.key));
      const omitted = rows.filter(row => !selected.has(JSON.stringify([row.client, String(row.utcDay)]))), direct = metricAccumulator();
      for (const row of omitted) addMetricRow(direct, decodeMetricRow(row));
      expect(groups.find(group => group.other)?.fold).toEqual(finishMetricFold(direct));
    }
    expect(result.otherGroups).toBe(54 - topK);
  }
});

test("aligned dates and populated prior days do not invent matched exposure evidence", () => {
  const result = run(report([row({ utcDay: 20_690 }), row()]), query({ metricIds: ["accounted-tokens", "previous-period-token-change", "previous-period-token-change-percent", "compare-periods", "compare-clients", "compare-models"] }));
  expect(result.previous).toMatchObject({ matched: false, reason: "period-coverage-unavailable" });
  expect(result.previous?.fold.total).toBe(50n);
  expect(result.measures.slice(1).every(metric => metric.value === null && metric.reason === "period-coverage-unavailable")).toBe(true);
  expect(result.coverage.unobservedDays).toBe(9);
});

test("positive activity and anchored streaks do not count zero, unknown or an earlier longer run", () => {
  const zero = { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" };
  const input = report([0, 1, 2, 8, 9].map(offset => row({ utcDay: 20_700 + offset })).concat([
    row({ utcDay: 20_703, tokens: zero }), row({ utcDay: 20_704, tokens: zero, tokenBasis: "unavailable", breakdownCoverage: "partial" }),
  ]));
  const metrics = ["observed-active-days", "observed-usage-streak"];
  expect(run(input, query({ metricIds: metrics })).measures.map(value => value.value)).toEqual([{ kind: "integer", amount: 5n }, { kind: "integer", amount: 2n }]);
  expect(run(input, query({ dayCount: 8, metricIds: metrics })).measures[1].value).toEqual({ kind: "integer", amount: 0n });
});

test("rolling windows exclude the generated partial UTC day and require the entire prior window", () => {
  const input = report(Array.from({ length: 10 }, (_, offset) => row({ utcDay: 20_700 + offset })), { generatedAtMs: 20_709 * 86_400_000 + 12 * 3_600_000 });
  const result = run(input, query({ metricIds: ["rolling-7-day-tokens"] }));
  expect(result.measures[0].value).toEqual({ kind: "integer", amount: 350n });
  expect(result.measures[0].eligibleRecords).toBe(7n);
  expect(run(input, query({ firstUtcDay: 20_703, dayCount: 7, metricIds: ["rolling-7-day-tokens"] })).measures[0]).toMatchObject({ value: null, reason: "insufficient-window" });
});

test("calendar and category definitions require their declared grouping", () => {
  const input = report([row()]);
  expect(run(input, query({ metricIds: ["utc-week-tokens"] })).measures[0]).toMatchObject({ value: null, reason: "grouping-required" });
  expect(run(input, query({ groupBy: ["client", "utc-week"], metricIds: ["utc-week-tokens"], sortBy: "utc-week-tokens" })).measures[0].value).toEqual({ kind: "integer", amount: 50n });
});

test("metric exports reject copied results even when a valid snapshot is supplied", async () => {
  const value = run(report([row()]));
  expect(() => metricResultJson({ ...value, rows: [] })).toThrow("metric_result_invalid");
});

test("same-time revision-zero reports have independent immutable captures and content bindings", async () => {
  const first = createMetricSnapshot(report([row()]))!, second = createMetricSnapshot(report([row({ tokens: { input: "13", cacheRead: "8", cacheWrite: "5", output: "20", reasoning: "5" } })]))!;
  expect(first).not.toBe(second); expect(first).toEqual(second);
  expect(await metricSnapshotDigest(first)).not.toBe(await metricSnapshotDigest(second));
  const result = evaluateMetricQuery(first, query()); if (!result.ok) throw new Error(result.code);
  expect(Object.isFrozen(result.value.fold.tokens)).toBe(true);
  const exported = JSON.parse(await metricResultJson(result.value)) as { snapshot: { sha256: string }; measures: { value: { amount: string } }[] };
  expect(exported.snapshot.sha256).toBe(await metricSnapshotDigest(first)); expect(exported.measures[0].value.amount).toBe("50");
});

test("query admission bounds metrics, dimensions and public filters without running accessors", () => {
  expect(parseMetricQuery(query())).not.toBeNull();
  for (const changed of [{ topK: 51 }, { dayCount: 367 }, { metricIds: Array(MAX_METRIC_QUERY_IDS + 1).fill("accounted-tokens") },
    { groupBy: ["client", "provider", "model"] }, { groupBy: ["client", "client"] }, { filters: { client: "private-session-label", provider: "*", model: "*" } },
    { sortBy: "missing-id" }, { surprise: 1 }]) expect(parseMetricQuery({ ...query(), ...changed })).toBeNull();
  let invoked = 0;
  const hostile = Object.defineProperty({ ...query() }, "basis", { enumerable: true, get() { invoked++; return "reported"; } });
  expect(parseMetricQuery(hostile)).toBeNull(); expect(invoked).toBe(0);
  const snapshot = createMetricSnapshot(report([row()]))!;
  expect(evaluateMetricQuery(snapshot, query({ firstUtcDay: 20_689 }))).toEqual({ ok: false, code: "metric_range_unavailable" });
});

test("billing refresh snapshots remain outside every daily fold and selected-date total", () => {
  const warp = row({ client: "warp", provider: null, tokenBasis: "unavailable", breakdownCoverage: "partial",
    tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, reportedCostMicrousd: "12000000", reportedCostRecords: 1 });
  const value = run(report([warp, row({ ...warp, utcDay: 20_705, reportedCostMicrousd: "14000000" })]));
  expect(value.rows).toHaveLength(0); expect(value.fold.reportedCost).toBeNull(); expect(value.measures[0].value).toBeNull();
  expect(value.refreshSnapshot.rows).toHaveLength(1); expect(value.refreshSnapshot.fold.reportedCost).toBe(14_000_000n);
  expect(value.refreshSnapshot.utcDay).toBe(20_705);
});
