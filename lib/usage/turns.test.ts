import { describe, expect, test } from "bun:test";
import { assertProperty, fc } from "../property-test";
import { createFixtureBatch, fixturePolicy } from "./fixtures";
import { rollupUsageDay } from "./rollups";
import { MAX_TURN_RECORDS, MAX_TURN_RUNTIME_MS, MAX_TURN_TOOL_CALLS, rollupTurnDay, type TerminalTurn, type TurnDayInput, type TurnTokens } from "./turns";
import { DAY_MS, MAX_TOKEN_COUNT } from "./wire";

const day = 20_000, end = day * DAY_MS + 1_000;
const id = (value: number): Uint8Array => {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
};
const tokenValues = (output = 100n): TurnTokens => ({ inputUncached: 10n, cacheRead: 20n, cacheWrite5m: 0n, cacheWrite1h: 0n, output });
const turn = (key = 1, overrides: Partial<TerminalTurn> = {}): TerminalTurn => ({
  id: id(key), executionId: id(key), accountId: id(0), provider: 1, origin: 1, lineage: 1, outcome: 1,
  endedAtMs: end, startedAtMs: end - 100, clockUncertaintyMs: 0, tokens: tokenValues(), toolCalls: 2, ...overrides,
});
const input = (observations: readonly TerminalTurn[], extra: Partial<Omit<TurnDayInput, "observations">> = {}): TurnDayInput => ({
  observations, terminalCoverageComplete: true, originFilter: 0, ...extra,
});
function result(observations: readonly TerminalTurn[], extra: Partial<Omit<TurnDayInput, "observations">> = {}, selectedDay = day) {
  const value = rollupTurnDay(selectedDay, input(observations, extra));
  if (!value.ok) throw new Error(value.error);
  return value.value;
}
const invalid = (value: unknown) => expect(rollupTurnDay(day, value)).toEqual({ ok: false, error: "invalid_turn_input" });

