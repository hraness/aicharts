import { expect, test } from "bun:test";

import { getBlogArticle } from "./articles";
import { INTRODUCING_AI_CHARTS_SLUG } from "./introducing-ai-charts-article";
import { blogArticleJsonLd } from "./seo";

test("the benchmark introduction retains its illustrations without the retired promo movie", () => {
  const article = getBlogArticle(INTRODUCING_AI_CHARTS_SLUG);
  expect(article).toBeDefined();
  expect(article!.body.some(block => block.type === "launch-beats")).toBeTrue();
  expect(article!.body.some(block => block.type === "video")).toBeFalse();
  expect(blogArticleJsonLd(article!)).not.toHaveProperty("video");
});
