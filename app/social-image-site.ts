import {
  defineSocialImageSite,
  socialImageAlt,
  type SocialImagePage,
} from "@hraness/web-discovery/social-image/card";

import { formatIntelligenceCost, formatIntelligenceIndex } from "@/lib/index-model-pages";
import { MODEL_CARD_FALLBACK_CREATOR_SLUG } from "@/lib/model-card-route-status";

import { productMessaging } from "./messaging";
import { aichartsHeaderMarkSvg } from "./social-image-mark";
import { modelCardsEyebrow, site } from "./site";

/**
 * The one social-image declaration for aicharts. Every Open Graph and
 * Twitter image renders from it through the shared web-discovery template;
 * routes add page copy only.
 */
export const aichartsSocialImageSite = defineSocialImageSite({
  // The header's foil mark and product name, on the site's Design Kit palette.
  brand: site.name,
  brandMark: aichartsHeaderMarkSvg,
  description: productMessaging.short,
  domain: site.domain,
  // Names the cards set that must not break across lines.
  keepTogether: ["Artificial Analysis", "Claude Code", "Devin Fusion CLI", "Intelligence Index", "Muse Spark"],
  name: site.name,
  // The `data-palette` on <html> in app/layout.tsx.
  palette: "tokyo-night",
});

export function aichartsSocialImageAlt(page: SocialImagePage = {}): string {
  return socialImageAlt(aichartsSocialImageSite, page);
}

export const blogCollectionSocialImagePage = {
  description: "Sourced benchmark results and their limits.",
  headline: "AI model and agent benchmark analysis",
  // The route names the eyebrow: "Blog".
  path: "/blog",
} as const satisfies SocialImagePage;

export const modelsSocialImagePage = {
  description: "Intelligence Index scores, cost per task, and coding-agent results.",
  eyebrow: modelCardsEyebrow,
  headline: "AI models",
} as const satisfies SocialImagePage;

/**
 * Card copy for a coding-agent profile page. The page's meta description
 * repeats the model name, which the card already shows as its headline, and
 * a two-line headline leaves room for one line at the standard size.
 */
export const codingAgentProfileSocialImageDescription =
  "Scores, cost, time, and tokens per coding task.";

/**
 * The card headline under a provider eyebrow. A title that opens with the
 * provider's own name ("DeepSeek V4 Flash") would hide the eyebrow, so the
 * card reads the name top to bottom instead: "DeepSeek" over "V4 Flash".
 */
export function modelSocialImageHeadline(displayTitle: string, eyebrow: string): string {
  const prefix = `${eyebrow} `;
  return displayTitle.startsWith(prefix) && displayTitle.length > prefix.length
    ? displayTitle.slice(prefix.length)
    : displayTitle;
}

/** Alt text for a model page card names the whole model, as the page does. */
export function modelSocialImageAlt(displayTitle: string): string {
  return aichartsSocialImageAlt({ headline: displayTitle });
}

/**
 * The eyebrow over a coding-agent profile card. A catalogued model shows its
 * provider. An uncatalogued entry only has the provider the benchmark lists,
 * which for a combined run such as "Claude Fable 5.1 XHigh + SWE-2 Medium" is
 * the harness vendor, not the model maker, so the card names the harness.
 */
export function codingAgentProfileSocialImageEyebrow(
  card: Readonly<{ canonicalModelId: string; harnessLabel: string; providerName: string }>,
): string {
  return card.canonicalModelId.startsWith(`${MODEL_CARD_FALLBACK_CREATOR_SLUG}/`)
    ? `Agent harness: ${card.harnessLabel}`
    : card.providerName;
}

/** Card copy for a coding-agent profile page: the model under its provider. */
export function codingAgentProfileSocialImagePage(
  card: Readonly<{ canonicalModelId: string; displayTitle: string; harnessLabel: string; providerName: string }>,
): SocialImagePage {
  const eyebrow = codingAgentProfileSocialImageEyebrow(card);
  return {
    description: codingAgentProfileSocialImageDescription,
    eyebrow,
    headline: modelSocialImageHeadline(card.displayTitle, eyebrow),
  };
}

/**
 * Card copy for an Index-only model page. The headline already names the
 * model, so the subtitle leads with the score instead of repeating the
 * page's meta description, which starts with the model name.
 */
export function indexModelSocialImagePage(page: Readonly<{
  costUsdPerTask: number | null;
  displayTitle: string;
  intelligenceIndex: number;
  providerName: string;
  sourceName: string;
}>): SocialImagePage {
  const cost = page.costUsdPerTask === null ? "" : `, at ${formatIntelligenceCost(page.costUsdPerTask)} per task`;
  return {
    description: `Scores ${formatIntelligenceIndex(page.intelligenceIndex)} on the ${page.sourceName}${cost}.`,
    eyebrow: page.providerName,
    headline: modelSocialImageHeadline(page.displayTitle, page.providerName),
  };
}
