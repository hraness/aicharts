/*
 * `bun run menubar` builds the Rust status-item binary under `desktop/` and
 * launches it detached. The binary renders the repository `outputs/`
 * directory newest-first — agents drop finished user-facing files there.
 * One status item exists per working tree; a second launch exits quietly
 * once the lock is held, reported as "already running".
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repositoryRoot = resolve(import.meta.dir, "..");
const outputsDirectory = join(repositoryRoot, "outputs");
const SETTLE_MS = 400;

function menubarBinary(): string {
  const release = join(repositoryRoot, "desktop", "target", "release", "aicharts-menubar");
  const debug = join(repositoryRoot, "desktop", "target", "debug", "aicharts-menubar");
  return existsSync(release) ? release : debug;
}

async function build(): Promise<void> {
  const child = spawn(
    "cargo",
    ["build", "--manifest-path", join(repositoryRoot, "desktop", "Cargo.toml")],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  const code = await new Promise<number>((resolveCode) => {
    child.on("exit", (value) => resolveCode(value ?? 1));
  });
  if (code !== 0) {
    throw new Error("cargo build failed for desktop/menubar");
  }
}

const binary = menubarBinary();
if (!existsSync(binary)) await build();
const resolved = menubarBinary();
if (!existsSync(resolved)) {
  console.error("The AI Charts menu bar is not installed and cargo build did not produce it.");
  process.exit(1);
}
const child = spawn(resolved, ["--outputs", outputsDirectory], {
  cwd: repositoryRoot,
  detached: true,
  stdio: "ignore",
});
child.unref();
const settled = await Promise.race([
  new Promise<number>((resolveCode) => child.on("exit", (value) => resolveCode(value ?? 1))),
  new Promise<null>((resolveCode) => setTimeout(() => resolveCode(null), SETTLE_MS)),
]);
if (settled !== null && settled !== 0) {
  console.error("The AI Charts menu bar exited during startup.");
  process.exit(1);
}
console.log(settled === 0 ? "AI Charts menu bar is already running." : "AI Charts menu bar is running.");
