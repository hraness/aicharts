import { describe, expect, test } from "bun:test";
import {
  socialImageFit,
  socialImageSiteDetails,
  type SocialImagePage,
} from "@hraness/web-discovery/social-image/card";

import { MODEL_CARD_PRESENTATIONS } from "@/lib/model-card-collection";
import { INDEX_MODEL_PAGES } from "@/lib/index-model-pages";

import {
  aichartsSocialImageSite,
  blogCollectionSocialImagePage,
  codingAgentProfileSocialImageEyebrow,
  codingAgentProfileSocialImagePage,
  homeSocialImagePage,
  indexModelSocialImagePage,
  modelSocialImageAlt,
  modelSocialImageHeadline,
  modelsSocialImagePage,
} from "./social-image-site";
import { homeEyebrow, homeHeading } from "./site";

// Every card the site serves, with the copy its route hands the template.
const cards: ReadonlyArray<readonly [string, SocialImagePage]> = [
  ["/", homeSocialImagePage],
  ["/blog", blogCollectionSocialImagePage],
  ["/models", modelsSocialImagePage],
  ...MODEL_CARD_PRESENTATIONS.map(card => [card.path, codingAgentProfileSocialImagePage(card)] as const),
  ...INDEX_MODEL_PAGES.map(page => [page.path, indexModelSocialImagePage(page)] as const),
];

describe("aicharts social-image copy fits the shared card as written", () => {
  test("declares cards for the home, collections, and every model page", () => {
    expect(cards.length).toBe(3 + MODEL_CARD_PRESENTATIONS.length + INDEX_MODEL_PAGES.length);
    expect(MODEL_CARD_PRESENTATIONS.length).toBeGreaterThan(0);
    expect(INDEX_MODEL_PAGES.length).toBeGreaterThan(0);
  });

  test.each(cards)("%s has no fit issues or review findings and one headline size", (path, page) => {
    const fit = socialImageFit(socialImageSiteDetails(aichartsSocialImageSite, page));
    expect(fit.findings).toEqual([]);
    expect(fit.issues).toEqual([]);
    expect(fit.removed).toEqual([]);
    expect(fit.headline.reduced).toBe(false);
    expect(fit.description?.cut ?? "none").toBe("none");
    expect(fit.description?.reduced ?? false).toBe(false);
    // Every card carries an eyebrow; the home card's is the hero's.
    expect(fit.eyebrow).toBe(typeof page.eyebrow === "string" ? page.eyebrow : "Blog");
  });

  test("model cards read the provider over the model name without repeating it", () => {
    const deepseek = INDEX_MODEL_PAGES.find(page => page.displayTitle.startsWith(`${page.providerName} `));
    if (deepseek !== undefined) {
      const card = indexModelSocialImagePage(deepseek);
      expect(`${card.eyebrow ?? ""} ${card.headline ?? ""}`).toBe(deepseek.displayTitle);
      expect(modelSocialImageAlt(deepseek.displayTitle)).toBe(`${deepseek.displayTitle}, from aicharts`);
    }
    expect(modelSocialImageHeadline("DeepSeek V4 Flash 0731 Max", "DeepSeek")).toBe("V4 Flash 0731 Max");
    expect(modelSocialImageHeadline("DeepSeek", "DeepSeek")).toBe("DeepSeek");
    expect(modelSocialImageHeadline("Opus 5 Max", "Anthropic")).toBe("Opus 5 Max");
    expect(modelSocialImageHeadline("GPT-6 Sol Max", "OpenAI")).toBe("GPT-6 Sol Max");
  });

  test("model page subtitles do not repeat the headline", () => {
    for (const [, page] of cards) {
      if (page.headline === undefined || page.description === undefined) continue;
      expect(page.description).not.toContain(page.headline);
    }
  });

  test("the home card shows the hero eyebrow and H1 without repeating the tagline", () => {
    expect(homeSocialImagePage).toMatchObject({ eyebrow: homeEyebrow, headline: homeHeading, layout: "product" });
    const fit = socialImageFit(socialImageSiteDetails(aichartsSocialImageSite, homeSocialImagePage));
    expect(fit.layout).toBe("product");
    expect(fit.eyebrow).toBe(homeEyebrow);
    expect(fit.headline.lines.join(" ")).toBe(homeHeading);
    expect(fit.headline.threeLine).toBe(false);
    expect(fit.description).toBeUndefined();
  });

  test("uncatalogued combined runs name the harness, not the listed provider, as the eyebrow", () => {
    const combined = MODEL_CARD_PRESENTATIONS.filter(card => card.canonicalModelId.startsWith("unlisted/"));
    for (const card of combined) {
      expect(codingAgentProfileSocialImageEyebrow(card)).toBe(`Agent harness: ${card.harnessLabel}`);
    }
    expect(codingAgentProfileSocialImageEyebrow({
      canonicalModelId: "unlisted/claude-fable-5-1-xhigh-swe-2-medium.e2f060e68d045988c8f73d9b",
      harnessLabel: "Devin Fusion CLI",
      providerName: "Cognition",
    })).toBe("Agent harness: Devin Fusion CLI");
    expect(codingAgentProfileSocialImageEyebrow({
      canonicalModelId: "anthropic/claude-opus-5.5",
      harnessLabel: "Claude Code",
      providerName: "Anthropic",
    })).toBe("Anthropic");
  });
});
