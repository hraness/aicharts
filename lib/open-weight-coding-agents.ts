import type { CodingAgentRecord } from "./coding-agent-data";
import {
  codingAgentSnapshotRows,
  type CodingAgentSnapshotRow,
} from "./coding-agent-snapshot-rows";

export const OPEN_WEIGHT_PROVIDER_IDS = [
  "alibaba_cloud",
  "deepseek",
  "moonshot_ai",
  "z_ai",
] as const;

export const CLOSED_WEIGHT_PROVIDER_IDS = [
  "anthropic",
  "cursor",
  "google",
  "openai",
  "xai",
] as const;

export const UNCLASSIFIED_WEIGHT_PROVIDER_IDS = [
  "cognition",
  "meta",
] as const;

export const KNOWN_WEIGHT_PROVIDER_IDS = [
  ...OPEN_WEIGHT_PROVIDER_IDS,
  ...CLOSED_WEIGHT_PROVIDER_IDS,
  ...UNCLASSIFIED_WEIGHT_PROVIDER_IDS,
] as const;

export type CodingAgentWeightClass = "closed" | "open" | "unclassified";

const openWeightProviderIdSet = new Set<string>(OPEN_WEIGHT_PROVIDER_IDS);
const closedWeightProviderIdSet = new Set<string>(CLOSED_WEIGHT_PROVIDER_IDS);
const knownWeightProviderIdSet = new Set<string>(KNOWN_WEIGHT_PROVIDER_IDS);

export function codingAgentWeightClass(providerId: string): CodingAgentWeightClass {
  if (openWeightProviderIdSet.has(providerId)) return "open";
  if (closedWeightProviderIdSet.has(providerId)) return "closed";
  return "unclassified";
}

export function isOpenWeightCodingAgent(
  record: Pick<CodingAgentRecord, "providerId">,
): boolean {
  return codingAgentWeightClass(record.providerId) === "open";
}

export function cataloguedSnapshotProviderIds(
  records: readonly Pick<CodingAgentRecord, "providerId">[],
): readonly string[] {
  return [...new Set(records.map(record => record.providerId))].sort((left, right) =>
    left.localeCompare(right));
}

export function uncataloguedSnapshotProviderIds(
  records: readonly Pick<CodingAgentRecord, "providerId">[],
): readonly string[] {
  return cataloguedSnapshotProviderIds(records)
    .filter(providerId => !knownWeightProviderIdSet.has(providerId));
}

export function openWeightProviderNames(
  records: readonly Pick<CodingAgentRecord, "providerId" | "providerName">[],
): readonly string[] {
  const names = new Map<string, string>();
  for (const record of records) {
    if (!isOpenWeightCodingAgent(record)) continue;
    names.set(record.providerId, record.providerName);
  }
  return [...names.values()].sort((left, right) => left.localeCompare(right));
}

export function unclassifiedProviderNames(
  records: readonly Pick<CodingAgentRecord, "providerId" | "providerName">[],
): readonly string[] {
  const names = new Map<string, string>();
  for (const record of records) {
    if (codingAgentWeightClass(record.providerId) !== "unclassified") continue;
    names.set(record.providerId, record.providerName);
  }
  return [...names.values()].sort((left, right) => left.localeCompare(right));
}

export function openWeightCodingAgentRows(
  records: readonly CodingAgentRecord[],
): CodingAgentSnapshotRow[] {
  return codingAgentSnapshotRows(records.filter(isOpenWeightCodingAgent));
}

export function highestAaIndexRow(
  rows: readonly CodingAgentSnapshotRow[],
): CodingAgentSnapshotRow | undefined {
  return rows.find(row => row.aaIndex !== null);
}

export function highestAaIndexRowForModel(
  rows: readonly CodingAgentSnapshotRow[],
  model: string,
): CodingAgentSnapshotRow | undefined {
  return rows.find(row => row.model === model && row.aaIndex !== null);
}

export function formatAaIndexGap(leader: number, challenger: number): string {
  return (leader - challenger).toFixed(1);
}
