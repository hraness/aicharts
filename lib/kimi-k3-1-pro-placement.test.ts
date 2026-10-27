import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";

import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import { parseArtificialAnalysisIntelligenceV43Snapshot } from "./artificial-analysis-intelligence-v4-3-data";
import { comparableIntelligenceRecords, orderedParetoPath, paretoMembership } from "./intelligence-efficiency";
import {
  KIMI_CREATOR_SLUG,
  KIMI_K3_1_PRO_INTELLIGENCE_SLUG,
  KIMI_K3_1_PRO_RELEASE_SLUG,
  creatorNames,
  frontierSteps,
  kimiK31ProIntelligencePlacement,
  otherCreatorBestRows,
  rowsAbove,
  weightsSummary,
} from "./kimi-k3-1-pro-placement";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";
import { creatorRecord } from "./muse-wonder-placement.test";

function parts(total: number) {
  return { answer: total * 0.1, cacheRead: total * 0.5, cacheWrite: total * 0.22, nonCacheInput: total * 0.02, reasoning: total * 0.16 };
}

function flagged(record: ArtificialAnalysisIntelligenceRecord, open: boolean): ArtificialAnalysisIntelligenceRecord {
  return { ...record, weights: { license: null, open, sourceUrl: null } };
}

const kimi = flagged(creatorRecord(KIMI_K3_1_PRO_INTELLIGENCE_SLUG, 55.09, parts(2.115), null, KIMI_CREATOR_SLUG, KIMI_K3_1_PRO_RELEASE_SLUG, "Kimi K3.1 Pro"), false);
const k27 = flagged(creatorRecord("kimi-k2-7-code", 25.81, parts(0.541), null, KIMI_CREATOR_SLUG, "kimi-k2-7-code", "Kimi K2.7 Code"), true);
const opusMax = flagged(creatorRecord("claude-opus-5-5", 57.62, parts(5.982), "max", "anthropic", "claude-opus-5-5", "Claude Opus 5.5"), false);
const sonnetMax = flagged(creatorRecord("claude-sonnet-5-5", 56.0, parts(5.461), "max", "anthropic", "claude-sonnet-5-5", "Claude Sonnet 5.5"), false);
const opusXhigh = flagged(creatorRecord("claude-opus-5-5-xhigh", 55.99, parts(3.459), "xhigh", "anthropic", "claude-opus-5-5", "Claude Opus 5.5"), false);
const opusHigh = flagged(creatorRecord("claude-opus-5-5-high", 53.58, parts(1.823), "high", "anthropic", "claude-opus-5-5", "Claude Opus 5.5"), false);
const astraMax = flagged(creatorRecord("gpt-6-astra", 52.67, parts(3.258), "max", "openai", "gpt-6-astra", "GPT-6 Astra"), false);
const astraXhigh = flagged(creatorRecord("gpt-6-astra-xhigh", 52.39, parts(2.309), "xhigh", "openai", "gpt-6-astra", "GPT-6 Astra"), false);
const argonHigh = flagged(creatorRecord("gemini-4-argon-high", 52.56, parts(1.62), "high", "google", "gemini-4-argon", "Gemini 4 Argon"), false);
const mimo = flagged(creatorRecord("mimo-v2-6-pro", 46.32, parts(0.133), null, "xiaomi", "mimo-v2-6-pro", "MiMo-V2.6-Pro"), true);
const unflagged = creatorRecord("mystery", 30, parts(0.5), null, "mystery", "mystery", "Mystery");
const costless = intelligenceRecord("no-cost", 60, null);
const fixture = [costless, unflagged, mimo, argonHigh, astraXhigh, astraMax, opusHigh, opusXhigh, sonnetMax, opusMax, k27, kimi];

