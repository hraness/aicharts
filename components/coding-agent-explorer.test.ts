import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  computeDomain,
  linearScale,
  recordsWithMetrics,
  xMetricValue,
  yMetricValue,
} from "@/lib/chart-math";

import {
  CodingAgentExplorer,
  formatRetrievedAt,
  nearestCodingAgentPointId,
  selectRestingCodingAgentLabels,
  shouldClearChartSelection,
} from "./coding-agent-explorer";
import { buildChartShareUrl, parseChartShareView } from "./chart-share";

function clickTargetWithin(...ancestorClassNames: readonly string[]) {
  return {
    closest(selectors: string) {
      const selectorClasses = selectors
        .split(",")
        .map((selector) => selector.trim())
        .filter((selector) => selector.startsWith("."))
        .map((selector) => selector.slice(1).split(/[ .]/u)[0]);
      return selectorClasses.some((className) => className !== undefined && ancestorClassNames.includes(className))
        ? { ancestorClassNames }
        : null;
    },
  };
}

describe("retrieval timestamp formatting", () => {
  test("uses deterministic UTC punctuation across server and browser runtimes", () => {
    expect(formatRetrievedAt("2026-07-20T12:55:28.788Z"))
      .toBe("Jul 20, 2026, 12:55 PM UTC");
    expect(formatRetrievedAt("2026-01-02T00:03:00.000Z"))
      .toBe("Jan 2, 2026, 12:03 AM UTC");
  });

  test("rejects an invalid checked-in timestamp", () => {
    expect(() => formatRetrievedAt("last Thursday")).toThrow(RangeError);
  });
});

test("keeps the organization footer out of local chart chrome", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).not.toContain("HranessBrand");
  expect(source).not.toContain('className="chart-resource-nav"');
  expect(source).not.toContain("by @0thernet");
  expect(source).not.toContain("https://x.com/0thernet");
  expect(source).not.toContain("Zo Computer");
  expect(source).not.toContain("zo-pegasus.svg");
  expect(source).toContain("xMetricGlyph");
  expect(source).toContain("ProviderBrandLabel");
});

test("consolidates evidence links below the chart and leaves footer navigation to the route", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();
  const methodIndex = source.indexOf("<summary>Method and data</summary>");
  expect(methodIndex).toBeGreaterThan(source.indexOf('className="chart-scroll"'));
  expect(source.indexOf('href={snapshot.source.url}')).toBeGreaterThan(methodIndex);
  expect(source.indexOf('href="/data#source"')).toBeGreaterThan(methodIndex);
  expect(source.indexOf('href="/data/coding-agents.json"')).toBeGreaterThan(methodIndex);
  expect(source.match(/href="\/data\/coding-agents.json"/gu)).toHaveLength(1);
  expect(source).not.toContain('aria-label="AI Charts resources"');
  expect(source).not.toContain('href="/blog"');
});

test("renders the coding-agent view as one labelled section inside the shared page", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).not.toContain("<PageCanvas");
  expect(source).not.toContain("<main");
  expect(source).toMatch(/<section\s+aria-labelledby="coding-agent-chart-title"\s+className="chart-page-canvas"\s+data-analytics-surface="benchmark_chart"\s+id="coding-agents"\s+onClick=\{handleAppClick\}\s+tabIndex=\{-1\}\s*>/u);
});

test("keeps chart export compact, discoverable, and fully named", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();
  const chartShellIndex = source.indexOf('overflowClassName("chart-scroll-shell"');
  const shareIndex = source.indexOf('className="share-control chart-selection-boundary"');
  const scrollAreaIndex = source.indexOf('className="chart-scroll"');

  expect(source).toContain('tooltip="Share and export chart"');
  expect(source).toContain('aria-label="Share and export chart"');
  expect(source).toContain('className="share-trigger"');
  expect(chartShellIndex).toBeGreaterThan(-1);
  expect(shareIndex).toBeGreaterThan(chartShellIndex);
  expect(scrollAreaIndex).toBeGreaterThan(shareIndex);
  expect(source).not.toContain('className="share-label"');
  expect(source).not.toContain("<span>Share chart</span>");
});

