import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modelRoot = resolve(root, "verify/tla");
const identifier = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);
const operator = z.string().regex(/^[A-Z][A-Za-z0-9]*$/u);
const modelCaseSchema = z.object({
  id: identifier, module: z.enum(["M1Restore", "M4Contributions", "M4Supersession"]),
  kind: z.enum(["counterexample", "sanity", "witness"]), invariant: operator.nullable(),
  config: z.string().regex(/^configs\/[a-z0-9-]+\.cfg$/u),
  requiredActions: z.array(operator), minTraceStates: z.number().int().min(0).max(100),
  minDistinctStates: z.number().int().min(2).max(100_000),
  expectedDistinctStates: z.number().int().min(2).max(100_000).nullable(),
}).strict();
const manifestSchema = z.object({
  schemaVersion: z.literal(1), claim: z.literal("finite-baseline-model-evidence-only"),
  bounds: z.object({ workers: z.literal(1), heapMiB: z.literal(256), timeoutMs: z.literal(30_000),
    maxOutputBytes: z.literal(1_048_576), maxDistinctStates: z.literal(100_000) }).strict(),
  cases: z.array(modelCaseSchema).min(1).max(32),
}).strict();
const pinSchema = z.object({
  schemaVersion: z.literal(1),
  tlc: z.object({ release: z.literal("1.7.4"), reportedVersion: z.literal("2.19"), url: z.string().url(),
    sha256: z.literal("936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"),
    upstreamSha1: z.literal("bee4a54f3ee3d4afc347c3240ec2d9e93b075104") }).strict(),
  java: z.object({ runtimeVersion: z.literal("21.0.12.1+1-LTS"), vendor: z.literal("Eclipse Adoptium"),
    localExecutable: z.string().min(1), qualifiedPlatform: z.literal("macOS-aarch64"),
    localArchiveSha256: z.literal("dec50fc6f9fcd4fe3ae8cabf5a5fa68f6afc48841f7698e468e9aa5d54beed84") }).strict(),
  defaultJar: z.string().min(1),
}).strict();

export type ModelCase = z.infer<typeof modelCaseSchema>;
export type ProcessResult = { exitCode: number | null; signal: string | null; output: string;
  timedOut: boolean; outputExceeded: boolean };
type ToolMessage = { code: number; severity: number; body: string };
export type TraceState = { index: number; action: string; location: string; state: string };
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function boundedFile(file: string, maximumBytes = 1_048_576): Promise<Buffer> {
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size > maximumBytes) throw new Error("oversized_or_invalid_formal_input");
  const bytes = await readFile(file);
  if (bytes.length > maximumBytes) throw new Error("formal_input_changed_beyond_limit");
  return bytes;
}

/** Parse the pinned TLC -tool protocol, not newer CLI features absent in 1.7.4. */
export function toolMessages(output: string): ToolMessage[] {
  return [...output.matchAll(/@!@!@STARTMSG (\d+):(\d+) @!@!@\r?\n([\s\S]*?)@!@!@ENDMSG \1 @!@!@/gu)]
    .map(match => ({ code: Number(match[1]), severity: Number(match[2]), body: match[3].trim() }));
}

/** This suite admits a deliberately small, single-line TLC config grammar. */
export function validateTlcConfig(config: string, modelCase: ModelCase): string[] {
  const lines = config.split(/\r?\n/u).map(line => line.split("\\*")[0].trim()).filter(Boolean);
  const errors: string[] = [];
  for (const line of lines) if (!/^(?:INIT Init|NEXT Next|CHECK_DEADLOCK TRUE|INVARIANT [A-Z][A-Za-z0-9]*|CONSTANT [A-Z][A-Za-z0-9]* = (?:TRUE|FALSE|\{[a-zA-Z0-9_, ]+\}))$/u.test(line)) errors.push("unreviewed configuration directive");
  for (const declaration of ["INIT Init", "NEXT Next", "CHECK_DEADLOCK TRUE", "INVARIANT TypeOK"]) {
    if (lines.filter(line => line === declaration).length !== 1) errors.push(`missing or duplicate ${declaration}`);
  }
  if (new Set(lines).size !== lines.length) errors.push("duplicate configuration declaration");
  if (modelCase.invariant !== null && !lines.includes(`INVARIANT ${modelCase.invariant}`)) errors.push("expected invariant absent from configuration");
  return errors;
}

