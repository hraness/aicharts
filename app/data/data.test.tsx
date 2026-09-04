import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import artificialAnalysisIntelligenceData from "@/data/artificial-analysis-intelligence.json";
import codingAgentData from "@/data/coding-agents.json";
import { parseArtificialAnalysisIntelligenceSnapshot } from "@/lib/artificial-analysis-intelligence-data";
import {
  parseCodingAgentSnapshot,
  type BenchmarkMetric,
} from "@/lib/coding-agent-data";
import {
  CODING_AGENT_BENCHMARK_DEFINITIONS,
  CODING_AGENT_DATASET_DESCRIPTION,
  CODING_AGENT_DATASET_DOWNLOAD_PATH,
  codingAgentDatasetJsonLd,
  codingAgentDatasetModifiedAt,
  codingAgentDatasetSummary,
  currentCodingAgentBenchmarkLeaders,
} from "@/lib/coding-agent-dataset";
import { BENCHMARK_DATA_DESCRIPTION } from "@/lib/benchmark-portfolio";
import {
  artificialAnalysisIntelligenceDatasetJsonLd,
  terminalBenchDatasetJsonLd,
  terminalBenchScienceDatasetJsonLd,
} from "@/lib/benchmark-dataset-json-ld";
import terminalBenchData from "@/data/terminal-bench.json";
import terminalBenchScienceData from "@/data/terminal-bench-science.json";
import { parseTerminalBenchSnapshot } from "@/lib/terminal-bench-data";
import { parseTerminalBenchScienceSnapshot } from "@/lib/terminal-bench-science-data";
import { INDEXABLE_ROBOTS } from "@hraness/web-discovery";

import { searchSite } from "../site";
import {
  GET as getArtificialAnalysisIntelligenceJson,
  dynamic as intelligenceDynamic,
} from "./artificial-analysis-intelligence.json/route";
import {
  GET as getCodingAgentJson,
  dynamic as codingAgentDynamic,
} from "./coding-agents.json/route";
import DataLayout from "./layout";
import CodingAgentDatasetPage, { metadata } from "./page";

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
const parsedTerminalBenchScience = parseTerminalBenchScienceSnapshot(terminalBenchScienceData);
if (!parsedTerminalBenchScience.ok) throw parsedTerminalBenchScience.error;
const terminalBenchScience = parsedTerminalBenchScience.value;

function renderedJsonLd(markup: string, id: string): unknown {
  const script = new RegExp(
    `<script[^>]*id="${id}"[^>]*>([^<]*)</script>`,
    "u",
  ).exec(markup);
  expect(script).not.toBeNull();
  return JSON.parse(script?.[1] ?? "null") as unknown;
}

