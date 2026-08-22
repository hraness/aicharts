import { expect, test } from "bun:test";

import type { CodingAgentRecord } from "./coding-agent-data";
import {
  aaIndexCostEfficiencyRows,
  aaIndexCostFrontier,
  codingAgentSnapshotRows,
  formatSnapshotCostUsd,
  formatSnapshotScore,
  snapshotRowCell,
} from "./coding-agent-snapshot-rows";
import { assertProperty, fc } from "./property-test";

const generatedRecords = fc.array(
  fc.record({
    aaIndex: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    agent: fc.constantFrom("Codex", "Claude Code", "Cursor CLI"),
    costUsd: fc.option(fc.integer({ min: 0, max: 12_000 }), { nil: null }),
    deepSwe: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    model: fc.constantFrom("Model A", "Model B", "Model C"),
    setting: fc.constantFrom("low", "high", "max"),
    settingRank: fc.integer({ min: 0, max: 5 }),
    suffix: fc.integer({ min: 0, max: 10_000 }),
  }),
  { maxLength: 24 },
).map((items): CodingAgentRecord[] => items.map((item, index) => ({
  agent: item.agent,
  benchmarks: {
    aaIndex: item.aaIndex,
    deepSwe: item.deepSwe,
    sweAtlas: null,
    terminalBench: null,
  },
  completeIndex: true,
  economics: {
    costUsd: item.costUsd === null ? null : item.costUsd / 100,
    durationSeconds: null,
  },
  id: `${item.suffix}:${index}`,
  model: item.model,
  modelLabel: item.model,
  providerId: "provider",
  providerName: "Provider",
  seriesId: `${item.agent}:${item.model}:${index}`,
  seriesLabel: `${item.agent} · ${item.model}`,
  setting: item.setting,
  settingRank: item.settingRank,
  usage: { totalTokens: null },
})));

test("property: snapshot rows are a permutation of the source records", () => {
  assertProperty(fc.property(generatedRecords, (records) => {
    const rows = codingAgentSnapshotRows(records);
    expect(rows).toHaveLength(records.length);
    expect(new Set(rows.map(row => row.id))).toEqual(new Set(records.map(record => record.id)));
    for (const row of rows) {
      const record = records.find(candidate => candidate.id === row.id);
      expect(record).toBeDefined();
      if (record === undefined) continue;
      expect(row.model).toBe(record.model);
      expect(row.agent).toBe(record.agent);
      expect(row.aaIndex).toBe(record.benchmarks.aaIndex);
      expect(row.costUsd).toBe(record.economics.costUsd);
      expect(snapshotRowCell(row, "aaIndex")).toBe(formatSnapshotScore(record.benchmarks.aaIndex));
      expect(snapshotRowCell(row, "costUsd")).toBe(formatSnapshotCostUsd(record.economics.costUsd));
    }
  }));
});

test("property: snapshot row order ignores input order", () => {
  assertProperty(fc.property(generatedRecords, (records) => {
    const reversed = [...records].reverse();
    expect(codingAgentSnapshotRows(reversed)).toEqual(codingAgentSnapshotRows(records));
  }));
});

test("property: efficiency and frontier rows stay inside the source pairs", () => {
  assertProperty(fc.property(generatedRecords, (records) => {
    const byId = new Map(records.map(record => [record.id, record]));
    for (const row of aaIndexCostEfficiencyRows(records)) {
      const source = byId.get(row.record.id);
      expect(source).toBeDefined();
      if (source === undefined) continue;
      if (source.benchmarks.aaIndex === null || source.economics.costUsd === null) {
        throw new Error("Efficiency row escaped a null AA Index or cost pair.");
      }
      expect(row.aaIndex).toBe(source.benchmarks.aaIndex);
      expect(row.costUsd).toBe(source.economics.costUsd);
      expect(row.costUsd).toBeGreaterThan(0);
      expect(row.aaIndexPerUsd).toBe(row.aaIndex / row.costUsd);
    }
    for (const point of aaIndexCostFrontier(records)) {
      const source = byId.get(point.record.id);
      expect(source).toBeDefined();
      if (source === undefined) continue;
      if (source.benchmarks.aaIndex === null || source.economics.costUsd === null) {
        throw new Error("Frontier row escaped a null AA Index or cost pair.");
      }
      expect(point.yValue).toBe(source.benchmarks.aaIndex);
      expect(point.xValue).toBe(source.economics.costUsd);
    }
  }));
});
