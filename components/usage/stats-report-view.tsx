"use client";

import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { UsageStatsReport } from "@/lib/usage/stats-contract";
import { STATS_CLIENTS } from "@/lib/usage/stats-registry";
import {
  ALL_STATS, UNKNOWN_STATS, bucketStatsRows, filterStatsRows, filterStatsSnapshots, formatStatsCompact, formatStatsDay, formatStatsInteger,
  formatStatsMoney, groupStatsRows, previousStatsPeriod, statsDateInput, statsInputRange, statsLabel, statsRatio,
  statsRowsCsv, sumStatsRows, type StatsFilters, type StatsGrouping, type StatsRange, type StatsSelection, type StatsSort,
} from "./stats-view";

const stamp = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const sourceStates = { observed: "Observed", empty: "No observations", not_found: "Not found", incomplete: "Incomplete", unavailable: "Unavailable" };
const componentNames = { input: "Input", cacheRead: "Cache read", cacheWrite: "Cache write", output: "Output", reasoning: "Reasoning" };
type Scope = "local" | "example" | "account";

function ExactValue({ value, className }: Readonly<{ value: bigint; className?: string }>) {
  return <span className={className}><span aria-hidden="true">{formatStatsCompact(value)}</span><span className="usage-stats__sr">{formatStatsInteger(value)}</span></span>;
}

