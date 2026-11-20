"use client";
import { useEffect, useState } from "react";
import { ParetoChart } from "./pareto-chart";
import { chartReadout } from "@/lib/format";
import type { BudgetAxis, ModelRelease } from "@/lib/types";

export function GuideChart({
  releases,
  initialSlug,
}: {
  releases: ModelRelease[];
  initialSlug: string;
}) {
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const [slug, setSlug] = useState(initialSlug);
  const release = releases.find((r) => r.slug === slug)!;
  const [axis, setAxis] = useState<BudgetAxis>("cost");
  const plotted = releases.filter((r) => r.terminalBench);
  function selectRelease(next: string) {
    if (releases.some((r) => r.slug === next)) setSlug(next);
  }
  return (
    <figure data-pj-article-figure>
      <div className="guide-chart" data-pj-visual>
        <div className="chart-controls">
          <label>
            Model
            <select
              disabled={!interactive}
              aria-label="Model"
              value={slug}
              onChange={(e) => selectRelease(e.target.value)}
            >
              {plotted.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
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
        <ParetoChart
          releases={releases}
          selectedRelease={release}
          axis={axis}
          onSelectRelease={selectRelease}
        />
        <output>{chartReadout(release, axis)}</output>
      </div>
      <figcaption>
        Pick a model to find its dot. Switching the budget to output tokens
        keeps the scores fixed and changes what the horizontal distance
        measures: how much each model wrote, whatever its price.
      </figcaption>
    </figure>
  );
}
