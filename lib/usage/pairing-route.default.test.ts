import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
test("the public default pairing composition stays closed and carries its fence into the shared Vercel transport", () => {
  const result = spawnSync(process.execPath, ["--no-env-file", "--no-install", fileURLToPath(new URL("./pairing-route.default.fixture.ts", import.meta.url))], {
    env: { PATH: "/usr/bin:/bin", NODE_ENV: "test" }, encoding: "utf8", timeout: 10_000, maxBuffer: 2_048, killSignal: "SIGKILL", shell: false,
  });
  expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).toBe(0); expect(result.stderr).toBe("");
  expect(result.stdout).toBe('{"ok":true,"phase":"guarded-public-binding","contexts":5,"fetches":1}');
});
