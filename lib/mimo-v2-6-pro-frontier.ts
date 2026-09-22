import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import {
  comparableIntelligenceRecords,
  orderedParetoPath,
  paretoMembership,
} from "./intelligence-efficiency";

/**
 * Snapshot-derived facts for the MiMo-V2.6-Pro benchmark note. Every function
 * works inside the same comparable Intelligence Index cohort the homepage chart
 * plots, so the note's frontier statements and the chart cannot disagree.
 */

export const MIMO_V26_RECORD_SLUG = "mimo-v2-6-pro" as const;

/** Configurations Das or Xiaomi name, keyed by the snapshot slug that carries the same model name. */
export type MimoNamedComparison = Readonly<{
  /** Das’s stated price multiple as a multiple of MiMo-V2.6-Pro’s price; null when only Xiaomi names the model. */
  dasMultiple: string | null;
  namedBy: "Das" | "Xiaomi" | "Das and Xiaomi";
  slug: string;
}>;

export const MIMO_V26_NAMED_COMPARISONS = [
  { dasMultiple: "15x", namedBy: "Das and Xiaomi", slug: "kimi-k3" },
  { dasMultiple: "6x", namedBy: "Das", slug: "glm-5-3" },
  { dasMultiple: "2x", namedBy: "Das", slug: "deepseek-v4-pro" },
  { dasMultiple: "0.5x", namedBy: "Das", slug: "deepseek-v4-1-flash" },
  { dasMultiple: null, namedBy: "Xiaomi", slug: "qwen3-8-max" },
] as const satisfies readonly MimoNamedComparison[];

/** Configurations Xiaomi names as the closed-weights models MiMo-V2.6-Pro still trails. */
export const MIMO_V26_CLOSED_REFERENCE_SLUGS = ["claude-fable-5-1", "gpt-6-astra"] as const;

export type MimoFrontierPosition = Readonly<{
  /** Frontier vertex with the next higher score, or undefined when MiMo is the top vertex or off the frontier. */
  above: ArtificialAnalysisIntelligenceRecord | undefined;
  /** Frontier vertex with the next lower score, or undefined when MiMo is the lowest-cost vertex or off the frontier. */
  below: ArtificialAnalysisIntelligenceRecord | undefined;
  /** Cheapest configuration that scores strictly higher, with its cost as a multiple of MiMo’s. */
  cheapestHigher: Readonly<{ multiple: number; record: ArtificialAnalysisIntelligenceRecord }> | undefined;
  /** Highest-scoring configuration that costs strictly less, with MiMo’s score minus its score. */
  bestCheaper: Readonly<{ gapPoints: number; record: ArtificialAnalysisIntelligenceRecord }> | undefined;
  cheaperCount: number;
  higherCount: number;
  onCostFrontier: boolean;
  record: ArtificialAnalysisIntelligenceRecord;
}>;

export type MimoComparisonRow = Readonly<{
  comparison: MimoNamedComparison;
  /** Configuration cost divided by MiMo-V2.6-Pro cost. */
  costMultiple: number;
  record: ArtificialAnalysisIntelligenceRecord;
  /** Configuration score minus MiMo-V2.6-Pro score, in index points. */
  scoreGapPoints: number;
}>;

/** Every comparable record carries a positive cost; the cohort filter guarantees it. */
export function comparableTaskCost(record: ArtificialAnalysisIntelligenceRecord): number {
  const total = record.costUsdPerTask?.total;
  if (total === undefined || total === null || !Number.isFinite(total) || total <= 0) {
    throw new RangeError(`Comparable record must carry a positive task cost: ${record.slug}`);
  }
  return total;
}

function cohortAndMimo(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
): Readonly<{
  cohort: readonly ArtificialAnalysisIntelligenceRecord[];
  mimo: ArtificialAnalysisIntelligenceRecord | undefined;
}> {
  const cohort = comparableIntelligenceRecords(records);
  return { cohort, mimo: cohort.find(record => record.slug === MIMO_V26_RECORD_SLUG) };
}

/** The MiMo-V2.6-Pro row inside the comparable cohort, or undefined when the snapshot lacks one. */
export function mimoRecord(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
): ArtificialAnalysisIntelligenceRecord | undefined {
  return cohortAndMimo(records).mimo;
}

