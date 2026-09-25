import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { KERNEL_VECTOR_DIRECTORY, KERNEL_VECTOR_LAWS, KERNEL_VECTOR_MINIMUM_CASES, renderVectorFile, readVectorFile, type KernelVectorLaw, type VectorCase, type VectorInput } from "../../scripts/generate-kernel-vectors";
import { matchMetricQuantities, metricRatioRounded, type MetricRounding } from "./metric-explorer-values";
import { statsCheckedAddBounded, statsPriceMicrousd, statsTokenTotal, STATS_MAX_DECIMAL, STATS_U128_MAX } from "./stats-contract";
import { splitCacheWrites, totalTokens } from "./wire";

const root = resolve(import.meta.dir, "../..");
const big = (input: VectorInput): bigint => {
  if (typeof input !== "string" || !/^(0|[1-9][0-9]*)$/u.test(input)) throw new Error(`decimal_expected:${String(input)}`);
  return BigInt(input);
};
const list = (input: VectorInput): readonly VectorInput[] => {
  if (!Array.isArray(input)) throw new Error("list_expected");
  return input;
};
type Outcome = Readonly<{ ok: true; value: bigint }> | Readonly<{ ok: false; error: string }>;
function expectCase(law: KernelVectorLaw, index: number, item: VectorCase, actual: Outcome, exactError = true) {
  const [inputs, outcome, value] = item;
  const label = `${law} case ${index}: ${JSON.stringify(inputs)}`;
  if (outcome === "ok") {
    if (!actual.ok) throw new Error(`${label} expected ${value}, got error ${actual.error}`);
    if (actual.value !== BigInt(value)) throw new Error(`${label} expected ${value}, got ${actual.value}`);
  } else {
    if (actual.ok) throw new Error(`${label} expected error ${value}, got ${actual.value}`);
    if (exactError && actual.error !== value) throw new Error(`${label} expected error ${value}, got ${actual.error}`);
  }
}
async function run(law: KernelVectorLaw, evaluate: (inputs: readonly VectorInput[]) => Outcome, exactError = true) {
  const file = await readVectorFile(law);
  expect(file.cases.length).toBeGreaterThanOrEqual(KERNEL_VECTOR_MINIMUM_CASES);
  const outcomes = new Set<string>();
  file.cases.forEach((item, index) => { outcomes.add(item[1] === "ok" ? "ok" : item[2]); expectCase(law, index, item, evaluate(item[0]), exactError); });
  return outcomes;
}

