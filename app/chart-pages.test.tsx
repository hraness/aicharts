import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BenchmarksPage, { metadata as benchmarksMetadata } from "./benchmarks/page";
import CalculatorPage, { metadata as calculatorMetadata } from "./calculator/page";
import CodingPage, { metadata as codingMetadata } from "./coding/page";
import LeaderboardPage, { metadata as leaderboardMetadata } from "./leaderboard/page";
import UsagePage, { metadata as usageMetadata } from "./usage/page";
import { ATLAS_DATASETS, ATLAS_ENTRIES } from "@/lib/benchmark-atlas-catalog";
import { CALCULATOR_INPUTS } from "@/lib/calculator-inputs-collection";

describe("focused chart destinations", () => {
  test("the benchmark page owns the complete library and one initial chart", () => {
    const html = renderToStaticMarkup(createElement(BenchmarksPage));
    expect(html).toContain("<h1>Explore benchmarks</h1>");
    expect(html).toContain(`${ATLAS_DATASETS.length} interactive charts`);
    expect(html).toContain(`${ATLAS_ENTRIES.length} benchmarks and guides`);
    expect(html).toContain('id="explore"');
    expect(html).toContain("<h2>Terminal-Bench 4</h2>");
    expect(html.match(/class="atlas-row"/gu)).toHaveLength(8);
    expect(html).not.toContain('class="intelligence-efficiency"');
    expect(html).not.toContain('class="chart-page-canvas"');
    expect(html.match(/<h1(?:\s|>)/gu)).toHaveLength(1);
    expect(benchmarksMetadata.alternates?.canonical).toBe("https://aicharts.io/benchmarks");
  });
  test("the coding page preserves the original chart without stacked benchmark portfolios", () => {
    const html = renderToStaticMarkup(createElement(CodingPage));
    expect(html).toContain("<h1>Coding agent comparisons</h1>");
    expect(html).toContain('class="benchmark-chart"');
    expect(html).toContain('id="coding-agents"');
    expect(html).toContain('id="chart"');
    expect(html).toContain('aria-label="Share and export chart"');
    expect(html).toContain('class="option-picker option-picker--list chart-benchmark-select"');
    expect(html).toContain("<strong>DeepSWE</strong>");
    expect(/<a\b(?=[^>]*href="\/coding")(?=[^>]*aria-current="page")[^>]*>Coding agents<\/a>/u.test(html)).toBeTrue();
    expect(html).toContain('/benchmarks?atlas=terminal-bench-4');
    expect(html).toContain('/benchmarks?atlas=terminal-bench-science');
    expect(html).toContain('href="/benchmarks?atlas=terminal-bench-science&amp;task=science#explore"');
    expect(html).not.toContain('class="benchmark-atlas"');
    expect(html).not.toContain('class="intelligence-efficiency"');
    expect(html).not.toContain("Terminal-Bench 4.0.0 snapshot");
    expect(html.match(/<h1(?:\s|>)/gu)).toHaveLength(1);
    expect(codingMetadata.alternates?.canonical).toBe("https://aicharts.io/coding");
  });
  test("the calculator page renders knobs, cost bars, and server-side provenance", () => {
    const html = renderToStaticMarkup(createElement(CalculatorPage));
    expect(html).toContain("<h1>Subscription vs API vs GPUs</h1>");
    expect(html).toContain('class="calculator-explorer"');
    expect(html).toContain("Monthly cost by path");
    expect(html).toContain("Ownership cost over the useful life");
    expect(html.match(/class="hraness-knob[" ]/gu)?.length).toBeGreaterThanOrEqual(9);
    expect(html.match(/class="calculator-bars"/gu)).toHaveLength(4);
    // The default 40x anchor: one seat implies $8,000 of API-equivalent monthly spend.
    expect(html).toContain("$8,000");
    // Owning is priced as explicit depreciation plus a configurable electricity rate.
    expect(html).toContain("Depreciation");
    expect(html).toContain("Electricity rate");
    // Provenance is server-rendered with dated citations for every live source.
    expect(html).toContain(CALCULATOR_INPUTS.openAiApiPricing.source.url);
    expect(html).toContain(CALCULATOR_INPUTS.deepSeekApiPricing.source.url);
    expect(html).toContain(CALCULATOR_INPUTS.electricity.source.url);
    expect(html).toContain(CALCULATOR_INPUTS.subsidyAnchor.methodSourceUrl);
    for (const preset of CALCULATOR_INPUTS.electricity.residentialPresets) {
      expect(html).toContain(preset.sourceUrl);
    }
    expect(html).toContain("Assumptions and limits");
    expect(html).not.toContain('class="benchmark-atlas"');
    expect(html).not.toContain('class="intelligence-efficiency"');
    expect(html.match(/<h1(?:\s|>)/gu)).toHaveLength(1);
    expect(calculatorMetadata.alternates?.canonical).toBe("https://aicharts.io/calculator");
  });
  test("the usage page makes local-only measurement and coverage explicit", () => {
    const html = renderToStaticMarkup(createElement(UsagePage));
    expect(html).toContain("Your AI work, measured without your words.");
    expect(html).toContain("Remote sync is not enabled yet.");
    expect(html).toContain("aicharts usage --key-file ./aicharts.key --codex ./sessions");
    expect(html).toContain("No transcript storage");
    expect(html).toContain('aria-current="page" href="/usage"');
    expect(usageMetadata.alternates?.canonical).toBe("https://aicharts.io/usage");
  });
  test("the leaderboard page keeps publishing paused until evidence is qualified", () => {
    const html = renderToStaticMarkup(createElement(LeaderboardPage));
    expect(html).toContain("A leaderboard that shows its receipts.");
    expect(html).toContain("Publishing paused");
    expect(html).toContain("No rankings before the evidence layer");
    expect(html).toContain('aria-current="page" href="/leaderboard"');
    expect(leaderboardMetadata.alternates?.canonical).toBe("https://aicharts.io/leaderboard");
  });
});
