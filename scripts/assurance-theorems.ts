import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { z } from "zod";
import { applyExactMutation, completed, gitIdentity, proofRoot, proofRunDirectory, readProofFile,
  runProofProcess, sha256, snapshotUnchanged, sourceSnapshot, stageKernel, kernelStageUnchanged, proofEnvironment, proofFilesUnchanged,
  type SourceMutation, type ProofProcess } from "./assurance-proof-common";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const commit = z.string().regex(/^[a-f0-9]{40}$/u);
const executable = z.object({ path: z.string().min(1), sha256: digest }).strict();
const pinSchema = z.object({ schemaVersion: z.literal(1), route: z.string(), qualification: z.string(),
  versions: z.object({ aeneas: z.string(), aeneasCommit: commit, charon: z.string(),
    charonCommit: commit, rust: z.string(), lean: z.string(), leanCommit: commit }).strict(),
  artifacts: z.record(z.string(), z.object({ url: z.string().url(), sha256: digest }).strict()),
  platforms: z.record(z.string(), z.object({ aeneas: executable, charon: executable, charonDriver: executable,
    lean: executable, lake: executable, rustc: executable }).strict()),
  backends: z.record(z.string(), z.string()), rustupHome: z.string(), backendManifestSha256: digest,
  allowedAxioms: z.array(z.enum(["propext", "Classical.choice", "Quot.sound"])).length(3), productionTheorems: z.array(z.string()).length(26),
  mathematicalTheorems: z.array(z.string()).length(9) }).strict();

const theoremName = z.string().regex(/^[a-z_]+$/u);
const leanMutation = <Source extends z.ZodType<string>>(source: Source) => z.object({ id: z.string().regex(/^[a-z-]+$/u), source,
  exactBefore: z.string().min(1), exactAfter: z.string().min(1), expectedTheorem: theoremName, requireSingleSourceMatch: z.literal(true) }).strict();
/** Negative controls are derived from this manifest, never hard-coded in the runner. */
export const leanMutationsSchema = z.object({ schemaVersion: z.literal(1), scope: z.string().min(1),
  production: z.array(leanMutation(z.string().regex(/^crates\/aicharts-metrics\/src\/[a-z]+\.rs$/u))).min(1).max(16),
  mathematical: z.array(leanMutation(z.literal("verify/lean/UsageLaws.lean"))).min(1).max(16) }).strict();

export function admitLean(result: ProofProcess, expected: string[], allowedAxioms: string[]) {
  const errors: string[] = [];
  if (!completed(result) || result.exitCode !== 0) errors.push("incomplete_lean_proof");
  if (/\b(?:sorryAx|sorry|admit|error|warning)\b/u.test(result.output)) errors.push("lean_diagnostic_or_admission");
  const axioms = [...result.output.matchAll(/^'([^']+)' depends on axioms: \[([^\]]*)\]$/gmu)]
    .map(match => ({ theorem: match[1], axioms: match[2].split(",").map(value => value.trim()).filter(Boolean) }));
  for (const match of result.output.matchAll(/^'([^']+)' does not depend on any axioms$/gmu)) axioms.push({ theorem: match[1], axioms: [] });
  if (!expected.length || new Set(expected).size !== expected.length || axioms.length !== expected.length
    || axioms.some(item => !expected.includes(item.theorem)) || new Set(axioms.map(item => item.theorem)).size !== expected.length) errors.push("wrong_theorem_inventory");
  if (axioms.some(item => item.axioms.some(axiom => !allowedAxioms.includes(axiom)))) errors.push("unreviewed_axiom");
  return { ok: errors.length === 0, errors, axioms };
}

export function rejectAdmissions(source: string) {
  if (/\b(?:sorry|admit|axiom|unsafe|native_decide|run_tac)\b|implemented_by|extern|set_option\s+(?:debug|Elab\.async)/u.test(source)) throw new Error("unreviewed_proof_escape");
}

/** An expected mutant must reach Lean and fail inside the named unchanged theorem's own proof,
 * and Lean must record that exact theorem as depending on `sorryAx`. Compile/extract/runtime
 * failure, unknown constant, timeout, a different theorem or an error outside the proof body is insufficient. */
