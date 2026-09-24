import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = resolve(root, "vendor/tokscale-core");
const identifier = z.string().regex(/^[a-z0-9][a-z0-9]*(?:-[a-z0-9]+)*$/u);
export const qualificationSchema = z.object({
  schemaVersion: z.literal(1), claim: z.literal("synthetic-adapter-evidence-only"),
  upstreamCommit: z.literal("d8fd670a46857e5290e71b10245dc522a344fc17"),
  bounds: z.object({ buildTimeoutMs: z.literal(180_000), testTimeoutMs: z.literal(120_000),
    maxOutputBytes: z.literal(8_388_608), maxSourceBytes: z.literal(67_108_864), workers: z.literal(1) }).strict(),
  groups: z.array(z.object({ id: identifier, prefix: z.string().regex(/^(?:sessions::[a-z_]+|offline)::tests::$/u),
    expectedTests: z.number().int().min(1).max(5_000) }).strict()).min(1).max(64),
  adapters: z.array(z.object({ selector: identifier, owner: identifier,
    qualification: z.enum(["fixture-supported", "limited", "unsupported"]),
    testGroups: z.array(identifier).min(1).max(8), formatVersion: z.string().min(1).max(128),
    incremental: z.enum(["unqualified", "qualified-append", "qualified-reparse"]),
    limits: z.array(z.string().min(1).max(256)).min(1).max(8) }).strict()).min(1).max(64),
}).strict();
type Manifest = z.infer<typeof qualificationSchema>;
export type ProcessResult = { code: number | null; signal: string | null; output: string; timedOut: boolean; outputExceeded: boolean };
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const complete = (result: ProcessResult) => result.code === 0 && result.signal === null && !result.timedOut && !result.outputExceeded;

export function validateRoster(manifest: Manifest, selectors: readonly string[]): void {
  const groups = new Set(manifest.groups.map(group => group.id));
  const families = new Map([["codex", "codex"], ["claude", "claude"], ["cursor", "cursor"],
    ["devin-cli", "devin"], ["devin-desktop", "devin"]]);
  const prefixes = new Map([["codex", "sessions::codex::tests::"], ["claude", "sessions::claudecode::tests::"],
    ["cursor", "sessions::cursor::tests::"], ["devin", "sessions::devin::tests::"], ["offline", "offline::tests::"]]);
  if (groups.size !== manifest.groups.length || new Set(manifest.groups.map(group => group.prefix)).size !== manifest.groups.length
    || manifest.groups.some(group => prefixes.get(group.id) !== group.prefix)
    || new Set(manifest.adapters.map(adapter => adapter.selector)).size !== manifest.adapters.length
    || JSON.stringify(manifest.adapters.map(adapter => adapter.selector).sort()) !== JSON.stringify([...selectors].sort())
    || manifest.adapters.some(adapter => !selectors.includes(adapter.owner) || adapter.testGroups.some(group => !groups.has(group))
      || adapter.owner !== (adapter.selector === "9router" ? "gjc" : adapter.selector)
      || (adapter.qualification === "fixture-supported" && (!families.has(adapter.selector)
        || !adapter.testGroups.includes(families.get(adapter.selector)!))))) {
    throw new Error("adapter_qualification_roster_invalid");
  }
}

/** Cargo discovery must name real tests, not textual #[test] attributes. */
export function selectedTests(manifest: Manifest, result: ProcessResult): string[] {
  if (!complete(result)) throw new Error("adapter_discovery_incomplete");
  const tests = result.output.split(/\r?\n/u).filter(line => line.endsWith(": test")).map(line => line.slice(0, -6));
  const summary = [...result.output.matchAll(/^(\d+) tests, (\d+) benchmarks$/gmu)];
  if (summary.length !== 1 || Number(summary[0][1]) !== tests.length || Number(summary[0][2]) !== 0
    || new Set(tests).size !== tests.length || tests.some(name => !/^[A-Za-z0-9_:]+$/u.test(name))) throw new Error("adapter_discovery_invalid");
  const selected: string[] = [];
  for (const group of manifest.groups) {
    const names = tests.filter(name => name.startsWith(group.prefix));
    if (names.length !== group.expectedTests) throw new Error(`adapter_test_count_drift:${group.id}`);
    selected.push(...names);
  }
  if (new Set(selected).size !== selected.length) throw new Error("adapter_duplicate_test_selection");
  return selected.sort();
}

/** Every selected test must have its own terminal success; skipped, truncated,
 * resource-limited and vacuous runs cannot qualify an adapter. */
