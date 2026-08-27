import { ImageResponse } from "next/og";

import { ModelCardCollectionSocialImage } from "@/components/model-card-image";
import {
  MODEL_CARD_PRESENTATIONS,
  modelCardProviderRepresentatives,
} from "@/lib/model-card-collection";

export const alt = "AI model benchmark cards across ten providers";
export const contentType = "image/png";
export const size = { height: 630, width: 1200 };

export default function OpenGraphImage() {
  const representatives = modelCardProviderRepresentatives();
  return new ImageResponse(
    <ModelCardCollectionSocialImage
      cards={representatives}
      profileCount={MODEL_CARD_PRESENTATIONS.length}
      providerCount={representatives.length}
    />,
    size,
  );
}
