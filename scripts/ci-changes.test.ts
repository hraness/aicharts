import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planChangedCheck } from "./check-changed";
import { changedFilters, ciChangeFilters, globToRegExp, matchesFilter } from "./ci-changes";

const root = fileURLToPath(new URL("../", import.meta.url));
const filters = ciChangeFilters();

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (name === "node_modules" || name === ".wrangler") return [];
    return statSync(path).isDirectory() ? sources(path) : /\.(?:ts|tsx|mts|js|mjs)$/u.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

function resolveImport(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.js`, `${base}.mjs`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every repository file the Worker's sources and tests reach through relative imports. */
function workerClosure(): string[] {
  const pending = sources(resolve(root, "services/usage-worker"));
  const seen = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(?:ts|tsx|mts|js|mjs)$/u.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/gu)) {
      const target = resolveImport(file, match[1]);
      if (target === null) throw new Error(`unresolved import ${match[1]} in ${relative(root, file)}`);
      pending.push(target);
    }
  }
  return [...seen].map(file => relative(root, file)).sort();
}

describe("CI change filters", () => {
  test("glob translation follows the CI filter syntax", () => {
    expect(globToRegExp("services/**").test("services/usage-worker/src/index.ts")).toBe(true);
    expect(globToRegExp("data/usage-*.json").test("data/usage-prices.json")).toBe(true);
    expect(globToRegExp("data/usage-*.json").test("data/nested/usage-prices.json")).toBe(false);
    expect(globToRegExp("lib/result*").test("lib/result.ts")).toBe(true);
    expect(globToRegExp("**/*.rs").test("src/main.rs")).toBe(true);
    expect(globToRegExp(".nvmrc").test("xnvmrc")).toBe(false);
  });

  test("the Worker filter covers the Worker's whole relative import closure", () => {
    const closure = workerClosure();
    expect(closure.length).toBeGreaterThan(50);
    expect(closure.filter(path => !matchesFilter(path, filters.worker))).toEqual([]);
  });

  test("the Worker filter watches the gate inputs that are read rather than imported", () => {
    for (const path of ["verify/conformance/cases.json", "vendor/tokscale-core/Cargo.toml", "data/usage-registry.json", "fixtures/usage/example.json",
      "scripts/assurance-conformance.ts", "scripts/usage-worker-tools.ts", ".nvmrc", "bun.lock", "package.json", ".github/workflows/ci.yml"]) {
      expect(matchesFilter(path, filters.worker)).toBe(true);
    }
  });

  test("data-only and site-only changes skip the Worker, Rust and formal jobs", () => {
    expect([...changedFilters(["data/model-release-radar.json", "data/calculator-inputs.json"], filters)]).toEqual([]);
    expect([...changedFilters(["app/page.tsx", "components/chart.tsx", "lib/chart-layout.ts", ".agents/kb/note.md"], filters)]).toEqual([]);
    expect([...changedFilters(["lib/usage/wire.ts"], filters)]).toEqual(["worker"]);
    expect([...changedFilters(["verify/tla/M1Restore.tla"], filters)].sort()).toEqual(["formal", "worker"]);
  });
});

describe("check:changed", () => {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { scripts: Record<string, string> };

  test("runs the complete check when every filtered input changed", () => {
    const plan = planChangedCheck(pkg.scripts.check, new Set(["rust", "worker"]));
    expect(plan.run.join(" && ")).toBe(pkg.scripts.check);
    expect(plan.skipped).toEqual([]);
  });

  test("skips only the untouched Rust and Worker gates, keeping order", () => {
    const plan = planChangedCheck(pkg.scripts.check, new Set());
    expect(plan.skipped).toEqual(["bun run usage:check", "bun run usage:worker:check"]);
    expect(plan.run).toEqual(pkg.scripts.check.split(" && ").filter(command => !plan.skipped.includes(command)));
    expect(plan.run).toContain("bun run build");
    expect(plan.run).toContain("bun run test:browser");
  });

  test("refuses a check script that no longer names a filtered gate", () => {
    expect(() => planChangedCheck("bun run lint && bun run test", new Set())).toThrow("check_script_drift");
  });
});
