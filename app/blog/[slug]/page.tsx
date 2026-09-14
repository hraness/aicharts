import { Breadcrumbs } from "@/components/ui";
import { TrackedChartLink } from "@/components/tracked-chart-link";
import { JsonLdScript } from "@hraness/web-discovery/json-ld";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleBody } from "../article-body";
import { EditorialFigure } from "../editorial-figure";
import { blogEditorialImage } from "../editorial-images";
import {
  BLOG_SOURCES,
  blogArticleSection,
  articleReadingMinutes,
  blogArticlePath,
  blogArticles,
  getBlogArticle,
  headingId,
} from "../articles";
import {
  blogArticleJsonLd,
  blogArticleMetadata,
  breadcrumbJsonLd,
} from "../seo";

interface BlogArticlePageProps {
  readonly params: Promise<{ slug: string }>;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

function formatDate(date: string): string {
  return dateFormatter.format(new Date(`${date}T00:00:00.000Z`));
}

export const dynamicParams = false;

export function generateStaticParams() {
  return blogArticles.map(article => ({ slug: article.slug }));
}

export async function generateMetadata({
  params,
}: BlogArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = getBlogArticle(slug);
  return article === undefined ? {} : blogArticleMetadata(article);
}

export default async function BlogArticlePage({
  params,
}: BlogArticlePageProps) {
  const { slug } = await params;
  const article = getBlogArticle(slug);
  if (article === undefined) notFound();

  const relatedArticles = article.relatedSlugs
    .map(getBlogArticle)
    .filter(candidate => candidate !== undefined);
  const headings = article.body.flatMap(block =>
    block.type === "heading" && block.level === 2
      ? [{ text: block.text }]
      : []);
  const path = blogArticlePath(article.slug);
  const editorialImage = blogEditorialImage(article.slug);

  return (
    <main
      className="plain-publication__article"
      data-analytics-surface="blog_article"
      id="blog-content"
    >
      <JsonLdScript
        data={[
          blogArticleJsonLd(article),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Blog", path: "/blog" },
            { name: article.title, path },
          ]),
        ]}
        id="aicharts-blog-article-structured-data"
      />

      <header
        className="plain-publication__article-header plain-publication__shell"
        data-analytics-surface="blog_header"
      >
        <Breadcrumbs
          aria-label="Breadcrumb"
          className="plain-publication__breadcrumbs"
          items={[
            { href: "/", id: "aicharts", label: "AI Charts" },
            { href: "/blog", id: "blog", label: "Blog" },
            { id: article.slug, label: article.title },
          ]}
        />
        <h1>{article.title}</h1>
        <p className="plain-publication__article-dek">{article.dek}</p>
        <p className="plain-publication__article-meta">
          <span>By AI Charts · AI-assisted</span>
          <span aria-hidden="true"> · </span>
          <span>Published </span>
          <time dateTime={article.publishedAt}>
            {formatDate(article.publishedAt)}
          </time>
          {article.updatedAt === article.publishedAt ? null : (
            <>
              <span aria-hidden="true"> · </span>
              <span>Updated </span>
              <time dateTime={article.updatedAt}>
                {formatDate(article.updatedAt)}
              </time>
            </>
          )}
          <span aria-hidden="true"> · </span>
          <span>{articleReadingMinutes(article)} min read</span>
        </p>
        {editorialImage === undefined ? null : (
          <EditorialFigure image={editorialImage} preload />
        )}
      </header>

      <div className="plain-publication__article-layout plain-publication__shell">
        {headings.length === 0 ? null : (
          <nav aria-label="In this article" className="plain-publication__toc">
            <p>In this article</p>
            <ol>
              {headings.map(block => (
                <li key={block.text}>
                  <a href={`#${headingId(block.text)}`}>{block.text}</a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className="plain-publication__article-main">
          <ArticleBody blocks={article.body} />

          {article.nextStep === undefined && article.showChartCta !== false && (
            <aside className="plain-publication__cta">
              <h2>Current comparison: coding agents</h2>
              <p>
                Explore the current coding-agent dataset by benchmark score,
                task cost, time, and total token use.
              </p>
              <TrackedChartLink
                className="plain-publication__primary-link"
                sourceKind="blog_article"
              >
                Open the comparison chart <span aria-hidden="true">→</span>
              </TrackedChartLink>
            </aside>
          )}

          {article.nextStep === undefined ? null : (
            <aside className="plain-publication__cta">
              <h2>{article.nextStep.title}</h2>
              <p>{article.nextStep.description}</p>
              <nav aria-label={`${article.nextStep.title} links`}>
                <ul className="plain-publication__cta-links">
                  {article.nextStep.links.map(link => (
                    <li key={link.href}>
                      <Link className="plain-publication__primary-link" href={link.href}>
                        {link.label} <span aria-hidden="true">→</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </aside>
          )}

          {article.sourceIds.length === 0 ? null : (
            <section
              aria-labelledby="sources-title"
              className="plain-publication__sources"
            >
              <h2 id="sources-title">Sources</h2>
              <ol>
                {article.sourceIds.map(sourceId => {
                  const source = BLOG_SOURCES[sourceId];
                  return (
                    <li key={sourceId}>
                      <a href={source.url}>{source.title}</a>
                      <span>
                        {source.publication}, {source.year}. {source.note}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          <p className="plain-publication__disclosure">
            {article.authorshipDisclosure} {" "}
            Reported results apply to the named source, workload,
            configuration, and observation date. They do not establish
            performance on every task or product.
          </p>
        </div>
      </div>

      <footer
        className="plain-publication__related plain-publication__shell"
        data-analytics-surface="blog_related"
      >
        <div className="plain-publication__section-heading">
          <h2>Related analysis</h2>
          <Link href="/blog">All articles</Link>
        </div>
        <div className="plain-publication__related-grid">
          {relatedArticles.map(relatedArticle => (
            <Link
              href={blogArticlePath(relatedArticle.slug)}
              key={relatedArticle.slug}
            >
              <span>{blogArticleSection(relatedArticle)}</span>
              <strong>{relatedArticle.title}</strong>
            </Link>
          ))}
        </div>
      </footer>
    </main>
  );
}
