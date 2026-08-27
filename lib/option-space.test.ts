import { describe, expect, test } from "bun:test";
import type { CodingAgentRecord } from "./coding-agent-data";
import {
  computeParetoFrontier,
  computeParetoSet,
  providerPerformanceRanges,
  sampleFrontierLadder,
} from "./option-space";

function record(
  id: string,
  providerId: string,
  costUsd: number,
  aaIndex: number,
): CodingAgentRecord {
  return {
    id,
    agent: "Agent",
    model: id,
    modelLabel: id,
    providerId,
    providerName: providerId.toUpperCase(),
    seriesId: id,
    seriesLabel: id,
    setting: "default",
    settingRank: 0,
    completeIndex: true,
    benchmarks: {
      aaIndex,
      deepSwe: aaIndex - 2,
      terminalBench: aaIndex + 4,
      sweAtlas: aaIndex - 8,
    },
    economics: { costUsd, durationSeconds: costUsd * 60 },
    usage: { totalTokens: costUsd * 1_000_000 },
  };
}

describe("Pareto frontier", () => {
  test("keeps only choices that buy additional performance", () => {
    const cheap = record("cheap", "one", 1, 45);
    const dominated = record("dominated", "two", 2, 40);
    const knee = record("knee", "one", 3, 68);
    const expensiveTie = record("tie", "three", 5, 68);
    const peak = record("peak", "three", 8, 76);

    expect(computeParetoFrontier(
      [peak, dominated, expensiveTie, knee, cheap],
      "costUsd",
      "aaIndex",
    ).map(({ record: item }) => item.id)).toEqual(["cheap", "knee", "peak"]);
  });

  test("preserves exact nondominated ties and excludes missing comparisons", () => {
    const tiedOne = record("tie-one", "one", 2, 60);
    const tiedTwo = record("tie-two", "two", 2, 60);
    const dominated = record("dominated", "three", 3, 55);
    const missingCost = {
      ...record("missing", "four", 1, 90),
      economics: { costUsd: null, durationSeconds: 60 },
    };

    expect(computeParetoSet(
      [dominated, tiedTwo, missingCost, tiedOne],
      "costUsd",
      "aaIndex",
    ).map(({ record: item }) => item.id)).toEqual(["tie-one", "tie-two"]);
  });

  test("samples a compact ladder without losing either frontier edge", () => {
    const frontier = computeParetoFrontier(
      Array.from({ length: 12 }, (_, index) => record(
        String(index),
        "one",
        index + 1,
        20 + index * 4,
      )),
      "costUsd",
      "aaIndex",
    );

    const ladder = sampleFrontierLadder(frontier, 5);
    expect(ladder).toHaveLength(5);
    expect(ladder[0]?.record.id).toBe("0");
    expect(ladder.at(-1)?.record.id).toBe("11");
  });
});

test("provider ranges expose the full spread and actual median", () => {
  const ranges = providerPerformanceRanges([
    record("a", "one", 1, 30),
    record("b", "one", 2, 50),
    record("c", "one", 3, 90),
    record("d", "two", 2, 55),
    record("e", "two", 4, 75),
  ], "aaIndex");

  expect(ranges).toEqual([
    {
      count: 3,
      maximum: 90,
      median: 50,
      minimum: 30,
      providerId: "one",
      providerName: "ONE",
    },
    {
      count: 2,
      maximum: 75,
      median: 65,
      minimum: 55,
      providerId: "two",
      providerName: "TWO",
    },
  ]);
});
