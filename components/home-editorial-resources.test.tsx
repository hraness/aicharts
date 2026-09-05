import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getBlogArticle } from "@/app/blog/articles";

import {
  HOME_EDITORIAL_SLUGS,
  HomeEditorialResources,
} from "./home-editorial-resources";

function occurrences(markup: string, fragment: string): number {
  return markup.split(fragment).length - 1;
}

test("renders an intentional text card when an admitted article has no image", () => {
  const markup = renderToStaticMarkup(createElement(HomeEditorialResources));
  const article = getBlogArticle("small-models-have-arrived");

  expect(article).toBeDefined();
  if (article === undefined) return;

  expect(occurrences(markup, "home-editorial__item--text")).toBe(1);
  expect(occurrences(markup, "home-editorial__item--image")).toBe(2);
  expect(occurrences(markup, "home-editorial__image-link")).toBe(2);
  expect(markup).toContain(
    'class="home-editorial__text-card" href="/blog/small-models-have-arrived"',
  );
  expect(markup).toContain(`<span>${article.section}</span>`);
  expect(markup).toContain(`<h3>${article.title}</h3>`);
  expect(markup).toContain(`<p>${article.dek}</p>`);
  expect(markup).not.toContain('rel="preload"');
});

test("keeps every admitted article visible when all images are unavailable", () => {
  const markup = renderToStaticMarkup(
    HomeEditorialResources({ imageForSlug: () => undefined }),
  );

  expect(occurrences(markup, "home-editorial__item--text")).toBe(
    HOME_EDITORIAL_SLUGS.length,
  );
  expect(markup).not.toContain("home-editorial__item--image");
  expect(markup).not.toContain("home-editorial__image-link");
  for (const slug of HOME_EDITORIAL_SLUGS) {
    expect(markup).toContain(`href="/blog/${slug}"`);
  }
});
