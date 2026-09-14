import { isCredentialFreeHttpsUrl } from "./credential-free-https-url";
import { err, ok, type Result } from "./result";

export const BENCHMARK_ATLAS_CATEGORIES = [
  "general", "coding", "science", "work", "computer-use", "reasoning",
  "memory", "research", "image", "video", "audio", "world",
] as const;

export type BenchmarkAtlasCategory = typeof BENCHMARK_ATLAS_CATEGORIES[number];
export type BenchmarkAtlasCoverage = "charted" | "source-only" | "watchlist";

/** Discovery metadata is separate from observations: a source link is not a measured result. */
export type BenchmarkAtlasEntry = Readonly<{
  id: string;
  name: string;
  version: string;
  category: BenchmarkAtlasCategory;
  question: string;
  summary: string;
  source: Readonly<{ name: string; url: string; methodologyUrl?: string }>;
  measure: string;
  comparisonRule: string;
  limitations: readonly string[];
  coverage: BenchmarkAtlasCoverage;
  tags: readonly string[];
}>;

export type BenchmarkAtlasPoint = Readonly<{
  id: string;
  label: string;
  model: string;
  provider: string;
  harness: string | null;
  effort: string | null;
  score: number;
  costUsd: number | null;
  uncertainty: Readonly<{ lower: number; upper: number; label: string }> | null;
  sourceUrl: string;
  details?: readonly Readonly<{ label: string; value: string }>[];
}>;

/** One dataset has one source, version, score meaning, and comparison boundary. */
export type BenchmarkAtlasDataset = Readonly<{
  benchmarkId: string;
  version: string;
  score: Readonly<{
    label: string;
    unit: string;
    direction: "higher" | "lower";
    minimum?: number;
    maximum?: number;
  }>;
  source: Readonly<{ name: string; url: string; retrievedAt: string; revision?: string }>;
  observedAt?: string;
  evidenceLabel?: string;
  configurationLabel: string;
  comparabilityNote: string;
  costLabel?: string;
  points: readonly BenchmarkAtlasPoint[];
}>;

export type BenchmarkAtlasSelection = Readonly<{
  category?: BenchmarkAtlasCategory | "all";
  query?: string;
}>;

export function selectAtlasEntries(
  entries: readonly BenchmarkAtlasEntry[],
  selection: BenchmarkAtlasSelection = {},
): BenchmarkAtlasEntry[] {
  const terms = (selection.query ?? "").trim().toLocaleLowerCase("en-US").split(/\s+/u).filter(Boolean);
  return entries.filter(entry => {
    if (selection.category !== undefined && selection.category !== "all" && entry.category !== selection.category) return false;
    const searchable = [entry.name, entry.version, entry.category, entry.question, entry.summary, entry.measure, ...entry.tags]
      .join(" ").toLocaleLowerCase("en-US");
    return terms.every(term => searchable.includes(term));
  });
}

export function sortAtlasPoints(dataset: BenchmarkAtlasDataset): BenchmarkAtlasPoint[] {
  const direction = dataset.score.direction === "higher" ? -1 : 1;
  return [...dataset.points].sort((left, right) => (
    direction * (left.score - right.score)
    || left.label.localeCompare(right.label, "en")
    || left.id.localeCompare(right.id, "en")
  ));
}

/** Keep distinct evaluated systems; effort-only cohorts remain useful in full. Input is score-ranked. */
export function selectAtlasModelProfiles(points: readonly BenchmarkAtlasPoint[]): BenchmarkAtlasPoint[] {
  const best = new Map<string, BenchmarkAtlasPoint>();
  for (const point of points) {
    const key = JSON.stringify([point.provider, point.model, point.harness]);
    if (!best.has(key)) best.set(key, point);
  }
  return best.size <= 1 ? [...points] : [...best.values()];
}

export function atlasDatasetSummary(dataset: BenchmarkAtlasDataset): Readonly<{
  configurationCount: number;
  modelCount: number;
  providerCount: number;
  costCount: number;
  leader: BenchmarkAtlasPoint | null;
}> {
  return {
    configurationCount: dataset.points.length,
    modelCount: new Set(dataset.points.map(point => JSON.stringify([point.provider, point.model]))).size,
    providerCount: new Set(dataset.points.map(point => point.provider)).size,
    costCount: dataset.points.filter(point => point.costUsd !== null).length,
    leader: sortAtlasPoints(dataset)[0] ?? null,
  };
}

