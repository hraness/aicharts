import { describe, expect, test } from "bun:test";

import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";

import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import { parseArtificialAnalysisIntelligenceV43Snapshot } from "./artificial-analysis-intelligence-v4-3-data";
import {
  ANTHROPIC_CREATOR_SLUG,
  CLAUDE_HAIKU_55_INTELLIGENCE_SLUG,
  CLAUDE_HAIKU_55_RELEASE_SLUG,
  CLAUDE_HAIKU_55_SIBLING_RELEASE_SLUGS,
  GPT_6_LUNA_RELEASE_SLUG,
  anthropicFrontier,
  anthropicRows,
  familyRowsDominatedBy,
  frontierLevelsFor,
  haikuIntelligencePlacement,
  releaseRowsAgainst,
  siblingFamilyRows,
} from "./claude-haiku-5-5-placement";
import { costedRecord } from "./claude-opus-5-5-placement.test";
import { comparableIntelligenceRecords, orderedParetoPath, paretoMembership } from "./intelligence-efficiency";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";

type CostParts = Parameters<typeof costedRecord>[2];

/** A costed row stamped with an Anthropic creator and the named release. */
export function anthropicRecord(
  slug: string,
  index: number,
  parts: CostParts,
  effort: string | null,
  releaseSlug: string,
  releaseName = releaseSlug,
): ArtificialAnalysisIntelligenceRecord {
  return {
    ...costedRecord(slug, index, parts, { answer: 5_000, reasoning: 10_000 }, effort, undefined, "2026-10-07"),
    creator: { id: ANTHROPIC_CREATOR_SLUG, name: "Anthropic", slug: ANTHROPIC_CREATOR_SLUG },
    name: slug,
    release: { name: releaseName, slug: releaseSlug },
  };
}

function haikuRow(slug: string, index: number, total: number, effort: string): ArtificialAnalysisIntelligenceRecord {
  return anthropicRecord(
    slug,
    index,
    { answer: total * 0.1, cacheRead: total * 0.45, cacheWrite: total * 0.15, nonCacheInput: total * 0.01, reasoning: total * 0.29 },
    effort,
    CLAUDE_HAIKU_55_RELEASE_SLUG,
    "Claude Haiku 5.5",
  );
}

function familyRow(slug: string, index: number, total: number, effort: string, releaseSlug: string): ArtificialAnalysisIntelligenceRecord {
  return anthropicRecord(
    slug,
    index,
    { answer: total * 0.2, cacheRead: total * 0.4, cacheWrite: total * 0.1, nonCacheInput: total * 0.05, reasoning: total * 0.25 },
    effort,
    releaseSlug,
  );
}

const haikuMax = haikuRow(CLAUDE_HAIKU_55_INTELLIGENCE_SLUG, 43.4, 0.213, "max");
const haikuXhigh = haikuRow("claude-haiku-5-5-xhigh", 41.25, 0.124, "xhigh");
const haikuHigh = haikuRow("claude-haiku-5-5-high", 37.8, 0.079, "high");
const haikuLow = haikuRow("claude-haiku-5-5-low", 29.5, 0.025, "low");
const mimo = intelligenceRecord("mimo-v2-6-pro", 46.3, 0.133);
const solLow = intelligenceRecord("gpt-6-1-sol-low", 42.1, 0.131);
const stepPreview = intelligenceRecord("step-5-preview", 43.7, 1.03);
const kimi = intelligenceRecord("kimi-k3", 43.6, 2.0);
const grok = intelligenceRecord("grok-4-7-low", 42.2, 1.25);
const opusMax = familyRow("claude-opus-5-5", 57.6, 5.98, "max", "claude-opus-5-5");
const opusLow = familyRow("claude-opus-5-5-low", 42.3, 0.551, "low", "claude-opus-5-5");
const sonnetHigh = familyRow("claude-sonnet-5-5-high", 46.8, 0.884, "high", "claude-sonnet-5-5");
const sonnetLow = familyRow("claude-sonnet-5-5-low", 35.9, 0.345, "low", "claude-sonnet-5-5");
const fable = familyRow("claude-fable-5-1", 53.4, 7.63, "max", "claude-fable-5-1");
const lunaMax = { ...intelligenceRecord("gpt-6-luna", 38.1, 0.068), release: { name: "GPT-6 Luna", slug: GPT_6_LUNA_RELEASE_SLUG } };
const lunaLow = { ...intelligenceRecord("gpt-6-luna-low", 21.5, 0.0045), release: { name: "GPT-6 Luna", slug: GPT_6_LUNA_RELEASE_SLUG } };
const priceless = intelligenceRecord("priceless", 90, null);

