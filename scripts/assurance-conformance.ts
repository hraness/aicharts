import { lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, relative, resolve } from "node:path";
import { isDeepStrictEqual, stripVTControlCharacters } from "node:util";
import { z } from "zod";
import { completed, gitIdentity, proofRoot as root, proofRunDirectory, readProofFile, runProofProcess,
  sha256, type ProofProcess } from "./assurance-proof-common";

const adapterId = z.enum(["worker", "ledger", "browser-contract"]);
const command = z.array(z.string().min(1).max(256)).min(1).max(16);
const adapter = z.object({ command, source: z.string().min(1).max(256), expectedTests: z.number().int().min(1).max(128) }).strict();
export const casesSchema = z.object({ schemaVersion: z.literal(1),
  claim: z.literal("bounded-generated-production-conformance-only"), tracePrefix: z.literal("ASSURANCE_CONFORMANCE "),
  expectedTraceCount: z.number().int().min(1).max(128),
  adapters: z.object({ worker: adapter, ledger: adapter, "browser-contract": adapter }).strict(),
  cases: z.array(z.object({ model: z.string().regex(/^M[1-7](?:-[a-z]+)?$/u), adapter: adapterId,
    seeds: z.array(z.number().int().min(1).max(0xffffffff)).min(1).max(16),
    requiredCoverage: z.array(z.string().regex(/^[a-z0-9-]+:[a-z0-9_-]+$/u)).min(1).max(64),
    minSteps: z.number().int().min(3).max(256), maxSteps: z.number().int().min(3).max(256) }).strict()).min(1).max(32),
  limits: z.object({ maxTraceBytes: z.literal(1_048_576), maxProcessOutputBytes: z.literal(8_388_608), timeoutMs: z.literal(180_000) }).strict(),
  limitations: z.array(z.string().min(1).max(256)).min(1).max(16),
}).strict();
type Cases = z.infer<typeof casesSchema>;
const traceSchema = z.object({ schemaVersion: z.literal(1), model: z.string(), seed: z.number().int(),
  coverage: z.array(z.string()).min(1).max(256),
  steps: z.array(z.object({ command: z.string().regex(/^[a-z0-9-]+$/u), input: z.unknown(),
    outcome: z.string().regex(/^[a-z0-9_-]+$/u), expected: z.unknown(), actual: z.unknown() }).strict()).min(3).max(256),
}).strict();
export type ConformanceTrace = z.infer<typeof traceSchema>;
const commands = {
  worker: ["bun", "scripts/usage-worker-tools.ts", "test-assurance-conformance"],
  ledger: ["cargo", "test", "--locked", "--offline", "-p", "aicharts-ledger", "--test", "assurance_conformance", "--", "--nocapture"],
  "browser-contract": ["bun", "test", "./verify/conformance/account-generation.test.ts"],
} as const;
const adapterSources = {
  worker: "services/usage-worker/test/assurance-conformance.worker.ts",
  ledger: "crates/aicharts-ledger/tests/assurance_conformance.rs",
  "browser-contract": "verify/conformance/account-generation.test.ts",
} as const;
const retainedSeeds = [1066793, 539363619, 1592639710];
const infrastructureFailure = /(?:Unhandled Errors|Failed to load|Error during worker startup|Transform failed|timed out)/iu;

export function validateCaseInventory(manifest: Cases): void {
  for (const id of adapterId.options) {
    if (!isDeepStrictEqual(manifest.adapters[id].command, [...commands[id]])
      || manifest.adapters[id].source !== adapterSources[id]) throw new Error(`conformance_command_drift:${id}`);
    const traces = manifest.cases.filter(entry => entry.adapter === id).reduce((count, entry) => count + entry.seeds.length, 0);
    if (manifest.adapters[id].expectedTests !== (id === "ledger" ? 1 : traces)) throw new Error(`conformance_test_inventory_drift:${id}`);
  }
  const models = new Set<string>(); let count = 0;
  for (const entry of manifest.cases) {
    if (models.has(entry.model) || new Set(entry.seeds).size !== entry.seeds.length
      || new Set(entry.requiredCoverage).size !== entry.requiredCoverage.length || entry.minSteps > entry.maxSteps
      || !isDeepStrictEqual(entry.seeds, retainedSeeds)) throw new Error("conformance_inventory_invalid");
    models.add(entry.model); count += entry.seeds.length;
  }
  if (count !== manifest.expectedTraceCount || adapterId.options.some(id => !manifest.cases.some(entry => entry.adapter === id))
    || [1, 2, 3, 4, 5, 6, 7].some(id => !manifest.cases.some(entry => entry.model.split("-")[0] === `M${id}`))) throw new Error("conformance_inventory_incomplete");
}