export function validateResults(expected: readonly string[], result: ProcessResult): void {
  const passed = [...result.output.matchAll(/^test ([A-Za-z0-9_:]+) \.\.\. ok$/gmu)].map(match => match[1]).sort();
  const summary = [...result.output.matchAll(/^test result: ok\. (\d+) passed; 0 failed; 0 ignored; 0 measured; \d+ filtered out; finished in [0-9.]+s$/gmu)];
  if (!complete(result) || expected.length === 0 || summary.length !== 1 || Number(summary[0][1]) !== expected.length
    || JSON.stringify(passed) !== JSON.stringify([...expected].sort())) throw new Error("adapter_qualification_incomplete");
}

async function run(command: string, args: readonly string[], timeoutMs: number, maximum: number,
  environment: NodeJS.ProcessEnv = process.env): Promise<ProcessResult> {
  return new Promise((resolveResult, reject) => {
    // Cargo may spawn rustc/linker children. This process owns its group; a
    // deadline kills that group, never an unrelated host process or lease.
    const grouped = process.platform !== "win32";
    const child = spawn(command, [...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: grouped, env: environment });
    let output = "", bytes = 0, timedOut = false, outputExceeded = false;
    const stop = () => {
      try { if (grouped && child.pid !== undefined) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); }
      catch { /* The owned process may already have exited. */ }
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const collect = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maximum) { outputExceeded = true; stop(); return; }
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => { clearTimeout(timer); resolveResult({ code, signal, output, timedOut, outputExceeded }); });
  });
}

async function sourceFiles(): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>(); let total = 0;
  const visit = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "target" || entry.name === ".git") continue;
      const file = resolve(directory, entry.name), key = relative(vendor, file);
      if (entry.isSymbolicLink()) throw new Error("adapter_source_symlink");
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!entry.isFile()) throw new Error("adapter_source_not_regular");
      const size = (await lstat(file)).size;
      if (size > 16_777_216 || total + size > 67_108_864 || files.size >= 4_096) throw new Error("adapter_source_limit");
      const bytes = await readFile(file); total += bytes.length;
      if (bytes.length !== size || total > 67_108_864) throw new Error("adapter_source_changed");
      files.set(key, bytes);
    }
  };
  await visit(vendor); return files;
}

