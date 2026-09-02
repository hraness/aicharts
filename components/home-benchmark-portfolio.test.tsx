import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CORE_BENCHMARK_PORTFOLIO,
  HomeBenchmarkPortfolio,
  type TerminalBenchPortfolioSnapshot,
  type TerminalBenchSciencePortfolioSnapshot,
} from "./home-benchmark-portfolio";

const terminalBench: TerminalBenchPortfolioSnapshot = {
  version: "4.0.0",
  retrievedAt: "2026-09-01T18:30:00.000Z",
  sourceLabel: "Official leaderboard · 66 tasks × 5 trials · abc123",
  sourceUrl: "https://github.com/harbor-framework/terminal-bench/tree/abc123/leaderboard",
  entries: [
    {
      id: "lower-score",
      model: "Model B",
      agent: "Agent B",
      agentVersion: "2.0",
      organization: "Lab B",
      reasoningEffort: "high",
      score: 37.27,
      confidenceInterval95: 3.78,
      totalCostUsd: 2541.7,
    },
    {
      id: "top-score",
      model: "Model A",
      agent: "Agent A",
      score: 44.55,
      confidenceInterval95: 3.85,
      totalCostUsd: 7265.01,
    },
  ],
};

const terminalBenchScience: TerminalBenchSciencePortfolioSnapshot = {
  version: "0.1.0",
  retrievedAt: "2026-09-02T14:22:12.000Z",
  sourceLabel: "Owner leaderboard · 70 tasks × 3 trials",
  sourceUrl: "https://hub.harborframework.com/datasets/terminal-bench-science/terminal-bench-science/0.1.0?leaderboard=v0-1-eval&tab=leaderboard",
  entries: [
    {
      harness: "Codex",
      id: "gpt",
      model: "GPT-5.6 Sol",
      organization: "OpenAI",
      rank: 2,
      reasoningEffort: "max",
      score: 22.380952380952383,
      standardError: 2.876164947101791,
      totalCostUsd: 4_221.8683028,
    },
    {
      harness: "Claude Code",
      id: "opus",
      model: "Opus 5",
      organization: "Anthropic",
      rank: 1,
      reasoningEffort: "max",
      score: 30,
      standardError: 3.162277660168379,
      totalCostUsd: 6_992.67732375,
    },
  ],
};

