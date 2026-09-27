import { isMetricResult, METRIC_REASON_TEXT, metricDefinition, parseMetricQuery, SIGNED_METRIC_IDS, type MetricComparison, type MetricGroup, type MetricResult } from "@/lib/usage/metric-explorer";
import { STATS_MAX_DAY, STATS_MAX_ROWS, statsInteger, statsOwnRecord } from "@/lib/usage/stats-contract";
import { isStatsClient, isStatsModel, isStatsProvider } from "@/lib/usage/stats-registry";
import { metricStatsProjection } from "./stats-metric-projection";

export const MAX_METRIC_VIEW_BYTES = 2_097_152;
export type MetricPresentationGroup = Pick<MetricGroup, "key" | "dimensions" | "measures" | "other" | "previous"> & Readonly<{ daysWithRecords: number }>;
export type MetricPresentationComparison = Omit<MetricComparison, "fold"> & Readonly<{ daysWithRecords: number }>;
/** Only bounded display data crosses the worker boundary. Source rows and
 * each group's full per-day cohort trees remain with the captured report. */
export type MetricPresentation = Pick<MetricResult, "schemaVersion" | "snapshot" | "query" | "measures" | "totalGroups" | "otherGroups" | "coverage" | "facets"> & Readonly<{
  groups: readonly MetricPresentationGroup[];
  rowCount: number; snapshotRowCount: number; snapshotUtcDay: number | null;
  previous: MetricPresentationComparison | null;
  projection: ReturnType<typeof metricStatsProjection>;
}>;
export function metricPresentation(result: MetricResult): MetricPresentation {
  if (!isMetricResult(result)) throw new Error("metric_result_invalid");
  const { schemaVersion, snapshot, query, measures, totalGroups, otherGroups, coverage, facets } = result;
  return Object.freeze({ schemaVersion, snapshot, query, measures, totalGroups, otherGroups, coverage, facets,
    groups: Object.freeze(result.groups.map(({ key, dimensions, measures, other, previous, fold }) => Object.freeze({ key, dimensions, measures, other, previous, daysWithRecords: fold.days.length }))),
    rowCount: result.rows.length, snapshotRowCount: result.refreshSnapshot.rows.length, snapshotUtcDay: result.refreshSnapshot.utcDay,
    previous: result.previous === null ? null : Object.freeze({ firstUtcDay: result.previous.firstUtcDay, dayCount: result.previous.dayCount, matched: result.previous.matched,
      reason: result.previous.reason, measures: result.previous.measures, cohort: result.previous.cohort, daysWithRecords: result.previous.fold.days.length }),
    projection: metricStatsProjection(result) });
}
/** This is a serialized display ceiling, not a claim about physical heap.
 * Maps are counted with their entries; JSON's default empty Map is forbidden. */