const cohort = [
  priceless, opusMax, fable, sonnetHigh, mimo, stepPreview, kimi, haikuMax, opusLow, grok, solLow, haikuXhigh,
  lunaMax, haikuHigh, sonnetLow, haikuLow, lunaLow,
];

describe("haikuIntelligencePlacement", () => {
  test("places the max row, counts cheaper rows, and lists the closest rows below with their multiples", () => {
    const placement = haikuIntelligencePlacement(cohort);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.id).toBe(haikuMax.id);
    expect(placement.cohortSize).toBe(16);
    expect(placement.rank).toBe(7);
    expect(placement.onCostFrontier).toBeFalse();
    expect(placement.dominators.map(row => row.id)).toEqual([mimo.id]);
    expect(placement.cheapestHigher?.record.id).toBe(mimo.id);
    expect(placement.cheaperCount).toBe(7);
    expect(placement.neighbors.map(row => row.id)).toEqual([stepPreview.id, kimi.id]);
    expect(placement.closestBelow.map(entry => entry.record.id)).toEqual([opusLow.id, grok.id, solLow.id, haikuXhigh.id, lunaMax.id]);
    const [first] = placement.closestBelow;
    expect(first?.gapPoints).toBeCloseTo(1.1, 5);
    expect(first?.costMultiple).toBeCloseTo(0.551 / 0.213, 5);
    expect(placement.effortLadder.map(step => step.record.id)).toEqual([haikuLow.id, haikuHigh.id, haikuXhigh.id, haikuMax.id]);
    expect(placement.otherModes).toEqual([]);
  });

  test("lists only the Haiku effort rows that are frontier vertices, with the vertices either side", () => {
    const placement = haikuIntelligencePlacement(cohort);
    if (placement === undefined) throw new Error("expected a placement");
    // Luna Max at 38.1 for $0.068 beats Haiku High at 37.8 for $0.079 on both axes, so high is no vertex.
    expect(placement.frontierLevels.map(level => level.record.id)).toEqual([haikuXhigh.id, haikuLow.id]);
    const [xhigh, low] = placement.frontierLevels;
    expect(xhigh?.above?.id).toBe(solLow.id);
    expect(xhigh?.below?.id).toBe(lunaMax.id);
    expect(low?.above?.id).toBe(lunaMax.id);
    expect(low?.below?.id).toBe(lunaLow.id);
  });

  test("caps and orders the closest rows below by the requested count", () => {
    expect(haikuIntelligencePlacement(cohort, 1, 2)?.closestBelow.map(entry => entry.record.id)).toEqual([opusLow.id, grok.id]);
    expect(haikuIntelligencePlacement(cohort, 1, 0)?.closestBelow).toEqual([]);
    expect(() => haikuIntelligencePlacement(cohort, 1, -1)).toThrow(RangeError);
    expect(() => haikuIntelligencePlacement(cohort, 1, 1.5)).toThrow(RangeError);
  });

  test("returns undefined without a comparable Haiku max row", () => {
    expect(haikuIntelligencePlacement([mimo, haikuXhigh, haikuLow])).toBeUndefined();
    expect(haikuIntelligencePlacement([{ ...haikuMax, costUsdPerTask: null }, mimo])).toBeUndefined();
    expect(haikuIntelligencePlacement([])).toBeUndefined();
  });
});

