import { readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { completed, gitIdentity, proofRoot as root, proofRunDirectory, readProofFile, runProofProcess, sha256,
  type ProofProcess } from "./assurance-proof-common";

/** Seeded, sampled property evidence for the exact kernels (`crates/aicharts-fuzz`).
 * Every run pins the seed set, the iteration count and the exact crate bytes it
 * exercised. A passing receipt is sampled evidence with stated seeds, never a proof. */
export const FUZZ_CRATE = "aicharts-fuzz";
export const RECEIPT_PREFIX = "aicharts-fuzz";
export const NAMED_SEEDS = ["baseline", "rewrite-heavy", "conflict-heavy", "settlement-race"] as const;
export const DEFAULT_ITERATIONS = 1_000;
export const MAX_ITERATIONS = 100_000_000;
export const DEFAULT_LEDGER_COMMAND_CAP = 5_000;
export const PORTABLE_SUITES = ["metrics-arithmetic", "metrics-tokens", "metrics-dominance", "protocol-usage-wire",
  "protocol-usage-violations", "protocol-admission-wire"] as const;
export const UNIX_SUITES = ["ledger-commands"] as const;
/** Configuration, generator and receipt unit tests inside the crate. */
export const CRATE_UNIT_TESTS = 3;
const MAX_TIMEOUT_MINUTES = 170, DEFAULT_TIMEOUT_MINUTES = 60;

export type FuzzOptions = Readonly<{ iterations: number; ledgerCommands: number; seeds: readonly string[]; timeoutMinutes: number }>;

const bounded = (text: string, code: string, max: number) => {
  if (!/^[1-9][0-9]*$/u.test(text)) throw new Error(code);
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > max) throw new Error(code);
  return value;
};

/** `--iterations N` (default 1000), `--seed <name|decimal>` (default all four named seeds),
 * `--ledger-commands N` (default min(iterations, 5000)), `--timeout-minutes N` (default 60, max 170). */
export function parseFuzzOptions(argv: readonly string[]): FuzzOptions {
  const { values, positionals } = parseArgs({ args: [...argv], strict: true, allowPositionals: true,
    options: { iterations: { type: "string" }, seed: { type: "string" }, "ledger-commands": { type: "string" }, "timeout-minutes": { type: "string" } } });
  if (positionals.length !== 0) throw new Error("fuzz_unexpected_positional_argument");
  const iterations = values.iterations === undefined ? DEFAULT_ITERATIONS : bounded(values.iterations, "fuzz_iterations_invalid", MAX_ITERATIONS);
  const ledgerCommands = values["ledger-commands"] === undefined ? Math.min(iterations, DEFAULT_LEDGER_COMMAND_CAP)
    : bounded(values["ledger-commands"], "fuzz_ledger_commands_invalid", MAX_ITERATIONS);
  const timeoutMinutes = values["timeout-minutes"] === undefined ? DEFAULT_TIMEOUT_MINUTES
    : bounded(values["timeout-minutes"], "fuzz_timeout_invalid", MAX_TIMEOUT_MINUTES);
  let seeds: readonly string[] = NAMED_SEEDS;
  if (values.seed !== undefined) {
    const seed = values.seed.trim();
    if ((NAMED_SEEDS as readonly string[]).includes(seed)) seeds = [seed];
    else if (/^(?:0|[1-9][0-9]*)$/u.test(seed) && BigInt(seed) <= 0xFFFF_FFFF_FFFF_FFFFn) seeds = [`custom-${BigInt(seed)}`];
    else throw new Error("fuzz_seed_unknown");
  }
  return { iterations, ledgerCommands, seeds, timeoutMinutes };
}

/** The crate reads its workload from the environment; nothing else is inherited except
 * what Cargo needs. Provider credentials, compiler wrappers and preload hooks stay out. */
