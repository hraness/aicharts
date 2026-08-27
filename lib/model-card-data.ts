import { createHash } from "node:crypto";

import modelCardCatalogData from "@/data/model-card-catalog.json";

import type { CodingAgentRecord } from "./coding-agent-data";
import {
  MODEL_CARD_FALLBACK_CREATOR_SLUG,
  MODEL_CARD_FALLBACK_PROFILE_PREFIX,
} from "./model-card-route-status";
import type { Result } from "./result";
import { parseResult, z } from "./schema";

const routeSegmentPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const canonicalModelIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const rawMachineIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const fallbackCreatorSlug = MODEL_CARD_FALLBACK_CREATOR_SLUG;
const fallbackProfilePrefix = MODEL_CARD_FALLBACK_PROFILE_PREFIX;
const fallbackModelLabelLength = 40;
const fallbackProfileLabelLength = 24;
const fallbackDigestLength = 24;

const exactNonBlankStringSchema = z.string().min(1).refine(
  value => value === value.trim(),
  "Must not have leading or trailing whitespace.",
);

export const lobeIconKeySchema = z.enum([
  "alibabacloud",
  "claude",
  "cursor",
  "deepseek",
  "gemini",
  "meta",
  "moonshot",
  "openai",
  "xai",
  "zai",
]);

export const modelCardIntrinsicClassSchema = z.enum([
  "standard",
  "fast",
  "thinking",
  "max",
  "fallback",
]);

export const modelCardEmblemRoleSchema = z.enum([
  "general",
  "speed",
  "reasoning",
  "flagship",
]);

const emblemIdentitySegmentSchema = z.string()
  .min(1)
  .max(40)
  .regex(
    routeSegmentPattern,
    "Expected a route-safe lowercase emblem identity segment.",
  );

const emblemGenerationTokenSchema = z.string()
  .min(1)
  .max(12)
  .regex(
    /^[a-z0-9]+$/u,
    "Expected a lowercase alphanumeric emblem generation token.",
  );

export const modelCardEmblemIdentitySchema = z.object({
  editionId: emblemIdentitySegmentSchema,
  familyId: emblemIdentitySegmentSchema,
  generation: z.array(emblemGenerationTokenSchema).min(1).max(4).readonly(),
  revision: emblemIdentitySegmentSchema.nullable(),
  role: modelCardEmblemRoleSchema,
}).strict().readonly();

export const canonicalModelIdSchema = z.string().regex(
  canonicalModelIdPattern,
  "Expected a creator/model identifier made from route-safe lowercase slugs.",
);

export const modelCardProfileSlugSchema = z.string().regex(
  routeSegmentPattern,
  "Expected a route-safe lowercase chart setting.",
);

export const modelCardCatalogEntrySchema = z.object({
  aliases: z.array(z.string().regex(
    rawMachineIdPattern,
    "Expected an exact raw machine identifier.",
  )).readonly(),
  canonicalModelId: canonicalModelIdSchema,
  emblemIdentity: modelCardEmblemIdentitySchema,
  gatewayModelId: canonicalModelIdSchema.nullable(),
  intrinsicClass: modelCardIntrinsicClassSchema,
  lobeIconKey: lobeIconKeySchema,
  model: exactNonBlankStringSchema,
  providerId: exactNonBlankStringSchema,
}).strict().readonly();

function catalogIdentityKey(
  identity: Pick<ModelCardCatalogEntry, "providerId" | "model">,
): string {
  return JSON.stringify([identity.providerId, identity.model]);
}

