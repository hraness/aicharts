import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { assembleLinuxRelease } from "./assemble.mjs";
import { buildArchive, validateArchive } from "./archive.mjs";
import { encodeBuild, validateBuild } from "./build.mjs";
import { parseManifest, parseChecksums } from "./manifest.mjs";

// All payloads are synthetic. No executable is run and no source tree is read.
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const good = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};
const sourceFile = (path, text, mode = 0o644) => ({ path, mode, bytes: Buffer.from(text) });
const REQUIRED = [
  "LICENSE", "NOTICE.md", "Cargo.lock", "bun.lock", "Cargo.toml",
  "crates/aicharts-cli/Cargo.toml", "rust-toolchain.toml",
  "distribution/NOTICE.md", "distribution/cli/docs/usage-install.md",
  "distribution/cli/docs/usage-local.md", "skills/aicharts/SKILL.md",
  "skills/aicharts/agents/openai.yaml", "skills/aicharts/references/benchmarks.md",
  "skills/aicharts/references/local-usage.md", "skills/aicharts/scripts/atlas.mjs",
  "skills/aicharts/scripts/atlas.check.mjs",
];
function fixture() {
  return {
    version: "0.1.0",
    source: { commit: "1".repeat(40), tree: "2".repeat(40), commitTime: "2026-09-11T12:00:00Z" },
    run: { runId: "9007199254740993", runAttempt: 1 },
    toolchain: { rustChannel: "1.97.1", nodeMajor: 24, bunVersion: "1.3.14" },
    target: {
      triple: "x86_64-unknown-linux-gnu", os: "linux", arch: "x86_64",
      osFloor: "ubuntu-22.04", libcFloor: "glibc-2.35", cpuBaseline: "x86-64",
      runnerLabel: "ubuntu-22.04", runnerImageVersion: "20260907.12.1",
      cCompiler: { name: "gcc", version: "11.4.0" },
      dynamicDependencies: ["libc.so.6", "libgcc_s.so.1"],
    },
    sourceFiles: [
      ...REQUIRED.map((path) => sourceFile(path, `synthetic source bytes: ${path}\n`)),
      sourceFile("extras/nonmandatory.txt", "synthetic nonmandatory tree entry\n"),
      sourceFile("scripts/release/assemble.mjs", "// synthetic tracked assembly recipe\n", 0o755),
    ],
    executableBytes: Buffer.from("synthetic executable; NEVER EXECUTED\n"),
    thirdPartyLicenseBytes: Buffer.from("synthetic notice fixture; NOT qualified license coverage\n"),
  };
}
const selected = (input, path) => input.sourceFiles.find((file) => file.path === path);
const fileInventory = (files) => files.map((file) => ({
  path: file.path, mode: file.mode, bytes: file.bytes.byteLength, sha256: sha(file.bytes),
})).sort((a, b) => order(a.path, b.path));
const caps = (kind) => ({
  maxCompressedBytes: { cli: 64 * 1024 * 1024, skill: 1024 * 1024, source: 32 * 1024 * 1024 }[kind],
  maxExpandedBytes: { cli: 128 * 1024 * 1024, skill: 4 * 1024 * 1024, source: 64 * 1024 * 1024 }[kind],
  maxFileBytes: { cli: 128 * 1024 * 1024, skill: 4 * 1024 * 1024, source: 64 * 1024 * 1024 }[kind],
  maxFiles: kind === "source" ? 2048 : 16, maxEntries: 8192, maxExpansionRatio: 4096,
});
function buildExpectations(input, kind) {
  const cli = kind === "cli";
  return {
    kind, version: input.version, sourceCommit: input.source.commit, sourceTree: input.source.tree,
    toolchain: {
      rustChannel: cli ? input.toolchain.rustChannel : null,
      cargoLockSha256: cli ? sha(selected(input, "Cargo.lock").bytes) : null,
      nodeMajor: 24, cCompiler: cli ? { ...input.target.cCompiler } : null,
    },
    runner: {
      label: input.target.runnerLabel, imageVersion: input.target.runnerImageVersion,
      runId: input.run.runId, runAttempt: input.run.runAttempt,
    },
    executableSha256: cli ? sha(input.executableBytes) : null,
  };
}
function expectedPayloads(input) {
  const mapped = (path, source) => ({ path, mode: 0o644, bytes: selected(input, source).bytes });
  const build = (kind) => ({ path: "BUILD.json", mode: 0o644, bytes: good(encodeBuild(buildExpectations(input, kind))) });
  return {
    cli: [
      { path: "bin/aicharts", mode: 0o755, bytes: input.executableBytes }, build("cli"),
      mapped("LICENSE", "LICENSE"), mapped("NOTICE.md", "distribution/NOTICE.md"),
      { path: "THIRD_PARTY_LICENSES.txt", mode: 0o644, bytes: input.thirdPartyLicenseBytes },
      mapped("docs/usage-install.md", "distribution/cli/docs/usage-install.md"),
      mapped("docs/usage-local.md", "distribution/cli/docs/usage-local.md"),
    ],
    skill: [
      build("skill"), mapped("LICENSE", "LICENSE"), mapped("NOTICE.md", "distribution/NOTICE.md"),
      ...["SKILL.md", "agents/openai.yaml", "references/benchmarks.md", "references/local-usage.md", "scripts/atlas.mjs", "scripts/atlas.check.mjs"]
        .map((path) => mapped(path, `skills/aicharts/${path}`)),
    ],
    source: input.sourceFiles,
  };
}
const roots = (version) => ({ cli: `aicharts-${version}-x86_64-unknown-linux-gnu`, skill: "aicharts", source: `aicharts-source-${version}` });
const names = (version) => ({ cli: `aicharts-${version}-x86_64-unknown-linux-gnu.tar.gz`, skill: `aicharts-skill-${version}.tar.gz`, source: `aicharts-source-${version}.tar.gz` });