test("leaves the site header and appearance controls to the shared shell", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).not.toContain("<TopBar");
  expect(source).not.toContain("ThemeMenuButton");
  expect(source).not.toContain('tooltip="Data provenance"');
  expect(source).not.toContain('aria-label="Data provenance"');
  expect(source).not.toContain('className="chart-provenance-control');
  expect(source).not.toContain("InformationCircleIcon");
  expect(source).not.toContain('className="chart-subtitle-row"');
  expect(source).not.toContain('className="chart-data-status"');
});

test("keeps the working chart ahead of optional comparison and evidence", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();
  const sectionIndex = source.indexOf('className="chart-page-canvas"');
  const introIndex = source.indexOf('<div className="chart-family-intro">', sectionIndex);
  const chartHeaderIndex = source.indexOf('<header className="chart-header">', sectionIndex);
  const overviewIndex = source.indexOf("<OptionSpaceOverview", chartHeaderIndex);
  const childrenIndex = source.indexOf("{children}", sectionIndex);

  expect(source).toContain("children?: ReactNode");
  expect(source).not.toContain("chart-orientation");
  expect(source).not.toContain("homeHeading");
  expect(introIndex).toBeGreaterThan(sectionIndex);
  expect(chartHeaderIndex).toBeGreaterThan(introIndex);
  expect(overviewIndex).toBeGreaterThan(chartHeaderIndex);
  expect(childrenIndex).toBeGreaterThan(overviewIndex);
  expect(source).toContain("codingAgentDatasetSummary(snapshot)");
  expect(source).not.toContain("standard above");
  expect(source).not.toContain("chart-family-intro__eyebrow");
  expect(source).toContain("This source reports Terminal-Bench v2.1");
  expect(source.indexOf("This source reports Terminal-Bench v2.1")).toBeGreaterThan(overviewIndex);
  expect(source).toContain('href="/benchmarks?atlas=terminal-bench-4"');
  expect(source).toContain('href={snapshot.source.url}');
  expect(source).toContain("<span>{snapshot.source.name} · {snapshotSummary.recordCount} configurations");
  expect(source).toContain("<span>Snapshot <time");
});

test("retains the directly addressable update timeline without an extra top badge", async () => {
  const [source, timelineSource] = await Promise.all([
    Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text(),
    Bun.file(new URL("./model-update-timeline.tsx", import.meta.url)).text(),
  ]);
  const overviewIndex = source.indexOf("<OptionSpaceOverview");
  const timelineIndex = source.indexOf("<ModelUpdateTimeline");

  expect(source).not.toContain("latest-update-badge");
  expect(timelineSource).toContain('id="model-updates"');
  expect(timelineSource).toContain('<details className="model-update-timeline__history">');
  expect(timelineIndex).toBeGreaterThan(overviewIndex);
});

test("leaves only the selected benchmark description in the chart header", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).toContain('<header className="chart-header">');
  expect(source).toContain('<p aria-live="polite" className="benchmark-description">');
  expect(source).not.toContain('<p className="chart-subtitle">Compare AI coding models</p>');
  expect(source).not.toContain('className="chart-header-content"');
  expect(source).not.toContain('className="chart-title"');
});

test("leaves the page heading to the task introduction and keeps the domain as the chart watermark", async () => {
  const [source, pageSource] = await Promise.all([
    Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text(),
    Bun.file(new URL("../app/coding/page.tsx", import.meta.url)).text(),
  ]);

  expect(source).not.toContain("<h1");
  expect(source).not.toContain("brand.heading");
  expect(source).toContain("{brand.domain}");
  expect(source).toContain('<h2 className="sr-only" id="coding-agent-chart-title">Coding-agent scatter chart</h2>');
  expect(pageSource).toContain("<h1>Coding agent comparisons</h1>");
  expect(pageSource.match(/<h1\b/gu)).toHaveLength(1);
});

