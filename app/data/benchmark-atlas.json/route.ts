import { atlasCatalogDistribution, atlasContentModifiedAt, atlasJsonResponse } from "@/lib/benchmark-atlas-distribution";

export const dynamic = "force-static";

export function GET(): Response {
  return atlasJsonResponse(atlasCatalogDistribution(), "aicharts-benchmark-atlas.json", atlasContentModifiedAt());
}
