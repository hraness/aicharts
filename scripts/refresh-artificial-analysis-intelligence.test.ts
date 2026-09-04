import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";

import { ok } from "../lib/result";
import {
  parseArtificialAnalysisIntelligenceSnapshot,
  type ArtificialAnalysisIntelligenceSnapshot,
} from "../lib/artificial-analysis-intelligence-data";
import {
  decodeArtificialAnalysisManifest,
  deriveArtificialAnalysisIntelligenceSnapshot,
  extractArtificialAnalysisIntelligencePage,
  fetchArtificialAnalysisSourceBytes,
  parseArtificialAnalysisModelsPayload,
  refreshArtificialAnalysisIntelligence,
} from "./refresh-artificial-analysis-intelligence";

const manifestKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const manifestPath = "/data/0123456789abcdef.txt";
const creatorId = "11111111-1111-4111-8111-111111111111";

function flightScript(payload: string): string {
  return `<script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`;
}

function sourcePage(version = "4.1.1"): string {
  const description = `Artificial Analysis Intelligence Index v${version} incorporates 9 evaluations: GDPval-AA v2, 𝜏³-Banking, Terminal-Bench v2.1, SciCode, Humanity's Last Exam, GPQA Diamond, CritPt, AA-Omniscience, AA-LCR · Evaluation results measured independently by Artificial Analysis`;
  const dataset = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    citation: "Artificial Analysis (2025). LLM benchmarks dataset. https://artificialanalysis.ai",
    creator: {
      "@type": "Organization",
      name: "Artificial Analysis",
      url: "https://artificialanalysis.ai",
    },
    description,
    isAccessibleForFree: true,
    license: "https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf",
    name: "Artificial Analysis Intelligence Index",
  };
  return [
    '<a href="/methodology/intelligence-benchmarking">Methodology</a>',
    flightScript('1:["$","div",null,{"initialModels":[],"manifest":"$2"}]'),
    flightScript(`2:${JSON.stringify({ key: manifestKey, path: manifestPath })}`),
    `<script type="application/ld+json">${JSON.stringify(dataset)}</script>`,
  ].join("");
}

function modelId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function sourceModel(index: number): Record<string, unknown> {
  return {
    creator: { id: creatorId, name: "Example Lab", slug: "example-lab" },
    deprecated: false,
    effort: index % 2 === 0 ? { label: "max", level: 60, slug: "max" } : null,
    id: modelId(index),
    intelligenceIndex: 70 - index / 10,
    intelligenceIndexCostPerTask: {
      cost: {
        answer: 0.15,
        cacheRead: 0.2,
        cacheWrite: 0.3,
        input: 0.6,
        nonCacheInput: 0.1,
        output: 0.4,
        reasoning: 0.25,
        total: 1,
      },
    },
    intelligenceIndexIsEstimated: false,
    intelligenceIndexOutputTokensPerTask: { answer: 10, output: 30, reasoning: 20 },
    name: `Example Model ${index}`,
    release: { name: `Example Release ${index}`, slug: `example-release-${index}` },
    releaseDate: "2026-09-01",
    shortName: `Model ${index}`,
    slug: `example-model-${index}`,
  };
}

function sourcePayload(): { models: Array<Record<string, unknown>> } {
  const models = Array.from({ length: 100 }, (_, index) => sourceModel(index));
  for (let index = 55; index < 66; index += 1) models[index]!.deprecated = true;
  for (let index = 66; index < 77; index += 1) {
    models[index]!.intelligenceIndexIsEstimated = true;
  }
  for (let index = 77; index < 88; index += 1) {
    models[index]!.intelligenceIndexOutputTokensPerTask = null;
  }
  for (let index = 88; index < 100; index += 1) {
    models[index]!.intelligenceIndexCostPerTask = null;
  }
  const zeroCost = ((models[0]!.intelligenceIndexCostPerTask as {
    cost: Record<string, number>;
  }).cost);
  Object.keys(zeroCost).forEach(key => { zeroCost[key] = 0; });
  return { models };
}

