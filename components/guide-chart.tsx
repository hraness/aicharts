"use client";
import { useEffect, useState } from "react";
import { ParetoChart } from "./pareto-chart";
import { formatScore, formatUsd, formatTokens } from "@/lib/format";
import { BENCHMARKS, type BudgetAxis, type ModelRelease } from "@/lib/types";

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
  const [effortSlug, setEffort] = useState(release.efforts[0]!.effortSlug);
  const effort =
    release.efforts.find((e) => e.effortSlug === effortSlug) ??
    release.efforts[0]!;
  const [axis, setAxis] = useState<BudgetAxis>("cost");
  function selectRelease(next: string) {
    const model = releases.find((r) => r.slug === next);
    if (model) {
      setSlug(next);
      setEffort(model.efforts[0]!.effortSlug);
    }
  }
  return (
    <figure data-pj-article-figure>
      <div className="guide-chart" data-pj-visual>
        <div className="chart-controls">
          <label>
            Release
            <select
              disabled={!interactive}
              aria-label="Release"
              value={slug}
              onChange={(e) => selectRelease(e.target.value)}
            >
              {releases.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Effort
            <select
              disabled={!interactive}
              aria-label="Effort"
              value={effort.effortSlug}
              onChange={(e) =>
                setEffort(
                  release.efforts.find((p) => p.effortSlug === e.target.value)!
                    .effortSlug,
                )
              }
            >
              {release.efforts.map((p) => (
                <option key={p.id} value={p.effortSlug}>
                  {p.effortLabel}
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
              onChange={(e) =>
                setAxis(e.target.value === "tokens" ? "tokens" : "cost")
              }
            >
              <option value="cost">Cost per task</option>
              <option value="tokens">Output tokens</option>
            </select>
          </label>
        </div>
        <ParetoChart
          releases={releases}
          selectedRelease={release}
          activeEffortSlug={effort.effortSlug}
          benchmark={BENCHMARKS[0]!}
          axis={axis}
          onSelectEffort={setEffort}
          onSelectRelease={selectRelease}
        />
        <output>
          {release.name} · {effort.effortLabel} effort ·{" "}
          {formatScore(effort.scores.coding, "%")} coding score ·{" "}
          {axis === "cost"
            ? `${formatUsd(effort.costUsdPerTask.total)} per task`
            : `${formatTokens(effort.tokensPerTask.total)} output tokens per task`}
        </output>
      </div>
      <figcaption>
        Change the effort setting to follow one model across the plot. Switching
        the budget to output tokens keeps the coding scores fixed and changes
        what the horizontal distance measures.
      </figcaption>
    </figure>
  );
}
