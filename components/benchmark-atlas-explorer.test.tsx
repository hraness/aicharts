import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { BenchmarkAtlasDataset, BenchmarkAtlasEntry } from "@/lib/benchmark-atlas";
import { atlasViewSearch, parseAtlasView } from "@/lib/benchmark-atlas-view";
import { BenchmarkAtlasExplorer, benchmarkAtlasShareUrl } from "./benchmark-atlas-explorer";

const entries: readonly BenchmarkAtlasEntry[] = Array.from({ length: 12 }, (_, index) => ({
  id: `benchmark-${index}`,
  name: `Benchmark ${index}`,
  version: "1.0",
  category: index < 10 ? "coding" : "audio",
  question: "Which configuration performs this task?",
  summary: "One published task, with a fixed evaluation protocol.",
  source: { name: "Benchmark owner", url: "https://example.org/benchmark" },
  measure: "Tasks completed",
  comparisonRule: "Compare only the same protocol.",
  limitations: ["This test does not measure every task."],
  coverage: index < 9 ? "charted" : index === 9 ? "source-only" : "watchlist",
  tags: [],
}));

const dataset: BenchmarkAtlasDataset = {
  benchmarkId: entries[0].id,
  version: "1.0",
  score: { label: "Tasks completed", unit: "%", direction: "higher", minimum: 0, maximum: 100 },
  source: { name: "Benchmark owner", url: "https://example.org/benchmark", retrievedAt: "2026-09-08T12:00:00Z" },
  observedAt: "2026-09-07T12:00:00Z",
  evidenceLabel: "Publisher-run evaluation",
  configurationLabel: "Model and harness",
  comparabilityNote: "These results use one test protocol. They do not measure all coding work.",
  costLabel: "Cost per task",
  points: Array.from({ length: 10 }, (_, index) => ({
    id: `point-${index}`,
    label: `Model ${Math.floor(index / 2)} (effort ${index})`,
    model: `Model ${Math.floor(index / 2)}`,
    provider: index < 4 ? "First lab" : "Second lab",
    harness: "Fixed harness 2.0",
    effort: `Effort ${index}`,
    score: 90 - index,
    costUsd: index + 1,
    uncertainty: { label: "95% confidence interval", lower: 88 - index, upper: 92 - index },
    sourceUrl: `https://example.org/results/${index}`,
    details: [{ label: "Evaluation revision", value: "Pinned source revision 123" }],
  })),
};

const render = () => renderToStaticMarkup(<BenchmarkAtlasExplorer entries={entries} datasets={[dataset]} />);

