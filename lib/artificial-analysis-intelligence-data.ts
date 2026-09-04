import { credentialFreeHttpsUrlSchema } from "./credential-free-https-url";
import { isIsoCalendarDate } from "./iso-calendar-date";
import type { Result } from "./result";
import { err, ok } from "./result";
import { parseResult, z } from "./schema";

export const ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL =
  "https://artificialanalysis.ai/models" as const;
export const ARTIFICIAL_ANALYSIS_INTELLIGENCE_METHODOLOGY_URL =
  "https://artificialanalysis.ai/methodology/intelligence-benchmarking" as const;
export const ARTIFICIAL_ANALYSIS_TERMS_URL =
  "https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf" as const;
export const ARTIFICIAL_ANALYSIS_INTELLIGENCE_CITATION =
  "Artificial Analysis (2025). LLM benchmarks dataset. https://artificialanalysis.ai" as const;
export const ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME =
  "Artificial Analysis Intelligence Index" as const;
export const ARTIFICIAL_ANALYSIS_INTELLIGENCE_VERSION = "4.1.1" as const;
export const ARTIFICIAL_ANALYSIS_INTELLIGENCE_SCORE_MIN = 0 as const;
export const ARTIFICIAL_ANALYSIS_INTELLIGENCE_SCORE_MAX = 100 as const;

export const ARTIFICIAL_ANALYSIS_INTELLIGENCE_EVALUATIONS = [
  "GDPval-AA v2",
  "τ³-Banking",
  "Terminal-Bench v2.1",
  "SciCode",
  "Humanity's Last Exam",
  "GPQA Diamond",
  "CritPt",
  "AA-Omniscience",
  "AA-LCR",
] as const;

export const ARTIFICIAL_ANALYSIS_INTELLIGENCE_SELECTION_RULE =
  "current, non-estimated model configurations with a finite 0–100 Intelligence Index, finite positive per-task output-token total, and a complete finite nonnegative per-task cost breakdown; source cost totals at or below zero normalize to null" as const;

const minimumSourceRecordCount = 100;
const minimumMeasuredCompleteRecordCount = 50;
const minimumPositiveCostRecordCount = 40;
const minimumRetentionRatio = 0.8;
const semanticSlugSchema = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  "Slug must contain lowercase ASCII words separated by single hyphens.",
);
const isoCalendarDateSchema = z.string().refine(
  isIsoCalendarDate,
  "Release date must be a valid ISO calendar date.",
);
const nonnegativeFiniteSchema = z.number().finite().nonnegative();
const intelligenceIndexSchema = z.number().finite()
  .min(ARTIFICIAL_ANALYSIS_INTELLIGENCE_SCORE_MIN)
  .max(ARTIFICIAL_ANALYSIS_INTELLIGENCE_SCORE_MAX);

const creatorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: semanticSlugSchema,
}).strict();

const releaseSchema = z.object({
  name: z.string().min(1),
  slug: semanticSlugSchema,
}).strict();

const outputTokensPerTaskSchema = z.object({
  answer: nonnegativeFiniteSchema,
  reasoning: nonnegativeFiniteSchema,
  total: z.number().finite().positive(),
}).strict();

const costUsdPerTaskSchema = z.object({
  answer: nonnegativeFiniteSchema,
  cacheRead: nonnegativeFiniteSchema,
  cacheWrite: nonnegativeFiniteSchema,
  input: nonnegativeFiniteSchema,
  nonCacheInput: nonnegativeFiniteSchema,
  output: nonnegativeFiniteSchema,
  reasoning: nonnegativeFiniteSchema,
  total: z.number().finite().positive(),
}).strict();

