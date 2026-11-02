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
    assert.equal(new match.Minimatch("app/**/*.tsx").match("app/models", true), true);
    assert.equal(new match.Minimatch("app/**/*.tsx").match("other/models", true), false);
    import("minimatch").then(modern => {
      assert.equal(modern.default, modern.minimatch);
      assert.equal(modern.minimatch("app/card.tsx", "**/*.tsx"), true);
      assert.equal(new modern.Minimatch("**/*.tsx").match("app/card.tsx"), true);
      process.stdout.write("glob compatibility passed");
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 10_000 });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("glob compatibility passed");
}, 15_000);

test("the real ESLint ESM consumers retain file inclusion and exclusion behavior", () => {
  const result = spawnSync(process.execPath.includes("bun") ? "node" : process.execPath, ["--input-type=module", "--eval", `
    import assert from "node:assert/strict";
    import path from "node:path";
    import { ConfigArray } from "@eslint/config-array";
    import { Legacy } from "@eslint/eslintrc";
    const root = process.cwd();
    const included = path.join(root, "app/card.tsx");
    const excluded = path.join(root, "app/card.test.tsx");
    const other = path.join(root, "app/card.js");
    const configs = new ConfigArray([
      { files: ["**/*.tsx"], ignores: ["**/*.test.tsx"], selected: true },
    ], {
      basePath: root,
      schema: { selected: { merge: "replace", validate: "boolean" } },
    });
    configs.normalizeSync();
    assert.equal(configs.getConfig(included).selected, true);
    assert.equal(configs.getConfig(excluded), undefined);
    assert.equal(configs.getConfig(other), undefined);
    const override = Legacy.OverrideTester.create(["**/*.tsx"], ["**/*.test.tsx"], root);
    assert.equal(override.test(included), true);
    assert.equal(override.test(excluded), false);
    assert.equal(override.test(other), false);
    process.stdout.write("ESLint ESM consumers passed");
  `], { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 10_000 });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("ESLint ESM consumers passed");
}, 15_000);

test("the actual import rule enforces allow and forbid globs using the patched matcher", () => {
  const result = spawnSync(process.execPath.includes("bun") ? "node" : process.execPath, ["-e", `
    const assert = require("node:assert/strict");
    const path = require("node:path");
    const { Linter } = require("eslint");
    const rule = require("eslint-plugin-import/lib/rules/no-internal-modules");
    const linter = new Linter();
    const ruleId = "import/no-internal-modules";
    const filename = path.join(process.cwd(), "glob-rule-consumer.js");
    for (const [options, expected] of [
      [{ allow: ["lib/**"] }, 0],
      [{ allow: ["components/**"] }, 1],
      [{ allow: ["lib/{http-accept,other}.ts"] }, 0],
      [{ forbid: ["lib/**"] }, 1],
      [{ forbid: ["components/**"] }, 0],
      [{ forbid: ["lib/{http-accept,other}.ts"] }, 1],
    ]) {
      for (const source of [
        'import item from "./lib/http-accept.ts";',
        'const item = require("./lib/http-accept.ts");',
      ]) {
        const messages = linter.verify(source, [{
          files: ["**/*.js"],
          languageOptions: { ecmaVersion: 2022, sourceType: "module" },
          plugins: { import: { rules: { "no-internal-modules": rule } } },
          rules: { [ruleId]: ["error", options] },
          settings: { "import/resolver": { node: { extensions: [".ts", ".tsx", ".js"] } } },
        }], { filename });
        assert.equal(messages.length, expected, JSON.stringify({ options, source, messages }));
        for (const message of messages) assert.equal(message.ruleId, ruleId);
      }
    }
    process.stdout.write("import rule consumers passed");
  `], { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 10_000 });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("import rule consumers passed");
}, 15_000);
