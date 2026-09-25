import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const proofRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export type ProofProcess = { command: string; args: string[]; exitCode: number | null;
  signal: string | null; timedOut: boolean; outputExceeded: boolean; output: string; elapsedMs: number };

export async function readProofFile(path: string, limit = 8_388_608) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > limit) throw new Error(`invalid_proof_file:${path}`);
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error(`proof_file_grew:${path}`);
  return bytes;
}

/** Every subprocess owns a process group; cancellation kills and joins that group. */
export async function runProofProcess(command: string, args: string[], cwd: string,
  env: NodeJS.ProcessEnv = process.env, timeoutMs = 120_000, maxOutputBytes = 4_194_304): Promise<ProofProcess> {
  return new Promise((done, reject) => {
    const started = performance.now();
    const child = spawn(command, args, { cwd, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let output = "", count = 0, timedOut = false, outputExceeded = false;
    const kill = () => {
      if (!child.pid) return;
      try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") reject(error); }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    const collect = (chunk: Buffer) => {
      count += chunk.length;
      if (count > maxOutputBytes) { outputExceeded = true; kill(); return; }
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      done({ command, args, exitCode, signal, timedOut, outputExceeded, output, elapsedMs: Math.round(performance.now() - started) });
    });
  });
}

export function completed(result: ProofProcess) {
  return !result.timedOut && !result.outputExceeded && result.signal === null && result.exitCode !== null;
}

export async function proofRunDirectory(kind: string) {
  const parent = resolve(proofRoot, "target/assurance", kind);
  await mkdir(parent, { recursive: true });
  return mkdtemp(resolve(parent, "run-"));
}

export async function sourceSnapshot(extraPaths: string[]) {
  const files = await readdir(resolve(proofRoot, "crates/aicharts-metrics/src"), { withFileTypes: true });
  if (files.length > 32 || files.some(file => !file.isFile() || !file.name.endsWith(".rs"))) throw new Error("unexpected_kernel_source_layout");
  const paths = ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "crates/aicharts-metrics/Cargo.toml",
    ...files.map(file => `crates/aicharts-metrics/src/${file.name}`), ...extraPaths].sort();
  const bytes = new Map<string, Buffer>();
  for (const path of new Set(paths)) bytes.set(path, await readProofFile(resolve(proofRoot, path)));
  return { bytes, hashes: Object.fromEntries([...bytes].map(([path, value]) => [path, sha256(value)])) };
}

export async function snapshotUnchanged(snapshot: Awaited<ReturnType<typeof sourceSnapshot>>) {
  const current = await sourceSnapshot(Object.keys(snapshot.hashes).filter(path => !path.startsWith("crates/aicharts-metrics/src/")));
  return current.bytes.size === snapshot.bytes.size && Object.entries(snapshot.hashes).every(([path, hash]) => current.hashes[path] === hash);
}

/** Keep callers from injecting compiler wrappers, proof imports or preload
 * hooks. Installed Cargo config, linkers and runtime libraries remain trusted. */
export function proofEnvironment(source: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["PATH", "HOME", "SystemRoot", "SYSTEMROOT", "WINDIR", "TMPDIR", "TEMP", "TMP", "CI", "CARGO_HOME",
    "SDKROOT", "MACOSX_DEPLOYMENT_TARGET", "DEVELOPER_DIR"]) if (source[key] !== undefined) environment[key] = source[key];
  return { ...environment, CARGO_NET_OFFLINE: "true" };
}

export async function proofFilesUnchanged(base: string, hashes: Record<string, string>, limit = 8_388_608) {
  try {
    for (const [path, hash] of Object.entries(hashes)) if (sha256(await readProofFile(resolve(base, path), limit)) !== hash) return false;
    return true;
  } catch { return false; }
}

export const mutationSchema = z.object({ id: z.string().regex(/^[a-z-]+$/u),
  source: z.string().regex(/^crates\/aicharts-metrics\/src\/[a-z]+\.rs$/u),
  exactBefore: z.string().min(1), exactAfter: z.string().min(1), harness: z.string().min(1),
  expectedFailedAssertion: z.string().min(1), requireSingleSourceMatch: z.literal(true) }).strict();
export const mutationsSchema = z.object({ schemaVersion: z.literal(1), scope: z.string(),
  mutations: z.array(mutationSchema).length(3) }).strict();
