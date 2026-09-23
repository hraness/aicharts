import { describe, expect, test } from "bun:test";

import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";

import { parseArtificialAnalysisIntelligenceV43Snapshot } from "./artificial-analysis-intelligence-v4-3-data";
import { parseCodingAgentSnapshot, type CodingAgentRecord } from "./coding-agent-data";
import { aaIndexCostFrontier } from "./coding-agent-snapshot-rows";
import {
  CODING_COMPONENT_METRICS,
  GROK_46_CODING_CONFIGURATION,
  GROK_47_CODING_CONFIGURATION,
  GROK_47_INTELLIGENCE_HIGH_SLUG,
  GROK_47_INTELLIGENCE_SLUG,
  competitionRank,
  grokCodingAgentPlacement,
  grokCodingAgentRecords,
  grokIntelligencePlacement,
  modelAddedAt,
  spellOrdinal,
} from "./grok-4-7-placement";
import { comparableIntelligenceRecords, paretoMembership } from "./intelligence-efficiency";
import { intelligenceRecord } from "./mimo-v2-6-pro-frontier.test";

export type CodingAgentRecordShape = Readonly<{
  aaIndex?: number | null;
  agent?: string;
  costUsd?: number | null;
  deepSwe?: number | null;
  id: string;
  model?: string;
  providerId?: string;
  setting?: string;
  sweAtlas?: number | null;
  terminalBench?: number | null;
  totalTokens?: number | null;
}>;

export function codingAgentRecord(shape: CodingAgentRecordShape): CodingAgentRecord {
  const agent = shape.agent ?? "Codex";
  const model = shape.model ?? `Model ${shape.id}`;
  const setting = shape.setting ?? "max";
  return {
    id: shape.id,
    agent,
    model,
    modelLabel: `${model} (${setting})`,
    providerId: shape.providerId ?? "lab",
    providerName: shape.providerId ?? "Lab",
    seriesId: `${agent}:${model}`,
    seriesLabel: `${agent} · ${model}`,
    setting,
    settingRank: 5,
    completeIndex: shape.aaIndex !== null,
    benchmarks: {
      aaIndex: shape.aaIndex === undefined ? 50 : shape.aaIndex,
      deepSwe: shape.deepSwe === undefined ? 60 : shape.deepSwe,
      terminalBench: shape.terminalBench === undefined ? 40 : shape.terminalBench,
      sweAtlas: shape.sweAtlas === undefined ? 55 : shape.sweAtlas,
    },
    economics: {
      costUsd: shape.costUsd === undefined ? 5 : shape.costUsd,
      durationSeconds: 1_000,
    },
    usage: { totalTokens: shape.totalTokens === undefined ? 1_000_000 : shape.totalTokens },
  };
}

const grok = codingAgentRecord({
  ...GROK_47_CODING_CONFIGURATION,
  aaIndex: 56.27,
  costUsd: 8.82,
  deepSwe: 72.6,
  id: "grok-4-7",
  setting: "xhigh",
  sweAtlas: 62.9,
  terminalBench: 33.3,
  totalTokens: 14_300_000,
});
const grok46 = codingAgentRecord({
  ...GROK_46_CODING_CONFIGURATION,
  aaIndex: 46.97,
  costUsd: 3.57,
  deepSwe: 64.9,
  id: "grok-4-6",
  setting: "xhigh",
  sweAtlas: 58.3,
  terminalBench: 17.7,
  totalTokens: 5_500_000,
});
const leader = codingAgentRecord({
  aaIndex: 62.22, agent: "Claude Code", costUsd: 12.39, deepSwe: 64.3, id: "fable", model: "Fable 5.1", sweAtlas: 64.8, terminalBench: 57.6,
});
const sol = codingAgentRecord({
  aaIndex: 56.66, costUsd: 2.99, deepSwe: 69.0, id: "sol", model: "GPT-6 Sol", sweAtlas: 57.5, terminalBench: 43.4,
});
const glm = codingAgentRecord({
  aaIndex: 53.55, agent: "Opencode", costUsd: 4.24, deepSwe: 61.4, id: "glm", model: "GLM-5.3", setting: "default", sweAtlas: 59.4, terminalBench: 39.9,
});
const muse = codingAgentRecord({
  aaIndex: 48.3, agent: "Muse Code", costUsd: 3.47, deepSwe: 73.2, id: "muse", model: "Muse Spark 1.3", setting: "xhigh", sweAtlas: 54.6, terminalBench: 17.2,
});
const unindexed = codingAgentRecord({ aaIndex: null, costUsd: 1, deepSwe: 90, id: "unindexed", terminalBench: 90 });
const uncosted = codingAgentRecord({ aaIndex: 70, costUsd: null, id: "uncosted" });

