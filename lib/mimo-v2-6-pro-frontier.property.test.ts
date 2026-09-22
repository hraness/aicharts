import { expect, test } from "bun:test";

import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import { comparableIntelligenceRecords } from "./intelligence-efficiency";
import {
  MIMO_V26_RECORD_SLUG,
  comparableTaskCost,
  formatCostMultiple,
  formatPointGap,
  mimoComparisonRows,
  mimoFrontierPosition,
  mimoScoreNeighbors,
} from "./mimo-v2-6-pro-frontier";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";
import { assertProperty, fc } from "./property-test";

const scoreArb = fc.double({ min: 0, max: 100, noNaN: true });
const costArb = fc.double({ min: 0.001, max: 50, noNaN: true });

const otherRecordsArb = fc.array(
  fc.record({ cost: costArb, index: fc.nat({ max: 99 }), score: scoreArb }),
  { maxLength: 24 },
).map(items => items.map((item, position) => (
  intelligenceRecord(`other-${item.index}-${position}`, item.score, item.cost)
)));

const cohortArb = fc.record({ cost: costArb, others: otherRecordsArb, score: scoreArb })
  .map(({ cost, others, score }) => ({
    mimo: intelligenceRecord(MIMO_V26_RECORD_SLUG, score, cost, 5_000),
    others,
  }));

test("frontier membership is exactly the absence of a dominating configuration", () => {
  assertProperty(fc.property(cohortArb, ({ mimo, others }) => {
    const records: ArtificialAnalysisIntelligenceRecord[] = [...others, mimo];
    const position = mimoFrontierPosition(records);
    expect(position).toBeDefined();
    if (position === undefined) return;
    const cost = comparableTaskCost(mimo);
    const dominated = others.some(other => (
      comparableTaskCost(other) <= cost
      && other.intelligenceIndex >= mimo.intelligenceIndex
      && (comparableTaskCost(other) < cost || other.intelligenceIndex > mimo.intelligenceIndex)
    ));
    expect(position.onCostFrontier).toBe(!dominated);
    if (position.onCostFrontier) {
      expect(position.cheapestHigher === undefined || position.cheapestHigher.multiple > 1).toBeTrue();
      expect(position.bestCheaper === undefined || position.bestCheaper.gapPoints > 0).toBeTrue();
    }
  }));
});

test("counts partition the cohort and the named extremes are extreme", () => {
  assertProperty(fc.property(cohortArb, ({ mimo, others }) => {
    const position = mimoFrontierPosition([mimo, ...others]);
    if (position === undefined) throw new Error("MiMo row must be comparable.");
    const cost = comparableTaskCost(mimo);
    const higher = others.filter(other => other.intelligenceIndex > mimo.intelligenceIndex);
    const cheaper = others.filter(other => comparableTaskCost(other) < cost);
    expect(position.higherCount).toBe(higher.length);
    expect(position.cheaperCount).toBe(cheaper.length);
    if (position.cheapestHigher !== undefined) {
      const cheapest = Math.min(...higher.map(comparableTaskCost));
      expect(comparableTaskCost(position.cheapestHigher.record)).toBe(cheapest);
      expect(position.cheapestHigher.multiple).toBeCloseTo(cheapest / cost, 9);
    } else {
      expect(higher).toHaveLength(0);
    }
    if (position.bestCheaper !== undefined) {
      const best = Math.max(...cheaper.map(record => record.intelligenceIndex));
      expect(position.bestCheaper.record.intelligenceIndex).toBe(best);
      expect(position.bestCheaper.gapPoints).toBeCloseTo(mimo.intelligenceIndex - best, 9);
    } else {
      expect(cheaper).toHaveLength(0);
    }
  }));
});

test("frontier neighbors bracket MiMo on both axes when it is a vertex", () => {
  assertProperty(fc.property(cohortArb, ({ mimo, others }) => {
    const position = mimoFrontierPosition([mimo, ...others]);
    if (position === undefined) throw new Error("MiMo row must be comparable.");
    if (!position.onCostFrontier) {
      expect(position.above).toBeUndefined();
      expect(position.below).toBeUndefined();
      return;
    }
    const cost = comparableTaskCost(mimo);
    if (position.above !== undefined) {
      expect(position.above.intelligenceIndex).toBeGreaterThan(mimo.intelligenceIndex);
      expect(comparableTaskCost(position.above)).toBeGreaterThan(cost);
    }
    if (position.below !== undefined) {
      expect(position.below.intelligenceIndex).toBeLessThan(mimo.intelligenceIndex);
      expect(comparableTaskCost(position.below)).toBeLessThan(cost);
    }
  }));
});

test("same-score neighbors are exactly the other comparable rows inside the window, cheapest first", () => {
  assertProperty(fc.property(
    cohortArb,
    fc.double({ min: 0.01, max: 20, noNaN: true }),
    ({ mimo, others }, window) => {
      const records = [mimo, ...others];
      const neighbors = mimoScoreNeighbors(records, window);
      const expected = comparableIntelligenceRecords(others)
        .filter(other => Math.abs(other.intelligenceIndex - mimo.intelligenceIndex) <= window);
      expect(neighbors).toHaveLength(expected.length);
      expect(neighbors.every(record => record.id !== mimo.id)).toBeTrue();
      for (let index = 1; index < neighbors.length; index += 1) {
        const previous = neighbors[index - 1];
        const current = neighbors[index];
        if (previous === undefined || current === undefined) throw new Error("Neighbor list is short.");
        expect(comparableTaskCost(previous)).toBeLessThanOrEqual(comparableTaskCost(current));
      }
    },
  ));
});

test("comparison rows never invent a model and keep MiMo’s cost as the unit", () => {
  assertProperty(fc.property(cohortArb, ({ mimo, others }) => {
    const rows = mimoComparisonRows([mimo, ...others]);
    expect(rows).toEqual([]);
    const withKimi = mimoComparisonRows([mimo, ...others, intelligenceRecord("kimi-k3", 43.6, 2)]);
    expect(withKimi).toHaveLength(1);
    const [row] = withKimi;
    if (row === undefined) throw new Error("Kimi row must be present.");
    expect(row.costMultiple).toBeCloseTo(2 / comparableTaskCost(mimo), 9);
    expect(row.scoreGapPoints).toBeCloseTo(43.6 - mimo.intelligenceIndex, 9);
  }));
});

test("formatters round to one decimal and keep the sign explicit", () => {
  assertProperty(fc.property(fc.double({ min: 0.05, max: 1_000, noNaN: true }), (multiple) => {
    const text = formatCostMultiple(multiple);
    expect(text).toMatch(/^\d+\.\dx$/u);
    expect(Math.abs(Number.parseFloat(text) - multiple)).toBeLessThanOrEqual(0.05 + 1e-9);
  }));
  assertProperty(fc.property(fc.double({ min: -100, max: 100, noNaN: true }), (points) => {
    const text = formatPointGap(points);
    expect(text).toMatch(/^[+−]\d+\.\d$/u);
    const parsed = Number.parseFloat(text.replace("−", "-"));
    expect(Math.abs(parsed - points)).toBeLessThanOrEqual(0.05 + 1e-9);
  }));
});
