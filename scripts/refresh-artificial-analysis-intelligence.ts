import { rename } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { isCredentialFreeHttpsUrl } from "../lib/credential-free-https-url";
import { isIsoCalendarDate } from "../lib/iso-calendar-date";
import {
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_CITATION,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_EVALUATIONS,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_METHODOLOGY_URL,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_SCORE_MAX,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_SCORE_MIN,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_SELECTION_RULE,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_VERSION,
  ARTIFICIAL_ANALYSIS_TERMS_URL,
  compareArtificialAnalysisIntelligenceRecords,
  parseArtificialAnalysisIntelligenceSnapshot,
  validateArtificialAnalysisIntelligenceReplacement,
  type ArtificialAnalysisIntelligenceRecord,
  type ArtificialAnalysisIntelligenceSnapshot,
} from "../lib/artificial-analysis-intelligence-data";
import { err, isRecord, ok, type Result } from "../lib/result";
import { parseResult, z } from "../lib/schema";

const OUTPUT_PATH = path.join(
  import.meta.dir,
  "..",
  "data",
  "artificial-analysis-intelligence.json",
);
const FLIGHT_PREFIX = "self.__next_f.push(";
const USER_AGENT = "aicharts-aa-intelligence-refresh/1.0 (+https://aicharts.io)";
const ARTIFICIAL_ANALYSIS_ORIGIN = "https://artificialanalysis.ai";
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MAX_ENCRYPTED_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_DECOMPRESSED_MANIFEST_BYTES = 64 * 1024 * 1024;
const sourceIntelligenceIndexSchema = z.number().finite()
  .min(ARTIFICIAL_ANALYSIS_INTELLIGENCE_SCORE_MIN)
  .max(ARTIFICIAL_ANALYSIS_INTELLIGENCE_SCORE_MAX)
  .nullable()
  .optional();
const sourceNonnegativeMetricSchema = z.number().finite().nonnegative().nullable().optional();
const semanticSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const sourceSlugSchema = z.string().min(1);

const sourceOutputTokensSchema = z.object({
  answer: sourceNonnegativeMetricSchema,
  output: sourceNonnegativeMetricSchema,
  reasoning: sourceNonnegativeMetricSchema,
});

const sourceCostSchema = z.object({
  answer: sourceNonnegativeMetricSchema,
  cacheRead: sourceNonnegativeMetricSchema,
  cacheWrite: sourceNonnegativeMetricSchema,
  input: sourceNonnegativeMetricSchema,
  nonCacheInput: sourceNonnegativeMetricSchema,
  output: sourceNonnegativeMetricSchema,
  reasoning: sourceNonnegativeMetricSchema,
  total: sourceNonnegativeMetricSchema,
});

const sourceModelSchema = z.object({
  creator: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    slug: sourceSlugSchema,
  }),
  deprecated: z.boolean(),
  effort: z.object({
    label: z.string().min(1),
    level: z.number().int().nonnegative(),
    slug: sourceSlugSchema,
  }).nullable().optional(),
  id: z.string().uuid(),
  intelligenceIndex: sourceIntelligenceIndexSchema,
  intelligenceIndexCostPerTask: z.object({ cost: sourceCostSchema }).nullable().optional(),
  intelligenceIndexIsEstimated: z.boolean(),
  intelligenceIndexOutputTokensPerTask: sourceOutputTokensSchema.nullable().optional(),
  name: z.string().min(1),
  release: z.object({
    name: z.string().min(1),
    slug: sourceSlugSchema,
  }),
  releaseDate: z.string().refine(isIsoCalendarDate),
  shortName: z.string().min(1),
  slug: sourceSlugSchema,
});

const sourceModelsPayloadSchema = z.object({
  models: z.array(sourceModelSchema).min(100),
});

const sourceDatasetSchema = z.object({
  "@context": z.literal("https://schema.org"),
  "@type": z.literal("Dataset"),
  citation: z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_CITATION),
  creator: z.object({
    "@type": z.literal("Organization"),
    name: z.literal("Artificial Analysis"),
    url: z.literal("https://artificialanalysis.ai"),
  }),
  description: z.string().min(1),
  isAccessibleForFree: z.literal(true),
  license: z.literal(ARTIFICIAL_ANALYSIS_TERMS_URL),
  name: z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME),
});

