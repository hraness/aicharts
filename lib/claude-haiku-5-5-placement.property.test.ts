import { expect, test } from "bun:test";

import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import {
  ANTHROPIC_CREATOR_SLUG,
  CLAUDE_HAIKU_55_INTELLIGENCE_SLUG,
  CLAUDE_HAIKU_55_RELEASE_SLUG,
  anthropicFrontier,
  anthropicRows,
  familyRowsDominatedBy,
  frontierLevelsFor,
  haikuIntelligencePlacement,
  releaseRowsAgainst,
  siblingFamilyRows,
} from "./claude-haiku-5-5-placement";
import { anthropicRecord } from "./claude-haiku-5-5-placement.test";
import { comparableIntelligenceRecords, orderedParetoPath, paretoMembership } from "./intelligence-efficiency";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";
import { assertProperty, fc } from "./property-test";

const FAMILY_RELEASES = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"] as const;
const OUTSIDE_RELEASE = "gpt-6-luna";

const scoreArb = fc.double({ min: 0, max: 100, noNaN: true });
const costArb = fc.double({ min: 0.001, max: 50, noNaN: true });

function costParts(total: number): Parameters<typeof anthropicRecord>[2] {
  return { answer: total * 0.2, cacheRead: total * 0.4, cacheWrite: total * 0.1, nonCacheInput: total * 0.05, reasoning: total * 0.25 };
}

function haikuRow(slug: string, score: number, cost: number, effort: boolean): ArtificialAnalysisIntelligenceRecord {
  return anthropicRecord(slug, score, costParts(cost), effort ? slug : null, CLAUDE_HAIKU_55_RELEASE_SLUG, "Claude Haiku 5.5");
}

function familyRow(slug: string, score: number, cost: number, release: string): ArtificialAnalysisIntelligenceRecord {
  return anthropicRecord(slug, score, costParts(cost), slug, release);
}

function outsideRow(slug: string, score: number, cost: number | null, release: string): ArtificialAnalysisIntelligenceRecord {
  return { ...intelligenceRecord(slug, score, cost), release: { name: release, slug: release } };
}

const cohortArb = fc.record({
  closestBelowCount: fc.nat({ max: 8 }),
  family: fc.array(fc.record({ cost: costArb, index: fc.nat({ max: 99 }), release: fc.constantFrom(...FAMILY_RELEASES), score: scoreArb }), { maxLength: 10 })
    .map(items => items.map((item, position) => familyRow(`${item.release}-${item.index}-${position}`, item.score, item.cost, item.release))),
  haiku: fc.record({ cost: costArb, score: scoreArb }),
  others: fc.array(fc.record({ cost: fc.option(costArb, { nil: null }), index: fc.nat({ max: 99 }), outside: fc.boolean(), score: scoreArb }), { maxLength: 16 })
    .map(items => items.map((item, position) => outsideRow(`other-${item.index}-${position}`, item.score, item.cost, item.outside ? OUTSIDE_RELEASE : `other-${position}`))),
  siblings: fc.array(fc.record({ cost: costArb, effort: fc.boolean(), index: fc.nat({ max: 99 }), score: scoreArb }), { maxLength: 6 })
    .map(items => items.map((item, position) => haikuRow(`claude-haiku-5-5-${item.index}-${position}`, item.score, item.cost, item.effort))),
}).map(({ closestBelowCount, family, haiku, others, siblings }) => {
  const haikuMax = haikuRow(CLAUDE_HAIKU_55_INTELLIGENCE_SLUG, haiku.score, haiku.cost, true);
  return { closestBelowCount, haikuMax, records: [...others, ...family, ...siblings, haikuMax] };
});

function dominates(candidate: ArtificialAnalysisIntelligenceRecord, record: ArtificialAnalysisIntelligenceRecord): boolean {
  const candidateCost = comparableTaskCost(candidate);
  const cost = comparableTaskCost(record);
  return candidate.id !== record.id
    && candidateCost <= cost
    && candidate.intelligenceIndex >= record.intelligenceIndex
    && (candidateCost < cost || candidate.intelligenceIndex > record.intelligenceIndex);
}

