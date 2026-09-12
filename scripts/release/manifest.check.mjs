import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { buildArchive, validateArchive } from "./archive.mjs";
import { encodeManifest, parseManifest, encodeChecksums, parseChecksums } from "./manifest.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const CLI = ["bin/aicharts", "BUILD.json", "LICENSE", "NOTICE.md", "THIRD_PARTY_LICENSES.txt", "docs/usage-install.md", "docs/usage-local.md"];
const SKILL = ["SKILL.md", "agents/openai.yaml", "references/benchmarks.md", "references/local-usage.md", "scripts/atlas.mjs", "scripts/atlas.check.mjs", "BUILD.json", "LICENSE", "NOTICE.md"];
const file = (path, mode = 0o644) => ({ path, mode, bytes: 12, sha256: sha(Buffer.from(`synthetic:${path}`)) });
const fixture = () => ({
  version: "0.1.0",
  source: { commit: "1".repeat(40), tree: "2".repeat(40), commitTime: "2026-09-11T12:34:56Z" },
  run: { runId: "34563872055", runAttempt: 1 },
  toolchain: { rustChannel: "1.97.1", nodeMajor: 24, bunVersion: "1.3.14", cargoLockSha256: "3".repeat(64), bunLockSha256: "4".repeat(64) },
  target: {
    triple: "x86_64-unknown-linux-gnu", os: "linux", arch: "x86_64",
    osFloor: "ubuntu-22.04", libcFloor: "glibc-2.35", cpuBaseline: "x86-64",
    runnerLabel: "ubuntu-22.04", runnerImageVersion: "20260907.12.1",
    cCompiler: { name: "gcc", version: "11.4.0" },
    dynamicDependencies: ["libc.so.6", "libgcc_s.so.1"],
  },
  cli: { bytes: 800, sha256: "5".repeat(64), files: CLI.map((path) => file(path, path === "bin/aicharts" ? 0o755 : 0o644)) },
  skill: { bytes: 900, sha256: "6".repeat(64), files: SKILL.map((path) => file(path)) },
  sourceArchive: { bytes: 500, sha256: "7".repeat(64) },
  sourceFiles: [file("Cargo.toml"), file("scripts/example.mjs", 0o755), file("LICENSE")],
});

test("canonical manifest and sums match only the independent expectations", () => {
  const expected = fixture();
  const encoded = encodeManifest(expected);
  assert.equal(encoded.ok, true);
  const parsed = parseManifest(encoded.value, expected);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.profile, "linux-skill-v1");
  const checksums = encodeChecksums(encoded.value, expected);
  assert.equal(checksums.ok, true);
  assert.equal(parseChecksums(checksums.value, encoded.value, expected).ok, true);
});

test("inherited toJSON cannot override generated manifest provenance", () => {
  const expected = fixture();
  const baseline = encodeManifest(expected);
  let calls = 0;
  let result;
  try {
    Object.defineProperty(Object.prototype, "toJSON", { configurable: true, value() { calls++; return "PRIVATE_CANARY"; } });
    result = encodeManifest(expected);
  } finally {
    delete Object.prototype.toJSON;
  }
  assert.equal(calls, 0);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, baseline.value);
});

const good = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const reject = (result, code) => {
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result), ["ok", "error"]);
  assert.match(result.error, /^(invalid_expectations|invalid_manifest|invalid_checksums|limit_exceeded)$/);
  if (code) assert.equal(result.error, code);
  assert.ok(Object.isFrozen(result));
};
const json = (value) => Buffer.from(JSON.stringify(value) + "\n");
const clone = (value) => structuredClone(value);
const matchMutation = (change) => {
  const expected = fixture();
  const parsed = JSON.parse(good(encodeManifest(expected)).toString());
  change(parsed);
  reject(parseManifest(json(parsed), expected), "invalid_manifest");
};
const deepFrozen = (value) => {
  if (value && typeof value === "object") {
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) deepFrozen(child);
  }
};