test("keeps chart chrome compact and metric labels semantic-only", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).toContain("const chartHeight = 940");
  expect(source).toContain("const plot = { top: 24, right: 1360, bottom: 860, left: 72 }");
  expect(source).toContain('tooltip="Clear pinned selection"');
  expect(source).toContain('aria-label={label}');
  expect(source).toContain('className="chart-metric-controls chart-selection-boundary"');
  expect(source).toContain("<OptionGridPicker");
  expect(source).toContain('className="chart-benchmark-select"');
  expect(source).not.toContain("<NativeSelectField");
  expect(source).toContain("label: yMetricLabels.aaIndex");
  expect(source).toContain("label: yMetricLabels.deepSwe");
  expect(source).toContain("label: yMetricLabels.terminalBench");
  expect(source).toContain("label: yMetricLabels.sweAtlas");
  expect(source).not.toContain("chart-axis-control");
  expect(source).toContain('className="chart-axis-title chart-export-axis-title"');
  expect(source).not.toContain('className="chart-header-actions"');
  expect(source).toContain('x={plot.left - 12}');
  expect(source).toContain("{formatMetricValue(yMetric, tick)}");
  expect(source).toContain("Hover or select a point for exact values");
  expect(source).toContain("Tap points");
  expect(source).not.toContain('tooltip="Chart controls"');
  expect(source).not.toContain('aria-label="Chart controls"');
  expect(source).not.toContain("KeyboardIcon");
  expect(source).not.toContain("chart-help-control");
  expect(source).not.toContain("chart-help-dialog");
  expect(source).not.toContain("aria-keyshortcuts");
  expect(source).not.toContain('className="metric-control__label"');
  expect(source).not.toContain('className="interaction-guide"');
  expect(source).not.toContain("Hover points or providers to preview</span>");
});

test("chooses a stable score-led three-label reading across the x range", () => {
  const labels = selectRestingCodingAgentLabels([
    { record: { id: "alpha-low", model: "alpha" }, x: 18, yValue: 64 },
    { record: { id: "beta", model: "beta" }, x: 10, yValue: 68 },
    { record: { id: "alpha-high", model: "alpha" }, x: 95, yValue: 70 },
    { record: { id: "delta", model: "delta" }, x: 80, yValue: 61 },
    { record: { id: "gamma", model: "gamma" }, x: 52, yValue: 66 },
  ]);

  expect(labels.map(label => label.record.id)).toEqual(["alpha-high", "beta", "gamma"]);
  expect(new Set(labels.map(label => label.record.model)).size).toBe(3);
  expect(labels.some(label => label.x <= 38.34)).toBeTrue();
  expect(labels.some(label => label.x > 38.34 && label.x <= 66.67)).toBeTrue();
});

test("routes both resting and interaction labels through collision layout and explicit leaders", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).toContain("return selectRestingCodingAgentLabels(chart.labelPoints);");
  expect(source).toContain("layoutChartLabels(");
  expect(source).toContain("visibleLabelPoints.map((point, index)");
  expect(source).toContain('className={`chart-label-leaders${isAtRest ? " is-resting" : ""}`}');
  expect(source).toContain("{visibleLabels.map((label) => {");
});

test("restores hidden axis titles only in exported chart images", async () => {
  const source = await Bun.file(new URL("./chart-export.ts", import.meta.url)).text();

  expect(source).toContain('querySelectorAll<SVGElement>(".chart-export-axis-title")');
  expect(source).toContain('style.setProperty("visibility", "visible")');
});

test("fits both scatter axes to their observed data instead of a zero baseline", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).toContain("computeDomain(xValues, { paddingRatio: 0 })");
  expect(source).toContain("computeDomain(yValues, { paddingRatio: 0 })");
  expect(source).toContain("makeTicks(xDomain)");
  expect(source).toContain("makeTicks(yDomain)");
  expect(source).not.toContain("includeZero: true");
  expect(source).not.toContain("makeNiceTicks(");
});

test("ports point details above chart chrome and routes a leader around visible labels", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).toContain('import { createPortal } from "react-dom"');
  expect(source).toContain("placeChartTooltip(");
  expect(source).toContain('className="chart-tooltip-connector"');
  expect(source).toContain('className="chart-tooltip-connector-line"');
  expect(source).toContain("document.body");
  expect(source).toContain("obstacles: [...labelObstacles, ...pointObstacles]");
  expect(source).not.toContain('hoveredPoint.y < 210 ? "below"');
  expect(source).not.toContain('hoveredPoint.x < 250 ? "near-left"');
});

