import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Deterministic Rust/TypeScript differential vectors for the exact metric
 * kernel. Expectations come from this file's own plain BigInt references, so
 * the native kernel and the shared TypeScript evaluate the same cases against
 * a third implementation. `--check` refuses any drift from the checked-in
 * fixtures. No case is derived from private usage data. */
const root = resolve(import.meta.dir, "..");
export const KERNEL_VECTOR_DIRECTORY = "fixtures/usage/assurance/kernel-vectors";
export const KERNEL_VECTOR_SCHEMA_VERSION = 1;
export const KERNEL_VECTOR_LAWS = ["wire-token-total", "checked-add-bounded", "cache-ttl-split", "exact-ratio-rounding", "pricing-microusd"] as const;
export type KernelVectorLaw = typeof KERNEL_VECTOR_LAWS[number];
export const KERNEL_VECTOR_MINIMUM_CASES = 2_000;
const RANDOM_CASES = 2_048;

export const U64_MAX = (1n << 64n) - 1n;
export const U128_MAX = (1n << 128n) - 1n;
export const MAX_DECIMAL = 10n ** 24n - 1n;
export const MAX_WIRE_TOKEN_COUNTER = 1_000_000_000_000n;

export type VectorInput = string | null | readonly VectorInput[];
/** `[inputs, "ok", value]` or `[inputs, "err", code]`; every number is a decimal string. */
export type VectorCase = readonly [readonly VectorInput[], "ok" | "err", string];
export type VectorFile = Readonly<{ schemaVersion: 1; law: KernelVectorLaw; kernel: string; seed: string; cases: readonly VectorCase[] }>;

/** SplitMix64 over BigInt: deterministic on every platform, no float state. */
function generator(label: string) {
  let state = 0n;
  for (const byte of new TextEncoder().encode(`aicharts-kernel-vectors-v1/${label}`)) state = ((state * 1_099_511_628_211n) ^ BigInt(byte)) & U64_MAX;
  const next = () => {
    state = (state + 0x9e3779b97f4a7c15n) & U64_MAX;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & U64_MAX;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & U64_MAX;
    return z ^ (z >> 31n);
  };
  const below = (bound: bigint): bigint => {
    if (bound <= 1n) return 0n;
    let value = 0n;
    const words = Number((bound.toString(2).length + 63) / 64 | 0) + 1;
    for (let index = 0; index < words; index++) value = (value << 64n) | next();
    return value % bound;
  };
  /** A value spread over bit lengths, so edges and small numbers appear often. */
  const magnitude = (maxBits: number): bigint => {
    const bits = Number(below(BigInt(maxBits + 1)));
    if (bits === 0) return 0n;
    return (1n << BigInt(bits - 1)) + below(1n << BigInt(bits - 1));
  };
  const pick = <T,>(items: readonly T[]): T => items[Number(below(BigInt(items.length)))]!;
  return { next, below, magnitude, pick };
}

const ok = (value: bigint): readonly ["ok", string] => ["ok", value.toString()];
const err = (code: string): readonly ["err", string] => ["err", code];
const u128 = (value: bigint): readonly ["ok", string] | readonly ["err", string] => value > U128_MAX ? err("overflow") : ok(value);

export function referenceWireTokenTotal(counters: readonly bigint[]) {
  if (counters.some(value => value > MAX_WIRE_TOKEN_COUNTER)) return err("limit");
  if (counters[5]! > counters[4]!) return err("invalid_partition");
  const total = counters.slice(0, 5).reduce((sum, value) => sum + value, 0n);
  return total > U64_MAX ? err("overflow") : ok(total);
}
export function referenceCheckedAddBounded(left: bigint, right: bigint, limit: bigint) {
  const sum = left + right;
  if (sum > U128_MAX) return err("overflow");
  return sum > limit ? err("limit") : ok(sum);
}
export function referenceCacheTtlSplit(total: bigint, fiveMinute: bigint, oneHour: bigint) {
  const sum = fiveMinute + oneHour;
  if (sum > U128_MAX) return err("overflow");
  return sum === total ? ok(total) : err("invalid_partition");
}
export function referenceExactRatioRounding(numerator: bigint, denominator: bigint, rule: string) {
  if (denominator === 0n) return err("zero_denominator");
  const quotient = numerator / denominator, remainder = numerator % denominator;
  const increment = rule === "floor" ? false : rule === "ceiling" ? remainder !== 0n : 2n * remainder >= denominator;
  return u128(quotient + (increment ? 1n : 0n));
}
export function referencePriceMicrousd(tokens: readonly bigint[], rates: readonly (bigint | null)[]) {
  let pico = 0n;
  for (let index = 0; index < 5; index++) {
    const count = tokens[index]!;
    if (count === 0n) continue;
    const rate = rates[index];
    if (rate === null || rate === undefined) return err("missing_rate");
    const amount = count * rate;
    if (amount > U128_MAX) return err("overflow");
    pico += amount;
    if (pico > U128_MAX) return err("overflow");
  }
  if (pico + 500_000n > U128_MAX) return err("overflow");
  const rounded = (pico + 500_000n) / 1_000_000n;
  return rounded > MAX_DECIMAL ? err("limit") : ok(rounded);
}

