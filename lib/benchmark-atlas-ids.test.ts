import { describe, expect, test } from "bun:test";
import { ATLAS_DATASETS, ATLAS_ENTRIES } from "./benchmark-atlas-catalog";
import { BENCHMARK_ATLAS_IDS, CHARTED_BENCHMARK_ATLAS_IDS, isBenchmarkAtlasId, isChartedBenchmarkAtlasId } from "./benchmark-atlas-ids";

describe("client-safe benchmark identifiers", () => {
  test("published analytics IDs exactly match the authored catalog without duplicates", () => {
    expect(ATLAS_ENTRIES.map(entry => entry.id).sort()).toEqual([...BENCHMARK_ATLAS_IDS].sort());
    expect(new Set(BENCHMARK_ATLAS_IDS).size).toBe(BENCHMARK_ATLAS_IDS.length);
  });

  test("download IDs exactly match actual charted datasets, never source-only guides", () => {
    expect(ATLAS_DATASETS.map(dataset => dataset.benchmarkId).sort()).toEqual([...CHARTED_BENCHMARK_ATLAS_IDS].sort());
    expect(ATLAS_ENTRIES.filter(entry => entry.coverage === "charted").map(entry => entry.id).sort()).toEqual([...CHARTED_BENCHMARK_ATLAS_IDS].sort());
    expect(new Set(CHARTED_BENCHMARK_ATLAS_IDS).size).toBe(CHARTED_BENCHMARK_ATLAS_IDS.length);
    expect(CHARTED_BENCHMARK_ATLAS_IDS.every(isBenchmarkAtlasId)).toBeTrue();
  });

  test("valid-looking private names cannot cross the publication boundary", () => {
    for (const id of ["private-project", "wise-verified.json", "Wise-Verified", " wise-verified", "wise-verified?query=secret", "__proto__", "", null, 123, {}]) {
      expect(isBenchmarkAtlasId(id)).toBeFalse();
      expect(isChartedBenchmarkAtlasId(id)).toBeFalse();
    }
    expect(isBenchmarkAtlasId("open-asr")).toBeTrue();
    expect(isChartedBenchmarkAtlasId("open-asr")).toBeFalse();
    expect(isChartedBenchmarkAtlasId("wise-verified")).toBeTrue();
  });

  test("the client allowlist carries no server imports or checked observations", async () => {
    const source = await Bun.file(new URL("./benchmark-atlas-ids.ts", import.meta.url)).text();
    expect(source).not.toMatch(/^import\s/mu);
    expect(source).not.toContain("../data/");
    expect(source).not.toContain("benchmark-atlas-catalog");
  });
});
