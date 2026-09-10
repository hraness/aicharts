import type { Result } from "./result";
import { credentialFreeHttpsUrlSchema } from "./credential-free-https-url";
import { err, ok } from "./result";
import { parseResult, z } from "./schema";

export const CALCULATOR_OPENAI_PRICING_URL =
  "https://developers.openai.com/api/docs/pricing" as const;
export const CALCULATOR_DEEPSEEK_PRICING_URL =
  "https://api-docs.deepseek.com/quick_start/pricing" as const;
export const CALCULATOR_EIA_ELECTRICITY_URL =
  "https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_a" as const;
export const CALCULATOR_VAST_RENTAL_URL =
  "https://console.vast.ai/api/v0/bundles/" as const;
export const CALCULATOR_SUBSIDY_METHOD_URL =
  "https://x.com/SemiAnalysis_/status/2064815042374074396" as const;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const isoMonthSchema = z.string().regex(/^\d{4}-\d{2}$/u);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const positiveFiniteSchema = z.number().finite().positive();
const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);

const retrievedSourceSchema = z.object({
  name: z.string().min(1),
  retrievedAt: isoDateTimeSchema,
  url: credentialFreeHttpsUrlSchema,
}).strict();

const perMillionTokenRatesSchema = z.object({
  cachedInputPerMillion: positiveFiniteSchema,
  inputPerMillion: positiveFiniteSchema,
  outputPerMillion: positiveFiniteSchema,
}).strict().superRefine((rates, context) => {
  if (rates.cachedInputPerMillion >= rates.inputPerMillion) {
    context.addIssue({
      code: "custom",
      message: "Cached input must be cheaper than uncached input.",
      path: ["cachedInputPerMillion"],
    });
  }
  if (rates.inputPerMillion > rates.outputPerMillion) {
    context.addIssue({
      code: "custom",
      message: "Input must not cost more than output.",
      path: ["inputPerMillion"],
    });
  }
});

const openAiApiPricingSchema = z.object({
  current: perMillionTokenRatesSchema,
  currentBasis: z.union([z.literal("promotional"), z.literal("list")]),
  listFallback: perMillionTokenRatesSchema,
  listFallbackDocumentedOn: isoDateSchema,
  modelId: z.literal("gpt-5.6-sol"),
  modelName: z.literal("GPT-5.6 Sol"),
  promoGuaranteedThrough: isoDateSchema.nullable(),
  source: retrievedSourceSchema,
}).strict().superRefine((pricing, context) => {
  if (pricing.currentBasis === "promotional" && pricing.promoGuaranteedThrough === null) {
    context.addIssue({
      code: "custom",
      message: "Promotional pricing must record the published guarantee date.",
      path: ["promoGuaranteedThrough"],
    });
  }
});

const deepSeekWindowRatesSchema = z.object({
  cacheHitInputPerMillion: positiveFiniteSchema,
  cacheMissInputPerMillion: positiveFiniteSchema,
  outputPerMillion: positiveFiniteSchema,
}).strict().superRefine((rates, context) => {
  if (rates.cacheHitInputPerMillion >= rates.cacheMissInputPerMillion) {
    context.addIssue({
      code: "custom",
      message: "A cache hit must be cheaper than a cache miss.",
      path: ["cacheHitInputPerMillion"],
    });
  }
});

const deepSeekApiPricingSchema = z.object({
  modelId: z.literal("deepseek-flash"),
  modelVersion: z.string().min(1),
  offPeak: deepSeekWindowRatesSchema,
  peak: deepSeekWindowRatesSchema,
  peakHoursPerWeek: z.number().finite().min(0).max(168),
  peakHoursUtc: z.string().min(1),
  source: retrievedSourceSchema,
}).strict().superRefine((pricing, context) => {
  const pairs = [
    ["cacheHitInputPerMillion", pricing.offPeak.cacheHitInputPerMillion, pricing.peak.cacheHitInputPerMillion],
    ["cacheMissInputPerMillion", pricing.offPeak.cacheMissInputPerMillion, pricing.peak.cacheMissInputPerMillion],
    ["outputPerMillion", pricing.offPeak.outputPerMillion, pricing.peak.outputPerMillion],
  ] as const;
  for (const [field, offPeak, peak] of pairs) {
    // DeepSeek documents off-peak as exactly half of peak; a policy change must fail closed for review.
    if (Math.abs(peak - offPeak * 2) > offPeak * 1e-6) {
      context.addIssue({
        code: "custom",
        message: `DeepSeek off-peak ${field} must be half of the peak rate per the published policy.`,
        path: ["offPeak", field],
      });
    }
  }
});

