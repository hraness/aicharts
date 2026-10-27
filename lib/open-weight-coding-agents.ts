import intelligenceV43 from "@/data/artificial-analysis-intelligence-v4-3.json";
import weightsRoster from "@/data/artificial-analysis-weights.json";

import { parseArtificialAnalysisIntelligenceV43Snapshot } from "./artificial-analysis-intelligence-v4-3-data";
import {
  parseArtificialAnalysisWeightsSnapshot,
  type ArtificialAnalysisWeightRecord,
} from "./artificial-analysis-weights";
import type { CodingAgentRecord } from "./coding-agent-data";
import {
  codingAgentSnapshotRows,
  type CodingAgentSnapshotRow,
} from "./coding-agent-snapshot-rows";

export type CodingAgentWeightClass = "closed" | "open" | "unclassified";

export type OpenWeightIdentity = Readonly<{
  creatorSlug: string;
  name?: string;
  open: boolean;
  releaseSlug: string;
  shortName?: string;
  slug: string;
}>;

const parsedIntelligence = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceV43);
if (!parsedIntelligence.ok) {
  throw new Error(
    `Checked Artificial Analysis Intelligence v4.3 snapshot is invalid: ${parsedIntelligence.error.message}`,
    { cause: parsedIntelligence.error },
  );
}

const parsedWeights = parseArtificialAnalysisWeightsSnapshot(weightsRoster);
if (!parsedWeights.ok) {
  throw new Error(
    `Checked Artificial Analysis weights roster is invalid: ${parsedWeights.error.message}`,
    { cause: parsedWeights.error },
  );
}

const COMPOSITE_SPLIT = / \+ /u;
const TRAILING_EFFORT = /-(?:adaptive-reasoning|default-fallback|extra-high|non-reasoning|with-fallback|xhigh|high|medium|low|max|none|ultra)$/u;
const COMPONENT_EFFORT = /\s*(?:\([^)]*\)|(?:max|xhigh|extra high|high|medium|low|none|default|ultra))\s*$/iu;

/** Coding-agent provider IDs → Artificial Analysis creator slugs. */
const PROVIDER_CREATOR_SLUGS = {
  alibaba_cloud: "alibaba",
  anthropic: "anthropic",
  cognition: "cognition",
  deepseek: "deepseek",
  google: "google",
  meta: "meta",
  moonshot_ai: "kimi",
  openai: "openai",
  reflection: "reflection",
  stepfun: "stepfun",
  xai: "xai",
  z_ai: "zai",
} as const;

const SERIES_OWNER_PREFIXES = [
  "private-anthropic-",
  "alibaba-cloud-",
  "moonshot-",
  "anthropic-",
  "cognition-",
  "deepseek-",
  "openai-",
  "google-",
  "meta-",
  "xai-",
  "zai-",
] as const;

function identitySlug(value: string): string | null {
  const slug = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[._]+/gu, "-")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug === "" ? null : slug;
}

function stripTrailingEffort(slug: string): string {
  let current = slug;
  for (let step = 0; step < 4; step += 1) {
    const next = current.replace(TRAILING_EFFORT, "");
    if (next === current) break;
    current = next;
  }
  return current;
}

function uniqueSlugs(values: readonly (string | null)[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => value !== null && value !== ""))];
}

function stripSeriesOwnerPrefix(slug: string): string {
  const prefix = SERIES_OWNER_PREFIXES.find(candidate => slug.startsWith(candidate));
  return prefix === undefined ? slug : slug.slice(prefix.length);
}

function stripComponentEffort(label: string): string {
  let current = label.trim();
  for (let step = 0; step < 4; step += 1) {
    const next = current.replace(COMPONENT_EFFORT, "").trim();
    if (next === current) break;
    current = next;
  }
  return current;
}

export function codingAgentWeightComponents(
  record: Pick<CodingAgentRecord, "model">,
): readonly string[] {
  const parts = record.model.split(COMPOSITE_SPLIT).map(part => part.trim()).filter(part => part !== "");
  return parts.length === 0 ? [record.model] : parts;
}

/**
 * Index keys are Artificial Analysis slugs and creator-qualified slugs.
 * Display names are not indexed; conflicting slugs are dropped.
 */
export function openWeightIdentityKeys(identity: OpenWeightIdentity): readonly string[] {
  const slug = identitySlug(identity.slug);
  const release = identitySlug(identity.releaseSlug);
  const creator = identitySlug(identity.creatorSlug);
  const effortless = slug === null ? null : stripTrailingEffort(slug);
  const claudeCore = slug !== null && slug.startsWith("claude-") ? slug.slice("claude-".length) : null;
  const named = uniqueSlugs([
    identity.name === undefined ? null : identitySlug(identity.name),
    identity.shortName === undefined ? null : identitySlug(identity.shortName),
  ]).flatMap(value => [value, stripTrailingEffort(value)]);
  return uniqueSlugs([
    identity.slug,
    slug,
    release,
    effortless,
    claudeCore,
    claudeCore === null ? null : stripTrailingEffort(claudeCore),
    ...named,
    creator === null || slug === null ? null : `${creator}-${slug}`,
    creator === null || release === null ? null : `${creator}-${release}`,
    ...named.flatMap(value => creator === null ? [] : [`${creator}-${value}`]),
  ]);
}

