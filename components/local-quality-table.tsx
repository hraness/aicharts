"use client";

import { useState } from "react";
import { CompactPicker } from "./compact-picker";
import { LocalModelName } from "./local-model-name";
import type { QualityMetric } from "@/lib/local-quality";

const parameters = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
const difference = new Intl.NumberFormat("en", { maximumFractionDigits: 3, signDisplay: "exceptZero" });

type ScoreTable = Pick<QualityMetric, "overviewPublishers" | "metric" | "models" | "unit" | "maximum" | "lowerIsBetter">;

export function LocalQualityTable({ metric }: { metric: ScoreTable }) {
  const [sort, setSort] = useState("score");
  const [frontierOnly, setFrontierOnly] = useState(false);
  const [overview, setOverview] = useState(Boolean(metric.overviewPublishers));
  const [band, setBand] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [reference, setReference] = useState("");
  const baseline = metric.models.find(m => m.name === reference);
  const byScore = (a: typeof metric.models[number], b: typeof a) =>
    (metric.lowerIsBetter ? a.score - b.score : b.score - a.score) || a.name.localeCompare(b.name);
  const rows = [...metric.models].sort((a, b) => {
    if (sort === "size") {
      const sizes = (a.storedParameters ?? Infinity) - (b.storedParameters ?? Infinity);
      if (sizes) return sizes;
    }
    return byScore(a, b);
  });
  const hasSize = rows.some(m => m.storedParameters != null);
  // A point is dominated only when a peer matches or improves both axes
  // and strictly improves at least one. Preserve ties and source precision.
  const visibleRows = frontierOnly ? rows.filter(m => {
    const size = m.storedParameters;
    if (size == null) return false;
    return !rows.some(peer => {
      if (peer.storedParameters == null || peer.storedParameters > size) return false;
      const gain = metric.lowerIsBetter ? m.score - peer.score : peer.score - m.score;
      return gain >= 0 && (gain > 0 || peer.storedParameters < size);
    });
  }) : rows;
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const ranges = [
    {value:"small",label:"Up to 4B",low:0,high:4e9},
    {value:"medium",label:"Over 4B to 9B",low:4e9,high:9e9},
    {value:"large",label:"Over 9B to 32B",low:9e9,high:32e9},
    {value:"largest",label:"Over 32B",low:32e9,high:Infinity},
  ];
  const chosen = ranges.find(r => r.value === band);
  const sized = visibleRows.filter(m => !chosen || (m.storedParameters != null && m.storedParameters > chosen.low && m.storedParameters <= chosen.high));
  const matches = sized.filter(m => terms.every(t => (m.name + " " + (m.repository ?? "")).toLowerCase().includes(t)));
  const winners = new Map<string, QualityMetric["models"][number]>();
  if (overview) {
    for (const m of [...matches].sort(byScore)) {
      const publisher = m.repository?.split("/")[0];
      if (publisher && metric.overviewPublishers?.includes(publisher) && !winners.has(publisher)) winners.set(publisher, m);
    }
  }
  const resultRows = overview ? matches.filter(m => winners.get(m.repository?.split("/")[0] ?? "") === m) : matches;
  const perPage = 15;
  const current = Math.min(page, Math.max(0, Math.ceil(resultRows.length / perPage) - 1));
  const start = current * perPage;
  const shown = resultRows.slice(start, start + perPage);
  const scaleMin = Math.min(0, ...rows.map(m => m.score));
  const scaleMax = Math.max(metric.maximum, ...rows.map(m => m.score));
  return <>
    {metric.overviewPublishers && <p className="local-overview">
      {overview ? "Publisher overview · best eligible score from each of seven publishers in the selected size range." : "Complete leaderboard cohort."}{" "}
      <button type="button" onClick={() => {setOverview(!overview);setQuery("");setPage(0);}}>
        {overview ? "See all " + rows.length + " checkpoints" : "Show publisher overview"}
      </button>
    </p>}
    {rows.length > perPage && <div className="local-table-search"><label className="local-model-search">Find a model <input type="search" value={query} placeholder="Name, publisher or size" onChange={e => {setQuery(e.target.value);setOverview(false);setPage(0);}} /></label>
      {hasSize && <CompactPicker label="Model size" value={band} onChange={v => {setBand(v);setPage(0);}} options={[{value:"all",label:"All parameter counts"},...ranges.filter(r => rows.some(m => m.storedParameters != null && m.storedParameters > r.low && m.storedParameters <= r.high))]} />}
    </div>}
    <details className="local-adjustments"><summary>Sort, filter and compare</summary><div className="local-compare-controls">
      {hasSize && <CompactPicker label="Order by" value={sort} onChange={setSort} options={[{value:"score",label:"Best score"},{value:"size",label:"Fewest parameters"}]} />}
      <CompactPicker label="Compare with" value={reference} onChange={setReference} options={[{value:"",label:"Choose a baseline"},...metric.models.map(m => ({value:m.name,label:m.name,group:m.repository?.split("/")[0]}))]} />
      {rows.filter(m => m.storedParameters != null).length > 1 && <label className="local-frontier"><input type="checkbox" checked={frontierOnly} onChange={e => {setFrontierOnly(e.target.checked);setOverview(false);setPage(0);}} /> Size–quality frontier</label>}
    </div></details>
    {frontierOnly && <p>Showing {visibleRows.length} of {rows.length} models. These have reported sizes and achieve the best score available at or below their parameter count in this evaluation.</p>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label={metric.metric + " scores"}>
      <table className="data-table local-score-table">
        <caption>{metric.lowerIsBetter ? "Lower" : "Higher"} scores are better. {baseline && "Difference is the row score minus " + baseline.name + "’s score."}</caption>
        <thead><tr><th>Model</th>{hasSize && <th>Parameters</th>}<th>Score</th>{baseline && <th>Difference</th>}</tr></thead>
        <tbody>{shown.map(m => <tr key={m.name}>
          <th scope="row"><LocalModelName name={m.name} repository={m.repository} /></th>
          {hasSize && <td>{m.storedParameters == null ? "—" : parameters.format(m.storedParameters)}</td>}
          <td>{m.score}{metric.unit}<span aria-hidden="true" className="quality-bar"><i style={{width: (100 * (m.score - scaleMin) / (scaleMax - scaleMin)) + "%"}} /></span></td>
          {baseline && <td>{difference.format(m.score - baseline.score)}{metric.unit === "%" ? " pp" : metric.unit}</td>}
        </tr>)}</tbody>
      </table>
    </div>
    {resultRows.length === 0 && <p role="status">No matching models.</p>}
    {resultRows.length > perPage && <nav aria-label="Model result pages" className="local-result-pages">
      <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
      <span>{start + 1}–{start + shown.length} of {resultRows.length}</span>
      <button type="button" disabled={start + shown.length >= resultRows.length} onClick={() => setPage(current + 1)}>Next</button>
    </nav>}
  </>;
}
