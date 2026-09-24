import { describe, expect, test } from "bun:test";

import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";

import { parseArtificialAnalysisIntelligenceV43Snapshot } from "./artificial-analysis-intelligence-v4-3-data";
import { parseCodingAgentSnapshot } from "./coding-agent-data";
import { aaIndexCostFrontier } from "./coding-agent-snapshot-rows";
import {
  GPT_56_SOL_CODING_CONFIGURATION,
  GPT_6_SOL_CODING_CONFIGURATION,
  GPT_6_SOL_INTELLIGENCE_SLUG,
  effortLadder,
  solCodingAgentPlacement,
  solCodingAgentRecords,
  solIntelligencePlacement,
} from "./gpt-6-sol-placement";
import { codingAgentRecord } from "./grok-4-7-placement.test";
import { comparableIntelligenceRecords, paretoMembership } from "./intelligence-efficiency";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";

const sol = codingAgentRecord({
  ...GPT_6_SOL_CODING_CONFIGURATION,
  aaIndex: 56.66,
  costUsd: 2.99,
  deepSwe: 69.0,
  id: "gpt-6-sol",
  sweAtlas: 57.5,
  terminalBench: 43.4,
  totalTokens: 9_840_000,
});
const sol56 = codingAgentRecord({
  ...GPT_56_SOL_CODING_CONFIGURATION,
  aaIndex: 54.56,
  costUsd: 6.35,
  deepSwe: 72.3,
  id: "gpt-5-6-sol",
  sweAtlas: 54.0,
  terminalBench: 37.4,
  totalTokens: 10_170_000,
});
const grok = codingAgentRecord({
  aaIndex: 56.27, agent: "Grok Build", costUsd: 8.82, deepSwe: 72.6, id: "grok-4-7", model: "Grok 4.7", providerId: "xai", setting: "xhigh", sweAtlas: 62.9, terminalBench: 33.3,
});
const fusion = codingAgentRecord({
  aaIndex: 58.89, agent: "Devin Fusion CLI", costUsd: 4.54, deepSwe: 67.3, id: "fusion-astra", model: "GPT-6 Astra XHigh + SWE-2 Medium", providerId: "cognition", setting: "default", sweAtlas: 59.4, terminalBench: 50,
});
const astra = codingAgentRecord({
  aaIndex: 61.65, costUsd: 7.47, deepSwe: 67.6, id: "gpt-6-astra", model: "GPT-6 Astra", sweAtlas: 61.8, terminalBench: 55.6,
});
const kimi = codingAgentRecord({
  aaIndex: 51.93, agent: "Kimi Code CLI", costUsd: 5.05, deepSwe: 62.5, id: "kimi", model: "Kimi K3", providerId: "moonshot_ai", setting: "default", sweAtlas: 66.1, terminalBench: 27.3,
});
const luna = codingAgentRecord({
  aaIndex: 41.07, costUsd: 0.18, deepSwe: 63.7, id: "gpt-6-luna", model: "GPT-6 Luna", sweAtlas: 44.4, terminalBench: 15.2,
});

