import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { encodeLinuxQualificationReport } from "./linux-qualification.mjs";
import { main, verifyPublication } from "./verify-publication.mjs";

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const RUN_ID = "35498763628";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const names = {
  cli: "aicharts-0.1.0-x86_64-unknown-linux-gnu.tar.gz", skill: "aicharts-skill-0.1.0.tar.gz", source: "aicharts-source-0.1.0.tar.gz",
};

function qualificationInput(overrides = {}) {
  return {
    schemaVersion: 1, qualified: true, profile: "linux-cli-v1", version: "0.1.0",
    source: { commit: COMMIT, tree: TREE, commitTime: "2026-09-20T08:06:51Z" },
    runner: { label: "ubuntu-22.04", imageVersion: "20260920.303.1", runId: RUN_ID, runAttempt: 1 },
    toolchain: { rustChannel: "1.97.1", rustCommit: "c".repeat(40), nodeMajor: 24, cCompiler: { name: "gcc", version: "11.4.0" } },
    target: { triple: "x86_64-unknown-linux-gnu", os: "linux", arch: "x86_64", osFloor: "ubuntu-22.04", libcFloor: "glibc-2.35", cpuBaseline: "x86-64", dynamicDependencies: ["libc.so.6", "libgcc_s.so.1"] },
    executable: { bytes: 1000, sha256: "d".repeat(64) }, smoke: { passed: true, invocations: 8 },
    notices: { complete: true, bytes: 2000, sha256: "e".repeat(64) },
    ...overrides,
  };
}

/** Build one synthetic retained artifact directory; `mutate` edits the manifest before it is serialized. */
function artifact(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aicharts-publication-"));
  const assets = path.join(root, "assets");
  fs.mkdirSync(assets);
  const archives = {};
  for (const kind of ["cli", "skill", "source"]) {
    const bytes = Buffer.from(`${kind} archive bytes ${"x".repeat(32)}`, "utf8");
    fs.writeFileSync(path.join(assets, names[kind]), bytes);
    archives[kind] = { name: names[kind], kind, bytes: bytes.length, sha256: digest(bytes) };
  }
  const manifest = {
    schemaVersion: 1, profile: "linux-skill-v1", repository: "hraness/aicharts", tag: "cli-v0.1.0", version: "0.1.0",
    source: { commit: COMMIT, tree: TREE, commitTime: "2026-09-20T08:06:51Z" },
    workflow: { path: ".github/workflows/cli-release.yml", sourceRef: "refs/heads/main", sourceCommit: COMMIT, runId: RUN_ID, runAttempt: 1 },
    assets: Object.values(archives),
  };
  options.mutate?.(manifest);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
  fs.writeFileSync(path.join(assets, "release-manifest.json"), manifestBytes);
  const sums = [...Object.values(archives).map(a => ({ name: a.name, sha256: a.sha256 })), { name: "release-manifest.json", sha256: digest(manifestBytes) }]
    .sort((a, b) => a.name < b.name ? -1 : 1).map(({ name, sha256 }) => `${sha256}  ${name}\n`).join("");
  fs.writeFileSync(path.join(assets, "SHA256SUMS"), options.sums ?? sums);
  const encoded = encodeLinuxQualificationReport(qualificationInput(options.qualification));
  assert.equal(encoded.ok, true);
  fs.writeFileSync(path.join(root, "qualification.json"), options.qualificationBytes ?? encoded.value.bytes);
  return root;
}

const facts = artifactDirectory => ({ artifactDirectory, tag: "cli-v0.1.0", commit: COMMIT, runId: RUN_ID, runAttempt: 1 });
const rejects = (input, code) => assert.throws(() => verifyPublication(input), error => error === code);

