import intelligenceV43Data from "@/data/artificial-analysis-intelligence-v4-3.json";

import {
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_VERSION,
  parseArtificialAnalysisIntelligenceV43Snapshot,
  type ArtificialAnalysisIntelligenceV43Snapshot,
} from "./artificial-analysis-intelligence-v4-3-data";
import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import { isoCalendarDateToUtcDate } from "./iso-calendar-date";
import { MODEL_CARD_CATALOG } from "./model-card-data";
import { modelCardArtDirection } from "./model-card-art-direction";
import { modelIconDataUrl } from "./model-card-icons";
import { MODEL_CARD_PRESENTATIONS } from "./model-card-collection";
import type { ModelCardPresentation } from "./model-card-presentation";
import type { ModelCardPath, ModelCardRouteParams } from "./model-card-data";

export const INDEX_MODEL_PROFILE_SLUG = "index" as const;
export const INDEX_MODEL_RECENT_WINDOW_DAYS = 21;

const parsedIntelligence = parseArtificialAnalysisIntelligenceV43Snapshot(
  intelligenceV43Data as unknown,
);
if (!parsedIntelligence.ok) {
  throw new Error(
    `Checked Intelligence snapshot is invalid: ${parsedIntelligence.error.message}`,
    { cause: parsedIntelligence.error },
  );
}

export const INDEX_MODEL_SNAPSHOT = parsedIntelligence.value;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeIdentity(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "");
}

function creatorRouteAliases(creatorSlug: string): readonly string[] {
  if (creatorSlug === "xai") return ["xai", "spacexai"];
  if (creatorSlug === "alibaba") return ["alibaba"];
  return [creatorSlug];
}

export function intelligenceRecordCoversCard(
  record: ArtificialAnalysisIntelligenceRecord,
  card: Pick<ModelCardPresentation, "canonicalModelId" | "model" | "displayTitle">,
): boolean {
  const [creator, model] = card.canonicalModelId.split("/");
  if (creator === undefined || model === undefined) return false;
  if (!creatorRouteAliases(record.creator.slug).includes(creator)) return false;
  const cardTokens = [model, card.model, card.displayTitle].map(normalizeIdentity);
  const recordTokens = [
    record.slug,
    record.release.slug,
    record.name,
    record.release.name,
    record.shortName,
  ].map(normalizeIdentity);
  return cardTokens.some(cardToken => (
    recordTokens.some(recordToken => (
      recordToken === cardToken
      || recordToken.startsWith(cardToken)
      || cardToken.startsWith(recordToken)
    ))
  ));
}

export function intelligenceObservationForCard(
  card: Pick<ModelCardPresentation, "canonicalModelId" | "model" | "displayTitle">,
  snapshot: ArtificialAnalysisIntelligenceV43Snapshot = INDEX_MODEL_SNAPSHOT,
): ArtificialAnalysisIntelligenceRecord | undefined {
  const matches = snapshot.records.filter(record => (
    intelligenceRecordCoversCard(record, card)
  ));
  matches.sort((left, right) => (
    right.intelligenceIndex - left.intelligenceIndex
    || compareText(left.slug, right.slug)
  ));
  return matches[0];
}

