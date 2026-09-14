import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import nativeHistory from "../../fixtures/usage/session-history-v1.json";
import { decodeSessionReport, parseSessionReport, summarizeSession, summarizeSessions, unionMs } from "./sessions";
import { SESSION_PHASES, type SessionObservation, type SessionReport, type SessionSpan } from "./session-contract";

const ident = (n: number) => n.toString(16).padStart(32, "0");
const span = (n: number, startMs: number, endMs: number, kind: SessionSpan["kind"]): SessionSpan => ({ id: ident(n), startMs, endMs, kind,
  basis: kind === "inference" ? "stream_lifecycle" : kind === "tool_wait" ? "tool_lifecycle" : kind === "model_request" ? "request_lifecycle" : "human_boundary" });
const session = (spans: SessionSpan[] = []): SessionObservation => ({ provider: "codex", sessionId: ident(1), conversationId: null,
  source: "instrumented", window: { startMs: 0, endMs: 100 }, spans, usage: [] });
const report = (...sessions: SessionObservation[]): SessionReport => ({ schemaVersion: 1, profile: "session-observations-v1", sessions });

describe("session report privacy boundary", () => {
  test("accepts the exact native export without changing its token semantics", () => {
    const nativeReport = nativeHistory as unknown as SessionReport;
    const value = parseSessionReport(nativeReport);
    expect(value).toEqual(nativeReport);
    const totals = summarizeSessions(value!);
    expect(totals.accountedTokens).toBe(114n);
    expect(totals.outputTokens).toBe(4n);
    expect(totals.sessionInferencePct).toBeNull();
  });
  test("copies only the fixed report and rejects content, native ids, aliases and invented timing", () => {
    const value = report(session());
    expect(parseSessionReport(value)).toEqual(value);
    expect(parseSessionReport({ ...value, prompt: "private" })).toBeNull();
    expect(parseSessionReport(report({ ...session(), sessionId: "native-session" }))).toBeNull();
    expect(parseSessionReport(report({ ...session([span(2, 0, 10, "inference")]), source: "history" }))).toBeNull();
    expect(parseSessionReport(report(session([{ ...span(2, 0, 10, "inference"), basis: "request_lifecycle" }])))).toBeNull();
    expect(decodeSessionReport("not JSON")).toBeNull();
  });
  test("does not execute accessors and rejects sparse arrays, extra fields and bad windows", () => {
    let invoked = false;
    expect(parseSessionReport({ schemaVersion: 1, profile: "session-observations-v1", get sessions() { invoked = true; return []; } })).toBeNull();
    expect(invoked).toBe(false);
    expect(parseSessionReport({ ...report(), sessions: new Array(2) })).toBeNull();
    expect(parseSessionReport(report({ ...session(), window: { startMs: 100, endMs: 0 } }))).toBeNull();
    expect(parseSessionReport(report(session([span(2, -1, 10, "tool_wait")])))).toBeNull();
  });
  test("refuses duplicate occurrences across sessions and incompatible token counters", () => {
    const usage = { id: ident(50), atMs: 10, model: "gpt-5.5", modelBasis: "response" as const, inputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 0, outputTokens: 4, reasoningTokens: 2 };
    const s = { ...session(), usage: [usage] };
    expect(parseSessionReport(report(s))).not.toBeNull();
    expect(parseSessionReport(report(s, { ...s, sessionId: ident(2) }))).toBeNull();
    for (const patch of [{ model: "custom-private-model" }, { model: "claude-opus-4-6" }, { reasoningTokens: 5 }, { outputTokens: -0 }, { inputTokens: 1e12 + 1 }]) {
      expect(parseSessionReport(report({ ...s, usage: [{ ...usage, ...patch }] }))).toBeNull();
    }
  });
});

