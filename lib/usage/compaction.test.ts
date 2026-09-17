import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  COMPACTION_EVENT_SCHEMA, COMPACTION_EVENTS_MAX_BYTES, decodeCompactionEvents, joinCompactionEvents,
  normalizeGobstopperSessionId, parseCompactionEvent,
} from "./compaction";
import { parseSessionReport } from "./sessions";
import type { SessionObservation, SessionReport } from "./session-contract";

const fixtureText = readFileSync(new URL("../../fixtures/usage/compaction-events-v1.jsonl", import.meta.url), "utf8");

const wire = (patch: Record<string, unknown> = {}) => ({
  schema: "gobstopper/compaction-events-v1", ts: 1_762_000_000, provider: "codex",
  session_id: "3f6b1a2c-9d4e-4f5a-8b6c-7d8e9f0a1b2c", strategy: "elide",
  action: "transcript_compact", outcome: "applied", trigger_tokens: 250_000,
  context_tokens_before: 260_000, context_tokens_after: 40_000, est_reclaimed_tokens: 220_000,
  items_covered: 12, duration_ms: 42, error_code: null, ...patch,
});
const event = (patch: Record<string, unknown> = {}) => parseCompactionEvent(wire(patch))!;
const ident = (n: number) => n.toString(16).padStart(32, "0");
const session = (sessionId: string, provider: SessionObservation["provider"], startMs: number, endMs: number): SessionObservation =>
  ({ provider, sessionId, conversationId: null, source: "history", window: { startMs, endMs }, usage: [], spans: [] });
const report = (...sessions: SessionObservation[]): SessionReport => ({ schemaVersion: 1, profile: "session-observations-v1", sessions });

describe("compaction event schema", () => {
  test("accepts the checked fixture log and maps the snake_case wire to bounded numbers", () => {
    const log = decodeCompactionEvents(fixtureText);
    expect(log).not.toBeNull();
    expect(log!.events).toHaveLength(7);
    expect(log!.skippedLines).toBe(0);
    const first = log!.events[0];
    expect(first).toEqual({ schema: COMPACTION_EVENT_SCHEMA, atSec: 1_762_000_000, provider: "codex",
      sessionId: "3f6b1a2c-9d4e-4f5a-8b6c-7d8e9f0a1b2c", strategy: "elide", action: "transcript_compact",
      outcome: "applied", triggerTokens: 250_000, contextTokensBefore: 260_000, contextTokensAfter: 40_000,
      estReclaimedTokens: 220_000, itemsCovered: 12, durationMs: 42, errorCode: null });
    expect(log!.events.map(e => e.outcome)).toEqual(["applied", "failed", "applied", "applied", "planned", "skipped", "applied"]);
  });
  test("copies only the fixed record and rejects content, extras, accessors and foreign providers", () => {
    const value = event();
    expect(Object.keys(value)).toHaveLength(14);
    expect(parseCompactionEvent({ ...wire(), transcript: "private" })).toBeNull();
    expect(parseCompactionEvent({ ...wire(), provider: "devin" })).toBeNull();
    expect(parseCompactionEvent({ ...wire(), schema: "gobstopper/compaction-events-v2" })).toBeNull();
    let invoked = false;
    expect(parseCompactionEvent({ ...wire(), get ts() { invoked = true; return 0; } })).toBeNull();
    expect(invoked).toBe(false);
  });
  test("enforces closed vocab, bounded labels and numeric bounds", () => {
    for (const patch of [
      { action: "rewrite" }, { outcome: "succeeded" }, { strategy: "" }, { strategy: "a".repeat(65) },
      { error_code: "io error: /private/tmp/x" }, { error_code: 5 }, { session_id: "" },
      { session_id: "../sessions/x.jsonl" }, { ts: -0 }, { ts: 1.5 }, { trigger_tokens: 1e12 + 1 },
      { duration_ms: 366 * 86_400_000 + 1 }, { items_covered: -1 },
    ]) expect(parseCompactionEvent(wire(patch))).toBeNull();
    expect(parseCompactionEvent(wire({ strategy: "preset:sawtooth", error_code: "provider_rejected" }))).not.toBeNull();
  });
  test("rejects reclaimed counters that contradict the before/after context", () => {
    expect(parseCompactionEvent(wire({ est_reclaimed_tokens: 219_999 }))).toBeNull();
    expect(parseCompactionEvent(wire({ context_tokens_after: 300_000, est_reclaimed_tokens: 0 }))).not.toBeNull();
    expect(parseCompactionEvent(wire({ context_tokens_after: 300_000, est_reclaimed_tokens: 1 }))).toBeNull();
  });
  test("parsing is total over arbitrary values", () => {
    fc.assert(fc.property(fc.jsonValue(), value => {
      const parsed = parseCompactionEvent(value);
      if (parsed !== null) {
        const back = parseCompactionEvent(wire({
          ts: parsed.atSec, provider: parsed.provider, session_id: parsed.sessionId, strategy: parsed.strategy,
          action: parsed.action, outcome: parsed.outcome, trigger_tokens: parsed.triggerTokens,
          context_tokens_before: parsed.contextTokensBefore, context_tokens_after: parsed.contextTokensAfter,
          est_reclaimed_tokens: parsed.estReclaimedTokens, items_covered: parsed.itemsCovered,
          duration_ms: parsed.durationMs, error_code: parsed.errorCode,
        }));
        expect(back).toEqual(parsed);
      }
    }));
  });
});

