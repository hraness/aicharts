import { isIsoCalendarDate } from "./iso-calendar-date";
import { err, ok, type Result } from "./result";
import { parseResult, z } from "./schema";

export const FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS = [
  {
    canonicalHost: "www.anthropic.com",
    id: "anthropic-sitemap",
    minimumCandidateCount: 2,
    minimumEntryCount: 100,
    providerId: "anthropic",
    providerName: "Anthropic",
    url: "https://www.anthropic.com/sitemap.xml",
  },
  {
    canonicalHost: "openai.com",
    id: "openai-release-sitemap",
    minimumCandidateCount: 5,
    minimumEntryCount: 25,
    providerId: "openai",
    providerName: "OpenAI",
    url: "https://openai.com/sitemap.xml/release/",
  },
] as const;

export const FIRST_PARTY_RELEASE_PUBLICATION_POLICY = "discovery-only" as const;
export const FIRST_PARTY_RELEASE_REVIEW_POLICY = "manual-review-required" as const;

export type FirstPartyReleaseSourceDefinition =
  (typeof FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS)[number];
export type FirstPartyReleaseSourceId = FirstPartyReleaseSourceDefinition["id"];
export type FirstPartyReleaseProviderId = FirstPartyReleaseSourceDefinition["providerId"];

const providerIdSchema = z.enum(["anthropic", "openai"]);
const sourceIdSchema = z.enum(["anthropic-sitemap", "openai-release-sitemap"]);
const timestampSchema = z.string().datetime({ offset: true });
const calendarDateSchema = z.string().refine(isIsoCalendarDate, "Expected an ISO calendar date.");
const reviewStatusSchema = z.enum(["needs-review", "confirmed-release", "not-a-release"]);
const sourcePresenceSchema = z.enum(["present", "missing"]);

const sourceHealthSchema = z.object({
  contentType: z.string().min(1),
  httpStatus: z.literal(200),
  shape: z.object({
    byteLength: z.number().int().positive(),
    candidateCount: z.number().int().nonnegative(),
    canonicalHostEntryCount: z.number().int().nonnegative(),
    datedEntryCount: z.number().int().nonnegative(),
    duplicateEntryCount: z.number().int().nonnegative(),
    entryCount: z.number().int().positive(),
    rootElement: z.literal("urlset"),
    uniqueEntryCount: z.number().int().positive(),
  }).strict(),
  status: z.literal("healthy"),
}).strict();

const sourceSnapshotSchema = z.object({
  health: sourceHealthSchema,
  id: sourceIdSchema,
  providerId: providerIdSchema,
  providerName: z.string().min(1),
  retrievedAt: timestampSchema,
  url: z.string().url(),
}).strict();

const releaseCandidateSchema = z.object({
  candidateDate: calendarDateSchema,
  candidateDateMeaning: z.literal("provider-sitemap-lastmod"),
  canonicalUrl: z.string().url(),
  firstSeenAt: timestampSchema,
  id: z.string().min(1),
  lastChangedAt: timestampSchema,
  namedModels: z.array(z.string().min(1)).min(1),
  providerId: providerIdSchema,
  providerName: z.string().min(1),
  sourceId: sourceIdSchema,
  sourceModifiedAt: timestampSchema,
  sourcePresence: sourcePresenceSchema,
  status: reviewStatusSchema,
}).strict();

const firstPartyReleaseRadarBaseSchema = z.object({
  candidates: z.array(releaseCandidateSchema),
  policy: z.object({
    durableCandidates: z.literal(true),
    publication: z.literal(FIRST_PARTY_RELEASE_PUBLICATION_POLICY),
    review: z.literal(FIRST_PARTY_RELEASE_REVIEW_POLICY),
  }).strict(),
  schemaVersion: z.literal(1),
  sources: z.array(sourceSnapshotSchema),
}).strict();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCandidates(left: FirstPartyReleaseCandidate, right: FirstPartyReleaseCandidate): number {
  return Date.parse(right.sourceModifiedAt) - Date.parse(left.sourceModifiedAt)
    || compareText(left.canonicalUrl, right.canonicalUrl);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function isSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => (
    index === 0 || compareText(values[index - 1] ?? "", value) < 0
  ));
}

