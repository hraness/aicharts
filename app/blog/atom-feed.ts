import {
  absoluteWebUrl,
  createAtomImageEnclosure,
} from "@hraness/web-discovery";

import { searchSite } from "../site";
import {
  BLOG_SOURCES,
  blogArticlePath,
  blogDescription,
  type BlogArticle,
  type BlogSlug,
} from "./articles";
import { indexableBlogArticles } from "./article-admissions";
import {
  blogEditorialImage,
  representativeEditorialImage,
  type BlogEditorialImage,
} from "./editorial-images";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function isoDateTime(date: string): string {
  return `${date}T00:00:00.000Z`;
}

export function atomFeed(
  imageForSlug: (slug: BlogSlug) => BlogEditorialImage | undefined =
    blogEditorialImage,
  blogArticles: readonly BlogArticle[] = indexableBlogArticles,
): string {
  const blogUrl = absoluteWebUrl(searchSite.origin, "/blog");
  const feedUrl = absoluteWebUrl(searchSite.origin, "/blog/feed.xml");
  const updated = blogArticles.reduce(
    (latest, article) => article.updatedAt > latest ? article.updatedAt : latest,
    blogArticles[0]?.updatedAt ?? "2026-08-04",
  );
  const entries = blogArticles.map((article) => {
    const url = absoluteWebUrl(searchSite.origin, blogArticlePath(article.slug));
    const image = imageForSlug(article.slug);
    const imageUrl = image === undefined
      ? undefined
      : absoluteWebUrl(searchSite.origin, image.src);
    const enclosure = image === undefined
      ? undefined
      : createAtomImageEnclosure(
        searchSite.origin,
        representativeEditorialImage(image),
      );
    const categories = article.keywords
      .map(keyword => `<category term="${escapeXml(keyword)}" />`)
      .join("");
    return [
      "<entry>",
      `<id>${escapeXml(url)}</id>`,
      `<title>${escapeXml(article.title)}</title>`,
      `<link href="${escapeXml(url)}" rel="alternate" />`,
      ...(enclosure === undefined ? [] : [
        `<link href="${escapeXml(enclosure.href)}" rel="${enclosure.rel}" type="${enclosure.type}" />`,
      ]),
      `<published>${isoDateTime(article.publishedAt)}</published>`,
      `<updated>${isoDateTime(article.updatedAt)}</updated>`,
      `<summary type="text">${escapeXml(article.dek)}</summary>`,
      `<content type="html">${escapeXml(image === undefined || imageUrl === undefined
        ? `<p>${article.sourceNote}</p><p>${article.dek}</p>`
        : `<figure><img src="${imageUrl}" alt="${image.alt}"><figcaption>${image.caption}</figcaption></figure><p>${article.sourceNote}</p><p>${article.dek}</p>`)}</content>`,
      categories,
      ...article.sourceIds.map(sourceId => (
        `<link href="${escapeXml(BLOG_SOURCES[sourceId].url)}" rel="related" />`
      )),
      "</entry>",
    ].join("");
  }).join("");

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `<id>${escapeXml(blogUrl)}</id>`,
    "<title>AI Charts benchmark analysis</title>",
    `<subtitle>${escapeXml(blogDescription)}</subtitle>`,
    `<link href="${escapeXml(blogUrl)}" rel="alternate" />`,
    `<link href="${escapeXml(feedUrl)}" rel="self" type="application/atom+xml" />`,
    `<updated>${isoDateTime(updated)}</updated>`,
    "<author><name>Hraness</name></author>",
    entries,
    "</feed>",
  ].join("");
}