describe("homepage benchmark portfolio", () => {
  test("keeps five versioned core signals and one closed supplemental signal distinct", () => {
    const html = renderToStaticMarkup(<HomeBenchmarkPortfolio />);

    expect(CORE_BENCHMARK_PORTFOLIO).toHaveLength(5);
    expect(html).toContain('aria-labelledby="home-benchmark-portfolio-title"');
    expect(html).toContain("Five benchmark roles, one coding standard");
    expect(html).toContain("Checked score views stay on their native");
    expect(html).toContain("Terminal-Bench 4 is the coding standard");
    expect(html).toContain("Terminal-Bench-Science");
    expect(html).toContain("GDPval-AA");
    expect(html).toContain("OSWorld");
    expect(html).toContain("osworld-v2-2026.08.08");
    expect(html).toContain("Humanity’s Last Exam");
    expect(html).toContain("never mix classic HLE with HLE-Rolling");
    expect(html.match(/home-benchmark-portfolio__standard/gu)).toHaveLength(1);
    expect(html).toContain("Supplemental · closed");
    expect(html).toContain("CursorBench 3.2");
    expect(html).toContain("does not replace the public coding standard");
    expect(html).not.toContain("AutomationBench");
    expect(html).not.toContain("AA Index");
    expect(html).not.toContain("DeepSWE");
    expect(html).not.toContain("SWE-Atlas");
  });

  test("renders a compact, sorted Terminal-Bench 4 leaderboard with provenance", () => {
    const html = renderToStaticMarkup(
      <HomeBenchmarkPortfolio terminalBench={terminalBench} />,
    );

    expect(html).toContain("Terminal-Bench 4.0.0 snapshot");
    expect(html).toContain("Official leaderboard · 66 tasks × 5 trials · abc123");
    expect(html).toContain('<time dateTime="2026-09-01T18:30:00.000Z">Sep 1, 2026</time>');
    expect(html).toContain("Highest Terminal-Bench 4 accuracy scores");
    expect(html).toContain("95% interval");
    expect(html).toContain("Evaluation cost");
    expect(html).toContain("44.6%");
    expect(html).toContain("±3.9 points");
    expect(html).toContain("$7,265");
    expect(html.indexOf("Model A")).toBeLessThan(html.indexOf("Model B"));
    expect(html).toContain("Agent B 2.0 · high · Lab B");
    expect(html).toContain('<meter aria-hidden="true" max="100" min="0" value="44.55"></meter>');
    expect(html).toContain("Measures");
    expect(html).toContain("Comparison rule");
  });

  test("does not mix an older Terminal-Bench snapshot into the standard view", () => {
    const html = renderToStaticMarkup(
      <HomeBenchmarkPortfolio
        terminalBench={{ ...terminalBench, version: "2.1" }}
      />,
    );

    expect(html).toContain("Terminal-Bench leaderboard held back");
    expect(html).toContain("The coding-standard view accepts exact Terminal-Bench 4.0.0 results only");
    expect(html).not.toContain("Model A");
    expect(html).not.toContain("44.6%");

    const futureMinor = renderToStaticMarkup(
      <HomeBenchmarkPortfolio
        terminalBench={{ ...terminalBench, version: "4.1.0" }}
      />,
    );
    expect(futureMinor).toContain("leaderboard held back");
    expect(futureMinor).not.toContain("Model A");
  });

  test("renders a separate owner-sourced scientific-workflow leaderboard", () => {
    const html = renderToStaticMarkup(
      <HomeBenchmarkPortfolio terminalBenchScience={terminalBenchScience} />,
    );

    expect(html).toContain("Terminal-Bench-Science 0.1.0 snapshot");
    expect(html).toContain("Owner leaderboard · 70 tasks × 3 trials");
    expect(html).toContain("Highest Terminal-Bench-Science 0.1 resolution rates");
    expect(html).toContain("Resolution rate");
    expect(html).toContain("Standard error");
    expect(html).toContain("30.0%");
    expect(html).toContain("±3.2 points");
    expect(html).toContain("$6,993");
    expect(html.indexOf("Opus 5")).toBeLessThan(html.indexOf("GPT-5.6 Sol"));

    const incompatible = renderToStaticMarkup(
      <HomeBenchmarkPortfolio
        terminalBenchScience={{ ...terminalBenchScience, version: "0.2.0" }}
      />,
    );
    expect(incompatible).toContain("Terminal-Bench-Science leaderboard held back");
    expect(incompatible).not.toContain("Opus 5");
  });

  test("preserves the owner's rank when tied science scores use a cost tie-break", () => {
    const tiedSnapshot: TerminalBenchSciencePortfolioSnapshot = {
      ...terminalBenchScience,
      entries: [
        {
          ...terminalBenchScience.entries[0]!,
          id: "higher-cost",
          model: "Alpha Model",
          rank: 2,
          score: 25,
          totalCostUsd: 200,
        },
        {
          ...terminalBenchScience.entries[1]!,
          id: "lower-cost",
          model: "Zulu Model",
          rank: 1,
          score: 25,
          totalCostUsd: 100,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <HomeBenchmarkPortfolio terminalBenchScience={tiedSnapshot} />,
    );

    expect(html.indexOf("Zulu Model")).toBeLessThan(html.indexOf("Alpha Model"));
    expect(html).toContain('<th scope="row">1</th><td><strong>Zulu Model</strong>');
    expect(html).toContain('<th scope="row">2</th><td><strong>Alpha Model</strong>');
  });
});
