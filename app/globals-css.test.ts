import { expect, test } from "bun:test";

const stylesheet = await Bun.file(new URL("./globals.css", import.meta.url)).text();

function firstRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return stylesheet.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "u"))?.groups?.body ?? "";
}

test("application resets stay below shared component styles", () => {
  const baseStart = stylesheet.indexOf("@layer base {");
  const baseEnd = stylesheet.indexOf("\n}\n\n:root", baseStart);
  const baseLayer = stylesheet.slice(baseStart, baseEnd + 2);
  const unlayeredStyles = stylesheet.slice(baseEnd + 2);

  expect(baseStart).toBeGreaterThan(0);
  expect(baseEnd).toBeGreaterThan(baseStart);
  expect(baseLayer).toContain("button, input, select, textarea { font: inherit; }");
  expect(baseLayer).toContain("input, select, textarea { color: inherit; }");
  expect(baseLayer).toContain("button:not(:disabled) { cursor: pointer; }");
  expect(baseLayer).toMatch(/a, button, input,[\s\S]*?padding:\s*0;/u);
  expect(unlayeredStyles).not.toMatch(/button,\s*input\s*\{[^}]*font:/u);
  expect(unlayeredStyles).not.toMatch(/button\s*\{[^}]*cursor:/u);
  expect(unlayeredStyles).not.toMatch(/\na\s*\{[^}]*color:\s*inherit;/u);
});

test("native select menus inherit the application theme", () => {
  const baseStart = stylesheet.indexOf("@layer base {");
  const baseEnd = stylesheet.indexOf("\n}\n\n:root", baseStart);
  const baseLayer = stylesheet.slice(baseStart, baseEnd + 2);

  expect(firstRule(":root")).toContain("color-scheme: light");
  expect(firstRule(':root[data-theme="dark"]')).toContain("color-scheme: dark");
  expect(baseLayer).toContain(":where(select) { color-scheme: inherit; }");
  expect(baseLayer).toMatch(/:where\(select > option, select > optgroup, select > optgroup > option\)\s*\{[^}]*background-color:\s*var\(--popover\);[^}]*color:\s*var\(--foreground\);/su);
  expect(baseLayer).toContain(":where(select option:disabled) { color: var(--muted); }");
});

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

test("metric selectors reserve normal-flow space outside the plot", () => {
  expect(stylesheet).not.toContain("chart-header-actions");
  expect(stylesheet).toContain('@import "@hraness/site-footer/styles.css"');
  expect(stylesheet).not.toContain('@import "@hraness/ui/components.css"');
  expect(firstRule(".chart-metric-controls")).toContain("display: grid");
  expect(firstRule(".chart-metric-controls")).toContain("grid-template-columns: minmax(76px, 1fr) auto minmax(76px, 1fr)");
  expect(firstRule(".chart-metric-controls")).not.toContain("position: absolute");
  expect(firstRule(".chart-benchmark-select")).toContain("width: 76px");
  expect(firstRule(".chart-interaction-cue")).toContain("grid-column: 3");
  expect(firstRule(".chart-interaction-cue")).toContain("justify-self: end");
  expect(firstRule(".chart-interaction-cue__touch")).toContain("display: none");
  expect(stylesheet).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.chart-interaction-cue__desktop\s*\{[^}]*display:\s*none;/u);
  expect(stylesheet).toMatch(/@media \(hover:\s*none\), \(pointer:\s*coarse\)[\s\S]*?\.chart-interaction-cue__touch\s*\{[^}]*display:\s*inline;/u);
  expect(stylesheet).not.toContain("chart-axis-control");
  expect(stylesheet).not.toContain("rotate(-90deg)");
  expect(firstRule(".chart-export-axis-title")).toContain("visibility: hidden");
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
  expect(stylesheet).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.chart-header\s*\{[^}]*padding:\s*var\(--chart-compact-inset\) var\(--chart-compact-inset\) 12px;/u);
  expect(firstRule(".chart-metric-controls")).toContain("padding: 6px var(--chart-content-inset)");
  expect(stylesheet).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.chart-resource-nav\s*\{[^}]*padding:\s*10px var\(--chart-compact-inset\) max\(var\(--space-4\), env\(safe-area-inset-bottom\)\);/u);
});