test("places complementary option-space views below the primary scatter chart", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();
  const metricControlsIndex = source.indexOf('className="chart-metric-controls chart-selection-boundary"');
  const shellIndex = source.indexOf('overflowClassName("chart-scroll-shell"');
  const pinStatusIndex = source.indexOf('className="pin-status"');
  const scatterIndex = source.indexOf('className="chart-scroll"');
  const overviewIndex = source.indexOf("<OptionSpaceOverview");
  const overviewDisclosureIndex = source.indexOf("<summary>Compare configurations and providers</summary>");

  expect(metricControlsIndex).toBeGreaterThan(-1);
  expect(shellIndex).toBeGreaterThan(-1);
  expect(metricControlsIndex).toBeLessThan(shellIndex);
  expect(pinStatusIndex).toBeGreaterThan(shellIndex);
  expect(scatterIndex).toBeGreaterThan(pinStatusIndex);
  expect(scatterIndex).toBeGreaterThan(-1);
  expect(overviewIndex).toBeGreaterThan(scatterIndex);
  expect(overviewDisclosureIndex).toBeGreaterThan(scatterIndex);
  expect(overviewIndex).toBeGreaterThan(overviewDisclosureIndex);
  expect(source).toContain("onPinPoint={(recordId)");
  expect(source).toContain("onPinProvider={(providerId)");
});

test("renders a compact source note, real chart anchor, and closed secondary controls", () => {
  const parsed = parseCodingAgentSnapshot(codingAgentData);
  expect(parsed.ok).toBeTrue();
  if (!parsed.ok) return;
  const html = renderToStaticMarkup(createElement(CodingAgentExplorer, {
    brand: { domain: "aicharts.io" },
    modelCardPaths: {},
    snapshot: parsed.value,
  }));
  const chartIndex = html.indexOf('id="chart"');
  const overviewIndex = html.indexOf("<summary>Compare configurations and providers</summary>");
  const methodIndex = html.indexOf("<summary>Method and data</summary>");
  expect(chartIndex).toBeGreaterThan(-1);
  expect(html.match(/id="chart"/gu)).toHaveLength(1);
  expect(html).toContain('<details class="coding-filter chart-selection-boundary">');
  expect(html).toContain("<summary>Highlight a provider</summary>");
  expect(html.match(/<details class="coding-details chart-selection-boundary">/gu)).toHaveLength(2);
  expect(html).toContain('class="sr-only" id="coding-agent-chart-title"');
  expect(html.indexOf(parsed.value.source.name)).toBeLessThan(chartIndex);
  expect(html.indexOf(formatRetrievedAt(parsed.value.source.retrievedAt))).toBeLessThan(chartIndex);
  expect(overviewIndex).toBeGreaterThan(chartIndex);
  expect(methodIndex).toBeGreaterThan(overviewIndex);
  expect(html.indexOf("This source reports Terminal-Bench v2.1")).toBeGreaterThan(methodIndex);
  expect(html.indexOf('href="/data/coding-agents.json"')).toBeGreaterThan(methodIndex);
  expect(html).toContain('href="/benchmarks?atlas=terminal-bench-4"');
  expect(html).toContain('class="option-picker option-picker--list chart-benchmark-select"');
  expect(html).toContain("<strong>Terminal-Bench v2.1</strong>");
  expect(html).toContain('class="ui-segmented-control__leading"');
  expect(html).toContain(">Cost</button>");
  expect(html).toContain(">Time</button>");
  expect(html).toContain(">Tokens</button>");
  expect(html).toContain('id="model-updates"');
  expect(html).not.toContain('class="chart-resource-nav"');
});

test("generates coding-route share links without changing metric and selection round trips", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();
  expect(source).toContain('const siteUrl = `https://${brand.domain}/coding`;');
  const view = {
    pointKey: "model-agent-setting",
    providerId: null,
    xMetric: "totalTokens" as const,
    yMetric: "terminalBench" as const,
  };
  const link = new URL(buildChartShareUrl("https://aicharts.io/coding", view));
  expect(link.pathname).toBe("/coding");
  expect(parseChartShareView(link.search)).toEqual(view);
  expect(source).toContain("parseChartShareView(search)");
  expect(source).toContain("useSyncExternalStore(subscribeLocationSearch, readLocationSearch, serverLocationSearch)");
  expect(source).toContain("replaceLocationSearch(chartViewSearch(window.location.search");
  expect(source).toContain("createBrandedChartPng(source, chartWidth, chartHeight");
});

test("opening provider, comparison, and method disclosures preserves a pinned selection", () => {
  expect(shouldClearChartSelection(clickTargetWithin("coding-filter", "chart-selection-boundary"))).toBeFalse();
  expect(shouldClearChartSelection(clickTargetWithin("coding-details", "chart-selection-boundary"))).toBeFalse();
  expect(shouldClearChartSelection(clickTargetWithin("provider-filter"))).toBeFalse();
});

