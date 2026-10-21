import { describe, expect, test } from "bun:test";

import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";

import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import { parseArtificialAnalysisIntelligenceV43Snapshot } from "./artificial-analysis-intelligence-v4-3-data";
import { costedRecord } from "./claude-opus-5-5-placement.test";
import { comparableIntelligenceRecords, orderedParetoPath, paretoMembership } from "./intelligence-efficiency";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";
import {
  COST_COMPONENTS,
  COST_SIDES,
  META_CREATOR_SLUG,
  MUSE_WONDER_INTELLIGENCE_SLUG,
  MUSE_WONDER_RELEASE_SLUG,
  MUSE_WONDER_VENDOR_COMPARISON_RELEASE_SLUGS,
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

type CostParts = Parameters<typeof costedRecord>[2];

/** A costed row stamped with a creator and release, named after its slug. */
export function creatorRecord(
  slug: string,
  index: number,
  parts: CostParts,
  effort: string | null,
  creatorSlug: string,
  releaseSlug: string,
  releaseName = releaseSlug,
): ArtificialAnalysisIntelligenceRecord {
  return {
    ...costedRecord(slug, index, parts, { answer: 25_000, reasoning: 29_000 }, effort, undefined, "2026-10-12"),
    creator: { id: creatorSlug, name: creatorSlug, slug: creatorSlug },
    name: slug,
    release: { name: releaseName, slug: releaseSlug },
  };
}

function inputHeavy(total: number): CostParts {
  return { answer: total * 0.11, cacheRead: total * 0.32, cacheWrite: total * 0.43, nonCacheInput: total * 0.01, reasoning: total * 0.13 };
}

function outputHeavy(total: number): CostParts {
  return { answer: total * 0.3, cacheRead: total * 0.2, cacheWrite: total * 0.1, nonCacheInput: total * 0.1, reasoning: total * 0.3 };
}

const wonder = creatorRecord(MUSE_WONDER_INTELLIGENCE_SLUG, 52.39, inputHeavy(4.52), "max", META_CREATOR_SLUG, MUSE_WONDER_RELEASE_SLUG, "Muse Wonder");
const spark = creatorRecord("muse-spark-1-3", 48.09, outputHeavy(1.6), "max", META_CREATOR_SLUG, "muse-spark-1-3", "Muse Spark 1.3");
const sparkXhigh = creatorRecord("muse-spark-1-3-xhigh", 45.07, outputHeavy(1.37), "xhigh", META_CREATOR_SLUG, "muse-spark-1-3", "Muse Spark 1.3");
const glimmer = creatorRecord("muse-glimmer", 17.48, outputHeavy(0.058), "high", META_CREATOR_SLUG, "muse-glimmer", "Muse Glimmer");
const opusHigh = creatorRecord("claude-opus-5-5-high", 53.58, outputHeavy(1.82), "high", "anthropic", "claude-opus-5-5", "Claude Opus 5.5");
const opusMax = creatorRecord("claude-opus-5-5", 57.62, outputHeavy(5.98), "max", "anthropic", "claude-opus-5-5", "Claude Opus 5.5");
const astraMax = creatorRecord("gpt-6-astra", 52.67, outputHeavy(3.26), "max", "openai", "gpt-6-astra", "GPT-6 Astra");
const astraXhigh = creatorRecord("gpt-6-astra-xhigh", 52.3863, outputHeavy(2.31), "xhigh", "openai", "gpt-6-astra", "GPT-6 Astra");
const sol = creatorRecord("gpt-6-1-sol", 51.83, outputHeavy(0.72), "max", "openai", "gpt-6-1-sol", "GPT-6.1 Sol");
const costless = intelligenceRecord("no-cost", 60, null);
const fixture = [costless, sol, astraXhigh, astraMax, opusMax, opusHigh, glimmer, sparkXhigh, spark, wonder];

describe("muse-wonder-placement", () => {
  test("places the row against the cohort the chart plots", () => {
    const placement = museWonderIntelligencePlacement(fixture);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.id).toBe(wonder.id);
    expect(placement.cohortSize).toBe(9);
    expect(placement.rank).toBe(4);
    expect(placement.onCostFrontier).toBeFalse();
    expect(placement.dominators.map(row => row.slug)).toEqual(["claude-opus-5-5-high", "gpt-6-astra"]);
    expect(placement.cheapestHigher?.record.slug).toBe("claude-opus-5-5-high");
    expect(placement.cheaperCount).toBe(7);
    expect(placement.costlierCount).toBe(1);
    expect(placement.effortLadder).toHaveLength(1);
    expect(placement.otherModes).toEqual([]);
    expect(placement.sameRoundedScore.map(row => row.record.slug)).toEqual(["gpt-6-astra-xhigh"]);
    expect(placement.sameRoundedScore[0]?.gapPoints).toBeLessThan(0);
    expect(placement.closestBelow.map(entry => entry.record.slug))
      .toEqual(["gpt-6-astra-xhigh", "gpt-6-1-sol", "muse-spark-1-3", "muse-spark-1-3-xhigh", "muse-glimmer"]);
    expect(placement.partRanks.cacheWrite.rank).toBe(1);
    expect(placement.partRanks.cacheWrite.atLeastAsLarge.map(row => row.slug)).toEqual([wonder.slug]);
    expect(placement.partRanks.input.rank).toBe(1);
    expect(placement.partRanks.output.rank).toBe(5);
    expect(placement.partRanks.output.atLeastAsLarge.map(row => row.slug))
      .toEqual(["claude-opus-5-5", "gpt-6-astra", "gpt-6-astra-xhigh", "claude-opus-5-5-high", wonder.slug]);
  });

  test("returns undefined without a costed Muse Wonder row", () => {
    expect(museWonderIntelligencePlacement(fixture.filter(record => record.slug !== MUSE_WONDER_INTELLIGENCE_SLUG))).toBeUndefined();
    expect(museWonderIntelligencePlacement([])).toBeUndefined();
  });

  test("rejects invalid counts and decimals", () => {
    const cohort = comparableIntelligenceRecords(fixture);
    expect(() => closestRowsBelow(cohort, wonder, -1)).toThrow(RangeError);
    expect(() => closestRowsBelow(cohort, wonder, 1.5)).toThrow(RangeError);
    expect(() => sameRoundedScoreRows(cohort, wonder, -1)).toThrow(RangeError);
    expect(closestRowsBelow(cohort, wonder, 0)).toEqual([]);
  });

  test("ranks each cost part largest bill first with ties sharing the higher rank", () => {
    const cohort = comparableIntelligenceRecords(fixture);
    for (const part of [...COST_COMPONENTS, ...COST_SIDES]) {
      const rank = costPartRank(cohort, wonder, part);
      expect(rank.cohortSize).toBe(cohort.length);
      expect(rank.value).toBe(costPartValue(wonder, part));
      expect(rank.rank).toBe(cohort.filter(row => costPartValue(row, part) > rank.value).length + 1);
      expect(rank.atLeastAsLarge.map(row => row.id)).toContain(wonder.id);
      expect(rank.atLeastAsLarge.length).toBeGreaterThanOrEqual(rank.rank);
    }
    const twin = { ...wonder, id: "twin", slug: "twin" };
    expect(costPartRank([...cohort, twin], wonder, "cacheWrite").rank).toBe(1);
    expect(costPartRank([...cohort, twin], wonder, "cacheWrite").atLeastAsLarge).toHaveLength(2);
  });

  test("keeps exact ties out of the same-rounded-score rows", () => {
    const exactTie = { ...astraXhigh, id: "tie", intelligenceIndex: wonder.intelligenceIndex, slug: "tie" };
    const rows = sameRoundedScoreRows(comparableIntelligenceRecords([...fixture, exactTie]), wonder);
    expect(rows.map(row => row.record.slug)).toEqual(["gpt-6-astra-xhigh"]);
    expect(sameRoundedScoreRows(comparableIntelligenceRecords(fixture), wonder, 3)).toEqual([]);
  });

  test("splits each row's cost into its sides against the reference, cheapest first", () => {
    const rows = costSideRows(wonder, [astraMax, opusHigh]);
    expect(rows.map(row => row.record.slug)).toEqual(["claude-opus-5-5-high", "gpt-6-astra"]);
    for (const row of rows) {
      expect(row.inputCost + row.outputCost).toBeCloseTo(comparableTaskCost(row.record), 10);
      expect(row.inputShare).toBeCloseTo(row.inputCost / comparableTaskCost(row.record), 10);
      expect(row.cacheWriteCost).toBeLessThanOrEqual(row.inputCost);
      expect(row.costMultiple).toBeCloseTo(comparableTaskCost(row.record) / comparableTaskCost(wonder), 10);
      expect(row.gapPoints).toBeCloseTo(row.record.intelligenceIndex - wonder.intelligenceIndex, 10);
    }
    expect(costSideRows(wonder, [])).toEqual([]);
  });

  test("draws the Meta-only frontier and measures the other Meta rows", () => {
    expect(creatorRows(fixture).map(row => row.slug)).toEqual([wonder.slug, spark.slug, sparkXhigh.slug, glimmer.slug]);
    expect(creatorFrontier(fixture).map(row => row.slug)).toEqual([wonder.slug, spark.slug, sparkXhigh.slug, glimmer.slug]);
    const rows = creatorRowsAgainst(fixture, wonder);
    expect(rows.map(row => row.record.slug)).toEqual([spark.slug, sparkXhigh.slug, glimmer.slug]);
    expect(rows.every(row => row.onFamilyFrontier)).toBeTrue();
    expect(rows[0]?.gapPoints).toBeCloseTo(48.09 - 52.39, 10);
    expect(rows[0]?.costMultiple).toBeCloseTo(1.6 / 4.52, 10);
    const dominatedSpark = { ...spark, costUsdPerTask: { ...sparkXhigh.costUsdPerTask, total: 1.37 } as typeof spark.costUsdPerTask, id: "spark-dom", intelligenceIndex: 44, slug: "spark-dom" };
    const withDominated = creatorRowsAgainst([...fixture, dominatedSpark], wonder);
    expect(withDominated.find(row => row.record.slug === "spark-dom")?.onFamilyFrontier).toBeFalse();
    expect(creatorRows(fixture, "nobody")).toEqual([]);
    expect(creatorFrontier(fixture, "nobody")).toEqual([]);
  });

  test("matches the vendor table's releases to their max rows", () => {
    const rows = vendorComparisonRows(fixture);
    expect(rows.map(row => row.releaseSlug)).toEqual([...MUSE_WONDER_VENDOR_COMPARISON_RELEASE_SLUGS]);
    expect(rows.map(row => row.record?.slug)).toEqual([undefined, "gpt-6-astra", "claude-opus-5-5"]);
    expect(vendorComparisonRows(fixture, ["gpt-6-astra"], "xhigh")[0]?.record?.slug).toBe("gpt-6-astra-xhigh");
    expect(vendorComparisonRows(fixture, ["gpt-6-astra"], "low")[0]?.record).toBeUndefined();
  });

  test("agrees with the checked snapshot", () => {
    const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
    if (!parsed.ok) throw parsed.error;
    const { records } = parsed.value;
    const placement = museWonderIntelligencePlacement(records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    const cohort = comparableIntelligenceRecords(records);
    const cost = comparableTaskCost(placement.record);
    expect(placement.record.creator.slug).toBe(META_CREATOR_SLUG);
    expect(placement.record.effort?.slug).toBe("max");
    expect(placement.cohortSize).toBe(cohort.length);
    expect(placement.rank).toBe(cohort.filter(row => row.intelligenceIndex > placement.record.intelligenceIndex).length + 1);
    expect(placement.cheaperCount + placement.costlierCount).toBeLessThanOrEqual(cohort.length - 1);
    expect(placement.cheaperCount).toBe(cohort.filter(row => comparableTaskCost(row) < cost).length);
    expect(placement.onCostFrontier).toBe(paretoMembership(cohort, "costUsdPerTask").has(placement.record.id));
    expect(placement.onCostFrontier).toBe(placement.dominators.length === 0);
    for (const dominator of placement.dominators) {
      expect(comparableTaskCost(dominator)).toBeLessThanOrEqual(cost);
      expect(dominator.intelligenceIndex).toBeGreaterThanOrEqual(placement.record.intelligenceIndex);
    }
    for (const row of placement.sameRoundedScore) {
      expect(row.record.intelligenceIndex.toFixed(1)).toBe(placement.record.intelligenceIndex.toFixed(1));
      expect(row.record.intelligenceIndex).not.toBe(placement.record.intelligenceIndex);
    }
    const frontier = creatorFrontier(records);
    expect(frontier.map(row => row.id)).toEqual(
      orderedParetoPath(creatorRows(records), "costUsdPerTask").map(point => point.record.id).toReversed(),
    );
    expect(frontier[0]?.id).toBe(placement.record.id);
    for (const row of vendorComparisonRows(records)) {
      expect(row.record?.effort?.slug ?? "max").toBe("max");
    }
  });
});
