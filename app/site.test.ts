import { describe, expect, test } from "bun:test";

import packageJson from "../package.json";
import { homeHeading, notFoundRecoveryLinks, notFoundSearchSite, searchSite, site } from "./site";

describe("AI Charts public positioning", () => {
  test("keeps umbrella metadata general and decision-oriented", () => {
    expect(searchSite.title).toBe(
      "AI Model & Agent Comparison Charts | AI Charts",
    );
    expect(homeHeading).toBe("AI model and agent comparison charts");
    expect(site.description).toContain("AI models and agents");
    expect(site.description).toContain("performance, cost, speed, and token use");
    expect(site.description).not.toContain("coding");
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
      { href: "/gpt-subsidy", label: "GPT subsidy history" },
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
