import { nebulaSansSocialFonts } from "@hraness/design-kit/fonts/nebula-sans/social";
import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";

import { ModelCardSocialImage } from "@/components/model-card-image";
import {
  findModelCardPresentation,
  modelCardRouteStaticParams,
} from "@/lib/model-card-collection";
import type { ModelCardRouteParams } from "@/lib/model-card-data";

export const alt = "Horizontal illuminated AI model benchmark specimen with logo and statistics";
export const contentType = "image/png";
export const size = { height: 630, width: 1200 };

export function generateStaticParams() {
  return [...modelCardRouteStaticParams()];
}

export default async function OpenGraphImage({
  params,
}: Readonly<{ params: Promise<ModelCardRouteParams> }>) {
  const card = findModelCardPresentation(await params);
  if (card === undefined) notFound();
  return new ImageResponse(
    <ModelCardSocialImage card={card} />,
    { ...size, fonts: [...nebulaSansSocialFonts()] },
  );
}
