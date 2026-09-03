import { isIsoCalendarDate } from "./iso-calendar-date";
import { err, ok, type Result } from "./result";
import { parseResult, z } from "./schema";

const PROVIDER_IDS = [
  "alibaba_cloud", "amazon", "anthropic", "baidu", "bytedance", "cohere",
  "deepseek", "google", "meta", "microsoft", "minimax", "mistral",
  "moonshot_ai", "nvidia", "openai", "tencent", "xai", "xiaomi", "z_ai",
] as const;

export type FirstPartyReleaseProviderId = (typeof PROVIDER_IDS)[number];

type SourceContract = Readonly<{
  allowRelativeUrls: boolean;
  canonicalHost: string;
  datePolicy: "all" | "candidates" | "ignore";
  format:
    | "html-deepseek-updates"
    | "markdown-meta-index"
    | "markdown-minimax-releases"
    | "markdown-openai-catalog"
    | "markdown-qwen-releases"
    | "markdown-xai-releases"
    | "markdown-zai-releases"
    | "rss"
    | "sitemap-index"
    | "sitemap-urlset";
  id: string;
  minimumCandidateCount: number;
  minimumEntryCount: number;
  providerId: FirstPartyReleaseProviderId;
  providerName: string;
  url: string;
}>;

/**
 * Append-only provider-owned discovery registry. The first three definitions
 * predate the multi-lab registry; their identities, URLs and order stay stable
 * so older checked ledgers remain valid migration inputs.
 */
export const FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS = [
  {
    allowRelativeUrls: false, canonicalHost: "www.anthropic.com", datePolicy: "all",
    format: "sitemap-urlset", id: "anthropic-sitemap", minimumCandidateCount: 2,
    minimumEntryCount: 100, providerId: "anthropic", providerName: "Anthropic",
    url: "https://www.anthropic.com/sitemap.xml",
  },
  {
    allowRelativeUrls: false, canonicalHost: "openai.com", datePolicy: "all",
    format: "sitemap-urlset", id: "openai-release-sitemap", minimumCandidateCount: 5,
    minimumEntryCount: 25, providerId: "openai", providerName: "OpenAI",
    url: "https://openai.com/sitemap.xml/release/",
  },
  {
    allowRelativeUrls: false, canonicalHost: "research.meta.ai", datePolicy: "all",
    format: "sitemap-urlset", id: "meta-research-sitemap", minimumCandidateCount: 4,
    minimumEntryCount: 6, providerId: "meta", providerName: "Meta",
    url: "https://research.meta.ai/sitemap.xml",
  },
  {
    allowRelativeUrls: false, canonicalHost: "openai.com", datePolicy: "all",
    format: "sitemap-urlset", id: "openai-safety-sitemap", minimumCandidateCount: 1,
    minimumEntryCount: 75, providerId: "openai", providerName: "OpenAI",
    url: "https://openai.com/sitemap.xml/safety/",
  },
  {
    allowRelativeUrls: true, canonicalHost: "developers.openai.com", datePolicy: "ignore",
    format: "markdown-openai-catalog", id: "openai-model-catalog", minimumCandidateCount: 3,
    minimumEntryCount: 3, providerId: "openai", providerName: "OpenAI",
    url: "https://developers.openai.com/api/docs/models/all.md",
  },
  {
    allowRelativeUrls: false, canonicalHost: "about.fb.com", datePolicy: "all",
    format: "markdown-meta-index", id: "meta-newsroom-index", minimumCandidateCount: 1,
    minimumEntryCount: 50, providerId: "meta", providerName: "Meta",
    url: "https://about.fb.com/llms.txt",
  },
  {
    allowRelativeUrls: false, canonicalHost: "deepmind.google", datePolicy: "all",
    format: "sitemap-urlset", id: "google-deepmind-sitemap", minimumCandidateCount: 15,
    minimumEntryCount: 600, providerId: "google", providerName: "Google DeepMind",
    url: "https://deepmind.google/sitemap.xml",
  },
  {
    allowRelativeUrls: true, canonicalHost: "docs.x.ai", datePolicy: "ignore",
    format: "markdown-xai-releases", id: "xai-release-notes", minimumCandidateCount: 2,
    minimumEntryCount: 8, providerId: "xai", providerName: "xAI",
    url: "https://docs.x.ai/developers/release-notes.md",
  },
  {
    allowRelativeUrls: false, canonicalHost: "mistral.ai", datePolicy: "all",
    format: "sitemap-urlset", id: "mistral-site-sitemap", minimumCandidateCount: 20,
    minimumEntryCount: 400, providerId: "mistral", providerName: "Mistral AI",
    url: "https://mistral.ai/sitemap-0.xml",
  },
  {
    allowRelativeUrls: false, canonicalHost: "docs.cohere.com", datePolicy: "ignore",
    format: "sitemap-urlset", id: "cohere-docs-sitemap", minimumCandidateCount: 12,
    minimumEntryCount: 250, providerId: "cohere", providerName: "Cohere",
    url: "https://docs.cohere.com/sitemap.xml",
  },
  {
    allowRelativeUrls: false, canonicalHost: "www.deepseek.com", datePolicy: "candidates",
    format: "sitemap-urlset", id: "deepseek-site-sitemap", minimumCandidateCount: 10,
    minimumEntryCount: 30, providerId: "deepseek", providerName: "DeepSeek",
    url: "https://www.deepseek.com/sitemap.xml",
  },
  {
    allowRelativeUrls: true, canonicalHost: "api-docs.deepseek.com", datePolicy: "all",
    format: "html-deepseek-updates", id: "deepseek-api-sitemap", minimumCandidateCount: 15,
    minimumEntryCount: 20, providerId: "deepseek", providerName: "DeepSeek",
    url: "https://api-docs.deepseek.com/updates/",
  },
  {
    allowRelativeUrls: true, canonicalHost: "docs.z.ai", datePolicy: "all",
    format: "markdown-zai-releases", id: "zai-release-notes", minimumCandidateCount: 12,
    minimumEntryCount: 15, providerId: "z_ai", providerName: "Z.ai",
    url: "https://docs.z.ai/release-notes/new-released.md",
  },
  {
    allowRelativeUrls: false, canonicalHost: "platform.kimi.com", datePolicy: "all",
    format: "sitemap-urlset", id: "kimi-docs-sitemap", minimumCandidateCount: 3,
    minimumEntryCount: 150, providerId: "moonshot_ai", providerName: "Moonshot AI",
    url: "https://platform.kimi.com/docs/sitemap.xml",
  },
  {
    allowRelativeUrls: true, canonicalHost: "docs.qwencloud.com", datePolicy: "all",
    format: "markdown-qwen-releases", id: "qwen-model-releases", minimumCandidateCount: 25,
    minimumEntryCount: 40, providerId: "alibaba_cloud", providerName: "Alibaba Qwen",
    url: "https://docs.qwencloud.com/changelog/models.md",
  },
  {
    allowRelativeUrls: true, canonicalHost: "platform.minimax.io", datePolicy: "all",
    format: "markdown-minimax-releases", id: "minimax-model-releases", minimumCandidateCount: 12,
    minimumEntryCount: 15, providerId: "minimax", providerName: "MiniMax",
    url: "https://platform.minimax.io/docs/release-notes/models.md",
  },
  {
    allowRelativeUrls: false, canonicalHost: "seed.bytedance.com", datePolicy: "all",
    format: "sitemap-urlset", id: "bytedance-seed-sitemap", minimumCandidateCount: 8,
    minimumEntryCount: 25, providerId: "bytedance", providerName: "ByteDance Seed",
    url: "https://seed.bytedance.com/sitemap.xml",
  },
  {
    allowRelativeUrls: false, canonicalHost: "microsoft.ai", datePolicy: "all",
    format: "sitemap-urlset", id: "microsoft-model-sitemap", minimumCandidateCount: 5,
    minimumEntryCount: 6, providerId: "microsoft", providerName: "Microsoft AI",
    url: "https://microsoft.ai/model-sitemap.xml",
  },
  {
    allowRelativeUrls: false, canonicalHost: "blogs.nvidia.com", datePolicy: "all",
    format: "rss", id: "nvidia-nemotron-rss", minimumCandidateCount: 1,
    minimumEntryCount: 10, providerId: "nvidia", providerName: "NVIDIA",
    url: "https://blogs.nvidia.com/blog/tag/nemotron/feed/",
  },
  {
    allowRelativeUrls: false, canonicalHost: "aws.amazon.com", datePolicy: "all",
    format: "rss", id: "amazon-nova-rss", minimumCandidateCount: 4,
    minimumEntryCount: 15, providerId: "amazon", providerName: "Amazon",
    url: "https://aws.amazon.com/blogs/aws/category/artificial-intelligence/amazon-machine-learning/amazon-bedrock/amazon-nova/feed/",
  },
  {
    allowRelativeUrls: true, canonicalHost: "ernie.baidu.com", datePolicy: "candidates",
    format: "sitemap-urlset", id: "baidu-ernie-sitemap", minimumCandidateCount: 8,
    minimumEntryCount: 20, providerId: "baidu", providerName: "Baidu",
    url: "https://ernie.baidu.com/blog/en/sitemap.xml",
  },
  {
    allowRelativeUrls: false, canonicalHost: "www.tencent.com", datePolicy: "all",
    format: "sitemap-index", id: "tencent-post-sitemaps", minimumCandidateCount: 2,
    minimumEntryCount: 1_000, providerId: "tencent", providerName: "Tencent",
    url: "https://www.tencent.com/sitemap_index.xml",
  },
  {
    allowRelativeUrls: false, canonicalHost: "mimo.mi.com", datePolicy: "candidates",
    format: "sitemap-urlset", id: "xiaomi-mimo-sitemap", minimumCandidateCount: 3,
    minimumEntryCount: 100, providerId: "xiaomi", providerName: "Xiaomi MiMo",
    url: "https://mimo.mi.com/sitemap.xml",
  },
] as const satisfies readonly SourceContract[];

export const FIRST_PARTY_RELEASE_PUBLICATION_POLICY = "discovery-only" as const;
export const FIRST_PARTY_RELEASE_REVIEW_POLICY = "manual-review-required" as const;

export type FirstPartyReleaseSourceDefinition = (typeof FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS)[number];
export type FirstPartyReleaseSourceId = FirstPartyReleaseSourceDefinition["id"];

const SOURCE_IDS = FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.map(source => source.id) as [
  FirstPartyReleaseSourceId,
  ...FirstPartyReleaseSourceId[],
];
const providerIdSchema = z.enum(PROVIDER_IDS);
const sourceIdSchema = z.enum(SOURCE_IDS);
const timestampSchema = z.string().datetime({ offset: true });
const calendarDateSchema = z.string().refine(isIsoCalendarDate, "Expected an ISO calendar date.");
const reviewStatusSchema = z.enum(["needs-review", "confirmed-release", "not-a-release"]);
const sourcePresenceSchema = z.enum(["present", "missing"]);
const candidateDateMeaningSchema = z.enum([
  "first-observed", "provider-index-lastmod", "provider-published-date", "provider-sitemap-lastmod",
]);
const sourceRootElementSchema = z.enum([
  "html-release-notes", "markdown-index", "markdown-release-notes", "rss", "sitemapindex", "urlset",
]);

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
    rootElement: sourceRootElementSchema,
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
  candidateDateMeaning: candidateDateMeaningSchema,
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
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
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
  return values.every((value, index) => index === 0 || compareText(values[index - 1] ?? "", value) < 0);
}

