import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import { comparableIntelligenceRecords, orderedParetoPath } from "./intelligence-efficiency";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";
import {
  COST_COMPONENTS,
  COST_SIDES,
  against,
  closestRowsBelow,
  costPartRank,
  type CostPart,
  type CostPartRank,
  type RowAgainstReference,
} from "./muse-wonder-placement";
import {
  releaseIntelligencePlacement,
  type ReleaseIntelligencePlacement,
} from "./snapshot-placement";

/**
 * Kimi K3.1 Pro bindings of the shared snapshot placement helpers. The
 * Intelligence Index stores one Kimi K3.1 Pro row, so the note has no effort
 * ladder. What it needs beyond the shared placement is who the rows above it
 * belong to, how the highest row of every other creator measures against it,
 * which frontier vertices sit either side of it, how its cost parts rank
 * against the cohort, and how the chart's open-weights flags fall around it.
 */

export const KIMI_K3_1_PRO_INTELLIGENCE_SLUG = "kimi-k3-1-pro" as const;
export const KIMI_K3_1_PRO_RELEASE_SLUG = "kimi-k3-1-pro" as const;
export const KIMI_CREATOR_SLUG = "kimi" as const;
export const DEFAULT_OTHER_CREATOR_COUNT = 6;

export type CreatorBestRow = RowAgainstReference & Readonly<{
  /** The creator's display name as the snapshot stores it. */
  creatorName: string;
  /** Comparable rows the creator has on the chart, including this one. */
  creatorRowCount: number;
}>;

export type FrontierSteps = Readonly<{
  /** The cost-frontier vertex just below the placed row, or undefined when the row is the lowest vertex or off the frontier. */
  down: RowAgainstReference | undefined;
  onCostFrontier: boolean;
  /** The cost-frontier vertex just above the placed row, or undefined when the row is the top vertex or off the frontier. */
  up: RowAgainstReference | undefined;
}>;

export type WeightsSummary = Readonly<{
  /** Comparable rows the snapshot flags as closed weights. */
  closedCount: number;
  /** The highest-scoring comparable row flagged open, measured against the placed row, or undefined when none is flagged. */
  highestOpen: RowAgainstReference | undefined;
  /** The placed row's own flag, or undefined when the snapshot stores none for it. */
  open: boolean | undefined;
  /** Comparable rows the snapshot flags as open weights. */
  openCount: number;
  /** Comparable rows with no weights flag. */
  unclassifiedCount: number;
}>;

export type KimiK31ProIntelligencePlacement = ReleaseIntelligencePlacement & Readonly<{
  /** Comparable configurations that cost strictly less per task than the placed row. */
  cheaperCount: number;
  /** The highest-scoring other comparable configurations after the placed row, highest first. */
  closestBelow: readonly RowAgainstReference[];
  /** Comparable configurations that cost strictly more per task than the placed row. */
  costlierCount: number;
  /** Distinct creator names of the rows above the placed row, in rank order. */
  creatorsAbove: readonly string[];
  frontier: FrontierSteps;
  /** The highest-scoring comparable row of each other creator, highest first, limited to a count. */
  otherCreatorBests: readonly CreatorBestRow[];
  /** The placed row's bill for each cost part ranked against the cohort. */
  partRanks: Readonly<Record<CostPart, CostPartRank>>;
  /** Comparable configurations ranked above the placed row, highest first. */
  rowsAbove: readonly RowAgainstReference[];
  weights: WeightsSummary;
}>;

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

/** Comparable rows that score strictly higher than `record`, highest first, measured against it. */
export function rowsAbove(
  cohort: readonly ArtificialAnalysisIntelligenceRecord[],
  record: ArtificialAnalysisIntelligenceRecord,
): readonly RowAgainstReference[] {
  return cohort
    .filter(candidate => candidate.intelligenceIndex > record.intelligenceIndex)
    .toSorted(compareIndexDesc)
    .map(candidate => against(record, candidate));
}

/** Distinct creator names of `rows`, in the order they first appear. */
export function creatorNames(rows: readonly RowAgainstReference[]): readonly string[] {
  return [...new Set(rows.map(row => row.record.creator.name))];
}

