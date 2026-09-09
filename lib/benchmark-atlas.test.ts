import { describe, expect, test } from "bun:test";
import {
  atlasDatasetSummary,
  selectAtlasEntries,
  selectAtlasModelProfiles,
  sortAtlasPoints,
  validateAtlasCatalog,
  type BenchmarkAtlasDataset,
  type BenchmarkAtlasEntry,
  type BenchmarkAtlasPoint,
} from "./benchmark-atlas";

const point: BenchmarkAtlasPoint = {
  id: "one", label: "Model A high", model: "Model A", provider: "Lab A",
  harness: null, effort: "high", score: 70, costUsd: null,
  uncertainty: null, sourceUrl: "https://example.com/results/one",
};
const dataset: BenchmarkAtlasDataset = {
  benchmarkId: "test-benchmark", version: "1.0",
  score: { label: "Accuracy", unit: "%", direction: "higher", minimum: 0, maximum: 100 },
  source: { name: "Benchmark owner", url: "https://example.com/results", retrievedAt: "2026-09-08T00:00:00Z" },
  configurationLabel: "Model and effort", comparabilityNote: "Same task set and run policy.",
  points: [point],
};
const entry: BenchmarkAtlasEntry = {
  id: dataset.benchmarkId, name: "Memory Check", version: dataset.version, category: "memory",
  question: "Can it remember preferences?", summary: "Recall across sessions.",
  source: { name: "Benchmark owner", url: dataset.source.url }, measure: "Accuracy",
  comparisonRule: "Compare only the same version.", limitations: ["No image recall."],
  coverage: "charted", tags: ["long context", "retrieval"],
};

describe("benchmark atlas publication boundaries", () => {
  test("requires honest coverage and a matching benchmark version", () => {
    expect(validateAtlasCatalog([entry], [dataset]).ok).toBeTrue();
    expect(validateAtlasCatalog([{ ...entry, coverage: "source-only" }], []).ok).toBeTrue();
    expect(validateAtlasCatalog([{ ...entry, coverage: "source-only" }], [dataset]).ok).toBeFalse();
    expect(validateAtlasCatalog([entry], []).ok).toBeFalse();
    expect(validateAtlasCatalog([entry], [{ ...dataset, version: "2.0" }]).ok).toBeFalse();
    expect(validateAtlasCatalog([], [dataset]).ok).toBeFalse();
  });

  test("rejects duplicate subjects and invalid scores before they can become rankings", () => {
    expect(validateAtlasCatalog([entry, entry], [dataset]).ok).toBeFalse();
    expect(validateAtlasCatalog([entry], [dataset, dataset]).ok).toBeFalse();
    expect(validateAtlasCatalog([entry], [{ ...dataset, points: [point, point] }]).ok).toBeFalse();
    for (const score of [NaN, Infinity, -1, 101]) {
      expect(validateAtlasCatalog([entry], [{ ...dataset, points: [{ ...point, score }] }]).ok).toBeFalse();
    }
    expect(validateAtlasCatalog([entry], [{ ...dataset, points: [] }]).ok).toBeFalse();
  });

  test("missing cost stays distinct from free and every reported cost requires its basis", () => {
    const freePoint = { ...point, costUsd: 0 };
    expect(validateAtlasCatalog([entry], [{ ...dataset, points: [freePoint] }]).ok).toBeFalse();
    expect(validateAtlasCatalog([entry], [{ ...dataset, costLabel: "USD per task", points: [freePoint] }]).ok).toBeTrue();
    for (const costUsd of [-1, NaN, Infinity]) {
      expect(validateAtlasCatalog([entry], [{ ...dataset, costLabel: "USD per task", points: [{ ...point, costUsd }] }]).ok).toBeFalse();
    }
    expect(atlasDatasetSummary(dataset).costCount).toBe(0);
    expect(atlasDatasetSummary({ ...dataset, points: [freePoint] }).costCount).toBe(1);
  });

  test("uncertainty must contain the score and state its meaning", () => {
    for (const uncertainty of [
      { lower: 71, upper: 75, label: "95% CI" },
      { lower: 60, upper: 69, label: "95% CI" },
      { lower: 60, upper: Infinity, label: "95% CI" },
      { lower: 60, upper: 80, label: "" },
    ]) {
      expect(validateAtlasCatalog([entry], [{ ...dataset, points: [{ ...point, uncertainty }] }]).ok).toBeFalse();
    }
    expect(validateAtlasCatalog([entry], [{ ...dataset, points: [{ ...point, uncertainty: { lower: 60, upper: 80, label: "±1 standard error" } }] }]).ok).toBeTrue();
  });

  test("source links cannot contain credentials or script protocols", () => {
    for (const url of ["javascript:alert(1)", "https://secret@example.com/results", "http://example.com/results"]) {
      expect(validateAtlasCatalog([{ ...entry, source: { ...entry.source, url } }], [dataset]).ok).toBeFalse();
      expect(validateAtlasCatalog([entry], [{ ...dataset, source: { ...dataset.source, url } }]).ok).toBeFalse();
      expect(validateAtlasCatalog([entry], [{ ...dataset, points: [{ ...point, sourceUrl: url }] }]).ok).toBeFalse();
    }
  });
});

describe("benchmark atlas exploration", () => {
  test("keeps distinct memory systems and effort-only comparisons visible", () => {
    const efforts = [point, { ...point, id: "low", effort: "low", score: 60 }];
    expect(selectAtlasModelProfiles(efforts)).toEqual(efforts);
    const systems = [point, { ...point, id: "rag", harness: "RAG" }];
    expect(selectAtlasModelProfiles(systems)).toEqual(systems);
    expect(selectAtlasModelProfiles([...efforts, { ...point, id: "b", model: "B" }]).map(item => item.id)).toEqual(["one", "b"]);
  });
  test("ranks within one dataset in its native direction without changing checked order", () => {
    const points = [point, { ...point, id: "two", label: "Model B", score: 80 }];
    expect(sortAtlasPoints({ ...dataset, points }).map(item => item.id)).toEqual(["two", "one"]);
    expect(sortAtlasPoints({ ...dataset, score: { ...dataset.score, direction: "lower" }, points }).map(item => item.id)).toEqual(["one", "two"]);
    expect(points.map(item => item.id)).toEqual(["one", "two"]);
  });

  test("counts configurations separately from models and keeps providers in model identity", () => {
    const summary = atlasDatasetSummary({ ...dataset, points: [
      point,
      { ...point, id: "two", effort: "max", score: 80 },
      { ...point, id: "three", provider: "Lab B", score: 60 },
    ] });
    expect(summary.configurationCount).toBe(3);
    expect(summary.modelCount).toBe(2);
    expect(summary.providerCount).toBe(2);
    expect(summary.leader?.id).toBe("two");
  });

  test("searches reader tasks and tags with category filters and order-independent terms", () => {
    expect(selectAtlasEntries([entry], { query: "  RETRIEVAL   sessions " })).toEqual([entry]);
    expect(selectAtlasEntries([entry], { category: "coding" })).toEqual([]);
    expect(selectAtlasEntries([entry], { category: "memory", query: "context" })).toEqual([entry]);
    expect(selectAtlasEntries([entry], { category: "all", query: "unknown" })).toEqual([]);
    expect(selectAtlasEntries([entry])).toEqual([entry]);
  });
});