describe("daily terminal-turn averages", () => {
  test("distinguishes unsupported, empty observed and completely enumerated empty days", () => {
    const unsupported = rollupTurnDay(day);
    expect(unsupported.ok).toBe(true);
    if (!unsupported.ok) return;
    expect(unsupported.value.available).toBe(false);
    expect(unsupported.value.completedTurns).toBeNull();
    expect(unsupported.value.runtimeMs.observedAverage).toBeNull();
    expect(result([], { terminalCoverageComplete: false }).completedTurns).toBeNull();
    expect(result([]).completedTurns).toBe(0);
    expect(result([]).runtimeMs.average).toBeNull();
    expect(result([]).available).toBe(true);
  });

  test("uses weighted sums, not averages of per-device means", () => {
    const values = [turn(1, { startedAtMs: end - 10 }), ...Array.from({ length: 9 }, (_, index) => turn(index + 2))];
    const daily = result(values);
    expect(daily.runtimeMs).toEqual({ sum: 910n, measuredTurns: 10, unmeasuredTurns: 0,
      observedAverage: { numerator: 910n, denominatorTurns: 10 }, average: { numerator: 910n, denominatorTurns: 10 } });
    expect(daily.accountedTokens.average).toEqual({ numerator: 1_300n, denominatorTurns: 10 });
    expect(daily.toolCalls.average).toEqual({ numerator: 20n, denominatorTurns: 10 });
    const partial = result(values, { terminalCoverageComplete: false });
    expect(partial.runtimeMs.observedAverage).toEqual(daily.runtimeMs.average);
    expect(partial.runtimeMs.average).toBeNull();
    expect(partial.completedTurns).toBeNull();
  });

  test("keeps each denominator independent and counts measured zero", () => {
    const zero = { inputUncached: 0n, cacheRead: 0n, cacheWrite5m: 0n, cacheWrite1h: 0n, output: 0n };
    const daily = result([
      turn(1, { startedAtMs: end, tokens: null, toolCalls: null }),
      turn(2, { startedAtMs: null, clockUncertaintyMs: null, tokens: zero, toolCalls: null }),
      turn(3, { clockUncertaintyMs: 1, tokens: null, toolCalls: 0 }),
    ]);
    for (const metric of [daily.runtimeMs, daily.accountedTokens, daily.toolCalls]) {
      expect(metric).toEqual({ sum: 0n, measuredTurns: 1, unmeasuredTurns: 2,
        observedAverage: { numerator: 0n, denominatorTurns: 1 }, average: null });
    }
    expect(daily.completedTurns).toBe(3);
    expect(result([turn(1, { clockUncertaintyMs: null })]).runtimeMs.observedAverage).toBeNull();
  });

  test("assigns the whole elapsed turn to terminal UTC day", () => {
    const crossMidnight = turn(1, { endedAtMs: day * DAY_MS, startedAtMs: day * DAY_MS - 200 });
    expect(result([crossMidnight]).runtimeMs.sum).toBe(200n);
    expect(rollupTurnDay(day - 1, input([crossMidnight]))).toEqual({ ok: false, error: "invalid_turn_input" });
    expect(result([turn(1, { startedAtMs: end - MAX_TURN_RUNTIME_MS })]).runtimeMs.sum).toBe(BigInt(MAX_TURN_RUNTIME_MS));
    invalid(input([turn(1, { startedAtMs: end - MAX_TURN_RUNTIME_MS - 1 })]));
  });

  test("separates aborted and child turns; never adds child durations or counters", () => {
    const daily = result([turn(1), turn(2, { lineage: 2, startedAtMs: end - 5_000, toolCalls: 99 }), turn(3, { outcome: 2, toolCalls: 99 })]);
    expect(daily.observedCompletedTurns).toBe(1);
    expect(daily.observedAbortedTurns).toBe(1);
    expect(daily.runtimeMs.average).toEqual({ numerator: 100n, denominatorTurns: 1 });
    expect(daily.toolCalls.sum).toBe(2n);
  });

  test("unknown lineage/origin prevent population claims for ambiguous cohorts", () => {
    const values = [turn(1), turn(2, { origin: 2 }), turn(3, { origin: 0 }), turn(4, { lineage: 0 }), turn(5, { lineage: 2 })];
    const all = result(values);
    expect(all.observedCompletedTurns).toBe(3);
    expect(all.unclassifiedCompletedTurns).toBe(1);
    expect(all.completedTurns).toBeNull();
    const human = result(values, { originFilter: 1 });
    expect(human.observedCompletedTurns).toBe(1);
    expect(human.unclassifiedCompletedTurns).toBe(2);
    expect(human.runtimeMs.average).toBeNull();
    expect(human.runtimeMs.observedAverage).toEqual({ numerator: 100n, denominatorTurns: 1 });
    const automation = result(values, { originFilter: 2 });
    expect(automation.observedCompletedTurns).toBe(1);
    expect(automation.unclassifiedCompletedTurns).toBe(1);
    const unknown = result(values, { originFilter: 3 });
    expect(unknown.observedCompletedTurns).toBe(1);
    expect(unknown.unclassifiedCompletedTurns).toBe(0);
    expect(unknown.completedTurns).toBe(1);
  });

  test("deduplicates exact copies and refuses changed identity metadata before filtering", () => {
    const first = turn();
    expect(result([first, structuredClone(first)])).toEqual(result([first]));
    for (const changed of [
      { provider: 2 as const }, { origin: 0 as const }, { lineage: 0 as const }, { outcome: 2 as const },
      { endedAtMs: end + 1 }, { startedAtMs: null, clockUncertaintyMs: null }, { clockUncertaintyMs: 1 },
      { tokens: null }, { toolCalls: null }, { toolCalls: 3 }, { accountId: id(2) }, { executionId: id(2) },
      { tokens: tokenValues(101n) },
    ]) expect(rollupTurnDay(day, input([first, turn(1, changed)], { originFilter: 2 }))).toEqual({ ok: false, error: "conflicting_turn" });
    expect(result([first, turn(2)]).observedCompletedTurns).toBe(2);
    for (const changed of [{ provider: 2 as const }, { accountId: id(1) }, { lineage: 2 as const }]) {
      expect(rollupTurnDay(day, input([first, turn(2, { ...changed, executionId: id(1) })]))).toEqual({ ok: false, error: "conflicting_turn" });
    }
    expect(result([first, turn(2, { executionId: id(1) })]).observedCompletedTurns).toBe(2);
  });

  test("resolved corrections recompute decreases, unknowns, deletion and completion-day movement", () => {
    expect(result([turn()]).runtimeMs.sum).toBe(100n);
    expect(result([turn(1, { startedAtMs: end - 20 })]).runtimeMs.sum).toBe(20n);
    expect(result([turn(1, { tokens: null })]).accountedTokens.measuredTurns).toBe(0);
    expect(result([]).runtimeMs.measuredTurns).toBe(0);
    expect(result([turn(1, { outcome: 2 })]).observedCompletedTurns).toBe(0);
    const moved = turn(1, { endedAtMs: end + DAY_MS, startedAtMs: end + DAY_MS - 100 });
    expect(result([moved], {}, day + 1).runtimeMs.sum).toBe(100n);
    expect(result([]).completedTurns).toBe(0);
  });

  test("accepts disjoint token limits and sums above Number safe range exactly", () => {
    const maximum: TurnTokens = Object.fromEntries(Object.keys(tokenValues()).map(key => [key, MAX_TOKEN_COUNT])) as TurnTokens;
    const values = Array.from({ length: 2_000 }, (_, index) => turn(index + 1, { provider: 2, tokens: maximum }));
    expect(result(values).accountedTokens.sum).toBe(10_000_000_000_000_000n);
    expect(result([turn(1, { tokens: { ...tokenValues(), output: MAX_TOKEN_COUNT } })]).accountedTokens.sum).toBe(MAX_TOKEN_COUNT + 30n);
    expect(result([turn(1, { toolCalls: MAX_TURN_TOOL_CALLS })]).toolCalls.sum).toBe(BigInt(MAX_TURN_TOOL_CALLS));
    invalid(input([turn(1, { toolCalls: MAX_TURN_TOOL_CALLS + 1 })]));
    invalid(input([turn(1, { tokens: { ...tokenValues(), output: MAX_TOKEN_COUNT + 1n } })]));
    invalid(input([turn(1, { tokens: { ...tokenValues(), cacheWrite5m: 1n } })]));
    invalid({ ...input([turn()]), observations: [{ ...turn(), tokens: { ...tokenValues(), reasoningOutput: 5n } }] });
  });

  test("bounds raw count before deduplication and rejects sparse or decorated arrays", () => {
    expect(result(Array(MAX_TURN_RECORDS).fill(turn())).observedCompletedTurns).toBe(1);
    invalid(input(Array(MAX_TURN_RECORDS + 1).fill(turn())));
    invalid(input(new Array(1)));
    const decorated = [turn()]; Object.assign(decorated, { content: "forbidden" }); invalid(input(decorated));
  });

  test("rejects malformed numeric fields, wrong days and open-turn outcomes", () => {
    for (const invalidDay of [-1, -0, 0.5, NaN, Infinity, 0x1_0000_0000]) expect(rollupTurnDay(invalidDay)).toEqual({ ok: false, error: "invalid_turn_day" });
    expect(rollupTurnDay(100_000_000).ok).toBe(true);
    expect(rollupTurnDay(0xffff_ffff).ok).toBe(true);
    for (const field of ["endedAtMs", "startedAtMs", "clockUncertaintyMs", "toolCalls", "provider", "origin", "lineage", "outcome"]) {
      for (const value of [-1, -0, NaN, Infinity, 0.5, "1", undefined]) invalid({ ...input([]), observations: [{ ...turn(), [field]: value }] });
    }
    for (const changes of [
      { endedAtMs: (day + 1) * DAY_MS }, { startedAtMs: end + 1 }, { outcome: 0 }, { lineage: 3 },
      { origin: 3 }, { provider: 3 }, { clockUncertaintyMs: 60_001 }, { startedAtMs: null },
      { tokens: { ...tokenValues(), output: -1n } }, { tokens: { ...tokenValues(), output: 1 } },
    ]) invalid({ ...input([]), observations: [{ ...turn(), ...changes }] });
    invalid({ ...input([]), terminalCoverageComplete: 1 });
    invalid({ ...input([]), originFilter: 4 });
    invalid(null);
  });

  test("rejects content/accessor/symbol fields without invoking getters or reflecting values", () => {
    let invoked = 0;
    const accessor = { ...turn() };
    Object.defineProperty(accessor, "tokens", { enumerable: true, get() { invoked += 1; throw new Error("private content"); } });
    invalid(input([accessor]));
    const array = [turn()];
    Object.defineProperty(array, "0", { enumerable: true, get() { invoked += 1; return turn(); } });
    invalid(input(array));
    const request = { ...input([]) };
    Object.defineProperty(request, "observations", { enumerable: true, get() { invoked += 1; return []; } });
    invalid(request);
    invalid({ ...input([]), observations: [{ ...turn(), text: "private content" }] });
    invalid({ ...input([]), observations: [{ ...turn(), [Symbol("content")]: 1 }] });
    const inherited = Object.create(turn()); invalid(input([inherited]));
    expect(invoked).toBe(0);
  });

  test("requires bounded unshared IDs and leaves all source bytes untouched", () => {
    for (const invalidId of [id(0), new Uint8Array(15), new Uint8Array(17), "private-id", new Uint8Array(new SharedArrayBuffer(16))]) invalid({ ...input([]), observations: [{ ...turn(), id: invalidId }] });
    const decorated = id(1); Object.defineProperty(decorated, "buffer", { get() { throw new Error("secret"); } });
    invalid(input([turn(1, { id: decorated })]));
    invalid(input([turn(1, { executionId: id(0) })]));
    const source = input([turn()]), before = structuredClone(source);
    const observed = rollupTurnDay(day, source);
    expect(source).toEqual(before);
    expect(observed.ok).toBe(true);
    source.observations[0].id.fill(2);
    if (observed.ok) expect(observed.value.observedCompletedTurns).toBe(1);
  });

  test("composes daily output without inventing hourly turn measurements", () => {
    const existing = rollupUsageDay([createFixtureBatch()], fixturePolicy);
    if (!existing.ok) throw new Error(existing.error);
    expect(existing.value.turns.available).toBe(false);
    const enhanced = rollupUsageDay([createFixtureBatch()], fixturePolicy, [], input([turn()]));
    if (!enhanced.ok) throw new Error(enhanced.error);
    expect(enhanced.value.turns.runtimeMs.observedAverage).toEqual({ numerator: 100n, denominatorTurns: 1 });
    expect(enhanced.value.day).toEqual(existing.value.day);
    expect(enhanced.value.hours).toEqual(existing.value.hours);
    expect(rollupUsageDay([createFixtureBatch()], fixturePolicy, [], null)).toEqual({ ok: false, error: "invalid_turn_input" });
    const farDay = { ...createFixtureBatch(), utcDay: 0xffff_ffff };
    expect(rollupUsageDay([farDay], { ...fixturePolicy, lastDay: 0xffff_ffff }).ok).toBe(true);
    const zeroDay = rollupUsageDay([{ ...createFixtureBatch(), utcDay: -0 }], { ...fixturePolicy, firstDay: 0 });
    if (!zeroDay.ok) throw new Error(zeroDay.error);
    expect(Object.is(zeroDay.value.utcDay, -0)).toBe(true);
    expect(zeroDay.value.turns.utcDay).toBe(0);
    expect(zeroDay.value.turns.available).toBe(false);
    expect(rollupTurnDay(-0)).toEqual({ ok: false, error: "invalid_turn_day" });
  });

  test("permutation, duplication, partition and independent sum/count oracle agree", () => {
    assertProperty(fc.property(fc.array(fc.record({
      runtime: fc.option(fc.integer({ min: 0, max: 1_000 }), { nil: null }),
      tokens: fc.option(fc.integer({ min: 0, max: 1_000 }), { nil: null }),
      tools: fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }),
    }), { maxLength: 50 }), rows => {
      const values = rows.map((row, index) => turn(index + 1, {
        startedAtMs: row.runtime === null ? null : end - row.runtime, clockUncertaintyMs: row.runtime === null ? null : 0,
        tokens: row.tokens === null ? null : { ...tokenValues(0n), inputUncached: BigInt(row.tokens), cacheRead: 0n }, toolCalls: row.tools,
      }));
      const actual = result(values), left = result(values.slice(0, 1)), right = result(values.slice(1));
      for (const [source, metric] of [["runtime", "runtimeMs"], ["tokens", "accountedTokens"], ["tools", "toolCalls"]] as const) {
        const measured = rows.map(row => row[source]).filter(value => value !== null);
        expect(actual[metric].sum).toBe(measured.reduce((sum, value) => sum + BigInt(value), 0n));
        expect(actual[metric].measuredTurns).toBe(measured.length);
        expect(actual[metric].sum).toBe(left[metric].sum + right[metric].sum);
        expect(actual[metric].measuredTurns).toBe(left[metric].measuredTurns + right[metric].measuredTurns);
      }
      expect(result([...values].reverse())).toEqual(actual);
      expect(result([...values, ...values])).toEqual(actual);
    }), { numRuns: 100 });
  });
});
