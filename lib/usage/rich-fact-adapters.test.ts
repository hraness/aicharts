import { expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { richFactsFromClaudeTranscript, richFactsFromCodexTranscript, richFactsFromCompactions, richFactsFromSessions, richFactsFromTerminalTurns, richFactsFromTranscripts, type RichAdapterOptions, type TranscriptSource } from "./rich-fact-adapters";
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

// ---- Native transcript adapters (shared fixtures with crates/aicharts-core/src/rich_facts/transcript.rs) ----
const transcriptFixture = (name: string) => readFileSync(new URL(`../../fixtures/usage/${name}`, import.meta.url), "utf8");
const transcriptOptions = (): RichAdapterOptions => ({ key: new Uint8Array(32).fill(9), sourceEpoch: "synthetic_source_v1", window: { startMs: 1_767_225_600_000, endMs: 1_767_225_660_000 } });
const transcriptSources = (): TranscriptSource[] => [
  { provider: "claude_code", text: transcriptFixture("rich-claude-transcript-v1.jsonl") },
  { provider: "codex", text: transcriptFixture("rich-codex-transcript-v1.jsonl") },
  { provider: "codex", text: transcriptFixture("rich-codex-transcript-child-v1.jsonl") },
  { provider: "claude_code", text: transcriptFixture("rich-claude-transcript-v2.jsonl") },
];
const START = 1_767_225_600_000;

test("transcript adapters reproduce the Rust producer's report byte for byte from the shared fixtures", async () => {
  const result = await richFactsFromTranscripts(transcriptSources(), transcriptOptions());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect<unknown>(result.value.report).toEqual(JSON.parse(transcriptFixture("rich-transcript-v1.json")));
  expect(result.value.measured).toEqual({ skippedRecords: 3, linesRead: 28 });
  expect(result.value.report.coverage).toEqual({ usage: "partial", span: "unsupported", request: "partial", turn: "unsupported", tool: "partial", context: "partial", compaction: "unsupported" });
  const serialized = JSON.stringify(result.value.report);
  for (const canary of ["PRIVATE_", "synthetic_source_v1", "11111111-2222", "22222222-3333", "req_synthetic", "msg_synthetic", "toolu_synthetic", "call_synthetic", "agent_synthetic", "/private/synthetic", "2.1.281", "0.156.1"]) expect(serialized).not.toContain(canary);
});

test("transcript request facts expose exact terminal and prompt timestamps and never fabricate streaming timing", async () => {
  const result = await richFactsFromClaudeTranscript(transcriptFixture("rich-claude-transcript-v1.jsonl"), transcriptOptions());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const requests = result.value.report.facts.filter(fact => fact.kind === "request" && fact.owner.lineage === "root").map(fact => fact.value);
  expect(requests).toHaveLength(3);
  expect(requests[0]).toMatchObject({ stage: "terminal", outcome: "success", requestedAtMs: START + 1_000, terminalAtMs: START + 3_500, dispatchedAtMs: null, firstTokenAtMs: null, lastTokenAtMs: null, retryOf: null, clockUncertaintyMs: null });
  expect(requests[2]).toMatchObject({ outcome: "error", terminalAtMs: START + 6_000 });
  const usage = result.value.report.facts.filter(fact => fact.kind === "usage" && fact.owner.lineage === "root");
  expect(usage.map(fact => fact.value && "grain" in fact.value ? fact.value.grain : null)).toEqual(["request", "response", "request", "response"]);
  expect(usage[0]!.value).toMatchObject({ model: "claude-sonnet-4-6", modelBasis: "response", tokens: { output: "4", cacheWrite5m: "20", cacheWrite1h: "10", cacheWriteUnknown: "0" } });
  const context = result.value.report.facts.filter(fact => fact.kind === "context").map(fact => fact.value);
  expect(context[0]).toMatchObject({ tokens: "140", limitTokens: null });
  const summary = summarizeRichFacts(result.value.report, { ...richSelection, window: transcriptOptions().window, lineage: "all" });
  expect(summary.ok && summary.value.tokens?.total.sum).toBe(140n + 4n + 205n + 7n + 13n);
  const child = result.value.report.facts.find(fact => fact.owner.lineage === "child")!;
  expect(child.owner.parentExecutionId).toBe(result.value.report.facts.find(fact => fact.owner.lineage === "root")!.owner.executionId);
});

test("codex transcripts carry slot identities, context limits, unknown outcomes and parent threads", async () => {
  const parent = await richFactsFromCodexTranscript(transcriptFixture("rich-codex-transcript-v1.jsonl"), transcriptOptions());
  const child = await richFactsFromCodexTranscript(transcriptFixture("rich-codex-transcript-child-v1.jsonl"), transcriptOptions());
  expect(parent.ok && child.ok).toBe(true);
  if (!parent.ok || !child.ok) return;
  expect(parent.value.report.facts.map(fact => fact.kind)).toEqual(["request", "context", "request", "context", "tool", "tool"]);
  expect(parent.value.report.facts[0]!.owner.lineage).toBe("root");
  expect(parent.value.report.facts[0]!.value).toMatchObject({ outcome: "unknown", requestedAtMs: null, terminalAtMs: START + 12_000 });
  expect(parent.value.report.facts[1]!.value).toMatchObject({ tokens: "1200", limitTokens: "272000" });
  expect(parent.value.report.facts[0]!.id).not.toBe(parent.value.report.facts[2]!.id);
  expect(parent.value.report.facts[5]!.value).toMatchObject({ stage: "terminal", outcome: "unknown" });
  expect(parent.value.report.coverage.usage).toBe("unsupported");
  expect(parent.value.measured).toEqual({ skippedRecords: 1, linesRead: 11 });
  expect(child.value.report.facts[0]!.owner).toMatchObject({ lineage: "child", parentExecutionId: parent.value.report.facts[0]!.owner.executionId, conversationId: parent.value.report.facts[0]!.owner.conversationId });
  const unknown = await richFactsFromCodexTranscript([
    JSON.stringify({ timestamp: "2026-01-01T00:00:10Z", type: "session_meta", payload: { id: "s1", source: "unknown_origin" } }),
    JSON.stringify({ timestamp: "2026-01-01T00:00:11Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 5 } } } }),
  ].join("\n"), transcriptOptions());
  expect(unknown.ok && unknown.value.report.facts[0]!.owner.lineage).toBe("unknown");
});

test("transcript adapters refuse conflicting owners, duplicate scans, identity changes and bad sources", async () => {
  const claude = transcriptFixture("rich-claude-transcript-v1.jsonl");
  expect(await richFactsFromTranscripts([{ provider: "claude_code", text: claude }, { provider: "claude_code", text: claude }], transcriptOptions())).toEqual({ ok: false, error: "conflicting_fact" });
  const orphan = [JSON.stringify({ timestamp: "2026-01-01T00:00:10Z", type: "session_meta", payload: { id: "s1", source: "cli" } }),
    JSON.stringify({ timestamp: "2026-01-01T00:00:11Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 5 } } } })].join("\n");
  const child = [JSON.stringify({ timestamp: "2026-01-01T00:00:10Z", type: "session_meta", payload: { id: "s1", parent_thread_id: "p" } }),
    JSON.stringify({ timestamp: "2026-01-01T00:00:12Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 5 } } } })].join("\n");
  expect(await richFactsFromTranscripts([{ provider: "codex", text: orphan }, { provider: "codex", text: child }], transcriptOptions())).toEqual({ ok: false, error: "conflicting_owner" });
  const changed = [JSON.stringify({ timestamp: "2026-01-01T00:00:10Z", type: "session_meta", payload: { id: "s1", source: "cli" } }),
    JSON.stringify({ timestamp: "2026-01-01T00:00:10Z", type: "session_meta", payload: { id: "s2", source: "cli" } })].join("\n");
  expect(await richFactsFromCodexTranscript(changed, transcriptOptions())).toEqual({ ok: false, error: "invalid_rich_facts" });
  expect(await richFactsFromClaudeTranscript("{not json", transcriptOptions())).toEqual({ ok: false, error: "invalid_rich_facts" });
  expect(await richFactsFromTranscripts([{ provider: "devin" as never, text: "" }], transcriptOptions())).toEqual({ ok: false, error: "invalid_rich_facts" });
  expect(await richFactsFromClaudeTranscript(claude, { ...transcriptOptions(), key: new Uint8Array(32) })).toEqual({ ok: false, error: "invalid_rich_facts" });
  const narrow = await richFactsFromClaudeTranscript(claude, { ...transcriptOptions(), window: { startMs: START + 4_000, endMs: START + 5_000 } });
  expect(narrow.ok && narrow.value.report.facts.map(fact => [fact.kind, fact.atMs])).toEqual([["tool", START + 4_000]]);
});

test("stale prompts beyond one window span are not requested timestamps", async () => {
  const source = [JSON.stringify({ type: "user", timestamp: "2025-11-01T00:00:00Z", uuid: "u1", sessionId: "s", message: { role: "user", content: "x" } }),
    JSON.stringify({ type: "assistant", timestamp: "2026-01-01T00:00:02Z", uuid: "a1", parentUuid: "u1", requestId: "r", sessionId: "s", message: { id: "m", model: "claude-sonnet-4-6", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } } })].join("\n");
  const result = await richFactsFromClaudeTranscript(source, transcriptOptions());
  expect(result.ok && result.value.report.facts[0]!.value).toMatchObject({ requestedAtMs: null, terminalAtMs: START + 2_000 });
});