function sourceDefinitionForId(id: FirstPartyReleaseSourceId): FirstPartyReleaseSourceDefinition {
  const definition = FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.find(source => source.id === id);
  if (definition === undefined) throw new Error(`Unknown first-party source ${id}.`);
  return definition;
}

function sourceRootElement(definition: FirstPartyReleaseSourceDefinition) {
  if (definition.format === "html-deepseek-updates") return "html-release-notes" as const;
  if (definition.format === "rss") return "rss" as const;
  if (definition.format === "sitemap-index") return "sitemapindex" as const;
  if (definition.format === "sitemap-urlset") return "urlset" as const;
  if (definition.format === "markdown-meta-index" || definition.format === "markdown-openai-catalog") {
    return "markdown-index" as const;
  }
  return "markdown-release-notes" as const;
}

export function sourceAcceptsContentType(
  definition: FirstPartyReleaseSourceDefinition,
  contentType: string,
): boolean {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (definition.format === "rss" || definition.format.startsWith("sitemap-")) {
    return new Set([
      "application/atom+xml",
      "application/rss+xml",
      "application/xml",
      "text/xml",
    ]).has(normalized);
  }
  if (definition.format === "html-deepseek-updates") return normalized === "text/html";
  return new Set(["text/markdown", "text/plain", "text/x-markdown"]).has(normalized);
}

function sourceAllowsCandidateFragment(definition: FirstPartyReleaseSourceDefinition): boolean {
  return definition.format === "html-deepseek-updates"
    || (definition.format.startsWith("markdown-")
      && definition.format !== "markdown-meta-index"
      && definition.format !== "markdown-openai-catalog");
}

function candidateIdFor(providerId: FirstPartyReleaseProviderId, canonicalUrl: string): string {
  const canonical = new URL(canonicalUrl);
  return `${providerId}:${canonical.pathname}${canonical.hash}`;
}

function firstPartyReleaseRadarSchemaFor(sourceCompleteness: "configured" | "historical") {
  return firstPartyReleaseRadarBaseSchema.superRefine((radar, context) => {
    const sourceById = new Map<FirstPartyReleaseSourceId, FirstPartyReleaseSourceSnapshot>();
    if (sourceCompleteness === "configured" && radar.schemaVersion !== 2) {
      context.addIssue({ code: "custom", message: "Configured first-party release radar must use schema version 2.", path: ["schemaVersion"] });
    }
    if (sourceCompleteness === "configured" && radar.sources.length !== FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.length) {
      context.addIssue({ code: "custom", message: "First-party release radar must contain every configured provider source exactly once.", path: ["sources"] });
    }
    let previousDefinitionIndex = -1;
    radar.sources.forEach((source, index) => {
      const definitionIndex = FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.findIndex(item => item.id === source.id);
      const definition = sourceCompleteness === "configured"
        ? FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS[index]
        : FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS[definitionIndex];
      if (
        definition === undefined
        || source.id !== definition.id
        || source.providerId !== definition.providerId
        || source.providerName !== definition.providerName
        || source.url !== definition.url
        || (sourceCompleteness === "historical" && (definitionIndex < 0 || definitionIndex <= previousDefinitionIndex))
      ) {
        context.addIssue({
          code: "custom",
          message: sourceCompleteness === "configured"
            ? "First-party sources must match their configured identities in canonical order."
            : "Historical first-party sources must match configured identities in canonical order.",
          path: ["sources", index],
        });
      }
      if (definitionIndex >= 0) previousDefinitionIndex = definitionIndex;
      if (definition !== undefined && source.health.shape.uniqueEntryCount < definition.minimumEntryCount) {
        context.addIssue({ code: "custom", message: `${source.id} is below its minimum safe unique-entry count.`, path: ["sources", index, "health", "shape", "uniqueEntryCount"] });
      }
      if (definition !== undefined && source.health.shape.candidateCount < definition.minimumCandidateCount) {
        context.addIssue({ code: "custom", message: `${source.id} is below its minimum safe release-candidate count.`, path: ["sources", index, "health", "shape", "candidateCount"] });
      }
      if (definition !== undefined && !sourceAcceptsContentType(definition, source.health.contentType)) {
        context.addIssue({ code: "custom", message: `${source.id} reports an unexpected content type.`, path: ["sources", index, "health", "contentType"] });
      }
      if (definition !== undefined && source.health.shape.rootElement !== sourceRootElement(definition)) {
        context.addIssue({ code: "custom", message: `${source.id} reports the wrong source shape.`, path: ["sources", index, "health", "shape", "rootElement"] });
      }
      if (sourceById.has(source.id)) {
        context.addIssue({ code: "custom", message: `Duplicate first-party source ${source.id}.`, path: ["sources", index, "id"] });
      }
      sourceById.set(source.id, source);
      if (source.health.shape.canonicalHostEntryCount !== source.health.shape.entryCount) {
        context.addIssue({ code: "custom", message: `${source.id} contains entries outside its canonical provider host.`, path: ["sources", index, "health", "shape", "canonicalHostEntryCount"] });
      }
      if (definition?.datePolicy === "all" && source.health.shape.datedEntryCount !== source.health.shape.entryCount) {
        context.addIssue({ code: "custom", message: `${source.id} contains entries without machine-readable dates.`, path: ["sources", index, "health", "shape", "datedEntryCount"] });
      }
      if (source.health.shape.uniqueEntryCount + source.health.shape.duplicateEntryCount !== source.health.shape.entryCount) {
        context.addIssue({ code: "custom", message: `${source.id} unique and duplicate entry counts do not explain its source shape.`, path: ["sources", index, "health", "shape"] });
      }
    });

    const ids = new Set<string>();
    const urls = new Set<string>();
    const selectedPresentCounts = new Map<FirstPartyReleaseSourceId, number>();
    radar.candidates.forEach((candidate, index) => {
      if (ids.has(candidate.id)) context.addIssue({ code: "custom", message: `Duplicate first-party candidate id ${candidate.id}.`, path: ["candidates", index, "id"] });
      ids.add(candidate.id);
      if (urls.has(candidate.canonicalUrl)) context.addIssue({ code: "custom", message: `Duplicate first-party candidate URL ${candidate.canonicalUrl}.`, path: ["candidates", index, "canonicalUrl"] });
      urls.add(candidate.canonicalUrl);
      const source = sourceById.get(candidate.sourceId);
      const definition = FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.find(item => item.id === candidate.sourceId);
      if (source === undefined || source.providerId !== candidate.providerId || source.providerName !== candidate.providerName) {
        context.addIssue({ code: "custom", message: `Candidate ${candidate.id} does not match its provider source.`, path: ["candidates", index, "sourceId"] });
      }
      const canonical = new URL(candidate.canonicalUrl);
      if (
        canonical.protocol !== "https:" || canonical.username !== "" || canonical.password !== ""
        || canonical.search !== "" || canonical.host !== definition?.canonicalHost
        || (canonical.hash !== "" && (definition === undefined || !sourceAllowsCandidateFragment(definition)))
      ) {
        context.addIssue({ code: "custom", message: `Candidate ${candidate.id} has a non-canonical provider URL.`, path: ["candidates", index, "canonicalUrl"] });
      }
      if (candidate.id !== candidateIdFor(candidate.providerId, candidate.canonicalUrl)) {
        context.addIssue({ code: "custom", message: `Candidate ${candidate.canonicalUrl} has a non-canonical id.`, path: ["candidates", index, "id"] });
      }
      const expectedDate = candidate.candidateDateMeaning === "first-observed"
        ? candidate.firstSeenAt.slice(0, 10)
        : candidate.sourceModifiedAt.slice(0, 10);
      if (candidate.candidateDate !== expectedDate) {
        context.addIssue({ code: "custom", message: `Candidate ${candidate.id} date does not match its stated discovery meaning.`, path: ["candidates", index, "candidateDate"] });
      }
      if (candidate.candidateDateMeaning === "first-observed" && candidate.sourceModifiedAt !== candidate.firstSeenAt) {
        context.addIssue({ code: "custom", message: `Candidate ${candidate.id} first-observed evidence must remain stable.`, path: ["candidates", index, "sourceModifiedAt"] });
      }
      if (!isSortedUnique(candidate.namedModels)) context.addIssue({ code: "custom", message: `Candidate ${candidate.id} named models must be sorted and unique.`, path: ["candidates", index, "namedModels"] });
      if (Date.parse(candidate.firstSeenAt) > Date.parse(candidate.lastChangedAt)) context.addIssue({ code: "custom", message: `Candidate ${candidate.id} changed before it was first seen.`, path: ["candidates", index, "lastChangedAt"] });
      if (candidate.sourcePresence === "present" && releaseCandidateNamesForSourceUrl(candidate.sourceId, candidate.canonicalUrl).length > 0) {
        selectedPresentCounts.set(candidate.sourceId, (selectedPresentCounts.get(candidate.sourceId) ?? 0) + 1);
      }
      const previous = radar.candidates[index - 1];
      if (previous !== undefined && compareCandidates(previous, candidate) > 0) context.addIssue({ code: "custom", message: "First-party release candidates must be newest-first with URL tie breaking.", path: ["candidates", index] });
    });
    radar.sources.forEach((source, index) => {
      if (source.health.shape.candidateCount !== (selectedPresentCounts.get(source.id) ?? 0)) {
        context.addIssue({ code: "custom", message: `${source.id} candidate count does not match selected present ledger records.`, path: ["sources", index, "health", "shape", "candidateCount"] });
      }
    });
  });
}

const firstPartyReleaseRadarSchema = firstPartyReleaseRadarSchemaFor("configured");
const previousFirstPartyReleaseRadarSchema = firstPartyReleaseRadarSchemaFor("historical");

export type FirstPartyReleaseSourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export type FirstPartyReleaseCandidate = z.infer<typeof releaseCandidateSchema>;
export type FirstPartyReleaseRadar = z.infer<typeof firstPartyReleaseRadarBaseSchema>;
export type FirstPartyReleaseCandidateDateMeaning = z.infer<typeof candidateDateMeaningSchema>;

export type SitemapEntry = Readonly<{
  candidateDateMeaning?: FirstPartyReleaseCandidateDateMeaning;
  lastModifiedAt: string | null;
  namedModels?: readonly string[];
  url: string;
}>;
export type ParsedProviderSitemap = Readonly<{
  datedEntryCount: number;
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
    candidateDateMeaning: FirstPartyReleaseCandidateDateMeaning;
    canonicalUrl: string;
    namedModels: readonly string[];
    sourceModifiedAt: string | null;
  }>[];
  entries: readonly SitemapEntry[];
  source: FirstPartyReleaseSourceSnapshot;
}>;

function decodeXmlText(value: string): string {
  return value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", "\"").replaceAll("&apos;", "'");
}

function exactTag(block: string, tag: string): Result<string, Error> {
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "gu");
  const matches = [...block.matchAll(expression)];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) return err(new Error(`Expected exactly one <${tag}> in every provider-source entry.`));
  return ok(decodeXmlText(matches[0][1].trim()));
}

function optionalTag(block: string, tag: string): Result<string | null, Error> {
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "gu");
  const matches = [...block.matchAll(expression)];
  if (matches.length > 1 || (matches.length === 1 && matches[0]?.[1] === undefined)) return err(new Error(`Expected at most one <${tag}> in every provider-source entry.`));
  const value = matches[0]?.[1];
  return ok(value === undefined ? null : decodeXmlText(value.trim()));
}