describe("compaction event log decoding", () => {
  test("blank, torn and foreign lines are skipped without losing the history", () => {
    const text = `\n${fixtureText}not json\n{"schema":"other/v9","ts":1}\n   \n{"schema":"gobstopper/compaction-events-v1","ts":5}\r\n`;
    const log = decodeCompactionEvents(text);
    expect(log!.events).toHaveLength(7);
    expect(log!.skippedLines).toBe(3);
  });
  test("rejects non-strings, oversized text and over-populated logs", () => {
    expect(decodeCompactionEvents(42)).toBeNull();
    expect(decodeCompactionEvents("x".repeat(COMPACTION_EVENTS_MAX_BYTES + 1))).toBeNull();
    const line = JSON.stringify(wire());
    expect(decodeCompactionEvents(`${line}\n`.repeat(50_001))).toBeNull();
  });
  test("decoding is total for bounded strings", () => {
    fc.assert(fc.property(fc.string({ maxLength: 2_000 }), text => {
      const log = decodeCompactionEvents(text);
      expect(log).not.toBeNull();
      for (const e of log!.events) expect(e.schema).toBe(COMPACTION_EVENT_SCHEMA);
    }));
  });
});

describe("native session id canonicalization", () => {
  // Golden values produced by the producer's own canonicalizer; keep parity.
  test.each([
    ["3f6b1a2c-9d4e-4f5a-8b6c-7d8e9f0a1b2c", "3f6b1a2c9d4e4f5a8b6c7d8e9f0a1b2c"],
    ["AA11BB22-CC33-4D44-8E55-FF6677889900", "aa11bb22cc334d448e55ff6677889900"],
    ["rollout-no-uuid-here", "8cf344bd951dd1df7293489b0f846943"],
    ["rollout-2025-11-02T03-04-05-3f6b1a2c-9d4e-4f5a-8b6c-7d8e9f0a1b2c.jsonl", "67260291368656762b9325027c924718"],
    ["unrelated-session", "e1c8e6272fbaa9c0a341185538978f56"],
    ["sess-9", "2fb04f9c5001ddcdcaadd84bcf4d737d"],
    ["unknown", "fb1f010af7e258058743b541c2db82ed"],
    ["0199f8d2c7a4e5b6f7a8b9c0d1e2f3a4", "0199f8d2c7a4e5b6f7a8b9c0d1e2f3a4"],
  ])("normalize(%s) is stable and schema-shaped", (raw, expected) => {
    expect(normalizeGobstopperSessionId(raw)).toBe(expected);
    expect(normalizeGobstopperSessionId(expected)).toBe(expected);
  });
});

