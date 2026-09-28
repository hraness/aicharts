import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import type { CodingAgentRecord } from "./coding-agent-data";
import { aaIndexCostFrontier } from "./coding-agent-snapshot-rows";
import { comparableIntelligenceRecords, orderedParetoPath } from "./intelligence-efficiency";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import {
  CODING_COMPONENT_METRICS,
  codingAgentPlacement,
  competitionRank,
  releaseIntelligencePlacement,
  type CodingAgentPlacement,
  type CodingComponentMetric,
  type CostedCodingAgentRecord,
  type ReleaseIntelligencePlacement,
} from "./snapshot-placement";

/**
 * Claude Opus 5.5 bindings of the shared snapshot placement helpers. The
 * Intelligence Index stores one row per effort level of the release and the
 * max row is its headline configuration. The coding-agent chart stores both
 * Claude Code · Opus 5 and Claude Code · Opus 5.5; `opus55CodingAgentRows`
 * lists every harness that runs the newer model, and
 * `opus55CodingAgentPlacement` places the Claude Code row with what the
 * chart’s cost frontier gives up below it.
 */

export const CLAUDE_OPUS_55_INTELLIGENCE_SLUG = "claude-opus-5-5" as const;
export const CLAUDE_OPUS_55_RELEASE_SLUG = "claude-opus-5-5" as const;
export const CLAUDE_OPUS_5_RELEASE_SLUG = "claude-opus-5" as const;

export const CLAUDE_OPUS_5_CODING_CONFIGURATION = {
  agent: "Claude Code",
  model: "Opus 5",
  providerId: "anthropic",
} as const;

export const CLAUDE_OPUS_55_CODING_MODEL = {
  model: "Opus 5.5",
  providerId: "anthropic",
} as const;

export const CLAUDE_OPUS_55_CODING_CONFIGURATION = {
  agent: "Claude Code",
  ...CLAUDE_OPUS_55_CODING_MODEL,
} as const;

export type CodingRowBelow = Readonly<{
  /** This row’s cost as a multiple of the placed row’s cost per task. */
  costMultiple: number;
  /** Placed row’s AA Index minus this row’s, in index points; never negative. */
  pointsBelow: number;
  record: CostedCodingAgentRecord;
}>;

export const DEFAULT_CODING_CLOSEST_BELOW_COUNT = 4;

export type ComponentContrast = Readonly<{
  /** Highest-scoring other row that carries the component. */
  bestOther: CodingAgentRecord;
  /** Placed row’s score minus `bestOther`’s; positive when the placed row leads the component. */
  gapPoints: number;
  metric: CodingComponentMetric;
  value: number;
}>;

export type Opus55CodingAgentPlacement = CodingAgentPlacement & Readonly<{
  /** The highest-scoring other costed rows at or under the placed row’s AA Index, highest first, capped at the count. */
  closestBelow: readonly CodingRowBelow[];
  /** For each component the placed row carries alongside at least one other row, the gap to the best other row. */
  componentContrasts: readonly ComponentContrast[];
  /** One-based rank by cost per task among costed rows, ties sharing the higher rank; 1 is the costliest row. */
  costRank: number;
  /** Rows carrying an AA Index and a positive cost. */
  costedCount: number;
  /** Cost-frontier vertices with a lower AA Index than the placed row, highest AA Index first. */
  frontierBelow: readonly CodingRowBelow[];
}>;

export type ClosestBelow = Readonly<{
  /** Cost as a multiple of the placed row’s cost per task. */
  costMultiple: number;
  /** Placed row’s index minus this row’s index, in index points. */
  gapPoints: number;
  record: ArtificialAnalysisIntelligenceRecord;
}>;

export type OpusIntelligencePlacement = ReleaseIntelligencePlacement & Readonly<{
  /** The highest-scoring other comparable configurations after the placed row, highest first. */
  closestBelow: readonly ClosestBelow[];
  /** First cost-frontier vertex from another release when walking down from the top-scoring vertex. */
  firstOtherFrontier: ArtificialAnalysisIntelligenceRecord | undefined;
  /** Consecutive cost-frontier vertices from the top that belong to the placed row’s release, highest first. */
  frontierRun: readonly ArtificialAnalysisIntelligenceRecord[];
}>;

export type TaskCostBreakdown = Readonly<{
  answer: number;
  cacheRead: number;
  cacheWrite: number;
  input: number;
  nonCacheInput: number;
  output: number;
  reasoning: number;
  total: number;
}>;

