import { expect, test } from "bun:test";
import { assertProperty, fc } from "./property-test";
import type { CodingAgentRecord } from "./coding-agent-data";
import { computeParetoFrontier, providerPerformanceRanges } from "./option-space";

function record(id: string, providerId: string, costUsd: number, aaIndex: number): CodingAgentRecord {
  return {
    id,
    agent: "Generated",
    model: id,
    modelLabel: id,
    providerId,
    providerName: providerId,
    seriesId: id,
    seriesLabel: id,
    setting: "default",
    settingRank: 0,
    completeIndex: true,
    benchmarks: { aaIndex, deepSwe: aaIndex, sweAtlas: aaIndex, terminalBench: aaIndex },
    economics: { costUsd, durationSeconds: costUsd * 60 },
    usage: { totalTokens: costUsd * 1_000 },
  };
}

const generatedRecords = fc.array(
  fc.record({
    aaIndex: fc.integer({ min: 0, max: 100 }),
    costUsd: fc.integer({ min: 0, max: 10_000 }),
    provider: fc.integer({ min: 0, max: 8 }),
  }),
  { maxLength: 80 },
).map((items) => items.map((item, index) => (
  record(String(index), `provider-${String(item.provider)}`, item.costUsd, item.aaIndex)
)));

test("property: every choice is weakly dominated by a frontier choice", () => {
  assertProperty(fc.property(generatedRecords, (records) => {
    const frontier = computeParetoFrontier(records, "costUsd", "aaIndex");
    for (const recordItem of records) {
      const dominator = frontier.find(({ xValue, yValue }) => (
        xValue <= (recordItem.economics.costUsd ?? Number.POSITIVE_INFINITY)
        && yValue >= (recordItem.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY)
      ));
      expect(dominator).toBeDefined();
    }
    for (let index = 1; index < frontier.length; index += 1) {
      const previous = frontier[index - 1];
      const current = frontier[index];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      if (previous !== undefined && current !== undefined) {
        expect(current.xValue).toBeGreaterThanOrEqual(previous.xValue);
        expect(current.yValue).toBeGreaterThan(previous.yValue);
      }
    }
  }), { numRuns: 500 });
});

test("property: frontier and provider summaries ignore input order", () => {
  assertProperty(fc.property(generatedRecords, (records) => {
    const reversed = records.toReversed();
    expect(
      computeParetoFrontier(records, "costUsd", "aaIndex").map(({ record: item }) => item.id),
    ).toEqual(
      computeParetoFrontier(reversed, "costUsd", "aaIndex").map(({ record: item }) => item.id),
    );
    expect(providerPerformanceRanges(records, "aaIndex"))
      .toEqual(providerPerformanceRanges(reversed, "aaIndex"));
  }), { numRuns: 500 });
});

test("property: provider ranges enclose their medians", () => {
  assertProperty(fc.property(generatedRecords, (records) => {
    for (const range of providerPerformanceRanges(records, "aaIndex")) {
      expect(range.count).toBeGreaterThan(0);
      expect(range.minimum).toBeLessThanOrEqual(range.median);
      expect(range.median).toBeLessThanOrEqual(range.maximum);
    }
  }), { numRuns: 500 });
});
