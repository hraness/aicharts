import { expect, test } from "bun:test";
import { contributionCellKey, MAX_CONTRIBUTION_ROLLUP_CELLS, MAX_CONTRIBUTION_ROLLUP_VALUE, parseContributionCell,
  planContributionRollups, type ContributionCell } from "./contribution-rollups";
import { contributionRebuildRowCellKey, planContributionRebuildCells, type ContributionRebuildInput } from "./contribution-rebuild";
import { parseUsageStatsRow, type UsageStatsRow } from "./stats-contract";

const id = (value: number) => value.toString(16).padStart(32, "0");
function row(day = 20, amount = "1", priced: "reported" | "estimated" | "none" = "none", timed = false): UsageStatsRow {
  const value = parseUsageStatsRow({ utcDay: day, client: "claude", provider: null, model: null, records: 1,
    tokens: { input: amount, cacheRead: "2", cacheWrite: "3", output: "4", reasoning: "5" },
    reportedCostMicrousd: priced === "reported" ? "7" : null, reportedCostRecords: priced === "reported" ? 1 : 0,
    estimatedCostMicrousd: priced === "estimated" ? "11" : null, estimatedCostRecords: priced === "estimated" ? 1 : 0,
    durationMs: timed ? "0" : null, timedRecords: timed ? 1 : 0, timedTokens: timed ? amount : "0",
    tokenBasis: "reported", breakdownCoverage: "partial" });
  if (!value) throw new Error("invalid rebuild fixture"); return value;
}
const input = (number: number, value = row()): ContributionRebuildInput => ({ id: id(number), row: value });
function fold(values: readonly ContributionRebuildInput[], size: number) {
  const cells = new Map<string, ContributionCell>();
  for (let offset = 0; offset < values.length; offset += size) {
    const planned = planContributionRebuildCells(values.slice(offset, offset + size), key => cells.get(key) ?? null, cells.size);
    if (!planned.ok) throw new Error(planned.error);
    for (const change of planned.value) {
      expect(change.before).toEqual(cells.get(change.key) ?? null);
      if (!change.after) throw new Error("rebuild removed a cell");
      cells.set(change.key, change.after);
    }
  }
  return cells;
}
const ordered = (cells: ReadonlyMap<string, ContributionCell>) => [...cells].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);

test("independent rebuild keeps exact wide tokens and separate cost/timing cohorts", () => {
  const values = [input(1, row(20, "9007199254740993", "reported", true)), input(2, row(20, "7", "reported", true)),
    input(3, row(20, "3", "estimated")), input(4, row(20, "0"))];
  const actual = fold(values, 2), known = actual.get(contributionRebuildRowCellKey(values[0].row)!)!;
  expect(actual.size).toBe(3); expect(known.observations).toBe(2);
  expect(known.tokens).toEqual({ input: "9007199254741000", cacheRead: "4", cacheWrite: "6", output: "8", reasoning: "10" });
  expect(known.costMicrousd).toBe("14"); expect(known.durationMs).toBe("0"); expect(known.timedTokens).toBe("9007199254741000");
  const estimated = actual.get(contributionRebuildRowCellKey(values[2].row)!)!;
  expect(estimated.costMicrousd).toBe("11"); expect(estimated.durationMs).toBeNull(); expect(estimated.timedTokens).toBe("0");
  const unknown = actual.get(contributionRebuildRowCellKey(values[3].row)!)!;
  expect(unknown.costMicrousd).toBeNull(); expect(unknown.durationMs).toBeNull(); expect(unknown.observations).toBe(1);
});

test("chunk partitions agree with a complete fold and correction-driven production cells", () => {
  const values = Array.from({ length: 97 }, (_, index) => input(index + 1,
    row(20 + index % 4, String(index * 101), (["reported", "estimated", "none"] as const)[index % 3], index % 2 === 0)));
  const reference = planContributionRollups(() => null, values.map(value => ({ id: value.id, before: null, after: value.row })), 0);
  if (!reference.ok) throw new Error(reference.error);
  const original = new Map(reference.value.map(change => [change.key, change.after!]));
  for (const size of [1, 7, 16]) expect(ordered(fold(values, size))).toEqual(ordered(original));
  const corrected = values.map((value, index) => index % 9 === 0 ? { ...value, row: row(99, String(index + 23), "estimated", true) } : value);
  const patch = planContributionRollups(key => original.get(key) ?? null,
    corrected.filter((value, index) => value !== values[index]).map(value => ({ id: value.id,
      before: values[Number.parseInt(value.id, 16) - 1].row, after: value.row })), original.size);
  if (!patch.ok) throw new Error(patch.error);
  for (const change of patch.value) {
    if (change.after) original.set(change.key, change.after); else original.delete(change.key);
  }
  expect(ordered(fold(corrected, 16))).toEqual(ordered(original));
});