const firstPartyReleaseRadarSchema = firstPartyReleaseRadarBaseSchema.superRefine((radar, context) => {
  const sourceById = new Map<FirstPartyReleaseSourceId, FirstPartyReleaseSourceSnapshot>();

  if (radar.sources.length !== FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.length) {
    context.addIssue({
      code: "custom",
      message: "First-party release radar must contain every configured provider source exactly once.",
      path: ["sources"],
    });
  }

  radar.sources.forEach((source, index) => {
    const definition = FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS[index];
    if (
      definition === undefined
      || source.id !== definition.id
      || source.providerId !== definition.providerId
      || source.providerName !== definition.providerName
      || source.url !== definition.url
    ) {
      context.addIssue({
        code: "custom",
        message: "First-party sources must match their configured identities in canonical order.",
        path: ["sources", index],
      });
    }
    if (
      definition !== undefined
      && source.health.shape.uniqueEntryCount < definition.minimumEntryCount
    ) {
      context.addIssue({
        code: "custom",
        message: `${source.id} is below its minimum safe unique-entry count.`,
        path: ["sources", index, "health", "shape", "uniqueEntryCount"],
      });
    }
    if (
      definition !== undefined
      && source.health.shape.candidateCount < definition.minimumCandidateCount
    ) {
      context.addIssue({
        code: "custom",
        message: `${source.id} is below its minimum safe release-candidate count.`,
        path: ["sources", index, "health", "shape", "candidateCount"],
      });
    }
    if (!source.health.contentType.toLowerCase().includes("xml")) {
      context.addIssue({
        code: "custom",
        message: `${source.id} does not report an XML content type.`,
        path: ["sources", index, "health", "contentType"],
      });
    }
    if (sourceById.has(source.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate first-party source ${source.id}.`,
        path: ["sources", index, "id"],
      });
    }
    sourceById.set(source.id, source);
    if (source.health.shape.canonicalHostEntryCount !== source.health.shape.entryCount) {
      context.addIssue({
        code: "custom",
        message: `${source.id} contains entries outside its canonical provider host.`,
        path: ["sources", index, "health", "shape", "canonicalHostEntryCount"],
      });
    }
    if (source.health.shape.datedEntryCount !== source.health.shape.entryCount) {
      context.addIssue({
        code: "custom",
        message: `${source.id} contains entries without machine-readable lastmod dates.`,
        path: ["sources", index, "health", "shape", "datedEntryCount"],
      });
    }
    if (
      source.health.shape.uniqueEntryCount + source.health.shape.duplicateEntryCount
      !== source.health.shape.entryCount
    ) {
      context.addIssue({
        code: "custom",
        message: `${source.id} unique and duplicate entry counts do not explain its source shape.`,
        path: ["sources", index, "health", "shape"],
      });
    }
  });

  const ids = new Set<string>();
  const urls = new Set<string>();
  const presentCounts = new Map<FirstPartyReleaseSourceId, number>();
  radar.candidates.forEach((candidate, index) => {
    if (ids.has(candidate.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate first-party candidate id ${candidate.id}.`,
        path: ["candidates", index, "id"],
      });
    }
    ids.add(candidate.id);
    if (urls.has(candidate.canonicalUrl)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate first-party candidate URL ${candidate.canonicalUrl}.`,
        path: ["candidates", index, "canonicalUrl"],
      });
    }
    urls.add(candidate.canonicalUrl);

    const source = sourceById.get(candidate.sourceId);
    if (
      source === undefined
      || source.providerId !== candidate.providerId
      || source.providerName !== candidate.providerName
    ) {
      context.addIssue({
        code: "custom",
        message: `Candidate ${candidate.id} does not match its provider source.`,
        path: ["candidates", index, "sourceId"],
      });
    }
    const canonical = new URL(candidate.canonicalUrl);
    const definition = FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.find(
      item => item.id === candidate.sourceId,
    );
    if (
      canonical.protocol !== "https:"
      || canonical.username !== ""
      || canonical.password !== ""
      || canonical.search !== ""
      || canonical.hash !== ""
      || canonical.host !== definition?.canonicalHost
    ) {
      context.addIssue({
        code: "custom",
        message: `Candidate ${candidate.id} has a non-canonical provider URL.`,
        path: ["candidates", index, "canonicalUrl"],
      });
    }
    if (candidate.id !== `${candidate.providerId}:${canonical.pathname}`) {
      context.addIssue({
        code: "custom",
        message: `Candidate ${candidate.canonicalUrl} has a non-canonical id.`,
        path: ["candidates", index, "id"],
      });
    }
    if (candidate.candidateDate !== candidate.sourceModifiedAt.slice(0, 10)) {
      context.addIssue({
        code: "custom",
        message: `Candidate ${candidate.id} date must project its provider sitemap lastmod date.`,
        path: ["candidates", index, "candidateDate"],
      });
    }
    if (!isSortedUnique(candidate.namedModels)) {
      context.addIssue({
        code: "custom",
        message: `Candidate ${candidate.id} named models must be sorted and unique.`,
        path: ["candidates", index, "namedModels"],
      });
    }
    if (Date.parse(candidate.firstSeenAt) > Date.parse(candidate.lastChangedAt)) {
      context.addIssue({
        code: "custom",
        message: `Candidate ${candidate.id} changed before it was first seen.`,
        path: ["candidates", index, "lastChangedAt"],
      });
    }
    if (candidate.sourcePresence === "present") {
      presentCounts.set(candidate.sourceId, (presentCounts.get(candidate.sourceId) ?? 0) + 1);
    }
    const previous = radar.candidates[index - 1];
    if (previous !== undefined && compareCandidates(previous, candidate) > 0) {
      context.addIssue({
        code: "custom",
        message: "First-party release candidates must be newest-first with URL tie breaking.",
        path: ["candidates", index],
      });
    }
  });

  radar.sources.forEach((source, index) => {
    if (source.health.shape.candidateCount !== (presentCounts.get(source.id) ?? 0)) {
      context.addIssue({
        code: "custom",
        message: `${source.id} candidate count does not match present ledger records.`,
        path: ["sources", index, "health", "shape", "candidateCount"],
      });
    }
  });
});

export type FirstPartyReleaseSourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export type FirstPartyReleaseCandidate = z.infer<typeof releaseCandidateSchema>;
export type FirstPartyReleaseRadar = z.infer<typeof firstPartyReleaseRadarBaseSchema>;

export type SitemapEntry = Readonly<{
  lastModifiedAt: string;
  url: string;
}>;

export type ParsedProviderSitemap = Readonly<{
  duplicateEntryCount: number;
  entries: readonly SitemapEntry[];
  entryCount: number;
}>;

export type FetchedSitemap = Readonly<{
  byteLength: number;
  contentType: string;
  httpStatus: 200;
  text: string;
}>;

export type FirstPartyReleaseSourceObservation = Readonly<{
  candidates: readonly Readonly<{
    canonicalUrl: string;
    namedModels: readonly string[];
    sourceModifiedAt: string;
  }>[];
  source: FirstPartyReleaseSourceSnapshot;
}>;

function decodeXmlText(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

function exactTag(block: string, tag: string): Result<string, Error> {
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gu");
  const matches = [...block.matchAll(expression)];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    return err(new Error(`Expected exactly one <${tag}> in every sitemap <url> entry.`));
  }
  return ok(decodeXmlText(matches[0][1].trim()));
}

/** Parses the strict provider-owned sitemap subset used by the discovery ledger. */
export function parseProviderSitemap(
  definition: FirstPartyReleaseSourceDefinition,
  xml: string,
): Result<ParsedProviderSitemap, Error> {
  if (!/<urlset(?:\s|>)/u.test(xml) || !/<\/urlset>/u.test(xml)) {
    return err(new Error(`${definition.id} is no longer a sitemap urlset.`));
  }
  const blocks = [...xml.matchAll(/<url(?:\s[^>]*)?>([\s\S]*?)<\/url>/gu)];
  if (blocks.length < definition.minimumEntryCount) {
    return err(new Error(
      `${definition.id} returned ${blocks.length} entries; expected at least ${definition.minimumEntryCount}.`,
    ));
  }

  const entriesByUrl = new Map<string, SitemapEntry>();
  for (const [index, match] of blocks.entries()) {
    const block = match[1];
    if (block === undefined) return err(new Error(`${definition.id} entry ${index} is empty.`));
    const loc = exactTag(block, "loc");
    if (!loc.ok) return loc;
    const lastmod = exactTag(block, "lastmod");
    if (!lastmod.ok) return lastmod;
    let url: URL;
    try {
      url = new URL(loc.value);
    } catch (cause) {
      return err(new Error(`${definition.id} contains an invalid URL ${loc.value}.`, { cause }));
    }
    if (
      url.protocol !== "https:"
      || url.host !== definition.canonicalHost
      || url.username !== ""
      || url.password !== ""
      || url.search !== ""
      || url.hash !== ""
    ) {
      return err(new Error(`${definition.id} contains non-canonical URL ${loc.value}.`));
    }
    const modified = Date.parse(lastmod.value);
    if (!Number.isFinite(modified)) {
      return err(new Error(`${definition.id} contains invalid lastmod ${lastmod.value}.`));
    }
    const entry = { lastModifiedAt: new Date(modified).toISOString(), url: url.href };
    const existing = entriesByUrl.get(url.href);
    if (existing === undefined || Date.parse(entry.lastModifiedAt) > Date.parse(existing.lastModifiedAt)) {
      entriesByUrl.set(url.href, entry);
    }
  }
  const entries = [...entriesByUrl.values()];
  if (entries.length < definition.minimumEntryCount) {
    return err(new Error(
      `${definition.id} returned ${entries.length} unique entries; expected at least ${definition.minimumEntryCount}.`,
    ));
  }
  return ok({
    duplicateEntryCount: blocks.length - entries.length,
    entries,
    entryCount: blocks.length,
  });
}

const anthropicFamilies = ["fable", "haiku", "mythos", "opus", "sonnet"] as const;
const anthropicFamilyPattern = anthropicFamilies.join("|");

function anthropicModelName(family: string, major: string, minor?: string): string {
  const normalizedFamily = `${family[0]?.toUpperCase() ?? ""}${family.slice(1).toLowerCase()}`;
  return `Claude ${normalizedFamily} ${major}${minor === undefined ? "" : `.${minor}`}`;
}

function anthropicModels(pathname: string): string[] {
  const slug = pathname.replace(/^\//u, "").replace(/\/$/u, "");
  if (!slug.startsWith("claude-") && !slug.startsWith("news/claude-") && !slug.startsWith("news/introducing-claude-")) {
    return [];
  }
  const route = slug.replace(/^news\/(?:introducing-)?/u, "");
  const sharedVersion = route.match(new RegExp(
    `^claude-(${anthropicFamilyPattern})-and-(${anthropicFamilyPattern})-(\\d+)-(\\d+)$`,
    "u",
  ));
  if (sharedVersion !== null) {
    return sortedUnique([
      anthropicModelName(sharedVersion[1] ?? "", sharedVersion[3] ?? "", sharedVersion[4]),
      anthropicModelName(sharedVersion[2] ?? "", sharedVersion[3] ?? "", sharedVersion[4]),
    ]);
  }

  const models: string[] = [];
  const familyFirst = new RegExp(
    `(?:^|-)(${anthropicFamilyPattern})-(\\d+)(?:-(\\d+))?(?=-|$)`,
    "gu",
  );
  for (const match of route.matchAll(familyFirst)) {
    if (match[1] !== undefined && match[2] !== undefined) {
      models.push(anthropicModelName(match[1], match[2], match[3]));
    }
  }
  const versionFirst = new RegExp(
    `(?:^|-)claude-(\\d+)-(\\d+)-(${anthropicFamilyPattern})(?=-|$)`,
    "gu",
  );
  for (const match of route.matchAll(versionFirst)) {
    if (match[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
      models.push(anthropicModelName(match[3], match[1], match[2]));
    }
  }
  return sortedUnique(models);
}

const ignoredOpenAiSuffixTokens = new Set([
  "baselines",
  "benchmark",
  "card",
  "evals",
  "model-spec",
  "paper",
  "report",
  "release",
  "research",
  "safe",
  "completions",
  "spec",
  "system",
  "technical",
]);

function openAiVariantName(value: string): string {
  return value.split("-").map(token => (
    token === "api"
      ? "API"
      : token === "gpt"
        ? "GPT"
        : `${token[0]?.toUpperCase() ?? ""}${token.slice(1)}`
  )).join(" ");
}

function openAiModels(pathname: string): string[] {
  const pathMatch = pathname.match(/^\/index\/([^/]+)\/?$/u);
  if (pathMatch?.[1] === undefined) return [];
  const slug = pathMatch[1].replace(/^(?:announcing|introducing|previewing)-/u, "");
  const combinedOModels = slug.match(/^o(\d+)-and-o(\d+)(?:-([a-z0-9-]+))?$/u);
  if (combinedOModels !== null && combinedOModels[1] !== undefined && combinedOModels[2] !== undefined) {
    return sortedUnique([
      `o${combinedOModels[1]}`,
      `o${combinedOModels[2]}${combinedOModels[3] === undefined ? "" : `-${combinedOModels[3]}`}`,
    ]);
  }
  const gpt = slug.match(/^gpt-(\d+[a-z]?)(?:-(\d+))?(?:-(.+))?$/u);
  if (gpt !== null && gpt[1] !== undefined) {
    const suffix = gpt[3];
    if (suffix !== undefined && suffix.split("-").some(token => ignoredOpenAiSuffixTokens.has(token))) {
      return [];
    }
    const version = `${gpt[1]}${gpt[2] === undefined ? "" : `.${gpt[2]}`}`;
    const variantTokens = suffix?.split("-") ?? [];
    const knownVariantTokens = new Set([
      "codex",
      "instant",
      "luna",
      "max",
      "mini",
      "pro",
      "sol",
      "spark",
      "terra",
    ]);
    const variant = variantTokens.filter(token => knownVariantTokens.has(token));
    if (suffix !== undefined && variant.length === 0) return [];
    return [`GPT-${version}${variant.length === 0 ? "" : ` ${openAiVariantName(variant.join("-"))}`}`];
  }
  if (/^o\d+(?:-[a-z0-9]+)*$/u.test(slug)) return [slug];
  if (/^codex(?=[a-z0-9-]*\d)(?:-[a-z0-9]+)+$/u.test(slug)) return [openAiVariantName(slug)];
  return [];
}

/** Extracts conservative provider-model names from provider-owned release URL slugs. */
export function namedModelsForProviderUrl(
  providerId: FirstPartyReleaseProviderId,
  canonicalUrl: string,
): readonly string[] {
  const pathname = new URL(canonicalUrl).pathname.toLowerCase();
  return providerId === "anthropic" ? anthropicModels(pathname) : openAiModels(pathname);
}

function unresolvedAnnouncementName(
  providerId: FirstPartyReleaseProviderId,
  canonicalUrl: string,
): string | null {
  const pathname = new URL(canonicalUrl).pathname.toLowerCase();
  const slug = pathname.replace(/^\/(?:news\/|index\/)?/u, "").replace(/\/$/u, "");
  if (providerId === "anthropic") {
    if (!/^(?:introducing-)?claude-/u.test(slug)) return null;
  } else {
    const releaseSlug = slug.replace(/^(?:announcing|introducing|previewing)-/u, "");
    if (releaseSlug.split("-").some(token => ignoredOpenAiSuffixTokens.has(token))) return null;
    if (!/^\w[\w-]*\d[\w-]*$/u.test(releaseSlug)) return null;
  }
  return `Unresolved announcement: ${openAiVariantName(slug)}`;
}

/** Keeps unknown model-family URL shapes visible in the manual review queue. */
export function releaseCandidateNamesForProviderUrl(
  providerId: FirstPartyReleaseProviderId,
  canonicalUrl: string,
): readonly string[] {
  const parsed = namedModelsForProviderUrl(providerId, canonicalUrl);
  if (parsed.length > 0) return parsed;
  const unresolved = unresolvedAnnouncementName(providerId, canonicalUrl);
  return unresolved === null ? [] : [unresolved];
}

export function observeFirstPartyReleaseSource(
  definition: FirstPartyReleaseSourceDefinition,
  fetched: FetchedSitemap,
  retrievedAt: string,
): Result<FirstPartyReleaseSourceObservation, Error> {
  const retrievedTime = Date.parse(retrievedAt);
  if (!Number.isFinite(retrievedTime)) {
    return err(new Error(`Invalid retrieval timestamp ${retrievedAt}.`));
  }
  const parsed = parseProviderSitemap(definition, fetched.text);
  if (!parsed.ok) return parsed;
  const candidates = parsed.value.entries.flatMap(entry => {
    const namedModels = releaseCandidateNamesForProviderUrl(definition.providerId, entry.url);
    return namedModels.length === 0 ? [] : [{
      canonicalUrl: entry.url,
      namedModels,
      sourceModifiedAt: entry.lastModifiedAt,
    }];
  });
  if (candidates.length < definition.minimumCandidateCount) {
    return err(new Error(
      `${definition.id} yielded ${candidates.length} model-release candidates; expected at least ${definition.minimumCandidateCount}.`,
    ));
  }
  if (candidates.some(candidate => Date.parse(candidate.sourceModifiedAt) > retrievedTime + 24 * 60 * 60 * 1_000)) {
    return err(new Error(`${definition.id} contains a candidate lastmod more than 24 hours in the future.`));
  }
  return ok({
    candidates,
    source: {
      health: {
        contentType: fetched.contentType,
        httpStatus: fetched.httpStatus,
        shape: {
          byteLength: fetched.byteLength,
          candidateCount: candidates.length,
          canonicalHostEntryCount: parsed.value.entryCount,
          datedEntryCount: parsed.value.entryCount,
          duplicateEntryCount: parsed.value.duplicateEntryCount,
          entryCount: parsed.value.entryCount,
          rootElement: "urlset",
          uniqueEntryCount: parsed.value.entries.length,
        },
        status: "healthy",
      },
      id: definition.id,
      providerId: definition.providerId,
      providerName: definition.providerName,
      retrievedAt: new Date(retrievedTime).toISOString(),
      url: definition.url,
    },
  });
}

function candidateChanged(
  previous: FirstPartyReleaseCandidate,
  next: Pick<FirstPartyReleaseCandidate, "namedModels" | "sourceModifiedAt" | "sourcePresence">,
): boolean {
  return previous.sourceModifiedAt !== next.sourceModifiedAt
    || previous.sourcePresence !== next.sourcePresence
    || previous.namedModels.length !== next.namedModels.length
    || previous.namedModels.some((model, index) => model !== next.namedModels[index]);
}

export function emptyFirstPartyReleaseRadar(): FirstPartyReleaseRadar {
  return {
    candidates: [],
    policy: {
      durableCandidates: true,
      publication: FIRST_PARTY_RELEASE_PUBLICATION_POLICY,
      review: FIRST_PARTY_RELEASE_REVIEW_POLICY,
    },
    schemaVersion: 1,
    sources: [],
  };
}

/** Merges current provider observations into a durable review-only candidate ledger. */
export function deriveFirstPartyReleaseRadar(
  observations: readonly FirstPartyReleaseSourceObservation[],
  previous: FirstPartyReleaseRadar,
  observedAt: string,
): FirstPartyReleaseRadar {
  const observedTime = Date.parse(observedAt);
  if (!Number.isFinite(observedTime)) throw new Error(`Invalid observation timestamp ${observedAt}.`);
  const normalizedObservedAt = new Date(observedTime).toISOString();
  const previousByUrl = new Map(previous.candidates.map(candidate => [candidate.canonicalUrl, candidate]));
  const currentUrls = new Set<string>();
  const candidates: FirstPartyReleaseCandidate[] = [];

  for (const observation of observations) {
    for (const current of observation.candidates) {
      currentUrls.add(current.canonicalUrl);
      const canonical = new URL(current.canonicalUrl);
      const existing = previousByUrl.get(current.canonicalUrl);
      const common = {
        candidateDate: current.sourceModifiedAt.slice(0, 10),
        candidateDateMeaning: "provider-sitemap-lastmod" as const,
        canonicalUrl: current.canonicalUrl,
        id: `${observation.source.providerId}:${canonical.pathname}`,
        namedModels: sortedUnique(current.namedModels),
        providerId: observation.source.providerId,
        providerName: observation.source.providerName,
        sourceId: observation.source.id,
        sourceModifiedAt: current.sourceModifiedAt,
        sourcePresence: "present" as const,
      };
      candidates.push({
        ...common,
        firstSeenAt: existing?.firstSeenAt ?? normalizedObservedAt,
        lastChangedAt: existing === undefined || candidateChanged(existing, common)
          ? normalizedObservedAt
          : existing.lastChangedAt,
        status: existing?.status ?? "needs-review",
      });
    }
  }

  for (const prior of previous.candidates) {
    if (currentUrls.has(prior.canonicalUrl)) continue;
    const missing = { ...prior, sourcePresence: "missing" as const };
    candidates.push({
      ...missing,
      lastChangedAt: candidateChanged(prior, missing) ? normalizedObservedAt : prior.lastChangedAt,
    });
  }

  return {
    candidates: candidates.sort(compareCandidates),
    policy: {
      durableCandidates: true,
      publication: FIRST_PARTY_RELEASE_PUBLICATION_POLICY,
      review: FIRST_PARTY_RELEASE_REVIEW_POLICY,
    },
    schemaVersion: 1,
    sources: observations.map(observation => observation.source),
  };
}

export function parseFirstPartyReleaseRadar(value: unknown): Result<FirstPartyReleaseRadar, z.ZodError> {
  return parseResult(firstPartyReleaseRadarSchema, value);
}

export function validateFirstPartyReleaseReplacement(
  previous: FirstPartyReleaseRadar,
  candidate: FirstPartyReleaseRadar,
): Result<void, Error> {
  const candidateUrls = new Set(candidate.candidates.map(item => item.canonicalUrl));
  const dropped = previous.candidates.filter(item => !candidateUrls.has(item.canonicalUrl));
  if (dropped.length > 0) {
    return err(new Error(`First-party refresh dropped ${dropped.length} durable candidate URLs.`));
  }
  for (const prior of previous.candidates) {
    const next = candidate.candidates.find(item => item.canonicalUrl === prior.canonicalUrl);
    if (next?.status !== prior.status) {
      return err(new Error(`First-party refresh changed manual review status for ${prior.canonicalUrl}.`));
    }
    if (next?.firstSeenAt !== prior.firstSeenAt) {
      return err(new Error(`First-party refresh changed first-seen evidence for ${prior.canonicalUrl}.`));
    }
  }
  return ok(undefined);
}
