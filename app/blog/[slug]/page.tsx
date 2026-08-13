import { Breadcrumbs } from "@/components/ui";
import { JsonLdScript } from "@/components/structured-data";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleBody } from "../article-body";
import {
  BLOG_SOURCES,
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

  return (
    <main className="plain-publication__article" id="blog-content">
      <JsonLdScript
        data={[
          blogArticleJsonLd(article),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Blog", path: "/blog" },
            { name: article.title, path },
          ]),
        ]}
        id="codingchart-blog-article-structured-data"
      />

      <header className="plain-publication__article-header plain-publication__shell">
        <Breadcrumbs
          aria-label="Breadcrumb"
          className="plain-publication__breadcrumbs"
          items={[
            { href: "/", id: "codingchart", label: "CodingChart" },
            { href: "/blog", id: "blog", label: "Blog" },
            { id: article.slug, label: article.title },
          ]}
        />
        <h1>{article.title}</h1>
        <p className="plain-publication__article-dek">{article.dek}</p>
        <p className="plain-publication__article-meta">
          <span>By CodingChart</span>
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
      </header>

      <div className="plain-publication__article-layout plain-publication__shell">
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

        <div className="plain-publication__article-main">
          <ArticleBody blocks={article.body} />

          <aside className="plain-publication__cta">
            <h2>Artificial Analysis chart</h2>
            <p>
              Compare current coding models by benchmark score, task cost,
              time, and total token use.
            </p>
            <Link className="plain-publication__primary-link" href="/">
              Open the comparison chart <span aria-hidden="true">→</span>
            </Link>
          </aside>

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

          <p className="plain-publication__disclosure">
            Results describe the named model, harness, task set, budget, and
            evaluation version. They do not establish performance on every
            production repository.
          </p>
        </div>
      </div>

      <footer className="plain-publication__related plain-publication__shell">
        <div className="plain-publication__section-heading">
          <h2>Related benchmark note</h2>
          <Link href="/blog">All articles</Link>
        </div>
        <div className="plain-publication__related-grid">
          {relatedArticles.map(relatedArticle => (
            <Link
              href={blogArticlePath(relatedArticle.slug)}
              key={relatedArticle.slug}
            >
              <span>Coding agent benchmark</span>
              <strong>{relatedArticle.title}</strong>
            </Link>
          ))}
        </div>
      </footer>
    </main>
  );
}
