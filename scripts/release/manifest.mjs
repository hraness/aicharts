// Isolated exact-manifest matcher candidate. No filesystem or provider actions.
import { createHash } from "node:crypto";
import { types } from "node:util";

const MAX_MANIFEST = 1024 * 1024;
const MAX_SUMS = 4096;
const MAX_BUILD = 16 * 1024;
const MAX_ENTRIES = 8192;
const MAX_RATIO = 4096;
const TRIPLE = "x86_64-unknown-linux-gnu";
const REPOSITORY = "hraness/aicharts";
const PROFILE = "linux-skill-v1";
const WORKFLOW = ".github/workflows/cli-release.yml";
const VERSION = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const CLI_FILES = Object.freeze(["BUILD.json", "LICENSE", "NOTICE.md", "THIRD_PARTY_LICENSES.txt", "bin/aicharts", "docs/usage-install.md", "docs/usage-local.md"]);
const SKILL_FILES = Object.freeze(["BUILD.json", "LICENSE", "NOTICE.md", "SKILL.md", "agents/openai.yaml", "references/benchmarks.md", "references/local-usage.md", "scripts/atlas.check.mjs", "scripts/atlas.mjs"]);
const DISABLED = Object.freeze(["authentication", "enrollment", "upload", "backgroundCollection", "nativeCustody", "autoUpdate"]);
const LIMITS = Object.freeze({
  cli: Object.freeze({ compressed: 64 * 1024 * 1024, expanded: 128 * 1024 * 1024, files: 16 }),
  skill: Object.freeze({ compressed: 1024 * 1024, expanded: 4 * 1024 * 1024, files: 16 }),
  source: Object.freeze({ compressed: 32 * 1024 * 1024, expanded: 64 * 1024 * 1024, files: 2048 }),
});
const ERRORS = new Map(["invalid_expectations", "invalid_manifest", "invalid_checksums", "limit_exceeded"].map((error) => [error, Object.freeze({ ok: false, error })]));
const ERROR_VALUES = new Set(ERRORS.values());
const fail = (code = "invalid_expectations") => { throw ERRORS.get(code); };
const caught = (error) => ERROR_VALUES.has(error) ? error : ERRORS.get("invalid_expectations");
const success = (value) => Object.freeze({ ok: true, value });
const frozen = (value) => Object.freeze(value);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const integer = (value, maximum, minimum = 0) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum && value <= maximum;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function record(value, keys) {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) fail();
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length) fail();
  const copy = Object.create(null);
  for (const key of names) {
    if (typeof key !== "string" || !keys.includes(key)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail();
    Object.defineProperty(copy, key, { value: descriptor.value, enumerable: true });
  }
  return frozen(copy);
}

function array(value, maximum, minimum = 1) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!integer(length, maximum, minimum)) fail();
  if (Reflect.ownKeys(value).length !== length + 1) fail();
  const copy = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail();
    copy.push(descriptor.value);
  }
  return copy;
}

function hash(value, length = 64) {
  if (typeof value !== "string" || value.length !== length || !/^[0-9a-f]+$/.test(value)) fail();
  return value;
}

function version(value) {
  if (typeof value !== "string" || !VERSION.test(value)) fail();
  return value;
}

function source(value) {
  const input = record(value, ["commit", "tree", "commitTime"]);
  if (typeof input.commitTime !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(input.commitTime)) fail();
  const milliseconds = Date.parse(input.commitTime);
  if (!integer(milliseconds / 1000, 0o77777777777)
    || new Date(milliseconds).toISOString() !== input.commitTime.slice(0, -1) + ".000Z") fail();
  return frozen({ commit: hash(input.commit, 40), tree: hash(input.tree, 40), commitTime: input.commitTime });
}

function toolchain(value) {
  const input = record(value, ["rustChannel", "nodeMajor", "bunVersion", "cargoLockSha256", "bunLockSha256"]);
  if (input.nodeMajor !== 24) fail();
  return frozen({ rustChannel: version(input.rustChannel), nodeMajor: 24, bunVersion: version(input.bunVersion), cargoLockSha256: hash(input.cargoLockSha256), bunLockSha256: hash(input.bunLockSha256) });
}