function verifyJoin(input, result = assembleLinuxRelease(input)) {
  const value = good(result);
  assert.deepEqual(Object.keys(result), ["ok", "value"]);
  assert.deepEqual(Object.keys(value), ["files"]);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.files));
  const assetNames = names(input.version);
  assert.deepEqual(value.files.map((file) => file.name), ["SHA256SUMS", ...Object.values(assetNames), "release-manifest.json"].sort(order));
  for (const file of value.files) {
    assert.deepEqual(Object.keys(file).sort(order), ["bytes", "name", "sha256"]);
    assert.ok(Object.isFrozen(file)); assert.ok(Buffer.isBuffer(file.bytes));
    assert.equal(file.sha256, sha(file.bytes));
    assert.equal(file.bytes.byteOffset, 0); assert.equal(file.bytes.buffer.byteLength, file.bytes.byteLength);
  }
  const outputs = new Map(value.files.map((file) => [file.name, file]));
  const payloads = expectedPayloads(input);
  const root = roots(input.version);
  const mtime = Date.parse(input.source.commitTime) / 1000;
  const inventories = {}; const archived = {};
  for (const kind of ["cli", "skill", "source"]) {
    inventories[kind] = fileInventory(payloads[kind]);
    archived[kind] = good(validateArchive(outputs.get(assetNames[kind]).bytes, {
      root: root[kind], mtime, caps: caps(kind), files: inventories[kind],
    }));
    assert.deepEqual(archived[kind].files.map((file) => file.path), inventories[kind].map((file) => file.path));
    for (const file of archived[kind].files) {
      assert.deepEqual(file.bytes, Buffer.from(payloads[kind].find((entry) => entry.path === file.path).bytes));
    }
  }
  const builds = {};
  for (const kind of ["cli", "skill"]) {
    builds[kind] = good(validateBuild(
      archived[kind].files.find((file) => file.path === "BUILD.json").bytes,
      buildExpectations(input, kind), inventories[kind].find((file) => file.path === "BUILD.json"),
    ));
  }
  assert.equal(builds.cli.executableSha256, sha(archived.cli.files.find((file) => file.path === "bin/aicharts").bytes));
  assert.deepEqual(builds.skill.runner, builds.cli.runner);
  assert.equal(builds.skill.executableSha256, null);
  assert.deepEqual(builds.skill.toolchain, { rustChannel: null, cargoLockSha256: null, nodeMajor: 24, cCompiler: null });
  for (const field of ["target", "os", "arch"]) assert.equal(builds.skill[field], null);
  const asset = (kind) => ({ bytes: outputs.get(assetNames[kind]).bytes.length, sha256: sha(outputs.get(assetNames[kind]).bytes), files: inventories[kind] });
  const expected = {
    version: input.version, source: { ...input.source }, run: { ...input.run },
    toolchain: { ...input.toolchain, cargoLockSha256: sha(selected(input, "Cargo.lock").bytes), bunLockSha256: sha(selected(input, "bun.lock").bytes) },
    target: input.target, cli: asset("cli"), skill: asset("skill"),
    sourceArchive: { bytes: asset("source").bytes, sha256: asset("source").sha256 }, sourceFiles: inventories.source,
  };
  const manifestBytes = outputs.get("release-manifest.json").bytes;
  const manifest = good(parseManifest(manifestBytes, expected));
  assert.equal(manifest.toolchain.cargoLockSha256, builds.cli.toolchain.cargoLockSha256);
  assert.equal(manifest.toolchain.bunLockSha256, sha(selected(input, "bun.lock").bytes));
  assert.equal(manifest.workflow.runId, builds.cli.runner.runId);
  assert.equal(manifest.workflow.sourceCommit, builds.cli.sourceCommit);
  assert.equal(manifest.version, builds.skill.version);
  assert.equal(manifest.source.tree, builds.skill.sourceTree);
  const subjects = value.files.filter((file) => file.name !== "SHA256SUMS");
  const sumText = subjects.map((file) => `${sha(file.bytes)}  ${file.name}\n`).join("");
  assert.equal(outputs.get("SHA256SUMS").bytes.toString(), sumText);
  assert.deepEqual(good(parseChecksums(outputs.get("SHA256SUMS").bytes, manifestBytes, expected)).entries,
    subjects.map((file) => ({ name: file.name, sha256: sha(file.bytes) })));
  return { value, outputs, payloads, inventories, archived, builds, manifest, expected };
}

