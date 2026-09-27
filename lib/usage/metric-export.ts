/** Per-metric CSV export (D4/D12). Every row carries the metric identity,
 * version, unit, the filters that produced it and the snapshot revision, so a
 * downloaded file can be traced to one evaluated selection. Values stay exact
 * decimal strings; ratios keep numerator and denominator apart. Unavailable
 * measures export an empty value with their explicit reason. */
import { isMetricResult, MAX_METRIC_EXPORT_BYTES, metricSnapshotDigest, type MetricResult } from "./metric-explorer";
import type { MetricMeasure, MetricValue } from "./metric-explorer-values";
import type { RichMetricMeasure } from "./rich-metric-explorer";
import type { RichExplorerResult } from "./rich-metric-explorer-view";

export const METRIC_CSV_COLUMNS = ["metric_id", "metric_version", "unit", "source_profile", "snapshot_sha256", "snapshot_revision",
  "query_first_utc_day", "query_day_count", "query_token_basis", "query_cost_kind", "filter_client", "filter_provider", "filter_model", "group_by",
  "scope", "group_key", "dimension_1", "dimension_2", "status", "value_kind", "value", "denominator",
  "eligible_records", "selected_records", "excluded_records", "reason", "evidence"] as const;
export const RICH_METRIC_CSV_COLUMNS = ["metric_id", "metric_version", "unit", "source_profile", "snapshot_revision",
  "query_start_ms", "query_end_ms", "query_grain", "query_token_scope", "query_lineage", "query_quantity", "query_time_zone",
  "filter_provider", "filter_model", "filter_session", "group_by",
  "scope", "group_key", "dimension_1", "dimension_2", "status", "value_kind", "value", "denominator",
  "measured", "unmeasured", "reason", "cohort"] as const;

export function csvCell(value: string | number | bigint | boolean | null): string {
  if (value === null) return "";
  const text = typeof value === "string" ? value : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function csvDocument(header: readonly string[], rows: readonly (readonly (string | number | bigint | boolean | null)[])[]): string {
  const output = [header.map(csvCell).join(","), ...rows.map(row => row.map(csvCell).join(","))].join("\r\n") + "\r\n";
  if (new TextEncoder().encode(output).byteLength > MAX_METRIC_EXPORT_BYTES) throw new Error("metric_export_limit");
  return output;
}
function valueColumns(value: MetricValue | null): [string | null, bigint | null, bigint | null] {
  if (value === null) return [null, null, null];
  return value.kind === "integer" ? ["integer", value.amount, null] : ["ratio", value.numerator, value.denominator];
}
function measureOf(measures: readonly MetricMeasure[], metricId: string): MetricMeasure | null {
  return measures.find(measure => measure.id === metricId) ?? null;
}

/** One metric from an aggregate explorer result: its total plus every listed group. */
export async function metricCsv(result: MetricResult, metricId: string): Promise<string> {
  if (!isMetricResult(result)) throw new Error("metric_result_invalid");
  const total = measureOf(result.measures, metricId);
  if (total === null) throw new Error("metric_not_in_result");
  const digest = await metricSnapshotDigest(result.snapshot);
  const { query } = result;
  const prefix = [metricId, total.version, total.unit, result.snapshot.profile, digest, result.snapshot.revision,
    query.firstUtcDay, query.dayCount, query.basis, query.costKind, query.filters.client, query.filters.provider, query.filters.model, query.groupBy.join("+")] as const;
  const line = (scope: "total" | "group" | "other", key: string, dimensions: readonly string[], measure: MetricMeasure) => {
    const [kind, value, denominator] = valueColumns(measure.value);
    return [...prefix, scope, key, dimensions[0] ?? null, dimensions[1] ?? null, measure.status, kind, value, denominator,
      measure.eligibleRecords, measure.selectedRecords, measure.excludedRecords, measure.reason, measure.evidence];
  };
  const rows = [line("total", "", [], total)];
  for (const group of result.groups) {
    const measure = measureOf(group.measures, metricId);
    if (measure) rows.push(line(group.other ? "other" : "group", group.key, group.dimensions, measure));
  }
  return csvDocument(METRIC_CSV_COLUMNS, rows);
}

/** One rich metric: total, groups and, for distributions, exact percentile rows. */
export function richMetricCsv(result: RichExplorerResult): string {
  const { query, measure } = result;
  const prefix = [measure.id, measure.version, measure.unit, result.profile, result.revision,
    query.selection.window.startMs, query.selection.window.endMs, query.selection.grain, query.selection.tokenScope, query.selection.lineage, query.quantity, query.timeZone,
    query.filters.provider, query.filters.model, query.filters.session, query.groupBy.join("+")] as const;
  const line = (scope: string, key: string, dimensions: readonly string[], value: RichMetricMeasure, reason: string | null = value.reason) => {
    const [kind, amount, denominator] = valueColumns(value.value);
    return [...prefix, scope, key, dimensions[0] ?? null, dimensions[1] ?? null, value.status, kind, amount, denominator, value.measured, value.unmeasured, reason, value.cohort];
  };
  const rows = [line("total", "", [], measure, result.reason ?? measure.reason)];
  for (const group of result.groups) rows.push(line("group", group.key, group.dimensions, group.measure));
  if (result.distribution) {
    const d = result.distribution;
    const statistic = (name: string, value: bigint | null) =>
      [...prefix, "distribution", name, null, null, value === null ? "unavailable" : "available", value === null ? null : "integer", value, null, d.measured, d.unmeasured, null, measure.cohort];
    rows.push(statistic("minimum", d.minimum), statistic("p50", d.p50), statistic("p90", d.p90), statistic("p95", d.p95), statistic("p99", d.p99), statistic("maximum", d.maximum));
    rows.push([...prefix, "distribution", "sum", null, null, "available", "integer", d.sum, null, d.measured, d.unmeasured, null, measure.cohort]);
    if (d.mean) rows.push([...prefix, "distribution", "mean", null, null, "available", "ratio", d.mean.numerator, d.mean.denominator, d.measured, d.unmeasured, null, measure.cohort]);
    for (const [index, bin] of d.bins.entries()) rows.push([...prefix, "histogram", `bin-${index}`, bin.lower, bin.upper, "available", "integer", bin.count, null, d.measured, d.unmeasured, null, measure.cohort]);
  }
  return csvDocument(RICH_METRIC_CSV_COLUMNS, rows);
}

/** Minimal CSV reader for the equivalence checks: RFC 4180 quoting, CRLF rows. */
export function parseCsv(text: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') { if (text[index + 1] === '"') { cell += '"'; index += 1; } else quoted = false; }
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\r" && text[index + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; index += 1; }
    else cell += char;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}
