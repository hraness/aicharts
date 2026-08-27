import { describe, expect, test } from "bun:test";
import { ImageResponse } from "next/og";
import { renderToStaticMarkup } from "react-dom/server";

import { MODEL_CARD_PRESENTATIONS } from "@/lib/model-card-collection";
import { modelCardProviderColors } from "@/lib/model-card-art-direction";

import { ModelCardRasterFace, ModelCardSocialImage } from "./model-card-image";

function pngDimensions(bytes: ArrayBuffer): Readonly<{ height: number; width: number }> {
  const view = new DataView(bytes);
  expect(Array.from(new Uint8Array(bytes, 0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  return { height: view.getUint32(20), width: view.getUint32(16) };
}

describe("model card ImageResponse rendering", () => {
  test("keeps the collectible identity focused on title, harness, and serial", () => {
    const card = MODEL_CARD_PRESENTATIONS.find(candidate => candidate.model.includes("with fallback"));
    expect(card).toBeDefined();
    if (card === undefined) return;

    const portrait = renderToStaticMarkup(<ModelCardRasterFace card={card} />);
    const social = renderToStaticMarkup(<ModelCardSocialImage card={card} />);
    for (const markup of [portrait, social]) {
      expect(markup).toContain(">Fable 5 Max</span>");
      expect(markup).toContain(`>${card.harnessLabel}</span>`);
      expect(markup).toContain("aicharts.io");
      expect(markup).not.toContain("with fallback");
      expect(markup).not.toContain("Artificial Analysis");
      expect(markup).not.toContain(card.sourceDate);
      expect(markup).not.toMatch(/\bconfigs?\b/iu);
      expect(markup).not.toContain("benchmark profile");
    }
  });

  test("renders the shared illuminated geometry at every density", async () => {
    for (const density of [1, 2, 3, 4, 5] as const) {
      const card = MODEL_CARD_PRESENTATIONS.find(candidate => (
        candidate.illuminationDensity === density
      ));
      expect(card).toBeDefined();
      if (card === undefined) continue;
      const markup = renderToStaticMarkup(<ModelCardRasterFace card={card} />);
      expect(markup).toContain(`data-illumination-density="${density}"`);
      expect(markup).toContain(`data-illumination-accent="${card.accentFamily}"`);
      expect(markup).not.toContain("data-card-filigree");
      expect(markup).not.toContain("model-card-face__class");
      const raster = await new ImageResponse(<ModelCardRasterFace card={card} compact />, {
        height: 350,
        width: 250,
      }).arrayBuffer();
      expect(pngDimensions(raster)).toEqual({ height: 350, width: 250 });
    }
  }, 20_000);

  test("keeps every provider emblem compatible with the PNG renderer", async () => {
    const cardByProvider = new Map(MODEL_CARD_PRESENTATIONS.map(card => [card.providerId, card]));
    expect([...cardByProvider.keys()].sort()).toEqual(Object.keys(modelCardProviderColors).sort());
    for (const card of cardByProvider.values()) {
      const markup = renderToStaticMarkup(<ModelCardRasterFace card={card} compact />);
      expect(markup).toMatch(/data-illumination-motif="[^"]+"/u);
      const raster = await new ImageResponse(<ModelCardRasterFace card={card} compact />, {
        height: 350,
        width: 250,
      }).arrayBuffer();
      expect(pngDimensions(raster)).toEqual({ height: 350, width: 250 });
    }
  }, 40_000);

  test("renders the portrait download and social preview as valid PNGs", async () => {
    const card = MODEL_CARD_PRESENTATIONS.find(candidate => candidate.cardClass === "max");
    expect(card).toBeDefined();
    if (card === undefined) return;

    const portrait = await new ImageResponse(<ModelCardRasterFace card={card} />, {
      height: 1400,
      width: 1000,
    }).arrayBuffer();
    expect(pngDimensions(portrait)).toEqual({ height: 1400, width: 1000 });

    const social = await new ImageResponse(<ModelCardSocialImage card={card} />, {
      height: 630,
      width: 1200,
    }).arrayBuffer();
    expect(pngDimensions(social)).toEqual({ height: 630, width: 1200 });

    const provisional = {
      ...card,
      canonicalModelId: "unlisted/an-extremely-long-newly-observed-upstream-model-identity.a1234567890abcdef",
      displayTitle: "An Extremely Long Newly Observed Upstream Model Name With Experimental Capabilities X-high",
      harnessLabel: "An Extremely Long Experimental Agent Harness",
      model: "An Extremely Long Newly Observed Upstream Model Name With Experimental Capabilities",
      path: "/models/unlisted/an-extremely-long-newly-observed-upstream-model-identity.a1234567890abcdef/upstream-an-extremely-long-setting.a1234567890abcdef" as const,
      profileLabel: "An Extremely Long Experimental Upstream Setting",
      profileSlug: "upstream.an-extremely-long-experimental-upstream-setting.a1234567890abcdef",
      providerName: "An Extremely Long Experimental Research Provider",
    };
    const provisionalSocial = await new ImageResponse(<ModelCardSocialImage card={provisional} />, {
      height: 630,
      width: 1200,
    }).arrayBuffer();
    expect(pngDimensions(provisionalSocial)).toEqual({ height: 630, width: 1200 });
  }, 30_000);
});