test("complete synthetic join binds every source member, both BUILDs and four checksum subjects", () => {
  const input = fixture();
  const joined = verifyJoin(input);
  assert.equal(joined.archived.cli.files.length, 7);
  assert.equal(joined.archived.skill.files.length, 9);
  assert.equal(joined.archived.source.files.length, input.sourceFiles.length);
  assert.equal(joined.archived.source.files.find((file) => file.path === "scripts/release/assemble.mjs").mode, 0o755);
  assert.notDeepEqual(joined.archived.source.files.find((file) => file.path === "NOTICE.md").bytes,
    joined.archived.cli.files.find((file) => file.path === "NOTICE.md").bytes);
  assert.deepEqual(joined.manifest.disabledCapabilities,
    ["authentication", "enrollment", "upload", "backgroundCollection", "nativeCustody", "autoUpdate"]);
});

const CANARY = "SYNTHETIC_REJECTED_TEXT_31bb";
function rejected(result, expectedError) {
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result), ["ok", "error"]);
  assert.match(result.error, /^(invalid_input|invalid_source|invalid_binding|limit_exceeded|assembly_failed)$/);
  if (expectedError) assert.equal(result.error, expectedError);
  assert.ok(Object.isFrozen(result));
  assert.equal(JSON.stringify(result).includes(CANARY), false);
}
const at = (input, path) => path.reduce((value, key) => value[key], input);
const replace = (input, path, value) => { at(input, path.slice(0, -1))[path.at(-1)] = value; };
const fileBytes = (joined, kind, version = "0.1.0") => joined.outputs.get(names(version)[kind]).bytes;

test("source and object insertion permutations produce identical canonical bytes", () => {
  const input = fixture();
  const baseline = good(assembleLinuxRelease(input));
  const reorder = (value) => {
    if (ArrayBuffer.isView(value)) return value;
    if (Array.isArray(value)) return value.map(reorder);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)]));
    return value;
  };
  const permuted = reorder(fixture());
  permuted.sourceFiles.reverse();
  assert.deepEqual(good(assembleLinuxRelease(permuted)), baseline);
  const nullable = fixture();
  const nullify = (value) => {
    if (ArrayBuffer.isView(value)) return;
    if (Array.isArray(value)) { for (const child of value) nullify(child); return; }
    if (value && typeof value === "object") { for (const child of Object.values(value)) nullify(child); Object.setPrototypeOf(value, null); }
  };
  nullify(nullable);
  assert.deepEqual(good(assembleLinuxRelease(nullable)), baseline);
});

test("generated payloads use fixed mappings while every extra tracked source stays source-only", () => {
  const input = fixture();
  for (const path of ["README.md", "BUILD.json", "THIRD_PARTY_LICENSES.txt", "bin/aicharts", "evidence/private-integration.md"]) {
    input.sourceFiles.push(sourceFile(path, `synthetic tracked source, not generated payload: ${path}`));
  }
  const joined = verifyJoin(input);
  const cli = new Map(joined.archived.cli.files.map((file) => [file.path, file]));
  const skill = new Map(joined.archived.skill.files.map((file) => [file.path, file]));
  assert.equal(cli.has("README.md"), false);
  for (const path of ["README.md", "THIRD_PARTY_LICENSES.txt", "bin/aicharts", "evidence/private-integration.md"]) assert.equal(skill.has(path), false);
  assert.deepEqual(cli.get("bin/aicharts").bytes, input.executableBytes);
  assert.deepEqual(cli.get("THIRD_PARTY_LICENSES.txt").bytes, input.thirdPartyLicenseBytes);
  assert.notDeepEqual(cli.get("BUILD.json").bytes, selected(input, "BUILD.json").bytes);
});

test("nonmandatory source omission is not falsely diagnosed as missing Git membership", () => {
  const input = fixture();
  input.sourceFiles = input.sourceFiles.filter((file) => REQUIRED.includes(file.path));
  const joined = verifyJoin(input);
  assert.equal(joined.archived.source.files.length, REQUIRED.length);
  // Exhaustive membership and TOML/license semantics belong to external gates.
  assert.equal(joined.value.qualified, undefined);
  assert.equal(joined.value.verifiedRelease, undefined);
});

test("empty source blobs are preserved but executable and notice inputs must be nonempty", () => {
  const input = fixture();
  input.sourceFiles.push(sourceFile("empty.txt", ""));
  const joined = verifyJoin(input);
  assert.equal(joined.archived.source.files.find((file) => file.path === "empty.txt").bytes.length, 0);
  for (const key of ["executableBytes", "thirdPartyLicenseBytes"]) {
    const invalid = fixture(); invalid[key] = Buffer.alloc(0); rejected(assembleLinuxRelease(invalid));
  }
});

