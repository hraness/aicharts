import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import { taskCostBreakdown } from "./claude-opus-5-5-placement";
import { comparableIntelligenceRecords, orderedParetoPath, paretoMembership } from "./intelligence-efficiency";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import {
  releaseIntelligencePlacement,
  type ReleaseIntelligencePlacement,
} from "./snapshot-placement";

/**
 * Muse Wonder bindings of the shared snapshot placement helpers. The
 * Intelligence Index stores one Muse Wonder row, so the note has no effort
 * ladder to tabulate; what it needs beyond the shared placement is where the
 * row's cost per task goes compared with the rows that beat it on both axes,
 * how large each cost component is against the rest of the cohort, which
 * rows print the same score at one decimal, how the row compares with the
 * other Meta rows on the chart, and which chart rows match the releases Meta
 * names in its own benchmark table.
 */

export const MUSE_WONDER_INTELLIGENCE_SLUG = "muse-wonder" as const;
export const MUSE_WONDER_RELEASE_SLUG = "muse-wonder" as const;
export const META_CREATOR_SLUG = "meta" as const;
/** The API-available releases Meta's benchmark table sets beside Muse Wonder, in the table's column order. */
export const MUSE_WONDER_VENDOR_COMPARISON_RELEASE_SLUGS = ["claude-fable-5-1", "gpt-6-astra", "claude-opus-5-5"] as const;

export const COST_COMPONENTS = ["cacheRead", "cacheWrite", "nonCacheInput", "reasoning", "answer"] as const;
export type CostComponent = (typeof COST_COMPONENTS)[number];
export const COST_SIDES = ["input", "output"] as const;
export type CostSide = (typeof COST_SIDES)[number];
export type CostPart = CostComponent | CostSide;

export type RowAgainstReference = Readonly<{
  /** Row cost divided by the reference row's cost per task. */
  costMultiple: number;
  /** Row index minus the reference row's index, in index points. */
  gapPoints: number;
  record: ArtificialAnalysisIntelligenceRecord;
}>;

export type ClosestBelow = Readonly<{
  /** Cost as a multiple of the placed row's cost per task. */
  costMultiple: number;
  /** Placed row's index minus this row's index, in index points; never negative. */
  gapPoints: number;
  record: ArtificialAnalysisIntelligenceRecord;
}>;

export type CostPartRank = Readonly<{
  cohortSize: number;
  part: CostPart;
  /** One-based rank of the row's bill for this part among the cohort, largest bill first; ties share the higher rank. */
  rank: number;
  /** Rows whose bill for this part is at least as large as the placed row's, including the placed row, largest first. */
  atLeastAsLarge: readonly ArtificialAnalysisIntelligenceRecord[];
  value: number;
}>;

export type CostSideRow = RowAgainstReference & Readonly<{
  cacheWriteCost: number;
  inputCost: number;
  /** Input-side cost as a share of the row's total cost per task. */
  inputShare: number;
  outputCost: number;
}>;

export type FamilyRow = RowAgainstReference & Readonly<{
  /** Whether the row is a vertex of the cost frontier drawn through the creator's rows only. */
  onFamilyFrontier: boolean;
}>;

export type VendorComparisonRow = Readonly<{
  /** The chart row that stands for the release in the vendor table, or undefined when the snapshot stores none at the named effort. */
  record: ArtificialAnalysisIntelligenceRecord | undefined;
  releaseSlug: string;
}>;

export type MuseWonderIntelligencePlacement = ReleaseIntelligencePlacement & Readonly<{
  /** Comparable configurations that cost strictly less per task than the placed row. */
  cheaperCount: number;
  /** The highest-scoring other comparable configurations after the placed row, highest first. */
  closestBelow: readonly ClosestBelow[];
  /** Comparable configurations that cost strictly more per task than the placed row. */
  costlierCount: number;
  /** The placed row's bill for each cost part ranked against the cohort. */
  partRanks: Readonly<Record<CostPart, CostPartRank>>;
  /** Other comparable rows whose index prints the same at the given precision but is not equal, cheapest first. */
  sameRoundedScore: readonly RowAgainstReference[];
}>;

