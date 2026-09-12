import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { crc32, deflateRawSync, gunzipSync, gzipSync, inflateRawSync } from "node:zlib";
import { buildArchive, validateArchive } from "./archive.mjs";

const CAPS = Object.freeze({
  maxCompressedBytes: 1024 * 1024,
  maxExpandedBytes: 4 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxFiles: 32,
  maxEntries: 128,
  maxExpansionRatio: 4096,
});
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fixture = () => ({
  root: "aicharts-0.1.0",
  mtime: 1_789_084_800,
  caps: CAPS,
  files: [
    { path: "docs/usage.md", mode: 0o644, bytes: Buffer.from("synthetic documentation\n") },
    { path: "bin/aicharts", mode: 0o755, bytes: Buffer.from([0, 1, 2, 255]) },
    { path: "LICENSE", mode: 0o644, bytes: Buffer.alloc(0) },
  ],
});
const inventory = (input) => ({
  root: input.root,
  mtime: input.mtime,
  caps: input.caps,
  files: input.files.map(({ path, mode, bytes }) => ({ path, mode, bytes: bytes.length, sha256: sha256(bytes) })),
});

test("canonical round trip returns only independently inventoried, owned files", () => {
  const input = fixture();
  const expected = inventory(input);
  const built = buildArchive(input);
  assert.equal(built.ok, true);
  const checked = validateArchive(built.value, expected);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.value.files.map(({ path }) => path), ["LICENSE", "bin/aicharts", "docs/usage.md"]);
  for (const file of checked.value.files) {
    assert.deepEqual(file.bytes, input.files.find(({ path }) => path === file.path).bytes);
    assert.notEqual(file.bytes, input.files.find(({ path }) => path === file.path).bytes);
  }
  assert.ok(Object.isFrozen(checked));
  assert.ok(Object.isFrozen(checked.value));
  assert.ok(Object.isFrozen(checked.value.files));
  assert.ok(checked.value.files.every(Object.isFrozen));
  assert.deepEqual(Object.keys(checked.value), ["root", "mtime", "files"]);
});

