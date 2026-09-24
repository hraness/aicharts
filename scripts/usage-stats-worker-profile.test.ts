import { expect, test } from "bun:test";
import { admitWorkerDiagnosticBuildReuse, parseWorkerProfileEpisodes, workerProfileHostedFixture, workerProfileQuery } from "./usage-stats-worker-profile";
import { parseStatsPublicReply, STATS_PUBLIC_MAX_BYTES } from "../lib/usage/stats-public";
import { createMetricSnapshot, disposeMetricSnapshot, evaluateMetricQuery } from "../lib/usage/metric-explorer";
import { metricBenchmarkFixture } from "../lib/usage/metric-explorer.bench";

test("the 32-ID diagnostic includes eligible ratios, timed cohorts, costs and rolling windows", () => {
  const report = metricBenchmarkFixture(128), query = workerProfileQuery(report), snapshot = createMetricSnapshot(report)!;
  expect(new Set(query.metricIds).size).toBe(32);
  for (const id of ["accounted-tokens", "cached-input-share", "effective-usd-per-million-total-tokens", "tokens-per-source-duration-second", "rolling-90-day-tokens"])
    expect(query.metricIds).toContain(id);
  try {
    const result = evaluateMetricQuery(snapshot, query); expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    const expected = 128n * 129n / 2n + 128n * 1030n;
    expect(result.value.fold.total).toBe(expected);
    expect(result.value.groups.reduce((sum, group) => sum + group.fold.total, 0n)).toBe(expected);
    expect(result.value.measures).toHaveLength(32);
  } finally { disposeMetricSnapshot(snapshot); }
});

test("hosted maximum rows and byte-padding remain separate valid fixtures with exact range", () => {
  const report = workerProfileHostedFixture(21_000), range = { firstUtcDay: 20_971, dayCount: 30 };
  expect(report.rows).toHaveLength(8192); expect(report.firstUtcDay).toBe(range.firstUtcDay);
  const value = { schemaVersion: 2, ok: true, value: report }, body = JSON.stringify(value), padding = STATS_PUBLIC_MAX_BYTES - Buffer.byteLength(body);
  expect(padding).toBeGreaterThan(0); const padded = body + " ".repeat(padding);
  expect(Buffer.byteLength(padded)).toBe(STATS_PUBLIC_MAX_BYTES);
  expect(parseStatsPublicReply(JSON.parse(padded), range)?.ok).toBe(true);
  expect(parseStatsPublicReply(value, { ...range, firstUtcDay: range.firstUtcDay + 1 })).toBeNull();
});

test("diagnostic episode selection is explicit, bounded and duplicate-free", () => {
  expect(parseWorkerProfileEpisodes(undefined)).toEqual(["cpu", "memory", "protocol32", "hosted"]);
  expect(parseWorkerProfileEpisodes("memory,protocol32,hosted")).toEqual(["memory", "protocol32", "hosted"]);
  for (const value of ["", "memory,memory", "memory,other", "cpu,memory,protocol32,hosted,cpu"])
    expect(() => parseWorkerProfileEpisodes(value)).toThrow("episode selection");
});

test("diagnostic build reuse permits only harness changes against exact recent production identity", () => {
  const before = "a".repeat(64), after = "b".repeat(64), sources = { "lib/usage/metric-explorer.ts": before, "scripts/usage-stats-cdp.ts": after };
  const artifacts = { build: before, manifest: before, routes: before, paths: before }, environment = { NODE_ENV: "production", AICHARTS_USAGE_STATS_ENABLED: "1" };
  const build = { command: [process.execPath, "run", "build"], startedAtMs: 1000, finishedAtMs: 2000, buildId: "synthetic-build", artifactSha256: artifacts, environment };
  const receipt = { schemaVersion: 1, status: "failed", sourceStillMatches: true, bun: Bun.version, runtime: { mode: "production", build },
    sourceSha256: { ...sources, "scripts/usage-stats-cdp.ts": before } };
  expect(admitWorkerDiagnosticBuildReuse(receipt, sources, artifacts, environment, 3000)).toEqual(build);
  expect(() => admitWorkerDiagnosticBuildReuse(receipt, { ...sources, "lib/usage/metric-explorer.ts": after }, artifacts, environment, 3000)).toThrow("inputs changed");
  expect(() => admitWorkerDiagnosticBuildReuse(receipt, sources, { ...artifacts, routes: after }, environment, 3000)).toThrow("artifact hashes changed");
  expect(() => admitWorkerDiagnosticBuildReuse(receipt, sources, artifacts, { ...environment, AICHARTS_USAGE_STATS_ENABLED: "0" }, 3000)).toThrow("environment changed");
  expect(() => admitWorkerDiagnosticBuildReuse(receipt, sources, artifacts, environment, 7 * 60 * 60 * 1000)).toThrow("age");
  expect(() => admitWorkerDiagnosticBuildReuse({ ...receipt, sourceStillMatches: false }, sources, artifacts, environment, 3000)).toThrow("production identity");
  expect(() => admitWorkerDiagnosticBuildReuse({ ...receipt, bun: "another-bun" }, sources, artifacts, environment, 3000)).toThrow("matching Bun");
});
