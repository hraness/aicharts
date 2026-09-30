import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { assertArticleVideo } from "@hraness/design-kit";

import { getBlogArticle } from "./articles";
import { INTRODUCING_AI_CHARTS_FILM, INTRODUCING_AI_CHARTS_SLUG } from "./introducing-ai-charts-article";
import { blogArticleJsonLd } from "./seo";

const publicFile = (href: string) => join(import.meta.dir, "..", "..", "public", href);

describe("introducing aicharts film", () => {
  test("is a complete article video", () => {
    expect(() => assertArticleVideo(INTRODUCING_AI_CHARTS_FILM)).not.toThrow();
  });

  test("embeds only files that are committed under public/media", () => {
    const hrefs = [
      ...INTRODUCING_AI_CHARTS_FILM.sources.map(source => source.src),
      INTRODUCING_AI_CHARTS_FILM.poster,
      INTRODUCING_AI_CHARTS_FILM.captions,
    ];
    for (const href of hrefs) {
      expect(href.startsWith("/media/")).toBe(true);
      expect(existsSync(publicFile(href))).toBe(true);
    }
  });

  test("captions cover the film's full length", () => {
    const cues = readFileSync(publicFile(INTRODUCING_AI_CHARTS_FILM.captions), "utf8")
      .split("\n")
      .filter(line => line.includes("-->"));
    expect(cues.length).toBeGreaterThan(0);
    expect(cues.at(-1)).toEndWith("00:00:42.500");
    expect(INTRODUCING_AI_CHARTS_FILM.duration).toBe("PT42.5S");
  });

  test("the post embeds the film and names it in its structured data", () => {
    const article = getBlogArticle(INTRODUCING_AI_CHARTS_SLUG);
    expect(article?.body.some(block => block.type === "video")).toBe(true);
    const jsonLd = blogArticleJsonLd(article!) as { video?: { "@type": string; name: string } };
    expect(jsonLd.video?.["@type"]).toBe("VideoObject");
    expect(jsonLd.video?.name).toBe(INTRODUCING_AI_CHARTS_FILM.name);
  });
});
