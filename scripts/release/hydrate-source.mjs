// Create-new source reconstruction inside a trusted, already-owned scratch root.
// No rollback, compiler, environment, network, or provenance interface.
import { createHash } from "node:crypto";
import { constants, lstatSync, mkdirSync, openSync, fstatSync, fchmodSync,
  writeSync, readSync, closeSync, opendirSync } from "node:fs";
import { posix } from "node:path";
import { types } from "node:util";

const LIMITS = Object.freeze({ files: 2048, entries: 8192, source: 64 * 1024 * 1024,
  path: 256, destination: 4096, chunk: 64 * 1024 });
const ERRORS = new Map(["invalid_input", "unsupported_destination", "invalid_source",
  "limit_exceeded", "destination_exists", "source_changed", "write_failed"]
  .map((error) => [error, Object.freeze({ ok: false, error })]));
const ERROR_VALUES = new Set(ERRORS.values());
const fail = (error) => { throw ERRORS.get(error); };
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const safe = (n, maximum, minimum = 0) => Number.isSafeInteger(n) && !Object.is(n, -0) && n >= minimum && n <= maximum;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const IO = Object.freeze({ lstatSync, mkdirSync, openSync, fstatSync, fchmodSync,
  writeSync, readSync, closeSync, opendirSync, getuid: () => process.getuid() });

function record(value, expected, code) {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length) fail(code);
  const copy = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string" || !expected.includes(key)) fail(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail(code);
    copy[key] = descriptor.value;
  }
  return copy;
}

function sourcePath(value) {
  if (typeof value !== "string" || !value.length || value.length > LIMITS.path) fail("invalid_source");
  for (const component of value.split("/")) {
    if (!component.length || component.length > 255 || component === "." || component === ".."
      || /[^A-Za-z0-9._@+()[\]-]/.test(component) || component.endsWith(".")
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component)) fail("invalid_source");
  }
  return value;
}

const ta = Object.getPrototypeOf(Uint8Array.prototype);
const getLength = Object.getOwnPropertyDescriptor(ta, "byteLength").get;
const getOffset = Object.getOwnPropertyDescriptor(ta, "byteOffset").get;
const getBacking = Object.getOwnPropertyDescriptor(ta, "buffer").get;
const abLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
const abResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
function byteView(value) {
  if (types.isProxy(value) || !types.isUint8Array(value)) fail("invalid_source");
  const length = getLength.call(value), backing = getBacking.call(value);
  if (length > LIMITS.source) fail("limit_exceeded");
  abLength.call(backing); // Reject SharedArrayBuffer before exposing its bytes.
  if (abResizable?.call(backing)) fail("invalid_source");
  return new Uint8Array(backing, getOffset.call(value), length); // Also rejects detached buffers.
}

// Validate the entire graph and intrinsic sizes before allocating body copies.
// All copies and expected hashes exist before even destination metadata is read.
function prepare(value) {
  const input = record(value, ["destinationDirectory", "sourceFiles"], "invalid_input");
  const destination = input.destinationDirectory;
  if (typeof destination !== "string" || !posix.isAbsolute(destination)
    || destination.length > LIMITS.destination || destination === "/" || destination.endsWith("/")
    || posix.normalize(destination) !== destination || /[\x00-\x1f\x7f]/.test(destination)) fail("invalid_input");
  const files = input.sourceFiles;
  if (types.isProxy(files) || !Array.isArray(files) || Object.getPrototypeOf(files) !== Array.prototype) fail("invalid_source");
  const length = Object.getOwnPropertyDescriptor(files, "length")?.value;
  if (!safe(length, LIMITS.files, 1)) fail(Number.isSafeInteger(length) && length > LIMITS.files ? "limit_exceeded" : "invalid_source");
  if (Reflect.ownKeys(files).length !== length + 1) fail("invalid_source");
  const entries = new Map([["", "directory"]]), folded = new Map([["", ""]]), inputs = [];
  let total = 0;
  function entry(path, kind) {
    if (entries.has(path)) {
      if (kind === "directory" && entries.get(path) === kind) return;
      fail("invalid_source");
    }
    if (folded.has(path.toLowerCase())) fail("invalid_source");
    if (entries.size >= LIMITS.entries) fail("limit_exceeded");
    entries.set(path, kind); folded.set(path.toLowerCase(), path);
  }
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(files, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("invalid_source");
    const file = record(descriptor.value, ["path", "mode", "bytes"], "invalid_source");
    const path = sourcePath(file.path);
    if (file.mode !== 0o644 && file.mode !== 0o755) fail("invalid_source");
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) entry(parts.slice(0, index).join("/"), "directory");
    entry(path, "file");
    let bytes;
    try { bytes = byteView(file.bytes); }
    catch (error) { if (ERROR_VALUES.has(error)) throw error; fail("invalid_source"); }
    if (total > LIMITS.source - bytes.length) fail("limit_exceeded");
    total += bytes.length;
    inputs.push({ path, mode: file.mode, bytes });
  }
  const owned = inputs.sort((a, b) => order(a.path, b.path)).map((file) => {
    const bytes = Buffer.alloc(file.bytes.length);
    Uint8Array.prototype.set.call(bytes, file.bytes);
    return Object.freeze({ path: file.path, mode: file.mode, bytes, sha256: digest(bytes) });
  });
  return { destination, parent: posix.dirname(destination), files: owned, entries,
    directories: [...entries].filter(([, kind]) => kind === "directory").map(([path]) => path).sort(order) };
}

