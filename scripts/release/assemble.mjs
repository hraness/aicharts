// Pure fixed-profile release assembly. Inputs are independently supplied facts,
// not authentication. No filesystem, process, environment or network lookups.
import { createHash } from "node:crypto";
import { types } from "node:util";
import { buildArchive, validateArchive } from "./archive.mjs";
import { encodeBuild, validateBuild } from "./build.mjs";
import { encodeManifest, parseManifest, encodeChecksums, parseChecksums } from "./manifest.mjs";

const MiB = 1024 * 1024;
const CAPS = Object.freeze({
  cli: Object.freeze({ maxCompressedBytes: 64 * MiB, maxExpandedBytes: 128 * MiB, maxFileBytes: 128 * MiB, maxFiles: 16, maxEntries: 8192, maxExpansionRatio: 4096 }),
  skill: Object.freeze({ maxCompressedBytes: MiB, maxExpandedBytes: 4 * MiB, maxFileBytes: 4 * MiB, maxFiles: 16, maxEntries: 8192, maxExpansionRatio: 4096 }),
  source: Object.freeze({ maxCompressedBytes: 32 * MiB, maxExpandedBytes: 64 * MiB, maxFileBytes: 64 * MiB, maxFiles: 2048, maxEntries: 8192, maxExpansionRatio: 4096 }),
});
const CLI = Object.freeze([
  ["LICENSE", "LICENSE"], ["NOTICE.md", "distribution/NOTICE.md"],
  ["docs/usage-install.md", "distribution/cli/docs/usage-install.md"],
  ["docs/usage-local.md", "distribution/cli/docs/usage-local.md"],
].map(Object.freeze));
const SKILL = Object.freeze([
  ["LICENSE", "LICENSE"], ["NOTICE.md", "distribution/NOTICE.md"],
  ["SKILL.md", "skills/aicharts/SKILL.md"],
  ["agents/openai.yaml", "skills/aicharts/agents/openai.yaml"],
  ["references/benchmarks.md", "skills/aicharts/references/benchmarks.md"],
  ["references/local-usage.md", "skills/aicharts/references/local-usage.md"],
  ["scripts/atlas.mjs", "skills/aicharts/scripts/atlas.mjs"],
  ["scripts/atlas.check.mjs", "skills/aicharts/scripts/atlas.check.mjs"],
].map(Object.freeze));
const REQUIRED = Object.freeze([...new Set([
  "Cargo.lock", "bun.lock", "Cargo.toml", "crates/aicharts-cli/Cargo.toml",
  "rust-toolchain.toml", "LICENSE", "NOTICE.md",
  ...CLI.map((entry) => entry[1]), ...SKILL.map((entry) => entry[1]),
])]);
const ERRORS = new Map(["invalid_input", "invalid_source", "invalid_binding", "limit_exceeded", "assembly_failed"]
  .map((error) => [error, Object.freeze({ ok: false, error })]));