test("the closest rows below are the highest-scoring other rows at or under the placed score, capped at the count", () => {
  assertProperty(fc.property(cohortArb, ({ closestBelowCount, haikuMax, records }) => {
    const placement = haikuIntelligencePlacement(records, 1, closestBelowCount);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    const expected = comparableIntelligenceRecords(records)
      .filter(row => row.id !== haikuMax.id && row.intelligenceIndex <= haikuMax.intelligenceIndex)
      .slice(0, closestBelowCount);
    expect(placement.closestBelow.map(entry => entry.record.id)).toEqual(expected.map(row => row.id));
    for (const entry of placement.closestBelow) {
      expect(entry.gapPoints).toBeGreaterThanOrEqual(0);
      expect(entry.costMultiple).toBeGreaterThan(0);
      expect(entry.costMultiple).toBeCloseTo(comparableTaskCost(entry.record) / comparableTaskCost(haikuMax), 10);
    }
  }));
});

test("the cheaper count is the number of comparable rows strictly cheaper than the placed row", () => {
  assertProperty(fc.property(cohortArb, ({ haikuMax, records }) => {
    const placement = haikuIntelligencePlacement(records);
    if (placement === undefined) throw new Error("expected a placement");
    const cost = comparableTaskCost(haikuMax);
    const comparable = comparableIntelligenceRecords(records);
    expect(placement.cheaperCount).toBe(comparable.filter(row => comparableTaskCost(row) < cost).length);
    expect(placement.cheaperCount).toBeLessThan(comparable.length);
  }));
});

test("frontier levels are exactly the release’s frontier vertices with their frontier neighbors, highest score first", () => {
  assertProperty(fc.property(cohortArb, ({ records }) => {
    const comparable = comparableIntelligenceRecords(records);
    const membership = paretoMembership(comparable, "costUsdPerTask");
    const fromTop = orderedParetoPath(comparable, "costUsdPerTask").map(point => point.record);
    fromTop.reverse();
    const levels = frontierLevelsFor(comparable, CLAUDE_HAIKU_55_RELEASE_SLUG);
    const expectedIds = fromTop.filter(row => row.release.slug === CLAUDE_HAIKU_55_RELEASE_SLUG).map(row => row.id);
    expect(levels.map(level => level.record.id)).toEqual(expectedIds);
    for (const level of levels) {
      expect(membership.has(level.record.id)).toBeTrue();
      const position = fromTop.findIndex(row => row.id === level.record.id);
      expect(level.above?.id).toBe(fromTop[position - 1]?.id);
      expect(level.below?.id).toBe(fromTop[position + 1]?.id);
      if (level.above !== undefined) expect(level.above.intelligenceIndex).toBeGreaterThanOrEqual(level.record.intelligenceIndex);
      if (level.below !== undefined) expect(level.below.intelligenceIndex).toBeLessThanOrEqual(level.record.intelligenceIndex);
    }
    const placement = haikuIntelligencePlacement(records);
    expect(placement?.frontierLevels.map(level => level.record.id)).toEqual(expectedIds);
  }));
});

test("Anthropic rows are every comparable Anthropic row, and the family frontier is their Pareto path from the top", () => {
  assertProperty(fc.property(cohortArb, ({ records }) => {
    const family = anthropicRows(records);
    const comparable = comparableIntelligenceRecords(records);
    expect(family.map(row => row.id).toSorted()).toEqual(
      comparable.filter(row => row.creator.slug === ANTHROPIC_CREATOR_SLUG).map(row => row.id).toSorted(),
    );
    for (let position = 1; position < family.length; position += 1) {
      const previous = family[position - 1];
      const current = family[position];
      if (previous === undefined || current === undefined) continue;
      expect(previous.intelligenceIndex).toBeGreaterThanOrEqual(current.intelligenceIndex);
    }
    const frontier = anthropicFrontier(records);
    const membership = paretoMembership(family, "costUsdPerTask");
    expect(new Set(frontier.map(row => row.id))).toEqual(new Set(membership));
    for (let position = 1; position < frontier.length; position += 1) {
      const above = frontier[position - 1];
      const vertex = frontier[position];
      if (above === undefined || vertex === undefined) continue;
      expect(above.intelligenceIndex).toBeGreaterThanOrEqual(vertex.intelligenceIndex);
      expect(comparableTaskCost(above)).toBeGreaterThanOrEqual(comparableTaskCost(vertex));
    }
  }));
});

