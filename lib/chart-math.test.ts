import { describe, expect, test } from "bun:test";
import type { CodingAgentRecord } from "./coding-agent-data";
import {
  computeDomain,
  formatMetricValue,
  isInPerformanceTier,
  linearScale,
  makeNiceTicks,
  makeTicks,
  recordsWithMetrics,
  xMetricValue,
  yMetricValue,
} from "./chart-math";

function record(
  id: string,
  values: {
    costUsd: number | null;
    durationSeconds: number | null;
    aaIndex: number | null;
    deepSwe: number | null;
    sweAtlas?: number | null;
    terminalBench?: number | null;
    totalTokens?: number | null;
  },
): CodingAgentRecord {
  return {
    id,
    agent: "Codex CLI",
    model: id,
    modelLabel: id,
    providerId: "provider",
    providerName: "Provider",
    seriesId: id,
    seriesLabel: id,
    setting: "default",
    settingRank: 0,
    completeIndex: true,
    benchmarks: {
      aaIndex: values.aaIndex,
      deepSwe: values.deepSwe,
      terminalBench: values.terminalBench ?? null,
      sweAtlas: values.sweAtlas ?? null,
    },
    economics: {
      costUsd: values.costUsd,
      durationSeconds: values.durationSeconds,
    },
    usage: { totalTokens: values.totalTokens ?? null },
  };
}

const complete = record("complete", {
  costUsd: 12.5,
  durationSeconds: 750,
  aaIndex: 78,
  deepSwe: 64,
  sweAtlas: 72,
  terminalBench: 86,
  totalTokens: 1_250_000,
});

describe("chart metric selection", () => {
  test("converts seconds to minutes and selects benchmark values", () => {
    expect(xMetricValue(complete, "costUsd")).toBe(12.5);
    expect(xMetricValue(complete, "durationMinutes")).toBe(12.5);
    expect(xMetricValue(complete, "totalTokens")).toBe(1_250_000);
    expect(yMetricValue(complete, "aaIndex")).toBe(78);
    expect(yMetricValue(complete, "deepSwe")).toBe(64);
    expect(yMetricValue(complete, "terminalBench")).toBe(86);
    expect(yMetricValue(complete, "sweAtlas")).toBe(72);
  });

  test("filters only records with both selected metrics", () => {
    const missingCost = record("missing-cost", {
      costUsd: null,
      durationSeconds: 600,
      aaIndex: 50,
      deepSwe: 40,
    });
    const missingDeepSwe = record("missing-deep-swe", {
      costUsd: 2,
      durationSeconds: 600,
      aaIndex: 50,
      deepSwe: null,
    });
    const missingTokens = record("missing-tokens", {
      costUsd: 2,
      durationSeconds: 600,
      aaIndex: 50,
      deepSwe: 40,
      sweAtlas: 35,
      totalTokens: null,
    });

    expect(recordsWithMetrics([complete, missingCost, missingDeepSwe, missingTokens], "costUsd", "deepSwe").map(({ id }) => id))
      .toEqual(["complete", "missing-tokens"]);
    expect(recordsWithMetrics([complete, missingCost, missingDeepSwe, missingTokens], "totalTokens", "sweAtlas").map(({ id }) => id))
      .toEqual(["complete"]);
    expect(recordsWithMetrics([complete, missingCost, missingDeepSwe, missingTokens], "durationMinutes", "aaIndex").map(({ id }) => id))
      .toEqual(["complete", "missing-cost", "missing-deep-swe", "missing-tokens"]);
  });

  test("groups horizontal peers inside an inclusive benchmark band", () => {
    expect(isInPerformanceTier(70.8, 70.8)).toBe(true);
    expect(isInPerformanceTier(67.05, 70.8)).toBe(true);
    expect(isInPerformanceTier(74.55, 70.8)).toBe(true);
    expect(isInPerformanceTier(67.04, 70.8)).toBe(false);
    expect(isInPerformanceTier(Number.NaN, 70.8)).toBe(false);
    expect(() => isInPerformanceTier(70, 70, -1)).toThrow(RangeError);
  });
});

describe("chart domains, scales, and ticks", () => {
  test("ignores non-finite values and pads a zero-based domain", () => {
    const domain = computeDomain([Number.NaN, Number.POSITIVE_INFINITY, 10, 20], {
      includeZero: true,
      minimum: 0,
    });

    expect(domain[0]).toBe(0);
    expect(domain[1]).toBeGreaterThan(20);
  });

  test("returns safe domains for empty and constant inputs", () => {
    expect(computeDomain([])).toEqual([0, 1]);
    const constant = computeDomain([42, 42]);
    expect(constant[0]).toBeLessThan(42);
    expect(constant[1]).toBeGreaterThan(42);
  });

  test("can fit a varying domain to its exact observed extent", () => {
    expect(computeDomain([
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      4.25,
      12.5,
      Number.POSITIVE_INFINITY,
    ], { paddingRatio: 0 })).toEqual([4.25, 12.5]);
  });

  test("maps endpoints and supports inverted screen ranges", () => {
    const scale = linearScale([20, 80], [500, 20]);
    expect(scale(20)).toBe(500);
    expect(scale(50)).toBe(260);
    expect(scale(80)).toBe(20);
  });

  test("generates the requested number of inclusive, even ticks", () => {
    expect(makeTicks([10, 30], 5)).toEqual([10, 15, 20, 25, 30]);
    expect(makeTicks([10, 30], 1)).toEqual([10, 30]);
  });

  test("rounds domains outward to readable decimal ticks", () => {
    expect(makeNiceTicks([0, 12.34], 6)).toEqual([0, 2.5, 5, 7.5, 10, 12.5]);
    expect(makeNiceTicks([33.9, 83.4], 6)).toEqual([30, 40, 50, 60, 70, 80, 90]);
    expect(makeNiceTicks([-3.2, 8.1], 6)).toEqual([-5, -2.5, 0, 2.5, 5, 7.5, 10]);
  });

  test("creates a useful extent for a constant domain", () => {
    const ticks = makeNiceTicks([42, 42], 6);
    expect(ticks[0]).toBeLessThanOrEqual(42);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(42);
    expect(ticks.length).toBeGreaterThan(1);
  });

  test("rejects non-finite and descending domains", () => {
    expect(() => makeNiceTicks([0, Number.POSITIVE_INFINITY])).toThrow(RangeError);
    expect(() => makeNiceTicks([10, 0])).toThrow(RangeError);
  });

  test("formats values for their selected axis", () => {
    expect(formatMetricValue("costUsd", 4.25)).toBe("$4.25");
    expect(formatMetricValue("costUsd", 12.5)).toBe("$12.5");
    expect(formatMetricValue("costUsd", 1250)).toBe("$1,250");
    expect(formatMetricValue("durationMinutes", 4.25)).toBe("4.3m");
    expect(formatMetricValue("totalTokens", 980)).toBe("980");
    expect(formatMetricValue("totalTokens", 12_500)).toBe("12.5K");
    expect(formatMetricValue("totalTokens", 13_240_000)).toBe("13.2M");
    expect(formatMetricValue("aaIndex", 72.34)).toBe("72.3");
  });
});