const mustBuild = (input = fixture()) => {
  const result = buildArchive(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};
const reject = (result, code) => {
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result), ["ok", "error"]);
  assert.match(result.error, /^(?:invalid_(?:input|caps|path|inventory|gzip|tar)|limit_exceeded|content_mismatch)$/);
  if (code) assert.equal(result.error, code);
  assert.ok(Object.isFrozen(result));
};
const wrapTar = (tar) => {
  const gzip = gzipSync(tar, { level: 9 });
  Buffer.from([31, 139, 8, 0, 0, 0, 0, 0, 2, 3]).copy(gzip);
  return gzip;
};
const repairChecksum = (tar, offset = 0) => {
  tar.fill(32, offset + 148, offset + 156);
  let sum = 0;
  for (let i = offset; i < offset + 512; i++) sum += tar[i];
  tar.write(sum.toString(8).padStart(6, "0") + "\0 ", offset + 148, 8, "ascii");
};
const offsets = (tar) => {
  const result = [];
  for (let offset = 0; tar[offset] !== 0; ) {
    result.push(offset);
    const size = Number.parseInt(tar.toString("ascii", offset + 124, offset + 135), 8);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return result;
};
const checkedMutation = (mutate, code = "invalid_tar") => {
  const input = fixture();
  const tar = gunzipSync(mustBuild(input));
  mutate(tar, offsets(tar));
  reject(validateArchive(wrapTar(tar), inventory(input)), code);
};

test("packing is deterministic across repeated calls and input/inventory ordering", () => {
  const input = fixture();
  const one = mustBuild(input);
  assert.deepEqual(one, mustBuild(input));
  input.files.reverse();
  assert.deepEqual(one, mustBuild(input));
  assert.equal(validateArchive(one, inventory(input)).ok, true);
  assert.notDeepEqual(one, mustBuild({ ...input, mtime: input.mtime + 1 }));
});

test("independent header oracle verifies canonical USTAR fields, checksum and zero padding", () => {
  const input = fixture();
  const gzip = mustBuild(input);
  const tar = gunzipSync(gzip);
  assert.deepEqual([...gzip.subarray(0, 10)], [31, 139, 8, 0, 0, 0, 0, 0, 2, 3]);
  assert.equal(gzip.readUInt32LE(gzip.length - 8), crc32(tar));
  assert.equal(gzip.readUInt32LE(gzip.length - 4), tar.length);
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  const positions = offsets(tar);
  assert.equal(positions.length, 6); // root, LICENSE, bin, binary, docs, document.
  for (const position of positions) {
    const head = tar.subarray(position, position + 512);
    const bytes = [...head];
    const sum = bytes.reduce((n, b, i) => n + (i >= 148 && i < 156 ? 32 : b), 0);
    assert.equal(head.toString("ascii", 148, 156), sum.toString(8).padStart(6, "0") + "\0 ");
    assert.equal(head.toString("ascii", 108, 124), "0000000" + "\0" + "0000000" + "\0");
    assert.equal(head.toString("ascii", 257, 265), "ustar\0" + "00");
    assert.ok(head.subarray(157, 257).every((n) => n === 0));
    assert.ok(head.subarray(265, 345).every((n) => n === 0));
    assert.ok(head.subarray(500).every((n) => n === 0));
    assert.equal(head.toString("ascii", 136, 148), input.mtime.toString(8).padStart(11, "0") + "\0");
  }
  assert.ok(tar.subarray(-1024).every((n) => n === 0));
  assert.equal(tar.length, 5120);
});

for (const badPath of ["", "/etc/passwd", "../x", "a/../b", ".", "a/./b", "a//b", "a/", "\\x", "a\\b", "a:stream", "a\0b", "a\nb", "a\tb", "a b", "a.", "é", "a😀", "CON", "con.txt", "NUL", "LPT1.txt", "com9.bin", "x/PrN", "a".repeat(101)]) {
  test(`portable path subset refuses ${JSON.stringify(badPath)}`, () => {
    const input = fixture();
    input.files[0].path = badPath;
    reject(buildArchive(input), "invalid_path");
    reject(validateArchive(Buffer.alloc(0), inventory(input)), "invalid_path");
  });
}

test("root must be a single portable component and all complete paths must fit USTAR", () => {
  for (const root of ["", "../x", "a/b", "/a", "CON", "a".repeat(101)]) reject(buildArchive({ ...fixture(), root }), "invalid_path");
  const input = fixture();
  input.root = "r".repeat(100);
  input.files = [{ path: `${"d".repeat(54)}/${"n".repeat(100)}`, mode: 0o644, bytes: Buffer.alloc(0) }];
  const gzip = mustBuild(input); // exactly 256 bytes, name100 + slash + prefix155.
  assert.equal(validateArchive(gzip, inventory(input)).ok, true);
  const tar = gunzipSync(gzip);
  const position = offsets(tar).at(-1);
  assert.equal(tar.toString("ascii", position, position + 100), "n".repeat(100));
  assert.equal(tar.toString("ascii", position + 345, position + 500), `${input.root}/${"d".repeat(54)}`);
  input.files[0].path = `${"d".repeat(55)}/${"n".repeat(100)}`;
  reject(buildArchive(input), "invalid_path");
});

test("terminal line separators never bypass whole-string path or digest constraints", () => {
  for (const ending of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
    const input = fixture();
    input.files[0].path = `docs/usage.md${ending}`;
    reject(buildArchive(input), "invalid_path");
    reject(validateArchive(Buffer.alloc(0), inventory(input)), "invalid_path");
    reject(buildArchive({ ...fixture(), root: `aicharts${ending}` }), "invalid_path");
    const expected = inventory(fixture());
    expected.files[0].sha256 = "a".repeat(64) + ending;
    reject(validateArchive(Buffer.alloc(0), expected), "invalid_inventory");
  }
});

for (const paths of [["a", "a"], ["a", "A"], ["a", "a/b"], ["a/b", "a"], ["Dir/a", "dir/b"], ["a/B/x", "A/b/y"]]) {
  test(`inventory rejects exact/case/type collision ${JSON.stringify(paths)}`, () => {
    const input = { ...fixture(), files: paths.map((path) => ({ path, mode: 0o644, bytes: Buffer.alloc(0) })) };
    reject(buildArchive(input), "invalid_inventory");
    reject(validateArchive(Buffer.alloc(0), inventory(input)), "invalid_inventory");
  });
}

test("independent inventory binds root, mtime, exact files, content, mode and size", () => {
  const input = fixture();
  const gzip = mustBuild(input);
  const changes = [
    (e) => { e.root += "x"; },
    (e) => { e.mtime++; },
    (e) => { e.files[0].mode = 0o755; },
    (e) => { e.files[0].bytes++; },
    (e) => { e.files[0].sha256 = "0".repeat(64); },
    (e) => { e.files[0].path += "x"; },
    (e) => { e.files.pop(); },
    (e) => { e.files.push({ path: "extra", mode: 0o644, bytes: 0, sha256: sha256(Buffer.alloc(0)) }); },
  ];
  for (const change of changes) {
    const expected = inventory(input);
    change(expected);
    reject(validateArchive(gzip, expected));
  }
});

for (const mode of [0, 0o600, 0o700, 0o777, 0o4644, 0o2755, 0o10644, "0644"]) {
  test(`noncanonical mode ${mode} is refused before packing`, () => {
    const input = fixture();
    input.files[0].mode = mode;
    reject(buildArchive(input), "invalid_inventory");
  });
}

test("fixed errors for invalid exact records, descriptors, proxies and custom arrays", () => {
  let invoked = 0;
  const getter = { get root() { invoked++; throw new Error("PRIVATE_CANARY"); }, mtime: 0, files: [], caps: CAPS };
  const input = fixture();
  const bad = [null, undefined, true, "PRIVATE_CANARY", 123, [], new Date(), { ...input, extra: true }, getter,
    new Proxy(input, { ownKeys() { invoked++; throw new Error("PRIVATE_CANARY"); } })];
  for (const value of bad) reject(buildArchive(value));
  const arrayWithIterator = fixture();
  arrayWithIterator.files[Symbol.iterator] = () => { invoked++; throw new Error("PRIVATE_CANARY"); };
  reject(buildArchive(arrayWithIterator));
  const sparse = fixture();
  delete sparse.files[1];
  reject(buildArchive(sparse));
  const descriptor = fixture();
  Object.defineProperty(descriptor.files, "0", { get() { invoked++; return input.files[0]; } });
  reject(buildArchive(descriptor));
  const nonenumerable = fixture();
  Object.defineProperty(nonenumerable, "root", { enumerable: false });
  reject(buildArchive(nonenumerable));
  const custom = fixture();
  Object.setPrototypeOf(custom.files, null);
  reject(buildArchive(custom));
  assert.equal(invoked, 0);
});

test("null-prototype records work; inherited setters and descriptor.value never execute", () => {
  const input = fixture();
  const nullRecord = (value) => Object.assign(Object.create(null), value);
  input.caps = nullRecord(input.caps);
  input.files = input.files.map(nullRecord);
  const top = nullRecord(input);
  const results = [];
  let invoked = 0;
  const bad = fixture();
  Object.defineProperty(bad.files[0], "path", { enumerable: true, get() { invoked++; return "a"; } });
  try {
    Object.defineProperty(Object.prototype, "root", { configurable: true, set() { invoked++; } });
    Object.defineProperty(Object.prototype, "value", { configurable: true, get() { invoked++; return "a"; } });
    results.push(buildArchive(top));
    results.push(buildArchive(bad));
  } finally {
    delete Object.prototype.root;
    delete Object.prototype.value;
  }
  assert.equal(invoked, 0);
  assert.equal(results[0].ok, true);
  reject(results[1], "invalid_input");
});

test("byte snapshot ignores overridden accessors/iterator and rejects shared/proxy/resizable buffers", () => {
  const input = fixture();
  const binary = new Uint8Array([5, 6, 7]);
  let invoked = 0;
  for (const key of ["buffer", "byteOffset", "byteLength", Symbol.iterator]) {
    Object.defineProperty(binary, key, { get() { invoked++; throw new Error("PRIVATE_CANARY"); } });
  }
  input.files[1].bytes = binary;
  const gzip = mustBuild(input);
  const expected = inventory(fixture());
  expected.files[1].bytes = 3;
  expected.files[1].sha256 = sha256(Buffer.from([5, 6, 7]));
  assert.equal(validateArchive(gzip, expected).ok, true);
  assert.equal(invoked, 0);
  for (const bytes of [new Uint8Array(new SharedArrayBuffer(8)), new Proxy(new Uint8Array(3), {}), new Uint16Array(3), new DataView(new ArrayBuffer(3)), new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 }))]) {
    reject(buildArchive({ ...fixture(), files: [{ path: "f", mode: 0o644, bytes }] }), "invalid_input");
    reject(validateArchive(bytes, expected), "invalid_input");
  }
});

