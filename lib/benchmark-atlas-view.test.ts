import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { BenchmarkAtlasDataset, BenchmarkAtlasEntry } from "./benchmark-atlas";
import { atlasViewSearch, formatAtlasScore, parseAtlasView } from "./benchmark-atlas-view";

const entry: BenchmarkAtlasEntry = { id: "test-coding", name: "Test", version: "1", category: "coding", question: "Test?", summary: "Test", source: { name: "Test", url: "https://example.com" }, measure: "Test", comparisonRule: "Same cohort", limitations: [], coverage: "charted", tags: [] };
const dataset: BenchmarkAtlasDataset = { benchmarkId: entry.id, version: "1", source: { name: "Test", url: "https://example.com", retrievedAt: "2026-09-08T00:00:00Z" }, score: { label: "Accuracy", unit: "%", direction: "higher", minimum: 0, maximum: 100 }, configurationLabel: "Systems", comparabilityNote: "Same setup", costLabel: "Per task", points: [] };
const point = (id: string) => ({ id, label: id, model: "Model", provider: "Lab", harness: null, effort: null, score: 50, costUsd: 1, uncertainty: null, sourceUrl: "https://example.com" });

describe("benchmark explorer URLs", () => {
  test("round-trips opaque source identifiers including JSON, commas, and URL punctuation", () => {
    fc.assert(fc.property(fc.array(fc.string({ minLength: 1, maxLength: 60 }), { minLength: 1, maxLength: 3 }), identifiers => {
      const ids = [...new Set(identifiers)];
      const current = { benchmarkId: entry.id, category: "coding" as const, view: "cost" as const, pointId: ids[0], compareIds: ids, provider: "Lab", expanded: true, bestPerModel: false };
      const data = { ...dataset, points: ids.map(point) };
      expect(parseAtlasView(atlasViewSearch(current), [entry], [data])).toEqual(current);
    }), { numRuns: 100 });
  });
  test("drops unknown benchmarks, observations, and unsupported views", () => {
    const parsed = parseAtlasView("?atlas=malicious&task=unknown&atlasView=javascript&atlasPoint=secret&atlasCompare=unknown", [entry], [dataset]);
    expect(parsed).toEqual({ benchmarkId: entry.id, category: "all", view: "ranking", pointId: null, compareIds: [], provider: null, expanded: false, bestPerModel: true });
  });
  test("does not create cost comparisons from missing or zero costs", () => {
    const data = { ...dataset, points: [{ ...point("a"), costUsd: 0 }, { ...point("b"), costUsd: null }] };
    expect(parseAtlasView("?atlasView=cost", [entry], [data]).view).toBe("ranking");
  });
  test("limits comparison to three distinct valid rows", () => {
    const data = { ...dataset, points: ["a", "b", "c", "d"].map(point) };
    expect(parseAtlasView("?atlasCompare=a&atlasCompare=a&atlasCompare=x&atlasCompare=b&atlasCompare=c&atlasCompare=d", [entry], [data]).compareIds).toEqual(["a", "b", "c"]);
  });
  test("encodes provider display names that contain spaces, parentheses, and commas", () => {
    const provider = "Moonshot AI (Kimi), Lab";
    const data = { ...dataset, points: [{ ...point("row-1"), provider }] };
    const state = {
      benchmarkId: entry.id,
      bestPerModel: true,
      category: "coding" as const,
      compareIds: ["row-1"],
      expanded: false,
      pointId: "row-1",
      provider,
      view: "ranking" as const,
    };
    const search = atlasViewSearch(state);
    const url = new URL(`https://aicharts.io/benchmarks${search}#explore`);
    expect(url.href).not.toContain(" ");
    expect(url.searchParams.get("atlasProvider")).toBe(provider);
    expect(parseAtlasView(url.search, [entry], [data])).toEqual(state);
  });

  test("preserves the unit and percentage precision", () => {
    expect(formatAtlasScore(65.72, "%")).toBe("65.72%");
    expect(formatAtlasScore(1234.5, "Elo")).toBe("1,234.5 Elo");
    expect(formatAtlasScore(0, "%")).toBe("0%");
    expect(formatAtlasScore(0.404, "score")).toBe("0.404");
    expect(formatAtlasScore(0.401, "score")).toBe("0.401");
    expect(formatAtlasScore(65.6529, "points", true)).toBe("65.6529");
  });
});
