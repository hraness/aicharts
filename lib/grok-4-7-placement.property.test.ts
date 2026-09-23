import { expect, test } from "bun:test";

import type { CodingAgentRecord } from "./coding-agent-data";
import { aaIndexCostFrontier } from "./coding-agent-snapshot-rows";
import {
  GROK_47_CODING_CONFIGURATION,
  GROK_47_INTELLIGENCE_SLUG,
  competitionRank,
  grokCodingAgentPlacement,
  grokIntelligencePlacement,
  spellOrdinal,
} from "./grok-4-7-placement";
import { codingAgentRecord } from "./grok-4-7-placement.test";
import { comparableIntelligenceRecords } from "./intelligence-efficiency";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";
import { assertProperty, fc } from "./property-test";

const scoreArb = fc.double({ min: 0, max: 100, noNaN: true });
const costArb = fc.double({ min: 0.001, max: 50, noNaN: true });
const nullableScoreArb = fc.option(scoreArb, { nil: null });

const otherCodingRecordsArb = fc.array(
  fc.record({
    aaIndex: nullableScoreArb,
    costUsd: fc.option(costArb, { nil: null }),
    deepSwe: nullableScoreArb,
    index: fc.nat({ max: 99 }),
    sweAtlas: nullableScoreArb,
    terminalBench: nullableScoreArb,
  }),
  { maxLength: 24 },
).map(items => items.map((item, position) => codingAgentRecord({
  ...item,
  id: `other-${item.index}-${position}`,
})));

const codingCohortArb = fc.record({
  cost: costArb,
  deepSwe: nullableScoreArb,
  others: otherCodingRecordsArb,
  score: scoreArb,
  sweAtlas: nullableScoreArb,
  terminalBench: nullableScoreArb,
}).map(({ cost, deepSwe, others, score, sweAtlas, terminalBench }) => ({
  grok: codingAgentRecord({
    ...GROK_47_CODING_CONFIGURATION,
    aaIndex: score,
    costUsd: cost,
    deepSwe,
    id: "grok-4-7",
    setting: "xhigh",
    sweAtlas,
    terminalBench,
  }),
  others,
}));

function indexOf(record: CodingAgentRecord): number {
  const value = record.benchmarks.aaIndex;
  if (value === null) throw new Error("Indexed row lost its AA Index.");
  return value;
}

test("coding-agent rank counts exactly the rows with a higher AA Index", () => {
  assertProperty(fc.property(codingCohortArb, ({ grok, others }) => {
    const placement = grokCodingAgentPlacement([...others, grok]);
    if (placement === undefined) throw new Error("Grok row must be indexed and costed.");
    const indexed = others.filter(other => other.benchmarks.aaIndex !== null);
    const higher = indexed.filter(other => indexOf(other) > indexOf(grok));
    expect(placement.indexedCount).toBe(indexed.length + 1);
    expect(placement.rank).toBe(higher.length + 1);
    expect(placement.higher).toHaveLength(higher.length);
    for (let position = 1; position < placement.higher.length; position += 1) {
      const previous = placement.higher[position - 1];
      const current = placement.higher[position];
      if (previous === undefined || current === undefined) throw new Error("Higher list is short.");
      expect(indexOf(previous)).toBeGreaterThanOrEqual(indexOf(current));
    }
    expect(indexOf(placement.leader)).toBeGreaterThanOrEqual(indexOf(grok));
  }));
});

test("a coding-agent dominator removes Grok 4.7 from the chart frontier", () => {
  assertProperty(fc.property(codingCohortArb, ({ grok, others }) => {
    const records = [...others, grok];
    const placement = grokCodingAgentPlacement(records);
    if (placement === undefined) throw new Error("Grok row must be indexed and costed.");
    const cost = grok.economics.costUsd ?? Number.NaN;
    const dominated = others.some(other => (
      other.benchmarks.aaIndex !== null
      && other.economics.costUsd !== null
      && other.economics.costUsd > 0
      && other.economics.costUsd <= cost
      && other.benchmarks.aaIndex >= indexOf(grok)
      && (other.economics.costUsd < cost || other.benchmarks.aaIndex > indexOf(grok))
    ));
    expect(placement.dominators.length > 0).toBe(dominated);
    expect(placement.onCostFrontier)
      .toBe(aaIndexCostFrontier(records).some(point => point.record.id === grok.id));
    if (dominated) expect(placement.onCostFrontier).toBeFalse();
    for (let position = 1; position < placement.dominators.length; position += 1) {
      const previous = placement.dominators[position - 1];
      const current = placement.dominators[position];
      if (previous === undefined || current === undefined) throw new Error("Dominator list is short.");
      expect(previous.economics.costUsd).toBeLessThanOrEqual(current.economics.costUsd);
    }
  }));
});

