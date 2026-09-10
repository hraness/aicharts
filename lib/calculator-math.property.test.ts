import { describe, expect, test } from "bun:test";
import { assertProperty, fc } from "./property-test";
import { CALCULATOR_INPUTS } from "./calculator-inputs-collection";
import {
  apiCostBreakdownUsd,
  computeCalculatorScenario,
  costPerMillionOutputTokensUsd,
  DEFAULT_CALCULATOR_KNOBS,
  deepSeekRateCard,
  monthlyTokenVolume,
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

describe("calculator math laws", () => {
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
      expect(volume.cachedInputTokens + volume.missedInputTokens).toBeCloseTo(volume.inputTokens, 5);
      expect(volume.inputTokens + volume.outputTokens).toBeCloseTo(volume.totalTokens, 5);
      expect(volume.outputTokens).toBeGreaterThan(0);
    }));
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
      hardwareProfileId: fc.oneof(
        fc.constantFrom(...CALCULATOR_INPUTS.hardware.profiles.map(profile => profile.id)),
        fc.constant("unknown-profile"),
      ),
      inputTokensPerOutputToken: fc.double({ min: -5, max: 100, noNaN: true }),
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

  test("DeepSeek off-peak stays cheaper than Sol for the same volume across the knob space", () => {
    assertProperty(fc.property(
      fc.double({ min: 0, max: 0.95, noNaN: true }),
      fc.double({ min: 1, max: 10, noNaN: true }),
      (cacheHitRate, ratio) => {
        const scenario = computeCalculatorScenario(CALCULATOR_INPUTS, {
          ...DEFAULT_CALCULATOR_KNOBS,
          cacheHitPercent: cacheHitRate * 100,
          inputTokensPerOutputToken: ratio,
        });
        expect(scenario.deepSeek.peakUsd).toBeLessThan(scenario.sol.breakdown.totalUsd);
      },
    ));
  });
});
