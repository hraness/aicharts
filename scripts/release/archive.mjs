// Isolated archive-mechanics candidate; not a release, installer, or extractor.
import { createHash } from "node:crypto";
import { types } from "node:util";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const BLOCK = 512;
const MAX_MTIME = 0o77777777777;
const HARD = Object.freeze({
  maxCompressedBytes: 64 * 1024 * 1024,
  maxExpandedBytes: 128 * 1024 * 1024,
  maxFileBytes: 128 * 1024 * 1024,
  maxFiles: 2048,
  maxEntries: 8192,
  maxExpansionRatio: 4096,
});
const GZIP_HEADER = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 3]);
const CODES = Object.freeze([
  "invalid_input", "invalid_caps", "invalid_path", "invalid_inventory",
  "limit_exceeded", "invalid_gzip", "invalid_tar", "content_mismatch",
]);
const ERRORS = new Map(CODES.map((error) => [error, Object.freeze({ ok: false, error })]));
const ERROR_VALUES = new Set(ERRORS.values());
const fail = (code) => { throw ERRORS.get(code); };
const caught = (error) => ERROR_VALUES.has(error) ? error : ERRORS.get("invalid_input");
const success = (value) => Object.freeze({ ok: true, value });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const integer = (n, maximum) => Number.isSafeInteger(n) && n >= 0 && n <= maximum;

// Reflection never evaluates supplied property getters or array iterators. Proxy
// objects are refused, not treated as data. Ambient runtime compromise is outside
// this memory-only format boundary.
function record(value, keys, code = "invalid_input") {
  if (value === null || typeof value !== "object" || types.isProxy(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) fail(code);
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length) fail(code);
  const owned = Object.create(null);
  for (const key of names) {
    if (typeof key !== "string" || !keys.includes(key)) fail(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail(code);
    Object.defineProperty(owned, key, { value: descriptor.value, enumerable: true });
  }
  return Object.freeze(owned);
}

function array(value, limit) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("invalid_input");
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!integer(length, limit) || length === 0) fail("invalid_inventory");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) fail("invalid_input");
  const owned = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail("invalid_input");
    owned.push(descriptor.value);
  }
  return owned;
}

function caps(value) {
  const copy = record(value, Object.keys(HARD), "invalid_caps");
  for (const key of Object.keys(HARD)) {
    if (!integer(copy[key], HARD[key]) || copy[key] === 0) fail("invalid_caps");
  }
  if (copy.maxFileBytes > copy.maxExpandedBytes || copy.maxFiles > copy.maxEntries) fail("invalid_caps");
  return copy;
}

const ta = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(ta, "byteLength").get;
const byteOffset = Object.getOwnPropertyDescriptor(ta, "byteOffset").get;
const backingBuffer = Object.getOwnPropertyDescriptor(ta, "buffer").get;
const abLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
const abResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;

function byteView(value, limit) {
  if (types.isProxy(value) || !types.isUint8Array(value)) fail("invalid_input");
  const length = byteLength.call(value);
  if (length > limit) fail("limit_exceeded");
  const backing = backingBuffer.call(value);
  // Native ArrayBuffer getters refuse SharedArrayBuffer. No concurrently mutable
  // or resizable storage is admitted into an owned snapshot.
  abLength.call(backing);
  if (abResizable?.call(backing)) fail("invalid_input");
  return new Uint8Array(backing, byteOffset.call(value), length);
}

function bytesCopy(value, limit) {
  const view = byteView(value, limit);
  const owned = Buffer.alloc(view.byteLength);
  Uint8Array.prototype.set.call(owned, view);
  return owned;
}

function path(value, root = false) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) fail("invalid_path");
  const parts = value.split("/");
  if (root && parts.length !== 1) fail("invalid_path");
  for (const part of parts) {
    if (part.length === 0 || part.length > 255 || part === "." || part === ".."
      || !/^[A-Za-z0-9._@+()[\]-]+$/.test(part) || part.endsWith(".")
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) fail("invalid_path");
  }
  return value;
}