export function evaluateTlc(modelCase: ModelCase, result: ProcessResult) {
  const errors: string[] = [];
  const messages = toolMessages(result.output);
  const unframed = result.output.replace(/@!@!@STARTMSG (\d+):(\d+) @!@!@\r?\n[\s\S]*?@!@!@ENDMSG \1 @!@!@/gu, "");
  if (/@!@!@(?:STARTMSG|ENDMSG)/u.test(unframed)) errors.push("incomplete or malformed TLC tool frame");
  const stats = messages.filter(message => message.code === 2199);
  const match = stats.length === 1 ? /^(\d[\d,]*) states generated, (\d[\d,]*) distinct states found, (\d[\d,]*) states left on queue\.$/u.exec(stats[0].body) : null;
  const counts = match ? { generated: Number(match[1].replaceAll(",", "")), distinct: Number(match[2].replaceAll(",", "")), queued: Number(match[3].replaceAll(",", "")) } : null;
  const trace: TraceState[] = [];
  for (const message of messages.filter(item => item.code === 2217)) {
    const state = /^(\d+): <([^>]+)>\n([\s\S]+)$/u.exec(message.body);
    if (!state) { errors.push("unparseable trace state"); continue; }
    trace.push({ index: Number(state[1]), action: state[2] === "Initial predicate" ? "Init" : state[2].split(" ")[0], location: state[2], state: state[3] });
  }
  if (result.timedOut || result.outputExceeded || result.signal !== null) errors.push("incomplete or resource-limited run");
  if (!messages.some(message => message.code === 2262 && message.body.startsWith("TLC2 Version 2.19 "))) errors.push("wrong or missing TLC version");
  if (!messages.some(message => message.code === 2186 && message.body.startsWith("Finished in "))) errors.push("missing terminal TLC message");
  if (!counts || !Number.isSafeInteger(counts.generated) || !Number.isSafeInteger(counts.distinct) || !Number.isSafeInteger(counts.queued)
      || counts.distinct < modelCase.minDistinctStates || counts.distinct > 100_000 || counts.generated < counts.distinct || counts.queued < 0) errors.push("missing, vacuous or excessive exploration counts");
  if (counts && modelCase.expectedDistinctStates !== null && counts.distinct !== modelCase.expectedDistinctStates) errors.push("reachable-state count drift");
  const violations = messages.filter(message => message.code === 2110);
  if (modelCase.kind === "sanity") {
    if (modelCase.invariant !== null || result.exitCode !== 0 || violations.length !== 0
        || !messages.some(message => message.body.includes("Model checking completed. No error has been found."))
        || counts?.queued !== 0 || messages.some(message => message.severity === 1)) errors.push("sanity exploration did not complete successfully");
  } else {
    if (modelCase.invariant === null || result.exitCode !== 12 || violations.length !== 1
        || violations[0].body !== `Invariant ${modelCase.invariant} is violated.`) errors.push("expected invariant counterexample was not observed");
    if (messages.some(message => message.severity === 1 && ![2110, 2121].includes(message.code))) errors.push("unrelated TLC failure");
    if (trace.length < modelCase.minTraceStates || trace[0]?.action !== "Init" || trace.some((state, index) => state.index !== index + 1)) errors.push("missing or trivial counterexample trace");
    let position = 0;
    for (const state of trace) if (state.action === modelCase.requiredActions[position]) position++;
    if (position !== modelCase.requiredActions.length) errors.push("required mechanism absent from trace");
  }
  return { ok: errors.length === 0, errors, counts, trace };
}

/** No shell, no provider access. A timed out/oversized JVM is killed and joined. */
async function runProcess(command: string, args: readonly string[], timeoutMs: number, maxOutputBytes: number): Promise<ProcessResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, [...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", bytes = 0, timedOut = false, outputExceeded = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    const collect = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) { outputExceeded = true; child.kill("SIGKILL"); return; }
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", (exitCode, signal) => { clearTimeout(timer); resolveResult({ exitCode, signal, output, timedOut, outputExceeded }); });
  });
}

