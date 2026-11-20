import rawDataset from "../data/releases.json";
import { familyOf } from "./lineup";
import {
  buildPlottedPoints,
  computeParetoFrontier,
  getChartScale,
  getContextualFrontierEfforts,
  getFrontierEffortsByRelease,
  type ChartScale,
} from "./pareto";
import type {
  BenchmarkId,
  EffortPoint,
  EffortSlug,
  ModelRelease,
  ProviderId,
  ReleaseDataset,
} from "./types";

export const dataset = rawDataset as unknown as ReleaseDataset;

export const SITE_URL = "https://aicharts.io";

export const EFFORT_NAMES: Readonly<Record<EffortSlug, string>> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

/** What each lab calls the setting in its API and agent. */
export const LAB_SETTING_NAMES: Readonly<Record<ProviderId, string>> = {
  openai: "reasoning effort",
  anthropic: "effort",
  google: "thinking level",
};

const PROVIDER_ORDER: Readonly<Record<ProviderId, number>> = {
  google: 0,
  openai: 1,
  anthropic: 2,
};
const OPEN_END = "9999-12-31";

export function effortName(slug: EffortSlug): string {
  return EFFORT_NAMES[slug];
}

export { familyOf };

/** The last day a release was current. Releases still current run to the far future. */
export function activeUntil(release: ModelRelease, snapshotDate: string): string {
  return release.supersededOn ?? (release.deprecated ? snapshotDate : OPEN_END);
}

/**
 * The release that replaced a superseded one: the same lab's release from the
 * superseded date, preferring the same model line, else the same line released
 * in between (uncurated deprecations carry the refresh date instead).
 */
