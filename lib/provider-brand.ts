import { providerMark, providerMarkGlyphDataUri } from "@hraness/design-kit";
import { providerColors } from "./chart-colors.generated";

/**
 * Visual identity for one model creator or provider inside compact pickers.
 * The chip color comes from the generated chart palette when the provider is
 * charted, the icon is the shared design-kit provider glyph rendered through
 * a CSS mask so the glyph color can guarantee contrast, and the monogram
 * covers providers without a registered mark.
 */
export type ProviderBrand = Readonly<{
  chipColor: string;
  glyphColor: string;
  iconUrl: string | null;
  monogram: string;
}>;

const MASK_GLYPH_COLOR = "#f7f6f2";
const DARK_GLYPH = "#1c1917";
const LIGHT_GLYPH = "#f7f6f2";
const FALLBACK_CHIP_COLOR = "#6f6962";

/**
 * Charted providers by folded alias. Benchmark sources disagree on naming
 * ("SpaceXAI", "xAI", "Z.AI", "Z AI", "Kimi", "Moonshot AI"), so aliases fold
 * to lowercase alphanumerics before lookup. Only the chart palette binding
 * lives here; icon identity resolves through the shared provider-mark
 * registry.
 */
const providerIdsByAlias: Readonly<Record<string, keyof typeof providerColors>> = {
  alibaba: "alibaba_cloud",
  alibabacloud: "alibaba_cloud",
  anthropic: "anthropic",
  claude: "anthropic",
  cognition: "cognition",
  cursor: "cursor",
  deepseek: "deepseek",
  gemini: "google",
  google: "google",
  googledeepmind: "google",
  kimi: "moonshot_ai",
  meta: "meta",
  moonshot: "moonshot_ai",
  moonshotai: "moonshot_ai",
  nvidia: "nvidia",
  openai: "openai",
  spacexai: "xai",
  xai: "xai",
  zai: "z_ai",
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
  let providerId: keyof typeof providerColors | null = null;
  let iconUrl: string | null = null;
  for (const candidate of [displayName, ...additionalIdentities]) {
    if (providerId === null) {
      const matched = providerIdsByAlias[foldedBrandAlias(candidate)];
      if (matched !== undefined) providerId = matched;
    }
    if (iconUrl === null) {
      const mark = providerMark(candidate);
      if (mark !== undefined) {
        iconUrl = providerMarkGlyphDataUri(mark, MASK_GLYPH_COLOR);
      }
    }
  }
  const chipColor = providerId === null ? FALLBACK_CHIP_COLOR : providerColors[providerId];
  return {
    chipColor,
    glyphColor: chipGlyphColor(chipColor),
    iconUrl,
    monogram: brandMonogram(displayName),
  };
}
