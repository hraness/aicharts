import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { admitLean, admitLeanMutation, admitTranslation, leanMutationsSchema, rejectAdmissions } from "./assurance-theorems";
import { applyExactMutation, proofRoot, type ProofProcess } from "./assurance-proof-common";

const result = (output: string, exitCode = 0): ProofProcess => ({ command: "lean", args: [], output,
  exitCode, signal: null, timedOut: false, outputExceeded: false, elapsedMs: 1 });
const valid = "'Example.first' depends on axioms: [propext, Quot.sound]\n'Example.second' does not depend on any axioms\n";

describe("production theorem evidence admission", () => {
  test("requires the exact nonempty theorem inventory and audited axioms", () => {
    expect(admitLean(result(valid), ["Example.first", "Example.second"], ["propext", "Quot.sound"]).ok).toBe(true);
    for (const output of ["", valid.replace("Example.second", "Example.first"), valid.replace("Quot.sound", "Unreviewed.trustMe"),
      valid.replace("Quot.sound", "sorryAx"), `${valid}warning: declaration uses 'sorry'\n`, `${valid}error: unsolved goals\n`]) {
      expect(admitLean(result(output), ["Example.first", "Example.second"], ["propext", "Quot.sound"]).ok).toBe(false);
    }
    expect(admitLean(result(""), [], []).ok).toBe(false);
  });
  test("a completed-looking output cannot conceal a timeout, signal or failure", () => {
    for (const fault of [{ exitCode: 1 }, { timedOut: true }, { signal: "SIGKILL" }, { outputExceeded: true }]) {
      expect(admitLean({ ...result(valid), ...fault }, ["Example.first", "Example.second"], ["propext", "Quot.sound"]).ok).toBe(false);
    }
  });
  test("production mutations must occur exactly once in isolated source bytes", () => {
    const mutation = { id: "wrapping-addition", source: "crates/aicharts-metrics/src/arithmetic.rs",
      exactBefore: "checked_add", exactAfter: "wrapping_add", harness: "proofs::addition",
      expectedFailedAssertion: "wrong sum", requireSingleSourceMatch: true as const };
    expect(applyExactMutation("fn checked_add() {}", mutation)).toBe("fn wrapping_add() {}");
    expect(() => applyExactMutation("fn changed_add() {}", mutation)).toThrow("mutation_source_drift");
    expect(() => applyExactMutation("checked_add checked_add", mutation)).toThrow("mutation_source_drift");
  });
  test("negative controls require a semantic failure inside the named theorem's proof and its recorded sorryAx", () => {
    const source = "import Std\nnamespace Example\ntheorem addition (x : Nat) : x = x + 1 := by\n  omega\n#print axioms addition\nend Example\n";
    const recorded = "'Example.addition' depends on axioms: [sorryAx]\n";
    const output = "/tmp/ProductionProofs.lean:4:2: error: omega could not prove the goal\n" + recorded;
    const semantic = "/tmp/ProductionProofs.lean:4:2: error: unsolved goals\n" + recorded;
    expect(admitLeanMutation(result(semantic, 1), source, "addition", "/tmp/ProductionProofs.lean")).toBe(true);
    const stepFailure = semantic.replace("unsolved goals", "Step failed: could not find a local assumption or a theorem to apply");
    expect(admitLeanMutation(result(stepFailure, 1), source, "addition", "/tmp/ProductionProofs.lean")).toBe(true);
    expect(admitLeanMutation(result(output.replace("goal", "goal:"), 1), source, "addition", "/tmp/ProductionProofs.lean")).toBe(true);
    const multiline = "import Std\ntheorem pricing_terminal_body_exact\n    (x : Nat) : x = x + 1 := by\n  omega\n#print axioms pricing_terminal_body_exact\n";
    const multilineRecorded = semantic.replace("Example.addition", "pricing_terminal_body_exact");
    expect(admitLeanMutation(result(multilineRecorded, 1), multiline, "pricing_terminal_body_exact", "/tmp/ProductionProofs.lean")).toBe(true);
    expect(admitLeanMutation(result(multilineRecorded.replace(":4:2:", ":3:2:"), 1), multiline, "pricing_terminal_body_exact", "/tmp/ProductionProofs.lean")).toBe(true);
    // A failure on the statement line, before the proof body begins, is not a proof failure of the named theorem.
    expect(admitLeanMutation(result(multilineRecorded.replace(":4:2:", ":2:2:"), 1), multiline, "pricing_terminal_body_exact", "/tmp/ProductionProofs.lean")).toBe(false);
    expect(admitLeanMutation(result(multilineRecorded, 1), multiline, "pricing_terminal", "/tmp/ProductionProofs.lean")).toBe(false);
    for (const invalid of [result(semantic), result(semantic.replace(":4:2:", ":1:2:"), 1),
      result(semantic.replace("unsolved goals", "Unknown constant `missing`"), 1),
      { ...result(semantic, 1), timedOut: true }, result(output, 0), result("compiler crashed", 1),
      result(semantic.replace("ProductionProofs.lean", "Other.lean"), 1),
      result(semantic + "/tmp/ProductionProofs.lean:99:1: error: unexpected token\n", 1),
      result(semantic + "/tmp/Other.lean:4:1: error: unsolved goals\n", 1),
      result(stepFailure.replace(":4:2:", ":1:2:"), 1),
      result(semantic + "error: failed to load shared library\n", 1),
      // The named theorem itself must be recorded as depending on sorryAx; a downstream or foreign report is not that.
      result(semantic.replace(recorded, ""), 1),
      result(semantic.replace("Example.addition", "Example.other"), 1),
      result(semantic.replace("[sorryAx]", "[propext]"), 1),
      result(recorded, 1)]) {
      expect(admitLeanMutation(invalid, source, "addition", "/tmp/ProductionProofs.lean")).toBe(false);
    }
  });
  test("the mutation manifest names existing theorems and unique single-match sources", () => {
    const read = (path: string) => readFileSync(resolve(proofRoot, path), "utf8");
    const manifest = leanMutationsSchema.parse(JSON.parse(read("verify/lean/mutations.json")));
    const ids = [...manifest.production, ...manifest.mathematical].map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const proofs = read("verify/lean/ProductionKernels.proofs.lean") + read("verify/lean/Pricing.proofs.lean"), laws = read("verify/lean/UsageLaws.lean");
    const pin = JSON.parse(read("verify/lean/toolchain.json")) as { productionTheorems: string[]; mathematicalTheorems: string[] };
    for (const item of manifest.production) {
      expect(proofs).toMatch(new RegExp(`^theorem ${item.expectedTheorem}(?:\\s|$)`, "mu"));
      expect(pin.productionTheorems).toContain(`aicharts_metrics.${item.expectedTheorem}`);
      expect(read(item.source).split(item.exactBefore).length).toBe(2);
    }
    for (const item of manifest.mathematical) {
      expect(laws).toMatch(new RegExp(`^theorem ${item.expectedTheorem}(?:\\s|$)`, "mu"));
      expect(pin.mathematicalTheorems).toContain(`UsageLaws.${item.expectedTheorem}`);
      expect(read(item.source).split(item.exactBefore).length).toBe(2);
    }
    const kani = JSON.parse(read("verify/kani/harnesses.json")) as { theoremReplacements: { requiredMutation: string }[] };
    for (const replacement of kani.theoremReplacements) expect(manifest.production.map(item => item.id)).toContain(replacement.requiredMutation);
    expect(() => leanMutationsSchema.parse({ ...manifest, mathematical: [] })).toThrow();
    expect(() => leanMutationsSchema.parse({ ...manifest, production: [{ ...manifest.production[0], source: "verify/lean/UsageLaws.lean" }] })).toThrow();
  });
  test("maintained proof inputs reject admissions and unreviewed escape mechanisms", () => {
    expect(() => rejectAdmissions("theorem identity (x : Nat) : x = x := by rfl")).not.toThrow();
    for (const source of ["by sorry", "axiom magic : False", "by native_decide", "unsafe def escape := 0", "@[implemented_by fake]"]) {
      expect(() => rejectAdmissions(source)).toThrow("unreviewed_proof_escape");
    }
  });
  test("fresh translation metadata must identify every actual local nonopaque production body", () => {
    const names = ["arithmetic.admit_decimal", "arithmetic.checked_add", "arithmetic.checked_add_bounded", "arithmetic.checked_replace",
      "arithmetic.price_microusd", "arithmetic.price_microusd_loop", "arithmetic.price_microusd_loop.body", "revision.merge_owner"];
    const generated = names.map(name => `def ${name}\n  := body`).join("\n");
    const raw = { aeneas_version: "pinned-aeneas", charon_version: "pinned-charon", crate: "aicharts_metrics",
      functions: names.map(name => ({ lean_name: `aicharts_metrics.${name}`, lean_file: "ProductionKernels.lean",
        rust_name: `aicharts_metrics::${(name.startsWith("arithmetic.price_microusd") ? "arithmetic.price_microusd" : name).replaceAll(".", "::")}`,
        is_local: true, is_opaque: false, source: { file: `crates/aicharts-metrics/src/${name.split(".")[0]}.rs`, begin_line: 1, end_line: 4 } })) };
    expect(admitTranslation(raw, generated, "pinned-aeneas", "pinned-charon")).toEqual(names);
    for (const change of [
      (copy: typeof raw) => { copy.functions.pop(); },
      (copy: typeof raw) => { copy.functions[0].is_opaque = true; },
      (copy: typeof raw) => { copy.functions[0].is_local = false; },
      (copy: typeof raw) => { copy.functions[0].rust_name = "aicharts_metrics::fake"; },
      (copy: typeof raw) => { copy.functions[0].source.file = "somewhere/else.rs"; },
      (copy: typeof raw) => { copy.functions[0].source.begin_line = 5; },
      (copy: typeof raw) => { copy.aeneas_version = "other"; },
      (copy: typeof raw) => { copy.functions[0] = copy.functions[1]; },
    ]) { const copy = structuredClone(raw); change(copy); expect(() => admitTranslation(copy, generated, "pinned-aeneas", "pinned-charon")).toThrow(); }
  });
});