function saveCsv(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "aicharts-numeric-usage.csv"; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function StatsReportView({ report, scope, todayUtcDay, onRangeRequest, onRefresh, initialSelection, busy = false }: Readonly<{
  report: UsageStatsReport; scope: Scope; todayUtcDay: number;
  onRangeRequest?: (range: StatsRange, selection: StatsSelection) => void;
  onRefresh?: (filters: StatsFilters) => void; initialSelection?: StatsSelection; busy?: boolean;
}>) {
  const end = report.firstUtcDay + report.dayCount - 1;
  const initialRange = scope === "account" ? { firstUtcDay: report.firstUtcDay, dayCount: report.dayCount }
    : { firstUtcDay: Math.max(report.firstUtcDay, end - 29), dayCount: Math.min(30, report.dayCount) };
  const [filters, setFilters] = useState<StatsFilters>({ ...initialRange, client: ALL_STATS, provider: ALL_STATS, model: ALL_STATS, basis: "reported", ...initialSelection });
  const [first, setFirst] = useState(statsDateInput(initialRange.firstUtcDay));
  const [last, setLast] = useState(statsDateInput(end));
  const [custom, setCustom] = useState(![1, 7, 30, 90].some(days => {
    const initialAnchor = scope === "account" ? todayUtcDay : end;
    return initialRange.firstUtcDay === Math.max(0, initialAnchor - days + 1) && initialRange.dayCount === Math.min(days, initialAnchor + 1);
  }));
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<StatsGrouping>("client");
  const [sort, setSort] = useState<{ key: StatsSort; ascending: boolean }>({ key: "tokens", ascending: false });
  const [selectedDay, setSelectedDay] = useState<StatsRange | null>(null);
  const [chartFocus, setChartFocus] = useState(0);
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [exportError, setExportError] = useState(false);
  const plot = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => filterStatsRows(report, filters), [report, filters]);
  const totals = useMemo(() => sumStatsRows(rows), [rows]);
  const snapshotRows = useMemo(() => filterStatsSnapshots(report, filters), [report, filters]);
  const snapshotTotals = useMemo(() => sumStatsRows(snapshotRows), [snapshotRows]);
  const snapshotOnly = filters.client === "warp";
  const snapshotDay = snapshotRows[0]?.utcDay;
  const snapshotStamp = report.sources.find(source => source.client === "warp")?.latestAtMs;

  const groups = useMemo(() => groupStatsRows(rows, grouping, sort.key, sort.ascending), [rows, grouping, sort]);
  const buckets = useMemo(() => bucketStatsRows(rows, filters), [rows, filters]);
  const dailyTotals = useMemo(() => {
    const grouped = new Map<number, typeof rows>();
    for (const row of rows) { const dayRows = grouped.get(row.utcDay) ?? []; dayRows.push(row); grouped.set(row.utcDay, dayRows); }
    return new Map([...grouped].map(([day, members]) => [day, sumStatsRows(members)]));
  }, [rows]);
  const prior = useMemo(() => previousStatsPeriod(report, filters), [report, filters]);
  const clients = report.sources.map(source => source.client);
  const clientRows = report.rows.filter(row => filters.client === ALL_STATS || row.client === filters.client);
  const providers = [...new Set(clientRows.map(row => row.provider ?? UNKNOWN_STATS))].sort();
  const modelRows = clientRows.filter(row => filters.provider === ALL_STATS || (row.provider ?? UNKNOWN_STATS) === filters.provider);
  const models = [...new Set(modelRows.map(row => row.model ?? UNKNOWN_STATS))].sort();
  const hasEstimated = report.rows.some(row => row.tokenBasis === "estimated");
  const label = filters.basis === "reported" ? "Reported" : "Estimated";
  const visibleGroups = showAllGroups ? groups : groups.slice(0, 12);
  const max = buckets.reduce((value, bucket) => bucket.totals.tokens > value ? bucket.totals.tokens : value, 0n);
  const detailRows = selectedDay ? rows.filter(row => row.utcDay >= selectedDay.firstUtcDay && row.utcDay < selectedDay.firstUtcDay + selectedDay.dayCount) : [];
  const detailTotals = selectedDay ? sumStatsRows(detailRows) : null;
  const sourceList = report.sources.filter(source => filters.client === ALL_STATS || source.client === filters.client);
  const sourceByClient = new Map(report.sources.map(source => [source.client, source]));
  const periodEnd = filters.firstUtcDay + filters.dayCount - 1;
  const rangeText = `${formatStatsDay(filters.firstUtcDay)}–${formatStatsDay(periodEnd)}`;
  const anchor = scope === "account" ? todayUtcDay : end;
  const presetRange = (days: number) => ({ firstUtcDay: Math.max(0, anchor - days + 1), dayCount: Math.min(days, anchor + 1) });
  const periodValue = [1, 7, 30, 90].find(days => {
    const range = presetRange(days);
    return range.firstUtcDay === filters.firstUtcDay && range.dayCount === filters.dayCount;
  });
  const activeFilters = Number(filters.client !== ALL_STATS) + Number(filters.provider !== ALL_STATS)
    + Number(filters.model !== ALL_STATS) + Number(filters.basis !== "reported");
  const inputSide = totals.input + totals.cacheRead;
  const cacheShare = totals.tokenRecords > 0 && inputSide > 0n ? statsRatio(totals.cacheRead, inputSide) : null;
  const outputSpeed = totals.timedRecords > 0 && totals.durationMs !== null && totals.durationMs > 0n
    ? totals.timedTokens * 1000n / totals.durationMs : null;
  const costDelta = totals.reportedCost !== null && totals.estimatedCost !== null
    ? totals.estimatedCost - totals.reportedCost : null;

  const changeFilter = (patch: Partial<StatsFilters>) => {
    setFilters(previous => ({ ...previous, ...patch })); setSelectedDay(null); setShowAllGroups(false);
  };
  const setRange = (range: StatsRange) => {
    if (onRangeRequest && (range.firstUtcDay < report.firstUtcDay || range.firstUtcDay + range.dayCount > report.firstUtcDay + report.dayCount)) {
      setRangeError(null); onRangeRequest(range, { client: filters.client, provider: filters.provider, model: filters.model, basis: filters.basis }); return;
    }
    if (range.firstUtcDay < report.firstUtcDay || range.firstUtcDay + range.dayCount > report.firstUtcDay + report.dayCount) {
      setRangeError("Choose dates within this report’s declared window."); return;
    }
    setRangeError(null); setFirst(statsDateInput(range.firstUtcDay)); setLast(statsDateInput(range.firstUtcDay + range.dayCount - 1));
    setChartFocus(0); changeFilter(range);
  };
  const submitDates = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const range = statsInputRange(first, last);
    if (!range) { setRangeError("Choose 1–366 valid UTC dates, with the start on or before the end."); return; }
    setRange(range);
  };
  const sortBy = (key: StatsSort) => setSort(previous => ({ key, ascending: previous.key === key ? !previous.ascending : key === "name" }));
  const drillInto = (key: string) => {
    changeFilter({ [grouping]: key, ...(grouping !== "model" ? { model: ALL_STATS } : {}) });
    if (grouping !== "model") setGrouping("model");
  };
  const chartKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowRight" ? Math.min(buckets.length - 1, index + 1) : event.key === "ArrowLeft" ? Math.max(0, index - 1)
      : event.key === "Home" ? 0 : event.key === "End" ? buckets.length - 1 : null;
    if (event.key === "Escape") setSelectedDay(null);
    if (next !== null) {
      event.preventDefault(); setChartFocus(next);
      plot.current?.querySelector<HTMLButtonElement>(`[data-bucket="${next}"]`)?.focus();
    }
  };
  const exportRows = () => {
    try { saveCsv(statsRowsCsv([...rows, ...snapshotRows])); setExportError(false); } catch { setExportError(true); }
  };
  return <div className="usage-stats" aria-busy={busy}>
    <div className="usage-stats__toolbar">
      <div className="usage-stats__mobile-controls">
        <label>Period<select aria-label="Period" value={custom ? "custom" : String(periodValue ?? "custom")} disabled={busy} onChange={event => {
          const choice = event.target.value;
          setCustom(choice === "custom");
          if (choice !== "custom") setRange(presetRange(Number(choice)));
        }}>
          {[1, 7, 30, 90].map(days => <option key={days} value={days} disabled={!onRangeRequest && presetRange(days).firstUtcDay < report.firstUtcDay}>
            {days === 1 ? (scope === "account" ? "Today" : "Latest day") : `${days} days`}
          </option>)}
          <option value="custom">Custom dates</option>
        </select></label>
        <button type="button" className="usage-stats__filter-toggle" aria-expanded={filtersExpanded} aria-controls="stats-filters" onClick={() => setFiltersExpanded(!filtersExpanded)}>
          Filters{activeFilters > 0 ? ` · ${activeFilters} active` : ""}
        </button>
      </div>
      <div className="usage-stats__presets usage-stats__desktop-periods" role="group" aria-label="Usage periods in UTC">
        {[1, 7, 30, 90].map(days => {
          const { firstUtcDay, dayCount } = presetRange(days);
          const available = Boolean(onRangeRequest) || firstUtcDay >= report.firstUtcDay;
          return <button type="button" key={days} disabled={!available || busy} aria-pressed={filters.firstUtcDay === firstUtcDay && filters.dayCount === dayCount}
            onClick={() => { setCustom(false); setRange({ firstUtcDay, dayCount }); }}>{days === 1 ? (scope === "account" ? "Today" : "Latest day") : `${days} days`}</button>;
        })}
        <button type="button" aria-expanded={custom} aria-controls="stats-custom-range" onClick={() => setCustom(!custom)}>Custom</button>
      </div>
      <div id="stats-filters" className="usage-stats__filters" data-expanded={filtersExpanded}>
        <label>Client<select aria-label="Client" value={filters.client} onChange={event => changeFilter({ client: event.target.value, provider: ALL_STATS, model: ALL_STATS })}>
          <option value={ALL_STATS}>All clients</option>{clients.map(client => <option key={client} value={client}>{statsLabel(client, "client")}</option>)}
          {filters.client !== ALL_STATS && !clients.includes(filters.client) && <option value={filters.client}>{statsLabel(filters.client, "client")} · no records</option>}
        </select></label>
        <label>Provider<select aria-label="Provider" value={filters.provider} onChange={event => changeFilter({ provider: event.target.value, model: ALL_STATS })}>
          <option value={ALL_STATS}>All providers</option>{providers.map(provider => <option key={provider} value={provider}>{statsLabel(provider)}</option>)}
          {filters.provider !== ALL_STATS && !providers.includes(filters.provider) && <option value={filters.provider}>{statsLabel(filters.provider)} · no records</option>}
        </select></label>
        <label>Model<select aria-label="Model" value={filters.model} onChange={event => changeFilter({ model: event.target.value })}>
          <option value={ALL_STATS}>All models</option>{models.map(model => <option key={model} value={model}>{statsLabel(model)}</option>)}
          {filters.model !== ALL_STATS && !models.includes(filters.model) && <option value={filters.model}>{statsLabel(filters.model)} · no records</option>}
        </select></label>
        {(hasEstimated || filters.basis === "estimated") && <label>Token basis<select aria-label="Token basis" value={filters.basis} onChange={event => changeFilter({ basis: event.target.value as "reported" | "estimated" })}>
          <option value="reported">Reported</option><option value="estimated">Estimated</option>
        </select></label>}
        {onRefresh && <button type="button" className="usage-stats__text-button" disabled={busy} onClick={() => onRefresh(filters)}>{busy ? "Refreshing…" : "Refresh"}</button>}
      </div>
    </div>
    {custom && <form id="stats-custom-range" className="usage-stats__custom" onSubmit={submitDates}>
      <label>From<input type="date" required min={scope === "account" ? "1970-01-01" : statsDateInput(report.firstUtcDay)} max="9999-12-31" value={first} onChange={event => setFirst(event.target.value)} /></label>
      <label>Through<input type="date" required min={scope === "account" ? "1970-01-01" : statsDateInput(report.firstUtcDay)} max={scope === "account" ? "9999-12-31" : statsDateInput(end)} value={last} onChange={event => setLast(event.target.value)} /></label>
      <button className="usage-button usage-button--primary" type="submit" disabled={busy}>Apply dates</button><span>Up to 366 days · UTC</span>
    </form>}
    {rangeError && <p role="alert" className="usage-stats__notice">{rangeError}</p>}
    <div className="usage-stats__overview">
    <div className="usage-stats__range"><span>{rangeText} · UTC</span>
      {(filters.client !== ALL_STATS || filters.model !== ALL_STATS || filters.provider !== ALL_STATS) && <button type="button" onClick={() => changeFilter({ client: ALL_STATS, provider: ALL_STATS, model: ALL_STATS })}>Clear filters{filters.provider !== ALL_STATS ? ` · ${statsLabel(filters.provider)}` : ""}</button>}
    </div>
    <div className="usage-stats__summary" aria-label="Totals for the selected dates and filters">
      <div className="usage-stats__lead"><h2>{label} tokens</h2>{totals.tokenRecords > 0 ? <><ExactValue className="usage-stats__total" value={totals.tokens} /><span className="usage-stats__exact">{formatStatsInteger(totals.tokens)} exact</span></> : <><span className="usage-stats__total">—</span><span className="usage-stats__exact">No token observations</span></>}<a className="usage-stats__mobile-coverage" href="#stats-coverage">Partial source coverage</a></div>
      <dl>
        <div><dt>Output + reasoning</dt><dd>{totals.tokenRecords === 0 ? "Unknown" : formatStatsInteger(totals.output + totals.reasoning)}</dd></div>
        <div><dt>Input</dt><dd>{totals.tokenRecords === 0 ? "Unknown" : formatStatsInteger(totals.input)}</dd></div>
        <div><dt>Cache reads</dt><dd>{cacheShare === null ? "Unknown" : <>{cacheShare}% <span>{formatStatsInteger(totals.cacheRead)} tokens</span></>}</dd></div>
        <div><dt>Usage records</dt><dd>{snapshotOnly ? "Unavailable" : formatStatsInteger(totals.records)}</dd></div>
        <div><dt>Days with records</dt><dd>{snapshotOnly ? "Unavailable" : <>{totals.activeDays} <span>of {filters.dayCount}</span></>}</dd></div>
        <div><dt>Tokens per second</dt><dd>{outputSpeed === null ? "Untimed" : <>{formatStatsInteger(outputSpeed)} <span>across {formatStatsInteger(totals.timedRecords)} timed records</span></>}</dd></div>
      </dl>
      <div className="usage-stats__cost"><h2>Cost</h2><strong>{formatStatsMoney(totals.reportedCost)}</strong>
        <span>{totals.reportedCost === null ? "No cost supplied by these records" : `reported by sources · ${formatStatsInteger(totals.reportedCostRecords)} of ${formatStatsInteger(totals.records)} records · USD`}</span>
        {totals.estimatedCost !== null && <p>Public-API estimate: <strong>{formatStatsMoney(totals.estimatedCost)}</strong><br />{formatStatsInteger(totals.estimatedCostRecords)} of {formatStatsInteger(totals.records)} records · dated retail rates, not a bill</p>}
        {costDelta !== null && costDelta !== 0n && <p>Estimate {costDelta > 0n ? "exceeds" : "is under"} reported by <strong>{formatStatsMoney(costDelta < 0n ? -costDelta : costDelta)}</strong> — flat subscriptions, cache discounts and unpriced records explain most gaps.</p>}
      </div>
    </div>
    <p className="usage-stats__qualification">{scope === "example" ? "Synthetic example. " : ""}Partial coverage. {hasEstimated && filters.basis === "reported" ? "Estimated tokens are separate. " : ""}<a href="#stats-coverage">See source coverage</a>
      {totals.tokenRecords < totals.records && <span> · Tokens unavailable for {formatStatsInteger(totals.records - totals.tokenRecords)} records.</span>}</p>
    <p className="usage-stats__sr" role="status">Showing {formatStatsInteger(totals.records)} records for {rangeText}, {filters.basis} token basis.</p>

    <section className="usage-stats__trend" aria-labelledby="stats-trend-title">
      <div className="usage-stats__section-heading"><h2 id="stats-trend-title">{filters.dayCount > 62 ? "Weekly" : "Daily"} usage</h2><span>{label} tokens · select a {filters.dayCount > 62 ? "week" : "day"} to inspect</span></div>
      <div className="usage-stats__scale" aria-hidden="true"><span>{formatStatsCompact(max)}</span><span>0</span></div>
      <div className="usage-stats__plot" ref={plot} role="group" aria-label={`${label} tokens by ${filters.dayCount > 62 ? "week" : "day"}. Use left and right arrow keys to move; press Enter to inspect.`}>
        {buckets.map((bucket, index) => <button type="button" key={bucket.firstUtcDay} data-bucket={index} tabIndex={chartFocus === index ? 0 : -1}
          className={bucket.totals.tokenRecords === 0 ? "is-unobserved" : undefined} aria-pressed={selectedDay?.firstUtcDay === bucket.firstUtcDay}
          aria-label={`${formatStatsDay(bucket.firstUtcDay)}${bucket.dayCount > 1 ? ` through ${formatStatsDay(bucket.firstUtcDay + bucket.dayCount - 1)}` : ""}: ${bucket.totals.tokenRecords > 0 ? `${formatStatsInteger(bucket.totals.tokens)} ${filters.basis} tokens` : "token usage unknown"}, ${bucket.totals.records} records`}
          onFocus={() => setChartFocus(index)} onKeyDown={event => chartKey(event, index)}
          onClick={() => setSelectedDay(selectedDay?.firstUtcDay === bucket.firstUtcDay ? null : { firstUtcDay: bucket.firstUtcDay, dayCount: bucket.dayCount })}>
          <span style={{ height: `${statsRatio(bucket.totals.tokens, max)}%` }} aria-hidden="true" />
        </button>)}
      </div>
      <div className="usage-stats__axis" aria-hidden="true"><span>{formatStatsDay(filters.firstUtcDay)}</span><span>{formatStatsDay(periodEnd)}</span></div>
      <p className="usage-stats__hint">Dots indicate no token observations; they do not establish no activity. Exact values are available by selecting a bar or opening daily data.</p>
      {prior && prior.tokenRecords > 0 && <p className="usage-stats__hint">Previous {filters.dayCount} days: {formatStatsInteger(prior.tokens)} {filters.basis} tokens; coverage may differ.</p>}
      {selectedDay && detailTotals && <div className="usage-stats__day-detail" role="region" aria-label="Selected period detail">
        <div><h3>{formatStatsDay(selectedDay.firstUtcDay)}{selectedDay.dayCount > 1 ? `–${formatStatsDay(selectedDay.firstUtcDay + selectedDay.dayCount - 1)}` : ""}</h3>
          <p>{detailTotals.tokenRecords > 0 ? `${formatStatsInteger(detailTotals.tokens)} ${filters.basis} tokens` : "Token usage unknown"} · {formatStatsInteger(detailTotals.records)} records</p></div>
        <button type="button" className="usage-stats__text-button" onClick={() => setSelectedDay(null)}>Close detail</button>
        <ul>{groupStatsRows(detailRows, "model", "tokens").map(group => <li key={group.key}><span>{group.name}</span><strong>{group.totals.tokenRecords > 0 ? formatStatsInteger(group.totals.tokens) : "Unknown"}</strong></li>)}</ul>
      </div>}
    </section>
    </div>

    {snapshotDay !== undefined && <section className="usage-stats__snapshots" aria-labelledby="stats-snapshots-title">
      <div className="usage-stats__section-heading"><h2 id="stats-snapshots-title">Warp billing snapshot</h2><span>Separate from selected UTC dates</span></div>
      <dl>
        <div><dt>Reported billing spend</dt><dd>{formatStatsMoney(snapshotTotals.reportedCost)}</dd></div>
        <div><dt>Source records</dt><dd>{formatStatsInteger(snapshotTotals.records)}</dd></div>
        <div><dt>Synchronized (UTC)</dt><dd>{snapshotStamp != null && Math.floor(snapshotStamp / 86_400_000) === snapshotDay ? stamp.format(snapshotStamp) : formatStatsDay(snapshotDay)}</dd></div>
      </dl>
      <p>This report’s latest Warp snapshot covers its billing or refresh period. It is excluded from the daily totals, trend, and cost above. Token counts and billing period boundaries are unavailable.</p>
      <p>Synchronization dates are not request timestamps. CSV exports retain this snapshot with the time basis <code>refresh_snapshot</code>.</p>
    </section>}
    <section className="usage-stats__breakdown" aria-labelledby="stats-breakdown-title">
      <div className="usage-stats__section-heading"><h2 id="stats-breakdown-title">Where the tokens went</h2><button type="button" className="usage-stats__text-button" onClick={exportRows} disabled={rows.length === 0 && snapshotRows.length === 0}>Download numeric CSV</button></div>
      {exportError && <p role="alert">The download could not be prepared. Try again in this browser.</p>}
      <div className="usage-stats__presets" role="group" aria-label="Group usage by">
        {(["client", "provider", "model"] as const).map(by => <button type="button" key={by} aria-pressed={grouping === by} onClick={() => { setGrouping(by); setShowAllGroups(false); }}>{by === "client" ? "Clients" : by === "provider" ? "Providers" : "Models"}</button>)}
      </div>
      {groups.length === 0 ? <div className="usage-stats__notice"><h3>{snapshotOnly ? "No dated usage records" : `No matching ${filters.basis} records`}</h3><p>{snapshotOnly ? "Warp supplies a billing snapshot instead of dated usage records." : "Try a different period, client, provider, model, or token basis. Missing observations stay unknown."}</p></div> : <>
        <div className="usage-stats__table-scroll" role="region" aria-label="Usage breakdown, scroll horizontally for all columns" tabIndex={0}>
          <table><caption>{label} usage by {grouping}, {rangeText}. Select a name to filter.</caption>
            <thead><tr>{([ ["name", grouping === "client" ? "Client" : grouping === "provider" ? "Provider" : "Model"], ["tokens", `${label} tokens`], ["output", "Output + reasoning"], ["records", "Records"]] as const).map(([key, name]) => <th scope="col" key={key} aria-sort={sort.key === key ? (sort.ascending ? "ascending" : "descending") : "none"}>
              <button type="button" onClick={() => sortBy(key)}>{name}{sort.key === key && <span className={`usage-stats__sort ${sort.ascending ? "usage-stats__sort--ascending" : ""}`} aria-hidden="true" />}</button>
            </th>)}<th scope="col">Share</th><th scope="col">Tok/s</th><th scope="col">Reported cost</th></tr></thead>
            <tbody>{visibleGroups.map(group => <tr key={group.key}><th scope="row"><button className="usage-stats__row-link" type="button" onClick={() => drillInto(group.key)}>{group.name}</button><span className="usage-stats__share-bar" aria-hidden="true"><span style={{ width: `${statsRatio(group.totals.tokens, totals.tokens)}%` }} /></span></th>
              <td>{group.totals.tokenRecords > 0 ? formatStatsInteger(group.totals.tokens) : "Unavailable"}</td><td>{group.totals.tokenRecords > 0 ? formatStatsInteger(group.totals.output + group.totals.reasoning) : "Unknown"}</td><td>{formatStatsInteger(group.totals.records)}</td><td>{group.totals.tokenRecords > 0 ? `${statsRatio(group.totals.tokens, totals.tokens).toFixed(1)}%` : "—"}</td>
              <td>{group.totals.timedRecords > 0 && group.totals.durationMs !== null && group.totals.durationMs > 0n ? formatStatsInteger(group.totals.timedTokens * 1000n / group.totals.durationMs) : "—"}</td>
              <td>{formatStatsMoney(group.totals.reportedCost)}{group.totals.reportedCost !== null && <small>{group.totals.reportedCostRecords}/{group.totals.records} records</small>}</td></tr>)}</tbody>
          </table>
        </div>
        {groups.length > 12 && <button type="button" className="usage-stats__text-button" onClick={() => setShowAllGroups(!showAllGroups)}>{showAllGroups ? "Show first 12" : `Show all ${groups.length}`}</button>}
      </>}
      <p className="usage-stats__hint">Clients are the apps you use; providers supply their models. Unknown attribution remains in the total. Usage records are not human prompts.</p>
    </section>

    <section className="usage-stats__components" aria-labelledby="stats-components-title">
      <div><h2 id="stats-components-title">Token composition</h2><p>{totals.partialRecords > 0 ? `${formatStatsInteger(totals.partialRecords)} records have a partial breakdown. A zero bucket may be unreported.` : "The available token buckets are separate; reasoning is not counted twice."}</p></div>
      <dl>{(Object.keys(componentNames) as Array<keyof typeof componentNames>).map(key => <div key={key}><dt>{componentNames[key]}</dt><dd>{totals.tokenRecords > 0 ? formatStatsInteger(totals[key]) : "Unavailable"}</dd></div>)}</dl>
    </section>
    <details className="usage-stats__details"><summary>Recorded request duration <span>{formatStatsInteger(totals.timedRecords)} of {formatStatsInteger(totals.records)} records</span></summary>
      <div className="usage-stats__timing"><dl>
        <div><dt>Sum of source durations</dt><dd>{totals.durationMs === null ? "Unavailable" : `${formatStatsInteger(totals.durationMs)} ms`}</dd></div>
        <div><dt>Records with duration</dt><dd>{formatStatsInteger(totals.timedRecords)}</dd></div>
        <div><dt>Tokens in timed records</dt><dd>{totals.timedRecords === 0 ? "Unavailable" : formatStatsInteger(totals.timedTokens)}</dd></div>
      </dl><p>Durations are supplied by source records and can overlap. Their sum is not time spent working, GPU time, or a measure of inference speed. Missing durations remain unknown.</p></div>
    </details>
    <details className="usage-stats__details"><summary>Daily data <span>{filters.dayCount} UTC days · exact values</span></summary>
      <div className="usage-stats__table-scroll" role="region" aria-label="Daily numeric usage, scroll horizontally for all columns" tabIndex={0}>
        <table><caption>{label} tokens, {rangeText}. No records does not prove inactivity.</caption><thead><tr><th scope="col">UTC day</th><th scope="col">Tokens</th><th scope="col">Output + reasoning</th><th scope="col">Tok/s</th><th scope="col">Records</th></tr></thead>
          <tbody>{Array.from({ length: filters.dayCount }, (_, index) => {
            const day = filters.firstUtcDay + index, total = dailyTotals.get(day);
            return <tr key={day}><th scope="row">{formatStatsDay(day)}</th><td>{!total ? "No records" : total.tokenRecords === 0 ? "Unavailable" : formatStatsInteger(total.tokens)}</td><td>{!total || total.tokenRecords === 0 ? "Unknown" : formatStatsInteger(total.output + total.reasoning)}</td><td>{total && total.timedRecords > 0 && total.durationMs !== null && total.durationMs > 0n ? formatStatsInteger(total.timedTokens * 1000n / total.durationMs) : "—"}</td><td>{formatStatsInteger(total?.records ?? 0)}</td></tr>;
          })}</tbody></table>
      </div>
    </details>

    <section id="stats-coverage" className="usage-stats__coverage" aria-labelledby="stats-coverage-title">
      <div className="usage-stats__section-heading"><h2 id="stats-coverage-title">Source coverage & freshness</h2><span>{scope === "account" ? "Synced account" : scope === "example" ? "Example data" : "Local report · stays in this browser"}</span></div>
      <p>Report generated {stamp.format(report.generatedAtMs)} UTC. {report.updatedAtMs === null ? "No remote acceptance timestamp in this report." : `Last recorded update ${stamp.format(report.updatedAtMs)} UTC.`} These timestamps do not prove a scheduled collector is healthy.</p>
      <div className="usage-stats__table-scroll" role="region" aria-label="Source coverage, scroll horizontally for all columns" tabIndex={0}>
        <table><caption>Collection status for the report’s declared window, {formatStatsDay(report.firstUtcDay)}–{formatStatsDay(end)}. Filters do not change collection status.</caption><thead><tr><th scope="col">Client</th><th scope="col">Collection</th><th scope="col">Token basis</th><th scope="col">Records</th><th scope="col">Warnings</th><th scope="col">Latest source timestamp (UTC)</th></tr></thead>
          <tbody>{sourceList.map(source => <tr key={source.client}><th scope="row">{statsLabel(source.client, "client")}</th><td>{sourceStates[source.status]}</td><td>{source.tokenBasis}</td><td>{formatStatsInteger(source.records)}</td><td>{formatStatsInteger(source.warnings)}</td><td>{source.latestAtMs === null ? "Unknown" : stamp.format(source.latestAtMs)}</td></tr>)}</tbody></table>
      </div>
      <details className="usage-stats__details usage-stats__client-coverage">
        <summary>Supported clients <span>{report.sources.length} of {STATS_CLIENTS.length} included in this report</span></summary>
        <p>A supported client needs a readable local source or a configured refresh. “Not included” means this report supplies no collection status for that client; it does not mean zero usage.</p>
        <div className="usage-stats__table-scroll" role="region" aria-label="Supported client coverage, scroll horizontally for all columns" tabIndex={0}>
          <table><caption>All supported clients, regardless of chart filters.</caption><thead><tr><th scope="col">Client</th><th scope="col">In this report</th></tr></thead>
            <tbody>{STATS_CLIENTS.map(client => {
              const source = sourceByClient.get(client.id);
              return <tr key={client.id}><th scope="row">{client.name}</th><td>{source ? sourceStates[source.status] : "Not included"}</td></tr>;
            })}</tbody>
          </table>
        </div>
        <p>Detailed reports support this full client list. The older daily overview and session imports cover Codex, Claude Code, and Devin. Account synchronization requires an enrolled collector; public leaderboard visibility requires separate consent.</p>
      </details>
      {sourceList.some(source => source.client === "warp" && source.records > 0) && <p>Warp dates identify when usage was synchronized, not when each request occurred. Warp token counts are unavailable; billing snapshots are shown separately from dated usage.</p>}
      <p>Coverage depends on recognized local source formats. No observations does not prove that a source had no activity. Reported cost is supplied by source records and may cover only part of the usage. Retail estimates are separate and are not subscription charges or a provider bill.</p>
      <p>The current local collector uses a <a href="https://github.com/hraness/aicharts/blob/main/data/usage-prices.json">models.dev pricing snapshot dated 2026-09-19</a>. Imported or source-provided estimates may use other prices or dates. Neither token volume nor request duration measures productivity.</p>
    </section>
  </div>;
}
