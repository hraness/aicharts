import { expect, test } from "bun:test";
import fc from "fast-check";
import { parseUsageStatsJson, parseUsageStatsReport, statsTokenTotal, type UsageStatsReport } from "./stats-contract";
import { parseStatsUpload } from "./stats-http-contract";
import { STATS_CLIENTS } from "./stats-registry";
import nativeFixture from "../../fixtures/usage/stats-v2.json";

export function statsFixture(): UsageStatsReport {
  return { schemaVersion: 2, profile: "client-stats-v2", registryRevision: 1, firstUtcDay: 20_715, dayCount: 1,
    generatedAtMs: 20_716 * 86_400_000 - 1, revision: 0, updatedAtMs: null,
    sources: [{ client: "codex", status: "observed", tokenBasis: "reported", records: 1, warnings: 0, latestAtMs: 20_715 * 86_400_000 }],
    rows: [{ utcDay: 20_715, client: "codex", provider: "openai", model: "gpt-5", tokens: { input: "100", cacheRead: "30", cacheWrite: "10", output: "20", reasoning: "5" }, records: 1,
      reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
      durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "partial" }] };
}
test("v2 round trips exact disjoint buckets and owns immutable input", () => {
  const raw = statsFixture(), parsed = parseUsageStatsReport(raw);
  expect(parsed).toEqual(raw); expect(statsTokenTotal(parsed!.rows[0].tokens)).toBe(165n);
  expect(parsed).not.toBe(raw); expect(Object.isFrozen(parsed!.rows[0].tokens)).toBe(true);
  expect(parseUsageStatsJson(JSON.stringify(raw))).toEqual(parsed);
  expect(STATS_CLIENTS.length).toBeGreaterThanOrEqual(53);
  expect(parseUsageStatsReport(nativeFixture)).toEqual(parsed);
});
test("canonical integer strings retain more than double precision", () => {
  fc.assert(fc.property(fc.bigInt({ min: 0n, max: 999_999_999_999_999_999_999_999n }), count => {
    const raw = statsFixture(), row = raw.rows[0];
    const parsed = parseUsageStatsReport({ ...raw, rows: [{ ...row, tokens: { ...row.tokens, input: String(count) } }] });
    expect(parsed?.rows[0].tokens.input).toBe(String(count));
  }), { numRuns: 150 });
  for (const input of ["-1", "01", "1.0", "1e3", " 0", "1".repeat(25), 10, null]) {
    const raw = statsFixture(); expect(parseUsageStatsReport({ ...raw, rows: [{ ...raw.rows[0], tokens: { ...raw.rows[0].tokens, input } }] })).toBeNull();
  }
});
test("untrusted identities, extra fields, getters and sparse arrays cannot enter reports", () => {
  const raw = statsFixture(); let invoked = 0;
  const accessor = { ...raw }; Object.defineProperty(accessor, "rows", { enumerable: true, get() { invoked++; return []; } });
  const sparse = Array(1);
  for (const value of [accessor, { ...raw, email: "PRIVATE_CANARY" }, { ...raw, rows: sparse },
    { ...raw, rows: [{ ...raw.rows[0], model: "PRIVATE_MODEL" }] }, { ...raw, rows: [{ ...raw.rows[0], provider: "PRIVATE_ENDPOINT" }] },
    { ...raw, rows: [{ ...raw.rows[0], prompt: "PRIVATE_TEXT" }] }, Object.assign(Object.create({ inherited: true }), raw)]) expect(parseUsageStatsReport(value)).toBeNull();
  expect(invoked).toBe(0);
});
test("duplicate rows, coverage mismatches and out-of-range data are rejected", () => {
  const raw = statsFixture();
  for (const value of [{ ...raw, rows: [...raw.rows, ...raw.rows] }, { ...raw, sources: [] }, { ...raw, rows: [] },
    { ...raw, dayCount: 367 }, { ...raw, firstUtcDay: 99_999_999, dayCount: 2 },
    { ...raw, rows: [{ ...raw.rows[0], utcDay: raw.firstUtcDay + 1 }] },
    { ...raw, sources: [{ ...raw.sources[0], status: "not_found" }] }, { ...raw, revision: 1 },
    { ...raw, sources: [{ ...raw.sources[0], latestAtMs: raw.generatedAtMs + 1 }] }]) expect(parseUsageStatsReport(value)).toBeNull();
});
test("implausible per-record token totals are refused at upload admission but committed history still parses", () => {
  const raw = statsFixture(), row = raw.rows[0];
  const upload = (rows: UsageStatsReport["rows"], records = 1) => parseStatsUpload({ schemaVersion: 2, operationId: "11".repeat(32),
    accountId: `acct_${"22".repeat(16)}`, deviceId: "33".repeat(32), generation: "44".repeat(32), sequence: 1, expectedRevision: 0,
    mode: "replace-window", takeover: null, report: { ...raw, sources: [{ ...raw.sources[0], records }], rows } });
  // The row's other buckets carry 65 tokens; 1 record admits 8_388_608 total.
  const admitted = { ...row, tokens: { ...row.tokens, input: String(8_388_608n - 65n) } };
  expect(statsTokenTotal(admitted.tokens)).toBe(8_388_608n);
  expect(upload([admitted])).not.toBeNull();
  const refused = { ...row, tokens: { ...row.tokens, input: String(8_388_608n - 65n + 1n) } };
  expect(upload([refused])).toBeNull();
  // The failure mode this prevents: a forked rollout's inherited cumulative
  // counter admitted as usage — 12B over a few hundred records.
  const leaked = { ...row, records: 300, tokens: { ...row.tokens, input: "12000000000" } };
  expect(upload([leaked], 300)).toBeNull();
  // Averages stay legal: many records may carry a large total.
  const honest = { ...row, records: 300, tokens: { ...row.tokens, input: String(300n * 8_388_608n - 65n) } };
  expect(upload([honest], 300)).not.toBeNull();
  // A value committed before the bound existed is stored history: stored-day
  // re-reads and query replies must keep parsing it rather than refusing the account.
  const committed = parseUsageStatsReport({ ...raw, revision: 7, updatedAtMs: raw.generatedAtMs, sources: [{ ...raw.sources[0], records: 300 }], rows: [leaked] });
  expect(committed?.rows[0].tokens.input).toBe("12000000000");
});
test("known zero costs differ from unknown and cost populations cannot overlap", () => {
  const raw = statsFixture(), row = raw.rows[0];
  expect(parseUsageStatsReport({ ...raw, rows: [{ ...row, reportedCostMicrousd: "0", reportedCostRecords: 1 }] })).not.toBeNull();
  for (const changes of [{ reportedCostMicrousd: "0" }, { reportedCostRecords: 1 }, { reportedCostMicrousd: "1", reportedCostRecords: 1, estimatedCostMicrousd: "2", estimatedCostRecords: 1 },
    { durationMs: "1", timedRecords: 1, timedTokens: "166" }]) expect(parseUsageStatsReport({ ...raw, rows: [{ ...row, ...changes }] })).toBeNull();
});
test("cost-only observations preserve unknown token counts", () => {
  const raw = statsFixture();
  const value = { ...raw, sources: [{ ...raw.sources[0], tokenBasis: "unavailable" }], rows: [{ ...raw.rows[0],
    tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, tokenBasis: "unavailable", reportedCostMicrousd: "10000", reportedCostRecords: 1 }] };
  expect(parseUsageStatsReport(value)).not.toBeNull();
  expect(parseUsageStatsReport({ ...value, rows: [{ ...value.rows[0], tokens: { ...value.rows[0].tokens, input: "1" } }] })).toBeNull();
});
