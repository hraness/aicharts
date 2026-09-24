import { parseUsageStatsJson, parseUsageStatsReport, statsInteger, statsOwnRecord, STATS_DAY_MS, STATS_MAX_DAY, type UsageStatsReport, type UsageStatsRow } from "./stats-contract";
import { isStatsClient, isStatsModel, isStatsProvider } from "./stats-registry";
import { addMetricRow, decodeMetricRow, finishMetricFold, mergeMetricAccumulatorInto, subtractMetricAccumulatorInto, metricAccumulator, metricFoldView, type DecodedMetricRow, type MetricAccumulator, type MetricFold } from "./metric-explorer-fold";
import { metricDefinition, metricMeasure, type MetricMeasure } from "./metric-explorer-values";
import { parseStatsPublicReply, type StatsPublicReply } from "./stats-public";
import type { StatsRange } from "./stats-http-contract";

export { MAX_METRIC_CATALOG_BYTES, MAX_METRIC_CATALOG_ROWS } from "./metric-explorer-catalog";
export { METRIC_REASON_TEXT, metricCollectionPath, metricDefinition, metricExplanation, metricRecommendedDimension, metricMeasure, SUPPORTED_METRIC_IDS } from "./metric-explorer-values";
export type { MetricFold } from "./metric-explorer-fold";
export type { MetricMeasure, MetricReason, MetricValue } from "./metric-explorer-values";
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
export type MetricGroup = Readonly<{ key: string; dimensions: readonly string[]; fold: MetricFold; measures: readonly MetricMeasure[]; other: boolean }>;
export type MetricResult = Readonly<{
  schemaVersion: 1; snapshot: MetricSnapshot; query: MetricQuery;
  fold: MetricFold; measures: readonly MetricMeasure[]; rows: readonly UsageStatsRow[];
  groups: readonly MetricGroup[]; totalGroups: number; otherGroups: number;
  composition: readonly MetricGroup[];
  previous: Readonly<{ firstUtcDay: number; dayCount: number; fold: MetricFold; matched: false; reason: "period-coverage-unavailable" }> | null;
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
    if (previousAvailable && source.utcDay >= firstPrevious && source.utcDay < query.firstUtcDay) addMetricRow(previous, row);
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
  const fold = finishMetricFold(total), context = { firstUtcDay: query.firstUtcDay, dayCount: query.dayCount,
    asOfUtcDay: Math.min(query.firstUtcDay + query.dayCount, Math.floor(data.report.generatedAtMs / STATS_DAY_MS)),
    groupBy: query.groupBy, population: fold, costKind: query.costKind, sourceIssues };
  const measures = (value: MetricFold) => Object.freeze(query.metricIds.map(id => metricMeasure(id, value, context)));
  const ordered: { key: string; dimensions: readonly string[]; accumulator: MetricAccumulator; rank: MetricMeasure["value"] | undefined }[] = [];
  for (const [key, group] of groups) {
    if (++work % MAX_METRIC_COOPERATIVE_BATCH === 0) yield;
    ordered.push({ key, ...group, rank: query.sortBy === "label" ? undefined : query.sortBy === "records" ? { kind: "integer", amount: group.accumulator.totals.records }
      : metricMeasure(query.sortBy, metricFoldView(group.accumulator), context).value });
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
    const value = finishMetricFold(group.accumulator);
    return Object.freeze({ key: group.key, dimensions: group.dimensions, fold: value, measures: measures(value), other: false });
  });
  const omittedCount = Math.max(0, ordered.length - query.topK);
  if (omittedCount > 0) {
    const other = yield* metricOtherFold(total, ordered, query.topK);
    kept.push(Object.freeze({ key: "other", dimensions: Object.freeze(["Other"]), fold: other, measures: measures(other), other: true }));
  }
  // The chart keeps one global set of token-leading categories independently
  // of table sorting. Every day shares those slots and an exact Other fold.
  const byTokens = [...ordered].sort((a, b) => a.accumulator.totals.total > b.accumulator.totals.total ? -1
    : a.accumulator.totals.total < b.accumulator.totals.total ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const composition: MetricGroup[] = byTokens.slice(0, MAX_METRIC_COMPOSITION_SERIES).map(group => {
    const value = finishMetricFold(group.accumulator);
    return Object.freeze({ key: group.key, dimensions: group.dimensions, fold: value, measures: Object.freeze([]), other: false });
  });
  if (byTokens.length > MAX_METRIC_COMPOSITION_SERIES) {
    const value = yield* metricOtherFold(total, byTokens, MAX_METRIC_COMPOSITION_SERIES);
    composition.push(Object.freeze({ key: "other", dimensions: Object.freeze(["Other"]), fold: value, measures: Object.freeze([]), other: true }));
  }
  const result: MetricResult = Object.freeze({ schemaVersion: 1, snapshot, query, fold, measures: measures(fold), rows: Object.freeze(selectedRows),
    groups: Object.freeze(kept), totalGroups: ordered.length, otherGroups: omittedCount, composition: Object.freeze(composition),
    previous: previousAvailable ? Object.freeze({ firstUtcDay: firstPrevious, dayCount: query.dayCount, fold: finishMetricFold(previous), matched: false, reason: "period-coverage-unavailable" }) : null,
    refreshSnapshot: Object.freeze({ utcDay: snapshotRows.length === 0 ? null : data.snapshotDay, rows: Object.freeze(snapshotRows), fold: finishMetricFold(refreshSnapshot) }),
    coverage: Object.freeze({ selectedSourceClients: sources.length, sourceIssues, unknownBasisRecords, filteredOutRows,
      unobservedDays: query.dayCount - fold.days.length, includesCurrentOrFutureDay: query.firstUtcDay + query.dayCount > Math.floor(data.report.generatedAtMs / STATS_DAY_MS) }),
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
    scope: "observed numeric aggregates; source gaps remain unknown", comparison: "unavailable without matched population and exposure evidence",
    coverage: result.coverage, measures: result.measures, groups: result.groups.map(({ key, dimensions, measures, other }) => ({ key, dimensions, measures, other })),
    totalGroups: result.totalGroups, otherGroups: result.otherGroups,
    grouping: "Global aggregation precedes top-K; Other merges all omitted contributions. Ratios and distinct-day counts are not additive.",
  }, (_, value: unknown) => typeof value === "bigint" ? value.toString() : value);
  if (new TextEncoder().encode(json).byteLength > MAX_METRIC_EXPORT_BYTES) throw new Error("metric_export_limit");
  return `${json}\n`;
}
