import { describe, expect, test } from "bun:test";
import { assertProperty, fc } from "./property-test";
import { CALCULATOR_INPUTS } from "./calculator-inputs-collection";
import { goldenCalculatorSnapshot } from "./calculator-golden-fixture";
import {
  apiCostBreakdownUsd,
  computeCalculatorScenario,
  costPerMillionOutputTokensUsd,
  DEFAULT_CALCULATOR_KNOBS,
  deepSeekRateCard,
  homeHardwareMonthlyCostUsd,
  monthlyTokenVolume,
  requiredDecodeTps,
  unitsRequired,
  type DeepSeekWindow,
  type DutyCycle,
  type SolRateBasis,
} from "./calculator-math";

const rateArbitrary = fc.record({
  cachedInputPerMillion: fc.double({ min: 0.001, max: 1, noNaN: true }),
  inputPerMillion: fc.double({ min: 1, max: 50, noNaN: true }),
  outputPerMillion: fc.double({ min: 1, max: 200, noNaN: true }),
});

const mixArbitrary = fc.record({
  cacheHitRate: fc.double({ min: 0, max: 0.95, noNaN: true }),
  inputTokensPerOutputToken: fc.double({ min: 0.25, max: 10, noNaN: true }),
});

const spendArbitrary = fc.double({ min: 1, max: 10_000_000, noNaN: true });

// Aggregate seed -1365318893: one ULP is 0.00000762939453125 tokens here,
// already larger than toBeCloseTo(..., 5)'s fixed 0.000005 threshold.
const tokenPartitionRegression = {
  spend: 266361.6942354667,
  rates: { cachedInputPerMillion: 0.001, inputPerMillion: 1, outputPerMillion: 9.315700790085847 },
  mix: { cacheHitRate: 0.1636827348813723, inputTokensPerOutputToken: 2.288866236338236 },
} as const;

function withinOneNonnegativeUlp(actual: number, expected: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || actual < 0 || expected < 0) return false;
  if (actual === expected) return true;
  // Positive binary64 encodings are ordered. Comparing adjacent encodings avoids
  // a decimal tolerance that is too tight at large scales or too loose at small ones.
  const bits = new DataView(new ArrayBuffer(16));
  bits.setFloat64(0, actual);
  bits.setFloat64(8, expected);
  const distance = bits.getBigUint64(0) - bits.getBigUint64(8);
  return distance >= -1n && distance <= 1n;
}

