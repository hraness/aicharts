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
export const MODEL_CARD_RENDERER_VERSION = "model-card-v2";
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
