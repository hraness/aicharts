import { rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_METHODOLOGY_URL,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_SELECTION_RULE,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL,
  validateArtificialAnalysisIntelligenceReplacement,
} from "../lib/artificial-analysis-intelligence-data";
import {
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_CATEGORY_WEIGHTS,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_VERSION,
  parseArtificialAnalysisIntelligenceV43Snapshot,
  type ArtificialAnalysisIntelligenceV43Snapshot,
} from "../lib/artificial-analysis-intelligence-v4-3-data";
import { err, isRecord, ok, type Result } from "../lib/result";
import { z } from "../lib/schema";
import {
  decodeArtificialAnalysisManifest,
  deriveArtificialAnalysisIntelligenceRecords,
  extractArtificialAnalysisIntelligencePage,
  fetchArtificialAnalysisSourceBytes,
  parseArtificialAnalysisJsonLdValues,
  parseArtificialAnalysisModelsPayload,
  type ArtificialAnalysisIntelligencePageSource,
} from "./refresh-artificial-analysis-intelligence";

const OUTPUT_PATH = path.join(import.meta.dir, "..", "data", "artificial-analysis-intelligence-v4-3.json");
export const ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_PAGE_CONTRACT = {
  version: ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_VERSION,
  evaluations: ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS,
} as const;

type ModelsPayload = Extract<ReturnType<typeof parseArtificialAnalysisModelsPayload>, { ok: true }>["value"];