export const modelCardCatalogSchema = z.array(modelCardCatalogEntrySchema)
  .min(1)
  .superRefine((entries, context) => {
    const identities = new Map<string, number>();
    const emblemIdentities = new Map<string, number>();
    const routeIdentifierOwners = new Map<string, number>();
    const aliases = new Map<string, readonly [number, number]>();
    const reservedIds = new Set(entries.flatMap(entry => [
      entry.canonicalModelId,
      ...(entry.gatewayModelId === null ? [] : [entry.gatewayModelId]),
    ]));

    for (const [entryIndex, entry] of entries.entries()) {
      const identity = catalogIdentityKey(entry);
      const previousIdentity = identities.get(identity);
      if (previousIdentity !== undefined) {
        context.addIssue({
          code: "custom",
          message: `Duplicates catalog identity at entry ${previousIdentity}.`,
          path: [entryIndex],
        });
      } else {
        identities.set(identity, entryIndex);
      }

      const emblemIdentity = JSON.stringify([
        entry.providerId,
        entry.emblemIdentity.familyId,
        entry.emblemIdentity.generation,
        entry.emblemIdentity.revision,
        entry.emblemIdentity.editionId,
        entry.emblemIdentity.role,
      ]);
      const previousEmblemIdentity = emblemIdentities.get(emblemIdentity);
      if (previousEmblemIdentity !== undefined) {
        context.addIssue({
          code: "custom",
          message: `Duplicates emblem identity at entry ${previousEmblemIdentity}.`,
          path: [entryIndex, "emblemIdentity"],
        });
      } else {
        emblemIdentities.set(emblemIdentity, entryIndex);
      }

      if (entry.canonicalModelId.startsWith(`${fallbackCreatorSlug}/`)) {
        context.addIssue({
          code: "custom",
          message: `The ${fallbackCreatorSlug}/ creator is reserved for derived upstream identities.`,
          path: [entryIndex, "canonicalModelId"],
        });
      }

      const routeIdentifiers = [
        [entry.canonicalModelId, "canonicalModelId"],
        ...(entry.gatewayModelId === null || entry.gatewayModelId === entry.canonicalModelId
          ? []
          : [[entry.gatewayModelId, "gatewayModelId"]]),
      ] as const;
      for (const [identifier, field] of routeIdentifiers) {
        const previousOwner = routeIdentifierOwners.get(identifier);
        if (previousOwner !== undefined && previousOwner !== entryIndex) {
          context.addIssue({
            code: "custom",
            message: `Route identifier is already owned by entry ${previousOwner}.`,
            path: [entryIndex, field],
          });
        } else {
          routeIdentifierOwners.set(identifier, entryIndex);
        }
      }

      for (const [aliasIndex, alias] of entry.aliases.entries()) {
        const previousAlias = aliases.get(alias);
        if (previousAlias !== undefined) {
          context.addIssue({
            code: "custom",
            message: `Duplicates alias at entry ${previousAlias[0]}.`,
            path: [entryIndex, "aliases", aliasIndex],
          });
        } else {
          aliases.set(alias, [entryIndex, aliasIndex]);
        }
        if (reservedIds.has(alias)) {
          context.addIssue({
            code: "custom",
            message: "Aliases must exclude canonicalModelId and gatewayModelId values.",
            path: [entryIndex, "aliases", aliasIndex],
          });
        }
      }
    }
  })
  .readonly();

export type LobeIconKey = z.infer<typeof lobeIconKeySchema>;
export type ModelCardIntrinsicClass = z.infer<typeof modelCardIntrinsicClassSchema>;
export type ModelCardClass = ModelCardIntrinsicClass;
export type ModelCardEmblemRole = z.infer<typeof modelCardEmblemRoleSchema>;
export type ModelCardEmblemIdentity = z.infer<typeof modelCardEmblemIdentitySchema>;
export type ModelCardCatalogEntry = z.infer<typeof modelCardCatalogEntrySchema>;
export type ModelCardCatalog = z.infer<typeof modelCardCatalogSchema>;
export type ModelCardProfileSlug = z.infer<typeof modelCardProfileSlugSchema>;

export function parseModelCardCatalog(
  value: unknown,
): Result<ModelCardCatalog, z.ZodError> {
  return parseResult(modelCardCatalogSchema, value);
}

