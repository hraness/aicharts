import { describe, expect, test } from "bun:test";
import { CALCULATOR_INPUTS } from "./calculator-inputs-collection";
import { goldenCalculatorSnapshot } from "./calculator-golden-fixture";
import {
  apiCostBreakdownUsd,
  CALCULATOR_KNOB_BOUNDS,
  CONTINUOUS_HOURS_PER_MONTH,
  clampCalculatorKnobs,
  computeCalculatorScenario,
  costPerMillionOutputTokensUsd,
  DEFAULT_CALCULATOR_KNOBS,
  deepSeekRateCard,
  dutyCycleHoursPerMonth,
  homeHardwareMonthlyCostUsd,
  monthlyApiEquivalentSpendUsd,
  monthlyTokenVolume,
  POWER_USER_HOURS_PER_MONTH,
  rentalMonthlyCostUsd,
  requiredDecodeTps,
  unitsRequired,
  usefulLifeCheckpointMonths,
} from "./calculator-math";

const defaultMix = { cacheHitRate: 0.5, inputTokensPerOutputToken: 4 } as const;
const solPromoRates = {
  cachedInputPerMillion: 0.4,
  inputPerMillion: 4,
  outputPerMillion: 20,
} as const;

const goldenSnapshot = goldenCalculatorSnapshot();