const electricitySchema = z.object({
  period: isoMonthSchema,
  source: retrievedSourceSchema,
  usResidentialCentsPerKwh: z.number().finite().min(2).max(100),
}).strict();

const rentalOfferSchema = z.object({
  gpuId: identifierSchema,
  offerCount: z.number().int().min(3),
  usdPerHour: z.number().finite().min(0.05).max(100),
}).strict();

const gpuRentalSchema = z.object({
  methodology: z.string().min(1),
  offers: z.array(rentalOfferSchema).min(1),
  source: retrievedSourceSchema,
}).strict().superRefine((rental, context) => {
  const seen = new Set<string>();
  rental.offers.forEach((offer, index) => {
    if (seen.has(offer.gpuId)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate rental offer for ${offer.gpuId}.`,
        path: ["offers", index, "gpuId"],
      });
    }
    seen.add(offer.gpuId);
  });
});

const gpuPurchaseSchema = z.object({
  asOf: isoDateSchema,
  kind: z.union([z.literal("street"), z.literal("msrp"), z.literal("used-market")]),
  sourceName: z.string().min(1),
  sourceUrl: credentialFreeHttpsUrlSchema,
  usd: positiveFiniteSchema,
}).strict();

const hardwareGpuSchema = z.object({
  id: identifierSchema,
  name: z.string().min(1),
  providerId: z.literal("nvidia"),
  purchase: gpuPurchaseSchema.nullable(),
  tdpWatts: z.number().finite().min(50).max(2_000),
}).strict();

const throughputBasisSchema = z.union([
  z.literal("measured"),
  z.literal("published-band"),
  z.literal("bandwidth-estimate"),
]);

const rentalPlanSchema = z.object({
  gpuId: identifierSchema,
  gpusPerUnit: z.number().int().min(1).max(8),
  unitDecodeTps: positiveFiniteSchema,
  unitDecodeTpsBasis: throughputBasisSchema,
}).strict();

const hardwareProfileSchema = z.object({
  gpuId: identifierSchema,
  gpusPerUnit: z.number().int().min(1).max(8),
  id: identifierSchema,
  modelClass: z.string().min(1),
  name: z.string().min(1),
  note: z.string().min(1),
  rental: rentalPlanSchema,
  sourceName: z.string().min(1),
  sourceObservedOn: isoDateSchema,
  sourceUrl: credentialFreeHttpsUrlSchema,
  unitDecodeTps: positiveFiniteSchema,
  unitDecodeTpsBasis: throughputBasisSchema,
}).strict();

const hardwareSchema = z.object({
  gpus: z.array(hardwareGpuSchema).min(1),
  profiles: z.array(hardwareProfileSchema).min(1),
  refreshNote: z.string().min(1),
}).strict();

const subsidyCeilingSchema = z.object({
  apiEquivalentUsdPerMonth: positiveFiniteSchema,
  impliedMultiple: positiveFiniteSchema,
  monthlyPriceUsd: positiveFiniteSchema,
  plan: z.string().min(1),
}).strict();

const NAMED_SUBSIDY_CEILING_PLANS = ["ChatGPT Pro 20x", "Claude Max 20x"] as const;

const subsidyAnchorSchema = z.object({
  defaultMultiple: z.number().finite().min(10).max(100),
  lastVerifiedOn: isoDateSchema,
  methodPublishedOn: isoDateSchema,
  methodSourceName: z.string().min(1),
  methodSourceUrl: credentialFreeHttpsUrlSchema,
  publishedCeilings: z.array(subsidyCeilingSchema).min(1),
  reverificationNote: z.string().min(1),
  secondarySourceName: z.string().min(1),
  secondarySourceUrl: credentialFreeHttpsUrlSchema,
}).strict().superRefine((anchor, context) => {
  // The page and Markdown copy quote both named ceilings; keep them present so
  // a reviewed edit cannot silently blank the method paragraph.
  for (const plan of NAMED_SUBSIDY_CEILING_PLANS) {
    if (!anchor.publishedCeilings.some(ceiling => ceiling.plan === plan)) {
      context.addIssue({
        code: "custom",
        message: `Subsidy anchor must retain the published ${plan} ceiling.`,
        path: ["publishedCeilings"],
      });
    }
  }
});

const planSchema = z.object({
  asOf: isoDateSchema,
  id: z.literal("chatgpt-pro-20x"),
  monthlyPriceUsd: positiveFiniteSchema,
  name: z.literal("ChatGPT Pro 20x"),
  sourceUrl: credentialFreeHttpsUrlSchema,
}).strict();

export const calculatorInputsSnapshotSchema = z.object({
  deepSeekApiPricing: deepSeekApiPricingSchema,
  electricity: electricitySchema,
  gpuRental: gpuRentalSchema,
  hardware: hardwareSchema,
  openAiApiPricing: openAiApiPricingSchema,
  plan: planSchema,
  schemaVersion: z.literal(1),
  subsidyAnchor: subsidyAnchorSchema,
}).strict().superRefine((snapshot, context) => {
  const gpuIds = new Set(snapshot.hardware.gpus.map(gpu => gpu.id));
  const duplicateGpuIds = snapshot.hardware.gpus.length !== gpuIds.size;
  if (duplicateGpuIds) {
    context.addIssue({
      code: "custom",
      message: "Hardware GPU ids must be unique.",
      path: ["hardware", "gpus"],
    });
  }
  const rentalGpuIds = new Set(snapshot.gpuRental.offers.map(offer => offer.gpuId));
  for (const gpuId of rentalGpuIds) {
    if (!gpuIds.has(gpuId)) {
      context.addIssue({
        code: "custom",
        message: `Rental offer references unknown GPU ${gpuId}.`,
        path: ["gpuRental", "offers"],
      });
    }
  }
  const profileIds = new Set<string>();
  snapshot.hardware.profiles.forEach((profile, index) => {
    if (profileIds.has(profile.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate hardware profile id ${profile.id}.`,
        path: ["hardware", "profiles", index, "id"],
      });
    }
    profileIds.add(profile.id);
    const gpu = snapshot.hardware.gpus.find(candidate => candidate.id === profile.gpuId);
    if (gpu === undefined) {
      context.addIssue({
        code: "custom",
        message: `Profile ${profile.id} references unknown GPU ${profile.gpuId}.`,
        path: ["hardware", "profiles", index, "gpuId"],
      });
    } else if (gpu.purchase === null) {
      context.addIssue({
        code: "custom",
        message: `Profile ${profile.id} uses ${profile.gpuId} as home hardware, so a purchase price is required.`,
        path: ["hardware", "profiles", index, "gpuId"],
      });
    }
    if (!gpuIds.has(profile.rental.gpuId)) {
      context.addIssue({
        code: "custom",
        message: `Profile ${profile.id} rents unknown GPU ${profile.rental.gpuId}.`,
        path: ["hardware", "profiles", index, "rental", "gpuId"],
      });
    }
    if (!rentalGpuIds.has(profile.rental.gpuId)) {
      context.addIssue({
        code: "custom",
        message: `Profile ${profile.id} rents ${profile.rental.gpuId}, which has no market rental offer.`,
        path: ["hardware", "profiles", index, "rental", "gpuId"],
      });
    }
  });
});

