import { readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { z } from "zod";
import { completed, gitIdentity, mutationsSchema, proofRoot, proofRunDirectory, readProofFile, runProofProcess,
  sha256, snapshotUnchanged, sourceSnapshot, stageKernel, kernelStageUnchanged, proofEnvironment,
  type KernelMutation, type ProofProcess } from "./assurance-proof-common";

const text = z.string().min(1);
const count = z.number().int().nonnegative();
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const unreachableAssertionSchema = z.object({ harness: text, function: text, category: z.literal("assertion"), description: text,
  location: z.object({ file: text, line: z.string().regex(/^\d+$/u), column: z.string().regex(/^\d+$/u) }).strict(),
  binding: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("workspace"), path: z.string().regex(/^crates\/aicharts-metrics\/src\/[a-z]+\.rs$/u), sha256: digest }).strict(),
    z.object({ kind: z.literal("installed"), path: z.string().regex(/^target\/assurance-tools\/kani-(?:macos|linux)\/kani-0\.68\.0\/lib\/[a-zA-Z0-9_./-]+\.rlib$/u)
      .refine(path => !path.split("/").includes("..")), sha256: digest }).strict(),
  ]), rationale: text, reviewedSource: z.object({ url: z.string().url(), sha256: digest }).strict().optional(),
}).strict();
type UnreachableAssertion = z.infer<typeof unreachableAssertionSchema>;
export const unreachableBindingKey = (entry: UnreachableAssertion) => entry.binding.kind === "workspace"
  ? `workspace:${entry.binding.path}` : `installed:${entry.binding.path}`;
export const kernelFunction = z.string().regex(/^(?:arithmetic|evidence|revision|tokens)::(?:[A-Z][A-Za-z]*::)?[a-z_]+$/u);
const kaniHarnessSchema = z.object({ name: text, functions: z.array(kernelFunction).min(1), scalarDomain: text, containerDomain: text,
  requiredCoverCount: count.positive(), requiredCoverDescriptions: z.array(text).min(1) }).strict();
export const kaniHarnessesSchema = z.object({ schemaVersion: z.literal(1), source: z.literal("crates/aicharts-metrics/src/proofs.rs"),
  expectedHarnessCount: z.literal(20), scope: text, functionCoverage: text, harnesses: z.array(kaniHarnessSchema).length(20),
  theoremReplacements: z.array(z.object({ retiredHarness: text, reason: text, scalarDomain: text,
    productionFunction: z.string().regex(/^aicharts_metrics::(?:arithmetic|evidence|revision|tokens)::[a-z_]+$/u),
    theoremFile: z.literal("verify/lean/Pricing.proofs.lean"), theorem: z.literal("aicharts_metrics.pricing_unit_rate_exact"),
    witnesses: z.array(text).length(3), requiredMutation: z.literal("wrong-half-up-offset"),
    requiredMutationManifest: z.literal("verify/lean/mutations.json") }).strict()).length(1) }).strict();
export type TheoremReplacement = z.infer<typeof kaniHarnessesSchema>["theoremReplacements"][number];
const pinSchema = z.object({ schemaVersion: z.literal(1), kani: z.literal("0.68.0"), cbmc: z.literal("6.11.0"),
  rustc: text, toolchain: text,
  // The production stage carries the bounded rounded-ratio harness (about 100 CPU seconds on the pinned macOS
  // toolchain); every mutant must still be killed inside the 90-second harness budget and its 180-second process cap.
  harnessTimeoutSeconds: z.object({ production: z.literal(300), mutation: z.literal(90) }).strict(), qualification: text,
  rustupHome: z.literal("target/assurance-tools/rustup"),
  artifacts: z.object({ "darwin-arm64": z.object({ url: z.string().url(), sha256: digest }).strict(),
    "linux-x64": z.object({ url: z.string().url(), sha256: digest }).strict() }).strict(),
  platforms: z.record(text, z.object({ target: text, binaries: z.record(text,
    z.object({ path: z.string().startsWith("target/assurance-tools/").refine(path => !path.split("/").includes("..")), sha256: digest }).strict()),
    unreachableAssertions: z.array(unreachableAssertionSchema).max(64) }).strict()),
  unreachableAssertions: z.array(unreachableAssertionSchema).max(64) }).strict();

