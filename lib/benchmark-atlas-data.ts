// Server assembly only. Client components receive these projections through props.
import intelligenceJson from "../data/artificial-analysis-intelligence.json";
import codingJson from "../data/coding-agents.json";
import terminalBenchJson from "../data/terminal-bench.json";
import scienceJson from "../data/terminal-bench-science.json";
import { parseArtificialAnalysisIntelligenceSnapshot, type ArtificialAnalysisIntelligenceSnapshot } from "./artificial-analysis-intelligence-data";
import type { BenchmarkAtlasDataset, BenchmarkAtlasPoint } from "./benchmark-atlas";
import { parseCodingAgentSnapshot, type BenchmarkMetric, type CodingAgentSnapshot } from "./coding-agent-data";
import { parseTerminalBenchSnapshot, type TerminalBenchSnapshot } from "./terminal-bench-data";
import { parseTerminalBenchScienceSnapshot, type TerminalBenchScienceSnapshot } from "./terminal-bench-science-data";
import type { Result } from "./result";

function checked<Value>(result: Result<Value, Error>, label: string): Value {
  if (!result.ok) throw new Error(`Invalid checked ${label} snapshot: ${result.error.message}`, { cause: result.error });
  return result.value;
}

export function intelligenceAtlasDataset(snapshot: ArtificialAnalysisIntelligenceSnapshot): BenchmarkAtlasDataset {
  return {
    benchmarkId: "aa-intelligence",
    version: snapshot.benchmark.version,
    score: { label: "Intelligence Index", unit: "index points", direction: "higher", minimum: 0, maximum: 100 },
    source: { name: snapshot.source.name, url: snapshot.source.url, retrievedAt: snapshot.source.retrievedAt },
    evidenceLabel: "Independent evaluation · historical version",
    configurationLabel: "Model and reasoning effort",
    comparabilityNote: "Historical v4.1.1 snapshot of the nine-evaluation index. The publisher introduced v4.3 on September 7; those results are not merged here. Effort settings and missing costs remain explicit.",
    costLabel: "USD per Intelligence Index task",
    points: snapshot.records.map(record => ({
      id: record.id,
      label: record.name,
      model: record.release.name,
      provider: record.creator.name,
      harness: null,
      effort: record.effort?.label ?? null,
      score: record.intelligenceIndex,
      costUsd: record.costUsdPerTask?.total ?? null,
      uncertainty: null,
      sourceUrl: record.detailsUrl,
      details: [{ label: "Output tokens per task", value: record.outputTokensPerTask.total.toLocaleString("en-US", { maximumFractionDigits: 0 }) }],
    })),
  };
}

const CODING_DATASET_DEFINITIONS = [
  { id: "deep-swe", metric: "deepSwe", version: "deep-swe", label: "DeepSWE", unit: "%" },
  { id: "aa-coding-index", metric: "aaIndex", version: "AA coding suite", label: "Coding Agent Index", unit: "index points" },
  { id: "terminal-bench-2-1", metric: "terminalBench", version: "2.1", label: "Terminal-Bench v2.1", unit: "%" },
  { id: "swe-atlas", metric: "sweAtlas", version: "swe-atlas-qna", label: "SWE-Atlas-QnA", unit: "%" },
] as const satisfies readonly Readonly<{ id: string; metric: BenchmarkMetric; version: string; label: string; unit: string }>[];

export function codingAtlasDatasets(snapshot: CodingAgentSnapshot): readonly BenchmarkAtlasDataset[] {
  return CODING_DATASET_DEFINITIONS.map(definition => ({
    benchmarkId: definition.id,
    version: definition.version,
    score: { label: definition.label, unit: definition.unit, direction: "higher", minimum: 0, maximum: 100 },
    source: { name: snapshot.source.name, url: snapshot.source.url, retrievedAt: snapshot.source.retrievedAt },
    evidenceLabel: "Independent evaluation",
    configurationLabel: "Model, coding agent, and effort",
    comparabilityNote: "Each point is an Artificial Analysis coding-agent configuration. Cost covers the source’s coding suite, not an isolated run of the selected benchmark. These results stay separate from other evaluators and Terminal-Bench 4.",
    costLabel: "USD per task across the AA coding suite",
    points: snapshot.records.flatMap((record): BenchmarkAtlasPoint[] => {
      const score = record.benchmarks[definition.metric];
      if (score === null) return [];
      return [{
        id: record.id,
        label: `${record.model} · ${record.agent} · ${record.setting}`,
        model: record.model,
        provider: record.providerName,
        harness: record.agent,
        effort: record.setting,
        score,
        costUsd: record.economics.costUsd,
        uncertainty: null,
        sourceUrl: snapshot.source.url,
        details: [
          ...(record.economics.durationSeconds === null ? [] : [{ label: "Coding-suite time per task", value: `${(record.economics.durationSeconds / 60).toFixed(1)} min` }]),
          ...(record.usage.totalTokens === null ? [] : [{ label: "Coding-suite tokens per task", value: record.usage.totalTokens.toLocaleString("en-US", { maximumFractionDigits: 0 }) }]),
        ],
      }];
    }),
  }));
}

