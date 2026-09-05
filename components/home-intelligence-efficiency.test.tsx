import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_CITATION,
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_SELECTION_RULE,
  type ArtificialAnalysisIntelligenceRecord,
  type ArtificialAnalysisIntelligenceSnapshot,
} from "@/lib/artificial-analysis-intelligence-data";

import { HomeIntelligenceEfficiency } from "./home-intelligence-efficiency";
import {
  nearestIntelligencePointId,
  nextIntelligencePointId,
  projectIntelligenceExplorerGeometry,
  roundIntelligenceChartCoordinate,
  shouldPreviewIntelligencePointer,
} from "./intelligence-efficiency-explorer";

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
  test("renders one accessible interactive view with the exact benchmark version", () => {
    const html = renderToStaticMarkup(<HomeIntelligenceEfficiency snapshot={snapshot} />);

    expect(html).toContain("Artificial Analysis Intelligence Index v4.1.1");
    expect(html.match(/<svg/gu)).toHaveLength(1);
    expect(html.match(/role="group"/gu)).toHaveLength(2);
    expect(html.match(/role="button"/gu)).toHaveLength(127);
    expect(html.match(/tabindex="0"/gu)).toHaveLength(1);
    expect(html).toContain("Use arrow keys to move between points");
    expect(html).toContain("Higher and farther left is better");
    expect(html).toContain("Output tokens per task (log scale)");
    expect(html).toContain('data-intelligence-metric="outputTokensPerTask"');
    expect(html).toContain('data-intelligence-metric="costUsdPerTask"');
    expect(html).toContain('aria-pressed="true" data-intelligence-metric="outputTokensPerTask"');
    expect(html).toContain("intelligence-efficiency__point-control--astra");
    expect(html).toContain("intelligence-efficiency__point-control--sol");
    expect(html).toContain("Efficiency frontier");
  });

  test("keeps the finding concise while exposing exact values in a persistent inspector", () => {
    const html = renderToStaticMarkup(<HomeIntelligenceEfficiency snapshot={snapshot} />);

    expect(html).toContain("General capability · model-level");
    expect(html).toContain("GPT-6 Astra and GPT-5.6 Sol both round to 61");
    expect(html).toContain("11.9% fewer output tokens");
    expect(html).toContain("75.0% more per task");
    expect(html).toContain("Selected configuration");
    expect(html).toContain("Intelligence Index");
    expect(html).toContain("14,875.6");
    expect(html).toContain("$1.67");
    expect(html).toContain("View publisher record ↗");
    expect(html).not.toContain("Coding Agent Index");
    expect(html).not.toContain("AA Index");
    expect(html).not.toContain("Terminal-Bench 4");
  });

  test("keeps compact data links visible and detailed provenance in one disclosure", () => {
    const html = renderToStaticMarkup(<HomeIntelligenceEfficiency snapshot={snapshot} />);

    expect(html).toContain('href="/data#artificial-analysis-intelligence"');
    expect(html).toContain('href="/data/artificial-analysis-intelligence.json"');
    expect(html).toContain("Full data and methodology");
    expect(html).toContain("Download JSON");
    expect(html.match(/<details/gu)).toHaveLength(1);
    expect(html).toContain("Method &amp; data");
    expect(html).toContain("Output tokens are answer plus reasoning generated per Intelligence Index task");
    expect(html).toContain("exclude input and cache traffic");
    expect(html).toContain("Artificial Analysis public models leaderboard");
    expect(html).toContain('href="https://artificialanalysis.ai/models"');
    expect(html).toContain('<time dateTime="2026-09-04T02:30:00.000Z">Sep 4, 2026</time>');
    expect(html).toContain("first-party public Next.js page payload");
    expect(html).toContain("The source has 127 records");
    expect(html).toContain("127 meet the non-estimated complete-measure rule");
    expect(html).toContain("127 also report a positive task cost");
    expect(html).toContain("No benchmark families are blended");
    expect(html).toContain("9-evaluation index");
    expect(html).toContain("agents 34% · coding 24% · scientific 24% · general 18%");
    expect(html).toContain('href="https://artificialanalysis.ai/methodology/intelligence-benchmarking"');
    expect(html).toContain('href="https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf"');
    expect(html).toContain('data-analytics-surface="benchmark_chart"');
    expect(html).toContain('data-analytics-destination-id="source:artificial-analysis-methodology"');
  });

  test("removes the duplicated 127-row homepage table while keeping every point inspectable", () => {
    const html = renderToStaticMarkup(<HomeIntelligenceEfficiency snapshot={snapshot} />);

    expect(html).not.toContain("<table");
    expect(html).not.toContain("Cohort rank");
    expect(html.match(/role="button"/gu)).toHaveLength(127);
    for (const item of records) {
      expect(html).toContain(`aria-label="${item.name}, Example Lab`);
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

  test("uses native-width responsive plotting without forced horizontal panning", async () => {
    const css = await Bun.file(
      new URL("../styles/intelligence-efficiency.css", import.meta.url),
    ).text();

    expect(css).toContain("@media (max-width: 620px)");
    expect(css).toContain(".intelligence-efficiency__plot");
    expect(css).toContain("min-width: 0");
    expect(css).toContain(".intelligence-efficiency__svg");
    expect(css).toContain("width: 100%");
    expect(css).not.toContain("overflow-x: auto");
    expect(css).not.toContain("min-width: 560px");
    expect(css).toContain(".intelligence-efficiency__point-control:focus-visible");
  });

  test("keys the frontier with the same connecting line and open-circle glyph as the plot", async () => {
    const source = await Bun.file(
      new URL("./intelligence-efficiency-explorer.tsx", import.meta.url),
    ).text();
    const css = await Bun.file(
      new URL("../styles/intelligence-efficiency.css", import.meta.url),
    ).text();

    expect(source).toContain('return <circle className="intelligence-efficiency__point-glyph" cx={point.x} cy={point.y} r="3" />;');
    expect(css).toMatch(/i\[data-symbol="frontier"\]::before\s*\{[^}]*border-top:\s*1px solid var\(--brand-key\);/su);
    expect(css).toMatch(/i\[data-symbol="frontier"\]::after\s*\{[^}]*border:\s*1px solid var\(--brand-key\);[^}]*border-radius:\s*50%;/su);
    expect(css).not.toMatch(/i\[data-symbol="frontier"\]\s*\{[^}]*rotate\(45deg\)/su);
  });

  test("moves keyboard focus to the closest point in the requested direction", () => {
    const points = [
      { id: "upper-left", x: 0, y: 0 },
      { id: "upper-right", x: 10, y: 1 },
      { id: "lower-left", x: 1, y: 10 },
      { id: "lower-right", x: 12, y: 12 },
    ];

    expect(nextIntelligencePointId(points, "upper-left", "ArrowRight")).toBe("upper-right");
    expect(nextIntelligencePointId(points, "upper-left", "ArrowDown")).toBe("lower-left");
    expect(nextIntelligencePointId(points, "lower-right", "ArrowLeft")).toBe("lower-left");
    expect(nextIntelligencePointId(points, "lower-right", "ArrowUp")).toBe("upper-right");
    expect(nextIntelligencePointId(points, "upper-right", "Home")).toBe("upper-left");
    expect(nextIntelligencePointId(points, "upper-left", "End")).toBe("lower-right");
    expect(nextIntelligencePointId(points, "upper-left", "ArrowLeft")).toBe("upper-left");
  });

  test("quantizes rendered SVG geometry so hydration cannot expose math-library tails", () => {
    const html = renderToStaticMarkup(<HomeIntelligenceEfficiency snapshot={snapshot} />);
    const svg = html.match(/<svg[\s\S]*?<\/svg>/u)?.[0];
    expect(svg).toBeDefined();

    const geometryValues = [...(svg ?? "").matchAll(
      /\s(?:cx|cy|height|r|width|x|x1|x2|y|y1|y2)="(-?\d+(?:\.(\d+))?)"/gu,
    )];
    expect(geometryValues.length).toBeGreaterThan(500);
    expect(geometryValues.every(match => (match[2]?.length ?? 0) <= 2)).toBeTrue();

    const pathValues = [...(svg ?? "").matchAll(/\sd="([^"]+)"/gu)]
      .flatMap(match => [...(match[1] ?? "").matchAll(/-?\d+\.(\d+)/gu)]);
    expect(pathValues.length).toBeGreaterThan(0);
    expect(pathValues.every(match => (match[1]?.length ?? 0) <= 2)).toBeTrue();

    expect(roundIntelligenceChartCoordinate(196.64821318629254)).toBe(196.65);
    expect(roundIntelligenceChartCoordinate(196.64821318629268)).toBe(196.65);
  });

  test("routes an overlapping mobile tap to the nearest point instead of DOM order", () => {
    const chartData = records.map(item => ({
      costUsdPerTask: item.costUsdPerTask?.total ?? 0,
      creatorId: item.creator.id,
      creatorName: item.creator.name,
      detailsUrl: item.detailsUrl,
      id: item.id,
      intelligenceIndex: item.intelligenceIndex,
      isCostFrontier: false,
      isOutputFrontier: false,
      name: item.name,
      outputTokensPerTask: item.outputTokensPerTask.total,
      releaseDate: item.releaseDate,
    }));
    const mobile = projectIntelligenceExplorerGeometry(
      chartData,
      "outputTokensPerTask",
      [0, 70],
      390,
    );
    const astraPoint = mobile.points.find(point => point.id === astra.id);
    const solPoint = mobile.points.find(point => point.id === sol.id);
    expect(astraPoint).toBeDefined();
    expect(solPoint).toBeDefined();
    if (astraPoint === undefined || solPoint === undefined) return;

    expect(Math.hypot(astraPoint.x - solPoint.x, astraPoint.y - solPoint.y)).toBeLessThan(24);
    expect(nearestIntelligencePointId(mobile.points, astraPoint.x, astraPoint.y)).toBe(astra.id);
    expect(nearestIntelligencePointId(mobile.points, solPoint.x, solPoint.y)).toBe(sol.id);
    expect(nearestIntelligencePointId(mobile.points, 390, 350, 4)).toBeNull();
  });

  test("shows a pointer cursor only while nearest-point routing has a hover target", async () => {
    const source = await Bun.file(
      new URL("./intelligence-efficiency-explorer.tsx", import.meta.url),
    ).text();
    const css = await Bun.file(
      new URL("../styles/intelligence-efficiency.css", import.meta.url),
    ).text();

    expect(source).toContain('style={hoveredId === null ? undefined : { cursor: "pointer" }}');
    expect(source).toContain("isAssistiveSvgClick(event.detail)");
    expect(source).toContain("onPointerCancel={() => setHoveredId(null)}");
    expect(source).toContain("onPointerMove={handlePlotPointerMove}");
    expect(css).not.toContain("cursor: crosshair");
    expect(css).not.toMatch(/\.intelligence-efficiency__svg\s*\{[^}]*cursor:/u);
  });

  test("ignores touch movement previews and clears cancelled pointer state", () => {
    expect(shouldPreviewIntelligencePointer("touch")).toBeFalse();
    expect(shouldPreviewIntelligencePointer("mouse")).toBeTrue();
    expect(shouldPreviewIntelligencePointer("pen")).toBeTrue();
  });
});
