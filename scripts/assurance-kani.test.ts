import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { admitKani, admitTheoremReplacement, bindTheoremReplacement, kaniHarnessesSchema, rejectKaniAssumptions, replacementKernelFile,
  theoremReceiptCandidates, unreachableAssertionSchema, unreachableBindingKey } from "./assurance-kani";
import { mutationsSchema, type ProofProcess } from "./assurance-proof-common";
import { z } from "zod";

const read = (path: string) => JSON.parse(readFileSync(resolve(import.meta.dir, "..", path), "utf8"));
const fixture = () => read("verify/kani/fixtures/checked-add.json");
const inventory = kaniHarnessesSchema.parse(read("verify/kani/harnesses.json"));
const harness = inventory.harnesses[0];
const mutations = mutationsSchema.parse(read("verify/kani/mutations.json")).mutations;
const mutation = mutations[0];
const text = (path: string) => readFileSync(resolve(import.meta.dir, "..", path), "utf8");
const pin = read("verify/kani/toolchain.json");
const exceptions = [...pin.unreachableAssertions, ...pin.platforms["darwin-arm64"].unreachableAssertions];
const process: ProofProcess = { command: "cargo-kani", args: [], exitCode: 0, signal: null,
  timedOut: false, outputExceeded: false, output: "", elapsedMs: 1 };
const admit = (raw: unknown, command = process, negative = false) => admitKani(raw, command, [harness],
  "aarch64-apple-darwin", pin.rustc, exceptions, negative ? mutation : undefined);

