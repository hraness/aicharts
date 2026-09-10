import type { Batch, Policy } from "./wire";

export const fixturePolicy: Policy = { firstDay: 20_000, lastDay: 20_000, registry: { revision: 1, models: [] } };

/** Synthetic values only; shared with the Rust protocol parity fixture. */
export function createFixtureBatch(): Batch {
  return {
    utcDay: 20_000, registryRevision: 1,
    usage: [{
      id: new Uint8Array(16).fill(1), executionId: new Uint8Array(16).fill(2), accountId: new Uint8Array(16).fill(3),
      offsetMs: 1_234, provider: 1, authMode: 1, evidence: 1, modelId: 0, contextTier: 0,
      tokens: { inputUncached: 123n, cacheRead: 456n, cacheWrite5m: 0n, cacheWrite1h: 0n, output: 789n, reasoningOutput: 42n },
    }],
    prompts: [{
      id: new Uint8Array(16).fill(4), executionId: new Uint8Array(16), accountId: new Uint8Array(16),
      offsetMs: 1_000, provider: 1, origin: 0, evidence: 1,
    }],
    intervals: [{
      executionId: new Uint8Array(16).fill(2), accountId: new Uint8Array(16).fill(3), startMs: 1_000, endMs: 2_000,
      provider: 1, kind: 1, evidence: 2, clockUncertaintyMs: 5,
    }],
  };
}