test("input and output buffer mutations cannot alias other invocations", () => {
  const input = fixture();
  const expected = inventory(input);
  const gzip = mustBuild(input);
  input.files[1].bytes.fill(99);
  const checked = validateArchive(gzip, expected);
  assert.equal(checked.ok, true);
  const saved = Buffer.from(gzip);
  checked.value.files[1].bytes.fill(42);
  assert.deepEqual(gzip, saved);
  const second = validateArchive(gzip, expected);
  assert.deepEqual([...second.value.files[1].bytes], [0, 1, 2, 255]);
  gzip.fill(0);
  assert.deepEqual([...second.value.files[1].bytes], [0, 1, 2, 255]);
});

test("returned file backing buffers are exact-sized and independent across files and calls", () => {
  const input = fixture();
  const expected = inventory(input);
  const gzip = mustBuild(input);
  const first = validateArchive(gzip, expected);
  const second = validateArchive(gzip, expected);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const returned = [...first.value.files, ...second.value.files];
  for (const file of returned) {
    assert.equal(file.bytes.buffer.byteLength, file.bytes.length);
    assert.equal(file.bytes.byteOffset, 0);
  }
  for (let i = 0; i < returned.length; i++) {
    for (let j = i + 1; j < returned.length; j++) assert.notEqual(returned[i].bytes.buffer, returned[j].bytes.buffer);
    assert.notEqual(returned[i].bytes.buffer, gzip.buffer);
    for (const file of input.files) assert.notEqual(returned[i].bytes.buffer, file.bytes.buffer);
  }
  new Uint8Array(first.value.files[1].bytes.buffer).fill(81);
  assert.deepEqual(second.value.files[1].bytes, input.files[1].bytes);
  assert.deepEqual(first.value.files[2].bytes, input.files[0].bytes);
  assert.equal(validateArchive(gzip, expected).ok, true);
});

