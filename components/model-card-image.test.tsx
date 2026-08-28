import { describe, expect, test } from "bun:test";
import { ImageResponse } from "next/og";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MODEL_CARD_COLLECTION_CREST_LIMIT,
  MODEL_CARD_PRESENTATIONS,
  modelCardProviderCount,
  modelCardProviderRepresentatives,
} from "@/lib/model-card-collection";
import { modelCardProviderColors } from "@/lib/model-card-art-direction";
import {
  formatModelCardListingDate,
  modelCardListingAccessibleLabel,
} from "@/lib/model-card-presentation";

import {
  ModelCardCollectionSocialImage,
  ModelCardRasterFace,
  ModelCardSocialImage,
} from "./model-card-image";

function pngDimensions(bytes: ArrayBuffer): Readonly<{ height: number; width: number }> {
  const view = new DataView(bytes);
  expect(Array.from(new Uint8Array(bytes, 0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  return { height: view.getUint32(20), width: view.getUint32(16) };
}

describe("model card ImageResponse rendering", () => {
  test("keeps the collectible identity focused while naming listing provenance", () => {
    const card = MODEL_CARD_PRESENTATIONS.find(candidate => candidate.model.includes("with fallback"));
    expect(card).toBeDefined();
    if (card === undefined) return;

    const portrait = renderToStaticMarkup(<ModelCardRasterFace card={card} />);
    const social = renderToStaticMarkup(<ModelCardSocialImage card={card} />);
    expect(card.listing).not.toBeNull();
    if (card.listing === null) return;
    for (const markup of [portrait, social]) {
      expect(markup).toContain(">Fable 5 Max</span>");
      expect(markup).toContain(`>${card.harnessLabel}</span>`);
      expect(markup).toContain("aicharts.io");
      expect(markup).not.toContain("with fallback");
      expect(markup).not.toContain("Artificial Analysis");
      expect(markup).not.toContain(card.sourceDate);
      expect(markup).toContain("Listed on OpenRouter");
      expect(markup).toContain(formatModelCardListingDate(card.listing.sourceAddedAt));
      expect(markup).toContain(`dateTime="${card.listing.sourceAddedAt}"`);
      expect(markup).toContain(modelCardListingAccessibleLabel(card.listing));
      expect(markup).not.toMatch(/\bconfigs?\b/iu);
      expect(markup).not.toContain("benchmark profile");
    }
    for (const stat of [...card.performance, ...card.economics]) {
      expect(social).toContain(`>${stat.label}</span>`);
      expect(social).toContain(`>${stat.value}</span>`);
    }
    expect(social).toContain(`>${card.profileLabel} profile</span>`);
    expect(social).toContain(">illuminated benchmark specimen</span>");
    expect(social.match(/data:image\/svg\+xml;base64,/gu)).toHaveLength(1);
    expect(social).toContain(`data-emblem-family="${card.emblemIdentity.familyId}"`);
  });

  test("omits the listing imprint when no checked OpenRouter timestamp matches", () => {
    const card = MODEL_CARD_PRESENTATIONS.find(candidate => candidate.listing === null);
    expect(card).toBeDefined();
    if (card === undefined) return;

    for (const markup of [
      renderToStaticMarkup(<ModelCardRasterFace card={card} />),
      renderToStaticMarkup(<ModelCardSocialImage card={card} />),
    ]) {
      expect(markup).not.toContain("Listed on OpenRouter");
      expect(markup).not.toContain("not an official release date");
      expect(markup).not.toContain(card.sourceDate);
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

  test("reserves the compact top row for long provider identities and listing dates", () => {
    const card = MODEL_CARD_PRESENTATIONS.find(candidate => (
      candidate.providerName === "Alibaba Cloud" && candidate.listing !== null
    ));
    expect(card).toBeDefined();
    if (card === undefined) return;

    const compact = renderToStaticMarkup(<ModelCardRasterFace card={card} compact />);
    const full = renderToStaticMarkup(<ModelCardRasterFace card={card} />);
    expect(compact).toContain(">Alibaba C…</span>");
    expect(compact).toContain(">OpenRouter</span>");
    expect(compact).not.toContain(">Alibaba Cloud</span>");
    expect(compact).not.toContain(">Listed on OpenRouter</span>");
    expect(full).toContain(">Alibaba Cloud</span>");
    expect(full).toContain(">Listed on OpenRouter</span>");
  });

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

  test("renders a complete two-row provider codex for the collection image", async () => {
    const cards = modelCardProviderRepresentatives();
    const providerCount = modelCardProviderCount();
    expect(cards).toHaveLength(providerCount);
    expect(new Set(cards.map(card => card.providerId)).size).toBe(cards.length);
    for (const card of cards) {
      const providerCards = MODEL_CARD_PRESENTATIONS.filter(candidate => (
        candidate.providerId === card.providerId
      ));
      expect(Number(card.illuminationDensity)).toBe(Math.max(
        ...providerCards.map(candidate => candidate.illuminationDensity),
      ));
    }

    const markup = renderToStaticMarkup(
      <ModelCardCollectionSocialImage
        cards={cards}
        profileCount={MODEL_CARD_PRESENTATIONS.length}
        providerCount={providerCount}
      />,
    );
    expect(markup.match(/data-emblem-family=/gu)).toHaveLength(providerCount);
    expect(markup.match(/data-illumination-density="1"/gu)).toHaveLength(providerCount);
    expect(markup).toContain(">THE BENCHMARK ATLAS</span>");
    expect(markup).toContain(">The model codex</span>");
    expect(markup).toContain(`${MODEL_CARD_PRESENTATIONS.length}</span>`);
    expect(markup).toContain(`${providerCount}</span>`);
    for (const card of cards) expect(markup).toContain(`>${card.providerName}</div>`);

    const raster = await new ImageResponse(
      <ModelCardCollectionSocialImage
        cards={cards}
        profileCount={MODEL_CARD_PRESENTATIONS.length}
        providerCount={providerCount}
      />,
      { height: 630, width: 1200 },
    ).arrayBuffer();
    expect(pngDimensions(raster)).toEqual({ height: 630, width: 1200 });
  }, 30_000);

  test("keeps future provider growth inside two rows with an overflow crest", async () => {
    const exemplar = MODEL_CARD_PRESENTATIONS[0];
    if (exemplar === undefined) throw new Error("Expected a model-card fixture.");
    const futureCards = Array.from({ length: 17 }, (_, index) => ({
      ...exemplar,
      cardNumber: index + 1,
      providerId: `future-provider-${index + 1}`,
      providerName: `Future House ${index + 1}`,
    }));
    const cards = modelCardProviderRepresentatives(futureCards);
    const providerCount = modelCardProviderCount(futureCards);
    expect(cards).toHaveLength(MODEL_CARD_COLLECTION_CREST_LIMIT);
    expect(providerCount).toBe(17);

    const image = (
      <ModelCardCollectionSocialImage
        cards={cards}
        profileCount={futureCards.length}
        providerCount={providerCount}
      />
    );
    const markup = renderToStaticMarkup(image);
    expect(markup.match(/data-emblem-family=/gu)).toHaveLength(MODEL_CARD_COLLECTION_CREST_LIMIT);
    expect(markup).toContain('data-provider-overflow="6"');
    expect(markup).toContain(">+6</span>");

    const raster = await new ImageResponse(image, {
      height: 630,
      width: 1200,
    }).arrayBuffer();
    expect(pngDimensions(raster)).toEqual({ height: 630, width: 1200 });
  }, 30_000);
});
