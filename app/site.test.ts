import { productMessaging } from "./messaging";
import { describe, expect, test } from "bun:test";

import packageJson from "../package.json";
import {
  homeEyebrow,
  homeHeading,
  homeLede,
  homePrimaryAction,
  homeSecondaryAction,
  notFoundRecoveryLinks,
  modelCardTitle,
  notFoundSearchSite,
  searchSite,
  site,
} from "./site";

describe("aicharts public positioning", () => {
  test("carries the canonical product messaging", () => {
    // Search and visible copy share the checked portfolio snapshot.
    expect(searchSite.title.startsWith(`${site.name}: `)).toBeTrue();
    for (const fact of ["benchmark scores", "cost per task"]) {
      expect(searchSite.title).toContain(fact);
    }
    expect(searchSite.title.length).toBeLessThanOrEqual(60);
    expect(searchSite.title).not.toContain("&");
    expect(site.tagline).toBe(productMessaging.tagline);
    expect(site.category).toBe(productMessaging.category);
    expect(homeHeading).toBe(productMessaging.hero.heading);
    expect(homeEyebrow).toBe(site.category);
    expect(site.name).toBe(productMessaging.names.name);
    expect(site.description).toBe(productMessaging.meta);
    expect(homeLede).toBe(productMessaging.hero.summary);
    // The meta description names the two product halves: published benchmark
    // charts and the local token collector.
    expect(site.description.startsWith(`${site.name} `)).toBeTrue();
    for (const fact of ["benchmark scores", "cost", "tokens per task", "local collector"]) {
      expect(site.description).toContain(fact);
    }
    // The concise hero names the comparisons; collector context remains in the metadata and usage section.
    for (const fact of ["benchmark scores", "prices", "tokens each task"]) {
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

  test("names the reader's comparison in model page titles", () => {
    const title = modelCardTitle("Claude Opus 5.5 Max");
    expect(title.startsWith("Claude Opus 5.5 Max")).toBeTrue();
    expect(title).toContain("cost per task");
    expect(title.endsWith(`| ${site.name}`)).toBeTrue();
  });

  test("keeps the 404 page out of homepage identity", () => {
    expect(notFoundSearchSite.title).toBe("Page not found | aicharts");
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
