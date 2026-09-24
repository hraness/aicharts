import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BenchmarksPage, { metadata as benchmarksMetadata } from "./benchmarks/page";
import CalculatorPage, { metadata as calculatorMetadata } from "./calculator/page";
import CodingPage, { metadata as codingMetadata } from "./coding/page";
import { ATLAS_DATASETS, ATLAS_ENTRIES } from "@/lib/benchmark-atlas-catalog";
import { CALCULATOR_INPUTS } from "@/lib/calculator-inputs-collection";
import { LeaderboardView } from "@/components/usage/leaderboard-view";
import type { LeaderboardEntryV1 } from "@/lib/usage/leaderboard-contract";

// The request-time page imports the server-only read boundary; only its static
// metadata is asserted here. View states are rendered directly below.
mock.module("server-only", () => ({}));
const { metadata: leaderboardMetadata } = await import("./leaderboard/page");

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
    expect(html).toContain("<strong>DeepSWE v1.1</strong>");
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
  // Usage now needs a real Next request scope. Its copy, current navigation and
  // canonical metadata assertions live in scripts/usage-browser.ts instead of
  // depending on another Bun test's global server-only mock.
  test("the leaderboard page renders paused, unavailable, empty, and ranked states honestly", () => {
    const paused = renderToStaticMarkup(createElement(LeaderboardView, { available: false, snapshot: null }));
    expect(paused).toContain("Public usage leaderboard");
    expect(paused).toContain("Not live yet");
    expect(paused).toContain("No public rankings yet");
    expect(paused).not.toContain("Reload rankings");
    const unavailable = renderToStaticMarkup(createElement(LeaderboardView, { available: true, snapshot: null }));
    expect(unavailable).toContain("Rankings could not be loaded");
    expect(unavailable).toContain("Reload rankings");
    expect(unavailable).not.toContain("Not live yet");
    expect(unavailable).not.toContain("No published entries yet");
    const empty = renderToStaticMarkup(createElement(LeaderboardView, { available: true,
      snapshot: { schemaVersion: 1, ranking: "observed-tokens-30d-v1", computedAtMs: 1_800_000_000_000, entries: [] } }));
    expect(empty).toContain("Opt-in publishing");
    expect(empty).toContain("0 entries");
    expect(empty).toContain("No published entries yet");
    expect(empty).not.toContain("Not live yet");
    const entries: LeaderboardEntryV1[] = [
      { rank: 1, publicHandle: "alpha-coder", observedTokens: "9007199254740993", usageRecords: 42,
        consentedAtMs: 1_799_000_000_000, refreshedAtMs: 1_800_000_000_000, windowFirstUtcDay: 20_900, windowUtcDays: 30 },
      { rank: 2, publicHandle: "beta-agent", observedTokens: "1234567", usageRecords: 9,
        consentedAtMs: 1_799_500_000_000, refreshedAtMs: 1_800_000_000_000, windowFirstUtcDay: 20_900, windowUtcDays: 30 },
    ];
    const board = renderToStaticMarkup(createElement(LeaderboardView, { available: true,
      snapshot: { schemaVersion: 1, ranking: "observed-tokens-30d-v1", computedAtMs: 1_800_000_000_000, entries } }));
    expect(board).toContain("Published rankings");
    expect(board).toContain("alpha-coder");
    expect(board).toContain("beta-agent");
    expect(board).toContain("9,007,199,254,740,993");
    expect(board).toContain("Last refreshed");
    expect(board).toContain("Coverage (UTC)");
    expect(board).toContain("not independently verified or a provider billing record");
    // The ranked snapshot carries handles and numerics only; page copy may
    // describe the excluded fields but the data never contains them.
    const serialized = JSON.stringify(entries);
    for (const marker of ["acct_", "deviceId", "email", "sessionSecret"]) {
      expect(serialized.includes(marker)).toBe(false);
    }
    expect(leaderboardMetadata.alternates?.canonical).toBe("https://aicharts.io/leaderboard");
  });
});
