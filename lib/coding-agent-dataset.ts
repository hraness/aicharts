import type {
  BenchmarkMetric,
  CodingAgentRecord,
  CodingAgentSnapshot,
} from "./coding-agent-data";
import { yMetricDescriptions, yMetricLabels } from "./chart-math";
import { absoluteWebUrl, type SearchSite } from "./web-discovery";

export const CODING_AGENT_DATASET_PATH = "/data" as const;
export const CODING_AGENT_DATASET_DOWNLOAD_PATH = "/data/coding-agents.json" as const;
export const CODING_AGENT_DATASET_DESCRIPTION =
  "Download the current Artificial Analysis coding-agent benchmark snapshot, with benchmark definitions, provenance, leaders, methodology, and limitations.";

const benchmarkMetrics = [
  "aaIndex",
  "deepSwe",
  "terminalBench",
  "sweAtlas",
] as const satisfies readonly BenchmarkMetric[];

export type CodingAgentBenchmarkDefinition = Readonly<{
  description: string;
  id: BenchmarkMetric;
  label: string;
  unit: string;
}>;

export const CODING_AGENT_BENCHMARK_DEFINITIONS = benchmarkMetrics.map(
  (id): CodingAgentBenchmarkDefinition => ({
    description: yMetricDescriptions[id],
    id,
    label: yMetricLabels[id],
    unit: "Score on a 0–100 scale",
  }),
);

export type CodingAgentDatasetSummary = Readonly<{
  agentCount: number;
  modelCount: number;
  providerCount: number;
  recordCount: number;
}>;

export function codingAgentDatasetSummary(
  snapshot: CodingAgentSnapshot,
): CodingAgentDatasetSummary {
  return {
    agentCount: new Set(snapshot.records.map(record => record.agent)).size,
    modelCount: new Set(snapshot.records.map(record =>
      JSON.stringify([record.providerId, record.model]))).size,
    providerCount: new Set(snapshot.records.map(record => record.providerId)).size,
    recordCount: snapshot.records.length,
  };
}

export function codingAgentDatasetModifiedAt(
  snapshot: CodingAgentSnapshot,
): string {
  let latest: string | undefined;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const update of snapshot.updates) {
    const detectedTime = Date.parse(update.detectedAt);
    if (detectedTime > latestTime) {
      latest = update.detectedAt;
      latestTime = detectedTime;
    }
  }
  return latest ?? snapshot.source.retrievedAt;
}

export type CodingAgentBenchmarkLeader = Readonly<{
  definition: CodingAgentBenchmarkDefinition;
  record: CodingAgentRecord;
  value: number;
}>;

function compareLeaderRecords(
  metric: BenchmarkMetric,
  left: CodingAgentRecord,
  right: CodingAgentRecord,
): number {
  const leftValue = left.benchmarks[metric];
  const rightValue = right.benchmarks[metric];
  if (leftValue === null) return rightValue === null ? 0 : 1;
  if (rightValue === null) return -1;
  return rightValue - leftValue
    || left.model.localeCompare(right.model)
    || left.agent.localeCompare(right.agent)
    || left.settingRank - right.settingRank
    || left.id.localeCompare(right.id);
}

export function currentCodingAgentBenchmarkLeaders(
  snapshot: CodingAgentSnapshot,
): readonly CodingAgentBenchmarkLeader[] {
  return CODING_AGENT_BENCHMARK_DEFINITIONS.map((definition) => {
    const record = [...snapshot.records]
      .sort((left, right) => compareLeaderRecords(definition.id, left, right))[0];
    const value = record?.benchmarks[definition.id] ?? null;
    if (record === undefined || value === null) {
      throw new Error("Checked snapshot has no value for " + definition.id + ".");
    }
    return { definition, record, value };
  });
}

type DatasetPublisher = Pick<SearchSite, "name" | "origin">;

export function codingAgentDatasetJsonLd(
  snapshot: CodingAgentSnapshot,
  publisher: DatasetPublisher,
) {
  const pageUrl = absoluteWebUrl(publisher.origin, CODING_AGENT_DATASET_PATH);
  const downloadUrl = absoluteWebUrl(
    publisher.origin,
    CODING_AGENT_DATASET_DOWNLOAD_PATH,
  );
  const summary = codingAgentDatasetSummary(snapshot);
  const variables = [
    ...CODING_AGENT_BENCHMARK_DEFINITIONS.map(definition => ({
      "@type": "PropertyValue" as const,
      description: definition.description,
      name: definition.label,
      unitText: definition.unit,
    })),
    {
      "@type": "PropertyValue" as const,
      description: "Mean API cost for the evaluated task configuration.",
      name: "API cost per task",
      unitText: "USD",
    },
    {
      "@type": "PropertyValue" as const,
      description: "Mean active agent wall time for the evaluated task configuration.",
      name: "Active time per task",
      unitText: "seconds",
    },
    {
      "@type": "PropertyValue" as const,
      description: "Mean total token use for the evaluated task configuration.",
      name: "Total tokens per task",
      unitText: "tokens",
    },
  ];

  return {
    "@context": "https://schema.org",
    "@id": pageUrl + "#dataset",
    "@type": "Dataset",
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
      contentUrl: downloadUrl,
      encodingFormat: "application/json",
    },
    identifier: "aicharts-coding-agent-benchmarks",
    isAccessibleForFree: true,
    isBasedOn: snapshot.source.url,
    keywords: [
      "AI agent benchmark",
      "coding agent benchmark",
      "LLM benchmark",
      "AA Index",
      "DeepSWE",
      "Terminal-Bench v2",
      "SWE-Atlas-QnA",
    ],
    measurementTechnique: CODING_AGENT_BENCHMARK_DEFINITIONS.map(
      definition => definition.label,
    ),
    name: "Artificial Analysis coding-agent benchmark snapshot",
    publisher: {
      "@type": "Organization",
      name: publisher.name,
      url: absoluteWebUrl(publisher.origin, "/"),
    },
    size: String(summary.recordCount) + " model-agent configurations",
    url: pageUrl,
    variableMeasured: variables,
    version: snapshot.source.retrievedAt,
  } as const;
}
