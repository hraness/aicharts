import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";

import currentJson from "../data/artificial-analysis-intelligence-v4-3.json";
import {
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_CITATION,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME,
  ARTIFICIAL_ANALYSIS_TERMS_URL,
} from "../lib/artificial-analysis-intelligence-data";
import {
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS,
  parseArtificialAnalysisIntelligenceV43Snapshot,
} from "../lib/artificial-analysis-intelligence-v4-3-data";
import { parseArtificialAnalysisWeightsSnapshot } from "../lib/artificial-analysis-weights";
import { err, ok } from "../lib/result";
import { extractArtificialAnalysisIntelligencePage, parseArtificialAnalysisModelsPayload } from "./refresh-artificial-analysis-intelligence";
import { ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_PAGE_CONTRACT } from "./refresh-artificial-analysis-intelligence-v4-3";
import { refreshArtificialAnalysisWeights } from "./refresh-artificial-analysis-weights";

const manifestKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const manifestPath = "/data/0123456789abcdef.txt";
const parsedCurrent = parseArtificialAnalysisIntelligenceV43Snapshot(currentJson);
if (!parsedCurrent.ok) throw parsedCurrent.error;
const current = parsedCurrent.value;

function sourcePayload() {
  const models = current.records.map(record => ({
    ...record,
    deprecated: false,
    intelligenceIndexIsEstimated: false,
    intelligenceIndexOutputTokensPerTask: {
      answer: record.outputTokensPerTask.answer,
      reasoning: record.outputTokensPerTask.reasoning,
      output: record.outputTokensPerTask.total,
    },
    intelligenceIndexCostPerTask: { cost: record.costUsdPerTask ?? {
      answer: 0, cacheRead: 0, cacheWrite: 0, input: 0, nonCacheInput: 0, output: 0, reasoning: 0, total: 0,
    } },
    isOpenWeights: record.weights?.open ?? false,
    licenseName: record.weights?.license ?? null,
    modelWeightsSourceUrl: record.weights?.sourceUrl ?? null,
  }));
  models.push({
    ...models[0]!,
    creator: { ...models[0]!.creator, slug: "kimi" },
    deprecated: true,
    id: "00000000-0000-4000-8000-000000000099",
    isOpenWeights: true,
    release: { name: "Kimi K3", slug: "kimi-k3" },
    slug: "kimi-k3",
  });
  for (let index = models.length; index < Math.max(100, current.selection.sourceRecordCount); index += 1) {
    models.push({
      ...models[0]!,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      slug: `excluded-${index}`,
      deprecated: true,
    });
  }
  const result = parseArtificialAnalysisModelsPayload({ models });
  if (!result.ok) throw result.error;
  return result.value;
}

function sourcePage(payload = sourcePayload()): string {
  const dataset = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    citation: ARTIFICIAL_ANALYSIS_INTELLIGENCE_CITATION,
    creator: { "@type": "Organization", name: "Artificial Analysis", url: "https://artificialanalysis.ai" },
    description: `${ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME} v4.3.2 incorporates ${ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS.length} evaluations: ${ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS.join(", ")} · Evaluation results measured independently by Artificial Analysis`,
    isAccessibleForFree: true,
    license: ARTIFICIAL_ANALYSIS_TERMS_URL,
    name: ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME,
  };
  const flight = `1:${JSON.stringify(["$", "div", null, { initialModels: [], manifest: { key: manifestKey, path: manifestPath } }])}`;
  return `<a href="/methodology/intelligence-benchmarking">Methodology</a><script>self.__next_f.push(${JSON.stringify([1, flight])})</script><script type="application/ld+json">${JSON.stringify(dataset)}</script>`;
}

async function encryptPayload(value: unknown): Promise<Uint8Array> {
  const keyBytes = Uint8Array.from(manifestKey.match(/.{2}/gu) ?? [], pair => Number.parseInt(pair, 16));
  const digest = await crypto.subtle.digest("SHA-256", keyBytes.buffer);
  const iv = new Uint8Array(digest).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", keyBytes.buffer, { name: "AES-GCM" }, false, ["encrypt"]);
  return new Uint8Array(await crypto.subtle.encrypt(
    { iv, name: "AES-GCM", tagLength: 128 }, key, Uint8Array.from(gzipSync(JSON.stringify(value))).buffer,
  ));
}

describe("Artificial Analysis weights refresh", () => {
  test("writes the full source roster including deprecated models", async () => {
    const payload = sourcePayload();
    const writes: unknown[] = [];
    const result = await refreshArtificialAnalysisWeights({
      fetchPage: async () => ok(sourcePage(payload)),
      fetchManifest: async () => ok(await encryptPayload(payload)),
      now: () => "2026-10-27T08:20:03.356Z",
      readCommittedSnapshot: async () => ok(null),
      writeCommittedSnapshot: async snapshot => { writes.push(snapshot); },
    });
    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(extractArtificialAnalysisIntelligencePage(sourcePage(payload), ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_PAGE_CONTRACT).ok).toBeTrue();
    const parsed = parseArtificialAnalysisWeightsSnapshot(result.value);
    expect(parsed.ok).toBeTrue();
    expect(result.value.records.length).toBe(payload.models.length);
    expect(result.value.records.find(record => record.slug === "kimi-k3")).toMatchObject({
      deprecated: true,
      open: true,
    });
    expect(writes).toEqual([result.value]);
  });

  test("does not write when the models page is unavailable", async () => {
    let writes = 0;
    const result = await refreshArtificialAnalysisWeights({
      fetchPage: async () => err(new Error("Unavailable")),
      fetchManifest: async () => ok(await encryptPayload(sourcePayload())),
      readCommittedSnapshot: async () => ok(null),
      writeCommittedSnapshot: async () => { writes += 1; },
    });
    expect(result.ok).toBeFalse();
    expect(writes).toBe(0);
  });
});
