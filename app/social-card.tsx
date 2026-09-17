import { createSocialImageResponse } from "@hraness/web-discovery/social-image";
import type { ImageResponse } from "next/og";

import { AichartsMark } from "./aicharts-mark";
import { site } from "./site";

/**
 * Paper light surface tokens from app/globals.css keyed by the site accent.
 * Shared by every social card so the redesigned system stays uniform.
 */
const AICHARTS_SOCIAL_THEME = {
  accent: site.palette.chromatic.key,
  background: "#f8f7f4",
  foreground: "#1c1917",
  muted: "#6f6962",
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
