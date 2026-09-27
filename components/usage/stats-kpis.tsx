import type { ReactNode } from "react";
import { formatStatsCompact, formatStatsInteger, formatStatsMoney, statsCacheReadShare, statsRatio, type StatsTotals } from "./stats-view";

type Tile = Readonly<{ key: string; label: string; value: ReactNode; detail: ReactNode; tone?: "lead" | "up" | "down" }>;

function Exact({ value }: Readonly<{ value: bigint }>) {
  return <span title={`${formatStatsInteger(value)} exact`}><span aria-hidden="true">{formatStatsCompact(value)}</span><span className="usage-stats__sr">{formatStatsInteger(value)}</span></span>;
}

/**
 * The period at a glance: volume, velocity (per active day and the latest
 * day), request cadence, cache efficiency and spend. Every tile is derived
 * from the same exact totals as the tables; unknown inputs say so instead of
 * showing zero.
 */
export function StatsKpis({ totals, basis, dayCount, latest, latestLabel, prior, priorMatched }: Readonly<{
  totals: StatsTotals; basis: string; dayCount: number; latest: StatsTotals | null; latestLabel: string;
  /** The equally long previous period, when it is fully inside the report. */
  prior: StatsTotals | null; priorMatched: boolean;
}>) {
  const known = totals.tokenRecords > 0;
  const perDay = known && totals.activeDays > 0 ? totals.tokens / BigInt(totals.activeDays) : null;
  const cache = statsCacheReadShare(totals);
  const change = known && priorMatched && prior !== null && prior.tokenRecords > 0 && prior.tokens > 0n ? statsRatio(totals.tokens - prior.tokens, prior.tokens) : null;
  const tiles: Tile[] = [
    // The one exact total on the page (`.usage-stats__exact`); the matched
    // change, when both periods are complete, rides beside it.
    { key: "tokens", label: `${basis} tokens`, tone: "lead",
      value: known ? <Exact value={totals.tokens} /> : "—",
      detail: <><span className="usage-stats__exact">{known ? `${formatStatsInteger(totals.tokens)} exact` : "No token observations"}</span>
        {change !== null && <span data-trend={change >= 0 ? "up" : "down"}>{change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}% vs previous {dayCount} days</span>}</> },
    { key: "per-day", label: "Per active day", value: perDay === null ? "—" : <Exact value={perDay} />,
      detail: `${totals.activeDays} of ${dayCount} ${dayCount === 1 ? "day" : "days"} active` },
    { key: "latest", label: latestLabel,
      value: latest !== null && latest.tokenRecords > 0 ? <Exact value={latest.tokens} /> : "—",
      detail: latest === null || latest.records === 0 ? "No records yet" : `${formatStatsInteger(latest.records)} records` },
    { key: "records", label: "Records per day", value: totals.activeDays > 0 ? formatStatsInteger(Math.round(totals.records / totals.activeDays)) : "—",
      detail: `${formatStatsInteger(totals.records)} in the period` },
    { key: "cache", label: "Cache reads", value: cache === null ? "—" : `${cache.toFixed(1)}%`,
      detail: cache === null ? "Needs complete input categories" : <>of whole input · <Exact value={totals.cacheRead} /></> },
    totals.reportedCost !== null
      ? { key: "cost", label: "Reported cost", value: formatStatsMoney(totals.reportedCost),
        detail: totals.estimatedCost !== null ? `Estimate ${formatStatsMoney(totals.estimatedCost)} · separate records` : `${formatStatsInteger(totals.reportedCostRecords)} of ${formatStatsInteger(totals.records)} records` }
      : totals.estimatedCost !== null
        ? { key: "cost", label: "Estimated cost", value: formatStatsMoney(totals.estimatedCost), detail: "Public API prices, not a bill" }
        : { key: "cost", label: "Cost", value: "—", detail: "No cost in these records" },
  ];
  return <dl className="usage-kpis" aria-label="Period at a glance">
    {tiles.map(tile => <div key={tile.key} className="usage-kpis__tile" data-kpi={tile.key} data-tone={tile.tone}>
      <dt>{tile.label}</dt><dd><strong>{tile.value}</strong><span>{tile.detail}</span></dd>
    </div>)}
  </dl>;
}

/** Short "Sep 27" labels for chart ticks; the full date stays in accessible names. */
const shortDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export function formatStatsShortDay(utcDay: number): string {
  return shortDay.format(new Date(utcDay * 86_400_000));
}