export const DEFAULT_CLOSEST_BELOW_COUNT = 5;
export const DEFAULT_SCORE_DECIMALS = 1;

function assertCount(count: number, label: string): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`${label} must be a non-negative integer: ${count}`);
  }
}

function compareIndexDesc(
  left: ArtificialAnalysisIntelligenceRecord,
  right: ArtificialAnalysisIntelligenceRecord,
): number {
  return right.intelligenceIndex - left.intelligenceIndex || left.id.localeCompare(right.id);
}

function compareCostAsc(
  left: ArtificialAnalysisIntelligenceRecord,
  right: ArtificialAnalysisIntelligenceRecord,
): number {
  return comparableTaskCost(left) - comparableTaskCost(right) || left.id.localeCompare(right.id);
}

/** A comparable row measured against `reference`: signed point gap and cost multiple. */
export function against(
  reference: ArtificialAnalysisIntelligenceRecord,
  record: ArtificialAnalysisIntelligenceRecord,
): RowAgainstReference {
  return {
    costMultiple: comparableTaskCost(record) / comparableTaskCost(reference),
    gapPoints: record.intelligenceIndex - reference.intelligenceIndex,
    record,
  };
}

/** The row's bill for one cost part in US dollars per task. */
export function costPartValue(record: ArtificialAnalysisIntelligenceRecord, part: CostPart): number {
  return taskCostBreakdown(record)[part];
}

/**
 * Ranks the placed row's bill for `part` against every comparable row,
 * largest bill first. Rank one means no other row pays more for that part.
 */
export function costPartRank(
  cohort: readonly ArtificialAnalysisIntelligenceRecord[],
  record: ArtificialAnalysisIntelligenceRecord,
  part: CostPart,
): CostPartRank {
  const value = costPartValue(record, part);
  const atLeastAsLarge = cohort
    .filter(candidate => costPartValue(candidate, part) >= value)
    .toSorted((left, right) => costPartValue(right, part) - costPartValue(left, part) || left.id.localeCompare(right.id));
  return {
    atLeastAsLarge,
    cohortSize: cohort.length,
    part,
    rank: cohort.filter(candidate => costPartValue(candidate, part) > value).length + 1,
    value,
  };
}