test("a complete retained artifact bound to its tag, commit and run verifies with recomputed digests", () => {
  const root = artifact();
  const receipt = verifyPublication(facts(root));
  assert.equal(receipt.operation, "cli-publication-verification");
  assert.equal(receipt.tag, "cli-v0.1.0");
  assert.equal(receipt.version, "0.1.0");
  assert.equal(receipt.tree, TREE);
  assert.deepEqual(receipt.qualification.runId, RUN_ID);
  assert.equal(receipt.assets.length, 4);
  assert.deepEqual(receipt.assets.map(a => a.name), [names.cli, names.skill, names.source, "release-manifest.json"]);
  for (const asset of receipt.assets) assert.equal(asset.sha256, digest(fs.readFileSync(path.join(root, "assets", asset.name))));
  assert.match(receipt.claim, /not this receipt$/u);
  assert.ok(Object.isFrozen(receipt));
});

test("inputs are validated before any file is read", () => {
  const root = artifact();
  rejects(null, "publication_invalid_input");
  rejects({ ...facts(root), artifactDirectory: "relative/path" }, "publication_invalid_input");
  rejects({ ...facts(root), tag: "v0.1.0" }, "publication_invalid_input");
  rejects({ ...facts(root), tag: "cli-v01.0.0" }, "publication_invalid_input");
  rejects({ ...facts(root), commit: COMMIT.slice(1) }, "publication_invalid_input");
  rejects({ ...facts(root), runId: "0123" }, "publication_invalid_input");
  rejects({ ...facts(root), runAttempt: "1" }, "publication_invalid_input");
  rejects({ ...facts(root), runAttempt: 0 }, "publication_invalid_input");
  rejects({ ...facts(root), artifactDirectory: path.join(root, "missing") }, "publication_artifact_invalid");
});

test("the artifact must hold exactly the assembled members", () => {
  const extra = artifact();
  fs.writeFileSync(path.join(extra, "assets", "extra.txt"), "x");
  rejects(facts(extra), "publication_artifact_invalid");
  const missing = artifact();
  fs.rmSync(path.join(missing, "assets", names.skill));
  rejects(facts(missing), "publication_artifact_invalid");
  const stray = artifact();
  fs.writeFileSync(path.join(stray, "summary.json"), "{}");
  rejects(facts(stray), "publication_artifact_invalid");
  const symlink = artifact();
  fs.rmSync(path.join(symlink, "assets", names.source));
  fs.symlinkSync(path.join(symlink, "assets", names.cli), path.join(symlink, "assets", names.source));
  rejects(facts(symlink), "publication_artifact_invalid");
  const oversized = artifact();
  fs.writeFileSync(path.join(oversized, "assets", names.skill), Buffer.alloc(1024 * 1024 + 1));
  rejects(facts(oversized), "publication_limit");
});

test("the qualification receipt must be valid, qualified and bound to the supplied commit and run", () => {
  rejects(facts(artifact({ qualificationBytes: Buffer.from("{}\n") })), "publication_qualification_invalid");
  rejects(facts(artifact({ qualification: { version: "0.1.1" } })), "publication_binding_mismatch");
  rejects(facts(artifact({ qualification: { source: { commit: "f".repeat(40), tree: TREE, commitTime: "2026-09-20T08:06:51Z" } } })), "publication_binding_mismatch");
  rejects(facts(artifact({ qualification: { runner: { label: "ubuntu-22.04", imageVersion: "20260920.303.1", runId: "1", runAttempt: 1 } } })), "publication_binding_mismatch");
  rejects({ ...facts(artifact()), runAttempt: 2 }, "publication_binding_mismatch");
});

