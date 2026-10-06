import { describe, expect, test } from "bun:test";

import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";

import { parseArtificialAnalysisIntelligenceV43Snapshot } from "./artificial-analysis-intelligence-v4-3-data";
import { parseCodingAgentSnapshot } from "./coding-agent-data";
import { aaIndexCostFrontier } from "./coding-agent-snapshot-rows";
import {
  GEMINI_4_ARGON_CODING_CONFIGURATION,
  GEMINI_4_ARGON_CODING_MODEL,
  GEMINI_4_ARGON_INTELLIGENCE_SLUG,
  gemini4ArgonCodingAgentPlacement,
  gemini4ArgonIntelligencePlacement,
  higherCostShares,
  matchesGemini4ArgonCoding,
} from "./gemini-4-argon-placement";
import { codingAgentRecord } from "./grok-4-7-placement.test";
import { comparableIntelligenceRecords, paretoMembership } from "./intelligence-efficiency";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";
import type { CostedCodingAgentRecord } from "./snapshot-placement";

describe("Antigravity CLI · Gemini 4 Argon coding-agent placement", () => {
  const argon = codingAgentRecord({
    ...GEMINI_4_ARGON_CODING_CONFIGURATION,
    aaIndex: 63.76,
    costUsd: 5.84,
    deepSwe: 78.76,
    id: "argon",
    setting: "default",
    sweAtlas: 56.45,
    terminalBench: 56.06,
    totalTokens: 13_733_794,
  });
  const sonnetMax = codingAgentRecord({
    aaIndex: 68.36,
    agent: "Claude Code",
    costUsd: 14.19,
    deepSwe: 71.98,
    id: "sonnet-5-5-max",
    model: "Sonnet 5.5",
    providerId: "anthropic",
    setting: "max",
    sweAtlas: 66.94,
    terminalBench: 66.16,
  });
  const opusMax = codingAgentRecord({
    aaIndex: 65.99,
    agent: "Claude Code",
    costUsd: 13.04,
    deepSwe: 68.44,
    id: "opus-5-5",
    model: "Opus 5.5",
    providerId: "anthropic",
    setting: "max",
    sweAtlas: 66.4,
    terminalBench: 63.13,
  });
  const solXhigh = codingAgentRecord({
    aaIndex: 62.91,
    costUsd: 1.04,
    deepSwe: 73.16,
    id: "gpt-6-1-sol-xhigh",
    model: "GPT-6.1 Sol",
    providerId: "openai",
    setting: "xhigh",
    sweAtlas: 60.5,
    terminalBench: 55.05,
  });
  const sonnetXhigh = codingAgentRecord({
    aaIndex: 62.87,
    agent: "Claude Code",
    costUsd: 3.33,
    deepSwe: 68.44,
    id: "sonnet-5-5-xhigh",
    model: "Sonnet 5.5",
    providerId: "anthropic",
    setting: "xhigh",
    sweAtlas: 62.1,
    terminalBench: 58.08,
  });
  const flash = codingAgentRecord({
    aaIndex: 41.86,
    agent: "Antigravity SDK",
    costUsd: 2.47,
    deepSwe: 50,
    id: "gemini-3-8-flash",
    model: "Gemini 3.8 Flash",
    providerId: "google",
    setting: "high",
    sweAtlas: 40,
    terminalBench: 35,
  });
  const costless = codingAgentRecord({ aaIndex: 70, costUsd: null, id: "costless" });
  const indexless = codingAgentRecord({ aaIndex: null, costUsd: 1, deepSwe: 80, id: "indexless" });

  function asCosted(record: typeof argon): CostedCodingAgentRecord {
    if (record.benchmarks.aaIndex === null || record.economics.costUsd === null || record.economics.costUsd <= 0) {
      throw new Error("Fixture must carry an AA Index and a positive cost.");
    }
    return record as CostedCodingAgentRecord;
  }

  test("places the row third, ranks its cost, walks the frontier, and shares cost against the rows above", () => {
    const records = [solXhigh, flash, indexless, opusMax, argon, sonnetMax, sonnetXhigh];
    const placement = gemini4ArgonCodingAgentPlacement(records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.id).toBe("argon");
    expect(placement.rank).toBe(3);
    expect(placement.indexedCount).toBe(6);
    expect(placement.higher.map(record => record.id)).toEqual(["sonnet-5-5-max", "opus-5-5"]);
    expect(placement.onCostFrontier).toBeTrue();
    expect(placement.dominators).toEqual([]);
    expect(placement.predecessor).toBeUndefined();
    expect(placement.cheapestHigher?.record.id).toBe("opus-5-5");
    expect(placement.cheapestHigher?.multiple).toBeCloseTo(13.04 / 5.84, 9);
    expect(placement.costRank).toBe(3);
    expect(placement.costedCount).toBe(6);
    expect(placement.frontierBelow.map(step => step.record.id)).toEqual(["gpt-6-1-sol-xhigh"]);
    const [first] = placement.frontierBelow;
    expect(first?.pointsBelow).toBeCloseTo(63.76 - 62.91, 9);
    expect(first?.costMultiple).toBeCloseTo(1.04 / 5.84, 9);
    expect(placement.closestBelow.map(step => step.record.id))
      .toEqual(["gpt-6-1-sol-xhigh", "sonnet-5-5-xhigh", "gemini-3-8-flash"]);
    expect(gemini4ArgonCodingAgentPlacement(records, 1, 1)?.closestBelow.map(step => step.record.id))
      .toEqual(["gpt-6-1-sol-xhigh"]);
    expect(gemini4ArgonCodingAgentPlacement(records, 1, 0)?.closestBelow).toEqual([]);
    expect(placement.higherCostShares.map(share => share.record.id)).toEqual(["sonnet-5-5-max", "opus-5-5"]);
    expect(placement.higherCostShares[0]?.costShare).toBeCloseTo(5.84 / 14.19, 9);
    expect(placement.higherCostShares[0]?.pointsAbove).toBeCloseTo(68.36 - 63.76, 9);
    expect(placement.higherCostShares[1]?.costShare).toBeCloseTo(5.84 / 13.04, 9);
    expect(placement.otherProviderRows.map(record => record.id)).toEqual(["gemini-3-8-flash"]);
    expect(placement.componentContrasts.map(contrast => contrast.metric))
      .toEqual(["deepSwe", "terminalBench", "sweAtlas"]);
    const deepSwe = placement.componentContrasts.find(contrast => contrast.metric === "deepSwe");
    expect(deepSwe?.bestOther.id).toBe("indexless");
    expect(deepSwe?.gapPoints).toBeCloseTo(78.76 - 80, 9);
    const terminal = placement.componentContrasts.find(contrast => contrast.metric === "terminalBench");
    expect(terminal?.bestOther.id).toBe("sonnet-5-5-max");
    expect(terminal?.gapPoints).toBeCloseTo(56.06 - 66.16, 9);
    const atlas = placement.componentContrasts.find(contrast => contrast.metric === "sweAtlas");
    expect(atlas?.bestOther.id).toBe("sonnet-5-5-max");
    expect(atlas?.gapPoints).toBeCloseTo(56.45 - 66.94, 9);
  });

  test("shares cost only against costed rows that score higher, highest first", () => {
    const shares = higherCostShares([argon, sonnetMax, opusMax, solXhigh, costless, indexless], asCosted(argon));
    expect(shares.map(share => share.record.id)).toEqual(["sonnet-5-5-max", "opus-5-5"]);
    expect(higherCostShares([argon, solXhigh], asCosted(argon))).toEqual([]);
    const sameIndex = codingAgentRecord({ aaIndex: 63.76, costUsd: 1, id: "tie" });
    expect(higherCostShares([argon, sameIndex], asCosted(argon))).toEqual([]);
  });

  test("matches only the Antigravity CLI row for the model", () => {
    expect(matchesGemini4ArgonCoding(argon)).toBeTrue();
    expect(matchesGemini4ArgonCoding(flash)).toBeFalse();
    expect(matchesGemini4ArgonCoding({ ...argon, agent: "Antigravity SDK" })).toBeFalse();
    expect(matchesGemini4ArgonCoding({ ...argon, providerId: "anthropic" })).toBeFalse();
  });

  test("requires a costed Antigravity CLI · Gemini 4 Argon row and rejects a bad window or count", () => {
    expect(gemini4ArgonCodingAgentPlacement([opusMax, flash])).toBeUndefined();
    expect(gemini4ArgonCodingAgentPlacement([{ ...argon, economics: { ...argon.economics, costUsd: null } }]))
      .toBeUndefined();
    expect(gemini4ArgonCodingAgentPlacement([{ ...argon, agent: "Antigravity SDK" }])).toBeUndefined();
    expect(() => gemini4ArgonCodingAgentPlacement([argon], 0)).toThrow(RangeError);
    expect(() => gemini4ArgonCodingAgentPlacement([argon], 1, -1)).toThrow(RangeError);
    expect(() => gemini4ArgonCodingAgentPlacement([argon], 1, 2.5)).toThrow(RangeError);
  });

  test("reports a dominated row off the frontier with an empty descent", () => {
    const cheaperHigher = codingAgentRecord({ aaIndex: 70, costUsd: 2, id: "twin" });
    const placement = gemini4ArgonCodingAgentPlacement([argon, cheaperHigher, costless]);
    expect(placement?.rank).toBe(3);
    expect(placement?.higher.map(record => record.id)).toEqual(["costless", "twin"]);
    expect(placement?.higherCostShares.map(share => share.record.id)).toEqual(["twin"]);
    expect(placement?.costRank).toBe(1);
    expect(placement?.costedCount).toBe(2);
    expect(placement?.onCostFrontier).toBeFalse();
    expect(placement?.dominators.map(record => record.id)).toEqual(["twin"]);
    expect(placement?.frontierBelow).toEqual([]);
    expect(placement?.higherCostShares[0]?.costShare).toBeCloseTo(5.84 / 2, 9);
    expect(placement?.otherProviderRows).toEqual([]);
  });

  test("agrees with the chart frontier and ranking on the checked snapshot", () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const placement = gemini4ArgonCodingAgentPlacement(parsed.value.records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.agent).toBe(GEMINI_4_ARGON_CODING_CONFIGURATION.agent);
    expect(placement.record.model).toBe(GEMINI_4_ARGON_CODING_CONFIGURATION.model);
    expect(placement.record.setting).toBe("default");
    expect(placement.rank).toBe(3);
    expect(placement.rank).toBe(placement.higher.length + 1);
    expect(placement.predecessor).toBeUndefined();
    expect(placement.higherCostShares).toHaveLength(placement.higher.length);
    for (const share of placement.higherCostShares) {
      expect(share.costShare).toBeGreaterThan(0);
      expect(share.costShare).toBeLessThan(0.5);
      expect(share.pointsAbove).toBeGreaterThan(0);
    }
    const frontier = aaIndexCostFrontier(parsed.value.records).map(point => point.record.id);
    expect(frontier).toContain(placement.record.id);
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
    const deepSwe = placement.componentContrasts.find(contrast => contrast.metric === "deepSwe");
    expect(deepSwe?.gapPoints).toBeGreaterThan(0);
    for (const row of placement.otherProviderRows) {
      expect(row.providerId).toBe(GEMINI_4_ARGON_CODING_MODEL.providerId);
      expect(row.id).not.toBe(placement.record.id);
    }
  });
});

