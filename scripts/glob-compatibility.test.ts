import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("the patched matcher supports legacy lint calls and modern named imports under Node", () => {
  const result = spawnSync(process.execPath.includes("bun") ? "node" : process.execPath, ["-e", `
    const assert = require("node:assert/strict");
    const match = require("minimatch");
    assert.equal(typeof match, "function");
    assert.equal(match.minimatch, match);
    for (const [path, pattern, expected, options] of [
      ["app/models/card.tsx", "**/*.{ts,tsx}", true, {}],
      ["app/models/card.tsx", "*.tsx", true, { matchBase: true }],
      ["app/models/card.tsx", "**/*.test.tsx", false, {}],
      [".github/workflows/ci.yml", "**/*.yml", true, { dot: true }],
      ["app/card.ts", "!**/*.tsx", true, {}],
    ]) {
      assert.equal(match(path, pattern, options), expected);
      assert.equal(new match.Minimatch(pattern, options).match(path), expected);
    }
    import("minimatch").then(modern => {
      assert.equal(modern.minimatch("app/card.tsx", "**/*.tsx"), true);
      assert.equal(new modern.Minimatch("**/*.tsx").match("app/card.tsx"), true);
      process.stdout.write("glob compatibility passed");
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 10_000 });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("glob compatibility passed");
}, 15_000);
