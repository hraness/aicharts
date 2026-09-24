import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { casesSchema, conformanceEnvironment, conformanceStageUnchanged, mutationsSchema, stageConformanceInputs,
  validateCaseInventory, validateMutation, validateTraces, type ConformanceTrace } from "./assurance-conformance";
import { sha256, type ProofProcess } from "./assurance-proof-common";

const fixture = (path: string) => JSON.parse(readFileSync(resolve(import.meta.dir, "..", path), "utf8")) as unknown;
const manifest = casesSchema.parse(fixture("verify/conformance/cases.json"));
const mutation = mutationsSchema.parse(fixture("verify/conformance/mutations.json")).mutations[0];
const processResult = (output: string, overrides: Partial<ProofProcess> = {}): ProofProcess => ({ command: "fixture-tool", args: [],
  exitCode: 0, signal: null, timedOut: false, outputExceeded: false, output, elapsedMs: 1, ...overrides });

function traces(id: "worker" | "ledger" | "browser-contract"): ConformanceTrace[] {
  return manifest.cases.filter(entry => entry.adapter === id).flatMap(entry => entry.seeds.map(seed => {
    const steps = entry.requiredCoverage.map(item => {
      const [command, outcome] = item.split(":");
      return { command, input: { seed }, outcome, expected: { rows: [1, 2], revision: 1 }, actual: { rows: [1, 2], revision: 1 } };
    });
    while (steps.length < entry.minSteps) steps.push(structuredClone(steps[0]));
    return { schemaVersion: 1 as const, model: entry.model, seed, steps,
      coverage: [...new Set(steps.map(step => `${step.command}:${step.outcome}`))].sort() };
  }));
}
function positiveOutput(id: "worker" | "ledger" | "browser-contract", cases = traces(id)) {
  const count = manifest.adapters[id].expectedTests;
  const summary = id === "worker" ? ` Test Files  1 passed (1)\n      Tests  ${count} passed (${count})\n   Duration  6.52s (tests 4.04s)`
    : id === "ledger" ? `test result: ok. ${count} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.68s`
    : ` ${count} pass\n 0 fail`;
  return cases.map(trace => `${manifest.tracePrefix}${JSON.stringify(trace)}`).join("\n") + `\n${summary}\n`;
}
function mutationOutput() {
  const failures = manifest.cases.find(entry => entry.model === "M1")!.seeds.map(seed =>
    ` FAIL  test/assurance-conformance.worker.ts > ${mutation.testName} seed=${seed}\nError: ${mutation.expectedSemanticFailure} ${JSON.stringify({ seed, index: 4, input: { epoch: 1 }, expectedOutcome: "recovery_required", outcome: "ok" })}\n`);
  return failures.join("\n") + "\n Test Files  1 failed (1)\n      Tests  3 failed | 27 passed (30)\n   Duration  6.52s (tests 4.04s)\n";
}
const admitMutation = (output: string, overrides: Partial<ProofProcess> = {}) =>
  validateMutation(processResult(output, { exitCode: 1, ...overrides }), mutation.expectedSemanticFailure);

