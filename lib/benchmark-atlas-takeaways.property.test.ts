import { expect, test } from "bun:test";

import { sortAtlasPoints, type BenchmarkAtlasDataset, type BenchmarkAtlasPoint } from "./benchmark-atlas";
import { ATLAS_DATASETS } from "./benchmark-atlas-catalog";
import { atlasTakeaways } from "./benchmark-atlas-takeaways";
import { assertProperty, fc } from "./property-test";

const pointArbitrary = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }).filter(value => value.trim().length > 0),
  model: fc.constantFrom("Alpha", "Beta", "Gamma", "Delta"),
  provider: fc.constantFrom("Acme", "Globex"),
  harness: fc.option(fc.constantFrom("Harness A", "Harness B"), { nil: null }),
  effort: fc.option(fc.constantFrom("low", "high"), { nil: null }),
  score: fc.double({ min: 0, max: 100, noNaN: true }),
  costUsd: fc.option(fc.double({ min: 0.0001, max: 5000, noNaN: true }), { nil: null }),
  spread: fc.double({ min: 0, max: 8, noNaN: true }),
});

function datasetArbitrary() {
  return fc.record({
    rows: fc.array(pointArbitrary, { minLength: 1, maxLength: 24 }),
    direction: fc.constantFrom("higher" as const, "lower" as const),
    unit: fc.constantFrom("%", "Elo", ""),
    withCost: fc.boolean(),
    withUncertainty: fc.boolean(),
  }).map(({ rows, direction, unit, withCost, withUncertainty }) => {
    const seen = new Set<string>();
    const points: BenchmarkAtlasPoint[] = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      points.push({
        id: row.id, label: row.model, model: row.model, provider: row.provider,
        harness: row.harness, effort: row.effort, score: row.score,
        costUsd: withCost ? row.costUsd : null,
        uncertainty: withUncertainty
          ? { lower: Math.max(0, row.score - row.spread), upper: Math.min(100, row.score + row.spread), label: "±1 standard error" }
          : null,
        sourceUrl: "https://example.com/source",
      });
    }
    const dataset: BenchmarkAtlasDataset = {
      benchmarkId: "generated", version: "1",
      score: { label: "Score", unit, direction, minimum: 0, maximum: 100 },
      source: { name: "Example", url: "https://example.com", retrievedAt: "2026-09-21T00:00:00.000Z" },
      configurationLabel: "Model", comparabilityNote: "Generated.",
      ...(withCost ? { costLabel: "Cost (USD)" } : {}),
      points,
    };
    return dataset;
  });
}

test("property: every takeaway is a finished sentence and never empty", () => {
  assertProperty(fc.property(datasetArbitrary(), dataset => {
    for (const sentence of atlasTakeaways(dataset)) {
      expect(sentence.trim()).toBe(sentence);
      expect(sentence.length).toBeGreaterThan(0);
      expect(sentence.endsWith(".")).toBe(true);
      expect(sentence).not.toContain("undefined");
      expect(sentence).not.toContain("NaN");
      expect(sentence).not.toContain("null");
    }
  }));
});

test("property: the first sentence names a best-scoring configuration", () => {
  assertProperty(fc.property(datasetArbitrary(), dataset => {
    const [lead] = atlasTakeaways(dataset);
    if (lead === undefined) return;
    const best = sortAtlasPoints(dataset)[0];
    const tied = dataset.points.filter(point => point.score === best.score);
    expect(tied.some(point => lead.startsWith(point.model))).toBe(true);
  }));
});

test("property: a model that is not in the dataset is never named", () => {
  assertProperty(fc.property(datasetArbitrary(), dataset => {
    const present = new Set(dataset.points.map(point => point.model));
    const absent = ["Alpha", "Beta", "Gamma", "Delta"].filter(model => !present.has(model));
    const text = atlasTakeaways(dataset).join(" ");
    for (const model of absent) expect(text).not.toContain(model);
  }));
});

test("property: a relative unit never carries a points-based cost claim", () => {
  assertProperty(fc.property(datasetArbitrary(), dataset => {
    if (dataset.score.unit === "%") return;
    expect(atlasTakeaways(dataset).join(" ")).not.toContain("Within 5 points");
  }));
});

test("property: a cost claim only appears when the dataset publishes a cost basis", () => {
  assertProperty(fc.property(datasetArbitrary(), dataset => {
    if (dataset.costLabel !== undefined) return;
    expect(atlasTakeaways(dataset).join(" ")).not.toContain("cheapest result");
  }));
});

test("property: the same dataset always produces the same sentences", () => {
  assertProperty(fc.property(datasetArbitrary(), dataset => {
    expect(atlasTakeaways(dataset)).toEqual(atlasTakeaways(dataset));
  }));
});

test("every published dataset produces readable takeaways", () => {
  for (const dataset of ATLAS_DATASETS) {
    const sentences = atlasTakeaways(dataset);
    expect(sentences.length).toBeGreaterThan(0);
    for (const sentence of sentences) {
      expect(sentence).not.toContain("undefined");
      expect(sentence).not.toContain("NaN");
      expect(sentence).toMatch(/\.$/u);
      // The site's public prose contract forbids em dashes in authored copy.
      expect(sentence).not.toContain("—");
    }
  }
});
