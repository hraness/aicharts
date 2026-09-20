// One real, nonpublishing Ubuntu build. Trusted governed source and runner are
// prerequisites: bounded child custody and Cargo flags are not an OS sandbox.
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { posix as path } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { types } from "node:util";
import { readGitSource } from "./git-source.mjs";
import { hydrateReleaseSource } from "./hydrate-source.mjs";
import { assembleLinuxRelease } from "./assemble.mjs";
import { validateArchive } from "./archive.mjs";
import { encodeLinuxQualificationReport, validateLinuxQualificationReport, LINUX_SMOKE_MAX_INVOCATIONS } from "./linux-qualification.mjs";
import { LINUX_LINK_MAP_MAX_BYTES, LINUX_NOTICES_MAX_BYTES, linuxNativeDiagnostic, linuxSystemDiagnostic } from "./linux-notices.mjs";
import { SUPPORT_SOURCE } from "./support-source.mjs";

const MiB = 1024 * 1024;
const TARGET = "x86_64-unknown-linux-gnu";
const RUST = "1.97.1";
const RUST_COMMIT = "8bab26f4f68e0e26f0bb7960be334d5b520ea452";
const INTERPRETER = "/lib64/ld-linux-x86-64.so.2";
const INTERPRETER_SONAME = path.basename(INTERPRETER);
const SYSTEM_LIBRARIES = new Set([INTERPRETER_SONAME, "libc.so.6", "libm.so.6", "libgcc_s.so.1", "libpthread.so.0", "librt.so.1", "libdl.so.2", "libutil.so.1", "libresolv.so.2"]);
const CAPS = Object.freeze({ deadline: 20 * 60_000, build: 12 * 60_000, logs: 32 * MiB, diagnostic: MiB, map: LINUX_LINK_MAP_MAX_BYTES, notices: LINUX_NOTICES_MAX_BYTES, binary: 64 * MiB, metadata: 8 * MiB });
const ERRORS = new Set(["invalid_input", "unsupported_host", "invalid_workflow", "unsupported_destination", "destination_exists", "source_failed", "source_changed", "unsupported_source", "toolchain_failed", "toolchain_mismatch", "process_failed", "process_timeout", "process_output_limit", "process_custody_failed", "deadline_exceeded", "build_failed", "artifact_invalid", "elf_invalid", "runtime_invalid", "smoke_failed", "notices_incomplete", "assembly_failed", "install_failed", "write_failed"]);
const MODULE_ERRORS = Object.freeze({
  source: new Set(["invalid_input", "unsupported_repository", "repository_changed", "missing_object", "invalid_object", "invalid_source", "limit_exceeded", "git_failed", "deadline_exceeded"]),
  hydrate: new Set(["invalid_input", "unsupported_destination", "invalid_source", "limit_exceeded", "destination_exists", "source_changed", "write_failed"]),
  notices: new Set(["notices_invalid_input", "notices_limit", "notices_build_incomplete", "notices_unmapped_crate", "notices_crate_changed", "notices_unknown_native", "notices_rust_missing", "notices_system_missing", "notices_source_changed"]),
});
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
class Failure extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new Failure(code); };
const need = (condition, code) => { if (!condition) fail(code); };
const checked = (result, code) => { if (!result?.ok) fail(code); return result.value; };

function noticeOutputDiagnostic(value) {
  // Emit only source-owned reasons and a saturating count, never notice text,
  // hashes, paths, package identities or accessor-provided diagnostics.
  const refused = (reason, count = null) => ({ module: "notices", code: "notices_output_invalid", reason, bytesCappedAtLimitPlusOne: count });
  if (!value || typeof value !== "object" || types.isProxy(value)) return refused("wrong_type");
  const bytes = Object.getOwnPropertyDescriptor(value, "bytes")?.value;
  if (types.isProxy(bytes) || !types.isUint8Array(bytes) || !Buffer.isBuffer(bytes)) return refused("wrong_type");
  const count = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength").get.call(bytes);
  if (count === 0) return refused("empty", 0);
  if (count > CAPS.notices) return refused("byte_limit", CAPS.notices + 1);
  const expected = Object.getOwnPropertyDescriptor(value, "sha256")?.value;
  if (typeof expected !== "string" || sha(bytes) !== expected) return refused("hash_mismatch", count);
  return null;
}

