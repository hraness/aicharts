import { createPublicSiteMetadata } from "@hraness/web-discovery";
import { Suspense } from "react";
import Link from "next/link";
import artificialAnalysisIntelligenceData from "@/data/artificial-analysis-intelligence.json";
import codingAgentData from "@/data/coding-agents.json";
import terminalBenchData from "@/data/terminal-bench.json";
import terminalBenchScienceData from "@/data/terminal-bench-science.json";
import { CodingAgentExplorer } from "@/components/coding-agent-explorer";
import { AdvancedCharts } from "@/components/advanced-charts";
import { BenchmarkAtlasExplorer } from "@/components/benchmark-atlas-explorer";
import { HomeBenchmarkPortfolio } from "@/components/home-benchmark-portfolio";
import { HomeEditorialResources } from "@/components/home-editorial-resources";
import { HomeIntelligenceEfficiency } from "@/components/home-intelligence-efficiency";
import { ProjectAskAiAboutThis } from "@/components/project-ask-ai-about-this";
import { RouteLoadingState } from "@/components/route-state";
import { SiteHeader } from "@/components/site-header";
import { parseArtificialAnalysisIntelligenceSnapshot } from "@/lib/artificial-analysis-intelligence-data";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import { ATLAS_DATASETS, ATLAS_ENTRIES } from "@/lib/benchmark-atlas-catalog";
import { MODEL_CARD_VARIANTS } from "@/lib/model-card-collection";
import { parseTerminalBenchSnapshot } from "@/lib/terminal-bench-data";
import { parseTerminalBenchScienceSnapshot } from "@/lib/terminal-bench-science-data";

import { homeHeading, homeLede, searchSite, site } from "./site";

export const metadata = createPublicSiteMetadata(searchSite, { canonicalPath: "/" });

export default function Home() {
  const input: unknown = codingAgentData;
  const parsed = parseCodingAgentSnapshot(input);
  if (!parsed.ok) throw new Error(`Checked coding-agent snapshot is invalid: ${parsed.error.message}`, { cause: parsed.error });
  const intelligenceInput: unknown = artificialAnalysisIntelligenceData;
  const parsedIntelligence = parseArtificialAnalysisIntelligenceSnapshot(intelligenceInput);
  if (!parsedIntelligence.ok) {
    throw new Error(
      `Checked Artificial Analysis Intelligence snapshot is invalid: ${parsedIntelligence.error.message}`,
      { cause: parsedIntelligence.error },
    );
  }
  const intelligence = parsedIntelligence.value;
  const terminalBenchInput: unknown = terminalBenchData;
  const parsedTerminalBench = parseTerminalBenchSnapshot(terminalBenchInput);
  if (!parsedTerminalBench.ok) {
    throw new Error(
      `Checked Terminal-Bench snapshot is invalid: ${parsedTerminalBench.error.message}`,
      { cause: parsedTerminalBench.error },
    );
  }
  const terminalBench = parsedTerminalBench.value;
  const terminalBenchScienceInput: unknown = terminalBenchScienceData;
  const parsedTerminalBenchScience = parseTerminalBenchScienceSnapshot(
    terminalBenchScienceInput,
  );
  if (!parsedTerminalBenchScience.ok) {
    throw new Error(
      `Checked Terminal-Bench-Science snapshot is invalid: ${parsedTerminalBenchScience.error.message}`,
      { cause: parsedTerminalBenchScience.error },
    );
  }
  const terminalBenchScience = parsedTerminalBenchScience.value;
  const modelCardPaths = Object.fromEntries(MODEL_CARD_VARIANTS.flatMap(variant => (
    variant.observations.map(observation => [observation.id, variant.path] as const)
  )));
  return (
    <>
      <SiteHeader current="/" />
      <main className="atlas-home" id="main-content">
        <header className="atlas-intro">
          <div><h1 id="home-title">{homeHeading}</h1><p>{homeLede}</p></div>
          <div className="atlas-intro__coverage"><strong>{ATLAS_DATASETS.length} interactive charts</strong> · {ATLAS_ENTRIES.length} benchmarks</div>
        </header>
        <BenchmarkAtlasExplorer entries={ATLAS_ENTRIES} datasets={ATLAS_DATASETS} />
        <section className="atlas-reading" aria-label="Make a useful comparison">
          <div><h2>Start with the task</h2><p>Code completion, scientific research, and image editing need different evidence. Pick the work you need done, then inspect the relevant benchmark.</p></div>
          <div><h2>Compare the full setup</h2><p>The same model can score differently with another agent, effort level, or tool budget. Open a result to see the configuration behind the number.</p></div>
          <div><h2>Read the date and the gap</h2><p>A leaderboard is a snapshot. Close scores may overlap within uncertainty, and older research cohorts may leave newer models untested.</p></div>
        </section>
        <AdvancedCharts>
        <HomeIntelligenceEfficiency snapshot={intelligence} />
        <Suspense fallback={<RouteLoadingState />}>
          <CodingAgentExplorer
            brand={{ domain: site.domain }}
            modelCardPaths={modelCardPaths}
            snapshot={parsed.value}
          >
            <HomeBenchmarkPortfolio
              terminalBench={{
                entries: terminalBench.records.map(record => ({
                  agent: record.harness.display.label,
                  agentVersion: record.harness.version,
                  confidenceInterval95: record.metrics.accuracyCi95HalfWidthPercent,
                  id: record.id,
                  model: record.model.display.label,
                  organization: record.model.organization.label,
                  reasoningEffort: record.reasoningEffort,
                  score: record.metrics.accuracyPercent,
                  totalCostUsd: record.metrics.totalCostUsd,
                })),
                retrievedAt: terminalBench.source.retrievedAt,
                sourceLabel: `${terminalBench.source.name} · ${terminalBench.benchmark.taskCount} tasks × ${terminalBench.benchmark.trialsPerTask} trials · ${terminalBench.source.repositoryCommit.slice(0, 7)}`,
                sourceUrl: terminalBench.source.submissionsDirectoryUrl,
                version: terminalBench.benchmark.version,
              }}
              terminalBenchScience={{
                entries: terminalBenchScience.records.map(record => ({
                  harness: record.harness.display.label,
                  id: record.id,
                  model: record.model.display.label,
                  organization: record.model.organization.label,
                  rank: record.rank,
                  reasoningEffort: record.reasoningEffort,
                  score: record.metrics.resolutionRatePercent,
                  standardError: record.metrics.standardErrorPercent,
                  totalCostUsd: record.metrics.totalCostUsd,
                })),
                retrievedAt: terminalBenchScience.source.retrievedAt,
                sourceLabel: `${terminalBenchScience.source.name} · ${terminalBenchScience.benchmark.taskCount} tasks × ${terminalBenchScience.benchmark.trialsPerTask} trials`,
                sourceUrl: terminalBenchScience.source.leaderboardUrl,
                version: terminalBenchScience.benchmark.version,
              }}
            />
          </CodingAgentExplorer>
        </Suspense>
        </AdvancedCharts>
        <HomeEditorialResources />
        <div className="atlas-footer-note"><Link href="/data">Data and sources</Link><Link href="/models">Shareable model cards</Link><a href="https://github.com/hraness/aicharts">Open-source project ↗</a><span>Built by <a href="https://x.com/hraness">Ben Guo</a></span></div>
      </main>
      <ProjectAskAiAboutThis url={site.origin} />
    </>
  );
}