test("sibling family rows exclude the reference’s release, measure against it, and flag family-frontier membership", () => {
  assertProperty(fc.property(cohortArb, ({ haikuMax, records }) => {
    const rows = siblingFamilyRows(records, haikuMax);
    const family = anthropicRows(records);
    const membership = paretoMembership(family, "costUsdPerTask");
    const expected = family.filter(row => row.release.slug === "claude-sonnet-5-5" || row.release.slug === "claude-opus-5-5");
    expect(rows.map(row => row.record.id)).toEqual(expected.map(row => row.id));
    for (const row of rows) {
      expect(row.record.release.slug).not.toBe(CLAUDE_HAIKU_55_RELEASE_SLUG);
      expect(row.onFamilyFrontier).toBe(membership.has(row.record.id));
      expect(row.gapPoints).toBeCloseTo(row.record.intelligenceIndex - haikuMax.intelligenceIndex, 10);
      expect(row.costMultiple).toBeCloseTo(comparableTaskCost(row.record) / comparableTaskCost(haikuMax), 10);
    }
    expect(siblingFamilyRows(records, haikuMax, [CLAUDE_HAIKU_55_RELEASE_SLUG])).toEqual([]);
  }));
});

test("dominated family rows are exactly the other Anthropic rows some Haiku row beats, with the highest-scoring dominator", () => {
  assertProperty(fc.property(cohortArb, ({ records }) => {
    const family = anthropicRows(records);
    const haiku = family.filter(row => row.release.slug === CLAUDE_HAIKU_55_RELEASE_SLUG);
    const dominated = familyRowsDominatedBy(records, CLAUDE_HAIKU_55_RELEASE_SLUG);
    const expected = family.filter(row => row.release.slug !== CLAUDE_HAIKU_55_RELEASE_SLUG && haiku.some(candidate => dominates(candidate, row)));
    expect(dominated.map(entry => entry.record.id)).toEqual(expected.map(row => row.id));
    for (const entry of dominated) {
      expect(dominates(entry.dominator, entry.record)).toBeTrue();
      expect(entry.dominator.release.slug).toBe(CLAUDE_HAIKU_55_RELEASE_SLUG);
      expect(entry.pointsBelowDominator).toBeGreaterThanOrEqual(0);
      expect(entry.costMultipleOfDominator).toBeGreaterThanOrEqual(1);
      for (const candidate of haiku.filter(row => dominates(row, entry.record))) {
        expect(candidate.intelligenceIndex).toBeLessThanOrEqual(entry.dominator.intelligenceIndex);
      }
    }
  }));
});

test("release rows against a reference are every comparable row of that release, highest index first, with signed gaps", () => {
  assertProperty(fc.property(cohortArb, ({ haikuMax, records }) => {
    const rows = releaseRowsAgainst(records, OUTSIDE_RELEASE, haikuMax);
    const expected = comparableIntelligenceRecords(records).filter(row => row.release.slug === OUTSIDE_RELEASE);
    expect(rows.map(row => row.record.id).toSorted()).toEqual(expected.map(row => row.id).toSorted());
    for (let position = 1; position < rows.length; position += 1) {
      const previous = rows[position - 1];
      const current = rows[position];
      if (previous === undefined || current === undefined) continue;
      expect(previous.record.intelligenceIndex).toBeGreaterThanOrEqual(current.record.intelligenceIndex);
    }
    for (const row of rows) {
      expect(row.gapPoints).toBeCloseTo(row.record.intelligenceIndex - haikuMax.intelligenceIndex, 10);
      expect(row.costMultiple).toBeGreaterThan(0);
    }
  }));
});
