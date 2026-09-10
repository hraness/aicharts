import type {
  CalculatorDeepSeekPricing,
  CalculatorHardwareProfile,
  CalculatorInputsSnapshot,
  PerMillionTokenRates,
} from "./calculator-inputs-data";

/**
 * Cost model for the subscription-versus-API-versus-hardware calculator.
 *
 * The anchor is the SemiAnalysis method: value a fully used subscription at the
 * API retail price of the tokens it serves. Every function here is pure so the
 * golden numbers in calculator-math.test.ts pin the arithmetic exactly.
 */

const DAYS_PER_MONTH = 365.25 / 12;
export const CONTINUOUS_HOURS_PER_MONTH = 24 * DAYS_PER_MONTH;
export const POWER_USER_HOURS_PER_WEEK = 40;
export const POWER_USER_HOURS_PER_MONTH = POWER_USER_HOURS_PER_WEEK * (DAYS_PER_MONTH / 7);

export type SolRateBasis = "current" | "list";
export type DeepSeekWindow = "offPeak" | "peak" | "blended";
export type DutyCycle = "powerUser" | "continuous";

export interface CalculatorKnobs {
  readonly amortizationMonths: number;
  readonly cacheHitPercent: number;
  readonly deepSeekWindow: DeepSeekWindow;
  readonly dutyCycle: DutyCycle;
  readonly hardwareProfileId: string;
  readonly inputTokensPerOutputToken: number;
  readonly seats: number;
  readonly solRateBasis: SolRateBasis;
  readonly subsidyMultiple: number;
  readonly ultraMultiple: number;
  readonly utilizationPercent: number;
}

export const CALCULATOR_KNOB_BOUNDS = {
  amortizationMonths: { min: 6, max: 60, step: 6 },
  cacheHitPercent: { min: 0, max: 95, step: 5 },
  inputTokensPerOutputToken: { min: 1, max: 10, step: 1 },
  seats: { min: 1, max: 1_000, step: 1 },
  subsidyMultiple: { min: 10, max: 100, step: 5 },
  ultraMultiple: { min: 1, max: 10, step: 1 },
  utilizationPercent: { min: 5, max: 100, step: 5 },
} as const;

export const DEFAULT_CALCULATOR_KNOBS: CalculatorKnobs = {
  amortizationMonths: 24,
  cacheHitPercent: 50,
  deepSeekWindow: "offPeak",
  dutyCycle: "powerUser",
  hardwareProfileId: "rtx-5090-dense-32b",
  inputTokensPerOutputToken: 4,
  seats: 1,
  solRateBasis: "current",
  subsidyMultiple: 40,
  ultraMultiple: 1,
  utilizationPercent: 100,
};

