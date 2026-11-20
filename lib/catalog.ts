import rawDataset from "../data/releases.json";
import { familyOf } from "./lineup";
import { sharedMeasures } from "./measures";
import {
  getChartScale,
  getContextualFrontierReleases,
  getFrontierReleases,
  type ChartScale,
} from "./pareto";
import {
  TERMINAL_BENCH,
  type ModelRelease,
  type ProviderId,
  type ReleaseDataset,
} from "./types";

export const dataset = rawDataset as unknown as ReleaseDataset;

export const SITE_URL = "https://aicharts.io";

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

export { familyOf };
export {
  bestEpoch,
  EFFORT_NAMES,
  effortName,
  epochBenchmarksOf,
  epochScores,
  hasResults,
  sharedMeasures,
} from "./measures";

/**
 * A gap smaller than two tasks' worth of a benchmark is treated as a tie:
 * scores are means over a few attempts per task, so one task can flip either
 * way. On Terminal-Bench's 66 tasks that is about three points.
 */
export function noiseFloor(tasks: number): number {
  return 200 / tasks;
}

/**
 * Two tasks' worth of Terminal-Bench. Scores are stored to two decimals, so a
 * gap of exactly two tasks can read 0.01 short; the margin absorbs that.
 */
export const TB_TIE = noiseFloor(TERMINAL_BENCH.tasks) - 0.01;

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
  /** Current releases whose run sits on today's cost frontier: the frontier stars. */
  liveFrontier: ReadonlySet<string>;
  /**
   * Releases whose run sat on the cost frontier of the models out on their
   * release day, all labs: the explorer's At release stars.
   */
  releaseDayFrontier: ReadonlySet<string>;
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
    liveFrontier: getFrontierReleases(current, "cost"),
    releaseDayFrontier: getContextualFrontierReleases(releases, "cost", "release"),
  };
}

export const catalog = buildCatalog(dataset);

/** Pair pages worth indexing: the two releases share at least one measure. */
export function isComparable(pair: ReleasePair): boolean {
  return sharedMeasures(pair.first, pair.second).length > 0;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
