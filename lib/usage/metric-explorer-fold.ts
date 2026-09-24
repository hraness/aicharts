import type { UsageStatsRow } from "./stats-contract";

export const metricTokenKeys = ["input", "cacheRead", "cacheWrite", "output", "reasoning"] as const;
export type MetricTokenPart = typeof metricTokenKeys[number];
export type MetricTokenVector = Readonly<Record<MetricTokenPart, bigint>>;
type MutableVector = Record<MetricTokenPart, bigint>;
export type MetricCostCohort = Readonly<{ records: bigint; microusd: bigint; tokens: MetricTokenVector; total: bigint }>;
export type MetricBase = Readonly<{
  tokens: MetricTokenVector; total: bigint; records: bigint; tokenRecords: bigint; partialRecords: bigint;
  unknownModelTokens: bigint; unknownProviderTokens: bigint;
  reportedCost: bigint | null; reportedCostRecords: bigint; estimatedCost: bigint | null; estimatedCostRecords: bigint;
  durationMs: bigint | null; timedRecords: bigint; timedTokenRecords: bigint; timedTokens: bigint;
  categories: Readonly<{ records: bigint; tokens: MetricTokenVector; total: bigint }>;
  reportedCohort: MetricCostCohort; estimatedCohort: MetricCostCohort;
  rateCohort: Readonly<{ records: bigint; tokens: bigint; durationMs: bigint }>;
}>;
export type MetricFold = MetricBase & Readonly<{ days: readonly Readonly<{ utcDay: number; totals: MetricBase }>[] }>;
export type DecodedMetricRow = Readonly<{
  source: UsageStatsRow; tokens: MetricTokenVector; total: bigint;
  reportedCost: bigint | null; estimatedCost: bigint | null; durationMs: bigint | null; timedTokens: bigint;
}>;
type MutableCost = { records: bigint; microusd: bigint; tokens: MutableVector; total: bigint };
type MutableBase = Omit<MetricBase, "tokens" | "categories" | "reportedCohort" | "estimatedCohort" | "rateCohort"> & {
  tokens: MutableVector; categories: { records: bigint; tokens: MutableVector; total: bigint };
  reportedCohort: MutableCost; estimatedCohort: MutableCost;
  rateCohort: { records: bigint; tokens: bigint; durationMs: bigint };
};
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type MetricAccumulator = { totals: Mutable<MutableBase>; days: Map<number, Mutable<MutableBase>> };
const vector = (): MutableVector => ({ input: 0n, cacheRead: 0n, cacheWrite: 0n, output: 0n, reasoning: 0n });
const cost = (): MutableCost => ({ records: 0n, microusd: 0n, tokens: vector(), total: 0n });
function emptyBase(): Mutable<MutableBase> {
  return { tokens: vector(), total: 0n, records: 0n, tokenRecords: 0n, partialRecords: 0n,
    unknownModelTokens: 0n, unknownProviderTokens: 0n,
    reportedCost: null, reportedCostRecords: 0n, estimatedCost: null, estimatedCostRecords: 0n,
    durationMs: null, timedRecords: 0n, timedTokenRecords: 0n, timedTokens: 0n,
    categories: { records: 0n, tokens: vector(), total: 0n }, reportedCohort: cost(), estimatedCohort: cost(),
    rateCohort: { records: 0n, tokens: 0n, durationMs: 0n } };
}
export function metricAccumulator(): MetricAccumulator { return { totals: emptyBase(), days: new Map() }; }
export function decodeMetricRow(source: UsageStatsRow): DecodedMetricRow {
  const tokens = Object.freeze(Object.fromEntries(metricTokenKeys.map(key => [key, BigInt(source.tokens[key])])) as MutableVector);
  return Object.freeze({ source, tokens, total: metricTokenKeys.reduce((sum, key) => sum + tokens[key], 0n),
    reportedCost: source.reportedCostMicrousd === null ? null : BigInt(source.reportedCostMicrousd),
    estimatedCost: source.estimatedCostMicrousd === null ? null : BigInt(source.estimatedCostMicrousd),
    durationMs: source.durationMs === null ? null : BigInt(source.durationMs), timedTokens: BigInt(source.timedTokens) });
}
const addVector = (target: MutableVector, source: MetricTokenVector) => {
  for (const key of metricTokenKeys) target[key] += source[key];
};
function addBase(target: Mutable<MutableBase>, row: DecodedMetricRow) {
  const source = row.source, records = BigInt(source.records), known = source.tokenBasis !== "unavailable";
  target.records += records; target.total += row.total; addVector(target.tokens, row.tokens);
  if (known) target.tokenRecords += records;
  if (source.breakdownCoverage === "partial") target.partialRecords += records;
  if (source.model === null) target.unknownModelTokens += row.total;
  if (source.provider === null) target.unknownProviderTokens += row.total;
  if (row.reportedCost !== null) target.reportedCost = (target.reportedCost ?? 0n) + row.reportedCost;
  if (row.estimatedCost !== null) target.estimatedCost = (target.estimatedCost ?? 0n) + row.estimatedCost;
  target.reportedCostRecords += BigInt(source.reportedCostRecords); target.estimatedCostRecords += BigInt(source.estimatedCostRecords);
  if (row.durationMs !== null) target.durationMs = (target.durationMs ?? 0n) + row.durationMs;
  target.timedRecords += BigInt(source.timedRecords); target.timedTokens += row.timedTokens;
  if (known) {
    target.timedTokenRecords += BigInt(source.timedRecords);
    if (row.durationMs !== null) {
      target.rateCohort.records += BigInt(source.timedRecords);
      target.rateCohort.tokens += row.timedTokens; target.rateCohort.durationMs += row.durationMs;
    }
  }
  if (known && source.breakdownCoverage === "complete") {
    target.categories.records += records; target.categories.total += row.total; addVector(target.categories.tokens, row.tokens);
    // Partial price coverage has no attributable token denominator in v2.
    // Each cost kind therefore admits only wholly covered aggregate rows.
    for (const [cohort, amount, count] of [[target.reportedCohort, row.reportedCost, source.reportedCostRecords],
      [target.estimatedCohort, row.estimatedCost, source.estimatedCostRecords]] as const) {
      if (amount !== null && count === source.records) {
        cohort.records += records; cohort.microusd += amount; cohort.total += row.total; addVector(cohort.tokens, row.tokens);
      }
    }
  }
}
export function addMetricRow(target: MetricAccumulator, row: DecodedMetricRow) {
  addBase(target.totals, row);
  const day = target.days.get(row.source.utcDay) ?? emptyBase();
  addBase(day, row); target.days.set(row.source.utcDay, day);
}
function mergeBase(target: Mutable<MutableBase>, source: MetricBase) {
  addVector(target.tokens, source.tokens);
  for (const key of ["total", "records", "tokenRecords", "partialRecords", "unknownModelTokens", "unknownProviderTokens",
    "reportedCostRecords", "estimatedCostRecords", "timedRecords", "timedTokenRecords", "timedTokens"] as const) target[key] += source[key];
  for (const key of ["reportedCost", "estimatedCost", "durationMs"] as const) {
    if (source[key] !== null) target[key] = (target[key] ?? 0n) + source[key];
  }
  target.categories.records += source.categories.records; target.categories.total += source.categories.total;
  addVector(target.categories.tokens, source.categories.tokens);
  for (const key of ["reportedCohort", "estimatedCohort"] as const) {
    target[key].records += source[key].records; target[key].microusd += source[key].microusd;
    target[key].total += source[key].total; addVector(target[key].tokens, source[key].tokens);
  }
  target.rateCohort.records += source.rateCohort.records; target.rateCohort.tokens += source.rateCohort.tokens;
  target.rateCohort.durationMs += source.rateCohort.durationMs;
}
function freezeBase(totals: MetricBase): MetricBase {
  return Object.freeze({ ...totals, tokens: Object.freeze({ ...totals.tokens }),
    categories: Object.freeze({ ...totals.categories, tokens: Object.freeze({ ...totals.categories.tokens }) }),
    reportedCohort: Object.freeze({ ...totals.reportedCohort, tokens: Object.freeze({ ...totals.reportedCohort.tokens }) }),
    estimatedCohort: Object.freeze({ ...totals.estimatedCohort, tokens: Object.freeze({ ...totals.estimatedCohort.tokens }) }),
    rateCohort: Object.freeze({ ...totals.rateCohort }) });
}
export function finishMetricFold(source: MetricAccumulator): MetricFold {
  return Object.freeze({ ...freezeBase(source.totals), days: Object.freeze([...source.days].sort(([a], [b]) => a - b)
    .map(([utcDay, totals]) => Object.freeze({ utcDay, totals: freezeBase(totals) }))) });
}
/** A short-lived internal view for ranking. It must never escape in a result;
 * only the bounded displayed folds are deeply frozen and copied. */