function splitUstar(value) {
  if (value.length <= 100) return { name: value, prefix: "" };
  if (value.length > 256) fail("invalid_path");
  // Canonical split: rightmost slash satisfying the two fixed fields.
  for (let i = value.length - 1; i > 0; i--) {
    if (value[i] === "/" && i <= 155 && value.length - i - 1 <= 100) {
      return { name: value.slice(i + 1), prefix: value.slice(0, i) };
    }
  }
  fail("invalid_path");
}

function plan(input, building) {
  const top = record(input, ["root", "mtime", "files", "caps"]);
  const limits = caps(top.caps);
  const root = path(top.root, true);
  if (!integer(top.mtime, MAX_MTIME)) fail("invalid_input");
  const supplied = array(top.files, limits.maxFiles);
  const entries = new Map();
  const folded = new Map();
  let total = 2 * BLOCK;
  function add(fullPath, kind, mode, size, extra = {}) {
    const existing = entries.get(fullPath);
    if (existing) {
      if (kind === "dir" && existing.kind === "dir") return;
      fail("invalid_inventory");
    }
    const lower = fullPath.toLowerCase();
    if (folded.has(lower)) fail("invalid_inventory");
    const fields = splitUstar(fullPath);
    if (entries.size >= limits.maxEntries) fail("limit_exceeded");
    total += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (total > limits.maxExpandedBytes) fail("limit_exceeded");
    entries.set(fullPath, Object.freeze({ fullPath, ...fields, kind, mode, size, ...extra }));
    folded.set(lower, fullPath);
  }
  add(root, "dir", 0o755, 0);
  for (const value of supplied) {
    const file = record(value, building ? ["path", "mode", "bytes"] : ["path", "mode", "bytes", "sha256"]);
    const relative = path(file.path);
    const fullPath = `${root}/${relative}`;
    if (fullPath.length > 256) fail("invalid_path");
    if (file.mode !== 0o644 && file.mode !== 0o755) fail("invalid_inventory");
    let size;
    if (building) size = byteView(file.bytes, limits.maxFileBytes).byteLength;
    else {
      size = file.bytes;
      if (!integer(size, limits.maxFileBytes)) fail("limit_exceeded");
      if (typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)) fail("invalid_inventory");
    }
    const components = relative.split("/");
    let parent = root;
    for (let i = 0; i < components.length - 1; i++) {
      parent += `/${components[i]}`;
      add(parent, "dir", 0o755, 0);
    }
    add(fullPath, "file", file.mode, size, { path: relative, data: file.bytes, sha256: file.sha256 });
  }
  const sorted = [...entries.values()].sort((a, b) => a.fullPath < b.fullPath ? -1 : a.fullPath > b.fullPath ? 1 : 0);
  return Object.freeze({ root, mtime: top.mtime, limits, entries: Object.freeze(sorted), total });
}

function octal(header, offset, width, value) {
  header.write(value.toString(8).padStart(width - 1, "0"), offset, width - 1, "ascii");
  // Buffer.alloc supplied the final NUL.
}

function checksum(header) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
  return sum;
}

function header(entry, mtime) {
  const out = Buffer.alloc(BLOCK);
  out.write(entry.name, 0, 100, "ascii");
  octal(out, 100, 8, entry.mode);
  octal(out, 108, 8, 0);
  octal(out, 116, 8, 0);
  octal(out, 124, 12, entry.size);
  octal(out, 136, 12, mtime);
  out[156] = entry.kind === "file" ? 48 : 53;
  out.write("ustar\0", 257, 6, "ascii");
  out.write("00", 263, 2, "ascii");
  out.write(entry.prefix, 345, 155, "ascii");
  out.write(checksum(out).toString(8).padStart(6, "0"), 148, 6, "ascii");
  out[155] = 32;
  return out;
}

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  CRC_TABLE[i] = crc >>> 0;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function withinRatio(expanded, compressed, limits) {
  if (expanded > compressed * limits.maxExpansionRatio) fail("limit_exceeded");
}

