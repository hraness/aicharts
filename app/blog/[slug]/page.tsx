import type { Metadata } from "next";

import { BlogArticlePage } from "../blog-article-page";
import {
  blogArticles,
  getBlogArticle,
} from "../articles";
import { blogArticleMetadata } from "../seo";

interface BlogArticleRouteProps {
  readonly params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return blogArticles.map(article => ({ slug: article.slug }));
}

export async function generateMetadata({
  params,
}: BlogArticleRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const article = getBlogArticle(slug);
  return article === undefined ? {} : blogArticleMetadata(article);
}

export default async function BlogArticleRoute({
  params,
}: BlogArticleRouteProps) {
  return BlogArticlePage({ params });
}
