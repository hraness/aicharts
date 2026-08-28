import { describe, expect, test } from "bun:test";
import { assertProperty, fc } from "./property-test";
import {
  codingAgentSnapshotSchema,
  parseCodingAgentSnapshot,
  parseRefreshCodingAgentSnapshot,
  type CodingAgentRecord,
  type CodingAgentSnapshot,
} from "./coding-agent-data";

const validRecord: CodingAgentRecord = {
  id: "agent:model:medium",
  agent: "Codex CLI",
  model: "Model Prime",
  modelLabel: "Model Prime (medium)",
  providerId: "provider",
  providerName: "Provider",
  seriesId: "codex:model-prime",
  seriesLabel: "Codex CLI · Model Prime",
  setting: "medium",
  settingRank: 3,
  completeIndex: true,
  benchmarks: {
    aaIndex: 72.4,
    deepSwe: 61.2,
    terminalBench: 80,
    sweAtlas: 76.1,
  },
  economics: {
    costUsd: 4.25,
    durationSeconds: 720,
  },
  usage: { totalTokens: 1_250_000 },
};

const validSnapshot: CodingAgentSnapshot = {
  schemaVersion: 3,
  source: {
    benchmarkDatasets: {
      deepSwe: "deep-swe",
      terminalBench: "terminal-bench-v2.1",
      sweAtlas: "swe-atlas-qna",
    },
    name: "Artificial Analysis",
    url: "https://artificialanalysis.ai/agents/coding-agents/",
    retrievedAt: "2026-07-17T16:29:07.106Z",
    method: "next-flight",
  },
  updates: [{
    id: "model-added:prime",
    agent: "Codex CLI",
    benchmarks: validRecord.benchmarks,
    detectedAt: "2026-07-17T16:29:07.106Z",
    kind: "model-added",
    model: "Model Prime",
    providerId: "provider",
    providerName: "Provider",
    setting: "medium",
    variantCount: 1,
  }],
  records: [validRecord],
};

describe("coding-agent snapshot boundary", () => {
  test("accepts the owned snapshot contract", () => {
    expect(parseCodingAgentSnapshot(validSnapshot)).toEqual({ ok: true, value: validSnapshot });
  });

  test("upgrades the checked v2 snapshot with explicit legacy benchmark identities", () => {
    const legacySnapshot = {
      ...validSnapshot,
      schemaVersion: 2,
      source: {
        name: validSnapshot.source.name,
        url: validSnapshot.source.url,
        retrievedAt: validSnapshot.source.retrievedAt,
        method: validSnapshot.source.method,
      },
    };

    expect(parseCodingAgentSnapshot(legacySnapshot).ok).toBe(false);
    const parsed = parseRefreshCodingAgentSnapshot(legacySnapshot);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schemaVersion).toBe(3);
    expect(parsed.value.source.benchmarkDatasets.terminalBench).toBe("terminal-bench-v2");
  });

  test("rejects unreviewed benchmark identities at the public snapshot boundary", () => {
    const futureSnapshot = {
      ...validSnapshot,
      source: {
        ...validSnapshot.source,
        benchmarkDatasets: {
          ...validSnapshot.source.benchmarkDatasets,
          terminalBench: "terminal-bench-v3",
        },
      },
    };
    const parsed = parseCodingAgentSnapshot(futureSnapshot);

    expect(parsed.ok).toBe(false);
    expect(parseRefreshCodingAgentSnapshot(futureSnapshot).ok).toBe(true);
  });

  test("rejects unknown fields at top-level and nested boundaries", () => {
    const topLevel = parseCodingAgentSnapshot({ ...validSnapshot, undocumented: true });
    const nested = parseCodingAgentSnapshot({
      ...validSnapshot,
      records: [{
        ...validRecord,
        economics: { ...validRecord.economics, undocumented: 1 },
      }],
    });

    expect(topLevel.ok).toBe(false);
    expect(nested.ok).toBe(false);
    if (!topLevel.ok) expect(topLevel.error.issues[0]?.code).toBe("unrecognized_keys");
    if (!nested.ok) expect(nested.error.issues[0]?.path).toEqual(["records", 0, "economics"]);
  });

  test("rejects out-of-range scores and invalid source metadata", () => {
    const scoreResult = parseCodingAgentSnapshot({
      ...validSnapshot,
      records: [{
        ...validRecord,
        benchmarks: { ...validRecord.benchmarks, aaIndex: 100.01 },
      }],
    });
    const dateResult = parseCodingAgentSnapshot({
      ...validSnapshot,
      source: { ...validSnapshot.source, retrievedAt: "last Thursday" },
    });

    expect(scoreResult.ok).toBe(false);
    expect(dateResult.ok).toBe(false);
  });

  test("rejects update events that omit their kind-specific evidence", () => {
    const result = parseCodingAgentSnapshot({
      ...validSnapshot,
      updates: [{
        ...validSnapshot.updates[0],
        kind: "benchmark-changed",
      }],
    });

    expect(result.ok).toBe(false);
  });
});

test("property: snapshot parsing is total over arbitrary JSON", () => {
  assertProperty(fc.property(fc.jsonValue(), (value) => {
    expect(() => codingAgentSnapshotSchema.safeParse(value)).not.toThrow();
    expect(() => parseCodingAgentSnapshot(value)).not.toThrow();
    expect(() => parseRefreshCodingAgentSnapshot(value)).not.toThrow();
  }));
});
