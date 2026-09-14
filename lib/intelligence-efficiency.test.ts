import { describe, expect, test } from "bun:test";

import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import {
  comparableIntelligenceRecords,
  focusModelComparison,
  intelligenceScoreDomain,
  logScale,
  logTicks,
  orderedParetoPath,
  paddedLogDomain,
  paretoMembership,
  type IntelligenceEfficiencyMetric,
} from "./intelligence-efficiency";
import { assertProperty, fc } from "./property-test";

function record(
  id: string,
  intelligenceIndex: number,
  outputTokens: number,
  costUsd: number | null,
  name = id,
): ArtificialAnalysisIntelligenceRecord {
  return {
    costUsdPerTask: costUsd === null ? null : {
      answer: costUsd,
      cacheRead: 0,
      cacheWrite: 0,
      input: 0,
      nonCacheInput: 0,
      output: costUsd,
      reasoning: 0,
      total: costUsd,
    },
    creator: { id: "lab", name: "Lab", slug: "lab" },
    detailsUrl: `https://artificialanalysis.ai/models/${id}`,
    effort: name.endsWith("(max)")
      ? { label: "max", level: 60, slug: "max" }
      : null,
    id,
    intelligenceIndex,
    name,
    outputTokensPerTask: {
      answer: outputTokens,
      reasoning: 0,
      total: outputTokens,
    },
    release: { name, slug: id },
    releaseDate: "2026-09-04",
    shortName: name,
    slug: id,
  };
}

describe("Artificial Analysis Intelligence efficiency cohort", () => {
  test("uses one complete positive-cost cohort and sorts it by score", () => {
    const valid = record("valid", 61, 15_000, 1.2);
    const lower = record("lower", 42, 8_000, 0.2);
    const nullCost = record("null-cost", 80, 10_000, null);
    const zeroCost = record("zero-cost", 75, 10_000, 0);
    const zeroOutput = record("zero-output", 70, 0, 1);
    const invalidScore = record("invalid-score", Number.NaN, 10_000, 1);

    expect(comparableIntelligenceRecords([
      nullCost,
      lower,
      invalidScore,
      valid,
      zeroOutput,
      zeroCost,
    ]).map(item => item.id)).toEqual(["valid", "lower"]);
  });

  test("computes the published Astra and Sol comparison from source precision", () => {
    const astra = record(
      "gpt-6-astra",
      61.2161067377315,
      14_875.597662702807,
      1.6672644402217776,
      "GPT-6 Astra (max)",
    );
    const sol = record(
      "gpt-5-6-sol",
      60.9298701329203,
      16_878.794951920757,
      0.952976204905937,
      "GPT-5.6 Sol (max)",
    );

    const higherScoringAstraVariant = record(
      "gpt-6-astra-xhigh",
      99,
      1_000,
      .1,
      "GPT-6 Astra (xhigh)",
    );
    const higherScoringSolVariant = record(
      "gpt-5-6-sol-xhigh",
      98,
      1_100,
      .1,
      "GPT-5.6 Sol (xhigh)",
    );

    const comparison = focusModelComparison([
      higherScoringSolVariant,
      higherScoringAstraVariant,
      sol,
      astra,
    ]);
    expect(comparison?.astra.id).toBe("gpt-6-astra");
    expect(comparison?.sol.id).toBe("gpt-5-6-sol");
    expect(comparison?.roundedIntelligenceScore).toBe(61);
    expect(comparison?.outputTokenReductionPercent).toBeCloseTo(11.9, 1);
    expect(comparison?.costIncreasePercent).toBeCloseTo(75, 1);
    expect(focusModelComparison([astra])).toBeNull();
  });
});

