import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import ModelCardPage from "@/app/models/[creatorSlug]/[modelSlug]/[profileSlug]/page";
import ModelCardsPage from "@/app/models/page";
import { ModelCardFace } from "@/components/model-card-face";
import { ModelCardFoilFrame } from "@/components/model-card-foil-frame";
import { ModelCardRasterFace, ModelCardSocialImage } from "@/components/model-card-image";
import {
  MODEL_CARD_COLLECTION_SOCIAL_IMAGE_PATH,
  MODEL_CARD_LISTINGS,
  MODEL_CARD_PRESENTATIONS,
  MODEL_CARD_RENDERER_VERSION,
  MODEL_CARD_TOP_PATHS,
  MODEL_CARD_VARIANTS,
  findModelCardPresentation,
  modelCardCostAaFrontierPaths,
  modelCardRouteStaticParams,
  versionedModelCardImagePath,
} from "@/lib/model-card-collection";
import {
  formatModelCardListingDate,
  modelCardListingAccessibleLabel,
} from "@/lib/model-card-presentation";
import { markdownForPath, modelCardMarkdown } from "@/lib/site-markdown";
import {
  MODEL_RELEASE_RADAR_HIGHLIGHTS,
  MODEL_RELEASES_AWAITING_BENCHMARK,
} from "@/lib/model-release-collection";

const modelsLayoutSource = await Bun.file(
  new URL("./layout.tsx", import.meta.url),
).text();
const modelsPageSource = await Bun.file(
  new URL("./page.tsx", import.meta.url),
).text();
const modelCardsStyles = await Bun.file(
  new URL("../../styles/model-cards.css", import.meta.url),
).text();

