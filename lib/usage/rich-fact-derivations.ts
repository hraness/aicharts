/**
 * Pure derivations over admitted rich-facts-v1 reports for the local-profile
 * and existing-aggregate metric rows that have no explorer recipe yet.
 *
 * Every quantity is exact: token sums are BigInt, wall-clock lengths are
 * BigInt milliseconds, and ratios are unreduced-free ExactRatio values whose
 * numerator and denominator are both exposed. Nothing here rounds, estimates or
 * fills a missing timestamp; each derivation reports how many candidates it
 * could measure and how many it could not. The UI explorer (rich-metric-explorer.ts)
 * owns presentation and maps catalog rows onto these functions.
 */
import { err, ok, type Result } from "../result";
import { RICH_FACT_MAX_WINDOW_MS, type ExactRatio, type RichDistribution, type RichFact, type RichFactError, type RichFactReport, type RichOwner, type RichRequest, type RichSelection, type RichSpan, type RichTool, type RichTurn, type RichUsage } from "./rich-fact-contract";
import { parseRichFactReport } from "./rich-facts";

const MAX_TIME = 8_640_000_000_000_000;
const grains = ["usage_observation", "request", "response", "turn", "session"] as const;
const scopes = ["direct", "inclusive", "unknown"] as const;
const lineages = ["root", "child", "unknown", "all"] as const;
const isId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{32}$/u.test(value) && !/^0+$/u.test(value);
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0 && value <= MAX_TIME;
const bigMax = (a: bigint, b: bigint) => a > b ? a : b;
const compare = (a: bigint, b: bigint) => a < b ? -1 : a > b ? 1 : 0;

/** Head-resolved, non-retracted facts inside one selection, plus every retained owner for lineage evidence. */
export type RichCohort = Readonly<{
  report: RichFactReport; selection: RichSelection;
  /** Active heads: latest revision per identity, non-null value, inside the window, matching lineage and execution filters. */
  facts: readonly RichFact[];
  /** Non-retracted heads inside the window for every execution and lineage; lineage evidence for inclusive attribution. */
  windowed: readonly RichFact[];
  /** Every execution owner retained by the report, including executions outside the cohort. */
  owners: ReadonlyMap<string, RichOwner>;
  retracted: number;
}>;
/** A closed-open wall-clock interval in milliseconds, already clipped to the selection window. */
export type Interval = Readonly<{ executionId: string; startMs: bigint; endMs: bigint }>;
export type WallTime = Readonly<{ ms: bigint; measured: number; unmeasured: number }>;
export type Share = Readonly<{ ratio: ExactRatio | null; reason: "no_denominator" | "incomplete_lineage" | "inconsistent_inclusive" | "no_execution" | null }>;
export type SessionState = "completed" | "aborted" | "open" | "unclassified";
export type SessionLifecycle = Readonly<{
  sessions: number; completed: number; aborted: number; open: number; unclassified: number;
  openTurns: number; duration: RichDistribution;
}>;
export type TimeFamily = Readonly<{
  activeWallTime: WallTime; requestBusyTime: WallTime; inferenceWallTime: WallTime;
  humanReplyWaitTime: WallTime; approvalWaitTime: WallTime; toolWaitTime: WallTime;
  unclassifiedExposureTime: bigint; monitoredWallTimeMs: bigint;
  peakConcurrentExecutions: number; agentTimeMs: bigint;
  timeWeightedConcurrency: ExactRatio | null; activityUtilization: ExactRatio | null; agentTimeToWallTimeRatio: ExactRatio | null;
}>;
export type ContextFamily = Readonly<{
  occupancy: RichDistribution;
  /** One exact fraction per observation with an explicit limit; observations without a limit stay unmeasured. */
  limitFractions: readonly ExactRatio[]; unmeasuredLimits: number; maximumLimitFraction: ExactRatio | null;
}>;

