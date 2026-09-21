import { selectAtlasModelProfiles, sortAtlasPoints, type BenchmarkAtlasDataset, type BenchmarkAtlasPoint } from "./benchmark-atlas";
import { formatAtlasCost, formatAtlasScore } from "./benchmark-atlas-view";

/**
 * A reader who lands on a chart should get the conclusion in words before they read the
 * bars. Every sentence here is derived from the checked snapshot, so a refresh moves the
 * prose with the data and no one has to remember to rewrite a paragraph.
 *
 * Nothing is inferred. The leader, the gap, and the cost comparison are all values the
 * dataset already holds, and each sentence states the rule it applied so a reader can
 * check it against the chart.
 */

/** Percentage points. Wider than a rounding artifact, narrow enough to mean "close". */
const COMPARABLE_MARGIN = 5;
/** Below this, "cheaper" is the honest claim and a multiple would overstate the gap. */
const NOTABLE_COST_RATIO = 2;

function isBetter(dataset: BenchmarkAtlasDataset, candidate: number, reference: number): boolean {
  return dataset.score.direction === "higher" ? candidate > reference : candidate < reference;
}

/** Distance in the direction that counts as worse, so it is always a positive shortfall. */
function shortfall(dataset: BenchmarkAtlasDataset, candidate: number, leader: number): number {
  return dataset.score.direction === "higher" ? leader - candidate : candidate - leader;
}

/**
 * Effort-only cohorts keep every configuration of one system, so the model name alone can
 * appear twice. Add the distinguisher the source already published rather than dropping a
 * row or inventing a name.
 */
function namer(points: readonly BenchmarkAtlasPoint[]): (point: BenchmarkAtlasPoint) => string {
  const counts = new Map<string, number>();
  for (const point of points) counts.set(point.model, (counts.get(point.model) ?? 0) + 1);
  return point => {
    if ((counts.get(point.model) ?? 0) < 2) return point.model;
    const qualifier = point.effort ?? point.harness ?? (point.label === point.model ? null : point.label);
    return qualifier === null ? point.model : `${point.model} (${qualifier})`;
  };
}

function score(dataset: BenchmarkAtlasDataset, point: BenchmarkAtlasPoint): string {
  return formatAtlasScore(point.score, dataset.score.unit);
}

function overlaps(left: BenchmarkAtlasPoint, right: BenchmarkAtlasPoint): boolean | null {
  if (left.uncertainty === null || right.uncertainty === null) return null;
  return left.uncertainty.lower <= right.uncertainty.upper && right.uncertainty.lower <= left.uncertainty.upper;
}

function leadSentence(dataset: BenchmarkAtlasDataset, ranked: readonly BenchmarkAtlasPoint[], name: (point: BenchmarkAtlasPoint) => string): string {
  const [leader, runnerUp] = ranked;
  if (runnerUp === undefined) return `${name(leader)} is the only charted configuration, at ${score(dataset, leader)}.`;
  const tied = ranked.filter(point => point.score === leader.score);
  if (tied.length > 1) {
    const names = tied.slice(0, 3).map(name);
    const label = tied.length > 3
      ? `${names.join(", ")} and ${tied.length - 3} more`
      : names.length === 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
    return `${label} share the top score at ${score(dataset, leader)}.`;
  }
  return `${name(leader)} leads at ${score(dataset, leader)}, ahead of ${name(runnerUp)} at ${score(dataset, runnerUp)}.`;
}

/**
 * The exact interval type differs by source and is named in the chart caption and the
 * inspector, so this sentence reports only whether the two ranges meet.
 */
function separationSentence(ranked: readonly BenchmarkAtlasPoint[]): string | null {
  const [leader, runnerUp] = ranked;
  if (runnerUp === undefined || leader.score === runnerUp.score) return null;
  const overlap = overlaps(leader, runnerUp);
  if (overlap === null) return null;
  return overlap
    ? "Their reported uncertainty ranges overlap, so this source does not separate the top two."
    : "Their reported uncertainty ranges do not overlap.";
}

function costSentence(dataset: BenchmarkAtlasDataset, ranked: readonly BenchmarkAtlasPoint[], name: (point: BenchmarkAtlasPoint) => string): string | null {
  // A margin in points only means something on a percentage scale. Elo and Arena ratings
  // are relative, so "within five points" would be an invented claim there.
  if (dataset.score.unit !== "%" || dataset.costLabel === undefined) return null;
  const leader = ranked[0];
  const leaderCost = leader.costUsd;
  if (leaderCost === null || leaderCost <= 0) return null;
  const comparable = ranked.filter((point): point is BenchmarkAtlasPoint & { costUsd: number } => (
    point.id !== leader.id
    && point.costUsd !== null
    && point.costUsd > 0
    && point.costUsd < leaderCost
    && shortfall(dataset, point.score, leader.score) <= COMPARABLE_MARGIN
  ));
  if (comparable.length === 0) return null;
  const cheapest = comparable.reduce((best, point) => point.costUsd < best.costUsd ? point : best);
  const ratio = leaderCost / cheapest.costUsd;
  const cheaper = ratio >= NOTABLE_COST_RATIO
    ? `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× less than the leader's ${formatAtlasCost(leaderCost)}`
    : `cheaper than the leader's ${formatAtlasCost(leaderCost)}`;
  const gap = shortfall(dataset, cheapest.score, leader.score);
  const gapLabel = gap <= 0 ? "matches the leader's score" : `gives up ${formatAtlasScore(gap, "%")}`;
  return `Within ${COMPARABLE_MARGIN} points of the leader, the cheapest result is ${name(cheapest)} at ${formatAtlasCost(cheapest.costUsd)}, ${cheaper}, and it ${gapLabel}.`;
}

function spreadSentence(dataset: BenchmarkAtlasDataset, ranked: readonly BenchmarkAtlasPoint[]): string | null {
  if (ranked.length < 3) return null;
  const worst = ranked.at(-1)!;
  if (!isBetter(dataset, ranked[0].score, worst.score)) return null;
  // Read low to high regardless of which end is better; the leader is already named above.
  const [low, high] = ranked[0].score < worst.score ? [ranked[0], worst] : [worst, ranked[0]];
  return `${ranked.length} systems span ${score(dataset, low)} to ${score(dataset, high)}.`;
}

/**
 * Sentences describing the whole charted cohort, not the reader's current filter, so the
 * summary stays stable while they explore and is present in the server-rendered HTML.
 * Effort-only variants of one system collapse first, so the top two are two systems.
 */
export function atlasTakeaways(dataset: BenchmarkAtlasDataset): readonly string[] {
  if (dataset.points.length === 0) return [];
  const ranked = selectAtlasModelProfiles(sortAtlasPoints(dataset));
  const name = namer(ranked);
  return [
    leadSentence(dataset, ranked, name),
    separationSentence(ranked),
    costSentence(dataset, ranked, name),
    spreadSentence(dataset, ranked),
  ].filter((sentence): sentence is string => sentence !== null);
}
