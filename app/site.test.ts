import { describe, expect, test } from "bun:test";

import packageJson from "../package.json";
import { searchSite, site } from "./site";

describe("AI Charts public positioning", () => {
  test("keeps umbrella metadata general and decision-oriented", () => {
    expect(searchSite.title).toBe(
      "AI Model & Agent Comparison Charts | AI Charts",
    );
    expect(site.description).toContain("AI models and agents");
    expect(site.description).toContain("performance, cost, speed, and token use");
    expect(site.description).not.toContain("coding");
    expect(site.description.length).toBeLessThanOrEqual(160);
  });

  test("keeps the canonical repository description in the strategy", async () => {
    const strategy = await Bun.file(
      new URL("../docs/seo-strategy.md", import.meta.url),
    ).text();

    expect(packageJson.description).toBe(
      "Open-source AI benchmark charts for comparing models and agents across performance, cost, speed, and token use.",
    );
    expect(strategy).toContain(`> ${packageJson.description}`);
  });
});