async function encryptPayload(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const keyBytes = new Uint8Array(new ArrayBuffer(32));
  (manifestKey.match(/.{2}/gu) ?? []).forEach((pair, index) => {
    keyBytes[index] = Number.parseInt(pair, 16);
  });
  const digest = await crypto.subtle.digest("SHA-256", keyBytes.buffer);
  const iv = new Uint8Array(digest).slice(0, 12);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const compressed = gzipSync(JSON.stringify(value));
  const compressedBuffer = Uint8Array.from(compressed).buffer;
  const encrypted = await crypto.subtle.encrypt(
    { iv, name: "AES-GCM", tagLength: 128 },
    key,
    compressedBuffer,
  );
  return new Uint8Array(encrypted);
}

function derivedSnapshot(): ArtificialAnalysisIntelligenceSnapshot {
  const page = extractArtificialAnalysisIntelligencePage(sourcePage());
  if (!page.ok) throw page.error;
  const payload = parseArtificialAnalysisModelsPayload(sourcePayload());
  if (!payload.ok) throw payload.error;
  const snapshot = deriveArtificialAnalysisIntelligenceSnapshot(
    payload.value,
    page.value,
    "2026-09-04T04:30:00.000Z",
  );
  if (!snapshot.ok) throw snapshot.error;
  return snapshot.value;
}