test("executable, notice, locks and selected documents change only their proper derived assets", () => {
  const before = verifyJoin(fixture());
  const changes = [
    { mutate: (input) => { input.executableBytes = Buffer.from("changed synthetic executable"); }, changed: ["cli"], build: ["cli"] },
    { mutate: (input) => { input.thirdPartyLicenseBytes = Buffer.from("changed synthetic notices"); }, changed: ["cli"], build: [] },
    { path: "Cargo.lock", changed: ["cli", "source"], build: ["cli"] },
    { path: "bun.lock", changed: ["source"], build: [] },
    { path: "distribution/NOTICE.md", changed: ["cli", "skill", "source"], build: [] },
    { path: "distribution/cli/docs/usage-local.md", changed: ["cli", "source"], build: [] },
    { path: "skills/aicharts/SKILL.md", changed: ["skill", "source"], build: [] },
    { path: "NOTICE.md", changed: ["source"], build: [] },
    { path: "extras/nonmandatory.txt", changed: ["source"], build: [] },
  ];
  for (const change of changes) {
    const input = fixture();
    if (change.path) selected(input, change.path).bytes = Buffer.from(`changed synthetic ${change.path}`);
    else change.mutate(input);
    const after = verifyJoin(input);
    for (const kind of ["cli", "skill", "source"]) {
      assert.equal(fileBytes(after, kind).equals(fileBytes(before, kind)), !change.changed.includes(kind), `${change.path ?? "direct input"}: ${kind}`);
    }
    for (const kind of ["cli", "skill"]) {
      assert.equal(JSON.stringify(after.builds[kind]) === JSON.stringify(before.builds[kind]), !change.build.includes(kind));
    }
    assert.deepEqual(after.manifest.source, before.manifest.source); // Bytes do not authenticate or rewrite the supplied Git identity.
    for (const name of ["release-manifest.json", "SHA256SUMS"]) assert.notDeepEqual(after.outputs.get(name).bytes, before.outputs.get(name).bytes);
  }
});

test("single source, runner, compiler and timestamp facts consistently bind all affected records", () => {
  const before = verifyJoin(fixture());
  for (const [path, value, changed] of [
    [["source", "commit"], "a".repeat(40), ["cli", "skill"]],
    [["source", "tree"], "b".repeat(40), ["cli", "skill"]],
    [["source", "commitTime"], "2026-09-12T12:00:00Z", ["cli", "skill", "source"]],
    [["run", "runId"], "9007199254740994", ["cli", "skill"]],
    [["run", "runAttempt"], 2, ["cli", "skill"]],
    [["target", "runnerImageVersion"], "20260908.1", ["cli", "skill"]],
    [["target", "cCompiler", "name"], "clang", ["cli"]],
    [["target", "cCompiler", "version"], "12.0.0", ["cli"]],
    [["toolchain", "bunVersion"], "1.3.15", []],
    [["target", "dynamicDependencies"], ["libc.so.6"], []],
  ]) {
    const input = fixture(); replace(input, path, value);
    const after = verifyJoin(input);
    for (const kind of ["cli", "skill", "source"]) assert.equal(fileBytes(after, kind).equals(fileBytes(before, kind)), !changed.includes(kind), path.join("."));
    assert.notDeepEqual(after.outputs.get("release-manifest.json").bytes, before.outputs.get("release-manifest.json").bytes);
  }
});

test("one version change renames all three assets and binds both BUILDs while the skill root stays fixed", () => {
  const input = fixture(); input.version = "0.2.3";
  const joined = verifyJoin(input);
  assert.deepEqual(joined.value.files.map((file) => file.name), [
    "SHA256SUMS", "aicharts-0.2.3-x86_64-unknown-linux-gnu.tar.gz",
    "aicharts-skill-0.2.3.tar.gz", "aicharts-source-0.2.3.tar.gz", "release-manifest.json",
  ]);
  assert.equal(joined.archived.cli.root, "aicharts-0.2.3-x86_64-unknown-linux-gnu");
  assert.equal(joined.archived.skill.root, "aicharts");
  assert.equal(joined.archived.source.root, "aicharts-source-0.2.3");
  assert.equal(joined.builds.cli.version, "0.2.3"); assert.equal(joined.builds.skill.version, "0.2.3");
  assert.equal(joined.manifest.tag, "cli-v0.2.3");
});

test("archived executable and BUILD tampering cannot be authorized by recomputed tar inventory", () => {
  const input = fixture(); const joined = verifyJoin(input);
  const mtime = Date.parse(input.source.commitTime) / 1000;
  const expectedBuild = buildExpectations(input, "cli");
  const originalBuildInventory = joined.inventories.cli.find((file) => file.path === "BUILD.json");
  const originalExeInventory = joined.inventories.cli.find((file) => file.path === "bin/aicharts");
  const changedBuild = good(encodeBuild({ ...expectedBuild, executableSha256: "f".repeat(64) }));
  const payloads = joined.payloads.cli.map((file) => file.path === "BUILD.json" ? { ...file, bytes: changedBuild } : file);
  const changedInventory = fileInventory(payloads);
  const archiveBytes = good(buildArchive({ root: roots(input.version).cli, mtime, caps: caps("cli"), files: payloads }));
  assert.equal(validateArchive(archiveBytes, { root: roots(input.version).cli, mtime, caps: caps("cli"), files: joined.inventories.cli }).ok, false);
  const decoded = good(validateArchive(archiveBytes, { root: roots(input.version).cli, mtime, caps: caps("cli"), files: changedInventory }));
  const downloadedBuild = decoded.files.find((file) => file.path === "BUILD.json").bytes;
  assert.equal(validateBuild(downloadedBuild, expectedBuild, changedInventory.find((file) => file.path === "BUILD.json")).error, "invalid_build");
  assert.equal(validateBuild(downloadedBuild, expectedBuild, originalBuildInventory).ok, false);
  const replacement = Buffer.from("different synthetic executable");
  const exePayloads = joined.payloads.cli.map((file) => file.path === "bin/aicharts" ? { ...file, bytes: replacement } : file);
  const exeArchive = good(buildArchive({ root: roots(input.version).cli, mtime, caps: caps("cli"), files: exePayloads }));
  assert.equal(validateArchive(exeArchive, { root: roots(input.version).cli, mtime, caps: caps("cli"), files: joined.inventories.cli }).ok, false);
  assert.notEqual(sha(replacement), originalExeInventory.sha256);
  assert.notEqual(sha(replacement), joined.builds.cli.executableSha256);
});

