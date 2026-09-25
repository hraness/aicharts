import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import type { CodingAgentRecord } from "./coding-agent-data";
import {
  codingAgentPlacement,
  codingAgentRecordsFor,
  effortLadder,
  releaseIntelligencePlacement,
  type CodingAgentPlacement,
  type CostedCodingAgentRecord,
  type EffortStep,
  type ReleaseIntelligencePlacement,
} from "./snapshot-placement";

/**
 * GPT-6 Sol bindings of the shared snapshot placement helpers. The coding
 * chart stores GPT-6 Sol inside OpenAI’s Codex harness; the Intelligence Index
 * stores one row per effort level of the same release, so the placement also
 * carries the whole effort ladder for the note’s cost-per-point table.
 */

export const GPT_6_SOL_CODING_CONFIGURATION = {
  agent: "Codex",
  model: "GPT-6 Sol",
  providerId: "openai",
} as const;

export const GPT_56_SOL_CODING_CONFIGURATION = {
  agent: "Codex",
  model: "GPT-5.6 Sol",
  providerId: "openai",
} as const;

export const GPT_6_SOL_INTELLIGENCE_SLUG = "gpt-6-sol" as const;

export type SolCodingAgentPlacement = CodingAgentPlacement;

export type SolEffortStep = EffortStep;

export type SolIntelligencePlacement = ReleaseIntelligencePlacement;

export { effortLadder };

/** Every Codex · GPT-6 Sol row that carries an AA Index and a cost, highest AA Index first. */
export function solCodingAgentRecords(
  records: readonly CodingAgentRecord[],
): readonly CostedCodingAgentRecord[] {
  return codingAgentRecordsFor(records, GPT_6_SOL_CODING_CONFIGURATION);
}

export function solCodingAgentPlacement(
  records: readonly CodingAgentRecord[],
): SolCodingAgentPlacement | undefined {
  return codingAgentPlacement(records, GPT_6_SOL_CODING_CONFIGURATION, GPT_56_SOL_CODING_CONFIGURATION);
}

export function solIntelligencePlacement(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  pointWindow = 1,
): SolIntelligencePlacement | undefined {
  return releaseIntelligencePlacement(records, GPT_6_SOL_INTELLIGENCE_SLUG, pointWindow);
}