export function validateTraces(manifest: Cases, id: z.infer<typeof adapterId>, result: ProofProcess): ConformanceTrace[] {
  if (!completed(result) || result.exitCode !== 0) throw new Error(`conformance_process_failed:${id}`);
  const output = stripVTControlCharacters(result.output), expectedTests = manifest.adapters[id].expectedTests;
  if (infrastructureFailure.test(output) || /^\s*FAIL\s/gmu.test(output)
    || (id === "worker" && ([...output.matchAll(/^\s*Test Files\s+1 passed \(1\)\s*$/gmu)].length !== 1
      || [...output.matchAll(/^\s*Duration\s+\S+.*$/gmu)].length !== 1))) throw new Error(`conformance_process_incomplete:${id}`);
  const summaries = id === "worker" ? [...output.matchAll(/^\s*Tests\s+(\d+) passed \((\d+)\)\s*$/gmu)]
    : id === "ledger" ? [...output.matchAll(/^test result: ok\. (\d+) passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in [0-9.]+s$/gmu)]
    : [...output.matchAll(/^\s*(\d+) pass\s*\n\s*0 fail\s*$/gmu)];
  if (summaries.length !== 1 || Number(summaries[0][1]) !== expectedTests
    || (id === "worker" && Number(summaries[0][2]) !== expectedTests)) throw new Error(`conformance_tests_missing:${id}`);
  const groups = manifest.cases.filter(entry => entry.adapter === id), expected = new Set(groups.flatMap(entry => entry.seeds.map(seed => `${entry.model}:${seed}`)));
  const traces: ConformanceTrace[] = [], seen = new Set<string>();
  for (const line of output.split(/\r?\n/u)) {
    const start = line.indexOf(manifest.tracePrefix); if (start === -1) continue;
    const bytes = line.slice(start + manifest.tracePrefix.length);
    if (Buffer.byteLength(bytes) > manifest.limits.maxTraceBytes) throw new Error("conformance_trace_too_large");
    const trace = traceSchema.parse(JSON.parse(bytes) as unknown), key = `${trace.model}:${trace.seed}`;
    if (!expected.has(key) || seen.has(key)) throw new Error("conformance_trace_unexpected_or_duplicate");
    const group = groups.find(entry => entry.model === trace.model)!;
    const actualCoverage = [...new Set(trace.steps.map(step => `${step.command}:${step.outcome}`))].sort();
    if (trace.steps.length < group.minSteps || trace.steps.length > group.maxSteps
      || !isDeepStrictEqual(trace.coverage, actualCoverage)
      || group.requiredCoverage.some(item => !actualCoverage.includes(item))
      || trace.steps.some(step => !Object.hasOwn(step, "expected") || !Object.hasOwn(step, "actual") || !Object.hasOwn(step, "input")
        || !isDeepStrictEqual(step.expected, step.actual))) throw new Error(`conformance_trace_incomplete:${key}`);
    seen.add(key); traces.push(trace);
  }
  if (seen.size !== expected.size) throw new Error(`conformance_trace_missing:${id}`);
  return traces;
}

export const mutationsSchema = z.object({ schemaVersion: z.literal(1), claim: z.literal("production-guard-mutation-tested-correspondence-only"),
  mutations: z.array(z.object({ id: z.literal("publish-with-live-registrations"), source: z.literal("services/usage-worker/src/restore-fence.ts"),
    exactBefore: z.literal('if (this.#inFlight() !== 0) return err("recovery_required");'),
    exactAfter: z.literal('if (this.#inFlight() < 0) return err("recovery_required");'), requireSingleSourceMatch: z.literal(true),
    adapter: z.literal("services/usage-worker/test/assurance-conformance.worker.ts"), testName: z.literal("M1 generated restore registration schedules"),
    expectedSemanticFailure: z.literal("CONFORMANCE:M1:publish:outcome"), requiredPositiveControl: z.string().min(1),
    refuse: z.array(z.string()).min(1).max(16) }).strict()).length(1),
}).strict();
type Mutation = z.infer<typeof mutationsSchema>["mutations"][number];