describe("public model cards", () => {
  function cardSpeckTransform(card: (typeof MODEL_CARD_PRESENTATIONS)[number]): string {
    const markup = renderToStaticMarkup(<ModelCardFace card={card} />);
    const properties = [
      "rotation",
      "scale",
      "shift-x",
      "shift-y",
    ].map(property => markup.match(new RegExp(
      `--model-card-speck-${property}:([^;\"]+)`,
      "u",
    ))?.[1]);
    if (properties.some(value => value === undefined)) {
      throw new Error("Expected a complete card-background speck transform.");
    }
    return properties.join("/");
  }

  test("keeps model-specific resources without a second site footer", () => {
    expect(modelsLayoutSource).toContain("<TopBar");
    expect(modelsLayoutSource).toContain('className="model-cards-header"');
    expect(modelsLayoutSource).toContain('aria-label="Model card resources"');
    expect(modelsLayoutSource).toContain('className="model-cards-footer__links"');
    expect(modelsLayoutSource).toContain("Data and method");
    expect(modelsLayoutSource).not.toContain("Icons by LobeHub");
    expect(modelsLayoutSource).not.toContain("lobehub.com/icons");
    expect(modelsLayoutSource).not.toContain("<footer");
    expect(modelsLayoutSource).not.toContain("HranessBrand");
  });

  test("uses named collision-proof header and resource-link contracts", () => {
    const footerLinks = modelCardsStyles.match(
      /\.model-cards-footer__links\s*\{(?<body>[^}]*)\}/u,
    )?.groups?.body ?? "";

    expect(footerLinks).toContain("display: flex");
    expect(footerLinks).toContain("flex-wrap: wrap");
    expect(footerLinks).toContain("gap: .25rem .85rem");
    expect(footerLinks).toContain("min-inline-size: 0");
    expect(modelCardsStyles).not.toContain(".model-cards-footer > div");
    expect(modelCardsStyles).not.toContain("align-items: flex-start; padding-block: .8rem");
    expect(modelCardsStyles).toContain("--ui-top-bar-min-block-size: var(--model-cards-header-block-size)");
    expect(modelCardsStyles).toContain("top: calc(var(--model-cards-header-block-size) + 1.5rem)");
    expect(modelCardsStyles).toContain("scroll-margin-block-start: calc(var(--model-cards-sticky-offset) + .75rem)");
    expect(modelCardsStyles).toMatch(/@media \(max-width:\s*720px\)[\s\S]*?\.model-cards-nav \.model-cards-nav__optional-link\s*\{\s*display:\s*none;/u);
    expect(modelCardsStyles).toMatch(/@media \(max-width:\s*720px\)[\s\S]*?\.model-card-detail__stage\s*\{[^}]*position:\s*static;/u);
  });

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
    expect(markup.match(/data-illumination-mode="gallery"/gu)).toHaveLength(
      MODEL_CARD_PRESENTATIONS.length,
    );
    expect(markup.match(/data-illumination-finish="holographic"/gu)).toHaveLength(
      MODEL_CARD_PRESENTATIONS.length,
    );
    expect(markup.match(/data-holographic-finish="diffractive-spot-foil"/gu)).toHaveLength(
      MODEL_CARD_PRESENTATIONS.length,
    );
    expect(markup.match(/data-ornament-mark="organic-speck-field"/gu)).toHaveLength(
      MODEL_CARD_PRESENTATIONS.length,
    );
    expect(markup.match(/model-card-grid__bleed/gu)).toHaveLength(
      MODEL_CARD_PRESENTATIONS.length,
    );
    expect(markup.match(/<(?:path|ellipse|circle)\b/gu)?.length ?? 0).toBeLessThan(1_250);
    expect(markup.match(/<[A-Za-z][^>]*>/gu)?.length ?? 0).toBeLessThan(
      MODEL_CARD_PRESENTATIONS.length * 118 + 64,
    );
    expect(Buffer.byteLength(markup)).toBeLessThan(
      MODEL_CARD_PRESENTATIONS.length * 20_500 + 8_000,
    );
    expect(markup).not.toContain("<canvas");
    expect(markup).toContain('aria-label="Filter model cards"');
    expect(markup).toContain('aria-label="Show only cost and AA Index Pareto-frontier cards"');
    expect(markup).toContain('aria-label="Sort model cards by recent OpenRouter listing time"');
    expect(markup).toContain(`All providers · ${MODEL_CARD_PRESENTATIONS.length}`);
    expect(markup).toContain(`${MODEL_CARD_TOP_PATHS.length} cards · Cost ↓ · AAI ↑`);
    expect(markup).toContain("Recently listed first");
    expect(markup).not.toContain(`${MODEL_CARD_PRESENTATIONS.length} of ${MODEL_CARD_PRESENTATIONS.length} cards`);
    expect(markup).not.toContain("<span>Provider</span>");
    expect(markup).not.toContain('aria-label="How to read model card emblems"');
    expect(markup).not.toContain("Read the sigil");
    expect(markup).not.toContain("Maker — color &amp; outer court");
    expect(modelsPageSource).not.toContain("model-card-gallery__legend");
  });

  test("surfaces a restrained release radar without inventing benchmark cards", () => {
    const markup = renderToStaticMarkup(<ModelCardsPage />);
    expect(MODEL_RELEASE_RADAR_HIGHLIGHTS).toEqual(
      MODEL_RELEASES_AWAITING_BENCHMARK.slice(0, 2),
    );
    expect(MODEL_RELEASE_RADAR_HIGHLIGHTS.length).toBeLessThanOrEqual(2);
    for (const release of MODEL_RELEASE_RADAR_HIGHLIGHTS) {
      expect(markup).toContain(release.model);
      expect(markup).toContain(release.modelUrl);
    }
    if (MODEL_RELEASE_RADAR_HIGHLIGHTS.length > 0) {
      expect(markup).toContain("Release radar");
      expect(markup).toContain("Discovery is not a score");
    } else {
      expect(markup).not.toContain("Release radar");
    }
    expect(markup.match(/model-card-grid__link/gu)).toHaveLength(
      MODEL_CARD_PRESENTATIONS.length,
    );
  });

  test("maps the exact tie-preserving cost and AA frontier onto stable card paths", () => {
    const topPaths = modelCardCostAaFrontierPaths(MODEL_CARD_VARIANTS);
    const topPathSet = new Set(topPaths);

    expect(topPaths).toEqual(MODEL_CARD_TOP_PATHS);
    expect(topPaths.length).toBeGreaterThan(0);
    expect(topPaths.length).toBeLessThan(MODEL_CARD_PRESENTATIONS.length);
    expect(topPathSet.size).toBe(topPaths.length);
    expect(topPaths.every(path => MODEL_CARD_PRESENTATIONS.some(card => card.path === path))).toBeTrue();
    expect(modelsPageSource).toContain("topCount");
    expect(modelsPageSource).toContain("ModelCardGalleryItems");
    expect(modelsPageSource).toContain("topPaths.has(card.path)");
  });

  test("uses shared centered select geometry instead of a baseline chevron glyph", () => {
    expect(modelsPageSource).toContain("card.listing?.sourceAddedAt");
    expect(modelCardsStyles).toContain(".model-card-gallery__provider-filter .hraness-field__select");
    expect(modelCardsStyles).toContain("background-color: transparent");
    expect(modelCardsStyles).not.toContain("model-card-gallery__select-shell");
    expect(modelCardsStyles).not.toContain('content: "⌄"');
    expect(modelCardsStyles).not.toContain("model-card-gallery__filter-count");
  });

  test("keeps non-standard class context after removing the visible badge", () => {
    const thinkingCard = MODEL_CARD_PRESENTATIONS.find(card => card.visualClass === "thinking");
    if (thinkingCard === undefined) throw new Error("Expected a Thinking card fixture.");
    expect(thinkingCard.displayTitle).toContain("Thinking");
    const markup = renderToStaticMarkup(<ModelCardsPage />);
    expect(markup).toContain(
      `aria-label="Open ${thinkingCard.displayTitle} model card; Thinking class.`,
    );
    expect(markup).not.toContain("model-card-face__class");
  });

  test("keeps card-background specks model-stable and collection-distinct", () => {
    const signaturesByModel = new Map<string, Set<string>>();
    for (const card of MODEL_CARD_PRESENTATIONS) {
      const signatures = signaturesByModel.get(card.canonicalModelId) ?? new Set<string>();
      signatures.add(cardSpeckTransform(card));
      signaturesByModel.set(card.canonicalModelId, signatures);
    }
    expect([...signaturesByModel.values()].every(signatures => signatures.size === 1)).toBe(true);
    const modelSignatures = [...signaturesByModel.values()].map(signatures => (
      [...signatures][0]
    ));
    expect(new Set(modelSignatures).size).toBe(modelSignatures.length);
  });

  test("keeps semantic content in the live face and both raster layouts", () => {
    const card = MODEL_CARD_PRESENTATIONS.find(candidate => candidate.model.includes("with fallback"));
    expect(card).toBeDefined();
    if (card === undefined) return;
    const live = renderToStaticMarkup(<ModelCardFace card={card} />);
    const portrait = renderToStaticMarkup(<ModelCardRasterFace card={card} />);
    const social = renderToStaticMarkup(<ModelCardSocialImage card={card} />);
    expect(card.listing).not.toBeNull();
    if (card.listing === null) return;
    for (const markup of [live, portrait, social]) {
      expect(markup).toContain(card.displayTitle);
      expect(markup).toContain(card.harnessLabel);
      expect(markup).toContain("aicharts.io");
      expect(markup).toContain("data:image/svg+xml;base64,");
      expect(markup).not.toContain("with fallback");
      expect(markup).not.toContain("Artificial Analysis");
      expect(markup).not.toContain(card.sourceDate);
      expect(markup).toContain("Listed on OpenRouter");
      expect(markup).toContain(formatModelCardListingDate(card.listing.sourceAddedAt));
      expect(markup).toContain(`dateTime="${card.listing.sourceAddedAt}"`);
      expect(markup).toContain(modelCardListingAccessibleLabel(card.listing));
      expect(markup).not.toMatch(/\bconfigs?\b/iu);
      expect(markup).not.toContain("NaN");
      expect(markup).not.toContain("undefined");
    }
    expect(live).toContain("<div");
    expect(live).not.toContain("<article");
    expect(live).toContain("<dl");
    expect(live).toContain('data-illumination-finish="holographic"');
    expect(portrait).toContain('data-illumination-finish="print"');
    expect(social).toContain('data-illumination-finish="print"');
    expect(portrait).not.toContain("data-holographic-finish");
    expect(social).not.toContain("data-holographic-finish");

    const unmatched = MODEL_CARD_PRESENTATIONS.find(candidate => candidate.listing === null);
    expect(unmatched).toBeDefined();
    if (unmatched !== undefined) {
      const unmatchedLive = renderToStaticMarkup(<ModelCardFace card={unmatched} />);
      expect(unmatchedLive).not.toContain("Listed on OpenRouter");
      expect(unmatchedLive).not.toContain(unmatched.sourceDate);
    }
  });

  test("drives holographic ink from the delegated pose with accessible fallbacks", async () => {
    const stylesheet = await Bun.file(
      new URL("../../styles/model-cards.css", import.meta.url),
    ).text();

    expect(stylesheet).toContain("--foil-light-x");
    expect(stylesheet).toContain("--foil-light-y");
    expect(stylesheet).toContain("--foil-spectrum-angle");
    expect(stylesheet).toContain("--model-card-rail-spectrum-opacity");
    expect(stylesheet).toMatch(/\.model-card-face\s*\{[^}]*conic-gradient\(/su);
    expect(stylesheet).toMatch(/\.model-card-face__art\s*\{[^}]*conic-gradient\(/su);
    expect(stylesheet).toMatch(/\.model-card-face\[data-card-density="5"\]\s*\{[^}]*--model-card-rail-spectrum-opacity:\s*\.37;/su);
    expect(stylesheet).toMatch(/\.model-card-holographic-foil__spectrum use\s*\{[^}]*stroke-dasharray:/su);
    expect(stylesheet).toMatch(/\.model-card-frame\[data-foil-active\][\s\S]*?\.model-card-holographic-foil__spectrum/u);
    expect(stylesheet).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.model-card-holographic-foil__spectrum/u);
    expect(stylesheet).toMatch(/@media \(prefers-reduced-transparency:\s*reduce\), \(prefers-contrast:\s*more\)[\s\S]*?\.model-card-holographic-foil__glint/u);
    expect(stylesheet).not.toContain("animation:");
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
    expect(detailMarkup).toContain(">Sigil</dt>");
    expect(detailMarkup).toContain(`${card.emblemIdentity.generation.join(".")} version marks`);
    expect(detailMarkup).toContain(`foil/detail ${card.illuminationDensity}/5`);
    expect(detailMarkup).toContain("model-card-detail__code-token");
    expect(detailMarkup).not.toContain(">Observations<");
    expect(markdown).toContain("Agent harnesses:");
  });

  test("shows missing metrics as a dash with an explicit accessible value", () => {
    const current = MODEL_CARD_PRESENTATIONS[0];
    if (current === undefined) throw new Error("Expected a model-card fixture.");
    const firstStat = current.performance[0];
    if (firstStat === undefined) throw new Error("Expected a performance-stat fixture.");
    const card = {
      ...current,
      performance: [
        { ...firstStat, available: false, value: "–" },
        ...current.performance.slice(1),
      ],
    };
    const missing = [...card.performance, ...card.economics].find(stat => !stat.available);
    if (missing === undefined) throw new Error("Expected a missing metric.");

    const live = renderToStaticMarkup(<ModelCardFace card={card} />);
    const detail = modelCardMarkdown(card);
    expect(live).toContain('<span aria-hidden="true">–</span>');
    expect(live).toContain(">Not available</span>");
    expect(detail).toContain(`- ${missing.label}: Not available`);
    expect(detail).not.toContain(`- ${missing.label}: –`);
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
    expect(MODEL_CARD_RENDERER_VERSION).toBe("model-card-v6");
    expect(MODEL_CARD_COLLECTION_SOCIAL_IMAGE_PATH).toBe("/models/opengraph-image-v6");
    expect(MODEL_CARD_LISTINGS.size).toBe(MODEL_CARD_PRESENTATIONS.length);
    expect(versionedModelCardImagePath(card.path, "card.png")).toMatch(
      /\/card\.png\?v=[a-f0-9]{16}$/u,
    );
  });

  test("moves class expression from the outer frame into the illuminated logo field", () => {
    for (const density of [1, 2, 3, 4, 5] as const) {
      const card = MODEL_CARD_PRESENTATIONS.find(candidate => (
        candidate.illuminationDensity === density
      ));
      if (card === undefined) throw new Error(`Expected a density ${density} card fixture.`);
      const markup = renderToStaticMarkup(
        <ModelCardFoilFrame
          foilPreset={card.foilPreset}
          renderMode="static"
          seed={card.seed}
        >
          <ModelCardFace card={card} />
        </ModelCardFoilFrame>,
      );
      expect(markup).toContain('data-foil-ornament="none"');
      expect(markup).toContain(`data-illumination-density="${density}"`);
      expect(markup).toContain(`data-card-density="${density}"`);
      expect(markup).toContain("data-illumination-motif=");
      expect(markup).not.toContain("model-card-face__class");
    }
  });

  test("keeps gallery cards legible with a paint-safe transform bleed", async () => {
    const stylesheet = await Bun.file(
      new URL("../../styles/model-cards.css", import.meta.url),
    ).text();

    expect(stylesheet).toMatch(/\.model-card-grid__link\s*\{[^}]*aspect-ratio:\s*5 \/ 7;[^}]*contain:\s*layout style;[^}]*position:\s*relative;/su);
    expect(stylesheet).not.toMatch(/\.model-card-grid__link\s*\{[^}]*content-visibility:\s*auto;/su);
    expect(stylesheet).toMatch(/\.model-card-grid__bleed\s*\{[^}]*contain:\s*layout paint style;[^}]*content-visibility:\s*auto;[^}]*inset:\s*-\.375rem;[^}]*padding:\s*\.375rem;/su);
    expect(stylesheet).toMatch(/\.model-card-frame\s*\{[^}]*outline:\s*none;/su);
    expect(stylesheet).toMatch(/\.model-card-frame\s*\{[^}]*clip-path:\s*inset\(0 round var\(--foil-card-radius\)\);[^}]*overflow:\s*clip;/su);
    expect(stylesheet).toMatch(/\.model-card-grid__link:focus-visible\s*\{[^}]*outline-offset:\s*5px;/su);
    expect(stylesheet).toMatch(/\.model-card-grid__bleed\s*\{[^}]*contain-intrinsic-block-size:\s*auto 20\.35rem;[^}]*contain-intrinsic-inline-size:\s*auto 14\.75rem;/su);
    expect(stylesheet).toMatch(/@media \(max-width:\s*560px\)[\s\S]*?\.model-card-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 25rem\);/u);
    expect(stylesheet).toMatch(/@media \(max-width:\s*430px\)[\s\S]*?\.model-card-frame\s*\{[^}]*--foil-card-radius:\s*\.85rem;/u);
    expect(stylesheet).toMatch(/\.model-card-face dt\s*\{[^}]*font-size:\s*max\(\.625rem, 2\.4cqi\);/su);
    expect(stylesheet).toMatch(/@media \(forced-colors:\s*active\)[\s\S]*?\.model-card-illumination\s*\{[^}]*display:\s*none;/u);
    expect(stylesheet).toMatch(/@media \(prefers-reduced-transparency:\s*reduce\), \(prefers-contrast:\s*more\)[\s\S]*?--model-card-rail-spectrum-opacity:\s*\.06;/u);
    expect(modelsPageSource).toContain("path: MODEL_CARD_COLLECTION_SOCIAL_IMAGE_PATH");
  });
});
