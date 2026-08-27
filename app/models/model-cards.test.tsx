import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import ModelCardPage from "@/app/models/[creatorSlug]/[modelSlug]/[profileSlug]/page";
import ModelCardsPage from "@/app/models/page";
import { ModelCardFace } from "@/components/model-card-face";
import { ModelCardFoilFrame } from "@/components/model-card-foil-frame";
import { ModelCardRasterFace, ModelCardSocialImage } from "@/components/model-card-image";
import {
  MODEL_CARD_PRESENTATIONS,
  MODEL_CARD_RENDERER_VERSION,
  findModelCardPresentation,
  modelCardRouteStaticParams,
  versionedModelCardImagePath,
} from "@/lib/model-card-collection";
import { markdownForPath } from "@/lib/site-markdown";

describe("public model cards", () => {
  test("renders every cataloged or provisional profile through one unique route", () => {
    expect(MODEL_CARD_PRESENTATIONS.length).toBeGreaterThan(0);
    expect(modelCardRouteStaticParams()).toHaveLength(MODEL_CARD_PRESENTATIONS.length);
    expect(new Set(MODEL_CARD_PRESENTATIONS.map(card => card.path)).size).toBe(
      MODEL_CARD_PRESENTATIONS.length,
    );
    for (const card of MODEL_CARD_PRESENTATIONS) {
      expect(findModelCardPresentation({
        creatorSlug: card.canonicalModelId.split("/")[0],
        modelSlug: card.canonicalModelId.split("/")[1],
        profileSlug: card.profileSlug,
      })?.path).toBe(card.path);
    }
  });

  test("uses one delegated foil deck for the full gallery", () => {
    const markup = renderToStaticMarkup(<ModelCardsPage />);
    expect(markup).toContain("data-foil-card-deck");
    expect(markup.match(/data-foil-controller="deck"/gu)).toHaveLength(
      MODEL_CARD_PRESENTATIONS.length,
    );
    expect(markup.match(/data-foil-render-mode="interactive"/gu)).toHaveLength(
      MODEL_CARD_PRESENTATIONS.length,
    );
  });

  test("keeps semantic content in the live face and both raster layouts", () => {
    const card = MODEL_CARD_PRESENTATIONS.find(candidate => candidate.model.includes("with fallback"));
    expect(card).toBeDefined();
    if (card === undefined) return;
    const live = renderToStaticMarkup(<ModelCardFace card={card} />);
    const portrait = renderToStaticMarkup(<ModelCardRasterFace card={card} />);
    const social = renderToStaticMarkup(<ModelCardSocialImage card={card} />);
    for (const markup of [live, portrait, social]) {
      expect(markup).toContain(card.displayTitle);
      expect(markup).toContain(card.harnessLabel);
      expect(markup).toContain("aicharts.io");
      expect(markup).toContain("data:image/svg+xml;base64,");
      expect(markup).not.toContain("with fallback");
      expect(markup).not.toContain("Artificial Analysis");
      expect(markup).not.toContain(card.sourceDate);
      expect(markup).not.toMatch(/\bconfigs?\b/iu);
      expect(markup).not.toContain("NaN");
      expect(markup).not.toContain("undefined");
    }
    expect(live).toContain("<div");
    expect(live).not.toContain("<article");
    expect(live).toContain("<dl");
  });

  test("names every contributing agent harness on detail and Markdown surfaces", async () => {
    const card = MODEL_CARD_PRESENTATIONS.find(candidate => candidate.agentNames.length > 1);
    if (card === undefined) throw new Error("Expected a multi-harness card fixture.");
    const [, , creatorSlug, modelSlug, profileSlug] = card.path.split("/");
    if (creatorSlug === undefined || modelSlug === undefined || profileSlug === undefined) {
      throw new Error("Expected a valid model-card route.");
    }
    const detailPage = await ModelCardPage({
      params: Promise.resolve({ creatorSlug, modelSlug, profileSlug }),
    });
    const detailMarkup = renderToStaticMarkup(detailPage);
    const markdown = markdownForPath(card.path).body;

    for (const agentName of card.agentNames) {
      expect(detailMarkup).toContain(`>${agentName}</li>`);
      expect(markdown).toContain(agentName);
    }
    expect(detailMarkup).toContain("Agent harnesses");
    expect(detailMarkup).toContain("Snapshot");
    expect(detailMarkup).toContain("model-card-detail__code-token");
    expect(detailMarkup).not.toContain(">Observations<");
    expect(markdown).toContain("Agent harnesses:");
  });

  test("shows missing metrics as a dash with an explicit accessible value", () => {
    const card = MODEL_CARD_PRESENTATIONS.find(candidate => (
      [...candidate.performance, ...candidate.economics].some(stat => !stat.available)
    ));
    if (card === undefined) throw new Error("Expected a card with a missing metric fixture.");
    const missing = [...card.performance, ...card.economics].find(stat => !stat.available);
    if (missing === undefined) throw new Error("Expected a missing metric.");

    const live = renderToStaticMarkup(<ModelCardFace card={card} />);
    const detail = markdownForPath(card.path);
    expect(live).toContain('<span aria-hidden="true">–</span>');
    expect(live).toContain(">Not available</span>");
    expect(detail.body).toContain(`- ${missing.label}: Not available`);
    expect(detail.body).not.toContain(`- ${missing.label}: –`);
  });

  test("publishes useful Markdown for the collection and each card", () => {
    const card = MODEL_CARD_PRESENTATIONS[0];
    if (card === undefined) throw new Error("Expected at least one model card.");
    const collection = markdownForPath("/models");
    const detail = markdownForPath(card.path);
    expect(collection.found).toBe(true);
    expect(collection.body).toContain("# Model cards");
    expect(collection.body).toContain(card.path);
    expect(detail.found).toBe(true);
    expect(detail.body).toContain(card.displayTitle);
    expect(detail.body).toContain("Download the branded PNG");
    expect(markdownForPath("/models/openai/not-a-model/max").found).toBe(false);
  });

  test("includes the renderer contract in versioned card artwork URLs", () => {
    const card = MODEL_CARD_PRESENTATIONS[0];
    if (card === undefined) throw new Error("Expected at least one model card.");
    expect(MODEL_CARD_RENDERER_VERSION).toBe("model-card-v2");
    expect(versionedModelCardImagePath(card.path, "card.png")).toMatch(
      /\/card\.png\?v=[a-f0-9]{16}$/u,
    );
  });

  test("draws a distinct semantic frame for every collectible class", () => {
    for (const visualClass of ["standard", "fast", "thinking", "max"] as const) {
      const card = MODEL_CARD_PRESENTATIONS.find(candidate => candidate.visualClass === visualClass);
      if (card === undefined) throw new Error(`Expected a ${visualClass} card fixture.`);
      const markup = renderToStaticMarkup(
        <ModelCardFoilFrame
          foilPreset={card.foilPreset}
          renderMode="static"
          seed={card.seed}
          visualClass={card.visualClass}
        >
          <ModelCardFace card={card} />
        </ModelCardFoilFrame>,
      );
      const ornament = {
        fast: "rails",
        max: "facets",
        standard: "corners",
        thinking: "circuit",
      }[visualClass];
      expect(markup).toContain(`data-foil-ornament="${ornament}"`);
    }
  });

  test("keeps gallery cards legible and paint-contained on narrow screens", async () => {
    const stylesheet = await Bun.file(
      new URL("../../styles/model-cards.css", import.meta.url),
    ).text();

    expect(stylesheet).toMatch(/\.model-card-grid__link\s*\{[^}]*aspect-ratio:\s*5 \/ 7;[^}]*contain:\s*layout paint style;[^}]*content-visibility:\s*auto;/su);
    expect(stylesheet).toMatch(/\.model-card-grid__link\s*\{[^}]*contain-intrinsic-block-size:\s*auto 19\.6rem;[^}]*contain-intrinsic-inline-size:\s*auto 14rem;/su);
    expect(stylesheet).toMatch(/@media \(max-width:\s*560px\)[\s\S]*?\.model-card-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 25rem\);/u);
    expect(stylesheet).toMatch(/@media \(max-width:\s*430px\)[\s\S]*?\.model-card-frame\s*\{[^}]*--foil-card-radius:\s*\.85rem;/u);
    expect(stylesheet).toMatch(/\.model-card-face dt\s*\{[^}]*font-size:\s*max\(\.625rem, 2\.4cqi\);/su);
  });
});
