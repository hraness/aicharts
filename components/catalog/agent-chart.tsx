"use client";
import { useEffect, useState } from "react";
import { ParetoChart } from "../pareto-chart";
import { chartReadout } from "@/lib/format";
import type { ChartScale } from "@/lib/pareto";
import type { BudgetAxis, ModelRelease, ProviderId } from "@/lib/types";

export type AgentLegendItem = Readonly<{
  provider: ProviderId;
  label: string;
  /** The selected run is the filled dot, its rival the hollow one; the rest are small dots. */
  mark: "hero" | "hollow" | "dot";
}>;

/**
 * Terminal-Bench runs inside the coding agents being compared, one dot per
 * model. Choosing another dot opens that model's page. Without JavaScript the
 * cost chart still renders and the control hides.
 */
export function AgentChart({
  releases,
  selectedSlug,
  compareSlug,
  legend,
  caption,
  scale,
}: Readonly<{
  releases: ModelRelease[];
  selectedSlug: string;
  compareSlug?: string;
  legend: readonly AgentLegendItem[];
  caption: string;
  /** Axes shared with the site's other charts of the same kind. */
  scale: ChartScale;
}>) {
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const selected = releases.find((r) => r.slug === selectedSlug)!;
  const compare = compareSlug ? releases.find((r) => r.slug === compareSlug) : undefined;
  const [axis, setAxis] = useState<BudgetAxis>("cost");
  const agents = [...new Set(releases.flatMap((r) => (r.terminalBench ? [r.terminalBench.agent] : [])))];

  return (
    <figure className="catalog-chart agent-chart">
      <div className="chart-controls">
        <label>
          Budget
          <select
            disabled={!interactive}
            aria-label="Budget"
            value={axis}
            onChange={(e) => setAxis(e.target.value === "tokens" ? "tokens" : "cost")}
          >
            <option value="cost">Cost per task</option>
            <option value="tokens">Output tokens</option>
          </select>
        </label>
      </div>
      <p className="chart-legend">
        {legend.map((item) => (
          <span
            key={item.label}
            className={`chart-legend__item chart-legend__item--${item.provider}${item.mark === "dot" ? "" : ` chart-legend__item--${item.mark}`}`}
          >
            <span className="chart-legend__dot" aria-hidden="true" />
            {item.label}
          </span>
        ))}
      </p>
      <ParetoChart
        releases={releases}
        scale={scale}
        selectedRelease={selected}
        compareRelease={compare ?? null}
        axis={axis}
        ariaLabel={`Terminal-Bench score against ${axis === "cost" ? "cost" : "output tokens"} per task for every current model run in ${agents.join(", ")}`}
        onSelectRelease={(slug) => window.location.assign(`/models/${slug}`)}
      />
      <output className="chart-readout">{chartReadout(selected, axis)}</output>
      {compare && <output className="chart-readout">{chartReadout(compare, axis)}</output>}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