export function fuzzEnvironment(source: Readonly<Record<string, string | undefined>>, options: FuzzOptions, target: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["PATH", "HOME", "SystemRoot", "SYSTEMROOT", "WINDIR", "TMPDIR", "TEMP", "TMP", "CI", "CARGO_HOME", "RUSTUP_HOME",
    "CARGO_BUILD_JOBS", "SDKROOT", "MACOSX_DEPLOYMENT_TARGET", "DEVELOPER_DIR"]) if (source[key] !== undefined) environment[key] = source[key];
  environment.AICHARTS_FUZZ_ITERATIONS = String(options.iterations);
  environment.AICHARTS_FUZZ_LEDGER_COMMANDS = String(options.ledgerCommands);
  if (options.seeds.length === 1) environment.AICHARTS_FUZZ_SEED = options.seeds[0].replace(/^custom-/u, "");
  return { ...environment, NO_COLOR: "1", FORCE_COLOR: "0", CARGO_NET_OFFLINE: "true", CARGO_TARGET_DIR: target };
}

export const fuzzCommand = ["cargo", "test", "--locked", "-p", FUZZ_CRATE, "--", "--nocapture"] as const;

export type SuiteReceipt = Readonly<{ suite: string; seed: string; seedValue: string; iterations: number; counters: Readonly<Record<string, number>> }>;
const receiptLine = new RegExp(`^${RECEIPT_PREFIX} suite=([a-z-]+) seed=([a-z0-9-]+) seed_value=(\\d+) iterations=(\\d+)((?: [a-z_]+=\\d+)*)$`, "u");
const summaryLine = /^test result: ok\. (\d+) passed; 0 failed; (\d+) ignored; 0 measured; 0 filtered out; finished in [0-9.]+s$/u;
const infrastructureFailure = /(?:error: could not compile|error\[E|panicked at|FAILED|Segmentation fault|SIGABRT)/u;

export function expectedSuites(platform: NodeJS.Platform = process.platform): readonly string[] {
  return platform === "win32" ? PORTABLE_SUITES : [...PORTABLE_SUITES, ...UNIX_SUITES];
}

/** Admit the run only when libtest reports every expected test passing and exactly one
 * receipt line exists per expected suite and seed with the configured workload. */
export function validateFuzzOutput(result: ProofProcess, options: FuzzOptions, platform: NodeJS.Platform = process.platform): SuiteReceipt[] {
  if (!completed(result)) throw new Error(`fuzz_process_incomplete:${result.timedOut ? "timeout" : result.outputExceeded ? "output" : result.signal ?? "unknown"}`);
  if (result.exitCode !== 0) throw new Error(`fuzz_process_failed:${result.exitCode}`);
  const suites = expectedSuites(platform), expectedTests = suites.length + CRATE_UNIT_TESTS;
  const receipts: SuiteReceipt[] = [], summaries: number[] = [];
  for (const raw of result.output.split("\n")) {
    const line = raw.trimEnd();
    const receipt = receiptLine.exec(line);
    if (receipt) {
      const counters: Record<string, number> = {};
      for (const pair of receipt[5].trim().split(" ").filter(Boolean)) {
        const [key, value] = pair.split("=");
        if (key in counters) throw new Error(`fuzz_receipt_duplicate_counter:${key}`);
        counters[key] = Number(value);
        if (!Number.isSafeInteger(counters[key])) throw new Error(`fuzz_receipt_counter_unsafe:${key}`);
      }
      receipts.push({ suite: receipt[1], seed: receipt[2], seedValue: receipt[3], iterations: Number(receipt[4]), counters });
      continue;
    }
    const summary = summaryLine.exec(line);
    if (summary) { if (summary[2] !== "0") throw new Error("fuzz_tests_ignored"); summaries.push(Number(summary[1])); }
    else if (/^test result:/u.test(line)) throw new Error(`fuzz_summary_rejected:${line}`);
  }
  if (infrastructureFailure.test(result.output)) throw new Error("fuzz_infrastructure_failure");
  if (!summaries.includes(expectedTests)) throw new Error(`fuzz_test_count_mismatch:${expectedTests}:${summaries.join(",")}`);
  const seen = new Set<string>();
  for (const receipt of receipts) {
    const key = `${receipt.suite}/${receipt.seed}`;
    if (seen.has(key)) throw new Error(`fuzz_receipt_duplicate:${key}`);
    seen.add(key);
    if (!suites.includes(receipt.suite)) throw new Error(`fuzz_receipt_unexpected_suite:${receipt.suite}`);
    if (!options.seeds.includes(receipt.seed)) throw new Error(`fuzz_receipt_unexpected_seed:${receipt.seed}`);
    const workload = receipt.suite === "ledger-commands" ? options.ledgerCommands : options.iterations;
    if (receipt.iterations !== workload) throw new Error(`fuzz_receipt_workload_mismatch:${key}:${receipt.iterations}`);
    if (receipt.seed.startsWith("custom-") && receipt.seedValue !== receipt.seed.slice("custom-".length)) throw new Error(`fuzz_receipt_seed_value_mismatch:${key}`);
  }
  const expectedCount = suites.length * options.seeds.length;
  if (receipts.length !== expectedCount) throw new Error(`fuzz_receipt_inventory_incomplete:${receipts.length}:${expectedCount}`);
  return receipts.sort((a, b) => a.suite.localeCompare(b.suite) || a.seed.localeCompare(b.seed));
}

async function crateSnapshot() {
  const crate = resolve(root, "crates", FUZZ_CRATE);
  const files = await readdir(resolve(crate, "src"), { withFileTypes: true });
  if (files.length > 16 || files.some(file => !file.isFile() || !file.name.endsWith(".rs"))) throw new Error("fuzz_unexpected_crate_layout");
  const paths = ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", `crates/${FUZZ_CRATE}/Cargo.toml`, ...files.map(file => `crates/${FUZZ_CRATE}/src/${file.name}`)].sort();
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, sha256(await readProofFile(resolve(root, path)))])));
}