function canonicalProviderUrl(definition: FirstPartyReleaseSourceDefinition, rawUrl: string, allowHash: boolean): Result<string, Error> {
  let url: URL;
  try {
    url = definition.allowRelativeUrls ? new URL(rawUrl, `https://${definition.canonicalHost}`) : new URL(rawUrl);
  } catch (cause) {
    return err(new Error(`${definition.id} contains invalid URL ${rawUrl}.`, { cause }));
  }
  if (
    url.protocol !== "https:" || url.host !== definition.canonicalHost || url.username !== ""
    || url.password !== "" || url.search !== "" || (!allowHash && url.hash !== "")
  ) return err(new Error(`${definition.id} contains non-canonical URL ${rawUrl}.`));
  if (url.pathname.endsWith(".md")) url.pathname = url.pathname.slice(0, -3);
  return ok(url.href);
}

function normalizedTimestamp(value: string, sourceId: string): Result<string, Error> {
  const trimmed = value.trim();
  const monthMatch = trimmed.match(/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.? (\d{1,2}), (\d{4})$/u);
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;
  const rfcMatch = trimmed.match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})(?:\s|$)/u);
  const calendarDate = monthMatch?.[1] !== undefined && monthMatch[2] !== undefined && monthMatch[3] !== undefined
    ? `${monthMatch[3]}-${String(monthNames.indexOf(monthMatch[1].slice(0, 3).toLowerCase() as (typeof monthNames)[number]) + 1).padStart(2, "0")}-${monthMatch[2].padStart(2, "0")}`
    : rfcMatch?.[1] !== undefined && rfcMatch[2] !== undefined && rfcMatch[3] !== undefined
      ? `${rfcMatch[3]}-${String(monthNames.indexOf(rfcMatch[2].toLowerCase() as (typeof monthNames)[number]) + 1).padStart(2, "0")}-${rfcMatch[1].padStart(2, "0")}`
      : trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/u)?.[1];
  if (calendarDate !== undefined && !isIsoCalendarDate(calendarDate)) {
    return err(new Error(`${sourceId} contains invalid date ${value}.`));
  }
  const timestamp = monthMatch?.[1] !== undefined && monthMatch[2] !== undefined && monthMatch[3] !== undefined
    ? Date.UTC(Number(monthMatch[3]), monthNames.indexOf(monthMatch[1].slice(0, 3).toLowerCase() as (typeof monthNames)[number]), Number(monthMatch[2]))
    : Date.parse(/^\d{4}-\d{2}-\d{2}$/u.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed);
  return Number.isFinite(timestamp) ? ok(new Date(timestamp).toISOString()) : err(new Error(`${sourceId} contains invalid date ${value}.`));
}

function deduplicateEntries(entries: readonly SitemapEntry[]) {
  const entriesByUrl = new Map<string, SitemapEntry>();
  for (const entry of entries) {
    const existing = entriesByUrl.get(entry.url);
    if (
      existing === undefined
      || (entry.lastModifiedAt !== null && (existing.lastModifiedAt === null || Date.parse(entry.lastModifiedAt) > Date.parse(existing.lastModifiedAt)))
    ) entriesByUrl.set(entry.url, entry);
  }
  return { duplicateEntryCount: entries.length - entriesByUrl.size, entries: [...entriesByUrl.values()] };
}

function parseSitemapUrlset(definition: FirstPartyReleaseSourceDefinition, xml: string): Result<ParsedProviderSitemap, Error> {
  const rootOpeningCount = [...xml.matchAll(/<urlset(?:\s|>)/gu)].length;
  const rootClosingCount = [...xml.matchAll(/<\/urlset>/gu)].length;
  if (
    /<!DOCTYPE/iu.test(xml) || rootOpeningCount !== 1 || rootClosingCount !== 1
    || /<sitemapindex(?:\s|>)/u.test(xml)
  ) return err(new Error(`${definition.id} is no longer a strict sitemap urlset.`));
  const blocks = [...xml.matchAll(/<url(?:\s[^>]*)?>([\s\S]*?)<\/url>/gu)];
  const openingCount = [...xml.matchAll(/<url\b[^>]*>/gu)].length;
  const closingCount = [...xml.matchAll(/<\/url>/gu)].length;
  if (blocks.length !== openingCount || blocks.length !== closingCount) {
    return err(new Error(`${definition.id} contains malformed or unmatched URL entries.`));
  }
  if (blocks.length < definition.minimumEntryCount) return err(new Error(`${definition.id} returned ${blocks.length} entries; expected at least ${definition.minimumEntryCount}.`));
  const rawEntries: SitemapEntry[] = [];
  let datedEntryCount = 0;
  for (const [index, match] of blocks.entries()) {
    const block = match[1];
    if (block === undefined) return err(new Error(`${definition.id} entry ${index} is empty.`));
    const loc = exactTag(block, "loc");
    if (!loc.ok) return loc;
    const canonical = canonicalProviderUrl(definition, loc.value, false);
    if (!canonical.ok) return canonical;
    const lastmod = optionalTag(block, "lastmod");
    if (!lastmod.ok) return lastmod;
    let lastModifiedAt: string | null = null;
    if (lastmod.value !== null) {
      const normalized = normalizedTimestamp(lastmod.value, definition.id);
      if (!normalized.ok) return normalized;
      lastModifiedAt = normalized.value;
      datedEntryCount += 1;
    } else if (definition.datePolicy === "all") return err(new Error(`${definition.id} contains an entry without a lastmod date.`));
    rawEntries.push({ lastModifiedAt, url: canonical.value });
  }
  const deduplicated = deduplicateEntries(rawEntries);
  if (deduplicated.entries.length < definition.minimumEntryCount) return err(new Error(`${definition.id} returned ${deduplicated.entries.length} unique entries; expected at least ${definition.minimumEntryCount}.`));
  return ok({ datedEntryCount, duplicateEntryCount: deduplicated.duplicateEntryCount, entries: deduplicated.entries, entryCount: blocks.length });
}

function parseRss(definition: FirstPartyReleaseSourceDefinition, xml: string): Result<ParsedProviderSitemap, Error> {
  const rootOpeningCount = [...xml.matchAll(/<rss(?:\s|>)/gu)].length;
  const rootClosingCount = [...xml.matchAll(/<\/rss>/gu)].length;
  const channelOpeningCount = [...xml.matchAll(/<channel(?:\s|>)/gu)].length;
  const channelClosingCount = [...xml.matchAll(/<\/channel>/gu)].length;
  if (
    /<!DOCTYPE/iu.test(xml) || rootOpeningCount !== 1 || rootClosingCount !== 1
    || channelOpeningCount !== 1 || channelClosingCount !== 1
  ) return err(new Error(`${definition.id} is no longer a strict RSS document.`));
  const blocks = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gu)];
  const openingCount = [...xml.matchAll(/<item\b[^>]*>/gu)].length;
  const closingCount = [...xml.matchAll(/<\/item>/gu)].length;
  if (blocks.length !== openingCount || blocks.length !== closingCount) {
    return err(new Error(`${definition.id} contains malformed or unmatched RSS items.`));
  }
  if (blocks.length < definition.minimumEntryCount) return err(new Error(`${definition.id} returned ${blocks.length} items; expected at least ${definition.minimumEntryCount}.`));
  const rawEntries: SitemapEntry[] = [];
  for (const [index, match] of blocks.entries()) {
    const block = match[1];
    if (block === undefined) return err(new Error(`${definition.id} item ${index} is empty.`));
    const link = exactTag(block, "link");
    if (!link.ok) return link;
    const canonical = canonicalProviderUrl(definition, link.value, false);
    if (!canonical.ok) return canonical;
    const pubDate = exactTag(block, "pubDate");
    if (!pubDate.ok) return pubDate;
    const normalized = normalizedTimestamp(pubDate.value, definition.id);
    if (!normalized.ok) return normalized;
    const title = exactTag(block, "title");
    if (!title.ok) return title;
    rawEntries.push({
      candidateDateMeaning: "provider-published-date",
      lastModifiedAt: normalized.value,
      namedModels: namedModelsForProviderText(definition.providerId, title.value),
      url: canonical.value,
    });
  }
  const deduplicated = deduplicateEntries(rawEntries);
  return ok({ datedEntryCount: blocks.length, duplicateEntryCount: deduplicated.duplicateEntryCount, entries: deduplicated.entries, entryCount: blocks.length });
}

function parseDeepSeekUpdates(definition: FirstPartyReleaseSourceDefinition, html: string): Result<ParsedProviderSitemap, Error> {
  if (!/^<!doctype html>/iu.test(html) || !/<html(?:\s|>)/iu.test(html) || !/<\/html>/iu.test(html)) {
    return err(new Error(`${definition.id} is no longer an HTML document.`));
  }
  const contentMarker = '<div class="theme-doc-markdown markdown">';
  const contentMarkers = [...html.matchAll(new RegExp(contentMarker, "gu"))];
  if (contentMarkers.length !== 1 || contentMarkers[0]?.index === undefined) {
    return err(new Error(`${definition.id} must contain exactly one owned change-log region.`));
  }
  const contentStart = contentMarkers[0].index + contentMarker.length;
  const contentEnd = html.indexOf("</article>", contentStart);
  if (contentEnd < 0) return err(new Error(`${definition.id} is missing the end of its owned change-log region.`));
  const content = html.slice(contentStart, contentEnd);
  if ([...content.matchAll(/<h1\b/gu)].length !== 1 || /<h[4-6]\b/gu.test(content)) {
    return err(new Error(`${definition.id} contains an unexpected change-log heading level.`));
  }
  const headingCount = [...content.matchAll(/<h[23]\b/gu)].length;
  const headings = [...content.matchAll(/<h([23])\b([^>]*)>([\s\S]*?)<a\b([^>]*)>[\s\S]*?<\/a>\s*<\/h\1>/gu)];
  if (headings.length !== headingCount) {
    return err(new Error(`${definition.id} contains ${headingCount} date or release headings, but ${headings.length} match the owned HTML shape.`));
  }

  const rawEntries: SitemapEntry[] = [];
  let currentDate: string | null = null;
  for (const [headingIndex, heading] of headings.entries()) {
    const level = heading[1]; const attributes = heading[2] ?? "";
    const rawTitle = heading[3]; const anchorAttributes = heading[4] ?? "";
    const ids = [...attributes.matchAll(/\bid="([^"]+)"/gu)];
    const hrefs = [...anchorAttributes.matchAll(/\bhref="#([^"]+)"/gu)];
    const id = ids[0]?.[1]; const href = hrefs[0]?.[1];
    const unsupportedTitleMarkup = rawTitle?.replace(/<\/?code>/gu, "").match(/<[^>]+>/u);
    const title = rawTitle === undefined
      ? ""
      : decodeXmlText(rawTitle.replace(/<\/?code>/gu, "")).trim();
    if (
      ids.length !== 1 || hrefs.length !== 1 || id === undefined || href !== id
      || !/^[a-z0-9][a-z0-9-]*$/u.test(id) || title === "" || unsupportedTitleMarkup !== null
    ) return err(new Error(`${definition.id} contains an unparseable change-log heading.`));

    if (level === "2") {
      const date = title.match(/^Date: (\d{4}-\d{2}-\d{2})$/u)?.[1];
      if (date === undefined || id !== `date-${date}` || !isIsoCalendarDate(date)) {
        return err(new Error(`${definition.id} contains an invalid date heading ${title}.`));
      }
      currentDate = date;
      continue;
    }
    if (currentDate === null) return err(new Error(`${definition.id} contains a release heading before its date.`));
    const normalized = normalizedTimestamp(currentDate, definition.id);
    if (!normalized.ok) return normalized;
    const headingStart = heading.index;
    if (headingStart === undefined) return err(new Error(`${definition.id} contains a release heading without a source position.`));
    const detailEnd = headings[headingIndex + 1]?.index ?? content.length;
    const detailMarkup = content.slice(headingStart + heading[0].length, detailEnd);
    const detailText = decodeXmlText(detailMarkup.replace(/<[^>]+>/gu, " "));
    const titleVersions = deepSeekVersionModelsFromText(title);
    const detailVersions = deepSeekVersionModelsFromText(detailText);
    const namedModels = titleVersions.length > 0
      ? titleVersions
      : detailVersions[0] === undefined
        ? deepSeekModelsFromText(title)
        : [detailVersions[0]];
    rawEntries.push({
      candidateDateMeaning: "provider-published-date",
      lastModifiedAt: normalized.value,
      namedModels,
      url: releaseNoteUrl(definition, `${currentDate}-${title}`),
    });
  }
  return finalizedMarkdownEntries(definition, rawEntries, rawEntries.length);
}

