import codingAgentData from "@/data/coding-agents.json";
import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import type { BenchmarkAtlasCoverage } from "@/lib/benchmark-atlas";
import { ATLAS_ENTRIES } from "@/lib/benchmark-atlas-catalog";
import { comparableIntelligenceRecords } from "@/lib/intelligence-efficiency";

/**
 * The points the launch mockups draw, read from the same checked snapshots
 * the live charts use. Nothing here is typed by hand, so a data refresh moves
 * the mockups with the site.
 */

export type MockupPoint = Readonly<{
  id: string;
  label: string;
  maker: string;
  score: number;
  cost: number;
  tokens: number;
}>;

/** The cohort the homepage chart plots, through the same filter. */
export const INTELLIGENCE_POINTS: readonly MockupPoint[] = comparableIntelligenceRecords(intelligenceData.records).flatMap((record) => {
  const cost = record.costUsdPerTask?.total;
  const tokens = record.outputTokensPerTask?.total;
  if (typeof cost !== "number" || typeof tokens !== "number") return [];
  return [{ id: record.id, label: record.shortName ?? record.name, maker: record.creator.name, score: record.intelligenceIndex, cost, tokens }];
});

export const INTELLIGENCE_VERSION = `v${intelligenceData.benchmark.version}`;
export const INTELLIGENCE_RETRIEVED_ON = intelligenceData.source.retrievedAt.slice(0, 10);
export const INTELLIGENCE_SOURCE = intelligenceData.source.name;

export type CodingPoint = MockupPoint & Readonly<{ agent: string; setting: string; minutes: number }>;

export const CODING_POINTS: readonly CodingPoint[] = codingAgentData.records.flatMap((record) => {
  const score = record.benchmarks.aaIndex;
  const cost = record.economics.costUsd;
  const seconds = record.economics.durationSeconds;
  const tokens = record.usage.totalTokens;
  if (typeof score !== "number" || typeof cost !== "number" || !(cost > 0) || typeof seconds !== "number" || typeof tokens !== "number") return [];
  return [{
    id: record.id,
    label: record.modelLabel,
    maker: record.providerName,
    agent: record.agent,
    setting: record.setting,
    score,
    cost,
    tokens,
    minutes: seconds / 60,
  }];
});

/**
 * The points nothing cheaper beats: sorted by cost, each point scores higher
 * than every cheaper one. This is the line the live chart draws.
 */
export function bestValueLine<P extends MockupPoint>(points: readonly P[], x: (point: P) => number = (point) => point.cost): readonly P[] {
  const sorted = [...points].sort((left, right) => x(left) - x(right) || right.score - left.score);
  const line: P[] = [];
  let best = Number.NEGATIVE_INFINITY;
  for (const point of sorted) {
    if (point.score > best) {
      line.push(point);
      best = point.score;
    }
  }
  return line;
}

/** The coding setup the "coding" beat hovers: the top-scoring one on the best-value line. */
export function hoveredCodingPoint(): CodingPoint {
  const line = bestValueLine(CODING_POINTS);
  const top = line.at(-1);
  if (top === undefined) throw new Error("The checked coding snapshot has no plottable setups.");
  return top;
}

/** The labels the benchmarks library shows for each coverage level. */
export const LIBRARY_COVERAGE_LABELS: Readonly<Record<BenchmarkAtlasCoverage, string>> = {
  charted: "Charted",
  "source-only": "Source guide",
  watchlist: "Emerging",
};

export const LIBRARY_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  coding: "Coding",
  general: "General",
  image: "Images",
  video: "Video",
  science: "Science",
  work: "Work",
  reasoning: "Reasoning",
  research: "Research",
  memory: "Memory",
  "computer-use": "Computer use",
  world: "World models",
  audio: "Audio",
};

export const LIBRARY_ENTRIES = ATLAS_ENTRIES;
