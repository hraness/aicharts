import type { CodingAgentRecord } from "./coding-agent-data";

export type XMetric = "costUsd" | "durationMinutes" | "totalTokens";
export type YMetric = "aaIndex" | "deepSwe" | "terminalBench" | "sweAtlas";
export type NumericDomain = readonly [number, number];
export type NumericRange = readonly [number, number];

export const xMetricLabels: Record<XMetric, string> = {
  costUsd: "API cost per task",
  durationMinutes: "Active time per task",
  totalTokens: "Total tokens per task",
};

export const xMetricControlLabels: Record<XMetric, string> = {
  costUsd: "Cost",
  durationMinutes: "Time",
  totalTokens: "Tokens",
};

export const yMetricLabels: Record<YMetric, string> = {
  aaIndex: "AA Index",
  deepSwe: "DeepSWE",
  terminalBench: "Terminal-Bench v2",
  sweAtlas: "SWE-Atlas-QnA",
};

export const yMetricDescriptions: Record<YMetric, string> = {
  aaIndex: "Overall performance across code changes, terminal work, and repository understanding.",
  deepSwe: "Long-horizon software engineering tasks scored with automated code verification.",
  terminalBench: "Agentic terminal-use tasks scored with automated test-suite verification.",
  sweAtlas: "Repository-understanding questions scored with a strict resolve verifier.",
};

/** Half-width of the benchmark band used for horizontal peer comparison. */
export const performanceTierRadius = 3.75;

export function isInPerformanceTier(
  value: number,
  selectedValue: number,
  radius = performanceTierRadius,
): boolean {
  if (!Number.isFinite(radius) || radius < 0) throw new RangeError("Performance tier radius must be finite and non-negative.");
  if (!Number.isFinite(value) || !Number.isFinite(selectedValue)) return false;
  return Math.abs(value - selectedValue) <= radius;
}

export function xMetricValue(record: CodingAgentRecord, metric: XMetric): number | null {
  if (metric === "costUsd") return record.economics.costUsd;
  if (metric === "durationMinutes") {
    return record.economics.durationSeconds === null ? null : record.economics.durationSeconds / 60;
  }
  return record.usage.totalTokens;
}

export function yMetricValue(record: CodingAgentRecord, metric: YMetric): number | null {
  if (metric === "aaIndex") return record.benchmarks.aaIndex;
  if (metric === "deepSwe") return record.benchmarks.deepSwe;
  if (metric === "terminalBench") return record.benchmarks.terminalBench;
  return record.benchmarks.sweAtlas;
}

export function recordsWithMetrics(
  records: readonly CodingAgentRecord[],
  xMetric: XMetric,
  yMetric: YMetric,
): CodingAgentRecord[] {
  return records.filter((record) => xMetricValue(record, xMetric) !== null && yMetricValue(record, yMetric) !== null);
}

export function computeDomain(
  values: readonly number[],
  options: { includeZero?: boolean; minimum?: number; maximum?: number; paddingRatio?: number } = {},
): NumericDomain {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length === 0) return [0, 1];

  const includeZero = options.includeZero ?? false;
  const paddingRatio = options.paddingRatio ?? 0.08;
  let minimum = Math.min(...finiteValues);
  let maximum = Math.max(...finiteValues);

  if (includeZero) minimum = Math.min(0, minimum);
  if (minimum === maximum) {
    const offset = Math.max(Math.abs(minimum) * 0.1, 1);
    minimum -= includeZero && minimum >= 0 ? minimum : offset;
    maximum += offset;
  }

  const span = maximum - minimum;
  minimum -= includeZero && minimum === 0 ? 0 : span * paddingRatio;
  maximum += span * paddingRatio;

  if (options.minimum !== undefined) minimum = Math.max(options.minimum, minimum);
  if (options.maximum !== undefined) maximum = Math.min(options.maximum, maximum);
  if (minimum >= maximum) return [minimum, minimum + 1];
  return [minimum, maximum];
}

export function linearScale(domain: NumericDomain, range: NumericRange): (value: number) => number {
  const domainSpan = domain[1] - domain[0];
  const rangeSpan = range[1] - range[0];
  return (value) => range[0] + ((value - domain[0]) / domainSpan) * rangeSpan;
}