describe("Artificial Analysis Intelligence refresh", () => {
  test("extracts a referenced public model manifest and exact JSON-LD provenance", () => {
    const extracted = extractArtificialAnalysisIntelligencePage(sourcePage());

    expect(extracted).toEqual(ok({
      citation: "Artificial Analysis (2025). LLM benchmarks dataset. https://artificialanalysis.ai",
      manifest: { key: manifestKey, path: manifestPath },
      termsUrl: "https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf",
    }));
  });

  test("rejects Intelligence Index version drift", () => {
    const extracted = extractArtificialAnalysisIntelligencePage(sourcePage("4.1.2"));
    expect(extracted.ok).toBeFalse();
  });

  test("rejects duplicate named JSON-LD even when one candidate remains valid", () => {
    const duplicate = {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "Artificial Analysis Intelligence Index",
    };
    const html = sourcePage()
      + `<script type="application/ld+json">${JSON.stringify(duplicate)}</script>`;

    expect(extractArtificialAnalysisIntelligencePage(html).ok).toBeFalse();
  });

  test("rejects off-origin redirects and oversized response bodies", async () => {
    function responseAt(body: string, url: string, headers?: HeadersInit): Response {
      const response = new Response(body, { headers, status: 200 });
      Object.defineProperty(response, "url", { value: url });
      return response;
    }

    const redirected = await fetchArtificialAnalysisSourceBytes(
      "https://artificialanalysis.ai/models",
      "text/html",
      1024,
      async () => responseAt("safe-looking", "https://example.com/models"),
    );
    expect(redirected.ok).toBeFalse();

    const oversized = await fetchArtificialAnalysisSourceBytes(
      "https://artificialanalysis.ai/models",
      "text/html",
      4,
      async () => responseAt("12345", "https://artificialanalysis.ai/models"),
    );
    expect(oversized.ok).toBeFalse();

    const declaredOversizedResponse = responseAt(
      "12345",
      "https://artificialanalysis.ai/models",
      { "content-length": "5" },
    );
    const declaredOversized = await fetchArtificialAnalysisSourceBytes(
      "https://artificialanalysis.ai/models",
      "text/html",
      4,
      async () => declaredOversizedResponse,
    );
    expect(declaredOversized.ok).toBeFalse();
    expect(declaredOversizedResponse.bodyUsed).toBeFalse();
  });

  test("rejects source Intelligence Index scores outside the published 0–100 scale", () => {
    const aboveScale = sourcePayload();
    aboveScale.models[0]!.intelligenceIndex = 100.000_001;
    expect(parseArtificialAnalysisModelsPayload(aboveScale).ok).toBeFalse();

    const extreme = sourcePayload();
    extreme.models[0]!.intelligenceIndex = Number.MAX_VALUE;
    expect(parseArtificialAnalysisModelsPayload(extreme).ok).toBeFalse();
  });

  test("decrypts the public AES-GCM plus gzip manifest format", async () => {
    const encrypted = await encryptPayload(sourcePayload());
    const decrypted = await decodeArtificialAnalysisManifest(encrypted, manifestKey);
    if (!decrypted.ok) throw decrypted.error;
    const parsed = parseArtificialAnalysisModelsPayload(decrypted.value);

    expect(parsed.ok).toBeTrue();
    if (parsed.ok) expect(parsed.value.models).toHaveLength(100);
  });

  test("bounds decompressed manifest output", async () => {
    const encrypted = await encryptPayload(sourcePayload());
    const decrypted = await decodeArtificialAnalysisManifest(encrypted, manifestKey, 32);

    expect(decrypted.ok).toBeFalse();
  });

  test("excludes deprecated, estimated, token-incomplete, and cost-incomplete rows", () => {
    const snapshot = derivedSnapshot();

    expect(snapshot.records).toHaveLength(55);
    expect(snapshot.selection).toMatchObject({
      measuredCompleteRecordCount: 55,
      positiveCostRecordCount: 54,
      sourceRecordCount: 100,
    });
    expect(snapshot.records.find(record => record.slug === "example-model-0")?.costUsdPerTask)
      .toBeNull();
  });

  test("rejects inconsistent component sums and duplicate retained ids", () => {
    const wrongSum = sourcePayload();
    const tokens = wrongSum.models[1]!.intelligenceIndexOutputTokensPerTask as {
      output: number;
    };
    tokens.output = 31;
    const parsedWrongSum = parseArtificialAnalysisModelsPayload(wrongSum);
    if (!parsedWrongSum.ok) throw parsedWrongSum.error;
    const page = extractArtificialAnalysisIntelligencePage(sourcePage());
    if (!page.ok) throw page.error;
    expect(deriveArtificialAnalysisIntelligenceSnapshot(
      parsedWrongSum.value,
      page.value,
      "2026-09-04T04:30:00.000Z",
    ).ok).toBeFalse();

    const duplicate = sourcePayload();
    duplicate.models[1]!.id = duplicate.models[0]!.id;
    const parsedDuplicate = parseArtificialAnalysisModelsPayload(duplicate);
    if (!parsedDuplicate.ok) throw parsedDuplicate.error;
    expect(deriveArtificialAnalysisIntelligenceSnapshot(
      parsedDuplicate.value,
      page.value,
      "2026-09-04T04:30:00.000Z",
    ).ok).toBeFalse();
  });

  test("preserves the prior snapshot when source extraction fails", async () => {
    const previous = derivedSnapshot();
    let writeCount = 0;
    const result = await refreshArtificialAnalysisIntelligence({
      fetchManifest: async () => { throw new Error("manifest should not be fetched"); },
      fetchPage: async () => ok("<html>missing structured data</html>"),
      now: () => "2026-09-04T05:00:00.000Z",
      readCommittedSnapshot: async () => ok(previous),
      writeCommittedSnapshot: async () => { writeCount += 1; },
    });

    expect(result.ok).toBeFalse();
    expect(writeCount).toBe(0);
    expect(parseArtificialAnalysisIntelligenceSnapshot(previous).ok).toBeTrue();
  });

  test("preserves retrieval time when the decoded source is unchanged", async () => {
    const previous = derivedSnapshot();
    const encrypted = await encryptPayload(sourcePayload());
    const writes: ArtificialAnalysisIntelligenceSnapshot[] = [];
    const result = await refreshArtificialAnalysisIntelligence({
      fetchManifest: async () => ok(encrypted),
      fetchPage: async () => ok(sourcePage()),
      now: () => "2026-09-04T05:00:00.000Z",
      readCommittedSnapshot: async () => ok(previous),
      writeCommittedSnapshot: async snapshot => { writes.push(snapshot); },
    });

    expect(result).toEqual(ok(previous));
    expect(writes).toEqual([previous]);
  });
});
