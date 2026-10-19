import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfigFunction } from "@hraness/vercel-delivery";
import type { NextConfig } from "next";

import {
  admitProductionSourceMaps,
  ownedPosthogCliBinaryPath,
  productionPosthogPluginOptions,
  withNonfatalCompilerSourceMapHook,
  wrapResolvedNextConfig,
} from "./production-source-maps";

const productionEnvironment = {
  POSTHOG_API_KEY: "phx_test_personal_key",
  POSTHOG_PROJECT_ID: "543691",
  POSTHOG_UI_HOST: "https://us.posthog.com",
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
} as const;

describe("admitProductionSourceMaps", () => {
  test("admits only a complete Vercel production credential set", () => {
    expect(admitProductionSourceMaps(productionEnvironment)).toEqual({
      host: "https://us.posthog.com",
      personalApiKey: productionEnvironment.POSTHOG_API_KEY,
      projectId: productionEnvironment.POSTHOG_PROJECT_ID,
      releaseVersion: productionEnvironment.VERCEL_GIT_COMMIT_SHA,
    });
    expect(admitProductionSourceMaps({
      ...productionEnvironment,
      POSTHOG_UI_HOST: undefined,
    })).toMatchObject({ host: "https://us.posthog.com" });
  });

  test("refuses Preview, public tokens, ingest hosts, and non-numeric project ids", () => {
    expect(admitProductionSourceMaps({
      ...productionEnvironment,
      VERCEL_ENV: "preview",
    })).toBeUndefined();
    expect(admitProductionSourceMaps({
      ...productionEnvironment,
      POSTHOG_API_KEY: "phc_public",
    })).toBeUndefined();
    expect(admitProductionSourceMaps({
      ...productionEnvironment,
      POSTHOG_PROJECT_ID: "0",
    })).toBeUndefined();
    expect(admitProductionSourceMaps({
      ...productionEnvironment,
      POSTHOG_UI_HOST: "https://us.i.posthog.com",
    })).toBeUndefined();
    expect(admitProductionSourceMaps({
      ...productionEnvironment,
      VERCEL_GIT_COMMIT_SHA: "",
    })).toBeUndefined();
  });
});

describe("productionPosthogPluginOptions", () => {
  test("pins @posthog/nextjs-config to the release that owns its CLI", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const installed = createRequire(import.meta.url)("@posthog/nextjs-config/package.json") as {
      version: string;
    };
    expect(pkg.dependencies["@posthog/nextjs-config"]).toBe("1.11.3");
    expect(installed.version).toBe("1.11.3");
  });

  test("keeps the inject-then-upload process path and the package-owned CLI", () => {
    const cliBinaryPath = ownedPosthogCliBinaryPath();
    const options = productionPosthogPluginOptions(
      admitProductionSourceMaps(productionEnvironment)!,
      cliBinaryPath,
    );
    const cliPackage = JSON.parse(readFileSync(join(dirname(cliBinaryPath), "package.json"), "utf8")) as {
      name: string;
      version: string;
    };

    expect(options.cliBinaryPath).toBe(cliBinaryPath);
    expect(options.sourcemaps).toEqual({
      deleteAfterUpload: true,
      enabled: true,
      releaseMode: "symbol-set",
      releaseName: "aicharts",
      releaseVersion: productionEnvironment.VERCEL_GIT_COMMIT_SHA,
    });
    expect(cliPackage.name).toBe("@posthog/cli");
    expect(cliPackage.version.startsWith("0.18.")).toBe(true);
    expect(cliBinaryPath).toContain("@posthog/cli");
  });
});

describe("withNonfatalCompilerSourceMapHook", () => {
  test("leaves configs without a compile hook unchanged", () => {
    const config = { reactStrictMode: true } satisfies NextConfig;
    expect(withNonfatalCompilerSourceMapHook(config)).toBe(config);
  });

  test("swallows a Chunk ID upload failure so next build can finish", async () => {
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const wrapped = withNonfatalCompilerSourceMapHook({
        compiler: {
          runAfterProductionCompile: async () => {
            throw new Error(
              "Chunk ID not found in /vercel/path0/.next/static/chunks/8437.js. Run 'sourcemap inject' before 'sourcemap upload'",
            );
          },
        },
      });
      await wrapped.compiler?.runAfterProductionCompile?.({
        distDir: "/tmp/.next",
        projectDir: "/tmp",
      });
      expect(errors).toHaveLength(1);
      expect(String(errors[0])).toContain("continuing the production build");
    } finally {
      console.error = originalError;
    }
  });

  test("still awaits a successful upload hook", async () => {
    let ran = false;
    const wrapped = withNonfatalCompilerSourceMapHook({
      compiler: {
        runAfterProductionCompile: async () => {
          ran = true;
        },
      },
    });
    await wrapped.compiler?.runAfterProductionCompile?.({
      distDir: "/tmp/.next",
      projectDir: "/tmp",
    });
    expect(ran).toBe(true);
  });
});

describe("wrapResolvedNextConfig", () => {
  test("wraps both a plain object and a Next.js config factory", async () => {
    const wrap = (config: NextConfig): NextConfig => ({ ...config, reactStrictMode: true });
    expect(wrapResolvedNextConfig({ poweredByHeader: false }, wrap)).toEqual({
      poweredByHeader: false,
      reactStrictMode: true,
    });

    const factory = wrapResolvedNextConfig(
      (async () => ({ poweredByHeader: false })) as NextConfig,
      wrap,
    );
    expect(typeof factory).toBe("function");
    expect(await (factory as NextConfigFunction)("phase-production-build", {
      defaultConfig: {},
    })).toEqual({
      poweredByHeader: false,
      reactStrictMode: true,
    });
  });
});
