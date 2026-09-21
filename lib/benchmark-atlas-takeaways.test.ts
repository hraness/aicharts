import { describe, expect, test } from "bun:test";

import type { BenchmarkAtlasDataset, BenchmarkAtlasPoint } from "./benchmark-atlas";
import { atlasTakeaways } from "./benchmark-atlas-takeaways";

function point(overrides: Partial<BenchmarkAtlasPoint> & Pick<BenchmarkAtlasPoint, "id" | "model" | "score">): BenchmarkAtlasPoint {
  return {
    label: overrides.model, provider: "Lab", harness: null, effort: null,
    costUsd: null, uncertainty: null, sourceUrl: "https://example.org/results",
    ...overrides,
  };
}

function dataset(points: readonly BenchmarkAtlasPoint[], overrides: Partial<BenchmarkAtlasDataset> = {}): BenchmarkAtlasDataset {
  return {
    benchmarkId: "example", version: "1",
    score: { label: "Score", unit: "%", direction: "higher", minimum: 0, maximum: 100 },
    source: { name: "Owner", url: "https://example.org", retrievedAt: "2026-09-21T00:00:00.000Z" },
    configurationLabel: "Model", comparabilityNote: "One protocol.",
    points, ...overrides,
  };
}

describe("atlas takeaways", () => {
  test("names the leader and the runner-up with their scores", () => {
    const sentences = atlasTakeaways(dataset([
      point({ id: "a", model: "Alpha", score: 80 }),
      point({ id: "b", model: "Beta", score: 71 }),
    ]));
    expect(sentences[0]).toBe("Alpha leads at 80%, ahead of Beta at 71%.");
  });

  test("reports a tie instead of inventing an order", () => {
    const sentences = atlasTakeaways(dataset([
      point({ id: "a", model: "Alpha", score: 80 }),
      point({ id: "b", model: "Beta", score: 80 }),
      point({ id: "c", model: "Gamma", score: 10 }),
    ]));
    expect(sentences[0]).toBe("Alpha and Beta share the top score at 80%.");
  });

  test("says when a source does not separate the top two", () => {
    const overlapping = atlasTakeaways(dataset([
      point({ id: "a", model: "Alpha", score: 80, uncertainty: { lower: 77, upper: 83, label: "±1 SE" } }),
      point({ id: "b", model: "Beta", score: 78, uncertainty: { lower: 75, upper: 81, label: "±1 SE" } }),
    ]));
    expect(overlapping).toContain("Their reported uncertainty ranges overlap, so this source does not separate the top two.");
    const separated = atlasTakeaways(dataset([
      point({ id: "a", model: "Alpha", score: 80, uncertainty: { lower: 79, upper: 81, label: "±1 SE" } }),
      point({ id: "b", model: "Beta", score: 60, uncertainty: { lower: 59, upper: 61, label: "±1 SE" } }),
    ]));
    expect(separated).toContain("Their reported uncertainty ranges do not overlap.");
  });

  test("names a cheaper result that stays within five points of the leader", () => {
    const sentences = atlasTakeaways(dataset([
      point({ id: "a", model: "Alpha", score: 80, costUsd: 40 }),
      point({ id: "b", model: "Beta", score: 77, costUsd: 2 }),
    ], { costLabel: "Cost per task" }));
    expect(sentences).toContain("Within 5 points of the leader, the cheapest result is Beta at $2.00, 20× less than the leader's $40.00, and it gives up 3%.");
  });

  test("does not claim a trade-off when the leader is already cheapest", () => {
    const sentences = atlasTakeaways(dataset([
      point({ id: "a", model: "Alpha", score: 80, costUsd: 2 }),
      point({ id: "b", model: "Beta", score: 78, costUsd: 40 }),
    ], { costLabel: "Cost per task" }));
    expect(sentences.join(" ")).not.toContain("cheapest result");
  });

  test("ignores a cheaper result that is far behind the leader", () => {
    const sentences = atlasTakeaways(dataset([
      point({ id: "a", model: "Alpha", score: 80, costUsd: 40 }),
      point({ id: "b", model: "Beta", score: 40, costUsd: 1 }),
    ], { costLabel: "Cost per task" }));
    expect(sentences.join(" ")).not.toContain("cheapest result");
  });

  test("reads the span low to high when a lower score is better", () => {
    const sentences = atlasTakeaways(dataset([
      point({ id: "a", model: "Alpha", score: 5 }),
      point({ id: "b", model: "Beta", score: 9 }),
      point({ id: "c", model: "Gamma", score: 14 }),
    ], { score: { label: "Word error rate", unit: "%", direction: "lower", minimum: 0, maximum: 100 } }));
    expect(sentences[0]).toBe("Alpha leads at 5%, ahead of Beta at 9%.");
    expect(sentences).toContain("3 systems span 5% to 14%.");
  });

  test("distinguishes effort variants of one system by the published setting", () => {
    const sentences = atlasTakeaways(dataset([
      point({ id: "a", model: "Alpha", score: 80, effort: "high" }),
      point({ id: "b", model: "Alpha", score: 70, effort: "low" }),
    ]));
    expect(sentences[0]).toBe("Alpha (high) leads at 80%, ahead of Alpha (low) at 70%.");
  });

  test("states plainly when only one configuration is charted", () => {
    expect(atlasTakeaways(dataset([point({ id: "a", model: "Alpha", score: 80 })]))[0])
      .toBe("Alpha is the only charted configuration, at 80%.");
  });

  test("returns nothing for an empty cohort rather than an empty sentence", () => {
    expect(atlasTakeaways(dataset([]))).toEqual([]);
  });
});
