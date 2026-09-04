import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_CITATION,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_SELECTION_RULE,
  type ArtificialAnalysisIntelligenceRecord,
  type ArtificialAnalysisIntelligenceSnapshot,
} from "@/lib/artificial-analysis-intelligence-data";

import { HomeIntelligenceEfficiency } from "./home-intelligence-efficiency";

function record(
  id: string,
  intelligenceIndex: number,
  outputTokens: number,
  costUsd: number,
  name = `Model ${id}`,
): ArtificialAnalysisIntelligenceRecord {
  return {
    costUsdPerTask: {
      answer: costUsd,
      cacheRead: 0,
      cacheWrite: 0,
      input: 0,
      nonCacheInput: 0,
      output: costUsd,
      reasoning: 0,
      total: costUsd,
    },
    creator: { id: "example-lab", name: "Example Lab", slug: "example-lab" },
    detailsUrl: `https://artificialanalysis.ai/models/${id}`,
    effort: name.endsWith("(max)")
      ? { label: "max", level: 60, slug: "max" }
      : null,
    id,
    intelligenceIndex,
    name,
    outputTokensPerTask: {
      answer: outputTokens * .4,
      reasoning: outputTokens * .6,
      total: outputTokens,
    },
    release: { name, slug: id },
    releaseDate: "2026-09-04",
    shortName: name.replace(/\s*\([^)]*\)$/u, ""),
    slug: id,
  };
}

const astra = record(
  "gpt-6-astra",
  61.2161067377315,
  14_875.597662702807,
  1.6672644402217776,
  "GPT-6 Astra (max)",
);
const sol = record(
  "gpt-5-6-sol",
  60.9298701329203,
  16_878.794951920757,
  0.952976204905937,
  "GPT-5.6 Sol (max)",
);
const records = [
  astra,
  sol,
  ...Array.from({ length: 125 }, (_, index) => record(
    `context-${String(index + 1)}`,
    50 - (index % 40),
    100_000 + index * 1_000,
    10 + index,
  )),
];

const snapshot = {
  benchmark: {
    categoryWeightsPercent: { agents: 34, coding: 24, general: 18, scientific: 24 },
    evaluationCount: 9,
    evaluations: [
      "GDPval-AA v2",
      "τ³-Banking",
      "Terminal-Bench v2.1",
      "SciCode",
      "Humanity's Last Exam",
      "GPQA Diamond",
      "CritPt",
      "AA-Omniscience",
      "AA-LCR",
    ],
    name: "Artificial Analysis Intelligence Index",
    score: "intelligence-index",
    scoreUnit: "index-points",
    version: "4.1.1",
  },
  records,
  schemaVersion: 1,
  selection: {
    measuredCompleteRecordCount: 127,
    positiveCostRecordCount: 127,
    rule: ARTIFICIAL_ANALYSIS_INTELLIGENCE_SELECTION_RULE,
    sourceRecordCount: 127,
  },
  source: {
    citation: ARTIFICIAL_ANALYSIS_INTELLIGENCE_CITATION,
    method: "public-next-flight",
    methodologyUrl: "https://artificialanalysis.ai/methodology/intelligence-benchmarking",
    name: "Artificial Analysis",
    retrievedAt: "2026-09-04T02:30:00.000Z",
    sourceClass: "benchmark-publisher",
    termsUrl: "https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf",
    url: "https://artificialanalysis.ai/models",
  },
} as ArtificialAnalysisIntelligenceSnapshot;

