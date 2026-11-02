import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const securityRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export type SecurityProcess = { command: string; args: string[]; exitCode: number | null;
  signal: string | null; timedOut: boolean; outputExceeded: boolean; output: string; elapsedMs: number };

/** Every subprocess owns a process group; cancellation kills and joins that group. */
export async function runSecurityProcess(command: string, args: string[], cwd: string,
  env: NodeJS.ProcessEnv = process.env, timeoutMs = 120_000, maxOutputBytes = 4_194_304): Promise<SecurityProcess> {
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

export function completed(result: SecurityProcess) {
  return !result.timedOut && !result.outputExceeded && result.signal === null && result.exitCode !== null;
}

export async function securityRunDirectory() {
  const parent = resolve(securityRoot, "target/assurance/security");
  await mkdir(parent, { recursive: true });
  return mkdtemp(resolve(parent, "run-"));
}

export async function gitIdentity() {
  const result = await runSecurityProcess("git", ["rev-parse", "HEAD", "HEAD^{tree}"], securityRoot);
  if (!completed(result) || result.exitCode !== 0) throw new Error("git_identity_unavailable");
  const [head, committedTree] = result.output.trim().split("\n");
  return { head, committedTree, scope: "Committed base plus exact source hashes; uncommitted bytes are not represented by HEAD." };
}
