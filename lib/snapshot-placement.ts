import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import type { BenchmarkMetric, CodingAgentRecord, CodingAgentSnapshot } from "./coding-agent-data";
import { aaIndexCostFrontier } from "./coding-agent-snapshot-rows";
import { comparableIntelligenceRecords, paretoMembership } from "./intelligence-efficiency";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";

/**
 * Snapshot-derived placement facts for one named configuration. The coding-
 * agent helpers rank the same rows the coding chart plots, and the
 * Intelligence Index helpers work inside the same comparable cohort as the
 * homepage chart, so a placement note and the charts cannot disagree. Model
 * notes bind these helpers to their own configuration constants.
 */

export type CodingConfiguration = Readonly<{
  agent: string;
  model: string;
  providerId: string;
}>;

export const CODING_COMPONENT_METRICS = ["deepSwe", "terminalBench", "sweAtlas"] as const satisfies readonly BenchmarkMetric[];
export type CodingComponentMetric = (typeof CODING_COMPONENT_METRICS)[number];

export type IndexedCodingAgentRecord = CodingAgentRecord & Readonly<{
  benchmarks: CodingAgentRecord["benchmarks"] & Readonly<{ aaIndex: number }>;
}>;

export type CostedCodingAgentRecord = IndexedCodingAgentRecord & Readonly<{
  economics: CodingAgentRecord["economics"] & Readonly<{ costUsd: number }>;
}>;

export type CodingComponentPlacement = Readonly<{
  /** Rows carrying this component score. */
  count: number;
  /** Highest-scoring row on this component, which may be the placed row itself. */
  leader: CodingAgentRecord;
  metric: CodingComponentMetric;
  /** One-based rank among rows carrying this component, ties sharing the higher rank. */
  rank: number;
  value: number;
}>;

export type CodingAgentPlacement = Readonly<{
  /** Cheapest row with a strictly higher AA Index, with its cost as a multiple of the placed row’s. */
  cheapestHigher: Readonly<{ multiple: number; record: CostedCodingAgentRecord }> | undefined;
  components: readonly CodingComponentPlacement[];
  /** Rows that cost the same or less and score the same or higher on AA Index, strict in at least one, cheapest first. */
  dominators: readonly CostedCodingAgentRecord[];
  /** Rows with a higher AA Index, highest first. */
  higher: readonly IndexedCodingAgentRecord[];
  /** Rows carrying an AA Index. */
  indexedCount: number;
  leader: IndexedCodingAgentRecord;
  /** Rows with a lower AA Index and a higher Terminal-Bench 4 score, highest AA Index first. */
  lowerIndexHigherTerminal: readonly IndexedCodingAgentRecord[];
  /** Other costed rows within the AA Index point window, cheapest first. */
  neighbors: readonly CostedCodingAgentRecord[];
  onCostFrontier: boolean;
  /** The predecessor configuration at the same setting, when the snapshot stores one. */
  predecessor: CodingAgentRecord | undefined;
  /** One-based rank by AA Index, ties sharing the higher rank. */
  rank: number;
  record: CostedCodingAgentRecord;
}>;

export type IntelligencePlacement = Readonly<{
  /** Cheapest configuration that scores strictly higher, with its cost as a multiple of the placed row’s. */
  cheapestHigher: Readonly<{ multiple: number; record: ArtificialAnalysisIntelligenceRecord }> | undefined;
  cohortSize: number;
  /** Configurations that cost the same or less and score the same or higher, strict in at least one, cheapest first. */
  dominators: readonly ArtificialAnalysisIntelligenceRecord[];
  leader: ArtificialAnalysisIntelligenceRecord;
  /** Other configurations within the index point window, cheapest first. */
  neighbors: readonly ArtificialAnalysisIntelligenceRecord[];
  onCostFrontier: boolean;
  /** One-based rank by Intelligence Index, ties sharing the higher rank. */
  rank: number;
  record: ArtificialAnalysisIntelligenceRecord;
  /** Other comparable rows of the same release, such as other effort levels, highest index first. */
  siblings: readonly ArtificialAnalysisIntelligenceRecord[];
}>;