function exact(value, keys) {
  need(value && typeof value === "object" && !types.isProxy(value), "invalid_input");
  need([Object.prototype, null].includes(Object.getPrototypeOf(value)), "invalid_input");
  const names = Reflect.ownKeys(value);
  need(names.length === keys.length && names.every(name => keys.includes(name)), "invalid_input");
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(descriptor?.enumerable && Object.hasOwn(descriptor, "value"), "invalid_input");
    result[key] = descriptor.value;
  }
  return result;
}
function absolute(value) {
  need(typeof value === "string" && value.length <= 4096 && value !== "/" && path.isAbsolute(value)
    && path.normalize(value) === value && !/[\x00-\x20\x7f,]/u.test(value), "invalid_input");
  return value;
}
function inputs(value) {
  const input = exact(value, ["repositoryDirectory", "commit", "expectedTree", "outputDirectory"]);
  absolute(input.repositoryDirectory); absolute(input.outputDirectory);
  for (const key of ["commit", "expectedTree"]) need(typeof input[key] === "string" && /^[0-9a-f]{40}$/u.test(input[key]) && !/^0+$/u.test(input[key]), "invalid_input");
  need(input.outputDirectory !== input.repositoryDirectory && !input.outputDirectory.startsWith(input.repositoryDirectory + "/")
    && !input.repositoryDirectory.startsWith(input.outputDirectory + "/"), "invalid_input");
  return input;
}
function argumentsToInput(args) {
  need(Array.isArray(args) && args.length === 8, "invalid_input");
  const flags = new Map([["--repository", "repositoryDirectory"], ["--commit", "commit"], ["--tree", "expectedTree"], ["--output", "outputDirectory"]]);
  const value = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = flags.get(args[i]);
    need(key && !Object.hasOwn(value, key), "invalid_input");
    value[key] = args[i + 1];
  }
  return inputs(value);
}
function workflow(input, host) {
  need(host.platform === "linux" && host.arch === "x64" && host.nodeMajor === 24, "unsupported_host");
  const env = host.env;
  need(env.GITHUB_ACTIONS === "true" && env.GITHUB_REPOSITORY === "hraness/aicharts" && env.GITHUB_REF === "refs/heads/main"
    && env.GITHUB_SHA === input.commit && env.GITHUB_WORKFLOW_REF === "hraness/aicharts/.github/workflows/cli-release.yml@refs/heads/main", "invalid_workflow");
  need(/^[1-9][0-9]{0,19}$/u.test(env.GITHUB_RUN_ID ?? "") && /^[1-9][0-9]{0,5}$/u.test(env.GITHUB_RUN_ATTEMPT ?? ""), "invalid_workflow");
  need(env.ImageOS === "ubuntu22" && /^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}$/u.test(env.ImageVersion ?? "") && env.ImageVersion.length <= 48, "unsupported_host");
  const osPath = host.realpath("/etc/os-release");
  need(["/etc/os-release", "/usr/lib/os-release"].includes(osPath), "unsupported_host");
  const os = host.readFile(osPath, 8192).toString("utf8");
  need(/^ID=ubuntu$/mu.test(os) && /^VERSION_ID="22\.04"$/mu.test(os), "unsupported_host");
  return Object.freeze({ label: "ubuntu-22.04", imageVersion: env.ImageVersion, runId: env.GITHUB_RUN_ID, runAttempt: Number(env.GITHUB_RUN_ATTEMPT) });
}
function identity(stat) { return [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid].join(":"); }
function stamp(stat) { return [identity(stat), stat.size, stat.nlink, stat.mtimeNs, stat.ctimeNs].join(":"); }
const ARTIFACT_SIZE_TELEMETRY_CAP = 1024 * MiB;
class ArtifactReadFailure extends Failure {
  constructor(reason, observedSize) {
    super("artifact_invalid");
    this.reason = reason;
    this.observedBytes = typeof observedSize === "bigint" && observedSize >= 0n
      ? Number(observedSize > BigInt(ARTIFACT_SIZE_TELEMETRY_CAP) ? BigInt(ARTIFACT_SIZE_TELEMETRY_CAP) : observedSize) : null;
    this.sizeSaturated = typeof observedSize === "bigint" && observedSize > BigInt(ARTIFACT_SIZE_TELEMETRY_CAP);
  }
}
function artifactReadDiagnostic(error, kind, maximumBytes) {
  // Only the two source-owned compiler outputs receive this diagnostic. The
  // larger telemetry bound measures metadata; it never authorizes a larger read.
  const measured = error instanceof ArtifactReadFailure;
  return { module: "artifact", code: "artifact_read_invalid", kind, reason: measured ? error.reason : "io_failed",
    maximumBytes, observedBytes: measured ? error.observedBytes : null,
    sizeSaturated: measured ? error.sizeSaturated : false, telemetryMaximumBytes: ARTIFACT_SIZE_TELEMETRY_CAP };
}
function readRegular(file, cap, executable = false) {
  const before = fs.lstatSync(file, { bigint: true });
  const check = (condition, reason) => { if (!condition) throw new ArtifactReadFailure(reason, before.size); };
  check(before.isFile() && !before.isSymbolicLink(), "not_regular");
  check(before.size >= 0 && before.size <= BigInt(cap), "byte_limit");
  if (executable) check((before.mode & 0o111n) !== 0n, "not_executable");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    check(stamp(fs.fstatSync(fd, { bigint: true })) === stamp(before), "identity_changed");
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset); check(count > 0, "short_read"); offset += count; }
    const extra = Buffer.alloc(1);
    check(fs.readSync(fd, extra, 0, 1, bytes.length) === 0, "file_grew");
    check(stamp(fs.fstatSync(fd, { bigint: true })) === stamp(before)
      && stamp(fs.lstatSync(file, { bigint: true })) === stamp(before), "identity_changed");
    return bytes;
  } finally { fs.closeSync(fd); }
}
function createFile(file, bytes, mode = 0o600) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, mode);
  try {
    fs.fchmodSync(fd, mode);
    let offset = 0;
    while (offset < bytes.length) { const count = fs.writeSync(fd, bytes, offset, bytes.length - offset); need(count > 0, "write_failed"); offset += count; }
  } finally { fs.closeSync(fd); }
  need(readRegular(file, bytes.length).equals(bytes), "write_failed");
}
function makeDirectory(directory) { fs.mkdirSync(directory, { mode: 0o700 }); fs.chmodSync(directory, 0o700); }
function prepareOutput(directory) {
  const parent = path.dirname(directory);
  let current = "/";
  for (const part of parent.split("/").slice(1)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { bigint: true });
    need(stat.isDirectory() && !stat.isSymbolicLink(), "unsupported_destination");
  }
  const parentStat = fs.lstatSync(parent, { bigint: true });
  need(parentStat.uid === BigInt(process.getuid()) && (parentStat.mode & 0o7777n) === 0o700n, "unsupported_destination");
  try { fs.lstatSync(directory); fail("destination_exists"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  makeDirectory(directory);
  need(identity(fs.lstatSync(parent, { bigint: true })) === identity(parentStat), "unsupported_destination");
  for (const child of ["evidence", "cargo-home", "target", "tmp", "smoke", "install"]) makeDirectory(path.join(directory, child));
}
function groupExists(pid) {
  try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; }
}
// Every child owns one process group. A surviving group is killed and refused;
// uncertainty never establishes settlement or qualification. Scratch is retained.
async function execute(executable, args, options) {
  return await new Promise((resolve, reject) => {
    let child, timer, force, settle, stopped = null, stdout = [], stderr = [], size = 0, closed = false;
    const stop = code => {
      if (stopped) return;
      stopped = code;
      if (child?.pid) {
        try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") stopped = "process_custody_failed"; }
        force = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") stopped = "process_custody_failed"; } }, 250);
      }
      settle = setTimeout(() => finish(null, "process_custody_failed"), 2000);
    };
    const signals = new Map(["SIGINT", "SIGTERM", "SIGHUP"].map(signal => [signal, () => stop("process_failed")]));
    const finish = (status, forcedCode = null) => {
      if (closed) return;
      closed = true; clearTimeout(timer); clearTimeout(force); clearTimeout(settle);
      for (const [signal, listener] of signals) process.off(signal, listener);
      let code = forcedCode ?? stopped;
      if (child?.pid) {
        try { if (groupExists(child.pid)) { process.kill(-child.pid, "SIGKILL"); code = "process_custody_failed"; } }
        catch (error) { if (error.code !== "ESRCH") code = "process_custody_failed"; }
      }
      const result = { status, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
      if (code) { const error = new Failure(code); Object.assign(error, result); reject(error); } else resolve(result);
    };
    try {
      child = spawn(executable, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"], shell: false, detached: true });
      for (const [signal, listener] of signals) process.on(signal, listener);
      const capture = target => chunk => { if (stopped) return; size += chunk.length; if (size > options.maxBytes) stop("process_output_limit"); else target.push(Buffer.from(chunk)); };
      child.stdout.on("data", capture(stdout)); child.stderr.on("data", capture(stderr));
      child.once("error", () => finish(null, "process_failed"));
      child.once("close", status => finish(status));
      timer = setTimeout(() => stop("process_timeout"), options.timeoutMs);
    } catch { finish(null, "process_failed"); }
  });
}
const HOST = Object.freeze({ platform: process.platform, arch: process.arch, nodeMajor: Number(process.versions.node.split(".")[0]), env: process.env,
  readFile: readRegular, realpath: fs.realpathSync, now: () => performance.now(), execute, readSource: readGitSource, hydrate: hydrateReleaseSource,
  assemble: assembleLinuxRelease, validateArchive, collectNotices: async input => (await import("./linux-notices.mjs")).collectLinuxNotices(input),
  progress: stage => process.stdout.write(JSON.stringify({ operation: "linux-qualification", stage }) + "\n") });

function minimalEnvironment(directories, rustc = null) {
  const env = { HRANESS_SUPPORT_AUDIENCE: "off", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC", TMPDIR: directories.tmp,
    CARGO_HOME: directories.cargo, CARGO_INCREMENTAL: "0", CARGO_TERM_COLOR: "never", CARGO_NET_RETRY: "0", CARGO_HTTP_TIMEOUT: "30",
    RUSTUP_HOME: "/home/runner/.rustup", CC: "/usr/bin/gcc-11", AR: "/usr/bin/ar", CARGO_BUILD_JOBS: "2" };
  if (rustc) {
    env.RUSTC = rustc;
    env.PATH = path.dirname(rustc) + ":/usr/bin:/bin";
    env.CARGO_ENCODED_RUSTFLAGS = ["-C", "target-cpu=x86-64", "-C", "linker=/usr/bin/gcc-11", "-C", "linker-features=-lld", "-C", "link-self-contained=-linker", "-C", "link-arg=-fuse-ld=bfd", "--remap-path-prefix=" + directories.source + "=/aicharts/source", "--remap-path-prefix=" + directories.cargo + "=/aicharts/cargo"].join("\x1f");
    env.CFLAGS = "-march=x86-64 -mtune=generic -ffile-prefix-map=" + directories.source + "=/aicharts/source -ffile-prefix-map=" + directories.cargo + "=/aicharts/cargo";
  }
  return env;
}
function checkSource(source) {
  const byPath = new Map(source.sourceFiles.map(file => [file.path, file.bytes]));
  for (const file of source.sourceFiles) need(!/(^|\/)\.cargo\/config(?:\.toml)?$/u.test(file.path), "unsupported_source");
  const manifest = byPath.get("Cargo.toml")?.toString("utf8") ?? "";
  const match = /^version = "((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))"$/mu.exec(manifest);
  need(match && (manifest.match(/^version = /gmu) ?? []).length === 1, "unsupported_source");
  need(/^version\.workspace = true$/mu.test(byPath.get("crates/aicharts-cli/Cargo.toml")?.toString("utf8") ?? ""), "unsupported_source");
  const lock = byPath.get("Cargo.lock")?.toString("utf8") ?? "";
  need(lock.length > 0 && [...lock.matchAll(/^source = "([^"]+)"$/gmu)].every(item => item[1] === "registry+https://github.com/rust-lang/crates.io-index" || item[1] === SUPPORT_SOURCE), "unsupported_source");
  return match[1];
}
function inventoryHash(files) { return sha(Buffer.from(JSON.stringify(files.map(file => ({ path: file.path, mode: file.mode, bytes: file.bytes.length, sha256: sha(file.bytes) }))))); }
function recheckSource(directory, files, host) {
  const expected = new Map(files.map(file => [file.path, file]));
  let entries = 0, found = 0;
  const walk = (relative = "") => {
    const location = path.join(directory, relative);
    const stat = fs.lstatSync(location);
    need(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o7777) === (relative ? 0o755 : 0o700), "source_changed");
    for (const entry of fs.readdirSync(location, { withFileTypes: true })) {
      entries += 1; need(entries <= 8192, "source_changed");
      const name = relative ? relative + "/" + entry.name : entry.name;
      if (entry.isDirectory()) { need(files.some(file => file.path.startsWith(name + "/")), "source_changed"); walk(name); continue; }
      const file = expected.get(name);
      need(entry.isFile() && file, "source_changed");
      const observed = fs.lstatSync(path.join(directory, name));
      need(observed.uid === process.getuid() && (observed.mode & 0o7777) === file.mode && host.readFile(path.join(directory, name), file.bytes.length).equals(file.bytes), "source_changed");
      found += 1;
    }
  };
  walk(); need(found === expected.size, "source_changed");
}
function compareVersion(a, b) { const left = a.split(".").map(Number), right = b.split(".").map(Number); for (let i = 0; i < Math.max(left.length, right.length); i++) { const value = (left[i] ?? 0) - (right[i] ?? 0); if (value !== 0) return value; } return 0; }
// Failure-only projection of the already capped readelf outputs. Unknown names,
// paths, headers and tool text are never copied. These observations do not grant
// compatibility: special version markers are observable but still refused below.
const diagnosticVersion = name => /^(?:GLIBC|GCC)_[0-9]{1,3}(?:\.[0-9]{1,3}){1,2}$/u.test(name)
  || name === "GLIBC_PRIVATE" || name === "GLIBC_ABI_DT_RELR";
function elfObservations(output, library, version) {
  const needed = [...output.dynamic.matchAll(/\(NEEDED\)\s+Shared library: \[([^\]]+)\]/gu)].map(match => match[1]);
  const files = [...output.versions.matchAll(/\bFile: ([A-Za-z0-9_.+-]+)\s+Cnt:/gu)].map(match => match[1]);
  const names = [...output.versions.matchAll(/\bName: ([A-Za-z0-9_.+-]+)\s+Flags:/gu)].map(match => match[1]);
  const versions = [...new Set(names.filter(diagnosticVersion))];
  return {
    neededCountCappedAt17: Math.min(needed.length, 17),
    knownNeeded: [...new Set(needed.filter(name => SYSTEM_LIBRARIES.has(name)))].sort(order),
    unknownNeededCountCappedAt17: Math.min(needed.filter(name => !SYSTEM_LIBRARIES.has(name)).length, 17),
    duplicateNeededCountCappedAt17: Math.min(needed.length - new Set(needed).size, 17),
    versionFileCountCappedAt17: Math.min(files.length, 17),
    knownVersionFiles: [...new Set(files.filter(name => SYSTEM_LIBRARIES.has(name)))].sort(order),
    unknownVersionFileCountCappedAt17: Math.min(files.filter(name => !SYSTEM_LIBRARIES.has(name)).length, 17),
    versionNameCountCappedAt65: Math.min(names.length, 65),
    versionNames: versions.slice(0, 64).sort(order),
    unknownVersionNameCountCappedAt65: Math.min(names.filter(name => !diagnosticVersion(name)).length, 65),
    versionNamesTruncated: versions.length > 64,
    rejectedLibrary: library === null ? null : SYSTEM_LIBRARIES.has(library) ? library : "other",
    rejectedVersion: version === null ? null : diagnosticVersion(version) ? version : "other",
  };
}
class ElfFailure extends Failure {
  constructor(error, code, output, library, version) {
    super(error);
    this.diagnostic = { module: "elf", code, observed: elfObservations(output, library, version) };
  }
}
function inspectElf(binary, output) {
  const check = (condition, error, code, library = null, version = null) => { if (!condition) throw new ElfFailure(error, code, output, library, version); };
  check(binary.length >= 64 && binary.subarray(0, 7).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])) && binary.readUInt16LE(16) === 3 && binary.readUInt16LE(18) === 62, "elf_invalid", "binary_identity");
  check(/Class:\s+ELF64/u.test(output.header) && /Data:\s+2's complement, little endian/u.test(output.header) && /Machine:\s+Advanced Micro Devices X86-64/u.test(output.header), "elf_invalid", "header_identity");
  const interpreters = [...output.program.matchAll(/\[Requesting program interpreter: ([^\]]+)\]/gu)].map(match => match[1]);
  check(interpreters.length === 1 && interpreters[0] === INTERPRETER && (output.program.match(/^\s*INTERP\s/gmu) ?? []).length === 1, "elf_invalid", "interpreter");
  const stacks = output.program.split("\n").filter(line => /^\s*GNU_STACK\s/u.test(line));
  check(stacks.length === 1 && /\sRW\s/u.test(stacks[0]) && !/\sRWE\s/u.test(stacks[0]), "elf_invalid", "stack");
  check(!/\((?:RPATH|RUNPATH|TEXTREL)\)|\bTEXTREL\b/u.test(output.dynamic), "elf_invalid", "dynamic_search_path");
  const dependencies = [...output.dynamic.matchAll(/\(NEEDED\)\s+Shared library: \[([^\]]+)\]/gu)].map(match => match[1]).sort(order);
  check(dependencies.length >= 1 && dependencies.length <= 16, "runtime_invalid", "dependency_count");
  check(new Set(dependencies).size === dependencies.length, "runtime_invalid", "duplicate_dependency");
  for (const library of dependencies) {
    check(SYSTEM_LIBRARIES.has(library), "runtime_invalid", "unsupported_dependency", library);
  }
  // glibc's libc.so linker script includes the loader through AS_NEEDED, so its
  // exact SONAME may be direct. Resolution below must bind it to INTERPRETER;
  // its version requirements still receive the ordinary per-library checks.
  const required = new Map(); let library = null;
  for (const line of output.versions.split("\n")) {
    const file = /\bFile: ([A-Za-z0-9_.+-]+)\s+Cnt:/u.exec(line);
    if (file) { library = file[1]; check(dependencies.includes(library), "runtime_invalid", "version_file_not_needed", library); }
    const name = /\bName: ([A-Za-z0-9_.+-]+)\s+Flags:/u.exec(line);
    if (name) {
      check(library, "runtime_invalid", "version_without_file", library, name[1]);
      check(/^(?:GLIBC|GCC)_[0-9]+(?:\.[0-9]+){1,2}$/u.test(name[1]), "runtime_invalid", "unsupported_version", library, name[1]);
      if (!required.has(library)) required.set(library, new Set()); required.get(library).add(name[1]);
    }
  }
  const glibc = [...required.values()].flatMap(set => [...set]).filter(name => name.startsWith("GLIBC_")).map(name => name.slice(6)).sort(compareVersion);
  check(glibc.length > 0, "runtime_invalid", "missing_glibc_requirement");
  check(compareVersion(glibc.at(-1), "2.35") <= 0, "runtime_invalid", "glibc_floor", null, "GLIBC_" + glibc.at(-1));
  const isa = [...output.notes.matchAll(/x86 ISA needed:\s*([^\n]+)/gu)].map(match => match[1].trim());
  check(isa.length <= 1, "elf_invalid", "isa_note_count");
  check(isa.every(value => value === "x86-64-baseline"), "elf_invalid", "unsupported_isa_note");
  return { dependencies, required, maxGlibc: glibc.at(-1), isa: isa[0] ?? null };
}
function resolveLibraries(text, direct, host) {
  const libraries = new Map();
  for (const line of text.split("\n").filter(line => line.trim())) {
    if (/^\s*linux-vdso\.so\.1 \(0x[0-9a-f]+\)\s*$/u.test(line)) continue;
    let match = /^\s*([A-Za-z0-9_.+-]+) => (\/[^\s]+) \(0x[0-9a-f]+\)\s*$/u.exec(line);
    if (!match) { const loader = /^\s*(\/[^\s]+) \(0x[0-9a-f]+\)\s*$/u.exec(line); need(loader && loader[1] === INTERPRETER, "runtime_invalid"); match = [null, INTERPRETER_SONAME, loader[1]]; }
    need(SYSTEM_LIBRARIES.has(match[1]) && !libraries.has(match[1]) && libraries.size < 16, "runtime_invalid");
    const resolved = host.realpath(match[2]);
    need(/^\/(?:usr\/)?lib(?:64|\/x86_64-linux-gnu)\/[A-Za-z0-9_.+-]+$/u.test(resolved), "runtime_invalid");
    need(match[1] !== INTERPRETER_SONAME || resolved === host.realpath(INTERPRETER), "runtime_invalid");
    const bytes = host.readFile(resolved, 32 * MiB);
    libraries.set(match[1], { soname: match[1], path: resolved, bytes: bytes.length, sha256: sha(bytes) });
  }
  need(libraries.has(INTERPRETER_SONAME) && direct.every(name => libraries.has(name)), "runtime_invalid");
  return [...libraries.values()].sort((a, b) => order(a.soname, b.soname));
}
function compilerArtifact(metadataBytes, messagesBytes, directories, version) {
  let metadata, messages;
  try { metadata = JSON.parse(metadataBytes); messages = messagesBytes.toString("utf8").trim().split("\n").map(line => JSON.parse(line)); } catch { fail("build_failed"); }
  need(Array.isArray(metadata.packages) && metadata.packages.length <= 256 && Array.isArray(messages) && messages.length <= 4096, "build_failed");
  const packages = metadata.packages.filter(value => value.name === "aicharts-cli");
  need(packages.length === 1 && packages[0].version === version && packages[0].manifest_path === path.join(directories.source, "crates/aicharts-cli/Cargo.toml"), "build_failed");
  const artifacts = messages.filter(value => value.reason === "compiler-artifact" && value.package_id === packages[0].id && value.target?.name === "aicharts" && value.target.kind?.includes("bin") && value.profile?.test === false && value.executable !== null);
  need(artifacts.length === 1 && artifacts[0].executable === path.join(directories.target, TARGET, "release/aicharts") && artifacts[0].fresh === false, "build_failed");
  need(messages.filter(value => value.reason === "build-finished").length === 1 && messages.at(-1)?.reason === "build-finished" && messages.at(-1)?.success === true, "build_failed");
  return artifacts[0].executable;
}
function parseJson(bytes) { try { return JSON.parse(bytes); } catch { fail("smoke_failed"); } }
function versionOutput(bytes, version) { const value = parseJson(bytes); need(value.schemaVersion === 1 && value.operation === "version" && value.version === version && value.provenance === "unverified" && value.build?.os === "linux" && value.build?.arch === "x86_64" && value.build?.sourceCommit === null, "smoke_failed"); }
const CANARY = "QUALIFICATION_PRIVATE_CANARY_c7d84";
function syntheticSources(directory) {
  const lines = values => Buffer.from(values.map(value => JSON.stringify(value) + "\n").join(""));
  const files = [
    { path: "claude.jsonl", mode: 0o644, bytes: lines([{ type: "assistant", requestId: "request_a", sessionId: "session_a", timestamp: "2026-09-10T10:00:00Z", cwd: CANARY, message: { id: "message_a", model: CANARY, content: [{ type: "text", text: CANARY }], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 } } }]) },
    { path: "codex.jsonl", mode: 0o644, bytes: lines([{ type: "session_meta", payload: { id: "session_b" } }, { type: "event_msg", timestamp: "2026-09-10T10:00:00Z", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 10, output_tokens: 5 }, last_token_usage: { input_tokens: 10, output_tokens: 5 } } } }]) },
    { path: "turns.jsonl", mode: 0o644, bytes: lines([{ type: "session_meta", payload: { id: "turn_session", source: "cli", cwd: CANARY } }, { type: "event_msg", timestamp: "1970-01-02T23:59:59.001Z", payload: { type: "task_started", turn_id: "turn_a", root_turn_id: "turn_a", started_at: 172799 } }, { type: "event_msg", payload: { type: "task_complete", turn_id: "turn_a", started_at: 172799, completed_at: 172800, duration_ms: 1537, error: { message: CANARY } } }]) },
    { path: "bad.jsonl", mode: 0o644, bytes: Buffer.from("{\"" + CANARY + "\":\n") },
  ];
  for (const file of files) createFile(path.join(directory, file.path), file.bytes, file.mode);
  return files;
}
// Reuse the legacy synthetic inputs inside an isolated home. The stats importer
// uses native client store layouts; malformed and turn-only fixtures stay out.
function statsSources(files) {
  return [["claude.jsonl", ".claude/projects/qualification/claude.jsonl"], ["codex.jsonl", ".codex/sessions/codex.jsonl"]]
    .map(([name, destination]) => {
      const source = files.find(file => file.path === name);
      need(source !== undefined, "smoke_failed");
      return { path: destination, mode: 0o644, bytes: source.bytes };
    });
}
function statsOutput(bytes, observed) {
  const report = parseJson(bytes);
  const keys = (value, expected) => need(value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...expected].sort().join(","), "smoke_failed");
  keys(report, ["schemaVersion", "profile", "registryRevision", "firstUtcDay", "dayCount", "generatedAtMs", "revision", "updatedAtMs", "sources", "rows"]);
  const timestamp = Date.parse("2026-09-10T10:00:00Z"), day = Math.floor(timestamp / 86_400_000);
  need(report.schemaVersion === 2 && report.profile === "client-stats-v2" && report.registryRevision === 1
    && report.firstUtcDay === day + (observed ? 0 : 1) && report.dayCount === 1
    && Number.isSafeInteger(report.generatedAtMs) && report.generatedAtMs >= timestamp
    && report.revision === 0 && report.updatedAtMs === null
    && Array.isArray(report.sources) && report.sources.length === 2
    && Array.isArray(report.rows) && report.rows.length === (observed ? 2 : 0), "smoke_failed");
  const clients = ["claude", "codex"];
  for (const [index, source] of report.sources.entries()) {
    keys(source, ["client", "status", "tokenBasis", "records", "warnings", "latestAtMs"]);
    need(source.client === clients[index] && source.status === (observed ? "observed" : "empty")
      && source.tokenBasis === (observed ? "reported" : "unavailable") && source.records === (observed ? 1 : 0)
      && source.warnings === 0 && source.latestAtMs === (observed ? timestamp : null), "smoke_failed");
  }
  let tokens = 0n;
  for (const [index, row] of report.rows.entries()) {
    keys(row, ["utcDay", "client", "provider", "model", "tokens", "records", "reportedCostMicrousd", "reportedCostRecords",
      "estimatedCostMicrousd", "estimatedCostRecords", "durationMs", "timedRecords", "timedTokens", "tokenBasis", "breakdownCoverage"]);
    need(row.utcDay === day && row.client === clients[index] && row.model === null
      && (row.provider === null || row.provider === (index === 0 ? "anthropic" : "openai"))
      && row.records === 1 && row.tokenBasis === "reported" && row.breakdownCoverage === "partial"
      && row.reportedCostMicrousd === null && row.reportedCostRecords === 0
      && row.estimatedCostMicrousd === null && row.estimatedCostRecords === 0
      && row.durationMs === null && row.timedRecords === 0 && row.timedTokens === "0", "smoke_failed");
    keys(row.tokens, ["input", "cacheRead", "cacheWrite", "output", "reasoning"]);
    const expected = index === 0 ? ["100", "50", "0", "20", "0"] : ["10", "0", "0", "5", "0"];
    for (const [bucket, name] of ["input", "cacheRead", "cacheWrite", "output", "reasoning"].entries()) {
      need(row.tokens[name] === expected[bucket], "smoke_failed");
      tokens += BigInt(row.tokens[name]);
    }
  }
  need(tokens === (observed ? 185n : 0n), "smoke_failed");
}
function treeImage(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  need(entries.length <= 16 && entries.every(entry => entry.isFile()), "smoke_failed");
  return entries.map(entry => { const file = path.join(directory, entry.name); const bytes = readRegular(file, 32 * MiB); return [entry.name, sha(bytes)]; }).sort((a, b) => order(a[0], b[0]));
}

