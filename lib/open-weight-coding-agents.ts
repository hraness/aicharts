import intelligenceV43 from "@/data/artificial-analysis-intelligence-v4-3.json";

import { parseArtificialAnalysisIntelligenceV43Snapshot } from "./artificial-analysis-intelligence-v4-3-data";
import type { CodingAgentRecord } from "./coding-agent-data";
import {
  codingAgentSnapshotRows,
  type CodingAgentSnapshotRow,
} from "./coding-agent-snapshot-rows";

export type CodingAgentWeightClass = "closed" | "open" | "unclassified";

const parsedIntelligence = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceV43);
if (!parsedIntelligence.ok) {
  throw new Error(
    `Checked Artificial Analysis Intelligence v4.3 snapshot is invalid: ${parsedIntelligence.error.message}`,
    { cause: parsedIntelligence.error },
  );
}

function identitySlug(value: string): string | null {
  const slug = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[._]+/gu, "-")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug === "" ? null : slug;
}

function recordIdentityKeys(
  record: Readonly<{ name: string; shortName: string; slug: string }>,
): readonly string[] {
  return [...new Set([
    record.slug,
    identitySlug(record.name),
    identitySlug(record.shortName),
  ].filter((value): value is string => value !== null))];
}

function codingAgentIdentityKeys(
  record: Pick<CodingAgentRecord, "model" | "modelLabel" | "seriesId">,
): readonly string[] {
  const seriesTail = record.seriesId.includes(":")
    ? record.seriesId.slice(record.seriesId.indexOf(":") + 1)
    : record.seriesId;
  return [...new Set([
    identitySlug(record.model),
    identitySlug(record.modelLabel),
    identitySlug(seriesTail),
  ].filter((value): value is string => value !== null))];
}

/**
 * Maps slug, name, and short-name identities to Artificial Analysis
 * `isOpenWeights`. Conflicting identities are dropped rather than guessed.
 */
export function openWeightIndexFromIntelligenceRecords(
  records: readonly Readonly<{
    name: string;
    shortName: string;
    slug: string;
    weights?: Readonly<{ open: boolean }>;
  }>[],
): ReadonlyMap<string, boolean> {
  const index = new Map<string, boolean>();
  const conflicts = new Set<string>();
  for (const record of records) {
    if (record.weights === undefined) continue;
    for (const key of recordIdentityKeys(record)) {
      if (conflicts.has(key)) continue;
      const previous = index.get(key);
      if (previous !== undefined && previous !== record.weights.open) {
        index.delete(key);
        conflicts.add(key);
        continue;
      }
      index.set(key, record.weights.open);
    }
  }
  return index;
}

const defaultOpenWeightIndex = openWeightIndexFromIntelligenceRecords(
  parsedIntelligence.value.records,
);

export function codingAgentWeightClass(
  record: Pick<CodingAgentRecord, "model" | "modelLabel" | "seriesId">,
  index: ReadonlyMap<string, boolean> = defaultOpenWeightIndex,
): CodingAgentWeightClass {
  const matched = new Set<boolean>();
  for (const key of codingAgentIdentityKeys(record)) {
    const open = index.get(key);
    if (open !== undefined) matched.add(open);
  }
  if (matched.size !== 1) return "unclassified";
  return matched.has(true) ? "open" : "closed";
}

export function isOpenWeightCodingAgent(
  record: Pick<CodingAgentRecord, "model" | "modelLabel" | "seriesId">,
  index: ReadonlyMap<string, boolean> = defaultOpenWeightIndex,
): boolean {
  return codingAgentWeightClass(record, index) === "open";
}

export function cataloguedSnapshotProviderIds(
  records: readonly Pick<CodingAgentRecord, "providerId">[],
): readonly string[] {
  return [...new Set(records.map(record => record.providerId))].sort((left, right) =>
    left.localeCompare(right));
}

export function openWeightProviderNames(
  records: readonly Pick<CodingAgentRecord, "model" | "modelLabel" | "providerId" | "providerName" | "seriesId">[],
  index: ReadonlyMap<string, boolean> = defaultOpenWeightIndex,
): readonly string[] {
  const names = new Map<string, string>();
  for (const record of records) {
    if (!isOpenWeightCodingAgent(record, index)) continue;
    names.set(record.providerId, record.providerName);
  }
  return [...names.values()].sort((left, right) => left.localeCompare(right));
}

export function unclassifiedProviderNames(
  records: readonly Pick<CodingAgentRecord, "model" | "modelLabel" | "providerId" | "providerName" | "seriesId">[],
  index: ReadonlyMap<string, boolean> = defaultOpenWeightIndex,
): readonly string[] {
  const names = new Map<string, string>();
  for (const record of records) {
    if (codingAgentWeightClass(record, index) !== "unclassified") continue;
    names.set(record.providerId, record.providerName);
  }
  return [...names.values()].sort((left, right) => left.localeCompare(right));
}

export function openWeightCodingAgentRows(
  records: readonly CodingAgentRecord[],
  index: ReadonlyMap<string, boolean> = defaultOpenWeightIndex,
): CodingAgentSnapshotRow[] {
  return codingAgentSnapshotRows(records.filter(record => isOpenWeightCodingAgent(record, index)));
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
