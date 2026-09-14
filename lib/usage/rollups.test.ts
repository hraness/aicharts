import { describe, expect, test } from "bun:test";
import { assertProperty, fc } from "../property-test";
import { createFixtureBatch, fixturePolicy } from "./fixtures";
import { rollupUsageDay, type Coverage } from "./rollups";
import { compareIntervals, DAY_MS, type Batch, type Interval } from "./wire";

const completeCoverage: readonly Coverage[] = ["tokens", "prompts", "agent_work", "api_request"].map(kind => ({
  kind: kind as Coverage["kind"], startMs: 0, endMs: DAY_MS,
}));
const execution = (identity: number, startMs: number, endMs: number, kind: 1 | 2 = 1): Interval => ({
  executionId: new Uint8Array(16).fill(identity), accountId: new Uint8Array(16),
  startMs, endMs, provider: 1, kind, evidence: 2, clockUncertaintyMs: 0,
});
function batchWithIntervals(intervals: readonly Interval[]): Batch {
  return { utcDay: 20_000, registryRevision: 1, usage: [], prompts: [], intervals: [...intervals].sort(compareIntervals) };
}
function rollup(batch: Batch, coverage: readonly Coverage[] = completeCoverage) {
  const result = rollupUsageDay([batch], fixturePolicy, coverage);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("usage measurement rollups", () => {
  test("unions overlap per execution across devices before half-open peak sweep", () => {
    const first = batchWithIntervals([execution(1, 0, 1_000), execution(2, 500, 1_500)]);
    const second = batchWithIntervals([execution(1, 500, 1_500), execution(3, 1_500, 2_000)]);
    const result = rollupUsageDay([first, second, first], fixturePolicy, completeCoverage);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.day.peakAgents).toBe(2);
    expect(result.value.day.activityMs).toBe(2_000);
    expect(result.value.day.peakApiRequests).toBe(0);
    expect(result.value.activity15Minutes[0].activityFraction).toBe(2_000 / 900_000);
  });

  test("keeps 15-minute activity, 16-minute peak and request concurrency independent", () => {
    const result = rollup(batchWithIntervals([
      execution(1, 899_000, 901_000), execution(2, 901_000, 959_000),
      execution(3, 958_000, 961_000), execution(4, 0, 1_000, 2),
    ]));
    expect(result.activity15Minutes).toHaveLength(96);
    expect(result.concurrency16Minutes).toHaveLength(90);
    expect(result.hours).toHaveLength(24);
    expect(result.activity15Minutes[0].activityMs).toBe(1_000);
    expect(result.activity15Minutes[1].activityMs).toBe(61_000);
    expect(result.concurrency16Minutes[0].peakAgents).toBe(2);
    expect(result.concurrency16Minutes[1].peakAgents).toBe(1);
    expect(result.day.peakApiRequests).toBe(1);
  });

  test("does not convert missing coverage, unknown origin, or uncertain time into certainty", () => {
    const fixture = createFixtureBatch(), unknown = rollup(fixture, []);
    expect(unknown.day.accountedTokens).toBeNull();
    expect(unknown.day.observedAccountedTokens).toBe(1_368n);
    expect(unknown.day.observedOutputTokens).toBe(789n);
    expect(unknown.day.observedOutputTokensPerSecond).toEqual({ numerator: 789n, denominatorSeconds: 86_400 });
    expect(unknown.day.activityMs).toBeNull();
    expect(unknown.day.peakAgents).toBeNull();
    const covered = rollup(fixture);
    expect(covered.day.accountedTokens).toBe(1_368n);
    expect(covered.day.unknownOriginPrompts).toBe(1);
    expect(covered.day.humanPrompts).toBeNull();
    expect(covered.day.peakAgents).toBeNull();
    expect(covered.day.observedPeakAgents).toBe(1);
    const boundary = rollup(batchWithIntervals([{ ...execution(1, 900_000, 901_000), clockUncertaintyMs: 1 }]));
    expect(boundary.activity15Minutes[0].activityMs).toBeNull();
    expect(boundary.activity15Minutes[0].observedActivityMs).toBe(0);
    expect(boundary.activity15Minutes[2].activityMs).toBe(0);
  });

  test("counts known human prompts separately and preserves hourly completion-token rates", () => {
    const fixture = createFixtureBatch();
    const batch: Batch = { ...fixture, prompts: [
      { ...fixture.prompts[0], id: new Uint8Array(16).fill(4), origin: 1 },
      { ...fixture.prompts[0], id: new Uint8Array(16).fill(5), origin: 2, offsetMs: 3_600_000 },
    ] };
    const result = rollupUsageDay([batch, batch], fixturePolicy, completeCoverage);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.day.accountedTokens).toBe(1_368n);
    expect(result.value.day.confirmedHumanPrompts).toBe(1);
    expect(result.value.day.automationPrompts).toBe(1);
    expect(result.value.day.humanPrompts).toBe(1);
    expect(result.value.hours[0].outputTokensPerSecond).toEqual({ numerator: 789n, denominatorSeconds: 3_600 });
    expect(result.value.hours[1].confirmedHumanPrompts).toBe(0);
    expect(result.value.hours[1].automationPrompts).toBe(1);
    expect(result.value.activity15Minutes[0].accountedTokensPerSecond).toEqual({ numerator: 1_368n, denominatorSeconds: 900 });
  });

  test("rejects changed finalized events and inconsistent execution identity", () => {
    const fixture = createFixtureBatch();
    expect(rollupUsageDay([fixture, { ...fixture, usage: [{ ...fixture.usage[0], offsetMs: 1_235 }] }], fixturePolicy)).toEqual({ ok: false, error: "conflicting_occurrence" });
    expect(rollupUsageDay([
      batchWithIntervals([execution(1, 0, 1_000)]),
      batchWithIntervals([{ ...execution(1, 1_000, 2_000), provider: 2 }]),
    ], fixturePolicy)).toEqual({ ok: false, error: "conflicting_execution" });
    expect(rollupUsageDay([fixture], fixturePolicy, [{ kind: "tokens", startMs: 0, endMs: DAY_MS + 1 }])).toEqual({ ok: false, error: "invalid_coverage" });
  });

  test("merges coverage overlap without inflating completeness", () => {
    const result = rollup(createFixtureBatch(), [
      { kind: "tokens", startMs: 0, endMs: 500_000 }, { kind: "tokens", startMs: 400_000, endMs: 900_000 },
    ]);
    expect(result.activity15Minutes[0].accountedTokens).toBe(1_368n);
    expect(result.activity15Minutes[1].accountedTokens).toBeNull();
    expect(result.day.coverageMs.tokens).toBe(900_000);
    expect(result.day.accountedTokens).toBeNull();
  });

  test("interval union, duplicate invariance and peak match an independent discrete oracle", () => {
    assertProperty(fc.property(fc.array(fc.record({
      identity: fc.integer({ min: 1, max: 4 }), start: fc.integer({ min: 0, max: 28 }), length: fc.integer({ min: 1, max: 30 }),
    }), { minLength: 1, maxLength: 30 }), generated => {
      const intervals = generated.map(value => execution(value.identity, value.start * 1_000, Math.min(30, value.start + value.length) * 1_000));
      const unique = [...new Map(intervals.map(value => [`${value.executionId[0]}:${value.startMs}:${value.endMs}`, value])).values()];
      const batch = batchWithIntervals(unique), result = rollup(batch);
      let activeSeconds = 0, peak = 0;
      for (let second = 0; second < 30; second += 1) {
        const active = new Set(intervals.filter(value => value.startMs <= second * 1_000 && value.endMs > second * 1_000).map(value => value.executionId[0]));
        if (active.size > 0) activeSeconds += 1;
        peak = Math.max(peak, active.size);
      }
      expect(result.day.activityMs).toBe(activeSeconds * 1_000);
      expect(result.day.peakAgents).toBe(peak);
      expect(result.activity15Minutes.reduce((sum, window) => sum + window.activityMs!, 0)).toBe(result.day.activityMs!);
      expect(rollupUsageDay([batch, batch], fixturePolicy, completeCoverage)).toEqual({ ok: true, value: result });
    }), { numRuns: 100 });
  });
});