export type EffortStep = Readonly<{
  /** Index points added over the next cheaper effort level, or null for the cheapest level. */
  pointsOverCheaper: number | null;
  /** Cost as a multiple of the next cheaper effort level, or null for the cheapest level. */
  costMultipleOverCheaper: number | null;
  record: ArtificialAnalysisIntelligenceRecord;
}>;

export type ReleaseIntelligencePlacement = IntelligencePlacement & Readonly<{
  /** The placed row and every comparable sibling that carries an effort level, cheapest first, with the step from the level before. */
  effortLadder: readonly EffortStep[];
  /** Comparable siblings without an effort level, such as a non-reasoning mode, highest index first. */
  otherModes: readonly ArtificialAnalysisIntelligenceRecord[];
}>;

function hasIndex(record: CodingAgentRecord): record is IndexedCodingAgentRecord {
  return record.benchmarks.aaIndex !== null;
}

function hasCost(record: IndexedCodingAgentRecord): record is CostedCodingAgentRecord {
  return record.economics.costUsd !== null && record.economics.costUsd > 0;
}

export function matchesCodingConfiguration(
  record: Pick<CodingAgentRecord, "agent" | "model" | "providerId">,
  configuration: CodingConfiguration,
): boolean {
  return record.agent === configuration.agent
    && record.model === configuration.model
    && record.providerId === configuration.providerId;
}

function compareIndexDesc(left: IndexedCodingAgentRecord, right: IndexedCodingAgentRecord): number {
  return right.benchmarks.aaIndex - left.benchmarks.aaIndex || left.id.localeCompare(right.id);
}

function compareCostAsc(left: CostedCodingAgentRecord, right: CostedCodingAgentRecord): number {
  return left.economics.costUsd - right.economics.costUsd || left.id.localeCompare(right.id);
}

function assertPointWindow(pointWindow: number): void {
  if (!Number.isFinite(pointWindow) || pointWindow <= 0) {
    throw new RangeError("The score window must be a positive number of index points.");
  }
}

/** Every row of the configuration that carries an AA Index and a cost, highest AA Index first. */
export function codingAgentRecordsFor(
  records: readonly CodingAgentRecord[],
  configuration: CodingConfiguration,
): readonly CostedCodingAgentRecord[] {
  return records
    .filter(record => matchesCodingConfiguration(record, configuration))
    .filter(hasIndex)
    .filter(hasCost)
    .toSorted(compareIndexDesc);
}

/** One-based rank where ties share the higher rank: the count of strictly better values plus one. */
export function competitionRank(value: number, values: readonly number[]): number {
  return values.filter(candidate => candidate > value).length + 1;
}

function componentPlacement(
  metric: CodingComponentMetric,
  record: CodingAgentRecord,
  records: readonly CodingAgentRecord[],
): CodingComponentPlacement | undefined {
  const value = record.benchmarks[metric];
  if (value === null) return undefined;
  const carrying = records.filter(candidate => candidate.benchmarks[metric] !== null);
  const values = carrying.map(candidate => candidate.benchmarks[metric] ?? Number.NaN);
  const leader = carrying.toSorted((left, right) => (
    (right.benchmarks[metric] ?? Number.NaN) - (left.benchmarks[metric] ?? Number.NaN)
    || left.id.localeCompare(right.id)
  ))[0];
  if (leader === undefined) return undefined;
  return { count: carrying.length, leader, metric, rank: competitionRank(value, values), value };
}

/**
 * Places the highest-indexed costed row of `configuration` among every row
 * that carries an AA Index. `predecessor` names the earlier generation in the
 * same harness; it is matched only at the placed row’s setting.
 */