test("caps reject extras, unsafe values and growth beyond absolute implementation bounds", () => {
  for (const key of Object.keys(CAPS)) {
    for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, "1000"]) {
      reject(buildArchive({ ...fixture(), caps: { ...CAPS, [key]: value } }), "invalid_caps");
    }
  }
  reject(buildArchive({ ...fixture(), caps: { ...CAPS, extra: 1 } }), "invalid_caps");
  reject(buildArchive({ ...fixture(), caps: { ...CAPS, maxFileBytes: CAPS.maxExpandedBytes + 1 } }), "invalid_caps");
  reject(buildArchive({ ...fixture(), caps: { ...CAPS, maxEntries: 1 } }), "invalid_caps");
});

test("budgets include root/derived directories, file padding and exactly two trailer blocks", () => {
  const input = fixture();
  const gzip = mustBuild(input);
  const expanded = gunzipSync(gzip).length;
  const exact = { ...CAPS, maxExpandedBytes: expanded, maxFileBytes: 1000, maxEntries: 6, maxFiles: 3, maxCompressedBytes: gzip.length };
  input.caps = exact;
  assert.deepEqual(mustBuild(input), gzip);
  assert.equal(validateArchive(gzip, inventory(input)).ok, true);
  for (const delta of [{ maxExpandedBytes: expanded - 1 }, { maxEntries: 5 }, { maxFiles: 2 }, { maxCompressedBytes: gzip.length - 1 }, { maxFileBytes: 3 }]) {
    const smaller = { ...input, caps: { ...exact, ...delta } };
    reject(buildArchive(smaller));
    reject(validateArchive(gzip, inventory(smaller)));
  }
  const ratios = { ...input, caps: { ...exact, maxExpansionRatio: 1 } };
  reject(buildArchive(ratios), "limit_exceeded");
  reject(validateArchive(gzip, inventory(ratios)), "limit_exceeded");
});

