import { existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HomeLeaders } from "@/components/home-leaders";
import { BenchmarkAtlasExplorer } from "@/components/benchmark-atlas-explorer";
import {
  HOME_EDITORIAL_SLUGS,
  HomeEditorialResources,
} from "@/components/home-editorial-resources";
import { BLOG_ARTICLE_ADMISSIONS } from "@/app/blog/article-admissions";
import { getBlogArticle } from "@/app/blog/articles";
import { blogEditorialImage } from "@/app/blog/editorial-images";
import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  currentCodingAgentBenchmarkLeaders,
  formatBenchmarkScore,
} from "@/lib/coding-agent-dataset";
import { ATLAS_DATASETS, ATLAS_ENTRIES } from "@/lib/benchmark-atlas-catalog";
import type { BenchmarkAtlasDataset, BenchmarkAtlasEntry } from "@/lib/benchmark-atlas";

import Home from "./page";
import { homeHeading, homeLede } from "./site";

const parsed = parseCodingAgentSnapshot(codingAgentData);
if (!parsed.ok) throw parsed.error;
const snapshot = parsed.value;

describe("homepage canonical content", () => {
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
      expect(image).toBeDefined();
      if (image === undefined) continue;
      expect(markup).toContain(encodeURIComponent(image.src));
      const card = getBlogArticle(slug);
      expect(card).toBeDefined();
      if (card !== undefined) {
        expect(markup).toContain(`<p>${card.dek}</p>`);
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

  test("keeps the Pareto chart prominent and gives each other chart workspace its own destination", async () => {
    const source = await Bun.file(new URL("./page.tsx", import.meta.url)).text();
    const markup = renderToStaticMarkup(createElement(Home));
    const mainAt = markup.indexOf('<main class="chart-home" id="main-content">');
    const calculatorAt = markup.indexOf('class="home-calculator"');
    const intelligenceAt = markup.indexOf('class="intelligence-efficiency"');
    const discoveryAt = markup.indexOf('class="task-discovery"');
    const mainEndAt = markup.indexOf("</main>", mainAt);

    expect(mainAt).toBeGreaterThan(markup.indexOf("site-header"));
    // The Pareto chart leads (the browser contract holds its fold position);
    // the calculator callout follows it, ahead of the task links.
    expect(intelligenceAt).toBeGreaterThan(mainAt);
    expect(calculatorAt).toBeGreaterThan(intelligenceAt);
    expect(discoveryAt).toBeGreaterThan(calculatorAt);
    expect(mainEndAt).toBeGreaterThan(discoveryAt);
    expect(markup).toContain('data-analytics-surface="home_calculator"');
    expect(markup).toContain("Subscription vs API vs GPUs");
    expect(markup).toContain('href="/calculator"');
    expect(markup).toContain("Open the calculator");
    expect(markup).not.toContain('class="benchmark-atlas"');
    expect(markup).not.toContain('class="chart-page-canvas"');
    expect(markup).not.toContain('class="home-editorial"');
    expect(markup).not.toContain('class="atlas-reading"');
    expect(markup.indexOf('aria-label="Ask AI about this"')).toBeGreaterThan(mainEndAt);
    expect(markup).not.toContain('id="advanced-charts"');
    expect(markup).toContain("Artificial Analysis Intelligence Index v4.3");
    expect(markup).toContain('href="/data/artificial-analysis-intelligence-v4-3.json"');
    expect(markup).toContain('href="/data#atlas-aa-intelligence-4-3"');
    expect(markup).not.toContain("both round to 61");
    expect(source).not.toContain("AdvancedCharts");
    expect(markup).toContain('class="intelligence-efficiency__frontier-line"');
    expect(markup).toContain("Pareto frontier");
    expect(source).not.toContain("CodingAgentExplorer");
    expect(source).not.toContain("BenchmarkAtlasExplorer");
    expect(source).not.toContain("HomeBenchmarkPortfolio");
    expect(existsSync(new URL("./loading.tsx", import.meta.url))).toBeFalse();
    expect(markup).toContain(`<h1 id="home-title">${homeHeading}</h1>`);
    expect(markup).toContain(homeLede);
    expect(markup).toContain('aria-label="Chart collection"');
    expect(markup).toContain('href="/coding"');
    expect(markup).toContain('href="/benchmarks"');
    for (const task of ["coding", "reasoning", "research", "image", "video", "audio"]) {
      expect(markup).toContain(`href="/benchmarks?task=${task}#explore"`);
    }
    expect(markup).toContain('href="https://x.com/hraness"');
    expect(markup).toContain('href="https://github.com/hraness/aicharts"');
    expect(markup).toContain('href="/data"');
    expect(markup).toContain('href="/models"');
    expect(markup).toContain('id="intelligence-index"');
    expect(markup).not.toContain('class="home-document"');
    expect(markup).not.toContain('class="hraness-marketing-hero"');
    expect(markup.match(/<h1(?:\s|>)/gu)).toHaveLength(1);
  });

  test("server-renders named task controls, inspectable results, and source evidence before hydration", () => {
    const markup = renderToStaticMarkup(createElement(BenchmarkAtlasExplorer, { entries: ATLAS_ENTRIES, datasets: ATLAS_DATASETS }));
    expect(markup).toContain('aria-label="Explore AI benchmarks"');
    expect(markup).toContain('data-analytics-surface="benchmark_atlas"');
    expect(markup).toContain('aria-label="Task"');
    expect(markup).toContain('aria-label="Benchmark"');
    expect(markup).toContain('class="option-picker option-picker--list atlas-task-select"');
    for (const task of ["Coding", "Reasoning", "Research", "Memory", "Images", "Video", "Audio", "World models", "Science", "Work", "Computer use"]) {
      expect(markup).toContain(`<strong>${task}</strong>`);
    }
    expect(markup).toContain('aria-label="Find a benchmark"');
    expect(markup).toContain('type="search"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Charts only");
    expect(markup).toContain('aria-label="Chart view"');
    expect(markup).toContain("<h2>Terminal-Bench 4</h2>");
    expect(markup).toContain("4.0.0");
    expect(markup).toMatch(/<data value="[\d.]+">[\d.]+%<\/data>/u);
    const rows = [...markup.matchAll(/<button\b[^>]*class="atlas-row"[^>]*>([\s\S]*?)<\/button>/gu)];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(8);
    for (const row of rows) {
      expect(row[0]).toContain('type="button"');
      expect(row[0]).toMatch(/aria-pressed="(?:true|false)"/u);
      expect(row[1]).toMatch(/<strong>[^<]+<\/strong>/u);
      expect(row[1]).toMatch(/<data value="[\d.]+">/u);
    }
    expect(rows.filter(row => row[0].includes('aria-pressed="true"'))).toHaveLength(1);
    expect(markup).toContain('aria-label="Selected result"');
    expect(markup).toContain("Add to comparison");
    expect(markup).toContain("View this result at source");
    expect(markup).toContain('<time dateTime=');
    expect(markup).toContain("Read the methodology");
    expect(markup).not.toContain("Loading chart");
  });

  test("source guides do not pretend unimported scores are a ranking", () => {
    const guide = ATLAS_ENTRIES.find(entry => entry.id === "gdpval-aa")!;
    expect(guide.coverage).toBe("source-only");
    const markup = renderToStaticMarkup(createElement(BenchmarkAtlasExplorer, { entries: [guide], datasets: [] }));
    expect(markup).toContain("Comparable scores are not yet charted here");
    expect(markup).toContain(`href="${guide.source.url}"`);
    expect(markup).toContain("Elo");
    expect(markup).toContain("not percent correct");
    expect(markup).not.toContain('class="atlas-ranking"');
    expect(markup).not.toContain('aria-label="Selected result"');
    expect(markup).not.toContain("Cost vs. score");
    expect(markup).not.toContain("0 results");
  });

  test("media ratings use relative dots and audio ranks fewer errors first", () => {
    for (const id of ["image-arena", "image-edit-arena", "video-arena", "image-to-video-arena"]) {
      const entry = ATLAS_ENTRIES.find(value => value.id === id)!;
      const dataset = ATLAS_DATASETS.find(value => value.benchmarkId === id)!;
      const markup = renderToStaticMarkup(createElement(BenchmarkAtlasExplorer, { entries: [entry], datasets: [dataset] }));
      expect(markup).toContain('class="atlas-row__marker"');
      expect(markup).not.toContain('class="atlas-row__fill"');
      expect(markup).toContain("Arena points");
      expect(markup).toContain("relative, not percentages");
      expect(markup).toContain("CC BY 4.0");
    }
    const entry = ATLAS_ENTRIES.find(value => value.id === "open-asr-ami-cleaned")!;
    const dataset = ATLAS_DATASETS.find(value => value.benchmarkId === entry.id)!;
    const markup = renderToStaticMarkup(createElement(BenchmarkAtlasExplorer, { entries: [entry], datasets: [dataset] }));
    expect(markup).toContain("lower is better");
    const values = [...markup.matchAll(/<data value="([\d.]+)">/gu)].map(match => Number(match[1]));
    expect(values).toHaveLength(8);
    expect(values).toEqual(values.toSorted((left, right) => left - right));
    expect(markup).not.toContain("Cost vs. score");
  });

  test("memory methods and effort-only cohorts retain every comparable result in the default ranking", () => {
    for (const id of ["longmemeval-v2-small", "longmemeval-v2-medium", "arc-agi-3-adapter"]) {
      const entry = ATLAS_ENTRIES.find(item => item.id === id)!;
      const dataset = ATLAS_DATASETS.find(item => item.benchmarkId === id)!;
      const markup = renderToStaticMarkup(createElement(BenchmarkAtlasExplorer, { entries: [entry], datasets: [dataset] }));
      expect(markup.match(/class="atlas-row"/gu)).toHaveLength(6);
      if (id.startsWith("longmemeval")) {
        for (const method of ["AgentRunbook-C", "AgentRunbook-R", "Codex", "No retrieval"]) {
          expect(markup).toContain(`<strong>${method}</strong>`);
        }
        expect(markup).toContain("Qwen3.5-9B reader");
      }
    }
  });

  test("a measured zero remains a real result while missing costs do not expose a cost chart", () => {
    const entry: BenchmarkAtlasEntry = { ...ATLAS_ENTRIES[0], id: "test-zero", name: "Test zero", version: "1", coverage: "charted" };
    const dataset: BenchmarkAtlasDataset = { benchmarkId: entry.id, version: entry.version, score: { label: "Accuracy", unit: "%", direction: "higher", minimum: 0, maximum: 100 }, source: { name: "Test source", url: "https://example.com/source", retrievedAt: "2026-09-08T00:00:00Z" }, configurationLabel: "Fixed setup", comparabilityNote: "Same task set", points: [{ id: "zero", label: "Zero model", model: "Zero model", provider: "Test lab", harness: null, effort: null, score: 0, costUsd: null, uncertainty: null, sourceUrl: "https://example.com/result" }] };
    const markup = renderToStaticMarkup(createElement(BenchmarkAtlasExplorer, { entries: [entry], datasets: [dataset] }));
    expect(markup).toContain('<data value="0">0%</data>');
    expect(markup).toContain("Zero model");
    expect(markup).toContain("Uncertainty was not reported");
    expect(markup).not.toContain("Cost vs. score");
    expect(markup).not.toContain("$0");
    expect(renderToStaticMarkup(createElement(BenchmarkAtlasExplorer, { entries: [], datasets: [] }))).toBe("");
  });
});