export function codingAgentPlacement(
  records: readonly CodingAgentRecord[],
  configuration: CodingConfiguration,
  predecessor?: CodingConfiguration,
  pointWindow = 1,
): CodingAgentPlacement | undefined {
  assertPointWindow(pointWindow);
  const [record] = codingAgentRecordsFor(records, configuration);
  if (record === undefined) return undefined;
  const indexed = records.filter(hasIndex).toSorted(compareIndexDesc);
  const [leader] = indexed;
  if (leader === undefined) return undefined;
  const index = record.benchmarks.aaIndex;
  const cost = record.economics.costUsd;
  const costed = indexed.filter(hasCost);
  const higher = indexed.filter(candidate => candidate.benchmarks.aaIndex > index);
  const dominators = costed
    .filter(candidate => (
      candidate.id !== record.id
      && candidate.economics.costUsd <= cost
      && candidate.benchmarks.aaIndex >= index
      && (candidate.economics.costUsd < cost || candidate.benchmarks.aaIndex > index)
    ))
    .toSorted(compareCostAsc);
  const [cheapestHigher] = costed
    .filter(candidate => candidate.benchmarks.aaIndex > index)
    .toSorted(compareCostAsc);
  const neighbors = costed
    .filter(candidate => (
      candidate.id !== record.id
      && Math.abs(candidate.benchmarks.aaIndex - index) <= pointWindow
    ))
    .toSorted(compareCostAsc);
  const terminal = record.benchmarks.terminalBench;
  const lowerIndexHigherTerminal = terminal === null
    ? []
    : indexed.filter(candidate => (
      candidate.benchmarks.aaIndex < index
      && candidate.benchmarks.terminalBench !== null
      && candidate.benchmarks.terminalBench > terminal
    ));
  const components = CODING_COMPONENT_METRICS.flatMap((metric) => {
    const placement = componentPlacement(metric, record, records);
    return placement === undefined ? [] : [placement];
  });
  return {
    cheapestHigher: cheapestHigher === undefined
      ? undefined
      : { multiple: cheapestHigher.economics.costUsd / cost, record: cheapestHigher },
    components,
    dominators,
    higher,
    indexedCount: indexed.length,
    leader,
    lowerIndexHigherTerminal,
    neighbors,
    onCostFrontier: aaIndexCostFrontier(records).some(point => point.record.id === record.id),
    predecessor: predecessor === undefined
      ? undefined
      : records.find(candidate => (
        matchesCodingConfiguration(candidate, predecessor) && candidate.setting === record.setting
      )),
    rank: competitionRank(index, indexed.map(candidate => candidate.benchmarks.aaIndex)),
    record,
  };
}

/** The `model-added` update that first recorded a configuration, when the bounded update log still holds it. */
export function modelAddedAt(
  snapshot: Pick<CodingAgentSnapshot, "updates">,
  record: Pick<CodingAgentRecord, "agent" | "model" | "providerId">,
): string | undefined {
  return snapshot.updates.find(update => (
    update.kind === "model-added"
    && matchesCodingConfiguration(update, record)
  ))?.detectedAt;
}

/**
 * Places the comparable row with `slug` inside the same cohort the homepage
 * capability chart plots. Siblings are the other comparable rows of the same
 * release, which lets a note describe an effort ladder without a second lookup.
 */
