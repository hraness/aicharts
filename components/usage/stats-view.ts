import type { UsageStatsReport, UsageStatsRow } from "@/lib/usage/stats-contract";
import { STATS_CLIENTS } from "@/lib/usage/stats-registry";

export const ALL_STATS = "*";
export const UNKNOWN_STATS = "~";
export const STATS_DAY_MS = 86_400_000;
export type StatsRange = { firstUtcDay: number; dayCount: number };
export type StatsFilters = StatsRange & { client: string; provider: string; model: string; basis: "reported" | "estimated" };
export type StatsSelection = Pick<StatsFilters, "client" | "provider" | "model" | "basis">;
export type StatsGrouping = "client" | "provider" | "model";
export type StatsSort = "tokens" | "output" | "records" | "name";
export type StatsTotals = {
  tokens: bigint; input: bigint; cacheRead: bigint; cacheWrite: bigint; output: bigint; reasoning: bigint;
  records: number; tokenRecords: number; partialRecords: number; activeDays: number;
  reportedCost: bigint | null; reportedCostRecords: number;
  estimatedCost: bigint | null; estimatedCostRecords: number;
  durationMs: bigint | null; timedRecords: number; timedTokens: bigint;
};
export type StatsGroup = { key: string; name: string; totals: StatsTotals };
export type StatsBucket = StatsRange & { totals: StatsTotals };

const number = new Intl.NumberFormat("en-US");
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const formatStatsInteger = (value: bigint | number) => number.format(value);
export const formatStatsDay = (day: number) => date.format(day * STATS_DAY_MS);
export const statsDateInput = (day: number) => new Date(day * STATS_DAY_MS).toISOString().slice(0, 10);

export function statsInputRange(first: string, last: string): StatsRange | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(first) || !/^\d{4}-\d{2}-\d{2}$/.test(last)) return null;
  const firstUtcDay = Date.parse(`${first}T00:00:00.000Z`) / STATS_DAY_MS;
  const lastUtcDay = Date.parse(`${last}T00:00:00.000Z`) / STATS_DAY_MS;
  if (!Number.isSafeInteger(firstUtcDay) || !Number.isSafeInteger(lastUtcDay) || firstUtcDay < 0
    || statsDateInput(firstUtcDay) !== first || statsDateInput(lastUtcDay) !== last) return null;
  const dayCount = lastUtcDay - firstUtcDay + 1;
  return dayCount >= 1 && dayCount <= 366 ? { firstUtcDay, dayCount } : null;
}

export function formatStatsCompact(value: bigint): string {
  for (const [unit, size] of [["T", 1_000_000_000_000n], ["B", 1_000_000_000n], ["M", 1_000_000n], ["K", 1_000n]] as const) {
    if (value >= size) {
      const scaled = value * 100n / size;
      return `${number.format(scaled / 100n)}.${(scaled % 100n).toString().padStart(2, "0")}${unit}`;
    }
  }
  return number.format(value);
}

