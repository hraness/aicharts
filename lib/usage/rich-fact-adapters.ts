import { err, ok, type Result } from "../result";
import { parseSessionReport } from "./sessions";
import { parseTerminalTurn } from "./turns";
import { parseCompactionEvent } from "./compaction";
import {
  RICH_FACT_KINDS, RICH_FACT_MAX_RECORDS, RICH_FACT_PROFILE,
  type RichFact, type RichFactError, type RichFactReport, type RichOwner, type RichPayload,
  type RichProvenance, type RichWindow,
} from "./rich-fact-contract";
import { parseRichFactReport } from "./rich-facts";

export type RichAdapterOptions = Readonly<{
  key: Uint8Array;
  /** Explicit local source generation; it is keyed before leaving this adapter. */
  sourceEpoch: string;
  window: RichWindow;
}>;
type Adapter = Awaited<ReturnType<typeof adapter>>;

async function adapter(profile: RichProvenance["profile"], options: RichAdapterOptions) {
  if (options === null || typeof options !== "object" || Object.getPrototypeOf(options) !== Object.prototype || Reflect.ownKeys(options).length !== 3) throw new Error("invalid_rich_facts");
  const copied: Record<string, unknown> = {};
  for (const name of ["key", "sourceEpoch", "window"]) {
    const descriptor = Object.getOwnPropertyDescriptor(options, name);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error("invalid_rich_facts");
    copied[name] = descriptor.value;
  }
  if (copied.window === null || typeof copied.window !== "object" || Object.getPrototypeOf(copied.window) !== Object.prototype || Reflect.ownKeys(copied.window).length !== 2) throw new Error("invalid_rich_facts");
  const start = Object.getOwnPropertyDescriptor(copied.window, "startMs"), end = Object.getOwnPropertyDescriptor(copied.window, "endMs");
  if (!start || !("value" in start) || !start.enumerable || !end || !("value" in end) || !end.enumerable) throw new Error("invalid_rich_facts");
  const retainedWindow = { startMs: start.value as number, endMs: end.value as number };
  const key = copied.key, sourceEpoch = copied.sourceEpoch;
  if (!(key instanceof Uint8Array) || Object.getPrototypeOf(key) !== Uint8Array.prototype
    || key.length !== 32 || Reflect.ownKeys(key).length !== 32 || !(key.buffer instanceof ArrayBuffer)
    || key.every(byte => byte === 0) || typeof sourceEpoch !== "string"
    || !/^[A-Za-z0-9_-]{1,128}$/.test(sourceEpoch)) throw new Error("invalid_rich_facts");
  const cryptoKey = await crypto.subtle.importKey("raw", Uint8Array.from(key).buffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const keyed = async (domain: string, values: readonly (string | number)[]) => {
    const data = new TextEncoder().encode(JSON.stringify(["aicharts-rich-facts-v1", profile, sourceEpoch, domain, ...values]));
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
    return Array.from(digest.slice(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
  };
  const provenance: RichProvenance = { profile, version: 1, sourceId: await keyed("source", []) };
  const facts: RichFact[] = [];
  const coverage: Record<RichFact["kind"], "unsupported" | "partial" | "complete"> = Object.fromEntries(RICH_FACT_KINDS.map(kind => [kind, "unsupported"])) as Record<RichFact["kind"], "unsupported">;
  const inWindow = (atMs: number) => atMs >= retainedWindow.startMs && atMs < retainedWindow.endMs;
  const put = async (owned: RichOwner, native: string | number, atMs: number, payload: RichPayload) => {
    if (!inWindow(atMs)) return;
    facts.push({ id: await keyed("fact", [owned.provider, owned.executionId, payload.kind, native]), revision: 0,
      provenance, owner: owned, kind: payload.kind, atMs, value: payload });
    if (facts.length > RICH_FACT_MAX_RECORDS) throw new Error("record_limit");
  };
  const finish = (): Result<RichFactReport, RichFactError> => parseRichFactReport({ schemaVersion: 1, profile: RICH_FACT_PROFILE, provenance, window: retainedWindow, coverage, facts });
  // Validate the caller's retention window before doing source work.
  const empty = finish();
  if (!empty.ok) throw new Error(empty.error);
  return { keyed, facts, coverage, inWindow, put, finish };
}
const failure = (cause: unknown): Result<never, RichFactError> => err(cause instanceof Error && cause.message === "record_limit" ? "record_limit" : "invalid_rich_facts");
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
function fixedArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error("invalid_rich_facts");
  const length: unknown = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (typeof length !== "number" || !Number.isInteger(length) || length > RICH_FACT_MAX_RECORDS || Reflect.ownKeys(value).length !== length + 1) throw new Error("record_limit");
  return Array.from({ length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error("invalid_rich_facts");
    return descriptor.value as unknown;
  });
}
async function sessionOwner(a: Adapter, provider: RichOwner["provider"], sessionId: string, conversationId: string | null): Promise<RichOwner> {
  return { provider, accountId: null, executionId: await a.keyed("execution", [provider, sessionId]),
    conversationId: conversationId === null ? null : await a.keyed("conversation", [provider, conversationId]),
    lineage: "unknown", parentExecutionId: null };
}

/** Session v1 has neither request grain nor lineage nor a qualified clock uncertainty. */
export async function richFactsFromSessions(input: unknown, options: RichAdapterOptions): Promise<Result<RichFactReport, RichFactError>> {
  try {
    const report = parseSessionReport(input);
    if (!report) return err("invalid_rich_facts");
    const a = await adapter("session-observations-v1", options);
    a.coverage.usage = "partial";
    a.coverage.span = report.sessions.some(session => session.source === "instrumented") ? "partial" : "unsupported";
    for (const session of report.sessions) {
      const owned = await sessionOwner(a, session.provider, session.sessionId, session.conversationId);
      for (const usage of session.usage) {
        if (!a.inWindow(usage.atMs)) continue;
        await a.put(owned, usage.id, usage.atMs, { kind: "usage", grain: "usage_observation", tokenScope: "unknown",
          observationId: await a.keyed("observation", [session.provider, session.sessionId, usage.id]), model: usage.model, modelBasis: usage.modelBasis,
          tokens: { inputUncached: String(usage.inputTokens), cacheRead: String(usage.cacheReadTokens), cacheWrite5m: "0", cacheWrite1h: "0",
            cacheWriteUnknown: String(usage.cacheWriteTokens), output: String(usage.outputTokens), reasoning: usage.reasoningTokens === null ? null : String(usage.reasoningTokens) } });
      }
      for (const span of session.spans) {
        if (!a.inWindow(span.endMs)) continue;
        await a.put(owned, span.id, span.endMs, { kind: "span", observationId: await a.keyed("observation", [session.provider, session.sessionId, span.id]),
          phase: span.kind, basis: span.basis, startMs: span.startMs, endMs: span.endMs, clockUncertaintyMs: null });
      }
    }
    return a.finish();
  } catch (cause) { return failure(cause); }
}

/** TerminalTurn is an already qualified direct-turn contract, not a raw CLI subtotal. */
export async function richFactsFromTerminalTurns(input: unknown, options: RichAdapterOptions): Promise<Result<RichFactReport, RichFactError>> {
  try {
    // Own every candidate before importKey or any earlier record's asynchronous hash.
    const turns = fixedArray(input).map(candidate => {
      const end: unknown = candidate !== null && typeof candidate === "object" ? Object.getOwnPropertyDescriptor(candidate, "endedAtMs")?.value : undefined;
      if (typeof end !== "number" || !Number.isSafeInteger(end) || end < 0) throw new Error("invalid_rich_facts");
      const turn = parseTerminalTurn(candidate, Math.floor(end / 86_400_000));
      if (!turn) throw new Error("invalid_rich_facts");
      return turn;
    });
    const a = await adapter("terminal-turns-v1", options);
    a.coverage.turn = "partial"; a.coverage.usage = "partial";
    for (const turn of turns) {
      const end = turn.endedAtMs;
      if (!a.inWindow(end)) continue;
      const provider = turn.provider === 1 ? "codex" : "claude_code";
      const owned: RichOwner = { provider,
        accountId: turn.accountId.every(byte => byte === 0) ? null : await a.keyed("account", [provider, hex(turn.accountId)]),
        executionId: await a.keyed("execution", [provider, hex(turn.executionId)]), conversationId: null,
        lineage: turn.lineage === 1 ? "root" : turn.lineage === 2 ? "child" : "unknown", parentExecutionId: null };
      const native = hex(turn.id), observationId = await a.keyed("observation", [provider, hex(turn.executionId), native]);
      await a.put(owned, native, end, { kind: "turn", observationId, origin: turn.origin === 1 ? "human" : turn.origin === 2 ? "automation" : "unknown",
        outcome: turn.outcome === 1 ? "completed" : "aborted", startedAtMs: turn.startedAtMs, endedAtMs: end, clockUncertaintyMs: turn.clockUncertaintyMs, toolCalls: turn.toolCalls });
      if (turn.tokens !== null) await a.put(owned, native, end, { kind: "usage", grain: "turn", tokenScope: "direct", observationId, model: null, modelBasis: "unknown",
        tokens: { inputUncached: String(turn.tokens.inputUncached), cacheRead: String(turn.tokens.cacheRead), cacheWrite5m: String(turn.tokens.cacheWrite5m),
          cacheWrite1h: String(turn.tokens.cacheWrite1h), cacheWriteUnknown: "0", output: String(turn.tokens.output), reasoning: null } });
    }
    return a.finish();
  } catch (cause) { return failure(cause); }
}

/** Stable positions are required: equal-valued events can be distinct real compactions. */
export async function richFactsFromCompactions(input: unknown, options: RichAdapterOptions): Promise<Result<RichFactReport, RichFactError>> {
  try {
    const events = fixedArray(input).map(candidate => {
      if (candidate === null || typeof candidate !== "object" || Object.getPrototypeOf(candidate) !== Object.prototype || Reflect.ownKeys(candidate).length !== 2) throw new Error("invalid_rich_facts");
      const position = Object.getOwnPropertyDescriptor(candidate, "position"), value = Object.getOwnPropertyDescriptor(candidate, "event");
      if (!position || !("value" in position) || !position.enumerable || !value || !("value" in value) || !value.enumerable
        || !Number.isSafeInteger(position.value) || position.value < 0 || Object.is(position.value, -0)) throw new Error("invalid_rich_facts");
      const event = parseCompactionEvent(value.value);
      if (!event) throw new Error("invalid_rich_facts");
      return { position: position.value as number, event };
    });
    const a = await adapter("compaction-events-v1", options);
    a.coverage.compaction = "partial";
    for (const { position, event } of events) {
      const atMs = event.atSec * 1_000;
      if (!a.inWindow(atMs)) continue;
      const owned = await sessionOwner(a, event.provider, event.sessionId, null);
      await a.put(owned, position, atMs, { kind: "compaction", observationId: await a.keyed("position", [position]),
        action: event.action, outcome: event.outcome, beforeTokens: String(event.contextTokensBefore), afterTokens: String(event.contextTokensAfter), durationMs: event.durationMs });
    }
    return a.finish();
  } catch (cause) { return failure(cause); }
}

// ---- Native transcripts (mirror of crates/aicharts-core/src/rich_facts/transcript.rs) ----
// Only bounded identifiers, timestamps, counters and enumerated stop/error flags are
// read; prompts, tool arguments, results and paths never leave the parsed line.
// Streaming timings, dispatch clocks and retry links are absent from these
// transcripts and are exported as explicit nulls, never fabricated.

export const RICH_TRANSCRIPT_PROFILE = "numeric-producer-v1";
export const RICH_TRANSCRIPT_MAX_LINES = 100_000;
const TRANSCRIPT_MAX_EXECUTIONS = 2_000, TRANSCRIPT_MAX_LINE_BYTES = 1_048_576, TRANSCRIPT_MAX_TOKENS = 1_000_000_000_000;
const TRANSCRIPT_MAX_TIME_MS = 8_640_000_000_000_000, TRANSCRIPT_MAX_WINDOW_MS = 31 * 86_400_000, TRANSCRIPT_MAX_BLOCKS = 4_096;
/** Mirror of the Rust CLAUDE_MODELS allowlist. */
const TRANSCRIPT_CLAUDE_MODELS = ["claude-opus-4-1-20250805", "claude-opus-4-5-20251101", "claude-opus-4-6", "claude-opus-4-7",
  "claude-sonnet-4-20250514", "claude-sonnet-4-5-20250929", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"] as const;
type ClaudeModel = typeof TRANSCRIPT_CLAUDE_MODELS[number];
export type TranscriptProvider = "claude_code" | "codex";
export type TranscriptSource = Readonly<{ provider: TranscriptProvider; text: string }>;
/** Per-kind evidence beside the report: how many candidate records were skipped and how many lines were read. */
export type TranscriptMeasured = Readonly<{ skippedRecords: number; linesRead: number }>;

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const field = (value: unknown, name: string): unknown => value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[name] : undefined;
const nativeId = (value: unknown): string | null => typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/u.test(value) ? value : null;
const text = (value: unknown, max: number): string | null => typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).length <= max ? value : null;
const count = (value: unknown): number | null => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= TRANSCRIPT_MAX_TOKENS ? value : null;
const flag = (value: unknown): boolean | null => typeof value === "boolean" ? value : null;
const millis = (value: unknown): number | null => {
  if (typeof value !== "string" || value.length > 64 || !RFC3339.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= TRANSCRIPT_MAX_TIME_MS ? parsed : null;
};
/** `undefined`/`null` → missing; plain object → value; anything else → invalid. */
const object = (value: unknown): { state: "missing" } | { state: "invalid" } | { state: "value"; value: Record<string, unknown> } =>
  value === undefined || value === null ? { state: "missing" } : typeof value === "object" && !Array.isArray(value) ? { state: "value", value: value as Record<string, unknown> } : { state: "invalid" };
const blocks = (value: unknown): readonly unknown[] | null => Array.isArray(value) && value.length <= TRANSCRIPT_MAX_BLOCKS ? value : null;
const stop = (value: unknown): "success" | "refusal" | null =>
  value === "end_turn" || value === "tool_use" || value === "max_tokens" || value === "stop_sequence" || value === "pause_turn" ? "success" : value === "refusal" ? "refusal" : null;
const text32 = (value: unknown) => text(value, 32);
const claudeModel = (value: unknown): ClaudeModel | null => TRANSCRIPT_CLAUDE_MODELS.find(model => model === value) ?? null;

type ClaudeTokens = Readonly<{ input: number; cacheRead: number; cacheWrite: number; write5m: number | null; write1h: number | null; output: number }>;
type RequestState = { owner: RichOwner; session: string; firstParent: string | null; firstAt: number; lastAt: number; messageId: string | null;
  tokens: ClaudeTokens | null; model: ClaudeModel | null; stop: "success" | "refusal" | null; error: boolean };
type Producer = Adapter & { owners: Map<string, RichOwner>; measured: { skippedRecords: number; linesRead: number }; supported: Set<RichFact["kind"]> };

function* transcriptLines(jsonl: string, measured: { skippedRecords: number; linesRead: number }): Generator<Record<string, unknown>> {
  let lines = 0;
  for (const raw of jsonl.split("\n")) {
    if (raw.trim().length === 0) continue;
    if (new TextEncoder().encode(raw).length > TRANSCRIPT_MAX_LINE_BYTES) { measured.skippedRecords += 1; continue; }
    if (++lines > RICH_TRANSCRIPT_MAX_LINES) throw new Error("record_limit");
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error("invalid_rich_facts"); }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_rich_facts");
    yield parsed as Record<string, unknown>;
  }
  measured.linesRead += lines;
}
async function transcriptOwner(p: Producer, provider: TranscriptProvider, session: string, child: string | null, parent: string | null, rootCapable: boolean): Promise<RichOwner> {
  const root = await p.keyed("execution", [provider, session]);
  const owned: RichOwner = child !== null
    ? { provider, accountId: null, executionId: await p.keyed("execution", [provider, session, child]), conversationId: await p.keyed("conversation", [provider, session]), lineage: "child", parentExecutionId: root }
    : parent !== null
      ? { provider, accountId: null, executionId: root, conversationId: await p.keyed("conversation", [provider, parent]), lineage: "child", parentExecutionId: await p.keyed("execution", [provider, parent]) }
      : { provider, accountId: null, executionId: root, conversationId: await p.keyed("conversation", [provider, session]), lineage: rootCapable ? "root" : "unknown", parentExecutionId: null };
  const existing = p.owners.get(owned.executionId);
  if (existing) { if (JSON.stringify(existing) !== JSON.stringify(owned)) throw new Error("conflicting_owner"); }
  else { if (p.owners.size >= TRANSCRIPT_MAX_EXECUTIONS) throw new Error("record_limit"); p.owners.set(owned.executionId, owned); }
  return owned;
}
async function transcriptTool(p: Producer, owned: RichOwner, session: string, native: string, stage: "requested" | "terminal", outcome: "unknown" | "success" | "error", atMs: number) {
  await p.put(owned, `${native}:${stage}`, atMs, { kind: "tool", observationId: await p.keyed("observation", [owned.provider, session, "tool", native, stage]), stage, outcome });
}
async function scanClaude(p: Producer, jsonl: string) {
  for (const kind of ["usage", "request", "tool", "context"] as const) p.supported.add(kind);
  const users = new Map<string, number>(), requests = new Map<string, RequestState>();
  for (const line of transcriptLines(jsonl, p.measured)) {
    const kind = text32(line.type);
    if (kind !== "user" && kind !== "assistant") continue;
    const at = millis(line.timestamp), session = nativeId(line.sessionId);
    if (at === null || session === null) { p.measured.skippedRecords += 1; continue; }
    const agent = nativeId(line.agentId), child = agent ?? (flag(line.isSidechain) === true ? "sidechain" : null);
    const owned = await transcriptOwner(p, "claude_code", session, child, null, true);
    const message = object(line.message);
    if (message.state === "invalid") { p.measured.skippedRecords += 1; continue; }
    const body = message.state === "value" ? message.value : null;
    if (kind === "user") {
      const uuid = nativeId(line.uuid);
      if (uuid !== null && users.size < RICH_FACT_MAX_RECORDS && !users.has(uuid)) users.set(uuid, at);
      for (const block of (body ? blocks(body.content) : null) ?? []) {
        if (text32(field(block, "type")) !== "tool_result") continue;
        const id = nativeId(field(block, "tool_use_id"));
        if (id === null) { p.measured.skippedRecords += 1; continue; }
        await transcriptTool(p, owned, session, id, "terminal", flag(field(block, "is_error")) === true ? "error" : "success", at);
      }
      continue;
    }
    if (!body) { p.measured.skippedRecords += 1; continue; }
    for (const block of blocks(body.content) ?? []) {
      if (text32(field(block, "type")) !== "tool_use") continue;
      const id = nativeId(field(block, "id"));
      if (id === null) { p.measured.skippedRecords += 1; continue; }
      await transcriptTool(p, owned, session, id, "requested", "unknown", at);
    }
    const request = nativeId(line.requestId);
    if (request === null) { p.measured.skippedRecords += 1; continue; }
    const usage = object(body.usage), input = usage.state === "value" ? count(usage.value.input_tokens) : null, output = usage.state === "value" ? count(usage.value.output_tokens) : null;
    let tokens: ClaudeTokens | null = null;
    if (usage.state === "value" && input !== null && output !== null) {
      const creation = object(usage.value.cache_creation);
      tokens = { input, output, cacheRead: count(usage.value.cache_read_input_tokens) ?? 0, cacheWrite: count(usage.value.cache_creation_input_tokens) ?? 0,
        write5m: creation.state === "value" ? count(creation.value.ephemeral_5m_input_tokens) : null, write1h: creation.state === "value" ? count(creation.value.ephemeral_1h_input_tokens) : null };
    }
    let state = requests.get(request);
    if (!state) {
      if (requests.size >= RICH_FACT_MAX_RECORDS) throw new Error("record_limit");
      state = { owner: owned, session, firstParent: nativeId(line.parentUuid), firstAt: at, lastAt: at, messageId: null, tokens: null, model: null, stop: null, error: false };
      requests.set(request, state);
    }
    if (JSON.stringify(state.owner) !== JSON.stringify(owned)) throw new Error("conflicting_owner");
    state.firstAt = Math.min(state.firstAt, at);
    if (at >= state.lastAt) { state.lastAt = at; if (tokens !== null) state.tokens = tokens; }
    state.messageId ??= nativeId(body.id);
    state.model ??= claudeModel(body.model);
    state.stop = stop(body.stop_reason) ?? state.stop;
    state.error ||= flag(line.isApiErrorMessage) === true;
  }
  const responses = new Set<string>();
  for (const [request, state] of requests) {
    const owned = state.owner, prompt = state.firstParent === null ? undefined : users.get(state.firstParent);
    const requestedAtMs = prompt !== undefined && prompt <= state.lastAt && state.lastAt - prompt <= TRANSCRIPT_MAX_WINDOW_MS ? prompt : null;
    const outcome = state.error ? "error" : state.stop ?? "unknown";
    const observationId = await p.keyed("observation", [owned.provider, state.session, "request", request]);
    await p.put(owned, request, state.lastAt, { kind: "request", observationId, stage: "terminal", outcome, requestedAtMs, dispatchedAtMs: null, terminalAtMs: state.lastAt,
      firstTokenAtMs: null, lastTokenAtMs: null, clockUncertaintyMs: null, retryOf: null });
    const tokens = state.tokens;
    if (tokens === null) { p.measured.skippedRecords += 1; continue; }
    const split = tokens.write5m !== null && tokens.write1h !== null && tokens.write5m + tokens.write1h === tokens.cacheWrite;
    const usage = (grain: "request" | "response", id: string): RichPayload => ({ kind: "usage", grain, tokenScope: "direct", observationId: id, model: state.model, modelBasis: state.model === null ? "unknown" : "response",
      tokens: { inputUncached: String(tokens.input), cacheRead: String(tokens.cacheRead), cacheWrite5m: String(split ? tokens.write5m : 0), cacheWrite1h: String(split ? tokens.write1h : 0),
        cacheWriteUnknown: String(split ? 0 : tokens.cacheWrite), output: String(tokens.output), reasoning: null } });
    await p.put(owned, `${request}:request`, state.lastAt, usage("request", observationId));
    if (state.messageId !== null && !responses.has(state.messageId)) {
      responses.add(state.messageId);
      await p.put(owned, `${state.messageId}:response`, state.lastAt, usage("response", await p.keyed("observation", [owned.provider, state.session, "response", state.messageId])));
    }
    await p.put(owned, `${request}:context`, state.lastAt, { kind: "context", observationId: await p.keyed("observation", [owned.provider, state.session, "context", request]),
      tokens: String(tokens.input + tokens.cacheRead + tokens.cacheWrite), limitTokens: null });
  }
}
async function scanCodex(p: Producer, jsonl: string) {
  for (const kind of ["request", "tool", "context"] as const) p.supported.add(kind);
  let session: { id: string; parent: string | null; rootCapable: boolean } | null = null;
  const sameInstant = new Map<number, number>();
  for (const line of transcriptLines(jsonl, p.measured)) {
    const kind = text32(line.type), payload = object(line.payload);
    if (payload.state !== "value") continue;
    const payloadKind = text32(payload.value.type);
    if (kind === "session_meta") {
      const id = nativeId(payload.value.id);
      if (id === null) { p.measured.skippedRecords += 1; continue; }
      if (session !== null && session.id !== id) throw new Error("session_identity_changed");
      const source = text(payload.value.source, 16);
      session = { id, parent: nativeId(payload.value.parent_thread_id), rootCapable: source === "cli" || source === "vscode" || source === "exec" || source === "mcp" };
      continue;
    }
    if (session === null) { p.measured.skippedRecords += 1; continue; }
    const at = millis(line.timestamp);
    if (at === null) { if (kind === "event_msg" || kind === "response_item") p.measured.skippedRecords += 1; continue; }
    const owned = await transcriptOwner(p, "codex", session.id, null, session.parent, session.rootCapable);
    if (kind === "event_msg" && payloadKind === "token_count") {
      const info = object(payload.value.info), last = info.state === "value" ? object(info.value.last_token_usage) : null, input = last?.state === "value" ? count(last.value.input_tokens) : null;
      if (info.state !== "value" || last?.state !== "value" || input === null) { p.measured.skippedRecords += 1; continue; }
      const slot = sameInstant.get(at) ?? 0, native = `${at}:${slot}`;
      sameInstant.set(at, slot + 1);
      await p.put(owned, native, at, { kind: "request", observationId: await p.keyed("observation", [owned.provider, session.id, "request", native]), stage: "terminal", outcome: "unknown",
        requestedAtMs: null, dispatchedAtMs: null, terminalAtMs: at, firstTokenAtMs: null, lastTokenAtMs: null, clockUncertaintyMs: null, retryOf: null });
      const limit = count(info.value.model_context_window);
      await p.put(owned, `${native}:context`, at, { kind: "context", observationId: await p.keyed("observation", [owned.provider, session.id, "context", native]), tokens: String(input), limitTokens: limit === null ? null : String(limit) });
    } else if (kind === "response_item" && (payloadKind === "function_call" || payloadKind === "custom_tool_call" || payloadKind === "local_shell_call")) {
      const call = nativeId(payload.value.call_id);
      if (call === null) { p.measured.skippedRecords += 1; continue; }
      await transcriptTool(p, owned, session.id, call, "requested", "unknown", at);
    } else if (kind === "response_item" && (payloadKind === "function_call_output" || payloadKind === "custom_tool_call_output")) {
      const call = nativeId(payload.value.call_id);
      if (call === null) { p.measured.skippedRecords += 1; continue; }
      // Codex outputs carry no status field; success is not inferred.
      await transcriptTool(p, owned, session.id, call, "terminal", "unknown", at);
    }
  }
}

/** Facts from explicit Claude Code and Codex JSONL transcripts; every fact is revision zero. */
export async function richFactsFromTranscripts(sources: readonly TranscriptSource[], options: RichAdapterOptions): Promise<Result<{ report: RichFactReport; measured: TranscriptMeasured }, RichFactError>> {
  try {
    if (!Array.isArray(sources) || sources.length > TRANSCRIPT_MAX_EXECUTIONS) throw new Error("record_limit");
    const owned = sources.map(source => {
      const provider: unknown = field(source, "provider"), text: unknown = field(source, "text");
      if ((provider !== "claude_code" && provider !== "codex") || typeof text !== "string") throw new Error("invalid_rich_facts");
      return { provider, text };
    });
    const a = await adapter(RICH_TRANSCRIPT_PROFILE, options);
    const p: Producer = { ...a, owners: new Map(), measured: { skippedRecords: 0, linesRead: 0 }, supported: new Set() };
    for (const source of owned) await (source.provider === "claude_code" ? scanClaude(p, source.text) : scanCodex(p, source.text));
    if (new Set(p.facts.map(fact => fact.id)).size !== p.facts.length) throw new Error("conflicting_fact");
    for (const kind of p.supported) p.coverage[kind] = "partial";
    const report = a.finish();
    return report.ok ? ok({ report: report.value, measured: { ...p.measured } }) : report;
  } catch (cause) { return transcriptFailure(cause); }
}
const transcriptFailure = (cause: unknown): Result<never, RichFactError> => {
  const message = cause instanceof Error ? cause.message : "";
  return err(message === "record_limit" || message === "conflicting_fact" || message === "conflicting_owner" ? message : "invalid_rich_facts");
};
export const richFactsFromClaudeTranscript = (text: string, options: RichAdapterOptions) => richFactsFromTranscripts([{ provider: "claude_code", text }], options);
export const richFactsFromCodexTranscript = (text: string, options: RichAdapterOptions) => richFactsFromTranscripts([{ provider: "codex", text }], options);