/** Rounds an index to `decimals` places the way the chart prints it. */
function roundedIndex(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

/**
 * Other comparable rows whose index prints the same as `record`'s at
 * `decimals` places while differing at stored precision, cheapest first. A
 * row with an exactly equal index is a tie, not a rounding coincidence, and
 * is left out.
 */
export function sameRoundedScoreRows(
  cohort: readonly ArtificialAnalysisIntelligenceRecord[],
  record: ArtificialAnalysisIntelligenceRecord,
  decimals = DEFAULT_SCORE_DECIMALS,
): readonly RowAgainstReference[] {
  assertCount(decimals, "Decimals");
  const printed = roundedIndex(record.intelligenceIndex, decimals);
  return cohort
    .filter(candidate => (
      candidate.id !== record.id
      && candidate.intelligenceIndex !== record.intelligenceIndex
      && roundedIndex(candidate.intelligenceIndex, decimals) === printed
    ))
    .toSorted(compareCostAsc)
    .map(candidate => against(record, candidate));
}

/** The `count` highest-scoring other comparable rows at or under the placed score, highest first. */
export function closestRowsBelow(
  cohort: readonly ArtificialAnalysisIntelligenceRecord[],
  record: ArtificialAnalysisIntelligenceRecord,
  count = DEFAULT_CLOSEST_BELOW_COUNT,
): readonly ClosestBelow[] {
  assertCount(count, "Counts");
  const cost = comparableTaskCost(record);
  return cohort
    .filter(candidate => candidate.id !== record.id && candidate.intelligenceIndex <= record.intelligenceIndex)
    .toSorted(compareIndexDesc)
    .slice(0, count)
    .map(candidate => ({
      costMultiple: comparableTaskCost(candidate) / cost,
      gapPoints: record.intelligenceIndex - candidate.intelligenceIndex,
      record: candidate,
    }));
}

export function museWonderIntelligencePlacement(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  pointWindow = 1,
  closestBelowCount = DEFAULT_CLOSEST_BELOW_COUNT,
  scoreDecimals = DEFAULT_SCORE_DECIMALS,
): MuseWonderIntelligencePlacement | undefined {
  const placement = releaseIntelligencePlacement(records, MUSE_WONDER_INTELLIGENCE_SLUG, pointWindow);
  if (placement === undefined) return undefined;
  const cohort = comparableIntelligenceRecords(records);
  const cost = comparableTaskCost(placement.record);
  const partRanks = Object.fromEntries(
    [...COST_COMPONENTS, ...COST_SIDES].map(part => [part, costPartRank(cohort, placement.record, part)]),
  ) as Record<CostPart, CostPartRank>;
  return {
    ...placement,
    cheaperCount: cohort.filter(candidate => comparableTaskCost(candidate) < cost).length,
    closestBelow: closestRowsBelow(cohort, placement.record, closestBelowCount),
    costlierCount: cohort.filter(candidate => comparableTaskCost(candidate) > cost).length,
    partRanks,
    sameRoundedScore: sameRoundedScoreRows(cohort, placement.record, scoreDecimals),
  };
}

/** The input and output sides of each row's cost per task, measured against `reference`, cheapest first. */
export function costSideRows(
  reference: ArtificialAnalysisIntelligenceRecord,
  rows: readonly ArtificialAnalysisIntelligenceRecord[],
): readonly CostSideRow[] {
  return rows
    .toSorted(compareCostAsc)
    .map((record) => {
      const cost = taskCostBreakdown(record);
      return {
        ...against(reference, record),
        cacheWriteCost: cost.cacheWrite,
        inputCost: cost.input,
        inputShare: Math.min(1, Math.max(0, cost.input / cost.total)),
        outputCost: cost.output,
      };
    });
}

/** Every comparable row of the creator, including the placed row, highest index first. */
export function creatorRows(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  creatorSlug: string = META_CREATOR_SLUG,
): readonly ArtificialAnalysisIntelligenceRecord[] {
  return comparableIntelligenceRecords(records)
    .filter(record => record.creator.slug === creatorSlug)
    .toSorted(compareIndexDesc);
}

/** The cost frontier drawn through the creator's rows alone, highest score first. */
export function creatorFrontier(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  creatorSlug: string = META_CREATOR_SLUG,
): readonly ArtificialAnalysisIntelligenceRecord[] {
  return orderedParetoPath(creatorRows(records, creatorSlug), "costUsdPerTask").map(point => point.record).toReversed();
}

/**
 * The creator's other comparable rows measured against `reference`, highest
 * index first, each flagged when it is a vertex of the creator-only cost
 * frontier. The reference row itself is left out.
 */
export function creatorRowsAgainst(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  reference: ArtificialAnalysisIntelligenceRecord,
  creatorSlug: string = META_CREATOR_SLUG,
): readonly FamilyRow[] {
  const family = creatorRows(records, creatorSlug);
  const membership = paretoMembership(family, "costUsdPerTask");
  return family
    .filter(record => record.id !== reference.id)
    .map(record => ({ ...against(reference, record), onFamilyFrontier: membership.has(record.id) }));
}

/**
 * For each release Meta's table names, the comparable chart row at the
 * table's effort level (max), choosing the highest-scoring row when the
 * release stores several at that level.
 */
export function vendorComparisonRows(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  releaseSlugs: readonly string[] = MUSE_WONDER_VENDOR_COMPARISON_RELEASE_SLUGS,
  effortSlug = "max",
): readonly VendorComparisonRow[] {
  const cohort = comparableIntelligenceRecords(records);
  return releaseSlugs.map(releaseSlug => ({
    record: cohort
      .filter(record => record.release.slug === releaseSlug && record.effort?.slug === effortSlug)
      .toSorted(compareIndexDesc)[0],
    releaseSlug,
  }));
}