const checkedCatalogInput: unknown = modelCardCatalogData;
const checkedCatalogResult = parseModelCardCatalog(checkedCatalogInput);
if (!checkedCatalogResult.ok) {
  throw new Error(
    `Checked model-card catalog is invalid: ${checkedCatalogResult.error.message}`,
    { cause: checkedCatalogResult.error },
  );
}

export const MODEL_CARD_CATALOG = checkedCatalogResult.value;

const catalogByIdentity = new Map(
  MODEL_CARD_CATALOG.map(entry => [catalogIdentityKey(entry), entry]),
);
const catalogByIdentifier = new Map<string, ModelCardCatalogEntry>();
for (const entry of MODEL_CARD_CATALOG) {
  catalogByIdentifier.set(entry.canonicalModelId, entry);
  if (entry.gatewayModelId !== null) {
    catalogByIdentifier.set(entry.gatewayModelId, entry);
  }
  for (const alias of entry.aliases) catalogByIdentifier.set(alias, entry);
}

export function getModelCardCatalogEntry(
  providerId: string,
  model: string,
): ModelCardCatalogEntry | undefined {
  return catalogByIdentity.get(catalogIdentityKey({ providerId, model }));
}

export function resolveModelCardCatalogEntry(
  identifier: string,
): ModelCardCatalogEntry | undefined {
  return catalogByIdentifier.get(identifier);
}

export type ModelCardCatalogCoverage = Readonly<{
  missingCatalogEntries: readonly string[];
  orphanedCatalogEntries: readonly string[];
}>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type ResolvedModelCardEntry = Omit<ModelCardCatalogEntry, "lobeIconKey"> & Readonly<{
  lobeIconKey: LobeIconKey | null;
}>;

const fallbackLobeIconByProviderId: Readonly<Record<string, LobeIconKey>> = {
  alibaba_cloud: "alibabacloud",
  anthropic: "claude",
  cursor: "cursor",
  deepseek: "deepseek",
  google: "gemini",
  meta: "meta",
  moonshot_ai: "moonshot",
  openai: "openai",
  xai: "xai",
  z_ai: "zai",
};

const fallbackEmblemEditionIds = new Set([
  "fast",
  "flash",
  "lite",
  "max",
  "mini",
  "plus",
  "pro",
  "reasoning",
  "thinking",
  "turbo",
  "ultra",
]);

const fallbackEmblemSpeedEditions = new Set(["fast", "flash", "lite", "mini", "turbo"]);
const fallbackEmblemReasoningEditions = new Set(["reasoning", "thinking"]);
const fallbackEmblemFlagshipEditions = new Set(["max", "pro", "ultra"]);

function stableIdentityDigest(values: readonly string[]): string {
  const digest = createHash("sha256");
  for (const value of values) {
    digest.update(String(value.length));
    digest.update(":");
    digest.update(value);
    digest.update(";");
  }
  return digest.digest("hex").slice(0, fallbackDigestLength);
}

function readableRouteLabel(
  value: string,
  fallback: string,
  maximumLength: number,
): string {
  const label = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, maximumLength)
    .replace(/-+$/gu, "");
  return label || fallback;
}

