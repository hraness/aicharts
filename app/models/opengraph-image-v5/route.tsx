import { ImageResponse } from "next/og";

import { ModelCardCollectionSocialImage } from "@/components/model-card-image";
import {
  MODEL_CARD_PRESENTATIONS,
  modelCardProviderCount,
  modelCardProviderRepresentatives,
} from "@/lib/model-card-collection";

const size = { height: 630, width: 1200 } as const;

export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    <ModelCardCollectionSocialImage
      cards={modelCardProviderRepresentatives()}
      profileCount={MODEL_CARD_PRESENTATIONS.length}
      providerCount={modelCardProviderCount()}
    />,
    size,
  );
}