test("returned bytes are exact unpooled snapshots independent of inputs and every sibling result", () => {
  const input = fixture();
  const first = good(assembleLinuxRelease(input)); const second = good(assembleLinuxRelease(input));
  const saved = first.files.map((file) => Buffer.from(file.bytes));
  const inputBuffers = [...input.sourceFiles.map((file) => file.bytes), input.executableBytes, input.thirdPartyLicenseBytes];
  for (const [index, file] of first.files.entries()) {
    assert.equal(file.bytes.byteOffset, 0); assert.equal(file.bytes.buffer.byteLength, file.bytes.length);
    for (const bytes of inputBuffers) assert.notEqual(file.bytes.buffer, bytes.buffer);
    for (const other of second.files) assert.notEqual(file.bytes.buffer, other.bytes.buffer);
    for (let other = index + 1; other < first.files.length; other++) assert.notEqual(file.bytes.buffer, first.files[other].bytes.buffer);
  }
  for (const bytes of inputBuffers) bytes.fill(0);
  input.version = "999.0.0"; input.run.runId = "1"; input.sourceFiles[0].path = "changed";
  for (const [index, file] of first.files.entries()) assert.deepEqual(file.bytes, saved[index]);
  for (const [index, file] of first.files.entries()) {
    new Uint8Array(file.bytes.buffer).fill(0x7f);
    for (let other = index + 1; other < first.files.length; other++) assert.deepEqual(first.files[other].bytes, saved[other]);
    for (const [other, candidate] of second.files.entries()) assert.deepEqual(candidate.bytes, saved[other]);
  }
});

test("decorated byte subviews use intrinsic bounds without reading getters or iterators", () => {
  const baseline = good(assembleLinuxRelease(fixture())); const input = fixture(); let calls = 0;
  const decorate = (bytes) => {
    const storage = new Uint8Array(bytes.length + 16); storage.fill(0x5a); storage.set(bytes, 7);
    const view = new Uint8Array(storage.buffer, 7, bytes.length);
    for (const key of ["buffer", "byteLength", "byteOffset", "length", "toJSON", Symbol.iterator]) {
      Object.defineProperty(view, key, { get() { calls++; throw Error(CANARY); } });
    }
    return view;
  };
  for (const file of input.sourceFiles) file.bytes = decorate(file.bytes);
  input.executableBytes = decorate(input.executableBytes); input.thirdPartyLicenseBytes = decorate(input.thirdPartyLicenseBytes);
  const result = assembleLinuxRelease(input);
  assert.equal(calls, 0); assert.deepEqual(good(result), baseline);
});

test("each mandatory source mapping is required at mode 0644", () => {
  for (const path of REQUIRED) {
    const missing = fixture(); missing.sourceFiles = missing.sourceFiles.filter((file) => file.path !== path);
    rejected(assembleLinuxRelease(missing));
    const executableDoc = fixture(); selected(executableDoc, path).mode = 0o755;
    rejected(assembleLinuxRelease(executableDoc));
  }
});

