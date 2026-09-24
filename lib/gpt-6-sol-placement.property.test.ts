import { expect, test } from "bun:test";

import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import {
  GPT_56_SOL_CODING_CONFIGURATION,
  GPT_6_SOL_CODING_CONFIGURATION,
  GPT_6_SOL_INTELLIGENCE_SLUG,
  effortLadder,
  solCodingAgentPlacement,
  solIntelligencePlacement,
} from "./gpt-6-sol-placement";
import { codingAgentRecord } from "./grok-4-7-placement.test";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";
import { assertProperty, fc } from "./property-test";

const scoreArb = fc.double({ min: 0, max: 100, noNaN: true });
const costArb = fc.double({ min: 0.001, max: 50, noNaN: true });

const otherCodingRecordsArb = fc.array(
  fc.record({
    aaIndex: fc.option(scoreArb, { nil: null }),
    costUsd: fc.option(costArb, { nil: null }),
    index: fc.nat({ max: 99 }),
    predecessor: fc.boolean(),
    setting: fc.constantFrom("max", "high"),
  }),
  { maxLength: 24 },
).map(items => items.map((item, position) => codingAgentRecord({
  ...(item.predecessor ? GPT_56_SOL_CODING_CONFIGURATION : {}),
  aaIndex: item.aaIndex,
  costUsd: item.costUsd,
  id: `other-${item.index}-${position}`,
  setting: item.setting,
})));

const codingCohortArb = fc.record({ cost: costArb, others: otherCodingRecordsArb, score: scoreArb })
  .map(({ cost, others, score }) => ({
    others,
    sol: codingAgentRecord({
      ...GPT_6_SOL_CODING_CONFIGURATION,
      aaIndex: score,
      costUsd: cost,
      id: "gpt-6-sol",
      setting: "max",
    }),
  }));

test("coding-agent neighbors are exactly the other costed rows inside the window, cheapest first", () => {
  assertProperty(fc.property(codingCohortArb, ({ others, sol }) => {
    const placement = solCodingAgentPlacement([...others, sol]);
    if (placement === undefined) throw new Error("Sol row must be indexed and costed.");
    const index = sol.benchmarks.aaIndex ?? Number.NaN;
    const costed = others.filter(other => (
      other.benchmarks.aaIndex !== null && other.economics.costUsd !== null && other.economics.costUsd > 0
    ));
    const withinDefault = costed.filter(other => Math.abs((other.benchmarks.aaIndex ?? Number.NaN) - index) <= 1);
    expect(placement.neighbors).toHaveLength(withinDefault.length);
    expect(placement.neighbors.every(record => record.id !== sol.id)).toBeTrue();
    for (let position = 1; position < placement.neighbors.length; position += 1) {
      const previous = placement.neighbors[position - 1];
      const current = placement.neighbors[position];
      if (previous === undefined || current === undefined) throw new Error("Neighbor list is short.");
      expect(previous.economics.costUsd).toBeLessThanOrEqual(current.economics.costUsd);
    }
    const higher = costed.filter(other => (other.benchmarks.aaIndex ?? Number.NaN) > index);
    if (placement.cheapestHigher === undefined) {
      expect(higher).toHaveLength(0);
    } else {
      const cheapest = Math.min(...higher.map(other => other.economics.costUsd ?? Number.NaN));
      expect(placement.cheapestHigher.record.economics.costUsd).toBe(cheapest);
      expect(placement.cheapestHigher.multiple).toBeCloseTo(cheapest / (sol.economics.costUsd ?? Number.NaN), 9);
    }
  }));
});

