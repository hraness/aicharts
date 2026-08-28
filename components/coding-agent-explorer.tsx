"use client";

import { chatGptSubsidyChartLabel } from "@/app/site";
import {
  Cancel01Icon,
  CopyLinkIcon,
  Download01Icon,
  ExternalLinkIcon,
  Image01Icon,
  Share08Icon,
} from "@hugeicons/core-free-icons";
import { NativeSelectField, type NativeSelectOption } from "@hraness/ui";
import {
  Icon,
  IconButton,
  LinkButton,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  PageCanvas,
  SegmentedControl,
  TextField,
  ThemeMenuButton,
  ToggleGroup,
  TopBar,
  type SegmentedItem,
  type ToggleItem,
} from "@/components/ui";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { createBrandedChartPng, downloadChartPng } from "@/components/chart-export";
import { ModelUpdateTimeline } from "@/components/model-update-timeline";
import {
  buildChartShareUrl,
  chartImageFilename,
  chartImageShareData,
  DEFAULT_CHART_X_METRIC,
  DEFAULT_CHART_Y_METRIC,
  parseChartShareView,
  xPostIntentUrl,
  type ChartShareView,
} from "@/components/chart-share";
import { OptionSpaceOverview } from "@/components/option-space-overview";
import { captureChartEvent } from "@/lib/analytics";
import { providerColorRange, recordColor } from "@/lib/chart-colors";
import { layoutChartLabels, type LabelPlacement } from "@/lib/chart-label-layout";
import { placeChartTooltip } from "@/lib/chart-tooltip-layout";
import { codingAgentRecordKey, type CodingAgentRecord, type CodingAgentSnapshot } from "@/lib/coding-agent-data";
import { formatRetrievedAt, formatUpdateDate, latestUpdateGroup } from "@/lib/coding-agent-updates";
import {
  computeDomain,
  formatMetricValue,
  isInPerformanceTier,
  linearScale,
  makeTicks,
  performanceTierRadius,
  recordsWithMetrics,
  xMetricControlLabels,
  xMetricLabels,
  xMetricValue,
  yMetricDescriptions,
  yMetricLabels,
  yMetricValue,
  type XMetric,
  type YMetric,
} from "@/lib/chart-math";

const chartWidth = 1440;
const chartHeight = 1320;
const plot = { top: 24, right: 1360, bottom: 1240, left: 72 } as const;
const initialTooltipSize = { height: 260, width: 264 } as const;
const refreshDelayThresholdMs = 48 * 60 * 60 * 1_000;
const yMetricItems = [
  { id: "aaIndex", label: "AAI" },
  { id: "deepSwe", label: "DSWE" },
  { id: "terminalBench", label: "TB" },
  { id: "sweAtlas", label: "SWEA" },
] satisfies readonly NativeSelectOption<YMetric>[];
const xMetricItems = [
  { id: "costUsd", label: xMetricControlLabels.costUsd },
  { id: "durationMinutes", label: xMetricControlLabels.durationMinutes },
  { id: "totalTokens", label: xMetricControlLabels.totalTokens },
] satisfies readonly SegmentedItem<XMetric>[];

type ChartBrand = Readonly<{
  domain: string;
  heading: string;
}>;

type PlotPoint = {
  record: CodingAgentRecord;
  x: number;
  xValue: number;
  y: number;
  yValue: number;
};

type SvgViewport = {
  left: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  top: number;
};

type HorizontalOverflow = {
  left: boolean;
  right: boolean;
};

type PointNavigationKey = "ArrowDown" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "End" | "Home";

type ClosestTarget = Readonly<{
  closest: (selectors: string) => unknown;
}>;

const chartSelectionBoundarySelector = [
  ".chart-selection-boundary",
  ".chart-point",
  ".provider-filter button",
].join(", ");

function canResolveClosest(target: unknown): target is ClosestTarget {
  return typeof target === "object"
    && target !== null
    && "closest" in target
    && typeof target.closest === "function";
}

/** Utility chrome and chart controls preserve a pinned selection; the remaining canvas is click-away space. */
export function shouldClearChartSelection(target: unknown): boolean {
  return !canResolveClosest(target) || target.closest(chartSelectionBoundarySelector) === null;
}

function isPointNavigationKey(key: string): key is PointNavigationKey {
  return key === "ArrowDown"
    || key === "ArrowLeft"
    || key === "ArrowRight"
    || key === "ArrowUp"
    || key === "End"
    || key === "Home";
}

export { formatRetrievedAt } from "@/lib/coding-agent-updates";

function pointInDirection(points: readonly PlotPoint[], index: number, key: PointNavigationKey): PlotPoint | null {
  if (key === "Home") return points[0] ?? null;
  if (key === "End") return points.at(-1) ?? null;
  const current = points[index];
  if (current === undefined) return null;

  let best: { point: PlotPoint; score: number } | null = null;
  for (const candidate of points) {
    if (candidate.record.id === current.record.id) continue;
    const deltaX = candidate.x - current.x;
    const deltaY = candidate.y - current.y;
    const primary = key === "ArrowLeft" ? -deltaX
      : key === "ArrowRight" ? deltaX
      : key === "ArrowUp" ? -deltaY
      : deltaY;
    if (primary <= 0) continue;
    const crossAxis = key === "ArrowLeft" || key === "ArrowRight" ? Math.abs(deltaY) : Math.abs(deltaX);
    const score = Math.hypot(primary, crossAxis) + crossAxis * 0.65;
    if (best === null || score < best.score) best = { point: candidate, score };
  }
  return best?.point ?? null;
}

function useHorizontalOverflow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [overflow, setOverflow] = useState<HorizontalOverflow>({ left: false, right: false });

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const update = () => {
      const next = {
        left: element.scrollLeft > 2,
        right: element.scrollLeft + element.clientWidth < element.scrollWidth - 2,
      };
      setOverflow((current) => current.left === next.left && current.right === next.right ? current : next);
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(element);
    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(element, { childList: true, subtree: true });
    return () => {
      element.removeEventListener("scroll", update);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, []);

  return [ref, overflow] as const;
}