function fallbackCatalogEntry(
  record: Pick<CodingAgentRecord, "model" | "providerId">,
): ResolvedModelCardEntry {
  const identityDigest = stableIdentityDigest([record.providerId, record.model]);
  const modelLabel = readableRouteLabel(
    record.model,
    "model",
    fallbackModelLabelLength,
  );
  const modelTokens = modelLabel.split(/[.-]/u).filter(Boolean);
  const editionId = modelTokens.find(token => fallbackEmblemEditionIds.has(token))
    ?? "base";
  const familyId = modelTokens
    .filter(token => !fallbackEmblemEditionIds.has(token))
    .map(token => token.replace(/[0-9].*$/u, ""))
    .filter(Boolean)
    .join("-")
    .slice(0, 40)
    .replace(/[.-]+$/u, "")
    || "unlisted";
  const parsedGeneration = record.model.match(/[0-9]+/gu)
    ?.slice(0, 4)
    .map(token => token.slice(0, 12));
  const role: ModelCardEmblemRole = fallbackEmblemSpeedEditions.has(editionId)
    ? "speed"
    : fallbackEmblemReasoningEditions.has(editionId)
      ? "reasoning"
      : fallbackEmblemFlagshipEditions.has(editionId)
        ? "flagship"
        : "general";
  return {
    aliases: [],
    canonicalModelId: `${fallbackCreatorSlug}/${modelLabel}.${identityDigest}`,
    emblemIdentity: {
      editionId,
      familyId,
      generation: parsedGeneration?.length ? parsedGeneration : ["unlisted"],
      revision: identityDigest,
      role,
    },
    gatewayModelId: null,
    intrinsicClass: "standard",
    lobeIconKey: fallbackLobeIconByProviderId[record.providerId] ?? null,
    model: record.model,
    providerId: record.providerId,
  };
}

function sourceIdentifier(seriesId: string): string | null {
  const separatorIndex = seriesId.indexOf(":");
  return separatorIndex < 0 ? null : seriesId.slice(separatorIndex + 1);
}

type CatalogIndexes = Readonly<{
  byAlias: ReadonlyMap<string, ModelCardCatalogEntry>;
  byIdentity: ReadonlyMap<string, ModelCardCatalogEntry>;
}>;

function catalogIndexes(catalog: ModelCardCatalog): CatalogIndexes {
  const byAlias = new Map<string, ModelCardCatalogEntry>();
  const byIdentity = new Map<string, ModelCardCatalogEntry>();
  for (const entry of catalog) {
    byIdentity.set(catalogIdentityKey(entry), entry);
    for (const alias of entry.aliases) byAlias.set(alias, entry);
  }
  return { byAlias, byIdentity };
}

function catalogEntryForRecord(
  record: Pick<CodingAgentRecord, "model" | "providerId" | "seriesId">,
  indexes: CatalogIndexes,
): ModelCardCatalogEntry | undefined {
  const identifier = sourceIdentifier(record.seriesId);
  const exactAliasEntry = identifier === null ? undefined : indexes.byAlias.get(identifier);
  const suffixAliasEntry = exactAliasEntry === undefined
    ? [...indexes.byAlias]
      .filter(([alias]) => record.seriesId.endsWith(`:${alias}`))
      .sort(([left], [right]) => right.length - left.length || compareText(left, right))[0]?.[1]
    : undefined;
  const aliasEntry = exactAliasEntry ?? suffixAliasEntry;
  if (aliasEntry?.providerId === record.providerId) return aliasEntry;
  return indexes.byIdentity.get(catalogIdentityKey(record));
}

function profileSlugForSetting(setting: string): string {
  const routeSafe = modelCardProfileSlugSchema.safeParse(setting);
  if (routeSafe.success && !routeSafe.data.startsWith(fallbackProfilePrefix)) {
    return routeSafe.data;
  }
  const label = readableRouteLabel(
    setting,
    "setting",
    fallbackProfileLabelLength,
  );
  return `${fallbackProfilePrefix}${label}.${stableIdentityDigest([setting])}`;
}

