import { existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HomeDocument } from "@/components/home-document";
import { HomeLeaders } from "@/components/home-leaders";
import {
  HOME_EDITORIAL_SLUGS,
  HomeEditorialResources,
} from "@/components/home-editorial-resources";
import { BLOG_ARTICLE_ADMISSIONS } from "@/app/blog/article-admissions";
import { blogEditorialImage } from "@/app/blog/editorial-images";
import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  currentCodingAgentBenchmarkLeaders,
  formatBenchmarkScore,
} from "@/lib/coding-agent-dataset";
import { homeDocumentModel, homeDocumentText } from "@/lib/site-markdown";

import Home from "./page";

const parsed = parseCodingAgentSnapshot(codingAgentData);
if (!parsed.ok) throw parsed.error;
const snapshot = parsed.value;

describe("homepage agent document", () => {
  test("server-renders the accessible leaders table without a duplicate marketing heading", () => {
    const markup = renderToStaticMarkup(createElement(HomeLeaders, { snapshot }));
    const leaders = currentCodingAgentBenchmarkLeaders(snapshot);

    expect(markup).toContain('aria-label="Current coding-agent benchmark leaders"');
    expect(markup).not.toContain("<h1");
    expect(markup).not.toContain("<h2");
    expect(markup).not.toContain("<p");
    expect(markup).toContain("<table");
    expect(markup).toContain("<caption>Highest score by benchmark in the current snapshot</caption>");
    expect(markup).toContain("<th scope=\"col\">Benchmark</th>");
    expect(markup).toContain("<th scope=\"col\">Score</th>");
    for (const leader of leaders) {
      expect(markup).toContain(leader.definition.label);
      expect(markup).toContain(leader.record.model);
      expect(markup).toContain(leader.record.agent);
      expect(markup).toContain(leader.record.providerName);
      expect(markup).toContain(leader.record.setting);
      expect(markup).toContain(formatBenchmarkScore(leader.value));
    }
    expect(markup).not.toContain("Loading chart");
  });

  test("keeps the clipped document on the server page for discovery", () => {
    const document = homeDocumentModel(snapshot);
    const markup = renderToStaticMarkup(createElement(HomeDocument, { document, snapshot }));
    const text = homeDocumentText(snapshot);

    expect(markup).toContain('class="home-document"');
    expect(markup).not.toContain("<h1");
    expect(markup).not.toContain('id="coding-agent-snapshot"');
    expect(markup).toContain('href="/data"');
    expect(markup).toContain('href="/blog/aa-index-cost-coding-agents"');
    expect(markup).toContain('href="/blog/open-models-coding-agent-benchmarks"');
    expect(markup).toContain('href="/blog/small-models-have-arrived"');
    expect(markup).toContain('href="/blog/terminal-bench-science"');
    expect(markup).toContain('href="/blog/coding-agent-score-holdouts"');
    expect(markup).toContain('href="/llms.txt"');
    expect(markup).toContain('href="/sitemap.xml"');
    expect(text).toContain(document.paragraphs[0] ?? "");
  });

  test("shows a small, role-distinct editorial module", () => {
    const markup = renderToStaticMarkup(createElement(HomeEditorialResources));
    expect(HOME_EDITORIAL_SLUGS.length).toBeLessThanOrEqual(3);
    expect(new Set(HOME_EDITORIAL_SLUGS).size).toBe(HOME_EDITORIAL_SLUGS.length);
    const roles = HOME_EDITORIAL_SLUGS.map(slug =>
      BLOG_ARTICLE_ADMISSIONS[slug].homepageRole);
    expect(roles.every(role => role !== undefined)).toBeTrue();
    expect(new Set(roles).size).toBe(roles.length);
    expect(markup).toContain("Model and benchmark analysis");
    expect(markup).toContain('href="/blog"');
    expect(markup).not.toContain('rel="preload"');
    for (const slug of HOME_EDITORIAL_SLUGS) {
      expect(markup).toContain(`href="/blog/${slug}"`);
      const image = blogEditorialImage(slug);
      if (image === undefined) {
        expect(slug).toBe("small-models-have-arrived");
        expect(markup).not.toContain(
          encodeURIComponent(`/images/blog/${slug}.webp`),
        );
      } else {
        expect(markup).toContain(encodeURIComponent(image.src));
      }
    }

    const imageLessMarkup = renderToStaticMarkup(
      HomeEditorialResources({
        imageForSlug: () => undefined,
      }),
    );
    expect(imageLessMarkup).toContain("Model and benchmark analysis");
    expect(imageLessMarkup).not.toContain("/images/blog/");
    for (const slug of HOME_EDITORIAL_SLUGS) {
      expect(imageLessMarkup).toContain(`href="/blog/${slug}"`);
    }
  });

  test("mounts the benchmark portfolio before the source-specific interactive chart", async () => {
    const source = await Bun.file(new URL("./page.tsx", import.meta.url)).text();
    const markup = renderToStaticMarkup(createElement(Home));
    const portfolioAt = source.indexOf("<HomeBenchmarkPortfolio");
    const resourcesAt = source.indexOf("<HomeEditorialResources");
    const explorerAt = source.indexOf("<CodingAgentExplorer");
    const documentAt = source.indexOf("<HomeDocument");
    const explorerEndAt = source.indexOf("</CodingAgentExplorer>");
    const loadingAt = source.indexOf("Loading chart");

    expect(portfolioAt).toBeGreaterThan(-1);
    expect(explorerAt).toBeLessThan(portfolioAt);
    expect(resourcesAt).toBeGreaterThan(portfolioAt);
    expect(documentAt).toBeGreaterThan(resourcesAt);
    expect(documentAt).toBeGreaterThan(portfolioAt);
    expect(explorerEndAt).toBeGreaterThan(documentAt);
    expect(loadingAt).toBe(-1);
    expect(source).toContain("heading: site.domain");
    expect(existsSync(new URL("./loading.tsx", import.meta.url))).toBeFalse();
    expect(Home.name).toBe("Home");

    const headerAt = markup.indexOf('<header class="ui-top-bar chart-top-bar"');
    const mainAt = markup.indexOf('<main class="chart-page-canvas"');
    const orientationAt = markup.indexOf('class="chart-orientation"');
    const renderedPortfolioAt = markup.indexOf('class="home-benchmark-portfolio"');
    const chartFamilyAt = markup.indexOf('class="chart-family-intro"');
    const chartAt = markup.indexOf('class="chart-scroll"');
    const renderedResourcesAt = markup.indexOf('class="home-editorial"');
    const mainEndAt = markup.indexOf("</main>", mainAt);

    expect(headerAt).toBeGreaterThan(-1);
    expect(mainAt).toBeGreaterThan(headerAt);
    expect(orientationAt).toBeGreaterThan(mainAt);
    expect(renderedPortfolioAt).toBeGreaterThan(orientationAt);
    expect(chartFamilyAt).toBeGreaterThan(renderedPortfolioAt);
    expect(chartAt).toBeGreaterThan(chartFamilyAt);
    expect(renderedResourcesAt).toBeGreaterThan(chartAt);
    expect(mainEndAt).toBeGreaterThan(renderedResourcesAt);
    expect(markup).toContain("A benchmark portfolio for the work AI systems are asked to do");
    expect(markup).toContain("Five benchmark roles, one coding standard");
    expect(markup).toContain("Terminal-Bench 4.0.0 snapshot");
    expect(markup).toContain("Terminal-Bench-Science 0.1.0 snapshot");
    expect(markup).toContain("GPT-5.6 Sol");
    expect(markup).toContain("Scientific workflows");
    expect(markup).toContain("This source still reports Terminal-Bench v2.1");
    expect(markup.match(/<h1(?:\s|>)/gu)).toHaveLength(1);
    expect(markup).toContain('<option value="deepSwe" selected="">DSWE</option>');
    expect(markup).toContain('<strong>DeepSWE</strong>');
  });
});
