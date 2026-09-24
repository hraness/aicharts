import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { CRATE_UNIT_TESTS, expectedSuites, fuzzEnvironment, packageScript, parseFuzzOptions, propertyTestFiles, validateFuzzOutput,
  NAMED_SEEDS, PORTABLE_SUITES, UNIX_SUITES, type FuzzOptions } from "./assurance-fuzz";
import type { ProofProcess } from "./assurance-proof-common";

const processResult = (output: string, overrides: Partial<ProofProcess> = {}): ProofProcess => ({ command: "cargo", args: [],
  exitCode: 0, signal: null, timedOut: false, outputExceeded: false, output, elapsedMs: 1, ...overrides });
const defaults = parseFuzzOptions([]);
const seedValues: Record<string, string> = { baseline: "11400714819323198485", "rewrite-heavy": "15111226622234232067",
  "conflict-heavy": "10139516130106657239", "settlement-race": "11694718783950599175" };

function output(options: FuzzOptions, platform: NodeJS.Platform = "darwin", edit: (lines: string[]) => void = () => {}) {
  const suites = expectedSuites(platform);
  const lines = suites.flatMap(suite => options.seeds.map(seed => {
    const workload = suite === "ledger-commands" ? options.ledgerCommands : options.iterations;
    const value = seedValues[seed] ?? seed.slice("custom-".length);
    return `aicharts-fuzz suite=${suite} seed=${seed} seed_value=${value} iterations=${workload} cases=${workload} failures=0`;
  }));
  edit(lines);
  const passed = suites.length + CRATE_UNIT_TESTS;
  return ["running 10 tests", ...lines, `test result: ok. ${passed} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.23s`,
    "   Doc-tests aicharts_fuzz", "test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s", ""].join("\n");
}

describe("fuzz options", () => {
  test("defaults run every named seed at 1000 iterations with the ledger cap", () => {
    expect(defaults).toEqual({ iterations: 1000, ledgerCommands: 1000, seeds: [...NAMED_SEEDS], timeoutMinutes: 60 });
    expect(parseFuzzOptions(["--iterations", "200000"]).ledgerCommands).toBe(5000);
    expect(parseFuzzOptions(["--iterations", "200000", "--ledger-commands", "200000"]).ledgerCommands).toBe(200000);
    expect(parseFuzzOptions(["--seed", "conflict-heavy"]).seeds).toEqual(["conflict-heavy"]);
    expect(parseFuzzOptions(["--seed", "12345"]).seeds).toEqual(["custom-12345"]);
    expect(parseFuzzOptions(["--timeout-minutes", "170"]).timeoutMinutes).toBe(170);
  });
  test("rejects zero, non-integer, oversized, unknown and positional inputs", () => {
    for (const argv of [["--iterations", "0"], ["--iterations", "x"], ["--iterations", "1.5"], ["--iterations", "100000001"], ["--ledger-commands", "0"],
      ["--seed", "no-such-seed"], ["--seed", "18446744073709551616"], ["--seed", "-1"], ["--timeout-minutes", "171"], ["extra"], ["--unknown"]]) {
      expect(() => parseFuzzOptions(argv)).toThrow();
    }
  });
  test("environment carries only the workload, Cargo needs and no provider credentials", () => {
    const environment = fuzzEnvironment({ PATH: "/bin", HOME: "/home", POSTHOG_API_KEY: "never", CLOUDFLARE_API_TOKEN: "never", RUSTFLAGS: "never",
      LD_PRELOAD: "never", CARGO_BUILD_JOBS: "4" }, parseFuzzOptions(["--iterations", "7", "--seed", "42"]), "/target");
    expect(environment).toEqual({ NODE_ENV: "test", PATH: "/bin", HOME: "/home", CARGO_BUILD_JOBS: "4", AICHARTS_FUZZ_ITERATIONS: "7",
      AICHARTS_FUZZ_LEDGER_COMMANDS: "7", AICHARTS_FUZZ_SEED: "42", NO_COLOR: "1", FORCE_COLOR: "0", CARGO_NET_OFFLINE: "true", CARGO_TARGET_DIR: "/target" });
    expect(fuzzEnvironment({}, defaults, "/target").AICHARTS_FUZZ_SEED).toBeUndefined();
    expect(fuzzEnvironment({}, parseFuzzOptions(["--seed", "baseline"]), "/target").AICHARTS_FUZZ_SEED).toBe("baseline");
  });
});