describe("Grok 4.7 coding-agent placement", () => {
  test("finds only Grok Build · Grok 4.7 rows with an index and a cost, highest index first", () => {
    const second = codingAgentRecord({ ...GROK_47_CODING_CONFIGURATION, aaIndex: 50, id: "grok-high", setting: "high" });
    const indexless = codingAgentRecord({ ...GROK_47_CODING_CONFIGURATION, aaIndex: null, id: "grok-none" });
    const costless = codingAgentRecord({ ...GROK_47_CODING_CONFIGURATION, costUsd: null, id: "grok-free" });
    const otherHarness = codingAgentRecord({ ...GROK_47_CODING_CONFIGURATION, agent: "Codex", id: "grok-codex" });
    expect(grokCodingAgentRecords([second, indexless, costless, otherHarness, grok, sol]).map(record => record.id))
      .toEqual(["grok-4-7", "grok-high"]);
    expect(grokCodingAgentPlacement([sol, leader])).toBeUndefined();
  });

  test("ranks, dominates, and splits the components for a small snapshot", () => {
    const placement = grokCodingAgentPlacement([glm, grok, unindexed, leader, sol, muse, grok46, uncosted]);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.id).toBe("grok-4-7");
    expect(placement.indexedCount).toBe(7);
    expect(placement.rank).toBe(4);
    expect(placement.higher.map(record => record.id)).toEqual(["uncosted", "fable", "sol"]);
    expect(placement.leader.id).toBe("uncosted");
    expect(placement.dominators.map(record => record.id)).toEqual(["sol"]);
    expect(placement.onCostFrontier).toBeFalse();
    expect(placement.predecessor?.id).toBe("grok-4-6");
    expect(placement.lowerIndexHigherTerminal.map(record => record.id)).toEqual(["glm"]);
    expect(placement.components.map(component => component.metric)).toEqual([...CODING_COMPONENT_METRICS]);
    const [deepSwe, terminalBench, sweAtlas] = placement.components;
    expect(deepSwe).toMatchObject({ count: 8, rank: 3, value: 72.6 });
    expect(deepSwe?.leader.id).toBe("unindexed");
    expect(terminalBench).toMatchObject({ count: 8, rank: 6, value: 33.3 });
    expect(sweAtlas).toMatchObject({ count: 8, rank: 2, value: 62.9 });
    expect(sweAtlas?.leader.id).toBe("fable");
  });

  test("joins the frontier when nothing cheaper scores as high", () => {
    const placement = grokCodingAgentPlacement([grok, leader, grok46, muse]);
    expect(placement?.onCostFrontier).toBeTrue();
    expect(placement?.dominators).toEqual([]);
    expect(placement?.rank).toBe(2);
    expect(placement?.higher.map(record => record.id)).toEqual(["fable"]);
  });

  test("ignores a Grok 4.6 row at a different setting and a missing Terminal-Bench score", () => {
    const grok46High = { ...grok46, id: "grok-4-6-high", setting: "high" };
    const noTerminal = { ...grok, benchmarks: { ...grok.benchmarks, terminalBench: null } };
    const placement = grokCodingAgentPlacement([noTerminal, grok46High, glm]);
    expect(placement?.predecessor).toBeUndefined();
    expect(placement?.lowerIndexHigherTerminal).toEqual([]);
    expect(placement?.components.map(component => component.metric)).toEqual(["deepSwe", "sweAtlas"]);
  });

  test("reads the model-added date only from a matching bounded update", () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const update = parsed.value.updates.find(candidate => candidate.kind === "model-added");
    expect(update).toBeDefined();
    if (update === undefined) return;
    expect(modelAddedAt(parsed.value, update)).toBe(update.detectedAt);
    expect(modelAddedAt(parsed.value, { agent: "Nobody", model: "Nothing", providerId: "none" })).toBeUndefined();
    expect(modelAddedAt({ updates: [] }, update)).toBeUndefined();
  });

  test("matches the chart frontier and the ranking on the checked snapshot", () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const placement = grokCodingAgentPlacement(parsed.value.records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.record.setting).toBe("xhigh");
    expect(placement.onCostFrontier)
      .toBe(aaIndexCostFrontier(parsed.value.records).some(point => point.record.id === placement.record.id));
    expect(placement.rank).toBe(placement.higher.length + 1);
    expect(placement.rank).toBeLessThanOrEqual(placement.indexedCount);
    expect(placement.leader.benchmarks.aaIndex).toBeGreaterThanOrEqual(placement.record.benchmarks.aaIndex);
    for (const component of placement.components) {
      expect(component.rank).toBeGreaterThanOrEqual(1);
      expect(component.rank).toBeLessThanOrEqual(component.count);
    }
  });
});

