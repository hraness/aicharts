"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { UsageStatsReport } from "@/lib/usage/stats-contract";
import { metricRecommendedDimension, type MetricDimension, type MetricQuery, type MetricReportMetadata } from "@/lib/usage/metric-explorer";
import type { MetricReportSession } from "@/lib/usage/metric-explorer-session";
import { STATS_CLIENTS } from "@/lib/usage/stats-registry";
import { createBrandedChartPng, downloadChartPng } from "@/components/chart-export";
import { exportCurrentStatsImage } from "./stats-export";
import { useStatsMetricQuery, useStatsMetricDetail } from "./stats-metric-query";
import type { MetricPresentation } from "./stats-metric-presentation";
import { StatsMetricExplorer } from "./stats-metric-explorer";
import type { RichExplorerSource } from "./rich-metric-explorer";
import { savedViewFromSelection, savedViewRange, savedViewSearch, type SavedView } from "@/lib/usage/saved-views";
import { StatsMetricDailyTable } from "./stats-metric-daily-table";
import {
  ALL_STATS, formatStatsCompact, formatStatsDay, formatStatsInteger,
  formatStatsMoney, statsBucketValue, statsCacheReadShare, statsDateInput, statsInputRange, statsLabel, statsRatio,
  statsSourceTokenRate, statsSummaryText, type StatsFilters, type StatsGrouping, type StatsMetric, type StatsRange,
  type StatsSelection, type StatsSort,
} from "./stats-view";

const stamp = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const sourceStates = { observed: "Observed", empty: "No observations", not_found: "Not found", incomplete: "Incomplete", unavailable: "Unavailable" };
const componentNames = { input: "Input", cacheRead: "Cache read", cacheWrite: "Cache write", output: "Output", reasoning: "Reasoning" };
const metricNames: Record<StatsMetric, string> = { tokens: "Tokens", records: "Records", speed: "Source tok/s" };
const splitNames: Record<StatsGrouping | "none", string> = { none: "Total", client: "Clients", provider: "Providers", model: "Models" };
const CALENDAR_CELL = 11, CALENDAR_GAP = 3, CALENDAR_PITCH = CALENDAR_CELL + CALENDAR_GAP, CALENDAR_GUTTER = 28, CALENDAR_HEADER = 17;
const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Scope = "local" | "example" | "account";

function ExactValue({ value, className }: Readonly<{ value: bigint; className?: string }>) {
  return <span className={className}><span aria-hidden="true">{formatStatsCompact(value)}</span><span className="usage-stats__sr">{formatStatsInteger(value)}</span></span>;
}

