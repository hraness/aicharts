import type { SessionReport, SessionSpan } from "./session-contract";

const base = Date.UTC(2026, 8, 14, 14);
const id = (n: number) => n.toString(16).padStart(32, "0");
const span = (n: number, from: number, to: number, kind: SessionSpan["kind"]): SessionSpan => ({
  id: id(n), startMs: base + from * 1_000, endMs: base + to * 1_000, kind,
  basis: kind === "inference" ? "stream_lifecycle" : kind === "tool_wait" ? "tool_lifecycle" : kind === "model_request" ? "request_lifecycle" : "human_boundary",
});

/** Authored synthetic observations, never silently presented as the user's data. */
export const SESSION_EXAMPLE: SessionReport = {
  schemaVersion: 1, profile: "session-observations-v1", sessions: [
    { provider: "codex", sessionId: id(1), conversationId: id(100), source: "instrumented",
      window: { startMs: base, endMs: base + 600_000 },
      spans: [span(10, 0, 95, "inference"), span(11, 95, 180, "tool_wait"), span(12, 120, 155, "approval_wait"),
        span(13, 180, 260, "inference"), span(14, 260, 410, "reply_wait"), span(15, 410, 555, "inference"), span(16, 555, 600, "tool_wait"),
        span(17, 0, 96, "model_request"), span(18, 178, 260, "model_request"), span(19, 409, 556, "model_request")],
      usage: [
        { id: id(30), atMs: base + 260_000, model: "gpt-5.5", modelBasis: "response" as const, inputTokens: 5_200, cacheReadTokens: 18_000, cacheWriteTokens: 0, outputTokens: 2_100, reasoningTokens: 1_200 },
        { id: id(31), atMs: base + 555_000, model: "gpt-5.3-codex", modelBasis: "response", inputTokens: 1_900, cacheReadTokens: 22_000, cacheWriteTokens: 0, outputTokens: 3_000, reasoningTokens: 1_500 },
      ] },
    { provider: "claude_code", sessionId: id(2), conversationId: id(200), source: "instrumented",
      window: { startMs: base + 60_000, endMs: base + 600_000 },
      spans: [span(20, 60, 170, "tool_wait"), span(21, 170, 280, "inference"), span(22, 280, 350, "tool_wait"),
        span(23, 350, 500, "inference"), span(24, 500, 580, "reply_wait"), span(25, 160, 280, "model_request"), span(26, 340, 500, "model_request")],
      usage: [{ id: id(32), atMs: base + 500_000, model: "claude-sonnet-4-6", modelBasis: "response", inputTokens: 2_400, cacheReadTokens: 12_000, cacheWriteTokens: 3_000, outputTokens: 4_800, reasoningTokens: null }] },
  ],
};
