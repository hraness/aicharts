import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import { comparableIntelligenceRecords, orderedParetoPath, paretoMembership } from "./intelligence-efficiency";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import {
  releaseIntelligencePlacement,
  type ReleaseIntelligencePlacement,
} from "./snapshot-placement";

/**
 * Claude Haiku 5.5 bindings of the shared snapshot placement helpers. The
 * Intelligence Index stores one row per effort level of the release and the
 * max row is its headline configuration. Beyond the shared placement, the
 * note needs three things the shared helpers do not state: which effort rows
 * are themselves cost-frontier vertices and what sits either side of them,
 * how the release compares with the other Anthropic rows on the chart, and
 * how it compares with the rows of a release the vendor names.
 */

export const CLAUDE_HAIKU_55_INTELLIGENCE_SLUG = "claude-haiku-5-5" as const;
export const CLAUDE_HAIKU_55_RELEASE_SLUG = "claude-haiku-5-5" as const;
export const ANTHROPIC_CREATOR_SLUG = "anthropic" as const;
/** The two Anthropic releases the announcement names as the better choices for complex agentic coding. */
export const CLAUDE_HAIKU_55_SIBLING_RELEASE_SLUGS = ["claude-sonnet-5-5", "claude-opus-5-5"] as const;
/** The release Anthropic’s benchmark table compares Haiku 5.5 with outside its own family. */
export const GPT_6_LUNA_RELEASE_SLUG = "gpt-6-luna" as const;

export type ClosestBelow = Readonly<{
  /** Cost as a multiple of the placed row’s cost per task. */
  costMultiple: number;
  /** Placed row’s index minus this row’s index, in index points. */
  gapPoints: number;
  record: ArtificialAnalysisIntelligenceRecord;
}>;

export type FrontierLevel = Readonly<{
  /** Frontier vertex with the next higher score, or undefined when this level is the top vertex. */
  above: ArtificialAnalysisIntelligenceRecord | undefined;
  /** Frontier vertex with the next lower score, or undefined when this level is the lowest-cost vertex. */
  below: ArtificialAnalysisIntelligenceRecord | undefined;
  record: ArtificialAnalysisIntelligenceRecord;
}>;

export type RowAgainstReference = Readonly<{
  /** Row cost divided by the reference row’s cost per task. */
  costMultiple: number;
  /** Row index minus the reference row’s index, in index points. */
  gapPoints: number;
  record: ArtificialAnalysisIntelligenceRecord;
}>;

export type FamilyRow = RowAgainstReference & Readonly<{
  /** Whether the row is a vertex of the cost frontier drawn through Anthropic rows only. */
  onFamilyFrontier: boolean;
}>;

export type DominatedFamilyRow = Readonly<{
  /** The highest-scoring Haiku 5.5 row that costs the same or less and scores the same or higher, strict in one. */
  dominator: ArtificialAnalysisIntelligenceRecord;
  /** Dominated row cost divided by the dominator’s cost per task; at least one. */
  costMultipleOfDominator: number;
  /** Dominator index minus the dominated row’s index, in index points; never negative. */
  pointsBelowDominator: number;
  record: ArtificialAnalysisIntelligenceRecord;
}>;

export type HaikuIntelligencePlacement = ReleaseIntelligencePlacement & Readonly<{
  /** Comparable configurations that cost strictly less per task than the placed row. */
  cheaperCount: number;
  /** The highest-scoring other comparable configurations after the placed row, highest first. */
  closestBelow: readonly ClosestBelow[];
  /** Effort-ladder rows that are cost-frontier vertices, highest score first, each with its frontier neighbors. */
  frontierLevels: readonly FrontierLevel[];
}>;

export const DEFAULT_CLOSEST_BELOW_COUNT = 5;

function assertCount(count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`Counts must be non-negative integers: ${count}`);
  }
}

function compareIndexDesc(
  left: ArtificialAnalysisIntelligenceRecord,
  right: ArtificialAnalysisIntelligenceRecord,
): number {
  return right.intelligenceIndex - left.intelligenceIndex || left.id.localeCompare(right.id);
}

function against(
  reference: ArtificialAnalysisIntelligenceRecord,
  record: ArtificialAnalysisIntelligenceRecord,
): RowAgainstReference {
  return {
    costMultiple: comparableTaskCost(record) / comparableTaskCost(reference),
    gapPoints: record.intelligenceIndex - reference.intelligenceIndex,
    record,
  };
}

