import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { completed, gitIdentity, proofRoot as root, proofRunDirectory, readProofFile, runProofProcess, sha256, type ProofProcess } from "./assurance-proof-common";
import { isWorkerEnvironmentFile, workerToolCommands, workerToolEnvironment } from "./usage-worker-tools";

/** Runs the injected-failure suites that already exist and refuses to pass when any listed
 * suite, test or failure class is missing. It is an inventory gate over existing evidence. */
const platform = z.enum(["darwin", "linux"]);
const failureClass = z.string().regex(/^[a-z-]+$/u);
const suiteBase = { id: z.string().regex(/^[a-z0-9-]+$/u), platforms: z.array(platform).min(1), failureClasses: z.array(failureClass).min(1), tests: z.array(z.string().min(1)).min(1) };
export const workerSuiteSchema = z.object({ ...suiteBase, kind: z.literal("worker"), source: z.string().regex(/^services\/usage-worker\/test\/[a-z-]+\.worker\.ts$/u), expectedTests: z.number().int().positive() }).strict();
export const cargoSuiteSchema = z.object({ ...suiteBase, kind: z.literal("cargo"), package: z.string().regex(/^aicharts-[a-z-]+$/u), sources: z.array(z.string().regex(/^crates\/aicharts-[a-z-]+\/src\/[a-z_/]+\.rs$/u)).min(1) }).strict();
export const manifestSchema = z.object({ schemaVersion: z.literal(1), claim: z.literal("existing-injected-failure-inventory"), scope: z.string().min(1),
  failureClasses: z.record(failureClass, z.string().min(1)), gaps: z.array(z.object({ failureClass, reason: z.string().min(1) }).strict()),
  limits: z.object({ workerTimeoutMs: z.number().int().positive().max(1_800_000), cargoTimeoutMs: z.number().int().positive().max(3_600_000), maxProcessOutputBytes: z.number().int().positive() }).strict(),
  suites: z.array(z.discriminatedUnion("kind", [workerSuiteSchema, cargoSuiteSchema])).min(1) }).strict();
export type FaultManifest = z.infer<typeof manifestSchema>;
export type FaultSuite = FaultManifest["suites"][number];
export type SuiteStatus = "pass" | "fail" | "skipped-platform" | "not-selected";
export type FaultOptions = Readonly<{ suites: readonly string[] }>;

export function parseFaultOptions(argv: readonly string[]): FaultOptions {
  const { values, positionals } = parseArgs({ args: [...argv], strict: true, allowPositionals: true, options: { suite: { type: "string", multiple: true } } });
  if (positionals.length !== 0) throw new Error("fault_matrix_unexpected_positional_argument");
  return { suites: values.suite ?? [] };
}

/** Every failure class is covered by a suite or declared as a gap, never both; every
 * listed test name exists in its declared source; ids and tests are unique. */
export function validateManifest(manifest: FaultManifest, sources: ReadonlyMap<string, string>) {
  const ids = new Set<string>();
  const covered = new Set<string>();
  for (const suite of manifest.suites) {
    if (ids.has(suite.id)) throw new Error(`fault_matrix_duplicate_suite:${suite.id}`);
    ids.add(suite.id);
    if (new Set(suite.tests).size !== suite.tests.length) throw new Error(`fault_matrix_duplicate_test:${suite.id}`);
    for (const name of suite.failureClasses) {
      if (!(name in manifest.failureClasses)) throw new Error(`fault_matrix_unknown_failure_class:${suite.id}:${name}`);
      covered.add(name);
    }
    const files = suite.kind === "worker" ? [suite.source] : suite.sources;
    const texts = files.map(path => { const text = sources.get(path); if (text === undefined) throw new Error(`fault_matrix_source_missing:${path}`); return text; });
    for (const test of suite.tests) {
      const present = suite.kind === "worker" ? texts.some(text => text.includes(`"${test}"`))
        : texts.some(text => new RegExp(`^\\s*(?:async\\s+)?fn ${test.slice(test.lastIndexOf("::") + 2)}\\(`, "mu").test(text));
      if (!present) throw new Error(`fault_matrix_test_missing:${suite.id}:${test}`);
    }
    if (suite.kind === "worker" && suite.tests.length > suite.expectedTests) throw new Error(`fault_matrix_expected_tests_too_small:${suite.id}`);
  }
  const gaps = new Set(manifest.gaps.map(gap => gap.failureClass));
  for (const name of Object.keys(manifest.failureClasses)) {
    if (!gaps.has(name) && !covered.has(name)) throw new Error(`fault_matrix_failure_class_uncovered:${name}`);
    if (gaps.has(name) && covered.has(name)) throw new Error(`fault_matrix_gap_also_covered:${name}`);
  }
  for (const gap of gaps) if (!(gap in manifest.failureClasses)) throw new Error(`fault_matrix_unknown_gap:${gap}`);
}