describe("frontierLevelsFor", () => {
  test("walks the frontier from the top and attaches neighbors", () => {
    const comparable = comparableIntelligenceRecords(cohort);
    const levels = frontierLevelsFor(comparable, CLAUDE_HAIKU_55_RELEASE_SLUG);
    const fromTop = orderedParetoPath(comparable, "costUsdPerTask").map(point => point.record.id).toReversed();
    for (const level of levels) {
      const position = fromTop.indexOf(level.record.id);
      expect(position).toBeGreaterThanOrEqual(0);
      expect(level.above?.id).toBe(fromTop[position - 1]);
      expect(level.below?.id).toBe(fromTop[position + 1]);
    }
    expect(frontierLevelsFor(comparable, "no-such-release")).toEqual([]);
    const [top] = frontierLevelsFor(comparable, "claude-opus-5-5");
    expect(top?.record.id).toBe(opusMax.id);
    expect(top?.above).toBeUndefined();
  });
});

describe("anthropicRows and anthropicFrontier", () => {
  test("keep only comparable Anthropic rows, highest index first", () => {
    expect(anthropicRows(cohort).map(row => row.id)).toEqual([
      opusMax.id, fable.id, sonnetHigh.id, haikuMax.id, opusLow.id, haikuXhigh.id, haikuHigh.id, sonnetLow.id, haikuLow.id,
    ]);
    expect(anthropicRows([priceless, mimo])).toEqual([]);
  });

  test("draw the family frontier through Anthropic rows alone", () => {
    expect(anthropicFrontier(cohort).map(row => row.id)).toEqual([
      opusMax.id, sonnetHigh.id, haikuMax.id, haikuXhigh.id, haikuHigh.id, haikuLow.id,
    ]);
    expect(anthropicFrontier([mimo, solLow])).toEqual([]);
  });
});

describe("siblingFamilyRows", () => {
  test("measures Sonnet and Opus rows against the reference and flags family-frontier vertices", () => {
    const rows = siblingFamilyRows(cohort, haikuMax);
    expect(rows.map(row => row.record.id)).toEqual([opusMax.id, sonnetHigh.id, opusLow.id, sonnetLow.id]);
    expect(rows.map(row => row.onFamilyFrontier)).toEqual([true, true, false, false]);
    const [opus] = rows;
    expect(opus?.gapPoints).toBeCloseTo(14.2, 5);
    expect(opus?.costMultiple).toBeCloseTo(5.98 / 0.213, 5);
    const [sonnetLowRow] = rows.slice(-1);
    expect(sonnetLowRow?.gapPoints).toBeCloseTo(-7.5, 5);
  });

  test("leaves out the reference’s own release even when named, and honors a custom slug list", () => {
    expect(siblingFamilyRows(cohort, haikuMax, [CLAUDE_HAIKU_55_RELEASE_SLUG, "claude-opus-5-5"]).map(row => row.record.id)).toEqual([opusMax.id, opusLow.id]);
    expect(siblingFamilyRows(cohort, haikuMax, ["claude-fable-5-1"]).map(row => row.record.id)).toEqual([fable.id]);
    expect(siblingFamilyRows([mimo, solLow], haikuMax)).toEqual([]);
    expect(CLAUDE_HAIKU_55_SIBLING_RELEASE_SLUGS).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
  });
});

describe("familyRowsDominatedBy", () => {
  test("names the highest-scoring Haiku row that beats each other Anthropic row on both axes", () => {
    const dominated = familyRowsDominatedBy(cohort, CLAUDE_HAIKU_55_RELEASE_SLUG);
    expect(dominated.map(entry => entry.record.id)).toEqual([opusLow.id, sonnetLow.id]);
    const [opus, sonnet] = dominated;
    expect(opus?.dominator.id).toBe(haikuMax.id);
    expect(opus?.pointsBelowDominator).toBeCloseTo(1.1, 5);
    expect(opus?.costMultipleOfDominator).toBeCloseTo(0.551 / 0.213, 5);
    expect(sonnet?.dominator.id).toBe(haikuMax.id);
  });

  test("a tie on one axis dominates only when the other axis is strictly better", () => {
    const tiedScore = { ...familyRow("tied-score", 43.4, 0.213, "max", "claude-sonnet-5-5"), costUsdPerTask: haikuMax.costUsdPerTask };
    const tiedCostLower = { ...familyRow("tied-cost", 40, 0.213, "low", "claude-sonnet-5-5"), costUsdPerTask: haikuMax.costUsdPerTask };
    const cheaperHigher = familyRow("cheaper-higher", 44, 0.2, "low", "claude-sonnet-5-5");
    const dominated = familyRowsDominatedBy([haikuMax, tiedScore, tiedCostLower, cheaperHigher], CLAUDE_HAIKU_55_RELEASE_SLUG);
    expect(dominated.map(entry => entry.record.id)).toEqual([tiedCostLower.id]);
    expect(familyRowsDominatedBy([mimo, solLow], CLAUDE_HAIKU_55_RELEASE_SLUG)).toEqual([]);
  });
});