test("homepage has no clipped discovery document", () => {
  expect(stylesheet).not.toContain(".home-document");
  expect(stylesheet).not.toContain(".chart-top-bar");
  expect(stylesheet).not.toContain(".chart-heading");
});

test("homepage orientation is a hairline fact list on the shared section grammar", () => {
  const facts = firstRule(".chart-orientation__facts");
  const fact = firstRule(".chart-orientation__facts > div");

  expect(stylesheet).not.toMatch(/\.chart-orientation\s*\{/u);
  expect(stylesheet).not.toContain(".chart-orientation__eyebrow");
  expect(stylesheet).not.toContain(".chart-orientation h1");
  expect(facts).toContain("border-block-start: 1px solid var(--hraness-marketing-line)");
  expect(facts).toContain("display: grid");
  expect(fact).toContain("border-block-end: 1px solid var(--hraness-marketing-line)");
  expect(fact).not.toMatch(/background\s*:/u);
  expect(firstRule(".chart-orientation__facts dt")).toContain("font-size: .875rem");
  expect(firstRule(".chart-orientation__facts dt")).not.toContain("text-transform");
  expect(firstRule(".chart-orientation__facts dd")).toContain("font-size: 1rem");
});

test("the image-free homepage article is an intentional responsive text card", () => {
  const imageLink = firstRule(".home-editorial__image-link");
  const textCard = firstRule(".home-editorial__text-card");

  expect(imageLink).toContain("aspect-ratio: 16 / 9");
  expect(textCard).toContain("background: var(--surface-raised)");
  expect(textCard).toContain("border: 1px solid var(--grid)");
  expect(textCard).toContain("display: grid");
  expect(textCard).toContain("flex: 1");
  expect(textCard).toContain("text-decoration: none");
  expect(stylesheet).toMatch(/@media \(max-width:\s*42rem\)[\s\S]*?\.home-editorial__grid \.home-editorial__item--text\s*\{[^}]*display:\s*block;/u);
  expect(stylesheet).not.toContain(".home-editorial__grid article > a");
});

test("homepage benchmark guide progressively discloses detail and keeps a readable mobile map", () => {
  const portfolio = firstRule(".home-benchmark-portfolio");
  const snapshots = firstRule(".home-benchmark-portfolio__snapshots");
  const leader = firstRule(".terminal-bench-snapshot__leader");

  expect(portfolio).toContain("border-bottom: 1px solid var(--line)");
  expect(portfolio).toContain("padding: clamp(22px, 3vw, 36px) var(--chart-content-inset)");
  expect(snapshots).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  expect(leader).toContain("grid-template-columns: minmax(0, 1fr) max-content");
  expect(stylesheet).toMatch(/\.home-benchmark-portfolio__protocol > summary,[\s\S]*?min-height:\s*var\(--interactive-target-min\);/u);
  expect(stylesheet).toContain('.home-benchmark-portfolio__protocol[open] > summary::after');
  expect(stylesheet).toContain(".terminal-bench-snapshot__details[open] > summary");
  expect(stylesheet).toContain(".terminal-bench-snapshot__table { min-width: 540px; }");
  expect(stylesheet).toMatch(/@media \(max-width:\s*1100px\)[\s\S]*?\.home-benchmark-portfolio__snapshots\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/u);
  expect(stylesheet).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.home-benchmark-portfolio__table,[\s\S]*?\.home-benchmark-portfolio__table td\s*\{[^}]*display:\s*block;[^}]*width:\s*100%;/u);
  expect(stylesheet).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.home-benchmark-portfolio__mobile-label\s*\{[^}]*display:\s*block;/u);
});

test("the shared footer owns its document-flow placement at every viewport", () => {
  expect(stylesheet).not.toContain(".hraness-site-footer__inner");
});