/** Assert publication claims and chart bounds after source-owned parsers have admitted data. */
export function validateAtlasCatalog(
  entries: readonly BenchmarkAtlasEntry[],
  datasets: readonly BenchmarkAtlasDataset[],
): Result<true, Error> {
  const entryById = new Map<string, BenchmarkAtlasEntry>();
  for (const entry of entries) {
    if (entryById.has(entry.id)) return err(new Error(`Duplicate benchmark catalog id: ${entry.id}.`));
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.id)) return err(new Error(`Invalid benchmark catalog id: ${entry.id}.`));
    if (!isCredentialFreeHttpsUrl(entry.source.url) || (entry.source.methodologyUrl !== undefined && !isCredentialFreeHttpsUrl(entry.source.methodologyUrl))) {
      return err(new Error(`Invalid source URL for benchmark ${entry.id}.`));
    }
    entryById.set(entry.id, entry);
  }
  const datasetIds = new Set<string>();
  for (const dataset of datasets) {
    const entry = entryById.get(dataset.benchmarkId);
    if (entry === undefined) return err(new Error(`Dataset has no catalog entry: ${dataset.benchmarkId}.`));
    if (entry.coverage !== "charted") return err(new Error(`Measured dataset must be marked charted: ${entry.id}.`));
    if (entry.version !== dataset.version) return err(new Error(`Benchmark version mismatch for ${entry.id}: ${entry.version} / ${dataset.version}.`));
    if (datasetIds.has(dataset.benchmarkId)) return err(new Error(`Duplicate benchmark dataset: ${entry.id}.`));
    if (dataset.points.length === 0) return err(new Error(`Charted benchmark has no observations: ${entry.id}.`));
    if (!isCredentialFreeHttpsUrl(dataset.source.url) || !Number.isFinite(Date.parse(dataset.source.retrievedAt))) {
      return err(new Error(`Invalid dataset provenance for ${entry.id}.`));
    }
    if (dataset.observedAt !== undefined && !Number.isFinite(Date.parse(dataset.observedAt))) {
      return err(new Error(`Invalid observation date for ${entry.id}.`));
    }
    const { minimum, maximum } = dataset.score;
    if ((minimum !== undefined && !Number.isFinite(minimum)) || (maximum !== undefined && !Number.isFinite(maximum)) || (minimum !== undefined && maximum !== undefined && minimum >= maximum)) {
      return err(new Error(`Invalid score domain for ${entry.id}.`));
    }
    const pointIds = new Set<string>();
    for (const point of dataset.points) {
      if (pointIds.has(point.id)) return err(new Error(`Duplicate observation ${point.id} in ${entry.id}.`));
      if (!Number.isFinite(point.score) || (minimum !== undefined && point.score < minimum) || (maximum !== undefined && point.score > maximum)) {
        return err(new Error(`Invalid score for ${entry.id}/${point.id}.`));
      }
      if (point.costUsd !== null && (!Number.isFinite(point.costUsd) || point.costUsd < 0 || !dataset.costLabel?.trim())) {
        return err(new Error(`Cost requires a finite value and explicit basis for ${entry.id}/${point.id}.`));
      }
      if (!isCredentialFreeHttpsUrl(point.sourceUrl)) return err(new Error(`Invalid observation source for ${entry.id}/${point.id}.`));
      if (point.uncertainty !== null && (
        !Number.isFinite(point.uncertainty.lower) || !Number.isFinite(point.uncertainty.upper)
        || point.uncertainty.lower > point.score || point.uncertainty.upper < point.score
        || !point.uncertainty.label.trim()
      )) return err(new Error(`Invalid uncertainty for ${entry.id}/${point.id}.`));
      pointIds.add(point.id);
    }
    datasetIds.add(dataset.benchmarkId);
  }
  for (const entry of entries) {
    if (entry.coverage === "charted" && !datasetIds.has(entry.id)) return err(new Error(`Charted benchmark has no dataset: ${entry.id}.`));
  }
  return ok(true);
}
