import { describe, expect, test } from "bun:test";

import { articleToMarkdown, blogArticles } from "@/app/blog/articles";
import { blogEditorialImage } from "@/app/blog/editorial-images";
import {
  homeHeading,
  homeTaskLinks,
  modelCardsHeading,
  modelCardsLede,
  notFoundRecoveryLinks,
  site,
} from "@/app/site";
import artificialAnalysisIntelligenceData from "@/data/artificial-analysis-intelligence.json";
import currentIntelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";
import terminalBenchData from "@/data/terminal-bench.json";
import terminalBenchScienceData from "@/data/terminal-bench-science.json";

import { parseArtificialAnalysisIntelligenceSnapshot } from "./artificial-analysis-intelligence-data";
import { CALCULATOR_INPUTS } from "./calculator-inputs-collection";
import { parseCodingAgentSnapshot } from "./coding-agent-data";
import { BENCHMARK_DATA_DESCRIPTION } from "./benchmark-portfolio";
import { ATLAS_DATASETS, ATLAS_ENTRIES } from "./benchmark-atlas-catalog";
import { selectAtlasModelProfiles, sortAtlasPoints } from "./benchmark-atlas";
import { parseAtlasView, formatAtlasScore } from "./benchmark-atlas-view";
import { atlasDatasetDownloadPath } from "./benchmark-atlas-distribution";
import { codingAgentDatasetSummary } from "./coding-agent-dataset";
import { formatRetrievedAt } from "./coding-agent-updates";
import { directDeepSweEvidenceForRelease } from "./deep-swe-evidence-collection";
import {
  FIRST_PARTY_RELEASE_HIGHLIGHTS,
  FIRST_PARTY_RELEASE_SOURCE_SUMMARY,
} from "./first-party-release-collection";
import { modelReleaseRadarHighlightsExcluding } from "./model-release-collection";
import { parseTerminalBenchSnapshot } from "./terminal-bench-data";
import { parseTerminalBenchScienceSnapshot } from "./terminal-bench-science-data";
import {
  AGENT_GUIDE_CONTENT_TYPE,
  MARKDOWN_CONTENT_TYPE,
  agentGuideMarkdown,
  atlasDefaultChartMarkdown,
  homeDocumentText,
  markdownForPath,
  notFoundMarkdown,
} from "./site-markdown";

const parsed = parseCodingAgentSnapshot(codingAgentData);
if (!parsed.ok) throw parsed.error;
const snapshot = parsed.value;
const parsedIntelligence = parseArtificialAnalysisIntelligenceSnapshot(
  artificialAnalysisIntelligenceData,
);
if (!parsedIntelligence.ok) throw parsedIntelligence.error;
const intelligence = parsedIntelligence.value;
const parsedTerminalBench = parseTerminalBenchSnapshot(terminalBenchData);
if (!parsedTerminalBench.ok) throw parsedTerminalBench.error;
const terminalBench = parsedTerminalBench.value;
const parsedTerminalBenchScience = parseTerminalBenchScienceSnapshot(
  terminalBenchScienceData,
);
if (!parsedTerminalBenchScience.ok) throw parsedTerminalBenchScience.error;
const terminalBenchScience = parsedTerminalBenchScience.value;
const distinctModelReleaseHighlights = modelReleaseRadarHighlightsExcluding(
  FIRST_PARTY_RELEASE_HIGHLIGHTS.flatMap(release => release.namedModels),
);

describe("homepage document", () => {
  test("has the product heading and current dataset facts", () => {
    const text = homeDocumentText(snapshot);
    expect(text.startsWith(homeHeading)).toBeTrue();
    expect(text).toContain(site.description);
    expect(text).toContain(String(codingAgentDatasetSummary(snapshot).recordCount));
    expect(text).toContain("Coding agent comparisons");
    expect(text).toContain("AI benchmark explorer");
    expect(text).toContain(
      `Artificial Analysis Intelligence Index v${currentIntelligenceData.benchmark.version}`,
    );
    expect(text).toContain(
      `${currentIntelligenceData.selection.positiveCostRecordCount}-configuration positive-cost cohort`,
    );
    expect(text).toContain("no universal score is calculated");
    expect(text).toContain("Benchmark data and method");
    expect(text).toContain("Machine-readable site guide");
  });
});

