const svgNamespace = "http://www.w3.org/2000/svg";
const exportSummaryHeight = 112;
const providerLegendGutter = 84;
const providerLegendRowHeight = 30;

const exportedStyleProperties = [
  "color",
  "display",
  "fill",
  "fill-opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "opacity",
  "paint-order",
  "r",
  "shape-rendering",
  "stroke",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "text-rendering",
  "visibility",
] as const;

export type ChartImageDetails = {
  context: string;
  domain: string;
  freshness: string;
  providers: readonly {
    color: string;
    colorHigh: string;
    colorLow: string;
    name: string;
  }[];
  selection: string;
};

type ProviderLegendPlacement = {
  displayName: string;
  index: number;
  provider: ChartImageDetails["providers"][number];
  x: number;
  y: number;
};

type ChartExportTheme = Readonly<{
  background: string;
  foreground: string;
  grid: string;
  muted: string;
}>;

function concise(value: string, maximumLength: number): string {
  return value.length <= maximumLength ? value : `${value.slice(0, maximumLength - 1).trimEnd()}…`;
}

function copyRenderedStyles(source: SVGSVGElement, clone: SVGSVGElement): void {
  const sourceElements: Element[] = [source, ...source.querySelectorAll("*")];
  const cloneElements: Element[] = [clone, ...clone.querySelectorAll("*")];
  if (sourceElements.length !== cloneElements.length) throw new Error("Chart clone did not preserve its SVG structure.");

  for (const [index, sourceElement] of sourceElements.entries()) {
    const cloneElement = cloneElements[index];
    if (!(cloneElement instanceof SVGElement || cloneElement instanceof HTMLElement)) continue;
    const renderedStyle = getComputedStyle(sourceElement);
    for (const property of exportedStyleProperties) {
      const value = renderedStyle.getPropertyValue(property);
      if (value !== "") cloneElement.style.setProperty(property, value);
    }
  }
}

function appendText(
  parent: SVGSVGElement,
  value: string,
  options: {
    anchor?: "end" | "start";
    fill: string;
    fontSize: number;
    fontWeight?: number;
    x: number;
    y: number;
  },
): void {
  const text = document.createElementNS(svgNamespace, "text");
  text.setAttribute("fill", options.fill);
  text.setAttribute("font-family", "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif");
  text.setAttribute("font-size", String(options.fontSize));
  text.setAttribute("font-weight", String(options.fontWeight ?? 400));
  text.setAttribute("text-anchor", options.anchor ?? "start");
  text.setAttribute("x", String(options.x));
  text.setAttribute("y", String(options.y));
  text.textContent = value;
  parent.append(text);
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error("The browser could not encode the chart image."));
      else resolve(blob);
    }, "image/png");
  });
}

function readChartExportTheme(): ChartExportTheme {
  const readColorToken = (name: string): string => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    probe.style.position = "fixed";
    probe.style.visibility = "hidden";
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    if (value === "") throw new Error(`The chart theme is missing ${name}.`);
    return value;
  };
  return {
    background: readColorToken("--background"),
    foreground: readColorToken("--foreground"),
    grid: readColorToken("--grid"),
    muted: readColorToken("--muted"),
  };
}

function layoutProviderLegend(
  providers: ChartImageDetails["providers"],
  chartWidth: number,
): { height: number; placements: ProviderLegendPlacement[] } {
  if (providers.length === 0) return { height: 0, placements: [] };
  const left = 48 + providerLegendGutter;
  const right = chartWidth - 48;
  let row = 0;
  let x = left;
  const placements: ProviderLegendPlacement[] = [];

  providers.forEach((provider, index) => {
    const displayName = concise(provider.name, 24);
    const itemWidth = Math.max(68, 48 + displayName.length * 7.5);
    if (x > left && x + itemWidth > right) {
      row += 1;
      x = left;
    }
    placements.push({
      displayName,
      index,
      provider,
      x,
      y: exportSummaryHeight + 20 + row * providerLegendRowHeight,
    });
    x += itemWidth;
  });

  return {
    height: (row + 1) * providerLegendRowHeight,
    placements,
  };
}

