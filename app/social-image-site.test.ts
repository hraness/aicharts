import { describe, expect, mock, test } from "bun:test";

import { MODEL_CARD_PRESENTATIONS } from "@/lib/model-card-collection";
import { INDEX_MODEL_PAGES } from "@/lib/index-model-pages";

import { site } from "./site";
import {
  aichartsSocialImageAlt,
  aichartsSocialImageSite,
  blogCollectionSocialImagePage,
  codingAgentProfileSocialImageDescription,
  modelsSocialImagePage,
} from "./social-image-site";

type Rendered = Readonly<{ page: unknown; site: unknown }>;
const rendered: Rendered[] = [];

// Record what each route hands the shared template instead of drawing pixels.
mock.module("@hraness/web-discovery/social-image", () => ({
  createSiteSocialImageResponse: (siteDetails: unknown, page: unknown = {}) => {
    rendered.push({ page, site: siteDetails });
    return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
      headers: { "content-type": "image/png" },
    });
  },
  socialImageContentType: "image/png",
  socialImageSize: { height: 630, width: 1200 },
}));

async function lastRender(run: () => unknown): Promise<Rendered> {
  rendered.length = 0;
  await run();
  expect(rendered).toHaveLength(1);
  const [only] = rendered;
  if (only === undefined) throw new Error("Expected one social-image render.");
  return only;
}

describe("aicharts social-image declaration", () => {
  test("declares the real app mark, light brand colours, and brand copy once", () => {
    expect(aichartsSocialImageSite.name).toBe(site.name);
    expect(aichartsSocialImageSite.domain).toBe(site.domain);
    const icon = aichartsSocialImageSite.icon;
    expect(icon?.kind).toBe("mark");
    expect(icon?.src).toStartWith("data:image/svg+xml,");
    expect(decodeURIComponent(icon?.src ?? "")).toContain('viewBox="0 0 497 580"');
    expect(aichartsSocialImageSite.theme).toEqual({
      accent: "#2474d4",
      background: "#e1e2e7",
      foreground: "#1c3161",
      muted: "#414c76",
    });
  });

  test("every route renders the shared template with the site declaration and page copy only", async () => {
    const home = await import("./opengraph-image");
    const blog = await import("./blog/opengraph-image");
    const models = await import("./models/opengraph-image");
    const modelProfile = await import("./models/[creatorSlug]/[modelSlug]/[profileSlug]/opengraph-image");

    for (const route of [home, blog, models, modelProfile]) {
      expect(route.contentType).toBe("image/png");
      expect(route.size).toEqual({ height: 630, width: 1200 });
    }
    expect(home.alt).toBe(aichartsSocialImageAlt());

    expect(await lastRender(() => home.default())).toEqual({ page: {}, site: aichartsSocialImageSite });
    expect(await lastRender(() => blog.default())).toEqual({
      page: blogCollectionSocialImagePage,
      site: aichartsSocialImageSite,
    });
    expect(await lastRender(() => models.default())).toEqual({
      page: modelsSocialImagePage,
      site: aichartsSocialImageSite,
    });
    for (const version of [5, 6, 7, 8]) {
      const legacy = await import(`./models/opengraph-image-v${version}/route`);
      expect(await lastRender(() => legacy.GET())).toEqual({
        page: modelsSocialImagePage,
        site: aichartsSocialImageSite,
      });
    }

    const card = MODEL_CARD_PRESENTATIONS[0];
    const indexPage = INDEX_MODEL_PAGES[0];
    if (card === undefined || indexPage === undefined) throw new Error("Expected model pages.");
    const [creatorSlug, modelSlug, profileSlug] = card.path.split("/").slice(2);
    expect(await lastRender(() => modelProfile.default({
      params: Promise.resolve({ creatorSlug, modelSlug, profileSlug }),
    }))).toEqual({
      page: {
        description: codingAgentProfileSocialImageDescription,
        eyebrow: card.providerName,
        headline: card.displayTitle,
      },
      site: aichartsSocialImageSite,
    });
    const [indexCreator, indexModel, indexProfile] = indexPage.path.split("/").slice(2);
    const indexRender = await lastRender(() => modelProfile.default({
      params: Promise.resolve({ creatorSlug: indexCreator, modelSlug: indexModel, profileSlug: indexProfile }),
    }));
    expect(indexRender.site).toBe(aichartsSocialImageSite);
    expect(indexRender.page).toMatchObject({ eyebrow: indexPage.providerName, headline: indexPage.displayTitle });
  });
});