export type KernelMutation = z.infer<typeof mutationSchema>;
export type SourceMutation = Pick<KernelMutation, "id" | "source" | "exactBefore" | "exactAfter">;

export function applyExactMutation(source: string, mutation: SourceMutation) {
  if (source.split(mutation.exactBefore).length !== 2) throw new Error(`mutation_source_drift:${mutation.id}`);
  return source.replace(mutation.exactBefore, mutation.exactAfter);
}

/** Compile unchanged production bytes in a dependency-free, explicitly recorded workspace.
 * The miniature workspace preserves inherited package values; only member enumeration differs.
 * It lets negative controls mutate isolated files without racing the working tree. */
export async function stageKernel(run: string, name: string, snapshot: Awaited<ReturnType<typeof sourceSnapshot>>, mutation?: SourceMutation) {
  if (!/^[a-z][a-z0-9-]*$/u.test(name)) throw new Error("invalid_kernel_stage_name");
  const stage = resolve(run, name);
  const rootManifest = snapshot.bytes.get("Cargo.toml")!.toString("utf8");
  const packageSection = /^\[workspace\.package\]\n([\s\S]*?)(?=\n\[|(?![\s\S]))/mu.exec(rootManifest)?.[0];
  if (!packageSection) throw new Error("missing_workspace_package");
  const crateManifest = snapshot.bytes.get("crates/aicharts-metrics/Cargo.toml")!.toString("utf8");
  if (/\[(?:[^\]]*\.)?(?:dependencies|build-dependencies|dev-dependencies)(?:\.|\])/u.test(crateManifest)) throw new Error("kernel_no_longer_dependency_free");
  const version = /^version = "([0-9]+\.[0-9]+\.[0-9]+)"$/mu.exec(packageSection)?.[1];
  if (!version) throw new Error("unsupported_kernel_package_version");
  if (mutation && (!snapshot.bytes.has(mutation.source) || mutation.source.endsWith("/proofs.rs") || mutation.source.endsWith("/tests.rs"))) throw new Error("mutation_must_target_production");
  await mkdir(stage); // Every control gets a fresh directory, never old outputs.
  await mkdir(resolve(stage, "crates/aicharts-metrics/src"), { recursive: true });
  const staged: Record<string, string> = {};
  for (const [path, original] of snapshot.bytes) {
    if (!path.startsWith("crates/aicharts-metrics/") && path !== "rust-toolchain.toml") continue;
    const bytes = mutation?.source === path ? Buffer.from(applyExactMutation(original.toString("utf8"), mutation)) : original;
    await writeFile(resolve(stage, path), bytes);
    staged[path] = sha256(bytes);
  }
  const workspace = `[workspace]\nmembers = ["crates/aicharts-metrics"]\nresolver = "2"\n\n${packageSection}\n`;
  const lock = `# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\n# Generated isolated proof workspace: no external dependencies.\nversion = 4\n\n[[package]]\nname = "aicharts-metrics"\nversion = "${version}"\n`;
  await writeFile(resolve(stage, "Cargo.toml"), workspace);
  await writeFile(resolve(stage, "Cargo.lock"), lock);
  staged["Cargo.toml"] = sha256(workspace); staged["Cargo.lock"] = sha256(lock);
  return { path: stage, sourceSha256: staged, mutation: mutation?.id ?? null };
}

export async function kernelStageUnchanged(stage: Awaited<ReturnType<typeof stageKernel>>) {
  if (!await proofFilesUnchanged(stage.path, stage.sourceSha256)) return false;
  try {
    const crate = resolve(stage.path, "crates/aicharts-metrics");
    if ((await readdir(crate)).sort().join(",") !== "Cargo.toml,src") return false;
    const names = await readdir(resolve(crate, "src"));
    const expected = Object.keys(stage.sourceSha256).filter(path => path.startsWith("crates/aicharts-metrics/src/")).map(path => path.slice(path.lastIndexOf("/") + 1));
    return names.sort().join(",") === expected.sort().join(",");
  } catch { return false; }
}

export async function gitIdentity() {
  const result = await runProofProcess("git", ["rev-parse", "HEAD", "HEAD^{tree}"], proofRoot);
  if (!completed(result) || result.exitCode !== 0) throw new Error("git_identity_unavailable");
  const [head, committedTree] = result.output.trim().split("\n");
  return { head, committedTree, scope: "Committed base plus exact source hashes; uncommitted bytes are not represented by HEAD." };
}
