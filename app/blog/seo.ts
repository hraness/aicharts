import type { ArticleLifecycle } from "@hraness/design-kit";
import {
  absoluteWebUrl,
  articleJsonLd,
  createArticleMetadata,
  createPublicSiteMetadata,
  INDEXABLE_ROBOTS,
  NOINDEX_ROBOTS,
  type ArticleDiscovery,
} from "@hraness/web-discovery";
import type { Metadata } from "next";

import { searchSite, site } from "../site";
import {
  BLOG_ARTICLE_AUTHOR,
  BLOG_SOURCES,
  blogArticleSection,
  blogArticlePath,
  blogDescription,
  type BlogArticle,
  type BlogSlug,
} from "./articles";
import {
  blogArticleLifecycle,
  indexableBlogArticles,
} from "./article-admissions";
import {
  blogEditorialImage,
  representativeEditorialImage,
  type BlogEditorialImage,
} from "./editorial-images";

export const BLOG_SOCIAL_IMAGE_PATH = "/blog/opengraph-image" as const;

export { BLOG_ARTICLE_AUTHOR };

const blogSearchSite = {
  ...searchSite,
  description: blogDescription,
  name: "AI Charts Blog",
  socialImage: {
    alt: "AI Charts analysis of AI model and agent benchmarks",
    path: BLOG_SOCIAL_IMAGE_PATH,
  },
  title: "AI model and agent benchmark analysis | AI Charts",
} as const;

const baseBlogCollectionMetadata = createPublicSiteMetadata(
  blogSearchSite,
  { canonicalPath: "/blog" },
);

export const blogCollectionMetadata: Metadata = {
  ...baseBlogCollectionMetadata,
  alternates: {
    ...baseBlogCollectionMetadata.alternates,
    types: {
      "application/atom+xml": absoluteWebUrl(searchSite.origin, "/blog/feed.xml"),
    },
  },
};

function isoDateTime(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function httpsCitation(url: string): `https://${string}` {
  if (!url.startsWith("https://")) {
    throw new TypeError(`Blog source URLs must be HTTPS citations: ${url}`);
  }
  return url as `https://${string}`;
}

/**
 * Projects one article and its checked editorial-image record into the shared
 * article-discovery contract. Live articles register a figure. The image-free
 * path below keeps every surface free of imagery when the lookup is omitted
 * or injected as null.
 */
function articleDiscovery(
  article: BlogArticle,
  image: BlogEditorialImage,
): ArticleDiscovery {
  const section = blogArticleSection(article);
  return {
    authors: [{ kind: "Organization", name: BLOG_ARTICLE_AUTHOR.name }],
    canonicalPath: blogArticlePath(article.slug),
    category: section,
    ...(article.sourceIds.length === 0 ? {} : {
      citations: article.sourceIds.map(
        sourceId => httpsCitation(BLOG_SOURCES[sourceId].url),
      ),
    }),
    description: article.seoDescription,
    image: representativeEditorialImage(image),
    isAccessibleForFree: true,
    isPartOfPath: "/",
    keywords: article.keywords,
    modifiedTime: isoDateTime(article.updatedAt),
    publishedTime: isoDateTime(article.publishedAt),
    publisher: { kind: "Organization", name: site.name, path: "/" },
    section,
    title: article.title,
    type: "BlogPosting",
  };
}

export function blogArticleImagePath(
  slug: BlogSlug,
): `/images/blog/${BlogSlug}.webp` | undefined {
  return blogEditorialImage(slug)?.socialSrc;
}

export function blogArticleMetadata(
  article: BlogArticle,
  editorialImage: BlogEditorialImage | null =
    blogEditorialImage(article.slug) ?? null,
  lifecycle: ArticleLifecycle = blogArticleLifecycle(article.slug),
): Metadata {
  const robots = lifecycle === "indexable" ? INDEXABLE_ROBOTS : NOINDEX_ROBOTS;
  if (editorialImage !== null) {
    const metadata = createArticleMetadata(
      searchSite,
      articleDiscovery(article, editorialImage),
    );
    return { ...metadata, creator: BLOG_ARTICLE_AUTHOR.name, robots };
  }
  const path = blogArticlePath(article.slug);
  const canonical = absoluteWebUrl(searchSite.origin, path);
  const section = blogArticleSection(article);

  return {
    title: article.title,
    description: article.seoDescription,
    alternates: { canonical },
    authors: [{ name: BLOG_ARTICLE_AUTHOR.name }],
    creator: BLOG_ARTICLE_AUTHOR.name,
    publisher: "AI Charts",
    category: section,
    openGraph: {
      type: "article",
      locale: "en_US",
      url: canonical,
      siteName: "AI Charts",
      title: article.title,
      description: article.seoDescription,
      publishedTime: isoDateTime(article.publishedAt),
      modifiedTime: isoDateTime(article.updatedAt),
      authors: [BLOG_ARTICLE_AUTHOR.name],
      section,
      tags: [...article.keywords],
    },
    robots,
    twitter: {
      card: "summary",
      title: article.title,
      description: article.seoDescription,
    },
  };
}

export function blogCollectionJsonLd(
  imageForSlug: (slug: BlogSlug) => BlogEditorialImage | undefined =
    blogEditorialImage,
) {
  const url = absoluteWebUrl(searchSite.origin, "/blog");
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    url,
    name: "AI model and agent benchmark analysis",
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
      numberOfItems: indexableBlogArticles.length,
      itemListElement: indexableBlogArticles.map((article, index) => {
        const editorialImage = imageForSlug(article.slug);
        return {
          "@type": "ListItem",
          position: index + 1,
          name: article.title,
          url: absoluteWebUrl(
            searchSite.origin,
            blogArticlePath(article.slug),
          ),
          ...(editorialImage === undefined ? {} : {
            image: absoluteWebUrl(searchSite.origin, editorialImage.src),
          }),
        };
      }),
    },
  } as const;
}

export function blogArticleJsonLd(
  article: BlogArticle,
  editorialImage: BlogEditorialImage | null =
    blogEditorialImage(article.slug) ?? null,
): Readonly<Record<string, unknown>> {
  if (editorialImage !== null) {
    return articleJsonLd(searchSite, articleDiscovery(article, editorialImage));
  }
  const path = blogArticlePath(article.slug);
  const url = absoluteWebUrl(searchSite.origin, path);
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
    datePublished: isoDateTime(article.publishedAt),
    dateModified: isoDateTime(article.updatedAt),
    author: {
      "@type": "Organization",
      name: BLOG_ARTICLE_AUTHOR.name,
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
    articleSection: blogArticleSection(article),
    keywords: article.keywords,
    ...(article.sourceIds.length === 0 ? {} : {
      citation: article.sourceIds.map(sourceId => BLOG_SOURCES[sourceId].url),
    }),
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
