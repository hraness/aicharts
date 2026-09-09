"use client";

import { useId, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { captureAnalyticsEvent } from "@/lib/analytics";
import { atlasDatasetSummary, selectAtlasEntries, selectAtlasModelProfiles, sortAtlasPoints, type BenchmarkAtlasDataset, type BenchmarkAtlasEntry, type BenchmarkAtlasPoint } from "@/lib/benchmark-atlas";
import { ATLAS_CATEGORY_LABELS, atlasViewSearch, formatAtlasCost, formatAtlasScore, parseAtlasView, type AtlasViewState } from "@/lib/benchmark-atlas-view";

const TASK_ORDER = ["all", "coding", "reasoning", "research", "memory", "image", "video", "audio", "world", "science", "work", "computer-use", "general"] as const;
const snapshot = () => window.location.search;
const serverSnapshot = () => "";
function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("aicharts:atlas", callback);
  return () => { window.removeEventListener("popstate", callback); window.removeEventListener("aicharts:atlas", callback); };
}
function sourceDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function PointInspector({ point, dataset, compareIds, onCompare }: Readonly<{ point: BenchmarkAtlasPoint; dataset: BenchmarkAtlasDataset; compareIds: readonly string[]; onCompare: (id: string) => void }>) {
  const compared = compareIds.includes(point.id);
  return <aside className="atlas-inspector" aria-label="Selected result">
    <p className="atlas-eyebrow">Selected result</p>
    <h3>{point.model}</h3>
    <p className="atlas-inspector__provider">{point.provider}</p>
    <dl>
      <div className="atlas-inspector__score"><dt>{dataset.score.label}</dt><dd>{formatAtlasScore(point.score, dataset.score.unit, true)}</dd></div>
      {point.harness && <div><dt>Harness</dt><dd>{point.harness}</dd></div>}
      {point.effort && <div><dt>Effort</dt><dd>{point.effort}</dd></div>}
      {dataset.costLabel && <div><dt>{dataset.costLabel}</dt><dd>{formatAtlasCost(point.costUsd)}</dd></div>}
      {point.uncertainty && <div><dt>{point.uncertainty.label}</dt><dd>{formatAtlasScore(point.uncertainty.lower, dataset.score.unit)}–{formatAtlasScore(point.uncertainty.upper, dataset.score.unit)}</dd></div>}
      {point.details?.map((detail, index) => <div key={`${detail.label}-${index}`}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}
    </dl>
    <button className="atlas-button" disabled={!compared && compareIds.length >= 3} onClick={() => onCompare(point.id)} type="button">{compared ? "Remove from comparison" : "Add to comparison"}</button>
    <a className="atlas-source-link" data-analytics-destination-id={`source:${dataset.benchmarkId}`} data-analytics-destination-kind="source" href={point.sourceUrl} target="_blank" rel="noreferrer">View this result at source ↗</a>
  </aside>;
}

function Ranking({ points, selectedId, dataset, onSelect }: Readonly<{ points: readonly BenchmarkAtlasPoint[]; selectedId: string; dataset: BenchmarkAtlasDataset; onSelect: (id: string) => void }>) {
  const relative = dataset.score.unit === "Elo";
  const minimum = dataset.score.minimum ?? (relative ? Math.floor(Math.min(...dataset.points.map(point => point.uncertainty?.lower ?? point.score)) / 50) * 50 : Math.min(0, ...dataset.points.map(point => point.score)));
  const maximum = dataset.score.maximum ?? (relative ? Math.ceil(Math.max(...dataset.points.map(point => point.uncertainty?.upper ?? point.score)) / 50) * 50 : Math.max(...dataset.points.map(point => point.score)) * 1.05);
  const extent = maximum - minimum || 1;
  return <div className="atlas-ranking" role="group" aria-label={`${dataset.score.label} ranking`}>
    <div className="atlas-ranking__axis"><span>{dataset.configurationLabel}</span><span>{dataset.score.label} · {dataset.score.direction === "higher" ? "higher" : "lower"} is better</span></div>
    {points.map((point, index) => <button aria-pressed={selectedId === point.id} className="atlas-row" key={point.id} onClick={() => onSelect(point.id)} type="button">
      <span className="atlas-row__rank">{index > 0 && points[index - 1].score === point.score ? points.findIndex(item => item.score === point.score) + 1 : index + 1}</span>
      <span className="atlas-row__body">
        <span className="atlas-row__heading"><strong>{point.model}</strong><data value={point.score}>{formatAtlasScore(point.score, dataset.score.unit)}</data></span>
        <span className="atlas-row__profile">{[point.provider, point.harness, point.effort].filter(Boolean).join(" · ")}{point.label !== point.model && !point.effort && !point.harness ? ` · ${point.label}` : ""}</span>
        <span className="atlas-row__track" aria-hidden="true">{relative ? <span className="atlas-row__marker" style={{ left: `${(point.score - minimum) / extent * 100}%` }} /> : <span className="atlas-row__fill" style={{ width: `${Math.max(0, Math.min(100, (point.score - minimum) / extent * 100))}%` }} />}{point.uncertainty && <span className="atlas-row__interval" style={{ left: `${Math.max(0, (point.uncertainty.lower - minimum) / extent * 100)}%`, width: `${Math.min(100, (point.uncertainty.upper - point.uncertainty.lower) / extent * 100)}%` }} />}</span>
      </span>
    </button>)}
    <p className="atlas-caption">{relative && `Dots use a ${minimum}–${maximum} Elo range. Elo is relative, not a percentage. `}Select a row to inspect the configuration or compare up to three. {dataset.points.some(point => point.uncertainty) ? "Whiskers show the source’s reported uncertainty." : "Uncertainty was not reported for these results."}</p>
  </div>;
}

function CostChart({ points, selectedId, dataset, onSelect }: Readonly<{ points: readonly BenchmarkAtlasPoint[]; selectedId: string; dataset: BenchmarkAtlasDataset; onSelect: (id: string) => void }>) {
  const eligible = points.filter((point): point is BenchmarkAtlasPoint & { costUsd: number } => point.costUsd !== null && point.costUsd > 0);
  const id = useId();
  if (eligible.length === 0) return <p>No positive costs are reported for these results.</p>;
  const costs = eligible.map(point => Math.log10(point.costUsd));
  const low = Math.floor(Math.min(...costs));
  const high = Math.max(low + 1, Math.ceil(Math.max(...costs)));
  const yMin = dataset.score.minimum ?? Math.min(0, ...eligible.map(point => point.score));
  const yMax = dataset.score.maximum ?? Math.max(...eligible.map(point => point.score)) * 1.1;
  const x = (point: typeof eligible[number]) => 60 + (Math.log10(point.costUsd) - low) / (high - low) * 550;
  const y = (point: BenchmarkAtlasPoint) => 335 - (point.score - yMin) / (yMax - yMin || 1) * 295;
  const ticks = Array.from({ length: Math.min(high - low + 1, 7) }, (_, index, ) => low + (high - low) * index / Math.min(high - low, 6));
  const active = eligible.find(point => point.id === selectedId) ?? eligible[0];
  return <div className="atlas-scatter">
    <p className="atlas-caption">{dataset.score.direction === "higher" ? "Upper left" : "Lower left"} means better performance for less cost. {eligible.length} of {points.length} results report positive costs.</p>
    <div className="atlas-scatter__scroll" tabIndex={0} role="region" aria-label="Cost chart. Scroll horizontally on narrow screens.">
      <svg aria-labelledby={`${id}-title ${id}-desc`} role="group" viewBox="0 0 650 395" onPointerDown={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const px = (event.clientX - bounds.left) / bounds.width * 650;
        const py = (event.clientY - bounds.top) / bounds.height * 395;
        const nearest = eligible.reduce((best, point) => Math.hypot(x(point) - px, y(point) - py) < Math.hypot(x(best) - px, y(best) - py) ? point : best, eligible[0]);
        if (Math.hypot(x(nearest) - px, y(nearest) - py) <= 28) onSelect(nearest.id);
      }}>
        <title id={`${id}-title`}>{dataset.score.label} versus {dataset.costLabel}</title>
        <desc id={`${id}-desc`}>Cost uses a logarithmic scale. Select a point for exact values. Arrow keys move between results.</desc>
        {Array.from({ length: 5 }, (_, i) => {
          const value = yMin + (yMax - yMin) * i / 4;
          const ty = 335 - i / 4 * 295;
          return <g key={i}><line x1="60" x2="610" y1={ty} y2={ty} className="atlas-scatter__grid" /><text x="50" y={ty + 4} textAnchor="end">{formatAtlasScore(value, "")}</text></g>;
        })}
        {ticks.map(tick => <g key={tick}><text x={60 + (tick - low) / (high - low) * 550} y="360" textAnchor="middle">{formatAtlasCost(10 ** tick)}</text></g>)}
        <text x="60" y="19">{dataset.score.label}</text><text x="335" y="388" textAnchor="middle">{dataset.costLabel} · log scale</text>
        {eligible.map((point, index) => <g key={point.id} role="button" tabIndex={point.id === active.id ? 0 : -1} aria-pressed={point.id === selectedId} aria-label={`${point.label}: ${formatAtlasScore(point.score, dataset.score.unit)}, ${formatAtlasCost(point.costUsd)}`} onClick={() => onSelect(point.id)} onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(point.id); }
          if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            const next = (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + eligible.length) % eligible.length;
            onSelect(eligible[next].id);
            const sibling = event.currentTarget.parentElement?.querySelectorAll<SVGGElement>('[role="button"]')[next];
            sibling?.focus();
          }
        }} className="atlas-scatter__point"><circle cx={x(point)} cy={y(point)} r="12" fill="transparent" /><circle cx={x(point)} cy={y(point)} r={point.id === selectedId ? 6 : 4.5} className={point.id === selectedId ? "atlas-scatter__active" : "atlas-scatter__dot"} /><title>{point.label}</title></g>)}
        {active && <g aria-hidden="true"><line x1={x(active)} x2={x(active)} y1={y(active) + 10} y2="335" className="atlas-scatter__guide" /></g>}
      </svg>
    </div>
    <p className="atlas-caption">Tap or focus a point. The selected result stays visible below or beside the chart.</p>
  </div>;
}