const publishedScoresSchema = z.object({
  name: z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME),
  data: z.array(z.object({
    label: z.string().min(1),
    detailsUrl: z.string().regex(/^\/models\/[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    intelligenceIndex: z.number().finite().min(0).max(100),
  })).min(10).max(100),
});

/** Bind the versioned public leaderboard to the same manifest used for native resources. */
export function validateArtificialAnalysisIntelligenceV43PublishedScores(
  html: string,
  payload: ModelsPayload,
): Result<void, Error> {
  const jsonLd = parseArtificialAnalysisJsonLdValues(html);
  if (!jsonLd.ok) return jsonLd;
  const candidates = jsonLd.value.filter(value => isRecord(value) && value.name === ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME);
  if (candidates.length !== 1) return err(new Error("Expected exactly one published v4.3 score dataset."));
  const published = publishedScoresSchema.safeParse(candidates[0]);
  if (!published.success) return err(new Error("Published v4.3 score rows changed shape.", { cause: published.error }));
  const bySlug = new Map(payload.models.map(model => [model.slug, model]));
  const seen = new Set<string>();
  for (const row of published.data.data) {
    if (seen.has(row.detailsUrl)) return err(new Error("Published v4.3 score rows contain a duplicate model URL."));
    seen.add(row.detailsUrl);
    const model = bySlug.get(row.detailsUrl.slice("/models/".length));
    if (model === undefined || typeof model.intelligenceIndex !== "number"
      || Math.abs(model.intelligenceIndex - row.intelligenceIndex) > 1e-9) {
      return err(new Error(`Published v4.3 score and model manifest disagree for ${row.detailsUrl}.`));
    }
  }
  return ok(undefined);
}

export function deriveArtificialAnalysisIntelligenceV43Snapshot(
  payload: ModelsPayload,
  page: ArtificialAnalysisIntelligencePageSource,
  retrievedAt: string,
): Result<ArtificialAnalysisIntelligenceV43Snapshot, Error> {
  const derived = deriveArtificialAnalysisIntelligenceRecords(payload);
  if (!derived.ok) return derived;
  const records = derived.value;
  const candidate: ArtificialAnalysisIntelligenceV43Snapshot = {
    benchmark: {
      categoryWeightsPercent: { ...ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_CATEGORY_WEIGHTS },
      evaluationCount: 10,
      evaluations: [...ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_EVALUATIONS],
      name: ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME,
      score: "intelligence-index",
      scoreUnit: "index-points",
      version: ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_VERSION,
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
  const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(candidate);
  return parsed.ok ? ok(parsed.value)
    : err(new Error(`Normalized v4.3 Intelligence snapshot is invalid: ${parsed.error.message}`, { cause: parsed.error }));
}

async function readCommittedSnapshot(allowMissing = false): Promise<
  Result<ArtificialAnalysisIntelligenceV43Snapshot | null, Error>
> {
  try {
    const input: unknown = await Bun.file(OUTPUT_PATH).json();
    const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(input);
    return parsed.ok ? ok(parsed.value)
      : err(new Error(`Invalid ${OUTPUT_PATH}: ${parsed.error.message}`, { cause: parsed.error }));
  } catch (cause) {
    if (allowMissing && isRecord(cause) && cause.code === "ENOENT") return ok(null);
    return err(new Error(`Could not read ${OUTPUT_PATH}.`, { cause }));
  }
}

async function writeCommittedSnapshot(snapshot: ArtificialAnalysisIntelligenceV43Snapshot): Promise<void> {
  const temporaryPath = `${OUTPUT_PATH}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await Bun.write(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    await rename(temporaryPath, OUTPUT_PATH);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

type RefreshDependencies = Readonly<{
  fetchPage: () => Promise<Result<string, Error>>;
  fetchManifest: (url: string) => Promise<Result<Uint8Array, Error>>;
  now: () => string;
  readCommittedSnapshot: () => Promise<Result<ArtificialAnalysisIntelligenceV43Snapshot | null, Error>>;
  writeCommittedSnapshot: typeof writeCommittedSnapshot;
}>;

const defaultDependencies: RefreshDependencies = {
  async fetchPage() {
    const bytes = await fetchArtificialAnalysisSourceBytes(
      ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL, "text/html,application/xhtml+xml", 8 * 1024 * 1024,
    );
    if (!bytes.ok) return bytes;
    try {
      return ok(new TextDecoder("utf-8", { fatal: true }).decode(bytes.value));
    } catch (cause) {
      return err(new Error("Could not decode the v4.3 Intelligence source page.", { cause }));
    }
  },
  fetchManifest: url => fetchArtificialAnalysisSourceBytes(url, "text/plain", 32 * 1024 * 1024),
  now: () => new Date().toISOString(),
  readCommittedSnapshot: () => readCommittedSnapshot(true),
  writeCommittedSnapshot,
};

export async function refreshArtificialAnalysisIntelligenceV43(
  overrides: Partial<RefreshDependencies> = {},
): Promise<Result<ArtificialAnalysisIntelligenceV43Snapshot, Error>> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const previous = await dependencies.readCommittedSnapshot();
  if (!previous.ok) return previous;
  const html = await dependencies.fetchPage();
  if (!html.ok) return html;
  const page = extractArtificialAnalysisIntelligencePage(html.value, ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_PAGE_CONTRACT);
  if (!page.ok) return page;
  const manifest = await dependencies.fetchManifest(new URL(page.value.manifest.path, ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL).href);
  if (!manifest.ok) return manifest;
  const decoded = await decodeArtificialAnalysisManifest(manifest.value, page.value.manifest.key);
  if (!decoded.ok) return decoded;
  const payload = parseArtificialAnalysisModelsPayload(decoded.value);
  if (!payload.ok) return payload;
  const consistent = validateArtificialAnalysisIntelligenceV43PublishedScores(html.value, payload.value);
  if (!consistent.ok) return consistent;
  const derived = deriveArtificialAnalysisIntelligenceV43Snapshot(payload.value, page.value, dependencies.now());
  if (!derived.ok) return derived;
  let candidate = derived.value;
  if (previous.value !== null) {
    const safe = validateArtificialAnalysisIntelligenceReplacement(previous.value, candidate);
    if (!safe.ok) return safe;
    const atPreviousTime = { ...candidate, source: { ...candidate.source, retrievedAt: previous.value.source.retrievedAt } };
    if (JSON.stringify(previous.value) === JSON.stringify(atPreviousTime)) candidate = previous.value;
  }
  try {
    await dependencies.writeCommittedSnapshot(candidate);
  } catch (cause) {
    return err(new Error("Could not atomically write the v4.3 Intelligence snapshot.", { cause }));
  }
  return ok(candidate);
}

export async function validateCommittedArtificialAnalysisIntelligenceV43(): Promise<
  Result<ArtificialAnalysisIntelligenceV43Snapshot, Error>
> {
  const result = await readCommittedSnapshot();
  if (!result.ok) return result;
  return result.value === null ? err(new Error(`Could not read ${OUTPUT_PATH}.`)) : ok(result.value);
}

if (import.meta.main) {
  const checkOnly = Bun.argv.includes("--check");
  const result = checkOnly
    ? await validateCommittedArtificialAnalysisIntelligenceV43()
    : await refreshArtificialAnalysisIntelligenceV43();
  if (!result.ok) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    console.log(`${checkOnly ? "Validated" : "Refreshed"} ${result.value.records.length} Artificial Analysis Intelligence Index v4.3 configurations in data/artificial-analysis-intelligence-v4-3.json.`);
  }
}
