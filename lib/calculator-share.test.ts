import { describe, expect, test } from "bun:test";
import { assertProperty, fc } from "./property-test";
import { CALCULATOR_INPUTS } from "./calculator-inputs-collection";
import {
  CALCULATOR_KNOB_BOUNDS,
  DEFAULT_CALCULATOR_KNOBS,
  type CalculatorKnobs,
} from "./calculator-math";
import { calculatorKnobsEqual, calculatorKnobsFromSearch, calculatorKnobsSearch } from "./calculator-share";

const profileIds = CALCULATOR_INPUTS.hardware.profiles.map(profile => profile.id);

function steps(bounds: { min: number; max: number; step: number }) {
  return fc.integer({ min: 0, max: Math.round((bounds.max - bounds.min) / bounds.step) })
    .map(index => bounds.min + index * bounds.step);
}

const knobsArbitrary: fc.Arbitrary<CalculatorKnobs> = fc.record({
  amortizationMonths: steps(CALCULATOR_KNOB_BOUNDS.amortizationMonths),
  cacheHitPercent: steps(CALCULATOR_KNOB_BOUNDS.cacheHitPercent),
  deepSeekWindow: fc.constantFrom("offPeak", "peak", "blended"),
  dutyCycle: fc.constantFrom("powerUser", "continuous"),
  electricityCentsPerKwh: fc.oneof(
    fc.constant(null),
    steps(CALCULATOR_KNOB_BOUNDS.electricityCentsPerKwh),
  ),
  hardwareProfileId: fc.constantFrom(...profileIds),
  inputTokensPerOutputToken: steps(CALCULATOR_KNOB_BOUNDS.inputTokensPerOutputToken),
  residualValuePercent: steps(CALCULATOR_KNOB_BOUNDS.residualValuePercent),
  seats: steps(CALCULATOR_KNOB_BOUNDS.seats),
  solRateBasis: fc.constantFrom("current", "list"),
  subsidyMultiple: steps(CALCULATOR_KNOB_BOUNDS.subsidyMultiple),
  ultraMultiple: steps(CALCULATOR_KNOB_BOUNDS.ultraMultiple),
  utilizationPercent: steps(CALCULATOR_KNOB_BOUNDS.utilizationPercent),
});

describe("calculator share codec", () => {
  test("defaults serialize to an empty query and parse back from one", () => {
    expect(calculatorKnobsSearch(DEFAULT_CALCULATOR_KNOBS)).toBe("");
    expect(calculatorKnobsFromSearch("", profileIds)).toEqual(DEFAULT_CALCULATOR_KNOBS);
    expect(calculatorKnobsFromSearch("?utm_source=x", profileIds)).toEqual(DEFAULT_CALCULATOR_KNOBS);
  });

  test("only changed knobs are written, with short stable keys", () => {
    const search = calculatorKnobsSearch({
      ...DEFAULT_CALCULATOR_KNOBS,
      dutyCycle: "powerUser",
      hardwareProfileId: "dgx-spark-moe",
      seats: 5,
      solRateBasis: "list",
      subsidyMultiple: 70,
    });
    expect(search).toBe("seats=5&subsidy=70&sol=list&duty=powerUser&profile=dgx-spark-moe");
  });

  test("the blended DeepSeek window and 24/7 duty cycle are the unwritten defaults", () => {
    expect(calculatorKnobsSearch({
      ...DEFAULT_CALCULATOR_KNOBS,
      deepSeekWindow: "blended",
      dutyCycle: "continuous",
    })).toBe("");
    expect(calculatorKnobsFromSearch("", profileIds).deepSeekWindow).toBe("blended");
    expect(calculatorKnobsFromSearch("", profileIds).dutyCycle).toBe("continuous");
  });

  test("unrelated parameters survive and stale knob keys are replaced", () => {
    const search = calculatorKnobsSearch({ ...DEFAULT_CALCULATOR_KNOBS, seats: 3 }, "?ref=newsletter&seats=9&ultra=4");
    expect(search).toBe("ref=newsletter&seats=3");
  });

  test("malformed, unknown, and out-of-range values fall back per knob", () => {
    const parsed = calculatorKnobsFromSearch(
      "?seats=abc&subsidy=999&cache=-5&mix=2.5&sol=free&deepseek=peak&duty=always&profile=not-a-gpu&amortize=13",
      profileIds,
    );
    expect(parsed).toEqual({
      ...DEFAULT_CALCULATOR_KNOBS,
      amortizationMonths: 13,
      cacheHitPercent: 0,
      deepSeekWindow: "peak",
      inputTokensPerOutputToken: 2.5,
      subsidyMultiple: 100,
    });
  });

  test("the electricity knob follows the snapshot unless the link sets a rate", () => {
    expect(calculatorKnobsFromSearch("", profileIds).electricityCentsPerKwh).toBeNull();
    expect(calculatorKnobsFromSearch("?kwh=", profileIds).electricityCentsPerKwh).toBeNull();
    expect(calculatorKnobsFromSearch("?kwh=abc", profileIds).electricityCentsPerKwh).toBeNull();
    expect(calculatorKnobsFromSearch("?kwh=52.72", profileIds).electricityCentsPerKwh).toBe(52.72);
    expect(calculatorKnobsFromSearch("?kwh=999", profileIds).electricityCentsPerKwh).toBe(60);
    expect(calculatorKnobsSearch({ ...DEFAULT_CALCULATOR_KNOBS, electricityCentsPerKwh: 8.1 })).toBe("kwh=8.1");
    expect(calculatorKnobsSearch({ ...DEFAULT_CALCULATOR_KNOBS, residualValuePercent: 20 })).toBe("resale=20");
  });

  test("a profile id is only accepted when the snapshot defines it", () => {
    expect(calculatorKnobsFromSearch("?profile=dgx-spark-moe", profileIds).hardwareProfileId).toBe("dgx-spark-moe");
    expect(calculatorKnobsFromSearch("?profile=dgx-spark-moe", []).hardwareProfileId).toBe(DEFAULT_CALCULATOR_KNOBS.hardwareProfileId);
  });

  test("every valid knob state round-trips through the query string", () => {
    assertProperty(fc.property(knobsArbitrary, (knobs) => {
      const search = calculatorKnobsSearch(knobs);
      const parsed = calculatorKnobsFromSearch(search === "" ? "" : `?${search}`, profileIds);
      expect(calculatorKnobsEqual(parsed, knobs)).toBe(true);
      expect(calculatorKnobsSearch(parsed)).toBe(search);
    }));
  });

  test("parsing never throws and always yields in-bounds knobs", () => {
    assertProperty(fc.property(fc.webQueryParameters(), (query) => {
      const parsed = calculatorKnobsFromSearch(`?${query}`, profileIds);
      for (const [key, bounds] of Object.entries(CALCULATOR_KNOB_BOUNDS)) {
        const value = parsed[key as keyof typeof CALCULATOR_KNOB_BOUNDS];
        // The electricity knob alone may be null: it then follows the snapshot.
        if (value === null) {
          expect(key).toBe("electricityCentsPerKwh");
          continue;
        }
        expect(value).toBeGreaterThanOrEqual(bounds.min);
        expect(value).toBeLessThanOrEqual(bounds.max);
      }
      expect(profileIds).toContain(parsed.hardwareProfileId);
    }));
  });
});