function clampNumber(value: number, bounds: { min: number; max: number }): number {
  if (Number.isNaN(value)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

export function clampCalculatorKnobs(knobs: CalculatorKnobs): CalculatorKnobs {
  return {
    ...knobs,
    amortizationMonths: Math.round(clampNumber(knobs.amortizationMonths, CALCULATOR_KNOB_BOUNDS.amortizationMonths)),
    cacheHitPercent: clampNumber(knobs.cacheHitPercent, CALCULATOR_KNOB_BOUNDS.cacheHitPercent),
    inputTokensPerOutputToken: clampNumber(
      knobs.inputTokensPerOutputToken,
      CALCULATOR_KNOB_BOUNDS.inputTokensPerOutputToken,
    ),
    seats: Math.round(clampNumber(knobs.seats, CALCULATOR_KNOB_BOUNDS.seats)),
    subsidyMultiple: clampNumber(knobs.subsidyMultiple, CALCULATOR_KNOB_BOUNDS.subsidyMultiple),
    ultraMultiple: clampNumber(knobs.ultraMultiple, CALCULATOR_KNOB_BOUNDS.ultraMultiple),
    utilizationPercent: clampNumber(knobs.utilizationPercent, CALCULATOR_KNOB_BOUNDS.utilizationPercent),
  };
}

export interface TokenMix {
  /** Fraction of input tokens served from the provider prompt cache, 0 to 0.95. */
  readonly cacheHitRate: number;
  readonly inputTokensPerOutputToken: number;
}

export interface TokenVolume {
  readonly cachedInputTokens: number;
  readonly inputTokens: number;
  readonly missedInputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface ApiCostBreakdown {
  readonly cachedInputUsd: number;
  readonly missedInputUsd: number;
  readonly outputUsd: number;
  readonly totalUsd: number;
}

/** N seats at the sticker price, valued at the subsidy multiple and scaled by use. */
export function monthlyApiEquivalentSpendUsd(args: {
  readonly planMonthlyPriceUsd: number;
  readonly seats: number;
  readonly subsidyMultiple: number;
  readonly ultraMultiple: number;
  readonly utilizationRate: number;
}): number {
  return args.seats
    * args.planMonthlyPriceUsd
    * args.subsidyMultiple
    * args.utilizationRate
    * args.ultraMultiple;
}

/** Dollars per million output tokens once the input mix and cache hits are attached. */
export function costPerMillionOutputTokensUsd(
  rates: PerMillionTokenRates,
  mix: TokenMix,
): number {
  const inputPerMillion = (1 - mix.cacheHitRate) * rates.inputPerMillion
    + mix.cacheHitRate * rates.cachedInputPerMillion;
  return mix.inputTokensPerOutputToken * inputPerMillion + rates.outputPerMillion;
}

/** Converts an API-equivalent monthly spend into the token volume it buys. */
export function monthlyTokenVolume(
  spendUsd: number,
  rates: PerMillionTokenRates,
  mix: TokenMix,
): TokenVolume {
  const outputTokens = spendUsd / costPerMillionOutputTokensUsd(rates, mix) * 1_000_000;
  const inputTokens = outputTokens * mix.inputTokensPerOutputToken;
  const cachedInputTokens = inputTokens * mix.cacheHitRate;
  return {
    cachedInputTokens,
    inputTokens,
    missedInputTokens: inputTokens - cachedInputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

/** Prices an existing token volume on any per-million rate card. */
export function apiCostBreakdownUsd(
  volume: TokenVolume,
  rates: PerMillionTokenRates,
): ApiCostBreakdown {
  const cachedInputUsd = volume.cachedInputTokens / 1_000_000 * rates.cachedInputPerMillion;
  const missedInputUsd = volume.missedInputTokens / 1_000_000 * rates.inputPerMillion;
  const outputUsd = volume.outputTokens / 1_000_000 * rates.outputPerMillion;
  return {
    cachedInputUsd,
    missedInputUsd,
    outputUsd,
    totalUsd: cachedInputUsd + missedInputUsd + outputUsd,
  };
}

export function solRateCard(
  pricing: CalculatorInputsSnapshot["openAiApiPricing"],
  basis: SolRateBasis,
): PerMillionTokenRates {
  return basis === "current" ? pricing.current : pricing.listFallback;
}

/** DeepSeek windows share one rate-card shape; blended weights by published peak hours. */
export function deepSeekRateCard(
  pricing: CalculatorDeepSeekPricing,
  window: DeepSeekWindow,
): PerMillionTokenRates {
  const toCard = (rates: CalculatorDeepSeekPricing["offPeak"]): PerMillionTokenRates => ({
    cachedInputPerMillion: rates.cacheHitInputPerMillion,
    inputPerMillion: rates.cacheMissInputPerMillion,
    outputPerMillion: rates.outputPerMillion,
  });
  if (window === "offPeak") return toCard(pricing.offPeak);
  if (window === "peak") return toCard(pricing.peak);
  const peakShare = pricing.peakHoursPerWeek / 168;
  const offPeak = toCard(pricing.offPeak);
  const peak = toCard(pricing.peak);
  const blend = (low: number, high: number) => low * (1 - peakShare) + high * peakShare;
  return {
    cachedInputPerMillion: blend(offPeak.cachedInputPerMillion, peak.cachedInputPerMillion),
    inputPerMillion: blend(offPeak.inputPerMillion, peak.inputPerMillion),
    outputPerMillion: blend(offPeak.outputPerMillion, peak.outputPerMillion),
  };
}

export function dutyCycleHoursPerMonth(dutyCycle: DutyCycle): number {
  return dutyCycle === "continuous" ? CONTINUOUS_HOURS_PER_MONTH : POWER_USER_HOURS_PER_MONTH;
}

/**
 * Aggregate decode rate needed to generate the month's output tokens in the
 * available hours. Prefill (input processing) is intentionally excluded, which
 * flatters the local paths; the page states this limitation.
 */
export function requiredDecodeTps(outputTokensPerMonth: number, hoursPerMonth: number): number {
  return outputTokensPerMonth / (hoursPerMonth * 3_600);
}

export function unitsRequired(requiredTps: number, unitDecodeTps: number): number {
  return Math.max(1, Math.ceil(requiredTps / unitDecodeTps));
}

export interface HomeHardwareCost {
  readonly capexMonthlyUsd: number;
  readonly electricityMonthlyUsd: number;
  readonly totalMonthlyUsd: number;
  readonly upfrontUsd: number;
}

export function homeHardwareMonthlyCostUsd(args: {
  readonly amortizationMonths: number;
  readonly electricityUsdPerKwh: number;
  readonly hoursPerMonth: number;
  readonly unitCount: number;
  readonly unitPriceUsd: number;
  readonly unitTdpWatts: number;
}): HomeHardwareCost {
  const upfrontUsd = args.unitCount * args.unitPriceUsd;
  const capexMonthlyUsd = upfrontUsd / args.amortizationMonths;
  const electricityMonthlyUsd = args.unitCount
    * (args.unitTdpWatts / 1_000)
    * args.hoursPerMonth
    * args.electricityUsdPerKwh;
  return {
    capexMonthlyUsd,
    electricityMonthlyUsd,
    totalMonthlyUsd: capexMonthlyUsd + electricityMonthlyUsd,
    upfrontUsd,
  };
}

export function rentalMonthlyCostUsd(args: {
  readonly unitCount: number;
  readonly unitUsdPerHour: number;
  readonly hoursPerMonth: number;
}): number {
  return args.unitCount * args.unitUsdPerHour * args.hoursPerMonth;
}

export interface CalculatorScenario {
  readonly deepSeek: {
    readonly blendedUsd: number;
    readonly offPeakUsd: number;
    readonly peakUsd: number;
    readonly selectedBreakdown: ApiCostBreakdown;
    readonly selectedUsd: number;
  };
  readonly home: HomeHardwareCost & {
    readonly gpuCount: number;
    readonly unitCount: number;
  };
  readonly hoursPerMonth: number;
  readonly profile: CalculatorHardwareProfile;
  readonly rental: {
    readonly gpuCount: number;
    readonly monthlyUsd: number;
    readonly unitCount: number;
    readonly unitUsdPerHour: number;
  };
  readonly requiredTps: number;
  readonly sol: {
    readonly breakdown: ApiCostBreakdown;
    readonly otherBasis: SolRateBasis;
    readonly otherBasisUsd: number;
    readonly rates: PerMillionTokenRates;
  };
  readonly spendUsd: number;
  readonly stickerUsd: number;
  readonly volume: TokenVolume;
}

/** Full scenario for one knob state; every path prices the same implied token volume. */
export function computeCalculatorScenario(
  snapshot: CalculatorInputsSnapshot,
  rawKnobs: CalculatorKnobs,
): CalculatorScenario {
  const knobs = clampCalculatorKnobs(rawKnobs);
  const profile = snapshot.hardware.profiles.find(
    candidate => candidate.id === knobs.hardwareProfileId,
  ) ?? snapshot.hardware.profiles[0];
  if (profile === undefined) throw new Error("Calculator inputs must define at least one hardware profile.");

  const mix: TokenMix = {
    cacheHitRate: knobs.cacheHitPercent / 100,
    inputTokensPerOutputToken: knobs.inputTokensPerOutputToken,
  };
  const spendUsd = monthlyApiEquivalentSpendUsd({
    planMonthlyPriceUsd: snapshot.plan.monthlyPriceUsd,
    seats: knobs.seats,
    subsidyMultiple: knobs.subsidyMultiple,
    ultraMultiple: knobs.ultraMultiple,
    utilizationRate: knobs.utilizationPercent / 100,
  });
  const solRates = solRateCard(snapshot.openAiApiPricing, knobs.solRateBasis);
  const volume = monthlyTokenVolume(spendUsd, solRates, mix);
  const otherBasis: SolRateBasis = knobs.solRateBasis === "current" ? "list" : "current";

  const deepSeekCosts = {
    blended: apiCostBreakdownUsd(volume, deepSeekRateCard(snapshot.deepSeekApiPricing, "blended")),
    offPeak: apiCostBreakdownUsd(volume, deepSeekRateCard(snapshot.deepSeekApiPricing, "offPeak")),
    peak: apiCostBreakdownUsd(volume, deepSeekRateCard(snapshot.deepSeekApiPricing, "peak")),
  };
  const selectedDeepSeek = deepSeekCosts[knobs.deepSeekWindow];

  const hoursPerMonth = dutyCycleHoursPerMonth(knobs.dutyCycle);
  const requiredTps = requiredDecodeTps(volume.outputTokens, hoursPerMonth);

  const homeGpu = snapshot.hardware.gpus.find(gpu => gpu.id === profile.gpuId);
  if (homeGpu?.purchase == null) {
    throw new Error(`Hardware profile ${profile.id} has no purchasable GPU; the checked snapshot guards this.`);
  }
  const homeUnits = unitsRequired(requiredTps, profile.unitDecodeTps);
  const home = homeHardwareMonthlyCostUsd({
    amortizationMonths: knobs.amortizationMonths,
    electricityUsdPerKwh: snapshot.electricity.usResidentialCentsPerKwh / 100,
    hoursPerMonth,
    unitCount: homeUnits,
    unitPriceUsd: homeGpu.purchase.usd * profile.gpusPerUnit,
    unitTdpWatts: homeGpu.tdpWatts * profile.gpusPerUnit,
  });

  const rentalOffer = snapshot.gpuRental.offers.find(
    offer => offer.gpuId === profile.rental.gpuId,
  );
  if (rentalOffer === undefined) {
    throw new Error(`Hardware profile ${profile.id} rents a GPU with no market offer; the checked snapshot guards this.`);
  }
  const rentalUnits = unitsRequired(requiredTps, profile.rental.unitDecodeTps);
  const rentalUnitUsdPerHour = rentalOffer.usdPerHour * profile.rental.gpusPerUnit;

  return {
    deepSeek: {
      blendedUsd: deepSeekCosts.blended.totalUsd,
      offPeakUsd: deepSeekCosts.offPeak.totalUsd,
      peakUsd: deepSeekCosts.peak.totalUsd,
      selectedBreakdown: selectedDeepSeek,
      selectedUsd: selectedDeepSeek.totalUsd,
    },
    home: {
      ...home,
      gpuCount: homeUnits * profile.gpusPerUnit,
      unitCount: homeUnits,
    },
    hoursPerMonth,
    profile,
    rental: {
      gpuCount: rentalUnits * profile.rental.gpusPerUnit,
      monthlyUsd: rentalMonthlyCostUsd({
        hoursPerMonth,
        unitCount: rentalUnits,
        unitUsdPerHour: rentalUnitUsdPerHour,
      }),
      unitCount: rentalUnits,
      unitUsdPerHour: rentalUnitUsdPerHour,
    },
    requiredTps,
    sol: {
      breakdown: apiCostBreakdownUsd(volume, solRates),
      otherBasis,
      otherBasisUsd: apiCostBreakdownUsd(
        volume,
        solRateCard(snapshot.openAiApiPricing, otherBasis),
      ).totalUsd,
      rates: solRates,
    },
    spendUsd,
    stickerUsd: knobs.seats * snapshot.plan.monthlyPriceUsd,
    volume,
  };
}