export const artificialAnalysisIntelligenceRecordSchema = z.object({
  costUsdPerTask: costUsdPerTaskSchema.nullable(),
  creator: creatorSchema,
  detailsUrl: credentialFreeHttpsUrlSchema,
  effort: z.object({
    label: z.string().min(1),
    level: z.number().int().nonnegative(),
    slug: semanticSlugSchema,
  }).strict().nullable(),
  id: z.string().uuid(),
  intelligenceIndex: intelligenceIndexSchema,
  name: z.string().min(1),
  outputTokensPerTask: outputTokensPerTaskSchema,
  release: releaseSchema,
  releaseDate: isoCalendarDateSchema,
  shortName: z.string().min(1),
  slug: semanticSlugSchema,
}).strict().superRefine((record, context) => {
  if (!approximatelyEqual(
    record.outputTokensPerTask.answer + record.outputTokensPerTask.reasoning,
    record.outputTokensPerTask.total,
  )) {
    context.addIssue({
      code: "custom",
      message: "Output-token answer and reasoning components must sum to total.",
      path: ["outputTokensPerTask", "total"],
    });
  }

  const cost = record.costUsdPerTask;
  if (cost === null) return;
  if (!approximatelyEqual(
    cost.nonCacheInput + cost.cacheRead + cost.cacheWrite,
    cost.input,
  )) {
    context.addIssue({
      code: "custom",
      message: "Cost input components must sum to input cost.",
      path: ["costUsdPerTask", "input"],
    });
  }
  if (!approximatelyEqual(cost.answer + cost.reasoning, cost.output)) {
    context.addIssue({
      code: "custom",
      message: "Cost answer and reasoning components must sum to output cost.",
      path: ["costUsdPerTask", "output"],
    });
  }
  if (!approximatelyEqual(cost.input + cost.output, cost.total)) {
    context.addIssue({
      code: "custom",
      message: "Input and output costs must sum to total cost.",
      path: ["costUsdPerTask", "total"],
    });
  }
});

const evaluationNamesSchema = z.tuple([
  z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_EVALUATIONS[0]),
  z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_EVALUATIONS[1]),
  z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_EVALUATIONS[2]),
  z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_EVALUATIONS[3]),
  z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_EVALUATIONS[4]),
  z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_EVALUATIONS[5]),
  z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_EVALUATIONS[6]),
  z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_EVALUATIONS[7]),
  z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_EVALUATIONS[8]),
]);

export const artificialAnalysisIntelligenceSnapshotSchema = z.object({
  benchmark: z.object({
    categoryWeightsPercent: z.object({
      agents: z.literal(34),
      coding: z.literal(24),
      general: z.literal(18),
      scientific: z.literal(24),
    }).strict(),
    evaluationCount: z.literal(9),
    evaluations: evaluationNamesSchema,
    name: z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_NAME),
    score: z.literal("intelligence-index"),
    scoreUnit: z.literal("index-points"),
    version: z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_VERSION),
  }).strict(),
  records: z.array(artificialAnalysisIntelligenceRecordSchema)
    .min(minimumMeasuredCompleteRecordCount),
  schemaVersion: z.literal(1),
  selection: z.object({
    measuredCompleteRecordCount: z.number().int().min(minimumMeasuredCompleteRecordCount),
    positiveCostRecordCount: z.number().int().min(minimumPositiveCostRecordCount),
    rule: z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_SELECTION_RULE),
    sourceRecordCount: z.number().int().min(minimumSourceRecordCount),
  }).strict(),
  source: z.object({
    citation: z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_CITATION),
    method: z.literal("public-next-flight"),
    methodologyUrl: z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_METHODOLOGY_URL),
    name: z.literal("Artificial Analysis"),
    retrievedAt: z.string().datetime({ offset: true }),
    sourceClass: z.literal("benchmark-publisher"),
    termsUrl: z.literal(ARTIFICIAL_ANALYSIS_TERMS_URL),
    url: z.literal(ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL),
  }).strict(),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.selection.measuredCompleteRecordCount !== snapshot.records.length) {
    context.addIssue({
      code: "custom",
      message: "Measured-complete record count must equal the retained record count.",
      path: ["selection", "measuredCompleteRecordCount"],
    });
  }
  if (snapshot.selection.sourceRecordCount < snapshot.records.length) {
    context.addIssue({
      code: "custom",
      message: "Source record count cannot be smaller than the retained record count.",
      path: ["selection", "sourceRecordCount"],
    });
  }
  const positiveCostRecordCount = snapshot.records.filter(
    record => record.costUsdPerTask !== null,
  ).length;
  if (snapshot.selection.positiveCostRecordCount !== positiveCostRecordCount) {
    context.addIssue({
      code: "custom",
      message: "Positive-cost record count must match records with a usable cost total.",
      path: ["selection", "positiveCostRecordCount"],
    });
  }

  const ids = new Set<string>();
  const slugs = new Set<string>();
  snapshot.records.forEach((record, index) => {
    if (ids.has(record.id)) {
      context.addIssue({
        code: "custom",
        message: `Artificial Analysis snapshot contains duplicate record id ${record.id}.`,
        path: ["records", index, "id"],
      });
    }
    if (slugs.has(record.slug)) {
      context.addIssue({
        code: "custom",
        message: `Artificial Analysis snapshot contains duplicate semantic slug ${record.slug}.`,
        path: ["records", index, "slug"],
      });
    }
    if (record.detailsUrl !== `${ARTIFICIAL_ANALYSIS_INTELLIGENCE_SOURCE_URL}/${record.slug}`) {
      context.addIssue({
        code: "custom",
        message: "Artificial Analysis record URL must match its canonical model slug.",
        path: ["records", index, "detailsUrl"],
      });
    }
    ids.add(record.id);
    slugs.add(record.slug);
  });

  const sorted = [...snapshot.records].sort(compareArtificialAnalysisIntelligenceRecords);
  snapshot.records.forEach((record, index) => {
    if (record.id !== sorted[index]?.id) {
      context.addIssue({
        code: "custom",
        message: "Artificial Analysis Intelligence records must be sorted by index, name, and id.",
        path: ["records", index],
      });
    }
  });
});