function selection(input: unknown, report: RichFactReport): RichSelection {
  if (input === null || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) throw "invalid_rich_facts";
  const v = input as Record<string, unknown>, w = v.window as Record<string, unknown> | null | undefined;
  if (!w || typeof w !== "object" || !isTime(w.startMs) || !isTime(w.endMs) || w.endMs <= w.startMs || w.endMs - w.startMs > RICH_FACT_MAX_WINDOW_MS
    || w.startMs < report.window.startMs || w.endMs > report.window.endMs || !grains.includes(v.grain as never) || !scopes.includes(v.tokenScope as never)
    || !lineages.includes(v.lineage as never) || (v.executionId !== null && !isId(v.executionId))) throw "invalid_rich_facts";
  return { window: { startMs: w.startMs, endMs: w.endMs }, grain: v.grain as RichSelection["grain"], tokenScope: v.tokenScope as RichSelection["tokenScope"],
    lineage: v.lineage as RichSelection["lineage"], executionId: v.executionId as string | null };
}

/** Admit a report and resolve the selected cohort once; every derivation below is pure over the result. */
export function richCohort(reportInput: unknown, selectionInput: unknown): Result<RichCohort, RichFactError> {
  const parsed = parseRichFactReport(reportInput);
  if (!parsed.ok) return parsed;
  let selected: RichSelection;
  try { selected = selection(selectionInput, parsed.value); } catch { return err("invalid_rich_facts"); }
  const latest = new Map<string, RichFact>();
  for (const fact of parsed.value.facts) { const previous = latest.get(fact.id); if (!previous || fact.revision > previous.revision) latest.set(fact.id, fact); }
  const heads = [...latest.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const owners = new Map<string, RichOwner>(heads.map(fact => [fact.owner.executionId, fact.owner]));
  const windowed = heads.filter(fact => fact.atMs >= selected.window.startMs && fact.atMs < selected.window.endMs);
  const inWindow = windowed.filter(fact => selected.executionId === null || fact.owner.executionId === selected.executionId);
  const facts = inWindow.filter(fact => fact.value !== null && (selected.lineage === "all" || fact.owner.lineage === selected.lineage));
  return ok({ report: parsed.value, selection: selected, facts, windowed: windowed.filter(fact => fact.value !== null), owners, retracted: inWindow.filter(fact => fact.value === null).length });
}

const values = <K extends RichFact["kind"]>(cohort: RichCohort, kind: K) =>
  cohort.facts.map(fact => fact.value).filter((v): v is Extract<NonNullable<RichFact["value"]>, { kind: K }> => v !== null && v.kind === kind);
const usages = (cohort: RichCohort, scope: RichSelection["tokenScope"] = cohort.selection.tokenScope): RichUsage[] =>
  values(cohort, "usage").filter(v => v.grain === cohort.selection.grain && v.tokenScope === scope);
const inputTokens = (u: RichUsage) => BigInt(u.tokens.inputUncached) + BigInt(u.tokens.cacheRead) + BigInt(u.tokens.cacheWrite5m) + BigInt(u.tokens.cacheWrite1h) + BigInt(u.tokens.cacheWriteUnknown);
const totalTokens = (u: RichUsage) => inputTokens(u) + BigInt(u.tokens.output);

/** Exact nearest-rank order statistics, identical to the summary's distribution rule. */
export function exactDistribution(input: readonly (bigint | null)[]): RichDistribution {
  const measured = input.filter((v): v is bigint => v !== null).sort(compare), sum = measured.reduce((a, b) => a + b, 0n);
  const percentile = (n: number) => measured[Math.ceil(measured.length * n / 100) - 1] ?? null;
  return { measured: measured.length, unmeasured: input.length - measured.length, sum, observedMean: measured.length === 0 ? null : { numerator: sum, denominator: BigInt(measured.length) },
    minimum: measured[0] ?? null, median: percentile(50), p90: percentile(90), p95: percentile(95), p99: percentile(99), maximum: measured.at(-1) ?? null };
}
/** A ratio is only formed over a positive denominator; zero denominators are reported as null, never as zero. */
export const exactRatio = (numerator: bigint, denominator: bigint): ExactRatio | null => denominator > 0n ? { numerator, denominator } : null;
/** Exact cross-multiplied comparison for callers that must order ratios without floating point. */
export const compareRatios = (a: ExactRatio, b: ExactRatio) => compare(a.numerator * b.denominator, b.numerator * a.denominator);

// ---- cache-write TTL classes: cache-write-{5m,1h,unknown}-tokens, cache-write-volume-{5m,1h,unknown} ----

export type CacheWriteClasses = Readonly<{ write5m: bigint; write1h: bigint; unknown: bigint; measured: number }>;
/** Sums over the selected grain and token scope; the three classes partition cache-write tokens exactly. */
export function cacheWriteClasses(cohort: RichCohort): CacheWriteClasses {
  const rows = usages(cohort);
  const total = (field: "cacheWrite5m" | "cacheWrite1h" | "cacheWriteUnknown") => rows.reduce((sum, u) => sum + BigInt(u.tokens[field]), 0n);
  return { write5m: total("cacheWrite5m"), write1h: total("cacheWrite1h"), unknown: total("cacheWriteUnknown"), measured: rows.length };
}

// ---- attribution: direct-execution-tokens, inclusive-descendant-execution-tokens, direct/root/descendant-token-share ----

/** Direct-scope tokens owned by exactly the selected execution at the selected grain. */
export function directExecutionTokens(cohort: RichCohort): Readonly<{ tokens: bigint | null; measured: number; reason: "no_execution" | null }> {
  if (cohort.selection.executionId === null) return { tokens: null, measured: 0, reason: "no_execution" };
  const rows = usages(cohort, "direct");
  return { tokens: rows.reduce((sum, u) => sum + totalTokens(u), 0n), measured: rows.length, reason: null };
}
function descendants(cohort: RichCohort, executionId: string): { ids: Set<string>; complete: boolean } {
  const ids = new Set<string>(); let complete = true;
  for (const owner of cohort.owners.values()) {
    if (owner.executionId === executionId) continue;
    if (owner.lineage === "unknown") { complete = false; continue; }
    const path = [owner.executionId]; let current: RichOwner | undefined = owner;
    while (current !== undefined && path.length <= 65) {
      if (current.lineage === "unknown") { complete = false; break; }
      if (current.parentExecutionId === null) break;
      if (current.parentExecutionId === executionId) { for (const id of path) ids.add(id); break; }
      const parent: RichOwner | undefined = cohort.owners.get(current.parentExecutionId);
      // A parent named but not retained leaves the chain unresolved; an incomplete tree is reported, never guessed.
      if (parent === undefined) { complete = false; break; }
      path.push(parent.executionId); current = parent;
    }
  }
  return { ids, complete };
}
/**
 * Inclusive tokens of the selected execution: its direct tokens plus the direct
 * tokens of every transitive descendant in the report. An explicit inclusive
 * fact for the execution is honoured when present and must agree with the
 * computed value whenever both exist; unknown-lineage owners make the tree
 * incomplete and yield an explicit null.
 */
export function inclusiveDescendantExecutionTokens(cohort: RichCohort): Readonly<{ tokens: bigint | null; reason: Share["reason"] }> {
  const id = cohort.selection.executionId;
  if (id === null) return { tokens: null, reason: "no_execution" };
  const grain = cohort.selection.grain;
  const scoped = (facts: readonly RichFact[], executionId: string, scope: RichUsage["tokenScope"]) => facts.filter(fact => fact.owner.executionId === executionId).map(fact => fact.value)
    .filter((v): v is RichUsage => v !== null && v.kind === "usage" && v.grain === grain && v.tokenScope === scope);
  const explicit = scoped(cohort.facts, id, "inclusive"), explicitSum = explicit.length === 0 ? null : explicit.reduce((sum, u) => sum + totalTokens(u), 0n);
  const tree = descendants(cohort, id);
  if (!tree.complete) return explicitSum === null ? { tokens: null, reason: "incomplete_lineage" } : { tokens: explicitSum, reason: null };
  const computed = [...tree.ids].reduce((sum, executionId) => sum + scoped(cohort.windowed, executionId, "direct").reduce((s, u) => s + totalTokens(u), 0n),
    scoped(cohort.facts, id, "direct").reduce((s, u) => s + totalTokens(u), 0n));
  if (explicitSum !== null && explicitSum !== computed) return { tokens: null, reason: "inconsistent_inclusive" };
  return { tokens: computed, reason: null };
}
/** direct-token-share: the selected execution's own direct tokens over its inclusive tokens. */
export function directTokenShare(cohort: RichCohort): Share {
  const direct = directExecutionTokens(cohort), inclusive = inclusiveDescendantExecutionTokens(cohort);
  if (direct.reason !== null) return { ratio: null, reason: direct.reason };
  if (inclusive.tokens === null) return { ratio: null, reason: inclusive.reason };
  const ratio = exactRatio(direct.tokens!, inclusive.tokens);
  return ratio === null ? { ratio: null, reason: "no_denominator" } : { ratio, reason: null };
}
/** root-token-share and descendant-token-share partition the direct tokens of known-lineage executions; unknown lineage is excluded and reported. */
export function lineageTokenShares(cohort: RichCohort): Readonly<{ root: Share; descendant: Share; excludedUnknownLineage: number }> {
  const rows = cohort.facts.filter(fact => fact.value?.kind === "usage" && fact.value.grain === cohort.selection.grain && fact.value.tokenScope === "direct");
  const sum = (lineage: RichOwner["lineage"]) => rows.filter(fact => fact.owner.lineage === lineage).reduce((s, fact) => s + totalTokens(fact.value as RichUsage), 0n);
  const root = sum("root"), child = sum("child"), denominator = root + child;
  const share = (numerator: bigint): Share => { const ratio = exactRatio(numerator, denominator); return ratio === null ? { ratio: null, reason: "no_denominator" } : { ratio, reason: null }; };
  return { root: share(root), descendant: share(child), excludedUnknownLineage: rows.filter(fact => fact.owner.lineage === "unknown").length };
}

// ---- sessions: distinct-sessions, observed-session-{count,duration}, {completed,aborted,open}-session-count, open-turn-count ----

/** A session is the conversation when the owner names one, otherwise the topmost retained ancestor execution. */
export function sessionKey(cohort: RichCohort, owner: RichOwner): string {
  if (owner.conversationId !== null) return owner.conversationId;
  let current = owner; const seen = new Set<string>();
  while (current.parentExecutionId !== null && !seen.has(current.executionId) && seen.size <= 64) {
    seen.add(current.executionId);
    const parent = cohort.owners.get(current.parentExecutionId);
    if (parent === undefined) return current.parentExecutionId;
    current = parent;
  }
  return current.executionId;
}
/** distinct-sessions: sessions with at least one active fact of any kind in the cohort. */
export function distinctSessions(cohort: RichCohort): number { return new Set(cohort.facts.map(fact => sessionKey(cohort, fact.owner))).size; }
const isOpen = (v: RichRequest | RichTool) => v.stage !== "terminal";
/**
 * Lifecycle from terminal turns and non-terminal request/tool stages only.
 * Open work is any request or tool whose latest head is still requested or
 * dispatched. A session with no turn and no open work is unclassified, never
 * counted as completed.
 */
export function sessionLifecycle(cohort: RichCohort): SessionLifecycle {
  const turns = new Map<string, RichTurn[]>(), open = new Map<string, number>();
  for (const fact of cohort.facts) {
    const key = sessionKey(cohort, fact.owner), v = fact.value!;
    if (v.kind === "turn") turns.set(key, [...turns.get(key) ?? [], v]);
    else if ((v.kind === "request" || v.kind === "tool") && isOpen(v)) open.set(key, (open.get(key) ?? 0) + 1);
    else if (!turns.has(key)) turns.set(key, turns.get(key) ?? []);
  }
  const states = new Map<string, SessionState>(), durations: (bigint | null)[] = [];
  for (const key of new Set([...turns.keys(), ...open.keys()])) {
    const rows = turns.get(key) ?? [];
    let state: SessionState;
    if ((open.get(key) ?? 0) > 0) state = "open";
    else if (rows.length === 0) state = "unclassified";
    else state = rows.reduce((last, v) => v.endedAtMs >= last.endedAtMs ? v : last).outcome;
    states.set(key, state);
    if (rows.length === 0) continue;
    const exact = rows.every(v => v.startedAtMs !== null && v.clockUncertaintyMs === 0);
    durations.push(exact ? BigInt(Math.max(...rows.map(v => v.endedAtMs)) - Math.min(...rows.map(v => v.startedAtMs!))) : null);
  }
  const count = (state: SessionState) => [...states.values()].filter(value => value === state).length;
  return { sessions: states.size, completed: count("completed"), aborted: count("aborted"), open: count("open"), unclassified: count("unclassified"),
    openTurns: [...open.values()].reduce((a, b) => a + b, 0), duration: exactDistribution(durations) };
}

// ---- wall time family ----

const clip = (cohort: RichCohort, executionId: string, startMs: number | null, endMs: number | null, uncertainty: number | null): Interval | null => {
  if (startMs === null || endMs === null || uncertainty !== 0 || endMs < startMs) return null;
  const start = BigInt(Math.max(startMs, cohort.selection.window.startMs)), end = BigInt(Math.min(endMs, cohort.selection.window.endMs));
  return end > start ? { executionId, startMs: start, endMs: end } : { executionId, startMs: start, endMs: start };
};
/** Exact length of the union of intervals; overlapping intervals are counted once. */
export function unionLengthMs(intervals: readonly Interval[]): bigint {
  const sorted = intervals.filter(i => i.endMs > i.startMs).sort((a, b) => compare(a.startMs, b.startMs));
  let total = 0n, cursor: bigint | null = null, edge = 0n;
  for (const i of sorted) {
    if (cursor === null || i.startMs > edge) { if (cursor !== null) total += edge - cursor; cursor = i.startMs; edge = i.endMs; }
    else edge = bigMax(edge, i.endMs);
  }
  return cursor === null ? total : total + edge - cursor;
}
/** Maximum number of distinct executions active at one instant. */
export function peakConcurrency(intervals: readonly Interval[]): number {
  const byExecution = new Map<string, Interval[]>();
  for (const i of intervals) if (i.endMs > i.startMs) byExecution.set(i.executionId, [...byExecution.get(i.executionId) ?? [], i]);
  const events: { at: bigint; delta: number }[] = [];
  for (const rows of byExecution.values()) {
    const merged = rows.sort((a, b) => compare(a.startMs, b.startMs));
    let start = merged[0]!.startMs, end = merged[0]!.endMs;
    for (const i of merged.slice(1)) { if (i.startMs > end) { events.push({ at: start, delta: 1 }, { at: end, delta: -1 }); start = i.startMs; end = i.endMs; } else end = bigMax(end, i.endMs); }
    events.push({ at: start, delta: 1 }, { at: end, delta: -1 });
  }
  events.sort((a, b) => compare(a.at, b.at) || a.delta - b.delta);
  let peak = 0, current = 0;
  for (const event of events) { current += event.delta; peak = Math.max(peak, current); }
  return peak;
}
function wall(cohort: RichCohort, candidates: readonly (Interval | null)[]): WallTime {
  const measured = candidates.filter((i): i is Interval => i !== null);
  return { ms: unionLengthMs(measured), measured: measured.length, unmeasured: candidates.length - measured.length };
}
function requestIntervals(cohort: RichCohort): (Interval | null)[] {
  return cohort.facts.filter(fact => fact.value?.kind === "request" && (fact.value as RichRequest).stage === "terminal").map(fact => {
    const v = fact.value as RichRequest;
    return clip(cohort, fact.owner.executionId, v.dispatchedAtMs ?? v.requestedAtMs, v.terminalAtMs, v.clockUncertaintyMs);
  });
}
function spanIntervals(cohort: RichCohort, phase: RichSpan["phase"]): (Interval | null)[] {
  return cohort.facts.filter(fact => fact.value?.kind === "span" && (fact.value as RichSpan).phase === phase)
    .map(fact => { const v = fact.value as RichSpan; return clip(cohort, fact.owner.executionId, v.startMs, v.endMs, v.clockUncertaintyMs); });
}
function turnIntervals(cohort: RichCohort): (Interval | null)[] {
  return values(cohort, "turn").length === 0 ? [] : cohort.facts.filter(fact => fact.value?.kind === "turn")
    .map(fact => { const v = fact.value as RichTurn; return clip(cohort, fact.owner.executionId, v.startedAtMs, v.endedAtMs, v.clockUncertaintyMs); });
}
/** All exact request, span and turn intervals in the cohort; the basis of every wall-time row. */
export function activeIntervals(cohort: RichCohort): (Interval | null)[] {
  return [...requestIntervals(cohort), ...(["inference", "reply_wait", "approval_wait", "tool_wait", "model_request"] as const).flatMap(phase => spanIntervals(cohort, phase)), ...turnIntervals(cohort)];
}
/**
 * active-wall-time, request-busy-time, inference-wall-time, human-reply-wait-time,
 * approval-wait-time, tool-wait-time, unclassified-exposure-time,
 * peak-concurrent-executions, agent-time, time-weighted-concurrency,
 * activity-utilization and agent-time-to-wall-time-ratio.
 *
 * Monitored wall time is the selection window. Unclassified exposure is
 * active wall time not covered by any phase-classified span. Agent time sums
 * each execution's own active union, so simultaneous executions accumulate.
 */
export function timeFamily(cohort: RichCohort): TimeFamily {
  const all = activeIntervals(cohort), active = wall(cohort, all), measured = all.filter((i): i is Interval => i !== null);
  const classified = (["inference", "reply_wait", "approval_wait", "tool_wait", "model_request"] as const).flatMap(phase => spanIntervals(cohort, phase)).filter((i): i is Interval => i !== null);
  const byExecution = new Map<string, Interval[]>();
  for (const i of measured) byExecution.set(i.executionId, [...byExecution.get(i.executionId) ?? [], i]);
  const agentTimeMs = [...byExecution.values()].reduce((sum, rows) => sum + unionLengthMs(rows), 0n);
  const monitoredWallTimeMs = BigInt(cohort.selection.window.endMs - cohort.selection.window.startMs);
  return { activeWallTime: active, requestBusyTime: wall(cohort, requestIntervals(cohort)), inferenceWallTime: wall(cohort, spanIntervals(cohort, "inference")),
    humanReplyWaitTime: wall(cohort, spanIntervals(cohort, "reply_wait")), approvalWaitTime: wall(cohort, spanIntervals(cohort, "approval_wait")), toolWaitTime: wall(cohort, spanIntervals(cohort, "tool_wait")),
    unclassifiedExposureTime: active.ms - unionLengthMs(classified),
    monitoredWallTimeMs, peakConcurrentExecutions: peakConcurrency(measured), agentTimeMs,
    timeWeightedConcurrency: exactRatio(agentTimeMs, monitoredWallTimeMs), activityUtilization: exactRatio(active.ms, monitoredWallTimeMs), agentTimeToWallTimeRatio: exactRatio(agentTimeMs, active.ms) };
}

// ---- provider-runtime ----

/** Sum of explicitly reported turn runtimes with exact clocks; turns without a start or with uncertain clocks stay unmeasured. */
export function providerRuntime(cohort: RichCohort): WallTime {
  const rows = values(cohort, "turn").map(v => v.startedAtMs !== null && v.clockUncertaintyMs === 0 && v.endedAtMs >= v.startedAtMs ? BigInt(v.endedAtMs - v.startedAtMs) : null);
  const measured = rows.filter((v): v is bigint => v !== null);
  return { ms: measured.reduce((a, b) => a + b, 0n), measured: measured.length, unmeasured: rows.length - measured.length };
}

// ---- context: context-occupancy, context-limit-fraction ----

/** Occupancy per recorded context observation; limit fractions only where the source recorded an explicit limit. */
export function contextFamily(cohort: RichCohort): ContextFamily {
  const rows = values(cohort, "context");
  const limitFractions = rows.flatMap(v => { const ratio = v.limitTokens === null ? null : exactRatio(BigInt(v.tokens), BigInt(v.limitTokens)); return ratio === null ? [] : [ratio]; });
  return { occupancy: exactDistribution(rows.map(v => BigInt(v.tokens))), limitFractions, unmeasuredLimits: rows.length - limitFractions.length,
    maximumLimitFraction: limitFractions.reduce<ExactRatio | null>((best, ratio) => best === null || compareRatios(ratio, best) > 0 ? ratio : best, null) };
}

// ---- turns: accumulated-turn-input, normalized-per-turn-comparison ----

/** Input tokens (uncached, cache read and every cache-write class) summed over measured turn-grain usage in the selected scope. */
export function accumulatedTurnInput(cohort: RichCohort): Readonly<{ tokens: bigint; measuredTurns: number }> {
  const rows = values(cohort, "usage").filter(v => v.grain === "turn" && v.tokenScope === cohort.selection.tokenScope);
  return { tokens: rows.reduce((sum, u) => sum + inputTokens(u), 0n), measuredTurns: rows.length };
}
/** Measured turns: terminal turn facts in the cohort. Zero turns give null rather than a division by zero. */
export function measuredTurnCount(cohort: RichCohort): number { return values(cohort, "turn").length; }
/** normalized-per-turn-comparison: any exact quantity over the cohort's measured turns. */
export function perMeasuredTurn(cohort: RichCohort, quantity: bigint): ExactRatio | null { return exactRatio(quantity, BigInt(measuredTurnCount(cohort))); }