test("homepage leaders use one owned rule at each outer edge", () => {
  const leaders = firstRule(".home-leaders");
  const tableScroll = firstRule(".home-leaders .plain-publication__table-scroll");
  const table = firstRule(".home-leaders .plain-publication__table");
  const tableHead = firstRule(".home-leaders .plain-publication__table thead th");

  expect(firstRule(".ui-top-bar")).toContain("border-bottom: 1px solid var(--grid)");
  expect(leaders).not.toMatch(/display\s*:\s*none/u);
  expect(leaders).not.toMatch(/clip\s*:/u);
  expect(leaders).toContain("border-bottom: 1px solid var(--line)");
  expect(leaders).not.toMatch(/border-(?:top|block-start)\s*:/u);
  expect(leaders).toContain("padding: 0 var(--chart-content-inset)");
  expect(tableScroll).toContain("border: 0");
  expect(tableScroll).not.toMatch(/border-block\s*:/u);
  expect(tableScroll).toContain("max-width: 100%");
  expect(tableScroll).toContain("overflow-x: auto");
  expect(table).toContain("border-collapse: collapse");
  expect(table).toContain("min-width: 40rem");
  expect(tableHead).toContain("border-top: 0");
  expect(stylesheet).toMatch(/\.home-leaders \.plain-publication__table th,[\s\S]*?\.home-leaders \.plain-publication__table td\s*\{[^}]*border-top:\s*1px solid var\(--line\);/u);
  expect(firstRule(".home-leaders .plain-publication__table caption")).toContain("clip: rect(0, 0, 0, 0)");
  expect(stylesheet).not.toContain(".home-leaders h1");
  expect(stylesheet).not.toContain(".home-leaders h2");
  expect(stylesheet).not.toContain(".home-leaders p");
});

test("shared top bars reserve sticky flow and cannot starve their title", () => {
  const topBar = firstRule(".ui-top-bar");
  const sticky = firstRule(".ui-top-bar[data-sticky]");
  const title = firstRule(".ui-top-bar__title");
  const actions = firstRule(".ui-top-bar__actions");

  expect(topBar).toContain("background: var(--background)");
  expect(topBar).toContain("grid-template-columns: minmax(0, max-content) minmax(0, 1fr)");
  expect(topBar).toContain("isolation: isolate");
  expect(topBar).toContain("padding-block: var(--ui-top-bar-block-padding, .5rem)");
  expect(sticky).toContain("position: sticky");
  expect(sticky).toContain("inset-block-start: 0");
  expect(title).toContain("min-inline-size: 0");
  expect(title).toContain("max-inline-size: min(42vw, 28rem)");
  expect(title).toContain("overflow: hidden");
  expect(title).toContain("text-overflow: ellipsis");
  expect(title).toContain("overflow-wrap: normal");
  expect(title).toContain("white-space: nowrap");
  expect(actions).toContain("flex-wrap: wrap");
  expect(actions).toContain("min-inline-size: 0");
  expect(stylesheet).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?\.ui-top-bar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/u);
  expect(stylesheet).toMatch(/@media \(hover:\s*none\), \(pointer:\s*coarse\)[\s\S]*?\.ui-top-bar :is\(a, button\)[\s\S]*?min-block-size:\s*var\(--interactive-target-min\);/u);
  expect(firstRule(".chart-top-bar")).not.toContain("position: sticky");
  expect(firstRule(".chart-page-canvas")).toContain("scroll-margin-block-start: var(--chart-sticky-header-block-size)");
  expect(firstRule(".model-update-timeline")).toContain("scroll-margin-block-start: calc(var(--chart-sticky-header-block-size) + .75rem)");
});

test("the local resource links are quiet at rest", () => {
  expect(stylesheet).not.toContain(".hraness-brand");
  expect(stylesheet).not.toContain(".hraness-ra-mark");
  expect(firstRule(".chart-resource-nav__links a")).toContain("text-decoration: none");
  expect(firstRule(".chart-resource-nav__links a:hover,\n.chart-resource-nav__links a:focus-visible")).toContain(
    "text-decoration: underline",
  );
});

test("the latest-update badge sits in the coding-agent evidence row", () => {
  expect(firstRule(".chart-family-intro__evidence .latest-update-badge")).toContain("flex-basis: 100%");
  expect(firstRule(".latest-update-badge span")).not.toContain("uppercase");
  expect(stylesheet).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?\.latest-update-badge strong\s*\{[^}]*display:\s*none;/u);
  expect(stylesheet).not.toContain(".chart-subtitle-row");
  expect(stylesheet).not.toContain(".chart-header-content");
});

