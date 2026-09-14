/*
 * `bun run menubar` launches the prebuilt Rust status-item binary under
 * `desktop/` in the foreground. The binary renders the repository `outputs/`
 * directory newest-first — agents drop finished user-facing files there.
 * One status item exists per working tree; a second launch exits quietly
 * once the lock is held. Build explicitly with `bun run menubar:build`.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repositoryRoot = resolve(import.meta.dir, "..");
export function menubarBinary(root = repositoryRoot): string {
  const release = join(root, "desktop", "target", "release", "aicharts-menubar");
  const debug = join(root, "desktop", "target", "debug", "aicharts-menubar");
  return existsSync(release) ? release : debug;
}

export async function runMenubar(root = repositoryRoot): Promise<number> {
  const resolved = menubarBinary(root);
  if (!existsSync(resolved)) {
    console.error("The AI Charts menu bar companion is not built. Run `bun run menubar:build` first.");
    return 1;
  }
  const outputs = join(root, "outputs");
  const child = spawn(resolved, ["--outputs", outputs], { cwd: root, stdio: "inherit" });
  const stop = () => { if (!child.killed) child.kill("SIGTERM"); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    return await new Promise<number>((resolveCode) => {
      child.once("error", () => resolveCode(1));
      child.once("exit", (value, signal) => resolveCode(value ?? (signal === "SIGTERM" ? 143 : 1)));
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (import.meta.main) process.exit(await runMenubar());
