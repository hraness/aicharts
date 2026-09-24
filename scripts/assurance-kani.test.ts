import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { admitKani, kaniHarnessesSchema, rejectKaniAssumptions, unreachableAssertionSchema, unreachableBindingKey } from "./assurance-kani";
import { mutationsSchema, type ProofProcess } from "./assurance-proof-common";

const read = (path: string) => JSON.parse(readFileSync(resolve(import.meta.dir, "..", path), "utf8"));
const fixture = () => read("verify/kani/fixtures/checked-add.json");
const harness = kaniHarnessesSchema.parse(read("verify/kani/harnesses.json")).harnesses[0];
const mutation = mutationsSchema.parse(read("verify/kani/mutations.json")).mutations[0];
const pin = read("verify/kani/toolchain.json");
const exceptions = [...pin.unreachableAssertions, ...pin.platforms["darwin-arm64"].unreachableAssertions];
const process: ProofProcess = { command: "cargo-kani", args: [], exitCode: 0, signal: null,
  timedOut: false, outputExceeded: false, output: "", elapsedMs: 1 };
const admit = (raw: unknown, command = process, negative = false) => admitKani(raw, command, [harness],
  "aarch64-apple-darwin", pin.rustc, exceptions, negative ? mutation : undefined);

describe("Kani structured evidence admission", () => {
  test("admits completed actual assertions and all exact covers", () => {
    expect(admit(fixture()).errors).toEqual([]);
  });
  test("zero obligations, missing reports and timeout-shaped JSON cannot pass", () => {
    expect(admit(null).ok).toBe(false);
    const empty = fixture(); empty.verification_results.results = [];
    expect(admit(empty).ok).toBe(false);
    const timeout = fixture(); timeout.verification_results.results[0].checks = [];
    for (const key of Object.keys(timeout.property_details[0].property_details)) timeout.property_details[0].property_details[key] = null;
    expect(admit(timeout, { ...process, exitCode: 0, output: "1 successfully verified harnesses" }).ok).toBe(false);
  });
  test("an apparent pass refuses signal, deadline, output truncation and tool drift", () => {
    for (const fault of [{ signal: "SIGKILL" }, { timedOut: true }, { outputExceeded: true }, { exitCode: 1 }]) {
      expect(admit(fixture(), { ...process, ...fault }).ok).toBe(false);
    }
    const tool = fixture(); tool.tools.rustc = "another compiler";
    expect(admit(tool).ok).toBe(false);
  });
  test("missing, duplicated, unreachable or unsatisfied covers refuse", () => {
    for (const fault of ["missing", "duplicate", "unreachable", "unsatisfiable"]) {
      const raw = fixture(), checks = raw.verification_results.results[0].checks;
      const cover = checks.find((item: { category: string }) => item.category === "cover");
      if (fault === "missing") checks.splice(checks.indexOf(cover), 1);
      else if (fault === "duplicate") checks.push(cover);
      else cover.status = fault === "unreachable" ? "Unreachable" : "Unsatisfiable";
      expect(admit(raw).ok).toBe(false);
    }
  });
  test("wrong inventory, invented counts and unknown checks refuse", () => {
    for (const modify of [
      (raw: ReturnType<typeof fixture>) => { raw.harness_metadata[0].pretty_name = "proofs::another"; },
      (raw: ReturnType<typeof fixture>) => { raw.property_details[0].property_details.passed++; },
      (raw: ReturnType<typeof fixture>) => { raw.verification_results.results[0].checks[0].status = "Unknown"; },
      (raw: ReturnType<typeof fixture>) => { raw.harness_metadata[0].attributes.should_panic = true; },
      (raw: ReturnType<typeof fixture>) => { raw.harness_metadata[0].attributes.stubs = [{ original: "production", replacement: "fake" }]; },
      (raw: ReturnType<typeof fixture>) => { raw.harness_metadata[0].is_bounded = true; },
      (raw: ReturnType<typeof fixture>) => { raw.harness_metadata[0].is_ctor_based = true; },
      (raw: ReturnType<typeof fixture>) => { raw.verification_results.results[0].checks[0].category = "invented"; },
      (raw: ReturnType<typeof fixture>) => { raw.verification_results.results[0].checks[1].id = raw.verification_results.results[0].checks[0].id; },
    ]) { const raw = fixture(); modify(raw); expect(admit(raw).ok).toBe(false); }
  });
  test("a mutant must fail its exact unchanged assertion with every other check complete", () => {
    const raw = fixture();
    raw.verification_results.summary.successful = 0; raw.verification_results.summary.failed = 1;
    raw.verification_results.results[0].status = "Failure";
    const check = raw.verification_results.results[0].checks.find((item: { description: string }) => item.description === mutation.expectedFailedAssertion);
    check.status = "Failure";
    raw.property_details[0].property_details.passed--; raw.property_details[0].property_details.failed++;
    raw.error_details[0] = { harness_id: harness.name, has_errors: true, error_type: "assertion_failure", exit_status: "properties_failed" };
    expect(admit(raw, { ...process, exitCode: 1 }, true).errors).toEqual([]);
    expect(admit(raw, { ...process, exitCode: 2 }, true).ok).toBe(false);
    check.description = "an unrelated assertion";
    expect(admit(raw, { ...process, exitCode: 1 }, true).ok).toBe(false);
  });
  test("reachable library safety checks cannot substitute for a reachable harness domain assertion", () => {
    const raw = fixture();
    for (const check of raw.verification_results.results[0].checks) {
      if (check.category === "assertion" && check.function === harness.name) check.category = "safety_check";
    }
    expect(admit(raw).errors).toContain(`${harness.name}:vacuous_assertions`);
  });
  test("an unreachable exception requires its exact harness, function, category, location and verified source hash", () => {
    const entry = unreachableAssertionSchema.parse({ ...exceptions[0], harness: harness.name });
    const raw = fixture(), checks = raw.verification_results.results[0].checks;
    checks.push({ id: 1000000, function: entry.function, category: entry.category, status: "Unreachable", description: entry.description, location: entry.location });
    raw.property_details[0].property_details.total_properties++;
    raw.property_details[0].property_details.unreachable++;
    const validate = (allow = entry, hashes = { [unreachableBindingKey(entry)]: entry.binding.sha256 }) =>
      admitKani(raw, process, [harness], "aarch64-apple-darwin", pin.rustc, [allow], undefined, hashes);
    expect(validate().errors).toEqual([]);
    expect(validate(entry, {}).ok).toBe(false);
    expect(validate(entry, { [unreachableBindingKey(entry)]: "0".repeat(64) }).ok).toBe(false);
    for (const change of [
      { harness: "other" }, { function: "other" }, { description: "other" },
      { location: { ...entry.location, file: "other.rs" } },
      { location: { ...entry.location, line: "999" } }, { location: { ...entry.location, column: "999" } },
    ]) expect(validate({ ...entry, ...change }).ok).toBe(false);
  });
  test("unregistered Kani domain assumptions, contract attributes and replacement stubs refuse", () => {
    expect(() => rejectKaniAssumptions("#[kani::proof]\n#[kani::unwind(97)]\nfn actual() { let value: u128 = kani::any(); kani::cover!(value == 0); }")).not.toThrow();
    for (const source of ["kani::assume(value < 100);", "#[kani::stub(actual, fake)]", "#[kani::stub_verified(actual)]",
      "#[kani::requires(value < 100)]", "#[kani::proof_for_contract(actual)]"]) {
      expect(() => rejectKaniAssumptions(source)).toThrow("unreviewed_kani_assumption_or_stub");
    }
  });
});
