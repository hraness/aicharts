import { describe, expect, test } from "bun:test";
import { isWorkerEnvironmentFile, workerToolCommands, workerToolEnvironment } from "./usage-worker-tools";

describe("local-only Worker tool boundary", () => {
  test("does not forward credentials, startup hooks, auth config or unrelated environment", () => {
    const result = workerToolEnvironment({
      PATH: "/synthetic/bin", CI: "true", CLOUDFLARE_API_TOKEN: "secret-canary",
      NODE_ENV: "production", NODE_OPTIONS: "--require=private-canary", HOME: "/private-canary",
      SUITE_OIDC_COOKIE_SECRET: "cookie-canary", WRANGLER_SEND_METRICS: "true",
      CLOUDFLARE_INCLUDE_PROCESS_ENV: "true", XDG_CONFIG_HOME: "/private-canary",
    });
    expect(result.PATH).toBe("/synthetic/bin");
    expect(result.CI).toBe("true");
    expect(result.NODE_ENV).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("canary");
    expect(result.WRANGLER_SEND_METRICS).toBe("false");
    expect(result.CLOUDFLARE_INCLUDE_PROCESS_ENV).toBe("false");
    expect(result.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV).toBe("false");
  });
  test("has no deploy operation or caller-supplied flags", () => {
    for (const args of [[], ["deploy"], ["test", "--remote"], ["types", "--env", "production"], ["check", "extra"]]) {
      expect(workerToolCommands(args)).toBeNull();
    }
    expect(workerToolCommands(["check"])).toHaveLength(3);
    expect(workerToolCommands(["types"])).toHaveLength(1);
    expect(workerToolCommands(["test"])).toHaveLength(1);
    expect(workerToolCommands(["test-pairing"])?.[0].at(-1)).toBe("test/pairing.worker.ts");
    expect(workerToolCommands(["test-enrollment"])?.[0].at(-1)).toBe("test/enrollment.worker.ts");
    expect(workerToolCommands(["test-admission"])?.[0].at(-1)).toBe("test/admission.worker.ts");
    expect(workerToolCommands(["test-staging"])?.[0].at(-1)).toBe("test/staging.worker.ts");
    expect(workerToolCommands(["test-pairing", "--remote"])).toBeNull();
    expect(workerToolCommands(["test-enrollment", "--remote"])).toBeNull();
    expect(workerToolCommands(["test-admission", "--remote"])).toBeNull();
    expect(JSON.stringify(workerToolCommands(["check"]))).not.toContain("deploy");
  });
  test("refuses environment files without reading their contents", () => {
    for (const name of [".env", ".env.local", ".env.production", ".dev.vars", ".dev.vars.test"]) expect(isWorkerEnvironmentFile(name)).toBe(true);
    for (const name of ["src", "test", "wrangler.jsonc", "worker-configuration.d.ts", ".wrangler"]) expect(isWorkerEnvironmentFile(name)).toBe(false);
  });
});
