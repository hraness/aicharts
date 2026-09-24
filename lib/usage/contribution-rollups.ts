import { parseUsageStatsRow, statsInteger, statsOwnRecord, STATS_TOKEN_KEYS, type UsageStatsRow } from "./stats-contract";
import { isStatsClient, isStatsModel, isStatsProvider } from "./stats-registry";

export const MAX_CONTRIBUTION_ROLLUP_DELTAS = 8_448;
export const MAX_CONTRIBUTION_ROLLUP_CELLS = 262_144;
export const MAX_CONTRIBUTION_ROLLUP_CELL_BYTES = 2_048;
export const MAX_CONTRIBUTION_ROLLUP_VALUE = (1n << 128n) - 1n;
export type ContributionCellDimensions = Readonly<{
  utcDay: number; client: string; provider: string | null; model: string | null;
  tokenBasis: "reported" | "estimated" | "unavailable"; breakdownCoverage: "partial" | "complete";
  costKind: "reported" | "estimated" | "none"; timed: boolean;
}>;
/** One cell contains one eligibility cohort. Never mix unknown categories,
 * unpriced observations or untimed observations into a ratio denominator. */
export type ContributionCell = Readonly<{
  schemaVersion: 3; dimensions: ContributionCellDimensions; observations: number;
  tokens: Readonly<Record<typeof STATS_TOKEN_KEYS[number], string>>;
  costMicrousd: string | null; durationMs: string | null; timedTokens: string;
}>;
export type ResolvedContributionDelta = Readonly<{ id: string; before: UsageStatsRow | null; after: UsageStatsRow | null }>;
export type ContributionCellChange = Readonly<{ key: string; before: ContributionCell | null; after: ContributionCell | null }>;
export type ContributionRollupError = "invalid_input" | "invalid_projection" | "overflow" | "capacity";
type Result<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: ContributionRollupError }>;
class Fault extends Error { constructor(readonly code: ContributionRollupError) { super(code); } }
function ownedDeltas(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Fault("invalid_input");
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (!length || !("value" in length) || !statsInteger(length.value, 0, MAX_CONTRIBUTION_ROLLUP_DELTAS)) throw new Fault("invalid_input");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== length.value + 1) throw new Fault("invalid_input");
  const result: unknown[] = [];
  for (let index = 0; index < length.value; index++) {
    const item = descriptors[String(index)];
    if (!item || !("value" in item) || !item.enumerable) throw new Fault("invalid_input");
    result.push(item.value as unknown);
  }
  return result;
}
const checked = (value: bigint): string => {
  if (value < 0n) throw new Fault("invalid_projection");
  if (value > MAX_CONTRIBUTION_ROLLUP_VALUE) throw new Fault("overflow");
  return value.toString();
};
const decimal = (value: unknown): value is string => typeof value === "string" && /^(?:0|[1-9][0-9]{0,38})$/u.test(value)
  && BigInt(value) <= MAX_CONTRIBUTION_ROLLUP_VALUE;
const dimensions = (row: UsageStatsRow): ContributionCellDimensions => Object.freeze({ utcDay: row.utcDay, client: row.client,
  provider: row.provider, model: row.model, tokenBasis: row.tokenBasis, breakdownCoverage: row.breakdownCoverage,
  costKind: row.reportedCostMicrousd !== null ? "reported" : row.estimatedCostMicrousd !== null ? "estimated" : "none",
  timed: row.durationMs !== null });
export function contributionCellKey(value: ContributionCellDimensions): string {
  return JSON.stringify([value.utcDay, value.client, value.provider, value.model, value.tokenBasis, value.breakdownCoverage, value.costKind, value.timed]);
}
/** Reuse the exact eligibility-cohort policy when an owner loads only cells
 * touched by a verified delta. Invalid external rows cannot select a cell. */
