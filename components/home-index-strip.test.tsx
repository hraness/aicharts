import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  HOME_INDEX_STRIP_LIMIT,
  HomeIndexStrip,
  homeIndexStripPages,
} from "./home-index-strip";
import { formatIntelligenceIndex, INDEX_MODEL_PAGES } from "@/lib/index-model-pages";

describe("home Index strip", () => {
  test("renders at most four checked Index pages as square logo cards", () => {
    const pages = homeIndexStripPages();
    const markup = renderToStaticMarkup(createElement(HomeIndexStrip));

    expect(pages.length).toBeGreaterThan(0);
    expect(pages.length).toBeLessThanOrEqual(HOME_INDEX_STRIP_LIMIT);
    expect(pages).toEqual(INDEX_MODEL_PAGES.slice(0, HOME_INDEX_STRIP_LIMIT));
    expect(markup).toContain('class="home-index-strip"');
    expect(markup).toContain('class="hraness-marketing-card-row home-index-strip__row"');
    expect(markup).toContain('id="home-index-strip-title"');
    expect(markup.match(/class="model-logo-card"/gu)).toHaveLength(pages.length);
    expect(markup).not.toContain("data-foil-card-deck");
    expect(markup).not.toContain("model-card-holographic");
    for (const page of pages) {
      expect(markup).toContain(`href="${page.path}"`);
      expect(markup).toContain(page.displayTitle);
      expect(markup).toContain(formatIntelligenceIndex(page.intelligenceIndex));
    }
  });

  test("rejects a non-positive strip limit", () => {
    expect(() => homeIndexStripPages(INDEX_MODEL_PAGES, 0)).toThrow(RangeError);
  });
});
