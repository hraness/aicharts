import { expect, test } from "bun:test";
import { MAX_CONTRIBUTION_ROLLUP_CELLS, MAX_CONTRIBUTION_ROLLUP_DELTAS, MAX_CONTRIBUTION_ROLLUP_VALUE,
  contributionCellKey, contributionRowCellKey, parseContributionCell, planContributionRollups, type ContributionCell, type ResolvedContributionDelta } from "./contribution-rollups";
import { parseUsageStatsRow, STATS_MAX_TOKENS_PER_RECORD, STATS_TOKEN_KEYS, type UsageStatsRow } from "./stats-contract";

const id = (value: number) => value.toString(16).padStart(32, "0");
const row = (input: string, changes: Partial<UsageStatsRow> = {}): UsageStatsRow => {
  const result = parseUsageStatsRow({ utcDay: 20_000, client: "codex", provider: null, model: null,
    tokens: { input, cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, records: 1,
    reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete", ...changes });
  if (!result) throw new Error("synthetic row invalid"); return result;
};
function store() {
  const cells = new Map<string, ContributionCell>();
  const apply = (deltas: readonly ResolvedContributionDelta[]) => {
    const result = planContributionRollups(key => cells.get(key) ?? null, deltas, cells.size);
    if (!result.ok) throw new Error(result.error);
    for (const change of result.value) {
      if (change.after) cells.set(change.key, change.after); else cells.delete(change.key);
    }
    return result.value;
  };
  return { cells, apply };
}
test("moving corrections and removals conserve independent numeric totals and empty cells disappear", () => {
  const f = store(), before = row("120"), distinct = row("15"), moved = row("18", { utcDay: 20_001, model: "gpt-5" });
  f.apply([{ id: id(1), before: null, after: before }, { id: id(2), before: null, after: distinct }]);
  expect([...f.cells.values()].map(cell => [cell.observations, cell.tokens.input])).toEqual([[2, "135"]]);
  const changes = f.apply([{ id: id(1), before, after: moved }]);
  expect(changes).toHaveLength(2);
  expect([...f.cells.values()].reduce((sum, cell) => sum + BigInt(cell.tokens.input), 0n)).toBe(33n);
  f.apply([{ id: id(2), before: distinct, after: null }]);
  expect(f.cells.size).toBe(1);
  f.apply([{ id: id(1), before: moved, after: null }]); expect(f.cells.size).toBe(0);
});
test("cost, category, timing and token-basis eligibility never collapse into an untraceable cohort", () => {
  const f = store();
  const values = [row("1"), row("1", { breakdownCoverage: "partial" }), row("1", { tokenBasis: "estimated" }),
    row("1", { reportedCostMicrousd: "0", reportedCostRecords: 1 }), row("1", { estimatedCostMicrousd: "2", estimatedCostRecords: 1 }),
    row("1", { durationMs: "0", timedRecords: 1, timedTokens: "1" }),
    row("0", { tokenBasis: "unavailable", breakdownCoverage: "partial", reportedCostMicrousd: "8", reportedCostRecords: 1 })];
  f.apply(values.map((value, index) => ({ id: id(index + 1), before: null, after: value })));
  expect(f.cells.size).toBe(values.length);
  expect(values.map(value => contributionRowCellKey(value)).sort()).toEqual([...f.cells.keys()].sort());
  expect(contributionRowCellKey({ ...values[0], records: 2 })).toBeNull();
  const zeroPrice = [...f.cells.values()].find(cell => cell.dimensions.costKind === "reported" && cell.dimensions.tokenBasis === "reported")!;
  expect(zeroPrice.costMicrousd).toBe("0");
  expect([...f.cells.values()].find(cell => cell.dimensions.timed)!.durationMs).toBe("0");
  expect([...f.cells.values()].find(cell => cell.dimensions.costKind === "none")!.costMicrousd).toBeNull();
});
test("admitted sums stay exact at the per-record bound without lossy Number conversion", () => {
  // Deltas require records=1, so the per-record bound caps each admitted
  // row at 8,388,608 tokens; cell sums stay bigint-exact regardless.
  const f = store(), maximum = row(String(STATS_MAX_TOKENS_PER_RECORD));
  f.apply([{ id: id(1), before: null, after: maximum }, { id: id(2), before: null, after: maximum }]);
  const cell = [...f.cells.values()][0]; expect(cell.tokens.input).toBe("16777216");
  expect(parseContributionCell(cell)).toEqual(cell);
  f.apply([{ id: id(1), before: maximum, after: null }]);
  expect([...f.cells.values()][0].tokens.input).toBe(maximum.tokens.input);
});
test("underflow, wrong last-row retraction, count limits and u128 overflow return no writable patch", () => {
  const f = store(), original = row("5"); f.apply([{ id: id(1), before: null, after: original }]);
  const read = (key: string) => f.cells.get(key) ?? null, before = JSON.stringify([...f.cells]);
  for (const source of [row("6"), row("4")])
    expect(planContributionRollups(read, [{ id: id(1), before: source, after: null }], 1)).toEqual({ ok: false, error: "invalid_projection" });
  const existing = [...f.cells.values()][0], huge = { ...existing, tokens: { ...existing.tokens, input: MAX_CONTRIBUTION_ROLLUP_VALUE.toString() } };
  expect(parseContributionCell(huge)).not.toBeNull();
  expect(planContributionRollups(() => huge, [{ id: id(2), before: null, after: row("1") }], 1)).toEqual({ ok: false, error: "overflow" });
  expect(planContributionRollups(() => null, [{ id: id(2), before: null, after: row("1") }], MAX_CONTRIBUTION_ROLLUP_CELLS))
    .toEqual({ ok: false, error: "capacity" });
  expect(planContributionRollups(() => ({ ...existing, observations: MAX_CONTRIBUTION_ROLLUP_CELLS }), [{ id: id(2), before: null, after: row("1") }], 1))
    .toEqual({ ok: false, error: "capacity" });
  expect(JSON.stringify([...f.cells])).toBe(before);
});
test("cell shapes and impossible denominator states refuse, and delta identities are bounded and unique", () => {
  const f = store(); f.apply([{ id: id(1), before: null, after: row("1") }]); const cell = [...f.cells.values()][0];
  for (const value of [{ ...cell, observations: 0 }, { ...cell, observations: -0 }, { ...cell, costMicrousd: "0" },
    { ...cell, timedTokens: "1" }, { ...cell, tokens: { ...cell.tokens, input: "01" } },
    { ...cell, dimensions: { ...cell.dimensions, model: "PRIVATE_MODEL_CANARY" } },
    { ...cell, dimensions: { ...cell.dimensions, tokenBasis: "unavailable" } }]) expect(parseContributionCell(value)).toBeNull();
  const change = { id: id(2), before: null, after: row("2") };
  expect(planContributionRollups(() => null, [change, change], 0)).toEqual({ ok: false, error: "invalid_input" });
  expect(planContributionRollups(() => null, Array(MAX_CONTRIBUTION_ROLLUP_DELTAS + 1).fill(change), 0))
    .toEqual({ ok: false, error: "invalid_input" });
  expect(planContributionRollups(() => null, [{ ...change, after: { ...change.after, records: 2 } }], 0))
    .toEqual({ ok: false, error: "invalid_input" });
});
test("simultaneous swapping retracts all predecessors before adding, preserving the bounded result", () => {
  const f = store(), a = row("5"), b = row("7");
  f.apply([{ id: id(1), before: null, after: a }, { id: id(2), before: null, after: b }]);
  expect(f.apply([{ id: id(1), before: a, after: b }, { id: id(2), before: b, after: a }])).toEqual([]);
});
test("delta admission never invokes custom iteration or indexed getters", () => {
  let invoked = 0;
  const accessor: unknown[] = [];
  Object.defineProperty(accessor, "0", { enumerable: true, get() { invoked++; return null; } });
  const iterable = { length: 0, *[Symbol.iterator]() { invoked++; yield null; } };
  const extra = Object.assign([], { extra: true });
  for (const value of [accessor, iterable, extra, Array(1)])
    expect(planContributionRollups(() => { invoked++; return null; }, value as ResolvedContributionDelta[], 0))
      .toEqual({ ok: false, error: "invalid_input" });
  expect(invoked).toBe(0);
});
test("five token categories and separately timed totals retract without category substitution", () => {
  const f = store(), first = row("2", { tokens: { input: "2", cacheRead: "3", cacheWrite: "5", output: "7", reasoning: "11" },
    durationMs: "13", timedRecords: 1, timedTokens: "17" }), second = row("19", {
    tokens: { input: "19", cacheRead: "23", cacheWrite: "29", output: "31", reasoning: "37" },
    durationMs: "41", timedRecords: 1, timedTokens: "43" });
  f.apply([{ id: id(1), before: null, after: first }, { id: id(2), before: null, after: second }]);
  expect([...f.cells.values()][0].tokens).toEqual({ input: "21", cacheRead: "26", cacheWrite: "34", output: "38", reasoning: "48" });
  expect([...f.cells.values()][0].timedTokens).toBe("60");
  f.apply([{ id: id(1), before: first, after: null }]);
  expect([...f.cells.values()][0].tokens).toEqual(second.tokens); expect([...f.cells.values()][0].durationMs).toBe("41");
  f.apply([{ id: id(2), before: second, after: null }]); expect(f.cells.size).toBe(0);
});
test("three seeded correction schedules equal a separate full history fold after every accepted patch", () => {
  for (const seed of [1066793, 539363619, 1592639710]) {
    let random = seed; const f = store(), history = new Map<string, UsageStatsRow>();
    const next = () => random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    for (let step = 0; step < 200; step++) {
      const subject = id(next() % 24 + 1), before = history.get(subject) ?? null, amount = String(next() % 999);
      const priced = next() % 3, timed = next() % 2;
      const after = before && next() % 7 === 0 ? null : row(amount, { utcDay: 20_000 + next() % 7,
        model: next() % 2 ? "gpt-5" : null, breakdownCoverage: next() % 2 ? "complete" : "partial",
        reportedCostMicrousd: priced === 1 ? amount : null, reportedCostRecords: priced === 1 ? 1 : 0,
        estimatedCostMicrousd: priced === 2 ? amount : null, estimatedCostRecords: priced === 2 ? 1 : 0,
        durationMs: timed ? "20" : null, timedRecords: timed, timedTokens: timed ? amount : "0" });
      f.apply([{ id: subject, before, after }]);
      if (after) history.set(subject, after); else history.delete(subject);
      // This oracle scans retained observations and uses its own grouping and
      // numeric sums; it does not invoke the production patch/fold functions.
      const expected = new Map<string, { count: number; input: bigint; cost: bigint; ms: bigint; timed: bigint }>();
      for (const item of history.values()) {
        const key = JSON.stringify([item.utcDay, item.client, item.provider, item.model, item.tokenBasis, item.breakdownCoverage,
          item.reportedCostMicrousd !== null ? "reported" : item.estimatedCostMicrousd !== null ? "estimated" : "none", item.durationMs !== null]);
        const sum = expected.get(key) ?? { count: 0, input: 0n, cost: 0n, ms: 0n, timed: 0n };
        sum.count++; sum.input += BigInt(item.tokens.input); sum.cost += BigInt(item.reportedCostMicrousd ?? item.estimatedCostMicrousd ?? "0");
        sum.ms += BigInt(item.durationMs ?? "0"); sum.timed += BigInt(item.timedTokens); expected.set(key, sum);
      }
      expect(f.cells.size).toBe(expected.size);
      for (const [key, cell] of f.cells) {
        expect(contributionCellKey(cell.dimensions)).toBe(key);
        expect({ count: cell.observations, input: BigInt(cell.tokens.input), cost: BigInt(cell.costMicrousd ?? "0"),
          ms: BigInt(cell.durationMs ?? "0"), timed: BigInt(cell.timedTokens) }).toEqual(expected.get(key)!);
        expect(STATS_TOKEN_KEYS.reduce((total, token) => total + BigInt(cell.tokens[token]), 0n)).toBe(expected.get(key)!.input);
      }
    }
  }
});
