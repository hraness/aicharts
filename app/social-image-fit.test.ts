import { describe, expect, test } from "bun:test";
import {
  socialImageFit,
  socialImageIconShape,
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
  indexModelSocialImagePage,
  modelsSocialImagePage,
} from "./social-image-site";

// Every card the site serves, with the copy its route hands the template.
const cards: ReadonlyArray<readonly [string, SocialImagePage]> = [
  ["/", {}],
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

  test.each(cards)("%s has no fit issues and one headline size", (_path, page) => {
    const fit = socialImageFit(socialImageSiteDetails(aichartsSocialImageSite, page));
    expect(fit.issues).toEqual([]);
    expect(fit.removed).toEqual([]);
    expect(fit.headline.reduced).toBe(false);
    expect(fit.description?.cut ?? "none").toBe("none");
    // The template drops an eyebrow only when the headline already starts with it.
    if (page.eyebrow !== undefined && fit.eyebrow === undefined) {
      expect(page.headline?.startsWith(page.eyebrow)).toBe(true);
    } else {
      expect(fit.eyebrow).toBe(page.eyebrow);
    }
  });

  test("model page subtitles do not repeat the headline", () => {
    for (const [, page] of cards) {
      if (page.headline === undefined || page.description === undefined) continue;
      expect(page.description).not.toContain(page.headline);
    }
  });

  test("the app mark is drawn as a glyph in the tile's safe area", () => {
    const icon = aichartsSocialImageSite.icon;
    if (icon === undefined) throw new Error("Expected the aicharts mark.");
    expect(socialImageIconShape(icon)).toBe("open");
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