/** Pure synchronous builder. Caller inputs are data, not extraction authority. */
export function buildArchive(input) {
  try {
    const expected = plan(input, true);
    // Preflight every path/size before allocating payload snapshots or tar data.
    const owned = expected.entries.map((entry) => entry.kind === "file"
      ? { ...entry, data: bytesCopy(entry.data, expected.limits.maxFileBytes) } : entry);
    const tar = Buffer.alloc(expected.total);
    let offset = 0;
    for (const entry of owned) {
      header(entry, expected.mtime).copy(tar, offset);
      offset += BLOCK;
      if (entry.kind === "file") entry.data.copy(tar, offset);
      offset += Math.ceil(entry.size / BLOCK) * BLOCK;
    }
    if (expected.limits.maxCompressedBytes < 20) fail("limit_exceeded");
    let deflated;
    try {
      deflated = deflateRawSync(tar, { level: 9, maxOutputLength: expected.limits.maxCompressedBytes - 18 });
    } catch {
      fail("limit_exceeded");
    }
    const length = GZIP_HEADER.length + deflated.length + 8;
    if (length > expected.limits.maxCompressedBytes) fail("limit_exceeded");
    withinRatio(tar.length, length, expected.limits);
    const gzip = Buffer.alloc(length);
    GZIP_HEADER.copy(gzip);
    deflated.copy(gzip, GZIP_HEADER.length);
    gzip.writeUInt32LE(crc32(tar), length - 8);
    gzip.writeUInt32LE(tar.length, length - 4);
    return success(gzip);
  } catch (error) {
    return caught(error);
  }
}

/** Validate everything before returning any owned bytes; no filesystem effects. */
export function validateArchive(inputBytes, inventory) {
  try {
    const expected = plan(inventory, false);
    const gzip = bytesCopy(inputBytes, expected.limits.maxCompressedBytes);
    if (gzip.length < 20 || !gzip.subarray(0, 10).equals(GZIP_HEADER)) fail("invalid_gzip");
    withinRatio(expected.total, gzip.length, expected.limits);
    if (gzip.readUInt32LE(gzip.length - 4) !== expected.total) fail("invalid_gzip");
    const payload = gzip.subarray(10, -8);
    let inflated;
    try {
      inflated = inflateRawSync(payload, { info: true, maxOutputLength: expected.total });
    } catch {
      fail("invalid_gzip");
    }
    // info exposes consumed input for the synchronous raw inflater. Checking it
    // rejects concatenated streams and unread trailing input, not just markers.
    if (inflated.engine.bytesWritten !== payload.length) fail("invalid_gzip");
    const tar = inflated.buffer;
    if (tar.length !== expected.total || crc32(tar) !== gzip.readUInt32LE(gzip.length - 8)) fail("invalid_gzip");
    const files = [];
    let offset = 0;
    for (const entry of expected.entries) {
      const received = tar.subarray(offset, offset + BLOCK);
      const canonical = header(entry, expected.mtime);
      // Exact canonical comparison also rejects type/link/PAX/GNU/base256/name
      // alternatives. The independent inventory fixes each header and offset.
      if (!received.equals(canonical)) fail("invalid_tar");
      offset += BLOCK;
      const end = offset + entry.size;
      const paddedEnd = offset + Math.ceil(entry.size / BLOCK) * BLOCK;
      for (let i = end; i < paddedEnd; i++) if (tar[i] !== 0) fail("invalid_tar");
      if (entry.kind === "file") {
        const contents = tar.subarray(offset, end);
        if (hash(contents) !== entry.sha256) fail("content_mismatch");
        // Buffer.from(smallSlice) can expose a shared pool through .buffer.
        // Every returned backing allocation must contain exactly this file.
        files.push(Object.freeze({ path: entry.path, mode: entry.mode, sha256: entry.sha256, bytes: bytesCopy(contents, entry.size) }));
      }
      offset = paddedEnd;
    }
    for (let i = offset; i < tar.length; i++) if (tar[i] !== 0) fail("invalid_tar");
    return success(Object.freeze({ root: expected.root, mtime: expected.mtime, files: Object.freeze(files) }));
  } catch (error) {
    return caught(error);
  }
}
