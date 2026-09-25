import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import type { CodingAgentRecord } from "./coding-agent-data";
import { comparableIntelligenceRecords, orderedParetoPath } from "./intelligence-efficiency";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import {
  codingAgentPlacement,
  releaseIntelligencePlacement,
  type CodingAgentPlacement,
  type ReleaseIntelligencePlacement,
} from "./snapshot-placement";

/**
 * Claude Opus 5.5 bindings of the shared snapshot placement helpers. The
 * Intelligence Index stores one row per effort level of the release and the
 * max row is its headline configuration. The coding-agent chart stores the
 * earlier Claude Code · Opus 5 row and, in the checked snapshot, no Opus 5.5
 * row at all, so the coding side of the note is a contrast, not a placement.
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
