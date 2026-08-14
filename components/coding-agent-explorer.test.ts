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

test("keeps promotional credits out of the persistent chart chrome", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).toContain('<HranessBrand className="chart-footer-hraness" />');
  expect(source).not.toContain("by @0thernet");
  expect(source).not.toContain("https://x.com/0thernet");
  expect(source).not.toContain("Zo Computer");
  expect(source).not.toContain("zo-pegasus.svg");
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

test("tucks data provenance behind a compact named control", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();
  const topBarIndex = source.indexOf("<TopBar");
  const provenanceIndex = source.indexOf('className="chart-provenance-control chart-selection-boundary"');
  const pageCanvasIndex = source.indexOf("<PageCanvas");

  expect(source).toContain('tooltip="Data provenance"');
  expect(source).toContain('aria-label="Data provenance"');
  expect(source).toContain('textValue="Open Artificial Analysis source"');
  expect(source).toContain('className="chart-provenance-control chart-selection-boundary"');
  expect(source).toContain('placement="bottom end"');
  expect(source).toContain('popoverClassName="share-menu-popover provenance-menu-popover chart-selection-boundary"');
  expect(provenanceIndex).toBeGreaterThan(topBarIndex);
  expect(provenanceIndex).toBeLessThan(pageCanvasIndex);
  expect(source).not.toContain('className="chart-subtitle-row"');
  expect(source).not.toContain('className="chart-data-status"');
});

test("links the latest data-derived update badge to the bottom timeline", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();
  const badgeIndex = source.indexOf('className="latest-update-badge chart-selection-boundary"');
  const pageCanvasIndex = source.indexOf("<PageCanvas");
  const overviewIndex = source.indexOf("<OptionSpaceOverview");
  const timelineIndex = source.indexOf("<ModelUpdateTimeline");
  const footerIndex = source.indexOf('<footer className="chart-footer">');

  expect(source).toContain('className="latest-update-badge chart-selection-boundary"');
  expect(source).toContain("aria-label={`Latest update: ${latestUpdate.summary}, ${formatUpdateDate(latestUpdate.detectedAt)}`}");
  expect(source).toContain('href="#model-updates"');
  expect(source).toContain("latestUpdate.summary");
  expect(badgeIndex).toBeLessThan(pageCanvasIndex);
  expect(timelineIndex).toBeGreaterThan(overviewIndex);
  expect(footerIndex).toBeGreaterThan(timelineIndex);
});

test("leaves only the selected benchmark description in the chart header", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).toContain('<header className="chart-header">');
  expect(source).toContain('<p aria-live="polite" className="benchmark-description">');
  expect(source).not.toContain('<p className="chart-subtitle">Compare AI coding models</p>');
  expect(source).not.toContain('className="chart-header-content"');
  expect(source).not.toContain('className="chart-title"');
});

test("keeps chart chrome compact and metric labels semantic-only", async () => {
  const source = await Bun.file(new URL("./coding-agent-explorer.tsx", import.meta.url)).text();

  expect(source).toContain("const plot = { top: 24, right: 1360, bottom: 1240, left: 72 }");
  expect(source).toContain('tooltip="Clear pinned selection"');
  expect(source).toContain('aria-label={label}');
  expect(source).toContain('className="chart-axis-control chart-axis-control--y chart-selection-boundary"');
  expect(source).toContain('className="chart-axis-control chart-axis-control--x chart-selection-boundary"');
  expect(source).toContain('className="chart-axis-title chart-export-axis-title"');
  expect(source).not.toContain('className="chart-header-actions"');
  expect(source).not.toContain('className="chart-controls"');
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
  const shellIndex = source.indexOf('overflowClassName("chart-scroll-shell"');
  const pinStatusIndex = source.indexOf('className="pin-status"');
  const yAxisControlIndex = source.indexOf('className="chart-axis-control chart-axis-control--y');
  const xAxisControlIndex = source.indexOf('className="chart-axis-control chart-axis-control--x');
  const scatterIndex = source.indexOf('className="chart-scroll"');
  const overviewIndex = source.indexOf("<OptionSpaceOverview");
  const footerIndex = source.indexOf('<footer className="chart-footer">');

  expect(shellIndex).toBeGreaterThan(-1);
  expect(pinStatusIndex).toBeGreaterThan(shellIndex);
  expect(yAxisControlIndex).toBeGreaterThan(shellIndex);
  expect(xAxisControlIndex).toBeGreaterThan(yAxisControlIndex);
  expect(scatterIndex).toBeGreaterThan(pinStatusIndex);
  expect(scatterIndex).toBeGreaterThan(xAxisControlIndex);
  expect(scatterIndex).toBeGreaterThan(-1);
  expect(overviewIndex).toBeGreaterThan(scatterIndex);
  expect(footerIndex).toBeGreaterThan(overviewIndex);
  expect(source).toContain("onPinPoint={(recordId)");
  expect(source).toContain("onPinProvider={(providerId)");
});

test("keeps pinned selections through provenance interactions", () => {
  const provenanceTrigger = clickTargetWithin("chart-provenance-control", "chart-selection-boundary");
  const portalledProvenanceContent = clickTargetWithin("provenance-menu-popover", "chart-selection-boundary");

  expect(shouldClearChartSelection(provenanceTrigger)).toBeFalse();
  expect(shouldClearChartSelection(portalledProvenanceContent)).toBeFalse();
});

test("still treats the unadorned canvas background as click-away space", () => {
  expect(shouldClearChartSelection(clickTargetWithin("chart-canvas"))).toBeTrue();
  expect(shouldClearChartSelection(null)).toBeTrue();
});
