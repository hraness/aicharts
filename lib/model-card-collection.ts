import { createHash } from "node:crypto";

import codingAgentData from "@/data/coding-agents.json";

import { parseCodingAgentSnapshot } from "./coding-agent-data";
import { computeParetoSet } from "./option-space";
import {
  buildModelCardVariants,
  findModelCardVariant,
  modelCardStaticParams,
  type ModelCardRouteParams,
  type ModelCardPath,
  type ModelCardVariant,
} from "./model-card-data";
import {
  createModelCardPresentation,
  type ModelCardPresentation,
} from "./model-card-presentation";
import {
  modelReleaseSemanticKey,
  type ModelReleaseRadar,
} from "./model-release-data";
import { MODEL_RELEASE_RADAR } from "./model-release-collection";

const parsedSnapshot = parseCodingAgentSnapshot(codingAgentData as unknown);
if (!parsedSnapshot.ok) {
  throw new Error(`Checked coding-agent snapshot is invalid: ${parsedSnapshot.error.message}`, {
    cause: parsedSnapshot.error,
  });
}

export const MODEL_CARD_SNAPSHOT = parsedSnapshot.value;
export const MODEL_CARD_RENDERER_VERSION = "model-card-v5";
export const MODEL_CARD_COLLECTION_SOCIAL_IMAGE_PATH = "/models/opengraph-image-v5";
export const MODEL_CARD_SNAPSHOT_VERSION = createHash("sha256")
  .update(JSON.stringify(codingAgentData))
  .update("\0")
  .update(MODEL_CARD_RENDERER_VERSION)
  .digest("hex")
  .slice(0, 16);
export const MODEL_CARD_VARIANTS = buildModelCardVariants(MODEL_CARD_SNAPSHOT.records);
export const MODEL_CARD_PRESENTATIONS = MODEL_CARD_VARIANTS.map((variant, index, variants) => (
  createModelCardPresentation(
    variant,
    index + 1,
    variants.length,
    MODEL_CARD_SNAPSHOT.source.retrievedAt,
  )
));
export const MODEL_CARD_TOP_PATHS = modelCardCostAaFrontierPaths(MODEL_CARD_VARIANTS);
export const MODEL_CARD_RELEASE_DATES = modelCardReleaseDates(
  MODEL_CARD_VARIANTS,
  MODEL_RELEASE_RADAR,
);

export const MODEL_CARD_COLLECTION_CREST_LIMIT = 11;

/**
 * Maps the checked cost/AA Index Pareto frontier back to card profiles.
 * A profile is Top when at least one retained configuration has no alternative
 * that is no more expensive and at least as strong, with an advantage on one axis.
 */
export function modelCardCostAaFrontierPaths(
  variants = MODEL_CARD_VARIANTS,
): readonly ModelCardPresentation["path"][] {
  const frontierRecordIds = new Set(computeParetoSet(
    variants.flatMap(variant => variant.observations),
    "costUsd",
    "aaIndex",
  ).map(({ record }) => record.id));

  return variants
    .filter(variant => variant.observations.some(observation => (
      frontierRecordIds.has(observation.id)
    )))
    .map(variant => variant.path);
}

/**
 * Maps every benchmark card to its newest independently observed OpenRouter listing.
 * The durable observation ledger is independent of the bounded current-release radar.
 */
export function modelCardReleaseDates(
  cards: readonly Pick<ModelCardVariant, "model" | "path" | "providerId">[],
  radar: ModelReleaseRadar,
): ReadonlyMap<ModelCardPath, string | null> {
  const newestByModel = new Map<string, string>();
  for (const release of radar.observedListings) {
    const key = modelReleaseSemanticKey(release.providerId, release.model);
    const existing = newestByModel.get(key);
    if (
      existing === undefined
      || Date.parse(release.sourceAddedAt) > Date.parse(existing)
    ) {
      newestByModel.set(key, release.sourceAddedAt);
    }
  }

  return new Map(cards.map(card => [
    card.path,
    newestByModel.get(modelReleaseSemanticKey(card.providerId, card.model)) ?? null,
  ]));
}

export function modelCardRouteStaticParams(): readonly ModelCardRouteParams[] {
  return modelCardStaticParams(MODEL_CARD_VARIANTS);
}

/** Selects one high-detail, non-ranked heraldic representative per provider. */
export function modelCardProviderRepresentatives(
  cards: readonly ModelCardPresentation[] = MODEL_CARD_PRESENTATIONS,
  limit = MODEL_CARD_COLLECTION_CREST_LIMIT,
): readonly ModelCardPresentation[] {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("Model-card representative limit must be a positive integer.");
  }
  const byProvider = new Map<string, ModelCardPresentation>();
  for (const card of cards) {
    const selected = byProvider.get(card.providerId);
    if (
      selected === undefined
      || card.illuminationDensity > selected.illuminationDensity
      || (
        card.illuminationDensity === selected.illuminationDensity
        && card.cardNumber < selected.cardNumber
      )
    ) {
      byProvider.set(card.providerId, card);
    }
  }
  return [...byProvider.values()]
    .sort((left, right) => left.cardNumber - right.cardNumber)
    .slice(0, limit);
}

export function modelCardProviderCount(
  cards: readonly ModelCardPresentation[] = MODEL_CARD_PRESENTATIONS,
): number {
  return new Set(cards.map(card => card.providerId)).size;
}

export function versionedModelCardImagePath(
  path: ModelCardPresentation["path"],
  image: "card.png" | "opengraph-image",
): string {
  return `${path}/${image}?v=${MODEL_CARD_SNAPSHOT_VERSION}`;
}

export function findModelCardPresentation(
  pathSegments: unknown,
): ModelCardPresentation | undefined {
  const variant = findModelCardVariant(MODEL_CARD_VARIANTS, pathSegments);
  if (variant === undefined) return undefined;
  return MODEL_CARD_PRESENTATIONS.find(card => card.path === variant.path);
}
