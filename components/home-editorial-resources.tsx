import { EditorialFigure } from "@/app/blog/editorial-figure";
import { blogEditorialImage } from "@/app/blog/editorial-images";
import {
  blogArticlePath,
  getBlogArticle,
  type BlogSlug,
} from "@/app/blog/articles";
import Link from "next/link";

export const HOME_EDITORIAL_SLUGS = [
  "small-models-have-arrived",
  "coding-agent-score-holdouts",
  "mirrorcode-coding-agent-benchmark",
] as const satisfies readonly BlogSlug[];

export function HomeEditorialResources() {
  return (
    <section aria-labelledby="home-editorial-title" className="home-editorial">
      <div className="home-editorial__heading">
        <div>
          <h2 id="home-editorial-title">Model and benchmark analysis</h2>
          <p>Three sourced guides to model cost, benchmark trust, and long-horizon work.</p>
        </div>
        <Link href="/blog">All articles</Link>
      </div>
      <div className="home-editorial__grid">
        {HOME_EDITORIAL_SLUGS.map((slug, index) => {
          const article = getBlogArticle(slug);
          if (article === undefined) return null;
          return (
            <article key={slug}>
              <Link aria-label={article.title} href={blogArticlePath(slug)}>
                <EditorialFigure
                  image={blogEditorialImage(slug)}
                  preload={index === 0}
                  variant="card"
                />
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