const text = (value: bigint) => value.toString();
const texts = (values: readonly bigint[]) => values.map(text);

function wireCases(): VectorCase[] {
  const random = generator("wire-token-total");
  const limit = MAX_WIRE_TOKEN_COUNTER;
  const edges = [0n, 1n, limit - 1n, limit, limit + 1n, U64_MAX];
  const cases: bigint[][] = [
    [0n, 0n, 0n, 0n, 0n, 0n], [limit, limit, limit, limit, limit, limit], [limit, limit, limit, limit, limit, 0n],
    [limit + 1n, 0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n, limit + 1n], [0n, 0n, 0n, 0n, 1n, 2n], [0n, 0n, 0n, 0n, 0n, 1n],
    [U64_MAX, U64_MAX, U64_MAX, U64_MAX, U64_MAX, U64_MAX], [123n, 456n, 0n, 0n, 789n, 42n],
  ];
  for (let index = 0; index < 6; index++) for (const edge of edges) { const counters = [1n, 1n, 1n, 1n, 1n, 1n]; counters[index] = edge; cases.push(counters); }
  while (cases.length < RANDOM_CASES + 60) {
    const counters = Array.from({ length: 6 }, () => random.pick([0n, random.below(limit + 1n), random.magnitude(40), random.magnitude(64), random.pick(edges)]));
    if (random.below(4n) === 0n) counters[5] = random.below(counters[4]! + 1n);
    cases.push(counters);
  }
  return cases.map(counters => [[...texts(counters)], ...referenceWireTokenTotal(counters)]);
}
function checkedAddCases(): VectorCase[] {
  const random = generator("checked-add-bounded");
  const limits = [MAX_DECIMAL, U64_MAX, MAX_WIRE_TOKEN_COUNTER, U128_MAX, 0n, 1n, 10_000_000n];
  const cases: [bigint, bigint, bigint][] = [
    [0n, 0n, 0n], [U128_MAX, 0n, U128_MAX], [U128_MAX, 1n, U128_MAX], [1n, U128_MAX, U128_MAX], [U128_MAX - 1n, 1n, U128_MAX],
    [MAX_DECIMAL - 1n, 1n, MAX_DECIMAL], [MAX_DECIMAL, 1n, MAX_DECIMAL], [MAX_DECIMAL, 0n, MAX_DECIMAL], [MAX_DECIMAL, MAX_DECIMAL, U128_MAX],
    [U64_MAX, 0n, U64_MAX], [U64_MAX, 1n, U64_MAX], [U64_MAX - 1n, 1n, U64_MAX], [MAX_WIRE_TOKEN_COUNTER, 1n, MAX_WIRE_TOKEN_COUNTER],
    [1n << 127n, 1n << 127n, U128_MAX], [(1n << 127n) - 1n, 1n << 127n, U128_MAX],
  ];
  while (cases.length < RANDOM_CASES + 20) {
    const limit = random.pick([...limits, random.magnitude(128)]);
    const near = () => random.pick([random.magnitude(128), random.magnitude(64), random.magnitude(80), limit - random.below(3n), limit + random.below(3n), 0n]);
    const left = near(), right = near();
    if (left < 0n || right < 0n || left > U128_MAX || right > U128_MAX) continue;
    cases.push([left, right, limit]);
  }
  return cases.map(([left, right, limit]) => [[text(left), text(right), text(limit)], ...referenceCheckedAddBounded(left, right, limit)]);
}
function cacheTtlCases(): VectorCase[] {
  const random = generator("cache-ttl-split");
  const cases: [bigint, bigint, bigint][] = [
    [0n, 0n, 0n], [1n, 1n, 0n], [1n, 0n, 1n], [1n, 0n, 0n], [0n, 1n, 0n], [U128_MAX, U128_MAX, 0n], [U128_MAX, 0n, U128_MAX],
    [U128_MAX, U128_MAX, 1n], [0n, U128_MAX, 1n], [U128_MAX, (1n << 127n), (1n << 127n) - 1n], [2n * MAX_WIRE_TOKEN_COUNTER, MAX_WIRE_TOKEN_COUNTER, MAX_WIRE_TOKEN_COUNTER],
    [2n * MAX_DECIMAL, MAX_DECIMAL, MAX_DECIMAL], [MAX_DECIMAL, MAX_DECIMAL, 1n],
  ];
  while (cases.length < RANDOM_CASES + 16) {
    const five = random.pick([random.magnitude(128), random.magnitude(40), random.below(MAX_WIRE_TOKEN_COUNTER + 1n), 0n, U128_MAX - random.below(4n)]);
    const hour = random.pick([random.magnitude(128), random.magnitude(40), random.below(MAX_WIRE_TOKEN_COUNTER + 1n), 0n, U128_MAX - random.below(4n)]);
    const exact = five + hour;
    const total = random.pick([exact, exact, exact, exact > U128_MAX ? U128_MAX : exact, exact + 1n, exact === 0n ? 1n : exact - 1n, random.magnitude(128)]);
    if (total > U128_MAX) continue;
    cases.push([total, five, hour]);
  }
  return cases.map(([total, five, hour]) => [[text(total), text(five), text(hour)], ...referenceCacheTtlSplit(total, five, hour)]);
}
function ratioCases(): VectorCase[] {
  const random = generator("exact-ratio-rounding");
  const rules = ["floor", "ceiling", "half-up"] as const;
  const pairs: [bigint, bigint][] = [
    [0n, 1n], [1n, 1n], [1n, 2n], [3n, 2n], [1n, 3n], [2n, 3n], [5n, 10n], [15n, 10n], [0n, 0n], [7n, 0n], [U128_MAX, 0n],
    [U128_MAX, 1n], [U128_MAX, 2n], [U128_MAX, U128_MAX], [U128_MAX - 1n, U128_MAX], [1n, U128_MAX], [(1n << 127n), U128_MAX],
    [(1n << 127n) + 1n, U128_MAX], [MAX_DECIMAL, 1_000_000n], [MAX_DECIMAL, 3n], [10n ** 24n, 7n], [1n, 10n ** 24n],
  ];
  const cases: [bigint, bigint, string][] = [];
  for (const [numerator, denominator] of pairs) for (const rule of rules) cases.push([numerator, denominator, rule]);
  while (cases.length < RANDOM_CASES + pairs.length * 3) {
    const denominator = random.pick([random.magnitude(128), random.magnitude(8), random.magnitude(40), 0n, 1n, 2n, U128_MAX]);
    const numerator = random.pick([random.magnitude(128), random.magnitude(8), random.magnitude(40), 0n, U128_MAX, denominator * random.below(4n) + random.below(3n)]);
    if (numerator > U128_MAX) continue;
    cases.push([numerator, denominator, random.pick(rules)]);
  }
  return cases.map(([numerator, denominator, rule]) => [[text(numerator), text(denominator), rule], ...referenceExactRatioRounding(numerator, denominator, rule)]);
}
function pricingCases(): VectorCase[] {
  const random = generator("pricing-microusd");
  const rate = () => random.pick([null, 0n, 1n, 50_000n, 2_500_000n, 10_000_000n, 50_000_000n, random.magnitude(40), random.magnitude(128)]);
  const cases: [bigint[], (bigint | null)[]][] = [
    [[0n, 0n, 0n, 0n, 0n], [null, null, null, null, null]], [[1n, 0n, 0n, 0n, 0n], [null, null, null, null, null]],
    [[1_000_000n, 0n, 0n, 0n, 0n], [50_000n, null, null, null, null]], [[100n, 0n, 0n, 10n, 5n], [2_500_000n, null, null, 10_000_000n, 10_000_000n]],
    [[1n, 0n, 0n, 0n, 0n], [499_999n, null, null, null, null]], [[1n, 0n, 0n, 0n, 0n], [500_000n, null, null, null, null]],
    [[1n, 0n, 0n, 0n, 0n], [1_499_999n, null, null, null, null]], [[1n, 0n, 0n, 0n, 0n], [1_500_000n, null, null, null, null]],
    [[U128_MAX, 0n, 0n, 0n, 0n], [1n, null, null, null, null]], [[U128_MAX, 0n, 0n, 0n, 0n], [2n, null, null, null, null]],
    [[U128_MAX - 499_999n, 0n, 0n, 0n, 0n], [1n, null, null, null, null]], [[U128_MAX - 500_000n, 0n, 0n, 0n, 0n], [1n, null, null, null, null]],
    [[MAX_DECIMAL, 0n, 0n, 0n, 0n], [1_000_000n, null, null, null, null]], [[MAX_DECIMAL + 1n, 0n, 0n, 0n, 0n], [1_000_000n, null, null, null, null]],
    [[MAX_DECIMAL, 0n, 0n, 0n, 0n], [1_000_000n + 1n, null, null, null, null]], [[1n << 127n, 1n << 127n, 0n, 0n, 0n], [1n, 1n, null, null, null]],
    [[1n << 127n, (1n << 127n) - 1n, 0n, 0n, 0n], [1n, 1n, null, null, null]], [[MAX_WIRE_TOKEN_COUNTER, MAX_WIRE_TOKEN_COUNTER, MAX_WIRE_TOKEN_COUNTER, MAX_WIRE_TOKEN_COUNTER, MAX_WIRE_TOKEN_COUNTER], [10_000_000n, 1_000_000n, 12_500_000n, 50_000_000n, 50_000_000n]],
    [[0n, 0n, 0n, 0n, 1n], [null, null, null, null, 1n]], [[0n, 0n, 0n, 0n, 1n], [null, null, null, 1n, null]],
  ];
  while (cases.length < RANDOM_CASES + 20) {
    const tokens = Array.from({ length: 5 }, () => random.pick([0n, 0n, random.magnitude(20), random.below(MAX_WIRE_TOKEN_COUNTER + 1n), random.magnitude(80), random.magnitude(128), MAX_DECIMAL]));
    const rates = Array.from({ length: 5 }, rate);
    cases.push([tokens, rates]);
  }
  return cases.map(([tokens, rates]) => [[texts(tokens), rates.map(value => value === null ? null : text(value))], ...referencePriceMicrousd(tokens, rates)]);
}