/**
 * The highest-scoring comparable row of each creator other than `record`'s,
 * highest first, measured against `record`. `count` limits the result.
 */
export function otherCreatorBestRows(
  cohort: readonly ArtificialAnalysisIntelligenceRecord[],
  record: ArtificialAnalysisIntelligenceRecord,
  count = DEFAULT_OTHER_CREATOR_COUNT,
): readonly CreatorBestRow[] {
  assertCount(count, "Counts");
  const bests = new Map<string, ArtificialAnalysisIntelligenceRecord>();
  const sizes = new Map<string, number>();
  for (const candidate of cohort.toSorted(compareIndexDesc)) {
    if (candidate.creator.slug === record.creator.slug) continue;
    sizes.set(candidate.creator.slug, (sizes.get(candidate.creator.slug) ?? 0) + 1);
    if (!bests.has(candidate.creator.slug)) bests.set(candidate.creator.slug, candidate);
  }
  return [...bests.values()]
    .slice(0, count)
    .map(best => ({
      ...against(record, best),
      creatorName: best.creator.name,
      creatorRowCount: sizes.get(best.creator.slug) ?? 1,
    }));
}

/** The cost-frontier vertices either side of `record`, walking the frontier highest score first. */
export function frontierSteps(
  cohort: readonly ArtificialAnalysisIntelligenceRecord[],
  record: ArtificialAnalysisIntelligenceRecord,
): FrontierSteps {
  const path = orderedParetoPath(cohort, "costUsdPerTask").map(point => point.record).toReversed();
  const index = path.findIndex(vertex => vertex.id === record.id);
  if (index < 0) return { down: undefined, onCostFrontier: false, up: undefined };
  const up = path[index - 1];
  const down = path[index + 1];
  return {
    down: down === undefined ? undefined : against(record, down),
    onCostFrontier: true,
    up: up === undefined ? undefined : against(record, up),
  };
}

/** How the snapshot's open-weights flags fall across the cohort and against `record`. */
export function weightsSummary(
  cohort: readonly ArtificialAnalysisIntelligenceRecord[],
  record: ArtificialAnalysisIntelligenceRecord,
): WeightsSummary {
  const open = cohort.filter(candidate => candidate.weights?.open === true).toSorted(compareIndexDesc);
  const [highestOpen] = open;
  return {
    closedCount: cohort.filter(candidate => candidate.weights?.open === false).length,
    highestOpen: highestOpen === undefined ? undefined : against(record, highestOpen),
    open: record.weights?.open,
    openCount: open.length,
    unclassifiedCount: cohort.filter(candidate => candidate.weights === undefined).length,
  };
}

export function kimiK31ProIntelligencePlacement(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  pointWindow = 1,
  otherCreatorCount = DEFAULT_OTHER_CREATOR_COUNT,
): KimiK31ProIntelligencePlacement | undefined {
  const placement = releaseIntelligencePlacement(records, KIMI_K3_1_PRO_INTELLIGENCE_SLUG, pointWindow);
  if (placement === undefined) return undefined;
  const cohort = comparableIntelligenceRecords(records);
  const cost = comparableTaskCost(placement.record);
  const above = rowsAbove(cohort, placement.record);
  const partRanks = Object.fromEntries(
    [...COST_COMPONENTS, ...COST_SIDES].map(part => [part, costPartRank(cohort, placement.record, part)]),
  ) as Record<CostPart, CostPartRank>;
  return {
    ...placement,
    cheaperCount: cohort.filter(candidate => comparableTaskCost(candidate) < cost).length,
    closestBelow: closestRowsBelow(cohort, placement.record).map(entry => against(placement.record, entry.record)),
    costlierCount: cohort.filter(candidate => comparableTaskCost(candidate) > cost).length,
    creatorsAbove: creatorNames(above),
    frontier: frontierSteps(cohort, placement.record),
    otherCreatorBests: otherCreatorBestRows(cohort, placement.record, otherCreatorCount),
    partRanks,
    rowsAbove: above,
    weights: weightsSummary(cohort, placement.record),
  };
}
