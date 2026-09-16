import {
  SESSION_MODELS, SESSION_PHASES, SESSION_REPORT_MAX_BYTES, SESSION_REPORT_MAX_RECORDS,
  SESSION_REPORT_MAX_SESSIONS, SESSION_REPORT_PROFILE, type SessionObservation,
  type SessionPhase, type SessionReport, type SessionSpan, type SessionUsage, type SessionWindow,
} from "./session-contract";

const MAX_TIME = 8_640_000_000_000_000;
const MAX_WINDOW = 366 * 86_400_000;
const MAX_TOKENS = 1_000_000_000_000;
const TOKEN_FIELDS = ["inputTokens", "cacheReadTokens", "cacheWriteTokens", "outputTokens"] as const;
const BASIS = { inference: "stream_lifecycle", reply_wait: "human_boundary", approval_wait: "human_boundary", tool_wait: "tool_lifecycle", model_request: "request_lifecycle" } as const;
const integer = (v: unknown, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= 0 && v <= max;
const id = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{32}$/.test(v) && !/^0+$/.test(v);

function fields(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const d = descriptors[key];
    if (!d || !("value" in d) || !d.enumerable) return null;
    result[key] = d.value as unknown;
  }
  return result;
}

function array(value: unknown, limit: number): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const length: unknown = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!integer(length, limit) || Reflect.ownKeys(value).length !== length + 1) return null;
  const result: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !("value" in d) || !d.enumerable) return null;
    result.push(d.value as unknown);
  }
  return result;
}

/** Copies only the fixed numeric schema; invalid input never echoes a value. */
export function parseSessionReport(value: unknown): SessionReport | null {
  try {
    const root = fields(value, ["schemaVersion", "profile", "sessions"]);
    if (!root || root.schemaVersion !== 1 || root.profile !== SESSION_REPORT_PROFILE) return null;
    const records = array(root.sessions, SESSION_REPORT_MAX_SESSIONS);
    if (!records) return null;
    const sessions: SessionObservation[] = [], sessionIds = new Set<string>(), occurrenceIds = new Set<string>();
    let count = 0;
    for (const record of records) {
      const s = fields(record, ["provider", "sessionId", "conversationId", "window", "source", "usage", "spans"]);
      if (!s || (s.provider !== "codex" && s.provider !== "claude_code" && s.provider !== "devin") || !id(s.sessionId)
        || (s.conversationId !== null && !id(s.conversationId)) || (s.source !== "history" && s.source !== "instrumented")) return null;
      const key = `${s.provider}:${s.sessionId}`;
      if (sessionIds.has(key)) return null;
      sessionIds.add(key);
      const w = fields(s.window, ["startMs", "endMs"]);
      if (!w || !integer(w.startMs, MAX_TIME) || !integer(w.endMs, MAX_TIME) || w.endMs < w.startMs || w.endMs - w.startMs > MAX_WINDOW) return null;
      const usages = array(s.usage, SESSION_REPORT_MAX_RECORDS), spans = array(s.spans, SESSION_REPORT_MAX_RECORDS);
      if (!usages || !spans || (s.source === "history" && spans.length > 0)) return null;
      count += usages.length + spans.length;
      if (count > SESSION_REPORT_MAX_RECORDS) return null;
      const usage: SessionUsage[] = [], ownedSpans: SessionSpan[] = [];
      for (const candidate of usages) {
        const u = fields(candidate, ["id", "atMs", "model", "modelBasis", ...TOKEN_FIELDS, "reasoningTokens"]);
        if (!u || !id(u.id) || !integer(u.atMs, w.endMs) || u.atMs < w.startMs
          || (u.model !== null && (typeof u.model !== "string" || !SESSION_MODELS.some(model => model === u.model)))
          || (u.model === null ? u.modelBasis !== "unknown" : u.modelBasis !== "response" && u.modelBasis !== "request")
          || TOKEN_FIELDS.some(k => !integer(u[k], MAX_TOKENS))
          || (u.reasoningTokens !== null && !integer(u.reasoningTokens, u.outputTokens as number))) return null;
        if (u.model !== null && (s.provider === "codex" ? !(u.model as string).startsWith("gpt-")
          : s.provider === "claude_code" ? !(u.model as string).startsWith("claude-") : true)) return null;
        const identity = `${s.provider}:usage:${u.id}`;
        if (occurrenceIds.has(identity)) return null;
        occurrenceIds.add(identity);
        usage.push(u as SessionUsage);
      }
      for (const candidate of spans) {
        const span = fields(candidate, ["id", "startMs", "endMs", "kind", "basis"]);
        if (!span || !id(span.id) || !integer(span.startMs, w.endMs) || !integer(span.endMs, w.endMs)
          || span.startMs < w.startMs || span.endMs <= span.startMs || typeof span.kind !== "string"
          || !Object.hasOwn(BASIS, span.kind) || span.basis !== BASIS[span.kind as keyof typeof BASIS]) return null;
        const identity = `${s.provider}:span:${span.id}`;
        if (occurrenceIds.has(identity)) return null;
        occurrenceIds.add(identity);
        ownedSpans.push(span as SessionSpan);
      }
      sessions.push({ provider: s.provider, sessionId: s.sessionId, conversationId: s.conversationId,
        source: s.source, window: w as SessionWindow, usage, spans: ownedSpans });
    }
    return { schemaVersion: 1, profile: SESSION_REPORT_PROFILE, sessions };
  } catch { return null; }
}

