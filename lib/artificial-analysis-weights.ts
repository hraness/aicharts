import { ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL } from "./artificial-analysis-intelligence-data";
import { err, ok, type Result } from "./result";
import { parseResult, z } from "./schema";

export const ARTIFICIAL_ANALYSIS_WEIGHTS_SCHEMA_VERSION = 1 as const;

const slugSchema = z.string().min(1);

export const artificialAnalysisWeightRecordSchema = z.object({
  creatorSlug: slugSchema,
  deprecated: z.boolean(),
  open: z.boolean(),
  releaseSlug: slugSchema,
  slug: slugSchema,
}).strict();

export const artificialAnalysisWeightsSnapshotSchema = z.object({
  records: z.array(artificialAnalysisWeightRecordSchema).min(100),
  schemaVersion: z.literal(ARTIFICIAL_ANALYSIS_WEIGHTS_SCHEMA_VERSION),
  source: z.object({
    method: z.literal("public-next-flight"),
    name: z.literal("Artificial Analysis"),
    retrievedAt: z.string().datetime({ offset: true }),
    sourceRecordCount: z.number().int().positive(),
    url: z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL),
  }).strict(),
}).strict();

export type ArtificialAnalysisWeightRecord = z.infer<typeof artificialAnalysisWeightRecordSchema>;
export type ArtificialAnalysisWeightsSnapshot = z.infer<typeof artificialAnalysisWeightsSnapshotSchema>;

export type ArtificialAnalysisWeightSourceModel = Readonly<{
  creator: Readonly<{ slug: string }>;
  deprecated: boolean;
  isOpenWeights: boolean;
  release: Readonly<{ slug: string }>;
  slug: string;
}>;

export function deriveArtificialAnalysisWeightRecords(
  models: readonly ArtificialAnalysisWeightSourceModel[],
): ArtificialAnalysisWeightRecord[] {
  return [...models]
    .map(model => ({
      creatorSlug: model.creator.slug,
      deprecated: model.deprecated,
      open: model.isOpenWeights,
      releaseSlug: model.release.slug,
      slug: model.slug,
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug)
      || left.creatorSlug.localeCompare(right.creatorSlug)
      || left.releaseSlug.localeCompare(right.releaseSlug));
}

export function parseArtificialAnalysisWeightsSnapshot(
  value: unknown,
): Result<ArtificialAnalysisWeightsSnapshot, z.ZodError> {
  return parseResult(artificialAnalysisWeightsSnapshotSchema, value);
}

export function deriveArtificialAnalysisWeightsSnapshot(
  models: readonly ArtificialAnalysisWeightSourceModel[],
  retrievedAt: string,
): Result<ArtificialAnalysisWeightsSnapshot, Error> {
  const records = deriveArtificialAnalysisWeightRecords(models);
  const candidate = {
    records,
    schemaVersion: ARTIFICIAL_ANALYSIS_WEIGHTS_SCHEMA_VERSION,
    source: {
      method: "public-next-flight" as const,
      name: "Artificial Analysis" as const,
      retrievedAt,
      sourceRecordCount: models.length,
      url: ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL,
    },
  };
  const parsed = parseArtificialAnalysisWeightsSnapshot(candidate);
  return parsed.ok
    ? ok(parsed.value)
    : err(new Error(`Normalized Artificial Analysis weights roster is invalid: ${parsed.error.message}`, {
      cause: parsed.error,
    }));
}

export function preserveArtificialAnalysisWeightsRetrievalTime(
  previous: ArtificialAnalysisWeightsSnapshot,
  candidate: ArtificialAnalysisWeightsSnapshot,
): ArtificialAnalysisWeightsSnapshot {
  const atPreviousTime = {
    ...candidate,
    source: { ...candidate.source, retrievedAt: previous.source.retrievedAt },
  };
  return JSON.stringify(previous) === JSON.stringify(atPreviousTime) ? previous : candidate;
}

export async function commitArtificialAnalysisWeights(
  models: readonly ArtificialAnalysisWeightSourceModel[],
  retrievedAt: string,
  io: Readonly<{
    read: () => Promise<Result<ArtificialAnalysisWeightsSnapshot | null, Error>>;
    write: (snapshot: ArtificialAnalysisWeightsSnapshot) => Promise<void>;
  }>,
): Promise<Result<ArtificialAnalysisWeightsSnapshot, Error>> {
  const previous = await io.read();
  if (!previous.ok) return previous;
  const derived = deriveArtificialAnalysisWeightsSnapshot(models, retrievedAt);
  if (!derived.ok) return derived;
  const candidate = previous.value === null
    ? derived.value
    : preserveArtificialAnalysisWeightsRetrievalTime(previous.value, derived.value);
  try {
    await io.write(candidate);
  } catch (cause) {
    return err(new Error("Could not atomically write the Artificial Analysis weights roster.", { cause }));
  }
  return ok(candidate);
}
