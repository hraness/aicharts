"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { layoutChartLabels } from "@/lib/chart-label-layout";
import {
  logScale,
  logTicks,
  paddedLogDomain,
  type IntelligenceEfficiencyMetric,
  type NumericDomain,
} from "@/lib/intelligence-efficiency";
import { captureChartEvent } from "@/lib/analytics";
import {
  clientPointThroughSvgBounds,
  clientPointThroughSvgTransform,
  isAssistiveSvgClick,
  svgUnitsForCssPixels,
  type SvgPointerLocation,
} from "@/lib/svg-pointer-routing";

export type IntelligenceEfficiencyExplorerDatum = Readonly<{
  costUsdPerTask: number;
  creatorId: string;
  creatorName: string;
  detailsUrl: string;
  id: string;
  intelligenceIndex: number;
  isCostFrontier: boolean;
  isOutputFrontier: boolean;
  name: string;
  outputTokensPerTask: number;
  releaseDate: string;
}>;

type ExplorerPoint = Readonly<{
  datum: IntelligenceEfficiencyExplorerDatum;
  id: string;
  x: number;
  xValue: number;
  y: number;
}>;

type ExplorerPlot = Readonly<{
  bottom: number;
  left: number;
  right: number;
  top: number;
}>;

type ExplorerGeometry = Readonly<{
  chartHeight: number;
  compact: boolean;
  plot: ExplorerPlot;
  points: readonly ExplorerPoint[];
  xDomain: NumericDomain;
}>;

type SvgCoordinateEvent = Readonly<{
  clientX: number;
  clientY: number;
  currentTarget: SVGSVGElement;
}>;

type PointNavigationKey = "ArrowDown" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "End" | "Home";

type MetricPresentation = Readonly<{
  axisLabel: string;
  controlLabel: string;
  formatTick: (value: number) => string;
  inspectorLabel: string;
}>;

const DEFAULT_CHART_WIDTH = 920;
const DESKTOP_CHART_HEIGHT = 430;
const MOBILE_CHART_HEIGHT = 350;
const MIN_CHART_WIDTH = 288;
const CHART_COORDINATE_SCALE = 100;
const POINTER_HIT_RADIUS_CSS = 24;

const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const tokenFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});
const indexFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

/** Keep browser and server math-library tails out of serialized SVG geometry. */
export function roundIntelligenceChartCoordinate(value: number): number {
  const rounded = Math.round(value * CHART_COORDINATE_SCALE) / CHART_COORDINATE_SCALE;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function shouldPreviewIntelligencePointer(pointerType: string): boolean {
  return pointerType !== "touch";
}

function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? String(millions) : millions.toFixed(1)}m`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${Number.isInteger(thousands) ? String(thousands) : thousands.toFixed(1)}k`;
  }
  return integerFormatter.format(value);
}

