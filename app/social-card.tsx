import { paletteColors } from "@hraness/design-kit";
import { createSocialImageResponse } from "@hraness/web-discovery/social-image";
import type { ImageResponse } from "next/og";

import { AichartsMark } from "./aicharts-mark";
import { site } from "./site";

/**
 * Tokyo Night light surface tokens match the default application palette.
 * Shared by every social card so the redesigned system stays uniform.
 */
const AICHARTS_SOCIAL_THEME = {
  accent: site.palette.chromatic.key,
  background: paletteColors["tokyo-night"].light.background,
  foreground: paletteColors["tokyo-night"].light.foreground,
  muted: paletteColors["tokyo-night"].light.muted,
} as const;

export function aichartsSocialImage(
  details: Readonly<{
    description: string;
    eyebrow?: string;
    title: string;
  }>,
): ImageResponse {
  return createSocialImageResponse({
    description: details.description,
    domain: site.domain,
    eyebrow: details.eyebrow,
    mark: <AichartsMark />,
    theme: AICHARTS_SOCIAL_THEME,
    title: details.title,
  });
}
