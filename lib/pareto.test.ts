import { describe, expect, test } from "bun:test";
import rawDataset from "../data/releases.json";
import {
  buildPlottedPoints,
  comparePointToFrontier,
  computeParetoFrontier,
  getChartScale,
  getContextualFrontierReleases,
  getContextualReleases,
  getFrontierReleases,
  getQualifiedFrontierKeys,
} from "./pareto";
import { release, run } from "./test-fixtures";
import type { ProviderId, ReleaseDataset } from "./types";

const dataset = rawDataset as unknown as ReleaseDataset;
const AXES = ["cost", "tokens"] as const;

describe("Pareto frontier & release context", () => {
  test("dataset starts with the most recent release and covers Anthropic, OpenAI, and Google", () => {
    expect(dataset.releases.length).toBeGreaterThanOrEqual(15);
    const providers = new Set(dataset.releases.map((r) => r.provider));
    expect(providers).toEqual(new Set(["anthropic", "openai", "google"]));

    // Chronologically sorted newest-first
    for (let i = 1; i < dataset.releases.length; i++) {
      expect(dataset.releases[i - 1]!.releaseDate >= dataset.releases[i]!.releaseDate).toBe(true);
    }
  });

  test("each release with a run plots once, at its accuracy", () => {
    for (const axis of AXES) {
      const points = buildPlottedPoints(dataset.releases, axis);
      expect(new Set(points.map((p) => p.key)).size).toBe(points.length);
      for (const point of points) {
        expect(point.key).toBe(point.release.slug);
        expect(point.score).toBe(point.release.terminalBench!.accuracy);
        expect(point.budget).toBeGreaterThan(0);
      }
    }
    // A run without a reported cost still plots on the tokens axis.
    const free = release("free", "Free", "google", "2027-01-01", null, run(40, null));
    expect(buildPlottedPoints([free], "cost")).toHaveLength(0);
    expect(buildPlottedPoints([free], "tokens")).toHaveLength(1);
    expect(buildPlottedPoints([release("none", "None", "google", "2027-01-01", null)], "tokens")).toHaveLength(0);
  });

  test("computeParetoFrontier yields strictly increasing budget and score", () => {
    for (const axis of AXES) {
      const points = buildPlottedPoints(dataset.releases, axis);
      const frontier = computeParetoFrontier(points);
      expect(frontier.length).toBeGreaterThanOrEqual(3);

      for (let i = 1; i < frontier.length; i++) {
        expect(frontier[i]!.budget).toBeGreaterThan(frontier[i - 1]!.budget);
        expect(frontier[i]!.score).toBeGreaterThan(frontier[i - 1]!.score);
      }

      // No plotted point may strictly dominate any frontier point
      for (const f of frontier) {
        for (const p of points) {
          const strictlyBetter =
            (p.budget <= f.budget && p.score > f.score + 1e-9) ||
            (p.budget < f.budget - 1e-9 && p.score >= f.score);
          expect(strictlyBetter).toBe(false);
        }
      }
    }
  });

  test("getContextualReleases excludes future models in release mode and deprecated models in live mode", () => {
    const opus55 = dataset.releases.find((r) => r.slug === "claude-opus-5-5");
    expect(opus55).toBeDefined();

    const atOpusLaunch = getContextualReleases(dataset.releases, opus55!, "release");
    for (const r of atOpusLaunch) {
      expect(r.releaseDate <= opus55!.releaseDate).toBe(true);
    }
    // Future November 2026 models are excluded at Sep 22 launch
    expect(atOpusLaunch.some((r) => r.slug === "gemini-4-neon")).toBe(false);
    expect(atOpusLaunch.some((r) => r.slug === "claude-fable-5-2")).toBe(false);
    // GPT-6 Astra (Sep 3) was active on Sep 22 (not superseded until Nov 17)
    expect(atOpusLaunch.some((r) => r.slug === "gpt-6-astra")).toBe(true);

    // Live mode holds exactly the current releases, plus a superseded selection.
    const current = dataset.releases.filter((r) => !r.deprecated);
    const liveFromNewest = getContextualReleases(dataset.releases, current[0]!, "live");
    expect(liveFromNewest.map((r) => r.slug)).toEqual(current.map((r) => r.slug));
    const superseded = dataset.releases.find((r) => r.deprecated)!;
    const liveFromOld = getContextualReleases(dataset.releases, superseded, "live");
    expect(liveFromOld.some((r) => r.slug === superseded.slug)).toBe(true);
    expect(liveFromOld.filter((r) => r.deprecated)).toHaveLength(1);
  });

  test("comparePointToFrontier identifies frontier points and dominating points", () => {
    const live = getContextualReleases(dataset.releases, dataset.releases[0]!, "live");
    const points = buildPlottedPoints(live, "cost");
    const frontier = computeParetoFrontier(points);

    for (const f of frontier) {
      const cmp = comparePointToFrontier(f, frontier);
      expect(cmp.onFrontier).toBe(true);
    }

    const nonFrontier = points.find((p) => !frontier.some((f) => f.key === p.key));
    expect(nonFrontier).toBeDefined();
    const cmp = comparePointToFrontier(nonFrontier!, frontier);
    expect(cmp.onFrontier).toBe(false);
    if (!cmp.onFrontier) {
      expect(cmp.dominator.budget).toBeLessThanOrEqual(nonFrontier!.budget + 1e-9);
      expect(cmp.dominator.score).toBeGreaterThanOrEqual(nonFrontier!.score);
    }
  });

  test("getQualifiedFrontierKeys keeps frontier points within 75% of the top score", () => {
    const live = dataset.releases.filter((r) => !r.deprecated);
    for (const axis of AXES) {
      const frontier = computeParetoFrontier(buildPlottedPoints(live, axis));
      const qualified = getQualifiedFrontierKeys(frontier);
      const top = frontier[frontier.length - 1]!;
      expect(qualified.has(top.key)).toBe(true);
      for (const point of frontier) {
        expect(qualified.has(point.key)).toBe(point.score + 1e-9 >= top.score * 0.75);
      }
      expect(getFrontierReleases(live, axis)).toEqual(qualified);
    }
    expect(getQualifiedFrontierKeys([]).size).toBe(0);
  });

  test("each release's star matches the chart it gets when selected", () => {
    for (const mode of ["release", "live"] as const) {
      for (const providers of [undefined, new Set<ProviderId>(["google"])]) {
        const stars = getContextualFrontierReleases(dataset.releases, "cost", mode, providers);
        for (const rel of dataset.releases) {
          const field = getContextualReleases(dataset.releases, rel, mode, providers);
          expect(stars.has(rel.slug)).toBe(getFrontierReleases(field, "cost").has(rel.slug));
        }
      }
    }
  });

  test("a model keeps its release-day star after a newer model beats it", () => {
    const older = release("model-a", "Model A", "google", "2027-01-01", null, run(50, 2));
    const newer = release("model-b", "Model B", "openai", "2027-02-01", null, run(60, 1));
    const field = [newer, older];
    const starred = (mode: "release" | "live", providers?: ReadonlySet<ProviderId>) =>
      [...getContextualFrontierReleases(field, "cost", mode, providers)].sort();

    expect(starred("release")).toEqual(["model-a", "model-b"]);
    expect(starred("live")).toEqual(["model-b"]);
    // With only Google shown, Model A leads its live field again.
    expect(starred("live", new Set<ProviderId>(["google"]))).toContain("model-a");
  });

  test("live stars across all labs match the static pages' stars", () => {
    const current = dataset.releases.filter((r) => !r.deprecated);
    const explorer = getContextualFrontierReleases(dataset.releases, "cost", "live");
    const pages = getFrontierReleases(current, "cost");
    for (const rel of current) {
      expect(explorer.has(rel.slug)).toBe(pages.has(rel.slug));
    }
  });

  test("one chart scale covers every model, whatever the cohort", () => {
    const scale = getChartScale(dataset.releases);
    for (const axis of AXES) {
      const bounds = scale[axis]!;
      for (const point of buildPlottedPoints(dataset.releases, axis)) {
        expect(point.budget).toBeGreaterThanOrEqual(bounds.budget[0]);
        expect(point.budget).toBeLessThanOrEqual(bounds.budget[1]);
        expect(point.score).toBeGreaterThanOrEqual(bounds.score[0]);
        expect(point.score).toBeLessThanOrEqual(bounds.score[1]);
      }
    }
    expect(getChartScale([]).cost).toBeNull();
    // The case the scale fixes: siblings launched two months apart see
    // different fields at release, with different top scores.
    const find = (name: string) => dataset.releases.find((r) => r.name === name)!;
    const top = (name: string) =>
      Math.max(
        ...buildPlottedPoints(
          getContextualReleases(dataset.releases, find(name), "release"),
          "cost",
        ).map((p) => p.score),
      );
    expect(top("Claude Opus 5.5")).not.toBe(top("GPT-6.2 Sol"));
  });
});
