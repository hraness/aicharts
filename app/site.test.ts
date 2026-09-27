import { describe, expect, test } from "bun:test";

import packageJson from "../package.json";
import {
  homeEyebrow,
  homeHeading,
  homeLede,
  homePrimaryAction,
  homeSecondaryAction,
  notFoundRecoveryLinks,
  notFoundSearchSite,
  searchSite,
  site,
} from "./site";

describe("AI Charts public positioning", () => {
  test("carries the canonical product messaging", () => {
    // Canonical lines come from the portfolio messaging record (hraness/jungle
    // a9988b903): the title is the product name plus the tagline.
    expect(searchSite.title).toBe(`${site.name} | ${site.tagline}`);
    expect(searchSite.title).not.toContain("&");
    expect(site.tagline).toBe("See which model wins at each price.");
    expect(site.category).toBe("AI model comparison charts");
    expect(homeHeading).toBe(site.tagline);
    expect(homeEyebrow).toBe(site.category);
    // The meta description names the two product halves: published benchmark
    // charts and the local token collector.
    expect(site.description.startsWith(`${site.name} `)).toBeTrue();
    for (const fact of ["benchmark scores", "cost", "tokens per task", "local collector"]) {
      expect(site.description).toContain(fact);
    }
    // The hero summary names the chart and the local collector.
    for (const fact of ["Benchmark scores", "cost", "tokens per task", "local collector"]) {
      expect(homeLede).toContain(fact);
    }
    expect(homeLede.length).toBeLessThan(160);
    expect(homeLede).not.toMatch(/universal|definitive|best model overall/iu);
    expect(homePrimaryAction.href.startsWith("/")).toBeTrue();
    expect(homeSecondaryAction.href).toBe("/usage");
    expect(searchSite.description).toBe(site.description);
    expect(searchSite.origin).toBe("https://aicharts.io");
    expect(site.description.length).toBeLessThanOrEqual(160);
  });

  test("keeps the 404 page out of homepage identity", () => {
    expect(notFoundSearchSite.title).toBe("Page not found | AI Charts");
    expect(notFoundSearchSite.title).not.toBe(searchSite.title);
    expect(notFoundSearchSite.description).toBe(
      "This page does not exist. Return to the chart.",
    );
    expect(notFoundSearchSite.description).not.toBe(searchSite.description);
    expect(notFoundRecoveryLinks).toEqual([
      { href: "/", label: "Charts" },
      { href: "/models", label: "Models" },
      { href: "/data", label: "Data" },
      { href: "/blog", label: "Notes" },
      { href: "/llms.txt", label: "Site guide" },
      { href: "/sitemap.xml", label: "Sitemap" },
    ]);
  });

  test("keeps the canonical repository description in the strategy", async () => {
    const strategy = await Bun.file(
      new URL("../docs/seo-strategy.md", import.meta.url),
    ).text();

    // The package and repository descriptions carry the canonical meta line,
    // and the strategy quotes it.
    expect(packageJson.description).toBe(site.description);
    expect(packageJson.description).not.toContain("—");
    expect(strategy).toContain(`> ${packageJson.description}`);
    expect(strategy).toContain(`- description: \`${packageJson.description}\``);
    expect(strategy).toContain(
      "homepage-owned identity, including explicit indexable robots, so 404 responses keep a distinct title, noindex, and no homepage canonical",
    );
  });
});