test("the predecessor is a GPT-5.6 Sol row at the placed setting, or nothing", () => {
  assertProperty(fc.property(codingCohortArb, ({ others, sol }) => {
    const placement = solCodingAgentPlacement([...others, sol]);
    if (placement === undefined) throw new Error("Sol row must be indexed and costed.");
    const candidates = others.filter(other => (
      other.agent === GPT_56_SOL_CODING_CONFIGURATION.agent
      && other.model === GPT_56_SOL_CODING_CONFIGURATION.model
      && other.providerId === GPT_56_SOL_CODING_CONFIGURATION.providerId
      && other.setting === sol.setting
    ));
    if (candidates.length === 0) {
      expect(placement.predecessor).toBeUndefined();
    } else {
      expect(placement.predecessor).toBeDefined();
      expect(placement.predecessor?.model).toBe(GPT_56_SOL_CODING_CONFIGURATION.model);
      expect(placement.predecessor?.setting).toBe(sol.setting);
    }
  }));
});

function solRow(slug: string, score: number, cost: number): ArtificialAnalysisIntelligenceRecord {
  return { ...intelligenceRecord(slug, score, cost), release: { name: "GPT-6 Sol", slug: GPT_6_SOL_INTELLIGENCE_SLUG } };
}

const intelligenceCohortArb = fc.record({
  cost: costArb,
  others: fc.array(fc.record({ cost: costArb, index: fc.nat({ max: 99 }), score: scoreArb }), { maxLength: 24 })
    .map(items => items.map((item, position) => intelligenceRecord(`other-${item.index}-${position}`, item.score, item.cost))),
  score: scoreArb,
  siblings: fc.array(fc.record({ cost: costArb, index: fc.nat({ max: 99 }), score: scoreArb }), { maxLength: 6 })
    .map(items => items.map((item, position) => solRow(`gpt-6-sol-${item.index}-${position}`, item.score, item.cost))),
}).map(({ cost, others, score, siblings }) => ({
  others,
  siblings,
  sol: solRow(GPT_6_SOL_INTELLIGENCE_SLUG, score, cost),
}));

test("siblings are exactly the other comparable rows of the same release, highest index first", () => {
  assertProperty(fc.property(intelligenceCohortArb, ({ others, siblings, sol }) => {
    const placement = solIntelligencePlacement([...others, ...siblings, sol]);
    if (placement === undefined) throw new Error("Sol row must be comparable.");
    expect(placement.siblings).toHaveLength(siblings.length);
    expect(placement.siblings.every(record => record.release.slug === GPT_6_SOL_INTELLIGENCE_SLUG)).toBeTrue();
    expect(placement.siblings.every(record => record.id !== sol.id)).toBeTrue();
    for (let position = 1; position < placement.siblings.length; position += 1) {
      const previous = placement.siblings[position - 1];
      const current = placement.siblings[position];
      if (previous === undefined || current === undefined) throw new Error("Sibling list is short.");
      expect(previous.intelligenceIndex).toBeGreaterThanOrEqual(current.intelligenceIndex);
    }
    expect(placement.effortLadder).toHaveLength(siblings.length + 1);
  }));
});

test("the effort ladder is a cost-ordered partition whose steps sum to the top-minus-bottom gap", () => {
  assertProperty(fc.property(intelligenceCohortArb, ({ siblings, sol }) => {
    const ladder = effortLadder(sol, siblings);
    const ids = ladder.map(step => step.record.id).toSorted();
    expect(ids).toEqual([sol, ...siblings].map(record => record.id).toSorted());
    const [first] = ladder;
    expect(first?.pointsOverCheaper).toBeNull();
    expect(first?.costMultipleOverCheaper).toBeNull();
    let summed = 0;
    for (let position = 1; position < ladder.length; position += 1) {
      const step = ladder[position];
      const previous = ladder[position - 1];
      if (step === undefined || previous === undefined) throw new Error("Ladder is short.");
      expect(comparableTaskCost(step.record)).toBeGreaterThanOrEqual(comparableTaskCost(previous.record));
      expect(step.costMultipleOverCheaper).toBeCloseTo(comparableTaskCost(step.record) / comparableTaskCost(previous.record), 9);
      summed += step.pointsOverCheaper ?? Number.NaN;
    }
    const last = ladder.at(-1);
    if (first === undefined || last === undefined) throw new Error("Ladder is empty.");
    expect(summed).toBeCloseTo(last.record.intelligenceIndex - first.record.intelligenceIndex, 6);
  }));
});