export function metricFoldView(source: MetricAccumulator): MetricFold {
  return { ...source.totals, days: [...source.days].sort(([a], [b]) => a - b).map(([utcDay, totals]) => ({ utcDay, totals })) };
}
export function mergeMetricAccumulators(sources: readonly MetricAccumulator[]): MetricFold {
  const result = metricAccumulator();
  for (const source of sources) mergeMetricAccumulatorInto(result, source);
  return finishMetricFold(result);
}
/** One bounded group merge lets a worker yield between groups without using a
 * different arithmetic path from the synchronous oracle. */
export function mergeMetricAccumulatorInto(result: MetricAccumulator, source: MetricAccumulator) {
  mergeBase(result.totals, source.totals);
  for (const [utcDay, totals] of source.days) {
    const target = result.days.get(utcDay) ?? emptyBase(); mergeBase(target, totals); result.days.set(utcDay, target);
  }
}

function subtractCount(total: bigint, removed: bigint): bigint {
  if (total < 0n || removed < 0n || removed > total) throw new Error("metric_complement_invalid");
  return total - removed;
}
function subtractVector(target: MutableVector, source: MetricTokenVector) {
  for (const key of metricTokenKeys) target[key] = subtractCount(target[key], source[key]);
}
function subtractBase(target: Mutable<MutableBase>, source: MetricBase) {
  subtractVector(target.tokens, source.tokens);
  for (const key of ["total", "records", "tokenRecords", "partialRecords", "unknownModelTokens", "unknownProviderTokens",
    "reportedCostRecords", "estimatedCostRecords", "timedRecords", "timedTokenRecords", "timedTokens"] as const)
    target[key] = subtractCount(target[key], source[key]);
  // Scalar zero is observed only while at least one qualifying record remains.
  // Amount alone cannot distinguish free usage from an absent cost or duration.
  for (const [amount, records] of [["reportedCost", "reportedCostRecords"], ["estimatedCost", "estimatedCostRecords"], ["durationMs", "timedRecords"]] as const) {
    if ((source[amount] === null) !== (source[records] === 0n)
      || (target[amount] === null) !== (target[records] + source[records] === 0n)) throw new Error("metric_complement_invalid");
    const remaining = subtractCount(target[amount] ?? 0n, source[amount] ?? 0n);
    if (target[records] === 0n && remaining !== 0n) throw new Error("metric_complement_invalid");
    target[amount] = target[records] === 0n ? null : remaining;
  }
  target.categories.records = subtractCount(target.categories.records, source.categories.records);
  target.categories.total = subtractCount(target.categories.total, source.categories.total);
  subtractVector(target.categories.tokens, source.categories.tokens);
  for (const key of ["reportedCohort", "estimatedCohort"] as const) {
    target[key].records = subtractCount(target[key].records, source[key].records);
    target[key].microusd = subtractCount(target[key].microusd, source[key].microusd);
    target[key].total = subtractCount(target[key].total, source[key].total); subtractVector(target[key].tokens, source[key].tokens);
  }
  for (const key of ["records", "tokens", "durationMs"] as const) target.rateCohort[key] = subtractCount(target.rateCohort[key], source.rateCohort[key]);
  const sum = (tokens: MetricTokenVector) => metricTokenKeys.reduce((total, key) => total + tokens[key], 0n);
  if (sum(target.tokens) !== target.total || target.tokenRecords > target.records || target.partialRecords > target.records
    || target.reportedCostRecords + target.estimatedCostRecords > target.records || target.timedRecords > target.records
    || target.timedTokenRecords > target.tokenRecords || target.timedTokenRecords > target.timedRecords || target.timedTokens > target.total
    || target.unknownModelTokens > target.total || target.unknownProviderTokens > target.total
    || (target.tokenRecords === 0n && target.total !== 0n) || (target.timedRecords === 0n && target.timedTokens !== 0n)
    || sum(target.categories.tokens) !== target.categories.total || target.categories.total > target.total
    || metricTokenKeys.some(key => target.categories.tokens[key] > target.tokens[key])
    || target.categories.records > target.tokenRecords || (target.categories.records === 0n && target.categories.total !== 0n)
    || target.reportedCohort.records + target.estimatedCohort.records > target.categories.records
    || target.rateCohort.records !== target.timedTokenRecords || target.rateCohort.tokens > target.timedTokens
    || target.rateCohort.durationMs > (target.durationMs ?? 0n)
    || (target.rateCohort.records === 0n && (target.rateCohort.tokens !== 0n || target.rateCohort.durationMs !== 0n))) throw new Error("metric_complement_invalid");
  for (const [key, records, amount] of [["reportedCohort", "reportedCostRecords", "reportedCost"], ["estimatedCohort", "estimatedCostRecords", "estimatedCost"]] as const) {
    const cohort = target[key];
    if (cohort.records > target[records] || cohort.records > target.categories.records || cohort.microusd > (target[amount] ?? 0n)
      || sum(cohort.tokens) !== cohort.total || cohort.total > target.categories.total
      || metricTokenKeys.some(part => cohort.tokens[part] > target.categories.tokens[part])
      || (cohort.records === 0n && (cohort.microusd !== 0n || cohort.total !== 0n))) throw new Error("metric_complement_invalid");
  }
}

