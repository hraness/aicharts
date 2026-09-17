import { SESSION_REPORT_MAX_BYTES, type SessionObservation, type SessionReport } from "./session-contract";

/** Numeric-only gobstopper compaction telemetry (`events.jsonl`). Transcript content is never ingested. */
export const COMPACTION_EVENT_SCHEMA = "gobstopper/compaction-events-v1" as const;
export const COMPACTION_EVENTS_MAX_BYTES = SESSION_REPORT_MAX_BYTES;
export const COMPACTION_EVENTS_MAX_EVENTS = 50_000;
const MAX_UNIX_SECONDS = 8_640_000_000_000;
const MAX_WINDOW_MS = 366 * 86_400_000;
const MAX_TOKENS = 1_000_000_000_000;

export type CompactionProvider = "codex" | "claude_code";
export type CompactionAction = "provider_compact" | "transcript_compact" | "none";
export type CompactionOutcome = "applied" | "planned" | "failed" | "skipped";
export type CompactionEvent = Readonly<{
  schema: typeof COMPACTION_EVENT_SCHEMA;
  /** Unix seconds when the event was recorded. */
  atSec: number;
  provider: CompactionProvider;
  /** Native (un-normalized) provider session id, or a downstream keyed digest. */
  sessionId: string;
  strategy: string;
  action: CompactionAction;
  outcome: CompactionOutcome;
  triggerTokens: number;
  contextTokensBefore: number;
  contextTokensAfter: number;
  /** `contextTokensBefore - contextTokensAfter`, saturating at zero; enforced on parse. */
  estReclaimedTokens: number;
  itemsCovered: number;
  durationMs: number;
  errorCode: string | null;
}>;

const integer = (v: unknown, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= 0 && v <= max;
const sessionId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(v);
const label = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(v);

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

/** Copies only the fixed numeric schema; records carrying extra or foreign fields are rejected, never echoed. */
export function parseCompactionEvent(value: unknown): CompactionEvent | null {
  try {
    const e = fields(value, ["schema", "ts", "provider", "session_id", "strategy", "action", "outcome",
      "trigger_tokens", "context_tokens_before", "context_tokens_after", "est_reclaimed_tokens",
      "items_covered", "duration_ms", "error_code"]);
    if (!e || e.schema !== COMPACTION_EVENT_SCHEMA || !integer(e.ts, MAX_UNIX_SECONDS)
      || (e.provider !== "codex" && e.provider !== "claude_code") || !sessionId(e.session_id)
      || !label(e.strategy)
      || (e.action !== "provider_compact" && e.action !== "transcript_compact" && e.action !== "none")
      || (e.outcome !== "applied" && e.outcome !== "planned" && e.outcome !== "failed" && e.outcome !== "skipped")
      || !integer(e.trigger_tokens, MAX_TOKENS) || !integer(e.context_tokens_before, MAX_TOKENS)
      || !integer(e.context_tokens_after, MAX_TOKENS) || !integer(e.est_reclaimed_tokens, MAX_TOKENS)
      || !integer(e.items_covered, MAX_TOKENS) || !integer(e.duration_ms, MAX_WINDOW_MS)
      || (e.error_code !== null && !label(e.error_code))) return null;
    const before = e.context_tokens_before, after = e.context_tokens_after, est = e.est_reclaimed_tokens;
    if (!integer(before, MAX_TOKENS) || !integer(after, MAX_TOKENS) || !integer(est, MAX_TOKENS)) return null;
    if (est !== (before > after ? before - after : 0)) return null;
    return { schema: COMPACTION_EVENT_SCHEMA, atSec: e.ts, provider: e.provider, sessionId: e.session_id,
      strategy: e.strategy, action: e.action, outcome: e.outcome, triggerTokens: e.trigger_tokens,
      contextTokensBefore: before, contextTokensAfter: after, estReclaimedTokens: est,
      itemsCovered: e.items_covered, durationMs: e.duration_ms, errorCode: e.error_code };
  } catch { return null; }
}

export type CompactionEventLog = Readonly<{ events: readonly CompactionEvent[]; skippedLines: number }>;

/**
 * Decodes a `compaction-events-v1` JSONL log. Blank, torn and foreign lines are
 * skipped so one bad append cannot lose the history; only an oversized or
 * over-populated log rejects the whole read.
 */
export function decodeCompactionEvents(text: unknown): CompactionEventLog | null {
  if (typeof text !== "string" || text.length > COMPACTION_EVENTS_MAX_BYTES
    || new TextEncoder().encode(text).length > COMPACTION_EVENTS_MAX_BYTES) return null;
  const events: CompactionEvent[] = [];
  let skippedLines = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    let value: unknown;
    try { value = JSON.parse(line) as unknown; } catch { skippedLines += 1; continue; }
    const event = parseCompactionEvent(value);
    if (event === null) { skippedLines += 1; continue; }
    events.push(event);
    if (events.length > COMPACTION_EVENTS_MAX_EVENTS) return null;
  }
  return { events, skippedLines };
}

const FNV_PRIME = 0x0000_0100_0000_01b3n;
const FNV_MASK = 0xffff_ffff_ffff_ffffn;
const utf8 = new TextEncoder();

/** FNV-1a 64-bit continuation: `seed` is the running hash of earlier bytes. */
function fnv1a64(seed: bigint, data: Uint8Array): bigint {
  let h = seed;
  for (const byte of data) { h ^= BigInt(byte); h = h * FNV_PRIME & FNV_MASK; }
  return h;
}

/**
 * Domain-separated 128-bit digest as 32 lowercase hex chars, compatible with
 * the producer's session-id fallback. Deterministic and stable for joins —
 * not a secrecy boundary (consumers re-key downstream when needed).
 */
