"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FrontierStarIcon, ProviderLogo } from "./brand-icon";
import {
  formatScore,
  formatTokens,
  formatTokensTick,
  formatUsd,
  formatUsdTick,
  shortModelName,
} from "@/lib/format";
import {
  buildBenchmarkPoints,
  computeParetoFrontier,
  getQualifiedFrontierKeys,
  primaryPoint,
  type BenchmarkPoint,
  type ChartBenchmark,
  type ChartScale,
} from "@/lib/pareto";
import { effortName } from "@/lib/measures";
import {
  GAME_BENCH,
  TERMINAL_BENCH,
  type BudgetAxis,
  type EffortSlug,
  type ModelRelease,
} from "@/lib/types";

const COST_TICKS = [0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250];
const TOKEN_TICKS = [5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000];

type Box = { x1: number; y1: number; x2: number; y2: number };

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

/**
 * Score against budget within one benchmark. Terminal-Bench has one dot per
 * model and GameBench 2 connects each model's tested effort settings.
 */
export function ParetoChart({
  releases,
  selectedRelease,
  compareRelease = null,
  axis,
  benchmark = "terminal-bench",
  activeEffort,
  onSelectRelease,
  ariaLabel,
  scale,
}: Readonly<{
  releases: readonly ModelRelease[];
  selectedRelease: ModelRelease;
  /** A second release drawn as an emphasized hollow dot, for head-to-head pages. */
  compareRelease?: ModelRelease | null;
  axis: BudgetAxis;
  benchmark?: ChartBenchmark;
  activeEffort?: EffortSlug | null;
  onSelectRelease: (slug: string, effort?: EffortSlug) => void;
  /** Replaces the generated description of the chart. */
  ariaLabel?: string;
  /**
   * Fixed axes, so switching the selection or the field keeps every point in
   * place. Without it the axes fit the plotted releases.
   */
  scale?: ChartScale;
}>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(740);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [pinnedPeerKey, setPinnedPeerKey] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(Math.round(w));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setPinnedPeerKey(null);
    setHoveredKey(null);
  }, [selectedRelease.slug, axis, benchmark]);

  const isCompact = width < 520;
  const height = isCompact ? 236 : 268;
  const pad = {
    top: 20,
    right: isCompact ? 14 : 20,
    bottom: 28,
    left: isCompact ? 34 : 38,
  };
  const plotW = Math.max(180, width - pad.left - pad.right);
  const plotH = Math.max(140, height - pad.top - pad.bottom);

  const allPoints = useMemo(() => buildBenchmarkPoints(releases, axis, benchmark), [releases, axis, benchmark]);
  const frontier = useMemo(() => computeParetoFrontier(allPoints), [allPoints]);
  const frontierKeySet = useMemo(() => new Set(frontier.map((p) => p.key)), [frontier]);
  const qualifiedFrontierSet = useMemo(() => getQualifiedFrontierKeys(frontier), [frontier]);

  const { logMin, logMax, yMin, yMax, xTicks, yTicks } = useMemo(() => {
    const fixed = scale?.[axis];
    const budgets = [...allPoints.map((p) => p.budget), ...(fixed?.budget ?? [])];
    const scores = [...allPoints.map((p) => p.score), ...(fixed?.score ?? [])];
    const minB = budgets.length > 0 ? Math.min(...budgets) : axis === "cost" ? 0.1 : 10000;
    const maxB = budgets.length > 0 ? Math.max(...budgets) : axis === "cost" ? 50 : 500000;
    const rawLogMin = Math.log10(minB);
    const rawLogMax = Math.log10(maxB);
    const span = Math.max(0.6, rawLogMax - rawLogMin);
    const lMin = rawLogMin - span * 0.06;
    const lMax = rawLogMax + span * 0.07;

    const maxS = scores.length > 0 ? Math.max(...scores) : 70;
    const minS = scores.length > 0 ? Math.min(...scores) : 0;
    const topS = Math.min(100, Math.ceil((maxS + 4) / 10) * 10);
    const botS = minS > 22 ? Math.floor((minS - 4) / 10) * 10 : 0;

    const candidates = axis === "cost" ? COST_TICKS : TOKEN_TICKS;
    const minSpacingPx = isCompact ? 50 : 58;
    const chosenXTicks: number[] = [];
    let lastPx = -Infinity;
    for (const t of candidates) {
      const lt = Math.log10(t);
      if (lt < lMin || lt > lMax) continue;
      const px = pad.left + ((lt - lMin) / (lMax - lMin)) * plotW;
      if (px - lastPx >= minSpacingPx) {
        chosenXTicks.push(t);
        lastPx = px;
      }
    }

    const step = topS - botS <= 40 ? 10 : isCompact ? 20 : 10;
    const chosenYTicks: number[] = [];
    for (let v = botS; v <= topS; v += step) {
      chosenYTicks.push(v);
    }
    if (chosenYTicks[chosenYTicks.length - 1] !== topS) {
      chosenYTicks.push(topS);
    }

    return {
      logMin: lMin,
      logMax: lMax,
      yMin: botS,
      yMax: topS,
      xTicks: chosenXTicks,
      yTicks: chosenYTicks,
    };
  }, [allPoints, scale, axis, isCompact, pad.left, plotW]);

  const toX = (budget: number) =>
    pad.left + ((Math.log10(budget) - logMin) / (logMax - logMin)) * plotW;
  const toY = (score: number) =>
    pad.top + (1 - (score - yMin) / Math.max(1, yMax - yMin)) * plotH;

  const inspectedKey = hoveredKey ?? pinnedPeerKey;
  const pointByKey = useMemo(() => new Map(allPoints.map((p) => [p.key, p])), [allPoints]);
  const inspectedPoint = inspectedKey ? (pointByKey.get(inspectedKey) ?? null) : null;

  const series = useMemo(() => {
    const groups = new Map<string, BenchmarkPoint[]>();
    for (const point of allPoints) {
      const slug = point.release.slug;
      const group = groups.get(slug) ?? [];
      group.push(point);
      groups.set(slug, group);
    }
    return groups;
  }, [allPoints]);
  const isGameBench = benchmark === "game-bench";
  const scoreUnit = isGameBench ? "pts" : "%";
  const selectedPoints = series.get(selectedRelease.slug) ?? [];
  const comparePoints = compareRelease ? series.get(compareRelease.slug) ?? [] : [];
  const selectedPoint = primaryPoint(selectedPoints, activeEffort);
  const peerSeries = [...series.values()].filter((points) => points !== selectedPoints && points !== comparePoints);
  const pointTag = (point: BenchmarkPoint) =>
    isGameBench ? effortName(point.run.effort) : shortModelName(point.release.name);
  const curve = (points: readonly BenchmarkPoint[]) =>
    points.map((p) => `${toX(p.budget)},${toY(p.score)}`).join(" ");

  // Place labels where they clear the dots and the other labels.
  const tagPositions = useMemo(() => {
    const occupied: Box[] = allPoints.map((p) => {
      const x = toX(p.budget);
      const y = toY(p.score);
      return { x1: x - 5, y1: y - 5, x2: x + 5, y2: y + 5 };
    });
    const tags = new Map<string, { x: number; y: number }>();
    const emphasized = selectedPoint
      ? [selectedPoint, ...selectedPoints.filter((p) => p !== selectedPoint), ...comparePoints]
      : comparePoints;
    for (const point of emphasized) {
      const x = toX(point.budget);
      const y = toY(point.score);
      const w = pointTag(point).length * 6.2 + 8;
      const h = 13;
      const candidates = [
        { x, y: y - 11 },
        { x, y: y + 19 },
        { x: x - w / 2 - 9, y: y + 4 },
        { x: x + w / 2 + 9, y: y + 4 },
      ];
      let chosen: { x: number; y: number } | null = null;
      for (const c of candidates) {
        const box: Box = { x1: c.x - w / 2, y1: c.y - h + 2, x2: c.x + w / 2, y2: c.y + 2 };
        const inBounds =
          box.x1 >= pad.left - 4 &&
          box.x2 <= pad.left + plotW + 4 &&
          box.y1 >= pad.top - 6 &&
          box.y2 <= pad.top + plotH + 2;
        if (inBounds && !occupied.some((o) => boxesOverlap(box, o))) {
          chosen = c;
          occupied.push(box);
          break;
        }
      }
      // Keep a label on the selected setting when the frontier is crowded.
      if (!chosen && point === selectedPoint) {
        const fallback = candidates.find((c) => {
          const x1 = c.x - w / 2;
          return x1 >= pad.left - 4 && c.x + w / 2 <= pad.left + plotW + 4 && c.y - h >= pad.top - 6;
        });
        chosen = fallback ?? candidates[1]!;
      }
      if (chosen) tags.set(point.key, chosen);
    }
    return tags;
  }, [allPoints, selectedPoint, selectedPoints, comparePoints, isGameBench, logMin, logMax, yMin, yMax, plotW, plotH, pad.left, pad.top]);

  function findNearestPoint(clientX: number, clientY: number): BenchmarkPoint | null {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    let best: BenchmarkPoint | null = null;
    let bestDist = 26 * 26;
    for (const pt of allPoints) {
      const dx = toX(pt.budget) - mx;
      const dy = toY(pt.score) - my;
      const d2 = dx * dx + dy * dy;
      const emphasized = pt.release.slug === selectedRelease.slug || pt.release.slug === compareRelease?.slug;
      const weighted = emphasized ? d2 * 0.75 : d2;
      if (weighted < bestDist) {
        bestDist = weighted;
        best = pt;
      }
    }
    return best;
  }

  const frontierPath = useMemo(() => {
    if (frontier.length === 0) return "";
    const coords = frontier.map((p) => ({ x: toX(p.budget), y: toY(p.score) }));
    let d = `M ${coords[0]!.x.toFixed(1)} ${coords[0]!.y.toFixed(1)}`;
    for (let i = 1; i < coords.length; i++) {
      // A staircase: a frontier score holds until a dearer run beats it.
      d += ` L ${coords[i]!.x.toFixed(1)} ${coords[i - 1]!.y.toFixed(1)}`;
      d += ` L ${coords[i]!.x.toFixed(1)} ${coords[i]!.y.toFixed(1)}`;
    }
    const last = coords[coords.length - 1]!;
    if (last.x < pad.left + plotW - 6) {
      d += ` L ${(pad.left + plotW).toFixed(1)} ${last.y.toFixed(1)}`;
    }
    return d;
  }, [frontier, logMin, logMax, yMin, yMax, plotW, plotH, pad.left]);

  const tooltipPos = useMemo(() => {
    if (!inspectedPoint) return null;
    const px = toX(inspectedPoint.budget);
    const py = toY(inspectedPoint.score);
    const cardW = 192;
    const left = px + cardW + 16 > width ? Math.max(8, px - cardW - 12) : px + 12;
    const top = Math.max(6, Math.min(height - 68, py - 24));
    return { left, top };
  }, [inspectedPoint, width, height, logMin, logMax, yMin, yMax]);

  const budgetLabel = isGameBench ? "estimated cost per program" : axis === "cost" ? "cost per task" : "output tokens per task";
  const axisLabel = budgetLabel[0]!.toUpperCase() + budgetLabel.slice(1);
  const benchmarkLabel = isGameBench ? GAME_BENCH.label : TERMINAL_BENCH.label;
  const named = [selectedRelease.name, compareRelease?.name].filter(Boolean).join(" and ");
  const inspectedRun = inspectedPoint?.run;
  const inspectedCost = inspectedRun && ("agent" in inspectedRun ? inspectedRun.costPerTaskUsd : inspectedRun.costPerProgramUsd);

  return (
    <div
      ref={containerRef}
      className="pareto-chart-wrap"
      data-benchmark={benchmark}
      onPointerMove={(e) => {
        if (e.pointerType === "touch") return;
        const nearest = findNearestPoint(e.clientX, e.clientY);
        setHoveredKey(nearest?.key ?? null);
      }}
      onPointerLeave={() => setHoveredKey(null)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        const nearest = findNearestPoint(e.clientX, e.clientY);
        if (!nearest) {
          setPinnedPeerKey(null);
          return;
        }
        const effort = isGameBench ? nearest.run.effort ?? undefined : undefined;
        if (nearest.release.slug === selectedRelease.slug) {
          setPinnedPeerKey(null);
          if (isGameBench) onSelectRelease(nearest.release.slug, effort);
          return;
        }
        const isTouch = window.matchMedia("(pointer: coarse)").matches;
        if (isTouch && pinnedPeerKey !== nearest.key) {
          setPinnedPeerKey(nearest.key);
        } else {
          setPinnedPeerKey(null);
          onSelectRelease(nearest.release.slug, effort);
        }
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={
          ariaLabel ??
          `${benchmarkLabel} score against ${budgetLabel} for ${series.size} models, with ${named} selected`
        }
        className="pareto-svg"
      >
        {yTicks.map((tick) => {
          const y = toY(tick);
          return (
            <g key={`y-${tick}`}>
              <line
                x1={pad.left}
                x2={pad.left + plotW}
                y1={y}
                y2={y}
                className="chart-gridline"
              />
              <text x={pad.left - 6} y={y + 3.5} textAnchor="end" className="chart-tick">
                {scoreUnit === "%" ? `${tick}%` : tick}
              </text>
            </g>
          );
        })}

        {xTicks.map((tick) => {
          const x = toX(tick);
          return (
            <g key={`x-${tick}`}>
              <line
                x1={x}
                x2={x}
                y1={pad.top}
                y2={pad.top + plotH}
                className="chart-gridline chart-gridline--vertical"
              />
              <text x={x} y={pad.top + plotH + 15} textAnchor="middle" className="chart-tick">
                {axis === "cost" ? formatUsdTick(tick) : formatTokensTick(tick)}
              </text>
            </g>
          );
        })}

        <g transform={`translate(${pad.left + 2}, ${pad.top - 8})`}>
          <line x1={0} x2={14} y1={-3} y2={-3} className="pareto-frontier-line" />
          <text x={18} y={0} className="chart-axis-hint">
            Pareto frontier
          </text>
        </g>
        <text x={pad.left + plotW} y={height - 2} textAnchor="end" className="chart-axis-hint">
          {axisLabel} (log)
        </text>

        {frontierPath && <path d={frontierPath} fill="none" className="pareto-frontier-line" />}

        {peerSeries.map((points) => {
          const { release, provider } = points[0]!;
          const isInspected = inspectedPoint?.release.slug === release.slug;
          return (
            <g
              key={release.slug}
              className={`peer-series peer-series--${provider}${isInspected ? " is-hovered" : ""}`}
            >
              {points.length > 1 && <polyline points={curve(points)} className="peer-curve" />}
              {points.map((p) => {
                const onFront = frontierKeySet.has(p.key);
                return (
                  <circle
                    key={p.key}
                    cx={toX(p.budget)}
                    cy={toY(p.score)}
                    r={inspectedKey === p.key ? 5.4 : onFront ? 4.4 : 3.6}
                    className={`peer-dot${onFront ? " is-frontier" : ""}`}
                  />
                );
              })}
            </g>
          );
        })}

        {[comparePoints, selectedPoints].map((points) => {
          if (!points.length) return null;
          const { release, provider } = points[0]!;
          return (
            <g
              key={release.slug}
              className={`hero-series hero-series--${provider}${points === selectedPoints ? "" : " hero-series--compare"}`}
            >
              {points.length > 1 && <polyline points={curve(points)} className="hero-curve" />}
              {points.map((p) => {
                const isSelected = p === selectedPoint;
                const x = toX(p.budget);
                const y = toY(p.score);
                const tag = tagPositions.get(p.key);
                return (
                  <g key={p.key}>
                    {isSelected && <circle cx={x} cy={y} r={10.5} className="hero-dot-active-halo" />}
                    {qualifiedFrontierSet.has(p.key) && !isSelected && (
                      <circle cx={x} cy={y} r={7.5} className="hero-dot-frontier-ring" />
                    )}
                    <circle cx={x} cy={y} r={isSelected ? 6.2 : 5}
                      className={`hero-dot${isSelected ? " is-active" : ""}`} />
                    {tag && (
                      <text x={tag.x} y={tag.y} textAnchor="middle"
                        className={`hero-tag${isSelected ? " is-active" : ""}`}>
                        {pointTag(p)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      {inspectedPoint && inspectedRun && tooltipPos && (
        <div
          className={`chart-tooltip chart-tooltip--${inspectedPoint.provider}`}
          style={{ left: tooltipPos.left, top: tooltipPos.top }}
        >
          <div className="chart-tooltip__head">
            <ProviderLogo provider={inspectedPoint.provider} size={13} />
            <span className="chart-tooltip__name">{shortModelName(inspectedPoint.release.name)}</span>
            <span className="chart-tooltip__agent">
              {"agent" in inspectedRun ? inspectedRun.agent : effortName(inspectedRun.effort)}
            </span>
            {qualifiedFrontierSet.has(inspectedPoint.key) && (
              <span className="chart-tooltip__frontier">
                <FrontierStarIcon size={8} />
                Frontier
              </span>
            )}
          </div>
          <div className="chart-tooltip__metrics">
            <strong>{formatScore(inspectedPoint.score, scoreUnit)}</strong>
            {inspectedCost != null && (
              <>
                <span>·</span>
                <span>{formatUsd(inspectedCost)}</span>
              </>
            )}
            {"agent" in inspectedRun && (
              <>
                <span>·</span>
                <span>{formatTokens(inspectedRun.tokensPerTask.output)} out</span>
              </>
            )}
          </div>
          {inspectedPoint.release.slug !== selectedRelease.slug && pinnedPeerKey === inspectedPoint.key && (
            <div className="chart-tooltip__delta">
              <button
                type="button"
                className="chart-tooltip__jump"
                onClick={() => {
                  setPinnedPeerKey(null);
                  onSelectRelease(inspectedPoint.release.slug, isGameBench ? inspectedRun.effort ?? undefined : undefined);
                }}
              >
                Select model →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
