import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");

export async function buildMenubar(root = repositoryRoot): Promise<number> {
  const child = spawn("cargo", ["build", "--release", "--locked", "--manifest-path", join(root, "desktop", "Cargo.toml")], {
    cwd: root,
    stdio: "inherit",
  });
  return await new Promise<number>((resolveCode) => {
    child.once("error", () => resolveCode(1));
    child.once("exit", (value) => resolveCode(value ?? 1));
  });
}

if (import.meta.main) {
  const code = await buildMenubar();
  if (code !== 0) throw new Error("cargo build failed for desktop/menubar");
}