function ResultsTable({ points, dataset, onSelect }: Readonly<{ points: readonly BenchmarkAtlasPoint[]; dataset: BenchmarkAtlasDataset; onSelect: (id: string) => void }>) {
  return <div className="atlas-table-scroll"><table className="atlas-table"><caption>{dataset.configurationLabel} and published results</caption><thead><tr><th scope="col">Configuration</th><th scope="col">{dataset.score.label}</th>{dataset.costLabel && <th scope="col">{dataset.costLabel}</th>}</tr></thead><tbody>{points.map(point => <tr key={point.id}><th scope="row"><button onClick={() => onSelect(point.id)} type="button">{point.label}</button><small>{point.provider}</small></th><td>{formatAtlasScore(point.score, dataset.score.unit)}</td>{dataset.costLabel && <td>{formatAtlasCost(point.costUsd)}</td>}</tr>)}</tbody></table></div>;
}

function Comparison({ dataset, points, onRemove }: Readonly<{ dataset: BenchmarkAtlasDataset; points: readonly BenchmarkAtlasPoint[]; onRemove: (id: string) => void }>) {
  if (points.length === 0) return null;
  return <section className="atlas-comparison" aria-label="Compare selected results"><div className="atlas-comparison__heading"><h3>Your comparison</h3><span>{points.length}/3 results · same benchmark</span></div><div className="atlas-comparison__grid" style={{ "--compare-count": points.length } as CSSProperties}>{points.map(point => <div key={point.id}><button className="atlas-comparison__remove" aria-label={`Remove ${point.label} from comparison`} onClick={() => onRemove(point.id)} type="button">×</button><h4>{point.model}</h4><p>{[point.harness, point.effort].filter(Boolean).join(" · ") || point.label}</p><strong>{formatAtlasScore(point.score, dataset.score.unit)}</strong><small>{dataset.score.label}</small>{dataset.costLabel && <><b>{formatAtlasCost(point.costUsd)}</b><small>{dataset.costLabel}</small></>}</div>)}</div>{points.length === 2 && <p className="atlas-caption">Score difference: {formatAtlasScore(Math.abs(points[0].score - points[1].score), dataset.score.unit === "%" ? "points" : dataset.score.unit)} {dataset.score.unit === "%" ? "percentage points" : ""}. {points.some(point => point.uncertainty !== null) ? "Check the uncertainty intervals before treating a small gap as decisive." : "The source does not provide uncertainty for every compared result."}</p>}</section>;
}

