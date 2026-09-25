import type { UsageStatsReport, UsageStatsRow } from "@/lib/usage/stats-contract";
import { STATS_CLIENTS } from "@/lib/usage/stats-registry";

export const ALL_STATS = "*";
export const UNKNOWN_STATS = "~";
export const STATS_DAY_MS = 86_400_000;
export type StatsRange = { firstUtcDay: number; dayCount: number };
export type StatsFilters = StatsRange & { client: string; provider: string; model: string; basis: "reported" | "estimated" };
export type StatsSelection = Pick<StatsFilters, "client" | "provider" | "model" | "basis">;
export type StatsGrouping = "client" | "provider" | "model";
export type StatsMetric = "tokens" | "records" | "speed";
export type StatsSort = "tokens" | "output" | "records" | "name";
export type StatsTotals = {
  tokens: bigint; input: bigint; cacheRead: bigint; cacheWrite: bigint; output: bigint; reasoning: bigint;
  records: number; tokenRecords: number; partialRecords: number; activeDays: number;
  reportedCost: bigint | null; reportedCostRecords: number;
  estimatedCost: bigint | null; estimatedCostRecords: number;
  durationMs: bigint | null; timedRecords: number; timedTokens: bigint;
  /** Timed records with observed reported/estimated tokens, including measured zero. */
  timedTokenRecords: number;
};
export type StatsGroup = { key: string; name: string; totals: StatsTotals; other?: boolean };
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

/** Whole-input share requires every selected record's disjoint categories. */
export function statsCacheReadShare(totals: StatsTotals): number | null {
  const input = totals.input + totals.cacheRead + totals.cacheWrite;
  return totals.records > 0 && totals.tokenRecords === totals.records && totals.partialRecords === 0 && input > 0n
    ? statsRatio(totals.cacheRead, input) : null;
}

/** The duration denominator may not include records with unknown token counts.
 * Keep all recorded durations for inspection, but withhold this aggregate rate
 * until every timed record has a token basis. It is not a decode-speed metric. */
export function statsSourceTokenRate(totals: StatsTotals): bigint | null {
  return totals.timedRecords > 0 && totals.timedTokenRecords === totals.timedRecords
    && totals.durationMs !== null && totals.durationMs > 0n
    ? totals.timedTokens * 1000n / totals.durationMs : null;
}

export function statsLabel(value: string | null, dimension?: StatsGrouping): string {
  if (value === null || value === UNKNOWN_STATS) return "Unknown";
  const names: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", google: "Google" };
  return (dimension === "client" ? STATS_CLIENTS.find(client => client.id === value)?.name : undefined) ?? names[value] ?? value;
}

