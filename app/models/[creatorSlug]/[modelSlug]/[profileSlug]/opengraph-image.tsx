import {
  createSiteSocialImageResponse,
  socialImageContentType,
  socialImageSize,
} from "@hraness/web-discovery/social-image";
import { notFound } from "next/navigation";

import {
  findModelCardPresentation,
  modelCardRouteStaticParams,
} from "@/lib/model-card-collection";
import { findIndexModelPage, indexModelRouteStaticParams } from "@/lib/index-model-pages";
import type { ModelCardRouteParams } from "@/lib/model-card-data";

import {
  aichartsSocialImageSite,
  codingAgentProfileSocialImagePage,
  indexModelSocialImagePage,
} from "../../../../social-image-site";

export const alt = "aicharts model page with provider, name, and Intelligence Index";
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
    return createSiteSocialImageResponse(aichartsSocialImageSite, codingAgentProfileSocialImagePage(card));
  }
  const indexPage = findIndexModelPage(resolved);
  if (indexPage === undefined) notFound();
  return createSiteSocialImageResponse(aichartsSocialImageSite, indexModelSocialImagePage(indexPage));
}
