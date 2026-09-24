import { createHash } from "node:crypto";
import { cpus, platform, arch } from "node:os";
import { readFile } from "node:fs/promises";
import registry from "../../data/usage-registry.json";
import { statsRowKey, type UsageStatsReport, type UsageStatsRow } from "./stats-contract";
import { createMetricSnapshot, evaluateMetricQuery, metricResultJson, type MetricQuery } from "./metric-explorer";
import { metricStatsProjection } from "../../components/usage/stats-metric-projection";
import { statsBoundRowsCsv } from "../../components/usage/stats-export";

/** Synthetic admitted-limit workload, never a provider source. One unique
 * model/day key per row qualifies the engine's worst permitted group count. */
export function metricBenchmarkFixture(count: number): UsageStatsReport {
  if (!Number.isSafeInteger(count) || count < 1 || count > 65_536 || registry.models.length < 1024) throw new Error("metric_benchmark_count");
  const firstUtcDay = 20_000, dayCount = 366, generatedAtMs = (firstUtcDay + dayCount) * 86_400_000;
  const rows: UsageStatsRow[] = Array.from({ length: count }, (_, index) => ({
    utcDay: firstUtcDay + Math.floor(index / 1024), client: "codex", provider: null, model: registry.models[index % 1024],
    tokens: { input: String(index + 1), cacheRead: "100", cacheWrite: "900", output: "20", reasoning: "10" }, records: 1,
    reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: "125", estimatedCostRecords: 1,
    durationMs: "1000", timedRecords: 1, timedTokens: String(index + 1031), tokenBasis: "reported", breakdownCoverage: "complete",
  }));
  rows.sort((a, b) => statsRowKey(a) < statsRowKey(b) ? -1 : statsRowKey(a) > statsRowKey(b) ? 1 : 0);
  return { schemaVersion: 2, profile: "client-stats-v2", registryRevision: 1, firstUtcDay, dayCount, generatedAtMs, revision: 0, updatedAtMs: null, rows,
    sources: [{ client: "codex", status: "observed", tokenBasis: "reported", records: count, warnings: 0, latestAtMs: generatedAtMs - 1 }] };
}

if (import.meta.main) {
  const inputs = ["lib/usage/metric-explorer.bench.ts", "lib/usage/metric-explorer.ts", "lib/usage/metric-explorer-fold.ts", "lib/usage/metric-explorer-values.ts", "lib/usage/metric-explorer-catalog.ts", "lib/usage/stats-contract.ts",
    "components/usage/stats-metric-projection.ts", "components/usage/stats-export.ts", "components/usage/stats-view.ts", "data/usage-registry.json", "bun.lock", "package.json"];
  const hashes = async () => Object.fromEntries(await Promise.all(inputs.map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
  const before = await hashes();
  const summarize = (samplesMs: number[]) => { const sorted = samplesMs.toSorted((a, b) => a - b); return { samplesMs, medianMs: sorted[2], maximumMs: sorted[4] }; };
  const measurements = [];
  for (const count of [8_192, 65_536]) {
    const report = metricBenchmarkFixture(count), expected = BigInt(count) * BigInt(count + 1) / 2n + BigInt(count) * 1030n;
    const query: MetricQuery = { schemaVersion: 1, firstUtcDay: report.firstUtcDay, dayCount: report.dayCount, filters: { client: "*", provider: "*", model: "*" },
      basis: "reported", costKind: "estimated", groupBy: ["model", "utc-day"], metricIds: ["accounted-tokens", "cached-input-share", "effective-usd-per-million-total-tokens"], topK: 50, sortBy: "accounted-tokens", sortDirection: "desc" };
    const snapshot = createMetricSnapshot(report); if (snapshot === null) throw new Error("metric_benchmark_not_admitted");
    const fold = () => {
      const result = evaluateMetricQuery(snapshot, query); if (!result.ok) throw new Error(result.code);
      if (result.value.fold.total !== expected || result.value.groups.reduce((sum, group) => sum + group.fold.total, 0n) !== expected
        || result.value.composition.reduce((sum, group) => sum + group.fold.total, 0n) !== expected || result.value.totalGroups !== count) throw new Error("metric_benchmark_conservation");
      return result.value;
    };
    for (let i = 0; i < 2; i++) fold();
    const admission: number[] = [], queries: number[] = [], projection: number[] = [], csv: number[] = [], json: number[] = [];
    for (let i = 0; i < 5; i++) {
      let start = performance.now(); if (createMetricSnapshot(report) === null) throw new Error("metric_benchmark_admission"); admission.push(performance.now() - start);
      start = performance.now(); const result = fold(); queries.push(performance.now() - start);
      start = performance.now(); const ui = metricStatsProjection(result); projection.push(performance.now() - start); if (ui.totals.tokens !== expected) throw new Error("metric_benchmark_projection");
      start = performance.now(); await statsBoundRowsCsv(result); csv.push(performance.now() - start);
      start = performance.now(); await metricResultJson(result); json.push(performance.now() - start);
    }
    measurements.push({ rows: count, groups: count, inputBytes: Buffer.byteLength(JSON.stringify(report)), expectedTokens: expected.toString(), admission: summarize(admission), queries: summarize(queries),
      projection: summarize(projection), csv: summarize(csv), json: summarize(json), processRssBytes: process.memoryUsage().rss });
  }
  const after = await hashes(); if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("metric_benchmark_source_changed");
  console.log(JSON.stringify({ schemaVersion: 1, claim: "synthetic-helper-only", platform: platform(), architecture: arch(), cpu: cpus()[0]?.model, bun: Bun.version,
    warmups: 2, samples: 5, sourceSha256: before, measurements,
    limitations: "No browser rendering, modest hardware, hosted query or concurrent-load qualification; RSS is process memory after repeated work, not isolated peak. Five samples do not establish population p95." }, null, 2));
}