export const DEFAULT_CLOSEST_BELOW_COUNT = 5;

function assertCount(count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`Counts must be non-negative integers: ${count}`);
  }
}

/** The cost components of a comparable row; the cohort filter guarantees a positive total. */
export function taskCostBreakdown(record: ArtificialAnalysisIntelligenceRecord): TaskCostBreakdown {
  const cost = record.costUsdPerTask;
  if (cost === null) {
    throw new RangeError(`Comparable record must carry a task cost: ${record.slug}`);
  }
  return cost;
}

/** Reasoning tokens as a share of output tokens per task, in the closed unit interval. */
export function reasoningShare(record: ArtificialAnalysisIntelligenceRecord): number {
  const { reasoning, total } = record.outputTokensPerTask;
  if (!Number.isFinite(total) || total <= 0) {
    throw new RangeError(`Comparable record must carry positive output tokens: ${record.slug}`);
  }
  return Math.min(1, Math.max(0, reasoning / total));
}

/** Input-side cost as a share of the total cost per task, in the closed unit interval. */
export function inputCostShare(record: ArtificialAnalysisIntelligenceRecord): number {
  const cost = taskCostBreakdown(record);
  return Math.min(1, Math.max(0, cost.input / cost.total));
}

/**
 * Walks the cost frontier from its highest-scoring vertex downward and returns
 * the consecutive vertices that belong to `releaseSlug`, plus the first vertex
 * that belongs to another release. The run is empty when another release holds
 * the top vertex.
 */
export function topFrontierRun(
  cohort: readonly ArtificialAnalysisIntelligenceRecord[],
  releaseSlug: string,
): Readonly<{
  firstOtherFrontier: ArtificialAnalysisIntelligenceRecord | undefined;
  frontierRun: readonly ArtificialAnalysisIntelligenceRecord[];
}> {
  const fromTop = orderedParetoPath(cohort, "costUsdPerTask").map(point => point.record).toReversed();
  const run: ArtificialAnalysisIntelligenceRecord[] = [];
  for (const vertex of fromTop) {
    if (vertex.release.slug !== releaseSlug) {
      return { firstOtherFrontier: vertex, frontierRun: run };
    }
    run.push(vertex);
  }
  return { firstOtherFrontier: undefined, frontierRun: run };
}

export function opusIntelligencePlacement(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  pointWindow = 1,
  closestBelowCount = DEFAULT_CLOSEST_BELOW_COUNT,
): OpusIntelligencePlacement | undefined {
  assertCount(closestBelowCount);
  const placement = releaseIntelligencePlacement(records, CLAUDE_OPUS_55_INTELLIGENCE_SLUG, pointWindow);
  if (placement === undefined) return undefined;
  const cohort = comparableIntelligenceRecords(records);
  const cost = comparableTaskCost(placement.record);
  const closestBelow = cohort
    .filter(candidate => (
      candidate.id !== placement.record.id
      && candidate.intelligenceIndex <= placement.record.intelligenceIndex
    ))
    .slice(0, closestBelowCount)
    .map(candidate => ({
      costMultiple: comparableTaskCost(candidate) / cost,
      gapPoints: placement.record.intelligenceIndex - candidate.intelligenceIndex,
      record: candidate,
    }));
  return {
    ...placement,
    closestBelow,
    ...topFrontierRun(cohort, placement.record.release.slug),
  };
}

/** Comparable rows of the earlier Claude Opus 5 release on the Intelligence Index, highest index first. */
export function opus5IntelligenceRows(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
): readonly ArtificialAnalysisIntelligenceRecord[] {
  return comparableIntelligenceRecords(records)
    .filter(record => record.release.slug === CLAUDE_OPUS_5_RELEASE_SLUG);
}

/** Every coding-agent row that runs Opus 5.5 in any harness, highest AA Index first, indexless rows last. */
export function opus55CodingAgentRows(
  records: readonly CodingAgentRecord[],
): readonly CodingAgentRecord[] {
  return records
    .filter(record => (
      record.providerId === CLAUDE_OPUS_55_CODING_MODEL.providerId
      && record.model === CLAUDE_OPUS_55_CODING_MODEL.model
    ))
    .toSorted((left, right) => (
      (right.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY) - (left.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY)
      || left.id.localeCompare(right.id)
    ));
}

