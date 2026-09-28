import {
  defineSocialImageSite,
  socialImageAlt,
  type SocialImagePage,
} from "@hraness/web-discovery/social-image/card";

import { aichartsMarkDataUrl } from "./social-image-mark";
import { modelCardsEyebrow, site } from "./site";

/**
 * The one social-image declaration for AI Charts. Every Open Graph and
 * Twitter image renders from it through the shared web-discovery template;
 * routes add page copy only.
 */
export const aichartsSocialImageSite = defineSocialImageSite({
  description: "Model benchmark scores plotted against cost and tokens per task",
  domain: site.domain,
  icon: { kind: "mark", src: aichartsMarkDataUrl },
  name: site.name,
  theme: {
    accent: "#2474d4",
    background: "#e1e2e7",
    foreground: "#1c3161",
    muted: "#414c76",
  },
});

export function aichartsSocialImageAlt(page: SocialImagePage = {}): string {
  return socialImageAlt(aichartsSocialImageSite, page);
}

export const blogCollectionSocialImagePage = {
  description: "Sourced methods, results, and limits from AI evaluations.",
  eyebrow: "Benchmark analysis",
  headline: "AI model and agent benchmark analysis",
} as const satisfies SocialImagePage;

export const modelsSocialImagePage = {
  description: "Intelligence Index scores, cost per task, and coding-agent results",
  eyebrow: modelCardsEyebrow,
  headline: "AI models",
} as const satisfies SocialImagePage;

/**
 * Card copy for a coding-agent profile page. The page's meta description
 * repeats the model name, which the card already shows as its headline.
 */
export const codingAgentProfileSocialImageDescription =
  "Scores, cost, time, and tokens per task on the Artificial Analysis coding-agent chart.";

/** Copy for one model page card: the model name under its provider. */
export function modelSocialImagePage(
  page: Readonly<{ description: string; displayTitle: string; providerName: string }>,
): SocialImagePage {
  return {
    description: page.description,
    eyebrow: page.providerName,
    headline: page.displayTitle,
  };
}