test("component ranks stay inside the rows that carry the component", () => {
  assertProperty(fc.property(codingCohortArb, ({ grok, others }) => {
    const placement = grokCodingAgentPlacement([...others, grok]);
    if (placement === undefined) throw new Error("Grok row must be indexed and costed.");
    for (const component of placement.components) {
      const carrying = [...others, grok].filter(record => record.benchmarks[component.metric] !== null);
      expect(component.count).toBe(carrying.length);
      expect(component.rank).toBeGreaterThanOrEqual(1);
      expect(component.rank).toBeLessThanOrEqual(component.count);
      expect(component.leader.benchmarks[component.metric] ?? Number.NaN)
        .toBeGreaterThanOrEqual(component.value);
      expect(component.rank === 1).toBe(
        (component.leader.benchmarks[component.metric] ?? Number.NaN) === component.value,
      );
    }
    const terminal = grok.benchmarks.terminalBench;
    const expectedSplit = terminal === null
      ? []
      : others.filter(other => (
        other.benchmarks.aaIndex !== null
        && indexOf(other) < indexOf(grok)
        && other.benchmarks.terminalBench !== null
        && other.benchmarks.terminalBench > terminal
      ));
    expect(placement.lowerIndexHigherTerminal).toHaveLength(expectedSplit.length);
  }));
});

const otherIntelligenceRecordsArb = fc.array(
  fc.record({ cost: costArb, index: fc.nat({ max: 99 }), score: scoreArb }),
  { maxLength: 24 },
).map(items => items.map((item, position) => (
  intelligenceRecord(`other-${item.index}-${position}`, item.score, item.cost)
)));

const intelligenceCohortArb = fc.record({ cost: costArb, others: otherIntelligenceRecordsArb, score: scoreArb })
  .map(({ cost, others, score }) => ({
    grok: intelligenceRecord(GROK_47_INTELLIGENCE_SLUG, score, cost, 80_000),
    others,
  }));

test("Intelligence Index frontier membership is exactly the absence of a dominator", () => {
  assertProperty(fc.property(intelligenceCohortArb, ({ grok, others }) => {
    const placement = grokIntelligencePlacement([...others, grok]);
    if (placement === undefined) throw new Error("Grok row must be comparable.");
    const cost = comparableTaskCost(grok);
    const dominated = others.some(other => (
      comparableTaskCost(other) <= cost
      && other.intelligenceIndex >= grok.intelligenceIndex
      && (comparableTaskCost(other) < cost || other.intelligenceIndex > grok.intelligenceIndex)
    ));
    expect(placement.onCostFrontier).toBe(!dominated);
    expect(placement.dominators.length > 0).toBe(dominated);
    expect(placement.cohortSize).toBe(comparableIntelligenceRecords([...others, grok]).length);
    const higher = others.filter(other => other.intelligenceIndex > grok.intelligenceIndex);
    expect(placement.rank).toBe(higher.length + 1);
    if (placement.cheapestHigher === undefined) {
      expect(higher).toHaveLength(0);
    } else {
      const cheapest = Math.min(...higher.map(comparableTaskCost));
      expect(comparableTaskCost(placement.cheapestHigher.record)).toBe(cheapest);
      expect(placement.cheapestHigher.multiple).toBeCloseTo(cheapest / cost, 9);
    }
  }));
});

test("Intelligence Index neighbors are exactly the other rows inside the window, cheapest first", () => {
  assertProperty(fc.property(
    intelligenceCohortArb,
    fc.double({ min: 0.01, max: 20, noNaN: true }),
    ({ grok, others }, window) => {
      const placement = grokIntelligencePlacement([grok, ...others], window);
      if (placement === undefined) throw new Error("Grok row must be comparable.");
      const expected = others.filter(other => (
        Math.abs(other.intelligenceIndex - grok.intelligenceIndex) <= window
      ));
      expect(placement.neighbors).toHaveLength(expected.length);
      expect(placement.neighbors.every(record => record.id !== grok.id)).toBeTrue();
      for (let position = 1; position < placement.neighbors.length; position += 1) {
        const previous = placement.neighbors[position - 1];
        const current = placement.neighbors[position];
        if (previous === undefined || current === undefined) throw new Error("Neighbor list is short.");
        expect(comparableTaskCost(previous)).toBeLessThanOrEqual(comparableTaskCost(current));
      }
    },
  ));
});

test("competition rank is one plus the count of strictly greater values", () => {
  assertProperty(fc.property(
    fc.double({ min: 0, max: 100, noNaN: true }),
    fc.array(fc.double({ min: 0, max: 100, noNaN: true }), { maxLength: 40 }),
    (value, values) => {
      const rank = competitionRank(value, values);
      expect(rank).toBe(values.filter(candidate => candidate > value).length + 1);
      expect(rank).toBeGreaterThanOrEqual(1);
      expect(rank).toBeLessThanOrEqual(values.length + 1);
    },
  ));
});

test("ordinals spell zero through nine and suffix every larger integer", () => {
  assertProperty(fc.property(fc.nat({ max: 10_000 }), (value) => {
    const text = spellOrdinal(value);
    if (value < 10) {
      expect(text).toMatch(/^[a-z]+$/u);
    } else {
      expect(text).toMatch(/^\d+(st|nd|rd|th)$/u);
      expect(Number.parseInt(text, 10)).toBe(value);
      const tens = value % 100;
      const suffix = text.slice(-2);
      if (tens >= 11 && tens <= 13) expect(suffix).toBe("th");
      else if (value % 10 === 1) expect(suffix).toBe("st");
      else if (value % 10 === 2) expect(suffix).toBe("nd");
      else if (value % 10 === 3) expect(suffix).toBe("rd");
      else expect(suffix).toBe("th");
    }
  }));
});
