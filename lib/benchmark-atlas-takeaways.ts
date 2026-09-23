import { selectAtlasModelProfiles, sortAtlasPoints, type BenchmarkAtlasDataset, type BenchmarkAtlasPoint } from "./benchmark-atlas";
import { formatAtlasCost, formatAtlasScore } from "./benchmark-atlas-view";

/**
 * A reader who lands on a chart should get the conclusion in words before they read the
 * bars. Every sentence here is derived from the checked snapshot, so a refresh moves the
 * prose with the data and no one has to remember to rewrite a paragraph.
 *
 * Nothing is inferred. The leader, the gap, and the cost comparison are all values the
 * dataset already holds, and each sentence states the rule it applied so a reader can
 * check it against the chart. Review every template against all published cohorts after
 * a change: ties, single-system charts, lower-is-better units, and missing costs all occur
 * in the live data.
 */

/** Percentage points. Wider than a rounding artifact, narrow enough to mean "close". */
const COMPARABLE_MARGIN = 5;
/** Below this, "cheaper" is the accurate claim and a multiple would overstate the gap. */
const NOTABLE_COST_RATIO = 2;

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"] as const;
const countNumber = new Intl.NumberFormat("en-US");

/** House style spells out zero through nine in prose and uses numerals from 10. */
function count(value: number): string {
  return COUNT_WORDS[value] ?? countNumber.format(value);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type PricedPoint = BenchmarkAtlasPoint & { costUsd: number };

function priced(point: BenchmarkAtlasPoint): point is PricedPoint {
  return point.costUsd !== null && point.costUsd > 0;
}

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

/** A percentage-point difference, printed as points so it is never mistaken for a relative change. */
function pointGap(value: number): string {
  const formatted = formatAtlasScore(value, "");
  return `${formatted} ${formatted === "1" ? "point" : "points"}`;
}

/**
 * A range written once with its unit: "11.21% to 57.88%", "4.84 to 57.62 index points",
 * "6.96% to 13.88% WER", "78.44 to 96.91 out of 100".
 */
function range(dataset: BenchmarkAtlasDataset, low: number, high: number): string {
  const unit = dataset.score.unit;
  const bare = (value: number) => formatAtlasScore(value, "");
  if (unit === "%") return `${bare(low)}% to ${bare(high)}%`;
  if (unit.startsWith("% ")) return `${bare(low)}% to ${bare(high)}%${unit.slice(1)}`;
  const suffix = unit === "" || unit === "score" || unit === "points" ? ""
    : unit === "/ 100" ? " out of 100"
      : ` ${unit}`;
  return `${bare(low)} to ${bare(high)}${suffix}`;
}

function overlaps(left: BenchmarkAtlasPoint, right: BenchmarkAtlasPoint): boolean | null {
  if (left.uncertainty === null || right.uncertainty === null) return null;
  return left.uncertainty.lower <= right.uncertainty.upper && right.uncertainty.lower <= left.uncertainty.upper;
}

function topScorers(ranked: readonly BenchmarkAtlasPoint[]): readonly BenchmarkAtlasPoint[] {
  return ranked.filter(point => point.score === ranked[0].score);
}

function leadSentence(dataset: BenchmarkAtlasDataset, ranked: readonly BenchmarkAtlasPoint[], name: (point: BenchmarkAtlasPoint) => string): string {
  const [leader, runnerUp] = ranked;
  if (runnerUp === undefined) return `${name(leader)} is the only charted configuration, at ${score(dataset, leader)}.`;
  const tied = topScorers(ranked);
  if (tied.length > 1) {
    const names = tied.slice(0, 3).map(name);
    const label = tied.length > 3
      ? `${names.join(", ")} and ${count(tied.length - 3)} more`
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

/** Cheapest first; rank order breaks equal costs so the output is deterministic. */
function byCost(points: readonly PricedPoint[]): PricedPoint[] {
  return [...points].sort((left, right) => left.costUsd - right.costUsd);
}

/**
 * A tie has no single leader, so the cost comparison stays inside the tie instead of
 * treating whichever co-leader sorts first as "the leader".
 */
function tieCostSentence(tied: readonly BenchmarkAtlasPoint[], name: (point: BenchmarkAtlasPoint) => string): string | null {
  const costs = byCost(tied.filter(priced));
  const cheapest = costs[0], dearest = costs.at(-1);
  if (cheapest === undefined || dearest === undefined || cheapest.costUsd >= dearest.costUsd) return null;
  return `Among the tied leaders, costs run from ${formatAtlasCost(cheapest.costUsd)} for ${name(cheapest)} to ${formatAtlasCost(dearest.costUsd)} for ${name(dearest)}.`;
}

function costSentences(dataset: BenchmarkAtlasDataset, ranked: readonly BenchmarkAtlasPoint[], name: (point: BenchmarkAtlasPoint) => string): string[] {
  // A margin in points only means something on a percentage scale. Elo and Arena ratings
  // are relative, so "within five points" would be an invented claim there.
  if (dataset.score.unit !== "%" || dataset.costLabel === undefined) return [];
  const top = topScorers(ranked);
  const sentences: string[] = [];
  if (top.length > 1) {
    const tie = tieCostSentence(top, name);
    if (tie !== null) sentences.push(tie);
  }
  // The reference is the cheapest result with the top score: the leader, or the cheapest
  // co-leader in a tie.
  const reference = byCost(top.filter(priced))[0];
  if (reference === undefined) return sentences;
  const referenceLabel = top.length === 1 ? "the leader" : name(reference);
  const comparable = ranked.filter((point): point is PricedPoint => (
    !top.includes(point)
    && priced(point)
    && point.costUsd < reference.costUsd
    && shortfall(dataset, point.score, reference.score) <= COMPARABLE_MARGIN
  ));
  if (comparable.length === 0) return sentences;
  const cheapest = byCost(comparable)[0];
  const ratio = reference.costUsd / cheapest.costUsd;
  const gap = pointGap(shortfall(dataset, cheapest.score, reference.score));
  const [worse, better] = dataset.score.direction === "higher" ? ["lower", "higher"] : ["higher", "lower"];
  const opening = `Within ${COMPARABLE_MARGIN} percentage points of the top score, the cheapest result is ${name(cheapest)} at ${formatAtlasCost(cheapest.costUsd)}`;
  sentences.push(ratio >= NOTABLE_COST_RATIO
    ? `${opening}. ${capitalize(referenceLabel)} costs ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× as much, ${formatAtlasCost(reference.costUsd)}, and scores ${gap} ${better}.`
    : `${opening}, against ${formatAtlasCost(reference.costUsd)} for ${referenceLabel}, and it scores ${gap} ${worse}.`);
  return sentences;
}

/**
 * Profile selection keeps one row per system (model and harness) unless the chart has only
 * one system, in which case every setting stays. Count the rows by what they are.
 */
function oneSystem(ranked: readonly BenchmarkAtlasPoint[]): boolean {
  return new Set(ranked.map(point => JSON.stringify([point.provider, point.model, point.harness]))).size < ranked.length;
}

function spreadSentence(dataset: BenchmarkAtlasDataset, ranked: readonly BenchmarkAtlasPoint[]): string | null {
  if (ranked.length < 3) return null;
  const worst = ranked.at(-1)!;
  if (!isBetter(dataset, ranked[0].score, worst.score)) return null;
  // Read low to high regardless of which end is better; the leader is already named above.
  const [low, high] = ranked[0].score < worst.score ? [ranked[0], worst] : [worst, ranked[0]];
  const noun = oneSystem(ranked) ? "configurations" : "systems";
  return `Scores across the ${count(ranked.length)} charted ${noun} run from ${range(dataset, low.score, high.score)}.`;
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
    ...costSentences(dataset, ranked, name),
    spreadSentence(dataset, ranked),
  ].filter((sentence): sentence is string => sentence !== null);
}

/** The note under the takeaways: what the sentences cover, true for this chart. */
export function atlasTakeawaysBasis(dataset: BenchmarkAtlasDataset): string {
  const scope = "These sentences describe every charted result and ignore the filters above.";
  if (dataset.points.length === 0) return scope;
  return oneSystem(selectAtlasModelProfiles(sortAtlasPoints(dataset)))
    ? `${scope} Each setting of the charted system counts separately.`
    : `${scope} Each system counts once, at its best-scoring setting.`;
}
