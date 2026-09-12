import { lstat, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const worker = fileURLToPath(new URL("../services/usage-worker/", import.meta.url));
const privateState = fileURLToPath(new URL("../services/usage-worker/.wrangler/", import.meta.url));

/** Local runtime checks never inherit provider credentials or user config paths. */
export function workerToolEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "TMPDIR", "TEMP", "TMP", "CI"]) {
    if (typeof source[key] === "string") environment[key] = source[key];
  }
  return {
    ...environment,
    XDG_CONFIG_HOME: `${privateState}config`,
    WRANGLER_LOG_PATH: `${privateState}logs`,
    WRANGLER_SEND_METRICS: "false",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
    NO_COLOR: "1",
  };
}

export function isWorkerEnvironmentFile(name: string): boolean {
  return name === ".env" || name.startsWith(".env.") || name === ".dev.vars" || name.startsWith(".dev.vars.");
}

export function workerToolCommands(args: readonly string[]): readonly (readonly string[])[] | null {
  const types = ["node", `${root}node_modules/wrangler/bin/wrangler.js`, "types", "--config", "wrangler.jsonc", "worker-configuration.d.ts"];
  const test = ["node", `${root}node_modules/vitest/vitest.mjs`, "run", "--config", "vitest.config.ts"];
  if (args.length === 1 && args[0] === "types") return [types];
  if (args.length === 1 && args[0] === "test") return [test];
  if (args.length === 1 && args[0] === "test-pairing") return [[...test, "test/pairing.worker.ts"]];
  if (args.length === 1 && args[0] === "test-enrollment") return [[...test, "test/enrollment.worker.ts"]];
  if (args.length === 1 && args[0] === "test-admission") return [[...test, "test/admission.worker.ts"]];
  if (args.length === 1 && args[0] === "test-staging") return [[...test, "test/staging.worker.ts"]];
  if (args.length === 1 && args[0] === "check") return [types, ["node", `${root}node_modules/typescript/bin/tsc`, "--project", "tsconfig.json"], test];
  return null;
}

async function main(): Promise<number> {
  const commands = workerToolCommands(process.argv.slice(2));
  if (!commands) {
    console.error("usage-worker-tools: expected types, test, test-pairing, test-enrollment, test-admission, test-staging or check (no extra arguments)");
    return 2;
  }
  // Pinned Wrangler prefers this legacy path over XDG, even with telemetry off.
  // Only inspect existence; never open, migrate or remove personal config.
  try {
    await lstat(join(homedir(), ".wrangler"));
    console.error("usage-worker-tools: legacy user Wrangler configuration prevents isolated fixture execution");
    return 2;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  // Wrangler may load .dev.vars independently of process.env. Refuse it without
  // opening it; local fixture tests have no reason to read any environment file.
  if ((await readdir(worker)).some(isWorkerEnvironmentFile)) {
    console.error("usage-worker-tools: environment files are not allowed in the local fixture directory");
    return 2;
  }
  await mkdir(privateState, { recursive: true, mode: 0o700 });
  const environment = workerToolEnvironment(process.env);
  for (const command of commands) {
    const child = Bun.spawn([...command], { cwd: worker, env: environment, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
    const code = await child.exited;
    if (code !== 0) return code;
  }
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch {
    console.error("usage-worker-tools: local check failed");
    process.exitCode = 1;
  }
}
