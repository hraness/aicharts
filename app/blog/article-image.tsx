import { socialImageSize } from "@hraness/web-discovery/social-image";
import type { ImageResponse } from "next/og";

import { aichartsSocialImage } from "../social-card";

export const BLOG_IMAGE_SIZE = socialImageSize;

function renderBlogImage({
  description,
  title,
}: Readonly<{
  description: string;
  title: string;
}>): ImageResponse {
  return aichartsSocialImage({
    description,
    eyebrow: "AI Charts benchmark analysis",
    title,
  });
}

export function renderBlogCollectionImage(): ImageResponse {
  return renderBlogImage({
    description: "Sourced methods, results, and limits from AI evaluations.",
    title: "AI model and agent benchmark analysis",
  });
}
