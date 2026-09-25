import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateTlc, manifestSchema, runTla, tlaProfiles, validateTlcConfig, type ModelCase, type ProcessResult, type TraceState } from "./assurance-tla";

const models = resolve(import.meta.dir, "../verify/tla");
const manifest = JSON.parse(readFileSync(resolve(models, "cases.json"), "utf8")) as { cases: ModelCase[] };
const repaired = JSON.parse(readFileSync(resolve(models, "repaired-cases.json"), "utf8")) as { cases: ModelCase[] };
const nightly = JSON.parse(readFileSync(resolve(models, "nightly-cases.json"), "utf8")) as { cases: ModelCase[] };
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
  test("the repaired suite retains every guard-removal counterexample with its exact expected trace", () => {
    expect(repaired.cases).toHaveLength(87);
    expect(Object.fromEntries(["counterexample", "sanity", "witness"].map(kind =>
      [kind, repaired.cases.filter(item => item.kind === kind).length]))).toEqual({ counterexample: 22, sanity: 19, witness: 46 });
    const guard = (id: string, constant: string) => {
      const value = repaired.cases.find(item => item.id === id);
      if (!value) throw new Error(`missing_guard_case:${id}`);
      expect(value.kind).toBe("counterexample"); expect(value.invariant).toBe("Safety");
      expect(value.requiredActions.length).toBeGreaterThanOrEqual(2);
      const config = readFileSync(resolve(models, value.config), "utf8");
      expect(config).toContain(`CONSTANT ${constant} = TRUE`); expect(validateTlcConfig(config, value)).toEqual([]);
      const source = readFileSync(resolve(models, `${value.module}.tla`), "utf8");
      expect(source).toContain(constant);
    };
    guard("m2-negative-freeze", "UnsafeFreeze"); guard("m3-negative-revocation", "UnsafeRevocation");
    guard("m5-negative-generation", "UnsafeGeneration"); guard("m6-negative-stale-delivery", "UnsafeStaleDelivery");
    guard("m7-negative-scrub", "UnsafeScrub");
  });
});

describe("nightly bounds profile", () => {
  const nightlyText = readFileSync(resolve(models, "nightly-cases.json"), "utf8");
  const repairedText = readFileSync(resolve(models, "repaired-cases.json"), "utf8");
  test("profiles state exact reviewed bounds and the nightly manifest binds to the nightly profile only", () => {
    expect(tlaProfiles.development).toEqual({ workers: 1, heapMiB: 256, timeoutMs: 60_000, maxOutputBytes: 1_048_576, maxDistinctStates: 300_000 });
    expect(tlaProfiles.nightly).toEqual({ workers: 4, heapMiB: 2048, timeoutMs: 600_000, maxOutputBytes: 8_388_608, maxDistinctStates: 3_000_000 });
    expect(manifestSchema("nightly").safeParse(JSON.parse(nightlyText)).success).toBe(true);
    expect(manifestSchema("development").safeParse(JSON.parse(nightlyText)).success).toBe(false);
    expect(manifestSchema("development").safeParse(JSON.parse(repairedText)).success).toBe(true);
    expect(manifestSchema("nightly").safeParse(JSON.parse(repairedText)).success).toBe(false);
    expect(nightly.cases.map(item => item.id)).toEqual(["m1-nightly-safety", "m1-nightly-orphan", "m11-nightly-sequential-safety", "m11-nightly-negative-quota", "m12-nightly-reclamation-wide-safety"]);
    // The nightly M1/M11 sanity floors exceed their development counterparts, so the nightly configs explore a wider domain.
    expect(nightly.cases.find(item => item.id === "m1-nightly-safety")?.minDistinctStates).toBeGreaterThan(2554);
    expect(nightly.cases.find(item => item.id === "m11-nightly-sequential-safety")?.minDistinctStates).toBeGreaterThan(221596);
  });
  test("numeric CONSTANT parameters are admitted only in the reviewed positive range", () => {
    const value = nightly.cases[0];
    const config = readFileSync(resolve(models, value.config), "utf8");
    expect(config).toContain("CONSTANT OpCount = 3");
    expect(validateTlcConfig(config, value)).toEqual([]);
    for (const constant of ["CONSTANT OpCount = 0", "CONSTANT OpCount = -1", "CONSTANT OpCount = 1000", "CONSTANT OpCount = 03", "CONSTANT OpCount = 3 + 1"]) {
      expect(validateTlcConfig(config.replace("CONSTANT OpCount = 3", constant), value)).toContain("unreviewed configuration directive");
    }
    for (const [id, quota] of [["m11-nightly-sequential-safety", 3], ["m11-nightly-negative-quota", 6]] as const) {
      const m11 = readFileSync(resolve(models, `configs/${id}.cfg`), "utf8");
      expect(m11).toContain("CONSTANT JobCount = 3"); expect(m11).toContain(`CONSTANT Quota = ${quota}`);
    }
    expect(readFileSync(resolve(models, "configs/m11-sequential-safety.cfg"), "utf8")).toContain("CONSTANT JobCount = 2");
  });
  test("a development-sized ceiling refuses counts that the nightly ceiling admits", () => {
    const wide = { ...sanity, expectedDistinctStates: 400_000, minDistinctStates: 2 };
    const output = log(sanity.id).replace(/\d[\d,]* states generated, \d[\d,]* distinct states found/u, "900,000 states generated, 400,000 distinct states found");
    expect(evaluateTlc(wide, result(output, 0)).errors).toContain("missing, vacuous or excessive exploration counts");
    expect(evaluateTlc(wide, result(output, 0), tlaProfiles.nightly.maxDistinctStates).errors).toEqual([]);
    expect(evaluateTlc(wide, result(output, 0), tlaProfiles.development.maxDistinctStates).ok).toBe(false);
  });
  test("the nightly profile and the nightly suite are inseparable", async () => {
    await expect(runTla({ profile: "nightly", suite: "repaired" })).rejects.toThrow("nightly_profile_and_suite_must_match");
    await expect(runTla({ profile: "nightly", suite: "all" })).rejects.toThrow("nightly_profile_and_suite_must_match");
    await expect(runTla({ suite: "nightly" })).rejects.toThrow("nightly_profile_and_suite_must_match");
    await expect(runTla({ profile: "development", suite: "nightly" })).rejects.toThrow("nightly_profile_and_suite_must_match");
  });
});
