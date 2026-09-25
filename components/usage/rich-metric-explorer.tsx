"use client";

import { useId, useMemo, useState, type CSSProperties } from "react";
import { METRIC_CATALOG, type MetricCatalogEntry } from "@/lib/usage/metric-explorer-catalog";
import type { RichGrain, RichTokenScope, RichLineage } from "@/lib/usage/rich-fact-contract";
import { RICH_SUPPORTED_METRIC_IDS, type RichMetricQuantity } from "@/lib/usage/rich-metric-explorer";
import { evaluateRichExplorerQuery, MAX_RICH_METRIC_TOP_K, parseRichExplorerQuery, RICH_EXPLORER_REASON_TEXT, RICH_METRIC_DIMENSIONS, richExplorerResultJson,
  type RichExplorerResult, type RichFactsDocument, type RichMetricDimension } from "@/lib/usage/rich-metric-explorer-view";
import { richMetricCsv } from "@/lib/usage/metric-export";
import type { SessionProvider } from "@/lib/usage/session-contract";
import { formatStatsInteger } from "./stats-view";

/** Why no session facts are loaded. Each reason renders its own explicit text;
 * a hosted account report never carries session facts. */
export type RichExplorerAbsence = "hosted" | "not-loaded" | "invalid" | "window" | "limit";
export type RichExplorerSource = Readonly<{ document: RichFactsDocument | null; absence: RichExplorerAbsence | null; onOpen?: () => void; label?: string }>;

export const RICH_ABSENCE_TEXT: Readonly<Record<RichExplorerAbsence, string>> = Object.freeze({
  hosted: "Account usage is a numeric daily aggregate; session facts never leave the device that recorded them. Open a local session report on this device to evaluate this metric.",
  "not-loaded": "This metric is evaluated from local session facts. Open a session-observations-v1 or rich-facts-v1 file to evaluate it here; the file stays in this browser.",
  invalid: "The selected file could not be read as session facts. Choose a session-observations-v1 or rich-facts-v1 JSON file up to 8 MiB.",
  window: "Session facts support at most 31 days between the first and last observation. Open a report with a shorter window.",
  limit: "This file exceeds the session-fact record limit. Open a smaller report.",
});
const grains: readonly [RichGrain, string][] = [["usage_observation", "Usage observation"], ["request", "Request"], ["response", "Response"], ["turn", "Turn"], ["session", "Session"]];
const scopes: readonly [RichTokenScope, string][] = [["direct", "Direct"], ["inclusive", "Inclusive"], ["unknown", "Unknown"]];
const lineages: readonly [RichLineage | "all", string][] = [["all", "All executions"], ["root", "Root only"], ["child", "Children only"], ["unknown", "Unknown lineage"]];
const quantities: readonly [RichMetricQuantity, string][] = [["total", "Total"], ["input", "Input"], ["output", "Output"], ["reasoning", "Reasoning"], ["cacheWriteUnknown", "Unknown cache write"]];
const dimensionNames: Readonly<Record<RichMetricDimension, string>> = { session: "Session", provider: "Provider", model: "Model", "local-day": "Local calendar day", "hour-of-day": "Hour of day" };
const topKs = [10, 25, MAX_RICH_METRIC_TOP_K] as const;
const richCatalog: readonly MetricCatalogEntry[] = METRIC_CATALOG.filter(metric => RICH_SUPPORTED_METRIC_IDS.includes(metric.id));
const providerName = (provider: SessionProvider) => provider === "codex" ? "Codex" : provider === "devin" ? "Devin" : "Claude Code";
const shortId = (id: string) => `${id.slice(0, 4)}…${id.slice(-4)}`;
const metricTitle = (definition: MetricCatalogEntry) => definition.id.split("-").map(word => /^p\d+$/u.test(word) ? word.toUpperCase() : word).join(" ").replace(/^./u, letter => letter.toUpperCase());
function decimal(numerator: bigint, denominator: bigint, places = 2): string {
  const sign = numerator < 0n ? "−" : "", absolute = numerator < 0n ? -numerator : numerator;
  const scale = 10n ** BigInt(places), rounded = (absolute * scale + denominator / 2n) / denominator;
  return `${sign}${formatStatsInteger(rounded / scale)}.${(rounded % scale).toString().padStart(places, "0")}`;
}
export function formatRichValue(value: RichExplorerResult["measure"]["value"], unit: string): string {
  if (value === null) return "Unavailable";
  if (value.kind === "integer") return unit === "milliseconds" ? `${formatStatsInteger(value.amount)} ms` : formatStatsInteger(value.amount);
  if (unit === "percentage" || unit.endsWith("-share") || unit.endsWith("-rate")) return `${decimal(value.numerator * 100n, value.denominator)}%`;
  return decimal(value.numerator, value.denominator);
}
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })), anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Session-fact metrics for a loaded local document. Evaluation is synchronous
 * and bounded by the document limits; nothing is uploaded. Standalone mode adds
 * its own metric picker; embedded mode takes the explorer's selected metric. */