const identity = (stat) => [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid].join(":");
const fileIdentity = (stat) => [identity(stat), stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
const mode = (stat) => Number(stat.mode & 0o7777n);
function directoryStat(io, path, uid, requiredMode, error) {
  let stat;
  try { stat = io.lstatSync(path, { bigint: true }); }
  catch { fail(error); }
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || (uid !== null && stat.uid !== uid) || (requiredMode !== null && mode(stat) !== requiredMode)) fail(error);
  return stat;
}
function ancestors(io, parent, uid, error) {
  const result = new Map();
  let current = "/";
  result.set(current, identity(directoryStat(io, current, null, null, error)));
  for (const part of parent.split("/").slice(1)) {
    current = posix.join(current, part);
    result.set(current, identity(directoryStat(io, current, current === parent ? uid : null,
      current === parent ? 0o700 : null, error)));
  }
  // The filesystem root itself is never an accepted scratch parent.
  if (parent === "/") fail(error);
  return result;
}
function recheckAncestors(io, before, uid) {
  const after = ancestors(io, [...before.keys()].at(-1), uid, "source_changed");
  if (before.size !== after.size || [...before].some(([path, value]) => after.get(path) !== value)) fail("source_changed");
}
function createdDirectory(io, path, requiredMode, uid) {
  const before = directoryStat(io, path, uid, null, "source_changed");
  const fd = io.openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (identity(io.fstatSync(fd, { bigint: true })) !== identity(before)) fail("source_changed");
    io.fchmodSync(fd, requiredMode);
    const stat = io.fstatSync(fd, { bigint: true });
    if (!stat.isDirectory() || stat.uid !== uid || mode(stat) !== requiredMode
      || identity(directoryStat(io, path, uid, requiredMode, "source_changed")) !== identity(stat)) fail("source_changed");
    return identity(stat);
  } finally { io.closeSync(fd); }
}

