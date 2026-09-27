import { expect, test } from "bun:test";
import { assertProperty, fc } from "../property-test";
import type { RichFact, RichOwner, RichPayload, RichRequest, RichSpan, RichTool, RichTurn } from "./rich-fact-contract";
import { accumulatedTurnInput, activeIntervals, cacheWriteClasses, compareRatios, contextFamily, directExecutionTokens, directTokenShare, distinctSessions, exactDistribution,
  exactRatio, inclusiveDescendantExecutionTokens, lineageTokenShares, measuredTurnCount, peakConcurrency, perMeasuredTurn, providerRuntime, richCohort, sessionLifecycle,
  timeFamily, unionLengthMs, type Interval, type RichCohort } from "./rich-fact-derivations";
import { richFact, richId, richOwner, richReport, richSelection, richUsage } from "./rich-fact-fixtures";

const child: RichOwner = { ...richOwner, executionId: richId(2_000), lineage: "child", parentExecutionId: richOwner.executionId };
const grandchild: RichOwner = { ...richOwner, executionId: richId(3_000), lineage: "child", parentExecutionId: child.executionId };
const stranger: RichOwner = { ...richOwner, executionId: richId(4_000), lineage: "unknown", parentExecutionId: null };
const other: RichOwner = { ...richOwner, executionId: richId(5_000), conversationId: richId(5_001) };
const cohort = (facts: readonly RichFact[], change: Partial<typeof richSelection> = {}): RichCohort => {
  const result = richCohort(richReport(facts), { ...richSelection, ...change });
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const request = (index: number, change: Partial<RichRequest> = {}): RichRequest => ({ kind: "request", observationId: richId(index), stage: "terminal", outcome: "success",
  requestedAtMs: 100, dispatchedAtMs: 110, firstTokenAtMs: 120, lastTokenAtMs: 190, terminalAtMs: 200, clockUncertaintyMs: 0, retryOf: null, ...change });
const span = (index: number, phase: RichSpan["phase"], startMs: number, endMs: number, change: Partial<RichSpan> = {}): RichSpan => ({ kind: "span", observationId: richId(index), phase,
  basis: phase === "inference" ? "stream_lifecycle" : phase === "tool_wait" ? "tool_lifecycle" : phase === "model_request" ? "request_lifecycle" : "human_boundary", startMs, endMs, clockUncertaintyMs: 0, ...change });
const turn = (index: number, change: Partial<RichTurn> = {}): RichTurn => ({ kind: "turn", observationId: richId(index), origin: "human", outcome: "completed", startedAtMs: 100, endedAtMs: 300, clockUncertaintyMs: 0, toolCalls: null, ...change });
const tool = (index: number, change: Partial<RichTool> = {}): RichTool => ({ kind: "tool", observationId: richId(index), stage: "requested", outcome: "unknown", ...change });
/** Facts are stamped at their own terminal instant, as the contract requires for spans, turns and requests. */
const at = (index: number, value: RichPayload, owner: RichOwner = richOwner, atMs?: number): RichFact => richFact(index, value, { owner, atMs: atMs ?? (value.kind === "span" ? value.endMs
  : value.kind === "turn" ? value.endedAtMs : value.kind === "request" ? [value.requestedAtMs, value.dispatchedAtMs, value.firstTokenAtMs, value.lastTokenAtMs, value.terminalAtMs].filter((t): t is number => t !== null).at(-1)! : 200) });
const tokens = (index: number, output: string, change: Partial<ReturnType<typeof richUsage>["tokens"]> = {}, more: Partial<ReturnType<typeof richUsage>> = {}) => {
  const u = richUsage(index, output, more);
  return { ...u, tokens: { ...u.tokens, ...change } };
};

test("cache-write classes partition the selected grain and scope exactly", () => {
  const c = cohort([
    at(1, tokens(1, "1", { cacheWrite5m: "5", cacheWrite1h: "7", cacheWriteUnknown: "11" })),
    at(2, tokens(2, "0", { cacheWrite5m: "999999999999999999999998" })),
    at(3, tokens(3, "1", { cacheWrite1h: "3" }, { grain: "turn" })),
    at(4, tokens(4, "1", { cacheWriteUnknown: "3" }, { tokenScope: "inclusive" })),
    at(5, tokens(5, "1", { cacheWrite5m: "3" }), stranger),
  ]);
  expect(cacheWriteClasses(c)).toEqual({ write5m: 999_999_999_999_999_999_999_998n + 5n + 3n, write1h: 7n, unknown: 11n, measured: 3 });
  expect(cacheWriteClasses(cohort(c.report.facts, { grain: "turn" }))).toEqual({ write5m: 0n, write1h: 3n, unknown: 0n, measured: 1 });
  expect(cacheWriteClasses(cohort(c.report.facts, { tokenScope: "inclusive" }))).toEqual({ write5m: 0n, write1h: 0n, unknown: 3n, measured: 1 });
  expect(cacheWriteClasses(cohort(c.report.facts, { lineage: "root" })).write5m).toBe(999_999_999_999_999_999_999_998n + 5n);
  expect(cacheWriteClasses(cohort([], { window: { startMs: 0, endMs: 10_000 } }))).toEqual({ write5m: 0n, write1h: 0n, unknown: 0n, measured: 0 });
});

test("direct, inclusive and share attribution follow lineage exactly and refuse incomplete trees", () => {
  const facts = [at(1, richUsage(1, "80")), at(2, richUsage(2, "20"), child), at(3, richUsage(3, "5"), grandchild), at(4, richUsage(4, "1000"), other)];
  expect(directExecutionTokens(cohort(facts))).toEqual({ tokens: null, measured: 0, reason: "no_execution" });
  expect(inclusiveDescendantExecutionTokens(cohort(facts))).toEqual({ tokens: null, reason: "no_execution" });
  expect(directTokenShare(cohort(facts))).toEqual({ ratio: null, reason: "no_execution" });
  const root = cohort(facts, { executionId: richOwner.executionId });
  expect(directExecutionTokens(root)).toEqual({ tokens: 80n, measured: 1, reason: null });
  expect(inclusiveDescendantExecutionTokens(root)).toEqual({ tokens: 105n, reason: null });
  expect(directTokenShare(root)).toEqual({ ratio: { numerator: 80n, denominator: 105n }, reason: null });
  const middle = cohort(facts, { executionId: child.executionId });
  expect(inclusiveDescendantExecutionTokens(middle)).toEqual({ tokens: 25n, reason: null });
  expect(directTokenShare(cohort(facts, { executionId: other.executionId }))).toEqual({ ratio: { numerator: 1_000n, denominator: 1_000n }, reason: null });
  const explicit = cohort([...facts, at(5, richUsage(5, "105", { tokenScope: "inclusive" }))], { executionId: richOwner.executionId });
  expect(inclusiveDescendantExecutionTokens(explicit)).toEqual({ tokens: 105n, reason: null });
  const contradicted = cohort([...facts, at(5, richUsage(5, "106", { tokenScope: "inclusive" }))], { executionId: richOwner.executionId });
  expect(inclusiveDescendantExecutionTokens(contradicted)).toEqual({ tokens: null, reason: "inconsistent_inclusive" });
  expect(directTokenShare(contradicted)).toEqual({ ratio: null, reason: "inconsistent_inclusive" });
  const incomplete = cohort([...facts, at(6, richUsage(6, "1"), stranger)], { executionId: richOwner.executionId });
  expect(inclusiveDescendantExecutionTokens(incomplete)).toEqual({ tokens: null, reason: "incomplete_lineage" });
  const incompleteExplicit = cohort([...facts, at(6, richUsage(6, "1"), stranger), at(7, richUsage(7, "300", { tokenScope: "inclusive" }))], { executionId: richOwner.executionId });
  expect(inclusiveDescendantExecutionTokens(incompleteExplicit)).toEqual({ tokens: 300n, reason: null });
  expect(directTokenShare(cohort([at(1, richUsage(1, "0"))], { executionId: richOwner.executionId }))).toEqual({ ratio: null, reason: "no_denominator" });
  // Descendant facts outside the selection window never leak into the inclusive total.
  const late = cohort([...facts, richFact(8, richUsage(8, "500"), { owner: grandchild, atMs: 9_000 })], { executionId: richOwner.executionId, window: { startMs: 0, endMs: 1_000 } });
  expect(inclusiveDescendantExecutionTokens(late)).toEqual({ tokens: 105n, reason: null });
});

test("root and descendant shares partition known-lineage direct tokens and report excluded unknown lineage", () => {
  const shares = lineageTokenShares(cohort([at(1, richUsage(1, "30")), at(2, richUsage(2, "10"), child), at(3, richUsage(3, "5"), stranger), at(4, richUsage(4, "7", { tokenScope: "inclusive" }))]));
  expect(shares).toEqual({ root: { ratio: { numerator: 30n, denominator: 40n }, reason: null }, descendant: { ratio: { numerator: 10n, denominator: 40n }, reason: null }, excludedUnknownLineage: 1 });
  expect(lineageTokenShares(cohort([at(3, richUsage(3, "5"), stranger)]))).toEqual({ root: { ratio: null, reason: "no_denominator" }, descendant: { ratio: null, reason: "no_denominator" }, excludedUnknownLineage: 1 });
});

test("session lifecycle counts sessions by conversation, classifies completed/aborted/open and never fabricates completion", () => {
  const c = cohort([
    at(1, turn(1, { startedAtMs: 100, endedAtMs: 300 })),
    at(2, turn(2, { startedAtMs: 350, endedAtMs: 400, outcome: "aborted" }), child),
    at(3, turn(3, { startedAtMs: 100, endedAtMs: 250 }), other),
    at(4, tool(4), other),
    at(5, richUsage(5, "1"), stranger),
    at(6, request(6, { stage: "dispatched", outcome: "unknown", terminalAtMs: null, firstTokenAtMs: null, lastTokenAtMs: null }), { ...richOwner, executionId: richId(6_000), conversationId: richId(6_001) }),
  ]);
  expect(distinctSessions(c)).toBe(4);
  const lifecycle = sessionLifecycle(c);
  expect(lifecycle).toMatchObject({ sessions: 4, completed: 0, aborted: 1, open: 2, unclassified: 1, openTurns: 2 });
  expect(lifecycle.duration).toMatchObject({ measured: 2, unmeasured: 0, minimum: 150n, maximum: 300n });
  expect(sessionLifecycle(cohort([at(1, turn(1, { startedAtMs: null, clockUncertaintyMs: null }))])).duration).toMatchObject({ measured: 0, unmeasured: 1 });
  expect(sessionLifecycle(cohort([at(1, turn(1, { clockUncertaintyMs: 5 }))])).duration).toMatchObject({ measured: 0, unmeasured: 1 });
  expect(sessionLifecycle(cohort([at(1, turn(1)), at(2, turn(2, { endedAtMs: 500, outcome: "aborted" }))]))).toMatchObject({ completed: 0, aborted: 1, sessions: 1 });
  expect(sessionLifecycle(cohort([at(1, turn(1, { endedAtMs: 500 })), at(2, turn(2, { endedAtMs: 400, outcome: "aborted" }))]))).toMatchObject({ completed: 1, aborted: 0 });
  expect(sessionLifecycle(cohort([]))).toEqual({ sessions: 0, completed: 0, aborted: 0, open: 0, unclassified: 0, openTurns: 0, duration: exactDistribution([]) });
});

test("interval union, peak concurrency and the wall-time family are exact and clipped to the window", () => {
  const i = (executionId: string, startMs: number, endMs: number): Interval => ({ executionId, startMs: BigInt(startMs), endMs: BigInt(endMs) });
  expect(unionLengthMs([])).toBe(0n);
  expect(unionLengthMs([i("a", 0, 10), i("a", 5, 15), i("b", 20, 30), i("b", 30, 31), i("c", 7, 7)])).toBe(26n);
  expect(peakConcurrency([])).toBe(0);
  expect(peakConcurrency([i("a", 0, 10), i("a", 5, 15), i("b", 10, 20), i("c", 12, 13), i("d", 15, 16)])).toBe(3);
  expect(peakConcurrency([i("a", 0, 10), i("b", 10, 20)])).toBe(1);
  const c = cohort([
    at(1, request(1)),
    at(2, request(2, { dispatchedAtMs: null, requestedAtMs: 150, terminalAtMs: 250, firstTokenAtMs: null, lastTokenAtMs: null })),
    at(3, request(3, { clockUncertaintyMs: 5 })),
    at(4, request(4, { dispatchedAtMs: null, requestedAtMs: null, firstTokenAtMs: null, lastTokenAtMs: null })),
    at(5, span(5, "inference", 120, 190)),
    at(6, span(6, "reply_wait", 300, 400)),
    at(7, span(7, "approval_wait", 390, 450), child),
    at(8, span(8, "tool_wait", 420, 480), child),
    at(9, span(9, "tool_wait", 470, 490, { clockUncertaintyMs: null }), child),
    at(10, turn(10, { startedAtMs: 100, endedAtMs: 300 })),
    at(11, turn(11, { startedAtMs: 0, endedAtMs: 60 }), other),
  ], { window: { startMs: 50, endMs: 9_995 } });
  const family = timeFamily(c);
  expect(family.requestBusyTime).toEqual({ ms: 140n, measured: 2, unmeasured: 2 });
  expect(family.inferenceWallTime).toEqual({ ms: 70n, measured: 1, unmeasured: 0 });
  expect(family.humanReplyWaitTime).toEqual({ ms: 100n, measured: 1, unmeasured: 0 });
  expect(family.approvalWaitTime).toEqual({ ms: 60n, measured: 1, unmeasured: 0 });
  expect(family.toolWaitTime).toEqual({ ms: 60n, measured: 1, unmeasured: 1 });
  expect(family.activeWallTime).toEqual({ ms: 380n + 10n, measured: 8, unmeasured: 3 });
  expect(family.unclassifiedExposureTime).toBe(390n - 250n);
  expect(family.monitoredWallTimeMs).toBe(9_945n);
  expect(family.peakConcurrentExecutions).toBe(2);
  expect(family.agentTimeMs).toBe(300n + 90n + 10n);
  expect(family.timeWeightedConcurrency).toEqual({ numerator: 400n, denominator: 9_945n });
  expect(family.activityUtilization).toEqual({ numerator: 390n, denominator: 9_945n });
  expect(family.agentTimeToWallTimeRatio).toEqual({ numerator: 400n, denominator: 390n });
  expect(activeIntervals(cohort([]))).toEqual([]);
  const idle = timeFamily(cohort([at(1, richUsage(1, "1"))]));
  expect(idle).toMatchObject({ activeWallTime: { ms: 0n, measured: 0, unmeasured: 0 }, peakConcurrentExecutions: 0, agentTimeMs: 0n, agentTimeToWallTimeRatio: null, unclassifiedExposureTime: 0n });
  expect(idle.activityUtilization).toEqual({ numerator: 0n, denominator: 10_000n });
});

test("provider runtime, context family and per-turn quantities keep explicit missingness", () => {
  expect(providerRuntime(cohort([at(1, turn(1)), at(2, turn(2, { startedAtMs: null, clockUncertaintyMs: null })), at(3, turn(3, { clockUncertaintyMs: 1 })), at(4, turn(4, { startedAtMs: 250, endedAtMs: 260 }), child)])))
    .toEqual({ ms: 210n, measured: 2, unmeasured: 2 });
  const context = contextFamily(cohort([
    at(1, { kind: "context", observationId: richId(1), tokens: "150", limitTokens: "200" }),
    at(2, { kind: "context", observationId: richId(2), tokens: "50", limitTokens: null }),
    at(3, { kind: "context", observationId: richId(3), tokens: "0", limitTokens: "0" }),
    at(4, { kind: "context", observationId: richId(4), tokens: "4", limitTokens: "5" }),
  ]));
  expect(context.occupancy).toMatchObject({ measured: 4, sum: 204n, maximum: 150n });
  expect(context.limitFractions).toEqual([{ numerator: 150n, denominator: 200n }, { numerator: 4n, denominator: 5n }]);
  expect(context.unmeasuredLimits).toBe(2);
  expect(context.maximumLimitFraction).toEqual({ numerator: 4n, denominator: 5n });
  expect(contextFamily(cohort([])).maximumLimitFraction).toBeNull();
  const turns = cohort([at(1, turn(1)), at(2, turn(2)), at(3, tokens(3, "9", { inputUncached: "4", cacheRead: "5", cacheWrite5m: "1", cacheWrite1h: "2", cacheWriteUnknown: "3" }, { grain: "turn" })),
    at(4, tokens(4, "9", { inputUncached: "100" }, { grain: "turn", tokenScope: "inclusive" })), at(5, tokens(5, "9", { inputUncached: "100" }))]);
  expect(accumulatedTurnInput(turns)).toEqual({ tokens: 15n, measuredTurns: 1 });
  expect(accumulatedTurnInput(cohort(turns.report.facts, { tokenScope: "inclusive" }))).toEqual({ tokens: 100n, measuredTurns: 1 });
  expect(measuredTurnCount(turns)).toBe(2);
  expect(perMeasuredTurn(turns, 15n)).toEqual({ numerator: 15n, denominator: 2n });
  expect(perMeasuredTurn(cohort([]), 15n)).toBeNull();
  expect(exactRatio(1n, 0n)).toBeNull();
  expect(compareRatios({ numerator: 1n, denominator: 3n }, { numerator: 2n, denominator: 6n })).toBe(0);
  expect(compareRatios({ numerator: 2n, denominator: 3n }, { numerator: 3n, denominator: 5n })).toBe(1);
});

test("cohort resolution honours revisions, retractions, windows and refuses invalid selections", () => {
  const facts = [richFact(1, richUsage(1, "10")), richFact(1, richUsage(1, "20"), { revision: 2 }), richFact(2, richUsage(2, "5"), { revision: 1, value: null }), richFact(3, richUsage(3, "7"), { atMs: 5_000 })];
  const c = cohort(facts, { window: { startMs: 0, endMs: 1_000 } });
  expect(c.facts.map(fact => fact.id)).toEqual([richId(1)]);
  expect(c.retracted).toBe(1);
  expect(c.windowed).toHaveLength(1);
  expect(cacheWriteClasses(c).measured).toBe(1);
  expect(cohort(facts).windowed).toHaveLength(2);
  for (const bad of [{ ...richSelection, window: { startMs: 0, endMs: 20_000 } }, { ...richSelection, grain: "hour" }, { ...richSelection, lineage: "sibling" }, { ...richSelection, executionId: "x" }, null, { ...richSelection, window: null }]) {
    expect(richCohort(richReport(facts), bad).ok).toBe(false);
  }
  expect(richCohort({ not: "a report" }, richSelection)).toEqual({ ok: false, error: "invalid_rich_facts" });
});

test("property: union length never exceeds the sum of lengths, agent time never drops below active wall time and shares sum to one", () => {
  const owners = [richOwner, child, grandchild];
  assertProperty(fc.property(fc.array(fc.record({ owner: fc.integer({ min: 0, max: 2 }), start: fc.integer({ min: 0, max: 9_000 }), length: fc.integer({ min: 1, max: 1_000 }), output: fc.bigInt({ min: 0n, max: 1_000_000n }) }), { maxLength: 40 }), rows => {
    // Every lineage owner is retained so the root's descendant tree is complete.
    const facts = [...owners.map((owner, index) => at(900 + index, richUsage(900 + index, "0"), owner)), ...rows.flatMap((row, index) => [
      at(index * 2 + 1, span(index * 2 + 1, "inference", row.start, row.start + row.length), owners[row.owner]!),
      at(index * 2 + 2, richUsage(index * 2 + 2, String(row.output)), owners[row.owner]!),
    ])];
    const c = cohort(facts), family = timeFamily(c);
    const sum = rows.reduce((total, row) => total + BigInt(Math.min(row.start + row.length, 10_000) - row.start), 0n);
    expect(family.activeWallTime.ms).toBeLessThanOrEqual(sum);
    expect(family.agentTimeMs).toBeGreaterThanOrEqual(family.activeWallTime.ms);
    expect(family.agentTimeMs).toBeLessThanOrEqual(sum);
    expect(family.inferenceWallTime.ms).toBe(family.activeWallTime.ms);
    expect(family.unclassifiedExposureTime).toBe(0n);
    expect(family.peakConcurrentExecutions).toBeLessThanOrEqual(new Set(rows.map(row => row.owner)).size);
    const shares = lineageTokenShares(c);
    if (shares.root.ratio && shares.descendant.ratio) expect(shares.root.ratio.numerator + shares.descendant.ratio.numerator).toBe(shares.root.ratio.denominator);
    const inclusive = inclusiveDescendantExecutionTokens(cohort(facts, { executionId: richOwner.executionId }));
    expect(inclusive.tokens).toBe(rows.reduce((total, row) => total + row.output, 0n));
  }));
});
