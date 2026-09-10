import { describe, expect, test } from "bun:test";
import { INDEXABLE_ROBOTS, NOINDEX_ROBOTS } from "@hraness/web-discovery";

import { metadata as layoutMetadata } from "./layout";
import { metadata as notFoundMetadata } from "./not-found";
import { metadata as homeMetadata } from "./page";
import { metadata as calculatorMetadata } from "./calculator/page";
import { metadata as codingMetadata } from "./coding/page";
import { metadata as benchmarksMetadata } from "./benchmarks/page";
import { homeHeading, notFoundSearchSite, searchSite, site } from "./site";

describe("page metadata ownership", () => {
  test("keeps only site-wide defaults on the root layout", () => {
    expect(layoutMetadata).toEqual({
      metadataBase: new URL(site.origin),
      applicationName: site.name,
    });
    expect(layoutMetadata).not.toHaveProperty("alternates");
    expect(layoutMetadata).not.toHaveProperty("description");
    expect(layoutMetadata).not.toHaveProperty("openGraph");
    expect(layoutMetadata).not.toHaveProperty("robots");
    expect(layoutMetadata).not.toHaveProperty("title");
    expect(layoutMetadata).not.toHaveProperty("twitter");
  });

  test("lets the homepage own indexable identity", () => {
    expect(homeMetadata).toMatchObject({
      title: searchSite.title,
      description: searchSite.description,
      alternates: { canonical: "https://aicharts.io/" },
      robots: INDEXABLE_ROBOTS,
      openGraph: {
        type: "website",
        url: "https://aicharts.io/",
        title: searchSite.title,
        description: searchSite.description,
      },
      twitter: { card: "summary_large_image", title: searchSite.title },
    });
    expect(homeHeading).toBe("Compare AI models");
  });

  test("gives focused comparison workspaces distinct indexable identities", () => {
    for (const [metadata, path, title] of [
      [codingMetadata, "/coding", "Coding agent comparisons | AI Charts"],
      [benchmarksMetadata, "/benchmarks", "AI benchmark explorer | AI Charts"],
      [calculatorMetadata, "/calculator", "ChatGPT Pro vs API vs GPUs you buy or rent | AI Charts"],
    ] as const) {
      expect(metadata).toMatchObject({
        title,
        alternates: { canonical: `https://aicharts.io${path}` },
        robots: INDEXABLE_ROBOTS,
        openGraph: { type: "website", url: `https://aicharts.io${path}`, title },
        twitter: { card: "summary_large_image", title },
      });
      expect(metadata.description).toBeString();
      expect(metadata.description).not.toBe(homeMetadata.description);
    }
  });

  test("gives 404 a distinct title, noindex, and no homepage canonical", () => {
    expect(notFoundMetadata).toEqual({
      metadataBase: new URL(site.origin),
      title: notFoundSearchSite.title,
      description: notFoundSearchSite.description,
      applicationName: site.name,
      robots: NOINDEX_ROBOTS,
    });
    expect(notFoundMetadata).not.toHaveProperty("alternates");
    expect(notFoundMetadata).not.toHaveProperty("openGraph");
    expect(notFoundMetadata).not.toHaveProperty("twitter");
    expect(notFoundMetadata.title).not.toBe(searchSite.title);
    expect(notFoundMetadata.description).not.toBe(searchSite.description);
  });
});