test("all fixed gzip header bytes and trailer CRC/ISIZE are mandatory", () => {
  const input = fixture();
  const gzip = mustBuild(input);
  for (let i = 0; i < 10; i++) {
    const mutant = Buffer.from(gzip);
    mutant[i] ^= 1;
    reject(validateArchive(mutant, inventory(input)), "invalid_gzip");
  }
  for (let i = gzip.length - 8; i < gzip.length; i++) {
    const mutant = Buffer.from(gzip);
    mutant[i] ^= 1;
    reject(validateArchive(mutant, inventory(input)), "invalid_gzip");
  }
});

test("every truncated gzip prefix fails; valid tar cannot rescue damaged deflate", () => {
  const input = fixture();
  const gzip = mustBuild(input);
  for (let i = 0; i < gzip.length; i++) reject(validateArchive(gzip.subarray(0, i), inventory(input)), "invalid_gzip");
  const mutant = Buffer.from(gzip);
  mutant.fill(255, 10, gzip.length - 8);
  reject(validateArchive(mutant, inventory(input)), "invalid_gzip");
});

test("raw consumed-input count rejects trailing zero/garbage/deflate and second gzip members", () => {
  const input = fixture();
  const gzip = mustBuild(input);
  const payload = gzip.subarray(10, -8);
  for (const suffix of [Buffer.from([0]), Buffer.alloc(512), Buffer.from("PRIVATE_CANARY"), deflateRawSync(Buffer.from("x")), gzip]) {
    const raw = Buffer.concat([payload, suffix]);
    const native = inflateRawSync(raw, { info: true, maxOutputLength: 10000 });
    assert.equal(native.engine.bytesWritten, payload.length);
    assert.ok(native.engine.bytesWritten < raw.length); // prove runtime's consumed-input semantics.
    const mutant = Buffer.concat([gzip.subarray(0, 10), raw, gzip.subarray(-8)]);
    reject(validateArchive(mutant, inventory(input)), "invalid_gzip");
  }
  for (const suffix of [Buffer.from([0]), Buffer.alloc(8), gzip]) reject(validateArchive(Buffer.concat([gzip, suffix]), inventory(input)), "invalid_gzip");
});

test("inflation bound uses exact independent tar length, not forged trailer or claimed compressed size", () => {
  const input = fixture();
  const expected = inventory(input);
  const oversized = wrapTar(Buffer.alloc(2 * 1024 * 1024));
  oversized.writeUInt32LE(gunzipSync(mustBuild(input)).length, oversized.length - 4);
  reject(validateArchive(oversized, expected), "invalid_gzip");
  const tooShort = wrapTar(Buffer.alloc(512));
  tooShort.writeUInt32LE(gunzipSync(mustBuild(input)).length, tooShort.length - 4);
  reject(validateArchive(tooShort, expected), "invalid_gzip");
});

for (const type of [0, 49, 50, 51, 52, 54, 55, 76, 75, 83, 120, 103]) {
  test(`tar rejects noncanonical/link/device/FIFO/GNU/PAX type byte ${type} with valid checksum`, () => {
    checkedMutation((tar, positions) => { tar[positions[3] + 156] = type; repairChecksum(tar, positions[3]); });
  });
}

test("tar rejects checksum changes, alternate octal/base256, owners, links, magic and hidden fields", () => {
  const fields = [0, 100, 108, 116, 124, 136, 148, 154, 155, 157, 257, 262, 263, 265, 297, 329, 337, 345, 500, 511];
  for (const field of fields) checkedMutation((tar, positions) => {
    const offset = positions[3];
    tar[offset + field] ^= field === 124 ? 128 : 1;
    if (field < 148 || field > 155) repairChecksum(tar, offset);
  });
});

for (const name of ["/absolute", "../escape", "a/../b", "a\\b", "a:stream", "a\0hidden", "a//b", "a. ", "CON", "AICHARTS"]) {
  test(`tar rejects independently crafted dangerous name ${JSON.stringify(name)}`, () => {
    checkedMutation((tar, positions) => {
      tar.fill(0, positions[3], positions[3] + 100);
      tar.write(name, positions[3], "utf8");
      repairChecksum(tar, positions[3]);
    });
  });
}

