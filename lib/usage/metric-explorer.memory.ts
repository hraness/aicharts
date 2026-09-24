import { gcAndSweep, heapStats } from "bun:jsc";
import { createHash } from "node:crypto";
import { cpus, platform, arch } from "node:os";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { metricBenchmarkFixture } from "./metric-explorer.bench";
import { createMetricSnapshot, evaluateMetricQuery, type MetricQuery } from "./metric-explorer";

/** Retention diagnostic, not a latency qualification: explicit collection is
 * deliberately outside each measured operation. Source bytes are synthetic. */
const inputs = ["lib/usage/metric-explorer.memory.ts", "lib/usage/metric-explorer.bench.ts", "lib/usage/metric-explorer.ts",
  "lib/usage/metric-explorer-fold.ts", "lib/usage/metric-explorer-values.ts", "lib/usage/metric-explorer-catalog.ts", "lib/usage/stats-contract.ts", "data/usage-registry.json", "bun.lock", "package.json"];
const hashes = async () => Object.fromEntries(await Promise.all(inputs.map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
const before = await hashes();
const report = metricBenchmarkFixture(65_536), expected = 65_536n * 65_537n / 2n + 65_536n * 1030n;
const query: MetricQuery = { schemaVersion: 1, firstUtcDay: report.firstUtcDay, dayCount: report.dayCount,
  filters: { client: "*", provider: "*", model: "*" }, basis: "reported", costKind: "estimated", groupBy: ["model", "utc-day"],
  metricIds: ["accounted-tokens", "cached-input-share", "effective-usd-per-million-total-tokens"], topK: 50, sortBy: "accounted-tokens", sortDirection: "desc" };
const memory = () => { const heap = heapStats(); return { heapBytes: heap.heapSize, objectCount: heap.objectCount, rssBytes: process.memoryUsage().rss }; };
const collect = async () => { await Bun.sleep(0); Bun.gc(true); gcAndSweep(); return memory(); };
const baseline = await collect(), samples = [];
function execute() {
  let started = performance.now(); const snapshot = createMetricSnapshot(report); const admissionMs = performance.now() - started;
  if (snapshot === null) throw new Error("memory_fixture_not_admitted");
  started = performance.now(); const result = evaluateMetricQuery(snapshot, query); const queryMs = performance.now() - started;
  if (!result.ok || result.value.fold.total !== expected || result.value.groups.reduce((sum, group) => sum + group.fold.total, 0n) !== expected)
    throw new Error("memory_fixture_conservation");
  gcAndSweep();
  return { admissionMs, queryMs, retained: memory(), snapshot: new WeakRef(snapshot), result: new WeakRef(result.value) };
}
for (let sample = 0; sample < 5; sample++) {
  const current = execute();
  const released = await collect();
  samples.push({ admissionMs: current.admissionMs, queryMs: current.queryMs, retained: current.retained, released,
    snapshotCollected: current.snapshot.deref() === undefined, resultCollected: current.result.deref() === undefined });
}
const after = await hashes(); if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("memory_source_changed");
const receipt = { schemaVersion: 1, claim: "synthetic-isolated-retention-diagnostic", cpu: cpus()[0]?.model, platform: platform(), architecture: arch(), bun: Bun.version,
  rows: report.rows.length, inputBytes: Buffer.byteLength(JSON.stringify(report)), sourceSha256: before, baseline, samples,
  limitations: "Forced-GC diagnostic under Bun/JSC, not browser latency or browser memory. The synthetic input report remains intentionally retained throughout. RSS includes allocator capacity." };
await mkdir("target/assurance/metric-explorer", { recursive: true });
await writeFile("target/assurance/metric-explorer/retention-baseline.json", JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt, null, 2));