function appendProviderLegend(
  parent: SVGSVGElement,
  placements: readonly ProviderLegendPlacement[],
  theme: ChartExportTheme,
): void {
  const firstPlacement = placements[0];
  if (firstPlacement === undefined) return;
  const definitions = document.createElementNS(svgNamespace, "defs");
  parent.append(definitions);

  for (const placement of placements) {
    const gradientId = `codingchart-provider-${placement.index}`;
    const gradient = document.createElementNS(svgNamespace, "linearGradient");
    gradient.setAttribute("id", gradientId);
    gradient.setAttribute("x1", "0%");
    gradient.setAttribute("x2", "100%");
    for (const [offset, color] of [
      ["0%", placement.provider.colorLow],
      ["50%", placement.provider.color],
      ["100%", placement.provider.colorHigh],
    ] as const) {
      const stop = document.createElementNS(svgNamespace, "stop");
      stop.setAttribute("offset", offset);
      stop.setAttribute("stop-color", color);
      gradient.append(stop);
    }
    definitions.append(gradient);

    const swatch = document.createElementNS(svgNamespace, "rect");
    swatch.setAttribute("fill", `url(#${gradientId})`);
    swatch.setAttribute("height", "8");
    swatch.setAttribute("rx", "2");
    swatch.setAttribute("width", "18");
    swatch.setAttribute("x", String(placement.x));
    swatch.setAttribute("y", String(placement.y - 9));
    parent.append(swatch);
    appendText(parent, placement.displayName, {
      fill: theme.foreground,
      fontSize: 13,
      x: placement.x + 26,
      y: placement.y,
    });
  }

  appendText(parent, "PROVIDER", {
    fill: theme.muted,
    fontSize: 10,
    fontWeight: 550,
    x: 48,
    y: firstPlacement.y,
  });
}

export async function createBrandedChartPng(
  source: SVGSVGElement,
  chartWidth: number,
  chartHeight: number,
  details: ChartImageDetails,
): Promise<Blob> {
  await document.fonts.ready;

  const theme = readChartExportTheme();
  const providerLegend = layoutProviderLegend(details.providers, chartWidth);
  const exportHeaderHeight = exportSummaryHeight + providerLegend.height;

  const clonedNode = source.cloneNode(true);
  if (!(clonedNode instanceof SVGSVGElement)) throw new Error("The chart could not be cloned for export.");
  copyRenderedStyles(source, clonedNode);
  clonedNode.querySelectorAll("desc, foreignObject, .chart-point-hit").forEach((element) => element.remove());
  clonedNode.querySelectorAll<SVGElement>(".chart-export-axis-title").forEach((element) => {
    element.style.setProperty("visibility", "visible");
  });
  clonedNode.removeAttribute("aria-describedby");
  clonedNode.removeAttribute("aria-label");
  clonedNode.removeAttribute("role");
  clonedNode.setAttribute("height", String(chartHeight));
  clonedNode.setAttribute("width", String(chartWidth));
  clonedNode.setAttribute("x", "0");
  clonedNode.setAttribute("y", String(exportHeaderHeight));
  clonedNode.style.setProperty("height", `${chartHeight}px`);
  clonedNode.style.setProperty("width", `${chartWidth}px`);

  const imageHeight = chartHeight + exportHeaderHeight;
  const exportedSvg = document.createElementNS(svgNamespace, "svg");
  exportedSvg.setAttribute("height", String(imageHeight));
  exportedSvg.setAttribute("viewBox", `0 0 ${chartWidth} ${imageHeight}`);
  exportedSvg.setAttribute("width", String(chartWidth));
  exportedSvg.setAttribute("xmlns", svgNamespace);

  const background = document.createElementNS(svgNamespace, "rect");
  background.setAttribute("fill", theme.background);
  background.setAttribute("height", String(imageHeight));
  background.setAttribute("width", String(chartWidth));
  exportedSvg.append(background);

  appendText(exportedSvg, details.domain, {
    fill: theme.foreground,
    fontSize: 25,
    fontWeight: 650,
    x: 48,
    y: 43,
  });
  appendText(exportedSvg, concise(details.context, 104), {
    fill: theme.muted,
    fontSize: 15,
    x: 48,
    y: 76,
  });
  appendText(exportedSvg, concise(details.freshness, 72), {
    anchor: "end",
    fill: theme.muted,
    fontSize: 14,
    x: chartWidth - 48,
    y: 42,
  });
  appendText(exportedSvg, concise(details.selection, 72), {
    anchor: "end",
    fill: theme.foreground,
    fontSize: 15,
    fontWeight: 550,
    x: chartWidth - 48,
    y: 76,
  });
  appendProviderLegend(exportedSvg, providerLegend.placements, theme);

  const divider = document.createElementNS(svgNamespace, "line");
  divider.setAttribute("stroke", theme.grid);
  divider.setAttribute("stroke-width", "1");
  divider.setAttribute("x1", "0");
  divider.setAttribute("x2", String(chartWidth));
  divider.setAttribute("y1", String(exportHeaderHeight - 1));
  divider.setAttribute("y2", String(exportHeaderHeight - 1));
  exportedSvg.append(divider, clonedNode);

  const serialized = new XMLSerializer().serializeToString(exportedSvg);
  const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error("The browser could not render the chart image.")), { once: true });
      image.src = svgUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.height = imageHeight;
    canvas.width = chartWidth;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("The browser could not create an image canvas.");
    context.fillStyle = theme.background;
    context.fillRect(0, 0, chartWidth, imageHeight);
    context.drawImage(image, 0, 0, chartWidth, imageHeight);
    return await canvasBlob(canvas);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export function downloadChartPng(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = url;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