test("source path, duplicate, case-fold and file/parent conflicts fail without dropping members", () => {
  const paths = ["", "/absolute", "../outside", "./relative", "a//b", "a\\b", "a b", "a%20b", "é", "a\0b", "CON", "con.txt", "a.", "a\n", "LICENSE", "license", "EXTRAS/other", "LICENSE/child", "extras/nonmandatory.txt/child", "skills"];
  for (const path of paths) {
    const input = fixture(); input.sourceFiles.push(sourceFile(path, CANARY));
    rejected(assembleLinuxRelease(input));
  }
  for (const mode of [0o600, 0o777, 0, -0, -1, 0o644 + 0.5, "0644", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const input = fixture(); input.sourceFiles.push(sourceFile("mode.txt", CANARY, mode)); rejected(assembleLinuxRelease(input));
  }
});

test("source USTAR full-path limit includes the archive root and every derived directory", () => {
  const input = fixture();
  const rootLength = roots(input.version).source.length;
  const path = `${"p".repeat(70)}/${"q".repeat(155 - rootLength - 72)}/${"r".repeat(100)}`;
  assert.equal(`${roots(input.version).source}/${path}`.length, 256);
  input.sourceFiles.push(sourceFile(path, "boundary")); verifyJoin(input);
  const tooLong = fixture(); tooLong.sourceFiles.push(sourceFile(`${path}r`, CANARY)); rejected(assembleLinuxRelease(tooLong));
  const unsplittable = fixture(); unsplittable.sourceFiles.push(sourceFile("r".repeat(101), CANARY)); rejected(assembleLinuxRelease(unsplittable));
});

test("exact metadata records reject overrides, symbols, accessors and exotic prototypes", () => {
  const locations = [[], ["source"], ["run"], ["toolchain"], ["target"], ["target", "cCompiler"], ["sourceFiles", 0]];
  for (const location of locations) {
    for (const mutate of [
      (value) => { value.extra = CANARY; },
      (value) => { value[Symbol(CANARY)] = 1; },
      (value) => { delete value[Object.keys(value)[0]]; },
      (value) => { Object.defineProperty(value, Object.keys(value)[0], { enumerable: false }); },
      (value) => { Object.setPrototypeOf(value, { inherited: CANARY }); },
    ]) {
      const input = fixture(); mutate(at(input, location)); rejected(assembleLinuxRelease(input));
    }
    const input = fixture(); const record = at(input, location); let calls = 0;
    Object.defineProperty(record, Object.keys(record)[0], { enumerable: true, get() { calls++; throw Error(CANARY); } });
    rejected(assembleLinuxRelease(input)); assert.equal(calls, 0);
  }
  for (const key of ["qualified", "verifiedRelease", "complete", "files", "manifest", "inventory", "sourceInventorySha256", "executableSha256", "cliBuild", "skillBuild", "caps", "mtime", "mapping", "cliRunner", "skillRunner", "__proto__", "toJSON"]) {
    const input = fixture(); Object.defineProperty(input, key, { enumerable: true, value: CANARY }); rejected(assembleLinuxRelease(input));
  }
  for (const key of ["cargoLockSha256", "bunLockSha256"]) {
    const input = fixture(); input.toolchain[key] = "f".repeat(64); rejected(assembleLinuxRelease(input));
  }
  for (const value of [undefined, null, true, 1, 1n, CANARY, [], new Date(), new Map(), Object.create({})]) rejected(assembleLinuxRelease(value));
});

test("top-level, nested, array and byte proxies are refused without executing traps", () => {
  let calls = 0;
  const handler = {
    get() { calls++; throw Error(CANARY); }, ownKeys() { calls++; throw Error(CANARY); },
    getPrototypeOf() { calls++; throw Error(CANARY); }, getOwnPropertyDescriptor() { calls++; throw Error(CANARY); },
  };
  for (const location of [[], ["source"], ["run"], ["toolchain"], ["target"], ["target", "cCompiler"], ["target", "dynamicDependencies"], ["sourceFiles"], ["sourceFiles", 0], ["sourceFiles", 0, "bytes"], ["executableBytes"], ["thirdPartyLicenseBytes"]]) {
    const input = fixture(); const proxy = new Proxy(at(input, location), handler);
    if (location.length === 0) rejected(assembleLinuxRelease(proxy));
    else { replace(input, location, proxy); rejected(assembleLinuxRelease(input)); }
  }
  const revoked = Proxy.revocable(fixture(), handler); revoked.revoke(); rejected(assembleLinuxRelease(revoked.proxy));
  assert.equal(calls, 0);
});

test("source and SONAME arrays must be dense ordinary data-only arrays", () => {
  for (const location of [["sourceFiles"], ["target", "dynamicDependencies"]]) {
    for (const mutate of [
      (array) => { delete array[0]; },
      (array) => { array.extra = CANARY; },
      (array) => { array[Symbol(CANARY)] = 1; },
      (array) => { Object.setPrototypeOf(array, null); },
      (array) => { Object.defineProperty(array, "0", { enumerable: false }); },
    ]) {
      const input = fixture(); mutate(at(input, location)); rejected(assembleLinuxRelease(input));
    }
    let calls = 0; const input = fixture();
    Object.defineProperty(at(input, location), "0", { enumerable: true, get() { calls++; throw Error(CANARY); } });
    rejected(assembleLinuxRelease(input)); assert.equal(calls, 0);
    const iterator = fixture();
    Object.defineProperty(at(iterator, location), Symbol.iterator, { get() { calls++; throw Error(CANARY); } });
    rejected(assembleLinuxRelease(iterator)); assert.equal(calls, 0);
    for (const value of [undefined, null, {}, "", []]) {
      const invalid = fixture(); replace(invalid, location, value); rejected(assembleLinuxRelease(invalid));
    }
  }
});

test("inherited toJSON and setters cannot replace independently supplied release facts", () => {
  const input = fixture(); const baseline = good(assembleLinuxRelease(input)); let calls = 0; let result;
  try {
    Object.defineProperty(Object.prototype, "toJSON", { configurable: true, value() { calls++; return CANARY; } });
    Object.defineProperty(Array.prototype, "toJSON", { configurable: true, value() { calls++; return CANARY; } });
    Object.defineProperty(Object.prototype, "version", { configurable: true, get() { calls++; return CANARY; }, set() { calls++; } });
    result = assembleLinuxRelease(input);
  } finally {
    delete Object.prototype.toJSON; delete Array.prototype.toJSON; delete Object.prototype.version;
  }
  assert.equal(calls, 0); assert.deepEqual(good(result), baseline);
});

test("inherited descriptor values do not turn caller accessors into data", () => {
  const input = fixture(); let calls = 0; let result;
  Object.defineProperty(input.run, "runId", { enumerable: true, get() { calls++; return CANARY; } });
  try {
    Object.defineProperty(Object.prototype, "value", { configurable: true, value: "1" });
    result = assembleLinuxRelease(input);
  } finally { delete Object.prototype.value; }
  rejected(result); assert.equal(calls, 0);
});

test("payload byte fields reject non-byte, shared, resizable, detached and proxied storage", () => {
  const invalidBytes = () => {
    const backing = new ArrayBuffer(8); const detached = new Uint8Array(backing);
    structuredClone(backing, { transfer: [backing] });
    return [undefined, null, true, 1, CANARY, [], new ArrayBuffer(8), new DataView(new ArrayBuffer(8)), new Uint16Array(8),
      new Uint8Array(new SharedArrayBuffer(8)), new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 })), detached];
  };
  for (const location of [["sourceFiles", 0, "bytes"], ["executableBytes"], ["thirdPartyLicenseBytes"]]) {
    for (const bytes of invalidBytes()) {
      const input = fixture(); replace(input, location, bytes); rejected(assembleLinuxRelease(input));
    }
  }
});

