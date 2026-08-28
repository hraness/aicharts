import type { CodingAgentRecord } from "./coding-agent-data";
import { computeParetoFrontier, type FrontierRecord } from "./option-space";

export const MISSING_SNAPSHOT_VALUE = "-" as const;

export type CodingAgentSnapshotRow = Readonly<{
  aaIndex: number | null;
  agent: string;
  costUsd: number | null;
  deepSwe: number | null;
  id: string;
  model: string;
  providerName: string;
  setting: string;
  settingRank: number;
  sweAtlas: number | null;
  terminalBench: number | null;
}>;

export type AaIndexCostEfficiencyRow = Readonly<{
  aaIndex: number;
  aaIndexPerUsd: number;
  costUsd: number;
  record: CodingAgentRecord;
}>;

function compareNullableScoreDesc(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return right - left;
}

export function compareCodingAgentSnapshotRows(
  left: CodingAgentSnapshotRow,
  right: CodingAgentSnapshotRow,
): number {
  return compareNullableScoreDesc(left.aaIndex, right.aaIndex)
    || left.model.localeCompare(right.model)
    || left.agent.localeCompare(right.agent)
    || left.settingRank - right.settingRank
    || left.id.localeCompare(right.id);
}

export function codingAgentSnapshotRow(
  record: CodingAgentRecord,
): CodingAgentSnapshotRow {
  return {
    aaIndex: record.benchmarks.aaIndex,
    agent: record.agent,
    costUsd: record.economics.costUsd,
    deepSwe: record.benchmarks.deepSwe,
    id: record.id,
    model: record.model,
    providerName: record.providerName,
    setting: record.setting,
    settingRank: record.settingRank,
    sweAtlas: record.benchmarks.sweAtlas,
    terminalBench: record.benchmarks.terminalBench,
  };
}

export function codingAgentSnapshotRows(
  records: readonly CodingAgentRecord[],
): CodingAgentSnapshotRow[] {
  return records.map(codingAgentSnapshotRow).sort(compareCodingAgentSnapshotRows);
}

export function formatSnapshotScore(value: number | null): string {
  return value === null ? MISSING_SNAPSHOT_VALUE : value.toFixed(1);
}

export function formatSnapshotCostUsd(value: number | null): string {
  if (value === null) return MISSING_SNAPSHOT_VALUE;
  const fractionDigits = value < 1 ? 3 : 2;
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
    style: "currency",
  }).format(value);
}

export function aaIndexCostFrontier(
  records: readonly CodingAgentRecord[],
): FrontierRecord[] {
  return computeParetoFrontier(records, "costUsd", "aaIndex");
}

function compareEfficiencyRows(
  left: AaIndexCostEfficiencyRow,
  right: AaIndexCostEfficiencyRow,
): number {
  return right.aaIndexPerUsd - left.aaIndexPerUsd
    || right.aaIndex - left.aaIndex
    || left.costUsd - right.costUsd
    || left.record.model.localeCompare(right.record.model)
    || left.record.agent.localeCompare(right.record.agent)
    || left.record.id.localeCompare(right.record.id);
}

export function aaIndexCostEfficiencyRows(
  records: readonly CodingAgentRecord[],
): AaIndexCostEfficiencyRow[] {
  const rows: AaIndexCostEfficiencyRow[] = [];
  for (const record of records) {
    const aaIndex = record.benchmarks.aaIndex;
    const costUsd = record.economics.costUsd;
    if (aaIndex === null || costUsd === null || costUsd <= 0) continue;
    rows.push({
      aaIndex,
      aaIndexPerUsd: aaIndex / costUsd,
      costUsd,
      record,
    });
  }
  return rows.sort(compareEfficiencyRows);
}

export type SnapshotTableColumn = "model" | "agent" | "provider" | "setting" | "aaIndex" | "deepSwe" | "terminalBench" | "sweAtlas" | "costUsd";

export const COMPACT_SNAPSHOT_COLUMNS = [
  "model",
  "agent",
  "setting",
  "aaIndex",
  "costUsd",
] as const satisfies readonly SnapshotTableColumn[];

export const FULL_SNAPSHOT_COLUMNS = [
  "model",
  "agent",
  "provider",
  "setting",
  "aaIndex",
  "deepSwe",
  "terminalBench",
  "sweAtlas",
  "costUsd",
] as const satisfies readonly SnapshotTableColumn[];

export const SNAPSHOT_COLUMN_LABELS = {
  aaIndex: "AA Index",
  agent: "Agent",
  costUsd: "Cost",
  deepSwe: "DeepSWE",
  model: "Model",
  provider: "Provider",
  setting: "Setting",
  sweAtlas: "SWE-Atlas-QnA",
  terminalBench: "Terminal-Bench v2.1",
} as const satisfies Record<SnapshotTableColumn, string>;

export function snapshotRowCell(
  row: CodingAgentSnapshotRow,
  column: SnapshotTableColumn,
): string {
  if (column === "model") return row.model;
  if (column === "agent") return row.agent;
  if (column === "provider") return row.providerName;
  if (column === "setting") return row.setting;
  if (column === "aaIndex") return formatSnapshotScore(row.aaIndex);
  if (column === "deepSwe") return formatSnapshotScore(row.deepSwe);
  if (column === "terminalBench") return formatSnapshotScore(row.terminalBench);
  if (column === "sweAtlas") return formatSnapshotScore(row.sweAtlas);
  return formatSnapshotCostUsd(row.costUsd);
}

export function snapshotRowsMarkdownTable(
  rows: readonly CodingAgentSnapshotRow[],
  columns: readonly SnapshotTableColumn[],
): string {
  const header = `| ${columns.map(column => SNAPSHOT_COLUMN_LABELS[column]).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map(row => (
    `| ${columns.map(column => snapshotRowCell(row, column)).join(" | ")} |`
  ));
  return [header, divider, ...body].join("\n");
}