export function metricPresentationBytes(value: MetricPresentation): number {
  return encodeMetricPresentation(value).byteLength;
}
export function encodeMetricPresentation(value: MetricPresentation): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value, (_, item: unknown) => typeof item === "bigint" ? { $metricInteger: item.toString() }
    : item instanceof Map ? { $metricMap: [...item] } : item)).buffer;
}
function invalid(): never { throw new Error("metric_view_invalid"); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> { return statsOwnRecord(value, keys) ?? invalid(); }
function list(value: unknown, maximum: number): readonly unknown[] { if (!Array.isArray(value) || value.length > maximum) invalid(); return value; }
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number { if (!statsInteger(value, 0, max)) invalid(); return value; }
function amount(value: unknown): bigint { if (typeof value !== "bigint" || value < 0n || value.toString().length > 80) invalid(); return value; }
/** Only matched comparison values may be negative. */
function signed(value: unknown): bigint { if (typeof value !== "bigint" || value.toString().length > 81) invalid(); return value; }
function text(value: unknown, max = 512): string { if (typeof value !== "string" || value.length > max) invalid(); return value; }
function totals(value: unknown): void {
  const fields = object(value, ["tokens", "input", "cacheRead", "cacheWrite", "output", "reasoning", "records", "tokenRecords", "partialRecords", "activeDays",
    "reportedCost", "reportedCostRecords", "estimatedCost", "estimatedCostRecords", "durationMs", "timedRecords", "timedTokens", "timedTokenRecords"]);
  for (const key of ["tokens", "input", "cacheRead", "cacheWrite", "output", "reasoning", "timedTokens"]) amount(fields[key]);
  for (const key of ["reportedCost", "estimatedCost", "durationMs"]) if (fields[key] !== null) amount(fields[key]);
  const records = integer(fields.records);
  for (const key of ["tokenRecords", "partialRecords", "reportedCostRecords", "estimatedCostRecords", "timedRecords", "timedTokenRecords"]) integer(fields[key], records);
  integer(fields.activeDays, 366);
}
function measures(value: unknown, ids: readonly string[]): void {
  const entries = list(value, 32); if (entries.length !== ids.length) invalid();
  entries.forEach((entry, index) => {
    const measure = object(entry, ["id", "version", "unit", "status", "value", "eligibleRecords", "selectedRecords", "excludedRecords", "reason", "evidence"]);
    if (measure.id !== ids[index] || metricDefinition(String(measure.id)) === undefined || measure.version !== 1) invalid();
    text(measure.unit, 128);
    if (!["available", "partial", "unavailable"].includes(String(measure.status)) || !["observed-subtotal", "eligible-cohort", "planned"].includes(String(measure.evidence))
      || (measure.reason !== null && !Object.hasOwn(METRIC_REASON_TEXT, String(measure.reason)))) invalid();
    const eligible = amount(measure.eligibleRecords), selected = amount(measure.selectedRecords), excluded = amount(measure.excludedRecords);
    if (eligible > selected || excluded !== selected - eligible || (measure.value === null) !== (measure.status === "unavailable")) invalid();
    if (measure.value !== null) {
      const kind = (measure.value as { kind?: unknown }).kind, numeric = SIGNED_METRIC_IDS.has(ids[index]) ? signed : amount;
      if (kind === "integer") numeric(object(measure.value, ["kind", "amount"]).amount);
      else if (kind === "ratio") { const ratio = object(measure.value, ["kind", "numerator", "denominator"]); numeric(ratio.numerator); if (amount(ratio.denominator) === 0n) invalid(); }
      else invalid();
    }
  });
}
function validatePresentation(value: unknown): asserts value is MetricPresentation {
  const view = object(value, ["schemaVersion", "snapshot", "query", "measures", "totalGroups", "otherGroups", "coverage", "facets", "groups", "rowCount", "snapshotRowCount", "snapshotUtcDay", "previous", "projection"]);
  if (view.schemaVersion !== 1) invalid();
  const query = parseMetricQuery(view.query); if (query === null) invalid();
  const snapshot = object(view.snapshot, ["schemaVersion", "profile", "revision", "generatedAtMs"]);
  if (snapshot.schemaVersion !== 1 || snapshot.profile !== "client-stats-v2") invalid();
  integer(snapshot.revision); integer(snapshot.generatedAtMs, 8_640_000_000_000_000);
  const totalGroups = integer(view.totalGroups, STATS_MAX_ROWS), otherGroups = integer(view.otherGroups, totalGroups);
  integer(view.rowCount, STATS_MAX_ROWS); integer(view.snapshotRowCount, STATS_MAX_ROWS);
  if (view.snapshotUtcDay !== null) integer(view.snapshotUtcDay, STATS_MAX_DAY);
  measures(view.measures, query.metricIds);
  const groups = list(view.groups, 51); if (groups.length !== totalGroups - otherGroups + Number(otherGroups > 0)) invalid();
  for (const item of groups) {
    const group = object(item, ["key", "dimensions", "measures", "other", "previous", "daysWithRecords"]);
    text(group.key); const dimensions = list(group.dimensions, 2); dimensions.forEach(value => text(value, 128));
    if (typeof group.other !== "boolean" || dimensions.length !== (group.other ? 1 : query.groupBy.length)) invalid();
    measures(group.measures, query.metricIds); integer(group.daysWithRecords, query.dayCount);
    if (group.previous !== null) { if (view.previous === null) invalid(); measures(group.previous, query.metricIds); }
  }
  if (view.previous !== null) {
    const previous = object(view.previous, ["firstUtcDay", "dayCount", "matched", "reason", "measures", "cohort", "daysWithRecords"]);
    if (previous.dayCount !== query.dayCount || integer(previous.firstUtcDay, STATS_MAX_DAY) + query.dayCount !== query.firstUtcDay || typeof previous.matched !== "boolean") invalid();
    if (previous.reason !== null && !Object.hasOwn(METRIC_REASON_TEXT, String(previous.reason))) invalid();
    if (previous.matched !== (previous.reason === null)) invalid();
    measures(previous.measures, query.metricIds); integer(previous.daysWithRecords, query.dayCount);
    if (previous.matched && previous.daysWithRecords !== query.dayCount) invalid();
    const cohort = object(previous.cohort, ["matched", "reason", "currentOnly", "previousOnly"]);
    if (typeof cohort.matched !== "boolean" || cohort.matched !== (cohort.reason === null) || (cohort.reason !== null && !Object.hasOwn(METRIC_REASON_TEXT, String(cohort.reason)))) invalid();
    integer(cohort.currentOnly, STATS_MAX_ROWS); integer(cohort.previousOnly, STATS_MAX_ROWS);
    if (cohort.matched && (!previous.matched || cohort.currentOnly !== 0 || cohort.previousOnly !== 0)) invalid();
  }
  const coverage = object(view.coverage, ["selectedSourceClients", "sourceIssues", "unknownBasisRecords", "filteredOutRows", "unobservedDays", "includesCurrentOrFutureDay"]);
  integer(coverage.selectedSourceClients, 64); integer(coverage.sourceIssues, 64); amount(coverage.unknownBasisRecords);
  integer(coverage.filteredOutRows, STATS_MAX_ROWS); integer(coverage.unobservedDays, query.dayCount);
  if (typeof coverage.includesCurrentOrFutureDay !== "boolean") invalid();
  const facets = object(view.facets, ["clients", "providers", "models", "hasEstimated"]);
  if (typeof facets.hasEstimated !== "boolean") invalid();
  for (const [key, valid] of [["clients", isStatsClient], ["providers", isStatsProvider], ["models", isStatsModel]] as const) {
    for (const value of list(facets[key], STATS_MAX_ROWS)) if ((key === "clients" || value !== "~") && !valid(value)) invalid();
  }
  const projection = object(view.projection, ["totals", "groups", "buckets", "calendar", "dailyTotals", "snapshotTotals", "prior", "split"]);
  totals(projection.totals); totals(projection.snapshotTotals); if (projection.prior !== null) totals(projection.prior);
  for (const item of list(projection.groups, 51)) { const group = object(item, ["key", "name", "totals", "other"]); text(group.key); text(group.name); totals(group.totals); if (typeof group.other !== "boolean") invalid(); }
  const range = (value: Record<string, unknown>) => { const first = integer(value.firstUtcDay, STATS_MAX_DAY), count = integer(value.dayCount, query.dayCount);
    if (count === 0 || first < query.firstUtcDay || first + count > query.firstUtcDay + query.dayCount) invalid(); };
  for (const item of list(projection.buckets, 366)) { const bucket = object(item, ["firstUtcDay", "dayCount", "totals"]); range(bucket); totals(bucket.totals); }
  if (!(projection.dailyTotals instanceof Map) || projection.dailyTotals.size > query.dayCount) invalid();
  for (const [day, value] of projection.dailyTotals) { if (!statsInteger(day, query.firstUtcDay, query.firstUtcDay + query.dayCount - 1)) invalid(); totals(value); }
  const calendar = object(projection.calendar, ["weeks", "cells", "monthMarks", "activeDays", "peak"]), weeks = integer(calendar.weeks, 54);
  integer(calendar.activeDays, query.dayCount);
  const cell = (value: unknown) => { if (value === null) return; const fields = object(value, ["utcDay", "records", "tokenRecords", "tokens", "tier"]);
    if (!statsInteger(fields.utcDay, query.firstUtcDay, query.firstUtcDay + query.dayCount - 1)) invalid();
    integer(fields.tokenRecords, integer(fields.records)); amount(fields.tokens); integer(fields.tier, 4); };
  const cells = list(calendar.cells, 378); if (cells.length !== weeks * 7) invalid(); cells.forEach(cell); cell(calendar.peak);
  for (const value of list(calendar.monthMarks, 13)) { const mark = object(value, ["column", "label"]); integer(mark.column, weeks - 1); text(mark.label, 32); }
  const split = object(projection.split, ["series", "buckets"]);
  const series = (value: unknown) => { const fields = object(value, ["key", "name", "slot", "tokens", "records"]); text(fields.key); text(fields.name); integer(fields.slot, 5); amount(fields.tokens); integer(fields.records); };
  list(split.series, 6).forEach(series);
  for (const value of list(split.buckets, 366)) { const bucket = object(value, ["firstUtcDay", "dayCount", "segments"]); range(bucket); list(bucket.segments, 6).forEach(series); }
}
/** A transferred byte envelope gives the UI an enforceable allocation ceiling
 * before decoding and avoids cloning thousands of shared nested objects. */
export function decodeMetricPresentation(bytes: ArrayBuffer): MetricPresentation {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0 || bytes.byteLength > MAX_METRIC_VIEW_BYTES) throw new Error("metric_view_limit");
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes), (_, item: unknown) => {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const fields = Object.keys(item);
      if (fields.length === 1 && fields[0] === "$metricInteger") {
        const decimal = (item as { $metricInteger: unknown }).$metricInteger;
        if (typeof decimal !== "string" || !/^(?:0|-?[1-9][0-9]{0,79})$/u.test(decimal)) throw new Error("metric_view_integer");
        return BigInt(decimal);
      }
      if (fields.length === 1 && fields[0] === "$metricMap") {
        const entries = (item as { $metricMap: unknown }).$metricMap;
        if (!Array.isArray(entries) || entries.length > 366 || entries.some(entry => !Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[0]))) throw new Error("metric_view_map");
        const map = new Map(entries); if (map.size !== entries.length) throw new Error("metric_view_map"); return map;
      }
    }
    return item !== null && typeof item === "object" ? Object.freeze(item) : item;
  }) as unknown;
  validatePresentation(value);
  return Object.freeze(value);
}