const sourceManifestSchema = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/u),
  path: z.string().regex(/^\/data\/[a-f0-9]+\.txt$/u),
}).strict();

type SourceModel = z.infer<typeof sourceModelSchema>;
type SourceModelsPayload = z.infer<typeof sourceModelsPayloadSchema>;
type SourceDataset = z.infer<typeof sourceDatasetSchema>;
type SourceManifest = z.infer<typeof sourceManifestSchema>;
type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ArtificialAnalysisIntelligencePageSource = Readonly<{
  citation: typeof ARTIFICIAL_ANALYSIS_INTELLIGENCE_CITATION;
  manifest: SourceManifest;
  termsUrl: typeof ARTIFICIAL_ANALYSIS_TERMS_URL;
}>;

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseJson(value: string, context: string): Result<unknown, Error> {
  try {
    const parsed: unknown = JSON.parse(value);
    return ok(parsed);
  } catch (cause) {
    return err(new Error(`Could not parse ${context}.`, { cause }));
  }
}

function flightPayloads(html: string): Result<string[], Error> {
  const payloads: string[] = [];
  const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gu;
  for (const match of html.matchAll(scriptPattern)) {
    const rawScript = match[1];
    if (rawScript === undefined) continue;
    const script = decodeHtmlEntities(rawScript.trim());
    if (!script.startsWith(FLIGHT_PREFIX) || !script.endsWith(")")) continue;
    const parsed = parseJson(script.slice(FLIGHT_PREFIX.length, -1), "Next.js Flight script");
    if (!parsed.ok) return parsed;
    if (!Array.isArray(parsed.value) || typeof parsed.value[1] !== "string") continue;
    payloads.push(parsed.value[1]);
  }
  return payloads.length > 0
    ? ok(payloads)
    : err(new Error("No Next.js Flight payloads were found in the Artificial Analysis page."));
}

function parseFlightRecord(payload: string): { id: string; value: unknown } | null {
  const separator = payload.indexOf(":");
  if (separator <= 0) return null;
  const id = payload.slice(0, separator);
  const body = payload.slice(separator + 1);
  if (!(body.startsWith("[") || body.startsWith("{"))) return null;
  const parsed = parseJson(body, `Flight record ${id}`);
  return parsed.ok ? { id, value: parsed.value } : null;
}

function resolveFlightReference(
  reference: string,
  records: ReadonlyMap<string, unknown>,
): Result<unknown, Error> {
  const [recordId, ...segments] = reference.slice(1).split(":");
  if (recordId === undefined || !records.has(recordId)) {
    return err(new Error(`Flight reference ${reference} targets a missing record.`));
  }
  let current: unknown = records.get(recordId);
  for (const segment of segments) {
    if (segment === "props" && Array.isArray(current)) {
      current = current[3];
    } else if (/^\d+$/u.test(segment) && Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      return err(new Error(`Flight reference ${reference} could not resolve segment ${segment}.`));
    }
    if (current === undefined) {
      return err(new Error(`Flight reference ${reference} resolved to undefined.`));
    }
  }
  return ok(current);
}

function exactFlightReference(value: string, records: ReadonlyMap<string, unknown>): boolean {
  const recordId = value.match(/^\$([a-f0-9]+)(?::|$)/iu)?.[1];
  return recordId !== undefined && records.has(recordId);
}

function findModelManifests(records: ReadonlyMap<string, unknown>): Result<SourceManifest[], Error> {
  const manifests: SourceManifest[] = [];
  const visitedObjects = new WeakSet<object>();
  const visitedReferences = new Set<string>();

  function visit(value: unknown): Result<void, Error> {
    if (typeof value === "string" && exactFlightReference(value, records)) {
      if (visitedReferences.has(value)) return ok(undefined);
      visitedReferences.add(value);
      const resolved = resolveFlightReference(value, records);
      return resolved.ok ? visit(resolved.value) : resolved;
    }
    if (typeof value !== "object" || value === null) return ok(undefined);
    if (visitedObjects.has(value)) return ok(undefined);
    visitedObjects.add(value);

    if (isRecord(value) && ("initialModels" in value || "defaultModels" in value)) {
      let manifestValue: unknown = value.manifest;
      if (typeof manifestValue === "string" && exactFlightReference(manifestValue, records)) {
        const resolved = resolveFlightReference(manifestValue, records);
        if (!resolved.ok) return resolved;
        manifestValue = resolved.value;
      }
      const manifest = parseResult(sourceManifestSchema, manifestValue);
      if (manifest.ok) manifests.push(manifest.value);
    }

    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      const visited = visit(child);
      if (!visited.ok) return visited;
    }
    return ok(undefined);
  }

  for (const value of records.values()) {
    const visited = visit(value);
    if (!visited.ok) return visited;
  }
  return ok(manifests);
}