describe("Linux unreachable-assertion exceptions", () => {
  test("mirror the reviewed macOS exceptions exactly and bind only to the Linux bundle", () => {
    const parse = (items: unknown) => z.array(unreachableAssertionSchema).parse(items);
    const linux = parse(pin.platforms["linux-x64"].unreachableAssertions), darwin = parse(pin.platforms["darwin-arm64"].unreachableAssertions);
    const shape = (entry: z.infer<typeof unreachableAssertionSchema>) => JSON.stringify([entry.harness, entry.function, entry.category, entry.description,
      entry.location.file.replace(/^\/(?:Users|home)\/runner\/\.rustup\/toolchains\/nightly-2026-08-21-(?:aarch64-apple-darwin|x86_64-unknown-linux-gnu)\//u, "<toolchain>/"),
      entry.location.line, entry.location.column, entry.rationale]);
    expect(linux.length).toBe(13);
    expect(linux.map(shape).sort()).toEqual(darwin.map(shape).sort());
    for (const entry of linux) {
      expect(entry.binding.kind === "installed" && entry.binding.path.startsWith("target/assurance-tools/kani-linux/")).toBe(true);
      expect(entry.location.file.includes("apple-darwin") || entry.location.file.startsWith("/Users/")).toBe(false);
    }
    for (const entry of darwin) {
      expect(entry.binding.kind === "installed" && entry.binding.path.startsWith("target/assurance-tools/kani-macos/")).toBe(true);
    }
  });
});

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

describe("production function coverage manifest", () => {
  /** Every `pub fn` of the kernel crate, as `module::[Type::]name`, parsed from the production sources only. */
  const publicFunctions = () => {
    const names = new Set<string>();
    for (const file of ["arithmetic", "evidence", "revision", "tokens", "lib"]) {
      const source = text(`crates/aicharts-metrics/src/${file}.rs`);
      let owner: string | null = null, depth = 0, ownerDepth = -1;
      for (const line of source.split("\n")) {
        const implementation = /^impl(?:<[^>]*>)?\s+([A-Z][A-Za-z0-9]*)/u.exec(line);
        if (implementation && depth === 0) { owner = implementation[1]; ownerDepth = 0; }
        const declaration = /^\s*pub\s+(?:const\s+)?fn\s+([a-z_][a-z0-9_]*)/u.exec(line);
        if (declaration) names.add(`${file}::${owner && depth > ownerDepth ? `${owner}::` : ""}${declaration[1]}`);
        for (const char of line.replace(/"[^"]*"/gu, "")) {
          if (char === "{") depth++;
          if (char === "}") { depth--; if (owner && depth === ownerDepth) owner = null; }
        }
      }
    }
    return [...names].sort();
  };
  test("every kernel pub fn is named by a harness or a theorem replacement", () => {
    const actual = publicFunctions();
    expect(actual.length).toBe(31);
    expect(actual).toContain("arithmetic::ExactRatio::rounded");
    expect(actual).toContain("tokens::InclusiveOutput::from_disjoint");
    const covered = new Set([...inventory.harnesses.flatMap(item => item.functions),
      ...inventory.theoremReplacements.map(item => item.productionFunction.replace(/^aicharts_metrics::/u, ""))]);
    expect(actual.filter(name => !covered.has(name))).toEqual([]);
    // Every named function must exist and be called by the harness body that names it.
    const proofs = text("crates/aicharts-metrics/src/proofs.rs");
    for (const item of inventory.harnesses) {
      const start = proofs.indexOf(`fn ${item.name.slice("proofs::".length)}(`);
      expect(start).toBeGreaterThan(0);
      const next = proofs.indexOf("#[kani::proof]", start), body = proofs.slice(start, next < 0 ? undefined : next);
      for (const name of item.functions) {
        expect(actual).toContain(name);
        expect(body).toContain(name.split("::").at(-1)!);
      }
    }
    expect(inventory.harnesses.reduce((sum, item) => sum + item.requiredCoverCount, 0)).toBe(53);
  });
  test("the schema refuses a harness without named functions or an unknown module path", () => {
    expect(() => kaniHarnessesSchema.parse({ ...inventory, harnesses: inventory.harnesses.map((item, index) => index ? item : { ...item, functions: [] }) })).toThrow();
    expect(() => kaniHarnessesSchema.parse({ ...inventory, harnesses: inventory.harnesses.map((item, index) => index ? item : { ...item, functions: ["proofs::any_basis"] }) })).toThrow();
  });
  test("every mutation targets one exact production match and a declared harness", () => {
    expect(mutations.length).toBe(13);
    expect(new Set(mutations.map(item => item.id)).size).toBe(mutations.length);
    for (const item of mutations) {
      expect(text(item.source).split(item.exactBefore).length).toBe(2);
      expect(inventory.harnesses.map(harness => harness.name)).toContain(item.harness);
    }
  });
});

describe("theorem replacement receipt binding", () => {
  const replacement = inventory.theoremReplacements[0];
  const kernel = replacementKernelFile(replacement);
  const hashes = { [kernel]: "a".repeat(64), [replacement.theoremFile]: "b".repeat(64), "crates/aicharts-metrics/src/proofs.rs": "c".repeat(64) };
  const receipt = () => ({ schemaVersion: 1, ok: true, sourceSha256: { ...hashes },
    pin: { productionTheorems: [replacement.theorem, ...replacement.witnesses, "aicharts_metrics.other"] },
    results: [
      { mutation: null, evaluation: { ok: true, axioms: [replacement.theorem, ...replacement.witnesses, "aicharts_metrics.other"].map(theorem => ({ theorem, axioms: ["propext"] })) } },
      { mutation: replacement.requiredMutation, evaluation: { ok: true, expectedFailedTheorem: "pricing_terminal_body_exact" } },
      { mutation: "other-mutation", evaluation: { ok: true, expectedFailedTheorem: "pricing_body_exact" } }] });
  test("binds the kernel file, the theorem file, the theorem names and the required negative control", () => {
    expect(kernel).toBe("crates/aicharts-metrics/src/arithmetic.rs");
    expect(admitTheoremReplacement(receipt(), hashes, replacement)).toEqual({ ok: true, errors: [] });
    for (const [change, error] of [
      [(copy: ReturnType<typeof receipt>) => { copy.ok = false; }, "theorem_receipt_not_ok"],
      [(copy: ReturnType<typeof receipt>) => { copy.sourceSha256[kernel] = "d".repeat(64); }, `theorem_receipt_source_drift:${kernel}`],
      [(copy: ReturnType<typeof receipt>) => { delete copy.sourceSha256[kernel]; }, `theorem_receipt_source_drift:${kernel}`],
      [(copy: ReturnType<typeof receipt>) => { copy.sourceSha256[replacement.theoremFile] = "d".repeat(64); }, `theorem_receipt_source_drift:${replacement.theoremFile}`],
      [(copy: ReturnType<typeof receipt>) => { copy.pin.productionTheorems = ["aicharts_metrics.other"]; }, "theorem_receipt_missing_theorem_pin"],
      [(copy: ReturnType<typeof receipt>) => { copy.results[0].evaluation.ok = false; }, "theorem_receipt_missing_proof"],
      [(copy: ReturnType<typeof receipt>) => { copy.results[0].evaluation.axioms = copy.results[0].evaluation.axioms!.filter(item => item.theorem !== replacement.witnesses[1]); }, "theorem_receipt_missing_proof"],
      [(copy: ReturnType<typeof receipt>) => { copy.results.splice(0, 1); }, "theorem_receipt_missing_proof"],
      [(copy: ReturnType<typeof receipt>) => { copy.results[1].evaluation.ok = false; }, "theorem_receipt_missing_required_mutation"],
      [(copy: ReturnType<typeof receipt>) => { copy.results[1].mutation = "renamed"; }, "theorem_receipt_missing_required_mutation"],
      [(copy: ReturnType<typeof receipt>) => { delete copy.results[1].evaluation.expectedFailedTheorem; }, "theorem_receipt_missing_required_mutation"],
    ] as const) {
      const copy = receipt(); change(copy);
      const evaluation = admitTheoremReplacement(copy, hashes, replacement);
      expect(evaluation.ok).toBe(false);
      expect(evaluation.errors).toContain(error);
    }
    // A receipt for other kernel bytes than the ones now under test is stale evidence.
    expect(admitTheoremReplacement(receipt(), { ...hashes, [kernel]: "e".repeat(64) }, replacement).ok).toBe(false);
    expect(admitTheoremReplacement(receipt(), {}, replacement).ok).toBe(false);
  });
  test("the gate binds the newest admitted receipt for the exact bytes and refuses when none binds", async () => {
    const parent = mkdtempSync(resolve(tmpdir(), "kani-theorem-receipts-"));
    const write = (name: string, value: unknown, ageSeconds: number) => {
      mkdirSync(resolve(parent, name)); const path = resolve(parent, name, "receipt.json");
      writeFileSync(path, JSON.stringify(value)); const when = new Date(Date.now() - ageSeconds * 1000); utimesSync(path, when, when);
    };
    await expect(bindTheoremReplacement(replacement, hashes, parent)).rejects.toThrow("missing_theorem_receipt");
    mkdirSync(resolve(parent, "run-noreceipt"));
    write("run-zzz-stale", { ...receipt(), sourceSha256: { ...hashes, [kernel]: "9".repeat(64) } }, 30);
    await expect(bindTheoremReplacement(replacement, hashes, parent)).rejects.toThrow(`theorem_receipt_source_drift:${kernel}`);
    write("run-aaa-admitted", receipt(), 20);
    write("run-mmm-failed-newer", { ...receipt(), ok: false }, 10);
    expect(await theoremReceiptCandidates(parent)).toEqual(["run-mmm-failed-newer", "run-aaa-admitted", "run-zzz-stale"].map(name => resolve(parent, name, "receipt.json")));
    expect((await bindTheoremReplacement(replacement, hashes, parent)).receipt.endsWith("run-aaa-admitted/receipt.json")).toBe(true);
    // Different kernel bytes than every receipt: no evidence, so refusal names each candidate's reason.
    await expect(bindTheoremReplacement(replacement, { ...hashes, [kernel]: "f".repeat(64) }, parent)).rejects.toThrow("unbound_theorem_replacement:");
    expect(await theoremReceiptCandidates(resolve(parent, "absent"))).toEqual([]);
  });
  test("a missing or malformed receipt is a refusal", () => {
    for (const raw of [null, undefined, {}, "receipt", { ...receipt(), schemaVersion: 2 }, { ...receipt(), results: [] }]) {
      expect(admitTheoremReplacement(raw, hashes, replacement)).toEqual({ ok: false, errors: ["missing_or_malformed_theorem_receipt"] });
    }
  });
});