const ERROR_VALUES = new Set(ERRORS.values());
const fail = (code = "invalid_input") => { throw ERRORS.get(code); };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safe = (n, max, min = 0) => Number.isSafeInteger(n) && !Object.is(n, -0) && n >= min && n <= max;
function add(total, next, cap) {
  if (!safe(next, cap) || total > cap - next) fail("limit_exceeded");
  return total + next;
}
function record(value, keys, error = "invalid_input") {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail(error);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) fail(error);
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length) fail(error);
  const out = Object.create(null);
  for (const key of names) {
    if (typeof key !== "string" || !keys.includes(key)) fail(error);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail(error);
    Object.defineProperty(out, key, { value: descriptor.value, enumerable: true });
  }
  return Object.freeze(out);
}
function array(value, maximum) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!safe(length, maximum, 1)) {
    if (Number.isSafeInteger(length) && length > maximum) fail("limit_exceeded");
    fail();
  }
  if (Reflect.ownKeys(value).length !== length + 1) fail();
  const out = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail();
    out.push(descriptor.value);
  }
  return out;
}
function version(value) {
  if (typeof value !== "string" || value.length > 29 || !/^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/.test(value)) fail();
  return value;
}
function hex(value, size) {
  if (typeof value !== "string" || value.length !== size || !/^[0-9a-f]+$/.test(value)) fail();
  return value;
}
function facts(input) {
  const source = record(input.source, ["commit", "tree", "commitTime"]);
  if (typeof source.commitTime !== "string" || source.commitTime.length !== 20
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(source.commitTime)) fail();
  const mtime = Date.parse(source.commitTime) / 1000;
  if (!safe(mtime, 0o77777777777) || new Date(mtime * 1000).toISOString() !== source.commitTime.slice(0, -1) + ".000Z") fail();
  const run = record(input.run, ["runId", "runAttempt"]);
  if (typeof run.runId !== "string" || !/^[1-9][0-9]{0,19}$/.test(run.runId) || !safe(run.runAttempt, 1_000_000, 1)) fail();
  const toolchain = record(input.toolchain, ["rustChannel", "nodeMajor", "bunVersion"]);
  if (toolchain.rustChannel !== "1.97.1" || toolchain.nodeMajor !== 24) fail("invalid_binding");
  const target = record(input.target, ["triple", "os", "arch", "osFloor", "libcFloor", "cpuBaseline", "runnerLabel", "runnerImageVersion", "cCompiler", "dynamicDependencies"]);
  const policy = { triple: "x86_64-unknown-linux-gnu", os: "linux", arch: "x86_64", osFloor: "ubuntu-22.04", libcFloor: "glibc-2.35", cpuBaseline: "x86-64", runnerLabel: "ubuntu-22.04" };
  for (const [key, value] of Object.entries(policy)) if (target[key] !== value) fail("invalid_binding");
  if (typeof target.runnerImageVersion !== "string" || target.runnerImageVersion.length > 48
    || !/^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}$/.test(target.runnerImageVersion)) fail();
  const compiler = record(target.cCompiler, ["name", "version"]);
  if (compiler.name !== "gcc" && compiler.name !== "clang") fail();
  const dependencies = array(target.dynamicDependencies, 16);
  const folded = new Set();
  let previous = "";
  for (const dependency of dependencies) {
    if (typeof dependency !== "string" || dependency.length > 128
      || !/^[A-Za-z0-9][A-Za-z0-9_+.-]*\.so(?:\.[0-9]+)*$/.test(dependency)
      || dependency <= previous || folded.has(dependency.toLowerCase())) fail();
    previous = dependency;
    folded.add(dependency.toLowerCase());
  }
  return Object.freeze({
    version: version(input.version), mtime,
    source: Object.freeze({ commit: hex(source.commit, 40), tree: hex(source.tree, 40), commitTime: source.commitTime }),
    run, toolchain: Object.freeze({ rustChannel: "1.97.1", nodeMajor: 24, bunVersion: version(toolchain.bunVersion) }),
    target: Object.freeze({ ...policy, runnerImageVersion: target.runnerImageVersion,
      cCompiler: Object.freeze({ name: compiler.name, version: version(compiler.version) }),
      dynamicDependencies: Object.freeze(dependencies) }),
  });
}
function sourcePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) fail("invalid_source");
  for (const component of value.split("/")) {
    if (!component.length || component.length > 255 || component === "." || component === ".."
      || !/^[A-Za-z0-9._@+()[\]-]+$/.test(component) || component.endsWith(".")
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component)) fail("invalid_source");
  }
  return value;
}
function representable(value) {
  if (value.length <= 100) return true;
  if (value.length > 256) return false;
  for (let index = value.length - 1; index > 0; index--) {
    if (value[index] === "/" && index <= 155 && value.length - index - 1 <= 100) return true;
  }
  return false;
}
// Metadata-only name planning: no invented BUILD lengths or archive hashes.
function names(root, paths) {
  const entries = new Map(), folded = new Set();
  function insert(full, type) {
    if (entries.has(full)) {
      if (type === "dir" && entries.get(full) === "dir") return;
      fail("invalid_source");
    }
    if (!representable(full) || folded.has(full.toLowerCase())) fail("invalid_source");
    if (entries.size >= 8192) fail("limit_exceeded");
    entries.set(full, type); folded.add(full.toLowerCase());
  }
  insert(root, "dir");
  for (const path of paths) {
    const components = sourcePath(path).split("/");
    let parent = root;
    for (let index = 0; index < components.length - 1; index++) {
      parent += "/" + components[index]; insert(parent, "dir");
    }
    insert(root + "/" + path, "file");
  }
  return entries.size;
}
function layout(root, files, caps) {
  if (files.length > caps.maxFiles) fail("limit_exceeded");
  let total = add(1024, names(root, files.map((file) => file.path)) * 512, caps.maxExpandedBytes);
  for (const file of files) total = add(total, Math.ceil(file.bytes.length / 512) * 512, caps.maxExpandedBytes);
  return total;
}
const ta = Object.getPrototypeOf(Uint8Array.prototype);
const getLength = Object.getOwnPropertyDescriptor(ta, "byteLength").get;
const getOffset = Object.getOwnPropertyDescriptor(ta, "byteOffset").get;
const getBacking = Object.getOwnPropertyDescriptor(ta, "buffer").get;
const abLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
const abResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
function view(value, maximum, minimum = 0) {
  if (types.isProxy(value) || !types.isUint8Array(value)) fail();
  const length = getLength.call(value);
  if (length > maximum) fail("limit_exceeded");
  if (length < minimum) fail();
  const backing = getBacking.call(value);
  abLength.call(backing);
  if (abResizable?.call(backing)) fail();
  return new Uint8Array(backing, getOffset.call(value), length);
}
function copy(view) {
  const out = Buffer.alloc(view.length);
  Uint8Array.prototype.set.call(out, view);
  return out;
}
function checked(result) {
  if (!result.ok) fail(result.error === "limit_exceeded" ? "limit_exceeded" : "assembly_failed");
  return result.value;
}
function inventory(files) {
  return files.map((file) => Object.freeze({
    path: file.path, mode: file.mode, bytes: file.bytes.length, sha256: hash(file.bytes),
  })).sort((a, b) => compare(a.path, b.path));
}
function buildFacts(selected, kind, cargoLockSha256, executableSha256) {
  const cli = kind === "cli";
  return {
    kind, version: selected.version, sourceCommit: selected.source.commit, sourceTree: selected.source.tree,
    toolchain: { rustChannel: cli ? selected.toolchain.rustChannel : null,
      cargoLockSha256: cli ? cargoLockSha256 : null, nodeMajor: 24, cCompiler: cli ? selected.target.cCompiler : null },
    runner: { label: selected.target.runnerLabel, imageVersion: selected.target.runnerImageVersion,
      runId: selected.run.runId, runAttempt: selected.run.runAttempt },
    executableSha256: cli ? executableSha256 : null,
  };
}
function pack(root, files, caps, mtime, expectedBuild, executableSha256) {
  const expected = inventory(files);
  const bytes = checked(buildArchive({ root, mtime, caps, files }));
  const decoded = checked(validateArchive(bytes, { root, mtime, caps, files: expected }));
  if (expectedBuild) {
    const build = decoded.files.find((file) => file.path === "BUILD.json");
    const buildInventory = expected.find((file) => file.path === "BUILD.json");
    checked(validateBuild(build.bytes, expectedBuild, buildInventory));
    if (executableSha256 !== null) {
      const binary = decoded.files.find((file) => file.path === "bin/aicharts");
      const binaryInventory = expected.find((file) => file.path === "bin/aicharts");
      if (hash(binary.bytes) !== executableSha256 || binaryInventory.sha256 !== executableSha256
        || expectedBuild.executableSha256 !== executableSha256) fail("invalid_binding");
    }
  }
  return { bytes, asset: { bytes: bytes.length, sha256: hash(bytes), files: expected } };
}

