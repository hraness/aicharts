import { describe, expect, test } from "bun:test";

import { formatRetrievedAt, shouldClearChartSelection } from "./coding-agent-explorer";

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
  expect(source).toContain('className="chart-resource-nav"');
  expect(source).not.toContain("by @0thernet");
  expect(source).not.toContain("https://x.com/0thernet");
  expect(source).not.toContain("Zo Computer");
  expect(source).not.toContain("zo-pegasus.svg");
});

test("links the chart to crawlable data and analysis resources", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).toContain('aria-label="AI Charts resources"');
  expect(source).toContain('<Link href="/data">Data</Link>');
  expect(source).toContain('<Link href="/blog">Analysis</Link>');
});

test("opts the visualization canvas into the shared full-bleed contract", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).toMatch(/<PageCanvas[\s\S]*?className="chart-page-canvas"[\s\S]*?inset="none"[\s\S]*?size="full"/u);
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

test("keeps the header compact without a standalone provenance action", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();
  const topBarIndex = source.indexOf("<TopBar");
  const themeIndex = source.indexOf('<ThemeMenuButton aria-label="Chart appearance" />');
  const topBarClassIndex = source.indexOf('className="chart-top-bar"', topBarIndex);
  const pageCanvasIndex = source.indexOf("<PageCanvas");

  expect(source).not.toContain('tooltip="Data provenance"');
  expect(source).not.toContain('aria-label="Data provenance"');
  expect(source).not.toContain('className="chart-provenance-control');
  expect(source).not.toContain("InformationCircleIcon");
  expect(themeIndex).toBeGreaterThan(topBarIndex);
  expect(themeIndex).toBeLessThan(topBarClassIndex);
  expect(source.slice(themeIndex, topBarClassIndex)).toMatch(
    /<ThemeMenuButton aria-label="Chart appearance" \/>\s*<\/>\s*\)\}/u,
  );
  expect(themeIndex).toBeLessThan(pageCanvasIndex);
  expect(source).not.toContain('className="chart-subtitle-row"');
  expect(source).not.toContain('className="chart-data-status"');
});

test("keeps the compact orientation and working chart ahead of deeper evidence", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();
  const topBarIndex = source.indexOf("<TopBar");
  const pageCanvasIndex = source.indexOf("<PageCanvas", topBarIndex);
  const orientationIndex = source.indexOf('className="chart-orientation"', pageCanvasIndex);
  const chartHeaderIndex = source.indexOf('<header className="chart-header">', pageCanvasIndex);
  const overviewIndex = source.indexOf("<OptionSpaceOverview", chartHeaderIndex);
  const childrenIndex = source.indexOf("{children}", pageCanvasIndex);

  expect(source).toContain("children: ReactNode");
  expect(pageCanvasIndex).toBeGreaterThan(topBarIndex);
  expect(orientationIndex).toBeGreaterThan(pageCanvasIndex);
  expect(chartHeaderIndex).toBeGreaterThan(orientationIndex);
  expect(overviewIndex).toBeGreaterThan(chartHeaderIndex);
  expect(childrenIndex).toBeGreaterThan(overviewIndex);
  expect(source).toContain("codingAgentDatasetSummary(snapshot)");
  expect(source).toContain("A benchmark portfolio for the work AI systems are asked to do");
  expect(source).toContain("Five benchmark roles cover terminal engineering, scientific workflows");
  expect(source).toContain("This source still reports Terminal-Bench v2.1");
  expect(source).toContain('href={snapshot.source.url}');
  expect(source).toContain("{snapshot.source.name} source");
  expect(source).toContain('<Link href="/data">Method</Link>');
  expect(source).toContain('<a href="/data/coding-agents.json">JSON</a>');
});

test("links the latest data-derived update badge to the bottom timeline", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();
  const badgeIndex = source.indexOf('className="latest-update-badge chart-selection-boundary"');
  const pageCanvasIndex = source.indexOf("<PageCanvas");
  const overviewIndex = source.indexOf("<OptionSpaceOverview");
  const timelineIndex = source.indexOf("<ModelUpdateTimeline");
  const resourceNavIndex = source.indexOf('className="chart-resource-nav"');

  expect(source).toContain('className="latest-update-badge chart-selection-boundary"');
  expect(source).toContain("aria-label={`Latest update: ${latestUpdate.summary}, ${formatUpdateDate(latestUpdate.detectedAt)}`}");
  expect(source).toContain('href="#model-updates"');
  expect(source).toContain("latestUpdate.summary");
  expect(badgeIndex).toBeLessThan(pageCanvasIndex);
  expect(timelineIndex).toBeGreaterThan(overviewIndex);
  expect(resourceNavIndex).toBeGreaterThan(timelineIndex);
});

test("leaves only the selected benchmark description in the chart header", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).toContain('<header className="chart-header">');
  expect(source).toContain('<p aria-live="polite" className="benchmark-description">');
  expect(source).not.toContain('<p className="chart-subtitle">Compare AI coding models</p>');
  expect(source).not.toContain('className="chart-header-content"');
  expect(source).not.toContain('className="chart-title"');
});

test("uses a portfolio heading while keeping the domain in compact product chrome", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).toContain('<p className="chart-heading">{brand.heading}</p>');
  expect(source).toContain('<h1 id="chart-orientation-title">A benchmark portfolio for the work AI systems are asked to do</h1>');
  expect(source.match(/<h1/gu)).toHaveLength(1);
  expect(source).not.toContain("<h1>{brand.domain}</h1>");
});

test("keeps chart chrome compact and metric labels semantic-only", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).toContain("const plot = { top: 24, right: 1360, bottom: 1240, left: 72 }");
  expect(source).toContain('tooltip="Clear pinned selection"');
  expect(source).toContain('aria-label={label}');
  expect(source).toContain('className="chart-metric-controls chart-selection-boundary"');
  expect(source).toContain('<NativeSelectField');
  expect(source).toContain('className="chart-benchmark-select"');
  expect(source).toContain('label: "AAI"');
  expect(source).toContain('label: "DSWE"');
  expect(source).toContain('label: "TB"');
  expect(source).toContain('label: "SWEA"');
  expect(source).not.toContain("chart-axis-control");
  expect(source).toContain('className="chart-axis-title chart-export-axis-title"');
  expect(source).not.toContain('className="chart-header-actions"');
  expect(source).not.toContain('x={plot.left - 14}');
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
  const resourceNavIndex = source.indexOf('className="chart-resource-nav"');

  expect(metricControlsIndex).toBeGreaterThan(-1);
  expect(shellIndex).toBeGreaterThan(-1);
  expect(metricControlsIndex).toBeLessThan(shellIndex);
  expect(pinStatusIndex).toBeGreaterThan(shellIndex);
  expect(scatterIndex).toBeGreaterThan(pinStatusIndex);
  expect(scatterIndex).toBeGreaterThan(-1);
  expect(overviewIndex).toBeGreaterThan(scatterIndex);
  expect(resourceNavIndex).toBeGreaterThan(overviewIndex);
  expect(source).toContain("onPinPoint={(recordId)");
  expect(source).toContain("onPinProvider={(providerId)");
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