function target(value) {
  const input = record(value, ["triple", "os", "arch", "osFloor", "libcFloor", "cpuBaseline", "runnerLabel", "runnerImageVersion", "cCompiler", "dynamicDependencies"]);
  const policy = { triple: TRIPLE, os: "linux", arch: "x86_64", osFloor: "ubuntu-22.04", libcFloor: "glibc-2.35", cpuBaseline: "x86-64", runnerLabel: "ubuntu-22.04" };
  for (const key of Object.keys(policy)) if (input[key] !== policy[key]) fail();
  if (typeof input.runnerImageVersion !== "string" || input.runnerImageVersion.length > 48
    || !/^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}$/.test(input.runnerImageVersion)) fail();
  const compiler = record(input.cCompiler, ["name", "version"]);
  if (compiler.name !== "gcc" && compiler.name !== "clang") fail();
  const dependencies = array(input.dynamicDependencies, 16);
  let previous = "";
  const folded = new Set();
  for (const name of dependencies) {
    if (typeof name !== "string" || name.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9_+.-]*\.so(?:\.[0-9]+)*$/.test(name)
      || name <= previous || folded.has(name.toLowerCase())) fail();
    folded.add(name.toLowerCase());
    previous = name;
  }
  return frozen({ ...policy, runnerImageVersion: input.runnerImageVersion, cCompiler: frozen({ name: compiler.name, version: version(compiler.version) }), dynamicDependencies: frozen(dependencies) });
}

// Same deliberately narrow representability policy as the accepted archive
// candidate. This computes metadata only; it does not open or validate archives.
function path(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) fail();
  for (const component of value.split("/")) {
    if (!component.length || component.length > 255 || component === "." || component === ".."
      || !/^[A-Za-z0-9._@+()[\]-]+$/.test(component) || component.endsWith(".")
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component)) fail();
  }
  return value;
}

function representable(value) {
  if (value.length <= 100) return true;
  if (value.length > 256) return false;
  for (let i = value.length - 1; i > 0; i--) {
    if (value[i] === "/" && i <= 155 && value.length - i - 1 <= 100) return true;
  }
  return false;
}

function files(value, kind, root) {
  const limits = LIMITS[kind];
  const supplied = array(value, limits.files);
  const required = kind === "cli" ? CLI_FILES : kind === "skill" ? SKILL_FILES : null;
  if (required && supplied.length !== required.length) fail();
  const entries = new Map();
  const folded = new Set();
  let expandedBytes = 1024;
  function add(full, type, size) {
    if (entries.has(full)) {
      if (type === "dir" && entries.get(full) === "dir") return;
      fail();
    }
    if (!representable(full) || folded.has(full.toLowerCase())) fail();
    if (entries.size >= MAX_ENTRIES) fail("limit_exceeded");
    const increment = 512 + Math.ceil(size / 512) * 512;
    if (expandedBytes + increment > limits.expanded) fail("limit_exceeded");
    expandedBytes += increment;
    entries.set(full, type);
    folded.add(full.toLowerCase());
  }
  add(root, "dir", 0);
  const output = [];
  for (const value of supplied) {
    const input = record(value, ["path", "mode", "bytes", "sha256"]);
    const name = path(input.path);
    if (input.mode !== 0o644 && input.mode !== 0o755) fail();
    if (!integer(input.bytes, limits.expanded)) fail("limit_exceeded");
    if (required && (!required.includes(name) || input.mode !== (kind === "cli" && name === "bin/aicharts" ? 0o755 : 0o644))) fail();
    if (required && name === "BUILD.json" && input.bytes > MAX_BUILD) fail("limit_exceeded");
    const components = name.split("/");
    let parent = root;
    for (let i = 0; i < components.length - 1; i++) {
      parent += `/${components[i]}`;
      add(parent, "dir", 0);
    }
    add(`${root}/${name}`, "file", input.bytes);
    output.push(frozen({ path: name, mode: input.mode, bytes: input.bytes, sha256: hash(input.sha256) }));
  }
  output.sort((a, b) => compare(a.path, b.path));
  return frozen({ expandedBytes, files: frozen(output) });
}

function asset(value, kind, root, name, sourceFiles) {
  const input = record(value, kind === "source" ? ["bytes", "sha256"] : ["bytes", "sha256", "files"]);
  if (!integer(input.bytes, LIMITS[kind].compressed, 20)) fail("limit_exceeded");
  const inventory = files(kind === "source" ? sourceFiles : input.files, kind, root);
  if (inventory.expandedBytes > input.bytes * MAX_RATIO) fail("limit_exceeded");
  return frozen({ name, kind, target: kind === "cli" ? TRIPLE : null, bytes: input.bytes, expandedBytes: inventory.expandedBytes, sha256: hash(input.sha256), root, files: inventory.files });
}

