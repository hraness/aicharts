import {
  EPOCH_BENCHMARKS,
  type CurveEffort,
  type EffortSlug,
  type EpochBenchmarkId,
  type EpochScore,
  type ModelRelease,
} from "./types";

/*
 * Reading a release's measures. Nothing here imports the dataset, so client
 * components can use it.
 */

export const EFFORT_NAMES: Readonly<Record<EffortSlug, string>> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

const EFFORT_LEVELS: readonly EffortSlug[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/** The setting's name; null is a run at the API's default setting. */
export function effortName(slug: CurveEffort | null): string {
  return slug && slug !== "default" ? EFFORT_NAMES[slug] : "Default";
}

/** The best score a release has on an Epoch benchmark; ties go to the lower setting. */
export function bestEpoch(release: ModelRelease, benchmark: EpochBenchmarkId): EpochScore | null {
  let best: EpochScore | null = null;
  for (const score of release.epoch) {
    if (score.benchmark !== benchmark) continue;
    if (
      !best ||
      score.score > best.score ||
      (score.score === best.score && effortRank(score.effort) < effortRank(best.effort))
    ) {
      best = score;
    }
  }
  return best;
}

function effortRank(effort: EffortSlug | null): number {
  return effort === null ? -1 : EFFORT_LEVELS.indexOf(effort);
}

/** A release's Epoch scores on one benchmark, lowest setting first. */
export function epochScores(release: ModelRelease, benchmark: EpochBenchmarkId): EpochScore[] {
  return release.epoch
    .filter((s) => s.benchmark === benchmark)
    .sort((a, b) => effortRank(a.effort) - effortRank(b.effort));
}

/** The Epoch benchmarks a release has at least one score on, in the site's order. */
export function epochBenchmarksOf(release: ModelRelease): EpochBenchmarkId[] {
  return EPOCH_BENCHMARKS.map((b) => b.id).filter((id) => release.epoch.some((s) => s.benchmark === id));
}

/** True when a release has any benchmark result to show. */
export function hasResults(release: ModelRelease): boolean {
  return release.terminalBench !== null || release.epoch.length > 0;
}

/**
 * What two releases can be compared on: Terminal-Bench when both have a run,
 * and each Epoch benchmark both have a score on.
 */
export function sharedMeasures(a: ModelRelease, b: ModelRelease): string[] {
  const shared: string[] = [];
  if (a.terminalBench && b.terminalBench) shared.push("terminal-bench");
  for (const id of epochBenchmarksOf(a)) {
    if (b.epoch.some((s) => s.benchmark === id)) shared.push(id);
  }
  return shared;
}