function jsonLdValues(html: string): Result<unknown[], Error> {
  const values: unknown[] = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/giu;
  for (const match of html.matchAll(scriptPattern)) {
    const attributes = match[1] ?? "";
    if (!/\btype\s*=\s*["']application\/ld\+json["']/iu.test(attributes)) continue;
    const body = match[2]?.trim();
    if (body === undefined || body === "") continue;
    const parsed = parseJson(body, "JSON-LD dataset");
    if (!parsed.ok) return parsed;
    values.push(parsed.value);
  }
  return ok(values);
}

function datasetCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(datasetCandidates);
  if (!isRecord(value)) return [];
  const graph = Array.isArray(value["@graph"])
    ? value["@graph"].flatMap(datasetCandidates)
    : [];
  return value.name === ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME
    ? [value, ...graph]
    : graph;
}

function validateDatasetDescription(dataset: SourceDataset): Result<void, Error> {
  const expected = `${ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME} v${ARTIFICIAL_ANALYSIS_INTELLIGENCE_VERSION} incorporates ${ARTIFICIAL_ANALYSIS_INTELLIGENCE_EVALUATIONS.length} evaluations: ${ARTIFICIAL_ANALYSIS_INTELLIGENCE_EVALUATIONS.join(", ")}`;
  const canonicalDescription = dataset.description.replaceAll("𝜏", "τ");
  return canonicalDescription.startsWith(expected)
    ? ok(undefined)
    : err(new Error(
      `Artificial Analysis Intelligence dataset version or evaluation roster changed; expected description to begin ${JSON.stringify(expected)}.`,
    ));
}

export function extractArtificialAnalysisIntelligencePage(
  html: string,
): Result<ArtificialAnalysisIntelligencePageSource, Error> {
  const payloadResult = flightPayloads(html);
  if (!payloadResult.ok) return payloadResult;
  const records = new Map<string, unknown>();
  for (const payload of payloadResult.value) {
    const record = parseFlightRecord(payload);
    if (record !== null) records.set(record.id, record.value);
  }

  const manifests = findModelManifests(records);
  if (!manifests.ok) return manifests;
  const uniqueManifests = new Map(
    manifests.value.map(manifest => [JSON.stringify(manifest), manifest]),
  );
  if (uniqueManifests.size !== 1) {
    return err(new Error(
      `Expected one public Artificial Analysis language-model manifest, found ${uniqueManifests.size}.`,
    ));
  }
  const manifest = uniqueManifests.values().next().value;
  if (manifest === undefined) {
    return err(new Error("Artificial Analysis did not expose a public language-model manifest."));
  }
  const manifestUrl = new URL(manifest.path, ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL);
  if (
    !isCredentialFreeHttpsUrl(manifestUrl.href)
    || manifestUrl.hostname !== "artificialanalysis.ai"
  ) {
    return err(new Error("Artificial Analysis model manifest must stay on its credential-free HTTPS origin."));
  }

  const jsonLd = jsonLdValues(html);
  if (!jsonLd.ok) return jsonLd;
  const matchingDatasets = jsonLd.value.flatMap(datasetCandidates);
  if (matchingDatasets.length !== 1) {
    return err(new Error(
      `Expected one canonical Artificial Analysis Intelligence Index JSON-LD dataset, found ${matchingDatasets.length}.`,
    ));
  }
  const parsedDataset = parseResult(sourceDatasetSchema, matchingDatasets[0]);
  if (!parsedDataset.ok) {
    return err(new Error(
      `Artificial Analysis Intelligence JSON-LD changed shape: ${parsedDataset.error.message}`,
      { cause: parsedDataset.error },
    ));
  }
  const dataset = parsedDataset.value;
  const validDescription = validateDatasetDescription(dataset);
  if (!validDescription.ok) return validDescription;
  if (!html.includes('href="/methodology/intelligence-benchmarking"')) {
    return err(new Error("Artificial Analysis page no longer links the expected Intelligence methodology."));
  }

  return ok({
    citation: dataset.citation,
    manifest,
    termsUrl: dataset.license,
  });
}

function hexBytes(value: string): Uint8Array<ArrayBuffer> {
  const pairs = value.match(/.{2}/gu) ?? [];
  const bytes = new Uint8Array(new ArrayBuffer(pairs.length));
  pairs.forEach((pair, index) => {
    bytes[index] = Number.parseInt(pair, 16);
  });
  return bytes;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy.buffer;
}

export async function decodeArtificialAnalysisManifest(
  encrypted: Uint8Array,
  keyHex: string,
  maximumOutputBytes = MAX_DECOMPRESSED_MANIFEST_BYTES,
): Promise<Result<unknown, Error>> {
  try {
    if (!/^[a-f0-9]{64}$/u.test(keyHex)) {
      return err(new Error("Artificial Analysis manifest key is not 64 lowercase hex characters."));
    }
    const keyBytes = hexBytes(keyHex);
    if (keyBytes.length !== 32) return err(new Error("Artificial Analysis manifest key is not 256 bits."));
    const keyBuffer = keyBytes.buffer;
    const digest = await crypto.subtle.digest("SHA-256", keyBuffer);
    const iv = new Uint8Array(digest).slice(0, 12);
    const key = await crypto.subtle.importKey(
      "raw",
      keyBuffer,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const decrypted = await crypto.subtle.decrypt(
      { iv, name: "AES-GCM", tagLength: 128 },
      key,
      ownedArrayBuffer(encrypted),
    );
    const json = gunzipSync(new Uint8Array(decrypted), {
      maxOutputLength: maximumOutputBytes,
    }).toString("utf8");
    return parseJson(json, "decrypted Artificial Analysis model manifest");
  } catch (cause) {
    return err(new Error("Could not decrypt and decompress the Artificial Analysis model manifest.", {
      cause,
    }));
  }
}

export function parseArtificialAnalysisModelsPayload(
  value: unknown,
): Result<SourceModelsPayload, Error> {
  const parsed = parseResult(sourceModelsPayloadSchema, value);
  return parsed.ok
    ? ok(parsed.value)
    : err(new Error(`Artificial Analysis model payload changed shape: ${parsed.error.message}`, {
      cause: parsed.error,
    }));
}

function completeOutputTokens(
  value: SourceModel["intelligenceIndexOutputTokensPerTask"],
): value is { answer: number; output: number; reasoning: number } {
  return value !== undefined
    && value !== null
    && typeof value.answer === "number"
    && Number.isFinite(value.answer)
    && value.answer >= 0
    && typeof value.reasoning === "number"
    && Number.isFinite(value.reasoning)
    && value.reasoning >= 0
    && typeof value.output === "number"
    && Number.isFinite(value.output)
    && value.output > 0;
}

type CompleteSourceCost = {
  answer: number;
  cacheRead: number;
  cacheWrite: number;
  input: number;
  nonCacheInput: number;
  output: number;
  reasoning: number;
  total: number;
};

function completeCost(value: SourceModel["intelligenceIndexCostPerTask"]): value is {
  cost: CompleteSourceCost;
} {
  if (value === undefined || value === null) return false;
  const metrics = [
    value.cost.answer,
    value.cost.cacheRead,
    value.cost.cacheWrite,
    value.cost.input,
    value.cost.nonCacheInput,
    value.cost.output,
    value.cost.reasoning,
    value.cost.total,
  ];
  return metrics.every(metric => (
    typeof metric === "number" && Number.isFinite(metric) && metric >= 0
  ));
}

function approximatelyEqual(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= scale * 1e-9;
}

function sourceSumsAreConsistent(model: SourceModel): boolean {
  const tokens = model.intelligenceIndexOutputTokensPerTask;
  const cost = model.intelligenceIndexCostPerTask;
  if (!completeOutputTokens(tokens) || !completeCost(cost)) return false;
  return approximatelyEqual(tokens.answer + tokens.reasoning, tokens.output)
    && approximatelyEqual(
      cost.cost.nonCacheInput + cost.cost.cacheRead + cost.cost.cacheWrite,
      cost.cost.input,
    )
    && approximatelyEqual(cost.cost.answer + cost.cost.reasoning, cost.cost.output)
    && approximatelyEqual(cost.cost.input + cost.cost.output, cost.cost.total);
}

function selectedSourceModel(model: SourceModel): boolean {
  return model.deprecated === false
    && model.intelligenceIndexIsEstimated === false
    && semanticSlugSchema.safeParse(model.slug).success
    && semanticSlugSchema.safeParse(model.creator.slug).success
    && semanticSlugSchema.safeParse(model.release.slug).success
    && (model.effort === undefined
      || model.effort === null
      || semanticSlugSchema.safeParse(model.effort.slug).success)
    && typeof model.intelligenceIndex === "number"
    && Number.isFinite(model.intelligenceIndex)
    && model.intelligenceIndex >= ARTIFICIAL_ANALYSIS_INTELLIGENCE_SCORE_MIN
    && model.intelligenceIndex <= ARTIFICIAL_ANALYSIS_INTELLIGENCE_SCORE_MAX
    && completeOutputTokens(model.intelligenceIndexOutputTokensPerTask)
    && completeCost(model.intelligenceIndexCostPerTask);
}

function normalizeCost(cost: CompleteSourceCost): ArtificialAnalysisIntelligenceRecord["costUsdPerTask"] {
  if (cost.total <= 0) return null;
  return {
    answer: cost.answer,
    cacheRead: cost.cacheRead,
    cacheWrite: cost.cacheWrite,
    input: cost.input,
    nonCacheInput: cost.nonCacheInput,
    output: cost.output,
    reasoning: cost.reasoning,
    total: cost.total,
  };
}

function normalizeModel(model: SourceModel): ArtificialAnalysisIntelligenceRecord {
  const tokens = model.intelligenceIndexOutputTokensPerTask;
  const sourceCost = model.intelligenceIndexCostPerTask;
  if (
    typeof model.intelligenceIndex !== "number"
    || !completeOutputTokens(tokens)
    || !completeCost(sourceCost)
  ) {
    throw new Error("Only measured-complete source models can be normalized.");
  }
  return {
    costUsdPerTask: normalizeCost(sourceCost.cost),
    creator: {
      id: model.creator.id,
      name: model.creator.name,
      slug: model.creator.slug,
    },
    detailsUrl: `${ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL}/${model.slug}`,
    effort: model.effort === undefined || model.effort === null
      ? null
      : {
        label: model.effort.label,
        level: model.effort.level,
        slug: model.effort.slug,
      },
    id: model.id,
    intelligenceIndex: model.intelligenceIndex,
    name: model.name,
    outputTokensPerTask: {
      answer: tokens.answer,
      reasoning: tokens.reasoning,
      total: tokens.output,
    },
    release: {
      name: model.release.name,
      slug: model.release.slug,
    },
    releaseDate: model.releaseDate,
    shortName: model.shortName,
    slug: model.slug,
  };
}

export function deriveArtificialAnalysisIntelligenceSnapshot(
  payload: SourceModelsPayload,
  page: ArtificialAnalysisIntelligencePageSource,
  retrievedAt: string,
): Result<ArtificialAnalysisIntelligenceSnapshot, Error> {
  const selected = payload.models.filter(selectedSourceModel);
  const inconsistent = selected.find(model => !sourceSumsAreConsistent(model));
  if (inconsistent !== undefined) {
    return err(new Error(
      `Artificial Analysis model ${inconsistent.slug} has inconsistent token or cost component totals.`,
    ));
  }
  const records = selected.map(normalizeModel).sort(compareArtificialAnalysisIntelligenceRecords);
  const candidate: ArtificialAnalysisIntelligenceSnapshot = {
    benchmark: {
      categoryWeightsPercent: {
        agents: 34,
        coding: 24,
        general: 18,
        scientific: 24,
      },
      evaluationCount: 9,
      evaluations: [...ARTIFICIAL_ANALYSIS_INTELLIGENCE_EVALUATIONS],
      name: ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME,
      score: "intelligence-index",
      scoreUnit: "index-points",
      version: ARTIFICIAL_ANALYSIS_INTELLIGENCE_VERSION,
    },
    records,
    schemaVersion: 1,
    selection: {
      measuredCompleteRecordCount: records.length,
      positiveCostRecordCount: records.filter(record => record.costUsdPerTask !== null).length,
      rule: ARTIFICIAL_ANALYSIS_INTELLIGENCE_SELECTION_RULE,
      sourceRecordCount: payload.models.length,
    },
    source: {
      citation: page.citation,
      method: "public-next-flight",
      methodologyUrl: ARTIFICIAL_ANALYSIS_INTELLIGENCE_METHODOLOGY_URL,
      name: "Artificial Analysis",
      retrievedAt,
      sourceClass: "benchmark-publisher",
      termsUrl: page.termsUrl,
      url: ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL,
    },
  };
  const parsed = parseArtificialAnalysisIntelligenceSnapshot(candidate);
  return parsed.ok
    ? ok(parsed.value)
    : err(new Error(`Normalized Artificial Analysis snapshot is invalid: ${parsed.error.message}`, {
      cause: parsed.error,
    }));
}

function isArtificialAnalysisSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return isCredentialFreeHttpsUrl(url.href) && url.origin === ARTIFICIAL_ANALYSIS_ORIGIN;
  } catch {
    return false;
  }
}

