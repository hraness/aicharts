// Pure, fail-closed validation for one measured Linux CLI qualification report.
// A report is evidence supplied by a qualified runner; this module never builds,
// executes, reads the filesystem, or turns an unqualified report into a release.
import { createHash } from "node:crypto";
import { types } from "node:util";

const MAX_REPORT = 64 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const VERSION = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/u;
const ERRORS = new Map(["invalid_input", "invalid_report", "unsupported_profile", "limit_exceeded"]
  .map(error => [error, Object.freeze({ ok: false, error })]));
const ERROR_VALUES = new Set(ERRORS.values());
const fail = (code = "invalid_input") => { throw ERRORS.get(code); };
const caught = error => ERROR_VALUES.has(error) ? error : ERRORS.get("invalid_input");
const success = value => Object.freeze({ ok: true, value });
const frozen = value => Object.freeze(value);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function record(value, keys, code = "invalid_report") {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) fail(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(code);
    const names = Reflect.ownKeys(value);
    if (names.length !== keys.length) fail(code);
    const out = Object.create(null);
    for (const name of names) {
      if (typeof name !== "string" || !keys.includes(name)) fail(code);
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail(code);
      out[name] = descriptor.value;
    }
    return frozen(out);
  } catch (error) {
    if (ERROR_VALUES.has(error)) throw error;
    fail(code);
  }
}

function hex(value, expression, code = "invalid_report") {
  if (typeof value !== "string" || !expression.test(value)) fail(code);
  return value;
}

function version(value) {
  if (typeof value !== "string" || !VERSION.test(value)) fail();
  return value;
}

function boundedText(value, maximum = 128, code = "invalid_report") {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) fail(code);
  return value;
}

function integer(value, maximum, minimum = 0) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < minimum || value > maximum) fail();
  return value;
}

function source(value) {
  const input = record(value, ["commit", "tree", "commitTime"]);
  const commitTime = boundedText(input.commitTime, 20);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(commitTime)) fail();
  const millis = Date.parse(commitTime);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== `${commitTime.slice(0, -1)}.000Z`) fail();
  return frozen({ commit: hex(input.commit, SHA1), tree: hex(input.tree, SHA1), commitTime });
}

function runner(value) {
  const input = record(value, ["label", "imageVersion", "runId", "runAttempt"]);
  if (input.label !== "ubuntu-22.04") fail("unsupported_profile");
  const imageVersion = boundedText(input.imageVersion, 48);
  if (!/^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}$/u.test(imageVersion)) fail();
  const runId = boundedText(input.runId, 20);
  if (!/^[1-9][0-9]{0,19}$/u.test(runId)) fail();
  return frozen({ label: input.label, imageVersion, runId, runAttempt: integer(input.runAttempt, 1_000_000, 1) });
}

function toolchain(value) {
  const input = record(value, ["rustChannel", "rustCommit", "nodeMajor", "cCompiler"]);
  if (input.rustChannel !== "1.97.1" || input.nodeMajor !== 24) fail("unsupported_profile");
  const compiler = record(input.cCompiler, ["name", "version"]);
  if (compiler.name !== "gcc" && compiler.name !== "clang") fail("unsupported_profile");
  return frozen({ rustChannel: "1.97.1", rustCommit: hex(input.rustCommit, SHA1), nodeMajor: 24,
    cCompiler: frozen({ name: compiler.name, version: version(compiler.version) }) });
}

function dependencies(value) {
  if (!Array.isArray(value) || value.length > 16 || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const out = [...value];
  let previous = "";
  for (const dependency of out) {
    boundedText(dependency, 128);
    if (!/^[A-Za-z0-9][A-Za-z0-9_+.-]*\.so(?:\.[0-9]+)*$/u.test(dependency) || dependency <= previous) fail("invalid_report");
    previous = dependency;
  }
  return frozen(out);
}

function qualify(value) {
  const input = record(value, ["schemaVersion", "qualified", "profile", "version", "source", "runner", "toolchain", "target", "executable", "smoke", "notices"]);
  if (input.schemaVersion !== 1 || input.profile !== "linux-cli-v1") fail("unsupported_profile");
  if (input.qualified !== true) fail("invalid_report");
  const target = record(input.target, ["triple", "os", "arch", "osFloor", "libcFloor", "cpuBaseline", "dynamicDependencies"]);
  if (target.triple !== "x86_64-unknown-linux-gnu" || target.os !== "linux" || target.arch !== "x86_64"
    || target.osFloor !== "ubuntu-22.04" || target.libcFloor !== "glibc-2.35" || target.cpuBaseline !== "x86-64") fail("unsupported_profile");
  const executable = record(input.executable, ["bytes", "sha256"]);
  integer(executable.bytes, 128 * 1024 * 1024, 1);
  const smoke = record(input.smoke, ["passed", "invocations"]);
  if (smoke.passed !== true) fail("invalid_report");
  integer(smoke.invocations, 16, 1);
  const notices = record(input.notices, ["complete", "bytes", "sha256"]);
  if (notices.complete !== true) fail("invalid_report");
  integer(notices.bytes, 128 * 1024 * 1024, 1);
  return frozen({ schemaVersion: 1, qualified: true, profile: "linux-cli-v1", version: version(input.version),
    source: source(input.source), runner: runner(input.runner), toolchain: toolchain(input.toolchain),
    target: frozen({ triple: target.triple, os: target.os, arch: target.arch, osFloor: target.osFloor,
      libcFloor: target.libcFloor, cpuBaseline: target.cpuBaseline, dynamicDependencies: dependencies(target.dynamicDependencies) }),
    executable: frozen({ bytes: executable.bytes, sha256: hex(executable.sha256, SHA256) }),
    smoke: frozen({ passed: true, invocations: smoke.invocations }),
    notices: frozen({ complete: true, bytes: notices.bytes, sha256: hex(notices.sha256, SHA256) }) });
}

function ownedBytes(value) {
  if (types.isProxy(value) || !types.isUint8Array(value)) fail("invalid_input");
  if (value.byteLength > MAX_REPORT) fail("limit_exceeded");
  const out = Buffer.alloc(value.byteLength);
  out.set(value);
  return out;
}

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

/** Encode independently supplied facts into a deterministic bounded report. */
export function encodeLinuxQualificationReport(input) {
  try {
    const value = qualify(input);
    const bytes = Buffer.from(`${canonical(value)}\n`, "utf8");
    if (bytes.length > MAX_REPORT) fail("limit_exceeded");
    return success(Object.freeze({ bytes, sha256: digest(bytes), value }));
  } catch (error) { return caught(error); }
}

/** Validate exact report bytes and return the owned normalized facts. */
export function validateLinuxQualificationReport(inputBytes) {
  try {
    const bytes = ownedBytes(inputBytes);
    const text = bytes.toString("utf8");
    if (!text.endsWith("\n") || text.includes("\r") || Buffer.byteLength(text, "utf8") !== bytes.length) fail("invalid_report");
    let parsed;
    try { parsed = JSON.parse(text.slice(0, -1)); } catch { fail("invalid_report"); }
    const value = qualify(parsed);
    if (!bytes.equals(Buffer.from(`${canonical(value)}\n`, "utf8"))) fail("invalid_report");
    return success(Object.freeze({ value, bytes, sha256: digest(bytes) }));
  } catch (error) { return caught(error); }
}
