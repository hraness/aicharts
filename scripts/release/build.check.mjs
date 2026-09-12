import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { encodeBuild, validateBuild } from "./build.mjs";
import { buildArchive, validateArchive } from "./archive.mjs";
import { encodeManifest, parseManifest } from "./manifest.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fixture = (kind = "cli") => ({
  kind, version: "0.1.0", sourceCommit: "1".repeat(40), sourceTree: "2".repeat(40),
  toolchain: { rustChannel: kind === "cli" ? "1.97.1" : null, cargoLockSha256: kind === "cli" ? "3".repeat(64) : null, nodeMajor: 24, cCompiler: kind === "cli" ? { name: "gcc", version: "11.4.0" } : null },
  runner: { label: "ubuntu-22.04", imageVersion: "20260907.12.1", runId: "9007199254740993", runAttempt: 1 },
  executableSha256: kind === "cli" ? "4".repeat(64) : null,
});
const inventory = (bytes) => ({ path: "BUILD.json", mode: 0o644, bytes: bytes.length, sha256: sha(bytes) });
const good = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const reject = (result, error) => {
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result), ["ok", "error"]);
  assert.match(result.error, /^(invalid_expectations|invalid_build|invalid_inventory|limit_exceeded)$/);
  if (error) assert.equal(result.error, error);
  assert.ok(Object.isFrozen(result));
};
const json = (value) => Buffer.from(JSON.stringify(value) + "\n");
const clone = (value) => structuredClone(value);
const expectedDto = (e) => ({
  schemaVersion: 1, kind: e.kind, repository: "hraness/aicharts", version: e.version,
  sourceCommit: e.sourceCommit, sourceTree: e.sourceTree,
  target: e.kind === "cli" ? "x86_64-unknown-linux-gnu" : null,
  os: e.kind === "cli" ? "linux" : null, arch: e.kind === "cli" ? "x86_64" : null,
  toolchain: e.toolchain, runner: e.runner, executableSha256: e.executableSha256,
});
const deepFrozen = (value) => {
  if (value && typeof value === "object") {
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) deepFrozen(child);
  }
};

for (const kind of ["cli", "skill"]) test(`canonical ${kind} has exact common keys, nulls and independently bound inventory`, () => {
  const expected = fixture(kind);
  const bytes = good(encodeBuild(expected));
  assert.deepEqual(bytes, json(expectedDto(expected)));
  const result = validateBuild(bytes, expected, inventory(bytes));
  const parsed = good(result);
  assert.deepEqual(parsed, expectedDto(expected));
  assert.deepEqual(Object.keys(parsed), ["schemaVersion", "kind", "repository", "version", "sourceCommit", "sourceTree", "target", "os", "arch", "toolchain", "runner", "executableSha256"]);
  assert.deepEqual(Object.keys(parsed.toolchain), ["rustChannel", "cargoLockSha256", "nodeMajor", "cCompiler"]);
  assert.deepEqual(Object.keys(parsed.runner), ["label", "imageVersion", "runId", "runAttempt"]);
  assert.equal(parsed.runner.runId, "9007199254740993");
  assert.deepEqual(good(encodeBuild(expected)), bytes);
  deepFrozen(result);
});

test("a malformed body stays rejected when its attacker-controlled inventory hash is recomputed", () => {
  const expected = fixture();
  const bytes = json({ ...expectedDto(expected), sourceCommit: "a".repeat(40) });
  reject(validateBuild(bytes, expected, inventory(bytes)), "invalid_build");
});