export async function runAdapters() {
  const runnerBytes = await readFile(fileURLToPath(import.meta.url));
  const registryPath = resolve(root, "data/usage-registry.json"), toolchainPath = resolve(root, "rust-toolchain.toml");
  const registryBytes = await readFile(registryPath), toolchainBytes = await readFile(toolchainPath);
  const inputs = await sourceFiles(), manifestBytes = inputs.get("QUALIFICATION.json"), cargo = inputs.get("Cargo.toml");
  if (!manifestBytes || !cargo || !inputs.has("Cargo.lock")) throw new Error("adapter_inputs_missing");
  const manifest = qualificationSchema.parse(JSON.parse(manifestBytes.toString("utf8")) as unknown);
  const registry = z.object({ clients: z.array(z.object({ id: identifier })) }).passthrough().parse(
    JSON.parse(registryBytes.toString("utf8")) as unknown);
  validateRoster(manifest, registry.clients.map(client => client.id));
  const directory = resolve(root, "target/assurance/adapters"); await mkdir(directory, { recursive: true });
  const output = await mkdtemp(resolve(directory, "run-")), stage = resolve(output, "source");
  for (const [name, bytes] of inputs) { const file = resolve(stage, name); await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes); }
  // The original package is explicitly excluded from the parent workspace.
  // Its immutable staged copy needs the equivalent standalone root marker.
  if (/^\[workspace\]/mu.test(cargo.toString("utf8"))) throw new Error("adapter_workspace_contract_changed");
  const stagedManifest = Buffer.concat([cargo, Buffer.from("\n[workspace]\n")]);
  await writeFile(resolve(stage, "Cargo.toml"), stagedManifest);
  const tools: Record<string, { path: string; sha256: string }> = {};
  for (const name of ["cargo", "rustc"]) {
    const located = await run("rustup", ["which", "--toolchain", "1.97.1", name], 5_000, 16_384);
    const path = located.output.trim();
    if (!complete(located) || !isAbsolute(path) || !(await lstat(path)).isFile()) throw new Error("adapter_tool_not_found");
    tools[name] = { path, sha256: digest(await readFile(path)) };
  }
  const tool = await run(tools.rustc.path, ["--version", "--verbose"], 5_000, 16_384);
  if (!complete(tool) || !/^rustc 1\.97\.1 /mu.test(tool.output)) throw new Error("adapter_rust_toolchain_mismatch");
  const target = resolve(root, "target/adapter-qualification");
  const buildArgs = ["test", "--manifest-path", resolve(stage, "Cargo.toml"), "--locked", "--offline", "--lib", "--no-run",
    "--target-dir", target, "--message-format=json-render-diagnostics", "--jobs", "2"];
  const build = await run(tools.cargo.path, buildArgs, manifest.bounds.buildTimeoutMs, manifest.bounds.maxOutputBytes,
    { ...process.env, RUSTC: tools.rustc.path });
  await writeFile(resolve(output, "build.log"), build.output);
  if (!complete(build)) throw new Error(`adapter_build_failed:${relative(root, output)}`);
  const executables: string[] = [];
  for (const line of build.output.split(/\r?\n/u)) {
    if (!line.startsWith("{")) continue;
    const value: unknown = JSON.parse(line);
    const artifact = z.object({ reason: z.literal("compiler-artifact"), executable: z.string(),
      target: z.object({ name: z.literal("tokscale_core") }).passthrough(), profile: z.object({ test: z.literal(true) }).passthrough() }).passthrough().safeParse(value);
    if (artifact.success) executables.push(artifact.data.executable);
  }
  if (executables.length !== 1 || !isAbsolute(executables[0]) || relative(target, executables[0]).startsWith("..")
    || !(await lstat(executables[0])).isFile()) throw new Error("adapter_executable_identity_invalid");
  const executable = executables[0], executableSha256 = digest(await readFile(executable));
  const discovery = await run(executable, ["--list"], 10_000, manifest.bounds.maxOutputBytes);
  await writeFile(resolve(output, "discovery.log"), discovery.output);
  const expected = selectedTests(manifest, discovery);
  const testArgs = [...manifest.groups.map(group => group.prefix), "--test-threads=1"];
  const tests = await run(executable, testArgs, manifest.bounds.testTimeoutMs, manifest.bounds.maxOutputBytes);
  await writeFile(resolve(output, "tests.log"), tests.output); validateResults(expected, tests);
  for (const [name, bytes] of inputs) if (digest(await readFile(resolve(stage, name))) !== digest(name === "Cargo.toml" ? stagedManifest : bytes)) {
    throw new Error("adapter_staged_inputs_changed");
  }
  const currentInputs = await sourceFiles();
  if (currentInputs.size !== inputs.size || [...inputs].some(([name, bytes]) => digest(currentInputs.get(name) ?? "") !== digest(bytes))
    || digest(await readFile(fileURLToPath(import.meta.url))) !== digest(runnerBytes)
    || digest(await readFile(registryPath)) !== digest(registryBytes) || digest(await readFile(toolchainPath)) !== digest(toolchainBytes)) {
    throw new Error("adapter_current_inputs_changed");
  }
  for (const tool of Object.values(tools)) if (digest(await readFile(tool.path)) !== tool.sha256) throw new Error("adapter_tool_changed");
  if (digest(await readFile(executable)) !== executableSha256) throw new Error("adapter_test_executable_changed");
  const receipt = { schemaVersion: 1, claim: manifest.claim, upstreamCommit: manifest.upstreamCommit,
    sourceHashes: Object.fromEntries([...inputs].map(([name, bytes]) => [name, digest(bytes)])),
    stagedManifestSha256: digest(stagedManifest), executableSha256, tools,
    integrationHashes: { "data/usage-registry.json": digest(registryBytes), "rust-toolchain.toml": digest(toolchainBytes) },
    runnerSha256: digest(runnerBytes), toolchain: tool.output.trim(),
    build: { command: tools.cargo.path, args: buildArgs, rustc: tools.rustc.path, exitCode: build.code },
    tests: { executable: relative(root, executable), args: testArgs, exitCode: tests.code, passed: expected.length, names: expected },
    limitations: ["Synthetic fixtures only; no installed-client/provider qualification.",
      "Vendor Cargo.lock qualifies this adapter build; workspace import tests separately qualify its production dependency graph.",
      "No incremental or complete-schema support follows from test presence alone."] };
  await writeFile(resolve(output, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return { passed: expected.length, receipt: relative(root, resolve(output, "receipt.json")) };
}

if (import.meta.main) {
  try { console.log(JSON.stringify(await runAdapters())); }
  catch (error) { console.error(error instanceof Error ? error.message : "adapter_check_failed"); process.exitCode = 1; }
}
