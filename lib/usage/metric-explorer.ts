import { parseUsageStatsJson, parseUsageStatsReport, statsInteger, statsOwnRecord, STATS_DAY_MS, STATS_MAX_DAY, type UsageStatsReport, type UsageStatsRow } from "./stats-contract";
import { isStatsClient, isStatsModel, isStatsProvider } from "./stats-registry";
import { addMetricRow, decodeMetricRow, finishMetricFold, mergeMetricAccumulatorInto, subtractMetricAccumulatorInto, metricAccumulator, metricFoldView, type DecodedMetricRow, type MetricAccumulator, type MetricFold } from "./metric-explorer-fold";
import { metricDefinition, metricMeasure, type MetricComparisonContext, type MetricMeasure, type MetricReason, type MetricValueContext } from "./metric-explorer-values";
import { parseStatsPublicReply, type StatsPublicReply } from "./stats-public";
import type { StatsRange } from "./stats-http-contract";

export { MAX_METRIC_CATALOG_BYTES, MAX_METRIC_CATALOG_ROWS } from "./metric-explorer-catalog";
export { METRIC_REASON_TEXT, metricCollectionPath, metricDefinition, metricChange, metricExplanation, metricRecommendedDimension, metricMeasure, SIGNED_METRIC_IDS, SUPPORTED_METRIC_IDS } from "./metric-explorer-values";
export type { MetricFold } from "./metric-explorer-fold";
export type { MetricChange, MetricComparisonContext, MetricMeasure, MetricReason, MetricValue, MetricValueContext } from "./metric-explorer-values";
export const MAX_METRIC_QUERY_IDS = 32;
export const MAX_METRIC_QUERY_DIMENSIONS = 2;
export const MAX_METRIC_TOP_K = 50;
export const MAX_METRIC_COMPOSITION_SERIES = 5;
export const MAX_METRIC_GROUPS = 65_536;
export const MAX_METRIC_BUCKETS = 366;
export const MAX_METRIC_EXPORT_BYTES = 33_554_432;
export const MAX_METRIC_COOPERATIVE_BATCH = 512;
export const METRIC_DIMENSIONS = ["client", "provider", "model", "utc-day", "utc-week", "utc-month", "weekday"] as const;
export type MetricDimension = typeof METRIC_DIMENSIONS[number];
export type MetricQuery = Readonly<{
  schemaVersion: 1; firstUtcDay: number; dayCount: number;
  filters: Readonly<{ client: string; provider: string; model: string }>;
  basis: "reported" | "estimated"; costKind: "reported" | "estimated";
  groupBy: readonly MetricDimension[]; metricIds: readonly string[]; topK: number;
  sortBy: string; sortDirection: "asc" | "desc";
}>;
export type MetricSnapshot = Readonly<{ schemaVersion: 1; profile: "client-stats-v2"; revision: number; generatedAtMs: number }>;
export type MetricReportMetadata = Omit<UsageStatsReport, "rows">;
type SnapshotData = { report: UsageStatsReport; rows: readonly DecodedMetricRow[]; snapshotDay: number | null; digest?: Promise<string> };
const snapshots = new WeakMap<MetricSnapshot, SnapshotData>();
const results = new WeakSet<MetricResult>();
/** `previous` holds the same cohort's measures for the previous period once
 * exposure is matched; it is null when the cohort has no previous observations. */
export type MetricGroup = Readonly<{ key: string; dimensions: readonly string[]; fold: MetricFold; measures: readonly MetricMeasure[]; other: boolean;
  previous: readonly MetricMeasure[] | null }>;
/** Matched comparison evidence. `matched` is exposure (both same-length windows
 * inside the report, complete, every day observed); `cohort` records whether
 * the two windows observe identical groups along the query dimensions. */
