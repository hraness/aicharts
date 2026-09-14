// Memory-only exact BUILD matcher. Supplied facts are not authenticated here.
import { createHash } from "node:crypto";
import { types } from "node:util";

const MAX_BUILD = 16 * 1024;
const VERSION = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const ERRORS = new Map(["invalid_expectations", "invalid_build", "invalid_inventory", "limit_exceeded"].map((error) => [error, Object.freeze({ ok: false, error })]));
const ERROR_VALUES = new Set(ERRORS.values());
const fail = (code = "invalid_expectations") => { throw ERRORS.get(code); };
const caught = (error) => ERROR_VALUES.has(error) ? error : ERRORS.get("invalid_expectations");
const success = (value) => Object.freeze({ ok: true, value });
const frozen = (value) => Object.freeze(value);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const integer = (value, maximum, minimum = 0) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum && value <= maximum;

function record(value, keys, code = "invalid_expectations") {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value)) fail(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) fail(code);
    const names = Reflect.ownKeys(value);
    if (names.length !== keys.length) fail(code);
    const copy = Object.create(null);
    for (const key of names) {
      if (typeof key !== "string" || !keys.includes(key)) fail(code);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail(code);
      Object.defineProperty(copy, key, { value: descriptor.value, enumerable: true });
    }
    return frozen(copy);
  } catch (error) {
    if (ERROR_VALUES.has(error)) throw error;
    fail(code);
  }
}

function hash(value, length = 64, code = "invalid_expectations") {
  if (typeof value !== "string" || value.length !== length || !/^[0-9a-f]+$/.test(value)) fail(code);
  return value;
}

function version(value) {
  if (typeof value !== "string" || !VERSION.test(value)) fail();
  return value;
}

function toolchain(value, cli) {
  const input = record(value, ["rustChannel", "cargoLockSha256", "nodeMajor", "cCompiler"]);
  if (input.nodeMajor !== 24) fail();
  if (!cli) {
    if (input.rustChannel !== null || input.cargoLockSha256 !== null || input.cCompiler !== null) fail();
    return frozen({ rustChannel: null, cargoLockSha256: null, nodeMajor: 24, cCompiler: null });
  }
  const compiler = record(input.cCompiler, ["name", "version"]);
  if (compiler.name !== "gcc" && compiler.name !== "clang") fail();
  return frozen({
    rustChannel: version(input.rustChannel), cargoLockSha256: hash(input.cargoLockSha256), nodeMajor: 24,
    cCompiler: frozen({ name: compiler.name, version: version(compiler.version) }),
  });
}

function runner(value) {
  const input = record(value, ["label", "imageVersion", "runId", "runAttempt"]);
  if (input.label !== "ubuntu-22.04") fail();
  if (typeof input.imageVersion !== "string" || input.imageVersion.length > 48
    || !/^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}$/.test(input.imageVersion)) fail();
  if (typeof input.runId !== "string" || !/^[1-9][0-9]{0,19}$/.test(input.runId)
    || !integer(input.runAttempt, 1_000_000, 1)) fail();
  return frozen({ label: "ubuntu-22.04", imageVersion: input.imageVersion, runId: input.runId, runAttempt: input.runAttempt });
}

function build(expected) {
  const input = record(expected, ["kind", "version", "sourceCommit", "sourceTree", "toolchain", "runner", "executableSha256"]);
  if (input.kind !== "cli" && input.kind !== "skill") fail();
  const cli = input.kind === "cli";
  if (!cli && input.executableSha256 !== null) fail();
  return frozen({
    schemaVersion: 1, kind: input.kind, repository: "hraness/aicharts", version: version(input.version),
    sourceCommit: hash(input.sourceCommit, 40), sourceTree: hash(input.sourceTree, 40),
    target: cli ? "x86_64-unknown-linux-gnu" : null, os: cli ? "linux" : null, arch: cli ? "x86_64" : null,
    toolchain: toolchain(input.toolchain, cli), runner: runner(input.runner),
    executableSha256: cli ? hash(input.executableSha256) : null,
  });
}

function file(value) {
  const input = record(value, ["path", "mode", "bytes", "sha256"], "invalid_inventory");
  if (input.path !== "BUILD.json" || input.mode !== 0o644) fail("invalid_inventory");
  if (!integer(input.bytes, MAX_BUILD, 1)) {
    if (Number.isSafeInteger(input.bytes) && input.bytes > MAX_BUILD) fail("limit_exceeded");
    fail("invalid_inventory");
  }
  return frozen({ path: "BUILD.json", mode: 0o644, bytes: input.bytes, sha256: hash(input.sha256, 64, "invalid_inventory") });
}

const ta = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(ta, "byteLength").get;
const byteOffset = Object.getOwnPropertyDescriptor(ta, "byteOffset").get;
const backing = Object.getOwnPropertyDescriptor(ta, "buffer").get;
const abLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
const abResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;

function copyBytes(value) {
  try {
    if (types.isProxy(value) || !types.isUint8Array(value)) fail("invalid_build");
    const length = byteLength.call(value);
    if (length > MAX_BUILD) fail("limit_exceeded");
    const buffer = backing.call(value);
    abLength.call(buffer); // Reject SharedArrayBuffer even when the view is Uint8Array.
    if (abResizable?.call(buffer)) fail("invalid_build");
    const view = new Uint8Array(buffer, byteOffset.call(value), length);
    const owned = Buffer.alloc(length);
    Uint8Array.prototype.set.call(owned, view);
    return owned;
  } catch (error) {
    if (ERROR_VALUES.has(error)) throw error;
    fail("invalid_build");
  }
}

// Only the validated, owned graph is serialized; no inherited toJSON callbacks.
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  return "{" + Object.keys(value).map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
}

function encoded(value) {
  const text = canonical(value) + "\n";
  const length = Buffer.byteLength(text, "utf8");
  if (length > MAX_BUILD) fail("limit_exceeded");
  const bytes = Buffer.alloc(length);
  bytes.write(text, "utf8");
  return bytes;
}

/** Encode only independently supplied release facts, never runtime lookups. */
export function encodeBuild(expectations) {
  try { return success(encoded(build(expectations))); } catch (error) { return caught(error); }
}

/** Exact canonical body and external inventory matcher; not authentication. */
export function validateBuild(inputBytes, expectations, expectedFile) {
  try {
    const expected = build(expectations);
    const inventory = file(expectedFile);
    const bytes = copyBytes(inputBytes);
    if (bytes.length !== inventory.bytes || digest(bytes) !== inventory.sha256) fail("invalid_inventory");
    if (!bytes.equals(encoded(expected))) fail("invalid_build");
    return success(expected);
  } catch (error) { return caught(error); }
}
