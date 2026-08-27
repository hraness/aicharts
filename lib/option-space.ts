import type { CodingAgentRecord } from "./coding-agent-data";
import {
  recordsWithMetrics,
  xMetricValue,
  yMetricValue,
  type XMetric,
  type YMetric,
} from "./chart-math";

export type FrontierRecord = Readonly<{
  record: CodingAgentRecord;
  xValue: number;
  yValue: number;
}>;

export type ProviderPerformanceRange = Readonly<{
  count: number;
  maximum: number;
  median: number;
  minimum: number;
  providerId: string;
  providerName: string;
}>;

function compareFrontierRecords(left: FrontierRecord, right: FrontierRecord): number {
  return left.xValue - right.xValue
    || right.yValue - left.yValue
    || left.record.id.localeCompare(right.record.id);
}

/** Lower x and higher y are better; equal or dominated choices do not enter the frontier. */
export function computeParetoFrontier(
  records: readonly CodingAgentRecord[],
  xMetric: XMetric,
  yMetric: YMetric,
): FrontierRecord[] {
  const comparable = recordsWithMetrics(records, xMetric, yMetric).map((record) => {
    const xValue = xMetricValue(record, xMetric);
    const yValue = yMetricValue(record, yMetric);
    if (xValue === null || yValue === null) throw new Error("Comparable record lost a selected metric.");
    return { record, xValue, yValue };
  }).sort(compareFrontierRecords);

  const frontier: FrontierRecord[] = [];
  let bestPerformance = Number.NEGATIVE_INFINITY;
  for (const candidate of comparable) {
    if (candidate.yValue <= bestPerformance) continue;
    frontier.push(candidate);
    bestPerformance = candidate.yValue;
  }
  return frontier;
}

/** Lower x and higher y are better; preserves every exact nondominated tie. */
export function computeParetoSet(
  records: readonly CodingAgentRecord[],
  xMetric: XMetric,
  yMetric: YMetric,
): FrontierRecord[] {
  const comparable = recordsWithMetrics(records, xMetric, yMetric).map((record) => {
    const xValue = xMetricValue(record, xMetric);
    const yValue = yMetricValue(record, yMetric);
    if (xValue === null || yValue === null) throw new Error("Comparable record lost a selected metric.");
    return { record, xValue, yValue };
  }).sort(compareFrontierRecords);

  return comparable.filter(candidate => !comparable.some(other => (
    other.xValue <= candidate.xValue
    && other.yValue >= candidate.yValue
    && (other.xValue < candidate.xValue || other.yValue > candidate.yValue)
  )));
}

/** Keeps both ends and evenly spaced intermediate frontier steps in a compact ladder. */
export function sampleFrontierLadder(
  frontier: readonly FrontierRecord[],
  maximum = 8,
): FrontierRecord[] {
  const safeMaximum = Number.isFinite(maximum) ? Math.max(0, Math.floor(maximum)) : 0;
  if (safeMaximum === 0 || frontier.length === 0) return [];
  if (frontier.length <= safeMaximum) return [...frontier];
  if (safeMaximum === 1) {
    const last = frontier.at(-1);
    return last === undefined ? [] : [last];
  }

  const sampled: FrontierRecord[] = [];
  for (let index = 0; index < safeMaximum; index += 1) {
    const sourceIndex = Math.round((index * (frontier.length - 1)) / (safeMaximum - 1));
    const item = frontier[sourceIndex];
    if (item !== undefined && sampled.at(-1)?.record.id !== item.record.id) sampled.push(item);
  }
  return sampled;
}

export function providerPerformanceRanges(
  records: readonly CodingAgentRecord[],
  yMetric: YMetric,
): ProviderPerformanceRange[] {
  const grouped = new Map<string, { name: string; values: number[] }>();
  for (const record of records) {
    const value = yMetricValue(record, yMetric);
    if (value === null) continue;
    const group = grouped.get(record.providerId) ?? { name: record.providerName, values: [] };
    group.values.push(value);
    grouped.set(record.providerId, group);
  }

  const ranges: ProviderPerformanceRange[] = [];
  for (const [providerId, group] of grouped) {
    const values = group.values.toSorted((left, right) => left - right);
    const first = values[0];
    const last = values.at(-1);
    if (first === undefined || last === undefined) continue;
    const midpoint = Math.floor(values.length / 2);
    const median = values.length % 2 === 0
      ? ((values[midpoint - 1] ?? first) + (values[midpoint] ?? last)) / 2
      : values[midpoint] ?? first;
    ranges.push({
      count: values.length,
      maximum: last,
      median,
      minimum: first,
      providerId,
      providerName: group.name,
    });
  }

  return ranges.sort((left, right) => (
    right.maximum - left.maximum
    || right.median - left.median
    || left.providerName.localeCompare(right.providerName)
  ));
}