describe("calculator math golden case (N=1, 40x, 100% utilization, 50% cache, 4:1 mix)", () => {
  test("values one maxed seat at 8,000 dollars of API-equivalent spend", () => {
    expect(monthlyApiEquivalentSpendUsd({
      planMonthlyPriceUsd: 200,
      seats: 1,
      subsidyMultiple: 40,
      ultraMultiple: 1,
      utilizationRate: 1,
    })).toBe(8_000);
  });

  test("prices one million output tokens with their input mix at 28.80 dollars on Sol promo rates", () => {
    // 4 x (0.5 x $4 + 0.5 x $0.40) + $20 = $28.80 per 1M output tokens.
    expect(costPerMillionOutputTokensUsd(solPromoRates, defaultMix)).toBeCloseTo(28.8, 10);
  });

  test("converts 8,000 dollars into about 1.39B monthly tokens", () => {
    const volume = monthlyTokenVolume(8_000, solPromoRates, defaultMix);
    expect(volume.outputTokens).toBeCloseTo(277_777_777.78, 0);
    expect(volume.inputTokens).toBeCloseTo(1_111_111_111.11, 0);
    expect(volume.cachedInputTokens).toBeCloseTo(555_555_555.56, 0);
    expect(volume.missedInputTokens).toBeCloseTo(555_555_555.56, 0);
    expect(volume.totalTokens).toBeCloseTo(1_388_888_888.89, 0);
  });

  test("prices the implied volume back to exactly the spend on the same rates", () => {
    const volume = monthlyTokenVolume(8_000, solPromoRates, defaultMix);
    const breakdown = apiCostBreakdownUsd(volume, solPromoRates);
    expect(breakdown.totalUsd).toBeCloseTo(8_000, 6);
    expect(breakdown.missedInputUsd).toBeCloseTo(2_222.22, 2);
    expect(breakdown.cachedInputUsd).toBeCloseTo(222.22, 2);
    expect(breakdown.outputUsd).toBeCloseTo(5_555.56, 2);
  });

  test("prices the same volume at 251.67 dollars on DeepSeek Flash off-peak rates", () => {
    const volume = monthlyTokenVolume(8_000, solPromoRates, defaultMix);
    const offPeak = deepSeekRateCard(goldenSnapshot.deepSeekApiPricing, "offPeak");
    // 4 x (0.5 x $0.15 + 0.5 x $0.003) + $0.60 = $0.906 per 1M output tokens.
    expect(costPerMillionOutputTokensUsd(offPeak, defaultMix)).toBeCloseTo(0.906, 10);
    expect(apiCostBreakdownUsd(volume, offPeak).totalUsd).toBeCloseTo(251.67, 2);
  });

  test("doubles the DeepSeek cost at peak and blends by the published 35 peak hours a week", () => {
    const volume = monthlyTokenVolume(8_000, solPromoRates, defaultMix);
    const peakUsd = apiCostBreakdownUsd(
      volume,
      deepSeekRateCard(goldenSnapshot.deepSeekApiPricing, "peak"),
    ).totalUsd;
    const blendedUsd = apiCostBreakdownUsd(
      volume,
      deepSeekRateCard(goldenSnapshot.deepSeekApiPricing, "blended"),
    ).totalUsd;
    expect(peakUsd).toBeCloseTo(503.33, 2);
    // Off-peak x (1 + 35/168) because peak is exactly double off-peak.
    expect(blendedUsd).toBeCloseTo(251.666_67 * (1 + 35 / 168), 2);
  });

  test("needs about 444 aggregate decode tokens per second on the power-user duty cycle", () => {
    const volume = monthlyTokenVolume(8_000, solPromoRates, defaultMix);
    expect(POWER_USER_HOURS_PER_MONTH).toBeCloseTo(173.93, 2);
    expect(CONTINUOUS_HOURS_PER_MONTH).toBeCloseTo(730.5, 2);
    expect(requiredDecodeTps(volume.outputTokens, POWER_USER_HOURS_PER_MONTH)).toBeCloseTo(443.63, 1);
    expect(requiredDecodeTps(volume.outputTokens, CONTINUOUS_HOURS_PER_MONTH)).toBeCloseTo(105.63, 1);
  });

  test("sizes the default dense-32B RTX 5090 profile at ten cards for power-user hours", () => {
    expect(unitsRequired(443.63, 45)).toBe(10);
    expect(unitsRequired(105.63, 45)).toBe(3);
    expect(unitsRequired(0, 45)).toBe(1);
    expect(unitsRequired(99_999.99999999983, 999.9999999999982)).toBe(100);
  });

  test("depreciates ten street-price RTX 5090s to about 2,225 dollars a month with power", () => {
    const home = homeHardwareMonthlyCostUsd({
      amortizationMonths: 24,
      electricityUsdPerKwh: 0.1834,
      hoursPerMonth: POWER_USER_HOURS_PER_MONTH,
      residualValuePercent: 0,
      unitCount: 10,
      unitPriceUsd: 4_900,
      unitTdpWatts: 575,
    });
    expect(home.upfrontUsd).toBe(49_000);
    expect(home.depreciationMonthlyUsd).toBeCloseTo(2_041.67, 2);
    expect(home.residualValueUsd).toBe(0);
    expect(home.electricityMonthlyUsd).toBeCloseTo(183.42, 1);
    expect(home.totalMonthlyUsd).toBeCloseTo(2_225.08, 1);
  });

  test("a 20% resale value cuts the monthly depreciation to 1,633.33 dollars", () => {
    const home = homeHardwareMonthlyCostUsd({
      amortizationMonths: 24,
      electricityUsdPerKwh: 0.1834,
      hoursPerMonth: POWER_USER_HOURS_PER_MONTH,
      residualValuePercent: 20,
      unitCount: 10,
      unitPriceUsd: 4_900,
      unitTdpWatts: 575,
    });
    // 49,000 x 80% over 24 months; the 9,800 residual is a resale recovery, not a cost.
    expect(home.depreciationMonthlyUsd).toBeCloseTo(1_633.33, 2);
    expect(home.residualValueUsd).toBe(9_800);
    expect(home.totalMonthlyUsd).toBeCloseTo(1_633.33 + 183.42, 1);
  });

  test("prices the same fleet at Hawaii's 52.72 cents per kWh when the knob overrides the US average", () => {
    const scenario = computeCalculatorScenario(goldenSnapshot, {
      ...DEFAULT_CALCULATOR_KNOBS,
      dutyCycle: "powerUser",
      electricityCentsPerKwh: 52.72,
    });
    expect(scenario.home.electricityCentsPerKwh).toBe(52.72);
    // 10 units x 0.575 kW x 173.93 h x $0.5272 per kWh.
    expect(scenario.home.electricityMonthlyUsd).toBeCloseTo(527.25, 1);
    expect(scenario.home.depreciationMonthlyUsd).toBeCloseTo(2_041.67, 2);
  });

  test("follows the snapshot's US residential average when the electricity knob is null", () => {
    const scenario = computeCalculatorScenario(goldenSnapshot, {
      ...DEFAULT_CALCULATOR_KNOBS,
      dutyCycle: "powerUser",
    });
    expect(DEFAULT_CALCULATOR_KNOBS.electricityCentsPerKwh).toBeNull();
    expect(scenario.home.electricityCentsPerKwh).toBe(goldenSnapshot.electricity.usResidentialCentsPerKwh);
    expect(scenario.home.electricityMonthlyUsd).toBeCloseTo(183.42, 1);
  });

  test("rents ten RTX 5090s for about 939 dollars a month of power-user hours", () => {
    expect(rentalMonthlyCostUsd({
      hoursPerMonth: POWER_USER_HOURS_PER_MONTH,
      unitCount: 10,
      unitUsdPerHour: 0.54,
    })).toBeCloseTo(939.21, 1);
  });

  test("assembles the default scenario from the checked snapshot", () => {
    const scenario = computeCalculatorScenario(goldenSnapshot, DEFAULT_CALCULATOR_KNOBS);
    expect(scenario.spendUsd).toBe(8_000);
    expect(scenario.stickerUsd).toBe(200);
    expect(scenario.sol.breakdown.totalUsd).toBeCloseTo(8_000, 6);
    expect(scenario.deepSeek.offPeakUsd).toBeCloseTo(251.67, 2);
    // The default window is blended: off-peak x (1 + 35/168).
    expect(scenario.deepSeek.selectedUsd).toBe(scenario.deepSeek.blendedUsd);
    expect(scenario.deepSeek.selectedUsd).toBeCloseTo(304.10, 2);
    expect(scenario.profile.id).toBe("rtx-5090-dense-32b");
    // The default 24/7 duty cycle needs 3 cards instead of the power-user 10.
    expect(scenario.hoursPerMonth).toBeCloseTo(730.5, 2);
    expect(scenario.home.unitCount).toBe(3);
    expect(scenario.home.gpuCount).toBe(3);
    expect(scenario.home.upfrontUsd).toBe(14_700);
    expect(scenario.home.depreciationMonthlyUsd).toBeCloseTo(612.50, 2);
    expect(scenario.home.electricityMonthlyUsd).toBeCloseTo(231.10, 1);
    expect(scenario.home.totalMonthlyUsd).toBeCloseTo(843.60, 1);
    expect(scenario.rental.monthlyUsd).toBeCloseTo(1_183.41, 1);
    // Valuing the same promo-implied volume at list rates costs more.
    expect(scenario.sol.otherBasis).toBe("list");
    expect(scenario.sol.otherBasisUsd).toBeCloseTo(8_000 * 41 / 28.8, 1);
  });

  test("prices the list-basis valuation at 8,000 dollars by construction on list rates", () => {
    const scenario = computeCalculatorScenario(goldenSnapshot, {
      ...DEFAULT_CALCULATOR_KNOBS,
      solRateBasis: "list",
    });
    // 4 x (0.5 x $5 + 0.5 x $0.50) + $30 = $41 per 1M output tokens.
    expect(scenario.sol.breakdown.totalUsd).toBeCloseTo(8_000, 6);
    expect(scenario.volume.outputTokens).toBeCloseTo(8_000 / 41 * 1e6, 0);
    expect(scenario.sol.otherBasisUsd).toBeCloseTo(8_000 * 28.8 / 41, 1);
  });
});

