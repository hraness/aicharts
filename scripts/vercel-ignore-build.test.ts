import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { shouldSkipVercelBuild } from "./vercel-ignore-build";

const generatedPreview = {
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
  VERCEL_GIT_PROVIDER: "github",
  VERCEL_GIT_REPO_OWNER: "hraness",
  VERCEL_GIT_REPO_SLUG: "aicharts",
  VERCEL_GIT_COMMIT_REF: "automation/model-data-refresh-34394046867-1",
} as const;

describe("Vercel generated data-refresh Preview boundary", () => {
  test("skips the validated automation branch, including a later workflow attempt", () => {
    expect(shouldSkipVercelBuild(generatedPreview)).toBe(true);
    expect(shouldSkipVercelBuild({
      ...generatedPreview,
      VERCEL_GIT_COMMIT_REF: "automation/model-data-refresh-34394046867-2",
    })).toBe(true);
  });

  test.each([
    "main",
    "codex/aicharts-provider-cost-20260909",
    "manual/model-data-refresh",
    "automation/model-data-refresh",
    "automation/model-data-refresh-34394046867",
    "automation/model-data-refresh-34394046867-0",
    "automation/model-data-refresh-0-1",
    "automation/model-data-refresh-34394046867-1-fix",
    "automation/model-data-refresh-34394046867-1\n",
    "refs/heads/automation/model-data-refresh-34394046867-1",
  ])("continues ordinary or unrecognized branch %j", (branch) => {
    expect(shouldSkipVercelBuild({
      ...generatedPreview,
      VERCEL_GIT_COMMIT_REF: branch,
    })).toBe(false);
  });

  test("production always builds, including an automation branch promotion", () => {
    for (const environment of [
      { VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" },
      { VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "production" },
      { VERCEL_ENV: "production", VERCEL_TARGET_ENV: "preview" },
    ]) {
      expect(shouldSkipVercelBuild({ ...generatedPreview, ...environment })).toBe(false);
    }
  });

  test("missing or malformed system identity continues the build", () => {
    for (const key of Object.keys(generatedPreview)) {
      for (const value of [undefined, null, "", 1, true, [], {}]) {
        expect(shouldSkipVercelBuild({ ...generatedPreview, [key]: value })).toBe(false);
      }
    }
    expect(shouldSkipVercelBuild({})).toBe(false);
    expect(shouldSkipVercelBuild({
      ...generatedPreview,
      VERCEL_GIT_REPO_OWNER: "another-owner",
    })).toBe(false);
    expect(shouldSkipVercelBuild({
      ...generatedPreview,
      VERCEL_TARGET_ENV: "custom-environment",
    })).toBe(false);
  });

  test("the committed command exposes Vercel's exit-code contract under Node", async () => {
    const configuration: { ignoreCommand?: unknown } = await Bun.file(
      new URL("../vercel.json", import.meta.url),
    ).json();
    expect(configuration.ignoreCommand).toBe("node scripts/vercel-ignore-build.ts");
    if (typeof configuration.ignoreCommand !== "string") throw new Error("Missing ignore command.");
    const cwd = fileURLToPath(new URL("..", import.meta.url));
    for (const [environment, status] of [
      [generatedPreview, 0],
      [{ ...generatedPreview, VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" }, 1],
      [{ ...generatedPreview, VERCEL_GIT_COMMIT_REF: "codex/ordinary-preview" }, 1],
      [{}, 1],
    ] as const) {
      const result = spawnSync("/bin/sh", ["-c", configuration.ignoreCommand], {
        cwd,
        encoding: "utf8",
        env: { NODE_ENV: "test", PATH: process.env.PATH, ...environment },
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(status);
      expect(result.stdout).toContain(status === 0 ? "Skipping" : "Continuing");
    }
  });
});