describe("benchmark library progressive disclosure", () => {
  test("shares the dedicated library route with the complete validated view state", () => {
    const state = parseAtlasView("?atlas=benchmark-0&task=coding&atlasView=cost&atlasPoint=point-1&atlasCompare=point-1&atlasCompare=point-2&atlasProvider=First+lab&atlasProfiles=all&atlasAll=1", entries, [dataset]);
    const url = benchmarkAtlasShareUrl("https://aicharts.io", state);
    expect(url).toBe(`https://aicharts.io/benchmarks${atlasViewSearch(state)}#explore`);
    expect(parseAtlasView(new URL(url).search, entries, [dataset])).toEqual(state);
    expect(new URL(url).pathname).toBe("/benchmarks");
  });
  test("moves task and benchmark navigation into the shared compact picker", () => {
    const html = render();
    expect(html).not.toContain("<select");
    const task = html.match(/<div class="option-picker option-picker--list atlas-task-select">[\s\S]*?<div class="option-picker option-picker--grid atlas-benchmark-select">/u)?.[0] ?? "";
    expect(task).toContain(">Task</span>");
    expect(task).toContain('aria-label="Task"');
    expect(task).toContain("<strong>All tasks</strong>");
    expect(task).toContain("<strong>Coding</strong>");
    expect(task).toContain("<strong>Audio</strong>");
    expect(task).not.toContain("<strong>World models</strong>");
    expect(task).not.toContain('role="combobox"');
    const navigation = html.match(/<div class="option-picker option-picker--grid atlas-benchmark-select">[\s\S]*?<details class="atlas-library"/u)?.[0] ?? "";
    expect(navigation).toContain(">Benchmark</span>");
    expect(navigation).toContain('aria-label="Benchmark"');
    expect(navigation).toContain('aria-label="Search benchmarks"');
    expect(navigation).toContain('role="combobox"');
    expect(navigation.match(/role="option"/gu)).toHaveLength(entries.length);
    expect(navigation).toContain("<strong>Benchmark 9 1.0</strong><small>Guide</small>");
    expect(navigation).toContain("<strong>Benchmark 10 1.0</strong><small>Emerging</small>");
    const selected = navigation.match(/<div aria-selected="true"[\s\S]*?<\/div>/u)?.[0] ?? "";
    expect(selected).toContain("Benchmark 0 1.0");
    expect(html).not.toContain('<nav class="atlas-tasks"');
  });

  test("keeps the catalogue closed and caps its initial list without removing benchmarks", () => {
    const html = render();
    const library = html.match(/<details class="atlas-library"[\s\S]*?<\/details>/u)?.[0] ?? "";
    expect(library).toContain("Browse library");
    expect(library).not.toContain(" open=");
    const choices = library.match(/<div class="atlas-library__list"[\s\S]*?<\/div>/u)?.[0] ?? "";
    expect(choices.match(/<button /gu)).toHaveLength(8);
    expect(library).toContain("Show all 12 benchmarks");
    expect(library).toContain('aria-label="Find a benchmark"');
    expect(library).toContain("Guides link to published evaluations");
  });

  test("keeps primary chart views and scope visible while secondary result filters are closed", () => {
    const html = render();
    const filters = html.match(/<details class="atlas-filters"[\s\S]*?<\/details>/u)?.[0] ?? "";
    expect(filters).toContain("Filters");
    expect(filters).not.toContain(" open=");
    expect(filters).toContain("Provider");
    expect(filters).toContain("All providers");
    expect(filters).not.toContain("<select");
    expect(filters).toContain('aria-label="Search providers"');
    expect(filters.match(/role="option"/gu)).toHaveLength(3);
    expect(filters).toContain("<strong>First lab</strong>");
    expect(filters).toContain("<strong>Second lab</strong>");
    expect(filters).toContain("Best result per system");
    const primary = html.replace(filters, "");
    expect(primary).toContain('role="group" aria-label="Chart view"');
    expect(primary).toContain(">Ranking</button>");
    expect(primary).toContain(">Cost vs. score</button>");
    expect(primary).toContain(">Table</button>");
    expect(html).toContain("provider-brand-mark");
    expect(html).toContain("atlas-row__profile-rest");
    expect(primary).toContain(dataset.comparabilityNote);
    expect(primary.indexOf('class="atlas-ranking"')).toBeLessThan(primary.indexOf(dataset.comparabilityNote));
    expect(primary.indexOf(dataset.comparabilityNote)).toBeLessThan(primary.indexOf('class="atlas-provenance"'));
    expect(primary.replace(/<details[\s\S]*?<\/details>/gu, "")).toContain(dataset.comparabilityNote);
    expect(primary).toContain("<dt>Source date</dt>");
    expect(primary).toContain("Sep 7, 2026</time>");
    expect(primary).toContain("<dt>Configurations</dt><dd>10</dd>");
    expect(primary).toContain("<dt>Evidence</dt>");
    expect(primary).toContain("Showing 5 systems. Best-scoring configuration per model and harness.");
    expect(primary).not.toContain("Best result per system");
    expect(primary).toContain('data-analytics-surface="benchmark_atlas"');
  });

  test("does not describe ungrouped rows as each system’s best configuration", () => {
    const uniqueDataset = { ...dataset, points: dataset.points.map(point => ({ ...point, model: point.id })) } satisfies BenchmarkAtlasDataset;
    const html = renderToStaticMarkup(<BenchmarkAtlasExplorer entries={entries} datasets={[uniqueDataset]} />);
    expect(html).toContain("Showing 8 of 10 configurations.");
    expect(html).not.toContain("Best-scoring configuration per model and harness.");
    expect(html).toContain("Show all 10 results");
  });

  test("names the source's interval type instead of implying every whisker is a confidence interval", () => {
    const renderIntervals = (labels: readonly (string | null)[]) => {
      const points = dataset.points.slice(0, labels.length).map((point, index) => ({ ...point, model: point.id, uncertainty: labels[index] === null ? null : { label: labels[index]!, lower: point.score - 1, upper: point.score + 1 } }));
      const html = renderToStaticMarkup(<BenchmarkAtlasExplorer entries={entries} datasets={[{ ...dataset, points }]} />);
      return html.match(/<p class="atlas-caption">[\s\S]*?<\/p>/u)?.[0] ?? "";
    };
    expect(renderIntervals(["Source-reported ±1 binomial standard error"])).toContain("Whiskers: Source-reported ±1 binomial standard error.");
    expect(renderIntervals(["95% confidence interval"])).toContain("Whiskers: 95% confidence interval.");
    expect(renderIntervals(["95% confidence interval", "Standard error"])).toContain("different source-reported interval types");
    expect(renderIntervals([null])).toContain("Uncertainty was not reported");
  });

  test("keeps identity, exact score, cost, and uncertainty visible and moves only technical detail", () => {
    const html = render();
    const inspector = html.match(/<aside class="atlas-inspector"[\s\S]*?<\/aside>/u)?.[0] ?? "";
    const detail = inspector.match(/<details class="atlas-inspector__details"[\s\S]*?<\/details>/u)?.[0] ?? "";
    expect(detail).toContain("Configuration details");
    expect(detail).toContain("Pinned source revision 123");
    expect(detail).not.toContain(" open=");
    const primary = inspector.replace(detail, "");
    expect(primary).toContain("Model 0");
    expect(primary).toContain("First lab");
    expect(primary).toContain("90%");
    expect(primary).toContain("Fixed harness 2.0");
    expect(primary).toContain("Effort 0");
    expect(primary).toContain("$1.00");
    expect(primary).toContain("95% confidence interval");
    expect(primary).toContain("88%–92%");
    expect(primary).not.toContain("Pinned source revision");
    expect(primary).toContain("Add to comparison");
    expect(primary).toContain('href="https://example.org/results/0"');
  });

  test("does not render a ranking or result controls for an uncharted guide", () => {
    const html = renderToStaticMarkup(<BenchmarkAtlasExplorer entries={[entries[9]]} datasets={[]} />);
    expect(html).toContain("Benchmark guide");
    expect(html).toContain("Comparable scores are not yet charted here");
    expect(html).toContain("Compare only the same protocol.");
    expect(html).toContain("This test does not measure every task.");
    expect(html).not.toContain('class="atlas-ranking"');
    expect(html).not.toContain('class="atlas-filters"');
    expect(html).not.toContain("Add to comparison");
  });

  test("gives the chart available width and preserves touch and keyboard affordances", async () => {
    const css = await Bun.file(new URL("../styles/benchmark-atlas.css", import.meta.url)).text();
    const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    expect(rule(".atlas-workspace")).toContain("min-width: 0");
    expect(rule(".atlas-workspace")).not.toContain("grid-template-columns");
    expect(css).not.toContain(".atlas-navigation select");
    expect(rule(".atlas-task-select, .atlas-benchmark-select")).toContain("min-width: 0");
    expect(rule(".atlas-library > summary")).toContain("min-height: 44px");
    expect(rule(".atlas-view-toggle button")).toContain("min-height: 44px");
    expect(rule(".atlas-filters summary")).toContain("min-height: 44px");
    expect(rule(".atlas-comparison__remove")).toContain("width: 44px; height: 44px");
    expect(rule(".benchmark-atlas :focus-visible")).toContain("outline: 2px");
    expect(rule(".benchmark-atlas")).toContain("--option-picker-accent: var(--atlas-accent)");
    expect(rule(".atlas-provider .option-picker__panel")).toContain("width: min(560px, calc(100vw - 32px))");
    expect(css).not.toContain(".atlas-provider select");
    expect(rule(".atlas-scatter__scroll")).toContain("overflow-x: auto");
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.atlas-benchmark-select \{ grid-column: 1 \/ -1; grid-row: 2;/u);
    expect(css).not.toContain(".atlas-mobile-select");
    expect(css).not.toContain(".atlas-tasks");
  });
});

