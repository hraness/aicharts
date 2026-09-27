import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateLinuxQualificationReport } from "./linux-qualification.mjs";

// Publication cross-check for the tag-triggered Publish Linux CLI workflow.
//
// It reads one retained qualification artifact (the five assembled assets plus
// qualification.json), binds them to independently supplied tag, commit and
// qualification-run facts, recomputes every digest and refuses any extra,
// missing, oversized or drifted member. It does not build, download, sign,
// attest or publish; the workflow owns those effects. The manifest matcher in
// manifest.mjs already validated the canonical bytes during assembly; this
// module only cross-checks selected fields against facts it did not derive
// from the artifact.

const MiB = 1024 * 1024;
const REPOSITORY = "hraness/aicharts";
const WORKFLOW = ".github/workflows/cli-release.yml";
const CAPS = Object.freeze({ cli: 64 * MiB, skill: MiB, source: 32 * MiB, manifest: MiB, checksums: 4096, qualification: 65_536, receipt: 65_536 });
const COMMIT = /^[0-9a-f]{40}$/u;
const TAG = /^cli-v((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const ERRORS = new Set(["publication_invalid_input", "publication_artifact_invalid", "publication_limit", "publication_qualification_invalid",
  "publication_manifest_invalid", "publication_checksums_invalid", "publication_binding_mismatch", "publication_digest_mismatch"]);
const fail = code => { throw code; };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function readBounded(file, cap) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile()) fail("publication_artifact_invalid");
  if (stat.size > cap) fail("publication_limit");
  const bytes = fs.readFileSync(file);
  if (bytes.length !== stat.size) fail("publication_artifact_invalid");
  return bytes;
}

function exactEntries(directory, expected) {
  let entries;
  try { entries = fs.readdirSync(directory).sort(); } catch { fail("publication_artifact_invalid"); }
  if (JSON.stringify(entries) !== JSON.stringify([...expected].sort())) fail("publication_artifact_invalid");
}

function parseChecksums(bytes) {
  const text = bytes.toString("utf8");
  if (!text.endsWith("\n") || text.includes("\r")) fail("publication_checksums_invalid");
  const lines = text.slice(0, -1).split("\n");
  const entries = lines.map(line => {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/u.exec(line);
    if (!match) fail("publication_checksums_invalid");
    return { name: match[2], sha256: match[1] };
  });
  const names = entries.map(entry => entry.name);
  if (new Set(names).size !== names.length || JSON.stringify(names) !== JSON.stringify([...names].sort())) fail("publication_checksums_invalid");
  return entries;
}

function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value) ? value : fail("publication_manifest_invalid"); }

