import { validateAtlasCatalog, type BenchmarkAtlasDataset, type BenchmarkAtlasEntry } from "./benchmark-atlas";
import { CORE_ATLAS_ENTRIES } from "./benchmark-atlas-core-catalog";
import { BENCHMARK_ATLAS_DATASETS } from "./benchmark-atlas-data";
import { MULTIMODAL_ATLAS_DATASETS, MULTIMODAL_ATLAS_ENTRIES } from "./benchmark-atlas-multimodal";
import { REASONING_ATLAS_DATASETS, REASONING_ATLAS_ENTRIES } from "./benchmark-atlas-reasoning";

// Lead with the primary terminal benchmark, not the retained historical general index.
export const ATLAS_ENTRIES: readonly BenchmarkAtlasEntry[] = [
  ...CORE_ATLAS_ENTRIES.filter(entry => entry.id === "terminal-bench-4"),
  ...CORE_ATLAS_ENTRIES.filter(entry => entry.id !== "terminal-bench-4"),
  ...REASONING_ATLAS_ENTRIES,
  ...MULTIMODAL_ATLAS_ENTRIES,
];
export const ATLAS_DATASETS: readonly BenchmarkAtlasDataset[] = [...BENCHMARK_ATLAS_DATASETS, ...REASONING_ATLAS_DATASETS, ...MULTIMODAL_ATLAS_DATASETS];

const checked = validateAtlasCatalog(ATLAS_ENTRIES, ATLAS_DATASETS);
if (!checked.ok) throw new Error("Invalid checked benchmark atlas", { cause: checked.error });
