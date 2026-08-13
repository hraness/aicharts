import type { MetadataRoute } from "next";

import { blogArticlePath, blogArticles } from "./blog/articles";
import { BLOG_SOCIAL_IMAGE_PATH, blogArticleImagePath } from "./blog/seo";
import { site } from "./site";

export default function sitemap(): MetadataRoute.Sitemap {
  const absolute = (path: string) => new URL(path, site.origin).toString();
  return [
    { url: absolute("/"), changeFrequency: "daily", priority: 1 },
    {
      changeFrequency: "monthly",
      images: [absolute(BLOG_SOCIAL_IMAGE_PATH)],
      lastModified: "2026-08-04",
      priority: 0.8,
      url: absolute("/blog"),
    },
    ...blogArticles.map((article) => ({
      changeFrequency: "monthly" as const,
      images: [absolute(blogArticleImagePath(article.slug))],
      lastModified: article.updatedAt,
      priority: 0.7,
      url: absolute(blogArticlePath(article.slug)),
    })),
  ];
}
