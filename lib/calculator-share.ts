import {
  CALCULATOR_KNOB_BOUNDS,
  clampCalculatorKnobs,
  DEFAULT_CALCULATOR_KNOBS,
  type CalculatorKnobs,
  type DeepSeekWindow,
  type DutyCycle,
  type SolRateBasis,
} from "./calculator-math";

/**
 * Query-string codec for calculator knobs. Only values that differ from the
 * defaults are written, so the bare `/calculator` URL stays canonical and a
 * shared link carries exactly the assumptions someone changed.
 */
const NUMERIC_PARAMS = {
  amortizationMonths: "amortize",
  cacheHitPercent: "cache",
  inputTokensPerOutputToken: "mix",
  residualValuePercent: "resale",
  seats: "seats",
  subsidyMultiple: "subsidy",
  ultraMultiple: "ultra",
  utilizationPercent: "util",
} as const satisfies Record<Exclude<keyof typeof CALCULATOR_KNOB_BOUNDS, "electricityCentsPerKwh">, string>;

/** The electricity knob is nullable (null follows the snapshot), so it has its own codec path. */
const ELECTRICITY_PARAM = "kwh";

const SOL_RATE_BASES: readonly SolRateBasis[] = ["current", "list"];
const DEEPSEEK_WINDOWS: readonly DeepSeekWindow[] = ["offPeak", "peak", "blended"];
const DUTY_CYCLES: readonly DutyCycle[] = ["powerUser", "continuous"];

export const CALCULATOR_PARAM_KEYS = [
  ...Object.values(NUMERIC_PARAMS),
  ELECTRICITY_PARAM,
  "sol",
  "deepseek",
  "duty",
  "profile",
] as const;

function readNumber(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readOneOf<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[], fallback: T): T {
  const raw = params.get(key);
  return allowed.find(value => value === raw) ?? fallback;
}

function readNullableNumber(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Parse knobs from a query string; unknown, malformed, or out-of-range values fall back per knob. */
export function calculatorKnobsFromSearch(search: string, profileIds: readonly string[]): CalculatorKnobs {
  const params = new URLSearchParams(search);
  const defaults = DEFAULT_CALCULATOR_KNOBS;
  const requestedProfile = params.get("profile");
  return clampCalculatorKnobs({
    amortizationMonths: readNumber(params, NUMERIC_PARAMS.amortizationMonths, defaults.amortizationMonths),
    cacheHitPercent: readNumber(params, NUMERIC_PARAMS.cacheHitPercent, defaults.cacheHitPercent),
    deepSeekWindow: readOneOf(params, "deepseek", DEEPSEEK_WINDOWS, defaults.deepSeekWindow),
    dutyCycle: readOneOf(params, "duty", DUTY_CYCLES, defaults.dutyCycle),
    electricityCentsPerKwh: readNullableNumber(params, ELECTRICITY_PARAM),
    hardwareProfileId: requestedProfile !== null && profileIds.includes(requestedProfile)
      ? requestedProfile
      : defaults.hardwareProfileId,
    inputTokensPerOutputToken: readNumber(params, NUMERIC_PARAMS.inputTokensPerOutputToken, defaults.inputTokensPerOutputToken),
    residualValuePercent: readNumber(params, NUMERIC_PARAMS.residualValuePercent, defaults.residualValuePercent),
    seats: readNumber(params, NUMERIC_PARAMS.seats, defaults.seats),
    solRateBasis: readOneOf(params, "sol", SOL_RATE_BASES, defaults.solRateBasis),
    subsidyMultiple: readNumber(params, NUMERIC_PARAMS.subsidyMultiple, defaults.subsidyMultiple),
    ultraMultiple: readNumber(params, NUMERIC_PARAMS.ultraMultiple, defaults.ultraMultiple),
    utilizationPercent: readNumber(params, NUMERIC_PARAMS.utilizationPercent, defaults.utilizationPercent),
  });
}

/** Serialize non-default knobs, preserving unrelated parameters already in `currentSearch`. */
export function calculatorKnobsSearch(knobs: CalculatorKnobs, currentSearch = ""): string {
  const params = new URLSearchParams(currentSearch);
  for (const key of CALCULATOR_PARAM_KEYS) params.delete(key);
  const defaults = DEFAULT_CALCULATOR_KNOBS;
  for (const [knob, key] of Object.entries(NUMERIC_PARAMS) as [keyof typeof NUMERIC_PARAMS, string][]) {
    if (knobs[knob] !== defaults[knob]) params.set(key, String(knobs[knob]));
  }
  if (knobs.electricityCentsPerKwh !== null) params.set(ELECTRICITY_PARAM, String(knobs.electricityCentsPerKwh));
  if (knobs.solRateBasis !== defaults.solRateBasis) params.set("sol", knobs.solRateBasis);
  if (knobs.deepSeekWindow !== defaults.deepSeekWindow) params.set("deepseek", knobs.deepSeekWindow);
  if (knobs.dutyCycle !== defaults.dutyCycle) params.set("duty", knobs.dutyCycle);
  if (knobs.hardwareProfileId !== defaults.hardwareProfileId) params.set("profile", knobs.hardwareProfileId);
  return params.toString();
}

export function calculatorKnobsEqual(a: CalculatorKnobs, b: CalculatorKnobs): boolean {
  return (Object.keys(DEFAULT_CALCULATOR_KNOBS) as (keyof CalculatorKnobs)[]).every(key => a[key] === b[key]);
}
