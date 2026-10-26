import { describe, expect, test } from "bun:test";
import {
  socialImageFit,
  socialImageSiteDetails,
  type SocialImagePage,
} from "@hraness/web-discovery/social-image/card";

import { MODEL_CARD_PRESENTATIONS } from "@/lib/model-card-collection";
import { INDEX_MODEL_PAGES } from "@/lib/index-model-pages";
import { assertProperty, fc } from "@/lib/property-test";

import {
  aichartsSocialImageSite,
  blogCollectionSocialImagePage,
  codingAgentProfileSocialImageEyebrow,
  codingAgentProfileSocialImagePage,
  homeSocialImagePage,
  indexModelSocialImagePage,
  modelSocialImageAlt,
  modelSocialImageCopy,
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
    // Every card carries an eyebrow unless the title is only the provider,
    // in which case the template omits it. The home card's is the hero's.
    expect(fit.eyebrow ?? "").toBe(typeof page.eyebrow === "string" ? page.eyebrow : "Blog");
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
    expect(modelSocialImageHeadline("MiniMax-M3.1-Flash", "MiniMax")).toBe("M3.1-Flash");
    expect(modelSocialImageHeadline("MiniMax-M3", "MiniMax")).toBe("M3");
    expect(modelSocialImageHeadline("minimax-m3.1-flash", "MiniMax")).toBe("m3.1-flash");
    expect(modelSocialImageHeadline("Kimi K3.1 Pro", "Kimi")).toBe("K3.1 Pro");
    expect(modelSocialImageCopy("MiniMax-M3.1-Flash", "MiniMax")).toEqual({
      eyebrow: "MiniMax",
      headline: "M3.1-Flash",
    });
    expect(modelSocialImageCopy("DeepSeek", "DeepSeek")).toEqual({
      eyebrow: "",
      headline: "DeepSeek",
    });
    const hyphenated = indexModelSocialImagePage({
      costUsdPerTask: 0.22,
      displayTitle: "MiniMax-M3.1-Flash",
      intelligenceIndex: 43,
      providerName: "MiniMax",
      sourceName: "Artificial Analysis Intelligence Index v4.3",
    });
    expect(hyphenated).toMatchObject({ eyebrow: "MiniMax", headline: "M3.1-Flash" });
    const hyphenatedFit = socialImageFit(socialImageSiteDetails(aichartsSocialImageSite, hyphenated));
    expect(hyphenatedFit.findings).toEqual([]);
    expect(hyphenatedFit.issues).toEqual([]);
    expect(hyphenatedFit.removed).toEqual([]);
    expect(hyphenatedFit.eyebrow).toBe("MiniMax");
    const providerOnly = socialImageFit(socialImageSiteDetails(
      aichartsSocialImageSite,
      indexModelSocialImagePage({
        costUsdPerTask: null,
        displayTitle: "DeepSeek",
        intelligenceIndex: 10,
        providerName: "DeepSeek",
        sourceName: "Artificial Analysis Intelligence Index v4.3",
      }),
    ));
    expect(providerOnly.findings).toEqual([]);
    expect(providerOnly.eyebrow ?? "").toBe("");
  });

  test("a title that opens with the provider plus a separator keeps a non-repeating card", () => {
    const provider = fc.stringMatching(/^[A-Z][a-z]{3,8}$/u);
    const remainderHead = fc.stringMatching(/^[A-Z][a-z0-9]{1,8}$/u);
    const remainderTail = fc.stringMatching(/^[A-Za-z0-9.-]{0,10}$/u);
    const separator = fc.constantFrom(" ", "-", "_");
    assertProperty(fc.property(provider, remainderHead, remainderTail, separator, (
      eyebrow,
      head,
      tail,
      join,
    ) => {
      const rest = `${head}${tail}`;
      fc.pre(rest.toLocaleLowerCase("en-US") !== eyebrow.toLocaleLowerCase("en-US"));
      fc.pre(!rest.toLocaleLowerCase("en-US").startsWith(eyebrow.toLocaleLowerCase("en-US")));
      const page = modelSocialImageCopy(`${eyebrow}${join}${rest}`, eyebrow);
      expect(page).toEqual({ eyebrow, headline: rest });
    }));
  });

  test("model page subtitles do not repeat the headline", () => {
    for (const [, page] of cards) {
      if (page.headline === undefined || page.description === undefined) continue;
      expect(page.description).not.toContain(page.headline);
    }
  });

  test("the home card shows the hero eyebrow and H1 without repeating the tagline", () => {
    expect(homeSocialImagePage).toMatchObject({ eyebrow: homeEyebrow.toUpperCase(), headline: homeHeading, layout: "product" });
    const fit = socialImageFit(socialImageSiteDetails(aichartsSocialImageSite, homeSocialImagePage));
    expect(fit.layout).toBe("product");
    expect(fit.eyebrow).toBe(homeEyebrow.toUpperCase());
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
