import { expect, test } from "bun:test";
import { assertProperty, fc } from "./property-test";
import { atlasDatasetSummary, selectAtlasModelProfiles, sortAtlasPoints, type BenchmarkAtlasDataset } from "./benchmark-atlas";

test("property: ranking, selected profiles and leaders survive arbitrary tied cohort permutations", () => {
  const ids = ["é", "e\u0301", "Å", "A\u030a", "a", "A", "0", "10"];
  assertProperty(fc.property(
    fc.array(fc.integer({ min: 0, max: 3 }), { minLength: ids.length, maxLength: ids.length }),
    fc.shuffledSubarray(ids, { minLength: ids.length, maxLength: ids.length }),
    fc.constantFrom("higher" as const, "lower" as const),
    (scores, permutation, direction) => {
      const dataset: BenchmarkAtlasDataset = {
        benchmarkId: "synthetic", version: "1",
        score: { label: "Score", unit: "points", direction, minimum: 0, maximum: 3 },
        source: { name: "Synthetic", url: "https://example.com/benchmark", retrievedAt: "2026-01-01T00:00:00Z" },
        configurationLabel: "Model and effort", comparabilityNote: "One fixed synthetic evaluation.",
        points: ids.map((id, index) => ({
          id, label: "Tied public label", model: `Model ${index % 3}`, provider: `Lab ${index % 2}`,
          score: scores[index]!, harness: null, effort: "high", costUsd: null,
          uncertainty: null, sourceUrl: "https://example.com/benchmark",
        })),
      };
      const permuted = { ...dataset, points: permutation.map(id => dataset.points.find(point => point.id === id)!) };
      expect(sortAtlasPoints(permuted)).toEqual(sortAtlasPoints(dataset));
      expect(selectAtlasModelProfiles(sortAtlasPoints(permuted))).toEqual(selectAtlasModelProfiles(sortAtlasPoints(dataset)));
      expect(atlasDatasetSummary(permuted)).toEqual(atlasDatasetSummary(dataset));
      expect(dataset.points.map(point => point.id)).toEqual(ids);
    },
  ));
});