function hydrateWith(value, io = IO) {
  let fallback = "invalid_input";
  try {
    const plan = prepare(value);
    fallback = "unsupported_destination";
    const uid = io.getuid();
    if (!safe(uid, Number.MAX_SAFE_INTEGER)) fail("unsupported_destination");
    const owner = BigInt(uid), before = ancestors(io, plan.parent, owner, "unsupported_destination");
    try { io.lstatSync(plan.destination, { bigint: true }); fail("destination_exists"); }
    catch (error) { if (ERROR_VALUES.has(error)) throw error; if (error?.code !== "ENOENT") fail("unsupported_destination"); }
    fallback = "write_failed";
    recheckAncestors(io, before, owner);
    try { io.mkdirSync(plan.destination, { mode: 0o700, recursive: false }); }
    catch (error) { if (error?.code === "EEXIST") fail("destination_exists"); throw error; }
    const directories = new Map([["", createdDirectory(io, plan.destination, 0o700, owner)]]), files = new Map();
    const absolute = (path) => path ? plan.destination + "/" + path : plan.destination;
    function parents(path) {
      recheckAncestors(io, before, owner);
      let parent = posix.dirname(path);
      const chain = [""];
      if (parent !== ".") {
        const parts = parent.split("/");
        for (let index = 1; index <= parts.length; index++) chain.push(parts.slice(0, index).join("/"));
      }
      for (const relative of chain) {
        if (!directories.has(relative) || identity(directoryStat(io, absolute(relative), owner,
          relative ? 0o755 : 0o700, "source_changed")) !== directories.get(relative)) fail("source_changed");
      }
    }
    for (const path of plan.directories.filter(Boolean)) {
      parents(path);
      try { io.mkdirSync(absolute(path), { mode: 0o700, recursive: false }); }
      catch (error) { if (error?.code === "EEXIST") fail("source_changed"); throw error; }
      directories.set(path, createdDirectory(io, absolute(path), 0o755, owner));
    }
    for (const file of plan.files) {
      parents(file.path);
      let fd;
      try { fd = io.openSync(absolute(file.path), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
      catch (error) { if (error?.code === "EEXIST" || error?.code === "ELOOP") fail("source_changed"); throw error; }
      try {
        const initial = io.fstatSync(fd, { bigint: true });
        if (!initial.isFile() || initial.uid !== owner || initial.nlink !== 1n || initial.size !== 0n) fail("source_changed");
        let offset = 0;
        while (offset < file.bytes.length) {
          const size = Math.min(LIMITS.chunk, file.bytes.length - offset);
          const written = io.writeSync(fd, file.bytes, offset, size, offset);
          if (!safe(written, size, 1)) fail("write_failed");
          offset += written;
        }
        io.fchmodSync(fd, file.mode);
        const stat = io.fstatSync(fd, { bigint: true });
        if (!stat.isFile() || stat.dev !== initial.dev || stat.ino !== initial.ino || stat.uid !== owner
          || stat.nlink !== 1n || stat.size !== BigInt(file.bytes.length) || mode(stat) !== file.mode) fail("source_changed");
        files.set(file.path, fileIdentity(stat));
      } finally { io.closeSync(fd); }
    }
    const visited = new Set(), finalDirectories = new Map(), work = [""], buffer = Buffer.alloc(LIMITS.chunk);
    while (work.length) {
      const relative = work.pop(), path = absolute(relative);
      const beforeRead = directoryStat(io, path, owner, relative ? 0o755 : 0o700, "source_changed");
      if (identity(beforeRead) !== directories.get(relative)) fail("source_changed");
      finalDirectories.set(relative, fileIdentity(beforeRead));
      const handle = io.opendirSync(path);
      try {
        let entry;
        while ((entry = handle.readSync()) !== null) {
          if (visited.size + 1 >= LIMITS.entries) fail("limit_exceeded");
          const child = relative ? relative + "/" + entry.name : entry.name;
          if (visited.has(child) || !plan.entries.has(child)) fail("source_changed");
          visited.add(child);
          if (plan.entries.get(child) === "directory") work.push(child);
        }
      } finally { handle.closeSync(); }
      if (fileIdentity(directoryStat(io, path, owner, relative ? 0o755 : 0o700, "source_changed")) !== finalDirectories.get(relative)) fail("source_changed");
    }
    if (visited.size !== plan.entries.size - 1) fail("source_changed");
    for (const file of plan.files) {
      parents(file.path);
      const path = absolute(file.path);
      let observed;
      try { observed = io.lstatSync(path, { bigint: true }); } catch { fail("source_changed"); }
      if (!observed.isFile() || observed.isSymbolicLink() || fileIdentity(observed) !== files.get(file.path)) fail("source_changed");
      const fd = io.openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (fileIdentity(io.fstatSync(fd, { bigint: true })) !== files.get(file.path)) fail("source_changed");
        const hash = createHash("sha256");
        let offset = 0;
        while (offset < file.bytes.length) {
          const size = Math.min(buffer.length, file.bytes.length - offset);
          const read = io.readSync(fd, buffer, 0, size, offset);
          if (!safe(read, size, 1)) fail("source_changed");
          hash.update(buffer.subarray(0, read)); offset += read;
        }
        if (io.readSync(fd, buffer, 0, 1, offset) !== 0 || hash.digest("hex") !== file.sha256
          || fileIdentity(io.fstatSync(fd, { bigint: true })) !== files.get(file.path)
          || fileIdentity(io.lstatSync(path, { bigint: true })) !== files.get(file.path)) fail("source_changed");
      } finally { io.closeSync(fd); }
    }
    recheckAncestors(io, before, owner);
    for (const [relative, expected] of finalDirectories) {
      if (fileIdentity(directoryStat(io, absolute(relative), owner, relative ? 0o755 : 0o700, "source_changed")) !== expected) fail("source_changed");
    }
    for (const file of plan.files) {
      const stat = io.lstatSync(absolute(file.path), { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink() || fileIdentity(stat) !== files.get(file.path)) fail("source_changed");
    }
    const inventory = Object.freeze(plan.files.map((file) => Object.freeze({ path: file.path,
      mode: file.mode, bytes: file.bytes.length, sha256: file.sha256 })));
    return Object.freeze({ ok: true, value: Object.freeze({ inventory }) });
  } catch (error) { return ERROR_VALUES.has(error) ? error : ERRORS.get(fallback); }
}

/** Hydrate into an absent child. Failed creations remain under caller custody. */
export function hydrateReleaseSource(input) { return hydrateWith(input); }
