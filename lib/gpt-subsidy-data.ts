import type { Result } from "./result";
import { parseResult, z } from "./schema";
import { GPT_SUBSIDY_SUB_ONE_PERCENT_COVERAGE_SENTINEL } from "./gpt-subsidy-attribution-manifest";

export { GPT_SUBSIDY_SUB_ONE_PERCENT_COVERAGE_SENTINEL } from "./gpt-subsidy-attribution-manifest";

export const GPT_SUBSIDY_TITLE =
  "Subsidy for ChatGPT Pro 20x subscription" as const;

export const GPT_SUBSIDY_DESCRIPTION =
  "Daily history of the measured API-retail-equivalent value of seven complete UTC days from all available local Codex logs on one machine. Account-aware plan comparisons appear only when sampled, provider-reported Pro plan status supports a lower-bound account count.";

export const GPT_SUBSIDY_PAGE_CONTENT_MODIFIED_AT =
  "2026-09-04T16:00:00.000Z" as const;

export const GPT_SUBSIDY_ATTRIBUTION_MANIFEST_URL =
  "https://github.com/hraness/aicharts/blob/main/data/gpt-subsidy-attribution-measurement.json" as const;

const UTC_DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

const isoDateTimeSchema = z.string().datetime({ offset: true });
const finiteNonnegativeSchema = z.number().finite().nonnegative();
const tokenCountSchema = z.number().int().nonnegative().refine(
  Number.isSafeInteger,
  "Token count must remain exactly representable in JSON",
);
const tokenUsageSchema = z.object({
  uncachedInput: tokenCountSchema,
  cachedInput: tokenCountSchema,
  output: tokenCountSchema,
  total: tokenCountSchema,
}).strict();

const unavailableAccountAttributionSchema = z.object({
  status: z.literal("unavailable"),
  distinctObservedAccounts: z.null(),
  coverage: z.literal(0),
}).strict();

const partialAccountAttributionSchema = z.object({
  status: z.literal("partial"),
  distinctObservedAccounts: z.number().int().positive(),
  coverage: z.union([
    z.literal(GPT_SUBSIDY_SUB_ONE_PERCENT_COVERAGE_SENTINEL),
    z.number().finite().min(0.01).max(0.99).refine(
      value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
      "Sampled coverage must be a whole-percentage lower bound",
    ),
  ]),
}).strict();

const accountAttributionSchema = z.discriminatedUnion("status", [
  unavailableAccountAttributionSchema,
  partialAccountAttributionSchema,
]);

const unavailableObservedProPlanComparisonSchema = z.object({
  status: z.literal("unavailable"),
  distinctVerifiedProAccountsLowerBound: z.null(),
  normalizedPlanValueUsd: z.null(),
  apiEquivalentMultipleUpperBound: z.null(),
}).strict();

const sampledObservedProPlanComparisonSchema = z.object({
  status: z.literal("sampled"),
  distinctVerifiedProAccountsLowerBound: z.number().int().positive(),
  normalizedPlanValueUsd: z.number().finite().positive(),
  apiEquivalentMultipleUpperBound: finiteNonnegativeSchema,
}).strict();

const observedProPlanComparisonSchema = z.discriminatedUnion("status", [
  unavailableObservedProPlanComparisonSchema,
  sampledObservedProPlanComparisonSchema,
]);

const attributionMeasurementSchema = z.object({
  name: z.literal("AI Charts GPT subsidy account-attribution manifest"),
  schemaVersion: z.literal(1),
  kind: z.literal("aicharts-gpt-subsidy-account-attribution"),
  revision: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  frozenAt: isoDateTimeSchema,
  sourceUrl: z.literal(GPT_SUBSIDY_ATTRIBUTION_MANIFEST_URL),
}).strict();

const accountPlanComparisonSchema = z.object({
  periodStartedAt: isoDateTimeSchema,
  periodEndedAt: isoDateTimeSchema,
  accountAttribution: accountAttributionSchema,
  observedProPlanComparison: observedProPlanComparisonSchema,
  firstSampledAt: isoDateTimeSchema.nullable(),
  measurement: attributionMeasurementSchema,
}).strict();