export function verifyPublication(input) {
  if (typeof input !== "object" || input === null) fail("publication_invalid_input");
  const { artifactDirectory, tag, commit, runId, runAttempt } = input;
  if (typeof artifactDirectory !== "string" || !path.isAbsolute(artifactDirectory)) fail("publication_invalid_input");
  const tagMatch = TAG.exec(typeof tag === "string" ? tag : "");
  if (!tagMatch || !COMMIT.test(commit ?? "") || !RUN_ID.test(runId ?? "") || !Number.isInteger(runAttempt) || runAttempt < 1 || runAttempt > 1_000_000) {
    fail("publication_invalid_input");
  }
  const version = tagMatch[1];
  const names = Object.freeze({
    cli: `aicharts-${version}-x86_64-unknown-linux-gnu.tar.gz`, skill: `aicharts-skill-${version}.tar.gz`, source: `aicharts-source-${version}.tar.gz`,
  });
  const assetsDirectory = path.join(artifactDirectory, "assets");
  exactEntries(artifactDirectory, ["assets", "qualification.json"]);
  exactEntries(assetsDirectory, [names.cli, names.skill, names.source, "release-manifest.json", "SHA256SUMS"]);

  const qualification = validateLinuxQualificationReport(readBounded(path.join(artifactDirectory, "qualification.json"), CAPS.qualification));
  if (!qualification.ok) fail("publication_qualification_invalid");
  const report = qualification.value.value;
  if (report.qualified !== true || report.version !== version || report.source.commit !== commit
    || report.runner.runId !== runId || report.runner.runAttempt !== runAttempt || report.smoke.passed !== true || report.notices.complete !== true) {
    fail("publication_binding_mismatch");
  }

  const archives = Object.freeze(Object.fromEntries(["cli", "skill", "source"].map(kind => {
    const bytes = readBounded(path.join(assetsDirectory, names[kind]), CAPS[kind]);
    if (bytes.length < 20) fail("publication_artifact_invalid");
    return [kind, { name: names[kind], bytes: bytes.length, sha256: digest(bytes) }];
  })));
  const manifestBytes = readBounded(path.join(assetsDirectory, "release-manifest.json"), CAPS.manifest);
  let manifest;
  try { manifest = record(JSON.parse(manifestBytes.toString("utf8"))); } catch (error) { if (ERRORS.has(error)) throw error; fail("publication_manifest_invalid"); }
  const source = record(manifest.source), workflow = record(manifest.workflow);
  if (manifest.schemaVersion !== 1 || manifest.profile !== "linux-skill-v1" || manifest.repository !== REPOSITORY || manifest.tag !== tag
    || manifest.version !== version || source.commit !== commit || source.tree !== report.source.tree
    || workflow.path !== WORKFLOW || workflow.sourceRef !== "refs/heads/main" || workflow.sourceCommit !== commit
    || workflow.runId !== runId || workflow.runAttempt !== runAttempt) {
    fail("publication_binding_mismatch");
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== 3) fail("publication_manifest_invalid");
  for (const kind of ["cli", "skill", "source"]) {
    const asset = record(manifest.assets.find(item => record(item).name === names[kind]) ?? fail("publication_manifest_invalid"));
    if (asset.kind !== kind || asset.bytes !== archives[kind].bytes || asset.sha256 !== archives[kind].sha256) fail("publication_digest_mismatch");
  }

  const checksums = parseChecksums(readBounded(path.join(assetsDirectory, "SHA256SUMS"), CAPS.checksums));
  const expected = [...Object.values(archives), { name: "release-manifest.json", sha256: digest(manifestBytes) }]
    .map(({ name, sha256 }) => ({ name, sha256 })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (JSON.stringify(checksums) !== JSON.stringify(expected)) fail("publication_digest_mismatch");

  return Object.freeze({
    schemaVersion: 1, operation: "cli-publication-verification", tag, version, commit, tree: report.source.tree,
    qualification: { runId, runAttempt, receiptSha256: qualification.value.sha256, executableSha256: report.executable.sha256 },
    assets: [...Object.values(archives), { name: "release-manifest.json", bytes: manifestBytes.length, sha256: digest(manifestBytes) }],
    claim: "retained-assets-rebound-to-tag-commit-and-run; publication and provenance are established by the workflow, not this receipt",
  });
}

function parseArguments(argv) {
  const options = {};
  const flags = { "--artifact": "artifactDirectory", "--tag": "tag", "--commit": "commit", "--run-id": "runId", "--run-attempt": "runAttempt", "--receipt": "receipt" };
  for (let index = 0; index < argv.length; index += 2) {
    const key = flags[argv[index]], value = argv[index + 1];
    if (key === undefined || value === undefined || key in options) fail("publication_invalid_input");
    options[key] = value;
  }
  if (!/^[1-9][0-9]{0,5}$/u.test(options.runAttempt ?? "")) fail("publication_invalid_input");
  options.runAttempt = Number(options.runAttempt);
  if (typeof options.receipt !== "string" || !path.isAbsolute(options.receipt)) fail("publication_invalid_input");
  return options;
}

export function main(argv) {
  const { receipt, ...options } = parseArguments(argv);
  const result = verifyPublication(options);
  const bytes = Buffer.from(`${JSON.stringify(result)}\n`, "utf8");
  if (bytes.length > CAPS.receipt) fail("publication_limit");
  fs.writeFileSync(receipt, bytes, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ operation: result.operation, tag: result.tag, commit: result.commit, assets: result.assets.length })}\n`);
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) {
    const code = typeof error === "string" && ERRORS.has(error) ? error : "publication_failed";
    process.stderr.write(`${JSON.stringify({ operation: "cli-publication-verification", ok: false, error: code })}\n`);
    process.exitCode = 1;
  }
}