function stableFragment(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 120);
}

function releaseNoteUrl(definition: FirstPartyReleaseSourceDefinition, identity: string): string {
  const url = new URL(definition.url);
  if (url.pathname.endsWith(".md")) url.pathname = url.pathname.slice(0, -3);
  url.hash = stableFragment(identity);
  return url.href;
}

function finalizedMarkdownEntries(definition: FirstPartyReleaseSourceDefinition, rawEntries: readonly SitemapEntry[], datedEntryCount: number): Result<ParsedProviderSitemap, Error> {
  if (rawEntries.length < definition.minimumEntryCount) return err(new Error(`${definition.id} returned ${rawEntries.length} records; expected at least ${definition.minimumEntryCount}.`));
  for (const entry of rawEntries) {
    const canonical = canonicalProviderUrl(definition, entry.url, sourceAllowsCandidateFragment(definition));
    if (!canonical.ok) return canonical;
  }
  const deduplicated = deduplicateEntries(rawEntries);
  if (deduplicated.entries.length < definition.minimumEntryCount) return err(new Error(`${definition.id} returned ${deduplicated.entries.length} unique records; expected at least ${definition.minimumEntryCount}.`));
  return ok({ datedEntryCount, duplicateEntryCount: deduplicated.duplicateEntryCount, entries: deduplicated.entries, entryCount: rawEntries.length });
}

