import { describe, expect, test } from "bun:test";

import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";

import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import { parseArtificialAnalysisIntelligenceV43Snapshot } from "./artificial-analysis-intelligence-v4-3-data";
import {
  CLAUDE_OPUS_5_CODING_CONFIGURATION,
  CLAUDE_OPUS_5_RELEASE_SLUG,
  CLAUDE_OPUS_55_CODING_CONFIGURATION,
  CLAUDE_OPUS_55_CODING_MODEL,
  CLAUDE_OPUS_55_INTELLIGENCE_SLUG,
  CLAUDE_OPUS_55_RELEASE_SLUG,
  componentContrasts,
  frontierDescent,
  inputCostShare,
  opus5CodingAgentPlacement,
  opus5IntelligenceRows,
  opus55CodingAgentPlacement,
  opus55CodingAgentRows,
  opusIntelligencePlacement,
  reasoningShare,
  taskCostBreakdown,
  topFrontierRun,
} from "./claude-opus-5-5-placement";
import { parseCodingAgentSnapshot } from "./coding-agent-data";
import { aaIndexCostFrontier } from "./coding-agent-snapshot-rows";
import { codingAgentRecord } from "./grok-4-7-placement.test";
import { comparableIntelligenceRecords, orderedParetoPath, paretoMembership } from "./intelligence-efficiency";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";

/** A row with a full cost and token breakdown so the share helpers have something to divide. */
export function costedRecord(
  slug: string,
  index: number,
  parts: Readonly<{ answer: number; cacheRead: number; cacheWrite: number; nonCacheInput: number; reasoning: number }>,
  tokens: Readonly<{ answer: number; reasoning: number }>,
  effort: string | null = "max",
  releaseSlug = CLAUDE_OPUS_55_RELEASE_SLUG,
  releaseDate = "2026-09-17",
): ArtificialAnalysisIntelligenceRecord {
  const input = parts.nonCacheInput + parts.cacheRead + parts.cacheWrite;
  const output = parts.answer + parts.reasoning;
  return {
    ...intelligenceRecord(slug, index, input + output),
    costUsdPerTask: { ...parts, input, output, total: input + output },
    effort: effort === null ? null : { label: effort, level: 10, slug: effort },
    outputTokensPerTask: { ...tokens, total: tokens.answer + tokens.reasoning },
    release: { name: "Claude Opus 5.5", slug: releaseSlug },
    releaseDate,
  };
}

const opusMax = costedRecord(
  CLAUDE_OPUS_55_INTELLIGENCE_SLUG,
  57.62,
  { answer: 0.7, cacheRead: 2.42, cacheWrite: 1.07, nonCacheInput: 0.1, reasoning: 1.68 },
  { answer: 35_237, reasoning: 83_929 },
  "max",
  CLAUDE_OPUS_55_RELEASE_SLUG,
  "2026-09-22",
);
const opusXhigh = costedRecord(
  "claude-opus-5-5-xhigh",
  55.99,
  { answer: 0.51, cacheRead: 1.37, cacheWrite: 0.67, nonCacheInput: 0.1, reasoning: 0.81 },
  { answer: 25_353, reasoning: 40_315 },
  "xhigh",
);
const opusHigh = costedRecord(
  "claude-opus-5-5-high",
  53.58,
  { answer: 0.35, cacheRead: 0.6, cacheWrite: 0.4, nonCacheInput: 0.1, reasoning: 0.36 },
  { answer: 17_347, reasoning: 18_237 },
  "high",
);
const opusLow = costedRecord(
  "claude-opus-5-5-low",
  42.31,
  { answer: 0.14, cacheRead: 0.12, cacheWrite: 0.13, nonCacheInput: 0.1, reasoning: 0.07 },
  { answer: 6_775, reasoning: 3_376 },
  "low",
);
const fableMax = intelligenceRecord("claude-fable-5-1", 53.35, 7.63);
const astraMax = intelligenceRecord("gpt-6-astra", 52.67, 3.26);
const solMax = intelligenceRecord("gpt-6-sol", 47.53, 1.06);
const mimo = intelligenceRecord("mimo-v2-6-pro", 46.32, 0.13);
const costless = intelligenceRecord("costless", 70, null);