export const gptSubsidyObservationSchema = z.object({
  id: z.string().min(1),
  observedAt: isoDateTimeSchema,
  periodStartedAt: isoDateTimeSchema,
  periodEndsAt: isoDateTimeSchema,
  status: z.literal("settled"),
  tokens: tokenUsageSchema,
  trailingSevenDayApiEquivalentUsd: finiteNonnegativeSchema,
  accountAttribution: accountAttributionSchema,
  subscriptionAdjustedMultiple: z.null(),
}).strict();

const periodSummarySchema = z.object({
  startedAt: isoDateTimeSchema,
  endedAt: isoDateTimeSchema,
  days: z.literal(31),
  tokens: tokenUsageSchema,
  apiEquivalentUsd: finiteNonnegativeSchema,
}).strict();

export const gptSubsidySnapshotSchema = z.object({
  schemaVersion: z.literal(2),
  title: z.literal(GPT_SUBSIDY_TITLE),
  generatedAt: isoDateTimeSchema,
  currency: z.literal("USD"),
  plan: z.object({
    name: z.literal("ChatGPT Pro"),
    monthlyPriceUsd: z.literal(200),
    advertisedUsageMultiplier: z.literal(20),
    observedAt: z.literal("2026-08-25T00:00:00Z"),
    sourceUrl: z.literal("https://help.openai.com/en/articles/9793128"),
  }).strict(),
  pricing: z.object({
    basis: z.literal("per-model-api-retail"),
    manifest: z.object({
      name: z.literal("AI Charts OpenAI rate manifest"),
      schemaVersion: z.literal(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      frozenAt: isoDateTimeSchema,
      sourceUrl: z.literal(
        "https://github.com/hraness/aicharts/blob/main/data/gpt-subsidy-pricing.json",
      ),
    }).strict(),
    proxyModelIds: z.array(z.string().min(1)).superRefine((modelIds, context) => {
      if (JSON.stringify(modelIds) !== JSON.stringify([...new Set(modelIds)].toSorted())) {
        context.addIssue({ code: "custom", message: "Proxy model IDs must be unique and sorted" });
      }
    }),
    referenceModel: z.object({
      name: z.literal("GPT-5.6 Sol"),
      uncachedInputPerMillionUsd: finiteNonnegativeSchema,
      cachedInputPerMillionUsd: finiteNonnegativeSchema,
      outputPerMillionUsd: finiteNonnegativeSchema,
      sourceUrl: z.string().url(),
    }).strict(),
  }).strict(),
  observations: z.array(gptSubsidyObservationSchema).min(31),
  periodSummary: periodSummarySchema,
  accountPlanComparison: accountPlanComparisonSchema,
  methodology: z.object({
    deduplication: z.literal("tokscale-global-event-identity"),
    measurement: z.object({
      name: z.literal("AI Charts GPT subsidy measurement manifest"),
      schemaVersion: z.literal(1),
      kind: z.literal("aicharts-gpt-subsidy-measurement"),
      revision: z.string().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      frozenAt: isoDateTimeSchema,
      sourceUrl: z.literal(
        "https://github.com/hraness/aicharts/blob/main/data/gpt-subsidy-measurement.json",
      ),
    }).strict(),
    formula: z.string().min(1),
    disclaimer: z.string().min(1),
    sourceUrls: z.array(z.string().url()).min(1),
  }).strict(),
}).strict().superRefine((snapshot, context) => {
  const ids = new Set<string>();
  let previousObservedAt = Number.NEGATIVE_INFINITY;
  let previousObservationDay = Number.NEGATIVE_INFINITY;

  snapshot.observations.forEach((observation, index) => {
    const path = ["observations", index] as const;
    const observedAt = Date.parse(observation.observedAt);
    const date = observation.observedAt.slice(0, 10);
    const observationDay = Date.parse(`${date}T00:00:00.000Z`);
    const expectedEnd = `${date}T23:59:59.999Z`;
    const expectedStart = new Date(
      observationDay - 6 * UTC_DAY_MILLISECONDS,
    ).toISOString();

    if (ids.has(observation.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate observation id: ${observation.id}`,
        path: [...path, "id"],
      });
    }
    ids.add(observation.id);

    if (observedAt <= previousObservedAt) {
      context.addIssue({
        code: "custom",
        message: "Observations must be sorted by a strictly increasing observedAt value",
        path: [...path, "observedAt"],
      });
    }
    previousObservedAt = observedAt;

    if (
      observation.id !== `trailing-7d-${date}`
      || observation.observedAt !== expectedEnd
      || observation.periodEndsAt !== expectedEnd
      || observation.periodStartedAt !== expectedStart
    ) {
      context.addIssue({
        code: "custom",
        message: "Each observation must identify an exact trailing-seven-calendar-day UTC window",
        path: [...path, "id"],
      });
    }

    if (
      previousObservationDay !== Number.NEGATIVE_INFINITY
      && observationDay - previousObservationDay !== UTC_DAY_MILLISECONDS
    ) {
      context.addIssue({
        code: "custom",
        message: "Observations must cover every adjacent UTC day without gaps",
        path: [...path, "observedAt"],
      });
    }
    previousObservationDay = observationDay;

    const expectedTotal = observation.tokens.uncachedInput
      + observation.tokens.cachedInput
      + observation.tokens.output;
    if (observation.tokens.total !== expectedTotal) {
      context.addIssue({
        code: "custom",
        message: "Token total must equal uncached input, cached input, and output tokens",
        path: [...path, "tokens", "total"],
      });
    }
    if (
      (observation.tokens.total === 0)
      !== (observation.trailingSevenDayApiEquivalentUsd === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Token usage and API-equivalent value must both be zero or both be positive",
        path: [...path, "trailingSevenDayApiEquivalentUsd"],
      });
    }

  });

  const summary = snapshot.periodSummary;
  const accountPlanComparison = snapshot.accountPlanComparison;
  const summaryTokenTotal = summary.tokens.uncachedInput
    + summary.tokens.cachedInput
    + summary.tokens.output;
  if (summary.tokens.total !== summaryTokenTotal) {
    context.addIssue({
      code: "custom",
      message: "Summary token total does not match its token buckets",
      path: ["periodSummary", "tokens", "total"],
    });
  }
  if ((summary.tokens.total === 0) !== (summary.apiEquivalentUsd === 0)) {
    context.addIssue({
      code: "custom",
      message: "Summary token usage and API-equivalent value must both be zero or both be positive",
      path: ["periodSummary", "apiEquivalentUsd"],
    });
  }
  if (Date.parse(summary.startedAt) > Date.parse(summary.endedAt)) {
    context.addIssue({
      code: "custom",
      message: "The summary must end on or after it starts",
      path: ["periodSummary", "endedAt"],
    });
  }
  if (
    accountPlanComparison.periodStartedAt !== summary.startedAt
    || accountPlanComparison.periodEndedAt !== summary.endedAt
  ) {
    context.addIssue({
      code: "custom",
      message: "Account-plan comparison must cover the period summary",
      path: ["accountPlanComparison", "periodStartedAt"],
    });
  }
  const accountAttribution = accountPlanComparison.accountAttribution;
  const observedProPlanComparison = accountPlanComparison.observedProPlanComparison;
  const hasSampledAttribution = accountAttribution.status !== "unavailable"
    || snapshot.observations.some(
      observation => observation.accountAttribution.status !== "unavailable",
    );
  if (hasSampledAttribution && accountPlanComparison.firstSampledAt === null) {
    context.addIssue({
      code: "custom",
      message: "Sampled account attribution requires its first publication time",
      path: ["accountPlanComparison", "firstSampledAt"],
    });
  }
  if (!hasSampledAttribution && accountPlanComparison.firstSampledAt !== null) {
    context.addIssue({
      code: "custom",
      message: "A sampled-attribution history marker requires retained sampled evidence",
      path: ["accountPlanComparison", "firstSampledAt"],
    });
  }
  if (
    accountPlanComparison.firstSampledAt !== null
    && Date.parse(accountPlanComparison.firstSampledAt)
      > Date.parse(snapshot.generatedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "Account attribution cannot first appear after snapshot generation",
      path: ["accountPlanComparison", "firstSampledAt"],
    });
  }
  if (
    accountAttribution.status === "unavailable"
    && observedProPlanComparison.status !== "unavailable"
  ) {
    context.addIssue({
      code: "custom",
      message: "A sampled Pro-plan comparison requires sampled account coverage",
      path: ["accountPlanComparison", "observedProPlanComparison"],
    });
  }
  if (observedProPlanComparison.status === "sampled") {
    if (
      accountAttribution.distinctObservedAccounts === null
      || observedProPlanComparison.distinctVerifiedProAccountsLowerBound
        > accountAttribution.distinctObservedAccounts
    ) {
      context.addIssue({
        code: "custom",
        message: "Pro-status account lower bound cannot exceed all distinctly observed accounts",
        path: [
          "accountPlanComparison",
          "observedProPlanComparison",
          "distinctVerifiedProAccountsLowerBound",
        ],
      });
    }
    const expectedPlanValue = observedProPlanComparison
      .distinctVerifiedProAccountsLowerBound * snapshot.plan.monthlyPriceUsd;
    if (observedProPlanComparison.normalizedPlanValueUsd !== expectedPlanValue) {
      context.addIssue({
        code: "custom",
        message: "Observed Pro plan value must equal the Pro-status account lower bound times the plan price",
        path: ["accountPlanComparison", "observedProPlanComparison", "normalizedPlanValueUsd"],
      });
    }
    const expectedMultiple = summary.apiEquivalentUsd / expectedPlanValue;
    if (Math.abs(
      observedProPlanComparison.apiEquivalentMultipleUpperBound - expectedMultiple,
    ) > Math.max(1e-9, Math.abs(expectedMultiple) * 1e-12)) {
      context.addIssue({
        code: "custom",
        message: "Observed Pro upper bound must equal API value divided by normalized plan value",
        path: [
          "accountPlanComparison",
          "observedProPlanComparison",
          "apiEquivalentMultipleUpperBound",
        ],
      });
    }
  }
  const latest = snapshot.observations.at(-1);
  if (latest !== undefined) {
    const latestDate = latest.observedAt.slice(0, 10);
    const expectedSummaryStart = new Date(
      Date.parse(`${latestDate}T00:00:00.000Z`) - 30 * UTC_DAY_MILLISECONDS,
    ).toISOString();
    if (
      summary.startedAt !== expectedSummaryStart
      || summary.endedAt !== latest.observedAt
    ) {
      context.addIssue({
        code: "custom",
        message: "Period summary must cover the latest 31 complete UTC days",
        path: ["periodSummary", "startedAt"],
      });
    }
  }
  const latestMeasurement = latest === undefined ? 0 : Date.parse(latest.observedAt);
  if (Date.parse(snapshot.generatedAt) < latestMeasurement) {
    context.addIssue({
      code: "custom",
      message: "generatedAt cannot predate the latest measurement",
      path: ["generatedAt"],
    });
  }
  if (latest !== undefined) {
    const generatedAt = new Date(snapshot.generatedAt);
    const generatedDayStart = Date.UTC(
      generatedAt.getUTCFullYear(),
      generatedAt.getUTCMonth(),
      generatedAt.getUTCDate(),
    );
    const expectedLatestEnd = new Date(generatedDayStart - 1).toISOString();
    if (latest.observedAt !== expectedLatestEnd) {
      context.addIssue({
        code: "custom",
        message: "Latest observation must be the complete UTC day before generation",
        path: ["observations", snapshot.observations.length - 1, "observedAt"],
      });
    }
  }
});

export type GptSubsidyObservation = z.infer<typeof gptSubsidyObservationSchema>;
export type GptSubsidySnapshot = z.infer<typeof gptSubsidySnapshotSchema>;

export function gptSubsidyPageModifiedAt(snapshot: GptSubsidySnapshot): string {
  return Date.parse(snapshot.generatedAt) >= Date.parse(GPT_SUBSIDY_PAGE_CONTENT_MODIFIED_AT)
    ? snapshot.generatedAt
    : GPT_SUBSIDY_PAGE_CONTENT_MODIFIED_AT;
}

type TokenUsage = Pick<GptSubsidyObservation["tokens"],
  "uncachedInput" | "cachedInput" | "output">;
type ModelPricing = Pick<GptSubsidySnapshot["pricing"]["referenceModel"],
  "uncachedInputPerMillionUsd" | "cachedInputPerMillionUsd" | "outputPerMillionUsd">;

export function calculateApiEquivalentUsd(
  tokens: TokenUsage,
  pricing: ModelPricing,
): number {
  return (
    tokens.uncachedInput * pricing.uncachedInputPerMillionUsd
    + tokens.cachedInput * pricing.cachedInputPerMillionUsd
    + tokens.output * pricing.outputPerMillionUsd
  ) / 1_000_000;
}

export function calculateObservedProPlanUpperBoundMultiple(
  aggregateApiEquivalentUsd: number,
  planPriceUsd: number,
  distinctVerifiedProAccountsLowerBound: number,
): number {
  if (
    !Number.isFinite(aggregateApiEquivalentUsd)
    || aggregateApiEquivalentUsd < 0
  ) {
    throw new RangeError(
      "Aggregate API-equivalent value must be finite and nonnegative",
    );
  }
  if (!Number.isFinite(planPriceUsd) || planPriceUsd <= 0) {
    throw new RangeError("Plan price must be finite and positive");
  }
  if (
    !Number.isSafeInteger(distinctVerifiedProAccountsLowerBound)
    || distinctVerifiedProAccountsLowerBound <= 0
  ) {
    throw new RangeError("Pro-status account lower bound must be a positive safe integer");
  }

  return aggregateApiEquivalentUsd
    / (planPriceUsd * distinctVerifiedProAccountsLowerBound);
}

export function parseGptSubsidySnapshot(
  value: unknown,
): Result<GptSubsidySnapshot, z.ZodError> {
  return parseResult(gptSubsidySnapshotSchema, value);
}

export function latestGptSubsidyObservation(
  snapshot: GptSubsidySnapshot,
): GptSubsidyObservation {
  const latest = snapshot.observations.at(-1);
  if (latest === undefined) {
    throw new Error("A checked GPT subsidy snapshot must contain an observation");
  }
  return latest;
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});

const usdRateFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const compactTokenFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});

const wholeMultipleFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

const utcDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

const utcDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
  timeZoneName: "short",
  year: "numeric",
});

export function formatSubsidyUsd(value: number): string {
  return usdFormatter.format(value);
}

export function formatSubsidyRateUsd(value: number): string {
  return usdRateFormatter.format(value);
}

export function formatSubsidyTokens(value: number): string {
  return compactTokenFormatter.format(value);
}

export function formatSampledCoverageLowerBound(value: number): string {
  if (value === GPT_SUBSIDY_SUB_ONE_PERCENT_COVERAGE_SENTINEL) {
    return "<1%";
  }
  if (
    !Number.isFinite(value)
    || value < 0.01
    || value > 0.99
    || Math.abs(value * 100 - Math.round(value * 100)) >= 1e-9
  ) {
    throw new RangeError(
      "Sampled coverage must be the checked whole-percentage lower bound",
    );
  }
  return `at least ${String(Math.round(value * 100))}%`;
}

export function formatObservedProPlanUpperBoundMultiple(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Observed Pro comparison must be finite and nonnegative");
  }

  return `≤${wholeMultipleFormatter.format(Math.ceil(value))}×`;
}

export function formatSubsidyDate(value: string): string {
  return utcDateFormatter.format(new Date(value));
}

export function formatSubsidyDateTime(value: string): string {
  return utcDateTimeFormatter.format(new Date(value));
}