describe("calculator math laws", () => {
  test("integer token budgets require the exact ceiling fleet after converting hours to seconds", () => {
    assertProperty(fc.property(
      fc.integer({ min: 0, max: 2_000_000_000 }),
      fc.integer({ min: 1, max: 744 }),
      fc.integer({ min: 1, max: 10_000 }),
      (tokens, hours, tokensPerSecond) => {
        const capacity = BigInt(hours) * 3_600n * BigInt(tokensPerSecond);
        const required = (BigInt(tokens) + capacity - 1n) / capacity;
        const expected = Number(required < 1n ? 1n : required);
        expect(unitsRequired(requiredDecodeTps(tokens, hours), tokensPerSecond)).toBe(expected);
      },
    ));
  });

  test("electricity converts integer watt-hours and cents to the independent exact rational dollars", () => {
    assertProperty(fc.property(
      fc.record({
        units: fc.integer({ min: 1, max: 1_000 }),
        watts: fc.integer({ min: 50, max: 2_000 }),
        hours: fc.integer({ min: 1, max: 744 }),
        centsPerKwh: fc.integer({ min: 1, max: 60 }),
      }),
      ({ units, watts, hours, centsPerKwh }) => {
        const expectedNumerator = BigInt(units) * BigInt(watts) * BigInt(hours) * BigInt(centsPerKwh);
        // 1,000 Wh/kWh × 100 cents/dollar. This oracle does no staged float multiplication.
        const expected = Number(expectedNumerator) / 100_000;
        const actual = homeHardwareMonthlyCostUsd({
          unitCount: units, unitTdpWatts: watts, hoursPerMonth: hours,
          electricityUsdPerKwh: centsPerKwh / 100,
          unitPriceUsd: 1_000, amortizationMonths: 24, residualValuePercent: 0,
        }).electricityMonthlyUsd;
        expect(Math.abs(actual - expected)).toBeLessThanOrEqual(8 * Number.EPSILON * expected);
      },
    ));
  });

  test("pricing the implied volume on the valuation rates returns the spend", () => {
    assertProperty(fc.property(spendArbitrary, rateArbitrary, mixArbitrary, (spend, rates, mix) => {
      const volume = monthlyTokenVolume(spend, rates, mix);
      const roundTrip = apiCostBreakdownUsd(volume, rates).totalUsd;
      expect(roundTrip).toBeCloseTo(spend, 5);
    }));
  });

  test("token volume components always reconcile", () => {
    assertProperty(fc.property(spendArbitrary, rateArbitrary, mixArbitrary, (spend, rates, mix) => {
      const volume = monthlyTokenVolume(spend, rates, mix);
      // For 0 <= cached <= input, rounded (input - cached) + cached can differ
      // from input by at most one representable binary64 step.
      expect(volume.cachedInputTokens).toBeGreaterThanOrEqual(0);
      expect(volume.cachedInputTokens).toBeLessThanOrEqual(volume.inputTokens);
      expect(volume.missedInputTokens).toBeGreaterThanOrEqual(0);
      expect(withinOneNonnegativeUlp(volume.cachedInputTokens + volume.missedInputTokens, volume.inputTokens)).toBe(true);
      // Both sides use the same addition, with no intervening rounding step.
      expect(volume.inputTokens + volume.outputTokens).toBe(volume.totalTokens);
      expect(volume.outputTokens).toBeGreaterThan(0);
    }), { examples: [[tokenPartitionRegression.spend, tokenPartitionRegression.rates, tokenPartitionRegression.mix]] });
  });

  test("token reconciliation accepts one binary step but rejects material and nonfinite discrepancies", () => {
    const { spend, rates, mix } = tokenPartitionRegression;
    const volume = monthlyTokenVolume(spend, rates, mix);
    const recombined = volume.cachedInputTokens + volume.missedInputTokens;
    expect(recombined - volume.inputTokens).toBe(2 ** -17);
    expect(withinOneNonnegativeUlp(recombined, volume.inputTokens)).toBe(true);
    expect(withinOneNonnegativeUlp(volume.inputTokens + 2 ** -16, volume.inputTokens)).toBe(false);
    for (const total of [1, volume.inputTokens, 1e14]) {
      expect(withinOneNonnegativeUlp(total, total)).toBe(true);
      expect(withinOneNonnegativeUlp(total + 1, total)).toBe(false);
    }
    // Adjacent representable steps differ in size on either side of a power of two.
    expect(withinOneNonnegativeUlp(1 + Number.EPSILON, 1)).toBe(true);
    expect(withinOneNonnegativeUlp(1 - Number.EPSILON / 2, 1)).toBe(true);
    expect(withinOneNonnegativeUlp(1 + 2 * Number.EPSILON, 1)).toBe(false);
    expect(withinOneNonnegativeUlp(1 - Number.EPSILON, 1)).toBe(false);
    for (const invalid of [NaN, Infinity, -Infinity, -1]) {
      expect(withinOneNonnegativeUlp(invalid, invalid)).toBe(false);
      expect(withinOneNonnegativeUlp(invalid, 1)).toBe(false);
      expect(withinOneNonnegativeUlp(1, invalid)).toBe(false);
    }
  });

  test("a higher cache-hit rate never raises the cost of one million output tokens", () => {
    assertProperty(fc.property(
      rateArbitrary,
      fc.double({ min: 0.25, max: 10, noNaN: true }),
      fc.double({ min: 0, max: 0.95, noNaN: true }),
      fc.double({ min: 0, max: 0.95, noNaN: true }),
      (rates, ratio, hitA, hitB) => {
        const [lower, higher] = hitA <= hitB ? [hitA, hitB] : [hitB, hitA];
        const costAtLower = costPerMillionOutputTokensUsd(rates, {
          cacheHitRate: lower,
          inputTokensPerOutputToken: ratio,
        });
        const costAtHigher = costPerMillionOutputTokensUsd(rates, {
          cacheHitRate: higher,
          inputTokensPerOutputToken: ratio,
        });
        expect(costAtHigher).toBeLessThanOrEqual(costAtLower + 1e-9);
      },
    ));
  });

  test("unit counts cover the required throughput with the smallest whole fleet", () => {
    assertProperty(fc.property(
      fc.double({ min: 0, max: 100_000, noNaN: true }),
      fc.double({ min: 0.1, max: 1_000, noNaN: true }),
      (requiredTps, unitTps) => {
        const units = unitsRequired(requiredTps, unitTps);
        expect(units).toBeGreaterThanOrEqual(1);
        expect(units * unitTps).toBeGreaterThanOrEqual(requiredTps - 1e-9);
        if (units > 1) expect((units - 1) * unitTps).toBeLessThan(requiredTps);
      },
    ));
  });

  test("the blended DeepSeek card sits between off-peak and peak on every rate", () => {
    const pricing = CALCULATOR_INPUTS.deepSeekApiPricing;
    const offPeak = deepSeekRateCard(pricing, "offPeak");
    const peak = deepSeekRateCard(pricing, "peak");
    const blended = deepSeekRateCard(pricing, "blended");
    for (const field of ["cachedInputPerMillion", "inputPerMillion", "outputPerMillion"] as const) {
      expect(blended[field]).toBeGreaterThanOrEqual(offPeak[field]);
      expect(blended[field]).toBeLessThanOrEqual(peak[field]);
    }
  });

  test("every knob combination yields finite, nonnegative scenario costs", () => {
    const knobsArbitrary = fc.record({
      amortizationMonths: fc.double({ min: -10, max: 1_000, noNaN: true }),
      cacheHitPercent: fc.double({ min: -50, max: 200, noNaN: true }),
      deepSeekWindow: fc.constantFrom<DeepSeekWindow>("offPeak", "peak", "blended"),
      dutyCycle: fc.constantFrom<DutyCycle>("powerUser", "continuous"),
      electricityCentsPerKwh: fc.oneof(
        fc.constant(null),
        fc.double({ min: -50, max: 500, noNaN: true }),
      ),
      hardwareProfileId: fc.oneof(
        fc.constantFrom(...CALCULATOR_INPUTS.hardware.profiles.map(profile => profile.id)),
        fc.constant("unknown-profile"),
      ),
      inputTokensPerOutputToken: fc.double({ min: -5, max: 100, noNaN: true }),
      residualValuePercent: fc.double({ min: -50, max: 200, noNaN: true }),
      seats: fc.double({ min: -10, max: 10_000, noNaN: true }),
      solRateBasis: fc.constantFrom<SolRateBasis>("current", "list"),
      subsidyMultiple: fc.double({ min: -10, max: 1_000, noNaN: true }),
      ultraMultiple: fc.double({ min: -10, max: 100, noNaN: true }),
      utilizationPercent: fc.double({ min: -10, max: 500, noNaN: true }),
    });
    assertProperty(fc.property(knobsArbitrary, (knobs) => {
      const scenario = computeCalculatorScenario(CALCULATOR_INPUTS, knobs);
      const totals = [
        scenario.spendUsd,
        scenario.stickerUsd,
        scenario.sol.breakdown.totalUsd,
        scenario.sol.otherBasisUsd,
        scenario.deepSeek.selectedUsd,
        scenario.home.depreciationMonthlyUsd,
        scenario.home.electricityMonthlyUsd,
        scenario.home.residualValueUsd,
        scenario.home.totalMonthlyUsd,
        scenario.home.upfrontUsd,
        scenario.rental.monthlyUsd,
        scenario.requiredTps,
      ];
      for (const value of totals) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      expect(Number.isSafeInteger(scenario.home.unitCount)).toBe(true);
      expect(scenario.home.unitCount).toBeGreaterThanOrEqual(1);
      expect(scenario.rental.unitCount).toBeGreaterThanOrEqual(1);
    }));
  });

  test("a higher resale value never raises the monthly ownership cost", () => {
    const goldenSnapshot = goldenCalculatorSnapshot();
    assertProperty(fc.property(
      fc.double({ min: 0, max: 50, noNaN: true }),
      fc.double({ min: 0, max: 50, noNaN: true }),
      (residualA, residualB) => {
        const [lower, higher] = residualA <= residualB ? [residualA, residualB] : [residualB, residualA];
        const atLower = computeCalculatorScenario(goldenSnapshot, {
          ...DEFAULT_CALCULATOR_KNOBS,
          residualValuePercent: lower,
        });
        const atHigher = computeCalculatorScenario(goldenSnapshot, {
          ...DEFAULT_CALCULATOR_KNOBS,
          residualValuePercent: higher,
        });
        expect(atHigher.home.totalMonthlyUsd).toBeLessThanOrEqual(atLower.home.totalMonthlyUsd + 1e-9);
        expect(atHigher.home.electricityMonthlyUsd).toBeCloseTo(atLower.home.electricityMonthlyUsd, 6);
      },
    ));
  });

  test("depreciation plus residual always reconciles to the purchase price", () => {
    const goldenSnapshot = goldenCalculatorSnapshot();
    assertProperty(fc.property(
      fc.double({ min: 0, max: 50, noNaN: true }),
      fc.integer({ min: 6, max: 60 }),
      (residualValuePercent, amortizationMonths) => {
        const scenario = computeCalculatorScenario(goldenSnapshot, {
          ...DEFAULT_CALCULATOR_KNOBS,
          amortizationMonths,
          residualValuePercent,
        });
        const depreciatedTotal = scenario.home.depreciationMonthlyUsd * amortizationMonths;
        expect(depreciatedTotal + scenario.home.residualValueUsd).toBeCloseTo(scenario.home.upfrontUsd, 5);
      },
    ));
  });

  test("a higher electricity rate never lowers the monthly ownership cost", () => {
    const goldenSnapshot = goldenCalculatorSnapshot();
    assertProperty(fc.property(
      fc.double({ min: 1, max: 60, noNaN: true }),
      fc.double({ min: 1, max: 60, noNaN: true }),
      (rateA, rateB) => {
        const [lower, higher] = rateA <= rateB ? [rateA, rateB] : [rateB, rateA];
        const atLower = computeCalculatorScenario(goldenSnapshot, {
          ...DEFAULT_CALCULATOR_KNOBS,
          electricityCentsPerKwh: lower,
        });
        const atHigher = computeCalculatorScenario(goldenSnapshot, {
          ...DEFAULT_CALCULATOR_KNOBS,
          electricityCentsPerKwh: higher,
        });
        expect(atHigher.home.totalMonthlyUsd).toBeGreaterThanOrEqual(atLower.home.totalMonthlyUsd - 1e-9);
        expect(atHigher.home.depreciationMonthlyUsd).toBeCloseTo(atLower.home.depreciationMonthlyUsd, 6);
      },
    ));
  });

  test("DeepSeek off-peak stays cheaper than Sol for the same volume across the knob space", () => {
    const goldenSnapshot = goldenCalculatorSnapshot();
    assertProperty(fc.property(
      fc.double({ min: 0, max: 0.95, noNaN: true }),
      fc.double({ min: 1, max: 10, noNaN: true }),
      (cacheHitRate, ratio) => {
        const scenario = computeCalculatorScenario(goldenSnapshot, {
          ...DEFAULT_CALCULATOR_KNOBS,
          cacheHitPercent: cacheHitRate * 100,
          inputTokensPerOutputToken: ratio,
        });
        expect(scenario.deepSeek.peakUsd).toBeLessThan(scenario.sol.breakdown.totalUsd);
      },
    ));
  });
});
