/** Local numeric report. Separate from AICU v1, account sync and analytics. */
export const SESSION_REPORT_PROFILE = "session-observations-v1" as const;
export const SESSION_REPORT_MAX_BYTES = 8 * 1024 * 1024;
export const SESSION_REPORT_MAX_SESSIONS = 2_000;
export const SESSION_REPORT_MAX_RECORDS = 50_000;
export const SESSION_PHASES = ["inference", "reply_wait", "approval_wait", "tool_wait", "unknown"] as const;
export type SessionPhase = typeof SESSION_PHASES[number];
export type SessionProvider = "codex" | "claude_code" | "devin";
export type SessionWindow = Readonly<{ startMs: number; endMs: number }>;
export type SessionSpan = Readonly<{
  id: string; startMs: number; endMs: number;
  kind: Exclude<SessionPhase, "unknown"> | "model_request";
  basis: "stream_lifecycle" | "human_boundary" | "tool_lifecycle" | "request_lifecycle";
}>;
export type SessionUsage = Readonly<{
  id: string; atMs: number; model: string | null;
  modelBasis: "response" | "request" | "unknown";
  inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number;
  outputTokens: number; reasoningTokens: number | null;
}>;
export type SessionObservation = Readonly<{
  provider: SessionProvider; sessionId: string; conversationId: string | null;
  /** Explicit selected observation window; never extends to the present implicitly. */
  window: SessionWindow;
  /** History cannot establish continuous observation. */
  source: "history" | "instrumented";
  usage: readonly SessionUsage[]; spans: readonly SessionSpan[];
}>;
export type SessionReport = Readonly<{
  schemaVersion: 1; profile: typeof SESSION_REPORT_PROFILE;
  sessions: readonly SessionObservation[];
}>;

// Public identifiers only. Unknown/custom labels are deliberately discarded.
// This is a display allowlist, not a claim of availability or effective routing.
export const SESSION_MODELS = [
  "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5-codex", "gpt-5.1", "gpt-5.1-codex",
  "gpt-5.1-codex-mini", "gpt-5.1-codex-max", "gpt-5.2", "gpt-5.2-codex",
  "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.5",
  "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-6-astra",
  "claude-opus-4-1-20250805", "claude-opus-4-5-20251101", "claude-opus-4-6", "claude-opus-4-7",
  "claude-sonnet-4-20250514", "claude-sonnet-4-5-20250929", "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "gpt-6-astra-high", "gpt-6-astra-max", "swe-2-max",
] as const;

/** Response-model slugs a Devin session's `extra.generation_model` may carry. */
export const DEVIN_SESSION_MODELS = ["gpt-6-astra-high", "gpt-6-astra-max", "swe-2-max"] as const;
