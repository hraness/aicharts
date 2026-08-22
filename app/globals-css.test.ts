import { expect, test } from "bun:test";

const stylesheet = await Bun.file(new URL("./globals.css", import.meta.url)).text();

function firstRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return stylesheet.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "u"))?.groups?.body ?? "";
}

test("share-link fallback leaves geometry, focus, and paint to the shared field", () => {
  const field = stylesheet.match(
    /\.share-link-fallback \.ui-field__input\s*\{(?<body>[^}]*)\}/u,
  )?.groups?.body ?? "";

  expect(field).not.toMatch(/(?:background|border|border-radius|min-height|outline|padding)\s*:/u);
  expect(field).toContain("font-family: var(--font-mono)");
  expect(stylesheet).not.toContain(".share-link-fallback .ui-field__input:focus-visible");
});

test("chart collections retain shared paint geometry and target sizes", () => {
  const segmentedControl = firstRule(".chart-segmented-control");
  const segmentedItem = firstRule(".chart-segmented-control .ui-segmented-control__item");

  expect(segmentedControl).not.toMatch(/(?:background|border|border-radius|box-shadow|color)\s*:/u);
  expect(segmentedItem).not.toMatch(/(?:background|border|border-radius|box-shadow|color)\s*:/u);
  expect(segmentedItem).toContain("min-height: 28px");
  expect(stylesheet).toMatch(/\.provider-filter \.ui-toggle-group__item\s*\{[^}]*min-height:\s*var\(--interactive-target-min\);/su);
  expect(firstRule(".share-menu .ui-menu__item")).not.toMatch(
    /(?:align-items|background|border|border-radius|box-shadow|min-height|padding)\s*:/u,
  );
  expect(firstRule(".share-menu .ui-menu__leading")).toContain(
    "color: var(--brand-highlight)",
  );
  expect(stylesheet).not.toContain(".share-menu .ui-menu__item > svg");
  expect(stylesheet).toMatch(
    /:root\[data-verification-pointer="coarse"\] \.chart-segmented-control \.ui-segmented-control__item,[\s\S]*?min-height:\s*var\(--interactive-target-min\);/u,
  );
  expect(stylesheet).toMatch(
    /:root\[data-verification-pointer="coarse"\] \.chart-segmented-control \.ui-segmented-control__item\s*\{[^}]*min-width:\s*var\(--interactive-target-min\);/u,
  );
  expect(stylesheet).not.toContain("interaction-guide");
});

test("metric selectors replace the axis labels without consuming header space", () => {
  expect(stylesheet).not.toContain("chart-header-actions");
  expect(stylesheet).not.toContain("chart-controls");
  expect(firstRule(".chart-axis-control")).toContain("position: absolute");
  expect(firstRule(".chart-axis-control--x")).toContain("bottom: 5px");
  expect(firstRule(".chart-axis-control--y")).toContain("top: 47.88%");
  expect(firstRule(".chart-axis-control--y")).toContain(
    "left: calc(env(safe-area-inset-left) + 40px)",
  );
  expect(firstRule(".chart-axis-control--y .metric-control")).toContain("rotate(-90deg)");
  expect(firstRule(".chart-export-axis-title")).toContain("visibility: hidden");
  expect(stylesheet).not.toMatch(
    /@media \(max-width:\s*760px\)[\s\S]*?\.chart-axis-control--y\s*\{/u,
  );
});

test("provider filtering uses one responsive edge inset", () => {
  expect(firstRule(".provider-filter-shell")).not.toMatch(/padding\s*:/u);
  expect(firstRule(
    ".provider-filter-surface.ui-toggle-group__surface:is([data-hovered], [data-focus-within], [data-pressed])",
  )).toContain("--jelly-fill: transparent");
  expect(stylesheet).toMatch(/\.provider-filter\s*\{[^}]*padding-inline:\s*clamp\(12px, 2vw, 24px\);[^}]*scroll-padding-inline:\s*clamp\(12px, 2vw, 24px\);/su);
  expect(stylesheet).not.toMatch(/\.provider-filter\s*\{[^}]*border(?:-[a-z-]+)?:/su);
  expect(stylesheet).not.toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.provider-filter\s*\{[^}]*padding:/u);
});

test("compact chart chrome shares the 12px design inset", () => {
  expect(stylesheet).toContain("--chart-compact-inset: var(--space-3, 0.75rem)");
  expect(stylesheet).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.chart-top-bar\s*\{[^}]*padding-inline:\s*var\(--chart-compact-inset\);/u);
  expect(stylesheet).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.chart-header\s*\{[^}]*padding:\s*var\(--chart-compact-inset\) var\(--chart-compact-inset\) 12px;/u);
  expect(stylesheet).not.toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.chart-axis-control--y\s*\{/u);
  expect(stylesheet).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.chart-footer\s*\{[^}]*padding:\s*10px var\(--chart-compact-inset\) max\(var\(--space-4\), env\(safe-area-inset-bottom\)\);/u);
});

