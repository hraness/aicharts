/** Synthetic schedules only. These seeds are part of the reviewed test input. */
export const CONFORMANCE_SEEDS = [0x104729, 0x20260923, 0x5eedc0de] as const;

/** Deterministic, explicitly non-cryptographic schedule generation. */
export function scheduleRandom(seed: number): (bound: number) => number {
  let state = seed >>> 0;
  return bound => {
    if (!Number.isInteger(bound) || bound <= 0 || bound > 1_000_000) throw new Error("invalid_schedule_bound");
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) % bound;
  };
}

export function scheduleShuffle<T>(seed: number, values: readonly T[]): T[] {
  const output = [...values], random = scheduleRandom(seed);
  for (let index = output.length - 1; index > 0; index--) {
    const other = random(index + 1); [output[index], output[other]] = [output[other], output[index]];
  }
  return output;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

export type ConformanceStep = Readonly<{ command: string; input: unknown; outcome: string; expected: unknown; actual: unknown }>;

/** Compare every actual transition, never just the final happy-path total.
 * Failure markers distinguish semantic counterexamples from compiler/runtime
 * setup failures in an isolated production-mutation run. */
export class ConformanceTrace {
  readonly steps: ConformanceStep[] = [];
  readonly coverage = new Set<string>();
  constructor(readonly model: string, readonly seed: number) {}
  compare(command: string, input: unknown, outcome: string, expectedOutcome: string,
    actual: unknown, expected: unknown): void {
    if (outcome !== expectedOutcome) throw new Error(`CONFORMANCE:${this.model}:${command}:outcome ${JSON.stringify({ seed: this.seed, index: this.steps.length, input, expectedOutcome, outcome })}`);
    if (canonical(actual) !== canonical(expected)) throw new Error(`CONFORMANCE:${this.model}:${command}:state ${JSON.stringify({ seed: this.seed, index: this.steps.length, input, expected, actual })}`);
    this.steps.push(structuredClone({ command, input, outcome, expected, actual }));
    this.coverage.add(`${command}:${outcome}`);
  }
  finish(required: readonly string[]): void {
    for (const item of required) if (!this.coverage.has(item)) throw new Error(`CONFORMANCE:${this.model}:missing-coverage:${item}`);
    if (this.steps.length < 3 || this.steps.length > 256) throw new Error(`CONFORMANCE:${this.model}:unbounded-or-empty-trace`);
    // The integration runner retains these lines and binds them to adapter,
    // specification, production-source, lockfile and runtime hashes.
    console.log(`ASSURANCE_CONFORMANCE ${JSON.stringify({ schemaVersion: 1, model: this.model, seed: this.seed,
      coverage: [...this.coverage].sort(), steps: this.steps })}`);
  }
}
