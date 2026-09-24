import { err, type Result } from "../result";
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
