import { ATLAS_DATASETS, ATLAS_ENTRIES } from "./benchmark-atlas-catalog";
import { atlasDatasetSummary, type BenchmarkAtlasDataset, type BenchmarkAtlasEntry } from "./benchmark-atlas";
import { BENCHMARK_DATA_DESCRIPTION } from "./benchmark-portfolio";

export const ATLAS_CATALOG_DOWNLOAD_PATH = "/data/benchmark-atlas.json";
export const ATLAS_CATALOG_CONTENT_UPDATED_AT = "2026-09-09T02:05:18Z";
export const ATLAS_DATA_DESCRIPTION = BENCHMARK_DATA_DESCRIPTION;

export function atlasDatasetDownloadPath(benchmarkId: string): string {
  return `/data/benchmark-atlas/${encodeURIComponent(benchmarkId)}`;
}

/** Content and checked observations determine modification time, never the request or build clock. */
export function atlasContentModifiedAt(datasets: readonly BenchmarkAtlasDataset[] = ATLAS_DATASETS): string {
  return [ATLAS_CATALOG_CONTENT_UPDATED_AT, ...datasets.map(dataset => dataset.source.retrievedAt)]
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0]!;
}

export function atlasCatalogDistribution(
  entries: readonly BenchmarkAtlasEntry[] = ATLAS_ENTRIES,
  datasets: readonly BenchmarkAtlasDataset[] = ATLAS_DATASETS,
) {
  return {
    schemaVersion: 1,
    name: "AI Charts benchmark atlas",
    description: ATLAS_DATA_DESCRIPTION,
    contentModifiedAt: atlasContentModifiedAt(datasets),
    comparisonPolicy: "Each dataset is a separate evaluation cohort. Scores, cost bases, harnesses, and versions are not pooled into a universal rank. Source-only entries have no charted observations.",
    reuseNotice: "AI Charts software is MIT-licensed. Third-party measurements and methodology retain their source terms; this distribution does not grant a new license to them. Cite the source and named evaluation version.",
    entries: entries.map(entry => {
      const dataset = datasets.find(candidate => candidate.benchmarkId === entry.id);
      return {
        ...entry,
        explorationUrl: `https://aicharts.io/?atlas=${entry.id}#explore`,
        dataset: dataset === undefined ? null : {
          url: `https://aicharts.io${atlasDatasetDownloadPath(entry.id)}`,
          configurationCount: dataset.points.length,
          score: dataset.score,
          source: dataset.source,
          ...(dataset.observedAt === undefined ? {} : { observedAt: dataset.observedAt }),
          ...(dataset.evidenceLabel === undefined ? {} : { evidenceLabel: dataset.evidenceLabel }),
          ...(dataset.costLabel === undefined ? {} : { costLabel: dataset.costLabel }),
        },
      };
    }),
  };
}

export function atlasDataCatalogJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "DataCatalog",
    "@id": "https://aicharts.io/data#benchmark-atlas",
    name: "AI Charts benchmark atlas",
    description: ATLAS_DATA_DESCRIPTION,
    url: "https://aicharts.io/data#benchmark-atlas",
    dateModified: atlasContentModifiedAt(),
    publisher: { "@type": "Organization", name: "AI Charts", url: "https://aicharts.io/" },
    dataset: ATLAS_DATASETS.map(dataset => {
      const entry = ATLAS_ENTRIES.find(candidate => candidate.id === dataset.benchmarkId)!;
      const summary = atlasDatasetSummary(dataset);
      return {
        "@type": "Dataset",
        "@id": `https://aicharts.io/data#atlas-${entry.id}`,
        name: `${entry.name} · ${entry.version}`,
        description: `${entry.measure} ${summary.configurationCount} retained configurations. ${dataset.comparabilityNote}`,
        url: `https://aicharts.io/data#atlas-${entry.id}`,
        version: dataset.version,
        dateModified: atlasContentModifiedAt([dataset]),
        citation: dataset.source.url,
        isBasedOn: dataset.source.url,
        measurementTechnique: entry.comparisonRule,
        publisher: { "@type": "Organization", name: "AI Charts", url: "https://aicharts.io/" },
        distribution: {
          "@type": "DataDownload",
          contentUrl: `https://aicharts.io${atlasDatasetDownloadPath(entry.id)}`,
          encodingFormat: "application/json",
        },
        variableMeasured: [
          { "@type": "PropertyValue", name: dataset.score.label, unitText: dataset.score.unit },
          ...(dataset.costLabel === undefined ? [] : [{ "@type": "PropertyValue", name: dataset.costLabel, unitText: "USD" }]),
        ],
      };
    }),
  };
}

export function atlasJsonResponse(value: unknown, filename: string, modifiedAt: string): Response {
  return new Response(`${JSON.stringify(value, null, 2)}\n`, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/json; charset=utf-8",
      "Last-Modified": new Date(modifiedAt).toUTCString(),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
