import { expect, test } from "bun:test";

import type { CodingAgentRecord } from "./coding-agent-data";
import { codingAgentSnapshotRows } from "./coding-agent-snapshot-rows";
import {
  CLOSED_WEIGHT_PROVIDER_IDS,
  OPEN_WEIGHT_PROVIDER_IDS,
  UNCLASSIFIED_WEIGHT_PROVIDER_IDS,
  codingAgentWeightClass,
  formatAaIndexGap,
  highestAaIndexRow,
  isOpenWeightCodingAgent,
  openWeightCodingAgentRows,
  uncataloguedSnapshotProviderIds,
} from "./open-weight-coding-agents";
import { assertProperty, fc } from "./property-test";

const providerIdArb = fc.constantFrom(
  ...OPEN_WEIGHT_PROVIDER_IDS,
  ...CLOSED_WEIGHT_PROVIDER_IDS,
  ...UNCLASSIFIED_WEIGHT_PROVIDER_IDS,
  "unknown_lab",
);

const generatedRecords = fc.array(
  fc.record({
    aaIndex: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    agent: fc.constantFrom("Codex", "Claude Code", "Kimi Code CLI"),
    model: fc.constantFrom("Kimi K3", "GLM-5.2", "Opus 5", "Muse Spark 1.2"),
    providerId: providerIdArb,
    setting: fc.constantFrom("default", "max", "xhigh"),
    suffix: fc.integer({ min: 0, max: 10_000 }),
  }),
  { maxLength: 24 },
).map((items): CodingAgentRecord[] => items.map((item, index) => ({
  agent: item.agent,
  benchmarks: {
    aaIndex: item.aaIndex,
    deepSwe: null,
    sweAtlas: null,
    terminalBench: null,
  },
  completeIndex: true,
  economics: { costUsd: 1, durationSeconds: null },
  id: `${item.suffix}:${index}`,
  model: item.model,
  modelLabel: item.model,
  providerId: item.providerId,
  providerName: item.providerId,
  seriesId: `${item.providerId}:${item.model}:${index}`,
  seriesLabel: `${item.model}`,
  setting: item.setting,
  settingRank: 0,
  usage: { totalTokens: null },
})));

test("property: open-weight rows are exactly the allowlisted subset", () => {
  assertProperty(fc.property(generatedRecords, (records) => {
    const openRows = openWeightCodingAgentRows(records);
    const expected = codingAgentSnapshotRows(records).filter(row => {
      const source = records.find(candidate => candidate.id === row.id);
      return source !== undefined && isOpenWeightCodingAgent(source);
    });
    expect(openRows).toEqual(expected);
    for (const row of openRows) {
      const source = records.find(candidate => candidate.id === row.id);
      expect(source).toBeDefined();
      if (source === undefined) continue;
      expect(codingAgentWeightClass(source.providerId)).toBe("open");
      expect(
        (OPEN_WEIGHT_PROVIDER_IDS as readonly string[]).includes(source.providerId),
      ).toBeTrue();
    }
  }));
});

test("property: unknown providers stay unclassified and out of the open set", () => {
  assertProperty(fc.property(generatedRecords, (records) => {
    const unknown = records.filter(record => record.providerId === "unknown_lab");
    expect(uncataloguedSnapshotProviderIds(unknown)).toEqual(
      unknown.length === 0 ? [] : ["unknown_lab"],
    );
    for (const record of unknown) {
      expect(codingAgentWeightClass(record.providerId)).toBe("unclassified");
      expect(isOpenWeightCodingAgent(record)).toBeFalse();
    }
    const top = highestAaIndexRow(openWeightCodingAgentRows(records));
    if (top === undefined) return;
    expect(top.aaIndex).not.toBeNull();
    const strongerOpen = openWeightCodingAgentRows(records).find(row => (
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
