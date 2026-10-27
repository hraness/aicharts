import { expect, test } from "bun:test";

import type { CodingAgentRecord } from "./coding-agent-data";
import { codingAgentSnapshotRows } from "./coding-agent-snapshot-rows";
import {
  codingAgentWeightClass,
  formatAaIndexGap,
  highestAaIndexRow,
  isOpenWeightCodingAgent,
  openWeightCodingAgentRows,
} from "./open-weight-coding-agents";
import { assertProperty, fc } from "./property-test";

const index = new Map<string, boolean>([
  ["kimi-k3", true],
  ["glm-5-2", true],
  ["opus-5", false],
  ["muse-spark-1-2", false],
]);

const generatedRecords = fc.array(
  fc.record({
    aaIndex: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    agent: fc.constantFrom("Codex", "Claude Code", "Kimi Code CLI"),
    model: fc.constantFrom("Kimi K3", "GLM-5.2", "Opus 5", "Muse Spark 1.2", "Unknown Model"),
    providerId: fc.constantFrom("moonshot_ai", "z_ai", "anthropic", "meta", "unknown_lab"),
    setting: fc.constantFrom("default", "max", "xhigh"),
    suffix: fc.integer({ min: 0, max: 10_000 }),
  }),
  { maxLength: 24 },
).map((items): CodingAgentRecord[] => items.map((item, indexValue) => ({
  agent: item.agent,
  benchmarks: {
    aaIndex: item.aaIndex,
    deepSwe: null,
    sweAtlas: null,
    terminalBench: null,
  },
  completeIndex: true,
  economics: { costUsd: 1, durationSeconds: null },
  id: `${item.suffix}:${indexValue}`,
  model: item.model,
  modelLabel: item.model,
  providerId: item.providerId,
  providerName: item.providerId,
  seriesId: `${item.providerId}:${item.model}:${indexValue}`,
  seriesLabel: `${item.model}`,
  setting: item.setting,
  settingRank: 0,
  usage: { totalTokens: null },
})));

test("property: open-weight rows are exactly the AA-flagged subset", () => {
  assertProperty(fc.property(generatedRecords, (records) => {
    const openRows = openWeightCodingAgentRows(records, index);
    const expected = codingAgentSnapshotRows(records).filter(row => {
      const source = records.find(candidate => candidate.id === row.id);
      return source !== undefined && isOpenWeightCodingAgent(source, index);
    });
    expect(openRows).toEqual(expected);
    for (const row of openRows) {
      const source = records.find(candidate => candidate.id === row.id);
      expect(source).toBeDefined();
      if (source === undefined) continue;
      expect(codingAgentWeightClass(source, index)).toBe("open");
    }
  }));
});

test("property: a composite is open only when every component is open", () => {
  assertProperty(fc.property(
    fc.constantFrom("open", "closed", "unclassified"),
    fc.constantFrom("open", "closed", "unclassified"),
    (left, right) => {
      const identities = new Map<string, boolean>([
        ...(left === "unclassified" ? [] : [["left-model", left === "open"] as const]),
        ...(right === "unclassified" ? [] : [["right-model", right === "open"] as const]),
      ]);
      const record: Pick<CodingAgentRecord, "model" | "modelLabel" | "providerId" | "seriesId"> = {
        model: "Left Model + Right Model",
        modelLabel: "Left Model + Right Model",
        providerId: "cognition",
        seriesId: "Devin Fusion CLI:left-right",
      };
      const expected = left === "closed" || right === "closed"
        ? "closed"
        : left === "open" && right === "open"
          ? "open"
          : "unclassified";
      expect(codingAgentWeightClass(record, identities)).toBe(expected);
    },
  ));
});

test("property: unmatched models stay unclassified and out of the open set", () => {
  assertProperty(fc.property(generatedRecords, (records) => {
    const unknown = records.filter(item => item.model === "Unknown Model");
    for (const item of unknown) {
      expect(codingAgentWeightClass(item, index)).toBe("unclassified");
      expect(isOpenWeightCodingAgent(item, index)).toBeFalse();
    }
    const top = highestAaIndexRow(openWeightCodingAgentRows(records, index));
    if (top === undefined) return;
    expect(top.aaIndex).not.toBeNull();
    const strongerOpen = openWeightCodingAgentRows(records, index).find(row => (
      row.aaIndex !== null
      && top.aaIndex !== null
      && row.aaIndex > top.aaIndex
    ));
    expect(strongerOpen).toBeUndefined();
  }));
});

test("property: AA Index gaps are the stored subtraction at one decimal", () => {
  assertProperty(fc.property(
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
    (leader, challenger) => {
      expect(formatAaIndexGap(leader, challenger)).toBe((leader - challenger).toFixed(1));
    },
  ));
});