export function modelCardCatalogCoverage(
  records: readonly Pick<CodingAgentRecord, "providerId" | "model" | "seriesId">[],
  catalog: ModelCardCatalog = MODEL_CARD_CATALOG,
): ModelCardCatalogCoverage {
  const indexes = catalogIndexes(catalog);
  const recordIdentities = new Map<string, string>();
  const coveredRecordIdentities = new Set<string>();
  const usedCatalogIds = new Set<string>();
  for (const record of records) {
    const identity = catalogIdentityKey(record);
    recordIdentities.set(identity, `${record.providerId}/${record.model}`);
    const entry = catalogEntryForRecord(record, indexes);
    if (entry !== undefined) {
      coveredRecordIdentities.add(identity);
      usedCatalogIds.add(entry.canonicalModelId);
    }
  }

  return {
    missingCatalogEntries: [...recordIdentities]
      .filter(([identity]) => !coveredRecordIdentities.has(identity))
      .map(([, label]) => label)
      .sort(compareText),
    orphanedCatalogEntries: catalog
      .filter(entry => !usedCatalogIds.has(entry.canonicalModelId))
      .map(entry => `${entry.providerId}/${entry.model}`)
      .sort(compareText),
  };
}

export type ModelCardRouteParams = Readonly<{
  creatorSlug: string;
  modelSlug: string;
  profileSlug: string;
}>;

export type ModelCardPath = `/models/${string}/${string}/${string}`;

export const modelCardRouteParamsSchema = z.object({
  creatorSlug: modelCardProfileSlugSchema,
  modelSlug: modelCardProfileSlugSchema,
  profileSlug: modelCardProfileSlugSchema,
}).strict().readonly();

const modelCardPathSchema = z.string()
  .regex(
    /^\/models\/[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/u,
    "Expected /models/{creatorSlug}/{modelSlug}/{profileSlug}.",
  )
  .transform((path): ModelCardRouteParams => {
    const [, , creatorSlug, modelSlug, profileSlug] = path.split("/");
    if (creatorSlug === undefined || modelSlug === undefined || profileSlug === undefined) {
      throw new Error("Validated model-card path did not contain three route segments.");
    }
    return { creatorSlug, modelSlug, profileSlug };
  });

export function parseModelCardPathSegments(
  value: unknown,
): Result<ModelCardRouteParams, z.ZodError> {
  return parseResult(modelCardRouteParamsSchema, value);
}

export function parseModelCardPath(
  value: unknown,
): Result<ModelCardRouteParams, z.ZodError> {
  return parseResult(modelCardPathSchema, value);
}

export function splitCanonicalModelId(
  canonicalModelId: string,
): Readonly<{ creatorSlug: string; modelSlug: string }> {
  const parsed = canonicalModelIdSchema.safeParse(canonicalModelId);
  if (!parsed.success) {
    throw new Error(`Invalid canonical model ID: ${canonicalModelId}.`, {
      cause: parsed.error,
    });
  }
  const [creatorSlug, modelSlug] = parsed.data.split("/");
  if (creatorSlug === undefined || modelSlug === undefined) {
    throw new Error(`Invalid canonical model ID: ${canonicalModelId}.`);
  }
  return { creatorSlug, modelSlug };
}

export function modelCardPath(
  identity: Readonly<{ canonicalModelId: string; profileSlug: string }>,
): ModelCardPath {
  const { creatorSlug, modelSlug } = splitCanonicalModelId(identity.canonicalModelId);
  const profile = modelCardProfileSlugSchema.safeParse(identity.profileSlug);
  if (!profile.success) {
    throw new Error(`Invalid model-card profile slug: ${identity.profileSlug}.`, {
      cause: profile.error,
    });
  }
  return `/models/${creatorSlug}/${modelSlug}/${profile.data}`;
}

export const MODEL_CARD_METRIC_IDS = [
  "aaIndex",
  "deepSwe",
  "terminalBench",
  "sweAtlas",
  "costUsd",
  "durationSeconds",
  "totalTokens",
] as const;

export type ModelCardMetricId = typeof MODEL_CARD_METRIC_IDS[number];

export type ModelCardMetricRange = Readonly<{
  min: number | null;
  max: number | null;
  observationCount: number;
}>;

export type ModelCardVariant = Readonly<{
  aliases: readonly string[];
  canonicalModelId: string;
  cardClass: ModelCardClass;
  creatorSlug: string;
  emblemIdentity: ModelCardEmblemIdentity;
  gatewayModelId: string | null;
  intrinsicClass: ModelCardIntrinsicClass;
  lobeIconKey: LobeIconKey | null;
  metricRanges: Readonly<Record<ModelCardMetricId, ModelCardMetricRange>>;
  model: string;
  modelSlug: string;
  observationCount: number;
  observations: readonly CodingAgentRecord[];
  path: ModelCardPath;
  profileSlug: string;
  providerId: string;
  providerName: string;
  setting: string;
  settingRank: number;
}>;

export { modelCardRouteStatus } from "./model-card-route-status";
export type { ModelCardRouteStatus } from "./model-card-route-status";

function modelCardMetricValue(
  record: CodingAgentRecord,
  metric: ModelCardMetricId,
): number | null {
  if (metric === "aaIndex") return record.benchmarks.aaIndex;
  if (metric === "deepSwe") return record.benchmarks.deepSwe;
  if (metric === "terminalBench") return record.benchmarks.terminalBench;
  if (metric === "sweAtlas") return record.benchmarks.sweAtlas;
  if (metric === "costUsd") return record.economics.costUsd;
  if (metric === "durationSeconds") return record.economics.durationSeconds;
  return record.usage.totalTokens;
}

function metricRange(
  observations: readonly CodingAgentRecord[],
  metric: ModelCardMetricId,
): ModelCardMetricRange {
  const values = observations
    .map(record => modelCardMetricValue(record, metric))
    .filter((value): value is number => value !== null);
  if (values.length === 0) {
    return { min: null, max: null, observationCount: 0 };
  }
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    observationCount: values.length,
  };
}