describe("calculator defaults", () => {
  test("defaults to the blended DeepSeek window and the 24/7 duty cycle", () => {
    expect(DEFAULT_CALCULATOR_KNOBS.deepSeekWindow).toBe("blended");
    expect(DEFAULT_CALCULATOR_KNOBS.dutyCycle).toBe("continuous");
  });

  test("keeps the default subsidy knob equal to the snapshot's documented default", () => {
    expect(DEFAULT_CALCULATOR_KNOBS.subsidyMultiple)
      .toBe(CALCULATOR_INPUTS.subsidyAnchor.defaultMultiple);
  });

  test("defaults to a hardware profile that exists in the checked snapshot", () => {
    expect(CALCULATOR_INPUTS.hardware.profiles.some(
      profile => profile.id === DEFAULT_CALCULATOR_KNOBS.hardwareProfileId,
    )).toBe(true);
  });

  test("keeps the snapshot's US average and every electricity preset inside the knob band", () => {
    const bounds = CALCULATOR_KNOB_BOUNDS.electricityCentsPerKwh;
    const rates = [
      CALCULATOR_INPUTS.electricity.usResidentialCentsPerKwh,
      ...CALCULATOR_INPUTS.electricity.residentialPresets.map(preset => preset.centsPerKwh),
    ];
    for (const rate of rates) {
      expect(rate).toBeGreaterThanOrEqual(bounds.min);
      expect(rate).toBeLessThanOrEqual(bounds.max);
    }
  });
});

