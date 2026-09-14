import {
  createSocialImageResponse,
  socialImageSize,
} from "@hraness/web-discovery/social-image";
import type { ImageResponse } from "next/og";

import { site } from "../site";

export const BLOG_IMAGE_SIZE = socialImageSize;

function renderBlogImage({
  description,
  title,
}: Readonly<{
  description: string;
  title: string;
}>): ImageResponse {
  return createSocialImageResponse({
    description,
    domain: `${site.domain}/blog`,
    eyebrow: "AI Charts benchmark analysis",
    theme: { accent: site.palette.chromatic.key },
    title,
  });
}

export function renderBlogCollectionImage(): ImageResponse {
  return renderBlogImage({
    description: "Sourced methods, results, and limits from AI evaluations.",
    title: "AI model and agent benchmark analysis",
  });
}
