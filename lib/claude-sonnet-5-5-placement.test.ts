import { describe, expect, test } from "bun:test";

import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";

import { parseArtificialAnalysisIntelligenceV43Snapshot } from "./artificial-analysis-intelligence-v4-3-data";
import {
  CLAUDE_OPUS_55_CODING_CONFIGURATION,
  CLAUDE_SONNET_55_CODING_CONFIGURATION,
  CLAUDE_SONNET_55_CODING_MODEL,
  CLAUDE_SONNET_55_INTELLIGENCE_SLUG,
  codingEffortLadder,
  sonnet55CodingAgentPlacement,
  sonnet55CodingAgentRows,
  sonnet55IntelligencePlacement,
} from "./claude-sonnet-5-5-placement";
import { parseCodingAgentSnapshot } from "./coding-agent-data";
import { aaIndexCostFrontier } from "./coding-agent-snapshot-rows";
import { codingAgentRecord } from "./grok-4-7-placement.test";
import { comparableIntelligenceRecords, paretoMembership } from "./intelligence-efficiency";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";

describe("Claude Code · Sonnet 5.5 coding-agent placement", () => {
  const sonnetMax = codingAgentRecord({
    ...CLAUDE_SONNET_55_CODING_CONFIGURATION,
    aaIndex: 68.36,
    costUsd: 14.19,
    deepSwe: 71.98,
    id: "sonnet-5-5-max",
    setting: "max",
    sweAtlas: 66.94,
    terminalBench: 66.16,
    totalTokens: 27_742_337,
  });
  const sonnetXhigh = codingAgentRecord({
    ...CLAUDE_SONNET_55_CODING_CONFIGURATION,
    aaIndex: 62.87,
    costUsd: 3.33,
    deepSwe: 68.44,
    id: "sonnet-5-5-xhigh",
    setting: "xhigh",
    sweAtlas: 62.1,
    terminalBench: 58.08,
  });
  const sonnetHigh = codingAgentRecord({
    ...CLAUDE_SONNET_55_CODING_CONFIGURATION,
    aaIndex: 55.01,
    costUsd: 1.24,
    id: "sonnet-5-5-high",
    setting: "high",
  });
  const sonnetMedium = codingAgentRecord({
    ...CLAUDE_SONNET_55_CODING_CONFIGURATION,
    aaIndex: 45.88,
    costUsd: 0.619,
    id: "sonnet-5-5-medium",
    setting: "medium",
  });
  const sonnetLow = codingAgentRecord({
    ...CLAUDE_SONNET_55_CODING_CONFIGURATION,
    aaIndex: 42.06,
    costUsd: 0.483,
    id: "sonnet-5-5-low",
    setting: "low",
  });
  const opusMax = codingAgentRecord({
    ...CLAUDE_OPUS_55_CODING_CONFIGURATION,
    aaIndex: 65.99,
    costUsd: 13.04,
    deepSwe: 68.44,
    id: "opus-5-5",
    sweAtlas: 66.4,
    terminalBench: 63.13,
  });
  const argon = codingAgentRecord({
    aaIndex: 63.76,
    agent: "Antigravity CLI",
    costUsd: 5.84,
    deepSwe: 78.76,
    id: "argon",
    model: "Gemini 4 Argon",
    providerId: "google",
    setting: "default",
    sweAtlas: 56.45,
    terminalBench: 56.06,
  });
  const sol = codingAgentRecord({
    aaIndex: 56.66,
    costUsd: 2.99,
    deepSwe: 69.03,
    id: "gpt-6-sol",
    model: "GPT-6 Sol",
    providerId: "openai",
    sweAtlas: 57.53,
    terminalBench: 43.43,
  });
  const costless = codingAgentRecord({ aaIndex: 70, costUsd: null, id: "costless" });
  const indexless = codingAgentRecord({ aaIndex: null, costUsd: 1, deepSwe: 80, id: "indexless" });

  test("places the leader, ranks its cost, walks the frontier, and contrasts each component", () => {
    const records = [sol, argon, indexless, sonnetLow, opusMax, sonnetMax, sonnetXhigh];
    const placement = sonnet55CodingAgentPlacement(records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.id).toBe("sonnet-5-5-max");
    expect(placement.rank).toBe(1);
    expect(placement.indexedCount).toBe(6);
    expect(placement.higher).toEqual([]);
    expect(placement.onCostFrontier).toBeTrue();
    expect(placement.dominators).toEqual([]);
    expect(placement.predecessor).toBeUndefined();
    expect(placement.sameHarnessOpus?.id).toBe("opus-5-5");
    expect(placement.costRank).toBe(1);
    expect(placement.costedCount).toBe(6);
    expect(placement.frontierBelow.map(step => step.record.id))
      .toEqual(["opus-5-5", "argon", "sonnet-5-5-xhigh", "gpt-6-sol", "sonnet-5-5-low"]);
    const [first] = placement.frontierBelow;
    expect(first?.pointsBelow).toBeCloseTo(68.36 - 65.99, 9);
    expect(first?.costMultiple).toBeCloseTo(13.04 / 14.19, 9);
    expect(placement.closestBelow.map(step => step.record.id))
      .toEqual(["opus-5-5", "argon", "sonnet-5-5-xhigh", "gpt-6-sol"]);
    expect(sonnet55CodingAgentPlacement(records, 1, 2)?.closestBelow.map(step => step.record.id))
      .toEqual(["opus-5-5", "argon"]);
    expect(sonnet55CodingAgentPlacement(records, 1, 0)?.closestBelow).toEqual([]);
    expect(placement.componentContrasts.map(contrast => contrast.metric))
      .toEqual(["deepSwe", "terminalBench", "sweAtlas"]);
    const deepSwe = placement.componentContrasts.find(contrast => contrast.metric === "deepSwe");
    expect(deepSwe?.bestOther.id).toBe("indexless");
    expect(deepSwe?.gapPoints).toBeCloseTo(71.98 - 80, 9);
    const terminal = placement.componentContrasts.find(contrast => contrast.metric === "terminalBench");
    expect(terminal?.bestOther.id).toBe("opus-5-5");
    expect(terminal?.gapPoints).toBeCloseTo(66.16 - 63.13, 9);
    const atlas = placement.componentContrasts.find(contrast => contrast.metric === "sweAtlas");
    expect(atlas?.bestOther.id).toBe("opus-5-5");
    expect(atlas?.gapPoints).toBeCloseTo(66.94 - 66.4, 9);
  });

  test("orders the effort ladder cheapest first and states what each step buys", () => {
    const ladder = codingEffortLadder([sonnetMax, sonnetLow, sonnetXhigh, sonnetHigh, sonnetMedium]);
    expect(ladder.map(step => step.record.setting)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(ladder[0]?.pointsOverCheaper).toBeNull();
    expect(ladder[0]?.costMultipleOverCheaper).toBeNull();
    expect(ladder[1]?.pointsOverCheaper).toBeCloseTo(45.88 - 42.06, 9);
    expect(ladder[1]?.costMultipleOverCheaper).toBeCloseTo(0.619 / 0.483, 9);
    expect(ladder[4]?.pointsOverCheaper).toBeCloseTo(68.36 - 62.87, 9);
    expect(ladder[4]?.costMultipleOverCheaper).toBeCloseTo(14.19 / 3.33, 9);

    const placement = sonnet55CodingAgentPlacement([sonnetMax, sonnetXhigh, sonnetHigh, sonnetMedium, sonnetLow, opusMax]);
    expect(placement?.effortLadder.map(step => step.record.setting))
      .toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  test("lists Sonnet 5.5 rows in any harness and finds Opus at the same setting", () => {
    const inCursor = codingAgentRecord({
      ...CLAUDE_SONNET_55_CODING_MODEL,
      aaIndex: 50,
      agent: "Cursor",
      costUsd: 8,
      id: "sonnet-cursor",
    });
    expect(sonnet55CodingAgentRows([opusMax, inCursor, sonnetMax, sol]).map(record => record.id))
      .toEqual(["sonnet-5-5-max", "sonnet-cursor"]);
    expect(sonnet55CodingAgentRows([opusMax, sol])).toEqual([]);

    const opusXhigh = codingAgentRecord({
      ...CLAUDE_OPUS_55_CODING_CONFIGURATION,
      aaIndex: 60,
      costUsd: 8,
      id: "opus-xhigh",
      setting: "xhigh",
    });
    const atXhigh = sonnet55CodingAgentPlacement([sonnetXhigh, opusXhigh, opusMax]);
    expect(atXhigh?.record.id).toBe("sonnet-5-5-xhigh");
    expect(atXhigh?.sameHarnessOpus?.id).toBe("opus-xhigh");
    expect(sonnet55CodingAgentPlacement([sonnetXhigh, opusMax])?.sameHarnessOpus).toBeUndefined();
  });

  test("requires a costed Claude Code · Sonnet 5.5 row and rejects a bad window or count", () => {
    expect(sonnet55CodingAgentPlacement([opusMax, sol])).toBeUndefined();
    expect(sonnet55CodingAgentPlacement([{ ...sonnetMax, economics: { ...sonnetMax.economics, costUsd: null } }]))
      .toBeUndefined();
    expect(sonnet55CodingAgentPlacement([{ ...sonnetMax, agent: "Cursor" }])).toBeUndefined();
    expect(() => sonnet55CodingAgentPlacement([sonnetMax], 0)).toThrow(RangeError);
    expect(() => sonnet55CodingAgentPlacement([sonnetMax], 1, -1)).toThrow(RangeError);
    expect(() => sonnet55CodingAgentPlacement([sonnetMax], 1, 2.5)).toThrow(RangeError);
  });

  test("reports a non-leading row with a lower cost rank and an empty descent above it", () => {
    const cheaperHigher = codingAgentRecord({ aaIndex: 70, costUsd: 20, id: "twin" });
    const placement = sonnet55CodingAgentPlacement([sonnetMax, cheaperHigher, argon, costless]);
    expect(placement?.rank).toBe(3);
    expect(placement?.costRank).toBe(2);
    expect(placement?.costedCount).toBe(3);
    expect(placement?.onCostFrontier).toBeTrue();
    expect(placement?.frontierBelow.map(step => step.record.id)).toEqual(["argon"]);
  });

  test("agrees with the chart frontier and ranking on the checked snapshot", () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const placement = sonnet55CodingAgentPlacement(parsed.value.records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.agent).toBe(CLAUDE_SONNET_55_CODING_CONFIGURATION.agent);
    expect(placement.record.model).toBe(CLAUDE_SONNET_55_CODING_CONFIGURATION.model);
    expect(placement.record.setting).toBe("max");
    expect(placement.rank).toBe(1);
    expect(placement.rank).toBe(placement.higher.length + 1);
    expect(placement.predecessor).toBeUndefined();
    expect(placement.sameHarnessOpus?.model).toBe(CLAUDE_OPUS_55_CODING_CONFIGURATION.model);
    expect(placement.sameHarnessOpus?.setting).toBe(placement.record.setting);
    expect(placement.effortLadder.map(step => step.record.setting))
      .toEqual(["low", "medium", "high", "xhigh", "max"]);
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
    expect(placement.costRank).toBe(1);
    for (const row of sonnet55CodingAgentRows(parsed.value.records)) {
      expect(row.model).toBe(CLAUDE_SONNET_55_CODING_MODEL.model);
      expect(row.providerId).toBe(CLAUDE_SONNET_55_CODING_MODEL.providerId);
    }
  });
});

describe("Claude Sonnet 5.5 Intelligence Index placement", () => {
  test("places the headline slug and leaves a missing or costless row undefined", () => {
    const headline = intelligenceRecord(CLAUDE_SONNET_55_INTELLIGENCE_SLUG, 56, 7.67);
    const opus = intelligenceRecord("claude-opus-5-5", 57.62, 5.98);
    const placement = sonnet55IntelligencePlacement([headline, opus]);
    expect(placement?.record.slug).toBe(CLAUDE_SONNET_55_INTELLIGENCE_SLUG);
    expect(placement?.rank).toBe(2);
    expect(sonnet55IntelligencePlacement([opus])).toBeUndefined();
    expect(sonnet55IntelligencePlacement([intelligenceRecord(CLAUDE_SONNET_55_INTELLIGENCE_SLUG, 56, null)]))
      .toBeUndefined();
    expect(() => sonnet55IntelligencePlacement([headline], 0)).toThrow(RangeError);
  });

  test("agrees with the comparable cohort on the checked snapshot", () => {
    const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
    if (!parsed.ok) throw parsed.error;
    const placement = sonnet55IntelligencePlacement(parsed.value.records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    const cohort = comparableIntelligenceRecords(parsed.value.records);
    expect(placement.cohortSize).toBe(cohort.length);
    expect(placement.record.slug).toBe(CLAUDE_SONNET_55_INTELLIGENCE_SLUG);
    expect(placement.rank).toBe(
      cohort.filter(record => record.intelligenceIndex > placement.record.intelligenceIndex).length + 1,
    );
    expect(placement.onCostFrontier)
      .toBe(paretoMembership(cohort, "costUsdPerTask").has(placement.record.id));
    expect(placement.record.effort?.slug).toBe("max");
  });
});
