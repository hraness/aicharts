import { describe, expect, test } from "bun:test";
import intelligenceJson from "../data/artificial-analysis-intelligence.json";
import codingJson from "../data/coding-agents.json";
import terminalJson from "../data/terminal-bench.json";
import scienceJson from "../data/terminal-bench-science.json";
import { BENCHMARK_ATLAS_DATASETS, codingAtlasDatasets, getBenchmarkAtlasDataset } from "./benchmark-atlas-data";
import { CORE_ATLAS_ENTRIES } from "./benchmark-atlas-core-catalog";
import { parseCodingAgentSnapshot } from "./coding-agent-data";
import { validateAtlasCatalog } from "./benchmark-atlas";

describe("checked benchmark atlas projections", () => {
  test("all assembled datasets satisfy publication bounds and remain version-separated", () => {
    const valid = validateAtlasCatalog(CORE_ATLAS_ENTRIES, BENCHMARK_ATLAS_DATASETS);
    expect(valid.ok ? true : valid.error.message).toBeTrue();
    expect(getBenchmarkAtlasDataset("terminal-bench-4")?.version).toBe("4.0.0");
    expect(getBenchmarkAtlasDataset("terminal-bench-2-1")?.version).toBe("2.1");
    expect(getBenchmarkAtlasDataset("unknown")).toBeUndefined();
  });

  test("missing coding scores are omitted rather than becoming zero", () => {
    const parsed = parseCodingAgentSnapshot(codingJson);
    if (!parsed.ok) throw parsed.error;
    const source = structuredClone(parsed.value);
    const first = source.records[0]!;
    first.benchmarks.deepSwe = null;
    first.benchmarks.terminalBench = 0;
    const datasets = codingAtlasDatasets(source);
    expect(datasets.find(dataset => dataset.benchmarkId === "deep-swe")?.points.some(point => point.id === first.id)).toBeFalse();
    expect(datasets.find(dataset => dataset.benchmarkId === "terminal-bench-2-1")?.points.find(point => point.id === first.id)?.score).toBe(0);
  });

  test("Intelligence includes measured configurations without inventing missing costs", () => {
    const dataset = getBenchmarkAtlasDataset("aa-intelligence")!;
    expect(dataset.points.length).toBe(intelligenceJson.records.length);
    const missing = intelligenceJson.records.filter(record => record.costUsdPerTask === null);
    expect(dataset.points.filter(point => point.costUsd === null).map(point => point.id)).toEqual(missing.map(record => record.id));
    expect(dataset.costLabel).toBe("USD per Intelligence Index task");
  });

  test("Terminal-Bench retains source CI and full-evaluation cost without per-task relabeling", () => {
    const dataset = getBenchmarkAtlasDataset("terminal-bench-4")!;
    const source = terminalJson.records[0]!;
    const point = dataset.points.find(row => row.id === source.id)!;
    expect(point.score).toBe(source.metrics.accuracyPercent);
    expect(point.costUsd).toBe(source.metrics.totalCostUsd);
    expect(dataset.costLabel).toContain("330-trial");
    expect(point.uncertainty?.label).toContain("95%");
    expect(point.uncertainty?.upper).toBeCloseTo(source.metrics.accuracyPercent + source.metrics.accuracyCi95HalfWidthPercent, 8);
    expect(point.harness).toContain(source.harness.version);
  });

  test("Science standard error never becomes a confidence interval or a cross-domain cost sum", () => {
    const dataset = getBenchmarkAtlasDataset("terminal-bench-science")!;
    const source = scienceJson.records[0]!;
    const point = dataset.points.find(row => row.id === source.id)!;
    expect(point.costUsd).toBe(source.metrics.totalCostUsd);
    expect(dataset.costLabel).toContain("210-trial");
    expect(point.uncertainty?.label).toContain("standard error");
    expect(point.uncertainty?.label).not.toContain("95%");
    expect(point.uncertainty?.upper).toBeCloseTo(source.metrics.resolutionRatePercent + source.metrics.standardErrorPercent, 8);
    expect(point.details).toHaveLength(5);
    expect(dataset.observedAt).toBe(scienceJson.source.leaderboardUpdatedAt);
  });
});
