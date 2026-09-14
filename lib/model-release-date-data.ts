import modelReleaseDateData from "@/data/model-release-dates.json";

import {
  MODEL_CARD_CATALOG,
  canonicalModelIdSchema,
} from "./model-card-data";
import {
  ISO_CALENDAR_DATE_PATTERN,
  isIsoCalendarDate,
} from "./iso-calendar-date";
import type { Result } from "./result";
import { parseResult, z } from "./schema";

const exactNonBlankStringSchema = z.string().min(1).refine(
  value => value === value.trim(),
  "Must not have leading or trailing whitespace.",
);

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export const modelReleaseDateOnlySchema = z.string()
  .regex(ISO_CALENDAR_DATE_PATTERN, "Expected an ISO 8601 calendar date (YYYY-MM-DD).")
  .refine(isIsoCalendarDate, "Expected a real calendar date.");

const modelReleaseSourceSchema = z.object({
  title: exactNonBlankStringSchema,
  url: z.string().url().refine(
    value => parseUrl(value)?.protocol === "https:",
    "Official release evidence must use HTTPS.",
  ),
}).strict().readonly();

const modelReleaseBaseShape = {
  canonicalModelId: canonicalModelIdSchema,
} as const;

export const verifiedModelReleaseDateSchema = z.object({
  ...modelReleaseBaseShape,
  appliesTo: z.object({
    kind: z.literal("base-model"),
    model: exactNonBlankStringSchema,
  }).strict().readonly().optional(),
  basis: z.enum(["announcement", "model-index", "release-notes"]),
  releasedOn: modelReleaseDateOnlySchema,
  sources: z.array(modelReleaseSourceSchema).min(1).max(3).readonly(),
  stage: z.enum(["general-availability", "public-preview", "public-release"]),
  status: z.literal("verified"),
  verifiedOn: modelReleaseDateOnlySchema,
}).strict().readonly();

export const pendingModelReleaseDateSchema = z.object({
  ...modelReleaseBaseShape,
  reason: exactNonBlankStringSchema,
  researchedOn: modelReleaseDateOnlySchema,
  status: z.literal("pending"),
}).strict().readonly();

type OfficialSourcePolicy = Readonly<{
  canonicalCreator: string;
  domains: readonly string[];
}>;

/** First-party evidence ownership follows the checked provider, not a free-form ID prefix. */
const officialSourcePolicies: Readonly<Record<string, OfficialSourcePolicy>> = {
  alibaba_cloud: { canonicalCreator: "alibaba", domains: ["alibabacloud.com"] },
  anthropic: { canonicalCreator: "anthropic", domains: ["anthropic.com"] },
  cognition: { canonicalCreator: "cognition", domains: ["cognition.com"] },
  cursor: { canonicalCreator: "cursor", domains: ["cursor.com"] },
  deepseek: { canonicalCreator: "deepseek", domains: ["deepseek.com"] },
  google: { canonicalCreator: "google", domains: ["blog.google", "ai.google.dev"] },
  meta: { canonicalCreator: "meta", domains: ["meta.ai"] },
  moonshot_ai: { canonicalCreator: "moonshotai", domains: ["kimi.com"] },
  openai: { canonicalCreator: "openai", domains: ["openai.com"] },
  xai: { canonicalCreator: "spacexai", domains: ["x.ai"] },
  z_ai: { canonicalCreator: "zai", domains: ["z.ai"] },
};

const catalogByCanonicalId = new Map(
  MODEL_CARD_CATALOG.map(entry => [entry.canonicalModelId, entry]),
);

function hostnameMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export const modelReleaseDateEntrySchema = z.discriminatedUnion("status", [
  verifiedModelReleaseDateSchema,
  pendingModelReleaseDateSchema,
]);