test("fixed Linux, Rust and Node policy does not accept broader codec-compatible values", () => {
  for (const [path, values] of [
    [["toolchain", "rustChannel"], ["1.98.0", "1.97.0", "0.0.0", "stable", "1.97.1\n", null]],
    [["toolchain", "nodeMajor"], [22, 25, "24", 24n, -0, NaN, Infinity]],
    [["target", "triple"], ["aarch64-unknown-linux-gnu", "x86_64-unknown-linux-musl", null]],
    [["target", "os"], ["darwin", "Linux", null]],
    [["target", "arch"], ["arm64", "amd64", null]],
    [["target", "osFloor"], ["ubuntu-24.04", "ubuntu-latest", null]],
    [["target", "libcFloor"], ["glibc-2.36", "musl", null]],
    [["target", "cpuBaseline"], ["native", "x86-64-v3", null]],
    [["target", "runnerLabel"], ["ubuntu-latest", "macos-15", null]],
    [["target", "cCompiler", "name"], ["cc", "GCC", "gcc -O3", null]],
  ]) for (const value of values) {
    const input = fixture(); replace(input, path, value); rejected(assembleLinuxRelease(input));
  }
});

test("canonical version, identity, runner and UTC scalar bounds are enforced without coercion", () => {
  const invalidVersions = ["", "v1.2.3", "01.2.3", "1.02.3", "1.2.03", "1.2", "1.2.3.4", "1.2.3-beta", "1.2.3+metadata", "1000000000.0.0", 1, 1n, null];
  for (const path of [["version"], ["toolchain", "bunVersion"], ["target", "cCompiler", "version"]]) {
    for (const value of invalidVersions) { const input = fixture(); replace(input, path, value); rejected(assembleLinuxRelease(input)); }
  }
  for (const path of [["source", "commit"], ["source", "tree"]]) {
    for (const value of ["F".repeat(40), "a".repeat(39), "a".repeat(41), "g".repeat(40), 1, null]) {
      const input = fixture(); replace(input, path, value); rejected(assembleLinuxRelease(input));
    }
  }
  for (const value of ["0", "01", "-1", "+1", "1e1", "1.0", "1".repeat(21), 1, 1n, null]) {
    const input = fixture(); input.run.runId = value; rejected(assembleLinuxRelease(input));
  }
  for (const value of [-0, 0, -1, 1.1, NaN, Infinity, 1_000_001, Number.MAX_SAFE_INTEGER + 1, "1", 1n]) {
    const input = fixture(); input.run.runAttempt = value; rejected(assembleLinuxRelease(input));
  }
  for (const value of ["", "01", "1.02", "1.", "1.2.3.4.5", "1".repeat(49), "latest", 1, null]) {
    const input = fixture(); input.target.runnerImageVersion = value; rejected(assembleLinuxRelease(input));
  }
  for (const value of ["1969-12-31T23:59:59Z", "2026-02-30T00:00:00Z", "2025-02-29T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:00:60Z", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00+00:00", "2026-1-01T00:00:00Z", "2026-01-01", "9999-12-31T23:59:59Z", 0, null]) {
    const input = fixture(); input.source.commitTime = value; rejected(assembleLinuxRelease(input));
  }
  for (const path of [["version"], ["source", "commit"], ["source", "tree"], ["source", "commitTime"], ["run", "runId"], ["toolchain", "rustChannel"], ["toolchain", "bunVersion"], ["target", "runnerImageVersion"], ["target", "cCompiler", "version"]]) {
    for (const suffix of ["\n", "\r", "\r\n", "\u2028", "\u2029", "é", "١"]) {
      const input = fixture(); replace(input, path, at(input, path) + suffix); rejected(assembleLinuxRelease(input));
    }
  }
});

test("first and last valid canonical scalar bounds preserve exact run identity and mtime", () => {
  for (const seconds of [0, 8_589_934_591]) {
    const input = fixture();
    input.source.commitTime = new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
    input.source.commit = "0".repeat(40); input.source.tree = "0".repeat(40);
    input.version = "999999999.999999999.999999999";
    input.toolchain.bunVersion = "0.0.0";
    input.target.cCompiler.version = input.version;
    input.target.runnerImageVersion = "1".repeat(48);
    input.run.runId = "9".repeat(20); input.run.runAttempt = 1_000_000;
    const joined = verifyJoin(input);
    assert.equal(joined.builds.cli.runner.runId, "9".repeat(20));
    assert.equal(joined.archived.source.mtime, seconds);
  }
  const excessive = fixture(); excessive.source.commitTime = new Date(8_589_934_592 * 1000).toISOString().replace(".000Z", "Z");
  rejected(assembleLinuxRelease(excessive));
});

test("SONAMEs stay sorted, distinct, bounded and nonempty rather than implying static support", () => {
  for (const dependencies of [[], ["libgcc_s.so.1", "libc.so.6"], ["libc.so.6", "libc.so.6"], ["LIBC.so.6", "libc.so.6"], ["../libc.so.6"], ["/lib/libc.so.6"], ["libc.so.6\n"], ["lib c.so"], ["libc.dylib"], ["libc.so.01x"], ["a".repeat(126) + ".so"], [1], [null]]) {
    const input = fixture(); input.target.dynamicDependencies = dependencies; rejected(assembleLinuxRelease(input));
  }
  const bounded = fixture(); bounded.target.dynamicDependencies = Array.from({ length: 16 }, (_, index) => `lib${String(index).padStart(2, "0")}.so.1`);
  verifyJoin(bounded);
  bounded.target.dynamicDependencies.push("lib16.so.1"); rejected(assembleLinuxRelease(bounded));
  const long = fixture(); long.target.dynamicDependencies = ["a".repeat(125) + ".so"]; verifyJoin(long);
});

test("source count includes all supplied entries and refuses the first excess before payload work", () => {
  const input = fixture();
  while (input.sourceFiles.length < 2048) input.sourceFiles.push(sourceFile(`count/f${String(input.sourceFiles.length).padStart(4, "0")}`, ""));
  assert.equal(verifyJoin(input).archived.source.files.length, 2048);
  input.sourceFiles.push(sourceFile("count/excess", CANARY));
  rejected(assembleLinuxRelease(input), "limit_exceeded");
});

function sourceEntryCount(input) {
  const entries = new Set([roots(input.version).source]);
  for (const file of input.sourceFiles) {
    let path = roots(input.version).source;
    for (const part of file.path.split("/")) { path += `/${part}`; entries.add(path); }
  }
  return entries.size;
}

test("derived source directory headers share the fixed 8192-entry budget", () => {
  const input = fixture(); let index = 0; let entryCount = sourceEntryCount(input);
  // Each unique branch contributes four directories and one empty regular file.
  while (entryCount + 5 <= 8192) {
    input.sourceFiles.push(sourceFile(`tree${index++}/a/b/c/f`, "")); entryCount += 5;
  }
  const remaining = 8192 - entryCount;
  if (remaining) input.sourceFiles.push(sourceFile([...Array.from({ length: remaining - 1 }, (_, n) => `tail${n}`), "last"].join("/"), ""));
  assert.equal(sourceEntryCount(input), 8192); assert.ok(input.sourceFiles.length <= 2048);
  verifyJoin(input);
  input.sourceFiles.push(sourceFile("one-more-entry", CANARY));
  rejected(assembleLinuxRelease(input), "limit_exceeded");
});

test("aggregate source and skill body ceilings preflight reused modest views", () => {
  const source = fixture(); const megabyte = Buffer.alloc(1024 * 1024, 0x5a);
  for (let index = 0; index < 65; index++) source.sourceFiles.push({ path: `bodies/f${index}`, mode: 0o644, bytes: megabyte });
  rejected(assembleLinuxRelease(source), "limit_exceeded");
  const skill = fixture(); const modest = Buffer.alloc(800_000, 0x5a);
  for (const file of skill.sourceFiles) if (file.path.startsWith("skills/aicharts/")) file.bytes = modest;
  rejected(assembleLinuxRelease(skill), "limit_exceeded");
});

test("real generated BUILD and padded tar layout cannot fit at the raw skill body ceiling", () => {
  const input = fixture();
  const selectedPaths = ["LICENSE", "distribution/NOTICE.md", ...REQUIRED.filter((path) => path.startsWith("skills/aicharts/"))];
  const largePath = "skills/aicharts/SKILL.md";
  const otherBytes = selectedPaths.filter((path) => path !== largePath).reduce((sum, path) => sum + selected(input, path).bytes.length, 0);
  selected(input, largePath).bytes = Buffer.alloc(4 * 1024 * 1024 - otherBytes, 0x5a);
  assert.equal(selectedPaths.reduce((sum, path) => sum + selected(input, path).bytes.length, 0), 4 * 1024 * 1024);
  rejected(assembleLinuxRelease(input), "limit_exceeded");
});

test("seeded small-source joins preserve determinism, source ordering and byte-derived bindings", () => {
  let state = 0x31a2b495;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  for (let iteration = 0; iteration < 16; iteration++) {
    const input = fixture();
    input.version = `0.${next() % 100}.${next() % 1000}`;
    input.run.runId = String(BigInt(next()) + 9_007_199_254_740_993n);
    input.run.runAttempt = 1 + next() % 100;
    input.executableBytes = Buffer.from(`synthetic executable ${next()} ${iteration}`);
    const body = Buffer.alloc(1 + next() % 1000);
    for (let i = 0; i < body.length; i++) body[i] = next() & 0xff;
    input.sourceFiles.push({ path: `seeded/case-${iteration}.txt`, mode: iteration % 2 ? 0o755 : 0o644, bytes: body });
    const before = verifyJoin(input);
    for (let i = input.sourceFiles.length - 1; i > 0; i--) {
      const j = next() % (i + 1); [input.sourceFiles[i], input.sourceFiles[j]] = [input.sourceFiles[j], input.sourceFiles[i]];
    }
    assert.deepEqual(good(assembleLinuxRelease(input)), before.value);
  }
});