function digest128(domain: string, data: Uint8Array): string {
  const domainBytes = utf8.encode(domain);
  const hi = fnv1a64(fnv1a64(0xcbf2_9ce4_8422_2325n, domainBytes), data);
  const lo = fnv1a64(fnv1a64(0x9e37_79b9_7f4a_7c15n, data), domainBytes);
  const s = hi.toString(16).padStart(16, "0") + lo.toString(16).padStart(16, "0");
  return /^0+$/.test(s) ? `${s.slice(0, 31)}1` : s;
}

const hex32 = (s: string) => s.length === 32 && /^[0-9a-f]{32}$/.test(s) && !/^0+$/.test(s);

/**
 * Canonicalizes a native provider session id to the report's 32-hex
 * `sessionId` shape: a bare or dashed UUID strips to its own 128-bit value,
 * otherwise the first hex/dash run that strips to 32 hex digits wins, and
 * anything else becomes a stable `gobstopper/session-id` digest. Already
 * canonical or downstream-keyed ids pass through unchanged, so the mapping is
 * idempotent.
 */
export function normalizeGobstopperSessionId(raw: string): string {
  const lowered = raw.trim().replace(/[A-Z]/g, c => c.toLowerCase());
  if (hex32(lowered)) return lowered;
  let run = "";
  for (const c of `${lowered} `) {
    if (/[0-9a-f-]/.test(c)) { run += c; continue; }
    const stripped = run.replaceAll("-", "");
    if (hex32(stripped)) return stripped;
    run = "";
  }
  return digest128("gobstopper/session-id", utf8.encode(raw));
}

export type SessionCompactions = Readonly<{
  session: SessionObservation;
  /** Matched events, ascending by `atSec` (log order breaks ties). */
  events: readonly CompactionEvent[];
  applied: number; planned: number; failed: number; skipped: number;
  /** Reclaimed tokens across `applied` events only — plans and failures reclaim nothing. */
  estReclaimedTokens: bigint;
  itemsCovered: bigint; durationMs: bigint;
  firstEventMs: number | null; lastEventMs: number | null; lastAppliedMs: number | null;
  lastStrategy: string | null;
  /** Events whose timestamp lands inside the session's observation window. */
  eventsInWindow: number;
  errorCodes: readonly string[];
}>;
export type CompactionJoin = Readonly<{
  /** One rollup per report session, in report order (zero-event sessions included). */
  sessions: readonly SessionCompactions[];
  matchedEvents: number;
  /** Events whose normalized `(provider, sessionId)` names no session in the report. */
  unmatchedEvents: readonly CompactionEvent[];
  applied: number;
  /** Reclaimed tokens across every `applied` event in the log, matched or not. */
  estReclaimedTokens: bigint;
}>;

/**
 * Joins compaction telemetry to session observations on
 * `(provider, normalizeGobstopperSessionId(session_id))` — the same key the
 * producer's report writer derives from the native id. Events never mutate or
 * annotate the report; sessions without events still appear with zeroed
 * counters.
 */
export function joinCompactionEvents(report: SessionReport, events: readonly CompactionEvent[]): CompactionJoin {
  const byKey = new Map<string, CompactionEvent[]>();
  for (const event of events) {
    const key = `${event.provider}${normalizeGobstopperSessionId(event.sessionId)}`;
    const bucket = byKey.get(key);
    if (bucket === undefined) byKey.set(key, [event]); else bucket.push(event);
  }
  const sessions: SessionCompactions[] = [];
  const unmatched: CompactionEvent[] = [];
  let matched = 0, applied = 0, reclaimed = 0n;
  for (const event of events) {
    if (event.outcome === "applied") { applied += 1; reclaimed += BigInt(event.estReclaimedTokens); }
  }
  const claimed = new Set<CompactionEvent>();
  for (const session of report.sessions) {
    const matchedEvents = (byKey.get(`${session.provider}${session.sessionId}`) ?? []).filter(e => !claimed.has(e));
    for (const e of matchedEvents) claimed.add(e);
    const ordered = [...matchedEvents].sort((a, b) => a.atSec - b.atSec);
    const counts = { applied: 0, planned: 0, failed: 0, skipped: 0 };
    let estReclaimedTokens = 0n, itemsCovered = 0n, durationMs = 0n;
    let lastAppliedMs: number | null = null, lastStrategy: string | null = null, eventsInWindow = 0;
    const errorCodes = new Set<string>();
    for (const event of ordered) {
      counts[event.outcome] += 1;
      itemsCovered += BigInt(event.itemsCovered); durationMs += BigInt(event.durationMs);
      if (event.errorCode !== null) errorCodes.add(event.errorCode);
      const atMs = event.atSec * 1_000;
      if (atMs >= session.window.startMs && atMs <= session.window.endMs) eventsInWindow += 1;
      if (event.outcome === "applied") {
        estReclaimedTokens += BigInt(event.estReclaimedTokens);
        lastAppliedMs = atMs; lastStrategy = event.strategy;
      }
    }
    matched += ordered.length;
    sessions.push({ session, events: ordered, ...counts, estReclaimedTokens, itemsCovered, durationMs,
      firstEventMs: ordered.length === 0 ? null : ordered[0].atSec * 1_000,
      lastEventMs: ordered.length === 0 ? null : ordered[ordered.length - 1].atSec * 1_000,
      lastAppliedMs, lastStrategy, eventsInWindow, errorCodes: [...errorCodes].sort() });
  }
  for (const event of events) if (!claimed.has(event)) unmatched.push(event);
  return { sessions, matchedEvents: matched, unmatchedEvents: unmatched,
    applied, estReclaimedTokens: reclaimed };
}
