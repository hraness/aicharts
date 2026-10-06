import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import {
  closestCodingRowsBelow,
  componentContrasts,
  frontierDescent,
  DEFAULT_CODING_CLOSEST_BELOW_COUNT,
  type CodingRowBelow,
  type ComponentContrast,
} from "./claude-opus-5-5-placement";
import type { CodingAgentRecord } from "./coding-agent-data";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import {
  codingAgentPlacement,
  competitionRank,
  intelligencePlacement,
  type CodingAgentPlacement,
  type CostedCodingAgentRecord,
  type IntelligencePlacement,
} from "./snapshot-placement";

/**
 * Gemini 4 Argon bindings of the shared snapshot placement helpers. The
 * coding-agent chart stores one Antigravity CLI row for the model at its
 * default setting, so there is no effort ladder and no predecessor
 * generation; the note reads the row's rank, cost rank, frontier neighbours
 * and component spread, plus the cost share it pays against every row that
 * scores higher. The Intelligence Index binding is only for the two-unit
 * contrast the note prints.
 */

export const GEMINI_4_ARGON_INTELLIGENCE_SLUG = "gemini-4-argon" as const;

export const GEMINI_4_ARGON_CODING_MODEL = {
  model: "Gemini 4 Argon",
  providerId: "google",
} as const;

export const GEMINI_4_ARGON_CODING_CONFIGURATION = {
  agent: "Antigravity CLI",
  ...GEMINI_4_ARGON_CODING_MODEL,
} as const;

export type HigherCostShare = Readonly<{
  /** The placed row's cost divided by this higher-scoring row's cost. */
  costShare: number;
  /** AA Index points the higher row holds over the placed row. */
  pointsAbove: number;
  record: CostedCodingAgentRecord;
}>;

export type Gemini4ArgonCodingAgentPlacement = CodingAgentPlacement & Readonly<{
  closestBelow: readonly CodingRowBelow[];
  componentContrasts: readonly ComponentContrast[];
  costRank: number;
  costedCount: number;
  frontierBelow: readonly CodingRowBelow[];
  /** Every costed row with a higher AA Index, highest first, with the cost share the placed row pays against it. */
  higherCostShares: readonly HigherCostShare[];
  /** Other costed rows from the same provider in any harness, highest AA Index first. */
  otherProviderRows: readonly CostedCodingAgentRecord[];
}>;

function assertCount(count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`Counts must be non-negative integers: ${count}`);
  }
}

function isCosted(record: CodingAgentRecord): record is CostedCodingAgentRecord {
  return record.benchmarks.aaIndex !== null
    && record.economics.costUsd !== null
    && record.economics.costUsd > 0;
}

function byIndexDescending(left: CostedCodingAgentRecord, right: CostedCodingAgentRecord): number {
  return right.benchmarks.aaIndex - left.benchmarks.aaIndex || left.id.localeCompare(right.id);
}

export function matchesGemini4ArgonCoding(record: CodingAgentRecord): boolean {
  return record.agent === GEMINI_4_ARGON_CODING_CONFIGURATION.agent
    && record.model === GEMINI_4_ARGON_CODING_CONFIGURATION.model
    && record.providerId === GEMINI_4_ARGON_CODING_CONFIGURATION.providerId;
}

/**
 * The cost share a row pays against every costed row scoring above it. A
 * share below one means the placed row is cheaper than the higher row.
 */
export function higherCostShares(
  records: readonly CodingAgentRecord[],
  record: CostedCodingAgentRecord,
): readonly HigherCostShare[] {
  return records
    .filter(isCosted)
    .filter(candidate => candidate.id !== record.id && candidate.benchmarks.aaIndex > record.benchmarks.aaIndex)
    .toSorted(byIndexDescending)
    .map(candidate => ({
      costShare: record.economics.costUsd / candidate.economics.costUsd,
      pointsAbove: candidate.benchmarks.aaIndex - record.benchmarks.aaIndex,
      record: candidate,
    }));
}

/**
 * The Antigravity CLI · Gemini 4 Argon row, placed among every coding-agent
 * row that carries an index, with the cost share it pays against each row
 * above it and the other rows from the same provider.
 */
export function gemini4ArgonCodingAgentPlacement(
  records: readonly CodingAgentRecord[],
  pointWindow = 1,
  closestBelowCount = DEFAULT_CODING_CLOSEST_BELOW_COUNT,
): Gemini4ArgonCodingAgentPlacement | undefined {
  assertCount(closestBelowCount);
  const placement = codingAgentPlacement(
    records,
    GEMINI_4_ARGON_CODING_CONFIGURATION,
    undefined,
    pointWindow,
  );
  if (placement === undefined) return undefined;
  const costed = records.filter(isCosted);
  return {
    ...placement,
    closestBelow: closestCodingRowsBelow(records, placement.record, closestBelowCount),
    componentContrasts: componentContrasts(records, placement.record),
    costRank: competitionRank(
      placement.record.economics.costUsd,
      costed.map(candidate => candidate.economics.costUsd),
    ),
    costedCount: costed.length,
    frontierBelow: frontierDescent(records, placement.record),
    higherCostShares: higherCostShares(records, placement.record),
    otherProviderRows: costed
      .filter(candidate => (
        candidate.id !== placement.record.id
        && candidate.providerId === GEMINI_4_ARGON_CODING_MODEL.providerId
      ))
      .toSorted(byIndexDescending),
  };
}

/** The headline Intelligence Index row, for the two-unit contrast only. */
export function gemini4ArgonIntelligencePlacement(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  pointWindow = 1,
): IntelligencePlacement | undefined {
  return intelligencePlacement(records, GEMINI_4_ARGON_INTELLIGENCE_SLUG, pointWindow);
}

export { comparableTaskCost };