/** Remove a disjoint group from an owned copy of its complete population.
 * Group membership comes from the engine's partition; scalar/support checks
 * reject inconsistent complements. A failed temporary target must be discarded. */
export function subtractMetricAccumulatorInto(result: MetricAccumulator, source: MetricAccumulator) {
  subtractBase(result.totals, source.totals);
  for (const [utcDay, totals] of source.days) {
    const target = result.days.get(utcDay); if (target === undefined) throw new Error("metric_complement_invalid");
    subtractBase(target, totals);
    // A zero-token or token-unknown record still establishes day presence.
    if (target.records === 0n) result.days.delete(utcDay);
  }
}
export function mergeMetricFolds(sources: readonly MetricFold[]): MetricFold {
  const result = metricAccumulator();
  for (const source of sources) {
    mergeBase(result.totals, source);
    for (const day of source.days) {
      const target = result.days.get(day.utcDay) ?? emptyBase(); mergeBase(target, day.totals); result.days.set(day.utcDay, target);
    }
  }
  return finishMetricFold(result);
}
export function metricWindow(fold: MetricFold, firstUtcDay: number, dayCount: number): MetricFold {
  const result = metricAccumulator();
  for (const day of fold.days) if (day.utcDay >= firstUtcDay && day.utcDay < firstUtcDay + dayCount) {
    mergeBase(result.totals, day.totals);
    const target = emptyBase(); mergeBase(target, day.totals); result.days.set(day.utcDay, target);
  }
  return finishMetricFold(result);
}