describe("kimi-k3-1-pro-placement", () => {
  test("places the row against the cohort the chart plots", () => {
    const placement = kimiK31ProIntelligencePlacement(fixture);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.id).toBe(kimi.id);
    expect(placement.cohortSize).toBe(11);
    expect(placement.rank).toBe(4);
    expect(placement.onCostFrontier).toBeTrue();
    expect(placement.dominators).toEqual([]);
    expect(placement.cheapestHigher?.record.slug).toBe("claude-opus-5-5-xhigh");
    expect(placement.cheaperCount).toBe(5);
    expect(placement.costlierCount).toBe(5);
    expect(placement.effortLadder).toHaveLength(1);
    expect(placement.otherModes).toEqual([]);
    expect(placement.rowsAbove.map(row => row.record.slug)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5-5-xhigh"]);
    expect(placement.rowsAbove[0]?.gapPoints).toBeCloseTo(57.62 - 55.09, 10);
    expect(placement.rowsAbove[0]?.costMultiple).toBeCloseTo(5.982 / 2.115, 10);
    expect(placement.creatorsAbove).toEqual(["anthropic"]);
    expect(placement.closestBelow.map(row => row.record.slug))
      .toEqual(["claude-opus-5-5-high", "gpt-6-astra", "gemini-4-argon-high", "gpt-6-astra-xhigh", "mimo-v2-6-pro"]);
    expect(placement.closestBelow.every(row => row.gapPoints < 0)).toBeTrue();
    expect(placement.frontier.onCostFrontier).toBeTrue();
    expect(placement.frontier.up?.record.slug).toBe("claude-opus-5-5-xhigh");
    expect(placement.frontier.down?.record.slug).toBe("claude-opus-5-5-high");
    expect(placement.otherCreatorBests.map(row => row.record.slug))
      .toEqual(["claude-opus-5-5", "gpt-6-astra", "gemini-4-argon-high", "mimo-v2-6-pro", "mystery"]);
    expect(placement.otherCreatorBests[0]?.creatorRowCount).toBe(4);
    expect(placement.otherCreatorBests[1]?.creatorRowCount).toBe(2);
    expect(placement.weights).toEqual({
      closedCount: 8,
      highestOpen: { costMultiple: 0.133 / 2.115, gapPoints: 46.32 - 55.09, record: mimo },
      open: false,
      openCount: 2,
      unclassifiedCount: 1,
    });
    expect(placement.partRanks.cacheRead.rank).toBe(6);
    expect(placement.partRanks.input.rank).toBe(6);
    expect(placement.partRanks.output.rank).toBe(6);
  });

  test("returns undefined without a costed Kimi K3.1 Pro row", () => {
    expect(kimiK31ProIntelligencePlacement(fixture.filter(record => record.slug !== KIMI_K3_1_PRO_INTELLIGENCE_SLUG))).toBeUndefined();
    expect(kimiK31ProIntelligencePlacement([])).toBeUndefined();
  });

  test("limits the other-creator table and rejects invalid counts", () => {
    const cohort = comparableIntelligenceRecords(fixture);
    expect(otherCreatorBestRows(cohort, kimi, 2).map(row => row.creatorName)).toEqual(["anthropic", "openai"]);
    expect(otherCreatorBestRows(cohort, kimi, 0)).toEqual([]);
    expect(() => otherCreatorBestRows(cohort, kimi, -1)).toThrow(RangeError);
    expect(() => otherCreatorBestRows(cohort, kimi, 2.5)).toThrow(RangeError);
    expect(kimiK31ProIntelligencePlacement(fixture, 1, 1)?.otherCreatorBests.map(row => row.record.slug)).toEqual(["claude-opus-5-5"]);
  });

  test("reports no frontier steps for a row off the frontier and none past the ends", () => {
    const cohort = comparableIntelligenceRecords(fixture);
    const dominated = { ...kimi, id: "dominated", intelligenceIndex: 50, slug: "dominated" };
    expect(frontierSteps([...cohort, dominated], dominated)).toEqual({ down: undefined, onCostFrontier: false, up: undefined });
    expect(frontierSteps(cohort, opusMax).up).toBeUndefined();
    expect(frontierSteps(cohort, opusMax).down?.record.slug).toBe("claude-sonnet-5-5");
    expect(frontierSteps(cohort, mimo).down).toBeUndefined();
    expect(frontierSteps([kimi], kimi)).toEqual({ down: undefined, onCostFrontier: true, up: undefined });
  });

  test("summarises weights flags without inventing one for the placed row", () => {
    const cohort = comparableIntelligenceRecords(fixture);
    const bare = { ...kimi, weights: undefined };
    const summary = weightsSummary([...cohort.filter(row => row.id !== kimi.id), bare], bare);
    expect(summary.open).toBeUndefined();
    expect(summary.unclassifiedCount).toBe(2);
    expect(summary.closedCount).toBe(7);
    expect(weightsSummary(cohort.filter(row => row.weights?.open !== true), kimi).highestOpen).toBeUndefined();
    expect(weightsSummary(cohort.filter(row => row.weights?.open !== true), kimi).openCount).toBe(0);
  });

  test("names creators once each in rank order", () => {
    const cohort = comparableIntelligenceRecords(fixture);
    expect(creatorNames(rowsAbove(cohort, mimo))).toEqual(["anthropic", "kimi", "openai", "google"]);
    expect(creatorNames([])).toEqual([]);
    expect(rowsAbove(cohort, opusMax)).toEqual([]);
  });

  test("rows above, other-creator bests, and frontier steps obey their definitions on any cohort", () => {
    const row = fc.record({
      creator: fc.constantFrom("a", "b", "c", "d"),
      index: fc.double({ max: 70, min: 1, noNaN: true }),
      total: fc.double({ max: 20, min: 0.01, noNaN: true }),
      open: fc.option(fc.boolean(), { nil: undefined }),
    });
    fc.assert(fc.property(fc.array(row, { maxLength: 30, minLength: 1 }), (rows) => {
      const records = rows.map((entry, index) => {
        const record = creatorRecord(`row-${index}`, entry.index, parts(entry.total), null, entry.creator, `release-${index}`);
        return entry.open === undefined ? record : flagged(record, entry.open);
      });
      const cohort = comparableIntelligenceRecords(records);
      const membership = paretoMembership(cohort, "costUsdPerTask");
      const path = orderedParetoPath(cohort, "costUsdPerTask").map(point => point.record.id).toReversed();
      for (const record of cohort) {
        const above = rowsAbove(cohort, record);
        expect(above.every(row => row.record.intelligenceIndex > record.intelligenceIndex)).toBeTrue();
        expect(above.length).toBe(cohort.filter(row => row.intelligenceIndex > record.intelligenceIndex).length);
        for (let index = 1; index < above.length; index += 1) {
          expect(above[index - 1]!.record.intelligenceIndex >= above[index]!.record.intelligenceIndex).toBeTrue();
        }
        const bests = otherCreatorBestRows(cohort, record, cohort.length);
        expect(new Set(bests.map(row => row.record.creator.slug)).size).toBe(bests.length);
        expect(bests.some(row => row.record.creator.slug === record.creator.slug)).toBeFalse();
        for (const best of bests) {
          const family = cohort.filter(row => row.creator.slug === best.record.creator.slug);
          expect(best.creatorRowCount).toBe(family.length);
          expect(family.every(row => row.intelligenceIndex <= best.record.intelligenceIndex)).toBeTrue();
          expect(best.costMultiple).toBeCloseTo(comparableTaskCost(best.record) / comparableTaskCost(record), 10);
        }
        const steps = frontierSteps(cohort, record);
        expect(steps.onCostFrontier).toBe(membership.has(record.id));
        if (steps.onCostFrontier) {
          const position = path.indexOf(record.id);
          expect(steps.up?.record.id).toBe(path[position - 1]);
          expect(steps.down?.record.id).toBe(path[position + 1]);
          if (steps.up !== undefined) expect(steps.up.gapPoints >= 0 && steps.up.costMultiple >= 1).toBeTrue();
          if (steps.down !== undefined) expect(steps.down.gapPoints <= 0 && steps.down.costMultiple <= 1).toBeTrue();
        } else {
          expect(steps.up).toBeUndefined();
          expect(steps.down).toBeUndefined();
        }
        const weights = weightsSummary(cohort, record);
        expect(weights.openCount + weights.closedCount + weights.unclassifiedCount).toBe(cohort.length);
        if (weights.highestOpen !== undefined) {
          expect(weights.highestOpen.record.weights?.open).toBeTrue();
          expect(cohort.filter(row => row.weights?.open === true).every(row => row.intelligenceIndex <= weights.highestOpen!.record.intelligenceIndex)).toBeTrue();
        } else {
          expect(weights.openCount).toBe(0);
        }
      }
    }), { numRuns: 60 });
  });

  test("agrees with the checked snapshot", () => {
    const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
    if (!parsed.ok) throw parsed.error;
    const { records } = parsed.value;
    const placement = kimiK31ProIntelligencePlacement(records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    const cohort = comparableIntelligenceRecords(records);
    const cost = comparableTaskCost(placement.record);
    expect(placement.record.creator.slug).toBe(KIMI_CREATOR_SLUG);
    expect(placement.record.effort).toBeNull();
    expect(placement.cohortSize).toBe(cohort.length);
    expect(placement.rank).toBe(cohort.filter(row => row.intelligenceIndex > placement.record.intelligenceIndex).length + 1);
    expect(placement.rowsAbove).toHaveLength(placement.rank - 1);
    expect(placement.cheaperCount).toBe(cohort.filter(row => comparableTaskCost(row) < cost).length);
    expect(placement.cheaperCount + placement.costlierCount).toBeLessThanOrEqual(cohort.length - 1);
    expect(placement.onCostFrontier).toBe(paretoMembership(cohort, "costUsdPerTask").has(placement.record.id));
    expect(placement.frontier.onCostFrontier).toBe(placement.onCostFrontier);
    expect(placement.onCostFrontier).toBe(placement.dominators.length === 0);
    expect(placement.weights.open).toBe(placement.record.weights?.open);
    expect(placement.otherCreatorBests.length).toBeLessThanOrEqual(6);
    expect(placement.otherCreatorBests.every(row => row.record.creator.slug !== KIMI_CREATOR_SLUG)).toBeTrue();
  });
});
