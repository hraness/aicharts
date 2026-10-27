import { describe, expect, test } from "bun:test";

import codingAgentData from "@/data/coding-agents.json";

import { parseCodingAgentSnapshot, type CodingAgentRecord } from "./coding-agent-data";
import { codingAgentSnapshotRows } from "./coding-agent-snapshot-rows";
import {
  cataloguedSnapshotProviderIds,
  codingAgentWeightClass,
  codingAgentWeightComponents,
  formatAaIndexGap,
  highestAaIndexRow,
  highestAaIndexRowForModel,
  isOpenWeightCodingAgent,
  openWeightCodingAgentRows,
  openWeightIdentityKeys,
  openWeightIndexFromIntelligenceRecords,
  openWeightIndexFromWeightRecords,
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
        shortName: "Shared",
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

  test("indexes Artificial Analysis slugs and creator-qualified slugs instead of display names alone", () => {
    expect(openWeightIdentityKeys({
      creatorSlug: "anthropic",
      open: false,
      releaseSlug: "claude-opus-5-5",
      slug: "claude-opus-5-5",
    })).toEqual(expect.arrayContaining([
      "claude-opus-5-5",
      "opus-5-5",
      "anthropic-claude-opus-5-5",
    ]));
    expect(openWeightIdentityKeys({
      creatorSlug: "kimi",
      name: "Kimi K3",
      open: true,
      releaseSlug: "kimi-k3",
      slug: "kimi-k3",
    })).toEqual(expect.arrayContaining(["kimi-k3", "kimi-kimi-k3"]));
  });

  test("matches coding-agent series slugs and creator prefixes to AA identities", () => {
    const identities = openWeightIndexFromWeightRecords([
      { creatorSlug: "anthropic", open: false, releaseSlug: "claude-opus-5-5", slug: "claude-opus-5-5" },
      { creatorSlug: "anthropic", open: false, releaseSlug: "claude-haiku-5-5", slug: "claude-haiku-5-5" },
      { creatorSlug: "kimi", open: true, releaseSlug: "kimi-k3", slug: "kimi-k3" },
      { creatorSlug: "kimi", open: false, releaseSlug: "kimi-k3-1-pro", slug: "kimi-k3-1-pro" },
      { creatorSlug: "deepseek", open: true, releaseSlug: "deepseek-v4-1-flash", slug: "deepseek-v4-1-flash" },
      { creatorSlug: "meta", open: false, releaseSlug: "muse-wonder-full", slug: "muse-wonder-full" },
      { creatorSlug: "meta", open: false, releaseSlug: "muse-spark-1-3", slug: "muse-spark-1-3" },
    ]);
    expect(codingAgentWeightClass(record({
      model: "Opus 5.5",
      providerId: "anthropic",
      seriesId: "Claude Code:anthropic_claude-opus-5-5",
    }), identities)).toBe("closed");
    expect(codingAgentWeightClass(record({
      model: "Haiku 5.5",
      providerId: "anthropic",
      seriesId: "Claude Code:haiku-5-5",
    }), identities)).toBe("closed");
    expect(codingAgentWeightClass(record({
      model: "Kimi K3",
      providerId: "moonshot_ai",
      seriesId: "Kimi Code CLI:moonshot_kimi-k3",
    }), identities)).toBe("open");
    expect(codingAgentWeightClass(record({
      model: "DeepSeek V4.1 Flash",
      providerId: "deepseek",
      seriesId: "Codex:deepseek-v4-1-flash",
    }), identities)).toBe("open");
    expect(codingAgentWeightClass(record({
      model: "Muse Wonder Full",
      providerId: "meta",
      seriesId: "Muse Code:muse-wonder-full",
    }), identities)).toBe("closed");
    expect(codingAgentWeightClass(record({
      model: "Muse Spark 1.3",
      providerId: "meta",
      seriesId: "Muse Code 1.0.2 RC:meta_goofy-glacier135",
    }), identities)).toBe("closed");
    expect(identities.get("kimi-k3")).toBeTrue();
    expect(identities.get("kimi-k3-1-pro")).toBeFalse();
  });

  test("uses Intelligence names when the chart series slug is not the AA model slug", () => {
    const identities = openWeightIndexFromIntelligenceRecords([
      {
        creator: { slug: "reflection" },
        name: "Beam 1.0",
        release: { slug: "reflection-beam" },
        shortName: "Beam 1.0",
        slug: "reflection-beam",
        weights: { open: true },
      },
      {
        creator: { slug: "anthropic" },
        name: "Claude Sonnet 5.5 (Max, Default Fallback)",
        release: { slug: "claude-sonnet-5-5" },
        shortName: "Claude Sonnet 5.5 (max with fallback)",
        slug: "claude-sonnet-5-5",
        weights: { open: false },
      },
    ]);
    expect(codingAgentWeightClass(record({
      model: "Beam 1.0",
      providerId: "reflection",
      seriesId: "Mirror:beam-1-0",
    }), identities)).toBe("open");
    expect(codingAgentWeightClass(record({
      model: "Sonnet 5.5",
      providerId: "anthropic",
      seriesId: "Claude Code:private-anthropic_claude-beignet-eap-max",
    }), identities)).toBe("closed");
  });

  test("classifies a composite as open only when every component is open", () => {
    const identities = new Map<string, boolean>([
      ["claude-opus-5-5", false],
      ["opus-5-5", false],
      ["gpt-6-luna", false],
      ["claude-fable-5-1", false],
      ["fable-5-1", false],
      ["glm-5-3", true],
      ["kimi-k3", true],
    ]);
    expect(codingAgentWeightComponents(record({
      model: "Claude Opus 5.5 Max + GPT-6 Luna High",
    }))).toEqual(["Claude Opus 5.5 Max", "GPT-6 Luna High"]);
    expect(codingAgentWeightClass(record({
      model: "Claude Opus 5.5 Max + GPT-6 Luna High",
      providerId: "cognition",
      seriesId: "Devin Fusion CLI:claude-opus-5-5-max-gpt-6-luna-high",
    }), identities)).toBe("closed");
    expect(codingAgentWeightClass(record({
      model: "Claude Fable 5.1 XHigh + SWE-2 Medium",
      providerId: "cognition",
      seriesId: "Devin Fusion CLI:cognition_fusion-claude-fable-5-1-xhigh-sidekick-penguin-medium",
    }), identities)).toBe("closed");
    expect(codingAgentWeightClass(record({
      model: "GLM-5.3 + Kimi K3",
      providerId: "cognition",
    }), identities)).toBe("open");
    expect(codingAgentWeightClass(record({
      model: "GLM-5.3 + SWE-2",
      providerId: "cognition",
    }), identities)).toBe("unclassified");
    expect(codingAgentWeightClass(record({
      model: "Unknown Lead + Unknown Sidekick",
      providerId: "cognition",
    }), identities)).toBe("unclassified");
  });

  test("classifies the checked coding-agent snapshot from AA slugs and the full roster", () => {
    const classes = Object.groupBy(
      snapshot.records,
      record => codingAgentWeightClass(record),
    );
    const unclassified = snapshot.records.filter(record => codingAgentWeightClass(record) === "unclassified");
    expect(unclassified.map(record => `${record.agent}:${record.model}`)).toEqual([]);
    expect(classes.open?.length ?? 0).toBe(7);
    expect(classes.closed?.length ?? 0).toBe(23);
    expect(classes.unclassified?.length ?? 0).toBe(0);
    expect(codingAgentWeightClass(snapshot.records.find(record =>
      record.seriesId === "Codex:deepseek-v4-1-flash") ?? record())).toBe("open");
    expect(codingAgentWeightClass(snapshot.records.find(record =>
      record.seriesId === "Kimi Code CLI:moonshot_kimi-k3") ?? record())).toBe("open");
    expect(codingAgentWeightClass(snapshot.records.find(record =>
      record.seriesId === "Claude Code:anthropic_claude-opus-5-5") ?? record())).toBe("closed");
    expect(codingAgentWeightClass(snapshot.records.find(record =>
      record.seriesId === "Claude Code:private-anthropic_claude-beignet-eap-max") ?? record())).toBe("closed");
    expect(codingAgentWeightClass(snapshot.records.find(record =>
      record.model === "Muse Wonder Full") ?? record())).toBe("closed");
    expect(codingAgentWeightClass(snapshot.records.find(record =>
      record.model.startsWith("Claude Fable 5.1") && record.model.includes("+")) ?? record())).toBe("closed");
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
