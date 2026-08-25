import { describe, expect, test } from "bun:test";
import { INDEXABLE_ROBOTS } from "@hraness/web-discovery";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  aaIndexCostEfficiencyRows,
  aaIndexCostFrontier,
  codingAgentSnapshotRows,
  formatSnapshotCostUsd,
  formatSnapshotScore,
} from "@/lib/coding-agent-snapshot-rows";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";

import nextConfig from "../../next.config";
import sitemap from "../sitemap";
import BlogArticlePage, {
  generateMetadata,
  generateStaticParams,
} from "./[slug]/page";
import { ArticleBody } from "./article-body";
import {
  BLOG_SLUGS,
  BLOG_SOURCES,
  articleToMarkdown,
  articleWordCount,
  blogArticlePath,
  blogArticles,
  blogDescription,
  getBlogArticle,
  headingId,
} from "./articles";
import BlogLayout from "./layout";
import BlogIndex from "./page";
import {
  BLOG_SOCIAL_IMAGE_PATH,
  blogArticleImagePath,
  blogArticleJsonLd,
  blogArticleMetadata,
  blogCollectionJsonLd,
  breadcrumbJsonLd,
} from "./seo";

describe("AI Charts benchmark notes", () => {
  test("uses the shared publication shell with chart discovery", () => {
    const markup = renderToStaticMarkup(
      createElement(
        BlogLayout,
        null,
        createElement("main", { id: "blog-content" }, "Articles"),
      ),
    );

    expect(markup).toContain(
      'class="plain-site plain-publication aicharts-blog"',
    );
    expect(markup).toContain('class="ui-skip-link"');
    expect(markup).toContain('class="plain-header__inner"');
    expect(markup).toContain('class="plain-wordmark" href="/"');
    expect(markup).toContain('class="plain-nav"');
    expect(markup).toContain('href="/blog"');
    expect(markup).toContain('href="/"');
    expect(markup.match(/data-presentation="menu"/gu)).toHaveLength(1);
    const headerStart = markup.indexOf('<header class="plain-header">');
    const headerEnd = markup.indexOf("</header>", headerStart);
    const actionsStart = markup.indexOf(
      'class="plain-header__actions"',
      headerStart,
    );
    const navigationStart = markup.indexOf(
      'aria-label="Blog navigation"',
      actionsStart,
    );
    const navigationEnd = markup.indexOf("</nav>", navigationStart);
    const appearance = markup.indexOf('data-presentation="menu"', actionsStart);
    expect(headerStart).toBeGreaterThan(-1);
    expect(actionsStart).toBeGreaterThan(headerStart);
    expect(navigationStart).toBeGreaterThan(actionsStart);
    expect(navigationEnd).toBeGreaterThan(navigationStart);
    expect(appearance).toBeGreaterThan(navigationEnd);
    expect(appearance).toBeLessThan(headerEnd);
    expect(markup.slice(navigationStart, navigationEnd))
      .not.toContain("hraness-design-theme-toggle");
    expect(markup.slice(appearance, headerEnd)).not.toContain("<a ");
    expect(markup).toContain('class="plain-footer"');
    expect(markup.slice(markup.indexOf('<footer class="plain-footer"')))
      .not.toContain("hraness-design-theme-toggle");
    expect(markup).toContain('aria-label="hraness"');
  });

  test("publishes substantial complementary articles", () => {
    expect(blogArticles).toHaveLength(3);
    expect(blogArticles.map(article => article.slug)).toEqual([...BLOG_SLUGS]);
    expect(new Set(BLOG_SLUGS).size).toBe(BLOG_SLUGS.length);

    for (const article of blogArticles) {
      expect(article.title.length).toBeLessThanOrEqual(64);
      expect(article.seoDescription.length).toBeGreaterThanOrEqual(120);
      expect(article.seoDescription.length).toBeLessThanOrEqual(160);
      expect(articleWordCount(article)).toBeGreaterThanOrEqual(800);
      expect(articleToMarkdown(article)).toContain(`# ${article.title}`);
      expect(articleToMarkdown(article)).toContain(article.dek);
      expect(article.sourceIds.length).toBeGreaterThanOrEqual(1);
      expect(article.relatedSlugs).toHaveLength(1);
      if (article.slug === "aa-index-cost-coding-agents") {
        expect(article.publishedAt).toBe("2026-08-22");
        expect(article.updatedAt >= article.publishedAt).toBeTrue();
      } else {
        expect(article.publishedAt).toBe("2026-08-04");
        expect(article.updatedAt).toBe("2026-08-04");
      }

      const headings = article.body
        .filter(block => block.type === "heading")
        .map(block => headingId(block.text));
      expect(headings.length).toBeGreaterThanOrEqual(5);
      expect(new Set(headings).size).toBe(headings.length);

      for (const sourceId of article.sourceIds) {
        expect(BLOG_SOURCES[sourceId]).toBeDefined();
      }
      for (const relatedSlug of article.relatedSlugs) {
        expect(BLOG_SLUGS).toContain(relatedSlug);
        expect(relatedSlug).not.toBe(article.slug);
      }
      for (const block of article.body) {
        if (block.type !== "table") continue;
        expect(block.columns.length).toBeGreaterThanOrEqual(2);
        expect(block.rows.length).toBeGreaterThanOrEqual(2);
        for (const row of block.rows) {
          expect(row.length).toBe(block.columns.length);
        }
      }
    }
  });

  test("derives the AA Index versus cost note from the checked snapshot", () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const article = getBlogArticle("aa-index-cost-coding-agents");
    expect(article).toBeDefined();
    if (article === undefined) return;

    const markup = renderToStaticMarkup(
      createElement(ArticleBody, { blocks: article.body }),
    );
    const leaders = codingAgentSnapshotRows(parsed.value.records).slice(0, 10);
    const frontier = aaIndexCostFrontier(parsed.value.records);
    const efficiency = aaIndexCostEfficiencyRows(parsed.value.records).slice(0, 10);

    expect(markup).toContain(parsed.value.source.url);
    expect(markup).toContain(formatRetrievedAt(parsed.value.source.retrievedAt));
    expect(leaders[0]).toBeDefined();
    for (const row of [...leaders, ...frontier.map(point => ({
      model: point.record.model,
      agent: point.record.agent,
      setting: point.record.setting,
      aaIndex: point.yValue,
      costUsd: point.xValue,
    })), ...efficiency.map(row => ({
      model: row.record.model,
      agent: row.record.agent,
      setting: row.record.setting,
      aaIndex: row.aaIndex,
      costUsd: row.costUsd,
    }))]) {
      expect(markup).toContain(row.model);
      expect(markup).toContain(row.agent);
      expect(markup).toContain(row.setting);
      expect(markup).toContain(formatSnapshotScore(row.aaIndex));
      expect(markup).toContain(formatSnapshotCostUsd(row.costUsd));
    }
  });

  test("keeps sources unique, descriptive, and HTTPS-only", () => {
    const sources = Object.values(BLOG_SOURCES);
    expect(new Set(sources.map(source => source.url)).size).toBe(sources.length);
    for (const source of sources) {
      expect(source.note.length).toBeGreaterThan(50);
      expect(new URL(source.url).protocol).toBe("https:");
    }
  });

  test("renders semantic article content with crawlable primary sources", () => {
    const markup = blogArticles.map(article =>
      renderToStaticMarkup(
        createElement(ArticleBody, { blocks: article.body }),
      )).join("\n");

    expect(markup).toContain("<h2");
    expect(markup).toContain("<aside");
    expect(markup).toContain("<ul");
    expect(markup).toContain("<table");
    expect(markup).toContain('scope="row"');
    expect(markup).toContain(`href="${BLOG_SOURCES.mirrorCode.url}"`);
    expect(markup).toContain(`href="${BLOG_SOURCES.slopCodeBench.url}"`);
    expect(markup).toContain(`href="${BLOG_SOURCES.artificialAnalysisCodingAgents.url}"`);
  });

  test("renders the index, static routes, breadcrumbs, dates, and sources", async () => {
    const indexMarkup = renderToStaticMarkup(createElement(BlogIndex));
    expect(indexMarkup).toContain("AI model and agent benchmark analysis");
    expect(indexMarkup).toContain(blogDescription);
    expect(indexMarkup).toContain("The first collection focuses on coding agents.");
    expect(indexMarkup).toContain("Explore the coding-agent chart");
    expect(indexMarkup).toContain("Method");
    for (const article of blogArticles) {
      expect(indexMarkup).toContain(`href="${blogArticlePath(article.slug)}"`);

      const page = await BlogArticlePage({
        params: Promise.resolve({ slug: article.slug }),
      });
      const markup = renderToStaticMarkup(page);
      expect(markup).toContain(
        'class="plain-publication__breadcrumbs"',
      );
      expect(markup).toContain(
        `<span aria-current="page">${article.title}</span>`,
      );
      expect(markup).toContain(`dateTime="${article.publishedAt}"`);
      expect(markup).toContain("Current comparison: coding agents");
      for (const sourceId of article.sourceIds) {
        expect(markup).toContain(`href="${BLOG_SOURCES[sourceId].url}"`);
      }
    }

    expect(generateStaticParams()).toEqual(
      blogArticles.map(article => ({ slug: article.slug })),
    );
    expect(getBlogArticle("not-an-article")).toBeUndefined();
  });

  test("layers shared controls below repository-owned publication CSS", async () => {
    const [globals, publication] = await Promise.all([
      Bun.file(new URL("../globals.css", import.meta.url)).text(),
      Bun.file(new URL("../../styles/plain-publication.css", import.meta.url)).text(),
    ]);
    expect(globals).toStartWith('@import "@hraness/design-kit/styles.css";');
    expect(globals).toContain('@import "../styles/plain-site.css";');
    expect(globals).toContain('@import "../styles/plain-publication.css";');
    expect(publication).toContain(".plain-site.plain-publication");
  });
});

