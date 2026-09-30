import { describe, expect, mock, test } from "bun:test";

import { MODEL_CARD_PRESENTATIONS } from "@/lib/model-card-collection";
import { INDEX_MODEL_PAGES } from "@/lib/index-model-pages";

import { site } from "./site";
import {
  aichartsSocialImageAlt,
  aichartsSocialImageSite,
  blogCollectionSocialImagePage,
  codingAgentProfileSocialImagePage,
  indexModelSocialImagePage,
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
  test("declares the header's foil mark, name, and Design Kit palette once", async () => {
    expect(aichartsSocialImageSite.name).toBe(site.name);
    expect(aichartsSocialImageSite.brand).toBe(site.name);
    expect(aichartsSocialImageSite.domain).toBe(site.domain);
    // The header paints public/marks/aicharts.svg in foil; the card draws the same glyph.
    const header = await Bun.file(new URL("../components/site-header.tsx", import.meta.url)).text();
    expect(header).toContain('<FoilMark size={20} src="/marks/aicharts.svg" /> {site.name}');
    const publicMark = await Bun.file(new URL("../public/marks/aicharts.svg", import.meta.url)).text();
    expect(aichartsSocialImageSite.brandMark).toBe(publicMark.trim());
    // The card's palette is the one <html> declares.
    const layout = await Bun.file(new URL("./layout.tsx", import.meta.url)).text();
    expect(layout).toContain(`data-palette="${aichartsSocialImageSite.palette ?? ""}"`);
    expect(aichartsSocialImageSite.palette).toBe("tokyo-night");
    // v0.12 tile, accent, and wash are gone: no marketing header draws them.
    expect(aichartsSocialImageSite.icon).toBeUndefined();
    expect(aichartsSocialImageSite.theme).toBeUndefined();
    expect(aichartsSocialImageSite.keepTogether).toContain("Artificial Analysis");
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
      page: codingAgentProfileSocialImagePage(card),
      site: aichartsSocialImageSite,
    });
    const [indexCreator, indexModel, indexProfile] = indexPage.path.split("/").slice(2);
    const indexRender = await lastRender(() => modelProfile.default({
      params: Promise.resolve({ creatorSlug: indexCreator, modelSlug: indexModel, profileSlug: indexProfile }),
    }));
    expect(indexRender).toEqual({ page: indexModelSocialImagePage(indexPage), site: aichartsSocialImageSite });
  });
});
