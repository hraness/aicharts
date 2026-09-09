import {
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME,
  artificialAnalysisIntelligenceSnapshotSchema,
  validateArtificialAnalysisIntelligenceCollection,
} from "./artificial-analysis-intelligence-data";
import type { Result } from "./result";
import { parseResult, z } from "./schema";

export const ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_VERSION = "4.3" as const;
export const ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS = [
  "AA-Briefcase",
  "GDPval-AA v2",
  "AutomationBench-AA",
  "Terminal-Bench v4.0",
  "SciCode",
  "Humanity's Last Exam",
  "GDP.pdf",
  "CritPt",
  "AA-Omniscience",
  "AA-LCR v1.1",
] as const;

export const ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_CATEGORY_WEIGHTS = {
  agents: 30,
  coding: 20,
  general: 30,
  scientific: 20,
} as const;

export const artificialAnalysisIntelligenceV43SnapshotSchema = z.object({
  benchmark: z.object({
    categoryWeightsPercent: z.object({
      agents: z.literal(30),
      coding: z.literal(20),
      general: z.literal(30),
      scientific: z.literal(20),
    }).strict(),
    evaluationCount: z.literal(10),
    evaluations: z.tuple([
      z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS[0]),
      z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS[1]),
      z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS[2]),
      z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS[3]),
      z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS[4]),
      z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS[5]),
      z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS[6]),
      z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS[7]),
      z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS[8]),
      z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS[9]),
    ]),
    name: z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME),
    score: z.literal("intelligence-index"),
    scoreUnit: z.literal("index-points"),
    version: z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_VERSION),
  }).strict(),
  records: artificialAnalysisIntelligenceSnapshotSchema.shape.records,
  schemaVersion: z.literal(1),
  selection: artificialAnalysisIntelligenceSnapshotSchema.shape.selection,
  source: artificialAnalysisIntelligenceSnapshotSchema.shape.source,
}).strict().superRefine(validateArtificialAnalysisIntelligenceCollection);

export type ArtificialAnalysisIntelligenceV43Snapshot = z.infer<
  typeof artificialAnalysisIntelligenceV43SnapshotSchema
>;

export function parseArtificialAnalysisIntelligenceV43Snapshot(
  value: unknown,
): Result<ArtificialAnalysisIntelligenceV43Snapshot, z.ZodError> {
  return parseResult(artificialAnalysisIntelligenceV43SnapshotSchema, value);
}