describe("calculator knob clamping", () => {
  test("clamps out-of-range knobs into their documented bounds", () => {
    const clamped = clampCalculatorKnobs({
      ...DEFAULT_CALCULATOR_KNOBS,
      amortizationMonths: 500,
      cacheHitPercent: 120,
      electricityCentsPerKwh: 400,
      inputTokensPerOutputToken: 0,
      residualValuePercent: 90,
      seats: -3,
      subsidyMultiple: 7,
      ultraMultiple: 99,
      utilizationPercent: 0,
    });
    expect(clamped.amortizationMonths).toBe(60);
    expect(clamped.cacheHitPercent).toBe(95);
    expect(clamped.electricityCentsPerKwh).toBe(60);
    expect(clamped.inputTokensPerOutputToken).toBe(1);
    expect(clamped.residualValuePercent).toBe(50);
    expect(clamped.seats).toBe(1);
    expect(clamped.subsidyMultiple).toBe(10);
    expect(clamped.ultraMultiple).toBe(10);
    expect(clamped.utilizationPercent).toBe(5);
  });

  test("keeps a null electricity knob null and clamps a too-cheap explicit rate up", () => {
    expect(clampCalculatorKnobs(DEFAULT_CALCULATOR_KNOBS).electricityCentsPerKwh).toBeNull();
    expect(clampCalculatorKnobs({
      ...DEFAULT_CALCULATOR_KNOBS,
      electricityCentsPerKwh: 0.1,
    }).electricityCentsPerKwh).toBe(1);
  });

  test("treats non-finite knob values as the lower bound", () => {
    const clamped = clampCalculatorKnobs({
      ...DEFAULT_CALCULATOR_KNOBS,
      seats: Number.NaN,
      subsidyMultiple: Number.POSITIVE_INFINITY,
    });
    expect(clamped.seats).toBe(1);
    expect(clamped.subsidyMultiple).toBe(100);
  });

  test("scales spend with seats, utilization, and the Ultra multiplier", () => {
    const scenario = computeCalculatorScenario(goldenSnapshot, {
      ...DEFAULT_CALCULATOR_KNOBS,
      seats: 3,
      ultraMultiple: 2,
      utilizationPercent: 50,
    });
    expect(scenario.spendUsd).toBe(3 * 200 * 40 * 0.5 * 2);
    expect(scenario.stickerUsd).toBe(600);
  });

  test("falls back to the first profile when the profile id is unknown", () => {
    const scenario = computeCalculatorScenario(goldenSnapshot, {
      ...DEFAULT_CALCULATOR_KNOBS,
      hardwareProfileId: "not-a-profile",
    });
    expect(scenario.profile.id).toBe(CALCULATOR_INPUTS.hardware.profiles[0]!.id);
  });

  test("uses the H100 rental path for profiles whose model cannot live in consumer VRAM", () => {
    const scenario = computeCalculatorScenario(goldenSnapshot, {
      ...DEFAULT_CALCULATOR_KNOBS,
      dutyCycle: "powerUser",
      hardwareProfileId: "dgx-spark-dense-70b",
    });
    expect(scenario.profile.rental.gpuId).toBe("h100-sxm");
    // 2.7 tok/s decode means a fleet: ceil(443.63 / 2.7) = 165 Sparks.
    expect(scenario.home.unitCount).toBe(165);
    expect(scenario.rental.unitCount).toBe(unitsRequired(scenario.requiredTps, 40));
  });
});

describe("duty cycles", () => {
  test("gives each duty cycle its documented monthly hours", () => {
    expect(dutyCycleHoursPerMonth("continuous")).toBeCloseTo(730.5, 2);
    expect(dutyCycleHoursPerMonth("powerUser")).toBeCloseTo(173.93, 2);
  });

  test("needs fewer units on the continuous duty cycle for the same volume", () => {
    const powerUser = computeCalculatorScenario(goldenSnapshot, {
      ...DEFAULT_CALCULATOR_KNOBS,
      dutyCycle: "powerUser",
    });
    const continuous = computeCalculatorScenario(goldenSnapshot, {
      ...DEFAULT_CALCULATOR_KNOBS,
      dutyCycle: "continuous",
    });
    expect(powerUser.home.unitCount).toBe(10);
    expect(continuous.home.unitCount).toBeLessThan(powerUser.home.unitCount);
    expect(continuous.home.unitCount).toBe(3);
  });
});

describe("useful-life checkpoints", () => {
  test("marks the quarters of the default 24-month life", () => {
    expect(usefulLifeCheckpointMonths(24)).toEqual([6, 12, 18, 24]);
    expect(usefulLifeCheckpointMonths(6)).toEqual([2, 3, 5, 6]);
  });

  test("always ends exactly at the useful life with ascending whole months", () => {
    const bounds = CALCULATOR_KNOB_BOUNDS.amortizationMonths;
    for (let months = bounds.min; months <= bounds.max; months += 1) {
      const checkpoints = usefulLifeCheckpointMonths(months);
      expect(checkpoints.at(-1)).toBe(months);
      expect(checkpoints.length).toBeGreaterThanOrEqual(1);
      expect(checkpoints.length).toBeLessThanOrEqual(4);
      for (const [index, month] of checkpoints.entries()) {
        expect(Number.isInteger(month)).toBe(true);
        expect(month).toBeGreaterThanOrEqual(1);
        if (index > 0) expect(month).toBeGreaterThan(checkpoints[index - 1]!);
      }
    }
  });
});
