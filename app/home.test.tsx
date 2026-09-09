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

  test("puts the task explorer first and keeps the advanced charts available in a closed disclosure", async () => {
    const source = await Bun.file(new URL("./page.tsx", import.meta.url)).text();
    const markup = renderToStaticMarkup(createElement(Home));
    const mainAt = markup.indexOf('<main class="atlas-home" id="main-content">');
    const explorerAt = markup.indexOf('id="explore"');
    const readingAt = markup.indexOf('aria-label="Make a useful comparison"');
    const advancedAt = markup.indexOf('<details class="atlas-advanced"');
    const intelligenceAt = markup.indexOf('class="intelligence-efficiency"');
    const codingAt = markup.indexOf('class="chart-page-canvas"');
    const resourcesAt = markup.indexOf('class="home-editorial"');
    const mainEndAt = markup.indexOf("</main>", mainAt);

    expect(mainAt).toBeGreaterThan(markup.indexOf("site-header"));
    expect(explorerAt).toBeGreaterThan(mainAt);
    expect(readingAt).toBeGreaterThan(explorerAt);
    expect(advancedAt).toBeGreaterThan(readingAt);
    expect(intelligenceAt).toBeGreaterThan(advancedAt);
    expect(codingAt).toBeGreaterThan(intelligenceAt);
    expect(resourcesAt).toBeGreaterThan(codingAt);
    expect(mainEndAt).toBeGreaterThan(resourcesAt);
    expect(markup.indexOf('aria-label="Ask AI about this"')).toBeGreaterThan(mainEndAt);
    expect(markup.slice(advancedAt, markup.indexOf(">", advancedAt))).not.toMatch(/\bopen(?:=|\s|$)/u);
    expect(source.indexOf("</AdvancedCharts>")).toBeLessThan(source.indexOf("<HomeEditorialResources"));
    expect(source).toContain("brand={{ domain: site.domain }}");
    expect(existsSync(new URL("./loading.tsx", import.meta.url))).toBeFalse();
    expect(markup).toContain(`<h1 id="home-title">${homeHeading}</h1>`);
    expect(markup).toContain(homeLede);
    expect(markup).toContain(`${ATLAS_DATASETS.length} interactive charts`);
    expect(markup).toContain(`${ATLAS_ENTRIES.length} benchmarks`);
    expect(markup).toContain("Compare the full setup");
    expect(markup).toContain("Read the date and the gap");
    expect(markup).toContain('href="https://x.com/hraness"');
    expect(markup).toContain('href="https://github.com/hraness/aicharts"');
    expect(markup).toContain('href="/data"');
    expect(markup).toContain('href="/models"');
    expect(markup).toContain('id="intelligence-index"');
    expect(markup).toContain("Terminal-Bench 4.0.0 snapshot");
    expect(markup).toContain("Terminal-Bench-Science 0.1.0 snapshot");
    expect(markup).toContain("Artificial Analysis Intelligence Index v4.1.1");
    expect(markup).toContain("This source still reports Terminal-Bench v2.1");
    expect(markup).not.toContain('class="home-document"');
    expect(markup).not.toContain('class="hraness-marketing-hero"');
    expect(markup.match(/<h1(?:\s|>)/gu)).toHaveLength(1);
    expect(markup).toContain('<option value="deepSwe" selected="">DSWE</option>');
    expect(markup).toContain('<strong>DeepSWE</strong>');
  });

  test("server-renders named task controls, inspectable results, and source evidence before hydration", () => {
    const markup = renderToStaticMarkup(createElement(BenchmarkAtlasExplorer, { entries: ATLAS_ENTRIES, datasets: ATLAS_DATASETS }));
    expect(markup).toContain('aria-label="Explore AI benchmarks"');
    expect(markup).toContain('data-analytics-surface="benchmark_atlas"');
    expect(markup).toContain('aria-label="Choose a task"');
    for (const task of ["Coding", "Reasoning", "Research", "Memory", "Images", "Video", "Audio", "World models", "Science", "Work", "Computer use"]) {
      expect(markup).toContain(`type="button">${task}</button>`);
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