async function runWith(value, host = HOST) {
  let context = null;
  const started = host.now();
  try {
    const input = inputs(value), runner = workflow(input, host);
    prepareOutput(input.outputDirectory);
    const directories = { output: input.outputDirectory, source: path.join(input.outputDirectory, "source"), cargo: path.join(input.outputDirectory, "cargo-home"), target: path.join(input.outputDirectory, "target"), tmp: path.join(input.outputDirectory, "tmp"), smoke: path.join(input.outputDirectory, "smoke"), install: path.join(input.outputDirectory, "install"), evidence: path.join(input.outputDirectory, "evidence") };
    const summary = { schemaVersion: 1, operation: "linux-qualification", checksPassed: false, profile: "linux-cli-v1", source: { commit: input.commit, tree: input.expectedTree }, runner, stages: [], compatibility: { cpuEvidence: "baseline_build_policy_and_native_smoke", universalBaselineExecutionProven: false }, error: null };
    context = { input, directories, summary, logBytes: 0, smokeCalls: 0, smokeMillis: 0 };
    const moduleResult = (module, result, code) => {
      if (!result?.ok) {
        summary.diagnostic = { module, code: MODULE_ERRORS[module].has(result?.error) ? result.error : "unclassified_module_failure" };
        const category = module === "notices" ? linuxNativeDiagnostic(result) : null;
        if (category !== null) summary.diagnostic.nativeCategory = category;
        const systemCategory = module === "notices" ? linuxSystemDiagnostic(result) : null;
        if (systemCategory !== null) summary.diagnostic.systemCategory = systemCategory;
        fail(code);
      }
      return result.value;
    };
    const stage = name => { need(summary.stages.length < 64, "deadline_exceeded"); need(host.now() - started < CAPS.deadline, "deadline_exceeded"); summary.stages.push(name); host.progress(name); };
    const command = async (name, executable, args, options = {}) => {
      stage(name);
      let result;
      try { result = await host.execute(executable, args, { cwd: options.cwd ?? directories.source, env: options.env ?? context.env, timeoutMs: Math.max(1, Math.min(options.timeoutMs ?? 15_000, CAPS.deadline - (host.now() - started))), maxBytes: Math.min(options.maxBytes ?? CAPS.diagnostic, CAPS.logs - context.logBytes) }); }
      catch (error) { if (error.stdout && error.stderr) result = error; else throw error; }
      for (const [stream, bytes] of [["stdout", result.stdout], ["stderr", result.stderr]]) {
        context.logBytes += bytes.length; need(context.logBytes <= CAPS.logs, "process_output_limit");
        createFile(path.join(directories.evidence, String(summary.stages.length).padStart(2, "0") + "-" + name + "." + stream), bytes);
      }
      if (result instanceof Error) throw result;
      need(result.status === (options.status ?? 0), options.failure ?? "process_failed");
      return result;
    };
    stage("source");
    const source = moduleResult("source", host.readSource({ repositoryDirectory: input.repositoryDirectory, commit: input.commit, expectedTree: input.expectedTree }), "source_failed");
    const version = checkSource(source); const sourceHash = inventoryHash(source.sourceFiles);
    moduleResult("hydrate", host.hydrate({ destinationDirectory: directories.source, sourceFiles: source.sourceFiles }), "source_failed");
    for (let ancestor = directories.source; ; ancestor = path.dirname(ancestor)) {
      for (const name of [".cargo/config", ".cargo/config.toml"]) { try { fs.lstatSync(path.join(ancestor, name)); fail("unsupported_source"); } catch (error) { if (error.code !== "ENOENT") throw error; } }
      if (ancestor === "/") break;
    }
    context.env = minimalEnvironment(directories);
    const locate = async name => { const output = await command("locate-" + name, "/home/runner/.cargo/bin/rustup", ["which", "--toolchain", RUST + "-" + TARGET, name]); const location = absolute(output.stdout.toString("utf8").trim()); need(location.startsWith("/home/runner/.rustup/toolchains/" + RUST + "-" + TARGET + "/bin/"), "toolchain_failed"); return location; };
    const rustc = await locate("rustc"), cargo = await locate("cargo");
    context.env = minimalEnvironment(directories, rustc);
    const rustVersion = (await command("rust-version", rustc, ["--version", "--verbose"])).stdout.toString("utf8");
    need(new RegExp("^release: " + RUST.replaceAll(".", "\\.") + "$", "mu").test(rustVersion) && rustVersion.includes("commit-hash: " + RUST_COMMIT + "\n") && rustVersion.includes("host: " + TARGET + "\n"), "toolchain_mismatch");
    const sysroot = absolute((await command("rust-sysroot", rustc, ["--print", "sysroot"])).stdout.toString("utf8").trim());
    need(sysroot === path.dirname(path.dirname(rustc)), "toolchain_mismatch");
    const cargoVersion = (await command("cargo-version", cargo, ["--version"])).stdout.toString("utf8");
    need(/^cargo 1\.97\.1 \([0-9a-f]+ [0-9-]+\)\n$/u.test(cargoVersion), "toolchain_mismatch");
    const compilerVersion = (await command("gcc-version", "/usr/bin/gcc-11", ["-dumpfullversion"])).stdout.toString("utf8").trim();
    need(/^11\.[0-9]+\.[0-9]+$/u.test(compilerVersion), "toolchain_mismatch");
    const linker = (await command("linker-version", "/usr/bin/ld.bfd", ["--version"])).stdout.toString("utf8");
    need(linker.startsWith("GNU ld "), "toolchain_mismatch");
    const bunVersion = (await command("bun-version", "/home/runner/.bun/bin/bun", ["--version"])).stdout.toString("utf8").trim();
    need(bunVersion === "1.3.14", "toolchain_mismatch");
    summary.toolchain = { rustChannel: RUST, rustCommit: RUST_COMMIT, nodeMajor: 24, bunVersion, cCompiler: { name: "gcc", version: compilerVersion }, rustcSha256: sha(host.readFile(rustc, 128 * MiB, true)), cargoSha256: sha(host.readFile(cargo, 128 * MiB, true)), gccSha256: sha(host.readFile(host.realpath("/usr/bin/gcc-11"), 128 * MiB, true)), linkerSha256: sha(host.readFile(host.realpath("/usr/bin/ld.bfd"), 128 * MiB, true)) };
    await command("cargo-fetch", cargo, ["fetch", "--locked", "--target", TARGET], { timeoutMs: 180_000, maxBytes: 4 * MiB });
    const metadata = await command("cargo-metadata", cargo, ["metadata", "--locked", "--offline", "--format-version=1", "--filter-platform", TARGET], { maxBytes: CAPS.metadata });
    const mapPath = path.join(directories.evidence, "link.map");
    const build = await command("cargo-build", cargo, ["rustc", "--frozen", "--release", "--target", TARGET, "-p", "aicharts-cli", "--bin", "aicharts", "--target-dir", directories.target, "--message-format=json", "--", "-C", "link-arg=-Wl,-Map=" + mapPath], { timeoutMs: CAPS.build, maxBytes: 16 * MiB, failure: "build_failed" });
    const executable = compilerArtifact(metadata.stdout, build.stdout, directories, version);
    const readArtifact = (kind, name, file, maximumBytes, isExecutable = false) => {
      stage(name);
      try { return host.readFile(file, maximumBytes, isExecutable); }
      catch (error) { summary.diagnostic = artifactReadDiagnostic(error, kind, maximumBytes); fail("artifact_invalid"); }
    };
    const binary = readArtifact("executable", "measure-executable", executable, CAPS.binary, true); const binaryHash = sha(binary);
    const linkMapBytes = readArtifact("link_map", "read-link-map", mapPath, CAPS.map);
    const elf = {};
    for (const [name, flag] of [["header", "--file-header"], ["program", "--program-headers"], ["dynamic", "--dynamic"], ["versions", "--version-info"], ["notes", "--notes"]]) elf[name] = (await command("elf-" + name, "/usr/bin/readelf", ["--wide", flag, executable])).stdout.toString("utf8");
    let measured;
    try { measured = inspectElf(binary, elf); }
    catch (error) { if (error instanceof ElfFailure) summary.diagnostic = error.diagnostic; throw error; }
    const runtimeEnv = { HRANESS_SUPPORT_AUDIENCE: "off", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC", TMPDIR: directories.tmp, LD_BIND_NOW: "1" };
    const resolved = await command("runtime-libraries", INTERPRETER, ["--list", executable], { env: runtimeEnv });
    const dynamicLibraries = resolveLibraries(resolved.stdout.toString("utf8"), measured.dependencies, host);
    for (const library of dynamicLibraries) {
      const requirements = measured.required.get(library.soname);
      if (!requirements) continue;
      const definitions = (await command("runtime-versions-" + library.soname, "/usr/bin/readelf", ["--wide", "--version-info", library.path])).stdout.toString("utf8").split("Version needs section")[0];
      const available = new Set([...definitions.matchAll(/\bName: ([A-Za-z0-9_.+-]+)/gu)].map(match => match[1]));
      need([...requirements].every(name => available.has(name)), "runtime_invalid");
    }
    summary.compatibility = { ...summary.compatibility, maxRequiredGlibc: measured.maxGlibc, requiredIsaNote: measured.isa, dynamicLibraries: dynamicLibraries.map(({ soname, bytes, sha256 }) => ({ soname, bytes, sha256 })) };
    const smokeBinary = path.join(directories.smoke, "aicharts"); createFile(smokeBinary, binary, 0o755);
    const synthetic = syntheticSources(directories.smoke);
    const smoke = async (args, status = 0, binaryPath = smokeBinary) => {
      need(context.smokeCalls < LINUX_SMOKE_MAX_INVOCATIONS && context.smokeMillis < 60_000, "smoke_failed");
      const before = host.now(); context.smokeCalls += 1;
      const result = await command("smoke-" + String(context.smokeCalls).padStart(2, "0"), binaryPath, args, { cwd: directories.smoke, env: runtimeEnv, status, timeoutMs: Math.min(5000, 60_000 - context.smokeMillis), failure: "smoke_failed" });
      context.smokeMillis += host.now() - before;
      need(!result.stdout.includes(CANARY) && !result.stderr.includes(CANARY) && !result.stdout.includes(directories.output), "smoke_failed");
      if (status === 0) need(result.stderr.length === 0, "smoke_failed");
      return result;
    };
    versionOutput((await smoke(["--version", "--json"])).stdout, version);
    await smoke(["keygen", "--output", "key"]); const key = host.readFile(path.join(directories.smoke, "key"), 32);
    need(key.length === 32 && (fs.lstatSync(path.join(directories.smoke, "key")).mode & 0o777) === 0o600, "smoke_failed");
    await smoke(["keygen", "--output", "key"], 2); need(host.readFile(path.join(directories.smoke, "key"), 32).equals(key), "smoke_failed");
    const sources = ["--key-file", "key", "--codex", "codex.jsonl", "--claude", "claude.jsonl"];
    need(parseJson((await smoke(["usage", ...sources, "--json"])).stdout).tokens === "185", "smoke_failed");
    await smoke(["init", "--state-dir", "state", "--key-file", "key"]);
    const collect = parseJson((await smoke(["collect", "--state-dir", "state", ...sources, "--json"])).stdout);
    need(collect.tokens === "185" && collect.usageOccurrences === 2 && collect.uploaded === false, "smoke_failed");
    const beforeRestart = JSON.stringify(treeImage(path.join(directories.smoke, "state")));
    const restart = parseJson((await smoke(["collect", "--state-dir", "state", ...sources, "--json"])).stdout);
    need(restart.tokens === "185" && restart.sourcesSkipped === 2 && restart.occurrencesChanged === 0 && JSON.stringify(treeImage(path.join(directories.smoke, "state"))) === beforeRestart, "smoke_failed");
    need(parseJson((await smoke(["inspect", "--state-dir", "state", "--key-file", "key", "--json"])).stdout).tokens === "185", "smoke_failed");
    await smoke(["prefix-enable", "--state-dir", "state", "--key-file", "key", "--revision", String(collect.ledgerRevision)]);
    const prefix = parseJson((await smoke(["daemon", "--once", "--complete-prefix", "--retry-attempts", "0", "--state-dir", "state", ...sources, "--json"])).stdout);
    need(prefix.tokens === "185" && prefix.scanMode === "full_changed_source_complete_prefix" && prefix.sourcesWithDeferredTail === 0, "smoke_failed");
    const turns = parseJson((await smoke(["turns", "--codex", "turns.jsonl", "--occurrence-key-file", "key", "--json"])).stdout);
    need(turns.days?.length === 1 && turns.days[0].utcDay === 2 && turns.days[0].completed.runtimeMsSum === "1537" && turns.days[0].completed.runtimeEligibleTurns === 1 && turns.uploaded === false, "smoke_failed");
    const dry = parseJson((await smoke(["upload", "--dry-run", ...sources])).stdout); need(dry.uploaded === false && Array.isArray(dry.frames) && dry.frames.length > 0, "smoke_failed");
    const refused = await smoke(["upload", ...sources], 2); need(refused.stdout.length === 0 && refused.stderr.toString("utf8") === "aicharts: upload_not_enabled_use_dry_run\n", "smoke_failed");
    await smoke(["usage", "--key-file", "key", "--claude", "bad.jsonl", "--json"], 2);
    for (const file of synthetic) need(host.readFile(path.join(directories.smoke, file.path), file.bytes.length).equals(file.bytes), "smoke_failed");
    for (const entry of fs.readdirSync(path.join(directories.smoke, "state"))) { const bytes = host.readFile(path.join(directories.smoke, "state", entry), 32 * MiB); need(!bytes.includes(CANARY) && !bytes.includes(key), "smoke_failed"); }
    stage("notices");
    const notices = moduleResult("notices", await host.collectNotices({ sourceDirectory: directories.source, cargoHomeDirectory: directories.cargo, targetDirectory: directories.target, sysrootDirectory: sysroot, scratchDirectory: directories.tmp, cargoMetadataBytes: metadata.stdout, cargoMessagesBytes: build.stdout, linkMapBytes, dynamicLibraries: dynamicLibraries.map(({ soname, path }) => ({ soname, path })), executablePath: executable }), "notices_incomplete");
    const noticeDiagnostic = noticeOutputDiagnostic(notices);
    if (noticeDiagnostic !== null) { summary.diagnostic = noticeDiagnostic; fail("notices_incomplete"); }
    stage("source-recheck");
    need(inventoryHash(moduleResult("source", host.readSource({ repositoryDirectory: input.repositoryDirectory, commit: input.commit, expectedTree: input.expectedTree }), "source_failed").sourceFiles) === sourceHash, "source_changed");
    recheckSource(directories.source, source.sourceFiles, host);
    need(sha(host.readFile(executable, CAPS.binary, true)) === binaryHash && sha(host.readFile(smokeBinary, CAPS.binary, true)) === binaryHash, "artifact_invalid");
    for (const library of dynamicLibraries) {
      need(library.soname !== INTERPRETER_SONAME || host.realpath(INTERPRETER) === library.path, "runtime_invalid");
      need(sha(host.readFile(library.path, 32 * MiB)) === library.sha256, "runtime_invalid");
    }
    const target = { triple: TARGET, os: "linux", arch: "x86_64", osFloor: "ubuntu-22.04", libcFloor: "glibc-2.35", cpuBaseline: "x86-64", runnerLabel: runner.label, runnerImageVersion: runner.imageVersion, cCompiler: summary.toolchain.cCompiler, dynamicDependencies: measured.dependencies };
    stage("assembly");
    const assembled = checked(host.assemble({ version, source: source.source, run: { runId: runner.runId, runAttempt: runner.runAttempt }, toolchain: { rustChannel: RUST, nodeMajor: 24, bunVersion }, target, sourceFiles: source.sourceFiles, executableBytes: binary, thirdPartyLicenseBytes: notices.bytes }), "assembly_failed");
    need(assembled.files.length === 5, "assembly_failed");
    const manifestBytes = assembled.files.find(file => file.name === "release-manifest.json")?.bytes;
    let manifest; try { manifest = JSON.parse(manifestBytes); } catch { fail("assembly_failed"); }
    const cli = manifest.assets.find(asset => asset.kind === "cli");
    const cliArchive = assembled.files.find(file => file.name === cli?.name);
    need(cliArchive && cliArchive.sha256 === sha(cliArchive.bytes) && cli.sha256 === cliArchive.sha256, "assembly_failed");
    const installedFiles = checked(host.validateArchive(cliArchive.bytes, { root: cli.root, mtime: Date.parse(source.source.commitTime) / 1000, caps: { maxCompressedBytes: 64 * MiB, maxExpandedBytes: 128 * MiB, maxFileBytes: 128 * MiB, maxFiles: 16, maxEntries: 8192, maxExpansionRatio: 4096 }, files: cli.files }), "install_failed");
    const installedRoot = path.join(directories.install, cli.root);
    checked(host.hydrate({ destinationDirectory: installedRoot, sourceFiles: installedFiles.files.map(({ path, mode, bytes }) => ({ path, mode, bytes })) }), "install_failed");
    const installedBinary = path.join(installedRoot, "bin/aicharts"); need(sha(host.readFile(installedBinary, CAPS.binary, true)) === binaryHash, "install_failed");
    versionOutput((await smoke(["--version", "--json"], 0, installedBinary)).stdout, version);
    need((await smoke(["--help"], 0, installedBinary)).stdout.includes("--complete-prefix"), "smoke_failed");
    const statsHome = path.join(directories.smoke, "stats-home"), statsFiles = statsSources(synthetic);
    checked(host.hydrate({ destinationDirectory: statsHome, sourceFiles: statsFiles }), "smoke_failed");
    for (const [date, observed] of [["2026-09-10", true], ["2026-09-11", false]]) {
      statsOutput((await smoke(["stats", "--home", statsHome, "--client", "claude", "--client", "codex",
        "--since", date, "--until", date, "--json"], 0, installedBinary)).stdout, observed);
    }
    // Stats is read-only: preserve the exact synthetic stores and installed
    // source bytes after both the observed and empty-window invocations.
    try { recheckSource(statsHome, statsFiles, host); } catch { fail("smoke_failed"); }
    // Bind the executed install back to the validated archive, including BUILD
    // and every installed byte, after all installed invocations have settled.
    try { recheckSource(installedRoot, installedFiles.files, host); } catch { fail("install_failed"); }
    const qualification = checked(encodeLinuxQualificationReport({ schemaVersion: 1, qualified: true, profile: "linux-cli-v1", version, source: source.source, runner, toolchain: { rustChannel: RUST, rustCommit: RUST_COMMIT, nodeMajor: 24, cCompiler: summary.toolchain.cCompiler }, target: { triple: TARGET, os: "linux", arch: "x86_64", osFloor: "ubuntu-22.04", libcFloor: "glibc-2.35", cpuBaseline: "x86-64", dynamicDependencies: measured.dependencies }, executable: { bytes: binary.length, sha256: binaryHash }, smoke: { passed: true, invocations: context.smokeCalls }, notices: { complete: true, bytes: notices.bytes.length, sha256: notices.sha256 } }), "assembly_failed");
    checked(validateLinuxQualificationReport(qualification.bytes), "assembly_failed");
    stage("persist-assets");
    const assets = path.join(directories.output, "assets"); makeDirectory(assets);
    for (const file of assembled.files) { need(/^[A-Za-z0-9._-]+$/u.test(file.name) && sha(file.bytes) === file.sha256, "assembly_failed"); createFile(path.join(assets, file.name), file.bytes, 0o644); }
    // Keep the successful receipt private until every install/check/write settles.
    // The last effect publishes its name create-new via a hard link, never rename
    // over an existing output. A failed run has no public qualification receipt.
    const preparedReceipt = path.join(directories.evidence, "qualification.ready");
    createFile(preparedReceipt, qualification.bytes, 0o644);
    summary.executable = { bytes: binary.length, sha256: binaryHash }; summary.sourceInventorySha256 = sourceHash;
    summary.smokeInvocations = context.smokeCalls; summary.notices = { bytes: notices.bytes.length, sha256: notices.sha256 }; summary.assets = assembled.files.map(({ name, bytes, sha256 }) => ({ name, bytes: bytes.length, sha256 }));
    // Summary is a diagnostic inventory, not the qualification authority. The
    // final receipt plus successful job outcome carries the success decision.
    summary.error = null;
    summary.checksPassed = true;
    createFile(path.join(directories.output, "summary.json"), Buffer.from(JSON.stringify(summary) + "\n"), 0o644);
    fs.linkSync(preparedReceipt, path.join(directories.output, "qualification.json"));
    return Object.freeze({ ok: true, value: Object.freeze({ outputDirectory: input.outputDirectory, qualificationSha256: qualification.sha256 }) });
  } catch (error) {
    const code = ERRORS.has(error.code) ? error.code : "write_failed";
    if (context) {
      context.summary.checksPassed = false;
      context.summary.error = code;
      try { createFile(path.join(context.directories.output, "summary.json"), Buffer.from(JSON.stringify(context.summary) + "\n"), 0o644); } catch { /* Caller retains the exact uncertain subtree; never delete or overwrite. */ }
    }
    return Object.freeze({ ok: false, error: code });
  }
}

/** Fixed-profile effectful runner. There is no publishing or test-effects option. */
export async function runLinuxRelease(input) { return await runWith(input); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try { result = await runLinuxRelease(argumentsToInput(process.argv.slice(2))); } catch (error) { result = { ok: false, error: ERRORS.has(error.code) ? error.code : "invalid_input" }; }
  process.stdout.write(JSON.stringify(result.ok ? { operation: "linux-qualification", qualified: true } : { operation: "linux-qualification", qualified: false, error: result.error }) + "\n");
  if (!result.ok) process.exitCode = 1;
}
