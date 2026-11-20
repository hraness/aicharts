"use client";
import { useEffect, useState } from "react";
import { ParetoChart } from "../pareto-chart";
import type { ChartScale } from "@/lib/pareto";
import { formatScore, formatTokens, formatUsd } from "@/lib/format";
import {
  BENCHMARKS,
  type BenchmarkId,
  type BudgetAxis,
  type EffortSlug,
  type ModelRelease,
} from "@/lib/types";

/**
 * The explorer's effort-curve chart for static pages. Choosing another release
 * on the chart opens its model page. Without JavaScript the coding/cost chart
 * still renders and the controls hide.
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
  const [benchmarkId, setBenchmarkId] = useState<BenchmarkId>("coding");
  const [axis, setAxis] = useState<BudgetAxis>("cost");
  const [effortSlug, setEffortSlug] = useState<EffortSlug>(
    (selected.efforts.find((e) => e.isDefaultEffort) ?? selected.efforts[0]!).effortSlug,
  );
  const benchmark = BENCHMARKS.find((b) => b.id === benchmarkId) ?? BENCHMARKS[0]!;
  const effort = selected.efforts.find((e) => e.effortSlug === effortSlug) ?? selected.efforts[0]!;

  return (
    <figure className="catalog-chart">
      <div className="chart-controls">
        <label>
          Benchmark
          <select
            disabled={!interactive}
            value={benchmarkId}
            onChange={(e) => setBenchmarkId(e.target.value as BenchmarkId)}
          >
            {BENCHMARKS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cost axis
          <select
            disabled={!interactive}
            value={axis}
            onChange={(e) => setAxis(e.target.value === "tokens" ? "tokens" : "cost")}
          >
            <option value="cost">Cost per task</option>
            <option value="tokens">Output tokens</option>
          </select>
        </label>
      </div>
      {compare && (
        <p className="chart-legend">
          <span className={`chart-legend__item chart-legend__item--${selected.provider}`}>
            <span className="chart-legend__line" aria-hidden="true" />
            {selected.name}
          </span>
          <span
            className={`chart-legend__item chart-legend__item--${compare.provider} chart-legend__item--dashed`}
          >
            <span className="chart-legend__line" aria-hidden="true" />
            {compare.name}
          </span>
        </p>
      )}
      <ParetoChart
        releases={releases}
        scale={scale}
        selectedRelease={selected}
        compareRelease={compare ?? null}
        activeEffortSlug={effort.effortSlug}
        benchmark={benchmark}
        axis={axis}
        onSelectEffort={setEffortSlug}
        onSelectRelease={(slug) => window.location.assign(`/models/${slug}`)}
      />
      <output className="chart-readout">
        {selected.name} · {effort.effortLabel} effort ·{" "}
        {formatScore(effort.scores[benchmark.id], benchmark.unit)} {benchmark.label} ·{" "}
        {axis === "cost"
          ? `${formatUsd(effort.costUsdPerTask.total)} per task`
          : `${formatTokens(effort.tokensPerTask.total)} output tokens per task`}
      </output>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