export function terminalBenchAtlasDataset(snapshot: TerminalBenchSnapshot): BenchmarkAtlasDataset {
  return {
    benchmarkId: "terminal-bench-4",
    version: snapshot.benchmark.version,
    score: { label: "Task success", unit: "%", direction: "higher", minimum: 0, maximum: 100 },
    source: { name: snapshot.source.name, url: snapshot.source.leaderboardUrl, retrievedAt: snapshot.source.retrievedAt, revision: snapshot.source.repositoryCommit },
    evidenceLabel: "Owner-published submissions",
    configurationLabel: "Model, agent version, and effort",
    comparabilityNote: `${snapshot.benchmark.taskCount} tasks × ${snapshot.benchmark.trialsPerTask} trials per configuration. Model, agent, and effort all affect results. The owner reports 95% confidence intervals; its interval method and price basis are unspecified.`,
    costLabel: `USD for the full ${snapshot.benchmark.trialsPerConfiguration}-trial evaluation`,
    points: snapshot.records.map(record => ({
      id: record.id,
      label: `${record.model.display.label} · ${record.harness.display.label} · ${record.reasoningEffort}`,
      model: record.model.display.label,
      provider: record.model.organization.label,
      harness: `${record.harness.display.label} ${record.harness.version}`,
      effort: record.reasoningEffort,
      score: record.metrics.accuracyPercent,
      costUsd: record.metrics.totalCostUsd,
      uncertainty: {
        lower: Math.max(0, record.metrics.accuracyPercent - record.metrics.accuracyCi95HalfWidthPercent),
        upper: Math.min(100, record.metrics.accuracyPercent + record.metrics.accuracyCi95HalfWidthPercent),
        label: "Source-reported 95% confidence interval",
      },
      sourceUrl: record.sourceUrl,
      details: [
        { label: "Trials", value: String(record.metrics.nTrials) },
        { label: "Average trial duration", value: `${(record.metrics.averageTrialDurationSeconds / 60).toFixed(1)} min` },
      ],
    })),
  };
}

export function scienceAtlasDataset(snapshot: TerminalBenchScienceSnapshot): BenchmarkAtlasDataset {
  return {
    benchmarkId: "terminal-bench-science",
    version: snapshot.benchmark.version,
    score: { label: "Resolution rate", unit: "%", direction: "higher", minimum: 0, maximum: 100 },
    source: { name: snapshot.source.name, url: snapshot.source.leaderboardUrl, retrievedAt: snapshot.source.retrievedAt, revision: snapshot.source.releaseCommit },
    observedAt: snapshot.source.leaderboardUpdatedAt,
    evidenceLabel: "Owner leaderboard",
    configurationLabel: "Model, coding agent, and effort",
    comparabilityNote: `${snapshot.benchmark.taskCount} science tasks × ${snapshot.benchmark.trialsPerTask} trials. Error bars show one binomial standard error, not a 95% confidence interval. Model and agent versions, price basis, and several run limits are unspecified.`,
    costLabel: `USD for the full ${snapshot.benchmark.trialsPerConfiguration}-trial evaluation`,
    points: snapshot.records.map(record => ({
      id: record.id,
      label: `${record.model.display.label} · ${record.harness.display.label} · ${record.reasoningEffort}`,
      model: record.model.display.label,
      provider: record.model.organization.label,
      harness: record.harness.display.label,
      effort: record.reasoningEffort,
      score: record.metrics.resolutionRatePercent,
      costUsd: record.metrics.totalCostUsd,
      uncertainty: {
        lower: Math.max(0, record.metrics.resolutionRatePercent - record.metrics.standardErrorPercent),
        upper: Math.min(100, record.metrics.resolutionRatePercent + record.metrics.standardErrorPercent),
        label: "Source-reported ±1 binomial standard error",
      },
      sourceUrl: record.sourceUrl,
      details: Object.entries(record.metrics.domains).map(([domain, metrics]) => ({
        label: `${domain[0]!.toUpperCase()}${domain.slice(1)} science`,
        value: `${metrics.resolutionRatePercent.toFixed(1)}% · ${metrics.nTrials} trials`,
      })),
    })),
  };
}

export const BENCHMARK_ATLAS_DATASETS: readonly BenchmarkAtlasDataset[] = [
  intelligenceAtlasDataset(checked(parseArtificialAnalysisIntelligenceSnapshot(intelligenceJson), "Intelligence Index")),
  terminalBenchAtlasDataset(checked(parseTerminalBenchSnapshot(terminalBenchJson), "Terminal-Bench 4")),
  scienceAtlasDataset(checked(parseTerminalBenchScienceSnapshot(scienceJson), "Terminal-Bench-Science")),
  ...codingAtlasDatasets(checked(parseCodingAgentSnapshot(codingJson), "coding-agent")),
];

export function getBenchmarkAtlasDataset(id: string): BenchmarkAtlasDataset | undefined {
  return BENCHMARK_ATLAS_DATASETS.find(dataset => dataset.benchmarkId === id);
}
