import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("Vercel binds fresh private sessions, both default fences and missing-session outcomes", () => {
  // Public-module mocks and synthetic context stay in a sanitized child process.
  const fixture = fileURLToPath(new URL("../../fixtures/usage/vercel-private-days.fixture.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--no-env-file", "--no-install", fixture], {
    env: { PATH: "/usr/bin:/bin", NODE_ENV: "test" }, encoding: "utf8", timeout: 10_000,
    maxBuffer: 2_048, killSignal: "SIGKILL", shell: false,
  });
  expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe('{"ok":true,"phase":"default-missing-session","fetches":2,"registrations":5,"reads":3,"finishes":3}');
});