export type MetricComparison = Readonly<{
  firstUtcDay: number; dayCount: number; fold: MetricFold; matched: boolean; reason: MetricReason | null;
  measures: readonly MetricMeasure[];
  cohort: Readonly<{ matched: boolean; reason: MetricReason | null; currentOnly: number; previousOnly: number }>;
}>;
export type MetricResult = Readonly<{
  schemaVersion: 1; snapshot: MetricSnapshot; query: MetricQuery;
  fold: MetricFold; measures: readonly MetricMeasure[]; rows: readonly UsageStatsRow[];
  groups: readonly MetricGroup[]; totalGroups: number; otherGroups: number;
  composition: readonly MetricGroup[];
  previous: MetricComparison | null;
  refreshSnapshot: Readonly<{ utcDay: number | null; rows: readonly UsageStatsRow[]; fold: MetricFold }>;
  coverage: Readonly<{ selectedSourceClients: number; sourceIssues: number; unknownBasisRecords: bigint;
    filteredOutRows: number; unobservedDays: number; includesCurrentOrFutureDay: boolean }>;
  facets: Readonly<{ clients: readonly string[]; providers: readonly string[]; models: readonly string[]; hasEstimated: boolean }>;
}>;
export type MetricQueryResult = Readonly<{ ok: true; value: MetricResult }> | Readonly<{ ok: false; code: "metric_query_invalid" | "metric_range_unavailable" | "metric_snapshot_invalid" | "metric_group_limit" }>;

function ownedArray(value: unknown, maximum: number): readonly unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), length = Object.getOwnPropertyDescriptor(value, "length");
  if (length === undefined || !("value" in length) || !statsInteger(length.value, 0, maximum)
    || Reflect.ownKeys(descriptors).length !== length.value + 1) return null;
  const result: unknown[] = [];
  for (let i = 0; i < length.value; i++) {
    const descriptor = descriptors[String(i)];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return null;
    result.push(descriptor.value);
  }
  return result;
}
export function parseMetricQuery(value: unknown): MetricQuery | null {
  try {
    const query = statsOwnRecord(value, ["schemaVersion", "firstUtcDay", "dayCount", "filters", "basis", "costKind", "groupBy", "metricIds", "topK", "sortBy", "sortDirection"]);
    if (query === null || query.schemaVersion !== 1 || !statsInteger(query.firstUtcDay, 0, STATS_MAX_DAY)
      || !statsInteger(query.dayCount, 1, MAX_METRIC_BUCKETS) || query.firstUtcDay + query.dayCount - 1 > STATS_MAX_DAY
      || !statsInteger(query.topK, 1, MAX_METRIC_TOP_K) || (query.basis !== "reported" && query.basis !== "estimated")
      || (query.costKind !== "reported" && query.costKind !== "estimated") || (query.sortDirection !== "asc" && query.sortDirection !== "desc")) return null;
    const filters = statsOwnRecord(query.filters, ["client", "provider", "model"]);
    if (filters === null || (filters.client !== "*" && !isStatsClient(filters.client))
      || (filters.provider !== "*" && filters.provider !== "~" && !isStatsProvider(filters.provider))
      || (filters.model !== "*" && filters.model !== "~" && !isStatsModel(filters.model))) return null;
    const dimensions = ownedArray(query.groupBy, MAX_METRIC_QUERY_DIMENSIONS), ids = ownedArray(query.metricIds, MAX_METRIC_QUERY_IDS);
    if (dimensions === null || dimensions.some(value => typeof value !== "string" || !(METRIC_DIMENSIONS as readonly string[]).includes(value))
      || new Set(dimensions).size !== dimensions.length || ids === null || ids.length === 0
      || ids.some(id => typeof id !== "string" || metricDefinition(id) === undefined) || new Set(ids).size !== ids.length
      || (query.sortBy !== "label" && query.sortBy !== "records" && !ids.includes(query.sortBy))) return null;
    return Object.freeze({ ...query, filters: Object.freeze({ ...filters }), groupBy: Object.freeze([...dimensions]), metricIds: Object.freeze([...ids]) }) as MetricQuery;
  } catch { return null; }
}

