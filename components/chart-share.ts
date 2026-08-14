import type { XMetric, YMetric } from "@/lib/chart-math";

const xMetrics = ["costUsd", "durationMinutes", "totalTokens"] as const satisfies readonly XMetric[];
const yMetrics = ["aaIndex", "deepSwe", "terminalBench", "sweAtlas"] as const satisfies readonly YMetric[];

export type ChartShareView = {
  pointKey: string | null;
  providerId: string | null;
  xMetric: XMetric;
  yMetric: YMetric;
};

export type ParsedChartShareView = {
  pointKey: string | null;
  providerId: string | null;
  xMetric: XMetric | null;
  yMetric: YMetric | null;
};

function isXMetric(value: string | null): value is XMetric {
  return value !== null && xMetrics.some((metric) => metric === value);
}

function isYMetric(value: string | null): value is YMetric {
  return value !== null && yMetrics.some((metric) => metric === value);
}

function filenamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 56);
}

export function buildChartShareUrl(baseUrl: string, view: ChartShareView): string {
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("benchmark", view.yMetric);
  url.searchParams.set("compare", view.xMetric);
  if (view.pointKey !== null) url.searchParams.set("point", view.pointKey);
  else if (view.providerId !== null) url.searchParams.set("provider", view.providerId);
  return url.toString();
}

export function parseChartShareView(search: string): ParsedChartShareView {
  const parameters = new URLSearchParams(search);
  const pointKey = parameters.get("point");
  const xMetric = parameters.get("compare");
  const yMetric = parameters.get("benchmark");
  return {
    pointKey,
    providerId: pointKey === null ? parameters.get("provider") : null,
    xMetric: isXMetric(xMetric) ? xMetric : null,
    yMetric: isYMetric(yMetric) ? yMetric : null,
  };
}

export function chartImageFilename(view: ChartShareView, selectionLabel: string | null): string {
  const selection = filenamePart(selectionLabel ?? "") || "all-models";
  return `aicharts-${view.yMetric}-${view.xMetric}-${selection}.png`;
}

export function chartImageShareData(file: File): ShareData {
  return { files: [file] };
}

export function xPostIntentUrl(text: string, url: string): string {
  const intent = new URL("https://x.com/intent/tweet");
  intent.searchParams.set("text", text);
  intent.searchParams.set("url", url);
  return intent.toString();
}