test("exact public DTO keys, fixed provenance fields, ordering and no self-hash cycle", () => {
  const expected = fixture();
  const bytes = good(encodeManifest(expected));
  const value = good(parseManifest(bytes, expected));
  assert.deepEqual(Object.keys(value), ["schemaVersion", "profile", "repository", "tag", "version", "source", "workflow", "toolchain", "targets", "disabledCapabilities", "assets"]);
  assert.deepEqual(value.workflow, { path: ".github/workflows/cli-release.yml", sourceRef: "refs/heads/main", sourceCommit: expected.source.commit, runId: expected.run.runId, runAttempt: 1 });
  assert.deepEqual(value.disabledCapabilities, ["authentication", "enrollment", "upload", "backgroundCollection", "nativeCustody", "autoUpdate"]);
  assert.deepEqual(value.assets.map((a) => a.name), ["aicharts-0.1.0-x86_64-unknown-linux-gnu.tar.gz", "aicharts-skill-0.1.0.tar.gz", "aicharts-source-0.1.0.tar.gz"]);
  assert.deepEqual(value.assets.map((a) => a.root), ["aicharts-0.1.0-x86_64-unknown-linux-gnu", "aicharts", "aicharts-source-0.1.0"]);
  assert.deepEqual(value.assets.map((a) => a.target), ["x86_64-unknown-linux-gnu", null, null]);
  for (const asset of value.assets) {
    assert.deepEqual(Object.keys(asset), ["name", "kind", "target", "bytes", "expandedBytes", "sha256", "root", "files"]);
    assert.deepEqual(asset.files.map((f) => f.path), asset.files.map((f) => f.path).sort());
    for (const file of asset.files) assert.deepEqual(Object.keys(file), ["path", "mode", "bytes", "sha256"]);
  }
  assert.equal(bytes.at(-1), 10);
  assert.deepEqual(bytes, json(value)); // independent ordinary JSON oracle, without prototype hooks.
  assert.ok(!value.assets.some((a) => ["release-manifest.json", "SHA256SUMS", "build-attestations.jsonl"].includes(a.name)));
  deepFrozen(value);
  deepFrozen(good(parseChecksums(good(encodeChecksums(bytes, expected)), bytes, expected)));
});

test("all independently supplied identity, measured facts and inventory details are load-bearing", () => {
  const changes = [
    (e) => { e.version = "0.1.1"; },
    (e) => { e.source.commit = "8".repeat(40); }, (e) => { e.source.tree = "9".repeat(40); },
    (e) => { e.source.commitTime = "2026-09-11T12:34:57Z"; },
    (e) => { e.run.runId = "9007199254740993"; }, (e) => { e.run.runAttempt = 2; },
    (e) => { e.toolchain.rustChannel = "1.98.0"; }, (e) => { e.toolchain.bunVersion = "1.3.15"; },
    (e) => { e.toolchain.cargoLockSha256 = "8".repeat(64); }, (e) => { e.toolchain.bunLockSha256 = "9".repeat(64); },
    (e) => { e.target.runnerImageVersion = "20260908.1"; },
    (e) => { e.target.cCompiler.name = "clang"; }, (e) => { e.target.cCompiler.version = "12.0.0"; },
    (e) => { e.target.dynamicDependencies = ["libc.so.6"]; },
    (e) => { e.cli.bytes++; }, (e) => { e.cli.sha256 = "8".repeat(64); },
    (e) => { e.cli.files[0].bytes++; }, (e) => { e.cli.files[0].sha256 = "8".repeat(64); },
    (e) => { e.skill.bytes++; }, (e) => { e.skill.sha256 = "8".repeat(64); },
    (e) => { e.skill.files[0].bytes++; }, (e) => { e.skill.files[0].sha256 = "8".repeat(64); },
    (e) => { e.sourceArchive.bytes++; }, (e) => { e.sourceArchive.sha256 = "8".repeat(64); },
    (e) => { e.sourceFiles[0].bytes++; }, (e) => { e.sourceFiles[0].sha256 = "8".repeat(64); },
    (e) => { e.sourceFiles[0].mode = 0o755; }, (e) => { e.sourceFiles[0].path = "other.toml"; },
    (e) => { e.sourceFiles.pop(); }, (e) => { e.sourceFiles.push(file("ADDED")); },
  ];
  for (const change of changes) {
    const expected = fixture();
    const bytes = good(encodeManifest(expected));
    change(expected);
    good(encodeManifest(expected)); // independently well-formed, but a different exact release.
    reject(parseManifest(bytes, expected), "invalid_manifest");
  }
});

test("downloaded fields cannot override fixed repository, workflow, target, inventories or disabled capabilities", () => {
  const changes = [
    (m) => { m.schemaVersion = 2; }, (m) => { m.profile = "macos"; },
    (m) => { m.repository = "attacker/aicharts"; }, (m) => { m.tag = "latest"; },
    (m) => { m.version = "0.2.0"; }, (m) => { m.source.commit = "f".repeat(40); },
    (m) => { m.workflow.path = ".github/workflows/other.yml"; },
    (m) => { m.workflow.sourceRef = "refs/tags/cli-v0.1.0"; },
    (m) => { m.workflow.sourceCommit = "a".repeat(40); },
    (m) => { m.targets[0].triple = "aarch64-apple-darwin"; },
    (m) => { m.targets[0].runnerLabel = "ubuntu-latest"; },
    (m) => { m.targets[0].libcFloor = "glibc-2.39"; },
    (m) => { m.targets.push(m.targets[0]); }, (m) => { m.targets = []; },
    (m) => { m.disabledCapabilities.pop(); }, (m) => { m.disabledCapabilities.reverse(); },
    (m) => { m.assets[0].name = "payload.tar.gz"; }, (m) => { m.assets[0].root = "../x"; },
    (m) => { m.assets[0].target = null; }, (m) => { m.assets[1].target = m.targets[0].triple; },
    (m) => { m.assets[0].kind = "source"; }, (m) => { m.assets[0].expandedBytes--; },
    (m) => { m.assets[0].files[0].path = "../BUILD.json"; },
    (m) => { m.assets[0].files[0].mode = 0o777; },
    (m) => { m.assets.push({ name: "release-manifest.json", sha256: "0".repeat(64) }); },
    (m) => { m.assets.reverse(); }, (m) => { m.assets[0].files.reverse(); },
  ];
  for (const change of changes) matchMutation(change);
});