function metricRanges(
  observations: readonly CodingAgentRecord[],
): ModelCardVariant["metricRanges"] {
  return Object.fromEntries(MODEL_CARD_METRIC_IDS.map(metric => [
    metric,
    metricRange(observations, metric),
  ])) as ModelCardVariant["metricRanges"];
}

function compareObservations(
  left: CodingAgentRecord,
  right: CodingAgentRecord,
): number {
  return compareText(left.agent, right.agent)
    || compareText(left.id, right.id)
    || compareText(left.seriesId, right.seriesId);
}

function compareModelCardVariants(
  left: ModelCardVariant,
  right: ModelCardVariant,
): number {
  return compareText(left.canonicalModelId, right.canonicalModelId)
    || left.settingRank - right.settingRank
    || compareText(left.profileSlug, right.profileSlug)
    || compareText(left.path, right.path);
}

function derivedCardClass(
  intrinsicClass: ModelCardIntrinsicClass,
  profileSlug: string,
): ModelCardClass {
  if (intrinsicClass !== "standard") return intrinsicClass;
  return profileSlug === "max" ? "max" : "standard";
}

function checkedSingleValue<Value>(
  values: readonly Value[],
  description: string,
): Value {
  const unique = new Set(values);
  if (unique.size !== 1) {
    throw new Error(`Model-card observations disagree on ${description}.`);
  }
  const value = unique.values().next().value;
  if (value === undefined) {
    throw new Error(`Model-card observations have no ${description}.`);
  }
  return value;
}

function representativeDisplayValue(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const result = [...counts]
    .sort(([leftValue, leftCount], [rightValue, rightCount]) => (
      rightCount - leftCount || compareText(leftValue, rightValue)
    ))[0]?.[0];
  if (result === undefined) {
    throw new Error("Model-card observations have no display value.");
  }
  return result;
}

