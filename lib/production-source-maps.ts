import { createRequire } from "node:module";

import type {
  NextConfigFunction,
  ProductionDeliveryProofEnvironment,
} from "@hraness/vercel-delivery";
import { withPostHogConfig } from "@posthog/nextjs-config";
import type { NextConfig } from "next";

export const POSTHOG_UI_HOSTS = new Set([
  "https://eu.posthog.com",
  "https://us.posthog.com",
]);

export const PRODUCTION_SOURCE_MAP_RELEASE_NAME = "aicharts";

export type ProductionSourceMapAdmission = Readonly<{
  host: string;
  personalApiKey: string;
  projectId: string;
  releaseVersion: string;
}>;

export type ProductionPosthogPluginOptions = Parameters<typeof withPostHogConfig>[1];

/**
 * Production source maps upload only on Vercel production when the private
 * personal API key, numeric project id, UI host, and commit SHA are all
 * present. Preview, local, and incomplete credentials stay inert.
 */
export function admitProductionSourceMaps(
  environment: ProductionDeliveryProofEnvironment,
): ProductionSourceMapAdmission | undefined {
  const personalApiKey = environment.POSTHOG_API_KEY;
  const projectId = environment.POSTHOG_PROJECT_ID;
  const releaseVersion = environment.VERCEL_GIT_COMMIT_SHA;
  const host = environment.POSTHOG_UI_HOST ?? "https://us.posthog.com";
  if (
    environment.VERCEL_ENV !== "production"
    || !personalApiKey?.startsWith("phx_")
    || !projectId?.match(/^[1-9]\d*$/u)
    || !releaseVersion
    || !POSTHOG_UI_HOSTS.has(host)
  ) {
    return undefined;
  }
  return { host, personalApiKey, projectId, releaseVersion };
}

/**
 * Resolve the CLI that `@posthog/nextjs-config` depends on. Searching
 * `node_modules/.bin` can pick webpack-plugin's older 0.16.x binary, which
 * hard-fails on an unstamped chunk.
 */
export function ownedPosthogCliBinaryPath(): string {
  const requireFromHere = createRequire(import.meta.url);
  const nextjsConfigPackage = requireFromHere.resolve("@posthog/nextjs-config/package.json");
  return createRequire(nextjsConfigPackage).resolve("@posthog/cli/run-posthog-cli.js");
}

export function productionPosthogPluginOptions(
  admission: ProductionSourceMapAdmission,
  cliBinaryPath = ownedPosthogCliBinaryPath(),
): ProductionPosthogPluginOptions {
  return {
    cliBinaryPath,
    host: admission.host,
    logLevel: "error",
    personalApiKey: admission.personalApiKey,
    projectId: admission.projectId,
    sourcemaps: {
      deleteAfterUpload: true,
      enabled: true,
      releaseMode: "symbol-set",
      releaseName: PRODUCTION_SOURCE_MAP_RELEASE_NAME,
      releaseVersion: admission.releaseVersion,
    },
  };
}

export function withNonfatalCompilerSourceMapHook(config: NextConfig): NextConfig {
  const hook = config.compiler?.runAfterProductionCompile;
  if (typeof hook !== "function") {
    return config;
  }
  return {
    ...config,
    compiler: {
      ...config.compiler,
      async runAfterProductionCompile(metadata) {
        try {
          await hook(metadata);
        } catch (error) {
          console.error(
            "PostHog source-map upload failed after compile; continuing the production build.",
            error,
          );
        }
      },
    },
  };
}

export function wrapResolvedNextConfig(
  nextConfig: NextConfig,
  wrap: (config: NextConfig) => NextConfig,
): NextConfig {
  if (typeof nextConfig === "function") {
    const factory = nextConfig as NextConfigFunction;
    return (async (phase: string, context: Parameters<NextConfigFunction>[1]) => (
      wrap(await factory(phase, context))
    )) as NextConfig;
  }
  return wrap(nextConfig);
}

export function withProductionSourceMaps(
  config: NextConfig,
  environment: ProductionDeliveryProofEnvironment,
): NextConfig {
  const admission = admitProductionSourceMaps(environment);
  if (admission === undefined) {
    return config;
  }
  return wrapResolvedNextConfig(
    withPostHogConfig(config, productionPosthogPluginOptions(admission)),
    withNonfatalCompilerSourceMapHook,
  );
}
