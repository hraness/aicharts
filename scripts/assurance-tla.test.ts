import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateTlc, validateTlcConfig, type ModelCase, type ProcessResult, type TraceState } from "./assurance-tla";

const models = resolve(import.meta.dir, "../verify/tla");
const manifest = JSON.parse(readFileSync(resolve(models, "cases.json"), "utf8")) as { cases: ModelCase[] };
const getCase = (id: string) => {
  const value = manifest.cases.find(item => item.id === id);
  if (!value) throw new Error(`missing_fixture_case:${id}`);
  return value;
};
const failure = getCase("m4-aba-resurrection"), sanity = getCase("m4-supersession-structural-sanity");
const log = (id: string) => readFileSync(resolve(models, "traces", `${id}.tool-output.txt`), "utf8");
const result = (output: string, exitCode: number): ProcessResult => ({ output, exitCode, signal: null, timedOut: false, outputExceeded: false });

describe("pinned TLC evidence admission", () => {
  test("the complete baseline suite retains all fifteen named configurations", () => {
    expect(manifest.cases.map(item => item.id).sort()).toEqual([
      "m1-expired-live-lease", "m1-late-sql-after-publish", "m1-unfenced-persistent-effect",
      "m1-structural-sanity", "m1-healthy-settlement-witness", "m1-permitted-orphan-witness",
      "m4-foreign-population-loss", "m4-contributions-structural-sanity", "m4-proven-overlap-sanity",
      "m4-read-retry-witness", "m4-aba-resurrection", "m4-aba-double-charge",
      "m4-supersession-structural-sanity", "m4-successful-retry-witness", "m4-capacity-refusal-witness",
      "m12-unguarded-overcount-commits", "m12-committed-overcount-persists",
    ].sort());
    expect(Object.fromEntries(["counterexample", "sanity", "witness"].map(kind =>
      [kind, manifest.cases.filter(item => item.kind === kind).length]))).toEqual({ counterexample: 7, sanity: 4, witness: 6 });
  });
  test("admits the recorded expected violation and completed sanity output separately", () => {
    const counterexample = evaluateTlc(failure, result(log(failure.id), 12));
    expect(counterexample.errors).toEqual([]);
    expect(counterexample.trace.map(state => state.action)).toEqual(["Init", "ReserveFirstA", "Supersede", "ReserveB", "Supersede", "ReplayA"]);
    expect(evaluateTlc(sanity, result(log(sanity.id), 0)).errors).toEqual([]);
  });
  test("a green sanity run cannot satisfy an expected-failure case", () => {
    expect(evaluateTlc(failure, result(log(sanity.id), 0)).ok).toBe(false);
    expect(evaluateTlc(sanity, result(log(failure.id), 12)).ok).toBe(false);
  });
  test("wrong invariant, changed counts, missing finish and unrelated runtime failures refuse", () => {
    const output = log(failure.id);
    expect(evaluateTlc(failure, result(output.replace("Invariant SupersededCannotReturn", "Invariant TypeOK"), 12)).ok).toBe(false);
    expect(evaluateTlc(failure, result(output, 255)).ok).toBe(false);
    expect(evaluateTlc(failure, result(output.replace(/@!@!@STARTMSG 2186:0[\s\S]*$/u, ""), 12)).ok).toBe(false);
    const runtimeError = "@!@!@STARTMSG 2109:1 @!@!@\nSuccessor state is not completely specified.\n@!@!@ENDMSG 2109 @!@!@\n";
    expect(evaluateTlc(failure, result(`${output}${runtimeError}`, 12)).errors).toContain("unrelated TLC failure");
    expect(evaluateTlc({ ...sanity, expectedDistinctStates: 28 }, result(log(sanity.id), 0)).errors).toContain("reachable-state count drift");
    expect(evaluateTlc(failure, result(`${output}@!@!@STARTMSG 1000:1 @!@!@\nTruncated exception`, 12)).errors).toContain("incomplete or malformed TLC tool frame");
  });
  test("whitespace, duplicate deadlock declarations and restrictions cannot bypass config admission", () => {
    const config = readFileSync(resolve(models, failure.config), "utf8");
    expect(validateTlcConfig(config, failure)).toEqual([]);
    for (const directive of ["   CONSTRAINT HideFailure", "\tACTION_CONSTRAINT HideFailure", " VIEW HideState", " SYMMETRY HideIdentity", " CHECK_DEADLOCK FALSE", "CHECK_DEADLOCK TRUE"]) {
      expect(validateTlcConfig(`${config}\n${directive}\n`, failure).length).toBeGreaterThan(0);
    }
  });
  test("deadline, signal, byte ceiling, truncated trace and lost mechanism cannot pass", () => {
    const valid = result(log(failure.id), 12);
    for (const fault of [{ timedOut: true }, { outputExceeded: true }, { signal: "SIGKILL" }]) {
      expect(evaluateTlc(failure, { ...valid, ...fault }).errors).toContain("incomplete or resource-limited run");
    }
    const missingReplay = valid.output.replace(/@!@!@STARTMSG 2217:4 @!@!@\n6:[\s\S]*?@!@!@ENDMSG 2217 @!@!@/u, "");
    expect(evaluateTlc(failure, { ...valid, output: missingReplay }).ok).toBe(false);
    expect(evaluateTlc({ ...failure, requiredActions: ["NeverReached"] }, valid).errors).toContain("required mechanism absent from trace");
  });
  test("incomplete exploration and vacuous counts cannot qualify sanity", () => {
    const output = log(sanity.id);
    expect(evaluateTlc(sanity, result(output.replace("0 states left on queue", "1 states left on queue"), 0)).ok).toBe(false);
    expect(evaluateTlc(sanity, result(output.replace(`${sanity.expectedDistinctStates} distinct states found`, "1 distinct states found"), 0)).ok).toBe(false);
  });
  test("frozen traces bind their model and configuration and retain actual states", () => {
    let traces = 0;
    for (const modelCase of manifest.cases) {
      if (modelCase.kind === "sanity") {
        expect(modelCase.expectedDistinctStates).not.toBeNull();
        continue;
      }
      if (modelCase.invariant === null) throw new Error("non_sanity_fixture_requires_invariant");
      const trace = JSON.parse(readFileSync(resolve(models, "traces", `${modelCase.id}.json`), "utf8")) as {
        case: string; invariant: string; states: TraceState[]; moduleSha256: string; configSha256: string;
      };
      expect(trace.case).toBe(modelCase.id);
      expect(trace.invariant).toBe(modelCase.invariant);
      expect(trace.states.length).toBeGreaterThanOrEqual(modelCase.minTraceStates);
      const hash = (file: string) => createHash("sha256").update(readFileSync(resolve(models, file))).digest("hex");
      expect(trace.moduleSha256).toBe(hash(`${modelCase.module}.tla`));
      expect(trace.configSha256).toBe(hash(modelCase.config));
      traces++;
    }
    expect(traces).toBe(13);
  });
});