export function admitLeanMutation(result: ProofProcess, source: string, theorem: string, proofPath: string) {
  const lines = source.split("\n");
  if (!/^[a-z_]+$/u.test(theorem)) return false;
  const start = lines.findIndex(line => new RegExp(`^theorem ${theorem}(?:\\s|$)`, "u").test(line));
  if (start < 0 || !completed(result) || result.exitCode !== 1) return false;
  let end = lines.findIndex((line, index) => index > start && /^(?:theorem |#print |end |def |structure |inductive |namespace )/u.test(line));
  if (end < 0) end = lines.length;
  // The proof body begins at the `:=` of the named declaration; errors on statement lines are not proof failures.
  const body = lines.findIndex((line, index) => index >= start && index < end && /:=/u.test(line));
  if (body < 0) return false;
  if (/unknownIdentifier|Unknown constant|unknown tactic|failed to synthesize|maximum (?:recursion|heartbeats)|internal error|stack overflow|^\s*(?:error|fatal error|panic):/imu.test(result.output)) return false;
  const errors = [...result.output.matchAll(/^(.+\.lean):(\d+):\d+: error(?:\([^)]*\))?: ([^\n]+)/gmu)];
  // No unrelated parse/import/proof failures may masquerade as the negative
  // control. Lean's downstream sorryAx reports are expected after this error;
  // they are never accepted as a successful theorem proof.
  const inside = errors.length > 0 && errors.every(match => resolve(match[1]) === resolve(proofPath)
    && Number(match[2]) >= body + 1 && Number(match[2]) <= end
    && /unsolved goals|tactic.*failed|no progress|failed to prove|could not prove the goal|^Step failed: could not find a local assumption or a theorem to apply$/iu.test(match[3]));
  const recorded = [...result.output.matchAll(/^'((?:[A-Za-z_][A-Za-z0-9_]*\.)*[a-z_]+)' depends on axioms: \[([^\]]*)\]$/gmu)]
    .some(match => (match[1] === theorem || match[1].endsWith(`.${theorem}`)) && match[2].split(",").map(value => value.trim()).includes("sorryAx"));
  return inside && recorded;
}

const productionDefinitions = ["arithmetic.admit_decimal", "arithmetic.checked_add", "arithmetic.checked_add_bounded",
  "arithmetic.checked_replace", "arithmetic.price_microusd", "arithmetic.price_microusd_loop", "arithmetic.price_microusd_loop.body", "revision.merge_owner"];
export function admitTranslation(raw: unknown, generated: string, aeneas: string, charon: string) {
  const translation = z.object({ aeneas_version: z.literal(aeneas), charon_version: z.literal(charon), crate: z.literal("aicharts_metrics"),
    functions: z.array(z.object({ lean_name: z.string(), lean_file: z.literal("ProductionKernels.lean"), rust_name: z.string(),
      is_local: z.literal(true), is_opaque: z.literal(false), source: z.object({ file: z.string(), begin_line: z.number().int().positive(),
        end_line: z.number().int().positive() }).strict() }).passthrough()).length(8) }).passthrough().parse(raw);
  const definitions = [...generated.matchAll(/^def ([a-z_.]+)\s*$/gmu)].map(match => match[1]).sort();
  if (definitions.join(",") !== productionDefinitions.join(",")
    || translation.functions.map(item => item.lean_name).sort().join(",") !== productionDefinitions.map(name => `aicharts_metrics.${name}`).join(",")) throw new Error("extracted_function_inventory_drift");
  for (const item of translation.functions) {
    const name = item.lean_name.slice("aicharts_metrics.".length), sourceModule = name.split(".")[0];
    const rustName = name.startsWith("arithmetic.price_microusd") ? "arithmetic.price_microusd" : name;
    if (item.rust_name !== `aicharts_metrics::${rustName.replaceAll(".", "::")}`
      || item.source.file !== `crates/aicharts-metrics/src/${sourceModule}.rs` || item.source.begin_line > item.source.end_line) throw new Error("extracted_source_mapping_drift");
  }
  return definitions;
}

async function requireProcess(result: ProofProcess, file: string) {
  await writeFile(file, result.output);
  if (!completed(result) || result.exitCode !== 0) throw new Error(`proof_tool_failed:${file}`);
  return result;
}

