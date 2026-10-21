import { expect, test } from "bun:test";

import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import { taskCostBreakdown } from "./claude-opus-5-5-placement";
import { comparableIntelligenceRecords, orderedParetoPath, paretoMembership } from "./intelligence-efficiency";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";
import {
  COST_COMPONENTS,
  COST_SIDES,
  META_CREATOR_SLUG,
  MUSE_WONDER_INTELLIGENCE_SLUG,
  MUSE_WONDER_RELEASE_SLUG,
  closestRowsBelow,
  costPartRank,
  costPartValue,
  costSideRows,
  creatorFrontier,
  creatorRows,
  creatorRowsAgainst,
  museWonderIntelligencePlacement,
  sameRoundedScoreRows,
  vendorComparisonRows,
} from "./muse-wonder-placement";
import { creatorRecord } from "./muse-wonder-placement.test";
import { assertProperty, fc } from "./property-test";

const CREATORS = [META_CREATOR_SLUG, "anthropic", "openai"] as const;
const RELEASES = ["muse-spark-1-3", "muse-glimmer", "claude-opus-5-5", "gpt-6-astra", "gpt-6-1-sol"] as const;
const EFFORTS = ["low", "high", "max", null] as const;

const scoreArb = fc.double({ min: 0, max: 100, noNaN: true });
const costArb = fc.double({ min: 0.001, max: 50, noNaN: true });
const shareArb = fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 5, maxLength: 5 });

type CostParts = Parameters<typeof creatorRecord>[2];

function partsFrom(total: number, weights: readonly number[]): CostParts {
  const sum = weights.reduce((left, right) => left + right, 0);
  const share = (position: number): number => (sum === 0 ? total / 5 : total * ((weights[position] ?? 0) / sum));
  return { answer: share(0), cacheRead: share(1), cacheWrite: share(2), nonCacheInput: share(3), reasoning: share(4) };
}

const rowArb = fc.record({
  cost: costArb,
  creator: fc.constantFrom(...CREATORS),
  effort: fc.constantFrom(...EFFORTS),
  release: fc.constantFrom(...RELEASES),
  score: scoreArb,
  weights: shareArb,
});

const cohortArb = fc.record({
  closestBelowCount: fc.nat({ max: 8 }),
  costless: fc.array(scoreArb, { maxLength: 3 }),
  rows: fc.array(rowArb, { maxLength: 16 }),
  wonder: fc.record({ cost: costArb, score: scoreArb, weights: shareArb }),
}).map(({ closestBelowCount, costless, rows, wonder }) => {
  const wonderRow = creatorRecord(MUSE_WONDER_INTELLIGENCE_SLUG, wonder.score, partsFrom(wonder.cost, wonder.weights), "max", META_CREATOR_SLUG, MUSE_WONDER_RELEASE_SLUG, "Muse Wonder");
  const others = rows.map((row, position) => creatorRecord(`${row.release}-${position}`, row.score, partsFrom(row.cost, row.weights), row.effort, row.creator, row.release));
  const uncosted = costless.map((score, position) => intelligenceRecord(`costless-${position}`, score, null));
  return { closestBelowCount, records: [...uncosted, ...others, wonderRow], wonderRow };
});

test("the closest rows below are the highest-scoring other rows at or under the placed score, capped at the count", () => {
  assertProperty(fc.property(cohortArb, ({ closestBelowCount, records, wonderRow }) => {
    const placement = museWonderIntelligencePlacement(records, 1, closestBelowCount);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    const expected = comparableIntelligenceRecords(records)
      .filter(row => row.id !== wonderRow.id && row.intelligenceIndex <= wonderRow.intelligenceIndex)
      .slice(0, closestBelowCount);
    expect(placement.closestBelow.map(entry => entry.record.id)).toEqual(expected.map(row => row.id));
    for (const entry of placement.closestBelow) {
      expect(entry.gapPoints).toBeGreaterThanOrEqual(0);
      expect(entry.costMultiple).toBeCloseTo(comparableTaskCost(entry.record) / comparableTaskCost(wonderRow), 10);
    }
    expect(closestRowsBelow(comparableIntelligenceRecords(records), wonderRow, closestBelowCount)).toEqual(placement.closestBelow);
  }));
});