export function decodeSessionReport(text: string): SessionReport | null {
  if (text.length > SESSION_REPORT_MAX_BYTES || new TextEncoder().encode(text).length > SESSION_REPORT_MAX_BYTES) return null;
  try { return parseSessionReport(JSON.parse(text) as unknown); } catch { return null; }
}

export type SessionSegment = SessionWindow & Readonly<{ phase: SessionPhase }>;
export type ModelTotals = Readonly<{
  model: string | null; modelBasis: SessionUsage["modelBasis"]; records: number; accountedTokens: bigint; outputTokens: bigint;
  inputTokens: bigint; cacheReadTokens: bigint; cacheWriteTokens: bigint;
  reasoningTokens: bigint; reasoningMeasuredRecords: number;
}>;
export type SessionSummary = Readonly<{
  session: SessionObservation; windowMs: number; phaseMs: Readonly<Record<SessionPhase, number>>;
  timeline: readonly SessionSegment[]; modelRequestMs: number; models: readonly ModelTotals[];
  accountedTokens: bigint; outputTokens: bigint; records: number;
  /** Null means incomplete or zero-duration observation, never zero utilization. */
  inferencePct: number | null; observedInferencePct: number | null;
}>;

export function unionMs(windows: readonly SessionWindow[]): number {
  let end = -1, total = 0;
  for (const w of [...windows].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)) {
    total += Math.max(0, w.endMs - Math.max(end, w.startMs));
    end = Math.max(end, w.endMs);
  }
  return total;
}

const emptyPhases = (): Record<SessionPhase, number> => ({ inference: 0, reply_wait: 0, approval_wait: 0, tool_wait: 0, unknown: 0 });

/** Inference wins overlap; human waits exclude tool wait. Conflicting human waits are unknown. */
function phase(counts: Record<SessionPhase, number>): SessionPhase {
  if (counts.inference > 0) return "inference";
  if (counts.approval_wait > 0 && counts.reply_wait > 0) return "unknown";
  if (counts.approval_wait > 0) return "approval_wait";
  if (counts.reply_wait > 0) return "reply_wait";
  return counts.tool_wait > 0 ? "tool_wait" : "unknown";
}

export function summarizeSession(session: SessionObservation): SessionSummary {
  const counts = emptyPhases(), phaseMs = emptyPhases(), timeline: SessionSegment[] = [];
  const edges: { at: number; kind: SessionPhase; change: number }[] = [];
  for (const s of session.spans) if (s.kind !== "model_request") {
    edges.push({ at: s.startMs, kind: s.kind, change: 1 }, { at: s.endMs, kind: s.kind, change: -1 });
  }
  edges.sort((a, b) => a.at - b.at);
  let cursor = session.window.startMs;
  const append = (endMs: number) => {
    if (endMs <= cursor) return;
    const selected = phase(counts), previous = timeline.at(-1);
    phaseMs[selected] += endMs - cursor;
    if (previous?.phase === selected) timeline[timeline.length - 1] = { startMs: previous.startMs, endMs, phase: selected };
    else timeline.push({ startMs: cursor, endMs, phase: selected });
    cursor = endMs;
  };
  for (const edge of edges) { append(edge.at); counts[edge.kind] += edge.change; }
  append(session.window.endMs);
  const modelMap = new Map<string, ModelTotals>();
  for (const u of session.usage) {
    const modelKey = `${u.modelBasis}:${u.model}`;
    const m = modelMap.get(modelKey) ?? { model: u.model, modelBasis: u.modelBasis, records: 0, accountedTokens: 0n, outputTokens: 0n,
      inputTokens: 0n, cacheReadTokens: 0n, cacheWriteTokens: 0n, reasoningTokens: 0n, reasoningMeasuredRecords: 0 };
    modelMap.set(modelKey, { model: u.model, modelBasis: u.modelBasis, records: m.records + 1,
      accountedTokens: m.accountedTokens + TOKEN_FIELDS.reduce((sum, k) => sum + BigInt(u[k]), 0n),
      inputTokens: m.inputTokens + BigInt(u.inputTokens), cacheReadTokens: m.cacheReadTokens + BigInt(u.cacheReadTokens),
      cacheWriteTokens: m.cacheWriteTokens + BigInt(u.cacheWriteTokens), outputTokens: m.outputTokens + BigInt(u.outputTokens),
      reasoningTokens: m.reasoningTokens + BigInt(u.reasoningTokens ?? 0),
      reasoningMeasuredRecords: m.reasoningMeasuredRecords + (u.reasoningTokens === null ? 0 : 1) });
  }
  const models = [...modelMap.values()].sort((a, b) => a.accountedTokens === b.accountedTokens ? `${a.model}:${a.modelBasis}`.localeCompare(`${b.model}:${b.modelBasis}`) : a.accountedTokens > b.accountedTokens ? -1 : 1);
  const windowMs = session.window.endMs - session.window.startMs;
  const observedInferencePct = windowMs > 0 ? phaseMs.inference / windowMs * 100 : null;
  return { session, windowMs, phaseMs, timeline, models, records: session.usage.length,
    modelRequestMs: unionMs(session.spans.filter(s => s.kind === "model_request")),
    accountedTokens: models.reduce((sum, m) => sum + m.accountedTokens, 0n),
    outputTokens: models.reduce((sum, m) => sum + m.outputTokens, 0n),
    inferencePct: phaseMs.unknown === 0 ? observedInferencePct : null, observedInferencePct };
}