describe("conformance evidence admission", () => {
  test("admits the complete retained inventory and all three adapter summaries", () => {
    expect(() => validateCaseInventory(manifest)).not.toThrow();
    for (const id of ["worker", "ledger", "browser-contract"] as const) {
      expect(validateTraces(manifest, id, processResult(positiveOutput(id)))).toEqual(traces(id));
    }
  });
  test("pins commands, adapter paths, retained seeds, test counts and every model", () => {
    for (const change of [
      (copy: typeof manifest) => { copy.adapters.worker.command[0] = "other-tool"; },
      (copy: typeof manifest) => { copy.adapters.worker.source = "../other-adapter.ts"; },
      (copy: typeof manifest) => { copy.adapters.worker.expectedTests--; },
      (copy: typeof manifest) => { copy.cases[0].seeds[0]++; },
      (copy: typeof manifest) => { copy.cases[0].requiredCoverage.push(copy.cases[0].requiredCoverage[0]); },
      (copy: typeof manifest) => { copy.cases[0].maxSteps = copy.cases[0].minSteps - 1; },
      (copy: typeof manifest) => { copy.cases[0].model = copy.cases[1].model; },
      (copy: typeof manifest) => { copy.expectedTraceCount--; },
      (copy: typeof manifest) => { copy.cases.find(entry => entry.model === "M3")!.model = "M2-other"; },
    ]) { const copy = structuredClone(manifest); change(copy); expect(() => validateCaseInventory(copy)).toThrow(); }
  });
  test("zero exit alone cannot admit timeout, truncation, signal or missing test completion", () => {
    const output = positiveOutput("worker");
    for (const fault of [{ exitCode: 1 }, { exitCode: null }, { timedOut: true }, { signal: "SIGKILL" }, { outputExceeded: true }]) {
      expect(() => validateTraces(manifest, "worker", processResult(output, fault))).toThrow();
    }
    for (const altered of [output.replace("30 passed (30)", "29 passed (30)"), output.replace("1 passed (1)", "1 failed (1)"),
      output.replace(/   Duration[^\n]+/u, ""), output + "\nUnhandled Errors\n", output + "\n FAIL  another test\n",
      output + "\n      Tests  30 passed (30)\n"]) {
      expect(() => validateTraces(manifest, "worker", processResult(altered))).toThrow();
    }
  });
  test("missing, duplicated, unretained and malformed traces refuse", () => {
    const cases = traces("worker");
    const unknown = structuredClone(cases); unknown[0].seed++;
    for (const altered of [positiveOutput("worker", cases.slice(1)), positiveOutput("worker", [...cases, cases[0]]),
      positiveOutput("worker", unknown), positiveOutput("worker") + `${manifest.tracePrefix}{broken}\n`,
      positiveOutput("worker") + `${manifest.tracePrefix}${"x".repeat(manifest.limits.maxTraceBytes + 1)}\n`]) {
      expect(() => validateTraces(manifest, "worker", processResult(altered))).toThrow();
    }
  });
  test("every transition must contain input and equal observations with exact derived coverage", () => {
    for (const change of [
      (copy: ConformanceTrace[]) => { copy[0].steps[0].actual = { wrong: true }; },
      (copy: ConformanceTrace[]) => { delete copy[0].steps[0].expected; },
      (copy: ConformanceTrace[]) => { delete copy[0].steps[0].input; },
      (copy: ConformanceTrace[]) => { copy[0].coverage.push("invented:ok"); },
      (copy: ConformanceTrace[]) => { copy[0].coverage.reverse(); },
      (copy: ConformanceTrace[]) => { copy[0].steps.splice(0, 1); copy[0].coverage = [...new Set(copy[0].steps.map(step => `${step.command}:${step.outcome}`))].sort(); },
    ]) { const copy = traces("worker"); change(copy); expect(() => validateTraces(manifest, "worker", processResult(positiveOutput("worker", copy)))).toThrow(); }
  });
  test("admits only the three exact original M1 assertions as the mutation counterexample", () => {
    expect(() => admitMutation(mutationOutput())).not.toThrow();
    for (const fault of [{ exitCode: 0 }, { exitCode: 2 }, { timedOut: true }, { signal: "SIGKILL" }, { outputExceeded: true }]) {
      expect(() => admitMutation(mutationOutput(), fault)).toThrow();
    }
  });
  test("mutation marker text alone, another failure, wrong seeds and infrastructure errors refuse", () => {
    const output = mutationOutput();
    for (const altered of [mutation.expectedSemanticFailure, output.replace(mutation.testName, "unrelated test"),
      output.replace('"seed":1066793', '"seed":1066794'), output.replace('"epoch":1', '"epoch":0'),
      output.replace('"expectedOutcome":"recovery_required"', '"expectedOutcome":"conflict"'),
      output.replace('"outcome":"ok"', '"outcome":"storage_unavailable"'),
      output.replace("3 failed | 27 passed (30)", "3 failed | 26 passed (29)"),
      output.replace(/   Duration[^\n]+/u, ""), output + "\n FAIL  an extra test\n",
      ...["Unhandled Errors", "Failed to load", "Error during worker startup", "Transform failed", "timed out"].map(error => output + `\n${error}\n`)]) {
      expect(() => admitMutation(altered)).toThrow();
    }
  });
  test("the mutation inventory cannot redefine the guard or change an adapter", () => {
    for (const property of ["exactBefore", "exactAfter", "source", "adapter", "expectedSemanticFailure"] as const) {
      const copy = mutationsSchema.parse(fixture("verify/conformance/mutations.json"));
      expect(() => mutationsSchema.parse({ ...copy, mutations: [{ ...copy.mutations[0], [property]: "changed" }] })).toThrow();
    }
  });
});