describe("Claude Opus 5.5 Intelligence Index placement", () => {
  test("requires the max row inside the comparable cohort and rejects a bad window or count", () => {
    expect(opusIntelligencePlacement([opusXhigh, fableMax])).toBeUndefined();
    expect(opusIntelligencePlacement([intelligenceRecord(CLAUDE_OPUS_55_INTELLIGENCE_SLUG, 57, null)])).toBeUndefined();
    expect(() => opusIntelligencePlacement([opusMax], 0)).toThrow(RangeError);
    expect(() => opusIntelligencePlacement([opusMax], 1, -1)).toThrow(RangeError);
    expect(() => opusIntelligencePlacement([opusMax], 1, 1.5)).toThrow(RangeError);
  });

  test("ranks the leader, lists the closest rows below it, and walks the frontier run", () => {
    const placement = opusIntelligencePlacement([
      mimo, opusHigh, fableMax, opusMax, solMax, astraMax, opusXhigh, costless, opusLow,
    ]);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.cohortSize).toBe(8);
    expect(placement.rank).toBe(1);
    expect(placement.leader.id).toBe(opusMax.id);
    expect(placement.onCostFrontier).toBeTrue();
    expect(placement.dominators).toEqual([]);
    expect(placement.cheapestHigher).toBeUndefined();
    expect(placement.neighbors).toEqual([]);
    expect(placement.closestBelow.map(entry => entry.record.slug))
      .toEqual(["claude-opus-5-5-xhigh", "claude-opus-5-5-high", "claude-fable-5-1", "gpt-6-astra", "gpt-6-sol"]);
    const [xhigh] = placement.closestBelow;
    expect(xhigh?.gapPoints).toBeCloseTo(57.62 - 55.99, 9);
    expect(xhigh?.costMultiple).toBeCloseTo(comparableTaskCost(opusXhigh) / comparableTaskCost(opusMax), 9);
    expect(placement.effortLadder.map(step => step.record.slug))
      .toEqual(["claude-opus-5-5-low", "claude-opus-5-5-high", "claude-opus-5-5-xhigh", CLAUDE_OPUS_55_INTELLIGENCE_SLUG]);
    expect(placement.otherModes).toEqual([]);
    // Fable (max) costs more and scores less than Opus xhigh, so the frontier skips it and reaches Sol.
    expect(placement.frontierRun.map(record => record.slug))
      .toEqual([CLAUDE_OPUS_55_INTELLIGENCE_SLUG, "claude-opus-5-5-xhigh", "claude-opus-5-5-high"]);
    expect(placement.firstOtherFrontier?.slug).toBe("gpt-6-sol");
  });

  test("caps the closest rows below at the requested count", () => {
    const placement = opusIntelligencePlacement([opusMax, opusXhigh, opusHigh, fableMax], 1, 2);
    expect(placement?.closestBelow.map(entry => entry.record.slug))
      .toEqual(["claude-opus-5-5-xhigh", "claude-opus-5-5-high"]);
    expect(opusIntelligencePlacement([opusMax, fableMax], 1, 0)?.closestBelow).toEqual([]);
  });

  test("reports a non-leading row with its dominators and an empty frontier run", () => {
    const cheaperHigher = intelligenceRecord("twin", 58, 4);
    const placement = opusIntelligencePlacement([opusMax, cheaperHigher, opusXhigh]);
    expect(placement?.rank).toBe(2);
    expect(placement?.onCostFrontier).toBeFalse();
    expect(placement?.dominators.map(record => record.slug)).toEqual(["twin"]);
    expect(placement?.cheapestHigher?.record.slug).toBe("twin");
    expect(placement?.frontierRun).toEqual([]);
    expect(placement?.firstOtherFrontier?.slug).toBe("twin");
  });

  test("walks the whole frontier when every vertex belongs to the release", () => {
    const run = topFrontierRun([opusMax, opusXhigh, opusLow], CLAUDE_OPUS_55_RELEASE_SLUG);
    expect(run.frontierRun.map(record => record.slug))
      .toEqual([CLAUDE_OPUS_55_INTELLIGENCE_SLUG, "claude-opus-5-5-xhigh", "claude-opus-5-5-low"]);
    expect(run.firstOtherFrontier).toBeUndefined();
    expect(topFrontierRun([], CLAUDE_OPUS_55_RELEASE_SLUG)).toEqual({ firstOtherFrontier: undefined, frontierRun: [] });
  });

  test("derives shares and cost components from the row", () => {
    expect(reasoningShare(opusMax)).toBeCloseTo(83_929 / (83_929 + 35_237), 9);
    expect(inputCostShare(opusMax)).toBeCloseTo((0.1 + 2.42 + 1.07) / (0.1 + 2.42 + 1.07 + 0.7 + 1.68), 9);
    expect(taskCostBreakdown(opusMax).cacheRead).toBe(2.42);
    expect(() => taskCostBreakdown(costless)).toThrow(RangeError);
    expect(reasoningShare(intelligenceRecord("plain", 40, 1))).toBe(0);
    expect(inputCostShare(intelligenceRecord("plain", 40, 1))).toBe(0);
  });

  test("lists Claude Opus 5 Index rows only for that release", () => {
    const opus5 = { ...intelligenceRecord("claude-opus-5", 50, 6), release: { name: "Claude Opus 5", slug: CLAUDE_OPUS_5_RELEASE_SLUG } };
    expect(opus5IntelligenceRows([opusMax, opus5, fableMax]).map(record => record.slug)).toEqual(["claude-opus-5"]);
    expect(opus5IntelligenceRows([opusMax, fableMax])).toEqual([]);
  });

  test("matches the shared Pareto membership, the path order, and the effort rows on the checked snapshot", () => {
    const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
    if (!parsed.ok) throw parsed.error;
    const placement = opusIntelligencePlacement(parsed.value.records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    const cohort = comparableIntelligenceRecords(parsed.value.records);
    expect(placement.cohortSize).toBe(cohort.length);
    expect(placement.rank).toBe(cohort.filter(record => record.intelligenceIndex > placement.record.intelligenceIndex).length + 1);
    expect(placement.onCostFrontier)
      .toBe(paretoMembership(cohort, "costUsdPerTask").has(placement.record.id));
    expect(placement.record.release.slug).toBe(CLAUDE_OPUS_55_RELEASE_SLUG);
    expect(placement.record.effort?.slug).toBe("max");
    const releaseRows = cohort.filter(record => record.release.slug === CLAUDE_OPUS_55_RELEASE_SLUG);
    expect(placement.effortLadder.length + placement.otherModes.length).toBe(releaseRows.length);
    const path = orderedParetoPath(cohort, "costUsdPerTask").map(point => point.record).toReversed();
    expect(placement.frontierRun.map(record => record.id))
      .toEqual(path.slice(0, placement.frontierRun.length).map(record => record.id));
    expect(placement.firstOtherFrontier?.id).toBe(path[placement.frontierRun.length]?.id);
    for (const entry of placement.closestBelow) {
      expect(entry.record.intelligenceIndex).toBeLessThanOrEqual(placement.record.intelligenceIndex);
      expect(entry.gapPoints).toBeGreaterThanOrEqual(0);
      expect(entry.costMultiple).toBeGreaterThan(0);
    }
  });
});

