import { expect, test } from "bun:test";

import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import {
  CLAUDE_OPUS_55_INTELLIGENCE_SLUG,
  CLAUDE_OPUS_55_RELEASE_SLUG,
  inputCostShare,
  opusIntelligencePlacement,
  reasoningShare,
  topFrontierRun,
} from "./claude-opus-5-5-placement";
import { costedRecord } from "./claude-opus-5-5-placement.test";
import { comparableIntelligenceRecords, orderedParetoPath, paretoMembership } from "./intelligence-efficiency";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";
import { assertProperty, fc } from "./property-test";

const scoreArb = fc.double({ min: 0, max: 100, noNaN: true });
const costArb = fc.double({ min: 0.001, max: 50, noNaN: true });
const partArb = fc.double({ min: 0, max: 10, noNaN: true });
const tokenArb = fc.double({ min: 0, max: 200_000, noNaN: true });

const partsArb = fc.record({
  answer: partArb,
  cacheRead: partArb,
  cacheWrite: partArb,
  nonCacheInput: fc.double({ min: 0.001, max: 10, noNaN: true }),
  reasoning: partArb,
});
const tokensArb = fc.record({ answer: fc.double({ min: 1, max: 200_000, noNaN: true }), reasoning: tokenArb });

type CostParts = Parameters<typeof costedRecord>[2];
type OutputTokens = Parameters<typeof costedRecord>[3];

function opusRow(slug: string, score: number, parts: CostParts, tokens: OutputTokens, effort: boolean): ArtificialAnalysisIntelligenceRecord {
  return costedRecord(slug, score, parts, tokens, effort ? slug : null);
}

const cohortArb = fc.record({
  closestBelowCount: fc.nat({ max: 8 }),
  others: fc.array(fc.record({ cost: costArb, index: fc.nat({ max: 99 }), score: scoreArb }), { maxLength: 24 })
    .map(items => items.map((item, position) => intelligenceRecord(`other-${item.index}-${position}`, item.score, item.cost))),
  parts: partsArb,
  score: scoreArb,
  siblings: fc.array(fc.record({ effort: fc.boolean(), index: fc.nat({ max: 99 }), parts: partsArb, score: scoreArb, tokens: tokensArb }), { maxLength: 6 })
    .map(items => items.map((item, position) => opusRow(`claude-opus-5-5-${item.index}-${position}`, item.score, item.parts, item.tokens, item.effort))),
  tokens: tokensArb,
}).map(({ closestBelowCount, others, parts, score, siblings, tokens }) => ({
  closestBelowCount,
  opus: opusRow(CLAUDE_OPUS_55_INTELLIGENCE_SLUG, score, parts, tokens, true),
  others,
  siblings,
}));

test("the closest rows below are the highest-scoring other rows at or under the placed score, capped at the count", () => {
  assertProperty(fc.property(cohortArb, ({ closestBelowCount, opus, others, siblings }) => {
    const records = [...others, ...siblings, opus];
    const placement = opusIntelligencePlacement(records, 1, closestBelowCount);
    if (placement === undefined) throw new Error("Opus row must be comparable.");
    const cohort = comparableIntelligenceRecords(records);
    const expected = cohort
      .filter(candidate => candidate.id !== opus.id && candidate.intelligenceIndex <= opus.intelligenceIndex)
      .slice(0, closestBelowCount);
    expect(placement.closestBelow.map(entry => entry.record.id)).toEqual(expected.map(record => record.id));
    for (const entry of placement.closestBelow) {
      expect(entry.gapPoints).toBeCloseTo(opus.intelligenceIndex - entry.record.intelligenceIndex, 9);
      expect(entry.gapPoints).toBeGreaterThanOrEqual(0);
      expect(entry.costMultiple).toBeGreaterThan(0);
    }
    for (let position = 1; position < placement.closestBelow.length; position += 1) {
      const previous = placement.closestBelow[position - 1];
      const current = placement.closestBelow[position];
      if (previous === undefined || current === undefined) throw new Error("Closest list is short.");
      expect(previous.record.intelligenceIndex).toBeGreaterThanOrEqual(current.record.intelligenceIndex);
    }
  }));
});

test("the frontier run is the longest same-release prefix of the frontier walked from the top", () => {
  assertProperty(fc.property(cohortArb, ({ opus, others, siblings }) => {
    const records = [...others, ...siblings, opus];
    const cohort = comparableIntelligenceRecords(records);
    const { firstOtherFrontier, frontierRun } = topFrontierRun(cohort, CLAUDE_OPUS_55_RELEASE_SLUG);
    const membership = paretoMembership(cohort, "costUsdPerTask");
    const fromTop = orderedParetoPath(cohort, "costUsdPerTask").map(point => point.record).toReversed();
    expect(frontierRun.every(record => membership.has(record.id))).toBeTrue();
    expect(frontierRun.every(record => record.release.slug === CLAUDE_OPUS_55_RELEASE_SLUG)).toBeTrue();
    expect(frontierRun.map(record => record.id)).toEqual(fromTop.slice(0, frontierRun.length).map(record => record.id));
    const next = fromTop[frontierRun.length];
    if (next === undefined) {
      expect(firstOtherFrontier).toBeUndefined();
    } else {
      expect(firstOtherFrontier?.id).toBe(next.id);
      expect(next.release.slug).not.toBe(CLAUDE_OPUS_55_RELEASE_SLUG);
    }
    // The run is non-empty exactly when the top vertex belongs to the release.
    expect(frontierRun.length > 0).toBe(fromTop[0]?.release.slug === CLAUDE_OPUS_55_RELEASE_SLUG);
    for (let position = 1; position < frontierRun.length; position += 1) {
      const previous = frontierRun[position - 1];
      const current = frontierRun[position];
      if (previous === undefined || current === undefined) throw new Error("Run is short.");
      expect(previous.intelligenceIndex).toBeGreaterThan(current.intelligenceIndex);
    }
  }));
});

test("shares stay inside the unit interval and agree with the row’s own components", () => {
  assertProperty(fc.property(cohortArb, ({ opus, siblings }) => {
    for (const record of [opus, ...siblings]) {
      const reasoning = reasoningShare(record);
      const input = inputCostShare(record);
      expect(reasoning).toBeGreaterThanOrEqual(0);
      expect(reasoning).toBeLessThanOrEqual(1);
      expect(input).toBeGreaterThanOrEqual(0);
      expect(input).toBeLessThanOrEqual(1);
      expect(reasoning).toBeCloseTo(record.outputTokensPerTask.reasoning / record.outputTokensPerTask.total, 9);
      const cost = record.costUsdPerTask;
      if (cost === null) throw new Error("Opus rows carry a cost.");
      expect(input).toBeCloseTo(cost.input / cost.total, 9);
    }
  }));
});