describe("Gemini 4 Argon Intelligence Index placement", () => {
  test("places the headline slug and leaves a missing or costless row undefined", () => {
    const headline = intelligenceRecord(GEMINI_4_ARGON_INTELLIGENCE_SLUG, 52.56, 1.99);
    const opus = intelligenceRecord("claude-opus-5-5", 57.62, 5.98);
    const placement = gemini4ArgonIntelligencePlacement([headline, opus]);
    expect(placement?.record.slug).toBe(GEMINI_4_ARGON_INTELLIGENCE_SLUG);
    expect(placement?.rank).toBe(2);
    expect(gemini4ArgonIntelligencePlacement([opus])).toBeUndefined();
    expect(gemini4ArgonIntelligencePlacement([intelligenceRecord(GEMINI_4_ARGON_INTELLIGENCE_SLUG, 52.56, null)]))
      .toBeUndefined();
    expect(() => gemini4ArgonIntelligencePlacement([headline], 0)).toThrow(RangeError);
  });

  test("agrees with the comparable cohort on the checked snapshot", () => {
    const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
    if (!parsed.ok) throw parsed.error;
    const placement = gemini4ArgonIntelligencePlacement(parsed.value.records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    const cohort = comparableIntelligenceRecords(parsed.value.records);
    expect(placement.cohortSize).toBe(cohort.length);
    expect(placement.record.slug).toBe(GEMINI_4_ARGON_INTELLIGENCE_SLUG);
    expect(placement.rank).toBe(
      cohort.filter(record => record.intelligenceIndex > placement.record.intelligenceIndex).length + 1,
    );
    expect(placement.onCostFrontier)
      .toBe(paretoMembership(cohort, "costUsdPerTask").has(placement.record.id));
    expect(placement.record.effort?.slug).toBe("high");
  });
});