export function sumStatsRows(rows: readonly UsageStatsRow[]): StatsTotals {
  const totals: StatsTotals = { tokens: 0n, input: 0n, cacheRead: 0n, cacheWrite: 0n, output: 0n, reasoning: 0n,
    records: 0, tokenRecords: 0, partialRecords: 0, activeDays: 0, reportedCost: null, reportedCostRecords: 0, estimatedCost: null, estimatedCostRecords: 0,
    durationMs: null, timedRecords: 0, timedTokens: 0n, timedTokenRecords: 0 };
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
    if (row.tokenBasis !== "unavailable") totals.timedTokenRecords += row.timedRecords;
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

/** The value a bucket plots for a metric; null marks an honest unobserved gap, never zero. */
export function statsBucketValue(totals: StatsTotals, metric: StatsMetric): bigint | null {
  if (metric === "records") return BigInt(totals.records);
  if (metric === "speed") return statsSourceTokenRate(totals);
  return totals.tokenRecords > 0 ? totals.tokens : null;
}

export type StatsDayCell = { utcDay: number; records: number; tokenRecords: number; tokens: bigint; tier: number };
export type StatsCalendarGrid = {
  /** Column count; cells are column-major with weekday rows starting Sunday. */
  weeks: number;
  cells: (StatsDayCell | null)[];
  monthMarks: { column: number; label: string }[];
  activeDays: number;
  peak: StatsDayCell | null;
};

const monthMark = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const utcWeekday = (day: number) => new Date(day * STATS_DAY_MS).getUTCDay();

/**
 * Calendar density over a UTC range: one cell per day, weeks as columns, Sunday on top.
 * Tiers are quartiles of days that carried token observations, so the scale adapts to
 * heavy-tailed volumes; records without a token basis render as unknown, not zero.
 */
export function statsDayGrid(rows: readonly UsageStatsRow[], range: StatsRange): StatsCalendarGrid {
  const first = Math.floor(range.firstUtcDay), dayCount = Math.floor(range.dayCount);
  const dayTotals = new Map<number, { records: number; tokenRecords: number; tokens: bigint }>();
  for (const row of rows) {
    if (row.utcDay < first || row.utcDay >= first + dayCount) continue;
    const day = dayTotals.get(row.utcDay) ?? { records: 0, tokenRecords: 0, tokens: 0n };
    day.records += row.records;
    if (row.tokenBasis !== "unavailable") {
      day.tokenRecords += row.records;
      for (const key of ["input", "cacheRead", "cacheWrite", "output", "reasoning"] as const) day.tokens += BigInt(row.tokens[key]);
    }
    dayTotals.set(row.utcDay, day);
  }
  return statsDayGridFromTotals(dayTotals, range);
}

/** The dashboard shares its already selected daily fold with the calendar. */
export function statsDayGridFromTotals(dayTotals: ReadonlyMap<number, { records: number; tokenRecords: number; tokens: bigint }>, range: StatsRange): StatsCalendarGrid {
  const first = Math.floor(range.firstUtcDay), dayCount = Math.floor(range.dayCount);
  const weeks = Math.max(1, Math.ceil((utcWeekday(first) + dayCount) / 7));
  const cells: (StatsDayCell | null)[] = new Array<StatsDayCell | null>(weeks * 7).fill(null);
  const observed = [...dayTotals.values()].filter(day => day.tokenRecords > 0).map(day => day.tokens).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const quartile = (p: number) => observed[Math.min(observed.length - 1, Math.floor((observed.length - 1) * p))] ?? 0n;
  const q1 = quartile(0.25), q2 = quartile(0.5), q3 = quartile(0.75), peakTokens = observed.at(-1) ?? 0n;
  let activeDays = 0, peak: StatsDayCell | null = null;
  for (let offset = 0; offset < dayCount; offset++) {
    const utcDay = first + offset, day = dayTotals.get(utcDay) ?? { records: 0, tokenRecords: 0, tokens: 0n };
    const cell: StatsDayCell = { utcDay, records: day.records, tokenRecords: day.tokenRecords, tokens: day.tokens,
      tier: day.records === 0 || day.tokenRecords === 0 ? 0 : day.tokens === 0n ? 1
        : day.tokens === peakTokens ? 4 : 1 + Number(day.tokens > q1) + Number(day.tokens > q2) + Number(day.tokens > q3) };
    cells[Math.floor((utcWeekday(first) + offset) / 7) * 7 + utcWeekday(utcDay)] = cell;
    if (day.records > 0) activeDays += 1;
    if (day.tokenRecords > 0 && (peak === null || day.tokens > peak.tokens)) peak = cell;
  }
  const monthMarks: { column: number; label: string }[] = [];
  for (let column = 0; column < weeks; column++) {
    const spanStart = Math.max(first, first + column * 7 - utcWeekday(first));
    const spanEnd = Math.min(first + dayCount - 1, first + column * 7 - utcWeekday(first) + 6);
    for (let day = spanStart; day <= spanEnd; day++) {
      if (new Date(day * STATS_DAY_MS).getUTCDate() === 1) {
        monthMarks.push({ column, label: monthMark.format(day * STATS_DAY_MS) });
        break;
      }
    }
  }
  return { weeks, cells, monthMarks, activeDays, peak };
}

const csvCell = (value: string) => `"${(/^[=+\-@]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
export function statsRowsCsv(rows: readonly UsageStatsRow[]): string {
  const header = ["utc_day", "time_basis", "client", "provider", "model", "token_basis", "input", "cache_read", "cache_write", "output_excluding_reasoning", "reasoning", "total_tokens", "records", "breakdown_coverage", "reported_cost_microusd", "reported_cost_records", "retail_estimate_microusd", "estimated_cost_records", "source_duration_ms", "timed_records", "timed_tokens", "record_grain", "duration_basis"];
  const lines = rows.map(row => [statsDateInput(row.utcDay), row.client === "warp" ? "refresh_snapshot" : "observed", row.client, row.provider ?? "unknown", row.model ?? "unknown", row.tokenBasis,
    ...[row.tokens.input, row.tokens.cacheRead, row.tokens.cacheWrite, row.tokens.output, row.tokens.reasoning,
      sumStatsRows([row]).tokens.toString()].map(value => row.tokenBasis === "unavailable" ? "" : value), row.records.toString(), row.breakdownCoverage,
    row.reportedCostMicrousd ?? "", row.reportedCostRecords.toString(), row.estimatedCostMicrousd ?? "", row.estimatedCostRecords.toString(),
    row.durationMs ?? "", row.timedRecords.toString(), row.timedRecords === 0 || row.tokenBasis === "unavailable" ? "" : row.timedTokens,
    "source-defined", row.durationMs === null ? "unknown" : "source-defined"].map(csvCell).join(","));
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

export function previousStatsPeriod(report: UsageStatsReport, filters: StatsFilters): StatsTotals | null {
  const firstUtcDay = filters.firstUtcDay - filters.dayCount;
  if (firstUtcDay < report.firstUtcDay || filters.firstUtcDay + filters.dayCount > report.firstUtcDay + report.dayCount) return null;
  return sumStatsRows(filterStatsRows(report, { ...filters, firstUtcDay }));
}

export type StatsStackSeries = { key: string; name: string; slot: number; tokens: bigint; records: number };
export type StatsStackBucket = StatsRange & { segments: StatsStackSeries[] };
export const STATS_STACK_LIMIT = 5;

/**
 * Per-bucket composition for stacked plots. The top series across the whole range keep
 * stable legend slots; everything else folds into a trailing "other" segment so every
 * bucket still sums to its full filtered total. Rows without a token basis contribute
 * records only, never fabricated tokens.
 */
export function statsSplitBuckets(rows: readonly UsageStatsRow[], range: StatsRange, by: StatsGrouping): { buckets: StatsStackBucket[]; series: StatsStackSeries[] } {
  const width = range.dayCount > 62 ? 7 : 1;
  const buckets: StatsStackBucket[] = [];
  for (let offset = 0; offset < range.dayCount; offset += width) {
    buckets.push({ firstUtcDay: range.firstUtcDay + offset, dayCount: Math.min(width, range.dayCount - offset), segments: [] });
  }
  const perKey = new Map<string, { tokens: bigint; records: number }>();
  const perBucket = buckets.map(() => new Map<string, { tokens: bigint; records: number }>());
  for (const row of rows) {
    const index = Math.floor((row.utcDay - range.firstUtcDay) / width);
    const bucket = perBucket[index], bounds = buckets[index];
    if (bucket === undefined || bounds === undefined || row.utcDay < bounds.firstUtcDay || row.utcDay >= bounds.firstUtcDay + bounds.dayCount) continue;
    const key = row[by] ?? UNKNOWN_STATS;
    const weight = row.tokenBasis === "unavailable" ? 0n
      : (["input", "cacheRead", "cacheWrite", "output", "reasoning"] as const).reduce((sum, part) => sum + BigInt(row.tokens[part]), 0n);
    for (const map of [bucket, perKey]) {
      const entry = map.get(key) ?? { tokens: 0n, records: 0 };
      entry.tokens += weight; entry.records += row.records;
      map.set(key, entry);
    }
  }
  const ranked = [...perKey.entries()].sort((a, b) => (a[1].tokens < b[1].tokens ? 1 : a[1].tokens > b[1].tokens ? -1 : a[0].localeCompare(b[0]))).map(([key]) => key);
  const keep = new Set(ranked.slice(0, STATS_STACK_LIMIT));
  const series: StatsStackSeries[] = ranked.slice(0, STATS_STACK_LIMIT)
    .map((key, slot) => ({ key, name: statsLabel(key, by), slot, ...(perKey.get(key) ?? { tokens: 0n, records: 0 }) }));
  const other = ranked.slice(STATS_STACK_LIMIT).reduce((sum, key) => {
    const entry = perKey.get(key); return { tokens: sum.tokens + (entry?.tokens ?? 0n), records: sum.records + (entry?.records ?? 0) };
  }, { tokens: 0n, records: 0 });
  if (ranked.length > STATS_STACK_LIMIT) series.push({ key: "other", name: "Other", slot: STATS_STACK_LIMIT, ...other });
  const slotOf = (key: string) => keep.has(key) ? key : "other";
  const slotFor = (key: string) => series.find(item => item.key === key)?.slot ?? STATS_STACK_LIMIT;
  for (const [index, map] of perBucket.entries()) {
    const segments = new Map<string, StatsStackSeries>();
    for (const [key, entry] of map) {
      const slotKey = slotOf(key);
      const segment = segments.get(slotKey) ?? { key: slotKey, name: slotKey === "other" ? "Other" : statsLabel(slotKey, by), slot: slotFor(slotKey), tokens: 0n, records: 0 };
      segment.tokens += entry.tokens; segment.records += entry.records;
      segments.set(slotKey, segment);
    }
    buckets[index].segments = series.filter(item => segments.has(item.key)).map(item => segments.get(item.key) as StatsStackSeries);
  }
  return { buckets, series };
}

/** Plain-text digest for sharing; every line is either measured or explicitly qualified. */
export function statsSummaryText(scope: "local" | "example" | "account", filters: StatsFilters, totals: StatsTotals, rangeText: string, groups: readonly StatsGroup[]): string {
  const lines = [`AI usage · ${rangeText} (UTC) · ${filters.basis} token basis`];
  lines.push(totals.tokenRecords > 0
    ? `${formatStatsInteger(totals.tokens)} tokens · ${formatStatsInteger(totals.records)} usage records · ${totals.activeDays}/${filters.dayCount} active days`
    : `${formatStatsInteger(totals.records)} usage records · ${totals.activeDays}/${filters.dayCount} active days · tokens unobserved`);
  if (totals.reportedCost !== null || totals.estimatedCost !== null) {
    lines.push([totals.reportedCost !== null ? `Reported cost ${formatStatsMoney(totals.reportedCost)} (${formatStatsInteger(totals.reportedCostRecords)} records)` : null,
      totals.estimatedCost !== null ? `retail estimate ${formatStatsMoney(totals.estimatedCost)} (${formatStatsInteger(totals.estimatedCostRecords)} records; dated public rates)` : null].filter(Boolean).join(" · "));
    lines.push("Cost populations may differ; their difference is not established.");
  }
  const cacheShare = statsCacheReadShare(totals);
  const speed = statsBucketValue(totals, "speed");
  const qualifiers = [
    cacheShare !== null ? `cache reads ${cacheShare}% of whole input (uncached + read + write)` : "cache-read share unavailable: incomplete categories or no input",
    speed !== null ? `${formatStatsInteger(speed)} tokens per source-duration second across ${formatStatsInteger(totals.timedRecords)} timed records; not decode speed`
      : totals.timedTokenRecords < totals.timedRecords ? "source-token rate unavailable: tokens missing from timed records" : null,
  ].filter((item): item is string => item !== null);
  if (qualifiers.length > 0) lines.push(qualifiers.join(" · "));
  const top = groups.filter(group => group.totals.tokenRecords > 0).slice(0, 3)
    .map(group => `${group.name} ${formatStatsCompact(group.totals.tokens)}`);
  if (top.length > 0) lines.push(`Top by tokens: ${top.join(" · ")}`);
  lines.push("Record grain and duration meaning are source-defined; records are not comparable request, turn or session counts.");
  lines.push(`Measured by AI Charts · ${scope === "account" ? "account report" : scope === "example" ? "synthetic example" : "local report"} · coverage may be partial.`);
  return lines.join("\n");
}