test("homepage document stays in the HTML without taking chart layout", () => {
  expect(firstRule(".home-document")).toContain("clip: rect(0, 0, 0, 0)");
  expect(firstRule(".home-document")).toContain("position: absolute");
  expect(firstRule(".home-document")).not.toMatch(/display\s*:\s*none/u);
  expect(firstRule(".chart-top-bar .chart-heading")).toContain("font-weight: var(--font-weight-bold)");
});

test("homepage leaders stay visible above the chart", () => {
  expect(firstRule(".home-leaders")).not.toMatch(/display\s*:\s*none/u);
  expect(firstRule(".home-leaders")).not.toMatch(/clip\s*:/u);
  expect(firstRule(".home-leaders")).toContain("border-bottom: 1px solid var(--line)");
  expect(firstRule(".home-leaders .plain-publication__table")).toContain("border-collapse: collapse");
});

test("global chart context stays dense in the sticky header", () => {
  expect(firstRule(".chart-top-bar .ui-top-bar__actions")).toContain("gap: 2px");
  expect(firstRule(".chart-top-bar .ui-top-bar__actions")).toContain("min-width: 0");
  expect(stylesheet).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?\.latest-update-badge strong\s*\{[^}]*display:\s*none;/u);
  expect(stylesheet).not.toContain(".chart-subtitle-row");
  expect(stylesheet).not.toContain(".chart-header-content");
});

test("compact icon actions expand to the full touch target on mobile", () => {
  expect(stylesheet).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.chart-provenance-control \.ui-icon-button\[data-size="compact"\],[\s\S]*?\.share-trigger\.ui-icon-button\[data-size="compact"\]\s*\{[^}]*width:\s*var\(--interactive-target-min\);[^}]*height:\s*var\(--interactive-target-min\);[^}]*flex-basis:\s*var\(--interactive-target-min\);/u);
  expect(stylesheet).toMatch(/\.chart-provenance-control \.ui-icon-button\[data-size="compact"\] > \.ui-icon-button__control,[\s\S]*?\.share-trigger\.ui-icon-button\[data-size="compact"\] > \.ui-icon-button__control\s*\{[^}]*width:\s*var\(--interactive-target-min\);[^}]*height:\s*var\(--interactive-target-min\);/u);
  expect(stylesheet).toMatch(/\.share-trigger\.ui-icon-button\[data-size="compact"\] > \.ui-icon-button__control\s*\{[^}]*width:\s*var\(--interactive-target-min\);[^}]*height:\s*var\(--interactive-target-min\);/u);
});

test("chart canvas is full bleed while its header and footer own safe gutters", () => {
  expect(firstRule(".chart-app")).not.toMatch(/padding\s*:/u);
  expect(firstRule(".chart-top-bar")).not.toMatch(/padding-block\s*:/u);
  expect(stylesheet).toContain("--chart-content-inset: clamp(12px, 2vw, 28px)");
  expect(firstRule(".chart-page-canvas")).toContain("margin-inline: 0");
  expect(firstRule(".chart-page-canvas")).toContain("max-width: none");
  expect(firstRule(".chart-page-canvas")).toContain("padding: 0");
  expect(firstRule(".chart-header")).toContain("padding: clamp(12px, 1.5vw, 18px) var(--chart-content-inset) 16px");
  expect(firstRule(".chart-footer")).toContain("padding: 10px var(--chart-content-inset) max(var(--space-4), env(safe-area-inset-bottom))");
});

test("share export floats over the chart with a quiet bounded surface", () => {
  expect(stylesheet).not.toContain(".share-label");
  expect(firstRule(".share-trigger.ui-surface")).toContain("--jelly-color-border-default: transparent");
  expect(firstRule(".share-trigger.ui-surface")).toContain("--jelly-fill: color-mix(in oklch, var(--surface-raised) 92%, transparent)");
  expect(firstRule(".share-control")).toContain("position: absolute");
  expect(firstRule(".share-control")).toContain("right: var(--chart-content-inset)");
  expect(firstRule(".share-control")).toContain("top: var(--chart-compact-inset)");
});