export function contributionRowCellKey(row: UsageStatsRow): string | null {
  const parsed = parseUsageStatsRow(row);
  return parsed?.records === 1 ? contributionCellKey(dimensions(parsed)) : null;
}
function parseDimensions(value: unknown): ContributionCellDimensions | null {
  const raw = statsOwnRecord(value, ["utcDay", "client", "provider", "model", "tokenBasis", "breakdownCoverage", "costKind", "timed"]);
  return raw && statsInteger(raw.utcDay, 0, 99_999_999) && isStatsClient(raw.client)
    && (raw.provider === null || isStatsProvider(raw.provider)) && (raw.model === null || isStatsModel(raw.model))
    && (raw.tokenBasis === "reported" || raw.tokenBasis === "estimated" || raw.tokenBasis === "unavailable")
    && (raw.breakdownCoverage === "partial" || raw.breakdownCoverage === "complete")
    && (raw.costKind === "reported" || raw.costKind === "estimated" || raw.costKind === "none") && typeof raw.timed === "boolean"
    ? Object.freeze({ utcDay: raw.utcDay, client: raw.client, provider: raw.provider, model: raw.model, tokenBasis: raw.tokenBasis,
      breakdownCoverage: raw.breakdownCoverage, costKind: raw.costKind, timed: raw.timed }) : null;
}
export function parseContributionCell(value: unknown): ContributionCell | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "dimensions", "observations", "tokens", "costMicrousd", "durationMs", "timedTokens"]);
    const dims = raw ? parseDimensions(raw.dimensions) : null, tokens = raw ? statsOwnRecord(raw.tokens, STATS_TOKEN_KEYS) : null;
    if (raw?.schemaVersion !== 3 || !dims || !tokens || !statsInteger(raw.observations, 1, MAX_CONTRIBUTION_ROLLUP_CELLS)
      || STATS_TOKEN_KEYS.some(key => !decimal(tokens[key])) || !decimal(raw.timedTokens)
      || (dims.costKind === "none" ? raw.costMicrousd !== null : !decimal(raw.costMicrousd))
      || (dims.timed ? !decimal(raw.durationMs) : raw.durationMs !== null || raw.timedTokens !== "0")) return null;
    const total = STATS_TOKEN_KEYS.reduce((sum, key) => sum + BigInt(tokens[key] as string), 0n);
    if (total > MAX_CONTRIBUTION_ROLLUP_VALUE || BigInt(raw.timedTokens) > total
      || (dims.tokenBasis === "unavailable" && (total !== 0n || dims.breakdownCoverage !== "partial"))) return null;
    const cell: ContributionCell = Object.freeze({ schemaVersion: 3, dimensions: dims, observations: raw.observations,
      tokens: Object.freeze(Object.fromEntries(STATS_TOKEN_KEYS.map(key => [key, tokens[key]]))) as ContributionCell["tokens"],
      costMicrousd: raw.costMicrousd as string | null, durationMs: raw.durationMs as string | null, timedTokens: raw.timedTokens });
    return new TextEncoder().encode(JSON.stringify(cell)).byteLength <= MAX_CONTRIBUTION_ROLLUP_CELL_BYTES ? cell : null;
  } catch { return null; }
}
function empty(dims: ContributionCellDimensions): ContributionCell {
  return { schemaVersion: 3, dimensions: dims, observations: 0,
    tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" },
    costMicrousd: dims.costKind === "none" ? null : "0", durationMs: dims.timed ? "0" : null, timedTokens: "0" };
}
function update(prior: ContributionCell | null, row: UsageStatsRow, sign: 1n | -1n): ContributionCell | null {
  const dims = dimensions(row), cell = prior ?? empty(dims);
  if (contributionCellKey(dims) !== contributionCellKey(cell.dimensions)) throw new Fault("invalid_projection");
  const observations = cell.observations + Number(sign);
  if (observations < 0) throw new Fault("invalid_projection");
  if (observations > MAX_CONTRIBUTION_ROLLUP_CELLS) throw new Fault("capacity");
  const tokens = Object.fromEntries(STATS_TOKEN_KEYS.map(key => [key, checked(BigInt(cell.tokens[key]) + sign * BigInt(row.tokens[key]))])) as ContributionCell["tokens"];
  checked(STATS_TOKEN_KEYS.reduce((sum, key) => sum + BigInt(tokens[key]), 0n));
  const cost = row.reportedCostMicrousd ?? row.estimatedCostMicrousd;
  const next = { schemaVersion: 3 as const, dimensions: dims, observations, tokens,
    costMicrousd: cost === null ? null : checked(BigInt(cell.costMicrousd!) + sign * BigInt(cost)),
    durationMs: row.durationMs === null ? null : checked(BigInt(cell.durationMs!) + sign * BigInt(row.durationMs)),
    timedTokens: checked(BigInt(cell.timedTokens) + sign * BigInt(row.timedTokens)) };
  if (observations === 0) {
    if (STATS_TOKEN_KEYS.some(key => tokens[key] !== "0") || (next.costMicrousd !== null && next.costMicrousd !== "0")
      || (next.durationMs !== null && next.durationMs !== "0") || next.timedTokens !== "0") throw new Fault("invalid_projection");
    return null;
  }
  const result = parseContributionCell(next);
  if (!result) throw new Fault("invalid_projection");
  return result;
}

