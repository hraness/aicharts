import type {
  BenchmarkId,
  BudgetAxis,
  ContextMode,
  EffortPoint,
  ModelRelease,
  ProviderId,
} from "./types";

export type PlottedPoint = Readonly<{
  key: string;
  release: ModelRelease;
  effort: EffortPoint;
  provider: ProviderId;
  budget: number;
  score: number;
}>;

export type FrontierComparison =
  | Readonly<{
      onFrontier: true;
      previousStep: PlottedPoint | null;
      scoreGainOverPrevious: number | null;
    }>
  | Readonly<{
      onFrontier: false;
      dominator: PlottedPoint;
      scoreDeficit: number;
      budgetRatio: number;
    }>;

export function getPointBudget(effort: EffortPoint, axis: BudgetAxis): number {
  return axis === "cost" ? effort.costUsdPerTask.total : effort.tokensPerTask.total;
}

export function getPointScore(effort: EffortPoint, benchmark: BenchmarkId): number {
  return effort.scores[benchmark];
}

/**
 * Filters releases visible in the chart for a selected release and context mode.
 * - "release": models launched on or before `selected.releaseDate` that were not yet superseded on that date
 *   (always keeping `selected` itself).
 * - "live": all currently active (non-deprecated) releases, plus `selected` if historical.
 */
export function getContextualReleases(
  allReleases: readonly ModelRelease[],
  selected: ModelRelease,
  mode: ContextMode,
  enabledProviders?: ReadonlySet<ProviderId>,
): ModelRelease[] {
  return allReleases.filter((rel) => {
    if (enabledProviders && !enabledProviders.has(rel.provider) && rel.slug !== selected.slug) {
      return false;
    }
    if (rel.slug === selected.slug) return true;
    if (mode === "live") {
      return !rel.deprecated;
    }
    // mode === "release": existed on or before selected.releaseDate, and was not superseded strictly before selected.releaseDate
    if (rel.releaseDate > selected.releaseDate) return false;
    if (rel.supersededOn !== null && rel.supersededOn <= selected.releaseDate) return false;
    return true;
  });
}

export function buildPlottedPoints(
  releases: readonly ModelRelease[],
  benchmark: BenchmarkId,
  axis: BudgetAxis,
): PlottedPoint[] {
  const points: PlottedPoint[] = [];
  for (const release of releases) {
    for (const effort of release.efforts) {
      const budget = getPointBudget(effort, axis);
      const score = getPointScore(effort, benchmark);
      if (Number.isFinite(budget) && budget > 0 && Number.isFinite(score)) {
        points.push({
          key: `${release.slug}:${effort.effortSlug}`,
          release,
          effort,
          provider: release.provider,
          budget,
          score,
        });
      }
    }
  }
  return points;
}

/**
 * Computes the strict Pareto-optimal frontier (minimize budget x, maximize score y).
 * Returned points are strictly increasing in both budget and score.
 */
export function computeParetoFrontier(points: readonly PlottedPoint[]): PlottedPoint[] {
  const EPS = 1e-9;
  const sorted = [...points].sort((a, b) => {
    if (Math.abs(a.budget - b.budget) > EPS) return a.budget - b.budget;
    if (Math.abs(b.score - a.score) > EPS) return b.score - a.score;
    return a.key.localeCompare(b.key);
  });

  const frontier: PlottedPoint[] = [];
  let bestScore = -Infinity;

  for (const pt of sorted) {
    if (pt.score > bestScore + EPS) {
      // If same budget as previous frontier point, the higher-score one was already sorted first
      if (frontier.length > 0 && Math.abs(frontier[frontier.length - 1]!.budget - pt.budget) <= EPS) {
        continue;
      }
      frontier.push(pt);
      bestScore = pt.score;
    }
  }

  return frontier;
}

export function comparePointToFrontier(
  point: PlottedPoint,
  frontier: readonly PlottedPoint[],
): FrontierComparison {
  const idx = frontier.findIndex((f) => f.key === point.key);
  if (idx !== -1) {
    const prev = idx > 0 ? frontier[idx - 1]! : null;
    return {
      onFrontier: true,
      previousStep: prev,
      scoreGainOverPrevious: prev ? point.score - prev.score : null,
    };
  }

  // Find the highest-scoring frontier point with budget <= point.budget
  const EPS = 1e-9;
  let dominator: PlottedPoint | null = null;
  for (const f of frontier) {
    if (f.budget <= point.budget + EPS) {
      if (dominator === null || f.score > dominator.score) {
        dominator = f;
      }
    }
  }

  if (dominator === null) {
    dominator = frontier[0]!;
  }

  return {
    onFrontier: false,
    dominator,
    scoreDeficit: Math.max(0, dominator.score - point.score),
    budgetRatio: point.budget / dominator.budget,
  };
}

/**
 * Returns the set of point keys on the Pareto frontier that also clear the
 * capability floor (>= 75% of the frontier's peak score), filtering out
 * degenerate near-zero micro-budget points from earning "Frontier" badges.
 */
export function getQualifiedFrontierKeys(
  frontier: readonly PlottedPoint[],
  minRelativeScore = 0.75,
): Set<string> {
  if (frontier.length === 0) return new Set();
  const topScore = frontier[frontier.length - 1]!.score;
  const threshold = topScore * minRelativeScore;
  const keys = new Set<string>();
  for (const pt of frontier) {
    if (pt.score + 1e-9 >= threshold) {
      keys.add(pt.key);
    }
  }
  return keys;
}


/**
 * Groups the qualified frontier of `field` by release: each release maps to
 * the effort settings (lowest effort first) that sit on that frontier. The
 * count drives the frontier stars, one star per effort setting.
 */
export function getFrontierEffortsByRelease(
  field: readonly ModelRelease[],
  benchmark: BenchmarkId,
  axis: BudgetAxis,
): Map<string, EffortPoint[]> {
  const frontier = computeParetoFrontier(buildPlottedPoints(field, benchmark, axis));
  const qualified = getQualifiedFrontierKeys(frontier);
  const byRelease = new Map<string, EffortPoint[]>();
  for (const point of frontier) {
    if (!qualified.has(point.key)) continue;
    const efforts = byRelease.get(point.release.slug) ?? [];
    efforts.push(point.effort);
    byRelease.set(point.release.slug, efforts);
  }
  for (const efforts of byRelease.values()) {
    efforts.sort((a, b) => a.effortLevel - b.effortLevel);
  }
  return byRelease;
}
