import { BENCHMARK_ATLAS_CATEGORIES, type BenchmarkAtlasCategory, type BenchmarkAtlasDataset, type BenchmarkAtlasEntry } from "./benchmark-atlas";

export type AtlasView = "ranking" | "cost" | "table";
export type AtlasViewState = Readonly<{ benchmarkId: string; category: BenchmarkAtlasCategory | "all"; view: AtlasView; pointId: string | null; compareIds: readonly string[]; provider: string | null; expanded: boolean; bestPerModel: boolean }>;

/** URL values can select only published benchmarks and observations. */
export function parseAtlasView(search: string, entries: readonly BenchmarkAtlasEntry[], datasets: readonly BenchmarkAtlasDataset[]): AtlasViewState {
  const params = new URLSearchParams(search);
  const requestedCategory = params.get("task");
  const category = BENCHMARK_ATLAS_CATEGORIES.find(value => value === requestedCategory) ?? "all";
  const available = category === "all" ? entries : entries.filter(entry => entry.category === category);
  const requested = entries.find(entry => entry.id === params.get("atlas") && (category === "all" || category === entry.category));
  const entry = requested ?? available.find(entry => entry.coverage === "charted") ?? available[0] ?? entries[0];
  const benchmarkId = entry?.id ?? "";
  const dataset = datasets.find(item => item.benchmarkId === benchmarkId);
  const ids = new Set(dataset?.points.map(point => point.id) ?? []);
  const requestedPoint = params.get("atlasPoint");
  const requestedView = params.get("atlasView");
  const view = requestedView === "table" ? "table" : requestedView === "cost" && dataset?.points.some(point => point.costUsd !== null && point.costUsd > 0) ? "cost" : "ranking";
  const compareIds = [...new Set(params.getAll("atlasCompare").filter(id => ids.has(id)))].slice(0, 3);
  const provider = dataset?.points.find(point => point.provider === params.get("atlasProvider"))?.provider ?? null;
  return { benchmarkId, category, view, pointId: requestedPoint !== null && ids.has(requestedPoint) ? requestedPoint : null, compareIds, provider, expanded: params.get("atlasAll") === "1", bestPerModel: params.get("atlasProfiles") !== "all" };
}

export function atlasViewSearch(state: AtlasViewState): string {
  const params = new URLSearchParams();
  params.set("atlas", state.benchmarkId);
  if (state.category !== "all") params.set("task", state.category);
  if (state.view !== "ranking") params.set("atlasView", state.view);
  if (state.pointId !== null) params.set("atlasPoint", state.pointId);
  for (const id of state.compareIds.slice(0, 3)) params.append("atlasCompare", id);
  if (state.provider !== null) params.set("atlasProvider", state.provider);
  if (state.expanded) params.set("atlasAll", "1");
  if (!state.bestPerModel) params.set("atlasProfiles", "all");
  return `?${params.toString()}`;
}

export const ATLAS_CATEGORY_LABELS: Readonly<Record<BenchmarkAtlasCategory | "all", string>> = {
  all: "All tasks", general: "General", coding: "Coding", reasoning: "Reasoning", research: "Research", memory: "Memory", image: "Images", video: "Video", audio: "Audio", world: "World models", science: "Science", work: "Work", "computer-use": "Computer use",
};

export function formatAtlasScore(value: number, unit: string, exact = false): string {
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: exact ? 8 : Math.abs(value) < 1 ? 4 : 2 }).format(value);
  return unit === "%" ? `${formatted}%` : `${formatted}${unit && unit !== "points" && unit !== "score" ? ` ${unit}` : ""}`;
}

export function formatAtlasCost(value: number | null): string {
  return value === null ? "Not reported" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 4 : 2 }).format(value);
}