/** The Claude Code · Opus 5 row placed among every coding-agent row that carries an AA Index. */
export function opus5CodingAgentPlacement(
  records: readonly CodingAgentRecord[],
): CodingAgentPlacement | undefined {
  return codingAgentPlacement(records, CLAUDE_OPUS_5_CODING_CONFIGURATION);
}

function isCosted(record: CodingAgentRecord): record is CostedCodingAgentRecord {
  return record.benchmarks.aaIndex !== null
    && record.economics.costUsd !== null
    && record.economics.costUsd > 0;
}

function compareIndexDesc(left: CostedCodingAgentRecord, right: CostedCodingAgentRecord): number {
  return right.benchmarks.aaIndex - left.benchmarks.aaIndex || left.id.localeCompare(right.id);
}

function rowBelow(record: CostedCodingAgentRecord, other: CostedCodingAgentRecord): CodingRowBelow {
  return {
    costMultiple: other.economics.costUsd / record.economics.costUsd,
    pointsBelow: record.benchmarks.aaIndex - other.benchmarks.aaIndex,
    record: other,
  };
}

/**
 * The cost-frontier vertices that score below `record`, highest AA Index
 * first, each with the points it gives up against the row and its cost as a
 * multiple of the row’s. On a Pareto frontier a lower score is also a lower
 * cost, so the multiples fall along the list. Vertices at or above the row’s
 * score are left out; they belong to a note about a row that is not leading.
 */
export function frontierDescent(
  records: readonly CodingAgentRecord[],
  record: CostedCodingAgentRecord,
): readonly CodingRowBelow[] {
  const index = record.benchmarks.aaIndex;
  return aaIndexCostFrontier(records)
    .map(point => point.record)
    .filter(isCosted)
    .filter(vertex => vertex.id !== record.id && vertex.benchmarks.aaIndex < index)
    .toSorted(compareIndexDesc)
    .map(vertex => rowBelow(record, vertex));
}

/** The highest-scoring other costed rows at or under `record`’s AA Index, highest first, capped at `count`. */
export function closestCodingRowsBelow(
  records: readonly CodingAgentRecord[],
  record: CostedCodingAgentRecord,
  count = DEFAULT_CODING_CLOSEST_BELOW_COUNT,
): readonly CodingRowBelow[] {
  assertCount(count);
  return records
    .filter(isCosted)
    .filter(candidate => candidate.id !== record.id && candidate.benchmarks.aaIndex <= record.benchmarks.aaIndex)
    .toSorted(compareIndexDesc)
    .slice(0, count)
    .map(candidate => rowBelow(record, candidate));
}

/**
 * For each AA Index component `record` carries, the best other row on that
 * component and the gap to it. A component nobody else carries has no
 * contrast and is left out.
 */
export function componentContrasts(
  records: readonly CodingAgentRecord[],
  record: CodingAgentRecord,
): readonly ComponentContrast[] {
  return CODING_COMPONENT_METRICS.flatMap((metric) => {
    const value = record.benchmarks[metric];
    if (value === null) return [];
    const [bestOther] = records
      .filter(candidate => candidate.id !== record.id && candidate.benchmarks[metric] !== null)
      .toSorted((left, right) => (
        (right.benchmarks[metric] ?? Number.NaN) - (left.benchmarks[metric] ?? Number.NaN)
        || left.id.localeCompare(right.id)
      ));
    const bestOtherValue = bestOther?.benchmarks[metric];
    if (bestOther === undefined || bestOtherValue === null || bestOtherValue === undefined) return [];
    return [{ bestOther, gapPoints: value - bestOtherValue, metric, value }];
  });
}

/**
 * The Claude Code · Opus 5.5 row placed among every coding-agent row that
 * carries an AA Index, with Claude Code · Opus 5 as its same-harness
 * predecessor, its rank by cost per task, and the frontier below it.
 */
export function opus55CodingAgentPlacement(
  records: readonly CodingAgentRecord[],
  pointWindow = 1,
  closestBelowCount = DEFAULT_CODING_CLOSEST_BELOW_COUNT,
): Opus55CodingAgentPlacement | undefined {
  assertCount(closestBelowCount);
  const placement = codingAgentPlacement(
    records,
    CLAUDE_OPUS_55_CODING_CONFIGURATION,
    CLAUDE_OPUS_5_CODING_CONFIGURATION,
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
  };
}