test("duplicate/unknown keys and alternative valid JSON spellings never match canonical bytes", () => {
  const expected = fixture();
  const bytes = good(encodeManifest(expected));
  const text = bytes.toString();
  const equivalent = [
    text.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    text.replace(`"commit":"${expected.source.commit}"`, `"commit":"${expected.source.commit}","commit":"${expected.source.commit}"`),
    text.replace('"schemaVersion":1', '"schemaVersion":1.0'),
    text.replace('"runAttempt":1', '"runAttempt":1e0'),
    text.replace('"repository":"hraness/aicharts"', '"repository":"hraness\\/aicharts"'),
    text.replace('"linux-skill-v1"', '"\\u006cinux-skill-v1"'),
    JSON.stringify(JSON.parse(text), null, 2) + "\n",
    text.trimEnd(), text + "\n", " " + text, text.replace(/\n$/, "\r\n"),
  ];
  for (const variant of equivalent) {
    assert.deepEqual(JSON.parse(variant), JSON.parse(text));
    reject(parseManifest(Buffer.from(variant), expected), "invalid_manifest");
  }
  for (const name of ["extra", "__proto__", "constructor", "prototype", "toJSON", "caps"]) {
    reject(parseManifest(Buffer.from(text.replace(/^{/, `{${JSON.stringify(name)}:null,`)), expected), "invalid_manifest");
  }
  const zero = fixture();
  zero.sourceFiles[0].bytes = 0;
  const zeroText = good(encodeManifest(zero)).toString();
  assert.ok(zeroText.includes('"bytes":0'));
  reject(parseManifest(Buffer.from(zeroText.replace('"bytes":0', '"bytes":-0')), zero), "invalid_manifest");
});

test("invalid UTF-8, BOM, NUL, trailing objects and every truncation fail closed", () => {
  const expected = fixture();
  const bytes = good(encodeManifest(expected));
  for (const extra of [Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from([0xff]), Buffer.from([0xc0, 0xaf]), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from([0xe2, 0x82]), Buffer.from([0]), Buffer.from("{}")]) {
    reject(parseManifest(Buffer.concat([extra, bytes]), expected), "invalid_manifest");
    reject(parseManifest(Buffer.concat([bytes, extra]), expected), "invalid_manifest");
  }
  for (let i = 0; i < bytes.length; i++) reject(parseManifest(bytes.subarray(0, i), expected), "invalid_manifest");
});

test("SHA256SUMS has exactly four sorted subjects and hashes the exact raw manifest", () => {
  const expected = fixture();
  const manifest = good(encodeManifest(expected));
  const sums = good(encodeChecksums(manifest, expected));
  const value = good(parseChecksums(sums, manifest, expected));
  assert.equal(value.entries.length, 4);
  assert.deepEqual(value.entries.at(-1), { name: "release-manifest.json", sha256: sha(manifest) });
  assert.deepEqual(Object.keys(value), ["entries"]);
  assert.deepEqual(sums, Buffer.from(value.entries.map((e) => `${e.sha256}  ${e.name}\n`).join("")));
  assert.ok(!sums.includes("SHA256SUMS"));
  assert.ok(!sums.includes("build-attestations.jsonl"));
  reject(encodeChecksums(Buffer.concat([manifest, Buffer.from("\n")]), expected), "invalid_manifest");
});

test("checksum whitespace, names, order, coverage, digest and self-reference are exact", () => {
  const expected = fixture();
  const manifest = good(encodeManifest(expected));
  const text = good(encodeChecksums(manifest, expected)).toString();
  const lines = text.trimEnd().split("\n");
  const variants = [
    text.replace(/  /, " "), text.replace(/  /, "   "), text.replace(/  /, "\t"), text.replace(/  /, " *"),
    text.replace(/\n/g, "\r\n"), text.trimEnd(), "\n" + text, text + "\n", "\\" + text,
    [...lines].reverse().join("\n") + "\n", lines.slice(1).join("\n") + "\n", text + lines[0] + "\n",
    text.replace("aicharts-", "../aicharts-"), text.replace("aicharts-", "Aicharts-"), text.replace("0.1.0", "0.2.0"),
    "0" + text.slice(1), text + "8".repeat(64) + "  SHA256SUMS\n", text + "8".repeat(64) + "  build-attestations.jsonl\n",
  ];
  const withHexLetters = fixture();
  withHexLetters.cli.sha256 = "a".repeat(64);
  const letterManifest = good(encodeManifest(withHexLetters));
  reject(parseChecksums(Buffer.from(good(encodeChecksums(letterManifest, withHexLetters)).toString().replace(/^a+/, "A".repeat(64))), letterManifest, withHexLetters), "invalid_checksums");
  for (const variant of variants) reject(parseChecksums(Buffer.from(variant), manifest, expected), "invalid_checksums");
});

test("byte caps apply before copying, and input views never leak backing storage", () => {
  const expected = fixture();
  const manifest = good(encodeManifest(expected));
  const sums = good(encodeChecksums(manifest, expected));
  reject(parseManifest(Buffer.alloc(1024 * 1024 + 1), null), "limit_exceeded");
  reject(parseChecksums(Buffer.alloc(4097), manifest, null), "limit_exceeded");
  const manifest2 = good(encodeManifest(expected));
  const sums2 = good(encodeChecksums(manifest2, expected));
  for (const bytes of [manifest, sums, manifest2, sums2]) {
    assert.equal(bytes.byteOffset, 0);
    assert.equal(bytes.buffer.byteLength, bytes.length);
  }
  assert.equal(new Set([manifest.buffer, sums.buffer, manifest2.buffer, sums2.buffer]).size, 4);
  new Uint8Array(sums.buffer).fill(0);
  assert.equal(parseChecksums(sums2, manifest, expected).ok, true);
  new Uint8Array(manifest.buffer).fill(0);
  assert.equal(parseManifest(manifest2, expected).ok, true);
});

test("byte intrinsics ignore shadow accessors and refuse shared/resizable/detached/proxy input", () => {
  const expected = fixture();
  const manifest = good(encodeManifest(expected));
  let calls = 0;
  for (const key of ["buffer", "byteOffset", "byteLength", Symbol.iterator]) Object.defineProperty(manifest, key, { get() { calls++; throw new Error("PRIVATE_CANARY"); } });
  assert.equal(parseManifest(manifest, expected).ok, true);
  assert.equal(calls, 0);
  const detached = new Uint8Array(new ArrayBuffer(10));
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  for (const bytes of [new Uint8Array(new SharedArrayBuffer(8)), new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 })), new Proxy(new Uint8Array(8), {}), new Uint16Array(8), new DataView(new ArrayBuffer(8)), detached, "PRIVATE_CANARY"]) {
    reject(parseManifest(bytes, expected), "invalid_manifest");
    reject(parseChecksums(bytes, good(encodeManifest(expected)), expected), "invalid_checksums");
  }
});

