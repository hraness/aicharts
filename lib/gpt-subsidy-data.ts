import type { Result } from "./result";
import { parseResult, z } from "./schema";

export const GPT_SUBSIDY_TITLE =
  "Subsidy for ChatGPT Pro 20x subscription" as const;

export const GPT_SUBSIDY_DESCRIPTION =
  "Daily API-retail-equivalent value of seven complete UTC days from one user's available local Codex logs on one machine, converted to a monthly pace and compared with a $200 ChatGPT Pro plan-price unit.";

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

export const gptSubsidyObservationSchema = z.object({
  id: z.string().min(1),
  observedAt: isoDateTimeSchema,
  periodStartedAt: isoDateTimeSchema,
  periodEndsAt: isoDateTimeSchema,
  status: z.literal("settled"),
  tokens: tokenUsageSchema,
  trailingSevenDayApiEquivalentUsd: finiteNonnegativeSchema,
  monthlyApiEquivalentUsd: finiteNonnegativeSchema,
  planPriceMultiple: finiteNonnegativeSchema,
}).strict();

const periodSummarySchema = z.object({
  startedAt: isoDateTimeSchema,
  endedAt: isoDateTimeSchema,
  days: z.literal(31),
  tokens: tokenUsageSchema,
  apiEquivalentUsd: finiteNonnegativeSchema,
  planPriceMultiple: finiteNonnegativeSchema,
}).strict();

export const gptSubsidySnapshotSchema = z.object({
  schemaVersion: z.literal(1),
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
  methodology: z.object({
    deduplication: z.literal("tokscale-global-event-identity"),
    weeksPerMonth: z.literal(4.348125),
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

    const expectedMonthlyUsd = observation.trailingSevenDayApiEquivalentUsd
      * snapshot.methodology.weeksPerMonth;
    if (!approximatelyEqual(observation.monthlyApiEquivalentUsd, expectedMonthlyUsd, 0.02)) {
      context.addIssue({
        code: "custom",
        message: "Monthly API-equivalent value does not match the weekly pace",
        path: [...path, "monthlyApiEquivalentUsd"],
      });
    }

    const expectedMultiple = observation.monthlyApiEquivalentUsd
      / snapshot.plan.monthlyPriceUsd;
    if (!approximatelyEqual(observation.planPriceMultiple, expectedMultiple, 0.02)) {
      context.addIssue({
        code: "custom",
        message: "Plan-price multiple does not match monthly value divided by plan price",
        path: [...path, "planPriceMultiple"],
      });
    }

  });

  const summary = snapshot.periodSummary;
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
  if (!approximatelyEqual(
    summary.planPriceMultiple,
    summary.apiEquivalentUsd / snapshot.plan.monthlyPriceUsd,
    0.02,
  )) {
    context.addIssue({
      code: "custom",
      message: "Summary multiple does not match value divided by plan price",
      path: ["periodSummary", "planPriceMultiple"],
    });
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

type TokenUsage = Pick<GptSubsidyObservation["tokens"],
  "uncachedInput" | "cachedInput" | "output">;
type ModelPricing = Pick<GptSubsidySnapshot["pricing"]["referenceModel"],
  "uncachedInputPerMillionUsd" | "cachedInputPerMillionUsd" | "outputPerMillionUsd">;

function approximatelyEqual(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

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

export function formatSubsidyMultiple(value: number): string {
  return `${value.toFixed(1)}×`;
}

export function formatSubsidyUsd(value: number): string {
  return usdFormatter.format(value);
}

export function formatSubsidyRateUsd(value: number): string {
  return usdRateFormatter.format(value);
}

export function formatSubsidyTokens(value: number): string {
  return compactTokenFormatter.format(value);
}

export function formatSubsidyDate(value: string): string {
  return utcDateFormatter.format(new Date(value));
}

export function formatSubsidyDateTime(value: string): string {
  return utcDateTimeFormatter.format(new Date(value));
}
