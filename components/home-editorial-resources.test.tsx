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

test("renders an imaged card for every curated homepage article", () => {
  const markup = renderToStaticMarkup(createElement(HomeEditorialResources));

  expect(occurrences(markup, "home-editorial__item--text")).toBe(0);
  expect(occurrences(markup, "home-editorial__item--image")).toBe(
    HOME_EDITORIAL_SLUGS.length,
  );
  expect(occurrences(markup, "home-editorial__image-link")).toBe(
    HOME_EDITORIAL_SLUGS.length,
  );
  expect(occurrences(markup, "home-editorial__copy")).toBe(
    HOME_EDITORIAL_SLUGS.length,
  );
  expect(markup).not.toContain("home-editorial__text-card");
  for (const slug of HOME_EDITORIAL_SLUGS) {
    const card = getBlogArticle(slug);
    expect(card).toBeDefined();
    if (card === undefined) continue;
    expect(markup).toContain(`<p>${card.dek}</p>`);
    expect(markup).toContain(`href="/blog/${slug}"`);
  }
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