export function BenchmarkAtlasExplorer({ entries, datasets }: Readonly<{ entries: readonly BenchmarkAtlasEntry[]; datasets: readonly BenchmarkAtlasDataset[] }>) {
  const search = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const state = useMemo(() => parseAtlasView(search, entries, datasets), [search, entries, datasets]);
  const [query, setQuery] = useState("");
  const [chartOnly, setChartOnly] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const entry = entries.find(item => item.id === state.benchmarkId) ?? entries[0];
  const dataset = datasets.find(item => item.benchmarkId === entry?.id);
  const filteredEntries = selectAtlasEntries(entries, { category: state.category, query }).filter(item => !chartOnly || item.coverage === "charted");
  const ranked = useMemo(() => dataset ? sortAtlasPoints(dataset) : [], [dataset]);
  const providerPoints = ranked.filter(point => state.provider === null || point.provider === state.provider);
  const bestByModel = selectAtlasModelProfiles(providerPoints);
  // Lower-effort configurations are often the efficient choices, so cost never deduplicates them.
  const points = state.bestPerModel && state.view !== "cost" ? bestByModel : providerPoints;
  const expanded = state.expanded || points.findIndex(point => point.id === state.pointId) >= 8;
  const shown = expanded ? points : points.slice(0, 8);
  const selectable = state.view === "cost" ? points.filter(point => point.costUsd !== null && point.costUsd > 0) : points;
  const selected = selectable.find(point => point.id === state.pointId) ?? selectable[0];
  const providers = [...new Set(ranked.map(point => point.provider))].sort();
  const summary = dataset ? atlasDatasetSummary(dataset) : null;
  const comparison = state.compareIds.flatMap(id => { const point = ranked.find(item => item.id === id); return point ? [point] : []; });
  function update(next: AtlasViewState, replace = false) {
    const url = atlasViewSearch(next);
    window.history[replace ? "replaceState" : "pushState"](null, "", `${window.location.pathname}${url}#explore`);
    window.dispatchEvent(new Event("aicharts:atlas"));
    setShareStatus("");
  }
  function choose(id: string, category = state.category) {
    update({ benchmarkId: id, category, view: "ranking", pointId: null, compareIds: [], provider: null, expanded: false, bestPerModel: true });
    captureAnalyticsEvent({ name: "benchmark explored", properties: { benchmark_id: id, action: "benchmark", view: "ranking" } });
  }
  function select(id: string) {
    if (id === state.pointId) return;
    update({ ...state, pointId: id }, true);
    captureAnalyticsEvent({ name: "benchmark explored", properties: { benchmark_id: entry.id, action: "inspect", view: state.view } });
  }
  function changeView(view: AtlasViewState["view"]) {
    const bestPerModel = state.bestPerModel && (state.pointId === null || bestByModel.some(point => point.id === state.pointId));
    update({ ...state, view, bestPerModel });
    captureAnalyticsEvent({ name: "benchmark explored", properties: { benchmark_id: entry.id, action: "view", view } });
  }
  function compare(id: string) {
    const next = state.compareIds.includes(id) ? state.compareIds.filter(value => value !== id) : [...state.compareIds, id].slice(0, 3);
    update({ ...state, compareIds: next }, true);
    captureAnalyticsEvent({ name: "benchmark explored", properties: { benchmark_id: entry.id, action: "compare", view: state.view } });
  }
  async function share() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/` + atlasViewSearch(state) + "#explore"); setShareStatus("Link copied"); captureAnalyticsEvent({ name: "benchmark explored", properties: { benchmark_id: entry.id, action: "share", view: state.view } }); }
    catch { setShareStatus("Copy this page’s address to share the comparison."); }
  }
  if (!entry) return null;
  return <section className="benchmark-atlas" id="explore" aria-label="Explore AI benchmarks" data-analytics-surface="benchmark_atlas">
    <nav className="atlas-tasks" aria-label="Choose a task">{TASK_ORDER.filter(category => category === "all" || entries.some(item => item.category === category)).map(category => <button key={category} aria-pressed={state.category === category} onClick={() => {
      const candidates = category === "all" ? entries : entries.filter(item => item.category === category);
      const first = candidates.find(item => item.coverage === "charted") ?? candidates[0];
      setQuery(""); setChartOnly(false); choose(first.id, category);
    }} type="button">{ATLAS_CATEGORY_LABELS[category]}</button>)}</nav>
    <div className="atlas-workspace">
      <aside className="atlas-library" aria-label="Benchmark library">
        <label className="atlas-search"><span>Find a benchmark</span><input aria-label="Find a benchmark" type="search" placeholder="Search tasks or benchmarks" value={query} onChange={event => setQuery(event.target.value.slice(0, 160))} /></label>
        <div className="atlas-library__filter"><span aria-live="polite">{filteredEntries.length} benchmarks</span><label><input type="checkbox" checked={chartOnly} onChange={event => setChartOnly(event.target.checked)} /> Charts only</label></div>
        <label className="atlas-mobile-select">Benchmark<select value={filteredEntries.some(item => item.id === entry.id) ? entry.id : ""} onChange={event => choose(event.target.value)}><option value="" disabled>Select a benchmark</option>{filteredEntries.map(item => <option key={item.id} value={item.id}>{item.name} {item.version} {item.coverage !== "charted" ? "· Source guide" : ""}</option>)}</select></label>
        <div className="atlas-library__list">{filteredEntries.map(item => <button type="button" key={item.id} aria-pressed={entry.id === item.id} onClick={() => choose(item.id)}><span><strong>{item.name}</strong><small>{item.version}</small></span><span className={`atlas-coverage atlas-coverage--${item.coverage}`}>{item.coverage === "charted" ? "Chart" : item.coverage === "watchlist" ? "Emerging" : "Guide"}</span></button>)}</div>
        {filteredEntries.length === 0 && <div className="atlas-empty"><p>No benchmarks match those filters.</p><button type="button" onClick={() => { setQuery(""); setChartOnly(false); }}>Clear search and chart filter</button></div>}
        <p className="atlas-library__note">Chart = results you can explore here.<br />Guide = what to measure and where to look.</p>
      </aside>
      <div className="atlas-content">
        <header className="atlas-heading"><div><p className="atlas-eyebrow">{ATLAS_CATEGORY_LABELS[entry.category]} <span> / </span> {entry.version}</p><h2>{entry.name}</h2><p>{entry.question}</p></div><button className="atlas-button atlas-button--quiet" onClick={share} type="button">Copy view link ↗</button></header>
        <p className="atlas-share-status" role="status">{shareStatus}</p>
        {dataset && summary ? <>
          <div className="atlas-context"><span><strong>{summary.configurationCount}</strong> results</span><span>{dataset.evidenceLabel ?? dataset.source.name}</span><span>{dataset.observedAt ? `Source date: ${sourceDate(dataset.observedAt)}` : `Retrieved ${sourceDate(dataset.source.retrievedAt)}`}</span></div>
          <p className="atlas-description">{dataset.comparabilityNote}</p>
          <div className="atlas-toolbar">
            <div className="atlas-view-toggle" role="group" aria-label="Chart view">
              {(["ranking", "cost", "table"] as const).filter(view => view !== "cost" || ranked.some(point => point.costUsd !== null && point.costUsd > 0)).map(view => <button key={view} aria-pressed={state.view === view} onClick={() => changeView(view)} type="button">{view === "ranking" ? "Ranking" : view === "cost" ? "Cost vs. score" : "Table"}</button>)}
            </div>
            <label className="atlas-provider"><span>Provider</span><select value={state.provider ?? "all"} onChange={event => { update({ ...state, provider: event.target.value === "all" ? null : event.target.value, expanded: false, pointId: null }); captureAnalyticsEvent({ name: "benchmark explored", properties: { benchmark_id: entry.id, action: "provider", view: state.view } }); }}><option value="all">All providers</option>{providers.map(value => <option key={value}>{value}</option>)}</select></label>
          </div>
          {state.view !== "cost" && bestByModel.length < providerPoints.length && <label className="atlas-profile-toggle"><input type="checkbox" checked={state.bestPerModel} onChange={event => {
            update({ ...state, bestPerModel: event.target.checked, expanded: false, pointId: null });
            captureAnalyticsEvent({ name: "benchmark explored", properties: { benchmark_id: entry.id, action: "profiles", view: state.view } });
          }} /> Best result per system <span>Uses each model and harness’s best-scoring configuration.</span></label>}
          <div className="atlas-results">
            <div className="atlas-results__chart">{state.view === "ranking" ? <Ranking dataset={dataset} points={shown} selectedId={selected?.id ?? ""} onSelect={select} /> : state.view === "cost" ? <CostChart dataset={dataset} points={points} selectedId={selected?.id ?? ""} onSelect={select} /> : <ResultsTable dataset={dataset} points={shown} onSelect={select} />}
              {points.length > 8 && state.view !== "cost" && <button className="atlas-show-all" type="button" onClick={() => { update({ ...state, expanded: !expanded, pointId: expanded ? null : state.pointId }, true); captureAnalyticsEvent({ name: "benchmark explored", properties: { benchmark_id: entry.id, action: "expand", view: state.view } }); }}>{expanded ? "Show top eight" : `Show all ${points.length} results`} <span>{expanded ? "−" : "+"}</span></button>}
            </div>
            {selected && <PointInspector dataset={dataset} point={selected} compareIds={state.compareIds} onCompare={compare} />}
          </div>
          <Comparison dataset={dataset} points={comparison} onRemove={compare} />
          <div className="atlas-provenance"><a data-analytics-destination-id={`source:${entry.id}`} data-analytics-destination-kind="source" href={dataset.source.url} target="_blank" rel="noreferrer">{dataset.source.name} ↗</a><span>Retrieved <time dateTime={dataset.source.retrievedAt}>{sourceDate(dataset.source.retrievedAt)}</time></span></div>
        </> : <div className="atlas-source-guide"><p className="atlas-eyebrow">{entry.coverage === "watchlist" ? "Emerging evaluation" : "Benchmark guide"}</p><h3>{entry.measure}</h3><p>{entry.summary}</p><p className="atlas-source-guide__status">Comparable scores are not yet charted here. The source below provides the published evaluation.</p><a className="atlas-button" href={entry.source.url} data-analytics-destination-id={`source:${entry.id}`} data-analytics-destination-kind="source" target="_blank" rel="noreferrer">Explore {entry.source.name} ↗</a></div>}
        <details className="atlas-method"><summary>What this benchmark measures and how to read it</summary><div><p>{entry.summary}</p><dl><div><dt>Measure</dt><dd>{entry.measure}</dd></div><div><dt>Compare fairly</dt><dd>{entry.comparisonRule}</dd></div></dl><ul>{entry.limitations.map(limit => <li key={limit}>{limit}</li>)}</ul><a data-analytics-destination-id={`source:${entry.id}`} data-analytics-destination-kind="source" href={entry.source.methodologyUrl ?? entry.source.url} target="_blank" rel="noreferrer">Read the methodology ↗</a></div></details>
      </div>
    </div>
  </section>;
}
