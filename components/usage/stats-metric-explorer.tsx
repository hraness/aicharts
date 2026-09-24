"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { METRIC_CATALOG, type MetricCatalogEntry } from "@/lib/usage/metric-explorer-catalog";
import { METRIC_EXPLORER_VIEWS } from "@/lib/usage/metric-explorer-views";
import { METRIC_REASON_TEXT, metricChange, metricCollectionPath, metricDefinition, metricExplanation, SIGNED_METRIC_IDS, SUPPORTED_METRIC_IDS,
  type MetricDimension, type MetricMeasure, type MetricValue } from "@/lib/usage/metric-explorer";
import { RICH_SUPPORTED_METRIC_IDS } from "@/lib/usage/rich-metric-explorer";
import { exportCurrentStatsImage } from "./stats-export";
import { RichMetricExplorer, type RichExplorerSource } from "./rich-metric-explorer";
import { metricGroupName } from "./stats-metric-projection";
import { formatStatsDay, formatStatsInteger, formatStatsMoney } from "./stats-view";
import type { MetricPresentation, MetricPresentationComparison } from "./stats-metric-presentation";

const views = METRIC_EXPLORER_VIEWS;
const PAGE_SIZE = 12;
const percentages = new Set(["client-token-share", "provider-token-share", "model-token-share", "reasoning-output-share", "cached-input-share",
  "cache-write-input-share", "unknown-model-token-share", "cache-read-token-share", "cache-write-token-share", "pricing-record-coverage", "model-attribution-coverage",
  "previous-period-token-change-percent"]);
const metricTitle = (definition: MetricCatalogEntry) => definition.id.split("-").map(word => word === "usd" ? "USD" : word).join(" ").replace(/^./u, letter => letter.toUpperCase());
function decimal(numerator: bigint, denominator: bigint, places = 2): string {
  const sign = numerator < 0n ? "−" : "", absolute = numerator < 0n ? -numerator : numerator;
  const scale = 10n ** BigInt(places), rounded = (absolute * scale + denominator / 2n) / denominator;
  return `${sign}${formatStatsInteger(rounded / scale)}.${(rounded % scale).toString().padStart(places, "0")}`;
}
/** Renders an exact value for display; `signed` adds a leading plus to positive
 * changes so a difference is never mistaken for a level. */
