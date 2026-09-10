import { err, ok, type Result } from "../result";
import {
  compareIds, DAY_MS, totalTokens, validatePolicy, validateUsageBatch,
  type Batch, type Id, type IntervalKind, type Policy, type Prompt, type Usage, type WireError,
} from "./wire";

export const ACTIVITY_WINDOW_MS = 900_000;
export const CONCURRENCY_WINDOW_MS = 960_000;
const MAX_ROLLUP_RECORDS = 65_536;
export type Span = Readonly<{ startMs: number; endMs: number }>;
export type CoverageKind = "tokens" | "prompts" | "agent_work" | "api_request";
/**
 * Caller-attested completeness for the entire selected provider/account scope, not event presence.
 * Midnight coverage requires checking adjacent-day uncertainty; this one-day API cannot infer it.
 */
export type Coverage = Span & Readonly<{ kind: CoverageKind }>;
export type ExactRate = Readonly<{ numerator: bigint; denominatorSeconds: number }>;
export type WindowRollup = Span & Readonly<{
  observedAccountedTokens: bigint; accountedTokens: bigint | null;
  observedOutputTokens: bigint; outputTokens: bigint | null;
  observedAccountedTokensPerSecond: ExactRate; accountedTokensPerSecond: ExactRate | null;
  observedOutputTokensPerSecond: ExactRate; outputTokensPerSecond: ExactRate | null;
  confirmedHumanPrompts: number; unknownOriginPrompts: number; automationPrompts: number;
  humanPrompts: number | null;
  observedActivityMs: number; activityMs: number | null; activityFraction: number | null;
  observedPeakAgents: number; peakAgents: number | null;
  observedPeakApiRequests: number; peakApiRequests: number | null;
  coverageMs: Readonly<Record<CoverageKind, number>>;
}>;
export type DayRollup = Readonly<{
  utcDay: number;
  day: WindowRollup;
  activity15Minutes: readonly WindowRollup[];
  concurrency16Minutes: readonly WindowRollup[];
  hours: readonly WindowRollup[];
}>;
export type RollupError = WireError | "invalid_rollup_input" | "invalid_coverage" | "conflicting_occurrence" | "conflicting_execution";

const idKey = (value: Id): string => Array.from(value, byte => byte.toString(16).padStart(2, "0")).join("");
const sameId = (left: Id, right: Id): boolean => compareIds(left, right) === 0;
const sameTokens = (left: Usage["tokens"], right: Usage["tokens"]): boolean =>
  left.inputUncached === right.inputUncached && left.cacheRead === right.cacheRead
  && left.cacheWrite5m === right.cacheWrite5m && left.cacheWrite1h === right.cacheWrite1h
  && left.output === right.output && left.reasoningOutput === right.reasoningOutput;
const sameUsage = (left: Usage, right: Usage): boolean =>
  sameId(left.executionId, right.executionId) && sameId(left.accountId, right.accountId)
  && left.offsetMs === right.offsetMs && left.provider === right.provider && left.authMode === right.authMode
  && left.evidence === right.evidence && left.modelId === right.modelId && left.contextTier === right.contextTier
  && sameTokens(left.tokens, right.tokens);
const samePrompt = (left: Prompt, right: Prompt): boolean =>
  sameId(left.executionId, right.executionId) && sameId(left.accountId, right.accountId)
  && left.offsetMs === right.offsetMs && left.provider === right.provider
  && left.origin === right.origin && left.evidence === right.evidence;

function validSpan(span: Span): boolean {
  return Number.isInteger(span.startMs) && Number.isInteger(span.endMs)
    && span.startMs >= 0 && span.startMs < span.endMs && span.endMs <= DAY_MS;
}

/** Input must already be validated. Touching half-open spans have the same union as one span. */
function unionSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const merged: { startMs: number; endMs: number }[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.startMs <= last.endMs) last.endMs = Math.max(last.endMs, span.endMs);
    else merged.push({ startMs: span.startMs, endMs: span.endMs });
  }
  return merged;
}

const overlapMs = (left: Span, right: Span): number => Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
const coveredMs = (spans: readonly Span[], window: Span): number => spans.reduce((sum, span) => sum + overlapMs(span, window), 0);

type ExecutionSeries = Readonly<{ spans: readonly Span[]; uncertain: readonly Span[]; kind: IntervalKind }>;
type CountSpan = Span & Readonly<{ count: number }>;
type IndexedSeries = Readonly<{
  usage: readonly Usage[]; prompts: readonly Prompt[]; executions: readonly ExecutionSeries[];
  workActivity: readonly Span[]; agentCounts: readonly CountSpan[]; requestCounts: readonly CountSpan[];
  coverage: Readonly<Record<CoverageKind, readonly Span[]>>;
}>;

