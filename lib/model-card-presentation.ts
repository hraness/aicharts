import type { FoilCardPreset } from "@hraness/design-kit/react";

import {
  modelCardArtDirection,
  type ModelCardAccentFamily,
  type ModelCardIlluminationDensity,
  type ModelCardVisualClass,
} from "./model-card-art-direction";
import {
  type ModelCardClass,
  type ModelCardMetricId,
  type ModelCardMetricRange,
  type ModelCardVariant,
} from "./model-card-data";
import { modelIconDataUrl } from "./model-card-icons";
import { isoCalendarDateToUtcDate } from "./iso-calendar-date";
import type {
  ModelReleaseDateEntry,
  VerifiedModelReleaseDate,
} from "./model-release-date-data";
import { modelCardRouteStatus } from "./model-card-route-status";

export type ModelCardStat = Readonly<{
  available: boolean;
  id: ModelCardMetricId;
  label: string;
  value: string;
}>;

export type ModelCardListing = Readonly<{
  id: string;
  source: "OpenRouter";
  sourceAddedAt: string;
}>;

export type { ModelCardVisualClass } from "./model-card-art-direction";

export type ModelCardIndexingPolicy = Readonly<{
  follow: true;
  index: false;
}> | undefined;

/** A provisional identity observed in the benchmark before first-party research is checked in. */
export type UnreviewedModelRelease = Readonly<{
  canonicalModelId: string;
  observedOn: string;
  reason: string;
  status: "unreviewed";
}>;

export type ModelCardRelease = ModelReleaseDateEntry | UnreviewedModelRelease;