test("tar rejects duplicate/reordered headers, data changes, padding and nonzero trailer", () => {
  checkedMutation((tar, positions) => tar.copy(tar, positions[4], positions[2], positions[2] + 512));
  checkedMutation((tar, positions) => {
    const first = Buffer.from(tar.subarray(positions[0], positions[0] + 512));
    tar.copy(tar, positions[0], positions[1], positions[1] + 512);
    first.copy(tar, positions[1]);
  });
  checkedMutation((tar, positions) => { tar[positions[3] + 512] ^= 1; }, "content_mismatch");
  checkedMutation((tar, positions) => { tar[positions[3] + 512 + 4] = 1; });
  checkedMutation((tar) => { tar[tar.length - 1] = 1; });
});

test("extra/missing tar records and padding are not tolerated even with valid gzip checksums", () => {
  const input = fixture();
  const tar = gunzipSync(mustBuild(input));
  for (const raw of [tar.subarray(0, -512), tar.subarray(0, -1), Buffer.concat([tar, Buffer.alloc(512)]), Buffer.concat([tar, tar])]) {
    reject(validateArchive(wrapTar(raw), inventory(input)), "invalid_gzip");
  }
});

test("safe integer/schema and digest limits never coerce or disclose supplied values", () => {
  for (const mtime of [-1, NaN, Infinity, 0.5, 0o100000000000, "0"]) reject(buildArchive({ ...fixture(), mtime }), "invalid_input");
  for (const mtime of [0, 0o77777777777]) assert.equal(validateArchive(mustBuild({ ...fixture(), mtime }), inventory({ ...fixture(), mtime })).ok, true);
  for (const digest of ["a", "A".repeat(64), "0".repeat(65), null, { toString() { throw new Error("PRIVATE_CANARY"); } }]) {
    const expected = inventory(fixture());
    expected.files[0].sha256 = digest;
    reject(validateArchive(Buffer.alloc(0), expected), "invalid_inventory");
  }
  for (const bytes of [-1, 0.5, Infinity, "100", Number.MAX_SAFE_INTEGER]) {
    const expected = inventory(fixture());
    expected.files[0].bytes = bytes;
    reject(validateArchive(Buffer.alloc(0), expected), "limit_exceeded");
  }
});

test("seeded generative round trips, ordering and gzip-header corruption stay closed", () => {
  let state = 0x4a494343;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  for (let run = 0; run < 160; run++) {
    const files = [];
    const count = 1 + next() % 12;
    for (let i = 0; i < count; i++) {
      const bytes = Buffer.alloc(next() % 2049);
      for (let n = 0; n < bytes.length; n++) bytes[n] = next() & 255;
      files.push({ path: `d${i % 3}/f${i}.bin`, mode: next() & 1 ? 0o644 : 0o755, bytes });
    }
    const input = { root: `archive-${run}`, mtime: next(), caps: CAPS, files };
    const gzip = mustBuild(input);
    const expected = inventory(input);
    const result = validateArchive(gzip, expected);
    assert.equal(result.ok, true);
    for (const file of result.value.files) assert.deepEqual(file.bytes, files.find((f) => f.path === file.path).bytes);
    assert.deepEqual(mustBuild({ ...input, files: [...files].reverse() }), gzip);
    const mutant = Buffer.from(gzip);
    mutant[next() % 10] ^= 1 + next() % 255;
    reject(validateArchive(mutant, expected), "invalid_gzip");
  }
});

test("seeded arbitrary-input law: never throws and failures expose only closed codes", () => {
  let seed = 1749;
  const next = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed; };
  const primitives = [null, false, true, 0, -1, 1.5, "PRIVATE_CANARY", undefined, NaN, Infinity];
  function value(depth) {
    if (depth === 0 || next() % 3 === 0) return primitives[next() % primitives.length];
    if (next() & 1) return Array.from({ length: next() % 5 }, () => value(depth - 1));
    const object = Object.create(null);
    for (let i = 0, n = next() % 6; i < n; i++) object[["root", "files", "caps", "__proto__", "mtime", "extra"][i]] = value(depth - 1);
    return object;
  }
  for (let i = 0; i < 1000; i++) {
    const arbitrary = value(3);
    reject(buildArchive(arbitrary));
    reject(validateArchive(arbitrary, inventory(fixture())));
    reject(validateArchive(Buffer.from([next() & 255]), arbitrary));
  }
});