describe("Claude Opus 5 coding-agent contrast", () => {
  const opus5 = codingAgentRecord({
    ...CLAUDE_OPUS_5_CODING_CONFIGURATION,
    aaIndex: 59.73,
    costUsd: 10.79,
    id: "opus-5",
  });
  const astra = codingAgentRecord({ aaIndex: 61.65, costUsd: 7.47, id: "gpt-6-astra", model: "GPT-6 Astra", providerId: "openai" });
  const sol = codingAgentRecord({ aaIndex: 56.66, costUsd: 2.99, id: "gpt-6-sol", model: "GPT-6 Sol", providerId: "openai" });

  test("places Claude Code · Opus 5 and finds Opus 5.5 rows in any harness", () => {
    const placement = opus5CodingAgentPlacement([sol, opus5, astra]);
    expect(placement?.record.id).toBe("opus-5");
    expect(placement?.rank).toBe(2);
    expect(placement?.indexedCount).toBe(3);
    expect(placement?.onCostFrontier).toBeFalse();
    expect(placement?.dominators.map(record => record.id)).toEqual(["gpt-6-astra"]);
    expect(placement?.predecessor).toBeUndefined();
    expect(opus5CodingAgentPlacement([sol, astra])).toBeUndefined();

    const opus55InClaudeCode = codingAgentRecord({ ...CLAUDE_OPUS_55_CODING_MODEL, aaIndex: 63, agent: "Claude Code", costUsd: 8, id: "opus-5-5-cc" });
    const opus55InCursor = codingAgentRecord({ ...CLAUDE_OPUS_55_CODING_MODEL, aaIndex: null, agent: "Cursor", costUsd: 9, id: "opus-5-5-cursor" });
    const opus55Elsewhere = codingAgentRecord({ ...CLAUDE_OPUS_55_CODING_MODEL, aaIndex: 61, agent: "Devin", costUsd: 6, id: "opus-5-5-devin" });
    expect(opus55CodingAgentRows([opus5, opus55InCursor, opus55Elsewhere, opus55InClaudeCode]).map(record => record.id))
      .toEqual(["opus-5-5-cc", "opus-5-5-devin", "opus-5-5-cursor"]);
    expect(opus55CodingAgentRows([opus5, sol])).toEqual([]);
  });

  test("agrees with the chart ranking on the checked snapshot", () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const placement = opus5CodingAgentPlacement(parsed.value.records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.agent).toBe(CLAUDE_OPUS_5_CODING_CONFIGURATION.agent);
    expect(placement.record.model).toBe(CLAUDE_OPUS_5_CODING_CONFIGURATION.model);
    expect(placement.rank).toBe(placement.higher.length + 1);
    expect(placement.dominators.length === 0).toBe(placement.onCostFrontier);
    for (const row of opus55CodingAgentRows(parsed.value.records)) {
      expect(row.model).toBe(CLAUDE_OPUS_55_CODING_MODEL.model);
      expect(row.providerId).toBe(CLAUDE_OPUS_55_CODING_MODEL.providerId);
    }
  });
});

