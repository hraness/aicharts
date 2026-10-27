import { describe, expect, test } from "bun:test";

import codingAgentData from "@/data/coding-agents.json";

import { parseCodingAgentSnapshot, type CodingAgentRecord } from "./coding-agent-data";
import { codingAgentSnapshotRows } from "./coding-agent-snapshot-rows";
import {
  cataloguedSnapshotProviderIds,
  codingAgentWeightClass,
  formatAaIndexGap,
  highestAaIndexRow,
  highestAaIndexRowForModel,
  isOpenWeightCodingAgent,
  openWeightCodingAgentRows,
  openWeightIndexFromIntelligenceRecords,
  openWeightProviderNames,
  unclassifiedProviderNames,
} from "./open-weight-coding-agents";

const parsed = parseCodingAgentSnapshot(codingAgentData);
if (!parsed.ok) throw parsed.error;
const snapshot = parsed.value;

const index = new Map<string, boolean>([
  ["glm-5-3", true],
  ["kimi-k3", true],
  ["qwen3-8-max", true],
  ["deepseek-v4-flash-0731", true],
  ["gpt-6-astra", false],
  ["opus-5-5", false],
]);

function record(overrides: Partial<CodingAgentRecord> = {}): CodingAgentRecord {
  return {
    id: "row",
    agent: "Claude Code",
    model: "Example",
    modelLabel: "Example",
    providerId: "deepseek",
    providerName: "DeepSeek",
    seriesId: "example",
    seriesLabel: "Example",
    setting: "default",
    settingRank: 0,
    completeIndex: true,
    benchmarks: {
      aaIndex: 50,
      deepSwe: 40,
      terminalBench: 60,
      sweAtlas: 20,
    },
    economics: { costUsd: 1, durationSeconds: 10 },
    usage: { totalTokens: 100 },
    ...overrides,
  };
}

describe("open-weight coding-agent classification", () => {
  test("classifies from Artificial Analysis model identities instead of lab lists", () => {
    expect(codingAgentWeightClass(record({ model: "GLM-5.3" }), index)).toBe("open");
    expect(codingAgentWeightClass(record({
      model: "Kimi K3",
      seriesId: "Kimi Code CLI:moonshot_kimi-k3",
    }), index)).toBe("open");
    expect(codingAgentWeightClass(record({ model: "GPT-6 Astra" }), index)).toBe("closed");
    expect(codingAgentWeightClass(record({ model: "Opus 5.5" }), index)).toBe("closed");
    expect(codingAgentWeightClass(record({ model: "Unknown Model" }), index)).toBe("unclassified");
    expect(isOpenWeightCodingAgent(record({ model: "Qwen3.8 Max" }), index)).toBeTrue();
    expect(isOpenWeightCodingAgent(record({ model: "GPT-6 Astra" }), index)).toBeFalse();
  });

  test("drops identities that Artificial Analysis marks both open and closed", () => {
    const conflicting = openWeightIndexFromIntelligenceRecords([
      {
        slug: "shared-model",
        name: "Shared Model",
        shortName: "Shared",
        weights: { open: true },
      },
      {
        slug: "shared-model-closed",
        name: "Shared Model",
        shortName: "Shared Closed",
        weights: { open: false },
      },
    ]);
    expect(conflicting.has("shared-model")).toBeFalse();
    expect(conflicting.get("shared")).toBeUndefined();
  });

  test("lists open and unclassified provider names from records", () => {
    const records = [
      record({ id: "a", model: "GLM-5.3", providerId: "z_ai", providerName: "Z.ai" }),
      record({ id: "b", model: "Kimi K3", providerId: "moonshot_ai", providerName: "Moonshot AI" }),
      record({ id: "c", model: "GLM-5.3", providerId: "z_ai", providerName: "Z.ai" }),
      record({ id: "d", model: "Unknown Model", providerId: "meta", providerName: "Meta" }),
      record({ id: "e", model: "GPT-6 Astra", providerId: "openai", providerName: "OpenAI" }),
    ];
    expect(openWeightProviderNames(records, index)).toEqual(["Moonshot AI", "Z.ai"]);
    expect(unclassifiedProviderNames(records, index)).toEqual(["Meta"]);
  });

  test("keeps open-weight rows inside the snapshot order and scores", () => {
    const rows = openWeightCodingAgentRows(snapshot.records, index);
    const byId = new Map(snapshot.records.map(item => [item.id, item]));
    expect(cataloguedSnapshotProviderIds(snapshot.records).length).toBeGreaterThan(0);
    for (const row of rows) {
      const source = byId.get(row.id);
      expect(source).toBeDefined();
      if (source === undefined) continue;
      expect(isOpenWeightCodingAgent(source, index)).toBeTrue();
      expect(row.aaIndex).toBe(source.benchmarks.aaIndex);
      expect(row.model).toBe(source.model);
    }
    const allRows = codingAgentSnapshotRows(snapshot.records);
    const openIds = new Set(rows.map(row => row.id));
    expect(allRows.filter(row => openIds.has(row.id))).toEqual(rows);
  });

  test("selects the highest stored AA Index row and exact model match", () => {
    const rows = codingAgentSnapshotRows([
      record({
        id: "low",
        model: "Kimi K2.6",
        benchmarks: { aaIndex: 32.6, deepSwe: 1, terminalBench: 1, sweAtlas: 1 },
      }),
      record({
        id: "high",
        model: "Kimi K3",
        providerId: "moonshot_ai",
        providerName: "Moonshot AI",
        benchmarks: { aaIndex: 61.3, deepSwe: 1, terminalBench: 1, sweAtlas: 1 },
      }),
      record({
        id: "missing",
        model: "Absent",
        benchmarks: { aaIndex: null, deepSwe: null, terminalBench: null, sweAtlas: null },
      }),
    ]);
    expect(highestAaIndexRow(rows)?.id).toBe("high");
    expect(highestAaIndexRowForModel(rows, "Kimi K2.6")?.id).toBe("low");
    expect(highestAaIndexRowForModel(rows, "Missing Model")).toBeUndefined();
    expect(formatAaIndexGap(66.7, 61.3)).toBe("5.4");
  });
});
