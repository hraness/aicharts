// Builders for small hand-made datasets in tests.
import type { EffortPoint, EffortSlug, ModelRelease, ProviderId } from "./types";

const LEVELS: Readonly<Record<EffortSlug, number>> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};

export function effort(
  slug: string,
  effortSlug: EffortSlug,
  score: number,
  cost: number,
  isDefaultEffort = false,
): EffortPoint {
  return {
    id: `${slug}-${effortSlug}`,
    slug: `${slug}-${effortSlug}`,
    effortSlug,
    effortLabel: effortSlug,
    shortTag: effortSlug,
    effortLevel: LEVELS[effortSlug],
    isDefaultEffort,
    scores: { coding: score, terminalBench4: score, frontierCode2: score, intelligence: score },
    costUsdPerTask: { total: cost, input: cost / 2, output: cost / 2, reasoning: 0, cacheRead: 0 },
    tokensPerTask: { total: cost * 10_000, reasoning: 0, answer: cost * 10_000 },
    speedTokPerSec: null,
    cliEval: null,
  };
}

export function release(
  slug: string,
  name: string,
  provider: ProviderId,
  releaseDate: string,
  supersededOn: string | null,
  efforts: [EffortSlug, number, number][],
): ModelRelease {
  return {
    slug,
    name,
    provider,
    releaseDate,
    deprecated: supersededOn !== null,
    supersededOn,
    pricing: { inputPer1M: 2, outputPer1M: 10, cachedInputPer1M: 0.2, contextWindowTokens: 400_000 },
    summary: "",
    announcementUrl: "https://example.com",
    benchmarkUrl: "https://example.com",
    harborEval: null,
    efforts: efforts.map(([level, score, cost], i) => effort(slug, level, score, cost, i === 1)),
  };
}