/** A captured, immutable report is the cache key. Revision/time pairs alone
 * cannot identify local reports. Weak ownership releases private rows when the
 * owning view and its results are discarded. */
export function createMetricSnapshot(value: unknown): MetricSnapshot | null {
  const report = parseUsageStatsReport(value);
  return report === null ? null : captureMetricReport(report);
}
/** JSON and owned-object admission share the same parser, with no second
 * report copy between validation and source decoding. */
export function createMetricSnapshotJson(text: string): MetricSnapshot | null {
  const report = parseUsageStatsJson(text);
  return report === null ? null : captureMetricReport(report);
}
/** Hosted envelope validation and capture run in the owning worker. The
 * admitted report is captured once and never returned across its port. */
export function createMetricPublicSnapshotJson(text: string, range: StatsRange):
  Readonly<{ ok: true; snapshot: MetricSnapshot }> | Extract<StatsPublicReply, { ok: false }> | null {
  try {
    const reply = parseStatsPublicReply(JSON.parse(text) as unknown, range);
    return reply === null ? null : reply.ok ? { ok: true, snapshot: captureMetricReport(reply.value) } : reply;
  } catch { return null; }
}
function captureMetricReport(report: UsageStatsReport): MetricSnapshot {
  const snapshot: MetricSnapshot = Object.freeze({ schemaVersion: 1, profile: report.profile, revision: report.revision, generatedAtMs: report.generatedAtMs });
  const rows = Object.freeze(report.rows.map(decodeMetricRow));
  const snapshotDay = rows.reduce<number | null>((latest, row) => row.source.client === "warp" ? Math.max(latest ?? -1, row.source.utcDay) : latest, null);
  snapshots.set(snapshot, { report, rows, snapshotDay });
  return snapshot;
}
export function metricReportMetadata(snapshot: MetricSnapshot): MetricReportMetadata {
  const data = snapshots.get(snapshot); if (data === undefined) throw new Error("metric_snapshot_invalid");
  const { schemaVersion, profile, registryRevision, firstUtcDay, dayCount, generatedAtMs, revision, updatedAtMs, sources } = data.report;
  return Object.freeze({ schemaVersion, profile, registryRevision, firstUtcDay, dayCount, generatedAtMs, revision, updatedAtMs, sources });
}
/** Explicit ownership release complements WeakMap collection and makes an
 * abandoned snapshot unusable even if a caller retains its public handle. */
