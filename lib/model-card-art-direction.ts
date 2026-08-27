import { providerColor as fallbackProviderColor } from "./chart-colors";
import type { ModelCardClass } from "./model-card-data";

export type ModelCardVisualClass = Exclude<ModelCardClass, "fallback">;
export type ModelCardAccentFamily = "base" | "fast" | "thinking" | "elevated";
export type ModelCardIlluminationDensity = 1 | 2 | 3 | 4 | 5;

export type ModelCardArtDirection = Readonly<{
  accentFamily: ModelCardAccentFamily;
  illuminationDensity: ModelCardIlluminationDensity;
  providerColor: string;
  secondaryColor: string;
}>;

export const modelCardSecondaryColors = {
  base: "#d8c9aa",
  elevated: "#f0c96d",
  fast: "#69dce3",
  thinking: "#ae8bff",
} as const satisfies Readonly<Record<ModelCardAccentFamily, string>>;

// A product-owned Tableau-derived categorical assignment for dark collectible
// fields. Cobalt replaces Tableau's yellow because gold is reserved for the
// elevated class family; provider identity and class ink never collapse.
export const modelCardProviderColors = {
  alibaba_cloud: "#f28e2b",
  anthropic: "#e15759",
  cursor: "#ff9da7",
  deepseek: "#499894",
  google: "#59a14f",
  meta: "#b07aa1",
  moonshot_ai: "#4c78d8",
  openai: "#5c86b3",
  xai: "#918f94",
  z_ai: "#a9826b",
} as const;

const elevatedProfiles = new Set(["high", "xhigh", "max"]);
const visualClassDensity: Readonly<Record<ModelCardVisualClass, ModelCardIlluminationDensity>> = {
  fast: 2,
  max: 5,
  standard: 1,
  thinking: 3,
};

function profileDensity(profileSlug: string): ModelCardIlluminationDensity {
  if (profileSlug === "max") return 5;
  if (profileSlug === "xhigh") return 4;
  if (profileSlug === "high") return 3;
  if (profileSlug === "medium") return 2;
  return 1;
}

/** Keeps provider identity, model energy, and ornamental density on separate visual axes. */
export function modelCardArtDirection(
  providerId: string,
  visualClass: ModelCardVisualClass,
  profileSlug: string,
): ModelCardArtDirection {
  let accentFamily: ModelCardAccentFamily = "base";

  if (visualClass === "max" || elevatedProfiles.has(profileSlug)) {
    accentFamily = "elevated";
  } else if (visualClass === "thinking") {
    accentFamily = "thinking";
  } else if (visualClass === "fast") {
    accentFamily = "fast";
  }

  const illuminationDensity = Math.max(
    visualClassDensity[visualClass],
    profileDensity(profileSlug),
  ) as ModelCardIlluminationDensity;
  const providerColor = modelCardProviderColors[
    providerId as keyof typeof modelCardProviderColors
  ] ?? fallbackProviderColor(providerId);

  return {
    accentFamily,
    illuminationDensity,
    providerColor,
    secondaryColor: modelCardSecondaryColors[accentFamily],
  };
}