async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
  context: string,
): Promise<Result<Uint8Array, Error>> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/u.test(declaredLength)) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > maximumBytes) {
      return err(new Error(
        `${context} declared ${declaredLength} bytes; maximum allowed is ${maximumBytes}.`,
      ));
    }
  }
  if (response.body === null) return err(new Error(`${context} returned an empty body.`));

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel("Artificial Analysis response exceeded its byte limit.");
        return err(new Error(`${context} exceeded the ${maximumBytes}-byte limit.`));
      }
      chunks.push(chunk.value);
    }
  } catch (cause) {
    return err(new Error(`Could not read ${context}.`, { cause }));
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return ok(body);
}

export async function fetchArtificialAnalysisSourceBytes(
  url: string,
  accept: string,
  maximumBytes: number,
  fetchImplementation: FetchImplementation = fetch,
): Promise<Result<Uint8Array, Error>> {
  if (!isArtificialAnalysisSourceUrl(url)) {
    return err(new Error(
      `Artificial Analysis source URL must stay on ${ARTIFICIAL_ANALYSIS_ORIGIN}.`,
    ));
  }
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImplementation(url, {
        headers: { accept, "user-agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status} for ${url}.`);
      if (!isArtificialAnalysisSourceUrl(response.url)) {
        return err(new Error(
          `Artificial Analysis response redirected off its allowed origin to ${response.url || "an unknown URL"}.`,
        ));
      }
      const body = await readBoundedResponseBody(
        response,
        maximumBytes,
        `Artificial Analysis response from ${url}`,
      );
      if (body.ok) return body;
      return body;
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause));
    }
    if (attempt < 3) await Bun.sleep(250 * 2 ** (attempt - 1));
  }
  return err(new Error(`Could not download ${url} after 3 attempts.`, { cause: lastError }));
}