test("trusted metadata is exact, descriptor-only and rejects coercion, getters and proxies", () => {
  let calls = 0;
  const bad = [null, false, "PRIVATE_CANARY", new Date(), [], { ...fixture(), extra: true }, new Proxy(fixture(), { ownKeys() { calls++; throw new Error("PRIVATE_CANARY"); } })];
  const getter = fixture();
  Object.defineProperty(getter, "source", { get() { calls++; throw new Error("PRIVATE_CANARY"); } });
  bad.push(getter);
  const symbol = fixture(); symbol[Symbol("extra")] = true; bad.push(symbol);
  const hidden = fixture(); Object.defineProperty(hidden, "run", { enumerable: false }); bad.push(hidden);
  const inherited = Object.create(fixture()); bad.push(inherited);
  const arrayGetter = fixture(); Object.defineProperty(arrayGetter.sourceFiles, "0", { get() { calls++; return file("x"); } }); bad.push(arrayGetter);
  const iterator = fixture(); iterator.sourceFiles[Symbol.iterator] = () => { calls++; throw new Error("PRIVATE_CANARY"); }; bad.push(iterator);
  const sparse = fixture(); delete sparse.sourceFiles[1]; bad.push(sparse);
  const nullArray = fixture(); Object.setPrototypeOf(nullArray.sourceFiles, null); bad.push(nullArray);
  const coercion = fixture(); coercion.version = { toString() { calls++; return "0.1.0"; } }; bad.push(coercion);
  const alias = fixture(); alias.sourceArchive.files = alias.sourceFiles; bad.push(alias);
  for (const expected of bad) reject(encodeManifest(expected), "invalid_expectations");
  assert.equal(calls, 0);
});