export type ArtificialAnalysisIntelligenceRecord = z.infer<
  typeof artificialAnalysisIntelligenceRecordSchema
>;
export type ArtificialAnalysisIntelligenceSnapshot = z.infer<
  typeof artificialAnalysisIntelligenceSnapshotSchema
>;

function approximatelyEqual(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= scale * 1e-9;
}

export function compareArtificialAnalysisIntelligenceRecords(
  left: ArtificialAnalysisIntelligenceRecord,
  right: ArtificialAnalysisIntelligenceRecord,
): number {
  return right.intelligenceIndex - left.intelligenceIndex
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id);
}

export function parseArtificialAnalysisIntelligenceSnapshot(
  value: unknown,
): Result<ArtificialAnalysisIntelligenceSnapshot, z.ZodError> {
  return parseResult(artificialAnalysisIntelligenceSnapshotSchema, value);
}

function minimumRetained(count: number): number {
  return Math.ceil(count * minimumRetentionRatio);
}

export function validateArtificialAnalysisIntelligenceReplacement(
  previous: ArtificialAnalysisIntelligenceSnapshot,
  candidate: ArtificialAnalysisIntelligenceSnapshot,
): Result<void, Error> {
  if (Date.parse(candidate.source.retrievedAt) < Date.parse(previous.source.retrievedAt)) {
    return err(new Error(
      `Artificial Analysis retrieval time regressed from ${previous.source.retrievedAt} to ${candidate.source.retrievedAt}.`,
    ));
  }

  const guardedCounts = [
    ["source records", previous.selection.sourceRecordCount, candidate.selection.sourceRecordCount],
    ["measured-complete records", previous.records.length, candidate.records.length],
    [
      "positive-cost records",
      previous.selection.positiveCostRecordCount,
      candidate.selection.positiveCostRecordCount,
    ],
  ] as const;
  for (const [label, previousCount, candidateCount] of guardedCounts) {
    const minimum = minimumRetained(previousCount);
    if (candidateCount < minimum) {
      return err(new Error(
        `Artificial Analysis refresh reduced ${label} from ${previousCount} to ${candidateCount}; minimum safe count is ${minimum}.`,
      ));
    }
  }

  const previousIds = new Set(previous.records.map(record => record.id));
  const previousSlugs = new Set(previous.records.map(record => record.slug));
  const retainedIds = candidate.records.filter(record => previousIds.has(record.id)).length;
  const retainedSlugs = candidate.records.filter(record => previousSlugs.has(record.slug)).length;
  const minimumStableOverlap = minimumRetained(previous.records.length);
  if (retainedIds < minimumStableOverlap) {
    return err(new Error(
      `Artificial Analysis refresh retained ${retainedIds} of ${previous.records.length} stable ids; minimum safe overlap is ${minimumStableOverlap}.`,
    ));
  }
  if (retainedSlugs < minimumStableOverlap) {
    return err(new Error(
      `Artificial Analysis refresh retained ${retainedSlugs} of ${previous.records.length} semantic slugs; minimum safe overlap is ${minimumStableOverlap}.`,
    ));
  }

  return ok(undefined);
}
