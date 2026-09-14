import {
  SESSION_MODELS, SESSION_REPORT_MAX_BYTES, SESSION_REPORT_MAX_RECORDS,
  SESSION_REPORT_MAX_SESSIONS, SESSION_REPORT_PROFILE,
  type SessionObservation, type SessionReport, type SessionSpan, type SessionUsage,
} from "./session-contract";
import { parseSessionReport } from "./sessions";

const MAX_NANOS = 8_640_000_000_000_000_000_000n;
const MAX_MS = MAX_NANOS / 1_000_000n;
const encoder = new TextEncoder();
const modelSet = new Set<string>(SESSION_MODELS);
const SPAN_NAMES = new Set(["claude_code.interaction", "claude_code.tool", "claude_code.llm_request", "claude_code.tool.blocked_on_user", "claude_code.tool.execution"]);
export type TelemetryError = "invalid_traces" | "body_limit" | "record_limit" | "missing_identity" | "conflicting_span";
export const OTLP_PATH = "/v1/traces" as const;
export const OTLP_MEDIA = "application/json" as const;
function object(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(fields);
  if (keys.length > 128) return null;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== "string") return null;
    const field = fields[key]; if (!("value" in field) || !field.enumerable) return null;
    Object.defineProperty(result, key, { value: field.value as unknown, enumerable: true });
  }
  return result;
}
function text(value: unknown): string | null { return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : null; }
function attrValue(value: unknown): string | number | boolean | null {
  const row = object(value); if (!row) return null;
  if (typeof row.stringValue === "string" && row.stringValue.length <= 512) return row.stringValue;
  if (typeof row.boolValue === "boolean") return row.boolValue;
  if (typeof row.intValue === "string" && /^-?\d{1,20}$/.test(row.intValue)) { const n = Number(row.intValue); return Number.isSafeInteger(n) ? n : null; }
  if (typeof row.intValue === "number" && Number.isSafeInteger(row.intValue)) return row.intValue;
  if (typeof row.doubleValue === "number" && Number.isFinite(row.doubleValue)) return row.doubleValue;
  return null;
}
function attributes(value: unknown): Map<string, string | number | boolean> {
  const allow = new Set(["session.id", "span.type", "agent_id", "parent_agent_id", "model", "gen_ai.system", "input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens", "decision", "source", "tool_name"]);
  const out = new Map<string, string | number | boolean>(); if (!Array.isArray(value) || value.length > 128) return out;
  for (const candidate of value) {
    const row = object(candidate), key = row && text(row.key);
    if (key === null || !allow.has(key)) continue;
    const parsed = attrValue(row!.value);
    if (parsed === null || out.has(key)) throw new Error("invalid_traces");
    out.set(key, parsed);
  }
  return out;
}
function stringAttr(map: Map<string, string | number | boolean>, key: string): string | null { const value = map.get(key); return typeof value === "string" && value.length > 0 ? value : null; }
function boundedInt(map: Map<string, string | number | boolean>, key: string): number | null {
  if (!map.has(key)) return null;
  const value = map.get(key);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0) || value < 0 || value > 1e12) throw new Error("invalid_traces");
  return value;
}
/** OTLP nanoseconds exceed Number's safe integer range at current Unix times. */
function nanos(value: unknown): number | null {
  let raw: bigint;
  if (typeof value === "string" && /^\d{1,22}$/.test(value)) raw = BigInt(value);
  else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) raw = BigInt(value);
  else return null;
  if (raw < 0n || raw > MAX_NANOS) return null; const ms = raw / 1_000_000n; return ms <= MAX_MS ? Number(ms) : null;
}
function allowedModel(value: string | null): string | null { return value !== null && value.startsWith("claude-") && modelSet.has(value) ? value : null; }
async function keyed(cryptoKey: CryptoKey, domain: string, value: string): Promise<string> { const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(`aicharts-telemetry-v1\0${domain}\0${value}`)));
  return Array.from(bytes.slice(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
}
type RawSpan = { trace: string; id: string; parent: string | null; session: string; agent: string | null; name: string; start: number; end: number; attrs: Map<string, string | number | boolean> };
type SessionState = { conversation: string | null; first: number; last: number; usage: Map<string, SessionUsage>; spans: Map<string, SessionSpan> };
/** Parse only documented Claude Code OTLP span names and numeric fields. */
export async function parseOtlpTraces(value: unknown, key: Uint8Array): Promise<SessionReport> {
  if (!(key instanceof Uint8Array) || key.length !== 32 || Object.getPrototypeOf(key) !== Uint8Array.prototype || key.every(byte => byte === 0)) throw new Error("invalid_traces");
  const cryptoKey = await crypto.subtle.importKey("raw", Uint8Array.from(key).buffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const root = object(value), resources = root?.resourceSpans; if (!root || !Array.isArray(resources) || resources.length > SESSION_REPORT_MAX_SESSIONS) throw new Error("invalid_traces");
  const all: RawSpan[] = []; let records = 0;
  for (const resourceItem of resources) {
    const resource = object(resourceItem), resourceAttrs = attributes(resource?.resource && object(resource.resource)?.attributes), resourceSession = stringAttr(resourceAttrs, "session.id");
    const scopes = resource && resource.scopeSpans; if (!Array.isArray(scopes) || scopes.length > 128) throw new Error("invalid_traces");
    for (const scope of scopes) {
      const spans = object(scope)?.spans; if (!Array.isArray(spans) || spans.length > SESSION_REPORT_MAX_RECORDS) throw new Error("record_limit");
      for (const raw of spans) {
        if (++records > SESSION_REPORT_MAX_RECORDS) throw new Error("record_limit");
        const row = object(raw); if (!row) throw new Error("invalid_traces"); const name = text(row.name); if (name === null || !SPAN_NAMES.has(name)) continue;
        const attrs = attributes(row.attributes), session = stringAttr(attrs, "session.id") ?? resourceSession; if (session === null || !/^[A-Za-z0-9_-]{1,256}$/.test(session)) throw new Error("missing_identity");
        const trace = text(row.traceId), id = text(row.spanId), start = nanos(row.startTimeUnixNano), end = nanos(row.endTimeUnixNano); if (trace === null || !/^[0-9a-f]{32}$/.test(trace) || /^0+$/.test(trace) || id === null || !/^[0-9a-f]{16}$/.test(id) || /^0+$/.test(id) || start === null || end === null || end < start || end - start > 366 * 86_400_000) throw new Error("invalid_traces");
        if (row.parentSpanId !== undefined && typeof row.parentSpanId !== "string") throw new Error("invalid_traces");
        const parent = row.parentSpanId === undefined || row.parentSpanId === "" || row.parentSpanId === "0000000000000000" ? null : text(row.parentSpanId);
        if (parent !== null && !/^[0-9a-f]{16}$/.test(parent)) throw new Error("invalid_traces");
        const agent = stringAttr(attrs, "agent_id");
        if (agent !== null && !/^[A-Za-z0-9_-]{1,256}$/.test(agent)) throw new Error("invalid_traces");
        if (attrs.has("span.type") && attrs.get("span.type") !== name) throw new Error("invalid_traces");
        all.push({ trace, id, parent, session, agent, name, start, end, attrs });
      }
    }
  }
  const identity = (span: RawSpan) => `${span.session}\0${span.trace}\0${span.id}`;
  const fingerprint = (span: RawSpan) => JSON.stringify([span.session, span.agent, span.parent, span.name, span.start, span.end,
    allowedModel(stringAttr(span.attrs, "model")), boundedInt(span.attrs, "input_tokens"), boundedInt(span.attrs, "output_tokens"),
    boundedInt(span.attrs, "cache_read_tokens"), boundedInt(span.attrs, "cache_creation_tokens"),
    stringAttr(span.attrs, "decision"), stringAttr(span.attrs, "source"), stringAttr(span.attrs, "tool_name") === "AskUserQuestion"]);
  const spanMap = new Map<string, RawSpan>();
  for (const span of all) {
    const old = spanMap.get(identity(span));
    if (old !== undefined && fingerprint(old) !== fingerprint(span)) throw new Error("conflicting_span");
    spanMap.set(identity(span), span);
  }
  const parentOf = (span: RawSpan) => span.parent === null ? undefined : spanMap.get(`${span.session}\0${span.trace}\0${span.parent}`);
  const ownActor = (span: RawSpan) => span.agent === null ? "root" : `agent:${span.agent}`;
  const actorOf = (span: RawSpan) => {
    if (span.name === "claude_code.tool.execution" || span.name === "claude_code.tool.blocked_on_user") {
      const parent = parentOf(span);
      if (parent?.name !== "claude_code.tool") return null;
      if (span.start < parent.start || span.end > parent.end) throw new Error("invalid_traces");
      if (span.agent !== null && ownActor(span) !== ownActor(parent)) throw new Error("conflicting_span");
      return ownActor(parent);
    }
    // These documented spans carry agent_id themselves. Parent spans may not
    // have finished/exported yet; their absence must not discard live requests.
    return ownActor(span);
  };
  const sessions = new Map<string, SessionState>();
  for (const span of spanMap.values()) {
    const actor = actorOf(span); if (actor === null) continue;
    const sessionId = await keyed(cryptoKey, "session", `claude_code\0${span.session}\0${actor}`), spanId = await keyed(cryptoKey, "span", `claude_code\0${span.session}\0${span.trace}\0${span.id}`);
    const input = boundedInt(span.attrs, "input_tokens"), output = boundedInt(span.attrs, "output_tokens"), cacheRead = boundedInt(span.attrs, "cache_read_tokens"), cacheWrite = boundedInt(span.attrs, "cache_creation_tokens");
    const modelName = allowedModel(stringAttr(span.attrs, "model"));
    const conversation = await keyed(cryptoKey, "conversation", `claude_code\0${span.session}`);
    const current = sessions.get(sessionId) ?? { conversation, first: span.start, last: span.end, usage: new Map(), spans: new Map() }; current.first = Math.min(current.first, span.start); current.last = Math.max(current.last, span.end);
    let kind: SessionSpan["kind"] | null = null; let basis: SessionSpan["basis"] | null = null;
    if (span.name === "claude_code.tool.execution" && parentOf(span)?.name === "claude_code.tool" && stringAttr(parentOf(span)!.attrs, "tool_name") !== "AskUserQuestion") { kind = "tool_wait"; basis = "tool_lifecycle"; }
    else if (span.name === "claude_code.tool.blocked_on_user" && parentOf(span)?.name === "claude_code.tool" && ["user_permanent", "user_temporary", "user_abort", "user_reject"].includes(stringAttr(span.attrs, "source") ?? "") && ["accept", "reject"].includes(stringAttr(span.attrs, "decision") ?? "")) { kind = "approval_wait"; basis = "human_boundary"; }
    else if (span.name === "claude_code.llm_request") { kind = "model_request"; basis = "request_lifecycle"; }
    if (kind !== null && basis !== null && span.end > span.start) current.spans.set(spanId, { id: spanId, startMs: span.start, endMs: span.end, kind, basis });
    if (span.name === "claude_code.llm_request" && input !== null && output !== null && cacheRead !== null && cacheWrite !== null) current.usage.set(spanId, { id: spanId, atMs: span.end, model: modelName, modelBasis: modelName === null ? "unknown" : "request", inputTokens: input, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, outputTokens: output, reasoningTokens: null });
    sessions.set(sessionId, current);
  }
  const reportSessions: SessionObservation[] = []; for (const [sessionId, value] of sessions) reportSessions.push({ provider: "claude_code", sessionId, conversationId: value.conversation, window: { startMs: value.first, endMs: value.last }, source: "instrumented", usage: [...value.usage.values()], spans: [...value.spans.values()] });
  const result = parseSessionReport({ schemaVersion: 1, profile: SESSION_REPORT_PROFILE, sessions: reportSessions });
  if (result === null) throw new Error("invalid_traces");
  return result;
}
export async function parseOtlpBody(body: Uint8Array, key: Uint8Array): Promise<SessionReport> { if (body.length > SESSION_REPORT_MAX_BYTES) throw new Error("body_limit"); let value: unknown; try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); } catch { throw new Error("invalid_traces"); } return parseOtlpTraces(value, key); }
/** Merge immutable sanitized reports; replay is idempotent and conflicts abort before write. */
export function mergeSessionReports(baseInput: SessionReport, incomingInput: SessionReport): SessionReport {
  const base = parseSessionReport(baseInput), incoming = parseSessionReport(incomingInput);
  if (base === null || incoming === null) throw new Error("invalid_traces");
  const sessions = new Map(base.sessions.map(session => [`${session.provider}\0${session.sessionId}`, { ...session, usage: new Map(session.usage.map(item => [item.id, item])), spans: new Map(session.spans.map(item => [item.id, item])) }]));
  for (const next of incoming.sessions) {
    const key = `${next.provider}\0${next.sessionId}`, current = sessions.get(key); if (!current) { sessions.set(key, { ...next, usage: new Map(next.usage.map(item => [item.id, item])), spans: new Map(next.spans.map(item => [item.id, item])) }); continue; }
    if (current.conversationId !== next.conversationId && current.conversationId !== null && next.conversationId !== null) throw new Error("conflicting_span");
    const usage = new Map(current.usage); for (const item of next.usage) { const old = usage.get(item.id); if (old && JSON.stringify(old) !== JSON.stringify(item)) throw new Error("conflicting_span"); usage.set(item.id, item); }
    const spans = new Map(current.spans); for (const item of next.spans) { const old = spans.get(item.id); if (old && JSON.stringify(old) !== JSON.stringify(item)) throw new Error("conflicting_span"); spans.set(item.id, item); }
    sessions.set(key, { ...current, conversationId: current.conversationId ?? next.conversationId, window: { startMs: Math.min(current.window.startMs, next.window.startMs), endMs: Math.max(current.window.endMs, next.window.endMs) }, usage, spans });
  }
  if (sessions.size > SESSION_REPORT_MAX_SESSIONS || [...sessions.values()].reduce((n, s) => n + s.usage.size + s.spans.size, 0) > SESSION_REPORT_MAX_RECORDS) throw new Error("record_limit");
  const result = parseSessionReport({ schemaVersion: 1, profile: SESSION_REPORT_PROFILE, sessions: [...sessions.values()].map(session => ({ ...session, usage: [...session.usage.values()], spans: [...session.spans.values()] })) });
  if (result === null) throw new Error("invalid_traces");
  return result;
}