test("cheaper, costlier, and equal-cost rows partition the rest of the cohort", () => {
  assertProperty(fc.property(cohortArb, ({ records, wonderRow }) => {
    const placement = museWonderIntelligencePlacement(records);
    if (placement === undefined) throw new Error("A costed Muse Wonder row must place.");
    const cohort = comparableIntelligenceRecords(records);
    const cost = comparableTaskCost(wonderRow);
    const equal = cohort.filter(row => row.id !== wonderRow.id && comparableTaskCost(row) === cost).length;
    expect(placement.cheaperCount + placement.costlierCount + equal).toBe(cohort.length - 1);
    expect(placement.cohortSize).toBe(cohort.length);
  }));
});

test("each cost part rank counts the rows with a strictly larger bill and lists every row at least as large", () => {
  assertProperty(fc.property(cohortArb, fc.constantFrom(...COST_COMPONENTS, ...COST_SIDES), ({ records, wonderRow }, part) => {
    const cohort = comparableIntelligenceRecords(records);
    const rank = costPartRank(cohort, wonderRow, part);
    const value = costPartValue(wonderRow, part);
    expect(value).toBe(taskCostBreakdown(wonderRow)[part]);
    expect(rank.rank).toBe(cohort.filter(row => costPartValue(row, part) > value).length + 1);
    expect(rank.atLeastAsLarge.map(row => row.id)).toContain(wonderRow.id);
    expect(rank.atLeastAsLarge.every(row => costPartValue(row, part) >= value)).toBeTrue();
    expect(rank.atLeastAsLarge.length).toBe(cohort.filter(row => costPartValue(row, part) >= value).length);
    for (let position = 1; position < rank.atLeastAsLarge.length; position += 1) {
      const previous = rank.atLeastAsLarge[position - 1];
      const current = rank.atLeastAsLarge[position];
      if (previous === undefined || current === undefined) continue;
      expect(costPartValue(previous, part)).toBeGreaterThanOrEqual(costPartValue(current, part));
    }
    expect(rank.rank === 1).toBe(rank.atLeastAsLarge.every(row => costPartValue(row, part) <= value));
    const placement = museWonderIntelligencePlacement(records);
    expect(placement?.partRanks[part]).toEqual(rank);
  }));
});

test("same-rounded-score rows print the placed score, differ at stored precision, and sort cheapest first", () => {
  assertProperty(fc.property(cohortArb, fc.nat({ max: 3 }), ({ records, wonderRow }, decimals) => {
    const cohort = comparableIntelligenceRecords(records);
    const rows = sameRoundedScoreRows(cohort, wonderRow, decimals);
    const printed = wonderRow.intelligenceIndex.toFixed(decimals);
    for (const row of rows) {
      expect(row.record.id).not.toBe(wonderRow.id);
      expect(row.record.intelligenceIndex.toFixed(decimals)).toBe(printed);
      expect(row.record.intelligenceIndex).not.toBe(wonderRow.intelligenceIndex);
      expect(row.costMultiple).toBeCloseTo(comparableTaskCost(row.record) / comparableTaskCost(wonderRow), 10);
    }
    const expectedCount = cohort.filter(row => (
      row.id !== wonderRow.id
      && row.intelligenceIndex !== wonderRow.intelligenceIndex
      && row.intelligenceIndex.toFixed(decimals) === printed
    )).length;
    expect(rows).toHaveLength(expectedCount);
    for (let position = 1; position < rows.length; position += 1) {
      const previous = rows[position - 1];
      const current = rows[position];
      if (previous === undefined || current === undefined) continue;
      expect(comparableTaskCost(previous.record)).toBeLessThanOrEqual(comparableTaskCost(current.record));
    }
  }));
});

