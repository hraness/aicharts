/** Local, numeric-only facts. This profile is not an AICU upload or an activation setting. */
import type { SessionProvider } from "./session-contract";

export const RICH_FACT_PROFILE = "rich-facts-v1" as const;
export const RICH_FACT_MAX_BYTES = 8 * 1024 * 1024;
export const RICH_FACT_MAX_RECORDS = 50_000;
export const RICH_FACT_MAX_EXECUTIONS = 2_000;
export const RICH_FACT_MAX_LINEAGE_DEPTH = 64;
export const RICH_FACT_MAX_WINDOW_MS = 31 * 86_400_000;
export const RICH_FACT_MAX_COUNTER = 999_999_999_999_999_999_999_999n;
export const RICH_FACT_KINDS = ["usage", "span", "request", "turn", "tool", "context", "compaction"] as const;
export type RichFactKind = typeof RICH_FACT_KINDS[number];
export type RichGrain = "usage_observation" | "request" | "response" | "turn" | "session";
export type RichTokenScope = "direct" | "inclusive" | "unknown";
export type RichLineage = "root" | "child" | "unknown";
export type RichWindow = Readonly<{ startMs: number; endMs: number }>;
export type RichProvenance = Readonly<{
  profile: "session-observations-v1" | "terminal-turns-v1" | "compaction-events-v1" | "numeric-producer-v1";
  version: 1;
  /** Keyed source epoch, stable across replay; never a filename or native provider ID. */
  sourceId: string;
}>;
export type RichOwner = Readonly<{
  provider: SessionProvider; accountId: string | null; executionId: string;
  conversationId: string | null;
  lineage: RichLineage; parentExecutionId: string | null;
}>;
export type RichTokens = Readonly<{
  inputUncached: string; cacheRead: string; cacheWrite5m: string; cacheWrite1h: string;
  cacheWriteUnknown: string; output: string;
  /** Subset of inclusive output. Null means unmeasured, including numeric output zero. */
  reasoning: string | null;
}>;
export type RichUsage = Readonly<{
  kind: "usage"; grain: RichGrain; observationId: string; tokenScope: RichTokenScope;
  model: string | null; modelBasis: "response" | "request" | "unknown";
  tokens: RichTokens;
}>;
export type RichSpan = Readonly<{
  kind: "span"; observationId: string;
  phase: "inference" | "reply_wait" | "approval_wait" | "tool_wait" | "model_request";
  basis: "stream_lifecycle" | "human_boundary" | "tool_lifecycle" | "request_lifecycle";
  startMs: number; endMs: number;
  /** Zero only when the source explicitly supports exact timing at this unit. */
  clockUncertaintyMs: number | null;
}>;
export type RichRequest = Readonly<{
  kind: "request"; observationId: string;
  stage: "requested" | "dispatched" | "terminal";
  outcome: "unknown" | "success" | "error" | "refusal" | "cancel" | "timeout";
  requestedAtMs: number | null; dispatchedAtMs: number | null; terminalAtMs: number | null;
  firstTokenAtMs: number | null; lastTokenAtMs: number | null;
  clockUncertaintyMs: number | null;
  retryOf: string | null;
}>;
export type RichTool = Readonly<{
  kind: "tool"; observationId: string;
  stage: "requested" | "dispatched" | "terminal";
  outcome: "unknown" | "success" | "error" | "cancel" | "timeout";
}>;
export type RichTurn = Readonly<{
  kind: "turn"; observationId: string; origin: "human" | "automation" | "unknown";
  outcome: "completed" | "aborted"; startedAtMs: number | null; endedAtMs: number;
  clockUncertaintyMs: number | null; toolCalls: number | null;
}>;
export type RichContext = Readonly<{
  kind: "context"; observationId: string; tokens: string;
  /** Explicit source limit for this observation; never inferred from a model label. */
  limitTokens: string | null;
}>;
export type RichCompaction = Readonly<{
  kind: "compaction"; observationId: string;
  action: "provider_compact" | "transcript_compact" | "none";
  outcome: "applied" | "planned" | "failed" | "skipped";
  beforeTokens: string; afterTokens: string; durationMs: number;
}>;
export type RichPayload = RichUsage | RichSpan | RichRequest | RichTurn | RichTool | RichContext | RichCompaction;
export type RichFact = Readonly<{
  id: string; revision: number; provenance: RichProvenance; owner: RichOwner;
  kind: RichFactKind; atMs: number;
  /** Null is an explicit retraction; retain the identity and revision as a tombstone. */
  value: RichPayload | null;
}>;
export type RichFactReport = Readonly<{
  schemaVersion: 1; profile: typeof RICH_FACT_PROFILE;
  provenance: RichProvenance;
  /** Only completed/observed facts within this half-open retention window are retained. */
  window: RichWindow;
  /** Completeness must be established by the producer for this exact source/window. */
  coverage: Readonly<Record<RichFactKind, "unsupported" | "partial" | "complete">>;
  facts: readonly RichFact[];
}>;
export type RichSelection = Readonly<{
  window: RichWindow; grain: RichGrain; tokenScope: RichTokenScope;
  lineage: RichLineage | "all";
  /** Null selects all executions; a keyed ID selects exactly one execution. */
  executionId: string | null;
}>;
export type RichTokenAggregation = Readonly<
  | { eligible: true; reason: null }
  | { eligible: false; reason: "overlapping_executions" | "incomplete_lineage" | "unknown_token_scope" }
>;
export type RichFactError = "invalid_rich_facts" | "body_limit" | "record_limit" | "conflicting_fact" | "conflicting_owner" | "invalid_lineage" | "incompatible_source";
export type ExactRatio = Readonly<{ numerator: bigint; denominator: bigint }>;
export type RichDistribution = Readonly<{
  measured: number; unmeasured: number; sum: bigint;
  observedMean: ExactRatio | null;
  minimum: bigint | null; median: bigint | null; p90: bigint | null; p95: bigint | null; p99: bigint | null; maximum: bigint | null;
}>;