describe("GPT-6 Sol coding-agent placement", () => {
  test("finds only Codex · GPT-6 Sol rows with an index and a cost", () => {
    const solInCursor = codingAgentRecord({ ...GPT_6_SOL_CODING_CONFIGURATION, agent: "Cursor", id: "sol-cursor" });
    const solHigh = codingAgentRecord({ ...GPT_6_SOL_CODING_CONFIGURATION, aaIndex: 52, id: "sol-high", setting: "high" });
    const costless = codingAgentRecord({ ...GPT_6_SOL_CODING_CONFIGURATION, costUsd: null, id: "sol-free" });
    expect(solCodingAgentRecords([solInCursor, costless, solHigh, sol, sol56]).map(record => record.id))
      .toEqual(["gpt-6-sol", "sol-high"]);
    expect(solCodingAgentPlacement([sol56, grok])).toBeUndefined();
  });

  test("ranks the row, finds the cheapest higher row, and lists one-point neighbors", () => {
    const placement = solCodingAgentPlacement([kimi, grok, astra, sol, fusion, sol56, luna]);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.id).toBe("gpt-6-sol");
    expect(placement.indexedCount).toBe(7);
    expect(placement.rank).toBe(3);
    expect(placement.higher.map(record => record.id)).toEqual(["gpt-6-astra", "fusion-astra"]);
    expect(placement.dominators).toEqual([]);
    expect(placement.onCostFrontier).toBeTrue();
    expect(placement.cheapestHigher?.record.id).toBe("fusion-astra");
    expect(placement.cheapestHigher?.multiple).toBeCloseTo(4.54 / 2.99, 9);
    expect(placement.neighbors.map(record => record.id)).toEqual(["grok-4-7"]);
    expect(placement.predecessor?.id).toBe("gpt-5-6-sol");
    expect(placement.lowerIndexHigherTerminal).toEqual([]);
    const [deepSwe, terminalBench, sweAtlas] = placement.components;
    expect(deepSwe).toMatchObject({ count: 7, rank: 3, value: 69.0 });
    expect(deepSwe?.leader.id).toBe("grok-4-7");
    expect(terminalBench).toMatchObject({ count: 7, rank: 3, value: 43.4 });
    expect(sweAtlas).toMatchObject({ count: 7, rank: 5, value: 57.5 });
    expect(sweAtlas?.leader.id).toBe("kimi");
  });

  test("leaves the frontier when a cheaper row scores at least as high", () => {
    const cheaperTwin = { ...grok, economics: { ...grok.economics, costUsd: 2 }, id: "cheaper", benchmarks: { ...grok.benchmarks, aaIndex: 56.66 } };
    const placement = solCodingAgentPlacement([sol, cheaperTwin, luna]);
    expect(placement?.onCostFrontier).toBeFalse();
    expect(placement?.dominators.map(record => record.id)).toEqual(["cheaper"]);
    expect(placement?.rank).toBe(1);
    expect(placement?.cheapestHigher).toBeUndefined();
    expect(placement?.neighbors.map(record => record.id)).toEqual(["cheaper"]);
  });

  test("matches a GPT-5.6 Sol predecessor only at the same setting", () => {
    const sol56High = { ...sol56, id: "gpt-5-6-sol-high", setting: "high" };
    expect(solCodingAgentPlacement([sol, sol56High])?.predecessor).toBeUndefined();
    expect(solCodingAgentPlacement([sol, sol56])?.predecessor?.id).toBe("gpt-5-6-sol");
  });

  test("agrees with the chart frontier and ranking on the checked snapshot", () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const placement = solCodingAgentPlacement(parsed.value.records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.setting).toBe("max");
    expect(placement.onCostFrontier)
      .toBe(aaIndexCostFrontier(parsed.value.records).some(point => point.record.id === placement.record.id));
    expect(placement.rank).toBe(placement.higher.length + 1);
    expect(placement.dominators.length === 0).toBe(placement.onCostFrontier);
    for (const neighbor of placement.neighbors) {
      expect(Math.abs(neighbor.benchmarks.aaIndex - placement.record.benchmarks.aaIndex)).toBeLessThanOrEqual(1);
    }
    if (placement.cheapestHigher !== undefined) {
      for (const candidate of placement.higher) {
        if (candidate.economics.costUsd === null) continue;
        expect(candidate.economics.costUsd).toBeGreaterThanOrEqual(placement.cheapestHigher.record.economics.costUsd);
      }
    }
  });
});

function solRelease(slug: string, index: number, cost: number | null, tokens = 10_000) {
  const record = intelligenceRecord(slug, index, cost, tokens);
  return { ...record, release: { name: "GPT-6 Sol", slug: GPT_6_SOL_INTELLIGENCE_SLUG } };
}

const solMax = solRelease(GPT_6_SOL_INTELLIGENCE_SLUG, 47.53, 1.06, 31_238);
const solXhigh = solRelease("gpt-6-sol-xhigh", 44.1, 0.53, 16_013);
const solHigh = solRelease("gpt-6-sol-high", 42.82, 0.37, 10_232);
const solNonReasoning = solRelease("gpt-6-sol-non-reasoning", 28.09, 0.33, 4_912);
const solLow = solRelease("gpt-6-sol-low", 33.9, 0.13, 3_358);
const opusMedium = intelligenceRecord("claude-opus-5-5-medium", 51.24, 1.34);
const museMax = intelligenceRecord("muse-spark-1-3", 48.09, 1.6);
const fableLow = intelligenceRecord("claude-fable-5-1-low", 46.82, 2.37);
const mimo = intelligenceRecord("mimo-v2-6-pro", 46.32, 0.13);
const costless = intelligenceRecord("costless", 70, null);