const kernels: Record<KernelVectorLaw, string> = {
  "wire-token-total": "aicharts_metrics::wire_token_total", "checked-add-bounded": "aicharts_metrics::checked_add_bounded",
  "cache-ttl-split": "aicharts_metrics::CacheWrites::with_ttl", "exact-ratio-rounding": "aicharts_metrics::ExactRatio::rounded",
  "pricing-microusd": "aicharts_metrics::price_microusd",
};
const builders: Record<KernelVectorLaw, () => VectorCase[]> = {
  "wire-token-total": wireCases, "checked-add-bounded": checkedAddCases, "cache-ttl-split": cacheTtlCases,
  "exact-ratio-rounding": ratioCases, "pricing-microusd": pricingCases,
};

export function renderVectorFile(law: KernelVectorLaw, cases: readonly VectorCase[]) {
  if (cases.length < KERNEL_VECTOR_MINIMUM_CASES) throw new Error(`kernel_vectors_too_few:${law}`);
  const header = { schemaVersion: KERNEL_VECTOR_SCHEMA_VERSION, law, kernel: kernels[law], seed: `aicharts-kernel-vectors-v1/${law}`, count: cases.length };
  return `{\n  "schemaVersion": ${header.schemaVersion},\n  "law": ${JSON.stringify(law)},\n  "kernel": ${JSON.stringify(header.kernel)},\n  "seed": ${JSON.stringify(header.seed)},\n  "count": ${cases.length},\n  "cases": [\n${cases.map(item => `    ${JSON.stringify(item)}`).join(",\n")}\n  ]\n}\n`;
}
export function vectorPath(law: KernelVectorLaw) { return resolve(root, KERNEL_VECTOR_DIRECTORY, `${law}.json`); }
export async function readVectorFile(law: KernelVectorLaw): Promise<VectorFile> {
  const parsed = JSON.parse(await readFile(vectorPath(law), "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || !("cases" in parsed) || !Array.isArray(parsed.cases) || !("law" in parsed) || parsed.law !== law
    || !("schemaVersion" in parsed) || parsed.schemaVersion !== KERNEL_VECTOR_SCHEMA_VERSION || parsed.cases.length < KERNEL_VECTOR_MINIMUM_CASES) throw new Error(`kernel_vectors_invalid:${law}`);
  return parsed as VectorFile;
}

export async function generateKernelVectors(check = false) {
  const summary: Record<string, number> = {};
  await mkdir(resolve(root, KERNEL_VECTOR_DIRECTORY), { recursive: true });
  for (const law of KERNEL_VECTOR_LAWS) {
    const body = renderVectorFile(law, builders[law]());
    if (check) {
      if (await readFile(vectorPath(law), "utf8").catch(() => null) !== body) throw new Error(`kernel_vectors_stale:${law}`);
    } else await writeFile(vectorPath(law), body);
    summary[law] = builders[law]().length;
  }
  return summary;
}

if (import.meta.main) {
  try { console.log(JSON.stringify(await generateKernelVectors(process.argv.includes("--check")))); }
  catch (error) { console.error(error instanceof Error ? error.message : "kernel_vectors_generation_failed"); process.exitCode = 1; }
}