export function validateMutation(result: ProofProcess, marker: string, expectedTests = 30): void {
  const output = stripVTControlCharacters(result.output);
  // Compile errors and infrastructure deaths are not semantic counterexamples.
  // All three M1 schedules must fail at the unchanged outcome assertion.
  const failures = [...output.matchAll(/^Error: CONFORMANCE:M1:publish:outcome (\{[^\n]+\})$/gmu)];
  const summaries = [...output.matchAll(/^\s*Tests\s+(\d+) failed \| (\d+) passed \((\d+)\)\s*$/gmu)];
  const failedTests = [...output.matchAll(/^\s*FAIL\s+(.+)$/gmu)];
  const expectedNames = retainedSeeds.map(seed => `test/assurance-conformance.worker.ts > M1 generated restore registration schedules seed=${seed}`).sort();
  if (!completed(result) || result.exitCode !== 1 || marker !== "CONFORMANCE:M1:publish:outcome"
    || summaries.length !== 1 || Number(summaries[0][1]) !== retainedSeeds.length
    || Number(summaries[0][2]) !== expectedTests - retainedSeeds.length || Number(summaries[0][3]) !== expectedTests
    || failures.length !== retainedSeeds.length || !isDeepStrictEqual(failedTests.map(match => match[1]).sort(), expectedNames)
    || [...output.matchAll(/^\s*Test Files\s+1 failed \(1\)\s*$/gmu)].length !== 1
    || [...output.matchAll(/^\s*Duration\s+\S+.*$/gmu)].length !== 1
    || infrastructureFailure.test(output)) throw new Error("conformance_mutation_not_semantic");
  const seeds: number[] = [];
  for (const failure of failures) {
    const value = z.object({ seed: z.number().int(), index: z.number().int().nonnegative(), input: z.object({ epoch: z.literal(1) }).strict(),
      expectedOutcome: z.literal("recovery_required"), outcome: z.literal("ok") }).strict().parse(JSON.parse(failure[1]) as unknown);
    seeds.push(value.seed);
  }
  if (!isDeepStrictEqual(seeds.sort((a, b) => a - b), retainedSeeds)) throw new Error("conformance_mutation_seed_mismatch");
}

async function inputs(): Promise<Map<string, Buffer>> {
  const paths = ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "package.json", "bun.lock", "bunfig.toml", "tsconfig.json",
    "scripts/assurance-conformance.ts", "scripts/assurance-conformance.test.ts", "scripts/assurance-proof-common.ts", "scripts/usage-worker-tools.ts",
    "services/usage-worker/vitest.config.ts", "services/usage-worker/wrangler.jsonc", "services/usage-worker/tsconfig.json", "services/usage-worker/worker-configuration.d.ts"];
  const directories = ["services/usage-worker/src", "lib", "data", "fixtures/usage", "verify/conformance", "verify/tla", "crates", "vendor"];
  let total = 0; const files = new Map<string, Buffer>();
  const add = async (path: string) => {
    const bytes = await readProofFile(resolve(root, path), 16_777_216); total += bytes.length;
    if (total > 67_108_864 || files.size >= 4096) throw new Error("conformance_source_limit");
    files.set(path, bytes);
  };
  const walk = async (path: string) => {
    for (const entry of (await readdir(resolve(root, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "target" || entry.name === ".git") continue;
      const child = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error("conformance_source_symlink");
      if (entry.isDirectory()) await walk(child); else await add(child);
    }
  };
  for (const path of paths) await add(path);
  for (const path of directories) await walk(path);
  await add("services/usage-worker/test/assurance-conformance.worker.ts");
  return files;
}

/** Both controls execute copies of the same captured bytes. Only the named
 * production guard differs; adapters, formal models and action maps are exact. */
export async function stageConformanceInputs(run: string, name: "positive" | "mutant", source: Map<string, Buffer>,
  dependencies: string, mutation?: Mutation) {
  const stage = resolve(run, name), staged: Record<string, string> = {};
  if ((name === "mutant") !== Boolean(mutation)) throw new Error("conformance_stage_kind_mismatch");
  for (const path of source.keys()) {
    if (isAbsolute(path) || path.includes("\\") || path.split("/").some(part => part === ".." || part === "." || part === "")
      || path === "node_modules" || path.startsWith("node_modules/")) throw new Error("conformance_source_path_invalid");
  }
  if (mutation) {
    const original = source.get(mutation.source)?.toString();
    if (!original || original.split(mutation.exactBefore).length !== 2) throw new Error("conformance_mutation_source_drift");
  }
  await mkdir(stage); // Refuse reusing a directory with unrecorded source files.
  for (const [path, original] of source) {
    const bytes = path === mutation?.source ? Buffer.from(original.toString().replace(mutation.exactBefore, mutation.exactAfter)) : original;
    const destination = resolve(stage, path);
    await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes); staged[path] = sha256(bytes);
  }
  const dependencyPath = await realpath(dependencies);
  await symlink(dependencyPath, resolve(stage, "node_modules"), "dir");
  return { path: stage, sourceSha256: staged, dependencyPath, mutation: mutation?.id ?? null };
}
export async function conformanceStageUnchanged(stage: Awaited<ReturnType<typeof stageConformanceInputs>>) {
  try {
    for (const [path, hash] of Object.entries(stage.sourceSha256)) {
      if (sha256(await readProofFile(resolve(stage.path, path), 16_777_216)) !== hash) return false;
    }
    return (await lstat(resolve(stage.path, "node_modules"))).isSymbolicLink()
      && await realpath(resolve(stage.path, "node_modules")) === stage.dependencyPath;
  } catch { return false; }
}

