import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";

import currentJson from "../data/artificial-analysis-intelligence-v4-3.json";
import { ARTIFICIAL_ANALYSIS_INTELLIGENCE_CITATION, ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME, ARTIFICIAL_ANALYSIS_TERMS_URL } from "../lib/artificial-analysis-intelligence-data";
import { ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS, parseArtificialAnalysisIntelligenceV43Snapshot, type ArtificialAnalysisIntelligenceV43Snapshot } from "../lib/artificial-analysis-intelligence-v4-3-data";
import { err, ok } from "../lib/result";
import { extractArtificialAnalysisIntelligencePage, parseArtificialAnalysisModelsPayload } from "./refresh-artificial-analysis-intelligence";
import {
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_PAGE_CONTRACT,
  deriveArtificialAnalysisIntelligenceV43Snapshot,
  refreshArtificialAnalysisIntelligenceV43,
  validateArtificialAnalysisIntelligenceV43PublishedScores,
} from "./refresh-artificial-analysis-intelligence-v4-3";

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
  }));
  for (let index = models.length; index < Math.max(100, current.selection.sourceRecordCount); index += 1) {
    models.push({ ...models[0]!, id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, slug: `excluded-${index}`, deprecated: true });
  }
  const result = parseArtificialAnalysisModelsPayload({ models });
  if (!result.ok) throw result.error;
  return result.value;
}

function sourcePage(payload = sourcePayload(), version = "4.3", evaluations: readonly string[] = ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS): string {
  const dataset = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    citation: ARTIFICIAL_ANALYSIS_INTELLIGENCE_CITATION,
    creator: { "@type": "Organization", name: "Artificial Analysis", url: "https://artificialanalysis.ai" },
    description: `${ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME} v${version} incorporates ${evaluations.length} evaluations: ${evaluations.join(", ")} · Evaluation results measured independently by Artificial Analysis`,
    isAccessibleForFree: true,
    license: ARTIFICIAL_ANALYSIS_TERMS_URL,
    name: ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME,
    data: payload.models.slice(0, 20).map(model => ({ label: model.shortName, detailsUrl: `/models/${model.slug}`, intelligenceIndex: model.intelligenceIndex })),
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

function derivedSnapshot(): ArtificialAnalysisIntelligenceV43Snapshot {
  const payload = sourcePayload();
  const page = extractArtificialAnalysisIntelligencePage(sourcePage(payload), ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_PAGE_CONTRACT);
  if (!page.ok) throw page.error;
  const derived = deriveArtificialAnalysisIntelligenceV43Snapshot(payload, page.value, current.source.retrievedAt);
  if (!derived.ok) throw derived.error;
  return derived.value;
}

describe("Artificial Analysis Intelligence v4.3 refresh", () => {
  test("requires the exact new version and complete evaluation roster without weakening historical defaults", () => {
    const html = sourcePage();
    expect(extractArtificialAnalysisIntelligencePage(html, ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_PAGE_CONTRACT).ok).toBeTrue();
    expect(extractArtificialAnalysisIntelligencePage(html).ok).toBeFalse();
    expect(extractArtificialAnalysisIntelligencePage(sourcePage(sourcePayload(), "4.4"), ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_PAGE_CONTRACT).ok).toBeFalse();
    expect(extractArtificialAnalysisIntelligencePage(html.replace("AA-LCR v1.1 ·", "AA-LCR v1.1, Surprise Eval ·"), ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_PAGE_CONTRACT).ok).toBeFalse();
    expect(extractArtificialAnalysisIntelligencePage(html.replace("Terminal-Bench v4.0", "Terminal-Bench v2.1"), ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_PAGE_CONTRACT).ok).toBeFalse();
  });

  test("binds public leaderboard scores to the exact native-resource model manifest", () => {
    const payload = sourcePayload();
    const html = sourcePage(payload);
    expect(validateArtificialAnalysisIntelligenceV43PublishedScores(html, payload).ok).toBeTrue();
    payload.models[0]!.intelligenceIndex = 1;
    expect(validateArtificialAnalysisIntelligenceV43PublishedScores(html, payload).ok).toBeFalse();
    expect(validateArtificialAnalysisIntelligenceV43PublishedScores(html.replaceAll("\"data\":", "\"removedData\":"), payload).ok).toBeFalse();
  });

  test("selects native resources and null costs identically while pinning the new benchmark", () => {
    const snapshot = derivedSnapshot();
    expect(snapshot.benchmark.version).toBe("4.3");
    expect(snapshot.benchmark.evaluationCount).toBe(10);
    expect(snapshot.records).toEqual(current.records);
    expect(snapshot.selection.positiveCostRecordCount).toBe(current.selection.positiveCostRecordCount);
  });

  test("refreshes the new snapshot and preserves observation retrieval time on unchanged reads", async () => {
    const previous = derivedSnapshot();
    const writes: ArtificialAnalysisIntelligenceV43Snapshot[] = [];
    const result = await refreshArtificialAnalysisIntelligenceV43({
      fetchPage: async () => ok(sourcePage()),
      fetchManifest: async () => ok(await encryptPayload(sourcePayload())),
      now: () => new Date(Date.parse(previous.source.retrievedAt) + 60_000).toISOString(),
      readCommittedSnapshot: async () => ok(previous),
      writeCommittedSnapshot: async snapshot => { writes.push(snapshot); },
    });
    expect(result.ok).toBeTrue();
    expect(writes).toEqual([previous]);
  });

  test("does not write when source version, published scores, or retrieval time drift", async () => {
    const previous = derivedSnapshot();
    for (const failure of ["version", "scores", "time", "fetch"] as const) {
      let writes = 0;
      const payload = sourcePayload();
      const html = sourcePage(payload, failure === "version" ? "4.4" : "4.3");
      if (failure === "scores") payload.models[0]!.intelligenceIndex = 1;
      const result = await refreshArtificialAnalysisIntelligenceV43({
        fetchPage: async () => failure === "fetch" ? err(new Error("Unavailable")) : ok(html),
        fetchManifest: async () => ok(await encryptPayload(payload)),
        now: () => failure === "time" ? "2020-01-01T00:00:00.000Z" : previous.source.retrievedAt,
        readCommittedSnapshot: async () => ok(previous),
        writeCommittedSnapshot: async () => { writes += 1; },
      });
      expect(result.ok).toBeFalse();
      expect(writes).toBe(0);
    }
  });

  test("returns an explicit failure if atomic writing fails", async () => {
    const result = await refreshArtificialAnalysisIntelligenceV43({
      fetchPage: async () => ok(sourcePage()),
      fetchManifest: async () => ok(await encryptPayload(sourcePayload())),
      now: () => current.source.retrievedAt,
      readCommittedSnapshot: async () => ok(null),
      writeCommittedSnapshot: async () => { throw new Error("Disk unavailable"); },
    });
    expect(result.ok).toBeFalse();
    if (!result.ok) expect(result.error.message).toContain("atomically write");
  });
});