test("cost sides sum to the task cost and sort cheapest first", () => {
  assertProperty(fc.property(cohortArb, ({ records, wonderRow }) => {
    const cohort = comparableIntelligenceRecords(records);
    const rows = costSideRows(wonderRow, cohort);
    expect(rows).toHaveLength(cohort.length);
    for (const row of rows) {
      expect(row.inputCost + row.outputCost).toBeCloseTo(comparableTaskCost(row.record), 8);
      expect(row.inputShare).toBeGreaterThanOrEqual(0);
      expect(row.inputShare).toBeLessThanOrEqual(1);
      expect(row.cacheWriteCost).toBeLessThanOrEqual(row.inputCost + 1e-9);
    }
    for (let position = 1; position < rows.length; position += 1) {
      const previous = rows[position - 1];
      const current = rows[position];
      if (previous === undefined || current === undefined) continue;
      expect(comparableTaskCost(previous.record)).toBeLessThanOrEqual(comparableTaskCost(current.record));
    }
  }));
});

test("the creator-only frontier is the Pareto path over the creator's rows and family rows carry membership", () => {
  assertProperty(fc.property(cohortArb, fc.constantFrom(...CREATORS), ({ records, wonderRow }, creator) => {
    const family = creatorRows(records, creator);
    expect(family.every(row => row.creator.slug === creator)).toBeTrue();
    expect(family.length).toBe(comparableIntelligenceRecords(records).filter(row => row.creator.slug === creator).length);
    const frontier = creatorFrontier(records, creator);
    expect(frontier.map(row => row.id)).toEqual(
      orderedParetoPath(family, "costUsdPerTask").map(point => point.record.id).toReversed(),
    );
    const membership = paretoMembership(family, "costUsdPerTask");
    const rows = creatorRowsAgainst(records, wonderRow, creator);
    expect(rows.map(row => row.record.id)).toEqual(family.filter(row => row.id !== wonderRow.id).map(row => row.id));
    for (const row of rows) {
      expect(row.onFamilyFrontier).toBe(membership.has(row.record.id));
      expect(row.gapPoints).toBeCloseTo(row.record.intelligenceIndex - wonderRow.intelligenceIndex, 10);
    }
    if (creator === META_CREATOR_SLUG && family.every(row => row.id === wonderRow.id || row.intelligenceIndex < wonderRow.intelligenceIndex)) {
      expect(frontier[0]?.id).toBe(wonderRow.id);
    }
  }));
});

test("vendor comparison rows take the highest-scoring row of each release at the named effort", () => {
  assertProperty(fc.property(cohortArb, fc.constantFrom(...EFFORTS.filter((effort): effort is Exclude<typeof effort, null> => effort !== null)), ({ records }, effort) => {
    const cohort = comparableIntelligenceRecords(records);
    const rows = vendorComparisonRows(records, RELEASES, effort);
    expect(rows.map(row => row.releaseSlug)).toEqual([...RELEASES]);
    for (const row of rows) {
      const candidates = cohort.filter(candidate => candidate.release.slug === row.releaseSlug && candidate.effort?.slug === effort);
      if (candidates.length === 0) {
        expect(row.record).toBeUndefined();
        continue;
      }
      expect(row.record).toBeDefined();
      const best = Math.max(...candidates.map(candidate => candidate.intelligenceIndex));
      expect(row.record?.intelligenceIndex).toBe(best);
    }
  }));
});

test("a fixture without a costed Muse Wonder row never places", () => {
  assertProperty(fc.property(cohortArb, ({ records, wonderRow }) => {
    const without: ArtificialAnalysisIntelligenceRecord[] = records.filter(row => row.id !== wonderRow.id);
    expect(museWonderIntelligencePlacement(without)).toBeUndefined();
    expect(museWonderIntelligencePlacement([...without, { ...wonderRow, costUsdPerTask: null }])).toBeUndefined();
  }));
});
