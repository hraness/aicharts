import { describe, expect, test } from "bun:test";

import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";

import { parseArtificialAnalysisIntelligenceV43Snapshot } from "./artificial-analysis-intelligence-v4-3-data";
import { parseCodingAgentSnapshot } from "./coding-agent-data";
import { aaIndexCostFrontier } from "./coding-agent-snapshot-rows";
import {
  CLAUDE_OPUS_55_CODING_CONFIGURATION,
  CLAUDE_SONNET_55_CODING_CONFIGURATION,
  GPT_6_1_SOL_CODING_CONFIGURATION,
  GPT_6_1_SOL_INTELLIGENCE_SLUG,
  gpt61SolCodingAgentPlacement,
  gpt61SolCodingAgentRecords,
  gpt61SolCodingSettings,
  gpt61SolIntelligencePlacement,
  matchesGpt61SolCoding,
} from "./gpt-6-1-sol-placement";
import { GPT_6_SOL_CODING_CONFIGURATION } from "./gpt-6-sol-placement";
import { codingAgentRecord } from "./grok-4-7-placement.test";
import { comparableIntelligenceRecords, paretoMembership } from "./intelligence-efficiency";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";

function settingRow(
  setting: string,
  settingRank: number,
  aaIndex: number,
  costUsd: number,
  id = `gpt-6-1-sol-${setting}`,
) {
  return {
    ...codingAgentRecord({
      ...GPT_6_1_SOL_CODING_CONFIGURATION,
      aaIndex,
      costUsd,
      id,
      setting,
    }),
    settingRank,
  };
}

const xhigh = settingRow("xhigh", 5, 62.91, 1.04);
const medium = settingRow("medium", 3, 61.41, 0.70);
const high = settingRow("high", 4, 60.15, 0.89);
const max = settingRow("max", 6, 60.15, 1.55);
const low = settingRow("low", 2, 57.22, 0.50);
const sonnet = codingAgentRecord({
  ...CLAUDE_SONNET_55_CODING_CONFIGURATION,
  aaIndex: 68.36,
  costUsd: 14.19,
  id: "sonnet-max",
});
const opus = codingAgentRecord({
  ...CLAUDE_OPUS_55_CODING_CONFIGURATION,
  aaIndex: 65.99,
  costUsd: 13.04,
  id: "opus-max",
});
const sol = codingAgentRecord({
  ...GPT_6_SOL_CODING_CONFIGURATION,
  aaIndex: 56.66,
  costUsd: 2.99,
  id: "gpt-6-sol-max",
});
const luna = codingAgentRecord({
  aaIndex: 41.07,
  costUsd: 0.18,
  id: "gpt-6-luna",
  model: "GPT-6 Luna",
});

describe("GPT-6.1 Sol coding-agent placement", () => {
  test("finds only Codex · GPT-6.1 Sol rows with an index and a cost", () => {
    const inCursor = codingAgentRecord({
      ...GPT_6_1_SOL_CODING_CONFIGURATION,
      agent: "Cursor",
      id: "sol-cursor",
    });
    const costless = settingRow("high", 4, 60, 0);
    const unpriced = {
      ...settingRow("low", 2, 50, 1),
      economics: { durationSeconds: 1_000, costUsd: null },
    };
    expect(gpt61SolCodingAgentRecords([inCursor, costless, unpriced, xhigh, medium, sol]).map(record => record.id))
      .toEqual(["gpt-6-1-sol-xhigh", "gpt-6-1-sol-medium"]);
    expect(gpt61SolCodingAgentPlacement([sonnet, opus, sol])).toBeUndefined();
    expect(matchesGpt61SolCoding(xhigh)).toBeTrue();
    expect(matchesGpt61SolCoding(sol)).toBeFalse();
  });

  test("places the highest-index setting, not max, and orders the effort table by setting rank", () => {
    const placement = gpt61SolCodingAgentPlacement([luna, max, high, sonnet, low, xhigh, medium, opus, sol]);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.id).toBe(xhigh.id);
    expect(placement.record.setting).toBe("xhigh");
    expect(placement.indexedCount).toBe(9);
    expect(placement.rank).toBe(3);
    expect(placement.higher.map(record => record.id)).toEqual(["sonnet-max", "opus-max"]);
    expect(placement.settings.map(record => record.setting)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(placement.predecessor).toBeUndefined();
    expect(placement.previousGeneration?.id).toBe(sol.id);
    expect(placement.contrastRows.map(record => record.id)).toEqual(["sonnet-max", "opus-max"]);
    expect(placement.onCostFrontier).toBeTrue();
    expect(placement.settingsOnFrontier.map(record => record.setting)).toEqual(["low", "medium", "xhigh"]);
    expect(placement.costRank).toBe(5);
    expect(placement.costedCount).toBe(9);
  });

  test("matches a GPT-6 Sol predecessor only at the placed setting", () => {
    const solXhigh = codingAgentRecord({
      ...GPT_6_SOL_CODING_CONFIGURATION,
      aaIndex: 50,
      costUsd: 2,
      id: "gpt-6-sol-xhigh",
      setting: "xhigh",
    });
    expect(gpt61SolCodingAgentPlacement([xhigh, sol])?.predecessor).toBeUndefined();
    expect(gpt61SolCodingAgentPlacement([xhigh, solXhigh])?.predecessor?.id).toBe("gpt-6-sol-xhigh");
  });

  test("leaves the frontier when a cheaper row scores at least as high", () => {
    const cheaperTwin = codingAgentRecord({
      aaIndex: 62.91,
      agent: "Twin Harness",
      costUsd: 0.8,
      id: "cheaper",
      model: "Twin",
    });
    const placement = gpt61SolCodingAgentPlacement([xhigh, cheaperTwin, luna]);
    expect(placement?.record.id).toBe(xhigh.id);
    expect(placement?.onCostFrontier).toBeFalse();
    expect(placement?.dominators.map(record => record.id)).toEqual(["cheaper"]);
    expect(placement?.settingsOnFrontier).toEqual([]);
  });

  test("agrees with the chart frontier and ranking on the checked snapshot", () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const placement = gpt61SolCodingAgentPlacement(parsed.value.records);
    if (placement === undefined) {
      expect(parsed.value.records.some(matchesGpt61SolCoding)).toBeFalse();
      return;
    }
    expect(placement.rank).toBe(placement.higher.length + 1);
    expect(placement.dominators.length === 0).toBe(placement.onCostFrontier);
    expect(placement.onCostFrontier)
      .toBe(aaIndexCostFrontier(parsed.value.records).some(point => point.record.id === placement.record.id));
    expect(placement.settings).toEqual(gpt61SolCodingSettings(parsed.value.records));
    expect(placement.settings[0]?.settingRank)
      .toBeLessThanOrEqual(placement.settings.at(-1)?.settingRank ?? Number.POSITIVE_INFINITY);
    const [first] = gpt61SolCodingAgentRecords(parsed.value.records);
    expect(placement.record.id).toBe(first?.id);
    for (const neighbor of placement.neighbors) {
      expect(Math.abs(neighbor.benchmarks.aaIndex - placement.record.benchmarks.aaIndex)).toBeLessThanOrEqual(1);
    }
    for (const step of placement.frontierBelow) {
      expect(step.record.benchmarks.aaIndex).toBeLessThan(placement.record.benchmarks.aaIndex);
      expect(step.pointsBelow).toBeGreaterThan(0);
    }
    if (placement.cheapestHigher !== undefined) {
      for (const candidate of placement.higher) {
        if (candidate.economics.costUsd === null) continue;
        expect(candidate.economics.costUsd).toBeGreaterThanOrEqual(placement.cheapestHigher.record.economics.costUsd);
      }
    }
  });
});

