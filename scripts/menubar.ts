/*
 * `bun run menubar` launches the prebuilt Rust status-item binary under
 * `desktop/` in the foreground. The binary renders the repository `outputs/`
 * directory newest-first — agents drop finished user-facing files there.
 * One status item exists per working tree; a second launch exits quietly
 * once the lock is held. Build explicitly with `bun run menubar:build`.
 */

import { chmod, copyFile, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repositoryRoot = resolve(import.meta.dir, "..");
const installRoot = (home = homedir()) => join(home, "Library", "Application Support", "AI Charts");
export const installedMenubarBinary = (home = homedir()) => join(installRoot(home), "bin", "aicharts-menubar");

/** Return the compatibility path used by tests and explicit source checkouts. */
export function menubarBinary(root = repositoryRoot, home = homedir()): string {
  const explicitDevelopmentBinary = process.env.AICHARTS_MENUBAR_DEV_BINARY;
  if (explicitDevelopmentBinary) return explicitDevelopmentBinary;
  const installed = installedMenubarBinary(home);
  if (existsSync(installed)) return installed;
  const release = join(root, "desktop", "target", "release", "aicharts-menubar");
  return release;
}

function releaseBinary(root: string): string {
  return join(root, "desktop", "target", "release", "aicharts-menubar");
}

async function qualifiedBinary(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isFile() && (info.mode & 0o111) !== 0 && (info.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

/** Check each component below the user's home before a managed path is used. */
async function qualifiedInstallDirectory(home: string, create: boolean): Promise<boolean> {
  const paths = [
    resolve(home),
    join(home, "Library"),
    join(home, "Library", "Application Support"),
    installRoot(home),
    join(installRoot(home), "bin"),
  ];
  for (const path of paths) {
    if (create) {
      await mkdir(path, { mode: 0o700 }).catch((cause: unknown) => {
        if (!(cause instanceof Error && "code" in cause && cause.code === "EEXIST")) throw cause;
      });
    }
    const info = await lstat(path).catch((cause: unknown) => {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
      throw cause;
    });
    if (info === null) return false;
    if (!info.isDirectory() || (info.mode & 0o022) !== 0) {
      throw new Error("The companion installation requires real directories without group or other write permission.");
    }
  }
  return true;
}

async function qualifiedInstalledBinary(home = homedir()): Promise<boolean> {
  try {
    return await qualifiedInstallDirectory(home, false)
      && await qualifiedBinary(installedMenubarBinary(home));
  } catch {
    return false;
  }
}

/** Copy a release-built companion into its stable per-user location. */
export async function installMenubar(root = repositoryRoot, home = homedir()): Promise<number> {
  const source = releaseBinary(root);
  if (!(await qualifiedBinary(source))) {
    console.error("The AI Charts menu bar companion is not a qualified release binary. Run `bun run menubar:build` first.");
    return 1;
  }
  const destination = installedMenubarBinary(home);
  const directory = join(installRoot(home), "bin");
  let stagingDirectory: string | undefined;
  try {
    if (!(await qualifiedInstallDirectory(home, true))) throw new Error("Missing installation directory.");
    await chmod(installRoot(home), 0o700);
    await chmod(directory, 0o700);
    stagingDirectory = await mkdtemp(join(directory, ".install-"));
    const temporary = join(stagingDirectory, "aicharts-menubar");
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    await chmod(temporary, 0o755);
    await rename(temporary, destination);
  } catch {
    console.error("Could not safely install the AI Charts companion. Check the managed directory permissions and release binary.");
    return 1;
  } finally {
    if (stagingDirectory !== undefined) await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
  console.log(`Installed ${destination}`);
  return 0;
}

export async function uninstallMenubar(home = homedir()): Promise<number> {
  try {
    if (await qualifiedInstallDirectory(home, false)) await rm(installedMenubarBinary(home), { force: true });
  } catch {
    console.error("Could not safely remove the AI Charts companion. Check the managed directory permissions.");
    return 1;
  }
  console.log(`Removed ${installedMenubarBinary(home)}`);
  return 0;
}

export async function runMenubar(root = repositoryRoot, home = homedir()): Promise<number> {
  const resolved = menubarBinary(root, home);
  const qualified = resolved === installedMenubarBinary(home)
    ? await qualifiedInstalledBinary(home)
    : await qualifiedBinary(resolved);
  if (!qualified) {
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

if (import.meta.main) {
  const command = process.argv[2] ?? "run";
  const code = command === "install"
    ? await installMenubar()
    : command === "uninstall"
      ? await uninstallMenubar()
      : command === "status"
        ? (await qualifiedInstalledBinary()
          ? (console.log(`Installed: ${installedMenubarBinary()}`), 0)
          : (console.log("Not installed"), 1))
        : command === "run"
          ? await runMenubar()
          : (console.error("Usage: bun run menubar [run|install|uninstall|status]"), 2);
  process.exit(code);
}