describe("logarithmic chart math", () => {
  test("pads observed values and maps geometric distance linearly", () => {
    const domain = paddedLogDomain([10, 1_000], 0);
    const scale = logScale(domain, [20, 620]);

    expect(domain[0]).toBeCloseTo(10, 12);
    expect(domain[1]).toBeCloseTo(1_000, 12);
    expect(scale(10)).toBeCloseTo(20, 10);
    expect(scale(100)).toBeCloseTo(320, 10);
    expect(scale(1_000)).toBeCloseTo(620, 10);
  });

  test("expands a singleton, makes restrained ticks, and rejects invalid axes", () => {
    expect(paddedLogDomain([100])).toEqual([100 / Math.sqrt(10), 100 * Math.sqrt(10)]);
    const domain = paddedLogDomain([.04, 7_000_000]);
    const ticks = logTicks(domain, 6);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks).toEqual(ticks.toSorted((left, right) => left - right));
    expect(ticks.every(tick => tick >= domain[0] && tick <= domain[1])).toBe(true);
    expect(() => paddedLogDomain([])).toThrow(RangeError);
    expect(() => paddedLogDomain([0, 1])).toThrow(RangeError);
    expect(() => logScale([0, 1], [0, 10])).toThrow(RangeError);
    expect(() => logTicks([1, 10], 1)).toThrow(RangeError);
  });

  test("keeps a zero baseline and rounds the observed score ceiling by tens", () => {
    expect(intelligenceScoreDomain([
      record("a", 61.2, 10_000, 1),
      record("b", 60.9, 12_000, 2),
    ])).toEqual([0, 70]);
    expect(intelligenceScoreDomain([])).toEqual([0, 10]);
    expect(intelligenceScoreDomain([
      record("corrupt", Number.MAX_VALUE, 10_000, 1),
      record("above-scale", 100.000_001, 10_000, 1),
      record("valid", 62, 10_000, 1),
    ])).toEqual([0, 70]);
    expect(comparableIntelligenceRecords([
      record("corrupt", Number.MAX_VALUE, 10_000, 1),
      record("above-scale", 100.000_001, 10_000, 1),
    ])).toEqual([]);
  });
});

describe("Pareto membership and drawing order", () => {
  const records = [
    record("cheap", 30, 5_000, .1),
    record("dominated", 25, 8_000, .2),
    record("knee", 55, 10_000, .5),
    record("knee-tie", 55, 10_000, .5),
    record("flat", 55, 20_000, 1),
    record("peak", 64, 40_000, 2),
  ];

  test("preserves exact frontier ties while drawing each coordinate once", () => {
    expect([...paretoMembership(records, "outputTokensPerTask")].toSorted()).toEqual([
      "cheap",
      "knee",
      "knee-tie",
      "peak",
    ]);
    expect(orderedParetoPath(records, "outputTokensPerTask").map(point => point.record.id))
      .toEqual(["cheap", "knee", "peak"]);
  });
});

const generatedRecords = fc.array(fc.record({
  cost: fc.integer({ min: 1, max: 100_000 }),
  output: fc.integer({ min: 1, max: 10_000_000 }),
  score: fc.integer({ min: 0, max: 100 }),
}), { maxLength: 70 }).map(items => items.map((item, index) => (
  record(`generated-${String(index)}`, item.score, item.output, item.cost)
)));

for (const metric of ["costUsdPerTask", "outputTokensPerTask"] as const) {
  test(`property: ${metric} frontier dominates every comparable point`, () => {
    assertProperty(fc.property(generatedRecords, (records) => {
      const frontierIds = paretoMembership(records, metric);
      const frontier = records.filter(item => frontierIds.has(item.id));
      for (const candidate of records) {
        const candidateX = metricValue(candidate, metric);
        const dominator = frontier.find(item => (
          metricValue(item, metric) <= candidateX
          && item.intelligenceIndex >= candidate.intelligenceIndex
        ));
        expect(dominator).toBeDefined();
      }
    }), { numRuns: 300 });
  });

  test(`property: ${metric} path is order-independent and rises with x`, () => {
    assertProperty(fc.property(generatedRecords, (records) => {
      const path = orderedParetoPath(records, metric);
      const reversedPath = orderedParetoPath(records.toReversed(), metric);
      expect(path.map(point => point.record.id)).toEqual(reversedPath.map(point => point.record.id));
      for (let index = 1; index < path.length; index += 1) {
        const previous = path[index - 1];
        const current = path[index];
        expect(previous).toBeDefined();
        expect(current).toBeDefined();
        if (previous !== undefined && current !== undefined) {
          expect(current.xValue).toBeGreaterThan(previous.xValue);
          expect(current.yValue).toBeGreaterThan(previous.yValue);
        }
      }
    }), { numRuns: 300 });
  });
}

test("property: logarithmic scale is monotone and finite across positive domains", () => {
  assertProperty(fc.property(
    fc.array(fc.integer({ min: 1, max: 10_000_000 }), { minLength: 2, maxLength: 50 }),
    values => {
      const unique = [...new Set(values)].toSorted((left, right) => left - right);
      if (unique.length < 2) return;
      const domain = paddedLogDomain(unique);
      const scale = logScale(domain, [0, 1]);
      const positions = unique.map(scale);
      expect(positions.every(Number.isFinite)).toBe(true);
      expect(positions).toEqual(positions.toSorted((left, right) => left - right));
    },
  ), { numRuns: 300 });
});

function metricValue(
  item: ArtificialAnalysisIntelligenceRecord,
  metric: IntelligenceEfficiencyMetric,
): number {
  if (metric === "outputTokensPerTask") return item.outputTokensPerTask.total;
  if (item.costUsdPerTask === null) throw new Error("Test record cost invariant failed.");
  return item.costUsdPerTask.total;
}
