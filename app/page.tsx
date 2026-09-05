import { MarketingProofFrame, ProductHero } from "@hraness/design-kit/react/server";
import { createPublicSiteMetadata } from "@hraness/web-discovery";
import { Suspense } from "react";
import artificialAnalysisIntelligenceData from "@/data/artificial-analysis-intelligence.json";
import codingAgentData from "@/data/coding-agents.json";
import terminalBenchData from "@/data/terminal-bench.json";
import terminalBenchScienceData from "@/data/terminal-bench-science.json";
import { CodingAgentExplorer } from "@/components/coding-agent-explorer";
import { HomeBenchmarkPortfolio } from "@/components/home-benchmark-portfolio";
import { HomeClosing } from "@/components/home-closing";
import { HomeEditorialResources } from "@/components/home-editorial-resources";
import { HomeIntelligenceEfficiency } from "@/components/home-intelligence-efficiency";
import { HomeOrientation } from "@/components/home-orientation";
import { ProjectAskAiAboutThis } from "@/components/project-ask-ai-about-this";
import { RouteLoadingState } from "@/components/route-state";
import { SiteHeader } from "@/components/site-header";
import { parseArtificialAnalysisIntelligenceSnapshot } from "@/lib/artificial-analysis-intelligence-data";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";
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
      <main className="hraness-marketing-page aicharts-home" data-hraness-marketing="page" id="main-content">
        <ProductHero
          actions={[
            { href: "#intelligence-index", label: "Jump to the chart" },
            { href: "/models", label: "Browse the cards" },
          ]}
          eyebrow="Sourced benchmark charts"
          frame={(
            <MarketingProofFrame
              caption={`Retrieved ${formatRetrievedAt(intelligence.source.retrievedAt)} from the ${intelligence.source.name} public models leaderboard.`}
              className="aicharts-home__frame"
              title={`Intelligence Index v${intelligence.benchmark.version} · ${site.domain}`}
            >
              <HomeIntelligenceEfficiency snapshot={intelligence} />
            </MarketingProofFrame>
          )}
          heading={homeHeading}
          headingId="home-title"
          name={site.name}
          summary={homeLede}
        />
        <HomeOrientation />
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
            <HomeEditorialResources />
          </CodingAgentExplorer>
        </Suspense>
        <HomeClosing snapshot={parsed.value} />
      </main>
      <ProjectAskAiAboutThis url={site.origin} />
    </>
  );
}
