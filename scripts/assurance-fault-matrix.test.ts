import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { manifestSchema, parseFaultOptions, selectSuites, suiteCommand, validateManifest, validateSuiteOutput, type FaultManifest } from "./assurance-fault-matrix";
import type { ProofProcess } from "./assurance-proof-common";

const root = resolve(import.meta.dir, "..");
const manifest = manifestSchema.parse(JSON.parse(readFileSync(resolve(root, "verify/assurance/fault-matrix.json"), "utf8")) as unknown);
const sourcePaths = [...new Set(manifest.suites.flatMap(suite => suite.kind === "worker" ? [suite.source] : suite.sources))];
const sources = new Map(sourcePaths.map(path => [path, readFileSync(resolve(root, path), "utf8")]));
const processResult = (output: string, overrides: Partial<ProofProcess> = {}): ProofProcess => ({ command: "tool", args: [],
  exitCode: 0, signal: null, timedOut: false, outputExceeded: false, output, elapsedMs: 1, ...overrides });
const worker = manifest.suites.find(suite => suite.kind === "worker")!;
const cargo = manifest.suites.find(suite => suite.kind === "cargo")!;
const workerOutput = (count = (worker as { expectedTests: number }).expectedTests) => ` ✓ test/x.worker.ts (${count} tests) 1200ms\n\n Test Files  1 passed (1)\n      Tests  ${count} passed (${count})\n   Duration  6.52s (tests 4.04s)\n`;
const cargoOutput = (tests = cargo.tests) => tests.map(name => `test ${name} ... ok`).join("\n")
  + `\n\ntest result: ok. ${tests.length} passed; 0 failed; 0 ignored; 0 measured; 90 filtered out; finished in 0.68s\n\n   Doc-tests aicharts_x\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n`;

describe("fault matrix manifest", () => {
  test("the checked manifest lists existing suites, existing tests and covers or declares every failure class", () => {
    expect(() => validateManifest(manifest, sources)).not.toThrow();
    expect(manifest.gaps.map(gap => gap.failureClass)).toEqual(["disk-full"]);
    expect(Object.keys(manifest.failureClasses).sort()).toEqual(["capacity-exhaustion", "crash-after-effect", "crash-before-effect", "disk-full", "lost-reply", "restore-race"]);
    for (const suite of manifest.suites) expect(suite.tests.length, suite.id).toBeGreaterThan(0);
  });
  test("a renamed test, missing source, duplicate suite, uncovered class or contradictory gap is refused", () => {
    const edits: ((copy: FaultManifest, copySources: Map<string, string>) => void)[] = [
      copy => { copy.suites[0].tests[0] = "no such test"; },
      copy => { (copy.suites.find(suite => suite.kind === "cargo")!.tests as string[])[0] = "tests::no_such_test"; },
      (_copy, copySources) => { copySources.delete(worker.kind === "worker" ? worker.source : ""); },
      copy => { copy.suites.push(structuredClone(copy.suites[0])); },
      copy => { copy.suites[0].failureClasses.push("unknown-class"); },
      copy => { copy.failureClasses["never-covered"] = "x"; },
      copy => { copy.gaps.push({ failureClass: "lost-reply", reason: "contradiction" }); },
      copy => { copy.gaps.push({ failureClass: "unknown", reason: "x" }); },
      copy => { (copy.suites.find(suite => suite.kind === "worker") as { expectedTests: number }).expectedTests = 1; },
      copy => { copy.suites[0].tests.push(copy.suites[0].tests[0]); },
    ];
    for (const edit of edits) {
      const copy = structuredClone(manifest), copySources = new Map(sources);
      edit(copy, copySources);
      expect(() => validateManifest(copy, copySources)).toThrow();
    }
  });
  test("selection honours platforms and --suite filters and rejects unknown ids", () => {
    const darwin = selectSuites(manifest, parseFaultOptions([]), "darwin");
    expect([...darwin.values()].every(status => status === "selected")).toBe(true);
    const linux = selectSuites(manifest, parseFaultOptions([]), "linux");
    expect([...linux.entries()].filter(([, status]) => status === "skipped-platform").map(([id]) => id)).toEqual(["custody-macos-interrupted-stages", "platform-acl-macos-native-faults"]);
    const one = selectSuites(manifest, parseFaultOptions(["--suite", worker.id]), "linux");
    expect(one.get(worker.id)).toBe("selected");
    expect(one.get(cargo.id)).toBe("not-selected");
    expect(() => selectSuites(manifest, parseFaultOptions(["--suite", "nope"]), "linux")).toThrow();
    expect(() => parseFaultOptions(["extra"])).toThrow();
  });
  test("commands run the exact worker file through vitest and exact cargo test names", () => {
    const workerCommand = suiteCommand(worker);
    expect(workerCommand.command).toBe("node");
    expect(workerCommand.args.slice(-1)).toEqual([(worker as { source: string }).source.replace("services/usage-worker/", "")]);
    expect(workerCommand.args).toContain("vitest.config.ts");
    const cargoCommand = suiteCommand(cargo);
    expect(cargoCommand.args).toEqual(["test", "--locked", "-p", (cargo as { package: string }).package, "--", "--exact", ...cargo.tests]);
  });
});

describe("fault suite admission", () => {
  test("admits exact passing summaries for both kinds", () => {
    expect(validateSuiteOutput(worker, processResult(workerOutput()))).toEqual({ passed: (worker as { expectedTests: number }).expectedTests });
    expect(validateSuiteOutput(cargo, processResult(cargoOutput()))).toEqual({ passed: cargo.tests.length });
  });
  test("rejects timeouts, failures, count drift, missing tests and infrastructure errors", () => {
    const cases: [string, typeof worker | typeof cargo, ProofProcess][] = [
      ["timeout", worker, processResult(workerOutput(), { timedOut: true, exitCode: null })],
      ["exit code", worker, processResult(workerOutput(), { exitCode: 1 })],
      ["count drift", worker, processResult(workerOutput((worker as { expectedTests: number }).expectedTests + 1))],
      ["partial vitest", worker, processResult(workerOutput().replace(/Tests\s+(\d+) passed \(\d+\)/u, "Tests  1 passed (2)"))],
      ["worker startup", worker, processResult(workerOutput() + "\nError during worker startup\n")],
      ["cargo failed", cargo, processResult(cargoOutput().replace("test result: ok. ", "test result: FAILED. "), { exitCode: 101 })],
      ["cargo missing test", cargo, processResult(cargoOutput(cargo.tests.slice(1)))],
      ["cargo renamed test", cargo, processResult(cargoOutput().replace(`test ${cargo.tests[0]} ... ok`, `test ${cargo.tests[0]}_renamed ... ok`))],
      ["cargo ignored", cargo, processResult(cargoOutput().replace("0 failed; 0 ignored", "0 failed; 1 ignored"))],
      ["cargo no summary", cargo, processResult("nothing")],
      ["cargo compile error", cargo, processResult("error[E0425]: cannot find value\n" + cargoOutput())],
    ];
    for (const [name, suite, result] of cases) expect(() => validateSuiteOutput(suite, result), name).toThrow();
  });
});
