import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("public Vercel context and Next promise lifetime bind before any pairing fetch", () => {
  // Public-module mocks and synthetic request context cannot leak into other tests.
  const fixture = fileURLToPath(new URL("../../fixtures/usage/vercel-pairing.fixture.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--no-env-file", "--no-install", fixture], {
    env: { PATH: "/usr/bin:/bin", NODE_ENV: "test" }, encoding: "utf8", timeout: 10_000,
    maxBuffer: 2_048, killSignal: "SIGKILL", shell: false,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe('{"ok":true,"phase":"invalid-input-before-context","fetches":2,"registrations":3}');
});
