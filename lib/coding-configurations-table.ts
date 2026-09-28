import type { CodingAgentRecord, CodingAgentSnapshot } from "./coding-agent-data";
import { codingAgentDatasetSummary } from "./coding-agent-dataset";
import { formatSnapshotCostUsd } from "./coding-agent-snapshot-rows";
import { formatMetricValue } from "./chart-math";
import { formatRetrievedAt } from "./coding-agent-updates";

/** Shown for a value the source leaves empty; never rendered as zero. */
export const MISSING_CONFIGURATION_VALUE = "–" as const;
export const MISSING_CONFIGURATION_LABEL = "Not reported" as const;

/** The /coding source sentence, split so HTML and Markdown render one link from one string set. */
export type CodingSourceSentence = Readonly<{
  lead: string;
  linkLabel: string;
  tail: string;
  url: string;
}>;

export function codingSourceSentence(snapshot: CodingAgentSnapshot): CodingSourceSentence {
  const summary = codingAgentDatasetSummary(snapshot);
  return {
    lead: "The Coding Agent Index v1.5 ",
    linkLabel: `${snapshot.source.name} coding-agents snapshot`,
    tail: ` contains ${summary.recordCount} configurations across ${summary.modelCount} models and ${summary.agentCount} agent harnesses. Retrieved ${formatRetrievedAt(snapshot.source.retrievedAt)}.`,
    url: snapshot.source.url,
  };
}

export function codingSourceSentenceMarkdown(snapshot: CodingAgentSnapshot): string {
  const sentence = codingSourceSentence(snapshot);
  return `${sentence.lead}[${sentence.linkLabel}](${sentence.url})${sentence.tail}`;
}

export type CodingConfigurationColumn = Readonly<{
  format: (value: number) => string;
  id: string;
  label: string;
  value: (record: CodingAgentRecord) => number | null;
}>;

const score = (value: number) => value.toFixed(1);

/** Numeric columns after the three identity columns (model and setting, agent, provider). */
export const CODING_CONFIGURATION_COLUMNS: readonly CodingConfigurationColumn[] = [
  { format: score, id: "aaIndex", label: "AA Index", value: record => record.benchmarks.aaIndex },
  { format: score, id: "deepSwe", label: "DeepSWE v1.1", value: record => record.benchmarks.deepSwe },
  { format: score, id: "terminalBench", label: "Terminal-Bench 4", value: record => record.benchmarks.terminalBench },
  { format: score, id: "sweAtlas", label: "SWE-Atlas-QnA", value: record => record.benchmarks.sweAtlas },
  { format: formatSnapshotCostUsd, id: "costUsd", label: "Cost per task", value: record => record.economics.costUsd },
  {
    format: minutes => formatMetricValue("durationMinutes", minutes),
    id: "durationMinutes",
    label: "Time per task",
    value: record => record.economics.durationSeconds === null ? null : record.economics.durationSeconds / 60,
  },
  {
    format: tokens => formatMetricValue("totalTokens", tokens),
    id: "totalTokens",
    label: "Tokens per task",
    value: record => record.usage.totalTokens,
  },
];

export const CODING_CONFIGURATION_IDENTITY_LABELS = ["Model (setting)", "Agent", "Provider"] as const;

export function codingConfigurationModelLabel(record: CodingAgentRecord): string {
  return `${record.model} (${record.setting})`;
}

/** Highest AA Index first; a missing AA Index sorts last. Ties break on stable identity. */
export function codingConfigurationRows(records: readonly CodingAgentRecord[]): CodingAgentRecord[] {
  return [...records].sort((left, right) => {
    const a = left.benchmarks.aaIndex;
    const b = right.benchmarks.aaIndex;
    if (a !== b) {
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a;
    }
    return left.model.localeCompare(right.model)
      || left.agent.localeCompare(right.agent)
      || left.settingRank - right.settingRank
      || left.id.localeCompare(right.id);
  });
}

export function codingConfigurationCell(column: CodingConfigurationColumn, record: CodingAgentRecord): string | null {
  const value = column.value(record);
  return value === null ? null : column.format(value);
}

function markdownCell(text: string): string {
  return text.replace(/[\\|]/gu, character => `\\${character}`).replace(/\s+/gu, " ");
}

export function codingConfigurationsMarkdownTable(records: readonly CodingAgentRecord[]): string {
  const labels = [...CODING_CONFIGURATION_IDENTITY_LABELS, ...CODING_CONFIGURATION_COLUMNS.map(column => column.label)];
  return [
    `| ${labels.join(" | ")} |`,
    `| ${labels.map(() => "---").join(" | ")} |`,
    ...codingConfigurationRows(records).map(record => `| ${[
      codingConfigurationModelLabel(record),
      record.agent,
      record.providerName,
      ...CODING_CONFIGURATION_COLUMNS.map(column => codingConfigurationCell(column, record) ?? MISSING_CONFIGURATION_VALUE),
    ].map(markdownCell).join(" | ")} |`),
  ].join("\n");
}