test("rebuild rejects malformed or duplicate chunks before reading scratch state", () => {
  let reads = 0, getters = 0;
  const read = () => { reads++; return null; };
  const hostile = [input(1)]; Object.defineProperty(hostile, "0", { enumerable: true, get() { getters++; return input(1); } });
  const invalidRow = { ...input(1), row: { ...row(), records: 2 } };
  for (const values of [Array.from({ length: 17 }, (_, index) => input(index + 1)), [input(1), input(1)],
    [input(2), input(1)], [input(0)], [invalidRow], hostile]) {
    expect(planContributionRebuildCells(values, read, 0)).toEqual({ ok: false, error: "invalid_input" });
  }
  expect(reads).toBe(0); expect(getters).toBe(0);
  expect(contributionRebuildRowCellKey(invalidRow.row)).toBeNull();
  expect(planContributionRebuildCells([], read, 0)).toEqual({ ok: true, value: [] });
  expect(reads).toBe(0);
});

test("scratch mismatches, cell capacity and u128 overflow refuse without a partial patch", () => {
  const prior = [...fold([input(1)], 1).values()][0];
  const wrong = [...fold([input(1, row(21))], 1).values()][0];
  expect(planContributionRebuildCells([input(2)], () => wrong, 1)).toEqual({ ok: false, error: "invalid_projection" });
  expect(planContributionRebuildCells([input(2)], () => prior, 0)).toEqual({ ok: false, error: "invalid_projection" });
  expect(planContributionRebuildCells([input(2)], () => null, MAX_CONTRIBUTION_ROLLUP_CELLS))
    .toEqual({ ok: false, error: "capacity" });
  const full = parseContributionCell({ ...prior, observations: MAX_CONTRIBUTION_ROLLUP_CELLS });
  if (!full) throw new Error("invalid full fixture");
  expect(planContributionRebuildCells([input(2)], () => full, 1)).toEqual({ ok: false, error: "capacity" });
  const maximum = parseContributionCell({ ...prior, tokens: { input: MAX_CONTRIBUTION_ROLLUP_VALUE.toString(),
    cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } });
  if (!maximum) throw new Error("invalid maximum fixture");
  expect(planContributionRebuildCells([input(2)], () => maximum, 1)).toEqual({ ok: false, error: "overflow" });
  expect(planContributionRebuildCells([], () => null, MAX_CONTRIBUTION_ROLLUP_CELLS + 1))
    .toEqual({ ok: false, error: "invalid_input" });
  expect(prior.tokens.input).toBe("1"); expect(full.observations).toBe(MAX_CONTRIBUTION_ROLLUP_CELLS);
});

test("all rows and seeded cells are owned before caller code can change their values", () => {
  const rows = JSON.parse(JSON.stringify([input(1), input(2)])) as ContributionRebuildInput[];
  const planned = planContributionRebuildCells(rows, () => {
    (rows[1].row.tokens as { input: string }).input = "999";
    return null;
  }, 0);
  if (!planned.ok) throw new Error(planned.error);
  expect(planned.value).toHaveLength(1); expect(planned.value[0].after!.tokens.input).toBe("2");
  expect(Object.isFrozen(planned.value)).toBe(true); expect(Object.isFrozen(planned.value[0].after!.tokens)).toBe(true);
  const prior = JSON.parse(JSON.stringify(planned.value[0].after)) as ContributionCell;
  const next = planContributionRebuildCells([input(3), input(4, row(21))], key => {
    if (key === contributionCellKey(prior.dimensions)) return prior;
    (prior.tokens as { input: string }).input = "999"; return null;
  }, 1);
  if (!next.ok) throw new Error(next.error);
  expect(next.value.find(change => change.key === contributionCellKey(prior.dimensions))!.after!.tokens.input).toBe("3");
});
