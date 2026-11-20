"use client";
import { useEffect, useState } from "react";
import { ParetoChart } from "../pareto-chart";
import type { ChartScale } from "@/lib/pareto";
import { formatScore, formatUsd } from "@/lib/format";
import {
  AGENT_BENCHMARKS,
  PROVIDERS,
  type BenchmarkId,
  type EffortSlug,
  type ModelRelease,
  type ProviderId,
} from "@/lib/types";

export type AgentLegendItem = Readonly<{
  provider: ProviderId;
  label: string;
  /** Solid and dashed lines are the two emphasized models; dots are the rest. */
  mark: "solid" | "dashed" | "dot";
}>;

/**
 * Runs inside each lab's coding agent on the cost chart. `releases` carry
 * their agent runs in the chart's score slots (chartRelease in lib/agents.ts),
 * so this only relabels the benchmarks. Choosing a point on another model
 * opens that model's page at its agent section. Without JavaScript the
 * Coding Agent Index chart still renders and the control hides.
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
  const [benchmarkId, setBenchmarkId] = useState<BenchmarkId>("coding");
  const top = selected.efforts.reduce((a, b) => (b.scores.coding > a.scores.coding ? b : a));
  const [effortSlug, setEffortSlug] = useState<EffortSlug>(top.effortSlug);
  const benchmark = AGENT_BENCHMARKS.find((b) => b.id === benchmarkId) ?? AGENT_BENCHMARKS[0]!;
  const effort = selected.efforts.find((e) => e.effortSlug === effortSlug) ?? top;
  const agent = PROVIDERS[selected.provider].harness;

  return (
    <figure className="catalog-chart agent-chart">
      <div className="chart-controls">
        <label>
          Benchmark
          <select
            disabled={!interactive}
            value={benchmarkId}
            onChange={(e) => setBenchmarkId(e.target.value as BenchmarkId)}
          >
            {AGENT_BENCHMARKS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="chart-legend">
        {legend.map((item) => (
          <span
            key={item.label}
            className={`chart-legend__item chart-legend__item--${item.provider}${item.mark === "dashed" ? " chart-legend__item--dashed" : ""}`}
          >
            <span
              className={item.mark === "dot" ? "chart-legend__dot" : "chart-legend__line"}
              aria-hidden="true"
            />
            {item.label}
          </span>
        ))}
      </p>
      <ParetoChart
        releases={releases}
        scale={scale}
        selectedRelease={selected}
        compareRelease={compare ?? null}
        activeEffortSlug={effort.effortSlug}
        benchmark={benchmark}
        axis="cost"
        showTokens={false}
        ariaLabel={`${benchmark.fullLabel} against cost per task for every model run inside ${[
          ...new Set(releases.map((r) => PROVIDERS[r.provider].harness)),
        ].join(", ")}`}
        onSelectEffort={setEffortSlug}
        onSelectRelease={(slug) => window.location.assign(`/models/${slug}#agent`)}
      />
      <output className="chart-readout">
        {selected.name} in {agent} · {effort.effortLabel} effort ·{" "}
        {formatScore(effort.scores[benchmark.id], benchmark.unit)} {benchmark.label} ·{" "}
        {formatUsd(effort.costUsdPerTask.total)} per task
      </output>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
