"use client";
import { CompactPicker } from "@/components/compact-picker";
import { useEffect, useState } from "react";
import { ParetoChart } from "../pareto-chart";
import type { ChartScale } from "@/lib/pareto";
import { chartReadout } from "@/lib/format";
import type { BudgetAxis, ModelRelease } from "@/lib/types";

/**
 * The model chart for static pages: Terminal-Bench score against cost or
 * output tokens per task, one dot per model. Choosing another dot opens that
 * model's page. Without JavaScript the cost chart still renders and the
 * control hides.
 */
export function CatalogChart({
  releases,
  selectedSlug,
  compareSlug,
  caption,
  scale,
}: Readonly<{
  releases: ModelRelease[];
  selectedSlug: string;
  compareSlug?: string;
  caption: string;
  /** Axes shared with the site's other charts of the same kind. */
  scale: ChartScale;
}>) {
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const selected = releases.find((r) => r.slug === selectedSlug)!;
  const compare = compareSlug ? releases.find((r) => r.slug === compareSlug) : undefined;
  const [axis, setAxis] = useState<BudgetAxis>("cost");

  return (
    <figure className="catalog-chart">
      <div className="chart-controls">
        <CompactPicker label="Budget" disabled={!interactive} value={axis} options={[{value:"cost",label:"Cost per task"},{value:"tokens",label:"Output tokens"}]} onChange={v => setAxis(v === "tokens" ? "tokens" : "cost")} />
      </div>
      {compare && (
        <p className="chart-legend">
          <span className={`chart-legend__item chart-legend__item--${selected.provider} chart-legend__item--hero`}>
            <span className="chart-legend__dot" aria-hidden="true" />
            {selected.name}
          </span>
          <span
            className={`chart-legend__item chart-legend__item--${compare.provider} chart-legend__item--hollow`}
          >
            <span className="chart-legend__dot" aria-hidden="true" />
            {compare.name}
          </span>
        </p>
      )}
      <ParetoChart
        releases={releases}
        scale={scale}
        selectedRelease={selected}
        compareRelease={compare ?? null}
        axis={axis}
        onSelectRelease={(slug) => window.location.assign(`/models/${slug}`)}
      />
      <output className="chart-readout">{chartReadout(selected, axis)}</output>
      {compare && <output className="chart-readout">{chartReadout(compare, axis)}</output>}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