test("every independently supplied scalar is load-bearing across valid release identities", () => {
  const changes = [
    (e) => { e.version = "0.1.1"; }, (e) => { e.sourceCommit = "a".repeat(40); },
    (e) => { e.sourceTree = "b".repeat(40); }, (e) => { e.executableSha256 = "c".repeat(64); },
    (e) => { e.toolchain.rustChannel = "1.98.0"; }, (e) => { e.toolchain.cargoLockSha256 = "d".repeat(64); },
    (e) => { e.toolchain.cCompiler.name = "clang"; }, (e) => { e.toolchain.cCompiler.version = "12.0.0"; },
    (e) => { e.runner.imageVersion = "20260908.1"; }, (e) => { e.runner.runId = "9007199254740994"; },
    (e) => { e.runner.runAttempt = 2; },
  ];
  for (const change of changes) {
    const original = fixture(); const expected = clone(original); change(expected);
    const bytes = good(encodeBuild(original));
    good(encodeBuild(expected));
    reject(validateBuild(bytes, expected, inventory(bytes)), "invalid_build");
    const mutated = good(encodeBuild(expected));
    reject(validateBuild(mutated, original, inventory(mutated)), "invalid_build");
  }
  const cli = fixture(); const skill = fixture("skill");
  for (const [first, second] of [[cli, skill], [skill, cli]]) {
    const bytes = good(encodeBuild(first)); reject(validateBuild(bytes, second, inventory(bytes)), "invalid_build");
  }
});