export async function runTheorems() {
  const extras = ["scripts/assurance-proof-common.ts", "scripts/assurance-proof-common.test.ts", "scripts/assurance-theorems.ts", "scripts/assurance-theorems.test.ts", "verify/lean/toolchain.json",
    "verify/lean/UsageLaws.lean", "verify/lean/ProductionKernels.proofs.lean", "verify/lean/Pricing.proofs.lean", "verify/lean/mutations.json"];
  const snapshot = await sourceSnapshot(extras);
  const pin = pinSchema.parse(JSON.parse(snapshot.bytes.get("verify/lean/toolchain.json")!.toString("utf8")));
  const platform = `${process.platform}-${process.arch}`;
  const selectedTools = pin.platforms[platform];
  if (!selectedTools) throw new Error(`unqualified_theorem_platform:${platform}`);
  const tools = Object.fromEntries(Object.entries(selectedTools).map(([name, value]) => [name, resolve(proofRoot, value.path)])) as Record<keyof typeof selectedTools, string>;
  const toolHashes: Record<string, string> = {};
  for (const [name, value] of Object.entries(selectedTools)) {
    const actual = sha256(await readProofFile(resolve(proofRoot, value.path), 536_870_912));
    if (actual !== value.sha256) throw new Error(`proof_tool_hash_mismatch:${name}`);
    toolHashes[value.path] = actual;
  }
  if (!pin.backends[platform]) throw new Error(`missing_theorem_backend:${platform}`);
  const backend = resolve(proofRoot, pin.backends[platform]);
  const backendManifest = await readProofFile(resolve(backend, "lake-manifest.json"));
  if (sha256(backendManifest) !== pin.backendManifestSha256) throw new Error("backend_dependency_lock_drift");
  const backendHashes: Record<string, string> = { "lake-manifest.json": sha256(backendManifest) };
  for (const path of ["lakefile.lean", "lean-toolchain"]) backendHashes[path] = sha256(await readProofFile(resolve(backend, path)));
  const run = await proofRunDirectory("theorems");
  const env: NodeJS.ProcessEnv = { ...proofEnvironment(process.env), PATH: `${dirname(tools.lean)}:${process.env.PATH ?? ""}`,
    RUSTUP_HOME: resolve(proofRoot, pin.rustupHome), CARGO_NET_OFFLINE: "true" };
  delete env.RUSTUP_TOOLCHAIN;
  // Do not let a caller substitute a compiler, proof import path, or additional Rust flags.
  for (const key of ["RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUSTC", "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER", "LEAN_PATH", "LEAN_SRC_PATH"]) delete env[key];
  const versions = {
    lean: await requireProcess(await runProofProcess(tools.lean, ["--version"], run, env), resolve(run, "lean-version.txt")),
    aeneas: await requireProcess(await runProofProcess(tools.aeneas, ["-version"], run, env), resolve(run, "aeneas-version.txt")),
    charon: await requireProcess(await runProofProcess(tools.charon, ["version"], run, env), resolve(run, "charon-version.txt")),
  };
  if (!versions.lean.output.includes(`version ${pin.versions.lean}`) || !versions.lean.output.includes(pin.versions.leanCommit.slice(0, 12))
    || !versions.aeneas.output.includes(pin.versions.aeneas) || !versions.charon.output.includes(pin.versions.charonCommit)) throw new Error("proof_tool_version_mismatch");
  const proofTemplate = snapshot.bytes.get("verify/lean/ProductionKernels.proofs.lean")!.toString("utf8") + "\n"
    + snapshot.bytes.get("verify/lean/Pricing.proofs.lean")!.toString("utf8");
  const mathSource = snapshot.bytes.get("verify/lean/UsageLaws.lean")!.toString("utf8");
  rejectAdmissions(proofTemplate); rejectAdmissions(mathSource);
  const manifest = leanMutationsSchema.parse(JSON.parse(snapshot.bytes.get("verify/lean/mutations.json")!.toString("utf8")) as unknown);
  const ids = [...manifest.production, ...manifest.mathematical].map(item => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate_theorem_mutation_id");
  for (const item of manifest.production) if (!pin.productionTheorems.includes(`aicharts_metrics.${item.expectedTheorem}`)) throw new Error(`unknown_production_mutation_theorem:${item.id}`);
  for (const item of manifest.mathematical) if (!pin.mathematicalTheorems.includes(`UsageLaws.${item.expectedTheorem}`)) throw new Error(`unknown_mathematical_mutation_theorem:${item.id}`);
  const cases: { name: string; mutation?: SourceMutation; expectedTheorem?: string }[] = [
    { name: "production" }, ...manifest.production.map(mutation => ({ name: mutation.id, mutation, expectedTheorem: mutation.expectedTheorem }))];
  const results = [];
  for (const item of cases) {
    if (item.mutation && !results[0]?.evaluation.ok) break;
    const stage = await stageKernel(run, item.name, snapshot, item.mutation);
    const llbc = resolve(stage.path, "ProductionKernels.llbc"), generatedRoot = resolve(stage.path, "generated");
    await mkdir(generatedRoot);
    const extract = await requireProcess(await runProofProcess(tools.charon, ["cargo", "--preset=aeneas",
      "--start-from", "aicharts_metrics::arithmetic::checked_add_bounded",
      "--start-from", "aicharts_metrics::arithmetic::checked_replace",
      "--start-from", "aicharts_metrics::arithmetic::price_microusd",
      "--start-from", "aicharts_metrics::revision::merge_owner", "--dest-file", llbc,
      "--", "--manifest-path", "crates/aicharts-metrics/Cargo.toml", "--locked", "--offline"], stage.path,
    { ...env, CARGO_TARGET_DIR: resolve(stage.path, "target") }), resolve(stage.path, "extract.log"));
    const llbcBytes = await readProofFile(llbc);
    z.object({ charon_version: z.literal(pin.versions.charon), has_errors: z.literal(false), translated: z.object({
      options: z.object({ opaque: z.array(z.unknown()).length(0), exclude: z.array(z.unknown()).length(0),
        rustc_args: z.array(z.unknown()).length(0), skip_borrowck: z.literal(false), no_typecheck: z.literal(false) }).passthrough() }).passthrough() }).passthrough().parse(JSON.parse(llbcBytes.toString("utf8")) as unknown);
    const translate = await requireProcess(await runProofProcess(tools.aeneas, ["-backend", "lean", "-dest", generatedRoot,
      "-abort-on-error", "-warnings-as-errors", "-no-progress-bar", "-emit-json", llbc], stage.path, env), resolve(stage.path, "translate.log"));
    const generated = (await readProofFile(resolve(generatedRoot, "ProductionKernels.lean"))).toString("utf8");
    rejectAdmissions(generated);
    const translationBytes = await readProofFile(resolve(generatedRoot, "translation.json"));
    const definitions = admitTranslation(JSON.parse(translationBytes.toString("utf8")) as unknown, generated, pin.versions.aeneas, pin.versions.charon);
    const combined = `${generated}\n${proofTemplate}`, proofPath = resolve(stage.path, "ProductionProofs.lean");
    await writeFile(proofPath, combined);
    const proof = await runProofProcess(tools.lake, ["env", "lean", proofPath], backend, env);
    await writeFile(resolve(stage.path, "proof.log"), proof.output);
    const evaluation = item.expectedTheorem ? { ok: admitLeanMutation(proof, combined, item.expectedTheorem, proofPath), expectedFailedTheorem: item.expectedTheorem }
      : admitLean(proof, pin.productionTheorems, pin.allowedAxioms);
    const artifactHashes = { "ProductionKernels.llbc": sha256(llbcBytes), "generated/ProductionKernels.lean": sha256(generated),
      "generated/translation.json": sha256(translationBytes), "ProductionProofs.lean": sha256(combined) };
    const stageUnchanged = await kernelStageUnchanged(stage) && await proofFilesUnchanged(stage.path, artifactHashes);
    evaluation.ok &&= stageUnchanged;
    results.push({ ...stage, definitions, extract, translate, proof, evaluation,
      stageUnchanged, artifactHashes, generatedSha256: sha256(generated), proofSha256: sha256(combined), llbcSha256: sha256(llbcBytes) });
  }
  const mathPath = resolve(run, "UsageLaws.lean");
  await writeFile(mathPath, mathSource);
  const mathematical = await runProofProcess(tools.lean, [mathPath], run, env);
  await writeFile(resolve(run, "mathematical.log"), mathematical.output);
  const mathematicalEvaluation = admitLean(mathematical, pin.mathematicalTheorems, pin.allowedAxioms);
  const mathematicalMutations = [], mathematicalHashes: Record<string, string> = { "UsageLaws.lean": sha256(mathSource) };
  for (const mutation of manifest.mathematical) {
    if (!mathematicalEvaluation.ok) break;
    const mutated = applyExactMutation(mathSource, mutation), directory = resolve(run, "mathematical-mutations", mutation.id);
    await mkdir(directory, { recursive: true });
    const path = resolve(directory, "UsageLaws.lean");
    await writeFile(path, mutated);
    const process = await runProofProcess(tools.lean, [path], directory, env);
    await writeFile(resolve(directory, "proof.log"), process.output);
    mathematicalHashes[`mathematical-mutations/${mutation.id}/UsageLaws.lean`] = sha256(mutated);
    mathematicalMutations.push({ mutation: mutation.id, source: mutation.source, expectedFailedTheorem: mutation.expectedTheorem, process,
      evaluation: { ok: admitLeanMutation(process, mutated, mutation.expectedTheorem, path), expectedFailedTheorem: mutation.expectedTheorem } });
  }
  const inputsUnchanged = await snapshotUnchanged(snapshot);
  const backendUnchanged = await proofFilesUnchanged(backend, backendHashes);
  const stagesUnchanged = (await Promise.all(results.map(async result => await kernelStageUnchanged(result)
    && await proofFilesUnchanged(result.path, result.artifactHashes)))).every(Boolean)
    && await proofFilesUnchanged(run, mathematicalHashes);
  let toolsUnchanged = true;
  for (const [path, hash] of Object.entries(toolHashes)) if (sha256(await readProofFile(resolve(proofRoot, path), 536_870_912)) !== hash) toolsUnchanged = false;
  const receipt = { schemaVersion: 1, ...await gitIdentity(), createdAt: new Date().toISOString(),
    claim: "eight freshly extracted production functions; twenty-six production proof declarations and nine separate mathematical laws",
    limitations: ["No theorem of Rust/SQL/provider whole-system refinement or arbitrary occurrence-merge associativity.",
      "Rust/Charon/Aeneas translation, standard-library models, Lean kernel/installed libraries and the pinned build environment are trusted boundaries.",
      "Mathematical finite-history laws are separate specifications; bounded-add and replacement prove numeric refusal without classifying every error variant.",
      "Pricing quantifies five full-u128 token buckets and five optional full-u128 rates, proves exact ordered refusal and the success formula; tariff provenance and observation populations remain external obligations.",
      "Binary hashes and dependency lock are checked; dynamically loaded runtime/library bytes are not a complete installed-image attestation."],
    platform, pin, versions, toolHashes, backendHashes, backendUnchanged, environment: env, sourceSha256: snapshot.hashes, inputsUnchanged, toolsUnchanged, stagesUnchanged,
    results, mathematical, mathematicalEvaluation, mathematicalMutations,
    ok: inputsUnchanged && toolsUnchanged && backendUnchanged && stagesUnchanged && results.length === cases.length
      && results.every(result => result.evaluation.ok) && mathematicalEvaluation.ok
      && mathematicalMutations.length === manifest.mathematical.length && mathematicalMutations.every(result => result.evaluation.ok) };
  const path = resolve(run, "receipt.json");
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ ok: receipt.ok, receipt: relative(proofRoot, path), productionTheorems: pin.productionTheorems.length, mathematicalTheorems: pin.mathematicalTheorems.length,
    negativeControls: { production: results.length - 1, mathematical: mathematicalMutations.length } }));
  return receipt;
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 2) throw new Error("theorem_runner_accepts_no_unreviewed_flags");
    if (!(await runTheorems()).ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "theorem_runner_failed" }));
    process.exitCode = 1;
  }
}
