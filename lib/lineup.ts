import type { ModelRelease, ProviderId } from "./types";

/** The model line inside a lab: "GPT-6.2 Sol" is "sol", "Claude Opus 5.5" is "opus". */
export function familyOf(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => !/^(claude|gemini|gpt-[\d.]+|[\d.]+)$/.test(word))
    .join(" ");
}

/**
 * Each lab's model lines by their place in its lineup, flagship first. Lines
 * at the same place are cross-lab siblings: Claude Opus sits with GPT Sol and
 * Gemini Neon. Superseded releases keep their line's place.
 */
const LINEUPS: Readonly<Record<ProviderId, readonly (readonly string[])[]>> = {
  anthropic: [["fable"], ["opus"], ["sonnet"], ["haiku"]],
  openai: [["astra"], ["sol"], ["terra"], ["luna"]],
  google: [["carbon"], ["neon"], ["argon"], ["hydrogen", "flash", "flash-lite"]],
};

export const TIER_LABELS = ["Flagships", "Tier 2", "Tier 3", "Smallest"] as const;

/** Labs in the order the site lists them. */
const LAB_ORDER: readonly ProviderId[] = ["anthropic", "openai", "google"];

function lineTier(release: ModelRelease): number | undefined {
  const line = familyOf(release.name);
  const tier = LINEUPS[release.provider].findIndex((lines) => lines.includes(line));
  return tier === -1 ? undefined : tier;
}

/**
 * A release's place in its lab's lineup. A line not listed yet takes the tier
 * of the listed current model closest to it in output price.
 */
export function tierOf(release: ModelRelease, all: readonly ModelRelease[]): number {
  const listed = lineTier(release);
  if (listed !== undefined) return listed;
  let tier = TIER_LABELS.length - 1;
  let gap = Infinity;
  for (const other of all) {
    const otherTier = lineTier(other);
    if (otherTier === undefined || other.deprecated) continue;
    const distance = Math.abs(
      Math.log(other.pricing.outputPer1M) - Math.log(release.pricing.outputPer1M),
    );
    if (distance < gap) {
      gap = distance;
      tier = otherTier;
    }
  }
  return tier;
}

export type LineupGroup = Readonly<{
  tier: number;
  label: string;
  releases: readonly ModelRelease[];
}>;

export type Lineup = Readonly<{
  current: readonly LineupGroup[];
  superseded: readonly LineupGroup[];
}>;

/**
 * Current and superseded releases, each grouped by tier. Inside a tier the
 * labs keep the site's order and a lab's newer release comes first.
 */
export function buildLineup(releases: readonly ModelRelease[]): Lineup {
  const group = (list: readonly ModelRelease[]): LineupGroup[] =>
    TIER_LABELS.map((label, tier) => ({
      tier,
      label,
      releases: list
        .filter((release) => tierOf(release, releases) === tier)
        .sort(
          (a, b) =>
            LAB_ORDER.indexOf(a.provider) - LAB_ORDER.indexOf(b.provider) ||
            b.releaseDate.localeCompare(a.releaseDate) ||
            a.slug.localeCompare(b.slug),
        ),
    })).filter((g) => g.releases.length > 0);
  return {
    current: group(releases.filter((r) => !r.deprecated)),
    superseded: group(releases.filter((r) => r.deprecated)),
  };
}