const checkSchema = z.object({ id: count, function: z.string(), status: text, description: z.string(),
  location: z.object({ file: z.string().optional(), line: z.string().optional(), column: z.string().optional() }).passthrough(),
  category: z.enum(["assertion", "cover", "precondition", "unreachable", "pointer_dereference", "arithmetic_overflow", "array_bounds",
    "safety_check", "unsupported_construct", "assume", "division-by-zero", "pointer"]) }).passthrough();
const reportSchema = z.object({
  metadata: z.object({ version: z.literal("1.0"), kani_version: z.literal("0.68.0"), target: text }).passthrough(),
  tools: z.object({ kani: z.literal("0.68.0"), rustc: text, cbmc: text, goto_instrument: text,
    solvers: z.array(z.object({ name: text }).passthrough()).min(1) }).passthrough(),
  harness_metadata: z.array(z.object({ pretty_name: text, mangled_name: text, crate_name: z.literal("aicharts_metrics"),
    source: z.object({ file: z.literal("crates/aicharts-metrics/src/proofs.rs"), start_line: count.positive(), end_line: count.positive() }).strict(),
    goto_file: text.optional(),
    attributes: z.object({ kind: z.literal("Proof"), should_panic: z.literal(false) }).strict(),
    contract: z.object({ contracted_function_name: z.null(), recursion_tracker: z.null() }).strict(),
    has_loop_contracts: z.literal(false), is_automatically_generated: z.literal(false), is_bounded: z.literal(false), is_ctor_based: z.literal(false) }).strict()).min(1),
  error_details: z.array(z.object({ harness_id: text, has_errors: z.boolean(), error_type: z.string().optional(), exit_status: z.string().optional() }).passthrough()).min(1),
  property_details: z.array(z.object({ harness_id: text, property_details: z.object({ total_properties: count.positive(),
    passed: count, failed: count, unreachable: count, undetermined: count, solver_error: count,
    satisfied: count, unsatisfiable: count, covered: count, uncovered: count }).passthrough() }).passthrough()).min(1),
  verification_results: z.object({ summary: z.object({ total_harnesses: count.positive(), executed: count.positive(),
    status: text, successful: count, failed: count }).passthrough(),
    results: z.array(z.object({ harness_id: text, status: text, checks: z.array(checkSchema).min(1) }).passthrough()).min(1) }).passthrough(),
}).passthrough();

const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
const sameInventory = (actual: string[], expected: string[]) => actual.length === expected.length
  && new Set(actual).size === actual.length && actual.every(value => expected.includes(value));