export type CalculatorInputsSnapshot = z.infer<typeof calculatorInputsSnapshotSchema>;
export type CalculatorOpenAiPricing = CalculatorInputsSnapshot["openAiApiPricing"];
export type CalculatorDeepSeekPricing = CalculatorInputsSnapshot["deepSeekApiPricing"];
export type CalculatorHardwareGpu = CalculatorInputsSnapshot["hardware"]["gpus"][number];
export type CalculatorHardwareProfile = CalculatorInputsSnapshot["hardware"]["profiles"][number];
export type CalculatorRentalOffer = CalculatorInputsSnapshot["gpuRental"]["offers"][number];
export type PerMillionTokenRates = z.infer<typeof perMillionTokenRatesSchema>;

export function parseCalculatorInputsSnapshot(
  value: unknown,
): Result<CalculatorInputsSnapshot, z.ZodError> {
  return parseResult(calculatorInputsSnapshotSchema, value);
}

export type CalculatorSubsidyCeiling =
  CalculatorInputsSnapshot["subsidyAnchor"]["publishedCeilings"][number];

/** The schema guarantees both named ceilings, so absence is a checked-in invariant failure. */
export function namedSubsidyCeiling(
  anchor: CalculatorInputsSnapshot["subsidyAnchor"],
  plan: (typeof NAMED_SUBSIDY_CEILING_PLANS)[number],
): CalculatorSubsidyCeiling {
  const ceiling = anchor.publishedCeilings.find(candidate => candidate.plan === plan);
  if (ceiling === undefined) {
    throw new Error(`Checked subsidy anchor is missing the published ${plan} ceiling.`);
  }
  return ceiling;
}