export function selectSuites(manifest: FaultManifest, options: FaultOptions, host: string = process.platform): Map<string, SuiteStatus | "selected"> {
  const known = new Set(manifest.suites.map(suite => suite.id));
  for (const id of options.suites) if (!known.has(id)) throw new Error(`fault_matrix_unknown_suite:${id}`);
  const selection = new Map<string, SuiteStatus | "selected">();
  for (const suite of manifest.suites) {
    if (!(suite.platforms as string[]).includes(host)) selection.set(suite.id, "skipped-platform");
    else if (options.suites.length > 0 && !options.suites.includes(suite.id)) selection.set(suite.id, "not-selected");
    else selection.set(suite.id, "selected");
  }
  return selection;
}

const infrastructureFailure = /(?:Unhandled Errors|Failed to load|Error during worker startup|Transform failed|error: could not compile|error\[E)/iu;
const vitestTests = /^\s*Tests\s+(\d+) passed \((\d+)\)\s*$/mu, vitestFiles = /^\s*Test Files\s+1 passed \(1\)\s*$/mu;
const cargoSummary = /^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; \d+ measured; \d+ filtered out; finished in [0-9.]+s$/gmu;

export function validateSuiteOutput(suite: FaultSuite, result: ProofProcess) {
  if (!completed(result)) throw new Error(`fault_suite_incomplete:${suite.id}:${result.timedOut ? "timeout" : result.outputExceeded ? "output" : result.signal ?? "unknown"}`);
  if (infrastructureFailure.test(result.output)) throw new Error(`fault_suite_infrastructure_failure:${suite.id}`);
  if (result.exitCode !== 0) throw new Error(`fault_suite_failed:${suite.id}:${result.exitCode}`);
  if (suite.kind === "worker") {
    const tests = vitestTests.exec(result.output);
    if (!vitestFiles.test(result.output) || !tests || tests[1] !== tests[2]) throw new Error(`fault_suite_summary_rejected:${suite.id}`);
    if (Number(tests[1]) !== suite.expectedTests) throw new Error(`fault_suite_test_count_mismatch:${suite.id}:${tests[1]}:${suite.expectedTests}`);
    return { passed: suite.expectedTests };
  }
  let passed = 0, summaries = 0;
  for (const summary of result.output.matchAll(cargoSummary)) {
    summaries++;
    if (summary[1] !== "ok" || summary[3] !== "0" || summary[4] !== "0") throw new Error(`fault_suite_summary_rejected:${suite.id}`);
    passed += Number(summary[2]);
  }
  if (summaries === 0) throw new Error(`fault_suite_summary_missing:${suite.id}`);
  for (const test of suite.tests) if (!new RegExp(`^test ${test.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")} \\.\\.\\. ok$`, "mu").test(result.output)) throw new Error(`fault_suite_test_not_run:${suite.id}:${test}`);
  if (passed !== suite.tests.length) throw new Error(`fault_suite_test_count_mismatch:${suite.id}:${passed}:${suite.tests.length}`);
  return { passed };
}

export function suiteCommand(suite: FaultSuite): { command: string; args: string[]; cwd: string } {
  if (suite.kind === "worker") {
    const [command, ...args] = workerToolCommands(["test"])![0];
    return { command, args: [...args, suite.source.slice("services/usage-worker/".length)], cwd: resolve(root, "services/usage-worker") };
  }
  return { command: "cargo", args: ["test", "--locked", "-p", suite.package, "--", "--exact", ...suite.tests], cwd: root };
}

function cargoEnvironment(source: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["PATH", "HOME", "SystemRoot", "SYSTEMROOT", "WINDIR", "TMPDIR", "TEMP", "TMP", "CI", "CARGO_HOME", "RUSTUP_HOME", "CARGO_BUILD_JOBS",
    "SDKROOT", "MACOSX_DEPLOYMENT_TARGET", "DEVELOPER_DIR"]) if (source[key] !== undefined) environment[key] = source[key];
  return { ...environment, NO_COLOR: "1", FORCE_COLOR: "0", CARGO_NET_OFFLINE: "true", CARGO_TARGET_DIR: resolve(root, "target") };
}