function overflowClassName(base: string, overflow: HorizontalOverflow): string {
  return [base, "horizontal-scroll-shell", overflow.left ? "has-overflow-left" : "", overflow.right ? "has-overflow-right" : ""]
    .filter(Boolean)
    .join(" ");
}

function providerStyle(providerId: string): CSSProperties & {
  "--provider-color": string;
  "--provider-color-high": string;
  "--provider-color-low": string;
} {
  const range = providerColorRange(providerId);
  return {
    "--provider-color": range.base,
    "--provider-color-high": range.high,
    "--provider-color-low": range.low,
  };
}

function pointAriaLabel(point: PlotPoint, xMetric: XMetric, yMetric: YMetric): string {
  return [
    point.record.agent,
    point.record.modelLabel,
    point.record.providerName,
    `${yMetricLabels[yMetric]} ${formatMetricValue(yMetric, point.yValue)}`,
    `${xMetricLabels[xMetric]} ${formatMetricValue(xMetric, point.xValue)}`,
  ].join(", ");
}

function formatNullableMetricValue(metric: XMetric | YMetric, value: number | null): string {
  return value === null ? "-" : formatMetricValue(metric, value);
}

function modelLabelWidth(label: string): number {
  return Math.max(132, Math.min(276, label.length * 8.8 + 28));
}

