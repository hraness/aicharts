import type { Result } from "./result";
import { isRecord } from "./result";
import { parseResult, z } from "./schema";

export const MODEL_RELEASE_SOURCE_URL =
  "https://openrouter.ai/api/v1/models?sort=newest" as const;
export const MODEL_RELEASE_WINDOW_DAYS = 90 as const;
export const MODEL_RELEASE_LIMIT = 48 as const;

export const modelReleaseProviderIds = [
  "alibaba_cloud",
  "anthropic",
  "deepseek",
  "google",
  "meta",
  "moonshot_ai",
  "openai",
  "xai",
  "z_ai",
] as const;

const modelReleaseProviderIdSchema = z.enum(modelReleaseProviderIds);
const modelReleaseStatusSchema = z.enum(["awaiting-benchmark", "benchmarked"]);
const nonemptyStringsSchema = z.array(z.string().min(1));
const openRouterModelIdSchema = z.string()
  .regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u);

const openRouterModelSchema = z.object({
  architecture: z.object({
    inputModalities: nonemptyStringsSchema,
    outputModalities: nonemptyStringsSchema,
  }).strict(),
  canonicalSlug: z.string().min(1).nullable(),
  created: z.number().int().nonnegative(),
  id: z.string().min(1),
  name: z.string().min(1),
  supportedParameters: nonemptyStringsSchema,
}).strict();

const openRouterResponseSchema = z.object({
  data: z.array(openRouterModelSchema).min(1),
}).strict().superRefine((response, context) => {
  const ids = new Set<string>();
  for (const [index, model] of response.data.entries()) {
    if (ids.has(model.id)) {
      context.addIssue({
        code: "custom",
        message: `OpenRouter returned duplicate model id ${model.id}.`,
        path: ["data", index, "id"],
      });
    }
    ids.add(model.id);
  }
});

const modelReleaseSchema = z.object({
  capabilities: z.object({
    inputModalities: nonemptyStringsSchema,
    outputModalities: nonemptyStringsSchema,
    supportsTools: z.literal(true),
  }).strict(),
  canonicalSlug: openRouterModelIdSchema,
  id: openRouterModelIdSchema,
  model: z.string().min(1),
  modelUrl: z.string().url(),
  providerId: modelReleaseProviderIdSchema,
  providerName: z.string().min(1),
  sourceAddedAt: z.string().datetime({ offset: true }),
  status: modelReleaseStatusSchema,
}).strict();

const modelReleaseListingSchema = z.object({
  id: openRouterModelIdSchema,
  model: z.string().min(1),
  providerId: modelReleaseProviderIdSchema,
  sourceAddedAt: z.string().datetime({ offset: true }),
}).strict();

const modelReleaseRadarBaseSchema = z.object({
  schemaVersion: z.literal(2),
  source: z.object({
    method: z.literal("models-api"),
    name: z.literal("OpenRouter"),
    retrievedAt: z.string().datetime({ offset: true }),
    timestampMeaning: z.literal("source-added-at"),
    url: z.literal(MODEL_RELEASE_SOURCE_URL),
  }).strict(),
  policy: z.object({
    limit: z.literal(MODEL_RELEASE_LIMIT),
    providers: z.array(modelReleaseProviderIdSchema).length(modelReleaseProviderIds.length),
    publication: z.literal("discovery-only"),
    requires: z.tuple([z.literal("text-output"), z.literal("tools")]),
    windowDays: z.literal(MODEL_RELEASE_WINDOW_DAYS),
  }).strict(),
  observedListings: z.array(modelReleaseListingSchema),
  releases: z.array(modelReleaseSchema).max(MODEL_RELEASE_LIMIT),
}).strict();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || compareText(values[index - 1] ?? "", value) < 0);
}