test("null-prototype expectations and inherited property traps preserve canonical bytes", () => {
  const convert = (value) => {
    if (Array.isArray(value)) return value.map(convert);
    if (!value || typeof value !== "object") return value;
    return Object.assign(Object.create(null), Object.fromEntries(Object.entries(value).map(([key, child]) => [key, convert(child)])));
  };
  const expected = convert(fixture());
  const original = good(encodeManifest(expected));
  const invalid = fixture();
  let calls = 0;
  Object.defineProperty(invalid.sourceFiles[0], "mode", { get() { calls++; return 420; }, enumerable: true });
  let result, refused;
  try {
    Object.defineProperty(Object.prototype, "source", { configurable: true, set() { calls++; } });
    Object.defineProperty(Array.prototype, "toJSON", { configurable: true, value() { calls++; return "PRIVATE_CANARY"; } });
    Object.defineProperty(Object.prototype, "value", { configurable: true, get() { calls++; return 420; } });
    result = encodeManifest(expected);
    refused = encodeManifest(invalid);
  } finally {
    delete Object.prototype.value; delete Object.prototype.source; delete Array.prototype.toJSON;
  }
  assert.equal(calls, 0);
  assert.deepEqual(good(result), original);
  reject(refused, "invalid_expectations");
});

test("returned DTOs and bytes never alias mutable expectations or subsequent calls", () => {
  const expected = fixture();
  const encoded = good(encodeManifest(expected));
  const first = good(parseManifest(encoded, expected));
  const second = good(parseManifest(encoded, expected));
  expected.source.commit = "f".repeat(40);
  expected.sourceFiles[0].sha256 = "f".repeat(64);
  expected.target.dynamicDependencies.pop();
  assert.equal(first.source.commit, "1".repeat(40));
  assert.equal(first.targets[0].dynamicDependencies.length, 2);
  assert.notEqual(first, second);
  assert.notEqual(first.assets[0].files, second.assets[0].files);
  assert.notEqual(first.source, expected.source);
  deepFrozen(first);
});

for (const version of ["", "v0.1.0", "00.1.0", "0.01.0", "0.1.00", "1.2", "1.2.3.4", "1.2.3-beta", "1.2.3+sha", "1000000000.0.0", "1.2.3\n", "1.2.٣", 1]) {
  test(`canonical bounded version refuses ${JSON.stringify(version)}`, () => reject(encodeManifest({ ...fixture(), version }), "invalid_expectations"));
}

test("bounded run identifiers remain strings above JavaScript's safe integer range", () => {
  const expected = fixture(); expected.version = "999999999.999999999.999999999";
  for (const runId of ["9007199254740993", "99999999999999999999"]) {
    expected.run.runId = runId; expected.run.runAttempt = 1_000_000;
    assert.equal(good(parseManifest(good(encodeManifest(expected)), expected)).workflow.runId, runId);
  }
  for (const runId of ["0", "01", "-1", "+1", "1.0", "1e2", "1\n", "1".repeat(21), 1]) reject(encodeManifest({ ...fixture(), run: { runId, runAttempt: 1 } }), "invalid_expectations");
  for (const runAttempt of [-0, 0, -1, 1.1, NaN, Infinity, 1_000_001, "1"]) reject(encodeManifest({ ...fixture(), run: { runId: "1", runAttempt } }), "invalid_expectations");
});

test("UTC source time is a real whole-second date in the accepted USTAR range", () => {
  const maximum = new Date(0o77777777777 * 1000).toISOString().replace(".000Z", "Z");
  for (const commitTime of ["1970-01-01T00:00:00Z", "2024-02-29T12:34:56Z", maximum]) {
    const expected = fixture(); expected.source.commitTime = commitTime; good(encodeManifest(expected));
  }
  const overMaximum = new Date((0o77777777777 + 1) * 1000).toISOString().replace(".000Z", "Z");
  for (const commitTime of ["1969-12-31T23:59:59Z", "2026-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2026-09-11T24:00:00Z", "2026-09-11T00:00:60Z", "2026-09-11T00:00:00.000Z", "2026-09-11T00:00:00+00:00", "2026-9-11T00:00:00Z", "0000-01-01T00:00:00Z", overMaximum, 0]) {
    const expected = fixture(); expected.source.commitTime = commitTime; reject(encodeManifest(expected), "invalid_expectations");
  }
});

