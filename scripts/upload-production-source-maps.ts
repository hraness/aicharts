import { spawnSync } from "node:child_process";

import type { ProductionDeliveryProofEnvironment } from "@hraness/vercel-delivery";

import {
  admitProductionSourceMaps,
  ownedPosthogCliBinaryPath,
  PRODUCTION_SOURCE_MAP_RELEASE_NAME,
} from "../lib/production-source-maps";

export type SourceMapUploadOutcome = "skipped" | "uploaded" | "failed";

export type SourceMapUploadRunner = (
  cliBinaryPath: string,
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
) => { status: number | null; error?: Error };

/**
 * Best-effort PostHog source-map inject+upload after `next build`. Never
 * throws and never returns a failing process status: a CLI, network, or
 * discovery problem must not fail a production deploy.
 */
export function uploadProductionSourceMaps(
  environment: ProductionDeliveryProofEnvironment = process.env,
  options: {
    distDir?: string;
    resolveCliBinaryPath?: () => string;
    runCli?: SourceMapUploadRunner;
  } = {},
): SourceMapUploadOutcome {
  try {
    const admission = admitProductionSourceMaps(environment);
    if (admission === undefined) {
      return "skipped";
    }
    const cliBinaryPath = (options.resolveCliBinaryPath ?? ownedPosthogCliBinaryPath)();
    const distDir = options.distDir ?? ".next";
    const runCli = options.runCli ?? ((cli, args, env) => spawnSync(cli, [...args], {
      env: env as NodeJS.ProcessEnv,
      stdio: "inherit",
    }));
    const result = runCli(
      cliBinaryPath,
      [
        "sourcemap",
        "process",
        "--directory",
        distDir,
        "--release-name",
        PRODUCTION_SOURCE_MAP_RELEASE_NAME,
        "--release-version",
        admission.releaseVersion,
      ],
      {
        ...environment,
        POSTHOG_CLI_API_KEY: admission.personalApiKey,
        POSTHOG_CLI_HOST: admission.host,
        POSTHOG_CLI_PROJECT_ID: admission.projectId,
        POSTHOG_RELEASE_MODE: "symbol-set",
      },
    );
    if (result.error || result.status !== 0) {
      console.error(
        "PostHog source-map process failed; continuing the production build.",
        result.error ?? `exit ${String(result.status)}`,
      );
      return "failed";
    }
    return "uploaded";
  } catch (error) {
    console.error(
      "PostHog source-map upload failed; continuing the production build.",
      error,
    );
    return "failed";
  }
}

if (import.meta.main) {
  uploadProductionSourceMaps();
}
