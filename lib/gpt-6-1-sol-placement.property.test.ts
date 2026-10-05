import { expect, test } from "bun:test";

import {
  GPT_6_1_SOL_CODING_CONFIGURATION,
  GPT_6_1_SOL_INTELLIGENCE_SLUG,
  gpt61SolCodingAgentPlacement,
  gpt61SolIntelligencePlacement,
} from "./gpt-6-1-sol-placement";
import { GPT_6_SOL_CODING_CONFIGURATION } from "./gpt-6-sol-placement";
import { codingAgentRecord } from "./grok-4-7-placement.test";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";
import { assertProperty, fc } from "./property-test";

const scoreArb = fc.double({ min: 0, max: 100, noNaN: true });
const costArb = fc.double({ min: 0.001, max: 50, noNaN: true });
const settings = ["low", "medium", "high", "xhigh", "max"] as const;

const otherCodingRecordsArb = fc.array(
  fc.record({
    aaIndex: fc.option(scoreArb, { nil: null }),
    costUsd: fc.option(costArb, { nil: null }),
    index: fc.nat({ max: 99 }),
    previousGeneration: fc.boolean(),
    setting: fc.constantFrom(...settings),
  }),
  { maxLength: 24 },
).map(items => items.map((item, position) => codingAgentRecord({
  ...(item.previousGeneration ? GPT_6_SOL_CODING_CONFIGURATION : {}),
  aaIndex: item.aaIndex,
  costUsd: item.costUsd,
  id: `other-${item.index}-${position}`,
  setting: item.setting,
})));

const ownSettingsArb = fc.array(
  fc.record({
    cost: costArb,
    index: fc.nat({ max: 4 }),
    score: scoreArb,
  }),
  { minLength: 1, maxLength: 5 },
).map(items => items.map((item, position) => ({
  ...codingAgentRecord({
    ...GPT_6_1_SOL_CODING_CONFIGURATION,
    aaIndex: item.score,
    costUsd: item.cost,
    id: `gpt-6-1-sol-${settings[item.index]}-${position}`,
    setting: settings[item.index],
  }),
  settingRank: item.index + 2,
})));

const codingCohortArb = fc.record({
  others: otherCodingRecordsArb,
  own: ownSettingsArb,
});

test("the placed row is the highest-index costed Codex · GPT-6.1 Sol setting", () => {
  assertProperty(fc.property(codingCohortArb, ({ others, own }) => {
    const placement = gpt61SolCodingAgentPlacement([...others, ...own]);
    if (placement === undefined) throw new Error("At least one own row is indexed and costed.");
    const best = own.reduce((leader, row) => {
      const score = row.benchmarks.aaIndex;
      const leaderScore = leader.benchmarks.aaIndex;
      if (score === null || leaderScore === null) {
        throw new Error("Own rows carry an AA Index.");
      }
      return score > leaderScore || (score === leaderScore && row.id < leader.id) ? row : leader;
    });
    expect(placement.record.id).toBe(best.id);
    expect(placement.rank).toBe(placement.higher.length + 1);
    expect(placement.settings).toHaveLength(own.length);
    for (let position = 1; position < placement.settings.length; position += 1) {
      const previous = placement.settings[position - 1];
      const current = placement.settings[position];
      if (previous === undefined || current === undefined) throw new Error("Settings list is short.");
      expect(previous.settingRank).toBeLessThanOrEqual(current.settingRank);
    }
  }));
});

test("neighbors are exactly the other costed rows inside the window, cheapest first", () => {
  assertProperty(fc.property(codingCohortArb, ({ others, own }) => {
    const placement = gpt61SolCodingAgentPlacement([...others, ...own]);
    if (placement === undefined) throw new Error("At least one own row is indexed and costed.");
    const index = placement.record.benchmarks.aaIndex;
    const costed = [...others, ...own].filter(other => (
      other.id !== placement.record.id
      && other.benchmarks.aaIndex !== null
      && other.economics.costUsd !== null
      && other.economics.costUsd > 0
    ));
    const withinDefault = costed.filter(other => Math.abs((other.benchmarks.aaIndex ?? Number.NaN) - index) <= 1);
    expect(placement.neighbors).toHaveLength(withinDefault.length);
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
      expect(placement.cheapestHigher.multiple)
        .toBeCloseTo(cheapest / placement.record.economics.costUsd, 9);
    }
  }));
});

test("previousGeneration is the highest-index GPT-6 Sol row, while predecessor stays same-setting", () => {
  assertProperty(fc.property(codingCohortArb, ({ others, own }) => {
    const placement = gpt61SolCodingAgentPlacement([...others, ...own]);
    if (placement === undefined) throw new Error("At least one own row is indexed and costed.");
    const previous = others.filter(other => (
      other.agent === GPT_6_SOL_CODING_CONFIGURATION.agent
      && other.model === GPT_6_SOL_CODING_CONFIGURATION.model
      && other.providerId === GPT_6_SOL_CODING_CONFIGURATION.providerId
      && other.benchmarks.aaIndex !== null
      && other.economics.costUsd !== null
      && other.economics.costUsd > 0
    ));
    if (previous.length === 0) {
      expect(placement.previousGeneration).toBeUndefined();
    } else {
      const best = previous.reduce((leader, row) => (
        (row.benchmarks.aaIndex ?? Number.NaN) > (leader.benchmarks.aaIndex ?? Number.NaN) ? row : leader
      ));
      expect(placement.previousGeneration?.id).toBe(best.id);
    }
    if (placement.predecessor !== undefined) {
      expect(placement.predecessor.model).toBe(GPT_6_SOL_CODING_CONFIGURATION.model);
      expect(placement.predecessor.setting).toBe(placement.record.setting);
    }
  }));
});

const intelligenceCohortArb = fc.record({
  cost: costArb,
  others: fc.array(
    fc.record({ cost: costArb, index: fc.nat({ max: 99 }), score: scoreArb }),
    { maxLength: 24 },
  ).map(items => items.map((item, position) => (
    intelligenceRecord(`other-${item.index}-${position}`, item.score, item.cost)
  ))),
  score: scoreArb,
}).map(({ cost, others, score }) => ({
  others,
  sol: {
    ...intelligenceRecord(GPT_6_1_SOL_INTELLIGENCE_SLUG, score, cost),
    effort: { label: "max", level: 10, slug: "max" },
    release: { name: "GPT-6.1 Sol", slug: GPT_6_1_SOL_INTELLIGENCE_SLUG },
  },
}));

test("the Intelligence Index helper ranks the max slug and never invents an effort ladder", () => {
  assertProperty(fc.property(intelligenceCohortArb, ({ others, sol }) => {
    const placement = gpt61SolIntelligencePlacement([...others, sol]);
    if (placement === undefined) throw new Error("Max row must be comparable.");
    expect(placement.record.slug).toBe(GPT_6_1_SOL_INTELLIGENCE_SLUG);
    expect(placement.rank).toBe(
      others.filter(other => other.intelligenceIndex > sol.intelligenceIndex).length + 1,
    );
    expect("effortLadder" in placement).toBeFalse();
  }));
});