describe("benchmark dataset surface", () => {
  test("publishes canonical, indexable page metadata", () => {
    expect(metadata).toMatchObject({
      title: "Benchmark Data and Method | AI Charts",
      description: BENCHMARK_DATA_DESCRIPTION,
      alternates: { canonical: "https://aicharts.io/data" },
      robots: INDEXABLE_ROBOTS,
      openGraph: {
        type: "website",
        url: "https://aicharts.io/data",
      },
      twitter: { card: "summary_large_image" },
    });
  });

  test("uses the shared plain-publication shell and semantic navigation", () => {
    const markup = renderToStaticMarkup(
      createElement(
        DataLayout,
        null,
        createElement("main", { id: "data-content" }, "Dataset"),
      ),
    );

    expect(markup).toContain(
      'class="plain-site plain-publication aicharts-data"',
    );
    expect(markup).toContain('href="#data-content"');
    expect(markup).toContain('aria-label="Dataset navigation"');
    expect(markup).toContain('aria-current="page" href="/data"');
    expect(markup).toContain('href="/blog"');
    expect(markup).toContain('href="/"');
    expect(markup.match(/data-presentation="menu"/gu)).toHaveLength(1);
    const headerStart = markup.indexOf('<header class="plain-header"');
    const headerEnd = markup.indexOf("</header>", headerStart);
    const actionsStart = markup.indexOf(
      'class="plain-header__actions"',
      headerStart,
    );
    const navigationStart = markup.indexOf(
      'aria-label="Dataset navigation"',
      actionsStart,
    );
    const navigationEnd = markup.indexOf("</nav>", navigationStart);
    const appearance = markup.indexOf('data-presentation="menu"', actionsStart);
    expect(headerStart).toBeGreaterThan(-1);
    expect(actionsStart).toBeGreaterThan(headerStart);
    expect(navigationStart).toBeGreaterThan(actionsStart);
    expect(navigationEnd).toBeGreaterThan(navigationStart);
    expect(appearance).toBeGreaterThan(navigationEnd);
    expect(appearance).toBeLessThan(headerEnd);
    expect(markup.slice(navigationStart, navigationEnd))
      .not.toContain("hraness-design-theme-toggle");
    expect(markup.slice(appearance, headerEnd)).not.toContain("<a ");
    expect(markup).not.toContain('class="plain-footer"');
  });

  test("renders literal provenance, definitions, leaders, method, and limits", () => {
    const markup = renderToStaticMarkup(
      createElement(CodingAgentDatasetPage),
    );
    const summary = codingAgentDatasetSummary(snapshot);

    expect(markup).toContain("<h1>Benchmark data and method</h1>");
    expect(markup).toContain(BENCHMARK_DATA_DESCRIPTION);
    expect(markup).toContain("Artificial Analysis coding agents");
    expect(markup).toContain("Artificial Analysis Intelligence");
    expect(markup).toContain('aria-label="Dataset downloads"');
    expect(markup).toContain("Download checked snapshots");
    expect(markup).toContain('id="terminal-bench-4"');
    expect(markup).toContain("Terminal-Bench 4 coding standard");
    expect(markup).toContain('href="/data/terminal-bench-4.json"');
    expect(markup).toContain(terminalBench.source.repositoryCommitUrl);
    expect(markup).toContain(terminalBench.source.repositoryCommittedAt);
    expect(markup).toContain("breaking exam generation");
    expect(markup).toContain('id="terminal-bench-science"');
    expect(markup).toContain("Terminal-Bench-Science 0.1");
    expect(markup).toContain('href="/data/terminal-bench-science-0-1.json"');
    expect(markup).toContain(terminalBenchScience.source.releaseDoiUrl);
    expect(markup).toContain(terminalBenchScience.source.leaderboardUpdatedAt);
    expect(markup).toContain("Owner-published aggregate and per-domain cost fields");
    expect(markup).toContain('id="artificial-analysis-intelligence"');
    expect(markup).toContain(
      `Artificial Analysis Intelligence Index v${intelligence.benchmark.version}`,
    );
    expect(markup).toContain(
      'href="/data/artificial-analysis-intelligence.json"',
    );
    expect(markup).toContain(intelligence.source.retrievedAt);
    expect(markup).toContain(intelligence.source.url);
    expect(markup).toContain(intelligence.source.methodologyUrl);
    expect(markup).toContain(intelligence.source.termsUrl);
    expect(markup).toContain("GDPval-AA v2 · 20%");
    expect(markup).toContain("τ³-Banking · 14%");
    expect(markup).toContain("Terminal-Bench v2.1 · 16%");
    expect(markup).toContain("AA-Omniscience · 12%");
    expect(markup).toContain("answer plus reasoning tokens only");
    expect(markup).toContain("not the coding-agent chart");
    expect(markup).toContain("complete cost breakdown but a reported zero total");
    expect(markup).toContain("Rows with incomplete cost are excluded");
    expect(markup).toContain("frontier classification is AI Charts analysis");
    expect(markup).toContain("every four hours");
    expect(markup).toContain('id="source"');
    expect(markup).toContain('id="benchmarks"');
    expect(markup).toContain('id="leaders"');
    expect(markup).toContain('id="configurations"');
    expect(markup).toContain('id="method"');
    expect(markup).toContain('id="limitations"');
    expect(markup).toContain('scope="row"');
    expect(markup).toContain(snapshot.source.url);
    expect(markup).toContain(snapshot.source.retrievedAt);
    expect(markup).toContain(
      String(summary.recordCount) + " model-agent configurations",
    );
    expect(markup).toContain(
      'href="' + CODING_AGENT_DATASET_DOWNLOAD_PATH + '"',
    );
    expect(markup).toContain("AI Charts does not recalculate");
    expect(markup).toContain("real-time mirror");

    for (const definition of CODING_AGENT_BENCHMARK_DEFINITIONS) {
      expect(markup).toContain(definition.label);
      expect(markup).toContain(definition.description);
    }
    for (const leader of currentCodingAgentBenchmarkLeaders(snapshot)) {
      expect(markup).toContain(leader.record.model);
      expect(markup).toContain(leader.value.toFixed(1));
    }
    expect(markup).toContain('href="/blog/aa-index-cost-coding-agents"');
    expect(markup).toContain('href="/blog/open-models-coding-agent-benchmarks"');
    expect(markup).toContain('href="/blog/small-models-have-arrived"');
    expect(markup).toContain('href="/blog/terminal-bench-science"');
    expect(markup).toContain('href="/blog/coding-agent-score-holdouts"');
    expect(markup).toContain('id="coding-agent-snapshot"');
    for (const record of snapshot.records) {
      expect(markup).toContain(record.model);
      expect(markup).toContain(record.agent);
      expect(markup).toContain(record.setting);
    }
  });

  test("computes the highest available record for every benchmark", () => {
    const leaders = currentCodingAgentBenchmarkLeaders(snapshot);
    expect(leaders).toHaveLength(CODING_AGENT_BENCHMARK_DEFINITIONS.length);

    for (const leader of leaders) {
      const metric: BenchmarkMetric = leader.definition.id;
      const available = snapshot.records.flatMap((record) => {
        const value = record.benchmarks[metric];
        return value === null ? [] : [value];
      });
      expect(leader.value).toBe(Math.max(...available));
    }
  });

  test("uses the latest notable event as the meaningful modified time", () => {
    expect(codingAgentDatasetModifiedAt(snapshot)).toBe(
      snapshot.updates.reduce<string | undefined>((latest, update) =>
        latest === undefined || Date.parse(update.detectedAt) > Date.parse(latest)
          ? update.detectedAt
          : latest, undefined) ?? snapshot.source.retrievedAt,
    );
    const first = snapshot.updates[0];
    const second = snapshot.updates[1];
    if (first !== undefined && second !== undefined) {
      expect(codingAgentDatasetModifiedAt({
        ...snapshot,
        updates: [second, first],
      })).toBe(
        Date.parse(first.detectedAt) > Date.parse(second.detectedAt)
          ? first.detectedAt
          : second.detectedAt,
      );
    }
    expect(codingAgentDatasetModifiedAt({
      ...snapshot,
      updates: [],
    })).toBe(snapshot.source.retrievedAt);
  });

  test("emits Dataset JSON-LD that matches the page and download", () => {
    const data = codingAgentDatasetJsonLd(snapshot, searchSite);

    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Dataset",
      "@id": "https://aicharts.io/data#dataset",
      citation: snapshot.source.url,
      creator: {
        "@type": "Organization",
        name: snapshot.source.name,
        url: snapshot.source.url,
      },
      dateModified: codingAgentDatasetModifiedAt(snapshot),
      description: CODING_AGENT_DATASET_DESCRIPTION,
      distribution: {
        "@type": "DataDownload",
        contentUrl: "https://aicharts.io/data/coding-agents.json",
        encodingFormat: "application/json",
      },
      isBasedOn: snapshot.source.url,
      publisher: {
        "@type": "Organization",
        name: "AI Charts",
        url: "https://aicharts.io/",
      },
      url: "https://aicharts.io/data",
      version: snapshot.source.retrievedAt,
    });
    expect(data.variableMeasured.map(variable => variable.name)).toEqual([
      "AA Index",
      "DeepSWE",
      "Terminal-Bench v2.1",
      "SWE-Atlas-QnA",
      "API cost per task",
      "Active time per task",
      "Total tokens per task",
    ]);
  });

  test("describes all four visible dataset downloads in structured data", () => {
    const markup = renderToStaticMarkup(createElement(CodingAgentDatasetPage));
    const terminal = terminalBenchDatasetJsonLd(terminalBench, searchSite);
    const science = terminalBenchScienceDatasetJsonLd(
      terminalBenchScience,
      searchSite,
    );
    const intelligenceDataset = artificialAnalysisIntelligenceDatasetJsonLd(
      intelligence,
      searchSite,
    );

    expect(renderedJsonLd(markup, "aicharts-benchmark-datasets-structured-data"))
      .toEqual([
        codingAgentDatasetJsonLd(snapshot, searchSite),
        terminal,
        science,
        intelligenceDataset,
      ]);

    expect(terminal).toMatchObject({
      "@type": "Dataset",
      "@id": "https://aicharts.io/data#terminal-bench-4",
      citation: terminalBench.source.repositoryCommitUrl,
      distribution: {
        contentUrl: "https://aicharts.io/data/terminal-bench-4.json",
        encodingFormat: "application/json",
      },
      version: terminalBench.benchmark.version,
    });
    expect(science).toMatchObject({
      "@type": "Dataset",
      "@id": "https://aicharts.io/data#terminal-bench-science",
      citation: terminalBenchScience.source.releaseDoiUrl,
      distribution: {
        contentUrl: "https://aicharts.io/data/terminal-bench-science-0-1.json",
        encodingFormat: "application/json",
      },
      version: terminalBenchScience.benchmark.version,
    });
    expect(intelligenceDataset).toMatchObject({
      "@type": "Dataset",
      "@id": "https://aicharts.io/data#artificial-analysis-intelligence",
      citation: intelligence.source.citation,
      creator: {
        name: intelligence.source.name,
        url: "https://artificialanalysis.ai/",
      },
      dateModified: intelligence.source.retrievedAt,
      distribution: {
        contentUrl:
          "https://aicharts.io/data/artificial-analysis-intelligence.json",
        encodingFormat: "application/json",
      },
      isBasedOn: intelligence.source.url,
      license: intelligence.source.termsUrl,
      measurementTechnique: intelligence.source.methodologyUrl,
      version: intelligence.benchmark.version,
    });
    expect(intelligenceDataset.variableMeasured.map(variable => variable.name))
      .toEqual([
        "Intelligence Index",
        "Answer output tokens per task",
        "Reasoning output tokens per task",
        "Total output tokens per task",
        "Cost per task",
      ]);
  });
});

