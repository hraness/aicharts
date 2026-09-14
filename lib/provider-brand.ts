import { providerColors } from "./chart-colors.generated";
import { lobeModelIconDataUrls } from "./model-card-icons.generated";

/**
 * Visual identity for one model creator or provider inside compact pickers.
 * The chip color comes from the generated chart palette when the provider is
 * charted, the icon is a pinned Lobe glyph rendered through a CSS mask so the
 * glyph color can guarantee contrast, and the monogram covers providers
 * without a pinned icon.
 */
export type ProviderBrand = Readonly<{
  chipColor: string;
  glyphColor: string;
  iconUrl: string | null;
  monogram: string;
}>;

type LobeIconKey = keyof typeof lobeModelIconDataUrls;

type BrandIdentity = Readonly<{
  iconKey: LobeIconKey | null;
  providerId: keyof typeof providerColors;
}>;

const DARK_GLYPH = "#1c1917";
const LIGHT_GLYPH = "#f7f6f2";
const FALLBACK_CHIP_COLOR = "#6f6962";

/**
 * Charted providers by folded alias. Benchmark sources disagree on naming
 * ("SpaceXAI", "xAI", "Z.AI", "Z AI", "Kimi", "Moonshot AI"), so aliases fold
 * to lowercase alphanumerics before lookup.
 */
const brandIdentitiesByAlias: Readonly<Record<string, BrandIdentity>> = {
  alibaba: { iconKey: "alibabacloud", providerId: "alibaba_cloud" },
  alibabacloud: { iconKey: "alibabacloud", providerId: "alibaba_cloud" },
  anthropic: { iconKey: "claude", providerId: "anthropic" },
  claude: { iconKey: "claude", providerId: "anthropic" },
  cognition: { iconKey: null, providerId: "cognition" },
  cursor: { iconKey: "cursor", providerId: "cursor" },
  deepseek: { iconKey: "deepseek", providerId: "deepseek" },
  gemini: { iconKey: "gemini", providerId: "google" },
  google: { iconKey: "gemini", providerId: "google" },
  googledeepmind: { iconKey: "gemini", providerId: "google" },
  kimi: { iconKey: "moonshot", providerId: "moonshot_ai" },
  meta: { iconKey: "meta", providerId: "meta" },
  moonshot: { iconKey: "moonshot", providerId: "moonshot_ai" },
  moonshotai: { iconKey: "moonshot", providerId: "moonshot_ai" },
  nvidia: { iconKey: "nvidia", providerId: "nvidia" },
  openai: { iconKey: "openai", providerId: "openai" },
  spacexai: { iconKey: "xai", providerId: "xai" },
  xai: { iconKey: "xai", providerId: "xai" },
  zai: { iconKey: "zai", providerId: "z_ai" },
};

function foldedBrandAlias(identity: string): string {
  return identity.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

/** Perceived brightness (0-255) from the YIQ transform of one hex color. */
function perceivedBrightness(hexColor: string): number | null {
  const match = /^#(?<red>[0-9a-f]{2})(?<green>[0-9a-f]{2})(?<blue>[0-9a-f]{2})$/u
    .exec(hexColor.toLowerCase());
  if (match?.groups === undefined) return null;
  const red = Number.parseInt(match.groups.red ?? "0", 16);
  const green = Number.parseInt(match.groups.green ?? "0", 16);
  const blue = Number.parseInt(match.groups.blue ?? "0", 16);
  return (red * 299 + green * 587 + blue * 114) / 1000;
}

/** Chooses a glyph color that stays readable on the given chip color. */
export function chipGlyphColor(chipColor: string): string {
  const brightness = perceivedBrightness(chipColor);
  return brightness !== null && brightness > 160 ? DARK_GLYPH : LIGHT_GLYPH;
}

export function brandMonogram(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean);
  const monogram = words
    .slice(0, 2)
    .map(word => word[0] ?? "")
    .join("")
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]/gu, "")
    .slice(0, 2);
  return monogram || "AI";
}

/**
 * Resolves picker visuals for a provider. Any identity (display name, source
 * slug) may match the alias table; the first identity is also the display
 * name that seeds the monogram fallback.
 */
export function providerBrand(
  displayName: string,
  ...additionalIdentities: readonly string[]
): ProviderBrand {
  let identity: BrandIdentity | null = null;
  for (const candidate of [displayName, ...additionalIdentities]) {
    const matched = brandIdentitiesByAlias[foldedBrandAlias(candidate)];
    if (matched !== undefined) {
      identity = matched;
      break;
    }
  }
  const chipColor = identity === null
    ? FALLBACK_CHIP_COLOR
    : providerColors[identity.providerId];
  return {
    chipColor,
    glyphColor: chipGlyphColor(chipColor),
    iconUrl: identity?.iconKey == null ? null : lobeModelIconDataUrls[identity.iconKey],
    monogram: brandMonogram(displayName),
  };
}