describe("markdown representations", () => {
  test("represents the actual default chart and every discoverable benchmark guide", () => {
    const home = markdownForPath("/").body;
    const library = markdownForPath("/benchmarks").body;
    const data = markdownForPath("/data").body;
    const state = parseAtlasView("", ATLAS_ENTRIES, ATLAS_DATASETS);
    const dataset = ATLAS_DATASETS.find(value => value.benchmarkId === state.benchmarkId)!;
    const defaultChart = atlasDefaultChartMarkdown();
    expect(library).toContain(defaultChart);
    expect(library).toContain("/data/benchmark-atlas.json");
    expect(home).not.toContain(defaultChart);
    for (const point of selectAtlasModelProfiles(sortAtlasPoints(dataset)).slice(0, 8)) {
      expect(defaultChart).toContain(point.label);
      expect(defaultChart).toContain(formatAtlasScore(point.score, dataset.score.unit));
    }
    for (const entry of ATLAS_ENTRIES) {
      expect(library).toContain(`/benchmarks?atlas=${entry.id}#explore`);
      expect(data).toContain(entry.question);
      expect(data).toContain(entry.comparisonRule);
      expect(data).toContain(entry.source.url);
      if (entry.coverage === "charted") {
        expect(data).toContain(atlasDatasetDownloadPath(entry.id));
      } else {
        expect(data).not.toContain(`${site.origin}${atlasDatasetDownloadPath(entry.id)})`);
      }
    }
    for (const dataset of ATLAS_DATASETS) {
      expect(data).toContain(formatRetrievedAt(dataset.source.retrievedAt));
      if (dataset.costLabel) expect(data).toContain(dataset.costLabel);
    }
  });
  test("serves the homepage, dataset, blog, and agent guide", () => {
    const home = markdownForPath("/");
    const data = markdownForPath("/data");
    const blog = markdownForPath("/blog");
    const guide = markdownForPath("/llms.txt");

    expect(home).toMatchObject({ found: true, contentType: MARKDOWN_CONTENT_TYPE });
    expect(home.body).toContain(`# ${homeHeading}`);
    expect(home.body).toContain(site.origin);
    expect(home.body).toContain(
      `## Artificial Analysis Intelligence Index v${currentIntelligenceData.benchmark.version} efficiency`,
    );
    expect(home.body).toContain("output-only tokens per Index task");
    expect(home.body).toContain("/data/artificial-analysis-intelligence.json");
    expect(home.body).toContain("/data/artificial-analysis-intelligence-v4-3.json");
    expect(home.body).toContain("/data#current-intelligence-efficiency");
    expect(home.body).toContain("https://aicharts.io/coding");
    expect(home.body).toContain("https://aicharts.io/benchmarks");
    for (const link of homeTaskLinks) {
      expect(home.body).toContain(`[${link.name}](https://aicharts.io/benchmarks?task=${link.task}#explore)`);
      expect(home.body).toContain(link.description);
    }
    expect(home.body).not.toContain("## Benchmark selection");
    expect(home.body).not.toContain("| Model | Agent configuration | Accuracy");
    expect(home.body).not.toContain("## Model and benchmark analysis");
    expect(data.body).toContain(BENCHMARK_DATA_DESCRIPTION);
    expect(data.body).toContain("## Terminal-Bench 4 coding standard");
    expect(data.body).toContain(terminalBench.source.submissionsDirectoryUrl);
    expect(data.body).toContain(terminalBench.source.repositoryCommitUrl);
    expect(data.body).toContain(formatRetrievedAt(terminalBench.source.repositoryCommittedAt));
    expect(data.body).toContain("/data/terminal-bench-4.json");
    expect(data.body).toContain("## Terminal-Bench-Science 0.1");
    expect(data.body).toContain(terminalBenchScience.source.name);
    expect(data.body).toContain(terminalBenchScience.source.releaseDoiUrl);
    expect(data.body).toContain(
      formatRetrievedAt(terminalBenchScience.source.leaderboardUpdatedAt),
    );
    expect(data.body).toContain("/data/terminal-bench-science-0-1.json");
    expect(data.body).toContain("per-domain costs are retained independently");
    expect(data.body).toContain(
      `## Artificial Analysis Intelligence Index v${intelligence.benchmark.version} efficiency`,
    );
    expect(data.body).toContain("GDPval-AA v2 20%");
    expect(data.body).toContain("τ³-Banking 14%");
    expect(data.body).toContain("answer plus reasoning tokens only");
    expect(data.body).toContain("omitted from the historical matched-resource cohort");
    expect(data.body).toContain("frontier classification is AI Charts analysis");
    expect(data.body).toContain(intelligence.source.methodologyUrl);
    expect(data.body).toContain(intelligence.source.termsUrl);
    expect(data.body).toContain(snapshot.source.url);
    expect(data.body).toContain("## All configurations");
    expect(data.body).toContain("| Model | Agent | Provider | Setting | AA Index | DeepSWE | Terminal-Bench v2.1 | SWE-Atlas-QnA | Cost |");
    const cards = markdownForPath("/models");
    expect(cards.body).toContain(`# ${modelCardsHeading}`);
    expect(cards.body).toContain(modelCardsLede);
    expect(cards.body).toContain("## First-party release radar");
    expect(cards.body).toContain(
      `${FIRST_PARTY_RELEASE_SOURCE_SUMMARY.labCount} labs across ${FIRST_PARTY_RELEASE_SOURCE_SUMMARY.sourceCount} first-party sources`,
    );
    expect(cards.body).toContain("Previously unseen canonical URLs create candidates");
    expect(cards.body).toContain("first observed");
    expect(cards.body).not.toContain("source changed");
    expect(cards.body).toContain("Claude Fable 5.1 and Claude Mythos 5.1");
    expect(cards.body).toContain("## Benchmark coverage radar");
    expect(cards.body).toContain("awaiting a complete four-benchmark Artificial Analysis index");
    expect(cards.body).toContain("Discovery is not a score");
    expect(cards.body).toContain("missing metrics shown explicitly");
    expect(cards.body).toContain("DataCurve's mini-swe-agent leaderboard");
    expect(cards.body).toContain("remains outside the Artificial Analysis chart and cards");
    for (const release of distinctModelReleaseHighlights) {
      expect(cards.body).toContain(`[${release.model}](${release.modelUrl})`);
      const evidence = directDeepSweEvidenceForRelease(release);
      if (evidence !== null) {
        expect(cards.body).toContain(`${evidence.identity.resolver.name} model match`);
      }
    }
    expect(blog.body).toContain(blogArticles[0].title);
    for (const article of blogArticles) {
      const image = blogEditorialImage(article.slug);
      if (image === undefined) {
        expect(blog.body).not.toContain(`/images/blog/${article.slug}.webp`);
      } else {
        expect(blog.body).toContain(image.src);
        expect(blog.body).toContain(image.caption);
      }
    }
    expect(guide).toMatchObject({ found: true, contentType: AGENT_GUIDE_CONTENT_TYPE });
    expect(guide.body).toBe(agentGuideMarkdown(snapshot));
  });

  test("gives each comparison workspace its own canonical Markdown document", () => {
    const coding = markdownForPath("/coding");
    const library = markdownForPath("/benchmarks");
    for (const document of [coding, library]) {
      expect(document).toMatchObject({ found: true, contentType: MARKDOWN_CONTENT_TYPE });
      expect(document.body).not.toContain("undefined");
    }
    expect(coding.body).toStartWith("# Coding agent comparisons\n");
    expect(coding.body).toContain("DeepSWE accuracy against API cost");
    expect(coding.body).toContain(snapshot.source.url);
    expect(coding.body).toContain(formatRetrievedAt(snapshot.source.retrievedAt));
    expect(coding.body).toContain("Terminal-Bench v2.1");
    expect(coding.body).toContain("/benchmarks?atlas=terminal-bench-4#explore");
    expect(coding.body).toContain("/data/coding-agents.json");
    expect(coding.body).not.toContain(atlasDefaultChartMarkdown());
    expect(library.body).toStartWith("# Explore benchmarks\n");
    expect(library.body).toContain("Source guides explain evaluations whose results are not charted here");
    expect(markdownForPath("/coding/")).toEqual(coding);
    expect(markdownForPath("/benchmarks/")).toEqual(library);
    expect(markdownForPath("/coding/private").found).toBeFalse();
    expect(markdownForPath("/benchmarks/private").found).toBeFalse();
    const guide = agentGuideMarkdown(snapshot);
    expect(guide).toContain("https://aicharts.io/coding");
    expect(guide).toContain("https://aicharts.io/benchmarks");
    expect(guide).toContain("https://aicharts.io/calculator");
    expect(guide).toContain("canonical Markdown representation describes the default view");
    expect(guide).not.toContain("The homepage has");
    expect(guide).not.toContain("benchmark library below");
  });

  test("describes the calculator's default scenario with sourced as-of dates", () => {
    const calculator = markdownForPath("/calculator");
    expect(calculator).toMatchObject({ found: true, contentType: MARKDOWN_CONTENT_TYPE });
    expect(calculator.body).toStartWith("# Subscription vs API vs GPUs\n");
    expect(calculator.body).not.toContain("undefined");
    expect(calculator.body).toContain("## Default scenario (1 seat, 40x subsidy, 100% utilization, 50% cache hits, 4:1 mix)");
    expect(calculator.body).toContain(CALCULATOR_INPUTS.openAiApiPricing.source.url);
    expect(calculator.body).toContain(CALCULATOR_INPUTS.deepSeekApiPricing.source.url);
    expect(calculator.body).toContain(CALCULATOR_INPUTS.subsidyAnchor.methodSourceUrl);
    expect(calculator.body).toContain(
      formatRetrievedAt(CALCULATOR_INPUTS.openAiApiPricing.source.retrievedAt),
    );
    expect(calculator.body).toContain("not provider serving costs");
    expect(markdownForPath("/calculator/")).toEqual(calculator);
    expect(markdownForPath("/calculator/private").found).toBeFalse();
  });

  test("renders each blog article from the authored blocks", () => {
    for (const article of blogArticles) {
      const document = markdownForPath(`/blog/${article.slug}`);
      expect(document.found).toBeTrue();
      const image = blogEditorialImage(article.slug);
      expect(document.body).toBe(articleToMarkdown(article, image));
      expect(document.body).toContain(`# ${article.title}`);
      expect(document.body).toContain(article.dek);
      expect(document.body).toContain(article.authorshipDisclosure);
      if (image === undefined) {
        expect(document.body).not.toContain("/images/blog/");
        continue;
      }
      expect(document.body).toContain(image.src);
      expect(document.body).toContain(image.caption);
      expect(document.body).toContain(image.credit);
      expect(articleToMarkdown(article)).not.toContain("/images/blog/");
    }
  });

  test("returns honest 404 markdown for retired non-equivalent articles", () => {
    for (const path of [
      "/blog/benchmarkpocalypse",
      "/blog/coding-agent-scores-still-need-expertise",
      "/blog/slopcodebench-long-horizon-coding-agents",
    ]) {
      expect(markdownForPath(path).found).toBeFalse();
    }
  });

  test("returns a 404 markdown recovery document for unknown paths", () => {
    const missing = markdownForPath("/this-path-does-not-exist-agentic");
    expect(missing).toEqual({
      body: notFoundMarkdown(),
      contentType: MARKDOWN_CONTENT_TYPE,
      found: false,
    });
    for (const link of notFoundRecoveryLinks) {
      expect(missing.body).toContain(`](${site.origin}${link.href === "/" ? "/" : link.href})`);
    }
  });
});

