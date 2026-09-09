import { describe, expect, test } from "bun:test";

import packageJson from "../package.json";
import {
  homeHeading,
  homeLede,
  notFoundRecoveryLinks,
  notFoundSearchSite,
  searchSite,
  site,
} from "./site";

describe("AI Charts public positioning", () => {
  test("keeps umbrella metadata general and decision-oriented", () => {
    expect(searchSite.title).toBe(
      "AI Model & Agent Comparison Charts | AI Charts",
    );
    expect(homeHeading).toBe("Compare AI models");
    for (const dimension of ["coding", "reasoning", "research", "memory", "images", "video", "world models"]) {
      expect(site.description).toContain(dimension);
    }
    expect(site.description).toContain("published results");
    expect(site.description).toContain("configurations");
    expect(homeLede).toBe("Understand the tradeoff between capability and cost.");
    expect(homeLede.length).toBeLessThan(80);
    expect(homeLede).not.toMatch(/universal|definitive|best model overall/iu);
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
      { href: "/", label: "Comparison chart" },
      { href: "/models", label: "Model cards" },
      { href: "/data", label: "Dataset" },
      { href: "/blog", label: "Benchmark analysis" },
      { href: "/llms.txt", label: "Site guide" },
      { href: "/sitemap.xml", label: "Sitemap" },
    ]);
  });

  test("keeps the canonical repository description in the strategy", async () => {
    const strategy = await Bun.file(
      new URL("../docs/seo-strategy.md", import.meta.url),
    ).text();

    expect(packageJson.description).toBe(
      "Open-source AI benchmark charts for comparing models and agents across performance, cost, speed, and token use.",
    );
    expect(strategy).toContain(`> ${packageJson.description}`);
    expect(strategy).toContain(
      "homepage-owned identity, including explicit indexable robots, so 404 responses keep a distinct title, noindex, and no homepage canonical",
    );
  });
});
