import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import ModelCardPage from "@/app/models/[creatorSlug]/[modelSlug]/[profileSlug]/page";
import ModelCardsPage from "@/app/models/page";
import { modelCardsHeading, modelCardsLede } from "@/app/site";
import { ModelCardFace } from "@/components/model-card-face";
import { ModelCardRasterFace, ModelCardSocialImage } from "@/components/model-card-image";
import { INDEX_MODEL_PAGES } from "@/lib/index-model-pages";
import {
  MODEL_CARD_COLLECTION_SOCIAL_IMAGE_PATH,
  MODEL_CARD_COLLECTION_SOCIAL_IMAGE_URL,
  MODEL_CARD_PRESENTATIONS,
  MODEL_CARD_RENDERER_VERSION,
  MODEL_CARD_SNAPSHOT_VERSION,
  MODEL_CARD_TOP_PATHS,
  MODEL_CARD_VARIANTS,
  findModelCardPresentation,
  modelCardCostAaFrontierPaths,
  modelCardRouteStaticParams,
  versionedModelCardImagePath,
} from "@/lib/model-card-collection";
import {
  formatModelCardReleaseDate,
  modelCardReleaseAccessibleLabel,
} from "@/lib/model-card-presentation";
import { MODEL_RELEASE_DATES } from "@/lib/model-release-date-data";
import {
  DIRECT_DEEP_SWE_EVIDENCE,
  directDeepSweEvidenceForRelease,
} from "@/lib/deep-swe-evidence-collection";
import { formatDeepSweEvidenceScore } from "@/lib/deep-swe-evidence";
import {
  FIRST_PARTY_RELEASE_HIGHLIGHTS,
  FIRST_PARTY_RELEASE_RADAR,
  FIRST_PARTY_RELEASE_SOURCE_SUMMARY,
} from "@/lib/first-party-release-collection";
import { markdownForPath, modelCardMarkdown } from "@/lib/site-markdown";
import {
  MODEL_RELEASE_RADAR_HIGHLIGHTS,
  MODEL_RELEASES_AWAITING_BENCHMARK,
  MODEL_RELEASES_WITH_EARLY_DEEP_SWE,
  modelReleaseRadarHighlightsExcluding,
} from "@/lib/model-release-collection";

