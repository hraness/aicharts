import { describe, expect, test } from "bun:test";
import { ATLAS_DATASETS, ATLAS_ENTRIES } from "@/lib/benchmark-atlas-catalog";
import { ATLAS_CATALOG_CONTENT_UPDATED_AT, atlasCatalogDistribution, atlasContentModifiedAt, atlasDataCatalogJsonLd, atlasDatasetDownloadPath } from "@/lib/benchmark-atlas-distribution";
import { GET as getCatalog, dynamic as catalogDynamic } from "./benchmark-atlas.json/route";
import { GET as getDataset, dynamic as datasetDynamic, dynamicParams, generateStaticParams } from "./benchmark-atlas/[benchmarkId]/route";

const request = new Request("https://aicharts.io/data/benchmark-atlas.json");

describe("benchmark atlas distribution", () => {
  test("publishes a compact catalog without misrepresenting guides as measurements", async () => {
    expect(catalogDynamic).toBe("force-static");
    const response = getCatalog();
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="aicharts-benchmark-atlas.json"');
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const catalog = atlasCatalogDistribution();
    expect(await response.json()).toEqual(catalog);
    expect(catalog.entries).toHaveLength(ATLAS_ENTRIES.length);
    expect(JSON.stringify(catalog)).not.toContain('"points":');
    for (const entry of catalog.entries) {
      const dataset = ATLAS_DATASETS.find(value => value.benchmarkId === entry.id);
      expect(entry.explorationUrl).toBe(`https://aicharts.io/benchmarks?atlas=${entry.id}#explore`);
      if (dataset === undefined) {
        expect(entry.coverage).not.toBe("charted");
        expect(entry.dataset).toBeNull();
      } else {
        expect(entry.version).toBe(dataset.version);
        expect(entry.dataset).toMatchObject({ configurationCount: dataset.points.length, source: dataset.source, score: dataset.score, url: `https://aicharts.io${atlasDatasetDownloadPath(entry.id)}` });
      }
    }
  });

  test("prebuilds only charted cohorts and preserves native configuration evidence", async () => {
    expect(datasetDynamic).toBe("force-static");
    expect(dynamicParams).toBeFalse();
    expect(generateStaticParams()).toEqual(ATLAS_DATASETS.map(dataset => ({ benchmarkId: dataset.benchmarkId })));
    for (const dataset of ATLAS_DATASETS) {
      const response = await getDataset(request, { params: Promise.resolve({ benchmarkId: dataset.benchmarkId }) });
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
      expect(response.headers.get("Cache-Control")).toContain("s-maxage=3600");
      expect(response.headers.get("Last-Modified")).toBe(new Date(atlasContentModifiedAt([dataset])).toUTCString());
      expect(await response.json()).toEqual({ schemaVersion: 1, benchmark: ATLAS_ENTRIES.find(entry => entry.id === dataset.benchmarkId), dataset });
    }
  });

  test("returns an honest 404 for source guides and unadmitted identifiers", async () => {
    const sourceOnly = ATLAS_ENTRIES.find(entry => entry.coverage !== "charted")!;
    for (const benchmarkId of [sourceOnly.id, "not-a-benchmark", "../benchmark-atlas.json", '<script>alert(1)</script>']) {
      const response = await getDataset(request, { params: Promise.resolve({ benchmarkId }) });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "No charted dataset exists for this benchmark.", catalog: "/data/benchmark-atlas.json" });
    }
  });

  test("separates authored content changes from retrieval and observation dates", () => {
    expect(atlasContentModifiedAt([])).toBe(ATLAS_CATALOG_CONTENT_UPDATED_AT);
    const dataset = ATLAS_DATASETS[0]!;
    const futureRetrieval = "2030-01-01T00:00:00.000Z";
    expect(atlasContentModifiedAt([{ ...dataset, source: { ...dataset.source, retrievedAt: futureRetrieval } }])).toBe(futureRetrieval);
    const catalog = atlasCatalogDistribution();
    expect(catalog.entries.find(entry => entry.id === dataset.benchmarkId)?.dataset?.source.retrievedAt).toBe(dataset.source.retrievedAt);
    expect(catalog.contentModifiedAt).toBe(atlasContentModifiedAt());
  });

  test("structured data describes only downloadable datasets without relicensing sources", () => {
    const catalog = atlasDataCatalogJsonLd();
    expect(catalog["@type"]).toBe("DataCatalog");
    expect(catalog.dataset).toHaveLength(ATLAS_DATASETS.length);
    for (const data of catalog.dataset) {
      const dataset = ATLAS_DATASETS.find(value => data["@id"].endsWith(`atlas-${value.benchmarkId}`))!;
      expect(data.version).toBe(dataset.version);
      expect(data.citation).toBe(dataset.source.url);
      expect(data.distribution.contentUrl).toBe(`https://aicharts.io${atlasDatasetDownloadPath(dataset.benchmarkId)}`);
      expect(data.variableMeasured[0].unitText).toBe(dataset.score.unit);
      if (dataset.costLabel) expect(data.variableMeasured[1].name).toBe(dataset.costLabel);
      expect(data).not.toHaveProperty("license");
    }
  });
});