export type ModelCardPresentation = Readonly<{
  accentFamily: ModelCardAccentFamily;
  agentNames: readonly string[];
  canonicalModelId: string;
  cardClass: ModelCardClass;
  cardNumber: number;
  classLabel: string;
  displayTitle: string;
  emblemIdentity: ModelCardVariant["emblemIdentity"];
  economics: readonly ModelCardStat[];
  foilPreset: FoilCardPreset;
  gatewayModelId: string | null;
  harnessLabel: string;
  iconDataUrl: string;
  illuminationDensity: ModelCardIlluminationDensity;
  model: string;
  observationCount: number;
  path: ModelCardVariant["path"];
  performance: readonly ModelCardStat[];
  profileLabel: string;
  profileSlug: string;
  providerColor: string;
  providerId: string;
  providerName: string;
  release: ModelCardRelease;
  secondaryColor: string;
  seed: string;
  sourceDate: string;
  totalCards: number;
  visualClass: ModelCardVisualClass;
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

function classLabel(value: ModelCardVisualClass): string {
  if (value === "thinking") return "Thinking";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function classAwareDisplayTitle(
  displayTitle: string,
  visualClass: ModelCardVisualClass,
): string {
  if (visualClass !== "thinking" || /\bthinking\b/iu.test(displayTitle)) {
    return displayTitle;
  }
  return `${displayTitle} Thinking`;
}

function foilPreset(): FoilCardPreset {
  return "etched";
}

const modelCardOperationalSuffixes = [
  /\s+\(with fallback\)$/iu,
  /\s+\(thinking\)$/iu,
] as const;

/** Removes upstream operational qualifiers without changing source identity. */
export function cleanModelCardDisplayName(model: string): string {
  let displayName = model.trim();
  let previousName: string;
  do {
    previousName = displayName;
    for (const suffix of modelCardOperationalSuffixes) {
      displayName = displayName.replace(suffix, "").trim();
    }
  } while (displayName !== previousName);
  if (displayName.length === 0) {
    throw new Error("Model-card display name must contain visible text.");
  }
  return displayName;
}

/** Combines the collectible name and non-default profile exactly once. */
export function formatModelCardDisplayTitle(
  model: string,
  profileLabel: string,
): string {
  const displayName = cleanModelCardDisplayName(model);
  if (profileLabel === "Standard") return displayName;
  const normalizedProfile = profileLabel.toLocaleLowerCase("en-US")
    .replace(/[\s_-]+/gu, "");
  const parenthesizedSuffix = displayName.match(/\s+\(([^()]*)\)$/u);
  if (
    parenthesizedSuffix !== null
    && parenthesizedSuffix[1]?.toLocaleLowerCase("en-US")
      .replace(/[\s_-]+/gu, "") === normalizedProfile
  ) {
    return `${displayName.slice(0, parenthesizedSuffix.index).trim()} ${profileLabel}`;
  }
  const words = displayName.split(/\s+/u);
  for (let index = 0; index < words.length; index += 1) {
    const suffix = words.slice(index).join(" ").toLocaleLowerCase("en-US")
      .replace(/[\s_-]+/gu, "");
    if (suffix === normalizedProfile) {
      return `${words.slice(0, index).join(" ")} ${profileLabel}`.trim();
    }
  }
  return `${displayName} ${profileLabel}`;
}

function visualClass(
  value: ModelCardClass,
  profileSlug: string,
): ModelCardVisualClass {
  if (value !== "fallback") return value;
  return profileSlug === "max" ? "max" : "standard";
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

const modelCardReleaseDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

const modelCardReleaseAccessibleDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

function modelCardReleaseDate(releasedOn: string): Date {
  const date = isoCalendarDateToUtcDate(releasedOn);
  if (date === null) {
    throw new Error("Model-card release date must be a valid ISO calendar date.");
  }
  return date;
}

/** Formats a checked first-party release date for the compact card face. */
export function formatModelCardReleaseDate(releasedOn: string): string {
  return modelCardReleaseDateFormatter
    .format(modelCardReleaseDate(releasedOn))
    .toLocaleUpperCase("en-US");
}

export function formatModelCardReleaseDateLong(releasedOn: string): string {
  return modelCardReleaseAccessibleDateFormatter.format(
    modelCardReleaseDate(releasedOn),
  );
}

export function formatModelCardReleaseStage(
  stage: VerifiedModelReleaseDate["stage"],
): string {
  if (stage === "general-availability") return "General availability";
  if (stage === "public-preview") return "Public preview";
  return "Public release";
}

/** Compact release label that discloses whether evidence covers only the base model. */
export function modelCardReleaseLabel(release: ModelCardRelease): string {
  if (release.status === "verified" && release.appliesTo?.kind === "base-model") {
    return "Base released";
  }
  return release.status === "verified" ? "Released" : "Release date";
}

/** Keeps official-source provenance available to assistive UI and card links. */
export function modelCardReleaseAccessibleLabel(release: ModelCardRelease): string {
  if (release.status === "pending") {
    return `Official release date pending verification; researched ${formatModelCardReleaseDateLong(release.researchedOn)}.`;
  }
  if (release.status === "unreviewed") {
    return `Official release date pending review for this newly observed model identity; first observed in the benchmark snapshot on ${formatModelCardReleaseDateLong(release.observedOn)}.`;
  }
  if (release.appliesTo?.kind === "base-model") {
    return `Official base-model release date for ${release.appliesTo.model}: ${formatModelCardReleaseDateLong(release.releasedOn)}. Verified from ${release.sources[0]?.title ?? "a first-party source"}.`;
  }
  return `Official release date: ${formatModelCardReleaseDateLong(release.releasedOn)}. Verified from ${release.sources[0]?.title ?? "a first-party source"}.`;
}

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
  release: ModelCardRelease,
): ModelCardPresentation {
  if (release.canonicalModelId !== variant.canonicalModelId) {
    throw new Error(
      `Model-card release identity ${release.canonicalModelId} must match ${variant.canonicalModelId}.`,
    );
  }
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
  const profileLabel = formatProfileLabel(variant.profileSlug);
  const cardVisualClass = visualClass(variant.cardClass, variant.profileSlug);
  const artDirection = modelCardArtDirection(
    variant.providerId,
    cardVisualClass,
    variant.profileSlug,
  );
  return {
    ...artDirection,
    agentNames,
    canonicalModelId: variant.canonicalModelId,
    cardClass: variant.cardClass,
    cardNumber,
    classLabel: classLabel(cardVisualClass),
    displayTitle: classAwareDisplayTitle(
      formatModelCardDisplayTitle(variant.model, profileLabel),
      cardVisualClass,
    ),
    emblemIdentity: variant.emblemIdentity,
    economics: economics.map(({ id, label }) => modelCardStat(
      id,
      label,
      variant.metricRanges[id],
    )),
    foilPreset: foilPreset(),
    gatewayModelId: variant.gatewayModelId,
    harnessLabel: compactModelCardHarnessLabel(agentNames),
    iconDataUrl: modelIconDataUrl(variant.lobeIconKey, variant.providerName),
    model: variant.model,
    observationCount: variant.observationCount,
    path: variant.path,
    performance,
    profileLabel,
    profileSlug: variant.profileSlug,
    providerId: variant.providerId,
    providerName: variant.providerName,
    release,
    seed: variant.canonicalModelId,
    sourceDate: formatModelCardSourceDate(sourceRetrievedAt),
    totalCards,
    visualClass: cardVisualClass,
  };
}