/** Latest source retrieval or curated as-of date; drives the page's sitemap `lastmod`. */
export function calculatorInputsModifiedAt(snapshot: CalculatorInputsSnapshot): string {
  const dates = [
    snapshot.deepSeekApiPricing.source.retrievedAt,
    snapshot.electricity.source.retrievedAt,
    snapshot.gpuRental.source.retrievedAt,
    snapshot.openAiApiPricing.source.retrievedAt,
    `${snapshot.plan.asOf}T00:00:00Z`,
    `${snapshot.subsidyAnchor.lastVerifiedOn}T00:00:00Z`,
    ...snapshot.hardware.gpus.flatMap(gpu => (
      gpu.purchase === null ? [] : [`${gpu.purchase.asOf}T00:00:00Z`]
    )),
    ...snapshot.hardware.profiles.map(profile => `${profile.sourceObservedOn}T00:00:00Z`),
  ];
  return dates.sort((left, right) => Date.parse(right) - Date.parse(left))[0]!;
}

const maximumRateChangeFactor = 8;

function rateChangeExceedsBound(previous: number, candidate: number): boolean {
  const ratio = candidate / previous;
  return ratio > maximumRateChangeFactor || ratio < 1 / maximumRateChangeFactor;
}

/**
 * Guards an automated replacement of the checked snapshot. Rates may move, but a
 * jump beyond 8x in either direction is treated as a scrape failure for review.
 */
export function validateCalculatorInputsReplacement(
  previous: CalculatorInputsSnapshot,
  candidate: CalculatorInputsSnapshot,
): Result<void, Error> {
  const ratePairs: readonly (readonly [string, number, number])[] = [
    ["OpenAI input", previous.openAiApiPricing.current.inputPerMillion, candidate.openAiApiPricing.current.inputPerMillion],
    ["OpenAI cached input", previous.openAiApiPricing.current.cachedInputPerMillion, candidate.openAiApiPricing.current.cachedInputPerMillion],
    ["OpenAI output", previous.openAiApiPricing.current.outputPerMillion, candidate.openAiApiPricing.current.outputPerMillion],
    ["DeepSeek off-peak cache hit", previous.deepSeekApiPricing.offPeak.cacheHitInputPerMillion, candidate.deepSeekApiPricing.offPeak.cacheHitInputPerMillion],
    ["DeepSeek off-peak cache miss", previous.deepSeekApiPricing.offPeak.cacheMissInputPerMillion, candidate.deepSeekApiPricing.offPeak.cacheMissInputPerMillion],
    ["DeepSeek off-peak output", previous.deepSeekApiPricing.offPeak.outputPerMillion, candidate.deepSeekApiPricing.offPeak.outputPerMillion],
    ["US residential electricity", previous.electricity.usResidentialCentsPerKwh, candidate.electricity.usResidentialCentsPerKwh],
  ];
  for (const [label, previousRate, candidateRate] of ratePairs) {
    if (rateChangeExceedsBound(previousRate, candidateRate)) {
      return err(new Error(
        `${label} moved from ${previousRate} to ${candidateRate}, beyond the ${maximumRateChangeFactor}x replacement bound.`,
      ));
    }
  }
  const previousRentals = new Map(previous.gpuRental.offers.map(offer => [offer.gpuId, offer.usdPerHour]));
  for (const offer of candidate.gpuRental.offers) {
    const previousRate = previousRentals.get(offer.gpuId);
    if (previousRate !== undefined && rateChangeExceedsBound(previousRate, offer.usdPerHour)) {
      return err(new Error(
        `Rental rate for ${offer.gpuId} moved from ${previousRate} to ${offer.usdPerHour}, beyond the ${maximumRateChangeFactor}x replacement bound.`,
      ));
    }
    if (previousRate === undefined) {
      return err(new Error(
        `Rental offer for ${offer.gpuId} is new; add it through a reviewed snapshot change, not the automated refresh.`,
      ));
    }
  }
  for (const [gpuId] of previousRentals) {
    if (!candidate.gpuRental.offers.some(offer => offer.gpuId === gpuId)) {
      return err(new Error(
        `Rental offer for ${gpuId} disappeared; the market source is stale or the query broke.`,
      ));
    }
  }
  const curatedUnchanged =
    JSON.stringify(previous.hardware) === JSON.stringify(candidate.hardware)
    && JSON.stringify(previous.subsidyAnchor) === JSON.stringify(candidate.subsidyAnchor)
    && JSON.stringify(previous.plan) === JSON.stringify(candidate.plan)
    && JSON.stringify(previous.openAiApiPricing.listFallback) === JSON.stringify(candidate.openAiApiPricing.listFallback);
  if (!curatedUnchanged) {
    return err(new Error(
      "Curated sections (hardware, subsidy anchor, plan, list fallback) changed; route those edits through review.",
    ));
  }
  return ok(undefined);
}
