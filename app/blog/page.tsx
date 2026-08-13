import { JsonLdScript } from "@/components/structured-data";
import type { Metadata } from "next";
import Link from "next/link";

import {
  articleReadingMinutes,
  blogArticlePath,
  blogArticles,
  blogDescription,
} from "./articles";
import {
  blogCollectionJsonLd,
  blogCollectionMetadata,
  breadcrumbJsonLd,
} from "./seo";

export const metadata: Metadata = blogCollectionMetadata;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

function formatDate(date: string): string {
  return dateFormatter.format(new Date(`${date}T00:00:00.000Z`));
}

export default function BlogIndex() {
  return (
    <main className="plain-publication__index" id="blog-content">
      <JsonLdScript
        data={[
          blogCollectionJsonLd(),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Blog", path: "/blog" },
          ]),
        ]}
        id="codingchart-blog-collection-structured-data"
      />

      <div className="plain-publication__shell plain-publication__index-content">
        <header className="plain-publication__hero">
          <h1>Coding agent benchmark notes</h1>
          <p>{blogDescription}</p>
          <Link className="plain-publication__primary-link" href="/">
            Open the comparison chart <span aria-hidden="true">→</span>
          </Link>
        </header>

        <section
          aria-labelledby="benchmark-articles"
          className="plain-publication__list"
        >
          <div className="plain-publication__section-heading">
            <h2 id="benchmark-articles">Articles</h2>
            <p>{blogArticles.length} sourced benchmark summaries</p>
          </div>
          <div className="plain-publication__article-list">
            {blogArticles.map(article => (
              <article className="plain-publication__entry" key={article.slug}>
                <h3>
                  <Link href={blogArticlePath(article.slug)}>
                    {article.title}
                  </Link>
                </h3>
                <p>{article.dek}</p>
                <p className="plain-publication__entry-meta">
                  <time dateTime={article.publishedAt}>
                    {formatDate(article.publishedAt)}
                  </time>
                  <span aria-hidden="true"> · </span>
                  <span>{articleReadingMinutes(article)} min read</span>
                </p>
              </article>
            ))}
          </div>
        </section>

        <section
          aria-labelledby="editorial-method-title"
          className="plain-publication__method"
        >
          <h2 id="editorial-method-title">Method</h2>
          <div className="plain-publication__method-grid">
            <div>
              <h3>Sources</h3>
              <p>
                Each note starts with the benchmark paper or maintained source
                page. Material claims link to those primary sources.
              </p>
            </div>
            <div>
              <h3>Changing results</h3>
              <p>
                Leaderboard values are paired with their observation date and
                named configuration. They can change after publication.
              </p>
            </div>
            <div>
              <h3>Limits</h3>
              <p>
                Methodology limits and interpretation are kept near the results
                they qualify. Benchmark performance is not treated as a general
                production claim.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