/** Assemble exactly five owned files; never extract, execute, qualify or publish. */
export function assembleLinuxRelease(value) {
  try {
    const input = record(value, ["version", "source", "run", "toolchain", "target", "sourceFiles", "executableBytes", "thirdPartyLicenseBytes"]);
    const selected = facts(input);
    const roots = { cli: "aicharts-" + selected.version + "-x86_64-unknown-linux-gnu",
      skill: "aicharts", source: "aicharts-source-" + selected.version };
    const inputs = array(input.sourceFiles, 2048);
    const selectedFiles = new Map();
    let sourceBodyBytes = 0;
    for (const entry of inputs) {
      const file = record(entry, ["path", "mode", "bytes"], "invalid_source");
      const path = sourcePath(file.path);
      if (selectedFiles.has(path) || (file.mode !== 0o644 && file.mode !== 0o755)) fail("invalid_source");
      const bytes = view(file.bytes, CAPS.source.maxFileBytes);
      sourceBodyBytes = add(sourceBodyBytes, bytes.length, CAPS.source.maxExpandedBytes);
      selectedFiles.set(path, { path, mode: file.mode, bytes });
    }
    for (const path of REQUIRED) if (!selectedFiles.has(path) || selectedFiles.get(path).mode !== 0o644) fail("invalid_source");
    const executable = view(input.executableBytes, CAPS.cli.maxFileBytes, 1);
    const notices = view(input.thirdPartyLicenseBytes, CAPS.cli.maxFileBytes, 1);
    let cliBodyBytes = add(executable.length, notices.length, CAPS.cli.maxExpandedBytes);
    for (const mapping of CLI) cliBodyBytes = add(cliBodyBytes, selectedFiles.get(mapping[1]).bytes.length, CAPS.cli.maxExpandedBytes);
    let skillBodyBytes = 0;
    for (const mapping of SKILL) skillBodyBytes = add(skillBodyBytes, selectedFiles.get(mapping[1]).bytes.length, CAPS.skill.maxExpandedBytes);
    names(roots.source, [...selectedFiles.keys()]);
    names(roots.cli, ["bin/aicharts", "BUILD.json", "THIRD_PARTY_LICENSES.txt", ...CLI.map((entry) => entry[0])]);
    names(roots.skill, ["BUILD.json", ...SKILL.map((entry) => entry[0])]);
    // No large body copies precede the aggregate byte/name/mode/count checks.
    const sourceFiles = [...selectedFiles.values()].map((file) => ({ path: file.path, mode: file.mode, bytes: copy(file.bytes) }));
    const owned = new Map(sourceFiles.map((file) => [file.path, file]));
    const binary = copy(executable), licenses = copy(notices);
    const executableSha256 = hash(binary), cargoLockSha256 = hash(owned.get("Cargo.lock").bytes);
    const bunLockSha256 = hash(owned.get("bun.lock").bytes);
    const cliFacts = buildFacts(selected, "cli", cargoLockSha256, executableSha256);
    const skillFacts = buildFacts(selected, "skill", cargoLockSha256, executableSha256);
    const cliBuild = checked(encodeBuild(cliFacts)), skillBuild = checked(encodeBuild(skillFacts));
    const buildFile = (bytes) => ({ path: "BUILD.json", mode: 0o644, bytes });
    checked(validateBuild(cliBuild, cliFacts, inventory([buildFile(cliBuild)])[0]));
    checked(validateBuild(skillBuild, skillFacts, inventory([buildFile(skillBuild)])[0]));
    const mapped = (mapping) => mapping.map(([path, source]) => ({ path, mode: 0o644, bytes: owned.get(source).bytes }));
    const cliFiles = [buildFile(cliBuild), { path: "bin/aicharts", mode: 0o755, bytes: binary },
      { path: "THIRD_PARTY_LICENSES.txt", mode: 0o644, bytes: licenses }, ...mapped(CLI)];
    const skillFiles = [buildFile(skillBuild), ...mapped(SKILL)];
    // Real BUILD bytes now exist: validate ALL exact layouts before compression.
    layout(roots.source, sourceFiles, CAPS.source);
    layout(roots.cli, cliFiles, CAPS.cli);
    layout(roots.skill, skillFiles, CAPS.skill);
    const cli = pack(roots.cli, cliFiles, CAPS.cli, selected.mtime, cliFacts, executableSha256);
    const skill = pack(roots.skill, skillFiles, CAPS.skill, selected.mtime, skillFacts, null);
    const source = pack(roots.source, sourceFiles, CAPS.source, selected.mtime, null, null);
    const expectations = {
      version: selected.version, source: selected.source, run: selected.run,
      toolchain: { ...selected.toolchain, cargoLockSha256, bunLockSha256 }, target: selected.target,
      cli: cli.asset, skill: skill.asset, sourceArchive: { bytes: source.bytes.length, sha256: hash(source.bytes) },
      sourceFiles: source.asset.files,
    };
    const manifest = checked(encodeManifest(expectations));
    checked(parseManifest(manifest, expectations));
    const sums = checked(encodeChecksums(manifest, expectations));
    checked(parseChecksums(sums, manifest, expectations));
    const files = [
      { name: roots.cli + ".tar.gz", bytes: cli.bytes },
      { name: "aicharts-skill-" + selected.version + ".tar.gz", bytes: skill.bytes },
      { name: roots.source + ".tar.gz", bytes: source.bytes },
      { name: "release-manifest.json", bytes: manifest }, { name: "SHA256SUMS", bytes: sums },
    ].sort((a, b) => compare(a.name, b.name)).map((file) => Object.freeze({ ...file, sha256: hash(file.bytes) }));
    return Object.freeze({ ok: true, value: Object.freeze({ files: Object.freeze(files) }) });
  } catch (error) {
    return ERROR_VALUES.has(error) ? error : ERRORS.get("invalid_input");
  }
}