function formatCompactUsd(value: number): string {
  if (value >= 100) return `$${integerFormatter.format(value)}`;
  if (value >= 10) return `$${value.toFixed(0)}`;
  if (value >= 1) return `$${Number.isInteger(value) ? String(value) : value.toFixed(1)}`;
  if (value >= .1) return `$${value.toFixed(2)}`;
  if (value >= .01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function formatExactUsd(value: number): string {
  if (value < .01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

const metricPresentations: Readonly<Record<IntelligenceEfficiencyMetric, MetricPresentation>> = {
  costUsdPerTask: {
    axisLabel: "Cost per task (USD, log scale)",
    controlLabel: "Task cost",
    formatTick: formatCompactUsd,
    inspectorLabel: "Cost per task",
  },
  outputTokensPerTask: {
    axisLabel: "Output tokens per task (log scale)",
    controlLabel: "Output tokens",
    formatTick: formatCompactTokens,
    inspectorLabel: "Output tokens per task",
  },
};

function isPointNavigationKey(key: string): key is PointNavigationKey {
  return key === "ArrowDown"
    || key === "ArrowLeft"
    || key === "ArrowRight"
    || key === "ArrowUp"
    || key === "End"
    || key === "Home";
}

export function nextIntelligencePointId(
  points: readonly Readonly<{ id: string; x: number; y: number }>[],
  currentId: string,
  key: PointNavigationKey,
): string {
  if (key === "Home") return points[0]?.id ?? currentId;
  if (key === "End") return points.at(-1)?.id ?? currentId;
  const current = points.find(point => point.id === currentId);
  if (current === undefined) return points[0]?.id ?? currentId;

  let best: Readonly<{ id: string; score: number }> | null = null;
  for (const candidate of points) {
    if (candidate.id === current.id) continue;
    const deltaX = candidate.x - current.x;
    const deltaY = candidate.y - current.y;
    const primary = key === "ArrowLeft" ? -deltaX
      : key === "ArrowRight" ? deltaX
      : key === "ArrowUp" ? -deltaY
      : deltaY;
    if (primary <= 0) continue;
    const crossAxis = key === "ArrowLeft" || key === "ArrowRight"
      ? Math.abs(deltaY)
      : Math.abs(deltaX);
    const score = Math.hypot(primary, crossAxis) + crossAxis * .65;
    if (best === null || score < best.score) best = { id: candidate.id, score };
  }
  return best?.id ?? currentId;
}

function linearScale(domain: NumericDomain, range: NumericDomain): (value: number) => number {
  const domainSpan = domain[1] - domain[0];
  const rangeSpan = range[1] - range[0];
  return value => range[0] + ((value - domain[0]) / domainSpan) * rangeSpan;
}

function metricValue(
  datum: IntelligenceEfficiencyExplorerDatum,
  metric: IntelligenceEfficiencyMetric,
): number {
  return metric === "outputTokensPerTask"
    ? datum.outputTokensPerTask
    : datum.costUsdPerTask;
}

export function projectIntelligenceExplorerGeometry(
  data: readonly IntelligenceEfficiencyExplorerDatum[],
  metric: IntelligenceEfficiencyMetric,
  yDomain: NumericDomain,
  chartWidth: number,
): ExplorerGeometry {
  const compact = chartWidth < 560;
  const chartHeight = compact ? MOBILE_CHART_HEIGHT : DESKTOP_CHART_HEIGHT;
  const plot = {
    bottom: chartHeight - 52,
    left: compact ? 42 : 52,
    right: chartWidth - (compact ? 10 : 18),
    top: 28,
  } as const;
  const values = data.map(datum => metricValue(datum, metric));
  const xDomain = paddedLogDomain(values);
  const scaleX = logScale(xDomain, [plot.left, plot.right]);
  const scaleY = linearScale(yDomain, [plot.bottom, plot.top]);
  const points = data.map((datum, index): ExplorerPoint => ({
    datum,
    id: datum.id,
    x: roundIntelligenceChartCoordinate(scaleX(values[index] ?? 1)),
    xValue: values[index] ?? 1,
    y: roundIntelligenceChartCoordinate(scaleY(datum.intelligenceIndex)),
  }));
  return { chartHeight, compact, plot, points, xDomain };
}

/** Resolve dense pointer input by geometry rather than SVG paint/DOM order. */
export function nearestIntelligencePointId(
  points: readonly Readonly<{ id: string; x: number; y: number }>[],
  x: number,
  y: number,
  maximumDistance = 18,
): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(maximumDistance) || maximumDistance < 0) {
    return null;
  }
  let best: Readonly<{ distanceSquared: number; id: string }> | null = null;
  for (const point of points) {
    const distanceSquared = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (
      best === null
      || distanceSquared < best.distanceSquared
      || (distanceSquared === best.distanceSquared && point.id.localeCompare(best.id) < 0)
    ) {
      best = { distanceSquared, id: point.id };
    }
  }
  return best !== null && best.distanceSquared <= maximumDistance ** 2 ? best.id : null;
}

function svgCoordinates(
  event: SvgCoordinateEvent,
  chartWidth: number,
  chartHeight: number,
): SvgPointerLocation | null {
  const svg = event.currentTarget;
  const matrix = svg.getScreenCTM();
  if (matrix !== null) {
    const transformed = clientPointThroughSvgTransform(event.clientX, event.clientY, matrix);
    if (transformed !== null) return transformed;
  }
  const bounds = svg.getBoundingClientRect();
  return clientPointThroughSvgBounds(event.clientX, event.clientY, bounds, chartWidth, chartHeight);
}

function isFrontier(
  datum: IntelligenceEfficiencyExplorerDatum,
  metric: IntelligenceEfficiencyMetric,
): boolean {
  return metric === "outputTokensPerTask" ? datum.isOutputFrontier : datum.isCostFrontier;
}

function pathThrough(points: readonly Readonly<{ x: number; y: number }>[]): string {
  return points.map((point, index) => (
    `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  )).join(" ");
}

function frontierPath(points: readonly ExplorerPoint[], metric: IntelligenceEfficiencyMetric): readonly ExplorerPoint[] {
  const ordered = points
    .filter(point => isFrontier(point.datum, metric))
    .toSorted((left, right) => (
      left.xValue - right.xValue
      || right.datum.intelligenceIndex - left.datum.intelligenceIndex
      || left.id.localeCompare(right.id)
    ));
  const path: ExplorerPoint[] = [];
  for (const point of ordered) {
    const previous = path.at(-1);
    if (
      previous !== undefined
      && previous.xValue === point.xValue
      && previous.datum.intelligenceIndex === point.datum.intelligenceIndex
    ) continue;
    if (previous === undefined || point.datum.intelligenceIndex > previous.datum.intelligenceIndex) {
      path.push(point);
    }
  }
  return path;
}

function chartLabel(datum: IntelligenceEfficiencyExplorerDatum, compact: boolean): string {
  const label = datum.name;
  const maximumLength = compact ? 22 : 31;
  return label.length <= maximumLength ? label : `${label.slice(0, maximumLength - 1)}…`;
}

function labelWidth(label: string, compact: boolean): number {
  return Math.min(compact ? 150 : 205, Math.max(64, label.length * (compact ? 5.6 : 6.1) + 10));
}

function closestLabelEdge(
  point: Readonly<{ x: number; y: number }>,
  placement: Readonly<{ height: number; width: number; x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
  return {
    x: roundIntelligenceChartCoordinate(
      Math.max(placement.x, Math.min(point.x, placement.x + placement.width)),
    ),
    y: roundIntelligenceChartCoordinate(
      Math.max(placement.y, Math.min(point.y, placement.y + placement.height)),
    ),
  };
}

function pointClassName(
  point: ExplorerPoint,
  metric: IntelligenceEfficiencyMetric,
  activeId: string,
  astraId: string | null,
  solId: string | null,
): string {
  return [
    "intelligence-efficiency__point-control",
    isFrontier(point.datum, metric) ? "intelligence-efficiency__point-control--frontier" : "",
    point.id === astraId ? "intelligence-efficiency__point-control--astra" : "",
    point.id === solId ? "intelligence-efficiency__point-control--sol" : "",
    point.id === activeId ? "intelligence-efficiency__point-control--active" : "",
  ].filter(Boolean).join(" ");
}

function PointGlyph({
  isAstra,
  isSol,
  point,
}: Readonly<{
  isAstra: boolean;
  isSol: boolean;
  point: ExplorerPoint;
}>) {
  if (isAstra) {
    return (
      <rect
        className="intelligence-efficiency__point-glyph"
        height="9"
        width="9"
        x={roundIntelligenceChartCoordinate(point.x - 4.5)}
        y={roundIntelligenceChartCoordinate(point.y - 4.5)}
      />
    );
  }
  if (isSol) {
    return (
      <path
        className="intelligence-efficiency__point-glyph"
        d={`M ${point.x.toFixed(2)} ${(point.y - 5).toFixed(2)} L ${(point.x + 5).toFixed(2)} ${(point.y + 4).toFixed(2)} L ${(point.x - 5).toFixed(2)} ${(point.y + 4).toFixed(2)} Z`}
      />
    );
  }
  return <circle className="intelligence-efficiency__point-glyph" cx={point.x} cy={point.y} r="3" />;
}

function pointAccessibleLabel(datum: IntelligenceEfficiencyExplorerDatum): string {
  return [
    datum.name,
    datum.creatorName,
    `Intelligence Index ${indexFormatter.format(datum.intelligenceIndex)}`,
    `${tokenFormatter.format(datum.outputTokensPerTask)} output tokens per task`,
    `${formatExactUsd(datum.costUsdPerTask)} per task`,
  ].join(", ");
}

export function IntelligenceEfficiencyExplorer({
  astraId,
  data,
  solId,
  yDomain,
}: Readonly<{
  astraId: string | null;
  data: readonly IntelligenceEfficiencyExplorerDatum[];
  solId: string | null;
  yDomain: NumericDomain;
}>) {
  const [metric, setMetric] = useState<IntelligenceEfficiencyMetric>("outputTokensPerTask");
  const defaultPointId = astraId ?? data[0]?.id ?? "";
  const [pinnedId, setPinnedId] = useState(defaultPointId);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [rovingId, setRovingId] = useState(defaultPointId);
  const [chartWidth, setChartWidth] = useState(DEFAULT_CHART_WIDTH);
  const chartShellRef = useRef<HTMLDivElement>(null);
  const pointRefs = useRef<Map<string, SVGGElement>>(new Map());
  const titleId = useId();
  const descriptionId = useId();
  const inspectorTitleId = useId();

  useEffect(() => {
    const shell = chartShellRef.current;
    if (shell === null || typeof ResizeObserver === "undefined") return;
    const updateWidth = (width: number) => {
      const nextWidth = Math.max(MIN_CHART_WIDTH, Math.round(width));
      setChartWidth(current => current === nextWidth ? current : nextWidth);
    };
    updateWidth(shell.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry !== undefined) updateWidth(entry.contentRect.width);
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(
    () => projectIntelligenceExplorerGeometry(data, metric, yDomain, chartWidth),
    [chartWidth, data, metric, yDomain],
  );
  const { chartHeight, compact, plot, points, xDomain } = geometry;
  const activeId = hoveredId ?? focusedId ?? pinnedId;
  const activeDatum = data.find(datum => datum.id === activeId) ?? data[0];
  const labeledPoints = useMemo(() => {
    const ids = new Set([astraId, solId, activeId].filter((id): id is string => id !== null && id !== ""));
    return points.filter(point => ids.has(point.id));
  }, [activeId, astraId, points, solId]);
  const labels = useMemo(() => layoutChartLabels(
    labeledPoints.map(point => {
      const label = chartLabel(point.datum, compact);
      return {
        height: 19,
        id: point.id,
        priority: point.id === activeId ? 3 : point.id === astraId ? 2 : 1,
        width: labelWidth(label, compact),
        x: point.x,
        y: point.y,
      };
    }),
    {
      bottom: plot.bottom - 4,
      left: plot.left + 3,
      right: plot.right - 3,
      top: plot.top + 3,
    },
    {
      gap: 4,
      maxRings: 12,
      offset: 9,
      obstacles: labeledPoints.map(point => ({ height: 12, width: 12, x: point.x - 6, y: point.y - 6 })),
    },
  ), [activeId, astraId, compact, labeledPoints, plot]);
  const pathPoints = useMemo(() => frontierPath(points, metric), [metric, points]);
  const xTicks = useMemo(() => logTicks(xDomain, compact ? 4 : 6), [compact, xDomain]);
  const yTicks = useMemo(() => Array.from(
    { length: Math.floor(yDomain[1] / 10) + 1 },
    (_, index) => index * 10,
  ), [yDomain]);
  const scaleX = useMemo(() => logScale(xDomain, [plot.left, plot.right]), [plot, xDomain]);
  const scaleY = useMemo(() => linearScale(yDomain, [plot.bottom, plot.top]), [plot, yDomain]);
  const presentation = metricPresentations[metric];

  function pinPoint(pointId: string): void {
    setPinnedId(pointId);
    setRovingId(pointId);
    const point = data.find(datum => datum.id === pointId);
    if (point !== undefined) {
      captureChartEvent({
        name: "chart selection pinned",
        properties: {
          chart_id: "intelligence_efficiency",
          provider_id: point.creatorId,
          selection_kind: "model",
        },
      });
    }
  }

  function handlePointKeyDown(event: KeyboardEvent<SVGGElement>, pointId: string): void {
    if (isPointNavigationKey(event.key)) {
      event.preventDefault();
      const nextId = nextIntelligencePointId(points, pointId, event.key);
      setRovingId(nextId);
      setFocusedId(nextId);
      pointRefs.current.get(nextId)?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pinPoint(pointId);
    }
  }

  function pointForEvent(event: SvgCoordinateEvent): string | null {
    const coordinates = svgCoordinates(event, chartWidth, chartHeight);
    if (coordinates === null) return null;
    const maximumDistance = svgUnitsForCssPixels(
      POINTER_HIT_RADIUS_CSS,
      coordinates.unitsPerCssPixel,
    );
    return maximumDistance === null
      ? null
      : nearestIntelligencePointId(points, coordinates.x, coordinates.y, maximumDistance);
  }

  function handlePlotPointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    if (!shouldPreviewIntelligencePointer(event.pointerType)) return;
    setHoveredId(pointForEvent(event));
  }

  return (
    <div className="intelligence-efficiency__explorer">
      <figure className="intelligence-efficiency__figure">
        <figcaption className="intelligence-efficiency__figure-header">
          <div>
            <h3>Capability vs. resource use</h3>
            <p>Higher and farther left is better. Select a point for exact values.</p>
          </div>
          <div aria-label="Compare capability by" className="intelligence-efficiency__metric-control" role="group">
            {(Object.keys(metricPresentations) as IntelligenceEfficiencyMetric[]).toReversed().map(item => (
              <button
                aria-pressed={metric === item}
                data-intelligence-metric={item}
                key={item}
                onClick={() => {
                  if (item !== metric) {
                    captureChartEvent({
                      name: "chart metric selected",
                      properties: {
                        axis: "x",
                        chart_id: "intelligence_efficiency",
                        metric: item,
                      },
                    });
                  }
                  setMetric(item);
                }}
                type="button"
              >
                {metricPresentations[item].controlLabel}
              </button>
            ))}
          </div>
        </figcaption>

        <div className="intelligence-efficiency__plot" ref={chartShellRef}>
          <svg
            aria-describedby={descriptionId}
            aria-labelledby={titleId}
            className="intelligence-efficiency__svg"
            height={chartHeight}
            onClick={event => {
              const pointId = pointForEvent(event);
              if (pointId !== null) pinPoint(pointId);
            }}
            onPointerCancel={() => setHoveredId(null)}
            onPointerLeave={() => setHoveredId(null)}
            onPointerMove={handlePlotPointerMove}
            role="group"
            style={hoveredId === null ? undefined : { cursor: "pointer" }}
            viewBox={`0 0 ${String(chartWidth)} ${String(chartHeight)}`}
          >
            <title id={titleId}>{`Artificial Analysis Intelligence Index by ${presentation.inspectorLabel.toLowerCase()}`}</title>
            <desc id={descriptionId}>
              {`${data.length} model configurations. Use arrow keys to move between points, then Enter or Space to pin a selection. The horizontal axis uses a logarithmic scale.`}
            </desc>

            <g aria-hidden="true" className="intelligence-efficiency__grid">
              {yTicks.map(tick => {
                const tickY = roundIntelligenceChartCoordinate(scaleY(tick));
                return (
                  <g key={tick}>
                    <line x1={plot.left} x2={plot.right} y1={tickY} y2={tickY} />
                    <text textAnchor="end" x={plot.left - 9} y={roundIntelligenceChartCoordinate(tickY + 4)}>{tick}</text>
                  </g>
                );
              })}
            </g>

            <g aria-hidden="true" className="intelligence-efficiency__axis">
              <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} />
              {xTicks.map(tick => {
                const tickX = roundIntelligenceChartCoordinate(scaleX(tick));
                return (
                  <g key={tick}>
                    <line x1={tickX} x2={tickX} y1={plot.bottom} y2={plot.bottom + 5} />
                    <text textAnchor="middle" x={tickX} y={plot.bottom + 19}>
                      {presentation.formatTick(tick)}
                    </text>
                  </g>
                );
              })}
              <text className="intelligence-efficiency__axis-title" textAnchor="middle" x={(plot.left + plot.right) / 2} y={chartHeight - 12}>
                {presentation.axisLabel}
              </text>
              <text className="intelligence-efficiency__y-title" x={plot.left + 2} y={plot.top - 9}>Intelligence Index ↑</text>
            </g>

            {pathPoints.length < 2 ? null : (
              <path
                aria-hidden="true"
                className="intelligence-efficiency__frontier-line"
                d={pathThrough(pathPoints)}
              />
            )}

            <g className="intelligence-efficiency__points">
              {points.map(point => (
                <g
                  aria-label={pointAccessibleLabel(point.datum)}
                  aria-pressed={pinnedId === point.id}
                  className={pointClassName(point, metric, activeId, astraId, solId)}
                  data-point-id={point.id}
                  key={point.id}
                  onBlur={() => setFocusedId(current => current === point.id ? null : current)}
                  onClick={event => {
                    if (!isAssistiveSvgClick(event.detail)) return;
                    event.stopPropagation();
                    pinPoint(point.id);
                  }}
                  onFocus={() => {
                    setRovingId(point.id);
                    setFocusedId(point.id);
                  }}
                  onKeyDown={event => handlePointKeyDown(event, point.id)}
                  ref={element => {
                    if (element === null) pointRefs.current.delete(point.id);
                    else pointRefs.current.set(point.id, element);
                  }}
                  role="button"
                  tabIndex={rovingId === point.id ? 0 : -1}
                >
                  <circle aria-hidden="true" className="intelligence-efficiency__point-hit" cx={point.x} cy={point.y} r="12" />
                  <PointGlyph
                    isAstra={point.id === astraId}
                    isSol={point.id === solId}
                    point={point}
                  />
                  {point.id === activeId ? (
                    <circle aria-hidden="true" className="intelligence-efficiency__point-ring" cx={point.x} cy={point.y} r="8" />
                  ) : null}
                </g>
              ))}
            </g>

            <g aria-hidden="true" className="intelligence-efficiency__labels">
              {labeledPoints.map(point => {
                const placement = labels.get(point.id);
                if (placement === undefined) return null;
                const edge = closestLabelEdge(point, placement);
                return (
                  <g key={point.id}>
                    <line x1={point.x} x2={edge.x} y1={point.y} y2={edge.y} />
                    <text
                      className={point.id === activeId ? "intelligence-efficiency__label--active" : undefined}
                      x={roundIntelligenceChartCoordinate(placement.x + 5)}
                      y={roundIntelligenceChartCoordinate(placement.y + 13)}
                    >
                      {chartLabel(point.datum, compact)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        <div className="intelligence-efficiency__chart-key">
          <span><i data-symbol="context" />Configuration</span>
          <span><i data-symbol="frontier" />Efficiency frontier</span>
          <span className="intelligence-efficiency__interaction-hint">Hover, focus, or tap a point · arrow keys move</span>
        </div>
      </figure>

      {activeDatum === undefined ? null : (
        <aside aria-labelledby={inspectorTitleId} className="intelligence-efficiency__inspector">
          <p className="intelligence-efficiency__inspector-state">
            {activeId === pinnedId ? "Selected configuration" : "Point preview"}
          </p>
          <h4 id={inspectorTitleId}>{activeDatum.name}</h4>
          <p className="intelligence-efficiency__inspector-meta">
            {activeDatum.creatorName} · released <time dateTime={activeDatum.releaseDate}>{activeDatum.releaseDate}</time>
          </p>
          <dl>
            <div>
              <dt>Intelligence Index</dt>
              <dd><data value={activeDatum.intelligenceIndex}>{indexFormatter.format(activeDatum.intelligenceIndex)}</data></dd>
            </div>
            <div className={metric === "outputTokensPerTask" ? "is-active" : undefined}>
              <dt>Output tokens / task</dt>
              <dd><data value={activeDatum.outputTokensPerTask}>{tokenFormatter.format(activeDatum.outputTokensPerTask)}</data></dd>
            </div>
            <div className={metric === "costUsdPerTask" ? "is-active" : undefined}>
              <dt>Cost / task</dt>
              <dd><data value={activeDatum.costUsdPerTask}>{formatExactUsd(activeDatum.costUsdPerTask)}</data></dd>
            </div>
          </dl>
          <p className="intelligence-efficiency__frontier-status">
            {isFrontier(activeDatum, metric)
              ? `On the ${presentation.controlLabel.toLowerCase()} efficiency frontier.`
              : `Not on the ${presentation.controlLabel.toLowerCase()} efficiency frontier.`}
          </p>
          <a
            data-analytics-destination-id="source:artificial-analysis"
            data-analytics-destination-kind="source"
            href={activeDatum.detailsUrl}
          >
            View publisher record ↗
          </a>
        </aside>
      )}
    </div>
  );
}