async function fetchPage(): Promise<Result<string, Error>> {
  const response = await fetchArtificialAnalysisSourceBytes(
    ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL,
    "text/html,application/xhtml+xml",
    MAX_PAGE_BYTES,
  );
  if (!response.ok) return response;
  try {
    return ok(new TextDecoder("utf-8", { fatal: true }).decode(response.value));
  } catch (cause) {
    return err(new Error("Could not read the Artificial Analysis models page.", { cause }));
  }
}

async function fetchManifest(url: string): Promise<Result<Uint8Array, Error>> {
  return fetchArtificialAnalysisSourceBytes(
    url,
    "text/plain",
    MAX_ENCRYPTED_MANIFEST_BYTES,
  );
}

async function readCommittedSnapshot(
  allowMissing = false,
): Promise<Result<ArtificialAnalysisIntelligenceSnapshot | null, Error>> {
  try {
    const input: unknown = await Bun.file(OUTPUT_PATH).json();
    const parsed = parseArtificialAnalysisIntelligenceSnapshot(input);
    return parsed.ok
      ? ok(parsed.value)
      : err(new Error(`Invalid ${OUTPUT_PATH}: ${parsed.error.message}`, { cause: parsed.error }));
  } catch (cause) {
    if (allowMissing && isRecord(cause) && cause.code === "ENOENT") return ok(null);
    return err(new Error(`Could not read ${OUTPUT_PATH}.`, { cause }));
  }
}