function concurrency(series: readonly ExecutionSeries[], kind: IntervalKind): CountSpan[] {
  const events: { at: number; delta: number }[] = [];
  for (const execution of series) {
    if (execution.kind !== kind) continue;
    for (const span of execution.spans) {
      events.push({ at: span.startMs, delta: 1 }, { at: span.endMs, delta: -1 });
    }
  }
  // End-before-start preserves half-open semantics at window and execution boundaries.
  events.sort((left, right) => left.at - right.at || left.delta - right.delta);
  let active = 0, previousMs = 0;
  const spans: CountSpan[] = [];
  for (const event of events) {
    if (previousMs < event.at && active > 0) spans.push({ startMs: previousMs, endMs: event.at, count: active });
    active += event.delta;
    previousMs = event.at;
  }
  return spans;
}

const peak = (spans: readonly CountSpan[], window: Span): number => spans.reduce((maximum, span) =>
  overlapMs(span, window) > 0 ? Math.max(maximum, span.count) : maximum, 0);

function windowRollup(window: Span, index: IndexedSeries): WindowRollup {
  const durationMs = window.endMs - window.startMs;
  const coverageMs = {
    tokens: coveredMs(index.coverage.tokens, window), prompts: coveredMs(index.coverage.prompts, window),
    agent_work: coveredMs(index.coverage.agent_work, window), api_request: coveredMs(index.coverage.api_request, window),
  };
  let observedAccountedTokens = 0n, observedOutputTokens = 0n;
  for (const usage of index.usage) {
    if (usage.offsetMs < window.startMs || usage.offsetMs >= window.endMs) continue;
    const total = totalTokens(usage.tokens);
    if (total.ok) observedAccountedTokens += total.value;
    observedOutputTokens += usage.tokens.output;
  }
  let confirmedHumanPrompts = 0, unknownOriginPrompts = 0, automationPrompts = 0;
  for (const prompt of index.prompts) {
    if (prompt.offsetMs < window.startMs || prompt.offsetMs >= window.endMs) continue;
    if (prompt.origin === 1) confirmedHumanPrompts += 1;
    else if (prompt.origin === 2) automationPrompts += 1;
    else unknownOriginPrompts += 1;
  }
  const observedActivityMs = coveredMs(index.workActivity, window);
  const uncertain = (kind: IntervalKind): boolean => index.executions.some(execution =>
    execution.kind === kind && execution.uncertain.some(span => overlapMs(span, window) > 0));
  const exactWork = coverageMs.agent_work === durationMs && !uncertain(1);
  const exactRequests = coverageMs.api_request === durationMs && !uncertain(2);
  const observedPeakAgents = peak(index.agentCounts, window), observedPeakApiRequests = peak(index.requestCounts, window);
  const rate = (numerator: bigint): ExactRate => ({ numerator, denominatorSeconds: durationMs / 1_000 });
  return {
    ...window, observedAccountedTokens, accountedTokens: coverageMs.tokens === durationMs ? observedAccountedTokens : null,
    observedOutputTokens, outputTokens: coverageMs.tokens === durationMs ? observedOutputTokens : null,
    observedAccountedTokensPerSecond: rate(observedAccountedTokens),
    accountedTokensPerSecond: coverageMs.tokens === durationMs ? rate(observedAccountedTokens) : null,
    observedOutputTokensPerSecond: rate(observedOutputTokens),
    outputTokensPerSecond: coverageMs.tokens === durationMs ? rate(observedOutputTokens) : null,
    confirmedHumanPrompts, unknownOriginPrompts, automationPrompts,
    humanPrompts: coverageMs.prompts === durationMs && unknownOriginPrompts === 0 ? confirmedHumanPrompts : null,
    observedActivityMs, activityMs: exactWork ? observedActivityMs : null,
    activityFraction: exactWork ? observedActivityMs / durationMs : null,
    observedPeakAgents, peakAgents: exactWork ? observedPeakAgents : null,
    observedPeakApiRequests, peakApiRequests: exactRequests ? observedPeakApiRequests : null,
    coverageMs,
  };
}