function saveCsv(text: string | Blob) {
  const url = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "aicharts-numeric-usage.csv"; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function StatsReportView({ report, session, scope, todayUtcDay, onRangeRequest, onRefresh, initialSelection, captureExport, busy = false, rich, savedView = null, onSavedView }: Readonly<{
  report: UsageStatsReport | MetricReportMetadata; session?: MetricReportSession; scope: Scope; todayUtcDay: number; rich?: RichExplorerSource;
  onRangeRequest?: (range: StatsRange, selection: StatsSelection) => void;
  onRefresh?: (filters: StatsFilters) => void; initialSelection?: StatsSelection; captureExport?: () => (() => boolean); busy?: boolean;
  /** A validated saved view (D5) seeds the initial selection; every later change is reported back so the link can follow. */
  savedView?: SavedView | null; onSavedView?: (view: SavedView) => void;
}>) {
  const end = report.firstUtcDay + report.dayCount - 1;
  const defaultRange = scope === "account" ? { firstUtcDay: report.firstUtcDay, dayCount: report.dayCount }
    : { firstUtcDay: Math.max(report.firstUtcDay, end - 29), dayCount: Math.min(30, report.dayCount) };
  // A saved range outside the loaded report is refused, not clamped; the other saved fields still apply.
  const initialRange = savedViewRange(savedView?.range ?? null, scope === "account" ? todayUtcDay : end, { firstUtcDay: report.firstUtcDay, dayCount: report.dayCount }) ?? defaultRange;
  const [requestedFilters, setFilters] = useState<StatsFilters>({ ...initialRange, client: savedView?.client ?? ALL_STATS, provider: savedView?.provider ?? ALL_STATS, model: savedView?.model ?? ALL_STATS, basis: savedView?.basis ?? "reported", ...initialSelection });
  const [first, setFirst] = useState(statsDateInput(initialRange.firstUtcDay));
  const [last, setLast] = useState(statsDateInput(end));
  const [custom, setCustom] = useState(![1, 7, 30, 90].some(days => {
    const initialAnchor = scope === "account" ? todayUtcDay : end;
    return initialRange.firstUtcDay === Math.max(0, initialAnchor - days + 1) && initialRange.dayCount === Math.min(days, initialAnchor + 1);
  }));
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<StatsGrouping>(savedView?.grouping ?? "client");
  const [secondGrouping, setSecondGrouping] = useState<MetricDimension | null>(savedView?.secondGrouping ?? null);
  const [explorerMetric, setExplorerMetric] = useState(savedView?.metric ?? "accounted-tokens");
  const [costKind, setCostKind] = useState<"reported" | "estimated">(savedView?.costKind ?? "reported");
  const [rankByMetric, setRankByMetric] = useState(false);
  const [sort, setSort] = useState<{ key: StatsSort; ascending: boolean }>({ key: "tokens", ascending: false });
  const [selectedDay, setSelectedDay] = useState<StatsRange | null>(null);
  const [chartFocus, setChartFocus] = useState(0);
  const [mapFocus, setMapFocus] = useState<number | null>(null);
  const [metric, setMetric] = useState<StatsMetric>(savedView?.chart ?? "tokens");
  const [split, setSplit] = useState<StatsGrouping | null>(savedView?.split ?? null);
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [exportingRows, setExportingRows] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [sharing, setSharing] = useState(false);
  const plot = useRef<HTMLDivElement>(null);
  const calendarSvg = useRef<SVGSVGElement>(null);
  const exportLifetime = useRef<object | null>(null);
  const exportSelection = useRef<MetricPresentation | null>(null);
  const exportJob = useRef<object | null>(null);
  useEffect(() => {
    const lifetime = {}; exportLifetime.current = lifetime;
    return () => { if (exportLifetime.current === lifetime) exportLifetime.current = null; };
  }, []);
  const query = useMemo<MetricQuery>(() => {
    const sortBy = rankByMetric ? explorerMetric : sort.key === "name" ? "label" : sort.key === "output" ? "inclusive-output-tokens" : sort.key === "records" ? "records" : "accounted-tokens";
    return { schemaVersion: 1, firstUtcDay: requestedFilters.firstUtcDay, dayCount: requestedFilters.dayCount,
      filters: { client: requestedFilters.client, provider: requestedFilters.provider, model: requestedFilters.model }, basis: requestedFilters.basis, costKind,
      groupBy: secondGrouping === null || secondGrouping === grouping ? [grouping] : [grouping, secondGrouping],
      metricIds: [...new Set(["accounted-tokens", "inclusive-output-tokens", "source-reported-charge", explorerMetric])],
      topK: 50, sortBy, sortDirection: sort.ascending && !rankByMetric ? "asc" : "desc" };
  }, [requestedFilters, grouping, secondGrouping, explorerMetric, costKind, sort, rankByMetric]);
  const computation = useStatsMetricQuery(report, session, query), explored = computation.view;
  const filters: StatsFilters = { ...explored.query.filters, firstUtcDay: explored.query.firstUtcDay, dayCount: explored.query.dayCount, basis: explored.query.basis };
  useLayoutEffect(() => { exportSelection.current = computation.pending ? null : explored; return () => { if (exportSelection.current === explored) exportSelection.current = null; }; }, [explored, computation.pending]);
  const projection = explored.projection;
  const { totals, snapshotTotals, groups, buckets, calendar, dailyTotals, prior } = projection;
  const snapshotOnly = filters.client === "warp";
  const snapshotDay = explored.snapshotUtcDay ?? undefined;
  const snapshotStamp = report.sources.find(source => source.client === "warp")?.latestAtMs;

  const splitView = split !== null && metric !== "speed" ? projection.split : null;
  const { clients, providers, models, hasEstimated } = explored.facets;
  const clientOptions = useMemo(() => clients.map(client => <option key={client} value={client}>{statsLabel(client, "client")}</option>), [clients]);
  const providerOptions = useMemo(() => providers.map(provider => <option key={provider} value={provider}>{statsLabel(provider)}</option>), [providers]);
  // New worker replies own fresh arrays even when their finite registry IDs
  // match. Reuse the potentially large option tree by that complete identity.
  const modelOptionKey = models.join("\0");
  const modelOptions = useMemo(() => modelOptionKey === "" ? [] : modelOptionKey.split("\0").map(model => <option key={model} value={model}>{statsLabel(model)}</option>), [modelOptionKey]);
  const label = filters.basis === "reported" ? "Reported" : "Estimated";
  const visibleGroups = showAllGroups ? groups : groups.slice(0, 12);
  const metricMax = buckets.reduce((value, bucket) => {
    const bucketValue = statsBucketValue(bucket.totals, metric);
    return bucketValue !== null && bucketValue > value ? bucketValue : value;
  }, 0n);
  const metricTitle = metric === "tokens" ? `${label} tokens` : metric === "records" ? "Usage records" : "Tokens per source-duration second";
  const metricUnit = metric === "speed" ? " tok/s" : "";
  const formatMetric = (value: bigint) => metric === "records" ? formatStatsInteger(value) : formatStatsCompact(value);
  const bucketLabel = (bucket: (typeof buckets)[number]) => {
    const range = `${formatStatsDay(bucket.firstUtcDay)}${bucket.dayCount > 1 ? ` through ${formatStatsDay(bucket.firstUtcDay + bucket.dayCount - 1)}` : ""}`;
    const value = statsBucketValue(bucket.totals, metric);
    const valueText = value === null ? (metric === "speed" ? "source-token rate unavailable" : "token usage unknown")
      : metric === "records" ? `${formatStatsInteger(value)} records`
      : metric === "speed" ? `${formatStatsInteger(value)} tokens per source-duration second across ${formatStatsInteger(bucket.totals.timedRecords)} timed records`
      : `${formatStatsInteger(value)} ${filters.basis} tokens`;
    return `${range}: ${valueText}`;
  };
  const sourceList = report.sources.filter(source => filters.client === ALL_STATS || source.client === filters.client);
  // Freshness (D8) is derived only from facts the report carries: its generation
  // day against the current UTC day, source timestamps and collection status.
  // Collector health facts do not exist yet, so the area states that explicitly.
  const generatedUtcDay = Math.floor(report.generatedAtMs / 86_400_000);
  const reportAgeDays = generatedUtcDay > todayUtcDay ? null : todayUtcDay - generatedUtcDay;
  const latestSourceAtMs = report.sources.reduce<number | null>((latest, source) => source.latestAtMs !== null && (latest === null || source.latestAtMs > latest) ? source.latestAtMs : latest, null);
  const missingSources = report.sources.filter(source => source.status !== "observed");
  const sourceByClient = new Map(report.sources.map(source => [source.client, source]));
  const periodEnd = filters.firstUtcDay + filters.dayCount - 1;
  const rangeText = `${formatStatsDay(filters.firstUtcDay)}–${formatStatsDay(periodEnd)}`;
  const anchor = scope === "account" ? todayUtcDay : end;
  const presetRange = (days: number) => ({ firstUtcDay: Math.max(0, anchor - days + 1), dayCount: Math.min(days, anchor + 1) });
  const currentView = useMemo(() => savedViewFromSelection({ range: { firstUtcDay: requestedFilters.firstUtcDay, dayCount: requestedFilters.dayCount }, anchor,
    client: requestedFilters.client, provider: requestedFilters.provider, model: requestedFilters.model, basis: requestedFilters.basis,
    grouping, secondGrouping, metric: explorerMetric, costKind, chart: metric, split }), [requestedFilters, anchor, grouping, secondGrouping, explorerMetric, costKind, metric, split]);
  const currentViewSearch = savedViewSearch(currentView);
  useEffect(() => { onSavedView?.(currentView); }, [currentView, currentViewSearch, onSavedView]);
  const copyViewLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}${savedViewSearch(currentView, window.location.search)}`);
      setCopyStatus(scope === "account" ? "View link copied. It restores this period, filters, grouping and metric for the signed-in account; it carries no usage data."
        : "View link copied. It restores this period, filters, grouping and metric once the same report is opened again; it carries no usage data.");
    } catch { setCopyStatus("The view link could not be copied. Try again in this browser."); }
  };
  const periodValue = [1, 7, 30, 90].find(days => {
    const range = presetRange(days);
    return range.firstUtcDay === requestedFilters.firstUtcDay && range.dayCount === requestedFilters.dayCount;
  });
  const activeFilters = Number(requestedFilters.client !== ALL_STATS) + Number(requestedFilters.provider !== ALL_STATS)
    + Number(requestedFilters.model !== ALL_STATS) + Number(requestedFilters.basis !== "reported");
  const cacheShare = statsCacheReadShare(totals);
  const outputSpeed = statsSourceTokenRate(totals);
  const calendarWidth = CALENDAR_GUTTER + calendar.weeks * CALENDAR_PITCH;
  const calendarHeight = CALENDAR_HEADER + 7 * CALENDAR_PITCH;
  const focusDay = mapFocus !== null && mapFocus >= filters.firstUtcDay && mapFocus < filters.firstUtcDay + filters.dayCount ? mapFocus : periodEnd;
  const detail = useStatsMetricDetail(computation.snapshot, session, computation.current, computation.pending, selectedDay);
  const detailTotals = detail?.totals ?? null;
  const detailSpeed = detailTotals ? statsBucketValue(detailTotals, "speed") : null;
  const detailCacheShare = detailTotals === null ? null : statsCacheReadShare(detailTotals);

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
  const sortBy = (key: StatsSort) => { setRankByMetric(false); setSort(previous => ({ key, ascending: previous.key === key ? !previous.ascending : key === "name" })); };
  const drillInto = (key: string) => {
    if (secondGrouping !== null) {
      const selected = explored.groups.find(group => group.key === key);
      if (selected !== undefined && !selected.other) {
        const patch: Partial<StatsFilters> = {};
        explored.query.groupBy.forEach((dimension, index) => { if (dimension === "client" || dimension === "provider" || dimension === "model") patch[dimension] = selected.dimensions[index]; });
        changeFilter(patch);
      }
      return;
    }
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
  const exportRows = async () => {
    if (exportJob.current !== null || exportLifetime.current === null) return;
    const epoch = exportLifetime.current, authority = captureExport?.() ?? (() => true), job = {}; exportJob.current = job;
    const current = () => exportLifetime.current === epoch && exportSelection.current === explored && authority();
    setExportingRows(true); setExportError(false);
    try { await exportCurrentStatsImage(current, () => computation.prepare("csv"), saveCsv); }
    catch { if (current()) setExportError(true); }
    finally { if (exportJob.current === job) { exportJob.current = null; if (exportLifetime.current === epoch) setExportingRows(false); } }
  };
  const moveMapFocus = (day: number) => {
    const next = Math.max(filters.firstUtcDay, Math.min(periodEnd, day));
    setMapFocus(next);
    calendarSvg.current?.querySelector<SVGRectElement>(`[data-day="${next}"]`)?.focus();
  };
  const mapKey = (event: KeyboardEvent<SVGRectElement>, utcDay: number) => {
    const next = event.key === "ArrowRight" ? utcDay + 1 : event.key === "ArrowLeft" ? utcDay - 1
      : event.key === "ArrowDown" ? utcDay + 7 : event.key === "ArrowUp" ? utcDay - 7
      : event.key === "Home" ? filters.firstUtcDay : event.key === "End" ? periodEnd : null;
    if (event.key === "Escape") { setSelectedDay(null); return; }
    if ((event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      setSelectedDay(selectedDay?.firstUtcDay === utcDay && selectedDay.dayCount === 1 ? null : { firstUtcDay: utcDay, dayCount: 1 });
      return;
    }
    if (next !== null) { event.preventDefault(); moveMapFocus(next); }
  };
  const pickMapDay = (utcDay: number) => {
    setMapFocus(utcDay);
    setSelectedDay(selectedDay?.firstUtcDay === utcDay && selectedDay.dayCount === 1 ? null : { firstUtcDay: utcDay, dayCount: 1 });
  };
  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(statsSummaryText(scope, filters, totals, rangeText, groups));
      setCopyStatus("Summary copied to the clipboard.");
    } catch { setCopyStatus("The summary could not be copied. Try again in this browser."); }
  };
  const exportImage = async () => {
    const source = calendarSvg.current;
    if (source === null || exportJob.current !== null) return;
    const lifetime = exportLifetime.current;
    const currentAuthority = captureExport?.() ?? (() => true);
    const current = () => lifetime !== null && exportLifetime.current === lifetime && exportSelection.current === explored && currentAuthority();
    if (!current()) return;
    const job = {}; exportJob.current = job;
    const mounted = () => exportLifetime.current === lifetime && exportJob.current === job;
    setSharing(true); setShareStatus("Preparing image…");
    try {
      const filterNote = [filters.client !== ALL_STATS ? statsLabel(filters.client, "client") : null,
        filters.provider !== ALL_STATS ? statsLabel(filters.provider) : null, filters.model !== ALL_STATS ? statsLabel(filters.model) : null]
        .filter(Boolean).join(" · ");
      const downloaded = await exportCurrentStatsImage(current, () => createBrandedChartPng(source, calendarWidth, calendarHeight, {
        context: `${label} tokens · ${rangeText} UTC${filterNote === "" ? "" : ` · ${filterNote}`}`,
        domain: "aicharts.io",
        freshness: `Partial source coverage · Generated ${stamp.format(report.generatedAtMs)} UTC${scope === "example" ? " · synthetic example" : ""}`,
        providers: [],
        selection: totals.tokenRecords > 0
          ? `${formatStatsCompact(totals.tokens)} tokens · ${formatStatsInteger(totals.records)} source records · ${totals.activeDays}/${filters.dayCount} days with records`
          : `${formatStatsInteger(totals.records)} source records · tokens unobserved`,
      }), image => downloadChartPng(image, `aicharts-usage-${statsDateInput(filters.firstUtcDay)}-${statsDateInput(periodEnd)}.png`));
      if (downloaded) setShareStatus("Image downloaded. Coverage may be partial — see the report for source status.");
      else if (mounted()) setShareStatus("Image canceled after the report changed. You can try again.");
    } catch { if (mounted()) setShareStatus("The image could not be prepared in this browser."); }
    finally { if (mounted()) { exportJob.current = null; setSharing(false); } }
  };
  if (computation.current === null) return <div role={computation.error ? "alert" : "status"} className="usage-stats__notice">
    {computation.error ? "This report could not be prepared. Close it and open it again." : "Preparing the numeric report…"}</div>;
  return <div className="usage-stats" aria-busy={busy || computation.pending}>
    {computation.pending && <p role={computation.error ? "alert" : "status"} className="usage-stats__hint">{computation.error
      ? "This selection could not be prepared. Choose another filter or reopen the report. Previous values remain below."
      : "Updating your selection… Previous values remain below until the exact result is ready."}</p>}
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
        <label>Client<select aria-label="Client" value={requestedFilters.client} onChange={event => changeFilter({ client: event.target.value, provider: ALL_STATS, model: ALL_STATS })}>
          <option value={ALL_STATS}>All clients</option>{clientOptions}
          {filters.client !== ALL_STATS && !clients.includes(filters.client) && <option value={filters.client}>{statsLabel(filters.client, "client")} · no records</option>}
        </select></label>
        <label>Provider<select aria-label="Provider" value={requestedFilters.provider} onChange={event => changeFilter({ provider: event.target.value, model: ALL_STATS })}>
          <option value={ALL_STATS}>All providers</option>{providerOptions}
          {filters.provider !== ALL_STATS && !providers.includes(filters.provider) && <option value={filters.provider}>{statsLabel(filters.provider)} · no records</option>}
        </select></label>
        <label>Model<select aria-label="Model" value={requestedFilters.model} onChange={event => changeFilter({ model: event.target.value })}>
          <option value={ALL_STATS}>All models</option>{modelOptions}
          {filters.model !== ALL_STATS && !models.includes(filters.model) && <option value={filters.model}>{statsLabel(filters.model)} · no records</option>}
        </select></label>
        {(hasEstimated || requestedFilters.basis === "estimated") && <label>Token basis<select aria-label="Token basis" value={requestedFilters.basis} onChange={event => changeFilter({ basis: event.target.value as "reported" | "estimated" })}>
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
        <div><dt>Cache reads / whole input</dt><dd>{cacheShare === null ? "Unknown" : <>{cacheShare}% <span>{formatStatsInteger(totals.cacheRead)} tokens</span></>}</dd></div>
        <div><dt>Source records</dt><dd>{snapshotOnly ? "Unavailable" : formatStatsInteger(totals.records)}</dd></div>
        <div><dt>Days with records</dt><dd>{snapshotOnly ? "Unavailable" : <>{totals.activeDays} <span>of {filters.dayCount}</span></>}</dd></div>
        <div><dt>Records per active day</dt><dd>{totals.activeDays === 0 ? "Unknown" : formatStatsInteger(Math.round(totals.records / totals.activeDays))}</dd></div>
        <div><dt>Tokens per record</dt><dd>{totals.tokenRecords === 0 ? "Unknown" : <>{formatStatsCompact(totals.tokens / BigInt(totals.tokenRecords))} <span>average</span></>}</dd></div>
        <div><dt>Tokens / source second</dt><dd>{outputSpeed === null ? "Unknown" : <>{formatStatsInteger(outputSpeed)} <span>across {formatStatsInteger(totals.timedRecords)} timed records</span></>}</dd></div>
      </dl>
      <div className="usage-stats__cost"><h2>Cost</h2><strong>{formatStatsMoney(totals.reportedCost)}</strong>
        <span>{totals.reportedCost === null ? "No cost supplied by these records" : `reported by sources · ${formatStatsInteger(totals.reportedCostRecords)} of ${formatStatsInteger(totals.records)} records · USD`}</span>
        {totals.estimatedCost !== null && <p>Public-API estimate: <strong>{formatStatsMoney(totals.estimatedCost)}</strong><br />{formatStatsInteger(totals.estimatedCostRecords)} of {formatStatsInteger(totals.records)} records · dated retail rates, not a bill</p>}
        {totals.reportedCost !== null && totals.estimatedCost !== null && <p>These amounts can cover different records. A matched cost difference is unavailable in this report.</p>}
      </div>
    </div>
    <p className="usage-stats__qualification">{scope === "example" ? "Synthetic example. " : ""}Partial coverage. {hasEstimated && filters.basis === "reported" ? "Estimated tokens are separate. " : ""}<a href="#stats-coverage">See source coverage</a> · <a href="#stats-metric-explorer">Explore 241 metric definitions</a>
      {cacheShare === null && <span> · Cache share needs complete input categories and a nonzero input total.</span>}
      {totals.tokenRecords < totals.records && <span> · Tokens unavailable for {formatStatsInteger(totals.records - totals.tokenRecords)} records.</span>}</p>
    <p className="usage-stats__sr" role="status">Showing {formatStatsInteger(totals.records)} records for {rangeText}, {filters.basis} token basis.</p>

    <section className="usage-stats__calendar" aria-labelledby="stats-calendar-title">
      <div className="usage-stats__section-heading"><h2 id="stats-calendar-title">Daily activity</h2>
        <button type="button" className="usage-stats__text-button" disabled={sharing || computation.pending} onClick={() => void exportImage()}>{sharing ? "Preparing image…" : "Download image"}</button>
      </div>
      <div className="usage-stats__calendar-scroll" role="region" aria-label={`${label} token density calendar, ${rangeText} — scroll horizontally for the full range`} tabIndex={0}>
        <svg ref={calendarSvg} className="usage-stats__calendar-svg" width={calendarWidth} height={calendarHeight} viewBox={`0 0 ${calendarWidth} ${calendarHeight}`}
          role="group" aria-label={`${label} token density by UTC day, ${rangeText}. Arrow keys move between days; Enter selects a day.`}>
          {calendar.monthMarks.map(mark => <text key={`${mark.column}-${mark.label}`} className="usage-stats__calendar-month" x={CALENDAR_GUTTER + mark.column * CALENDAR_PITCH} y={10} aria-hidden="true">{mark.label}</text>)}
          {[1, 3, 5].map(row => <text key={row} className="usage-stats__calendar-weekday" x={0} y={CALENDAR_HEADER + row * CALENDAR_PITCH + CALENDAR_CELL - 2} aria-hidden="true">{weekdayNames[row]}</text>)}
          {calendar.cells.map((cell, index) => cell === null ? null : <rect
            key={cell.utcDay} data-day={cell.utcDay}
            x={CALENDAR_GUTTER + Math.floor(index / 7) * CALENDAR_PITCH}
            y={CALENDAR_HEADER + (index % 7) * CALENDAR_PITCH}
            width={CALENDAR_CELL} height={CALENDAR_CELL} rx={2}
            data-tier={cell.tier} className={cell.records > 0 && cell.tokenRecords === 0 ? "is-unknown" : undefined}
            role="button" tabIndex={cell.utcDay === focusDay ? 0 : -1}
            aria-pressed={selectedDay?.firstUtcDay === cell.utcDay && selectedDay.dayCount === 1}
            aria-label={`${formatStatsDay(cell.utcDay)}: ${cell.records === 0 ? "no usage records" : `${cell.tokenRecords > 0 ? `${formatStatsInteger(cell.tokens)} ${filters.basis} tokens` : "token usage unknown"}, ${formatStatsInteger(cell.records)} records`}`}
            onFocus={() => setMapFocus(cell.utcDay)} onKeyDown={event => mapKey(event, cell.utcDay)} onClick={() => pickMapDay(cell.utcDay)} />)}
        </svg>
      </div>
      <div className="usage-stats__calendar-footer">
        <p className="usage-stats__hint">{calendar.activeDays} of {filters.dayCount} days carried records.{calendar.peak !== null && <> Highest activity: {formatStatsDay(calendar.peak.utcDay)} at {formatStatsCompact(calendar.peak.tokens)} {filters.basis} tokens.</>} Hatched days carried records without a token basis; blank days recorded nothing.</p>
        <div className="usage-stats__calendar-scale" aria-hidden="true"><span>Less</span>{[0, 1, 2, 3, 4].map(tier => <i key={tier} data-tier={tier} />)}<span>More</span></div>
      </div>
      {shareStatus !== "" && <p role="status" className="usage-stats__hint">{shareStatus}</p>}
    </section>

    <section className="usage-stats__trend" aria-labelledby="stats-trend-title">
      <div className="usage-stats__section-heading"><h2 id="stats-trend-title">{filters.dayCount > 62 ? "Weekly" : "Daily"} usage</h2>
        <div className="usage-stats__chart-controls">
          <div className="usage-stats__presets" role="group" aria-label="Chart metric">
            {(Object.keys(metricNames) as StatsMetric[]).map(item => <button type="button" key={item} aria-pressed={metric === item} onClick={() => setMetric(item)}>{metricNames[item]}</button>)}
          </div>
          {metric !== "speed" && <div className="usage-stats__presets" role="group" aria-label="Stack bars by">
            {(["none", "client", "provider", "model"] as const).map(item => <button type="button" key={item} aria-pressed={(split ?? "none") === item} onClick={() => {
              setSplit(item === "none" ? null : item); if (item !== "none") { setGrouping(item); if (secondGrouping === item) setSecondGrouping(null); }
            }}>{splitNames[item]}</button>)}
          </div>}
        </div>
      </div>
      <div className="usage-stats__chart-body">
      <div className="usage-stats__scale" aria-hidden="true"><span>{formatMetric(metricMax)}{metricUnit}</span><span>0</span></div>
      <div className="usage-stats__plot" ref={plot} role="group" aria-label={`${metricTitle} by ${filters.dayCount > 62 ? "week" : "day"}. Use left and right arrow keys to move; press Enter to inspect.`}>
        {buckets.map((bucket, index) => {
          const value = statsBucketValue(bucket.totals, metric);
          const segments = splitView?.buckets[index]?.segments ?? [];
          const segmentValue = (segment: { tokens: bigint; records: number }) => metric === "records" ? BigInt(segment.records) : segment.tokens;
          return <button type="button" key={bucket.firstUtcDay} data-bucket={index} tabIndex={chartFocus === index ? 0 : -1}
            className={value === null ? "is-unobserved" : undefined} aria-pressed={selectedDay?.firstUtcDay === bucket.firstUtcDay}
            aria-label={bucketLabel(bucket)}
            onFocus={() => setChartFocus(index)} onKeyDown={event => chartKey(event, index)}
            onClick={() => setSelectedDay(selectedDay?.firstUtcDay === bucket.firstUtcDay ? null : { firstUtcDay: bucket.firstUtcDay, dayCount: bucket.dayCount })}>
            {splitView === null || value === null || value === 0n
              ? <span style={{ height: `${value === null ? 0 : statsRatio(value, metricMax)}%` }} aria-hidden="true" />
              : <span className="usage-stats__bar-stack" style={{ height: `${statsRatio(value, metricMax)}%` }} aria-hidden="true">
                  {segments.map(segment => <i key={segment.key} data-segment={segment.slot} style={{ height: `${statsRatio(segmentValue(segment), value)}%` }} />)}
                </span>}
          </button>;
        })}
      </div>
      </div>
      {splitView !== null && splitView.series.length > 0 && <ul className="usage-stats__legend" aria-label={`Stacked by ${splitNames[split ?? "client"].toLowerCase()} — share of ${metric === "records" ? "records" : "tokens"}`}>
        {splitView.series.map(segment => {
          const total = metric === "records" ? BigInt(totals.records) : totals.tokens;
          const weight = metric === "records" ? BigInt(segment.records) : segment.tokens;
          return <li key={segment.key}><i data-segment={segment.slot} aria-hidden="true" />{segment.name}<span>{total > 0n ? `${statsRatio(weight, total).toFixed(1)}%` : "—"}</span></li>;
        })}
      </ul>}
      <div className="usage-stats__axis" aria-hidden="true"><span>{formatStatsDay(filters.firstUtcDay)}</span><span>{formatStatsDay(periodEnd)}</span></div>
      <p className="usage-stats__hint">{metric === "speed" ? "Dots mark an unavailable rate: timed records need known token counts and a positive total duration. The rate divides tokens by recorded source seconds; duration definitions can differ by client. It is not decode speed or time spent working." : "Dots indicate no observations for this metric; they do not establish no activity. Exact values are available by selecting a bar or opening daily data."}</p>
      {prior && prior.tokenRecords > 0 && metric === "tokens" && <p className="usage-stats__hint" data-matched={explored.previous?.matched === true}>Observed subtotal in the previous {filters.dayCount} days: {formatStatsInteger(prior.tokens)} {filters.basis} tokens.{" "}
        {explored.previous?.matched === true
          ? <>Matched change: {totals.tokens - prior.tokens > 0n ? "+" : ""}{formatStatsInteger(totals.tokens - prior.tokens)} tokens{prior.tokens > 0n ? ` (${totals.tokens - prior.tokens > 0n ? "+" : ""}${statsRatio(totals.tokens - prior.tokens, prior.tokens).toFixed(1)}%)` : " (no baseline)"}; both periods are complete and inside this report.</>
          : <>Matched changes are unavailable: {explored.previous === null ? "the previous period lies outside this report." : (explored.previous.daysWithRecords < filters.dayCount ? `only ${explored.previous.daysWithRecords} of its ${filters.dayCount} days are observed.` : "the selected period is not yet complete.")} A change is refused, not shown as zero.</>}
      </p>}
      {selectedDay && detailTotals && <div className="usage-stats__day-detail" role="region" aria-label="Selected period detail">
        <div><h3>{formatStatsDay(selectedDay.firstUtcDay)}{selectedDay.dayCount > 1 ? `–${formatStatsDay(selectedDay.firstUtcDay + selectedDay.dayCount - 1)}` : ""}</h3>
          <p>{detailTotals.tokenRecords > 0 ? `${formatStatsInteger(detailTotals.tokens)} ${filters.basis} tokens` : "Token usage unknown"} · {formatStatsInteger(detailTotals.records)} records</p></div>
        <button type="button" className="usage-stats__text-button" onClick={() => setSelectedDay(null)}>Close detail</button>
        <dl className="usage-stats__chips">
          <div><dt>Reported cost</dt><dd>{formatStatsMoney(detailTotals.reportedCost)}</dd></div>
          <div><dt>Tokens / source second</dt><dd>{detailSpeed === null ? "Unknown" : formatStatsInteger(detailSpeed)}</dd></div>
          <div><dt>Cache-read share</dt><dd>{detailCacheShare !== null ? `${detailCacheShare}%` : "Unknown"}</dd></div>
        </dl>
        <ul className="usage-stats__day-groups" aria-label="Clients and models in this period">{detail?.groups.map(group => <li key={group.key}><span>{group.name}</span><strong>{group.totals.tokenRecords > 0 ? formatStatsInteger(group.totals.tokens) : "Unknown"}</strong></li>)}</ul>
        <p className="usage-stats__hint">Up to 12 client/model groups; Other retains every remaining contribution.</p>
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
      <div className="usage-stats__section-heading"><h2 id="stats-breakdown-title">Where the tokens went</h2>
        <div className="usage-stats__actions">
          <button type="button" className="usage-stats__text-button" disabled={computation.pending} onClick={() => void copySummary()}>Copy summary</button>
          <button type="button" className="usage-stats__text-button" onClick={() => void copyViewLink()}>Copy view link</button>
          <button type="button" className="usage-stats__text-button" onClick={() => void exportRows()} disabled={computation.pending || exportingRows || sharing || (explored.rowCount === 0 && explored.snapshotRowCount === 0)}>{exportingRows ? "Preparing numeric CSV…" : "Download numeric CSV"}</button>
        </div>
      </div>
      {copyStatus !== "" && <p role="status" className="usage-stats__hint">{copyStatus}</p>}
      {exportError && <p role="alert">The download could not be prepared. Try again in this browser.</p>}
      <div className="usage-stats__presets" role="group" aria-label="Group usage by">
        {(["client", "provider", "model"] as const).map(by => <button type="button" key={by} aria-pressed={grouping === by} onClick={() => {
          setGrouping(by); if (split !== null) setSplit(by); if (secondGrouping === by) setSecondGrouping(null); setShowAllGroups(false);
        }}>{by === "client" ? "Clients" : by === "provider" ? "Providers" : "Models"}</button>)}
      </div>
      {groups.length === 0 ? <div className="usage-stats__notice"><h3>{snapshotOnly ? "No dated usage records" : `No matching ${filters.basis} records`}</h3><p>{snapshotOnly ? "Warp supplies a billing snapshot instead of dated usage records." : "Try a different period, client, provider, model, or token basis. Missing observations stay unknown."}</p></div> : <>
        <div className="usage-stats__table-scroll" role="region" aria-label="Usage breakdown, scroll horizontally for all columns" tabIndex={0}>
          <table><caption>{label} usage by {explored.query.groupBy.join(" × ")}, {rangeText}. Select a name to filter.</caption>
            <thead><tr>{([ ["name", grouping === "client" ? "Client" : grouping === "provider" ? "Provider" : "Model"], ["tokens", `${label} tokens`], ["output", "Output + reasoning"], ["records", "Records"]] as const).map(([key, name]) => <th scope="col" key={key} aria-sort={!rankByMetric && sort.key === key ? (sort.ascending ? "ascending" : "descending") : "none"}>
              <button type="button" onClick={() => sortBy(key)}>{name}{!rankByMetric && sort.key === key && <span className={`usage-stats__sort ${sort.ascending ? "usage-stats__sort--ascending" : ""}`} aria-hidden="true" />}</button>
            </th>)}<th scope="col">Share</th><th scope="col">Source tok/s</th><th scope="col">Reported cost</th></tr></thead>
            <tbody>{visibleGroups.map(group => <tr key={group.key}><th scope="row">{group.other ? <span>Other · {explored.otherGroups} groups</span> : <button className="usage-stats__row-link" type="button" onClick={() => drillInto(group.key)}>{group.name}</button>}<span className="usage-stats__share-bar" aria-hidden="true"><span style={{ width: `${statsRatio(group.totals.tokens, totals.tokens)}%` }} /></span></th>
              <td>{group.totals.tokenRecords > 0 ? formatStatsInteger(group.totals.tokens) : "Unavailable"}</td><td>{group.totals.tokenRecords > 0 ? formatStatsInteger(group.totals.output + group.totals.reasoning) : "Unknown"}</td><td>{formatStatsInteger(group.totals.records)}</td><td>{group.totals.tokenRecords > 0 ? `${statsRatio(group.totals.tokens, totals.tokens).toFixed(1)}%` : "—"}</td>
              <td>{statsSourceTokenRate(group.totals) === null ? "Unknown" : formatStatsInteger(statsSourceTokenRate(group.totals)!)}</td>
              <td>{formatStatsMoney(group.totals.reportedCost)}{group.totals.reportedCost !== null && <small>{group.totals.reportedCostRecords}/{group.totals.records} records</small>}</td></tr>)}</tbody>
          </table>
        </div>
        {groups.length > 12 && <button type="button" className="usage-stats__text-button" onClick={() => setShowAllGroups(!showAllGroups)}>{showAllGroups ? "Show first 12" : `Show ${groups.length} rows${explored.otherGroups > 0 ? " including Other" : ""}`}</button>}
        {groups.length > 12 && !showAllGroups && <p className="usage-stats__hint">Showing the first 12 of {groups.length} rows. Expand to inspect the remaining groups{explored.otherGroups > 0 ? " and the conserved Other subtotal" : ""}.</p>}
      </>}
      <p className="usage-stats__hint">Clients are the apps you use; providers supply their models. Unknown attribution remains in the total. A record is defined by its client. This report does not identify comparable request, response, turn or session counts.</p>
    </section>

    <section className="usage-stats__components" aria-labelledby="stats-components-title">
      <div><h2 id="stats-components-title">Token composition</h2><p>{totals.partialRecords > 0 ? `${formatStatsInteger(totals.partialRecords)} records have a partial breakdown. A zero bucket may be unreported.` : "The available token buckets are separate; reasoning is not counted twice."}</p></div>
      <dl>{(Object.keys(componentNames) as Array<keyof typeof componentNames>).map(key => <div key={key}><dt>{componentNames[key]}</dt><dd>{totals.tokenRecords > 0 ? formatStatsInteger(totals[key]) : "Unavailable"}</dd></div>)}</dl>
    </section>
    <details className="usage-stats__details"><summary>Recorded source duration <span>{formatStatsInteger(totals.timedRecords)} of {formatStatsInteger(totals.records)} records</span></summary>
      <div className="usage-stats__timing"><dl>
        <div><dt>Sum of source durations</dt><dd>{totals.durationMs === null ? "Unavailable" : `${formatStatsInteger(totals.durationMs)} ms`}</dd></div>
        <div><dt>Records with duration</dt><dd>{formatStatsInteger(totals.timedRecords)}</dd></div>
        <div><dt>Tokens in timed records</dt><dd>{totals.timedRecords === 0 || totals.timedTokenRecords !== totals.timedRecords ? "Unknown" : formatStatsInteger(totals.timedTokens)}</dd></div>
      </dl><p>Durations are supplied by source records, can overlap, and may describe different intervals for different clients. Their sum is not time spent working, GPU time, or a measure of inference speed. Missing durations remain unknown.</p></div>
    </details>
    <StatsMetricDailyTable key={`${filters.firstUtcDay}/${filters.dayCount}`} range={filters} totals={dailyTotals} basis={label} />

    <StatsMetricExplorer result={explored} metricId={explored.measures.some(value => value.id === explorerMetric) ? explorerMetric : "accounted-tokens"} onMetric={id => {
      setExplorerMetric(id);
      const dimension = metricRecommendedDimension(id);
      if (dimension === "client" || dimension === "provider" || dimension === "model") {
        setGrouping(dimension); if (secondGrouping === dimension) setSecondGrouping(null); if (split !== null) setSplit(dimension);
      } else if (dimension !== null) setSecondGrouping(dimension);
    }}
      rich={rich ?? { document: null, absence: scope === "account" ? "hosted" : "not-loaded" }}
      secondary={secondGrouping} onSecondary={setSecondGrouping} onCostKind={setCostKind} pending={computation.pending} prepareExport={format => computation.prepare(format === "json" ? "json" : { metricCsv: explorerMetric })}
      onMetricSort={() => setRankByMetric(true)} captureExport={() => {
        const epoch = exportLifetime.current, authority = captureExport?.() ?? (() => true);
        return () => epoch !== null && exportLifetime.current === epoch && exportSelection.current === explored && authority();
      }} />

    <section id="stats-coverage" className="usage-stats__coverage" aria-labelledby="stats-coverage-title">
      <div className="usage-stats__section-heading"><h2 id="stats-coverage-title">Source coverage & freshness</h2><span>{scope === "account" ? "Synced account" : scope === "example" ? "Example data" : "Local report · stays in this browser"}</span></div>
      <p>Report generated {stamp.format(report.generatedAtMs)} UTC. {report.updatedAtMs === null ? "No remote acceptance timestamp in this report." : `Last recorded update ${stamp.format(report.updatedAtMs)} UTC.`} These timestamps do not prove a scheduled collector is healthy.</p>
      <dl className="usage-stats__freshness" aria-label="Freshness and missing sources">
        <div><dt>Collector health</dt><dd><strong>No health facts.</strong> This report carries no collector health record, and hosted source health is not collected yet. A recent timestamp does not prove the collector still runs.</dd></div>
        <div><dt>Report age</dt><dd>{reportAgeDays === null ? "Unknown: the report is generated after the current UTC day." : reportAgeDays === 0 ? "Generated on the current UTC day." : `Generated ${formatStatsInteger(reportAgeDays)} UTC ${reportAgeDays === 1 ? "day" : "days"} before the current day.`}</dd></div>
        <div><dt>Latest source timestamp</dt><dd>{latestSourceAtMs === null ? "Unknown: no source in this report carries a timestamp." : `${stamp.format(latestSourceAtMs)} UTC`}</dd></div>
        <div><dt>Missing sources</dt><dd>{missingSources.length === 0 ? "Every included source reports observations." : `${formatStatsInteger(missingSources.length)} included ${missingSources.length === 1 ? "source reports" : "sources report"} no observations: ${missingSources.map(source => `${statsLabel(source.client, "client")} (${sourceStates[source.status].toLowerCase()})`).join(", ")}.`} {STATS_CLIENTS.length - report.sources.length} of {STATS_CLIENTS.length} supported clients are not included; absence is not zero usage.</dd></div>
      </dl>
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
      <p>The current local collector uses a <a href="https://github.com/hraness/aicharts/blob/main/data/usage-prices.json">models.dev pricing snapshot dated 2026-09-19</a>. Imported or source-provided estimates may use other prices or dates. Neither token volume nor source duration measures productivity.</p>
    </section>
  </div>;
}
