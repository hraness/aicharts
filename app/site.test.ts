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
    // The title keeps the umbrella search intent and the brand suffix.
    expect(searchSite.title.toLowerCase()).toContain("ai model and agent comparison charts");
    expect(searchSite.title.endsWith(" | AI Charts")).toBeTrue();
    expect(searchSite.title).not.toContain("&");
    expect(homeHeading).toBe("Compare AI models");
    for (const dimension of ["AI model benchmarks", "local token usage", "coding-agent sessions"]) {
      expect(site.description).toContain(dimension);
    }
    expect(site.description).toContain("published results");
    expect(site.description).toContain("configurations");
    // The lede names what the homepage chart plots: the Index score against cost or output tokens.
    for (const fact of ["Intelligence Index", "cost", "tokens"]) expect(homeLede).toContain(fact);
    expect(homeLede.length).toBeLessThan(110);
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

    // The package and repository description expand the portfolio registry line
    // ("model benchmarks and personal token usage"), and the strategy quotes it.
    expect(packageJson.description).toContain("model benchmarks and personal token usage");
    expect(packageJson.description).not.toContain("—");
    expect(strategy).toContain(`> ${packageJson.description}`);
    expect(strategy).toContain(`- description: \`${packageJson.description}\``);
    expect(strategy).toContain(
      "homepage-owned identity, including explicit indexable robots, so 404 responses keep a distinct title, noindex, and no homepage canonical",
    );
  });
});
