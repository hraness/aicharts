import { contributionIdentity } from "./contribution-contract";
import { contributionCellKey, parseContributionCell, MAX_CONTRIBUTION_ROLLUP_CELLS, MAX_CONTRIBUTION_ROLLUP_VALUE,
  type ContributionCell, type ContributionCellChange, type ContributionCellDimensions } from "./contribution-rollups";
import { parseUsageStatsRow, statsInteger, STATS_TOKEN_KEYS, statsOwnRecord, type UsageStatsRow } from "./stats-contract";

export const CONTRIBUTION_REBUILD_HEADS_PER_STEP = 16;
export type ContributionRebuildInput = Readonly<{ id: string; row: UsageStatsRow }>;
export type ContributionRebuildFoldError = "invalid_input" | "invalid_projection" | "capacity" | "overflow";
type Result<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: ContributionRebuildFoldError }>;
class Fault extends Error { constructor(readonly code: ContributionRebuildFoldError) { super(code); } }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function cohort(row: UsageStatsRow): ContributionCellDimensions {
  return Object.freeze({ utcDay: row.utcDay, client: row.client, provider: row.provider, model: row.model,
    tokenBasis: row.tokenBasis, breakdownCoverage: row.breakdownCoverage,
    costKind: row.reportedCostMicrousd !== null ? "reported" : row.estimatedCostMicrousd !== null ? "estimated" : "none",
    timed: row.durationMs !== null });
}
/** Shape and eligibility only; neither this key nor the fold attests a row's
 * committed source. The storage owner supplies independently verified heads. */
export function contributionRebuildRowCellKey(input: UsageStatsRow): string | null {
  const row = parseUsageStatsRow(input);
  return row?.records === 1 ? contributionCellKey(cohort(row)) : null;
}
function inputs(value: unknown): readonly ContributionRebuildInput[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Fault("invalid_input");
  const length = Object.getOwnPropertyDescriptor(value, "length"), descriptors = Object.getOwnPropertyDescriptors(value);
  if (!length || !("value" in length) || !statsInteger(length.value, 0, CONTRIBUTION_REBUILD_HEADS_PER_STEP)
    || Reflect.ownKeys(descriptors).length !== length.value + 1) throw new Fault("invalid_input");
  const result: ContributionRebuildInput[] = []; let previous = "";
  for (let index = 0; index < length.value; index++) {
    const item = descriptors[String(index)];
    if (!item || !("value" in item) || !item.enumerable) throw new Fault("invalid_input");
    const raw = statsOwnRecord(item.value, ["id", "row"]), row = raw ? parseUsageStatsRow(raw.row) : null;
    if (!raw || !contributionIdentity(raw.id, 32) || raw.id <= previous || row?.records !== 1) throw new Fault("invalid_input");
    result.push(Object.freeze({ id: raw.id, row })); previous = raw.id;
  }
  return Object.freeze(result);
}
const checked = (value: bigint): string => {
  if (value < 0n || value > MAX_CONTRIBUTION_ROLLUP_VALUE) throw new Fault("overflow");
  return value.toString();
};

/** Independently accumulate a checked head chunk into a private scratch index
 * that began empty. This never consumes projection deltas or reads the published
 * index as its arithmetic seed. Job identity, cross-chunk uniqueness, committed
 * source authority and atomic cursor advancement belong to the storage owner.
 * All external rows are copied before even the first supplied read callback. */
export function planContributionRebuildCells(values: readonly ContributionRebuildInput[],
  read: (key: string) => ContributionCell | null, currentCellCount: number): Result<readonly ContributionCellChange[]> {
  try {
    if (!statsInteger(currentCellCount, 0, MAX_CONTRIBUTION_ROLLUP_CELLS)) throw new Fault("invalid_input");
    const rows = inputs(values), original = new Map<string, ContributionCell | null>(), changed = new Map<string, ContributionCell>();
    let count = currentCellCount, occupied = 0;
    for (const { row } of rows) {
      const dimensions = cohort(row), key = contributionCellKey(dimensions);
      if (!original.has(key)) {
        const value = read(key), prior = value === null ? null : parseContributionCell(value);
        if (value !== null && (!prior || !same(prior.dimensions, dimensions))) throw new Fault("invalid_projection");
        original.set(key, prior);
        if (prior) { if (++occupied > currentCellCount) throw new Fault("invalid_projection"); }
        else if (++count > MAX_CONTRIBUTION_ROLLUP_CELLS) throw new Fault("capacity");
      }
      const prior = changed.get(key) ?? original.get(key) ?? null;
      const observations = (prior?.observations ?? 0) + 1;
      if (observations > MAX_CONTRIBUTION_ROLLUP_CELLS) throw new Fault("capacity");
      const tokens = Object.fromEntries(STATS_TOKEN_KEYS.map(name =>
        [name, checked(BigInt(prior?.tokens[name] ?? "0") + BigInt(row.tokens[name]))])) as ContributionCell["tokens"];
      checked(STATS_TOKEN_KEYS.reduce((total, name) => total + BigInt(tokens[name]), 0n));
      const cost = row.reportedCostMicrousd ?? row.estimatedCostMicrousd;
      const cell = parseContributionCell({ schemaVersion: 3, dimensions, observations, tokens,
        costMicrousd: cost === null ? null : checked(BigInt(prior?.costMicrousd ?? "0") + BigInt(cost)),
        durationMs: row.durationMs === null ? null : checked(BigInt(prior?.durationMs ?? "0") + BigInt(row.durationMs)),
        timedTokens: checked(BigInt(prior?.timedTokens ?? "0") + BigInt(row.timedTokens)) });
      if (!cell) throw new Fault("invalid_projection");
      changed.set(key, cell);
    }
    const patches = [...changed].map(([key, after]) => Object.freeze({ key, before: original.get(key)!, after }));
    patches.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    return { ok: true, value: Object.freeze(patches) };
  } catch (cause) { return { ok: false, error: cause instanceof Fault ? cause.code : "invalid_input" }; }
}