export function conformanceEnvironment(source: Readonly<Record<string, string | undefined>>, toolDirectory: string, target: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  // Do not inherit compiler/runtime injection flags or provider credentials.
  // Cargo's installed cache/config and native linker remain an explicit TCB.
  for (const key of ["HOME", "SystemRoot", "SYSTEMROOT", "WINDIR", "TMPDIR", "TEMP", "TMP", "CI", "CARGO_HOME", "RUSTUP_HOME",
    "SDKROOT", "MACOSX_DEPLOYMENT_TARGET", "DEVELOPER_DIR"]) if (source[key] !== undefined) environment[key] = source[key];
  return { ...environment, PATH: [toolDirectory, source.PATH].filter(Boolean).join(delimiter),
    NO_COLOR: "1", FORCE_COLOR: "0", CARGO_TARGET_DIR: target };
}

export async function runConformance() {
  const source = await inputs(), manifest = casesSchema.parse(JSON.parse(source.get("verify/conformance/cases.json")!.toString()) as unknown);
  validateCaseInventory(manifest);
  const mutations = mutationsSchema.parse(JSON.parse(source.get("verify/conformance/mutations.json")!.toString()) as unknown);
  const run = await proofRunDirectory("conformance"), toolDirectory = resolve(run, "tools");
  await mkdir(toolDirectory);
  const environment = conformanceEnvironment(process.env, toolDirectory, resolve(root, "target/assurance/conformance-build"));
  const tools: Record<string, { path: string; sha256: string; version?: string }> = {};
  const dependencyEntries: Record<string, string> = {};
  for (const name of ["bun", "node", "cargo", "rustc", "workerd"]) {
    let path: string;
    if (name === "cargo" || name === "rustc") {
      const located = await runProofProcess("rustup", ["which", "--toolchain", "1.97.1", name], root, environment, 10_000);
      if (!completed(located) || located.exitCode !== 0) throw new Error("conformance_rust_tool_unavailable"); path = located.output.trim();
    } else if (name === "workerd") {
      // Record the native executable Miniflare resolves, not its JS launcher.
      const located = await runProofProcess(tools.node.path, ["-e", 'const {createRequire}=require("node:module");const entry=require.resolve("miniflare");const local=createRequire(entry);process.stdout.write(JSON.stringify({entry,module:local.resolve("workerd"),binary:local("workerd").default}));'], root, environment, 10_000);
      if (!completed(located) || located.exitCode !== 0) throw new Error("conformance_workerd_unavailable");
      const resolved = z.object({ entry: z.string(), module: z.string(), binary: z.string() }).strict().parse(JSON.parse(located.output) as unknown);
      for (const entry of [resolved.entry, resolved.module]) dependencyEntries[await realpath(entry)] = sha256(await readProofFile(entry, 16_777_216));
      path = resolved.binary;
    }
    else path = name === "bun" ? process.execPath : Bun.which(name) ?? "";
    path = await realpath(path);
    if (!(await lstat(path)).isFile()) throw new Error("conformance_tool_invalid");
    const version = await runProofProcess(path, ["--version"], root, environment, 10_000);
    if (!completed(version) || version.exitCode !== 0) throw new Error("conformance_tool_version_failed");
    tools[name] = { path, sha256: sha256(await readFile(path)), version: version.output.trim() };
    await symlink(path, resolve(toolDirectory, name));
  }
  if (!tools.rustc.version?.startsWith("rustc 1.97.1 ")) throw new Error("conformance_rust_tool_mismatch");
  environment.RUSTC = tools.rustc.path;
  const positive = await stageConformanceInputs(run, "positive", source, resolve(root, "node_modules"));
  const results: Record<string, unknown> = {}, failures: string[] = [];
  const traces: ConformanceTrace[] = [];
  for (const id of adapterId.options) {
    const [executable, ...args] = manifest.adapters[id].command;
    const result = await runProofProcess(tools[executable].path, args, positive.path, environment,
      manifest.limits.timeoutMs, manifest.limits.maxProcessOutputBytes);
    await writeFile(resolve(run, `${id}.log`), result.output);
    const evidence = { ...result, output: undefined, cwd: positive.path, log: `${id}.log`, logSha256: sha256(result.output) };
    try { const accepted = validateTraces(manifest, id, result); traces.push(...accepted); results[id] = { ...evidence, traces: accepted.length, accepted: true }; }
    catch (error) { failures.push(String(error)); results[id] = { ...evidence, accepted: false }; }
  }
  let mutant: Awaited<ReturnType<typeof stageConformanceInputs>> | undefined;
  if (!await conformanceStageUnchanged(positive)) failures.push("conformance_positive_stage_changed");
  if (failures.length === 0) {
    const mutation = mutations.mutations[0];
    mutant = await stageConformanceInputs(run, "mutant", source, resolve(root, "node_modules"), mutation);
    const negative = await runProofProcess(tools.bun.path, manifest.adapters.worker.command.slice(1), mutant.path, environment,
      manifest.limits.timeoutMs, manifest.limits.maxProcessOutputBytes);
    await writeFile(resolve(run, "mutation.log"), negative.output);
    const evidence = { ...negative, output: undefined, cwd: mutant.path, log: "mutation.log", logSha256: sha256(negative.output), id: mutation.id };
    try { validateMutation(negative, mutation.expectedSemanticFailure, manifest.adapters.worker.expectedTests); results.mutation = { ...evidence, accepted: true }; }
    catch (error) { failures.push(String(error)); results.mutation = { ...evidence, accepted: false }; }
  } else results.mutation = { accepted: false, skipped: "positive_control_not_admitted" };
  const after = await inputs();
  const sourceUnchanged = source.size === after.size && [...source].every(([path, bytes]) => sha256(after.get(path) ?? "") === sha256(bytes));
  const stageUnchanged = await conformanceStageUnchanged(positive) && (!mutant || await conformanceStageUnchanged(mutant));
  let toolsUnchanged = true;
  for (const [name, tool] of Object.entries(tools)) {
    if (sha256(await readFile(tool.path)) !== tool.sha256 || await realpath(resolve(toolDirectory, name)) !== tool.path) toolsUnchanged = false;
  }
  for (const [path, hash] of Object.entries(dependencyEntries)) if (sha256(await readProofFile(path, 16_777_216)) !== hash) toolsUnchanged = false;
  if (!sourceUnchanged || !stageUnchanged || !toolsUnchanged) failures.push("conformance_inputs_changed");
  if (traces.length !== manifest.expectedTraceCount) failures.push("conformance_trace_inventory_incomplete");
  await writeFile(resolve(run, "traces.json"), JSON.stringify(traces, null, 2) + "\n");
  const receipt = { schemaVersion: 1, claim: manifest.claim, git: await gitIdentity(),
    inputSha256: Object.fromEntries([...source].map(([path, bytes]) => [path, sha256(bytes)])), tools, dependencyEntries, environment, results,
    stages: { positive, mutant: mutant ?? null }, mutationSourceSha256: mutant?.sourceSha256[mutations.mutations[0].source] ?? null, traceCount: traces.length,
    traceSha256: sha256(await readFile(resolve(run, "traces.json"))), sourceUnchanged, stageUnchanged, toolsUnchanged, failures,
    limitations: [...manifest.limitations, "Installed locked dependencies, Cargo cache/config, native linker, compilers, runtime, filesystem and source-to-model abstraction remain trusted."] };
  await writeFile(resolve(run, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ receipt: relative(root, resolve(run, "receipt.json")), traceCount: traces.length, failures }));
  return failures.length === 0;
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 2) throw new Error("usage: bun scripts/assurance-conformance.ts (no arguments)");
    if (!await runConformance()) process.exitCode = 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