describe("agent instruction file", () => {
  test("names when to use the existing chart, dataset, and notes", () => {
    const guide = agentGuideMarkdown(snapshot);
    expect(guide).toContain("## When to use AI Charts");
    expect(guide).toContain("Use AI Charts when you need a sourced comparison that keeps benchmark versions and system configurations explicit");
    expect(guide).toContain("Do not treat AI Charts as a live inference API, universal ranking, or production SLA");
    expect(guide).toContain("/data/terminal-bench-4.json");
    expect(guide).toContain("/data/terminal-bench-science-0-1.json");
    expect(guide).toContain("/data/artificial-analysis-intelligence.json");
    expect(guide).toContain("/data/coding-agents.json");
    expect(guide).toContain("Versioned source JSON downloads");
    expect(guide).toContain("/data/benchmark-atlas.json");
    expect(guide).toContain(
      `${currentIntelligenceData.selection.positiveCostRecordCount}-configuration positive-cost cohort`,
    );
    expect(guide).toContain("answer plus reasoning tokens");
    expect(guide).toContain("Accept: text/markdown");
    expect(guide).toContain("It does not expose OAuth, GraphQL, MCP, or commerce endpoints.");
  });

  test("data Markdown and agent guide separate the current Pareto source from frozen v4.1.1", () => {
    const data = markdownForPath("/data").body;
    const guide = agentGuideMarkdown(snapshot);
    expect(data).toContain("## Current Intelligence efficiency · v4.3");
    expect(data).toContain("efficiency · historical frozen snapshot");
    expect(data).toContain("This v4.1.1 snapshot is frozen and is no longer refreshed by automation");
    const historical = data.split("efficiency · historical frozen snapshot")[1]?.split("## Artificial Analysis coding-agent")[0] ?? "";
    expect(historical).not.toContain("every four hours");
    for (const text of [data, guide]) {
      expect(text).toContain("https://aicharts.io/data/artificial-analysis-intelligence-v4-3.json");
      expect(text).toContain("https://aicharts.io/data/artificial-analysis-intelligence.json");
      expect(text).toContain("homepage’s");
    }
    expect(guide).toContain("Historical v4.1.1 is frozen and must not be pooled with this version");
  });
});