export function disposeMetricSnapshot(snapshot: MetricSnapshot): void { snapshots.delete(snapshot); }
const dimensionMatches = (value: string | null, filter: string) => filter === "*" || (value ?? "~") === filter;
function dimensionsFor(row: UsageStatsRow, by: readonly MetricDimension[]): readonly string[] {
  return Object.freeze(by.map(dimension => {
    if (dimension === "utc-day") return String(row.utcDay);
    if (dimension === "utc-week") return String(row.utcDay - ((row.utcDay + 3) % 7));
    if (dimension === "weekday") return String((row.utcDay + 4) % 7);
    if (dimension === "utc-month") { const date = new Date(row.utcDay * STATS_DAY_MS); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
    return row[dimension] ?? "~";
  }));
}
function compareMeasure(a: MetricMeasure["value"] | undefined, b: MetricMeasure["value"] | undefined): number {
  if (a === undefined || a === null) return b === undefined || b === null ? 0 : 1;
  if (b === undefined || b === null) return -1;
  const av = a.kind === "integer" ? { numerator: a.amount, denominator: 1n } : a;
  const bv = b.kind === "integer" ? { numerator: b.amount, denominator: 1n } : b;
  const left = av.numerator * bv.denominator, right = bv.numerator * av.denominator;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Groups partition the selected total. When most groups are omitted, copying
 * that total and removing the bounded retained set avoids two full re-merges.
 * Small omitted sets keep the original addition path. */
function* metricOtherFold(total: MetricAccumulator, ordered: readonly { accumulator: MetricAccumulator }[], retained: number): Generator<void, MetricFold> {
  const accumulator = metricAccumulator(), complement = retained < ordered.length - retained;
  if (complement) mergeMetricAccumulatorInto(accumulator, total);
  const from = complement ? 0 : retained, through = complement ? retained : ordered.length;
  for (let index = from; index < through; index++) {
    if ((index - from + 1) % MAX_METRIC_COOPERATIVE_BATCH === 0) yield;
    if (complement) subtractMetricAccumulatorInto(accumulator, ordered[index].accumulator);
    else mergeMetricAccumulatorInto(accumulator, ordered[index].accumulator);
  }
  return finishMetricFold(accumulator);
}

function* metricQuerySteps(snapshot: MetricSnapshot, value: unknown): Generator<void, MetricQueryResult> {
  const data = snapshots.get(snapshot), query = parseMetricQuery(value);
  if (data === undefined) return { ok: false, code: "metric_snapshot_invalid" };
  if (query === null) return { ok: false, code: "metric_query_invalid" };
  if (query.firstUtcDay < data.report.firstUtcDay || query.firstUtcDay + query.dayCount > data.report.firstUtcDay + data.report.dayCount) return { ok: false, code: "metric_range_unavailable" };
  const total = metricAccumulator(), previous = metricAccumulator(), refreshSnapshot = metricAccumulator();
  const groups = new Map<string, { dimensions: readonly string[]; accumulator: MetricAccumulator }>();
  const previousGroups = new Map<string, { dimensions: readonly string[]; accumulator: MetricAccumulator }>();
  const generatedUtcDay = Math.floor(data.report.generatedAtMs / STATS_DAY_MS);
  const selectedRows: UsageStatsRow[] = [], snapshotRows: UsageStatsRow[] = [];
  const providers = new Set<string>(), models = new Set<string>();
  const firstPrevious = query.firstUtcDay - query.dayCount;
  const previousAvailable = firstPrevious >= data.report.firstUtcDay;
  let filteredOutRows = 0, unknownBasisRecords = 0n, hasEstimated = false, work = 0;
  // Filtering, exact source decoding, selected/prior accumulation and global
  // group selection share this one bounded scan. No local top-Ks are combined.
  for (const row of data.rows) {
    if (++work % MAX_METRIC_COOPERATIVE_BATCH === 0) yield;
    const source = row.source, client = dimensionMatches(source.client, query.filters.client);
    if (source.tokenBasis === "estimated") hasEstimated = true;
    if (client) {
      providers.add(source.provider ?? "~");
      if (dimensionMatches(source.provider, query.filters.provider)) models.add(source.model ?? "~");
    }
    const dimensionsMatch = client && dimensionMatches(source.provider, query.filters.provider) && dimensionMatches(source.model, query.filters.model);
    const basis = source.tokenBasis === query.basis || (query.basis === "reported" && source.tokenBasis === "unavailable");
    if (source.client === "warp") {
      if (query.basis === "reported" && dimensionsMatch && source.utcDay === data.snapshotDay) { addMetricRow(refreshSnapshot, row); snapshotRows.push(source); }
      continue;
    }
    const selected = source.utcDay >= query.firstUtcDay && source.utcDay < query.firstUtcDay + query.dayCount;
    if (selected && dimensionsMatch && source.tokenBasis === "unavailable") unknownBasisRecords += BigInt(source.records);
    if (!dimensionsMatch || !basis) { filteredOutRows++; continue; }
    if (previousAvailable && source.utcDay >= firstPrevious && source.utcDay < query.firstUtcDay) {
      addMetricRow(previous, row);
      const dimensions = dimensionsFor(source, query.groupBy), key = JSON.stringify(dimensions);
      let group = previousGroups.get(key);
      if (group === undefined) {
        if (previousGroups.size >= MAX_METRIC_GROUPS) return { ok: false, code: "metric_group_limit" };
        group = { dimensions, accumulator: metricAccumulator() }; previousGroups.set(key, group);
      }
      addMetricRow(group.accumulator, row);
    }
    if (!selected) { filteredOutRows++; continue; }
    addMetricRow(total, row); selectedRows.push(source);
    const dimensions = dimensionsFor(source, query.groupBy), key = JSON.stringify(dimensions);
    let group = groups.get(key);
    if (group === undefined) {
      if (groups.size >= MAX_METRIC_GROUPS) return { ok: false, code: "metric_group_limit" };
      group = { dimensions, accumulator: metricAccumulator() }; groups.set(key, group);
    }
    addMetricRow(group.accumulator, row);
  }
  const sources = data.report.sources.filter(source => dimensionMatches(source.client, query.filters.client) && source.client !== "warp");
  const sourceIssues = sources.filter(source => !["observed", "empty"].includes(source.status) || source.warnings > 0).length;
  const fold = finishMetricFold(total), includesCurrentOrFutureDay = query.firstUtcDay + query.dayCount > generatedUtcDay;
  // Matched exposure is derived from observed days only: both same-length
  // windows lie inside the report, the selected window is complete, and every
  // day of both windows carries observations. Anything less keeps the existing
  // refusal; a populated but partially observed prior window is not evidence.
  const previousFold = previousAvailable ? finishMetricFold(previous) : null;
  const exposure = previousFold !== null && !includesCurrentOrFutureDay && fold.days.length === query.dayCount && previousFold.days.length === query.dayCount;
  let currentOnly = 0, previousOnly = 0;
  if (previousFold !== null) {
    for (const key of groups.keys()) { if (++work % MAX_METRIC_COOPERATIVE_BATCH === 0) yield; if (!previousGroups.has(key)) currentOnly++; }
    for (const key of previousGroups.keys()) { if (++work % MAX_METRIC_COOPERATIVE_BATCH === 0) yield; if (!groups.has(key)) previousOnly++; }
  }
  const cohortMatched = exposure && currentOnly === 0 && previousOnly === 0;
  const comparison: Omit<MetricComparisonContext, "counterpart"> | null = previousFold === null ? null : { population: previousFold, matched: exposure,
    reason: exposure ? null : "period-coverage-unavailable", cohortMatched, cohortReason: !exposure ? "period-coverage-unavailable" : cohortMatched ? null : "matched-cohort-unavailable" };
  const context: MetricValueContext = { firstUtcDay: query.firstUtcDay, dayCount: query.dayCount,
    asOfUtcDay: Math.min(query.firstUtcDay + query.dayCount, generatedUtcDay),
    groupBy: query.groupBy, population: fold, costKind: query.costKind, sourceIssues, previous: comparison === null ? null : { ...comparison, counterpart: previousFold } };
  const contextFor = (counterpart: MetricFold | null): MetricValueContext => comparison === null ? context : { ...context, previous: { ...comparison, counterpart } };
  const measures = (value: MetricFold, counterpart: MetricFold | null) => Object.freeze(query.metricIds.map(id => metricMeasure(id, value, contextFor(counterpart))));
  // The previous window's own values use that window's boundaries and no
  // comparison of their own; a comparison never compares against a comparison.
  const previousContext: MetricValueContext | null = previousFold === null ? null : { firstUtcDay: firstPrevious, dayCount: query.dayCount,
    asOfUtcDay: Math.min(query.firstUtcDay, generatedUtcDay), groupBy: query.groupBy, population: previousFold, costKind: query.costKind, sourceIssues, previous: null };
  const previousMeasures = (value: MetricFold | null) => value === null || previousContext === null ? null
    : Object.freeze(query.metricIds.map(id => metricMeasure(id, value, previousContext)));
  const ordered: { key: string; dimensions: readonly string[]; accumulator: MetricAccumulator; rank: MetricMeasure["value"] | undefined }[] = [];
  for (const [key, group] of groups) {
    if (++work % MAX_METRIC_COOPERATIVE_BATCH === 0) yield;
    const prior = previousGroups.get(key);
    ordered.push({ key, ...group, rank: query.sortBy === "label" ? undefined : query.sortBy === "records" ? { kind: "integer", amount: group.accumulator.totals.records }
      : metricMeasure(query.sortBy, metricFoldView(group.accumulator), contextFor(prior === undefined ? null : metricFoldView(prior.accumulator))).value });
  }
  yield;
  ordered.sort((a, b) => {
    const label = a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    if (query.sortBy === "label") return query.sortDirection === "asc" ? label : -label;
    const left = a.rank, right = b.rank;
    if (left === null || right === null) return left === right ? label : left === null ? 1 : -1;
    return (query.sortDirection === "asc" ? 1 : -1) * compareMeasure(left, right) || label;
  });
  yield;
  const kept: MetricGroup[] = ordered.slice(0, query.topK).map(group => {
    const value = finishMetricFold(group.accumulator), prior = previousGroups.get(group.key);
    const counterpart = prior === undefined ? null : finishMetricFold(prior.accumulator);
    return Object.freeze({ key: group.key, dimensions: group.dimensions, fold: value, measures: measures(value, counterpart), other: false, previous: previousMeasures(counterpart) });
  });
  const omittedCount = Math.max(0, ordered.length - query.topK);
  if (omittedCount > 0) {
    const other = yield* metricOtherFold(total, ordered, query.topK);
    // Other's counterpart is the previous population minus the retained
    // groups' previous folds, so retained and Other changes partition the total.
    let counterpart: MetricFold | null = null;
    if (previousFold !== null) {
      const rest = metricAccumulator(); mergeMetricAccumulatorInto(rest, previous);
      for (const group of ordered.slice(0, query.topK)) { const prior = previousGroups.get(group.key); if (prior !== undefined) subtractMetricAccumulatorInto(rest, prior.accumulator); }
      counterpart = finishMetricFold(rest);
    }
    kept.push(Object.freeze({ key: "other", dimensions: Object.freeze(["Other"]), fold: other, measures: measures(other, counterpart), other: true, previous: previousMeasures(counterpart) }));
  }
  // The chart keeps one global set of token-leading categories independently
  // of table sorting. Every day shares those slots and an exact Other fold.
  const byTokens = [...ordered].sort((a, b) => a.accumulator.totals.total > b.accumulator.totals.total ? -1
    : a.accumulator.totals.total < b.accumulator.totals.total ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const composition: MetricGroup[] = byTokens.slice(0, MAX_METRIC_COMPOSITION_SERIES).map(group => {
    const value = finishMetricFold(group.accumulator);
    return Object.freeze({ key: group.key, dimensions: group.dimensions, fold: value, measures: Object.freeze([]), other: false, previous: null });
  });
  if (byTokens.length > MAX_METRIC_COMPOSITION_SERIES) {
    const value = yield* metricOtherFold(total, byTokens, MAX_METRIC_COMPOSITION_SERIES);
    composition.push(Object.freeze({ key: "other", dimensions: Object.freeze(["Other"]), fold: value, measures: Object.freeze([]), other: true, previous: null }));
  }
  const result: MetricResult = Object.freeze({ schemaVersion: 1, snapshot, query, fold, measures: measures(fold, previousFold), rows: Object.freeze(selectedRows),
    groups: Object.freeze(kept), totalGroups: ordered.length, otherGroups: omittedCount, composition: Object.freeze(composition),
    previous: previousFold === null || comparison === null ? null : Object.freeze({ firstUtcDay: firstPrevious, dayCount: query.dayCount, fold: previousFold, matched: exposure,
      reason: comparison.reason, measures: previousMeasures(previousFold) ?? Object.freeze([]),
      cohort: Object.freeze({ matched: cohortMatched, reason: comparison.cohortReason, currentOnly, previousOnly }) }),
    refreshSnapshot: Object.freeze({ utcDay: snapshotRows.length === 0 ? null : data.snapshotDay, rows: Object.freeze(snapshotRows), fold: finishMetricFold(refreshSnapshot) }),
    coverage: Object.freeze({ selectedSourceClients: sources.length, sourceIssues, unknownBasisRecords, filteredOutRows,
      unobservedDays: query.dayCount - fold.days.length, includesCurrentOrFutureDay }),
    facets: Object.freeze({ clients: Object.freeze(data.report.sources.map(source => source.client)), providers: Object.freeze([...providers].sort()), models: Object.freeze([...models].sort()), hasEstimated }) });
  results.add(result);
  return { ok: true, value: result };
}
export function evaluateMetricQuery(snapshot: MetricSnapshot, value: unknown): MetricQueryResult {
  const steps = metricQuerySteps(snapshot, value);
  for (;;) { const step = steps.next(); if (step.done) return step.value; }
}
/** Cancellation is checked after every bounded cooperative handoff. The
 * synchronous oracle consumes the exact same steps and arithmetic. */
export async function evaluateMetricQueryCooperatively(snapshot: MetricSnapshot, value: unknown, current: () => boolean,
  handoff: () => Promise<void>): Promise<MetricQueryResult | { ok: false; code: "metric_query_cancelled" }> {
  const steps = metricQuerySteps(snapshot, value);
  try {
    for (;;) {
      if (!current()) return { ok: false, code: "metric_query_cancelled" };
      const step = steps.next();
      if (step.done) return current() ? step.value : { ok: false, code: "metric_query_cancelled" };
      await handoff();
    }
  } finally { steps.return({ ok: false, code: "metric_snapshot_invalid" }); }
}

/** Export callers may only use complete results issued by this engine. */
export function isMetricResult(value: unknown): value is MetricResult {
  return value !== null && typeof value === "object" && results.has(value as MetricResult);
}

/** The digest binds complete captured bytes, not a timestamp/revision guess.
 * Callers must check their account/report lifetime before and after awaiting it. */
export async function metricSnapshotDigest(snapshot: MetricSnapshot): Promise<string> {
  const data = snapshots.get(snapshot);
  if (data === undefined) throw new Error("metric_snapshot_invalid");
  data.digest ??= crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(data.report))).then(digest =>
    [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join(""), error => { data.digest = undefined; throw error; });
  return data.digest;
}
export async function metricResultJson(result: MetricResult): Promise<string> {
  if (!isMetricResult(result)) throw new Error("metric_result_invalid");
  const digest = await metricSnapshotDigest(result.snapshot);
  const json = JSON.stringify({ schemaVersion: 1, profile: "metric-explorer-v1", snapshot: { ...result.snapshot, sha256: digest }, query: result.query,
    scope: "observed numeric aggregates; source gaps remain unknown",
    comparison: result.previous?.matched ? "matched previous period: same-length window inside the report with observations on every day of both; group changes need identical cohorts"
      : "unavailable without matched population and exposure evidence",
    previous: result.previous === null ? null : { firstUtcDay: result.previous.firstUtcDay, dayCount: result.previous.dayCount, matched: result.previous.matched,
      reason: result.previous.reason, cohort: result.previous.cohort, daysWithRecords: result.previous.fold.days.length, measures: result.previous.measures },
    coverage: result.coverage, measures: result.measures, groups: result.groups.map(({ key, dimensions, measures, other, previous }) => ({ key, dimensions, measures, other, previous })),
    totalGroups: result.totalGroups, otherGroups: result.otherGroups,
    grouping: "Global aggregation precedes top-K; Other merges all omitted contributions. Ratios and distinct-day counts are not additive.",
  }, (_, value: unknown) => typeof value === "bigint" ? value.toString() : value);
  if (new TextEncoder().encode(json).byteLength > MAX_METRIC_EXPORT_BYTES) throw new Error("metric_export_limit");
  return `${json}\n`;
}
