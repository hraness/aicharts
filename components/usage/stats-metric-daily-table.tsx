"use client";

import { useState } from "react";
import { formatStatsDay, formatStatsInteger, statsSourceTokenRate, type StatsRange, type StatsTotals } from "./stats-view";

export const MAX_STATS_DAILY_TABLE_DAYS = 31;

/** Closed disclosures allocate no table rows; an open table keeps one bounded
 * page. Exact full-range values remain available through the numeric export. */
export function StatsMetricDailyTable({ range, totals, basis }: Readonly<{
  range: StatsRange; totals: ReadonlyMap<number, StatsTotals>; basis: string;
}>) {
  const [expanded, setExpanded] = useState(false), [selectedPage, setPage] = useState(0);
  const pages = Math.ceil(range.dayCount / MAX_STATS_DAILY_TABLE_DAYS), page = Math.min(selectedPage, pages - 1);
  const first = page * MAX_STATS_DAILY_TABLE_DAYS, count = Math.min(MAX_STATS_DAILY_TABLE_DAYS, range.dayCount - first);
  return <details className="usage-stats__details" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>Daily data <span>{range.dayCount} UTC days · exact values</span></summary>
    <p className="usage-stats__hint">No records does not prove inactivity. The numeric CSV includes the full selected range.</p>
    {expanded && <>
      <div className="usage-stats__table-scroll" role="region" aria-label="Daily numeric usage, scroll horizontally for all columns" tabIndex={0}>
        <table><caption>{basis} tokens, {formatStatsDay(range.firstUtcDay + first)}–{formatStatsDay(range.firstUtcDay + first + count - 1)}.
          {pages > 1 && ` Days ${first + 1}–${first + count} of ${range.dayCount}.`}</caption>
          <thead><tr><th scope="col">UTC day</th><th scope="col">Tokens</th><th scope="col">Output + reasoning</th><th scope="col">Source tok/s</th><th scope="col">Records</th></tr></thead>
          <tbody>{Array.from({ length: count }, (_, index) => {
            const day = range.firstUtcDay + first + index, total = totals.get(day), rate = total ? statsSourceTokenRate(total) : null;
            return <tr key={day}><th scope="row">{formatStatsDay(day)}</th><td>{!total ? "No records" : total.tokenRecords === 0 ? "Unavailable" : formatStatsInteger(total.tokens)}</td>
              <td>{!total || total.tokenRecords === 0 ? "Unknown" : formatStatsInteger(total.output + total.reasoning)}</td><td>{rate === null ? "Unknown" : formatStatsInteger(rate)}</td><td>{formatStatsInteger(total?.records ?? 0)}</td></tr>;
          })}</tbody>
        </table>
      </div>
      {pages > 1 && <nav className="usage-metrics__pagination" aria-label="Daily data pages">
        <button className="usage-stats__text-button" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous days</button>
        <span role="status">Page {page + 1} of {pages}</span>
        <button className="usage-stats__text-button" type="button" disabled={page === pages - 1} onClick={() => setPage(page + 1)}>Next days</button>
      </nav>}
    </>}
  </details>;
}
