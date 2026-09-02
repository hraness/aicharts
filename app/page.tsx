import { createPublicSiteMetadata } from "@hraness/web-discovery";
import { Suspense } from "react";
import codingAgentData from "@/data/coding-agents.json";
import terminalBenchData from "@/data/terminal-bench.json";
import terminalBenchScienceData from "@/data/terminal-bench-science.json";
import { CodingAgentExplorer } from "@/components/coding-agent-explorer";
import { HomeBenchmarkPortfolio } from "@/components/home-benchmark-portfolio";
import { HomeEditorialResources } from "@/components/home-editorial-resources";
import { ProjectAskAiAboutThis } from "@/components/project-ask-ai-about-this";
import { RouteLoadingState } from "@/components/route-state";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import { MODEL_CARD_VARIANTS } from "@/lib/model-card-collection";
import { parseTerminalBenchSnapshot } from "@/lib/terminal-bench-data";
import { parseTerminalBenchScienceSnapshot } from "@/lib/terminal-bench-science-data";

import { searchSite, site } from "./site";

export const metadata = createPublicSiteMetadata(searchSite, { canonicalPath: "/" });

export default function Home() {
  const input: unknown = codingAgentData;
  const parsed = parseCodingAgentSnapshot(input);
  if (!parsed.ok) throw new Error(`Checked coding-agent snapshot is invalid: ${parsed.error.message}`, { cause: parsed.error });
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
      <Suspense fallback={<RouteLoadingState />}>
        <CodingAgentExplorer
          brand={{ domain: site.domain, heading: site.domain }}
          modelCardPaths={modelCardPaths}
          overview={(
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
          )}
          snapshot={parsed.value}
        >
          <HomeEditorialResources />
        </CodingAgentExplorer>
      </Suspense>
      <ProjectAskAiAboutThis url={site.origin} />
    </>
  );
}
