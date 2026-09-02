import { describe, expect, test } from "bun:test";

import { articleToMarkdown, blogArticlePath, blogArticles } from "@/app/blog/articles";
import { HOME_EDITORIAL_SLUGS } from "@/app/blog/article-admissions";
import { blogEditorialImage } from "@/app/blog/editorial-images";
import {
  homeHeading,
  modelCardsHeading,
  modelCardsLede,
  notFoundRecoveryLinks,
  site,
} from "@/app/site";
import codingAgentData from "@/data/coding-agents.json";
import gptSubsidyData from "@/data/gpt-subsidy.json";
import terminalBenchData from "@/data/terminal-bench.json";
import terminalBenchScienceData from "@/data/terminal-bench-science.json";

import { parseCodingAgentSnapshot } from "./coding-agent-data";
import { BENCHMARK_DATA_DESCRIPTION } from "./benchmark-portfolio";
import { codingAgentDatasetSummary } from "./coding-agent-dataset";
import { formatRetrievedAt } from "./coding-agent-updates";
import {
  formatSubsidyUsd,
  latestGptSubsidyObservation,
  parseGptSubsidySnapshot,
} from "./gpt-subsidy-data";
import { directDeepSweEvidenceForRelease } from "./deep-swe-evidence-collection";
import { FIRST_PARTY_RELEASE_HIGHLIGHTS } from "./first-party-release-collection";
import { modelReleaseRadarHighlightsExcluding } from "./model-release-collection";
import { parseTerminalBenchSnapshot } from "./terminal-bench-data";
import { parseTerminalBenchScienceSnapshot } from "./terminal-bench-science-data";
import {
  AGENT_GUIDE_CONTENT_TYPE,
  MARKDOWN_CONTENT_TYPE,
  agentGuideMarkdown,
  homeDocumentText,
  markdownForPath,
  notFoundMarkdown,
} from "./site-markdown";

const parsed = parseCodingAgentSnapshot(codingAgentData);
if (!parsed.ok) throw parsed.error;
const snapshot = parsed.value;
const parsedSubsidy = parseGptSubsidySnapshot(gptSubsidyData);
if (!parsedSubsidy.ok) throw parsedSubsidy.error;
const latestSubsidy = latestGptSubsidyObservation(parsedSubsidy.value);
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
    expect(text).toContain("Terminal-Bench 4.0.0 is the coding standard");
    expect(text).toContain("Terminal-Bench-Science 0.1.0 adds a separate scientific-workflow view");
    expect(text).toContain("source-specific interactive chart");
    expect(text).toContain("Benchmark data and method");
    expect(text).toContain("Machine-readable site guide");
  });
});

describe("markdown representations", () => {
  test("serves the homepage, dataset, subsidy history, blog, and agent guide", () => {
    const home = markdownForPath("/");
    const data = markdownForPath("/data");
    const subsidy = markdownForPath("/gpt-subsidy");
    const blog = markdownForPath("/blog");
    const guide = markdownForPath("/llms.txt");

    expect(home).toMatchObject({ found: true, contentType: MARKDOWN_CONTENT_TYPE });
    expect(home.body).toContain(`# ${homeHeading}`);
    expect(home.body).toContain(site.origin);
    expect(home.body).toContain("## Benchmark selection");
    expect(home.body).toContain("| Signal | Benchmark | Version | What it measures | Comparison rule |");
    expect(home.body).toContain("## Terminal-Bench 4.0.0 snapshot");
    expect(home.body).toContain("| Model | Agent configuration | Accuracy | 95% interval | Trials | Evaluation cost |");
    expect(home.body).toContain("CursorBench 3.2");
    expect(home.body).toContain("## Terminal-Bench-Science 0.1.0 snapshot");
    expect(home.body).toContain("| Model | Harness configuration | Resolution rate | Standard error | Trials | Evaluation cost |");
    expect(home.body).toContain("## Model and benchmark analysis");
    for (const slug of HOME_EDITORIAL_SLUGS) {
      const image = blogEditorialImage(slug);
      expect(home.body).toContain(blogArticlePath(slug));
      if (image === undefined) {
        expect(home.body).not.toContain(`/images/blog/${slug}.webp`);
      } else {
        expect(home.body).toContain(image.src);
        expect(home.body).toContain(image.caption);
      }
    }
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
    expect(data.body).toContain(snapshot.source.url);
    expect(data.body).toContain("## All configurations");
    expect(data.body).toContain("| Model | Agent | Provider | Setting | AA Index | DeepSWE | Terminal-Bench v2.1 | SWE-Atlas-QnA | Cost |");
    const cards = markdownForPath("/models");
    expect(cards.body).toContain(`# ${modelCardsHeading}`);
    expect(cards.body).toContain(modelCardsLede);
    expect(cards.body).toContain("## First-party release radar");
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
    expect(subsidy).toMatchObject({ found: true, contentType: MARKDOWN_CONTENT_TYPE });
    expect(subsidy.body).toContain("# Subsidy for ChatGPT Pro 20x subscription");
    expect(subsidy.body).toContain("## Calculation");
    expect(subsidy.body).toContain("API-key or otherwise API-billed usage");
    expect(subsidy.body).toContain(
      `The latest measured trailing-seven-day API-retail-equivalent value is ${formatSubsidyUsd(latestSubsidy.trailingSevenDayApiEquivalentUsd)}`,
    );
    expect(subsidy.body).toContain("one-plan comparison upper bound before switched-account adjustment");
    expect(subsidy.body).toContain("is not a subscription-adjusted multiple");
    expect(subsidy.body).toContain("true subscription-spend-adjusted multiple is lower but unknown");
    expect(subsidy.body).toContain("No monthly projection, quota-exhaustion estimate");
    expect(subsidy.body).not.toContain("No monthly projection, one-plan normalization");
    expect(subsidy.body).not.toContain("307.1×");
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
        expect(article.slug).toBe("small-models-have-arrived");
        expect(document.body).not.toContain(`/images/blog/${article.slug}.webp`);
      } else {
        expect(document.body).toContain(image.src);
        expect(document.body).toContain(image.caption);
        expect(document.body).toContain(image.credit);
      }
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
    expect(guide).toContain("Do not treat AI Charts as a live API, ranker, or production SLA");
    expect(guide).toContain("/data/terminal-bench-4.json");
    expect(guide).toContain("/data/terminal-bench-science-0-1.json");
    expect(guide).toContain("/data/coding-agents.json");
    expect(guide).toContain("Accept: text/markdown");
    expect(guide).toContain("It does not expose OAuth, GraphQL, MCP, or commerce endpoints.");
  });
});