describe("benchmark page grammar", () => {
  const html = renderToStaticMarkup(<BenchmarkAtlasExplorer entries={entries} datasets={[dataset]} />);

  test("leads with what the benchmark measures before showing who wins", () => {
    expect(html).toContain('class="atlas-lead"');
    expect(html.indexOf('class="atlas-lead"')).toBeLessThan(html.indexOf('class="atlas-ranking"'));
    const lead = html.slice(html.indexOf('class="atlas-lead"'), html.indexOf('class="atlas-toolbar"'));
    expect(lead).toContain(entries[0].summary);
    expect(lead).toContain(entries[0].measure);
  });

  test("states provenance as labelled facts, not a run-on caption", () => {
    for (const label of ["Evidence", "Version", "Source date", "Configurations"]) {
      expect(html).toContain(`<dt>${label}</dt>`);
    }
    expect(html).toContain("<dd>Publisher-run evaluation</dd>");
    expect(html).not.toContain('class="atlas-context"');
  });

  test("summarises the result in prose after the chart and before the caveats", () => {
    const takeaways = html.indexOf('class="atlas-takeaways"');
    expect(takeaways).toBeGreaterThan(html.indexOf('class="atlas-ranking"'));
    expect(takeaways).toBeLessThan(html.indexOf(dataset.comparabilityNote));
    expect(html).toContain("What this chart shows");
    // Named from the data rather than authored copy: leader, overlap, and cost spread.
    expect(html).toContain("Model 0 leads at 90%, ahead of Model 1 at 88%.");
    expect(html).toContain("Their reported uncertainty ranges overlap, so this source does not separate the top two.");
    // The fixture's leader is also its cheapest result, so no cost trade-off is claimed.
    expect(html).not.toContain("the cheapest result is");
    expect(html).toContain("These sentences cover the whole chart and ignore the filters above.");
  });

  test("carries the task family on the surface so each family can be themed", () => {
    expect(html).toContain('data-atlas-category="coding"');
    const audioOnly = renderToStaticMarkup(<BenchmarkAtlasExplorer entries={entries.filter(entry => entry.category === "audio")} datasets={[]} />);
    expect(audioOnly).toContain('data-atlas-category="audio"');
  });
});
