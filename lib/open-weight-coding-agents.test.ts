import { describe, expect, test } from "bun:test";

import codingAgentData from "@/data/coding-agents.json";

import { parseCodingAgentSnapshot, type CodingAgentRecord } from "./coding-agent-data";
import { codingAgentSnapshotRows } from "./coding-agent-snapshot-rows";
import {
  CLOSED_WEIGHT_PROVIDER_IDS,
  KNOWN_WEIGHT_PROVIDER_IDS,
  OPEN_WEIGHT_PROVIDER_IDS,
  UNCLASSIFIED_WEIGHT_PROVIDER_IDS,
  cataloguedSnapshotProviderIds,
  codingAgentWeightClass,
  formatAaIndexGap,
  highestAaIndexRow,
  highestAaIndexRowForModel,
  isOpenWeightCodingAgent,
  openWeightCodingAgentRows,
  openWeightProviderNames,
  uncataloguedSnapshotProviderIds,
  unclassifiedProviderNames,
} from "./open-weight-coding-agents";

const parsed = parseCodingAgentSnapshot(codingAgentData);
if (!parsed.ok) throw parsed.error;
const snapshot = parsed.value;

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
  test("keeps the provider catalog disjoint and exhaustive for the checked snapshot", () => {
    const ids = [...KNOWN_WEIGHT_PROVIDER_IDS];
    expect(new Set(ids).size).toBe(ids.length);
    expect(uncataloguedSnapshotProviderIds(snapshot.records)).toEqual([]);
    expect(cataloguedSnapshotProviderIds(snapshot.records)).toEqual(
      [...new Set(snapshot.records.map(item => item.providerId))].sort(),
    );
    for (const providerId of OPEN_WEIGHT_PROVIDER_IDS) {
      expect(CLOSED_WEIGHT_PROVIDER_IDS).not.toContain(providerId);
      expect(UNCLASSIFIED_WEIGHT_PROVIDER_IDS).not.toContain(providerId);
    }
  });

  test("classifies only the allowlisted open-weight publishers as open", () => {
    expect(codingAgentWeightClass("deepseek")).toBe("open");
    expect(codingAgentWeightClass("moonshot_ai")).toBe("open");
    expect(codingAgentWeightClass("alibaba_cloud")).toBe("open");
    expect(codingAgentWeightClass("z_ai")).toBe("open");
    expect(codingAgentWeightClass("anthropic")).toBe("closed");
    expect(codingAgentWeightClass("openai")).toBe("closed");
    expect(codingAgentWeightClass("cognition")).toBe("unclassified");
    expect(codingAgentWeightClass("meta")).toBe("unclassified");
    expect(codingAgentWeightClass("unknown_lab")).toBe("unclassified");
    expect(isOpenWeightCodingAgent(record({ providerId: "deepseek" }))).toBeTrue();
    expect(isOpenWeightCodingAgent(record({ providerId: "openai" }))).toBeFalse();
    expect(isOpenWeightCodingAgent(record({ providerId: "meta" }))).toBeFalse();
  });

  test("lists open and unclassified provider names from records", () => {
    const records = [
      record({ id: "a", providerId: "deepseek", providerName: "DeepSeek" }),
      record({ id: "b", providerId: "z_ai", providerName: "Z.ai" }),
      record({ id: "c", providerId: "deepseek", providerName: "DeepSeek" }),
      record({ id: "d", providerId: "meta", providerName: "Meta" }),
      record({ id: "e", providerId: "openai", providerName: "OpenAI" }),
    ];
    expect(openWeightProviderNames(records)).toEqual(["DeepSeek", "Z.ai"]);
    expect(unclassifiedProviderNames(records)).toEqual(["Meta"]);
  });

  test("keeps open-weight rows inside the snapshot order and scores", () => {
    const rows = openWeightCodingAgentRows(snapshot.records);
    const byId = new Map(snapshot.records.map(item => [item.id, item]));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const source = byId.get(row.id);
      expect(source).toBeDefined();
      if (source === undefined) continue;
      expect(isOpenWeightCodingAgent(source)).toBeTrue();
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
