import { describe, expect, test } from "bun:test";
import rawDataset from "../data/releases.json";
import {
  buildPlottedPoints,
  comparePointToFrontier,
  computeParetoFrontier,
  getContextualFrontierEfforts,
  getContextualReleases,
  getFrontierEffortsByRelease,
  getQualifiedFrontierKeys,
} from "./pareto";
import { release } from "./test-fixtures";
import type { ProviderId, ReleaseDataset } from "./types";

const dataset = rawDataset as unknown as ReleaseDataset;

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

  test("computeParetoFrontier yields strictly increasing budget and score", () => {
    for (const metric of ["coding", "terminalBench4", "frontierCode2", "intelligence"] as const) {
      for (const axis of ["cost", "tokens"] as const) {
        const points = buildPlottedPoints(dataset.releases, metric, axis);
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
    const points = buildPlottedPoints(live, "coding", "cost");
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
    for (const metric of ["coding", "terminalBench4", "frontierCode2", "intelligence"] as const) {
      const frontier = computeParetoFrontier(buildPlottedPoints(live, metric, "cost"));
      const qualified = getQualifiedFrontierKeys(frontier);
      const top = frontier[frontier.length - 1]!;
      expect(qualified.has(top.key)).toBe(true);
      for (const point of frontier) {
        expect(qualified.has(point.key)).toBe(point.score + 1e-9 >= top.score * 0.75);
      }
    }
    expect(getQualifiedFrontierKeys([]).size).toBe(0);
  });

  test("getFrontierEffortsByRelease groups the qualified frontier by release, lowest effort first", () => {
    const live = dataset.releases.filter((r) => !r.deprecated);
    const qualified = getQualifiedFrontierKeys(
      computeParetoFrontier(buildPlottedPoints(live, "coding", "cost")),
    );
    const byRelease = getFrontierEffortsByRelease(live, "coding", "cost");

    const stars = [...byRelease.values()].reduce((n, efforts) => n + efforts.length, 0);
    expect(stars).toBe(qualified.size);
    for (const [slug, efforts] of byRelease) {
      expect(efforts.length).toBeGreaterThan(0);
      for (let i = 1; i < efforts.length; i++) {
        expect(efforts[i]!.effortLevel).toBeGreaterThan(efforts[i - 1]!.effortLevel);
      }
      for (const effort of efforts) {
        expect(qualified.has(`${slug}:${effort.effortSlug}`)).toBe(true);
      }
    }
  });

  test("each release's stars match what its effort table shows when selected", () => {
    const slugs = (efforts: readonly { effortSlug: string }[]) => efforts.map((e) => e.effortSlug);
    for (const mode of ["release", "live"] as const) {
      for (const providers of [undefined, new Set<ProviderId>(["google"])]) {
        const stars = getContextualFrontierEfforts(dataset.releases, "coding", "cost", mode, providers);
        for (const rel of dataset.releases) {
          const field = getContextualReleases(dataset.releases, rel, mode, providers);
          const qualified = getQualifiedFrontierKeys(
            computeParetoFrontier(buildPlottedPoints(field, "coding", "cost")),
          );
          const expected = [...rel.efforts]
            .filter((e) => qualified.has(`${rel.slug}:${e.effortSlug}`))
            .sort((a, b) => a.effortLevel - b.effortLevel);
          expect(slugs(stars.get(rel.slug) ?? [])).toEqual(slugs(expected));
        }
      }
    }
  });

  test("a model keeps its release-day stars after a newer model beats it", () => {
    const older = release("model-a", "Model A", "google", "2027-01-01", null, [
      ["low", 40, 1],
      ["high", 50, 2],
    ]);
    const newer = release("model-b", "Model B", "openai", "2027-02-01", null, [
      ["low", 45, 0.5],
      ["high", 60, 1],
    ]);
    const field = [newer, older];
    const starred = (mode: "release" | "live", providers?: ReadonlySet<ProviderId>) =>
      Object.fromEntries(
        [...getContextualFrontierEfforts(field, "coding", "cost", mode, providers)].map(
          ([slug, efforts]) => [slug, efforts.map((e) => e.effortSlug)],
        ),
      );

    expect(starred("release")).toEqual({ "model-a": ["low", "high"], "model-b": ["low", "high"] });
    expect(starred("live")).toEqual({ "model-b": ["low", "high"] });
    // With only Google shown, Model A leads its live field again. (Model B's own
    // row is hidden by that filter; selecting it would still plot it.)
    expect(starred("live", new Set<ProviderId>(["google"]))["model-a"]).toEqual(["low", "high"]);
  });

  test("live stars across all labs match the static pages' stars", () => {
    const current = dataset.releases.filter((r) => !r.deprecated);
    const explorer = getContextualFrontierEfforts(dataset.releases, "coding", "cost", "live");
    const pages = getFrontierEffortsByRelease(current, "coding", "cost");
    for (const rel of current) {
      expect((explorer.get(rel.slug) ?? []).map((e) => e.effortSlug)).toEqual(
        (pages.get(rel.slug) ?? []).map((e) => e.effortSlug),
      );
    }
  });
});