test("compiler, runner and dependency records are supplied, structured and exactly bounded", () => {
  const expected = fixture(); expected.target.cCompiler = { name: "clang", version: "19.1.0" }; good(encodeManifest(expected));
  for (const key of ["triple", "os", "arch", "osFloor", "libcFloor", "cpuBaseline", "runnerLabel"]) {
    const e = fixture(); e.target[key] += "x"; reject(encodeManifest(e), "invalid_expectations");
  }
  for (const compiler of ["gcc 11.4.0", { name: "gcc", version: "11.4.0", flags: "-O2" }, { name: "cc", version: "11.4.0" }, { name: "gcc", version: "/private/canary" }]) {
    const e = fixture(); e.target.cCompiler = compiler; reject(encodeManifest(e), "invalid_expectations");
  }
  for (const runnerImageVersion of ["ubuntu-latest", "01.2", "1.2.3.4.5", "1." , "1".repeat(49), "1\n", 1]) {
    const e = fixture(); e.target.runnerImageVersion = runnerImageVersion; reject(encodeManifest(e), "invalid_expectations");
  }
  for (const dynamicDependencies of [[], ["libc.so.6", "libc.so.6"], ["libgcc_s.so.1", "libc.so.6"], ["/lib/libc.so.6"], ["../libc.so.6"], ["libc.so.6\n"], ["a".repeat(129) + ".so"], ["LIBC.so.6", "libc.so.6"], Array.from({ length: 17 }, (_, i) => `lib${i}.so`)]) {
    const e = fixture(); e.target.dynamicDependencies = dynamicDependencies; reject(encodeManifest(e), "invalid_expectations");
  }
  const node = fixture(); node.toolchain.nodeMajor = 22; reject(encodeManifest(node), "invalid_expectations");
});

test("mandatory CLI/skill allowlists and modes cannot be widened by supplied inventory", () => {
  for (const kind of ["cli", "skill"]) {
    for (const name of kind === "cli" ? CLI : SKILL) {
      const e = fixture(); e[kind].files = e[kind].files.filter((f) => f.path !== name); reject(encodeManifest(e), "invalid_expectations");
    }
    for (const change of [(a) => a.push(file("install.sh")), (a) => { a[0].path = "OTHER"; }, (a) => { a[1] = clone(a[0]); }, (a) => { a[0].mode = 0o777; }]) {
      const e = fixture(); change(e[kind].files); reject(encodeManifest(e), "invalid_expectations");
    }
  }
  const e = fixture(); e.cli.files.find((f) => f.path === "bin/aicharts").mode = 0o644; reject(encodeManifest(e), "invalid_expectations");
  const f = fixture(); f.skill.files[0].mode = 0o755; reject(encodeManifest(f), "invalid_expectations");
});

test("source paths, modes, collisions and independently supplied complete inventory are strict", () => {
  for (const name of ["../x", "/x", "a\\b", "a:stream", "a//b", ".", "a/../b", "a.", "CON", "é", "a".repeat(101)]) {
    const e = fixture(); e.sourceFiles[0].path = name; reject(encodeManifest(e), "invalid_expectations");
  }
  for (const paths of [["a", "A"], ["a", "a/b"], ["a/b", "a"], ["Dir/a", "dir/b"], ["a", "a"]]) {
    const e = fixture(); e.sourceFiles = paths.map((p) => file(p)); reject(encodeManifest(e), "invalid_expectations");
  }
  for (const mode of [0o777, 0o600, 0o120777, 0o100644, "0644"]) {
    const e = fixture(); e.sourceFiles[0].mode = mode; reject(encodeManifest(e), "invalid_expectations");
  }
  const e = fixture(); e.sourceFiles[0].kind = "symlink"; reject(encodeManifest(e), "invalid_expectations");
  const empty = fixture(); empty.sourceFiles = []; reject(encodeManifest(empty), "invalid_expectations");
  const big = fixture(); big.sourceFiles = Array.from({ length: 2049 }, (_, i) => file(`f${i}`)); reject(encodeManifest(big), "invalid_expectations");
  const zero = fixture(); zero.sourceFiles[0].bytes = 0; good(encodeManifest(zero));
});

test("fixed per-kind compressed, expanded, ratio and BUILD inventory caps are enforced", () => {
  for (const [key, cap] of [["cli", 64 * 1024 * 1024], ["skill", 1024 * 1024], ["sourceArchive", 32 * 1024 * 1024]]) {
    const e = fixture(); e[key].bytes = cap; good(encodeManifest(e));
    for (const bytes of [cap + 1, 19, -0, -1, 1.5, Infinity, "800"]) {
      const f = fixture(); f[key].bytes = bytes; reject(encodeManifest(f), "limit_exceeded");
    }
  }
  for (const kind of ["cli", "skill"]) {
    const e = fixture(); e[kind].files.find((f) => f.path === "BUILD.json").bytes = 16384; good(encodeManifest(e));
    e[kind].files.find((f) => f.path === "BUILD.json").bytes++; reject(encodeManifest(e), "limit_exceeded");
  }
  const exact = fixture(); exact.sourceFiles = [{ ...file("f"), bytes: 64 * 1024 * 1024 - 2048 }]; exact.sourceArchive.bytes = 16384;
  const value = good(parseManifest(good(encodeManifest(exact)), exact));
  assert.equal(value.assets[2].expandedBytes, 64 * 1024 * 1024);
  exact.sourceFiles[0].bytes++; reject(encodeManifest(exact), "limit_exceeded");
  exact.sourceFiles[0].bytes--; exact.sourceArchive.bytes--; reject(encodeManifest(exact), "limit_exceeded");
  const unsafe = fixture(); unsafe.sourceFiles[0].bytes = Number.MAX_SAFE_INTEGER; reject(encodeManifest(unsafe), "limit_exceeded");
});

