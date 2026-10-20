import { describe, expect, test } from "bun:test";

import { uploadProductionSourceMaps } from "./upload-production-source-maps";
import { webpackBuildEnvironment } from "./next-webpack-build";

const productionEnvironment = {
  POSTHOG_API_KEY: "phx_test_personal_key",
  POSTHOG_PROJECT_ID: "543691",
  POSTHOG_UI_HOST: "https://us.posthog.com",
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
} as const;

describe("webpackBuildEnvironment", () => {
  test("clears TURBOPACK so next build --webpack is the only bundler flag", () => {
    expect(webpackBuildEnvironment({
      PATH: "/usr/bin",
      TURBOPACK: "1",
      WEBPACK: "0",
    })).toEqual({
      PATH: "/usr/bin",
      WEBPACK: "1",
    });
  });
});

describe("uploadProductionSourceMaps", () => {
  test("skips Preview and incomplete credentials", () => {
    expect(uploadProductionSourceMaps({ VERCEL_ENV: "preview" })).toBe("skipped");
    expect(uploadProductionSourceMaps({})).toBe("skipped");
  });

  test("a CLI discovery failure degrades to failed without throwing", () => {
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      expect(uploadProductionSourceMaps(productionEnvironment, {
        resolveCliBinaryPath: () => {
          throw Object.assign(new Error("Package subpath './package.json' is not defined"), {
            code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
          });
        },
      })).toBe("failed");
      expect(errors).toHaveLength(1);
      expect(String(errors[0])).toContain("continuing the production build");
    } finally {
      console.error = originalError;
    }
  });

  test("a nonzero CLI exit degrades to failed without throwing", () => {
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      expect(uploadProductionSourceMaps(productionEnvironment, {
        resolveCliBinaryPath: () => "/tmp/posthog-cli",
        runCli: (cli, args, environment) => {
          expect(cli).toBe("/tmp/posthog-cli");
          expect(args).toContain("process");
          expect(environment.POSTHOG_CLI_API_KEY).toBe(productionEnvironment.POSTHOG_API_KEY);
          return { status: 1 };
        },
      })).toBe("failed");
      expect(errors).toHaveLength(1);
    } finally {
      console.error = originalError;
    }
  });

  test("a successful CLI run reports uploaded", () => {
    expect(uploadProductionSourceMaps(productionEnvironment, {
      resolveCliBinaryPath: () => "/tmp/posthog-cli",
      runCli: () => ({ status: 0 }),
    })).toBe("uploaded");
  });
});