describe("GPT-6 Sol Intelligence Index placement", () => {
  test("requires the max row inside the comparable cohort", () => {
    expect(solIntelligencePlacement([solXhigh, opusMedium])).toBeUndefined();
    expect(solIntelligencePlacement([solRelease(GPT_6_SOL_INTELLIGENCE_SLUG, 47, null)])).toBeUndefined();
    expect(() => solIntelligencePlacement([solMax], 0)).toThrow(RangeError);
  });

  test("reports rank, frontier, neighbors, siblings, and the effort ladder", () => {
    const placement = solIntelligencePlacement([
      mimo, solHigh, opusMedium, solMax, museMax, solNonReasoning, fableLow, solXhigh, costless, solLow,
    ]);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.cohortSize).toBe(9);
    expect(placement.rank).toBe(3);
    expect(placement.leader.slug).toBe("claude-opus-5-5-medium");
    expect(placement.onCostFrontier).toBeTrue();
    expect(placement.dominators).toEqual([]);
    expect(placement.cheapestHigher?.record.slug).toBe("claude-opus-5-5-medium");
    expect(placement.cheapestHigher?.multiple).toBeCloseTo(1.34 / 1.06, 9);
    expect(placement.neighbors.map(record => record.slug)).toEqual(["muse-spark-1-3", "claude-fable-5-1-low"]);
    expect(placement.siblings.map(record => record.slug))
      .toEqual(["gpt-6-sol-xhigh", "gpt-6-sol-high", "gpt-6-sol-low", "gpt-6-sol-non-reasoning"]);
    expect(placement.effortLadder.map(step => step.record.slug))
      .toEqual(["gpt-6-sol-low", "gpt-6-sol-non-reasoning", "gpt-6-sol-high", "gpt-6-sol-xhigh", "gpt-6-sol"]);
    const [low, nonReasoning, high, , max] = placement.effortLadder;
    expect(low).toMatchObject({ costMultipleOverCheaper: null, pointsOverCheaper: null });
    // A costlier level may score lower; the ladder prints that step as negative points.
    expect(nonReasoning?.pointsOverCheaper).toBeCloseTo(28.09 - 33.9, 9);
    expect(nonReasoning?.costMultipleOverCheaper).toBeCloseTo(0.33 / 0.13, 9);
    expect(high?.pointsOverCheaper).toBeCloseTo(42.82 - 28.09, 9);
    expect(max?.pointsOverCheaper).toBeCloseTo(47.53 - 44.1, 9);
    expect(max?.costMultipleOverCheaper).toBeCloseTo(1.06 / 0.53, 9);
  });

  test("leaves the frontier when a cheaper configuration scores as high", () => {
    const cheaperTwin = intelligenceRecord("twin", 47.53, 0.9);
    const placement = solIntelligencePlacement([solMax, cheaperTwin, opusMedium]);
    expect(placement?.onCostFrontier).toBeFalse();
    expect(placement?.dominators.map(record => record.slug)).toEqual(["twin"]);
    expect(placement?.siblings).toEqual([]);
    expect(placement?.effortLadder.map(step => step.record.slug)).toEqual([GPT_6_SOL_INTELLIGENCE_SLUG]);
  });

  test("orders the ladder cheapest first regardless of input order", () => {
    const ladder = effortLadder(solMax, [solLow, solXhigh, solHigh]);
    expect(ladder.map(step => step.record.slug)).toEqual(["gpt-6-sol-low", "gpt-6-sol-high", "gpt-6-sol-xhigh", "gpt-6-sol"]);
    for (let position = 1; position < ladder.length; position += 1) {
      const step = ladder[position];
      const previous = ladder[position - 1];
      if (step === undefined || previous === undefined) throw new Error("ladder positions exist");
      expect(comparableTaskCost(step.record)).toBeGreaterThanOrEqual(comparableTaskCost(previous.record));
      expect(step.pointsOverCheaper).toBeCloseTo(step.record.intelligenceIndex - previous.record.intelligenceIndex, 9);
    }
  });

  test("matches the shared Pareto membership and the effort rows on the checked snapshot", () => {
    const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
    if (!parsed.ok) throw parsed.error;
    const placement = solIntelligencePlacement(parsed.value.records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    const cohort = comparableIntelligenceRecords(parsed.value.records);
    expect(placement.cohortSize).toBe(cohort.length);
    expect(placement.onCostFrontier)
      .toBe(paretoMembership(cohort, "costUsdPerTask").has(placement.record.id));
    expect(placement.record.release.slug).toBe(GPT_6_SOL_INTELLIGENCE_SLUG);
    expect(placement.record.effort?.slug).toBe("max");
    const releaseRows = cohort.filter(record => record.release.slug === GPT_6_SOL_INTELLIGENCE_SLUG);
    expect(placement.effortLadder.length).toBe(releaseRows.length);
    expect(placement.siblings.length).toBe(releaseRows.length - 1);
    expect(placement.effortLadder.some(step => step.record.id === placement.record.id)).toBeTrue();
  });
});
