import { describe, expect, test } from "bun:test";
import { ImageResponse } from "next/og";
import { renderToStaticMarkup } from "react-dom/server";

import { MODEL_CARD_PRESENTATIONS } from "@/lib/model-card-collection";
import { modelCardProviderColors } from "@/lib/model-card-art-direction";
import {
  formatModelCardReleaseDate,
  modelCardReleaseAccessibleLabel,
} from "@/lib/model-card-presentation";

import { ModelCardRasterFace } from "./model-card-image";

function pngDimensions(bytes: ArrayBuffer): Readonly<{ height: number; width: number }> {
  const view = new DataView(bytes);
  expect(Array.from(new Uint8Array(bytes, 0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  return { height: view.getUint32(20), width: view.getUint32(16) };
}

describe("model card ImageResponse rendering", () => {
  test("keeps the collectible identity focused while naming official release provenance", () => {
    const card = MODEL_CARD_PRESENTATIONS.find(candidate => (
      candidate.canonicalModelId === "anthropic/claude-fable-5.1"
      && candidate.profileSlug === "max"
    ));
    expect(card).toBeDefined();
    if (card === undefined) return;
    expect(card.release.status).toBe("verified");
    if (card.release.status !== "verified") return;

    const markup = renderToStaticMarkup(<ModelCardRasterFace card={card} />);
    {
      expect(markup).toContain(">Fable 5.1 Max</span>");
      expect(markup).toContain(`>${card.harnessLabel}</span>`);
      expect(markup).toContain("aicharts.io");
      expect(markup).not.toContain("with fallback");
      expect(markup).not.toContain("Artificial Analysis");
      expect(markup).not.toContain(card.sourceDate);
      expect(markup).toContain(">Released</span>");
      expect(markup).toContain(formatModelCardReleaseDate(card.release.releasedOn));
      expect(markup).toContain(`dateTime="${card.release.releasedOn}"`);
      expect(markup).toContain(modelCardReleaseAccessibleLabel(card.release));
      expect(markup).not.toContain("Listed on OpenRouter");
      expect(markup).not.toContain(">OpenRouter</span>");
      expect(markup).not.toMatch(/\bconfigs?\b/iu);
      expect(markup).not.toContain("benchmark profile");
    }
  });

  test("renders an explicit pending release state without inventing a date", () => {
    const card = MODEL_CARD_PRESENTATIONS[0];
    expect(card).toBeDefined();
    if (card === undefined) return;
    const pendingCard = {
      ...card,
      release: {
        canonicalModelId: card.canonicalModelId,
        reason: "No provider-owned publication date has been verified.",
        researchedOn: "2026-08-29",
        status: "pending",
      } as const,
    };

    {
      const markup = renderToStaticMarkup(<ModelCardRasterFace card={pendingCard} />);
      expect(markup).toContain(">Release date</span>");
      expect(markup).toContain(">Verifying</span>");
      expect(markup).toContain('role="note"');
      expect(markup).toContain(modelCardReleaseAccessibleLabel(pendingCard.release));
      expect(markup).not.toContain(`dateTime="${pendingCard.release.researchedOn}"`);
      expect(markup).not.toContain(">Released</span>");
      expect(markup).not.toContain("Listed on OpenRouter");
      expect(markup).not.toContain(">OpenRouter</span>");
    }
  });

  test("renders a compact and full portrait for every provider color key", async () => {
    const cardByProvider = new Map(MODEL_CARD_PRESENTATIONS.map(card => [card.providerId, card]));
    expect([...cardByProvider.keys()].sort()).toEqual(Object.keys(modelCardProviderColors).sort());
    for (const card of cardByProvider.values()) {
      const markup = renderToStaticMarkup(<ModelCardRasterFace card={card} compact />);
      expect(markup).toContain("data:image/svg+xml");
      expect(markup).not.toContain("data-illumination-motif");
      const raster = await new ImageResponse(<ModelCardRasterFace card={card} compact />, {
        height: 350,
        width: 250,
      }).arrayBuffer();
      expect(pngDimensions(raster)).toEqual({ height: 350, width: 250 });
    }
  }, 40_000);

  test("reserves the compact top row for long provider identities and official release dates", () => {
    const card = MODEL_CARD_PRESENTATIONS.find(candidate => (
      candidate.providerName === "Alibaba Cloud" && candidate.release.status === "verified"
    ));
    expect(card).toBeDefined();
    if (card === undefined) return;
    if (card.release.status !== "verified") return;

    const compact = renderToStaticMarkup(<ModelCardRasterFace card={card} compact />);
    const full = renderToStaticMarkup(<ModelCardRasterFace card={card} />);
    expect(compact).toContain(">Alibaba C…</span>");
    expect(compact).not.toContain(">Alibaba Cloud</span>");
    expect(full).toContain(">Alibaba Cloud</span>");
    for (const markup of [compact, full]) {
      expect(markup).toContain(">Released</span>");
      expect(markup).toContain(formatModelCardReleaseDate(card.release.releasedOn));
      expect(markup).not.toContain("Listed on OpenRouter");
      expect(markup).not.toContain(">OpenRouter</span>");
    }
  });

  test("reserves descender room for agent subtitles in portrait images", () => {
    const card = MODEL_CARD_PRESENTATIONS.find(candidate => (
      /[gjpqy]/u.test(candidate.harnessLabel)
    ));
    expect(card).toBeDefined();
    if (card === undefined) return;
    const escapedHarnessLabel = card.harnessLabel.replace(
      /[.*+?^${}()|[\]\\]/gu,
      "\\$&",
    );

    const compact = renderToStaticMarkup(<ModelCardRasterFace card={card} compact />);
    const portrait = renderToStaticMarkup(<ModelCardRasterFace card={card} />);
    for (const markup of [compact, portrait]) {
      const subtitle = markup.match(new RegExp(
        `<span style="(?<style>[^"]*)">${escapedHarnessLabel}</span>`,
        "u",
      ));
      expect(subtitle?.groups?.style).toContain("line-height:1.2");
      expect(subtitle?.groups?.style).toMatch(/padding-bottom:[24]px/u);
    }
  });

  test("renders the portrait download as a valid PNG", async () => {
    const card = MODEL_CARD_PRESENTATIONS.find(candidate => candidate.cardClass === "max");
    expect(card).toBeDefined();
    if (card === undefined) return;

    const portrait = await new ImageResponse(<ModelCardRasterFace card={card} />, {
      height: 1400,
      width: 1000,
    }).arrayBuffer();
    expect(pngDimensions(portrait)).toEqual({ height: 1400, width: 1000 });
  }, 30_000);
});
