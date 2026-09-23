import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import type { BenchmarkMetric, CodingAgentRecord, CodingAgentSnapshot } from "./coding-agent-data";
import { aaIndexCostFrontier } from "./coding-agent-snapshot-rows";
import { comparableIntelligenceRecords, paretoMembership } from "./intelligence-efficiency";
import { comparableTaskCost } from "./mimo-v2-6-pro-frontier";

/**
 * Snapshot-derived facts for the Grok 4.7 placement note. The coding-agent
 * helpers rank the same rows the coding chart plots, and the Intelligence
 * Index helpers work inside the same comparable cohort as the homepage chart,
 * so the note and the charts cannot disagree.
 */

export const GROK_47_CODING_CONFIGURATION = {
  agent: "Grok Build",
  model: "Grok 4.7",
  providerId: "xai",
} as const;

export const GROK_46_CODING_CONFIGURATION = {
  agent: "Grok Build",
  model: "Grok 4.6",
  providerId: "xai",
} as const;

export const GROK_47_INTELLIGENCE_SLUG = "grok-4-7" as const;
export const GROK_47_INTELLIGENCE_HIGH_SLUG = "grok-4-7-high" as const;

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
  /** Highest-scoring row on this component, which may be Grok 4.7 itself. */
  leader: CodingAgentRecord;
  metric: CodingComponentMetric;
  /** One-based rank among rows carrying this component, ties sharing the higher rank. */
  rank: number;
  value: number;
}>;

export type GrokCodingAgentPlacement = Readonly<{
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
  onCostFrontier: boolean;
  /** The Grok Build · Grok 4.6 row at the same setting, when the snapshot stores one. */
  predecessor: CodingAgentRecord | undefined;
  /** One-based rank by AA Index, ties sharing the higher rank. */
  rank: number;
  record: CostedCodingAgentRecord;
}>;

export type GrokIntelligencePlacement = Readonly<{
  /** Cheapest configuration that scores strictly higher, with its cost as a multiple of Grok 4.7’s. */
  cheapestHigher: Readonly<{ multiple: number; record: ArtificialAnalysisIntelligenceRecord }> | undefined;
  cohortSize: number;
  /** Configurations that cost the same or less and score the same or higher, strict in at least one, cheapest first. */
  dominators: readonly ArtificialAnalysisIntelligenceRecord[];
  /** The Grok 4.7 (high) row inside the comparable cohort, when the snapshot stores one. */
  high: ArtificialAnalysisIntelligenceRecord | undefined;
  leader: ArtificialAnalysisIntelligenceRecord;
  /** Other configurations within one index point, cheapest first. */
  neighbors: readonly ArtificialAnalysisIntelligenceRecord[];
  onCostFrontier: boolean;
  /** One-based rank by Intelligence Index, ties sharing the higher rank. */
  rank: number;
  record: ArtificialAnalysisIntelligenceRecord;
}>;

function hasIndex(record: CodingAgentRecord): record is IndexedCodingAgentRecord {
  return record.benchmarks.aaIndex !== null;
}

function hasCost(record: IndexedCodingAgentRecord): record is CostedCodingAgentRecord {
  return record.economics.costUsd !== null && record.economics.costUsd > 0;
}

function matchesConfiguration(
  record: CodingAgentRecord,
  configuration: typeof GROK_47_CODING_CONFIGURATION | typeof GROK_46_CODING_CONFIGURATION,
): boolean {
  return record.agent === configuration.agent
    && record.model === configuration.model
    && record.providerId === configuration.providerId;
}

function compareIndexDesc(left: IndexedCodingAgentRecord, right: IndexedCodingAgentRecord): number {
  return right.benchmarks.aaIndex - left.benchmarks.aaIndex || left.id.localeCompare(right.id);
}

