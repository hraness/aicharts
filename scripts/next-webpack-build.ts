import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Vercel production may set `TURBOPACK=1` while this product always passes
 * `--webpack`. Next.js 16 exits if both bundler flags are present. Clear the
 * env pin before the compile so the package.json script wins.
 */
export function webpackBuildEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  const env = { ...environment };
  delete env.TURBOPACK;
  env.WEBPACK = "1";
  return env;
}

export function runNextWebpackBuild(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  spawn: typeof spawnSync = spawnSync,
): number {
  const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
  const result = spawn(process.execPath, [nextBin, "build", "--webpack"], {
    env: webpackBuildEnvironment(environment) as NodeJS.ProcessEnv,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

if (import.meta.main) {
  process.exitCode = runNextWebpackBuild();
}