export async function runFuzz(options: FuzzOptions) {
  const run = await proofRunDirectory("fuzz");
  const environment = fuzzEnvironment(process.env, options, resolve(root, "target"));
  const before = await crateSnapshot();
  const toolchain = await runProofProcess("cargo", ["--version"], root, environment, 30_000);
  if (!completed(toolchain) || toolchain.exitCode !== 0) throw new Error("fuzz_cargo_unavailable");
  const [command, ...args] = fuzzCommand;
  const result = await runProofProcess(command, args, root, environment, options.timeoutMinutes * 60_000, 16_777_216);
  await writeFile(resolve(run, "cargo-test.log"), result.output);
  let suites: SuiteReceipt[] = [];
  const failures: string[] = [];
  try { suites = validateFuzzOutput(result, options); } catch (error) { failures.push(String(error)); }
  const after = await crateSnapshot();
  const sourceUnchanged = Object.keys(before).length === Object.keys(after).length && Object.entries(before).every(([path, hash]) => after[path] === hash);
  if (!sourceUnchanged) failures.push("fuzz_inputs_changed");
  const receipt = { schemaVersion: 1, claim: "seeded-sampled-property-evidence", recordedAt: new Date().toISOString(), git: await gitIdentity(),
    options, command: [command, ...args], cargo: toolchain.output.trim(), sourceSha256: before,
    process: { exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, outputExceeded: result.outputExceeded,
      elapsedMs: result.elapsedMs, log: "cargo-test.log", logSha256: sha256(result.output) },
    suites, suiteCount: suites.length, expectedSuites: expectedSuites(), sourceUnchanged, failures, ok: failures.length === 0,
    limitations: ["Sampled evidence for the listed seeds and iteration counts only; a pass shows no counterexample was found, not that none exists.",
      "The xorshift generator, kernel models inside the crate, installed toolchain, Cargo cache, linker and filesystem remain trusted.",
      "The ledger suite runs only where the crate compiles it (unix); other platforms admit the portable suites alone."] };
  await writeFile(resolve(run, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ receipt: relative(root, resolve(run, "receipt.json")), suites: suites.length, elapsedMs: result.elapsedMs, failures }));
  return failures.length === 0;
}

export async function propertyTestFiles(directory = resolve(root, "lib")) {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".property.test.ts")) found.push(relative(root, resolve(entry.parentPath, entry.name)));
  }
  return found.sort();
}

export async function packageScript(name: string) {
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  return manifest.scripts?.[name];
}

if (import.meta.main) {
  try {
    if (!await runFuzz(parseFuzzOptions(process.argv.slice(2)))) process.exitCode = 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
