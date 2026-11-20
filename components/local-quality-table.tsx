"use client";

import { useState } from "react";
import type { QualityMetric } from "@/lib/local-quality";

const parameters = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
const difference = new Intl.NumberFormat("en", { maximumFractionDigits: 3, signDisplay: "exceptZero" });

type ScoreTable = Pick<QualityMetric, "metric" | "models" | "unit" | "maximum" | "lowerIsBetter">;

export function LocalQualityTable({ metric }: { metric: ScoreTable }) {
  const [sort, setSort] = useState("score");
  const [frontierOnly, setFrontierOnly] = useState(false);
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
  const scaleMin = Math.min(0, ...rows.map(m => m.score));
  const scaleMax = Math.max(metric.maximum, ...rows.map(m => m.score));
  return <>
    <div className="local-compare-controls">
      {hasSize && <label>Order by <select value={sort} onChange={e => setSort(e.target.value)}>
        <option value="score">Best score</option><option value="size">Fewest stored parameters</option>
      </select></label>}
      <label>Compare with <select value={reference} onChange={e => setReference(e.target.value)}>
        <option value="">Choose a baseline</option>
        {metric.models.map(m => <option key={m.name}>{m.name}</option>)}
      </select></label>
      {rows.filter(m => m.storedParameters != null).length > 1 && <label className="local-frontier"><input type="checkbox" checked={frontierOnly} onChange={e => setFrontierOnly(e.target.checked)} /> Size–quality frontier</label>}
    </div>
    {frontierOnly && <p>Showing {visibleRows.length} of {rows.length} models. These have reported sizes and achieve the best score available at or below their parameter count in this evaluation.</p>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label={metric.metric + " scores"}>
      <table className="data-table local-score-table">
        <caption>{metric.lowerIsBetter ? "Lower" : "Higher"} scores are better. {baseline && "Difference is the row score minus " + baseline.name + "’s score."}</caption>
        <thead><tr><th>Model</th>{hasSize && <th>Stored parameters</th>}<th>Score</th>{baseline && <th>Difference</th>}</tr></thead>
        <tbody>{visibleRows.map(m => <tr key={m.name}>
          <th scope="row">{m.repository ? <a href={"https://huggingface.co/" + m.repository}>{m.name}</a> : m.name}</th>
          {hasSize && <td>{m.storedParameters == null ? "—" : parameters.format(m.storedParameters)}</td>}
          <td>{m.score}{metric.unit}<span aria-hidden="true" className="quality-bar"><i style={{width: (100 * (m.score - scaleMin) / (scaleMax - scaleMin)) + "%"}} /></span></td>
          {baseline && <td>{difference.format(m.score - baseline.score)}{metric.unit === "%" ? " pp" : metric.unit}</td>}
        </tr>)}</tbody>
      </table>
    </div>
  </>;
}