function addUtcDays(date: string, days: number): string {
  const parsed = isoCalendarDateToUtcDate(date);
  if (parsed === null) {
    throw new Error("Intelligence release date must be a valid ISO calendar date.");
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function latestReleaseDate(
  snapshot: ArtificialAnalysisIntelligenceV43Snapshot,
): string {
  const dates = snapshot.records.map(record => record.releaseDate).sort(compareText);
  const latest = dates[dates.length - 1];
  if (latest === undefined) {
    throw new Error("Intelligence snapshot must include at least one release date.");
  }
  return latest;
}

function preferredReleaseRecord(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
): ArtificialAnalysisIntelligenceRecord {
  const exactName = records.find(record => record.name === record.release.name);
  if (exactName !== undefined) return exactName;
  const withoutEffort = records.filter(record => record.effort === null);
  const pool = withoutEffort.length > 0 ? withoutEffort : records;
  return [...pool].sort((left, right) => (
    right.intelligenceIndex - left.intelligenceIndex
    || compareText(left.slug, right.slug)
  ))[0]!;
}

export type IndexModelPage = Readonly<{
  canonicalModelId: string;
  costUsdPerTask: number | null;
  creatorSlug: string;
  detailsUrl: string;
  displayTitle: string;
  iconDataUrl: string;
  intelligenceIndex: number;
  modelSlug: string;
  path: ModelCardPath;
  profileSlug: typeof INDEX_MODEL_PROFILE_SLUG;
  providerColor: string;
  providerId: string;
  providerName: string;
  releaseDate: string;
  sourceName: string;
  sourceRetrievedAt: string;
  sourceUrl: string;
}>;

function catalogEntryForRecord(
  record: ArtificialAnalysisIntelligenceRecord,
) {
  return MODEL_CARD_CATALOG.find(entry => (
    entry.canonicalModelId === `${record.creator.slug}/${record.release.slug}`
    || intelligenceRecordCoversCard(record, {
      canonicalModelId: entry.canonicalModelId,
      displayTitle: entry.model,
      model: entry.model,
    })
  ));
}

function buildIndexModelPage(
  record: ArtificialAnalysisIntelligenceRecord,
  snapshot: ArtificialAnalysisIntelligenceV43Snapshot,
): IndexModelPage {
  const catalogEntry = catalogEntryForRecord(record);
  const creatorSlug = catalogEntry?.canonicalModelId.split("/")[0] ?? record.creator.slug;
  const modelSlug = catalogEntry?.canonicalModelId.split("/")[1] ?? record.release.slug;
  const providerId = catalogEntry?.providerId ?? record.creator.slug;
  const providerName = catalogEntry === undefined
    ? record.creator.name
    : record.creator.name;
  const art = modelCardArtDirection(providerId, "standard", INDEX_MODEL_PROFILE_SLUG);
  return {
    canonicalModelId: catalogEntry?.canonicalModelId ?? `${creatorSlug}/${modelSlug}`,
    costUsdPerTask: record.costUsdPerTask?.total ?? null,
    creatorSlug,
    detailsUrl: record.detailsUrl,
    displayTitle: record.release.name,
    iconDataUrl: modelIconDataUrl(
      catalogEntry?.lobeIconKey ?? null,
      `${providerName} ${record.release.name}`,
    ),
    intelligenceIndex: record.intelligenceIndex,
    modelSlug,
    path: `/models/${creatorSlug}/${modelSlug}/${INDEX_MODEL_PROFILE_SLUG}`,
    profileSlug: INDEX_MODEL_PROFILE_SLUG,
    providerColor: art.providerColor,
    providerId,
    providerName,
    releaseDate: record.releaseDate,
    sourceName: `${snapshot.benchmark.name} v${snapshot.benchmark.version}`,
    sourceRetrievedAt: snapshot.source.retrievedAt,
    sourceUrl: snapshot.source.url,
  };
}

function codingCardCoversRelease(
  record: ArtificialAnalysisIntelligenceRecord,
): boolean {
  return MODEL_CARD_PRESENTATIONS.some(card => (
    intelligenceRecordCoversCard(record, card)
  ));
}

export function buildIndexModelPages(
  snapshot: ArtificialAnalysisIntelligenceV43Snapshot = INDEX_MODEL_SNAPSHOT,
  windowDays = INDEX_MODEL_RECENT_WINDOW_DAYS,
): readonly IndexModelPage[] {
  if (!Number.isSafeInteger(windowDays) || windowDays < 1) {
    throw new RangeError("Index-model window must be a positive integer.");
  }
  const cutoff = addUtcDays(latestReleaseDate(snapshot), -windowDays);
  const groups = new Map<string, ArtificialAnalysisIntelligenceRecord[]>();
  for (const record of snapshot.records) {
    if (record.releaseDate < cutoff) continue;
    const key = `${record.creator.slug}/${record.release.slug}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(preferredReleaseRecord)
    .filter(record => !codingCardCoversRelease(record))
    .map(record => buildIndexModelPage(record, snapshot))
    .sort((left, right) => (
      compareText(right.releaseDate, left.releaseDate)
      || compareText(left.canonicalModelId, right.canonicalModelId)
    ));
}

export const INDEX_MODEL_PAGES = buildIndexModelPages();

export function indexModelRouteStaticParams(): readonly ModelCardRouteParams[] {
  return INDEX_MODEL_PAGES.map(page => ({
    creatorSlug: page.creatorSlug,
    modelSlug: page.modelSlug,
    profileSlug: page.profileSlug,
  }));
}

export function findIndexModelPage(
  pathSegments: unknown,
): IndexModelPage | undefined {
  if (
    typeof pathSegments !== "object"
    || pathSegments === null
    || !("creatorSlug" in pathSegments)
    || !("modelSlug" in pathSegments)
    || !("profileSlug" in pathSegments)
  ) {
    return undefined;
  }
  const creatorSlug = pathSegments.creatorSlug;
  const modelSlug = pathSegments.modelSlug;
  const profileSlug = pathSegments.profileSlug;
  if (
    typeof creatorSlug !== "string"
    || typeof modelSlug !== "string"
    || profileSlug !== INDEX_MODEL_PROFILE_SLUG
  ) {
    return undefined;
  }
  return INDEX_MODEL_PAGES.find(page => (
    page.creatorSlug === creatorSlug && page.modelSlug === modelSlug
  ));
}

export function formatIntelligenceIndex(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
}

export function formatIntelligenceCost(value: number): string {
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: value < 1 ? 2 : 1,
    minimumFractionDigits: value < 1 ? 2 : 0,
  })}`;
}

export const INDEX_MODEL_VERSION_LABEL = (
  `Intelligence Index v${ARTIFICIAL_ANALYSIS_INTELLIGENCE_V43_VERSION}`
);
