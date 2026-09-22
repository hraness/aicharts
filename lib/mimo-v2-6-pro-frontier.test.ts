import { describe, expect, test } from "bun:test";

import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";

import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import { parseArtificialAnalysisIntelligenceV43Snapshot } from "./artificial-analysis-intelligence-v4-3-data";
import { comparableIntelligenceRecords, paretoMembership } from "./intelligence-efficiency";
import {
  MIMO_V26_CLOSED_REFERENCE_SLUGS,
  MIMO_V26_NAMED_COMPARISONS,
  MIMO_V26_RECORD_SLUG,
  comparableTaskCost,
  formatCostMultiple,
  formatPointGap,
  mimoClosedReferences,
  mimoComparisonRows,
  mimoFrontierPosition,
  mimoRecord,
  mimoScoreNeighbors,
} from "./mimo-v2-6-pro-frontier";

export function intelligenceRecord(
  slug: string,
  intelligenceIndex: number,
  costUsd: number | null,
  outputTokens = 10_000,
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
    detailsUrl: `https://artificialanalysis.ai/models/${slug}`,
    effort: null,
    id: `id-${slug}`,
    intelligenceIndex,
    name: slug,
    outputTokensPerTask: { answer: outputTokens, reasoning: 0, total: outputTokens },
    release: { name: slug, slug },
    releaseDate: "2026-09-21",
    shortName: slug,
    slug,
  };
}

const mimo = intelligenceRecord(MIMO_V26_RECORD_SLUG, 46.3, 0.133, 64_276);
const cheapLow = intelligenceRecord("gpt-5-6-luna-xhigh", 34.6, 0.085);
const dearHigh = intelligenceRecord("gpt-6-astra-medium", 49.6, 1.541);
const dearNear = intelligenceRecord("grok-4-7-high", 46.33, 2.726);
const kimi = intelligenceRecord("kimi-k3", 43.6, 2.0);
const glm = intelligenceRecord("glm-5-3", 44.8, 2.006);
const qwen = intelligenceRecord("qwen3-8-max", 45.4, 5.409);
const fable = intelligenceRecord("claude-fable-5-1", 53.4, 7.63);
const astraMax = intelligenceRecord("gpt-6-astra", 52.7, 3.258);
const nullCost = intelligenceRecord("null-cost", 60, null);