describe("AI Charts blog discovery", () => {
  test("keeps dynamic article images independent of monorepo files", () => {
    expect(nextConfig.outputFileTracingIncludes).toBeUndefined();
  });

  test("aligns article canonicals, social images, and static metadata", async () => {
    for (const article of blogArticles) {
      const path = blogArticlePath(article.slug);
      const metadata = blogArticleMetadata(article);
      const generated = await generateMetadata({
        params: Promise.resolve({ slug: article.slug }),
      });
      const image = `https://aicharts.io${blogArticleImagePath(article.slug)}`;

      expect(generated).toEqual(metadata);
      expect(metadata.title).toBe(article.title);
      expect(metadata.description).toBe(article.seoDescription);
      expect(metadata.alternates).toEqual({
        canonical: `https://aicharts.io${path}`,
      });
      expect(metadata.openGraph).toMatchObject({
        type: "article",
        url: `https://aicharts.io${path}`,
        title: article.title,
        description: article.seoDescription,
        publishedTime: `${article.publishedAt}T00:00:00.000Z`,
        modifiedTime: `${article.updatedAt}T00:00:00.000Z`,
        images: [{ height: 630, url: image, width: 1200 }],
      });
      expect(metadata.twitter).toMatchObject({
        card: "summary_large_image",
        images: [{ url: image }],
      });
      expect(metadata.robots).toEqual(INDEXABLE_ROBOTS);
    }
  });

  test("publishes truthful collection, article, and breadcrumb schema", () => {
    const collection = blogCollectionJsonLd();
    expect(collection).toMatchObject({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "AI model and agent benchmark analysis",
      url: "https://aicharts.io/blog",
      primaryImageOfPage:
        "https://aicharts.io/blog/opengraph-image",
    });
    expect(collection.mainEntity.numberOfItems).toBe(blogArticles.length);

    for (const article of blogArticles) {
      const structured = blogArticleJsonLd(article);
      expect(structured).toMatchObject({
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: article.title,
        description: article.seoDescription,
        datePublished: `${article.publishedAt}T00:00:00.000Z`,
        dateModified: `${article.updatedAt}T00:00:00.000Z`,
        isAccessibleForFree: true,
      });
      expect(structured.citation).toEqual(
        article.sourceIds.map(sourceId => BLOG_SOURCES[sourceId].url),
      );
      expect(structured).not.toHaveProperty("review");
      expect(structured).not.toHaveProperty("aggregateRating");
    }

    expect(breadcrumbJsonLd([
      { name: "Home", path: "/" },
      { name: "Blog", path: "/blog" },
    ])).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { item: "https://aicharts.io/", position: 1 },
        { item: "https://aicharts.io/blog", position: 2 },
      ],
    });
  });

  test("lists every public blog route and social image in the sitemap", () => {
    const entries = sitemap();
    expect(entries.map(entry => entry.url)).toEqual([
      "https://aicharts.io/",
      "https://aicharts.io/data",
      "https://aicharts.io/gpt-subsidy",
      "https://aicharts.io/blog",
      ...blogArticles.map(article =>
        `https://aicharts.io${blogArticlePath(article.slug)}`),
    ]);

    const collection = entries.find(entry => entry.url.endsWith("/blog"));
    expect(collection?.images).toEqual([
      `https://aicharts.io${BLOG_SOCIAL_IMAGE_PATH}`,
    ]);
    for (const article of blogArticles) {
      const entry = entries.find(candidate =>
        candidate.url.endsWith(blogArticlePath(article.slug)));
      expect(entry?.lastModified).toBe(article.updatedAt);
      expect(entry?.images).toEqual([
        `https://aicharts.io${blogArticleImagePath(article.slug)}`,
      ]);
    }
  });

  test("emits a website identity and links the chart to the blog", async () => {
    const [layoutSource, chartSource] = await Promise.all([
      Bun.file(new URL("../layout.tsx", import.meta.url)).text(),
      Bun.file(
        new URL("../../components/coding-agent-explorer.tsx", import.meta.url),
      ).text(),
    ]);

    expect(layoutSource).toContain('"@type": "WebSite"');
    expect(chartSource).toContain('<LinkButton href="/blog"');
    expect(chartSource).toContain("Blog");
  });
});
