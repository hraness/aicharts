import { describe, expect, test } from "bun:test";
import { ImageResponse } from "next/og";

import { MODEL_CARD_PRESENTATIONS } from "@/lib/model-card-collection";

import { ModelCardRasterFace, ModelCardSocialImage } from "./model-card-image";

function pngDimensions(bytes: ArrayBuffer): Readonly<{ height: number; width: number }> {
  const view = new DataView(bytes);
  expect(Array.from(new Uint8Array(bytes, 0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  return { height: view.getUint32(20), width: view.getUint32(16) };
}

describe("model card ImageResponse rendering", () => {
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
