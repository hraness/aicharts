import { describe, expect, test } from "bun:test";

import type { CodingAgentRecord } from "./coding-agent-data";
import {
  COMPACT_SNAPSHOT_COLUMNS,
  FULL_SNAPSHOT_COLUMNS,
  MISSING_SNAPSHOT_VALUE,
  aaIndexCostEfficiencyRows,
  aaIndexCostFrontier,
  codingAgentSnapshotRows,
  formatSnapshotCostUsd,
  formatSnapshotScore,
  snapshotRowCell,
  snapshotRowsMarkdownTable,
} from "./coding-agent-snapshot-rows";

const high: CodingAgentRecord = {
  id: "high",
  agent: "Codex",
  model: "Model High",
  modelLabel: "Model High (max)",
  providerId: "provider-a",
  providerName: "Provider A",
  seriesId: "codex:high",
  seriesLabel: "Codex · Model High",
  setting: "max",
  settingRank: 5,
  completeIndex: true,
  benchmarks: {
    aaIndex: 66.74,
    deepSwe: 70,
    terminalBench: 80,
    sweAtlas: 60,
  },
  economics: { costUsd: 8.234, durationSeconds: 100 },
  usage: { totalTokens: 1_000 },
};

const cheap: CodingAgentRecord = {
  ...high,
  id: "cheap",
  agent: "Cursor CLI",
  model: "Model Cheap",
  modelLabel: "Model Cheap (default)",
  providerId: "provider-b",
  providerName: "Provider B",
  seriesId: "cursor:cheap",
  seriesLabel: "Cursor CLI · Model Cheap",
  setting: "default",
  settingRank: 1,
  benchmarks: {
    aaIndex: 27.47,
    deepSwe: null,
    terminalBench: 40,
    sweAtlas: null,
  },
  economics: { costUsd: 0.044, durationSeconds: 20 },
};

const missing: CodingAgentRecord = {
  ...high,
  id: "missing",
  agent: "Opencode",
  model: "Model Missing",
  modelLabel: "Model Missing",
  seriesId: "opencode:missing",
  seriesLabel: "Opencode · Model Missing",
  setting: "low",
  settingRank: 0,
  benchmarks: {
    aaIndex: null,
    deepSwe: null,
    terminalBench: null,
    sweAtlas: null,
  },
  economics: { costUsd: null, durationSeconds: null },
};

describe("coding-agent snapshot rows", () => {
  test("sorts by AA Index, then model, agent, and setting", () => {
    const rows = codingAgentSnapshotRows([missing, cheap, high]);
    expect(rows.map(row => row.id)).toEqual(["high", "cheap", "missing"]);
  });

  test("formats scores and costs without inventing values", () => {
    expect(formatSnapshotScore(66.74)).toBe("66.7");
    expect(formatSnapshotScore(null)).toBe(MISSING_SNAPSHOT_VALUE);
    expect(formatSnapshotCostUsd(8.234)).toBe("$8.23");
    expect(formatSnapshotCostUsd(0.044)).toBe("$0.044");
    expect(formatSnapshotCostUsd(null)).toBe(MISSING_SNAPSHOT_VALUE);
  });

  test("keeps missing metrics as a dash in compact and full tables", () => {
    const [row] = codingAgentSnapshotRows([missing]);
    if (row === undefined) throw new Error("Expected a snapshot row.");
    expect(snapshotRowCell(row, "aaIndex")).toBe(MISSING_SNAPSHOT_VALUE);
    expect(snapshotRowCell(row, "costUsd")).toBe(MISSING_SNAPSHOT_VALUE);
    expect(snapshotRowsMarkdownTable([row], COMPACT_SNAPSHOT_COLUMNS)).toContain(MISSING_SNAPSHOT_VALUE);
    expect(snapshotRowsMarkdownTable([row], FULL_SNAPSHOT_COLUMNS)).toContain("Model Missing");
  });

  test("builds the cost/AA Index frontier from stored pairs only", () => {
    const dominated: CodingAgentRecord = {
      ...high,
      id: "dominated",
      model: "Model Dominated",
      benchmarks: { ...high.benchmarks, aaIndex: 50 },
      economics: { ...high.economics, costUsd: 9 },
    };
    const frontier = aaIndexCostFrontier([high, cheap, dominated, missing]);
    expect(frontier.map(point => point.record.id)).toEqual(["cheap", "high"]);
    expect(frontier[0]?.xValue).toBe(0.044);
    expect(frontier[0]?.yValue).toBe(27.47);
  });

  test("derives AA Index per dollar only when cost is positive", () => {
    const free: CodingAgentRecord = {
      ...cheap,
      id: "free",
      economics: { ...cheap.economics, costUsd: 0 },
    };
    const rows = aaIndexCostEfficiencyRows([high, cheap, free, missing]);
    expect(rows.map(row => row.record.id)).toEqual(["cheap", "high"]);
    expect(rows[0]?.aaIndexPerUsd).toBeCloseTo(27.47 / 0.044);
  });
});