describe("coding-agent JSON download", () => {
  test("serves the checked snapshot with download and freshness headers", async () => {
    expect(codingAgentDynamic).toBe("force-static");
    const response = getCodingAgentJson();
    const body: unknown = await response.json();
    const downloaded = parseCodingAgentSnapshot(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="aicharts-coding-agent-benchmarks.json"',
    );
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=3600");
    expect(response.headers.get("Last-Modified")).toBe(
      new Date(snapshot.source.retrievedAt).toUTCString(),
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(downloaded.ok).toBe(true);
    if (downloaded.ok) expect(downloaded.value).toEqual(snapshot);
  });
});

describe("Artificial Analysis Intelligence JSON download", () => {
  test("serves the checked snapshot with download and freshness headers", async () => {
    expect(intelligenceDynamic).toBe("force-static");
    const response = getArtificialAnalysisIntelligenceJson();
    const body: unknown = await response.json();
    const downloaded = parseArtificialAnalysisIntelligenceSnapshot(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="aicharts-artificial-analysis-intelligence.json"',
    );
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=3600");
    expect(response.headers.get("Last-Modified")).toBe(
      new Date(intelligence.source.retrievedAt).toUTCString(),
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(downloaded.ok).toBe(true);
    if (downloaded.ok) expect(downloaded.value).toEqual(intelligence);
  });
});