export function buildModelCardVariants(
  records: readonly CodingAgentRecord[],
  catalog: ModelCardCatalog = MODEL_CARD_CATALOG,
): readonly ModelCardVariant[] {
  const indexes = catalogIndexes(catalog);
  const fallbackIdentityOwners = new Map<string, string>();
  const profileOwners = new Map<string, string>();
  const grouped = new Map<string, {
    entry: ResolvedModelCardEntry;
    observations: CodingAgentRecord[];
  }>();

  for (const record of records) {
    const catalogEntry = catalogEntryForRecord(record, indexes);
    const entry = catalogEntry ?? fallbackCatalogEntry(record);
    if (catalogEntry === undefined) {
      const identity = catalogIdentityKey(record);
      const previousIdentity = fallbackIdentityOwners.get(entry.canonicalModelId);
      if (previousIdentity !== undefined && previousIdentity !== identity) {
        throw new Error(
          `Derived model-card identity digest collision at ${entry.canonicalModelId}.`,
        );
      }
      fallbackIdentityOwners.set(entry.canonicalModelId, identity);
    }
    const profileSlug = profileSlugForSetting(record.setting);
    const groupKey = JSON.stringify([
      entry.canonicalModelId,
      profileSlug,
    ]);
    const previousSetting = profileOwners.get(groupKey);
    if (previousSetting !== undefined && previousSetting !== record.setting) {
      throw new Error(
        `Derived model-card profile digest collision at ${entry.canonicalModelId}/${profileSlug}.`,
      );
    }
    profileOwners.set(groupKey, record.setting);
    const group = grouped.get(groupKey);
    if (group === undefined) {
      grouped.set(groupKey, { entry, observations: [record] });
    } else {
      group.observations.push(record);
    }
  }

  const variants = [...grouped.values()].map(({ entry, observations }) => {
    const sortedObservations = [...observations].sort(compareObservations);
    const providerName = representativeDisplayValue(
      sortedObservations.map(record => record.providerName),
    );
    const setting = checkedSingleValue(
      sortedObservations.map(record => record.setting),
      `${entry.canonicalModelId} setting`,
    );
    const profileSlug = profileSlugForSetting(setting);
    const settingRank = checkedSingleValue(
      sortedObservations.map(record => record.settingRank),
      `${entry.canonicalModelId}/${setting} settingRank`,
    );
    const model = representativeDisplayValue(
      sortedObservations.map(record => record.model),
    );
    const { creatorSlug, modelSlug } = splitCanonicalModelId(entry.canonicalModelId);

    return {
      ...entry,
      cardClass: derivedCardClass(entry.intrinsicClass, profileSlug),
      creatorSlug,
      metricRanges: metricRanges(sortedObservations),
      model,
      modelSlug,
      observationCount: sortedObservations.length,
      observations: sortedObservations,
      path: modelCardPath({
        canonicalModelId: entry.canonicalModelId,
        profileSlug,
      }),
      profileSlug,
      providerName,
      setting,
      settingRank,
    } satisfies ModelCardVariant;
  }).sort(compareModelCardVariants);

  const paths = new Set(variants.map(variant => variant.path));
  if (paths.size !== variants.length) {
    throw new Error("Model-card variants produced duplicate card paths.");
  }
  return variants;
}

export function findModelCardVariant(
  variants: readonly ModelCardVariant[],
  pathSegments: unknown,
): ModelCardVariant | undefined {
  const parsed = parseModelCardPathSegments(pathSegments);
  if (!parsed.ok) return undefined;
  const { creatorSlug, modelSlug, profileSlug } = parsed.value;
  return variants.find(variant => (
    variant.creatorSlug === creatorSlug
    && variant.modelSlug === modelSlug
    && variant.profileSlug === profileSlug
  ));
}

export function findModelCardVariantByPath(
  variants: readonly ModelCardVariant[],
  path: unknown,
): ModelCardVariant | undefined {
  const parsed = parseModelCardPath(path);
  return parsed.ok ? findModelCardVariant(variants, parsed.value) : undefined;
}

export function modelCardStaticParams(
  variants: readonly ModelCardVariant[],
): readonly ModelCardRouteParams[] {
  return [...variants]
    .sort(compareModelCardVariants)
    .map(({ creatorSlug, modelSlug, profileSlug }) => ({
      creatorSlug,
      modelSlug,
      profileSlug,
    }));
}