test("identity/hash lexemes reject wrong lengths, case, coerced values and unsafe file numbers", () => {
  for (const invalid of ["F".repeat(40), "f".repeat(39), "g".repeat(40), null, 123]) {
    for (const key of ["commit", "tree"]) {
      const expected = fixture(); expected.source[key] = invalid; reject(encodeManifest(expected), "invalid_expectations");
    }
  }
  const setters = [
    (e, v) => { e.toolchain.cargoLockSha256 = v; }, (e, v) => { e.toolchain.bunLockSha256 = v; },
    (e, v) => { e.cli.sha256 = v; }, (e, v) => { e.skill.sha256 = v; }, (e, v) => { e.sourceArchive.sha256 = v; },
    (e, v) => { e.cli.files[0].sha256 = v; }, (e, v) => { e.skill.files[0].sha256 = v; }, (e, v) => { e.sourceFiles[0].sha256 = v; },
  ];
  for (const invalid of ["F".repeat(64), "f".repeat(63), "g".repeat(64), "0".repeat(65), null, { toString() { throw new Error("PRIVATE_CANARY"); } }]) {
    for (const set of setters) { const expected = fixture(); set(expected, invalid); reject(encodeManifest(expected), "invalid_expectations"); }
  }
  for (const bytes of [-0, -1, 0.5, Infinity, NaN, "12", Number.MAX_SAFE_INTEGER + 1]) {
    const expected = fixture(); expected.sourceFiles[0].bytes = bytes; reject(encodeManifest(expected), "limit_exceeded");
  }
});

test("terminal LF/CR/CRLF/LS/PS cannot enter any accepted metadata lexeme", () => {
  for (const suffix of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
    const hash40 = "a".repeat(40 - suffix.length) + suffix;
    const hash64 = "a".repeat(64 - suffix.length) + suffix;
    const changes = [
      (e) => { e.version += suffix; },
      (e) => { e.source.commit = hash40; }, (e) => { e.source.tree = hash40; },
      (e) => { e.source.commitTime += suffix; }, (e) => { e.run.runId += suffix; },
      (e) => { e.toolchain.rustChannel += suffix; }, (e) => { e.toolchain.bunVersion += suffix; },
      (e) => { e.toolchain.cargoLockSha256 = hash64; }, (e) => { e.toolchain.bunLockSha256 = hash64; },
      (e) => { e.target.runnerImageVersion += suffix; },
      (e) => { e.target.cCompiler.name += suffix; }, (e) => { e.target.cCompiler.version += suffix; },
      (e) => { e.target.dynamicDependencies = ["libc.so.6" + suffix]; },
      (e) => { e.cli.sha256 = hash64; }, (e) => { e.skill.sha256 = hash64; }, (e) => { e.sourceArchive.sha256 = hash64; },
      (e) => { e.cli.files[0].sha256 = hash64; }, (e) => { e.skill.files[0].sha256 = hash64; }, (e) => { e.sourceFiles[0].sha256 = hash64; },
      (e) => { e.cli.files[0].path += suffix; }, (e) => { e.skill.files[0].path += suffix; },
      (e) => { e.sourceFiles[0].path = "a" + suffix; }, (e) => { e.sourceFiles[0].path = `a${suffix}/b`; },
    ];
    for (const change of changes) {
      const expected = fixture(); change(expected);
      reject(encodeManifest(expected), "invalid_expectations");
    }
  }
});

test("BUILD body interpretation is deliberately not claimed by metadata matching", () => {
  const expected = fixture();
  for (const kind of ["cli", "skill"]) {
    const build = expected[kind].files.find((f) => f.path === "BUILD.json");
    const invalidBuildBody = Buffer.from("not a BUILD JSON record");
    build.bytes = invalidBuildBody.length;
    build.sha256 = sha(invalidBuildBody);
  }
  // This API has no BUILD body input. A separate body validator must reject
  // such bytes before release; this successful metadata match is not that gate.
  const encoded = good(encodeManifest(expected));
  assert.equal(parseManifest(encoded, expected).ok, true);
});