function dominates(
  candidate: ArtificialAnalysisIntelligenceRecord,
  record: ArtificialAnalysisIntelligenceRecord,
): boolean {
  const candidateCost = comparableTaskCost(candidate);
  const cost = comparableTaskCost(record);
  return candidate.id !== record.id
    && candidateCost <= cost
    && candidate.intelligenceIndex >= record.intelligenceIndex
    && (candidateCost < cost || candidate.intelligenceIndex > record.intelligenceIndex);
}

/**
 * For every row of `releaseSlug` that is a vertex of the cohort’s cost
 * frontier, the vertex above it and the vertex below it on that frontier,
 * highest score first. A release with no vertex yields an empty list.
 */
export function frontierLevelsFor(
  cohort: readonly ArtificialAnalysisIntelligenceRecord[],
  releaseSlug: string,
): readonly FrontierLevel[] {
  const fromTop = orderedParetoPath(cohort, "costUsdPerTask").map(point => point.record).toReversed();
  return fromTop.flatMap((record, position) => (
    record.release.slug === releaseSlug
      ? [{ above: fromTop[position - 1], below: fromTop[position + 1], record }]
      : []
  ));
}

export function haikuIntelligencePlacement(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  pointWindow = 1,
  closestBelowCount = DEFAULT_CLOSEST_BELOW_COUNT,
): HaikuIntelligencePlacement | undefined {
  assertCount(closestBelowCount);
  const placement = releaseIntelligencePlacement(records, CLAUDE_HAIKU_55_INTELLIGENCE_SLUG, pointWindow);
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
    cheaperCount: cohort.filter(candidate => comparableTaskCost(candidate) < cost).length,
    closestBelow,
    frontierLevels: frontierLevelsFor(cohort, placement.record.release.slug),
  };
}

/** Every comparable Anthropic row, including the Haiku 5.5 rows, highest index first. */
export function anthropicRows(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
): readonly ArtificialAnalysisIntelligenceRecord[] {
  return comparableIntelligenceRecords(records)
    .filter(record => record.creator.slug === ANTHROPIC_CREATOR_SLUG)
    .toSorted(compareIndexDesc);
}

/** The cost frontier drawn through Anthropic rows alone, highest score first. */
export function anthropicFrontier(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
): readonly ArtificialAnalysisIntelligenceRecord[] {
  return orderedParetoPath(anthropicRows(records), "costUsdPerTask").map(point => point.record).toReversed();
}

/**
 * The comparable rows of the named sibling releases measured against
 * `reference`, highest index first, each flagged when it is a vertex of the
 * Anthropic-only cost frontier. Rows of the reference’s own release are left
 * out even when a sibling slug names it.
 */
export function siblingFamilyRows(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  reference: ArtificialAnalysisIntelligenceRecord,
  releaseSlugs: readonly string[] = CLAUDE_HAIKU_55_SIBLING_RELEASE_SLUGS,
): readonly FamilyRow[] {
  const family = anthropicRows(records);
  const membership = paretoMembership(family, "costUsdPerTask");
  const wanted = new Set(releaseSlugs);
  return family
    .filter(record => wanted.has(record.release.slug) && record.release.slug !== reference.release.slug)
    .map(record => ({ ...against(reference, record), onFamilyFrontier: membership.has(record.id) }));
}

/**
 * Anthropic rows from other releases that some row of `releaseSlug` costs the
 * same or less than and scores the same or higher than, strict in one, with
 * the highest-scoring such row as the dominator. Highest dominated index
 * first.
 */
export function familyRowsDominatedBy(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  releaseSlug: string,
): readonly DominatedFamilyRow[] {
  const family = anthropicRows(records);
  const release = family.filter(record => record.release.slug === releaseSlug);
  return family
    .filter(record => record.release.slug !== releaseSlug)
    .flatMap((record) => {
      const [dominator] = release.filter(candidate => dominates(candidate, record)).toSorted(compareIndexDesc);
      if (dominator === undefined) return [];
      return [{
        costMultipleOfDominator: comparableTaskCost(record) / comparableTaskCost(dominator),
        dominator,
        pointsBelowDominator: dominator.intelligenceIndex - record.intelligenceIndex,
        record,
      }];
    });
}

/** The comparable rows of `releaseSlug` measured against `reference`, highest index first. */
export function releaseRowsAgainst(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  releaseSlug: string,
  reference: ArtificialAnalysisIntelligenceRecord,
): readonly RowAgainstReference[] {
  return comparableIntelligenceRecords(records)
    .filter(record => record.release.slug === releaseSlug)
    .toSorted(compareIndexDesc)
    .map(record => against(reference, record));
}
