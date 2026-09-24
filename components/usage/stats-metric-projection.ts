import type { MetricGroup, MetricResult } from "@/lib/usage/metric-explorer";
import type { MetricBase, MetricFold } from "@/lib/usage/metric-explorer-fold";
import { formatStatsDay, statsDayGridFromTotals, statsLabel, type StatsBucket, type StatsGroup, type StatsStackBucket, type StatsStackSeries, type StatsTotals } from "./stats-view";

export function metricStatsTotals(value: MetricBase, activeDays: number): StatsTotals {
  return { ...value.tokens, tokens: value.total, records: Number(value.records), tokenRecords: Number(value.tokenRecords),
    partialRecords: Number(value.partialRecords), activeDays, reportedCost: value.reportedCost, reportedCostRecords: Number(value.reportedCostRecords),
    estimatedCost: value.estimatedCost, estimatedCostRecords: Number(value.estimatedCostRecords), durationMs: value.durationMs,
    timedRecords: Number(value.timedRecords), timedTokens: value.timedTokens, timedTokenRecords: Number(value.timedTokenRecords) };
}
export function metricGroupName(group: Pick<MetricGroup, "other" | "dimensions">, result: Pick<MetricResult, "query">): string {
  if (group.other) return "Other";
  return group.dimensions.map((value, index) => {
    const dimension = result.query.groupBy[index];
    if (dimension === "utc-day") return formatStatsDay(Number(value));
    if (dimension === "utc-week") return `Week of ${formatStatsDay(Number(value))}`;
    if (dimension === "utc-month") return value;
    if (dimension === "weekday") return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(value)];
    return statsLabel(value, dimension === "client" ? "client" : undefined);
  }).join(" / ") || "All selected observations";
}
function plus(totals: readonly StatsTotals[]): StatsTotals {
  const result: StatsTotals = { tokens: 0n, input: 0n, cacheRead: 0n, cacheWrite: 0n, output: 0n, reasoning: 0n,
    records: 0, tokenRecords: 0, partialRecords: 0, activeDays: 0, reportedCost: null, reportedCostRecords: 0,
    estimatedCost: null, estimatedCostRecords: 0, durationMs: null, timedRecords: 0, timedTokenRecords: 0, timedTokens: 0n };
  for (const value of totals) {
    for (const key of ["tokens", "input", "cacheRead", "cacheWrite", "output", "reasoning", "timedTokens"] as const) result[key] += value[key];
    for (const key of ["records", "tokenRecords", "partialRecords", "activeDays", "reportedCostRecords", "estimatedCostRecords", "timedRecords", "timedTokenRecords"] as const) result[key] += value[key];
    for (const key of ["reportedCost", "estimatedCost", "durationMs"] as const) if (value[key] !== null) result[key] = (result[key] ?? 0n) + value[key];
  }
  return result;
}
export function metricStatsProjection(result: MetricResult) {
  const range = result.query, width = range.dayCount > 62 ? 7 : 1;
  const dailyTotals = new Map(result.fold.days.map(day => [day.utcDay, metricStatsTotals(day.totals, 1)]));
  const buckets: StatsBucket[] = [];
  for (let offset = 0; offset < range.dayCount; offset += width) {
    const firstUtcDay = range.firstUtcDay + offset, dayCount = Math.min(width, range.dayCount - offset);
    buckets.push({ firstUtcDay, dayCount, totals: plus(Array.from({ length: dayCount }, (_, index) => dailyTotals.get(firstUtcDay + index)).filter(value => value !== undefined)) });
  }
  const groups: StatsGroup[] = result.groups.map(group => ({ key: group.other ? "other" : group.dimensions.length === 1 ? group.dimensions[0] : group.key,
    name: metricGroupName(group, result), totals: metricStatsTotals(group.fold, group.fold.days.length), other: group.other }));
  const series: StatsStackSeries[] = result.composition.map((group, slot) => ({ key: group.key, name: metricGroupName(group, result), slot,
    tokens: group.fold.total, records: Number(group.fold.records) }));
  const stackBuckets: StatsStackBucket[] = buckets.map(bucket => ({ firstUtcDay: bucket.firstUtcDay, dayCount: bucket.dayCount,
    segments: result.composition.map((group, slot) => {
      const days = group.fold.days.filter(day => day.utcDay >= bucket.firstUtcDay && day.utcDay < bucket.firstUtcDay + bucket.dayCount);
      return { key: group.key, name: series[slot].name, slot, tokens: days.reduce((sum, day) => sum + day.totals.total, 0n), records: Number(days.reduce((sum, day) => sum + day.totals.records, 0n)) };
    }).filter(segment => segment.records > 0) }));
  const fromFold = (fold: MetricFold) => metricStatsTotals(fold, fold.days.length);
  return { totals: fromFold(result.fold), groups, buckets, calendar: statsDayGridFromTotals(dailyTotals, range), dailyTotals,
    snapshotTotals: fromFold(result.refreshSnapshot.fold), prior: result.previous === null ? null : fromFold(result.previous.fold),
    split: { series, buckets: stackBuckets } };
}
