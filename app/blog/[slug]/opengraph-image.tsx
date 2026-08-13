import { notFound } from "next/navigation";
import type { ImageResponse } from "next/og";

import {
  BLOG_IMAGE_SIZE,
  renderBlogArticleImage,
} from "../article-image";
import { getBlogArticle } from "../articles";

export const size = BLOG_IMAGE_SIZE;
export const contentType = "image/png";
export const alt = "CodingChart benchmark article cover";

export default async function OpenGraphImage({
  params,
}: Readonly<{
  params: Promise<{ slug: string }>;
}>): Promise<ImageResponse> {
  const { slug } = await params;
  const article = getBlogArticle(slug);
  if (article === undefined) notFound();
  return renderBlogArticleImage(article);
}