/** Pure, bounded rollup. It neither establishes coverage nor authenticates counters. */
export function rollupUsageDay(batches: readonly Batch[], policy: Policy, coverage: readonly Coverage[] = []): Result<DayRollup, RollupError> {
  if (!validatePolicy(policy)) return err("invalid_policy");
  if (!Array.isArray(batches) || batches.length === 0 || batches.length > MAX_ROLLUP_RECORDS) return err("invalid_rollup_input");
  if (!Array.isArray(coverage) || coverage.length > MAX_ROLLUP_RECORDS) return err("invalid_coverage");
  const coverageKinds = ["tokens", "prompts", "agent_work", "api_request"] as const;
  for (const span of coverage) {
    if (typeof span !== "object" || span === null || !validSpan(span) || !coverageKinds.includes(span.kind)) return err("invalid_coverage");
  }
  const usageById = new Map<string, Usage>(), promptsById = new Map<string, Prompt>();
  const executionIdentity = new Map<string, { accountId: Id; provider: number }>();
  const executions = new Map<string, { accountId: Id; provider: number; kind: IntervalKind; spans: Span[]; uncertain: Span[] }>();
  let utcDay: number | null = null, count = 0;
  for (const candidate of batches) {
    const checked = validateUsageBatch(candidate, policy);
    if (!checked.ok) return checked;
    const batch = checked.value;
    if (utcDay !== null && utcDay !== batch.utcDay) return err("invalid_day");
    utcDay = batch.utcDay;
    count += batch.usage.length + batch.prompts.length + batch.intervals.length;
    if (count > MAX_ROLLUP_RECORDS) return err("invalid_rollup_input");
    for (const usage of batch.usage) {
      const key = idKey(usage.id), previous = usageById.get(key);
      if (previous && !sameUsage(previous, usage)) return err("conflicting_occurrence");
      usageById.set(key, usage);
    }
    for (const prompt of batch.prompts) {
      const key = idKey(prompt.id), previous = promptsById.get(key);
      if (previous && !samePrompt(previous, prompt)) return err("conflicting_occurrence");
      promptsById.set(key, prompt);
    }
    for (const interval of batch.intervals) {
      const identityKey = idKey(interval.executionId), identity = executionIdentity.get(identityKey);
      if (identity && (!sameId(identity.accountId, interval.accountId) || identity.provider !== interval.provider)) return err("conflicting_execution");
      executionIdentity.set(identityKey, { accountId: interval.accountId, provider: interval.provider });
      const key = `${identityKey}:${interval.kind}`;
      let execution = executions.get(key);
      if (execution && (!sameId(execution.accountId, interval.accountId) || execution.provider !== interval.provider)) return err("conflicting_execution");
      if (!execution) {
        execution = { accountId: interval.accountId, provider: interval.provider, kind: interval.kind, spans: [], uncertain: [] };
        executions.set(key, execution);
      }
      execution.spans.push(interval);
      if (interval.clockUncertaintyMs > 0 || interval.evidence === 1) execution.uncertain.push({
        startMs: Math.max(0, interval.startMs - interval.clockUncertaintyMs),
        endMs: Math.min(DAY_MS, interval.endMs + interval.clockUncertaintyMs),
      });
    }
  }
  const executionSeries = [...executions.values()].map(execution => ({
    kind: execution.kind, spans: unionSpans(execution.spans), uncertain: unionSpans(execution.uncertain),
  }));
  const index: IndexedSeries = {
    usage: [...usageById.values()], prompts: [...promptsById.values()], executions: executionSeries,
    workActivity: unionSpans(executionSeries.filter(execution => execution.kind === 1).flatMap(execution => execution.spans)),
    agentCounts: concurrency(executionSeries, 1), requestCounts: concurrency(executionSeries, 2),
    coverage: {
      tokens: unionSpans(coverage.filter(span => span.kind === "tokens")),
      prompts: unionSpans(coverage.filter(span => span.kind === "prompts")),
      agent_work: unionSpans(coverage.filter(span => span.kind === "agent_work")),
      api_request: unionSpans(coverage.filter(span => span.kind === "api_request")),
    },
  };
  const windows = (sizeMs: number): WindowRollup[] => Array.from({ length: Math.ceil(DAY_MS / sizeMs) }, (_, indexOfWindow) =>
    windowRollup({ startMs: indexOfWindow * sizeMs, endMs: Math.min((indexOfWindow + 1) * sizeMs, DAY_MS) }, index));
  return ok({
    utcDay: utcDay!, day: windowRollup({ startMs: 0, endMs: DAY_MS }, index),
    activity15Minutes: windows(ACTIVITY_WINDOW_MS), concurrency16Minutes: windows(CONCURRENCY_WINDOW_MS), hours: windows(3_600_000),
  });
}