/** Money is rounded to cents with integer arithmetic; unknown is never zero. */
export function formatStatsMoney(value: bigint | null): string {
  if (value === null) return "Unavailable";
  if (value > 0n && value < 10_000n) return "< $0.01";
  const cents = (value + 5_000n) / 10_000n;
  return `$${number.format(cents / 100n)}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export function statsRatio(value: bigint, total: bigint): number {
  return total === 0n ? 0 : Number(value * 10_000n / total) / 100;
}

export function statsLabel(value: string | null, dimension?: StatsGrouping): string {
  if (value === null || value === UNKNOWN_STATS) return "Unknown";
  const names: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", google: "Google" };
  return (dimension === "client" ? STATS_CLIENTS.find(client => client.id === value)?.name : undefined) ?? names[value] ?? value;
}

export function sumStatsRows(rows: readonly UsageStatsRow[]): StatsTotals {
  const totals: StatsTotals = { tokens: 0n, input: 0n, cacheRead: 0n, cacheWrite: 0n, output: 0n, reasoning: 0n,
    records: 0, tokenRecords: 0, partialRecords: 0, activeDays: 0, reportedCost: null, reportedCostRecords: 0, estimatedCost: null, estimatedCostRecords: 0,
    durationMs: null, timedRecords: 0, timedTokens: 0n };
  const active = new Set<number>();
  for (const row of rows) {
    for (const key of ["input", "cacheRead", "cacheWrite", "output", "reasoning"] as const) {
      const value = BigInt(row.tokens[key]);
      totals[key] += value;
      totals.tokens += value;
    }
    totals.records += row.records;
    if (row.tokenBasis !== "unavailable") totals.tokenRecords += row.records;
    if (row.records > 0) active.add(row.utcDay);
    if (row.breakdownCoverage === "partial") totals.partialRecords += row.records;
    if (row.reportedCostMicrousd !== null) totals.reportedCost = (totals.reportedCost ?? 0n) + BigInt(row.reportedCostMicrousd);
    if (row.estimatedCostMicrousd !== null) totals.estimatedCost = (totals.estimatedCost ?? 0n) + BigInt(row.estimatedCostMicrousd);
    totals.reportedCostRecords += row.reportedCostRecords;
    totals.estimatedCostRecords += row.estimatedCostRecords;
    if (row.durationMs !== null) totals.durationMs = (totals.durationMs ?? 0n) + BigInt(row.durationMs);
    totals.timedRecords += row.timedRecords;
    totals.timedTokens += BigInt(row.timedTokens);
  }
  totals.activeDays = active.size;
  return totals;
}

function dimensionMatches(value: string | null, selected: string): boolean {
  return selected === ALL_STATS || (value === null ? selected === UNKNOWN_STATS : value === selected);
}

export function filterStatsRows(report: UsageStatsReport, filters: StatsFilters): UsageStatsRow[] {
  return report.rows.filter(row => row.client !== "warp" && row.utcDay >= filters.firstUtcDay && row.utcDay < filters.firstUtcDay + filters.dayCount
    && (row.tokenBasis === filters.basis || (filters.basis === "reported" && row.tokenBasis === "unavailable")) && dimensionMatches(row.client, filters.client)
    && dimensionMatches(row.provider, filters.provider) && dimensionMatches(row.model, filters.model));
}

/** Warp reports a cumulative refresh snapshot, never UTC event-day usage. */
export function filterStatsSnapshots(report: UsageStatsReport, filters: StatsFilters): UsageStatsRow[] {
  if (filters.basis !== "reported" || !dimensionMatches("warp", filters.client)) return [];
  const snapshots = report.rows.filter(row => row.client === "warp");
  const latestDay = snapshots.reduce((latest, row) => Math.max(latest, row.utcDay), -1);
  return snapshots.filter(row => row.utcDay === latestDay && dimensionMatches(row.provider, filters.provider) && dimensionMatches(row.model, filters.model));
}

export function groupStatsRows(rows: readonly UsageStatsRow[], by: StatsGrouping, sort: StatsSort, ascending = false): StatsGroup[] {
  const groups = new Map<string, UsageStatsRow[]>();
  for (const row of rows) {
    const key = row[by] ?? UNKNOWN_STATS;
    const members = groups.get(key) ?? [];
    members.push(row); groups.set(key, members);
  }
  const result = [...groups].map(([key, members]) => ({ key, name: statsLabel(key, by), totals: sumStatsRows(members) }));
  return result.sort((a, b) => {
    let difference: number;
    if (sort === "name") difference = a.name.localeCompare(b.name, "en");
    else {
      const left = sort === "output" ? a.totals.output + a.totals.reasoning : a.totals[sort];
      const right = sort === "output" ? b.totals.output + b.totals.reasoning : b.totals[sort];
      difference = left < right ? -1 : left > right ? 1 : 0;
    }
    return (ascending ? difference : -difference) || a.name.localeCompare(b.name, "en");
  });
}

/** Weekly buckets keep a full-year plot readable; every row remains in the same total. */
export function bucketStatsRows(rows: readonly UsageStatsRow[], range: StatsRange): StatsBucket[] {
  const width = range.dayCount > 62 ? 7 : 1;
  const buckets: Array<StatsRange & { rows: UsageStatsRow[] }> = [];
  for (let offset = 0; offset < range.dayCount; offset += width) {
    buckets.push({ firstUtcDay: range.firstUtcDay + offset, dayCount: Math.min(width, range.dayCount - offset), rows: [] });
  }
  for (const row of rows) {
    const bucket = buckets[Math.floor((row.utcDay - range.firstUtcDay) / width)];
    if (bucket && row.utcDay >= bucket.firstUtcDay && row.utcDay < bucket.firstUtcDay + bucket.dayCount) bucket.rows.push(row);
  }
  return buckets.map(({ rows: members, ...bucket }) => ({ ...bucket, totals: sumStatsRows(members) }));
}

const csvCell = (value: string) => `"${(/^[=+\-@]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
export function statsRowsCsv(rows: readonly UsageStatsRow[]): string {
  const header = ["utc_day", "time_basis", "client", "provider", "model", "token_basis", "input", "cache_read", "cache_write", "output_excluding_reasoning", "reasoning", "total_tokens", "records", "breakdown_coverage", "reported_cost_microusd", "reported_cost_records", "retail_estimate_microusd", "estimated_cost_records", "source_duration_ms", "timed_records", "timed_tokens"];
  const lines = rows.map(row => [statsDateInput(row.utcDay), row.client === "warp" ? "refresh_snapshot" : "observed", row.client, row.provider ?? "unknown", row.model ?? "unknown", row.tokenBasis,
    ...[row.tokens.input, row.tokens.cacheRead, row.tokens.cacheWrite, row.tokens.output, row.tokens.reasoning,
      sumStatsRows([row]).tokens.toString()].map(value => row.tokenBasis === "unavailable" ? "" : value), row.records.toString(), row.breakdownCoverage,
    row.reportedCostMicrousd ?? "", row.reportedCostRecords.toString(), row.estimatedCostMicrousd ?? "", row.estimatedCostRecords.toString(),
    row.durationMs ?? "", row.timedRecords.toString(), row.timedRecords === 0 ? "" : row.timedTokens].map(csvCell).join(","));
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

export function previousStatsPeriod(report: UsageStatsReport, filters: StatsFilters): StatsTotals | null {
  const firstUtcDay = filters.firstUtcDay - filters.dayCount;
  if (firstUtcDay < report.firstUtcDay || filters.firstUtcDay + filters.dayCount > report.firstUtcDay + report.dayCount) return null;
  return sumStatsRows(filterStatsRows(report, { ...filters, firstUtcDay }));
}