function manifest(expected) {
  const input = record(expected, ["version", "source", "run", "toolchain", "target", "cli", "skill", "sourceArchive", "sourceFiles"]);
  const v = version(input.version);
  const selectedSource = source(input.source);
  const run = record(input.run, ["runId", "runAttempt"]);
  if (typeof run.runId !== "string" || !/^[1-9][0-9]{0,19}$/.test(run.runId) || !integer(run.runAttempt, 1_000_000, 1)) fail();
  const selectedToolchain = toolchain(input.toolchain);
  const selectedTarget = target(input.target);
  const cliRoot = `aicharts-${v}-${TRIPLE}`;
  const skillName = `aicharts-skill-${v}.tar.gz`;
  const sourceRoot = `aicharts-source-${v}`;
  const assets = [
    asset(input.cli, "cli", cliRoot, `${cliRoot}.tar.gz`),
    asset(input.skill, "skill", "aicharts", skillName),
    asset(input.sourceArchive, "source", sourceRoot, `${sourceRoot}.tar.gz`, input.sourceFiles),
  ].sort((a, b) => compare(a.name, b.name));
  return frozen({
    schemaVersion: 1,
    profile: PROFILE,
    repository: REPOSITORY,
    tag: `cli-v${v}`,
    version: v,
    source: selectedSource,
    workflow: frozen({ path: WORKFLOW, sourceRef: "refs/heads/main", sourceCommit: selectedSource.commit, runId: run.runId, runAttempt: run.runAttempt }),
    toolchain: selectedToolchain,
    targets: frozen([selectedTarget]),
    disabledCapabilities: frozen([...DISABLED]),
    assets: frozen(assets),
  });
}

const ta = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(ta, "byteLength").get;
const byteOffset = Object.getOwnPropertyDescriptor(ta, "byteOffset").get;
const backing = Object.getOwnPropertyDescriptor(ta, "buffer").get;
const abLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
const abResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;

function copyBytes(value, maximum, code) {
  try {
    if (types.isProxy(value) || !types.isUint8Array(value)) fail(code);
    const length = byteLength.call(value);
    if (length > maximum) fail("limit_exceeded");
    const buffer = backing.call(value);
    abLength.call(buffer);
    if (abResizable?.call(buffer)) fail(code);
    const view = new Uint8Array(buffer, byteOffset.call(value), length);
    const owned = Buffer.alloc(length);
    Uint8Array.prototype.set.call(owned, view);
    return owned;
  } catch (error) {
    if (ERROR_VALUES.has(error)) throw error;
    fail(code);
  }
}

function utf8(text, maximum) {
  const length = Buffer.byteLength(text, "utf8");
  if (length > maximum) fail("limit_exceeded");
  const bytes = Buffer.alloc(length);
  bytes.write(text, "utf8");
  return bytes;
}

// Serialize only our already validated, owned graph. In particular, do not let
// an inherited Object/Array.prototype.toJSON replace provenance fields.
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
}

function encoded(value) {
  return utf8(canonical(value) + "\n", MAX_MANIFEST);
}

function matched(inputBytes, expectations) {
  const bytes = copyBytes(inputBytes, MAX_MANIFEST, "invalid_manifest");
  const value = manifest(expectations);
  // All canonical fields are constrained ASCII. Exact equality accepts only
  // this valid UTF-8/JSON spelling, rejecting duplicate/unknown keys, BOM,
  // malformed UTF-8, alternate numbers, whitespace and escapes. It is NOT a
  // general parser for a manifest whose full independent inventory is unknown.
  if (!bytes.equals(encoded(value))) fail("invalid_manifest");
  return { bytes, value };
}

function sums(manifestBytes, expectations) {
  const checked = matched(manifestBytes, expectations);
  const entries = checked.value.assets.map((asset) => frozen({ name: asset.name, sha256: asset.sha256 }));
  entries.push(frozen({ name: "release-manifest.json", sha256: digest(checked.bytes) }));
  entries.sort((a, b) => compare(a.name, b.name));
  const bytes = utf8(entries.map((entry) => `${entry.sha256}  ${entry.name}\n`).join(""), MAX_SUMS);
  return { bytes, value: frozen({ entries: frozen(entries) }) };
}

/** Encode a fixed-profile DTO derived solely from independent expectations. */
export function encodeManifest(expectations) {
  try { return success(encoded(manifest(expectations))); } catch (error) { return caught(error); }
}

/** Exact canonical manifest matcher, not an authenticated downloaded parser. */
export function parseManifest(bytes, expectations) {
  try { return success(matched(bytes, expectations).value); } catch (error) { return caught(error); }
}

/** Four subjects only: three archives and raw canonical manifest bytes. */
export function encodeChecksums(manifestBytes, expectations) {
  try { return success(sums(manifestBytes, expectations).bytes); } catch (error) { return caught(error); }
}

/** Match canonical sorted SHA256SUMS before returning any owned records. */
export function parseChecksums(bytes, manifestBytes, expectations) {
  try {
    const owned = copyBytes(bytes, MAX_SUMS, "invalid_checksums");
    const expected = sums(manifestBytes, expectations);
    if (!owned.equals(expected.bytes)) fail("invalid_checksums");
    return success(expected.value);
  } catch (error) { return caught(error); }
}
