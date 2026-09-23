import { describe, expect, test } from "bun:test";

import type { BenchmarkAtlasDataset, BenchmarkAtlasPoint } from "./benchmark-atlas";
import { atlasTakeaways, atlasTakeawaysBasis } from "./benchmark-atlas-takeaways";

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
    expect(sentences).toContain("Within 5 percentage points of the top score, the cheapest result is Beta at $2.00. The leader costs 20× as much, $40.00, and scores 3 points higher.");
  });

  test("reports a small cost gap as a comparison, not a multiple, and the score gap in points", () => {
    const sentences = atlasTakeaways(dataset([
      point({ id: "a", model: "Alpha", score: 80, costUsd: 3 }),
      point({ id: "b", model: "Beta", score: 79, costUsd: 2 }),
    ], { costLabel: "Cost per task" }));
    expect(sentences).toContain("Within 5 percentage points of the top score, the cheapest result is Beta at $2.00, against $3.00 for the leader, and it scores 1 point lower.");
  });

  test("keeps a tie's cost comparison inside the tie instead of naming one co-leader the leader", () => {
    const sentences = atlasTakeaways(dataset([
      point({ id: "a", model: "Alpha", score: 80, costUsd: 30 }),
      point({ id: "b", model: "Beta", score: 80, costUsd: 3 }),
      point({ id: "c", model: "Gamma", score: 78, costUsd: 1 }),
      point({ id: "d", model: "Delta", score: 10, costUsd: 0.5 }),
    ], { costLabel: "Cost per task" }));
    expect(sentences[0]).toBe("Alpha and Beta share the top score at 80%.");
    expect(sentences).toContain("Among the tied leaders, costs run from $3.00 for Beta to $30.00 for Alpha.");
    expect(sentences).toContain("Within 5 percentage points of the top score, the cheapest result is Gamma at $1.00. Beta costs 3.0× as much, $3.00, and scores 2 points higher.");
    expect(sentences.join(" ")).not.toContain("the leader");
  });

  test("names the worse direction correctly when a lower score is better", () => {
    const sentences = atlasTakeaways(dataset([
      point({ id: "a", model: "Alpha", score: 5, costUsd: 3 }),
      point({ id: "b", model: "Beta", score: 7, costUsd: 2 }),
    ], { costLabel: "Cost per task", score: { label: "Error rate", unit: "%", direction: "lower", minimum: 0, maximum: 100 } }));
    expect(sentences).toContain("Within 5 percentage points of the top score, the cheapest result is Beta at $2.00, against $3.00 for the leader, and it scores 2 points higher.");
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
    expect(sentences).toContain("Scores across the three charted systems run from 5% to 14%.");
  });

  test("writes each range with its unit once and counts from 10 as numerals", () => {
    const systems = (count: number) => Array.from({ length: count }, (_, index) => point({ id: `p${index}`, model: `Model ${index}`, score: 90 - index }));
    expect(atlasTakeaways(dataset(systems(12), { score: { label: "Index", unit: "index points", direction: "higher", minimum: 0, maximum: 100 } })))
      .toContain("Scores across the 12 charted systems run from 79 to 90 index points.");
    expect(atlasTakeaways(dataset(systems(4), { score: { label: "Word error rate", unit: "% WER", direction: "lower", minimum: 0, maximum: 100 } })))
      .toContain("Scores across the four charted systems run from 87% to 90% WER.");
    expect(atlasTakeaways(dataset(systems(3), { score: { label: "Overall", unit: "/ 100", direction: "higher", minimum: 0, maximum: 100 } })))
      .toContain("Scores across the three charted systems run from 88 to 90 out of 100.");
  });

  test("distinguishes effort variants of one system by the published setting", () => {
    const sentences = atlasTakeaways(dataset([
      point({ id: "a", model: "Alpha", score: 80, effort: "high" }),
      point({ id: "b", model: "Alpha", score: 70, effort: "low" }),
    ]));
    expect(sentences[0]).toBe("Alpha (high) leads at 80%, ahead of Alpha (low) at 70%.");
  });

  test("counts the settings of a single-system chart as configurations", () => {
    const single = dataset([
      point({ id: "a", model: "Alpha", score: 80, effort: "high" }),
      point({ id: "b", model: "Alpha", score: 70, effort: "medium" }),
      point({ id: "c", model: "Alpha", score: 60, effort: "low" }),
    ]);
    expect(atlasTakeaways(single)).toContain("Scores across the three charted configurations run from 60% to 80%.");
    expect(atlasTakeawaysBasis(single)).toBe("These sentences describe every charted result and ignore the filters above. Each setting of the charted system counts separately.");
    const several = dataset([
      point({ id: "a", model: "Alpha", score: 80, effort: "high" }),
      point({ id: "b", model: "Alpha", score: 70, effort: "low" }),
      point({ id: "c", model: "Beta", score: 60 }),
    ]);
    expect(atlasTakeawaysBasis(several)).toBe("These sentences describe every charted result and ignore the filters above. Each system counts once, at its best-scoring setting.");
  });

  test("states plainly when only one configuration is charted", () => {
    expect(atlasTakeaways(dataset([point({ id: "a", model: "Alpha", score: 80 })]))[0])
      .toBe("Alpha is the only charted configuration, at 80%.");
  });

  test("returns nothing for an empty cohort rather than an empty sentence", () => {
    expect(atlasTakeaways(dataset([]))).toEqual([]);
  });
});
