import { ATLAS_DATASETS, ATLAS_ENTRIES } from "@/lib/benchmark-atlas-catalog";
import { atlasContentModifiedAt, atlasJsonResponse } from "@/lib/benchmark-atlas-distribution";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return ATLAS_DATASETS.map(dataset => ({ benchmarkId: dataset.benchmarkId }));
}

export async function GET(
  _request: Request,
  context: Readonly<{ params: Promise<{ benchmarkId: string }> }>,
): Promise<Response> {
  const { benchmarkId } = await context.params;
  const dataset = ATLAS_DATASETS.find(candidate => candidate.benchmarkId === benchmarkId);
  const benchmark = ATLAS_ENTRIES.find(candidate => candidate.id === benchmarkId);
  if (dataset === undefined || benchmark === undefined) {
    return Response.json({ error: "No charted dataset exists for this benchmark.", catalog: "/data/benchmark-atlas.json" }, {
      status: 404,
      headers: { "Cache-Control": "public, max-age=0, s-maxage=3600", "X-Content-Type-Options": "nosniff" },
    });
  }
  return atlasJsonResponse({ schemaVersion: 1, benchmark, dataset }, `aicharts-${benchmark.id}.json`, atlasContentModifiedAt([dataset]));
}
