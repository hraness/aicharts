/** Client-safe public identifiers only. Drift tests compare these with the server catalog. */
export const CHARTED_BENCHMARK_ATLAS_IDS = [
  "aa-coding-index",
  "aa-intelligence",
  "aa-intelligence-4-3",
  "arc-agi-2",
  "arc-agi-3-adapter",
  "arc-agi-3-standard",
  "deep-swe",
  "deepresearch-bench-ii",
  "geditbench-2",
  "image-arena",
  "image-edit-arena",
  "image-to-video-arena",
  "longmemeval-v2-medium",
  "longmemeval-v2-small",
  "omnidocbench",
  "open-asr-ami-cleaned",
  "swe-atlas",
  "terminal-bench-2-1",
  "terminal-bench-4",
  "terminal-bench-science",
  "videophy-2",
  "video-arena",
  "wise-verified",
  "worldscore-static",
] as const;

export const BENCHMARK_ATLAS_IDS = [
  ...CHARTED_BENCHMARK_ATLAS_IDS,
  "aa-image-arena",
  "aa-video-arena",
  "astabench",
  "browsecomp",
  "browsecomp-plus",
  "critpt",
  "cursorbench",
  "dpg-bench",
  "frontiermath",
  "gdpval",
  "gdpval-aa",
  "geneval-2",
  "gpqa-diamond",
  "humanitys-last-exam",
  "livebench",
  "livecodebench",
  "locomo",
  "longbench-v2",
  "longmemeval",
  "mmau-pro",
  "mmmu-pro",
  "open-asr",
  "osworld-v2",
  "scicode",
  "seed-tts-eval",
  "swe-bench-pro",
  "swe-bench-verified",
  "t2i-compbench",
  "tau-bench-3",
  "vbench-2",
  "video-mme",
  "voicearena",
  "worldmodelbench",
] as const;

export type BenchmarkAtlasId = typeof BENCHMARK_ATLAS_IDS[number];
export type ChartedBenchmarkAtlasId = typeof CHARTED_BENCHMARK_ATLAS_IDS[number];

const publishedIds: ReadonlySet<string> = new Set(BENCHMARK_ATLAS_IDS);
const chartedIds: ReadonlySet<string> = new Set(CHARTED_BENCHMARK_ATLAS_IDS);

export function isBenchmarkAtlasId(value: unknown): value is BenchmarkAtlasId {
  return typeof value === "string" && publishedIds.has(value);
}

export function isChartedBenchmarkAtlasId(value: unknown): value is ChartedBenchmarkAtlasId {
  return typeof value === "string" && chartedIds.has(value);
}