export function makeTicks(domain: NumericDomain, count = 6): number[] {
  const safeCount = Math.max(2, Math.floor(count));
  const step = (domain[1] - domain[0]) / (safeCount - 1);
  return Array.from({ length: safeCount }, (_, index) => domain[0] + step * index);
}

const niceStepFactors = [1, 2, 2.5, 5, 10] as const;

function ticksForStep(domain: NumericDomain, step: number): number[] | null {
  let startIndex = Math.floor(domain[0] / step);
  let endIndex = Math.ceil(domain[1] / step);

  while (startIndex * step > domain[0]) startIndex -= 1;
  while (endIndex * step < domain[1]) endIndex += 1;

  const count = endIndex - startIndex + 1;
  if (!Number.isSafeInteger(count) || count < 2 || count > 10_000) return null;

  const ticks: number[] = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const tick = index * step;
    if (!Number.isFinite(tick)) return null;
    const normalizedTick = Object.is(tick, -0) ? 0 : tick;
    const previous = ticks.at(-1);
    if (previous !== undefined && normalizedTick <= previous) return null;
    ticks.push(normalizedTick);
  }

  const first = ticks[0];
  const last = ticks.at(-1);
  if (first === undefined || last === undefined || first > domain[0] || last < domain[1]) return null;
  return ticks;
}

/** Round a finite ascending domain outward onto a readable decimal tick grid. */
export function makeNiceTicks(domain: NumericDomain, targetCount = 6): number[] {
  const [minimum, maximum] = domain;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
    throw new RangeError("Nice ticks require a finite ascending domain.");
  }

  const safeTarget = Number.isFinite(targetCount) ? Math.max(2, Math.floor(targetCount)) : 6;
  let workingMinimum = minimum;
  let workingMaximum = maximum;
  if (workingMinimum === workingMaximum) {
    const padding = workingMinimum === 0 ? 1 : Math.abs(workingMinimum) * 0.1;
    workingMinimum -= padding;
    workingMaximum += padding;
  }

  const span = workingMaximum - workingMinimum;
  const rawStep = span / (safeTarget - 1);
  if (!Number.isFinite(rawStep) || rawStep <= 0) return minimum === maximum ? [minimum] : [minimum, maximum];

  const baseExponent = Math.floor(Math.log10(rawStep));
  let best: { countDistance: number; stepDistance: number; ticks: number[] } | null = null;

  for (let exponentOffset = -2; exponentOffset <= 2; exponentOffset += 1) {
    const power = 10 ** (baseExponent + exponentOffset);
    if (!Number.isFinite(power) || power <= 0) continue;

    for (const factor of niceStepFactors) {
      const step = factor * power;
      if (!Number.isFinite(step) || step <= 0) continue;
      const ticks = ticksForStep([workingMinimum, workingMaximum], step);
      if (ticks === null) continue;

      const candidate = {
        countDistance: Math.abs(ticks.length - safeTarget),
        stepDistance: Math.abs(Math.log(step / rawStep)),
        ticks,
      };
      if (
        best === null
        || candidate.countDistance < best.countDistance
        || (candidate.countDistance === best.countDistance && candidate.stepDistance < best.stepDistance)
      ) {
        best = candidate;
      }
    }
  }

  return best?.ticks ?? (minimum === maximum ? [minimum] : [minimum, maximum]);
}

export function formatMetricValue(metric: XMetric | YMetric, value: number): string {
  if (metric === "costUsd") {
    const maximumFractionDigits = value < 10 ? 2 : value < 100 ? 1 : 0;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits }).format(value);
  }
  if (metric === "durationMinutes") return `${value.toFixed(value < 10 ? 1 : 0)}m`;
  if (metric === "totalTokens") {
    if (Math.abs(value) >= 1_000_000) {
      return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value / 1_000_000)}M`;
    }
    if (Math.abs(value) >= 1_000) {
      return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value / 1_000)}K`;
    }
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  }
  return value.toFixed(1);
}
