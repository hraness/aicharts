import {
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_SCORE_MAX,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_SCORE_MIN,
  type ArtificialAnalysisIntelligenceRecord,
} from "./artificial-analysis-intelligence-data";

export type IntelligenceEfficiencyMetric = "costUsdPerTask" | "outputTokensPerTask";

export type IntelligenceEfficiencyPoint = Readonly<{
  record: ArtificialAnalysisIntelligenceRecord;
  xValue: number;
  yValue: number;
}>;

export type FocusModelComparison = Readonly<{
  astra: ArtificialAnalysisIntelligenceRecord;
  costIncreasePercent: number;
  outputTokenReductionPercent: number;
  roundedIntelligenceScore: number | null;
  sol: ArtificialAnalysisIntelligenceRecord;
}>;

export type NumericDomain = readonly [minimum: number, maximum: number];

function isPositiveFinite(value: number | null | undefined): value is number {
  return value !== null
    && value !== undefined
    && Number.isFinite(value)
    && value > 0;
}

function isFiniteScore(value: number): boolean {
  return Number.isFinite(value)
    && value >= ARTIFICIAL_ANALYSIS_INTELLIGENCE_SCORE_MIN
    && value <= ARTIFICIAL_ANALYSIS_INTELLIGENCE_SCORE_MAX;
}

/**
 * Keep one shared, apples-to-apples cohort for both efficiency views. A row
 * participates only when its score, output-only token total, and task cost can
 * all be plotted on their respective positive log axes.
 */
export function comparableIntelligenceRecords(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
): readonly ArtificialAnalysisIntelligenceRecord[] {
  return records
    .filter(record => (
      isFiniteScore(record.intelligenceIndex)
      && isPositiveFinite(record.outputTokensPerTask.total)
      && isPositiveFinite(record.costUsdPerTask?.total)
    ))
    .toSorted((left, right) => (
      right.intelligenceIndex - left.intelligenceIndex
      || left.name.localeCompare(right.name)
      || left.id.localeCompare(right.id)
    ));
}

export function intelligenceEfficiencyMetricValue(
  record: ArtificialAnalysisIntelligenceRecord,
  metric: IntelligenceEfficiencyMetric,
): number | null {
  return metric === "outputTokensPerTask"
    ? record.outputTokensPerTask.total
    : record.costUsdPerTask?.total ?? null;
}

function validMetricPoints(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  metric: IntelligenceEfficiencyMetric,
): readonly IntelligenceEfficiencyPoint[] {
  return records.flatMap(record => {
    const xValue = intelligenceEfficiencyMetricValue(record, metric);
    return isFiniteScore(record.intelligenceIndex) && isPositiveFinite(xValue)
      ? [{ record, xValue, yValue: record.intelligenceIndex }]
      : [];
  });
}

/** Return every nondominated model, preserving exact ties as separate rows. */
export function paretoMembership(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  metric: IntelligenceEfficiencyMetric,
): ReadonlySet<string> {
  const points = validMetricPoints(records, metric);
  return new Set(points.filter(candidate => !points.some(other => (
    other.xValue <= candidate.xValue
    && other.yValue >= candidate.yValue
    && (other.xValue < candidate.xValue || other.yValue > candidate.yValue)
  ))).map(point => point.record.id));
}

/**
 * Produce the lower-x / higher-y Pareto path in deterministic drawing order.
 * Exact coordinate ties remain members, but collapse to one path vertex.
 */
export function orderedParetoPath(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  metric: IntelligenceEfficiencyMetric,
): readonly IntelligenceEfficiencyPoint[] {
  const membership = paretoMembership(records, metric);
  const ordered = validMetricPoints(records, metric)
    .filter(point => membership.has(point.record.id))
    .toSorted((left, right) => (
      left.xValue - right.xValue
      || right.yValue - left.yValue
      || left.record.id.localeCompare(right.record.id)
    ));
  const path: IntelligenceEfficiencyPoint[] = [];

  for (const point of ordered) {
    const previous = path.at(-1);
    if (previous !== undefined && point.xValue === previous.xValue && point.yValue === previous.yValue) {
      continue;
    }
    if (previous === undefined || point.yValue > previous.yValue) path.push(point);
  }

  return path;
}

function validatePositiveDomain(domain: NumericDomain): void {
  const [minimum, maximum] = domain;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum <= 0 || maximum <= minimum) {
    throw new RangeError("A log domain requires two increasing positive finite values.");
  }
}

