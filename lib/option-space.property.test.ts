import { expect, test } from "bun:test";
import { assertProperty, fc } from "./property-test";
import type { CodingAgentRecord } from "./coding-agent-data";
import { computeParetoFrontier, computeParetoSet, providerPerformanceRanges } from "./option-space";

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
    expect(
      computeParetoSet(records, "costUsd", "aaIndex").map(({ record: item }) => item.id),
    ).toEqual(
      computeParetoSet(reversed, "costUsd", "aaIndex").map(({ record: item }) => item.id),
    );
    expect(providerPerformanceRanges(records, "aaIndex"))
      .toEqual(providerPerformanceRanges(reversed, "aaIndex"));
  }), { numRuns: 500 });
});

test("property: the Pareto set contains every tie and only nondominated choices", () => {
  assertProperty(fc.property(generatedRecords, (records) => {
    const pareto = computeParetoSet(records, "costUsd", "aaIndex");
    const paretoIds = new Set(pareto.map(({ record: item }) => item.id));

    for (const candidate of records) {
      const xValue = candidate.economics.costUsd;
      const yValue = candidate.benchmarks.aaIndex;
      if (xValue === null || yValue === null) continue;
      const strictDominator = records.find(other => {
        const otherX = other.economics.costUsd;
        const otherY = other.benchmarks.aaIndex;
        return otherX !== null
          && otherY !== null
          && otherX <= xValue
          && otherY >= yValue
          && (otherX < xValue || otherY > yValue);
      });
      expect(paretoIds.has(candidate.id)).toBe(strictDominator === undefined);
    }
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

test("property: distinct collation-equivalent IDs retain deterministic ties", () => {
  assertProperty(fc.property(
    fc.integer({ min: 0, max: 10_000 }),
    fc.integer({ min: 0, max: 100 }),
    fc.shuffledSubarray(["é", "e\u0301", "Å", "A\u030a"], { minLength: 4, maxLength: 4 }),
    (cost, score, ids) => {
      const records = ids.map(id => ({ ...record(id, id, cost, score), providerName: "Same public name" }));
      const reversed = records.toReversed();
      expect(computeParetoFrontier(records, "costUsd", "aaIndex"))
        .toEqual(computeParetoFrontier(reversed, "costUsd", "aaIndex"));
      expect(computeParetoSet(records, "costUsd", "aaIndex")).toHaveLength(4);
      expect(computeParetoSet(records, "costUsd", "aaIndex"))
        .toEqual(computeParetoSet(reversed, "costUsd", "aaIndex"));
      expect(providerPerformanceRanges(records, "aaIndex"))
        .toEqual(providerPerformanceRanges(reversed, "aaIndex"));
    },
  ), { numRuns: 100 });
});

test("provider aliases use the same display label in every row order", () => {
  const rows = ["Lab new", "Lab old", "Lab old"].map((providerName, index) => ({
    ...record(String(index), "same-provider", index + 1, 50), providerName,
  }));
  expect(providerPerformanceRanges(rows, "aaIndex"))
    .toEqual(providerPerformanceRanges(rows.toReversed(), "aaIndex"));
});