export function admitKani(raw: unknown, process: ProofProcess, harnesses: z.infer<typeof kaniHarnessSchema>[],
  expectedTarget: string, expectedRustc: string, unreachableAssertions: UnreachableAssertion[], mutation?: KernelMutation,
  verifiedBindings: Record<string, string> = {}) {
  const errors: string[] = [];
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: ["missing_or_malformed_structured_kani_evidence"], harnesses: [] };
  const report = parsed.data, results = report.verification_results.results, summary = report.verification_results.summary;
  const names = harnesses.map(harness => harness.name);
  if (!names.length || new Set(names).size !== names.length || !sameInventory(results.map(item => item.harness_id), names)
    || !sameInventory(report.harness_metadata.map(item => item.pretty_name), names)
    || !sameInventory(report.error_details.map(item => item.harness_id), names)
    || !sameInventory(report.property_details.map(item => item.harness_id), names)) errors.push("wrong_harness_inventory");
  if (!completed(process) || (mutation ? process.exitCode !== 1 : process.exitCode !== 0)) errors.push("incomplete_kani_execution");
  if (report.metadata.target !== expectedTarget || report.tools.rustc !== expectedRustc
    || report.tools.cbmc !== "6.11.0 (cbmc-6.11.0)" || report.tools.goto_instrument !== "6.11.0 (cbmc-6.11.0)"
    || report.tools.solvers.some(solver => solver.name !== "cadical")) errors.push("kani_toolchain_drift");
  if (summary.status !== "completed" || summary.total_harnesses !== names.length || summary.executed !== names.length
    || summary.successful !== (mutation ? 0 : names.length) || summary.failed !== (mutation ? 1 : 0)) errors.push("incomplete_kani_summary");
  const evidence = [];
  for (const harness of harnesses) {
    const actual = results.find(item => item.harness_id === harness.name);
    if (!actual) continue;
    const checks = actual.checks;
    if (new Set(checks.map(check => check.id)).size !== checks.length) errors.push(`${harness.name}:duplicate_property_id`);
    const counts = report.property_details.find(item => item.harness_id === harness.name)?.property_details;
    const detail = report.error_details.find(item => item.harness_id === harness.name);
    if (actual.status !== (mutation ? "Failure" : "Success") || !detail || (mutation
      ? !detail.has_errors || detail.error_type !== "assertion_failure" || detail.exit_status !== "properties_failed"
      : detail.has_errors)) errors.push(`${harness.name}:wrong_terminal_status`);
    const covers = checks.filter(check => check.category === "cover");
    if (harness.requiredCoverDescriptions.length !== harness.requiredCoverCount
      || !sameInventory(covers.map(check => normalize(check.description)), harness.requiredCoverDescriptions.map(normalize))) errors.push(`${harness.name}:missing_cover_inventory`);
    if (!mutation && covers.some(check => check.status !== "Satisfied")) errors.push(`${harness.name}:unsatisfied_cover`);
    const assertions = checks.filter(check => check.category === "assertion");
    if (!assertions.some(check => check.status === "Success" && check.function === harness.name
      && check.location.file === "crates/aicharts-metrics/src/proofs.rs" && check.description.startsWith("assertion failed:")) && !mutation) errors.push(`${harness.name}:vacuous_assertions`);
    for (const check of checks) {
      if (check.category === "cover") {
        if (!mutation && check.status !== "Satisfied") errors.push(`${harness.name}:cover_failure`);
        if (mutation && !["Satisfied", "Unsatisfiable"].includes(check.status)) errors.push(`${harness.name}:unknown_mutant_cover`);
        continue;
      }
      const expectedFailure = mutation && check.category === "assertion"
        && check.function === harness.name && check.location.file === "crates/aicharts-metrics/src/proofs.rs"
        && normalize(check.description) === normalize(mutation.expectedFailedAssertion) && check.status === "Failure";
      if (!expectedFailure && !["Success", "Unreachable"].includes(check.status)) errors.push(`${harness.name}:failed_default_check:${check.category}`);
      if (check.status === "Unreachable" && check.category === "assertion" && !unreachableAssertions.some(item =>
        item.harness === harness.name && item.function === check.function && item.category === check.category
        && item.description === check.description && item.location.file === check.location.file
        && item.location.line === check.location.line && item.location.column === check.location.column
        && verifiedBindings[unreachableBindingKey(item)] === item.binding.sha256)) errors.push(`${harness.name}:unreviewed_unreachable_assertion`);
    }
    if (mutation && assertions.filter(check => check.status === "Failure" && check.function === harness.name
      && check.location.file === "crates/aicharts-metrics/src/proofs.rs"
      && normalize(check.description) === normalize(mutation.expectedFailedAssertion)).length !== 1) errors.push(`${harness.name}:missing_named_mutation_failure`);
    if (!counts || counts.total_properties !== checks.length || counts.undetermined || counts.solver_error || counts.uncovered || counts.covered
      || counts.passed !== checks.filter(check => check.status === "Success").length
      || counts.unreachable !== checks.filter(check => check.status === "Unreachable").length
      || counts.satisfied !== covers.filter(check => check.status === "Satisfied").length
      || counts.unsatisfiable !== covers.filter(check => check.status === "Unsatisfiable").length
      || counts.failed !== checks.filter(check => check.status === "Failure").length) errors.push(`${harness.name}:inconsistent_property_counts`);
    evidence.push({ name: harness.name, assertions: assertions.length, covers: covers.length, counts });
  }
  return { ok: errors.length === 0, errors, harnesses: evidence };
}

/** A theorem receipt shape sufficient to bind a retired harness to its replacement proof. */
const theoremReceiptSchema = z.object({ schemaVersion: z.literal(1), ok: z.boolean(), sourceSha256: z.record(z.string(), z.string()),
  pin: z.object({ productionTheorems: z.array(text) }).passthrough(),
  results: z.array(z.object({ mutation: z.string().nullable(),
    evaluation: z.object({ ok: z.boolean(), expectedFailedTheorem: text.optional(),
      axioms: z.array(z.object({ theorem: text }).passthrough()).optional() }).passthrough() }).passthrough()).min(1) }).passthrough();