async function writeCommittedSnapshot(
  snapshot: ArtificialAnalysisIntelligenceSnapshot,
): Promise<void> {
  const temporaryPath = `${OUTPUT_PATH}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  await rename(temporaryPath, OUTPUT_PATH);
}

type RefreshDependencies = Readonly<{
  fetchManifest: typeof fetchManifest;
  fetchPage: typeof fetchPage;
  now: () => string;
  readCommittedSnapshot: () => Promise<Result<ArtificialAnalysisIntelligenceSnapshot | null, Error>>;
  writeCommittedSnapshot: typeof writeCommittedSnapshot;
}>;

const defaultRefreshDependencies: RefreshDependencies = {
  fetchManifest,
  fetchPage,
  now: () => new Date().toISOString(),
  readCommittedSnapshot: () => readCommittedSnapshot(true),
  writeCommittedSnapshot,
};

function preserveRetrievalTimeWhenUnchanged(
  previous: ArtificialAnalysisIntelligenceSnapshot,
  candidate: ArtificialAnalysisIntelligenceSnapshot,
): ArtificialAnalysisIntelligenceSnapshot {
  const atPreviousTime: ArtificialAnalysisIntelligenceSnapshot = {
    ...candidate,
    source: { ...candidate.source, retrievedAt: previous.source.retrievedAt },
  };
  return JSON.stringify(previous) === JSON.stringify(atPreviousTime) ? previous : candidate;
}

export async function validateCommittedArtificialAnalysisIntelligence(): Promise<
  Result<ArtificialAnalysisIntelligenceSnapshot, Error>
> {
  const result = await readCommittedSnapshot(false);
  if (!result.ok) return result;
  return result.value === null
    ? err(new Error(`Could not read ${OUTPUT_PATH}.`))
    : ok(result.value);
}

export async function refreshArtificialAnalysisIntelligence(
  overrides: Partial<RefreshDependencies> = {},
): Promise<Result<ArtificialAnalysisIntelligenceSnapshot, Error>> {
  const dependencies = { ...defaultRefreshDependencies, ...overrides };
  const previous = await dependencies.readCommittedSnapshot();
  if (!previous.ok) return previous;

  const html = await dependencies.fetchPage();
  if (!html.ok) return html;
  const page = extractArtificialAnalysisIntelligencePage(html.value);
  if (!page.ok) return page;
  const manifestUrl = new URL(
    page.value.manifest.path,
    ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL,
  ).href;
  const encrypted = await dependencies.fetchManifest(manifestUrl);
  if (!encrypted.ok) return encrypted;
  const decoded = await decodeArtificialAnalysisManifest(
    encrypted.value,
    page.value.manifest.key,
  );
  if (!decoded.ok) return decoded;
  const payload = parseArtificialAnalysisModelsPayload(decoded.value);
  if (!payload.ok) return payload;
  const derived = deriveArtificialAnalysisIntelligenceSnapshot(
    payload.value,
    page.value,
    dependencies.now(),
  );
  if (!derived.ok) return derived;

  const candidate = previous.value === null
    ? derived.value
    : preserveRetrievalTimeWhenUnchanged(previous.value, derived.value);
  if (previous.value !== null) {
    const safe = validateArtificialAnalysisIntelligenceReplacement(previous.value, candidate);
    if (!safe.ok) return safe;
  }
  await dependencies.writeCommittedSnapshot(candidate);
  return ok(candidate);
}

if (import.meta.main) {
  const checkOnly = Bun.argv.includes("--check");
  const result = checkOnly
    ? await validateCommittedArtificialAnalysisIntelligence()
    : await refreshArtificialAnalysisIntelligence();
  if (!result.ok) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    const verb = checkOnly ? "Validated" : "Refreshed";
    console.log(
      `${verb} ${result.value.records.length} Artificial Analysis Intelligence Index ${result.value.benchmark.version} configurations in data/artificial-analysis-intelligence.json.`,
    );
  }
}