export const modelReleaseDatesSchema = z.array(modelReleaseDateEntrySchema)
  .min(1)
  .superRefine((entries, context) => {
    const canonicalIds = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      if (canonicalIds.has(entry.canonicalModelId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate release record for ${entry.canonicalModelId}.`,
          path: [index, "canonicalModelId"],
        });
      }
      canonicalIds.add(entry.canonicalModelId);

      const previous = entries[index - 1];
      if (
        previous !== undefined
        && compareText(previous.canonicalModelId, entry.canonicalModelId) >= 0
      ) {
        context.addIssue({
          code: "custom",
          message: "Release records must be sorted by canonicalModelId.",
          path: [index, "canonicalModelId"],
        });
      }

      const catalogEntry = catalogByCanonicalId.get(entry.canonicalModelId);
      if (catalogEntry === undefined) {
        context.addIssue({
          code: "custom",
          message: `No checked model-card identity exists for ${entry.canonicalModelId}.`,
          path: [index, "canonicalModelId"],
        });
        continue;
      }
      const sourcePolicy = officialSourcePolicies[catalogEntry.providerId];
      if (sourcePolicy === undefined) {
        context.addIssue({
          code: "custom",
          message: `No first-party source policy exists for provider ${catalogEntry.providerId}.`,
          path: [index, "canonicalModelId"],
        });
        continue;
      }
      const creator = entry.canonicalModelId.split("/", 1)[0] ?? "";
      if (creator !== sourcePolicy.canonicalCreator) {
        context.addIssue({
          code: "custom",
          message: `Canonical creator ${creator} does not belong to provider ${catalogEntry.providerId}.`,
          path: [index, "canonicalModelId"],
        });
      }
      if (entry.status === "pending") continue;
      if (entry.releasedOn > entry.verifiedOn) {
        context.addIssue({
          code: "custom",
          message: "Release date cannot be later than its verification date.",
          path: [index, "releasedOn"],
        });
      }
      const sourceUrls = new Set<string>();
      for (const [sourceIndex, source] of entry.sources.entries()) {
        if (sourceUrls.has(source.url)) {
          context.addIssue({
            code: "custom",
            message: "Release evidence URLs must be unique within a record.",
            path: [index, "sources", sourceIndex, "url"],
          });
        }
        sourceUrls.add(source.url);
        const sourceUrl = parseUrl(source.url);
        if (sourceUrl === null) continue;
        const hostname = sourceUrl.hostname.toLocaleLowerCase("en-US");
        if (!sourcePolicy.domains.some(domain => hostnameMatches(hostname, domain))) {
          context.addIssue({
            code: "custom",
            message: `Expected a provider-owned ${catalogEntry.providerId} release source.`,
            path: [index, "sources", sourceIndex, "url"],
          });
        }
      }
    }
  })
  .readonly();

export type VerifiedModelReleaseDate = z.infer<typeof verifiedModelReleaseDateSchema>;
export type PendingModelReleaseDate = z.infer<typeof pendingModelReleaseDateSchema>;
export type ModelReleaseDateEntry = z.infer<typeof modelReleaseDateEntrySchema>;
export type ModelReleaseDates = z.infer<typeof modelReleaseDatesSchema>;

export function parseModelReleaseDates(
  value: unknown,
): Result<ModelReleaseDates, z.ZodError> {
  return parseResult(modelReleaseDatesSchema, value);
}

const checkedReleaseDatesInput: unknown = modelReleaseDateData;
const checkedReleaseDatesResult = parseModelReleaseDates(checkedReleaseDatesInput);
if (!checkedReleaseDatesResult.ok) {
  throw new Error(
    `Checked official model release dates are invalid: ${checkedReleaseDatesResult.error.message}`,
    { cause: checkedReleaseDatesResult.error },
  );
}

export const MODEL_RELEASE_DATES = checkedReleaseDatesResult.value;

const catalogIds = new Set(MODEL_CARD_CATALOG.map(entry => entry.canonicalModelId));
const releaseIds = new Set(MODEL_RELEASE_DATES.map(entry => entry.canonicalModelId));
const missingReleaseIds = [...catalogIds].filter(id => !releaseIds.has(id)).sort(compareText);
const orphanedReleaseIds = [...releaseIds].filter(id => !catalogIds.has(id)).sort(compareText);
if (missingReleaseIds.length > 0 || orphanedReleaseIds.length > 0) {
  throw new Error(
    "Official model release-date coverage must exactly match the checked model-card catalog. "
    + `Missing: ${missingReleaseIds.join(", ") || "none"}. `
    + `Orphaned: ${orphanedReleaseIds.join(", ") || "none"}.`,
  );
}

export const MODEL_RELEASE_DATE_BY_CANONICAL_ID: ReadonlyMap<
  string,
  ModelReleaseDateEntry
> = new Map(MODEL_RELEASE_DATES.map(entry => [entry.canonicalModelId, entry]));

export function modelReleaseDateForCanonicalId(
  canonicalModelId: string,
): ModelReleaseDateEntry | undefined {
  return MODEL_RELEASE_DATE_BY_CANONICAL_ID.get(canonicalModelId);
}