test("the manifest must bind the same tag, commit, workflow and run and match every archive digest", () => {
  rejects(facts(artifact({ mutate: m => { m.tag = "cli-v0.1.1"; } })), "publication_binding_mismatch");
  rejects(facts(artifact({ mutate: m => { m.repository = "hraness/other"; } })), "publication_binding_mismatch");
  rejects(facts(artifact({ mutate: m => { m.workflow.sourceRef = "refs/tags/cli-v0.1.0"; } })), "publication_binding_mismatch");
  rejects(facts(artifact({ mutate: m => { m.workflow.runId = "2"; } })), "publication_binding_mismatch");
  rejects(facts(artifact({ mutate: m => { m.source.tree = "9".repeat(40); } })), "publication_binding_mismatch");
  rejects(facts(artifact({ mutate: m => { m.assets[0].sha256 = "0".repeat(64); } })), "publication_digest_mismatch");
  rejects(facts(artifact({ mutate: m => { m.assets[1].bytes += 1; } })), "publication_digest_mismatch");
  rejects(facts(artifact({ mutate: m => { m.assets[2].kind = "cli"; } })), "publication_digest_mismatch");
  rejects(facts(artifact({ mutate: m => { m.assets.pop(); } })), "publication_manifest_invalid");
  rejects(facts(artifact({ mutate: m => { m.workflow = "main"; } })), "publication_manifest_invalid");
  const malformed = artifact();
  fs.writeFileSync(path.join(malformed, "assets", "release-manifest.json"), "{not json\n");
  rejects(facts(malformed), "publication_manifest_invalid");
});

test("SHA256SUMS must list exactly the four checksummed assets with recomputed digests", () => {
  rejects(facts(artifact({ sums: "" })), "publication_checksums_invalid");
  rejects(facts(artifact({ sums: "\n" })), "publication_checksums_invalid");
  rejects(facts(artifact({ sums: `${"0".repeat(64)}  ${names.cli}\n` })), "publication_digest_mismatch");
  rejects(facts(artifact({ sums: `${"0".repeat(64)} ${names.cli}\n` })), "publication_checksums_invalid");
  rejects(facts(artifact({ sums: `${"0".repeat(64)}  ${names.cli}` })), "publication_checksums_invalid");
  rejects(facts(artifact({ sums: `${"0".repeat(64)}  ../${names.cli}\n` })), "publication_checksums_invalid");
  const swapped = artifact();
  const sums = fs.readFileSync(path.join(swapped, "assets", "SHA256SUMS"), "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(path.join(swapped, "assets", "SHA256SUMS"), `${[sums[1], sums[0], ...sums.slice(2)].join("\n")}\n`);
  rejects(facts(swapped), "publication_checksums_invalid");
  const drifted = artifact();
  fs.appendFileSync(path.join(drifted, "assets", names.cli), "!");
  rejects(facts(drifted), "publication_digest_mismatch");
});

test("the command line writes one receipt exactly once and rejects malformed arguments", () => {
  const root = artifact();
  const receipt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aicharts-publication-receipt-")), "publication.json");
  const argv = ["--artifact", root, "--tag", "cli-v0.1.0", "--commit", COMMIT, "--run-id", RUN_ID, "--run-attempt", "1", "--receipt", receipt];
  const written = [];
  const original = process.stdout.write;
  process.stdout.write = chunk => { written.push(String(chunk)); return true; };
  try {
    assert.equal(main(argv), 0);
  } finally { process.stdout.write = original; }
  const parsed = JSON.parse(fs.readFileSync(receipt, "utf8"));
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.commit, COMMIT);
  assert.equal(fs.statSync(receipt).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(written.join("")), { operation: "cli-publication-verification", tag: "cli-v0.1.0", commit: COMMIT, assets: 4 });
  assert.throws(() => main(argv), /EEXIST/u);
  assert.throws(() => main(argv.slice(0, -2)), error => error === "publication_invalid_input");
  assert.throws(() => main([...argv, "--tag", "cli-v0.1.0"]), error => error === "publication_invalid_input");
  assert.throws(() => main(argv.map(v => v === "1" ? "01" : v)), error => error === "publication_invalid_input");
  assert.throws(() => main(argv.map(v => v === receipt ? "relative.json" : v)), error => error === "publication_invalid_input");
});
