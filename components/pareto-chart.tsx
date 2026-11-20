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
  buildPlottedPoints,
  computeParetoFrontier,
  getPointBudget,
  getPointScore,
  getQualifiedFrontierKeys,
  type ChartScale,
  type PlottedPoint,
} from "@/lib/pareto";
import type {
  BenchmarkMeta,
  BudgetAxis,
  EffortSlug,
  ModelRelease,
} from "@/lib/types";

const COST_TICKS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50];
const TOKEN_TICKS = [2000, 5000, 10000, 20000, 50000, 100000, 200000, 400000];

type Box = { x1: number; y1: number; x2: number; y2: number };

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

export function ParetoChart({
  releases,
  selectedRelease,
  compareRelease = null,
  activeEffortSlug,
  benchmark,
  axis,
  onSelectEffort,
  onSelectRelease,
  showTokens = true,
  ariaLabel,
  scale,
}: Readonly<{
  releases: readonly ModelRelease[];
  selectedRelease: ModelRelease;
  /** A second release drawn as an emphasized dashed curve, for head-to-head pages. */
  compareRelease?: ModelRelease | null;
  activeEffortSlug: EffortSlug;
  benchmark: BenchmarkMeta;
  axis: BudgetAxis;
  onSelectEffort: (slug: EffortSlug) => void;
  onSelectRelease: (slug: string) => void;
  /** Hide output tokens in the tooltip, for points whose token counts don't apply. */
  showTokens?: boolean;
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
  }, [selectedRelease.slug, benchmark.id, axis]);

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

  const allPoints = useMemo(
    () => buildPlottedPoints(releases, benchmark.id, axis),
    [releases, benchmark.id, axis],
  );

  const frontier = useMemo(() => computeParetoFrontier(allPoints), [allPoints]);
  const frontierKeySet = useMemo(() => new Set(frontier.map((p) => p.key)), [frontier]);
  const qualifiedFrontierSet = useMemo(() => getQualifiedFrontierKeys(frontier), [frontier]);

  const { logMin, logMax, yMin, yMax, xTicks, yTicks } = useMemo(() => {
    const fixed = scale?.[axis][benchmark.id];
    const budgets = [...allPoints.map((p) => p.budget), ...(fixed?.budget ?? [])];
    const scores = [...allPoints.map((p) => p.score), ...(fixed?.score ?? [])];
    const minB = budgets.length > 0 ? Math.min(...budgets) : 0.01;
    const maxB = budgets.length > 0 ? Math.max(...budgets) : 30;
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
  }, [allPoints, scale, benchmark.id, axis, isCompact, pad.left, plotW]);

  const toX = (budget: number) =>
    pad.left + ((Math.log10(budget) - logMin) / (logMax - logMin)) * plotW;
  const toY = (score: number) =>
    pad.top + (1 - (score - yMin) / Math.max(1, yMax - yMin)) * plotH;

  const inspectedKey = hoveredKey ?? pinnedPeerKey;
  const pointByKey = useMemo(() => new Map(allPoints.map((p) => [p.key, p])), [allPoints]);
  const inspectedPoint = inspectedKey ? (pointByKey.get(inspectedKey) ?? null) : null;
  const hoveredReleaseSlug = inspectedPoint?.release.slug ?? null;

  const seriesList = useMemo(() => {
    return releases.map((rel) => {
      const pts = rel.efforts
        .map((eff) => {
          const budget = getPointBudget(eff, axis);
          const score = getPointScore(eff, benchmark.id);
          return {
            key: `${rel.slug}:${eff.effortSlug}`,
            effort: eff,
            budget,
            score,
            x: toX(budget),
            y: toY(score),
          };
        })
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      return { release: rel, pts };
    });
  }, [releases, axis, benchmark.id, logMin, logMax, yMin, yMax, plotW, plotH, isCompact]);

  const selectedSeries = seriesList.find((s) => s.release.slug === selectedRelease.slug);
  const compareSlug = compareRelease?.slug ?? null;
  const compareSeries = compareSlug
    ? seriesList.find((s) => s.release.slug === compareSlug)
    : undefined;
  const peerSeries = seriesList.filter(
    (s) => s.release.slug !== selectedRelease.slug && s.release.slug !== compareSlug,
  );

  // Collision-free effort labels for the emphasized curves only
  const effortTagPositions = useMemo(() => {
    const occupied: Box[] = [];
    const tagMap = new Map<string, { x: number; y: number }>();
    const labelled = [selectedSeries, compareSeries].filter(
      (series): series is NonNullable<typeof series> => !!series && series.pts.length > 0,
    );
    for (const series of labelled) {
      for (const p of series.pts) {
        occupied.push({ x1: p.x - 7, y1: p.y - 7, x2: p.x + 7, y2: p.y + 7 });
      }
    }

    for (const series of labelled) {
      const isSelected = series === selectedSeries;
      const pts = series.pts;
      const firstKey = pts[0]!.key;
      const lastKey = pts[pts.length - 1]!.key;
      const ordered = [...pts].sort((a, b) => {
        const prio = (pt: (typeof pts)[number]) => {
          if (isSelected && pt.effort.effortSlug === activeEffortSlug) return 0;
          if (pt.key === lastKey || pt.key === firstKey) return 1;
          return 2;
        };
        return prio(a) - prio(b);
      });

      for (const p of ordered) {
        const w = p.effort.shortTag.length * 6.4 + 8;
        const h = 13;
        const candidates = [
          { x: p.x, y: p.y - 11 },
          { x: p.x, y: p.y + 18 },
          { x: p.x - 15, y: p.y - 8 },
          { x: p.x + 15, y: p.y + 15 },
        ];
        const mustShow = isSelected && p.effort.effortSlug === activeEffortSlug;
        let chosen: { x: number; y: number } | null = null;
        for (const c of candidates) {
          const box: Box = {
            x1: c.x - w / 2,
            y1: c.y - h + 2,
            x2: c.x + w / 2,
            y2: c.y + 2,
          };
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
        if (!chosen && mustShow) {
          chosen = candidates[0]!;
          occupied.push({
            x1: chosen.x - w / 2,
            y1: chosen.y - h + 2,
            x2: chosen.x + w / 2,
            y2: chosen.y + 2,
          });
        }
        if (chosen) {
          tagMap.set(p.key, chosen);
        }
      }
    }

    return tagMap;
  }, [selectedSeries, compareSeries, activeEffortSlug, pad.left, pad.top, plotW, plotH]);

  function findNearestPoint(clientX: number, clientY: number): PlottedPoint | null {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    let best: PlottedPoint | null = null;
    let bestDist = 26 * 26;
    for (const pt of allPoints) {
      const dx = toX(pt.budget) - mx;
      const dy = toY(pt.score) - my;
      const d2 = dx * dx + dy * dy;
      const emphasized =
        pt.release.slug === selectedRelease.slug || pt.release.slug === compareSlug;
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

  return (
    <div
      ref={containerRef}
      className="pareto-chart-wrap"
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
        if (nearest.release.slug === selectedRelease.slug) {
          setPinnedPeerKey(null);
          onSelectEffort(nearest.effort.effortSlug);
        } else {
          const isTouch = window.matchMedia("(pointer: coarse)").matches;
          if (isTouch && pinnedPeerKey !== nearest.key) {
            setPinnedPeerKey(nearest.key);
          } else {
            setPinnedPeerKey(null);
            onSelectRelease(nearest.release.slug);
          }
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
          `Pareto curve${compareRelease ? "s" : ""} for ${selectedRelease.name}${compareRelease ? ` and ${compareRelease.name}` : ""} comparing ${benchmark.fullLabel} against ${axis === "cost" ? "USD cost per task" : "output tokens per task"}`
        }
        className="pareto-svg"
      >
        {/* Horizontal Y Gridlines & Labels */}
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
                {benchmark.unit === "%" ? `${tick}%` : tick}
              </text>
            </g>
          );
        })}

        {/* Vertical Log Budget Ticks */}
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
              <text
                x={x}
                y={pad.top + plotH + 15}
                textAnchor="middle"
                className="chart-tick"
              >
                {axis === "cost" ? formatUsdTick(tick) : formatTokensTick(tick)}
              </text>
            </g>
          );
        })}

        {/* Subtle Frontier Legend & Axis Label */}
        <g transform={`translate(${pad.left + 2}, ${pad.top - 8})`}>
          <line x1={0} x2={14} y1={-3} y2={-3} className="pareto-frontier-line" />
          <text x={18} y={0} className="chart-axis-hint">
            Pareto frontier
          </text>
        </g>
        <text
          x={pad.left + plotW}
          y={height - 2}
          textAnchor="end"
          className="chart-axis-hint"
        >
          {axis === "cost" ? "Cost per task (log)" : "Output tokens per task (log)"}
        </text>

        {/* Global Pareto Frontier */}
        {frontierPath && <path d={frontierPath} fill="none" className="pareto-frontier-line" />}

        {/* Peer Effort Curves */}
        {peerSeries.map(({ release, pts }) => {
          const isHoveredPeer = hoveredReleaseSlug === release.slug;
          const d =
            pts.length > 1
              ? pts
                  .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                  .join(" ")
              : "";

          return (
            <g
              key={release.slug}
              className={`peer-series peer-series--${release.provider}${isHoveredPeer ? " is-hovered" : ""}`}
            >
              {d && <path d={d} fill="none" className="peer-curve" />}
              {pts.map((p) => {
                const onFront = frontierKeySet.has(p.key);
                const isInspected = inspectedKey === p.key;
                return (
                  <circle
                    key={p.key}
                    cx={p.x}
                    cy={p.y}
                    r={isInspected ? 5.2 : onFront ? 3.8 : 2.9}
                    className={`peer-dot${onFront ? " is-frontier" : ""}`}
                  />
                );
              })}
            </g>
          );
        })}

        {/* Head-to-head release: dashed curve, hollow dots */}
        {compareSeries && compareRelease && (
          <g
            className={`hero-series hero-series--${compareRelease.provider} hero-series--compare`}
          >
            {compareSeries.pts.length > 1 && (
              <path
                d={compareSeries.pts
                  .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                  .join(" ")}
                fill="none"
                className="hero-curve"
              />
            )}
            {compareSeries.pts.map((p) => {
              const tagPos = effortTagPositions.get(p.key);
              return (
                <g key={p.key}>
                  {qualifiedFrontierSet.has(p.key) && (
                    <circle cx={p.x} cy={p.y} r={7.5} className="hero-dot-frontier-ring" />
                  )}
                  <circle cx={p.x} cy={p.y} r={4.4} className="hero-dot" />
                  {tagPos && (
                    <text x={tagPos.x} y={tagPos.y} textAnchor="middle" className="hero-effort-tag">
                      {p.effort.shortTag}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* Selected Release Hero Effort Curve */}
        {selectedSeries && (
          <g className={`hero-series hero-series--${selectedRelease.provider}`}>
            {selectedSeries.pts.length > 1 && (
              <>
                <path
                  d={selectedSeries.pts
                    .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                    .join(" ")}
                  fill="none"
                  className="hero-curve-glow"
                />
                <path
                  d={selectedSeries.pts
                    .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                    .join(" ")}
                  fill="none"
                  className="hero-curve"
                />
              </>
            )}

            {selectedSeries.pts.map((p) => {
              const isActive = p.effort.effortSlug === activeEffortSlug;
              const isOnFrontier = qualifiedFrontierSet.has(p.key);
              const tagPos = effortTagPositions.get(p.key);
              return (
                <g key={p.key}>
                  {isActive && (
                    <circle cx={p.x} cy={p.y} r={10.5} className="hero-dot-active-halo" />
                  )}
                  {isOnFrontier && !isActive && (
                    <circle cx={p.x} cy={p.y} r={7.5} className="hero-dot-frontier-ring" />
                  )}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isActive ? 6.2 : 4.8}
                    className={`hero-dot${isActive ? " is-active" : ""}`}
                  />
                  {tagPos && (
                    <text
                      x={tagPos.x}
                      y={tagPos.y}
                      textAnchor="middle"
                      className={`hero-effort-tag${isActive ? " is-active" : ""}`}
                    >
                      {p.effort.shortTag}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        )}
      </svg>

      {/* Floating Inspection Tooltip */}
      {inspectedPoint && tooltipPos && (
        <div
          className={`chart-tooltip chart-tooltip--${inspectedPoint.provider}`}
          style={{ left: tooltipPos.left, top: tooltipPos.top }}
        >
          <div className="chart-tooltip__head">
            <ProviderLogo provider={inspectedPoint.provider} size={13} />
            <span className="chart-tooltip__name">{shortModelName(inspectedPoint.release.name)}</span>
            <span className="chart-tooltip__effort">{inspectedPoint.effort.effortLabel}</span>
            {qualifiedFrontierSet.has(inspectedPoint.key) && (
              <span className="chart-tooltip__frontier">
                <FrontierStarIcon size={8} />
                Frontier
              </span>
            )}
          </div>
          <div className="chart-tooltip__metrics">
            <strong>{formatScore(inspectedPoint.score, benchmark.unit)}</strong>
            <span>·</span>
            <span>{formatUsd(inspectedPoint.effort.costUsdPerTask.total)}</span>
            {showTokens && (
              <>
                <span>·</span>
                <span>{formatTokens(inspectedPoint.effort.tokensPerTask.total)} tok</span>
              </>
            )}
          </div>
          {inspectedPoint.release.slug !== selectedRelease.slug &&
            pinnedPeerKey === inspectedPoint.key && (
              <div className="chart-tooltip__delta">
                <button
                  type="button"
                  className="chart-tooltip__jump"
                  onClick={() => {
                    setPinnedPeerKey(null);
                    onSelectRelease(inspectedPoint.release.slug);
                  }}
                >
                  Select release →
                </button>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
