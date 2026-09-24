import { RICH_FACT_KINDS, RICH_FACT_PROFILE, type RichFact, type RichFactReport, type RichOwner, type RichPayload, type RichSelection, type RichUsage } from "./rich-fact-contract";

/** Synthetic facts only; never a captured user source. */
export const richId = (value: number) => value.toString(16).padStart(32, "0");
export const richOwner: RichOwner = { provider: "codex", accountId: null, executionId: richId(1_000), conversationId: null, lineage: "root", parentExecutionId: null };
export function richUsage(index = 1, output = "10", change: Partial<RichUsage> = {}): RichUsage {
  return { kind: "usage", grain: "request", tokenScope: "direct", observationId: richId(index), model: null, modelBasis: "unknown",
    tokens: { inputUncached: "0", cacheRead: "0", cacheWrite5m: "0", cacheWrite1h: "0", cacheWriteUnknown: "0", output, reasoning: null }, ...change };
}
export const richProvenance = { profile: "numeric-producer-v1", version: 1, sourceId: richId(999) } as const;
export function richFact(index: number, value: RichPayload = richUsage(index), change: Partial<RichFact> = {}): RichFact {
  return { id: richId(index), revision: 0, provenance: richProvenance, owner: richOwner, kind: value.kind, atMs: 200, value, ...change };
}
export function richReport(facts: readonly RichFact[] = []): RichFactReport {
  return { schemaVersion: 1, profile: RICH_FACT_PROFILE, provenance: richProvenance, window: { startMs: 0, endMs: 10_000 },
    coverage: Object.fromEntries(RICH_FACT_KINDS.map(kind => [kind, "partial"])) as RichFactReport["coverage"], facts };
}
export const richSelection: RichSelection = { window: { startMs: 0, endMs: 10_000 }, grain: "request", tokenScope: "direct", lineage: "all", executionId: null };
