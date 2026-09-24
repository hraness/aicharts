import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import type { CodingAgentRecord } from "./coding-agent-data";
import { comparableIntelligenceRecords } from "./intelligence-efficiency";
import {
  codingAgentPlacement,
  codingAgentRecordsFor,
  intelligencePlacement,
  type CodingAgentPlacement,
  type CostedCodingAgentRecord,
  type IntelligencePlacement,
} from "./snapshot-placement";

/**
 * Grok 4.7 bindings of the shared snapshot placement helpers, so the Grok 4.7
 * note ranks the same rows the coding chart plots and works inside the same
 * comparable Intelligence Index cohort as the homepage chart.
 */

export {
  CODING_COMPONENT_METRICS,
  competitionRank,
  formatFineCostMultiple,
  modelAddedAt,
  spellOrdinal,
  type CodingComponentMetric,
  type CodingComponentPlacement,
  type CostedCodingAgentRecord,
  type IndexedCodingAgentRecord,
} from "./snapshot-placement";

export const GROK_47_CODING_CONFIGURATION = {
  agent: "Grok Build",
  model: "Grok 4.7",
  providerId: "xai",
} as const;

export const GROK_46_CODING_CONFIGURATION = {
  agent: "Grok Build",
  model: "Grok 4.6",
  providerId: "xai",
} as const;

export const GROK_47_INTELLIGENCE_SLUG = "grok-4-7" as const;
export const GROK_47_INTELLIGENCE_HIGH_SLUG = "grok-4-7-high" as const;

export type GrokCodingAgentPlacement = CodingAgentPlacement;

export type GrokIntelligencePlacement = IntelligencePlacement & Readonly<{
  /** The Grok 4.7 (high) row inside the comparable cohort, when the snapshot stores one. */
  high: ArtificialAnalysisIntelligenceRecord | undefined;
}>;

/** Every Grok Build · Grok 4.7 row that carries an AA Index and a cost, highest AA Index first. */
export function grokCodingAgentRecords(
  records: readonly CodingAgentRecord[],
): readonly CostedCodingAgentRecord[] {
  return codingAgentRecordsFor(records, GROK_47_CODING_CONFIGURATION);
}

export function grokCodingAgentPlacement(
  records: readonly CodingAgentRecord[],
): GrokCodingAgentPlacement | undefined {
  return codingAgentPlacement(records, GROK_47_CODING_CONFIGURATION, GROK_46_CODING_CONFIGURATION);
}

export function grokIntelligencePlacement(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  pointWindow = 1,
): GrokIntelligencePlacement | undefined {
  const placement = intelligencePlacement(records, GROK_47_INTELLIGENCE_SLUG, pointWindow);
  if (placement === undefined) return undefined;
  return {
    ...placement,
    high: comparableIntelligenceRecords(records)
      .find(candidate => candidate.slug === GROK_47_INTELLIGENCE_HIGH_SLUG),
  };
}