const solMax = {
  ...intelligenceRecord(GPT_6_1_SOL_INTELLIGENCE_SLUG, 51.83, 0.72, 38_128),
  effort: { label: "max", level: 10, slug: "max" },
  release: { name: "GPT-6.1 Sol", slug: "gpt-6-1-sol" },
};
const solXhigh = {
  ...intelligenceRecord("gpt-6-1-sol-xhigh", 50, 0.5, 20_000),
  effort: { label: "xhigh", level: 8, slug: "xhigh" },
  release: { name: "GPT-6.1 Sol", slug: "gpt-6-1-sol" },
};

describe("GPT-6.1 Sol Intelligence Index placement", () => {
  test("requires the max-row slug inside the comparable cohort", () => {
    expect(gpt61SolIntelligencePlacement([solXhigh])).toBeUndefined();
    expect(gpt61SolIntelligencePlacement([intelligenceRecord(GPT_6_1_SOL_INTELLIGENCE_SLUG, 51, null)])).toBeUndefined();
    expect(() => gpt61SolIntelligencePlacement([solMax], 0)).toThrow(RangeError);
  });

  test("places the max row without building an effort ladder", () => {
    const cheaperHigher = intelligenceRecord("twin", 53, 0.4);
    const placement = gpt61SolIntelligencePlacement([solMax, solXhigh, cheaperHigher]);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.slug).toBe(GPT_6_1_SOL_INTELLIGENCE_SLUG);
    expect(placement.rank).toBe(2);
    expect(placement.siblings.map(record => record.slug)).toEqual(["gpt-6-1-sol-xhigh"]);
    expect(placement.cheapestHigher?.record.slug).toBe("twin");
    expect(placement.cheapestHigher?.multiple).toBeCloseTo(0.4 / 0.72, 9);
    expect("effortLadder" in placement).toBeFalse();
  });

  test("matches the shared Pareto membership on the checked snapshot", () => {
    const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
    if (!parsed.ok) throw parsed.error;
    const placement = gpt61SolIntelligencePlacement(parsed.value.records);
    if (placement === undefined) {
      expect(parsed.value.records.some(record => record.slug === GPT_6_1_SOL_INTELLIGENCE_SLUG)).toBeFalse();
      return;
    }
    const cohort = comparableIntelligenceRecords(parsed.value.records);
    expect(placement.cohortSize).toBe(cohort.length);
    expect(placement.record.slug).toBe(GPT_6_1_SOL_INTELLIGENCE_SLUG);
    expect(placement.onCostFrontier)
      .toBe(paretoMembership(cohort, "costUsdPerTask").has(placement.record.id));
    expect(comparableTaskCost(placement.record)).toBeGreaterThan(0);
    expect(parsed.value.records.some(record => record.release.slug === "gpt-6-sol")).toBeFalse();
  });
});