test("keeps pinned selections through metric interactions", () => {
  const metricToolbar = clickTargetWithin("chart-metric-controls", "chart-selection-boundary");
  const benchmarkSelect = clickTargetWithin("chart-benchmark-select", "chart-selection-boundary");

  expect(shouldClearChartSelection(metricToolbar)).toBeFalse();
  expect(shouldClearChartSelection(benchmarkSelect)).toBeFalse();
});

test("still treats the unadorned canvas background as click-away space", () => {
  expect(shouldClearChartSelection(clickTargetWithin("chart-canvas"))).toBeTrue();
  expect(shouldClearChartSelection(null)).toBeTrue();
});

test("routes overlapping mobile chart centers by distance instead of SVG order", () => {
  const parsed = parseCodingAgentSnapshot(codingAgentData);
  expect(parsed.ok).toBeTrue();
  if (!parsed.ok) return;
  const visible = recordsWithMetrics(parsed.value.records, "costUsd", "deepSwe");
  const xValues = visible.flatMap(record => xMetricValue(record, "costUsd") ?? []);
  const yValues = visible.flatMap(record => yMetricValue(record, "deepSwe") ?? []);
  const scaleX = linearScale(computeDomain(xValues, { paddingRatio: 0 }), [72, 1360]);
  const scaleY = linearScale(computeDomain(yValues, { paddingRatio: 0 }), [860, 24]);
  const points = visible.map(record => {
    const xValue = xMetricValue(record, "costUsd");
    const yValue = yMetricValue(record, "deepSwe");
    if (xValue === null || yValue === null) throw new Error("Filtered metric invariant failed.");
    return { id: record.id, record, x: scaleX(xValue), y: scaleY(yValue), yValue };
  }).toSorted((left, right) => left.x - right.x);
  const restingLabels = selectRestingCodingAgentLabels(points);
  const initialPhoneViewportRight = 1440 * 390 / 700;
  expect(restingLabels).toHaveLength(3);
  expect(restingLabels.filter(point => point.x <= initialPhoneViewportRight).length).toBeGreaterThanOrEqual(2);
  const composer = visible.find(record => record.agent === "Cursor CLI" && record.modelLabel === "Composer 2.5");
  const deepSeek = visible.find(record => record.agent === "Codex" && record.modelLabel === "DeepSeek V4 Pro 0813 (max)");
  expect(composer).toBeDefined();
  expect(deepSeek).toBeDefined();
  if (composer === undefined || deepSeek === undefined) return;
  const composerPoint = points.find(point => point.id === composer.id);
  const deepSeekPoint = points.find(point => point.id === deepSeek.id);
  expect(composerPoint).toBeDefined();
  expect(deepSeekPoint).toBeDefined();
  if (composerPoint === undefined || deepSeekPoint === undefined) return;

  // The 700px phone canvas used 42-unit hit circles; the later DeepSeek node
  // covered Composer's center even though Composer was the visible tap target.
  expect(Math.hypot(composerPoint.x - deepSeekPoint.x, composerPoint.y - deepSeekPoint.y)).toBeLessThan(42);
  expect(points.indexOf(deepSeekPoint)).toBeGreaterThan(points.indexOf(composerPoint));
  expect(nearestCodingAgentPointId(points, composerPoint.x, composerPoint.y, 50)).toBe(composer.id);
  expect(nearestCodingAgentPointId(points, deepSeekPoint.x, deepSeekPoint.y, 50)).toBe(deepSeek.id);
  expect(nearestCodingAgentPointId(points, 1440, 940, 4)).toBeNull();
});

test("keeps semantic point controls while centralizing physical pointer routing", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).toContain("onPointerMove={handleChartPointerMove}");
  expect(source).toContain("onClick={handleChartClick}");
  expect(source).toContain('role="button"');
  expect(source).toContain('pointerEvents: "none"');
  expect(source).toContain("isAssistiveSvgClick(event.detail)");
  expect(source).toContain('style={pointerPointId === null ? undefined : { cursor: "pointer" }}');
  expect(source).toMatch(/const point = pointForChartEvent\(event\);\s*if \(point === null\) return;\s*event\.stopPropagation\(\);/u);
  expect(source).toMatch(/if \(!isAssistiveSvgClick\(event\.detail\)\) return;\s*event\.stopPropagation\(\);/u);
});
