import type {
  BudgetAxis,
  ContextMode,
  EffortSlug,
  GameBenchRun,
  ModelRelease,
  ProviderId,
  TerminalBenchRun,
} from "./types";

export type ChartBenchmark = "game-bench" | "terminal-bench";

type Point = Readonly<{
  key: string;
  release: ModelRelease;
  provider: ProviderId;
  budget: number;
  score: number;
}>;

/** One release's Terminal-Bench run on the chart. */
export type PlottedPoint = Point & Readonly<{ run: TerminalBenchRun }>;
export type BenchmarkPoint = PlottedPoint | (Point & Readonly<{ run: GameBenchRun }>);

export type FrontierComparison<T extends Point = PlottedPoint> =
  | Readonly<{
      onFrontier: true;
      previousStep: T | null;
      scoreGainOverPrevious: number | null;
    }>
  | Readonly<{
      onFrontier: false;
      dominator: T;
      scoreDeficit: number;
      budgetRatio: number;
    }>;

/**
 * What a run spent per task: dollars on the cost axis, output tokens on the
 * tokens axis. Null when the run did not report it.
 */
export function getRunBudget(run: TerminalBenchRun, axis: BudgetAxis): number | null {
  const value = axis === "cost" ? run.costPerTaskUsd : run.tokensPerTask.output;
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

/** The lowest and highest budget and score a chart has to show. */
export type ChartBounds = Readonly<{
  budget: readonly [number, number];
  score: readonly [number, number];
}>;

/**
 * Chart axes for each budget axis, from a fixed set of releases. A chart
 * given a scale keeps its axes while the selection, the cohort or the lab
 * filter changes, so models compare by position.
 */
export type ChartScale = Readonly<Record<BudgetAxis, ChartBounds | null>>;

export function getChartScale(
  releases: readonly ModelRelease[],
  benchmark: ChartBenchmark = "terminal-bench",
): ChartScale {
  const bounds = (axis: BudgetAxis): ChartBounds | null => {
    const points = buildBenchmarkPoints(releases, axis, benchmark);
    if (points.length === 0) return null;
    const budgets = points.map((p) => p.budget);
    const scores = points.map((p) => p.score);
    return {
      budget: [Math.min(...budgets), Math.max(...budgets)],
      score: [Math.min(...scores), Math.max(...scores)],
    };
  };
  return { cost: bounds("cost"), tokens: bounds("tokens") };
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

/** One point per release with a Terminal-Bench run that reported the budget. */
export function buildPlottedPoints(
  releases: readonly ModelRelease[],
  axis: BudgetAxis,
): PlottedPoint[] {
  const points: PlottedPoint[] = [];
  for (const release of releases) {
    const run = release.terminalBench;
    if (!run || !Number.isFinite(run.accuracy)) continue;
    const budget = getRunBudget(run, axis);
    if (budget === null) continue;
    points.push({
      key: release.slug,
      release,
      run,
      provider: release.provider,
      budget,
      score: run.accuracy,
    });
  }
  return points;
}

export function buildBenchmarkPoints(
  releases: readonly ModelRelease[],
  axis: BudgetAxis,
  benchmark: ChartBenchmark,
): BenchmarkPoint[] {
  if (benchmark === "terminal-bench") return buildPlottedPoints(releases, axis);
  if (axis === "tokens") return [];
  return releases.flatMap((release) =>
    (release.gameBench ?? []).map((run) => ({
      key: `${release.slug}:${run.effort}`,
      release,
      run,
      provider: release.provider,
      budget: run.costPerProgramUsd,
      score: run.score,
    })),
  );
}

/** The explicitly inspected effort, or the highest score at the lowest cost. */
export function primaryPoint(
  points: readonly BenchmarkPoint[],
  effort?: EffortSlug | null,
): BenchmarkPoint | null {
  if (effort) {
    const chosen = points.find((p) => p.run.effort === effort);
    if (chosen) return chosen;
  }
  return points.reduce<BenchmarkPoint | null>((best, point) => {
    if (!best || point.score > best.score || (point.score === best.score && point.budget < best.budget)) {
      return point;
    }
    return best;
  }, null);
}

/**
 * Computes the strict Pareto-optimal frontier (minimize budget x, maximize score y).
 * Returned points are strictly increasing in both budget and score.
 */
export function computeParetoFrontier<T extends Point>(points: readonly T[]): T[] {
  const EPS = 1e-9;
  const sorted = [...points].sort((a, b) => {
    if (Math.abs(a.budget - b.budget) > EPS) return a.budget - b.budget;
    if (Math.abs(b.score - a.score) > EPS) return b.score - a.score;
    return a.key.localeCompare(b.key);
  });

  const frontier: T[] = [];
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

export function comparePointToFrontier<T extends Point>(
  point: T,
  frontier: readonly T[],
): FrontierComparison<T> {
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
  let dominator: T | null = null;
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
  frontier: readonly Point[],
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

/** Slugs of the releases on the qualified frontier of `field`: the starred ones. */
export function getFrontierReleases(
  field: readonly ModelRelease[],
  axis: BudgetAxis,
  benchmark: ChartBenchmark = "terminal-bench",
): Set<string> {
  const frontier = computeParetoFrontier(buildBenchmarkPoints(field, axis, benchmark));
  const keys = getQualifiedFrontierKeys(frontier);
  return new Set(frontier.filter((p) => keys.has(p.key)).map((p) => p.release.slug));
}

/**
 * Each release's star as the chart shows it when that release is selected:
 * whether it sits on the qualified frontier of the field the chart plots for
 * it. In release mode that field is what existed on its release day, so a
 * model keeps the star it launched with; in live mode it is today's models.
 * Both respect the lab filter, as the chart does.
 */
export function getContextualFrontierReleases(
  allReleases: readonly ModelRelease[],
  axis: BudgetAxis,
  mode: ContextMode,
  enabledProviders?: ReadonlySet<ProviderId>,
  benchmark: ChartBenchmark = "terminal-bench",
): Set<string> {
  const starred = new Set<string>();
  for (const release of allReleases) {
    if (benchmark === "game-bench" ? !release.gameBench?.length : !release.terminalBench) continue;
    const field = getContextualReleases(allReleases, release, mode, enabledProviders);
    if (getFrontierReleases(field, axis, benchmark).has(release.slug)) starred.add(release.slug);
  }
  return starred;
}