function ownedMarkdownSection(definition: FirstPartyReleaseSourceDefinition, markdown: string, heading: string): Result<string, Error> {
  const normalized = markdown.replaceAll("\r\n", "\n");
  const headingLevel = heading.match(/^#+/u)?.[0].length;
  if (headingLevel === undefined) return err(new Error(`${definition.id} has an invalid configured Markdown section ${heading}.`));
  const headings = [...normalized.matchAll(/^(#{1,6})[ \t]+[^\n]+$/gmu)]
    .filter(match => match[0].trim() === heading);
  if (headings.length !== 1 || headings[0]?.index === undefined) {
    return err(new Error(`${definition.id} must contain exactly one ${heading} section; found ${headings.length}.`));
  }
  const sectionStart = headings[0].index + headings[0][0].length;
  const remainder = normalized.slice(sectionStart);
  const nextSection = [...remainder.matchAll(/^(#{1,6})[ \t]+[^\n]+$/gmu)]
    .find(match => (match[1]?.length ?? Number.POSITIVE_INFINITY) <= headingLevel);
  return ok(remainder.slice(0, nextSection?.index ?? remainder.length));
}

function markdownLinesOutsideCodeFences(
  definition: FirstPartyReleaseSourceDefinition,
  markdown: string,
): Result<readonly string[], Error> {
  const lines: string[] = [];
  let fenceCharacter: "`" | "~" | null = null;
  for (const line of markdown.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
    if (marker !== undefined) {
      const character = marker[0] as "`" | "~";
      if (fenceCharacter === null) fenceCharacter = character;
      else if (character === fenceCharacter) fenceCharacter = null;
      continue;
    }
    if (fenceCharacter === null) lines.push(line);
  }
  return fenceCharacter === null
    ? ok(lines)
    : err(new Error(`${definition.id} contains an unterminated Markdown code fence.`));
}

function unparseableMarkdownRow(definition: FirstPartyReleaseSourceDefinition, kind: string, row: string): Result<never, Error> {
  return err(new Error(`${definition.id} contains an unparseable ${kind}: ${row.trim().slice(0, 160)}`));
}

function parseOpenAiCatalog(definition: FirstPartyReleaseSourceDefinition, markdown: string): Result<ParsedProviderSitemap, Error> {
  const featured = ownedMarkdownSection(definition, markdown, "## Featured models");
  if (!featured.ok) return featured;
  const lines = markdownLinesOutsideCodeFences(definition, featured.value);
  if (!lines.ok) return lines;
  const rawEntries: SitemapEntry[] = [];
  for (const line of lines.value) {
    if (!/^\s*[-*+]\s+/u.test(line) && !/\/api\/docs\/models\//u.test(line)) continue;
    const match = line.match(/^- \[([^\]\n]+)\]\(([^)\n]+)\):.*$/u);
    const title = match?.[1]?.trim();
    const href = match?.[2];
    if (title === undefined || title === "" || href === undefined) {
      return unparseableMarkdownRow(definition, "featured-model row", line);
    }
    const canonical = canonicalProviderUrl(definition, href, false);
    if (!canonical.ok) return canonical;
    rawEntries.push({ candidateDateMeaning: "first-observed", lastModifiedAt: null, namedModels: [title], url: canonical.value });
  }
  return finalizedMarkdownEntries(definition, rawEntries, 0);
}

function parseMetaIndex(definition: FirstPartyReleaseSourceDefinition, markdown: string): Result<ParsedProviderSitemap, Error> {
  const content = ownedMarkdownSection(definition, markdown, "## Content");
  if (!content.ok) return content;
  const lines = markdownLinesOutsideCodeFences(definition, content.value);
  if (!lines.ok) return lines;
  const rawEntries: SitemapEntry[] = [];
  const expression = /^- \[([^\]]+)\]\((https:\/\/[^)]+\.md)\):[^\n]*?Last updated ([0-9T:+.-]+)\.$/u;
  for (const line of lines.value) {
    if (!/^\s*[-*+]\s+/u.test(line) && !/https:\/\/about\.fb\.com\/news\/[^)\s]+\.md/u.test(line)) continue;
    const match = line.match(expression);
    const title = match?.[1]; const href = match?.[2]; const date = match?.[3];
    if (title === undefined || href === undefined || date === undefined) {
      return unparseableMarkdownRow(definition, "news-index row", line);
    }
    const canonical = canonicalProviderUrl(definition, href, false);
    if (!canonical.ok) return canonical;
    const normalized = normalizedTimestamp(date, definition.id);
    if (!normalized.ok) return normalized;
    rawEntries.push({ candidateDateMeaning: "provider-index-lastmod", lastModifiedAt: normalized.value, namedModels: namedModelsForProviderText(definition.providerId, title), url: canonical.value });
  }
  return finalizedMarkdownEntries(definition, rawEntries, rawEntries.length);
}

function parseZaiReleases(definition: FirstPartyReleaseSourceDefinition, markdown: string): Result<ParsedProviderSitemap, Error> {
  const models = ownedMarkdownSection(definition, markdown, "## Models");
  if (!models.ok) return models;
  const updates = [...models.value.matchAll(/<Update label="([^"]+)" description="\s*([^"]+)">[\s\S]*?<\/Update>/gu)];
  const openingCount = [...models.value.matchAll(/<Update\b/gu)].length;
  const closingCount = [...models.value.matchAll(/<\/Update>/gu)].length;
  if (updates.length !== openingCount || updates.length !== closingCount) {
    return unparseableMarkdownRow(definition, "Update row", `${openingCount} opening, ${closingCount} closing, ${updates.length} parsed`);
  }
  const rawEntries: SitemapEntry[] = [];
  for (const match of updates) {
    const date = match[1]; const title = match[2]?.trim();
    if (date === undefined || title === undefined || title === "") {
      return unparseableMarkdownRow(definition, "Update row", match[0]);
    }
    const normalized = normalizedTimestamp(date, definition.id);
    if (!normalized.ok) return normalized;
    rawEntries.push({ candidateDateMeaning: "provider-published-date", lastModifiedAt: normalized.value, namedModels: namedModelsForProviderText(definition.providerId, title), url: releaseNoteUrl(definition, `${date}-${title}`) });
  }
  return finalizedMarkdownEntries(definition, rawEntries, rawEntries.length);
}

function parseQwenReleases(definition: FirstPartyReleaseSourceDefinition, markdown: string): Result<ParsedProviderSitemap, Error> {
  const releases = ownedMarkdownSection(definition, markdown, "# Model releases");
  if (!releases.ok) return releases;
  const updates = [...releases.value.matchAll(/<Update label="([^"]+)">([\s\S]*?)<\/Update>/gu)];
  const openingCount = [...releases.value.matchAll(/<Update\b/gu)].length;
  const closingCount = [...releases.value.matchAll(/<\/Update>/gu)].length;
  if (updates.length !== openingCount || updates.length !== closingCount) {
    return unparseableMarkdownRow(definition, "Update row", `${openingCount} opening, ${closingCount} closing, ${updates.length} parsed`);
  }
  const rawEntries: SitemapEntry[] = [];
  for (const update of updates) {
    const date = update[1]; const body = update[2];
    if (date === undefined || body === undefined) {
      return unparseableMarkdownRow(definition, "Update row", update[0]);
    }
    const normalized = normalizedTimestamp(date, definition.id);
    if (!normalized.ok) return normalized;
    let updateEntryCount = 0;
    const lines = markdownLinesOutsideCodeFences(definition, body);
    if (!lines.ok) return lines;
    for (const line of lines.value) {
      if (!/^\s*###(?!#)/u.test(line)) continue;
      const title = line.match(/^\s{0,4}###\s+(.+)$/u)?.[1]?.trim();
      if (title === undefined || title === "") {
        return unparseableMarkdownRow(definition, "model heading", line);
      }
      rawEntries.push({ candidateDateMeaning: "provider-published-date", lastModifiedAt: normalized.value, namedModels: namedModelsForProviderText(definition.providerId, title), url: releaseNoteUrl(definition, `${date}-${title}`) });
      updateEntryCount += 1;
    }
    if (updateEntryCount === 0) {
      const normalizedBody = body.trim().replace(/\s+/gu, " ");
      if (normalizedBody === "## General availability QwenCloud is now generally available.") continue;
      return unparseableMarkdownRow(definition, "model heading", body);
    }
  }
  return finalizedMarkdownEntries(definition, rawEntries, rawEntries.length);
}

function parseMiniMaxReleases(definition: FirstPartyReleaseSourceDefinition, markdown: string): Result<ParsedProviderSitemap, Error> {
  const models = ownedMarkdownSection(definition, markdown, "# Models");
  if (!models.ok) return models;
  const headings = [...models.value.matchAll(/^####(?!#)[^\n]*$/gmu)];
  for (const heading of headings) {
    if (!/^####\s+(.+)$/u.test(heading[0])) {
      return unparseableMarkdownRow(definition, "release-date heading", heading[0]);
    }
  }
  const cards = [...models.value.matchAll(/<Card title="([^"]+)"[^>]*>[\s\S]*?<\/Card>/gu)];
  const openingCount = [...models.value.matchAll(/<Card\b/gu)].length;
  const closingCount = [...models.value.matchAll(/<\/Card>/gu)].length;
  if (cards.length !== openingCount || cards.length !== closingCount) {
    return unparseableMarkdownRow(definition, "Card row", `${openingCount} opening, ${closingCount} closing, ${cards.length} parsed`);
  }
  const rawEntries: SitemapEntry[] = [];
  for (const [index, heading] of headings.entries()) {
    const date = heading[0].match(/^####\s+(.+)$/u)?.[1]?.trim();
    if (date === undefined || date === "" || heading.index === undefined) {
      return unparseableMarkdownRow(definition, "release-date heading", heading[0]);
    }
    const end = headings[index + 1]?.index ?? models.value.length;
    const body = models.value.slice(heading.index + heading[0].length, end);
    const normalized = normalizedTimestamp(date, definition.id);
    if (!normalized.ok) return normalized;
    const datedCards = [...body.matchAll(/<Card title="([^"]+)"[^>]*>[\s\S]*?<\/Card>/gu)];
    if (datedCards.length === 0) {
      return unparseableMarkdownRow(definition, "release-date row without a Card", heading[0]);
    }
    for (const card of datedCards) {
      const title = card[1]?.trim();
      if (title === undefined || title === "") {
        return unparseableMarkdownRow(definition, "Card row", card[0]);
      }
      rawEntries.push({ candidateDateMeaning: "provider-published-date", lastModifiedAt: normalized.value, namedModels: namedModelsForProviderText(definition.providerId, title), url: releaseNoteUrl(definition, `${date}-${title}`) });
    }
  }
  if (rawEntries.length !== cards.length) {
    return unparseableMarkdownRow(definition, "Card outside a release-date row", `${cards.length} Cards, ${rawEntries.length} dated Cards`);
  }
  return finalizedMarkdownEntries(definition, rawEntries, rawEntries.length);
}

function parseXaiReleases(definition: FirstPartyReleaseSourceDefinition, markdown: string): Result<ParsedProviderSitemap, Error> {
  const releases = ownedMarkdownSection(definition, markdown, "# Release Notes");
  if (!releases.ok) return releases;
  const lines = markdownLinesOutsideCodeFences(definition, releases.value);
  if (!lines.ok) return lines;
  const rawEntries: SitemapEntry[] = [];
  for (const line of lines.value) {
    if (!/^\s*###(?!#)/u.test(line)) continue;
    const title = line.match(/^###\s+(.+)$/u)?.[1]?.trim();
    if (title === undefined || title === "") {
      return unparseableMarkdownRow(definition, "release heading", line);
    }
    rawEntries.push({ candidateDateMeaning: "first-observed", lastModifiedAt: null, namedModels: namedModelsForProviderText(definition.providerId, title), url: releaseNoteUrl(definition, title) });
  }
  return finalizedMarkdownEntries(definition, rawEntries, 0);
}

/** Parses the strict provider-owned source subset used by the discovery ledger. */
export function parseProviderSitemap(definition: FirstPartyReleaseSourceDefinition, source: string): Result<ParsedProviderSitemap, Error> {
  if (definition.format === "html-deepseek-updates") return parseDeepSeekUpdates(definition, source);
  if (definition.format === "rss") return parseRss(definition, source);
  if (definition.format === "markdown-openai-catalog") return parseOpenAiCatalog(definition, source);
  if (definition.format === "markdown-meta-index") return parseMetaIndex(definition, source);
  if (definition.format === "markdown-zai-releases") return parseZaiReleases(definition, source);
  if (definition.format === "markdown-qwen-releases") return parseQwenReleases(definition, source);
  if (definition.format === "markdown-minimax-releases") return parseMiniMaxReleases(definition, source);
  if (definition.format === "markdown-xai-releases") return parseXaiReleases(definition, source);
  return parseSitemapUrlset(definition, source);
}

const anthropicFamilies = ["fable", "haiku", "mythos", "opus", "sonnet"] as const;
const anthropicFamilyPattern = anthropicFamilies.join("|");
const anthropicExactModelRoutes = {
  "claude-2": ["Claude 2"], "claude-2-1": ["Claude 2.1"],
  "claude-3-family": ["Claude 3 Opus", "Claude 3 Sonnet"], "claude-3-haiku": ["Claude 3 Haiku"],
  "claude-4": ["Claude Opus 4", "Claude Sonnet 4"],
  "claude-gov-models-for-u-s-national-security-customers": ["Claude Gov models"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

function titleToken(token: string): string {
  const exact: Readonly<Record<string, string>> = {
    ai: "AI", api: "API", asr: "ASR", audio: "Audio", code: "Code", er: "ER", flash: "Flash", gpt: "GPT",
    image: "Image", mini: "Mini", mt: "MT", omni: "Omni", preview: "Preview", pro: "Pro",
    realtime: "Realtime", tts: "TTS", vl: "VL", vlm: "VLM",
  };
  return exact[token] ?? `${token[0]?.toUpperCase() ?? ""}${token.slice(1)}`;
}

function displaySlug(slug: string): string {
  const tokens = slug.replaceAll(".", "-").split("-").filter(Boolean);
  const result: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? ""; const next = tokens[index + 1];
    const joinedVersion = token.match(/^([a-z]+)(\d+)$/iu);
    if (joinedVersion?.[1] !== undefined && joinedVersion[2] !== undefined && next !== undefined && /^\d{1,2}$/u.test(next)) {
      result.push(`${titleToken(joinedVersion[1].toLowerCase())}${joinedVersion[2]}.${next}`); index += 1;
    } else if (/^\d{1,2}$/u.test(token) && next !== undefined && /^\d{1,2}$/u.test(next)) {
      result.push(`${token}.${next}`); index += 1;
    } else result.push(/^\d+b$/iu.test(token) ? token.toUpperCase() : titleToken(token));
  }
  return result.join(" ");
}

function unresolvedName(value: string): string {
  return `Unresolved announcement: ${displaySlug(value)}`;
}

function anthropicModelName(family: string, major: string, minor?: string): string {
  const normalizedFamily = `${family[0]?.toUpperCase() ?? ""}${family.slice(1).toLowerCase()}`;
  return `Claude ${normalizedFamily} ${major}${minor === undefined ? "" : `.${minor}`}`;
}

function anthropicModels(url: URL): string[] {
  const slug = url.pathname.replace(/^\//u, "").replace(/\/$/u, "");
  if (!slug.startsWith("claude-") && !slug.startsWith("news/claude-") && !slug.startsWith("news/introducing-claude-")) return [];
  const route = slug.replace(/^news\/(?:introducing-)?/u, "");
  const exactModels = anthropicExactModelRoutes[route as keyof typeof anthropicExactModelRoutes];
  if (exactModels !== undefined) return [...exactModels];
  const sharedVersion = route.match(new RegExp(`^claude-(${anthropicFamilyPattern})-and-(${anthropicFamilyPattern})-(\\d+)-(\\d+)$`, "u"));
  if (sharedVersion !== null) return sortedUnique([
    anthropicModelName(sharedVersion[1] ?? "", sharedVersion[3] ?? "", sharedVersion[4]),
    anthropicModelName(sharedVersion[2] ?? "", sharedVersion[3] ?? "", sharedVersion[4]),
  ]);
  const models: string[] = [];
  for (const match of route.matchAll(new RegExp(`(?:^|-)(${anthropicFamilyPattern})-(\\d+)(?:-(\\d+))?(?=-|$)`, "gu"))) {
    if (match[1] !== undefined && match[2] !== undefined) models.push(anthropicModelName(match[1], match[2], match[3]));
  }
  for (const match of route.matchAll(new RegExp(`(?:^|-)claude-(\\d+)-(\\d+)-(${anthropicFamilyPattern})(?=-|$)`, "gu"))) {
    if (match[1] !== undefined && match[2] !== undefined && match[3] !== undefined) models.push(anthropicModelName(match[3], match[1], match[2]));
  }
  return sortedUnique(models);
}

const ignoredOpenAiSuffixTokens = new Set([
  "baselines", "benchmark", "card", "eval", "evals", "evaluation", "evaluations", "model-spec",
  "paper", "report", "reports", "release", "research", "safe", "completions", "spec", "system", "technical",
]);
const openAiExactModelRoutes = {
  "dall-e-2": ["DALL·E 2"], "dall-e-3": ["DALL·E 3"],
  "introducing-chatgpt-images-2-0": ["GPT Image 2"],
  "openai-o1-mini-advancing-cost-efficient-reasoning": ["o1-mini"], "openai-o3-mini": ["o3-mini"],
  "path-to-astra": ["GPT-6 Astra"], "safety-overview-gpt-6-astra": ["GPT-6 Astra"],
  "sora-2": ["Sora 2", "Sora 2 Pro"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

function openAiModels(url: URL): string[] {
  const pathMatch = url.pathname.match(/^\/(?:index|api\/docs\/models)\/([^/]+?)\/?$/u);
  if (pathMatch?.[1] === undefined) return [];
  const rawSlug = pathMatch[1].replace(/\.md$/u, "");
  const exactModels = openAiExactModelRoutes[rawSlug as keyof typeof openAiExactModelRoutes];
  if (exactModels !== undefined) return [...exactModels];
  const slug = rawSlug.replace(/^(?:announcing|introducing|previewing)-/u, "").replaceAll(".", "-");
  if (slug.split("-").some(token => ignoredOpenAiSuffixTokens.has(token))) return [];
  const combined = slug.match(/^o(\d+)-and-o(\d+)(?:-([a-z0-9-]+))?$/u);
  if (combined?.[1] !== undefined && combined[2] !== undefined) return sortedUnique([
    `o${combined[1]}`, `o${combined[2]}${combined[3] === undefined ? "" : `-${combined[3]}`}`,
  ]);
  const gpt = slug.match(/^gpt-(\d+[a-z]?)(?:-(\d+))?(?:-(.+))?$/u);
  if (gpt?.[1] !== undefined) {
    const suffix = gpt[3];
    if (suffix !== undefined && suffix.split("-").some(token => ignoredOpenAiSuffixTokens.has(token))) return [];
    const version = `${gpt[1]}${gpt[2] === undefined ? "" : `.${gpt[2]}`}`;
    const variants = new Set(["astra", "codex", "cyber", "instant", "luna", "max", "mini", "pro", "sol", "spark", "terra"]);
    const variantTokens = suffix?.split("-").filter(token => variants.has(token)) ?? [];
    if (suffix !== undefined && variantTokens.length === 0) return [];
    return [`GPT-${version}${variantTokens.length === 0 ? "" : ` ${variantTokens.map(titleToken).join(" ")}`}`];
  }
  if (/^o\d+(?:-[a-z0-9]+)*$/u.test(slug)) return [slug];
  if (/^codex(?=[a-z0-9-]*\d)(?:-[a-z0-9]+)+$/u.test(slug)) return [displaySlug(slug)];
  return [];
}

const metaFamilies = ["code", "glimmer", "image", "spark"] as const;
const metaFamilyPattern = metaFamilies.join("|");
function metaReleaseSlug(url: URL): string | null {
  const slug = url.pathname.replace(/^\//u, "").replace(/\/$/u, "");
  if (slug.startsWith("blog/")) return slug.slice(5);
  if (slug.startsWith("ai/models/")) return slug.slice(10);
  return slug.match(/^news\/\d{4}\/\d{2}\/(.+)$/u)?.[1] ?? null;
}
function metaModels(url: URL): string[] {
  const route = metaReleaseSlug(url);
  if (route === null) return [];
  const models: string[] = [];
  for (const match of route.matchAll(new RegExp(`(?:^|-)muse-(${metaFamilyPattern})(?:-(\\d+)(?:-(\\d+))?)?(?=-|$)`, "gu"))) {
    if (match[1] !== undefined) models.push(`Muse ${titleToken(match[1])}${match[2] === undefined ? "" : ` ${match[2]}${match[3] === undefined ? "" : `.${match[3]}`}`}`);
  }
  const llama = route.match(/(?:^|-)(?:meta-)?llama-(\d+)(?:-(\d+))?(?=-|$)/u);
  if (llama?.[1] !== undefined) models.push(`Meta Llama ${llama[1]}${llama[2] === undefined ? "" : `.${llama[2]}`}`);
  return sortedUnique(models);
}

function googleModels(url: URL): string[] {
  const path = url.pathname.toLowerCase();
  const slug = path.match(/^\/models\/model-cards\/([^/]+)\/?$/u)?.[1]
    ?? path.match(/^\/models\/(?:gemma|gemini|veo|imagen|lyria|genie)\/([^/]+)\/?$/u)?.[1];
  if (slug === undefined || !/\d/u.test(slug) || !/^(?:(?:gemini|gemma|paligemma|shieldgemma|veo|imagen|lyria|genie)(?:-|\d)|t5gemma(?:$|-|\d))/u.test(slug)) return [];
  return [displaySlug(slug).replace(/^Paligemma/u, "PaliGemma").replace(/^T5gemma/u, "T5Gemma")];
}

function xaiModels(url: URL): string[] {
  const slug = (url.hash.slice(1) || url.pathname.split("/").filter(Boolean).at(-1) || "").toLowerCase();
  if (/agent-tools|available-in-the-eu|prices?-dropped|retirement/u.test(slug)) return [];
  const match = slug.match(/(?:^|-)(grok-(?:\d+(?:-\d+)?|voice-think-fast-\d+(?:-\d+)?|build-\d+(?:-\d+)?))(?:-|$)/u);
  return match?.[1] === undefined ? [] : [displaySlug(match[1])];
}

const mistralPrefixes = ["codestral", "devstral", "leanstral", "magistral", "mathstral", "ministral", "mistral", "mixtral", "ocr", "pixtral", "robostral", "voxtral"] as const;
const mistralProducts = new Set(["mistral-chat", "mistral-code", "mistral-compute", "mistral-moderation"]);
function mistralModels(url: URL): string[] {
  const raw = url.pathname.match(/^\/news\/([^/]+)\/?$/u)?.[1];
  if (raw === undefined) return [];
  const slug = raw.replace(/^announcing-/u, "");
  if (
    mistralProducts.has(slug) || slug.startsWith("mistral-ai-") || slug === "about-mistral-ai"
    || /^mistral-(?:afp$|vibe-|x-)/u.test(slug)
  ) return [];
  if (!mistralPrefixes.some(item => slug === item || slug.startsWith(`${item}-`))) return [];
  return [displaySlug(slug).replace(/^Ocr/u, "OCR")];
}

function cohereModels(url: URL): string[] {
  const slug = url.pathname.match(/^\/changelog\/([^/]+)\/?$/u)?.[1];
  if (slug === undefined || /retir|deprecat|fine-tun|(?:^|-)ft(?:-|$)|whatsapp|bedrock|azure|oci|sagemaker|sdk|api-release/u.test(slug)) return [];
  return /^(?:aya|cohere-transcribe|command|commandr|embed|north-mini-code|rerank|transcribe)/u.test(slug) ? [displaySlug(slug)] : [];
}

function displayDeepSeekVersion(value: string): string {
  const tokens = value.toLowerCase().split("-");
  const family = tokens[0] === "coder" ? titleToken(tokens.shift() ?? "") : null;
  const version = tokens.shift()?.replace(/^([rv])/u, (_, prefix: string) => prefix.toUpperCase()) ?? "";
  const suffix = tokens.map(token => /^\d+$/u.test(token) ? token : titleToken(token)).join("-");
  return `DeepSeek ${family === null ? "" : `${family} `}${version}${suffix === "" ? "" : `-${suffix}`}`;
}

function deepSeekVersionModelsFromText(value: string): string[] {
  return [...new Set([...value.matchAll(/\bDeepSeek[-\s]+((?:Coder-)?(?:R|V)\d+(?:\.\d+)?(?:-(?:\d+|Chat|Coder|Exp|Flash|Lite|Pro|Preview|Speciale|Terminus|Vision))*)\b/giu)]
    .map(match => match[1])
    .filter((version): version is string => version !== undefined)
    .map(displayDeepSeekVersion))];
}

function deepSeekModelsFromText(value: string): string[] {
  const versions = deepSeekVersionModelsFromText(value);
  if (versions.length > 0) return sortedUnique(versions);
  const aliases = [...value.matchAll(/\bdeepseek[-\s]+(chat|coder|reasoner)\b/giu)]
    .map(match => match[1])
    .filter((alias): alias is string => alias !== undefined)
    .map(alias => `DeepSeek ${titleToken(alias.toLowerCase())}`);
  return sortedUnique(aliases);
}

function isDeepSeekUpdateModelSlug(slug: string): boolean {
  const identity = slug.match(/^deepseek-(.+)$/u)?.[1];
  if (identity === undefined || /^(?:api|app|cache|harness|platform|pricing)(?:-|$)/u.test(identity)) return false;
  return /^(?:chat|coder|reasoner)(?:-\d+)?$/u.test(identity) || /\d/u.test(identity);
}

function deepSeekModels(url: URL): string[] {
  if (url.host === "api-docs.deepseek.com" && /^\/updates\/?$/u.test(url.pathname)) {
    const slug = noteTitleSlug(url);
    return isDeepSeekUpdateModelSlug(slug) ? [unresolvedName(slug)] : [];
  }
  const raw = url.pathname.toLowerCase().match(/^\/en\/news\/([^/]+)\/?$/u)?.[1];
  if (raw === undefined) return [];
  const slug = raw.replace(/^deepseek-/u, "").replace(/-release$/u, "");
  return slug !== "app" && /^(?:r|v)\d/u.test(slug) ? [`DeepSeek ${displaySlug(slug)}`] : [];
}

function zaiModels(url: URL): string[] {
  const value = decodeURIComponent(url.hash.slice(1) || url.pathname.split("/").filter(Boolean).at(-1) || "").toLowerCase();
  const match = value.match(/(?:^|-)(glm-(?:[a-z]+-)?\d+[a-z]?(?:[.-]\d+[a-z]?)*(?:-[a-z0-9]+)*|glm-(?:ocr|image))(?:-|$)/u);
  return match?.[1] === undefined ? [] : [displayZaiModel(match[1])];
}

function displayZaiModel(value: string): string {
  const slug = value.toLowerCase().replace(/^glm-/u, "");
  const visionSlug = slug.match(/^(\d+)-(\d+)v$/u);
  if (visionSlug?.[1] !== undefined && visionSlug[2] !== undefined) {
    return `GLM-${visionSlug[1]}.${visionSlug[2]}V`;
  }
  const attachedSuffix = slug.match(/^(\d+(?:\.\d+)*)([a-z])$/u);
  if (attachedSuffix?.[1] !== undefined && attachedSuffix[2] !== undefined) {
    return `GLM-${attachedSuffix[1]}${attachedSuffix[2].toUpperCase()}`;
  }
  return displaySlug(value).replace(/^Glm/u, "GLM");
}

function kimiModels(url: URL): string[] {
  const slug = decodeURIComponent(url.hash.slice(1) || url.pathname.split("/").filter(Boolean).at(-1) || "").toLowerCase();
  if (/tool-calling|setup-agent/u.test(slug)) return [];
  const match = slug.match(/(?:^|-)(kimi-k\d+(?:[-.]\d+)?(?:-code)?)(?:-|$)/u);
  return match?.[1] === undefined ? [] : [displaySlug(match[1])];
}

function qwenModels(url: URL): string[] {
  const slug = decodeURIComponent(url.hash.slice(1) || url.pathname.split("/").filter(Boolean).at(-1) || "").toLowerCase();
  const model = slug.match(/(?:^|-)((?:qwen|qwq|qvq|wan)[a-z0-9]*(?:-[a-z0-9]+)*)/u)?.[1];
  if (model === undefined) return [];
  return [displaySlug(model.replace(/-general-availability$/u, ""))
    .replace(/^Qwen/u, "Qwen").replace(/^Qwq/u, "QwQ").replace(/^Qvq/u, "QvQ")];
}

function minimaxModels(url: URL): string[] {
  const slug = decodeURIComponent(url.hash.slice(1) || url.pathname.split("/").filter(Boolean).at(-1) || "").toLowerCase();
  const model = slug.match(/(?:^|-)((?:minimax-(?:m|h)\d+|music|speech|image|hailuo|t2v|i2v|h3|m\d)[a-z0-9]*(?:-[a-z0-9]+)*)/u)?.[1];
  return model === undefined ? [] : [displaySlug(model).replace(/^Minimax/u, "MiniMax")];
}

function bytedanceModels(url: URL): string[] {
  const slug = url.pathname.match(/^\/blog\/([^/]+)\/?$/u)?.[1];
  if (slug === undefined || !/(?:introducing|released|launch)/u.test(slug)) return [];
  const model = slug.match(/(?:^|-)(seed(?:ance|ream|realtime|3d)?(?:-?\d+(?:-\d+)*)?(?:-[a-z]+)*)/u)?.[1];
  return model === undefined ? [] : [displaySlug(model)];
}

function microsoftModels(url: URL): string[] {
  const slug = url.pathname.match(/^\/models\/(mai-[^/]+)\/?$/u)?.[1];
  return slug === undefined ? [] : [displaySlug(slug).replace(/^Mai/u, "MAI")];
}

function nvidiaModels(url: URL): string[] {
  const slug = url.pathname.split("/").filter(Boolean).at(-1)?.toLowerCase() ?? "";
  if (/benchmark|agents|open-stack|palantir/u.test(slug)) return [];
  const model = slug.match(/(?:^|-)(nemotron(?:-\d+(?:-\d+)?)?(?:-[a-z0-9]+)*)(?:-|$)/u)?.[1];
  return model === undefined ? [] : [`NVIDIA ${displaySlug(model)}`];
}

function amazonModels(url: URL): string[] {
  const slug = url.pathname.split("/").filter(Boolean).at(-1)?.toLowerCase() ?? "";
  if (!/amazon-nova/u.test(slug) || /weekly-review|weekly-roundup|customization|forge|grounding|ide-extension/u.test(slug)) return [];
  const model = slug.match(/amazon-nova-(2-(?:lite|sonic)|premier|sonic|reel-\d+-\d+)/u)?.[1];
  return model === undefined ? [] : [`Amazon Nova ${displaySlug(model)}`];
}

function baiduModels(url: URL): string[] {
  const slug = url.pathname.match(/^\/blog\/posts\/(ernie[^/]+)\/?$/u)?.[1];
  return slug !== undefined && /\d/u.test(slug) ? [displaySlug(slug).replace(/^Ernie/u, "ERNIE")] : [];
}

function tencentModels(url: URL): string[] {
  const slug = url.pathname.replace(/^\//u, "").replace(/\/$/u, "");
  if (slug.startsWith("zh-cn/") || slug.startsWith("zh-hk/")) return [];
  const hy = slug.match(/(?:^|-)(tencent-hy\d+(?:-[a-z0-9]+)*)(?:-|$)/u)?.[1];
  if (hy !== undefined) return [displaySlug(hy).replace(/^Tencent Hy/u, "Tencent HY")];
  return /hunyuan.*(?:model|release|unveil)|(?:release|unveil).*hunyuan/u.test(slug) ? ["Tencent Hunyuan"] : [];
}

function xiaomiModels(url: URL): string[] {
  const slug = url.pathname.match(/^\/docs\/en-US\/news\/(?:latest|previous-news)\/(v[^/]+)-release\/?$/u)?.[1];
  return slug === undefined ? [] : [`MiMo ${displaySlug(slug).replace(/^V(?=\d)/u, "v")}`];
}

function namedModelsForProviderText(providerId: FirstPartyReleaseProviderId, value: string): readonly string[] {
  const text = value.replace(/[–—]/gu, "-").trim();
  if (providerId === "openai") return sortedUnique([...text.matchAll(/\bGPT-\d+(?:\.\d+)?(?:\s+(?:Astra|Cyber|Instant|Luna|Max|Mini|Pro|Sol|Spark|Terra))?/gu)].map(match => match[0] ?? "").filter(Boolean));
  if (providerId === "meta") return text.match(/\bMuse\s+(?:Code|Glimmer|Image|Spark)(?:\s+\d+(?:\.\d+)?)?/u)?.[0] === undefined ? [] : [text.match(/\bMuse\s+(?:Code|Glimmer|Image|Spark)(?:\s+\d+(?:\.\d+)?)?/u)?.[0] ?? ""];
  if (providerId === "xai") {
    const model = text.match(/\bGrok\s+(?:\d+(?:\.\d+)?|Voice Think Fast\s+\d+(?:\.\d+)?|Build\s+\d+(?:\.\d+)?)/iu)?.[0];
    return model === undefined || /available in the EU/iu.test(text) ? [] : [model.replace(/^grok/iu, "Grok")];
  }
  if (providerId === "z_ai") {
    const model = text.match(/\bGLM-(?:[A-Z]+-)?(?:\d+[A-Z]?(?:\.\d+[A-Z]?)*(?:-[A-Za-z0-9]+)*|OCR|Image)\b/iu)?.[0];
    return model === undefined ? [] : [displayZaiModel(model)];
  }
  if (providerId === "alibaba_cloud") return sortedUnique(text.split(/\s*,\s*/u).filter(item => /^(?:qwen|qwq|qvq|wan)/iu.test(item)).map(item => item.trim()));
  if (providerId === "minimax") return [text];
  if (providerId === "nvidia") {
    const model = text.match(/\b(?:NVIDIA\s+)?Nemotron\s+\d+(?:\.\d+)?(?:\s+(?:Lightning|Nano|Super|Ultra|VL))?/u)?.[0];
    return model === undefined ? [] : [model.startsWith("NVIDIA") ? model : `NVIDIA ${model}`];
  }
  if (providerId === "amazon") {
    const model = text.match(/\bAmazon Nova\s+(?:2\s+(?:Lite|Sonic)|Premier|Sonic|Reel\s+\d+(?:\.\d+)?)/iu)?.[0];
    return model === undefined ? [] : [model.replace(/^amazon nova/iu, "Amazon Nova")];
  }
  return [];
}

const providerModelExtractors = {
  alibaba_cloud: qwenModels, amazon: amazonModels, anthropic: anthropicModels, baidu: baiduModels,
  bytedance: bytedanceModels, cohere: cohereModels, deepseek: deepSeekModels, google: googleModels,
  meta: metaModels, microsoft: microsoftModels, minimax: minimaxModels, mistral: mistralModels,
  moonshot_ai: kimiModels, nvidia: nvidiaModels, openai: openAiModels, tencent: tencentModels,
  xai: xaiModels, xiaomi: xiaomiModels, z_ai: zaiModels,
} satisfies Readonly<Record<FirstPartyReleaseProviderId, (url: URL) => string[]>>;

export function namedModelsForProviderUrl(providerId: FirstPartyReleaseProviderId, canonicalUrl: string): readonly string[] {
  return providerModelExtractors[providerId](new URL(canonicalUrl));
}

function unresolvedAnnouncementName(providerId: FirstPartyReleaseProviderId, canonicalUrl: string): string | null {
  const url = new URL(canonicalUrl);
  const slug = decodeURIComponent(url.hash.slice(1) || url.pathname.split("/").filter(Boolean).at(-1) || "").toLowerCase();
  if (providerId === "anthropic") return /^claude-/u.test(slug.replace(/^introducing-/u, "")) && /\d/u.test(slug) ? unresolvedName(slug) : null;
  if (providerId === "openai") {
    if (/^(?:how|researching|testing|using|why)-/u.test(slug)) return null;
    const releaseSlug = slug.replace(/^(?:announcing|introducing|previewing)-/u, "");
    if (releaseSlug.split("-").some(token => ignoredOpenAiSuffixTokens.has(token))) return null;
    return /^\w[\w.-]*\d[\w.-]*$/u.test(releaseSlug) ? unresolvedName(slug) : null;
  }
  if (providerId === "meta") {
    const route = metaReleaseSlug(url);
    return route !== null && /(?:muse|llama)-/u.test(route) && /\d/u.test(route) ? unresolvedName(route) : null;
  }
  return null;
}

const releaseSignalPattern = /(?:^|-)(?:announce|announced|announcement|announces|announcing|introduce|introduced|introduces|introducing|launch|launched|launches|release|released|releases|unveil|unveiled|unveils)(?:-|$)/u;
const nonReleaseSignalPattern = /(?:api-release|benchmark|deprecat|fine-tun|models-release-notes|on-azure|release-notes|retir|sdk|whatsapp|weekly-review|weekly-roundup|(?:^|-)ft(?:-|$))/u;

function noteTitleSlug(url: URL): string {
  return decodeURIComponent(url.hash.slice(1) || url.pathname.split("/").filter(Boolean).at(-1) || "")
    .toLowerCase()
    .replace(/^\d{4}-\d{2}-\d{2}-/u, "")
    .replace(/^(?:january|february|march|april|may|june|july|august|september|october|november|december)-\d{1,2}-\d{4}-/u, "");
}

function unresolvedAnnouncementNameForSource(
  sourceId: FirstPartyReleaseSourceId,
  canonicalUrl: string,
): string | null {
  const url = new URL(canonicalUrl);
  const slug = noteTitleSlug(url);
  const hasVersion = /\d/u.test(slug);
  switch (sourceId) {
    case "anthropic-sitemap":
    case "openai-release-sitemap":
    case "openai-safety-sitemap":
    case "meta-research-sitemap":
    case "meta-newsroom-index":
      return unresolvedAnnouncementName(sourceDefinitionForId(sourceId).providerId, canonicalUrl);
    case "openai-model-catalog":
      return /^\/api\/docs\/models\/[^/]+\/?$/u.test(url.pathname) && hasVersion
        ? unresolvedName(slug)
        : null;
    case "google-deepmind-sitemap": {
      const modelSlug = url.pathname.match(/^\/models\/model-cards\/([^/]+)\/?$/u)?.[1]
        ?? url.pathname.match(/^\/models\/[^/]+\/([^/]+)\/?$/u)?.[1];
      return modelSlug !== undefined && /\d/u.test(modelSlug) ? unresolvedName(modelSlug) : null;
    }
    case "xai-release-notes":
      return hasVersion && !/agent-tools|available-in-the-eu|prices?-dropped|retirement/u.test(slug) ? unresolvedName(slug) : null;
    case "mistral-site-sitemap": {
      const newsSlug = url.pathname.match(/^\/news\/([^/]+)\/?$/u)?.[1];
      return newsSlug !== undefined && /\d/u.test(newsSlug)
        && /^(?:announcing|introducing)-/u.test(newsSlug)
        ? unresolvedName(newsSlug)
        : null;
    }
    case "cohere-docs-sitemap": {
      const changelogSlug = url.pathname.match(/^\/changelog\/([^/]+)\/?$/u)?.[1];
      return changelogSlug !== undefined && /\d/u.test(changelogSlug)
        && !nonReleaseSignalPattern.test(changelogSlug)
        ? unresolvedName(changelogSlug)
        : null;
    }
    case "deepseek-site-sitemap": {
      const newsSlug = url.pathname.toLowerCase().match(/^\/en\/news\/([^/]+)\/?$/u)?.[1];
      return newsSlug !== undefined && newsSlug !== "app" && /\d/u.test(newsSlug)
        ? unresolvedName(newsSlug)
        : null;
    }
    case "deepseek-api-sitemap":
      return /^\/updates\/?$/u.test(url.pathname) && isDeepSeekUpdateModelSlug(slug)
        ? unresolvedName(slug)
        : null;
    case "zai-release-notes":
    case "minimax-model-releases":
      return hasVersion && slug.length > 0 ? unresolvedName(slug) : null;
    case "qwen-model-releases":
      return hasVersion && /(?:^|-)(?:alibaba|tongyi)(?:-|$)/u.test(slug)
        ? unresolvedName(slug)
        : null;
    case "kimi-docs-sitemap": {
      const guideSlug = url.pathname.match(/^\/docs\/guide\/([^/]+)\/?$/u)?.[1];
      return guideSlug !== undefined && /\d/u.test(guideSlug)
        && /(?:quickstart|release)/u.test(guideSlug)
        ? unresolvedName(guideSlug)
        : null;
    }
    case "bytedance-seed-sitemap": {
      const blogSlug = url.pathname.match(/^\/blog\/([^/]+)\/?$/u)?.[1];
      return blogSlug !== undefined && /\d/u.test(blogSlug) && releaseSignalPattern.test(blogSlug)
        ? unresolvedName(blogSlug)
        : null;
    }
    case "microsoft-model-sitemap": {
      const modelSlug = url.pathname.match(/^\/models\/([^/]+)\/?$/u)?.[1];
      return modelSlug !== undefined && /\d/u.test(modelSlug) ? unresolvedName(modelSlug) : null;
    }
    case "nvidia-nemotron-rss":
    case "amazon-nova-rss":
      return hasVersion && releaseSignalPattern.test(slug) && !nonReleaseSignalPattern.test(slug)
        ? unresolvedName(slug)
        : null;
    case "baidu-ernie-sitemap": {
      const postSlug = url.pathname.match(/^\/blog\/posts\/([^/]+)\/?$/u)?.[1];
      return postSlug !== undefined && /\d/u.test(postSlug) && releaseSignalPattern.test(postSlug)
        ? unresolvedName(postSlug)
        : null;
    }
    case "tencent-post-sitemaps": {
      const route = url.pathname.replace(/^\//u, "").replace(/\/$/u, "");
      return !/^(?:zh-cn|zh-hk)\//u.test(route) && hasVersion
        && releaseSignalPattern.test(slug)
        && /(?:^|-)(?:ai|foundation-model|llm|model|multimodal)(?:-|$)/u.test(slug)
        ? unresolvedName(slug)
        : null;
    }
    case "xiaomi-mimo-sitemap": {
      const releaseSlug = url.pathname.match(/^\/docs\/en-US\/news\/(?:latest|previous-news)\/([^/]+)-release\/?$/u)?.[1];
      return releaseSlug !== undefined && /\d/u.test(releaseSlug) ? unresolvedName(releaseSlug) : null;
    }
  }
}

export function releaseCandidateNamesForProviderUrl(providerId: FirstPartyReleaseProviderId, canonicalUrl: string): readonly string[] {
  const parsed = namedModelsForProviderUrl(providerId, canonicalUrl);
  if (parsed.length > 0) return parsed;
  const unresolved = unresolvedAnnouncementName(providerId, canonicalUrl);
  if (unresolved !== null) return [unresolved];
  for (const definition of FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS) {
    if (definition.providerId !== providerId) continue;
    const sourceUnresolved = unresolvedAnnouncementNameForSource(definition.id, canonicalUrl);
    if (sourceUnresolved !== null) return [sourceUnresolved];
  }
  return [];
}

export function releaseCandidateNamesForSourceUrl(sourceId: FirstPartyReleaseSourceId, canonicalUrl: string): readonly string[] {
  const definition = sourceDefinitionForId(sourceId);
  const parsed = namedModelsForProviderUrl(definition.providerId, canonicalUrl);
  if (parsed.length > 0) return parsed;
  const providerUnresolved = unresolvedAnnouncementName(definition.providerId, canonicalUrl);
  if (providerUnresolved !== null) return [providerUnresolved];
  const sourceUnresolved = unresolvedAnnouncementNameForSource(sourceId, canonicalUrl);
  return sourceUnresolved === null ? [] : [sourceUnresolved];
}

export function observeFirstPartyReleaseSource(definition: FirstPartyReleaseSourceDefinition, fetched: FetchedSitemap, retrievedAt: string): Result<FirstPartyReleaseSourceObservation, Error> {
  const retrievedTime = Date.parse(retrievedAt);
  if (!Number.isFinite(retrievedTime)) return err(new Error(`Invalid retrieval timestamp ${retrievedAt}.`));
  const parsed = parseProviderSitemap(definition, fetched.text);
  if (!parsed.ok) return parsed;
  const candidates: Array<FirstPartyReleaseSourceObservation["candidates"][number]> = [];
  for (const entry of parsed.value.entries) {
    const urlCandidateNames = releaseCandidateNamesForSourceUrl(definition.id, entry.url);
    const namedModels = urlCandidateNames.length === 0
      ? []
      : entry.namedModels !== undefined && entry.namedModels.length > 0
        ? sortedUnique(entry.namedModels)
        : urlCandidateNames;
    if (namedModels.length === 0) continue;
    const sourceModifiedAt = definition.datePolicy === "ignore" ? null : entry.lastModifiedAt;
    if (definition.datePolicy === "candidates" && sourceModifiedAt === null) return err(new Error(`${definition.id} contains a release candidate without a machine-readable date.`));
    candidates.push({
      candidateDateMeaning: sourceModifiedAt === null ? "first-observed" : entry.candidateDateMeaning ?? "provider-sitemap-lastmod",
      canonicalUrl: entry.url, namedModels, sourceModifiedAt,
    });
  }
  if (candidates.length < definition.minimumCandidateCount) return err(new Error(`${definition.id} yielded ${candidates.length} model-release candidates; expected at least ${definition.minimumCandidateCount}.`));
  if (candidates.some(candidate => candidate.sourceModifiedAt !== null && Date.parse(candidate.sourceModifiedAt) > retrievedTime + 86_400_000)) return err(new Error(`${definition.id} contains a candidate date more than 24 hours in the future.`));
  return ok({
    candidates,
    entries: parsed.value.entries,
    source: {
      health: {
        contentType: fetched.contentType, httpStatus: fetched.httpStatus,
        shape: {
          byteLength: fetched.byteLength, candidateCount: candidates.length,
          canonicalHostEntryCount: parsed.value.entryCount, datedEntryCount: parsed.value.datedEntryCount,
          duplicateEntryCount: parsed.value.duplicateEntryCount, entryCount: parsed.value.entryCount,
          rootElement: sourceRootElement(definition), uniqueEntryCount: parsed.value.entries.length,
        },
        status: "healthy",
      },
      id: definition.id, providerId: definition.providerId, providerName: definition.providerName,
      retrievedAt: new Date(retrievedTime).toISOString(), url: definition.url,
    },
  });
}

function candidateChanged(previous: FirstPartyReleaseCandidate, next: Pick<FirstPartyReleaseCandidate, "candidateDateMeaning" | "namedModels" | "sourceId" | "sourceModifiedAt" | "sourcePresence">): boolean {
  return previous.candidateDateMeaning !== next.candidateDateMeaning || previous.sourceId !== next.sourceId
    || previous.sourceModifiedAt !== next.sourceModifiedAt || previous.sourcePresence !== next.sourcePresence
    || previous.namedModels.length !== next.namedModels.length
    || previous.namedModels.some((model, index) => model !== next.namedModels[index]);
}

export function emptyFirstPartyReleaseRadar(): FirstPartyReleaseRadar {
  return {
    candidates: [], policy: { durableCandidates: true, publication: FIRST_PARTY_RELEASE_PUBLICATION_POLICY, review: FIRST_PARTY_RELEASE_REVIEW_POLICY },
    schemaVersion: 2, sources: [],
  };
}

type DeriveOptions = Readonly<{ retainedSourceIds?: ReadonlySet<FirstPartyReleaseSourceId> }>;

export function deriveFirstPartyReleaseRadar(
  observations: readonly FirstPartyReleaseSourceObservation[], previous: FirstPartyReleaseRadar,
  observedAt: string, options: DeriveOptions = {},
): FirstPartyReleaseRadar {
  const observedTime = Date.parse(observedAt);
  if (!Number.isFinite(observedTime)) throw new Error(`Invalid observation timestamp ${observedAt}.`);
  const normalizedObservedAt = new Date(observedTime).toISOString();
  const retainedSourceIds = options.retainedSourceIds ?? new Set<FirstPartyReleaseSourceId>();
  const previousByUrl = new Map(previous.candidates.map(candidate => [candidate.canonicalUrl, candidate]));
  const currentCandidateUrls = new Set<string>();
  const currentEntries = new Map(observations.flatMap(observation => observation.entries.map(entry => [`${observation.source.id}\0${entry.url}`, entry] as const)));
  const ownerByUrl = new Map<string, FirstPartyReleaseSourceId>();
  const candidates: FirstPartyReleaseCandidate[] = [];
  for (const observation of observations) {
    for (const current of observation.candidates) {
      const owner = ownerByUrl.get(current.canonicalUrl);
      if (owner !== undefined && owner !== observation.source.id) throw new Error(`First-party sources ${owner} and ${observation.source.id} overlap candidate ${current.canonicalUrl}.`);
      ownerByUrl.set(current.canonicalUrl, observation.source.id);
      currentCandidateUrls.add(current.canonicalUrl);
      const existing = previousByUrl.get(current.canonicalUrl);
      if (existing !== undefined && existing.sourceId !== observation.source.id) throw new Error(`First-party candidate ${current.canonicalUrl} changed source ownership.`);
      const sourceModifiedAt = existing?.sourceModifiedAt
        ?? current.sourceModifiedAt
        ?? normalizedObservedAt;
      const candidateDateMeaning = existing?.candidateDateMeaning
        ?? (current.sourceModifiedAt === null ? "first-observed" as const : current.candidateDateMeaning);
      const firstSeenAt = existing?.firstSeenAt ?? normalizedObservedAt;
      const common = {
        candidateDate: (candidateDateMeaning === "first-observed" ? firstSeenAt : sourceModifiedAt).slice(0, 10),
        candidateDateMeaning, canonicalUrl: current.canonicalUrl,
        id: candidateIdFor(observation.source.providerId, current.canonicalUrl),
        namedModels: sortedUnique(current.namedModels), providerId: observation.source.providerId,
        providerName: observation.source.providerName, sourceId: observation.source.id,
        sourceModifiedAt, sourcePresence: "present" as const,
      };
      candidates.push({ ...common, firstSeenAt, lastChangedAt: existing === undefined || candidateChanged(existing, common) ? normalizedObservedAt : existing.lastChangedAt, status: existing?.status ?? "needs-review" });
    }
  }
  for (const prior of previous.candidates) {
    if (currentCandidateUrls.has(prior.canonicalUrl)) continue;
    if (retainedSourceIds.has(prior.sourceId)) { candidates.push(prior); continue; }
    const currentEntry = currentEntries.get(`${prior.sourceId}\0${prior.canonicalUrl}`);
    const retained = currentEntry === undefined
      ? { ...prior, sourcePresence: "missing" as const }
      : { ...prior, sourcePresence: "present" as const };
    candidates.push({ ...retained, lastChangedAt: candidateChanged(prior, retained) ? normalizedObservedAt : prior.lastChangedAt });
  }
  const currentSources = new Map(observations.map(observation => [observation.source.id, observation.source]));
  const priorSources = new Map(previous.sources.map(source => [source.id, source]));
  const sources = FIRST_PARTY_RELEASE_SOURCE_DEFINITIONS.flatMap(definition => {
    const current = currentSources.get(definition.id);
    if (current !== undefined) return [current];
    const prior = retainedSourceIds.has(definition.id) ? priorSources.get(definition.id) : undefined;
    return prior === undefined ? [] : [prior];
  });
  return {
    candidates: candidates.sort(compareCandidates),
    policy: { durableCandidates: true, publication: FIRST_PARTY_RELEASE_PUBLICATION_POLICY, review: FIRST_PARTY_RELEASE_REVIEW_POLICY },
    schemaVersion: 2, sources,
  };
}

export function parseFirstPartyReleaseRadar(value: unknown): Result<FirstPartyReleaseRadar, z.ZodError> {
  return parseResult(firstPartyReleaseRadarSchema, value);
}

export function parsePreviousFirstPartyReleaseRadar(value: unknown): Result<FirstPartyReleaseRadar, z.ZodError> {
  const current = parseFirstPartyReleaseRadar(value);
  return current.ok ? current : parseResult(previousFirstPartyReleaseRadarSchema, value);
}

export function validateFirstPartyReleaseReplacement(previous: FirstPartyReleaseRadar, candidate: FirstPartyReleaseRadar): Result<void, Error> {
  const candidateUrls = new Set(candidate.candidates.map(item => item.canonicalUrl));
  const dropped = previous.candidates.filter(item => !candidateUrls.has(item.canonicalUrl));
  if (dropped.length > 0) return err(new Error(`First-party refresh dropped ${dropped.length} durable candidate URLs.`));
  for (const prior of previous.candidates) {
    const next = candidate.candidates.find(item => item.canonicalUrl === prior.canonicalUrl);
    if (next?.id !== prior.id) return err(new Error(`First-party refresh changed candidate identity for ${prior.canonicalUrl}.`));
    if (next?.sourceId !== prior.sourceId) return err(new Error(`First-party refresh changed source ownership for ${prior.canonicalUrl}.`));
    if (next?.status !== prior.status) return err(new Error(`First-party refresh changed manual review status for ${prior.canonicalUrl}.`));
    if (next?.firstSeenAt !== prior.firstSeenAt) return err(new Error(`First-party refresh changed first-seen evidence for ${prior.canonicalUrl}.`));
    if (next?.sourceModifiedAt !== prior.sourceModifiedAt) return err(new Error(`First-party refresh changed original source-modified evidence for ${prior.canonicalUrl}.`));
    if (next?.candidateDateMeaning !== prior.candidateDateMeaning) return err(new Error(`First-party refresh changed candidate-date semantics for ${prior.canonicalUrl}.`));
    if (next?.candidateDate !== prior.candidateDate) return err(new Error(`First-party refresh changed candidate date for ${prior.canonicalUrl}.`));
  }
  return ok(undefined);
}