export function mimoFrontierPosition(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
): MimoFrontierPosition | undefined {
  const { cohort, mimo } = cohortAndMimo(records);
  if (mimo === undefined) return undefined;
  const cost = comparableTaskCost(mimo);
  const membership = paretoMembership(cohort, "costUsdPerTask");
  const path = orderedParetoPath(cohort, "costUsdPerTask");
  const index = path.findIndex(point => point.record.id === mimo.id);
  const higher = cohort
    .filter(candidate => candidate.intelligenceIndex > mimo.intelligenceIndex)
    .toSorted((left, right) => (
      comparableTaskCost(left) - comparableTaskCost(right) || left.id.localeCompare(right.id)
    ));
  const cheaper = cohort
    .filter(candidate => comparableTaskCost(candidate) < cost)
    .toSorted((left, right) => (
      right.intelligenceIndex - left.intelligenceIndex || left.id.localeCompare(right.id)
    ));
  const [cheapestHigher] = higher;
  const [bestCheaper] = cheaper;
  return {
    above: index >= 0 ? path[index + 1]?.record : undefined,
    below: index >= 0 ? path[index - 1]?.record : undefined,
    bestCheaper: bestCheaper === undefined
      ? undefined
      : { gapPoints: mimo.intelligenceIndex - bestCheaper.intelligenceIndex, record: bestCheaper },
    cheapestHigher: cheapestHigher === undefined
      ? undefined
      : { multiple: comparableTaskCost(cheapestHigher) / cost, record: cheapestHigher },
    cheaperCount: cheaper.length,
    higherCount: higher.length,
    onCostFrontier: membership.has(mimo.id),
    record: mimo,
  };
}

/** Same-name rows for the models Das and Xiaomi compare against, in the order they are named. */
export function mimoComparisonRows(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
): readonly MimoComparisonRow[] {
  const { cohort, mimo } = cohortAndMimo(records);
  if (mimo === undefined) return [];
  const mimoCost = comparableTaskCost(mimo);
  return MIMO_V26_NAMED_COMPARISONS.flatMap((comparison) => {
    const record = cohort.find(candidate => candidate.slug === comparison.slug);
    if (record === undefined) return [];
    return [{
      comparison,
      costMultiple: comparableTaskCost(record) / mimoCost,
      record,
      scoreGapPoints: record.intelligenceIndex - mimo.intelligenceIndex,
    }];
  });
}

/** Every other comparable configuration within the score window of MiMo-V2.6-Pro, cheapest first. */
export function mimoScoreNeighbors(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  pointWindow = 1,
): readonly ArtificialAnalysisIntelligenceRecord[] {
  if (!Number.isFinite(pointWindow) || pointWindow <= 0) {
    throw new RangeError("The score window must be a positive number of index points.");
  }
  const { cohort, mimo } = cohortAndMimo(records);
  if (mimo === undefined) return [];
  return cohort
    .filter(candidate => (
      candidate.id !== mimo.id
      && Math.abs(candidate.intelligenceIndex - mimo.intelligenceIndex) <= pointWindow
    ))
    .toSorted((left, right) => (
      comparableTaskCost(left) - comparableTaskCost(right) || left.id.localeCompare(right.id)
    ));
}

/** Closed-weights reference rows Xiaomi names, in the order the slugs are listed. */
export function mimoClosedReferences(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
): readonly ArtificialAnalysisIntelligenceRecord[] {
  const cohort = comparableIntelligenceRecords(records);
  return MIMO_V26_CLOSED_REFERENCE_SLUGS.flatMap((slug) => {
    const record = cohort.find(candidate => candidate.slug === slug);
    return record === undefined ? [] : [record];
  });
}

export function formatCostMultiple(multiple: number): string {
  if (!Number.isFinite(multiple) || multiple <= 0) {
    throw new RangeError(`Cost multiples must be positive: ${multiple}`);
  }
  return `${multiple.toFixed(1)}x`;
}

/** Signed one-decimal point gap with a true minus sign, so “−2.7” and “+0.4” read as differences. */
export function formatPointGap(points: number): string {
  if (!Number.isFinite(points)) throw new RangeError(`Point gaps must be finite: ${points}`);
  const magnitude = Math.abs(points).toFixed(1);
  return points < 0 ? `−${magnitude}` : `+${magnitude}`;
}
