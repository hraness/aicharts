"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ProviderLogo } from "./brand-icon";
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
  activeEffortSlug,
  benchmark,
  axis,
  onSelectEffort,
  onSelectRelease,
}: Readonly<{
  releases: readonly ModelRelease[];
  selectedRelease: ModelRelease;
  activeEffortSlug: EffortSlug;
  benchmark: BenchmarkMeta;
  axis: BudgetAxis;
  onSelectEffort: (slug: EffortSlug) => void;
  onSelectRelease: (slug: string) => void;
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

  // Clear pinned peer when selected release or axes change
  useEffect(() => {
    setPinnedPeerKey(null);
    setHoveredKey(null);
  }, [selectedRelease.slug, benchmark.id, axis]);

  const isCompact = width < 520;
  const height = isCompact ? 246 : 278;
  const pad = {
    top: 18,
    right: isCompact ? 14 : 22,
    bottom: 30,
    left: isCompact ? 34 : 40,
  };
  const plotW = Math.max(180, width - pad.left - pad.right);
  const plotH = Math.max(140, height - pad.top - pad.bottom);

  const allPoints = useMemo(
    () => buildPlottedPoints(releases, benchmark.id, axis),
    [releases, benchmark.id, axis],
  );

  const frontier = useMemo(() => computeParetoFrontier(allPoints), [allPoints]);
  const frontierKeySet = useMemo(() => new Set(frontier.map((p) => p.key)), [frontier]);

  const { logMin, logMax, yMin, yMax, xTicks, yTicks } = useMemo(() => {
    const budgets = allPoints.map((p) => p.budget);
    const scores = allPoints.map((p) => p.score);
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
    const minSpacingPx = isCompact ? 48 : 56;
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
  }, [allPoints, axis, isCompact, pad.left, plotW]);

  const toX = (budget: number) =>
    pad.left + ((Math.log10(budget) - logMin) / (logMax - logMin)) * plotW;
  const toY = (score: number) =>
    pad.top + (1 - (score - yMin) / Math.max(1, yMax - yMin)) * plotH;

  const inspectedKey = hoveredKey ?? pinnedPeerKey;
  const pointByKey = useMemo(() => new Map(allPoints.map((p) => [p.key, p])), [allPoints]);
  const inspectedPoint = inspectedKey ? (pointByKey.get(inspectedKey) ?? null) : null;
  const hoveredReleaseSlug = inspectedPoint?.release.slug ?? null;

  // Build series per release (ordered by effortLevel)
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
  const peerSeries = seriesList.filter((s) => s.release.slug !== selectedRelease.slug);

  // Compute collision-free labels:
  // 1) Selected model's effort tags (priority)
  // 2) Up to 5 frontier peer model names
  const { effortTagPositions, peerLabels } = useMemo(() => {
    const occupied: Box[] = [];
    const tagMap = new Map<string, { x: number; y: number }>();

    if (selectedSeries) {
      // Reserve circles along selected curve first
      for (const p of selectedSeries.pts) {
        occupied.push({ x1: p.x - 8, y1: p.y - 8, x2: p.x + 8, y2: p.y + 8 });
      }
      for (let i = 0; i < selectedSeries.pts.length; i++) {
        const p = selectedSeries.pts[i]!;
        const w = p.effort.shortTag.length * 6.2 + 8;
        const h = 13;
        const candidates = [
          { x: p.x, y: p.y - 12 },
          { x: p.x, y: p.y + 18 },
          { x: p.x - 14, y: p.y - 8 },
          { x: p.x + 14, y: p.y + 14 },
        ];
        let chosen = candidates[0]!;
        for (const c of candidates) {
          const box: Box = {
            x1: c.x - w / 2,
            y1: c.y - h + 2,
            x2: c.x + w / 2,
            y2: c.y + 2,
          };
          const inBounds =
            box.x1 >= pad.left &&
            box.x2 <= pad.left + plotW &&
            box.y1 >= pad.top - 4 &&
            box.y2 <= pad.top + plotH;
          if (inBounds && !occupied.some((o) => boxesOverlap(box, o))) {
            chosen = c;
            occupied.push(box);
            break;
          }
        }
        tagMap.set(p.key, chosen);
      }
    }

    const pLabels: Array<{
      slug: string;
      provider: ModelRelease["provider"];
      label: string;
      x: number;
      y: number;
      anchor: "start" | "end";
    }> = [];

    if (!isCompact) {
      // Label peer releases that touch the Pareto frontier (sorted by max score desc)
      const frontierPeers = peerSeries
        .filter((s) => s.pts.some((p) => frontierKeySet.has(p.key)))
        .sort((a, b) => {
          const maxA = Math.max(...a.pts.map((p) => p.score));
          const maxB = Math.max(...b.pts.map((p) => p.score));
          return maxB - maxA;
        })
        .slice(0, 5);

      for (const s of frontierPeers) {
        // Anchor near its highest frontier point
        const anchorPt =
          [...s.pts].reverse().find((p) => frontierKeySet.has(p.key)) ??
          s.pts[s.pts.length - 1];
        if (!anchorPt) continue;
        const label = shortModelName(s.release.name);
        const approxW = label.length * 5.8 + 6;
        const approxH = 12;
        const tryRight = anchorPt.x + approxW + 8 <= pad.left + plotW;
        const x = tryRight ? anchorPt.x + 7 : anchorPt.x - 7;
        const y = anchorPt.y + 3;
        const box: Box = tryRight
          ? { x1: x, y1: y - approxH, x2: x + approxW, y2: y + 2 }
          : { x1: x - approxW, y1: y - approxH, x2: x, y2: y + 2 };

        if (!occupied.some((o) => boxesOverlap(box, o))) {
          occupied.push(box);
          pLabels.push({
            slug: s.release.slug,
            provider: s.release.provider,
            label,
            x,
            y,
            anchor: tryRight ? "start" : "end",
          });
        }
      }
    }

    return { effortTagPositions: tagMap, peerLabels: pLabels };
  }, [selectedSeries, peerSeries, frontierKeySet, isCompact, pad.left, pad.top, plotW, plotH]);

  // Nearest-point pointer hit testing within 26px
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
      // Give slight tie-break priority to selected release points
      const weighted = pt.release.slug === selectedRelease.slug ? d2 * 0.75 : d2;
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
    // Subtle flat continuation to right edge showing ceiling
    const last = coords[coords.length - 1]!;
    if (last.x < pad.left + plotW - 6) {
      d += ` L ${(pad.left + plotW).toFixed(1)} ${last.y.toFixed(1)}`;
    }
    return d;
  }, [frontier, logMin, logMax, yMin, yMax, plotW, plotH, pad.left]);

  const activeSelectedPoint = useMemo(() => {
    return (
      allPoints.find(
        (p) =>
          p.release.slug === selectedRelease.slug && p.effort.effortSlug === activeEffortSlug,
      ) ?? null
    );
  }, [allPoints, selectedRelease.slug, activeEffortSlug]);

  // Tooltip coordinates clamped inside container
  const tooltipPos = useMemo(() => {
    if (!inspectedPoint) return null;
    const px = toX(inspectedPoint.budget);
    const py = toY(inspectedPoint.score);
    const cardW = 198;
    const left = px + cardW + 16 > width ? Math.max(8, px - cardW - 12) : px + 12;
    const top = Math.max(6, Math.min(height - 76, py - 28));
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
        // Ignore clicks on the tooltip action button itself
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
          // On coarse/touch pointers, pin tooltip first; on desktop mouse, select directly
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
        aria-label={`Pareto curve for ${selectedRelease.name} comparing ${benchmark.fullLabel} against ${axis === "cost" ? "USD cost per task" : "output tokens per task"}`}
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

        {/* Axis Micro-Captions */}
        <text x={pad.left + 2} y={pad.top - 5} className="chart-axis-hint">
          ↑ {benchmark.shortLabel} · ↖ Pareto frontier
        </text>
        <text
          x={pad.left + plotW}
          y={height - 3}
          textAnchor="end"
          className="chart-axis-hint"
        >
          {axis === "cost" ? "Cost / task (USD, log) →" : "Output tokens / task (log) →"}
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

        {/* Non-overlapping Frontier Peer Labels */}
        {peerLabels.map((lbl) => (
          <text
            key={lbl.slug}
            x={lbl.x}
            y={lbl.y}
            textAnchor={lbl.anchor}
            className={`peer-label peer-label--${lbl.provider}${hoveredReleaseSlug === lbl.slug ? " is-hovered" : ""}`}
          >
            {lbl.label}
          </text>
        ))}

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
              const isOnFrontier = frontierKeySet.has(p.key);
              const tagPos = effortTagPositions.get(p.key);
              return (
                <g key={p.key}>
                  {isActive && (
                    <circle cx={p.x} cy={p.y} r={10.5} className="hero-dot-active-halo" />
                  )}
                  {isOnFrontier && !isActive && (
                    <circle cx={p.x} cy={p.y} r={7.8} className="hero-dot-frontier-ring" />
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

      {/* Floating Inspection Callout */}
      {inspectedPoint && tooltipPos && (
        <div
          className={`chart-tooltip chart-tooltip--${inspectedPoint.provider}`}
          style={{ left: tooltipPos.left, top: tooltipPos.top }}
        >
          <div className="chart-tooltip__head">
            <span className={`tooltip-logo tooltip-logo--${inspectedPoint.provider}`}>
              <ProviderLogo provider={inspectedPoint.provider} size={11} />
            </span>
            <span className="chart-tooltip__name">{shortModelName(inspectedPoint.release.name)}</span>
            <span className="chart-tooltip__effort">{inspectedPoint.effort.effortLabel}</span>
            {frontierKeySet.has(inspectedPoint.key) && (
              <span className="chart-tooltip__frontier">Frontier</span>
            )}
          </div>
          <div className="chart-tooltip__metrics">
            <strong>{formatScore(inspectedPoint.score, benchmark.unit)}</strong>
            <span>·</span>
            <span>{formatUsd(inspectedPoint.effort.costUsdPerTask.total)}</span>
            <span>·</span>
            <span>{formatTokens(inspectedPoint.effort.tokensPerTask.total)} tok</span>
          </div>
          {inspectedPoint.release.slug !== selectedRelease.slug && activeSelectedPoint && (
            <div className="chart-tooltip__delta">
              <span>
                {inspectedPoint.score >= activeSelectedPoint.score ? "+" : ""}
                {(inspectedPoint.score - activeSelectedPoint.score).toFixed(1)} vs{" "}
                {shortModelName(selectedRelease.name)} ({activeEffortSlug})
              </span>
              {pinnedPeerKey === inspectedPoint.key && (
                <button
                  type="button"
                  className="chart-tooltip__jump"
                  onClick={() => {
                    setPinnedPeerKey(null);
                    onSelectRelease(inspectedPoint.release.slug);
                  }}
                >
                  Inspect →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