/** A small logarithmic pad keeps the outer observations off the axes. */
export function paddedLogDomain(
  values: readonly number[],
  paddingRatio = 0.045,
): NumericDomain {
  if (!Number.isFinite(paddingRatio) || paddingRatio < 0) {
    throw new RangeError("Log-domain padding must be a nonnegative finite ratio.");
  }
  if (values.length === 0 || values.some(value => !isPositiveFinite(value))) {
    throw new RangeError("A log domain requires at least one positive finite value.");
  }

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) {
    const halfDecade = Math.sqrt(10);
    return [minimum / halfDecade, maximum * halfDecade];
  }

  const logMinimum = Math.log(minimum);
  const logMaximum = Math.log(maximum);
  const padding = (logMaximum - logMinimum) * paddingRatio;
  return [Math.exp(logMinimum - padding), Math.exp(logMaximum + padding)];
}

export function logScale(
  domain: NumericDomain,
  range: NumericDomain,
): (value: number) => number {
  validatePositiveDomain(domain);
  const [rangeMinimum, rangeMaximum] = range;
  if (!Number.isFinite(rangeMinimum) || !Number.isFinite(rangeMaximum) || rangeMaximum === rangeMinimum) {
    throw new RangeError("A log scale requires two distinct finite range values.");
  }
  const logMinimum = Math.log(domain[0]);
  const logSpan = Math.log(domain[1]) - logMinimum;

  return value => {
    if (!isPositiveFinite(value)) {
      throw new RangeError("A log scale can map positive finite values only.");
    }
    const position = (Math.log(value) - logMinimum) / logSpan;
    return rangeMinimum + position * (rangeMaximum - rangeMinimum);
  };
}

/** Generate a restrained 1/2/5 tick sequence and thin it deterministically. */
export function logTicks(
  domain: NumericDomain,
  maximumTickCount = 6,
): readonly number[] {
  validatePositiveDomain(domain);
  if (!Number.isInteger(maximumTickCount) || maximumTickCount < 2) {
    throw new RangeError("A log axis needs at least two ticks.");
  }

  const firstExponent = Math.floor(Math.log10(domain[0])) - 1;
  const lastExponent = Math.ceil(Math.log10(domain[1])) + 1;
  const candidates: number[] = [];
  for (let exponent = firstExponent; exponent <= lastExponent; exponent += 1) {
    for (const multiplier of [1, 2, 5]) {
      const value = multiplier * 10 ** exponent;
      if (value >= domain[0] && value <= domain[1]) candidates.push(value);
    }
  }

  if (candidates.length < 2) return [domain[0], domain[1]];
  if (candidates.length <= maximumTickCount) return candidates;

  const selected = new Set<number>();
  for (let index = 0; index < maximumTickCount; index += 1) {
    const candidateIndex = Math.round(index * (candidates.length - 1) / (maximumTickCount - 1));
    const candidate = candidates[candidateIndex];
    if (candidate !== undefined) selected.add(candidate);
  }
  return [...selected].toSorted((left, right) => left - right);
}

/** Keep zero visible and round the current maximum up to a quiet ten-point guide. */
export function intelligenceScoreDomain(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
): NumericDomain {
  const maximum = Math.max(ARTIFICIAL_ANALYSIS_INTELLIGENCE_SCORE_MIN, ...records
    .map(record => record.intelligenceIndex)
    .filter(isFiniteScore));
  return [0, Math.max(10, Math.ceil(maximum / 10) * 10)];
}

/** Compare the two named max-effort models only inside the comparable cohort. */
export function focusModelComparison(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
): FocusModelComparison | null {
  const cohort = comparableIntelligenceRecords(records);
  const astra = cohort.find(record => (
    record.slug === "gpt-6-astra" && record.effort?.slug === "max"
  ));
  const sol = cohort.find(record => (
    record.slug === "gpt-5-6-sol" && record.effort?.slug === "max"
  ));
  if (astra === undefined || sol === undefined) return null;
  if (astra.costUsdPerTask === null || sol.costUsdPerTask === null) return null;

  const astraRounded = Math.round(astra.intelligenceIndex);
  const solRounded = Math.round(sol.intelligenceIndex);
  return {
    astra,
    costIncreasePercent: (
      (astra.costUsdPerTask.total - sol.costUsdPerTask.total)
      / sol.costUsdPerTask.total
    ) * 100,
    outputTokenReductionPercent: (
      (sol.outputTokensPerTask.total - astra.outputTokensPerTask.total)
      / sol.outputTokensPerTask.total
    ) * 100,
    roundedIntelligenceScore: astraRounded === solRounded ? astraRounded : null,
    sol,
  };
}