export function RichMetricExplorer({ source, metricId, onMetric, standalone = false }: Readonly<{
  source: RichExplorerSource; metricId: string; onMetric?: (id: string) => void; standalone?: boolean;
}>) {
  const id = useId(), { document: facts } = source;
  const adapted = facts?.origin === "session-observations-v1";
  const [grain, setGrain] = useState<RichGrain>(adapted ? "usage_observation" : "request");
  const [tokenScope, setTokenScope] = useState<RichTokenScope>(adapted ? "unknown" : "direct");
  const [lineage, setLineage] = useState<RichLineage | "all">("all");
  const [quantity, setQuantity] = useState<RichMetricQuantity>("total");
  const [provider, setProvider] = useState("*"), [model, setModel] = useState("*"), [session, setSession] = useState("*");
  const [first, setFirst] = useState<RichMetricDimension | "none">(adapted ? "session" : "none"), [second, setSecond] = useState<RichMetricDimension | "none">("none");
  const [topK, setTopK] = useState<number>(10);
  const [exportStatus, setExportStatus] = useState("");
  const definition = richCatalog.find(metric => metric.id === metricId) ?? null;
  const evaluated = useMemo(() => {
    if (facts === null || definition === null) return null;
    const groupBy = [first, second].filter((value, index, all): value is RichMetricDimension => value !== "none" && all.indexOf(value) === index);
    const query = parseRichExplorerQuery({ schemaVersion: 1, metricId, quantity, filters: { provider, model, session }, groupBy, topK, timeZone: facts.timeZone,
      selection: { window: { startMs: facts.report.window.startMs, endMs: facts.report.window.endMs }, grain, tokenScope, lineage } });
    if (query === null) return { ok: false as const, error: "invalid_query" as const };
    return evaluateRichExplorerQuery(facts, query);
  }, [facts, definition, metricId, quantity, provider, model, session, first, second, topK, grain, tokenScope, lineage]);
  const result = evaluated?.ok ? evaluated.value : null;
  const zoneNote = facts === null ? null : facts.timeZone === null
    ? "This report declares no time zone, so local calendar day and hour of day grouping stay unavailable rather than guessed."
    : `Local calendar and hour-of-day groups use ${facts.timeZone}, declared by the report.`;
  const clock = useMemo(() => new Intl.DateTimeFormat("en-GB", { timeZone: facts?.timeZone ?? "UTC", dateStyle: "medium", timeStyle: "medium" }), [facts?.timeZone]);
  const exportAs = (format: "json" | "csv") => {
    if (result === null) return;
    try {
      const text = format === "json" ? richExplorerResultJson(result) : richMetricCsv(result);
      download(`aicharts-rich-metric-${metricId}.${format}`, text, format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8");
      setExportStatus(`Downloaded ${format.toUpperCase()} with exact values, the filters and the facts revision ${result.revision}.`);
    } catch { setExportStatus("The export exceeds the bounded size; narrow the selection."); }
  };
  const dimensionOptions = (exclude: RichMetricDimension | "none") => RICH_METRIC_DIMENSIONS.filter(value => value !== exclude).map(value =>
    <option key={value} value={value} disabled={facts?.timeZone === null && (value === "local-day" || value === "hour-of-day")}>{dimensionNames[value]}</option>);
  const select = <T extends string>(label: string, value: T, set: (next: T) => void, options: readonly [T, string][], key: string) =>
    <label htmlFor={`${id}-${key}`}>{label}<select id={`${id}-${key}`} value={value} onChange={event => set(event.target.value as T)}>{options.map(([option, name]) => <option key={option} value={option}>{name}</option>)}</select></label>;
  return <section className="usage-rich" aria-labelledby={`${id}-title`} data-loaded={facts !== null}>
    <div className="usage-stats__section-heading"><div><h3 id={`${id}-title`}>{standalone ? "Session-fact metrics" : "Session facts"}</h3>
      <p>{facts === null ? "Exact observation-level metrics need a local session-facts file." : `${source.label ?? (adapted ? "Adapted from the loaded session report" : "Loaded rich facts")} · ${formatStatsInteger(facts.report.facts.length)} facts · revision ${facts.revision}. Nothing is uploaded.`}</p></div>
      {facts !== null && result !== null && <div className="usage-rich__exports"><button type="button" className="usage-stats__text-button" onClick={() => exportAs("json")}>Export JSON</button>
        <button type="button" className="usage-stats__text-button" onClick={() => exportAs("csv")}>Export CSV</button></div>}
    </div>
    {facts === null && <div className="usage-metrics__unavailable" role="status"><p>{RICH_ABSENCE_TEXT[source.absence ?? "not-loaded"]}</p>
      {source.onOpen !== undefined && source.absence !== "hosted" && <p><button type="button" className="usage-stats__text-button" onClick={source.onOpen}>Open session facts</button></p>}</div>}
    {facts !== null && <>
      <div className="usage-rich__controls">
        {standalone && <label htmlFor={`${id}-metric`}>Metric<select id={`${id}-metric`} value={definition?.id ?? ""} onChange={event => onMetric?.(event.target.value)}>
          {richCatalog.map(metric => <option key={metric.id} value={metric.id}>{metricTitle(metric)}</option>)}</select></label>}
        {select("Observation grain", grain, setGrain, grains, "grain")}
        {select("Token scope", tokenScope, setTokenScope, scopes, "scope")}
        {select("Lineage", lineage, setLineage, lineages, "lineage")}
        {select("Token quantity", quantity, setQuantity, quantities, "quantity")}
        <label htmlFor={`${id}-provider`}>Provider<select id={`${id}-provider`} value={provider} onChange={event => setProvider(event.target.value)}><option value="*">All providers</option>
          {(result?.facets.providers ?? []).map(value => <option key={value} value={value}>{providerName(value)}</option>)}</select></label>
        <label htmlFor={`${id}-model`}>Model<select id={`${id}-model`} value={model} onChange={event => setModel(event.target.value)}><option value="*">All models</option>
          {(result?.facets.models ?? []).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label htmlFor={`${id}-session`}>Session<select id={`${id}-session`} value={session} onChange={event => setSession(event.target.value)}><option value="*">All sessions</option>
          {(result?.facets.sessions ?? []).map(value => <option key={value.executionId} value={value.executionId}>{providerName(value.provider)} · {shortId(value.executionId)}</option>)}</select></label>
        <label htmlFor={`${id}-first`}>Group by<select id={`${id}-first`} value={first} onChange={event => { const next = event.target.value as RichMetricDimension | "none"; setFirst(next); if (next === second) setSecond("none"); }}>
          <option value="none">None</option>{dimensionOptions("none")}</select></label>
        <label htmlFor={`${id}-second`}>Then by<select id={`${id}-second`} value={second} disabled={first === "none"} onChange={event => setSecond(event.target.value as RichMetricDimension | "none")}>
          <option value="none">None</option>{dimensionOptions(first)}</select></label>
        <label htmlFor={`${id}-topk`}>Groups shown<select id={`${id}-topk`} value={topK} onChange={event => setTopK(Number(event.target.value))}>{topKs.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      <p className="usage-stats__hint">{zoneNote} Window {clock.format(facts.report.window.startMs)} – {clock.format(facts.report.window.endMs)}{facts.timeZone === null ? " UTC" : ""}.</p>
      {definition === null && <p className="usage-metrics__unavailable" role="status">{RICH_EXPLORER_REASON_TEXT["not-a-session-fact-metric"]}</p>}
      {evaluated !== null && !evaluated.ok && <p className="usage-sessions__notice" role="alert">{evaluated.error === "invalid_query" ? "This selection is outside the supported bounds." : `The facts could not be evaluated (${evaluated.error}).`}</p>}
      {result !== null && definition !== null && <>
        {standalone && <h4 className="usage-rich__question">{definition.question}</h4>}
        <div className="usage-metrics__value usage-rich__value"><strong>{formatRichValue(result.measure.value, result.measure.unit)}</strong><span>{result.measure.unit.replaceAll("-", " ")} · {result.measure.status}{result.measure.status === "partial" ? " coverage" : ""}</span></div>
        {result.measure.reason !== null && <p className="usage-rich__reason" role="status">{RICH_EXPLORER_REASON_TEXT[result.measure.reason]}</p>}
        {result.reason !== null && result.reason !== result.measure.reason && <p className="usage-rich__reason" role="status">{RICH_EXPLORER_REASON_TEXT[result.reason]}</p>}
        <dl className="usage-metrics__definition">
          <div><dt>Cohort</dt><dd>{result.measure.cohort} · {result.measure.aggregation}</dd></div>
          <div><dt>Measured</dt><dd>{formatStatsInteger(result.measure.measured)} measured · {formatStatsInteger(result.measure.unmeasured)} unmeasured; unmeasured facts are not zero</dd></div>
          <div><dt>Definition</dt><dd>{definition.id} · version {definition.version}</dd></div>
          {result.measure.value !== null && <div><dt>{result.measure.value.kind === "ratio" ? "Exact fraction" : "Exact base units"}</dt><dd><code>{result.measure.value.kind === "integer" ? result.measure.value.amount.toString() : `${result.measure.value.numerator} / ${result.measure.value.denominator}`}</code></dd></div>}
        </dl>
        {result.distribution !== null && <div className="usage-rich__distribution">
          <div className="usage-stats__table-scroll" role="region" tabIndex={0} aria-label="Exact percentiles of the measured values"><table className="usage-rich__percentiles">
            <caption>Distribution of {formatStatsInteger(result.distribution.measured)} measured values ({formatStatsInteger(result.distribution.unmeasured)} unmeasured). Percentiles are nearest-rank, exact.</caption>
            <thead><tr><th scope="col">Minimum</th><th scope="col">P50</th><th scope="col">P90</th><th scope="col">P95</th><th scope="col">P99</th><th scope="col">Maximum</th><th scope="col">Mean</th><th scope="col">Sum</th></tr></thead>
            <tbody><tr>{([result.distribution.minimum, result.distribution.p50, result.distribution.p90, result.distribution.p95, result.distribution.p99, result.distribution.maximum] as const).map((value, index) =>
              <td key={index}>{value === null ? "Unavailable" : formatStatsInteger(value)}</td>)}
              <td>{result.distribution.mean === null ? "Unavailable" : <>{decimal(result.distribution.mean.numerator, result.distribution.mean.denominator)} <code>{`${result.distribution.mean.numerator} / ${result.distribution.mean.denominator}`}</code></>}</td>
              <td>{formatStatsInteger(result.distribution.sum)}</td></tr></tbody></table></div>
          {result.distribution.bins.length > 0 && <ol className="usage-rich__histogram" aria-label={`Histogram of ${result.distribution.measured} measured values in ${result.distribution.bins.length} bins`}>
            {result.distribution.bins.map((bin, index) => { const peak = Math.max(...result.distribution!.bins.map(value => value.count));
              return <li key={index} style={{ "--share": `${peak === 0 ? 0 : Math.round(bin.count * 100 / peak)}%` } as CSSProperties}>
                <span className="usage-rich__bin">{formatStatsInteger(bin.lower)}–{formatStatsInteger(bin.upper)}</span><span className="usage-rich__bar" aria-hidden="true" /><span className="usage-rich__count">{formatStatsInteger(bin.count)}</span></li>; })}
          </ol>}
        </div>}
        {result.groups.length > 0 && <div className="usage-stats__table-scroll" role="region" tabIndex={0} aria-label="Selected session-fact metric by group"><table className="usage-rich__groups">
          <caption>{metricTitle(definition)} by {result.query.groupBy.map(value => dimensionNames[value]).join(" × ") || "all selected facts"}. {result.omittedGroups > 0 ? `${result.omittedGroups} of ${result.totalGroups} groups are omitted; nothing is merged into a remainder.` : "All observed groups are shown."}</caption>
          <thead><tr><th scope="col">Group</th><th scope="col">Value</th><th scope="col">Measured</th><th scope="col">Unmeasured</th><th scope="col">Facts</th><th scope="col">Reason</th></tr></thead>
          <tbody>{result.groups.map(group => <tr key={group.key}><th scope="row">{group.label}</th><td>{formatRichValue(group.measure.value, group.measure.unit)}</td>
            <td>{formatStatsInteger(group.measure.measured)}</td><td>{formatStatsInteger(group.measure.unmeasured)}</td><td>{formatStatsInteger(group.facts)}</td><td>{group.measure.reason === null ? "—" : RICH_EXPLORER_REASON_TEXT[group.measure.reason]}</td></tr>)}</tbody>
        </table></div>}
        {result.samples.length > 0 && <details className="usage-stats__details usage-rich__drilldown"><summary>Observations behind this value <span>{formatStatsInteger(result.samples.length)} of {formatStatsInteger(result.sampledFacts)} shown, largest first</span></summary>
          <div className="usage-stats__table-scroll" role="region" tabIndex={0} aria-label="Observations behind the selected metric"><table>
            <caption>Keyed session and observation identifiers; the transcript is never read.</caption>
            <thead><tr><th scope="col">Session</th><th scope="col">Observation</th><th scope="col">Recorded at{facts.timeZone === null ? " (UTC)" : ` (${facts.timeZone})`}</th><th scope="col">Model</th><th scope="col">Value</th></tr></thead>
            <tbody>{result.samples.map(sample => <tr key={`${sample.executionId}:${sample.observationId}`}><th scope="row"><button type="button" className="usage-stats__text-button" onClick={() => setSession(sample.executionId)} aria-pressed={session === sample.executionId}>{providerName(sample.provider)} · {shortId(sample.executionId)}</button></th>
              <td>{shortId(sample.observationId)}</td><td>{clock.format(sample.atMs)}</td><td>{sample.model ?? "Unknown model"}</td><td>{sample.value === null ? "Unmeasured" : formatStatsInteger(sample.value)}</td></tr>)}</tbody>
          </table></div></details>}
      </>}
      {exportStatus !== "" && <p className="usage-stats__hint" role="status">{exportStatus}</p>}
    </>}
  </section>;
}