/** Every Grok Build · Grok 4.7 row that carries an AA Index and a cost, highest AA Index first. */
export function grokCodingAgentRecords(
  records: readonly CodingAgentRecord[],
): readonly CostedCodingAgentRecord[] {
  return records
    .filter(record => matchesConfiguration(record, GROK_47_CODING_CONFIGURATION))
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

export function grokCodingAgentPlacement(
  records: readonly CodingAgentRecord[],
): GrokCodingAgentPlacement | undefined {
  const [record] = grokCodingAgentRecords(records);
  if (record === undefined) return undefined;
  const indexed = records.filter(hasIndex).toSorted(compareIndexDesc);
  const [leader] = indexed;
  if (leader === undefined) return undefined;
  const index = record.benchmarks.aaIndex;
  const cost = record.economics.costUsd;
  const higher = indexed.filter(candidate => candidate.benchmarks.aaIndex > index);
  const dominators = indexed
    .filter(hasCost)
    .filter(candidate => (
      candidate.id !== record.id
      && candidate.economics.costUsd <= cost
      && candidate.benchmarks.aaIndex >= index
      && (candidate.economics.costUsd < cost || candidate.benchmarks.aaIndex > index)
    ))
    .toSorted((left, right) => (
      left.economics.costUsd - right.economics.costUsd || left.id.localeCompare(right.id)
    ));
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
  const predecessor = records.find(candidate => (
    matchesConfiguration(candidate, GROK_46_CODING_CONFIGURATION)
    && candidate.setting === record.setting
  ));
  return {
    components,
    dominators,
    higher,
    indexedCount: indexed.length,
    leader,
    lowerIndexHigherTerminal,
    onCostFrontier: aaIndexCostFrontier(records).some(point => point.record.id === record.id),
    predecessor,
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
    && update.agent === record.agent
    && update.model === record.model
    && update.providerId === record.providerId
  ))?.detectedAt;
}

export function grokIntelligencePlacement(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  pointWindow = 1,
): GrokIntelligencePlacement | undefined {
  if (!Number.isFinite(pointWindow) || pointWindow <= 0) {
    throw new RangeError("The score window must be a positive number of index points.");
  }
  const cohort = comparableIntelligenceRecords(records);
  const record = cohort.find(candidate => candidate.slug === GROK_47_INTELLIGENCE_SLUG);
  const [leader] = cohort;
  if (record === undefined || leader === undefined) return undefined;
  const cost = comparableTaskCost(record);
  const dominators = cohort
    .filter(candidate => (
      candidate.id !== record.id
      && comparableTaskCost(candidate) <= cost
      && candidate.intelligenceIndex >= record.intelligenceIndex
      && (comparableTaskCost(candidate) < cost || candidate.intelligenceIndex > record.intelligenceIndex)
    ))
    .toSorted((left, right) => (
      comparableTaskCost(left) - comparableTaskCost(right) || left.id.localeCompare(right.id)
    ));
  const [cheapestHigher] = cohort
    .filter(candidate => candidate.intelligenceIndex > record.intelligenceIndex)
    .toSorted((left, right) => (
      comparableTaskCost(left) - comparableTaskCost(right) || left.id.localeCompare(right.id)
    ));
  const neighbors = cohort
    .filter(candidate => (
      candidate.id !== record.id
      && Math.abs(candidate.intelligenceIndex - record.intelligenceIndex) <= pointWindow
    ))
    .toSorted((left, right) => (
      comparableTaskCost(left) - comparableTaskCost(right) || left.id.localeCompare(right.id)
    ));
  return {
    cheapestHigher: cheapestHigher === undefined
      ? undefined
      : { multiple: comparableTaskCost(cheapestHigher) / cost, record: cheapestHigher },
    cohortSize: cohort.length,
    dominators,
    high: cohort.find(candidate => candidate.slug === GROK_47_INTELLIGENCE_HIGH_SLUG),
    leader,
    neighbors,
    onCostFrontier: paretoMembership(cohort, "costUsdPerTask").has(record.id),
    rank: competitionRank(record.intelligenceIndex, cohort.map(candidate => candidate.intelligenceIndex)),
    record,
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
