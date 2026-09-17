import {
  socialImageContentType,
  socialImageSize,
} from "@hraness/web-discovery/social-image";
import { notFound } from "next/navigation";

import {
  findModelCardPresentation,
  modelCardRouteStaticParams,
} from "@/lib/model-card-collection";
import type { ModelCardRouteParams } from "@/lib/model-card-data";

import { modelCardDescription, modelCardTitle } from "../../../../site";
import { aichartsSocialImage } from "../../../../social-card";

export const alt = "Horizontal illuminated AI model benchmark specimen with logo and statistics";
export const contentType = socialImageContentType;
export const size = socialImageSize;

export function generateStaticParams() {
  return [...modelCardRouteStaticParams()];
}

export default async function OpenGraphImage({
  params,
}: Readonly<{ params: Promise<ModelCardRouteParams> }>) {
  const card = findModelCardPresentation(await params);
  if (card === undefined) notFound();
  return aichartsSocialImage({
    description: modelCardDescription(card.displayTitle),
    eyebrow: card.providerName,
    title: modelCardTitle(card.displayTitle),
  });
}
