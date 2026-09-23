import {
  socialImageContentType,
  socialImageSize,
} from "@hraness/web-discovery/social-image";
import { notFound } from "next/navigation";

import {
  findModelCardPresentation,
  modelCardRouteStaticParams,
} from "@/lib/model-card-collection";
import {
  findIndexModelPage,
  formatIntelligenceCost,
  formatIntelligenceIndex,
  indexModelRouteStaticParams,
} from "@/lib/index-model-pages";
import type { ModelCardRouteParams } from "@/lib/model-card-data";

import { indexModelPageDescription, modelCardDescription, modelCardTitle } from "../../../../site";
import { aichartsSocialImage } from "../../../../social-card";

export const alt = "AI Charts model page with provider, name, and Intelligence Index";
export const contentType = socialImageContentType;
export const size = socialImageSize;

export function generateStaticParams() {
  return [...modelCardRouteStaticParams(), ...indexModelRouteStaticParams()];
}

export default async function OpenGraphImage({
  params,
}: Readonly<{ params: Promise<ModelCardRouteParams> }>) {
  const resolved = await params;
  const card = findModelCardPresentation(resolved);
  if (card !== undefined) {
    return aichartsSocialImage({
      description: modelCardDescription(card.displayTitle),
      eyebrow: card.providerName,
      title: modelCardTitle(card.displayTitle),
    });
  }
  const indexPage = findIndexModelPage(resolved);
  if (indexPage === undefined) notFound();
  return aichartsSocialImage({
    description: indexModelPageDescription({
      cost: indexPage.costUsdPerTask === null ? null : formatIntelligenceCost(indexPage.costUsdPerTask),
      displayTitle: indexPage.displayTitle,
      score: formatIntelligenceIndex(indexPage.intelligenceIndex),
      sourceName: indexPage.sourceName,
    }),
    eyebrow: indexPage.providerName,
    title: modelCardTitle(indexPage.displayTitle),
  });
}
