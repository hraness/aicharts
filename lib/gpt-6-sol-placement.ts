import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import type { CodingAgentRecord } from "./coding-agent-data";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import {
  codingAgentPlacement,
  codingAgentRecordsFor,
  intelligencePlacement,
  type CodingAgentPlacement,
  type CostedCodingAgentRecord,
  type IntelligencePlacement,
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

export type SolEffortStep = Readonly<{
  /** Index points added over the next cheaper effort level, or null for the cheapest level. */
  pointsOverCheaper: number | null;
  /** Cost as a multiple of the next cheaper effort level, or null for the cheapest level. */
  costMultipleOverCheaper: number | null;
  record: ArtificialAnalysisIntelligenceRecord;
}>;

export type SolIntelligencePlacement = IntelligencePlacement & Readonly<{
  /** Every comparable GPT-6 Sol row, including the placed one, cheapest first, with the step from the level before. */
  effortLadder: readonly SolEffortStep[];
}>;

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

/**
 * Orders every comparable row of one release cheapest first and states what
 * each step up the ladder buys. A step may buy negative points when a costlier
 * level scores lower, which the note must be able to print.
 */
export function effortLadder(
  record: ArtificialAnalysisIntelligenceRecord,
  siblings: readonly ArtificialAnalysisIntelligenceRecord[],
): readonly SolEffortStep[] {
  const rows = [record, ...siblings].toSorted((left, right) => (
    comparableTaskCost(left) - comparableTaskCost(right) || left.id.localeCompare(right.id)
  ));
  return rows.map((current, position) => {
    const cheaper = rows[position - 1];
    return {
      costMultipleOverCheaper: cheaper === undefined
        ? null
        : comparableTaskCost(current) / comparableTaskCost(cheaper),
      pointsOverCheaper: cheaper === undefined
        ? null
        : current.intelligenceIndex - cheaper.intelligenceIndex,
      record: current,
    };
  });
}

export function solIntelligencePlacement(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  pointWindow = 1,
): SolIntelligencePlacement | undefined {
  const placement = intelligencePlacement(records, GPT_6_SOL_INTELLIGENCE_SLUG, pointWindow);
  if (placement === undefined) return undefined;
  return {
    ...placement,
    effortLadder: effortLadder(placement.record, placement.siblings),
  };
}