describe("fuzz output admission", () => {
  test("admits one receipt per expected suite and seed on unix and windows", () => {
    const unix = validateFuzzOutput(processResult(output(defaults)), defaults, "darwin");
    expect(unix).toHaveLength((PORTABLE_SUITES.length + UNIX_SUITES.length) * NAMED_SEEDS.length);
    expect(unix[0]).toEqual({ suite: "ledger-commands", seed: "baseline", seedValue: seedValues.baseline, iterations: 1000, counters: { cases: 1000, failures: 0 } });
    const windows = validateFuzzOutput(processResult(output(defaults, "win32")), defaults, "win32");
    expect(windows).toHaveLength(PORTABLE_SUITES.length * NAMED_SEEDS.length);
    const custom = parseFuzzOptions(["--iterations", "9000", "--seed", "5"]);
    expect(validateFuzzOutput(processResult(output(custom)), custom, "linux").map(receipt => receipt.iterations)).toEqual([5000, 9000, 9000, 9000, 9000, 9000, 9000]);
  });
  test("rejects incomplete processes, failures, missing or duplicated receipts and workload drift", () => {
    const cases: [string, ProofProcess, FuzzOptions][] = [
      ["timeout", processResult(output(defaults), { timedOut: true, exitCode: null }), defaults],
      ["exit code", processResult(output(defaults), { exitCode: 101 }), defaults],
      ["failed summary", processResult(output(defaults).replace("ok. 10 passed; 0 failed", "FAILED. 9 passed; 1 failed")), defaults],
      ["ignored test", processResult(output(defaults).replace("10 passed; 0 failed; 0 ignored", "9 passed; 0 failed; 1 ignored")), defaults],
      ["panic", processResult(output(defaults).replace("running 10 tests", "thread 'x' panicked at src/lib.rs")), defaults],
      ["missing receipt", processResult(output(defaults, "darwin", lines => { lines.pop(); })), defaults],
      ["duplicate receipt", processResult(output(defaults, "darwin", lines => { lines.push(lines[0]); })), defaults],
      ["unexpected seed", processResult(output(defaults, "darwin", lines => { lines[0] = lines[0].replace("seed=baseline", "seed=other"); })), defaults],
      ["workload drift", processResult(output(defaults, "darwin", lines => { lines[0] = lines[0].replace("iterations=1000", "iterations=999"); })), defaults],
      ["custom seed value drift", processResult(output(parseFuzzOptions(["--seed", "5"]), "darwin", lines => { lines[0] = lines[0].replace("seed_value=5", "seed_value=6"); })), parseFuzzOptions(["--seed", "5"])],
      ["windows inventory on unix", processResult(output(defaults, "win32")), defaults],
    ];
    for (const [name, result, options] of cases) expect(() => validateFuzzOutput(result, options, "darwin"), name).toThrow();
  });
});

describe("test:property script", () => {
  test("its file globs cover every property test under lib", async () => {
    const script = await packageScript("test:property");
    expect(script).toBeDefined();
    const patterns = script!.split(/\s+/u).slice(2).map(pattern => pattern.replace(/^\.\//u, ""));
    expect(patterns.length).toBeGreaterThan(0);
    const files = await propertyTestFiles();
    expect(files).toContain("lib/usage/rich-facts.property.test.ts");
    for (const file of files) expect(patterns.some(pattern => new Glob(pattern).match(file)), file).toBe(true);
  });
});
