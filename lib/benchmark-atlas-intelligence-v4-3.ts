// Server-only assembly: all observations come from a checked, version-specific snapshot.
import intelligenceJson from "../data/artificial-analysis-intelligence-v4-3.json";
import {
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_METHODOLOGY_URL,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL,
} from "./artificial-analysis-intelligence-data";
import {
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_VERSION,
  parseArtificialAnalysisIntelligenceV43Snapshot,
  type ArtificialAnalysisIntelligenceV43Snapshot,
} from "./artificial-analysis-intelligence-v4-3-data";
import type { BenchmarkAtlasDataset, BenchmarkAtlasEntry } from "./benchmark-atlas";

export const INTELLIGENCE_V43_ATLAS_ENTRY = {
  id: "aa-intelligence-4-3",
  name: "Artificial Analysis Intelligence Index",
  version: ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_VERSION,
  category: "general",
  question: "How much capability do I get for the cost?",
  summary: "Broad model capability alongside the cost and output tokens used to achieve it, within the same evaluation cohort.",
  source: {
    name: "Artificial Analysis",
    url: ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL,
    methodologyUrl: ARTIFICIAL_ANALYSIS_INTELLIGENCE_METHODOLOGY_URL,
  },
  measure: "The publisher’s v4.3 index across ten evaluations: agents 30%, coding 20%, scientific reasoning 20%, and general capability 30%.",
  comparisonRule: "Compare configurations only within v4.3. Its evaluation roster and weights differ from v4.1.1; the historical scores are not on a continuous scale with these scores.",
  limitations: [
    "An index reflects the publisher’s task mix and weights, not every use case. Reasoning effort changes the evaluated configuration.",
    "Both resources are publisher-reported per-task measures. Output tokens include answer and reasoning; cost also includes input and cache traffic.",
    "Only current, non-estimated configurations with complete native measurements are retained. Missing positive cost is not free. No per-configuration uncertainty is supplied.",
    "The Terminal-Bench component uses Artificial Analysis’s own evaluation harness and must not be merged with the Harbor submission leaderboard.",
  ],
  coverage: "charted",
  tags: ["language", "text", "intelligence", "efficiency", "cost", "reasoning effort", "pareto"],
} as const satisfies BenchmarkAtlasEntry;

export function intelligenceV43AtlasDataset(
  snapshot: ArtificialAnalysisIntelligenceV43Snapshot,
): BenchmarkAtlasDataset {
  return {
    benchmarkId: INTELLIGENCE_V43_ATLAS_ENTRY.id,
    version: snapshot.benchmark.version,
    score: { label: "Intelligence Index", unit: "index points", direction: "higher", minimum: 0, maximum: 100 },
    source: { name: snapshot.source.name, url: snapshot.source.url, retrievedAt: snapshot.source.retrievedAt },
    evidenceLabel: "Independent evaluation",
    configurationLabel: "Model and reasoning effort",
    comparabilityNote: "Ten-evaluation v4.3 cohort. Compare the same reasoning configuration and native per-task measurements. Historical v4.1.1 scores remain separate; a later index revision requires a new versioned cohort.",
    costLabel: "USD per Intelligence Index task",
    points: snapshot.records.map(record => ({
      id: record.id,
      label: record.name,
      model: record.release.name,
      provider: record.creator.name,
      harness: null,
      effort: record.effort?.label ?? null,
      score: record.intelligenceIndex,
      costUsd: record.costUsdPerTask?.total ?? null,
      uncertainty: null,
      sourceUrl: record.detailsUrl,
      details: [
        { label: "Output tokens per task", value: record.outputTokensPerTask.total.toLocaleString("en-US", { maximumFractionDigits: 1 }) },
        { label: "Answer tokens per task", value: record.outputTokensPerTask.answer.toLocaleString("en-US", { maximumFractionDigits: 1 }) },
        { label: "Reasoning tokens per task", value: record.outputTokensPerTask.reasoning.toLocaleString("en-US", { maximumFractionDigits: 1 }) },
      ],
    })),
  };
}

const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceJson);
if (!parsed.ok) throw new Error(`Invalid checked v4.3 Intelligence snapshot: ${parsed.error.message}`, { cause: parsed.error });
export const INTELLIGENCE_V43_ATLAS_DATASET = intelligenceV43AtlasDataset(parsed.value);