const grokIndex = intelligenceRecord(GROK_47_INTELLIGENCE_SLUG, 46.45, 3.74, 80_561);
const grokHigh = intelligenceRecord(GROK_47_INTELLIGENCE_HIGH_SLUG, 46.33, 2.73, 65_901);
const opus = intelligenceRecord("claude-opus-5-5", 57.62, 5.98);
const solMax = intelligenceRecord("gpt-6-sol", 47.53, 1.06);
const mimo = intelligenceRecord("mimo-v2-6-pro", 46.32, 0.13);
const qwen = intelligenceRecord("qwen3-8-max", 45.42, 5.41);
const nullCost = intelligenceRecord("null-cost", 60, null);

describe("Grok 4.7 Intelligence Index placement", () => {
  test("requires the xhigh row inside the comparable cohort", () => {
    expect(grokIntelligencePlacement([grokHigh, opus])).toBeUndefined();
    expect(grokIntelligencePlacement([intelligenceRecord(GROK_47_INTELLIGENCE_SLUG, 46, null)])).toBeUndefined();
    expect(() => grokIntelligencePlacement([grokIndex], 0)).toThrow(RangeError);
  });

  test("reports rank, dominators, neighbors, and the high-effort sibling", () => {
    const placement = grokIntelligencePlacement([qwen, grokHigh, opus, mimo, grokIndex, solMax, nullCost]);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    expect(placement.cohortSize).toBe(6);
    expect(placement.rank).toBe(3);
    expect(placement.leader.slug).toBe("claude-opus-5-5");
    expect(placement.onCostFrontier).toBeFalse();
    expect(placement.dominators.map(record => record.slug)).toEqual(["gpt-6-sol"]);
    expect(placement.cheapestHigher?.record.slug).toBe("gpt-6-sol");
    expect(placement.cheapestHigher?.multiple).toBeCloseTo(1.06 / 3.74, 9);
    expect(placement.neighbors.map(record => record.slug)).toEqual(["mimo-v2-6-pro", "grok-4-7-high"]);
    expect(placement.high?.slug).toBe(GROK_47_INTELLIGENCE_HIGH_SLUG);
  });

  test("joins the frontier when it is the cheapest configuration at its score", () => {
    const placement = grokIntelligencePlacement([grokIndex, opus, qwen]);
    expect(placement?.onCostFrontier).toBeTrue();
    expect(placement?.dominators).toEqual([]);
    expect(placement?.cheapestHigher?.record.slug).toBe("claude-opus-5-5");
    expect(placement?.high).toBeUndefined();
    expect(placement?.neighbors).toEqual([]);
  });

  test("matches the shared Pareto membership on the checked snapshot", () => {
    const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
    if (!parsed.ok) throw parsed.error;
    const placement = grokIntelligencePlacement(parsed.value.records);
    expect(placement).toBeDefined();
    if (placement === undefined) return;
    const cohort = comparableIntelligenceRecords(parsed.value.records);
    expect(placement.cohortSize).toBe(cohort.length);
    expect(placement.onCostFrontier)
      .toBe(paretoMembership(cohort, "costUsdPerTask").has(placement.record.id));
    expect(placement.rank).toBeLessThanOrEqual(cohort.length);
    expect(placement.record.release.slug).toBe(GROK_47_INTELLIGENCE_SLUG);
  });
});

describe("Grok 4.7 placement formatters", () => {
  test("ranks with shared higher rank on ties", () => {
    expect(competitionRank(5, [9, 7, 5, 5, 1])).toBe(3);
    expect(competitionRank(9, [9, 7])).toBe(1);
    expect(competitionRank(0, [])).toBe(1);
  });

  test("spells small ordinals and suffixes larger ones", () => {
    expect(spellOrdinal(1)).toBe("first");
    expect(spellOrdinal(9)).toBe("ninth");
    expect(spellOrdinal(11)).toBe("11th");
    expect(spellOrdinal(12)).toBe("12th");
    expect(spellOrdinal(13)).toBe("13th");
    expect(spellOrdinal(21)).toBe("21st");
    expect(spellOrdinal(22)).toBe("22nd");
    expect(spellOrdinal(23)).toBe("23rd");
    expect(spellOrdinal(111)).toBe("111th");
    expect(() => spellOrdinal(-1)).toThrow(RangeError);
    expect(() => spellOrdinal(1.5)).toThrow(RangeError);
  });
});