describe("homepage Intelligence efficiency view", () => {
  test("renders two accessible, same-cohort log views with the exact benchmark version", () => {
    const html = renderToStaticMarkup(<HomeIntelligenceEfficiency snapshot={snapshot} />);

    expect(html).toContain("Artificial Analysis Intelligence Index v4.1.1");
    expect(html.match(/role="img"/gu)).toHaveLength(2);
    expect(html.match(/<title id="intelligence-efficiency-/gu)).toHaveLength(2);
    expect(html.match(/<desc id="intelligence-efficiency-/gu)).toHaveLength(2);
    expect(html).toContain("Output tokens per task");
    expect(html).toContain("Cost per task");
    expect(html).toContain("Output tokens per Intelligence Index task · log scale");
    expect(html).toContain("US dollars per Intelligence Index task · log scale");
    expect(html.match(/identical 127-configuration cohort/gu)).toHaveLength(2);
    expect(html.match(/shared 0 to 70 vertical scale/gu)).toHaveLength(2);
    expect(html.match(/role="region"/gu)).toHaveLength(2);
    expect(html.match(/tabindex="0"/gu)).toHaveLength(2);
    expect(html).toContain("Scroll horizontally for the full plot");
    expect(html).toContain("Pan chart ↔");
    expect(html).toContain("AI Charts-derived Pareto frontier");
    expect(html).toContain("intelligence-efficiency__point--astra");
    expect(html).toContain("intelligence-efficiency__point--sol");
  });

  test("states the model-level output boundary and computes the Astra/Sol finding", () => {
    const html = renderToStaticMarkup(<HomeIntelligenceEfficiency snapshot={snapshot} />);

    expect(html).toContain("General capability · model-level");
    expect(html).toContain("Output tokens are answer plus reasoning generated per Intelligence Index task");
    expect(html).toContain("exclude input and cache traffic");
    expect(html).toContain("separate from the coding-agent configurations and total-token measurement below");
    expect(html).toContain("At max effort, GPT-6 Astra and GPT-5.6 Sol both round to 61");
    expect(html).toContain("11.9% fewer output tokens per task");
    expect(html).toContain("75.0% higher cost per task");
    expect(html.match(/GPT-6 Astra at max effort/gu)).toHaveLength(2);
    expect(html.match(/GPT-5\.6 Sol at max effort/gu)).toHaveLength(2);
    expect(html).toContain("GPT-6 Astra · max effort");
    expect(html).toContain("GPT-5.6 Sol · max effort");
    expect(html).not.toContain("Coding Agent Index");
    expect(html).not.toContain("AA Index");
    expect(html).not.toContain("Terminal-Bench 4");
  });

  test("keeps source, methodology, retrieval, and selection provenance visible", () => {
    const html = renderToStaticMarkup(<HomeIntelligenceEfficiency snapshot={snapshot} />);

    expect(html).toContain("Artificial Analysis public models leaderboard");
    expect(html).toContain('href="https://artificialanalysis.ai/models"');
    expect(html).toContain('<time dateTime="2026-09-04T02:30:00.000Z">Sep 4, 2026</time>');
    expect(html).toContain("First-party public Next.js page payload");
    expect(html).toContain("The source has 127 records");
    expect(html).toContain("127 meet the current, non-estimated complete-measure rule");
    expect(html).toContain("Both panels use the same 127 configurations that also report a positive task cost");
    expect(html).toContain("No benchmark families are blended");
    expect(html).toContain("9-evaluation index");
    expect(html).toContain("agents 34% · coding 24% · scientific 24% · general 18%");
    expect(html).toContain('href="https://artificialanalysis.ai/methodology/intelligence-benchmarking"');
    expect(html).toContain('href="https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf"');
    expect(html).toContain('data-analytics-surface="benchmark_chart"');
    expect(html).toContain('data-analytics-destination-id="source:artificial-analysis-methodology"');
  });

  test("includes every comparable model in a native disclosure table", () => {
    const html = renderToStaticMarkup(<HomeIntelligenceEfficiency snapshot={snapshot} />);

    expect(html).toContain("View all 127 comparable configurations");
    expect(html).toContain("Complete model-configuration Artificial Analysis Intelligence Index efficiency records");
    expect(html).toContain("Output tokens / task");
    expect(html).toContain("Cost / task");
    expect(html).toContain("Cohort rank");
    expect(html.match(/<tbody>/gu)).toHaveLength(1);
    expect(html.match(/<tr>/gu)).toHaveLength(128);
    for (const item of records) {
      expect(html).toContain(`href="${item.detailsUrl}"`);
      expect(html).toContain(item.name);
    }
  });

  test("does not round a sub-cent cost observation to zero", () => {
    const lowCost = record("low-cost", 20, 50_000, .005, "Low-cost model");
    const lowCostSnapshot = {
      ...snapshot,
      records: [...snapshot.records.slice(0, -1), lowCost],
    };
    const html = renderToStaticMarkup(
      <HomeIntelligenceEfficiency snapshot={lowCostSnapshot} />,
    );

    expect(html).toContain("$0.0050");
    expect(html).not.toContain(">$0.00<");
  });

  test("preserves legible horizontal chart panning at phone width", async () => {
    const css = await Bun.file(
      new URL("../styles/intelligence-efficiency.css", import.meta.url),
    ).text();

    expect(css).toContain("@media (max-width: 600px)");
    expect(css).toMatch(
      /@media \(max-width: 1180px\) \{[\s\S]*?\.intelligence-efficiency__charts \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/u,
    );
    expect(css).toContain(".intelligence-efficiency__plot-scroll");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain("min-width: 560px");
    expect(css).toContain(".intelligence-efficiency__label--focus");
    expect(css).toContain("font-size: 13.5px");
  });
});