test("downloaded fixed fields, nonapplicable nulls and all extra keys cannot widen the body", () => {
  for (const kind of ["cli", "skill"]) {
    const expected = fixture(kind);
    for (const [key, value] of [["schemaVersion", 2], ["kind", "source"], ["repository", "attacker/aicharts"], ["target", "aarch64-apple-darwin"], ["os", "darwin"], ["arch", "aarch64"]]) {
      const dto = expectedDto(expected); dto[key] = value;
      const bytes = json(dto); reject(validateBuild(bytes, expected, inventory(bytes)), "invalid_build");
    }
    for (const key of ["selfSha256", "archiveSha256", "manifestSha256", "verified", "qualified", "flags", "path", "__proto__", "constructor", "prototype", "toJSON", "caps"]) {
      const text = good(encodeBuild(expected)).toString().replace(/^{/, `{${JSON.stringify(key)}:"PRIVATE_CANARY",`);
      const bytes = Buffer.from(text); reject(validateBuild(bytes, expected, inventory(bytes)), "invalid_build");
    }
    for (const key of Object.keys(expectedDto(expected))) {
      const dto = expectedDto(expected); delete dto[key];
      const bytes = json(dto); reject(validateBuild(bytes, expected, inventory(bytes)), "invalid_build");
    }
  }
  for (const key of ["target", "os", "arch", "executableSha256"]) {
    const dto = expectedDto(fixture("skill")); dto[key] = key === "executableSha256" ? "0".repeat(64) : "linux";
    const bytes = json(dto); reject(validateBuild(bytes, fixture("skill"), inventory(bytes)), "invalid_build");
  }
});

test("inventory path/mode/bytes/hash is independently checked, not embedded or optional", () => {
  const e = fixture(); const bytes = good(encodeBuild(e));
  for (const [key, values] of [
    ["path", ["OTHER", "../BUILD.json", "build.json", "BUILD.json\n", null]],
    ["mode", [0o755, 0o600, "0644", -0, NaN]],
    ["bytes", [bytes.length - 1, bytes.length + 1, 0, -0, -1, 0.5, "1", Infinity, Number.MAX_SAFE_INTEGER + 1]],
    ["sha256", ["0".repeat(64), "F".repeat(64), "a".repeat(63), null, 0]],
  ]) for (const value of values) reject(validateBuild(bytes, e, { ...inventory(bytes), [key]: value }), "invalid_inventory");
  for (const key of ["path", "mode", "bytes", "sha256"]) {
    const f = inventory(bytes); delete f[key]; reject(validateBuild(bytes, e, f), "invalid_inventory");
  }
  reject(validateBuild(bytes, e, { ...inventory(bytes), other: 1 }), "invalid_inventory");
  reject(validateBuild(bytes, e, { ...inventory(bytes), bytes: 16385 }), "limit_exceeded");
  reject(validateBuild(bytes, e, undefined), "invalid_inventory");
});

test("raw byte cap is enforced and 16384-byte malformed content never becomes valid", () => {
  const e = fixture();
  const exact = Buffer.alloc(16384, 32);
  reject(validateBuild(exact, e, inventory(exact)), "invalid_build");
  reject(validateBuild(Buffer.alloc(16385), e, inventory(good(encodeBuild(e)))), "limit_exceeded");
  reject(validateBuild(Buffer.alloc(0), e, inventory(good(encodeBuild(e)))), "invalid_inventory");
});

test("duplicate keys, alternate JSON spelling and malformed UTF-8 fail even with matching digests", () => {
  const e = fixture(); const bytes = good(encodeBuild(e)); const text = bytes.toString();
  const variants = [
    text.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    text.replace('"nodeMajor":24', '"nodeMajor":24,"nodeMajor":24'),
    text.replace('"schemaVersion":1', '"schemaVersion":1.0'),
    text.replace('"runAttempt":1', '"runAttempt":1e0'),
    text.replace('"hraness/aicharts"', '"hraness\\/aicharts"'),
    text.replace('"cli"', '"\\u0063li"'),
    JSON.stringify(JSON.parse(text), null, 2) + "\n", text.trimEnd(), text + "\n", " " + text,
    text.replace(/\n$/, "\r\n"), text + "{}", text.replace('"runAttempt":1', '"runAttempt":-0'),
  ];
  for (const variant of variants) { const b = Buffer.from(variant); reject(validateBuild(b, e, inventory(b)), "invalid_build"); }
  for (const extra of [[0xef, 0xbb, 0xbf], [0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xe2, 0x82], [0]]) {
    for (const b of [Buffer.concat([Buffer.from(extra), bytes]), Buffer.concat([bytes, Buffer.from(extra)])]) reject(validateBuild(b, e, inventory(b)), "invalid_build");
  }
  for (let length = 1; length < bytes.length; length++) {
    const truncated = bytes.subarray(0, length); reject(validateBuild(truncated, e, inventory(truncated)), "invalid_build");
  }
});

test("all expectation records have exact data-only keys and no coercion", () => {
  const paths = [[], ["toolchain"], ["toolchain", "cCompiler"], ["runner"]];
  const at = (e, path) => path.reduce((v, k) => v[k], e);
  for (const path of paths) {
    for (const mutate of [
      (o) => { o.extra = "PRIVATE_CANARY"; },
      (o) => { o[Symbol("PRIVATE_CANARY")] = 1; },
      (o) => { Object.defineProperty(o, Object.keys(o)[0], { enumerable: false }); },
      (o) => { Object.setPrototypeOf(o, { PRIVATE_CANARY: 1 }); },
      (o) => { delete o[Object.keys(o)[0]]; },
    ]) { const e = fixture(); mutate(at(e, path)); reject(encodeBuild(e), "invalid_expectations"); }
    let calls = 0; const e = fixture(); const o = at(e, path); const first = Object.keys(o)[0];
    Object.defineProperty(o, first, { enumerable: true, get() { calls++; throw Error("PRIVATE_CANARY"); } });
    reject(encodeBuild(e), "invalid_expectations"); assert.equal(calls, 0);
  }
  for (const invalid of [undefined, null, true, 1, 1n, "PRIVATE_CANARY", [], new Date(), new Map(), Object.create({})]) reject(encodeBuild(invalid), "invalid_expectations");
});

test("null-prototype inputs are accepted and outputs never alias expectations", () => {
  const e = fixture();
  Object.setPrototypeOf(e, null); Object.setPrototypeOf(e.toolchain, null);
  Object.setPrototypeOf(e.toolchain.cCompiler, null); Object.setPrototypeOf(e.runner, null);
  const b = good(encodeBuild(e)); const f = Object.assign(Object.create(null), inventory(b));
  const out = good(validateBuild(b, e, f));
  assert.notEqual(out.toolchain, e.toolchain); assert.notEqual(out.runner, e.runner);
  assert.notEqual(out.toolchain.cCompiler, e.toolchain.cCompiler);
  e.version = "0.2.0"; e.runner.runId = "1"; e.toolchain.cCompiler.name = "clang"; f.bytes = 1;
  assert.equal(out.version, "0.1.0"); assert.equal(out.runner.runId, "9007199254740993"); assert.equal(out.toolchain.cCompiler.name, "gcc");
  deepFrozen(out);
});

test("top-level and nested proxies including revoked proxies execute no traps", () => {
  const e = fixture(); const b = good(encodeBuild(e)); let calls = 0;
  const handler = { get() { calls++; throw Error("PRIVATE_CANARY"); }, getPrototypeOf() { calls++; throw Error("PRIVATE_CANARY"); }, ownKeys() { calls++; throw Error("PRIVATE_CANARY"); } };
  reject(encodeBuild(new Proxy(e, handler)), "invalid_expectations");
  for (const key of ["toolchain", "runner"]) { const value = fixture(); value[key] = new Proxy(value[key], handler); reject(encodeBuild(value), "invalid_expectations"); }
  const compiler = fixture(); compiler.toolchain.cCompiler = new Proxy(compiler.toolchain.cCompiler, handler); reject(encodeBuild(compiler), "invalid_expectations");
  reject(validateBuild(b, e, new Proxy(inventory(b), handler)), "invalid_inventory");
  reject(validateBuild(new Proxy(b, handler), e, inventory(b)), "invalid_build");
  const revoked = Proxy.revocable(e, handler); revoked.revoke(); reject(encodeBuild(revoked.proxy), "invalid_expectations");
  assert.equal(calls, 0);
});

test("inherited toJSON and field setters cannot replace canonical facts or execute", () => {
  const e = fixture(); const baseline = good(encodeBuild(e)); let calls = 0; let encoded; let validated;
  try {
    Object.defineProperty(Object.prototype, "toJSON", { configurable: true, value() { calls++; return "PRIVATE_CANARY"; } });
    Object.defineProperty(Object.prototype, "version", { configurable: true, set() { calls++; }, get() { calls++; return "PRIVATE_CANARY"; } });
    encoded = encodeBuild(e); validated = validateBuild(baseline, e, inventory(baseline));
  } finally { delete Object.prototype.toJSON; delete Object.prototype.version; }
  assert.equal(calls, 0); assert.deepEqual(good(encoded), baseline); good(validated);
});

test("inherited descriptor value cannot turn an accessor into a data field", () => {
  const e = fixture("skill"); let calls = 0;
  Object.defineProperty(e.toolchain, "rustChannel", { enumerable: true, get() { calls++; return "PRIVATE_CANARY"; } });
  let result;
  try { Object.defineProperty(Object.prototype, "value", { configurable: true, value: null }); result = encodeBuild(e); }
  finally { delete Object.prototype.value; }
  assert.equal(calls, 0); reject(result, "invalid_expectations");
});

test("genuine byte subviews use intrinsic properties without getter/iterator evaluation", () => {
  const e = fixture(); const b = good(encodeBuild(e)); const storage = Buffer.alloc(b.length + 12, 0x7f); b.copy(storage, 6);
  const view = new Uint8Array(storage.buffer, storage.byteOffset + 6, b.length); let calls = 0;
  for (const key of ["buffer", "byteLength", "byteOffset", "length", Symbol.iterator]) Object.defineProperty(view, key, { get() { calls++; throw Error("PRIVATE_CANARY"); } });
  good(validateBuild(view, e, inventory(b))); assert.equal(calls, 0);
});

test("byte inputs reject nonviews, shared, resizable and detached backing", () => {
  const e = fixture(); const b = good(encodeBuild(e)); const f = inventory(b);
  const invalid = [undefined, null, true, 0, "PRIVATE_CANARY", b.buffer, new DataView(b.buffer), new Uint16Array(10), [], new Uint8Array(new SharedArrayBuffer(b.length)), new Uint8Array(new ArrayBuffer(b.length, { maxByteLength: b.length + 1 }))];
  const backing = new ArrayBuffer(b.length); const detached = new Uint8Array(backing); structuredClone(backing, { transfer: [backing] }); invalid.push(detached);
  for (const value of invalid) reject(validateBuild(value, e, f), "invalid_build");
});

test("encoded backing is exact, unpooled and independent across calls", () => {
  const first = good(encodeBuild(fixture())); const second = good(encodeBuild(fixture())); const before = Buffer.from(second);
  for (const b of [first, second]) { assert.equal(b.byteOffset, 0); assert.equal(b.buffer.byteLength, b.byteLength); }
  assert.notEqual(first.buffer, second.buffer);
  new Uint8Array(first.buffer).fill(0); assert.deepEqual(second, before);
});

test("frozen nullability and fixed toolchain/runner kinds cannot be relaxed", () => {
  for (const kind of ["cli", "skill"]) {
    for (const key of ["rustChannel", "cargoLockSha256", "cCompiler"]) {
      const e = fixture(kind); e.toolchain[key] = kind === "cli" ? null : fixture().toolchain[key]; reject(encodeBuild(e), "invalid_expectations");
    }
    const e = fixture(kind); e.executableSha256 = kind === "cli" ? null : "0".repeat(64); reject(encodeBuild(e), "invalid_expectations");
    for (const value of [22, "24", -0, NaN, Infinity]) { const x = fixture(kind); x.toolchain.nodeMajor = value; reject(encodeBuild(x), "invalid_expectations"); }
  }
  for (const kind of ["source", "CLI", null, true, 0]) reject(encodeBuild({ ...fixture(), kind }), "invalid_expectations");
  for (const label of ["ubuntu-latest", "macos-15", null, "ubuntu-22.04\n"]) { const e = fixture(); e.runner.label = label; reject(encodeBuild(e), "invalid_expectations"); }
  for (const name of ["cc", "GCC", "gcc -O3", null]) { const e = fixture(); e.toolchain.cCompiler.name = name; reject(encodeBuild(e), "invalid_expectations"); }
});

test("canonical version/hash and run bounds exactly match the manifest scalar subset", () => {
  const versions = ["", "v1.2.3", "01.2.3", "1.02.3", "1.2.03", "1.2", "1.2.3.4", "1.2.3-beta", "1.2.3+hash", "1000000000.2.3", 1, null];
  for (const value of versions) for (const path of [["version"], ["toolchain", "rustChannel"], ["toolchain", "cCompiler", "version"]]) {
    const e = fixture(); const target = path.slice(0, -1).reduce((o, key) => o[key], e); target[path.at(-1)] = value; reject(encodeBuild(e), "invalid_expectations");
  }
  for (const key of ["sourceCommit", "sourceTree", "executableSha256"]) for (const value of ["F".repeat(key === "executableSha256" ? 64 : 40), "g".repeat(64), "a", 1, null]) reject(encodeBuild({ ...fixture(), [key]: value }), "invalid_expectations");
  for (const value of ["0", "01", "-1", "+1", "1e1", "1.0", "1".repeat(21), 1, null]) { const e = fixture(); e.runner.runId = value; reject(encodeBuild(e), "invalid_expectations"); }
  for (const value of [-0, 0, -1, 1.1, NaN, Infinity, 1_000_001, "1", 1n]) { const e = fixture(); e.runner.runAttempt = value; reject(encodeBuild(e), "invalid_expectations"); }
  for (const value of ["", "01", "1.02", "1.", "1.2.3.4.5", "1".repeat(49), "latest", 1, null]) { const e = fixture(); e.runner.imageVersion = value; reject(encodeBuild(e), "invalid_expectations"); }
  const e = fixture(); e.version = "999999999.999999999.999999999"; e.toolchain.rustChannel = "0.0.0"; e.toolchain.cCompiler = { name: "clang", version: e.version }; e.runner.runId = "9".repeat(20); e.runner.runAttempt = 1_000_000; e.runner.imageVersion = "1".repeat(48);
  good(validateBuild(good(encodeBuild(e)), e, inventory(good(encodeBuild(e)))));
  const zero = fixture(); zero.sourceCommit = "0".repeat(40); zero.sourceTree = "0".repeat(40); zero.executableSha256 = "0".repeat(64); good(encodeBuild(zero)); // lexical policy only, no source-authenticity claim.
});

test("terminal line separators and non-ASCII scalar forms are rejected unchanged", () => {
  const paths = [["version"], ["sourceCommit"], ["sourceTree"], ["executableSha256"], ["toolchain", "rustChannel"], ["toolchain", "cargoLockSha256"], ["toolchain", "cCompiler", "name"], ["toolchain", "cCompiler", "version"], ["runner", "label"], ["runner", "imageVersion"], ["runner", "runId"]];
  for (const path of paths) for (const suffix of ["\n", "\r", "\r\n", "\u2028", "\u2029", "é", "١"]) {
    const e = fixture(); const o = path.slice(0, -1).reduce((v, k) => v[k], e); o[path.at(-1)] += suffix; reject(encodeBuild(e), "invalid_expectations");
  }
});

test("seeded scalar round trips and one-field mutations remain deterministic", () => {
  let state = 0x12345678;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  for (let i = 0; i < 300; i++) {
    const e = fixture(i % 2 ? "skill" : "cli"); e.version = `${next() % 1000}.${next() % 1000}.${next() % 1000}`;
    e.sourceCommit = sha(Buffer.from(String(next()))).slice(0, 40); e.sourceTree = sha(Buffer.from(String(next()))).slice(0, 40);
    e.runner.runId = String(BigInt(next()) * 10_000_000_000n + 1n); e.runner.runAttempt = next() % 1_000_000 + 1;
    const b = good(encodeBuild(e)); assert.deepEqual(b, json(expectedDto(e))); deepFrozen(good(validateBuild(b, e, inventory(b))));
    e.runner.runAttempt = e.runner.runAttempt % 1_000_000 + 1;
    reject(validateBuild(b, e, inventory(b)), "invalid_build");
  }
});

test("bounded arbitrary input corpus never throws or leaks supplied strings", () => {
  const e = fixture(); const b = good(encodeBuild(e)); const f = inventory(b);
  const values = [undefined, null, NaN, Infinity, -0, false, 1n, Symbol("PRIVATE_CANARY"), "PRIVATE_CANARY", {}, [], [e], new Date(), new Map(), new Set(), new Uint8Array(1), /PRIVATE_CANARY/, () => "PRIVATE_CANARY"];
  for (const value of values) {
    for (const result of [encodeBuild(value), validateBuild(value, e, f), validateBuild(b, value, f), validateBuild(b, e, value)]) {
      reject(result); assert.equal(JSON.stringify(result).includes("PRIVATE_CANARY"), false);
    }
  }
});

const CLI = ["bin/aicharts", "BUILD.json", "LICENSE", "NOTICE.md", "THIRD_PARTY_LICENSES.txt", "docs/usage-install.md", "docs/usage-local.md"];
const SKILL = ["SKILL.md", "agents/openai.yaml", "references/benchmarks.md", "references/local-usage.md", "scripts/atlas.mjs", "scripts/atlas.check.mjs", "BUILD.json", "LICENSE", "NOTICE.md"];
const caps = { maxCompressedBytes: 1024 * 1024, maxExpandedBytes: 4 * 1024 * 1024, maxFileBytes: 1024 * 1024, maxFiles: 32, maxEntries: 64, maxExpansionRatio: 4096 };
function archive(root, files) {
  const mtime = 1789128000;
  const expected = files.map((f) => ({ path: f.path, mode: f.mode, bytes: f.bytes.length, sha256: sha(f.bytes) }));
  const bytes = good(buildArchive({ root, mtime, caps, files }));
  const contents = good(validateArchive(bytes, { root, mtime, caps, files: expected }));
  return { asset: { bytes: bytes.length, sha256: sha(bytes), files: expected }, contents };
}
function joined(changed = "none") {
  const cli = fixture(); const skill = fixture("skill");
  const executable = Buffer.from("synthetic executable bytes; never executed"); cli.executableSha256 = sha(executable);
  let cliBuild = good(encodeBuild(cli)); let skillBuild = good(encodeBuild(skill));
  if (changed === "non_json") cliBuild = Buffer.from("synthetic not JSON");
  if (changed === "stale_executable") cliBuild = good(encodeBuild({ ...cli, executableSha256: "f".repeat(64) }));
  if (changed === "swapped") [cliBuild, skillBuild] = [skillBuild, cliBuild];
  if (changed === "different_runner") { const altered = clone(skill); altered.runner.imageVersion = "20260908.1"; skillBuild = good(encodeBuild(altered)); }
  const files = (paths, build, kind) => paths.map((path) => ({ path, mode: path === "bin/aicharts" ? 0o755 : 0o644, bytes: path === "BUILD.json" ? build : path === "bin/aicharts" ? executable : Buffer.from(`synthetic ${kind} ${path}`) }));
  const a = archive("aicharts-0.1.0-x86_64-unknown-linux-gnu", files(CLI, cliBuild, "cli"));
  const s = archive("aicharts", files(SKILL, skillBuild, "skill"));
  const source = archive("aicharts-source-0.1.0", [{ path: "Cargo.toml", mode: 0o644, bytes: Buffer.from("synthetic tracked source") }]);
  const expected = {
    version: cli.version, source: { commit: cli.sourceCommit, tree: cli.sourceTree, commitTime: "2026-09-11T12:00:00Z" },
    run: { runId: cli.runner.runId, runAttempt: cli.runner.runAttempt },
    toolchain: { rustChannel: cli.toolchain.rustChannel, nodeMajor: 24, bunVersion: "1.3.14", cargoLockSha256: cli.toolchain.cargoLockSha256, bunLockSha256: "5".repeat(64) },
    target: { triple: "x86_64-unknown-linux-gnu", os: "linux", arch: "x86_64", osFloor: "ubuntu-22.04", libcFloor: "glibc-2.35", cpuBaseline: "x86-64", runnerLabel: cli.runner.label, runnerImageVersion: cli.runner.imageVersion, cCompiler: cli.toolchain.cCompiler, dynamicDependencies: ["libc.so.6", "libgcc_s.so.1"] },
    cli: a.asset, skill: s.asset, sourceArchive: { bytes: source.asset.bytes, sha256: source.asset.sha256 }, sourceFiles: source.asset.files,
  };
  // Manifest inventory can be consistent while a BUILD body lies. It is not
  // permitted to replace the independent build expectations constructed above.
  const manifest = good(parseManifest(good(encodeManifest(expected)), expected));
  const results = [a, s].map((part, index) => {
    const kind = index === 0 ? "cli" : "skill";
    const record = manifest.assets.find((v) => v.kind === kind).files.find((v) => v.path === "BUILD.json");
    const bytes = part.contents.files.find((v) => v.path === "BUILD.json").bytes;
    return validateBuild(bytes, index === 0 ? cli : skill, record);
  });
  assert.equal(cli.executableSha256, a.asset.files.find((v) => v.path === "bin/aicharts").sha256);
  assert.equal(cli.executableSha256, sha(a.contents.files.find((v) => v.path === "bin/aicharts").bytes));
  return results;
}

test("actual memory-only archive/manifest join accepts independent CLI and skill BUILDs", () => {
  for (const result of joined()) good(result);
});
for (const fault of ["non_json", "stale_executable", "swapped", "different_runner"]) test(`body validation closes manifest-only gap: ${fault}`, () => {
  const results = joined(fault);
  if (fault === "different_runner") { good(results[0]); reject(results[1], "invalid_build"); }
  else { reject(results[0], "invalid_build"); if (fault === "swapped") reject(results[1], "invalid_build"); else good(results[1]); }
});