export function openWeightIndexFromIdentities(
  identities: readonly OpenWeightIdentity[],
): ReadonlyMap<string, boolean> {
  const index = new Map<string, boolean>();
  const conflicts = new Set<string>();
  for (const identity of identities) {
    for (const key of openWeightIdentityKeys(identity)) {
      if (conflicts.has(key)) continue;
      const previous = index.get(key);
      if (previous !== undefined && previous !== identity.open) {
        index.delete(key);
        conflicts.add(key);
        continue;
      }
      index.set(key, identity.open);
    }
  }
  return index;
}

function identityFromIntelligence(
  record: Readonly<{
    creator?: Readonly<{ slug: string }>;
    name?: string;
    release?: Readonly<{ slug: string }>;
    shortName?: string;
    slug: string;
    weights?: Readonly<{ open: boolean }>;
  }>,
): OpenWeightIdentity | null {
  if (record.weights === undefined) return null;
  return {
    creatorSlug: record.creator?.slug ?? "",
    name: record.name,
    open: record.weights.open,
    releaseSlug: record.release?.slug ?? record.slug,
    shortName: record.shortName,
    slug: record.slug,
  };
}

/**
 * Maps Artificial Analysis model slugs and creator-qualified slugs to
 * `isOpenWeights`. Conflicting identities are dropped rather than guessed.
 */
export function openWeightIndexFromIntelligenceRecords(
  records: readonly Readonly<{
    creator?: Readonly<{ slug: string }>;
    name?: string;
    release?: Readonly<{ slug: string }>;
    shortName?: string;
    slug: string;
    weights?: Readonly<{ open: boolean }>;
  }>[],
): ReadonlyMap<string, boolean> {
  return openWeightIndexFromIdentities(
    records.map(identityFromIntelligence).filter((identity): identity is OpenWeightIdentity => identity !== null),
  );
}

export function openWeightIndexFromWeightRecords(
  records: readonly Pick<ArtificialAnalysisWeightRecord, "creatorSlug" | "open" | "releaseSlug" | "slug">[],
): ReadonlyMap<string, boolean> {
  return openWeightIndexFromIdentities(records);
}

function mergeOpenWeightIndexes(
  ...indexes: readonly ReadonlyMap<string, boolean>[]
): ReadonlyMap<string, boolean> {
  const merged = new Map<string, boolean>();
  const conflicts = new Set<string>();
  for (const index of indexes) {
    for (const [key, open] of index) {
      if (conflicts.has(key)) continue;
      const previous = merged.get(key);
      if (previous !== undefined && previous !== open) {
        merged.delete(key);
        conflicts.add(key);
        continue;
      }
      merged.set(key, open);
    }
  }
  return merged;
}

const defaultOpenWeightIndex = mergeOpenWeightIndexes(
  openWeightIndexFromIntelligenceRecords(parsedIntelligence.value.records),
  openWeightIndexFromWeightRecords(parsedWeights.value.records),
);

function seriesTail(seriesId: string): string {
  return seriesId.includes(":") ? seriesId.slice(seriesId.indexOf(":") + 1) : seriesId;
}

function creatorSlugForProvider(providerId: string): string | null {
  return Object.hasOwn(PROVIDER_CREATOR_SLUGS, providerId)
    ? PROVIDER_CREATOR_SLUGS[providerId as keyof typeof PROVIDER_CREATOR_SLUGS]
    : identitySlug(providerId);
}

function componentIdentityKeys(
  component: string,
  record: Pick<CodingAgentRecord, "providerId" | "seriesId">,
  includeSeriesTail: boolean,
): readonly string[] {
  const stripped = stripComponentEffort(component);
  const modelSlug = identitySlug(component);
  const coreSlug = identitySlug(stripped);
  const creator = creatorSlugForProvider(record.providerId);
  const tail = includeSeriesTail ? identitySlug(seriesTail(record.seriesId)) : null;
  const tailCore = tail === null ? null : stripSeriesOwnerPrefix(tail);
  return uniqueSlugs([
    modelSlug,
    coreSlug,
    modelSlug === null ? null : stripTrailingEffort(modelSlug),
    coreSlug === null ? null : stripTrailingEffort(coreSlug),
    tail,
    tail === null ? null : stripTrailingEffort(tail),
    tailCore,
    tailCore === null ? null : stripTrailingEffort(tailCore),
    creator === null || coreSlug === null ? null : `${creator}-${coreSlug}`,
    creator === null || modelSlug === null ? null : `${creator}-${modelSlug}`,
  ]);
}

function lookupWeightFlag(
  keys: readonly string[],
  index: ReadonlyMap<string, boolean>,
): boolean | undefined {
  const matched = new Set<boolean>();
  for (const key of keys) {
    const open = index.get(key);
    if (open !== undefined) matched.add(open);
  }
  if (matched.size !== 1) return undefined;
  return [...matched][0];
}

function combineWeightFlags(flags: readonly (boolean | undefined)[]): CodingAgentWeightClass {
  if (flags.some(flag => flag === false)) return "closed";
  if (flags.length > 0 && flags.every(flag => flag === true)) return "open";
  return "unclassified";
}

export function codingAgentWeightClass(
  record: Pick<CodingAgentRecord, "model" | "modelLabel" | "providerId" | "seriesId">,
  index: ReadonlyMap<string, boolean> = defaultOpenWeightIndex,
): CodingAgentWeightClass {
  const components = codingAgentWeightComponents(record);
  return combineWeightFlags(components.map((component, componentIndex) => lookupWeightFlag(
    componentIdentityKeys(component, record, components.length === 1 && componentIndex === 0),
    index,
  )));
}

export function isOpenWeightCodingAgent(
  record: Pick<CodingAgentRecord, "model" | "modelLabel" | "providerId" | "seriesId">,
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