export function replacementKernelFile(replacement: Pick<TheoremReplacement, "productionFunction">) {
  return `crates/aicharts-metrics/src/${replacement.productionFunction.split("::")[1]}.rs`;
}

/** The Kani gate refuses a theorem replacement unless a theorems receipt proves the named theorem
 * and witnesses for the exact bytes of the replaced kernel file and theorem file now under test,
 * and its required negative control was killed in that same run. A missing, stale, failed or
 * differently named receipt is not evidence. */
export function admitTheoremReplacement(raw: unknown, snapshotHashes: Record<string, string>, replacement: TheoremReplacement) {
  const errors: string[] = [];
  const parsed = theoremReceiptSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: ["missing_or_malformed_theorem_receipt"] };
  const receipt = parsed.data, kernel = replacementKernelFile(replacement);
  if (!receipt.ok) errors.push("theorem_receipt_not_ok");
  for (const path of [kernel, replacement.theoremFile]) {
    if (!snapshotHashes[path] || receipt.sourceSha256[path] !== snapshotHashes[path]) errors.push(`theorem_receipt_source_drift:${path}`);
  }
  const required = [replacement.theorem, ...replacement.witnesses];
  if (required.some(name => !receipt.pin.productionTheorems.includes(name))) errors.push("theorem_receipt_missing_theorem_pin");
  const production = receipt.results.find(result => result.mutation === null);
  const proved = production?.evaluation.axioms?.map(item => item.theorem) ?? [];
  if (!production?.evaluation.ok || required.some(name => !proved.includes(name))) errors.push("theorem_receipt_missing_proof");
  const control = receipt.results.find(result => result.mutation === replacement.requiredMutation);
  if (!control?.evaluation.ok || !control.evaluation.expectedFailedTheorem) errors.push("theorem_receipt_missing_required_mutation");
  return { ok: errors.length === 0, errors };
}

