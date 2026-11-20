import { describe, expect, test } from "bun:test";
import rawDataset from "../data/releases.json";
import { buildLineup, familyOf, TIER_LABELS, tierOf } from "./lineup";
import { release } from "./test-fixtures";
import type { ModelRelease, ReleaseDataset } from "./types";

const dataset = rawDataset as unknown as ReleaseDataset;

function priced(r: ModelRelease, outputPer1M: number): ModelRelease {
  return { ...r, pricing: { ...r.pricing, outputPer1M } };
}

describe("lineup", () => {
  test("familyOf keeps only the model line", () => {
    expect(familyOf("Claude Opus 5.5")).toBe("opus");
    expect(familyOf("GPT-6.2 Sol")).toBe("sol");
    expect(familyOf("GPT-6 Luna")).toBe("luna");
    expect(familyOf("Gemini 3.5 Flash-Lite")).toBe("flash-lite");
  });

  test("each lab's second line sits in the same tier, current or superseded", () => {
    const releases = [
      release("opus-55", "Claude Opus 5.5", "anthropic", "2026-09-22", null, [["high", 50, 5]]),
      release("opus-5", "Claude Opus 5", "anthropic", "2026-07-24", "2026-09-22", [["high", 40, 5]]),
      release("sol-62", "GPT-6.2 Sol", "openai", "2026-11-17", null, [["high", 52, 3]]),
      release("neon", "Gemini 4 Neon", "google", "2026-11-18", null, [["high", 49, 4]]),
      release("fable", "Claude Fable 5.2", "anthropic", "2026-11-09", null, [["high", 55, 9]]),
    ];
    const lineup = buildLineup(releases);
    expect(lineup.current.map((g) => [g.label, g.releases.map((r) => r.slug)])).toEqual([
      [TIER_LABELS[0], ["fable"]],
      [TIER_LABELS[1], ["opus-55", "sol-62", "neon"]],
    ]);
    expect(lineup.superseded.map((g) => [g.label, g.releases.map((r) => r.slug)])).toEqual([
      [TIER_LABELS[1], ["opus-5"]],
    ]);
  });

  test("a line not listed yet joins the current model nearest in output price", () => {
    const releases = [
      priced(release("fable", "Claude Fable 5.2", "anthropic", "2026-11-09", null, []), 40),
      priced(release("haiku", "Claude Haiku 5.5", "anthropic", "2026-10-07", null, []), 0.5),
      priced(release("luna", "GPT-6 Luna", "openai", "2026-09-22", null, []), 0.5),
    ];
    const pricey = priced(release("x", "Gemini 4 Krypton", "google", "2026-12-01", null, []), 30);
    const cheap = priced(release("y", "Gemini 4 Helium", "google", "2026-12-01", null, []), 0.6);
    expect(tierOf(pricey, [...releases, pricey])).toBe(0);
    expect(tierOf(cheap, [...releases, cheap])).toBe(TIER_LABELS.length - 1);
  });

  test("the dataset's Claude Opus 5.5 and GPT-6.2 Sol are siblings", () => {
    const find = (name: string) => dataset.releases.find((r) => r.name === name)!;
    const opus = find("Claude Opus 5.5");
    const sol = find("GPT-6.2 Sol");
    expect(tierOf(opus, dataset.releases)).toBe(tierOf(sol, dataset.releases));
  });

  test("every release appears once, current and superseded apart", () => {
    const lineup = buildLineup(dataset.releases);
    const current = lineup.current.flatMap((g) => g.releases);
    const superseded = lineup.superseded.flatMap((g) => g.releases);
    expect(current.every((r) => !r.deprecated)).toBe(true);
    expect(superseded.every((r) => r.deprecated)).toBe(true);
    expect(new Set([...current, ...superseded].map((r) => r.slug)).size).toBe(
      dataset.releases.length,
    );
    expect(current.length + superseded.length).toBe(dataset.releases.length);
  });
});