test("canonical inventories normalize input ordering without reading source or runtime state", () => {
  const expected = fixture();
  const before = good(encodeManifest(expected));
  expected.cli.files.reverse(); expected.skill.files.reverse(); expected.sourceFiles.reverse();
  assert.deepEqual(good(encodeManifest(expected)), before);
  const reversedKeys = Object.fromEntries(Object.entries(expected).reverse());
  assert.deepEqual(good(encodeManifest(reversedKeys)), before);
});

test("computed expanded sizes and inventories agree with actual accepted archive bytes", () => {
  const expected = fixture();
  const configurations = [
    { kind: "cli", root: `aicharts-${expected.version}-x86_64-unknown-linux-gnu`, limit: 128 * 1024 * 1024, compressed: 64 * 1024 * 1024 },
    { kind: "skill", root: "aicharts", limit: 4 * 1024 * 1024, compressed: 1024 * 1024 },
    { kind: "source", root: `aicharts-source-${expected.version}`, limit: 64 * 1024 * 1024, compressed: 32 * 1024 * 1024 },
  ];
  const built = [];
  for (const config of configurations) {
    const records = config.kind === "source" ? expected.sourceFiles : expected[config.kind].files;
    const entries = records.map((f, i) => ({ path: f.path, mode: f.mode, bytes: Buffer.alloc(i * 217, i) }));
    const inventory = entries.map((e) => ({ path: e.path, mode: e.mode, bytes: e.bytes.length, sha256: sha(e.bytes) }));
    const caps = { maxCompressedBytes: config.compressed, maxExpandedBytes: config.limit, maxFileBytes: config.limit, maxFiles: config.kind === "source" ? 2048 : 16, maxEntries: 8192, maxExpansionRatio: 4096 };
    const input = { root: config.root, mtime: Date.parse(expected.source.commitTime) / 1000, files: entries, caps };
    const bytes = good(buildArchive(input));
    const checked = good(validateArchive(bytes, { ...input, files: inventory }));
    assert.equal(checked.files.length, records.length);
    if (config.kind === "source") { expected.sourceFiles = inventory; expected.sourceArchive = { bytes: bytes.length, sha256: sha(bytes) }; }
    else expected[config.kind] = { bytes: bytes.length, sha256: sha(bytes), files: inventory };
    built.push(bytes);
  }
  const result = good(parseManifest(good(encodeManifest(expected)), expected));
  for (let i = 0; i < 3; i++) {
    assert.equal(result.assets[i].expandedBytes, gunzipSync(built[i]).length);
    assert.equal(result.assets[i].bytes, built[i].length);
    assert.equal(result.assets[i].sha256, sha(built[i]));
  }
});

test("seeded canonical round trips and provenance mutations remain deterministic", () => {
  let state = 1234567;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  for (let run = 0; run < 150; run++) {
    const e = fixture();
    e.version = `${next() % 100}.${next() % 100}.${next() % 100}`;
    e.run.runId = `${BigInt(next()) + 9007199254740993n}`;
    e.run.runAttempt = 1 + next() % 10000;
    e.target.runnerImageVersion = `${next()}.${next() % 1000}`;
    e.sourceFiles = Array.from({ length: 1 + next() % 20 }, (_, i) => ({ path: `d${i % 3}/f${i}`, mode: next() & 1 ? 0o644 : 0o755, bytes: next() % 3000, sha256: sha(Buffer.from(`${run}:${i}`)) }));
    const bytes = good(encodeManifest(e));
    assert.deepEqual(good(encodeManifest(e)), bytes);
    const decoded = good(parseManifest(bytes, e));
    assert.equal(decoded.workflow.runId, e.run.runId);
    const sums = good(encodeChecksums(bytes, e));
    assert.equal(good(parseChecksums(sums, bytes, e)).entries.at(-1).sha256, sha(bytes));
    e.run.runAttempt++; reject(parseManifest(bytes, e), "invalid_manifest");
  }
});

test("seeded arbitrary input never throws or returns private diagnostics", () => {
  let seed = 73;
  const next = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed; };
  const values = [null, undefined, true, false, 0, -1, 1.5, NaN, Infinity, "PRIVATE_CANARY"];
  const arbitrary = (depth) => {
    if (!depth || next() % 3 === 0) return values[next() % values.length];
    if (next() & 1) return Array.from({ length: next() % 5 }, () => arbitrary(depth - 1));
    return Object.assign(Object.create(null), Object.fromEntries(["version", "source", "__proto__", "extra"].slice(0, next() % 5).map((key) => [key, arbitrary(depth - 1)])));
  };
  const expected = fixture(); const encoded = good(encodeManifest(expected));
  for (let i = 0; i < 1000; i++) {
    const input = arbitrary(3);
    reject(encodeManifest(input)); reject(parseManifest(input, expected));
    reject(parseChecksums(input, encoded, expected));
    const bytes = Buffer.alloc(next() % 80, next() % 256);
    reject(parseManifest(bytes, expected), "invalid_manifest");
  }
});