const MODEL_RELEASE_RADAR_PAGE_HIGHLIGHTS = modelReleaseRadarHighlightsExcluding(
  FIRST_PARTY_RELEASE_HIGHLIGHTS.flatMap(release => release.namedModels),
);

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
  test("keeps model-specific resources without a second site footer", () => {
    expect(modelsLayoutSource).not.toContain("<TopBar");
    expect(modelsLayoutSource).toContain("<SiteHeader");
    expect(modelsLayoutSource).toContain('className="model-cards-header"');
    expect(modelsLayoutSource).toContain('current="/models"');
    expect(modelsLayoutSource).toContain('aria-label="Model card resources"');
    expect(modelsLayoutSource).toContain('className="model-cards-footer__links"');
    expect(modelsLayoutSource).toContain('<Link href="/data">Data</Link>');
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

  test("renders square logo cards for coding profiles and recent Index pages", () => {
    const markup = renderToStaticMarkup(<ModelCardsPage />);
    const galleryCount = MODEL_CARD_PRESENTATIONS.length + INDEX_MODEL_PAGES.length;
    expect(markup).toContain('class="model-card-gallery hraness-marketing-main"');
    expect(markup).toContain(
      `<h1 class="hraness-marketing-hero__heading" id="model-cards-title">${modelCardsHeading}</h1>`,
    );
    expect(markup).toContain('class="hraness-marketing-hero__summary model-card-gallery__lede"');
    expect(markup).toContain(modelCardsLede);
    expect(markup.indexOf('class="model-release-radar"')).toBeGreaterThan(
      markup.indexOf('class="model-card-grid"'),
    );
    expect(markup.match(/class="model-logo-card"/gu)).toHaveLength(galleryCount);
    expect(markup).toContain('href="/models/xiaomi/mimo-v2-6-pro/index"');
    expect(markup).toContain("MiMo-V2.6-Pro");
    expect(markup).toContain('href="/models/anthropic/claude-opus-5-5/index"');
    expect(markup).toContain("Claude Opus 5.5");
    expect(markup).not.toContain("data-foil-card-deck");
    expect(markup).not.toContain("data-illumination-finish");
    expect(markup).not.toContain("data-holographic-finish");
    expect(markup).not.toContain("model-card-grid__bleed");
    expect(markup).not.toContain("<canvas");
    expect(markup).toContain('aria-label="Filter model cards"');
    expect(markup).toContain('aria-label="Show only cost and AA Index Pareto-frontier cards"');
    expect(markup).toContain('aria-label="Sort model cards by official release date"');
    expect(markup).toContain("All providers");
    expect(markup).toContain(`${galleryCount} cards`);
    expect(markup).toContain(`${MODEL_CARD_TOP_PATHS.length} cards · Cost ↓ · AAI ↑`);
    expect(markup).toContain("Newest releases first");
    expect(markup).not.toContain(`${MODEL_CARD_PRESENTATIONS.length} of ${MODEL_CARD_PRESENTATIONS.length} cards`);
    expect(markup).not.toContain("<span>Provider</span>");
    expect(markup).not.toContain('aria-label="How to read model card emblems"');
    expect(markup).not.toContain("Read the sigil");
    expect(modelsPageSource).not.toContain("model-card-gallery__legend");
    expect(modelsPageSource).not.toContain("ModelCardFoilFrame");
  });

  test("surfaces a restrained release radar without inventing benchmark cards", () => {
    const markup = renderToStaticMarkup(<ModelCardsPage />);
    expect(FIRST_PARTY_RELEASE_HIGHLIGHTS.length).toBeLessThanOrEqual(2);
    expect(FIRST_PARTY_RELEASE_RADAR.policy).toMatchObject({
      publication: "discovery-only",
      review: "manual-review-required",
    });
    for (const release of FIRST_PARTY_RELEASE_HIGHLIGHTS) {
      expect(markup).toContain(release.canonicalUrl);
      for (const model of release.namedModels) expect(markup).toContain(model);
    }
    expect(markup).toContain('class="hraness-marketing-card-row"');
    expect(markup).toContain("hraness-marketing-card__meta");
    expect(modelsPageSource).toContain("ModelReleaseRadars");
    expect(modelCardsStyles).toContain(".model-release-radar .hraness-marketing-card-row");
    expect(modelCardsStyles).not.toContain(".model-release-radar ul {");
    if (FIRST_PARTY_RELEASE_HIGHLIGHTS.length > 0) {
      expect(markup).toContain("First-party release radar");
      expect(markup).toContain("New releases found at first-party sources");
      expect(markup).toContain(`${FIRST_PARTY_RELEASE_SOURCE_SUMMARY.labCount} labs`);
      expect(markup).toContain(
        `${FIRST_PARTY_RELEASE_SOURCE_SUMMARY.sourceCount} first-party sources`,
      );
      expect(markup).toContain("first observed");
      expect(markup).not.toContain("source changed");
      // The radar date is when AI Charts found the page, never an official release date.
      expect(markup).toContain("which can differ from the official");
    }
    expect(MODEL_RELEASE_RADAR_HIGHLIGHTS[0]).toBe(
      MODEL_RELEASES_AWAITING_BENCHMARK[0],
    );
    expect(MODEL_RELEASE_RADAR_HIGHLIGHTS.length).toBeLessThanOrEqual(2);
    const earliestEvidenceRelease = MODEL_RELEASES_AWAITING_BENCHMARK.find(
      release => directDeepSweEvidenceForRelease(release) !== null,
    );
    if (earliestEvidenceRelease !== undefined) {
      expect(MODEL_RELEASE_RADAR_HIGHLIGHTS).toContain(earliestEvidenceRelease);
    }
    for (const release of MODEL_RELEASE_RADAR_PAGE_HIGHLIGHTS) {
      expect(markup).toContain(release.model);
      expect(markup).toContain(release.modelUrl);
    }
    expect(MODEL_RELEASE_RADAR_PAGE_HIGHLIGHTS.every(release => (
      !FIRST_PARTY_RELEASE_HIGHLIGHTS.some(firstParty => (
        firstParty.namedModels.includes(release.model)
      ))
    ))).toBeTrue();
    if (MODEL_RELEASE_RADAR_PAGE_HIGHLIGHTS.length > 0) {
      expect(markup).toContain("Release radar");
      expect(markup).toContain("New, awaiting complete benchmark coverage");
      // A radar listing is not a score: listed models lack a complete coding-agent result.
      expect(markup).toContain("do not yet have a complete result on the Artificial");
      expect(markup).toContain("missing metrics marked");
      expect(markup).toContain("stays off the Artificial Analysis chart and model cards");
      expect(markup).toContain(`${MODEL_RELEASES_WITH_EARLY_DEEP_SWE.length} with early DeepSWE`);
      expect(markup).toContain(`DeepSWE v${DIRECT_DEEP_SWE_EVIDENCE.source.benchmarkVersion}`);
      expect(markup).toContain("mini-swe-agent leaderboard");
      const highlightedEvidence = MODEL_RELEASE_RADAR_PAGE_HIGHLIGHTS
        .map(directDeepSweEvidenceForRelease)
        .find(evidence => evidence !== null);
      if (highlightedEvidence !== undefined && highlightedEvidence !== null) {
        expect(markup).toContain(
          `Early DeepSWE ${formatDeepSweEvidenceScore(highlightedEvidence.passAt1)} pass@1`,
        );
        expect(markup).toContain(`${highlightedEvidence.runs} runs`);
        expect(markup).toContain(`${highlightedEvidence.identity.resolver.name} match`);
      }
    } else {
      expect(markup).not.toContain("Release radar");
    }
    expect(markup.match(/model-card-grid__link/gu)).toHaveLength(
      MODEL_CARD_PRESENTATIONS.length + INDEX_MODEL_PAGES.length,
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
    expect(modelsPageSource).toContain("INDEX_MODEL_PAGES");
  });

  test("uses the shared option picker instead of a baseline chevron glyph", () => {
    expect(modelsPageSource).toContain('card.release.status === "verified" ? card.release.releasedOn : null');
    expect(modelCardsStyles).toContain(".model-card-gallery__provider-filter");
    expect(modelCardsStyles).toContain("--option-picker-accent");
    expect(modelCardsStyles).not.toContain(".model-card-gallery__provider-filter .hraness-field__select");
    expect(modelCardsStyles).not.toContain("model-card-gallery__select-shell");
    expect(modelCardsStyles).not.toContain('content: "⌄"');
    expect(modelCardsStyles).not.toContain("model-card-gallery__filter-count");
  });

  test("keeps non-standard class context after removing the visible badge", () => {
    const fastCard = MODEL_CARD_PRESENTATIONS.find(card => card.visualClass === "fast");
    if (fastCard === undefined) throw new Error("Expected a Fast card fixture.");
    const markup = renderToStaticMarkup(<ModelCardsPage />);
    expect(markup).toContain(
      `aria-label="Open ${fastCard.displayTitle} model page; Fast class.`,
    );
    expect(markup).not.toContain("model-card-face__class");
  });

  test("keeps semantic content in the live face and both raster layouts", () => {
    const card = MODEL_CARD_PRESENTATIONS.find(candidate => candidate.model.includes("with fallback"));
    expect(card).toBeDefined();
    if (card === undefined) return;
    const live = renderToStaticMarkup(<ModelCardFace card={card} />);
    const portrait = renderToStaticMarkup(<ModelCardRasterFace card={card} />);
    const social = renderToStaticMarkup(<ModelCardSocialImage card={card} />);
    expect(card.release.status).toBe("verified");
    if (card.release.status !== "verified") return;
    for (const markup of [live, portrait, social]) {
      expect(markup).toContain(card.displayTitle);
      expect(markup).toContain(card.harnessLabel);
      expect(markup).toContain("data:image/svg+xml;base64,");
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
      expect(markup).not.toContain("NaN");
      expect(markup).not.toContain("undefined");
    }
    expect(live).toContain('class="model-logo-card"');
    expect(live).toContain('class="model-logo-card__art hraness-marketing-card__art"');
    expect(live).not.toContain("<article");
    expect(live).not.toContain("<dl");
    expect(live).not.toContain("data-illumination-finish");
    expect(portrait).toContain("aicharts.io");
    expect(social).toContain("aicharts.io");
    expect(portrait).not.toContain("data-holographic-finish");
    expect(social).not.toContain("data-holographic-finish");

    const pendingCard = {
      ...card,
      release: {
        canonicalModelId: card.canonicalModelId,
        reason: "No provider-owned publication date has been verified.",
        researchedOn: "2026-08-29",
        status: "pending",
      } as const,
    };
    const pendingLive = renderToStaticMarkup(<ModelCardFace card={pendingCard} />);
    expect(pendingLive).toContain(">Release date</span>");
    expect(pendingLive).toContain(">Verifying</span>");
    expect(pendingLive).toContain(modelCardReleaseAccessibleLabel(pendingCard.release));
    expect(pendingLive).not.toContain(`dateTime="${pendingCard.release.researchedOn}"`);
    expect(pendingLive).not.toContain("Listed on OpenRouter");
    expect(pendingLive).not.toContain(">OpenRouter</span>");
  });

  test("keeps logo-card chrome quiet and free of foil leftovers", async () => {
    const stylesheet = await Bun.file(
      new URL("../../styles/model-cards.css", import.meta.url),
    ).text();

    expect(stylesheet).toContain(".model-logo-card");
    expect(stylesheet).toMatch(/\.model-logo-card\s*\{[^}]*aspect-ratio:\s*1;/su);
    expect(stylesheet).toMatch(/\.model-logo-card__art\s*\{[^}]*brand-shadow/su);
    expect(stylesheet).not.toContain("--foil-light-x");
    expect(stylesheet).not.toContain("--foil-spectrum-angle");
    expect(stylesheet).not.toContain("holographic");
    expect(stylesheet).not.toContain("model-card-illumination");
    expect(stylesheet).not.toContain("animation:");
  });

  test("isolates each logo-card art pill so a gallery row cannot paint one continuous bar", async () => {
    const stylesheet = await Bun.file(
      new URL("../../styles/model-cards.css", import.meta.url),
    ).text();

    function firstRule(selector: string): string {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      return stylesheet.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "u"))?.groups?.body ?? "";
    }

    const card = firstRule(".model-logo-card");
    const art = firstRule(".model-logo-card__art");
    const grid = firstRule(".model-card-grid");
    const link = firstRule(".model-card-grid__link");

    expect(card).toContain("contain: paint");
    expect(card).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(card).toContain("isolation: isolate");
    expect(card).toContain("min-inline-size: 0");
    expect(card).toContain("overflow: clip");
    expect(card).toContain("padding: 1.15rem .9rem .85rem");
    expect(stylesheet).toMatch(
      /\.model-logo-card__title,\s*\.model-logo-card__stat\s*\{[^}]*min-inline-size:\s*0;/su,
    );
    expect(art).toContain("contain: paint");
    expect(art).toContain("isolation: isolate");
    expect(art).toContain("min-inline-size: 0");
    expect(art).toContain("max-inline-size: 100%");
    expect(art).toContain("overflow: clip");
    expect(grid).toContain("align-items: start");
    expect(link).toContain("isolation: isolate");
    expect(link).toContain("overflow: clip");
    expect(stylesheet).not.toContain("model-card-grid__bleed");
  });

  test("names every contributing agent harness on detail and Markdown surfaces", async () => {
    const card = MODEL_CARD_PRESENTATIONS[0];
    if (card === undefined) throw new Error("Expected a model-card fixture.");
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
    const harnessLabel = card.agentNames.length === 1 ? "Agent harness" : "Agent harnesses";
    expect(detailMarkup).toContain(harnessLabel);
    expect(detailMarkup).toContain("Snapshot");
    expect(detailMarkup).toContain("model-card-detail__code-token");
    expect(detailMarkup).not.toContain(">Sigil</dt>");
    expect(detailMarkup).not.toContain("foil/detail");
    expect(detailMarkup).not.toContain(">Observations<");
    expect(markdown).toContain(`${harnessLabel}:`);
  });

  test("publishes Claude Opus 5.5 as its own Index page with publisher scores", async () => {
    const opus55 = INDEX_MODEL_PAGES.find(page => (
      page.canonicalModelId === "anthropic/claude-opus-5-5"
    ));
    if (opus55 === undefined) throw new Error("Expected the Claude Opus 5.5 Index page.");
    const detailPage = await ModelCardPage({
      params: Promise.resolve({
        creatorSlug: opus55.creatorSlug,
        modelSlug: opus55.modelSlug,
        profileSlug: opus55.profileSlug,
      }),
    });
    const detailMarkup = renderToStaticMarkup(detailPage);
    const markdown = markdownForPath(opus55.path).body;
    expect(detailMarkup).toContain("<h1>Claude Opus 5.5</h1>");
    expect(detailMarkup).toContain("Anthropic");
    expect(detailMarkup).toContain("2026-09-22");
    expect(detailMarkup).toContain("https://artificialanalysis.ai/models/claude-opus-5-5");
    expect(detailMarkup).not.toContain("Claude Opus 5 Max");
    expect(detailMarkup).not.toContain("/models/anthropic/claude-opus-5/max");
    expect(markdown).toContain("# Claude Opus 5.5");
    expect(markdown).toContain("`anthropic/claude-opus-5-5`");
    expect(markdown).toContain("https://artificialanalysis.ai/models/claude-opus-5-5");
    expect(markdownForPath("/models/anthropic/claude-opus-5-5/index").found).toBe(true);
    expect(markdownForPath("/models/anthropic/claude-opus-5-5").found).toBe(false);
  });

  test("seeds Deedy commentary under the MiMo Index page", async () => {
    const mimo = INDEX_MODEL_PAGES.find(page => page.canonicalModelId === "xiaomi/mimo-v2-6-pro");
    if (mimo === undefined) throw new Error("Expected the MiMo Index page.");
    const detailPage = await ModelCardPage({
      params: Promise.resolve({
        creatorSlug: mimo.creatorSlug,
        modelSlug: mimo.modelSlug,
        profileSlug: mimo.profileSlug,
      }),
    });
    const detailMarkup = renderToStaticMarkup(detailPage);
    const markdown = markdownForPath(mimo.path).body;
    expect(detailMarkup).toContain("Notes from X");
    expect(detailMarkup).toContain("deedydas");
    expect(detailMarkup).toContain("https://x.com/deedydas/status/2102293684767412393");
    expect(detailMarkup).toContain("Xiaomi just dropped Mimo 2.6 Pro");
    expect(detailMarkup).not.toContain("widgets.js");
    expect(markdown).toContain("Notes from X");
    expect(markdown).toContain("https://x.com/deedydas/status/2102293684767412393");
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
    expect(live).toContain("–");
    expect(detail).toContain(`- ${missing.label}: Not available`);
    expect(detail).not.toContain(`- ${missing.label}: –`);
  });

  test("publishes useful Markdown for the collection and each card", () => {
    const card = MODEL_CARD_PRESENTATIONS[0];
    if (card === undefined) throw new Error("Expected at least one model card.");
    const collection = markdownForPath("/models");
    const detail = markdownForPath(card.path);
    expect(collection.found).toBe(true);
    expect(collection.body).toContain(`# ${modelCardsHeading}`);
    expect(collection.body).toContain(modelCardsLede);
    expect(collection.body).toContain(card.path);
    expect(collection.body).toContain("/models/xiaomi/mimo-v2-6-pro/index");
    expect(detail.found).toBe(true);
    expect(detail.body).toContain(card.displayTitle);
    expect(detail.body).toContain("Download the branded PNG");
    expect(markdownForPath("/models/xiaomi/mimo-v2-6-pro/index").found).toBe(true);
    expect(markdownForPath("/models/openai/not-a-model/max").found).toBe(false);
  });

  test("includes the renderer contract in versioned card artwork URLs", () => {
    const card = MODEL_CARD_PRESENTATIONS[0];
    if (card === undefined) throw new Error("Expected at least one model card.");
    expect(MODEL_CARD_RENDERER_VERSION).toBe("model-card-v8");
    expect(MODEL_CARD_COLLECTION_SOCIAL_IMAGE_PATH).toBe("/models/opengraph-image-v7");
    expect(MODEL_CARD_COLLECTION_SOCIAL_IMAGE_URL).toBe(
      `${MODEL_CARD_COLLECTION_SOCIAL_IMAGE_PATH}?v=${MODEL_CARD_SNAPSHOT_VERSION}`,
    );
    const releaseByCanonicalId = new Map(MODEL_RELEASE_DATES.map(release => [
      release.canonicalModelId,
      release,
    ]));
    for (const presentation of MODEL_CARD_PRESENTATIONS) {
      const expectedRelease = releaseByCanonicalId.get(presentation.canonicalModelId);
      if (expectedRelease === undefined) {
        expect(presentation.release.status).toBe("unreviewed");
      } else {
        expect(presentation.release).toEqual(expectedRelease);
      }
    }
    expect(versionedModelCardImagePath(card.path, "card.png")).toMatch(
      /\/card\.png\?v=[a-f0-9]{16}$/u,
    );
  });

  test("keeps square gallery cards readable without foil bleed chrome", async () => {
    const stylesheet = await Bun.file(
      new URL("../../styles/model-cards.css", import.meta.url),
    ).text();

    expect(stylesheet).toMatch(/\.model-card-grid__link\s*\{[^}]*aspect-ratio:\s*1;/su);
    expect(stylesheet).not.toContain("model-card-grid__bleed");
    expect(stylesheet).not.toContain("--foil-card-radius");
    expect(stylesheet).toMatch(/\.model-card-grid__link:focus-visible\s*\{[^}]*outline-offset:\s*4px;/su);
    expect(stylesheet).toMatch(/@media \(max-width:\s*560px\)[\s\S]*?\.model-card-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 22rem\);/u);
    expect(stylesheet).toMatch(/@media \(forced-colors:\s*active\)[\s\S]*?\.model-logo-card\s*\{[^}]*background:\s*Canvas;/u);
    expect(modelsPageSource).toContain("url: MODEL_CARD_COLLECTION_SOCIAL_IMAGE_URL");
  });
});