describe("compaction/session join", () => {
  const sessions = report(
    session("3f6b1a2c9d4e4f5a8b6c7d8e9f0a1b2c", "codex", 1_761_990_000_000, 1_762_030_000_000),
    session("aa11bb22cc334d448e55ff6677889900", "claude_code", 1_762_010_000_000, 1_762_020_000_000),
    session("8cf344bd951dd1df7293489b0f846943", "claude_code", 1_762_017_000_000, 1_762_019_000_000),
    session("0199f8d2c7a4e5b6f7a8b9c0d1e2f3a4", "codex", 1_762_021_000_000, 1_762_022_000_000),
    session(ident(99), "devin", 1_762_020_000_000, 1_762_030_000_000),
  );
  const events = decodeCompactionEvents(fixtureText)!.events;
  const stray = parseCompactionEvent(wire({ session_id: "unrelated-session", ts: 1_762_025_000 }))!;
  const joined = joinCompactionEvents(sessions, [...events, stray]);

  test("counts compactions and reclaimed tokens per session", () => {
    expect(joined.sessions).toHaveLength(5);
    const [a, b, c, d, empty] = joined.sessions;
    expect(a.events.map(e => e.atSec)).toEqual([1_762_000_000, 1_762_003_600, 1_762_007_200]);
    expect(a.applied).toBe(2); expect(a.failed).toBe(1); expect(a.planned).toBe(0); expect(a.skipped).toBe(0);
    expect(a.estReclaimedTokens).toBe(395_000n);
    expect(a.errorCodes).toEqual(["provider_rejected"]);
    expect(a.lastStrategy).toBe("preset:sawtooth");
    expect(a.lastAppliedMs).toBe(1_762_007_200_000);
    expect(a.eventsInWindow).toBe(3);
    expect(b.applied).toBe(1); expect(b.planned).toBe(1); expect(b.estReclaimedTokens).toBe(130_000n);
    // Digest-fallback native id joins its canonicalized session.
    expect(c.events).toHaveLength(1); expect(c.skipped).toBe(1); expect(c.estReclaimedTokens).toBe(0n);
    expect(d.applied).toBe(1);
    expect(empty.events).toHaveLength(0);
    expect(empty.estReclaimedTokens).toBe(0n);
    expect(empty.errorCodes).toEqual([]);
    expect(joined.matchedEvents).toBe(7);
    expect(joined.unmatchedEvents).toEqual([stray]);
    // Log totals span every applied event, matched or not (stray applied adds 220k).
    expect(joined.applied).toBe(5);
    expect(joined.estReclaimedTokens).toBe(965_000n);
  });
  test("event timestamps sit inside observation windows for regression comparison", () => {
    const a = joined.sessions[0];
    for (const e of a.events) {
      const atMs = e.atSec * 1_000;
      expect(atMs).toBeGreaterThanOrEqual(a.session.window.startMs);
      expect(atMs).toBeLessThanOrEqual(a.session.window.endMs);
    }
    const out = joinCompactionEvents(sessions, [parseCompactionEvent(wire({ ts: 1_800_000_000 }))!]);
    expect(out.sessions[0].eventsInWindow).toBe(0);
    expect(out.sessions[0].events).toHaveLength(1);
  });
  test("sessions parsed by the strict report parser join unchanged", () => {
    const parsed = parseSessionReport({ schemaVersion: 1, profile: "session-observations-v1", sessions: sessions.sessions });
    expect(parsed).not.toBeNull();
    expect(joinCompactionEvents(parsed!, events).sessions.map(s => s.applied)).toEqual([2, 1, 0, 1, 0]);
  });
});