export const modelReleaseRadarSchema = modelReleaseRadarBaseSchema.superRefine((radar, context) => {
  if (!modelReleaseProviderIds.every((providerId, index) => radar.policy.providers[index] === providerId)) {
    context.addIssue({
      code: "custom",
      message: "Release-radar providers must match the established-provider policy in canonical order.",
      path: ["policy", "providers"],
    });
  }

  const retrievedAt = Date.parse(radar.source.retrievedAt);
  const earliestAllowed = retrievedAt - MODEL_RELEASE_WINDOW_DAYS * 24 * 60 * 60 * 1_000;
  const ids = new Set<string>();
  const canonicalSlugs = new Set<string>();
  const observedListingsById = new Map<string, ModelReleaseListing>();

  radar.observedListings.forEach((listing, index) => {
    const sourceAddedAt = Date.parse(listing.sourceAddedAt);
    if (sourceAddedAt > retrievedAt) {
      context.addIssue({
        code: "custom",
        message: `Observed listing ${listing.id} is newer than its source retrieval.`,
        path: ["observedListings", index, "sourceAddedAt"],
      });
    }
    if (observedListingsById.has(listing.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate observed OpenRouter model id ${listing.id}.`,
        path: ["observedListings", index, "id"],
      });
    }
    observedListingsById.set(listing.id, listing);
    if (normalizedModelReleaseTokens(listing.providerId, listing.model).length === 0) {
      context.addIssue({
        code: "custom",
        message: `Observed listing ${listing.id} has no semantic model-name tokens.`,
        path: ["observedListings", index, "model"],
      });
    }

    const previous = radar.observedListings[index - 1];
    if (previous !== undefined) {
      const previousTime = Date.parse(previous.sourceAddedAt);
      if (
        previousTime < sourceAddedAt
        || (previousTime === sourceAddedAt && compareText(previous.id, listing.id) > 0)
      ) {
        context.addIssue({
          code: "custom",
          message: "Observed listings must be newest-first with model-id tie breaking.",
          path: ["observedListings", index],
        });
      }
    }
  });

  radar.releases.forEach((release, index) => {
    const sourceAddedAt = Date.parse(release.sourceAddedAt);
    if (sourceAddedAt < earliestAllowed || sourceAddedAt > retrievedAt) {
      context.addIssue({
        code: "custom",
        message: `Release ${release.id} falls outside the ${MODEL_RELEASE_WINDOW_DAYS}-day discovery window.`,
        path: ["releases", index, "sourceAddedAt"],
      });
    }
    if (ids.has(release.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate OpenRouter model id ${release.id}.`,
        path: ["releases", index, "id"],
      });
    }
    ids.add(release.id);
    if (canonicalSlugs.has(release.canonicalSlug)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate OpenRouter canonical slug ${release.canonicalSlug}.`,
        path: ["releases", index, "canonicalSlug"],
      });
    }
    canonicalSlugs.add(release.canonicalSlug);
    if (release.modelUrl !== `https://openrouter.ai/${release.id}`) {
      context.addIssue({
        code: "custom",
        message: `Release ${release.id} has a non-canonical model URL.`,
        path: ["releases", index, "modelUrl"],
      });
    }
    if (normalizedModelReleaseTokens(release.providerId, release.model).length === 0) {
      context.addIssue({
        code: "custom",
        message: `Release ${release.id} has no semantic model-name tokens.`,
        path: ["releases", index, "model"],
      });
    }
    const observed = observedListingsById.get(release.id);
    if (
      observed === undefined
      || observed.providerId !== release.providerId
      || observed.model !== release.model
      || observed.sourceAddedAt !== release.sourceAddedAt
    ) {
      context.addIssue({
        code: "custom",
        message: `Release ${release.id} must have an exact durable observed-listing projection.`,
        path: ["releases", index],
      });
    }
    if (!release.capabilities.outputModalities.includes("text")) {
      context.addIssue({
        code: "custom",
        message: `Release ${release.id} does not declare text output.`,
        path: ["releases", index, "capabilities", "outputModalities"],
      });
    }
    if (!isSortedUnique(release.capabilities.inputModalities)) {
      context.addIssue({
        code: "custom",
        message: `Release ${release.id} input modalities are not sorted and unique.`,
        path: ["releases", index, "capabilities", "inputModalities"],
      });
    }
    if (!isSortedUnique(release.capabilities.outputModalities)) {
      context.addIssue({
        code: "custom",
        message: `Release ${release.id} output modalities are not sorted and unique.`,
        path: ["releases", index, "capabilities", "outputModalities"],
      });
    }

    const previous = radar.releases[index - 1];
    if (previous !== undefined) {
      const previousTime = Date.parse(previous.sourceAddedAt);
      if (
        previousTime < sourceAddedAt
        || (previousTime === sourceAddedAt && compareText(previous.id, release.id) > 0)
      ) {
        context.addIssue({
          code: "custom",
          message: "Release-radar records must be newest-first with model-id tie breaking.",
          path: ["releases", index],
        });
      }
    }
  });
});

export type ModelReleaseProviderId = z.infer<typeof modelReleaseProviderIdSchema>;
export type ModelReleaseStatus = z.infer<typeof modelReleaseStatusSchema>;
export type OpenRouterModel = z.infer<typeof openRouterModelSchema>;
export type ModelRelease = z.infer<typeof modelReleaseSchema>;
export type ModelReleaseListing = z.infer<typeof modelReleaseListingSchema>;
export type ModelReleaseRadar = z.infer<typeof modelReleaseRadarBaseSchema>;

function normalizedModelReleaseTokens(providerId: string, value: string): readonly string[] {
  const canonical = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\(\s*(?:thinking|with fallback)\s*\)/gu, " ");
  const tokens = canonical.match(
    /[\p{Letter}\p{Mark}]+|\p{Number}+|\p{Symbol}+/gu,
  ) ?? [];

  if (providerId !== "anthropic") return tokens;
  const withoutAnthropic = tokens[0] === "anthropic" ? tokens.slice(1) : tokens;
  return withoutAnthropic[0] === "claude" ? withoutAnthropic.slice(1) : withoutAnthropic;
}

/** Conservatively joins provider-owned model labels across release and benchmark sources. */
export function modelReleaseSemanticKey(providerId: string, model: string): string {
  const tokens = normalizedModelReleaseTokens(providerId, model);
  if (tokens.length === 0) {
    throw new RangeError("A model-release semantic key requires at least one name token.");
  }
  return JSON.stringify([providerId, tokens]);
}

function projectOpenRouterArchitecture(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    inputModalities: value.input_modalities,
    outputModalities: value.output_modalities,
  };
}

function projectOpenRouterModel(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    architecture: projectOpenRouterArchitecture(value.architecture),
    canonicalSlug: value.canonical_slug,
    created: value.created,
    id: value.id,
    name: value.name,
    supportedParameters: value.supported_parameters,
  };
}

/** Narrows the public API to the owned fields while deliberately ignoring additive upstream fields. */
export function parseOpenRouterModelsResponse(
  value: unknown,
): Result<OpenRouterModel[], z.ZodError> {
  const projected = isRecord(value)
    ? { data: Array.isArray(value.data) ? value.data.map(projectOpenRouterModel) : value.data }
    : value;
  const parsed = parseResult(openRouterResponseSchema, projected);
  return parsed.ok ? { ok: true, value: parsed.value.data } : parsed;
}

export function parseModelReleaseRadar(
  value: unknown,
): Result<ModelReleaseRadar, z.ZodError> {
  return parseResult(modelReleaseRadarSchema, value);
}