async function workerGuards() {
  const worker = resolve(root, "services/usage-worker");
  try { await lstat(join(homedir(), ".wrangler")); throw new Error("fault_matrix_legacy_wrangler_configuration"); }
  catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
  if ((await readdir(worker)).some(isWorkerEnvironmentFile)) throw new Error("fault_matrix_worker_environment_file_present");
  await mkdir(resolve(worker, ".wrangler"), { recursive: true, mode: 0o700 });
}

export async function runFaultMatrix(options: FaultOptions) {
  const manifestPath = "verify/assurance/fault-matrix.json";
  const manifestBytes = await readProofFile(resolve(root, manifestPath));
  const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")) as unknown);
  const sourcePaths = [...new Set(manifest.suites.flatMap(suite => suite.kind === "worker" ? [suite.source] : suite.sources))].sort();
  const sources = new Map<string, string>();
  for (const path of sourcePaths) sources.set(path, (await readProofFile(resolve(root, path))).toString("utf8"));
  validateManifest(manifest, sources);
  const run = await proofRunDirectory("fault-matrix");
  const selection = selectSuites(manifest, options);
  if ([...selection.values()].some(status => status === "selected") && manifest.suites.some(suite => suite.kind === "worker" && selection.get(suite.id) === "selected")) await workerGuards();
  const results: Record<string, unknown> = {}, failures: string[] = [];
  for (const suite of manifest.suites) {
    const status = selection.get(suite.id)!;
    if (status !== "selected") { results[suite.id] = { status, failureClasses: suite.failureClasses, platforms: suite.platforms }; continue; }
    const { command, args, cwd } = suiteCommand(suite);
    const environment: NodeJS.ProcessEnv = suite.kind === "worker" ? { ...workerToolEnvironment(process.env), NODE_ENV: "test" } : cargoEnvironment(process.env);
    const timeout = suite.kind === "worker" ? manifest.limits.workerTimeoutMs : manifest.limits.cargoTimeoutMs;
    const result = await runProofProcess(command, args, cwd, environment, timeout, manifest.limits.maxProcessOutputBytes);
    await writeFile(resolve(run, `${suite.id}.log`), result.output);
    const evidence = { command: [command, ...args], cwd: relative(root, cwd) || ".", exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut,
      outputExceeded: result.outputExceeded, elapsedMs: result.elapsedMs, log: `${suite.id}.log`, logSha256: sha256(result.output), failureClasses: suite.failureClasses, tests: suite.tests };
    try { const { passed } = validateSuiteOutput(suite, result); results[suite.id] = { status: "pass", passed, ...evidence }; }
    catch (error) { failures.push(String(error)); results[suite.id] = { status: "fail", ...evidence }; }
  }
  for (const [path, text] of sources) if (sha256(await readFile(resolve(root, path))) !== sha256(text)) failures.push(`fault_matrix_source_changed:${path}`);
  const complete = manifest.suites.every(suite => selection.get(suite.id) !== "not-selected");
  const covered = [...new Set(manifest.suites.filter(suite => (results[suite.id] as { status: SuiteStatus }).status === "pass").flatMap(suite => suite.failureClasses))].sort();
  const receipt = { schemaVersion: 1, claim: manifest.claim, recordedAt: new Date().toISOString(), git: await gitIdentity(), platform: process.platform, options, complete,
    manifestSha256: sha256(manifestBytes), sourceSha256: Object.fromEntries([...sources].map(([path, text]) => [path, sha256(text)])),
    failureClasses: manifest.failureClasses, gaps: manifest.gaps, coveredByPassingSuites: covered, suites: results, failures, ok: failures.length === 0,
    limitations: ["Runs existing suites only; it proves the inventory is present and passing, not that the failure classes are exhaustively exercised.",
      "Suites outside the host platform are recorded as skipped-platform, never as passed.", "disk-full has no existing test and is recorded as a gap.",
      "A partial --suite run records complete=false and cannot stand in for the full inventory."] };
  await writeFile(resolve(run, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ receipt: relative(root, resolve(run, "receipt.json")), complete, suites: Object.fromEntries(Object.entries(results).map(([id, value]) => [id, (value as { status: SuiteStatus }).status])), failures }));
  return failures.length === 0;
}

if (import.meta.main) {
  try {
    if (!await runFaultMatrix(parseFaultOptions(process.argv.slice(2)))) process.exitCode = 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
