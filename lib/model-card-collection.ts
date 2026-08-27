import { createHash } from "node:crypto";

import codingAgentData from "@/data/coding-agents.json";

import { parseCodingAgentSnapshot } from "./coding-agent-data";
import {
  buildModelCardVariants,
  findModelCardVariant,
  modelCardStaticParams,
  type ModelCardRouteParams,
} from "./model-card-data";
import {
  createModelCardPresentation,
  type ModelCardPresentation,
} from "./model-card-presentation";

const parsedSnapshot = parseCodingAgentSnapshot(codingAgentData as unknown);
if (!parsedSnapshot.ok) {
  throw new Error(`Checked coding-agent snapshot is invalid: ${parsedSnapshot.error.message}`, {
    cause: parsedSnapshot.error,
  });
}

export const MODEL_CARD_SNAPSHOT = parsedSnapshot.value;
export const MODEL_CARD_RENDERER_VERSION = "model-card-v4";
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

export function modelCardRouteStaticParams(): readonly ModelCardRouteParams[] {
  return modelCardStaticParams(MODEL_CARD_VARIANTS);
}

/** Selects one high-detail, non-ranked heraldic representative per provider. */
export function modelCardProviderRepresentatives(
  cards: readonly ModelCardPresentation[] = MODEL_CARD_PRESENTATIONS,
  limit = 12,
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