export function summarizeSessions(report: SessionReport) {
  const sessions = report.sessions.map(summarizeSession), phaseMs = emptyPhases();
  const modelMap = new Map<string, ModelTotals & { provider: SessionObservation["provider"] }>();
  for (const s of sessions) for (const m of s.models) {
    const key = `${s.session.provider}:${m.modelBasis}:${m.model}`;
    const old = modelMap.get(key);
    modelMap.set(key, old === undefined ? { ...m, provider: s.session.provider } : { ...old,
      records: old.records + m.records, accountedTokens: old.accountedTokens + m.accountedTokens,
      inputTokens: old.inputTokens + m.inputTokens, cacheReadTokens: old.cacheReadTokens + m.cacheReadTokens,
      cacheWriteTokens: old.cacheWriteTokens + m.cacheWriteTokens, outputTokens: old.outputTokens + m.outputTokens,
      reasoningTokens: old.reasoningTokens + m.reasoningTokens, reasoningMeasuredRecords: old.reasoningMeasuredRecords + m.reasoningMeasuredRecords });
  }
  const models = [...modelMap.values()].sort((a, b) => a.accountedTokens === b.accountedTokens ? `${a.provider}:${a.model}:${a.modelBasis}`.localeCompare(`${b.provider}:${b.model}:${b.modelBasis}`) : a.accountedTokens > b.accountedTokens ? -1 : 1);
  for (const s of sessions) for (const p of SESSION_PHASES) phaseMs[p] += s.phaseMs[p];
  const sessionMs = sessions.reduce((sum, s) => sum + s.windowMs, 0);
  const netWindowMs = unionMs(report.sessions.map(s => s.window));
  const inference = sessions.flatMap(s => s.timeline.filter(t => t.phase === "inference"));
  const netInferenceMs = unionMs(inference);
  const events = inference.flatMap(s => [{ at: s.startMs, change: 1 }, { at: s.endMs, change: -1 }]).sort((a, b) => a.at - b.at || a.change - b.change);
  let current = 0, peakInferenceConcurrency = 0;
  for (const e of events) { current += e.change; peakInferenceConcurrency = Math.max(peakInferenceConcurrency, current); }
  const unknownWindows = sessions.flatMap(s => s.timeline.filter(t => t.phase === "unknown"));
  // Unknown exposure that coincides with proven inference does not obscure net busy time.
  const netUnknownMs = unionMs([...unknownWindows, ...inference]) - netInferenceMs;
  return { sessions, models, accountedTokens: sessions.reduce((n, s) => n + s.accountedTokens, 0n),
    outputTokens: sessions.reduce((n, s) => n + s.outputTokens, 0n),
    phaseMs, sessionMs, netWindowMs, netInferenceMs, netUnknownMs, peakInferenceConcurrency,
    sessionInferencePct: sessionMs > 0 && phaseMs.unknown === 0 ? phaseMs.inference / sessionMs * 100 : null,
    observedSessionInferencePct: sessionMs > 0 ? phaseMs.inference / sessionMs * 100 : null,
    netInferencePct: netWindowMs > 0 && netUnknownMs === 0 ? netInferenceMs / netWindowMs * 100 : null,
    observedNetInferencePct: netWindowMs > 0 ? netInferenceMs / netWindowMs * 100 : null,
    meanInferenceConcurrency: netWindowMs > 0 ? phaseMs.inference / netWindowMs : null };
}