test("chart guidance does not reserve a help row or card stack", () => {
  expect(stylesheet).not.toContain("interaction-guide");
  expect(stylesheet).not.toContain("chart-help");
  expect(firstRule(".pin-status")).toContain("position: absolute");
  expect(firstRule(".pin-status")).toContain("width: max-content");
  expect(firstRule(".pin-status")).not.toMatch(/(?:border|justify-content)\s*:/u);
});

test("the chart declares only horizontal scrolling", () => {
  expect(firstRule(".chart-scroll")).toContain("overflow-x: auto");
  expect(firstRule(".chart-scroll")).not.toContain("overflow-y:");
  expect(firstRule(".chart-app")).toContain("overflow-x: clip");
  expect(firstRule(".chart-page-canvas")).toContain("overflow-x: clip");
  expect(firstRule(".chart-scroll")).toContain("max-width: 100%");
});

test("the persistent header and footer omit promotional credit chrome", () => {
  expect(stylesheet).not.toContain("chart-attribution");
  expect(stylesheet).not.toContain("chart-top-bar-actions");
  expect(stylesheet).not.toContain("chart-footer-credit");
  expect(stylesheet).not.toContain("chart-footer-logo");
});

test("chart labels keep semantic text independent from the data-series palette", () => {
  expect(stylesheet).toMatch(/\.chart-model-label-title\s*\{[^}]*fill:\s*var\(--foreground\);/su);
  expect(stylesheet).not.toMatch(/\.chart-model-label-title\s*\{[^}]*fill:\s*currentColor;/su);
  expect(stylesheet).toMatch(/\.chart-watermark\s*\{[^}]*fill:\s*var\(--foreground\);/su);
  expect(stylesheet).not.toMatch(/\.chart-watermark\s*\{[^}]*opacity:/su);
});

test("point details escape the scroll clip and layer above chart chrome with a leader", () => {
  const tooltip = firstRule(".chart-tooltip");
  const connector = firstRule(".chart-tooltip-connector");

  expect(tooltip).toContain("position: fixed");
  expect(tooltip).toContain("z-index: 900");
  expect(tooltip).not.toContain("transform:");
  expect(connector).toContain("position: fixed");
  expect(connector).toContain("z-index: 899");
  expect(firstRule(".chart-tooltip-connector-line")).toContain("stroke: var(--provider-color)");
  expect(stylesheet).not.toContain(".chart-tooltip.near-left");
  expect(stylesheet).not.toContain(".chart-tooltip.near-right");
  expect(stylesheet).not.toContain(".chart-tooltip.below");
});

test("chart point controls retain a theme-contrast boundary in every state", () => {
  expect(stylesheet).toMatch(/\.chart-point-ring\s*\{[^}]*stroke:\s*var\(--foreground\);[^}]*stroke-opacity:\s*\.55;/su);
  expect(stylesheet).toMatch(/\.chart-point:focus \.chart-point-ring,[\s\S]*?stroke:\s*var\(--foreground\);[\s\S]*?stroke-opacity:\s*1;/u);
  expect(stylesheet).not.toMatch(/\.chart-point-ring\s*\{[^}]*stroke:\s*transparent;/su);
  expect(stylesheet).not.toMatch(/\.chart-point\.is-highlighted \.chart-point-ring\s*\{[^}]*stroke:\s*currentColor;/su);
  expect(stylesheet).toMatch(/\.chart-point\.is-dimmed > :not\(\.chart-point-ring\)\s*\{[^}]*opacity:\s*\.12;/su);
  expect(stylesheet).toMatch(
    /\.chart-point\.is-dimmed:is\(:hover, :focus, \.is-hovered, \.is-active, \.is-highlighted\) > :not\(\.chart-point-ring\)\s*\{[^}]*opacity:\s*1;/su,
  );
  expect(stylesheet).not.toMatch(/\.chart-point\.is-dimmed\s*\{[^}]*opacity:/su);
});

test("option-space charts stay compact, complementary, and single-column on phones", () => {
  expect(firstRule(".option-space-overview")).toContain("border-top: 1px solid var(--grid)");
  expect(firstRule(".option-space-overview")).toContain("clamp(18px, 2.5vw, 28px)");
  expect(stylesheet).not.toContain("option-space-header");
  expect(stylesheet).not.toContain("option-space-eyebrow");
  expect(firstRule(".option-space-grid")).toContain(
    "grid-template-columns: repeat(2, minmax(0, 1fr))",
  );
  expect(firstRule(".option-space-panel .ui-range-plot-chart__rows")).toContain(
    "grid-template-columns: minmax(0, 1fr)",
  );
  expect(stylesheet).toMatch(
    /@media \(max-width:\s*760px\)[\s\S]*?\.option-space-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/u,
  );
});
