import { cpus, platform, arch } from "node:os";
import registry from "../data/usage-registry.json";
import { parseUsageStatsJson, parseUsageStatsReport, statsRowKey, type UsageStatsReport, type UsageStatsRow } from "../lib/usage/stats-contract";
import { ALL_STATS, bucketStatsRows, filterStatsRows, groupStatsRows, statsRowsCsv, sumStatsRows } from "../components/usage/stats-view";

/** Diagnostic baseline, not a timing assertion or browser qualification. */
function fixture(count: number): UsageStatsReport {
  // Warp's source is an undated billing snapshot, so dated selectors intentionally omit it.
  const clients = registry.clients.map(client => client.id).filter(client => client !== "warp"), modelCount = Math.min(1024, registry.models.length);
  const firstUtcDay = 20_000, dayCount = 366, generatedAtMs = (firstUtcDay + dayCount) * 86_400_000;
  const rows: UsageStatsRow[] = Array.from({ length: count }, (_, index) => ({
    utcDay: firstUtcDay + Math.floor(index / (modelCount * clients.length)), client: clients[Math.floor(index / modelCount) % clients.length],
    provider: null, model: registry.models[index % modelCount],
    tokens: { input: String(index + 1), cacheRead: "100", cacheWrite: "900", output: "20", reasoning: "10" }, records: 1,
    reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: "125", estimatedCostRecords: 1,
    durationMs: "1000", timedRecords: 1, timedTokens: String(index + 1031), tokenBasis: "reported", breakdownCoverage: "complete",
  }));
  rows.sort((left, right) => statsRowKey(left) < statsRowKey(right) ? -1 : statsRowKey(left) > statsRowKey(right) ? 1 : 0);
  const sources = clients.flatMap(client => {
    const records = rows.filter(row => row.client === client).length;
    return records === 0 ? [] : [{ client, status: "observed" as const, tokenBasis: "reported" as const, records, warnings: 0, latestAtMs: generatedAtMs - 1 }];
  });
  const report = parseUsageStatsReport({ schemaVersion: 2, profile: "client-stats-v2", registryRevision: 1,
    firstUtcDay, dayCount, generatedAtMs, revision: 0, updatedAtMs: null, rows, sources });
  if (!report) throw new Error("synthetic_baseline_not_admitted");
  return report;
}
const sample = (run: () => void) => { const start = performance.now(); run(); return performance.now() - start; };
const summarize = (samples: number[]) => {
  const sorted = samples.toSorted((a, b) => a - b);
  return { samplesMs: samples, medianMs: sorted[Math.floor(sorted.length / 2)], maximumMs: sorted.at(-1) };
};
const results = [];
for (const count of [8_192, 65_536]) {
  const report = fixture(count), json = JSON.stringify(report), bytes = Buffer.byteLength(json);
  const filters = { firstUtcDay: report.firstUtcDay, dayCount: report.dayCount, client: ALL_STATS, provider: ALL_STATS, model: ALL_STATS, basis: "reported" as const };
  const expected = BigInt(count) * BigInt(count + 1) / 2n + BigInt(count) * 1030n;
  const fold = () => {
    const rows = filterStatsRows(report, filters), total = sumStatsRows(rows);
    const grouped = groupStatsRows(rows, "model", "tokens"), buckets = bucketStatsRows(rows, filters);
    if (total.tokens !== expected || grouped.reduce((sum, group) => sum + group.totals.tokens, 0n) !== expected
      || buckets.reduce((sum, bucket) => sum + bucket.totals.tokens, 0n) !== expected) throw new Error("baseline_totals_disagree");
  };
  const parse = () => { if (!parseUsageStatsJson(json)) throw new Error("serialized_baseline_not_admitted"); };
  for (let warmup = 0; warmup < 2; warmup++) { parse(); fold(); }
  const parsing: number[] = [], selectors: number[] = [], exportCsv: number[] = [];
  for (let index = 0; index < 5; index++) {
    parsing.push(sample(parse)); selectors.push(sample(fold));
    exportCsv.push(sample(() => { if (!statsRowsCsv(report.rows).startsWith("utc_day,time_basis,")) throw new Error("csv_missing_contract"); }));
  }
  results.push({ rows: count, bytes, distinctModels: new Set(report.rows.map(row => row.model)).size,
    distinctClients: report.sources.length, admitted: true, expectedTokens: expected.toString(),
    parsing: summarize(parsing), selectors: summarize(selectors), csv: summarize(exportCsv), processRssBytes: process.memoryUsage().rss });
}
console.log(JSON.stringify({ schemaVersion: 1, claim: "synthetic-helper-baseline-only", platform: platform(), architecture: arch(),
  cpu: cpus()[0]?.model ?? "unknown", bun: Bun.version, samplesAfterWarmup: 5, warmups: 2,
  limits: "High-cardinality admitted local reports. No browser render, real provider, hosted query or concurrent workload; process RSS is not isolated peak allocation.", results }, null, 2));