export function rejectKaniAssumptions(source: string) {
  if (/\bkani\s*::\s*assume\b/u.test(source)
    || [...source.matchAll(/#\[\s*kani\s*::\s*([a-z_]+)/gu)].some(match => !["proof", "unwind"].includes(match[1]))) throw new Error("unreviewed_kani_assumption_or_stub");
}

/** Every theorems receipt under `target/assurance/theorems`, newest first by modification time.
 * A run directory without a receipt is not evidence; an absent directory yields no candidates. */
export async function theoremReceiptCandidates(parent = resolve(proofRoot, "target/assurance/theorems")) {
  let runs: string[] = [];
  try { runs = (await readdir(parent)).filter(name => name.startsWith("run-")); } catch { return []; }
  const candidates: { path: string; modifiedMs: number }[] = [];
  for (const name of runs) {
    const path = resolve(parent, name, "receipt.json");
    try { candidates.push({ path, modifiedMs: (await stat(path)).mtimeMs }); } catch { /* no receipt was written for this run */ }
  }
  return candidates.sort((left, right) => right.modifiedMs - left.modifiedMs).map(item => item.path);
}

/** Binds one theorem replacement to the newest receipt that proves it for the exact kernel and
 * theorem bytes now under test. Receipts for other bytes, failed runs and malformed files are
 * skipped with their reasons recorded; when none binds, the gate refuses. Absence is never a pass. */
export async function bindTheoremReplacement(replacement: TheoremReplacement, snapshotHashes: Record<string, string>, parent?: string) {
  const refusals: string[] = [];
  for (const path of await theoremReceiptCandidates(parent)) {
    let receipt: unknown = null;
    try { receipt = JSON.parse((await readProofFile(path, 67_108_864)).toString("utf8")); } catch { /* admitted below as malformed */ }
    const evaluation = admitTheoremReplacement(receipt, snapshotHashes, replacement);
    if (evaluation.ok) return { receipt: relative(proofRoot, path), ...evaluation };
    refusals.push(`${relative(proofRoot, path)}:${evaluation.errors.join(",")}`);
  }
  throw new Error(`unbound_theorem_replacement:${replacement.retiredHarness}:${refusals.length ? refusals.join(";") : "missing_theorem_receipt"}`);
}

export async function runKani() {
  const snapshot = await sourceSnapshot(["scripts/assurance-kani.ts", "scripts/assurance-kani.test.ts", "scripts/assurance-proof-common.ts", "scripts/assurance-proof-common.test.ts",
    "verify/kani/harnesses.json", "verify/kani/mutations.json", "verify/kani/toolchain.json",
    "verify/lean/Pricing.proofs.lean", "verify/lean/toolchain.json", "verify/lean/mutations.json"]);
  const pin = pinSchema.parse(JSON.parse(snapshot.bytes.get("verify/kani/toolchain.json")!.toString("utf8")));
  const inventory = kaniHarnessesSchema.parse(JSON.parse(snapshot.bytes.get("verify/kani/harnesses.json")!.toString("utf8")));
  const mutations = mutationsSchema.parse(JSON.parse(snapshot.bytes.get("verify/kani/mutations.json")!.toString("utf8"))).mutations;
  for (const [path, bytes] of snapshot.bytes) if (path.endsWith(".rs")) rejectKaniAssumptions(bytes.toString("utf8"));
  const declared = [...snapshot.bytes.get(inventory.source)!.toString("utf8").matchAll(/#\[kani::proof\](?:\s*#\[[^\]]*\])*\s*fn ([a-z_0-9]+)/gu)]
    .map(match => `proofs::${match[1]}`);
  if (!sameInventory(declared, inventory.harnesses.map(item => item.name))) throw new Error("production_harness_inventory_drift");
  const theoremNames = z.object({ productionTheorems: z.array(text) }).passthrough().parse(JSON.parse(
    snapshot.bytes.get("verify/lean/toolchain.json")!.toString("utf8")) as unknown).productionTheorems;
  const leanMutationIds = z.object({ production: z.array(z.object({ id: text }).passthrough()) }).passthrough()
    .parse(JSON.parse(snapshot.bytes.get("verify/lean/mutations.json")!.toString("utf8")) as unknown).production.map(item => item.id);
  const replacementEvidence: Record<string, { receipt: string; ok: boolean; errors: string[] }> = {};
  for (const replacement of inventory.theoremReplacements) {
    if (declared.includes(replacement.retiredHarness) || [replacement.theorem, ...replacement.witnesses].some(name => !theoremNames.includes(name))
      || !leanMutationIds.includes(replacement.requiredMutation)) {
      throw new Error("kani_theorem_replacement_inventory_drift");
    }
    replacementEvidence[replacement.retiredHarness] = await bindTheoremReplacement(replacement, snapshot.hashes);
  }
  const platform = `${process.platform}-${process.arch}`, selected = pin.platforms[platform];
  if (!selected) throw new Error(`unqualified_kani_platform:${platform}`);
  const binaries: Record<string, string> = {}, toolHashes: Record<string, string> = {};
  for (const [name, binary] of Object.entries(selected.binaries)) {
    const path = resolve(proofRoot, binary.path);
    const hash = sha256(await readProofFile(path, 536_870_912));
    if (hash !== binary.sha256) throw new Error(`kani_binary_drift:${name}`);
    binaries[name] = path; toolHashes[path] = hash;
  }
  if (!binaries.cbmc || !binaries.compiler || !binaries.driver || !binaries.instrumenter || !binaries.rustc) throw new Error("incomplete_kani_tool_pins");
  const verifiedBindings: Record<string, string> = {};
  const unreachableAssertions = [...pin.unreachableAssertions, ...selected.unreachableAssertions];
  for (const entry of unreachableAssertions) {
    const binding = entry.binding;
    const hash = verifiedBindings[unreachableBindingKey(entry)] ?? (binding.kind === "workspace" ? snapshot.hashes[binding.path]
      : sha256(await readProofFile(resolve(proofRoot, binding.path), 536_870_912)));
    if (hash !== binding.sha256 || (binding.kind === "workspace" && binding.path !== entry.location.file)) throw new Error("unreachable_assertion_binding_drift");
    verifiedBindings[unreachableBindingKey(entry)] = hash;
    if (binding.kind === "installed") toolHashes[resolve(proofRoot, binding.path)] = hash;
  }
  const env = { ...proofEnvironment(process.env),
    RUSTUP_HOME: resolve(proofRoot, pin.rustupHome),
    PATH: `${dirname(binaries.rustc)}:${dirname(binaries.driver)}:${process.env.PATH ?? ""}` };
  const run = await proofRunDirectory("kani"), results = [];
  const cases: { name: string; mutation?: KernelMutation }[] = [{ name: "production" }, ...mutations.map(mutation => ({ name: mutation.id, mutation }))];
  for (const item of cases) {
    if (item.mutation && !results[0]?.evaluation.ok) break;
    const stage = await stageKernel(run, item.name, snapshot, item.mutation);
    const reportPath = resolve(stage.path, "results.json");
    const harnesses = item.mutation ? inventory.harnesses.filter(harness => harness.name === item.mutation!.harness) : inventory.harnesses;
    if (item.mutation && harnesses.length !== 1) throw new Error("unknown_mutation_harness");
    const args = ["kani", "-p", "aicharts-metrics", "--target-dir", resolve(stage.path, "target"), "-Z", "unstable-options",
      "--harness-timeout", `${item.mutation ? pin.harnessTimeoutSeconds.mutation : pin.harnessTimeoutSeconds.production}s`, "--export-json", reportPath, "--output-format", "terse", "--run-sanity-checks",
      ...(item.mutation ? ["--exact", "--harness", item.mutation.harness] : [])];
    const process = await runProofProcess(binaries.driver, args, stage.path, env, item.mutation ? 180_000 : 1_800_000);
    await writeFile(resolve(stage.path, "kani.log"), process.output);
    let report: unknown = null, reportHash: string | null = null;
    try { const bytes = await readProofFile(reportPath, 67_108_864); reportHash = sha256(bytes); report = JSON.parse(bytes.toString("utf8")); }
    catch { /* A missing/truncated report fails admission, even if the launcher returned zero. */ }
    const evaluation = admitKani(report, process, harnesses, selected.target, pin.rustc, unreachableAssertions, item.mutation, verifiedBindings);
    const stageUnchanged = await kernelStageUnchanged(stage);
    if (!stageUnchanged) { evaluation.ok = false; evaluation.errors.push("kernel_stage_changed"); }
    results.push({ ...stage, process, evaluation, reportPath, reportSha256: reportHash, stageUnchanged });
  }
  const inputsUnchanged = await snapshotUnchanged(snapshot);
  const stagesUnchanged = (await Promise.all(results.map(result => kernelStageUnchanged(result)))).every(Boolean);
  let reportsUnchanged = true;
  for (const result of results) {
    try { if (result.reportSha256 !== sha256(await readProofFile(result.reportPath, 67_108_864))) reportsUnchanged = false; }
    catch { reportsUnchanged = false; }
  }
  let toolsUnchanged = true;
  for (const [path, hash] of Object.entries(toolHashes)) if (sha256(await readProofFile(path, 536_870_912)) !== hash) toolsUnchanged = false;
  const receipt = { schemaVersion: 1, ...await gitIdentity(), createdAt: new Date().toISOString(), platform,
    claim: "production Rust kernels in the exact declared finite scalar/container domains; no provider/storage or arbitrary-history proof",
    trustedBoundary: "Rust/Kani/CBMC compilation, scalar operator semantics, solver and installed runtime libraries; binaries measured, not a complete installed-image attestation",
    replacementEvidence: "The mapped pricing theorem is not executed by this Kani command; usage:formal:theorems is a separate mandatory gate whose receipt for the exact replaced kernel bytes was required above.",
    theoremReplacements: replacementEvidence,
    sourceSha256: snapshot.hashes, toolHashes, verifiedBindings, environment: env, pin, inventory, results, inputsUnchanged, toolsUnchanged, stagesUnchanged, reportsUnchanged,
    ok: inputsUnchanged && toolsUnchanged && stagesUnchanged && reportsUnchanged && results.length === cases.length && results.every(result => result.evaluation.ok) };
  const path = resolve(run, "receipt.json");
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ ok: receipt.ok, receipt: relative(proofRoot, path), expectedHarnesses: inventory.expectedHarnessCount,
    cases: results.map(item => ({ name: item.mutation ?? "production", ok: item.evaluation.ok, errors: item.evaluation.errors })) }));
  return receipt;
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 2) throw new Error("kani_runner_accepts_no_unreviewed_flags");
    if (!(await runKani()).ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "kani_runner_failed" }));
    process.exitCode = 1;
  }
}