describe("conformance source and tool binding", () => {
  test("stages both controls with only the exact production change and detects later drift", async () => {
    const run = await mkdtemp(resolve(tmpdir(), "aicharts-conformance-stage-"));
    try {
      const dependencies = resolve(run, "dependencies"); await mkdir(dependencies);
      const source = new Map([
        [mutation.source, Buffer.from(`before\n${mutation.exactBefore}\nafter\n`)],
        [mutation.adapter, Buffer.from("unchanged production adapter")],
        ["verify/tla/M1RestoreRepaired.tla", Buffer.from("unchanged formal model")],
        ["verify/tla/repaired-action-map.md", Buffer.from("unchanged action correspondence")],
        ["crates/aicharts-ledger/tests/assurance_conformance.rs", Buffer.from("unchanged native adapter")],
      ]);
      const positive = await stageConformanceInputs(run, "positive", source, dependencies);
      const mutant = await stageConformanceInputs(run, "mutant", source, dependencies, mutation);
      expect(await conformanceStageUnchanged(positive)).toBe(true);
      expect(await conformanceStageUnchanged(mutant)).toBe(true);
      for (const [path, bytes] of source) {
        expect(positive.sourceSha256[path]).toBe(sha256(bytes));
        if (path !== mutation.source) expect(mutant.sourceSha256[path]).toBe(positive.sourceSha256[path]);
      }
      expect((await readFile(resolve(mutant.path, mutation.source), "utf8"))).toBe(`before\n${mutation.exactAfter}\nafter\n`);
      await writeFile(resolve(positive.path, mutation.adapter), "changed adapter");
      expect(await conformanceStageUnchanged(positive)).toBe(false);
      expect(await conformanceStageUnchanged(mutant)).toBe(true);
      await rm(resolve(mutant.path, "node_modules"));
      await symlink(run, resolve(mutant.path, "node_modules"), "dir");
      expect(await conformanceStageUnchanged(mutant)).toBe(false);
    } finally { await rm(run, { recursive: true, force: true }); }
  });
  test("refuses missing or duplicate source matches, traversal, and a reused stage", async () => {
    const run = await mkdtemp(resolve(tmpdir(), "aicharts-conformance-refusal-"));
    try {
      const dependencies = resolve(run, "dependencies"); await mkdir(dependencies);
      for (const bytes of ["missing", mutation.exactBefore.repeat(2)]) {
        await expect(stageConformanceInputs(run, "mutant", new Map([[mutation.source, Buffer.from(bytes)]]), dependencies, mutation)).rejects.toThrow("conformance_mutation_source_drift");
      }
      for (const path of ["../outside", "/absolute", "nested/../outside", "node_modules/injected.ts", "nested\\outside"]) {
        await expect(stageConformanceInputs(run, "positive", new Map([[path, Buffer.from("bad")]]), dependencies)).rejects.toThrow("conformance_source_path_invalid");
      }
      await stageConformanceInputs(run, "positive", new Map([["file.ts", Buffer.from("source")]]), dependencies);
      await expect(stageConformanceInputs(run, "positive", new Map([["file.ts", Buffer.from("source")]]), dependencies)).rejects.toThrow();
    } finally { await rm(run, { recursive: true, force: true }); }
  });
  test("pins child tool lookup and excludes inherited runtime/compiler injection", () => {
    const environment = conformanceEnvironment({ PATH: "/ordinary/tools", HOME: "/user", CARGO_HOME: "/cargo-cache",
      NODE_OPTIONS: "--require=unrecorded.js", BUN_OPTIONS: "unrecorded", RUSTC_WRAPPER: "/unrecorded", RUSTFLAGS: "--cfg altered",
      CARGO_ENCODED_RUSTFLAGS: "altered", MINIFLARE_WORKERD_PATH: "/other-workerd", CLOUDFLARE_API_TOKEN: "synthetic-secret" }, "/recorded/tools", "/recorded/target");
    expect(environment).toEqual({ NODE_ENV: "test", PATH: `/recorded/tools${delimiter}/ordinary/tools`, HOME: "/user", CARGO_HOME: "/cargo-cache",
      NO_COLOR: "1", FORCE_COLOR: "0", CARGO_TARGET_DIR: "/recorded/target" });
  });
});
