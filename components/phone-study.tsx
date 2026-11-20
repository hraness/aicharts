"use client";

import { useState } from "react";
import { metrics, number, type Suite } from "@/lib/local-hardware-format";

export function PhoneStudy({suite}: {suite:Suite}) {
  const runs = suite.runs.filter(run => ["Android","iPhone & iPad"].includes(run.platform));
  const [query,setQuery] = useState("");
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = runs.filter(run => {
    const text = [run.device,run.model,run.config,run.note,run.protocol].join(" ").toLowerCase();
    return terms.every(term => text.includes(term));
  });
  return <details className="phone-study">
    <summary>{suite.title} · {runs.length} {runs.length === 1 ? "result" : "results"}</summary>
    <p>{suite.description}</p>
    {runs.length > 10 && <label className="directory-search phone-search">Find a device, model or setting
      <input type="search" value={query} onChange={event => setQuery(event.target.value)}/>
    </label>}
    {query && <p role="status">{matches.length} matching {matches.length === 1 ? "result" : "results"}</p>}
    <div className="phone-results" tabIndex={0} role="region" aria-label={suite.title}>
      <table><thead><tr><th>Device</th><th>Model and settings</th>{suite.metrics.map(k=><th key={k}>{metrics[k]!.label} ({metrics[k]!.unit})</th>)}</tr></thead>
      <tbody>{matches.map(run=><tr key={[run.device,run.model,run.config].join("|")}><td>{run.device}{run.note && <small>{run.note}</small>}</td><th scope="row">{run.model}<small>{run.config}</small>{run.protocol && <small>{run.protocol}</small>}</th>
        {suite.metrics.map(k=><td key={k}>{run.values[k] === undefined ? "—" : number.format(run.values[k]!)}</td>)}</tr>)}</tbody></table>
    </div>
  </details>;
}
