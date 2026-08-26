import type { FoilCardPreset } from "@hraness/design-kit/react";

import { providerColor } from "./chart-colors";
import {
  type ModelCardClass,
  type ModelCardMetricId,
  type ModelCardMetricRange,
  type ModelCardVariant,
} from "./model-card-data";
import { modelIconDataUrl } from "./model-card-icons";
import { modelCardRouteStatus } from "./model-card-route-status";

export type ModelCardStat = Readonly<{
  available: boolean;
  id: ModelCardMetricId;
  label: string;
  value: string;
}>;

export type ModelCardIndexingPolicy = Readonly<{
  follow: true;
  index: false;
}> | undefined;

export type ModelCardPresentation = Readonly<{
  agentNames: readonly string[];
  canonicalModelId: string;
  cardClass: ModelCardClass;
  cardNumber: number;
  classLabel: string;
  economics: readonly ModelCardStat[];
  foilPreset: FoilCardPreset;
  gatewayModelId: string | null;
  iconDataUrl: string;
  model: string;
  observationCount: number;
  path: ModelCardVariant["path"];
  performance: readonly ModelCardStat[];
  profileLabel: string;
  profileSlug: string;
  providerColor: string;
  providerName: string;
  seed: string;
  sourceDate: string;
  totalCards: number;
}>;

const performanceLabels: Readonly<Record<Extract<ModelCardMetricId,
  "aaIndex" | "deepSwe" | "terminalBench" | "sweAtlas">, string>> = {
  aaIndex: "AAI",
  deepSwe: "DSWE",
  sweAtlas: "SWEA",
  terminalBench: "TB",
};

function formatProfileLabel(value: string): string {
  if (value.startsWith("upstream.")) {
    const encoded = value.slice("upstream.".length);
    const digestSeparator = encoded.lastIndexOf(".");
    const readable = digestSeparator < 0 ? encoded : encoded.slice(0, digestSeparator);
    return readable.split("-").filter(Boolean).map(word => (
      word.charAt(0).toUpperCase() + word.slice(1)
    )).join(" ") || "Upstream setting";
  }
  if (value === "default" || value === "none") return "Standard";
  if (value === "xhigh") return "X-high";
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("-", " ");
}

function classLabel(value: ModelCardClass): string {
  if (value === "fallback") return "Fallback";
  if (value === "thinking") return "Thinking";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function foilPreset(value: ModelCardClass): FoilCardPreset {
  if (value === "fast") return "fast";
  if (value === "max") return "max";
  if (value === "thinking") return "aurora";
  if (value === "fallback") return "prism";
  return "etched";
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return Math.round(value).toLocaleString("en-US");
}

const modelCardSourceDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

export function formatModelCardSourceDate(retrievedAt: string): string {
  const date = new Date(retrievedAt);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Model-card source retrieval time must be a valid timestamp.");
  }
  return modelCardSourceDateFormatter.format(date);
}

export function compactModelCardHarnessLabel(
  agentNames: readonly string[],
): string {
  const first = agentNames[0];
  if (first === undefined) {
    throw new Error("Model-card presentation requires at least one agent harness.");
  }
  return agentNames.length === 1 ? first : `${first} +${agentNames.length - 1}`;
}

function metricValue(metric: ModelCardMetricId, value: number): string {
  if (metric === "costUsd") {
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: value < 10 ? 2 : 1, minimumFractionDigits: value < 1 ? 2 : 0 })}`;
  }
  if (metric === "durationSeconds") {
    const minutes = value / 60;
    return `${minutes.toLocaleString("en-US", { maximumFractionDigits: minutes < 10 ? 1 : 0 })}m`;
  }
  if (metric === "totalTokens") return compactNumber(value);
  return value.toFixed(1);
}

export function formatModelCardMetricRange(
  metric: ModelCardMetricId,
  range: ModelCardMetricRange,
): string {
  if (range.min === null || range.max === null) return "–";
  const minimum = metricValue(metric, range.min);
  const maximum = metricValue(metric, range.max);
  return minimum === maximum ? minimum : `${minimum}–${maximum}`;
}

export function modelCardIndexingPolicy(
  card: Pick<ModelCardVariant, "canonicalModelId" | "profileSlug">,
): ModelCardIndexingPolicy {
  return modelCardRouteStatus(card).isProvisional
    ? { follow: true, index: false }
    : undefined;
}

function modelCardStat(
  id: ModelCardMetricId,
  label: string,
  range: ModelCardMetricRange,
): ModelCardStat {
  return {
    available: range.min !== null && range.max !== null,
    id,
    label,
    value: formatModelCardMetricRange(id, range),
  };
}

export function createModelCardPresentation(
  variant: ModelCardVariant,
  cardNumber: number,
  totalCards: number,
  sourceRetrievedAt: string,
): ModelCardPresentation {
  if (!Number.isSafeInteger(cardNumber) || cardNumber <= 0 || cardNumber > totalCards) {
    throw new Error("Model-card number must identify one card in the collection.");
  }
  const performanceIds = ["aaIndex", "deepSwe", "terminalBench", "sweAtlas"] as const;
  const performance = performanceIds.map(id => modelCardStat(
    id,
    performanceLabels[id],
    variant.metricRanges[id],
  ));
  const economics = [
    { id: "costUsd", label: "Cost" },
    { id: "durationSeconds", label: "Time" },
    { id: "totalTokens", label: "Tokens" },
  ] as const;
  const agentNames = [...new Set(variant.observations.map(observation => observation.agent))]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (agentNames.length === 0) {
    throw new Error("Model-card presentation requires at least one agent harness.");
  }
  return {
    agentNames,
    canonicalModelId: variant.canonicalModelId,
    cardClass: variant.cardClass,
    cardNumber,
    classLabel: classLabel(variant.cardClass),
    economics: economics.map(({ id, label }) => modelCardStat(
      id,
      label,
      variant.metricRanges[id],
    )),
    foilPreset: foilPreset(variant.cardClass),
    gatewayModelId: variant.gatewayModelId,
    iconDataUrl: modelIconDataUrl(variant.lobeIconKey, variant.providerName),
    model: variant.model,
    observationCount: variant.observationCount,
    path: variant.path,
    performance,
    profileLabel: formatProfileLabel(variant.profileSlug),
    profileSlug: variant.profileSlug,
    providerColor: providerColor(variant.providerId),
    providerName: variant.providerName,
    seed: `${variant.canonicalModelId}/${variant.profileSlug}`,
    sourceDate: formatModelCardSourceDate(sourceRetrievedAt),
    totalCards,
  };
}
