import { describe, expect, test } from "bun:test";

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfigFunction } from "@hraness/vercel-delivery";
import type { NextConfig } from "next";

import { PosthogWebpackPlugin } from "@posthog/webpack-plugin";

import {
  admitProductionSourceMaps,
  ownedPosthogCliBinaryPath,
  productionPosthogPluginOptions,
  withNonfatalCompilerSourceMapHook,
  withPosthogSourceMapWebpack,
  withProductionSourceMaps,
  wrapResolvedNextConfig,
} from "./production-source-maps";

const repository = fileURLToPath(new URL("..", import.meta.url));

const productionEnvironment = {
  POSTHOG_API_KEY: "phx_test_personal_key",
  POSTHOG_PROJECT_ID: "543691",
  POSTHOG_UI_HOST: "https://us.posthog.com",
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
} as const;

const nodeSpawnOptions = {
  cwd: repository,
  encoding: "utf8" as const,
  timeout: 30_000,
};

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
    const installed = JSON.parse(
      readFileSync(join(repository, "node_modules/@posthog/nextjs-config/package.json"), "utf8"),
    ) as { version: string };
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

describe("Node production config load", () => {
  test("Node rejects the package.json subpath that failed Vercel config load", () => {
    const result = spawnSync("node", ["--input-type=module", "--eval", `
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      try {
        require.resolve("@posthog/nextjs-config/package.json");
        process.exit(2);
      } catch (error) {
        if (error && error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") process.exit(0);
        console.error(error);
        process.exit(1);
      }
    `], nodeSpawnOptions);
    expect(result.status, result.stderr).toBe(0);
  });

  test("Next.js loadConfig under Node admits production source maps without throwing", () => {
    const result = spawnSync("node", ["--input-type=module", "--eval", `
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      const loaded = require("next/dist/server/config.js");
      const { PHASE_PRODUCTION_BUILD } = require("next/dist/shared/lib/constants.js");
      const loadConfig = loaded.default ?? loaded;
      const cfg = await loadConfig(PHASE_PRODUCTION_BUILD, process.cwd(), { silent: false });
      if (typeof cfg.webpack === "function") {
        throw new Error("production next config must not attach webpack(); that path failed Vercel production");
      }
      process.stdout.write("production-config-ok\\n");
    `], {
      ...nodeSpawnOptions,
      env: {
        ...process.env,
        NODE_ENV: "production",
        POSTHOG_API_KEY: productionEnvironment.POSTHOG_API_KEY,
        POSTHOG_PROJECT_ID: productionEnvironment.POSTHOG_PROJECT_ID,
        POSTHOG_UI_HOST: productionEnvironment.POSTHOG_UI_HOST,
        VERCEL: "1",
        VERCEL_DEPLOYMENT_ID: "dpl_AiChartsPreview123",
        VERCEL_ENV: productionEnvironment.VERCEL_ENV,
        VERCEL_GIT_COMMIT_SHA: productionEnvironment.VERCEL_GIT_COMMIT_SHA,
        VERCEL_PROJECT_ID: "prj_AiChartsProject123",
      },
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stderr).not.toContain("Failed to load next.config.ts");
    expect(result.stdout).toContain("production-config-ok");
  });

  test("ownedPosthogCliBinaryPath resolves the public nextjs-config entry under Node", () => {
    const result = spawnSync("node", ["--input-type=module", "--eval", `
      import { createRequire } from "node:module";
      import { readFileSync } from "node:fs";
      import { dirname, join } from "node:path";
      const require = createRequire(import.meta.url);
      const entry = require.resolve("@posthog/nextjs-config");
      const cli = createRequire(entry).resolve("@posthog/cli/run-posthog-cli.js");
      const pkg = JSON.parse(readFileSync(join(dirname(cli), "package.json"), "utf8"));
      if (pkg.name !== "@posthog/cli" || !String(pkg.version).startsWith("0.18.")) {
        throw new Error("unexpected CLI " + pkg.name + "@" + pkg.version);
      }
      process.stdout.write(cli + "\\n");
    `], nodeSpawnOptions);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(ownedPosthogCliBinaryPath());
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

describe("withPosthogSourceMapWebpack", () => {
  test("appends PosthogWebpackPlugin without a compile hook", () => {
    const admission = admitProductionSourceMaps(productionEnvironment)!;
    const wrapped = withPosthogSourceMapWebpack({ reactStrictMode: true }, admission);
    expect(wrapped.compiler?.runAfterProductionCompile).toBeUndefined();
    const webpackConfig = wrapped.webpack?.(
      { plugins: [] },
      { isServer: false } as Parameters<NonNullable<typeof wrapped.webpack>>[1],
    );
    expect(webpackConfig?.plugins?.some((plugin: unknown) => plugin instanceof PosthogWebpackPlugin)).toBe(true);
  });

  test("a CLI discovery failure leaves the webpack config usable", () => {
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const wrapped = withPosthogSourceMapWebpack(
        { reactStrictMode: true },
        admitProductionSourceMaps(productionEnvironment)!,
        () => {
          const error = new Error(
            "Package subpath './package.json' is not defined by \"exports\" in node_modules/@posthog/nextjs-config/package.json",
          );
          (error as NodeJS.ErrnoException).code = "ERR_PACKAGE_PATH_NOT_EXPORTED";
          throw error;
        },
      );
      const webpackConfig = wrapped.webpack?.(
        { plugins: [] },
        { isServer: false } as Parameters<NonNullable<typeof wrapped.webpack>>[1],
      );
      expect(webpackConfig?.plugins).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(String(errors[0])).toContain("continuing the production build");
    } finally {
      console.error = originalError;
    }
  });
});

describe("withProductionSourceMaps", () => {
  test("admitted production credentials do not attach webpack or a compile hook", () => {
    const config = { reactStrictMode: true } satisfies NextConfig;
    const wrapped = withProductionSourceMaps(config, productionEnvironment);
    expect(wrapped.webpack).toBeUndefined();
    expect(wrapped.compiler?.runAfterProductionCompile).toBeUndefined();
    expect(wrapped.reactStrictMode).toBe(true);
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