async function copyShareLink(url: string): Promise<boolean> {
  if (navigator.clipboard === undefined) return false;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

function isShareCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function PointGlyph({ color, shape }: { color: string; shape: number }) {
  if (shape % 3 === 1) return <rect fill={color} height="11" width="11" x="-5.5" y="-5.5" />;
  if (shape % 3 === 2) return <path d="M 0 -7 L 7 0 L 0 7 L -7 0 Z" fill={color} />;
  return <circle cx="0" cy="0" fill={color} r="6" />;
}

function MetricControl<T extends string>({
  items,
  label,
  onChange,
  value,
}: {
  items: readonly SegmentedItem<T>[];
  label: string;
  onChange: (value: T) => void;
  value: T;
}) {
  return (
    <div className="metric-control metric-control--x">
      <SegmentedControl
        aria-label={label}
        className="chart-segmented-control chart-segmented-control--x"
        items={items}
        onChange={onChange}
        size="compact"
        value={value}
      />
    </div>
  );
}

export function CodingAgentExplorer({
  brand,
  children,
  modelCardPaths,
  snapshot,
}: {
  brand: ChartBrand;
  children: ReactNode;
  modelCardPaths: Readonly<Record<string, string>>;
  snapshot: CodingAgentSnapshot;
}) {
  const descriptionId = useId();
  const pointRefs = useRef(new Map<string, SVGGElement>());
  const shareInputRef = useRef<HTMLInputElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [providerFilterRef, providerOverflow] = useHorizontalOverflow<HTMLDivElement>();
  const [chartScrollRef, chartOverflow] = useHorizontalOverflow<HTMLDivElement>();
  const providers = useMemo(() => {
    const unique = new Map<string, { id: string; name: string }>();
    for (const record of snapshot.records) unique.set(record.providerId, { id: record.providerId, name: record.providerName });
    return Array.from(unique.values()).sort((left, right) => left.name.localeCompare(right.name));
  }, [snapshot.records]);
  const providerItems = useMemo<readonly ToggleItem<string>[]>(() => providers.map((provider) => ({
    id: provider.id,
    label: provider.name,
    leading: <i aria-hidden="true" />,
    style: providerStyle(provider.id),
  })), [providers]);
  const [xMetric, setXMetric] = useState<XMetric>(DEFAULT_CHART_X_METRIC);
  const [yMetric, setYMetric] = useState<YMetric>(DEFAULT_CHART_Y_METRIC);
  const [pinnedPointId, setPinnedPointId] = useState<string | null>(null);
  const [pinnedProviderId, setPinnedProviderId] = useState<string | null>(null);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const [hoveredProviderId, setHoveredProviderId] = useState<string | null>(null);
  const [keyboardPointId, setKeyboardPointId] = useState<string | null>(null);
  const [refreshDelayed, setRefreshDelayed] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareImage, setShareImage] = useState<Blob | null>(null);
  const [shareImagePreparing, setShareImagePreparing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [showShareUrl, setShowShareUrl] = useState(false);
  const [svgViewport, setSvgViewport] = useState<SvgViewport | null>(null);
  const [tooltipSize, setTooltipSize] = useState<{ height: number; width: number }>(initialTooltipSize);

  useEffect(() => {
    const updateFreshness = () => {
      setRefreshDelayed(Date.now() - Date.parse(snapshot.source.retrievedAt) > refreshDelayThresholdMs);
    };
    const frame = window.requestAnimationFrame(updateFreshness);
    const interval = window.setInterval(updateFreshness, 60 * 60 * 1_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
    };
  }, [snapshot.source.retrievedAt]);

  useEffect(() => {
    const sharedView = parseChartShareView(window.location.search);
    const nextXMetric = sharedView.xMetric ?? DEFAULT_CHART_X_METRIC;
    const nextYMetric = sharedView.yMetric ?? DEFAULT_CHART_Y_METRIC;
    const sharedPoint = sharedView.pointKey === null
      ? null
      : snapshot.records.find((record) => codingAgentRecordKey(record) === sharedView.pointKey) ?? null;
    const sharedProviderId = sharedView.providerId !== null
      && providers.some((provider) => provider.id === sharedView.providerId)
      ? sharedView.providerId
      : null;
    const frame = window.requestAnimationFrame(() => {
      if (sharedView.xMetric !== null) setXMetric(sharedView.xMetric);
      if (sharedView.yMetric !== null) setYMetric(sharedView.yMetric);
      if (
        sharedPoint !== null
        && xMetricValue(sharedPoint, nextXMetric) !== null
        && yMetricValue(sharedPoint, nextYMetric) !== null
      ) {
        setPinnedPointId(sharedPoint.id);
        setPinnedProviderId(null);
      } else if (sharedProviderId !== null) {
        setPinnedProviderId(sharedProviderId);
        setPinnedPointId(null);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [providers, snapshot.records]);

  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;

    const updateViewport = () => {
      const bounds = svg.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const scale = Math.min(bounds.width / chartWidth, bounds.height / chartHeight);
      const next = {
        left: bounds.left,
        offsetX: (bounds.width - chartWidth * scale) / 2,
        offsetY: (bounds.height - chartHeight * scale) / 2,
        scale,
        top: bounds.top,
      };
      setSvgViewport((current) => (
        current !== null
        && Math.abs(current.left - next.left) < 0.25
        && Math.abs(current.offsetX - next.offsetX) < 0.25
        && Math.abs(current.offsetY - next.offsetY) < 0.25
        && Math.abs(current.scale - next.scale) < 0.001
        && Math.abs(current.top - next.top) < 0.25
          ? current
          : next
      ));
    };

    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(svg);
    window.addEventListener("resize", updateViewport);
    window.addEventListener("scroll", updateViewport, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("scroll", updateViewport, true);
    };
  }, []);

  useEffect(() => {
    const clearOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (shareOpen) return;
      if (
          pinnedPointId === null
          && pinnedProviderId === null
          && hoveredPointId === null
          && hoveredProviderId === null
      ) return;
      event.preventDefault();
      setPinnedPointId(null);
      setPinnedProviderId(null);
      setHoveredPointId(null);
      setHoveredProviderId(null);
    };
    window.addEventListener("keydown", clearOnEscape);
    return () => window.removeEventListener("keydown", clearOnEscape);
  }, [hoveredPointId, hoveredProviderId, pinnedPointId, pinnedProviderId, shareOpen]);

  const chart = useMemo(() => {
    const visible = recordsWithMetrics(snapshot.records, xMetric, yMetric);
    const xValues = visible.map((record) => xMetricValue(record, xMetric)).filter((value): value is number => value !== null);
    const yValues = visible.map((record) => yMetricValue(record, yMetric)).filter((value): value is number => value !== null);
    const xDomain = computeDomain(xValues, { paddingRatio: 0 });
    const yDomain = computeDomain(yValues, { paddingRatio: 0 });
    const xTicks = makeTicks(xDomain);
    const yTicks = makeTicks(yDomain);
    const scaleX = linearScale(xDomain, [plot.left, plot.right]);
    const scaleY = linearScale(yDomain, [plot.bottom, plot.top]);
    const points: PlotPoint[] = visible.map((record) => {
      const xValue = xMetricValue(record, xMetric);
      const yValue = yMetricValue(record, yMetric);
      if (xValue === null || yValue === null) throw new Error("Metric filtering invariant failed.");
      return { record, xValue, yValue, x: scaleX(xValue), y: scaleY(yValue) };
    }).sort((left, right) => left.x - right.x || right.yValue - left.yValue);

    const grouped = new Map<string, PlotPoint[]>();
    for (const point of points) {
      const series = grouped.get(point.record.seriesId) ?? [];
      series.push(point);
      grouped.set(point.record.seriesId, series);
    }
    for (const series of grouped.values()) series.sort((left, right) => left.record.settingRank - right.record.settingRank || left.x - right.x);

    const bestLabelByModel = new Map<string, PlotPoint>();
    for (const series of grouped.values()) {
      const point = series.reduce((best, candidate) => candidate.yValue > best.yValue ? candidate : best);
      const current = bestLabelByModel.get(point.record.model);
      if (current === undefined || point.yValue > current.yValue) bestLabelByModel.set(point.record.model, point);
    }

    return {
      grouped,
      labelPoints: Array.from(bestLabelByModel.values()).sort((left, right) => right.yValue - left.yValue),
      points,
      xTicks,
      yTicks,
      scaleX,
      scaleY,
    };
  }, [snapshot.records, xMetric, yMetric]);

  const focusablePointId = chart.points.some((point) => point.record.id === keyboardPointId)
    ? keyboardPointId
    : chart.points[0]?.record.id ?? null;
  const pinnedPoint = chart.points.find((point) => point.record.id === pinnedPointId) ?? null;
  const hoveredPoint = chart.points.find((point) => point.record.id === hoveredPointId) ?? null;
  const pinnedProvider = providers.find((provider) => provider.id === pinnedProviderId) ?? null;
  const pinnedCardPath = pinnedPoint === null
    ? null
    : modelCardPaths[pinnedPoint.record.id] ?? null;
  const benchmarkPoint = pinnedPoint ?? (pinnedProviderId === null ? hoveredPoint : null);
  const selectedProviderId = benchmarkPoint === null ? pinnedProviderId ?? hoveredProviderId : null;
  const performanceCohort = useMemo(() => (
    benchmarkPoint === null
      ? []
      : chart.points.filter((point) => isInPerformanceTier(point.yValue, benchmarkPoint.yValue))
  ), [benchmarkPoint, chart.points]);
  const performanceCohortIds = useMemo(
    () => new Set(performanceCohort.map((point) => point.record.id)),
    [performanceCohort],
  );
  const visibleLabelPoints = useMemo(() => {
    if (benchmarkPoint !== null) {
      return [...performanceCohort].sort((left, right) => (
        Number(left.record.id === benchmarkPoint.record.id) - Number(right.record.id === benchmarkPoint.record.id)
      ));
    }
    if (selectedProviderId === null) return [];
    return chart.labelPoints.filter((point) => point.record.providerId === selectedProviderId);
  }, [benchmarkPoint, chart.labelPoints, performanceCohort, selectedProviderId]);
  const cohortLabelPlacements = useMemo(() => {
    if (benchmarkPoint === null) return new Map<string, LabelPlacement>();
    return layoutChartLabels(
      performanceCohort.map((point) => ({
        height: 54,
        id: point.record.id,
        priority: point.record.id === benchmarkPoint.record.id ? 2 : 1,
        width: modelLabelWidth(point.record.modelLabel),
        x: point.x,
        y: point.y,
      })),
      { bottom: plot.bottom - 6, left: plot.left + 6, right: plot.right - 6, top: plot.top + 6 },
      {
        offset: 18,
        obstacles: performanceCohort.map((point) => ({
          height: 24,
          width: 24,
          x: point.x - 12,
          y: point.y - 12,
        })),
      },
    );
  }, [benchmarkPoint, performanceCohort]);
  const visibleLabels = useMemo(() => visibleLabelPoints.map((point) => {
    const width = modelLabelWidth(point.record.modelLabel);
    const alignRight = point.x > plot.right - width - 20;
    const placement = cohortLabelPlacements.get(point.record.id);
    return {
      height: 54,
      point,
      width,
      x: placement?.x ?? point.x + (alignRight ? -width - 14 : 14),
      y: placement?.y ?? point.y - 56,
    };
  }), [cohortLabelPlacements, visibleLabelPoints]);
  const benchmarkBand = benchmarkPoint === null ? null : {
    bottom: Math.min(plot.bottom, chart.scaleY(benchmarkPoint.yValue - performanceTierRadius)),
    top: Math.max(plot.top, chart.scaleY(benchmarkPoint.yValue + performanceTierRadius)),
  };
  const tooltipVisible = hoveredPoint !== null && svgViewport !== null;
  const tooltipLayout = useMemo(() => {
    if (hoveredPoint === null || svgViewport === null || typeof window === "undefined") return null;
    const viewportInset = 8;
    const topBarBottom = document.querySelector<HTMLElement>(".chart-top-bar")?.getBoundingClientRect().bottom ?? 0;
    const bounds = {
      bottom: window.innerHeight - viewportInset,
      left: viewportInset,
      right: window.innerWidth - viewportInset,
      top: Math.max(viewportInset, topBarBottom + viewportInset),
    };
    const availableHeight = bounds.bottom - bounds.top;
    const availableWidth = bounds.right - bounds.left;
    if (availableHeight <= 0 || availableWidth <= 0) return null;

    const anchor = {
      x: svgViewport.left + svgViewport.offsetX + hoveredPoint.x * svgViewport.scale,
      y: svgViewport.top + svgViewport.offsetY + hoveredPoint.y * svgViewport.scale,
    };
    const labelObstacles = visibleLabels.map((label) => ({
      height: label.height * svgViewport.scale,
      width: label.width * svgViewport.scale,
      x: svgViewport.left + svgViewport.offsetX + label.x * svgViewport.scale,
      y: svgViewport.top + svgViewport.offsetY + label.y * svgViewport.scale,
    }));
    const pointObstacles = performanceCohort
      .filter((point) => point.record.id !== hoveredPoint.record.id)
      .map((point) => {
        const size = Math.max(24, 28 * svgViewport.scale);
        return {
          height: size,
          width: size,
          x: svgViewport.left + svgViewport.offsetX + point.x * svgViewport.scale - size / 2,
          y: svgViewport.top + svgViewport.offsetY + point.y * svgViewport.scale - size / 2,
        };
      });
    return placeChartTooltip(
      anchor,
      {
        height: Math.min(tooltipSize.height, availableHeight),
        width: Math.min(tooltipSize.width, availableWidth),
      },
      bounds,
      { gap: 12, obstacles: [...labelObstacles, ...pointObstacles] },
    );
  }, [hoveredPoint, performanceCohort, svgViewport, tooltipSize, visibleLabels]);

  useEffect(() => {
    if (!tooltipVisible) return;
    const tooltip = tooltipRef.current;
    if (tooltip === null) return;
    const updateSize = () => {
      const bounds = tooltip.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      setTooltipSize((current) => (
        Math.abs(current.height - bounds.height) < 0.25
        && Math.abs(current.width - bounds.width) < 0.25
          ? current
          : { height: bounds.height, width: bounds.width }
      ));
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(tooltip);
    return () => observer.disconnect();
  }, [hoveredPointId, tooltipVisible]);
  const retrievedAt = formatRetrievedAt(snapshot.source.retrievedAt);
  const latestUpdate = latestUpdateGroup(snapshot.updates);
  const accessibleTitle = `${yMetricLabels[yMetric]} versus ${xMetricLabels[xMetric]}`;
  const accessibleDescription = `Scatter plot comparing coding-agent models. Hover or focus a point or provider to preview it. Select a point to pin agents within ${performanceTierRadius} points of its ${yMetricLabels[yMetric]} score, or select a provider to pin its models. Use arrow keys to move between points.`;
  const shareSelectionLabel = pinnedPoint?.record.modelLabel ?? pinnedProvider?.name ?? null;
  const shareImageSelection = pinnedPoint === null
    ? pinnedProvider === null ? "All providers" : `Pinned: ${pinnedProvider.name}`
    : `Pinned: ${pinnedPoint.record.modelLabel} · ${formatMetricValue(yMetric, pinnedPoint.yValue)} / ${formatMetricValue(xMetric, pinnedPoint.xValue)}`;
  const shareView: ChartShareView = {
    pointKey: pinnedPoint === null ? null : codingAgentRecordKey(pinnedPoint.record),
    providerId: pinnedProvider?.id ?? null,
    xMetric,
    yMetric,
  };
  const siteUrl = `https://${brand.domain}`;
  const shareUrl = buildChartShareUrl(siteUrl, shareView);
  const shareFilename = chartImageFilename(shareView, shareSelectionLabel);
  const shareText = `${yMetricLabels[yMetric]} vs ${xMetricLabels[xMetric]}${shareSelectionLabel === null ? "" : ` — ${shareSelectionLabel}`} on ${brand.domain}`;
  const shareIntent = xPostIntentUrl(shareText, shareUrl);
  const shareImageProviders = useMemo(() => providers.map((provider) => {
    const colors = providerColorRange(provider.id);
    return {
      color: colors.base,
      colorHigh: colors.high,
      colorLow: colors.low,
      name: provider.name,
    };
  }), [providers]);

  useEffect(() => {
    if (!shareOpen) return;
    const source = svgRef.current;
    if (source === null) {
      setShareImagePreparing(false);
      setShareStatus("The chart image is unavailable. Copy the link instead.");
      return;
    }

    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      void createBrandedChartPng(source, chartWidth, chartHeight, {
        context: `${yMetricLabels[yMetric]} vs ${xMetricLabels[xMetric]} · Artificial Analysis`,
        domain: brand.domain,
        freshness: `${refreshDelayed ? "Refresh delayed" : "Auto-refreshes daily"} · Last refreshed ${retrievedAt}`,
        providers: shareImageProviders,
        selection: shareImageSelection,
      }).then((image) => {
        if (cancelled) return;
        setShareImage(image);
        setShareImagePreparing(false);
        setShareStatus("Image ready to share.");
      }).catch(() => {
        if (cancelled) return;
        setShareImagePreparing(false);
        setShareStatus("The chart image could not be prepared. Copy the link instead.");
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [brand.domain, refreshDelayed, retrievedAt, shareImageProviders, shareImageSelection, shareOpen, xMetric, yMetric]);

  function interactionState(record: CodingAgentRecord): "normal" | "highlighted" | "dimmed" {
    if (benchmarkPoint !== null) return performanceCohortIds.has(record.id) ? "highlighted" : "dimmed";
    if (selectedProviderId !== null) return record.providerId === selectedProviderId ? "highlighted" : "dimmed";
    return "normal";
  }

  function seriesInteractionState(record: CodingAgentRecord): "normal" | "highlighted" | "dimmed" {
    if (benchmarkPoint !== null) return "dimmed";
    if (selectedProviderId !== null) return record.providerId === selectedProviderId ? "highlighted" : "dimmed";
    return "normal";
  }

  function clearSelection() {
    setPinnedPointId(null);
    setPinnedProviderId(null);
    setHoveredPointId(null);
    setHoveredProviderId(null);
  }

  function handleProviderChange(providerId: string | null) {
    if (providerId !== null && providerId !== pinnedProviderId) {
      captureChartEvent({
        name: "chart selection pinned",
        properties: { provider_id: providerId, selection_kind: "provider" },
      });
    }
    setPinnedProviderId(providerId);
    setPinnedPointId(null);
    setHoveredPointId(null);
  }

  function handleShareOpenChange(nextOpen: boolean) {
    setShareOpen(nextOpen);
    setShareBusy(false);
    setShareStatus(nextOpen ? "Preparing chart image…" : "");
    setShowShareUrl(false);
    if (nextOpen) {
      setHoveredPointId(null);
      setHoveredProviderId(null);
      setShareImage(null);
      setShareImagePreparing(true);
    } else {
      setShareImagePreparing(false);
    }
  }

  function handleDownloadImage() {
    if (shareImage === null) return;
    downloadChartPng(shareImage, shareFilename);
    setShareStatus("PNG downloaded.");
    captureChartEvent({
      name: "chart shared",
      properties: { share_method: "download_png", x_metric: xMetric, y_metric: yMetric },
    });
  }

  async function handleShareImage() {
    if (shareImage === null || shareBusy) return;
    const imageFile = new File([shareImage], shareFilename, { type: "image/png" });
    const shareData = chartImageShareData(imageFile);
    let canShareImage = false;
    try {
      canShareImage = navigator.share !== undefined && navigator.canShare?.(shareData) === true;
    } catch {
      canShareImage = false;
    }

    if (!canShareImage) {
      downloadChartPng(shareImage, shareFilename);
      setShareStatus("This browser cannot share image files, so the PNG was downloaded instead.");
      captureChartEvent({
        name: "chart shared",
        properties: { share_method: "download_fallback", x_metric: xMetric, y_metric: yMetric },
      });
      return;
    }

    setShareBusy(true);
    try {
      await navigator.share(shareData);
      setShareStatus("Chart shared.");
      captureChartEvent({
        name: "chart shared",
        properties: { share_method: "native_share", x_metric: xMetric, y_metric: yMetric },
      });
    } catch (error: unknown) {
      if (isShareCancellation(error)) setShareStatus("Image ready to share.");
      else {
        downloadChartPng(shareImage, shareFilename);
        setShareStatus("Sharing was unavailable, so the PNG was downloaded instead.");
        captureChartEvent({
          name: "chart shared",
          properties: { share_method: "download_fallback", x_metric: xMetric, y_metric: yMetric },
        });
      }
    } finally {
      setShareBusy(false);
    }
  }

  function handlePostToX() {
    if (shareImage !== null) {
      downloadChartPng(shareImage, shareFilename);
      setShareStatus("PNG downloaded. Attach it in the X composer.");
    } else {
      setShareStatus("X composer opened with the chart link. The PNG was not available to download.");
    }
    captureChartEvent({
      name: "chart shared",
      properties: { share_method: "x", x_metric: xMetric, y_metric: yMetric },
    });
  }

  async function handleCopyShareLink() {
    const copied = await copyShareLink(shareUrl);
    setShowShareUrl(!copied);
    setShareStatus(copied ? "Link copied." : "Copy is unavailable. Select the share link below.");
    if (copied) {
      captureChartEvent({
        name: "chart shared",
        properties: { share_method: "copy_link", x_metric: xMetric, y_metric: yMetric },
      });
    }
  }

  function handleAppClick(event: ReactMouseEvent<HTMLElement>) {
    if (!shouldClearChartSelection(event.target)) return;
    clearSelection();
    const focusedPointId = document.activeElement?.getAttribute("data-point-id");
    if (focusedPointId !== null && focusedPointId !== undefined) pointRefs.current.get(focusedPointId)?.blur();
    if (document.activeElement instanceof HTMLButtonElement && document.activeElement.closest(".provider-filter") !== null) {
      document.activeElement.blur();
    }
  }

  function handlePointKeyDown(event: KeyboardEvent<SVGGElement>, index: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const currentPoint = chart.points[index];
      if (currentPoint !== undefined) {
        const nextPointId = pinnedPointId === currentPoint.record.id ? null : currentPoint.record.id;
        if (nextPointId !== null) {
          captureChartEvent({
            name: "chart selection pinned",
            properties: { provider_id: currentPoint.record.providerId, selection_kind: "model" },
          });
        }
        setPinnedPointId(nextPointId);
        setPinnedProviderId(null);
      }
      return;
    }
    if (!isPointNavigationKey(event.key)) return;
    event.preventDefault();
    const nextPoint = pointInDirection(chart.points, index, event.key);
    if (nextPoint === null) return;
    setKeyboardPointId(nextPoint.record.id);
    setHoveredPointId(nextPoint.record.id);
    pointRefs.current.get(nextPoint.record.id)?.focus();
  }

  return (
    <div className="chart-app">
      <TopBar
        actions={(
          <>
            {latestUpdate !== null && (
              <a
                aria-label={`Latest update: ${latestUpdate.summary}, ${formatUpdateDate(latestUpdate.detectedAt)}`}
                className="latest-update-badge chart-selection-boundary"
                href="#model-updates"
              >
                <span>Latest</span>
                <strong>{latestUpdate.summary}</strong>
                <time dateTime={latestUpdate.detectedAt}>{formatUpdateDate(latestUpdate.detectedAt)}</time>
              </a>
            )}
            <LinkButton href="/blog" size="compact" variant="quiet">
              Blog
            </LinkButton>
            <LinkButton href="/models" size="compact" variant="quiet">
              Cards
            </LinkButton>
            <LinkButton
              className="chart-top-bar__optional-action"
              href="/gpt-subsidy"
              size="compact"
              variant="quiet"
            >
              {chatGptSubsidyChartLabel}
            </LinkButton>
            <ThemeMenuButton aria-label="Chart appearance" />
          </>
        )}
        className="chart-top-bar"
        title={<h1 className="chart-heading">{brand.heading}</h1>}
      />
      <PageCanvas
        className="chart-page-canvas"
        id="main-content"
        inset="none"
        onClick={handleAppClick}
        size="full"
        tabIndex={-1}
      >
      {children}
      <header className="chart-header">
        <p aria-live="polite" className="benchmark-description">
          <strong>{yMetricLabels[yMetric]}</strong> — {yMetricDescriptions[yMetric]}
        </p>
      </header>

      <div className={overflowClassName("provider-filter-shell", providerOverflow)}>
        <ToggleGroup
          aria-label="Highlight a provider"
          className="provider-filter"
          groupRef={providerFilterRef}
          items={providerItems}
          onChange={handleProviderChange}
          onItemBlur={(providerId) => setHoveredProviderId((current) => current === providerId ? null : current)}
          onItemFocus={(providerId) => {
            setHoveredPointId(null);
            setHoveredProviderId(providerId);
          }}
          onItemHoverEnd={(providerId) => setHoveredProviderId((current) => current === providerId ? null : current)}
          onItemHoverStart={(providerId) => {
            setHoveredPointId(null);
            setHoveredProviderId(providerId);
          }}
          surfaceClassName="provider-filter-surface"
          value={pinnedProviderId}
        />
      </div>

      <div className="chart-metric-controls chart-selection-boundary">
        <NativeSelectField
          className="chart-benchmark-select"
          label="Benchmark"
          onChange={(metric) => {
            if (metric !== yMetric) {
              captureChartEvent({ name: "chart metric selected", properties: { axis: "y", metric } });
            }
            setYMetric(metric);
            clearSelection();
          }}
          options={yMetricItems}
          showLabel={false}
          size="compact"
          surface="pane"
          value={yMetric}
        />
        <MetricControl
          items={xMetricItems}
          label="Compare by"
          onChange={(metric) => {
            if (metric !== xMetric) {
              captureChartEvent({ name: "chart metric selected", properties: { axis: "x", metric } });
            }
            setXMetric(metric);
            clearSelection();
          }}
          value={xMetric}
        />
      </div>

      <div className={overflowClassName("chart-scroll-shell", chartOverflow)}>
        {(pinnedPoint !== null || pinnedProvider !== null) && (
          <div className="pin-status">
            <span aria-live="polite"><strong>Pinned</strong> {pinnedPoint?.record.modelLabel ?? pinnedProvider?.name}</span>
            {pinnedCardPath !== null && (
              <LinkButton href={pinnedCardPath} size="compact" variant="quiet">
                View card
              </LinkButton>
            )}
            <IconButton
              aria-label="Clear pinned selection"
              onPress={clearSelection}
              size="compact"
              tooltip="Clear pinned selection"
            >
              <Icon icon={Cancel01Icon} size={17} strokeWidth={1.75} />
            </IconButton>
          </div>
        )}
        <div className="share-control chart-selection-boundary">
          <MenuTrigger isOpen={shareOpen} onOpenChange={handleShareOpenChange}>
            <IconButton
              aria-label="Share and export chart"
              className="share-trigger"
              controlClassName="share-trigger__control"
              size="compact"
              tooltip="Share and export chart"
            >
              <Icon icon={Share08Icon} size={18} strokeWidth={1.75} />
            </IconButton>
            <Menu
              aria-label="Share current view"
              className="share-menu chart-selection-boundary"
              footer={(
                <>
                  <p
                    aria-busy={shareBusy || shareImagePreparing}
                    aria-live="polite"
                    className="share-status"
                    role="status"
                  >
                    {shareStatus}
                  </p>
                  {showShareUrl && (
                    <TextField
                      className="share-link-fallback"
                      inputRef={shareInputRef}
                      isReadOnly
                      label="Share link"
                      onFocus={() => shareInputRef.current?.select()}
                      value={shareUrl}
                    />
                  )}
                </>
              )}
              placement="bottom end"
              popoverClassName="share-menu-popover chart-selection-boundary"
              shouldCloseOnSelect={false}
            >
              <MenuSection
                title={(
                  <div className="share-menu-heading">
                    <strong>Share current view</strong>
                    <span>{shareSelectionLabel === null ? "All providers" : `Pinned: ${shareSelectionLabel}`}</span>
                  </div>
                )}
              >
                <MenuItem
                  description="One PNG with the selected axes and pinned state"
                  id="share-image"
                  isDisabled={shareImage === null || shareBusy}
                  leading={<Icon icon={Image01Icon} size={17} strokeWidth={1.75} />}
                  onAction={() => { void handleShareImage(); }}
                  textValue="Share image"
                >
                  Share image…
                </MenuItem>
                <MenuItem
                  description="Opens a new composer tab and downloads the PNG to attach"
                  href={shareIntent}
                  id="post-x"
                  leading={<Icon icon={ExternalLinkIcon} size={17} strokeWidth={1.75} />}
                  onAction={handlePostToX}
                  rel="noopener noreferrer"
                  target="_blank"
                  textValue="Post on X"
                >
                  Post on X
                </MenuItem>
                <MenuItem
                  description="Save a full-resolution branded chart"
                  id="download"
                  isDisabled={shareImage === null}
                  leading={<Icon icon={Download01Icon} size={17} strokeWidth={1.75} />}
                  onAction={handleDownloadImage}
                  textValue="Download PNG"
                >
                  Download PNG
                </MenuItem>
                <MenuItem
                  description="Restores these metrics and the pinned selection"
                  id="copy-link"
                  leading={<Icon icon={CopyLinkIcon} size={17} strokeWidth={1.75} />}
                  onAction={() => { void handleCopyShareLink(); }}
                  textValue="Copy link"
                >
                  Copy link
                </MenuItem>
              </MenuSection>
            </Menu>
          </MenuTrigger>
        </div>
        <div className="chart-scroll" aria-label="Scrollable chart area" ref={chartScrollRef}>
          <div className="chart-canvas">
          <svg aria-describedby={descriptionId} aria-label={accessibleTitle} className="benchmark-chart" ref={svgRef} role="group" viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
            <desc id={descriptionId}>{accessibleDescription}</desc>

            {chart.yTicks.map((tick) => (
              <g className="chart-gridline" key={`y-${tick}`}>
                <line x1={plot.left} x2={plot.right} y1={chart.scaleY(tick)} y2={chart.scaleY(tick)} />
              </g>
            ))}
            {chart.xTicks.map((tick) => (
              <g className="chart-gridline chart-gridline-x" key={`x-${tick}`}>
                <line x1={chart.scaleX(tick)} x2={chart.scaleX(tick)} y1={plot.top} y2={plot.bottom} />
                <text textAnchor="middle" x={chart.scaleX(tick)} y={plot.bottom + 29}>{formatMetricValue(xMetric, tick)}</text>
              </g>
            ))}
            <line className="chart-axis" x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} />
            <line className="chart-axis" x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.bottom} />
            <text aria-hidden="true" className="chart-axis-title chart-export-axis-title" textAnchor="middle" x={(plot.left + plot.right) / 2} y={chartHeight - 18}>{xMetricLabels[xMetric]}</text>
            <text aria-hidden="true" className="chart-axis-title chart-export-axis-title" textAnchor="middle" transform={`rotate(-90 26 ${(plot.top + plot.bottom) / 2})`} x="26" y={(plot.top + plot.bottom) / 2}>{yMetricLabels[yMetric]}</text>
            <text
              aria-hidden="true"
              className="chart-watermark"
              textAnchor="end"
              x={plot.right - 14}
              y={plot.bottom - 18}
            >
              {brand.domain}
            </text>

            {benchmarkPoint !== null && benchmarkBand !== null && (
              <g aria-hidden="true" className="benchmark-tier">
                <rect
                  className="benchmark-tier-band"
                  height={Math.max(1, benchmarkBand.bottom - benchmarkBand.top)}
                  width={plot.right - plot.left}
                  x={plot.left}
                  y={benchmarkBand.top}
                />
                <line
                  className="benchmark-tier-guide"
                  x1={plot.left}
                  x2={plot.right}
                  y1={benchmarkPoint.y}
                  y2={benchmarkPoint.y}
                />
              </g>
            )}

            {Array.from(chart.grouped.entries()).map(([seriesId, series]) => {
              if (series.length < 2) return null;
              const firstPoint = series[0];
              if (firstPoint === undefined) return null;
              const state = seriesInteractionState(firstPoint.record);
              return (
                <g
                  className={`series-group is-${state}`}
                  data-provider-id={firstPoint.record.providerId}
                  data-series-id={seriesId}
                  key={seriesId}
                >
                  {series.slice(1).map((point, index) => {
                    const previous = series[index];
                    if (previous === undefined) return null;
                    return (
                      <line
                        className="series-line-segment"
                        key={`${seriesId}-${point.record.id}`}
                        stroke={recordColor(point.record)}
                        x1={previous.x}
                        x2={point.x}
                        y1={previous.y}
                        y2={point.y}
                      />
                    );
                  })}
                </g>
              );
            })}

            {benchmarkPoint !== null && (
              <g aria-hidden="true" className="chart-label-leaders">
                {performanceCohort.map((point) => {
                  const placement = cohortLabelPlacements.get(point.record.id);
                  if (placement === undefined) return null;
                  const endX = Math.max(placement.x, Math.min(point.x, placement.x + placement.width));
                  const endY = Math.max(placement.y, Math.min(point.y, placement.y + placement.height));
                  return (
                    <line
                      className="chart-label-leader"
                      key={`leader-${point.record.id}`}
                      style={{ color: recordColor(point.record) }}
                      x1={point.x}
                      x2={endX}
                      y1={point.y}
                      y2={endY}
                    />
                  );
                })}
              </g>
            )}

            {chart.points.map((point, index) => {
              const providerIndex = providers.findIndex((provider) => provider.id === point.record.providerId);
              const isPinned = point.record.id === pinnedPoint?.record.id;
              const isHovered = point.record.id === hoveredPoint?.record.id;
              const state = interactionState(point.record);
              return (
                <g
                  aria-label={pointAriaLabel(point, xMetric, yMetric)}
                  aria-pressed={isPinned}
                  className={`chart-point is-${state}${isPinned ? " is-active" : ""}${isHovered ? " is-hovered" : ""}`}
                  data-point-id={point.record.id}
                  data-provider-id={point.record.providerId}
                  data-series-id={point.record.seriesId}
                  key={point.record.id}
                  onBlur={() => {
                    setHoveredPointId((current) => current === point.record.id ? null : current);
                  }}
                  onClick={() => {
                    setKeyboardPointId(point.record.id);
                    const nextPointId = pinnedPointId === point.record.id ? null : point.record.id;
                    if (nextPointId !== null) {
                      captureChartEvent({
                        name: "chart selection pinned",
                        properties: { provider_id: point.record.providerId, selection_kind: "model" },
                      });
                    }
                    setPinnedPointId(nextPointId);
                    setPinnedProviderId(null);
                  }}
                  onFocus={() => {
                    setKeyboardPointId(point.record.id);
                    setHoveredProviderId(null);
                    setHoveredPointId(point.record.id);
                  }}
                  onKeyDown={(event) => handlePointKeyDown(event, index)}
                  onPointerEnter={() => {
                    setHoveredProviderId(null);
                    setHoveredPointId(point.record.id);
                  }}
                  onPointerLeave={() => setHoveredPointId((current) => current === point.record.id ? null : current)}
                  ref={(node) => {
                    if (node === null) pointRefs.current.delete(point.record.id);
                    else pointRefs.current.set(point.record.id, node);
                  }}
                  role="button"
                  style={{ color: recordColor(point.record) }}
                  tabIndex={point.record.id === focusablePointId ? 0 : -1}
                  transform={`translate(${point.x} ${point.y})`}
                >
                  <circle className="chart-point-hit" r="22" />
                  <circle className="chart-point-ring" r="11" />
                  <PointGlyph color={recordColor(point.record)} shape={providerIndex} />
                </g>
              );
            })}

            {visibleLabels.map((label) => {
              const { point } = label;
              return (
                <g
                  aria-hidden="true"
                  className="chart-model-label is-highlighted"
                  key={`label-${point.record.id}`}
                  style={{ color: recordColor(point.record) }}
                  transform={`translate(${label.x} ${label.y})`}
                >
                  <rect className="chart-model-label-frame" height={label.height} rx="7" width={label.width} />
                  <text className="chart-model-label-title" x="10" y="21">{point.record.modelLabel}</text>
                  <text className="chart-model-label-score" x="10" y="42">
                    {formatMetricValue(yMetric, point.yValue)} / {formatMetricValue(xMetric, point.xValue)}
                  </text>
                </g>
              );
            })}
          </svg>
          </div>
        </div>
      </div>
      <OptionSpaceOverview
        onPinPoint={(recordId) => {
          const nextPointId = pinnedPointId === recordId ? null : recordId;
          const nextRecord = snapshot.records.find((record) => record.id === nextPointId);
          if (nextRecord !== undefined) {
            captureChartEvent({
              name: "chart selection pinned",
              properties: { provider_id: nextRecord.providerId, selection_kind: "model" },
            });
          }
          setPinnedPointId(nextPointId);
          setPinnedProviderId(null);
          setHoveredPointId(null);
          setHoveredProviderId(null);
        }}
        onPinProvider={(providerId) => {
          handleProviderChange(pinnedProviderId === providerId ? null : providerId);
          setHoveredProviderId(null);
        }}
        pinnedPointId={pinnedPointId}
        pinnedProviderId={pinnedProviderId}
        records={snapshot.records}
        xMetric={xMetric}
        yMetric={yMetric}
      />
      <ModelUpdateTimeline retrievedAt={snapshot.source.retrievedAt} updates={snapshot.updates} />
      <nav aria-label="AI Charts resources" className="chart-resource-nav">
        <div className="chart-resource-nav__links">
          <Link href="/data">Data</Link>
          <Link href="/blog">Analysis</Link>
          <Link href="/gpt-subsidy">{chatGptSubsidyChartLabel}</Link>
        </div>
      </nav>
      </PageCanvas>
      {hoveredPoint !== null && tooltipLayout !== null && typeof document !== "undefined" && createPortal(
        <>
          <svg
            aria-hidden="true"
            className="chart-tooltip-connector"
            focusable="false"
            style={providerStyle(hoveredPoint.record.providerId)}
          >
            <line
              className="chart-tooltip-connector-line"
              x1={tooltipLayout.connector.start.x}
              x2={tooltipLayout.connector.end.x}
              y1={tooltipLayout.connector.start.y}
              y2={tooltipLayout.connector.end.y}
            />
          </svg>
          <div
            className="chart-tooltip"
            ref={tooltipRef}
            role="status"
            style={{ left: tooltipLayout.x, top: tooltipLayout.y }}
          >
            <span style={providerStyle(hoveredPoint.record.providerId)}><i /> {hoveredPoint.record.providerName}</span>
            <strong>{hoveredPoint.record.model}</strong>
            <small>{hoveredPoint.record.agent} / {hoveredPoint.record.setting}</small>
            <dl>
              <div><dt>AA Index</dt><dd>{formatNullableMetricValue("aaIndex", hoveredPoint.record.benchmarks.aaIndex)}</dd></div>
              <div><dt>DeepSWE</dt><dd>{formatNullableMetricValue("deepSwe", hoveredPoint.record.benchmarks.deepSwe)}</dd></div>
              <div><dt>Terminal v2</dt><dd>{formatNullableMetricValue("terminalBench", hoveredPoint.record.benchmarks.terminalBench)}</dd></div>
              <div><dt>SWE Atlas</dt><dd>{formatNullableMetricValue("sweAtlas", hoveredPoint.record.benchmarks.sweAtlas)}</dd></div>
              <div><dt>Cost</dt><dd>{formatNullableMetricValue("costUsd", hoveredPoint.record.economics.costUsd)}</dd></div>
              <div><dt>Time</dt><dd>{formatNullableMetricValue("durationMinutes", hoveredPoint.record.economics.durationSeconds === null ? null : hoveredPoint.record.economics.durationSeconds / 60)}</dd></div>
              <div><dt>Total tokens</dt><dd>{formatNullableMetricValue("totalTokens", hoveredPoint.record.usage.totalTokens)}</dd></div>
            </dl>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
