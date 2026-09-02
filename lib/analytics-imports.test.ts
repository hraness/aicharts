import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const excludedDirectories = new Set([".git", ".next", "node_modules"]);

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return excludedDirectories.has(entry.name) ? [] : sourceFiles(path);
    }
    return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ? [path]
      : [];
  });
}

test("PostHog imports and direct capture stay inside the instrumentation boundary", () => {
  const files = sourceFiles(repositoryRoot);
  const matching = (pattern: RegExp) => files
    .filter(path => pattern.test(readFileSync(path, "utf8")))
    .map(path => relative(repositoryRoot, path))
    .sort();

  expect(matching(/\bfrom\s+["']posthog-js["']/u)).toEqual([
    "instrumentation-client.ts",
    "lib/analytics.ts",
  ]);
  expect(matching(/\bfrom\s+["']posthog-node["']/u)).toEqual(["instrumentation.ts"]);
  expect(matching(/\bposthog\.capture\s*\(/u)).toEqual(["lib/analytics.ts"]);
});