test("compact icon actions expand to the full touch target on mobile", () => {
  expect(stylesheet).not.toContain("chart-provenance-control");
  expect(stylesheet).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.share-trigger\.ui-icon-button\[data-size="compact"\]\s*\{[^}]*width:\s*var\(--interactive-target-min\);[^}]*height:\s*var\(--interactive-target-min\);[^}]*flex-basis:\s*var\(--interactive-target-min\);/u);
  expect(stylesheet).toMatch(/\.share-trigger\.ui-icon-button\[data-size="compact"\] > \.ui-icon-button__control\s*\{[^}]*width:\s*var\(--interactive-target-min\);[^}]*height:\s*var\(--interactive-target-min\);/u);
});

test("chart canvas is full bleed while its header and resource nav own safe gutters", () => {
  expect(firstRule(".chart-app")).not.toMatch(/padding\s*:/u);
  expect(stylesheet).toContain("--chart-content-inset: clamp(12px, 2vw, 28px)");
  expect(firstRule(".chart-page-canvas")).toContain("margin-inline: 0");
  expect(firstRule(".chart-page-canvas")).toContain("max-width: none");
  expect(firstRule(".chart-page-canvas")).toContain("padding: 0");
  expect(firstRule(".chart-header")).toContain("padding: clamp(12px, 1.5vw, 18px) var(--chart-content-inset) 16px");
  expect(firstRule(".chart-resource-nav")).toContain("padding: 10px var(--chart-content-inset) max(var(--space-4), env(safe-area-inset-bottom))");
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
  expect(firstRule(".chart-app")).toContain("grid-template-columns: minmax(0, 1fr)");
  expect(firstRule(".chart-app")).toContain("overflow-x: clip");
  expect(firstRule(".chart-page-canvas")).toContain("overflow-x: clip");
  expect(firstRule(".chart-scroll")).toContain("max-width: 100%");
  expect(firstRule(".chart-canvas")).toContain("aspect-ratio: 1440 / 940");
  expect(stylesheet).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.chart-canvas\s*\{[^}]*min-width:\s*700px;/u);
});

test("the persistent header and resource nav omit promotional credit chrome", () => {
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
  expect(firstRule(".chart-label-leaders.is-resting .chart-label-leader")).toContain("opacity: .56");
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

test("secondary chart evidence stays behind an accessible compact disclosure", () => {
  expect(firstRule(".option-space-overview")).toContain("border-top: 1px solid var(--grid)");
  expect(firstRule(".option-space-overview")).toContain("display: grid");
  expect(firstRule(".option-space-overview")).toContain("clamp(18px, 2.5vw, 28px)");
  expect(stylesheet).not.toContain("option-space-header");
  expect(stylesheet).not.toContain("option-space-eyebrow");
  expect(firstRule(".option-space-overview__details > summary,\n.model-update-timeline__history > summary")).toContain(
    "min-height: var(--interactive-target-min)",
  );
  expect(firstRule(".option-space-grid")).toContain(
    "grid-template-columns: repeat(2, minmax(0, 1fr))",
  );
  expect(firstRule(".option-space-panel .ui-range-plot-chart__rows")).toContain(
    "grid-template-columns: minmax(0, 1fr)",
  );
  expect(stylesheet).toMatch(
    /@media \(max-width:\s*760px\)[\s\S]*?\.option-space-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/u,
  );
  expect(stylesheet).toMatch(
    /@media \(max-width:\s*760px\)[\s\S]*?\.option-space-overview__header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/u,
  );
});

test("update history keeps its latest signal visible above a compact disclosure", () => {
  expect(stylesheet).toMatch(
    /\.model-update-timeline\s*\{[^}]*border-top:\s*1px solid var\(--grid\);[^}]*display:\s*grid;/u,
  );
  expect(firstRule(".model-update-timeline__current")).toContain("border-block: 1px solid var(--grid)");
  expect(stylesheet).toMatch(/\.model-update-timeline__history\s*\{\s*margin-top:\s*-12px;\s*\}/u);
  expect(stylesheet).toContain('.model-update-timeline__history > summary::after');
  expect(stylesheet).toContain('.model-update-timeline__history[open] > summary::after');
});
