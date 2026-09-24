import { expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { richFactsFromCompactions, richFactsFromSessions, richFactsFromTerminalTurns, type RichAdapterOptions } from "./rich-fact-adapters";
import { summarizeRichFacts } from "./rich-facts";
import { parseOtlpTraces } from "./session-telemetry";
import type { SessionReport } from "./session-contract";
import type { TerminalTurn } from "./turns";
import { richId, richSelection } from "./rich-fact-fixtures";

const options = (): RichAdapterOptions => ({ key: new Uint8Array(32).fill(7), sourceEpoch: "local-source-secret-canary", window: { startMs: 0, endMs: 10_000 } });
const sessions = (): SessionReport => ({ schemaVersion: 1, profile: "session-observations-v1", sessions: [{
  provider: "codex", sessionId: richId(123), conversationId: richId(456), window: { startMs: 100, endMs: 300 }, source: "history", spans: [],
  usage: [{ id: richId(789), atMs: 200, model: "gpt-5.4", modelBasis: "request", inputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 30, outputTokens: 40, reasoningTokens: 10 }],
}] });
const turnId = (value: number) => { const result = new Uint8Array(16); result[15] = value; return result; };
const turn = (index: number, lineage: TerminalTurn["lineage"] = 1): TerminalTurn => ({ id: turnId(index), executionId: turnId(index), accountId: new Uint8Array(16), provider: 1,
  origin: 0, lineage, outcome: 1, startedAtMs: 100, endedAtMs: 200, clockUncertaintyMs: 0, toolCalls: null,
  tokens: { inputUncached: 10n, cacheRead: 5n, cacheWrite5m: 0n, cacheWrite1h: 0n, output: 20n } });
const compaction = () => ({ schema: "gobstopper/compaction-events-v1", ts: 1, provider: "codex", session_id: "native-private-session",
  strategy: "private-strategy-canary", action: "provider_compact", outcome: "applied", trigger_tokens: 100, context_tokens_before: 100,
  context_tokens_after: 50, est_reclaimed_tokens: 50, items_covered: 10, duration_ms: 200, error_code: "private-error-canary" });

test("Rust native session projections share the exact HMAC identity and unknown-model fixtures", async () => {
  const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../fixtures/usage/${name}`, import.meta.url), "utf8")) as unknown;
  const selected = { key: new Uint8Array(32).fill(9), sourceEpoch: "synthetic_source_v1", window: { startMs: 1_767_225_600_000, endMs: 1_767_225_610_000 } };
  const known = await richFactsFromSessions(fixture("session-history-v1.json"), selected);
  expect<unknown>(known).toEqual({ ok: true, value: fixture("rich-session-history-v1.json") });
  const unknown = await richFactsFromSessions(fixture("session-unknown-model-v1.json"), selected);
  expect(unknown.ok).toBe(true);
  if (!unknown.ok || !known.ok) return;
  expect(unknown.value.facts[0]!.id).toBe(known.value.facts[0]!.id);
  expect(unknown.value.facts[0]!.value).toMatchObject({ model: null, modelBasis: "unknown" });
  expect(unknown.value.facts[0]!.owner).toEqual(known.value.facts[0]!.owner);
});

test("session adapter preserves numeric conservation while keeping grain, lineage and TTL unknown", async () => {
  const result = await richFactsFromSessions(sessions(), options());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const summary = summarizeRichFacts(result.value, { ...richSelection, grain: "usage_observation", tokenScope: "unknown" });
  expect(summary.ok).toBe(true);
  if (!summary.ok) return;
  expect(summary.value.tokens?.total.sum).toBe(100n);
  expect(summary.value.tokens?.reasoning.sum).toBe(10n);
  expect(summary.value.tokens?.cacheWriteUnknown.sum).toBe(30n);
  expect(result.value.coverage).toMatchObject({ usage: "partial", request: "unsupported", span: "unsupported" });
  expect(result.value.facts[0]!.owner.lineage).toBe("unknown");
  const serialized = JSON.stringify(result.value);
  for (const raw of [richId(123), richId(456), richId(789), options().sourceEpoch]) expect(serialized).not.toContain(raw);
  const root = summarizeRichFacts(result.value, { ...richSelection, grain: "usage_observation", tokenScope: "unknown", lineage: "root" });
  expect(root.ok && root.value.tokens?.total.sum).toBe(0n);
  expect(root.ok && root.value.excludedUnknownLineage).toBe(1);
});

test("existing OTLP request spans do not synthesize dispatch, success, exact clocks or streaming timings", async () => {
  const attr = (key: string, value: object) => ({ key, value });
  const packet = { resourceSpans: [{ resource: { attributes: [attr("session.id", { stringValue: "private-session-canary" })] }, scopeSpans: [{ spans: [{
    traceId: richId(1), spanId: "0000000000000002", name: "claude_code.llm_request", startTimeUnixNano: "100000000", endTimeUnixNano: "200000000",
    attributes: [attr("model", { stringValue: "claude-sonnet-4-6" }), attr("content", { stringValue: "private-prompt-canary" }),
      ...["input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens"].map(key => attr(key, { intValue: "10" }))],
  }] }] }] };
  const local = await parseOtlpTraces(packet, options().key);
  const result = await richFactsFromSessions(local, options());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const summary = summarizeRichFacts(result.value, { ...richSelection, grain: "usage_observation", tokenScope: "unknown" });
  if (!summary.ok) throw new Error(summary.error);
  expect(summary.value.requests.terminal).toBe(0);
  expect(summary.value.requests.firstTokenMs.observedMean).toBeNull();
  expect(summary.value.spans.model_request).toMatchObject({ measured: 0, unmeasured: 1 });
  expect(JSON.stringify(result.value)).not.toContain("private-");
});

test("adapter snapshots source bytes, key view, source epoch and retention options before awaiting", async () => {
  const source = sessions(), mutable = { key: new Uint8Array(32).fill(7), sourceEpoch: "local-source-secret-canary", window: { startMs: 0, endMs: 10_000 } };
  const pending = richFactsFromSessions(source, mutable);
  mutable.key.fill(0); mutable.sourceEpoch = "different-epoch"; mutable.window.endMs = 1;
  Object.assign(source.sessions[0]!.usage[0]!, { outputTokens: 999 });
  expect(await pending).toEqual(await richFactsFromSessions(sessions(), options()));
  const backing = new Uint8Array(64).fill(3); backing.set(new Uint8Array(32).fill(7), 16);
  expect(await richFactsFromSessions(sessions(), { ...options(), key: backing.subarray(16, 48) })).toEqual(await richFactsFromSessions(sessions(), options()));
});

test("terminal adapter snapshots every candidate before import or an earlier fact's sign", async () => {
  const expected = await richFactsFromTerminalTurns([turn(1), turn(2)], options());
  const duringImport = [turn(1), turn(2)];
  const pending = richFactsFromTerminalTurns(duringImport, options());
  duringImport[0]!.id.fill(99);
  Object.assign(duringImport[1]!.tokens!, { output: 999n });
  expect(await pending).toEqual(expected);

  const duringSign = [turn(1), turn(2)];
  const sign = crypto.subtle.sign.bind(crypto.subtle);
  let mutated = false;
  const hook = spyOn(crypto.subtle, "sign").mockImplementation((algorithm, key, data) => {
    if (!mutated && new TextDecoder().decode(data).includes('"fact"')) {
      mutated = true;
      duringSign[1]!.executionId.fill(42);
      Object.assign(duringSign[1]!.tokens!, { output: 999n });
    }
    return sign(algorithm, key, data);
  });
  try {
    expect(await richFactsFromTerminalTurns(duringSign, options())).toEqual(expected);
    expect(mutated).toBe(true);
  } finally { hook.mockRestore(); }
});

test("compaction adapter snapshots every candidate before import or an earlier fact's sign", async () => {
  const original = () => [{ position: 0, event: compaction() }, { position: 300, event: compaction() }];
  const expected = await richFactsFromCompactions(original(), options());
  const duringImport = original();
  const pending = richFactsFromCompactions(duringImport, options());
  duringImport[0]!.position = 99;
  duringImport[1]!.event.duration_ms = 999;
  expect(await pending).toEqual(expected);

  const duringSign = original();
  const sign = crypto.subtle.sign.bind(crypto.subtle);
  let mutated = false;
  const hook = spyOn(crypto.subtle, "sign").mockImplementation((algorithm, key, data) => {
    if (!mutated && new TextDecoder().decode(data).includes('"fact"')) {
      mutated = true;
      duringSign[1]!.position = 99;
      duringSign[1]!.event.duration_ms = 999;
    }
    return sign(algorithm, key, data);
  });
  try {
    expect(await richFactsFromCompactions(duringSign, options())).toEqual(expected);
    expect(mutated).toBe(true);
  } finally { hook.mockRestore(); }
});

test("terminal turns preserve root/child, unknown origin, direct tokens and independent runtime coverage", async () => {
  const result = await richFactsFromTerminalTurns([turn(1), { ...turn(2, 2), startedAtMs: null, clockUncertaintyMs: null, tokens: null }], options());
  if (!result.ok) throw new Error(result.error);
  const summary = summarizeRichFacts(result.value, { ...richSelection, grain: "turn" });
  if (!summary.ok) throw new Error(summary.error);
  expect(summary.value.turns.completed).toBe(2);
  expect(summary.value.turns.unknownOrigin).toBe(2);
  expect(summary.value.turns.completedRuntimeMs).toMatchObject({ measured: 1, unmeasured: 1 });
  expect(summary.value.tokens?.total).toMatchObject({ measured: 1, unmeasured: 1, sum: 35n });
  expect(summary.value.requests.success).toBe(0);
  expect(result.value.facts.some(fact => fact.owner.lineage === "child" && fact.owner.parentExecutionId === null)).toBe(true);
  const root = summarizeRichFacts(result.value, { ...richSelection, grain: "turn", lineage: "root" });
  expect(root.ok && root.value.turns.completed).toBe(1);
});

test("compaction positions preserve identical distinct events and omit private strategy/error/native IDs", async () => {
  const event = compaction();
  const result = await richFactsFromCompactions([{ position: 0, event }, { position: 300, event }], options());
  if (!result.ok) throw new Error(result.error);
  const summary = summarizeRichFacts(result.value, richSelection);
  expect(summary.ok && summary.value.compactions.applied).toBe(2);
  expect(summary.ok && summary.value.compactions.estimatedReclaimedTokens.sum).toBe(100n);
  expect(JSON.stringify(result.value)).not.toContain("private-");
  const replay = await richFactsFromCompactions([{ position: 0, event }, { position: 0, event }], options());
  if (!replay.ok) throw new Error(replay.error);
  const replayed = summarizeRichFacts(replay.value, richSelection);
  expect(replayed.ok && replayed.value.compactions.applied).toBe(1);
  expect(await richFactsFromCompactions([{ position: 0, event }, { position: 0, event: { ...event, duration_ms: 201 } }], options())).toEqual({ ok: false, error: "conflicting_fact" });
});

test("adapters refuse foreign fields/accessors and never activate a source or claim complete coverage", async () => {
  let invoked = false;
  expect((await richFactsFromTerminalTurns([{ ...turn(1), get tokens() { invoked = true; return null; } }], options())).ok).toBe(false);
  expect((await richFactsFromCompactions([{ position: 0, get event() { invoked = true; return compaction(); } }], options())).ok).toBe(false);
  expect((await richFactsFromSessions(sessions(), { ...options(), get sourceEpoch() { invoked = true; return "canary"; } })).ok).toBe(false);
  expect(invoked).toBe(false);
  expect((await richFactsFromSessions({ ...sessions(), prompt: "secret" }, options())).ok).toBe(false);
  expect((await richFactsFromCompactions([{ position: 0, event: { ...compaction(), content: "secret" } }], options())).ok).toBe(false);
  const empty = await richFactsFromTerminalTurns([], options());
  if (!empty.ok) throw new Error(empty.error);
  expect(Object.values(empty.value.coverage)).not.toContain("complete");
});
