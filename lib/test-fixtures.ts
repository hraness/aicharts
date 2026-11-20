// Builders for small hand-made datasets in tests.
import type {
  EpochScore,
  ModelPricing,
  ModelRelease,
  ProviderId,
  TerminalBenchRun,
} from "./types";

/** A Terminal-Bench run scoring `score`% for `cost` dollars per task. */
export function run(
  score: number,
  cost: number | null,
  overrides: Partial<TerminalBenchRun> = {},
): TerminalBenchRun {
  const output = overrides.tokensPerTask?.output ?? Math.round((cost ?? 1) * 20_000);
  return {
    version: "4.1",
    agent: "Test Agent",
    agentVersion: "1.0.0",
    agentUrl: null,
    effort: "high",
    accuracy: score,
    ci95: 3,
    trials: 330,
    successes: Math.round((score / 100) * 330),
    costPerTaskUsd: cost,
    tokensPerTask: { total: output * 20, output },
    minutesPerTask: 30,
    sourceUrl: "https://github.com/harbor-framework/terminal-bench/blob/main/leaderboard/submissions/test.json",
    ...overrides,
  };
}

export function epoch(
  benchmark: EpochScore["benchmark"],
  score: number,
  effort: EpochScore["effort"] = "high",
): EpochScore {
  return { benchmark, effort, score, stderr: 2, runOn: "2026-11-01" };
}

export const PRICING: ModelPricing = {
  inputPer1M: 2,
  outputPer1M: 10,
  cachedInputPer1M: 0.2,
  maxInputTokens: 1_000_000,
};

export function release(
  slug: string,
  name: string,
  provider: ProviderId,
  releaseDate: string,
  supersededOn: string | null,
  terminalBench: TerminalBenchRun | null = null,
  extra: Partial<Pick<ModelRelease, "epoch" | "pricing" | "announcementUrl">> = {},
): ModelRelease {
  return {
    slug,
    name,
    provider,
    releaseDate,
    deprecated: supersededOn !== null,
    supersededOn,
    announcementUrl: "https://example.com",
    pricing: PRICING,
    terminalBench,
    epoch: [],
    ...extra,
  };
}
