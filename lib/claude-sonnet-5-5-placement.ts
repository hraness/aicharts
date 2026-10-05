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
  codingAgentRecordsFor,
  competitionRank,
  intelligencePlacement,
  type CodingAgentPlacement,
  type CostedCodingAgentRecord,
  type IntelligencePlacement,
} from "./snapshot-placement";

/**
 * Claude Sonnet 5.5 bindings of the shared snapshot placement helpers. The
 * coding-agent chart stores one Claude Code row per effort setting; the
 * highest-index row is the headline configuration. The Intelligence Index
 * binding is only for the two-unit contrast a coding-agent note may print.
 */

export const CLAUDE_SONNET_55_INTELLIGENCE_SLUG = "claude-sonnet-5-5" as const;

export const CLAUDE_OPUS_55_CODING_CONFIGURATION = {
  agent: "Claude Code",
  model: "Opus 5.5",
  providerId: "anthropic",
} as const;

export const CLAUDE_SONNET_55_CODING_MODEL = {
  model: "Sonnet 5.5",
  providerId: "anthropic",
} as const;

export const CLAUDE_SONNET_55_CODING_CONFIGURATION = {
  agent: "Claude Code",
  ...CLAUDE_SONNET_55_CODING_MODEL,
} as const;

export type CodingEffortStep = Readonly<{
  /** Cost as a multiple of the next cheaper setting, or null for the cheapest. */
  costMultipleOverCheaper: number | null;
  /** AA Index points added over the next cheaper setting, or null for the cheapest. */
  pointsOverCheaper: number | null;
  record: CostedCodingAgentRecord;
}>;

export type Sonnet55CodingAgentPlacement = CodingAgentPlacement & Readonly<{
  closestBelow: readonly CodingRowBelow[];
  componentContrasts: readonly ComponentContrast[];
  costRank: number;
  costedCount: number;
  /** The placed row and every other costed Claude Code · Sonnet 5.5 setting, cheapest first. */
  effortLadder: readonly CodingEffortStep[];
  frontierBelow: readonly CodingRowBelow[];
  /** Claude Code · Opus 5.5 at the same setting, when the snapshot stores one. */
  sameHarnessOpus: CodingAgentRecord | undefined;
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

/** Every coding-agent row that runs Sonnet 5.5 in any harness, highest AA Index first, indexless rows last. */
export function sonnet55CodingAgentRows(
  records: readonly CodingAgentRecord[],
): readonly CodingAgentRecord[] {
  return records
    .filter(record => (
      record.providerId === CLAUDE_SONNET_55_CODING_MODEL.providerId
      && record.model === CLAUDE_SONNET_55_CODING_MODEL.model
    ))
    .toSorted((left, right) => (
      (right.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY) - (left.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY)
      || left.id.localeCompare(right.id)
    ));
}

/**
 * Orders costed rows cheapest first and states what each step up the ladder
 * buys. A step may buy negative points when a costlier setting scores lower.
 */
export function codingEffortLadder(
  records: readonly CostedCodingAgentRecord[],
): readonly CodingEffortStep[] {
  const rows = [...records].toSorted((left, right) => (
    left.economics.costUsd - right.economics.costUsd || left.id.localeCompare(right.id)
  ));
  return rows.map((current, position) => {
    const cheaper = rows[position - 1];
    return {
      costMultipleOverCheaper: cheaper === undefined
        ? null
        : current.economics.costUsd / cheaper.economics.costUsd,
      pointsOverCheaper: cheaper === undefined
        ? null
        : current.benchmarks.aaIndex - cheaper.benchmarks.aaIndex,
      record: current,
    };
  });
}

/**
 * The Claude Code · Sonnet 5.5 row with the highest AA Index, placed among
 * every coding-agent row that carries an index, with the other Claude Code
 * settings as an effort ladder and Claude Code · Opus 5.5 at the same setting
 * as a same-harness contrast.
 */
export function sonnet55CodingAgentPlacement(
  records: readonly CodingAgentRecord[],
  pointWindow = 1,
  closestBelowCount = DEFAULT_CODING_CLOSEST_BELOW_COUNT,
): Sonnet55CodingAgentPlacement | undefined {
  assertCount(closestBelowCount);
  const placement = codingAgentPlacement(
    records,
    CLAUDE_SONNET_55_CODING_CONFIGURATION,
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
    effortLadder: codingEffortLadder(codingAgentRecordsFor(records, CLAUDE_SONNET_55_CODING_CONFIGURATION)),
    frontierBelow: frontierDescent(records, placement.record),
    sameHarnessOpus: records.find(candidate => (
      candidate.agent === CLAUDE_OPUS_55_CODING_CONFIGURATION.agent
      && candidate.model === CLAUDE_OPUS_55_CODING_CONFIGURATION.model
      && candidate.providerId === CLAUDE_OPUS_55_CODING_CONFIGURATION.providerId
      && candidate.setting === placement.record.setting
    )),
  };
}

/** The headline Intelligence Index row, for the two-unit contrast only. */
export function sonnet55IntelligencePlacement(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  pointWindow = 1,
): IntelligencePlacement | undefined {
  return intelligencePlacement(records, CLAUDE_SONNET_55_INTELLIGENCE_SLUG, pointWindow);
}

export { comparableTaskCost };