/** Pure bounded patch. The publication owner supplies verified before/after
 * references and applies this once at a pinned revision. No I/O or mutation of
 * the existing projection happens before all deltas have been admitted. */
export function planContributionRollups(read: (key: string) => ContributionCell | null,
  values: readonly ResolvedContributionDelta[], currentCellCount: number): Result<readonly ContributionCellChange[]> {
  try {
    if (!statsInteger(currentCellCount, 0, MAX_CONTRIBUTION_ROLLUP_CELLS)) throw new Fault("invalid_input");
    const inputs = ownedDeltas(values);
    const original = new Map<string, ContributionCell | null>(), changed = new Map<string, ContributionCell | null>(), seen = new Set<string>();
    const change = (row: UsageStatsRow, sign: 1n | -1n) => {
      const key = contributionCellKey(dimensions(row));
      if (!original.has(key)) {
        const value = read(key), parsed = value === null ? null : parseContributionCell(value);
        if (value !== null && (parsed === null || contributionCellKey(parsed.dimensions) !== key)) throw new Fault("invalid_projection");
        original.set(key, parsed);
      }
      const previous = changed.has(key) ? changed.get(key)! : original.get(key)!;
      changed.set(key, update(previous, row, sign));
    };
    const admitted: { before: UsageStatsRow | null; after: UsageStatsRow | null }[] = [];
    for (const value of inputs) {
      const raw = statsOwnRecord(value, ["id", "before", "after"]);
      if (!raw || typeof raw.id !== "string" || !/^[0-9a-f]{32}$/u.test(raw.id) || /^0+$/u.test(raw.id) || seen.has(raw.id)) throw new Fault("invalid_input");
      seen.add(raw.id);
      const before = raw.before === null ? null : parseUsageStatsRow(raw.before), after = raw.after === null ? null : parseUsageStatsRow(raw.after);
      if ((raw.before !== null && before?.records !== 1) || (raw.after !== null && after?.records !== 1) || (!before && !after)) throw new Fault("invalid_input");
      admitted.push({ before, after });
    }
    // A simultaneous swap must not fail because the add happened before a
    // matching removal. Retract the old cohort completely before additions.
    for (const { before } of admitted) if (before) change(before, -1n);
    for (const { after } of admitted) if (after) change(after, 1n);
    const result: ContributionCellChange[] = [];
    let cells = currentCellCount;
    for (const [key, after] of changed) {
      const before = original.get(key)!;
      cells += (after ? 1 : 0) - (before ? 1 : 0);
      if (JSON.stringify(before) !== JSON.stringify(after)) result.push(Object.freeze({ key, before, after }));
    }
    if (cells < 0) throw new Fault("invalid_projection");
    if (cells > MAX_CONTRIBUTION_ROLLUP_CELLS) throw new Fault("capacity");
    return { ok: true, value: Object.freeze(result.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) };
  } catch (error) { return { ok: false, error: error instanceof Fault ? error.code : "invalid_input" }; }
}