export function formatMetricValue(value: MetricValue | null, unit: string, id: string, signed = SIGNED_METRIC_IDS.has(id)): string {
  if (value === null) return "Unavailable";
  if (value.kind === "integer") return unit === "microusd" ? (signed && value.amount > 0n ? "+" : "") + formatStatsMoney(value.amount)
    : value.amount > 0n && signed ? `+${formatStatsInteger(value.amount)}` : formatStatsInteger(value.amount);
  const { numerator, denominator } = value;
  const sign = numerator > 0n && signed ? "+" : "";
  if (percentages.has(id)) return `${sign}${decimal(numerator * 100n, denominator)}%`;
  if (unit === "percentage-points") return `${sign}${decimal(numerator, denominator)} pp`;
  if (unit === "USD-per-million-tokens") return `${sign}$${decimal(numerator, denominator)}`;
  return `${sign}${decimal(numerator, denominator)}`;
}
export function formatMetricMeasure(measure: MetricMeasure): string { return formatMetricValue(measure.value, measure.unit, measure.id); }
/** "+1,200 (+12.50%)" for a matched previous measure, or null when no exact change exists. */
export function formatMetricChange(current: MetricMeasure, previous: MetricMeasure | undefined): string | null {
  const change = metricChange(current.value, previous?.value ?? null);
  if (change === null) return null;
  const absolute = formatMetricValue(change.absolute, current.unit, current.id, true);
  return change.percent === null ? `${absolute} (no baseline)` : `${absolute} (${change.percent.numerator > 0n ? "+" : ""}${decimal(change.percent.numerator * 100n, change.percent.denominator)}%)`;
}
const comparisons = [["none", "None"], ["compare-periods", "Previous period"], ["compare-clients", "Clients across periods"], ["compare-models", "Models across periods"]] as const;
const dayRange = (firstUtcDay: number, dayCount: number) => dayCount === 1 ? formatStatsDay(firstUtcDay) : `${formatStatsDay(firstUtcDay)}–${formatStatsDay(firstUtcDay + dayCount - 1)}`;
function comparisonText(previous: MetricPresentationComparison | null, measure: MetricMeasure, query: MetricPresentation["query"]): string {
  if (previous === null) return "No same-length range lies immediately before this one inside the report, so no previous-period comparison exists.";
  const window = `Previous ${previous.dayCount === 1 ? "day" : `${previous.dayCount} days`} (${dayRange(previous.firstUtcDay, previous.dayCount)}, ${previous.daysWithRecords} of ${previous.dayCount} days observed)`;
  if (!previous.matched) return `${window}: ${METRIC_REASON_TEXT[previous.reason ?? "period-coverage-unavailable"]} Change is refused, not shown as zero.`;
  const cohort = previous.cohort.matched ? "Both periods observe the same groups." : `${METRIC_REASON_TEXT[previous.cohort.reason ?? "matched-cohort-unavailable"]} (${previous.cohort.currentOnly} only now, ${previous.cohort.previousOnly} only before along ${query.groupBy.join(" × ") || "the selected population"}.)`;
  if (SIGNED_METRIC_IDS.has(measure.id)) return `${window}: matched, so this value is the exact signed change against it. ${cohort}`;
  const prior = previous.measures.find(value => value.id === measure.id);
  const change = formatMetricChange(measure, prior);
  return `${window}: ${prior === undefined || prior.value === null ? "no exact previous value" : formatMetricValue(prior.value, prior.unit, prior.id)}${change === null ? "" : ` · change ${change}`}. ${cohort}`;
}
function metricUnitLabel(measure: MetricMeasure): string | null {
  if (measure.value === null || measure.unit.startsWith("selected-") || measure.unit.startsWith("declared-") || percentages.has(measure.id)) return null;
  if (measure.unit === "microusd") return "USD";
  if (measure.unit === "USD-per-million-tokens") return "USD per million tokens";
  if (measure.unit === "tokens-per-second") return "tokens per source second";
  return measure.unit.replaceAll("/", " per ").replaceAll("-", " ");
}
function revealMetricDetail(element: HTMLElement | null) {
  if (element !== null && window.matchMedia("(max-width: 720px)").matches) {
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "start", behavior: "instant" });
  }
}
function downloadJson(value: string | Blob) {
  const url = URL.createObjectURL(value instanceof Blob ? value : new Blob([value], { type: "application/json;charset=utf-8" })), anchor = document.createElement("a");
  anchor.href = url; anchor.download = "aicharts-metric-snapshot.json"; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const richIds = new Set(RICH_SUPPORTED_METRIC_IDS);
export function StatsMetricExplorer({ result, metricId, onMetric, secondary, onSecondary, onCostKind, onMetricSort, captureExport, prepareExport, pending = false, rich }: Readonly<{
  result: MetricPresentation; metricId: string; onMetric: (id: string) => void; rich?: RichExplorerSource;
  secondary: MetricDimension | null; onSecondary: (dimension: MetricDimension | null) => void;
  onCostKind: (kind: "reported" | "estimated") => void; onMetricSort: () => void;
  captureExport?: () => (() => boolean);
  prepareExport: () => Promise<string | Blob>; pending?: boolean;
}>) {
  const id = useId(), [search, setSearch] = useState(""), [page, setPage] = useState(0);
  const [view, setView] = useState(() => { const family = metricDefinition(metricId)?.family; const index = views.findIndex(item => family !== undefined && item.families.includes(family)); return index === -1 ? 1 : index; });
  const [exporting, setExporting] = useState(false), [exportStatus, setExportStatus] = useState("");
  const lifetime = useRef<object | null>(null), job = useRef<object | null>(null);
  const selection = useRef<MetricPresentation | null>(null);
  const detail = useRef<HTMLDivElement>(null), revealAfterSelection = useRef<string | null>(null);
  useEffect(() => { const token = {}; lifetime.current = token; return () => { if (lifetime.current === token) lifetime.current = null; }; }, []);
  useLayoutEffect(() => { selection.current = pending ? null : result; return () => { if (selection.current === result) selection.current = null; }; }, [result, pending]);
  useLayoutEffect(() => {
    if (revealAfterSelection.current === metricId) { revealAfterSelection.current = null; revealMetricDetail(detail.current); }
  }, [metricId]);
  const found = useMemo(() => {
    const needle = search.trim().toLowerCase(), families: readonly string[] = views[view].families;
    return METRIC_CATALOG.filter(metric => (needle !== "" || families.length === 0 || families.includes(metric.family))
      && (needle === "" || `${metric.id} ${metric.question} ${metric.family}`.toLowerCase().includes(needle)));
  }, [view, search]);
  const pageCount = Math.max(1, Math.ceil(found.length / PAGE_SIZE)), currentPage = Math.min(page, pageCount - 1);
  const definition = metricDefinition(metricId)!, measure = result.measures.find(value => value.id === metricId)!;
  const supportedMatches = found.filter(metric => SUPPORTED_METRIC_IDS.has(metric.id)).length, unit = metricUnitLabel(measure);
  const richLoaded = rich?.document != null, richMatches = found.filter(metric => richIds.has(metric.id)).length, richSelected = richIds.has(metricId);
  const path = metricCollectionPath(definition), matched = result.previous?.matched === true && !SIGNED_METRIC_IDS.has(metricId);
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % views.length : event.key === "ArrowLeft" ? (index + views.length - 1) % views.length
      : event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : null;
    if (next !== null) { event.preventDefault(); setView(next); setPage(0); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)?.focus(); }
  };
  const exportMetrics = async () => {
    if (job.current !== null || lifetime.current === null) return;
    const token = {}, epoch = lifetime.current, authorized = captureExport?.() ?? (() => true); job.current = token;
    setExporting(true); setExportStatus("Preparing the selected metric snapshot…");
    const current = () => lifetime.current === epoch && selection.current === result && authorized();
    try {
      const done = await exportCurrentStatsImage(current, prepareExport, downloadJson);
      if (lifetime.current === epoch) setExportStatus(done ? "Downloaded exact values, units, coverage and the captured report fingerprint." : "Download canceled after the report changed.");
    } catch { if (lifetime.current === epoch) setExportStatus(current()
      ? "The snapshot could not be prepared. Your report is unchanged; try again." : "Download canceled after the report changed."); }
    finally { if (job.current === token) { job.current = null; if (lifetime.current === epoch) setExporting(false); } }
  };
  return <section id="stats-metric-explorer" className="usage-metrics" aria-labelledby={`${id}-title`}>
    <div className="usage-stats__section-heading"><div><h2 id={`${id}-title`}>Metric explorer</h2><p>Choose a question. Every value uses the dates, filters and token basis above.</p></div>
      <button type="button" className="usage-stats__text-button" disabled={exporting || pending} onClick={() => void exportMetrics()}>{exporting ? "Preparing snapshot…" : "Export metric snapshot"}</button>
    </div>
    <div className="usage-metrics__tabs" role="tablist" aria-label="Metric topics">{views.map((item, index) => <button key={item.name} type="button" role="tab"
      id={`${id}-tab-${index}`} aria-selected={view === index} aria-controls={`${id}-catalog`} tabIndex={view === index ? 0 : -1} data-view={index}
      onKeyDown={event => tabKey(event, index)} onClick={() => { setView(index); setPage(0); }}>{item.name}</button>)}</div>
    <div className="usage-metrics__workspace">
      <div className="usage-metrics__catalog" role="tabpanel" id={`${id}-catalog`} aria-labelledby={`${id}-tab-${view}`}>
        <label>Find a metric<input type="search" value={search} maxLength={80} placeholder="Search all 241 definitions" onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>
        <p className="usage-stats__hint" role="status">{found.length} matching {found.length === 1 ? "definition" : "definitions"} · {supportedMatches} supported by this aggregate profile{richLoaded ? ` · ${richMatches} by the loaded session facts` : ""}</p>
        {found.length === 0 ? <p>No metric matches this search. Try “cache”, “cost”, “latency” or “coverage”.</p>
          : <ul className="usage-metrics__list" aria-label="Metric definitions">{found.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(metric => <li key={metric.id}>
            <button type="button" aria-pressed={metric.id === metricId} onClick={() => {
              revealAfterSelection.current = metric.id; onMetric(metric.id);
              if (metric.id === metricId) { revealAfterSelection.current = null; revealMetricDetail(detail.current); }
            }}><span>{metricTitle(metric)}</span>
              <small>{SUPPORTED_METRIC_IDS.has(metric.id) ? "Aggregate evidence" : richIds.has(metric.id) ? richLoaded ? "Session facts" : "Needs session facts" : metric.availability === "local-profile" ? "Needs session facts" : "Needs more evidence"}</small></button>
          </li>)}</ul>}
        {pageCount > 1 && <div className="usage-metrics__pagination" aria-label="Metric pages"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
          <span>{currentPage + 1} / {pageCount}</span><button type="button" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div>}
      </div>
      <div className="usage-metrics__detail" ref={detail} tabIndex={-1} aria-labelledby={`${id}-answer`} aria-live="polite">
        <h3 id={`${id}-answer`}>{definition.question}</h3>
        {metricExplanation(metricId) !== null && <p>{metricExplanation(metricId)}</p>}
        {richSelected && rich !== undefined ? <RichMetricExplorer source={rich} metricId={metricId} /> : <>
        <div className="usage-metrics__value"><strong>{formatMetricMeasure(measure)}</strong>{unit !== null && <span>{unit}</span>}</div>
        <p className="usage-stats__hint usage-metrics__comparison" data-matched={result.previous?.matched === true}>{comparisonText(result.previous, measure, result.query)}</p>
        {measure.value === null ? <div className="usage-metrics__unavailable"><p>{METRIC_REASON_TEXT[measure.reason!]}</p>
          <p>{SUPPORTED_METRIC_IDS.has(metricId) ? "This selection does not establish the required observations or grouping." : "Support remains planned for the required source evidence; this report cannot establish the value."}</p>
          {path.href === null ? <p>{path.label}.</p> : <a href={path.href}>{path.label}</a>}</div>
          : <><p>{formatStatsInteger(measure.eligibleRecords)} of {formatStatsInteger(measure.selectedRecords)} source-defined records are eligible.
            {measure.excludedRecords > 0n && <> {formatStatsInteger(measure.excludedRecords)} records stay outside this metric’s numerator and denominator.</>}</p>
            <p className="usage-stats__hint">{measure.evidence === "eligible-cohort" ? "The numerator and denominator use the same eligible observations." : "Observed subtotal; unknown source data is not a measured zero."}
              {measure.status === "partial" && " Coverage is partial."}</p></>}
        <dl className="usage-metrics__definition"><div><dt>Token basis</dt><dd>{result.query.basis}</dd></div><div><dt>Time basis</dt><dd>UTC event days; refresh snapshots excluded</dd></div>
          <div><dt>Definition</dt><dd>{definition.id} · version {definition.version}</dd></div>
          <div><dt>Missing days</dt><dd>{result.coverage.unobservedDays} without observations; inactivity is unproven</dd></div>
          {measure.value !== null && <div><dt>{measure.value.kind === "ratio" ? "Exact fraction" : "Exact base units"}</dt><dd><code>{measure.value.kind === "integer" ? measure.value.amount.toString() : `${measure.value.numerator} / ${measure.value.denominator}`}</code></dd></div>}
        </dl>
        <div className="usage-metrics__controls"><label>Cost evidence<select value={result.query.costKind} onChange={event => onCostKind(event.target.value as "reported" | "estimated")}>
          <option value="reported">Source-reported charge</option><option value="estimated">Dated retail estimate</option></select></label>
          <label>Second grouping<select value={secondary ?? "none"} onChange={event => onSecondary(event.target.value === "none" ? null : event.target.value as MetricDimension)}>
            <option value="none">None</option>{(["client", "provider", "model", "utc-day", "utc-week", "utc-month", "weekday"] as const).filter(value => value !== result.query.groupBy[0]).map(value => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}
          </select></label>
          <label>Compare<select value={comparisons.some(([value]) => value === metricId) ? metricId : "none"} onChange={event => onMetric(event.target.value === "none" ? "accounted-tokens" : event.target.value)}>
            {comparisons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label><button type="button" className="usage-stats__text-button" onClick={onMetricSort}>Rank by this metric</button></div>
        {measure.value !== null && <div className="usage-stats__table-scroll" role="region" tabIndex={0} aria-label="Selected metric by group, scroll for exact values"><table>
          <caption>{metricTitle(definition)} by {result.query.groupBy.join(" × ") || "selected population"}. {result.otherGroups > 0 ? `Other retains ${result.otherGroups} omitted groups.` : "All observed groups are shown."}</caption>
          <thead><tr><th scope="col">Group</th><th scope="col">Value</th>{matched && <><th scope="col">Previous</th><th scope="col">Change</th></>}<th scope="col">Eligible records</th><th scope="col">Days with records</th></tr></thead>
          <tbody>{result.groups.map(group => { const value = group.measures.find(value => value.id === metricId)!, prior = group.previous?.find(value => value.id === metricId);
            return <tr key={group.key}><th scope="row">{metricGroupName(group, result)}</th>
            <td>{formatMetricMeasure(value)}</td>{matched && <><td>{prior === undefined ? "No previous observations" : formatMetricMeasure(prior)}</td><td>{formatMetricChange(value, prior) ?? "Unavailable"}</td></>}
            <td>{formatStatsInteger(value.eligibleRecords)} / {formatStatsInteger(value.selectedRecords)}</td><td>{group.daysWithRecords}</td></tr>; })}</tbody>
        </table></div>}
        <p className="usage-stats__hint">Group totals are computed before ranking. “Other” retains every omitted contribution; percentages and distinct-day counts must not be added.</p>
        </>}
      </div>
    </div>
    {exportStatus !== "" && <p className="usage-stats__hint" role="status">{exportStatus}</p>}
  </section>;
}