describe("kernel differential vectors", () => {
  test("the checked-in vectors are the generator's deterministic output", async () => {
    for (const law of KERNEL_VECTOR_LAWS) {
      const file = await readVectorFile(law);
      const text = await readFile(resolve(root, KERNEL_VECTOR_DIRECTORY, `${law}.json`), "utf8");
      expect(renderVectorFile(law, file.cases)).toBe(text);
    }
  });

  test("wire token totals agree with the native kernel, including the 10^12 counter limit", async () => {
    const keys = ["inputUncached", "cacheRead", "cacheWrite5m", "cacheWrite1h", "output", "reasoningOutput"] as const;
    const outcomes = await run("wire-token-total", inputs => {
      const counters = inputs.map(big);
      // The shared wire contract folds every refusal into one code.
      if (counters.some(value => value > (1n << 64n) - 1n)) return { ok: false, error: "limit" };
      const tokens = Object.fromEntries(keys.map((key, index) => [key, counters[index]!]));
      const total = totalTokens(tokens);
      return total.ok ? { ok: true, value: total.value } : { ok: false, error: total.error };
    }, false);
    expect([...outcomes].sort()).toEqual(["invalid_partition", "limit", "ok"]);
  });

  test("bounded checked addition agrees with the native kernel at u128 and 24-digit edges", async () => {
    const outcomes = await run("checked-add-bounded", inputs => {
      const [left, right, limit] = inputs.map(big) as [bigint, bigint, bigint];
      const sum = statsCheckedAddBounded(left, right, limit);
      return sum.ok ? { ok: true, value: sum.value } : { ok: false, error: sum.error };
    });
    expect([...outcomes].sort()).toEqual(["limit", "ok", "overflow"]);
    expect(statsCheckedAddBounded(STATS_MAX_DECIMAL, 1n, STATS_MAX_DECIMAL)).toEqual({ ok: false, error: "limit" });
    expect(statsCheckedAddBounded(STATS_U128_MAX, 1n, STATS_U128_MAX)).toEqual({ ok: false, error: "overflow" });
    expect(statsTokenTotal({ input: "9".repeat(24), cacheRead: "9".repeat(24), cacheWrite: "9".repeat(24), output: "9".repeat(24), reasoning: "9".repeat(24) })).toBe(5n * STATS_MAX_DECIMAL);
  });

  test("cache TTL splits agree with the native kernel", async () => {
    const outcomes = await run("cache-ttl-split", inputs => {
      const [total, fiveMinute, oneHour] = inputs.map(big) as [bigint, bigint, bigint];
      const split = splitCacheWrites(total, fiveMinute, oneHour);
      return split.ok ? { ok: true, value: split.value.total } : { ok: false, error: split.error };
    }, false);
    expect([...outcomes].sort()).toEqual(["invalid_partition", "ok", "overflow"]);
  });

  test("exact ratio rounding agrees with the native kernel for every rule", async () => {
    const rules = new Set<string>();
    const outcomes = await run("exact-ratio-rounding", inputs => {
      const [numerator, denominator] = [big(inputs[0]!), big(inputs[1]!)];
      const rule = inputs[2];
      if (rule !== "floor" && rule !== "ceiling" && rule !== "half-up") throw new Error("rule");
      rules.add(rule);
      const rounded = metricRatioRounded(numerator, denominator, rule satisfies MetricRounding);
      return rounded.ok ? { ok: true, value: rounded.value } : { ok: false, error: rounded.error };
    });
    expect([...outcomes].sort()).toEqual(["ok", "zero_denominator"]);
    expect([...rules].sort()).toEqual(["ceiling", "floor", "half-up"]);
  });

  test("retail pricing agrees with the native kernel, including missing rates, overflow and the profile limit", async () => {
    const outcomes = await run("pricing-microusd", inputs => {
      const tokens = list(inputs[0]!).map(big) as [bigint, bigint, bigint, bigint, bigint];
      const rates = list(inputs[1]!).map(value => value === null ? null : big(value)) as [bigint | null, bigint | null, bigint | null, bigint | null, bigint | null];
      const price = statsPriceMicrousd(tokens, rates);
      return price.ok ? { ok: true, value: price.value } : { ok: false, error: price.error };
    });
    expect([...outcomes].sort()).toEqual(["limit", "missing_rate", "ok", "overflow"]);
  });
});

describe("matched cohort quantities", () => {
  const population = { identity: "reported-cost-cohort", unit: "records", grain: "aggregate-row" };
  const known = (value: bigint) => ({ population, evidence: { kind: "known", value, basis: "reported" } as const });
  test("a ratio needs two known quantities over one population", () => {
    expect(matchMetricQuantities(known(250_000n), known(165n))).toEqual({ ok: true, value: { left: 250_000n, right: 165n, leftBasis: "reported", rightBasis: "reported" } });
    expect(matchMetricQuantities(known(1n), { population, evidence: { kind: "unknown" } })).toEqual({ ok: false, error: "missing_evidence" });
    expect(matchMetricQuantities({ population, evidence: { kind: "unsupported" } }, known(1n))).toEqual({ ok: false, error: "missing_evidence" });
    for (const other of [{ ...population, identity: "estimated-cost-cohort" }, { ...population, unit: "tokens" }, { ...population, grain: "day" }]) {
      expect(matchMetricQuantities(known(1n), { ...known(2n), population: other })).toEqual({ ok: false, error: "population_mismatch" });
    }
    expect(metricRatioRounded(250_000n, 165n, "half-up")).toEqual({ ok: true, value: 1_515n });
    expect(metricRatioRounded(1n, 0n, "floor")).toEqual({ ok: false, error: "zero_denominator" });
  });
});