export function findSuccessor(
  release: ModelRelease,
  all: readonly ModelRelease[],
): ModelRelease | null {
  const until = release.supersededOn;
  if (until === null) return null;
  const family = familyOf(release.name);
  let best: ModelRelease | null = null;
  let bestScore = 0;
  for (const other of all) {
    if (other.provider !== release.provider || other.slug === release.slug) continue;
    if (other.releaseDate <= release.releaseDate || other.releaseDate > until) continue;
    const score =
      (other.releaseDate === until ? 2 : 0) + (familyOf(other.name) === family ? 1 : 0);
    if (score > bestScore || (score === bestScore && best && other.releaseDate > best.releaseDate)) {
      best = other;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

/** Newer release first; same-day releases by lab, then slug. */
export function orderPair(a: ModelRelease, b: ModelRelease): [ModelRelease, ModelRelease] {
  if (a.releaseDate !== b.releaseDate) return a.releaseDate > b.releaseDate ? [a, b] : [b, a];
  if (a.provider !== b.provider) {
    return PROVIDER_ORDER[a.provider] < PROVIDER_ORDER[b.provider] ? [a, b] : [b, a];
  }
  return a.slug < b.slug ? [a, b] : [b, a];
}

export function pairSlug(a: ModelRelease, b: ModelRelease): string {
  const [first, second] = orderPair(a, b);
  return `${first.slug}-vs-${second.slug}`;
}

export type PairRelation = "upgrade" | "same-lab" | "cross-lab";

export type ReleasePair = Readonly<{
  slug: string;
  reverseSlug: string;
  first: ModelRelease;
  second: ModelRelease;
  relation: PairRelation;
  /** Both releases are still current. */
  current: boolean;
}>;

export type Catalog = Readonly<{
  dataset: ReleaseDataset;
  releases: readonly ModelRelease[];
  current: readonly ModelRelease[];
  superseded: readonly ModelRelease[];
  pairs: readonly ReleasePair[];
  /** Axes shared by every model chart, from all releases. */
  chartScale: ChartScale;
  find: (slug: string) => ModelRelease | undefined;
  findPair: (slug: string) => ReleasePair | undefined;
  successorOf: (release: ModelRelease) => ModelRelease | null;
  predecessorOf: (release: ModelRelease) => ModelRelease | null;
  pairsFor: (release: ModelRelease) => ReleasePair[];
  /** Live frontier efforts by release slug for a benchmark, on the cost axis. */
  liveFrontier: (benchmark: BenchmarkId) => ReadonlyMap<string, EffortPoint[]>;
  /**
   * Efforts each release had on the frontier of the models out on its release
   * day, all labs, on the cost axis: the explorer's At release stars.
   */
  releaseDayFrontier: (benchmark: BenchmarkId) => ReadonlyMap<string, EffortPoint[]>;
}>;

/**
 * Comparison pages cover every two releases that were current at the same
 * time, plus each release against the one it replaced.
 */
export function buildCatalog(source: ReleaseDataset): Catalog {
  const releases = source.releases;
  const bySlug = new Map(releases.map((r) => [r.slug, r]));
  const successors = new Map(releases.map((r) => [r.slug, findSuccessor(r, releases)]));
  const predecessors = new Map<string, ModelRelease>();
  for (const release of releases) {
    const next = successors.get(release.slug);
    if (!next) continue;
    const known = predecessors.get(next.slug);
    if (!known || release.releaseDate > known.releaseDate) predecessors.set(next.slug, release);
  }

  const pairs: ReleasePair[] = [];
  for (let i = 0; i < releases.length; i++) {
    for (let j = i + 1; j < releases.length; j++) {
      const a = releases[i]!;
      const b = releases[j]!;
      const upgrade =
        successors.get(a.slug)?.slug === b.slug || successors.get(b.slug)?.slug === a.slug;
      const overlapped =
        a.releaseDate < activeUntil(b, source.snapshotDate) &&
        b.releaseDate < activeUntil(a, source.snapshotDate);
      if (!upgrade && !overlapped) continue;
      const [first, second] = orderPair(a, b);
      pairs.push({
        slug: `${first.slug}-vs-${second.slug}`,
        reverseSlug: `${second.slug}-vs-${first.slug}`,
        first,
        second,
        relation: upgrade ? "upgrade" : a.provider === b.provider ? "same-lab" : "cross-lab",
        current: !a.deprecated && !b.deprecated,
      });
    }
  }
  pairs.sort(
    (x, y) =>
      y.first.releaseDate.localeCompare(x.first.releaseDate) ||
      y.second.releaseDate.localeCompare(x.second.releaseDate) ||
      x.slug.localeCompare(y.slug),
  );
  const pairBySlug = new Map(pairs.map((p) => [p.slug, p]));

  const current = releases.filter((r) => !r.deprecated);
  const frontierCache = new Map<BenchmarkId, Map<string, EffortPoint[]>>();
  const releaseDayCache = new Map<BenchmarkId, Map<string, EffortPoint[]>>();

  return {
    dataset: source,
    releases,
    current,
    superseded: releases.filter((r) => r.deprecated),
    pairs,
    chartScale: getChartScale(releases),
    find: (slug) => bySlug.get(slug),
    findPair: (slug) => pairBySlug.get(slug),
    successorOf: (release) => successors.get(release.slug) ?? null,
    predecessorOf: (release) => predecessors.get(release.slug) ?? null,
    pairsFor(release) {
      const rank = (pair: ReleasePair) =>
        pair.relation === "upgrade" ? 0 : pair.current ? 1 : 2;
      const other = (pair: ReleasePair) =>
        pair.first.slug === release.slug ? pair.second : pair.first;
      return pairs
        .filter((p) => p.first.slug === release.slug || p.second.slug === release.slug)
        .sort(
          (x, y) =>
            rank(x) - rank(y) ||
            other(y).releaseDate.localeCompare(other(x).releaseDate) ||
            x.slug.localeCompare(y.slug),
        );
    },
    liveFrontier(benchmark) {
      let cached = frontierCache.get(benchmark);
      if (!cached) {
        cached = getFrontierEffortsByRelease(current, benchmark, "cost");
        frontierCache.set(benchmark, cached);
      }
      return cached;
    },
    releaseDayFrontier(benchmark) {
      let cached = releaseDayCache.get(benchmark);
      if (!cached) {
        cached = getContextualFrontierEfforts(releases, benchmark, "cost", "release");
        releaseDayCache.set(benchmark, cached);
      }
      return cached;
    },
  };
}

export const catalog = buildCatalog(dataset);

export function defaultEffort(release: ModelRelease): EffortPoint {
  return release.efforts.find((e) => e.isDefaultEffort) ?? release.efforts[0]!;
}

/** Highest score on a benchmark; the cheaper setting wins a tie. */
export function bestEffort(release: ModelRelease, benchmark: BenchmarkId = "coding"): EffortPoint {
  let best = release.efforts[0]!;
  for (const effort of release.efforts) {
    const score = effort.scores[benchmark];
    const top = best.scores[benchmark];
    if (score > top || (score === top && effort.costUsdPerTask.total < best.costUsdPerTask.total)) {
      best = effort;
    }
  }
  return best;
}

/** Lowest cost per task; the higher coding score wins a tie. */
export function cheapestEffort(release: ModelRelease): EffortPoint {
  let cheapest = release.efforts[0]!;
  for (const effort of release.efforts) {
    const cost = effort.costUsdPerTask.total;
    const low = cheapest.costUsdPerTask.total;
    if (cost < low || (cost === low && effort.scores.coding > cheapest.scores.coding)) {
      cheapest = effort;
    }
  }
  return cheapest;
}

/** The cheapest setting that scores within `points` of the release's best. */
export function efficientEffort(
  release: ModelRelease,
  benchmark: BenchmarkId = "coding",
  points = 1,
): EffortPoint {
  const floor = bestEffort(release, benchmark).scores[benchmark] - points;
  return release.efforts
    .filter((e) => e.scores[benchmark] >= floor)
    .reduce((a, b) => (b.costUsdPerTask.total < a.costUsdPerTask.total ? b : a));
}

/** The settings a release offers, lowest first. */
export function effortsByLevel(release: ModelRelease): EffortPoint[] {
  return [...release.efforts].sort((a, b) => a.effortLevel - b.effortLevel);
}

export type CurveStep = Readonly<{
  from: EffortPoint;
  to: EffortPoint;
  scoreDelta: number;
  costRatio: number;
  tokenRatio: number;
}>;

/** Each move to the next effort setting up, with what it adds and costs. */
export function curveSteps(release: ModelRelease, benchmark: BenchmarkId = "coding"): CurveStep[] {
  const efforts = effortsByLevel(release);
  return efforts.slice(1).map((to, i) => {
    const from = efforts[i]!;
    return {
      from,
      to,
      scoreDelta: to.scores[benchmark] - from.scores[benchmark],
      costRatio: to.costUsdPerTask.total / from.costUsdPerTask.total,
      tokenRatio: to.tokensPerTask.total / from.tokensPerTask.total,
    };
  });
}

export type FrontierSegment = Readonly<{
  release: ModelRelease;
  efforts: readonly EffortPoint[];
}>;

/**
 * Walks the two releases' shared cost frontier from the cheapest point and
 * groups it into runs owned by one release. One run means one release is
 * ahead at every budget.
 */
export function frontierSegments(
  a: ModelRelease,
  b: ModelRelease,
  benchmark: BenchmarkId = "coding",
): FrontierSegment[] {
  const segments: { release: ModelRelease; efforts: EffortPoint[] }[] = [];
  for (const point of computeParetoFrontier(buildPlottedPoints([a, b], benchmark, "cost"))) {
    const last = segments[segments.length - 1];
    if (last && last.release.slug === point.release.slug) last.efforts.push(point.effort);
    else segments.push({ release: point.release, efforts: [point.effort] });
  }
  return segments;
}

/** The cheapest setting of `release` that reaches `rival`'s best score, if any. */
export function matchingEffort(
  release: ModelRelease,
  rival: ModelRelease,
  benchmark: BenchmarkId = "coding",
): EffortPoint | null {
  const target = bestEffort(rival, benchmark).scores[benchmark];
  const reaching = release.efforts.filter((e) => e.scores[benchmark] >= target);
  if (reaching.length === 0) return null;
  return reaching.reduce((x, y) => (y.costUsdPerTask.total < x.costUsdPerTask.total ? y : x));
}

export type EffortStep = Readonly<{
  slug: string;
  lower: EffortSlug;
  higher: EffortSlug;
}>;

export const EFFORT_STEPS: readonly EffortStep[] = [
  { slug: "xhigh-vs-high", higher: "xhigh", lower: "high" },
  { slug: "max-vs-xhigh", higher: "max", lower: "xhigh" },
  { slug: "max-vs-high", higher: "max", lower: "high" },
  { slug: "high-vs-medium", higher: "high", lower: "medium" },
  { slug: "medium-vs-low", higher: "medium", lower: "low" },
];

export type EffortStepRow = Readonly<{
  release: ModelRelease;
  lower: EffortPoint;
  higher: EffortPoint;
  scoreDelta: Readonly<Record<BenchmarkId, number>>;
  costRatio: number;
  tokenRatio: number;
}>;

const BENCHMARK_IDS: readonly BenchmarkId[] = [
  "coding",
  "terminalBench4",
  "frontierCode2",
  "intelligence",
];

/** Every release measured at both settings of a step, biggest coding gain first. */
export function effortStepRows(
  step: EffortStep,
  releases: readonly ModelRelease[],
): EffortStepRow[] {
  return releases
    .flatMap((release) => {
      const lower = release.efforts.find((e) => e.effortSlug === step.lower);
      const higher = release.efforts.find((e) => e.effortSlug === step.higher);
      if (!lower || !higher) return [];
      const scoreDelta = Object.fromEntries(
        BENCHMARK_IDS.map((id) => [id, higher.scores[id] - lower.scores[id]]),
      ) as Record<BenchmarkId, number>;
      return [
        {
          release,
          lower,
          higher,
          scoreDelta,
          costRatio: higher.costUsdPerTask.total / lower.costUsdPerTask.total,
          tokenRatio: higher.tokensPerTask.total / lower.tokensPerTask.total,
        },
      ];
    })
    .sort((x, y) => y.scoreDelta.coding - x.scoreDelta.coding);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export type EffortStepSummary = Readonly<{
  count: number;
  medianDelta: Readonly<Record<BenchmarkId, number>>;
  medianCostRatio: number;
  medianTokenRatio: number;
  drops: readonly EffortStepRow[];
}>;

export function summarizeEffortStep(rows: readonly EffortStepRow[]): EffortStepSummary {
  return {
    count: rows.length,
    medianDelta: Object.fromEntries(
      BENCHMARK_IDS.map((id) => [id, median(rows.map((r) => r.scoreDelta[id]))]),
    ) as Record<BenchmarkId, number>,
    medianCostRatio: median(rows.map((r) => r.costRatio)),
    medianTokenRatio: median(rows.map((r) => r.tokenRatio)),
    drops: rows.filter((r) => r.scoreDelta.coding < 0),
  };
}

/** Steps with at least three measured releases get a page. */
export function publishedEffortSteps(releases: readonly ModelRelease[]): EffortStep[] {
  return EFFORT_STEPS.filter((step) => effortStepRows(step, releases).length >= 3);
}