describe("measured session time", () => {
  test("request duration never fills inference or unknown gaps", () => {
    const value = summarizeSession(session([span(2, 0, 100, "model_request"), span(3, 20, 40, "inference")]));
    expect(value.modelRequestMs).toBe(100);
    expect(value.phaseMs).toEqual({ inference: 20, reply_wait: 0, approval_wait: 0, tool_wait: 0, unknown: 80 });
    expect(value.inferencePct).toBeNull();
    expect(value.observedInferencePct).toBe(20);
  });
  test("inference wins overlap, approvals split tool time, conflicting human waits stay unknown", () => {
    const value = summarizeSession(session([
      span(2, 0, 100, "tool_wait"), span(3, 10, 50, "approval_wait"),
      span(4, 30, 60, "reply_wait"), span(5, 40, 70, "inference"),
    ]));
    expect(value.phaseMs).toEqual({ inference: 30, approval_wait: 20, reply_wait: 0, tool_wait: 40, unknown: 10 });
    expect(value.timeline[2]).toEqual({ startMs: 30, endMs: 40, phase: "unknown" });
  });
  test("historical and zero-duration sessions do not claim zero utilization", () => {
    expect(summarizeSession({ ...session(), source: "history" }).inferencePct).toBeNull();
    const zero = summarizeSession({ ...session(), window: { startMs: 1, endMs: 1 } });
    expect(zero.observedInferencePct).toBeNull();
    expect(zero.timeline).toEqual([]);
    expect(summarizeSessions(report()).netInferencePct).toBeNull();
  });
  test("concurrent sessions have distinct session and elapsed-time denominators", () => {
    const first = session([span(2, 0, 60, "inference"), span(3, 60, 100, "tool_wait")]);
    const second = { ...session([span(4, 40, 100, "inference"), span(5, 0, 40, "reply_wait")]), sessionId: ident(9) };
    const result = summarizeSessions(report(first, second));
    expect(result.sessionMs).toBe(200);
    expect(result.sessionInferencePct).toBe(60);
    expect(result.netInferenceMs).toBe(100);
    expect(result.netInferencePct).toBe(100);
    expect(result.peakInferenceConcurrency).toBe(2);
    expect(result.meanInferenceConcurrency).toBe(1.2);
  });
  test("unobserved parallel time cannot erase proven net inference", () => {
    const result = summarizeSessions(report(session([span(2, 0, 100, "inference")]), { ...session(), sessionId: ident(8) }));
    expect(result.netUnknownMs).toBe(0);
    expect(result.netInferencePct).toBe(100);
    expect(result.sessionInferencePct).toBeNull();
  });
  test("model totals keep cache categories disjoint and reasoning inside output", () => {
    const result = summarizeSession({ ...session(), usage: [
      { id: ident(50), atMs: 10, model: "gpt-5.5", modelBasis: "response" as const, inputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 30, outputTokens: 40, reasoningTokens: 25 },
      { id: ident(51), atMs: 20, model: null, modelBasis: "unknown", inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, reasoningTokens: null },
    ] });
    expect(result.accountedTokens).toBe(102n);
    expect(result.outputTokens).toBe(41n);
    expect(result.models[0].reasoningTokens).toBe(25n);
    expect(result.models[1].reasoningMeasuredRecords).toBe(0);
  });
  test("partition is invariant under order and duplication; union never exceeds exposure", () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 1, max: 100 }), fc.constantFrom("inference", "reply_wait", "approval_wait", "tool_wait")), { maxLength: 50 }), values => {
      const spans = values.map(([a, b, kind], i) => span(i + 2, Math.min(a, b - 1), Math.max(a + 1, b), kind));
      const a = summarizeSession(session(spans)), b = summarizeSession(session([...spans].reverse().concat(spans)));
      expect(a.phaseMs).toEqual(b.phaseMs);
      expect(SESSION_PHASES.reduce((sum, k) => sum + a.phaseMs[k], 0)).toBe(100);
      expect(unionMs(spans)).toBeLessThanOrEqual(100);
      expect(a.timeline[0]?.startMs).toBe(0);
      expect(a.timeline.at(-1)?.endMs).toBe(100);
    }));
  });
});
