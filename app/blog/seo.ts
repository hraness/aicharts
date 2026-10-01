import { articleVideoJsonLd, type ArticleLifecycle } from "@hraness/design-kit";
import {
  absoluteWebUrl,
  articleJsonLd,
  createArticleMetadata,
  createPublicSiteMetadata,
  INDEXABLE_ROBOTS,
  NOINDEX_ROBOTS,
  type ArticleDiscovery,
  type ArticleParty,
} from "@hraness/web-discovery";
import type { Metadata } from "next";

import { searchSite, site } from "../site";
import { aichartsSocialImageAlt, blogCollectionSocialImagePage } from "../social-image-site";
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

const BLOG_ARTICLE_AUTHOR_PARTY: ArticleParty = {
  kind: "Organization",
  name: BLOG_ARTICLE_AUTHOR.name,
  sameAs: ["https://github.com/hraness"],
  url: "https://hraness.com",
};

/** The Hraness organization node that hraness.com defines; linked by @id rather than redefined. */
export const HRANESS_ORGANIZATION_ID = "https://hraness.com/#organization" as const;

/**
 * One node for both the author and the publisher. Its url and logo match the
 * node hraness.com publishes under the same @id, so a consumer that merges the
 * two graphs sees one consistent organization.
 */
export const BLOG_PUBLISHER_JSON_LD = {
  "@type": "Organization",
  "@id": HRANESS_ORGANIZATION_ID,
  name: BLOG_ARTICLE_AUTHOR.name,
  url: "https://hraness.com/",
  logo: "https://hraness.com/icon.png",
  sameAs: BLOG_ARTICLE_AUTHOR_PARTY.sameAs,
} as const;

/**
 * The pinned shared builder cannot emit @id on parties, so the article node is
 * post-processed here: the Hraness author and the publisher both become the
 * Hraness organization node.
 */
function linkHranessParties(
  jsonLd: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const withId = (party: unknown) => (
    typeof party === "object" && party !== null
      && (party as { name?: unknown }).name === BLOG_ARTICLE_AUTHOR.name
      ? BLOG_PUBLISHER_JSON_LD
      : party
  );
  const author = jsonLd.author;
  return {
    ...jsonLd,
    author: Array.isArray(author) ? author.map(withId) : withId(author),
    publisher: BLOG_PUBLISHER_JSON_LD,
  };
}

const blogSearchSite = {
  ...searchSite,
  description: blogDescription,
  name: "aicharts blog",
  socialImage: {
    alt: aichartsSocialImageAlt(blogCollectionSocialImagePage),
    path: BLOG_SOCIAL_IMAGE_PATH,
  },
  title: "AI model and agent benchmark analysis | aicharts",
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
    authors: [BLOG_ARTICLE_AUTHOR_PARTY],
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
    publisher: "aicharts",
    category: section,
    openGraph: {
      type: "article",
      locale: "en_US",
      url: canonical,
      siteName: "aicharts",
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
    primaryImageOfPage: {
      "@type": "ImageObject",
      url: absoluteWebUrl(searchSite.origin, BLOG_SOCIAL_IMAGE_PATH),
    },
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

/** The post's first film, as a schema.org VideoObject, or nothing when it has none. */
function blogArticleVideoJsonLd(article: BlogArticle): Readonly<Record<string, unknown>> {
  for (const block of article.body) {
    if (block.type === "video") return { video: articleVideoJsonLd(block.video, searchSite.origin) };
  }
  return {};
}

export function blogArticleJsonLd(
  article: BlogArticle,
  editorialImage: BlogEditorialImage | null =
    blogEditorialImage(article.slug) ?? null,
): Readonly<Record<string, unknown>> {
  return { ...blogPostingJsonLd(article, editorialImage), ...blogArticleVideoJsonLd(article) };
}

function blogPostingJsonLd(
  article: BlogArticle,
  editorialImage: BlogEditorialImage | null,
): Readonly<Record<string, unknown>> {
  if (editorialImage !== null) {
    return linkHranessParties(articleJsonLd(searchSite, articleDiscovery(article, editorialImage)));
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
    author: BLOG_PUBLISHER_JSON_LD,
    publisher: BLOG_PUBLISHER_JSON_LD,
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
