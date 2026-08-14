import {
  absoluteWebUrl,
  createPublicSiteMetadata,
  INDEXABLE_ROBOTS,
} from "@/lib/web-discovery";
import type { Metadata } from "next";

import { searchSite, site } from "../site";
import {
  BLOG_SOURCES,
  blogArticlePath,
  blogArticles,
  blogDescription,
  type BlogArticle,
  type BlogSlug,
} from "./articles";

export const BLOG_SOCIAL_IMAGE_PATH = "/blog/opengraph-image" as const;

const blogSearchSite = {
  ...searchSite,
  description: blogDescription,
  name: "AI Charts Blog",
  socialImage: {
    alt: "AI Charts notes about coding agent benchmarks",
    path: BLOG_SOCIAL_IMAGE_PATH,
  },
  title: "Coding Agent Benchmark Notes | AI Charts",
} as const;

export const blogCollectionMetadata = createPublicSiteMetadata(
  blogSearchSite,
  { canonicalPath: "/blog" },
);

function isoDateTime(date: string): string {
  return `${date}T00:00:00.000Z`;
}

export function blogArticleImagePath(
  slug: BlogSlug,
): `/blog/${BlogSlug}/opengraph-image` {
  return `${blogArticlePath(slug)}/opengraph-image`;
}

export function blogArticleMetadata(article: BlogArticle): Metadata {
  const path = blogArticlePath(article.slug);
  const canonical = absoluteWebUrl(searchSite.origin, path);
  const image = absoluteWebUrl(
    searchSite.origin,
    blogArticleImagePath(article.slug),
  );
  const imageAlt = `${article.title} | AI Charts`;

  return {
    title: article.title,
    description: article.seoDescription,
    alternates: { canonical },
    authors: [{
      name: "AI Charts",
      url: absoluteWebUrl(searchSite.origin, "/blog"),
    }],
    creator: "AI Charts",
    publisher: "AI Charts",
    category: "Coding agent benchmarks",
    openGraph: {
      type: "article",
      locale: "en_US",
      url: canonical,
      siteName: "AI Charts",
      title: article.title,
      description: article.seoDescription,
      publishedTime: isoDateTime(article.publishedAt),
      modifiedTime: isoDateTime(article.updatedAt),
      authors: [absoluteWebUrl(searchSite.origin, "/blog")],
      section: "Coding agent benchmarks",
      tags: [...article.keywords],
      images: [{
        alt: imageAlt,
        height: 630,
        url: image,
        width: 1200,
      }],
    },
    robots: INDEXABLE_ROBOTS,
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description: article.seoDescription,
      images: [{ alt: imageAlt, url: image }],
    },
  };
}

export function blogCollectionJsonLd() {
  const url = absoluteWebUrl(searchSite.origin, "/blog");
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    url,
    name: "Coding agent benchmark notes",
    description: blogDescription,
    inLanguage: "en-US",
    primaryImageOfPage: absoluteWebUrl(
      searchSite.origin,
      BLOG_SOCIAL_IMAGE_PATH,
    ),
    isPartOf: {
      "@id": `${absoluteWebUrl(searchSite.origin, "/")}#website`,
    },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: blogArticles.length,
      itemListElement: blogArticles.map((article, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: article.title,
        url: absoluteWebUrl(
          searchSite.origin,
          blogArticlePath(article.slug),
        ),
      })),
    },
  } as const;
}

export function blogArticleJsonLd(article: BlogArticle) {
  const path = blogArticlePath(article.slug);
  const url = absoluteWebUrl(searchSite.origin, path);
  const blogUrl = absoluteWebUrl(searchSite.origin, "/blog");
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
    headline: article.title,
    description: article.seoDescription,
    image: absoluteWebUrl(
      searchSite.origin,
      blogArticleImagePath(article.slug),
    ),
    datePublished: isoDateTime(article.publishedAt),
    dateModified: isoDateTime(article.updatedAt),
    author: {
      "@type": "Organization",
      name: "AI Charts",
      url: blogUrl,
    },
    publisher: {
      "@type": "Organization",
      name: site.name,
      url: absoluteWebUrl(searchSite.origin, "/"),
    },
    isPartOf: {
      "@id": `${absoluteWebUrl(searchSite.origin, "/")}#website`,
    },
    isAccessibleForFree: true,
    inLanguage: "en-US",
    articleSection: "Coding agent benchmarks",
    keywords: article.keywords,
    citation: article.sourceIds.map(sourceId => BLOG_SOURCES[sourceId].url),
  } as const;
}

export function breadcrumbJsonLd(
  items: readonly Readonly<{ name: string; path: `/${string}` }>[],
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteWebUrl(searchSite.origin, item.path),
    })),
  } as const;
}