export async function runTla(options: { java?: string; jar?: string; output?: string; case?: string } = {}) {
  const runnerBytes = await boundedFile(fileURLToPath(import.meta.url));
  const manifestText = (await boundedFile(resolve(modelRoot, "cases.json"))).toString("utf8");
  const pinText = (await boundedFile(resolve(modelRoot, "toolchain.json"))).toString("utf8");
  const manifest = manifestSchema.parse(JSON.parse(manifestText) as unknown);
  const pin = pinSchema.parse(JSON.parse(pinText) as unknown);
  if (new Set(manifest.cases.map(item => item.id)).size !== manifest.cases.length) throw new Error("duplicate_model_case");
  if (manifest.cases.some(item => item.kind === "sanity" && item.expectedDistinctStates === null)) throw new Error("missing_complete_state_count");
  const selected = options.case ? manifest.cases.filter(item => item.id === options.case) : manifest.cases;
  if (selected.length === 0) throw new Error("unknown_model_case");
  const moduleSnapshots = new Map(await Promise.all([...new Set(selected.map(item => item.module))].map(async name =>
    [name, await boundedFile(resolve(modelRoot, `${name}.tla`))] as const)));
  const configSnapshots = new Map(await Promise.all(selected.map(async item =>
    [item.config, await boundedFile(resolve(modelRoot, item.config))] as const)));
  const java = resolve(root, options.java ?? pin.java.localExecutable), jar = resolve(root, options.jar ?? pin.defaultJar);
  const jarBytes = await boundedFile(jar, 32 * 1024 * 1024);
  if (sha256(jarBytes) !== pin.tlc.sha256) throw new Error("tlc_artifact_checksum_mismatch");
  const javaExecutableSha256 = sha256(await boundedFile(java, 32 * 1024 * 1024));
  const version = await runProcess(java, ["-version"], 5_000, 16_384);
  if (version.exitCode !== 0 || version.signal !== null || version.timedOut || version.outputExceeded
      || !version.output.includes(`Temurin-${pin.java.runtimeVersion.replace(/-LTS$/u, "")} (build ${pin.java.runtimeVersion})`)) throw new Error("java_runtime_version_mismatch");
  const outputRoot = resolve(root, options.output ?? "target/assurance/tla");
  await mkdir(outputRoot, { recursive: true });
  const runRoot = await mkdtemp(resolve(outputRoot, "run-"));
  await writeFile(resolve(runRoot, "cases.json"), manifestText, { flag: "wx", mode: 0o400 });
  await writeFile(resolve(runRoot, "toolchain.json"), pinText, { flag: "wx", mode: 0o400 });
  const stagedJar = resolve(runRoot, "tla2tools.jar");
  await writeFile(stagedJar, jarBytes, { flag: "wx", mode: 0o400 });
  const results = [];
  for (const modelCase of selected) {
    const caseDirectory = resolve(runRoot, modelCase.id);
    await mkdir(caseDirectory);
    const moduleBytes = moduleSnapshots.get(modelCase.module), configBytes = configSnapshots.get(modelCase.config);
    if (!moduleBytes || !configBytes) throw new Error("missing_model_snapshot");
    const config = configBytes.toString("utf8");
    const configErrors = validateTlcConfig(config, modelCase);
    if (configErrors.length !== 0) throw new Error(`unreviewed_model_configuration:${configErrors.join(",")}`);
    // Execute exactly the captured bytes. Parallel source edits cannot change
    // what the model/config digests in this receipt describe.
    const stagedModule = resolve(caseDirectory, `${modelCase.module}.tla`), stagedConfig = resolve(caseDirectory, `${modelCase.id}.cfg`);
    await writeFile(stagedModule, moduleBytes, { flag: "wx", mode: 0o400 });
    await writeFile(stagedConfig, configBytes, { flag: "wx", mode: 0o400 });
    const args = ["-Xmx256m", "-XX:MaxDirectMemorySize=64m", "-XX:+UseParallelGC", "-XX:ParallelGCThreads=1", "-XX:ConcGCThreads=1",
      "-jar", stagedJar, "-tool", "-workers", "1", "-fp", "0", "-seed", "1", "-maxSetSize", "100000",
      "-config", stagedConfig, "-metadir", resolve(caseDirectory, "states"), stagedModule];
    const processResult = await runProcess(java, args, manifest.bounds.timeoutMs, manifest.bounds.maxOutputBytes);
    const evaluated = evaluateTlc(modelCase, processResult);
    if (sha256(await boundedFile(stagedModule)) !== sha256(moduleBytes) || sha256(await boundedFile(stagedConfig)) !== sha256(configBytes)) {
      evaluated.errors.push("staged model or configuration changed during execution"); evaluated.ok = false;
    }
    await writeFile(resolve(caseDirectory, "tlc.log"), processResult.output);
    await writeFile(resolve(caseDirectory, "trace.json"), `${JSON.stringify({ schemaVersion: 1, case: modelCase.id, invariant: modelCase.invariant,
      provenance: "TLC 1.7.4 structured output; TLA values retained verbatim, not production adapter replay", states: evaluated.trace }, null, 2)}\n`);
    results.push({ id: modelCase.id, kind: modelCase.kind, ok: evaluated.ok, errors: evaluated.errors,
      invariant: modelCase.invariant, exitCode: processResult.exitCode, signal: processResult.signal,
      timedOut: processResult.timedOut, outputExceeded: processResult.outputExceeded, counts: evaluated.counts,
      traceStates: evaluated.trace.length, actions: evaluated.trace.map(state => state.action),
      moduleSha256: sha256(moduleBytes), configSha256: sha256(configBytes), outputSha256: sha256(processResult.output),
      command: [java, ...args], artifacts: relative(root, caseDirectory) });
    console.log(JSON.stringify({ case: modelCase.id, kind: modelCase.kind, ok: evaluated.ok, counts: evaluated.counts, errors: evaluated.errors }));
  }
  if (sha256(await boundedFile(stagedJar, 32 * 1024 * 1024)) !== pin.tlc.sha256
      || sha256(await boundedFile(java, 32 * 1024 * 1024)) !== javaExecutableSha256) throw new Error("tool_artifact_changed_during_execution");
  if (sha256(await boundedFile(fileURLToPath(import.meta.url))) !== sha256(runnerBytes)) throw new Error("runner_source_changed_during_execution");
  const receipt = { schemaVersion: 1, recordedAt: new Date().toISOString(), claim: manifest.claim,
    limitations: ["Expected violations confirm reachable baseline model failures, never production safety.",
      "Sanity configurations check only their listed invariants over finite domains; no liveness property or implementation refinement is proved.",
      "M1 source correspondence is reviewed mechanism mapping; its Durable Object failure schedules have not been executed."],
    completeSuite: selected.length === manifest.cases.length, ok: results.every(result => result.ok),
    toolchain: { ...pin, observedJava: version.output.trim(), javaExecutableSha256,
      observedHost: { platform: process.platform, architecture: process.arch },
      javaBinding: "Runtime version and launcher bytes checked; full JRE libraries are a trusted environmental boundary. Archive digest records provisioning evidence, not a full installed-image measurement." },
    sourceSha256: { "scripts/assurance-tla.ts": sha256(runnerBytes),
      "verify/tla/cases.json": sha256(manifestText), "verify/tla/toolchain.json": sha256(pinText) }, results };
  const receiptPath = resolve(runRoot, "receipt.json");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ ok: receipt.ok, completeSuite: receipt.completeSuite, claim: receipt.claim, receipt: relative(root, receiptPath) }));
  return receipt;
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: false,
      options: { java: { type: "string" }, jar: { type: "string" }, output: { type: "string" }, case: { type: "string" } } });
    for (const value of [values.java, values.jar, values.output]) if (value && !isAbsolute(value) && value.split(/[\\/]/u).includes("..")) throw new Error("outside_relative_tool_path");
    if (!(await runTla(values)).ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "tla_runner_failed" }));
    process.exitCode = 1;
  }
}