describe("Claude Code · Opus 5.5 coding-agent placement", () => {
  const opus55 = codingAgentRecord({
    ...CLAUDE_OPUS_55_CODING_CONFIGURATION,
    aaIndex: 65.99,
    costUsd: 13.04,
    deepSwe: 68.44,
    id: "opus-5-5",
    sweAtlas: 66.4,
    terminalBench: 63.13,
    totalTokens: 15_551_383,
  });
  const opus5 = codingAgentRecord({
    ...CLAUDE_OPUS_5_CODING_CONFIGURATION,
    aaIndex: 59.73,
    costUsd: 10.79,
    deepSwe: 62.54,
    id: "opus-5",
    sweAtlas: 62.1,
    terminalBench: 54.55,
    totalTokens: 11_374_850,
  });
  const fable = codingAgentRecord({ aaIndex: 62.22, agent: "Claude Code", costUsd: 12.39, deepSwe: 64.31, id: "fable", model: "Fable 5.1 (with fallback)", providerId: "anthropic", sweAtlas: 64.78, terminalBench: 57.58 });
  const astra = codingAgentRecord({ aaIndex: 61.65, costUsd: 7.47, deepSwe: 67.55, id: "gpt-6-astra", model: "GPT-6 Astra", providerId: "openai", sweAtlas: 61.83, terminalBench: 55.56 });
  const sol = codingAgentRecord({ aaIndex: 56.66, costUsd: 2.99, deepSwe: 69.03, id: "gpt-6-sol", model: "GPT-6 Sol", providerId: "openai", sweAtlas: 57.53, terminalBench: 43.43 });
  const muse = codingAgentRecord({ aaIndex: 54.3, agent: "Muse Code", costUsd: 3.98, deepSwe: 71.68, id: "muse", model: "Muse Spark 1.3", providerId: "meta", sweAtlas: 59.41, terminalBench: 31.82 });
  const luna = codingAgentRecord({ aaIndex: 43.22, costUsd: 0.44, deepSwe: 66.37, id: "gpt-5-6-luna", model: "GPT-5.6 Luna", providerId: "openai", sweAtlas: 48.66, terminalBench: 14.65 });
  const costless = codingAgentRecord({ aaIndex: 70, costUsd: null, id: "costless" });
  const indexless = codingAgentRecord({ aaIndex: null, costUsd: 1, deepSwe: 80, id: "indexless" });

  test("places the leader, ranks its cost, walks the frontier below it, and contrasts each component", () => {
    const records = [sol, opus5, luna, fable, indexless, muse, opus55, astra];
    const placement = opus55CodingAgentPlacement(records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.id).toBe("opus-5-5");
    expect(placement.rank).toBe(1);
    expect(placement.indexedCount).toBe(7);
    expect(placement.higher).toEqual([]);
    expect(placement.onCostFrontier).toBeTrue();
    expect(placement.dominators).toEqual([]);
    expect(placement.cheapestHigher).toBeUndefined();
    expect(placement.neighbors).toEqual([]);
    expect(placement.predecessor?.id).toBe("opus-5");
    expect(placement.costRank).toBe(1);
    expect(placement.costedCount).toBe(7);
    // Muse costs more than Sol and scores less, so the frontier skips it; Opus 5 sits behind Fable.
    expect(placement.frontierBelow.map(step => step.record.id))
      .toEqual(["fable", "gpt-6-astra", "gpt-6-sol", "gpt-5-6-luna"]);
    const [first] = placement.frontierBelow;
    expect(first?.pointsBelow).toBeCloseTo(65.99 - 62.22, 9);
    expect(first?.costMultiple).toBeCloseTo(12.39 / 13.04, 9);
    // The closest rows below are ranked by index alone, so Opus 5 appears here but not on the frontier.
    expect(placement.closestBelow.map(step => step.record.id))
      .toEqual(["fable", "gpt-6-astra", "opus-5", "gpt-6-sol"]);
    expect(placement.closestBelow[2]?.pointsBelow).toBeCloseTo(65.99 - 59.73, 9);
    expect(placement.closestBelow[2]?.costMultiple).toBeCloseTo(10.79 / 13.04, 9);
    expect(opus55CodingAgentPlacement(records, 1, 2)?.closestBelow.map(step => step.record.id))
      .toEqual(["fable", "gpt-6-astra"]);
    expect(opus55CodingAgentPlacement(records, 1, 0)?.closestBelow).toEqual([]);
    expect(placement.componentContrasts.map(contrast => contrast.metric))
      .toEqual(["deepSwe", "terminalBench", "sweAtlas"]);
    const deepSwe = placement.componentContrasts.find(contrast => contrast.metric === "deepSwe");
    expect(deepSwe?.bestOther.id).toBe("indexless");
    expect(deepSwe?.gapPoints).toBeCloseTo(68.44 - 80, 9);
    const terminal = placement.componentContrasts.find(contrast => contrast.metric === "terminalBench");
    expect(terminal?.bestOther.id).toBe("fable");
    expect(terminal?.gapPoints).toBeCloseTo(63.13 - 57.58, 9);
    const atlas = placement.componentContrasts.find(contrast => contrast.metric === "sweAtlas");
    expect(atlas?.bestOther.id).toBe("fable");
    expect(atlas?.gapPoints).toBeCloseTo(66.4 - 64.78, 9);
  });

  test("requires a costed Claude Code · Opus 5.5 row and rejects a bad window", () => {
    expect(opus55CodingAgentPlacement([opus5, fable])).toBeUndefined();
    expect(opus55CodingAgentPlacement([{ ...opus55, economics: { ...opus55.economics, costUsd: null } }])).toBeUndefined();
    expect(opus55CodingAgentPlacement([{ ...opus55, agent: "Cursor" }])).toBeUndefined();
    expect(() => opus55CodingAgentPlacement([opus55], 0)).toThrow(RangeError);
    expect(() => opus55CodingAgentPlacement([opus55], 1, -1)).toThrow(RangeError);
    expect(() => opus55CodingAgentPlacement([opus55], 1, 2.5)).toThrow(RangeError);
  });

  test("reports a non-leading row with an empty descent above it and a lower cost rank", () => {
    const cheaperHigher = codingAgentRecord({ aaIndex: 67, costUsd: 20, id: "twin" });
    const placement = opus55CodingAgentPlacement([opus55, cheaperHigher, fable, costless]);
    expect(placement?.rank).toBe(3);
    expect(placement?.costRank).toBe(2);
    expect(placement?.costedCount).toBe(3);
    expect(placement?.onCostFrontier).toBeTrue();
    expect(placement?.frontierBelow.map(step => step.record.id)).toEqual(["fable"]);
    expect(placement?.componentContrasts.find(contrast => contrast.metric === "deepSwe")?.bestOther.id).toBe("fable");
  });

  test("leaves out components no other row carries and frontier vertices without a cost", () => {
    const only = codingAgentRecord({ ...CLAUDE_OPUS_55_CODING_CONFIGURATION, deepSwe: null, id: "solo", sweAtlas: 70, terminalBench: 60 });
    const other = codingAgentRecord({ aaIndex: 40, deepSwe: 50, id: "other", sweAtlas: null, terminalBench: 30 });
    expect(componentContrasts([only, other], only).map(contrast => contrast.metric)).toEqual(["terminalBench"]);
    expect(componentContrasts([only], only)).toEqual([]);
    const placed = opus55CodingAgentPlacement([opus55, costless, fable]);
    if (placed === undefined) throw new Error("Opus 5.5 row must be placed.");
    expect(frontierDescent([opus55, costless, fable], placed.record).map(step => step.record.id)).toEqual(["fable"]);
    expect(frontierDescent([opus55], placed.record)).toEqual([]);
  });

  test("agrees with the chart frontier and ranking on the checked snapshot", () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const placement = opus55CodingAgentPlacement(parsed.value.records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.agent).toBe(CLAUDE_OPUS_55_CODING_CONFIGURATION.agent);
    expect(placement.record.model).toBe(CLAUDE_OPUS_55_CODING_CONFIGURATION.model);
    expect(placement.record.setting).toBe("max");
    expect(placement.rank).toBe(placement.higher.length + 1);
    expect(placement.predecessor?.model).toBe(CLAUDE_OPUS_5_CODING_CONFIGURATION.model);
    const frontier = aaIndexCostFrontier(parsed.value.records).map(point => point.record.id);
    for (const step of placement.frontierBelow) {
      expect(frontier).toContain(step.record.id);
      expect(step.pointsBelow).toBeGreaterThan(0);
      expect(step.costMultiple).toBeGreaterThan(0);
    }
    const costed = parsed.value.records.filter(record => (
      record.benchmarks.aaIndex !== null && record.economics.costUsd !== null && record.economics.costUsd > 0
    ));
    expect(placement.costedCount).toBe(costed.length);
    expect(placement.costRank).toBe(
      costed.filter(record => (record.economics.costUsd ?? 0) > placement.record.economics.costUsd).length + 1,
    );
  });
});
