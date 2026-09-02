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
    <section aria-labelledby="home-editorial-title" className="home-editorial">
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
          return (
            <article key={slug}>
              {editorialImage === undefined ? null : (
                <Link aria-label={article.title} href={blogArticlePath(slug)}>
                  <EditorialFigure image={editorialImage} variant="card" />
                </Link>
              )}
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