export function intelligencePlacement(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  slug: string,
  pointWindow = 1,
): IntelligencePlacement | undefined {
  assertPointWindow(pointWindow);
  const cohort = comparableIntelligenceRecords(records);
  const record = cohort.find(candidate => candidate.slug === slug);
  const [leader] = cohort;
  if (record === undefined || leader === undefined) return undefined;
  const cost = comparableTaskCost(record);
  const byCost = (
    left: ArtificialAnalysisIntelligenceRecord,
    right: ArtificialAnalysisIntelligenceRecord,
  ): number => comparableTaskCost(left) - comparableTaskCost(right) || left.id.localeCompare(right.id);
  const dominators = cohort
    .filter(candidate => (
      candidate.id !== record.id
      && comparableTaskCost(candidate) <= cost
      && candidate.intelligenceIndex >= record.intelligenceIndex
      && (comparableTaskCost(candidate) < cost || candidate.intelligenceIndex > record.intelligenceIndex)
    ))
    .toSorted(byCost);
  const [cheapestHigher] = cohort
    .filter(candidate => candidate.intelligenceIndex > record.intelligenceIndex)
    .toSorted(byCost);
  const neighbors = cohort
    .filter(candidate => (
      candidate.id !== record.id
      && Math.abs(candidate.intelligenceIndex - record.intelligenceIndex) <= pointWindow
    ))
    .toSorted(byCost);
  const siblings = cohort
    .filter(candidate => candidate.id !== record.id && candidate.release.slug === record.release.slug)
    .toSorted((left, right) => (
      right.intelligenceIndex - left.intelligenceIndex || left.id.localeCompare(right.id)
    ));
  return {
    cheapestHigher: cheapestHigher === undefined
      ? undefined
      : { multiple: comparableTaskCost(cheapestHigher) / cost, record: cheapestHigher },
    cohortSize: cohort.length,
    dominators,
    leader,
    neighbors,
    onCostFrontier: paretoMembership(cohort, "costUsdPerTask").has(record.id),
    rank: competitionRank(record.intelligenceIndex, cohort.map(candidate => candidate.intelligenceIndex)),
    record,
    siblings,
  };
}

function hasEffortLevel(record: ArtificialAnalysisIntelligenceRecord): boolean {
  return record.effort !== null;
}

/**
 * Orders the placed row and the siblings that carry an effort level cheapest
 * first and states what each step up the ladder buys. A step may buy negative
 * points when a costlier level scores lower, which a note must be able to
 * print. Siblings without an effort level are a different mode, not a step,
 * and are left out.
 */
export function effortLadder(
  record: ArtificialAnalysisIntelligenceRecord,
  siblings: readonly ArtificialAnalysisIntelligenceRecord[],
): readonly EffortStep[] {
  const rows = [record, ...siblings.filter(hasEffortLevel)].toSorted((left, right) => (
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

/** `intelligencePlacement` plus the release’s effort ladder and its other modes. */
export function releaseIntelligencePlacement(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  slug: string,
  pointWindow = 1,
): ReleaseIntelligencePlacement | undefined {
  const placement = intelligencePlacement(records, slug, pointWindow);
  if (placement === undefined) return undefined;
  return {
    ...placement,
    effortLadder: effortLadder(placement.record, placement.siblings),
    otherModes: placement.siblings.filter(sibling => !hasEffortLevel(sibling)),
  };
}

/** One decimal for ordinary multiples; two decimals below 0.1x so a very cheap neighbor does not print as 0.0x. */
export function formatFineCostMultiple(multiple: number): string {
  if (!Number.isFinite(multiple) || multiple <= 0) {
    throw new RangeError(`Cost multiples must be positive: ${multiple}`);
  }
  return multiple < 0.1 ? `${multiple.toFixed(2)}x` : `${multiple.toFixed(1)}x`;
}

const ORDINAL_WORDS = [
  "zeroth",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
] as const;

/** Spell zero through nine as ordinal words and use numerals with a suffix from 10. */
export function spellOrdinal(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Ordinals must be non-negative integers: ${value}`);
  }
  const word = ORDINAL_WORDS[value];
  if (word !== undefined) return word;
  const remainderHundred = value % 100;
  if (remainderHundred >= 11 && remainderHundred <= 13) return `${value}th`;
  const remainderTen = value % 10;
  if (remainderTen === 1) return `${value}st`;
  if (remainderTen === 2) return `${value}nd`;
  if (remainderTen === 3) return `${value}rd`;
  return `${value}th`;
}
