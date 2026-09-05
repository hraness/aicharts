import { EditorialFigure } from "@/app/blog/editorial-figure";
import {
  blogEditorialImage,
  type BlogEditorialImage,
} from "@/app/blog/editorial-images";
import {
  blogArticlePath,
  getBlogArticle,
  type BlogSlug,
} from "@/app/blog/articles";
import { HOME_EDITORIAL_SLUGS } from "@/app/blog/article-admissions";
import Link from "next/link";

export { HOME_EDITORIAL_SLUGS } from "@/app/blog/article-admissions";

interface HomeEditorialResourcesProps {
  readonly imageForSlug?: (slug: BlogSlug) => BlogEditorialImage | undefined;
}

export function HomeEditorialResources({
  imageForSlug = blogEditorialImage,
}: HomeEditorialResourcesProps = {}) {
  return (
    <section
      aria-labelledby="home-editorial-title"
      className="home-editorial"
      data-analytics-surface="home_editorial"
    >
      <div className="home-editorial__heading">
        <div>
          <h2 id="home-editorial-title">Model and benchmark analysis</h2>
          <p>Sourced guides to model cost, benchmark trust, and long-horizon work.</p>
        </div>
        <Link href="/blog">All articles</Link>
      </div>
      <div className="home-editorial__grid">
        {HOME_EDITORIAL_SLUGS.map((slug) => {
          const article = getBlogArticle(slug);
          if (article === undefined) return null;
          const editorialImage = imageForSlug(slug);

          if (editorialImage === undefined) {
            return (
              <article
                className="home-editorial__item home-editorial__item--text"
                key={slug}
              >
                <Link
                  className="home-editorial__text-card"
                  href={blogArticlePath(slug)}
                >
                  <span>{article.section ?? "Analysis"}</span>
                  <h3>{article.title}</h3>
                  <p>{article.dek}</p>
                </Link>
              </article>
            );
          }

          return (
            <article
              className="home-editorial__item home-editorial__item--image"
              key={slug}
            >
              <Link
                aria-label={article.title}
                className="home-editorial__image-link"
                href={blogArticlePath(slug)}
              >
                <EditorialFigure image={editorialImage} variant="card" />
              </Link>
              <h3>
                <Link href={blogArticlePath(slug)}>{article.title}</Link>
              </h3>
            </article>
          );
        })}
      </div>
    </section>
  );
}