describe("MiMo-V2.6-Pro frontier position", () => {
  test("finds MiMo only inside the comparable cohort", () => {
    expect(mimoRecord([mimo, cheapLow])?.slug).toBe(MIMO_V26_RECORD_SLUG);
    expect(mimoRecord([cheapLow, dearHigh])).toBeUndefined();
    expect(mimoRecord([intelligenceRecord(MIMO_V26_RECORD_SLUG, 46.3, null)])).toBeUndefined();
    expect(mimoFrontierPosition([cheapLow])).toBeUndefined();
  });

  test("reports frontier membership, neighbors, and counts for a small cohort", () => {
    const position = mimoFrontierPosition([dearNear, dearHigh, mimo, cheapLow, nullCost]);
    expect(position).toBeDefined();
    if (position === undefined) return;
    expect(position.onCostFrontier).toBeTrue();
    expect(position.below?.slug).toBe(cheapLow.slug);
    expect(position.above?.slug).toBe(dearHigh.slug);
    expect(position.higherCount).toBe(2);
    expect(position.cheaperCount).toBe(1);
    expect(position.cheapestHigher?.record.slug).toBe(dearHigh.slug);
    expect(position.cheapestHigher?.multiple).toBeCloseTo(1.541 / 0.133, 6);
    expect(position.bestCheaper?.record.slug).toBe(cheapLow.slug);
    expect(position.bestCheaper?.gapPoints).toBeCloseTo(46.3 - 34.6, 6);
  });

  test("leaves the frontier when a cheaper configuration scores at least as high", () => {
    const dominator = intelligenceRecord("dominator", 46.3, 0.1);
    const position = mimoFrontierPosition([mimo, dominator, cheapLow]);
    expect(position?.onCostFrontier).toBeFalse();
    expect(position?.above).toBeUndefined();
    expect(position?.below).toBeUndefined();
    expect(position?.bestCheaper?.record.slug).toBe(dominator.slug);
    expect(position?.bestCheaper?.gapPoints).toBeCloseTo(0, 9);
    expect(position?.higherCount).toBe(0);
  });

  test("keeps an exact score-and-cost tie on the frontier", () => {
    const twin = intelligenceRecord("twin", 46.3, 0.133);
    expect(mimoFrontierPosition([mimo, twin])?.onCostFrontier).toBeTrue();
  });

  test("lists named comparisons in the order Das and Xiaomi name them, skipping absent rows", () => {
    const rows = mimoComparisonRows([qwen, mimo, glm, kimi]);
    expect(rows.map(row => row.comparison.slug)).toEqual(["kimi-k3", "glm-5-3", "qwen3-8-max"]);
    expect(rows[0]?.costMultiple).toBeCloseTo(2 / 0.133, 6);
    expect(rows[0]?.scoreGapPoints).toBeCloseTo(43.6 - 46.3, 6);
    expect(rows[2]?.comparison.dasMultiple).toBeNull();
    expect(mimoComparisonRows([kimi, glm])).toEqual([]);
    expect(new Set(MIMO_V26_NAMED_COMPARISONS.map(comparison => comparison.slug)).size)
      .toBe(MIMO_V26_NAMED_COMPARISONS.length);
  });

  test("orders same-score neighbors cheapest first and rejects a non-positive window", () => {
    const neighbors = mimoScoreNeighbors([qwen, dearNear, mimo, dearHigh, cheapLow]);
    expect(neighbors.map(record => record.slug)).toEqual([dearNear.slug, qwen.slug]);
    expect(mimoScoreNeighbors([qwen, dearNear, mimo], 0.5).map(record => record.slug))
      .toEqual([dearNear.slug]);
    expect(mimoScoreNeighbors([dearNear, qwen])).toEqual([]);
    expect(() => mimoScoreNeighbors([mimo], 0)).toThrow(RangeError);
    expect(() => mimoScoreNeighbors([mimo], Number.NaN)).toThrow(RangeError);
  });

  test("returns closed references in slug order", () => {
    expect(mimoClosedReferences([astraMax, mimo, fable]).map(record => record.slug))
      .toEqual([...MIMO_V26_CLOSED_REFERENCE_SLUGS]);
    expect(mimoClosedReferences([mimo, astraMax]).map(record => record.slug)).toEqual(["gpt-6-astra"]);
  });

  test("formats multiples and gaps and rejects invalid inputs", () => {
    expect(formatCostMultiple(15.04)).toBe("15.0x");
    expect(formatCostMultiple(0.5)).toBe("0.5x");
    expect(() => formatCostMultiple(0)).toThrow(RangeError);
    expect(() => formatCostMultiple(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(formatPointGap(-2.74)).toBe("−2.7");
    expect(formatPointGap(0.05)).toBe("+0.1");
    expect(formatPointGap(0)).toBe("+0.0");
    expect(() => formatPointGap(Number.NaN)).toThrow(RangeError);
    expect(() => comparableTaskCost(nullCost)).toThrow(RangeError);
  });

  test("matches the shared Pareto membership on the checked snapshot", () => {
    const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
    if (!parsed.ok) throw parsed.error;
    const position = mimoFrontierPosition(parsed.value.records);
    expect(position).toBeDefined();
    if (position === undefined) return;
    const cohort = comparableIntelligenceRecords(parsed.value.records);
    expect(position.onCostFrontier)
      .toBe(paretoMembership(cohort, "costUsdPerTask").has(position.record.id));
    expect(position.higherCount + position.cheaperCount).toBeLessThan(cohort.length);
    for (const row of mimoComparisonRows(parsed.value.records)) {
      expect(row.costMultiple).toBeGreaterThan(0);
      expect(row.record.slug).toBe(row.comparison.slug);
    }
  });
});
