import { ImageResponse } from "next/og";

import { ModelCardRasterFace } from "@/components/model-card-image";
import {
  findModelCardPresentation,
  modelCardRouteStaticParams,
} from "@/lib/model-card-collection";
import type { ModelCardRouteParams } from "@/lib/model-card-data";

const portraitSize = { height: 1400, width: 1000 } as const;

export function generateStaticParams() {
  return [...modelCardRouteStaticParams()];
}

export async function GET(
  _request: Request,
  context: Readonly<{ params: Promise<ModelCardRouteParams> }>,
) {
  const card = findModelCardPresentation(await context.params);
  if (card === undefined) return new Response("Not found", { status: 404 });
  return new ImageResponse(<ModelCardRasterFace card={card} />, {
    ...portraitSize,
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Content-Disposition": `inline; filename="aicharts-${card.canonicalModelId.replaceAll("/", "-")}-${card.profileSlug}.png"`,
    },
  });
}