describe("releaseRowsAgainst", () => {
  test("measures every comparable row of a release against the reference, highest index first", () => {
    const luna = releaseRowsAgainst(cohort, GPT_6_LUNA_RELEASE_SLUG, haikuMax);
    expect(luna.map(row => row.record.id)).toEqual([lunaMax.id, lunaLow.id]);
    expect(luna[0]?.gapPoints).toBeCloseTo(-5.3, 5);
    expect(luna[0]?.costMultiple).toBeCloseTo(0.068 / 0.213, 5);
    expect(releaseRowsAgainst(cohort, "no-such-release", haikuMax)).toEqual([]);
  });
});

describe("checked snapshot", () => {
  const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
  if (!parsed.ok) throw parsed.error;
  const records = parsed.value.records;
  const comparable = comparableIntelligenceRecords(records);

  test("agrees with the shared cohort, frontier, and ordering helpers", () => {
    const placement = haikuIntelligencePlacement(records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.slug).toBe(CLAUDE_HAIKU_55_INTELLIGENCE_SLUG);
    expect(placement.record.creator.slug).toBe(ANTHROPIC_CREATOR_SLUG);
    expect(placement.cohortSize).toBe(comparable.length);
    const cost = comparableTaskCost(placement.record);
    expect(placement.cheaperCount).toBe(comparable.filter(row => comparableTaskCost(row) < cost).length);
    const membership = paretoMembership(comparable, "costUsdPerTask");
    expect(placement.onCostFrontier).toBe(membership.has(placement.record.id));
    expect(placement.onCostFrontier).toBe(placement.dominators.length === 0);
    for (const level of placement.frontierLevels) {
      expect(membership.has(level.record.id)).toBeTrue();
      expect(level.record.release.slug).toBe(CLAUDE_HAIKU_55_RELEASE_SLUG);
    }
    expect(placement.effortLadder.length).toBeGreaterThanOrEqual(2);
    for (const step of placement.effortLadder) expect(step.record.effort).not.toBeNull();
  });

  test("keeps the Anthropic-only frontier inside the Anthropic rows and the dominated rows truly dominated", () => {
    const family = anthropicRows(records);
    const familyIds = new Set(family.map(row => row.id));
    for (const row of family) expect(row.creator.slug).toBe(ANTHROPIC_CREATOR_SLUG);
    const frontier = anthropicFrontier(records);
    for (const vertex of frontier) expect(familyIds.has(vertex.id)).toBeTrue();
    for (let position = 1; position < frontier.length; position += 1) {
      const above = frontier[position - 1];
      const vertex = frontier[position];
      if (above === undefined || vertex === undefined) continue;
      expect(above.intelligenceIndex).toBeGreaterThan(vertex.intelligenceIndex);
      expect(comparableTaskCost(above)).toBeGreaterThan(comparableTaskCost(vertex));
    }
    for (const entry of familyRowsDominatedBy(records, CLAUDE_HAIKU_55_RELEASE_SLUG)) {
      expect(entry.record.release.slug).not.toBe(CLAUDE_HAIKU_55_RELEASE_SLUG);
      expect(entry.dominator.release.slug).toBe(CLAUDE_HAIKU_55_RELEASE_SLUG);
      expect(entry.pointsBelowDominator).toBeGreaterThanOrEqual(0);
      expect(entry.costMultipleOfDominator).toBeGreaterThanOrEqual(1);
    }
    const placement = haikuIntelligencePlacement(records);
    if (placement === undefined) throw new Error("expected a placement");
    for (const row of siblingFamilyRows(records, placement.record)) {
      expect(CLAUDE_HAIKU_55_SIBLING_RELEASE_SLUGS as readonly string[]).toContain(row.record.release.slug);
      expect(row.record.release.slug).not.toBe(CLAUDE_HAIKU_55_RELEASE_SLUG);
    }
  });
});
